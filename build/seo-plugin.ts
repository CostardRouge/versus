import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { aboutStatic, generatedFiles, headTags, noscriptHtml, siteUrl } from './seo.ts';

/** Placeholders in index.html, replaced at dev and build time. */
export const HEAD_MARK = '<!-- seo:head -->';
export const NOSCRIPT_MARK = '<!-- seo:noscript -->';
export const ABOUT_MARK = '<!-- seo:about -->';

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
 * Head tags, the static page text, the <noscript> line and generated files (manifest, robots.txt, sitemap,
 * llms.txt, and the Cloudflare _headers in the Worker build) from build/site.ts. The canonical address comes
 * from `VITE_SITE_URL`, defaulting to versus.steevepommier.com.
 */
export function seo(): Plugin {
  let url = siteUrl();
  let base = './';
  let worker = false;
  let publish = false;
  return {
    name: 'versus-seo',
    configResolved(config) {
      url = siteUrl(config.env.VITE_SITE_URL);
      base = config.base;
      worker = config.mode === 'worker';
      publish = config.env.VITE_API_URL !== undefined;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {})
          .filter((file) => PRELOAD_FONTS.some((re) => re.test(file)))
          .map((file) => `<link rel="preload" href="${base}${file}" as="font" type="font/woff2" crossorigin />`);
        const head = [...headTags(url), ...fonts].join('\n    ');
        for (const mark of [HEAD_MARK, NOSCRIPT_MARK, ABOUT_MARK]) {
          if (!html.includes(mark)) throw new Error(`index.html needs ${mark}`);
        }
        return html
          .replace(HEAD_MARK, head)
          .replace(NOSCRIPT_MARK, noscriptHtml())
          .replace(ABOUT_MARK, aboutStatic(publish));
      },
    },
    configureServer(server) {
      const names = new Set(Object.keys(generatedFiles(url, { lastmod: '', worker })));
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(/^\//, '') ?? '';
        const file = names.has(name) ? generatedFiles(url, { lastmod: lastmod(), worker })[name] : undefined;
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body);
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(generatedFiles(url, { lastmod: lastmod(), worker }))) {
        this.emitFile({ type: 'asset', fileName, source: file.body });
      }
    },
  };
}
