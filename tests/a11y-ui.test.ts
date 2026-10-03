// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { reduced, toast, toastMs } from '../src/app/dom';
import { finaleHTML, mountFinale, resetFinale } from '../src/app/finale';
import { mount } from '../src/app/ui';
import { mkItem } from '../src/core/model';

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

/** The media queries the app reads: wide layout and motion by default, switched by the tests. */
const media = { narrow: false, reduced: false };
const changes: [string, () => void][] = [];
/** Switches a media query and tells its listeners, as a browser does. */
const setMedia = (k: keyof typeof media, v: boolean) => {
  media[k] = v;
  for (const [q, fn] of changes) if (q.includes(k === 'narrow' ? 'max-width' : 'reduce')) fn();
};

beforeAll(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  window.matchMedia = ((q: string) => ({
    get matches() {
      return q.includes('max-width') ? media.narrow : q.includes('reduce') ? media.reduced : false;
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => changes.push([q, fn]),
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  document.body.innerHTML = body;
  mount(document);
});

describe('views', () => {
  const appTitle = 'Versus — Rank anything by comparing two items at a time';

  it('leave the focus alone when the page loads', () => {
    expect(document.activeElement).toBe(document.body);
    expect(document.title).toBe(appTitle);
  });

  it('take the ranking’s name in the tab, and focus their heading', () => {
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    expect(document.title).toBe('Next destination · Versus');
    const h1 = $('#view h1');
    expect(document.querySelectorAll('#view h1')).toHaveLength(1);
    expect(h1.querySelector('#rank-title')).not.toBeNull();
    expect(document.activeElement).toBe(h1);
    const input = $<HTMLInputElement>('#rank-title');
    input.value = 'Trip';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.title).toBe('Trip · Versus');
    input.value = 'Next destination';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click('.ws-head [data-action="back"]');
    expect(document.title).toBe(appTitle);
    expect(document.activeElement).toBe($('#view h1'));
    expect(document.activeElement?.textContent).toBe('Your rankings');
  });

  it('take the duel’s keys on the heading they focus, not on a control', () => {
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    const n = duels('demo-destinations') ?? 0;
    const h1 = $('#view h1');
    expect(document.activeElement).toBe(h1);
    expect(key('ArrowLeft', h1).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(600);
    expect(duels('demo-destinations')).toBe(n + 1);
    // The title field inside the heading keeps its keys.
    key('ArrowRight', $('#rank-title'));
    vi.advanceTimersByTime(600);
    expect(duels('demo-destinations')).toBe(n + 1);
    click('.ws-head [data-action="back"]');
  });

  it('focus the view Back and Forward show', () => {
    history.pushState(null, '', '/demo/accent');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.title).toBe('Accent color · Versus');
    expect(document.activeElement).toBe($('.ws-title'));
    history.pushState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.activeElement).toBe($('#view h1'));
  });

  it('title their dialogs with an h2', () => {
    expect($('#m-title').tagName).toBe('H2');
  });
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

describe('color editor', () => {
  const pop = () => $('#cpop');
  const hex = () => $<HTMLInputElement>('.cp-hex[data-i="0"]');

  it('is a named dialog that takes the focus', () => {
    click('[data-action="back"]');
    click('.rcard [data-action="open"][data-id="demo-accent"][data-tab="duel"]');
    click('#item-list .thumb-btn');
    expect(pop().hidden).toBe(false);
    expect(pop().getAttribute('role')).toBe('dialog');
    expect($(`#${pop().getAttribute('aria-labelledby')}`).textContent).toBe('Edit color');
    expect(document.activeElement).toBe(hex());
  });

  it('offers solid or gradient as two toggle buttons in a named group, keeping the focus', () => {
    const seg = $('.cp-seg');
    expect(seg.getAttribute('role')).toBe('group');
    expect(seg.getAttribute('aria-label')).toBe('Solid or gradient');
    const grad = $('[data-action="cp-type"][data-type="gradient"]');
    expect(grad.getAttribute('aria-pressed')).toBe('false');
    grad.focus();
    grad.click();
    expect($('[data-action="cp-type"][data-type="gradient"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-action="cp-type"][data-type="solid"]').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe($('[data-action="cp-type"][data-type="gradient"]'));
    $('[data-action="cp-type"][data-type="solid"]').click();
  });

  it('announces a code it can’t read, tied to the field', () => {
    const field = hex();
    const color = field.value;
    field.value = 'nope';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const err = $('#cp-err');
    expect(err.hidden).toBe(false);
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toBe('Enter a code like #2743F5.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('cp-err');
    expect(field.value).toBe(color);
    field.value = '#123456';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(err.hidden).toBe(true);
    expect(field.hasAttribute('aria-invalid')).toBe(false);
    key('Escape', field);
    expect(pop().hidden).toBe(true);
  });

  it('takes the focus on phones too, on its switch rather than a text field', () => {
    setMedia('narrow', true);
    click('.tab[data-tab="items"]');
    // The Items tab focuses the add field a moment later.
    vi.advanceTimersByTime(50);
    click('#item-list .thumb-btn');
    expect(document.activeElement).toBe($('.cp-seg [aria-pressed="true"]'));
    key('Escape');
    setMedia('narrow', false);
    click('.tab[data-tab="duel"]');
  });
});

describe('focus across a render', () => {
  it('goes to the new duel’s card after Enter on a card', () => {
    click('[data-action="back"]');
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    const card = $('#stage .card-a');
    const n = duels('demo-destinations') ?? 0;
    card.focus();
    key('Enter', card);
    vi.advanceTimersByTime(600);
    expect(duels('demo-destinations')).toBe(n + 1);
    expect(card.isConnected).toBe(false);
    expect(document.activeElement).toBe($('#stage .card-a'));
  });

  it('stays on the button that voted, and on Skip', () => {
    $('.ctl[data-action="pick"][data-side="b"]').focus();
    click('.ctl[data-action="pick"][data-side="b"]');
    vi.advanceTimersByTime(600);
    expect(document.activeElement).toBe($('.ctl[data-action="pick"][data-side="b"]'));
    $('.ctl[data-action="skip"]').focus();
    click('.ctl[data-action="skip"]');
    expect(document.activeElement).toBe($('.ctl[data-action="skip"]'));
  });

  it('stays on a method of the comparison table after switching to it', () => {
    click('.tab[data-tab="results"]');
    const elo = () => $('.cmp-table [data-action="set-method"][data-m="elo"]');
    elo().focus();
    elo().click();
    expect($('#method-name').textContent).toBe('Dynamic');
    expect(document.activeElement).toBe(elo());
    click('.cmp-table [data-action="set-method"][data-m="bt"]');
  });

  it('goes on to the next item’s name after a removal, and to the add field once the list is empty', () => {
    click('[data-action="back"]');
    click('[data-action="new-rank"]');
    const input = $<HTMLInputElement>('#add-input');
    // Typed, a list's lines are separated by a written \n (core/list.ts).
    input.value = 'One\\nTwo\\nThree';
    $('#add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const ids = () => [...document.querySelectorAll<HTMLElement>('#item-list li[data-id]')].map((li) => li.dataset.id);
    const [first, second, third] = ids();
    const remove = (id: string | undefined) => {
      const rm = $(`#item-list .rm[data-id="${id}"]`);
      rm.focus();
      rm.click();
    };
    remove(first);
    expect(document.activeElement?.matches(`.row-label[data-id="${second}"]`)).toBe(true);
    remove(third);
    expect(document.activeElement?.matches(`.row-label[data-id="${second}"]`)).toBe(true);
    remove(second);
    expect(document.activeElement).toBe($('#add-input'));
  });
});

describe('gallery cards', () => {
  const link = () => $<HTMLAnchorElement>('.rcard a.rcard-main[data-id="demo-destinations"]');

  it('are articles titled by a real link, their figures plain text', () => {
    click('[data-action="back"]');
    const card = link().closest('article') as HTMLElement;
    expect(new URL(link().href).pathname).toBe('/demo/destinations');
    expect(link().closest('h3')).not.toBeNull();
    expect(link().textContent).toBe('Next destination');
    expect(link().hasAttribute('aria-label')).toBe(false);
    expect(card.querySelector('button.rcard-main')).toBeNull();
    expect(link().querySelector('a, button, h3, p')).toBeNull();
    for (const p of card.querySelectorAll('.meta, .lead, .stab-line')) expect(p.closest('a, button')).toBeNull();
  });

  it('open in the app on a plain click, and leave a modified click to the browser', () => {
    let prevented: boolean | null = null;
    const after = (e: Event) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    };
    window.addEventListener('click', after);
    link().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(prevented).toBe(false);
    expect(location.pathname).toBe('/');
    link().click();
    expect(prevented).toBe(true);
    expect(location.pathname).toBe('/demo/destinations');
    window.removeEventListener('click', after);
  });
});

describe('beyond the pointer', () => {
  it('describes what tooltips say on the gallery’s buttons', () => {
    click('[data-action="back"]');
    for (const [sel, text] of [
      ['[data-action="duplicate"]', 'Create your own ranking with these items'],
      ['[data-action="import"]', 'Add the rankings of a Versus file'],
    ] as const) {
      const id = $(sel).getAttribute('aria-describedby');
      expect(document.getElementById(id ?? '')?.textContent, sel).toBe(text);
    }
  });

  it('lets a row of the lines between two methods keep its item highlighted, by tap or keyboard', () => {
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    click('.tab[data-tab="results"]');
    click('[data-action="rank-view"][data-view="lines"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('.slope-l li[data-id]')];
    const [row] = rows();
    if (!row) throw new Error('no rows');
    const id = row.dataset.id;
    const both = () => [...document.querySelectorAll<HTMLElement>(`.slope li[data-id="${id}"]`)];
    expect(row.tabIndex).toBe(0);
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('aria-pressed')).toBe('false');
    row.focus();
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(both().map((li) => li.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    expect(both().every((li) => li.classList.contains('hl'))).toBe(true);
    expect($('.slope').classList.contains('hovering')).toBe(true);
    key(' ');
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect($('.slope').classList.contains('hovering')).toBe(false);
    both()[1]?.click();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect($('.slope-foot').textContent).toContain('Point at, tap or select an item to follow it.');
    click('[data-action="rank-view"][data-view="podium"]');
  });
});

describe('motion', () => {
  it('follows a motion setting changed while the page is open', () => {
    expect(reduced).toBe(false);
    setMedia('reduced', true);
    expect(reduced).toBe(true);
    setMedia('reduced', false);
    expect(reduced).toBe(false);
  });

  it('keeps the end-of-vote page’s blocks out of reach until they show', () => {
    const [a, b, c] = [mkItem('Apple'), mkItem('Banana'), mkItem('Cherry')];
    const mine = [
      { a: a.id, b: b.id, s: 1 as const },
      { a: a.id, b: c.id, s: 1 as const },
      { a: b.id, b: c.id, s: 1 as const },
    ];
    const host = document.createElement('div');
    host.innerHTML = finaleHTML({
      title: 'Fruit',
      status: 'open',
      countsLine: '',
      items: [a, b, c],
      method: 'bt',
      mine,
      count: 3,
      crowd: null,
      owner: false,
      view: 'podium',
    });
    document.body.append(host);
    mountFinale('play', () => {});
    const at = (sel: string) => host.querySelector(sel)?.hasAttribute('inert');
    expect(at('.fin-top')).toBe(false);
    expect(at('.fin-acts')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(at('.fin-hero .rv')).toBe(false);
    expect(at('.fin-acts')).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(host.querySelectorAll('[inert]')).toHaveLength(0);
    resetFinale();
    host.remove();
  });
});

describe('figures a screen reader can tell apart', () => {
  it('labels each number of the ranking’s rows and podium', () => {
    click('[data-action="back"]');
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="results"]');
    const row = $('.rows li:not(.hdr)');
    expect(row.querySelector('.num .sr-only')?.textContent).toBe('Score: ');
    expect(row.querySelector('.rec .sr-only')?.textContent).toMatch(/^\d+ wins?, \d+ loss(es)?, \d+ ties?$/);
    expect(row.querySelector('.rec [aria-hidden="true"]')?.textContent).toMatch(/^\d+ · \d+ · \d+$/);
    expect(row.querySelector('.rbar-cell')?.getAttribute('aria-hidden')).toBe('true');
    expect($('.pod-info .sr-only').textContent).toMatch(/^Score: \d+ ±\d+, \d+ wins?, /);
  });

  it('says which cells of the comparison differ, beyond their color', () => {
    const diffs = [...document.querySelectorAll('.cmp-table td.diff')];
    expect(diffs.length).toBeGreaterThan(0);
    for (const td of diffs) expect(td.querySelector('.sr-only')?.textContent).toBe(' (differs from the active method)');
    expect(document.querySelector('.cmp-table td:not(.diff) .sr-only')).toBeNull();
  });

  it('names the neck-and-neck mark of the end-of-vote page', () => {
    const [a, b] = [mkItem('Apple'), mkItem('Banana')];
    const host = document.createElement('div');
    host.innerHTML = finaleHTML({
      title: 'Fruit',
      status: 'open',
      countsLine: '',
      items: [a, b],
      method: 'bt',
      mine: [{ a: a.id, b: b.id, s: 1 }],
      count: 1,
      crowd: {
        method: 'bt',
        order: [a.id, b.id],
        stats: {
          [a.id]: { score: 1510, se: 40, w: 3, l: 2, d: 0 },
          [b.id]: { score: 1500, se: 40, w: 2, l: 3, d: 0 },
        },
      },
      owner: false,
      view: 'duo',
    });
    const neck = host.querySelector('.fin-neck');
    expect(neck?.getAttribute('role')).toBe('img');
    expect(neck?.getAttribute('aria-label')).toBe('Neck and neck with the one above');
  });
});

describe('Back and addresses', () => {
  const popTo = (path: string) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  it('steps back to the gallery a view was opened from, rather than piling up an entry', async () => {
    popTo('/');
    const back = vi.spyOn(history, 'back');
    click('.rcard [data-action="open"][data-id="demo-accent"][data-tab="duel"]');
    expect(history.state).toEqual({ fromGallery: true });
    const length = history.length;
    click('.ws-head [data-action="back"]');
    expect(back).toHaveBeenCalledOnce();
    expect(history.length).toBe(length);
    expect(location.pathname).toBe('/');
    expect($('#view h1').textContent).toBe('Your rankings');
    await vi.advanceTimersByTimeAsync(50);
    expect(location.pathname).toBe('/');
    expect($('#view h1').textContent).toBe('Your rankings');
    back.mockRestore();
  });

  it('adds the gallery’s entry for a view reached straight from its address', () => {
    history.replaceState(null, '', '/demo/accent');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const back = vi.spyOn(history, 'back');
    click('.ws-head [data-action="back"]');
    expect(back).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/');
    back.mockRestore();
  });

  it('keeps a notice in the gallery for an address that leads nowhere, until closed', () => {
    popTo('/nowhere/at/all');
    expect(location.pathname).toBe('/');
    const notice = $('.g-notice');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('This address leads nowhere in Versus.');
    vi.advanceTimersByTime(60000);
    expect(document.querySelector('.g-notice')).not.toBeNull();
    click('[data-action="notice-close"]');
    expect(document.querySelector('.g-notice')).toBeNull();
  });
});

describe('deleting a ranking', () => {
  it('still asks, then offers Undo, which puts it back in its place with its duels', async () => {
    click('[data-action="back"]');
    click('[data-action="new-rank"]');
    const input = $<HTMLInputElement>('#add-input');
    input.value = 'Tea\\nCoffee';
    $('#add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    click('.tab[data-tab="duel"]');
    click('[data-action="pick"][data-side="a"]');
    vi.advanceTimersByTime(600);
    click('.ws-head [data-action="back"]');
    const before = stored();
    const doomed = before.find((r) => r.items.length === 2 && r.history.length === 1);
    if (!doomed) throw new Error('missing the new ranking');
    const del = $(`[data-action="delete"][data-id="${doomed.id}"]`);
    del.focus();
    del.click();
    await vi.advanceTimersByTimeAsync(20);
    click('#m-ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(stored().some((r) => r.id === doomed.id)).toBe(false);
    expect(document.activeElement).toBe($('#view h1'));
    expect($('#toast').textContent).toContain('Ranking deleted');
    click('[data-action="toast-act"]');
    expect(stored()).toEqual(before);
    expect(document.querySelector(`.rcard [data-action="delete"][data-id="${doomed.id}"]`)).not.toBeNull();
  });
});
