import { cacheKey, cacheSeconds } from './cache-rules';
import type { Env } from './env';
import { errorText, log } from './log';

/**
 * The edge cache (the colo's `caches.default`) for what the public reads most: the Popular list, the template pages,
 * the sitemap and a shared board's page. A Worker's response is not cached by its Cache-Control alone: this keeps a
 * copy keyed by the URL (query included), so a burst of visits costs one build, one registry query, one board woken.
 */

/**
 * The response for a GET from the cache when it holds one, else built, and kept `seconds` when it is a 200 (the
 * copy says so in its Cache-Control, which the cache reads). Anything else is built every time.
 */
export async function cached(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  seconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const ttl = cacheSeconds(env, seconds);
  if (!ttl || req.method !== 'GET') return build();
  const key = new Request(cacheKey(req.url, env));
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await build();
  if (res.status !== 200) return res;
  const copy = new Response(res.clone().body, res);
  copy.headers.set('Cache-Control', `public, max-age=${ttl}`);
  ctx.waitUntil(cache.put(key, copy).catch((e: unknown) => log('cache_put_failed', { error: errorText(e) })));
  return res;
}
