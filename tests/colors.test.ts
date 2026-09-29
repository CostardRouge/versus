import { describe, expect, it } from 'vitest';
import {
  fillCode,
  fillCSS,
  fillInk,
  harmonies,
  hexToHsl,
  hslToHex,
  isHex,
  luminance,
  normHex,
} from '../src/core/colors';

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
  });

  it('describes a fill by its codes', () => {
    expect(fillCode({ type: 'gradient', colors: ['#abc', '#2743f5'] })).toBe('#AABBCC → #2743F5');
  });
});
