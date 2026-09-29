// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/app/ui';
import { getLang } from '../src/i18n';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
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

  it('switches to French and back', () => {
    click('[data-action="lang"][data-l="fr"]');
    expect(getLang()).toBe('fr');
    expect($('h1')?.textContent).toBe('Tes classements');
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
});
