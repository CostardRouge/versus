// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfig, analyticsTag } from '../build/analytics';
import { BODY_MARK, BOOT_MARK, fillPage } from '../build/seo-plugin';
import { CONTACT, LEGALS, PAGES } from '../build/site';
import { LEGAL_PATH } from '../src/app/about';
import { TTL_DAYS } from '../src/core/board';
import { legalEn } from '../src/i18n/legal-en';
import { legalFr } from '../src/i18n/legal-fr';
import { landingBody } from '../src/landing/markup';
import { BOARD_TTL_DAYS, legalBody } from '../src/legal/markup';

const OPTS = {
  contact: CONTACT,
  author: { name: 'Steeve Pommier', url: 'https://steevepommier.com/' },
  source: 'https://github.com/CostardRouge/versus',
};
const body = { en: legalBody('en', OPTS), fr: legalBody('fr', OPTS) } as const;
const placeholders = (v: string): string[] => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const levels = (html: string) => [...html.matchAll(/<h(\d)[\s>]/g)].map((m) => Number(m[1]));

describe('legal notice messages', () => {
  it('French covers exactly the English keys, with the same placeholders and markup', () => {
    expect(Object.keys(legalFr).sort()).toEqual(Object.keys(legalEn).sort());
    const markup = (v: string) => [...v.matchAll(/<\/?(\w+)/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(legalEn) as Array<keyof typeof legalEn>) {
      expect(placeholders(legalFr[key]), key).toEqual(placeholders(legalEn[key]));
      expect(markup(legalFr[key]), key).toEqual(markup(legalEn[key]));
      expect(legalFr[key].trim(), key).not.toBe('');
    }
  });
});

describe('legal pages', () => {
  it('live where the site and the app link to them', () => {
    for (const lang of ['en', 'fr'] as const) expect(PAGES[LEGALS[lang]].path).toBe(LEGAL_PATH[lang]);
  });

  it('state the real deletion delay of published rankings', () => {
    expect(BOARD_TTL_DAYS).toBe(TTL_DAYS);
    expect(body.en).toContain(`after ${TTL_DAYS} days without activity`);
  });

  it('have one h1, no skipped heading, and every placeholder filled', () => {
    for (const html of Object.values(body)) {
      const found = levels(html);
      expect(found.filter((l) => l === 1)).toHaveLength(1);
      for (let i = 1; i < found.length; i++) expect((found[i] ?? 0) - (found[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      expect(html).not.toMatch(/\{\w+\}/);
      expect(html).toContain(`href="mailto:${CONTACT}"`);
      expect(html).toContain('href="https://github.com/CostardRouge/versus/blob/main/LICENSE"');
    }
  });

  it('link to the other language and back to the site from their own folder', () => {
    expect(body.en).toContain('href="../fr/mentions-legales/" hreflang="fr"');
    expect(body.en).toContain('href="../app/"');
    expect(body.fr).toContain('href="../../legal/" hreflang="en"');
    expect(body.fr).toContain('href="../../fr/"');
    expect(body.fr).toContain('href="../../app/"');
  });

  it('are linked from the home pages’ footer', () => {
    const home = (lang: 'en' | 'fr') => landingBody(lang, { publish: false, author: OPTS.author, source: OPTS.source });
    expect(home('en')).toContain('href="./legal/"');
    expect(home('fr')).toContain('href="../fr/mentions-legales/"');
  });

  it('fill their shells, with the measurement settings in production', () => {
    for (const page of ['legal', 'legalFr'] as const) {
      const shell = readFileSync(resolve(process.cwd(), PAGES[page].file), 'utf8');
      expect(shell).toContain(BOOT_MARK);
      expect(shell).toContain(BODY_MARK);
      expect(shell).toContain('/src/legal/main.ts');
      const analytics = analyticsConfig({}, { production: true, url: 'https://versus.example.com/' });
      const out = fillPage(shell, page, { url: 'https://versus.example.com/', publish: false, head: [], analytics });
      expect(out).not.toContain('<!--');
      expect(out).toContain(analyticsTag(analytics ?? { src: '', website: '', domains: '' }, PAGES[page].path));
      expect(out).toContain(`<h1 class="lg-h">${(page === 'legal' ? legalEn : legalFr).title}</h1>`);
    }
  });
});

describe('the measurement switch', () => {
  const CONFIG = analyticsConfig({}, { production: true, url: 'https://versus.example.com/' });
  const state = () => document.getElementById('count')?.dataset.state;
  const visible = () =>
    [...document.querySelectorAll<HTMLElement>('#count span[data-when]')]
      .filter((el) => !el.hidden)
      .map((el) => el.textContent);
  const button = () => document.getElementById('count-toggle') as HTMLButtonElement;

  async function load(settings = true) {
    document.head.innerHTML = settings && CONFIG ? analyticsTag(CONFIG, 'legal/') : '';
    document.body.innerHTML = body.en;
    vi.resetModules();
    const { mountCount } = await import('../src/legal/mount');
    mountCount(document);
  }
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('starts hidden in the HTML, for pages without JavaScript', () => {
    expect(body.en).toMatch(/<div class="lg-count" id="count" hidden>/);
  });

  it('says what this browser does and turns counting off and back on', async () => {
    await load();
    expect(document.getElementById('count')?.hidden).toBe(false);
    expect(state()).toBe('on');
    expect(visible()).toEqual([legalEn.countOn, legalEn.countStop]);
    expect(button().hidden).toBe(false);
    button().click();
    expect(localStorage.getItem('umami.disabled')).toBe('1');
    expect(state()).toBe('off');
    expect(visible()).toEqual([legalEn.countOff, legalEn.countResume]);
    button().click();
    expect(localStorage.getItem('umami.disabled')).toBeNull();
    expect(state()).toBe('on');
  });

  it('hides the button when the build has no measurement', async () => {
    await load(false);
    expect(state()).toBe('none');
    expect(visible()).toEqual([legalEn.countNone]);
    expect(button().hidden).toBe(true);
  });
});
