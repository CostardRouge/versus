# Online architecture

Status: **built in `worker/`**, running locally and in tests, not deployed yet (steps below). Discussed on 2026-09-29. Goal: published (shared, real-time) boards for potentially hundreds of thousands of users, on a near-zero budget. Product behavior of published boards (lifecycle, voting rules, visibility, live updates) is in `docs/published-boards.md`.

## Load estimate

- 300,000 users/month ≈ 10,000/day.
- A duel is a few bytes and microseconds of compute.
- Even at 50 duels per person: ~500,000 messages/day ≈ 6/s on average, a few hundred/s at peak.
- Conclusion: language speed is irrelevant at this scale. Cost comes from keeping servers and connections alive, so optimize architecture, not language.

## Stack: Cloudflare, TypeScript end to end

```
Browser (Vite app, local-first)
   │  local rankings: localStorage only, no requests
   │  published boards: HTTPS + WebSocket
   ▼
Cloudflare static assets: the app (dist/), served by the same Worker, same origin as the API
   ▼
Worker (router: publish/join board, owner and admin auth, per-IP rate limits, Turnstile at publication and first votes on official boards)
   ├─ D1: board registry (alias, title, status, language, counts, reports, hidden, featured, last activity),
   │      for the admin page and the public lists
   ▼
Durable Object, one per published board
   ├─ embedded SQLite: items, votes (one row per voter and pair), settings, owner token hash
   ├─ WebSockets with hibernation (no cost while idle)
   ├─ single-threaded: no write conflicts
   ├─ assigns pairs and runs src/core scoring (same code as the browser)
   ├─ enforces results visibility (never sends the ranking to a client not entitled to it)
   └─ alarm: TTL cleanup of inactive boards
R2 (bucket versus-images): the cards a board's links unfurl with, drawn and sent by the app (D104), and the
   items' pictures sent for review, public once approved (D113)
```

Why each piece:

- **Local-first** is the main cost lever: only published boards touch the server.
- **One Durable Object per board** gives a natural unit of state, concurrency and cleanup, and a collision-free ID.
- **Same TypeScript core** on both sides: one language, no scoring drift between client and server.
- **Server-assigned pairs**: required by blind mode (the browser never needs the crowd ranking) and blocks targeted vote stuffing (votes are accepted only on assigned pairs).
- **D1 registry**: Durable Objects can't be listed with their data, so the admin page needs its own index. Updated at most once a day per board to spare writes (at once for structural changes: status, items, flags, reports).

## Implementation (`worker/`)

- `worker/src/index.ts`: routes `/api/boards` (publish, public view, WebSocket, owner actions with `Authorization: Bearer <owner token>` (`POST …/owner` replaces the token), items, `PUT …/card` for the link preview card, `POST …/report` for visitors' reports), `/api/summaries` (the cards of a voter's "Your votes", as that voter may see each board), `/api/popular?lang` (the Popular section: featured boards and official templates of one language, from the registry) and `/api/admin` (totals; the list with filters and a title search; per board the full view with flags and reports, close or reopen, moderation flags, remove an item, clear the reports, delete its link preview cards, take down; `Authorization: Bearer <ADMIN_TOKEN>`); outside the API, the template pages and the sitemap (below); the route list is at the top of the file.
- `worker/src/pictures.ts`: items' pictures (D113, D114). `PUT /api/boards/:alias/items/:id/image` (the author's token, a JPEG under `LIMITS.picture`, for an item that announced one) stores it in R2 under `img/<alias>/<item>.jpg` with the custom metadata `state: pending`; `/img/b/<alias>/<item>.jpg` serves it only once `state` is `ok`; the admin routes read it whatever its state (`GET …/items/:id/image`) and decide (`POST …/items/:id/picture`, `{ decision: 'ok' | 'refused' }`): approved, the object is rewritten with `state: ok` and the item takes the public address; refused, the object is deleted and the item keeps `pic: 'refused'`. `GET /api/config` tells the app the policy (`IMAGES_UPLOAD` variable: `review` to enable). Pictures go with their item and with the board (`deletePrefix`).
- `worker/src/templates.ts`: the official templates (D110, `src/core/templates.ts`). `ensureTemplate()` publishes a template's board in one language the first time a page or the Popular list asks for it (the site as author, `official`, never expiring) and writes its registry row at once; the registry's unique index on (template, language) settles a race between two first visits (the second copy is deleted). A page whose registry row outlived its board (a delete that failed) drops the row and publishes the template again; the Popular list, which never wakes boards, doesn't check. `templatePage()` renders `/t/<slug>/` and `/fr/t/<slug>/`: the legal page's shell fetched from the assets binding, its head rewritten with `HTMLRewriter` (title, description, canonical, hreflang, robots, Open Graph, JSON-LD `ItemList`) and its `<main>` replaced by the page's content; `noindex` until `TEMPLATE_INDEX_VOTERS` voters (30; the `TEMPLATE_INDEX_VOTERS` variable overrides it, tests use 1). `sitemap()` serves `/sitemap.xml` (`run_worker_first` in `wrangler.jsonc`, so the Worker gets the request although the file exists): the static sitemap from the build plus the template pages with a crowd, with the day of their last activity (D112).
- `worker/src/cards.ts`: link previews (D104). Stores the 1200×630 PNG the app drew for a board or one of its duels in R2 (`og/<alias>.png`, `og/<alias>/<a>.<b>.png`; 400 KB at most, 40 duel cards per board; who may send which is `cardUpload` in `src/core/share.ts`: the board's card its author, a duel's card anyone while it has none), serves it under `/og/b/…/<version>.png` (24 h cache; the site's `og.png` when there is none), and rewrites the head of `/app/b/<alias>[?duel=a.b]` with the board's title, a description in its language (`src/i18n/unfurl.ts`) and the card. The cards go with the board (withdrawal, takedown, expiry).
- `worker/src/registry.ts` + `worker/migrations/`: the D1 registry, whose row is the admin list's (`AdminRow` in `src/core/protocol.ts`): alias, title, status, language, counts, report count, hidden and featured flags, the template key, the votes of the last 7 days, the crowd's first three labels, creation and activity. Each board writes its row on publication, status, item, flag and report changes, at each new voter up to 100 (the public lists and the index threshold watch the first voters), then at most once a day for votes; the row goes when the board does. `0002_moderation.sql` added the language, the flags and the report count; `0003_templates.sql` the template key, the recent votes, the top labels and the unique index on (template, language); `0004_pictures.sql` the count of pictures awaiting review; `0005_popular.sql` a partial index on the public rows the Popular section reads (not hidden, featured or a template). The registry also answers the Popular section (`popularBoards`), the template pages (`templateBoard`) and the sitemap (`indexableTemplates`), so no board wakes for a list.
- Limits: the `PUBLISH_LIMIT` (5 publications per minute), `API_LIMIT` (120 requests per minute, WebSocket connections included) and `SUMMARY_LIMIT` (10 "Your votes" refreshes per minute, each waking up to 24 boards) rate limiting bindings, keyed by client IP; votes and skips are limited per connection (150 ms), item suggestions per connection (5 s). A connection keeps the voter of its first `hello` (another voter id is refused), and a new `hello` keeps both delays. A board takes the first votes of at most 30 new voters per address in 10 minutes (`admitNewVoter`; beyond, `rate_limited`): the board counts them in memory under a short hash of the address and its alias, carried as the WebSocket's tag (it survives hibernation), and never stores it.
- `worker/src/turnstile.ts`: with `TURNSTILE_SECRET` set, publishing requires a Turnstile token (the app shows the widget when `VITE_TURNSTILE_SITE_KEY` is set), and so does a voter's first vote on the site's own boards: the vote is refused with `captcha`, the app shows the widget and sends `{ t: 'check', token }` on the socket, and the connection's session remembers it passed (`human`, `needsCheck` in core). Turnstile gets 5 seconds to answer.
- `worker/src/board-object.ts`: `BoardObject`, a thin adapter around `src/core/board.ts`. Loads the board from SQLite when it wakes (synchronous reads; a `reports` table besides `meta` and `votes`, created on wake for older boards), keeps each voter's session (queue, skipped pairs, rate limit) in the WebSocket attachment so it survives hibernation, caches the crowd ranking for 1 s, broadcasts at most once per second. Moderation flags live in the board's meta, reports one row per voter.
- Protocol (`src/core/protocol.ts`): the client sends `hello` (voter id, owner token for the author, the pair a duel link asked for), then `vote`, `skip`, `undo`, `reset`; the server answers `state`, `pairs`, `ranking` (null when not entitled) and `error`.
- App side: `src/app/remote.ts` (fetch helpers and a WebSocket that says hello on every connection, reconnects with a growing delay and asks the API whether a board still exists before calling it gone), `src/app/board.ts` (board page), `src/app/publish.ts` (publish modal). The app reaches the API at `/api` on its own origin, or `VITE_API_URL`; a production build without either hides publishing.
- The Worker serves the site too (`assets`, from `dist/`, binding `ASSETS`): files first (except `/sitemap.xml`, which `run_worker_first` hands to the Worker), then for what matches none the app's page for every view under `/app/` (`/app/demo/…`, `/app/b/<alias>`, D92), the template pages (`/t/<slug>/`, `/fr/t/<slug>/`) and the 404 page with a 404 status for the rest. `npm run worker:dev` builds it in `worker` mode (`.env.worker`: `VITE_API_URL=/`), so publishing works on http://localhost:8787 with the real Worker; `npm run dev` keeps hot reload and proxies `/api` to it.
- The admin page (`src/admin/`, served at `/admin/` like any page of the build) is the client of the admin routes: see Moderation below.
- Not built: client-side vote batching. Each vote costs 1/20 of a request (WebSocket billing), so batching only pays off for a viral board, and it would need a longer pair queue; left for when a board needs it.
- Known cost: waking a board reads all its votes (one row read each). Fine at this stage; per-pair totals can be cached if large boards wake often.

## Costs (Cloudflare pricing as of September 2026, check before relying on it)

Free plan:
- Workers: 100,000 requests/day, 10 ms CPU per invocation.
- Durable Objects: 100,000 requests/day, 13,000 GB-s/day. Incoming WebSocket messages are billed at a 20:1 ratio (100 messages = 5 requests); outgoing messages are free.
- Durable Object SQLite: 5 M row reads/day, 100,000 row writes/day, 5 GB stored.
- D1: 5 M row reads/day, 100,000 row writes/day, 5 GB stored.
- R2: 10 GB-month storage, 1 M class A (writes, lists) and 10 M class B (reads) operations a month, free egress. The quota is the account's, shared with the other sites' buckets. A link preview card is 50 to 200 KB: tens of thousands of boards fit. An item's picture is a 640 px JPEG, 40 to 120 KB (250 KB at most): a board of a hundred pictures is under 10 MB; approving rewrites the object (one more write).

Paid plan: $5/month minimum, including 10 M Worker requests/month; DO includes 1 M requests + 400,000 GB-s/month; SQLite 50 M row writes/month.

**The binding free-tier limit is SQLite row writes, not requests.** Each vote is one upsert keyed by voter and pair (a `WITHOUT ROWID` table avoids an extra index write), so the free plan holds about 100,000 votes/day across all boards, fewer with extra indexes. Beyond that, the $5 plan covers ~1.6 M row writes/day.

Example: 60,000 shared votes/day ≈ 3,000 billable DO requests (20:1) + 60,000 row writes → within the free plan.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Main risks

**The viral board.** A Durable Object processes messages one at a time; a board with thousands of simultaneous voters would saturate it. Mitigations:

- Batch votes client-side (send every 1–2 s).
- Broadcast the aggregated ranking at most once per second, only when it changed, and only to clients entitled to see it.
- Recompute scores at broadcast rate, not on every vote.
- Spectators are read-only; voting may require a lightweight session.
- If ever needed: shard votes across several objects by voter and merge (BT is order-independent, and sharding by voter keeps one voice per pair exact).

**Multiplied identities.** A voter is an anonymous id per browser, so a private window is a new voter. One voice per pair and server-assigned pairs cap what one identity can do; the rest relies on rate limits per connection and IP, a cap on the new voters one address brings to a board (30 in 10 minutes), and Turnstile (at publication, and before a first vote on the site's own boards).

## Alternatives considered

| Stack | Strength | Limit for Versus |
| --- | --- | --- |
| Elixir / Phoenix | Best-in-class classic real-time (channels, presence, huge connection counts) | Needs an always-on server: fixed cost and ops |
| Go | Single binary, very frugal on a small VPS | Same server constraint; second language to maintain |
| Rust | Maximum performance, runs on Workers via WebAssembly | No measurable gain here, slower development |
| Zig | Technically interesting | Web ecosystem too young |
| Node on a VPS | Familiar | Fixed cost, ops, scaling is manual |

**Plan B, free:** the home Dell Optiplex (Ubuntu Server) exposed through Cloudflare Tunnel, with Node + SQLite. Good for a private beta; depends on home bandwidth and uptime, so not suited to viral traffic.

## How the stack answers the design questions

- **IDs without collision:** a random 10-character base58 alias used as the Durable Object's name (`idFromName`). Publishing fails if that object already holds a board, and the client draws another alias. No mapping table.
- **Owner rights:** an owner token generated at publication, stored hashed in the object. The author keeps it in `localStorage` and in an admin link (`…/app/b/<alias>#owner=…`: the fragment never reaches server logs or referrers). No accounts at first.
- **Settings:** stored in the board's SQLite and enforced in the object (visibility, scoring method, vote changes, visitors adding items).
- **Cleanup:** the alarm is set to last vote + TTL. When it fires, it checks the last vote time and either reschedules or deletes the board: no extra write per vote.
- **Admin:** protected Worker routes (a secret, then Cloudflare Access) reading the D1 registry to list, inspect, lock and delete boards, and to watch usage against free-tier limits; the moderation page below is their client.

Remaining questions are listed in `docs/published-boards.md` (still open) and `docs/roadmap.md`.

## Moderation

The page at `/admin/` (D107; behavior in `docs/published-boards.md#moderation`) asks for the Worker's `ADMIN_TOKEN` and keeps it in the tab's session storage, so a phone or a shared computer forgets it when the tab closes; a refused token brings the form back. It is out of the index (`noindex, nofollow`, `Disallow: /admin/`, `X-Robots-Tag`), out of the service worker's precache and never measured. The GitHub Pages copy builds it too, where it only says it has no server.

The token alone protects the routes. Once deployed, add a second lock with **Cloudflare Access** (free for up to 50 users): *Zero Trust* → *Access* → *Applications* → *Add an application* → *Self-hosted*, with two paths on the Worker's domain, `/admin` (and `/admin/*`) and `/api/admin/*`, and a policy allowing the owner's email (one-time PIN or a Google login). Cloudflare then asks for that login before the Worker sees the request; the page keeps asking for the token behind it. The tests run without Access, against the token.

Each admin action is one Durable Object call plus a registry write; the list and the totals are two D1 reads. Reports write one row in the board and refresh its registry row, so a report flood costs at most 200 rows per board (`LIMITS.reports`) and one registry write each, within the per-IP API limit.

## Official templates and public lists

The templates' boards (D110) are published on demand: the first request of a template page or of the Popular list in a language publishes what is missing (one Durable Object call and one registry write per template, once). Each template page is then one registry read, two Durable Object calls (view, link preview data) and one assets fetch, kept five minutes in the edge cache; the Popular list is one registry read, kept five minutes too; the sitemap one assets fetch and one registry read, kept an hour; a board's page (its link preview head) one Durable Object call, kept a minute per URL. A Worker's response is not cached at the edge by its `Cache-Control` alone: `worker/src/cache.ts` keeps the copies in the colo's `caches.default`, keyed by URL (query included). The `CACHE_SECONDS` variable caps these times, `0` turns the cache off (the tests). Browsers still read `Cache-Control` (five minutes for the list and the template pages, an hour for the sitemap). The official boards never expire (no alarm) and vote like any board; the admin moderates them from the same page (hidden: their page goes `noindex` and leaves the sitemap and the list).

## Deploying

Needs a Cloudflare account; the free plan is enough to start, and an account that already hosts other sites works as is (Versus is one more Worker named `versus`). Free-plan quotas are per account, shared by all its projects: requests for static assets are free and unlimited, while Worker requests (API calls and WebSocket connections; a vote is 1/20 of a request) and Durable Object SQLite writes (one per vote) count against the daily limits (see Costs). When a free limit is reached, requests fail until the daily reset; nothing is billed. The $5/month Workers Paid plan lifts the limits for the whole account.

### From CI (recommended)

The `deploy-worker` job in `.github/workflows/ci.yml` runs `npm run worker:deploy` on every push to `main` once the repository is configured. Until then it is skipped.

1. **API token**: Cloudflare dashboard → *My Profile* → *API Tokens* → *Create Token* → template *Edit Cloudflare Workers*. Add the permission *Account* · *D1* · *Edit* if the template lacks it, and limit it to your account.
2. **GitHub**: *Settings* → *Secrets and variables* → *Actions*:
   - secret `CLOUDFLARE_API_TOKEN`: the token;
   - variable `CLOUDFLARE_ACCOUNT_ID`: the account ID (Workers & Pages overview, right column). Setting it turns the job on.
3. **Deploy**: merge to `main`, or run the CI workflow by hand (*Actions* → *CI* → *Run workflow* on `main`). The first run creates the Worker, the Durable Object class, the R2 bucket `versus-images` (`npm run worker:bucket`, which needs the token to have *Workers R2 Storage* · *Edit*, and the account's R2 enabled once in the dashboard) and the D1 database, then applies the D1 migrations. The app answers at `https://versus.<account subdomain>.workers.dev`.
4. **Secrets of the Worker** (once it exists), in *Workers & Pages* → `versus` → *Settings* → *Variables and Secrets*, type *Secret*, or with `npx wrangler secret put <NAME> -c worker/wrangler.jsonc`:
   - `ADMIN_TOKEN`: a long random string (`openssl rand -base64 32`); the admin API and the moderation page (`/admin/`) stay off without it. Then consider Cloudflare Access in front of both (Moderation above);
   - `TURNSTILE_SECRET`: optional, see below.
   Deploys never delete secrets. One plain variable (type *Text*, or `vars` in `wrangler.jsonc`) turns pictures on: `IMAGES_UPLOAD` = `review` (D114); unset, published rankings take text and colors only.
5. **Custom domain**: `versus` → *Settings* → *Domains & Routes* → *Add* → *Custom domain*, for example `versus.example.com` on a zone of the account. Cloudflare creates the DNS record and the certificate. Deploys keep it, since the config declares no routes. The workers.dev address stays on. Then set the GitHub variable `SITE_URL` to the new address (`https://versus.example.com/`): the canonical URL, social card, sitemap and llms.txt of both builds move to it on the next deploy (`docs/seo.md`).

### Turnstile (optional)

Create a widget in *Turnstile* for the custom domain (and the workers.dev host if you use it), then:

- set the site key as the GitHub variable `TURNSTILE_SITE_KEY` (the CI build reads it; it is public);
- set the secret key as the Worker secret `TURNSTILE_SECRET`.

Set both, or neither. The server requires a token when `TURNSTILE_SECRET` is set, and the app shows the widget when the site key was set at build time: at publication, and before a voter's first vote on one of the site's own boards (the official templates, open to everyone and listed publicly; a voter who already voted there is never asked).

### By hand

`npx wrangler login`, then `npm run worker:deploy`, then the secrets and domain as above. For Turnstile, put the site key in `.env.worker` as `VITE_TURNSTILE_SITE_KEY`.

### GitHub Pages

The Pages site keeps deploying without publishing. It lives under `/versus/`: CI builds it with `VITE_BASE_PATH=/<repository>/`, which the app's `<base>` needs for its deep paths (D92); Pages answers those paths with `404.html`, which hands them to the app. Rankings are stored per origin, so rankings made on github.io don't appear on the new address. Retire Pages, or point it to the new address, once the Worker's address is settled.
