/**
 * Pure helpers behind the Overview page. Everything here is derived from API
 * data; nothing is estimated beyond what the formula states.
 */
import type { Network, SeriesPoint, Validator } from "./api";

/** Drops the partial first and last minute so per-minute counts aren't understated. */
export function fullMinutes<T>(rows: T[]): T[] {
  return rows.length > 2 ? rows.slice(1, -1) : rows;
}

/** Seconds per block for each full minute (null for a minute without blocks). */
export function minuteBlockTimes(rows: Network["recent_minutes"]): (number | null)[] {
  return fullMinutes(rows).map((m) => (m.blocks > 0 ? 60 / m.blocks : null));
}

/** Summary of a numeric series; empty input gives nulls, never zeros. */
export function summary(values: number[]) {
  const v = values.filter((x) => Number.isFinite(x));
  return {
    count: v.length,
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
    avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
    sum: v.reduce((a, b) => a + b, 0),
    latest: v.at(-1) ?? null,
  };
}

/**
 * Transactions in the latest 12 buckets vs. the 12 before them (one bucket is
 * 15 minutes for the 24 h series, so: last 3 h vs. the 3 h before). Null when
 * either half is missing or the earlier half had no transactions.
 */
export function recentChange(points: SeriesPoint[], key: "txs" | "senders" = "txs", span = 12): number | null {
  if (points.length < span * 2) return null;
  const recent = points.slice(-span).reduce((a, p) => a + p[key], 0);
  const prior = points.slice(-span * 2, -span).reduce((a, p) => a + p[key], 0);
  if (prior === 0) return null;
  return ((recent - prior) / prior) * 100;
}

const big = (s: string | null | undefined): bigint => (s && /^\d+$/.test(s) ? BigInt(s) : 0n);

/** part ÷ total as a 0–1 float without losing precision on 16-digit ugnot values. */
export function ratio(part: string | null | undefined, total: string | null | undefined): number | null {
  const t = big(total);
  if (t <= 0n) return null;
  return Number((big(part) * 1_000_000n) / t) / 1_000_000;
}

/** Uptime for the validator tile: the middle signature window when present (≈1k blocks). */
export function uptimeOf(v: Validator, windowIdx = 1): number | null {
  const u = v.uptime[windowIdx] ?? v.uptime[0] ?? null;
  return u === null || !Number.isFinite(u) ? null : u;
}

/** Validators currently in the set, by voting power then proposals. */
export function activeSet(validators: Validator[]): Validator[] {
  return validators.filter((v) => v.in_set).sort((a, b) => b.voting_power - a.voting_power || b.blocks_proposed - a.blocks_proposed);
}
