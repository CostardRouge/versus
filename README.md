# Versus

Rank anything by comparing two items at a time. Add text, images or colors, pick your favorite in each duel (buttons, keyboard or swipe), and let the ranking emerge.

**Live:** https://costardrouge.github.io/versus/

## Features

- **Duels** with buttons, arrow keys (`←` A, `→` B, `↓` tie, `S` skip, `⌘/Ctrl+Z` undo) or swipe.
- **Items of any kind:** text, images (drag and drop or paste, downscaled in the browser), solid colors and gradients with an inline color editor.
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
- **Light and dark themes** that follow the system setting or can be pinned from the header; the choice is applied before the first paint.
- Data stays in the browser (`localStorage`); nothing is sent anywhere.

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
| `npm run worker:dev` | Published boards API on http://localhost:8787 (Vite proxies `/api` to it) |
| `npm run worker:deploy` | Deploy the API to Cloudflare (needs a Cloudflare account) |

## Project structure

```
src/
  core/        pure, framework-free logic (fully unit tested)
    scoring.ts   Bradley-Terry, Elo, win rate, exact sort, pair selection
    colors.ts    hex/HSL conversions, gradients, harmonies
    demos.ts     demo data and deterministic simulation
    board.ts     published boards: votes, visibility, pair assignment
    protocol.ts  messages and views shared by the app and the Worker
  i18n/        en.ts (source of keys), fr.ts (type-checked against en), helpers
  app/
    ui.ts        mount(): the entry point
    gallery.ts, workspace.ts, items.ts, duel.ts, results.ts, color.ts   one module per view
    rankings.ts  navigation and actions on whole rankings
    events.ts    delegated event listeners
    state.ts, dom.ts, header.ts, format.ts, storage.ts   shared state, DOM helpers, header, formatting, localStorage
  styles.css
worker/        Cloudflare Worker + one Durable Object per published board (prototype)
tests/         Vitest suites, a jsdom smoke test of the app, and end-to-end Worker tests in workerd
```

## Published boards (prototype)

`worker/` holds the API for shared boards: a Worker routes requests, and each published board is a Durable Object with its own SQLite storage and WebSockets. The rules live in `src/core/board.ts`, shared with the app. It runs locally (`npm run worker:dev`) and in the tests; it isn't deployed or wired to the UI yet. See [`docs/online-architecture.md`](docs/online-architecture.md).

## CI and deployment

`.github/workflows/ci.yml` runs on every pull request and push to `main`: Biome, TypeScript, Vitest with coverage, and a production build. On `main`, the build is then deployed to GitHub Pages. Dependabot keeps npm packages and actions up to date.

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
