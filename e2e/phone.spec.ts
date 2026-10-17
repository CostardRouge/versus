import type { Page } from '@playwright/test';
import { expect, newRanking, openApp, test } from './fixtures.ts';

/** On a phone (Pixel 7: touch, 412 px wide): touch gestures, and no view wider than the screen. */

/** A finger dragged across the duel stage, from its middle, by dx pixels. */
async function swipe(page: Page, dx: number): Promise<void> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: at, y }] });
  await touch('touchStart', x);
  for (let i = 1; i <= 10; i++) await touch('touchMove', x + (dx * i) / 10);
  await touch('touchEnd', x + dx);
  await cdp.detach();
}

/** Whether the page scrolls sideways: it never should. */
const overflows = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

test('votes with a tap on a card and a swipe of the finger', async ({ page }) => {
  await newRanking(page, 'Pets', ['Cat', 'Dog', 'Rabbit']);
  await page.locator('.tab[data-tab="duel"]').click();
  const next = page.locator('.duel-top .eyebrow');
  await expect(next).toContainText('Duel #1');
  await page.locator('#stage .card-b').tap();
  await expect(next).toContainText('Duel #2');
  // To the right: card B wins.
  await swipe(page, 200);
  await expect(next).toContainText('Duel #3');
  const history = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('versus-v1') ?? '[]').find((r: { title: string }) => r.title === 'Pets').history,
  );
  expect(history).toHaveLength(2);
  expect(history[1].s).toBe(0);
  // A small move is no vote.
  await swipe(page, 20);
  await page.waitForTimeout(500);
  await expect(next).toContainText('Duel #3');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('versus-v1') ?? '[]').find((r: { title: string }) => r.title === 'Pets')
          .history,
    ),
  ).toHaveLength(2);
});

test('never scrolls sideways: the gallery, a demo’s duel and ranking, the items, the legal notice', async ({
  page,
}) => {
  await openApp(page);
  expect(await overflows(page)).toBe(false);
  for (const path of ['demo/destinations', 'demo/destinations/ranking', 'demo/destinations/items']) {
    await openApp(page, path);
    expect(await overflows(page), path).toBe(false);
  }
  await page.goto('');
  await expect(page.locator('h1')).toBeVisible();
  expect(await overflows(page), 'home').toBe(false);
  await page.goto('legal/');
  expect(await overflows(page), 'legal').toBe(false);
});
