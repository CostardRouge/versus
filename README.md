# Versus

Rank anything by comparing two items at a time. Add text, images or colors, pick your favorite in each duel (buttons, keyboard or swipe), and let the ranking emerge.

**Live:** https://versus.steevepommier.com/ ([en français](https://versus.steevepommier.com/fr/); the app itself is at [/app/](https://versus.steevepommier.com/app/)), also on https://costardrouge.github.io/versus/, without publishing

## Features

- **Duels** with buttons, arrow keys (`←` A, `→` B, `↓` tie, `S` skip, `⌘/Ctrl+Z` undo) or swipe.
- **Items of any kind:** text, images (drag and drop or paste, downscaled in the browser), solid colors and gradients with an inline color editor. Paste a whole list (plain lines, Markdown, a spreadsheet row) to add it at once.
- **Four scoring methods**, switchable at any time without losing duels:
  | Method | Algorithm | Best for |
  | --- | --- | --- |
  | Balanced (default) | Bradley-Terry, fitted on all duels at once, with a ± margin per item | Photos, products, anything that doesn't change |
  | Dynamic | Elo, duel by duel | Preferences that evolve over time |
  | Simple | Smoothed win rate | Readability |
  | Exact sort | Binary insertion sort | Settling a short list in the fewest duels |
- **Method comparison** on the results page, to see where the ranking is still fragile.
- **Demos** built from fixed data (same items and duels for everyone), resettable and translatable.
- **English and French**, detected from the browser and switchable.
- **A home page in English and French** with live demos: a virtual pointer plays the app, six topics to try, the four methods on the same duels.
- **Search and share ready:** a head per page with hreflang, Open Graph cards in both languages, structured data, favicons for every platform, a bilingual sitemap and `llms.txt`, all generated from one file (see [`docs/seo.md`](docs/seo.md)).
- **Light and dark themes** that follow the system setting or can be pinned from the header; the choice is applied before the first paint.
- **Installable and offline:** a service worker keeps the app on the device, so it opens without a network; new versions are offered, never forced (see [`docs/pwa.md`](docs/pwa.md)).
- Rankings stay in the browser (`localStorage`); only what you publish is sent. Visits are counted with a self-hosted, cookie-free Umami, never loaded for visitors who decline (a switch on the [legal notice](https://versus.steevepommier.com/legal/), Do Not Track, Global Privacy Control), and never with a ranking's content or id (see [`docs/analytics.md`](docs/analytics.md)).
- **Published boards**: publish a ranking, share the link, and let a crowd vote in real time (on versus.steevepommier.com; the GitHub Pages copy has no backend). See [`docs/published-boards.md`](docs/published-boards.md).
- **Share as an image**: your ranking, the crowd's, you against the crowd, or a single duel, drawn in the browser in post, story or landscape format and handed to the system share sheet, the clipboard or a download. A board's link unfurls with its own card, a duel link with its two items.
- **Moderation**: visitors report a board (anonymously, with a reason); the publisher's page at `/admin/` lists boards with their reports, hides or features them, removes items and takes boards down (see [`docs/published-boards.md#moderation`](docs/published-boards.md#moderation)).

## Development

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev        # local server with hot reload
npm run check      # lint, typecheck, tests, build: what CI runs
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` / `npm run test:watch` | Unit tests (Vitest) |
| `npm run coverage` | Tests with coverage; the scoring engine must stay above 90% |
| `npm run lint` / `npm run format` | Biome lint and format check / auto-fix |
| `npm run typecheck` | TypeScript in strict mode (app and Worker) |
| `npm run worker:dev` | The whole app and the published boards API on http://localhost:8787 (`npm run dev` proxies `/api` to it) |
| `npm run worker:deploy` | Build, deploy to Cloudflare and apply the D1 migrations (needs a Cloudflare account) |
| `npm run icons` | Redraw the favicons, app icons and social card into `public/` from `build/site.ts` |

## Project structure

```
src/
  core/        pure, framework-free logic (fully unit tested)
    scoring.ts   Bradley-Terry, Elo, win rate, exact sort, pair selection
    colors.ts    hex/HSL conversions, gradients, harmonies
    demos.ts     demo data and deterministic simulation
    board.ts     published boards: votes, visibility, pair assignment
    protocol.ts  messages and views shared by the app and the Worker
  i18n/        en.ts (source of keys), fr.ts (type-checked against en), helpers; landing-*.ts for the home page
  landing/     the home page, rendered at build time in each language, then animated
  admin/       the publisher's moderation page (/admin/), client of the Worker's admin routes
  app/
    ui.ts        mount(): the entry point
    gallery.ts, workspace.ts, items.ts, duel.ts, results.ts, color.ts   one module per view
    publish.ts, board.ts, remote.ts   publishing, the published board page, the API client
    rankings.ts  navigation and actions on whole rankings
    events.ts    delegated event listeners
    state.ts, dom.ts, header.ts, format.ts, storage.ts   shared state, DOM helpers, header, formatting, localStorage
  styles.css
build/         build-time SEO: site facts, head tags, JSON-LD, manifest, robots, sitemap, llms.txt (docs/seo.md)
scripts/       icons.ts: icons and social card
worker/        Cloudflare Worker + one Durable Object per published board (prototype)
tests/         Vitest suites, a jsdom smoke test of the app, and end-to-end Worker tests in workerd
```

## Published boards

`worker/` serves the app and the API for shared boards: each published board is a Durable Object with its own SQLite storage and WebSockets, a D1 registry backs the admin API, and per-IP limits and Turnstile guard publishing. The rules live in `src/core/board.ts`, shared with the app. It runs locally (`npm run worker:dev`) and in the tests; deploying needs a Cloudflare account, see [`docs/online-architecture.md`](docs/online-architecture.md#deploying).

## CI and deployment

`.github/workflows/ci.yml` runs on every pull request and push to `main`: Biome, TypeScript, Vitest with coverage, and a production build. On `main`, the build is then deployed to GitHub Pages, and the Worker (app + API) to Cloudflare once the repository has the `CLOUDFLARE_ACCOUNT_ID` variable and the `CLOUDFLARE_API_TOKEN` secret ([setup](docs/online-architecture.md#deploying)). Dependabot keeps npm packages and actions up to date.

The Pages source must be set once to **GitHub Actions** in *Settings → Pages*.

## Project notes

- [`CLAUDE.md`](CLAUDE.md): working memory for Claude Code (conventions, code map, domain rules).
- [`docs/decisions.md`](docs/decisions.md): decision log.
- [`docs/roadmap.md`](docs/roadmap.md): done, next, later, open questions.
- [`docs/published-boards.md`](docs/published-boards.md): agreed behavior of published (shared) boards.
- [`docs/online-architecture.md`](docs/online-architecture.md): backend for published boards on Cloudflare (prototype in `worker/`).

## Adding a language

1. Copy `src/i18n/fr.ts` to a new file and translate the values; TypeScript flags any missing key.
2. Register it in `src/i18n/index.ts` (`LANGS`, `MESSAGES`, `PLURALS`) and add a button in `index.html`.
3. Add the language to the labels in `src/core/demos.ts`.

## License

[MIT](LICENSE) © 2026 Steeve Pommier
