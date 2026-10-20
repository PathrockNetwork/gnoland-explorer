import type { Validator } from "./api";
import { nakamotoCoefficient, validatorState } from "./validatorDirectory";

/** Set composition, server-type mix and the top proposers among the newest 1,000 blocks. */
export function validatorSummary(validators: Validator[]) {
  const counts = { active: 0, degraded: 0, candidate: 0 };
  for (const v of validators) counts[validatorState(v)]++;
  const set = validators.filter((v) => v.in_set);
  const servers = new Map<string, { set: number; all: number }>();
  for (const v of validators) {
    const key = v.server_type ?? "unknown";
    const s = servers.get(key) ?? { set: 0, all: 0 };
    s.all++;
    if (v.in_set) s.set++;
    servers.set(key, s);
  }
  const proposers = set.slice().sort((a, b) => b.proposed_recent - a.proposed_recent || b.blocks_proposed - a.blocks_proposed);
  const uptimes = set.map((v) => v.uptime[0]).filter((u): u is number => u !== null);
  return {
    counts,
    total: validators.length,
    inSet: set.length,
    power: set.reduce((a, v) => a + v.voting_power, 0),
    nakamoto: nakamotoCoefficient(validators),
    servers: [...servers.entries()].sort((a, b) => b[1].all - a[1].all),
    proposers,
    avgUptime: uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null,
  };
}
