import { afterEach, describe, expect, it, vi } from 'vitest';

/** The service worker's install, against fake caches: what a new version downloads, and what it copies over. */

const SCOPE = 'https://versus.example.com/';

class FakeCache {
  readonly entries = new Map<string, string>();
  async match(req: Request | string): Promise<Response | undefined> {
    const body = this.entries.get(typeof req === 'string' ? req : req.url);
    return body === undefined ? undefined : new Response(body);
  }
  async put(req: Request | string, res: Response): Promise<void> {
    this.entries.set(typeof req === 'string' ? req : req.url, await res.text());
  }
  async addAll(reqs: Request[]): Promise<void> {
    for (const req of reqs) await this.put(req, await fetch(req));
  }
}

/** Loads the worker as a version holding `files`, with the caches already there; returns its install. */
async function load(version: string, files: string[], stored: Map<string, FakeCache>) {
  vi.resetModules();
  const listeners: Record<string, (e: unknown) => void> = {};
  vi.stubGlobal('__PRECACHE__', files);
  vi.stubGlobal('__VERSION__', version);
  vi.stubGlobal('self', {
    registration: { scope: SCOPE },
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
  });
  vi.stubGlobal('caches', {
    keys: async () => [...stored.keys()],
    has: async (name: string) => stored.has(name),
    delete: async (name: string) => stored.delete(name),
    open: async (name: string) => {
      const cache = stored.get(name) ?? new FakeCache();
      stored.set(name, cache);
      return cache;
    },
  });
  const path = '../src/sw/sw.ts';
  await import(/* @vite-ignore */ path);
  const run = (type: string) => async () => {
    let done: Promise<unknown> = Promise.resolve();
    listeners[type]?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return Object.assign(run('install'), { activate: run('activate') });
}

afterEach(() => vi.unstubAllGlobals());

describe('service worker install', () => {
  it('downloads what changed and copies the hashed files the previous version holds', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        fetched.push(new URL(req.url).pathname);
        return new Response(`body of ${new URL(req.url).pathname}`);
      }),
    );
    const stored = new Map<string, FakeCache>();
    const first = ['./', 'app/', 'assets/app-1.js', 'assets/font-a.woff2', 'icon-192.png'];
    await (await load('one', first, stored))();
    expect(fetched.sort()).toEqual(['/', '/app/', '/assets/app-1.js', '/assets/font-a.woff2', '/icon-192.png']);

    fetched.length = 0;
    const second = ['./', 'app/', 'assets/app-2.js', 'assets/font-a.woff2', 'icon-192.png'];
    await (await load('two', second, stored))();
    // The font kept its hashed name: copied. The pages, the icon and the new bundle: downloaded.
    expect(fetched.sort()).toEqual(['/', '/app/', '/assets/app-2.js', '/icon-192.png']);
    expect(stored.get('versus-two')?.entries.get(`${SCOPE}assets/font-a.woff2`)).toBe('body of /assets/font-a.woff2');
  });

  it('fails an install whose cache an older version deleted meanwhile, and stores its files again on activation', async () => {
    const stored = new Map<string, FakeCache>();
    const files = ['./', 'app/', 'assets/app-3.js'];
    // Reload in a tab while this version installs: the waiting older one takes over and deletes the other caches.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        if (new URL(req.url).pathname === '/assets/app-3.js') stored.delete('versus-three');
        return new Response(`body of ${new URL(req.url).pathname}`);
      }),
    );
    const three = await load('three', files, stored);
    await expect(three()).rejects.toThrow('deleted');
    // Activated anyway (another install that went through, later): its files come back before it serves.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => new Response(`body of ${new URL(req.url).pathname}`)),
    );
    stored.delete('versus-three');
    await three.activate();
    expect(stored.get('versus-three')?.entries.get(`${SCOPE}app/`)).toBe('body of /app/');
  });
});
