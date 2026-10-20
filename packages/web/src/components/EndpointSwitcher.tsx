/**
 * Header status indicator for the explorer's upstream data sources.
 *
 * gno.land has one public Tendermint2 RPC (rpc.gno.land) and the official
 * tx-indexer (indexer.gno.land). Neither is ours to switch, so this is a
 * read-only health readout: the server probes both, and the dropdown shows
 * what each answered plus the API's own RPC client state.
 */
import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Endpoint } from "../api";
import { BAD, OK, TX, TX2, TX3, WARN, mono, sans } from "./ui";
import { fmt } from "../lib";

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const label = (e: Endpoint) => (e.kind === "rpc" ? "TM2 RPC" : "tx-indexer");
const toneOf = (e: Endpoint) => (!e.ok ? BAD : e.catching_up ? WARN : OK);

export function EndpointSwitcher({ d }: { d: Dashboard }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const endpoints = d.endpoints?.endpoints ?? [];
  const client = d.endpoints?.client ?? d.net?.rpc ?? [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (endpoints.length === 0) return null;

  const healthy = endpoints.filter((e) => e.ok).length;
  const dot = healthy === endpoints.length ? (endpoints.some((e) => e.catching_up) ? WARN : OK) : healthy === 0 ? BAD : WARN;
  const rpc = endpoints.find((e) => e.kind === "rpc") ?? endpoints[0];

  return (
    <div ref={ref} className="endpoint-switcher" style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Health of the gno.land RPC and tx-indexer this explorer reads from"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 32,
          padding: "0 11px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          color: TX,
          font: `600 14px/1 ${sans}`,
          cursor: "pointer",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "none" }} />
        {host(rpc.url)}
        <span style={{ font: `400 13px/1 ${mono}`, color: TX3 }}>{rpc.latency_ms != null ? `${rpc.latency_ms}ms` : "—"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 38,
            zIndex: 50,
            width: 340,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: 10,
            border: "1px solid var(--line2)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ font: `600 14px/1 ${sans}`, color: TX }}>Data sources</div>
            <div style={{ font: `400 13px/1.45 ${sans}`, color: TX3, marginTop: 4 }}>
              Live state comes from the Tendermint2 RPC; decoded transactions from the official tx-indexer. Both are
              probed by the explorer server.
            </div>
          </div>

          {endpoints.map((e) => (
            <div key={e.url} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: toneOf(e) }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ font: `600 14px/1 ${sans}`, color: TX }}>{host(e.url)}</span>
                  <span style={{ font: `600 11px/1 ${sans}`, color: "var(--brand)", textTransform: "uppercase" }}>{label(e)}</span>
                </div>
                {e.kind === "rpc" && (
                  <span
                    style={{ font: `400 12px/1.2 ${mono}`, color: TX3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={e.moniker ?? ""}
                  >
                    {e.version ?? "—"} · {e.peers ?? "—"} peers{e.catching_up ? " · catching up" : ""}
                  </span>
                )}
                <span style={{ font: `400 13px/1 ${mono}`, color: e.error ? BAD : TX2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.error ?? ""}>
                  {e.error ? e.error : `height ${fmt(e.height)} · ${e.latency_ms ?? "—"}ms`}
                </span>
              </div>
            </div>
          ))}

          {client.length > 0 && (
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", font: `400 13px/1.45 ${sans}`, color: TX2 }}>
              API read-through:{" "}
              {client.map((c, i) => (
                <span key={c.url} style={{ color: c.healthy ? OK : BAD }}>
                  {i > 0 && ", "}
                  {host(c.url)} {c.healthy ? "ok" : "unhealthy"}
                </span>
              ))}
            </div>
          )}

          <a href="#/endpoints" onClick={() => setOpen(false)} style={{ display: "block", padding: "9px 12px", font: `400 13px/1.4 ${sans}`, color: "var(--brand)" }}>
            Latency measured from the explorer server · Network page →
          </a>
        </div>
      )}
    </div>
  );
}
