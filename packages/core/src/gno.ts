/**
 * gno.land decoding shared by the indexer and the API: tx-indexer rows into
 * table rows, coin strings, hash encodings, and ABCI queries against the
 * GnoVM (render, source files, exported functions, balances).
 */
import type { JsonRpc } from "./rpc";
import type { RawBlock, RawEvent, RawMessage, RawTx } from "./indexer";

export const CHAIN_ID = "gnoland-1";
export const DENOM = "ugnot";
export const DECIMALS = 6;

const ADDRESS_RE = /^g1[02-9ac-hj-np-z]{38}$/;
export const isAddress = (s: string): boolean => ADDRESS_RE.test(s);
/** A package path such as gno.land/r/gnoland/home or gno.land/p/nt/avl/v0. */
export const isPkgPath = (s: string): boolean => /^gno\.land\/[rpe]\/[a-z0-9_./-]+$/i.test(s);
/** Transaction and block hashes are 32 bytes, printed in standard base64. */
export const isHash = (s: string): boolean => /^[A-Za-z0-9+/]{43}=$/.test(s) || /^[A-Za-z0-9_-]{43}=?$/.test(s) || /^(0x)?[0-9a-fA-F]{64}$/.test(s);

/** Normalise base64url, unpadded base64 or hex to the chain's standard base64. */
export function normalizeHash(s: string): string {
  const t = s.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t.replace(/^0x/, ""), "hex").toString("base64");
  const b64 = t.replace(/-/g, "+").replace(/_/g, "/");
  return b64.endsWith("=") ? b64 : `${b64}=`;
}
export const hashToHex = (b64: string): string => Buffer.from(b64, "base64").toString("hex");

export const pkgKind = (path: string): "realm" | "pure" | "ephemeral" =>
  /^gno\.land\/r\//.test(path) ? "realm" : /^gno\.land\/e\//.test(path) ? "ephemeral" : "pure";

/** "1000ugnot,5/gno.land/r/foo:bar" → [{ amount: "1000", denom: "ugnot" }, …]; realm-issued denoms start with "/". */
export function parseCoins(s: string | null | undefined): { amount: string; denom: string }[] {
  if (!s) return [];
  return s
    .split(",")
    .map((c) => c.trim().match(/^(\d+)([a-zA-Z/][\w/:.-]*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ amount: m[1]!, denom: m[2]! }));
}

/** The ugnot part of a coin string, as a bigint (0 when absent). */
export const ugnotOf = (s: string | null | undefined): bigint =>
  parseCoins(s).reduce((sum, c) => (c.denom === DENOM ? sum + BigInt(c.amount) : sum), 0n);

/* ── tx-indexer rows → table rows ─────────────────────────────────────── */

export type BlockRow = {
  height: number;
  hash: string;
  time: Date;
  proposer: string;
  txCount: number;
  totalTxs: number;
  appHash: string | null;
  validatorsHash: string | null;
};

export function parseBlock(b: RawBlock): BlockRow {
  return {
    height: b.height,
    hash: b.hash,
    time: new Date(b.time),
    proposer: b.proposer_address_raw,
    txCount: b.num_txs,
    totalTxs: b.total_txs,
    appHash: b.app_hash || null,
    validatorsHash: b.validators_hash || null,
  };
}

/** A message as stored: package file bodies replaced by their byte size. */
export type StoredMessage = { route: string; type: string; kind: string; value: Record<string, any> };

const fileList = (files: { name: string; body: string }[] | null | undefined) =>
  (files ?? []).map((f) => ({ name: f.name, size: Buffer.byteLength(f.body ?? "", "utf8") }));

/** Script source kept per MsgRun file; scripts are short, packages are not. */
const MAX_SCRIPT_BYTES = 64 * 1024;

export function storeMessage(m: RawMessage): StoredMessage {
  const { __typename, ...value } = m.value ?? { __typename: "UnexpectedMessage" };
  if (value.package) {
    const files = value.package.files as { name: string; body: string }[] | null;
    value.package = { name: value.package.name, path: value.package.path, files: fileList(files) };
    // A MsgRun is a one-off script: what it did is only visible in its source.
    if (__typename === "MsgRun") value.script = (files ?? []).map((f) => ({ name: f.name, body: (f.body ?? "").slice(0, MAX_SCRIPT_BYTES) }));
  }
  return { route: m.route, type: m.typeUrl, kind: __typename, value };
}

/** gno.land packages a source file imports (`import "gno.land/r/…"` and grouped imports). */
export function importsOf(body: string): string[] {
  const out = new Set<string>();
  for (const block of body.matchAll(/\bimport\s*(\([^)]*\)|[\w.]*\s*"[^"]+")/g)) {
    for (const m of block[1]!.matchAll(/"(gno\.land\/[^"]+)"/g)) out.add(m[1]!);
  }
  return [...out];
}

/** Who sent a message: the first signer-like field it carries. */
export function messageSigner(m: RawMessage): string | null {
  const v = m.value ?? {};
  return v.caller ?? v.from_address ?? v.creator ?? v.approver ?? v.sender ?? null;
}

export type EventRow = {
  txHash: string;
  idx: number;
  height: number;
  time: Date;
  kind: string;
  pkgPath: string | null;
  type: string | null;
  attrs: { key: string; value: string }[] | null;
  from: string | null;
  to: string | null;
  amount: string | null;
  denom: string | null;
  bytesDelta: number | null;
};

export function parseEvent(e: RawEvent, base: { txHash: string; idx: number; height: number; time: Date }): EventRow {
  const row: EventRow = { ...base, kind: "unknown", pkgPath: null, type: null, attrs: null, from: null, to: null, amount: null, denom: null, bytesDelta: null };
  switch (e.__typename) {
    case "GnoEvent":
      return { ...row, kind: "gno", pkgPath: e.pkg_path || null, type: e.type || null, attrs: e.attrs ?? [] };
    case "StorageDepositEvent":
      return { ...row, kind: "storage_deposit", pkgPath: e.pkg_path || null, bytesDelta: e.bytes_delta ?? null, amount: e.fee_delta ? String(e.fee_delta.amount) : null, denom: e.fee_delta?.denom ?? null };
    case "StorageUnlockEvent":
      return {
        ...row,
        kind: "storage_unlock",
        pkgPath: e.pkg_path || null,
        // Unlock events report the bytes released as a positive delta; store it signed.
        bytesDelta: e.bytes_delta === undefined || e.bytes_delta === null ? null : -Math.abs(e.bytes_delta),
        amount: e.fee_refund ? String(e.fee_refund.amount) : null,
        denom: e.fee_refund?.denom ?? null,
        attrs: e.refund_withheld ? [{ key: "refund_withheld", value: "true" }] : null,
      };
    case "TransferEvent": {
      const coin = parseCoins(e.coins)[0];
      return { ...row, kind: "transfer", from: e.from || null, to: e.to || null, amount: coin?.amount ?? null, denom: coin?.denom ?? null, attrs: e.coins ? [{ key: "coins", value: e.coins }] : null };
    }
    default:
      return { ...row, attrs: e.value ? [{ key: "value", value: String(e.value) }] : null };
  }
}

export type PackageRow = {
  path: string;
  name: string;
  kind: string;
  creator: string;
  height: number;
  txHash: string;
  time: Date;
  files: { name: string; size: number }[];
  sourceBytes: number;
  maxDeposit: string | null;
  status: string;
};

export type TxRow = {
  hash: string;
  height: number;
  txIndex: number;
  time: Date;
  success: boolean;
  signer: string | null;
  gasWanted: number;
  gasUsed: number;
  fee: string;
  feeDenom: string | null;
  memo: string | null;
  kinds: string[];
  addresses: string[];
  pkgPaths: string[];
  funcs: string[];
  messages: StoredMessage[];
  error: string | null;
  log: string | null;
  storageDelta: number;
};

export type TokenTransferRow = {
  txHash: string;
  idx: number;
  height: number;
  time: Date;
  token: string;
  standard: string;
  from: string | null;
  to: string | null;
  value: string;
};

/**
 * A GRC20/GRC721 Transfer from the standard token libraries. Their `token`
 * attribute is `<realm>.<SYMBOL>.<instance>`; the registry key drops the
 * instance suffix.
 */
export function tokenTransfer(e: EventRow): TokenTransferRow | null {
  if (e.kind !== "gno" || e.type !== "Transfer" || !e.pkgPath) return null;
  const standard = /\/grc721(\/|$)/.test(e.pkgPath) ? "grc721" : /\/grc20(\/|$)/.test(e.pkgPath) ? "grc20" : null;
  if (!standard) return null;
  const attr = (k: string) => e.attrs?.find((a) => a.key === k)?.value ?? null;
  const raw = attr("token");
  const value = attr("value") ?? attr("tokenId");
  if (!raw || value === null) return null;
  return {
    txHash: e.txHash,
    idx: e.idx,
    height: e.height,
    time: e.time,
    token: raw.replace(/\.\d+$/, ""),
    standard,
    from: attr("from") || null,
    to: attr("to") || null,
    value,
  };
}

export type ParsedTx = { tx: TxRow; events: EventRow[]; packages: PackageRow[]; transfers: TokenTransferRow[] };

/** Decode one tx-indexer transaction; `time` is its block's time. */
export function parseTx(t: RawTx, time: Date): ParsedTx {
  const messages = t.messages ?? [];
  const addresses = new Set<string>();
  const pkgPaths = new Set<string>();
  const funcs: string[] = [];
  const packages: PackageRow[] = [];
  for (const m of messages) {
    const v = m.value ?? {};
    for (const k of ["caller", "from_address", "to_address", "creator", "approver", "sender"]) if (typeof v[k] === "string" && v[k]) addresses.add(v[k]);
    if (v.pkg_path) pkgPaths.add(v.pkg_path);
    if (v.package?.path) pkgPaths.add(v.package.path);
    // A script's targets are the realms it imports (e.g. a GovDAO vote).
    if (v.__typename === "MsgRun") for (const f of v.package?.files ?? []) for (const imp of importsOf(f.body ?? "")) pkgPaths.add(imp);
    if (v.__typename === "MsgCall" && v.pkg_path && v.func) funcs.push(`${v.pkg_path}.${v.func}`);
    // A failed deploy leaves nothing on chain.
    if (v.__typename === "MsgAddPackage" && t.success && v.package?.path) {
      const files = fileList(v.package.files);
      packages.push({
        path: v.package.path,
        name: v.package.name,
        kind: pkgKind(v.package.path),
        creator: v.creator,
        height: t.block_height,
        txHash: t.hash,
        time,
        files,
        sourceBytes: files.reduce((s, f) => s + f.size, 0),
        maxDeposit: v.max_deposit || null,
        status: "live",
      });
    }
  }
  const events = (t.response?.events ?? []).map((e, idx) => parseEvent(e, { txHash: t.hash, idx, height: t.block_height, time }));
  const transfers = events.map(tokenTransfer).filter((t): t is TokenTransferRow => t !== null);
  for (const e of [...events, ...transfers]) {
    if (e.from) addresses.add(e.from);
    if (e.to) addresses.add(e.to);
  }
  const first = messages[0];
  return {
    tx: {
      hash: t.hash,
      height: t.block_height,
      txIndex: t.index,
      time,
      success: t.success,
      signer: first ? messageSigner(first) : null,
      gasWanted: t.gas_wanted,
      gasUsed: t.gas_used,
      fee: String(t.gas_fee?.amount ?? 0),
      feeDenom: t.gas_fee?.denom || null,
      memo: t.memo || null,
      kinds: messages.map((m) => `${m.route}/${m.typeUrl}`),
      addresses: [...addresses],
      pkgPaths: [...pkgPaths],
      funcs,
      messages: messages.map(storeMessage),
      error: t.response?.error || null,
      log: t.response?.log || null,
      storageDelta: events.reduce((s, e) => s + (e.kind.startsWith("storage_") ? (e.bytesDelta ?? 0) : 0), 0),
    },
    events,
    packages,
    transfers,
  };
}

/* ── ABCI queries ─────────────────────────────────────────────────────── */

export class AbciError extends Error {
  constructor(
    message: string,
    /** The amino type of the error, e.g. /vm.InvalidPkgPathError. */
    readonly type: string | null,
  ) {
    super(message);
  }
}

/** Run an ABCI query; `data` is the raw query string. Returns the decoded Data. */
export async function abciQuery(rpc: JsonRpc, path: string, data = "", height?: number): Promise<string> {
  const params: Record<string, unknown> = { path, data: Buffer.from(data, "utf8").toString("base64") };
  if (height) params.height = String(height);
  const r = await rpc.call<any>("abci_query", params);
  const base = r?.response?.ResponseBase ?? {};
  if (base.Error) {
    // The Log carries a Go stack trace; keep only the message line.
    const log = String(base.Log ?? "");
    const msg = log.match(/^\s*\d+\s+\S+ - (.+)$/m)?.[1] ?? log.split("\n").find((l) => l.trim() && !l.startsWith("--="))?.trim() ?? "query failed";
    throw new AbciError(msg, base.Error["@type"] ?? null);
  }
  return base.Data ? Buffer.from(base.Data, "base64").toString("utf8") : "";
}

/** Realm Render(path) output (markdown). */
export const qrender = (rpc: JsonRpc, pkgPath: string, path = "") => abciQuery(rpc, "vm/qrender", `${pkgPath}:${path}`);
/** File list of a package (newline separated), or one file's source. */
export const qfile = (rpc: JsonRpc, pathOrFile: string) => abciQuery(rpc, "vm/qfile", pathOrFile);
/** Evaluate an expression in a package, e.g. `GetUserByAddress("g1…")`. */
export const qeval = (rpc: JsonRpc, pkgPath: string, expr: string) => abciQuery(rpc, "vm/qeval", `${pkgPath}.${expr}`);

export type FuncSig = { name: string; params: { name: string; type: string }[]; results: { name: string; type: string }[] };

/** Exported functions of a package, with their parameter and result types. */
export async function qfuncs(rpc: JsonRpc, pkgPath: string): Promise<FuncSig[]> {
  const raw = JSON.parse((await abciQuery(rpc, "vm/qfuncs", pkgPath)) || "[]") as any[];
  const simplify = (t: string) => (t.startsWith("interface {") ? "realm" : t.replace(/\.uverse\./g, ""));
  return (raw ?? []).map((f) => ({
    name: f.FuncName,
    params: (f.Params ?? []).map((p: any) => ({ name: p.Name, type: simplify(p.Type) })),
    results: (f.Results ?? []).map((p: any) => ({ name: p.Name, type: simplify(p.Type) })),
  }));
}

/** Bank balances of an address as a coin list. */
export async function balances(rpc: JsonRpc, address: string): Promise<{ amount: string; denom: string }[]> {
  const raw = await abciQuery(rpc, "bank/balances/" + address);
  return parseCoins(raw ? JSON.parse(raw) : "");
}

export type Account = { address: string; account_number: string; sequence: string; public_key: unknown; coins: string } | null;

/** auth account (null for an address that never received or sent anything). */
export async function account(rpc: JsonRpc, address: string): Promise<Account> {
  const raw = await abciQuery(rpc, "auth/accounts/" + address);
  const parsed = raw ? JSON.parse(raw) : null;
  return parsed?.BaseAccount ?? parsed ?? null;
}

/* ── realm renders ─────────────────────────────────────────────────── */

export type ValoperProfile = { operator: string; moniker: string | null; description: string | null; signing: string | null; serverType: string | null };

/** Parse one valopers profile render (`Render("<operator>")`). */
export function parseValoper(operator: string, md: string): ValoperProfile {
  const field = (label: string) => md.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  const heading = md.match(/^##\s+(.+)$/m);
  let description: string | null = null;
  if (heading) {
    const after = md.slice((heading.index ?? 0) + heading[0].length).split("\n");
    const lines: string[] = [];
    for (const l of after) {
      if (l.startsWith("- ")) break;
      lines.push(l);
    }
    description = lines.join("\n").trim() || null;
  }
  return { operator, moniker: heading?.[1]?.trim() ?? null, description, signing: field("Signing Address"), serverType: field("Server Type") };
}

/* ── usernames (gno.land/r/sys/users) ─────────────────────────────────── */

export const USERS_REALM = "gno.land/r/sys/users";

/** Number of addresses with a registered name. */
export async function userCount(rpc: JsonRpc): Promise<number> {
  const out = await qeval(rpc, USERS_REALM, "GetReadonlyAddrStore().Size()");
  return Number(out.match(/^\((\d+) int\)/)?.[1] ?? 0);
}

/** The i-th entry of the address store: its address, current name and deleted flag. */
export async function userAt(rpc: JsonRpc, i: number): Promise<{ address: string; name: string; deleted: boolean } | null> {
  const out = await qeval(rpc, USERS_REALM, `GetReadonlyAddrStore().GetByIndex(${i})`);
  return parseUserData(out);
}

/** Parse a printed `*UserData` value, e.g. from qeval of GetByIndex. */
export function parseUserData(out: string): { address: string; name: string; deleted: boolean } | null {
  const m = out.match(/\("(g1[02-9ac-hj-np-z]{38})" \.uverse\.address\),\("([^"]*)" string\),\((true|false) bool\)/);
  return m ? { address: m[1]!, name: m[2]!, deleted: m[3] === "true" } : null;
}

/* ── GovDAO (gno.land/r/gov/dao) ──────────────────────────────────────── */

export const GOVDAO_REALM = "gno.land/r/gov/dao";

export type ProposalSummary = { id: number; title: string; author: string | null; status: string; tiers: string | null };

/** Parse one page of the proposal list; also returns the highest page linked. */
export function parseProposalList(md: string): { proposals: ProposalSummary[]; pages: number } {
  const proposals: ProposalSummary[] = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const head = block.match(/^\[Prop #(\d+) - (.*)\]\(/);
    if (!head) continue;
    proposals.push({
      id: Number(head[1]),
      title: head[2]!.trim(),
      author: parseAuthor(block),
      status: block.match(/^Status:\s*(\S+)/m)?.[1] ?? "UNKNOWN",
      tiers: block.match(/^Tiers eligible to vote:\s*(.+)$/m)?.[1]?.trim() ?? null,
    });
  }
  const pages = Math.max(1, ...[...md.matchAll(/\(\?page=(\d+)\)/g)].map((m) => Number(m[1])));
  return { proposals, pages };
}

/** "Author: [@moul](/u/moul)" → "@moul"; "Author: g1…" → "g1…". */
function parseAuthor(md: string): string | null {
  const line = md.match(/^Author:\s*(.+)$/m)?.[1]?.trim();
  if (!line) return null;
  return line.match(/^\[(@[^\]]+)\]/)?.[1] ?? line;
}

export type ProposalDetail = {
  author: string | null;
  body: string;
  executor: string | null;
  yesPct: number | null;
  noPct: number | null;
  abstainPct: number | null;
};

export function parseProposal(md: string): ProposalDetail {
  const pct = (label: string) => {
    const m = md.match(new RegExp(`${label} PERCENT:\\s*([\\d.]+)%`));
    return m ? Number(m[1]) : null;
  };
  // Body: everything between the author line and the stats section.
  const start = md.search(/^Author:.*$/m);
  const afterAuthor = start >= 0 ? md.slice(start).replace(/^Author:.*\n/, "") : md;
  const body = afterAuthor.split(/^-{3,}\s*$/m)[0]!.replace(/^Executor created in:.*$/m, "").trim();
  return {
    author: parseAuthor(md),
    body,
    executor: md.match(/^Executor created in:\s*`?([^`\n]+)`?/m)?.[1]?.trim() ?? null,
    yesPct: pct("YES"),
    noPct: pct("NO"),
    abstainPct: pct("ABSTAIN"),
  };
}

/** The votes page: "YES from T1 (VPPM 3):" followed by "- voter" lines. */
export function parseVotes(md: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let cur: string[] | null = null;
  for (const line of md.split("\n")) {
    const head = line.match(/^(YES|NO|ABSTAIN) from (T\d+)/);
    if (head) {
      cur = [];
      (out[head[1]!] ??= {})[head[2]!] = cur;
      continue;
    }
    const voter = line.match(/^- (?:\[(@[^\]]+)\]\([^)]*\)|(g1[0-9a-z]{38}))/);
    if (voter && cur) cur.push(voter[1] ?? voter[2]!);
  }
  return out;
}

/* ── GRC20 registry (gno.land/r/nt/grc20reg/v0) ──────────────────────── */

export const GRC20_REGISTRY = "gno.land/r/nt/grc20reg/v0";

/** Registry render lines: "- **Name** - [realm](/r/…).SYMBOL - [info](…:<key>)". */
export function parseTokenRegistry(md: string): { key: string; realm: string; symbol: string; name: string }[] {
  const out: { key: string; realm: string; symbol: string; name: string }[] = [];
  for (const m of md.matchAll(/^- \*\*(.*)\*\* - \[([^\]]+)\]\([^)]*\)\.(\S+) - \[info\]/gm)) {
    const realm = m[2]!;
    const symbol = m[3]!;
    out.push({ key: `${realm}.${symbol}`, realm, symbol, name: m[1]!.replace(/\\(.)/g, "$1") });
  }
  return out;
}

/**
 * A token key safe to interpolate into a qeval expression. Keys come from
 * on-chain event attributes, so anything outside a path + symbol is refused.
 */
export const isTokenKey = (key: string): boolean => /^gno\.land\/[rp]\/[\w./-]+\.[\w-]+$/.test(key);

/** "(1000 int64)" / "(6 int)" / ("12" string) → the bare value. */
export function evalValue(out: string): string | null {
  return out.match(/^\("?(-?[^"\s)]*)"? [\w.*]+\)/)?.[1] ?? null;
}
