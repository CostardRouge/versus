# CLAUDE.md

Project memory for Claude Code. Read this first, then `docs/` for the full history.

## What Versus is

A web app to **rank anything by comparing two items at a time** (pairwise comparison). Users create rankings, add items (text, images, colors), then play duels A vs B (buttons, keyboard or swipe). A scoring method turns the duels into a ranking.

- Owner: Steeve Pommier (GitHub `CostardRouge`). He usually writes in **French**: answer in French unless asked otherwise. He prefers concise answers and doesn't want implementation walkthroughs before they're needed.
- Live: https://costardrouge.github.io/versus/ (GitHub Pages, deployed by CI from `main`).
- Status: local-first; the live app is client-only and stores everything in `localStorage`. A backend prototype for published boards lives in `worker/` (Cloudflare Worker + Durable Objects): it runs locally and in tests, but isn't deployed or wired to the UI yet (see `docs/online-architecture.md`).
- The project was named "Elo Rank" (heard as "Hello Rank") during prototyping, then renamed **Versus**. Don't reintroduce "Elo" in the product name or UI chrome; "Elo" only names one scoring method.

## Commands

```bash
npm install
npm run dev          # Vite dev server
npm run check        # lint + typecheck + tests + build (what CI runs); run before every commit
npm run coverage     # tests with coverage (src/core must stay ≥ 90% lines/functions/statements, ≥ 75% branches)
npm run format       # Biome auto-fix
npm run worker:dev   # published boards API on :8787 (Vite proxies /api to it)
```

Node 22 (`.nvmrc`). Stack: Vite 8, TypeScript 7 (strict, `noUncheckedIndexedAccess`), Biome 2 (lint + format), Vitest 5 (+ jsdom for the app smoke test), Wrangler 4 for the Worker. No UI framework, on purpose.

## Code map

```
index.html            static shell (header, overlays, modal) + inline script applying the saved theme before first paint
src/main.ts           imports styles, calls mount(document)
src/styles.css        all styles; design tokens on :root, dark palette via prefers-color-scheme and [data-theme]
src/core/             pure logic, no DOM: must stay framework-free and fully unit tested
  types.ts            Ranking, Item, Fill, Duel, Computed…
  scoring.ts          compute() for the 4 methods, pair selection, stability, undo
  colors.ts           hex/HSL, luminance, fillCSS (gradient rendering), harmonies
  demos.ts            demo data (EN/FR labels) + deterministic simulation (seeded PRNG)
  board.ts            published boards: publish validation, one voice per pair, visibility, pair assignment, sessions
  protocol.ts         HTTP/WebSocket messages and views shared by the app and the Worker
  model.ts, util.ts   constructors, ids, escaping, small helpers
src/i18n/             en.ts is the source of keys; fr.ts is typed as Messages so missing keys fail typecheck
src/app/storage.ts    guarded localStorage access, prefs, migration from prototype keys
src/app/ui.ts         rendering (HTML strings) + event delegation (data-action attributes)
worker/               Cloudflare Worker (router) + BoardObject (one Durable Object per published board: SQLite, WebSockets, TTL alarm); own tsconfig
tests/                one suite per core module + app.test.ts (jsdom smoke test) + worker.test.ts (end to end in workerd via Wrangler's test harness)
docs/                 decisions, roadmap, published boards model, online architecture
```

## Conventions

- **All user-facing text goes through `t()`** (`src/i18n`). Add every key to both `en.ts` and `fr.ts` (typecheck enforces parity; tests check placeholders match). Plurals via `plural(n, key)`, percentages via `pct()`.
- **Business logic lives in `src/core`**, never in `ui.ts` or `worker/`. It is shared with the Cloudflare Worker, so keep it free of DOM, browser and Workers APIs; `worker/` only adapts it (storage, sockets, alarms).
- **UI pattern:** `ui.ts` renders HTML strings; interactive elements carry `data-action` (+ `data-id`, `data-tab`…) handled by one delegated click handler. Always escape user content with `esc()`.
- **Colors come from CSS tokens** (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--a` cobalt, `--b` coral, `--good`, `--bad`, `--on-accent`), defined for light and dark. No literal colors in components, except text over images and fills.
- **Fonts:** Bricolage Grotesque (display), Figtree (body), JetBrains Mono (numbers). Numbers use `.mono` (tabular figures).
- **Accessibility:** keyboard access for every action, `aria-label` on icon buttons, `prefers-reduced-motion` respected, visible focus.
- **Storage keys:** `versus-v1` (rankings), `versus-prefs` (lang, theme, hideDemos). Changing the stored shape requires a migration in `storage.ts`.
- **Demos are fixed data** (`core/demos.ts`): same items and duels for everyone (seeded `mulberry32`). Don't make them random.
- Commit only when `npm run check` passes. CI (`.github/workflows/ci.yml`) runs Biome, tsc, coverage and build on PRs and pushes, then deploys `main` to Pages.

## Key domain rules

- Scoring methods (per ranking, switchable at any time; everything is recomputed from the same duel history):
  - `bt` **Balanced** (default): Bradley-Terry fitted by MM iterations, with a virtual tie against a fixed 1500 anchor to keep scores finite; shows a ± standard error per item. Order-independent.
  - `elo` **Dynamic**: Elo, K=40 for an item's first 6 duels, then 24. Order-dependent by design.
  - `win` **Simple**: smoothed win rate `(w + d/2 + 1) / (games + 2)`.
  - `sort` **Exact sort**: binary insertion sort replayed from recorded duels; no ties, no skips; finishes in ≤ Σ ceil(log2(k+1)) duels.
- Stability for rating methods = duels / `max(n, round(n·log2(n)·1.2))`; for exact sort = placed items.
- Pair selection favors items with few duels, close positions and unseen pairs, and avoids the previous duel's items.
- Items: text, image (downscaled to 640 px JPEG 0.82 data URL), or fill (`solid` | `gradient`, 2–3 hex stops). Typing or pasting `#hex` creates a color item. A color item whose label equals its code follows the color when edited.

## Where to look next

- `docs/decisions.md`: what was decided and why (design, naming, scoring, tooling).
- `docs/roadmap.md`: done, next, later, open questions.
- `docs/published-boards.md`: agreed behavior of published (shared) boards: lifecycle, voting rules, visibility, live updates (server side prototyped, not in the app yet).
- `docs/online-architecture.md`: backend for published boards on Cloudflare; prototype in `worker/`, not deployed.
