import { afterEach, describe, expect, it, vi } from 'vitest';
import { Run } from '../src/landing/motion';

/** The home page's scripted loops (src/landing/motion.ts). */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loops on the home page', () => {
  it('hold while the visitor asks for reduced motion, also when asked with the page open', async () => {
    vi.useFakeTimers();
    let reduce = false;
    vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
    const run = new Run(() => true);
    let steps = 0;
    void (async () => {
      for (;;) {
        await run.wait(100);
        steps++;
      }
    })().catch(() => {});
    await vi.advanceTimersByTimeAsync(350);
    expect(steps).toBe(3);
    reduce = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(steps).toBe(3);
    reduce = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(steps).toBeGreaterThan(3);
    run.stop();
  });
});
