import { afterEach, describe, expect, it } from 'vitest';
import { detectLang, methodText, pct, plural, setLang, t } from '../src/i18n';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { fill, intlLocale, pctText, pluralIsMany } from '../src/i18n/text';
import { unfurlPlural } from '../src/i18n/unfurl';

const placeholders = (v: unknown): string[] =>
  typeof v === 'string' ? [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort() : [];

afterEach(() => setLang('en'));

describe('translations', () => {
  it('French covers exactly the English keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('has no empty strings', () => {
    for (const [key, v] of Object.entries({ ...en, ...fr })) {
      if (typeof v === 'string') expect(v.trim(), key).not.toBe('');
    }
  });

  it('calls a published ranking one thing, never a board', () => {
    const said = (v: unknown): string => (typeof v === 'function' ? v({ n: 2, w: 1, l: 1, d: 1 }) : String(v));
    for (const [key, v] of Object.entries(en)) expect(said(v), key).not.toMatch(/\bboards?\b/i);
    for (const [key, v] of Object.entries(fr)) expect(said(v), key).not.toMatch(/\btableaux?\b/i);
  });

  it('names the Ranking tab the same on a card, and the record after the duel buttons', () => {
    for (const m of [en, fr]) {
      expect(m.result).toBe(m.tabResults);
      expect(m.colRecord).toBe([m.recW, m.recL, m.recD].join(' · '));
      expect(String(m.draw).startsWith(String(m.recD))).toBe(true);
    }
  });
});

describe('t', () => {
  it('fills placeholders', () => {
    expect(t('duelN', { n: 3 })).toBe('Duel #3');
    setLang('fr');
    expect(t('duelN', { n: 3 })).toBe('Duel n° 3');
  });

  it('supports function entries for agreement', () => {
    setLang('fr');
    expect(t('imagesAdded', { images: plural(2, 'image'), n: 2 })).toBe('2 images ajoutées');
    expect(t('imagesAdded', { images: plural(1, 'image'), n: 1 })).toBe('1 image ajoutée');
  });

  it('names every scoring method', () => {
    expect(methodText('bt').name).toBe('Balanced');
    setLang('fr');
    expect(methodText('sort').tech).toBe('Tri par insertion');
  });
});

describe('plural and numbers', () => {
  it('follows English rules', () => {
    expect(plural(0, 'item')).toBe('0 items');
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(2, 'duel')).toBe('2 duels');
    expect(pct(68)).toBe('68%');
  });

  it('follows French rules', () => {
    setLang('fr');
    expect(plural(0, 'item')).toBe('0 élément');
    expect(plural(1, 'item')).toBe('1 élément');
    expect(plural(2, 'item')).toBe('2 éléments');
    expect(pct(68)).toBe('68 %');
  });
});

describe('shared mechanics', () => {
  it('fills, counts and writes percentages the same way in every dictionary', () => {
    expect(fill('{n} of {total}{missing}', { n: 2, total: '5' })).toBe('2 of 5');
    expect([0, 1, 2].map((n) => pluralIsMany(n, 'fr'))).toEqual([false, false, true]);
    expect([0, 1, 2].map((n) => pluralIsMany(n, 'en'))).toEqual([true, false, true]);
    expect(pctText(42, 'fr')).toBe('42\u202F%');
    expect(pctText(42, 'en')).toBe('42%');
    expect(intlLocale('fr')).toBe('fr-FR');
    // The app's dictionary and the Worker's agree.
    setLang('fr');
    expect(pct(42)).toBe(pctText(42, 'fr'));
    expect(unfurlPlural('fr', 0, 'vote')).toBe('0 vote');
    expect(plural(0, 'vote')).toBe('0 vote');
  });
});

describe('detectLang', () => {
  it('prefers the saved choice, then the browser, then English', () => {
    expect(detectLang('fr', 'en-US')).toBe('fr');
    expect(detectLang(undefined, 'fr-CA')).toBe('fr');
    expect(detectLang('de', 'es-ES')).toBe('en');
    expect(detectLang(undefined, undefined)).toBe('en');
  });
});
