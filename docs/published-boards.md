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
- While published, the author's gallery shows the board with a "Published" or "Closed" badge; its content lives on the server. Opening it shows the author the workspace a local ranking has (D116): the items pane, the Duel and Ranking tabs, the title in the header, the score menu, and a Published button that opens the board's settings (links, visibility, options, close or reopen, withdraw). Visitors see the board page.
- **Links** are paths of the app (D92): `…/app/b/<alias>` to share, `…/app/b/<alias>#owner=<token>` as the admin link, the token in the fragment so it never reaches a server. Opening an admin link stores the token in this browser and removes it from the address bar. Links from before (`#/b/<alias>`, `?owner=`) still open and are rewritten to the path form. **New admin link**, in the settings behind the Published button, replaces the token (an admin link shared by mistake, a lost device): the old link stops working everywhere, this browser keeps the new one and copies the new link; the author's open connection stays the author's.
- If a board turns out to be gone (withdrawn elsewhere or expired), nothing is deleted automatically: the author's page offers to go back to the local version, which also forgets the owner token.
- Text and color items; pictures only through review, when the server allows them (Images below). Otherwise a ranking containing images can't be published (the modal says why).
- **Link previews** (D104): the board's page carries its title, a description in the board's language (stored at publication) and a card drawn by the app (title, podium or items, 1200×630), so the link pasted in a chat or a feed shows the board. A duel link (`?duel=a.b`) shows its two items as the app's cards. The board's card is sent by its author, at publication and when sharing from the app (with the owner token); it shows the standings only when everyone may see them (results always visible, or the vote closed), the items in board order otherwise, and the server drops it when the ranking stops showing to everyone (results hidden again, a vote reopened). A duel's card is sent by whoever shares that duel first; another visitor can't replace it, the author can. The site's own boards take no card from visitors. The server keeps one per board and up to 40 per board's duels, and deletes them with the board; the admin can delete a board's cards.

## Sharing

- **Share as an image** (D102, D103), from three places: the board page (the crowd's standings as this viewer may see them, or the items when the crowd is hidden), the duel on screen (its two cards, with a link that opens the board on that duel, D105), and the end-of-vote page (the viewer's ranking facing the crowd's, with the agreement; their own ranking alone while the crowd stays hidden). Local rankings have it too, from the Ranking tab, with a link to the site.
- The panel shows the card in the format chosen (post 4:5, story 9:16, landscape), and offers the system share sheet with the image and a message that carries the link, or copying the message, copying the image, downloading it. The format chosen stays for the session.
- **Which picture** (D117): where the page has several views of the result, the panel opens on the one on screen and offers the others above the formats. The end-of-vote page: the crowd's podium, the voter's podium, the voter facing the crowd (the crowd's two only while it is visible). A local ranking's Ranking tab: its podium, or its lines facing the method they compare it with.
- **Make my own** (D106): on the board page and the end-of-vote page (not for the author), and on a card under Your votes, a button makes a ranking of this browser with the board's title and items, without votes, to change and publish.

## Moderation

Decided on 2026-09-30 (D107 to D109), built in `worker/`, `src/admin/` and the board page.

- **Report** (visitors, not the author): a link at the end of the board page opens a small form, a reason (spam or advertising; hateful, violent or sexual content; personal data or harassment; something else) and an optional note (300 characters). The report travels with the browser's anonymous voter id, so a browser counts once: a new report replaces its previous one. Only the board's voters report: a voter id with no vote on the board is refused, and the form says to vote at least once. A board keeps 200 voters' reports at most. Reports are anonymous: nobody answers the reporter. Reporting isn't an activity for the inactivity TTL.
- **The admin page**, `/admin/`, is the publisher's: the boards of the registry with their counts, flags and report counts, filters (all, reported, featured, hidden, open, closed), a title search, and per board the full view (ranking included, whatever its visibility), the reports with their reasons and notes, and the actions: close or reopen the vote, feature, hide, remove an item, mark the reports reviewed, take the board down. It asks for the Worker's `ADMIN_TOKEN` and keeps it in the page's memory only (no storage: a reload asks again, and its home link opens in another tab); wrong token, back to the form. English or French from the browser's language. Out of the index and of the offline cache.
- **Hidden**: the board keeps working for whoever has its link, and its link previews too, but it appears in no public list: the Popular section, and for an official template its page leaves the sitemap and goes `noindex`. **Featured**: it comes first in the Popular section. Voters see neither flag; the author isn't told. Neither counts as activity for the TTL.
- **Take down** deletes the board for everyone, with its cards and registry row, and leaves no copy; the author's page says the board is gone. Remove an item drops its votes, as the author's own removal does.
- The legal notice tells reporters what a report sends and gives the contact address for what the button can't say.

## Images

Decided on 2026-09-30 (D113, D114), built in `worker/src/pictures.ts`, the publish flow and the moderation page.

- **Off by default.** The Worker's `IMAGES_UPLOAD` variable set to `review` turns pictures on; the app asks `GET /api/config` when a ranking with images is about to be published, and keeps refusing it (with the same message as before) while they are off.
- **Announced, sent, reviewed.** When they are on, the publish modal says that the pictures will be sent to the moderator and show once approved. The request announces each picture (`pic: 'pending'` on the item, never the bytes); right after publishing, the app sends each picture (the 640 px JPEG it keeps, under 250 KB) with the author's token. Meanwhile the item shows as text to everyone; the author's items list says "Picture awaiting review" under its name.
- **The moderation page** lists the boards with pictures to review (a filter, a count in the totals) and shows the pictures with their item's label, Approve or Refuse. An approval names the picture the moderator was shown (its ETag): if the author sent another one since, the server refuses (`changed`) and the page shows the new one to look at. Approved, the picture becomes public at `/img/b/<alias>/<item>.jpg`, the item shows it at once (every open board is pushed the new state) and the link preview cards drawn later carry it. Refused, the picture is deleted and the author's items list says "Picture refused by the moderator"; the item stays as text.
- **Lifecycle.** A picture goes with its item (removed by the author or the admin) and with the board (withdrawn, taken down, expired). The author can add images after publication too (dropped, pasted or chosen in the items pane): they are added as items that announce a picture, then sent the same way; the pane offers images only when the server reviews them. Visitors' suggestions never carry one.
- The site's own boards (official templates) may carry picture addresses directly, as the site's content.

## Official templates and the Popular section

Decided on 2026-09-30 (D110 to D112), built in `src/core/templates.ts`, `worker/src/templates.ts` and `src/app/popular.ts`.

- **Official templates** are fixed lists on divisive topics (game consoles, video games, programming languages, phone brands, computers, cameras, Star Wars films, French pastries, pizzas, streaming services, social networks, superheroes, colors), in English and French. Each becomes a real published board per language, published by the Worker the first time its page or the Popular list asks for it, with the site as author (`official`: it never expires, the admin moderates it like any board), the Balanced method, results always visible, votes open to everyone, no item changes by visitors. Being public and listed, they ask a new voter for a human check (Turnstile) before their first vote when the server has one configured; voters who already voted there aren't asked.
- **Template pages** at `/t/<slug>/` (English) and `/fr/t/<slug>/` (French), linked to each other by hreflang: the template's title and intro, the crowd's ranking as text with each item's share of won duels, the vote and voter counts, "Vote now" and "Make my own version" (both open the board in the app), how the ranking is made, and the other templates. Rendered by the Worker into the legal page's shell (header, footer, fonts), with the board's card as link preview when someone shared it. `noindex` until the board has 30 voters, then indexed and listed in the sitemap, which the Worker completes.
- **Popular**, a section of the gallery between the visitor's rankings and the demos: the boards the admin featured and the official templates of the app's language, the ones with the most votes in the last seven days first, then by voters; never a hidden board, never someone's unlisted board. A card shows the crowd's top three, the counts and the leader, and offers Vote (the board), Make my own (a ranking of this browser with the board's items, no votes; counted as `ranking-created` from `template`) and Copy link. The app asks for the list at most every ten minutes and stores nothing; offline or on the GitHub Pages copy, the section isn't there.

## Voting rules

- **One voice per voter per pair.** A new vote on a pair replaces the voter's previous one. A tie is a vote (half a win each). Heavy voters bring more information (more pairs covered), never more weight on a pair.
- **Voter identity**: an anonymous random id per browser (`localStorage`). Two devices or a private window count as two voters. Acceptable: Versus is a game, not an election. One address can bring at most 30 new voters to a board in 10 minutes (a household, a classroom, not a crowd of private windows); beyond, the first vote is refused for a while.
- **Anonymity**: nobody, the author included, sees who voted what. Only aggregates leave the server.
- **Changing one's vote** (author setting, on by default): a voter can delete one vote or all of theirs, and vote again. When off, votes are final, except undoing the very last vote for a few seconds (mis-taps).
  - Not a weighting risk: under one voice per pair, changing a vote never adds weight. The setting guards against strategic changes (see the results, then adjust) and suits "final vote" contests. The real abuse vector is multiplying identities (see `docs/online-architecture.md`, main risks).
- **The author edits items like in a local ranking** (D116, replacing "items locked once published"): rename in the list, recolor from the swatch, add one item or a pasted list (#hex codes become colors), remove with ×. An item without votes changes at once. With votes, the author answers one question: **keep the votes** (a correction: it is the same choice) or **start again from zero** (another choice: its votes are deleted for everyone and it comes first in duels). Keeping is checked first for a name, starting again for a color (the color is the item). Removing an item with votes, or with a picture, asks first and drops its votes; without, it goes at once and Undo brings it back as a new item. Voters aren't told of a rename. A closed vote freezes the list until the author reopens it (the pane says so, with the button). Items with the same color are flagged in the list. Visitors can suggest items when the author allows it (one every 5 seconds per connection), with the same add field. Same label twice is refused, a board keeps at least 2 items and at most 100. New items get priority in pair assignment.
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
- A link that names a duel (`?duel=a.b`) puts that pair first in the voter's queue, when both items are on the board, the voter hasn't voted on it and the board is open; otherwise the queue is as usual.
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

## Your votes (the voter's gallery)

Discussed on 2026-09-30, from mockups of four layouts (a section of its own, filters, one mixed grid, a "continue" shelf). The section won: it matches the gallery's structure and keeps what the voter owns apart from what they took part in.

- A board a visitor voted on gets a card in their gallery under **Your votes**, between their own rankings and the demos. The section is hidden while empty and says it lives on this device (no accounts).
- The card appears at the first vote, not on opening the link. Opening the board again with votes on it brings a forgotten card back.
- Boards managed from a local ranking stay under "Your rankings" with their Published badge. On another device, without that local ranking, a board voted on shows under Your votes.
- A card shows the crowd's top 3 when this voter may see it, otherwise their own top ("Your top"): never more than the board shows. Then the status (Open, Closed, Withdrawn), votes and voters, the crowd's leader and the agreement, and the voter's pairs voted out of all pairs (stability means nothing for a crowd).
- What changed since the voter's last visit to the board: results revealed (at closing, or when the author makes them visible), vote closed, items added (with the pairs left to vote on). A dot, and first place in the section; opening the board clears it.
- Order: news first, then the latest vote, boards that are gone last.
- **Forget** removes the card only: the board and the votes stay. The toast offers Undo instead of a confirmation.
- A board withdrawn or expired stays, greyed, with its last known state; **Keep a copy** turns it into a local ranking with its items and the voter's votes.
- Someone who has no ranking of their own yet (typically arriving through a shared link) sees Your votes first, and "Your rankings" shrinks to an invitation to create one.
- The first time a card appears, a toast says where it is kept.
- Freshness: the gallery asks for every card in one request (`POST /api/summaries`, the 24 most recent boards), at most once a minute. Offline, the cards keep their snapshot. The voter id travels in the request body, never in a URL.
- Stored in `versus-joined`: one snapshot per board (items, settings, status, counts, the order this voter may see, their votes, and what they saw on their last visit).

## Author settings

To keep publishing light, the modal shows four things: the warning, "push my votes", results visibility and the scoring method. The rest sits under "More options", with defaults. After publishing, the title and the method change from the workspace's header, the rest from the board's settings behind the Published button.

| Setting | Default | Where | After publishing |
| --- | --- | --- | --- |
| Push my local duels as my votes | On | Publish modal | One-time choice |
| Results visibility | Always | Publish modal | Editable (going blind again hides the ranking, but what was seen was seen) |
| Scoring method (Exact sort shown, greyed out) | The local ranking's method; Balanced if it was Exact sort | Publish modal | Editable (the score menu) |
| Title | The local ranking's | The workspace's header | Editable (the header) |
| N for "after N votes" | 10 | More options | Editable |
| Voters can change their votes | On | More options | Editable, applies to future changes |
| Visitors can add items | Off | More options | Editable |

## Still open

- Anti-abuse beyond per-IP limits and Turnstile at publication: an author option to require a check (Turnstile) per voter?
- Pictures for every author, or by author: today one variable turns the review queue on for everyone; a condition per author (an account, a track record) would need accounts.
- TTL of inactive published boards (proposal: 60 days without a vote) and warning the author before deletion.
