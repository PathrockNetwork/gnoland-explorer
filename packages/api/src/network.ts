/**
 * Validator, analytics and network routes. gno.land has no staking: the
 * validator set is chosen by GovDAO proposals and every member carries a
 * fixed voting power. What distinguishes validators is therefore signing
 * (commit precommits, read for the newest SIGNATURE_DEPTH blocks) and block
 * proposals (every block from genesis), plus the operator profile they
 * registered in gno.land/r/gnops/valopers.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type pg from "pg";
import { JsonRpc, redactUrl, rpcUrlsFromEnv, indexerUrlFromEnv, type TxIndexer } from "@gnoland-explorer/core";
import { memoBy, resolveNames } from "./shared.js";

/** Signing windows reported per validator, in blocks. */
const WINDOWS = [100, 1_000, 10_000];

export function registerNetworkRoutes(app: FastifyInstance, { pool, rpc, txIndexer }: { pool: pg.Pool; rpc: JsonRpc; txIndexer: TxIndexer }): void {
  const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) => pool.query<T>(text, params);
  const notFound = (reply: FastifyReply, msg: string) => reply.code(404).send({ error: msg });

  /**
   * Missed blocks per validator over each window of the newest signed
   * blocks, plus the current missed streak. A window only counts blocks the
   * signature loop has read, and only those the validator was in the set for
   * (an absent row in missed_signatures with the block signed = it signed).
   */
  const signing = async () => {
    const top = await q(`select max(height) as h, count(*)::int as n from blocks where signed is not null`);
    const head = Number(top.rows[0]?.h ?? 0);
    const signedBlocks = top.rows[0]?.n ?? 0;
    const counts = await Promise.all(
      WINDOWS.map((w) => q(`select validator, count(*)::int as n from missed_signatures where height > $1 group by 1`, [head - w])),
    );
    // Current streak: consecutive newest signed blocks the validator missed.
    const recent = await q(`select height from blocks where signed is not null order by height desc limit 1000`);
    const recentMissed = await q(`select validator, height from missed_signatures where height >= $1`, [Number(recent.rows.at(-1)?.height ?? head)]);
    const missedAt = new Set(recentMissed.rows.map((r) => `${r.validator}:${r.height}`));
    const streak = new Map<string, number>();
    for (const v of new Set(recentMissed.rows.map((r) => r.validator as string))) {
      let n = 0;
      while (n < recent.rows.length && missedAt.has(`${v}:${recent.rows[n]!.height}`)) n++;
      streak.set(v, n);
    }
    const lastMissed = await q(`select validator, max(height) as h from missed_signatures group by 1`);
    return {
      head,
      signedBlocks,
      missed: WINDOWS.map((w, i) => ({ window: Math.min(w, signedBlocks), by: new Map(counts[i]!.rows.map((r) => [r.validator, r.n])) })),
      streak,
      lastMissed: new Map(lastMissed.rows.map((r) => [r.validator, Number(r.h)])),
    };
  };

  const validatorList = memoBy(10_000, async () => {
    const [vals, proposed, recent, window, sig, state] = await Promise.all([
      q(`select * from validators order by in_set desc, voting_power desc, moniker nulls last`),
      q(`select proposer, count(*)::int as n, max(height) as last_height, max(time) as last_time from blocks where height > 0 group by 1`),
      q(`select proposer, count(*)::int as n from (select proposer from blocks order by height desc limit 1000) r group by 1`),
      q(`select count(*)::int as blocks, min(time) as since from blocks where height > 0`),
      signing(),
      q(`select validators_synced_at, signature_floor from sync_state where id = 1`),
    ]);
    const propBy = new Map(proposed.rows.map((r) => [r.proposer, r]));
    const recentBy = new Map(recent.rows.map((r) => [r.proposer, r.n]));
    const totalPower = vals.rows.filter((v) => v.in_set).reduce((a, v) => a + Number(v.voting_power), 0);
    const names = await resolveNames(pool, vals.rows.map((v) => v.operator));
    return {
      total_power: totalPower,
      blocks_indexed: window.rows[0]?.blocks ?? 0,
      since: window.rows[0]?.since ?? null,
      signed_blocks: sig.signedBlocks,
      signature_head: sig.head || null,
      synced_at: state.rows[0]?.validators_synced_at ?? null,
      windows: sig.missed.map((m) => m.window),
      validators: vals.rows.map((v) => {
        const p = propBy.get(v.address);
        const missed = sig.missed.map((m) => (v.in_set || m.by.has(v.address) ? (m.by.get(v.address) ?? 0) : null));
        return {
          address: v.address,
          pub_key: v.pub_key,
          moniker: v.moniker,
          description: v.description,
          server_type: v.server_type,
          operator: v.operator,
          operator_name: v.operator ? (names[v.operator] ?? null) : null,
          in_set: v.in_set,
          voting_power: Number(v.voting_power),
          power_share: totalPower && v.in_set ? Number(v.voting_power) / totalPower : null,
          first_seen_height: v.first_seen_height === null ? null : Number(v.first_seen_height),
          blocks_proposed: p?.n ?? 0,
          proposed_share: window.rows[0]?.blocks ? (p?.n ?? 0) / window.rows[0].blocks : null,
          proposed_recent: recentBy.get(v.address) ?? 0,
          last_proposed_height: p ? Number(p.last_height) : null,
          last_proposed_time: p?.last_time ?? null,
          missed,
          uptime: missed.map((n, i) => (n === null || !sig.missed[i]!.window ? null : 1 - n / sig.missed[i]!.window)),
          missed_streak: v.in_set ? (sig.streak.get(v.address) ?? 0) : null,
          last_missed_height: sig.lastMissed.get(v.address) ?? null,
        };
      }),
    };
  });

  app.get("/api/v1/validators", async () => validatorList(""));

  app.get("/api/v1/validators/:address", async (req, reply) => {
    const address = String((req.params as any).address);
    const list = await validatorList("");
    const v = list.validators.find((x) => x.address === address || x.operator === address);
    if (!v) return notFound(reply, "validator not found");
    const [blocks, missed, perDay] = await Promise.all([
      q(`select height, time, tx_count from blocks where proposer = $1 order by height desc limit 25`, [v.address]),
      q(`select m.height, b.time from missed_signatures m join blocks b on b.height = m.height where m.validator = $1 order by m.height desc limit 50`, [v.address]),
      q(
        `select date_trunc('day', time) as day, count(*)::int as proposed from blocks where proposer = $1 and height > 0 group by 1 order by 1`,
        [v.address],
      ),
    ]);
    // Signing over the newest 200 read blocks, oldest first, for the uptime strip.
    const strip = await q(
      `select b.height, (m.validator is null) as signed from (select height from blocks where signed is not null order by height desc limit 200) b
       left join missed_signatures m on m.height = b.height and m.validator = $1 order by b.height`,
      [v.address],
    );
    return {
      validator: v,
      recent_blocks: blocks.rows.map((r) => ({ ...r, height: Number(r.height) })),
      missed_blocks: missed.rows.map((r) => ({ ...r, height: Number(r.height) })),
      proposed_per_day: perDay.rows,
      signing_strip: strip.rows.map((r) => ({ height: Number(r.height), signed: r.signed })),
    };
  });

  /** Validator-set history: each distinct set seen, with when it took effect. */
  app.get("/api/v1/validator-set", async () => {
    const { rows } = await q(
      `select b.validators_hash as hash, min(b.height) as from_height, max(b.height) as to_height, min(b.time) as since
       from blocks b where b.validators_hash is not null and b.height > 0 group by 1 order by 2 desc limit 50`,
    );
    const sets = await q(`select hash, members from validator_sets where hash = any($1)`, [rows.map((r) => r.hash)]);
    const members = new Map(sets.rows.map((s) => [s.hash, s.members]));
    const monikers = await q(`select address, moniker from validators`);
    const name = new Map(monikers.rows.map((m) => [m.address, m.moniker]));
    return {
      sets: rows.map((r) => ({
        hash: r.hash,
        from_height: Number(r.from_height),
        to_height: Number(r.to_height),
        since: r.since,
        members: ((members.get(r.hash) as any[]) ?? null)?.map((m) => ({ ...m, moniker: name.get(m.address) ?? null })) ?? null,
      })),
    };
  });

  /**
   * Analytics over a window: who uses gno.land. Top realms by calls, top
   * functions, top senders, message mix, deployments, gas and storage.
   */
  const analytics = memoBy(30_000, async (key) => {
    const hours = Number(key);
    const since = `now() - make_interval(hours => ${hours})`;
    const [realms, funcs, senders, kinds, gas, deploys, failures] = await Promise.all([
      q(
        `select p as path, count(*)::int as txs, count(distinct signer)::int as senders, count(*) filter (where not success)::int as failed,
                sum(gas_used)::float8 as gas, sum(fee)::float8 as fees
         from transactions, unnest(pkg_paths) p where time > ${since} group by 1 order by 2 desc limit 15`,
      ),
      q(`select f as func, count(*)::int as calls from transactions, unnest(funcs) f where time > ${since} group by 1 order by 2 desc limit 15`),
      q(
        `select signer as address, count(*)::int as txs, sum(fee)::float8 as fees from transactions
         where time > ${since} and signer is not null group by 1 order by 2 desc limit 15`,
      ),
      q(`select k as kind, count(*)::int as n from transactions, unnest(kinds) k where time > ${since} group by 1 order by 2 desc`),
      q(
        `select count(*)::int as txs, avg(gas_used)::float8 as avg_gas_used, avg(gas_wanted)::float8 as avg_gas_wanted,
                sum(gas_used)::float8 / nullif(sum(gas_wanted), 0) as gas_efficiency, sum(fee)::float8 as fees,
                percentile_cont(0.5) within group (order by fee::float8 / nullif(gas_wanted, 0)) as median_gas_price
         from transactions where time > ${since} and height > 0`,
      ),
      q(`select count(*)::int as n, count(*) filter (where kind = 'realm')::int as realms, count(distinct creator)::int as creators from packages where time > ${since}`),
      q(
        `select coalesce(nullif(split_part(error, ':', 1), ''), 'unknown') as error, count(*)::int as n from transactions
         where time > ${since} and not success group by 1 order by 2 desc limit 8`,
      ),
    ]);
    const names = await resolveNames(pool, senders.rows.map((s) => s.address));
    return {
      hours,
      realms: realms.rows,
      funcs: funcs.rows,
      senders: senders.rows.map((s) => ({ ...s, username: names[s.address] ?? null })),
      kinds: kinds.rows,
      gas: gas.rows[0] ?? null,
      deploys: deploys.rows[0] ?? null,
      failures: failures.rows,
    };
  });

  app.get("/api/v1/analytics", async (req) => {
    const hours = Math.min(24 * 365, Math.max(1, Number((req.query as any).hours) || 24));
    return analytics(String(hours));
  });

  /** Proposer distribution and block cadence over a window. */
  app.get("/api/v1/metrics", async (req) => {
    const hours = Math.min(24 * 90, Math.max(1, Number((req.query as any).hours) || 24));
    const [proposers, cadence] = await Promise.all([
      q(
        `select b.proposer, v.moniker, count(*)::int as blocks from blocks b left join validators v on v.address = b.proposer
         where b.time > now() - make_interval(hours => $1) group by 1, 2 order by 3 desc`,
        [hours],
      ),
      q(
        `select percentile_cont(array[0.5, 0.9, 0.99]) within group (order by dt) as p, avg(dt) as avg, max(dt) as max
         from (select extract(epoch from time - lag(time) over (order by height)) as dt from blocks
               where time > now() - make_interval(hours => $1) and height > 1) d where dt is not null`,
        [hours],
      ),
    ]);
    const c = cadence.rows[0] ?? {};
    return {
      hours,
      proposers: proposers.rows,
      block_time: { p50: c.p?.[0] ?? null, p90: c.p?.[1] ?? null, p99: c.p?.[2] ?? null, avg: c.avg === null ? null : Number(c.avg), max: c.max === null ? null : Number(c.max) },
    };
  });

  /**
   * Health of the data sources: each configured RPC endpoint (height, latency,
   * peers) and the tx-indexer. Probed directly, so a dead endpoint shows up
   * here even while the client has failed over away from it.
   */
  const endpoints = memoBy(15_000, async () => {
    const urls = rpcUrlsFromEnv();
    const rpcs = await Promise.all(
      urls.map(async (url) => {
        const started = Date.now();
        try {
          const call = async (method: string) => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
              signal: AbortSignal.timeout(8_000),
            });
            return ((await res.json()) as any).result;
          };
          const status = await call("status");
          const latency = Date.now() - started;
          const net = await call("net_info").catch(() => null);
          return {
            url: redactUrl(url),
            kind: "rpc",
            ok: true,
            latency_ms: latency,
            height: Number(status.sync_info.latest_block_height),
            block_time: status.sync_info.latest_block_time,
            catching_up: status.sync_info.catching_up,
            network: status.node_info.network,
            version: status.node_info.version,
            moniker: status.node_info.moniker,
            peers: net ? Number(net.n_peers) : null,
            error: null,
          };
        } catch (err) {
          return { url: redactUrl(url), kind: "rpc", ok: false, latency_ms: null, height: null, error: (err as Error).message };
        }
      }),
    );
    const started = Date.now();
    const idx = await txIndexer
      .latestHeight()
      .then((h) => ({ url: redactUrl(indexerUrlFromEnv()), kind: "tx-indexer", ok: true, latency_ms: Date.now() - started, height: h, error: null }))
      .catch((err) => ({ url: redactUrl(indexerUrlFromEnv()), kind: "tx-indexer", ok: false, latency_ms: null, height: null, error: (err as Error).message }));
    return { endpoints: [...rpcs, idx], client: rpc.status() };
  });

  app.get("/api/v1/endpoints", async () => endpoints(""));

  app.get("/api/v1/config", async () => ({
    chain_id: process.env.CHAIN_ID ?? "gnoland-1",
    denom: "ugnot",
    decimals: 6,
    symbol: "GNOT",
    rpc: rpcUrlsFromEnv().map(redactUrl),
    tx_indexer: redactUrl(indexerUrlFromEnv()),
    features: {
      signature_depth: process.env.SIGNATURE_DEPTH ?? "100000",
      signature_windows: WINDOWS,
      full_history: true,
    },
  }));
}
