/** gno.land transaction feed helpers: kind filters, routes, cursors, token amounts. */
import { getTokens, type Names, type TokenRow, type Tx } from "./api";
import { addrHref, formatUnits, isAddr, isTxHash, kindLabel, txHref } from "./lib";

/** Server-side kind filters for /api/v1/txs (`kind` = route/type). */
export const kindFilters = [
  { id: "", label: "All" },
  { id: "vm/exec", label: "Calls" },
  { id: "vm/add_package", label: "Deploys" },
  { id: "vm/run", label: "Runs" },
  { id: "bank/send", label: "Sends" },
] as const;
export type KindFilter = (typeof kindFilters)[number]["id"];

/** Glyph / tone class for the first message kind of a transaction. */
export function kindTone(kind: string | undefined): "call" | "deploy" | "run" | "send" | "other" {
  switch (kind) {
    case "vm/exec":
      return "call";
    case "vm/add_package":
      return "deploy";
    case "vm/run":
      return "run";
    case "bank/send":
      return "send";
    default:
      return "other";
  }
}

/** Human label of a transaction's first message kind (kept for pages that import it). */
export const transactionKind = (tx: { kinds?: string[] }) => kindLabel(tx.kinds?.[0] ?? "");

/** Cursor for the page after `rows`: the "height:tx_index" of its last row. */
export const txCursor = (tx: Pick<Tx, "height" | "tx_index">) => `${tx.height}:${tx.tx_index}`;

export const addressRoute = (address: string) => addrHref(address);
export const txRoute = (hash: string) => txHref(hash);
export const tokenRoute = (key: string) => `#/tokens/${key}`;

/** `#/transactions/address/<g1…>` → address, else null. */
export function addressFromHash(hash: string): string | null {
  const a = hash.match(/^#\/transactions\/address\/([^/?#]+)$/)?.[1];
  return a && isAddr(a) ? a : null;
}

/** `#/transactions/<base64url hash>` → the slug (the API accepts base64url), else null. */
export function txHashFromHash(hash: string): string | null {
  const m = hash.match(/^#\/transactions\/([^/]+)$/)?.[1];
  if (!m || m === "address") return null;
  const s = decodeURIComponent(m);
  return isTxHash(s) ? s : null;
}

/** Same hash, either encoding → base64url, for comparing a route slug with a row hash. */
export const sameHash = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What a search box was given, decided from its shape alone. */
export type SearchTarget =
  | { kind: "transaction"; hash: string }
  | { kind: "address"; address: string }
  | { kind: "block"; height: number }
  | { kind: "text"; query: string };

export function searchTarget(input: string): SearchTarget | null {
  const q = input.trim();
  if (!q) return null;
  if (isAddr(q)) return { kind: "address", address: q };
  if (isTxHash(q)) return { kind: "transaction", hash: q };
  if (/^\d{1,12}$/.test(q)) return { kind: "block", height: Number(q) };
  return { kind: "text", query: q };
}

/** Text matched by the client-side filter box over loaded rows. */
export function txHaystack(tx: Tx, names: Names, summary: string): string {
  return [tx.hash, tx.signer, tx.signer ? names[tx.signer] : null, summary, String(tx.height), tx.memo, tx.error, ...tx.pkg_paths, ...tx.funcs]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export type Direction = "in" | "out" | "self";
export function direction(from: string | null, to: string | null, address: string): Direction {
  const f = from === address;
  const t = to === address;
  return f && t ? "self" : f ? "out" : "in";
}

/**
 * GRC20 amounts are raw integers; format with the token's decimals when known.
 * GRC721 values are token ids.
 */
export function tokenAmount(value: string | null | undefined, standard: string | undefined, decimals: number | null | undefined): { text: string; raw: boolean } {
  if (value === null || value === undefined || value === "") return { text: "—", raw: false };
  if (standard === "grc721") return { text: `#${value}`, raw: false };
  if (decimals === null || decimals === undefined || !/^-?\d+$/.test(value)) return { text: value, raw: true };
  return { text: formatUnits(value, decimals, Math.min(decimals, 6)), raw: false };
}

/** "gno.land/r/gnoswap/gns.GNS" → { realm, symbol }. */
export function splitTokenKey(key: string): { realm: string; symbol: string } {
  const i = key.lastIndexOf(".");
  return i > 0 ? { realm: key.slice(0, i), symbol: key.slice(i + 1) } : { realm: key, symbol: key };
}

/** Token list, fetched once per minute and shared, for decimals/symbols in transfer rows. */
let tokenCache: { at: number; p: Promise<Map<string, TokenRow>> } | null = null;
export function tokenIndex(): Promise<Map<string, TokenRow>> {
  if (!tokenCache || Date.now() - tokenCache.at > 60_000) {
    const p = getTokens()
      .then((r) => new Map(r.tokens.map((t) => [t.key, t])))
      .catch((e) => {
        tokenCache = null;
        throw e;
      });
    tokenCache = { at: Date.now(), p };
  }
  return tokenCache.p;
}

/** Gas used ÷ wanted as a percentage. */
export const gasEfficiency = (used: number, wanted: number) => (wanted > 0 ? (used / wanted) * 100 : null);

/** Shorten bech32 addresses inside realm paths/summaries: r/g1leu8…95wr/bubble.Heartbeat. */
export const compactAddrs = (s: string) => s.replace(/g1[02-9ac-hj-np-z]{38}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);
