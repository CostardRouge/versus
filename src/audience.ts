/**
 * Audience measurement in the browser (docs/analytics.md): Umami, self-hosted by the author, no cookie. The build
 * writes the tracker's settings into each page's head (build/analytics.ts); this module loads the tracker only
 * for a visitor who hasn't said no (the switch on the legal page, Do Not Track, Global Privacy Control), then
 * sends every view and event itself, automatic tracking off, so the address it records names a page and never a
 * ranking, a board or an author's key. Without settings in the page (development, tests, a build without
 * measurement), everything here does nothing.
 *
 * Shared by the home pages, the legal pages and the app; it imports only src/core/site.ts, which the build loads too. Not
 * named "analytics": the bundler names shared chunks after a module, and filter lists block files called that,
 * which would take the whole app down for anyone with a blocker.
 */

import { MEASUREMENT_ID } from './core/site.ts';

/** Settings written by the build (build/analytics.ts). */
interface Config {
  src: string;
  website: string;
  domains: string;
  /** This page's address on the site, the same on every host: `/`, `/fr/`, `/app/`… */
  page: string;
}
type Payload = Record<string, unknown>;
interface Umami {
  track(build: (base: Payload) => Payload): unknown;
}
declare global {
  interface Window {
    umami?: Umami;
  }
}

/** Anonymous facts attached to an event: never a title, a label or an address. */
export type EventData = Record<string, string | number | boolean>;
/** What this page does about measurement, for the switch on the legal page. */
export type Measurement = 'none' | 'signal' | 'off' | 'on';

/** The element holding the settings in the head. */
export const CONFIG_ID = MEASUREMENT_ID;
/** Umami's own opt-out key: the tracker checks it before every send too. */
export const OPT_OUT_KEY = 'umami.disabled';
/** Views and events waiting for the tracker; a tracker that never loads (offline, blocked) can't grow it past this. */
const MAX_QUEUE = 30;

type Status = 'idle' | 'loading' | 'ready' | 'off';
let status: Status = 'idle';
let queue: Array<(umami: Umami) => void> = [];
let config: Config | null | undefined;
/** The last view sent: repeated calls for the same page count once, and it is the next view's referrer. */
let last: string | null = null;

function settings(): Config | null {
  if (config !== undefined) return config;
  config = null;
  try {
    const c = JSON.parse(document.getElementById(CONFIG_ID)?.textContent ?? 'null') as Partial<Config> | null;
    if (c && typeof c.src === 'string' && typeof c.website === 'string' && typeof c.page === 'string') {
      config = { src: c.src, website: c.website, domains: String(c.domains ?? ''), page: c.page };
    }
  } catch {
    /* unreadable settings: no measurement */
  }
  return config;
}

/** This page's address on the site (`/app/` for the app), which the app extends with its views. */
export const pagePath = (): string => settings()?.page ?? '/';

/** The visitor switched measurement off in this browser (the legal page's switch, or Umami's key set by hand). */
export function optedOut(): boolean {
  try {
    return Boolean(localStorage.getItem(OPT_OUT_KEY));
  } catch {
    return false;
  }
}

/** The browser asks not to be tracked: Do Not Track, or Global Privacy Control, which Umami ignores on its own. */
export function privacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  return nav.globalPrivacyControl === true || dnt === '1' || dnt === 'yes';
}

export function measurement(): Measurement {
  if (!settings()) return 'none';
  if (privacySignal()) return 'signal';
  return optedOut() ? 'off' : 'on';
}

/** Turns measurement off or back on in this browser; it applies to the next page, and at once to anything queued. */
export function setOptOut(off: boolean): void {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage unavailable: the choice can't be kept */
  }
  if (off) stop();
}

function stop(): void {
  status = 'off';
  queue = [];
}

function flush(): void {
  if (status !== 'loading') return;
  const umami = window.umami;
  if (!umami || measurement() !== 'on') {
    stop();
    return;
  }
  status = 'ready';
  const waiting = queue;
  queue = [];
  for (const send of waiting) send(umami);
}

/**
 * Loads the tracker, once per page, unless the build doesn't measure or the visitor said no. Asynchronous and
 * appended by script: a slow or unreachable analytics server never delays the page, and automatic tracking stays
 * off (views and events come from here, with addresses stripped of search and fragment either way).
 */
export function startAnalytics(): void {
  if (status !== 'idle') return;
  const cfg = settings();
  if (!cfg || measurement() !== 'on') {
    stop();
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = cfg.src;
  Object.assign(script.dataset, {
    websiteId: cfg.website,
    domains: cfg.domains,
    autoTrack: 'false',
    doNotTrack: 'true',
    excludeSearch: 'true',
    excludeHash: 'true',
  });
  script.addEventListener('load', flush, { once: true });
  script.addEventListener('error', stop, { once: true });
  status = 'loading';
  document.head.append(script);
}

function send(fn: (umami: Umami) => void): void {
  if (status === 'off') return;
  const umami = window.umami;
  if (status === 'ready' && umami) {
    if (measurement() === 'on') fn(umami);
    return;
  }
  if (queue.length < MAX_QUEUE) queue.push(fn);
}

/** Where the visitor came from, when it's another site: its origin and path, never its query or fragment. */
function externalReferrer(): string {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === location.origin ? '' : `${ref.origin}${ref.pathname}`;
  } catch {
    return '';
  }
}

/**
 * The title every view and event reports: the page's own, as the build wrote it, read before anything changes it.
 * Never `document.title` later: the app names its tab after the ranking on screen, which is the visitor's own.
 */
const pageTitle = typeof document === 'undefined' ? '' : document.title;

/**
 * A page view, at `path` on the site (`/fr/`, `/app/demo/destinations`). The same path twice in a row counts
 * once; the previous view is the next one's referrer, as a page load would report it.
 */
export function trackView(path: string): void {
  if (path === last) return;
  const referrer = last ?? externalReferrer();
  const title = pageTitle;
  last = path;
  send((umami) => umami.track((base) => ({ ...base, url: path, referrer, title })));
}

/** The page's own view, for the static pages (home, legal). */
export const trackPage = (): void => trackView(pagePath());

/** An event on the current view, with anonymous facts only (docs/analytics.md lists them). */
export function trackEvent(name: string, data?: EventData): void {
  const url = last ?? pagePath();
  const title = pageTitle;
  send((umami) => umami.track((base) => ({ ...base, url, title, name, ...(data ? { data } : {}) })));
}
