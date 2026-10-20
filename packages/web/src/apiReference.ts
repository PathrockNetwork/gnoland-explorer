/** Routes implemented by this explorer's REST API (packages/api), not upstream Tendermint2 RPC methods. */
export type ApiParameter = { name: string; location: "path" | "query"; description: string; default?: string; min?: number; max?: number; choices?: string[]; pattern?: RegExp; required?: boolean };
export type ApiEndpoint = { id: string; method: "GET"; path: string; title: string; description: string; response: string; category: string; tags: string[]; overview?: boolean; parameters?: ApiParameter[]; binary?: boolean };

const ADDR = /^g1[02-9ac-hj-np-z]{38}$/;
const HASH = /^([A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43}=?|(0x)?[0-9a-fA-F]{64})$/;
const PKG = /^gno\.land\/[rpe]\/[a-z0-9_./-]+$/i;
const limit = (def = "25"): ApiParameter => ({ name: "limit", location: "query", default: def, min: 1, max: 100, description: `Rows returned (1–100, default ${def}).` });
const hours = (max: number, choices?: string[]): ApiParameter => ({ name: "hours", location: "query", default: "24", ...(choices ? { choices } : { min: 1, max }), description: `Trailing window in hours (1–${max.toLocaleString("en-US")}, default 24).` });
const pkgPath = (description = "Package path, e.g. gno.land/r/gov/dao."): ApiParameter => ({ name: "path", location: "query", required: true, pattern: PKG, description });
const hashParam: ApiParameter = { name: "hash", location: "path", pattern: HASH, description: "Transaction hash: base64 (URL-encode + / =), base64url as in explorer links, or 64 hex characters." };
const addrParam: ApiParameter = { name: "addr", location: "path", pattern: ADDR, description: "bech32 g1… address." };
const TX_ROW = "{ hash (base64), height, tx_index, time, success, signer, gas_wanted, gas_used, fee, fee_denom, memo, kinds[] (vm/exec | vm/add_package | vm/run | bank/send), pkg_paths[], funcs[], messages[] { route, type, kind, value }, error, storage_delta }";

export const API_BASE = "/api/v1";
export const API_CATEGORIES = ["Overview", "Network", "Blocks", "Transactions", "Accounts", "Validators", "Realms", "Tokens", "Governance", "Analytics", "Service"];
export const API_ENDPOINTS: ApiEndpoint[] = [
  { id: "stats", method: "GET", path: "/api/v1/stats", title: "Network snapshot", category: "Network", tags: ["network", "indexer", "supply"], overview: true,
    description: "Chain and indexer heights and lag, block cadence, TPS, 24 h totals, validator counts, signing rate, package counts, GNOT supply and per-minute activity for the last 30 minutes.",
    response: "Object: chain_id, indexed_head, chain_height, indexer_height, lag_blocks, indexer_updated_at, signature_floor, avg_block_time_ms, tps, blocks_24h, txs_24h, total_txs, genesis_time, active_accounts_24h, validators_active, valoper_profiles, voting_power, signing_rate, packages { total, realms, pure, deployed_24h }, supply { denom, height, total, locked, spendable }, recent_minutes[] { t, blocks, txs }, rpc[] { url, healthy, benchedUntil, lastError, latencyMs }." },
  { id: "endpoints", method: "GET", path: "/api/v1/endpoints", title: "Upstream endpoint health", category: "Network", tags: ["network", "rpc", "tx-indexer"],
    description: "Server-side probe of the Tendermint2 RPC (status, net_info) and the tx-indexer (latestBlockHeight), cached for 15 seconds.",
    response: "Object: endpoints[] { url, kind (\"rpc\" | \"tx-indexer\"), ok, latency_ms, height, block_time, catching_up, network, version, moniker, peers, error }, client[] (the API's RPC client state)." },
  { id: "config", method: "GET", path: "/api/v1/config", title: "Deployment configuration", category: "Network", tags: ["network", "configuration"],
    description: "Chain identity, currency, upstream URLs and what the deployment indexes.",
    response: "Object: chain_id, denom (ugnot), decimals (6), symbol (GNOT), rpc[], tx_indexer, features { signature_depth, signature_windows[], full_history }." },
  { id: "blocks", method: "GET", path: "/api/v1/blocks", title: "Recent blocks", category: "Blocks", tags: ["blocks", "pagination"], overview: true,
    parameters: [limit(), { name: "before", location: "query", min: 1, max: Number.MAX_SAFE_INTEGER, description: "Only blocks below this height (pagination cursor)." }, { name: "with_txs", location: "query", choices: ["", "1"], description: "1 = only blocks that contain transactions." }],
    description: "Newest indexed blocks first, with proposer moniker and precommit counts where signatures were read.",
    response: "Object: source, blocks[] { height, hash, time, proposer, proposer_moniker, tx_count, total_txs, app_hash, signed, missed }." },
  { id: "block", method: "GET", path: "/api/v1/blocks/:id", title: "Block details", category: "Blocks", tags: ["blocks"], overview: true,
    parameters: [{ name: "id", location: "path", pattern: /^(\d+|[A-Za-z0-9+/_-]{43}=?|(0x)?[0-9a-fA-F]{64})$/, description: "Block height, or the block hash (base64, base64url or hex)." }],
    description: "One block with its transactions and the validators that missed its precommit. Heights newer than the indexed head are read through from the tx-indexer (source: \"indexer\").",
    response: `Object: source, block { …same fields as the list }, txs[] ${TX_ROW}, missed[] { validator, moniker }, names { address: username }. 404 when unknown.` },
  { id: "txs", method: "GET", path: "/api/v1/txs", title: "Transactions", category: "Transactions", tags: ["transactions", "pagination", "filter"], overview: true,
    parameters: [limit(), { name: "before", location: "query", pattern: /^\d+:\d+$/, description: "Cursor \"height:index\" of the previous page's last row." }, { name: "address", location: "query", pattern: ADDR, description: "Only transactions involving this g1 address (any role)." }, { name: "pkg", location: "query", pattern: PKG, description: "Only transactions that call, deploy or run this package path." }, { name: "kind", location: "query", choices: ["", "vm/exec", "vm/add_package", "vm/run", "bank/send"], description: "Only transactions with a message of this kind." }, { name: "func", location: "query", description: "Only calls of this function, as <pkgpath>.<Func>." }, { name: "failed", location: "query", choices: ["", "1"], description: "1 = only failed transactions." }],
    description: "Indexed transactions, newest first. Fees are total ugnot paid (not per gas unit).",
    response: `Object: source, txs[] ${TX_ROW}, names { address: username }.` },
  { id: "tx", method: "GET", path: "/api/v1/txs/:hash", title: "Transaction details", category: "Transactions", tags: ["transactions", "events"], overview: true, parameters: [hashParam],
    description: "One transaction with decoded messages, realm events, storage deposits and GRC20/GRC721 transfers. Falls back to the tx-indexer when it is not indexed yet.",
    response: "Object: source, tx { …transaction row, addresses[], log, confirmations }, events[] { idx, kind (gno | storage_deposit | storage_unlock | transfer), pkg_path, type, attrs[], from, to, amount, denom, bytes_delta }, token_transfers[] { idx, token, standard, from, to, value }, names. 404 when unknown." },
  { id: "search", method: "GET", path: "/api/v1/search", title: "Search", category: "Transactions", tags: ["search"],
    parameters: [{ name: "q", location: "query", required: true, description: "Block height, tx or block hash, g1 address, @username, package path or gno.land URL." }],
    description: "Resolve free text to the page that shows it.",
    response: "Object: type (\"block\" | \"tx\" | \"address\" | \"package\") and id. 400 for unrecognised input, 404 for an unknown hash." },
  { id: "address", method: "GET", path: "/api/v1/address/:addr", title: "Account summary", category: "Accounts", tags: ["address", "balance", "username"], overview: true, parameters: [addrParam],
    description: "Live balances, account number and sequence (ABCI queries), username, activity counts from the index, deployed packages and validator role.",
    response: "Object: address, username, balances[] { amount, denom } | null, ugnot, account_number, sequence, public_key, txs, sent, first_seen, last_seen, storage_bytes, packages[] { path, kind, height, time }, validator { address, moniker, in_set, voting_power, role, blocks_proposed } | null." },
  { id: "address-tokens", method: "GET", path: "/api/v1/address/:addr/tokens", title: "Account tokens", category: "Accounts", tags: ["address", "grc20", "grc721"], parameters: [addrParam],
    description: "GRC20/GRC721 tokens an address has sent or received, with live balances where the realm exposes them, and its latest 50 token transfers.",
    response: "Object: address, tokens[] { key, realm, symbol, standard, registered, name, decimals, total_supply, balance }, transfers[] { tx_hash, height, time, token, standard, from, to, value }." },
  { id: "validators", method: "GET", path: "/api/v1/validators", title: "Validator list", category: "Validators", tags: ["validators", "uptime"], overview: true,
    description: "Validators in the set plus valoper candidates, with voting power, proposal counts and signing uptime over trailing windows. gno.land has no staking.",
    response: "Object: total_power, blocks_indexed, since, signed_blocks, signature_head, synced_at, windows[] (e.g. 100, 1000, 10000), validators[] { address, pub_key, moniker, description, server_type, operator, operator_name, in_set, voting_power, power_share, first_seen_height, blocks_proposed, proposed_share, proposed_recent, last_proposed_height, last_proposed_time, missed[], uptime[], missed_streak, last_missed_height }." },
  { id: "validator", method: "GET", path: "/api/v1/validators/:address", title: "Validator details", category: "Validators", tags: ["validators"],
    parameters: [{ name: "address", location: "path", pattern: ADDR, description: "Consensus (signing) or operator g1 address." }],
    description: "One validator with its recent proposals, missed blocks, proposals per day and a 200-block signing strip.",
    response: "Object: validator { … }, recent_blocks[] { height, time, tx_count }, missed_blocks[] { height, time }, proposed_per_day[] { day, proposed }, signing_strip[] { height, signed }. 404 when unknown." },
  { id: "validator-set", method: "GET", path: "/api/v1/validator-set", title: "Validator set history", category: "Validators", tags: ["validators", "govdao"],
    description: "Each distinct validator set (by validators_hash) and the height range it was active for.",
    response: "Object: sets[] { hash, from_height, to_height, since, members[] { address, pub_key, voting_power, moniker } | null }." },
  { id: "packages", method: "GET", path: "/api/v1/packages", title: "Packages", category: "Realms", tags: ["realms", "packages", "pagination"], overview: true,
    parameters: [{ name: "kind", location: "query", choices: ["", "realm", "pure"], description: "realm (r/) or pure package (p/)." }, { name: "q", location: "query", description: "Substring of the package path." }, { name: "creator", location: "query", pattern: ADDR, description: "Only packages deployed by this address." }, { name: "namespace", location: "query", description: "Only packages under this path prefix, e.g. gno.land/r/gnoswap." }, { name: "sort", location: "query", default: "recent", choices: ["recent", "calls", "storage", "name"], description: "Order of the rows." }, limit("50"), { name: "offset", location: "query", min: 0, max: Number.MAX_SAFE_INTEGER, description: "Rows to skip." }],
    description: "Deployed realms and pure packages with call activity and storage.",
    response: "Object: total, offset, packages[] { path, name, kind, creator, creator_name, height, tx_hash, time, source_bytes, file_count, status, calls, calls_24h, callers, last_call, storage_bytes, storage_deposit }, totals { total, realms, pure, creators, source_bytes }." },
  { id: "namespaces", method: "GET", path: "/api/v1/namespaces", title: "Namespaces", category: "Realms", tags: ["realms", "namespaces"],
    description: "Top-level namespaces (r/<name>, p/<name>) with package counts and owners.",
    response: "Object: namespaces[] { kind_letter, namespace, packages, first_deploy, last_deploy, owner }." },
  { id: "package", method: "GET", path: "/api/v1/package", title: "Package details", category: "Realms", tags: ["realms", "functions"], overview: true, parameters: [pkgPath()],
    description: "Deployment, exported functions (vm/qfuncs), child packages, most-called functions, top callers, event types, storage and daily transactions.",
    response: "Object: path, kind, indexed, package { …row, files[], max_deposit, status } | null, funcs[] { name, params[], results[] } | null, children[], top_funcs[], callers[], event_types[], storage_series[], daily_txs[], co_called[]. 404 when unknown." },
  { id: "package-source", method: "GET", path: "/api/v1/package/source", title: "Package source", category: "Realms", tags: ["realms", "source"],
    parameters: [pkgPath(), { name: "name", location: "query", description: "File name, e.g. render.gno. Omit to list files." }],
    description: "File list, or one file's source, read live with vm/qfile.",
    response: "Object: path, files[] — or with name: path, name, size, truncated, body." },
  { id: "package-render", method: "GET", path: "/api/v1/package/render", title: "Realm render", category: "Realms", tags: ["realms", "render", "markdown"],
    parameters: [pkgPath("Realm path, e.g. gno.land/r/gov/dao."), { name: "args", location: "query", description: "Render path (the part after : in a gno.land URL). Up to 512 characters." }],
    description: "Markdown returned by the realm's Render(path), via vm/qrender.",
    response: "Object: path, args, truncated, markdown. Errors carry the VM error type." },
  { id: "storage", method: "GET", path: "/api/v1/storage", title: "Realm storage", category: "Realms", tags: ["storage", "deposits"],
    description: "Bytes stored by realms and the GNOT locked as storage deposits: totals, top realms, daily series and recent deposits/unlocks.",
    response: "Object: bytes, deposit (ugnot), deposits, unlocks, bytes_24h, price_per_byte, top[] { path, bytes, deposit, writes, last_write }, series[] { day, written, freed, total, deposit }, recent[] { tx_hash, height, time, kind, pkg_path, bytes_delta, amount, signer }." },
  { id: "events", method: "GET", path: "/api/v1/events", title: "Realm events", category: "Realms", tags: ["events", "pagination"],
    parameters: [{ name: "pkg", location: "query", description: "Only events emitted by this package path." }, { name: "type", location: "query", description: "Only events of this type, e.g. Transfer." }, { name: "before", location: "query", min: 1, max: Number.MAX_SAFE_INTEGER, description: "Only events below this height." }, limit("50")],
    description: "chain.Emit events, newest first, plus the most frequent event types of the last 7 days.",
    response: "Object: events[] { tx_hash, idx, height, time, pkg_path, type, attrs[] { key, value } }, top_types_7d[] { pkg_path, type, n }." },
  { id: "tokens", method: "GET", path: "/api/v1/tokens", title: "Tokens", category: "Tokens", tags: ["grc20", "grc721"], overview: true,
    description: "GRC20 and GRC721 tokens seen in transfer events, with registry metadata and transfer activity.",
    response: "Object: tokens[] { key, realm, symbol, standard, registered, name, decimals, total_supply, transfers, transfers_24h, receivers, last_transfer }." },
  { id: "token", method: "GET", path: "/api/v1/token", title: "Token details", category: "Tokens", tags: ["grc20", "transfers"],
    parameters: [{ name: "key", location: "query", required: true, description: "Token key, <realm path>.<symbol>, e.g. gno.land/r/gnoswap/gns.GNS." }],
    description: "One token with its latest 50 transfers, top receivers and daily transfer counts.",
    response: "Object: token { … }, transfers[], top_receivers[] { address, received }, daily[] { day, transfers }, names. 404 when unknown." },
  { id: "govdao", method: "GET", path: "/api/v1/govdao", title: "GovDAO", category: "Governance", tags: ["govdao", "proposals", "members"], overview: true,
    description: "GovDAO proposals (synced from r/gov/dao), tiered members and vote transactions.",
    response: "Object: proposals[] { id, title, author, status, tiers, yes_pct, no_pct, abstain_pct, executor, votes { YES: { T1: [] } … }, synced_at }, members[] { tier, address, username }, votes[] { hash, height, time, voter, voter_name, success, proposal, option }." },
  { id: "proposal", method: "GET", path: "/api/v1/govdao/:id", title: "Proposal details", category: "Governance", tags: ["govdao", "proposals"],
    parameters: [{ name: "id", location: "path", min: 0, max: Number.MAX_SAFE_INTEGER, description: "Proposal id." }],
    description: "One GovDAO proposal with its body and every vote transaction.",
    response: "Object: proposal { …, body }, vote_txs[]. 404 when unknown." },
  { id: "series", method: "GET", path: "/api/v1/series", title: "Activity series", category: "Analytics", tags: ["analytics", "series"], overview: true, parameters: [hours(2160)],
    description: "Per-bucket blocks, transactions, gas, fees, failures, distinct senders, message kinds and storage. Buckets are 1 min (≤1 h), 5 min (≤6 h), 15 min (≤24 h), 1 h (≤7 d) or 1 day.",
    response: "Object: hours, bucket_secs, points[] { t, blocks, txs, avg_missed, gas, fees, failed, senders, deploys, calls, sends, runs, storage_delta }." },
  { id: "analytics", method: "GET", path: "/api/v1/analytics", title: "Usage analytics", category: "Analytics", tags: ["analytics", "realms", "senders"], parameters: [hours(8760)],
    description: "Who uses gno.land over a window: top realms, functions and senders, message mix, gas efficiency, median gas price, deployments and failure reasons. Cached for 30 seconds.",
    response: "Object: hours, realms[] { path, txs, senders, failed, gas, fees }, funcs[] { func, calls }, senders[] { address, txs, fees, username }, kinds[] { kind, n }, gas { txs, avg_gas_used, avg_gas_wanted, gas_efficiency, fees, median_gas_price (ugnot per gas) }, deploys { n, realms, creators }, failures[] { error, n }." },
  { id: "metrics", method: "GET", path: "/api/v1/metrics", title: "Block production", category: "Analytics", tags: ["analytics", "proposers", "block time"], parameters: [hours(2160)],
    description: "Blocks proposed per validator and block-time percentiles over a window.",
    response: "Object: hours, proposers[] { proposer, moniker, blocks }, block_time { p50, p90, p99, avg, max } (seconds)." },
  { id: "health", method: "GET", path: "/health", title: "Health check", category: "Service", tags: ["health", "service"],
    description: "Returns once the API can query its database.",
    response: "Object: { ok: true }. 5xx when the database is unreachable." },
  { id: "version", method: "GET", path: "/api/v1/version", title: "Deployed web build", category: "Service", tags: ["service", "build"],
    description: "Name of the web bundle currently served, so long-lived tabs can offer a reload.",
    response: "Object: web (bundle path or null)." },
];
export function filterApiEndpoints(category: string, search: string): ApiEndpoint[] {
  const q = search.trim().toLowerCase();
  return API_ENDPOINTS.filter(e => (q ? `${e.method} ${e.path} ${e.title} ${e.description} ${e.response} ${e.tags.join(" ")}`.toLowerCase().includes(q) : category === "Overview" ? e.overview : e.category === category));
}
export function apiRequestPath(endpoint: ApiEndpoint, values: Record<string, string>): { path: string; error?: never } | { error: string; path?: never } {
  let path = endpoint.path;
  const query = new URLSearchParams();
  for (const p of endpoint.parameters ?? []) {
    const value = (values[p.name] ?? p.default ?? "").trim();
    if (!value && p.location === "query" && !p.required) continue;
    if (!value) return { error: `${p.name} is required.` };
    if (p.pattern && !p.pattern.test(value)) return { error: `${p.name}: ${p.description}` };
    if (p.choices && !p.choices.includes(value)) return { error: `${p.name} must be ${p.choices.join(", ")}.` };
    if (p.min !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < p.min || Number(value) > p.max!)) return { error: `${p.name} must be a whole number between ${p.min.toLocaleString("en-US")} and ${p.max!.toLocaleString("en-US")}.` };
    if (p.location === "path") path = path.replace(`:${p.name}`, encodeURIComponent(value)); else query.set(p.name, value);
  }
  const qs = query.toString();
  return { path: path + (qs ? `?${qs}` : "") };
}
export function apiCurl(origin: string, path: string): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return `curl --request GET \\\n  --url ${quote(origin + path)} \\\n  --header 'Accept: application/json'`;
}
/** Preview only: copying always uses the untouched response. */
export function apiPreview(body: string, maxLines = 7): string {
  const lines = body.split("\n");
  const preview = lines.slice(0, maxLines).map(line => line.length > 240 ? line.slice(0, 240) + "…" : line).join("\n");
  return preview + (lines.length > maxLines ? `\n… ${lines.length - maxLines} more lines` : "");
}
