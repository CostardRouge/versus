# Audience measurement and the legal notice

Last updated 2026-09-30. Ported from steevepommier.com and vanessagedeon.com (their `docs/memory/analytics.md`), which weighed the alternatives once: Google Analytics (blocked by this audience, cookies and a consent banner, heavy), Plausible CE, Matomo, PostHog, Cloudflare Web Analytics. Their reasoning is not repeated here; what differs for Versus is below.

## The choice

**Umami, self-hosted by the author**, the instance that already measures steevepommier.com and vanessagedeon.com (Steeve's server, behind Cloudflare), with Versus's own website id `e2a05317-59c3-4075-a59d-d1e497f0403a`. No cookie and no cross-site identifier, so no consent banner. The tracker is served from `insight.steevepommier.com/insight`: same site as `versus.steevepommier.com` (one registrable domain), and not named `/script.js`, which filter lists block by name.

## What is sent

**Views**, one per address the visitor sees, with the page's path on the site (the same on the Worker and under `github.io/versus/`; the host tells them apart in Umami):

| Path | View |
| --- | --- |
| `/`, `/fr/` | Home page, English or French |
| `/legal/`, `/fr/mentions-legales/` | Legal notice |
| `/app/` | The gallery |
| `/app/demo/<slug>`, `…/ranking`, `…/items` | A demo and its tabs (same for everyone, so kept) |
| `/app/r/:id`, `/app/r/:id/ranking`, `/app/r/:id/items` | A ranking of this browser: its id replaced |
| `/app/b/:alias` | A published board: its alias replaced (whoever has it can vote) |

Referrer: the other site the visitor came from (origin and path only), then, inside the app, the previous view, as a page load would report it. Title: the page's title, which never holds user content.

**Events**, anonymous facts only, never a title, a label or an address:

| Event | When | Data |
| --- | --- | --- |
| `ranking-created` | New ranking, a copy, or "Make my own" from a board or a card under Your votes | `from`: `new`, `copy`, `demo`, `board`, `card` |
| `ranking-finished` | The end of a local ranking is announced (D73) | `method`, `end` (`sort` or `stable`), `demo`, `items` |
| `board-published` | A ranking is published | `method`, `visibility`, `items`, `votes` (the author's duels carried over) |
| `board-joined` | First vote on a board from this browser (its "Your votes" card appears) | none |
| `board-finished` | The voter has voted every pair (end-of-vote page, D64) | `items` |
| `shared` | A result or a duel shared as an image (D98, D99) | `kind` (`ranking`, `crowd`, `duo`, `duel`), `format` (`post`, `story`, `landscape`), `how` (`share-image`, `share-text`, `copy-text`, `copy-image`, `download`) |
| `app-installed` | The browser reports the app installed | none |
| `chocolatine` | A side taken at the bottom of the home page | `side`: `chocolatine` or `pain-au-chocolat` |

Umami adds on its own: browser, OS, device type, screen size, language, country (from the IP, which it doesn't store).

**Never sent**: a ranking's id, title or items, a board's alias, the author's key (`#owner=…`, D92), search strings or fragments.

## How it loads (what's better than the two other sites)

- **Settings in the head, not the tracker.** The build writes a small JSON element (`<script type="application/json" id="analytics">`, `build/analytics.ts`) into every page; `src/audience.ts` appends the tracker only when the visitor hasn't said no. Someone who switched it off, or whose browser sends **Do Not Track or Global Privacy Control**, never contacts the analytics server at all (the other sites load the tracker and let it stay silent; Umami ignores GPC). No preconnect either, for the same reason.
- **Asynchronous.** Appended with `async`, never `defer`: a deferred classic script runs before the page's module script, so a slow or unreachable analytics server would have held back the app's first render.
- **Automatic tracking off; every view and event sent by `src/audience.ts`** with a clean path. Left on, Umami's tracker records `pathname + hash` (the author's key included) and a raw `r/<id>` for every ranking. `data-exclude-search` and `data-exclude-hash` are set as well, for anything the tracker might send on its own.
- **The app's views are counted where the address changes** (`syncURL()` in `src/app/router.ts`, D92): startup, links, Back and Forward, tabs. The same path twice in a row counts once.
- **A queue until the tracker loads**, bounded (30), dropped on a load error or an opt-out.
- **No file named "analytics".** The bundler names a shared chunk after one of its modules, and filter lists block URLs with that word: the browser module is `src/audience.ts` so the shared chunk (which also carries the fonts' CSS) is `assets/audience-*.js`. A blocked shared chunk would take the whole app down.
- **Both hosts count**: `data-domains` lists `versus.steevepommier.com` and `costardrouge.github.io` (plus the canonical host when `VITE_SITE_URL` changes it). Anything else (localhost, a preview, a fork's deploy) loads the tracker and never reports.
- **The switch lives on the legal page**, next to the explanation (the app has no settings panel, like vanessagedeon.com): it shows what this browser does (counted, switched off, privacy signal, no measurement in this build) and sets or clears Umami's own `umami.disabled` key. Turning it back on applies from the next page.

## Settings

`ANALYTICS` in `build/site.ts` holds the defaults (the production values, so a fresh clone needs nothing); none is secret, all end up in the pages. Build variables override them: `VITE_UMAMI_SRC`, `VITE_UMAMI_WEBSITE_ID` (empty: no measurement at all, no settings in the pages), `VITE_UMAMI_DOMAINS` (comma-separated). Development (`npm run dev`) and tests never measure; `VITE_UMAMI_DEV=true` puts the settings in a development page, and nothing reports from localhost unless `VITE_UMAMI_DOMAINS` lists it.

## The legal notice

`/legal/` (English) and `/fr/mentions-legales/` (French), rendered at build time like the home page (`src/legal/markup.ts`, texts in `src/i18n/legal-*.ts`, the home page's header and footer), indexed, linked by hreflang and listed in the sitemap. Linked from the home page's footer and from the app's page text (`src/app/about.ts`). It covers what the two other sites' pages cover (publisher, LCEN art. 6-III for a non-professional publisher, hosting, liability) and what is Versus's own: local storage, published rankings (what is sent, anonymous voter id, deletion after `TTL_DAYS` of inactivity or withdrawal, the author's key), audience measurement with the lists above and the switch, cookies (none; Turnstile runs only when publishing asks for it), hosting logs and per-IP limits, GDPR rights and the CNIL, the MIT licence and responsibility for published content with a takedown address. Contact: `CONTACT` in `build/site.ts`.

The page states facts the code must keep true: the 60 days come from `TTL_DAYS` (a test ties them), the list of events and paths is this file's. **Change an event, a path or what is stored, and update `src/i18n/legal-*.ts` in the same commit.**

## Verifying

`tests/audience.test.ts` (settings, loading rules, queue, clean payloads), `tests/legal.test.ts` (texts, links, the switch), `tests/route.test.ts` (`trackedPath`). End to end, 2026-09-30: the built site served to headless Chromium through request interception, with the real Umami tracker (v2.10, from the `umami` npm package) answering for `insight.steevepommier.com/insight` and every `/api/send` captured, nothing reaching the real instance. Home → chocolatine → app → demo → Ranking tab → Back → new ranking gave exactly the views and events in the tables above, referrers chained; an author's link sent `/app/b/:alias` and neither the alias nor the key; the switch off meant no tracker request on the next pages; GPC meant none at all; the GitHub Pages build reported the same paths with its own host.

## Left to check live

- **That `https://insight.steevepommier.com/insight` answers 200 with JavaScript**, not a redirect: steevepommier.com's zone has a `final slash` Redirect Rule matching on path only, which sent the dashboard's paths to the apex (open item there since 2026-09-25). The same rule, without a host test, would also redirect Versus's own deep links (`/app/demo/…`, `/app/b/…`) to `https://steevepommier.com/…/`. Check: `curl -sI https://versus.steevepommier.com/app/demo/destinations` should be 200, and `curl -sI https://insight.steevepommier.com/insight` 200.
- **The first real views in the dashboard**: both hostnames, paths without identifiers, events with their data.
