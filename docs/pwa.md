# Installable, offline app (PWA)

Last updated 2026-09-30. Web first (D75): Versus is a web app, made installable and usable offline without a framework or a PWA library. Native apps, if store presence is ever wanted, would be a Capacitor shell around this same build.

## What is in place

- **Manifest**: generated from `build/site.ts` (name, colors, icons, `minimal-ui`; see `docs/seo.md` for why not `standalone` yet). It opens the app (`start_url: ./app/`); its `id` stays `./`, what it was before the home page, so installed copies remain the same app (D85).
- **Service worker** (`src/sw/sw.ts`, about 90 lines, 0.9 kB gzip), built as `sw.js` at the site's root by `build/pwa-plugin.ts`; its scope is the whole site, the app registering it from `app/` with `../sw.js`:
  - **Install**: stores the three pages (the app and the two home pages), their scripts and styles, the three latin fonts of the first render, the manifest and the SVG icon (about 500 kB before compression). Each page is stored under its folder's address (`./app/`, `./`, `./fr/`), which GitHub Pages and Cloudflare both serve directly. Requests use `cache: 'reload'` so the HTTP cache can't hand back the previous deploy.
  - **Fetch**: a navigation to the app (`app/`) gets the stored page; a navigation to a home page goes to the network first, so it is always current, and falls back to the stored copy offline; stored files and anything under `assets/` are served from the cache first, and font subsets for other scripts are stored on first use (hashed names never change). Everything else goes to the network untouched: `/api/`, WebSockets, other origins, non-GET requests, `robots.txt`, `llms.txt`, the social card and PNG icons.
  - **Activate**: deletes the older `versus-*` caches and takes control of open pages.
  - **Version**: a hash of the stored files' names and bytes (`build/pwa.ts`), written into the worker at build time. A deploy that changes the app changes `sw.js`, so browsers install the new worker.
- **In the app** (`src/app/pwa.ts`):
  - Registered in production builds only, after the page's `load`, so storing the files doesn't compete with the first render. The dev server runs without a worker.
  - **Updates are offered, never forced** (D78): once a new worker is installed and waiting, a bar above the header says a new version is ready, with **Reload** and **Later**. Reload asks the worker to take over, then the page reloads. Later hides the bar; the new version starts once every tab of the app is closed. An open app checks for a new version when it comes back to the foreground, at most hourly.
  - **Install button** in the header, shown only when the browser offers installation (`beforeinstallprompt`: Chrome and Edge on desktop and Android). It replaces Chrome's mini-infobar on Android. A toast confirms the installation.
  - **Persistent storage** (`navigator.storage.persist()`) requested in the installed app only: installed apps get it silently, while a tab in Firefox would show a prompt.

## The move to app/ (2026-09-30)

The app lived at the site's root until the home page took it (D82). What keeps working:

- **Installed apps** open their stored start address, the root: the home page's first script sees the app's display mode (`minimal-ui`, `standalone`) and sends it to `app/` before the first paint, offline too (the home page is stored). Browsers update the manifest by its unchanged `id`, and new installs open `app/` directly.
- **Old links** whose route is in the fragment (`/#/b/<alias>`) are sent to `app/` with their fragment, on arrival and on a fragment change.
- **Existing workers**: the worker of the previous deploy serves its stored app at the root until the new one takes over; the page it shows offers the update as usual (D78), and after Reload the root is the home page. Rankings are untouched: `localStorage` belongs to the origin, not the path.

## By platform

| Platform | Install | Offline | Notes |
| --- | --- | --- | --- |
| Chrome, Edge (desktop) | The header button or the address bar icon; own window | Yes | |
| Chrome (Android) | The header button; icon on the home screen, window with a back button (`minimal-ui`) | Yes | Same storage as the browser: rankings are there. |
| Safari (iOS, iPadOS) | Share → Add to Home Screen; the icon opens Safari (no `minimal-ui` on iOS) | Yes, in Safari | No install prompt. A real app window (`standalone`) waits for export/import: iOS gives home-screen apps their own storage. |
| Firefox (desktop) | No | Yes | |
| Firefox (Android) | Menu → Install | Yes | |

## Checking it by hand

On the deployed site, in Chrome:

1. Open the app (`/app/`), then DevTools → Application → Service workers: `sw.js` is activated with the site's root as scope. Cache storage holds `versus-<version>` with the three pages, the bundles and the fonts.
2. Network → Offline, then reload: the gallery and the demos open, a duel works, fonts are right.
3. After the next deploy, come back to the tab (or reload): the bar "A new version of Versus is ready" appears. Reload shows the new version; the old cache is gone.
4. On an Android phone: open the site in Chrome, tap Install in the header, open Versus from the home screen, turn on airplane mode, open it again.

These steps were run in Chromium with Playwright while building this (served under `/versus/` like GitHub Pages, with two builds to simulate a deploy); the script is a starting point for the end-to-end tests on the roadmap.

## Limits

- **One app page**: only `app/` is served from the cache, since routes live in the fragment (D51). Path routes such as `/b/<alias>` would first need absolute asset URLs (today `base: './'`), then a navigation rule in the worker.
- **Published boards need the network**: votes and the crowd ranking are live. Offline, the local rankings work; boards don't.
- **Storage**: rankings, images included, live in `localStorage` (about 5 MB). Photos fill it quickly; see the next steps.
- **Other tabs**: after Reload in one tab, other tabs keep the old version until they reload. The old cache is deleted, so an old tab that needs a file it never loaded fetches it from the network.

## Next steps (proposed order)

1. **Export / import** a ranking or everything as a JSON file: backup, moving between devices and browsers, and into an iOS home-screen app. Then **`display: standalone`**: a real app window on iOS too, which Web Push on iOS also requires.
2. **Images in IndexedDB**: `localStorage` caps at about 5 MB, a few dozen photos.
3. **Share target**: share photos or text from another app (gallery, browser) straight into a new or existing ranking. Android and installed Chromium apps.
4. **Native share sheet** (Web Share API) for results and board links, with the results image.
5. **Manifest shortcuts** ("New ranking") and **screenshots** for Chrome's richer install dialog.
6. **Notifications** for published boards (Web Push) once the backend is deployed: a board closes, results are revealed. On iOS, only for home-screen apps in `standalone` (step 1).
7. **Capacitor shell**, only if the stores are ever wanted (D75): same build, native push and app links.
