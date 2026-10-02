import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './e2e/env.ts';

/**
 * End-to-end tests (`npm run e2e`): real browsers against the real Worker in Wrangler's local runtime, serving the
 * app built as it is deployed (e2e/serve.ts). They cover what the jsdom tests can't: layout, pointer gestures,
 * files dropped, the service worker, and several people on one published board.
 *
 * Playwright's Chromium comes from `npx playwright install chromium`, or CHROMIUM_PATH points to another one.
 */

const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  // One server for everything; boards are created per test, so files may run side by side.
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${E2E_PORT}/`,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    // The full Chromium in its new headless mode, not the headless shell: the shell shows no notifications.
    ...(executablePath ? { launchOptions: { executablePath } } : { channel: 'chromium' }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
  webServer: {
    command: 'node e2e/serve.ts',
    url: `http://localhost:${E2E_PORT}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
