# gno.land mainnet (`gnoland-1`) — explorer context

All facts below were verified against the live endpoints on 2026-10-20 (tip ≈ height 944,850).
Node software: `build_version v1.5.1` (block header `version` reports `v1.0.0-rc.0`).

## 1. Endpoints

| What | URL | Notes |
|---|---|---|
| **Pathrock archive RPC** (explorer primary) | `https://gnoland.archive.pathrocknetwork.org` | TM2 JSON-RPC, batches, CORS `*`. Archive node (moniker `PathrockNetwork-Mainnet-Archive`): `abci_query` works at every height. No `tx_search`/`block_search`. |
| **Pathrock archive WS** | `wss://gnoland.archive.pathrocknetwork.org/websocket` | Request/response JSON-RPC over WebSocket. |
| **Pathrock tx-indexer** (explorer source) | `https://indexer.gnoland.pathrocknetwork.org/graphql/query` | Same gnolang/tx-indexer GraphQL schema as the official one, genesis included; CORS `*`. |
| TM2 JSON-RPC (HTTP) | `https://rpc.gno.land` (`:443`) | GET URI style + POST JSON-RPC. CORS `*`. |
| TM2 JSON-RPC (WS) | `wss://rpc.gno.land/websocket` | Same request/response methods only. **No `subscribe`** (returns `-32601 Method not found`). |
| tx-indexer GraphQL | `https://indexer.gno.land/graphql/query` | POST. CORS `*`. Playground UI at `https://indexer.gno.land/graphql`. |
| tx-indexer WS | `wss://indexer.gno.land/graphql/query` | subprotocol `graphql-transport-ws`; subscriptions work (new block every ~3.5 s). |
| gnoweb | `https://gno.land` | `/r/...` render, `$source`, `$help`, `/u/<name>` user pages. |
| Gnockpit (official live dashboard) | `https://gnockpit.gno.land` | |
| Status page | `https://status.gno.land` | |
| Onyx testnet (mainnet code line) | `https://rpc.onyx.testnets.gno.land` (`onyx-1`) | has faucet; indexer host not found. |
| Staging | `https://rpc.staging.gno.land` (`staging`) | |

`net_info` shows 19 peers incl. community RPC/sentries (AviaOne-RPC, PathrockNetwork-RPC-2, ruangnode, onbloc, ...), but no other
officially documented public mainnet RPC. No faucet on mainnet.

**Rate limiting:** none observed. 40 parallel + 150 rapid (≈80 req/s) requests to each of rpc and indexer → all HTTP 200,
no `x-ratelimit*`/`retry-after` headers (both behind Cloudflare). Still be polite.

## 2. Chain facts

- Genesis time `2026-09-12T15:00:00Z`; fresh chain (not a betanet fork). Genesis = 96 txs (89 `m_addpkg`, 5 `m_call`, 2 `m_run`), 3,262,486 balances (airdrop; genesis file ≈ 301 MB — do not fetch casually).
- Block time: **3.54 s avg over last 1000 blocks** (943806→944806); whole-chain avg ≈ 3.47 s.
- Total txs: header `total_txs` = 182,910 at h944806 (excludes the 96 genesis txs). ~188 txs per 1000 blocks currently. First non-genesis tx at h786.
- Validators: **6, each voting power 60 (total 360)**. Proposer rotation ~even (≈166 blocks each per 1000).
  Genesis valset had 4 (gno-core, onbloc, samourai-crew, berty); moul and Mithrandir added via GovDAO (props #12/#13).
- Consensus params: `MaxTxBytes 1000000`, `MaxDataBytes 2000000`, `MaxGas 3000000000`, `TimeIotaMS 100`, pubkey `/tm.PubKeyEd25519`.
- Upgrades: v1.2.0 genesis → v1.3.0 @36300 → v1.4.0 @113000 → v1.5.0 @162200 → v1.5.1 (rolling). See `misc/deployments/mainnet.gno.land/UPGRADES.md` on branch `chain/mainnet`.
- **State pruning on rpc.gno.land:** `abci_query ...&height=H` works only for H ≳ 239,843 (older → `/std.InternalError`). Blocks/block_results are available from h1.
- No PoS: **no staking/delegation/slashing/rewards module.** Validator set is Proof-of-Contribution, changed only by GovDAO proposals executed through `gno.land/r/sys/validators/v0`.

## 3. RPC notes (Tendermint2)

Routes (`GET /`): `abci_info, abci_query, block, block_results, blockchain, broadcast_tx_{async,sync,commit}, commit, consensus_params, consensus_state, dump_consensus_state, genesis, health, net_info, num_unconfirmed_txs, status, tx, unconfirmed_txs, validators`.
Not available: `tx_search`, `block_search`, `subscribe`, pagination params (ignored), gRPC.

- All byte fields are **base64** (hashes, app_hash, tx bytes). Addresses are bech32 `g1...` strings (proposer_address, validator_address).
- Tx hash = `sha256(raw tx bytes)`; indexer shows it base64 (`5jPWWobO...ItY=`). `tx?hash=` accepts `0x<hex>` or URL-encoded base64 (`+`→`%2B`, `=`→`%3D`). Raw `+` breaks (“illegal base64”).
- `block?height=0` → error (`height must be >= 1`). **`block_results?height=0` returns the 96 genesis tx results.**
- `block_results.results.deliver_tx[i]` positionally matches `block.data.txs[i]`; each has `ResponseBase{Error,Data(base64),Events,Log,Info}, GasWanted, GasUsed`.
  Event `@type`s: `/bank.TransferEvent {from,to,coins}`, `/tm.Event {type,attrs[{key,value}],pkg_path}` (realm `chain.Emit`), `/tm.StorageDepositEvent {bytes_delta,fee_delta,pkg_path}`, `/tm.StorageUnlockEvent`.
  `Log` is `msg:<i>,success:<bool>,log:...` per message (newline separated).
- `blockchain?minHeight&maxHeight` returns **max 20** `block_metas`, highest first, silently truncated at the low end.
- Block header fields: `version, chain_id, height, time, num_txs, total_txs, app_version, last_block_id, last_commit_hash, data_hash, validators_hash, next_validators_hash, consensus_hash, app_hash, last_results_hash, proposer_address`. `last_commit.precommits[]` has `validator_address`, `validator_index`, `timestamp`, `signature` (null = missed).
- `status.validator_info` is the RPC node's own key (voting_power 0) — ignore.

## 4. ABCI queries

`abci_query` takes `path` and `data`. **Data encoding:**
- GET URI: `path` must be a quoted string; `data` as `0x<hex>` (raw string in quotes is decoded as base64 and fails).
  `?path="vm/qrender"&data=0x676e6f2e6c616e642f...`
- POST JSON-RPC: `"params":{"path":"vm/qrender","data":"<base64>"}` (also optional `"height":"N"`).
- Response: `result.response.{ResponseBase:{Error,Data,Events,Log,Info},Key,Value,Proof,Height}`. **`Data` is base64**; decode → UTF-8 text/JSON.
  Errors: `Error` is an object like `{"@type":"/vm.InvalidPkgPathError"}` with a long `Log` stack; `Data` null. HTTP is always 200.

| path | data | Data decodes to (verified) |
|---|---|---|
| `auth/accounts/<addr>` | – | JSON `{"BaseAccount":{address,coins:"Nugnot",public_key:{@type,value}\|null,account_number,sequence,vesting:{original_vesting,start_time,end_time}},"attributes":"0"}`. **`null`** if the account doesn't exist in state (never received coins/never signed) — e.g. validator *signing* addresses g1g0yrm…(moul) and g1h97x…(Mithrandir) and the RPC node key were never funded. Funded validator keys (genesis ones) do return accounts. |
| `auth/accounts/<addr>/sessions`, `.../session/<sessAddr>` | – | session-key accounts (MsgCreateSession; source) |
| `auth/gasprice` | – | `{"gas":"1000","price":"1ugnot"}` (current dynamic min gas price) |
| `bank/balances/<addr>` | – | JSON string `"936611810ugnot"`; `""` for unknown address |
| `bank/supply/<denom>` | – | `"1333000221686563"` (ugnot). `bank/supply` alone → error |
| `params/<module>:p:<field>` | – | JSON value, see §9 (e.g. `params/vm:p:storage_price` → `"100ugnot"`). `params/vm` → error “expected <module>:<rest>” |
| `vm/qrender` | `<pkgpath>:<renderpath>` | Markdown string from `Render(path)`. `gno.land/r/sys/users:` (empty path = home). No Render → `/vm.NoRenderDeclError`. |
| `vm/qeval` | `<pkgpath>.<expr>` | Gno-formatted values, one per line: `(true bool)`, `("moul" string)`, `(1000 int64)`, `(&(struct{...} pkg.Type) *pkg.Type)`, `(nil *T)` |
| `vm/qeval_json` | `<pkgpath>.<expr>` | `{"results":[{"T":{...},"V":{...}}]}` typed-value JSON (verbose; strings at `V.value`, ints base64 in `N`) |
| `vm/qfuncs` | `<pkgpath>` | JSON `[{FuncName,Params:[{Name,Type,Value}],Results:[...]}]` (crossing funcs have first param `cur realm`) |
| `vm/qfile` | `<pkgpath>` | newline list of file names (incl. tests, `gnomod.toml`) |
| `vm/qfile` | `<pkgpath>/<file.gno>` | file source text |
| `vm/qdoc` | `<pkgpath>` | JSON `{package_path,package_line,package_doc,imports,values,funcs,types,...}` |
| `vm/qpaths` | `<prefix>` or `@<username>[/sub]` | newline list of package paths. Default limit 1000, `?limit=N` in the *path* (`vm/qpaths?limit=10000`), max 10000. No pagination. 680 pkgs total under `gno.land/` (439 `/r/`, 241 `/p/`). |
| `vm/qstorage` | `<pkgpath>` | `storage: 745845, deposit: 74584500` (bytes, ugnot) |
| `vm/qpkgmeta_json` | `<pkgpath>` | `{"path","status":"live"\|"inert","creator",...}`; inert adds `height,max_deposit,reason,pending` |
| `vm/qinertpaths` | `<prefix>` | newline list of inert (awaiting approval) paths |
| `vm/qpkg_json` | `<pkgpath>` | package-level names + typed values JSON |
| `vm/qobject_json`, `vm/qobject_binary`, `vm/qtype_json` | object/type id | low-level object store access |

Unknown: `auth/params`, `bank/params`, `vm/params` → `/std.UnknownRequestError`.

## 5. tx-indexer GraphQL

Query root:
```graphql
latestBlockHeight: Int!
getSupply(denom: String!): Supply!            # {denom height total locked spendable}
getBlocks(where: FilterBlock!, order: BlockOrder): [Block!]                # order: {height: ASC|DESC}
getTransactions(where: FilterTransaction!, order: TransactionOrder): [Transaction!]  # order: {heightAndIndex: ASC|DESC}
blocks(filter: BlockFilter!) / transactions(filter: TransactionFilter!)    # legacy range filters (from_height/to_height, ...)
# Subscription: getBlocks(where), getTransactions(where), blocks(filter), transactions(filter)
```
Types:
```graphql
Block { hash height version chain_id time num_txs total_txs app_version last_block_hash last_commit_hash
        validators_hash next_validators_hash consensus_hash app_hash last_results_hash
        proposer_address_raw  # bech32 g1 consensus address
        txs: [BlockTransaction] }       # BlockTransaction { hash fee{gas_wanted gas_fee{amount denom}} memo content_raw }
Transaction { index hash success block_height gas_wanted gas_used gas_fee{amount denom} content_raw memo
              messages: [TransactionMessage]   # { typeUrl route value: MessageValue }
              response { log info error data events: [Event] } }
MessageValue = BankMsgSend{from_address to_address amount}
  | MsgCall{caller send pkg_path func args max_deposit}
  | MsgAddPackage{creator package{name path files{name body}} deposit send max_deposit}
  | MsgRun{caller send package{...} max_deposit}
  | MsgEnablePackage{approver pkg_path pkg_hash pkg_height} | MsgRejectPackage{sender pkg_path}
  | UnexpectedMessage{raw}
  # typeUrl: send|exec|add_package|run|enable_package|reject_package ; route: bank|vm
Event = GnoEvent{type pkg_path attrs{key value}} | TransferEvent{type from to coins}
  | StorageDepositEvent{type bytes_delta fee_delta{amount denom} pkg_path}
  | StorageUnlockEvent{type bytes_delta fee_refund{amount denom} pkg_path refund_withheld} | UnknownEvent{value}
Supply { denom height total locked spendable }
```
Filters: every `Filter*` has `_and/_or/_not`. Scalars: `FilterInt{exists eq gt lt}`, `FilterString{exists eq like}`,
`FilterTime{exists eq before after}`, `FilterBoolean{exists eq}`. Nested message/event filters by union member, e.g.
`messages:{value:{MsgCall:{pkg_path:{eq:"..."}}}}`, `response:{events:{GnoEvent:{type:{eq:"Transfer"},attrs:{value:{eq:"g1..."}}}}}`.
No `limit`/`offset`/cursor args.

**Limits & paging (measured):**
- Hard cap **10,000 elements per query field**. When exceeded you get the first 10,000 rows (in requested order) **plus** `errors:[{"message":"max elements per query reached (10000)","path":["getBlocks"]}]`. Applies to legacy `blocks/transactions` too.
- Negative ints in filters (`gt:-1`) return `null` — use `gt:0`/`eq:0` or omit.
- Blocks: page by height windows, e.g. `height:{gt:H, lt:H+10001}`; 10k blocks with tx sub-fields ≈ 1.7 MB, < 1 s.
- Txs: `order:{heightAndIndex:ASC}` + cursor `_or:[{block_height:{gt:H}},{block_height:{eq:H},index:{gt:I}}]` (verified), repeat until no error. ~19 pages for full history.
- Account history: `_or` over BankMsgSend.from/to, MsgCall.caller, MsgAddPackage.creator, MsgRun.caller → 817 txs for moul in ~6 s (full scan; cache it). No signer field — derive from message (`caller/from_address/creator/approver`) or decode `content_raw` (base64 amino tx).
- Event attr search works (~4 s).

Coverage: **genesis included** — `getBlocks(height eq 0)` → `{time:"2026-09-12T15:00:00Z", num_txs:96}`, `getTransactions(block_height eq 0)` → 96 txs (index 0..95). Height 1 onward complete. Block gives proposer (consensus addr), `num_txs`, `total_txs`, `time`; no moniker, no signatures/commit.
Supply: `getSupply(denom:"ugnot")` → `total 1333000221686563, locked 1076664724874078, spendable 256335496812485` (ugnot; ≈1.333 B GNOT, ≈81% still vesting-locked).

## 6. Validators & identity

- Live set: RPC `validators` (address, pub_key ed25519 base64, voting_power, proposer_priority) or realm `gno.land/r/sys/validators/v0` (`Render("")` → `## Valset at height N` + `- #i: g1... (60)`; `GetValidators()` → `[]{Address, PubKey gpub1..., VotingPower}`).
  `gno.land/r/sys/validators/v2` exists but is **empty/unused** on mainnet (“No valset changes to apply.”).
- Metadata: **`gno.land/r/gnops/valopers`** (49 profiles). Struct `Valoper{Moniker, Description, ServerType(cloud|on-prem|data-center), OperatorAddress, SigningPubKey(gpub1…), SigningAddress, LastRotationHeight, KeepRunning}`.
  - List: `qrender gno.land/r/gnops/valopers:` → intro text + lines ` * [Moniker](/r/gnops/valopers:<operatorAddr>) - [profile](/r/demo/profile:u/<operatorAddr>)`; pager 50/page, `:?page=2`.
  - Detail: `qrender gno.land/r/gnops/valopers:<operatorAddr>` → `## <moniker>`, description, `- Operator Address:`, `- Signing Address:`, `- Signing PubKey:`, `- Server Type:`.
  - Or `qeval gno.land/r/gnops/valopers.GetByAddr("<operatorAddr>")` (keyed by **operator** address).
  - **Mapping:** consensus address (RPC `validators`, block `proposer_address`, precommit `validator_address`) == valoper `SigningAddress`. Operator address is the account identity used by GovDAO proposals.
- Current mapping (signing → moniker / operator):
  `g1mmgvcssjw6x4fzphupfg6mtxqt36v000c5rf2a` gno-core-validator-1 / g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m ·
  `g1hqhetnnz0raw5hps6yxexl7q09a6f8w3anlptt` onbloc-validator-1 / g12gtvlcexzgax49nvvkvhp2u0v6eejhunq0074p ·
  `g15t7f9q6km3ldt885duwl8xu5dncs98528amk4f` samourai-crew-validator-1 / g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4 ·
  `g1l983yy3kpmapyzcfy53y5charfxupa5czjalea` berty-validator-1 / g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm ·
  `g1g0yrmdhney8pcaf9rfut4604equz604pszdsyt` moul / g1manfred47kzduec920z88wfr64ylksmdcedlf5 ·
  `g1h97x8geqqwhh0prepcwrqskcd35g6gy5s39eny` Mithrandir / g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6
- Joining: register in valopers → GovDAO member proposes via `r/gnops/valopers/proposal` → vote → executor in `r/sys/validators/v0`.

## 7. Usernames

- Registry: **`gno.land/r/sys/users`** (99 names). Registrations only via whitelisted controller realms (`Controllers()` → 1 realm addr); public registrar is **`gno.land/r/sys/namereg/v0`** (format `nym-<5-13 letters><3 digits>`, price 0 ugnot; vanity names via GovDAO). `r/gnoland/users` does **not** exist on mainnet.
- addr → name: `qeval gno.land/r/sys/users.ResolveAddress("g1...")` → `(&(struct{("g1…" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *…)` or `(nil *gno.land/r/sys/users.UserData)`. `…ResolveAddress("g1…").Name()` → `("moul" string)` but **panics on nil** — use the struct form.
- name → addr: `…ResolveName("moul")` → same struct + `(true bool)` line. `…ResolveAny("<name|addr>")` also works. 3rd field = deleted flag.
- Namespace: user may deploy under `gno.land/{r,p}/<name>/…` and `gno.land/{r,p}/<g1address>/…`. List: `qpaths` data `@moul`.
- gnoweb user page: `https://gno.land/u/<name>`. Profile realm: `gno.land/r/demo/profile` (`:u/<addr>`).

## 8. GovDAO

- Realm proxy **`gno.land/r/gov/dao`** (impl `gno.land/r/gov/dao/impl/v0`, members `gno.land/r/gov/dao/memberstore/v0`, treasury `…/treasury/v0`).
- List: `qrender gno.land/r/gov/dao:` → 5 per page, newest first, `:?page=N`. Per item: `### [Prop #<id> - <title>](/r/gov/dao:<id>)`, `Author: [@user](/u/user)` or `g1…`, `Status: ACTIVE|ACCEPTED|REJECTED…`, `Tiers eligible to vote: T1, T2, T3`. Latest id currently 14 (ids from 0).
- Detail: `qrender gno.land/r/gov/dao:<id>` → description, `Executor created in: <realm>`, `### Stats` (`YES PERCENT`, `NO PERCENT`, `ABSTAIN PERCENT`, `**PROPOSAL HAS BEEN ACCEPTED**`). Votes: `:<id>/votes` (per option×tier lists).
- qeval: `MustGetProposal(id).Title()/Description()/Author()/ExecutorCreationRealm()` work; status is not exposed via a method (`.Status()` fails) → parse render.
- Members: `qrender gno.land/r/gov/dao/memberstore/v0:` (tiers T1 3 members/power 9, T2 0, T3 0), list at `:members`.
- Notable props: #0 halt height, #1–2 T1 members, #3 run_submitters, #4 unlock ugnot transfers, #12/#13 add Mithrandir, #14 add valoper lurien (ACTIVE).
- Votes are txs: `MsgCall gno.land/r/gov/dao.MustVoteOnProposalSimple(pid, "YES"|"NO"|"ABSTAIN")` — index them from the indexer for history.

## 9. Tokens, fees, params

- Native denom **`ugnot`** (1 GNOT = 10^6 ugnot). Supply ≈ 1,333,000,221.69 GNOT. Genesis accounts vest linearly `start 1789225200` (2026-09-12) → `end 1852383600` (2028-09-12); `auth/accounts` shows `vesting.original_vesting`.
  ugnot transfers were restricted at genesis (`bank restricted_denoms:["ugnot"]` + 91 `unrestricted_addrs`); prop #4 unlocked them (now `[]`).
- Realm-issued native coins: denom embeds pkg path; metadata registry `gno.land/r/moul/x/nativereg/v0` (empty).
- GRC20 registry: **`gno.land/r/nt/grc20reg/v0`** (26 tokens). Render lists `- **Name** - [realm](...).SYMBOL - [info](/r/nt/grc20reg/v0:<realm>.<SYMBOL>)`; info page gives symbol, decimals, total supply.
  Balance: `qeval gno.land/r/nt/grc20reg/v0.MustGet("<realm>.<SYMBOL>").BalanceOf("g1…")` → `(1000000000000 int64)`; `.GetDecimals()`, `GetRegistry().Size()`.
  Wrapped GNOT: `gno.land/r/gnoland/wugnot` (`BalanceOf("g1…")`, render `:balance/<addr>`). Factory `gno.land/r/demo/defi/grc20factory` (`BalanceOf(symbol, owner)`). Big dApp: GnoSwap (`gno.land/r/gnoswap/...`).
  GRC20/721 transfers appear as `GnoEvent{type:"Transfer"|"Approval", pkg_path:"gno.land/p/nt/grc20/v0"|".../grc721/v0", attrs: token=<realm>.<sym>.<n>, from, to, value|tokenId}` (mint: from=""; burn: to="").
- Gas: fee is `gas_fee` total (not per unit). Min price dynamic: `auth/gasprice` (now `1ugnot / 1000 gas`), adjusted per block (`target_gas_ratio 70`, `gas_price_change_compressor 10`). Fee collector `g17xpfvakm2amg962yls6f84z3kell8c5lr9lr2e`; `gno.land/r/sys/txfees` bucket.
- Storage deposits: `storage_price 100ugnot/byte`, `default_deposit 100000000ugnot` (100 GNOT), collector `g1c9stkafpvcwez2efq3qtfuezw4zpaux3tvxggk`. Locked per realm on growth (StorageDepositEvent), refunded to whoever shrinks it (StorageUnlockEvent). `max_deposit` on MsgCall/AddPackage/Run caps it.
- Code submission: `vm:p:code_submission_policy = "inert"` → MsgAddPackage parks the package **inert** until a `pkg_approvers` member sends **MsgEnablePackage** (or MsgRejectPackage). Approvers: g1yaaa6rcp…, g1aeddl…, g1ecsuj…, g1manfred…. Inert pkgs: not in `qpaths`, visible via `qinertpaths`/`qpkgmeta_json`.
- **MsgRun** (run ad-hoc `main` script) restricted to `run_submitters` (3 addrs: aeddi, Mithrandir, moul). CLA realm `r/sys/cla` enforcement disabled.
- Other params: `auth:p:max_memo_bytes 65536, tx_sig_limit 7, tx_size_cost_per_byte 10, sig_verify_cost_ed25519 590, sig_verify_cost_secp256k1 1000, initial_gasprice {gas:1000,price:1ugnot}`; `vm:p:chain_domain gno.land, sysnames_pkgpath gno.land/r/sys/names, syscla_pkgpath gno.land/r/sys/cla, iter_next_cost_flat 1000, preprocess_gas_per_byte 1250, inert_submission_charge ""`. Overview with delegation info: `qrender gno.land/r/sys/params:`.

## 10. Concepts to surface in an explorer

- `/r/` realms (stateful, have `Render`, crossing functions `func F(cur realm, …)`) vs `/p/` pure packages (stateless libs). Show source (`qfile`), functions (`qfuncs`), docs (`qdoc`), storage/deposit (`qstorage`), status live/inert (`qpkgmeta_json`), Render output (markdown; contains gnoweb-relative links like `/r/x:path` and `$help&func=`).
- Message types (amino `@type`): `/bank.MsgSend`, `/vm.m_call`, `/vm.m_addpkg`, `/vm.m_run`, plus enable/reject package; auth session msgs exist in source (`MsgCreateSession`, `MsgRevokeSession`).
- Realm events from `chain.Emit(type, k1, v1, …)` (stdlib now `chain`, formerly `std.Emit`) → GnoEvent with emitting `pkg_path` (may be a `/p/` lib like grc20).
- MsgCall return values in `response.data` (Gno-formatted, `\n`-separated per msg).
- Usernames/namespaces, GovDAO proposals & votes, valoper profiles, vesting/locked balances, storage deposits, inert package approvals.
- Boards: `gno.land/r/gnoland/boards2/v0` (no boards yet). Blog: `gno.land/r/gnoland/blog`.
- gnoweb deep links: `https://gno.land/r/<path>[:<renderpath>]`, `$source`, `$help`, `/u/<name>`.

## 11. Verified curl examples

```bash
R=https://rpc.gno.land; IDX=https://indexer.gno.land/graphql/query
hex(){ printf '%s' "$1" | xxd -p | tr -d '\n'; }
dec(){ jq -r '.result.response.ResponseBase.Data' | base64 -d; echo; }

curl -s "$R/status" | jq '.result.sync_info'
curl -s "$R/block?height=944788" | jq '.result.block.header'
curl -s "$R/block_results?height=944788" | jq '.result.results.deliver_tx'
curl -s "$R/block_results?height=0" | jq '.result.results.deliver_tx | length'     # 96 genesis txs
curl -s "$R/blockchain?minHeight=944000&maxHeight=944800" | jq '.result.block_metas | length'  # 20
curl -s "$R/validators" | jq '.result.validators'
curl -s "$R/tx?hash=0xe633d65a86ce66e9c0f77af5358dd797eebeac27b52d0dd2a12df9632dea22d6" | jq '.result'

curl -s "$R/abci_query?path=\"auth/accounts/g1manfred47kzduec920z88wfr64ylksmdcedlf5\"" | dec
curl -s "$R/abci_query?path=\"bank/balances/g1manfred47kzduec920z88wfr64ylksmdcedlf5\"" | dec
curl -s "$R/abci_query?path=\"bank/balances/g1manfred47kzduec920z88wfr64ylksmdcedlf5\"&height=900000" | dec
curl -s "$R/abci_query?path=\"bank/supply/ugnot\"" | dec
curl -s "$R/abci_query?path=\"auth/gasprice\"" | dec
curl -s "$R/abci_query?path=\"params/vm:p:storage_price\"" | dec
curl -s "$R/abci_query?path=\"vm/qrender\"&data=0x$(hex 'gno.land/r/gov/dao:')" | dec
curl -s "$R/abci_query?path=\"vm/qrender\"&data=0x$(hex 'gno.land/r/gnops/valopers:g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m')" | dec
curl -s "$R/abci_query?path=\"vm/qeval\"&data=0x$(hex 'gno.land/r/sys/users.ResolveName("moul")')" | dec
curl -s "$R/abci_query?path=\"vm/qeval\"&data=0x$(hex 'gno.land/r/sys/users.ResolveAddress("g1manfred47kzduec920z88wfr64ylksmdcedlf5")')" | dec
curl -s "$R/abci_query?path=\"vm/qeval\"&data=0x$(hex 'gno.land/r/sys/validators/v0.GetValidators()')" | dec
curl -s "$R/abci_query?path=\"vm/qeval\"&data=0x$(hex 'gno.land/r/nt/grc20reg/v0.MustGet("gno.land/r/demo/defi/grc20factory.MOULTEST").BalanceOf("g1manfred47kzduec920z88wfr64ylksmdcedlf5")')" | dec
curl -s "$R/abci_query?path=\"vm/qfuncs\"&data=0x$(hex 'gno.land/r/gnoland/wugnot')" | dec
curl -s "$R/abci_query?path=\"vm/qfile\"&data=0x$(hex 'gno.land/r/gnops/valopers')" | dec
curl -s "$R/abci_query?path=\"vm/qfile\"&data=0x$(hex 'gno.land/r/gnops/valopers/valopers.gno')" | dec
curl -s "$R/abci_query?path=\"vm/qpaths?limit=10000\"&data=0x$(hex 'gno.land/r/sys')" | dec
curl -s "$R/abci_query?path=\"vm/qstorage\"&data=0x$(hex 'gno.land/r/gnops/valopers')" | dec
curl -s "$R/abci_query?path=\"vm/qpkgmeta_json\"&data=0x$(hex 'gno.land/r/moul/x/gsdash/v0')" | dec
# POST form (data = base64):
curl -s $R -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"abci_query\",\"params\":{\"path\":\"vm/qrender\",\"data\":\"$(printf 'gno.land/r/sys/users:' | base64 -w0)\"}}" | dec

gql(){ curl -s $IDX -H 'content-type: application/json' -d "$(jq -n --arg q "$1" '{query:$q}')"; }
gql '{ latestBlockHeight }'
gql '{ getSupply(denom:"ugnot") { total locked spendable height } }'
gql '{ getBlocks(where:{height:{gt:943806, lt:944807}}, order:{height:ASC}) { height time num_txs total_txs proposer_address_raw } }'
gql '{ getTransactions(where:{block_height:{eq:0}}) { hash index messages { typeUrl } } }'
gql '{ getTransactions(where:{_or:[{block_height:{gt:944098}},{block_height:{eq:944098},index:{gt:0}}]}, order:{heightAndIndex:ASC}) { block_height index hash } }'
gql '{ getTransactions(where:{messages:{value:{MsgCall:{pkg_path:{eq:"gno.land/r/gov/dao"}}}}}, order:{heightAndIndex:DESC}) { block_height hash messages { value { ... on MsgCall { caller func args } } } } }'
gql '{ getTransactions(where:{response:{events:{GnoEvent:{type:{eq:"Transfer"}, attrs:{value:{eq:"g1h0aak8msaaqytpa4uztjhnasy97m52v5afvqt4"}}}}}}) { hash block_height } }'
gql '{ getTransactions(where:{success:{eq:false}, block_height:{gt:900000}}) { hash response { error } } }'
```
WebSocket subscription (Node ≥ 22): connect `wss://indexer.gno.land/graphql/query` with protocol `graphql-transport-ws`, send
`{"type":"connection_init"}`, on `connection_ack` send `{"id":"1","type":"subscribe","payload":{"query":"subscription { getBlocks(where:{}) { height time num_txs proposer_address_raw } }"}}` → `{"type":"next","payload":{"data":{"getBlocks":{...}}}}` per block.
