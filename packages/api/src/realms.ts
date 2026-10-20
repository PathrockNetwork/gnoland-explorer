/**
 * gno.land-specific routes. Code lives on chain: every realm (`/r/`, stateful)
 * and pure package (`/p/`) is published by a MsgAddPackage, its source is
 * readable through `vm/qfile`, its exported functions through `vm/qfuncs`,
 * and a realm's `Render(path)` is the chain's own web view of its state.
 * Realm state costs a storage deposit, locked when bytes are written and
 * refunded when they are freed.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type pg from "pg";
import { AbciError, GOVDAO_REALM, GRC20_REGISTRY, JsonRpc, evalValue, isAddress, isTokenKey, isPkgPath, qeval, qfile, qfuncs, qrender } from "@gnoland-explorer/core";
import { memoBy, resolveNames } from "./shared.js";

const PAGE_MAX = 100;
const limitOf = (q: any, d = 25): number => Math.min(PAGE_MAX, Math.max(1, Number(q?.limit) || d));
/** Rendered markdown and source files are cut here; realms can render a lot. */
const MAX_TEXT = 512 * 1024;

const SORTS: Record<string, string> = {
  recent: "p.height desc",
  calls: "calls desc nulls last, p.height desc",
  storage: "storage_bytes desc nulls last, p.height desc",
  name: "p.path asc",
};

export function registerRealmRoutes(app: FastifyInstance, { pool, rpc }: { pool: pg.Pool; rpc: JsonRpc }): void {
  const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) => pool.query<T>(text, params);
  const bad = (reply: FastifyReply, msg: string) => reply.code(400).send({ error: msg });
  const pathOf = (reply: FastifyReply, raw: unknown): string | null => {
    const path = String(raw ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!isPkgPath(path)) {
      bad(reply, "path must be a package path such as gno.land/r/gnoland/home");
      return null;
    }
    return path;
  };
  /** ABCI "package not found" is a 404, anything else an upstream failure. */
  const abciFail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof AbciError) return reply.code(err.type?.includes("InvalidPkgPath") ? 404 : 422).send({ error: err.message, type: err.type });
    throw err;
  };

  /** Per-package activity and storage, from the transaction and event tables. */
  const activity = memoBy(30_000, async () => {
    const [calls, storage] = await Promise.all([
      q(
        `select p as path, count(*)::int as calls, count(*) filter (where time > now() - interval '24 hours')::int as calls_24h,
                count(distinct signer)::int as callers, max(time) as last_call
         from transactions, unnest(pkg_paths) p where not ('vm/add_package' = any(kinds)) group by 1`,
      ),
      q(
        `select pkg_path as path, sum(bytes_delta)::bigint as bytes,
                sum(case when kind = 'storage_deposit' then amount else -amount end)::text as deposit
         from events where kind in ('storage_deposit', 'storage_unlock') and pkg_path is not null group by 1`,
      ),
    ]);
    return {
      calls: new Map(calls.rows.map((r) => [r.path as string, r])),
      storage: new Map(storage.rows.map((r) => [r.path as string, { bytes: Number(r.bytes), deposit: r.deposit as string }])),
    };
  });

  const withActivity = async (rows: any[]) => {
    const a = await activity("");
    return rows.map((r) => {
      const c = a.calls.get(r.path);
      const s = a.storage.get(r.path);
      return {
        ...r,
        height: Number(r.height),
        calls: c?.calls ?? 0,
        calls_24h: c?.calls_24h ?? 0,
        callers: c?.callers ?? 0,
        last_call: c?.last_call ?? null,
        storage_bytes: s?.bytes ?? 0,
        storage_deposit: s?.deposit ?? "0",
      };
    });
  };

  /**
   * Package directory. Filters: kind (realm|pure), q (path substring),
   * creator, namespace (e.g. gno.land/r/gnoland). Sort: recent|calls|storage|name.
   */
  app.get("/api/v1/packages", async (req, reply) => {
    const query = req.query as any;
    const limit = limitOf(query, 50);
    const offset = Math.max(0, Number(query.offset) || 0);
    const sort = SORTS[String(query.sort ?? "recent")];
    if (!sort) return bad(reply, `sort must be one of ${Object.keys(SORTS).join(", ")}`);
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.kind === "realm" || query.kind === "pure") {
      params.push(query.kind);
      where.push(`p.kind = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${String(query.q).replace(/[%_\\]/g, "\\$&")}%`);
      where.push(`p.path ilike $${params.length}`);
    }
    if (query.creator) {
      params.push(String(query.creator));
      where.push(`p.creator = $${params.length}`);
    }
    if (query.namespace) {
      params.push(`${String(query.namespace).replace(/\/+$/, "")}/%`);
      where.push(`p.path like $${params.length}`);
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    // Activity is aggregated in memory, so sorting by it loads every match first.
    const needsActivity = sort.startsWith("calls") || sort.startsWith("storage");
    let rows: any[];
    let total: number;
    if (needsActivity) {
      const all = await q(`select p.path, p.name, p.kind, p.creator, p.height, p.tx_hash, p.time, p.source_bytes, p.status, jsonb_array_length(p.files) as file_count from packages p ${whereSql}`, params);
      const enriched = await withActivity(all.rows);
      const key = sort.startsWith("calls") ? "calls" : "storage_bytes";
      enriched.sort((x, y) => y[key] - x[key] || y.height - x.height);
      total = enriched.length;
      rows = enriched.slice(offset, offset + limit);
    } else {
      const [page, count] = await Promise.all([
        q(
          `select p.path, p.name, p.kind, p.creator, p.height, p.tx_hash, p.time, p.source_bytes, p.status, jsonb_array_length(p.files) as file_count
           from packages p ${whereSql} order by ${sort} limit ${limit} offset ${offset}`,
          params,
        ),
        q(`select count(*)::int as n from packages p ${whereSql}`, params),
      ]);
      rows = await withActivity(page.rows);
      total = count.rows[0]?.n ?? 0;
    }
    const totals = await q(
      `select count(*)::int as total, count(*) filter (where kind = 'realm')::int as realms, count(*) filter (where kind = 'pure')::int as pure,
              count(distinct creator)::int as creators, coalesce(sum(source_bytes), 0)::bigint as source_bytes from packages`,
    );
    const names = await resolveNames(pool, rows.map((r) => r.creator));
    return {
      total,
      offset,
      packages: rows.map((r) => ({ ...r, creator_name: names[r.creator] ?? null })),
      totals: { ...totals.rows[0], source_bytes: Number(totals.rows[0]?.source_bytes ?? 0) },
    };
  });

  /** Namespaces (gno.land/r/<ns>, gno.land/p/<ns>) with package counts. */
  app.get("/api/v1/namespaces", async () => {
    const { rows } = await q(
      `select split_part(path, '/', 2) as kind_letter, split_part(path, '/', 3) as namespace, count(*)::int as packages,
              min(time) as first_deploy, max(time) as last_deploy
       from packages group by 1, 2 order by 3 desc limit 200`,
    );
    const names = await q(`select address, name from usernames where name = any($1)`, [rows.map((r) => r.namespace)]);
    const owner = new Map(names.rows.map((n) => [n.name, n.address]));
    return { namespaces: rows.map((r) => ({ ...r, owner: owner.get(r.namespace) ?? (r.namespace.startsWith("g1") ? r.namespace : null) })) };
  });

  /** One package: metadata, activity, exported functions, children, top callers. */
  app.get("/api/v1/package", async (req, reply) => {
    const path = pathOf(reply, (req.query as any).path);
    if (!path) return;
    const { rows } = await q(`select * from packages where path = $1`, [path]);
    const meta = rows[0] ?? null;
    const [funcs, children, topFuncs, callers, eventTypes, storageSeries, daily, importedBy] = await Promise.all([
      qfuncs(rpc, path).catch((err) => (err instanceof AbciError ? null : Promise.reject(err))),
      q(`select path, kind from packages where path like $1 order by path limit 100`, [`${path}/%`]),
      q(`select f as func, count(*)::int as calls, max(time) as last_call from transactions, unnest(funcs) f where pkg_paths @> $1 and f like $2 group by 1 order by 2 desc limit 20`, [[path], `${path}.%`]),
      q(`select signer as address, count(*)::int as txs from transactions where pkg_paths @> $1 and signer is not null group by 1 order by 2 desc limit 10`, [[path]]),
      q(`select type, count(*)::int as n, max(time) as last from events where pkg_path = $1 and kind = 'gno' group by 1 order by 2 desc limit 20`, [path]),
      q(
        `select date_trunc('day', time) as day, sum(bytes_delta)::bigint as bytes from events
         where pkg_path = $1 and kind in ('storage_deposit', 'storage_unlock') group by 1 order by 1`,
        [path],
      ),
      q(`select date_trunc('day', time) as day, count(*)::int as txs from transactions where pkg_paths @> $1 group by 1 order by 1`, [[path]]),
      // Packages whose source we have seen import this one is not indexed; use
      // callers' realms instead: other packages in the same transactions.
      q(
        `select p as path, count(*)::int as n from transactions, unnest(pkg_paths) p
         where pkg_paths @> $1 and p <> $2 group by 1 order by 2 desc limit 10`,
        [[path], path],
      ),
    ]);
    if (!meta && funcs === null) return reply.code(404).send({ error: "package not found" });
    const [enriched] = meta ? await withActivity([meta]) : [null];
    const names = await resolveNames(pool, [meta?.creator, ...callers.rows.map((c) => c.address)]);
    let cumulative = 0;
    return {
      path,
      kind: meta?.kind ?? (path.includes("/r/") ? "realm" : "pure"),
      // Packages from the genesis set are on chain but only indexed from block 0.
      indexed: !!meta,
      package: enriched
        ? { ...enriched, creator_name: names[enriched.creator] ?? null, files: meta.files }
        : null,
      funcs,
      children: children.rows,
      top_funcs: topFuncs.rows.map((r) => ({ ...r, name: String(r.func).slice(path.length + 1) })),
      callers: callers.rows.map((c) => ({ ...c, username: names[c.address] ?? null })),
      event_types: eventTypes.rows,
      storage_series: storageSeries.rows.map((r) => ({ day: r.day, bytes: Number(r.bytes), total: (cumulative += Number(r.bytes)) })),
      daily_txs: daily.rows,
      co_called: importedBy.rows,
    };
  });

  const fileCache = memoBy(5 * 60_000, (key) => qfile(rpc, key), 300);
  const renderCache = memoBy(10_000, (key) => {
    const i = key.indexOf(":");
    return qrender(rpc, key.slice(0, i), key.slice(i + 1));
  }, 300);

  /** Source of one file (`name`), or the file list when `name` is omitted. */
  app.get("/api/v1/package/source", async (req, reply) => {
    const query = req.query as any;
    const path = pathOf(reply, query.path);
    if (!path) return;
    const name = query.name ? String(query.name) : null;
    if (name && !/^[\w.-]+$/.test(name)) return bad(reply, "invalid file name");
    try {
      if (!name) {
        const list = await fileCache(path);
        return { path, files: list.split("\n").filter(Boolean) };
      }
      const body = await fileCache(`${path}/${name}`);
      return { path, name, size: Buffer.byteLength(body), truncated: body.length > MAX_TEXT, body: body.slice(0, MAX_TEXT) };
    } catch (err) {
      return abciFail(reply, err);
    }
  });

  /** A realm's Render(args) markdown, as gnoweb shows it at gno.land/r/...:args. */
  app.get("/api/v1/package/render", async (req, reply) => {
    const query = req.query as any;
    const path = pathOf(reply, query.path);
    if (!path) return;
    const args = String(query.args ?? "");
    if (args.length > 512) return bad(reply, "render path too long");
    try {
      const md = await renderCache(`${path}:${args}`);
      return { path, args, truncated: md.length > MAX_TEXT, markdown: md.slice(0, MAX_TEXT) };
    } catch (err) {
      return abciFail(reply, err);
    }
  });

  /**
   * Storage: realm state is paid for with a deposit (100 ugnot per byte on
   * mainnet, as the events show), locked on write and refunded on free.
   */
  const storage = memoBy(60_000, async () => {
    const [totals, top, series, recent] = await Promise.all([
      q(
        `select coalesce(sum(bytes_delta), 0)::bigint as bytes,
                coalesce(sum(case when kind = 'storage_deposit' then amount else -amount end), 0)::text as deposit,
                count(*) filter (where kind = 'storage_deposit')::int as deposits, count(*) filter (where kind = 'storage_unlock')::int as unlocks,
                coalesce(sum(bytes_delta) filter (where time > now() - interval '24 hours'), 0)::bigint as bytes_24h
         from events where kind in ('storage_deposit', 'storage_unlock')`,
      ),
      q(
        `select pkg_path as path, sum(bytes_delta)::bigint as bytes,
                sum(case when kind = 'storage_deposit' then amount else -amount end)::text as deposit,
                count(*)::int as writes, max(time) as last_write
         from events where kind in ('storage_deposit', 'storage_unlock') and pkg_path is not null
         group by 1 order by 2 desc limit 25`,
      ),
      q(
        `select date_trunc('day', time) as day, sum(bytes_delta) filter (where bytes_delta > 0)::bigint as written,
                -coalesce(sum(bytes_delta) filter (where bytes_delta < 0), 0)::bigint as freed,
                sum(case when kind = 'storage_deposit' then amount else -amount end)::text as deposit
         from events where kind in ('storage_deposit', 'storage_unlock') group by 1 order by 1`,
      ),
      q(
        `select e.tx_hash, e.height, e.time, e.kind, e.pkg_path, e.bytes_delta, e.amount, t.signer
         from events e join transactions t on t.hash = e.tx_hash
         where e.kind in ('storage_deposit', 'storage_unlock') order by e.height desc, e.idx desc limit 25`,
      ),
    ]);
    const t = totals.rows[0] ?? {};
    let running = 0;
    return {
      bytes: Number(t.bytes ?? 0),
      deposit: t.deposit ?? "0",
      deposits: t.deposits ?? 0,
      unlocks: t.unlocks ?? 0,
      bytes_24h: Number(t.bytes_24h ?? 0),
      price_per_byte: Number(t.bytes) > 0 ? Number(t.deposit) / Number(t.bytes) : null,
      top: top.rows.map((r) => ({ ...r, bytes: Number(r.bytes) })),
      series: series.rows.map((r) => {
        const written = Number(r.written ?? 0);
        const freed = Number(r.freed ?? 0);
        running += written - freed;
        return { day: r.day, written, freed, total: running, deposit: r.deposit };
      }),
      recent: recent.rows.map((r) => ({ ...r, height: Number(r.height), bytes_delta: Number(r.bytes_delta) })),
      names: await resolveNames(pool, recent.rows.map((r) => r.signer)),
    };
  });

  app.get("/api/v1/storage", async () => storage(""));

  /** GnoVM events (chain.Emit). Filters: pkg, type. Cursor: before = "height:txhash:idx" not needed; height. */
  app.get("/api/v1/events", async (req) => {
    const query = req.query as any;
    const limit = limitOf(query, 50);
    const params: unknown[] = [limit];
    const where = [`kind = 'gno'`];
    if (query.pkg) {
      params.push(String(query.pkg));
      where.push(`pkg_path = $${params.length}`);
    }
    if (query.type) {
      params.push(String(query.type));
      where.push(`type = $${params.length}`);
    }
    if (query.before) {
      params.push(Number(query.before));
      where.push(`height < $${params.length}`);
    }
    const [rows, types] = await Promise.all([
      q(`select tx_hash, idx, height, time, pkg_path, type, attrs from events where ${where.join(" and ")} order by height desc, idx desc limit $1`, params),
      q(`select pkg_path, type, count(*)::int as n from events where kind = 'gno' and time > now() - interval '7 days' group by 1, 2 order by 3 desc limit 20`),
    ]);
    return { events: rows.rows.map((r) => ({ ...r, height: Number(r.height) })), top_types_7d: types.rows };
  });

  /* ── GovDAO ─────────────────────────────────────────────────────────── */

  /**
   * Proposals mirrored from gno.land/r/gov/dao, with the vote transactions
   * (MustVoteOnProposal*) found in the index and the member list.
   */
  const govdao = memoBy(30_000, async () => {
    const [props, voteTxs, members] = await Promise.all([
      q(`select id, title, author, status, tiers, yes_pct, no_pct, abstain_pct, executor, votes, synced_at from proposals order by id desc`),
      q(
        // Members often act through MsgRun scripts (create + vote in one go);
        // those are found by the script importing the DAO realm.
        `select hash, height, time, signer, success, messages->0->'value'->'args' as args, funcs[1] as func,
                ('vm/run' = any(kinds)) as script
         from transactions
         where pkg_paths @> $1 and (exists (select 1 from unnest(funcs) f where f like $2) or 'vm/run' = any(kinds))
         order by height desc limit 200`,
        [[GOVDAO_REALM], `${GOVDAO_REALM}.%Vote%`],
      ),
      qrender(rpc, "gno.land/r/gov/dao/memberstore/v0", "members").catch(() => ""),
    ]);
    const memberRows = [...members.matchAll(/\|[^|]*\b(T\d)\s*\|\s*(g1[0-9a-z]{38})\s*\|/g)].map((m) => ({ tier: m[1]!, address: m[2]! }));
    const names = await resolveNames(pool, [...memberRows.map((m) => m.address), ...voteTxs.rows.map((v) => v.signer)]);
    return {
      proposals: props.rows,
      members: memberRows.map((m) => ({ ...m, username: names[m.address] ?? null })),
      votes: voteTxs.rows.map((v) => ({
        hash: v.hash,
        height: Number(v.height),
        time: v.time,
        voter: v.signer,
        voter_name: names[v.signer] ?? null,
        success: v.success,
        via: v.script ? "script" : "call",
        proposal: !v.script && Array.isArray(v.args) ? Number(v.args[0]) : null,
        option: !v.script && Array.isArray(v.args) ? (v.args[1] ?? null) : null,
      })),
    };
  });

  app.get("/api/v1/govdao", async () => govdao(""));

  app.get("/api/v1/govdao/:id", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id) || id < 0) return bad(reply, "proposal id must be a number");
    const { rows } = await q(`select * from proposals where id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: "proposal not found" });
    const all = await govdao("");
    return { proposal: rows[0], vote_txs: all.votes.filter((v) => v.proposal === id) };
  });

  /* ── tokens ─────────────────────────────────────────────────────────── */

  const tokenList = memoBy(60_000, async () => {
    const { rows } = await q(
      `select t.key, t.realm, t.symbol, t.standard, t.registered, t.name, t.decimals, t.total_supply,
              coalesce(s.transfers, 0)::int as transfers, coalesce(s.transfers_24h, 0)::int as transfers_24h,
              coalesce(s.holders, 0)::int as receivers, s.last_transfer
       from tokens t left join (
         select token, count(*) as transfers, count(*) filter (where time > now() - interval '24 hours') as transfers_24h,
                count(distinct "to") as holders, max(time) as last_transfer
         from token_transfers group by 1) s on s.token = t.key
       order by transfers desc nulls last, t.key`,
    );
    return { tokens: rows };
  });

  app.get("/api/v1/tokens", async () => tokenList(""));

  app.get("/api/v1/token", async (req, reply) => {
    const key = String((req.query as any).key ?? "");
    const { rows } = await q(`select * from tokens where key = $1`, [key]);
    if (!rows[0]) return reply.code(404).send({ error: "token not found" });
    const [transfers, top, daily] = await Promise.all([
      q(`select tx_hash, idx, height, time, "from", "to", value from token_transfers where token = $1 order by height desc, idx desc limit 50`, [key]),
      q(
        `select "to" as address, count(*)::int as received from token_transfers where token = $1 and "to" is not null
         group by 1 order by 2 desc limit 10`,
        [key],
      ),
      q(`select date_trunc('day', time) as day, count(*)::int as transfers from token_transfers where token = $1 group by 1 order by 1`, [key]),
    ]);
    const stats = (await tokenList("")).tokens.find((t: any) => t.key === key);
    const names = await resolveNames(pool, [...transfers.rows.flatMap((t) => [t.from, t.to]), ...top.rows.map((t) => t.address)]);
    return {
      token: { ...rows[0], ...stats },
      transfers: transfers.rows.map((t) => ({ ...t, height: Number(t.height) })),
      top_receivers: top.rows,
      daily: daily.rows,
      names,
    };
  });

  /**
   * GRC20 balances of an address: every token it has sent or received,
   * read live. Registered tokens go through the registry; others through
   * the token realm's own BalanceOf.
   */
  app.get("/api/v1/address/:addr/tokens", async (req, reply) => {
    const addr = String((req.params as any).addr);
    if (!isAddress(addr)) return bad(reply, "invalid address");
    const [touched, transfers] = await Promise.all([
      q(
        `select distinct t.key, t.realm, t.symbol, t.standard, t.registered, t.name, t.decimals
         from token_transfers x join tokens t on t.key = x.token where x."from" = $1 or x."to" = $1 limit 60`,
        [addr],
      ),
      q(
        `(select tx_hash, idx, height, time, token, standard, "from", "to", value from token_transfers where "from" = $1 order by height desc limit 50)
         union all
         (select tx_hash, idx, height, time, token, standard, "from", "to", value from token_transfers where "to" = $1 order by height desc limit 50)
         order by height desc limit 50`,
        [addr],
      ),
    ]);
    const balances = await Promise.all(
      touched.rows.map(async (t) => {
        if (t.standard !== "grc20" || !isTokenKey(t.key)) return { ...t, balance: null };
        const out = t.registered
          ? await qeval(rpc, GRC20_REGISTRY, `MustGet("${t.key}").BalanceOf("${addr}")`).catch(() => null)
          : await qeval(rpc, t.realm, `BalanceOf("${addr}")`).catch(() => null);
        return { ...t, balance: out ? evalValue(out) : null };
      }),
    );
    return { address: addr, tokens: balances, transfers: transfers.rows.map((t) => ({ ...t, height: Number(t.height) })) };
  });
}
