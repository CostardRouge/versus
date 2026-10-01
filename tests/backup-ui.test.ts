// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '../src/app/rankings';
import { S } from '../src/app/state';
import { mount } from '../src/app/ui';
import { type Backup, FORMAT, VERSION } from '../src/core/backup';
import type { Ranking } from '../src/core/types';

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};
const toast = () => $('#toast')?.textContent ?? '';
const titles = () => [...document.querySelectorAll('.rcard h3')].map((h) => h.textContent);

const pizzas: Ranking = {
  id: 'pizzas01',
  title: 'Pizzas',
  method: 'elo',
  items: [
    { id: 'm', label: 'Margherita', img: null, fill: null, h: 10 },
    { id: 'r', label: 'Regina', img: null, fill: null, h: 20 },
  ],
  history: [{ a: 'm', b: 'r', s: 1 }],
  pair: null,
  created: 1,
  updated: 2,
};
const backup = (rankings: Ranking[]): Backup => ({
  format: FORMAT,
  version: VERSION,
  exported: 1,
  rankings,
  owners: {},
  joined: [],
  voter: null,
});
const jsonFile = (x: unknown, name = 'versus.json') =>
  new File([JSON.stringify(x)], name, { type: 'application/json' });

/** Picks a file in the hidden input, as the file dialog would. */
function pick(file: File): void {
  const input = $('#import-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Downloads made by the export: file name and content. */
const downloads: { name: string; text: Promise<string> }[] = [];

beforeAll(() => {
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (b: Blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, b);
    return url;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: blobs.get(this.href)?.text() ?? Promise.resolve('') });
  });
  mount(document);
});

afterEach(() => {
  downloads.length = 0;
});

describe('export and import', () => {
  it('offers import but no export while there are only demos', () => {
    expect($('[data-action="import"]')).not.toBeNull();
    expect($('[data-action="export-all"]')).toBeNull();
    expect($('.g-data')?.textContent).toContain('Stored in this browser only.');
  });

  it('imports a file picked in the dialog, keeping the ranking’s id', async () => {
    pick(jsonFile(backup([pizzas])));
    await vi.waitFor(() => expect(toast()).toBe('Imported: 1 ranking'));
    expect(titles()).toContain('Pizzas');
    expect(S.ranks.find((r) => r.id === 'pizzas01')?.history).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('versus-v1') ?? '[]').some((r: Ranking) => r.id === 'pizzas01')).toBe(true);
  });

  it('says so when the file brings nothing new, or is not a Versus file', async () => {
    pick(jsonFile(backup([pizzas])));
    await vi.waitFor(() => expect(toast()).toBe('Nothing new: everything in this file is already here'));
    pick(jsonFile({ hello: 'world' }));
    await vi.waitFor(() => expect(toast()).toBe('This file isn’t a Versus export'));
    pick(jsonFile({ format: FORMAT, version: VERSION + 1, rankings: [pizzas] }));
    await vi.waitFor(() => expect(toast()).toContain('newer version of Versus'));
  });

  it('imports a different version of a ranking as a copy, from a dropped file', async () => {
    const changed = { ...pizzas, history: [...pizzas.history, { a: 'r', b: 'm', s: 1 as const }] };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [jsonFile(backup([changed]))] } });
    document.dispatchEvent(drop);
    await vi.waitFor(() => expect(toast()).toBe('Imported: 1 ranking'));
    expect(titles()).toEqual(expect.arrayContaining(['Pizzas', 'Pizzas (copy)']));
  });

  it('exports every ranking of this browser, not the demos', async () => {
    click('[data-action="export-all"]');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    const [d] = downloads;
    expect(d?.name).toMatch(/^versus-\d{4}-\d{2}-\d{2}\.json$/);
    expect(toast()).toBe(`Saved: ${d?.name}`);
    const file = JSON.parse((await d?.text) ?? '');
    expect(file.format).toBe(FORMAT);
    expect(file.rankings.map((r: Ranking) => r.title).sort()).toEqual(['Pizzas', 'Pizzas (copy)']);
    expect(file.voter).toBe(S.voter);
  });

  it('warns that a backup holding owner tokens gives control of the published boards', async () => {
    localStorage.setItem('versus-owners', JSON.stringify({ Ab3dEf7hJk: 'a'.repeat(64) }));
    click('[data-action="export-all"]');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(toast()).toBe('Saved. The file holds the keys to your published boards: keep it to yourself.');
    const file = JSON.parse((await downloads[0]?.text) ?? '');
    expect(file.owners).toEqual({ Ab3dEf7hJk: 'a'.repeat(64) });
    localStorage.removeItem('versus-owners');
  });

  it('exports one ranking from its results, as a copy to send', async () => {
    click('.rcard [data-action="open"][data-id="pizzas01"][data-tab="results"]');
    click('[data-action="export-one"]');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe('versus-pizzas.json');
    const file = JSON.parse((await downloads[0]?.text) ?? '');
    expect(file.rankings).toHaveLength(1);
    expect(file.voter).toBeNull();
    click('[data-action="back"]');
  });

  it('uses the share sheet on phones, and stays quiet when it is closed', async () => {
    // jsdom has no matchMedia: a phone's pointer.
    window.matchMedia = (q: string) =>
      ({ matches: q.includes('coarse'), media: q, addEventListener: () => {}, removeEventListener: () => {} }) as never;
    const share = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError');
    });
    Object.assign(navigator, { canShare: () => true, share });
    const before = toast();
    click('[data-action="export-all"]');
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(downloads).toHaveLength(0);
    expect(toast()).toBe(before);
    Object.assign(window, { matchMedia: undefined });
    Object.assign(navigator, { canShare: undefined, share: undefined });
  });

  it('tells the iOS home-screen app how to bring the rankings from Safari while it is empty', () => {
    const mine = S.ranks.filter((r) => !r.demo);
    Object.assign(navigator, { standalone: true });
    S.ranks = S.ranks.filter((r) => r.demo);
    render();
    expect($('.g-note')?.textContent).toContain('Your rankings from Safari aren’t here.');
    expect($('.g-note [data-action="import"]')).not.toBeNull();
    S.ranks.push(...mine);
    render();
    expect($('.g-note')).toBeNull();
    Object.assign(navigator, { standalone: undefined });
  });
});
