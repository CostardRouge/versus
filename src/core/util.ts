import type { Rng } from './types.ts';

export const uid = (): string => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/** Stable hue (0–359) derived from a string. */
export function hueOf(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Small seeded PRNG so demo data is identical for everyone. */
export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export function initials(s: string): string {
  const letters = s
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('');
  return letters.toUpperCase() || '?';
}

/** Type size bucket for text cards, by label length. */
export function sizeClass(s: string): 'xl' | 'lg' | 'md' | 'sm' {
  const n = s.length;
  return n <= 10 ? 'xl' : n <= 22 ? 'lg' : n <= 48 ? 'md' : 'sm';
}

/** Signed delta with a real minus sign. */
export const fmtDelta = (d: number): string => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '±0');
