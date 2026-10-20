/**
 * Blocks: live block sequence, the paged block ledger (with a "with
 * transactions only" filter — most gno.land blocks are empty) and an inspector
 * for one block by height or hash: header, proposer, precommit signatures with
 * the validators that missed, and the block's transactions.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { preferredScrollBehavior } from "../appearance";
import { Timestamp } from "../components/Timestamp";
import type { Dashboard } from "../useDashboard";
import { getBlock, getBlocks, type Block, type BlockDetail, type Names, type Source } from "../api";
import {
  blockError,
  blockIdFromLocation,
  blockRoute,
  kindCounts,
  parseBlockQuery,
  proposerCounts,
  setSize,
  signatures,
  sigTone,
  txTotals,
  utcDateTime,
  utcTime,
} from "../blockExplorer";
import { addrHref, coinText, copyText, fmt, gnot, kindLabel, middle, pct, short, txHref, txSummary } from "../lib";
import { CopyButton, Identicon } from "../components/ui";
import "./blocks.css";

/** Live head page; older pages are fetched with `before`. */
const HEAD_LIMIT = 50;
const POLL_MS = 4_000;

type Detail = { data: BlockDetail | null; error: string | null; loading: boolean };
type OlderPage = { key: string; source: Source; blocks: Block[] };

export function Blocks({ d, live }: { d: Dashboard; live: boolean }) {
  const [head, setHead] = useState<Block[]>([]);
  const [headTxBlocks, setHeadTxBlocks] = useState<Block[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(blockIdFromLocation);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const [withTxs, setWithTxs] = useState(false);
  const [perPage, setPerPage] = useState(25);
  /** `before` cursors of the pages walked into; empty = the live head page. */
  const [cursors, setCursors] = useState<number[]>([]);
  const [older, setOlder] = useState<OlderPage | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [jump, setJump] = useState("");
  const [jumpError, setJumpError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"Overview" | "Transactions" | "Raw JSON">("Overview");
  const running = live && !paused;

  const pick = (id: number | string) => {
    location.hash = blockRoute(id).slice(1);
  };
  const copy = (value: string) => {
    void copyText(value);
    setCopied(value);
  };
  useEffect(() => {
    const sync = () => setSelected(blockIdFromLocation());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  // Live head: newest blocks, plus the newest blocks with transactions when that filter is on.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getBlocks(HEAD_LIMIT)
        .then((r) => {
          if (cancelled) return;
          setHead(r.blocks);
          setError(null);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setError("Recent blocks are temporarily unavailable.");
          setLoading(false);
        });
      if (withTxs)
        void getBlocks(HEAD_LIMIT, { withTxs: true })
          .then((r) => !cancelled && setHeadTxBlocks(r.blocks))
          .catch(() => undefined);
    };
    load();
    const timer = running ? window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [running, withTxs]);

  const before = cursors[cursors.length - 1];
  const olderKey = before === undefined ? null : `${before}:${perPage}:${withTxs ? 1 : 0}`;
  useEffect(() => {
    if (before === undefined || olderKey === null) {
      setOlder(null);
      setOlderError(null);
      return;
    }
    let cancelled = false;
    setOlderError(null);
    getBlocks(perPage, { before, withTxs })
      .then((r) => !cancelled && setOlder({ key: olderKey, source: r.source, blocks: r.blocks }))
      .catch(() => !cancelled && setOlderError("This page of blocks could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [before, perPage, withTxs, olderKey]);

  const onHead = cursors.length === 0;
  const olderReady = !onHead && older?.key === olderKey;
  const headRows = withTxs ? headTxBlocks : head;
  const rows = onHead ? (headRows ?? []).slice(0, perPage) : olderReady ? older!.blocks : [];
  const lowest = rows.length ? rows[rows.length - 1]!.height : null;
  const canOlder = lowest !== null && lowest > 0 && rows.length >= perPage;
  const top = head[0];
  const chainHead = Math.max(d.net?.indexed_head ?? 0, top?.height ?? 0) || undefined;

  // Inspector target: the routed block, else the newest block.
  const targetId = selected ?? (top ? String(top.height) : null);
  useEffect(() => {
    if (targetId === null) return;
    const known = detailsRef.current[targetId];
    if (known && !known.error) {
      if (known.loading) return;
      const kb = known.data?.block;
      // Only blocks at the head can still gain signatures; everything else is cached for good.
      if (!kb || kb.signed !== null || !top || kb.height < top.height - 3) return;
    }
    let cancelled = false;
    const id = targetId;
    if (!known) setDetails((old) => ({ ...old, [id]: { data: null, error: null, loading: true } }));
    getBlock(id)
      .then((r) => {
        if (cancelled) return;
        setDetails((old) => ({ ...Object.fromEntries(Object.entries(old).slice(-39)), [id]: { data: r, error: null, loading: false } }));
      })
      .catch((e) => {
        if (cancelled) return;
        setDetails((old) => ({ ...old, [id]: { data: null, error: blockError(e, id), loading: false } }));
      });
    return () => {
      cancelled = true;
    };
    // A head block's signatures arrive with the next block: refetch once it exists.
  }, [targetId, top?.height]);

  const detail = targetId === null ? undefined : details[targetId];
  const picked = detail?.data?.block;
  const streamLive = running && !error && d.state !== "stopped" && d.state !== "dberror";
  const resetPaging = () => setCursors([]);

  return (
    <div className="bx-page bx-history gno-blocks">
      <div className="bx-chain-toolbar">
        <span>Chain explorer <i>/</i> Blocks{picked ? <> <i>/</i> #{fmt(picked.height)}</> : null}</span>
        <div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const id = parseBlockQuery(jump);
              setJumpError(id === null);
              if (id !== null) pick(id);
            }}
          >
            <input
              type="text"
              inputMode="search"
              aria-label="Jump to block height or hash"
              aria-invalid={jumpError}
              placeholder="Height or block hash…"
              value={jump}
              onChange={(event) => {
                setJump(event.target.value);
                setJumpError(false);
              }}
            />
            <button type="submit">Go →</button>
          </form>
          <a href="#/rpc">↗ Query via RPC</a>
        </div>
      </div>

      <section className="bx-card bx-sequence">
        <header>
          <div>
            <h2>Live block sequence</h2>
            <span>Follow the head or inspect an earlier height.</span>
            <LiveBadge live={streamLive} />
          </div>
          <div className="bx-sequence-meta">
            <span>Height <strong>{top ? fmt(top.height) : "—"}</strong></span>
            <span>{d.net?.avg_block_time_ms == null ? "—" : `${(d.net.avg_block_time_ms / 1000).toFixed(2)}s`} cadence</span>
            <button type="button" disabled={!live} onClick={() => setPaused(!paused)} aria-label={paused ? "Resume block updates" : "Pause block updates"}>{paused ? "▶ Resume" : "Ⅱ Pause"}</button>
            <button type="button" onClick={() => { location.hash = "/blocks"; }}>Follow head →</button>
          </div>
        </header>
        <div className="bx-sequence-track">
          {head.slice(0, 8).map((block) => (
            <button
              type="button"
              key={block.height}
              className={`bx-sequence-block ${block.height === picked?.height ? "selected" : ""}`}
              onClick={() => pick(block.height)}
              aria-pressed={block.height === picked?.height}
              aria-label={`Inspect block ${block.height}`}
            >
              <strong><Glyph name="cube" />#{fmt(block.height)}</strong>
              <span className="bx-sequence-proposer" title={block.proposer}><Identicon address={block.proposer} size={16} />{block.proposer_moniker ?? short(block.proposer)}</span>
              <small>
                <span className={block.tx_count ? "gx-has-txs" : undefined}>{fmt(block.tx_count)} tx · <span className={`gx-sig ${sigTone(block)}`}>{signatures(block)}</span></span>
                <span><Timestamp value={block.time} /></span>
              </small>
            </button>
          ))}
          {!head.length && <p className="bx-muted">{loading ? "Loading block sequence…" : error ?? "Waiting for indexed blocks."}</p>}
        </div>
      </section>

      {error && <p className="bx-notice" role="alert">{error} {head.length > 0 && "Showing the last successful snapshot."}</p>}

      <div className={`bx-workspace${selected !== null ? " gx-routed" : ""}`}>
        <section className="bx-card bx-directory">
          <header>
            <div>
              <h2>Block ledger <small>{rows.length} on this page</small></h2>
              <p>
                {withTxs ? "Blocks with transactions" : "All committed blocks"} · newest first{onHead ? " · live head" : ""}
                {!onHead && olderReady && older!.source === "indexer" && <span className="bx-archive-note"> · read through from the tx-indexer</span>}
              </p>
            </div>
            <div className="bx-ledger-actions">
              <button type="button" aria-pressed={!withTxs} onClick={() => { setWithTxs(false); resetPaging(); }}>All blocks</button>
              <button type="button" aria-pressed={withTxs} onClick={() => { setWithTxs(true); resetPaging(); }} title="Most gno.land blocks are empty">With transactions only</button>
            </div>
          </header>
          <div className="bx-table-scroll" tabIndex={0} role="region" aria-label="Block ledger">
            <table className="bx-table gx-table">
              <thead>
                <tr>
                  <th>Height</th>
                  <th>UTC time</th>
                  <th>Proposer</th>
                  <th className="gx-num">Txs</th>
                  <th className="gx-num" title="Cumulative chain transactions (excluding genesis)">Total txs</th>
                  <th className="gx-num" title="Validators that precommitted / validators in the set">Signatures</th>
                  <th><span className="bx-action-label">Inspect</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((block) => (
                  <tr key={block.height} className={block.height === picked?.height ? "selected" : ""} onClick={() => pick(block.height)}>
                    <td><a className="bx-height" href={blockRoute(block.height)} onClick={(e) => e.stopPropagation()} aria-current={block.height === picked?.height ? "true" : undefined}>{fmt(block.height)}</a></td>
                    <td title={new Date(block.time).toUTCString()}><span>{utcTime(block.time)}</span><small className="bx-ledger-age"><Timestamp value={block.time} /></small></td>
                    <td><Proposer block={block} size={22} /></td>
                    <td className={`gx-num ${block.tx_count ? "gx-has-txs" : "gx-zero"}`}>{fmt(block.tx_count)}</td>
                    <td className="gx-num gx-zero">{fmt(block.total_txs)}</td>
                    <td className="gx-num"><SigBadge block={block} /></td>
                    <td>
                      <button
                        className="bx-inspect-button"
                        type="button"
                        aria-label={`Open block ${block.height} inspector`}
                        onClick={(event) => {
                          event.stopPropagation();
                          pick(block.height);
                          document.querySelector(".bx-inspector")?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
                        }}
                      >›</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="bx-empty">
                      {onHead
                        ? loading || (withTxs && headTxBlocks === null) ? "Loading indexed blocks…" : error ?? (withTxs ? "No blocks with transactions yet." : "No blocks indexed yet.")
                        : olderError ?? (olderReady ? "No older blocks." : "Loading older blocks…")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer>
            <span>{rows.length ? `#${fmt(rows[0]!.height)} – #${fmt(lowest)}` : "0 blocks"}{d.net?.signature_floor != null ? ` · signatures read down to #${fmt(d.net.signature_floor)}` : ""}</span>
            <nav aria-label="Block pages">
              <button type="button" aria-label="Newest blocks" disabled={onHead} onClick={resetPaging}>«</button>
              <button type="button" aria-label="Newer block page" disabled={onHead} onClick={() => setCursors((c) => c.slice(0, -1))}>‹</button>
              <button type="button" aria-current="page" aria-label={`Block page ${cursors.length + 1}`}>{cursors.length + 1}</button>
              <button type="button" aria-label="Older block page" disabled={!canOlder} onClick={() => lowest !== null && setCursors((c) => [...c, lowest])}>›</button>
            </nav>
            <label>
              Rows{" "}
              <select aria-label="Blocks per page" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); resetPaging(); }}>
                {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </footer>
        </section>

        <BlockInspector
          detail={detail}
          id={targetId}
          chainHead={chainHead}
          onSelect={pick}
          copied={copied}
          onCopy={copy}
          tab={tab}
          setTab={setTab}
          signatureFloor={d.net?.signature_floor ?? null}
        />
      </div>

      <BlockAnalytics rows={rows} detail={detail} onSelect={pick} />

      <div className="bx-footnote">
        <span>GNO.LAND / CHAIN HISTORY / {d.net?.chain_id ?? "gnoland-1"}</span>
        <span>Full history since genesis · Tendermint2 instant finality</span>
      </div>
    </div>
  );
}

function Proposer({ block: b, size }: { block: Pick<Block, "proposer" | "proposer_moniker">; size: number }) {
  const label = b.proposer_moniker ?? short(b.proposer);
  return (
    <div className="bx-proposer">
      <Identicon address={b.proposer} size={size} />
      <a href={`#/validators/${b.proposer}`} onClick={(event) => event.stopPropagation()} title={`${b.proposer_moniker ?? "Unknown validator"}\n${b.proposer}`}>{label}</a>
    </div>
  );
}

function SigBadge({ block }: { block: Pick<Block, "signed" | "missed"> }) {
  const tone = sigTone(block);
  return (
    <span
      className={`gx-sig-badge ${tone}`}
      title={tone === "unknown" ? "Signatures not read for this block (they arrive with the next block's commit and are read for recent heights)" : `${block.signed} signed · ${block.missed ?? 0} missed`}
    >
      {signatures(block)}
    </span>
  );
}

function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    cube: "m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5",
    pulse: "M2 12h4l3-8 5 16 3-8h5",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10c.3-4 2.6-6 7-6s6.7 2 7 6M17 3.5a4 4 0 0 1 0 7.5M19 15c1.8.7 2.8 2.6 3 6",
    shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4",
    archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.cube} />
    </svg>
  );
}

function LiveBadge({ live = true }: { live?: boolean }) {
  return <span className={`bx-live ${live ? "" : "paused"}`}><i />{live ? "Live" : "Paused"}</span>;
}

/* ── inspector ──────────────────────────────────────────────────────────── */

type InspectorProps = {
  detail?: Detail;
  id: string | null;
  chainHead?: number;
  onSelect: (id: number | string) => void;
  copied: string | null;
  onCopy: (value: string) => void;
  tab: "Overview" | "Transactions" | "Raw JSON";
  setTab: (tab: "Overview" | "Transactions" | "Raw JSON") => void;
  signatureFloor: number | null;
};

function BlockInspector({ detail, id, chainHead, onSelect, copied, onCopy, tab, setTab, signatureFloor }: InspectorProps) {
  const data = detail?.data ?? null;
  const b = data?.block;
  const txs = data?.txs ?? [];
  const names = data?.names ?? {};
  const totals = txTotals(txs);
  const hasNext = b !== undefined && chainHead !== undefined && b.height < chainHead;
  const title = b ? `#${fmt(b.height)}` : id === null ? "Select a block" : /^\d+$/.test(id) ? `#${fmt(Number(id))}` : middle(id, 8, 6);
  return (
    <aside className="bx-card bx-inspector" aria-label="Block inspector">
      <header>
        <div>
          <span className="bx-inspector-kicker">Block inspector</span>
          <h2>{title}</h2>
        </div>
        <div className="bx-inspector-state">
          {b && <span className="bx-finalized"><i />Committed</span>}
          {b && <small><Timestamp value={b.time} /> · {utcTime(b.time)} UTC</small>}
          {b && (
            <span className="bx-inspector-nav">
              <button type="button" disabled={b.height <= 0} onClick={() => onSelect(b.height - 1)} aria-label="Previous block">‹ Prev</button>
              <button type="button" disabled={!hasNext} onClick={() => onSelect(b.height + 1)} aria-label="Next block">Next ›</button>
            </span>
          )}
        </div>
      </header>
      {!b ? (
        <p className="bx-empty">{detail?.error ?? (detail?.loading || id !== null ? "Loading block…" : "Select a block to inspect it.")}</p>
      ) : (
        <>
          <nav className="bx-tabs" aria-label="Block detail tabs">
            {(["Overview", "Transactions", "Raw JSON"] as const).map((value) => (
              <button type="button" key={value} onClick={() => setTab(value)} aria-pressed={tab === value}>
                {value}{value === "Transactions" ? ` (${fmt(b.tx_count)})` : ""}
              </button>
            ))}
          </nav>
          <div className="bx-detail-metrics">
            {[
              ["Transactions", fmt(b.tx_count)],
              ["Signatures", signatures(b)],
              ["Fees", txs.length ? gnot(totals.fees, 6) : b.tx_count ? "—" : "0 GNOT"],
              ["Proposer", b.proposer_moniker ?? short(b.proposer)],
            ].map(([label, val]) => (
              <div key={label}><span>{label}</span><strong title={val}>{val}</strong></div>
            ))}
          </div>
          <SignaturesPanel b={b} missed={data!.missed} signatureFloor={signatureFloor} />
          <div className="bx-detail-body">
            {tab === "Overview" && (
              <>
                <div className="bx-public-header">
                  <h3>Block header</h3>
                  <button type="button" onClick={() => onCopy(JSON.stringify(b, null, 2))}>{copied?.startsWith('{\n  "height"') ? "Copied ✓" : "Copy values ↗"}</button>
                </div>
                <dl className="bx-fields">
                  <Field label="Height"><span>{fmt(b.height)}</span></Field>
                  <Field label="Block hash" copyValue={b.hash || null} copied={copied} onCopy={onCopy}>
                    {b.hash ? <span title={b.hash}>{middle(b.hash, 12, 8)}</span> : <span>— (genesis)</span>}
                  </Field>
                  <Field label="Time (UTC)"><span>{utcDateTime(b.time)}</span></Field>
                  <Field label="Proposer"><Proposer block={b} size={18} /></Field>
                  <Field label="Proposer address" copyValue={b.proposer} copied={copied} onCopy={onCopy}>
                    <a href={`#/validators/${b.proposer}`} title={b.proposer}>{middle(b.proposer, 10, 6)}</a>
                  </Field>
                  <Field label="Transactions"><span>{fmt(b.tx_count)}</span></Field>
                  <Field label="Total chain txs"><span>{fmt(b.total_txs)}</span></Field>
                  <Field label="App hash" copyValue={b.app_hash} copied={copied} onCopy={onCopy}>
                    {b.app_hash ? <span title={b.app_hash}>{middle(b.app_hash, 12, 8)}</span> : <span>—</span>}
                  </Field>
                  {txs.length > 0 && (
                    <>
                      <Field label="Gas used / wanted"><span title={`${fmt(totals.gasUsed)} / ${fmt(totals.gasWanted)}`}>{fmt(totals.gasUsed)} / {fmt(totals.gasWanted)}{totals.gasWanted ? ` · ${pct((totals.gasUsed / totals.gasWanted) * 100)}` : ""}</span></Field>
                      <Field label="Fees paid"><span>{gnot(totals.fees, 6)}</span></Field>
                      <Field label="Failed transactions"><span>{fmt(totals.failed)}</span></Field>
                    </>
                  )}
                </dl>
                {b.height === 0 && <p className="bx-muted">Height 0 holds the genesis transactions ({fmt(b.tx_count)}): the packages and calls the chain started with.</p>}
                <Continuity b={b} hasNext={hasNext} onSelect={onSelect} />
              </>
            )}
            {tab === "Transactions" && <BlockTxs b={b} txs={txs} names={names} />}
            {tab === "Raw JSON" && (
              <>
                <p className="bx-muted">Block record as reported by the explorer API{data!.source === "indexer" ? " (read through from the tx-indexer)" : ""}.</p>
                <pre className="bx-raw-json">{JSON.stringify({ source: data!.source, block: b, missed: data!.missed, txs: txs.map((t) => t.hash) }, null, 2)}</pre>
              </>
            )}
          </div>
          {data!.source === "indexer" ? (
            <div className="bx-visibility"><Glyph name="archive" /><span><strong>Via tx-indexer</strong> · This block is newer than the indexed head and was read through from the tx-indexer.</span></div>
          ) : (
            <div className="bx-visibility"><Glyph name="shield" /><span><strong>Final</strong> · Tendermint2 commits each block with more than ⅔ of the voting power; committed blocks cannot be reorganized.</span></div>
          )}
        </>
      )}
    </aside>
  );
}

function Field({ label, children, copyValue, copied, onCopy }: { label: string; children: ReactNode; copyValue?: string | null; copied?: string | null; onCopy?: (v: string) => void }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {copyValue && onCopy && <CopyButton value={copyValue} copied={copied === copyValue} onCopy={onCopy} />}
      </dd>
    </div>
  );
}

function SignaturesPanel({ b, missed, signatureFloor }: { b: Block; missed: BlockDetail["missed"]; signatureFloor: number | null }) {
  const n = setSize(b);
  if (n === null)
    return (
      <section className="bx-participation gx-signatures">
        <header><h3>Precommit signatures</h3><span className="gx-sig unknown">not read</span></header>
        <p>
          {signatureFloor !== null && b.height < signatureFloor
            ? `Signatures are read for heights from #${fmt(signatureFloor)} onward; this block is older.`
            : "A block's precommits arrive in the next block's commit; they appear here once that block is indexed."}
        </p>
      </section>
    );
  const signed = b.signed ?? 0;
  return (
    <section className="bx-participation gx-signatures">
      <header>
        <h3>Precommit signatures</h3>
        <span className={`gx-sig ${sigTone(b)}`}>{signed}/{n} signed{missed.length ? ` · ${missed.length} missed` : ""}</span>
      </header>
      <span className="gx-sig-strip" role="img" aria-label={`${signed} of ${n} validators signed`}>
        {Array.from({ length: n }, (_, i) => <i key={i} className={i < signed ? "signed" : "missed"} />)}
      </span>
      {missed.length > 0 ? (
        <ul className="gx-missed">
          {missed.map((m) => (
            <li key={m.validator}>
              <Identicon address={m.validator} size={16} />
              <a href={`#/validators/${m.validator}`} title={m.validator}>{m.moniker ?? short(m.validator)}</a>
              <small>missed</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>Every validator in the set precommitted this block.</p>
      )}
    </section>
  );
}

function BlockTxs({ b, txs, names }: { b: Block; txs: BlockDetail["txs"]; names: Names }) {
  if (!txs.length) return <p className="bx-muted">{b.tx_count === 0 ? "This block contains no transactions." : "No transactions returned for this block."}</p>;
  return (
    <div className="bx-transactions gx-txs">
      {txs.map((tx) => {
        const signerName = tx.signer ? names[tx.signer] : undefined;
        return (
          <a href={txHref(tx.hash)} key={tx.hash} title={tx.hash}>
            <span>
              <strong>{txSummary(tx)}</strong>
              <small>
                #{tx.tx_index} · {short(tx.hash)} · {tx.signer ? (signerName ? `@${signerName}` : short(tx.signer)) : "—"}
              </small>
              <small className="gx-tx-gas">
                gas {fmt(tx.gas_used)} / {fmt(tx.gas_wanted)} · fee {coinText(tx.fee, tx.fee_denom)}
                {tx.kinds.length > 1 ? ` · ${tx.kinds.length} msgs` : ""}
              </small>
            </span>
            <span className={tx.success ? "bx-success" : "bx-notice"} title={tx.error ?? undefined}>{tx.success ? "Success" : "Failed"}</span>
            <span aria-hidden="true">↗</span>
          </a>
        );
      })}
      {txs.some((t) => t.signer) && (
        <p className="bx-muted">
          Signer is the first message's caller / sender / creator.{" "}
          {txs[0]?.signer && <a href={addrHref(txs[0].signer)}>Open the first signer's account →</a>}
        </p>
      )}
    </div>
  );
}

function Continuity({ b, hasNext, onSelect }: { b: Block; hasNext: boolean; onSelect: (id: number) => void }) {
  const nodes = [
    { label: "Previous", height: b.height - 1, enabled: b.height > 0, note: "No parent" },
    { label: "Selected", height: b.height, enabled: false, note: "" },
    { label: "Next", height: b.height + 1, enabled: hasNext, note: "Waiting for next block" },
  ];
  return (
    <section className="bx-continuity">
      <header><h3>Chain navigation</h3><span>previous ← block → next</span></header>
      <div className="bx-continuity-track">
        {nodes.map((node) => (
          <button type="button" key={node.label} className={node.label === "Selected" ? "selected" : ""} disabled={!node.enabled} onClick={() => onSelect(node.height)}>
            <span>{node.label}</span>
            <code>{node.enabled || node.label === "Selected" ? `#${fmt(node.height)}` : "—"}</code>
            <small>{node.enabled || node.label === "Selected" ? (node.label === "Selected" ? "Inspecting" : "Open") : node.note}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── analytics ──────────────────────────────────────────────────────────── */

const KIND_COLORS: Record<string, string> = {
  "vm/exec": "var(--brand)",
  "bank/send": "var(--ok)",
  "vm/add_package": "var(--warn)",
  "vm/run": "var(--brand2)",
};

function BlockAnalytics({ rows, detail, onSelect }: { rows: Block[]; detail?: Detail; onSelect: (id: number | string) => void }) {
  const data = detail?.data ?? null;
  const kinds = data ? kindCounts(data.txs) : [];
  const totalKinds = kinds.reduce((a, k) => a + k.n, 0);
  const proposers = proposerCounts(rows);
  const maxP = Math.max(1, ...proposers.map((p) => p.n));
  const signalled = rows.filter((r) => (r.missed ?? 0) > 0 || r.tx_count > 0).slice(0, 30);
  return (
    <div className="bx-analytics bx-chain-analytics gx-analytics">
      <Analytic title="Message kinds" subtitle={data ? `Block #${fmt(data.block.height)}` : "Select a block"} icon="cube">
        {!data ? (
          <p className="bx-muted">{detail?.error ?? "Loading the selected block…"}</p>
        ) : !totalKinds ? (
          <p className="bx-muted">This block contains no transactions.</p>
        ) : (
          <>
            <div className="bx-message-distribution" role="img" aria-label={kinds.map((k) => `${kindLabel(k.kind)}: ${k.n}`).join(", ")}>
              {kinds.map((k) => <i key={k.kind} title={`${kindLabel(k.kind)}: ${k.n}`} style={{ flex: k.n, background: KIND_COLORS[k.kind] ?? "var(--tx3)" }} />)}
            </div>
            <ul className="bx-message-legend">
              {kinds.map((k) => (
                <li key={k.kind}><i style={{ background: KIND_COLORS[k.kind] ?? "var(--tx3)" }} /><span>{kindLabel(k.kind)}</span><strong>{fmt(k.n)} · {pct((k.n / totalKinds) * 100, 0)}</strong></li>
              ))}
            </ul>
            <p className="bx-muted">Counted per message across {fmt(data.txs.length)} transaction{data.txs.length === 1 ? "" : "s"}.</p>
          </>
        )}
      </Analytic>
      <Analytic title="Proposers on this page" subtitle={`${fmt(rows.length)} blocks · equal voting power`} icon="users">
        {!proposers.length ? (
          <p className="bx-muted">No blocks on this page.</p>
        ) : (
          <ul className="gx-proposers">
            {proposers.map((p) => (
              <li key={p.proposer}>
                <a href={`#/validators/${p.proposer}`} title={p.proposer}><Identicon address={p.proposer} size={16} /><span>{p.moniker ?? short(p.proposer)}</span></a>
                <i><b style={{ width: `${(p.n / maxP) * 100}%` }} /></i>
                <strong>{fmt(p.n)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Analytic>
      <Analytic title="Block signals" subtitle="Transactions and missed signatures on this page" icon="pulse">
        <div className="bx-events">
          {signalled.map((block) => {
            const warn = (block.missed ?? 0) > 0;
            return (
              <button type="button" key={block.height} onClick={() => onSelect(block.height)}>
                <i className={warn ? "warn" : ""} />
                <span>#{fmt(block.height)}</span>
                <strong>{warn ? `${block.missed} missed signature${block.missed === 1 ? "" : "s"}${block.tx_count ? ` · ${fmt(block.tx_count)} tx` : ""}` : `${fmt(block.tx_count)} tx · ${signatures(block)} signed`}</strong>
                <small><Timestamp value={block.time} /></small>
              </button>
            );
          })}
          {!signalled.length && <p className="bx-muted">No transactions or missed signatures in these blocks.</p>}
        </div>
      </Analytic>
    </div>
  );
}

function Analytic({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon: string; children: ReactNode }) {
  return (
    <section className="bx-card bx-analytic">
      <header><Glyph name={icon} /><div><h3>{title}</h3>{subtitle && <small>{subtitle}</small>}</div></header>
      {children}
    </section>
  );
}
