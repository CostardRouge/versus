# CLAUDE.md

Project memory for Claude Code. Read this first, then `docs/` for the full history.

## What Versus is

A web app to **rank anything by comparing two items at a time** (pairwise comparison). Users create rankings, add items (text, images, colors), then play duels A vs B (buttons, keyboard or swipe). A scoring method turns the duels into a ranking.

- Owner: Steeve Pommier (GitHub `CostardRouge`). He usually writes in **French**: answer in French unless asked otherwise. He prefers concise answers and doesn't want implementation walkthroughs before they're needed.
- Live: https://costardrouge.github.io/versus/ (GitHub Pages, deployed by CI from `main`).
- Status: local-first; the live app is client-only and stores everything in `localStorage`. Published boards (share a ranking, a crowd votes in real time) are built end to end: backend in `worker/` (Cloudflare Worker + Durable Objects + D1 registry), UI in `src/app/board.ts` and `publish.ts`. The Worker also serves the app. Not deployed yet: CI deploys it once the repository has the Cloudflare token and account ID (steps in `docs/online-architecture.md#deploying`); the GitHub Pages build hides publishing (no `VITE_API_URL`).
- The project was named "Elo Rank" (heard as "Hello Rank") during prototyping, then renamed **Versus**. Don't reintroduce "Elo" in the product name or UI chrome; "Elo" only names one scoring method.

## Commands

```bash
npm install
npm run dev          # Vite dev server
npm run check        # lint + typecheck + tests + build (what CI runs); run before every commit
npm run coverage     # tests with coverage (src/core must stay ≥ 90% lines/functions/statements, ≥ 75% branches)
npm run format       # Biome auto-fix
npm run icons        # redraw the icons and the social card into public/ (commit the files)
npm run worker:dev   # the whole app + API on :8787 (worker build mode, local D1 migrated); npm run dev proxies /api to it
npm run worker:deploy  # build, deploy the Worker, apply D1 migrations (needs a Cloudflare login)
```

Node 22 (`.nvmrc`). Stack: Vite 8, TypeScript 7 (strict, `noUncheckedIndexedAccess`), Biome 2 (lint + format), Vitest 5 (+ jsdom for the app smoke test), Wrangler 4 for the Worker, fonts self-hosted with Fontsource, satori + resvg for the icons script. No UI framework, on purpose.

## Code map

```
index.html            static shell (header, overlays, modal) + inline script applying the saved theme before first paint;
                      <!-- seo:head --> and <!-- seo:noscript --> are filled at build time
build/                build-time only (never shipped): site.ts = every sitewide SEO fact (name, title, description, colors,
                      icons, social card, author); seo.ts = head tags, JSON-LD, manifest, robots, sitemap, llms.txt, _headers;
                      seo-plugin.ts = the Vite plugin wiring them in
scripts/icons.ts      draws public/ icons (ico, svg, 96/192/512, maskable, apple-touch) and og.png from build/site.ts
public/               icons and the social card (generated, committed); favicon.svg is a legacy address
src/main.ts           imports the fonts and styles, calls mount(document)
src/styles.css        all styles; design tokens on :root, dark palette via prefers-color-scheme and [data-theme]
src/core/             pure logic, no DOM: must stay framework-free and fully unit tested
  types.ts            Ranking, Item, Fill, Duel, Computed…
  scoring.ts          compute() for the 4 methods, pair selection, stability, undo
  colors.ts           hex/HSL, luminance, fillCSS (gradient rendering), harmonies
  demos.ts            demo data (EN/FR labels) + deterministic simulation (seeded PRNG)
  board.ts            published boards: publish validation, one voice per pair, visibility, pair assignment, sessions
  protocol.ts         HTTP/WebSocket messages and views shared by the app and the Worker
  published.ts        client helpers: what can be published, publish request, links, agreement, neck and neck
  model.ts, util.ts   constructors, ids, escaping, small helpers
src/i18n/             en.ts is the source of keys; fr.ts is typed as Messages so missing keys fail typecheck
src/app/              UI: renders HTML strings, one delegated listener per event type (data-action attributes)
  ui.ts               mount(): loads data, adds demos, binds events, first render
  state.ts, dom.ts    app state (rankings, prefs, route, save) / document, media queries, $, toast, modal, icons
  rankings.ts         render() (gallery or workspace) and ranking-level actions (new, open, reset, duplicate, delete, language)
  gallery.ts          gallery cards
  workspace.ts        workspace shell, tabs, method menu, renderMain() (duel or results)
  items.ts            side list (live-sorted, FLIP) and item edits (add text/colors/images, rename, remove)
  duel.ts             duel stage: cards, swipe, picks, skip, undo, keyboard shortcuts
  results.ts          podium or lines comparing two methods (switch), table, method comparison, copy
  ending.ts           end of a local ranking: announcement with confetti and a countdown to the Ranking tab
  slope.ts            lines between two rankings (end-of-vote page, method comparison): drawing and hover
  color.ts            color editor popover
  publish.ts          publish modal and the settings form shared with the author panel
  board.ts            published board page: server-assigned duels, crowd ranking (live or frozen), author panel
  finale.ts           end-of-vote page (all pairs voted): podium or you vs the crowd, toggle, reveal animation
  remote.ts           API calls and the board WebSocket (hello, reconnect, gone)
  events.ts           delegated listeners (click, input, change, keydown, paste, drag and drop)
  header.ts, format.ts  static header texts and theme / score, record and date formatting
  storage.ts          guarded localStorage access, prefs, migration from prototype keys
worker/               Cloudflare Worker: index.ts (router, admin, limits), board-object.ts (one Durable Object per board: SQLite, WebSockets, TTL alarm),
                      registry.ts + migrations/ (D1 registry), turnstile.ts; own tsconfig; secrets ADMIN_TOKEN, TURNSTILE_SECRET
tests/                one suite per core module + app.test.ts (jsdom smoke test) + worker.test.ts (end to end in workerd via Wrangler's test harness)
                      + seo.test.ts (head, JSON-LD, icons and generated files stay consistent)
docs/                 decisions, roadmap, published boards model, online architecture, SEO
```

## Conventions

- **All user-facing text goes through `t()`** (`src/i18n`). Add every key to both `en.ts` and `fr.ts` (typecheck enforces parity; tests check placeholders match). Plurals via `plural(n, key)`, percentages via `pct()`.
- **Business logic lives in `src/core`**, never in `src/app/` or `worker/`. It is shared with the Cloudflare Worker, so keep it free of DOM, browser and Workers APIs; `worker/` only adapts it (storage, sockets, alarms).
- **UI pattern:** view modules in `src/app/` render HTML strings; interactive elements carry `data-action` (+ `data-id`, `data-tab`…) handled by the delegated listeners in `events.ts`. Always escape user content with `esc()`. A new view gets its own module; keep `events.ts` a thin dispatcher.
- **Colors come from CSS tokens** (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--a` cobalt, `--b` coral, `--good`, `--bad`, `--on-accent`), defined for light and dark. No literal colors in components, except text over images and fills.
- **Fonts:** Bricolage Grotesque (display), Figtree (body), JetBrains Mono (numbers). Numbers use `.mono` (tabular figures).
- **Accessibility:** keyboard access for every action, `aria-label` on icon buttons, `prefers-reduced-motion` respected, visible focus.
- **Storage keys:** `versus-v1` (rankings; a published one has `pub`), `versus-prefs` (lang, theme, hideDemos, live, resultView, rankView), `versus-voter` (anonymous voter id), `versus-owners` (owner tokens by board alias). Changing the stored shape requires a migration in `storage.ts`.
- **Demos are fixed data** (`core/demos.ts`): same items and duels for everyone (seeded `mulberry32`). Don't make them random.
- **SEO lives in `build/site.ts`**, never hand-written in `index.html` or `public/`: the head, the manifest, robots.txt, the sitemap and llms.txt are generated from it; the canonical address comes from `VITE_SITE_URL` (CI variable `SITE_URL`). A redesigned icon or social card gets new file names (caches key on the URL). Details in `docs/seo.md`.
- Commit only when `npm run check` passes. CI (`.github/workflows/ci.yml`) runs Biome, tsc, coverage and build on PRs and pushes, then deploys `main` to Pages, and to Cloudflare (`npm run worker:deploy`) when the `CLOUDFLARE_ACCOUNT_ID` variable is set.

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
- `docs/published-boards.md`: agreed behavior of published (shared) boards: lifecycle, voting rules, visibility, live updates (built, not deployed).
- `docs/online-architecture.md`: backend for published boards on Cloudflare (`worker/`), how to deploy it.
- `docs/seo.md`: head tags, JSON-LD, icons, social card, manifest, robots, sitemap, llms.txt; decisions and what the owner has to do (Search Console, `SITE_URL`).
