// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { toast, toastMs } from '../src/app/dom';
import { mount } from '../src/app/ui';

/** Keyboard and screen reader behaviour of the app (the audit's A11Y findings), on the demos. */

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string) => $(sel).click();
/** A key pressed on an element (the focused one by default). */
const key = (k: string, el: Element | null = document.activeElement, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el?.dispatchEvent(e);
  return e;
};
interface Stored {
  id: string;
  title: string;
  items: { id: string; label: string }[];
  history: unknown[];
}
const stored = (): Stored[] => JSON.parse(localStorage.getItem('versus-v1') ?? '[]');
const rankOf = (id: string): Stored => {
  const r = stored().find((x) => x.id === id);
  if (!r) throw new Error(`missing ranking ${id}`);
  return r;
};
const duels = (id: string) => stored().find((r) => r.id === id)?.history.length;

beforeAll(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  mount(document);
});

describe('workspace tabs', () => {
  const tab = (t: string) => $(`.tab[data-tab="${t}"]`);

  it('follow the tabs pattern: a name, one tab in the Tab order, a panel', () => {
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    expect($('.tabs').getAttribute('aria-label')).toBe('Ranking views');
    expect(tab('duel').getAttribute('aria-selected')).toBe('true');
    expect([tab('items').tabIndex, tab('duel').tabIndex, tab('results').tabIndex]).toEqual([-1, 0, -1]);
    expect(tab('duel').getAttribute('aria-controls')).toBe('main');
    expect($('#main').getAttribute('role')).toBe('tabpanel');
    expect($('#main').getAttribute('aria-labelledby')).toBe('tab-duel');
  });

  it('move with the arrow keys, Home and End, showing the tab and never voting', () => {
    const n = duels('demo-destinations');
    tab('duel').focus();
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tab('results'));
    expect(tab('results').getAttribute('aria-selected')).toBe('true');
    expect([tab('duel').tabIndex, tab('results').tabIndex]).toEqual([-1, 0]);
    expect(location.pathname).toBe('/demo/destinations/ranking');
    expect($('#main').getAttribute('aria-labelledby')).toBe('tab-results');
    expect($('.results')).not.toBeNull();
    // Items is a tab of the narrow layout only: from Ranking, Right comes back to Duel.
    key('ArrowRight');
    expect(document.activeElement).toBe(tab('duel'));
    key('End');
    expect(document.activeElement).toBe(tab('results'));
    key('Home');
    expect(document.activeElement).toBe(tab('duel'));
    key('ArrowLeft');
    expect(document.activeElement).toBe(tab('results'));
    key('ArrowLeft');
    expect(tab('duel').getAttribute('aria-selected')).toBe('true');
    for (const k of ['ArrowDown', 's', '=']) key(k);
    vi.advanceTimersByTime(600);
    expect(duels('demo-destinations')).toBe(n);
  });
});

describe('method menu', () => {
  const opt = (m: string) => $(`.mopt[data-m="${m}"]`);
  const open = () => !$('#method-pop').hidden;

  it('moves among the methods with Up, Down, Home and End', () => {
    click('#method-btn');
    expect(open()).toBe(true);
    expect(document.activeElement).toBe(opt('bt'));
    expect(opt('bt').tabIndex).toBe(-1);
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(opt('elo'));
    key('End');
    expect(document.activeElement).toBe(opt('sort'));
    key('ArrowDown');
    expect(document.activeElement).toBe(opt('bt'));
    key('ArrowUp');
    expect(document.activeElement).toBe(opt('sort'));
    key('Home');
    expect(document.activeElement).toBe(opt('bt'));
  });

  it('closes on Tab, handing the focus back to its button', () => {
    key('Tab');
    expect(open()).toBe(false);
    expect(document.activeElement).toBe($('#method-btn'));
    expect($('#method-btn').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the focus leaves it', () => {
    click('#method-btn');
    opt('elo').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: $('.back') }));
    expect(open()).toBe(false);
  });

  it('gives the focus back to its button after a choice', () => {
    click('#method-btn');
    key('ArrowDown');
    click('.mopt[data-m="win"]');
    expect(open()).toBe(false);
    expect($('#method-name').textContent).toBe('Simple');
    expect(document.activeElement).toBe($('#method-btn'));
    click('#method-btn');
    click('.mopt[data-m="bt"]');
  });
});

describe('toast', () => {
  const box = () => $('#toast');
  const shown = () => box().classList.contains('show');

  it('stays long enough to read it, and 6 s at least with an action', () => {
    expect(toastMs('Ranking deleted', false)).toBe(2600 + 60 * 15);
    expect(toastMs('Removed', true)).toBe(6000);
    expect(toastMs('x'.repeat(80), true)).toBe(2600 + 60 * 80);
  });

  it('goes after its time, emptied, its live region staying in the page', () => {
    toast('Short note');
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(toastMs('Short note', false) - 100);
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(box().textContent).toBe('');
    expect(box().getAttribute('role')).toBe('status');
  });

  it('waits while pointed at or focused', () => {
    const run = vi.fn();
    toast('Removed', { label: 'Undo', run });
    vi.advanceTimersByTime(2000);
    box().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(20000);
    expect(shown()).toBe(true);
    box().dispatchEvent(new MouseEvent('mouseleave'));
    $('.toast-act').focus();
    vi.advanceTimersByTime(20000);
    expect(shown()).toBe(true);
    $('.back').focus();
    // The 4 s it had left.
    vi.advanceTimersByTime(3900);
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('undoes on ⌘/Ctrl+Z what it offers to undo, before a duel, and never in a text field', () => {
    const rank = () => rankOf('demo-destinations');
    const before = rank();
    const id = before.items[0]?.id;
    click(`#item-list [data-action="remove-item"][data-id="${id}"]`);
    expect(rank().items).toHaveLength(before.items.length - 1);
    key('z', $('#add-input'), { ctrlKey: true });
    expect(rank().items).toHaveLength(before.items.length - 1);
    key('z', document.body, { ctrlKey: true });
    expect(rank().items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(rank().history).toHaveLength(before.history.length);
    vi.advanceTimersByTime(300);
    expect(box().textContent).toBe('');
  });
});
