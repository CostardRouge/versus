import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** What the app's styles promise beyond colors: target sizes, safe areas, visible states (src/styles.css). */

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The duel stage both pages share (src/stage.css), imported before each page's own rules. */
const stage = read('src/stage.css');
const own = read('src/styles.css');
const css = `${stage}\n${own}`;

/** The text between the braces of the block that `head` opens (an at-rule), nested blocks included. */
function at(head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`missing ${head}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

/** Every declaration block whose selector list names `sel`, joined (the cascade's order kept). */
function rule(sel: string, within = css): string {
  return [...within.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? '').split(',').some((s) => s.trim() === sel))
    .map((m) => m[2])
    .join('\n');
}

describe('app styles', () => {
  it('gives small controls a 24 px target, and touch screens 44 px ones', () => {
    for (const sel of ['.link', '.lang button', '.theme button']) {
      expect(rule(sel), sel).toMatch(/min-width: 24px;[\s\S]*min-height: 24px;/);
    }
    expect(rule('.grad-toggle')).toContain('min-height: 24px;');
    const touch = at('@media (pointer: coarse)');
    expect(rule('.btn.sm', touch)).toContain('min-height: 44px;');
    expect(rule('.tab', touch)).toContain('height: 44px;');
    expect(rule('.rm::before', touch)).toContain('inset: calc((100% - 44px) / 2);');
    expect(rule('.thumb-btn::before', touch)).toContain('inset: calc((100% - 44px) / 2);');
  });

  it('keeps the page, dialogs and popovers out of a notch', () => {
    expect(rule('#app')).toMatch(/padding-inline:[^;]*safe-area-inset-left[^;]*safe-area-inset-right/);
    expect(rule('.modal')).toMatch(/padding:[^;]*safe-area-inset-right[^;]*safe-area-inset-left/);
    const narrow = css.slice(css.indexOf('.cpop {', css.indexOf('@media (max-width: 859px)', css.indexOf('.cp-foot'))));
    expect(rule('.cpop', narrow)).toMatch(
      /left: max\(16px, env\(safe-area-inset-left[\s\S]*right: max\(16px, env\(safe-area-inset-right/,
    );
  });

  it('shows the remove button, focus rings and selected states without color alone', () => {
    expect(rule('.rm')).toContain('opacity: 0.7;');
    expect(rule('.rm')).not.toContain('opacity: 0;');
    // The global focus ring is not replaced by a faint outline on item names.
    expect(rule('.row-label:focus')).not.toContain('outline');
    for (const sel of [
      '.tab[aria-selected="true"]',
      '.lang button[aria-pressed="true"]',
      '.share-fmts button[aria-pressed="true"]',
    ]) {
      expect(rule(sel), sel).toContain('inset 0 0 0 1px var(--field)');
    }
    const forced = at('@media (forced-colors: active)');
    expect(rule('[aria-pressed="true"]', forced)).toContain('outline: 2px solid Highlight;');
    expect(rule('[aria-selected="true"]', forced)).toContain('outline: 2px solid Highlight;');
  });

  it('borders fields with --field, at 3:1 (tests/tokens.test.ts)', () => {
    for (const sel of ['#add-input', '.cp-hex', '.opt-n', '.report-note textarea']) {
      expect(rule(sel), sel).toContain('border: 1px solid var(--field);');
    }
  });
});

describe('home page styles', () => {
  const landing = `${stage}\n${read('src/landing/landing.css')}`;

  it('fades the side or card not picked without fading its words', () => {
    for (const sel of ['.final.va .hb', '.final.vb .ha']) {
      expect(rule(sel, landing), sel).toContain('color: var(--ink);');
      expect(rule(sel, landing), sel).not.toContain('opacity');
    }
    expect(rule('.mc.lose', landing)).not.toContain('opacity');
    expect(rule('.mc.lose .bgd', landing)).toContain('opacity: 0.3;');
    expect(rule('.mc.lose.media b', landing)).toContain('color: var(--ink);');
  });

  it('writes coral and green words in their text variants', () => {
    for (const sel of ['.vsx .xb', '.pb', '.ctl-b']) expect(rule(sel, landing), sel).toContain('color: var(--b-ink);');
  });
});

describe('shared styles', () => {
  const landing = read('src/landing/landing.css');
  /** Top-level rules, as written: selector and declarations. */
  const rules = (text: string): string[] =>
    [...text.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').matchAll(/[^{}]+\{[^{}]*\}/g)].map((m) =>
      m[0].trim(),
    );

  it('imports the duel stage first in the app and on the home page, and writes it once', () => {
    expect(own.trimStart().startsWith('@import "./tokens.css";\n@import "./stage.css";')).toBe(true);
    expect(landing.trimStart().startsWith('@import "../tokens.css";\n@import "../stage.css";')).toBe(true);
    const shared = rules(stage);
    expect(shared.length).toBeGreaterThan(10);
    for (const page of [rules(own), rules(landing)]) expect(shared.filter((r) => page.includes(r))).toEqual([]);
  });

  it('rounds pills with --r-pill and the token radii with their tokens', () => {
    for (const text of [stage, own, landing]) {
      expect(text).not.toMatch(/border-radius: (?:999|99|14|20)px;/);
    }
    expect(read('src/tokens.css')).toContain('--r-pill: 999px;');
  });
});
