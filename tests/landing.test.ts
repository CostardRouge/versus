import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appViews, BASE_MARK, BODY_MARK, BOOT_MARK, fillPage, HEAD_MARK, pageOf } from '../build/seo-plugin';
import { PAGES, type PageKey } from '../build/site';
import { landingEn } from '../src/i18n/landing-en';
import { landingFr } from '../src/i18n/landing-fr';
import { HERO, ITEMS, PASTRIES, TOPICS } from '../src/landing/data';
import { APP_PATH, HOME_PATH, h1Text, landingBody, landingBoot, type PageData } from '../src/landing/markup';
import { SPRITE } from '../src/landing/sprite';
import { strings } from '../src/landing/strings';

const OPTS = {
  publish: true,
  author: { name: 'Steeve Pommier', url: 'https://steevepommier.com/' },
  source: 'https://github.com/CostardRouge/versus',
};
const body = { en: landingBody('en', OPTS), fr: landingBody('fr', OPTS) } as const;

const placeholders = (v: string): string[] => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const tags = (html: string) => [...html.matchAll(/<(\w+)([^>]*)>/g)];
const levels = (html: string) => [...html.matchAll(/<h(\d)[\s>]/g)].map((m) => Number(m[1]));
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const data = (html: string): PageData =>
  JSON.parse(html.match(/<script type="application\/json" id="landing-data">([\s\S]*?)<\/script>/)?.[1] ?? '{}');

describe('home page messages', () => {
  it('French covers exactly the English keys, with the same placeholders', () => {
    expect(Object.keys(landingFr).sort()).toEqual(Object.keys(landingEn).sort());
    for (const key of Object.keys(landingEn) as Array<keyof typeof landingEn>) {
      expect(placeholders(landingFr[key]), key).toEqual(placeholders(landingEn[key]));
      expect(landingFr[key].trim(), key).not.toBe('');
      expect(landingEn[key].trim(), key).not.toBe('');
    }
  });

  it('keeps the same inline markup in both languages', () => {
    const markup = (v: string) => [...v.matchAll(/<\/?(\w+)/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(landingEn) as Array<keyof typeof landingEn>) {
      expect(markup(landingFr[key]), key).toEqual(markup(landingEn[key]));
    }
  });

  it('rotates as many examples in the h1 in both languages', () => {
    expect(landingFr.rotWords.split('|')).toHaveLength(landingEn.rotWords.split('|').length);
  });

  it('borrows the duel controls and method names from the app', () => {
    expect(strings('en').question).toBe('Which one do you prefer?');
    expect(strings('fr').m_bt).toBe('Équilibré');
    expect(strings('fr').lang).toBe('fr');
  });
});

describe('home page content', () => {
  for (const lang of ['en', 'fr'] as const) {
    const html = body[lang];
    const S = strings(lang);

    it(`${lang}: has one h1, reading as the tagline, and never skips a heading level`, () => {
      const found = levels(html);
      expect(found.filter((l) => l === 1)).toHaveLength(1);
      expect(found[0]).toBe(1);
      for (let i = 1; i < found.length; i++) expect((found[i] ?? 0) - (found[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      const h1 = text(html.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? '');
      expect(h1).toBe(h1Text(S));
    });

    it(`${lang}: carries enough text for search engines, in its own language`, () => {
      expect(text(html).split(' ').length).toBeGreaterThan(600);
      expect(html).toContain(S.howTitle);
      expect(html).toContain(S.m_sort_desc);
      expect(html).not.toContain(strings(lang === 'en' ? 'fr' : 'en').howTitle);
    });

    it(`${lang}: links to the app, the other language and the sections it has`, () => {
      const root = HOME_PATH[lang] ? '../' : './';
      expect(html).toContain(`href="${root}${APP_PATH}"`);
      expect(html).toContain(`href="${root}${HOME_PATH.fr}" hreflang="fr" lang="fr"`);
      const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
      for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(id), id).toBe(true);
      expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    });

    it(`${lang}: marks the other language's suggestion with its own lang, in a landmark of its own`, () => {
      const other = lang === 'en' ? 'fr' : 'en';
      const O = strings(other);
      expect(html).toContain(
        `<aside class="lang-hint" id="lang-hint" lang="${other}" aria-label="${O.suggestAria}" hidden>`,
      );
      expect(html).toContain(O.suggestGo);
    });

    it(`${lang}: names its landmarks apart: the header's languages and the footer's`, () => {
      const navs = [...html.matchAll(/<nav [^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
      expect(navs).toContain(S.langAria);
      expect(navs).toContain(S.footLangAria);
      expect(new Set(navs).size).toBe(navs.length);
    });

    it(`${lang}: keeps the pause button's name, only its pressed state changing`, () => {
      expect(html).toContain(`id="pause" type="button" aria-pressed="false" aria-label="${S.pauseAnim}"`);
    });

    it(`${lang}: draws only pastries the sprite defines`, () => {
      for (const [, id] of html.matchAll(/<use href="#([^"]+)">/g)) expect(SPRITE, id).toContain(`<symbol id="${id}"`);
    });

    it(`${lang}: embeds the data its script needs, safely`, () => {
      const d = data(html);
      expect(d.S.lang).toBe(lang);
      expect(d.tryPair).toHaveLength(2);
      for (const m of ['bt', 'elo', 'win', 'sort'] as const) expect(d.methods.rows[m]).toHaveLength(PASTRIES.length);
      expect(d.methods.sortDuels).toBeLessThanOrEqual(17);
      const json = html.match(/id="landing-data">([\s\S]*?)<\/script>/)?.[1] ?? '';
      expect(json).not.toContain('<');
    });

    it(`${lang}: labels every button and gives no two elements the same id`, () => {
      const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [, , attrs] of tags(html).filter(([, t]) => t === 'button')) {
        expect(attrs, 'type').toContain('type="button"');
      }
    });
  }

  it('shows the crowd section only in builds that publish', () => {
    expect(body.en).toContain('id="crowd"');
    expect(landingBody('en', { ...OPTS, publish: false })).not.toContain('id="crowd"');
  });

  it('opens the hero on a pair of its own items, after its seed duels', () => {
    const ids = new Set(HERO.items.map((i) => i.id));
    for (const id of HERO.first) expect(ids.has(id)).toBe(true);
    for (const [a, b] of HERO.seed) expect(ids.has(a) && ids.has(b)).toBe(true);
  });

  it('gives every topic six items the page knows', () => {
    for (const t of TOPICS) {
      expect(t.items, t.id).toHaveLength(6);
      expect(ITEMS.has(t.thumb), t.thumb).toBe(true);
    }
  });
});

describe('boot script', () => {
  it('sends old app links and installed apps to the app, relative to each page', () => {
    expect(landingBoot('en')).toContain("leave('./app/' + location.hash)");
    expect(landingBoot('fr')).toContain("leave('../app/' + location.hash)");
    expect(landingBoot('fr')).toContain('display-mode: minimal-ui');
  });

  it('lets the installed app reach the home page through its own link', () => {
    // A runnable copy of the script, with the browser's answers stubbed: an app window, coming from the app or not.
    const run = (referrer: string) => {
      const left: string[] = [];
      const js = landingBoot('en').replace(/<\/?script>/g, '');
      const document = {
        documentElement: { classList: { add() {} }, dataset: {} as Record<string, string> },
        referrer,
      };
      const location = { hash: '', origin: 'https://versus.example.com', replace: (to: string) => left.push(to) };
      const matchMedia = () => ({ matches: true });
      const localStorage = { getItem: () => null };
      new Function('document', 'location', 'matchMedia', 'localStorage', js)(
        document,
        location,
        matchMedia,
        localStorage,
      );
      return left;
    };
    expect(run('')).toEqual(['./app/']);
    expect(run('https://elsewhere.example/')).toEqual(['./app/']);
    expect(run('https://versus.example.com/app/')).toEqual([]);
  });

  it('honors a language chosen before, only for visitors arriving from elsewhere', () => {
    const js = landingBoot('en');
    expect(js).toContain("prefs.lang !== 'en'");
    expect(js).toContain('document.referrer');
    expect(landingBoot('fr')).toContain("leave('../' +");
    // The page that redirects says so, and counts no view of its own.
    expect(js).toContain('d.dataset.leaving');
  });
});

describe('pages', () => {
  const read = (page: PageKey) => readFileSync(resolve(process.cwd(), PAGES[page].file), 'utf8');

  it('knows every HTML entry by its path', () => {
    for (const page of Object.keys(PAGES) as PageKey[]) expect(pageOf(PAGES[page].file)).toBe(page);
    expect(() => pageOf('elsewhere.html')).toThrow();
  });

  it('declares each page in its own language, with its placeholders', () => {
    for (const page of Object.keys(PAGES) as PageKey[]) {
      const html = read(page);
      expect(html).toContain(`<html lang="${PAGES[page].lang}">`);
      expect(html).toContain(HEAD_MARK);
      if (page === 'admin') {
        // The moderation page renders itself; only the head and the theme script are filled.
        expect(html).toContain(BOOT_MARK);
        expect(html).not.toContain(BODY_MARK);
      } else if (page !== 'app') {
        expect(html).toContain(BOOT_MARK);
        expect(html).toContain(BODY_MARK);
      } else {
        // The <base> comes before any relative address of the head.
        expect(html.indexOf(BASE_MARK)).toBeLessThan(html.indexOf(HEAD_MARK));
      }
    }
  });

  it("names the app's folder in its <base>, under the site's path", () => {
    const at = (path?: string) =>
      fillPage(read('app'), 'app', {
        url: 'https://versus.example.com/',
        publish: false,
        head: [],
        ...(path ? { path } : {}),
      });
    expect(at()).toContain('<base href="/app/" />');
    expect(at('/versus/')).toContain('<base href="/versus/app/" />');
  });

  it("answers the app's views with its page in development and preview, files untouched", () => {
    const run = (url: string) => {
      const req = { url };
      appViews(req, null, () => {});
      return req.url;
    };
    expect(run('/app/demo/destinations/ranking')).toBe('/app/index.html');
    expect(run('/app/b/Ab3dEf7hJk?x=1')).toBe('/app/index.html');
    expect(run('/app/')).toBe('/app/');
    expect(run('/app/index.html')).toBe('/app/index.html');
    expect(run('/assets/app-1.js')).toBe('/assets/app-1.js');
    expect(run('/fr/')).toBe('/fr/');
  });

  it('fills a home page completely, and refuses one without its placeholders', () => {
    const out = fillPage(read('homeFr'), 'homeFr', { url: 'https://versus.example.com/', publish: false, head: [] });
    expect(out).not.toContain('<!--');
    expect(out).toContain('<link rel="canonical" href="https://versus.example.com/fr/" />');
    expect(out).toContain(landingFr.heroChip);
    expect(() => fillPage('<html></html>', 'home', { url: 'https://x.example/', publish: false, head: [] })).toThrow(
      HEAD_MARK,
    );
  });
});
