/** Analytics: who uses gno.land and how the chain is producing blocks, over a selectable horizon. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { getAnalytics, getSeries, type Analytics, type Series } from "../api";
import { addrHref, fmt, gnotCompact, kindLabel, middle, pct, pkgHref, secs, shortPath, bytes } from "../lib";
import { Identicon } from "../components/ui";
import { RANGES, bucketLabel, bucketSecsFor, chartDomain, chartSegments, compact, gasPriceText, mixBuckets, rangeLabel, seriesExtent, seriesPoints, seriesTotals, type ChartPoint, type MixBucket } from "../analyticsExplorer";
import "./analytics.css";

const time = (ms: number, day = false) => new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", ...(day ? { month: "short", day: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });
const dateOnly = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short", day: "2-digit" });
const ugnot = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v) ? "—" : gnotCompact(String(Math.round(v)));
const countText = (v: number | null) => v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 1 : 0 });
const MIX: { key: keyof Pick<MixBucket, "calls" | "sends" | "deploys" | "runs">; label: string; tone: string }[] = [
  { key: "calls", label: "Calls", tone: "brand" },
  { key: "sends", label: "Sends", tone: "grey" },
  { key: "deploys", label: "Deploys", tone: "warn" },
  { key: "runs", label: "Runs", tone: "accent" },
];

/** Series + analytics for the selected horizon; keeps the last snapshot while a new one loads. */
function useWindowData(hours: number) {
  const [series, setSeries] = useState<Series | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [s, a] = await Promise.allSettled([getSeries(hours), getAnalytics(hours)]);
      if (cancelled) return;
      if (s.status === "fulfilled") setSeries(s.value);
      if (a.status === "fulfilled") setAnalytics(a.value);
      setError(s.status === "rejected" || a.status === "rejected");
      setLoadedAt(Date.now());
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [hours, retry]);
  return { series, analytics, error, loadedAt, retry: () => setRetry(n => n + 1) };
}

export function Metrics({ d, hours, onHours }: { d: Dashboard; hours: number; onHours: (h: number) => void }) {
  const { series, analytics: a, error, loadedAt, retry } = useWindowData(hours);
  const m = d.metrics;
  const shown = series?.hours ?? hours, label = rangeLabel(shown);
  const end = loadedAt, start = end - shown * 3_600_000;
  const step = (series?.bucket_secs ?? bucketSecsFor(shown)) * 1000;
  const day = shown > 24;
  const genesis = d.net?.genesis_time ? Date.parse(d.net.genesis_time) : NaN;
  const from = Number.isFinite(genesis) ? Math.max(start, genesis) : start;
  const points = series?.points ?? [];
  const opts = { step, start: from, end };
  const txs = useMemo(() => seriesPoints(points, "txs", { ...opts, completeOnly: true }), [series, end]);
  const blocks = useMemo(() => seriesPoints(points, "blocks", { ...opts, completeOnly: true }), [series, end]);
  const blockTime = useMemo(() => seriesPoints(points, "block_time", opts), [series, end]);
  const senders = useMemo(() => seriesPoints(points, "senders", { ...opts, completeOnly: true }), [series, end]);
  const failed = useMemo(() => seriesPoints(points, "failed", { ...opts, completeOnly: true }), [series, end]);
  const fees = useMemo(() => seriesPoints(points, "fees", { ...opts, completeOnly: true }), [series, end]);
  const mix = useMemo(() => mixBuckets(points, step, from, end), [series, end]);
  const totals = useMemo(() => seriesTotals(points), [series]);
  const txExt = seriesExtent(txs), btExt = seriesExtent(blockTime), sendExt = seriesExtent(senders);
  const bt = m?.block_time;
  const failRate = totals.txs ? totals.failed / totals.txs * 100 : null;
  const loading = !series && !error;
  const metricsStale = !!m && m.hours !== hours;
  const summary: { label: string; value: string; note: string; icon: string; tone: string; points?: ChartPoint[] }[] = [
    { label: `Transactions · ${label}`, value: series ? fmt(totals.txs) : "—", note: "Transactions in blocks committed in the window", icon: "bars", tone: "normal", points: txs },
    { label: `Blocks · ${label}`, value: series ? fmt(totals.blocks) : "—", note: "Blocks committed in the window", icon: "block", tone: "normal", points: blocks },
    { label: `Block time p50 · ${rangeLabel(m?.hours ?? hours)}`, value: secs(bt?.p50), note: `p90 ${secs(bt?.p90)} · p99 ${secs(bt?.p99)} between consecutive blocks`, icon: "clock", tone: bt?.p50 == null ? "muted" : "ok", points: blockTime },
    { label: `Failed txs · ${label}`, value: series ? fmt(totals.failed) : "—", note: failRate === null ? "Share of transactions that failed" : `${pct(failRate, 2)} of transactions in the window`, icon: "alert", tone: failRate !== null && failRate > 5 ? "warn" : "normal", points: failed },
    { label: `Fees paid · ${label}`, value: ugnot(a?.gas?.fees), note: "Total gas fees paid by transaction senders", icon: "coins", tone: "normal", points: fees },
    { label: `Gas efficiency · ${label}`, value: pct(a?.gas?.gas_efficiency == null ? null : a.gas.gas_efficiency * 100), note: "Gas used ÷ gas wanted, all transactions", icon: "gauge", tone: "normal" },
  ];
  return <div className="ane-page">
    <div className="ane-toolbar"><span>{series ? `${time(start, true)} – ${time(end, true)} UTC` : "Loading chain history…"}</span><div className="ane-ranges" aria-label="Analytics time range">{RANGES.map(h => <button key={h} type="button" aria-pressed={hours === h} onClick={() => onHours(h)}>{rangeLabel(h)}</button>)}</div></div>
    {series && from > start + step && <div className="ane-notice muted" role="status"><span>gno.land mainnet launched {dateOnly(from)} (genesis); this {label} window reaches back before it, so earlier buckets are not shown.</span></div>}
    {(error || (series && series.hours !== hours) || metricsStale) && <div className="ane-notice" role="status"><span>{error ? `Analytics could not refresh.${series ? ` Showing the last loaded ${label} snapshot.` : ""}` : `Loading ${rangeLabel(hours)} · showing ${series && series.hours !== hours ? label : rangeLabel(m?.hours ?? hours)} until it arrives.`}</span>{error && <button type="button" onClick={retry}>Retry</button>}</div>}
    <div className="ane-stats">{summary.map(s => <section className={`ane-panel ane-stat ${s.tone}`} key={s.label}><div className="ane-stat-label"><Icon name={s.icon} /><span>{s.label}</span></div><div className="ane-stat-value"><strong>{s.value}</strong>{s.points && <Sparkline points={s.points} step={step} />}</div><p title={s.note}>{s.note}</p></section>)}</div>
    <div className="ane-main-grid">
      <section className="ane-panel ane-chart-card"><PanelHeading title="Transactions" description={`Transactions per ${bucketLabel(step / 1000)}. Partial edge buckets are left out.`} icon="bars" right={<span className="ane-range-label">{label}</span>} /><HistoryChart label="Transactions" points={txs} start={start} end={end} step={step} day={day} domain={chartDomain(txs, 5)} format={v => fmt(Math.round(v))} tick={v => compact(v)} loading={loading} /><div className="ane-chart-footer"><Legend label={`Txs per ${bucketLabel(step / 1000)}`} /><span>Total <b>{series ? fmt(totals.txs) : "—"}</b> <i>·</i> Peak bucket <b>{fmt(txExt.max)}</b></span></div></section>
      <section className="ane-panel ane-chart-card"><PanelHeading title="Block time" description={`Bucket length ÷ blocks committed in it. Dashed line: median gap between consecutive blocks over ${rangeLabel(m?.hours ?? hours)}.`} icon="clock" right={<span className="ane-range-label">{label}</span>} /><HistoryChart label="Block time" points={blockTime} start={start} end={end} step={step} day={day} domain={chartDomain(blockTime, 4)} format={v => secs(v)} tick={v => `${Number(v.toFixed(1))}`} unit="s" reference={bt?.p50 ?? undefined} loading={loading} /><div className="ane-chart-footer"><Legend label="Bucket average" />{bt?.p50 != null && <Legend label="Window p50" target />}<span>Fastest <b>{secs(btExt.min)}</b> <i>·</i> Slowest <b>{secs(btExt.max)}</b></span></div></section>
      <section className="ane-panel ane-chart-card"><PanelHeading title="Active senders" description={`Distinct transaction signers per ${bucketLabel(step / 1000)}.`} icon="people" right={<span className="ane-range-label">{label}</span>} /><HistoryChart label="Active senders" points={senders} start={start} end={end} step={step} day={day} domain={chartDomain(senders, 5)} format={v => fmt(Math.round(v))} tick={v => compact(v)} loading={loading} /><div className="ane-chart-footer"><Legend label="Distinct signers" /><span>Average <b>{countText(sendExt.mean)}</b> <i>·</i> Peak bucket <b>{fmt(sendExt.max)}</b></span></div></section>
    </div>
    <div className="ane-support-grid">
      <section className="ane-panel ane-mix-panel"><PanelHeading title="Activity mix" description={`Transactions per ${bucketLabel(step / 1000)} by message kind. A transaction with several kinds counts once per kind.`} icon="bars" right={<span className="ane-range-label">{label}</span>} />{series ? <MixChart buckets={mix} day={day} end={end} /> : <Empty loading={loading} />}</section>
      <section className="ane-panel ane-proposers"><Proposers d={d} /></section>
      <section className="ane-panel ane-percentiles"><BlockTimes d={d} /></section>
    </div>
    <UsageSection analytics={a} label={a ? rangeLabel(a.hours) : label} storage={series ? totals.storage : null} loading={!a && !error} />
    <div className="ane-method-note">All times UTC · {bucketLabel(step / 1000)} buckets · full history is kept since genesis{d.net?.genesis_time ? ` (${dateOnly(Date.parse(d.net.genesis_time))})` : ""} · the newest bucket is still filling and is left out of charts · fees are in GNOT (1 GNOT = 1,000,000 ugnot) · proposer counts cover every block in the window.</div>
  </div>;
}

/** Who uses gno.land: realms, functions, senders, message kinds, gas and failures from /api/v1/analytics. */
function UsageSection({ analytics: a, label, storage, loading }: { analytics: Analytics | null; label: string; storage: number | null; loading: boolean }) {
  const [all, setAll] = useState(false);
  const g = a?.gas;
  const txTotal = g?.txs ?? 0;
  const realms = a?.realms ?? [], visible = all ? realms : realms.slice(0, 10);
  const maxShare = Math.max(1, ...realms.map(r => r.txs));
  const kinds = a?.kinds ?? [], kindTotal = kinds.reduce((s, k) => s + k.n, 0);
  const funcs = a?.funcs ?? [], maxCalls = Math.max(1, ...funcs.map(f => f.calls));
  const failures = a?.failures ?? [], maxFail = Math.max(1, ...failures.map(f => f.n));
  const senders = a?.senders ?? [];
  return <section className="ane-usage" aria-labelledby="ane-usage-title">
    <header className="ane-usage-head">
      <div><h2 id="ane-usage-title"><Icon name="people" />Who uses gno.land</h2><p>Realms, functions and accounts behind the transactions of the last {label}, from the explorer's index of every transaction since genesis.</p></div>
      <span className="ane-range-label">{label}</span>
    </header>
    <div className="ane-usage-totals">
      <div><span>Transactions</span><strong>{g ? fmt(g.txs) : "—"}</strong></div>
      <div><span>Fees paid</span><strong>{ugnot(g?.fees)}</strong></div>
      <div><span>Median gas price</span><strong title="Fee ÷ gas wanted, median over transactions">{gasPriceText(g?.median_gas_price)}</strong></div>
      <div><span>Avg gas used / wanted</span><strong>{g ? `${compact(g.avg_gas_used)} / ${compact(g.avg_gas_wanted)}` : "—"}</strong></div>
      <div><span>Packages deployed</span><strong title={a?.deploys ? `${fmt(a.deploys.realms)} realms · ${fmt(a.deploys.creators)} creators` : undefined}>{a?.deploys ? fmt(a.deploys.n) : "—"}</strong>{a?.deploys && <small>{fmt(a.deploys.realms)} realms · {fmt(a.deploys.creators)} creators</small>}</div>
      <div><span>Realm storage, net</span><strong>{storage === null ? "—" : `${storage > 0 ? "+" : ""}${bytes(storage)}`}</strong><small>Bytes added minus bytes freed</small></div>
    </div>
    <div className="ane-usage-grid">
      <section className="ane-panel ane-usage-table">
        <PanelHeading title="Top realms" description="Packages touched by the most transactions (called, deployed or run). Gas and fees are those of the whole transaction." icon="bars" right={<span className="ane-count">{a ? realms.length : "—"}</span>} />
        <div className="ane-table-wrap" tabIndex={0} role="region" aria-label="Top realms"><table><thead><tr><th>#</th><th>Realm</th><th>Txs</th><th>Senders</th><th>Failed</th><th>Gas used</th><th>Fees</th></tr></thead><tbody>
          {visible.map((r, i) => <tr key={r.path}><td>{i + 1}</td><td><a className="ane-usage-name" href={pkgHref(r.path)} title={r.path}><span>{shortPath(r.path)}</span></a><span className="ane-share"><i><b style={{ width: `${r.txs / maxShare * 100}%` }} /></i>{txTotal ? pct(r.txs / txTotal * 100) : ""}</span></td><td>{fmt(r.txs)}</td><td>{fmt(r.senders)}</td><td className={r.failed ? "ane-warn-text" : undefined}>{fmt(r.failed)}</td><td>{compact(r.gas)}</td><td>{ugnot(r.fees)}</td></tr>)}
        </tbody></table>{!realms.length && <Empty loading={loading} text="No realm activity in this window." />}</div>
        {realms.length > 10 && <button type="button" className="ane-usage-more" onClick={() => setAll(!all)}>{all ? "Show top 10" : `Show all ${realms.length}`}</button>}
      </section>
      <div className="ane-usage-side">
        <section className="ane-panel"><PanelHeading title="Message mix" description="Messages by kind. One transaction can carry several messages." icon="notes" />
          <div className="ane-barlist">{kinds.map(k => <div key={k.kind} className="ane-barrow"><span title={k.kind}>{kindLabel(k.kind)} <small>{k.kind}</small></span><i><b style={{ width: `${kindTotal ? k.n / kindTotal * 100 : 0}%` }} /></i><strong>{fmt(k.n)}</strong><em>{kindTotal ? pct(k.n / kindTotal * 100) : "—"}</em></div>)}{!kinds.length && <Empty loading={loading} text="No messages in this window." />}</div>
        </section>
        <section className="ane-panel"><PanelHeading title="Failure reasons" description="Error type of failed transactions." icon="alert" right={<span className="ane-count">{a ? fmt(failures.reduce((s, f) => s + f.n, 0)) : "—"}</span>} />
          <div className="ane-barlist">{failures.map(f => <div key={f.error} className="ane-barrow fail"><span title={f.error}>{f.error}</span><i><b style={{ width: `${f.n / maxFail * 100}%` }} /></i><strong>{fmt(f.n)}</strong></div>)}{!failures.length && <Empty loading={loading} text="No failed transactions in this window." />}</div>
        </section>
      </div>
    </div>
    <div className="ane-usage-grid even">
      <section className="ane-panel"><PanelHeading title="Top functions" description="Realm functions called most often (MsgCall)." icon="code" right={<span className="ane-count">{a ? funcs.length : "—"}</span>} />
        <div className="ane-barlist">{funcs.map(f => { const dot = f.func.lastIndexOf("."); const pkg = dot > 0 ? f.func.slice(0, dot) : f.func; return <div key={f.func} className="ane-barrow func"><a href={pkgHref(pkg)} title={f.func}><span>{shortPath(pkg)}</span>.<b>{dot > 0 ? f.func.slice(dot + 1) : ""}</b></a><i><b style={{ width: `${f.calls / maxCalls * 100}%` }} /></i><strong>{fmt(f.calls)}</strong></div>; })}{!funcs.length && <Empty loading={loading} text="No function calls in this window." />}</div>
      </section>
      <section className="ane-panel ane-usage-table"><PanelHeading title="Top senders" description="Accounts that signed the most transactions." icon="people" right={<span className="ane-count">{a ? senders.length : "—"}</span>} />
        <div className="ane-table-wrap" tabIndex={0} role="region" aria-label="Top senders"><table><thead><tr><th>#</th><th>Account</th><th>Txs</th><th>Share</th><th>Fees</th></tr></thead><tbody>
          {senders.map((s, i) => <tr key={s.address}><td>{i + 1}</td><td><a className="ane-account" href={addrHref(s.address)} title={s.address}><Identicon address={s.address} size={16} /><span>{s.username ? `@${s.username}` : middle(s.address, 10, 6)}</span>{s.username && <small>{middle(s.address, 6, 4)}</small>}</a></td><td>{fmt(s.txs)}</td><td>{txTotal ? pct(s.txs / txTotal * 100) : "—"}</td><td>{ugnot(s.fees)}</td></tr>)}
        </tbody></table>{!senders.length && <Empty loading={loading} text="No signed transactions in this window." />}</div>
      </section>
    </div>
  </section>;
}

function PanelHeading({ title, description, icon, right }: { title: string; description?: string; icon: string; right?: ReactNode }) { return <header className="ane-panel-heading"><div><h2><Icon name={icon} />{title}</h2>{description && <p>{description}</p>}</div>{right}</header>; }
function Dot({ tone }: { tone: string }) { return <i className={`ane-dot ${tone}`} aria-hidden="true" />; }
function Legend({ label, target = false, tone = "brand" }: { label: string; target?: boolean; tone?: string }) { return <span className="ane-legend">{target ? <i className="ane-target-key" /> : <Dot tone={tone} />}{label}</span>; }
function Empty({ loading = false, text = "No measured data in this window." }: { loading?: boolean; text?: string }) { return <div className="ane-empty" role="status">{loading ? "Loading measurements…" : text}</div>; }

function Sparkline({ points, step }: { points: ChartPoint[]; step: number }) {
  const ext = seriesExtent(points), segments = chartSegments(points, step);
  if (ext.count < 2) return null;
  const start = points[0].t, width = Math.max(1, points[points.length - 1].t - start), span = Math.max(1e-9, ext.max! - ext.min!);
  return <svg className="ane-spark" viewBox="0 0 100 32" aria-hidden="true">{segments.map((segment, i) => <polyline key={i} points={segment.map(p => `${(p.t - start) / width * 100},${27 - (p.value - ext.min!) / span * 21}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />)}</svg>;
}

function HistoryChart({ label, points, start, end, step, day, domain, format, tick, unit, reference, loading }: { label: string; points: ChartPoint[]; start: number; end: number; step: number; day: boolean; domain: [number, number]; format: (v: number) => string; tick: (v: number) => string; unit?: string; reference?: number; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [min, max] = domain, ext = seriesExtent(points);
  const segments = chartSegments(points, step);
  const x = (t: number) => Math.max(0, Math.min(1000, (t - start) / (end - start) * 1000));
  const y = (v: number) => 200 - (Math.max(min, Math.min(max, v)) - min) / (max - min || 1) * 200;
  const fmtValue = (v: number | null) => v === null ? "—" : format(v);
  const selected = hover !== null ? points[Math.min(hover, points.length - 1)] : undefined;
  const ticks = [0, 1, 2, 3, 4];
  const selectNearest = (clientX: number, rect: DOMRect) => {
    const targetTime = start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (end - start);
    let nearest = 0; points.forEach((p, i) => { if (Math.abs(p.t - targetTime) < Math.abs(points[nearest].t - targetTime)) nearest = i; });
    if (points.length) setHover(nearest);
  };
  return <div className="ane-history"><div className="ane-y-axis">{ticks.map(t => <span key={t}>{tick(max - (max - min) * t / 4)}{unit && t === 0 ? ` ${unit}` : ""}</span>)}</div><div className="ane-history-plot" tabIndex={0} role="group" aria-label={`${label} chart. Use left and right arrow keys to inspect buckets.`} onFocus={() => points.length && setHover(points.length - 1)} onBlur={() => setHover(null)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && points.length) { event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (hover ?? 0) + (event.key === "ArrowRight" ? 1 : -1)))); } }} onPointerMove={event => selectNearest(event.clientX, event.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">{ticks.map(t => <line key={t} x1="0" x2="1000" y1={t * 50} y2={t * 50} className="ane-grid-line" />)}{[0, 1, 2, 3, 4, 5, 6, 7, 8].map(t => <line key={t} y1="0" y2="200" x1={t * 125} x2={t * 125} className="ane-grid-line" />)}{reference !== undefined && <line x1="0" x2="1000" y1={y(reference)} y2={y(reference)} className="ane-target-line" />}{segments.map((segment, i) => { const line = segment.map(p => `${x(p.t)},${y(p.value)}`).join(" "); return <g key={i}>{segment.length > 1 && <polygon points={`${x(segment[0].t)},200 ${line} ${x(segment[segment.length - 1].t)},200`} fill="var(--brandSoft)" />}<polyline points={line} className="ane-series-line" />{segment.length === 1 && <circle cx={x(segment[0].t)} cy={y(segment[0].value)} r="3" fill="var(--brand2)" />}</g>; })}{selected && <line x1={x(selected.t)} x2={x(selected.t)} y1="0" y2="200" className="ane-cursor-line" />}</svg>
      {!ext.count && <Empty loading={loading} />}{selected && <div className="ane-chart-tooltip" role="status" style={{ left: `${Math.min(72, Math.max(0, x(selected.t) / 10 - 12))}%` }}><span>{time(selected.t, day)} UTC</span><strong>{selected.value === null ? "No reading" : fmtValue(selected.value)}</strong><small>{selected.value === null ? "Partial or empty bucket" : "Bucket value"}</small></div>}
    </div><div className="ane-x-axis">{ticks.map(t => <span key={t}>{time(start + (end - start) * t / 4, day)}</span>)}</div><div className="ane-chart-extents"><span>Bucket min <b>{fmtValue(ext.min)}</b></span><span>Bucket max <b>{fmtValue(ext.max)}</b></span><span>{ext.count} readings</span></div></div>;
}

/** Stacked bars of calls / sends / deploys / runs per bucket. */
function MixChart({ buckets, day, end }: { buckets: MixBucket[]; day: boolean; end: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const total = (b: MixBucket) => b.calls + b.sends + b.deploys + b.runs;
  const max = Math.max(1, ...buckets.map(total)) * 1.08;
  const hovered = selected === null ? null : buckets[selected];
  const sums = MIX.map(k => buckets.reduce((s, b) => s + b[k.key], 0));
  return <><div className="ane-volume-total">{MIX.map((k, i) => <span key={k.key} className="ane-legend"><Dot tone={k.tone} />{k.label} <strong>{fmt(sums[i])}</strong></span>)}</div><div className="ane-volume-chart"><div className="ane-volume-axis">{[1, .5, 0].map(f => <span key={f}>{compact(Math.round(max * f))}</span>)}</div><div className={`ane-volume-plot ane-mix-plot ${buckets.length > 48 ? "dense" : ""}`}>{buckets.map((b, i) => <button type="button" key={b.t} className={b.complete ? "" : "partial"} style={{ height: `${Math.max(total(b) ? 1 : 0, total(b) / max * 100)}%` }} aria-label={`${time(b.t, true)} UTC: ${MIX.map(k => `${b[k.key]} ${k.label.toLowerCase()}`).join(", ")}${b.complete ? "" : ", partial bucket"}`} onPointerEnter={() => setSelected(i)} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(i)} onBlur={() => setSelected(null)}>{MIX.map(k => b[k.key] ? <i key={k.key} className={k.tone} style={{ height: `${b[k.key] / total(b) * 100}%` }} /> : null)}</button>)}</div></div><div className="ane-volume-x"><span>{time(buckets[0]?.t ?? end, day)}</span><span>UTC</span><span>{time(buckets[buckets.length - 1]?.t ?? end, day)}</span></div><p className="ane-volume-note" aria-live="polite">{hovered ? `${time(hovered.t, true)} UTC · ${MIX.map(k => `${fmt(hovered[k.key])} ${k.label.toLowerCase()}`).join(" · ")}${hovered.complete ? "" : " · partial bucket"}` : "Hover a bar for its breakdown. Lighter bars are partial buckets."}</p></>;
}

function Proposers({ d }: { d: Dashboard }) {
  const m = d.metrics;
  const dist = m?.proposers ?? [];
  const total = dist.reduce((s, p) => s + p.blocks, 0);
  const max = Math.max(1, ...dist.map(p => p.blocks));
  const label = rangeLabel(m?.hours ?? 24);
  return <><PanelHeading title="Proposer distribution" description={`Blocks proposed per validator · ${label}. Voting power is equal (60 each), so rotation should be near even.`} icon="people" right={<span className="ane-range-label">{label}</span>} /><div className="ane-proposer-list" tabIndex={0} aria-label="Proposer rankings">{dist.map((p, i) => { const name = p.moniker ?? middle(p.proposer, 8, 4); return <div className="ane-proposer-row" key={p.proposer} title={`${name} · ${p.proposer} · ${fmt(p.blocks)} blocks`}><span className="ane-rank">{i + 1}</span><a className="ane-proposer-name" href={`#/validators/${p.proposer}`}><Identicon address={p.proposer} size={16} /><span>{name}</span></a><i><b style={{ width: `${p.blocks / max * 100}%` }} /></i><strong>{total ? pct(p.blocks / total * 100) : "—"}</strong></div>; })}{!dist.length && <Empty loading={!m && !d.metricsError} />}</div><p className="ane-footnote">{total ? `${fmt(total)} blocks in the window across ${dist.length} proposers.` : "Proposer of every block in the window."} gno.land has no staking: the set is changed by GovDAO proposals.</p></>;
}

function BlockTimes({ d }: { d: Dashboard }) {
  const bt = d.metrics?.block_time;
  const rows: [string, number | null | undefined, string][] = [["p50", bt?.p50, "median"], ["p90", bt?.p90, "9 in 10 gaps are shorter"], ["p99", bt?.p99, "1 in 100 gaps is longer"], ["avg", bt?.avg, "mean"], ["max", bt?.max, "slowest single gap"]];
  const scale = Math.max(1, ...rows.map(r => r[1] ?? 0));
  const label = rangeLabel(d.metrics?.hours ?? 24);
  return <><PanelHeading title="Block time percentiles" description={`Seconds between consecutive block timestamps · ${label}.`} icon="clock" right={<span className="ane-range-label">{label}</span>} /><div className="ane-barlist">{rows.map(([name, v, note]) => <div key={name} className={`ane-barrow pctl ${name === "max" ? "fail" : ""}`}><span title={note}>{name} <small>{note}</small></span><i><b style={{ width: `${v == null ? 0 : v / scale * 100}%` }} /></i><strong>{secs(v)}</strong></div>)}{!bt && <Empty loading={!d.metricsError} />}</div><p className="ane-footnote">Blocks arrive about every 3.5 s; an occasional long gap usually means a consensus round needed more than one attempt.</p></>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2", bars: "M4 20V12h3v8H4Zm6 0V7h3v13h-3Zm6 0V3h3v17h-3Z", block: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9M7 6l9 5", people: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 1a3 3 0 0 1 0 6M3 20v-4a6 6 0 0 1 12 0v4H3Zm14-7a5 5 0 0 1 4 5v2h-3", alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3v1", pulse: "M3 12h4l3-8 4 16 3-8h4", notes: "M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h8", gauge: "M4 17a8 8 0 1 1 16 0M12 17l4-6M7 17h0m10 0h0", coins: "M5 7c0-5 14-5 14 0s-14 5-14 0Zm0 0v5c0 5 14 5 14 0V7M5 12v5c0 5 14 5 14 0v-5", code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" };
  return <svg className="ane-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.pulse} /></svg>;
}
