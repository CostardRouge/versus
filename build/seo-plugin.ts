import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import type { Plugin } from 'vite';
import { LINKS } from '../src/core/site.ts';
import { landingBody, landingBoot } from '../src/landing/markup.ts';
import { legalBody, legalBoot } from '../src/legal/markup.ts';
import { type AnalyticsConfig, analyticsConfig, analyticsTag } from './analytics.ts';
import {
  aboutStatic,
  contentPolicy,
  generatedFiles,
  headersFile,
  headTags,
  noscriptHtml,
  rootFrom,
  scriptHashes,
  sitePath,
  siteUrl,
} from './seo.ts';
import { CONTACT, PAGES, type PageKey } from './site.ts';

/** Placeholders in the pages, replaced at dev and build time. */
export const HEAD_MARK = '<!-- seo:head -->';
const NOSCRIPT_MARK = '<!-- seo:noscript -->';
const ABOUT_MARK = '<!-- seo:about -->';
/**
 * Home and legal pages: the script run before the first paint, and the page itself (src/landing/markup.ts,
 * src/legal/markup.ts).
 */
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
  opts: { url: string; publish: boolean; head: string[]; path?: string; analytics?: AnalyticsConfig | null },
): string {
  const { lang, kind } = PAGES[page];
  const marks =
    kind === 'app'
      ? [BASE_MARK, HEAD_MARK, NOSCRIPT_MARK, ABOUT_MARK]
      : kind === 'admin'
        ? [HEAD_MARK, BOOT_MARK]
        : [HEAD_MARK, BOOT_MARK, BODY_MARK];
  for (const mark of marks) if (!html.includes(mark)) throw new Error(`${PAGES[page].file} needs ${mark}`);
  // The admin page is the publisher's: its visits aren't counted.
  const analytics = opts.analytics && kind !== 'admin' ? [analyticsTag(opts.analytics, PAGES[page].path)] : [];
  const out = html.replace(HEAD_MARK, [...headTags(opts.url, page), ...opts.head, ...analytics].join('\n    '));
  if (kind === 'app') {
    return out
      .replace(BASE_MARK, `<base href="${opts.path ?? '/'}${PAGES.app.path}" />`)
      .replace(NOSCRIPT_MARK, noscriptHtml())
      .replace(ABOUT_MARK, aboutStatic(opts.publish));
  }
  if (kind === 'admin') return out.replace(BOOT_MARK, legalBoot());
  if (kind === 'legal') {
    return out
      .replace(BOOT_MARK, legalBoot())
      .replace(BODY_MARK, legalBody(lang, { contact: CONTACT, author: LINKS.author, source: LINKS.source }));
  }
  return out
    .replace(BOOT_MARK, landingBoot(lang))
    .replace(BODY_MARK, landingBody(lang, { publish: opts.publish, author: LINKS.author, source: LINKS.source }));
}

/**
 * Self-hosted fonts the first render needs (latin subset), preloaded so they download alongside the bundle
 * instead of after the stylesheet is parsed: the body font everywhere, the display font on the home pages only,
 * whose first view is its big title. Elsewhere it would compete with the app's script for the bandwidth the first
 * render waits on (−350 ms of LCP measured on /app/ over a slow 4G).
 */
const BODY_FONT = /figtree-latin-wght-normal[^/]*\.woff2$/;
const DISPLAY_FONT = /bricolage-grotesque-latin-opsz-normal[^/]*\.woff2$/;
export const preloadFonts = (kind: string): RegExp[] => (kind === 'home' ? [BODY_FONT, DISPLAY_FONT] : [BODY_FONT]);

/** Date of the last commit (the content's real last change), or today outside a git checkout. */
function lastmod(): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Each page's head tags and static content (the home and legal pages entirely, the app's page text and <noscript>
 * line), the audience measurement settings (production builds, build/analytics.ts), and the generated files
 * (manifest, robots.txt, sitemap, llms.txt, and the Cloudflare _headers in the Worker build) from build/site.ts.
 * The canonical address comes from `VITE_SITE_URL`, defaulting to versus.steevepommier.com.
 */
export function seo(): Plugin {
  let url = siteUrl();
  let path = '/';
  let base = './';
  let root = process.cwd();
  let worker = false;
  let publish = false;
  let api: string | null = null;
  let analytics: AnalyticsConfig | null = null;
  return {
    name: 'versus-seo',
    configResolved(config) {
      url = siteUrl(config.env.VITE_SITE_URL);
      path = sitePath(config.env.VITE_BASE_PATH);
      base = config.base;
      root = config.root;
      worker = config.mode === 'worker';
      publish = config.env.VITE_API_URL !== undefined;
      api = config.env.VITE_API_URL ?? null;
      analytics = analyticsConfig(config.env, { production: config.isProduction, url });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = pageOf(relative(root, ctx.filename));
        // A relative base resolves from each page's own folder: preloads go through the way back to the root.
        const prefix = base === './' || base === '' ? rootFrom(page) : base;
        const wanted = preloadFonts(PAGES[page].kind);
        const fonts = Object.keys(ctx.bundle ?? {})
          .filter((file) => wanted.some((re) => re.test(file)))
          .map((file) => `<link rel="preload" href="${prefix}${file}" as="font" type="font/woff2" crossorigin />`);
        return fillPage(html, page, { url, publish, head: fonts, path, analytics });
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
    generateBundle: {
      // After the HTML plugin: the pages are final, so the policy can list their inline scripts' hashes.
      order: 'post',
      handler(_options, bundle) {
        const files = generatedFiles(url, { lastmod: lastmod(), worker });
        if (files._headers) {
          const pages = Object.values(bundle).flatMap((out) =>
            out.type === 'asset' && out.fileName.endsWith('.html') ? [String(out.source)] : [],
          );
          const scripts = [...pages, files['404.html']?.body ?? ''].flatMap(scriptHashes);
          const policy = contentPolicy({ scripts, analytics: analytics?.src ?? null, api });
          files._headers = { ...files._headers, body: headersFile(policy) };
        }
        for (const [fileName, file] of Object.entries(files))
          this.emitFile({ type: 'asset', fileName, source: file.body });
      },
    },
  };
}
