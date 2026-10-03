import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import type { BoardView, ServerMessage } from '../../src/core/protocol';
import { fakeApi } from './helpers';

/** Every page and view, checked by axe against WCAG 2.2 AA, in both themes: contrast, names, roles, structure. */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Fails with each rule broken, where, and why, for what is on screen now. */
async function checkA11y(page: Page, what: string): Promise<void> {
  // What is on screen once it settled: an entrance animation caught halfway would be judged at its first frame.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' ')} → ${n.failureSummary}`).join(' | ')}`,
  );
  expect(found, what).toEqual([]);
}

const ALIAS = 'Ab3dEf7hJk';
const view: BoardView = {
  title: 'Pizzas',
  items: ['Margherita', 'Regina', 'Calzone'].map((label, i) => ({
    id: `p${i}`,
    label,
    img: null,
    fill: null,
    h: 10 + i * 90,
  })),
  settings: { method: 'bt', visibility: 'always', revealAfter: 2, allowChange: true, visitorsAddItems: true },
  status: 'open',
  created: 1,
  counts: { votes: 4, voters: 2, online: 1 },
  ranking: {
    method: 'bt',
    order: ['p0', 'p1', 'p2'],
    stats: Object.fromEntries(
      ['p0', 'p1', 'p2'].map((id, i) => [id, { score: 1600 - 100 * i, se: 30, w: 2 - i, l: i, d: 0 }]),
    ),
  },
};

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await fakeApi(page, (method, path) =>
        method === 'GET' && path === `/api/boards/${ALIAS}` ? { status: 200, body: view } : null,
      );
    });

    test('the home pages and the legal notice', async ({ page }) => {
      for (const path of ['./', 'fr/', 'legal/', 'fr/mentions-legales/']) {
        await page.goto(path);
        await checkA11y(page, path);
      }
    });

    test('the app: gallery, duel, ranking, items, color editor, a dialog', async ({ page, isMobile }) => {
      await page.goto('app/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await checkA11y(page, 'gallery');
      await page
        .getByRole('link', { name: /Next destination/ })
        .first()
        .click();
      await expect(page.locator('#stage .card')).toHaveCount(2);
      await checkA11y(page, 'duel');
      await page.getByRole('tab', { name: 'Ranking' }).click();
      await checkA11y(page, 'ranking');
      if (isMobile) {
        await page.getByRole('tab', { name: 'Items' }).click();
        await checkA11y(page, 'items');
      }
      await page.goto('app/demo/accent');
      if (isMobile) await page.getByRole('tab', { name: 'Items' }).click();
      await page.locator('.thumb-btn').first().click();
      await expect(page.locator('#cpop')).toBeVisible();
      await checkA11y(page, 'color editor');
      await page.keyboard.press('Escape');
      await page.goto('app/');
      await page.locator('[data-action="new-rank"]').first().click();
      await page.locator('.ws-head [data-action="back"]').click();
      await page.locator('[data-action="delete"]').first().click();
      await expect(page.locator('#modal')).toBeVisible();
      await checkA11y(page, 'confirm dialog');
    });

    test('a published board', async ({ page }) => {
      await page.routeWebSocket(`**/api/boards/${ALIAS}`, (ws) => {
        const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
        ws.onMessage(() =>
          send({
            t: 'state',
            board: view,
            owner: false,
            mine: [],
            pairs: [
              ['p0', 'p1'],
              ['p1', 'p2'],
            ],
          }),
        );
      });
      await page.goto(`app/b/${ALIAS}`);
      await expect(page.locator('#b-main .card')).toHaveCount(2);
      await checkA11y(page, 'board');
    });
  });
}
