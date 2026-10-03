import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastOf, luminance } from '../src/core/colors';

/** The design tokens (src/tokens.css) keep their contrast promises in both themes (WCAG 1.4.3 and 1.4.11). */

const css = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');

/** The `--name: #hex` declarations of the first block opened by `head`. */
function block(head: string): Record<string, string> {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`missing ${head}`);
  const body = css.slice(start + head.length, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

const THEMES = {
  light: block(':root {'),
  dark: block(':root[data-theme="dark"] {'),
};

const ratio = (theme: Record<string, string>, fg: string, bg: string): number => {
  const a = theme[fg];
  const b = theme[bg];
  if (!a || !b) throw new Error(`missing --${a ? bg : fg}`);
  return contrastOf(luminance(a), luminance(b));
};

const SURFACES = ['bg', 'surface', 'surface-2'];
/** Text (4.5:1): body text, quiet text, links and the accents' text variants, on every surface. */
const TEXT: [string, string[]][] = [
  ['ink', SURFACES],
  ['muted', SURFACES],
  ['a', SURFACES],
  ['b-ink', SURFACES],
  ['good-ink', SURFACES],
  ['bad', ['bg', 'surface']],
  // Text over the accents' fills: the A and B side tags, a danger button.
  ['on-accent', ['a', 'b-ink', 'bad']],
];
/** Controls and states (3:1): a field's edge, the focus ring, the accents as fills and selected cues. */
const UI: [string, string[]][] = [
  ['field', SURFACES],
  ['a', SURFACES],
  ['b', ['bg', 'surface']],
  ['good', ['bg', 'surface']],
];

describe('design tokens', () => {
  it('defines the same tokens in the system dark theme as in the dark theme picked by hand', () => {
    const system = block(':root:not([data-theme="light"]) {');
    expect(system).toEqual(THEMES.dark);
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
  });

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`keeps text at 4.5:1 in the ${name} theme`, () => {
      for (const [fg, bgs] of TEXT)
        for (const bg of bgs) expect(ratio(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps fields, accents and the focus ring at 3:1 in the ${name} theme`, () => {
      for (const [fg, bgs] of UI)
        for (const bg of bgs) expect(ratio(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }
});
