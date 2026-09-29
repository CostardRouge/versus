# Roadmap

Last updated 2026-09-29.

## Done

- Prototype as a claude.ai artifact, then ported to this repo (Vite + TS).
- Gallery, workspace with live-sorted items, duel stage (swipe, tap, buttons, keyboard, undo, skip, tie), results with podium and method comparison.
- Four scoring methods (Balanced/BT default, Dynamic/Elo, Simple/win rate, Exact sort), switchable per ranking.
- Items: text, images (drop, paste, file picker), solid colors and gradients; `#hex` paste; color editor popover.
- Fixed demos with reset, duplicate and hide.
- EN/FR with switcher; light/dark/system theme switcher.
- localStorage persistence with migration from prototype keys.
- Repo tooling: Biome, strict TS, Vitest (139 tests), CI, GitHub Pages deploy, Dependabot, MIT license, README.
- Published board model agreed (lifecycle, one voice per pair, visibility modes, live updates): `docs/published-boards.md`.
- `src/app/ui.ts` split into view modules (gallery, workspace, items, duel, results, color popover), navigation, events and shared state; no behavior change.
- Published boards in the app: publish modal (warning, author votes, visibility, method with Exact sort greyed out, more options), board page (server-assigned duels, live crowd ranking with its toggle, hidden states, neck and neck, agreement, undo and clear), author panel (settings, close/reopen, admin link, withdraw into a local copy), share links in the URL fragment, gallery badge. Works against `npm run worker:dev`; hidden in production builds until the API is deployed.
- Backend prototype in `worker/`: Worker router + one Durable Object per published board (SQLite, hibernatable WebSockets, TTL alarm). Publish, public view, server-assigned pairs, votes, undo and reset, visibility enforced by the server, author settings, close/reopen, withdraw with a local copy. Rules in `src/core/board.ts`; end-to-end tests in workerd. Not deployed.

## Next (suggested order)

1. **Deploy the backend prototype**: needs a Cloudflare account and an API token stored as a GitHub secret, then a deploy job in CI (`npm run worker:deploy`).
2. **Complete the backend**: D1 registry and admin routes, Turnstile at publication, rate limiting per IP, adding and deleting items after publication (and by visitors when allowed), client-side vote batching, serving the front from Cloudflare (D34).
3. **Trademark and domain check** for "Versus" (and a custom domain).
4. **End-to-end tests** (Playwright) for swipe, drag and drop, color popover and the published boards flows (author, voters, admin link); the scenario run by hand for this work is a starting point.

## Later / ideas

- More languages (ES, PT-BR, DE), driven by traffic.
- Export / import a ranking as JSON; share a results image.
- Glicko as an extra method, if ever needed.
- PWA / installable app, offline-first.
- Self-host the fonts (avoid Google Fonts requests; privacy and speed).
- Accessibility audit (WCAG 2.1 AA) of the duel stage and popovers.
- Images: warn when approaching the localStorage quota (~5 MB), or move images to IndexedDB.
- Images on published boards (R2), once reporting and takedown exist.
- Boards a visitor voted on listed in their gallery ("Joined").
- Crowd ranking by aggregating each voter's own ranking (Borda, Kemeny) as an alternative to pooled votes.
- Publish presets ("Open", "Blind contest") if the publish modal still feels heavy.

## Open questions for online mode

None of these blocks the backend spike; all must be settled before a public launch.

- **Anti-abuse**: rate limits per connection and IP, Turnstile at publication; an author option to require Turnstile per voter?
- **Moderation**: even text-only public boards need reporting, takedown and an admin view; a legal and safety requirement, stronger once images open.
- **Cleanup**: TTL of inactive published boards (proposal: 60 days without a vote), warning the author before deletion.
- **Voter gallery**: do boards a visitor voted on appear in their gallery ("Joined")?
- **Accounts**: none at first; magic link or OAuth (GitHub/Google) later?
