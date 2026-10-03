// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { drawCard, type Palette } from '../src/app/share-draw';
import { CARD_FORMATS, CARD_SIZES, type CardTexts, crowdSpec, duelSpec, duoSpec } from '../src/core/share';
import type { Item } from '../src/core/types';
import { installFakeCanvas } from './helpers/canvas';

/** The card drawing on its own: a spec, a format, a palette and pictures in, a canvas out; no page, no app. */

const canvas = installFakeCanvas();
const P: Palette = {
  bg: '#eceef2',
  surface: '#fafbfd',
  surface2: '#e1e4eb',
  ink: '#13151b',
  muted: '#5a6072',
  line: '#d2d6df',
  a: '#2743f5',
  b: '#e4492a',
  onAccent: '#ffffff',
  display: 'serif',
  body: 'sans-serif',
  mono: 'monospace',
};
const TEXTS: CardTexts = {
  brand: 'Versus',
  crowd: 'Crowd',
  me: 'Me',
  agree: 'in agreement',
  question: 'Which one?',
  vote: 'Vote at',
  made: 'Made with Versus',
};
const items: Item[] = ['Margherita', 'Regina', 'Calzone', 'Napoli'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: i === 3 ? { type: 'gradient', colors: ['#2743f5', '#e4492a'] } : null,
  h: i * 90,
}));
const view = { title: 'Pizzas', items };
const crowd = {
  method: 'bt' as const,
  order: ['p2', 'p0', 'p1', 'p3'],
  stats: Object.fromEntries(items.map((it, i) => [it.id, { score: 1600 - i * 50, se: 20, w: 1, l: 1, d: 0 }])),
};
const [first, second] = items as [Item, Item];

describe('drawing a card', () => {
  const specs = {
    crowd: crowdSpec(view, crowd, '3 votes', 'https://versus.example/app/b/Ab3dEf7hJk', TEXTS, () => '1600'),
    duo: duoSpec(view, crowd, [{ a: 'p0', b: 'p1', s: 1 }], 'bt', '3 votes', 'https://versus.example/b/x', TEXTS),
    duel: duelSpec('Pizzas', first, second, 'https://versus.example/b/x?duel=p0.p1', TEXTS),
  };

  it('draws every kind in every format, at the format’s size', () => {
    for (const spec of Object.values(specs)) {
      for (const format of CARD_FORMATS) {
        const c = document.createElement('canvas');
        canvas.calls.length = 0;
        expect(drawCard(c, spec, format, P, new Map())).toBe(true);
        expect([c.width, c.height]).toEqual([CARD_SIZES[format].width, CARD_SIZES[format].height]);
        expect(canvas.calls).toContain('fillText');
      }
    }
  });

  it('says so where the browser has no 2D canvas', () => {
    const c = document.createElement('canvas');
    c.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
    expect(drawCard(c, specs.crowd, 'post', P, new Map())).toBe(false);
  });
});
