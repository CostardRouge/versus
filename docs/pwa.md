# Installable, offline app (PWA)

Last updated 2026-09-30. Web first (D75): Versus is a web app, made installable and usable offline without a framework or a PWA library. Native apps, if store presence is ever wanted, would be a Capacitor shell around this same build.

## What is in place

- **Manifest**: generated from `build/site.ts` (name, colors, icons, `standalone`, D98). It opens the app (`start_url: ./app/`); its `id` stays `./`, what it was before the home page, so installed copies remain the same app (D87).
- **Service worker** (`src/sw/sw.ts`, about 90 lines, 0.9 kB gzip), built as `sw.js` at the site's root by `build/pwa-plugin.ts`; its scope is the whole site, the app registering it from `app/` with `../sw.js`:
  - **Install**: stores the three pages (the app and the two home pages), their scripts and styles (the moderation page's bundle, `admin-*`, excepted: nothing to moderate offline), the three latin fonts of the first render, the manifest and the SVG icon (about 500 kB before compression). Each page is stored under its folder's address (`./app/`, `./`, `./fr/`), which GitHub Pages and Cloudflare both serve directly. Requests use `cache: 'reload'` so the HTTP cache can't hand back the previous deploy.
  - **Fetch**: a navigation to the app or one of its views (anything under `app/`) gets the stored page; a navigation to a home page goes to the network first, so it is always current, and falls back to the stored copy offline; stored files and anything under `assets/` are served from the cache first, and font subsets for other scripts are stored on first use (hashed names never change). Everything else goes to the network untouched: `/api/`, WebSockets, other origins (the audience measurement tracker included, `docs/analytics.md`), non-GET requests, the legal pages (`legal/`, `fr/mentions-legales/`: not needed offline), `robots.txt`, `llms.txt`, the social card and PNG icons.
  - **Activate**: deletes the older `versus-*` caches and takes control of open pages.
  - **Version**: a hash of the stored files' names and bytes (`build/pwa.ts`), written into the worker at build time. A deploy that changes the app changes `sw.js`, so browsers install the new worker.
- **In the app** (`src/app/pwa.ts`):
  - Registered in production builds only, after the page's `load`, so storing the files doesn't compete with the first render. The dev server runs without a worker.
  - **Updates are offered, never forced** (D78): once a new worker is installed and waiting, a bar above the header says a new version is ready, with **Reload** and **Later**. Reload asks the worker to take over, then the page reloads. Later hides the bar; the new version starts once every tab of the app is closed. An open app checks for a new version when it comes back to the foreground, at most hourly.
  - **Install button** in the header, shown only when the browser offers installation (`beforeinstallprompt`: Chrome and Edge on desktop and Android). It replaces Chrome's mini-infobar on Android. A toast confirms the installation.
  - **Persistent storage** (`navigator.storage.persist()`) requested in the installed app only: installed apps get it silently, while a tab in Firefox would show a prompt.
- **Icon shortcuts** (`SHORTCUTS` in `build/site.ts`, D123): a long press on the installed app's icon (Android), or a right click (desktop), offers **New ranking** and **Resume your ranking**. Each opens `app/?shortcut=new|last`; the app reads it once and drops it from the address (`parseShortcut()` in `src/core/route.ts`). Resume opens the ranking changed last, or its board if it is published.
- **Share target** (`share_target` in the manifest, `src/sw/sw.ts`, `src/app/inbox.ts`, D121, D122): Versus appears in the system's share sheet once installed (Android, installed Chrome; not iOS).
  - The share is a POST to `app/share-target` (title, text, link, files: images and Versus files). The service worker answers it: it puts the share in a cache of its own, `versus-inbox` (replacing one never picked up; 60 files at most), then redirects to `app/`.
  - At startup the app picks the inbox up and empties it. A Versus file is imported. Photos become image items; text is read like a paste: a list gives its items, a link alone gives the page's title.
  - The user picks where: a new ranking (the shared title, or "Images · date" / "Shared · date") or one of their eight latest; with none of their own, a new one directly. Demos and published rankings aren't offered.
- **Images in IndexedDB** (`src/core/images.ts`, `src/app/images.ts`, D118–D120):
  - An item's image is a data URL in memory, as always. In `localStorage` it becomes a reference, `idb:<key>`, once IndexedDB (database `versus`, store `images`, a record `{ key, data, t }` per image) holds it. The key comes from the content: an image used twice is stored once.
  - **Saving** (`save()` in `src/app/state.ts`): images already stored are written as references; a new one is written inline, stored, then the rankings are written again, smaller. The storage warning waits for that second write. An import stores its images first, then writes the rankings.
  - **Startup**: references are read before the first render. One that can't be read stays a reference, saved again unchanged, and the item shows its label. Images saved inline before D118 move to IndexedDB on the first load.
  - **Clean-up**: five seconds after startup, images no ranking uses and stored more than a day ago are removed.
  - Without IndexedDB (an old browser, some private modes), images stay inline in `localStorage`, as before.
- **Export and import** (`src/core/backup.ts`, `src/app/backup.ts`, D97–D101):
  - **Export** under the gallery's rankings: a backup file (`versus-2026-09-30.json`) with every ranking except the demos, the owner tokens of published boards, the "Your votes" cards and the voter id. When it holds owner tokens, a toast says the file gives control of those boards. **Export** in a ranking's results: that ranking alone (`versus-<title>.json`), without its board link, to send to someone.
  - The file goes through the share sheet on touch devices (Save to Files, AirDrop, a message), and as a download elsewhere.
  - **Import** under the gallery's rankings, or a `.json` file dropped anywhere. Nothing is ever replaced: new rankings keep their id (and their address), identical ones are skipped, a different version comes in as a copy; missing owner tokens and cards are added; the file's voter id is taken only by a browser that has neither voted nor published. A toast sums it up ("Imported: 3 rankings, 1 already here").
  - The file is untrusted: only image data URLs, valid colors and duels on known items come in, and a file from a newer version is refused.

## The move to app/ (2026-09-30)

The app lived at the site's root until the home page took it (D84). What keeps working:

- **Installed apps** open their stored start address, the root: the home page's first script sees the app's display mode (`standalone`, or `minimal-ui` for copies installed before D98) and sends it to `app/` before the first paint, offline too (the home page is stored). Browsers update the manifest by its unchanged `id`, and new installs open `app/` directly.
- **Old links** whose route is in the fragment (`/#/b/<alias>`) are sent to `app/` with their fragment, on arrival and on a fragment change.
- **Existing workers**: the worker of the previous deploy serves its stored app at the root until the new one takes over; the page it shows offers the update as usual (D78), and after Reload the root is the home page. Rankings are untouched: `localStorage` belongs to the origin, not the path.

## By platform

| Platform | Install | Offline | Notes |
| --- | --- | --- | --- |
| Chrome, Edge (desktop) | The header button or the address bar icon; own window | Yes | |
| Chrome (Android) | The header button; icon on the home screen, own window | Yes | Same storage as the browser: rankings are there. |
| Safari (iOS, iPadOS) | Share → Add to Home Screen; the icon opens an app window | Yes | No install prompt. The home-screen app has its own storage, apart from Safari's: empty, it explains how to bring the rankings (Export in Safari, Import in the app). An icon added before D98 still opens Safari; adding it again gives the app window. |
| Firefox (desktop) | No | Yes | |
| Firefox (Android) | Menu → Install | Yes | |

## Checking it by hand

On the deployed site, in Chrome:

1. Open the app (`/app/`), then DevTools → Application → Service workers: `sw.js` is activated with the site's root as scope. Cache storage holds `versus-<version>` with the three pages, the bundles and the fonts.
2. Network → Offline, then reload: the gallery and the demos open, a duel works, fonts are right.
3. After the next deploy, come back to the tab (or reload): the bar "A new version of Versus is ready" appears. Reload shows the new version; the old cache is gone.
4. On an Android phone: open the site in Chrome, tap Install in the header, open Versus from the home screen, turn on airplane mode, open it again.
5. Images: add a few dozen photos to a ranking, then DevTools → Application: Local storage `versus-v1` holds `idb:…` references, IndexedDB → `versus` → `images` holds the photos. Reload: the photos are there. (Tested with Playwright: 120 photos, 26 MB, `localStorage` at 15 kB, no warning.)
6. Sharing to Versus, on Android with the app installed: in the gallery app, select a few photos → Share → Versus. The app opens and asks where to add them. Same from a notes app with a list. A manifest change reaches an installed app when Chrome updates it (up to a day); reinstalling applies it at once.
7. Shortcuts: long-press the installed app's icon on Android (right-click it on desktop): New ranking opens a new ranking, Resume opens the last one. A manifest change reaches an installed app when Chrome updates it.
8. On an iPhone: in Safari, open the app, tap Export under your rankings and save the file to Files. Share → Add to Home Screen, open Versus from the icon: an app window, with a note saying the rankings from Safari aren't here. Tap Import, pick the file: the rankings appear.

These steps were run in Chromium with Playwright while building this (served under `/versus/` like GitHub Pages, with two builds to simulate a deploy); the script is a starting point for the end-to-end tests on the roadmap.

## Limits

- **App views are paths** (D92): every navigation under `app/` (`app/demo/…`, `app/b/…`) gets the stored app page, which reads its path; its `<base>` names the app's folder, so the page's relative addresses hold at any depth.
- **Published boards need the network**: votes and the crowd ranking are live. Offline, the local rankings work; boards don't.
- **Storage**: rankings live in `localStorage` (about 5 MB), images in IndexedDB (D118), which holds far more. Safari may clear a site's storage, both kinds together, after seven days of browsing without a visit to it, except for home-screen apps: an export is the backup.
- **Other tabs**: after Reload in one tab, other tabs keep the old version until they reload. The old cache is deleted, so an old tab that needs a file it never loaded fetches it from the network.

## Next steps (proposed order)

1. ~~**Export / import**, then **`display: standalone`**~~: done (D97–D101).
2. ~~**Images in IndexedDB**~~: done (D118–D120).
3. ~~**Share target**~~: done (D121, D122).
4. ~~**Manifest shortcuts**~~: done (D123). **Screenshots** for Chrome's richer install dialog remain.
5. **Notifications** for published boards (Web Push) once the backend is deployed: a board closes, results are revealed. On iOS, only for home-screen apps, which are now `standalone`.
6. **Capacitor shell**, only if the stores are ever wanted (D75): same build, native push and app links.

Done since: the native share sheet (Web Share API) with the result drawn as an image, from the Ranking tab, a board, a duel and the end-of-vote page (D110, D111).
