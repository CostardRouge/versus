# CLAUDE.md

Project memory for Claude Code. Read this first, then `docs/` for the full history.

## What Versus is

A web app to **rank anything by comparing two items at a time** (pairwise comparison). Users create rankings, add items (text, images, colors), then play duels A vs B (buttons, keyboard or swipe). A scoring method turns the duels into a ranking.

- Owner: Steeve Pommier (GitHub `CostardRouge`). He usually writes in **French**: answer in French unless asked otherwise. He prefers concise answers and doesn't want implementation walkthroughs before they're needed.
- Live: https://versus.steevepommier.com/ (the Worker: home page + app + API; the canonical address) and https://costardrouge.github.io/versus/ (GitHub Pages, without publishing), both deployed by CI from `main`. The home page is at `/` (English) and `/fr/` (French), the app at `/app/` (D84 to D90).
- Status: local-first; the live app is client-only and stores everything in `localStorage`. It is an installable, offline PWA (`docs/pwa.md`); the web comes first and stays light (D75). Published boards (share a ranking, a crowd votes in real time) are built end to end: backend in `worker/` (Cloudflare Worker + Durable Objects + D1 registry), UI in `src/app/board.ts`, `publish.ts` and `joined.ts` (the boards a visitor voted on, under "Your votes"). The Worker also serves the app; CI deploys it with the repository's Cloudflare token and account ID (steps in `docs/online-architecture.md#deploying`); the GitHub Pages build hides publishing (no `VITE_API_URL`).
- The project was named "Elo Rank" (heard as "Hello Rank") during prototyping, then renamed **Versus**. Don't reintroduce "Elo" in the product name or UI chrome; "Elo" only names one scoring method.

## How this project is built

- **The owner doesn't write code.** Every line in this repo was written by Claude Code from the owner's prompts; the owner decides, reviews the result and tests it by hand. The owner has a Claude Max plan (×20), so there is plenty of capacity.
- **Estimate effort in agent time, not developer time.** A full UI rewrite or a port to another stack fits in a day of sessions. Don't argue against an option because of code volume, rewrite size or "double maintenance".
- **What really costs is what Claude can't do:** the owner's time (testing on real devices, accounts, store listings and reviews, decisions), fees, and regression risk. Weigh options on those, and on product quality.
- **No stack choice is sacred.** Past choices made to go fast in the POC can be reopened; the owner decides. D24 (no UI framework) was reopened and kept: the web app comes first and stays light (D75).

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

Node 22 (`.nvmrc`). Stack: Vite 8, TypeScript 7 (strict, `noUncheckedIndexedAccess`), Biome 2 (lint + format), Vitest 5 (+ jsdom for the app smoke test), Wrangler 4 for the Worker, fonts self-hosted with Fontsource, satori + resvg for the icons script. No UI framework: the web app stays light, with as few runtime dependencies as possible (D24, D75).

## Code map

```
index.html, fr/index.html  the home page shells (English, French): <!-- seo:head -->, <!-- landing:boot --> and
                      <!-- landing:body --> are filled at build time with the whole page (src/landing/markup.ts)
app/index.html        the app's static shell (header, overlays, modal) + inline script applying the saved theme before
                      first paint; <!-- seo:head -->, <!-- seo:noscript --> and <!-- seo:about --> are filled at build time
build/                build-time only (never shipped): site.ts = every sitewide SEO fact (pages, titles and descriptions per
                      language, colors, icons, social cards, author); seo.ts = head tags per page (hreflang), JSON-LD, manifest,
                      robots, sitemap, llms.txt, _headers; seo-plugin.ts = the Vite plugin filling each page; pwa.ts + pwa-plugin.ts = build the service worker
                      as sw.js with its precache list and content version
scripts/icons.ts      draws public/ icons (ico, svg, 96/192/512, maskable, apple-touch) and og.png / og-fr.png from build/site.ts
public/               icons and the social card (generated, committed); favicon.svg is a legacy address
src/main.ts           imports the fonts and styles, calls mount(document)
src/tokens.css        design tokens shared by the app and the home page: light on :root, dark via prefers-color-scheme and [data-theme]
src/styles.css        the app's styles (imports tokens.css)
src/sw/sw.ts          service worker (offline app shell, updates on request); own tsconfig (WebWorker types)
src/core/             pure logic, no DOM: must stay framework-free and fully unit tested
  types.ts            Ranking, Item, Fill, Duel, Computed…
  scoring.ts          compute() for the 4 methods, pair selection, stability, undo
  colors.ts           hex/HSL, luminance, fillCSS (gradient rendering), harmonies
  demos.ts            demo data (EN/FR labels) + deterministic simulation (seeded PRNG)
  board.ts            published boards: publish validation, one voice per pair, visibility, pair assignment, sessions
  protocol.ts         HTTP/WebSocket messages and views shared by the app and the Worker
  route.ts            the app's addresses (D92): demo/<slug>, r/<id>, b/<alias>, tab; parse and write, author fragment
  published.ts        client helpers: what can be published, publish request, links, agreement, neck and neck
  joined.ts           "Your votes": cards of boards voted on (snapshot, what's new since the last visit, order, copy)
  model.ts, util.ts   constructors, ids, escaping, small helpers
src/i18n/             en.ts is the source of keys; fr.ts is typed as Messages so missing keys fail typecheck;
                      landing-en.ts / landing-fr.ts: the home page's texts (same rules)
src/app/              UI: renders HTML strings, one delegated listener per event type (data-action attributes)
  ui.ts               mount(): loads data, adds demos, binds events, first render
  state.ts, dom.ts    app state (rankings, prefs, route, save) / document, media queries, $, toast, modal, icons
  rankings.ts         render() (gallery or workspace), routeFromURL() and ranking-level actions (new, open, reset, duplicate, delete, language)
  gallery.ts          gallery cards: your rankings, your votes (boards voted on), demos
  joined.ts           "Your votes": records a card at the first vote, refreshes cards from the server, forget, keep a copy
  about.ts            the page text closing the gallery (what Versus is, how it works, methods); its static English copy
                      with the page's h1 is in index.html for crawlers without JavaScript (build/seo.ts)
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
  router.ts           the address bar follows the view (push, replace), app folder from the page's <base>
  events.ts           delegated listeners (click, input, change, keydown, paste, drag and drop)
  pwa.ts              registers the service worker (production only), update bar, install button, persistent storage
  header.ts, format.ts  static header texts and theme / score, record and date formatting
  storage.ts          guarded localStorage access, prefs, migration from prototype keys
src/landing/          the home page: markup.ts renders it at build time (pure strings, like frame.ts: the demo frames'
                      HTML, shared with the script), data.ts (its items, EN/FR), sprite.ts (pastry drawings), strings.ts
                      (texts at build time), crowd.ts (simulated votes); main.ts + mount.ts bring it to life: board.ts (a
                      demo frame over src/core), demo.ts (the hero's scripted demo), cursor.ts, motion.ts (on-screen loops,
                      pause), sections.ts (title word, vignettes, try it, methods, crowd, languages), landing.css
worker/               Cloudflare Worker: index.ts (router, admin, limits), board-object.ts (one Durable Object per board: SQLite, WebSockets, TTL alarm),
                      registry.ts + migrations/ (D1 registry), turnstile.ts; own tsconfig; secrets ADMIN_TOKEN, TURNSTILE_SECRET
tests/                one suite per core module + app.test.ts (jsdom smoke test) + board-ui.test.ts and votes-ui.test.ts (published boards and
                      "Your votes" against a fake API) + worker.test.ts (end to end in workerd via Wrangler's test harness)
                      + seo.test.ts (heads per page, hreflang, JSON-LD, icons and generated files stay consistent) + pwa.test.ts (precache
                      list, version) + landing.test.ts (home page markup and texts) + landing-ui.test.ts (jsdom smoke test)
docs/                 decisions, roadmap, published boards model, online architecture, SEO, PWA
```

## Conventions

- **All user-facing text goes through `t()`** (`src/i18n`). Add every key to both `en.ts` and `fr.ts` (typecheck enforces parity; tests check placeholders match). Plurals via `plural(n, key)`, percentages via `pct()`. The home page's texts go in `landing-en.ts` and `landing-fr.ts` (same rules); it renders at build time, so its script gets texts as JSON and never imports a dictionary.
- **Business logic lives in `src/core`**, never in `src/app/` or `worker/`. It is shared with the Cloudflare Worker, so keep it free of DOM, browser and Workers APIs; `worker/` only adapts it (storage, sockets, alarms).
- **Addresses:** every view has a path under `app/` (D92, `core/route.ts`): open views through `open()` / `openBoard()` / `goBack()` / `setTab()`, which keep the address bar in step, never with `history` directly. Links the app builds come from `routeURL()`; an author's token only ever goes in the fragment.
- **UI pattern:** view modules in `src/app/` render HTML strings; interactive elements carry `data-action` (+ `data-id`, `data-tab`…) handled by the delegated listeners in `events.ts`. Always escape user content with `esc()`. A new view gets its own module; keep `events.ts` a thin dispatcher.
- **Colors come from CSS tokens** (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--a` cobalt, `--b` coral, `--good`, `--bad`, `--on-accent`), defined for light and dark. No literal colors in components, except text over images and fills.
- **Fonts:** Bricolage Grotesque (display), Figtree (body), JetBrains Mono (numbers). Numbers use `.mono` (tabular figures).
- **Accessibility:** keyboard access for every action, `aria-label` on icon buttons, `prefers-reduced-motion` respected, visible focus.
- **Storage keys:** `versus-v1` (rankings; a published one has `pub`), `versus-prefs` (lang, theme, hideDemos, live, resultView, rankView, joinedHint; the home page reads theme and lang and writes lang), `versus-voter` (anonymous voter id), `versus-owners` (owner tokens by board alias), `versus-joined` (cards of boards voted on, "Your votes"); `sessionStorage` `versus-lang-hint` (the home page's language suggestion dismissed) and `versus-path` (a deep app path handed over by GitHub Pages' 404 page). Changing the stored shape requires a migration in `storage.ts`.
- **Demos are fixed data** (`core/demos.ts`): same items and duels for everyone (seeded `mulberry32`). Don't make them random.
- **SEO lives in `build/site.ts`**, never hand-written in the HTML shells or `public/`: each page's head, the manifest, robots.txt, the sitemap and llms.txt are generated from it; the canonical address is https://versus.steevepommier.com/ unless `VITE_SITE_URL` (CI variable `SITE_URL`) says otherwise. The home pages (`/`, `/fr/`) are the indexed ones, linked by hreflang, with every word in their static HTML and one h1; the app (`/app/`) is `noindex` and keeps its own static text (`src/app/about.ts`). Links between pages are relative (the site also lives under github.io/versus/). A redesigned icon or social card gets new file names (caches key on the URL). Modules the Vite config reaches import with their `.ts` extension (D90). Details in `docs/seo.md`.
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
