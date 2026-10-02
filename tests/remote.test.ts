import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchBoard, putItemImage } from '../src/app/remote';

/** The app's API client: what a request that fails or hangs becomes. */

afterEach(() => {
  vi.unstubAllGlobals();
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
