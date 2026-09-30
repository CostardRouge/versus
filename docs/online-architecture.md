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
Worker (router: publish/join board, owner and admin auth, per-IP rate limits, Turnstile at publication)
   ├─ D1: board registry (alias, title, status, counts, last activity), for the admin API
   ▼
Durable Object, one per published board
   ├─ embedded SQLite: items, votes (one row per voter and pair), settings, owner token hash
   ├─ WebSockets with hibernation (no cost while idle)
   ├─ single-threaded: no write conflicts
   ├─ assigns pairs and runs src/core scoring (same code as the browser)
   ├─ enforces results visibility (never sends the ranking to a client not entitled to it)
   └─ alarm: TTL cleanup of inactive boards
R2: shared images (later, not in v1)
```

Why each piece:

- **Local-first** is the main cost lever: only published boards touch the server.
- **One Durable Object per board** gives a natural unit of state, concurrency and cleanup, and a collision-free ID.
- **Same TypeScript core** on both sides: one language, no scoring drift between client and server.
- **Server-assigned pairs**: required by blind mode (the browser never needs the crowd ranking) and blocks targeted vote stuffing (votes are accepted only on assigned pairs).
- **D1 registry**: Durable Objects can't be listed with their data, so the admin view needs its own index. Updated at most once a day per board to spare writes.

## Implementation (`worker/`)

- `worker/src/index.ts`: routes `/api/boards` (publish, public view, WebSocket, owner actions with `Authorization: Bearer <owner token>`, items) and `/api/admin` (list, totals, inspect, close, remove an item, take down, with `Authorization: Bearer <ADMIN_TOKEN>`); the route list is at the top of the file.
- `worker/src/registry.ts` + `worker/migrations/`: the D1 registry. Each board writes its row on publication, status and item changes, and at most once a day for votes; the row goes when the board does.
- Limits: the `PUBLISH_LIMIT` (5 publications per minute) and `API_LIMIT` (120 requests per minute, WebSocket connections included) rate limiting bindings, keyed by client IP; votes and skips are limited per connection (150 ms), item suggestions per connection (5 s).
- `worker/src/turnstile.ts`: with `TURNSTILE_SECRET` set, publishing requires a Turnstile token (the app shows the widget when `VITE_TURNSTILE_SITE_KEY` is set).
- `worker/src/board-object.ts`: `BoardObject`, a thin adapter around `src/core/board.ts`. Loads the board from SQLite when it wakes (synchronous reads), keeps each voter's session (queue, skipped pairs, rate limit) in the WebSocket attachment so it survives hibernation, caches the crowd ranking for 1 s, broadcasts at most once per second.
- Protocol (`src/core/protocol.ts`): the client sends `hello` (voter id, owner token for the author), then `vote`, `skip`, `undo`, `reset`; the server answers `state`, `pairs`, `ranking` (null when not entitled) and `error`.
- App side: `src/app/remote.ts` (fetch helpers and a WebSocket that says hello on every connection, reconnects with a growing delay and asks the API whether a board still exists before calling it gone), `src/app/board.ts` (board page), `src/app/publish.ts` (publish modal). The app reaches the API at `/api` on its own origin, or `VITE_API_URL`; a production build without either hides publishing.
- The Worker serves the app too (`assets`, from `dist/`). `npm run worker:dev` builds it in `worker` mode (`.env.worker`: `VITE_API_URL=/`), so publishing works on http://localhost:8787 with the real Worker; `npm run dev` keeps hot reload and proxies `/api` to it.
- Not built: client-side vote batching. Each vote costs 1/20 of a request (WebSocket billing), so batching only pays off for a viral board, and it would need a longer pair queue; left for when a board needs it. No admin page yet: the admin API is meant for curl or a later page behind Cloudflare Access.
- Known cost: waking a board reads all its votes (one row read each). Fine at this stage; per-pair totals can be cached if large boards wake often.

## Costs (Cloudflare pricing as of September 2026, check before relying on it)

Free plan:
- Workers: 100,000 requests/day, 10 ms CPU per invocation.
- Durable Objects: 100,000 requests/day, 13,000 GB-s/day. Incoming WebSocket messages are billed at a 20:1 ratio (100 messages = 5 requests); outgoing messages are free.
- Durable Object SQLite: 5 M row reads/day, 100,000 row writes/day, 5 GB stored.
- D1: 5 M row reads/day, 100,000 row writes/day, 5 GB stored.
- R2: 10 GB-month storage, free egress.

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

**Multiplied identities.** A voter is an anonymous id per browser, so a private window is a new voter. One voice per pair and server-assigned pairs cap what one identity can do; the rest relies on rate limits per connection and IP, and Turnstile (at publication, optionally per voter).

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
- **Owner rights:** an owner token generated at publication, stored hashed in the object. The author keeps it in `localStorage` and in an admin link (`…#/b/<alias>?owner=…`: the fragment never reaches server logs or referrers). No accounts at first.
- **Settings:** stored in the board's SQLite and enforced in the object (visibility, scoring method, vote changes, visitors adding items).
- **Cleanup:** the alarm is set to last vote + TTL. When it fires, it checks the last vote time and either reschedules or deletes the board: no extra write per vote.
- **Admin:** protected Worker routes (a secret, then Cloudflare Access) reading the D1 registry to list, inspect, lock and delete boards, and to watch usage against free-tier limits.

Remaining questions are listed in `docs/published-boards.md` (still open) and `docs/roadmap.md`.

## Deploying

Needs a Cloudflare account; the free plan is enough to start, and an account that already hosts other sites works as is (Versus is one more Worker named `versus`). Free-plan quotas are per account, shared by all its projects: requests for static assets are free and unlimited, while Worker requests (API calls and WebSocket connections; a vote is 1/20 of a request) and Durable Object SQLite writes (one per vote) count against the daily limits (see Costs). When a free limit is reached, requests fail until the daily reset; nothing is billed. The $5/month Workers Paid plan lifts the limits for the whole account.

### From CI (recommended)

The `deploy-worker` job in `.github/workflows/ci.yml` runs `npm run worker:deploy` on every push to `main` once the repository is configured. Until then it is skipped.

1. **API token**: Cloudflare dashboard → *My Profile* → *API Tokens* → *Create Token* → template *Edit Cloudflare Workers*. Add the permission *Account* · *D1* · *Edit* if the template lacks it, and limit it to your account.
2. **GitHub**: *Settings* → *Secrets and variables* → *Actions*:
   - secret `CLOUDFLARE_API_TOKEN`: the token;
   - variable `CLOUDFLARE_ACCOUNT_ID`: the account ID (Workers & Pages overview, right column). Setting it turns the job on.
3. **Deploy**: merge to `main`, or run the CI workflow by hand (*Actions* → *CI* → *Run workflow* on `main`). The first run creates the Worker, the Durable Object class and the D1 database, then applies the D1 migrations. The app answers at `https://versus.<account subdomain>.workers.dev`.
4. **Secrets of the Worker** (once it exists), in *Workers & Pages* → `versus` → *Settings* → *Variables and Secrets*, type *Secret*, or with `npx wrangler secret put <NAME> -c worker/wrangler.jsonc`:
   - `ADMIN_TOKEN`: a long random string (`openssl rand -base64 32`); the admin API stays off without it;
   - `TURNSTILE_SECRET`: optional, see below.
   Deploys never delete secrets.
5. **Custom domain**: `versus` → *Settings* → *Domains & Routes* → *Add* → *Custom domain*, for example `versus.example.com` on a zone of the account. Cloudflare creates the DNS record and the certificate. Deploys keep it, since the config declares no routes. The workers.dev address stays on.

### Turnstile (optional)

Create a widget in *Turnstile* for the custom domain (and the workers.dev host if you use it), then:

- set the site key as the GitHub variable `TURNSTILE_SITE_KEY` (the CI build reads it; it is public);
- set the secret key as the Worker secret `TURNSTILE_SECRET`.

Set both, or neither. The server requires a token when `TURNSTILE_SECRET` is set, and the app shows the widget when the site key was set at build time.

### By hand

`npx wrangler login`, then `npm run worker:deploy`, then the secrets and domain as above. For Turnstile, put the site key in `.env.worker` as `VITE_TURNSTILE_SITE_KEY`.

### GitHub Pages

The Pages site keeps deploying without publishing. Rankings are stored per origin, so rankings made on github.io don't appear on the new address. Retire Pages, or point it to the new address, once the Worker's address is settled.
