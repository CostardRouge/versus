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
| D44 | Items are locked once published (deleting and adding stay possible) | Superseded (D116) | Editing an item would betray its votes. |
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
| D63 | The author can change a color item's color after publishing; its votes are dropped and it starts again from zero | Superseded (D116) | Refines D44: the color is the item, so its votes were cast on the old one. No confirmation when it has no votes (a mistake seen right after publishing). With no votes, pair assignment serves it first. Items with the same color are flagged in the author panel and the color editor. |
| D64 | Once a voter has voted every pair, the result gets a page of its own, in two views (podium, you vs the crowd) switched by a discreet toggle | Decided | Opens by itself after the last vote with a reveal; switching views only fades. The chosen view is remembered in this browser (`resultView` pref), podium first. |
| D65 | "After N votes" reveals the crowd at N votes or at every pair, whichever comes first | Decided | A 6-item board has 15 pairs: with N = 20 a voter who voted everything would never have seen the crowd before closing. |
| D82 | Boards a visitor voted on get a card under "Your votes", a gallery section of its own between their rankings and the demos; first when they have no ranking of their own | Decided | Chosen from mockups of four layouts: filters hide half the content and feel heavy with a few cards; one mixed grid blurs ownership (delete here, forget there); a "continue" shelf drops finished boards. Filters can come later if the lists grow. The card appears at the first vote, never shows more than the board, and "Forget" only removes the card, with Undo. |
| D83 | Cards are refreshed by one request for all of them (`POST /api/summaries`, 24 boards at most), at most once a minute, and keep a snapshot in `versus-joined` | Decided | One Durable Object call per board, no per-card requests. The voter id stays out of URLs. The snapshot lets cards read offline and after a board is gone, and remembers what the voter saw to flag what's new. |
| D116 | The author edits a published board in the workspace of a local ranking, with the same items pane: names editable in the list, the same add field (a pasted list, #hex codes, the color picker, images through review), the title in the header, the method in the score menu (Exact sort greyed out), and the board's settings, links, close and withdraw behind the header's Published button. Any item can be renamed or recolored: without votes at once; with votes, the author says whether they stay (a correction, checked first for a name) or go and the item starts again from zero (another choice, checked first for a color). Removing an item without votes needs no confirmation and can be undone; a closed vote freezes the list and says how to reopen it. Visitors keep the board page, with the same add field to suggest an item | Decided | The owner couldn't fix a typo nor find where to add a name on a board he had published: the field sat at the bottom of a folded "Author settings" panel, under the duel on a phone, and renaming was impossible even without a vote. Chosen from mockups of three layouts (the same workspace, a drawer, editing the crowd's list in place): only the first keeps the items where they were before publishing and puts them one tab away on a phone. Replaces D44 and D63: renaming "Pizza" to "Sushi" with its votes is the author's call on their own board, and the question is asked when it matters. Voters aren't told of a rename. The server takes `PATCH /items/:id` with `{ label?, fill?, reset }` (a color alone still resets, for apps from before) and a list in one `POST /items` (`{ items }`). |

## SEO and sharing

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D66 | Every SEO fact in `build/site.ts`; head, manifest, robots.txt, sitemap and llms.txt generated from it by a Vite plugin | Decided | The steevepommier.com pattern: one source, nothing hand-copied, invariants tested (`tests/seo.test.ts`). |
| D67 | Canonical address from `VITE_SITE_URL` (CI variable `SITE_URL`), GitHub Pages by default, for both builds | Decided | One canonical while the Worker's domain isn't settled; setting the variable moves both. |
| D68 | Icons and social card drawn by a script (satori + resvg) and committed; new file names when the drawing changes | Decided | Glyphs as paths, identical on any machine; search engines and unfurlers cache images by URL. |
| D69 | Web app manifest with `display: minimal-ui` | Superseded (D98) | iOS gives standalone home-screen apps their own storage, which would hide localStorage rankings; revisit with offline support. Offline is in (D77); `standalone` waits for export/import (`docs/pwa.md`). |
| D70 | Fonts self-hosted with Fontsource, first-render fonts preloaded | Decided | No third-party request on the critical path, no visitor IP sent to Google; screenshots pixel-identical to Google Fonts. |
| D71 | robots.txt allows every crawler, AI included, except `/api/`; llms.txt describes the app | Decided | Same policy as steevepommier.com. |
| D72 | JSON-LD author = `https://steevepommier.com/#person` | Decided | The same `@id` on both sites joins them into one entity; the full profile stays there. |

## Local rankings

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D73 | The end of a local ranking is announced: when a duel completes the exact sort, or first brings a rating method to full stability, the duel pane shows a short celebration and a bar that empties, then the Ranking tab opens by itself | Decided | "Stay here" stops the countdown; rating methods also offer "Keep dueling". No countdown under `prefers-reduced-motion`. |
| D74 | The Ranking tab has a discreet switch between the podium and lines comparing the ranking's method with another one on the same duels | Decided | No crowd locally, so the lines compare methods (the comparison table stays below). Exact sort is offered only once these duels complete it. Remembered in `rankView`; the lines code is shared with the end-of-vote page (`slope.ts`). |
| D97 | A list typed, pasted or dropped in the add field adds all its items at once, read by `core/list.ts`: line breaks and their `\n` escapes, Markdown and word-processor lists (bullets, numbers, task boxes, inline Markdown removed; the lines around a list left out), a spreadsheet row, a JSON array. Labels already in the ranking are skipped, and the toast can undo the whole list | Decided | The owner asked for quick multi-item input without cluttering the interface. No dialog with a larger text box for now: the field already takes the whole list and Undo covers a wrong paste; a dialog would add a preview and editing before adding, worth it if people type long lists by hand on a phone. A single line stays as written ("1. Paris", "- foo"); commas don't split ("Paris, France"). |

## App platform

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D75 | Web first: Versus is a web app, made installable and offline as a PWA; native apps, if store presence is ever wanted, come as a Capacitor shell around the same web app | Decided | The web is the main platform and the stores aren't wanted for now. Expo + React Native Web was considered (one codebase, true native UI) and set aside to keep the app light, with few dependencies. Known PWA limits on iOS: no app links, push only for home-screen apps. |
| D76 | Hand-written service worker (`src/sw/sw.ts`); a small Vite plugin builds it as `sw.js` and writes in the files to precache and a version derived from their content | Decided | About 80 lines, no Workbox or vite-plugin-pwa (D75: few dependencies). Every deploy that changes the app changes the worker, so browsers pick it up. |
| D77 | Offline-first app shell: the page, script, styles, latin fonts, manifest and icon are stored at install and served from the cache; other font subsets are stored on first use | Decided | The app opens instantly and without a network. The API, WebSockets, other origins and every other file (robots.txt, images for sharing) never go through the worker. Only the scope's root is served from the cache: routes live in the fragment (D51). |
| D78 | A new version is offered, never forced: a bar above the header with Reload and Later | Decided | Reloading on its own could interrupt a duel or a form. Later lets the new version start once every tab is closed. An open app checks for a new version when it comes back to the foreground, at most hourly. |
| D79 | Our own install button, shown only when the browser offers installation (Chromium, desktop and Android); persistent storage requested only in the installed app | Decided | iOS has no install prompt and keeps `minimal-ui` (D69). Asking for persistent storage in a tab would show a prompt in Firefox; installed apps get it silently. |
| D97 | Export and import as a JSON file (`format: versus`, `version: 1`): a backup of everything but the demos (rankings, owner tokens, "Your votes", voter id), or one ranking to send, without its board link | Decided | No account: the file is how rankings move between browsers and devices, and into the iOS home-screen app. Export all sits under the gallery's rankings, export one in a ranking's results; a file can also be dropped anywhere. When the backup holds owner tokens, the app says the file gives control of the published boards. |
| D98 | Manifest `display: standalone`, replacing `minimal-ui` (D69) | Decided | The iOS home-screen icon now opens an app window instead of Safari. That window keeps its own storage: while it holds nothing, the gallery explains how to bring the rankings from Safari (export there, import here). Android and desktop keep the browser's storage. |
| D99 | An import never replaces anything: a ranking whose id is free keeps it, one that differs from the local version comes in as a copy, an identical one is skipped; missing owner tokens and cards are added; the file's voter id is taken only by a browser that has neither voted nor published | Decided | Importing twice, or an older file, can't lose work. Keeping the id keeps a ranking's address (`r/<id>`) from one device to the other. The voter rule keeps one voice per pair for votes already cast. |
| D100 | An imported file is untrusted input: only image data URLs (and the picture addresses published boards use, under the server's own rule), valid hex colors and duels on known items come in; a "Your votes" card with anything edited is dropped; a file from a newer version is refused | Decided | Labels are escaped at rendering, but images and fills reach `src` and `style`: they are checked in `src/core/backup.ts`. Refusing a newer file beats reading it halfway. |
| D101 | Export goes through the share sheet on touch devices, a download elsewhere | Decided | The share sheet has Save to Files, AirDrop and messages; a download is easy to lose on a phone, and the iOS home-screen app can't show one. |
| D118 | Images live in IndexedDB (database `versus`, store `images`); localStorage keeps a reference, `idb:<key>`, the key coming from the image's content | Decided | localStorage holds about 5 MB, a few dozen photos; IndexedDB holds far more (120 photos, 26 MB, tested). In memory an image stays a data URL, so rendering, export and duplication are unchanged. Identical images (a copied ranking) are stored once. A reference is written only once IndexedDB holds the image: a new image is written inline first, stored, then the rankings are written again. Without IndexedDB, images stay inline, as before. |
| D119 | At startup, references are read from IndexedDB before the first render; one that can't be read stays a reference and the item shows its label | Decided | Cards never appear without their images, and nothing is lost: the reference is saved again unchanged. Images saved inline before D118 move to IndexedDB on the first load. |
| D120 | Images no ranking uses are removed a few seconds after startup, once stored for more than a day | Decided | Deleting an item or a ranking frees its image at the next start. The day of grace covers another open tab about to save a reference to an image it just stored. |
| D80 | Canonical address: https://versus.steevepommier.com/ by default, for both builds | Decided | The Worker's domain is live; audits flagged a canonical pointing to github.io. `SITE_URL` still overrides it. |
| D81 | The page text lives in the static HTML (h1, how it works, methods, privacy, links) and closes the gallery in the visitor's language | Decided | Crawlers without JavaScript saw 3 words and no heading. One h1 either way: the static copy's, or "Your rankings" once the app runs. |

## Home page

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D84 | A home page of its own at the site's root, the app under `app/` | Decided | The owner's choice over a welcome banner in the gallery (two mock-ups compared): a showcase with animated, playable demos, and a static page search engines can index with all its keywords. Pre-rendered at build time (`src/landing/markup.ts`), so every word and the first frame of every demo are in the HTML; a small script animates it. The app's static text (D81) stays for the app's own page. |
| D85 | One URL per language: English at `/` (x-default), French at `/fr/`, linked by hreflang in each page's head | Decided | The app keeps one URL and switches by itself; a home page meant for search needs one address per language. Each page has its own title, description, canonical, `og:locale`, JSON-LD page node and social card (`og.png`, `og-fr.png`). |
| D86 | No redirect by browser language; a language chosen explicitly is remembered and honored | Decided | Google advises against redirecting on the browser language (its crawler has none), and a shared link should open in the language it was shared in. A visitor whose browser prefers the other language gets a dismissible bar, in that language. A choice made on the page's switcher or in the app (`versus-prefs.lang`, shared with the app) sends visitors arriving from elsewhere to their language before the first paint. Switcher: the app's EN/FR pill in the header, full names in the footer. |
| D87 | The app's page is `noindex, follow` and out of the sitemap; the manifest opens `app/` and keeps `id: ./` | Decided | The app renders everything with JavaScript and would compete with the home pages. Keeping the manifest id makes installed copies the same app. An app installed before (it opens `/`) and old links whose route is in the fragment (`/#/b/<alias>`) are sent to the app before the first paint. The service worker stays at the root and covers the home pages, network first. |
| D88 | The hero demo is scripted with a virtual pointer, then calm: three duels whose clicks alternate sides, and "a few duels later" settles the rest in one movement | Decided | The first version played the remaining duels as a burst of rapid picks on the same spot; the owner found it looked like a slot machine or a bug. Six pastries instead of eight, so stability comes sooner. It runs only on screen, never under reduced motion, pauses with the page's pause button (WCAG 2.2.2), and any click, tap or swipe hands it to the visitor. |
| D89 | The home page's texts live in their own dictionaries (`src/i18n/landing-*.ts`) and borrow the app's words for what the demo reproduces | Decided | Parity and placeholders are tested like the app's. The page's script gets the texts it needs as JSON in the page, so no dictionary reaches a bundle. Demos use the app's scoring (`src/core`); pastries are drawn as inline SVG symbols, same drawing for chocolatine and pain au chocolat on purpose. |
| D90 | Modules the Vite config reaches (`build/` → `src/landing/markup.ts` → `src/core`, `src/i18n`) import each other with their `.ts` extension | Decided | Vite warns that extensionless imports won't load with its native config loader, planned as the default. The Worker's tsconfig allows the extension too. |
| D91 | The sitemap stays in the plain format; hreflang is declared in the heads only | Decided | The first home page deploy added `xhtml:link` alternates to the sitemap: browsers then render it as an XHTML document, a nearly blank page, instead of showing the XML, and the owner saw a blank page. Google reads hreflang from the head tags as well as from a sitemap, and one declaration is enough. |
| D92 | Every view of the app has a real path under `app/`: `demo/<slug>` for a demo (`/ranking`, `/items` for its tabs), `r/<id>` for a ranking of this browser, `b/<alias>` for a published board; the author's token stays in the fragment (`#owner=…`) | Decided | The owner asked for explicit addresses: opening a demo didn't change the URL, so nothing could be bookmarked or shared. Replaces D51's fragment links, which still open and are rewritten. Back and Forward follow the views; tabs replace the entry instead of adding one. The app page's `<base>` (written at build time from `VITE_BASE_PATH`) names its folder, so relative addresses hold at any depth, the browser's preload scanner included. Served by the Worker (the app page for `/app/*`, a 404 page otherwise), the service worker (the stored page for `app/*`), the dev and preview servers, and on GitHub Pages by `404.html`, which keeps the path in `sessionStorage` and opens the app. A ranking of another browser falls back to the gallery with a message. Board paths also open the way to per-board social cards. |
| D115 | A discreet link back to the home page in the app's footer (the line closing the gallery, before the author, the source and the legal notice), to the home page of the app's language; the home page no longer sends a visitor who comes from the app back to the installed app | Decided | The owner noticed there was no way back to the showcase. Discreet on purpose: the app must not lose the people using it, so no header link. No condition is needed: that footer is the app's own (the home and legal pages have theirs, which link to the app). In the installed app the home page used to redirect to the app at once (it is how apps installed before the home page find the app); it now does so only when the visitor didn't come from another page of the site, so the link works in the app window too. |

## Audience measurement and legal notice

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D93 | Visits are counted with Umami, self-hosted by the author on the instance that measures steevepommier.com and vanessagedeon.com, with Versus's own website id; both hosts report (the Worker's domain and the GitHub Pages copy) | Decided | No cookie, so no consent banner; the alternatives were weighed on steevepommier.com. The tracker comes from `insight.steevepommier.com`, the same site as `versus.steevepommier.com`. Details: `docs/analytics.md`. |
| D94 | The page's script loads the tracker, only for a visitor who hasn't said no (the switch, Do Not Track, Global Privacy Control), asynchronously, automatic tracking off; views and events are sent with the page's path on the site, ids and aliases replaced (`/app/r/:id`, `/app/b/:alias`), never a fragment | Decided | Better than the two other sites: someone who declines never contacts the server, GPC is honored, a slow server can't delay the app, and the author's key (D92) can't reach the dashboard, which Umami's automatic tracking would have recorded with the hash. |
| D95 | A few anonymous events for what views can't show: ranking created and finished, board published, first vote and every pair voted on a board, app installed, the chocolatine pick | Decided | Their data is never user content (method, visibility, counts, flags). The legal notice lists them; changing one means changing its text too. |
| D96 | A legal notice in each language, `/legal/` and `/fr/mentions-legales/`, pre-rendered, indexed, linked from the home page's footer and the app's page text; it carries the measurement switch | Decided | LCEN art. 6-III asks for one even from a non-professional publisher; Versus also stores published rankings and counts visits. The switch sits beside the explanation, since the app has no settings panel. |

## Sharing results and links

Discussed on 2026-09-30, after a look at the competition (sorters, tier lists, brackets, survey tools, Beli, LMArena): the format is proven, and what none of them has is a duel one shares and a result one compares with a crowd's. Sharing an image is what makes tier lists travel.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D102 | A result is shared as an image drawn by the browser on a canvas (`src/app/share.ts`), in the app's fonts and tokens, in three formats: post 4:5, story 9:16, landscape 1.91:1; from the Ranking tab (my ranking), the board page (the crowd, as I may see it), the end-of-vote page (me facing the crowd, with the agreement) and a duel (its two cards) | Decided | No renderer on the server: the free plan's 10 ms of CPU can't draw an image, and the browser already has the fonts. satori and resvg stay a build-time tool for the site's cards. The palette comes from the CSS tokens (dark theme included); tests run against a fake canvas. |
| D103 | The share panel offers the system share sheet (Web Share API, the image as a file and the message with the link), copying the message, copying the image, downloading it | Decided | Sharing goes through the person's own accounts: Versus posts nothing. Firefox on desktop has no share sheet, hence the other three. The image is drawn when the panel opens, not on the click: Safari drops a share that waits too long after the tap. Instagram keeps the image and drops the text, WhatsApp keeps both: the link is in the message and on the image. |
| D104 | A board's link previews (Open Graph) show the board: the Worker rewrites the app page's head for `/app/b/<alias>` (title, description in the board's language, `og:image`) with the landscape card the app drew and sent (`PUT /api/boards/:alias/card`, R2 bucket `versus-images`, served under `/og/b/…/<version>.png`); a duel link (`?duel=a.b`) gets a card of its two items | Decided | The card is uploaded at publication and each time someone shares from the app, so it follows the standings; the version in its address defeats the networks' caches. Only a 1200×630 PNG under 400 KB for a board that exists, 40 duel cards per board at most, rate limited like the rest of the API, deleted with the board; the admin can take the board down. Without the bucket (local tools, a fork), links keep the site's card. The board's language is stored at publication (`lang`, English for older boards). |
| D105 | A duel link opens the board on that duel: `?duel=<a>.<b>`, sent in `hello` and served first by the server when the voter can still vote on it; the query leaves the address once the board is open | Decided | A shared duel that opened on another pair would disappoint. The server decides, so the rule holds for every client: pair on the board, not voted yet, board open. |
| D106 | "Make my own" on a board, its end-of-vote page and its card under Your votes: a ranking of this browser with the board's title and items, no votes | Decided | The loop the competition analysis called the figure to watch: a voter becoming an author. The author, who has the ranking, doesn't see the button. Counted as `ranking-created` from `board` or `card`. |
| D117 | The share panel offers the pictures of the view it comes from, and opens on the one on screen: the Ranking tab's podium or its lines comparing two methods (a card of its own, `compare`), the end-of-vote page's crowd podium, the voter's podium or the voter facing the crowd (the crowd's two only while it is visible). The picked picture changes the card and its message; the format stays | Decided | The owner shared from the podium and got the lines, with no way to choose. Following the screen saves a click in the common case; the switch above the formats covers the rest. Pages with one view (a board, a duel) show no switch. Upright lines cards grow their rows to fill the card when there are few items. |

## Moderation

Discussed on 2026-09-30 with the sharing work: a site that promotes what strangers publish (link previews, soon public templates and a Popular section) needs a way to report, to hide and to take down before it needs anything else.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D107 | A moderation page at `/admin/`, built with the site (`src/admin/`), that calls the Worker's admin routes with the `ADMIN_TOKEN` typed on it and kept in the tab's session storage; `noindex, nofollow`, `Disallow` in robots.txt, out of the service worker's precache, no audience measurement | Decided | The admin API existed for curl; a page makes moderation a two-minute chore from a phone. The token stays the gate (Cloudflare Access in front of `/admin/*` and `/api/admin/*` is the owner's step, `docs/online-architecture.md#moderation`). Its own small dictionary (`src/i18n/admin.ts`, EN/FR by browser language): the app's messages don't ship with it, nor its with the app. |
| D108 | Two admin flags per board, `hidden` and `featured`, stored in the board and mirrored in the D1 registry; hidden boards keep working for whoever has the link but stay out of every public list, featured ones come first there | Decided | Hiding is the gentle takedown: a borderline board loses its promotion, not its voters. Voters' views never carry the flags. Neither flag counts as activity for the TTL. The lists themselves (Popular, templates, sitemap) come with the next stage. |
| D109 | Visitors report a board from its page (a reason from a list, an optional note, their anonymous voter id): one report per voter, 200 voters per board at most, stored in the board and counted in the registry; the admin page lists reported boards first and clears the reports once reviewed | Decided | Anonymous, so no reply to the reporter; the legal notice says what a report sends. Not an activity for the TTL either. Authors don't see the button on their own board. |

## Official templates and public lists

Discussed on 2026-09-30 with the launch plan: the competition analysis found that what travels is a debate everyone recognizes (Mac or PC, iPhone or Android, the best console), and what search engines index is a real page. Versus had neither: boards lived behind shared links, and the app was `noindex`.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D110 | Official templates (`src/core/templates.ts`): fixed lists on divisive topics, each published by the Worker as a real board per language the first time its page or the Popular list asks for it (`official`, never expiring, the site as author, Balanced, results always visible), with a page of its own at `/t/<slug>/` and `/fr/t/<slug>/` rendered by the Worker into the legal page's shell (title, intro, the crowd's ranking as text with each item's win share, the way to the board, the other templates, hreflang, JSON-LD `ItemList`) | Decided | Real boards, so voting, sharing, link previews and "Make my own" come for free; real pages, so search engines have text to index. Lazy publication avoids an admin step and a race is settled by the registry's unique index (one board per template and language). The legal shell keeps the home page's header and footer without touching the home page (minimal changes there was the brief). Pages are `noindex` until 30 voters (`TEMPLATE_INDEX_VOTERS`): a page with no crowd is a thin page. Fixed data in EN and FR, like the demos. |
| D111 | A Popular section in the gallery (`GET /api/popular?lang`): the boards the admin featured and the official templates of the app's language, the liveliest first (votes of the last 7 days, then voters), never a hidden board; each card votes, copies the link or makes a ranking of one's own from the board's items | Decided | Only curated boards are listed: a board someone published for their friends is not a public list entry, hidden or not. The registry carries what the cards need (counts, the crowd's top three, the template key) so no board wakes for the list; the row is refreshed at each new voter up to 100, then once a day. Fetched at most every ten minutes, nothing stored. "Start from a template" is the card's "Make my own". |
| D112 | The sitemap is completed by the Worker (`run_worker_first` for `/sitemap.xml`): the static pages from the build plus the template pages that have a crowd, with the day of their last activity | Decided | The static sitemap and the page's robots meta must agree: a template page enters the sitemap exactly when it stops being `noindex`. The Worker reads the static file from the assets binding and appends, so the build keeps owning the static entries and the canonical host. |

## Pictures on published boards

Discussed on 2026-09-30: the owner wants pictures on published boards eventually, on his R2, but off by default for new users and never shown before someone looked at them.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D113 | Pictures reach a published board only through review: the publish request announces them (`pic: 'pending'`, never the bytes), the app then sends each one (`PUT /api/boards/:alias/items/:id/image`, the author's token, a JPEG under 250 KB) to R2 (`img/<alias>/<item>.jpg`, state `pending`); the item shows as text until the admin approves it from the moderation page, after which the picture is public at `/img/b/<alias>/<item>.jpg`; refused, it is deleted and the author sees why | Decided | A picture nobody looked at never shows: the legal and safety line the owner asked for. The app keeps downsizing to 640 px JPEG, so a board of a hundred pictures weighs a few megabytes. The item's `pic` state travels in the board view (the items list explains it); voters' views carry no picture until approval. The pictures go with their item and with the board. |
| D114 | Off by default: the server's `IMAGES_UPLOAD` variable (`review` to enable) decides, and `GET /api/config` tells the app before the publish modal, which keeps refusing rankings with images otherwise; the site's own boards may carry picture addresses directly (`direct` policy, official templates) | Decided | New users meet a text-and-colors product; the owner turns pictures on when the queue is worth his time. One variable, no per-user flag yet: a condition per author (an account, a track record) is the next step if ever needed. Visitors adding items never carry pictures. |
