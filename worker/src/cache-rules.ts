/** How long the edge cache keeps a response, and under what key (`cache.ts`); plain functions, tested in Node. */

/** How long a response is kept: `seconds`, capped by the CACHE_SECONDS variable (0 turns the cache off, as tests do). */
export function cacheSeconds(env: { CACHE_SECONDS?: string }, seconds: number): number {
  const raw = env.CACHE_SECONDS;
  const cap = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(cap) ? Math.max(0, Math.min(seconds, cap)) : seconds;
}

/**
 * What a response is kept under: its URL alone, since a visitor's own headers (a conditional request) must not shape
 * what others get, and the deployed version, since a page names the build's hashed files, which the next deploy no
 * longer serves.
 */
export function cacheKey(url: string, env: { VERSION?: { id: string } }): string {
  const key = new URL(url);
  if (env.VERSION) key.searchParams.set('__version', env.VERSION.id);
  return key.href;
}
