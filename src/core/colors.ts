import type { Fill, Item } from './types';

/** True for #rgb or #rrggbb. */
export const isHex = (s: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

/** Lowercase #rrggbb form; accepts #rgb and a missing #. */
export function normHex(input: string): string {
  let h = input.trim().toLowerCase();
  if (!h.startsWith('#')) h = `#${h}`;
  return h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h;
}

export function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(normHex(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

/** HSL (degrees, %, %) to #rrggbb; hue wraps, saturation and lightness clamp. */
export function hslToHex(hue: number, sat: number, light: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, sat)) / 100;
  const l = Math.max(0, Math.min(100, light)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** CSS background for a fill: a flat color, or layered gradients with soft halos and fine scan lines. */
export function fillCSS(f: Fill): string {
  const c = f.colors.map(normHex);
  const a = c[0] ?? '#000000';
  if (f.type === 'solid' || c.length === 1) return a;
  const m = c[1] ?? a;
  const z = c[c.length - 1] ?? a;
  return [
    'repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px)',
    `radial-gradient(circle at 18% 14%,${a}cc,${a}00 55%)`,
    `radial-gradient(circle at 86% 82%,${z}cc,${z}00 60%)`,
    `linear-gradient(155deg,${a},${m} 55%,${z})`,
  ].join(',');
}

/** Dark or white text, whichever reads better on the fill. */
export const fillInk = (f: Fill): string =>
  f.colors.reduce((sum, c) => sum + luminance(c), 0) / f.colors.length > 0.18 ? '#15171d' : '#ffffff';

export const fillCode = (f: Fill): string => f.colors.map((c) => normHex(c).toUpperCase()).join(' → ');

export const sameFill = (a: Fill, b: Fill): boolean => fillCode(a) === fillCode(b);

/** Another item with exactly this fill: two identical colors can't be told apart in a duel. */
export const colorTwin = (items: readonly Item[], id: string, fill: Fill): Item | undefined =>
  items.find((i) => i.id !== id && i.fill !== null && sameFill(i.fill, fill));

/** Lighter, darker, two analogous, complementary and triadic variants. */
export function harmonies(hex: string): string[] {
  const [h, s, l] = hexToHsl(hex);
  return [
    hslToHex(h, s, l + 16),
    hslToHex(h, s, l - 16),
    hslToHex(h + 30, s, l),
    hslToHex(h - 30, s, l),
    hslToHex(h + 180, s, l),
    hslToHex(h + 120, s, l),
  ];
}

export const PRESETS = ['#2743f5', '#e4492a', '#12966b', '#f2a516', '#7a2e6e', '#3e4c5e'];
