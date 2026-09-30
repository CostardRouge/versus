import type { BoardObject } from './board-object';

export interface Env {
  BOARDS: DurableObjectNamespace<BoardObject>;
  /** The static build (dist/): the app's page for its views, the 404 page for the rest. */
  ASSETS?: Fetcher;
  /** Board registry for the admin view (D1). Optional: without it, boards still work. */
  REGISTRY?: D1Database;
  /** Per-IP limits: publications, and every other API request. Optional in local tools. */
  PUBLISH_LIMIT?: RateLimit;
  API_LIMIT?: RateLimit;
  /** Secret for the admin routes. Unset: the admin API is off. */
  ADMIN_TOKEN?: string;
  /** Turnstile secret key. Unset: publishing needs no check (local development). */
  TURNSTILE_SECRET?: string;
  /** Inactivity TTL override, in seconds (tests use a few seconds). Defaults to TTL_DAYS. */
  BOARD_TTL_SECONDS?: string;
}
