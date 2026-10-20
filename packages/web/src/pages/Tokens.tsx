/** GRC20 / GRC721 tokens seen in transfer events: list and per-token page. */
import { useEffect, useMemo, useState } from "react";
import { ApiError, getToken, getTokens, type TokenDetail, type TokenRow } from "../api";
import { AddrLink, TokenAmount } from "../components/MessageView";
import { Timestamp } from "../components/Timestamp";
import { Chip, CopyButton, Skeleton, TimeSeriesChart } from "../components/ui";
import { blockHref, fmt, formatUnits, gnowebHref, middle, pkgHref, shortPath, txHref } from "../lib";
import type { Dashboard } from "../useDashboard";
import { compactAddrs, tokenRoute } from "../transactionExplorer";
import { Glyph } from "./Transactions";
import "./transactions.css";
import "./tokens.css";

const keyFromHash = (h: string) => {
  const m = h.match(/^#\/tokens\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
};

export function Tokens(_props: { d: Dashboard }) {
  const [key, setKey] = useState<string | null>(() => keyFromHash(window.location.hash));
  useEffect(() => {
    const sync = () => setKey(keyFromHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return <div className="txe-page tok-page">{key ? <TokenPage key={key} tokenKey={key} /> : <TokenList />}</div>;
}

const supplyText = (t: Pick<TokenRow, "total_supply" | "decimals" | "standard">) =>
  t.total_supply === null ? "—" : t.standard === "grc721" ? fmt(Number(t.total_supply)) : t.decimals === null ? `${t.total_supply} (raw)` : formatUnits(t.total_supply, t.decimals, 2);

type Sort = "transfers" | "transfers_24h" | "receivers" | "name";
type StdFilter = "all" | "grc20" | "grc721" | "registered";

function TokenList() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState("");
  const [std, setStd] = useState<StdFilter>("all");
  const [sort, setSort] = useState<Sort>("transfers");
  useEffect(() => {
    let cancelled = false;
    setError(null);
    getTokens()
      .then((r) => !cancelled && setTokens(r.tokens))
      .catch(() => !cancelled && setError("The token list is temporarily unavailable."));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = (tokens ?? []).filter(
      (t) =>
        (std === "all" || (std === "registered" ? t.registered : t.standard === std)) &&
        (!needle || [t.key, t.name, t.symbol].some((v) => v?.toLowerCase().includes(needle))),
    );
    const by: Record<Sort, (a: TokenRow, b: TokenRow) => number> = {
      transfers: (a, b) => b.transfers - a.transfers,
      transfers_24h: (a, b) => b.transfers_24h - a.transfers_24h || b.transfers - a.transfers,
      receivers: (a, b) => b.receivers - a.receivers,
      name: (a, b) => (a.name ?? a.symbol).localeCompare(b.name ?? b.symbol),
    };
    return out.sort(by[sort]);
  }, [tokens, q, std, sort]);

  const all = tokens ?? [];
  const registered = all.filter((t) => t.registered).length;
  const nft = all.filter((t) => t.standard === "grc721").length;
  const transfers = all.reduce((s, t) => s + Number(t.transfers), 0);
  const day = all.reduce((s, t) => s + Number(t.transfers_24h), 0);
  const active = all.filter((t) => t.transfers_24h > 0).length;

  return (
    <div className="txe-primary">
      <div className="txe-kpis">
        <Stat icon="token" label="Tokens tracked" value={tokens ? fmt(all.length) : "—"} note={tokens ? `${fmt(all.length - nft)} GRC20 · ${fmt(nft)} GRC721` : "Every token seen in a transfer event"} />
        <Stat icon="success" label="Registered in grc20reg" value={tokens ? fmt(registered) : "—"} note="Listed in r/nt/grc20reg/v0 (name, decimals, supply known)" />
        <Stat icon="transactions" label="Transfers · 24h" value={tokens ? fmt(day) : "—"} note={tokens ? `${fmt(active)} token${active === 1 ? "" : "s"} moved in the last 24 h` : "Across all tokens"} />
        <Stat icon="block" label="Transfers · all time" value={tokens ? fmt(transfers) : "—"} note="GRC20/GRC721 Transfer events since genesis" />
      </div>
      <section className="txe-card txe-directory" aria-label="Tokens">
        <div className="txe-directory-top">
          <div className="txe-categories" aria-label="Filter by standard">
            {(
              [
                ["all", "All"],
                ["grc20", "GRC20"],
                ["grc721", "GRC721"],
                ["registered", "Registered"],
              ] as [StdFilter, string][]
            ).map(([id, label]) => (
              <button type="button" key={id} aria-pressed={std === id} onClick={() => setStd(id)}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Sort tokens" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="transfers">Most transfers</option>
            <option value="transfers_24h">Most transfers · 24h</option>
            <option value="receivers">Most receivers</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="txe-toolbar">
          <label className="txe-search">
            <Glyph name="search" />
            <input aria-label="Search tokens" placeholder="Search name, symbol or realm…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {error && (
          <div className="txe-notice" role="status">
            {error} <button type="button" className="txe-inline-button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
          </div>
        )}
        <div className="txe-table-scroll" tabIndex={0} role="region" aria-label="Token list">
          <table className="txe-table tok-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Token</th>
                <th>Realm</th>
                <th>Standard</th>
                <th className="num">Decimals</th>
                <th className="num">Total supply</th>
                <th className="num">Transfers</th>
                <th className="num">24h</th>
                <th className="num">Receivers</th>
                <th>Last transfer</th>
              </tr>
            </thead>
            <tbody>
              {!tokens && !error
                ? Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={10}><Skeleton h={22} w={`${95 - i * 4}%`} /></td>
                    </tr>
                  ))
                : rows.map((t, i) => (
                    <tr key={t.key} onClick={() => (window.location.hash = tokenRoute(t.key).slice(1))}>
                      <td>{i + 1}</td>
                      <td>
                        <a className="tok-name" href={tokenRoute(t.key)} onClick={(e) => e.stopPropagation()}>
                          <TokenBadge symbol={t.symbol} />
                          <span>
                            <b>{t.symbol}</b>
                            <small>{t.name ?? "Unnamed"}</small>
                          </span>
                        </a>
                      </td>
                      <td>
                        <a className="txe-address-link" href={pkgHref(t.realm)} title={t.realm} onClick={(e) => e.stopPropagation()}>{compactAddrs(shortPath(t.realm))}</a>
                      </td>
                      <td>
                        <span className="tok-std">{t.standard.toUpperCase()}</span>
                        {t.registered && <Chip tone="ok" title="Registered in r/nt/grc20reg/v0">grc20reg</Chip>}
                      </td>
                      <td className="num">{t.decimals ?? "—"}</td>
                      <td className="num" title={t.total_supply ?? "Not readable: token is not in the registry"}>{supplyText(t)}</td>
                      <td className="num">{fmt(Number(t.transfers))}</td>
                      <td className="num">{t.transfers_24h ? fmt(Number(t.transfers_24h)) : <span className="txe-muted-inline">0</span>}</td>
                      <td className="num">{fmt(Number(t.receivers))}</td>
                      <td>{t.last_transfer ? <Timestamp value={t.last_transfer} /> : "—"}</td>
                    </tr>
                  ))}
              {tokens && !rows.length && (
                <tr>
                  <td className="txe-empty" colSpan={10}>No tokens match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="txe-footer">
          <span>{tokens ? `${fmt(rows.length)} of ${fmt(all.length)} tokens` : "—"}</span>
          <span>Name, decimals and supply come from the GRC20 registry; unregistered tokens show “—”.</span>
        </footer>
      </section>
    </div>
  );
}

function TokenBadge({ symbol }: { symbol: string }) {
  return <span className="tok-badge" aria-hidden="true">{symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?"}</span>;
}

function Stat({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) {
  return (
    <section className={`txe-card txe-stat tok-stat ${icon}`}>
      <div className="txe-stat-label"><Glyph name={icon} /><span>{label}</span></div>
      <strong>{value}</strong>
      <span className="txe-stat-note">{note}</span>
    </section>
  );
}

/** Daily counts with the missing days filled in as zero (a day with no row had no transfers). */
function dailySeries(daily: TokenDetail["daily"]): { t: string; v: number }[] {
  if (!daily.length) return [];
  const map = new Map(daily.map((d) => [d.day.slice(0, 10), d.transfers]));
  const first = Date.parse(daily[0]!.day.slice(0, 10));
  const last = Math.max(Date.parse(daily[daily.length - 1]!.day.slice(0, 10)), Date.parse(new Date().toISOString().slice(0, 10)));
  const out: { t: string; v: number }[] = [];
  for (let t = first; t <= last; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    out.push({ t: k, v: map.get(k) ?? 0 });
  }
  return out;
}

function TokenPage({ tokenKey }: { tokenKey: string }) {
  const [data, setData] = useState<TokenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    getToken(tokenKey)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof ApiError && e.status === 404 ? "No token with this key has been seen in a transfer event." : "This token could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [tokenKey, attempt]);
  const onCopy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  const t = data?.token;
  const series = useMemo(() => (data ? dailySeries(data.daily) : []), [data]);
  const max = Math.max(1, ...series.map((p) => p.v));
  const names = data?.names ?? {};

  return (
    <div className="txe-primary">
      <section className="txe-card txe-address" aria-label="Token">
        <div>
          <span>Token · {t ? t.standard.toUpperCase() : "…"}</span>
          <b className="txe-username tok-title">
            {t ? <><TokenBadge symbol={t.symbol} />{t.name ?? t.symbol} <small>{t.symbol}</small></> : <Skeleton h={22} w={200} />}
          </b>
          <strong title={tokenKey}>{tokenKey}</strong>
        </div>
        <CopyButton value={tokenKey} copied={copied} onCopy={onCopy} size={26} />
        <a href="#/tokens">All tokens</a>
      </section>

      {error ? (
        <section className="txe-card">
          <div className="txe-empty" role="status">{error}<button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>
        </section>
      ) : !t || !data ? (
        <section className="txe-card txe-funds"><Skeleton h={120} w="100%" /></section>
      ) : (
        <>
          <section className="txe-card txe-funds" aria-label="Token metadata">
            <div className="txe-funds-head">
              <span>Metadata</span>
              {t.registered ? <Chip tone="ok">Registered in grc20reg</Chip> : <Chip tone="muted">Not in the registry</Chip>}
            </div>
            <div className="txe-funds-grid">
              <div className="total">
                <span>Total supply</span>
                <strong title={t.total_supply ?? undefined}>{supplyText(t)}{t.total_supply !== null && t.standard === "grc20" ? ` ${t.symbol}` : ""}</strong>
                {t.total_supply === null && <small>Only readable for registered tokens</small>}
              </div>
              <div><span>Decimals</span><strong>{t.decimals ?? "—"}</strong></div>
              <div><span>Transfers · all time</span><strong>{fmt(Number(t.transfers))}</strong></div>
              <div><span>Transfers · 24h</span><strong>{fmt(Number(t.transfers_24h))}</strong></div>
              <div><span>Distinct receivers</span><strong>{fmt(Number(t.receivers))}</strong></div>
              <div><span>Last transfer</span><strong className="txe-small-strong">{t.last_transfer ? <Timestamp value={t.last_transfer} /> : "—"}</strong></div>
            </div>
            <ul className="txe-funds-list">
              <li><span>Realm</span><b><a className="txe-address-link" href={pkgHref(t.realm)}>{shortPath(t.realm)}</a> · <a className="txe-ext" href={gnowebHref(t.realm)} target="_blank" rel="noreferrer">gnoweb ↗</a></b></li>
              <li><span>Symbol</span><b>{t.symbol}</b></li>
              <li><span>Standard</span><b>{t.standard.toUpperCase()}</b></li>
              {t.registered && <li><span>Registry entry</span><b><a className="txe-ext" href={gnowebHref("gno.land/r/nt/grc20reg/v0", t.key)} target="_blank" rel="noreferrer">r/nt/grc20reg/v0:{shortPath(t.key)} ↗</a></b></li>}
            </ul>
            <p className="txe-funds-note">Name, decimals and supply are read from the GRC20 registry{(t as { synced_at?: string }).synced_at ? <> (synced <Timestamp value={(t as { synced_at?: string }).synced_at} />)</> : null}. Transfer counts come from indexed Transfer events since genesis; mints and burns count as transfers.</p>
          </section>

          <div className="tok-grid">
            <section className="txe-card tok-chart" aria-label="Daily transfers">
              <header><h3>Daily transfers</h3><span>{series.length ? `${series[0]!.t} → ${series[series.length - 1]!.t} · UTC days` : ""}</span></header>
              {series.length > 1 ? (
                <div className="tok-chart-body">
                  <span className="tok-axis">{fmt(max)}</span>
                  <TimeSeriesChart values={series.map((p) => p.v)} times={series.map((p) => p.t)} min={0} max={max} stroke="var(--brand)" fillColor="var(--brandSoft)" height={190} formatValue={(v) => `${fmt(v)} transfers`} formatTime={(s) => s} />
                </div>
              ) : (
                <p className="txe-muted tok-pad">{series.length === 1 ? `${fmt(series[0]!.v)} transfers on ${series[0]!.t}; not enough days for a chart.` : "No transfers recorded."}</p>
              )}
            </section>
            <section className="txe-card tok-receivers" aria-label="Top receivers">
              <header><h3>Top receivers</h3><span>by number of transfers received</span></header>
              {data.top_receivers.length ? (
                <ol>
                  {data.top_receivers.map((r) => (
                    <li key={r.address}>
                      <AddrLink address={r.address} names={names} head={10} tail={6} />
                      <span>{fmt(r.received)}</span>
                      <i><b style={{ width: `${(r.received / Math.max(1, data.top_receivers[0]!.received)) * 100}%` }} /></i>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="txe-muted tok-pad">No receivers yet.</p>
              )}
            </section>
          </div>

          <section className="txe-card txe-directory" aria-label="Recent transfers">
            <div className="tok-section-head"><h3>Recent transfers</h3><span>Newest {data.transfers.length}</span></div>
            <div className="txe-table-scroll" tabIndex={0} role="region" aria-label="Recent transfers">
              <table className="txe-table txe-transfer-table">
                <thead><tr><th>Tx hash</th><th>Block</th><th>Age</th><th>From</th><th>To</th><th className="num">{t.standard === "grc721" ? "Token id" : "Amount"}</th></tr></thead>
                <tbody>
                  {data.transfers.map((x) => (
                    <tr key={`${x.tx_hash}-${x.idx}`} onClick={() => (window.location.hash = txHref(x.tx_hash).slice(1))}>
                      <td><a className="txe-hash" href={txHref(x.tx_hash)} title={x.tx_hash} onClick={(e) => e.stopPropagation()}>{middle(x.tx_hash, 8, 4)}</a></td>
                      <td><a className="txe-address-link" href={blockHref(x.height)} onClick={(e) => e.stopPropagation()}>{fmt(x.height)}</a></td>
                      <td><Timestamp value={x.time} /></td>
                      <td><AddrLink address={x.from} names={names} empty={<em className="txe-mint">mint</em>} /></td>
                      <td><AddrLink address={x.to} names={names} empty={<em className="txe-mint">burn</em>} /></td>
                      <td className="num"><TokenAmount value={x.value} standard={t.standard} decimals={t.decimals} /></td>
                    </tr>
                  ))}
                  {!data.transfers.length && <tr><td className="txe-empty" colSpan={6}>No transfers recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
