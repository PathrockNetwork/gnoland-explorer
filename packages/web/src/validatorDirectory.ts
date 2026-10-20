/** gno.land validator directory: status, filtering and sorting over /api/v1/validators rows. */
import type { Validator, ValidatorList } from "./api";
import { pct } from "./lib";

export type ValidatorState = "active" | "degraded" | "candidate";
export type ValidatorFilter = "all" | "set" | "degraded" | "candidates";
export type ValidatorSort = "power" | "uptime" | "proposed" | "recent" | "last" | "name";

/** Nominal uptime windows; the API shrinks a window while fewer signatures have been read. */
export const NOMINAL_WINDOWS = [100, 1000, 10000];

export function validatorName(v: Pick<Validator, "moniker" | "address">): string {
  return v.moniker?.trim() || `${v.address.slice(0, 10)}…${v.address.slice(-4)}`;
}

/**
 * active    — in the consensus set and signing.
 * degraded  — in the set but missed a precommit in the shortest window, or on a missed streak now.
 * candidate — a valopers profile that is not in the set.
 */
export function validatorState(v: Validator): ValidatorState {
  if (!v.in_set) return "candidate";
  if ((v.missed_streak ?? 0) > 0 || (v.missed[0] ?? 0) > 0) return "degraded";
  return "active";
}

export function matchesValidatorFilter(v: Validator, filter: ValidatorFilter): boolean {
  if (filter === "all") return true;
  if (filter === "set") return v.in_set;
  if (filter === "candidates") return !v.in_set;
  return validatorState(v) === "degraded";
}

export function matchesQuery(v: Validator, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return [v.moniker, v.address, v.operator, v.operator_name, v.server_type].some((s) => s?.toLowerCase().includes(q));
}

const uptimeOf = (v: Validator) => v.uptime[v.uptime.length - 1] ?? v.uptime[0] ?? -1;

export function sortValidators(rows: Validator[], sort: ValidatorSort, descending: boolean): Validator[] {
  const key = (v: Validator): number | string => {
    switch (sort) {
      case "power": return v.voting_power * 1e9 + v.blocks_proposed;
      case "uptime": return uptimeOf(v);
      case "proposed": return v.blocks_proposed;
      case "recent": return v.proposed_recent;
      case "last": return v.last_proposed_height ?? -1;
      case "name": return validatorName(v).toLowerCase();
    }
  };
  const dir = descending ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return c * dir || validatorName(a).localeCompare(validatorName(b));
  });
}

/** Smallest number of set members whose voting power exceeds ⅓ of the total. */
export function nakamotoCoefficient(validators: Validator[]): number | null {
  const powers = validators.filter((v) => v.in_set).map((v) => v.voting_power).sort((a, b) => b - a);
  const total = powers.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < powers.length; i++) {
    acc += powers[i];
    if (acc * 3 > total) return i + 1;
  }
  return null;
}

/** "100%", "99.82%"; null → "—". Values are fractions 0–1. */
export function uptimeText(u: number | null | undefined): string {
  if (u == null || !Number.isFinite(u)) return "—";
  const p = u * 100;
  return pct(p, p === 100 ? 0 : 2);
}

export function uptimeTone(u: number | null | undefined): "ok" | "warn" | "bad" | "" {
  if (u == null) return "";
  return u >= 0.99 ? "ok" : u >= 0.9 ? "warn" : "bad";
}

/** Window label like "1k" for 1000; flagged partial while fewer blocks have been read than nominal. */
export function windowInfo(list: ValidatorList | null, i: number): { label: string; size: number | null; partial: boolean } {
  const nominal = NOMINAL_WINDOWS[i] ?? list?.windows[i] ?? 0;
  const size = list?.windows[i] ?? null;
  return { label: nominal >= 1000 ? `${nominal / 1000}k` : String(nominal), size, partial: size !== null && size < nominal };
}

export const SERVER_TYPES: Record<string, string> = { cloud: "Cloud", "on-prem": "On-prem", "data-center": "Data center" };
export const serverLabel = (s: string | null | undefined) => (s ? SERVER_TYPES[s] ?? s : "—");

/** First paragraph of a valoper description with markdown markers stripped, for one-line previews. */
export function descriptionPreview(text: string | null | undefined, max = 180): string {
  if (!text) return "";
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
