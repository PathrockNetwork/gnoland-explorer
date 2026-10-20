import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/*
 * gno.land is young and quiet (a block every ~3.5s, a few thousand
 * transactions a day), so unlike the Monad explorer the database keeps full
 * history from genesis. Block headers and decoded transactions come from the
 * official tx-indexer (GraphQL); commit signatures, validator sets and live
 * state (balances, realm renders) come from the Tendermint2 RPC.
 *
 * Hashes are stored as the chain prints them (standard base64); addresses are
 * bech32 `g1…`. Coin amounts are integers in the smallest unit (ugnot).
 */

/** One row per block, height 0 being the genesis transaction set. */
export const blocks = pgTable(
  "blocks",
  {
    height: bigint("height", { mode: "number" }).primaryKey(),
    hash: text("hash").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    proposer: text("proposer").notNull(),
    txCount: integer("tx_count").notNull(),
    totalTxs: bigint("total_txs", { mode: "number" }).notNull(),
    appHash: text("app_hash"),
    validatorsHash: text("validators_hash"),
    /**
     * Precommits for this block, read from the next block's last_commit.
     * Null until the signature loop reaches it (only a recent window is kept).
     */
    signed: smallint("signed"),
    /** Members of the signing set that did not precommit; null with `signed`. */
    missed: smallint("missed"),
  },
  (t) => ({
    byTime: index("blocks_time_idx").on(t.time),
    byHash: index("blocks_hash_idx").on(t.hash),
    byProposer: index("blocks_proposer_idx").on(t.proposer, t.height),
    unsigned: index("blocks_unsigned_idx").on(t.height).where(sql`${t.signed} is null`),
  }),
);

/** Validators that did not sign a block they were in the set for. */
export const missedSignatures = pgTable(
  "missed_signatures",
  {
    height: bigint("height", { mode: "number" }).notNull(),
    validator: text("validator").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.height, t.validator] }),
    byValidator: index("missed_validator_idx").on(t.validator, t.height),
  }),
);

/** Validator sets by hash; a set rarely changes, so blocks reference it. */
export const validatorSets = pgTable("validator_sets", {
  hash: text("hash").primaryKey(),
  /** A height at which the set was read. */
  height: bigint("height", { mode: "number" }).notNull(),
  members: jsonb("members").$type<{ address: string; pub_key: string; voting_power: number }[]>().notNull(),
});

/**
 * One row per transaction. Messages are kept as decoded JSON (package file
 * bodies replaced by their size); the array columns exist so address, realm
 * and function lookups can use GIN indexes instead of scanning JSON.
 */
export const transactions = pgTable(
  "transactions",
  {
    hash: text("hash").primaryKey(),
    height: bigint("height", { mode: "number" }).notNull(),
    txIndex: integer("tx_index").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    success: boolean("success").notNull(),
    /** First message's caller / sender / creator. */
    signer: text("signer"),
    gasWanted: bigint("gas_wanted", { mode: "number" }).notNull(),
    gasUsed: bigint("gas_used", { mode: "number" }).notNull(),
    fee: numeric("fee").notNull(),
    feeDenom: text("fee_denom"),
    memo: text("memo"),
    /** `route/type` per message, e.g. vm/exec, vm/add_package, bank/send. */
    kinds: text("kinds").array().notNull(),
    /** Every address the messages and transfer events mention. */
    addresses: text("addresses").array().notNull(),
    /** Packages called, deployed or run. */
    pkgPaths: text("pkg_paths").array().notNull(),
    /** `pkg_path.Func` for each MsgCall. */
    funcs: text("funcs").array().notNull(),
    messages: jsonb("messages").notNull(),
    error: text("error"),
    log: text("log"),
    /** Net storage bytes this transaction added (+) or released (−). */
    storageDelta: bigint("storage_delta", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    byHeight: index("txs_height_idx").on(t.height, t.txIndex),
    bySigner: index("txs_signer_idx").on(t.signer, t.height),
    byAddresses: index("txs_addresses_idx").using("gin", t.addresses),
    byPkgPaths: index("txs_pkg_paths_idx").using("gin", t.pkgPaths),
    byKinds: index("txs_kinds_idx").using("gin", t.kinds),
    byTime: index("txs_time_idx").on(t.time),
  }),
);

/**
 * Events from transaction responses: GnoVM `chain.Emit` events, storage
 * deposits/unlocks and coin transfers, flattened into one table.
 */
export const events = pgTable(
  "events",
  {
    txHash: text("tx_hash").notNull(),
    idx: integer("idx").notNull(),
    height: bigint("height", { mode: "number" }).notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    /** gno | storage_deposit | storage_unlock | transfer | unknown */
    kind: text("kind").notNull(),
    pkgPath: text("pkg_path"),
    /** Event type for `gno` events (the first argument to chain.Emit). */
    type: text("type"),
    attrs: jsonb("attrs").$type<{ key: string; value: string }[]>(),
    from: text("from"),
    to: text("to"),
    /** Transfer amount, deposit fee or refund, in `denom`. */
    amount: numeric("amount"),
    denom: text("denom"),
    bytesDelta: bigint("bytes_delta", { mode: "number" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.txHash, t.idx] }),
    byPkg: index("events_pkg_idx").on(t.pkgPath, t.height),
    byKind: index("events_kind_idx").on(t.kind, t.height),
    byType: index("events_type_idx").on(t.type, t.height),
  }),
);

/**
 * Every package ever deployed: realms (`/r/`, stateful) and pure packages
 * (`/p/`). Source lives on chain and is read through `vm/qfile`; only the
 * file list and sizes are kept here.
 */
export const packages = pgTable(
  "packages",
  {
    path: text("path").primaryKey(),
    name: text("name").notNull(),
    /** realm | pure */
    kind: text("kind").notNull(),
    creator: text("creator").notNull(),
    height: bigint("height", { mode: "number" }).notNull(),
    txHash: text("tx_hash").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    files: jsonb("files").$type<{ name: string; size: number }[]>().notNull(),
    sourceBytes: integer("source_bytes").notNull(),
    maxDeposit: text("max_deposit"),
    /**
     * live | inert | rejected. Mainnet's code submission policy parks new
     * packages inert until a package approver sends MsgEnablePackage.
     */
    status: text("status").notNull().default("live"),
  },
  (t) => ({
    byCreator: index("packages_creator_idx").on(t.creator),
    byHeight: index("packages_height_idx").on(t.height),
  }),
);

/**
 * Validators: the consensus set from RPC joined with the operator profile
 * registered in `gno.land/r/gnops/valopers`. A validator that leaves the set
 * keeps its row with `in_set = false`.
 */
export const validators = pgTable("validators", {
  address: text("address").primaryKey(),
  pubKey: text("pub_key"),
  votingPower: bigint("voting_power", { mode: "number" }).notNull().default(0),
  inSet: boolean("in_set").notNull().default(false),
  moniker: text("moniker"),
  description: text("description"),
  serverType: text("server_type"),
  /** Operator account that registered the profile (valopers). */
  operator: text("operator"),
  firstSeenHeight: bigint("first_seen_height", { mode: "number" }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * GRC20 tokens listed in gno.land/r/nt/grc20reg/v0, keyed `<realm>.<SYMBOL>`
 * as the registry keys them. Current state, refreshed in place.
 */
export const tokens = pgTable("tokens", {
  key: text("key").primaryKey(),
  realm: text("realm").notNull(),
  symbol: text("symbol").notNull(),
  /** grc20 | grc721 */
  standard: text("standard").notNull(),
  /** Listed in the GRC20 registry (otherwise only seen in transfer events). */
  registered: boolean("registered").notNull().default(false),
  name: text("name"),
  decimals: smallint("decimals"),
  totalSupply: numeric("total_supply"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

/**
 * GRC20 / GRC721 `Transfer` events emitted by the standard token libraries
 * (gno.land/p/nt/grc20, grc721). Mints have from = null, burns to = null.
 */
export const tokenTransfers = pgTable(
  "token_transfers",
  {
    txHash: text("tx_hash").notNull(),
    idx: integer("idx").notNull(),
    height: bigint("height", { mode: "number" }).notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    /** `<realm>.<SYMBOL>`, the registry key. */
    token: text("token").notNull(),
    standard: text("standard").notNull(),
    from: text("from"),
    to: text("to"),
    /** GRC20 amount in base units, or the GRC721 token id. */
    value: text("value").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.txHash, t.idx] }),
    byToken: index("token_transfers_token_idx").on(t.token, t.height),
    byFrom: index("token_transfers_from_idx").on(t.from, t.height),
    byTo: index("token_transfers_to_idx").on(t.to, t.height),
  }),
);

/**
 * GovDAO proposals (gno.land/r/gov/dao), mirrored from the realm's render:
 * status and vote percentages are only exposed there.
 */
export const proposals = pgTable("proposals", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author"),
  /** ACTIVE | ACCEPTED | REJECTED | … as the realm prints it. */
  status: text("status").notNull(),
  tiers: text("tiers"),
  yesPct: doublePrecision("yes_pct"),
  noPct: doublePrecision("no_pct"),
  abstainPct: doublePrecision("abstain_pct"),
  executor: text("executor"),
  /** The proposal body (markdown), without the stats and action sections. */
  body: text("body"),
  /** { YES: { T1: [addr|@name…] }, … } from the votes page. */
  votes: jsonb("votes").$type<Record<string, Record<string, string[]>>>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Registered usernames (`gno.land/r/sys/users`), resolved lazily. */
export const usernames = pgTable(
  "usernames",
  {
    address: text("address").primaryKey(),
    /** Null when the address has no name (still cached, see resolved_at). */
    name: text("name"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byName: index("usernames_name_idx").on(t.name),
  }),
);

/** Single-row indexer bookkeeping (id = 1). */
export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey(),
  chainId: text("chain_id").notNull(),
  /** Highest contiguous height ingested from genesis. */
  headHeight: bigint("head_height", { mode: "number" }),
  /** Latest height the RPC reported. */
  chainHeight: bigint("chain_height", { mode: "number" }),
  /** Latest height the tx-indexer reported. */
  indexerHeight: bigint("indexer_height", { mode: "number" }),
  /** Lowest height the signature loop will fill down to. */
  signatureFloor: bigint("signature_floor", { mode: "number" }),
  activeRpc: text("active_rpc"),
  validatorsSyncedAt: timestamp("validators_synced_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
