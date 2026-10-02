/**
 * Takes the manifest's screenshots (SCREENSHOTS in build/site.ts) of the real app, on the demos: `npm run
 * screenshots`, then commit the files in public/. Run it again after a visible change to the views it shows,
 * and rename the files when the pictures change: browsers cache them by URL.
 *
 * It starts Vite's dev server and opens each view in Playwright's Chromium: English, light theme, reduced
 * motion, a fresh browser each time (the demos as everyone first sees them), nothing loaded from other sites,
 * and Math.random seeded, so the duels on screen are the same from one run to the next.
 *
 * Needs a Chromium for Playwright: `npx playwright install chromium` once, or CHROMIUM_PATH=/path/to/chrome.
 */

import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { SCREEN_SIZES, SCREENSHOTS } from '../build/site.ts';

/** Picked for the pairs it puts on screen: close duels read better than a foregone one. */
const SEED = 7;

const out = new URL('../public/', import.meta.url);
const server = await createServer({ logLevel: 'error', server: { strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error('the dev server has no local address');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

try {
  for (const shot of SCREENSHOTS) {
    const size = SCREEN_SIZES[shot.form];
    const narrow = shot.form === 'narrow';
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
      isMobile: narrow,
      hasTouch: narrow,
      locale: 'en-US',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    await context.route(
      (url) => !url.href.startsWith(base),
      (route) => route.abort(),
    );
    // mulberry32, as the demos use (src/core/util.ts): the app's pair choices draw from Math.random.
    await context.addInitScript((seed: number) => {
      let a = seed;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    }, SEED);
    const page = await context.newPage();
    await page.goto(new URL(`app/${shot.view}`, base).href);
    await page.waitForSelector('#view > *');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const file = new URL(shot.file, out);
    await page.screenshot({ path: file.pathname });
    console.log(`${shot.file.padEnd(28)} ${size.width * size.scale}×${size.height * size.scale}  ${shot.view}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
