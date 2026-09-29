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
| D24 | Vite + TypeScript, no framework | Decided | Ported from the single-file prototype; small bundle (~20 kB gzip JS). |
| D25 | Pure `src/core` shared by UI and future backend | Decided | Enables running the same scoring on a Cloudflare Worker. |
| D26 | Biome, strict TS, Vitest with a 90% coverage floor on `src/core` | Decided | Plus a jsdom smoke test of the whole app. |
| D27 | Single CI workflow; deploy to GitHub Pages from `main` only after checks pass | Decided | Relative `base: './'`, so the build works under `/versus/`. Dependabot weekly for npm and actions; `@types/node` majors ignored to match Node 22. |
| D28 | MIT license | Decided | © 2026 Steeve Pommier. |

## Going online

See `docs/online-architecture.md`.

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| D29 | The bottleneck is architecture and hosting cost, not language speed | Proposed | Estimated load for hundreds of thousands of users is a few hundred messages/s at peak; Node/TS handles that easily. |
| D30 | Cloudflare (static front + Workers + one Durable Object per shared board + R2 for images), TypeScript end to end | Proposed | Free tier covers the experiment; $5/month paid plan beyond. Keeps one language and shares `src/core`. |
| D31 | Stay local-first; only shared boards hit the server | Proposed | Main cost lever. |
| D32 | Plan B: self-host on the home Optiplex behind Cloudflare Tunnel | Proposed | Free, fine for a private beta, not for viral traffic. |
