import { type Browser, type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { E2E_PORT } from './env.ts';

/**
 * Every browser of a test is a separate person: its own storage, its own client address (the Worker limits
 * publications and requests per address), nothing loaded from other sites, audience measurement off.
 */

const ORIGIN = `http://localhost:${E2E_PORT}`;

const randomIp = (): string =>
  `10.${Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b % 250)
    .join('.')}`;

export async function isolate(context: BrowserContext): Promise<void> {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': randomIp() });
  await context.route(
    (url) => url.origin !== ORIGIN,
    (route) => route.abort(),
  );
  // Umami's own opt-out key: the tracker is never loaded (src/audience.ts).
  await context.addInitScript(() => localStorage.setItem('umami.disabled', '1'));
}

interface Fixtures {
  /** Another person, in a browser of their own (a voter, an admin), closed after the test. */
  person: () => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await isolate(context);
    await use(context);
  },
  person: async ({ browser, contextOptions }, use) => {
    const opened: BrowserContext[] = [];
    await use(async () => {
      const context = await (browser as Browser).newContext(contextOptions);
      opened.push(context);
      await isolate(context);
      return context.newPage();
    });
    for (const c of opened) await c.close();
  },
});

export { expect };

/** Opens a view of the app and waits for its first render. */
export async function openApp(page: Page, path = ''): Promise<void> {
  await page.goto(`app/${path}`);
  await expect(page.locator('#view > *').first()).toBeVisible();
}

/** Types items into the add field of the ranking on screen, one by one. */
export async function addItems(page: Page, labels: string[]): Promise<void> {
  const input = page.locator('#add-input');
  for (const label of labels) {
    await input.fill(label);
    await input.press('Enter');
  }
}

/** A new ranking with these items, on its Items tab. */
export async function newRanking(page: Page, title: string, labels: string[]): Promise<void> {
  await openApp(page);
  await page.locator('[data-action="new-rank"]').first().click();
  const name = page.locator('#rank-title');
  await name.fill(title);
  await name.press('Enter');
  await addItems(page, labels);
  await expect(page.locator('#item-list li[data-id]')).toHaveCount(labels.length);
}

/** The labels of the items list, in its order. */
export const itemLabels = (page: Page): Promise<string[]> =>
  page.locator('#item-list .row-label').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
