/**
 * gno.land validators: the 6-member set (fixed voting power, no staking) with
 * signing uptime and proposals, then the valopers candidates. Inspector by
 * hash route `#/validators/<signing address>`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { preferredScrollBehavior } from "../appearance";
import { Timestamp } from "../components/Timestamp";
import type { Dashboard } from "../useDashboard";
import { getGovDao, getValidatorSets, type GovDao, type Validator, type ValidatorList, type ValidatorSets } from "../api";
import { Identicon, Skeleton } from "../components/ui";
import { OperatorLink, ValidatorDrop, ValidatorStatus, dataWindowNote } from "../components/ValidatorDrop";
import { blockHref, copyText, downloadCsv, fmt, isAddr, pct, short, toCsv } from "../lib";
import {
  descriptionPreview, matchesQuery, matchesValidatorFilter, serverLabel, sortValidators, uptimeText, uptimeTone, validatorName, validatorState, windowInfo,
  type ValidatorFilter, type ValidatorSort,
} from "../validatorDirectory";
import { validatorSummary } from "../validatorSummary";
import "./validators.css";

const FILTERS: { id: ValidatorFilter; label: string; title?: string }[] = [
  { id: "all", label: "All" },
  { id: "set", label: "In set", title: "In the current validator set" },
  { id: "degraded", label: "Degraded", title: "In the set, but missed a precommit in the shortest window or on a missed streak now" },
  { id: "candidates", label: "Candidates", title: "Valopers profiles not in the validator set" },
];

/** `#/validators/<address>` → address; `#/validators` → null; any other page → undefined. */
function addressFromHash(): string | null | undefined {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "validators") return undefined;
  return parts[1] && isAddr(parts[1]) ? parts[1] : null;
}

// `selected` / `onSelect` are the shared numeric selection from App; gno.land validators route by address instead.
export function Validators({ d }: { d: Dashboard; selected?: number | null; onSelect?: (id: number | null) => void }) {
  const [filter, setFilter] = useState<ValidatorFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ValidatorSort>("power");
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState<string | null>(() => addressFromHash() ?? null);
  const [copied, setCopied] = useState<string | null>(null);

  const list = d.validators;
  const validators = useMemo(() => list?.validators ?? [], [list]);
  const matching = useMemo(() => sortValidators(validators.filter((v) => matchesQuery(v, query) && matchesValidatorFilter(v, filter)), sort, descending), [validators, query, filter, sort, descending]);
  const setRows = matching.filter((v) => v.in_set);
  const candidates = matching.filter((v) => !v.in_set);
  const loading = !list && d.state !== "dberror";
  const failed = !list && d.state === "dberror";
  const unavailable = !list || validators.length === 0;
  const summary = validatorSummary(validators);

  useEffect(() => {
    const sync = () => {
      const a = addressFromHash();
      if (a !== undefined) setSelected(a);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const select = useCallback((address: string) => {
    setSelected(address);
    window.location.hash = `/validators/${address}`;
    requestAnimationFrame(() => document.querySelector(".vinspector")?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" }));
  }, []);
  const close = useCallback(() => {
    setSelected(null);
    window.location.hash = "/validators";
  }, []);

  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 1800); return () => clearTimeout(timer); }, [copied]);
  const onCopy = (value: string) => { void copyText(value); setCopied(value); };

  const exportCsv = () => downloadCsv("gnoland-validators.csv", toCsv([
    ["moniker", "signing_address", "operator", "operator_name", "server_type", "status", "in_set", "voting_power", "power_share",
      ...[0, 1, 2].flatMap((i) => [`uptime_${list?.windows[i] ?? i}`, `missed_${list?.windows[i] ?? i}`]),
      "missed_streak", "last_missed_height", "blocks_proposed", "proposed_share", "proposed_newest_1000", "last_proposed_height", "last_proposed_time", "first_seen_height"],
    ...sortValidators(validators, "power", true).map((v) => [v.moniker, v.address, v.operator, v.operator_name, v.server_type, validatorState(v), v.in_set ? "yes" : "no", v.voting_power, v.power_share,
      ...[0, 1, 2].flatMap((i) => [v.uptime[i] ?? null, v.missed[i] ?? null]),
      v.missed_streak, v.last_missed_height, v.blocks_proposed, v.proposed_share, v.proposed_recent, v.last_proposed_height, v.last_proposed_time, v.first_seen_height]),
  ]));

  const w0 = windowInfo(list, 0);
  const signing = d.net?.signing_rate ?? summary.avgUptime;
  const stats = [
    { label: "Validator set", value: `${fmt(summary.inSet)}`, note: `${fmt(summary.counts.active)} signing · ${fmt(summary.counts.degraded)} degraded`, tone: summary.counts.degraded ? "warn" : "ok" },
    { label: "Voting power", value: fmt(list?.total_power), note: summary.inSet ? `Fixed by GovDAO · no staking` : "—", tone: "brand" },
    { label: "Signing rate", value: signing == null ? "—" : uptimeText(signing), note: d.net?.signing_rate != null ? "Newest 1,000 read blocks" : `Average over ${fmt(w0.size)} blocks`, tone: uptimeTone(signing) || "blue" },
    { label: "Nakamoto coefficient", value: fmt(summary.nakamoto), note: "Validators holding > ⅓ of power", tone: "warn" },
    { label: "Blocks since genesis", value: fmt(list?.blocks_indexed), note: list?.since ? `Proposers counted since ${new Date(list.since).toISOString().slice(0, 10)}` : "Proposers counted from genesis", tone: "blue" },
    { label: "Candidates", value: fmt(summary.counts.candidate), note: `Of ${fmt(summary.total)} valopers profiles`, tone: "brand" },
  ];
  const partialSignatures = list != null && list.windows.some((w, i) => windowInfo(list, i).partial && w > 0);

  return <div className="vpage">
    <div className="vstats">{stats.map((s, i) => <section className="vstat" key={s.label}>
      <span className={`vstat-icon ${s.tone}`} aria-hidden="true"><StatGlyph index={i} /></span><div><span className="v-eyebrow">{s.label}</span>{loading ? <Skeleton h={22} w="70%" /> : <strong className={s.tone}>{unavailable ? "—" : s.value}</strong>}<small>{s.note}</small></div>
    </section>)}</div>
    {list && <p className={`vwindow-note ${partialSignatures ? "partial" : ""}`}>{partialSignatures && <strong>Signature backfill in progress. </strong>}{dataWindowNote(list)}</p>}
    <div className="vtoolbar">
      <label className="vsearch"><span aria-hidden="true">⌕</span><input aria-label="Filter validators" placeholder="Filter by moniker, signing or operator address, @username…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="vfilters" aria-label="Validator filters">{FILTERS.map((f) => <button type="button" key={f.id} title={f.title} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <small>({validators.filter((v) => matchesValidatorFilter(v, f.id)).length})</small></button>)}</div>
      <div className="vsort"><label>Sort by <select aria-label="Sort validators" value={sort} onChange={(e) => setSort(e.target.value as ValidatorSort)}><option value="power">Voting power</option><option value="uptime">Uptime</option><option value="proposed">Proposed (all-time)</option><option value="recent">Proposed (newest 1k)</option><option value="last">Last proposed</option><option value="name">Name</option></select></label><button type="button" onClick={() => setDescending((v) => !v)} aria-label="Reverse sort direction">{descending ? "↓ Desc" : "↑ Asc"}</button>
        <button type="button" onClick={exportCsv} disabled={unavailable}>↓ Export CSV</button>
      </div>
    </div>
    <div className={selected === null ? "vworkspace vworkspace-solo" : "vworkspace"}>
      <div className="vdirectory">
        {filter !== "candidates" && <SetTable rows={setRows} list={list} selected={selected} onSelect={select} empty={unavailable ? (loading ? "Loading validators…" : failed ? "Validator data is temporarily unavailable." : "No validators synced yet.") : setRows.length === 0 ? "No set members match this filter." : null} />}
        {filter !== "set" && filter !== "degraded" && <Candidates rows={candidates} selected={selected} onSelect={select} loading={loading} />}
        {!unavailable && <Analytics validators={validators} list={list} onSelect={select} />}
      </div>
      {selected !== null && <ValidatorDrop key={selected} address={selected} row={validators.find((v) => v.address === selected)} list={list} refreshKey={list} copied={copied} onCopy={onCopy} onClose={close} />}
    </div>
    <div className="vfootnote"><span>* Partial window · fewer blocks of signatures read than the window size</span><span>GNO.LAND EXPLORER · VALIDATORS · {d.net?.chain_id ?? "gnoland-1"}</span><span>Profiles from r/gnops/valopers.</span></div>
  </div>;
}

function UptimeCell({ value, missed, partial, size }: { value: number | null; missed: number | null; partial: boolean; size: number | null }) {
  if (value == null) return <span className="vunknown">—</span>;
  return <span className={`vuptime ${uptimeTone(value)}`} title={`${fmt(missed)} missed of ${fmt(size)} blocks${partial ? " · partial window" : ""}`}>
    <strong>{uptimeText(value)}{partial && <sup className="vpartial">*</sup>}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></i>
  </span>;
}

function SetTable({ rows, list, selected, onSelect, empty }: { rows: Validator[]; list: ValidatorList | null; selected: string | null; onSelect: (a: string) => void; empty: string | null }) {
  const windows = [0, 1, 2].map((i) => windowInfo(list, i));
  const cols = 11;
  return <section className="vtable-panel">
    <header className="vpanel-head"><h2>Validator set</h2><span>{rows.length ? `${rows.length} member${rows.length === 1 ? "" : "s"} · equal voting power, changed only by GovDAO` : ""}</span></header>
    <div className="vtable-scroll"><table className="vtable"><thead><tr>
      <th>#</th><th>Validator</th><th>Voting power</th>
      {windows.map((w, i) => <th key={i} title={w.partial ? `Only ${fmt(w.size)} blocks read so far` : `Newest ${fmt(w.size)} read blocks`}>Uptime {w.label}{w.partial && <span className="vhint">*</span>}</th>)}
      <th title="Consecutive missed precommits, counting back from the newest read block">Streak</th><th title="Share of all blocks since genesis">Proposed</th><th title="Proposals among the newest 1,000 blocks">Newest 1k</th><th>Last proposed</th><th>Status</th>
    </tr></thead><tbody>
      {empty ? <tr><td colSpan={cols} className="vempty">{empty}</td></tr> : rows.map((v, idx) => <tr key={v.address} className={`${selected === v.address ? "selected" : ""} ${validatorState(v) === "degraded" ? "at-risk" : ""}`} onClick={() => onSelect(v.address)}>
        <td className="vmuted">{idx + 1}</td>
        <td><button className="videntity" onClick={(e) => { e.stopPropagation(); onSelect(v.address); }} aria-pressed={selected === v.address}><Identicon address={v.address} size={26} /><span><strong title={validatorName(v)}>{validatorName(v)}</strong><small title={v.operator ?? v.address}>{v.operator_name ? `@${v.operator_name}` : short(v.address)} · {serverLabel(v.server_type)}</small></span></button></td>
        <td><span className="vmetric"><strong>{fmt(v.voting_power)}</strong><small>{v.power_share != null ? pct(v.power_share * 100, 2) : "—"}</small></span></td>
        {windows.map((w, i) => <td key={i}><UptimeCell value={v.uptime[i]} missed={v.missed[i]} partial={w.partial} size={w.size} /></td>)}
        <td><span className={(v.missed_streak ?? 0) > 0 ? "bad" : "vmuted-inline"}>{fmt(v.missed_streak)}</span></td>
        <td><span className="vmetric"><strong>{fmt(v.blocks_proposed)}</strong><small>{v.proposed_share != null ? pct(v.proposed_share * 100, 2) : "—"}</small></span></td>
        <td>{fmt(v.proposed_recent)}</td>
        <td>{v.last_proposed_height != null ? <span className="vmetric"><strong><a href={blockHref(v.last_proposed_height)} onClick={(e) => e.stopPropagation()}>#{fmt(v.last_proposed_height)}</a></strong><small><Timestamp value={v.last_proposed_time} /></small></span> : <span className="vunknown">—</span>}</td>
        <td><ValidatorStatus v={v} /></td>
      </tr>)}
    </tbody></table></div>
  </section>;
}

const CANDIDATE_PREVIEW = 15;

function Candidates({ rows, selected, onSelect, loading }: { rows: Validator[]; selected: string | null; onSelect: (a: string) => void; loading: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, CANDIDATE_PREVIEW);
  return <section className="vtable-panel">
    <header className="vpanel-head"><h2>Candidates</h2><span>Valopers profiles not in the set · {fmt(rows.length)}</span></header>
    {loading ? <div style={{ padding: 14 }}><Skeleton h={120} w="100%" /></div> : rows.length === 0 ? <p className="vempty">No candidates match this filter.</p> :
      <><div className="vcandidates">{shown.map((v) => <button type="button" key={v.address} className={`vcandidate ${selected === v.address ? "selected" : ""}`} aria-pressed={selected === v.address} onClick={() => onSelect(v.address)}>
        <header><Identicon address={v.address} size={22} /><strong title={validatorName(v)}>{validatorName(v)}</strong><span className="vcandidate-type">{serverLabel(v.server_type)}</span></header>
        <p>{descriptionPreview(v.description, 140) || <span className="vunknown">No description.</span>}</p>
        <footer><span>Operator <OperatorLink v={v} /></span><span title={v.address}>{short(v.address)}</span></footer>
      </button>)}</div>
      {rows.length > CANDIDATE_PREVIEW && <button type="button" className="vshow-all" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${rows.length} candidates`}</button>}</>}
  </section>;
}

function Analytics({ validators, list, onSelect }: { validators: Validator[]; list: ValidatorList | null; onSelect: (a: string) => void }) {
  const s = validatorSummary(validators);
  const topN = Math.max(1, ...s.proposers.map((v) => v.proposed_recent));
  const totalRecent = s.proposers.reduce((a, v) => a + v.proposed_recent, 0);
  const colors: Record<string, string> = { cloud: "var(--brand)", "on-prem": "var(--ok)", "data-center": "var(--warn)", unknown: "var(--tx3)" };
  return <div className="vanalytics">
    <section className="vanalytic"><h3>Proposers <small>newest 1,000 blocks</small></h3><div className="vtop-head"><span>#　 Validator</span><span>Blocks</span></div>
      {s.proposers.map((v, i) => <button className="vtop-row" key={v.address} onClick={() => onSelect(v.address)} title={`${fmt(v.proposed_recent)} of ${fmt(totalRecent)} · all-time ${fmt(v.blocks_proposed)}`}><span>{i + 1}</span><Identicon address={v.address} size={18} /><strong>{validatorName(v)}</strong><i><b style={{ width: `${(v.proposed_recent / topN) * 100}%` }} /></i><small>{fmt(v.proposed_recent)}</small></button>)}
      {s.proposers.length === 0 && <p className="vmuted">No proposer history yet.</p>}
      <p className="vevents-note vafter">Round-robin weighted by voting power: equal power → equal share ({s.inSet ? `≈${fmt(Math.round(1000 / s.inSet))}` : "—"} each).</p>
    </section>
    <section className="vanalytic"><h3>Server type <small>declared in valopers</small></h3>
      <div className="vserver-rows">{s.servers.map(([k, c]) => <div key={k} className="vserver-row"><span><i style={{ background: colors[k] ?? "var(--tx3)" }} />{k === "unknown" ? "Not declared" : serverLabel(k)}</span><div className="vserver-bar"><b style={{ width: `${(c.all / Math.max(1, s.total)) * 100}%`, background: colors[k] ?? "var(--tx3)" }} /></div><strong>{fmt(c.all)}</strong><small>{c.set ? `${c.set} in set` : "—"}</small></div>)}</div>
      <p className="vevents-note vafter">All {fmt(s.total)} profiles; the column on the right counts current set members.</p>
    </section>
    <SetHistory validators={validators} list={list} />
  </div>;
}

/** Validator-set changes from block validators_hash, paired with the accepted r/sys/validators proposals. */
function SetHistory({ validators, list }: { validators: Validator[]; list: ValidatorList | null }) {
  const [sets, setSets] = useState<ValidatorSets | null>(null);
  const [gov, setGov] = useState<GovDao | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = list?.signature_head ? Math.floor(list.signature_head / 1000) : 0;
  useEffect(() => {
    let cancelled = false;
    getValidatorSets().then((r) => { if (!cancelled) { setSets(r); setFailed(false); } }).catch(() => { if (!cancelled) setFailed(true); });
    getGovDao().then((r) => { if (!cancelled) setGov(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [refresh]);
  const names = new Map(validators.map((v) => [v.address, validatorName(v)]));
  const rows = sets?.sets ?? [];
  // Accepted proposals executed by r/sys/validators, oldest first, paired in order with the set changes after genesis.
  // Only trusted when the counts agree; otherwise no attribution is shown.
  const changes = rows.filter((s) => s.from_height > 1).slice().reverse();
  const valProps = (gov?.proposals ?? []).filter((p) => p.status.toUpperCase() === "ACCEPTED" && p.executor?.includes("r/sys/validators")).sort((a, b) => a.id - b.id);
  const byChange = new Map(changes.length === valProps.length ? changes.map((c, i) => [c.from_height, valProps[i]] as const) : []);
  return <section className="vanalytic vset-history"><h3>Validator-set history <small>{rows.length ? `${rows.length} sets` : ""}</small></h3>
    {!sets ? (failed ? <p className="vmuted">Set history is temporarily unavailable.</p> : <Skeleton h={120} w="100%" />) : <ol className="vsets">{rows.map((set, i) => {
      const prev = rows[i + 1];
      const prop = byChange.get(set.from_height);
      const prevMembers = prev?.members ? new Set(prev.members.map((m) => m.address)) : null;
      const added = set.members && prevMembers ? set.members.filter((m) => !prevMembers.has(m.address)) : [];
      return <li key={set.hash + set.from_height}>
        <div className="vsets-head"><a href={blockHref(set.from_height)}>#{fmt(set.from_height)}</a><span>{i === 0 ? "current" : `→ #${fmt(set.to_height)}`}</span><time>{new Date(set.since).toISOString().slice(0, 10)}</time></div>
        <div className="vsets-body">{set.from_height <= 1 ? <span>Genesis · {set.members ? `${set.members.length} validators` : "—"}</span> : prop ? <span>Prop <a href={`#/govdao/${prop.id}`}>#{prop.id}</a> — {unescape(prop.title)}</span> : <span className="vmuted-inline">Set hash changed</span>}</div>
        {set.members ? <div className="vsets-members">{set.members.map((m) => <span key={m.address} className={added.some((a) => a.address === m.address) ? "added" : undefined} title={`${m.address} · power ${m.voting_power}`}>{m.moniker ?? names.get(m.address) ?? short(m.address)}<small>{m.voting_power}</small></span>)}</div> : <div className="vsets-members"><span className="vmuted-inline">Membership not snapshotted</span></div>}
      </li>;
    })}</ol>}
    <p className="vevents-note vafter">Changes detected from each block's validators hash. Proposals are the accepted GovDAO proposals executed by r/sys/validators, paired with the changes in order.</p>
  </section>;
}

/** Proposal titles come from rendered markdown with escapes like `\.` and `\_`. */
const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");

function StatGlyph({ index }: { index: number }) {
  const paths = [
    "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
    "M13 3 5 13h6l-1 8 8-10h-6l1-8Z",
    "m12 3 9 9-9 9-9-9 9-9Zm-4 9 3 3 5-6",
    "M10 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM3 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm14 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM12 7v5m0 0-6 4m6-4 6 4",
    "M4 4h16v16H4V4Zm5 0v16m6-16v16",
    "M8 11h8l3 8H5l3-8Zm1-5a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM9 15h6",
  ];
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[index]} /></svg>;
}
