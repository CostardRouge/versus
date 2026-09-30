# Roadmap

Last updated 2026-09-30.

## Done

- Prototype as a claude.ai artifact, then ported to this repo (Vite + TS).
- Gallery, workspace with live-sorted items, duel stage (swipe, tap, buttons, keyboard, undo, skip, tie), results with podium and method comparison.
- Four scoring methods (Balanced/BT default, Dynamic/Elo, Simple/win rate, Exact sort), switchable per ranking.
- Items: text, images (drop, paste, file picker), solid colors and gradients; `#hex` paste; color editor popover; lists pasted, typed or dropped at once (plain, Markdown, spreadsheet row, JSON), duplicates skipped, undo (D97).
- Fixed demos with reset, duplicate and hide.
- EN/FR with switcher; light/dark/system theme switcher.
- localStorage persistence with migration from prototype keys.
- Repo tooling: Biome, strict TS, Vitest (233 tests), CI, GitHub Pages deploy, Cloudflare deploy job (off until configured), Dependabot, MIT license, README.
- Published board model agreed (lifecycle, one voice per pair, visibility modes, live updates): `docs/published-boards.md`.
- `src/app/ui.ts` split into view modules (gallery, workspace, items, duel, results, color popover), navigation, events and shared state; no behavior change.
- Published boards in the app: publish modal (warning, author votes, visibility, method with Exact sort greyed out, more options), board page (server-assigned duels, live crowd ranking with its toggle, hidden states, neck and neck, agreement, undo and clear), author panel (settings, close/reopen, admin link, withdraw into a local copy), share links in the URL fragment, gallery badge. Works against `npm run worker:dev`; hidden in production builds until the API is deployed.
- Backend prototype in `worker/`: Worker router + one Durable Object per published board (SQLite, hibernatable WebSockets, TTL alarm). Publish, public view, server-assigned pairs, votes, undo and reset, visibility enforced by the server, author settings, close/reopen, withdraw with a local copy. Rules in `src/core/board.ts`; end-to-end tests in workerd. Not deployed.
- Header: Publish restyled as the one colored control (A → B gradient), placed last; header controls aligned at 44 px.
- Published boards: the author changes a color item's color from the author panel; its votes are dropped and it starts again from zero. Same colors flagged.
- End of a local ranking: an announcement (confetti, a bar that empties) after the duel that completes the exact sort or first reaches full stability, then the Ranking tab by itself; the Ranking tab switches between the podium and lines comparing two methods.
- End-of-vote page: once a voter has voted every pair, their result on a page of its own with a reveal, as a podium or as their ranking facing the crowd's (toggle, remembered); blind boards keep the crowd for the closing. "After N votes" now also reveals at every pair.
- SEO pass, ported from steevepommier.com (`docs/seo.md`): head generated from `build/site.ts` (canonical, robots, Open Graph, X card, JSON-LD graph), 1200×630 social card, favicons for Google, iOS and Android (ico, SVG, 96/192/512, maskable, apple-touch), web app manifest, robots.txt, sitemap, llms.txt, `<noscript>` fallback, Cloudflare headers; fonts self-hosted and preloaded.
- Installable, offline app (PWA, `docs/pwa.md`): hand-written service worker precaching the app at build time, new versions offered with Reload / Later, install button when the browser offers one, persistent storage for the installed app.
- Backend completed: items added and removed after publication (author, and visitors when allowed, 5 s apart; removing drops the item's votes), D1 registry and admin API (list, totals, inspect, close, remove an item, take down), per-IP rate limits, optional Turnstile at publication, the app served by the same Worker (`npm run worker:dev` runs the whole thing on :8787).
- SEO audit fixes (SEOptimer, Seobility): canonical on versus.steevepommier.com, a 55-character title, and the page text (how it works, the four methods, privacy, links) in the static HTML with a single h1, shown under the gallery in the visitor's language.
- Your votes: published boards a visitor voted on get a card in their gallery (own section, first for someone with no ranking of their own), refreshed in one request, with what changed since their last visit; forget with undo, keep a copy of a withdrawn board (`docs/published-boards.md#your-votes-the-voters-gallery`).
- Home page (D84 to D90): a showcase at `/` in English and `/fr/` in French, pre-rendered for search engines (hreflang, bilingual sitemap, a social card per language), with a hero demo played by a virtual pointer, the use cases, how it works, a playable demo on six topics, the four methods on the same duels, the crowd (Worker build) and the chocolatine question. The app moved to `/app/` (`noindex`); installed apps and old links follow.
- Real addresses in the app (D92): `/app/demo/destinations`, `/app/demo/destinations/ranking`, `/app/r/<id>`, `/app/b/<alias>`; Back and Forward follow the views, old `#/b/` links still open, GitHub Pages included (`404.html`).
- Audience measurement and legal notice (D93 to D96, `docs/analytics.md`): self-hosted Umami, loaded only for visitors who don't decline (switch, Do Not Track, Global Privacy Control), views with ids stripped and a few anonymous events; `/legal/` and `/fr/mentions-legales/` with publisher, hosting, privacy and the measurement switch.
- Sharing (D98 to D102): a result drawn as an image in the browser (post, story, landscape) from the Ranking tab, a board, a duel and the end-of-vote page (me facing the crowd), handed to the system share sheet with the message and the link, or copied or downloaded; link previews of boards and duels with their own title, description and card (drawn by the app, stored in R2, head rewritten by the Worker); duel links that open on their duel; "Make my own" from a board or a card under Your votes.

## Next (suggested order)

1. **PWA, next steps** (web first, D75): export/import then `standalone`, images in IndexedDB, share target, native share sheet; list and order in `docs/pwa.md`.
2. **Deploy**: the CI job is ready; it needs an API token and the account ID in the repository, then the Worker secrets and a custom domain (steps in `docs/online-architecture.md#deploying`).
3. **Trademark and domain check** for "Versus" before a dedicated domain; a subdomain of an existing zone works meanwhile.
4. **End-to-end tests** (Playwright) for swipe, drag and drop, color popover and the published boards flows (author, voters, admin link); the scenario run by hand for this work is a starting point, and so is the offline and update scenario in `docs/pwa.md`.

## Later / ideas

- Check the first real figures in Umami (both hosts, clean paths, events), and that the zone's `final slash` redirect rule spares the subdomains (`docs/analytics.md#left-to-check-live`).
- More languages (ES, PT-BR, DE), driven by traffic.
- Export / import a ranking as JSON.
- A short video of the end-of-vote reveal for stories, recorded from the canvas.
- Glicko as an extra method, if ever needed.
- Native shell (Capacitor) around the web app, only if store presence is ever wanted (D75).
- Search Console for versus.steevepommier.com: verify, submit the sitemap, request indexing of `/` and `/fr/`.
- Content pages (one per scoring method, a pairwise ranking guide): internal links and long-tail queries a single page can't reach.
- Accessibility audit (WCAG 2.1 AA) of the duel stage and popovers.
- Images: warn when approaching the localStorage quota (~5 MB), or move images to IndexedDB.
- Images on published boards (R2), once reporting and takedown exist.
- Crowd ranking by aggregating each voter's own ranking (Borda, Kemeny) as an alternative to pooled votes.
- Publish presets ("Open", "Blind contest") if the publish modal still feels heavy.
- Admin page behind Cloudflare Access (the admin API exists), with usage against free-tier limits.
- Client-side vote batching, if a board ever goes viral.
- A report button on published boards, feeding the admin view.

## Open questions for online mode

None of these blocks the backend spike; all must be settled before a public launch.

- **Anti-abuse**: rate limits per connection and IP, Turnstile at publication; an author option to require Turnstile per voter?
- **Moderation**: even text-only public boards need reporting, takedown and an admin view; a legal and safety requirement, stronger once images open.
- **Cleanup**: TTL of inactive published boards (proposal: 60 days without a vote), warning the author before deletion.
- **Accounts**: none at first; magic link or OAuth (GitHub/Google) later?
