import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import type { Plugin } from 'vite';
import { LINKS } from '../src/app/about.ts';
import { landingBody, landingBoot } from '../src/landing/markup.ts';
import { aboutStatic, generatedFiles, headTags, noscriptHtml, rootFrom, sitePath, siteUrl } from './seo.ts';
import { PAGES, type PageKey } from './site.ts';

/** Placeholders in the pages, replaced at dev and build time. */
export const HEAD_MARK = '<!-- seo:head -->';
export const NOSCRIPT_MARK = '<!-- seo:noscript -->';
export const ABOUT_MARK = '<!-- seo:about -->';
/** Home pages only: the script run before the first paint, and the page itself (src/landing/markup.ts). */
export const BOOT_MARK = '<!-- landing:boot -->';
/** The app only: its folder as the page's <base>, so its deep paths (app/demo/…) resolve every relative URL. */
export const BASE_MARK = '<!-- app:base -->';
export const BODY_MARK = '<!-- landing:body -->';

/**
 * The app's views are paths under /app/ (D92): the dev and preview servers answer them with the app's page,
 * as the Worker does (worker/src/index.ts). Files (a dot in the last segment) pass through.
 */
export function appViews(req: { url?: string }, _res: unknown, next: () => void): void {
  const path = req.url?.split(/[?#]/)[0] ?? '';
  if (/^\/app\/[^.]+$/.test(path) && !/\.[^/]*$/.test(path)) req.url = '/app/index.html';
  next();
}

/** Which page an HTML file is, from its path relative to the project root. */
export function pageOf(file: string): PageKey {
  const name = file.replace(/\\/g, '/');
  const page = (Object.keys(PAGES) as PageKey[]).find((k) => PAGES[k].file === name);
  if (!page) throw new Error(`${file} is not one of the pages in build/site.ts`);
  return page;
}

/** Fills a page's placeholders; throws if one is missing, so a page can't ship without its head. */
export function fillPage(
  html: string,
  page: PageKey,
  opts: { url: string; publish: boolean; head: string[]; path?: string },
): string {
  const { lang } = PAGES[page];
  const marks = page === 'app' ? [BASE_MARK, HEAD_MARK, NOSCRIPT_MARK, ABOUT_MARK] : [HEAD_MARK, BOOT_MARK, BODY_MARK];
  for (const mark of marks) if (!html.includes(mark)) throw new Error(`${PAGES[page].file} needs ${mark}`);
  const out = html.replace(HEAD_MARK, [...headTags(opts.url, page), ...opts.head].join('\n    '));
  if (page === 'app') {
    return out
      .replace(BASE_MARK, `<base href="${opts.path ?? '/'}${PAGES.app.path}" />`)
      .replace(NOSCRIPT_MARK, noscriptHtml())
      .replace(ABOUT_MARK, aboutStatic(opts.publish));
  }
  return out
    .replace(BOOT_MARK, landingBoot(lang))
    .replace(BODY_MARK, landingBody(lang, { publish: opts.publish, author: LINKS.author, source: LINKS.source }));
}

/**
 * Self-hosted fonts the first render needs (body and display, latin subset): preloaded so they download
 * alongside the bundle instead of after the stylesheet is parsed.
 */
const PRELOAD_FONTS = [/figtree-latin-wght-normal[^/]*\.woff2$/, /bricolage-grotesque-latin-opsz-normal[^/]*\.woff2$/];

/** Date of the last commit (the content's real last change), or today outside a git checkout. */
function lastmod(): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Each page's head tags and static content (the home pages entirely, the app's page text and <noscript> line),
 * and the generated files (manifest, robots.txt, sitemap, llms.txt, and the Cloudflare _headers in the Worker
 * build) from build/site.ts. The canonical address comes from `VITE_SITE_URL`, defaulting to
 * versus.steevepommier.com.
 */
export function seo(): Plugin {
  let url = siteUrl();
  let path = '/';
  let base = './';
  let root = process.cwd();
  let worker = false;
  let publish = false;
  return {
    name: 'versus-seo',
    configResolved(config) {
      url = siteUrl(config.env.VITE_SITE_URL);
      path = sitePath(config.env.VITE_BASE_PATH);
      base = config.base;
      root = config.root;
      worker = config.mode === 'worker';
      publish = config.env.VITE_API_URL !== undefined;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = pageOf(relative(root, ctx.filename));
        // A relative base resolves from each page's own folder: preloads go through the way back to the root.
        const prefix = base === './' || base === '' ? rootFrom(page) : base;
        const fonts = Object.keys(ctx.bundle ?? {})
          .filter((file) => PRELOAD_FONTS.some((re) => re.test(file)))
          .map((file) => `<link rel="preload" href="${prefix}${file}" as="font" type="font/woff2" crossorigin />`);
        return fillPage(html, page, { url, publish, head: fonts, path });
      },
    },
    configureServer(server) {
      server.middlewares.use(appViews);
      const names = new Set(Object.keys(generatedFiles(url, { lastmod: '', worker })));
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(/^\//, '') ?? '';
        const file = names.has(name) ? generatedFiles(url, { lastmod: lastmod(), worker })[name] : undefined;
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(appViews);
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(generatedFiles(url, { lastmod: lastmod(), worker }))) {
        this.emitFile({ type: 'asset', fileName, source: file.body });
      }
    },
  };
}
