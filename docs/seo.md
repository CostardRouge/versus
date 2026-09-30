# SEO, social previews and icons

Last updated 2026-09-30. Ported from the SEO/GEO work on steevepommier.com (its `seo-checklist.md` and `docs/memory/seo-geo.md`), adapted to a site made of a home page in two languages and an app.

## The pages

| Address | File | Language | Indexed | What it is |
| --- | --- | --- | --- | --- |
| `/` | `index.html` | English (x-default) | Yes | The home page (`src/landing/`), static HTML rendered at build time |
| `/fr/` | `fr/index.html` | French | Yes | The same home page in French |
| `/app/` | `app/index.html` | English, then the visitor's | No (`noindex, follow`) | The app, rendered by JavaScript |

`PAGES` in `build/site.ts` lists them; `vite.config.ts` builds each as an entry, and the plugin recognizes each file to fill its placeholders.

## The pattern

**One source, generated outputs.** Every sitewide fact (name, title, description, features, scoring methods, colors, icon files, social card, author) lives in `build/site.ts`. Nothing SEO-related is written by hand anywhere else:

| Output | Built by | When |
| --- | --- | --- |
| Head tags of each page (title, description, canonical, hreflang, robots, icons, manifest link, Open Graph, X cards, JSON-LD) | `headTags(url, page)` in `build/seo.ts`, injected at `<!-- seo:head -->` | dev and build (Vite plugin `build/seo-plugin.ts`) |
| The home pages: every section, the first frame of every demo, the texts their script needs (JSON) | `landingBody(lang)` in `src/landing/markup.ts`, at `<!-- landing:body -->`; `landingBoot(lang)` (redirects and theme before the first paint) at `<!-- landing:boot -->` | dev and build |
| The app's page text in static HTML (h1, how it works, the four methods, privacy, author and source links) | `aboutStatic()` → `aboutHTML()` in `src/app/about.ts`, at `<!-- seo:about -->` inside `<main>` of `app/index.html` | dev and build; the gallery renders the same section in the visitor's language |
| The app's `<noscript>` line | `noscriptHtml()`, at `<!-- seo:noscript -->` | dev and build |
| `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `llms.txt` | `generatedFiles()` | build (emitted into `dist/`), and answered by the dev server |
| `_headers` (Cloudflare static assets) | `headersFile()` | Worker build only (`--mode worker`) |
| Icons and the social cards (`og.png`, `og-fr.png`) in `public/` | `scripts/icons.ts` (`npm run icons`) | by hand, files committed |

`tests/seo.test.ts` and `tests/landing.test.ts` hold the invariants: titles (50–60 characters) and descriptions in both languages, hreflang pairs, one h1 per page, no skipped heading level, every in-page anchor resolves, relative links that go back to the root from every page, and: title (50–60 characters) and description lengths, one h1 and at least 250 words in the static HTML, no skipped heading level, canonical = `og:url` = JSON-LD ids, every `@id` reference resolves, every linked file exists, PNG sizes match their declarations, favicons are multiples of 48 px, the `.ico` holds 16/32/48.

## The canonical address

`https://versus.steevepommier.com/`, the Worker's domain (`DEFAULT_SITE_URL` in `build/site.ts`); `VITE_SITE_URL` at build time overrides it (repository variable `SITE_URL` in CI, passed to both the Pages and the Worker builds), normalized to https with a trailing slash. Canonical, `og:url`, `og:image`, the JSON-LD `@id`s, the sitemap and llms.txt all derive from it, each page adding its folder (`fr/`, `app/`).

Both builds declare it, so the GitHub Pages copy and `workers.dev` hand their ranking signal to the one domain. Until 2026-09-30 the default was the Pages address, and audits of versus.steevepommier.com flagged a canonical pointing to another domain.

## What is in place

- **Head, per page**: English title `Versus — Rank anything by comparing two items at a time` (55 characters) and French title `Versus — Classe tout en comparant deux éléments à la fois` (57; the `pageTitle` message, so the app shows the same), descriptions of ~150 characters with the search terms in each language (`DESCRIPTIONS`), a canonical of its own, hreflang `en`, `fr` and `x-default` on both home pages, `robots` with `max-image-preview:large, max-snippet:-1, max-video-preview:-1`, `author`, `application-name`, `apple-mobile-web-app-title`, optional Search Console / Bing verification tokens (`VERIFICATION` in `build/site.ts`).
- **Open Graph and X**: type, site name, title, description, url, `og:locale` with the other language as `og:locale:alternate`, a 1200×630 card per language (`og.png`, `og-fr.png`) with type, size and alt; `summary_large_image`, `twitter:creator` @BlousonRouge.
- **JSON-LD** (home pages): one `@graph` with `WebSite`, `WebPage` (the page's own `@id`, `inLanguage`), `WebApplication` (url: the app; free `Offer`, `featureList`, languages), `ImageObject` (the page's card), `SoftwareSourceCode` (the GitHub repository, MIT) and `Person`. The site, app, source and author share one `@id` across the two languages. The person's `@id` is `https://steevepommier.com/#person`, the id steevepommier.com uses, so the two graphs describe one entity; the full profile stays on that site.
- **Icons**: `favicon.ico` (16/32/48, for the probes that ignore the head), `icon.svg` (`sizes="any"`), `icon-96.png` and `icon-192.png` (Google shows favicons in multiples of 48 px only), `apple-touch-icon.png` 180×180 full-bleed (iOS rounds the corners and paints transparency black), `icon-512.png` and `icon-maskable-512.png` for Android installs (the maskable one keeps the mark inside the 80 % safe zone). The glyphs are paths, so no icon depends on a font.
- **Manifest**: name, description, colors, icons; `start_url: ./app/` with `id: ./` unchanged (installed copies stay the same app); `display: minimal-ui`, see below.
- **Social card** (`og.png`): the tagline, a call to action and a duel as the app draws it (Kyoto against Lisbon, from the destinations demo), in the app's fonts and tokens.
- **robots.txt** allows everything, AI crawlers included (same decision as steevepommier.com: llms.txt exists to be read), except `/api/`; it points to the sitemap.
- **sitemap.xml**: the two home pages, each with its `xhtml:link` hreflang alternates (x-default English), `lastmod` = date of the last commit. The app is left out (`noindex`; rankings and boards live in the URL fragment, which crawlers ignore).
- **llms.txt**: what Versus is, its features, the four scoring methods and the links (both home pages, the app), in Markdown; advertised with `<link rel="alternate" type="text/markdown">`.
- **The home pages' text**: all of it in the static HTML (about 1,000 words each, demos included), one h1 reading "Rank anything two at a time" / "Classe n'importe quoi deux par deux". The h1's rotating word is added by the script, one word at a time, next to a screen-reader copy of the static one. The demos' first frames are rendered at build time with the app's scoring, so nothing moves when the script starts (no layout shift).
- **The app's page text in the HTML**: the app renders everything with JavaScript, which left crawlers that don't run it (audit tools, most language model crawlers) with 3 words, no heading, no paragraph and no link. `index.html` now carries the section that closes the gallery (`src/app/about.ts`: what Versus does, how it works, the four scoring methods, privacy, publishing on builds that have it, author and source links) in English with the page's only h1, about 290 words. An inline script marks `<html class="js">` before the first paint, which hides that copy (no flash, no layout shift); the app then replaces it with the gallery, where the same section comes back in the visitor's language one level down (h2), "Your rankings" being the h1. Its texts are ordinary i18n messages (`about*`, `m_*`).
- **Performance**: fonts self-hosted with Fontsource (same files as Google Fonts, Bricolage Grotesque with its optical size axis; screenshots before and after are pixel-identical), no third-party request left on the critical path, the two fonts of the first render preloaded. On the Worker, hashed `/assets/*` are cached for a year (`immutable`).
- **Cloudflare headers** (Worker build): `text/html; charset=utf-8` on every page (the platform omits the charset otherwise), `X-Robots-Tag: noindex` under `/app/`, `application/manifest+json` on the manifest, `text/markdown` on llms.txt, HSTS (without `preload`, a separate and hard-to-undo decision), `nosniff`.

## Decisions worth keeping

- **`minimal-ui`, not `standalone`.** Rankings live in `localStorage`, and iOS gives a standalone home-screen app its own storage: a ranking made in Safari would vanish from the installed icon. iOS has no `minimal-ui`, so it keeps opening Safari (shared storage); Android gets a window with a back button. Offline support is in place (`docs/pwa.md`); revisit with an export/import.
- **A redesigned icon or card gets a new file name.** Google caches favicons by URL for months, and unfurlers cache `og:image` the same way; overwriting the bytes changes nothing for them. Rename in `ICONS` / `OG_IMAGE` (`build/site.ts`) and rerun `npm run icons`. `favicon.svg`, the former address, is kept undeclared and answers with the current drawing.
- **satori, not a renderer that resolves fonts by name** (`sharp`, canvas): satori takes the font bytes and outputs glyphs as paths, so the files are identical on any machine. It is a dev dependency used by the script only; the build doesn't run it. Its `fflate` dependency is pinned to `^0.7.5` in `overrides`: 0.7.0–0.7.4 carry an advisory, and 0.8 breaks the WOFF decoding (glyphs render as boxes).
- **Characters in the card must exist in the latin subset of the fonts**: the arrow of the call to action is a drawn path because Figtree's latin file has no `→`. Render and look at `og.png` after any text change.
- **No FAQ, HowTo or SearchAction markup**: Google dropped those rich results (2023, 2024). `WebApplication` earns no rich result either without ratings, which would have to be real; it stays as a plain description of the entity.
- **One URL per language for the home page, hreflang both ways, English as x-default** (D83). The app keeps one URL and switches by itself, which is why it stays out of the index.
- **No redirect on the browser language** (D84): Google's crawler has none, and a shared link should open in its language. A visitor whose browser prefers the other language gets a dismissible bar in that language; a language chosen on the switcher or in the app (`versus-prefs.lang`) is honored for visitors arriving from elsewhere, before the first paint.
- **No breadcrumbs**: two pages side by side have no trail.
- **One h1 whichever way a page is read**: on the home pages, the hero's; in the app, the static copy's h1 disappears with it when the app renders, the gallery's section uses h2 and h3. The `<noscript>` line carries no heading (an h1 there counted as a second one in audits).

## Audit findings not acted on (2026-09-30)

From SEOptimer and Seobility on versus.steevepommier.com, once the fixes above were in:

- **Backlinks, "entry page with few internal links"**: the home pages now link to their sections, to each other and to the app; links still come mostly from outside (steevepommier.com, the GitHub README, posts). Content pages (for example one per scoring method) would add internal links and long-tail queries.
- **Subdomain rather than a top-level domain**: waits for the trademark check (D3).
- **Local business schema, address and phone, Facebook page and pixel, YouTube, social profiles, sharing plugins**: meant for local businesses and brands; Versus has none of them, and the author's profiles are on steevepommier.com, joined through the JSON-LD `@id`.
- **SPF and DMARC**: DNS records of the `steevepommier.com` zone, not of the app. If the domain sends no mail from Cloudflare, `v=spf1 -all` and a `_dmarc` record with `p=reject` block spoofing; if it does (Gmail forwarding, a mailer), the records must list those senders.
- **"Avoid multiple page redirects"**: the `http://` → `https://` hop is Cloudflare's; HSTS removes it for returning visitors, and the HSTS preload list would remove it for first visits (a hard-to-undo decision).

## What only the owner can do

1. **Search Console**: add `versus.steevepommier.com` (a domain property on `steevepommier.com`, verified by DNS, covers it), submit `https://versus.steevepommier.com/sitemap.xml` and request indexing of `/` and `/fr/`. `robots.txt` on the domain also points to the sitemap. The International Targeting report then shows whether the hreflang pairs are read.
2. **`SITE_URL`** repository variable only if the domain changes again (see above).
3. **Cloudflare managed robots.txt**: on steevepommier.com, the zone's AI Crawl Control / Content Signals prepended a block that disallowed AI crawlers, contradicting the repository. Check the zone of the Worker's domain the same way, with `curl -s https://<domain>/robots.txt`, not from the dashboard.
4. **Check the previews** after the first deploy, for `/` and `/fr/` (each has its card): opengraph.xyz or the platforms' own debuggers (LinkedIn Post Inspector, Facebook Sharing Debugger).

## Possible next steps

- **A card per published board**: share links are `#/b/<alias>`, and a fragment never reaches a server, so every board unfurls with the generic card. A path form (`/b/<alias>`) served by the Worker could rewrite the head (`HTMLRewriter`) with the board's title and a generated card.
- **Manifest screenshots** (`form_factor` wide and narrow) for Chrome's richer install dialog.
- **`standalone`**: offline support is in place (`docs/pwa.md`); switching waits for export/import, so rankings can move into an iOS home-screen app.
