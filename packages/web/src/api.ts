/** Typed client for the gno.land explorer REST API. Shapes mirror packages/api. */
import { txSlug } from "./lib";

/**
 * Drives which variant every panel renders. `dberror` is synthesised in the
 * client when the API itself is unreachable.
 */
export type SystemState = "normal" | "loading" | "empty" | "stopped" | "dberror" | "backfill";

/** db = indexed in Postgres; indexer = read through from the tx-indexer (newer than the indexed head). */
export type Source = "db" | "indexer";

export type RpcStatus = { url: string; healthy: boolean; benchedUntil: number; lastError: string | null; latencyMs: number | null };

export type Coin = { amount: string; denom: string };

/** /api/v1/stats — the chain + indexer snapshot every page reads. */
export type Network = {
  chain_id: string;
  indexed_head: number | null;
  chain_height: number | null;
  indexer_height: number | null;
  lag_blocks: number | null;
  indexer_updated_at: string | null;
  /** Lowest height commit signatures are read down to. */
  signature_floor: number | null;
  avg_block_time_ms: number | null;
  tps: number | null;
  blocks_24h: number;
  txs_24h: number;
  /** Chain-wide transaction count (excluding the genesis set). */
  total_txs: number | null;
  genesis_time: string | null;
  active_accounts_24h: number | null;
  validators_active: number;
  /** Operator profiles registered in r/gnops/valopers (candidates included). */
  valoper_profiles: number;
  voting_power: number;
  /** Share of expected precommits present over the newest 1,000 read blocks. */
  signing_rate: number | null;
  packages: { total: number; realms: number; pure: number; deployed_24h: number } | null;
  /** ugnot supply from the tx-indexer; most of it is still vesting (locked). */
  supply: { denom: string; height: number; total: string; locked: string; spendable: string } | null;
  /** Per-minute blocks/txs over the last 30 minutes, oldest first. */
  recent_minutes: { t: string; blocks: number; txs: number }[];
  rpc: RpcStatus[];
};

export type Block = {
  height: number;
  hash: string;
  time: string;
  /** Consensus address (g1…) of the proposer. */
  proposer: string;
  proposer_moniker: string | null;
  tx_count: number;
  total_txs: number;
  app_hash: string | null;
  /** Precommits present; null when signatures were not read for this block. */
  signed: number | null;
  missed: number | null;
};

/** A message as stored. `kind` is the indexer's type name. */
export type Message = {
  route: string; // vm | bank
  type: string; // exec | add_package | run | send | …
  kind: "MsgCall" | "MsgAddPackage" | "MsgRun" | "BankMsgSend" | "MsgEnablePackage" | "MsgRejectPackage" | "UnexpectedMessage" | string;
  /**
   * MsgCall: caller, send, pkg_path, func, args[], max_deposit
   * MsgAddPackage: creator, send, max_deposit, package {name, path, files[{name,size}]}
   * MsgRun: caller, send, max_deposit, package {…}
   * BankMsgSend: from_address, to_address, amount ("100ugnot")
   * MsgEnablePackage: approver, pkg_path, pkg_hash, pkg_height · MsgRejectPackage: sender, pkg_path
   */
  value: Record<string, any>;
};

export type Tx = {
  hash: string;
  height: number;
  tx_index: number;
  time: string;
  success: boolean;
  /** First message's caller / sender / creator. */
  signer: string | null;
  gas_wanted: number;
  gas_used: number;
  /** Total fee paid (not per gas unit), in fee_denom. */
  fee: string;
  fee_denom: string | null;
  memo: string | null;
  /** `route/type` per message: vm/exec, vm/add_package, vm/run, bank/send. */
  kinds: string[];
  pkg_paths: string[];
  /** `pkg_path.Func` per MsgCall. */
  funcs: string[];
  messages: Message[];
  error: string | null;
  /** Net storage bytes this transaction added (+) or freed (−). */
  storage_delta: number;
};

/** { address: username } for addresses mentioned in a response. */
export type Names = Record<string, string>;

export type TxEvent = {
  idx: number;
  kind: "gno" | "storage_deposit" | "storage_unlock" | "transfer" | "unknown";
  pkg_path: string | null;
  type: string | null;
  attrs: { key: string; value: string }[] | null;
  from: string | null;
  to: string | null;
  amount: string | null;
  denom: string | null;
  bytes_delta: number | null;
};

export type TokenTransfer = {
  idx: number;
  token: string;
  standard: "grc20" | "grc721";
  from: string | null;
  to: string | null;
  value: string;
  tx_hash?: string;
  height?: number;
  time?: string;
};

export type TxDetail = {
  source: Source;
  tx: Tx & { addresses: string[]; log: string | null; confirmations: number | null };
  events: TxEvent[];
  /** With the token's symbol and decimals when known. */
  token_transfers: (TokenTransfer & { symbol: string | null; decimals: number | null })[];
  names: Names;
};

export type BlockDetail = {
  source: Source;
  block: Block;
  txs: Tx[];
  /** Validators in the set that did not precommit this block. */
  missed: { validator: string; moniker: string | null }[];
  names: Names;
};

export type AddressInfo = {
  address: string;
  username: string | null;
  /** Live bank balances (null when the RPC could not be reached). */
  balances: Coin[] | null;
  ugnot: string | null;
  account_number: string | null;
  sequence: string | null;
  public_key: unknown;
  txs: number;
  sent: number;
  first_seen: string | null;
  last_seen: string | null;
  /** Net realm storage this address's transactions added, in bytes. */
  storage_bytes: number;
  packages: { path: string; kind: string; height: number; time: string }[];
  validator: { address: string; moniker: string | null; in_set: boolean; voting_power: number; role: "operator" | "signer"; blocks_proposed: number } | null;
};

export type TokenInfo = {
  key: string;
  realm: string;
  symbol: string;
  standard: "grc20" | "grc721";
  registered: boolean;
  name: string | null;
  decimals: number | null;
  total_supply: string | null;
};

export type AddressTokens = {
  address: string;
  tokens: (TokenInfo & { balance: string | null })[];
  transfers: (TokenTransfer & { tx_hash: string; height: number; time: string })[];
};

export type Validator = {
  /** Consensus (signing) address. */
  address: string;
  pub_key: string | null;
  moniker: string | null;
  description: string | null;
  server_type: string | null;
  /** Operator account that registered the valopers profile. */
  operator: string | null;
  operator_name: string | null;
  in_set: boolean;
  voting_power: number;
  power_share: number | null;
  first_seen_height: number | null;
  blocks_proposed: number;
  proposed_share: number | null;
  /** Proposals among the newest 1,000 blocks. */
  proposed_recent: number;
  last_proposed_height: number | null;
  last_proposed_time: string | null;
  /** Missed precommits per window (see ValidatorList.windows); null when not in the set. */
  missed: (number | null)[];
  uptime: (number | null)[];
  missed_streak: number | null;
  last_missed_height: number | null;
};

export type ValidatorList = {
  total_power: number;
  blocks_indexed: number;
  since: string | null;
  /** Blocks whose signatures have been read. */
  signed_blocks: number;
  signature_head: number | null;
  synced_at: string | null;
  /** Window sizes (blocks) for Validator.missed / uptime, e.g. [100, 1000, 10000]. */
  windows: number[];
  validators: Validator[];
};

export type ValidatorDetail = {
  validator: Validator;
  recent_blocks: { height: number; time: string; tx_count: number }[];
  missed_blocks: { height: number; time: string }[];
  proposed_per_day: { day: string; proposed: number }[];
  /** Newest 200 read blocks, oldest first. */
  signing_strip: { height: number; signed: boolean }[];
};

export type ValidatorSets = {
  sets: { hash: string; from_height: number; to_height: number; since: string; members: { address: string; pub_key: string; voting_power: number; moniker: string | null }[] | null }[];
};

export type SeriesPoint = {
  t: string;
  blocks: number;
  txs: number;
  avg_missed: number | null;
  gas: number;
  fees: number;
  failed: number;
  senders: number;
  deploys: number;
  calls: number;
  sends: number;
  runs: number;
  storage_delta: number;
};
export type Series = { hours: number; bucket_secs: number; points: SeriesPoint[] };

export type Metrics = {
  hours: number;
  proposers: { proposer: string; moniker: string | null; blocks: number }[];
  /** Seconds between consecutive blocks. */
  block_time: { p50: number | null; p90: number | null; p99: number | null; avg: number | null; max: number | null };
};

export type Analytics = {
  hours: number;
  realms: { path: string; txs: number; senders: number; failed: number; gas: number; fees: number }[];
  funcs: { func: string; calls: number }[];
  senders: { address: string; txs: number; fees: number; username: string | null }[];
  kinds: { kind: string; n: number }[];
  gas: { txs: number; avg_gas_used: number | null; avg_gas_wanted: number | null; gas_efficiency: number | null; fees: number | null; median_gas_price: number | null } | null;
  deploys: { n: number; realms: number; creators: number } | null;
  failures: { error: string; n: number }[];
};

export type Endpoint = {
  url: string;
  kind: "rpc" | "tx-indexer";
  ok: boolean;
  latency_ms: number | null;
  height: number | null;
  block_time?: string;
  catching_up?: boolean;
  network?: string;
  version?: string;
  moniker?: string;
  peers?: number | null;
  error: string | null;
};

export type EndpointList = { endpoints: Endpoint[]; client: RpcStatus[] };

export type Config = {
  chain_id: string;
  denom: string;
  decimals: number;
  symbol: string;
  rpc: string[];
  tx_indexer: string;
  features: { signature_depth: string; signature_windows: number[]; full_history: boolean };
};

export type PackageRow = {
  path: string;
  name: string;
  kind: "realm" | "pure" | "ephemeral";
  creator: string;
  creator_name?: string | null;
  height: number;
  tx_hash: string;
  time: string;
  source_bytes: number;
  file_count: number;
  status?: "live" | "inert" | "rejected";
  calls: number;
  calls_24h: number;
  callers: number;
  last_call: string | null;
  storage_bytes: number;
  /** ugnot currently locked as this package's storage deposit. */
  storage_deposit: string;
};

export type PackageList = {
  total: number;
  offset: number;
  packages: PackageRow[];
  totals: { total: number; realms: number; pure: number; creators: number; source_bytes: number };
};

export type FuncSig = { name: string; params: { name: string; type: string }[]; results: { name: string; type: string }[] };

export type PackageDetail = {
  path: string;
  kind: "realm" | "pure" | "ephemeral";
  /** False for a package on chain that the index has no deployment for. */
  indexed: boolean;
  package: (PackageRow & { files: { name: string; size: number }[]; max_deposit: string | null; status: string }) | null;
  /** Exported functions (null when the VM does not know the package). */
  funcs: FuncSig[] | null;
  children: { path: string; kind: string }[];
  top_funcs: { func: string; name: string; calls: number; last_call: string }[];
  callers: { address: string; txs: number; username: string | null }[];
  event_types: { type: string; n: number; last: string }[];
  storage_series: { day: string; bytes: number; total: number }[];
  daily_txs: { day: string; txs: number }[];
  /** Other packages touched in the same transactions. */
  co_called: { path: string; n: number }[];
};

export type PackageSource = { path: string; files?: string[]; name?: string; size?: number; truncated?: boolean; body?: string };
export type PackageRender = { path: string; args: string; truncated: boolean; markdown: string };

export type Namespaces = { namespaces: { kind_letter: string; namespace: string; packages: number; first_deploy: string; last_deploy: string; owner: string | null }[] };

export type Storage = {
  bytes: number;
  /** ugnot locked as storage deposits. */
  deposit: string;
  deposits: number;
  unlocks: number;
  bytes_24h: number;
  /** ugnot per byte. */
  price_per_byte: number | null;
  top: { path: string; bytes: number; deposit: string; writes: number; last_write: string }[];
  series: { day: string; written: number; freed: number; total: number; deposit: string }[];
  recent: { tx_hash: string; height: number; time: string; kind: string; pkg_path: string; bytes_delta: number; amount: string; signer: string }[];
  names: Names;
};

export type GnoEventRow = { tx_hash: string; idx: number; height: number; time: string; pkg_path: string | null; type: string | null; attrs: { key: string; value: string }[] };
export type EventFeed = { events: GnoEventRow[]; top_types_7d: { pkg_path: string; type: string; n: number }[] };

export type Proposal = {
  id: number;
  title: string;
  /** "@username" or a g1 address. */
  author: string | null;
  status: string;
  tiers: string | null;
  yes_pct: number | null;
  no_pct: number | null;
  abstain_pct: number | null;
  executor: string | null;
  body?: string;
  /** { YES: { T1: ["@aeddi", "g1…"] }, … } */
  votes: Record<string, Record<string, string[]>> | null;
  synced_at: string;
};

/**
 * A GovDAO action: a direct MustVoteOnProposal* call (proposal + option known),
 * or a MsgRun script importing the DAO (often create + vote; read its source).
 */
export type VoteTx = { hash: string; height: number; time: string; voter: string; voter_name: string | null; success: boolean; via: "call" | "script"; proposal: number | null; option: string | null };

export type GovDao = { proposals: Proposal[]; members: { tier: string; address: string; username: string | null }[]; votes: VoteTx[] };
export type ProposalDetail = { proposal: Proposal; vote_txs: VoteTx[] };

export type TokenRow = TokenInfo & { transfers: number; transfers_24h: number; receivers: number; last_transfer: string | null };
export type TokenList = { tokens: TokenRow[] };
export type TokenDetail = {
  token: TokenRow;
  transfers: (TokenTransfer & { tx_hash: string; height: number; time: string })[];
  top_receivers: { address: string; received: number }[];
  daily: { day: string; transfers: number }[];
  names: Names;
};

export type SearchResult = { type: "block" | "tx" | "address" | "package"; id: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const enc = encodeURIComponent;

export const getNetwork = () => get<Network>("/api/v1/stats");
export const getSeries = (hours = 24) => get<Series>(`/api/v1/series?hours=${hours}`);
export const getBlocks = (limit = 25, opts: { before?: number; withTxs?: boolean } = {}) =>
  get<{ source: Source; blocks: Block[] }>(`/api/v1/blocks${qs({ limit, before: opts.before, with_txs: opts.withTxs ? 1 : undefined })}`);
export const getBlock = (id: number | string) => get<BlockDetail>(`/api/v1/blocks/${enc(String(id))}`);
export const getTransactions = (
  limit = 25,
  opts: { before?: string; address?: string; pkg?: string; kind?: string; func?: string; failed?: boolean } = {},
) => get<{ source: Source; txs: Tx[]; names: Names }>(`/api/v1/txs${qs({ limit, ...opts })}`);
export const getTransaction = (hash: string) => get<TxDetail>(`/api/v1/txs/${enc(hash)}`);
export const getAddress = (address: string) => get<AddressInfo>(`/api/v1/address/${enc(address)}`);
export const getAddressTokens = (address: string) => get<AddressTokens>(`/api/v1/address/${enc(address)}/tokens`);
export const getValidators = () => get<ValidatorList>("/api/v1/validators");
export const getValidatorDetail = (address: string) => get<ValidatorDetail>(`/api/v1/validators/${enc(address)}`);
export const getValidatorSets = () => get<ValidatorSets>("/api/v1/validator-set");
export const getMetrics = (hours = 24) => get<Metrics>(`/api/v1/metrics?hours=${hours}`);
export const getAnalytics = (hours = 24) => get<Analytics>(`/api/v1/analytics?hours=${hours}`);
export const getEndpoints = () => get<EndpointList>("/api/v1/endpoints");
export const getConfig = () => get<Config>("/api/v1/config");
export const getPackages = (opts: { kind?: "realm" | "pure"; q?: string; creator?: string; namespace?: string; sort?: "recent" | "calls" | "storage" | "name"; limit?: number; offset?: number } = {}) =>
  get<PackageList>(`/api/v1/packages${qs(opts)}`);
export const getNamespaces = () => get<Namespaces>("/api/v1/namespaces");
export const getPackage = (path: string) => get<PackageDetail>(`/api/v1/package${qs({ path })}`);
export const getPackageFiles = (path: string) => get<PackageSource>(`/api/v1/package/source${qs({ path })}`);
export const getPackageFile = (path: string, name: string) => get<PackageSource>(`/api/v1/package/source${qs({ path, name })}`);
export const getRender = (path: string, args = "") => get<PackageRender>(`/api/v1/package/render${qs({ path, args })}`);
export const getStorage = () => get<Storage>("/api/v1/storage");
export const getEvents = (opts: { pkg?: string; type?: string; before?: number; limit?: number } = {}) => get<EventFeed>(`/api/v1/events${qs(opts)}`);
export const getGovDao = () => get<GovDao>("/api/v1/govdao");
export const getProposal = (id: number) => get<ProposalDetail>(`/api/v1/govdao/${id}`);
export const getTokens = () => get<TokenList>("/api/v1/tokens");
export const getToken = (key: string) => get<TokenDetail>(`/api/v1/token${qs({ key })}`);
export const search = (q: string) => get<SearchResult>(`/api/v1/search?q=${enc(q)}`);

/** Deep-link hash for a search result. */
export function searchHref(r: SearchResult): string {
  switch (r.type) {
    case "block":
      return `#/blocks/${r.id}`;
    case "tx":
      return `#/transactions/${txSlug(r.id)}`;
    case "package":
      return `#/realms/${r.id}`;
    default:
      return `#/transactions/address/${r.id}`;
  }
}
