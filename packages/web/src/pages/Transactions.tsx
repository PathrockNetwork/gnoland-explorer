/** gno.land transaction feed, transaction inspector, and address (account) pages. */
import { useEffect, useRef, useState } from "react";
import { preferredScrollBehavior } from "../appearance";
import { ApiError, getAddress, getAddressTokens, getTransaction, getTransactions, type AddressInfo, type AddressTokens, type Names, type Tx, type TxDetail } from "../api";
import { AddressOverview, AddressTokenBalances, AddressTransfers } from "../components/AddressInsights";
import { AddrLink, EventList, MessageView, TokenTransferList, useTokenIndex } from "../components/MessageView";
import { Timestamp } from "../components/Timestamp";
import { Chip, CopyButton, Skeleton } from "../components/ui";
import { addrHref, blockHref, bytes, coinText, fmt, gnot, gnowebHref, kindLabel, middle, pct, pts, txSummary } from "../lib";
import type { Dashboard } from "../useDashboard";
import {
  addressFromHash, compactAddrs, gasEfficiency, kindFilters, kindTone, sameHash, searchTarget, txCursor, txHashFromHash, txHaystack, txRoute, type KindFilter,
} from "../transactionExplorer";
import "./transactions.css";

const PAGE = 100;

export function Transactions({ d, live }: { d: Dashboard; live: boolean }) {
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [names, setNames] = useState<Names>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [open, setOpen] = useState<string | null>(() => txHashFromHash(window.location.hash));
  /** Address whose history is shown (#/transactions/address/<g1…>), else the live feed. */
  const [address, setAddress] = useState<string | null>(() => addressFromHash(window.location.hash));
  /** Older pages fetched with "Load older". While any are loaded the newest page stops refreshing, so the list stays contiguous. */
  const [older, setOlder] = useState<Tx[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reload, setReload] = useState(0);
  const [addrTab, setAddrTab] = useState<"transactions" | "transfers">("transactions");
  const [info, setInfo] = useState<AddressInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  const [tokens, setTokens] = useState<AddressTokens | null>(null);
  const [tokensError, setTokensError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const initialized = useRef(false);
  const frozen = useRef(false);
  frozen.current = older.length > 0;
  const inspector = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      const next = addressFromHash(window.location.hash);
      setAddress(next);
      if (!next) setOpen(txHashFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    setKind("");
    setFailedOnly(false);
    setQuery("");
    if (address) {
      initialized.current = false;
      setOpen(null);
      setAddrTab("transactions");
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    frozen.current = false;
    setLoading(true);
    setOlder([]);
    setCursor(null);
    setPage(1);
    const load = async () => {
      if (frozen.current) return;
      try {
        const result = await getTransactions(PAGE, { address: address ?? undefined, kind: kind || undefined, failed: failedOnly || undefined });
        if (cancelled || frozen.current) return;
        setTransactions(result.txs);
        setNames((old) => ({ ...old, ...result.names }));
        setError(null);
        setLoading(false);
        const last = result.txs[result.txs.length - 1];
        setCursor(result.txs.length >= PAGE && last ? txCursor(last) : null);
        if (!initialized.current && result.txs.length && !address) {
          initialized.current = true;
          setOpen((current) => current ?? result.txs[0]!.hash);
        }
      } catch {
        if (!cancelled) {
          setError(address ? "This address history is temporarily unavailable." : "The transaction feed is temporarily unavailable.");
          setLoading(false);
        }
      }
    };
    void load();
    const timer = live ? window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000) : undefined;
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [live, address, kind, failedOnly, reload]);

  useEffect(() => {
    if (!address) { setInfo(null); setTokens(null); return; }
    let cancelled = false;
    setInfo(null); setInfoError(false); setTokens(null); setTokensError(false);
    const load = () => getAddress(address).then((r) => { if (!cancelled) { setInfo(r); setInfoError(false); if (r.username) setNames((o) => ({ ...o, [address]: r.username! })); } }).catch(() => { if (!cancelled) setInfoError(true); });
    void load();
    getAddressTokens(address).then((r) => { if (!cancelled) setTokens(r); }).catch(() => { if (!cancelled) setTokensError(true); });
    const timer = live ? window.setInterval(load, 30_000) : undefined;
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [address, live]);

  const loadOlder = async () => {
    if (cursor === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await getTransactions(PAGE, { address: address ?? undefined, kind: kind || undefined, failed: failedOnly || undefined, before: cursor });
      setOlder((rows) => [...rows, ...result.txs]);
      setNames((old) => ({ ...old, ...result.names }));
      const last = result.txs[result.txs.length - 1];
      setCursor(result.txs.length >= PAGE && last ? txCursor(last) : null);
    } catch { setError("Older transactions could not be loaded."); }
    finally { setLoadingOlder(false); }
  };
  const backToNewest = () => { setOlder([]); setPage(1); setReload((n) => n + 1); };
  const rows = [...new Map([...transactions, ...older].map((tx) => [tx.hash, tx])).values()];

  const onCopy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied((current) => current === value ? null : current), 2000); } catch { /* Leave the selectable value visible when clipboard access is unavailable. */ }
  };
  const inspect = (hash: string) => {
    initialized.current = true; setOpen(hash);
    if (!address) window.history.replaceState(null, "", txRoute(hash));
    if (window.innerWidth < 1800) requestAnimationFrame(() => inspector.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" }));
  };

  const q = query.trim().toLowerCase().replace(/^@/, "");
  const shown = q ? rows.filter((tx) => txHaystack(tx, names, txSummary(tx)).includes(q)) : rows;
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * perPage;
  const visible = shown.slice(start, start + perPage);

  const successful = rows.filter((tx) => tx.success).length;
  const fees = rows.flatMap((tx) => (/^\d+$/.test(tx.fee) && tx.fee !== "0" && (tx.fee_denom ?? "ugnot") === "ugnot" ? [BigInt(tx.fee)] : []));
  const averageFee = fees.length ? fees.reduce((s, v) => s + v, 0n) / BigInt(fees.length) : null;
  const feeSeries = fees.slice(0, 40).reverse().map((v) => Number(v));
  const gasUsed = rows.reduce((s, tx) => s + tx.gas_used, 0);
  const gasWanted = rows.reduce((s, tx) => s + tx.gas_wanted, 0);
  const efficiency = gasEfficiency(gasUsed, gasWanted);
  const minutes = d.net?.recent_minutes.slice(-24).map((m) => m.txs) ?? [];
  const unavailable = loading || (!rows.length && !!error);

  // A full address, hash or height in the filter box reaches beyond the loaded rows.
  const target = searchTarget(query);
  const jump = target?.kind === "address" && target.address !== address ? target
    : target?.kind === "transaction" && !rows.some((tx) => sameHash(tx.hash, target.hash)) ? target
    : target?.kind === "block" && !rows.some((tx) => tx.height === target.height) ? target : null;
  const followJump = () => {
    if (!jump) return;
    setQuery(""); setPage(1);
    if (jump.kind === "address") window.location.hash = addrHref(jump.address).slice(1);
    else if (jump.kind === "block") window.location.hash = blockHref(jump.height).slice(1);
    else inspect(jump.hash);
  };
  const activeFilters = !!kind || failedOnly || !!query;
  const clearFilters = () => { setKind(""); setFailedOnly(false); setQuery(""); setPage(1); };
  const cols = 9;
  const username = info?.username ?? (address ? names[address] : null);

  return <div className="txe-page">
    <div className="txe-workspace">
      <div className="txe-primary">
        {address && <section className="txe-card txe-address" aria-label="Address">
          <div>
            <span>Address{info?.validator ? " · validator" : ""}</span>
            {username && <b className="txe-username">@{username}</b>}
            <strong title={address}>{address}</strong>
          </div>
          <CopyButton value={address} copied={copied === address} onCopy={onCopy} size={26} />
          {username && <a href={`https://gno.land/u/${username}`} target="_blank" rel="noreferrer">gno.land/u/{username} ↗</a>}
          <a href="#/transactions">Back to all transactions</a>
        </section>}
        {address && <AddressOverview info={info} failed={infoError} />}
        {address && <AddressTokenBalances data={tokens} failed={tokensError} />}
        <div className="txe-kpis">
          {address
            ? <Stat icon="transactions" label="Address transactions" value={info ? fmt(info.txs) : "—"} note={info ? `${fmt(info.sent)} signed by this address · since genesis` : "Every transaction mentioning this address"}>
                <div className="txe-stat-meter"><i style={{ width: `${info && info.txs ? (info.sent / info.txs) * 100 : 0}%`, background: "var(--brand)" }} /></div>
              </Stat>
            : <Stat icon="transactions" label="Transactions · 24h" value={d.net ? fmt(d.net.txs_24h) : "—"} note={d.net?.total_txs != null ? `${fmt(d.net.total_txs)} since genesis (excl. the genesis set)` : "Chain-wide count"}>
                <div className="txe-mini-bars" role="img" aria-label="Transactions per minute, last 24 minutes">{minutes.map((count, i) => <i key={i} style={{ height: `${(count / Math.max(1, ...minutes)) * 100}%` }} title={`${count} txs`} />)}</div>
              </Stat>}
          <Stat icon="success" label="Successful" value={unavailable || !rows.length ? "—" : pct((successful / rows.length) * 100)} note={`${fmt(successful)} of ${fmt(rows.length)} loaded transactions`}>
            <div className="txe-stat-meter success"><i style={{ width: `${rows.length ? (successful / rows.length) * 100 : 0}%` }} /></div>
          </Stat>
          <Stat icon="fee" label="Average fee" value={unavailable || averageFee === null ? "—" : gnot(averageFee.toString(), 4)} note={fees.length ? `Total fee per tx over ${fmt(fees.length)} loaded transactions` : "No fee data loaded"}>
            {feeSeries.length > 1 && <svg className="txe-fee-chart" viewBox="0 0 180 24" preserveAspectRatio="none" role="img" aria-label="Fees of the loaded transactions, oldest to newest"><polyline points={pts(feeSeries, 180, 22, 0, Math.max(...feeSeries) || 1)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
          </Stat>
          <Stat icon="gas" label="Gas efficiency" value={unavailable || efficiency === null ? "—" : pct(efficiency)} note={rows.length ? `Gas used ÷ gas wanted · ${fmt(rows.length)} loaded transactions` : "Gas used ÷ gas wanted"}>
            <div className="txe-stat-meter gas"><i style={{ width: `${efficiency ?? 0}%` }} /></div>
          </Stat>
        </div>
        <section className="txe-card txe-directory" aria-label={address ? "Address transactions" : "Recent transactions"}>
          {address && <div className="txe-address-tabs" role="tablist" aria-label="Address history">
            <button type="button" role="tab" aria-selected={addrTab === "transactions"} onClick={() => setAddrTab("transactions")}>Transactions{info ? ` (${fmt(info.txs)})` : ""}</button>
            <button type="button" role="tab" aria-selected={addrTab === "transfers"} onClick={() => setAddrTab("transfers")}>Token transfers{tokens ? ` (${tokens.transfers.length})` : ""}</button>
          </div>}
          {address && addrTab === "transfers" ? <AddressTransfers data={tokens} failed={tokensError} address={address} names={names} onInspect={inspect} /> : <>
            <div className="txe-directory-top">
              <div className="txe-categories" aria-label="Filter by kind">{kindFilters.map((k) => <button type="button" key={k.id || "all"} aria-pressed={kind === k.id} onClick={() => { setKind(k.id); setPage(1); }}>{k.label}</button>)}</div>
              <label className="txe-toggle"><input type="checkbox" checked={failedOnly} onChange={(e) => { setFailedOnly(e.target.checked); setPage(1); }} />Failed only</label>
            </div>
            <div className="txe-toolbar">
              <label className="txe-search"><Glyph name="search" /><input aria-label="Search loaded transactions, or enter an address, hash or block" placeholder="Search hash, @user, realm, function, block…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} onKeyDown={(event) => { if (event.key === "Enter" && jump) { event.preventDefault(); followJump(); } }} />{jump && <button type="button" className="txe-search-jump" onClick={followJump}>{jump.kind === "address" ? "Address page" : jump.kind === "block" ? "Open block" : "Open transaction"} ↵</button>}</label>
            </div>
            <div className="txe-sample-note"><span>Kind and failed filters query the full index; the search box filters the loaded rows. Statistics cover the loaded rows.</span><span className={error ? "txe-warning" : ""}>{error ? "Feed unavailable" : older.length ? <>Updates paused while older pages are loaded · <button type="button" className="txe-inline-button" onClick={backToNewest}>Back to newest</button></> : live ? "Updates every 15s" : "Updates paused"}</span></div>
            {error && <div className="txe-notice" role="status">{error}{rows.length > 0 ? " Showing the last loaded rows." : " Please try again shortly."}</div>}
            <div className="txe-table-scroll" tabIndex={0} role="region" aria-label="Transaction results">
              <table className="txe-table">
                <thead><tr><th>#</th><th>Tx hash</th><th>Action</th><th>Block</th><th>Signer</th><th>Fee</th><th>Gas used / wanted</th><th>Age</th><th>Status</th></tr></thead>
                <tbody>
                  {loading ? Array.from({ length: 10 }, (_, i) => <tr key={i}><td colSpan={cols}><Skeleton h={22} w={`${95 - i * 3}%`} /></td></tr>) : visible.map((tx, i) => {
                    const sel = sameHash(open, tx.hash);
                    const eff = gasEfficiency(tx.gas_used, tx.gas_wanted);
                    return <tr key={tx.hash} className={sel ? "selected" : undefined} onClick={() => inspect(tx.hash)}>
                      <td>{start + i + 1}</td>
                      <td><button className="txe-hash" type="button" aria-label={`Inspect transaction ${tx.hash}`} aria-pressed={sel} onClick={(event) => { event.stopPropagation(); inspect(tx.hash); }}>{middle(tx.hash, 8, 4)}</button></td>
                      <td><span className={`txe-type ${kindTone(tx.kinds[0])}`}><Glyph name={kindTone(tx.kinds[0])} /><span title={tx.funcs.join("\n") || tx.pkg_paths.join("\n") || undefined}>{compactAddrs(txSummary(tx))}</span></span><small>{[...new Set(tx.kinds.map(kindLabel))].join(" · ")}{tx.kinds.length > 1 ? ` · ${tx.kinds.length} msgs` : ""}</small></td>
                      <td><a className="txe-address-link" href={blockHref(tx.height)} onClick={(event) => event.stopPropagation()}>{fmt(tx.height)}</a><small>#{tx.tx_index}</small></td>
                      <td><AddrLink address={tx.signer} names={names} current={address} /></td>
                      <td title={`${tx.fee} ${tx.fee_denom ?? "ugnot"}`}>{coinText(tx.fee, tx.fee_denom)}</td>
                      <td>{fmt(tx.gas_used)} / {fmt(tx.gas_wanted)}<small>{eff === null ? "—" : `${eff.toFixed(0)}% used`}</small></td>
                      <td title={tx.time}><Timestamp value={tx.time} /></td>
                      <td><Chip tone={tx.success ? "ok" : "bad"} title={tx.error ?? undefined}>{tx.success ? "Success" : "Failed"}</Chip></td>
                    </tr>;
                  })}
                  {!loading && !visible.length && <tr><td className="txe-empty" colSpan={cols}>{error ? "Transaction data is unavailable." : rows.length ? "No loaded transactions match this search." : address ? "No transactions match for this address." : "No transactions match these filters."}{jump && <button type="button" onClick={followJump}>{jump.kind === "address" ? "Open this address" : jump.kind === "block" ? "Open this block" : "Look up this transaction"}</button>}{activeFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</td></tr>}
                </tbody>
              </table>
            </div>
            {cursor !== null && currentPage >= pages && <button type="button" className="txe-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : `Load older transactions (before block ${fmt(Number(cursor.split(":")[0]))})`}</button>}
            <footer className="txe-footer"><span>{shown.length ? `${start + 1}–${Math.min(start + perPage, shown.length)} of ${fmt(shown.length)}` : "0"} loaded transactions{cursor !== null ? " · more available" : ""}</span>
              <nav aria-label="Transaction pages"><button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage} / {pages}</span><button type="button" aria-label="Next page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>›</button></nav>
              <label>Rows <select aria-label="Transactions per page" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            </footer>
          </>}
        </section>
      </div>
      <div className="txe-inspector-column" ref={inspector}>
        {open ? <TxDetailPanel key={open} hash={open} copied={copied} onCopy={onCopy} onClose={() => { initialized.current = true; setOpen(null); if (!address) window.history.replaceState(null, "", "#/transactions"); }} />
          : <aside className="txe-card txe-inspector-placeholder"><Glyph name="transactions" /><h2>Transaction inspector</h2><p>Select a transaction to see its messages, token transfers, events and storage changes.</p><div><Glyph name="block" />Indexed from gno.land since genesis.</div></aside>}
      </div>
    </div>
  </div>;
}

function Stat({ icon, label, value, note, children }: { icon: string; label: string; value: string; note: string; children: React.ReactNode }) {
  return <section className={`txe-card txe-stat ${icon}`}><div className="txe-stat-label"><Glyph name={icon} /><span>{label}</span></div><strong>{value}</strong><span className="txe-stat-note">{note}</span><div className="txe-stat-chart">{children}</div></section>;
}

type DetailTab = "overview" | "events" | "raw";

function TxDetailPanel({ hash, copied, onCopy, onClose }: { hash: string; copied: string | null; onCopy: (v: string) => void; onClose: () => void }) {
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<DetailTab>("overview");
  const tokens = useTokenIndex();
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getTransaction(hash).then((result) => { if (!cancelled) setDetail(result); }).catch((e) => { if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? "Transaction not found in the index or the tx-indexer." : e instanceof ApiError && e.status === 400 ? "This is not a valid transaction hash." : "This transaction could not be loaded."); });
    return () => { cancelled = true; };
  }, [hash, retry]);
  const tx = detail?.tx;
  const fullHash = tx?.hash ?? hash;
  const names = detail?.names ?? {};
  const status = !tx ? null : tx.success ? <Chip tone="ok">Success</Chip> : <Chip tone="bad">Failed</Chip>;
  const eff = tx ? gasEfficiency(tx.gas_used, tx.gas_wanted) : null;
  const deposits = detail?.events.filter((e) => e.kind === "storage_deposit") ?? [];
  const unlocks = detail?.events.filter((e) => e.kind === "storage_unlock") ?? [];
  const sum = (xs: typeof deposits) => xs.reduce((s, e) => s + (e.amount && /^\d+$/.test(e.amount) ? BigInt(e.amount) : 0n), 0n);
  const locked = sum(deposits), refunded = sum(unlocks);
  const callRealm = tx?.messages.find((m) => m.kind === "MsgCall")?.value.pkg_path as string | undefined;
  const tabs: [DetailTab, string][] = detail ? [["overview", `Overview${tx && tx.messages.length > 1 ? ` · ${tx.messages.length} messages` : ""}`], ["events", `Events (${detail.events.length})`], ["raw", "Raw"]] : [];
  return <>
    <aside className="txe-card txe-inspector" aria-label="Transaction inspector">
      <header><div><h2><Glyph name="transactions" />Transaction</h2><div className="txe-selected-hash"><strong title={fullHash}>{middle(fullHash, 10, 8)}</strong><CopyButton value={fullHash} copied={copied === fullHash} onCopy={onCopy} size={26} /></div></div><button type="button" className="txe-close" onClick={onClose} aria-label="Close transaction">×</button></header>
      {error ? <div className="txe-empty" role="status">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : !detail || !tx ? <div className="txe-detail-loading"><Skeleton h={25} w="70%" /><Skeleton h={150} w="100%" /></div> : <>
        <div className="txe-detail-meta"><span title={tx.time}><Timestamp value={tx.time} /></span><a href={blockHref(tx.height)}>Block #{fmt(tx.height)}</a>{status}{tx.confirmations !== null && <span className="txe-final">{fmt(tx.confirmations)} confirmations</span>}{detail.source === "indexer" && <span className="txe-warning" title="Newer than the indexed head; read through from the tx-indexer">Not yet indexed</span>}</div>
        <div className="txe-detail-tabs" role="tablist" aria-label="Transaction details">{tabs.map(([value, text]) => <button key={value} id={`txe-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="txe-detail-content" onClick={() => setTab(value)}>{text}</button>)}</div>
        <div className="txe-detail-content" id="txe-detail-content" role="tabpanel" aria-labelledby={`txe-tab-${tab}`}>
          {tab === "overview" && <>
            {!tx.success && <div className="txe-error-note" role="status"><Glyph name="failed" /><div><strong>Transaction failed</strong><p>{tx.error ?? "No error message was recorded."}</p></div></div>}
            <dl className="txe-facts">
              <Fact label="Status">{status}</Fact>
              <Fact label="Block · position"><a className="txe-address-link" href={blockHref(tx.height)}>#{fmt(tx.height)}</a><span className="txe-muted-inline">· tx #{tx.tx_index}</span></Fact>
              <Fact label="Time (UTC)">{new Date(tx.time).toISOString().replace("T", " ").replace(/\.\d+Z$/, "")}</Fact>
              <Fact label="Confirmations">{tx.confirmations === null ? "—" : fmt(tx.confirmations)}</Fact>
              <Fact label="Signer">{tx.signer ? <><AddrLink address={tx.signer} names={names} head={10} tail={6} /><CopyButton value={tx.signer} copied={copied === tx.signer} onCopy={onCopy} size={24} /></> : "—"}</Fact>
              <Fact label="Fee (total)"><span title={`${tx.fee} ${tx.fee_denom ?? "ugnot"}`}>{coinText(tx.fee, tx.fee_denom)}</span></Fact>
              <Fact label="Gas used / wanted">{fmt(tx.gas_used)} / {fmt(tx.gas_wanted)}</Fact>
              <Fact label="Gas efficiency"><span className="txe-eff">{eff === null ? "—" : pct(eff)}<i><b style={{ width: `${Math.min(100, eff ?? 0)}%` }} /></i></span></Fact>
              <Fact label="Storage delta">{tx.storage_delta === 0 && !deposits.length && !unlocks.length ? <span className="txe-muted-inline">No storage change</span> : <span className={tx.storage_delta > 0 ? "txe-up" : tx.storage_delta < 0 ? "txe-down" : undefined}>{tx.storage_delta > 0 ? "+" : ""}{bytes(tx.storage_delta)}</span>}</Fact>
              <Fact label="Storage deposit">{locked || refunded ? <>{locked > 0n && <span>{gnot(locked.toString(), 6)} locked</span>}{refunded > 0n && <span>{gnot(refunded.toString(), 6)} refunded</span>}</> : "—"}</Fact>
              <Fact label="Memo">{tx.memo ? <span className="txe-memo">{tx.memo}</span> : <span className="txe-muted-inline">—</span>}</Fact>
              <Fact label="Messages">{tx.messages.length} · {[...new Set(tx.kinds.map(kindLabel))].join(", ") || "—"}</Fact>
            </dl>
            {tx.messages.map((m, i) => <MessageView key={i} m={m} index={i} count={tx.messages.length} names={names} />)}
            {detail.token_transfers.length > 0 && <section className="txe-message"><h3>Token transfers · {detail.token_transfers.length}</h3><TokenTransferList transfers={detail.token_transfers} names={names} tokens={tokens} /></section>}
            {detail.events.length > 0 && <button type="button" className="txe-inline-button txe-events-link" onClick={() => setTab("events")}>View all {detail.events.length} events →</button>}
          </>}
          {tab === "events" && (detail.events.length ? <EventList events={detail.events} names={names} /> : <p className="txe-muted">This transaction emitted no events.</p>)}
          {tab === "raw" && <>
            <details className="txe-raw" open><summary>Result log</summary><pre className="txe-json">{tx.log || "(empty)"}</pre></details>
            <details className="txe-raw"><summary>API response (JSON)</summary><pre className="txe-json">{JSON.stringify(detail, null, 2)}</pre></details>
          </>}
        </div>
      </>}
    </aside>
    {tx && <section className="txe-card txe-related"><h3>Related</h3>
      <a href={blockHref(tx.height)}><Glyph name="block" /><span>View block #{fmt(tx.height)}</span><span>→</span></a>
      {tx.signer && <a href={addrHref(tx.signer)}><Glyph name="send" /><span>Signer history{names[tx.signer] ? ` · @${names[tx.signer]}` : ""}</span><span>→</span></a>}
      {callRealm && <a href={`#/realms/${callRealm}`}><Glyph name="call" /><span>Realm <PkgLinkText path={callRealm} /></span><span>→</span></a>}
      {callRealm && <a href={gnowebHref(callRealm)} target="_blank" rel="noreferrer"><Glyph name="link" /><span>Open realm on gnoweb</span><span>↗</span></a>}
      <button type="button" onClick={() => onCopy(`${location.origin}${location.pathname}${txRoute(fullHash)}`)}><Glyph name="link" /><span>{copied?.endsWith(txRoute(fullHash)) ? "Link copied" : "Copy transaction link"}</span><span>↗</span></button>
    </section>}
  </>;
}

function PkgLinkText({ path }: { path: string }) { return <>{path.replace(/^gno\.land\//, "")}</>; }
function Fact({ label, children }: { label: string; children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
export function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    transactions: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4", success: "m5 12 4 4L19 6", failed: "m6 6 12 12M6 18 18 6", fee: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12", search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5",
    token: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v10M9 9.5h6M9 14.5h6",
    gas: "M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M8 8h4M15 9l3 3v6a1.5 1.5 0 0 0 3 0V8l-3-3",
    call: "M8 6 3 12l5 6M16 6l5 6-5 6M13 4l-2 16", deploy: "M12 3v12m0-12-4 4m4-4 4 4M5 15v4h14v-4", run: "M7 4v16l13-8z", send: "M4 12h14m-5-6 6 6-6 6", other: "M12 5v14M5 12h14",
    block: "m12 3 9 5v9l-9 5-9-5V8l9-5M3 8l9 5 9-5M12 13v9", link: "m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.transactions} /></svg>;
}

