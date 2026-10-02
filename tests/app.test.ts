// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { offerUpdate } from '../src/app/pwa';
import { STASH_KEY } from '../src/app/router';
import { mount } from '../src/app/ui';
import { getLang } from '../src/i18n';

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};

beforeAll(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  mount(document);
});

describe('app', () => {
  it('opens on the gallery with the three demos', () => {
    expect($('h1')?.textContent).toBe('Your rankings');
    expect(document.querySelectorAll('.rcard')).toHaveLength(3);
  });

  it('replaces the static page text with the gallery, keeping one h1', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelectorAll('#view > .about')).toHaveLength(0);
    expect($('.gallery .about h2')?.textContent).toBe('Rank anything by comparing two items at a time');
    expect(document.title).toBe('Versus — Rank anything by comparing two items at a time');
  });

  it('switches to French and back', () => {
    click('[data-action="lang"][data-l="fr"]');
    expect(getLang()).toBe('fr');
    expect($('h1')?.textContent).toBe('Tes classements');
    expect($('.gallery .about h2')?.textContent).toBe('Classe tout en comparant deux éléments à la fois');
    expect(document.title).toBe('Versus — Classe tout en comparant deux éléments à la fois');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.body.textContent).toContain('Prochaine destination');
    click('[data-action="lang"][data-l="en"]');
    expect($('h1')?.textContent).toBe('Your rankings');
  });

  it('follows the system theme by default and remembers an explicit choice', () => {
    const root = document.documentElement;
    expect(root.dataset.theme).toBeUndefined();
    expect($('[data-action="theme"][data-t="system"]')?.getAttribute('aria-pressed')).toBe('true');
    click('[data-action="theme"][data-t="dark"]');
    expect(root.dataset.theme).toBe('dark');
    expect($('[data-action="theme"][data-t="dark"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').theme).toBe('dark');
    click('[data-action="theme"][data-t="light"]');
    expect(root.dataset.theme).toBe('light');
    click('[data-action="theme"][data-t="system"]');
    expect(root.dataset.theme).toBeUndefined();
  });

  it('records a duel from the buttons', () => {
    click('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]');
    const before = $('.eyebrow')?.textContent;
    click('[data-action="pick"][data-side="a"]');
    vi.advanceTimersByTime(600);
    expect($('.eyebrow')?.textContent).not.toBe(before);
    expect(JSON.parse(localStorage.getItem('versus-v1') ?? '[]')[0].history).toHaveLength(25);
  });

  it('switches scoring method and shows the comparison table', () => {
    click('[data-action="set-method"][data-m="win"]');
    expect($('#method-name')?.textContent).toBe('Simple');
    click('.tab[data-tab="results"]');
    expect(document.querySelectorAll('.cmp-table th')).toHaveLength(5);
  });

  it('adds text and hex items from the side panel', () => {
    click('[data-action="back"]');
    click('[data-action="new-rank"]');
    const input = $('#add-input') as HTMLInputElement;
    for (const v of ['Tea', '#2743f5']) {
      input.value = v;
      $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    expect(document.querySelectorAll('#item-list li[data-id]')).toHaveLength(2);
    expect($('.thumb-btn')?.getAttribute('aria-label')).toContain('#2743F5');
  });

  it('announces the end of an exact sort, then shows the ranking by itself', () => {
    click('[data-action="set-method"][data-m="sort"]');
    const input = $('#add-input') as HTMLInputElement;
    input.value = 'Coffee';
    $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    click('.tab[data-tab="duel"]');
    for (let i = 0; i < 6 && !$('.end'); i++) {
      click('[data-action="pick"][data-side="a"]');
      vi.advanceTimersByTime(600);
    }
    expect($('.end-h')?.textContent).toBe('Sort complete!');
    expect($('.end-facts')?.textContent).toContain('3 items placed');
    // "Stay here" stops the countdown.
    click('[data-action="end-stay"]');
    vi.advanceTimersByTime(5000);
    expect($('.end')).not.toBeNull();
    expect($('[data-action="end-stay"]')).toBeNull();
    click('[data-action="end-see"]');
    expect($('.results')).not.toBeNull();
  });

  it('shows the ranking as lines comparing two methods, and remembers it', () => {
    click('[data-action="rank-view"][data-view="lines"]');
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').rankView).toBe('lines');
    expect(document.querySelectorAll('.slope-l li')).toHaveLength(3);
    expect(document.querySelectorAll('.slope svg path')).toHaveLength(3);
    expect($('.slope-r .slope-h')?.textContent).toBe('Balanced');
    click('[data-action="set-compare"][data-m="elo"]');
    expect($('.slope-r .slope-h')?.textContent).toBe('Dynamic');
    expect($('.podium')).toBeNull();
    click('[data-action="rank-view"][data-view="podium"]');
    expect($('.slope')).toBeNull();
  });

  it('moves to the ranking when the countdown ends', () => {
    click('.tab[data-tab="duel"]');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    click('[data-action="pick"][data-side="a"]');
    vi.advanceTimersByTime(600);
    expect($('.end-run')).not.toBeNull();
    vi.advanceTimersByTime(4100);
    expect($('.tab[data-tab="results"]')?.getAttribute('aria-selected')).toBe('true');
    expect($('.res-enter')).not.toBeNull();
  });

  it('adds every item of a pasted, typed or dropped list, without duplicates, and can undo it', () => {
    click('[data-action="back"]');
    click('[data-action="new-rank"]');
    const input = $('#add-input') as HTMLInputElement;
    const submit = (v: string) => {
      input.value = v;
      $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    const paste = (text: string) => {
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { files: [], getData: () => text } });
      input.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const labels = () =>
      [...document.querySelectorAll<HTMLInputElement>('#item-list .row-label')].map((i) => i.value).sort();
    submit('Tea');
    // One line goes into the field, as typed.
    expect(paste('Green tea')).toBe(false);
    expect(paste('## Drinks\n- **Coffee**\n- [ ] tea\n- #2743f5\n- Cocoa')).toBe(true);
    expect(labels()).toEqual(['#2743F5', 'Cocoa', 'Coffee', 'Tea']);
    expect($('#toast')?.textContent).toContain('3 items added · 1 duplicate skipped');
    click('[data-action="toast-act"]');
    expect(labels()).toEqual(['Tea']);
    submit('Coffee\\nCocoa');
    expect(labels()).toEqual(['Cocoa', 'Coffee', 'Tea']);
    expect(input.value).toBe('');
    const drop = new InputEvent('beforeinput', {
      data: 'Mate\nChai',
      inputType: 'insertFromDrop',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(labels()).toEqual(['Chai', 'Cocoa', 'Coffee', 'Mate', 'Tea']);
    expect(paste('tea\nMATE')).toBe(true);
    expect($('#toast')?.textContent).toBe('All already in the list');
    expect(labels()).toHaveLength(5);
  });
});

describe('addresses', () => {
  const back = (path: string) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const title = () => ($('#rank-title') as HTMLInputElement | null)?.value;

  it('gives the gallery, the demos and their tabs an address of their own', () => {
    click('[data-action="back"]');
    expect(location.pathname).toBe('/');
    click('.rcard [data-action="open"][data-id="demo-backgrounds"][data-tab="duel"]');
    expect(location.pathname).toBe('/demo/backgrounds');
    click('.tab[data-tab="results"]');
    expect(location.pathname).toBe('/demo/backgrounds/ranking');
    click('.tab[data-tab="duel"]');
    expect(location.pathname).toBe('/demo/backgrounds');
  });

  it('follows Back and Forward', () => {
    back('/demo/destinations/ranking');
    expect(title()).toBe('Next destination');
    expect($('.tab[data-tab="results"]')?.getAttribute('aria-selected')).toBe('true');
    back('/');
    expect($('h1')?.textContent).toBe('Your rankings');
  });

  it('opens a ranking of this browser by its address, and explains one from elsewhere', () => {
    const mine = JSON.parse(localStorage.getItem('versus-v1') ?? '[]').find((r: { demo?: boolean }) => !r.demo);
    back(`/r/${mine.id}/items`);
    expect(title()).toBe(mine.title);
    expect(location.pathname).toBe(`/r/${mine.id}/items`);
    back('/r/elsewhere1');
    expect($('#toast')?.textContent).toContain('This ranking isn’t in this browser');
    expect(location.pathname).toBe('/');
    expect($('h1')?.textContent).toBe('Your rankings');
  });

  it('runs an icon shortcut once: a new ranking, or the last one', () => {
    const before = JSON.parse(localStorage.getItem('versus-v1') ?? '[]').length;
    back('/?shortcut=new');
    expect(title()).toBe('New ranking');
    expect(location.search).toBe('');
    expect(JSON.parse(localStorage.getItem('versus-v1') ?? '[]')).toHaveLength(before + 1);
    const last = JSON.parse(localStorage.getItem('versus-v1') ?? '[]')
      .filter((r: { demo?: boolean }) => !r.demo)
      .sort((a: { updated: number }, b: { updated: number }) => b.updated - a.updated)[0];
    back('/?shortcut=last');
    expect(location.pathname).toBe(`/r/${last.id}`);
    expect(location.search).toBe('');
  });

  it('shows the gallery for an address that names nothing', () => {
    back('/nowhere/at/all');
    expect(location.pathname).toBe('/');
    expect($('h1')?.textContent).toBe('Your rankings');
  });

  it('takes back the path GitHub Pages’ 404 page kept, without leaving the app’s folder', () => {
    sessionStorage.setItem(STASH_KEY, 'demo/accent/ranking');
    back('/');
    expect(location.pathname).toBe('/demo/accent/ranking');
    expect(sessionStorage.getItem(STASH_KEY)).toBeNull();
    const origin = location.origin;
    sessionStorage.setItem(STASH_KEY, '//elsewhere.example/demo/accent');
    back('/');
    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe('/');
    expect($('h1')?.textContent).toBe('Your rankings');
  });
});

describe('installable app', () => {
  it('shows the install button only when the browser offers installation', async () => {
    const install = $('#install');
    expect(install?.hidden).toBe(true);
    const prompt = vi.fn(async () => {});
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    window.dispatchEvent(offer);
    expect(offer.defaultPrevented).toBe(true);
    expect(install?.hidden).toBe(false);
    expect(install?.textContent).toBe('Install');
    click('[data-action="lang"][data-l="fr"]');
    expect(install?.textContent).toBe('Installer');
    click('[data-action="lang"][data-l="en"]');
    click('#install');
    expect(prompt).toHaveBeenCalledOnce();
    expect(install?.hidden).toBe(true);
    window.dispatchEvent(new Event('appinstalled'));
    expect($('#toast')?.textContent).toBe('Versus is installed');
  });

  it('offers a new version and lets the user choose when to reload', () => {
    const bar = $('#update');
    expect(bar?.textContent).toBe('');
    const worker = { state: 'installed', postMessage: vi.fn() } as unknown as ServiceWorker;
    offerUpdate(worker);
    expect(bar?.textContent).toContain('A new version of Versus is ready.');
    click('[data-action="update-later"]');
    expect(bar?.textContent).toBe('');
    expect(worker.postMessage).not.toHaveBeenCalled();
    offerUpdate(worker);
    click('[data-action="update"]');
    expect(worker.postMessage).toHaveBeenCalledWith('skip-waiting');
  });
});
