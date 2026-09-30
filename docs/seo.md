# SEO, social previews and icons

Last updated 2026-09-30. Ported from the SEO/GEO work on steevepommier.com (its `seo-checklist.md` and `docs/memory/seo-geo.md`), adapted to a single-page app.

## The pattern

**One source, generated outputs.** Every sitewide fact (name, title, description, features, scoring methods, colors, icon files, social card, author) lives in `build/site.ts`. Nothing SEO-related is written by hand anywhere else:

| Output | Built by | When |
| --- | --- | --- |
| Head tags (title, description, canonical, robots, icons, manifest link, Open Graph, X cards, JSON-LD) | `headTags()` in `build/seo.ts`, injected at `<!-- seo:head -->` in `index.html` | dev and build (Vite plugin `build/seo-plugin.ts`) |
| `<noscript>` fallback (h1, description, features) | `noscriptHtml()`, at `<!-- seo:noscript -->` | dev and build |
| `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `llms.txt` | `generatedFiles()` | build (emitted into `dist/`), and answered by the dev server |
| `_headers` (Cloudflare static assets) | `headersFile()` | Worker build only (`--mode worker`) |
| Icons and the social card in `public/` | `scripts/icons.ts` (`npm run icons`) | by hand, files committed |

`tests/seo.test.ts` holds the invariants: title and description lengths, canonical = `og:url` = JSON-LD ids, every `@id` reference resolves, every linked file exists, PNG sizes match their declarations, favicons are multiples of 48 px, the `.ico` holds 16/32/48.

## The canonical address

`VITE_SITE_URL` at build time (repository variable `SITE_URL` in CI, passed to both the Pages and the Worker builds), normalized to https with a trailing slash; unset, it is `https://costardrouge.github.io/versus/`. Canonical, `og:url`, `og:image`, the JSON-LD `@id`s, the sitemap and llms.txt all derive from it.

While the Worker has no settled domain, its build (on `workers.dev`) also declares the Pages address as canonical, so search engines consolidate on one URL. **When the domain is chosen, set `SITE_URL`**: both builds then point at it, and the Pages copy hands its ranking signal over.

## What is in place

- **Head**: title `Versus — Rank anything, two at a time` (the app localizes `document.title` from the same tagline), description of ~150 characters with the search terms (pairwise comparison, rank, text/images/colors, free), canonical, `robots` with `max-image-preview:large, max-snippet:-1, max-video-preview:-1`, `author`, `application-name`, `apple-mobile-web-app-title`, optional Search Console / Bing verification tokens (`VERIFICATION` in `build/site.ts`).
- **Open Graph and X**: type, site name, title, description, url, `og:locale` `en_US` + `og:locale:alternate` `fr_FR`, a 1200×630 card with type, size and alt; `summary_large_image`, `twitter:creator` @BlousonRouge.
- **JSON-LD**: one `@graph` with `WebSite`, `WebPage`, `WebApplication` (free `Offer`, `featureList`, languages), `ImageObject` (the card), `SoftwareSourceCode` (the GitHub repository, MIT) and `Person`. The person's `@id` is `https://steevepommier.com/#person`, the id steevepommier.com uses, so the two graphs describe one entity; the full profile stays on that site.
- **Icons**: `favicon.ico` (16/32/48, for the probes that ignore the head), `icon.svg` (`sizes="any"`), `icon-96.png` and `icon-192.png` (Google shows favicons in multiples of 48 px only), `apple-touch-icon.png` 180×180 full-bleed (iOS rounds the corners and paints transparency black), `icon-512.png` and `icon-maskable-512.png` for Android installs (the maskable one keeps the mark inside the 80 % safe zone). The glyphs are paths, so no icon depends on a font.
- **Manifest**: name, description, colors, icons; `display: minimal-ui`, see below.
- **Social card** (`og.png`): the tagline, a call to action and a duel as the app draws it (Kyoto against Lisbon, from the destinations demo), in the app's fonts and tokens.
- **robots.txt** allows everything, AI crawlers included (same decision as steevepommier.com: llms.txt exists to be read), except `/api/`; it points to the sitemap.
- **sitemap.xml**: one URL (the app is one page; rankings and boards live in the URL fragment, which crawlers ignore), `lastmod` = date of the last commit.
- **llms.txt**: what Versus is, its features, the four scoring methods and the links, in Markdown; advertised with `<link rel="alternate" type="text/markdown">`.
- **Performance**: fonts self-hosted with Fontsource (same files as Google Fonts, Bricolage Grotesque with its optical size axis; screenshots before and after are pixel-identical), no third-party request left on the critical path, the two fonts of the first render preloaded. On the Worker, hashed `/assets/*` are cached for a year (`immutable`).
- **Cloudflare headers** (Worker build): `text/html; charset=utf-8` on `/` (the platform omits the charset otherwise), `application/manifest+json` on the manifest, `text/markdown` on llms.txt, HSTS (without `preload`, a separate and hard-to-undo decision), `nosniff`.

## Decisions worth keeping

- **`minimal-ui`, not `standalone`.** Rankings live in `localStorage`, and iOS gives a standalone home-screen app its own storage: a ranking made in Safari would vanish from the installed icon. iOS has no `minimal-ui`, so it keeps opening Safari (shared storage); Android gets a window with a back button. Offline support is in place (`docs/pwa.md`); revisit with an export/import.
- **A redesigned icon or card gets a new file name.** Google caches favicons by URL for months, and unfurlers cache `og:image` the same way; overwriting the bytes changes nothing for them. Rename in `ICONS` / `OG_IMAGE` (`build/site.ts`) and rerun `npm run icons`. `favicon.svg`, the former address, is kept undeclared and answers with the current drawing.
- **satori, not a renderer that resolves fonts by name** (`sharp`, canvas): satori takes the font bytes and outputs glyphs as paths, so the files are identical on any machine. It is a dev dependency used by the script only; the build doesn't run it. Its `fflate` dependency is pinned to `^0.7.5` in `overrides`: 0.7.0–0.7.4 carry an advisory, and 0.8 breaks the WOFF decoding (glyphs render as boxes).
- **Characters in the card must exist in the latin subset of the fonts**: the arrow of the call to action is a drawn path because Figtree's latin file has no `→`. Render and look at `og.png` after any text change.
- **No FAQ, HowTo or SearchAction markup**: Google dropped those rich results (2023, 2024). `WebApplication` earns no rich result either without ratings, which would have to be real; it stays as a plain description of the entity.
- **No `hreflang`**: English and French share one URL (the app switches from the browser language). `og:locale:alternate` states that French exists.
- **No breadcrumbs, one sitemap entry**: a single page has no trail and no other URL.

## What only the owner can do

1. **Search Console**: add the property (URL prefix `https://costardrouge.github.io/versus/` now, or a domain property for the Worker's domain later), verify it (put the token in `VERIFICATION.google`, or use DNS for a domain property), and submit `sitemap.xml`. On GitHub Pages, `robots.txt` sits under `/versus/` where crawlers never look, so the sitemap has to be submitted by hand; on the Worker's own domain, `robots.txt` points to it.
2. **`SITE_URL`** repository variable once the domain is settled (see above).
3. **Cloudflare managed robots.txt**: on steevepommier.com, the zone's AI Crawl Control / Content Signals prepended a block that disallowed AI crawlers, contradicting the repository. Check the zone of the Worker's domain the same way, with `curl -s https://<domain>/robots.txt`, not from the dashboard.
4. **Check the previews** after the first deploy: opengraph.xyz or the platforms' own debuggers (LinkedIn Post Inspector, Facebook Sharing Debugger).

## Possible next steps

- **A card per published board**: share links are `#/b/<alias>`, and a fragment never reaches a server, so every board unfurls with the generic card. A path form (`/b/<alias>`) served by the Worker could rewrite the head (`HTMLRewriter`) with the board's title and a generated card.
- **Manifest screenshots** (`form_factor` wide and narrow) for Chrome's richer install dialog.
- **`standalone`**: offline support is in place (`docs/pwa.md`); switching waits for export/import, so rankings can move into an iOS home-screen app.
