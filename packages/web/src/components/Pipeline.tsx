/**
 * Live block stream: the newest blocks as a strip, NEWEST ON THE LEFT so the
 * live edge is always visible without scrolling. gno.land (Tendermint2) has
 * instant finality, so every committed block is final. Each card shows the
 * proposer (moniker from r/gnops/valopers), the tx count and how many of the
 * validator set precommitted it — signatures for height H arrive with block
 * H+1's last commit, so the newest card shows "—" until the next block lands.
 */
import { useEffect, useRef, useState } from "react";
import { Timestamp } from "./Timestamp";
import { getBlocks, type Block } from "../api";
import { Identicon } from "./ui";
import { blockHref, fmt, short } from "../lib";
import { BRAND, OK, TX, TX3, WARN, mono, panel, sans } from "./ui";

/** ~3.5 s blocks: poll at about the block cadence. */
const POLL_MS = 4_000;
const COUNT = 8;

export function Pipeline({ live, validators }: { live: boolean; validators?: number | null }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animationCycle, setAnimationCycle] = useState(0);
  const [freshHeight, setFreshHeight] = useState<number | null>(null);
  const previousHead = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getBlocks(COUNT)
        .then((r) => {
          if (cancelled) return;
          // The API returns newest first, which is the render order.
          setBlocks(r.blocks);
          setError(null);
          const head = r.blocks[0]?.height ?? null;
          if (head !== null && previousHead.current !== null && head !== previousHead.current) {
            setFreshHeight(head);
            setAnimationCycle((cycle) => cycle + 1);
            window.setTimeout(() => setFreshHeight((current) => (current === head ? null : current)), 1800);
          }
          if (head !== null) previousHead.current = head;
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    void load();
    if (!live) return () => {
      cancelled = true;
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live]);

  return (
    <section className="pipeline-panel" style={{ ...panel, overflow: "hidden" }}>
      <div
        className="pipeline-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, font: `650 16px/1 ${sans}`, color: TX }}><span className="pipeline-title-desktop">Live Block Stream</span><span className="pipeline-title-mobile">Latest Blocks</span></h2>
          <span style={{ font: `400 13px/1 ${sans}`, color: TX3 }}>Newest committed blocks, proposer and precommit signatures — newest on the left.</span>
        </div>
        <span className="pipeline-meta" style={{ font: `400 13px/1 ${mono}`, color: TX3 }}>
          {error ? `unavailable (${error})` : blocks ? `newest ${blocks.length} blocks · instant finality` : "loading…"}
        </span>
        <div className="pipeline-links">
          <a className="pipeline-view-all" href="#/blocks">View all&nbsp; →</a>
        </div>
      </div>
      <div
        className="pipeline-track"
        role="region"
        aria-label="Latest blocks"
        tabIndex={0}
        style={{ display: "flex", alignItems: "stretch", gap: 0, padding: "12px 16px 14px", overflowX: "auto" }}
      >
        {(blocks ?? []).map((b, i) => (
          <div
            key={`${b.height}-${animationCycle}`}
            className={`pipeline-item ${b.height === freshHeight ? "pipeline-item-new" : animationCycle > 0 ? "pipeline-item-shift" : ""}`}
            style={{ display: "flex", alignItems: "stretch", flex: "none" }}
          >
            {i > 0 && <div className="pipeline-arrow" style={arrowStyle}>→</div>}
            <BlockCard b={b} newest={i === 0} fresh={b.height === freshHeight} setSize={validators ?? null} />
          </div>
        ))}
        {blocks?.length === 0 && (
          <span style={{ font: `400 14px/1 ${sans}`, color: TX3 }}>No blocks indexed yet — the strip fills as the first blocks arrive.</span>
        )}
      </div>
    </section>
  );
}

/** "6/6" signatures, or "—" while the next block's commit is not read yet. */
export function signaturesText(b: Pick<Block, "signed" | "missed">): string {
  if (b.signed === null) return "—";
  return `${b.signed}/${b.signed + (b.missed ?? 0)}`;
}

function BlockCard({ b, newest, fresh, setSize }: { b: Block; newest: boolean; fresh: boolean; setSize: number | null }) {
  const proposer = b.proposer_moniker;
  const open = () => {
    window.location.hash = blockHref(b.height).slice(1);
  };
  const sigs = signaturesText(b);
  const sigColor = b.signed === null ? TX3 : (b.missed ?? 0) > 0 ? WARN : OK;
  const sigTitle =
    b.signed === null
      ? "Precommits for this block are read from the next block's commit"
      : `${b.signed} of ${b.signed + (b.missed ?? 0)}${setSize ? ` (set of ${setSize})` : ""} validators precommitted`;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      title={`block ${fmt(b.height)}\nproposed by ${proposer ?? b.proposer}\n${b.tx_count} transactions\nsignatures ${sigs}\n${new Date(b.time).toUTCString()}`}
      className={fresh ? "pipeline-card pipeline-card-new" : "pipeline-card"}
      style={{
        minWidth: 198,
        maxWidth: 220,
        minHeight: 76,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${newest ? "var(--brand)" : "var(--line)"}`,
        background: "var(--panel2)",
        display: "grid",
        gridTemplateColumns: "38px minmax(0,1fr) auto",
        columnGap: 10,
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div className="pipeline-logo">
        <Identicon address={b.proposer} size={30} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={{ color: newest ? BRAND : TX, font: `600 13px/1 ${mono}` }}>#{fmt(b.height)}</span>
        <span style={{ font: `600 13px/1 ${sans}`, color: proposer ? TX : TX3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={b.proposer}>
          {proposer ?? short(b.proposer)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 7, font: `400 12px/1 ${sans}`, color: TX3 }}>
          <span style={{ whiteSpace: "nowrap" }}>
            <span style={{ color: b.tx_count ? TX : TX3 }}>{fmt(b.tx_count)} tx</span> · <Timestamp value={b.time} />
          </span>
          <span className="pipeline-stage" style={{ color: sigColor, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", font: `500 12px/1 ${mono}` }} title={sigTitle}>
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10.5l4 4 8-9" />
            </svg>
            {sigs}
          </span>
        </div>
      </div>
      <span className="pipeline-chevron" aria-hidden="true">›</span>
    </div>
  );
}

const arrowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 7px",
  font: `400 15px/1 ${mono}`,
  color: TX3,
};
