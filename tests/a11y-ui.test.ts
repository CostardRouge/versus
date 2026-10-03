// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
const stored = () => JSON.parse(localStorage.getItem('versus-v1') ?? '[]') as { id: string; history: unknown[] }[];
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
