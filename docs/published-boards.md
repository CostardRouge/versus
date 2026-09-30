# Published boards (agreed model)

Status: **implemented, not deployed**: server in `worker/` (rules in `src/core/board.ts`), app in `src/app/publish.ts` and `src/app/board.ts`. Runs locally with `npm run worker:dev`. Discussed on 2026-09-29. Describes how a ranking goes from private to public and how a crowd votes on it. Infrastructure is in `docs/online-architecture.md`. "Published board" and "shared board" mean the same thing.

## Two kinds of rankings

- **Local**: private, stored in `localStorage`, one person's duels. What exists today.
- **Published**: lives on the server; anyone with the link can see it and vote.

A board is born local and published when its author is ready. Lifecycle:

```
local ──publish──▶ published ──close──▶ closed
                       ▲                  │
                       └──────reopen──────┘
published or closed ──withdraw──▶ local copy (server data deleted)
```

- **Publish**: a modal warns that the ranking becomes public (anyone with the link can see it and vote) and that it can be withdrawn at any time. The author chooses whether their local duels are pushed as their own votes (repeated duels on a pair collapse to the last one) or whether the board starts with no votes.
- **Close**: votes are frozen and the board is read-only; results become visible to everyone (this is when a blind board is revealed). The author can reopen it.
- **Withdraw**: the board is deleted from the server and its link shows "withdrawn". The author keeps a local copy with the crowd's result (items + every vote as an anonymous duel). Very large boards may need per-pair totals instead of individual duels to fit in `localStorage`.
- While published, the author's gallery shows the board with a "Published" or "Closed" badge; its content lives on the server.
- **Links** live in the URL fragment: `#/b/<alias>` to share, `#/b/<alias>?owner=<token>` as the admin link. Opening an admin link stores the token in this browser and removes it from the address bar.
- If a board turns out to be gone (withdrawn elsewhere or expired), nothing is deleted automatically: the author's page offers to go back to the local version, which also forgets the owner token.
- v1: text and color items only. A ranking containing images can't be published (the modal says why). Images come later, with R2 storage and moderation.

## Voting rules

- **One voice per voter per pair.** A new vote on a pair replaces the voter's previous one. A tie is a vote (half a win each). Heavy voters bring more information (more pairs covered), never more weight on a pair.
- **Voter identity**: an anonymous random id per browser (`localStorage`). Two devices or a private window count as two voters. Acceptable: Versus is a game, not an election.
- **Anonymity**: nobody, the author included, sees who voted what. Only aggregates leave the server.
- **Changing one's vote** (author setting, on by default): a voter can delete one vote or all of theirs, and vote again. When off, votes are final, except undoing the very last vote for a few seconds (mis-taps).
  - Not a weighting risk: under one voice per pair, changing a vote never adds weight. The setting guards against strategic changes (see the results, then adjust) and suits "final vote" contests. The real abuse vector is multiplying identities (see `docs/online-architecture.md`, main risks).
- **Items are locked once published**: renaming "Pizza" to "Sushi" after 200 votes would betray those votes. The author can still remove an item (its votes are dropped, after a confirmation) and add items from the author panel. A color item's color can change, from its swatch in the author panel, with the same logic: its votes were cast on the old color, so they are dropped (after a confirmation when there are some) and the item starts again from zero, keeping its name and place. Items with the same color are flagged there. Visitors can suggest items when the author allows it (one every 5 seconds per connection). Same label twice is refused, a board keeps at least 2 items and at most 100. New items get priority in pair assignment.
- **Scoring**: the author picks Balanced, Dynamic or Simple, and can switch later (everything is recomputed from the same votes).
  - Balanced (Bradley-Terry) is the recommended default. On pooled votes it estimates the probability that a random voter prefers A to B, and absorbs crowd contradictions (A > B, B > C, C > A among different people).
  - Dynamic becomes a "recent trend": it replays votes in arrival order (a changed vote takes its new time). Simple is biased by uneven opponents.
  - Exact sort is impossible: binary insertion needs one sequence of comparisons, not concurrent voters. The publish modal still lists it, greyed out with a one-line reason, to teach the difference. Use `aria-disabled` rather than `disabled` so the option and its reason stay readable by screen readers.

## Pair assignment (server side)

The board's Durable Object assigns pairs, not the browser:

- It reuses `src/core` pair selection: items with few votes and close crowd positions first, only pairs this voter hasn't voted on, avoiding the voter's previous items.
- It accepts a vote only on a pair it assigned to that voter, so a cheater can't vote only on pairs involving their favorite.
- The browser never needs the crowd ranking to get its next duel (required by blind mode).
- It sends a short queue of upcoming pairs (e.g. 3), refilled with each vote, so the next duel appears instantly.
- A skipped pair isn't offered again to that voter for a while; nothing is recorded.
- On a small board a voter can reach the end (every pair voted, n(n−1)/2); on large boards they stop when they want.

## Results visibility (author setting)

| Mode | Voters see the crowd ranking | Suits |
| --- | --- | --- |
| **Always** (default) | Live, while voting | Casual, social boards |
| **After N votes** | Once they have cast N votes (author picks N, default 10), or voted every pair when the board has fewer | Less anchoring, still some feedback |
| **Blind** | Only when the author closes the vote | Contests, unbiased results |

- In every mode, duel cards never show the crowd's score or rank: the duel itself stays blind.
- Enforced on the server: the ranking is never sent to a client that isn't entitled to it (hiding it in the UI would leak through devtools).
- Always visible to voters: vote and voter counts, and their own ranking (computed in the browser from their own votes).
- The author always sees the crowd ranking.
- "You vs the crowd" (share of your votes the crowd agrees with, e.g. "72% in agreement") appears only when the crowd ranking is visible to you.
- Why it matters: seeing popularity changes votes. In the MusicLab experiment (Salganik, Dodds & Watts, *Science*, 2006), showing download counts made winners win bigger and outcomes less predictable.

## Live updates

- On by default; each viewer can turn them off (remembered in this browser's preferences).
- On: the ranking reorders at most once per second, only when it changed, with a soft animation (none under `prefers-reduced-motion`).
- Off: the ranking stays frozen and a badge shows "37 new votes · Refresh".
- Items whose error margins overlap are shown as neck and neck rather than in a falsely precise order, so close items don't flicker.
- Stability no longer applies (a crowd ranking never ends). Show "you voted 14 duels" to the voter and "412 votes · 38 voters" for the board.

## End of the vote

When a voter has voted on every pair (n(n−1)/2), their result gets a page of its own, on the same link:

- It opens by itself right after the last vote, with a reveal (the count reaches its total, then the result appears; no animation under `prefers-reduced-motion`). Later, the board shows "You voted on every pair" with a "See your result" button.
- Two views of the same data, switched by two small icons at the top right (remembered in this browser, podium first):
  - **Podium**: the crowd's top 3 (the winner revealed last), a switch to the voter's own podium, the agreement with the crowd and the rest of the ranking.
  - **You vs the crowd**: the voter's ranking (computed in the browser from their votes) facing the crowd's, each item linked by a line; crossing lines are where they disagree. The heading names the crowd's winner; a list shows the voter's picks the crowd contradicts.
- Visibility still applies: on a blind board the crowd's side waits for the closing and the voter sees their own ranking.
- The crowd's side follows live updates (a new order re-renders it), or waits for "Refresh" when they are off.
- If the author adds items, the page says how many new pairs there are and its main button goes back to voting.

## Author settings

To keep publishing light, the modal shows four things: the warning, "push my votes", results visibility and the scoring method. The rest sits under "More options", with defaults, and stays editable in the board's settings.

| Setting | Default | Where | After publishing |
| --- | --- | --- | --- |
| Push my local duels as my votes | On | Publish modal | One-time choice |
| Results visibility | Always | Publish modal | Editable (going blind again hides the ranking, but what was seen was seen) |
| Scoring method (Exact sort shown, greyed out) | The local ranking's method; Balanced if it was Exact sort | Publish modal | Editable |
| N for "after N votes" | 10 | More options | Editable |
| Voters can change their votes | On | More options | Editable, applies to future changes |
| Visitors can add items | Off | More options | Editable |

## Still open

- Anti-abuse beyond per-IP limits and Turnstile at publication: an author option to require a check (Turnstile) per voter?
- Do boards a visitor voted on appear in their gallery ("Joined")?
- Moderation: the admin API can remove an item or take a board down; a report button for visitors is still to do.
- TTL of inactive published boards (proposal: 60 days without a vote) and warning the author before deletion.
