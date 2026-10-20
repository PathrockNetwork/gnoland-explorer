/**
 * GovDAO (gno.land/r/gov/dao): proposals with YES/NO/ABSTAIN shares, members
 * by tier, and vote transactions. Detail dialog at `#/govdao/<id>`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { getGovDao, getProposal, type GovDao as GovDaoData, type Proposal, type ProposalDetail, type VoteTx } from "../api";
import { Chip, Identicon, Skeleton } from "../components/ui";
import { Timestamp } from "../components/Timestamp";
import { addrHref, blockHref, copyText, fmt, gnowebHref, isAddr, pkgHref, short, shortPath, txHref } from "../lib";
import "./govdao.css";

type Group = "all" | "active" | "accepted" | "rejected";
const GROUPS: [Group, string][] = [["all", "All"], ["active", "Active"], ["accepted", "Accepted"], ["rejected", "Rejected"]];
const CHOICES = [
  { key: "YES", label: "Yes", pct: "yes_pct", color: "var(--ok)" },
  { key: "NO", label: "No", pct: "no_pct", color: "var(--bad)" },
  { key: "ABSTAIN", label: "Abstain", pct: "abstain_pct", color: "var(--tx3)" },
] as const;
const TIERS = ["T1", "T2", "T3"];
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "brand" | "muted" }> = {
  ACTIVE: { label: "Active", tone: "brand" },
  ACCEPTED: { label: "Accepted", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "bad" },
};
const statusOf = (p: Proposal) => STATUS[p.status.toUpperCase()] ?? { label: p.status || "Unknown", tone: "muted" as const };
const inGroup = (p: Proposal, g: Group) => g === "all" || p.status.toUpperCase() === g.toUpperCase();
const PAGE = 12;

const gnowebProposal = (id: number) => `https://gno.land/r/gov/dao:${id}`;
/** Titles/bodies come from rendered markdown and keep escapes like `\.` and `\_`. */
const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
const pctText = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

function idFromHash(): number | null {
  const m = window.location.hash.match(/^#\/govdao\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

export function GovDao({ d }: { d: Dashboard }) {
  const [gov, setGov] = useState<GovDaoData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(idFromHash);
  const directory = useRef<HTMLElement>(null);

  useEffect(() => {
    const sync = () => setSelected(idFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => getGovDao().then((r) => { if (!cancelled) { setGov(r); setError(false); } }).catch(() => { if (!cancelled) setError(true); });
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [retry]);

  const proposals = gov?.proposals ?? [];
  const members = gov?.members ?? [];
  const names = nameBook(gov);
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const shown = proposals.filter((p) => inGroup(p, group) && (!q || [String(p.id), p.title, p.author, p.executor].some((s) => s?.toLowerCase().includes(q))));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = shown.slice(current * PAGE, current * PAGE + PAGE);
  const active = proposals.filter((p) => p.status.toUpperCase() === "ACTIVE");
  const latestVote = gov?.votes.reduce<VoteTx | null>((a, v) => (!a || v.height > a.height ? v : a), null) ?? null;

  const inspect = (id: number) => { window.location.hash = `/govdao/${id}`; setSelected(id); };
  const close = () => { setSelected(null); history.replaceState(null, "", "#/govdao"); };

  const params = [
    { label: "Proposals", value: gov ? fmt(proposals.length) : "—", icon: "list", note: gov ? `${active.length} active` : "" },
    { label: "Members", value: gov ? fmt(members.length) : "—", icon: "members", note: TIERS.map((t) => `${t} ${members.filter((m) => m.tier === t).length}`).join(" · ") },
    { label: "Accepted", value: gov ? fmt(proposals.filter((p) => inGroup(p, "accepted")).length) : "—", icon: "shield", note: gov ? `of ${proposals.length} proposals` : "" },
    { label: "DAO txs indexed", value: gov ? fmt(gov.votes.length) : "—", icon: "vote", note: "Direct votes and member scripts" },
    { label: "Latest vote", value: latestVote ? <Timestamp value={latestVote.time} /> : "—", icon: "clock", note: latestVote ? `block #${fmt(latestVote.height)}` : "" },
  ];

  return <div className="gve-page">
    <section className="gve-panel gve-overview" aria-label="GovDAO summary">
      <div className="gve-status-tabs" aria-label="Proposal status groups">{GROUPS.map(([g, label]) => <button type="button" key={g} aria-pressed={group === g} onClick={() => { setGroup(g); setPage(0); }}>{label}<span>{gov ? proposals.filter((p) => inGroup(p, g)).length : "—"}</span></button>)}</div>
      <div className="gve-parameters">{gov ? params.map((p) => <div key={p.label}><Glyph name={p.icon} /><div><span>{p.label}</span><strong>{p.value}</strong>{p.note && <small>{p.note}</small>}</div></div>) : <Skeleton h={34} w="100%" />}</div>
    </section>
    {error && <div className="gve-panel gve-notice" role="status"><span>GovDAO data is temporarily unavailable.{gov ? " Showing the last loaded proposals." : ""}</span><button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}

    <section className="gve-featured" aria-labelledby="govdao-active-title">
      <header className="gve-section-heading"><div><Glyph name="star" /><div><h2 id="govdao-active-title">Open for voting</h2><p>Active proposals in <a href={pkgHref("gno.land/r/gov/dao")}>r/gov/dao</a>; members vote with <code>MustVoteOnProposalSimple</code>.</p></div></div><a className="gve-ext" href="https://gno.land/r/gov/dao" target="_blank" rel="noopener noreferrer">GovDAO on gno.land ↗</a></header>
      <div className="gve-featured-grid">{!gov && !error ? [0, 1, 2].map((i) => <LoadingCard key={i} />) : active.slice(0, 3).map((p) => <ProposalCard key={p.id} p={p} names={names} featured onInspect={inspect} />)}</div>
      {gov && !active.length && <div className="gve-panel gve-empty">No proposal is open for voting right now.</div>}
    </section>

    <section className="gve-directory" ref={directory} aria-labelledby="govdao-all-title">
      <header className="gve-section-heading"><div><Glyph name="list" /><div><h2 id="govdao-all-title">All proposals</h2><p>{gov ? `${proposals.length} proposals, newest first · ids start at 0` : "Loading proposals…"}</p></div></div>
        <div className="gve-filters"><label className="gve-search"><Glyph name="search" /><input aria-label="Search proposals" placeholder="Search titles, authors, executors or #id…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label></div></header>
      <div className="gve-proposal-grid">{!gov && !error ? [0, 1, 2, 3].map((i) => <LoadingCard key={i} />) : visible.map((p) => <ProposalCard key={p.id} p={p} names={names} onInspect={inspect} />)}</div>
      {gov && !visible.length && <div className="gve-panel gve-empty"><strong>No matching proposals</strong><p>Try another status or search.</p><button type="button" onClick={() => { setGroup("all"); setQuery(""); setPage(0); }}>Clear filters</button></div>}
      {gov && pages > 1 && <footer className="gve-pagination"><span>{`${current * PAGE + 1}–${Math.min((current + 1) * PAGE, shown.length)} of ${shown.length}`} proposals</span><nav aria-label="Proposal pages"><button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: pages }, (_, i) => <button type="button" key={i} aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</button>)}<button type="button" aria-label="Next page" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>›</button></nav></footer>}
    </section>

    <div className="gdao-lower">
      <section className="gve-panel gdao-members" aria-labelledby="govdao-members-title">
        <header className="gdao-panel-head"><h2 id="govdao-members-title">Members by tier</h2><a href={gnowebHref("gno.land/r/gov/dao/memberstore/v0", "members")} target="_blank" rel="noopener noreferrer">memberstore ↗</a></header>
        {!gov ? <div className="gdao-pad"><Skeleton h={90} w="100%" /></div> : <div className="gdao-tiers">{TIERS.map((t) => {
          const list = members.filter((m) => m.tier === t);
          return <div key={t} className="gdao-tier"><div className="gdao-tier-head"><strong>{t}</strong><span>{list.length} member{list.length === 1 ? "" : "s"}</span></div>
            {list.length ? <ul>{list.map((m) => <li key={m.address}><Identicon address={m.address} size={20} /><a href={addrHref(m.address)} title={m.address}>{m.username ? `@${m.username}` : short(m.address)}</a>{m.username && <small>{short(m.address)}</small>}</li>)}</ul> : <p className="gve-muted">No members in this tier.</p>}
          </div>;
        })}</div>}
      </section>
      <section className="gve-panel gdao-votes" aria-labelledby="govdao-votes-title">
        <header className="gdao-panel-head"><h2 id="govdao-votes-title">Recent vote transactions</h2><span>{gov ? `${gov.votes.length} latest` : ""}</span></header>
        {!gov ? <div className="gdao-pad"><Skeleton h={120} w="100%" /></div> : gov.votes.length === 0 ? <p className="gve-muted gdao-pad">No vote transactions indexed yet.</p> : <VoteTable votes={gov.votes} names={names} onInspect={inspect} />}
      </section>
    </div>

    {selected !== null && <ProposalDialog key={selected} id={selected} fallback={proposals.find((p) => p.id === selected)} names={names} onClose={close} />}
    <p className="gve-muted gdao-foot">Proposal status, shares and per-tier votes are read from the GovDAO realm render; vote transactions come from indexed <code>MustVoteOnProposalSimple</code> calls. {d.net?.chain_id ?? "gnoland-1"}.</p>
  </div>;
}

/** username ↔ address from members and votes, so "@name" authors can link to an address. */
function nameBook(gov: GovDaoData | null) {
  const byName = new Map<string, string>();
  for (const m of gov?.members ?? []) if (m.username) byName.set(m.username, m.address);
  for (const v of gov?.votes ?? []) if (v.voter_name) byName.set(v.voter_name, v.voter);
  return byName;
}

/** "@aeddi" or a g1 address → link to the address page (or the gnoweb user page when the address is unknown). */
function Who({ who, names }: { who: string | null; names: Map<string, string> }) {
  if (!who) return <span className="gve-muted">—</span>;
  const w = who.trim();
  if (isAddr(w)) return <a href={addrHref(w)} title={w}>{short(w)}</a>;
  const name = w.replace(/^@/, "");
  const address = names.get(name);
  return address ? <a href={addrHref(address)} title={address}>@{name}</a> : <a href={`https://gno.land/u/${encodeURIComponent(name)}`} target="_blank" rel="noopener noreferrer">@{name}</a>;
}

function ProposalCard({ p, names, featured = false, onInspect }: { p: Proposal; names: Map<string, string>; featured?: boolean; onInspect: (id: number) => void }) {
  const status = statusOf(p);
  return <article className={`gve-panel gve-card ${featured ? "featured" : ""}`}>
    <header><span className="gve-id">#{p.id}</span><Chip tone={status.tone}>{status.label}</Chip>{p.executor && <span className="gve-kind" title={p.executor}>{shortPath(p.executor)}<Glyph name="parameters" /></span>}</header>
    <h3><button type="button" onClick={() => onInspect(p.id)}>{unescape(p.title) || "Untitled proposal"}</button></h3>
    <p className="gve-summary">By <Who who={p.author} names={names} />{p.tiers && <> · tiers {p.tiers}</>}</p>
    <VoteBreakdown p={p} />
    <footer><span><Glyph name="vote" />{voterCount(p)} voter{voterCount(p) === 1 ? "" : "s"}</span><button type="button" onClick={() => onInspect(p.id)}>{status.label === "Active" ? "Track vote" : "View details"}<span aria-hidden="true">→</span></button></footer>
  </article>;
}

const voterCount = (p: Proposal) => Object.values(p.votes ?? {}).reduce((a, tiers) => a + Object.values(tiers).reduce((b, list) => b + list.length, 0), 0);

function VoteBreakdown({ p, detailed = false }: { p: Proposal; detailed?: boolean }) {
  const known = CHOICES.some((c) => p[c.pct] != null);
  return <div className={`gve-votes ${detailed ? "detailed" : ""}`}>
    <div className="gve-vote-bar" role="img" aria-label={known ? CHOICES.map((c) => `${c.label} ${pctText(p[c.pct])}`).join(", ") : "Tally unavailable"}>{CHOICES.map((c) => <i key={c.key} style={{ width: `${Math.max(0, Math.min(100, p[c.pct] ?? 0))}%`, background: c.color }} />)}</div>
    <ul className="gve-vote-legend gdao-legend">{CHOICES.map((c) => <li key={c.key}><i style={{ background: c.color }} /><span>{c.label}</span><strong>{pctText(p[c.pct])}</strong></li>)}</ul>
    {detailed && <p className="gve-muted">Shares of the total voting power of eligible tiers, as reported by the GovDAO render. Unvoted power makes up the rest of the bar.</p>}
  </div>;
}

function VoteTable({ votes, names, onInspect, hideProposal = false }: { votes: VoteTx[]; names: Map<string, string>; onInspect?: (id: number) => void; hideProposal?: boolean }) {
  return <div className="gdao-table-scroll"><table className="gdao-table"><thead><tr><th>Voter</th>{!hideProposal && <th>Proposal</th>}<th>Option</th><th>Block</th><th>Time</th><th>Tx</th></tr></thead><tbody>
    {votes.map((v) => <tr key={v.hash}>
      <td><span className="gdao-voter"><Identicon address={v.voter} size={18} /><a href={addrHref(v.voter)} title={v.voter}>{v.voter_name ? `@${v.voter_name}` : short(v.voter)}</a></span></td>
      {!hideProposal && <td>{v.proposal == null ? "—" : onInspect ? <button type="button" className="gdao-link" onClick={() => onInspect(v.proposal!)}>#{v.proposal}</button> : `#${v.proposal}`}</td>}
      <td>{!v.success ? <Chip tone="bad" title="The vote transaction failed">Failed</Chip> : v.via === "script" ? <Chip tone="brand" title="A MsgRun script that imports the DAO (often creating a proposal and voting on it); open the transaction to read the script">Script</Chip> : <OptionChip option={v.option} />}</td>
      <td><a href={blockHref(v.height)}>#{fmt(v.height)}</a></td>
      <td><Timestamp value={v.time} /></td>
      <td><a href={txHref(v.hash)} title={v.hash}>{v.hash.slice(0, 10)}…</a></td>
    </tr>)}
  </tbody></table></div>;
}

function OptionChip({ option }: { option: string | null }) {
  const o = (option ?? "").toUpperCase();
  return <Chip tone={o === "YES" ? "ok" : o === "NO" ? "bad" : "muted"}>{option ?? "—"}</Chip>;
}

function LoadingCard() { return <div className="gve-panel gve-loading"><Skeleton h={18} w="55%" /><Skeleton h={44} w="95%" /><Skeleton h={30} w="100%" /><Skeleton h={10} w="100%" /></div>; }

function ProposalDialog({ id, fallback, names, onClose }: { id: number; fallback?: Proposal; names: Map<string, string>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [failed, setFailed] = useState<"missing" | "error" | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    getProposal(id).then((r) => { if (!cancelled) setDetail(r); }).catch((e) => { if (!cancelled) setFailed(e?.status === 404 ? "missing" : "error"); });
    return () => { cancelled = true; };
  }, [id]);
  const p = detail?.proposal ?? fallback;
  const status = p ? statusOf(p) : null;
  const copyLink = async () => { try { await copyText(`${location.origin}${location.pathname}#/govdao/${id}`); setCopied(true); } catch { /* clipboard unavailable */ } };
  return <dialog className="gve-dialog" ref={dialog} aria-labelledby="govdao-detail-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header><div><span className="gve-detail-kicker">GovDAO proposal #{id}{p?.executor ? ` · ${shortPath(p.executor)}` : ""}</span><h2 id="govdao-detail-title">{p ? unescape(p.title) : failed === "missing" ? "Proposal not found" : "Loading proposal…"}</h2>{p && <div className="gve-detail-badges"><Chip tone={status!.tone}>{status!.label}</Chip>{p.tiers && <span>Tiers {p.tiers}</span>}<span>By <Who who={p.author} names={names} /></span></div>}</div><button type="button" className="gve-close" aria-label="Close proposal details" onClick={onClose}>×</button></header>
    <div className="gve-detail-body">
      {!p ? <p className="gve-muted">{failed === "missing" ? `No proposal #${id} exists in GovDAO.` : failed ? "Proposal details are temporarily unavailable." : <Skeleton h={120} w="100%" />}</p> : <>
        <section><h3>Description</h3>{detail ? (detail.proposal.body?.trim() ? <div className="gdao-body">{markdownish(detail.proposal.body)}</div> : <p className="gve-muted">No description was supplied.</p>) : failed ? <p className="gve-muted">The description is temporarily unavailable.</p> : <Skeleton h={80} w="100%" />}</section>
        <section><h3>Vote breakdown</h3><VoteBreakdown p={p} detailed /><TierGrid p={p} names={names} /></section>
        <section><h3>Facts</h3><dl className="gve-detail-facts">
          <Fact label="Executor realm">{p.executor ? <a href={pkgHref(p.executor)}>{shortPath(p.executor)}</a> : "—"}</Fact>
          <Fact label="Author"><Who who={p.author} names={names} /></Fact>
          <Fact label="Eligible tiers">{p.tiers ?? "—"}</Fact>
          <Fact label="Synced from chain"><Timestamp value={p.synced_at} /></Fact>
        </dl></section>
        <section><h3>Vote transactions</h3>{!detail ? (failed ? <p className="gve-muted">Vote transactions are temporarily unavailable.</p> : <Skeleton h={60} w="100%" />) : detail.vote_txs.length === 0 ? <p className="gve-muted">No vote transactions indexed for this proposal{voterCount(p) ? " — votes may predate the indexed history or come through another call path" : ""}.</p> : <VoteTable votes={detail.vote_txs} names={names} hideProposal />}</section>
      </>}
    </div>
    <footer><a href={gnowebProposal(id)} target="_blank" rel="noopener noreferrer">View on gno.land ↗</a><button type="button" onClick={() => void copyLink()}>{copied ? "Link copied ✓" : "Copy proposal link"}</button></footer>
  </dialog>;
}

/** Option × tier grid of voters, from the realm's `:<id>/votes` render. */
function TierGrid({ p, names }: { p: Proposal; names: Map<string, string> }) {
  if (!p.votes) return <p className="gve-muted">Per-voter breakdown unavailable.</p>;
  const tiers = TIERS.filter((t) => CHOICES.some((c) => p.votes?.[c.key]?.[t] !== undefined));
  return <div className="gdao-table-scroll"><table className="gdao-table gdao-tier-table"><thead><tr><th>Option</th>{tiers.map((t) => <th key={t}>{t}</th>)}</tr></thead><tbody>
    {CHOICES.map((c) => <tr key={c.key}><td><span className="gdao-opt"><i style={{ background: c.color }} />{c.label}</span></td>{tiers.map((t) => {
      const list = p.votes?.[c.key]?.[t] ?? [];
      return <td key={t}>{list.length ? <span className="gdao-voters">{list.map((who) => <Who key={who} who={who} names={names} />)}</span> : <span className="gve-muted">—</span>}</td>;
    })}</tr>)}
  </tbody></table></div>;
}

/** Minimal markdown-ish rendering without a dependency: headings, bullet lists, paragraphs (pre-wrap). */
function markdownish(text: string): ReactNode {
  return unescape(text).split(/\n{2,}/).map((block, i) => {
    const lines = block.split("\n");
    if (/^#{1,6}\s/.test(block)) {
      const [head, ...rest] = lines;
      return <div key={i}><h4>{head.replace(/^#{1,6}\s+/, "")}</h4>{rest.length > 0 && markdownish(rest.join("\n"))}</div>;
    }
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-*]\s+/, "")}</li>)}</ul>;
    return <p key={i}>{block.replace(/\*\*([^*]+)\*\*/g, "$1")}</p>;
  });
}

function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }

function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    star: "m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z",
    list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
    search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
    members: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9c.5-3.5 2.7-5.5 6-5.5s5.5 2 6 5.5M16 5.5a3 3 0 0 1 0 5.5m2 4c1.7.7 2.7 2.3 3 5",
    vote: "M4 13h16v7H4v-7Zm4-2 3 3 6-8M9 17h6",
    clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
    parameters: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.parameters} /></svg>;
}
