/** Address page panels: account overview (balances, activity, packages, validator role), GRC20 balances, token transfers. */
import { useState } from "react";
import type { AddressInfo, AddressTokens, Names } from "../api";
import { bytes, coinText, fmt, formatUnits, gnot, pkgHref, shortPath } from "../lib";
import { compactAddrs } from "../transactionExplorer";
import { AddrLink, TokenAmount, TokenLabel } from "./MessageView";
import { Timestamp } from "./Timestamp";
import { Chip, Skeleton } from "./ui";

const PKG_PREVIEW = 12;

export function AddressOverview({ info, failed }: { info: AddressInfo | null; failed: boolean }) {
  const [allPkgs, setAllPkgs] = useState(false);
  if (failed && !info) return <section className="txe-card txe-funds"><p className="txe-funds-note">Address details are temporarily unavailable.</p></section>;
  if (!info)
    return (
      <section className="txe-card txe-funds" aria-busy="true">
        <div className="txe-funds-grid">{Array.from({ length: 6 }, (_, i) => <div key={i}><Skeleton h={12} w="60%" /><Skeleton h={20} w="80%" /></div>)}</div>
      </section>
    );
  const others = (info.balances ?? []).filter((c) => c.denom !== "ugnot");
  const pkgs = allPkgs ? info.packages : info.packages.slice(0, PKG_PREVIEW);
  const v = info.validator;
  return (
    <section className="txe-card txe-funds" aria-label="Address overview">
      <div className="txe-funds-head">
        <span>Account</span>
        {info.username && <em>@{info.username}</em>}
        {v && <em>{v.role === "operator" ? "Validator operator" : "Validator signing key"}{v.moniker ? ` · ${v.moniker}` : ""}</em>}
      </div>
      <div className="txe-funds-grid">
        <div className="total">
          <span>GNOT balance</span>
          <strong title={info.ugnot ? `${formatUnits(info.ugnot, 6, 6)} GNOT` : undefined}>{info.balances === null ? "—" : gnot(info.ugnot ?? "0", 4)}</strong>
          {info.balances === null && <small>Live balance unavailable (RPC unreachable)</small>}
        </div>
        <div>
          <span>Transactions</span>
          <strong>{fmt(info.txs)}</strong>
          <small>{fmt(info.sent)} signed by this address</small>
        </div>
        <div>
          <span>Account # · sequence</span>
          <strong>{info.account_number ?? "—"} · {info.sequence ?? "—"}</strong>
          {info.account_number === null && <small>No account in state (never funded)</small>}
        </div>
        <div>
          <span>First seen</span>
          <strong className="txe-small-strong">{info.first_seen ? <Timestamp value={info.first_seen} /> : "—"}</strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong className="txe-small-strong">{info.last_seen ? <Timestamp value={info.last_seen} /> : "—"}</strong>
        </div>
        <div title="Net realm storage this address's transactions added (deposits minus unlocks)">
          <span>Storage added</span>
          <strong>{info.storage_bytes > 0 ? "+" : ""}{bytes(info.storage_bytes)}</strong>
        </div>
      </div>
      {others.length > 0 && (
        <ul className="txe-funds-list" aria-label="Other coins">
          {others.map((c) => (
            <li key={c.denom}>
              <span>Coin</span>
              <b title={c.denom}>{coinText(c.amount, c.denom)}</b>
            </li>
          ))}
        </ul>
      )}
      {v && (
        <ul className="txe-funds-list" aria-label="Validator">
          <li>
            <span>Validator</span>
            <b>
              <a className="txe-address-link" href={`#/validators/${v.address}`}>{v.moniker ?? v.address}</a>
            </b>
          </li>
          <li>
            <span>Role of this address</span>
            <b>{v.role === "operator" ? "Operator (valopers profile owner)" : "Consensus signing key"}</b>
          </li>
          <li>
            <span>In the active set</span>
            <b>{v.in_set ? <Chip tone="ok">Yes · power {fmt(v.voting_power)}</Chip> : <Chip tone="muted">Candidate</Chip>}</b>
          </li>
          <li>
            <span>Blocks proposed · since genesis</span>
            <b>{fmt(v.blocks_proposed)}</b>
          </li>
        </ul>
      )}
      {info.packages.length > 0 && (
        <div className="txe-pkgs">
          <h4>Packages deployed · {fmt(info.packages.length)}{info.packages.length >= 200 ? "+" : ""}</h4>
          <ul>
            {pkgs.map((p) => (
              <li key={p.path}>
                <a href={pkgHref(p.path)} title={p.path}>{shortPath(p.path)}</a>
                <Chip tone={p.kind === "realm" ? "brand" : "muted"}>{p.kind === "pure" ? "package" : p.kind}</Chip>
                <small><Timestamp value={p.time} /></small>
              </li>
            ))}
          </ul>
          {info.packages.length > PKG_PREVIEW && <button type="button" className="txe-inline-button" onClick={() => setAllPkgs(!allPkgs)}>{allPkgs ? "Show fewer" : `Show all ${info.packages.length}`}</button>}
        </div>
      )}
      <p className="txe-funds-note">Balances and account number/sequence are read live from the chain. Activity, storage and packages cover every indexed transaction since genesis.</p>
    </section>
  );
}

/** GRC20 / GRC721 holdings: every token this address has sent or received, balance read live. */
export function AddressTokenBalances({ data, failed }: { data: AddressTokens | null; failed: boolean }) {
  const [showZero, setShowZero] = useState(false);
  if (failed && !data) return null;
  if (!data) return <section className="txe-card txe-funds"><Skeleton h={18} w="40%" /><div style={{ height: 10 }} /><Skeleton h={60} w="100%" /></section>;
  if (!data.tokens.length) return null;
  const positive = (b: string | null) => !!b && /^\d+$/.test(b) && b !== "0";
  const held = data.tokens.filter((t) => positive(t.balance));
  const rest = data.tokens.filter((t) => !positive(t.balance));
  const rows = showZero ? [...held, ...rest] : held;
  return (
    <section className="txe-card txe-funds" aria-label="Token balances">
      <div className="txe-funds-head">
        <span>Token balances</span>
        <em>{held.length} held · {data.tokens.length} token{data.tokens.length === 1 ? "" : "s"} interacted with</em>
      </div>
      {rows.length ? (
        <div className="txe-table-scroll">
          <table className="txe-mini-table">
            <thead><tr><th>Token</th><th>Name</th><th>Realm</th><th>Standard</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key}>
                  <td><TokenLabel token={t.key} standard={t.standard} meta={t} /></td>
                  <td>{t.name ?? "—"}{t.registered && <span className="txe-reg" title="Registered in r/nt/grc20reg/v0">reg</span>}</td>
                  <td><a className="txe-address-link" href={pkgHref(t.realm)} title={t.realm}>{compactAddrs(shortPath(t.realm))}</a></td>
                  <td>{t.standard.toUpperCase()}</td>
                  <td className="num">{t.balance === null ? <span className="txe-muted-inline" title="Balance could not be read from the token realm">—</span> : <TokenAmount value={t.balance} standard={t.standard} decimals={t.decimals} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="txe-funds-note">No current balance in any token this address has interacted with.</p>
      )}
      {rest.length > 0 && <button type="button" className="txe-inline-button txe-zero-toggle" onClick={() => setShowZero(!showZero)}>{showZero ? "Hide zero / unknown balances" : `Show ${rest.length} zero or unknown balance${rest.length === 1 ? "" : "s"}`}</button>}
      <p className="txe-funds-note">Balances are read live from each token realm (registered tokens through the GRC20 registry). Amounts use the token's decimals; “raw” means the decimals are unknown.</p>
    </section>
  );
}

/** Recent GRC20/721 transfers in or out of the address (newest 50 each way). */
export function AddressTransfers({ data, failed, address, names, onInspect }: { data: AddressTokens | null; failed: boolean; address: string; names: Names; onInspect: (hash: string) => void }) {
  const meta = new Map((data?.tokens ?? []).map((t) => [t.key, t]));
  const cols = 7;
  return (
    <>
      <div className="txe-sample-note txe-transfers-note"><span>Newest GRC20 / GRC721 transfers sent or received by this address (up to 50 each way).</span></div>
      <div className="txe-table-scroll" tabIndex={0} role="region" aria-label="Token transfers">
        <table className="txe-table txe-transfer-table">
          <thead><tr><th>Tx hash</th><th>Block</th><th>Age</th><th>Token</th><th>From</th><th><span className="txe-visually-hidden">Direction</span></th><th>To</th><th>Amount</th></tr></thead>
          <tbody>
            {data === null
              ? failed
                ? <tr><td className="txe-empty" colSpan={cols + 1}>Token transfers are temporarily unavailable.</td></tr>
                : Array.from({ length: 5 }, (_, i) => <tr key={i}><td colSpan={cols + 1}><Skeleton h={22} w={`${95 - i * 4}%`} /></td></tr>)
              : data.transfers.map((t) => {
                  const out = t.from === address, inn = t.to === address;
                  const m = meta.get(t.token);
                  return (
                    <tr key={`${t.tx_hash}-${t.idx}`} onClick={() => onInspect(t.tx_hash)}>
                      <td><button className="txe-hash" type="button" onClick={(e) => { e.stopPropagation(); onInspect(t.tx_hash); }}>{t.tx_hash.slice(0, 8)}…{t.tx_hash.slice(-5, -1)}</button></td>
                      <td><a className="txe-address-link" href={`#/blocks/${t.height}`} onClick={(e) => e.stopPropagation()}>{fmt(t.height)}</a></td>
                      <td><Timestamp value={t.time} /></td>
                      <td><TokenLabel token={t.token} standard={t.standard} meta={m} /></td>
                      <td><AddrLink address={t.from} names={names} current={address} empty={<em className="txe-mint">mint</em>} /></td>
                      <td><span className={`txe-direction ${out && inn ? "self" : out ? "out" : "in"}`}>{out && inn ? "Self" : out ? "Out" : "In"}</span></td>
                      <td><AddrLink address={t.to} names={names} current={address} empty={<em className="txe-mint">burn</em>} /></td>
                      <td><TokenAmount value={t.value} standard={t.standard} decimals={m?.decimals} /></td>
                    </tr>
                  );
                })}
            {data !== null && !data.transfers.length && <tr><td className="txe-empty" colSpan={cols + 1}>No GRC20 or GRC721 transfers involve this address.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

