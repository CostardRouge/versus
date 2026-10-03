import type { Page } from '@playwright/test';
import type { Ranking } from '../../src/core/types';

/** The published boards API, answered by the test: Popular empty, anything not handled as a missing board. */
export async function fakeApi(
  page: Page,
  handle: (method: string, path: string) => { status: number; body: unknown } | null = () => null,
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const answer = handle(route.request().method(), url.pathname) ??
      (url.pathname === '/api/popular' ? { status: 200, body: { boards: [] } } : null) ??
      (url.pathname === '/api/config' ? { status: 200, body: { images: 'off' } } : null) ?? {
        status: 404,
        body: { error: 'not_found' },
      };
    await route.fulfill({ status: answer.status, json: answer.body });
  });
}

/** The rankings this browser keeps. */
export const stored = (page: Page): Promise<Ranking[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('versus-v1') ?? '[]'));

/** One of the demos, by its id, as stored. */
export async function demo(page: Page, id = 'demo-destinations'): Promise<Ranking> {
  const r = (await stored(page)).find((x) => x.id === id);
  if (!r) throw new Error(`no ${id}`);
  return r;
}
