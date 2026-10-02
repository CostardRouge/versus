import type { BoardObject } from './board-object';

export interface Env {
  BOARDS: DurableObjectNamespace<BoardObject>;
  /** The static build (dist/): the app's page for its views, the 404 page for the rest. */
  ASSETS?: Fetcher;
  /** Board registry for the admin view (D1). Optional: without it, boards still work. */
  REGISTRY?: D1Database;
  /** The cards a board's links unfurl with (R2, bucket versus-images). Optional: without it, links get the site's card. */
  IMAGES?: R2Bucket;
  /** Per-IP limits: publications, and every other API request. Optional in local tools. */
  PUBLISH_LIMIT?: RateLimit;
  API_LIMIT?: RateLimit;
  /** Secret for the admin routes. Unset: the admin API is off. */
  ADMIN_TOKEN?: string;
  /** `review`: authors may publish pictures, shown once the admin approved them. Unset or anything else: no pictures. */
  IMAGES_UPLOAD?: string;
  /**
   * The server's key pair for notifications (VAPID, base64url: the public point and the private scalar), made
   * with `npm run vapid`. Both set: voters and authors may ask for notifications. Unset: notifications are off.
   */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** `1` lets push endpoints on localhost through (tests). */
  PUSH_LOCAL?: string;
  /** Turnstile secret key. Unset: publishing needs no check (local development). */
  TURNSTILE_SECRET?: string;
  /** Inactivity TTL override, in seconds (tests use a few seconds). Defaults to TTL_DAYS. */
  BOARD_TTL_SECONDS?: string;
  /** Voters a template page needs before it asks to be indexed (tests lower it). Defaults to TEMPLATE_INDEX_VOTERS. */
  TEMPLATE_INDEX_VOTERS?: string;
}
