import type { SeriesPoint } from "./api";

/** Horizons offered on the Analytics page. Full history since genesis is kept, so every range is served. */
export const RANGES = [1, 24, 168, 720, 2160];
export function rangeLabel(hours: number) {
  if (hours < 24) return `${hours}h`;
  if (hours === 24) return "24h";
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}
/** Bucket size the API uses for a horizon (mirrors /api/v1/series). */
export const bucketSecsFor = (hours: number) => hours <= 1 ? 60 : hours <= 6 ? 300 : hours <= 24 ? 900 : hours <= 168 ? 3600 : 86_400;
export function bucketLabel(secs: number | undefined) {
  if (!secs) return "bucket";
  if (secs === 86_400) return "day";
  if (secs === 3600) return "hour";
  if (secs % 3600 === 0) return `${secs / 3600} hours`;
  return secs === 60 ? "minute" : `${secs / 60} minutes`;
}

export type ChartPoint = { t: number; value: number | null };
export type NumericKey = "blocks" | "txs" | "gas" | "fees" | "failed" | "senders" | "deploys" | "calls" | "sends" | "runs" | "storage_delta";

/** A bucket is complete when it lies wholly inside [start, end]. */
export const isComplete = (t: number, step: number, start: number, end: number) => t >= start && t + step <= end;

/**
 * Series values for a chart. A partial bucket (window edge, or the bucket
 * still filling) would read as a dip, so `completeOnly` turns it into a gap.
 * "block_time" is derived: bucket length ÷ blocks in the bucket, in seconds.
 */
export function seriesPoints(points: SeriesPoint[], key: NumericKey | "block_time", opts: { step: number; start: number; end: number; completeOnly?: boolean }): ChartPoint[] {
  return points
    .map(p => {
      const t = Date.parse(p.t);
      const complete = isComplete(t, opts.step, opts.start, opts.end);
      let value: number | null;
      if (key === "block_time") value = complete && p.blocks > 1 ? opts.step / 1000 / p.blocks : null;
      else value = opts.completeOnly && !complete ? null : Number(p[key]) || 0;
      return { t, value };
    })
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Keep missing readings and missing time buckets visible as gaps. */
export function chartSegments(points: ChartPoint[], step: number) {
  const segments: { t: number; value: number }[][] = [];
  let current: { t: number; value: number }[] = [];
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value)) { current = []; continue; }
    if (!current.length || point.t - current[current.length - 1].t > step * 1.5) { current = []; segments.push(current); }
    current.push({ t: point.t, value: point.value });
  }
  return segments;
}

export function seriesExtent(points: ChartPoint[]) {
  const values = points.flatMap(p => p.value !== null && Number.isFinite(p.value) ? [p.value] : []);
  return {
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    count: values.length,
  };
}

/** Round a domain ceiling up to 1, 2 or 5 × 10ⁿ so the axis labels read cleanly. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function chartDomain(points: ChartPoint[], floor: number): [number, number] {
  const { max } = seriesExtent(points);
  return [0, niceCeil(Math.max(floor, (max ?? 0) * 1.15))];
}

/** Window totals straight from the series (every bucket, partial edges included). */
export function seriesTotals(points: SeriesPoint[]) {
  const sum = (k: NumericKey) => points.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  return { blocks: sum("blocks"), txs: sum("txs"), failed: sum("failed"), fees: sum("fees"), gas: sum("gas"), deploys: sum("deploys"), calls: sum("calls"), sends: sum("sends"), runs: sum("runs"), storage: sum("storage_delta") };
}

export type MixBucket = { t: number; calls: number; sends: number; deploys: number; runs: number; complete: boolean; known: boolean };
/**
 * Transactions by kind per bucket, with empty buckets filled with zeros from
 * `from` (window start, or genesis when the window reaches back before it).
 */
export function mixBuckets(points: SeriesPoint[], step: number, from: number, end: number): MixBucket[] {
  const byT = new Map(points.map(p => [Date.parse(p.t), p]));
  const out: MixBucket[] = [];
  for (let t = Math.floor(from / step) * step; t < end; t += step) {
    const p = byT.get(t);
    out.push({ t, calls: p?.calls ?? 0, sends: p?.sends ?? 0, deploys: p?.deploys ?? 0, runs: p?.runs ?? 0, complete: isComplete(t, step, from, end), known: !!p });
  }
  return out;
}

/** Fee ÷ gas wanted is ugnot per gas unit; the chain quotes prices per 1,000 gas. */
export function gasPriceText(ugnotPerGas: number | null | undefined): string {
  if (ugnotPerGas === null || ugnotPerGas === undefined || !Number.isFinite(ugnotPerGas)) return "—";
  const per1k = ugnotPerGas * 1000;
  return `${per1k.toLocaleString("en-US", { maximumFractionDigits: per1k < 10 ? 3 : 1 })} ugnot / 1k gas`;
}

/** Large plain counts: 2,639,276,968 → "2.64B". */
export const compact = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
