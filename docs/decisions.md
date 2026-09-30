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
| D24 | Vite + TypeScript, no framework | Decided | Ported from the single-file prototype; small bundle (~20 kB gzip JS). A POC speed choice, not a principle: open to a UI framework (see D54). |
| D25 | Pure `src/core` shared by UI and future backend | Decided | Enables running the same scoring on a Cloudflare Worker. |
| D26 | Biome, strict TS, Vitest with a 90% coverage floor on `src/core` | Decided | Plus a jsdom smoke test of the whole app. |
| D27 | Single CI workflow; deploy to GitHub Pages from `main` only after checks pass | Decided | Relative `base: './'`, so the build works under `/versus/`. Dependabot weekly for npm and actions; `@types/node` majors ignored to match Node 22. |
| D28 | MIT license | Decided | © 2026 Steeve Pommier. |
| D54 | Native apps (iOS, Android) next to the web app, with app links and push notifications | Open | Candidates: Expo + React Native Web (one codebase for web and native), Capacitor (the current web app in a native shell), PWA (no app links and limited push on iOS). Code is written by Claude Code, so rewrite size isn't the criterion; the owner's time (device testing, stores) and product quality are. App links need a custom domain and path URLs (`/b/<alias>`) instead of D51's fragment. |

## Going online

See `docs/online-architecture.md`.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D29 | The bottleneck is architecture and hosting cost, not language speed | Proposed | Estimated load for hundreds of thousands of users is a few hundred messages/s at peak; Node/TS handles that easily. |
| D30 | Cloudflare (static front + Workers + one Durable Object per shared board + R2 for images later), TypeScript end to end | Proposed | Free tier covers the experiment; $5/month paid plan beyond. Keeps one language and shares `src/core`. |
| D31 | Stay local-first; only shared boards hit the server | Proposed | Main cost lever. |
| D32 | Plan B: self-host on the home Optiplex behind Cloudflare Tunnel | Proposed | Free, fine for a private beta, not for viral traffic. |
| D33 | Board registry in D1 for the admin view | Proposed | Durable Objects can't be listed with their data. Updated at most once a day per board. |
| D34 | Move the front from GitHub Pages to Cloudflare when the backend lands | Proposed | Same origin as the API (no CORS), custom domain. |

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
