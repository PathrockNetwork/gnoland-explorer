/** Helpers shared by the route modules. */
import type pg from "pg";

/** Tiny TTL memo so a burst of dashboard polls costs one query, not N. */
export function memo<T>(ttlMs: number, fn: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let pending: Promise<T> | null = null;
  return () => {
    if (pending && Date.now() - at < ttlMs) return pending;
    at = Date.now();
    pending = fn().catch((e) => {
      at = 0; // never cache a failure
      throw e;
    });
    return pending;
  };
}

/** Same TTL memo, keyed so parameterised queries cache separately. */
export function memoBy<T>(ttlMs: number, fn: (key: string) => Promise<T>, maxKeys = 500): (key: string) => Promise<T> {
  const cache = new Map<string, { at: number; p: Promise<T> }>();
  return (key) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.p;
    if (cache.size >= maxKeys) cache.delete(cache.keys().next().value!);
    const p = fn(key).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, { at: Date.now(), p });
    return p;
  };
}

/**
 * Usernames for a set of addresses, as { address: name }. The indexer mirrors
 * gno.land/r/sys/users into `usernames`, so this never touches the RPC;
 * addresses without a name are simply absent.
 */
export async function resolveNames(pool: pg.Pool, addresses: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(addresses.filter((a): a is string => !!a && a.startsWith("g1")))];
  if (!list.length) return {};
  const { rows } = await pool.query<{ address: string; name: string }>(
    `select address, name from usernames where address = any($1) and name is not null`,
    [list],
  );
  return Object.fromEntries(rows.map((r) => [r.address, r.name]));
}
