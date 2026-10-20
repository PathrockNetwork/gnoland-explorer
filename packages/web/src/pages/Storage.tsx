/**
 * Storage deposits: realm state on gno.land is paid for per byte. Writing state
 * locks a deposit (price × bytes) from the signer; freeing state unlocks it.
 */
import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getStorage, type Storage as StorageData } from "../api";
import { bytes, fmt, gnot, gnotCompact, middle, pkgHref, txHref, blockHref } from "../lib";
import { Chip, Skeleton, TimeSeriesChart } from "../components/ui";
import { Timestamp } from "../components/Timestamp";
import { Addr, Tile, displayPath } from "./Realms";
import "./realms.css";
import "./storage.css";

const dayLabel = (iso: string) =>
  new Date(Date.parse(iso) + 12 * 3600e3).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Storage({ d }: { d: Dashboard }) {
  const [data, setData] = useState<StorageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStorage()
        .then((r) => { if (!cancelled) { setData(r); setError(null); } })
        .catch((e: Error) => { if (!cancelled) setError(e.message || "Storage data unavailable"); });
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const price = data?.price_per_byte ?? null;
  const series = data?.series ?? [];
  const lastDays = series.slice(-30);
  const genesis = d.net?.genesis_time;

  return (
    <div className="rlm-page stg-page">
      {error && !data && <div className="rlm-notice">{error}</div>}
      <div className="rlm-tiles">
        <Tile label="Realm state" value={data ? bytes(data.bytes) : "—"} note="Net bytes deposited minus bytes freed, all realms" />
        <Tile label="GNOT locked" value={data ? gnotCompact(data.deposit) : "—"} note={data ? `${gnot(data.deposit, 2)} held as deposits` : "Held as refundable deposits"} />
        <Tile label="Price per byte" value={price !== null ? `${fmt(price)} ugnot` : "—"} note={price !== null ? `${gnot(price * 1024, 4)} per KB · vm storage_price` : "Chain parameter vm:storage_price"} />
        <Tile label="Deposits / unlocks" value={data ? <>{fmt(data.deposits)}<span className="stg-sep">/</span><wbr />{fmt(data.unlocks)}</> : "—"} note="Storage events since genesis" />
        <Tile label="24 h growth" value={data ? `${data.bytes_24h >= 0 ? "+" : ""}${bytes(data.bytes_24h)}` : "—"} note={data && price !== null ? `${data.bytes_24h >= 0 ? "+" : "−"}${gnot(Math.abs(data.bytes_24h) * price, 2)} deposits` : "Net change, last 24 hours"} />
      </div>

      <section className="rlm-card stg-explain">
        <div>
          <h2>Why state costs a deposit</h2>
          <p>
            Every byte a realm keeps in its state is stored by every node forever, so gno.land charges for it. When a transaction makes a realm's
            state grow, the signer locks <b>{price !== null ? `${fmt(price)} ugnot` : "the storage price"}</b> per new byte as a deposit
            (capped by the transaction's <code>max_deposit</code>). When a later transaction frees state, the matching deposit is
            unlocked and refunded. Deposits are not fees: they stay locked in the realm's storage account while the bytes exist.
          </p>
        </div>
        <ul className="stg-legend-list">
          <li><Chip tone="brand">Deposit</Chip> state grew; GNOT locked</li>
          <li><Chip tone="muted">Unlock</Chip> state freed; GNOT refunded</li>
        </ul>
      </section>

      <div className="stg-charts">
        <section className="rlm-card stg-chart">
          <header className="rlm-card-head">
            <h2>Daily bytes written vs freed</h2>
            <span className="stg-legend"><i className="w" />Written <i className="f" />Freed</span>
          </header>
          <div className="rlm-pad">
            {!data ? <Skeleton h={200} w="100%" /> : lastDays.length ? <WrittenFreed rows={lastDays} /> : <div className="rlm-empty">No storage events yet.</div>}
            <p className="rlm-muted rlm-small stg-chart-note">{lastDays.length ? `Last ${lastDays.length} days (daily, server day boundaries). Freed bytes plot below the line.` : ""}</p>
          </div>
        </section>
        <section className="rlm-card stg-chart">
          <header className="rlm-card-head">
            <h2>Total realm state</h2>
            <span className="rlm-muted rlm-small">{series.length ? `since ${genesis ? dayLabel(genesis) : dayLabel(series[0]!.day)}` : ""}</span>
          </header>
          <div className="rlm-pad">
            {!data ? <Skeleton h={200} w="100%" /> : series.length > 1 ? (
              <TimeSeriesChart values={series.map((s) => s.total)} times={series.map((s) => s.day)} min={0} max={Math.max(1, ...series.map((s) => s.total)) * 1.05}
                stroke="var(--brand)" fillColor="var(--brandSoft)" height={200} formatValue={(v) => bytes(v)} formatTime={dayLabel} />
            ) : <div className="rlm-empty">Not enough history.</div>}
            <p className="rlm-muted rlm-small stg-chart-note">Cumulative net bytes at the end of each day{price !== null && data ? ` · now ${bytes(data.bytes)} ≈ ${gnotCompact(String(BigInt(Math.max(0, data.bytes)) * BigInt(price)))}` : ""}.</p>
          </div>
        </section>
      </div>

      <div className="stg-lists">
        <section className="rlm-card stg-top">
          <header className="rlm-card-head"><h2>Top realms by storage</h2><span className="rlm-muted rlm-small">{data ? `top ${data.top.length}` : ""}</span></header>
          {!data ? <div className="rlm-pad"><Skeleton h={300} w="100%" /></div> : (
            <div className="rlm-table-scroll">
              <table className="rlm-table">
                <thead><tr><th>#</th><th>Realm</th><th className="num">State</th><th>Share</th><th className="num">Deposit</th><th className="num">Writes</th><th>Last write</th></tr></thead>
                <tbody>
                  {data.top.map((r, i) => (
                    <tr key={r.path}>
                      <td className="rlm-muted">{i + 1}</td>
                      <td className="rlm-path-cell"><a className="rlm-path" href={pkgHref(r.path)} title={r.path}>{displayPath(r.path)}</a></td>
                      <td className="num">{bytes(r.bytes)}</td>
                      <td className="stg-share"><span className="rlm-rank-bar"><i style={{ width: `${data.bytes ? Math.max(0.5, (r.bytes / data.bytes) * 100) : 0}%` }} /></span><small>{data.bytes ? `${((r.bytes / data.bytes) * 100).toFixed(1)}%` : "—"}</small></td>
                      <td className="num">{gnot(r.deposit, 2)}</td>
                      <td className="num">{fmt(r.writes)}</td>
                      <td><Timestamp value={r.last_write} /></td>
                    </tr>
                  ))}
                  {!data.top.length && <tr><td colSpan={7} className="rlm-empty">No realm holds state yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rlm-card stg-recent">
          <header className="rlm-card-head"><h2>Recent deposits &amp; unlocks</h2><span className="rlm-muted rlm-small">newest {data?.recent.length ?? ""}</span></header>
          {!data ? <div className="rlm-pad"><Skeleton h={300} w="100%" /></div> : (
            <div className="rlm-table-scroll">
              <table className="rlm-table">
                <thead><tr><th>Event</th><th>Realm</th><th className="num">Bytes</th><th className="num">Amount</th><th>Signer</th><th>Tx</th></tr></thead>
                <tbody>
                  {data.recent.map((e, i) => {
                    const unlock = e.kind === "storage_unlock";
                    return (
                      <tr key={`${e.tx_hash}:${i}`}>
                        <td>{unlock ? <Chip tone="muted">Unlock</Chip> : <Chip tone="brand">Deposit</Chip>}<small><Timestamp value={e.time} /></small></td>
                        <td className="rlm-path-cell stg-narrow"><a className="rlm-link" href={pkgHref(e.pkg_path)} title={e.pkg_path}>{displayPath(e.pkg_path)}</a></td>
                        <td className="num"><span className={e.bytes_delta >= 0 ? "rlm-up" : "rlm-down"}>{e.bytes_delta > 0 ? "+" : ""}{bytes(e.bytes_delta)}</span></td>
                        <td className="num">{unlock ? "−" : "+"}{gnot(e.amount, 4)}</td>
                        <td><Addr address={e.signer} /></td>
                        <td><a className="rlm-link" href={txHref(e.tx_hash)} title={e.tx_hash}>{middle(e.tx_hash, 6, 4)}</a><small><a className="rlm-link" href={blockHref(e.height)}>#{fmt(e.height)}</a></small></td>
                      </tr>
                    );
                  })}
                  {!data.recent.length && <tr><td colSpan={6} className="rlm-empty">No storage events yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Diverging daily bars: bytes written above the baseline, bytes freed below, one shared scale. */
function WrittenFreed({ rows }: { rows: StorageData["series"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const maxW = Math.max(1, ...rows.map((r) => r.written));
  const maxF = Math.max(0, ...rows.map((r) => r.freed));
  const span = maxW + maxF || 1;
  const base = (maxW / span) * 100; // baseline position from top, %
  const n = rows.length;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="stg-bars-wrap">
      <div className="stg-bars" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Daily bytes written and freed over ${n} days`}>
        <span className="stg-base" style={{ top: `${base}%` }} />
        {rows.map((r, i) => (
          <div key={r.day} className={`stg-col${hover === i ? " on" : ""}`}>
            <i className="w" style={{ bottom: `${100 - base}%`, height: `${(r.written / span) * 100}%` }} />
            {r.freed > 0 && <i className="f" style={{ top: `${base}%`, height: `${Math.max(0.6, (r.freed / span) * 100)}%` }} />}
          </div>
        ))}
        {h && hover !== null && (
          <div className="stg-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, transform: `translateX(${hover < n / 4 ? "-10%" : hover > (3 * n) / 4 ? "-90%" : "-50%"})` }}>
            <span className="rlm-muted">{dayLabel(h.day)}</span>
            <span><i className="w" />Written <b>{bytes(h.written)}</b></span>
            <span><i className="f" />Freed <b>{bytes(h.freed)}</b></span>
            <span>Net <b>{h.written - h.freed >= 0 ? "+" : ""}{bytes(h.written - h.freed)}</b></span>
            <span className="rlm-muted">Deposited {gnot(h.deposit, 2)}</span>
          </div>
        )}
      </div>
      <div className="stg-axis"><span>{dayLabel(rows[0]!.day)}</span><span>{bytes(maxW)} max/day</span><span>{dayLabel(rows[n - 1]!.day)}</span></div>
    </div>
  );
}
