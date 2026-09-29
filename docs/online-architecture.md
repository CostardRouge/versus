# Online architecture (proposal)

Status: **proposed, not implemented**. Discussed on 2026-09-29. Goal: shared, real-time boards for potentially hundreds of thousands of users, on a near-zero budget.

## Load estimate

- 300,000 users/month ≈ 10,000/day.
- A duel is a few bytes and microseconds of compute.
- Even at 50 duels per person: ~500,000 messages/day ≈ 6/s on average, a few hundred/s at peak.
- Conclusion: language speed is irrelevant at this scale. Cost comes from keeping servers and connections alive, so optimize architecture, not language.

## Proposed stack: Cloudflare, TypeScript end to end

```
Browser (Vite app, local-first)
   │  personal rankings: localStorage only, no requests
   │  shared boards: HTTPS + WebSocket
   ▼
Cloudflare static assets (same domain as the API)
   ▼
Worker (router: create/join board, auth by token, admin routes)
   ▼
Durable Object, one per shared board
   ├─ embedded SQLite: items, duels, settings, owner token hash
   ├─ WebSockets with hibernation (no cost while idle)
   ├─ single-threaded: no write conflicts
   ├─ alarms: TTL cleanup of inactive boards
   └─ runs src/core scoring (same code as the browser)
R2: shared images (no egress fees)
```

Why each piece:

- **Local-first** is the main cost lever: only shared boards touch the server.
- **One Durable Object per board** gives a natural unit of state, concurrency and cleanup, and a collision-free ID.
- **Same TypeScript core** on both sides: one language, no scoring drift between client and server.

## Costs (Cloudflare pricing as of September 2026, check before relying on it)

Free plan:
- Workers: 100,000 requests/day, 10 ms CPU per invocation.
- Durable Objects: 100,000 requests/day, 13,000 GB-s/day. Incoming WebSocket messages are billed at a 20:1 ratio (100 messages = 5 requests); outgoing messages are free.
- Durable Object SQLite: 5 M row reads/day, 100,000 row writes/day, 5 GB stored.
- R2: 10 GB-month storage, free egress.

Paid plan: $5/month minimum, including 10 M Worker requests/month; DO includes 1 M requests + 400,000 GB-s/month; SQLite 50 M row writes/month.

Example: 60,000 shared duels/day ≈ 3,000 billable DO requests (20:1) + 60,000 row writes → within the free plan.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Main risk: the viral board

A Durable Object processes messages one at a time; a board with thousands of simultaneous voters would saturate it. Mitigations:

- Batch votes client-side (send every 1–2 s).
- Broadcast the aggregated ranking at 1–2 Hz instead of on every vote.
- Spectators are read-only; voting may require a lightweight session.
- If ever needed: shard votes across several objects and merge (BT is order-independent, so merging duel sets is exact).

## Alternatives considered

| Stack | Strength | Limit for Versus |
| --- | --- | --- |
| Elixir / Phoenix | Best-in-class classic real-time (channels, presence, huge connection counts) | Needs an always-on server: fixed cost and ops |
| Go | Single binary, very frugal on a small VPS | Same server constraint; second language to maintain |
| Rust | Maximum performance, runs on Workers via WebAssembly | No measurable gain here, slower development |
| Zig | Technically interesting | Web ecosystem too young |
| Node on a VPS | Familiar | Fixed cost, ops, scaling is manual |

**Plan B, free:** the home Dell Optiplex (Ubuntu Server) exposed through Cloudflare Tunnel, with Node + SQLite. Good for a private beta; depends on home bandwidth and uptime, so not suited to viral traffic.

## How the stack answers the open questions

- **IDs without collision:** the Durable Object's unique ID, plus a short alias for sharing, reserved atomically.
- **Owner rights:** an owner token generated at creation (stored hashed); later accounts if needed.
- **Open vs locked settings:** stored in the board's SQLite and enforced in the object.
- **Cleanup:** per-board alarm resetting on activity; deletion after the TTL.
- **Admin:** protected Worker routes (Cloudflare Access or a secret) to list, lock and delete boards.

Details to settle are listed in `docs/roadmap.md` (open questions).
