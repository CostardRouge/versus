/** How long the edge cache keeps a response, and under what key (`cache.ts`); plain functions, tested in Node. */

/** How long a response is kept: `seconds`, capped by the CACHE_SECONDS variable (0 turns the cache off, as tests do). */
export function cacheSeconds(env: { CACHE_SECONDS?: string }, seconds: number): number {
  const raw = env.CACHE_SECONDS;
  const cap = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(cap) ? Math.max(0, Math.min(seconds, cap)) : seconds;
}

/**
 * What a response is kept under: its address alone, since a visitor's own headers (a conditional request) must not
 * shape what others get, with only the query parameters the response depends on (`params`: any other one would make
 * a new copy at will), and the deployed version, since a page names the build's hashed files, which the next deploy
 * no longer serves.
 */
export function cacheKey(url: string, env: { VERSION?: { id: string } }, params: readonly string[] = []): string {
  const from = new URL(url);
  const key = new URL(`${from.origin}${from.pathname}`);
  for (const p of params) {
    const v = from.searchParams.get(p);
    if (v !== null) key.searchParams.set(p, v);
  }
  if (env.VERSION) key.searchParams.set('__version', env.VERSION.id);
  return key.href;
}
