import { expect, type Page, test } from '@playwright/test';
import type { BoardView, ClientMessage, ServerMessage } from '../../src/core/protocol';
import { fakeApi } from './helpers';

const ALIAS = 'Ab3dEf7hJk';
const items = ['Margherita', 'Regina', 'Calzone'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: null,
  h: 10 + i * 90,
}));
const view: BoardView = {
  title: 'Pizzas',
  items,
  settings: { method: 'bt', visibility: 'always', revealAfter: 2, allowChange: true, visitorsAddItems: false },
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

/** Opens the board on a faked server, votes on its three pairs, and returns the messages sent. */
async function voteAll(page: Page): Promise<ClientMessage[]> {
  await fakeApi(page, (method, path) =>
    method === 'GET' && path === `/api/boards/${ALIAS}` ? { status: 200, body: view } : null,
  );
  const sent: ClientMessage[] = [];
  await page.routeWebSocket(`**/api/boards/${ALIAS}`, (ws) => {
    const queue: [string, string][] = [
      ['p0', 'p1'],
      ['p1', 'p2'],
      ['p0', 'p2'],
    ];
    let mine = 0;
    const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as ClientMessage;
      sent.push(m);
      if (m.t === 'hello') send({ t: 'state', board: view, owner: false, mine: [], pairs: queue.slice(0, 3) });
      if (m.t === 'vote') {
        queue.shift();
        mine++;
        send({ t: 'pairs', pairs: queue.slice(0, 3), mine });
      }
    });
  });
  await page.goto(`app/b/${ALIAS}`);
  await expect(page.getByRole('heading', { name: 'Pizzas' })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    // The next duel, once the last pick's animation is over (a click during it doesn't count).
    await expect(page.locator('#stage.picked')).toHaveCount(0);
    const card = page.locator('#b-main .card-a');
    await expect(card).toBeVisible();
    await card.click();
    await expect.poll(() => sent.filter((m) => m.t === 'vote').length).toBe(i + 1);
  }
  return sent;
}

test('votes every pair of a published board, then sees the result on a page of its own', async ({ page }) => {
  const sent = await voteAll(page);
  await expect(page.getByRole('heading', { name: 'You voted on every pair' })).toBeVisible();
  expect(sent[0]).toMatchObject({ t: 'hello' });
});

test('Back from the end-of-vote page returns to the board, not out of it', async ({ page }) => {
  await voteAll(page);
  await expect(page.locator('#fin')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#fin')).toHaveCount(0);
  await expect(page.locator('#b-main [data-action="b-finale"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pizzas' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/app/b/${ALIAS}`);
  // Forward opens it again; its own button closes it, at the same address.
  await page.goForward();
  await expect(page.locator('#fin')).toBeVisible();
  await page.locator('#fin .back[data-action="b-finale-close"]').click();
  await expect(page.locator('#fin')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/app/b/${ALIAS}`);
});
