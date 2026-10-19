# CLAUDE.md

Instructions for LLM agents (Claude Code, Codex, Cursor, etc.). Agents read this file at the start of every session; these rules override the agent's default behaviour and apply for the whole session, not only the first turn. Read it first, then `MEMORY.md` (imported below) and `docs/` for the full history.

## What Versus is

A web app to **rank anything by comparing two items at a time** (pairwise comparison). Users create rankings, add items (text, images, colors), then play duels A vs B (buttons, keyboard or swipe). A scoring method turns the duels into a ranking.

- Owner: Steeve Pommier (GitHub `CostardRouge`). He usually writes in **French**: answer in French unless asked otherwise. He prefers concise answers and doesn't want implementation walkthroughs before they're needed.
- Live: https://versus.steevepommier.com/ (the Worker: home page + app + API; the canonical address) and https://costardrouge.github.io/versus/ (GitHub Pages, without publishing), both deployed by CI from `main`. The home page is at `/` (English) and `/fr/` (French), the app at `/app/` (D84 to D90), the legal notice at `/legal/` and `/fr/mentions-legales/` (D96). Visits are counted with the author's self-hosted Umami, cookie-free, declinable (D93 to D95, `docs/analytics.md`).
- Status: local-first; the live app is client-only and stores everything in `localStorage`. It is an installable, offline PWA (`docs/pwa.md`); the web comes first and stays light (D75). Published boards (share a ranking, a crowd votes in real time) are built end to end: backend in `worker/` (Cloudflare Worker + Durable Objects + D1 registry), UI in `src/app/board.ts`, `publish.ts` and `joined.ts` (the boards a visitor voted on, under "Your votes"). The Worker also serves the app; CI deploys it with the repository's Cloudflare token and account ID (steps in `docs/online-architecture.md#deploying`); the GitHub Pages build hides publishing (no `VITE_API_URL`).
- The project was named "Elo Rank" (heard as "Hello Rank") during prototyping, then renamed **Versus**. Don't reintroduce "Elo" in the product name or UI chrome; "Elo" only names one scoring method.

## How this project is built

- **The owner doesn't write code.** Every line in this repo was written by Claude Code from the owner's prompts; the owner decides, reviews the result and tests it by hand. The owner has a Claude Max plan (×20), so there is plenty of capacity.
- **Estimate effort in agent time, not developer time.** A full UI rewrite or a port to another stack fits in a day of sessions. Don't argue against an option because of code volume, rewrite size or "double maintenance".
- **What really costs is what Claude can't do:** the owner's time (testing on real devices, accounts, store listings and reviews, decisions), fees, and regression risk. Weigh options on those, and on product quality.
- **No stack choice is sacred.** Past choices made to go fast in the POC can be reopened; the owner decides. D24 (no UI framework) was reopened and kept: the web app comes first and stays light (D75).
- **Several agent sessions may run in parallel** on this repo. Git history must stay readable: one commit = one task, staged file by file (rule 1).
- **Local sessions: never `git push`** — the owner tests locally and pushes himself. **Cloud / web sessions (ephemeral container): push the working branch and open a pull request**, it is the only way the code gets out. Never push to `main` either way.

## Commands

```bash
npm install
npm run dev          # Vite dev server
npm run check        # lint + typecheck + tests + build (what CI runs); run before every commit
node .github/release.mjs check  # CHANGELOG.md against package.json's version (CI runs it on every PR)
npm run e2e          # end-to-end tests in Chromium (Playwright): tests/e2e with the API faked per test, e2e/ against the real Worker run locally
npm run coverage     # tests with coverage (src/core must stay ≥ 90% lines/functions/statements, ≥ 75% branches)
npm run format       # Biome auto-fix
npm run icons        # redraw the icons and the social card into public/ (commit the files)
npm run screenshots  # take the install dialog's screenshots of the app into public/ (Playwright; commit the files)
npm run vapid        # print a key pair for notifications (Worker secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); writes nothing
npm run worker:dev   # the whole app + API on :8787 (worker build mode, local D1 migrated); npm run dev proxies /api to it
npm run worker:deploy  # build, deploy the Worker, apply D1 migrations (needs a Cloudflare login)
```

Node 24 (`.nvmrc`; `engines` keeps the floor at 22). Stack: Vite 8, TypeScript 7 (strict, `noUncheckedIndexedAccess`), Biome 2 (lint + format), Vitest 5 (+ jsdom for the app smoke test), Wrangler 4 for the Worker, fonts self-hosted with Fontsource, satori + resvg for the icons script, Playwright (`@playwright/test`) for the end-to-end tests and the screenshots script (dev only). No UI framework: the web app stays light, with as few runtime dependencies as possible (D24, D75).

## Code map

```
index.html, fr/index.html  the home page shells (English, French): <!-- seo:head -->, <!-- landing:boot --> and
                      <!-- landing:body --> are filled at build time with the whole page (src/landing/markup.ts)
legal/index.html, fr/mentions-legales/index.html  the legal notice shells, same placeholders (src/legal/markup.ts)
app/index.html        the app's static shell (header, overlays, modal) + inline script applying the saved theme before
                      first paint; <!-- seo:head -->, <!-- seo:noscript --> and <!-- seo:about --> are filled at build time
admin/index.html      the moderation page's shell (src/admin/); head and theme script filled at build time, noindex
build/                build-time only (never shipped): site.ts = every sitewide SEO fact (pages, titles and descriptions per
                      language, colors, icons, social cards, author); seo.ts = head tags per page (hreflang), JSON-LD, manifest,
                      robots, sitemap, llms.txt, _headers; seo-plugin.ts = the Vite plugin filling each page; pwa.ts + pwa-plugin.ts = build the service worker
                      as sw.js with its precache list and content version; analytics.ts = the Umami settings written into each page's head
scripts/icons.ts      draws public/ icons (ico, svg, favicons 16/32, 96/192/512, maskable 192/512, apple-touch without alpha, the icon shortcuts',
                      the notifications' badge) and og.png / og-fr.png from build/site.ts: the portfolio's icon set (COMMON-PROJECT-SPEC C11)
scripts/vapid.ts      makes the notifications' VAPID key pair for the owner to set as Worker secrets (never committed)
scripts/screenshots.ts  takes the manifest's screenshots (SCREENSHOTS in build/site.ts) of the real app on the demos: Vite's dev server,
                      Playwright's Chromium, Math.random seeded so the duels are the same every run (D130)
public/               icons and the social card (generated, committed); favicon.svg is a legacy address
src/main.ts           imports the fonts and styles, starts audience measurement, calls mount(document)
src/audience.ts       audience measurement in the browser (docs/analytics.md): loads Umami only for visitors who don't decline
                      (switch, Do Not Track, GPC), sends views and anonymous events with clean paths; shared by every page
                      (never name a module "analytics": shared chunks take its name and filter lists block it)
src/prefs.ts          the preferences every page shares (`versus-prefs`): PREFS_KEY, readPrefs, rememberLang
src/tokens.css        design tokens shared by the app and the home page: light on :root, dark via prefers-color-scheme and [data-theme]
src/styles.css        the app's styles (imports tokens.css and stage.css)
src/stage.css         the duel stage's rules and keyframes the app and the home page share (cards, side tags, entrances)
src/sw/sw.ts          service worker (offline app shell, updates on request, share target inbox, shows notifications and opens their
                      board on a tap); own tsconfig (WebWorker types), imports nothing
src/core/             pure logic, no DOM: must stay framework-free and fully unit tested
  types.ts            Ranking, Item, Fill, Duel, Computed…
  scoring.ts          compute() for the 4 methods, pair selection, stability, undo
  colors.ts           hex/HSL, luminance, fillCSS (gradient rendering), harmonies
  demos.ts            demo data (EN/FR labels) + deterministic simulation (seeded PRNG)
  board.ts            published boards: publish validation, one voice per pair, visibility, pair assignment, sessions,
                      moderation (reports, hidden and featured flags), the site's own boards (official templates)
  protocol.ts         HTTP/WebSocket messages and views shared by the app and the Worker, the admin list and view, Popular
  templates.ts        the official templates (D110): fixed EN/FR lists, their slugs and pages, what the Worker publishes
  route.ts            the app's addresses (D92): demo/<slug>, r/<id>, b/<alias>, tab; parse and write, author fragment;
                      trackedPath() = the address audience measurement records (ids and aliases replaced); parseShortcut()
                      and lastRanking() for the icon shortcuts (?shortcut=new|last, D129)
  published.ts        client helpers: what can be published, publish request, links, agreement, neck and neck
  share.ts            sharing as an image: card formats and specs (ranking, crowd, duo, compare, duel), duel links (?duel=a.b),
                      the keys, addresses and checks of the cards links unfurl with
  joined.ts           "Your votes": cards of boards voted on (snapshot, what's new since the last visit, order, copy)
  list.ts             a list typed or pasted in the add field as labels (lines, `\n`, Markdown and bulleted lists, tabs,
                      JSON array); duplicates of what the ranking has; sharedLabels() = what another app shared, as labels
  backup.ts           export and import (D97–D101): the file format, strict validation of a file, merge that never replaces
  images.ts           images out of localStorage (D124–D126): content keys, references `idb:<key>`, stored form, hydration, clean-up rule (a reference is never drawn: imageSrc() refuses it)
  push.ts             notifications of published boards (D131–D133): subscriptions (allowed push services, keys), roles, voters
                      milestones, the messages (texts in i18n/unfurl.ts), this browser's bells (`versus-push`), base64url
  model.ts, util.ts   constructors, ids, escaping, small helpers; imageSrc() and hueValue(): the only way a view reads an
                      item's picture and hue
  site.ts             the site's links and paths (home pages, legal notice, app), shared by the app, the pages and the build
src/i18n/             en.ts is the source of keys; fr.ts is typed as Messages so missing keys fail typecheck;
                      text.ts: what every dictionary does (fill, plural rule, percentages, locale), no texts, importable anywhere;
                      landing-en.ts / landing-fr.ts: the home page's texts; legal-en.ts / legal-fr.ts: the legal notice's (same rules);
                      unfurl.ts: a board's link preview texts, the only dictionary the Worker bundles; admin.ts: the moderation page's
src/app/              UI: renders HTML strings, one delegated listener per event type (data-action attributes)
  ui.ts               mount(): loads data, adds demos, binds events, first render
  state.ts, dom.ts    app state (rankings, prefs, route, save) / document, media queries, $, toast, modal, icons, focus helpers
  nav.ts              `render` registered by ui.ts and called by the views that only need "draw again" (no import of rankings.ts)
  rankings.ts         render() (gallery or workspace), routeFromURL() and ranking-level actions (new, open, reset, duplicate, delete, language)
  gallery.ts          gallery cards: your rankings, your votes (boards voted on), Popular (featured boards and templates), demos
  joined.ts           "Your votes": records a card at the first vote, refreshes cards from the server, forget, keep a copy
  popular.ts          the Popular section's list (fetched at most every ten minutes, never stored) and "Make my own" from it
  about.ts            the page text closing the gallery (what Versus is, how it works, methods) and its footer line (home page,
                      author, source, legal notice, D115); its static English copy
                      with the page's h1 is in index.html for crawlers without JavaScript (build/seo.ts)
  workspace.ts        workspace shell (shared with a board's author), tabs, method menu, renderMain() (duel or results)
  editor.ts           the items pane every ranking shares (D116): add field, images and colors, the list (FLIP), the
                      question on an item's votes; `ItemsHost`, the pane's two owners (items.ts localHost, author.ts
                      authorHost), picked once from the route in workspace.ts; a visitor's suggestion uses its add field
  items.ts            a local ranking's items in the editor: live-sorted list and edits (add text/colors/images, rename, remove)
  duel.ts             duel stage: cards, swipe, picks, skip, undo, keyboard shortcuts; the duel kit board.ts reuses (keys,
                      controls, side → outcome, pick animation)
  results.ts          podium or lines comparing two methods (switch), table, method comparison, copy
  ending.ts           end of a local ranking: announcement with confetti and a button to the Ranking tab (focused, announced)
  slope.ts            lines between two rankings (end-of-vote page, method comparison): drawing and hover
  color.ts            color editor popover
  publish.ts          publish modal and the settings forms shared with the board's settings
  board.ts            published board page: connection, server-assigned duels, crowd ranking (live or frozen), suggestions,
                      report form, withdraw; its author gets author.ts instead
  board-state.ts      the board's DOM-free state: the Board record, the pending queue and optimistic changes with their undo
  author.ts           a published board seen by its author (D116): the workspace with the items pane, title, method, the
                      settings behind the Published button, and item edits through the API (votes kept or reset)
  finale.ts           end-of-vote page (all pairs voted): podium or you vs the crowd, toggle, reveal animation
  share.ts            share as an image: cards from the app's state, the share panel (share sheet, copy, download), and sends a
                      board's or a duel's landscape card for its link preview; loaded on demand (events.ts loadSharing)
  share-draw.ts       draws a card on the canvas it is given (spec, format, palette, pictures): no page, no app state
  errors.ts           what a failed API call says, one full map per kind of call (owner, publish, report, read): typed, so a
                      new error code must say something
  remote.ts           API calls (15 s time limit) and the board WebSocket (hello with the protocol version, reconnect, gone)
  turnstile.ts        Cloudflare Turnstile's widget, when the build has a site key: at publication, before a first vote on an official board
  router.ts           the address bar follows the view (push, replace), app folder from the page's <base>; counts each view
  events.ts           delegated listeners (click, input, change, keydown, paste, drag and drop)
  pwa.ts              registers the service worker (production only), update bar, install button, persistent storage
  backup.ts           export (share sheet on phones, download elsewhere) and import (file picked or dropped)
  images.ts           IndexedDB for images (database `versus`, store `images`): read at startup, store on save, clean up
  inbox.ts            what another app shared to Versus (share target): picked up at startup, imported or added where the user picks
  push.ts             notifications: support, subscribing on a tap (the voter's bell in board.ts and finale.ts, the author's box in
                      author.ts), turning off, the startup check of the subscription, a tapped notification opening its board
  header.ts, format.ts  static header texts and theme / score, record and date formatting
  version.ts          the build's version, read from package.json, closing the about footer (Versions and releases)
  storage.ts          guarded localStorage access, prefs, migration from prototype keys, unreadable rankings set aside
src/landing/          the home page: markup.ts renders it at build time (pure strings, like frame.ts: the demo frames'
                      HTML, shared with the script), data.ts (its items, EN/FR), sprite.ts (pastry drawings), strings.ts
                      (texts at build time), crowd.ts (simulated votes); main.ts + mount.ts bring it to life: board.ts (a
                      demo frame over src/core), demo.ts (the hero's scripted demo), cursor.ts, motion.ts (on-screen loops,
                      pause), sections.ts (title word, vignettes, try it, methods, crowd, languages), landing.css
src/legal/            the legal notice (publisher, hosting, privacy, measurement, licence): markup.ts renders it at build time with
                      the home page's header and footer; main.ts + mount.ts count the view and run the measurement switch; legal.css
src/admin/            the moderation page (/admin/, D107): page.ts renders it and calls /api/admin with the token typed on it (kept in
                      the page's memory only), admin.ts is the entry (its bundle is named admin-*, kept out of the precache), admin.css; no measurement
worker/               Cloudflare Worker: index.ts (router, admin, limits), board-object.ts (one Durable Object per board: SQLite, WebSockets, TTL alarm),
                      cards.ts (link previews: the cards in R2, /og/ routes, head rewriting), pictures.ts (items' pictures: sent for review to R2,
                      public under /img/ once approved, the admin's decision), templates.ts (official templates: publication on demand, the
                      /t/<slug>/ pages in the legal shell, the sitemap completed), registry.ts + migrations/ (D1 registry: the admin list's rows,
                      flags, report and picture counts, template key, recent votes, top labels; 0005 indexes the Popular list), webpush.ts (Web Push: RFC 8291 encryption, RFC 8292 VAPID, WebCrypto only),
                      cache.ts +
                      cache-rules.ts (the edge cache: Popular, template pages, the sitemap, a board's page, keyed by URL and deployed version),
                      log.ts (one JSON line per event: quiet failures, admin actions, CSP reports; never a token, voter id or address),
                      env.ts, random.ts, turnstile.ts; own tsconfig; secrets ADMIN_TOKEN, TURNSTILE_SECRET,
                      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY; variables IMAGES_UPLOAD (`review` turns pictures on), CACHE_SECONDS (caps the edge
                      cache, 0 = off), PUSH_LOCAL (tests); bindings BOARDS, REGISTRY, IMAGES (R2 bucket
                      versus-images), VERSION (version metadata), rate limits PUBLISH_LIMIT, API_LIMIT, SUMMARY_LIMIT, CSP_LIMIT;
                      `run_worker_first` for /sitemap.xml
tests/                one suite per core module + app.test.ts (jsdom smoke test) + board-ui.test.ts, votes-ui.test.ts, share-ui.test.ts and
                      admin-ui.test.ts (published boards, "Your votes", the share panel and the moderation page against a fake API and a fake
                      canvas, tests/helpers/) + worker.test.ts (end to end in workerd via Wrangler's test harness)
                      + seo.test.ts (heads per page, hreflang, JSON-LD, icons and generated files stay consistent) + pwa.test.ts (precache
                      list, version) + landing.test.ts (home page markup and texts) + landing-ui.test.ts (jsdom smoke test)
                      + audience.test.ts (measurement settings, loading rules, clean payloads) + legal.test.ts (legal pages, switch)
                      + backup-ui.test.ts (export, import, drop, the iOS home-screen note) + images.test.ts (image references)
                      + inbox-ui.test.ts (shares picked up: lists, the choice, a Versus file) + push.test.ts (RFC 8291 example, VAPID,
                      subscriptions, messages) + push-ui.test.ts (bells, the author's box, a tapped notification) + popular-ui.test.ts, finale.test.ts,
                      storage.test.ts, remote.test.ts (time limits), sw.test.ts (the service worker's install against fake caches),
                      pictures.test.ts, log.test.ts, cache.test.ts, turnstile.test.ts (Worker modules that run in Node); worker.test.ts runs a fake push
                      service and decrypts what the Worker sends
                      + hostile-ui.test.ts (every view of a ranking drawn from hostile stored data: nothing runs or loads)
                      + a11y-ui.test.ts (keyboard patterns, focus kept and moved, names, toasts), gallery-wait-ui.test.ts, styles.test.ts
                      and tokens.test.ts (contrast of the tokens, target sizes, focus and forced-colors rules)
tests/e2e/            Playwright (`npm run e2e`): real Chromium, desktop and phone, the API and the board's WebSocket faked per test;
                      a11y.spec.ts runs axe (WCAG 2.2 AA) on every page and view in both themes
e2e/                  the second end-to-end suite, against the real Worker (D134): serve.ts builds the app in worker mode and runs the
                      Worker locally (fresh state, the tests' admin token and keys), fixtures.ts (each browser a person: storage, client
                      address, nothing external), local.spec.ts (duels, gestures, paste, colors, drops, export, addresses), boards.spec.ts
                      (voters live, closing, admin link, withdrawal, moderation), pwa.spec.ts (offline, notifications), phone.spec.ts
                      (touch, no sideways scroll)
playwright.config.ts  projects desktop and phone (tests/e2e, Vite's dev server) and worker-desktop and worker-phone (e2e/, the real
                      Worker, `CHROMIUM_PATH` honored there); both servers through webServer
docs/                 decisions, roadmap, published boards model, online architecture, SEO, PWA, audience measurement
```

## Conventions

- **All user-facing text goes through `t()`** (`src/i18n`). Add every key to both `en.ts` and `fr.ts` (typecheck enforces parity; tests check placeholders match). Plurals via `plural(n, key)`, percentages via `pct()`. The home page's texts go in `landing-en.ts` and `landing-fr.ts` (same rules); it renders at build time, so its script gets texts as JSON and never imports a dictionary.
- **Business logic lives in `src/core`**, never in `src/app/` or `worker/`. It is shared with the Cloudflare Worker, so keep it free of DOM, browser and Workers APIs; `worker/` only adapts it (storage, sockets, alarms).
- **Addresses:** every view has a path under `app/` (D92, `core/route.ts`): open views through `open()` / `openBoard()` / `goBack()` / `setTab()`, which keep the address bar in step, never with `history` directly. Links the app builds come from `routeURL()`; an author's token only ever goes in the fragment. A duel link adds `?duel=<a>.<b>` (`core/share.ts`), read once and dropped from the address.
- **Sharing (D102 to D106, D117):** images are drawn in the browser (`app/share.ts`), never on the Worker; a board's link preview card is the landscape one, sent with `putCard()` and served by `worker/src/cards.ts`. New share entry points build a `CardSpec` in `core/share.ts` and call `openShare()`; a page with several views of its result passes one `ShareView` per view and the key of the one on screen.
- **Official templates and public lists (D110 to D112):** the templates are fixed data in `core/templates.ts` (EN and FR, a slug per language, the key is the English slug); the Worker publishes them on demand (`worker/src/templates.ts`), never by hand. Public lists (Popular, the sitemap) read the registry only, never wake boards, and never list a hidden board or someone's unlisted board. A template page's robots meta and the sitemap must agree (`TEMPLATE_INDEX_VOTERS`). Texts the Worker renders live in `i18n/unfurl.ts` (`tpl*` keys), the only dictionary it bundles.
- **Pictures (D113, D114, `docs/published-boards.md#images`):** bytes never travel in a publish request; an item announces a picture (`pic: 'pending'`) and the app sends it afterwards with the author's token. The server's policy (`parseNewItem(x, images)`, `off` | `review`; a picture never arrives as an address) is the only gate; `/img/b/…` serves a picture only once its R2 metadata says `ok`. A new place that shows items should honor `pic` the way the author's items list does (text until approved).
- **Items (D116):** one items pane for every ranking (`app/editor.ts`): a local ranking (`items.ts`) and a board's author (`author.ts`) fill it, a visitor's suggestion uses its add field. On a published board, an edit of an item with votes asks whether they stay (`askVotes`); the rule is `editItem` in `core/board.ts`. Don't build a second form for items.
- **Notifications (D131 to D133, `docs/published-boards.md#notifications`):** rules and texts in `core/push.ts` (texts in `i18n/unfurl.ts`, the Worker's dictionary), sending in `worker/src/webpush.ts`; a board queues messages in its `outbox` and its alarm sends them in batches of `PUSH_BATCH` (the free plan's 50 subrequests). Ask on a tap only, never on arrival; a new event is a `PushEvent` kind with its audience, TTL and texts, queued with `notify()` in the board's Durable Object, and a test in `worker.test.ts` that decrypts it. Never send content beyond the board's title and an item's label.
- **Moderation (D107 to D109, `docs/published-boards.md#moderation`):** rules in `core/board.ts` (`parseReport`, `addReport`, `moderate`), the admin's views in `core/protocol.ts` (`AdminRow`, `AdminBoardView`), the registry row mirrors the flags and report count. The moderation page (`src/admin/`) has its own dictionary (`i18n/admin.ts`) and never imports the app; a new admin action is a Worker route, a `BoardObject` method, a `data-act` on the page and a test in `worker.test.ts` and `admin-ui.test.ts`. Voters' views (`BoardView`, `BoardSummary`, `Unfurl`) never carry `mod` or reports.
- **UI pattern:** view modules in `src/app/` render HTML strings; interactive elements carry `data-action` (+ `data-id`, `data-tab`…) handled by the delegated listeners in `events.ts`. Always escape user content with `esc()`, in attributes too (ids included); an item's picture and hue go through `imageSrc()` and `hueValue()` (`core/model.ts`), colors through `fillCSS()`: stored data is read, never trusted. A new view gets its own module; keep `events.ts` a thin dispatcher.
- **Colors come from CSS tokens** (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--a` cobalt, `--b` coral, `--good`, `--bad`, `--on-accent`), defined for light and dark. Coral and green as text or thin borders use `--b-ink` and `--good-ink` (4.5:1 in both themes, also the fill under white text), field borders `--field` (3:1); `tests/tokens.test.ts` checks the contrasts. No literal colors in components, except text over images and fills.
- **Fonts:** Bricolage Grotesque (display), Figtree (body), JetBrains Mono (numbers). Numbers use `.mono` (tabular figures).
- **Accessibility:** keyboard access for every action, `aria-label` on icon buttons, `prefers-reduced-motion` respected, visible focus.
- **Storage keys:** `versus-v1` (rankings; a published one has `pub`; an image is a data URL or a reference `idb:<key>` to IndexedDB `versus` / `images`, D124), `versus-v1-unreadable` (stored rankings the app could not read, set aside untouched), `versus-prefs` (lang, theme, hideDemos, live, resultView, rankView, joinedHint; the home and legal pages read theme and lang and write lang), `versus-voter` (anonymous voter id), `versus-owners` (owner tokens by board alias), `versus-joined` (cards of boards voted on, "Your votes"), `versus-push` (the boards this browser asked notifications of, by role, and the endpoint they know), `umami.disabled` (Umami's own opt-out key, set by the legal page's switch); `sessionStorage` `versus-lang-hint` (the home page's language suggestion dismissed) and `versus-path` (a deep app path handed over by GitHub Pages' 404 page). Cache API: `versus-<version>` (the service worker's files) and `versus-inbox` (a share from another app, until the app picks it up). Changing the stored shape requires a migration in `storage.ts`.
- **Audience measurement** (`docs/analytics.md`): views and events go through `src/audience.ts`, never through the tracker's automatic tracking or `data-umami-event` attributes. An event's data is anonymous facts only (method, counts, flags), never a title, a label, an id or an alias. The legal notice lists what is counted: change an event, a tracked path or what is stored, and update `src/i18n/legal-*.ts` in the same commit.
- **Demos are fixed data** (`core/demos.ts`): same items and duels for everyone (seeded `mulberry32`). Don't make them random.
- **SEO lives in `build/site.ts`**, never hand-written in the HTML shells or `public/`: each page's head, the manifest, robots.txt, the sitemap and llms.txt are generated from it; the canonical address is https://versus.steevepommier.com/ unless `VITE_SITE_URL` (CI variable `SITE_URL`) says otherwise. The home pages (`/`, `/fr/`) are the indexed ones, linked by hreflang, with every word in their static HTML and one h1; the app (`/app/`) is `noindex` and keeps its own static text (`src/app/about.ts`). Links between pages are relative (the site also lives under github.io/versus/). A redesigned icon or social card gets new file names (caches key on the URL). Modules the Vite config reaches import with their `.ts` extension (D90). Details in `docs/seo.md`.
- Commit only when `npm run check` passes; after a change to the UI, the Worker or the service worker, run `npm run e2e` too. CI (`.github/workflows/ci.yml`) runs Biome, tsc, coverage and build, and the end-to-end tests, on PRs and pushes; once both pass it deploys `main` to Pages, and to Cloudflare (`npm run worker:deploy`) when the `CLOUDFLARE_ACCOUNT_ID` variable is set. `.github/workflows/registry.yml` checks a pull request's Registry block and reports it to the owner's register after the merge (see "Report the project's state" below, D122).

## Key domain rules

- Scoring methods (per ranking, switchable at any time; everything is recomputed from the same duel history):
  - `bt` **Balanced** (default): Bradley-Terry fitted by MM iterations, with a virtual tie against a fixed 1500 anchor to keep scores finite; shows a ± standard error per item. Order-independent.
  - `elo` **Dynamic**: Elo, K=40 for an item's first 6 duels, then 24. Order-dependent by design.
  - `win` **Simple**: smoothed win rate `(w + d/2 + 1) / (games + 2)`.
  - `sort` **Exact sort**: binary insertion sort replayed from recorded duels; no ties, no skips; finishes in ≤ Σ ceil(log2(k+1)) duels.
- Stability for rating methods = duels / `max(n, round(n·log2(n)·1.2))`; for exact sort = placed items.
- Pair selection favors items with few duels, close positions and unseen pairs, and avoids the previous duel's items.
- Items: text, image (downscaled to 640 px JPEG 0.82 data URL), or fill (`solid` | `gradient`, 2–3 hex stops). Typing or pasting `#hex` creates a color item. A color item whose label equals its code follows the color when edited. On a published board an image is a picture sent for review (`pic`), then an address under `/img/`.

## Rule 1 — Automatic commit at the end of every task (MANDATORY)

As soon as a task requested by the user is finished (feature, fix, refactor, content…), the agent MUST create a commit before handing back. No need to ask permission: it is the expected behaviour.

### Exact procedure

1. **Check the state**: `git status --porcelain` and `git diff --stat`.
2. **Select only the task's files**:
   - Stage file by file with `git add <path>` (never `git add -A`, `git add .` or `git commit -a`).
   - A modified file unrelated to the task (parallel session, tooling noise) stays **unstaged**. Do not touch it, stash it or reset it.
   - If one file holds changes from this task AND another, prefer `git add -p <file>` to stage only the relevant hunks. If inextricable, stage the whole file and say so in the commit body ("also contains …").
   - Never stage: `.env`, `.env.local` and any secret file, `.dev.vars` (the Worker's local secrets), `.idea/`, `.vscode/`, `dist/`, `coverage/`, `.wrangler/`, `node_modules/`, `test-results/`, `playwright-report/`, `.DS_Store` — unless the task is explicitly about them. `.env.worker` is the one tracked env file, on purpose: it holds the Worker build's public `VITE_API_URL` and nothing secret ever goes in it. If one of the others turns out to be *tracked*, say so: it must be untracked and gitignored, not carefully avoided at every commit.
   - Check with `git diff --cached --stat` before committing.
3. **Commit with a readable message** (format below). Always use a HEREDOC to keep title + body, and end it with the attribution trailer(s) your harness asks for:

   ```bash
   git commit -m "$(cat <<'EOF'
   Imperative title, ≤ 72 characters, no trailing period

   Why this change, what it does concretely, non-obvious decisions.
   One line per idea. Mention the files/areas touched if useful.

   Co-Authored-By: …
   EOF
   )"
   ```

4. **Push only from a cloud session** (see "How this project is built"). End the reply with a recap: short hash + commit title + the list of files that were modified but deliberately **left uncommitted**, if any.
5. If a git hook changes or refuses something: read the output, fix, recommit. Never `--no-verify`. (There is no hook in this repo today.)

### Commit message format

- **Title**: English imperative, clear sentence, ≤ 72 chars, no `feat:`-style prefix, no trailing period. Real examples from this repo: `Leave backfills to second-brain's workflow and its single token`, `Release 1.1.0 — Croissant`. A few older titles carry an `Area:` scope prefix (`PWA:`, `Duel:`); that is drift, not the convention.
- **Blank line**, then a **body**, mandatory whenever the title is not enough: the *why*, the *how* in 2–6 lines, the trade-offs, what remains to do. The body is what lets someone find, weeks later, which feature produced this diff. A decision it rests on is a D row in `docs/decisions.md`, named by number.
- A commit **never** mixes two tasks. If a session handles several distinct tasks, make several successive commits.
- No empty commit, no "WIP" commit, no commit for an unfinished task. If the task is interrupted, leave the work uncommitted and say so.

### When is a task "finished"?

- The requested code is written **and** `npm run check` is green (lint, typecheck, tests, build: what CI's `verify` job runs), `npm run e2e` too after a change to the UI, the Worker or the service worker (CI's `e2e` job), and `node .github/release.mjs check` when `CHANGELOG.md` or `package.json` moved. A change to what renders also gets looked at in a browser (Playwright's Chromium is at hand, phone and desktop sizes, both themes).
- A plain question, an exploration or an explanation produces **no** commit (nothing to commit).

## Rule 2 — Project memory in `MEMORY.md` + `docs/memory/` (MANDATORY)

The repo carries its own long-term memory, read locally and in the cloud alike: `MEMORY.md` at the root is the always-loaded index (imported below), and the topic files its table lists are loaded on demand, never imported — the `docs/*.md` this project kept from its first day (decisions as D-numbered rows of `docs/decisions.md`, the roadmap, published boards, the online architecture, SEO, PWA, audience measurement) and `docs/memory/<topic>.md` for what fits none of them.

- **Read `MEMORY.md`, then the topic file(s) for the area you are about to touch, before acting** — to understand previous choices and not re-propose what was rejected.
- **Every task writes to memory by default, in the same commit** (rule 1): what a future agent should know that is in neither the code nor `git log` — a decision and its reason (a structural one as a new D row in `docs/decisions.md`, which memory points at rather than restates), an explicit rejection, a trap and its remedy, a working preference. Update the existing entry rather than adding a near-duplicate, delete what became false, date each entry `YYYY-MM-DD`. **If, exceptionally, there is nothing worth keeping, say so explicitly in the final message** — silence is not an option.
- English, dense, factual; no session narration, nothing the diff, `git log` or this file already says, each fact stated once; no test counts.
- The project command `/memorize` (`.claude/commands/memorize.md`) does this consolidation on demand over a whole conversation.

@MEMORY.md

## Rule 3 — Report the project's state (MANDATORY)

The register of what is open is the private `second-brain` repository: one
folder per project, filed by group and domain and found by its slug (`versus`
here), whose `README.md` carries a typed front matter (`state`, `point`,
`repos`) and a `## To do` list of checkboxes. `PROJECTS.md` at its root is
GENERATED from those folders. That register is the source of truth — not this
conversation, not Claude's memory, not `git log`, which records what changed
and never what state the project is in.

A session that changes code here changes this project's state, and the state
reaches the register **through this repository: never touch `second-brain`**.
Do not attach it (`add_repo`), do not clone it, do not commit to it — locally
either, even though it sits beside this checkout. On every push to `main`,
`.github/workflows/registry.yml` reads the block below from the merged pull
request's description (or, when there is none, from the pushed commits'
messages) and sends it to `second-brain`, whose own workflow updates the fiche
and regenerates `PROJECTS.md`. Only what reaches `main` is reported.

Write the block in a cloud session in this repository's pull request
description, **inside an HTML comment** so the rendered pull request stays
clean and its French does not mix with an English description. The labels are
English, what follows them is French:

    <!-- Registry
    Project: versus
    Last point: <the project as it now stands, in French>
    - [x] <an existing box this work closes, copied from the fiche>
    - [ ] <a new open action, in French>
    Log: <one line for the fiche's log, in French>
    -->

In a local session, write the same lines at the end of the task's commit body,
after a line `Registry:`.

Every line but the first is optional. `Last point:` REPLACES the fiche's
paragraph: write what someone back after three months needs about the whole
project, not a changelog — the commit body already carries the detail. A
`- [x]` ticks a box only when its text matches one; copy it from the fiche
when you can read it (locally `../second-brain`, or through GitHub when the
session already has it — never attach it just to read it), otherwise leave the
ticking to the maintainer. A new box is one gesture, not a plan. The date is
the merge's, and `state:` is never written by a block: it is the
maintainer's call.

**Hidden is not private.** The API hands a pull request's description and a
commit's message to anyone who can read the repository. In a **public**
repository the block carries only what is already public: the `Project:` line,
ticked boxes (`- [x]`) and one `Log:` line — never a `Last point:`, never an
open box, nothing else. The `check` job of `registry.yml` checks every pull
request before it is merged: it fails on a malformed block, on a block left
visible under a heading, and, in a public repository, on any other line; and
the report strips such a line if it is merged anyway.

**This repository is public** (measured 2026-10-17), so its blocks carry only
`Project: versus`, ticked boxes and one `Log:` line. `registry.yml` reads the
visibility itself: nothing here changes if the repository goes private.

A change a returning reader does not need — tooling, a typo, a refactor —
carries no block. A question, an exploration or an explanation changes no
state and writes no block.

## Rule 4 — Versions and releases (MANDATORY)

The project carries **one version**, `version` in the root `package.json`, in
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`.
`CHANGELOG.md` says what each release brings to the people who use the
project, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
shape. **It is written in English, like the code, even where the app speaks
French.** Each release has a **codename**: here a pastry (1.0.0 Chocolatine), from the home page's world.

- **Every pull request that changes what users get** adds its lines under
  `## [Unreleased]` (`### Added`, `### Changed`, `### Fixed`, `### Removed`,
  `### Security`), written for a user, not a developer. Tooling, a refactor or
  a test adds nothing there. It does not touch the version.
- **A release is its own pull request**, made when the owner asks for one: it
  moves the `Unreleased` lines under `## [x.y.z] - YYYY-MM-DD — Codename` and
  sets `package.json` to the same version, nothing else. PATCH for fixes only;
  MINOR for anything new; MAJOR when something users relied on stops working
  (stored data that does not carry over, a link, a protocol, a removed
  feature). Before 1.0.0, MINOR covers both. A new MINOR or MAJOR takes a new
  codename, never reused; a PATCH keeps its minor's. When a milestone ends or
  `Unreleased` holds something worth announcing, say so in the final message:
  the owner decides when to release.
- **Never tag nor publish a release by hand.** On `main`,
  `.github/workflows/release.yml` gives every section that has none its tag
  `vX.Y.Z` and its GitHub Release; on every pull request its `check` job
  refuses a `CHANGELOG.md` that disagrees with `package.json` or breaks the
  shape. Run `node .github/release.mjs check` before pushing a release.
- **A backfilled release** — a version given after the fact to a past state —
  is a section placed at its rank in the file, with
  `<!-- commit: <full sha> -->` right under its heading; the workflow tags that
  commit. It never rewrites a section that already has its release. GitHub
  refuses the workflow's own token a tag on a commit whose workflows differ
  from `main`'s, so here a backfill is skipped with a warning and the rest
  still ships; `second-brain`'s "Backfill releases" workflow, which holds the
  owner's token, publishes it (`release.mjs backfill`).
- **A repo that serves a page shows its version** where a user can find it (a
  footer, an about line, a settings screen), read from `package.json` at build
  time, so a phone in hand says which build it runs.

## Verification — trust the disk, not the context

- A tool answering "success" is not proof. Before saying a change is done, prove it through the repo: `git status --porcelain`, `git diff`, `grep` for the expected value, `git show HEAD:<file>` compared to the file on disk.
- What you hold in context (an earlier `Read`, an old `ls`, a summarised conversation) can be **stale**. Signature: `git status` clean right after an announced change. Re-read from disk before concluding.
- Never state an absence ("this feature is missing", "that file does not exist") without a `git`/`grep` check made in the current turn.

## Other rules

- Never rewrite history (`rebase -i`, `commit --amend`, `reset --hard`, `push --force`, `filter-repo`) without an explicit request. Do not modify `.git/config`, the hooks or branch settings.
- The project's own rules — business logic in `src/core`, every text through `t()`, addresses, sharing, pictures, moderation, storage keys, SEO in `build/site.ts` — are the Conventions and Key domain rules above. A new rule of that kind goes there, and the decision behind it as a D row in `docs/decisions.md`.
- Never put a secret in a `VITE_` variable or in `.env.worker`: a `VITE_` value ends up in the browser bundle. The Worker's secrets go through `wrangler secret put` (locally `.dev.vars`, ignored).

## Related files

- `AGENTS.md`: a symlink to this file, for tools that do not read `CLAUDE.md`.
- `MEMORY.md` + `docs/memory/`: the project's long-term memory (rule 2); `.claude/commands/memorize.md` consolidates a conversation into it.
- `CHANGELOG.md`: what each release brought, newest first (rule 4); `.github/release.mjs` + `.github/workflows/release.yml` tag and publish it.
- `docs/decisions.md`: what was decided and why (design, naming, scoring, tooling), one D row per decision.
- `docs/roadmap.md`: done, next, later, open questions.
- `docs/published-boards.md`: agreed behavior of published (shared) boards: lifecycle, voting rules, visibility, live updates, moderation, pictures, templates.
- `docs/online-architecture.md`: backend for published boards on Cloudflare (`worker/`), how to deploy it.
- `docs/seo.md`: head tags, JSON-LD, icons, social card, manifest, robots, sitemap, llms.txt; decisions and what the owner has to do (Search Console, `SITE_URL`).
- `docs/pwa.md`: the installable, offline app: the service worker, updates, export and import, images in IndexedDB, the share target, shortcuts, notifications.
- `docs/analytics.md`: audience measurement (Umami, what is sent and never sent, how it loads, settings) and the legal notice; what is left to check live.
- `COMMON-PROJECT-SPEC.md` in the private `second-brain` repo: where rules 1 to 4 come from, adopted here on 2026-10-19.
