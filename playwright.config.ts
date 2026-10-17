import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './e2e/env.ts';

/**
 * End-to-end tests in a real browser (`npm run e2e`), two suites that complete each other:
 *
 * - `desktop` and `phone` (tests/e2e): what jsdom can't show (layout, pointer gestures, focus, the canvas, axe's
 *   color contrast). The app runs on Vite's dev server; the published boards API and its WebSocket are faked per
 *   test (page.route, page.routeWebSocket), so no Worker is needed.
 * - `worker-desktop` and `worker-phone` (e2e, D134): the real Worker in Wrangler's local runtime serving the app
 *   built as deployed (e2e/serve.ts), for what a fake can't show: several people on one board over WebSockets, the
 *   moderation page against the real admin API, the service worker offline and its notifications.
 *
 * Playwright's Chromium comes from `npx playwright install chromium`, or CHROMIUM_PATH points to another one (the
 * worker suite only).
 */

const executablePath = process.env.CHROMIUM_PATH;
const WORKER = `http://localhost:${E2E_PORT}/`;

/** What the worker suite shares: its own folder, retries in CI, a longer wait. */
const worker = {
  testDir: 'e2e',
  // Boards are created per test, so files may run side by side; a file's tests run in order.
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  expect: { timeout: 8_000 },
};
const workerUse = {
  baseURL: WORKER,
  locale: 'en-US',
  colorScheme: 'light' as const,
  reducedMotion: 'reduce' as const,
  // The full Chromium in its new headless mode, not the headless shell: the shell shows no notifications.
  ...(executablePath ? { launchOptions: { executablePath } } : { channel: 'chromium' }),
};

export default defineConfig({
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:5179/', trace: 'retain-on-failure', locale: 'en-GB' },
  projects: [
    { name: 'desktop', testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', testDir: 'tests/e2e', use: { ...devices['Pixel 7'] } },
    {
      name: 'worker-desktop',
      ...worker,
      testIgnore: /phone\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...workerUse },
    },
    {
      name: 'worker-phone',
      ...worker,
      testMatch: /phone\.spec\.ts/,
      use: { ...devices['Pixel 7'], ...workerUse },
    },
  ],
  webServer: [
    {
      command: 'npx vite --port 5179 --strictPort',
      url: 'http://localhost:5179/app/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts',
      url: `${WORKER}api/config`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
