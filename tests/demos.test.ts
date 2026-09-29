import { describe, expect, it } from 'vitest';
import { buildDemo, DEMOS, relabelDemos } from '../src/core/demos';
import { compute } from '../src/core/scoring';

describe('demos', () => {
  it('are identical every time they are built', () => {
    for (const d of DEMOS) {
      const a = buildDemo(d, 'en');
      const b = buildDemo(d, 'en');
      expect(a.history).toEqual(b.history);
      expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
      expect(a.history).toHaveLength(d.duels);
    }
  });

  it('produce the same ranking in both languages', () => {
    for (const d of DEMOS) {
      const en = compute(buildDemo(d, 'en')).order.map((i) => i.id);
      const fr = compute(buildDemo(d, 'fr')).order.map((i) => i.id);
      expect(fr).toEqual(en);
    }
  });

  it('describe colors as data, not images', () => {
    const d = DEMOS.find((x) => x.id === 'demo-backgrounds');
    if (!d) throw new Error('missing demo');
    const bg = buildDemo(d, 'en');
    expect(bg.items.every((i) => i.fill && i.img === null)).toBe(true);
  });

  it('translate titles and labels but keep user renames', () => {
    const d = DEMOS[0];
    if (!d) throw new Error('missing demo');
    const r = buildDemo(d, 'fr');
    const renamed = r.items[1];
    if (!renamed) throw new Error('missing item');
    renamed.label = 'Porto';
    relabelDemos([r], 'fr', 'en');
    expect(r.title).toBe('Next destination');
    expect(r.items[7]?.label).toBe('Seville');
    expect(renamed.label).toBe('Porto');
  });
});
