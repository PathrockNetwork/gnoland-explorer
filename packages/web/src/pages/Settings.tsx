/** Deployment information and browser-local display preferences. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import type { Theme } from "../App";
import { get, type Endpoint } from "../api";
import { probeNode, type NodeProbe } from "../nodeRpc";
import { fmt, gnotCompact, agoFrom } from "../lib";
import { useAppearance, updateAppearance, type Appearance } from "../appearance";
import { Timestamp } from "../components/Timestamp";
import { consoleLink, host, isCorsOpen, roleLabel } from "../networkExplorer";
import "./settings.css";

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    chain: "m9 15 6-6m-7 3-3 3a3 3 0 0 0 4 4l3-3m0-8 3-3a3 3 0 0 1 4 4l-3 3",
    server: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01m4-10h6m-6 10h6",
    cube: "m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v10M8 5l9 5",
    lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3m-4 4v3",
    gear: "m10 3 4 0 1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3Zm2 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    monitor: "M3 4h18v13H3zM8 21h8m-4-4v4",
    governance: "m3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
    coins: "M5 7c0-5 14-5 14 0s-14 5-14 0Zm0 0v5c0 5 14 5 14 0V7M5 12v5c0 5 14 5 14 0v-5",
    archive: "M4 4h16v4H4zM5 8v13h14V8m-10 5h6",
    wifi: "M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0m-3 4h.01",
    clock: "M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
    sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2m-7 1a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    density: "M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4m-8 3v4",
    motion: "m3 3 18 18M9 5l3-2 8 9-3 2M6 8l-4 4 10 9 3-5M10 10l4 4",
    file: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h8",
    copy: "M8 8h12v13H8zM16 8V3H3v13h5",
    info: "M12 11v6m0-10h.01m9 5a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    check: "m5 12 4 4L20 5",
    chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  };
  return <svg className="ste-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>;
}
function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: string }) { return <span className={`ste-badge ${tone}`}>{children}</span>; }
function Panel({ name, title, description, aside, children }: { name: string; title: string; description: string; aside?: ReactNode; children: ReactNode }) {
  return <section className={`ste-panel ste-${name}`}><header className="ste-heading"><span className="ste-heading-icon"><Icon name={name} /></span><div><h2>{title}</h2><p>{description}</p></div>{aside}</header>{children}</section>;
}
function Copy({ value, label = "Copy value", iconOnly = false }: { value: string; label?: string; iconOnly?: boolean }) {
  const [message, setMessage] = useState("");
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 2400); return () => clearTimeout(timer); }, [message]);
  return <button type="button" className={`ste-copy ${iconOnly ? "icon-only" : ""}`} title={message || label} aria-label={message || label} onClick={async () => { try { await navigator.clipboard.writeText(value); setMessage("Copied"); } catch { setMessage("Copy failed"); } }}><Icon name="copy" />{!iconOnly && <span>{message || label}</span>}{iconOnly && <span className="ste-sr" role="status">{message}</span>}</button>;
}
function Segments<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <div className="ste-segments" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} className={option.value === value ? "selected" : ""} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" className="ste-toggle" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}
function Preference({ icon, title, description, children }: { icon: string; title: string; description: string; children: ReactNode }) {
  return <div className="ste-preference"><Icon name={icon} /><div><strong>{title}</strong><small>{description}</small></div>{children}</div>;
}

export function Settings({ d, theme, onTheme }: { d: Dashboard; theme: Theme; onTheme: (theme: Theme) => void }) {
  const appearance = useAppearance();
  const cfg = d.config, net = d.net;
  const [probes, setProbes] = useState<Record<string, NodeProbe | "loading">>({});
  const [deployed, setDeployed] = useState<string | null>(null), [versionError, setVersionError] = useState(false);
  const mounted = useRef(true), probing = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; let stopped = false;
    get<{ web: string | null }>("/api/v1/version").then(v => { if (!stopped) setDeployed(v.web); }).catch(() => { if (!stopped) setVersionError(true); });
    return () => { stopped = true; mounted.current = false; };
  }, []);
  const endpoints = d.endpoints?.endpoints ?? [];
  const running = document.querySelector('script[src*="assets/index-"]')?.getAttribute("src")?.match(/index-([^.]+)\.js/)?.[1] ?? null;
  const deployedBuild = deployed?.match(/index-([^.]+)\.js/)?.[1] ?? null;
  const runProbe = async (endpoint: Endpoint) => {
    if (probing.current.has(endpoint.url)) return;
    probing.current.add(endpoint.url); setProbes(previous => ({ ...previous, [endpoint.url]: "loading" }));
    try { const result = await probeNode(endpoint.url); if (mounted.current) setProbes(previous => ({ ...previous, [endpoint.url]: result })); }
    finally { probing.current.delete(endpoint.url); }
  };
  const depth = cfg ? Number(cfg.features.signature_depth) : null;
  const facts: [string, string | null][] = cfg ? [
    ["Chain ID", cfg.chain_id],
    ["Currency", `${cfg.symbol} · base denom ${cfg.denom} (${cfg.decimals} decimals)`],
    ["Genesis", net?.genesis_time ? `${new Date(net.genesis_time).toISOString().slice(0, 10)} (${agoFrom(net.genesis_time)} ago)` : null],
    ["Tendermint2 RPC", cfg.rpc.join(", ") || null],
    ["tx-indexer", cfg.tx_indexer],
    ["Validators", net ? `${fmt(net.validators_active)} in the set · voting power ${fmt(net.voting_power)}` : null],
    ["Valoper profiles", net ? fmt(net.valoper_profiles) : null],
    ["Total supply", net?.supply ? gnotCompact(net.supply.total) : null],
  ] : [];
  const capabilityCards = cfg ? [
    { name: "Full history", icon: "archive", status: cfg.features.full_history ? "Since genesis" : "Partial", tone: cfg.features.full_history ? "ok" : "warn", note: "Every block and transaction from genesis is kept; nothing is pruned." },
    { name: "Commit signatures", icon: "shield", status: depth ? `Newest ${fmt(depth)} blocks` : "—", tone: depth ? "ok" : "muted", note: net?.signature_floor != null ? `Precommits are read down to height ${fmt(net.signature_floor)}; uptime and missed blocks cover that range.` : "Precommits are read for uptime and missed blocks." },
    { name: "Uptime windows", icon: "chart", status: cfg.features.signature_windows.map(w => fmt(w)).join(" · ") + " blocks", tone: "ok", note: "Signing uptime is reported over these trailing windows." },
    { name: "Live state", icon: "server", status: "ABCI queries", tone: "ok", note: "Balances, accounts, realm renders and source are read live from the RPC." },
    { name: "tx-indexer read-through", icon: "wifi", status: "Enabled", tone: "ok", note: "Blocks and transactions newer than the indexed head are fetched from the tx-indexer." },
    { name: "Analytics horizons", icon: "chart", status: "1h · 24h · 7d · 30d · 90d", tone: "ok", note: "Served from the full index by /api/v1/series, /metrics and /analytics." },
    { name: "Validator profiles", icon: "governance", status: net ? `${fmt(net.valoper_profiles)} profiles` : "r/gnops/valopers", tone: "ok", note: "Monikers and descriptions from the r/gnops/valopers realm." },
    { name: "Usernames", icon: "file", status: "r/sys/users", tone: "ok", note: "Addresses are shown as @name when registered." },
  ] : [];
  const indexer: { title: string; value: string; note: string; icon: string; extra?: ReactNode }[] = [
    { title: "Indexed head", value: fmt(net?.indexed_head), note: "Highest block in the explorer database.", icon: "archive" },
    { title: "Chain height", value: fmt(net?.chain_height), note: "Latest block reported by the RPC.", icon: "chain" },
    { title: "Lag", value: net?.lag_blocks == null ? "—" : `${fmt(net.lag_blocks)} blocks`, note: "Chain height minus indexed head.", icon: "clock" },
    { title: "Last indexer write", value: net?.indexer_updated_at ? `${agoFrom(net.indexer_updated_at)} ago` : "—", note: "When the indexer last recorded its sync state.", icon: "clock" },
    { title: "Explorer build", value: running ?? "Development", note: "The bundle running in this browser.", icon: "cube" },
    { title: "Deployed build", value: deployedBuild ?? (versionError ? "Unavailable" : "—"), note: "The bundle currently served by the API.", icon: "cube", extra: running && deployedBuild ? deployedBuild === running ? <Badge tone="ok">Current</Badge> : <button type="button" className="ste-action" onClick={() => location.reload()}>Reload</button> : undefined },
  ];
  const publicConfig = cfg ? JSON.stringify(cfg, null, 2) : "";
  const pending = (text: string) => <p className="ste-empty">{d.error ?? text}</p>;
  return <div className="ste-page">
    <Panel name="chain" title="Chain Configuration" description="Core information about the indexed chain." aside={<Badge><Icon name="lock" />Read only</Badge>}>
      <dl className="ste-facts">{facts.map(([label, value]) => <div className="ste-fact" key={label}><dt>{label}</dt><dd><span className={!value ? "muted" : ""} title={value ?? undefined}>{value && /^https:\/\/[^ ,]+$/.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value.replace(/^https:\/\/(www\.)?/, "")}</a> : value ?? "—"}</span>{value && <Copy value={value} label={`Copy ${label}`} iconOnly />}</dd></div>)}</dl>{!cfg && pending("Loading chain configuration…")}
    </Panel>
    <Panel name="server" title="Data Sources" description="The gno.land services this explorer reads from, probed by the server." aside={<a className="ste-action" href="#/endpoints">Network health ↗</a>}>
      <div className="ste-endpoint-scroll"><table className="ste-endpoint-table"><colgroup><col style={{ width: "4%" }} /><col style={{ width: "32%" }} /><col style={{ width: "14%" }} /><col style={{ width: "17%" }} /><col style={{ width: "13%" }} /><col style={{ width: "20%" }} /></colgroup><thead><tr><th>#</th><th>Endpoint</th><th>Role</th><th>Height</th><th>Latency</th><th>Actions</th></tr></thead><tbody>{endpoints.map((endpoint, i) => <tr key={endpoint.url}><td>{i + 1}</td><td><div className="ste-endpoint-name"><i className={endpoint.ok ? "ok" : "bad"} /><span><strong title={endpoint.url}>{host(endpoint.url)}</strong><small title={endpoint.moniker ?? undefined}>{endpoint.error ?? (endpoint.kind === "rpc" ? `${endpoint.version ?? "—"} · ${endpoint.network ?? "—"}` : "GraphQL")}</small></span></div></td><td><Badge tone={endpoint.ok ? "ok" : "bad"}>{roleLabel(endpoint)}</Badge></td><td className="ste-number">{fmt(endpoint.height)}</td><td className={`ste-number ${endpoint.ok ? "ok" : "muted"}`}>{endpoint.latency_ms === null ? "—" : `${endpoint.latency_ms} ms`}</td><td><div className="ste-endpoint-actions">{endpoint.kind === "rpc" && <button type="button" className="ste-action" disabled={probes[endpoint.url] === "loading"} title="Probe the endpoint from this browser" onClick={() => void runProbe(endpoint)}>{probes[endpoint.url] === "loading" ? "Probing…" : "Probe"}</button>}<details className="ste-menu"><summary aria-label={`Actions for ${endpoint.url}`}>···</summary><div>{endpoint.kind === "rpc" ? <a href={consoleLink(endpoint.url)}>Open RPC Console</a> : <a href={`${endpoint.url.replace(/\/+$/, "")}/graphql`} target="_blank" rel="noreferrer">GraphQL playground</a>}<Copy value={endpoint.url} label="Copy URL" /></div></details></div></td></tr>)}</tbody></table></div>
      {!endpoints.length && pending(d.endpoints ? "No endpoints reported." : "Loading endpoint list…")}
      {Object.entries(probes).map(([url, probe]) => <div className="ste-probe-result" key={url} role="status"><strong>{host(url)}</strong><span className={probe !== "loading" && probe.state === "ok" ? "ok" : "warn"}>{probe === "loading" ? "Probing…" : probe.state === "ok" ? `${probe.network ?? "—"} · height ${fmt(probe.latest)} · ${probe.catchingUp ? "catching up" : "synced"} · ${probe.latencyMs} ms from this browser` : probe.error}</span></div>)}
      <div className="ste-notice"><Icon name="info" /><p>The Tendermint2 RPC serves blocks, commits, validator sets and live state (ABCI queries); the tx-indexer serves decoded transactions and events. Neither can be switched from the explorer. Query the RPC directly in the <a href="#/rpc">RPC Console</a>.</p></div>
    </Panel>
    <Panel name="cube" title="Data Coverage" description="What this deployment indexes and serves.">
      <div className="ste-capabilities">{capabilityCards.map(card => <div className={`ste-capability ${card.tone}`} key={card.name}><span className="ste-capability-icon"><Icon name={card.icon} /></span><div><strong>{card.name}</strong><b>{card.status}</b><small>{card.note}</small></div></div>)}</div>{!cfg && pending("Loading deployment configuration…")}
    </Panel>
    <Panel name="lock" title="Security / Access" description="Access and connection information.">
      <div className="ste-security-row"><Icon name="code" /><strong>API mode</strong><p>Every explorer endpoint is a public, read-only GET.</p><Badge tone="ok">Read only</Badge></div>
      <div className="ste-security-row"><Icon name="shield" /><strong>CORS</strong><p>The explorer API serves same-origin browser requests.</p><Badge tone="warn">Same origin</Badge></div>
      <div className="ste-security-row"><Icon name="wifi" /><strong>Browser RPC</strong><p>The RPC Console posts straight to the endpoint; {(cfg?.rpc ?? []).filter(isCorsOpen).length ? "the configured public endpoints allow any origin" : "the endpoint must allow CORS"}.</p><Badge tone="ok">Direct</Badge></div>
      <div className="ste-security-row"><Icon name="file" /><strong>Public configuration</strong><p>The /api/v1/config response.</p>{publicConfig && <Copy value={publicConfig} label="Copy JSON" />}</div>
      <pre className="ste-config-code"><code>{publicConfig || "Loading configuration…"}</code></pre>
    </Panel>
    <Panel name="gear" title="Indexer Status" description="Where the block indexer stands, and which build you are running.">
      <div>{indexer.map(item => <div className="ste-indexer-row" key={item.title}><Icon name={item.icon} /><div><strong>{item.title}</strong><small>{item.note}</small></div><span className="ste-indexer-value"><code>{item.value}</code>{item.extra}</span></div>)}</div>{!net && pending("Loading indexer status…")}
    </Panel>
    <Panel name="monitor" title="Appearance" description="Customize how the explorer looks and feels.">
      <Preference icon="sun" title="Theme" description="Choose the interface color theme."><Segments label="Theme" value={theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} onChange={onTheme} /></Preference>
      <Preference icon="density" title="Density" description="Adjust table and settings row spacing."><Segments<Appearance["density"]> label="Density" value={appearance.density} options={[{ value: "compact", label: "Compact" }, { value: "default", label: "Default" }, { value: "spacious", label: "Spacious" }]} onChange={density => updateAppearance({ density })} /></Preference>
      <Preference icon="clock" title="Relative times" description="Show event ages instead of full UTC dates."><Toggle label="Relative times" checked={appearance.relativeTimes} onChange={relativeTimes => updateAppearance({ relativeTimes })} /></Preference>
      <Preference icon="motion" title="Reduce motion" description="Disable animations and smooth scrolling."><Toggle label="Reduce motion" checked={appearance.reduceMotion} onChange={reduceMotion => updateAppearance({ reduceMotion })} /></Preference>
      <Preference icon="code" title="Code font size" description="Text size for code blocks and JSON responses."><Segments<Appearance["codeSize"]> label="Code font size" value={appearance.codeSize} options={[{ value: 12, label: "12px" }, { value: 14, label: "14px" }, { value: 16, label: "16px" }]} onChange={codeSize => updateAppearance({ codeSize })} /></Preference>
      <div className="ste-preview"><span>Display preview</span><code>{JSON.stringify({ chain_id: cfg?.chain_id ?? null, head: d.net?.indexed_head ?? null })}</code><Timestamp value={d.net?.indexer_updated_at} /></div>
      <p className="ste-local-note">Preferences apply immediately and are remembered in this browser. Device motion preferences are also respected.</p>
    </Panel>
  </div>;
}
