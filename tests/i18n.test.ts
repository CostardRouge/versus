import { afterEach, describe, expect, it } from 'vitest';
import { detectLang, methodText, pct, plural, setLang, t } from '../src/i18n';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

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

describe('detectLang', () => {
  it('prefers the saved choice, then the browser, then English', () => {
    expect(detectLang('fr', 'en-US')).toBe('fr');
    expect(detectLang(undefined, 'fr-CA')).toBe('fr');
    expect(detectLang('de', 'es-ES')).toBe('en');
    expect(detectLang(undefined, undefined)).toBe('en');
  });
});
