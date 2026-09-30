# Decision log

Decisions made while designing Versus (conversation of 2026-09-29, prototyped as a claude.ai artifact, then moved to this repo). Status: **Decided** (in the code), **Proposed** (agreed direction, not built), **Open** (to settle).

## Product and naming

| # | Decision | Status | Why |
| --- | --- | --- | --- |
| D1 | Name the product **Versus** | Decided | Neutral, universal, fits photos, products, characters. Chosen from a shortlist: Twofold, Either, Pickwise, Pairwise, Ordo, Faceoff, Head to Head, Rankoff. |
| D2 | Don't use "Elo" as the product name | Decided | "Elo" is Arpad Elo's name; it evokes chess and e-sports, and the word is already a brand in other sectors (a Brazilian card network, a touchscreen maker). The method name stays free to use. |
| D3 | Check trademarks and domains for "Versus" before any public launch | Open | Not done yet. Check INPI / EUIPO, and app stores if relevant. "Versus" is a common word: expect conflicts, and consider a qualified name or domain. |
| D4 | Keep the tool universal: text, images, colors | Decided | Photos, products, characters, colors… anything comparable. |

## Design

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D5 | Validated visual identity | Decided | Contender A in cobalt (`#2743F5`), B in coral (`#E4492A`); cool neutral greys; Bricolage Grotesque + Figtree + JetBrains Mono; logo = "vs" disc split cobalt/coral. |
| D6 | Layout: gallery → workspace | Decided | Gallery of rankings (mosaic of the top 3, stability bar, actions). Workspace: items sidebar that re-sorts live after each duel (FLIP animation) + main area with Duel / Ranking tabs. On mobile the sidebar becomes an "Items" tab. |
| D7 | Duel interactions | Decided | Swipe (left = A, right = B), tap a card, buttons A wins / Tie / Skip / B wins, keys ← → ↓ S, ⌘/Ctrl+Z to undo. Win-probability forecast shown between cards (Elo/BT). Floating score deltas after each pick. |
| D8 | Results page | Decided | Podium (top 3), full table (score, ± margin for BT, W·L·T), and a table comparing the top 6 under all four methods. |
| D9 | Show position moves (↑2, ↓1) in the list rather than raw points | Decided | Raw Elo points mean little to most people; points stay visible in results. |
| D10 | Light and dark themes, switchable (system / light / dark) | Decided | Saved in prefs, applied before first paint. |

## Scoring

| # | Decision | Status | Why |
| --- | --- | --- | --- |
| D11 | Offer 4 methods, switchable per ranking without losing duels | Decided | Everything is recomputed from the duel history, so switching is free and comparable. |
| D12 | **Bradley-Terry is the default** ("Balanced") | Decided | Items (photos, products) don't change over time; Elo is designed for players whose level evolves and depends on duel order. BT is order-independent and gives an uncertainty margin. LMSYS Chatbot Arena moved from Elo to BT for the same reason. |
| D13 | Keep Elo as "Dynamic" | Decided | Useful when preferences evolve. |
| D14 | Win rate as "Simple" | Decided | Most readable; biased when opponents are uneven. |
| D15 | Exact sort (binary insertion) as "Exact sort" | Decided | Fewest duels and a guaranteed end for short lists; no ties, no skips. |
| D16 | Don't use TrueSkill | Decided | Microsoft system, protected. Glicko (Elo + uncertainty) could come later, but BT already covers the need. |
| D17 | Scores stay on a 1500-centered scale | Decided | Familiar; the UI names the column "Score" (BT), "Elo", "Wins" or "Status". |

## Content and data

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D18 | Local-first: data in `localStorage` | Decided | Nothing leaves the browser for now. |
| D19 | Demos are fixed data | Decided | Three demos ("Next destination" text/BT, "Website background" gradients/Elo, "Accent color" solid colors/exact sort). Same items and duels for everyone (seeded PRNG). Reset, duplicate, hide. Translated with the UI unless the user renamed an item. |
| D20 | Colors are data, not images | Decided | Fills stored as hex stops, rendered in CSS (gradient + soft halos + fine scan lines). Light and deterministic. |
| D21 | Color items are editable after creation | Decided | Popover: live preview, solid/gradient, up to 3 stops with picker + hex field, 6 harmonies of the active color + 6 presets. |

## Languages

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D22 | English by default, French available, EN/FR switcher | Decided | Detection: saved choice → browser language → English. |
| D23 | Launch with 2 languages, add others based on real traffic, max ~5 the first year | Proposed | Natural candidates: Spanish, Brazilian Portuguese, German. Never translate user content. Demos are translatable because they're fixed data. |

## Engineering

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D24 | Vite + TypeScript, no framework | Decided | Ported from the single-file prototype; small bundle (~20 kB gzip JS). A POC speed choice, reopened and kept: the web app comes first and stays light (D75). |
| D25 | Pure `src/core` shared by UI and future backend | Decided | Enables running the same scoring on a Cloudflare Worker. |
| D26 | Biome, strict TS, Vitest with a 90% coverage floor on `src/core` | Decided | Plus a jsdom smoke test of the whole app. |
| D27 | Single CI workflow; deploy to GitHub Pages from `main` only after checks pass | Decided | Relative `base: './'`, so the build works under `/versus/`. Dependabot weekly for npm and actions; `@types/node` majors ignored to match Node 22. |
| D28 | MIT license | Decided | © 2026 Steeve Pommier. |

## Going online

See `docs/online-architecture.md`.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D29 | The bottleneck is architecture and hosting cost, not language speed | Proposed | Estimated load for hundreds of thousands of users is a few hundred messages/s at peak; Node/TS handles that easily. |
| D30 | Cloudflare (static front + Workers + one Durable Object per shared board + R2 for images later), TypeScript end to end | Proposed | Free tier covers the experiment; $5/month paid plan beyond. Keeps one language and shares `src/core`. |
| D31 | Stay local-first; only shared boards hit the server | Proposed | Main cost lever. |
| D32 | Plan B: self-host on the home Optiplex behind Cloudflare Tunnel | Proposed | Free, fine for a private beta, not for viral traffic. |
| D33 | Board registry in D1 for the admin view | Decided | Durable Objects can't be listed with their data. Updated at most once a day per board. |
| D34 | Move the front from GitHub Pages to Cloudflare when the backend lands | Decided | Same origin as the API (no CORS), custom domain. |

## Published boards

See `docs/published-boards.md`.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D35 | Two kinds of rankings: local (private) and published (on the server, open to anyone with the link). A board is born local and published when ready | Proposed | The publish modal warns that it becomes public and can be withdrawn. |
| D36 | At publication, the author chooses whether their local duels count as their votes | Proposed | Default on; repeated duels on a pair collapse to the last one. |
| D37 | Lifecycle: local → published → closed (frozen, results revealed, reopenable) → withdrawn | Proposed | Withdrawing deletes the server data; the author keeps a local copy with the crowd's result. |
| D38 | One voice per voter per pair; a new vote on a pair replaces the previous one | Proposed | Heavy voters cover more pairs but never weigh more on one. |
| D39 | Voters can delete and redo their votes; the author can turn this off | Proposed | Not a weighting risk under D38; guards against strategic changes. Undoing the last vote stays possible for a few seconds. |
| D40 | Results visibility is an author setting: always (default), after N votes, blind until closing | Proposed | Enforced by the server. Duel cards never show the crowd's score or rank. |
| D41 | Live updates on by default; each viewer can turn them off | Proposed | Off = frozen ranking + "N new votes · Refresh". |
| D42 | The server assigns pairs and accepts votes only on assigned pairs | Proposed | Needed for blind mode; blocks targeted vote stuffing. |
| D43 | No images on published boards in v1 | Proposed | Images (R2) come with reporting and takedown. |
| D44 | Items are locked once published (deleting and adding stay possible) | Proposed | Editing an item would betray its votes. |
| D45 | The author picks the method among Balanced (recommended), Dynamic and Simple; Exact sort is shown greyed out | Proposed | Binary insertion can't serve concurrent voters; showing it disabled with its reason teaches the difference. Switchable after publishing. |
| D46 | Votes are anonymous; a voter is a random id per browser | Proposed | Nobody, the author included, sees who voted what. |
| D47 | Minimal publish modal (warning, push my votes, visibility, method); other settings under "More options", with defaults, editable later | Proposed | Flexibility without a heavy form. |
| D48 | Board rules in `src/core/board.ts`; the Durable Object only adapts them (SQLite, WebSockets, alarms) | Decided | Same code in the app and the Worker; unit tested in Node with the rest of the core. |
| D49 | Worker tests run the real runtime: Wrangler's test harness starts workerd inside Vitest | Decided | Covers SQLite, hibernation, alarms and WebSockets without mocks; `@cloudflare/vitest-pool-workers` doesn't support Vitest 5 yet. |
| D50 | One module per view in `src/app/` (gallery, workspace, items, duel, results, color), with navigation, events and state apart | Decided | Split from a 1,400-line `ui.ts` before adding published boards; code moved as is, no behavior change. |
| D51 | Board links in the URL fragment: `#/b/<alias>` to share, `#/b/<alias>?owner=<token>` for the author | Decided | Works on any static host; the token never reaches a server log and is removed from the address bar once stored. |
| D52 | The app calls the API at `/api` on its own origin (Vite proxy in dev) or `VITE_API_URL`; builds without either hide publishing | Decided | The GitHub Pages build keeps working while the API isn't deployed. |
| D53 | Never drop an owner token automatically | Decided | A board that looks gone may be a transient API error; the author chooses to go back to the local version. |
| D54 | The Worker serves the app (`assets`) and the API on one origin; the `worker` build mode sets `VITE_API_URL=/` | Decided | No CORS; one deploy. The GitHub Pages build stays without publishing until it is retired. |
| D55 | Per-IP limits with Workers rate limiting bindings: 5 publications and 120 API requests per minute | Decided | Votes and skips are also limited per connection (150 ms), item suggestions per connection (5 s). |
| D56 | Turnstile at publication, on when `TURNSTILE_SECRET` is set | Decided | Local development and tests need no key; the widget appears when `VITE_TURNSTILE_SITE_KEY` is set. |
| D57 | Items after publication: the author adds and removes, visitors suggest when allowed; removing drops the item's votes; same label refused; 2 to 100 items | Decided | Keeps every remaining vote meaningful. |
| D58 | Admin API behind a secret token (`ADMIN_TOKEN`), off when unset | Decided | Cloudflare Access for an admin page later. |
| D59 | No client-side vote batching for now | Decided | A vote costs 1/20 of a request; batching would need a longer pair queue for little gain before a board goes viral. |
| D60 | CI deploys the Worker from `main`, switched on by the `CLOUDFLARE_ACCOUNT_ID` repository variable (plus the `CLOUDFLARE_API_TOKEN` secret) | Decided | Same checks as the Pages deploy; skipped while unconfigured, so CI stays green. Wrangler creates the D1 database by name and applies migrations without prompts. |
| D61 | Custom domain and Worker secrets are managed in the Cloudflare dashboard, not in the repo | Decided | The config declares no routes, so deploys keep the dashboard's domain; secrets survive deploys. Start on a subdomain of an existing zone; a dedicated domain waits for D3. |
| D62 | Publish is the header's one colored control: the A → B gradient with a broadcast icon, last in the header after a divider; every header control is 44 px tall | Decided | It was a small pill between the score menu and the tabs, looking like a setting. On phones it sits right of the score menu, tabs below; at medium widths the title gets its own line. |
| D63 | The author can change a color item's color after publishing; its votes are dropped and it starts again from zero | Decided | Refines D44: the color is the item, so its votes were cast on the old one. No confirmation when it has no votes (a mistake seen right after publishing). With no votes, pair assignment serves it first. Items with the same color are flagged in the author panel and the color editor. |
| D64 | Once a voter has voted every pair, the result gets a page of its own, in two views (podium, you vs the crowd) switched by a discreet toggle | Decided | Opens by itself after the last vote with a reveal; switching views only fades. The chosen view is remembered in this browser (`resultView` pref), podium first. |
| D65 | "After N votes" reveals the crowd at N votes or at every pair, whichever comes first | Decided | A 6-item board has 15 pairs: with N = 20 a voter who voted everything would never have seen the crowd before closing. |

## SEO and sharing

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D66 | Every SEO fact in `build/site.ts`; head, manifest, robots.txt, sitemap and llms.txt generated from it by a Vite plugin | Decided | The steevepommier.com pattern: one source, nothing hand-copied, invariants tested (`tests/seo.test.ts`). |
| D67 | Canonical address from `VITE_SITE_URL` (CI variable `SITE_URL`), GitHub Pages by default, for both builds | Decided | One canonical while the Worker's domain isn't settled; setting the variable moves both. |
| D68 | Icons and social card drawn by a script (satori + resvg) and committed; new file names when the drawing changes | Decided | Glyphs as paths, identical on any machine; search engines and unfurlers cache images by URL. |
| D69 | Web app manifest with `display: minimal-ui` | Decided | iOS gives standalone home-screen apps their own storage, which would hide localStorage rankings; revisit with offline support. Offline is in (D77); `standalone` waits for export/import (`docs/pwa.md`). |
| D70 | Fonts self-hosted with Fontsource, first-render fonts preloaded | Decided | No third-party request on the critical path, no visitor IP sent to Google; screenshots pixel-identical to Google Fonts. |
| D71 | robots.txt allows every crawler, AI included, except `/api/`; llms.txt describes the app | Decided | Same policy as steevepommier.com. |
| D72 | JSON-LD author = `https://steevepommier.com/#person` | Decided | The same `@id` on both sites joins them into one entity; the full profile stays there. |

## Local rankings

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D73 | The end of a local ranking is announced: when a duel completes the exact sort, or first brings a rating method to full stability, the duel pane shows a short celebration and a bar that empties, then the Ranking tab opens by itself | Decided | "Stay here" stops the countdown; rating methods also offer "Keep dueling". No countdown under `prefers-reduced-motion`. |
| D74 | The Ranking tab has a discreet switch between the podium and lines comparing the ranking's method with another one on the same duels | Decided | No crowd locally, so the lines compare methods (the comparison table stays below). Exact sort is offered only once these duels complete it. Remembered in `rankView`; the lines code is shared with the end-of-vote page (`slope.ts`). |

## App platform

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D75 | Web first: Versus is a web app, made installable and offline as a PWA; native apps, if store presence is ever wanted, come as a Capacitor shell around the same web app | Decided | The web is the main platform and the stores aren't wanted for now. Expo + React Native Web was considered (one codebase, true native UI) and set aside to keep the app light, with few dependencies. Known PWA limits on iOS: no app links, push only for home-screen apps. |
| D76 | Hand-written service worker (`src/sw/sw.ts`); a small Vite plugin builds it as `sw.js` and writes in the files to precache and a version derived from their content | Decided | About 80 lines, no Workbox or vite-plugin-pwa (D75: few dependencies). Every deploy that changes the app changes the worker, so browsers pick it up. |
| D77 | Offline-first app shell: the page, script, styles, latin fonts, manifest and icon are stored at install and served from the cache; other font subsets are stored on first use | Decided | The app opens instantly and without a network. The API, WebSockets, other origins and every other file (robots.txt, images for sharing) never go through the worker. Only the scope's root is served from the cache: routes live in the fragment (D51). |
| D78 | A new version is offered, never forced: a bar above the header with Reload and Later | Decided | Reloading on its own could interrupt a duel or a form. Later lets the new version start once every tab is closed. An open app checks for a new version when it comes back to the foreground, at most hourly. |
| D79 | Our own install button, shown only when the browser offers installation (Chromium, desktop and Android); persistent storage requested only in the installed app | Decided | iOS has no install prompt and keeps `minimal-ui` (D69). Asking for persistent storage in a tab would show a prompt in Firefox; installed apps get it silently. |
| D80 | Canonical address: https://versus.steevepommier.com/ by default, for both builds | Decided | The Worker's domain is live; audits flagged a canonical pointing to github.io. `SITE_URL` still overrides it. |
| D81 | The page text lives in the static HTML (h1, how it works, methods, privacy, links) and closes the gallery in the visitor's language | Decided | Crawlers without JavaScript saw 3 words and no heading. One h1 either way: the static copy's, or "Your rankings" once the app runs. |

## Home page

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D82 | A home page of its own at the site's root, the app under `app/` | Decided | The owner's choice over a welcome banner in the gallery (two mock-ups compared): a showcase with animated, playable demos, and a static page search engines can index with all its keywords. Pre-rendered at build time (`src/landing/markup.ts`), so every word and the first frame of every demo are in the HTML; a small script animates it. The app's static text (D81) stays for the app's own page. |
| D83 | One URL per language: English at `/` (x-default), French at `/fr/`, linked by hreflang in the head and the sitemap | Decided | The app keeps one URL and switches by itself; a home page meant for search needs one address per language. Each page has its own title, description, canonical, `og:locale`, JSON-LD page node and social card (`og.png`, `og-fr.png`). |
| D84 | No redirect by browser language; a language chosen explicitly is remembered and honored | Decided | Google advises against redirecting on the browser language (its crawler has none), and a shared link should open in the language it was shared in. A visitor whose browser prefers the other language gets a dismissible bar, in that language. A choice made on the page's switcher or in the app (`versus-prefs.lang`, shared with the app) sends visitors arriving from elsewhere to their language before the first paint. Switcher: the app's EN/FR pill in the header, full names in the footer. |
| D85 | The app's page is `noindex, follow` and out of the sitemap; the manifest opens `app/` and keeps `id: ./` | Decided | The app renders everything with JavaScript and would compete with the home pages. Keeping the manifest id makes installed copies the same app. An app installed before (it opens `/`) and old links whose route is in the fragment (`/#/b/<alias>`) are sent to the app before the first paint. The service worker stays at the root and covers the home pages, network first. |
| D86 | The hero demo is scripted with a virtual pointer, then calm: three duels whose clicks alternate sides, and "a few duels later" settles the rest in one movement | Decided | The first version played the remaining duels as a burst of rapid picks on the same spot; the owner found it looked like a slot machine or a bug. Six pastries instead of eight, so stability comes sooner. It runs only on screen, never under reduced motion, pauses with the page's pause button (WCAG 2.2.2), and any click, tap or swipe hands it to the visitor. |
| D87 | The home page's texts live in their own dictionaries (`src/i18n/landing-*.ts`) and borrow the app's words for what the demo reproduces | Decided | Parity and placeholders are tested like the app's. The page's script gets the texts it needs as JSON in the page, so no dictionary reaches a bundle. Demos use the app's scoring (`src/core`); pastries are drawn as inline SVG symbols, same drawing for chocolatine and pain au chocolat on purpose. |
| D88 | Modules the Vite config reaches (`build/` → `src/landing/markup.ts` → `src/core`, `src/i18n`) import each other with their `.ts` extension | Decided | Vite warns that extensionless imports won't load with its native config loader, planned as the default. The Worker's tsconfig allows the extension too. |
