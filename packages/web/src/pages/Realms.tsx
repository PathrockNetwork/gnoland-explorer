/**
 * Realms & packages: the on-chain code directory and a per-package page
 * (render, source, functions, activity, events).
 *
 * Routes (everything after `#/realms/` is the package path):
 *   #/realms                              directory
 *   #/realms/gno.land/r/foo               package (render tab for realms)
 *   #/realms/gno.land/r/foo:bar?x=1       render of Render("bar?x=1")
 *   #/realms/gno.land/r/foo$source/x.gno  source tab, file x.gno
 *   #/realms/gno.land/r/foo$functions | $activity | $events
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import {
  getEvents, getNamespaces, getPackage, getPackageFile, getPackageFiles, getPackages, getRender, getTransactions,
  type EventFeed, type FuncSig, type Names, type Namespaces, type PackageDetail, type PackageList, type PackageRender,
  type PackageRow, type PackageSource, type Tx,
} from "../api";
import { addrHref, blockHref, bytes, fmt, gnot, gnowebHref, middle, pkgHref, shortPath, txHref, txSummary } from "../lib";
import { Chip, CopyButton, Skeleton, TimeSeriesChart } from "../components/ui";
import { Timestamp } from "../components/Timestamp";
import { Markdown, encodeArgs, renderRoute } from "../components/Markdown";
import { SourceView } from "../components/SourceView";
import "./realms.css";

type Tab = "render" | "source" | "functions" | "activity" | "events";
const TABS: Tab[] = ["render", "source", "functions", "activity", "events"];
type Route = { path: string | null; tab: Tab | null; args: string; file: string | null };

const safeDecode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export function parseRealmsRoute(hash: string): Route {
  const rest = hash.replace(/^#\/?realms\/?/, "");
  if (!rest) return { path: null, tab: null, args: "", file: null };
  const i = rest.search(/[:$]/);
  const path = safeDecode(i < 0 ? rest : rest.slice(0, i)).replace(/\/+$/, "");
  if (i < 0) return { path, tab: null, args: "", file: null };
  const tail = rest.slice(i + 1);
  if (rest[i] === ":") return { path, tab: "render", args: safeDecode(tail), file: null };
  const slash = tail.indexOf("/");
  const tabName = (slash < 0 ? tail : tail.slice(0, slash)) as Tab;
  const file = slash < 0 ? null : safeDecode(tail.slice(slash + 1)) || null;
  return { path, tab: TABS.includes(tabName) ? tabName : null, args: "", file };
}

const tabRoute = (path: string, tab: Tab, file?: string | null) =>
  tab === "render" ? renderRoute(path) : `#/realms/${path}$${tab}${file ? `/${encodeArgs(file)}` : ""}`;

/** Short path with long g1 address namespaces elided: "r/g1leu8d…95wr/adstation". */
export const displayPath = (p: string) => shortPath(p).replace(/g1[02-9ac-hj-np-z]{38}/g, (a) => `${a.slice(0, 7)}…${a.slice(-4)}`);

const dayLabel = (iso: string) =>
  new Date(Date.parse(iso) + 12 * 3600e3).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Realms({ d }: { d: Dashboard }) {
  const [route, setRoute] = useState<Route>(() => parseRealmsRoute(window.location.hash));
  useEffect(() => {
    const sync = () => setRoute(parseRealmsRoute(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return (
    <div className="rlm-page">
      {route.path ? <PackageView key={route.path} route={route as Route & { path: string }} onRoute={setRoute} /> : <Directory d={d} />}
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

export function Addr({ address, name, head = 8, tail = 5 }: { address: string | null | undefined; name?: string | null; head?: number; tail?: number }) {
  if (!address) return <span className="rlm-muted">—</span>;
  return (
    <a className="rlm-link" href={addrHref(address)} title={address}>
      {name ? `@${name}` : middle(address, head, tail)}
    </a>
  );
}

export function KindChip({ kind }: { kind: string }) {
  if (kind === "realm") return <Chip tone="brand" title="Realm: stateful package with its own storage">Realm</Chip>;
  if (kind === "pure") return <Chip tone="muted" title="Pure package: stateless library code">Pure</Chip>;
  return <Chip tone="muted">{kind}</Chip>;
}

export function StatusChip({ status }: { status?: string | null }) {
  if (!status || status === "live") return <Chip tone="ok" title="Deployed and callable">Live</Chip>;
  if (status === "inert") return <Chip tone="warn" title="Inert: uploaded, awaiting approval before it can be used">Inert</Chip>;
  if (status === "rejected") return <Chip tone="bad" title="Rejected by an approver">Rejected</Chip>;
  return <Chip tone="muted">{status}</Chip>;
}

export function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <section className="rlm-card rlm-tile">
      <span className="rlm-tile-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="rlm-tile-note">{note}</span>}
    </section>
  );
}

function Deployed({ height, time }: { height: number; time: string }) {
  return (
    <>
      {height === 0 ? <span title="Included in the genesis file">Genesis</span> : <a className="rlm-link" href={blockHref(height)}>{fmt(height)}</a>}
      <small><Timestamp value={time} /></small>
    </>
  );
}

/* ───────────────────────── directory ───────────────────────── */

type DirState = { q: string; kind: "" | "realm" | "pure"; sort: "recent" | "calls" | "storage" | "name"; offset: number; namespace: string };
const PAGE = 50;
/** Survives leaving for a package page and coming back. */
let dirMemo: DirState = { q: "", kind: "", sort: "recent", offset: 0, namespace: "" };

function Directory({ d }: { d: Dashboard }) {
  const [st, setSt] = useState<DirState>(dirMemo);
  const [qInput, setQInput] = useState(st.q);
  const [list, setList] = useState<PackageList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ns, setNs] = useState<Namespaces | null>(null);
  const [nsError, setNsError] = useState(false);
  const [nsAll, setNsAll] = useState(false);
  dirMemo = st;

  useEffect(() => {
    const t = window.setTimeout(() => setSt((s) => (s.q === qInput.trim() ? s : { ...s, q: qInput.trim(), offset: 0 })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPackages({ q: st.q || undefined, kind: st.kind || undefined, sort: st.sort, offset: st.offset, limit: PAGE, namespace: st.namespace || undefined })
      .then((r) => { if (!cancelled) { setList(r); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message || "Packages are unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [st.q, st.kind, st.sort, st.offset, st.namespace]);

  useEffect(() => {
    getNamespaces().then(setNs).catch(() => setNsError(true));
  }, []);

  const totals = list?.totals;
  const set = (p: Partial<DirState>) => setSt((s) => ({ ...s, offset: 0, ...p }));
  const total = list?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageNo = Math.floor(st.offset / PAGE) + 1;
  const nsRows = ns?.namespaces ?? [];

  return (
    <>
      <div className="rlm-tiles">
        <Tile label="Packages" value={totals ? fmt(totals.total) : "—"} note={d.net?.packages ? `${fmt(d.net.packages.deployed_24h)} deployed in the last 24 h` : "Realms and pure packages on chain"} />
        <Tile label="Realms" value={totals ? fmt(totals.realms) : "—"} note="gno.land/r/… · stateful, callable" />
        <Tile label="Pure packages" value={totals ? fmt(totals.pure) : "—"} note="gno.land/p/… · stateless libraries" />
        <Tile label="Creators" value={totals ? fmt(totals.creators) : "—"} note="Distinct deploying addresses" />
        <Tile label="Source size" value={totals ? bytes(totals.source_bytes) : "—"} note="All deployed files, tests included" />
      </div>

      <div className="rlm-dir-grid">
        <section className="rlm-card rlm-dir" aria-label="Package directory">
          <div className="rlm-tabs" role="tablist" aria-label="Package kind">
            {([["", "All"], ["realm", "Realms"], ["pure", "Pure packages"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={st.kind === k} onClick={() => set({ kind: k })}>{l}</button>
            ))}
          </div>
          <div className="rlm-toolbar">
            <label className="rlm-search">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3 3" /></svg>
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search package path, e.g. gnoswap or r/sys" aria-label="Search packages" />
            </label>
            <select aria-label="Sort packages" value={st.sort} onChange={(e) => set({ sort: e.target.value as DirState["sort"] })}>
              <option value="recent">Recently deployed</option>
              <option value="calls">Most called</option>
              <option value="storage">Most storage</option>
              <option value="name">Name</option>
            </select>
          </div>
          {st.namespace && (
            <div className="rlm-filter-note">
              Namespace <code>{shortPath(st.namespace)}</code>
              <button type="button" onClick={() => set({ namespace: "" })}>Clear</button>
            </div>
          )}
          {error && <div className="rlm-notice" role="status">{error}</div>}
          <div className="rlm-table-scroll" tabIndex={0} role="region" aria-label="Packages">
            <table className="rlm-table rlm-dir-table">
              <thead>
                <tr><th>Package</th><th>Kind</th><th>Status</th><th>Creator</th><th>Deployed</th><th className="num">Calls 24h</th><th className="num">Callers</th><th className="num">Storage</th><th className="num">Files</th></tr>
              </thead>
              <tbody>
                {loading && !list
                  ? Array.from({ length: 10 }, (_, i) => <tr key={i}><td colSpan={9}><Skeleton h={20} w={`${92 - i * 3}%`} /></td></tr>)
                  : list?.packages.map((p) => <DirRow key={p.path} p={p} />)}
                {!loading && list && !list.packages.length && (
                  <tr><td colSpan={9} className="rlm-empty">No packages match{st.q ? ` “${st.q}”` : ""}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="rlm-foot">
            <span>{total ? `${fmt(st.offset + 1)}–${fmt(Math.min(st.offset + PAGE, total))} of ${fmt(total)}` : "0"} packages{loading && list ? " · loading…" : ""}</span>
            <nav aria-label="Package pages">
              <button type="button" aria-label="Previous page" disabled={st.offset === 0} onClick={() => setSt((s) => ({ ...s, offset: Math.max(0, s.offset - PAGE) }))}>‹</button>
              <span>{pageNo} / {pages}</span>
              <button type="button" aria-label="Next page" disabled={st.offset + PAGE >= total} onClick={() => setSt((s) => ({ ...s, offset: s.offset + PAGE }))}>›</button>
            </nav>
          </footer>
        </section>

        <section className="rlm-card rlm-ns" aria-label="Namespaces">
          <header className="rlm-card-head">
            <h2>Namespaces</h2>
            <span className="rlm-muted">{nsRows.length ? `${fmt(nsRows.length)} shown` : ""}</span>
          </header>
          <p className="rlm-card-intro">A namespace is the segment after <code>r/</code> or <code>p/</code>: a registered <code>@username</code> or the deployer's own address.</p>
          {nsError ? <div className="rlm-empty">Namespaces are unavailable.</div> : !ns ? (
            <div className="rlm-pad"><Skeleton h={160} w="100%" /></div>
          ) : (
            <ul className="rlm-ns-list">
              {(nsAll ? nsRows : nsRows.slice(0, 15)).map((n) => {
                const prefix = `gno.land/${n.kind_letter}/${n.namespace}`;
                return (
                  <li key={prefix} className={st.namespace === prefix ? "active" : undefined}>
                    <button type="button" onClick={() => set({ namespace: st.namespace === prefix ? "" : prefix })} title={`Show packages under ${prefix}`}>
                      <span className="rlm-ns-path">{n.kind_letter}/{n.namespace.startsWith("g1") ? middle(n.namespace, 8, 4) : n.namespace}</span>
                      <span className="rlm-ns-n">{fmt(n.packages)}</span>
                    </button>
                    <span className="rlm-ns-owner">{n.owner ? <>owner <Addr address={n.owner} name={n.namespace.startsWith("g1") ? null : n.namespace} head={6} tail={4} /></> : "no registered owner"} · last <Timestamp value={n.last_deploy} /></span>
                  </li>
                );
              })}
            </ul>
          )}
          {nsRows.length > 15 && (
            <button type="button" className="rlm-more" onClick={() => setNsAll((v) => !v)}>{nsAll ? "Show fewer" : `Show all ${fmt(nsRows.length)}`}</button>
          )}
        </section>
      </div>
    </>
  );
}

function DirRow({ p }: { p: PackageRow }) {
  return (
    <tr>
      <td className="rlm-path-cell"><a className="rlm-path" href={pkgHref(p.path)} title={p.path}>{displayPath(p.path)}</a></td>
      <td><KindChip kind={p.kind} /></td>
      <td><StatusChip status={p.status} /></td>
      <td><Addr address={p.creator} name={p.creator_name} /></td>
      <td><Deployed height={p.height} time={p.time} /></td>
      <td className="num">{p.kind === "pure" ? <span className="rlm-muted" title="Pure packages cannot be called directly">—</span> : <>{fmt(p.calls_24h)}<small>{fmt(p.calls)} total</small></>}</td>
      <td className="num">{p.kind === "pure" ? <span className="rlm-muted">—</span> : fmt(p.callers)}</td>
      <td className="num">{p.storage_bytes ? <>{bytes(p.storage_bytes)}<small>{gnot(p.storage_deposit, 2)}</small></> : <span className="rlm-muted">0 B</span>}</td>
      <td className="num">{fmt(p.file_count)}<small>{bytes(p.source_bytes)}</small></td>
    </tr>
  );
}

/* ───────────────────────── package page ───────────────────────── */

function PackageView({ route, onRoute }: { route: Route & { path: string }; onRoute: (r: Route) => void }) {
  const { path } = route;
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPackage(path)
      .then((r) => { if (!cancelled) setDetail(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || "Package unavailable"); });
    return () => { cancelled = true; };
  }, [path]);

  const guessKind = path.startsWith("gno.land/r/") ? "realm" : path.startsWith("gno.land/p/") ? "pure" : "ephemeral";
  const kind = detail?.kind ?? guessKind;
  const isRealm = kind === "realm";
  const tab: Tab = route.tab && (route.tab !== "render" || isRealm) ? route.tab : isRealm ? "render" : "source";
  const pkg = detail?.package ?? null;

  const go = (t: Tab, file?: string | null) => {
    const href = tabRoute(path, t, file);
    window.history.replaceState(null, "", href);
    onRoute(parseRealmsRoute(href));
  };
  const onCopy = () => {
    void navigator.clipboard?.writeText(path).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };

  if (error && !detail) {
    return (
      <>
        <a className="rlm-back" href="#/realms">← All packages</a>
        <section className="rlm-card rlm-empty-card">
          <h2>{shortPath(path)}</h2>
          <p>{/not found/i.test(error) ? "No package with this path exists on gno.land mainnet." : `This package could not be loaded: ${error}`}</p>
          <a className="rlm-link" href={gnowebHref(path)} target="_blank" rel="noopener noreferrer">Try it on gno.land ↗</a>
        </section>
      </>
    );
  }

  return (
    <>
      <a className="rlm-back" href="#/realms">← All packages</a>
      <section className="rlm-card rlm-head">
        <div className="rlm-head-top">
          <div className="rlm-head-title">
            <div className="rlm-head-chips">
              <KindChip kind={kind} />
              {pkg && <StatusChip status={pkg.status} />}
              {detail && !detail.indexed && <Chip tone="muted" title="The VM knows this package but the index has no deployment for it">Not indexed</Chip>}
            </div>
            <h2 className="rlm-head-path">
              <span>{path}</span>
              <CopyButton value={path} copied={copied} onCopy={onCopy} size={24} />
            </h2>
          </div>
          <a className="rlm-btn" href={gnowebHref(path)} target="_blank" rel="noopener noreferrer">Open on gno.land ↗</a>
        </div>
        {!detail ? <div className="rlm-pad"><Skeleton h={54} w="100%" /></div> : (
          <dl className="rlm-facts">
            <div><dt>Creator</dt><dd>{pkg ? <Addr address={pkg.creator} name={pkg.creator_name} /> : "—"}</dd></div>
            <div><dt>Deployed</dt><dd>{pkg ? <>{pkg.height === 0 ? "Genesis" : <a className="rlm-link" href={blockHref(pkg.height)}>#{fmt(pkg.height)}</a>} · <Timestamp value={pkg.time} /></> : "—"}</dd></div>
            <div><dt>Deploy tx</dt><dd>{pkg ? <a className="rlm-link" href={txHref(pkg.tx_hash)} title={pkg.tx_hash}>{middle(pkg.tx_hash, 8, 6)}</a> : "—"}</dd></div>
            <div><dt>Storage</dt><dd>{pkg ? <>{bytes(pkg.storage_bytes)} <span className="rlm-muted">· {gnot(pkg.storage_deposit, 2)} deposit</span></> : "—"}</dd></div>
            {isRealm && <div><dt>Calls</dt><dd>{pkg ? <>{fmt(pkg.calls)} <span className="rlm-muted">· {fmt(pkg.calls_24h)} in 24 h · {fmt(pkg.callers)} callers</span></> : "—"}</dd></div>}
            {isRealm && <div><dt>Last call</dt><dd>{pkg?.last_call ? <Timestamp value={pkg.last_call} /> : "—"}</dd></div>}
            <div><dt>Source</dt><dd>{pkg ? <>{fmt(pkg.file_count ?? pkg.files?.length)} files · {bytes(pkg.source_bytes)}</> : "—"}</dd></div>
            {pkg?.max_deposit && <div><dt>Max deposit</dt><dd>{pkg.max_deposit}</dd></div>}
          </dl>
        )}
      </section>

      <section className="rlm-card rlm-body">
        <div className="rlm-tabs" role="tablist" aria-label="Package views">
          {TABS.filter((t) => t !== "render" || isRealm).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => go(t)}>
              {{ render: "Render", source: "Source", functions: `Functions${detail?.funcs ? ` (${detail.funcs.length})` : ""}`, activity: "Activity", events: "Events" }[t]}
            </button>
          ))}
        </div>
        {tab === "render" && <RenderTab path={path} args={route.args} />}
        {tab === "source" && <SourceTab path={path} detail={detail} file={route.file} onFile={(f) => go("source", f)} />}
        {tab === "functions" && <FunctionsTab path={path} detail={detail} />}
        {tab === "activity" && <ActivityTab path={path} detail={detail} />}
        {tab === "events" && <EventsTab path={path} detail={detail} />}
      </section>
    </>
  );
}

/* Render */
function RenderTab({ path, args }: { path: string; args: string }) {
  const [input, setInput] = useState(args);
  const [res, setRes] = useState<PackageRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => setInput(args), [args]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getRender(path, args)
      .then((r) => { if (!cancelled) setRes(r); })
      .catch((e: Error) => { if (!cancelled) { setRes(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, args]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    window.location.hash = renderRoute(path, input.trim()).slice(1) || `/realms/${path}`;
  };
  const noRender = error && /NoRender|no render/i.test(error);
  return (
    <div className="rlm-tab-body">
      <form className="rlm-args" onSubmit={submit}>
        <span className="rlm-args-prefix" title={path}>{shortPath(path)}:</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="render path, e.g. p/my-post or ?page=2" aria-label="Render path" spellCheck={false} />
        <button type="submit" className="rlm-btn">Render</button>
        <a className="rlm-btn ghost" href={gnowebHref(path, args)} target="_blank" rel="noopener noreferrer">gnoweb ↗</a>
      </form>
      <p className="rlm-muted rlm-small">
        Output of <code>Render("{args}")</code>, queried live from the chain and sanitized. Links to other realms stay in this explorer;
        help, source and user pages open on gno.land. External images are not loaded.
        {args && <> · <a className="rlm-link" href={renderRoute(path)}>Back to home render</a></>}
      </p>
      {loading && !res ? <Skeleton h={240} w="100%" /> : error ? (
        <div className="rlm-empty">{noRender ? "This realm does not declare a Render function." : `Render failed: ${error}`}</div>
      ) : res ? (
        <>
          {res.truncated && <div className="rlm-notice">Output truncated — open it on gno.land for the full render.</div>}
          {res.markdown.trim() ? <Markdown source={res.markdown} pkg={path} args={args} className={loading ? "is-loading" : undefined} /> : <div className="rlm-empty">Render returned an empty page for this path.</div>}
        </>
      ) : null}
    </div>
  );
}

/* Source */
function SourceTab({ path, detail, file, onFile }: { path: string; detail: PackageDetail | null; file: string | null; onFile: (f: string) => void }) {
  const [list, setList] = useState<{ name: string; size: number | null }[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [src, setSrc] = useState<PackageSource | null>(null);
  const [srcError, setSrcError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(true);

  useEffect(() => {
    if (detail?.package?.files?.length) { setList(detail.package.files); return; }
    if (!detail) return;
    let cancelled = false;
    getPackageFiles(path)
      .then((r) => { if (!cancelled) setList((r.files ?? []).map((name) => ({ name, size: null }))); })
      .catch((e: Error) => { if (!cancelled) setListError(e.message); });
    return () => { cancelled = true; };
  }, [path, detail]);

  const files = list ?? [];
  const pick = file && files.some((f) => f.name === file) ? file
    : files.find((f) => /\.gno$/.test(f.name) && !/_test\.gno$|_filetest\.gno$/.test(f.name))?.name ?? files[0]?.name ?? null;

  useEffect(() => {
    if (!pick) return;
    let cancelled = false;
    setSrc(null); setSrcError(null);
    getPackageFile(path, pick)
      .then((r) => { if (!cancelled) setSrc(r); })
      .catch((e: Error) => { if (!cancelled) setSrcError(e.message); });
    return () => { cancelled = true; };
  }, [path, pick]);

  const groups = useMemo(() => {
    const isTest = (n: string) => /_test\.gno$|_filetest\.gno$/.test(n);
    return [
      { label: "Source", items: files.filter((f) => !isTest(f.name)) },
      { label: "Tests", items: files.filter((f) => isTest(f.name)) },
    ].filter((g) => g.items.length);
  }, [files]);

  if (listError) return <div className="rlm-tab-body"><div className="rlm-empty">Source unavailable: {listError}</div></div>;
  return (
    <div className="rlm-source">
      <nav className="rlm-files" aria-label="Files">
        {!list ? <Skeleton h={200} w="100%" /> : groups.map((g) => (
          <div key={g.label}>
            <span className="rlm-files-label">{g.label} · {g.items.length}</span>
            {g.items.map((f) => (
              <button key={f.name} type="button" aria-current={f.name === pick} onClick={() => onFile(f.name)} title={f.name}>
                <span>{f.name}</span>{f.size !== null && <small>{bytes(f.size)}</small>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="rlm-code">
        <div className="rlm-code-head">
          <span className="rlm-code-name">{pick ?? "—"}</span>
          {src?.size !== undefined && <span className="rlm-muted">{bytes(src.size)}{src.body ? ` · ${fmt(src.body.replace(/\n$/, "").split("\n").length)} lines` : ""}</span>}
          {pick && /\.md$/i.test(pick) && (
            <button type="button" className="rlm-btn ghost" onClick={() => setRendered((v) => !v)}>{rendered ? "Raw" : "Rendered"}</button>
          )}
          {pick && <a className="rlm-btn ghost" href={`${gnowebHref(path)}$source&file=${encodeURIComponent(pick)}`} target="_blank" rel="noopener noreferrer">gnoweb ↗</a>}
        </div>
        {srcError ? <div className="rlm-empty">Could not load {pick}: {srcError}</div>
          : !src ? <div className="rlm-pad"><Skeleton h={320} w="100%" /></div>
          : <>
              {src.truncated && <div className="rlm-notice">File truncated for display — the full file is on gnoweb.</div>}
              {pick && /\.md$/i.test(pick) && rendered
                ? <div className="rlm-pad"><Markdown source={src.body ?? ""} pkg={path} /></div>
                : <SourceView text={src.body ?? ""} name={pick ?? ""} />}
            </>}
      </div>
    </div>
  );
}

/* Functions */
function FunctionsTab({ path, detail }: { path: string; detail: PackageDetail | null }) {
  if (!detail) return <div className="rlm-tab-body"><Skeleton h={200} w="100%" /></div>;
  const funcs = detail.funcs;
  const calls = new Map(detail.top_funcs.map((f) => [f.name, f]));
  const crossing = (f: FuncSig) => f.params[0]?.type === "realm";
  const sorted = funcs ? [...funcs].sort((a, b) => (calls.get(b.name)?.calls ?? 0) - (calls.get(a.name)?.calls ?? 0) || Number(crossing(b)) - Number(crossing(a))) : [];
  const nCross = funcs?.filter(crossing).length ?? 0;
  const typeText = (t: string) => t.replace(/gno\.land\/[rp]\/[\w./-]+\.(\w+)/g, (m, name: string) => {
    const pkg = m.slice(0, m.length - name.length - 1);
    return pkg === path ? name : `${pkg.split("/").pop()}.${name}`;
  });
  return (
    <div className="rlm-tab-body">
      <p className="rlm-muted rlm-small">
        Exported functions as the VM reports them. A first parameter of type <code>realm</code> marks a <b>crossing</b> function: it runs in this realm's
        context and can change its state, so it is what transactions call ({nCross} of {funcs?.length ?? 0}). Call counts cover indexed transactions (top 20 functions).
      </p>
      {!funcs ? <div className="rlm-empty">The VM does not know this package's functions.</div> : !funcs.length ? <div className="rlm-empty">No exported functions.</div> : (
        <div className="rlm-table-scroll">
          <table className="rlm-table rlm-func-table">
            <thead><tr><th>Function</th><th>Signature</th><th className="num">Calls</th><th>Last call</th><th /></tr></thead>
            <tbody>
              {sorted.map((f) => {
                const c = calls.get(f.name);
                const params = (crossing(f) ? f.params.slice(1) : f.params).map((p) => `${p.name} ${typeText(p.type)}`).join(", ");
                const results = f.results.map((r) => (r.name.startsWith(".res") ? "" : `${r.name} `) + typeText(r.type));
                return (
                  <tr key={f.name}>
                    <td><span className="rlm-fn">{f.name}</span>{crossing(f) && <Chip tone="brand" title="Takes `cur realm`: callable by transactions, may write state">crossing</Chip>}</td>
                    <td className="rlm-sig"><code>({crossing(f) ? <span className="rlm-muted">cur realm{params ? ", " : ""}</span> : null}{params}){results.length ? ` ${results.length > 1 ? `(${results.join(", ")})` : results[0]}` : ""}</code></td>
                    <td className="num">{c ? fmt(c.calls) : <span className="rlm-muted">—</span>}</td>
                    <td>{c ? <Timestamp value={c.last_call} /> : <span className="rlm-muted">—</span>}</td>
                    <td><a className="rlm-link" href={`${gnowebHref(path)}$help&func=${encodeURIComponent(f.name)}`} target="_blank" rel="noopener noreferrer">help ↗</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Activity */
function ActivityTab({ path, detail }: { path: string; detail: PackageDetail | null }) {
  const [txs, setTxs] = useState<{ txs: Tx[]; names: Names } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTransactions(25, { pkg: path })
      .then((r) => { if (!cancelled) setTxs({ txs: r.txs, names: r.names }); })
      .catch((e: Error) => { if (!cancelled) setTxError(e.message); });
    return () => { cancelled = true; };
  }, [path]);
  if (!detail) return <div className="rlm-tab-body"><Skeleton h={240} w="100%" /></div>;
  const daily = detail.daily_txs;
  const series = detail.storage_series;
  const maxTx = Math.max(1, ...daily.map((x) => x.txs));
  const maxSt = Math.max(1, ...series.map((x) => x.total));
  const minSt = Math.min(0, ...series.map((x) => x.total));
  return (
    <div className="rlm-tab-body rlm-activity">
      <div className="rlm-chart-row">
        <div className="rlm-chart-card">
          <h3>Transactions per day</h3>
          <span className="rlm-muted rlm-small">{daily.length ? `${fmt(daily.reduce((s, x) => s + x.txs, 0))} txs touching this package over ${daily.length} days` : "No transactions touch this package"}</span>
          {daily.length > 1 ? <TimeSeriesChart values={daily.map((x) => x.txs)} times={daily.map((x) => x.day)} min={0} max={maxTx} stroke="var(--brand)" fillColor="var(--brandSoft)" height={150} formatValue={(v) => `${fmt(v)} txs`} formatTime={dayLabel} />
            : <div className="rlm-chart-empty">{daily.length === 1 ? `${fmt(daily[0]!.txs)} txs on ${dayLabel(daily[0]!.day)}` : "No activity"}</div>}
        </div>
        <div className="rlm-chart-card">
          <h3>Realm storage (cumulative)</h3>
          <span className="rlm-muted rlm-small">{series.length ? `Net bytes from storage deposit/unlock events · now ${bytes(series[series.length - 1]!.total)}` : "No storage events for this package"}</span>
          {series.length > 1 ? <TimeSeriesChart values={series.map((x) => x.total)} times={series.map((x) => x.day)} min={minSt} max={maxSt} stroke="var(--brand)" fillColor="var(--brandSoft)" height={150} formatValue={(v) => bytes(v)} formatTime={dayLabel} />
            : <div className="rlm-chart-empty">{series.length === 1 ? `${bytes(series[0]!.total)} on ${dayLabel(series[0]!.day)}` : "No storage written"}</div>}
        </div>
      </div>

      <div className="rlm-sub">
        <div className="rlm-sub-head"><h3>Recent transactions</h3><a className="rlm-link" href={`#/transactions`}>All transactions</a></div>
        {txError ? <div className="rlm-empty">Transactions unavailable: {txError}</div> : !txs ? <Skeleton h={160} w="100%" /> : !txs.txs.length ? <div className="rlm-empty">No transactions involve this package.</div> : (
          <div className="rlm-table-scroll">
            <table className="rlm-table">
              <thead><tr><th>Tx</th><th>Action</th><th>Signer</th><th>Block</th><th className="num" title="Net storage the whole transaction added or freed, across all realms">Tx storage Δ</th><th>Status</th></tr></thead>
              <tbody>
                {txs.txs.map((t) => (
                  <tr key={t.hash}>
                    <td><a className="rlm-link" href={txHref(t.hash)} title={t.hash}>{middle(t.hash, 6, 4)}</a></td>
                    <td className="rlm-trunc" title={txSummary(t)}>{txSummary(t)}</td>
                    <td><Addr address={t.signer} name={t.signer ? txs.names[t.signer] : null} /></td>
                    <td><a className="rlm-link" href={blockHref(t.height)}>{fmt(t.height)}</a><small><Timestamp value={t.time} /></small></td>
                    <td className="num">{t.storage_delta ? <span className={t.storage_delta > 0 ? "rlm-up" : "rlm-down"}>{t.storage_delta > 0 ? "+" : ""}{bytes(t.storage_delta)}</span> : <span className="rlm-muted">—</span>}</td>
                    <td>{t.success ? <Chip tone="ok">Success</Chip> : <Chip tone="bad" title={t.error ?? undefined}>Failed</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rlm-lists">
        <RankList title="Top callers" empty="No callers" rows={detail.callers.map((c) => ({ key: c.address, label: <Addr address={c.address} name={c.username} />, n: c.txs, unit: "txs" }))} />
        <RankList title="Events emitted" empty="No events emitted" rows={detail.event_types.map((e) => ({ key: e.type, label: <span className="rlm-mono">{e.type}</span>, n: e.n, unit: "", note: <>last <Timestamp value={e.last} /></> }))} />
        <RankList title="Co-called packages" empty="Never called alongside other packages" rows={detail.co_called.map((c) => ({ key: c.path, label: <a className="rlm-link" href={pkgHref(c.path)} title={c.path}>{displayPath(c.path)}</a>, n: c.n, unit: "txs" }))} />
        <RankList title="Child packages" empty="No packages under this path" rows={detail.children.map((c) => ({ key: c.path, label: <a className="rlm-link" href={pkgHref(c.path)} title={c.path}>{displayPath(c.path)}</a>, n: null, unit: c.kind }))} />
      </div>
    </div>
  );
}

function RankList({ title, rows, empty }: { title: string; empty: string; rows: { key: string; label: ReactNode; n: number | null; unit: string; note?: ReactNode }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n ?? 0));
  return (
    <div className="rlm-rank">
      <h3>{title}</h3>
      {!rows.length ? <div className="rlm-muted rlm-small">{empty}</div> : (
        <ol>
          {rows.map((r) => (
            <li key={r.key}>
              <div className="rlm-rank-row">
                <span className="rlm-rank-label">{r.label}</span>
                <span className="rlm-rank-n">{r.n !== null ? fmt(r.n) : ""} <small>{r.unit}</small></span>
              </div>
              {r.n !== null && <span className="rlm-rank-bar"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>}
              {r.note && <small className="rlm-muted">{r.note}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* Events */
function EventsTab({ path, detail }: { path: string; detail: PackageDetail | null }) {
  const [type, setType] = useState("");
  const [feed, setFeed] = useState<EventFeed["events"] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const LIMIT = 50;
  const req = useRef(0);
  useEffect(() => {
    const id = ++req.current;
    setFeed(null); setError(null);
    getEvents({ pkg: path, type: type || undefined, limit: LIMIT })
      .then((r) => { if (id === req.current) { setFeed(r.events); setMore(r.events.length >= LIMIT); } })
      .catch((e: Error) => { if (id === req.current) setError(e.message); });
  }, [path, type]);
  const loadMore = () => {
    const last = feed?.[feed.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const id = req.current;
    // `before` is an exclusive height: re-read the last height so a block split across pages is not skipped, then dedupe.
    const seen = new Set((feed ?? []).map((e) => `${e.tx_hash}:${e.idx}`));
    const fetchPage = async () => {
      const r = await getEvents({ pkg: path, type: type || undefined, limit: LIMIT, before: last.height + 1 });
      const fresh = r.events.filter((e) => !seen.has(`${e.tx_hash}:${e.idx}`));
      if (fresh.length || r.events.length < LIMIT) return { fresh, full: r.events.length >= LIMIT };
      const r2 = await getEvents({ pkg: path, type: type || undefined, limit: LIMIT, before: last.height });
      return { fresh: r2.events, full: r2.events.length >= LIMIT };
    };
    fetchPage()
      .then(({ fresh, full }) => { if (id === req.current) { setFeed((f) => [...(f ?? []), ...fresh]); setMore(full); } })
      .catch(() => setMore(false))
      .finally(() => setLoadingMore(false));
  };
  const types = detail?.event_types ?? [];
  return (
    <div className="rlm-tab-body">
      <div className="rlm-toolbar flush">
        <p className="rlm-muted rlm-small">Events this package emitted with <code>chain.Emit</code>, newest first.</p>
        {types.length > 0 && (
          <select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.type} value={t.type}>{t.type} ({fmt(t.n)})</option>)}
          </select>
        )}
      </div>
      {error ? <div className="rlm-empty">Events unavailable: {error}</div> : !feed ? <Skeleton h={200} w="100%" /> : !feed.length ? <div className="rlm-empty">No events{type ? ` of type ${type}` : ""} from this package.</div> : (
        <>
          <ul className="rlm-events">
            {feed.map((e) => (
              <li key={`${e.tx_hash}:${e.idx}`}>
                <div className="rlm-event-head">
                  <span className="rlm-event-type">{e.type ?? "—"}</span>
                  <a className="rlm-link" href={txHref(e.tx_hash)} title={e.tx_hash}>{middle(e.tx_hash, 6, 4)}</a>
                  <a className="rlm-link" href={blockHref(e.height)}>#{fmt(e.height)}</a>
                  <span className="rlm-muted"><Timestamp value={e.time} /></span>
                </div>
                {e.attrs.length > 0 && (
                  <div className="rlm-attrs">
                    {e.attrs.map((a, i) => (
                      <span key={i} className="rlm-attr"><b>{a.key}</b>{/^g1[02-9ac-hj-np-z]{38}$/.test(a.value) ? <Addr address={a.value} /> : /^gno\.land\/[rp]\//.test(a.value) ? <a className="rlm-link" href={pkgHref(a.value)}>{shortPath(a.value)}</a> : <span>{a.value}</span>}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {more && <button type="button" className="rlm-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : "Load older events"}</button>}
        </>
      )}
    </div>
  );
}
