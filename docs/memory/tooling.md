# Tooling, CI and the portfolio standard

Read when you touch `package.json`, the lockfile, `.nvmrc`, Biome, Vitest and its thresholds, `.github/` (CI, Dependabot, the release and registry workflows), `.gitignore`, `scripts/icons.ts`, or anything the portfolio standard governs. The decisions this file points at are rows of `docs/decisions.md`; the standard itself is `COMMON-PROJECT-SPEC.md` in the private `second-brain` repository, and it is never edited from here.

## The toolchain as it stands

- 2026-10-19 — **npm, one lockfile** (`package-lock.json`); Node 24 from `.nvmrc`, `engines` at ≥ 22 as the floor, `@types/node` held to the `.nvmrc` major by Dependabot (D121, D27). No container image: the Worker and GitHub Pages are the deploys. **How to apply**: a Node bump moves `.nvmrc`, `@types/node` and the `CLAUDE.md` line together; never a second lockfile.
- 2026-10-19 — **The gate is `npm run check`** — Biome, `tsc` on the app, the Worker and the service worker, Vitest, the Vite build; CI's `verify` job runs the same with coverage, `src/core` at ≥ 90 % lines, functions and statements and ≥ 75 % branches (D26) — and **`npm run e2e`** after a change to the UI, the Worker or the service worker (CI's `e2e` job, D134). `node .github/release.mjs check` holds `CHANGELOG.md` to `package.json` on every pull request (D123); `registry.yml`'s `check` job refuses a Registry block that would leak in this public repo (D122). Pages and Cloudflare deploy from `main` only once both jobs pass (D27, D60).
- 2026-10-19 — **Biome 2 lints and formats** (`biome.json`); `npm run format` fixes. Markdown is outside its reach, so `MEMORY.md` and `docs/` are checked by eye.
- 2026-10-19 — **TypeScript 7 runs every type check**, strict with `noUncheckedIndexedAccess`, in three projects (the app, `worker/`, `src/sw/`). No TypeScript 6 alias: nothing here needs the old compiler API.

## The portfolio standard

- 2026-10-19 — **The agent scaffold** of `COMMON-PROJECT-SPEC.md` §3 landed: `MEMORY.md` as the index over the `docs/` files this project kept from the start, this folder for new topics, the canonical `/memorize` (`.claude/commands/memorize.md`, the spec's text byte for byte), `AGENTS.md` as a symlink to `CLAUDE.md`, and `CLAUDE.md` in the standard shape (rules 1 to 4, the trust-the-disk section). Two rules it brought that the repo had not stated: a commit ends with whatever attribution trailer the harness asks for, never a spelling of the repo's own (K2); and memory points at D rows rather than restating them, the whole-tree facts (code map, conventions, domain rules) staying in `CLAUDE.md` as its Context. **How to apply**: a new rule of the standard reaches this repo by being pasted into `CLAUDE.md` in a normal commit.
