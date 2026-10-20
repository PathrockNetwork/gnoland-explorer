/**
 * gno.land indexer: decoded blocks and transactions from the tx-indexer into
 * Postgres, plus consensus data the tx-indexer does not carry, from the RPC.
 *
 * Loops:
 *  - follow:     ingest blocks, transactions, events and deployed packages in
 *                height order from genesis, then keep up with the chain
 *  - signatures: read each block's precommits (from the next block's
 *                last_commit) for the newest SIGNATURE_DEPTH blocks, recording
 *                which members of the validator set did not sign
 *  - validators: the consensus set from RPC joined with operator profiles
 *                registered in gno.land/r/gnops/valopers
 *  - names:      registered usernames from gno.land/r/sys/users
 *  - packages:   live / inert status (new code waits for an approver)
 *  - tokens:     GRC20 registry metadata, decimals and supply
 *  - govdao:     proposals, their status and votes from gno.land/r/gov/dao
 *
 * The chain has instant finality (Tendermint2), so there are no reorgs to
 * unwind: a block the tx-indexer reports is final.
 */
import { sql } from "drizzle-orm";
import {
  JsonRpc,
  TxIndexer,
  blocks,
  createDb,
  events,
  loadEnv,
  packages,
  parseBlock,
  parseProposal,
  parseProposalList,
  parseTokenRegistry,
  parseVotes,
  proposals,
  qeval,
  evalValue,
  abciQuery,
  tokenTransfers,
  tokens,
  GOVDAO_REALM,
  GRC20_REGISTRY,
  isTokenKey,
  parseTx,
  parseValoper,
  qrender,
  rpcUrlsFromEnv,
  syncState,
  transactions,
  userAt,
  userCount,
  usernames,
  validators,
  type ParsedTx,
  type ValoperProfile,
} from "@gnoland-explorer/core";

loadEnv();

const CHAIN_ID = process.env.CHAIN_ID ?? "gnoland-1";
const BLOCK_PAGE = Number(process.env.BLOCK_PAGE ?? 2000);
const FOLLOW_POLL_MS = 2_000;
/** Newest blocks whose commit signatures are read; "all" reads back to height 1. */
const SIGNATURE_DEPTH = process.env.SIGNATURE_DEPTH === "all" ? Number.POSITIVE_INFINITY : Number(process.env.SIGNATURE_DEPTH ?? 100_000);
const SIGNATURE_BATCH = Number(process.env.SIGNATURE_BATCH ?? 10);
const VALIDATOR_SYNC_MS = Number(process.env.VALIDATOR_SYNC_INTERVAL_MS ?? 5 * 60_000);
const VALOPERS = "gno.land/r/gnops/valopers";
const NAMES_SYNC_MS = Number(process.env.NAMES_SYNC_INTERVAL_MS ?? 10 * 60_000);

const { db, pool } = createDb();
const rpc = new JsonRpc(rpcUrlsFromEnv());
const txIndexer = new TxIndexer();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(`${new Date().toISOString()} ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);

let stopping = false;
/** Highest height ingested; every height below it is present. */
let head: number | null = null;
let indexerHeight = 0;
let chainHeight = 0;
const stats = { blocks: 0, txs: 0, signatures: 0 };

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Fetch [lo, hi] from the tx-indexer and write it in one transaction. */
async function ingest(lo: number, hi: number): Promise<number> {
  const [rawBlocks, rawTxs] = await Promise.all([txIndexer.blocks(lo, hi), txIndexer.txs(lo, hi)]);
  if (!rawBlocks.length) return head ?? lo - 1;
  const rows = rawBlocks.map(parseBlock);
  // Never move past a hole: the indexer may still be writing the newest block.
  let top = lo - 1;
  for (const b of rows) {
    if (b.height !== top + 1) break;
    top = b.height;
  }
  const times = new Map(rows.map((b) => [b.height, b.time]));
  const parsed: ParsedTx[] = rawTxs.filter((t) => t.block_height <= top).map((t) => parseTx(t, times.get(t.block_height) ?? new Date(0)));
  // A block's tx count must match what we got, or we'd persist half a block.
  const perBlock = new Map<number, number>();
  for (const p of parsed) perBlock.set(p.tx.height, (perBlock.get(p.tx.height) ?? 0) + 1);
  for (const b of rows) {
    if (b.height > top) break;
    if ((perBlock.get(b.height) ?? 0) !== b.txCount) {
      top = b.height - 1;
      log("tx count mismatch, retrying", { height: b.height, expected: b.txCount, got: perBlock.get(b.height) ?? 0 });
      break;
    }
  }
  if (top < lo) return lo - 1;

  await db.transaction(async (tx) => {
    for (const part of chunk(rows.filter((b) => b.height <= top), 1000)) await tx.insert(blocks).values(part).onConflictDoNothing();
    const keep = parsed.filter((p) => p.tx.height <= top);
    for (const part of chunk(keep.map((p) => p.tx), 500)) await tx.insert(transactions).values(part).onConflictDoNothing();
    for (const part of chunk(keep.flatMap((p) => p.events), 1000)) await tx.insert(events).values(part).onConflictDoNothing();
    const pkgs = keep.flatMap((p) => p.packages);
    for (const part of chunk(pkgs, 500)) await tx.insert(packages).values(part).onConflictDoNothing();
    const transfers = keep.flatMap((p) => p.transfers);
    for (const part of chunk(transfers, 1000)) await tx.insert(tokenTransfers).values(part).onConflictDoNothing();
    if (transfers.length) {
      const seen = new Map(transfers.map((t) => [t.token, t.standard]));
      await tx
        .insert(tokens)
        .values([...seen].map(([key, standard]) => ({ key, standard, realm: key.slice(0, key.lastIndexOf(".")), symbol: key.slice(key.lastIndexOf(".") + 1) })))
        .onConflictDoNothing();
    }
    // Approvals and rejections of inert packages.
    for (const p of keep) {
      if (!p.tx.success) continue;
      for (const m of p.tx.messages) {
        if (m.kind === "MsgEnablePackage" && m.value.pkg_path) await tx.update(packages).set({ status: "live" }).where(sql`${packages.path} = ${m.value.pkg_path}`);
        if (m.kind === "MsgRejectPackage" && m.value.pkg_path) await tx.update(packages).set({ status: "rejected" }).where(sql`${packages.path} = ${m.value.pkg_path}`);
      }
    }
    stats.txs += keep.length;
  });
  stats.blocks += top - lo + 1;
  return top;
}

async function saveState(): Promise<void> {
  await db
    .update(syncState)
    .set({ headHeight: head, indexerHeight, chainHeight, activeRpc: rpc.active, updatedAt: new Date() })
    .where(sql`${syncState.id} = 1`);
}

async function follow(): Promise<void> {
  while (!stopping) {
    try {
      const [idx, status] = await Promise.all([txIndexer.latestHeight(), rpc.call<any>("status", {}).catch(() => null)]);
      indexerHeight = idx;
      if (status) chainHeight = Number(status.sync_info.latest_block_height);
      while (!stopping && (head ?? -1) < indexerHeight) {
        const lo = (head ?? -1) + 1;
        const hi = Math.min(indexerHeight, lo + BLOCK_PAGE - 1);
        const top = await ingest(lo, hi);
        if (top < lo) break; // nothing contiguous yet; poll again
        head = top;
        await saveState();
      }
      await saveState();
    } catch (err) {
      log("follow error", { err: (err as Error).message });
      await sleep(5_000);
    }
    await sleep(FOLLOW_POLL_MS);
  }
}

/* ── commit signatures ───────────────────────────────────────────────── */

const setCache = new Map<string, string[]>();

/** Addresses in the validator set with this hash, read at `height` if unknown. */
async function setMembers(hash: string | null, height: number): Promise<string[]> {
  const key = hash ?? `h${height}`;
  const cached = setCache.get(key);
  if (cached) return cached;
  if (hash) {
    const { rows } = await pool.query(`select members from validator_sets where hash = $1`, [hash]);
    if (rows[0]) {
      const m = (rows[0].members as { address: string }[]).map((v) => v.address);
      setCache.set(key, m);
      return m;
    }
  }
  const r = await rpc.call<any>("validators", { height: String(height) });
  const members = (r.validators ?? []).map((v: any) => ({ address: v.address, pub_key: v.pub_key?.value ?? "", voting_power: Number(v.voting_power) }));
  if (hash) {
    await pool.query(`insert into validator_sets (hash, height, members) values ($1, $2, $3) on conflict do nothing`, [hash, height, JSON.stringify(members)]);
  }
  const addrs = members.map((m: { address: string }) => m.address);
  setCache.set(key, addrs);
  return addrs;
}

/** Record precommits for each height (read from height + 1's last_commit). */
async function signHeights(heights: { height: number; validators_hash: string | null }[]): Promise<void> {
  const res = await rpc.batch<any>(heights.map((h) => ({ method: "block", params: { height: String(h.height + 1) } })));
  for (let i = 0; i < heights.length; i++) {
    const { height, validators_hash } = heights[i]!;
    const precommits: any[] = res[i]?.block?.last_commit?.precommits ?? [];
    const signers = new Set(precommits.filter(Boolean).map((p) => p.validator_address as string));
    const members = await setMembers(validators_hash, height);
    const missed = members.filter((m) => !signers.has(m));
    // Plain pg here: drizzle's sql template would spread the array into separate parameters.
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (missed.length) {
        await client.query(`insert into missed_signatures (height, validator) select $1, unnest($2::text[]) on conflict do nothing`, [height, missed]);
      }
      await client.query(`update blocks set signed = $1, missed = $2 where height = $3`, [signers.size, missed.length, height]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    stats.signatures++;
  }
}

async function signatures(): Promise<void> {
  while (!stopping) {
    try {
      if (head === null || !indexerHeight || indexerHeight - head > BLOCK_PAGE) {
        await sleep(5_000); // still catching up on blocks
        continue;
      }
      const floor = Math.max(1, Number.isFinite(SIGNATURE_DEPTH) ? head - SIGNATURE_DEPTH : 1);
      await db.update(syncState).set({ signatureFloor: floor }).where(sql`${syncState.id} = 1`);
      // Newest first, so uptime is current before history fills in. The head
      // itself waits: its precommits are only in the next block.
      const { rows } = await pool.query<{ height: string; validators_hash: string | null }>(
        `select height, validators_hash from blocks where signed is null and height between $1 and $2 order by height desc limit $3`,
        [floor, head - 1, SIGNATURE_BATCH * 4],
      );
      if (!rows.length) {
        await sleep(FOLLOW_POLL_MS);
        continue;
      }
      for (const part of chunk(rows.map((r) => ({ height: Number(r.height), validators_hash: r.validators_hash })), SIGNATURE_BATCH)) {
        if (stopping) break;
        await signHeights(part);
      }
    } catch (err) {
      log("signature error", { err: (err as Error).message });
      await sleep(5_000);
    }
  }
}

/* ── validators ──────────────────────────────────────────────────────── */

async function syncValidators(): Promise<void> {
  const status = await rpc.call<any>("status", {});
  chainHeight = Number(status.sync_info.latest_block_height);
  const set = await rpc.call<any>("validators", {});
  const members: { address: string; pub_key: string; voting_power: number }[] = (set.validators ?? []).map((v: any) => ({
    address: v.address,
    pub_key: v.pub_key?.value ?? "",
    voting_power: Number(v.voting_power),
  }));

  // Operator profiles: the realm's index lists operators; each profile names its signing address.
  const index = await qrender(rpc, VALOPERS, "");
  const operators = [...new Set([...index.matchAll(/\/r\/gnops\/valopers:(g1[a-z0-9]{38})/g)].map((m) => m[1]!))];
  const profiles: ValoperProfile[] = [];
  for (const op of operators) {
    if (stopping) return;
    try {
      profiles.push(parseValoper(op, await qrender(rpc, VALOPERS, op)));
    } catch (err) {
      log("valoper render failed", { op, err: (err as Error).message });
    }
  }
  const bySigning = new Map(profiles.filter((p) => p.signing).map((p) => [p.signing!, p]));
  const inSet = new Set(members.map((m) => m.address));
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.update(validators).set({ inSet: false, votingPower: 0 }).where(sql`${validators.inSet}`);
    const addrs = new Set([...members.map((m) => m.address), ...bySigning.keys()]);
    for (const address of addrs) {
      const m = members.find((x) => x.address === address);
      const p = bySigning.get(address);
      const row = {
        address,
        pubKey: m?.pub_key ?? null,
        votingPower: m?.voting_power ?? 0,
        inSet: inSet.has(address),
        moniker: p?.moniker ?? null,
        description: p?.description ?? null,
        serverType: p?.serverType ?? null,
        operator: p?.operator ?? null,
        syncedAt: now,
      };
      const { address: _a, ...update } = row;
      // Keep a known pub key for a validator that left the set.
      if (!m) delete (update as Partial<typeof update>).pubKey;
      await tx.insert(validators).values(row).onConflictDoUpdate({ target: validators.address, set: update });
    }
  });
  await pool.query(
    `update validators v set first_seen_height = f.h
     from (select proposer, min(height) as h from blocks group by proposer) f
     where f.proposer = v.address and v.first_seen_height is distinct from f.h`,
  );
  await db.update(syncState).set({ validatorsSyncedAt: now, chainHeight }).where(sql`${syncState.id} = 1`);
  log("validators synced", { set: members.length, profiles: profiles.length, matched: members.filter((m) => bySigning.has(m.address)).length });
}

/**
 * Mirror the users realm's address store. It holds each address's current
 * name; a deleted user keeps a row with a null name so lookups stay cached.
 */
async function syncNames(): Promise<void> {
  const size = await userCount(rpc);
  let named = 0;
  for (let i = 0; i < size && !stopping; i++) {
    const u = await userAt(rpc, i);
    if (!u) continue;
    const name = u.deleted ? null : u.name;
    if (name) named++;
    await db
      .insert(usernames)
      .values({ address: u.address, name, resolvedAt: new Date() })
      .onConflictDoUpdate({ target: usernames.address, set: { name, resolvedAt: new Date() } });
  }
  log("usernames synced", { size, named });
}

/** Packages still awaiting approval, per the VM's own inert list. */
async function syncPackageStatus(): Promise<void> {
  const inert = (await abciQuery(rpc, "vm/qinertpaths?limit=10000", "gno.land/")).split("\n").filter(Boolean);
  await pool.query(`update packages set status = 'live' where status = 'inert' and not (path = any($1))`, [inert]);
  const r = await pool.query(`update packages set status = 'inert' where status = 'live' and path = any($1)`, [inert]);
  if (r.rowCount) log("package status synced", { inert: inert.length, changed: r.rowCount });
}

/**
 * GRC20 metadata. Registered tokens answer through the registry's Token
 * object; tokens only seen in transfers are tried with the getters most
 * token realms export, and stay null when they have none.
 */
async function syncTokens(): Promise<void> {
  const listed = parseTokenRegistry(await qrender(rpc, GRC20_REGISTRY, ""));
  for (const t of listed) {
    await db
      .insert(tokens)
      .values({ key: t.key, realm: t.realm, symbol: t.symbol, standard: "grc20", registered: true, name: t.name })
      .onConflictDoUpdate({ target: tokens.key, set: { registered: true, name: t.name } });
  }
  const all = await db.select().from(tokens);
  const listedKeys = new Set(listed.map((t) => t.key));
  const tryEval = async (pkg: string, exprs: string[]) => {
    for (const e of exprs) {
      const v = await qeval(rpc, pkg, e).then(evalValue).catch(() => null);
      if (v !== null && v !== "") return v;
    }
    return null;
  };
  for (const t of all) {
    if (stopping) return;
    if (t.standard !== "grc20" || !isTokenKey(t.key)) continue;
    const [decimals, supply, name] = listedKeys.has(t.key)
      ? await Promise.all([
          tryEval(GRC20_REGISTRY, [`MustGet("${t.key}").GetDecimals()`]),
          tryEval(GRC20_REGISTRY, [`MustGet("${t.key}").TotalSupply()`]),
          Promise.resolve(t.name),
        ])
      : await Promise.all([
          tryEval(t.realm, ["Decimals()", "GetDecimals()"]),
          tryEval(t.realm, ["TotalSupply()", "GetTotalSupply()"]),
          tryEval(t.realm, ["Name()", "GetName()"]),
        ]);
    await db
      .update(tokens)
      .set({ decimals: decimals === null ? t.decimals : Number(decimals), totalSupply: supply ?? t.totalSupply, name: name ?? t.name, syncedAt: new Date() })
      .where(sql`${tokens.key} = ${t.key}`);
  }
  log("tokens synced", { registered: listed.length, known: all.length });
}

/** GovDAO proposals: list pages, then each proposal's page and votes page. */
async function syncProposals(): Promise<void> {
  const first = parseProposalList(await qrender(rpc, GOVDAO_REALM, ""));
  const list = [...first.proposals];
  for (let page = 2; page <= first.pages && !stopping; page++) {
    list.push(...parseProposalList(await qrender(rpc, GOVDAO_REALM, `?page=${page}`)).proposals);
  }
  const known = new Map((await db.select({ id: proposals.id, status: proposals.status }).from(proposals)).map((p) => [p.id, p.status]));
  let refreshed = 0;
  for (const p of list) {
    if (stopping) return;
    // Settled proposals do not change; only re-read open ones and new ones.
    if (known.get(p.id) && known.get(p.id) !== "ACTIVE" && known.get(p.id) === p.status) continue;
    const [detail, votes] = await Promise.all([qrender(rpc, GOVDAO_REALM, String(p.id)), qrender(rpc, GOVDAO_REALM, `${p.id}/votes`)]);
    const d = parseProposal(detail);
    const row = {
      id: p.id,
      title: p.title,
      author: p.author ?? d.author,
      status: p.status,
      tiers: p.tiers,
      yesPct: d.yesPct,
      noPct: d.noPct,
      abstainPct: d.abstainPct,
      executor: d.executor,
      body: d.body,
      votes: parseVotes(votes),
      syncedAt: new Date(),
    };
    const { id: _id, ...update } = row;
    await db.insert(proposals).values(row).onConflictDoUpdate({ target: proposals.id, set: update });
    refreshed++;
  }
  if (refreshed) log("proposals synced", { total: list.length, refreshed });
}

/** Run `fn` every `ms`, logging (not throwing) failures. */
async function every(name: string, ms: number, fn: () => Promise<void>): Promise<void> {
  while (!stopping) {
    try {
      await fn();
    } catch (err) {
      log(`${name} error`, { err: (err as Error).message });
    }
    await sleep(ms);
  }
}

async function main(): Promise<void> {
  const status = await rpc.call<any>("status", {});
  const network = status.node_info?.network;
  if (network !== CHAIN_ID) throw new Error(`RPC serves chain ${network}, expected ${CHAIN_ID}`);
  chainHeight = Number(status.sync_info.latest_block_height);

  await db.insert(syncState).values({ id: 1, chainId: network }).onConflictDoNothing();
  const { rows } = await pool.query<{ n: string | null }>(`select max(height) as n from blocks`);
  head = rows[0]?.n === null || rows[0]?.n === undefined ? null : Number(rows[0].n);
  log("indexer starting", { chainId: network, resumeFrom: head, rpc: rpc.active, txIndexer: txIndexer.url, signatureDepth: process.env.SIGNATURE_DEPTH ?? 100_000 });

  const progress = setInterval(() => {
    log("progress", { head, indexerHeight, chainHeight, lag: head === null ? null : indexerHeight - head, ...stats });
    stats.blocks = stats.txs = stats.signatures = 0;
  }, 30_000);

  await Promise.all([
    follow(),
    signatures(),
    every("validator sync", VALIDATOR_SYNC_MS, syncValidators),
    every("username sync", NAMES_SYNC_MS, syncNames),
    every("package status", 5 * 60_000, syncPackageStatus),
    every("token sync", 15 * 60_000, syncTokens),
    every("proposal sync", 2 * 60_000, syncProposals),
  ]);
  clearInterval(progress);
}

const shutdown = (sig: string) => {
  log("shutting down", { sig });
  stopping = true;
  setTimeout(() => void pool.end().finally(() => process.exit(0)), 3_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  log("fatal", { err: (err as Error).message });
  process.exit(1);
});
