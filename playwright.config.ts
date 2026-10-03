import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests in a real browser (tests/e2e): what jsdom can't show (layout, pointer gestures, focus, the
 * canvas, axe's color contrast). The app runs on Vite's dev server; the published boards API and its WebSocket are
 * faked per test (page.route, page.routeWebSocket), so no Worker is needed.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5179/', trace: 'retain-on-failure', locale: 'en-GB' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179/app/',
    reuseExistingServer: !process.env.CI,
  },
});
