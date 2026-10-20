import type { Endpoint } from "./api";

/** Pathrock's gno.land mainnet archive RPC (full state history); it sends `Access-Control-Allow-Origin: *`. */
export const PUBLIC_RPC = "https://gnoland.archive.pathrocknetwork.org";
export const PUBLIC_RPC_WS = "wss://gnoland.archive.pathrocknetwork.org/websocket";
/** The gno.land public RPC, pruned below ~240,000; kept as a failover. */
export const GNO_RPC = "https://rpc.gno.land";
/** Pathrock's tx-indexer (GraphQL); also CORS-open. */
export const PUBLIC_INDEXER = "https://indexer.gnoland.pathrocknetwork.org";
export const INDEXER_GRAPHQL = "https://indexer.gnoland.pathrocknetwork.org/graphql/query";
/** Endpoints verified to allow browser requests (CORS `*`). */
const CORS_OPEN = [PUBLIC_RPC, GNO_RPC, PUBLIC_INDEXER, "https://indexer.gno.land"];
export const isCorsOpen = (url: string) => CORS_OPEN.includes(url.replace(/\/+$/, "").toLowerCase());

export const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
export const roleLabel = (e: Pick<Endpoint, "kind">) => e.kind === "rpc" ? "TM2 RPC" : "tx-indexer";

export function median(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  return known.length ? known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2 : null;
}
export function endpointSummary(entries: Endpoint[]) {
  return {
    total: entries.length,
    healthy: entries.filter(e => e.ok).length,
    unhealthy: entries.filter(e => !e.ok).length,
    median: median(entries.filter(e => e.ok).map(e => e.latency_ms)),
  };
}

/** Signed distance from a reference head (the highest height any source reported). */
export function headDelta(height: number | null, head: number | null | undefined): number | null {
  return height === null || head === null || head === undefined ? null : height - head;
}
export function deltaText(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "at head";
  return delta > 0 ? `+${delta.toLocaleString("en-US")} ahead` : `${(-delta).toLocaleString("en-US")} behind`;
}

export type ProbeObservation = { at: number; latency: number | null; healthy: boolean; height: number | null };
export function appendObservation(history: ProbeObservation[], observation: ProbeObservation) {
  const recent = history.filter(p => p.at >= observation.at - 3_600_000);
  const previous = recent.at(-1);
  if (previous && previous.latency === observation.latency && previous.healthy === observation.healthy && previous.height === observation.height) return recent;
  return [...recent, observation].slice(-360);
}

/** Deep link into the RPC console with an endpoint and a method (or preset id) preselected. */
export function consoleLink(url: string, method = "status") {
  return `#/rpc/connect?url=${encodeURIComponent(url)}&method=${encodeURIComponent(method)}`;
}
export function rpcConsoleRequest(hash: string): { url: string; method: string | null } | null {
  if (!hash.startsWith("#/rpc/connect?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const value = params.get("url");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return { url: value, method: params.get("method") };
  } catch { return null; }
}
