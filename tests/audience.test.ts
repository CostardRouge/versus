// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfig, analyticsTag } from '../build/analytics';
import { ANALYTICS } from '../build/site';

/**
 * Audience measurement: the settings the build writes (build/analytics.ts) and the browser module that loads
 * the tracker and sends views and events (src/audience.ts). Each test gets a fresh module, since it keeps the
 * page's state (tracker loaded or not, last view).
 */

type Audience = typeof import('../src/audience');
const URL_ = 'https://versus.steevepommier.com/';
const CONFIG = analyticsConfig({}, { production: true, url: URL_ });

async function page(opts: { config?: boolean; path?: string; title?: string } = {}): Promise<Audience> {
  const tag = opts.config === false || !CONFIG ? '' : analyticsTag(CONFIG, opts.path ?? 'app/');
  document.head.innerHTML = `<title>${opts.title ?? 'Versus'}</title>${tag}`;
  vi.resetModules();
  return import('../src/audience');
}
const tracker = () => document.head.querySelector<HTMLScriptElement>('script[src]');
/** The tracker's API as Umami defines it, recording the payloads it would send. */
function fakeUmami(): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  const base = { website: 'w', hostname: 'versus.steevepommier.com', url: '/raw/path', referrer: '', title: 'raw' };
  window.umami = { track: (build) => sent.push(build(base)) };
  return sent;
}

beforeEach(() => {
  localStorage.clear();
  delete window.umami;
  vi.restoreAllMocks();
});
afterEach(() => {
  document.head.innerHTML = '';
});

describe('build settings', () => {
  it('measures production builds only, unless asked', () => {
    expect(analyticsConfig({}, { production: false, url: URL_ })).toBeNull();
    expect(analyticsConfig({ VITE_UMAMI_DEV: 'true' }, { production: false, url: URL_ })).not.toBeNull();
    expect(CONFIG).toEqual({
      src: ANALYTICS.src,
      website: ANALYTICS.websiteId,
      domains: 'versus.steevepommier.com,costardrouge.github.io',
    });
  });

  it('is switched off by an empty website id, and overridden by the environment', () => {
    expect(analyticsConfig({ VITE_UMAMI_WEBSITE_ID: '' }, { production: true, url: URL_ })).toBeNull();
    const custom = analyticsConfig(
      {
        VITE_UMAMI_SRC: 'https://insight.example.com/insight',
        VITE_UMAMI_WEBSITE_ID: ' id ',
        VITE_UMAMI_DOMAINS: 'A.com, b.com',
      },
      { production: true, url: URL_ },
    );
    expect(custom).toEqual({ src: 'https://insight.example.com/insight', website: 'id', domains: 'a.com,b.com' });
    expect(analyticsConfig({ VITE_UMAMI_SRC: 'javascript:alert(1)' }, { production: true, url: URL_ })?.src).toBe(
      ANALYTICS.src,
    );
  });

  it('lets a new canonical host report', () => {
    const moved = analyticsConfig({}, { production: true, url: 'https://versus.example.com/' });
    expect(moved?.domains.split(',')).toContain('versus.example.com');
  });

  it('writes settings, not the tracker, with the page address from the site root', () => {
    const tag = analyticsTag({ src: 'https://x.example/i', website: 'id', domains: 'a.com' }, 'fr/');
    expect(tag).toBe(
      '<script type="application/json" id="analytics">{"src":"https://x.example/i","website":"id","domains":"a.com","page":"/fr/"}</script>',
    );
    const hostile = analyticsTag({ src: '</script><script>alert(1)', website: 'id', domains: '' }, '');
    expect(hostile.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('loading the tracker', () => {
  it('does nothing without settings', async () => {
    const a = await page({ config: false });
    expect(a.measurement()).toBe('none');
    a.startAnalytics();
    a.trackView('/app/');
    expect(tracker()).toBeNull();
  });

  it('appends it asynchronously, automatic tracking off, search and fragment excluded', async () => {
    const a = await page();
    expect(a.measurement()).toBe('on');
    a.startAnalytics();
    a.startAnalytics();
    const script = tracker();
    expect(document.head.querySelectorAll('script[src]')).toHaveLength(1);
    expect(script?.src).toBe(ANALYTICS.src);
    expect(script?.async).toBe(true);
    expect(script?.dataset).toMatchObject({
      websiteId: ANALYTICS.websiteId,
      domains: 'versus.steevepommier.com,costardrouge.github.io',
      autoTrack: 'false',
      doNotTrack: 'true',
      excludeSearch: 'true',
      excludeHash: 'true',
    });
  });

  it('never loads it for a visitor who switched it off', async () => {
    localStorage.setItem('umami.disabled', '1');
    const a = await page();
    expect(a.measurement()).toBe('off');
    a.startAnalytics();
    expect(tracker()).toBeNull();
  });

  it('never loads it when the browser sends Global Privacy Control or Do Not Track', async () => {
    const a = await page();
    const signal = (key: string, value: unknown) =>
      Object.defineProperty(navigator, key, { value, configurable: true });
    try {
      signal('globalPrivacyControl', true);
      expect(a.privacySignal()).toBe(true);
      expect(a.measurement()).toBe('signal');
      a.startAnalytics();
      expect(tracker()).toBeNull();
      signal('globalPrivacyControl', false);
      signal('doNotTrack', '1');
      expect(a.measurement()).toBe('signal');
      signal('doNotTrack', null);
      expect(a.measurement()).toBe('on');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl;
      delete (navigator as unknown as Record<string, unknown>).doNotTrack;
    }
  });
});

describe('views and events', () => {
  it('waits for the tracker, then sends clean addresses, each view once, the previous one as referrer', async () => {
    const a = await page();
    a.startAnalytics();
    a.trackView('/app/');
    a.trackView('/app/');
    a.trackView('/app/demo/destinations');
    a.trackEvent('ranking-created', { from: 'new' });
    const sent = fakeUmami();
    expect(sent).toHaveLength(0);
    tracker()?.dispatchEvent(new Event('load'));
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ url: '/app/', referrer: '', website: 'w' });
    expect(sent[1]).toMatchObject({ url: '/app/demo/destinations', referrer: '/app/' });
    expect(sent[2]).toMatchObject({ url: '/app/demo/destinations', name: 'ranking-created', data: { from: 'new' } });
    a.trackView('/app/b/:alias');
    expect(sent[3]).toMatchObject({ url: '/app/b/:alias', referrer: '/app/demo/destinations' });
  });

  it('reports the page’s own title, never the one the app gives its tab (a ranking’s name)', async () => {
    const a = await page({ title: 'Versus — Rank anything' });
    a.startAnalytics();
    document.title = 'Divorce lawyers shortlist · Versus';
    a.trackView('/app/r/:id');
    a.trackEvent('shared', { kind: 'ranking' });
    const sent = fakeUmami();
    tracker()?.dispatchEvent(new Event('load'));
    expect(sent.map((p) => p.title)).toEqual(['Versus — Rank anything', 'Versus — Rank anything']);
    expect(JSON.stringify(sent)).not.toContain('Divorce');
  });

  it('knows the page it is on', async () => {
    const a = await page({ path: 'fr/mentions-legales/' });
    expect(a.pagePath()).toBe('/fr/mentions-legales/');
    a.startAnalytics();
    a.trackPage();
    const sent = fakeUmami();
    tracker()?.dispatchEvent(new Event('load'));
    expect(sent[0]).toMatchObject({ url: '/fr/mentions-legales/' });
  });

  it('drops everything when the tracker fails to load, or when the visitor opts out', async () => {
    const a = await page();
    a.startAnalytics();
    a.trackView('/app/');
    const sent = fakeUmami();
    tracker()?.dispatchEvent(new Event('error'));
    tracker()?.dispatchEvent(new Event('load'));
    a.trackView('/app/demo/destinations');
    expect(sent).toHaveLength(0);

    const b = await page();
    b.startAnalytics();
    const later = fakeUmami();
    tracker()?.dispatchEvent(new Event('load'));
    b.trackView('/');
    b.setOptOut(true);
    expect(localStorage.getItem('umami.disabled')).toBe('1');
    b.trackView('/fr/');
    expect(later).toHaveLength(1);
    b.setOptOut(false);
    expect(localStorage.getItem('umami.disabled')).toBeNull();
    expect(b.measurement()).toBe('on');
  });

  it('keeps a bounded queue while the tracker is away', async () => {
    const a = await page();
    a.startAnalytics();
    for (let i = 0; i < 100; i++) a.trackView(`/app/${i}`);
    const sent = fakeUmami();
    tracker()?.dispatchEvent(new Event('load'));
    expect(sent.length).toBeLessThanOrEqual(30);
  });
});
