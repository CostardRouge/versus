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
- Repo tooling: Biome, strict TS, Vitest (61 tests), CI, GitHub Pages deploy, Dependabot, MIT license, README.
- Published board model agreed (lifecycle, one voice per pair, visibility modes, live updates): `docs/published-boards.md`.

## Next (suggested order)

1. **Backend spike on Cloudflare**: one Worker + one Durable Object per board, publish/join by alias, server-assigned pairs, votes over WebSocket, visibility enforced by the server, TTL cleanup via alarms. Reuse `src/core`.
2. **Trademark and domain check** for "Versus" (and a custom domain).
3. **Split `src/app/ui.ts`** (~1,400 lines) into view modules (gallery, workspace list, duel, results, color popover) before adding online features.
4. **End-to-end tests** (Playwright) for swipe, drag and drop, color popover; UI coverage is ~45% today.

## Later / ideas

- More languages (ES, PT-BR, DE), driven by traffic.
- Export / import a ranking as JSON; share a results image.
- Glicko as an extra method, if ever needed.
- PWA / installable app, offline-first.
- Self-host the fonts (avoid Google Fonts requests; privacy and speed).
- Accessibility audit (WCAG 2.1 AA) of the duel stage and popovers.
- Images: warn when approaching the localStorage quota (~5 MB), or move images to IndexedDB.
- Images on published boards (R2), once reporting and takedown exist.
- Crowd ranking by aggregating each voter's own ranking (Borda, Kemeny) as an alternative to pooled votes.
- Publish presets ("Open", "Blind contest") if the publish modal still feels heavy.

## Open questions for online mode

None of these blocks the backend spike; all must be settled before a public launch.

- **Anti-abuse**: rate limits per connection and IP, Turnstile at publication; an author option to require Turnstile per voter?
- **Moderation**: even text-only public boards need reporting, takedown and an admin view; a legal and safety requirement, stronger once images open.
- **Cleanup**: TTL of inactive published boards (proposal: 60 days without a vote), warning the author before deletion.
- **Voter gallery**: do boards a visitor voted on appear in their gallery ("Joined")?
- **Accounts**: none at first; magic link or OAuth (GitHub/Google) later?
