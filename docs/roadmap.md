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

## Next (suggested order)

1. **Shared board model** (design before code): roles, what's open vs locked, lifecycle. See open questions below.
2. **Backend spike on Cloudflare**: one Worker + one Durable Object per board, create/join by ID, real-time duel sync over WebSocket, TTL cleanup via alarms. Reuse `src/core`.
3. **Trademark and domain check** for "Versus" (and a custom domain).
4. **Split `src/app/ui.ts`** (~1,400 lines) into view modules (gallery, workspace list, duel, results, color popover) before adding online features.
5. **End-to-end tests** (Playwright) for swipe, drag and drop, color popover; UI coverage is ~45% today.

## Later / ideas

- More languages (ES, PT-BR, DE), driven by traffic.
- Export / import a ranking as JSON; share a results image.
- Glicko as an extra method, if ever needed.
- PWA / installable app, offline-first.
- Self-host the fonts (avoid Google Fonts requests; privacy and speed).
- Accessibility audit (WCAG 2.1 AA) of the duel stage and popovers.
- Images: warn when approaching the localStorage quota (~5 MB), or move images to IndexedDB.

## Open questions for online mode

- **IDs**: short shareable alias (e.g. 8–10 chars, base58) mapped to a Durable Object ID; how to guarantee no collision (check-and-reserve in the object, or use the object's own unique ID).
- **Ownership and rights**: owner token created with the board (no account at first?). What can visitors do by default: vote only, add items, edit items, change method?
- **Per-board settings**: open vs locked (add items, rename, delete, change method, reset), visibility (public listing vs link only), duel limits per visitor.
- **Real-time behavior**: does each visitor have their own duels feeding one shared ranking? Live presence ("12 people voting")? Aggregation rate (broadcast 1–2×/s).
- **Anti-abuse**: rate limiting per IP/session, vote stuffing, bot protection (Turnstile).
- **Moderation**: public boards with user text and images need reporting, takedown and an admin view; this is a legal and safety requirement before opening images to the public.
- **Cleanup**: TTL for inactive boards (e.g. 30–90 days), owner-controlled expiry, export before deletion.
- **Admin interface**: protected route to list, inspect, lock and delete boards, and see usage against free-tier limits.
- **Accounts**: none, magic link, or OAuth (GitHub/Google) later?
