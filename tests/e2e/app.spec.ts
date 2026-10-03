import { expect, test } from '@playwright/test';
import { demo, fakeApi, stored } from './helpers';

test.beforeEach(async ({ page }) => {
  await fakeApi(page);
  await page.goto('app/');
});

test('plays duels with the keyboard, and never from a tab', async ({ page }) => {
  await page
    .getByRole('link', { name: /Next destination/ })
    .first()
    .click();
  const before = (await demo(page)).history.length;
  await page.locator('body').press('ArrowLeft');
  await expect.poll(async () => (await demo(page)).history.length).toBe(before + 1);
  // Arrows pressed on a tab move between tabs; they never cast a vote.
  const tab = page.getByRole('tab', { name: 'Ranking' });
  await tab.focus();
  await tab.press('ArrowRight');
  await tab.press('ArrowLeft');
  await page.waitForTimeout(700);
  expect((await demo(page)).history.length).toBe(before + 1);
});

test('takes a swipe as a pick', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the gesture is the phone’s');
  await page
    .getByRole('link', { name: /Next destination/ })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Duel' }).click();
  const before = await demo(page);
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  if (!box || !before.pair) throw new Error('no duel on screen');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, y, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 - 200, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await demo(page)).history.length).toBe(before.history.length + 1);
  const last = (await demo(page)).history.at(-1);
  expect([last?.a, last?.b]).toEqual(before.pair);
  expect(last?.s).toBe(1);
});

test('builds a ranking from a typed list, removes an item and brings it back', async ({ page }) => {
  await page
    .getByRole('button', { name: /New ranking/ })
    .first()
    .click();
  const add = page.locator('#add-input');
  await add.fill('Tea\\nCoffee\\nCocoa');
  await add.press('Enter');
  const names = page.locator('#item-list .row-label');
  await expect(names).toHaveCount(3);
  await page.getByRole('button', { name: /Remove Coffee/ }).click();
  await expect(names).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(names).toHaveCount(3);
  const r = (await stored(page)).at(-1);
  expect(r?.items.map((i) => i.label).sort()).toEqual(['Cocoa', 'Coffee', 'Tea']);
});

test('adds a color and edits it in the popover, closed with Escape', async ({ page }) => {
  await page
    .getByRole('button', { name: /New ranking/ })
    .first()
    .click();
  await page.locator('#add-input').fill('#2743f5');
  await page.locator('#add-input').press('Enter');
  const swatch = page.locator('.thumb-btn').first();
  await swatch.click();
  const pop = page.locator('#cpop');
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(swatch).toBeFocused();
});

test('shares a ranking as a picture, the drawing code loaded on demand', async ({ page }) => {
  await page.goto('app/demo/destinations/ranking');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const preview = page.locator('#share-preview');
  await expect(preview.locator('canvas')).toBeVisible();
  await expect(preview).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#share-msg')).toContainText('Next destination');
});

