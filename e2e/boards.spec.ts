import type { Page } from '@playwright/test';
import { E2E_ADMIN } from './env.ts';
import { expect, newRanking, test } from './fixtures.ts';

/** Published boards against the real Worker: an author, voters in other browsers, the admin link, moderation. */

const ALIAS = /\/app\/b\/([1-9A-HJ-NP-Za-km-z]{10})$/;

/** Publishes a new ranking of these items with the default settings; resolves with the board's alias. */
async function publish(page: Page, title: string, labels: string[]): Promise<string> {
  await newRanking(page, title, labels);
  await page.locator('[data-action="publish"]').click();
  await expect(page.locator('#m-title')).toHaveText('Publish this ranking?');
  await page.locator('#m-ok').click();
  await expect(page).toHaveURL(ALIAS);
  // The author works in the workspace, the board's status behind its Published button.
  await expect(page.locator('[data-action="b-settings"]')).toContainText('Published');
  return ALIAS.exec(new URL(page.url()).pathname)?.[1] ?? '';
}

/** A voter's page on the board, its first duel on screen. */
async function voterOn(page: Page, alias: string): Promise<void> {
  await page.goto(`app/b/${alias}`);
  await expect(page.locator('[data-action="b-pick"][data-side="a"]')).toBeVisible();
}

/** Votes the duel on screen for card A, waiting for the next one (or the end). */
async function vote(page: Page): Promise<void> {
  const mine = page.locator('.duel-top .eyebrow');
  const before = (await mine.textContent()) ?? '';
  await page.locator('[data-action="b-pick"][data-side="a"]').click();
  await expect(page.locator('.duel-top .eyebrow, .fin-top, .empty-duel').first()).not.toHaveText(before);
}

test('voters in other browsers vote live, the author closes the vote, everyone sees the final ranking', async ({
  page,
  person,
}) => {
  const alias = await publish(page, 'Best pizza', ['Margherita', 'Regina', 'Calzone']);
  const ana = await person();
  const ben = await person();
  await voterOn(ana, alias);
  await voterOn(ben, alias);
  await expect(ana.locator('h1.b-title')).toHaveText('Best pizza');
  // Votes reach the author's page as they come, with the online count.
  await vote(ana);
  await vote(ana);
  await vote(ben);
  await expect(page.locator('#b-counts')).toContainText('3 votes · 2 voters');
  await expect(ana.locator('#b-counts')).toContainText('3 votes · 2 voters');

  await page.locator('[data-action="b-settings"]').click();
  await page.locator('[data-action="b-close"]').click();
  await expect(page.locator('[data-action="b-settings"]')).toContainText('Closed');
  // Every voter's page follows at once: no more duels, the final ranking.
  for (const p of [ana, ben]) {
    await expect(p.locator('.empty-duel h2')).toHaveText('The vote is closed');
    await expect(p.locator('[data-action="b-pick"]')).toHaveCount(0);
    await expect(p.locator('#b-rank .b-rows li')).toHaveCount(3);
  }
  await expect(ben.locator('#b-counts')).toContainText('3 votes · 2 voters');
});

test('the admin link makes another browser the author, whose edits reach the first', async ({
  page,
  person,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const alias = await publish(page, 'Board games', ['Chess', 'Go', 'Catan']);
  await page.locator('[data-action="b-settings"]').click();
  await page.locator('[data-action="b-admin-link"]').click();
  await expect(page.locator('#toast')).toHaveText('Admin link copied. Keep it private.');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(new RegExp(`/app/b/${alias}#owner=[0-9a-f]{64}$`));

  // On another device, the admin link opens the board as its author and leaves the address clean.
  const laptop = await person();
  await laptop.goto(link);
  await expect(laptop.locator('[data-action="b-settings"]')).toContainText('Published');
  await expect(laptop).toHaveURL(new RegExp(`/app/b/${alias}$`));
  // The author renames an item there; the first browser follows.
  const go = laptop.locator('#item-list .row-label[value="Go"]');
  await go.fill('Go (board game)');
  await go.press('Enter');
  await expect(page.locator('#item-list .row-label[value="Go (board game)"]')).toHaveCount(1);
});

test('the author withdraws the board: voters see it gone, the author keeps a local copy', async ({ page, person }) => {
  const alias = await publish(page, 'Seasons', ['Spring', 'Summer', 'Autumn', 'Winter']);
  const voter = await person();
  await voterOn(voter, alias);
  await vote(voter);
  await page.locator('[data-action="b-settings"]').click();
  await page.locator('[data-action="b-withdraw"]').click();
  await expect(page.locator('#m-title')).toContainText('Withdraw');
  await page.locator('#m-ok').click();
  await expect(page.locator('#toast')).toHaveText('Withdrawn. Local copy kept.');
  await expect(page).toHaveURL(/\/app\/r\/[^/]+\/ranking$/);
  await expect(voter.locator('.empty-duel h2')).toHaveText('This ranking doesn’t exist or was withdrawn.');
  // The voter's card under "Your votes" says so too.
  await voter.locator('[data-action="back"]').first().click();
  await expect(voter.locator('.jcard, .rcard', { hasText: 'Seasons' }).first()).toContainText('Withdrawn');
});

test('a visitor reports a board, the moderator finds it on the admin page and takes it down', async ({
  page,
  person,
}) => {
  const alias = await publish(page, 'Reported board', ['One', 'Two', 'Three']);
  const visitor = await person();
  await voterOn(visitor, alias);
  await visitor.locator('[data-action="b-report"]').click();
  await visitor.locator('input[name="report-reason"][value="spam"]').check();
  await visitor.locator('#report-note').fill('Ads everywhere');
  await visitor.locator('#m-ok').click();
  await expect(visitor.locator('#toast')).toHaveText('Thanks, your report was sent.');

  const admin = await person();
  admin.on('dialog', (d) => void d.accept());
  await admin.goto('admin/');
  await admin.locator('#ad-token').fill(E2E_ADMIN);
  await admin.locator('#ad-token').press('Enter');
  await admin.locator('[data-act="filter"][data-filter="reported"]').click();
  const row = admin.locator(`[data-act="inspect"][data-alias="${alias}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(admin.locator('.ad-panel')).toContainText('Ads everywhere');
  await admin.locator('[data-act="delete"]').click();
  await expect(admin.locator('.ad-panel')).toHaveCount(0);
  // Gone for everyone, the author included.
  await expect(visitor.locator('.empty-duel h2')).toHaveText('This ranking doesn’t exist or was withdrawn.');
  await expect(page.locator('.empty-duel h2')).toHaveText('This ranking doesn’t exist or was withdrawn.');
});
