/**
 * Chain routes: stats, blocks, transactions, accounts and search. Everything
 * indexed lives in Postgres from genesis; the tx-indexer answers for anything
 * newer than the indexed head, and the RPC for live account state.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type pg from "pg";
import {
  JsonRpc,
  TxIndexer,
  account,
  balances,
  isAddress,
  isHash,
  isPkgPath,
  normalizeHash,
  parseBlock,
  parseTx,
  type ParsedTx,
} from "@gnoland-explorer/core";
import { memo, resolveNames } from "./shared.js";

export type Deps = { pool: pg.Pool; rpc: JsonRpc; txIndexer: TxIndexer };

const PAGE_MAX = 100;
const PAGE_DEFAULT = 25;

const limitOf = (q: any): number => Math.min(PAGE_MAX, Math.max(1, Number(q?.limit) || PAGE_DEFAULT));
const bad = (reply: FastifyReply, msg: string) => reply.code(400).send({ error: msg });

/** Blocks joined with their proposer's valoper moniker. */
const BLOCK_SELECT = `select b.height, b.hash, b.time, b.proposer, b.tx_count, b.total_txs, b.app_hash, b.signed, b.missed,
  v.moniker as proposer_moniker
  from blocks b left join validators v on v.address = b.proposer`;
const TX_COLS = `hash, height, tx_index, time, success, signer, gas_wanted, gas_used, fee, fee_denom, memo, kinds,
  pkg_paths, funcs, messages, error, storage_delta`;

const fixBlock = (r: any) => ({ ...r, height: Number(r.height), total_txs: Number(r.total_txs) });
const fixTx = (r: any) => ({ ...r, height: Number(r.height), gas_wanted: Number(r.gas_wanted), gas_used: Number(r.gas_used), storage_delta: Number(r.storage_delta) });

/** A tx-indexer transaction shaped like a `transactions` row. */
function txJson(p: ParsedTx) {
  const t = p.tx;
  return {
    hash: t.hash,
    height: t.height,
    tx_index: t.txIndex,
    time: t.time.toISOString(),
    success: t.success,
    signer: t.signer,
    gas_wanted: t.gasWanted,
    gas_used: t.gasUsed,
    fee: t.fee,
    fee_denom: t.feeDenom,
    memo: t.memo,
    kinds: t.kinds,
    pkg_paths: t.pkgPaths,
    funcs: t.funcs,
    messages: t.messages,
    error: t.error,
    storage_delta: t.storageDelta,
  };
}

const eventJson = (e: ParsedTx["events"][number]) => ({
  idx: e.idx,
  kind: e.kind,
  pkg_path: e.pkgPath,
  type: e.type,
  attrs: e.attrs,
  from: e.from,
  to: e.to,
  amount: e.amount,
  denom: e.denom,
  bytes_delta: e.bytesDelta,
});

export function registerRoutes(app: FastifyInstance, { pool, rpc, txIndexer }: Deps): void {
  const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) => pool.query<T>(text, params);

  const supply = memo(60_000, () => txIndexer.supply("ugnot"));

  const stats = memo(2_000, async () => {
    const [state, recent, day, totals, vals, cadence, pkgs, uptime] = await Promise.all([
      q(`select chain_id, head_height, chain_height, indexer_height, signature_floor, active_rpc, updated_at, validators_synced_at from sync_state where id = 1`),
      q(`select count(*)::int as blocks, coalesce(sum(tx_count), 0)::int as txs,
                extract(epoch from max(time) - min(time)) as span
         from (select time, tx_count from blocks order by height desc limit 1000) r`),
      q(`select count(*)::int as blocks, coalesce(sum(tx_count), 0)::int as txs from blocks where time > now() - interval '24 hours'`),
      q(`select (select total_txs from blocks order by height desc limit 1) as total_txs,
                (select min(time) from blocks where height > 0) as genesis_time,
                (select count(distinct signer) from transactions where time > now() - interval '24 hours') as active_accounts_24h`),
      q(`select count(*) filter (where in_set)::int as active, count(*)::int as profiles,
                coalesce(sum(voting_power) filter (where in_set), 0)::bigint as power from validators`),
      // Per-minute cadence for the last 30 minutes (the overview sparkline).
      q(`select to_timestamp(floor(extract(epoch from time) / 60) * 60) as t, count(*)::int as blocks, sum(tx_count)::int as txs
         from blocks where time > now() - interval '30 minutes' group by 1 order by 1`),
      q(`select count(*)::int as total, count(*) filter (where kind = 'realm')::int as realms,
                count(*) filter (where kind = 'pure')::int as pure,
                count(*) filter (where time > now() - interval '24 hours')::int as deployed_24h from packages`),
      // Network signing rate over the newest 1,000 signed blocks.
      q(`select coalesce(sum(signed), 0)::int as signed, coalesce(sum(signed + missed), 0)::int as expected
         from (select signed, missed from blocks where signed is not null order by height desc limit 1000) r`),
    ]);
    const s = state.rows[0] ?? {};
    const r = recent.rows[0];
    const span = Number(r?.span) || 0;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const head = num(s.head_height);
    const chain = num(s.chain_height);
    const u = uptime.rows[0];
    return {
      chain_id: s.chain_id ?? "gnoland-1",
      indexed_head: head,
      chain_height: chain,
      indexer_height: num(s.indexer_height),
      lag_blocks: head !== null && chain !== null ? Math.max(0, chain - head) : null,
      indexer_updated_at: s.updated_at ?? null,
      signature_floor: num(s.signature_floor),
      avg_block_time_ms: r && r.blocks > 1 && span ? Math.round((span * 1000) / (r.blocks - 1)) : null,
      tps: r && span ? Number((r.txs / span).toFixed(3)) : null,
      blocks_24h: day.rows[0]?.blocks ?? 0,
      txs_24h: day.rows[0]?.txs ?? 0,
      total_txs: num(totals.rows[0]?.total_txs),
      genesis_time: totals.rows[0]?.genesis_time ?? null,
      active_accounts_24h: num(totals.rows[0]?.active_accounts_24h),
      validators_active: vals.rows[0]?.active ?? 0,
      valoper_profiles: vals.rows[0]?.profiles ?? 0,
      voting_power: num(vals.rows[0]?.power) ?? 0,
      signing_rate: u?.expected ? u.signed / u.expected : null,
      packages: pkgs.rows[0] ?? null,
      supply: await supply().catch(() => null),
      recent_minutes: cadence.rows,
      rpc: rpc.status(),
    };
  });

  app.get("/health", async () => {
    await q("select 1");
    return { ok: true };
  });

  app.get("/api/v1/stats", async () => stats());

  /** Blocks, transactions and gas per time bucket over the last N hours. */
  app.get("/api/v1/series", async (req) => {
    const hours = Math.min(24 * 90, Math.max(1, Number((req.query as any).hours) || 24));
    const bucketSecs = hours <= 1 ? 60 : hours <= 6 ? 300 : hours <= 24 ? 900 : hours <= 24 * 7 ? 3600 : 86_400;
    const [b, t] = await Promise.all([
      q(
        `select to_timestamp(floor(extract(epoch from time) / $2) * $2) as t, count(*)::int as blocks, sum(tx_count)::int as txs,
                avg(missed)::float8 as avg_missed
         from blocks where time > now() - make_interval(hours => $1) group by 1 order by 1`,
        [hours, bucketSecs],
      ),
      q(
        `select to_timestamp(floor(extract(epoch from time) / $2) * $2) as t, sum(gas_used)::float8 as gas, sum(fee)::float8 as fees,
                count(*) filter (where not success)::int as failed, count(distinct signer)::int as senders,
                count(*) filter (where 'vm/add_package' = any(kinds))::int as deploys,
                count(*) filter (where 'vm/exec' = any(kinds))::int as calls,
                count(*) filter (where 'bank/send' = any(kinds))::int as sends,
                count(*) filter (where 'vm/run' = any(kinds))::int as runs,
                sum(storage_delta)::float8 as storage_delta
         from transactions where time > now() - make_interval(hours => $1) group by 1 order by 1`,
        [hours, bucketSecs],
      ),
    ]);
    const byT = new Map(t.rows.map((r) => [new Date(r.t).getTime(), r]));
    return {
      hours,
      bucket_secs: bucketSecs,
      points: b.rows.map((r) => {
        const x = byT.get(new Date(r.t).getTime());
        return {
          t: r.t,
          blocks: r.blocks,
          txs: r.txs ?? 0,
          avg_missed: r.avg_missed,
          gas: x?.gas ?? 0,
          fees: x?.fees ?? 0,
          failed: x?.failed ?? 0,
          senders: x?.senders ?? 0,
          deploys: x?.deploys ?? 0,
          calls: x?.calls ?? 0,
          sends: x?.sends ?? 0,
          runs: x?.runs ?? 0,
          storage_delta: x?.storage_delta ?? 0,
        };
      }),
    };
  });

  app.get("/api/v1/blocks", async (req) => {
    const query = req.query as any;
    const limit = limitOf(query);
    const before = query.before !== undefined && query.before !== "" ? Number(query.before) : null;
    const withTxs = query.with_txs === "1" || query.with_txs === "true";
    const where = [before !== null ? `b.height < $2` : null, withTxs ? `b.tx_count > 0` : null].filter(Boolean);
    const { rows } = await q(
      `${BLOCK_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by b.height desc limit $1`,
      before !== null ? [limit, before] : [limit],
    );
    return { source: "db", blocks: rows.map(fixBlock) };
  });

  app.get("/api/v1/blocks/:id", async (req, reply) => {
    const id = String((req.params as any).id);
    const isNum = /^\d+$/.test(id);
    if (!isNum && !isHash(id)) return bad(reply, "block id must be a height or a block hash");
    const key = isNum ? Number(id) : normalizeHash(id);
    const { rows } = await q(`${BLOCK_SELECT} where ${isNum ? "b.height" : "b.hash"} = $1`, [key]);
    if (rows[0]) {
      const height = Number(rows[0].height);
      const [txs, missed] = await Promise.all([
        q(`select ${TX_COLS} from transactions where height = $1 order by tx_index`, [height]),
        q(`select m.validator, v.moniker from missed_signatures m left join validators v on v.address = m.validator where m.height = $1`, [height]),
      ]);
      const names = await resolveNames(pool, [rows[0].proposer, ...txs.rows.map((t) => t.signer)]);
      return { source: "db", block: fixBlock(rows[0]), txs: txs.rows.map(fixTx), missed: missed.rows, names };
    }
    if (!isNum) return reply.code(404).send({ error: "block not found" });
    // Newer than the indexed head: ask the tx-indexer directly.
    const [raw] = await txIndexer.blocks(key as number, key as number);
    if (!raw) return reply.code(404).send({ error: "block not found" });
    const b = parseBlock(raw);
    const txs = (await txIndexer.txs(b.height, b.height)).map((t) => txJson(parseTx(t, b.time)));
    return {
      source: "indexer",
      block: { height: b.height, hash: b.hash, time: b.time.toISOString(), proposer: b.proposer, tx_count: b.txCount, total_txs: b.totalTxs, app_hash: b.appHash, signed: null, missed: null, proposer_moniker: null },
      txs,
      missed: [],
      names: await resolveNames(pool, [b.proposer]),
    };
  });

  /**
   * Transaction feed. Filters: address (any role), realm/package path (called,
   * deployed or run), kind (vm/exec, vm/add_package, vm/run, bank/send), func,
   * failed=1. Cursor `before` = "height:index" of the previous page's last row.
   */
  app.get("/api/v1/txs", async (req, reply) => {
    const query = req.query as any;
    const limit = limitOf(query);
    const params: unknown[] = [limit];
    const where: string[] = [];
    if (query.address) {
      const a = String(query.address);
      if (!isAddress(a)) return bad(reply, "invalid address");
      params.push([a]);
      where.push(`addresses @> $${params.length}`);
    }
    if (query.pkg) {
      const p = String(query.pkg);
      if (!isPkgPath(p)) return bad(reply, "invalid package path");
      params.push([p]);
      where.push(`pkg_paths @> $${params.length}`);
    }
    if (query.kind) {
      params.push([String(query.kind)]);
      where.push(`kinds @> $${params.length}`);
    }
    if (query.func) {
      params.push([String(query.func)]);
      where.push(`funcs @> $${params.length}`);
    }
    if (query.failed === "1" || query.failed === "true") where.push(`not success`);
    if (query.before) {
      const [h, i] = String(query.before).split(":").map(Number);
      if (Number.isFinite(h)) {
        params.push(Math.trunc(h!), Math.trunc(i ?? 0));
        where.push(`(height, tx_index) < ($${params.length - 1}, $${params.length})`);
      }
    }
    const { rows } = await q(
      `select ${TX_COLS} from transactions ${where.length ? `where ${where.join(" and ")}` : ""} order by height desc, tx_index desc limit $1`,
      params,
    );
    const names = await resolveNames(pool, rows.map((r) => r.signer));
    return { source: "db", txs: rows.map(fixTx), names };
  });

  app.get("/api/v1/txs/:hash", async (req, reply) => {
    const raw = String((req.params as any).hash);
    if (!isHash(raw)) return bad(reply, "invalid transaction hash");
    const hash = normalizeHash(raw);
    const { rows } = await q(`select ${TX_COLS}, addresses, log from transactions where hash = $1`, [hash]);
    let tx: any;
    let evs: any[];
    let transfers: any[];
    let source = "db";
    if (rows[0]) {
      tx = fixTx(rows[0]);
      const e = await q(
        `select idx, kind, pkg_path, type, attrs, "from", "to", amount, denom, bytes_delta from events where tx_hash = $1 order by idx`,
        [hash],
      );
      evs = e.rows.map((r) => ({ ...r, bytes_delta: r.bytes_delta === null ? null : Number(r.bytes_delta) }));
      const t = await q(`select idx, token, standard, "from", "to", value from token_transfers where tx_hash = $1 order by idx`, [hash]);
      transfers = t.rows;
    } else {
      const t = await txIndexer.tx(hash);
      if (!t) return reply.code(404).send({ error: "transaction not found" });
      const [b] = await txIndexer.blocks(t.block_height, t.block_height);
      const p = parseTx(t, b ? new Date(b.time) : new Date(0));
      tx = { ...txJson(p), addresses: p.tx.addresses, log: p.tx.log };
      evs = p.events.map(eventJson);
      transfers = p.transfers.map((t) => ({ idx: t.idx, token: t.token, standard: t.standard, from: t.from, to: t.to, value: t.value }));
      source = "indexer";
    }
    // Token metadata so amounts can be shown with their decimals.
    if (transfers.length) {
      const meta = await q(`select key, symbol, name, decimals from tokens where key = any($1)`, [[...new Set(transfers.map((t) => t.token))]]);
      const byKey = new Map(meta.rows.map((m) => [m.key, m]));
      transfers = transfers.map((t) => ({ ...t, symbol: byKey.get(t.token)?.symbol ?? null, decimals: byKey.get(t.token)?.decimals ?? null }));
    }
    const s = await stats().catch(() => null);
    const names = await resolveNames(pool, tx.addresses ?? []);
    return {
      source,
      tx: { ...tx, confirmations: s?.chain_height ? Math.max(0, s.chain_height - tx.height) : null },
      events: evs,
      token_transfers: transfers,
      names,
    };
  });

  /** Account: live balance and sequence from RPC, history counts from the index. */
  app.get("/api/v1/address/:addr", async (req, reply) => {
    const addr = String((req.params as any).addr);
    if (!isAddress(addr)) return bad(reply, "invalid address");
    const [coins, acct, counts, deployed, validator, storage] = await Promise.all([
      balances(rpc, addr).catch(() => null),
      account(rpc, addr).catch(() => null),
      q(
        `select count(*)::int as txs, count(*) filter (where signer = $2)::int as sent,
                min(time) as first_seen, max(time) as last_seen
         from transactions where addresses @> $1`,
        [[addr], addr],
      ),
      q(`select path, kind, height, time from packages where creator = $1 order by height desc limit 200`, [addr]),
      q(
        `select v.address, v.moniker, v.in_set, v.voting_power, (v.operator = $1) as is_operator,
                (select count(*)::int from blocks where proposer = v.address) as blocks_proposed
         from validators v where v.address = $1 or v.operator = $1 limit 1`,
        [addr],
      ),
      q(
        `select coalesce(sum(storage_delta), 0)::bigint as bytes from transactions where signer = $1`,
        [addr],
      ),
    ]);
    const names = await resolveNames(pool, [addr]);
    const c = counts.rows[0] ?? {};
    return {
      address: addr,
      username: names[addr] ?? null,
      balances: coins,
      ugnot: coins?.find((x) => x.denom === "ugnot")?.amount ?? (coins ? "0" : null),
      account_number: acct?.account_number ?? null,
      sequence: acct?.sequence ?? null,
      public_key: acct?.public_key ?? null,
      txs: c.txs ?? 0,
      sent: c.sent ?? 0,
      first_seen: c.first_seen ?? null,
      last_seen: c.last_seen ?? null,
      storage_bytes: Number(storage.rows[0]?.bytes ?? 0),
      packages: deployed.rows.map((r) => ({ ...r, height: Number(r.height) })),
      validator: validator.rows[0]
        ? {
            address: validator.rows[0].address,
            moniker: validator.rows[0].moniker,
            in_set: validator.rows[0].in_set,
            voting_power: Number(validator.rows[0].voting_power),
            role: validator.rows[0].is_operator ? "operator" : "signer",
            blocks_proposed: validator.rows[0].blocks_proposed,
          }
        : null,
    };
  });

  /** Resolve free text: height, hash, address, @username or package path. */
  app.get("/api/v1/search", async (req, reply) => {
    const raw = String((req.query as any).q ?? "").trim();
    if (/^\d+$/.test(raw)) return { type: "block", id: raw };
    if (isAddress(raw)) return { type: "address", id: raw };
    // Accept gnoweb URLs and short forms: https://gno.land/r/foo:bar → gno.land/r/foo.
    const path = raw
      .replace(/^https?:\/\//, "")
      .replace(/^\/?(?=[rpe]\/)/, "gno.land/")
      .replace(/[$:?#].*$/, "")
      .replace(/\/+$/, "");
    // A valid path is a package page even before it is indexed (or if it
    // never will be, like inert code); the page itself reports a 404.
    if (isPkgPath(path)) return { type: "package", id: path };
    if (isHash(raw)) {
      const h = normalizeHash(raw);
      const { rows } = await q(
        `select 'tx' as type, hash as id from transactions where hash = $1
         union all select 'block', height::text from blocks where hash = $1 limit 1`,
        [h],
      );
      if (rows[0]) return { type: rows[0].type, id: rows[0].id };
      const t = await txIndexer.tx(h).catch(() => null);
      if (t) return { type: "tx", id: h };
      return reply.code(404).send({ error: "no transaction or block with that hash" });
    }
    const name = raw.replace(/^@/, "").toLowerCase();
    if (/^[a-z][a-z0-9_]{2,}$/.test(name)) {
      const { rows } = await q(`select address from usernames where lower(name) = $1 limit 1`, [name]);
      if (rows[0]) return { type: "address", id: rows[0].address };
      const { rows: pkg } = await q(`select path from packages where path ilike $1 order by length(path) limit 1`, [`%/${name}%`]);
      if (pkg[0]) return { type: "package", id: pkg[0].path };
    }
    return bad(reply, "enter a block height, transaction or block hash, address, @username or package path");
  });
}
