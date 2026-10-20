/** Formatting, identicon and SVG-geometry helpers ported from the mockup. */

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function secs(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}s`;
}

/** Consensus addresses are long hex; the mockup shows head-6 … tail-4. */
export function short(a: string | null | undefined): string {
  if (!a) return "—";
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} d`;
}

export function agoFrom(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return agoText((now - t) / 1000);
}

/** Flag emoji for a 2-letter country code ("MT" → 🇲🇹); "" when unknown. */
export function flag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const base = 0x1f1e6 - 65; // 'A' → regional indicator A
  const cc = code.toUpperCase();
  return String.fromCodePoint(base + cc.charCodeAt(0), base + cc.charCodeAt(1));
}

/** FNV-1a — deterministic identicon seed from an address. */
export function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export type Identicon = { hue: number; cells: string[]; chip: string };

/**
 * A 4×4 horizontally-mirrored bit grid keyed off the address hash — the same
 * construction the mockup uses, so a given address renders identically.
 */
export function identicon(address: string): Identicon {
  const h = hash(address);
  const hue = h % 340;
  const bits: number[] = [];
  for (let row = 0; row < 4; row++) {
    const a = (h >> (row * 4)) & 1;
    const b = (h >> (row * 4 + 2)) & 1;
    bits.push(a, b, b, a);
  }
  return {
    hue,
    cells: bits.map((b) => (b ? `hsl(${hue} 68% 58%)` : "transparent")),
    chip: `hsl(${hue} 60% 50% / .16)`,
  };
}

/**
 * Gaps in a bucketed series are carried forward rather than drawn as zero — a
 * minute with no blocks means "no sample", not "block time collapsed".
 */
export function fill(values: (number | null)[]): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) last = v;
    if (last !== null) out.push(last);
  }
  return out;
}

/** Polyline points for a series clamped into [min,max] over a w×h viewBox. */
export function pts(arr: number[], w: number, h: number, min: number, max: number): string {
  const n = arr.length;
  if (n === 0) return "";
  if (n === 1) {
    const y = h - ((clamp(arr[0], min, max) - min) / (max - min)) * h;
    return `0,${y.toFixed(1)} ${w},${y.toFixed(1)}`;
  }
  return arr
    .map((v, i) => {
      const x = ((i / (n - 1)) * w).toFixed(1);
      const y = (h - ((clamp(v, min, max) - min) / (max - min)) * h).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}

/** Closed path under the same polyline, for the soft area fill. */
export function area(arr: number[], w: number, h: number, min: number, max: number): string {
  const p = pts(arr, w, h, min, max);
  if (!p) return "";
  return `M0,${h} L${p.split(" ").join(" L")} L${w},${h} Z`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function clampPct(v: number, min: number, max: number): string {
  const t = ((v - min) / (max - min)) * 100;
  return `${Math.max(2, Math.min(100, t)).toFixed(0)}%`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard blocked (insecure origin) — the copy affordance just no-ops */
  }
}

/** CSV escaping for the validators export. */
export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c === null || c === undefined ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Head…tail truncation for bech32 addresses and hashes (secret1q9…7xk4). */
export function middle(a: string | null | undefined, head = 10, tail = 6): string {
  if (!a) return "—";
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

type DenomInfo = { display: string; base: string; exponent: number } | null | undefined;

/**
 * Base-denom amount → display units ("1613481588" uscrt → "1,613.48 SCRT").
 * String math up front so 15+ digit token counts don't lose precision before
 * rounding; unknown denoms (IBC vouchers) are shown raw with their denom.
 */
export function coin(amount: string | null | undefined, denom: string, info: DenomInfo, digits = 2): string {
  if (amount === null || amount === undefined || !/^\d+$/.test(amount)) return "—";
  if (!info || denom !== info.base) {
    const d = denom.startsWith("ibc/") ? `${denom.slice(0, 8)}…` : denom;
    return `${BigInt(amount).toLocaleString("en-US")} ${d}`;
  }
  const v = Number(amount) / 10 ** info.exponent;
  const shown =
    v !== 0 && Math.abs(v) < 10 ** -digits
      ? v.toPrecision(2)
      : v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return `${shown} ${info.display}`;
}

/** Compact display amount: 841,102,213.79 → "841.1M". */
export function compactUnits(amount: string | null | undefined, info: DenomInfo): string {
  if (!amount || !/^\d+$/.test(amount) || !info) return "—";
  const v = Number(amount) / 10 ** info.exponent;
  return v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/** Seconds → "4d 12h", "36m 22s"; for countdowns and periods. */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/* ── gno.land formatting ───────────────────────────────────────────────── */

/** Integer string → decimal string with `decimals`, trimmed, grouped. */
export function formatUnits(value: string | number | null | undefined, decimals = 6, maxFraction = 6): string {
  if (value === null || value === undefined) return "—";
  const str = typeof value === "number" ? Math.round(value).toString() : value;
  if (!/^-?\d+$/.test(str)) return "—";
  const v = BigInt(str);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (abs !== 0n && whole === 0n && !frac) return `<0.${"0".repeat(Math.max(0, maxFraction - 1))}1`;
  return `${neg ? "-" : ""}${wholeStr}${frac ? `.${frac}` : ""}`;
}

/** ugnot → "1,234.5 GNOT". */
export const gnot = (ugnot: string | number | null | undefined, maxFraction = 4) =>
  ugnot === null || ugnot === undefined ? "—" : `${formatUnits(ugnot, 6, maxFraction)} GNOT`;

/** Compact GNOT: 1,333,000,221 → "1.33B GNOT". */
export function gnotCompact(ugnot: string | number | null | undefined): string {
  if (ugnot === null || ugnot === undefined || !/^\d+$/.test(String(ugnot))) return "—";
  const v = Number(BigInt(String(ugnot)) / 1000n) / 1000;
  return `${v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })} GNOT`;
}

/** A coin string or {amount, denom}: ugnot as GNOT, anything else verbatim. */
export function coinText(amount: string | null | undefined, denom: string | null | undefined): string {
  if (!amount) return "—";
  if (!denom || denom === "ugnot") return gnot(amount);
  return `${formatUnits(amount, 0)} ${denom.length > 24 ? `…${denom.slice(-20)}` : denom}`;
}

/** "100ugnot,5foo" → "0.0001 GNOT, 5 foo"; "" → "—". */
export function coinsText(coins: string | null | undefined): string {
  if (!coins) return "—";
  return coins
    .split(",")
    .map((c) => c.trim().match(/^(\d+)(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => coinText(m[1]!, m[2]!))
    .join(", ") || "—";
}

/** Bytes → "12.4 KB". */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 ** 2) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  if (abs < 1024 ** 3) return `${sign}${(abs / 1024 ** 2).toFixed(1)} MB`;
  return `${sign}${(abs / 1024 ** 3).toFixed(2)} GB`;
}

/** Human label for a message kind (`route/type`). */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "vm/exec":
      return "Call";
    case "vm/add_package":
      return "Deploy";
    case "vm/run":
      return "Run";
    case "bank/send":
      return "Send";
    case "vm/enable_package":
      return "Approve package";
    case "vm/reject_package":
      return "Reject package";
    default:
      return kind.split("/").pop() ?? kind;
  }
}

/** Short summary of what a transaction did: "Call r/gnoswap/router.ExactInSwap". */
export function txSummary(tx: { kinds: string[]; funcs: string[]; pkg_paths: string[]; messages?: { kind: string; value: Record<string, any> }[] }): string {
  const m = tx.messages?.[0];
  const extra = tx.kinds.length > 1 ? ` +${tx.kinds.length - 1}` : "";
  if (m?.kind === "MsgCall") return `${shortPath(m.value.pkg_path)}.${m.value.func}${extra}`;
  if (m?.kind === "MsgAddPackage") return `Deploy ${shortPath(m.value.package?.path)}${extra}`;
  if (m?.kind === "MsgRun") return `Run script${extra}`;
  if (m?.kind === "BankMsgSend") return `Send ${coinsText(m.value.amount)}${extra}`;
  if (tx.funcs[0]) return shortPath(tx.funcs[0]) + extra;
  return (tx.kinds.map(kindLabel)[0] ?? "Tx") + extra;
}

/** "gno.land/r/gnoland/home" → "r/gnoland/home". */
export const shortPath = (p: string | null | undefined) => (p ? p.replace(/^gno\.land\//, "") : "—");

/** Link to the package page in this explorer. */
export const pkgHref = (path: string) => `#/realms/${path}`;
/** The same package on gnoweb (the chain's own web frontend). */
export const gnowebHref = (path: string, render = "") => `https://gno.land/${shortPath(path)}${render ? `:${render}` : ""}`;

/** Base64 hashes contain "/" and "+": route them as base64url. */
export const txSlug = (hash: string) => hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const txHref = (hash: string) => `#/transactions/${txSlug(hash)}`;
export const addrHref = (address: string) => `#/transactions/address/${address}`;
export const blockHref = (height: number) => `#/blocks/${height}`;

export const isAddr = (s: string) => /^g1[02-9ac-hj-np-z]{38}$/.test(s);
export const isTxHash = (s: string) => /^[A-Za-z0-9+/_-]{43}=?$/.test(s);
