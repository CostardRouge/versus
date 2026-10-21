# Project memory — decisions, reasons, traps

Long-term memory of this repo, read at the start of **every** agent session (imported by `CLAUDE.md`). It holds what the code and `git log` cannot tell you: the choices made and their reasons, what was tried and rejected, the traps that cost time, how the owner likes to work.

This file is the **always-loaded index**. The detail lives in the topic files of the table at the bottom, loaded **on demand**: this project documented itself from its first day in `docs/` (a D-numbered decision log, a roadmap, one file per subsystem), so those files are its topic files, and `docs/memory/<topic>.md` takes what fits none of them. Read the file(s) matching the area you are about to touch **before** acting. Do not `@import` them into `CLAUDE.md` — the split keeps the per-session prompt small.

## How to maintain (mandatory — CLAUDE.md rule 2)

- **When**: at the end of every task, before its commit, in the same commit. Writing is the **default**; only skip if there is truly nothing a future agent could use, and say so explicitly in the final message.
- **What**: a design/product decision, a non-obvious technical choice, an explicit rejection ("the owner did not want X because Y"), a trap (browser, Cloudflare, tooling) and its remedy, a working preference. Not implementation detail readable in the diff, not what `git log` already says, not history ("this was fixed on…") — once a fix is committed, keep only the rule it taught.
- **Where**: a decision is a **D row** of `docs/decisions.md` (the next free number, its status, the why in its Notes), and this index points at it in one line rather than restating it; the behaviour it fixes goes in the subsystem's file (`docs/published-boards.md`, `docs/pwa.md`…); what fits no file goes in `docs/memory/<topic>.md`, a new file only when no topic fits (kebab-case name, added to the table below with a "read when"). Cross-cutting rules, working style, decisions-at-a-glance and open items stay in this index.
- **How**: search first and **update** the existing entry rather than adding a near-duplicate; delete what became false. One entry = one short paragraph: *decision → why → how to apply*, dated `YYYY-MM-DD` on first write and on each revision. Say the same thing **once** — cross-reference other files by name instead of repeating.
- **Language**: **English**, dense, factual. No session narration. No test counts (they rot).
- Budget: keep this index under ~200 lines and each topic file under ~150; `docs/decisions.md` is the one file that only grows, a log by design.

## Working with Steeve Pommier

- 2026-10-19 — **Answers in French, short, results first.** He writes in French and wants something to try (a screen, a deploy, green tests) before any account of how it was built (`CLAUDE.md`, "What Versus is"). **How to apply**: end a task with what to open and tap; keep the how in the commit bodies and the pull request.
- 2026-10-19 — **He does not write code; he decides, reviews and tests by hand** on real devices (an Android phone, an iPhone with the home-screen app, a desktop browser). Size work in commits and sessions, never in developer days: a UI rewrite fits in a day of sessions, and what costs is his time, fees and regression risk (`CLAUDE.md`, "How this project is built").
- 2026-10-19 — **He picks among mock-ups.** The Your votes section (D82), the home page (D84) and the author's items editor (D116) were each chosen from two to four layouts shown first. **How to apply**: for a visible change with more than one sensible shape, show two or three options before building one; argue an option on product quality and his time, never on code volume.
- 2026-10-19 — **He reports what he saw, by feel**: "a slot machine" (the hero demo's burst of picks, D88), a blank page (the XHTML sitemap, D91), no way to fix a typo on his own board (D116). Read the symptom, find the rule it breaks, and record the rule as a D row so it is not re-proposed.

## Direction in five lines

- Rank anything by comparing two items at a time: the duel is the whole interface, a scoring method does the rest, Bradley-Terry by default (D11–D15).
- Local-first and free of accounts: rankings live in the browser, and only a board someone chose to publish reaches a server (D18, D31, D46).
- Web first, light, installable: a PWA with no UI framework and as few dependencies as possible; a native shell only if store presence is ever wanted (D24, D75).
- Online is Cloudflare end to end — a Worker, one Durable Object per board, D1 for the lists, R2 for pictures and cards — sharing `src/core` with the app (D30, D33, D48).
- What strangers publish is promoted only once it can be reported, hidden and taken down, and the public lists are curated (D107–D112); English and French everywhere (D22).

## Decisions at a glance (details in `docs/decisions.md`, by number)

- Name and identity: Versus, never "Elo" in the product; cobalt A, coral B, three fonts; light and dark — D1, D2, D5, D10.
- Scoring: four methods on one duel history, Bradley-Terry default, no TrueSkill, a 1500-centered scale — D11–D17.
- Engineering: Vite + TypeScript with no framework (reopened and kept), a pure `src/core` shared with the Worker, Biome, strict TS, a 90 % coverage floor on the core, one CI workflow deploying from `main` — D24–D27; Node 24 pinned, the floor at 22 — D121.
- Data: `localStorage` with a migration on every shape change, images in IndexedDB behind `idb:` references, demos as fixed seeded data — D18–D20, D124–D126.
- Addresses: every view has a real path under `app/`, the author's token only in the fragment, a duel link in the query read once — D92 (replacing D51), D105.
- Published boards: born local, one voice per pair, server-assigned pairs, visibility enforced by the server, items editable by the author with their votes kept or reset — D35–D48, D57, D116.
- Online: Worker + Durable Objects + D1 registry + R2 on one origin with the app, deployed by CI, secrets and the domain in the dashboard — D29–D34, D54, D60, D61.
- Abuse and moderation: per-IP and per-connection limits, Turnstile at publication and on the official boards, reports from voters only, hidden and featured flags, the admin page's token in memory only, revocable owner tokens — D55, D56, D58, D107–D109, D119, D120.
- Pictures on boards only through review, off by default (`IMAGES_UPLOAD`) — D113, D114.
- Official templates as real boards with indexable pages, a curated Popular section, a sitemap the Worker completes — D110–D112.
- Sharing: images drawn in the browser, never on the Worker; the share sheet first; link-preview cards in R2, drawn by authors only; "Make my own" — D102–D106, D117, D118.
- Notifications: Web Push sent by the Worker with WebCrypto only, asked on a tap, batched by the board's alarm — D131–D133.
- PWA: a hand-written service worker, an offline app shell, updates offered never forced, `standalone`, export and import as the way between devices, a share target, icon shortcuts, seeded screenshots — D76–D79, D97–D101, D127–D130.
- Home page and SEO: a static showcase per language, no redirect by browser language, the app `noindex`, every SEO fact in `build/site.ts`, icons and cards drawn by a script and renamed when redesigned, the canonical on the Worker's domain — D66–D72, D80, D81, D84–D91, D115.
- Audience measurement and legal: self-hosted Umami, declinable, a few anonymous events listed in the legal notice — D93–D96.
- Tests: unit, jsdom and workerd suites, and two end-to-end suites (a faked API, the real Worker) — D49, D134.
- Dependencies: Dependabot monthly with a cooldown, one minor-and-patch pull request, families for a major, `@types/node` held to `.nvmrc`; a red Dependabot pull request is fixed or held, never merged red — D135, `docs/memory/tooling.md`.
- The project reports its state to the owner's register through a Registry block in each pull request (D122) and carries one SemVer version with `CHANGELOG.md` as the source, pastries as codenames (D123).
- The portfolio standard, `COMMON-PROJECT-SPEC.md` in `second-brain`, adopted 2026-10-19: the agent scaffold (this file, `docs/memory/`, the canonical `/memorize`, `AGENTS.md` as a symlink), rules 1 to 4 and the trust-the-disk section in `CLAUDE.md`, the trailer the harness asks for, Node pinned, Biome in the gate, Dependabot, `.gitignore` hygiene and the full icon set (C11); what is in force, what was added and what is n/a — `docs/memory/tooling.md`.

## Open items (dated; remove when done)

- 2026-10-19 — **Notifications by hand on real devices** (`docs/roadmap.md`, next 1): make the keys (`npm run vapid`), set them as the Worker's secrets, then try an Android phone, an iPhone with the home-screen app and a desktop browser (`docs/online-architecture.md#notifications`). Only the owner can.
- 2026-10-19 — **The content security policy is reported only** (`Content-Security-Policy-Report-Only`, `/api/csp-report`, log lines `csp`): once a week of reports from real devices is clean (Turnstile, Umami, the theme script), the same policy becomes `Content-Security-Policy` (`docs/seo.md`).
- 2026-10-19 — **Trademark and domain check for "Versus"** before a dedicated domain (D3, open since the first day); the subdomain works meanwhile.
- 2026-10-19 — **More end-to-end tests**: the same scenarios in WebKit (closer to Safari), the offline-and-update scenario of `docs/pwa.md` (two builds), sharing as an image (the canvas, its fonts), the share target. Real iPhones stay a by-hand check.
- 2026-10-19 — **The owner's gestures, live**: the first real figures in Umami (both hosts, clean paths, events) and the zone's `final slash` rule sparing the subdomains (`docs/analytics.md#left-to-check-live`); Search Console for versus.steevepommier.com (verify, submit the sitemap, request indexing of `/` and `/fr/`); Cloudflare Access in front of `/admin/` and `/api/admin/` and a WAF rate rule on `/api/*` (`docs/online-architecture.md#moderation`).
- 2026-10-19 — **The Worker's data has no backup** (COMMON-PROJECT-SPEC C18): the visitor's rankings are covered by export and import (D97), but published boards live in their Durable Objects' SQLite, the registry in D1 and pictures and cards in R2, with no dump and no restore path written anywhere. Boards expire after 60 days without activity (`TTL_DAYS`) and the official templates are republished from fixed data, so what a loss would cost is the live boards' votes: whether that is worth a scheduled dump is the owner's call, and the answer belongs in `docs/online-architecture.md`.
- 2026-10-19 — **No Registry report has reached the register yet**: the `send` job of `registry.yml` runs with `REGISTRE_TOKEN` set (D122, read in its logs), but every push to `main` so far carried no block ("Aucun bloc Registry dans ce push"). The pull request adopting the portfolio standard is the first with one: after its merge, check its `send` job and that the fiche's log took the line; a failure there points at the token.


## Topic files — read before touching the area

| File | Read when you touch… |
| --- | --- |
| `docs/decisions.md` | anything: the D-numbered decision log (status and why), where a new decision is written |
| `docs/roadmap.md` | planning what comes next: done, next in order, later, the open questions of online mode |
| `docs/published-boards.md` | a published board: lifecycle, voting rules, visibility, live updates, Your votes, moderation, pictures, templates and Popular, notifications |
| `docs/online-architecture.md` | `worker/`: the Worker, Durable Objects, D1, R2, deploying, secrets, the admin API, limits and costs |
| `docs/seo.md` | `build/site.ts`, `build/seo.ts`: the heads, JSON-LD, icons and social cards, the manifest, robots, sitemap, llms.txt, headers and the CSP |
| `docs/pwa.md` | `src/sw/`, `build/pwa.ts`: installing, offline, updates, export and import, images in IndexedDB, the share target, shortcuts |
| `docs/analytics.md` | `src/audience.ts`: what is counted and never sent, the events, the legal notice, Umami's settings |
| `docs/memory/tooling.md` | `package.json`, the lockfile, `.nvmrc`, Biome, Vitest, `.github/`, `.gitignore`, `scripts/icons.ts`, the portfolio standard |
