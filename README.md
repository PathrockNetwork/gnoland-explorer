# gno.land Explorer

> Block explorer for gno.land mainnet (`gnoland-1`), by Pathrock Network.

Indexes gno.land from genesis into Postgres and serves it through a REST API and a React
explorer with the same design as [monad-explorer](../monad-explorer) and
[secretnetwork-explorer](../secretnetwork-explorer) (layout, components and CSS ported; gno.land
ink-and-green palette). The original explorer layout and typography are retained, with
gno.land colors, light/dark themes, and the gnome mark from its public assets. Light mode is
the default; saved theme preferences remain available. Pages: Overview, Validators, Blocks, Transactions (tx detail with decoded
messages, events and token transfers; account pages with balances, GRC20 holdings and deployed
packages), Realms (every package with its source, exported functions and live `Render` output),
Tokens, Storage, GovDAO, Analytics, Network, RPC Console, API Reference and Settings.

The EVM layer of the Monad explorer is replaced by the Tendermint2 RPC and the official
[tx-indexer](https://github.com/gnolang/tx-indexer); chain reference notes are in
[`docs/gnoland-context.md`](docs/gnoland-context.md).

## Endpoints
Pathrock Network gno.land public infrastructure, set in `.env`:

| Service | URL |
|---------|-----|
| Archive RPC (`RPC_URLS`, first) | `https://gnoland.archive.pathrocknetwork.org` |
| Archive WebSocket | `wss://gnoland.archive.pathrocknetwork.org/websocket` |
| Transaction indexer (`TX_INDEXER_URL`) | `https://indexer.gnoland.pathrocknetwork.org/graphql/query` |

The archive keeps state for every height. `https://rpc.gno.land` comes second in `RPC_URLS` as a
failover; it prunes state below about height 240,000.

## Stack
- TypeScript (Node 20+, ESM), pnpm workspaces
- PostgreSQL 16+
- Drizzle ORM · Fastify · React + Vite

## Layout
| Path | Responsibility |
|------|----------------|
| `packages/core` | DB schema + migrations, Tendermint2 JSON-RPC client, tx-indexer GraphQL client, decoding and realm-render parsers (`gno.ts`) |
| `packages/indexer` | Follows the chain from genesis (blocks, transactions, events, packages, token transfers), reads commit signatures, and mirrors validators, usernames, GRC20 tokens, GovDAO proposals and package status |
| `packages/api` | Fastify REST API (`/api/v1/*`; gno.land views in `realms.ts`) and host for the built web app |
| `packages/web` | React explorer (Vite) |
| `deploy/` | systemd units and the Caddy site block |
| `docs/` | gno.land reference notes gathered for this project |

## How data flows
- **Two sources.** Block headers and decoded transactions (messages, events, storage deposits)
  come from the tx-indexer, 2,000 blocks per query. Commit signatures, validator sets and live
  state (balances, realm renders, source files, function signatures) come from the Tendermint2
  RPC through ABCI queries. Both run on Pathrock Network infrastructure (below).
- **Full history.** gno.land is quiet (a block every ~3.5s, a few thousand transactions a day),
  so everything is kept from genesis (height 0 holds the 96 genesis transactions). A first sync
  of ~1M blocks took about 8 minutes.
- **Instant finality.** Tendermint2 has no reorgs: a block the tx-indexer reports is final.
- **Signatures are windowed.** Each block's precommits cost one RPC request (read from the next
  block's `last_commit`), so only the newest `SIGNATURE_DEPTH` blocks (default 100,000, ~4 days)
  are read. Uptime windows are 100, 1,000 and 10,000 blocks.
- **Mirrors.** Realm state the explorer shows next to the chain data is polled from the realms
  themselves: validator profiles (`r/gnops/valopers`, 5 min), usernames (`r/sys/users`, 10 min),
  GRC20 metadata (`r/nt/grc20reg/v0`, 15 min), GovDAO proposals and votes (`r/gov/dao`, 2 min)
  and the inert-package list (`vm/qinertpaths`, 5 min).

## What is specific to gno.land
| View | gno.land property | Source |
|------|-------------------|--------|
| **Realms** (`#/realms`) | Code lives on chain: realms (`/r/`, stateful) and pure packages (`/p/`) are published by `MsgAddPackage` and readable by anyone | Deployments from the index; source via `vm/qfile`, exported functions via `vm/qfuncs`, a realm's `Render(path)` via `vm/qrender`; calls, callers and events per package from the index |
| **Package status** | Mainnet parks new code *inert* until a package approver sends `MsgEnablePackage` (or rejects it) | Enable/reject messages from the index, reconciled with `vm/qinertpaths` |
| **Storage** (`#/storage`) | Realm state is paid for: 100 ugnot per byte is locked as a deposit on write and refunded on free | `StorageDepositEvent` / `StorageUnlockEvent` per transaction |
| **Validators** | No staking: the set is chosen by GovDAO proposals and every member carries a fixed voting power | Set from RPC, profiles from `r/gnops/valopers` (joined on the signing address), uptime from precommits, proposals from every block |
| **GovDAO** (`#/govdao`) | Governance is a realm | Proposal list, status, vote shares and votes parsed from `r/gov/dao` renders (status is not exposed any other way); vote transactions from the index |
| **Usernames** | Addresses can own names (`r/sys/users`) and the matching namespaces | Mirrored into `usernames`; `@name` search |
| **Tokens** | GRC20/GRC721 are realms emitting `Transfer` events from `p/nt/grc20` and `p/nt/grc721` | Events from the index; metadata from the GRC20 registry; balances read live per address |

## Quickstart
```bash
pnpm install
cp .env.example .env          # set DATABASE_URL
sudo -u postgres psql -c "create role gnoland login password '…'" -c "create database gnoland_explorer owner gnoland"
pnpm db:migrate
pnpm --filter @gnoland-explorer/web build
pnpm dev                      # indexer + API; explorer on http://127.0.0.1:3002
pnpm test
```

## Running as a service
```bash
sudo cp deploy/gnoland-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gnoland-indexer gnoland-api
journalctl -u gnoland-indexer -f     # progress line every 30s
```

## Public access (no domain)
The API binds `127.0.0.1:3002`. Caddy publishes it read-only on port 8081 over plain HTTP:
```bash
sudo cp deploy/Caddyfile.gnoland /etc/caddy/gnoland.caddy
echo 'import gnoland.caddy' | sudo tee -a /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Open `http://<server-ip>:8081`. When a domain exists, replace `:8081` in `gnoland.caddy` with
the hostname and Caddy will obtain a TLS certificate automatically.

## Not yet built
- GRC721 metadata (names, token URIs) and NFT galleries; transfers are indexed.
- Return values of realm calls (`response.data`) are not requested from the tx-indexer.
- `qeval`-based "read a realm" form (call read-only functions from the browser).
- Historical validator-set membership before the signature window (sets are stored by hash as
  they are met).
