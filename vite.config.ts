import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { pwa } from './build/pwa-plugin.ts';
import { seo } from './build/seo-plugin.ts';
import { PAGES } from './build/site.ts';

export default defineConfig({
  // Relative asset paths so the build works at https://<user>.github.io/<repo>/ without hard-coding the repo name.
  base: './',
  // Head tags, static page text, <noscript>, manifest, robots.txt, sitemap and llms.txt from build/site.ts; canonical URL from VITE_SITE_URL.
  // Service worker (offline, updates): src/sw/sw.ts built as sw.js with its precache list, see build/pwa-plugin.ts.
  plugins: [seo(), pwa()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // The home page in each language (index.html, fr/index.html) and the app (app/index.html): build/site.ts.
    rolldownOptions: {
      input: Object.fromEntries(
        Object.entries(PAGES).map(([key, page]) => [key, fileURLToPath(new URL(page.file, import.meta.url))]),
      ),
    },
  },
  // Published boards API: `npm run worker:dev` serves it on 8787; same origin as the app in dev.
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      // The scoring engine is the heart of the app: keep it well covered.
      thresholds: {
        'src/core/**': { lines: 90, functions: 90, statements: 90, branches: 75 },
      },
    },
  },
});
