/**
 * Tendermint2 JSON-RPC method catalog for the gno.land RPC console.
 *
 * TM2 takes NAMED params with string-encoded integers ({"height":"944000"});
 * byte fields (abci_query data, tx hashes) are standard base64. ABCI query
 * presets encode the query string for the user and the response view decodes
 * `ResponseBase.Data`. Broadcast methods are deliberately absent.
 */
import { GNO_RPC, PUBLIC_RPC } from "./networkExplorer";
import type { RpcParams } from "./nodeRpc";

export type ParamKind = "height" | "int" | "text" | "hash" | "address" | "pkgpath";
export type ParamSpec = { key: string; label: string; kind: ParamKind; placeholder?: string; hint?: string; optional?: boolean; default?: string };
export type MethodSpec = {
  /** Catalog id; equals `method` except for ABCI query presets. */
  id: string;
  group: string;
  method: string;
  description: string;
  params: ParamSpec[];
  note?: string;
  /** Ask before sending (genesis is ~300 MB). */
  confirm?: string;
  /** Turns validated field values into the named params object. */
  build?: (v: Record<string, string>) => RpcParams;
};

export { PUBLIC_RPC };
export const PUBLIC_RPCS = [PUBLIC_RPC, GNO_RPC];

/** UTF-8 string → standard base64. */
export function toBase64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}
/** Standard base64 → UTF-8 text, or null when it is not valid base64 / UTF-8. */
export function fromBase64(b64: string): string | null {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; }
}
/** Accept a tx hash as base64, base64url (explorer links) or 0x-hex; return standard base64. */
export function normalizeTxHash(raw: string): string | null {
  const v = raw.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(v)) {
    const hex = v.replace(/^0x/, "");
    let bin = "";
    for (let i = 0; i < 64; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return btoa(bin);
  }
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) return v.replace(/-/g, "+").replace(/_/g, "/").replace(/=*$/, "=");
  return null;
}

const height = (hint = "blank = latest"): ParamSpec => ({ key: "height", label: "height", kind: "height", placeholder: "latest", optional: true, hint });
const pkg = (def: string, hint = "package path"): ParamSpec => ({ key: "pkg", label: "package path", kind: "pkgpath", default: def, placeholder: def, hint });
const addr: ParamSpec = { key: "address", label: "address", kind: "address", placeholder: "g1…", hint: "bech32 g1 address" };
const abci = (path: string, data = "", h?: string): RpcParams => ({ path, data: toBase64(data), ...(h ? { height: h } : {}) });

export const RPC_METHODS: MethodSpec[] = [
  { id: "status", group: "Node", method: "status", description: "Node identity, latest height, app hash and sync state", params: [] },
  { id: "health", group: "Node", method: "health", description: "Empty result when the node is up", params: [] },
  { id: "net_info", group: "Node", method: "net_info", description: "Peers of the answering node, with their monikers", params: [] },
  { id: "abci_info", group: "Node", method: "abci_info", description: "Application version, last height and app hash", params: [] },
  { id: "genesis", group: "Node", method: "genesis", description: "The full genesis document", params: [], confirm: "The gno.land mainnet genesis is about 300 MB (3.2 million airdrop balances). Your browser may run out of memory. Send anyway?", note: "Very large: about 300 MB. Prefer block_results with height 0 for the 96 genesis transactions." },
  { id: "block", group: "Blocks", method: "block", description: "Block header, transactions (base64) and last commit", params: [height()] },
  { id: "block_results", group: "Blocks", method: "block_results", description: "Per-transaction results: gas, events, logs", params: [height("blank = latest · 0 = the 96 genesis txs")], note: "deliver_tx[i] matches block.data.txs[i]. Height 0 returns the genesis transaction results." },
  { id: "blockchain", group: "Blocks", method: "blockchain", description: "Block headers in a height range (max 20, newest first)", params: [{ key: "minHeight", label: "min height", kind: "int", placeholder: "1", default: "1" }, { key: "maxHeight", label: "max height", kind: "int", placeholder: "20", default: "20" }], note: "At most 20 block_metas are returned; the low end of the range is silently truncated." },
  { id: "commit", group: "Blocks", method: "commit", description: "Signed header with every validator's precommit", params: [height()], note: "A null signature in precommits means that validator missed the block." },
  { id: "validators", group: "Consensus", method: "validators", description: "Validator set: addresses, public keys, voting power", params: [height()] },
  { id: "consensus_params", group: "Consensus", method: "consensus_params", description: "Max block bytes, max gas, time iota", params: [height()] },
  { id: "consensus_state", group: "Consensus", method: "consensus_state", description: "Current round state: height/round/step and votes", params: [] },
  { id: "tx", group: "Transactions", method: "tx", description: "Committed transaction and its result by hash", params: [{ key: "hash", label: "hash", kind: "hash", placeholder: "base64, base64url or 0x-hex", hint: "transaction hash" }], note: "The tx itself is amino-encoded base64; open the hash on the Transactions page for a decoded view." },
  { id: "num_unconfirmed_txs", group: "Mempool", method: "num_unconfirmed_txs", description: "Number and size of transactions in the mempool", params: [] },
  { id: "unconfirmed_txs", group: "Mempool", method: "unconfirmed_txs", description: "Transactions waiting in the mempool", params: [{ key: "limit", label: "limit", kind: "int", placeholder: "30", optional: true, hint: "optional" }] },
  { id: "qrender", group: "Realms (ABCI)", method: "abci_query", description: "vm/qrender · Markdown a realm's Render(path) returns", params: [pkg("gno.land/r/gov/dao", "realm path"), { key: "path", label: "render path", kind: "text", optional: true, placeholder: "(home)", hint: "blank = home page" }, height()], build: v => abci("vm/qrender", `${v.pkg}:${v.path ?? ""}`, v.height), note: "Sends data = base64(\"<pkgpath>:<renderpath>\")." },
  { id: "qfuncs", group: "Realms (ABCI)", method: "abci_query", description: "vm/qfuncs · exported functions and their signatures", params: [pkg("gno.land/r/sys/users"), height()], build: v => abci("vm/qfuncs", v.pkg, v.height) },
  { id: "qfile", group: "Realms (ABCI)", method: "abci_query", description: "vm/qfile · file list of a package, or one file's source", params: [pkg("gno.land/r/sys/users", "package path, or path/file.gno"), height()], build: v => abci("vm/qfile", v.pkg, v.height), note: "A package path lists its files; append /<file>.gno to read one." },
  { id: "qeval", group: "Realms (ABCI)", method: "abci_query", description: "vm/qeval · evaluate a read-only expression in a package", params: [{ key: "expr", label: "expression", kind: "text", default: 'gno.land/r/sys/users.ResolveName("moul")', placeholder: "<pkgpath>.<expr>", hint: "<pkgpath>.<expression>" }, height()], build: v => abci("vm/qeval", v.expr, v.height), note: "Results come back Gno-formatted, one value per line, e.g. (\"moul\" string)." },
  { id: "qstorage", group: "Realms (ABCI)", method: "abci_query", description: "vm/qstorage · bytes stored and deposit locked by a realm", params: [pkg("gno.land/r/gnoland/home"), height()], build: v => abci("vm/qstorage", v.pkg, v.height) },
  { id: "qpaths", group: "Realms (ABCI)", method: "abci_query", description: "vm/qpaths · package paths under a prefix or @username", params: [{ key: "prefix", label: "prefix", kind: "text", default: "gno.land/r/gov", placeholder: "gno.land/r/… or @moul" }], build: v => abci("vm/qpaths", v.prefix) },
  { id: "balances", group: "Accounts (ABCI)", method: "abci_query", description: "bank/balances/<addr> · coin balances", params: [addr, height()], build: v => abci(`bank/balances/${v.address}`, "", v.height), note: "Returns a JSON string like \"936611810ugnot\" (1 GNOT = 1,000,000 ugnot); empty for an unknown address." },
  { id: "account", group: "Accounts (ABCI)", method: "abci_query", description: "auth/accounts/<addr> · account number, sequence, public key", params: [addr, height()], build: v => abci(`auth/accounts/${v.address}`, "", v.height), note: "null when the account has never received coins or signed." },
  { id: "gasprice", group: "Accounts (ABCI)", method: "abci_query", description: "auth/gasprice · current minimum gas price", params: [], build: () => abci("auth/gasprice") },
  { id: "abci_query", group: "Raw ABCI", method: "abci_query", description: "Any ABCI path with a UTF-8 query string (encoded for you)", params: [{ key: "path", label: "path", kind: "text", default: "params/vm:p:storage_price", placeholder: "vm/qrender" }, { key: "data", label: "data", kind: "text", optional: true, placeholder: "query text, e.g. gno.land/r/sys/users:", hint: "plain text · sent as base64" }, height()], build: v => abci(v.path, v.data ?? "", v.height), note: "The Pathrock archive answers at every height; rpc.gno.land prunes state, so queries there below roughly 240,000 fail." },
];

export const POPULAR_METHODS = ["status", "block", "block_results", "commit", "validators", "tx", "qrender", "qeval", "balances"];
export const RPC_CATEGORIES: Record<string, string[] | null> = { Popular: null, Node: ["Node"], Blocks: ["Blocks"], Transactions: ["Transactions", "Mempool"], Consensus: ["Consensus"], Realms: ["Realms (ABCI)"], Accounts: ["Accounts (ABCI)"], "Raw ABCI": ["Raw ABCI"], All: [] };
export const findMethod = (id: string | null | undefined) => RPC_METHODS.find(m => m.id === id) ?? null;
export const methodTitle = (m: MethodSpec) => m.id;

export function methodList(category: string, query: string) {
  const q = query.trim().toLowerCase();
  return RPC_METHODS.filter(m => (q || category === "All" || (category === "Popular" ? POPULAR_METHODS.includes(m.id) : RPC_CATEGORIES[category]?.includes(m.group))) && (!q || `${m.id} ${m.method} ${m.description}`.toLowerCase().includes(q)));
}

export function normalizeEndpoint(raw: string): { url: string; error?: never } | { error: string; url?: never } {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return { error: "Use an HTTP or HTTPS JSON-RPC endpoint." };
    if (url.username || url.password) return { error: "Enter an endpoint without embedded credentials." };
    if (url.hash) return { error: "Enter the RPC URL without a fragment." };
    return { url: url.toString().replace(/\/+$/, "") };
  } catch { return { error: "Enter a valid RPC endpoint URL." }; }
}

/** Validate one field; returns the string value to send. */
function convert(p: ParamSpec, raw: string): { value: string; error?: never } | { error: string; value?: never } {
  const v = raw.trim();
  switch (p.kind) {
    case "height": return /^\d+$/.test(v) ? { value: v } : { error: `${p.label} must be a block height (whole number), or blank for latest.` };
    case "int": return /^\d+$/.test(v) ? { value: v } : { error: `${p.label} must be a whole number.` };
    case "address": return /^g1[02-9ac-hj-np-z]{38}$/.test(v) ? { value: v } : { error: `${p.label} must be a bech32 g1… address (40 characters).` };
    case "hash": { const h = normalizeTxHash(v); return h ? { value: h } : { error: "hash must be a 32-byte transaction hash in base64, base64url or 0x-hex." }; }
    case "pkgpath": return /^gno\.land\/[a-z]\/[\w./-]+$/i.test(v) ? { value: v } : { error: `${p.label} must look like gno.land/r/… or gno.land/p/…` };
    case "text": return { value: raw };
  }
}

/** Named params object from form values (blank fields fall back to defaults; blank optional fields are omitted). */
export function compileParams(method: MethodSpec, values: Record<string, string>, raw: string | null = null): { params: RpcParams; error?: never } | { error: string; params?: never } {
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "Raw parameters must be a JSON object, e.g. {\"height\":\"944000\"}." };
      const out: RpcParams = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number") out[k] = String(v);
        else if (typeof v === "string") out[k] = v;
        else return { error: `${k} must be a string (TM2 encodes integers as strings).` };
      }
      return { params: out };
    } catch { return { error: "Enter valid JSON parameters." }; }
  }
  const converted: Record<string, string> = {};
  for (const p of method.params) {
    const given = values[p.key] ?? "";
    const value = given.trim() ? given : p.default ?? "";
    if (!value.trim()) { if (p.optional) continue; return { error: `${p.label} is required for ${method.id}.` }; }
    const c = convert(p, value);
    if (c.error !== undefined) return { error: c.error };
    converted[p.key] = c.value;
  }
  if (method.id === "blockchain" && Number(converted.minHeight) > Number(converted.maxHeight)) return { error: "min height must not exceed max height." };
  return { params: method.build ? method.build(converted) : converted };
}

/** Map a raw params object back to fields; null when it can't be represented (presets build their params). */
export function formFromRaw(method: MethodSpec, raw: string): Record<string, string> | null {
  if (method.build) return null;
  const compiled = compileParams(method, {}, raw);
  if (compiled.error !== undefined) return null;
  if (Object.keys(compiled.params).some(k => !method.params.some(p => p.key === k))) return null;
  return compiled.params;
}

export function curlCommand(url: string, body: unknown): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return `curl -s -X POST ${quote(url)} \\\n  -H 'content-type: application/json' \\\n  --data ${quote(JSON.stringify(body))}`;
}

/**
 * Readable form of an abci_query answer: the error type, or Data decoded
 * from base64 (pretty-printed when it is JSON).
 */
export function decodeAbci(result: unknown): { error: string | null; text: string | null; json: boolean; log: string | null } | null {
  const rb = (result as { response?: { ResponseBase?: { Error?: unknown; Data?: string | null; Log?: string } } } | null)?.response?.ResponseBase;
  if (!rb) return null;
  const error = rb.Error ? (typeof rb.Error === "object" && rb.Error && "@type" in rb.Error ? String((rb.Error as Record<string, unknown>)["@type"]) : JSON.stringify(rb.Error)) : null;
  const log = rb.Log ? rb.Log.split("\n")[0].slice(0, 400) : null;
  if (!rb.Data) return { error, text: null, json: false, log };
  const text = fromBase64(rb.Data);
  if (text === null) return { error, text: `<binary · ${rb.Data.length} base64 chars>`, json: false, log };
  try { return { error, text: JSON.stringify(JSON.parse(text), null, 2), json: true, log }; } catch { return { error, text, json: false, log }; }
}
