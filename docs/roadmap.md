# Roadmap

Last updated 2026-09-30.

## Done

- Prototype as a claude.ai artifact, then ported to this repo (Vite + TS).
- Gallery, workspace with live-sorted items, duel stage (swipe, tap, buttons, keyboard, undo, skip, tie), results with podium and method comparison.
- Four scoring methods (Balanced/BT default, Dynamic/Elo, Simple/win rate, Exact sort), switchable per ranking.
- Items: text, images (drop, paste, file picker), solid colors and gradients; `#hex` paste; color editor popover.
- Fixed demos with reset, duplicate and hide.
- EN/FR with switcher; light/dark/system theme switcher.
- localStorage persistence with migration from prototype keys.
- Repo tooling: Biome, strict TS, Vitest (204 tests), CI, GitHub Pages deploy, Cloudflare deploy job (off until configured), Dependabot, MIT license, README.
- Published board model agreed (lifecycle, one voice per pair, visibility modes, live updates): `docs/published-boards.md`.
- `src/app/ui.ts` split into view modules (gallery, workspace, items, duel, results, color popover), navigation, events and shared state; no behavior change.
- Published boards in the app: publish modal (warning, author votes, visibility, method with Exact sort greyed out, more options), board page (server-assigned duels, live crowd ranking with its toggle, hidden states, neck and neck, agreement, undo and clear), author panel (settings, close/reopen, admin link, withdraw into a local copy), share links in the URL fragment, gallery badge. Works against `npm run worker:dev`; hidden in production builds until the API is deployed.
- Backend prototype in `worker/`: Worker router + one Durable Object per published board (SQLite, hibernatable WebSockets, TTL alarm). Publish, public view, server-assigned pairs, votes, undo and reset, visibility enforced by the server, author settings, close/reopen, withdraw with a local copy. Rules in `src/core/board.ts`; end-to-end tests in workerd. Not deployed.
- SEO pass, ported from steevepommier.com (`docs/seo.md`): head generated from `build/site.ts` (canonical, robots, Open Graph, X card, JSON-LD graph), 1200×630 social card, favicons for Google, iOS and Android (ico, SVG, 96/192/512, maskable, apple-touch), web app manifest, robots.txt, sitemap, llms.txt, `<noscript>` fallback, Cloudflare headers; fonts self-hosted and preloaded.
- Backend completed: items added and removed after publication (author, and visitors when allowed, 5 s apart; removing drops the item's votes), D1 registry and admin API (list, totals, inspect, close, remove an item, take down), per-IP rate limits, optional Turnstile at publication, the app served by the same Worker (`npm run worker:dev` runs the whole thing on :8787).

## Next (suggested order)

1. **Deploy**: the CI job is ready; it needs an API token and the account ID in the repository, then the Worker secrets and a custom domain (steps in `docs/online-architecture.md#deploying`).
2. **Trademark and domain check** for "Versus" before a dedicated domain; a subdomain of an existing zone works meanwhile.
3. **End-to-end tests** (Playwright) for swipe, drag and drop, color popover and the published boards flows (author, voters, admin link); the scenario run by hand for this work is a starting point.

## Later / ideas

- More languages (ES, PT-BR, DE), driven by traffic.
- Export / import a ranking as JSON; share a results image.
- Glicko as an extra method, if ever needed.
- Offline-first (service worker); then `display: standalone` in the manifest (see `docs/seo.md` for why it is `minimal-ui` today).
- Search Console once the domain is settled: verify, submit the sitemap, set the `SITE_URL` variable.
- Per-board social cards: a `/b/<alias>` path served by the Worker with the board's title and its own card (fragments never reach a server).
- Accessibility audit (WCAG 2.1 AA) of the duel stage and popovers.
- Images: warn when approaching the localStorage quota (~5 MB), or move images to IndexedDB.
- Images on published boards (R2), once reporting and takedown exist.
- Boards a visitor voted on listed in their gallery ("Joined").
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
- **Voter gallery**: do boards a visitor voted on appear in their gallery ("Joined")?
- **Accounts**: none at first; magic link or OAuth (GitHub/Google) later?
