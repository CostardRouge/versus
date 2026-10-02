import { expect, itemLabels, newRanking, openApp, test } from './fixtures.ts';

/** Rankings of this browser: items typed, pasted and dropped, duels by button, key and swipe, colors, results. */

test('duels with the buttons, the keyboard and a swipe, undoes one, and keeps it all after a reload', async ({
  page,
}) => {
  await newRanking(page, 'Fruits', ['Apple', 'Pear', 'Plum', 'Fig']);
  await page.locator('.tab[data-tab="duel"]').click();
  const stage = page.locator('#stage');
  await expect(stage.locator('.card')).toHaveCount(2);
  // The duel on screen is numbered: "Duel #4" once three are recorded.
  const next = page.locator('.duel-top .eyebrow');
  await expect(next).toContainText('Duel #1');

  await page.locator('[data-action="pick"][data-side="a"]').click();
  await expect(next).toContainText('Duel #2');
  await page.keyboard.press('ArrowRight');
  await expect(next).toContainText('Duel #3');
  await page.keyboard.press('ArrowDown');
  await expect(next).toContainText('Duel #4');

  // A swipe to the left: card A wins.
  const a = (await stage.locator('.card-a').textContent())?.trim() ?? '';
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let dx = 0; dx <= 220; dx += 20) await page.mouse.move(box.x + box.width / 2 - dx, y);
  await page.mouse.up();
  await expect(next).toContainText('Duel #5');
  // A short drag is no vote: the cards spring back.
  const b2 = await stage.boundingBox();
  if (!b2) throw new Error('no stage');
  await page.mouse.move(b2.x + b2.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2 + 30, y);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const history = async (): Promise<{ s: number }[]> =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('versus-v1') ?? '[]').find((r: { title: string }) => r.title === 'Fruits')
          .history,
    );
  const four = await history();
  expect(four).toHaveLength(4);
  expect(four[3]?.s).toBe(1);

  await page.keyboard.press('Control+z');
  await expect(next).toContainText('Duel #4');
  expect(await history()).toHaveLength(3);
  // The swipe's vote went to the card on the left; undone, its pair is back on screen.
  await expect(stage.locator('.card-a')).toContainText(a);

  await page.reload();
  await expect(page.locator('#rank-title')).toHaveValue('Fruits');
  await page.locator('.tab[data-tab="results"]').click();
  await expect(page.locator('.results')).toBeVisible();
  await expect(page.locator('.results')).toContainText('Apple');
});

test('adds a pasted list in one go, skipping what is already there', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await newRanking(page, 'Drinks', ['Tea']);
  await page.evaluate(() => navigator.clipboard.writeText('- Coffee\n- tea\n- Cocoa\n- #2743f5'));
  await page.locator('#add-input').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#toast')).toContainText('3 items added · 1 duplicate skipped');
  expect((await itemLabels(page)).sort()).toEqual(['#2743F5', 'Cocoa', 'Coffee', 'Tea']);
  // The color code became a color item.
  await expect(page.locator('.thumb-btn[aria-label*="#2743F5"]')).toBeVisible();
});

test('edits a color item in its popover: a gradient, a stop typed in, the label following the code', async ({
  page,
}) => {
  await newRanking(page, 'Colors', ['#2743f5', '#f5a327']);
  const swatch = page.locator('.thumb-btn').first();
  const label = await page.locator('#item-list .row-label').first().inputValue();
  await swatch.click();
  const pop = page.locator('#cpop');
  await expect(pop).toBeVisible();
  // The popover sits on screen, next to its swatch.
  const p = await pop.boundingBox();
  const viewport = page.viewportSize();
  expect(p && viewport && p.x >= 0 && p.y >= 0 && p.x + p.width <= viewport.width).toBe(true);

  await pop.locator('[data-action="cp-type"][data-type="gradient"]').click();
  await expect(pop.locator('.cp-stop')).toHaveCount(2);
  const second = pop.locator('.cp-hex[data-i="1"]');
  await second.fill('#00AA55');
  await second.press('Enter');
  await expect(page.locator('#cp-preview')).toHaveAttribute('style', /linear-gradient/);
  await pop.locator('[data-action="cp-done"], [data-action="cp-ok"]').click();
  await expect(pop).toBeHidden();
  const labels = await itemLabels(page);
  // The label was the code: it follows the new fill.
  expect(labels).not.toContain(label);
  expect(labels.some((l) => l.includes('00AA55'))).toBe(true);
  // Escape closes the popover without a change.
  await swatch.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('takes images dropped on the page into the open ranking, kept in IndexedDB', async ({ page }) => {
  await newRanking(page, 'Photos', ['Text item']);
  // Two small pictures, made in the page, dropped as files.
  const drop = await page.evaluateHandle(async () => {
    const dt = new DataTransfer();
    for (const [name, color] of [
      ['beach.png', '#2a9df4'],
      ['hills.png', '#3cb371'],
    ]) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = color as string;
      g.fillRect(0, 0, 64, 48);
      const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b as Blob), 'image/png'));
      dt.items.add(new File([blob], name as string, { type: 'image/png' }));
    }
    return dt;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: drop });
  await expect(page.locator('body')).toHaveClass(/dropping/);
  await page.dispatchEvent('body', 'drop', { dataTransfer: drop });
  await expect(page.locator('#item-list li[data-id]')).toHaveCount(3);
  expect((await itemLabels(page)).sort()).toEqual(['Beach', 'Hills', 'Text item']);
  await expect(page.locator('body')).not.toHaveClass(/dropping/);
  // Saved as references; the pictures themselves went to IndexedDB, and come back after a reload.
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('versus-v1') ?? '')).toContain('idb:');
  await page.reload();
  await expect(page.locator('#item-list img')).toHaveCount(2);
});

test('imports a Versus file dropped on the gallery, then exports one ranking', async ({ page }) => {
  await openApp(page);
  const file = {
    format: 'versus',
    version: 1,
    exported: Date.now(),
    rankings: [
      {
        id: 'e2eimport1',
        title: 'Imported board games',
        method: 'bt',
        items: [
          { id: 'g1', label: 'Chess', img: null, fill: null, h: 1 },
          { id: 'g2', label: 'Go', img: null, fill: null, h: 2 },
        ],
        history: [{ a: 'g1', b: 'g2', s: 1 }],
        pair: null,
        created: 1,
        updated: 1,
      },
    ],
  };
  const drop = await page.evaluateHandle((json) => {
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'versus-2026-10-02.json', { type: 'application/json' }));
    return dt;
  }, JSON.stringify(file));
  await page.dispatchEvent('body', 'drop', { dataTransfer: drop });
  await expect(page.locator('#toast')).toContainText('Imported');
  await expect(page.locator('.rcard', { hasText: 'Imported board games' })).toBeVisible();

  await page.locator('.rcard [data-action="open"][data-id="e2eimport1"]').first().click();
  await page.locator('.tab[data-tab="results"]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-action="export-one"]').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^versus-.*\.json$/);
});

test('names each view in the address bar, follows Back, and switches the language', async ({ page }) => {
  await openApp(page);
  await page.locator('.rcard [data-action="open"][data-id="demo-destinations"][data-tab="duel"]').first().click();
  await expect(page).toHaveURL(/\/app\/demo\/destinations$/);
  // A tab replaces the address; a view adds one.
  await page.locator('.tab[data-tab="results"]').click();
  await expect(page).toHaveURL(/\/app\/demo\/destinations\/ranking$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.locator('.rcard').first()).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/demo\/destinations\/ranking$/);
  await expect(page.locator('.results')).toBeVisible();
  await page.locator('[data-action="lang"][data-l="fr"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.tab[data-tab="results"]')).toContainText('Classement');
});
