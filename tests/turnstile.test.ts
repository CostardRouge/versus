import { describe, expect, it, vi } from 'vitest';
import { SITEVERIFY, verifyTurnstile } from '../worker/src/turnstile';

const answer = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

describe('verifyTurnstile', () => {
  it('sends the secret, the token and the client address', async () => {
    const fetcher = answer({ success: true });
    expect(await verifyTurnstile('tok', '203.0.113.7', 'secret', fetcher)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY);
    const form = init.body as FormData;
    expect([form.get('secret'), form.get('response'), form.get('remoteip')]).toEqual(['secret', 'tok', '203.0.113.7']);
  });

  it('refuses a missing or oversized token without calling Turnstile', async () => {
    const fetcher = answer({ success: true });
    expect(await verifyTurnstile(undefined, null, 'secret', fetcher)).toBe(false);
    expect(await verifyTurnstile('', null, 'secret', fetcher)).toBe(false);
    expect(await verifyTurnstile('x'.repeat(3000), null, 'secret', fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses when Turnstile says no or cannot be reached, and logs which', async () => {
    const lines = vi.spyOn(console, 'log').mockImplementation(() => {});
    const refusal = answer({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await verifyTurnstile('tok', null, 'secret', refusal)).toBe(false);
    expect(await verifyTurnstile('tok', null, 'secret', answer('nope'))).toBe(false);
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await verifyTurnstile('tok', null, 'secret', down)).toBe(false);
    // A request that hangs is cut short: the same as no answer.
    const hung = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await verifyTurnstile('tok', null, 'secret', hung as unknown as typeof fetch)).toBe(false);
    expect(lines.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { event: 'turnstile_refused', codes: 'timeout-or-duplicate' },
      { event: 'turnstile_refused', codes: '' },
      { event: 'turnstile_unreachable', error: 'offline' },
      { event: 'turnstile_unreachable', error: 'The operation timed out.' },
    ]);
    lines.mockRestore();
  });
});
