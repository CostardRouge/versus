// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { controlsHTML, duelKeys, outcomeOf } from '../src/app/duel';

/** A key pressed on `tg`, with what the duel was asked to do and whether the key was taken. */
function press(key: string, tg: HTMLElement = document.body, mods: KeyboardEventInit = {}) {
  const act = { pick: vi.fn(), skip: vi.fn(), undo: vi.fn() };
  const e = new KeyboardEvent('keydown', { key, cancelable: true, ...mods });
  duelKeys(e, tg, act);
  return { act, taken: e.defaultPrevented };
}

describe('the duel kit (a local duel and a board share it)', () => {
  it('reads the same keys for every duel', () => {
    expect(press('ArrowLeft').act.pick).toHaveBeenCalledWith('a');
    expect(press('ArrowRight').act.pick).toHaveBeenCalledWith('b');
    expect(press('ArrowDown').act.pick).toHaveBeenCalledWith('draw');
    expect(press('=').act.pick).toHaveBeenCalledWith('draw');
    expect(press('S').act.skip).toHaveBeenCalledOnce();
    expect(press('z', document.body, { ctrlKey: true }).act.undo).toHaveBeenCalledOnce();
    expect(press('Z', document.body, { metaKey: true, shiftKey: true }).act.undo).toHaveBeenCalledOnce();
    for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const k = press('ArrowLeft', document.body, mods);
      expect(k.act.pick).not.toHaveBeenCalled();
      expect(k.taken).toBe(false);
    }
    expect(press('x').taken).toBe(false);
    expect(press('ArrowUp').taken).toBe(false);
  });

  it('picks a focused card with Enter or Space', () => {
    document.body.innerHTML = '<div class="card" data-side="b" tabindex="0"></div>';
    const card = document.querySelector<HTMLElement>('.card') as HTMLElement;
    for (const key of ['Enter', ' ']) {
      const k = press(key, card);
      expect(k.act.pick).toHaveBeenCalledWith('b');
      expect(k.taken).toBe(true);
    }
  });

  it('leaves its keys to fields, selects and summaries included', () => {
    for (const html of [
      '<input>',
      '<textarea></textarea>',
      '<select></select>',
      '<details><summary>x</summary></details>',
      '<div contenteditable="true"></div>',
    ]) {
      document.body.innerHTML = html;
      const el = document.querySelector<HTMLElement>('input, textarea, select, summary, [contenteditable]');
      for (const key of ['ArrowLeft', 's', 'z']) {
        const k = press(key, el as HTMLElement, key === 'z' ? { ctrlKey: true } : {});
        expect(k.taken).toBe(false);
        expect(k.act.pick).not.toHaveBeenCalled();
        expect(k.act.skip).not.toHaveBeenCalled();
        expect(k.act.undo).not.toHaveBeenCalled();
      }
    }
  });

  it('draws the same controls, with Exact sort’s tie and skip disabled', () => {
    document.body.innerHTML = controlsHTML('b-pick', 'b-skip');
    const sides = [...document.querySelectorAll<HTMLElement>('[data-action="b-pick"]')].map((b) => b.dataset.side);
    expect(sides).toEqual(['a', 'draw', 'b']);
    expect(document.querySelectorAll('[data-action="b-skip"]')).toHaveLength(1);
    expect(document.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect([...document.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['←', '↓', 'S', '→']);
    document.body.innerHTML = controlsHTML('pick', 'skip', true);
    const off = [...document.querySelectorAll<HTMLButtonElement>('button[disabled]')];
    expect(off.map((b) => b.dataset.side ?? b.dataset.action)).toEqual(['draw', 'skip']);
    expect(off.every((b) => b.title)).toBe(true);
  });

  it('turns a side into an outcome for the first item', () => {
    expect([outcomeOf('a'), outcomeOf('b'), outcomeOf('draw')]).toEqual([1, 0, 0.5]);
  });
});
