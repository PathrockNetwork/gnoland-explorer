/**
 * The validator inspector on the Validators page: valopers profile, voting
 * power, signing record (uptime windows, the newest 200 read blocks, missed
 * blocks) and the block-proposal record (per day, recent blocks).
 */
import { useEffect, useState, type ReactNode } from "react";
import { getValidatorDetail, ApiError, type Validator, type ValidatorDetail, type ValidatorList } from "../api";
import { Chip, CopyButton, Identicon, Skeleton } from "./ui";
import { Timestamp } from "./Timestamp";
import { addrHref, blockHref, fmt, pct, short } from "../lib";
import { serverLabel, uptimeText, uptimeTone, validatorName, validatorState, windowInfo } from "../validatorDirectory";

type Tab = "Overview" | "Signing" | "Proposals" | "Profile";
const TABS: Tab[] = ["Overview", "Signing", "Proposals", "Profile"];

export const valoperHref = (operator: string) => `https://gno.land/r/gnops/valopers:${operator}`;

export function ValidatorStatus({ v }: { v: Validator }) {
  const s = validatorState(v);
  if (s === "active") return <Chip tone="ok" title="In the validator set and signing">● Active</Chip>;
  if (s === "degraded") return <Chip tone="warn" title={`In the set but missed precommits recently${v.missed_streak ? ` · current streak ${fmt(v.missed_streak)}` : ""}`}>▲ Degraded</Chip>;
  return <Chip tone="muted" title="Registered a valopers profile; not in the validator set">Candidate</Chip>;
}

export function Fact({ label, value, note, title }: { label: string; value: ReactNode; note?: ReactNode; title?: string }) {
  return <div className="vfact" title={title}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

/** "@moul" when the operator has a username, otherwise the shortened address. */
export function OperatorLink({ v, full = false }: { v: Validator; full?: boolean }) {
  if (!v.operator) return <span className="vunknown">—</span>;
  return <a href={addrHref(v.operator)} title={v.operator} onClick={(e) => e.stopPropagation()}>{v.operator_name ? `@${v.operator_name}` : full ? v.operator : short(v.operator)}</a>;
}

export function ValidatorDrop({
  address,
  row,
  list,
  refreshKey,
  copied,
  onCopy,
  onClose,
}: {
  address: string;
  /** The list row for this address, if the list has loaded; used until the detail arrives. */
  row: Validator | undefined;
  list: ValidatorList | null;
  /** Changes whenever the dashboard re-polls validators; triggers a detail refetch. */
  refreshKey: unknown;
  copied: string | null;
  onCopy: (value: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [detail, setDetail] = useState<ValidatorDetail | null>(null);
  const [error, setError] = useState<{ address: string; notFound: boolean } | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    getValidatorDetail(address)
      .then((r) => { if (!cancelled) { setDetail(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError({ address, notFound: e instanceof ApiError && e.status === 404 }); });
    return () => { cancelled = true; };
  }, [address, refreshKey]);

  const fresh = detail?.validator.address === address ? detail : null;
  const v = fresh?.validator ?? row;
  const failed = error?.address === address;

  if (!v) {
    return <aside className="vinspector" aria-label="Selected validator details">
      <header className="vinspector-head"><div><h2>{short(address)}</h2></div><CloseButton onClose={onClose} /></header>
      <div className="vempty">{failed ? (error!.notFound ? `No validator or valopers profile with address ${address}.` : "Validator details are temporarily unavailable.") : "Loading validator details…"}</div>
    </aside>;
  }

  const name = validatorName(v);
  const inSet = v.in_set;

  return <aside className="vinspector" aria-label="Selected validator details">
    <header className="vinspector-head">
      <Identicon address={v.address} size={36} />
      <div><h2 title={name}>{name}</h2><span title={`Signing (consensus) address ${v.address}`}>{short(v.address)} <CopyButton value={v.address} copied={copied === v.address} onCopy={onCopy} /></span></div>
      <ValidatorStatus v={v} />
      <CloseButton onClose={onClose} />
    </header>
    <div className="vinspector-links">
      {v.server_type && <Chip tone="muted" title="Server type declared in the valopers profile">{serverLabel(v.server_type)}</Chip>}
      {v.operator && <a href={addrHref(v.operator)}>Operator {v.operator_name ? `@${v.operator_name}` : "account"} →</a>}
      {v.operator && <a href={valoperHref(v.operator)} target="_blank" rel="noopener noreferrer">Valoper profile ↗</a>}
    </div>
    <nav className="vdetail-tabs" aria-label="Validator detail sections">{TABS.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
    <div className="vinspector-body">
      {tab === "Overview" && <>
        {!inSet && <p className="vnotice vcandidate-note">Not in the validator set. Candidates join through a GovDAO proposal executed by <code>r/sys/validators/v0</code> — see <a href="#/govdao">GovDAO</a>.</p>}
        <div className="vdetail-facts">
          <Fact label="Voting power" value={inSet ? fmt(v.voting_power) : "0"} note={v.power_share != null ? `${pct(v.power_share * 100, 2)} of ${fmt(list?.total_power)}` : "Not in set"} />
          {[0, 1, 2].map((i) => {
            const w = windowInfo(list, i);
            return <Fact key={i} label={`Uptime ${w.label}`} title={w.partial ? `Only ${fmt(w.size)} blocks of signatures read so far` : undefined}
              value={<span className={uptimeTone(v.uptime[i])}>{uptimeText(v.uptime[i])}{w.partial && v.uptime[i] != null && <sup>*</sup>}</span>}
              note={v.missed[i] == null ? "Not in set" : `${fmt(v.missed[i])} missed / ${fmt(w.size)}`} />;
          })}
          <Fact label="Missed streak" value={<span className={(v.missed_streak ?? 0) > 0 ? "bad" : undefined}>{v.missed_streak == null ? "—" : fmt(v.missed_streak)}</span>} note="Consecutive, newest first" />
          <Fact label="Last missed" value={v.last_missed_height == null ? "—" : <a href={blockHref(v.last_missed_height)}>#{fmt(v.last_missed_height)}</a>} note={v.last_missed_height == null && inSet ? "None in read window" : undefined} />
          <Fact label="Blocks proposed" value={fmt(v.blocks_proposed)} note={v.proposed_share != null ? `${pct(v.proposed_share * 100, 2)} of all blocks` : undefined} />
          <Fact label="Proposed · newest 1k" value={fmt(v.proposed_recent)} note={inSet && v.power_share ? `≈${fmt(Math.round(v.power_share * 1000))} expected` : undefined} />
          <Fact label="Last proposed" value={v.last_proposed_height == null ? "—" : <a href={blockHref(v.last_proposed_height)}>#{fmt(v.last_proposed_height)}</a>} note={v.last_proposed_time ? <Timestamp value={v.last_proposed_time} /> : undefined} />
        </div>
        {inSet && <SigningStrip detail={fresh} failed={failed} list={list} />}
        <PerDay detail={fresh} failed={failed} />
      </>}
      {tab === "Signing" && <>
        {inSet ? <>
          <SigningStrip detail={fresh} failed={failed} list={list} />
          <MissedBlocks detail={fresh} failed={failed} />
        </> : <p className="vmuted">Candidates are not in the validator set, so no precommits are expected from this key.</p>}
        <p className="vmuted">{dataWindowNote(list)}</p>
      </>}
      {tab === "Proposals" && <>
        <PerDay detail={fresh} failed={failed} />
        <RecentBlocks detail={fresh} failed={failed} />
      </>}
      {tab === "Profile" && <div className="videntity-details">
        <Fact label="Moniker" value={v.moniker ?? "—"} note={v.operator ? "From r/gnops/valopers" : "No valopers profile found"} />
        <Fact label="Signing address" value={<span className="vcopy-row"><span>{v.address}</span><CopyButton value={v.address} copied={copied === v.address} onCopy={onCopy} /></span>} note="Consensus key address: proposer / precommit identity" />
        <Fact label="Operator" value={v.operator ? <span className="vcopy-row"><OperatorLink v={v} full />{v.operator_name && <small className="vmuted-inline">{v.operator}</small>}<CopyButton value={v.operator} copied={copied === v.operator} onCopy={onCopy} /></span> : "—"} note="Account that registered the profile; used by GovDAO proposals" />
        <Fact label="Server type" value={serverLabel(v.server_type)} />
        <Fact label="Public key" value={v.pub_key ? <span className="vcopy-row"><span>{v.pub_key}</span><CopyButton value={v.pub_key} copied={copied === v.pub_key} onCopy={onCopy} /></span> : "—"} note={v.pub_key ? "Ed25519, base64" : "Unknown until the key joins a validator set"} />
        <Fact label="First seen" value={v.first_seen_height == null ? "—" : <a href={blockHref(v.first_seen_height)}>#{fmt(v.first_seen_height)}</a>} note="First indexed block it proposed" />
        <section className="vdetail-section">
          <div className="vsection-title"><h3>Description</h3>{v.operator && <a href={valoperHref(v.operator)} target="_blank" rel="noopener noreferrer">gno.land ↗</a>}</div>
          {v.description ? <div className="vdescription-full">{paragraphs(v.description)}</div> : <p className="vmuted">No description published.</p>}
        </section>
      </div>}
    </div>
  </aside>;
}

export function dataWindowNote(list: ValidatorList | null): string {
  if (!list) return "";
  return `Uptime comes from commit precommits. Signatures are read for the newest ~100k blocks only; ${fmt(list.signed_blocks)} blocks read so far${list.signature_head ? `, up to #${fmt(list.signature_head)}` : ""}. Proposals are counted from every block since genesis (${fmt(list.blocks_indexed)} blocks).`;
}

/** Plain-text rendering of markdown-ish text: blank-line paragraphs, line breaks kept, markers trimmed. */
export function paragraphs(text: string): ReactNode {
  return text.split(/\n{2,}/).map((p, i) => {
    const heading = /^#{1,6}\s+/.test(p);
    const body = p.replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    return heading ? <h4 key={i}>{body}</h4> : <p key={i}>{body}</p>;
  });
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return <button type="button" className="vclose" aria-label="Close validator inspector" title="Close" onClick={onClose}>×</button>;
}

function SigningStrip({ detail, failed, list }: { detail: ValidatorDetail | null; failed: boolean; list: ValidatorList | null }) {
  const strip = detail?.signing_strip ?? [];
  const signed = strip.filter((s) => s.signed).length;
  return <section className="vdetail-section">
    <div className="vsection-title"><h3>Signing history</h3><span>{strip.length ? `${fmt(strip.length)} newest read blocks` : ""}</span></div>
    {!detail ? (failed ? <p className="vmuted">Signing history is temporarily unavailable.</p> : <Skeleton h={60} w="100%" />)
      : strip.length === 0 ? <p className="vmuted">No signatures read for this validator yet.</p>
      : <>
        <div className="vsigning-summary"><span>{fmt(signed)} / {fmt(strip.length)} signed · #{fmt(strip[0].height)}–#{fmt(strip[strip.length - 1].height)}</span><strong className={uptimeTone(signed / strip.length)}>{uptimeText(signed / strip.length)}</strong></div>
        <div className="vheatmap" role="img" aria-label={`Signing history, oldest to newest: ${signed} of ${strip.length} signed`}>
          {strip.map((s) => <a key={s.height} href={blockHref(s.height)} className={s.signed ? "signed" : "missed"} title={`Block ${fmt(s.height)} · ${s.signed ? "Signed" : "Missed"}`} />)}
        </div>
        <div className="vheatmap-legend"><span><i className="signed" />Signed</span><span><i className="missed" />Missed</span><span>Oldest → newest</span></div>
      </>}
    {list && list.signature_head !== null && <p className="vmuted vnote">Signature data through #{fmt(list.signature_head)}.</p>}
  </section>;
}

function MissedBlocks({ detail, failed }: { detail: ValidatorDetail | null; failed: boolean }) {
  return <section className="vdetail-section">
    <div className="vsection-title"><h3>Missed blocks</h3><span>{detail ? `${fmt(detail.missed_blocks.length)} in read window` : ""}</span></div>
    {!detail ? (failed ? <p className="vmuted">Missed-block history is temporarily unavailable.</p> : <Skeleton h={60} w="100%" />)
      : detail.missed_blocks.length === 0 ? <p className="vmuted">No missed precommits in the blocks read so far.</p>
      : <div className="vblocks">{detail.missed_blocks.map((b) => <a key={b.height} className="vblock" href={blockHref(b.height)}>
        <strong className="bad">#{fmt(b.height)}</strong><span>precommit missing</span><time><Timestamp value={b.time} /></time>
      </a>)}</div>}
  </section>;
}

function RecentBlocks({ detail, failed }: { detail: ValidatorDetail | null; failed: boolean }) {
  return <section className="vdetail-section">
    <div className="vsection-title"><h3>Recent proposed blocks</h3><span>{detail ? `${detail.recent_blocks.length} latest` : ""}</span></div>
    {!detail ? (failed ? <p className="vmuted">Block history is temporarily unavailable.</p> : <Skeleton h={120} w="100%" />)
      : detail.recent_blocks.length === 0 ? <p className="vmuted">No proposed blocks indexed.</p>
      : <div className="vblocks">{detail.recent_blocks.map((b) => <a key={b.height} className="vblock" href={blockHref(b.height)}>
        <strong>#{fmt(b.height)}</strong><span>{fmt(b.tx_count)} tx{b.tx_count === 1 ? "" : "s"}</span><time><Timestamp value={b.time} /></time>
      </a>)}</div>}
  </section>;
}

/** Day buckets come back as local-midnight timestamps; noon-shift before taking the date. */
const dayLabel = (day: string) => {
  const t = Date.parse(day);
  return Number.isFinite(t) ? new Date(t + 12 * 3600_000).toISOString().slice(5, 10) : day;
};

function PerDay({ detail, failed }: { detail: ValidatorDetail | null; failed: boolean }) {
  const days = detail?.proposed_per_day ?? [];
  const max = Math.max(1, ...days.map((d) => d.proposed));
  const total = days.reduce((a, d) => a + d.proposed, 0);
  return <section className="vdetail-section">
    <div className="vsection-title"><h3>Blocks proposed per day</h3><span>{days.length ? `${fmt(total)} over ${days.length} days` : ""}</span></div>
    {!detail ? (failed ? <p className="vmuted">Proposal history is temporarily unavailable.</p> : <Skeleton h={72} w="100%" />)
      : days.length === 0 ? <p className="vmuted">No proposed blocks indexed.</p>
      : <>
        <div className="vhourly" role="img" aria-label={`Blocks proposed per day, ${days.length} days, peak ${fmt(max)}`}>
          {days.map((d, i) => <div key={d.day} title={`${dayLabel(d.day)}: ${fmt(d.proposed)} blocks${i === days.length - 1 ? " (today, partial)" : ""}`}><i className={i === days.length - 1 ? "partial" : undefined} style={{ height: `${(d.proposed / max) * 100}%` }} /></div>)}
        </div>
        <div className="vchart-axis"><span>{dayLabel(days[0].day)}</span><span>peak {fmt(max)}/day</span><span>{dayLabel(days[days.length - 1].day)}</span></div>
      </>}
  </section>;
}
