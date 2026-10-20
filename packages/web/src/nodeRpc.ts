/**
 * Direct browser → gno.land Tendermint2 JSON-RPC requests. No explorer server
 * in the middle, so answers are independent of our indexer and API.
 * rpc.gno.land sends `Access-Control-Allow-Origin: *` (preflight included); a
 * custom endpoint that doesn't (or an http endpoint loaded from the https
 * site) is blocked by the browser, which is reported honestly rather than as
 * "down". TM2 params are NAMED objects with string-encoded integers.
 */

/** Shared error model for every direct-RPC call. */
export type RpcResult<T> =
  | { state: "ok"; latencyMs: number; data: T }
  | { state: "blocked" | "error"; latencyMs: number; error: string; data?: unknown };

export type RpcParams = Record<string, string>;
export type JsonRpcRequest = { method: string; params: RpcParams };
type Envelope = { jsonrpc?: string; id?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } };

let nextId = 1;
export const requestBody = (method: string, params: RpcParams) => ({ jsonrpc: "2.0", id: nextId++, method, params });

const num = (v: unknown): number | null => typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "number" ? v : null;

/**
 * One POST. A TimeoutError is a timeout; any other throw is the browser
 * blocking the request (CORS, mixed content and unreachable hosts all throw
 * the same TypeError by design).
 */
async function post(url: string, body: unknown, timeoutMs: number): Promise<RpcResult<unknown>> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }
    if (r.status === 429) return { state: "error", latencyMs: ms(), error: "HTTP 429 · rate limited", data: json };
    if (!r.ok && json === undefined) return { state: "error", latencyMs: ms(), error: `HTTP ${r.status}` };
    if (json === undefined) return { state: "error", latencyMs: ms(), error: "response was not JSON" };
    return { state: "ok", latencyMs: ms(), data: json };
  } catch (e) {
    if ((e as DOMException)?.name === "TimeoutError") return { state: "error", latencyMs: ms(), error: `no answer in ${ms()} ms (timeout)` };
    return { state: "blocked", latencyMs: ms(), error: "browser blocked the request (no CORS headers, unreachable host, or an http endpoint on the https site)" };
  }
}

/** One raw call for the RPC console: the full JSON-RPC envelope as-is, with the node's own error surfaced. */
export async function rpcCallRaw(url: string, method: string, params: RpcParams, timeoutMs = 30_000): Promise<RpcResult<unknown>> {
  const r = await post(url, requestBody(method, params), timeoutMs);
  if (r.state !== "ok") return r;
  const err = (r.data as Envelope | null)?.error;
  if (err) {
    const detail = err.data === undefined ? "" : `: ${typeof err.data === "string" ? err.data : JSON.stringify(err.data)}`;
    return { state: "error", latencyMs: r.latencyMs, error: `${err.code ?? ""} ${err.message ?? "node returned an error"}${detail}`.trim(), data: r.data };
  }
  return r;
}

/** A JSON-RPC batch; each item's result or null. */
export async function rpcBatch(url: string, calls: JsonRpcRequest[], timeoutMs = 8_000): Promise<RpcResult<(unknown | null)[]>> {
  const bodies = calls.map(c => requestBody(c.method, c.params));
  const r = await post(url, bodies, timeoutMs);
  if (r.state !== "ok") return r;
  if (!Array.isArray(r.data)) {
    const err = (r.data as Envelope | null)?.error;
    return { state: "error", latencyMs: r.latencyMs, error: err?.message ?? "endpoint did not answer the batch", data: r.data };
  }
  const byId = new Map((r.data as Envelope[]).map(e => [e?.id, e]));
  return { state: "ok", latencyMs: r.latencyMs, data: bodies.map(b => { const e = byId.get(b.id); return e && !e.error ? e.result ?? null : null; }) };
}

export type NodeProbe = {
  state: "ok" | "blocked" | "error";
  latencyMs: number;
  network?: string | null;
  moniker?: string | null;
  version?: string | null;
  latest?: number | null;
  latestTime?: string | null;
  appHash?: string | null;
  catchingUp?: boolean | null;
  txIndex?: string | null;
  mempool?: number | null;
  validators?: number | null;
  votingPower?: number | null;
  maxGas?: number | null;
  error?: string;
};

/** Identity, head, mempool and validator set of an endpoint in one batch. */
export async function probeNode(url: string): Promise<NodeProbe> {
  const r = await rpcBatch(url, [
    { method: "status", params: {} },
    { method: "num_unconfirmed_txs", params: {} },
    { method: "validators", params: {} },
    { method: "consensus_params", params: {} },
  ]);
  if (r.state !== "ok") return { state: r.state, latencyMs: r.latencyMs, error: r.error };
  const [status, mempool, vals, cp] = r.data as [any, any, any, any];
  const sync = status?.sync_info;
  if (!sync || num(sync.latest_block_height) === null) return { state: "error", latencyMs: r.latencyMs, error: "not a Tendermint2 RPC response (status.sync_info missing)" };
  const list = Array.isArray(vals?.validators) ? vals.validators : null;
  return {
    state: "ok",
    latencyMs: r.latencyMs,
    network: status.node_info?.network ?? null,
    moniker: status.node_info?.moniker ?? null,
    version: status.node_info?.version ?? null,
    txIndex: status.node_info?.other?.tx_index ?? null,
    latest: num(sync.latest_block_height),
    latestTime: sync.latest_block_time ?? null,
    appHash: sync.latest_app_hash ?? null,
    catchingUp: typeof sync.catching_up === "boolean" ? sync.catching_up : null,
    mempool: num(mempool?.n_txs),
    validators: list ? list.length : null,
    votingPower: list ? list.reduce((s: number, v: any) => s + (num(v?.voting_power) ?? 0), 0) : null,
    maxGas: num(cp?.consensus_params?.Block?.MaxGas),
  };
}

export type BlockInfo = { number: number; hash: string | null; time: string | null; txCount: number; proposer: string | null };

/** The newest `count` blocks at or below `head`, newest first (one `blockchain` call, max 20). */
export async function fetchBlocks(url: string, head: number, count = 5): Promise<RpcResult<BlockInfo[]>> {
  const min = Math.max(1, head - count + 1);
  const r = await rpcCallRaw(url, "blockchain", { minHeight: String(min), maxHeight: String(head) }, 8_000);
  if (r.state !== "ok") return r;
  const metas = ((r.data as Envelope).result as { block_metas?: any[] } | undefined)?.block_metas ?? [];
  const blocks = metas.flatMap(m => {
    const h = m?.header;
    const n = num(h?.height);
    if (n === null) return [];
    return [{ number: n, hash: m.block_id?.hash ?? null, time: h.time ?? null, txCount: num(h.num_txs) ?? 0, proposer: h.proposer_address ?? null }];
  }).sort((a, b) => b.number - a.number);
  return { state: "ok", latencyMs: r.latencyMs, data: blocks };
}
