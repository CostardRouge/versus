import { describe, expect, it } from 'vitest';
import {
  colorTwin,
  contrastOf,
  fillCode,
  fillCSS,
  fillInk,
  fillNeedsHalo,
  fillText,
  harmonies,
  hexToHsl,
  hslToHex,
  isHex,
  luminance,
  normHex,
  sameFill,
} from '../src/core/colors';
import type { Fill, Item } from '../src/core/types';
import { mulberry32 } from '../src/core/util';

describe('hex parsing', () => {
  it('accepts #rgb and #rrggbb only', () => {
    expect(isHex('#abc')).toBe(true);
    expect(isHex(' #A1B2C3 ')).toBe(true);
    expect(isHex('abc')).toBe(false);
    expect(isHex('#abcd')).toBe(false);
    expect(isHex('Kyoto')).toBe(false);
  });

  it('normalizes to lowercase #rrggbb', () => {
    expect(normHex('#ABC')).toBe('#aabbcc');
    expect(normHex('2743F5')).toBe('#2743f5');
  });
});

describe('conversions', () => {
  it('computes WCAG luminance', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
  });

  it('round-trips through HSL', () => {
    for (const hex of ['#2743f5', '#e4492a', '#12966b', '#808080']) {
      const [h, s, l] = hexToHsl(hex);
      expect(hslToHex(h, s, l)).toBe(hex);
    }
  });

  it('wraps hue and clamps saturation and lightness', () => {
    expect(hslToHex(360, 100, 50)).toBe(hslToHex(0, 100, 50));
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
    expect(hslToHex(0, 0, 150)).toBe('#ffffff');
  });

  it('suggests six distinct harmonies', () => {
    const h = harmonies('#2743f5');
    expect(h).toHaveLength(6);
    expect(new Set(h).size).toBe(6);
    for (const c of h) expect(isHex(c)).toBe(true);
  });
});

describe('fills', () => {
  it('renders a solid fill as a flat color', () => {
    expect(fillCSS({ type: 'solid', colors: ['#2743F5'] })).toBe('#2743f5');
  });

  it('renders a gradient with every stop', () => {
    const css = fillCSS({ type: 'gradient', colors: ['#0b1d3a', '#1f7a8c', '#9fe2bf'] });
    for (const c of ['#0b1d3a', '#1f7a8c', '#9fe2bf']) expect(css).toContain(c);
    expect(css).toContain('linear-gradient');
  });

  it('picks readable text', () => {
    expect(fillInk({ type: 'solid', colors: ['#111111'] })).toBe('#ffffff');
    expect(fillInk({ type: 'solid', colors: ['#f2a516'] })).toBe('#15171d');
    // The caption sits at the bottom, over a gradient's last stops, not its average: gold → indigo is dark there.
    expect(fillInk({ type: 'gradient', colors: ['#f5c542', '#2b1a6e'] })).toBe('#ffffff');
    expect(fillInk({ type: 'gradient', colors: ['#2ec4b6', '#0b1d3a'] })).toBe('#ffffff');
  });

  it('reaches 4.5:1 under every caption, with a halo where no ink does on its own', () => {
    const rng = mulberry32(42);
    const hex = () =>
      `#${Math.floor(rng() * 0xffffff)
        .toString(16)
        .padStart(6, '0')}`;
    let halos = 0;
    for (let i = 0; i < 4000; i++) {
      const f: Fill = i % 2 ? { type: 'solid', colors: [hex()] } : { type: 'gradient', colors: [hex(), hex(), hex()] };
      const ink = luminance(fillInk(f));
      const under = f.type === 'solid' ? f.colors : f.colors.slice(1);
      const worst = Math.min(...under.map((c) => contrastOf(ink, luminance(c))));
      const other = luminance(fillInk(f) === '#ffffff' ? '#15171d' : '#ffffff');
      // The ink chosen is never the worse of the two…
      expect(worst).toBeGreaterThanOrEqual(Math.min(...under.map((c) => contrastOf(other, luminance(c)))));
      // …and a caption under 4.5:1 always gets its halo.
      expect(fillNeedsHalo(f)).toBe(worst < 4.5);
      if (fillNeedsHalo(f)) {
        halos++;
        expect(fillText(f)).toContain('text-shadow');
      }
    }
    expect(halos).toBeGreaterThan(0);
  });

  it('describes a fill by its codes', () => {
    expect(fillCode({ type: 'gradient', colors: ['#abc', '#2743f5'] })).toBe('#AABBCC → #2743F5');
  });

  it('finds another item with the same fill', () => {
    const item = (id: string, fill: Item['fill']): Item => ({ id, label: id, img: null, fill, h: 0 });
    const blue = { type: 'solid' as const, colors: ['#3e4c5e'] };
    const items = [item('a', blue), item('b', { type: 'solid', colors: ['#3E4C5E'] }), item('c', null)];
    expect(sameFill(blue, { type: 'gradient', colors: ['#3e4c5e', '#3e4c5e'] })).toBe(false);
    expect(colorTwin(items, 'a', blue)?.id).toBe('b');
    expect(colorTwin(items, 'b', blue)?.id).toBe('a');
    expect(colorTwin(items, 'a', { type: 'solid', colors: ['#d9a441'] })).toBeUndefined();
  });
});

describe('fills from untrusted storage', () => {
  it('writes only #rrggbb into CSS and color codes', () => {
    const f: Fill = { type: 'gradient', colors: ['#abc', 'red;background:url(//e)', '#123456'] };
    const css = fillCSS(f);
    expect(css).not.toMatch(/url|red|;/);
    expect(css).toContain('#aabbcc');
    expect(css).toContain('#000000');
    expect(fillCode(f)).toBe('#AABBCC → #000000 → #123456');
  });
});
