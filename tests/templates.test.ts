import { describe, expect, it } from 'vitest';
import { LIMITS, parsePublish } from '../src/core/board';
import {
  OFFICIAL_VOTER,
  TEMPLATE_INDEX_VOTERS,
  TEMPLATE_LANGS,
  TEMPLATES,
  templateByKey,
  templateBySlug,
  templateInput,
  templateItems,
  templatePath,
} from '../src/core/templates';

/** The official templates: fixed data every page and board is built from. */

describe('templates', () => {
  it('have unique keys and slugs, and a title and an intro in each language', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const lang of TEMPLATE_LANGS) {
      const slugs = TEMPLATES.map((t) => t.slug[lang]);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const t of TEMPLATES) {
        expect(t.slug[lang], t.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(t.title[lang].length, t.key).toBeLessThanOrEqual(LIMITS.title);
        expect(t.title[lang].trim(), t.key).not.toBe('');
        // The intro is the page's description: it has to fit a search snippet.
        expect(t.intro[lang].length, t.key).toBeGreaterThanOrEqual(60);
        expect(t.intro[lang].length, t.key).toBeLessThanOrEqual(160);
      }
    }
    // The key is the English slug.
    for (const t of TEMPLATES) expect(t.key).toBe(t.slug.en.replace(/-films$/, '').replace(/-services$/, ''));
  });

  it('publish as valid boards in each language, with distinct items and stable ids', () => {
    for (const t of TEMPLATES) {
      for (const lang of TEMPLATE_LANGS) {
        const input = templateInput(t, lang);
        const parsed = parsePublish(input);
        expect(parsed.ok, `${t.key} ${lang}`).toBe(true);
        expect(input.voter).toBe(OFFICIAL_VOTER);
        expect(input.lang).toBe(lang);
        expect(input.duels).toEqual([]);
        expect(input.settings).toMatchObject({ method: 'bt', visibility: 'always' });
        const labels = input.items.map((it) => it.label.toLowerCase());
        expect(new Set(labels).size, `${t.key} ${lang}`).toBe(labels.length);
        expect(input.items.length).toBeGreaterThanOrEqual(8);
        expect(input.items.length).toBeLessThanOrEqual(LIMITS.items);
        expect(input.items.map((it) => it.id)).toEqual(input.items.map((_, i) => `t${i}`));
        for (const it of input.items) expect(it.img).toBeNull();
      }
      // The same item has the same id in both languages (the pages link to one board per language anyway).
      expect(templateItems(t, 'en').map((it) => it.id)).toEqual(templateItems(t, 'fr').map((it) => it.id));
    }
  });

  it('are found by slug in their language, and by key', () => {
    const consoles = templateByKey('game-consoles');
    expect(consoles?.title.en).toBe('The best game console of all time');
    expect(templateBySlug('en', 'game-consoles')).toBe(consoles);
    expect(templateBySlug('fr', 'consoles-de-jeu')).toBe(consoles);
    expect(templateBySlug('fr', 'game-consoles')).toBeUndefined();
    expect(templateBySlug('en', 'nothing')).toBeUndefined();
    expect(templateByKey('nothing')).toBeUndefined();
    if (consoles) {
      expect(templatePath(consoles, 'en')).toBe('t/game-consoles/');
      expect(templatePath(consoles, 'fr')).toBe('fr/t/consoles-de-jeu/');
    }
    expect(TEMPLATE_INDEX_VOTERS).toBeGreaterThan(0);
  });

  it('keep colors for the color template only, with a fill per item', () => {
    const colors = templateByKey('colors');
    expect(colors?.items.every((it) => it.fill?.type === 'solid')).toBe(true);
    for (const t of TEMPLATES) if (t.key !== 'colors') expect(t.items.some((it) => it.fill)).toBe(false);
  });
});
