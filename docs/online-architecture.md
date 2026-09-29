# Online architecture (proposal)

Status: **prototype in `worker/`**, running locally and in tests, not deployed. Discussed on 2026-09-29. Goal: published (shared, real-time) boards for potentially hundreds of thousands of users, on a near-zero budget. Product behavior of published boards (lifecycle, voting rules, visibility, live updates) is in `docs/published-boards.md`.

## Load estimate

- 300,000 users/month ≈ 10,000/day.
- A duel is a few bytes and microseconds of compute.
- Even at 50 duels per person: ~500,000 messages/day ≈ 6/s on average, a few hundred/s at peak.
- Conclusion: language speed is irrelevant at this scale. Cost comes from keeping servers and connections alive, so optimize architecture, not language.

## Proposed stack: Cloudflare, TypeScript end to end

```
Browser (Vite app, local-first)
   │  local rankings: localStorage only, no requests
   │  published boards: HTTPS + WebSocket
   ▼
Cloudflare static assets (same domain as the API; the front moves off GitHub Pages)
   ▼
Worker (router: publish/join board, auth by token, admin routes)
   ├─ D1: board registry (alias, created, last activity day, status), for admin listing
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

## Prototype (`worker/`)

- `worker/src/index.ts`: routes `/api/boards` (publish, public view, WebSocket, owner actions with `Authorization: Bearer <owner token>`); the route list is at the top of the file.
- `worker/src/board-object.ts`: `BoardObject`, a thin adapter around `src/core/board.ts`. Loads the board from SQLite when it wakes (synchronous reads), keeps each voter's session (queue, skipped pairs, rate limit) in the WebSocket attachment so it survives hibernation, caches the crowd ranking for 1 s, broadcasts at most once per second.
- Protocol (`src/core/protocol.ts`): the client sends `hello` (voter id, owner token for the author), then `vote`, `skip`, `undo`, `reset`; the server answers `state`, `pairs`, `ranking` (null when not entitled) and `error`.
- App side: `src/app/remote.ts` (fetch helpers and a WebSocket that says hello on every connection, reconnects with a growing delay and asks the API whether a board still exists before calling it gone), `src/app/board.ts` (board page), `src/app/publish.ts` (publish modal). The app reaches the API at `/api` on its own origin, or `VITE_API_URL`; a production build without either hides publishing.
- Not built yet: D1 registry and admin routes, Turnstile, rate limiting per IP, item changes after publication, client-side vote batching, static assets on Cloudflare.
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
