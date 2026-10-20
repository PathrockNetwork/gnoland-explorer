import { Timestamp } from "../components/Timestamp";
/** Browser-direct gno.land Tendermint2 JSON-RPC workbench. Endpoint drafts never change an in-flight query. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { fetchBlocks, probeNode, rpcCallRaw, type BlockInfo, type NodeProbe, type RpcParams, type RpcResult } from "../nodeRpc";
import { PUBLIC_RPC_WS, host, rpcConsoleRequest } from "../networkExplorer";
import { compileParams, curlCommand, decodeAbci, findMethod, formFromRaw, methodList, methodTitle, normalizeEndpoint, PUBLIC_RPC, PUBLIC_RPCS, RPC_CATEGORIES, RPC_METHODS, type MethodSpec } from "../rpcConsole";
import { fmt, middle, short } from "../lib";
import "./rpc-console.css";

const ENDPOINT_KEY = "gnoland-explorer-rpc-url", METHOD_KEY = "gnoland-explorer-rpc-method";
const CHAIN_ID = "gnoland-1";
const initialEndpoint = () => { const request = rpcConsoleRequest(location.hash); if (request) return request.url; try { const value = localStorage.getItem(ENDPOINT_KEY); return value && !normalizeEndpoint(value).error ? value : PUBLIC_RPC; } catch { return PUBLIC_RPC; } };
const initialMethod = () => { const request = rpcConsoleRequest(location.hash); if (request && findMethod(request.method)) return request.method!; try { const value = localStorage.getItem(METHOD_KEY); return findMethod(value) ? value! : "status"; } catch { return "status"; } };
type Connection = { probe: NodeProbe | null; blocks: BlockInfo[]; blockError: string | null; loading: boolean; updated: number | null };
const EMPTY: Connection = { probe: null, blocks: [], blockError: null, loading: false, updated: null };

export function DirectRpc({ d }: { d: Dashboard }) {
  const [base, setBase] = useState(initialEndpoint);
  const [draft, setDraft] = useState(base);
  const [connection, setConnection] = useState<Connection>(EMPTY);
  const [connectError, setConnectError] = useState("");
  const [tick, setTick] = useState(0);
  const [guide, setGuide] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const normalized = normalizeEndpoint(draft);
  const dirty = !!normalized.error || normalized.url !== base;
  const chainId = d.config?.chain_id ?? CHAIN_ID;
  const suggestions = [...new Set([...PUBLIC_RPCS, ...(d.config?.rpc ?? []), ...(d.endpoints?.endpoints.filter(e => e.kind === "rpc").map(e => e.url) ?? [])])];
  useEffect(() => {
    let stopped = false, pending = false;
    const scope = ++generation.current;
    setConnection({ ...EMPTY, loading: true });
    const refresh = async () => {
      if (pending || stopped) return;
      pending = true;
      setConnection(previous => ({ ...previous, loading: true }));
      try {
        const probe = await probeNode(base);
        if (stopped || scope !== generation.current) return;
        if (probe.state !== "ok") { setConnection({ ...EMPTY, probe, updated: Date.now() }); return; }
        setConnection(previous => ({ ...previous, probe, updated: Date.now() }));
        const head = probe.latest ?? null;
        const blocks = head !== null ? await fetchBlocks(base, head, 5) : null;
        if (stopped || scope !== generation.current) return;
        setConnection({ probe, blocks: blocks?.state === "ok" ? blocks.data : [], blockError: !blocks ? "No block height reported." : blocks.state !== "ok" ? `Recent blocks could not be loaded: ${blocks.error}` : null, loading: false, updated: Date.now() });
      } finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [base, tick]);
  const connect = (value = draft) => {
    const parsed = normalizeEndpoint(value);
    if (parsed.url === undefined) { setConnectError(parsed.error); return; }
    setConnectError(""); setDraft(parsed.url); setBase(parsed.url); setTick(t => t + 1);
    try { localStorage.setItem(ENDPOINT_KEY, parsed.url); } catch { /* Connection works without persistence. */ }
  };
  const probe = connection.probe;
  const ok = probe?.state === "ok" ? probe : null;
  const connected = !dirty && !!ok;
  const unexpectedChain = !!ok && !!ok.network && ok.network !== chainId;
  const isPreset = (url: string) => base === url && !dirty;
  return <div className="rce-page">
    <section className="rce-panel rce-endpoints"><Heading title="RPC Endpoint" description="Use the public gno.land mainnet RPC or enter any Tendermint2 JSON-RPC URL." icon="link" aside={<button type="button" className="rce-text-button" aria-expanded={guide} onClick={() => setGuide(value => !value)}>{guide ? "Hide connection guide" : "View connection guide"} →</button>} />
      <form className="rce-connect-row" onSubmit={event => { event.preventDefault(); connect(); }}><label className="rce-url-input"><Icon name="link" /><input ref={input} list="rce-endpoint-options" aria-label="RPC endpoint URL" value={draft} spellCheck={false} placeholder={PUBLIC_RPC} onChange={event => { setDraft(event.target.value); setConnectError(""); }} /><button type="button" aria-label="Clear endpoint URL" onClick={() => { setDraft(""); input.current?.focus(); }}>×</button></label><datalist id="rce-endpoint-options">{suggestions.map(url => <option key={url} value={url} />)}</datalist><span className={`rce-connection-state ${connected ? "ok" : ""}`} role="status"><i />{dirty ? "Not connected" : connection.loading && !probe ? "Connecting…" : connected ? "Connected" : "Unavailable"}</span><span className="rce-latency"><Icon name="latency" /><span><strong>{!dirty && probe ? `${probe.latencyMs} ms` : "—"}</strong><small>Probe latency</small></span></span><button type="submit" className="rce-primary" disabled={connection.loading && !dirty}><Icon name="link" />{connection.loading && !dirty ? "Connecting…" : "Connect"}</button></form>
      {connectError && <p className="rce-error" role="alert">{connectError}</p>}{dirty && !connectError && <p className="rce-draft-note">Connect to apply this endpoint before executing a query.</p>}
      <span className="rce-quick-label">Public endpoints</span><div className="rce-quick-grid">{PUBLIC_RPCS.map(url => { const known = d.endpoints?.endpoints.find(e => e.url.replace(/\/+$/, "") === url); return <button type="button" key={url} className={`rce-quick-card ${isPreset(url) ? "selected" : ""}`} onClick={() => connect(url)}><Icon name="network" /><span><strong>{host(url)} <em>{url === PUBLIC_RPC ? "Archive" : "Pruned"}</em></strong><code>{url}</code><small>gno.land mainnet · {chainId}{known ? ` · ${known.ok ? "healthy" : "unhealthy"} at the server probe` : ""} · read by this explorer</small></span><b aria-hidden="true">{isPreset(url) ? "◉" : "○"}</b></button>; })}<button type="button" className="rce-quick-card custom" onClick={() => { setDraft(""); setConnectError(""); input.current?.focus(); }}><Icon name="plus" /><span><strong>Custom endpoint</strong><small>Any HTTPS Tendermint2 RPC that allows browser requests (CORS), e.g. a testnet or your own node.</small></span><b>›</b></button></div>
      {guide && <div className="rce-guide"><strong>Connecting to an endpoint</strong><p>Requests go straight from your browser to the endpoint as JSON-RPC 2.0 POSTs; the explorer server is not involved. Both preset endpoints allow browser requests from any origin; the Pathrock archive keeps state for every height and also serves WebSocket at <code>{PUBLIC_RPC_WS}</code>. This page's status cards send one small batch (status, num_unconfirmed_txs, validators, consensus_params) plus one blockchain call every 10 seconds.</p><p>Tendermint2 takes <strong>named</strong> params with integers as strings, e.g. <code>{`{"height":"944000"}`}</code>. Byte fields are base64: <code>abci_query</code> data is the base64 of the query text, and tx hashes are base64. The realm and account presets encode for you and decode the base64 <code>ResponseBase.Data</code> of the answer. <code>tx_search</code>, <code>subscribe</code> and broadcast methods are not offered here. Choosing an endpoint does not change what the explorer itself reads.</p><a href="#/endpoints">See server-side endpoint health on the Network page →</a></div>}
    </section>
    {probe && probe.state !== "ok" && !dirty && <div className="rce-notice" role="status"><Icon name="info" /><div><strong>{probe.state === "blocked" ? "The browser could not reach this endpoint" : "The endpoint probe failed"}</strong><span>{probe.error}</span></div><button type="button" onClick={() => connect()}>Retry</button></div>}
    {unexpectedChain && <div className="rce-notice" role="status">This endpoint reports network {ok?.network ?? "—"}; the explorer follows {chainId}. Block links below are disabled for this connection.</div>}
    <Workbench base={base} disabled={dirty} />
    <div className="rce-summary-grid"><section className="rce-panel"><Heading title="Node Status" icon="status" aside={ok ? <span className={`rce-badge ${ok.catchingUp ? "warn" : ok.catchingUp === false ? "ok" : ""}`}>{ok.catchingUp ? "Catching up" : ok.catchingUp === false ? "Synced" : "Sync unknown"}</span> : undefined} /><dl><Fact label="Network">{ok?.network ?? "—"}</Fact><Fact label="Latest block">{fmt(ok?.latest)}</Fact><Fact label="Latest block time">{ok?.latestTime ? <Timestamp value={ok.latestTime} /> : "—"}</Fact><Fact label="Node version">{ok?.version ?? "—"}</Fact><Fact label="Moniker"><span title={ok?.moniker ?? undefined}>{ok?.moniker ?? "—"}</span></Fact></dl></section><section className="rce-panel"><Heading title="Chain Info" icon="network" /><dl><Fact label="Validators">{ok?.validators == null ? "—" : `${fmt(ok.validators)} · voting power ${fmt(ok.votingPower)}`}</Fact><Fact label="Mempool">{ok?.mempool == null ? "—" : `${fmt(ok.mempool)} txs`}</Fact><Fact label="Max gas per block">{fmt(ok?.maxGas)}</Fact><Fact label="App hash"><span title={ok?.appHash ?? undefined}>{ok?.appHash ? middle(ok.appHash, 10, 6) : "—"}</span></Fact><Fact label="Tx index">{ok?.txIndex ?? "—"}</Fact></dl></section><section className="rce-panel"><Heading title="Latest Blocks" icon="block" aside={<a href="#/blocks">View all →</a>} /><div className="rce-latest-blocks">{connection.blocks.map(block => { const content = <><Icon name="block" /><strong>{fmt(block.number)}</strong><span>{block.time ? <Timestamp value={block.time} /> : "—"}</span><small title={block.proposer ?? undefined}>{fmt(block.txCount)} txs{block.proposer ? ` · ${short(block.proposer)}` : ""}</small></>; return unexpectedChain ? <div key={block.number}>{content}</div> : <a href={`#/blocks/${block.number}`} key={block.number}>{content}</a>; })}{!connection.blocks.length && <p>{connection.loading ? "Loading recent blocks…" : "Recent blocks are unavailable for this connection."}</p>}</div>{connection.blockError && <p className="rce-card-note">{connection.blockError}</p>}</section></div>
    <p className="rce-footnote">Node summaries update every 10 seconds for the connected endpoint, straight from your browser.{connection.updated ? ` Last updated ${new Date(connection.updated).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC.` : ""}</p>
  </div>;
}

type Executed = { response: RpcResult<unknown>; base: string; spec: MethodSpec; params: RpcParams; at: number };
function Workbench({ base, disabled }: { base: string; disabled: boolean }) {
  const [method, setMethod] = useState(initialMethod);
  const [category, setCategory] = useState("Popular");
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("{}");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Executed | null>(null);
  const [format, setFormat] = useState("pretty");
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requestId = useRef(0), inFlight = useRef(false);
  const spec = findMethod(method) ?? RPC_METHODS[0];
  const visible = methodList(category, search);
  const invalidate = () => { requestId.current++; inFlight.current = false; setBusy(false); setResult(null); setFeedback(""); };
  useEffect(() => { invalidate(); return () => { requestId.current++; }; }, [base]);
  useEffect(() => { try { localStorage.setItem(METHOD_KEY, method); } catch { /* Method selection remains usable without storage. */ } }, [method]);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(""), 2500); return () => clearTimeout(timer); }, [feedback]);
  const choose = (value: string) => { invalidate(); setMethod(value); setValues({}); setRaw("{}"); setRawMode(false); setError(""); setNote(""); };
  const clear = () => { invalidate(); setValues({}); setRaw("{}"); setError(""); setNote(""); };
  const toggleRaw = () => {
    setNote("");
    if (rawMode) {
      const parsed = formFromRaw(spec, raw);
      if (parsed === null) setNote("These raw parameters can't be mapped back to form fields; the previous field values were kept.");
      else setValues(parsed);
    } else {
      const compiled = compileParams(spec, values);
      if (compiled.params === undefined) { setError(compiled.error); return; }
      setRaw(JSON.stringify(compiled.params, null, 2));
    }
    setRawMode(!rawMode); setError("");
  };
  const execute = async () => {
    if (disabled || inFlight.current) return;
    const compiled = compileParams(spec, values, rawMode ? raw : null);
    if (compiled.params === undefined) { setError(compiled.error); return; }
    if (spec.confirm && !window.confirm(spec.confirm)) return;
    const id = ++requestId.current, target = base, current = spec;
    inFlight.current = true; setBusy(true); setError(""); setFeedback(""); setResult(null);
    try {
      const response = await rpcCallRaw(target, current.method, compiled.params);
      if (id !== requestId.current) return;
      setResult({ response, base: target, spec: current, params: compiled.params, at: Date.now() });
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : "The query could not complete."); }
    finally { if (id === requestId.current) { inFlight.current = false; setBusy(false); } }
  };
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void execute(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); });
  const body = result?.response.data;
  const text = body === undefined ? "" : JSON.stringify(body, null, format === "pretty" ? 2 : undefined) ?? "null";
  const decoded = result?.response.state === "ok" && result.spec.method === "abci_query" ? decodeAbci((body as { result?: unknown } | null)?.result) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setFeedback("Response copied."); } catch { setFeedback("Clipboard unavailable. Select the response text or download it."); } };
  const copyCurl = async () => {
    const compiled = compileParams(spec, values, rawMode ? raw : null);
    if (compiled.params === undefined) { setError(compiled.error); return; }
    try { await navigator.clipboard.writeText(curlCommand(base, { jsonrpc: "2.0", id: 1, method: spec.method, params: compiled.params })); setFeedback("cURL command copied."); } catch { setFeedback("Clipboard unavailable."); }
  };
  const download = () => { if (!result || !text) return; const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `gnoland-rpc-${result.spec.id}-${result.at}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const responsePanel = (modal = false) => <><Heading title="Response" description="JSON-RPC envelope returned by the endpoint." icon="response" aside={<div className="rce-response-tools">{result && <><span className={`rce-badge ${result.response.state === "ok" ? "ok" : "bad"}`}>{result.response.state === "ok" ? "Success" : result.response.state === "blocked" ? "Blocked" : "Error"}</span><span className="rce-response-ms">{result.response.latencyMs} ms</span></>}<button type="button" disabled={!text} onClick={() => void copy()}><Icon name="copy" />Copy</button><button type="button" disabled={!text} aria-label="Download JSON response" title="Download JSON response" onClick={download}><Icon name="download" /></button><button type="button" aria-label={modal ? "Close expanded response" : "Expand response"} onClick={() => setExpanded(!modal)}><Icon name={modal ? "close" : "expand"} /></button></div>} />{result && <div className="rce-response-context"><code>{result.spec.method}</code><span title={result.base}>{result.base}</span><time>{new Date(result.at).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</time></div>}{result && result.response.state !== "ok" && <p className="rce-error" role="alert">{result.response.error}</p>}{decoded && <div className="rce-decoded"><div><strong>Decoded ResponseBase.Data</strong>{decoded.error ? <span className="rce-badge bad">{decoded.error}</span> : <span className="rce-badge ok">{decoded.json ? "JSON" : "text"}</span>}</div>{decoded.text !== null ? <pre><code>{decoded.text.length > 50_000 ? `${decoded.text.slice(0, 50_000)}\n… truncated` : decoded.text}</code></pre> : <p>{decoded.error ? decoded.log ?? "The query returned an error and no data." : "Data is empty (null)."}</p>}</div>}<div className="rce-code" role="region" aria-label="RPC JSON response" tabIndex={0}>{text ? <JsonCode text={text} /> : <div className="rce-response-empty"><Icon name="response" /><strong>{busy ? `Executing ${spec.method}…` : result ? "No JSON response body was received." : "Your response will appear here"}</strong><span>{busy ? "Waiting for the connected endpoint." : "Select a method and execute a read-only request."}</span></div>}</div><footer className="rce-response-footer"><span role="status">{feedback || (text ? `${new TextEncoder().encode(text).length.toLocaleString()} bytes` : "No response yet")}</span><select aria-label="Response JSON format" value={format} onChange={event => setFormat(event.target.value)}><option value="pretty">Pretty JSON</option><option value="compact">Compact JSON</option></select></footer></>;
  return <><section className="rce-panel rce-methods"><Heading title="Method Explorer" description="Read-only Tendermint2 methods plus ABCI query presets for realms and accounts. Select one to configure its parameters." icon="block" aside={<a href="#/api">Explorer REST API ↗</a>} /><div className="rce-method-toolbar"><div className="rce-categories" aria-label="RPC method categories">{Object.keys(RPC_CATEGORIES).map(value => <button type="button" key={value} aria-pressed={category === value && !search} onClick={() => { setCategory(value); setSearch(""); }}>{value}</button>)}</div><label className="rce-method-search"><Icon name="search" /><input aria-label="Search RPC methods" placeholder="Find a method…" value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="rce-method-grid">{visible.map(m => <button type="button" className={`rce-method ${m.id === spec.id ? "selected" : ""}`} aria-pressed={m.id === spec.id} key={m.id} onClick={() => choose(m.id)}><Icon name={methodIcon(m)} /><span><strong>{methodTitle(m)}</strong><small>{m.description}</small></span></button>)}</div>{!visible.length && <p className="rce-empty">No methods match this search.</p>}</section>
    <div className="rce-workbench"><section className="rce-panel rce-parameters"><Heading title="Parameters" description={`Configure ${methodTitle(spec)}${spec.method !== methodTitle(spec) ? ` (${spec.method})` : ""} parameters.`} icon="code" aside={<button type="button" className="rce-raw-toggle" role="switch" aria-checked={rawMode} onClick={toggleRaw}>Raw JSON <i /></button>} /><form onSubmit={event => { event.preventDefault(); void execute(); }}><div className="rce-fields">{rawMode ? <label><span>Params object as JSON (integers as strings)</span><textarea aria-label="Raw JSON parameters" value={raw} spellCheck={false} onChange={event => { setRaw(event.target.value); setError(""); }} /></label> : spec.params.length ? spec.params.map(p => <label key={p.key}><span>{p.label}<small>{p.hint ?? (p.optional ? "optional" : p.default ? `default ${p.default}` : "")}</small></span>{<input aria-label={p.label} value={values[p.key] ?? ""} placeholder={p.default ?? p.placeholder} spellCheck={false} inputMode={p.kind === "height" || p.kind === "int" ? "numeric" : undefined} onChange={event => { setValues(v => ({ ...v, [p.key]: event.target.value })); setError(""); }} />}</label>) : <div className="rce-no-params"><Icon name="info" /><div><strong>This method does not take any parameters.</strong><span>Execute it with an empty params object.</span></div></div>}</div>{spec.note && <p className="rce-param-note">{spec.note}</p>}{note && <p className="rce-param-note">{note}</p>}{error && <p className="rce-error" role="alert">{error}</p>}<div className="rce-execute-row"><button type="submit" className="rce-primary" disabled={busy || disabled}><Icon name="play" />{busy ? "Executing…" : "Execute"} <code>{spec.method}</code></button><button type="button" className="rce-secondary" onClick={() => void copyCurl()}><Icon name="copy" />Copy cURL</button><button type="button" className="rce-secondary" onClick={clear}><Icon name="refresh" />Clear</button><span title="Ctrl+Enter or Command+Enter">⌘ / Ctrl ↵</span></div>{disabled && <p className="rce-param-note">Connect the edited endpoint to enable execution.</p>}</form></section><section className="rce-panel rce-response">{responsePanel()}</section></div>
    {expanded && <ResponseDialog onClose={() => setExpanded(false)}>{responsePanel(true)}</ResponseDialog>}
  </>;
}
function JsonCode({ text }: { text: string }) {
  const preview = text.slice(0, 100_000).split("\n").slice(0, 1600);
  const truncated = preview.join("\n").length < text.length;
  return <><pre><code>{preview.map((line, i) => <span className="rce-code-line" key={i}><span className="rce-line-number" aria-hidden="true">{i + 1}</span><span>{line.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g).map((token, j) => <span key={j} className={token.startsWith('"') ? token.trimEnd().endsWith(":") ? "rce-json-key" : "rce-json-string" : /^(true|false|null)$/.test(token) ? "rce-json-literal" : /^-?\d/.test(token) ? "rce-json-number" : undefined}>{token}</span>)}</span>{"\n"}</span>)}</code></pre>{truncated && <p className="rce-preview-note">Large response: showing a preview. Copy or download the complete JSON.</p>}</>;
}
function ResponseDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { const previous = document.activeElement; ref.current?.showModal(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []); return <dialog ref={ref} className="rce-dialog rce-response" aria-label="Expanded RPC response" onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>; }
function Heading({ title, description, icon, aside }: { title: string; description?: string; icon: string; aside?: ReactNode }) { return <header className="rce-heading"><Icon name={icon} /><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</header>; }
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function methodIcon(m: MethodSpec) { return m.group === "Blocks" ? "block" : m.group === "Transactions" || m.group === "Mempool" ? "search" : m.group === "Accounts (ABCI)" ? "people" : m.group === "Realms (ABCI)" ? "cube" : m.group === "Raw ABCI" ? "code" : m.group === "Consensus" ? "network" : m.id === "health" ? "heart" : "status"; }
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { link: "m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0", latency: "M3 20V10h3v10H3Zm6 0V6h3v14H9Zm6 0V2h3v18h-3Z", plus: "M12 3v18M3 12h18", close: "m5 5 14 14M5 19 19 5", info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7v7m0-11v1", status: "M2 12h5l3-8 4 16 3-8h5", network: "M12 7v5M5 16v-4h14v4M9 2h6v5H9V2ZM2 16h6v6H2v-6Zm14 0h6v6h-6v-6Z", block: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9", cube: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9m-5-16 10 6", code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18", response: "M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h8", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6", people: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v3", heart: "m12 21-9-9a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9Z", play: "m6 3 15 9-15 9V3Z", copy: "M8 8h13v13H8V8ZM16 5V2H2v14h3", download: "M12 2v13m-5-5 5 5 5-5M4 16v5h16v-5", expand: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6", refresh: "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1" };
  return <svg className="rce-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.code} /></svg>;
}
