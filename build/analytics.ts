import { CONFIG_ID } from '../src/audience.ts';
import { ANALYTICS } from './site.ts';

/**
 * Build-time half of audience measurement (docs/analytics.md): which Umami instance, website id and hosts this
 * build reports to, written into each page's head as settings, not as the tracker's <script>. The page's own
 * script (src/audience.ts) loads the tracker only for a visitor who hasn't said no, so someone who switched it
 * off, or whose browser sends Do Not Track or Global Privacy Control, never contacts the analytics server.
 */

export interface AnalyticsConfig {
  /** The tracker's URL. */
  src: string;
  /** The site's key in the Umami dashboard. */
  website: string;
  /** Hosts allowed to report, comma-separated (the tracker's `data-domains`). */
  domains: string;
}

const list = (value: string): string[] =>
  value
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

/**
 * This build's measurement, or null for none. Production builds only (`npm run dev` and tests never count), unless
 * `VITE_UMAMI_DEV=true`; an empty `VITE_UMAMI_WEBSITE_ID` turns it off. The canonical host always reports, so a
 * new `VITE_SITE_URL` brings its domain along.
 */
export function analyticsConfig(
  env: Record<string, string | undefined>,
  opts: { production: boolean; url: string },
): AnalyticsConfig | null {
  if (!opts.production && env.VITE_UMAMI_DEV !== 'true') return null;
  const website = (env.VITE_UMAMI_WEBSITE_ID ?? ANALYTICS.websiteId).trim();
  if (!website) return null;
  let src: string = ANALYTICS.src;
  try {
    const custom = new URL(env.VITE_UMAMI_SRC?.trim() || ANALYTICS.src);
    if (custom.protocol === 'https:' || custom.protocol === 'http:') src = custom.href;
  } catch {
    /* an unusable address keeps the default tracker */
  }
  const domains =
    env.VITE_UMAMI_DOMAINS !== undefined
      ? list(env.VITE_UMAMI_DOMAINS)
      : [...new Set([new URL(opts.url).hostname, ...ANALYTICS.domains])];
  return { src, website, domains: domains.join(',') };
}

/**
 * The settings in the head, as JSON the page's script reads, with the page's address on the site (`/`, `/fr/`,
 * `/app/`…): the same on every host, whatever folder the site is served from (github.io/versus/). No preconnect
 * to the tracker's host: that alone would reach the server for visitors who said no.
 */
export function analyticsTag(config: AnalyticsConfig, page: string): string {
  const json = JSON.stringify({ ...config, page: `/${page}` }).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${CONFIG_ID}">${json}</script>`;
}
