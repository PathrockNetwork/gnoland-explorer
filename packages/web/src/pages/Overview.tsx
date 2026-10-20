/** Overview: stat tiles, live block stream, recent blocks, supply, activity and realm panels for gno.land (gnoland-1). */
import { useEffect, useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getBlocks, getSeries, type Block, type Series, type Validator } from "../api";
import { Timestamp } from "../components/Timestamp";
import { OverviewLatestTransactions, OverviewRealms } from "../components/OverviewWatchlist";
import { activeSet, fullMinutes, minuteBlockTimes, ratio, recentChange, summary, uptimeOf } from "../overviewStats";
import { Pipeline, signaturesText } from "../components/Pipeline";
import { MetricGlyph, type MetricIcon } from "../components/OverviewGlyph";
import { BRAND, Bar, Identicon, Label, OK, Skeleton, TX, TX2, TX3, TimeSeriesChart, WARN, mono, panel, sans } from "../components/ui";
import { area, blockHref, clampPct, fmt, gnotCompact, pct, pts, short } from "../lib";

/** The 24 h activity series is 15-minute buckets; refreshing once a minute is plenty. */
const SERIES_REFRESH_MS = 60_000;
const BLOCKS_REFRESH_MS = 8_000;
/** Nominal gno.land block time (s); used only to scale the health meter. */
const TARGET_BLOCK_S = 3.5;

export function Overview({
  d,
  live,
}: {
  d: Dashboard;
  live: boolean;
  /** Kept for App's call signature; gno.land validators are routed by address. */
  selected?: number | null;
  onSelect?: (id: number) => void;
  copied?: string | null;
  onCopy?: (v: string) => void;
}) {
  const loading = d.state === "loading";
  const dash = d.state === "empty" || d.state === "dberror";
  const stopped = d.state === "stopped";
  const net = d.net;

  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => void getSeries(24).then((r) => !cancelled && setSeries(r)).catch(() => undefined);
    refresh();
    const timer = live ? window.setInterval(refresh, SERIES_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [live]);

  const minutes = useMemo(() => fullMinutes(net?.recent_minutes ?? []), [net]);
  const blocksSpark = useMemo(() => minutes.map((m) => m.blocks), [minutes]);
  const txSpark = useMemo(() => minutes.map((m) => m.txs), [minutes]);
  const btSpark = useMemo(() => minuteBlockTimes(net?.recent_minutes ?? []).filter((v): v is number => v !== null), [net]);

  return (
    <div className="overview-page gno-overview" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {loading ? (
        <div className="g5 tiles-sticky">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="overview-stat-tile" style={{ ...panel, padding: "15px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <Skeleton h={9} w="64%" />
              <Skeleton h={26} w="78%" r={6} />
              <Skeleton h={22} w="100%" r={5} />
            </div>
          ))}
        </div>
      ) : (
        <div className="g5 tiles-sticky">
          <HeightTile d={d} dash={dash} stopped={stopped} spark={blocksSpark} />
          <BlockTimeTile dash={dash} ms={net?.avg_block_time_ms ?? null} spark={btSpark} />
          <TxTile dash={dash} d={d} spark={txSpark} />
          <ValidatorsTile dash={dash} d={d} />
          <PackagesTile dash={dash} d={d} />
        </div>
      )}

      <Pipeline live={live} validators={net?.validators_active ?? null} />

      <div className="overview-main-grid">
        <div className="overview-column overview-primary">
          <RecentBlocks d={d} live={live} />
        </div>
        <div className="overview-column overview-secondary">
          <SupplyCard d={d} />
          <ValidatorSetCard d={d} />
        </div>
      </div>

      <div className="overview-analytics-row">
        <NetworkHealth d={d} dash={dash} />
        <ActivityChart series={series} d={d} dash={dash} />
      </div>

      <div className="overview-bottom-row">
        <OverviewLatestTransactions d={d} live={live} />
        <OverviewRealms d={d} live={live} />
      </div>
    </div>
  );
}

/* ── stat tiles ─────────────────────────────────────────────────────────── */

const tile: React.CSSProperties = { ...panel, padding: "15px 16px 14px", display: "flex", flexDirection: "column", gap: 9 };
const bigValue: React.CSSProperties = { font: `600 31px/1 ${mono}`, letterSpacing: "-.02em" };
const footText: React.CSSProperties = { font: `500 14px/1.3 ${sans}`, color: TX2, whiteSpace: "nowrap" };

function Spark({ values, stroke = BRAND, fillArea = true }: { values: number[]; stroke?: string; fillArea?: boolean }) {
  const max = Math.max(1e-9, ...values);
  const min = fillArea ? 0 : Math.min(...values);
  return (
    <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ flex: "none", overflow: "visible" }}>
      {fillArea && <path d={area(values, 76, 26, min, max)} fill="var(--brandSoft)" />}
      <polyline points={pts(values, 76, 26, min, max === min ? min + 1 : max)} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MetricHeading({ icon, label }: { icon: MetricIcon; label: string }) {
  return (
    <div className="metric-heading">
      <MetricGlyph icon={icon} />
      <Label>{label}</Label>
    </div>
  );
}

function HeightTile({ d, dash, stopped, spark }: { d: Dashboard; dash: boolean; stopped: boolean; spark: number[] }) {
  const net = d.net;
  const head = net?.indexed_head ?? null;
  const chain = net?.chain_height ?? null;
  // The RPC's reported height can trail the tx-indexer feed; show whichever is ahead.
  const height = head === null ? chain : chain === null ? head : Math.max(head, chain);
  const lag = net?.lag_blocks ?? null;
  return (
    <div className="overview-stat-tile overview-height-tile" style={tile}>
      <MetricHeading icon="block" label="Block Height" />
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash ? "—" : fmt(height)}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={footText} title={`Indexed head ${fmt(head)} · RPC height ${fmt(chain)}`}>
          {dash ? "no blocks" : stopped ? <>stalled <Timestamp value={net?.indexer_updated_at} /></> : lag ? <span style={{ color: lag > 100 ? WARN : TX2 }}>indexed {fmt(head)} · {fmt(lag)} behind</span> : `indexed ${fmt(head)}`}
        </span>
        {!dash && spark.length > 1 && <Spark values={spark} />}
      </div>
    </div>
  );
}

function BlockTimeTile({ dash, ms, spark }: { dash: boolean; ms: number | null; spark: number[] }) {
  const lo = spark.length ? Math.min(...spark) : null;
  const hi = spark.length ? Math.max(...spark) : null;
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="clock" label="Avg Block Time" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash || ms === null ? "—" : (ms / 1000).toFixed(2)}</span>
        <span style={{ font: `500 15px/1 ${sans}`, color: TX3 }}>{dash || ms === null ? "" : "s"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={footText} title="Mean interval over the newest 1,000 blocks; the sparkline is seconds per block for each of the last 30 full minutes">last 1,000 blocks</span>
        <div style={{ position: "relative", flex: "none" }}>
          <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ display: "block", overflow: "visible" }}>
            <line x1="0" y1="0.5" x2="76" y2="0.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            <line x1="0" y1="25.5" x2="76" y2="25.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            {!dash && spark.length > 1 && lo !== null && hi !== null && (
              <polyline points={pts(spark, 76, 26, lo - 0.2, hi + 0.2)} fill="none" stroke={OK} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            )}
          </svg>
          {!dash && hi !== null && lo !== null && (
            <>
              <span style={{ position: "absolute", right: -2, top: -11, font: `400 12px/1 ${mono}`, color: TX3 }}>{hi.toFixed(1)}</span>
              <span style={{ position: "absolute", right: -2, bottom: -11, font: `400 12px/1 ${mono}`, color: TX3 }}>{lo.toFixed(1)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TxTile({ dash, d, spark }: { dash: boolean; d: Dashboard; spark: number[] }) {
  const net = d.net;
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="transactions" label="Transactions · 24h" />
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash || !net ? "—" : fmt(net.txs_24h)}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={footText} title={`Chain-wide total ${fmt(net?.total_txs ?? null)} (excluding the 96 genesis transactions) · ${fmt(net?.active_accounts_24h ?? null)} distinct signers in 24 h`}>
          {dash || !net ? "—" : <>{fmt(net.total_txs)} total · {fmt(net.active_accounts_24h)} accounts</>}
        </span>
        {!dash && spark.length > 1 && <Spark values={spark} />}
      </div>
    </div>
  );
}

function ValidatorsTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const net = d.net;
  const set = activeSet(d.validators?.validators ?? []);
  const rate = net?.signing_rate ?? null;
  const dots = set.length
    ? set.map((v) => {
        const u = uptimeOf(v);
        return { v, color: dash ? "var(--line)" : u === null ? "var(--line2)" : u < 0.95 ? WARN : "color-mix(in srgb, var(--ok) 70%, transparent)", u };
      })
    : Array.from({ length: net?.validators_active || 6 }, () => ({ v: null as Validator | null, color: "var(--line)", u: null as number | null }));
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="validators" label="Active Validators" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash || !net ? "—" : fmt(net.validators_active)}</span>
        <span style={{ font: `500 15px/1 ${sans}`, color: TX3 }} title={`${fmt(net?.valoper_profiles ?? null)} operator profiles in r/gnops/valopers`}>
          {dash || !net ? "" : `of ${fmt(net.valoper_profiles)} profiles`}
        </span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {dots.map((x, i) => (
          <a
            key={x.v?.address ?? i}
            href={x.v ? `#/validators/${x.v.address}` : undefined}
            title={x.v ? `${x.v.moniker ?? x.v.address} · uptime ${x.u === null ? "—" : pct(x.u * 100, 2)}` : undefined}
            style={{ flex: 1, height: 14, borderRadius: 2, background: x.color }}
          />
        ))}
      </div>
      <span style={{ ...footText, color: rate === null ? TX3 : rate < 0.95 ? WARN : TX2 }} title="Share of expected precommits present over the newest 1,000 blocks whose signatures have been read">
        {dash || rate === null ? "signing rate —" : `${pct(rate * 100, 2)} signing rate`}
      </span>
    </div>
  );
}

function PackagesTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const p = d.net?.packages ?? null;
  const realmShare = p && p.total ? p.realms / p.total : 0;
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="package" label="Packages Deployed" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...bigValue, color: dash || !p ? TX3 : TX }}>{dash || !p ? "—" : fmt(p.total)}</span>
        {!dash && p && p.deployed_24h > 0 && <span style={{ font: `500 14px/1 ${mono}`, color: OK }} title="Deployed in the last 24 h">+{fmt(p.deployed_24h)}</span>}
      </div>
      <div style={{ display: "flex", height: 8, borderRadius: 3, overflow: "hidden", background: "var(--line)" }} role="img" aria-label={p ? `${p.realms} realms, ${p.pure} pure packages` : "Packages unknown"}>
        {p && !dash && (
          <>
            <i style={{ width: `${realmShare * 100}%`, background: BRAND }} />
            <i style={{ flex: 1, background: "var(--brand2)", opacity: 0.45 }} />
          </>
        )}
      </div>
      <span style={footText}>{dash || !p ? "—" : <>{fmt(p.realms)} realms · {fmt(p.pure)} pure</>}</span>
    </div>
  );
}

/* ── recent blocks ──────────────────────────────────────────────────────── */

function RecentBlocks({ d, live }: { d: Dashboard; live: boolean }) {
  const [withTxs, setWithTxs] = useState(true);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setBlocks(null);
    const load = () =>
      getBlocks(10, { withTxs })
        .then((r) => {
          if (cancelled) return;
          setBlocks(r.blocks);
          setError(false);
        })
        .catch(() => !cancelled && setError(true));
    void load();
    const id = live
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, BLOCKS_REFRESH_MS)
      : undefined;
    return () => {
      cancelled = true;
      if (id !== undefined) clearInterval(id);
    };
  }, [live, withTxs]);
  return (
    <section className="overview-recent-blocks" style={panel}>
      <header className="overview-panel-heading">
        <h2><MetricGlyph icon="block" />Recent Blocks</h2>
        <div className="overview-segment" role="group" aria-label="Block filter">
          <button type="button" aria-pressed={withTxs} onClick={() => setWithTxs(true)}>With transactions</button>
          <button type="button" aria-pressed={!withTxs} onClick={() => setWithTxs(false)}>All</button>
        </div>
        <a href="#/blocks">View all <span aria-hidden="true">→</span></a>
      </header>
      <div className="orb-scroll" role="region" aria-label="Recent blocks" tabIndex={0}>
        <table className="orb-table">
          <thead>
            <tr>
              <th>Height</th>
              <th>Age</th>
              <th>Proposer</th>
              <th className="num">Txs</th>
              <th className="num" title="Validators that precommitted the block / validators in the set">Signatures</th>
            </tr>
          </thead>
          <tbody>
            {blocks === null && !error
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={5}><Skeleton h={18} w="100%" /></td>
                  </tr>
                ))
              : error && !blocks
                ? <tr><td colSpan={5} className="orb-empty">{d.state === "dberror" ? "No data available." : "Recent blocks are unavailable."}</td></tr>
                : blocks?.length === 0
                  ? <tr><td colSpan={5} className="orb-empty">No blocks indexed yet.</td></tr>
                  : blocks?.map((b) => (
                      <tr key={b.height} onClick={() => (window.location.hash = blockHref(b.height).slice(1))}>
                        <td><a href={blockHref(b.height)} className="orb-height">{fmt(b.height)}</a></td>
                        <td className="orb-age"><Timestamp value={b.time} /></td>
                        <td>
                          <a className="orb-proposer" href={`#/validators/${b.proposer}`} onClick={(e) => e.stopPropagation()} title={b.proposer}>
                            <Identicon address={b.proposer} size={18} />
                            <span>{b.proposer_moniker ?? short(b.proposer)}</span>
                          </a>
                        </td>
                        <td className="num" style={{ color: b.tx_count ? TX : TX3 }}>{fmt(b.tx_count)}</td>
                        <td className="num">
                          <span className={`orb-sigs ${b.signed === null ? "unknown" : (b.missed ?? 0) > 0 ? "warn" : "ok"}`} title={b.signed === null ? "Signatures for this block are not read yet (they arrive with the next block, and are read for recent blocks only)" : `${b.missed ?? 0} missed`}>
                            {signaturesText(b)}
                          </span>
                        </td>
                      </tr>
                    ))}
          </tbody>
        </table>
      </div>
      <footer className="orb-foot">
        {withTxs ? "Most blocks are empty — showing only blocks that carry transactions." : "Every committed block, newest first."}
        {d.net?.signature_floor != null && <> Signatures read down to #{fmt(d.net.signature_floor)}.</>}
      </footer>
    </section>
  );
}

/* ── supply & validator set ─────────────────────────────────────────────── */

function SupplyCard({ d }: { d: Dashboard }) {
  const s = d.net?.supply ?? null;
  const lockedShare = s ? ratio(s.locked, s.total) : null;
  const spendShare = s ? ratio(s.spendable, s.total) : null;
  const loading = d.state === "loading";
  return (
    <section className="overview-supply-card" style={panel}>
      <header className="overview-panel-heading">
        <h2><MetricGlyph icon="supply" />GNOT Supply</h2>
        {s && <span className="overview-panel-note">at #{fmt(s.height)}</span>}
      </header>
      {loading ? (
        <div style={{ padding: 14 }}><Skeleton h={90} w="100%" /></div>
      ) : !s ? (
        <p className="overview-muted" style={{ padding: 14 }}>Supply is unavailable (read from the tx-indexer).</p>
      ) : (
        <div className="overview-supply-body">
          <div className="overview-supply-total">
            <strong title={`${s.total} ugnot`}>{gnotCompact(s.total)}</strong>
            <span>total supply</span>
          </div>
          <div className="overview-supply-bar" role="img" aria-label={`Locked in vesting ${pct((lockedShare ?? 0) * 100)}, spendable ${pct((spendShare ?? 0) * 100)}`}>
            <i style={{ width: `${(lockedShare ?? 0) * 100}%` }} className="locked" />
            <i style={{ width: `${(spendShare ?? 0) * 100}%` }} className="spendable" />
          </div>
          <dl className="overview-supply-split">
            <div>
              <dt><i className="locked" />Locked in vesting</dt>
              <dd title={`${s.locked} ugnot`}>{gnotCompact(s.locked)}<small>{lockedShare === null ? "—" : pct(lockedShare * 100)}</small></dd>
            </div>
            <div>
              <dt><i className="spendable" />Spendable</dt>
              <dd title={`${s.spendable} ugnot`}>{gnotCompact(s.spendable)}<small>{spendShare === null ? "—" : pct(spendShare * 100)}</small></dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function ValidatorSetCard({ d }: { d: Dashboard }) {
  const vl = d.validators;
  const set = activeSet(vl?.validators ?? []);
  const win = vl?.windows?.[1] ?? vl?.windows?.[0] ?? null;
  const maxRecent = Math.max(1, ...set.map((v) => v.proposed_recent));
  return (
    <section className="overview-valset-card" style={panel}>
      <header className="overview-panel-heading">
        <h2><MetricGlyph icon="validators" />Validator Set</h2>
        <a href="#/validators">View all <span aria-hidden="true">→</span></a>
      </header>
      {!vl ? (
        d.state === "dberror" ? <p className="overview-muted" style={{ padding: 14 }}>Validator data is unavailable.</p> : <div style={{ padding: 14 }}><Skeleton h={120} w="100%" /></div>
      ) : set.length === 0 ? (
        <p className="overview-muted" style={{ padding: 14 }}>Waiting for the first validator-set sync.</p>
      ) : (
        <>
          <div className="ovs-row ovs-head">
            <span>Validator</span>
            <span title="Blocks proposed among the newest 1,000">Proposed 1k</span>
            <span title={win ? `Precommits present over the newest ${fmt(win)} read blocks` : "Precommit uptime"}>Uptime</span>
          </div>
          {set.map((v) => {
            const u = uptimeOf(v);
            return (
              <a key={v.address} className="ovs-row" href={`#/validators/${v.address}`} title={`${v.moniker ?? v.address}\nsigning ${v.address}\nvoting power ${v.voting_power}`}>
                <span className="ovs-name"><Identicon address={v.address} size={20} /><strong>{v.moniker ?? short(v.address)}</strong></span>
                <span className="ovs-meter"><span>{fmt(v.proposed_recent)}</span><Bar width={clampPct(v.proposed_recent, 0, maxRecent)} color={BRAND} /></span>
                <span className="ovs-uptime" style={{ color: u === null ? TX3 : u < 0.95 ? WARN : OK }}>{u === null ? "—" : pct(u * 100, u === 1 ? 0 : 2)}</span>
              </a>
            );
          })}
          <footer className="ovs-foot">Equal voting power ({fmt(set[0]?.voting_power ?? null)} each, {fmt(vl.total_power)} total) · no staking — the set changes by GovDAO proposal.</footer>
        </>
      )}
    </section>
  );
}

/* ── analytics row ──────────────────────────────────────────────────────── */

function NetworkHealth({ d, dash }: { d: Dashboard; dash: boolean }) {
  const net = d.net;
  const ms = net?.avg_block_time_ms ?? null;
  const s = ms === null ? null : ms / 1000;
  const blocks24 = net?.blocks_24h ?? null;
  const expected24 = s ? Math.round(86_400 / s) : null;
  const rate = net?.signing_rate ?? null;
  const verdict = verdictFor(d);
  const pending = dash || d.state === "loading";

  const meters = [
    {
      icon: "clock" as MetricIcon,
      label: "Average block time",
      value: s === null || pending ? "—" : `${s.toFixed(2)} s`,
      w: s === null || pending ? "0%" : clampPct(s, 0, Math.max(TARGET_BLOCK_S * 2, s)),
      c: s === null || pending ? TX3 : s > TARGET_BLOCK_S * 1.5 ? WARN : OK,
      scale: "Newest 1,000 blocks · flagged above 5 s",
      range: ["0 s", `${Math.max(TARGET_BLOCK_S * 2, Math.ceil(s ?? 0))} s`],
    },
    {
      icon: "block" as MetricIcon,
      label: "Blocks · 24h",
      value: pending ? "—" : fmt(blocks24),
      w: pending || blocks24 === null || !expected24 ? "0%" : clampPct(blocks24, 0, Math.max(expected24, blocks24)),
      c: pending || !expected24 || blocks24 === null ? TX3 : blocks24 < expected24 * 0.9 ? WARN : OK,
      scale: expected24 ? `≈ ${fmt(expected24)} expected at the measured pace` : "Expected count unavailable",
      range: ["0", expected24 ? `${fmt(expected24)} expected` : "—"],
    },
    {
      icon: "validators" as MetricIcon,
      label: "Signing rate",
      value: pending || rate === null ? "—" : pct(rate * 100, 2),
      w: pending || rate === null ? "0%" : clampPct(rate * 100, 0, 100),
      c: pending || rate === null ? TX3 : rate < 0.95 ? WARN : OK,
      scale: "Precommits present / expected over the newest 1,000 read blocks",
      range: ["0%", "100%"],
    },
  ];

  return (
    <section className="overview-health-card" style={panel}>
      <header className="overview-health-heading">
        <div className="analytics-heading"><MetricGlyph icon="health" /><h3>Network Health</h3></div>
        <span className="overview-health-verdict" style={{ color: verdict.color }}><i />{verdict.text}</span>
      </header>
      <p className="overview-health-description">{description(d, s)}</p>
      <div className="overview-health-meters">
        {meters.map((m) => (
          <div className="overview-health-metric" key={m.label} title={m.scale}>
            <MetricGlyph icon={m.icon} />
            <div className="overview-health-metric-body">
              <div className="overview-health-metric-row"><span>{m.label}</span><strong style={{ color: m.c }}>{m.value}</strong></div>
              <p>{m.scale}</p>
              <Bar width={m.w} color={m.c === TX3 ? "var(--line)" : m.c} h={5} />
              <div className="overview-health-range"><span>{m.range[0]}</span><span>{m.range[1]}</span></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function description(d: Dashboard, s: number | null): string {
  switch (d.state) {
    case "loading": return "Checking recent network activity…";
    case "dberror": return "Network health is temporarily unavailable.";
    case "stopped": return "Indexer stopped. Showing last known activity.";
    case "empty": return "Waiting for the first indexed blocks.";
    case "backfill": return "The indexer is catching up to the chain head.";
    default: return s !== null && s > TARGET_BLOCK_S * 1.5 ? "Block production is slower than usual." : "gno.land is committing blocks normally.";
  }
}

/** Explorer/indexer health plus block cadence. */
export function verdictFor(d: Dashboard): { text: string; color: string } {
  if (d.state === "dberror") return { text: "Unknown — no data", color: "var(--bad)" };
  if (d.state === "stopped") return { text: "Stale — indexer stopped", color: WARN };
  if (d.state === "empty") return { text: "Bootstrapping", color: TX3 };
  if (d.state === "loading") return { text: "Loading", color: TX3 };
  if (d.state === "backfill") return { text: "Catching up", color: WARN };
  const ms = d.net?.avg_block_time_ms ?? null;
  if (ms !== null && ms > TARGET_BLOCK_S * 1500) return { text: "Slow blocks", color: WARN };
  const rate = d.net?.signing_rate ?? null;
  if (rate !== null && rate < 0.9) return { text: "Missed signatures", color: WARN };
  return { text: "Healthy", color: OK };
}

function ActivityChart({ series, d, dash }: { series: Series | null; d: Dashboard; dash: boolean }) {
  const points = series?.points ?? [];
  const txs = points.map((p) => p.txs);
  const stats = summary(txs);
  const change = dash ? null : recentChange(points);
  const bucketMin = series ? Math.round(series.bucket_secs / 60) : 15;
  const max = Math.max(4, Math.ceil(((stats.max ?? 0) * 1.15) / 4) * 4);
  const totals = points.reduce(
    (a, p) => ({ calls: a.calls + p.calls, sends: a.sends + p.sends, deploys: a.deploys + p.deploys, runs: a.runs + p.runs, failed: a.failed + p.failed }),
    { calls: 0, sends: 0, deploys: 0, runs: 0, failed: 0 },
  );
  const empty = dash || points.length < 2;
  return (
    <section className="overview-mini-chart overview-activity-chart" style={panel}>
      <header className="overview-chart-heading">
        <div className="analytics-heading"><MetricGlyph icon="transactions" /><h3>Transaction Activity</h3></div>
        <span>Last 24 hours · {bucketMin}-minute buckets</span>
      </header>
      <div className="overview-chart-summary">
        <div className="overview-chart-reading">
          <strong style={{ color: empty ? TX3 : TX }}>{empty ? "—" : fmt(stats.sum)}<span> tx</span></strong>
          <span>{fmt(d.net?.active_accounts_24h ?? null)} active accounts · {fmt(totals.failed)} failed</span>
        </div>
        <div className="overview-chart-comparison" title="Transactions in the last 3 hours vs. the 3 hours before">
          <strong className={change === null ? "unknown" : change >= 0 ? "faster" : "slower"}>{change === null ? "—" : `${change > 0 ? "↑ +" : change < 0 ? "↓ −" : ""}${Math.abs(change).toFixed(0)}%`}</strong>
          <span>last 3 h vs. prior 3 h</span>
        </div>
      </div>
      <div className="overview-chart-body">
        <div className="overview-chart-graph">
          <div className="overview-chart-area">
            <div className="overview-chart-y-axis" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i}>{Math.round(max - (max * i) / 3)}</span>)}</div>
            <div className="overview-mini-chart-plot">
              {!empty ? (
                <TimeSeriesChart
                  values={txs}
                  times={points.map((p) => p.t)}
                  min={0}
                  max={max}
                  stroke={BRAND}
                  fillColor="var(--brandSoft)"
                  height="fill"
                  compact
                  formatValue={(v) => `${fmt(v)} tx`}
                  formatTime={(t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                />
              ) : (
                <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                  {[2, 6, 10, 14, 18].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                </svg>
              )}
            </div>
          </div>
          <div className="overview-chart-x-axis"><span>24 h ago</span><span>18 h</span><span>12 h</span><span>6 h</span><span>Now</span></div>
        </div>
        <dl className="overview-chart-stats" aria-label="Transactions by message kind, last 24 hours">
          <div><dt>Calls</dt><dd>{empty ? "—" : fmt(totals.calls)}</dd></div>
          <div><dt>Sends</dt><dd>{empty ? "—" : fmt(totals.sends)}</dd></div>
          <div><dt>Deploys</dt><dd>{empty ? "—" : fmt(totals.deploys)}</dd></div>
          <div><dt>Runs</dt><dd>{empty ? "—" : fmt(totals.runs)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
