/** Pure helpers behind the Blocks page (gno.land / Tendermint2 blocks). */
import { ApiError, type Block, type Tx } from "./api";
import { txSlug } from "./lib";

/**
 * Block id from the route: `#/blocks/<height>` or `#/blocks/<hash>` (base64 or
 * base64url). Null on the list route.
 */
export function blockIdFromLocation(hash = typeof location === "undefined" ? "" : location.hash): string | null {
  const m = hash.match(/^#\/blocks\/([^?#]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]!).trim();
  if (/^\d+$/.test(id)) return String(Number(id));
  return id || null;
}

/** Route for a block by height or hash (hashes are routed as base64url). */
export const blockRoute = (id: number | string) => `#/blocks/${typeof id === "number" ? id : /^\d+$/.test(id) ? id : txSlug(id)}`;

/** Normalises a user's jump input: a height, or a block hash in either base64 form. */
export function parseBlockQuery(input: string): string | null {
  const v = input.trim().replace(/,/g, "");
  if (/^\d+$/.test(v)) return String(Number(v));
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) return txSlug(v);
  return null;
}

/** Validators expected to sign (present + missed), or null when signatures were not read. */
export const setSize = (b: Pick<Block, "signed" | "missed">) => (b.signed === null ? null : b.signed + (b.missed ?? 0));

/** "6/6", or "—" when the block's precommits have not been read. */
export function signatures(b: Pick<Block, "signed" | "missed">): string {
  const n = setSize(b);
  return n === null ? "—" : `${b.signed}/${n}`;
}

export type SigTone = "ok" | "warn" | "unknown";
export const sigTone = (b: Pick<Block, "signed" | "missed">): SigTone => (b.signed === null ? "unknown" : (b.missed ?? 0) > 0 ? "warn" : "ok");

/** Totals for a block's transactions (fee in ugnot; non-ugnot fees are skipped). */
export function txTotals(txs: Tx[]) {
  let fees = 0n;
  let gasUsed = 0;
  let gasWanted = 0;
  let failed = 0;
  for (const t of txs) {
    if ((t.fee_denom ?? "ugnot") === "ugnot" && /^\d+$/.test(t.fee)) fees += BigInt(t.fee);
    gasUsed += t.gas_used;
    gasWanted += t.gas_wanted;
    if (!t.success) failed += 1;
  }
  return { fees: fees.toString(), gasUsed, gasWanted, failed };
}

/** Message-kind counts across a block's transactions ("vm/exec" → n). */
export function kindCounts(txs: Tx[]): { kind: string; n: number }[] {
  const m = new Map<string, number>();
  for (const t of txs) for (const k of t.kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n);
}

/** Proposer counts across a page of blocks, most first. */
export function proposerCounts(blocks: Block[]): { proposer: string; moniker: string | null; n: number }[] {
  const m = new Map<string, { proposer: string; moniker: string | null; n: number }>();
  for (const b of blocks) {
    const row = m.get(b.proposer) ?? { proposer: b.proposer, moniker: b.proposer_moniker, n: 0 };
    row.n += 1;
    m.set(b.proposer, row);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export const blockError = (e: unknown, id: string) =>
  e instanceof ApiError && e.status === 404
    ? `Block ${/^\d+$/.test(id) ? `#${Number(id).toLocaleString("en-US")}` : id} was not found. It may not be indexed yet.`
    : e instanceof ApiError && e.status === 400
      ? "That is not a block height or block hash."
      : "This block could not be loaded.";

export const utcTime = (time: string) => new Date(time).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false });
export const utcDateTime = (time: string) => new Date(time).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
