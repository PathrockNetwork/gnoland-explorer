/**
 * Overview bottom row: the latest transactions (one-line summaries) and a
 * realms panel that flips between the most-called realms of the last 24 h
 * and the most recent package deployments.
 */
import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getAnalytics, getPackages, getTransactions, type Analytics, type Names, type PackageRow, type Tx } from "../api";
import { addrHref, coinText, fmt, kindLabel, pkgHref, short, shortPath, txHref, txSummary } from "../lib";
import { Identicon, Skeleton, panel } from "./ui";
import { Timestamp } from "./Timestamp";
import { MetricGlyph } from "./OverviewGlyph";

const TX_POLL_MS = 6_000;
const REALM_POLL_MS = 60_000;

/** Poll `fn` now and every `ms` while live (only when the tab is visible). */
function usePolled<T>(fn: () => Promise<T>, ms: number, live: boolean): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fn()
        .then((r) => {
          if (cancelled) return;
          setData(r);
          setError(false);
        })
        .catch(() => !cancelled && setError(true));
    void load();
    if (!live) return () => {
      cancelled = true;
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ms]);
  return { data, error };
}

/** "@name" when the address has a registered username, else the short address. */
export function who(address: string | null | undefined, names: Names): string {
  if (!address) return "—";
  const n = names[address];
  return n ? `@${n}` : short(address);
}

export function OverviewLatestTransactions({ d, live }: { d: Dashboard; live: boolean }) {
  const { data, error } = usePolled(() => getTransactions(10), TX_POLL_MS, live);
  const txs: Tx[] | null = data?.txs ?? null;
  const names = data?.names ?? {};
  const loading = txs === null && !error;
  return (
    <section className="overview-watchlist overview-latest-txs" style={panel}>
      <header>
        <h3><MetricGlyph icon="transactions" /> Latest Transactions <small>{txs ? txs.length : "—"}</small></h3>
        <a href="#/transactions" aria-label="View all transactions" title="View all transactions">View all <span aria-hidden="true">→</span></a>
      </header>
      <div className="overview-watchlist-items" role="region" aria-label="Latest transactions" tabIndex={0}>
        {loading ? (
          <Skeleton h={70} w="100%" />
        ) : error && !txs ? (
          <p className="overview-muted">Transactions are unavailable.</p>
        ) : !txs || txs.length === 0 ? (
          <div className="overview-watchlist-empty">
            <span className="watchlist-empty-star" aria-hidden="true">⇄</span>
            <strong>No transactions indexed yet</strong>
            <p>Transactions appear as blocks are indexed.</p>
          </div>
        ) : (
          txs.map((t) => {
            const kind = t.kinds[0] ?? "";
            return (
              <a
                key={t.hash}
                className="olt-row"
                href={txHref(t.hash)}
                title={`${t.hash}\n${txSummary(t)}\nsigner ${t.signer ?? "—"}\nblock ${fmt(t.height)} · fee ${coinText(t.fee, t.fee_denom)}${t.success ? "" : "\nfailed"}`}
              >
                <Identicon address={t.signer ?? t.hash} size={20} />
                <span className="olt-main">
                  <span className="olt-summary">{txSummary(t)}</span>
                  <span className="olt-meta">
                    {who(t.signer, names)} · #{fmt(t.height)} · <Timestamp value={t.time} />
                  </span>
                </span>
                <small className={`watch-badge ${t.success ? "active" : "inactive"} olt-kind-${kind.replace("/", "-")}`}>{t.success ? kindLabel(kind) : "Failed"}</small>
              </a>
            );
          })
        )}
      </div>
      {d.state === "stopped" && <p className="overview-muted">Indexer stopped · showing last known data.</p>}
    </section>
  );
}

type RealmTab = "active" | "recent";

export function OverviewRealms({ d, live }: { d: Dashboard; live: boolean }) {
  const [tab, setTab] = useState<RealmTab>("active");
  const active = usePolled<Analytics>(() => getAnalytics(24), REALM_POLL_MS, live);
  const recent = usePolled(() => getPackages({ sort: "recent", limit: 6 }), REALM_POLL_MS, live);
  const realms = active.data?.realms.slice(0, 6) ?? null;
  const deploys: PackageRow[] | null = recent.data?.packages ?? null;
  const unavailable = d.state === "dberror";
  const maxTxs = Math.max(1, ...(realms ?? []).map((r) => r.txs));
  const current = tab === "active" ? active : recent;
  const loading = current.data === null && !current.error;
  return (
    <section className="overview-insights-panel overview-realms-panel" style={panel}>
      <header>
        <MetricGlyph icon="package" />
        <h3>Realms</h3>
        <div className="overview-realm-tabs" role="tablist" aria-label="Realm list">
          <button type="button" role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>Most active · 24h</button>
          <button type="button" role="tab" aria-selected={tab === "recent"} onClick={() => setTab("recent")}>Recent deployments</button>
        </div>
      </header>
      {loading ? (
        <Skeleton h={170} w="100%" />
      ) : unavailable || (current.error && current.data === null) ? (
        <p className="overview-muted">Realm activity is unavailable right now.</p>
      ) : tab === "active" ? (
        !realms?.length ? (
          <p className="overview-muted">No realm calls in the last 24 hours.</p>
        ) : (
          <ul className="overview-realm-list">
            {realms.map((r) => (
              <li key={r.path}>
                <a href={pkgHref(r.path)} title={r.path} className="overview-realm-path">{shortPath(r.path)}</a>
                <span className="overview-realm-meta">{fmt(r.senders)} {r.senders === 1 ? "caller" : "callers"}{r.failed ? ` · ${fmt(r.failed)} failed` : ""}</span>
                <strong>{fmt(r.txs)}<small> tx</small></strong>
                <span className="overview-realm-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (r.txs / maxTxs) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        )
      ) : !deploys?.length ? (
        <p className="overview-muted">No packages deployed yet.</p>
      ) : (
        <ul className="overview-realm-list">
          {deploys.map((p) => (
            <li key={p.path}>
              <a href={pkgHref(p.path)} title={p.path} className="overview-realm-path">{shortPath(p.path)}</a>
              <span className="overview-realm-meta">
                <a href={addrHref(p.creator)} title={p.creator}>{p.creator_name ? `@${p.creator_name}` : short(p.creator)}</a> · <Timestamp value={p.time} />
              </span>
              <strong className={`overview-realm-kind ${p.kind}`}>{p.kind === "pure" ? "package" : p.kind}{p.status === "inert" ? " · inert" : ""}</strong>
            </li>
          ))}
        </ul>
      )}
      <footer className="overview-realm-foot">
        <span>{tab === "active" ? "Transactions calling each realm, last 24 h" : `${fmt(d.net?.packages?.deployed_24h ?? null)} deployed in the last 24 h`}</span>
        <a href="#/realms">All realms <span aria-hidden="true">→</span></a>
      </footer>
    </section>
  );
}
