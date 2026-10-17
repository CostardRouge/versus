// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { receiveShare } from '../src/app/inbox';
import { S } from '../src/app/state';
import { mount } from '../src/app/ui';
import { FORMAT, VERSION } from '../src/core/backup';

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const toast = () => $('#toast')?.textContent ?? '';
const tick = () => new Promise((r) => setTimeout(r, 0));
const ORIGIN = 'https://versus.example/';

/** The Cache API as the service worker leaves a share in it (src/sw/sw.ts), with jsdom's Blob. */
type Entry = { json: () => Promise<unknown>; blob: () => Promise<Blob> };
const store = new Map<string, Map<string, Entry>>();
const entry = (b: Blob): Entry => ({ json: async () => JSON.parse(await b.text()), blob: async () => b });
Object.assign(globalThis, {
  caches: {
    has: async (n: string) => store.has(n),
    delete: async (n: string) => store.delete(n),
    open: async (n: string) => {
      const c = store.get(n) ?? new Map<string, Entry>();
      store.set(n, c);
      return {
        keys: async () => [...c.keys()].map((url) => ({ url })),
        match: async (k: string | { url: string }) => c.get(typeof k === 'string' ? k : k.url),
      };
    },
  },
});

/** Leaves a share in the inbox, as the service worker does on a share_target POST. */
function share(meta: { title?: string; text?: string; url?: string }, files: File[] = []): void {
  const c = new Map<string, Entry>();
  const list = files.map((f, i) => {
    const key = `${ORIGIN}app/inbox/${i}`;
    c.set(key, entry(f));
    return { key, name: f.name, type: f.type };
  });
  const m = { title: '', text: '', url: '', ...meta, files: list };
  c.set(`${ORIGIN}app/inbox/meta`, entry(new Blob([JSON.stringify(m)], { type: 'application/json' })));
  store.set('versus-inbox', c);
}

const mine = () => S.ranks.filter((r) => !r.demo);

beforeAll(async () => {
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  share({ title: 'Restaurants', text: 'Restaurants\n- Chez Paul\n- Le Bouillon\n- Mimosa' });
  mount(document);
  await tick();
});

describe('shared to Versus', () => {
  it('makes a new ranking from a shared list when there is none to pick', () => {
    expect(store.has('versus-inbox')).toBe(false);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]?.title).toBe('Restaurants');
    expect(mine()[0]?.items.map((i) => i.label)).toEqual(['Chez Paul', 'Le Bouillon', 'Mimosa']);
    expect(toast()).toContain('3 items added');
  });

  it('offers a new ranking or one of this browser’s, and adds to the one picked', async () => {
    share({ title: 'Noma — Copenhagen', text: 'https://noma.dk/' });
    const done = receiveShare();
    await tick();
    expect($('#modal')?.hidden).toBe(false);
    expect($('#m-title')?.textContent).toBe('Add to Versus');
    expect($('#m-body')?.textContent).toContain('Add 1 item to:');
    const id = mine()[0]?.id ?? '';
    ($(`input[name="share-to"][value="${id}"]`) as HTMLInputElement).checked = true;
    $('#m-ok')?.click();
    await done;
    expect(mine()).toHaveLength(1);
    expect(mine()[0]?.items.map((i) => i.label)).toContain('Noma — Copenhagen');
  });

  it('adds nothing when the choice is cancelled', async () => {
    share({ text: 'Tea\nCoffee' });
    const done = receiveShare();
    await tick();
    $('#m-cancel')?.click();
    await done;
    expect(mine()).toHaveLength(1);
    expect(mine()[0]?.items).toHaveLength(4);
    expect(store.has('versus-inbox')).toBe(false);
  });

  it('imports a shared Versus file', async () => {
    const ranking = {
      id: 'shared01',
      title: 'Pizzas',
      method: 'bt',
      items: [
        { id: 'm', label: 'Margherita', img: null, fill: null, h: 1 },
        { id: 'r', label: 'Regina', img: null, fill: null, h: 2 },
      ],
      history: [],
      pair: null,
      created: 1,
      updated: 2,
    };
    const file = new File(
      [JSON.stringify({ format: FORMAT, version: VERSION, rankings: [ranking] })],
      'versus-pizzas.json',
      {
        type: 'application/json',
      },
    );
    share({}, [file]);
    await receiveShare();
    expect(toast()).toBe('Imported: 1 ranking');
    expect(S.ranks.some((r) => r.id === 'shared01')).toBe(true);
  });

  it('says so when a share holds nothing to add', async () => {
    share({ text: '   ' });
    await receiveShare();
    expect(toast()).toBe('Nothing in this share that Versus can add');
  });

  it('does nothing without a share', async () => {
    const before = S.ranks.length;
    await receiveShare();
    expect(S.ranks).toHaveLength(before);
  });
});
