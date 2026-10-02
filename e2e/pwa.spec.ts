import type { Page } from '@playwright/test';
import { E2E_PORT } from './env.ts';
import { expect, newRanking, openApp, test } from './fixtures.ts';

/** The service worker: the app offline, and the notifications of published boards (D125–D127). */

const ORIGIN = `http://localhost:${E2E_PORT}`;

/** Waits until the service worker controls the page (the first visit installs it, then claims the page). */
async function controlled(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test('opens offline once visited: the gallery, a demo, a duel, a ranking of this browser', async ({
  page,
  context,
}) => {
  await newRanking(page, 'Offline snacks', ['Crisps', 'Nuts']);
  await controlled(page);
  await context.setOffline(true);
  await page.goto('app/');
  await expect(page.locator('.rcard', { hasText: 'Offline snacks' }).first()).toBeVisible();
  await page.goto('app/demo/destinations');
  const next = page.locator('.duel-top .eyebrow');
  const before = await next.textContent();
  await page.locator('[data-action="pick"][data-side="a"]').click();
  await expect(next).not.toHaveText(before ?? '');
  // The fonts came from the cache too.
  expect(await page.evaluate(() => document.fonts.check('16px Figtree'))).toBe(true);
  // Published boards need the network: the home page offline is the stored copy.
  await page.goto('');
  await expect(page.locator('h1')).toBeVisible();
  await context.setOffline(false);
});

test('shows a notification the Worker sends, and refuses one that points elsewhere', async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  await openApp(page);
  await controlled(page);
  const cdp = await context.newCDPSession(page);
  const registrations: { registrationId: string; isDeleted: boolean }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrations.some((r) => !r.isDeleted)).toBe(true);
  const registrationId = registrations.find((r) => !r.isDeleted)?.registrationId ?? '';
  const push = (data: object) =>
    cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data: JSON.stringify(data) });
  const shown = () =>
    page.evaluate(async () =>
      (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        badge: (n as Notification & { badge: string }).badge,
        data: n.data,
      })),
    );
  const msg = { title: 'Pizzas', body: 'The vote is closed: see the crowd’s final ranking.', path: 'app/b/Ab3dEf7hJk' };
  await push({ ...msg, tag: 'closed-Ab3dEf7hJk' });
  await push({ ...msg, tag: 'elsewhere', path: 'https://example.com/' });
  await expect.poll(shown).toEqual([
    {
      title: 'Pizzas',
      body: msg.body,
      tag: 'closed-Ab3dEf7hJk',
      badge: `${ORIGIN}/badge-96.png`,
      data: { path: 'app/b/Ab3dEf7hJk' },
    },
  ]);
  // A newer one of the same board and kind replaces it.
  await push({ ...msg, body: 'Newer', tag: 'closed-Ab3dEf7hJk' });
  await expect.poll(async () => (await shown()).map((n) => n.body)).toEqual(['Newer']);
});

test('a tapped notification brings the open app to its board', async ({ page, context }) => {
  await newRanking(page, 'Somewhere', ['A', 'B']);
  await controlled(page);
  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error('no service worker');
  // What the worker does on a tap, when the app is open: it asks the page to open the board.
  await worker.evaluate(async () => {
    // The worker's global scope (the DOM types here don't know it).
    const sw = self as unknown as { clients: { matchAll(o: object): Promise<{ postMessage(m: unknown): void }[]> } };
    for (const c of await sw.clients.matchAll({ type: 'window' }))
      c.postMessage({ t: 'open', path: 'app/b/Ab3dEf7hJk' });
  });
  await expect(page).toHaveURL(/\/app\/b\/Ab3dEf7hJk$/);
  await expect(page.locator('.empty-duel h2')).toHaveText('This ranking doesn’t exist or was withdrawn.');
});

test('offers the voter’s bell, and says so when the browser can’t subscribe', async ({ page, person }) => {
  await newRanking(page, 'Bells', ['Ding', 'Dong', 'Ring']);
  await page.locator('[data-action="publish"]').click();
  await page.locator('#m-ok').click();
  await expect(page).toHaveURL(/\/app\/b\/\w{10}$/);
  const link = page.url();
  // The author's box sits in the board's settings.
  await controlled(page);
  await page.locator('[data-action="b-settings"]').click();
  await expect(page.locator('#b-push')).toBeVisible();
  await page.keyboard.press('Escape');

  const voter = await person();
  await voter.context().grantPermissions(['notifications'], { origin: ORIGIN });
  await voter.goto(link);
  await controlled(voter);
  const bell = voter.locator('[data-action="b-notify"]');
  await expect(bell).toHaveText('Notify me');
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  // Playwright's browsers have no push service: the subscription fails, and the bell stays off.
  await bell.click();
  await expect(voter.locator('#toast')).toHaveText('Notifications couldn’t be turned on. Try again later.');
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  expect(await voter.evaluate(() => localStorage.getItem('versus-push'))).toBeNull();
});
