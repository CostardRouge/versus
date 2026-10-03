import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, BoardSocket, type Connection, fetchBoard, putItemImage } from '../src/app/remote';

/** The app's API client: what a request that fails or hangs becomes, and a board's socket when it can't connect. */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('API requests', () => {
  it('give up after a while: a timeout is a network failure', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchBoard('Ab3dEf7hJk')).rejects.toEqual(new ApiError('network'));
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await expect(putItemImage('Ab3dEf7hJk', 'b'.repeat(64), 'p0', jpeg)).rejects.toEqual(new ApiError('network'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('read the server’s error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })),
    );
    await expect(fetchBoard('Ab3dEf7hJk')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('a board’s socket', () => {
  class FakeWs {
    static all: FakeWs[] = [];
    private listeners: Record<string, ((e: unknown) => void)[]> = {};
    constructor(readonly url: string) {
      FakeWs.all.push(this);
    }
    addEventListener(type: string, fn: (e: unknown) => void): void {
      this.listeners[type] = [...(this.listeners[type] ?? []), fn];
    }
    emit(type: string, e: unknown): void {
      for (const fn of this.listeners[type] ?? []) fn(e);
    }
    close(): void {}
  }

  it('says it is lost within a second even when the API hangs too, and tries again at once on demand', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWs);
    vi.stubGlobal('location', { href: 'http://localhost/app/b/Ab3dEf7hJk' });
    // The API never answers whether the board still exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const states: Connection[] = [];
    const socket = new BoardSocket(
      'Ab3dEf7hJk',
      { t: 'hello', v: 1, voter: 'v'.repeat(22) },
      () => {},
      (c) => states.push(c),
    );
    FakeWs.all[0]?.emit('close', { code: 1006 });
    await vi.advanceTimersByTimeAsync(999);
    expect(states).toEqual(['connecting']);
    await vi.advanceTimersByTimeAsync(1);
    expect(states).toEqual(['connecting', 'lost']);
    socket.retryNow();
    expect(FakeWs.all).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');
    // Nothing more while that connection is being made.
    socket.retryNow();
    expect(FakeWs.all).toHaveLength(2);
    socket.close();
  });
});
