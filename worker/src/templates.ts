import type { BoardView, Unfurl } from '../../src/core/protocol';
import {
  TEMPLATE_INDEX_VOTERS,
  TEMPLATES,
  type Template,
  templateByKey,
  templateBySlug,
  templateInput,
  templatePath,
} from '../../src/core/templates';
import type { BoardLang } from '../../src/core/types';
import { esc } from '../../src/core/util';
import { pctText } from '../../src/i18n/text';
import { type UnfurlKey, unfurlPlural, unfurlText } from '../../src/i18n/unfurl';
import { attrValue, preview } from './cards';
import type { Env } from './env';
import { log } from './log';
import { newAlias, newOwnerToken } from './random';
import {
  deleteBoard,
  indexableTemplates,
  type RegistryRow,
  templateBoard,
  templateKeys,
  upsertBoard,
} from './registry';

/**
 * Official templates (docs/published-boards.md#official-templates): the site's own boards, published by the
 * Worker from fixed data (src/core/templates.ts) the first time a page or the Popular list asks for them, and
 * their pages, `/t/<slug>/` and `/fr/t/<slug>/`: the legal page's shell with the template's title, intro, the
 * crowd's ranking as text, the way to the board and the other templates, so that search engines have a real
 * page to index once enough people voted. The sitemap lists those pages (docs/seo.md).
 */

/** Voters a template page needs before it asks to be indexed. */
const indexVoters = (env: Env): number => Number(env.TEMPLATE_INDEX_VOTERS) || TEMPLATE_INDEX_VOTERS;

/**
 * The board of a template in one language, published now if it wasn't yet. Its registry row is written at
 * once, so the page that asked finds it; the registry's unique index settles a race between two first visits.
 */
async function ensureTemplate(env: Env, t: Template, lang: BoardLang): Promise<RegistryRow | null> {
  const db = env.REGISTRY;
  if (!db) return null;
  const found = await templateBoard(db, t.key, lang);
  if (found) return found;
  const input = templateInput(t, lang);
  const owner = newOwnerToken();
  for (let attempt = 0; attempt < 3; attempt++) {
    const alias = newAlias();
    const stub = env.BOARDS.getByName(alias);
    if ((await stub.publish(input, owner, alias, { official: true, template: t.key })) !== 'ok') continue;
    const now = Date.now();
    const row: RegistryRow = {
      alias,
      title: input.title,
      status: 'open',
      lang,
      items: input.items.length,
      votes: 0,
      voters: 0,
      reports: 0,
      pictures: 0,
      hidden: false,
      featured: false,
      template: t.key,
      recent: 0,
      top: [],
      created: now,
      active: now,
    };
    try {
      await upsertBoard(db, row);
      return row;
    } catch {
      // Another request published this template meanwhile: this copy goes, theirs stays.
      log('template_published_twice', { template: t.key, lang, alias });
      await stub.adminDelete();
      return templateBoard(db, t.key, lang);
    }
  }
  return null;
}

/**
 * The board of a template as its page shows it, published when missing. A registry row that outlived its board (a
 * delete that failed) goes, and the template is published again.
 */
async function liveTemplate(
  env: Env,
  t: Template,
  lang: BoardLang,
): Promise<{ row: RegistryRow; view: BoardView; unfurl: Unfurl } | null> {
  const db = env.REGISTRY;
  if (!db) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await ensureTemplate(env, t, lang);
    if (!row) return null;
    const stub = env.BOARDS.getByName(row.alias);
    const [view, unfurl] = await Promise.all([stub.view(), stub.unfurl()]);
    if (view && unfurl) return { row, view, unfurl };
    log('template_row_stale', { template: t.key, lang, alias: row.alias });
    await deleteBoard(db, row.alias);
  }
  return null;
}

/** Every template of one language, published when missing (the Popular list needs them all). */
export async function ensureTemplates(env: Env, lang: BoardLang): Promise<void> {
  const db = env.REGISTRY;
  if (!db) return;
  const have = new Set(await templateKeys(db, lang));
  for (const t of TEMPLATES) if (!have.has(t.key)) await ensureTemplate(env, t, lang);
}

// ─── The page ───────────────────────────────────────────────────────────────

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS_NO = 'noindex, follow';

/** The content of a template page, inside the shell's <main>. */
function pageBody(t: Template, lang: BoardLang, view: BoardView, alias: string): string {
  const tx = (key: UnfurlKey, vars: Record<string, string> = {}) => unfurlText(lang, key, vars);
  const labels = new Map(view.items.map((it) => [it.id, it.label]));
  const board = `/app/b/${esc(alias)}`;
  const counts = tx('tplCounts', {
    items: unfurlPlural(lang, view.items.length, 'item'),
    votes: unfurlPlural(lang, view.counts.votes, 'vote'),
    voters: unfurlPlural(lang, view.counts.voters, 'voter'),
  });
  const rows = (view.ranking?.order ?? view.items.map((it) => it.id)).map((id, i) => {
    const s = view.ranking?.stats[id];
    const games = s ? s.w + s.l + s.d : 0;
    const share = s && games ? Math.round((100 * (s.w + s.d / 2)) / games) : null;
    const pct = share === null ? '' : pctText(share, lang);
    return `<li><span class="pos mono">${i + 1}</span><span class="tp-name">${esc(labels.get(id) ?? id)}</span>${
      share === null ? '' : `<span class="tp-share mono">${pct} <small>${tx('tplWinRate')}</small></span>`
    }</li>`;
  });
  const others = TEMPLATES.filter((o) => o.key !== t.key)
    .map((o) => `<li><a href="/${templatePath(o, lang)}">${esc(o.title[lang])}</a></li>`)
    .join('');
  return `<header class="lg-head tp-head">
        <p class="kicker">${tx('tplKicker')}</p>
        <h1 class="lg-h">${esc(t.title[lang])}</h1>
        <p class="lede">${esc(t.intro[lang])}</p>
        <p class="tp-cta"><a class="btn primary lg" href="${board}">${tx('tplVote')}</a><a class="btn lg" href="${board}">${tx('tplMakeMine')}</a></p>
        <p class="tp-counts mono">${esc(counts)}</p>
      </header>
      <section class="lg-sec tp-sec" id="ranking" aria-labelledby="ranking-h">
        <h2 id="ranking-h">${tx('tplRankingTitle')}</h2>
        <p>${view.counts.votes ? tx('tplRankingLive') : tx('tplRankingEmpty')}</p>
        <ol class="tp-list">${rows.join('')}</ol>
      </section>
      <section class="lg-sec tp-sec" id="how" aria-labelledby="how-h">
        <h2 id="how-h">${tx('tplHowTitle')}</h2>
        <p>${tx('tplHow1')}</p>
        <p>${tx('tplHow2')}</p>
        <p>${tx('tplHow3')} <a href="${board}">${tx('tplMakeMine')}</a>.</p>
      </section>
      <section class="lg-sec tp-sec" id="more" aria-labelledby="more-h">
        <h2 id="more-h">${tx('tplMoreTitle')}</h2>
        <nav class="lg-toc"><ol>${others}</ol></nav>
        <p class="lg-updated muted">${tx('tplAbout')}</p>
      </section>`;
}

/**
 * JSON-LD for a template page: the page and its ranking as an ItemList. Written as the script's raw content: `<`, `>`
 * and `&` are escaped the JSON way, so no label can close the script or read as markup.
 */
function graph(t: Template, lang: BoardLang, view: BoardView, pageURL: string, site: string): string {
  const labels = new Map(view.items.map((it) => [it.id, it.label]));
  const order = view.ranking?.order ?? view.items.map((it) => it.id);
  const list = {
    '@type': 'ItemList',
    '@id': `${pageURL}#list`,
    name: t.title[lang],
    description: t.intro[lang],
    numberOfItems: order.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: order.map((id, i) => ({ '@type': 'ListItem', position: i + 1, name: labels.get(id) ?? id })),
  };
  const page = {
    '@type': 'WebPage',
    '@id': `${pageURL}#webpage`,
    url: pageURL,
    name: `${t.title[lang]} · Versus`,
    description: t.intro[lang],
    inLanguage: lang,
    isPartOf: { '@id': `${site}#website` },
    mainEntity: { '@id': `${pageURL}#list` },
  };
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [page, list] })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** The template page named by a language and a slug; `notFound` answers for an unknown slug. */
export async function templatePage(
  req: Request,
  env: Env,
  assets: Fetcher,
  lang: BoardLang,
  slug: string,
  notFound: () => Promise<Response>,
): Promise<Response> {
  const t = templateBySlug(lang, slug);
  if (!t || !env.REGISTRY) return notFound();
  const url = new URL(req.url);
  const path = `/${templatePath(t, lang)}`;
  if (url.pathname !== path) return Response.redirect(`${url.origin}${path}`, 301);
  const live = await liveTemplate(env, t, lang);
  if (!live) return notFound();
  const { row, view, unfurl } = live;
  const p = await preview(env.IMAGES, url.origin, row.alias, unfurl, '');
  const indexable = !row.hidden && view.counts.voters >= indexVoters(env);
  // The shell's addresses are relative to the legal page's folder (`../assets/…`): a <base> keeps them right
  // from this page's deeper folder; its own fragment links are made absolute, so the base doesn't move them.
  const shellPath = lang === 'fr' ? '/fr/mentions-legales/' : '/legal/';
  const shell = await assets.fetch(new Request(new URL(shellPath, url), req));
  const title = `${t.title[lang]} · Versus`;
  const description = t.intro[lang];
  // The site's canonical address comes from the shell's own canonical link (the first head tag rewritten).
  let site = `${url.origin}/`;
  const pageURL = () => `${site}${templatePath(t, lang)}`;
  const set = (attr: string, value: () => string) => ({
    element(el: Element) {
      el.setAttribute(attr, attrValue(value()));
    },
  });
  const rewriter = new HTMLRewriter()
    .on(
      'html',
      set('lang', () => lang),
    )
    .on('head', {
      element(el) {
        el.prepend(`<base href="${shellPath}" />`, { html: true });
      },
    })
    .on('a[href^="#"]', {
      element(el) {
        el.setAttribute('href', `${path}${el.getAttribute('href') ?? ''}`);
      },
    })
    .on('title', {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on(
      'meta[name="description"]',
      set('content', () => description),
    )
    .on('link[rel="canonical"]', {
      element(el) {
        const href = el.getAttribute('href');
        if (href) site = href.replace(/(?:fr\/mentions-legales|legal)\/$/, '');
        el.setAttribute('href', pageURL());
      },
    })
    .on(
      'link[rel="alternate"][hreflang="en"]',
      set('href', () => `${site}${templatePath(t, 'en')}`),
    )
    .on(
      'link[rel="alternate"][hreflang="fr"]',
      set('href', () => `${site}${templatePath(t, 'fr')}`),
    )
    .on(
      'link[rel="alternate"][hreflang="x-default"]',
      set('href', () => `${site}${templatePath(t, 'en')}`),
    )
    .on(
      'meta[name="robots"]',
      set('content', () => (indexable ? ROBOTS_INDEX : ROBOTS_NO)),
    )
    .on(
      'meta[property="og:title"]',
      set('content', () => title),
    )
    .on(
      'meta[name="twitter:title"]',
      set('content', () => title),
    )
    .on(
      'meta[property="og:description"]',
      set('content', () => description),
    )
    .on(
      'meta[name="twitter:description"]',
      set('content', () => description),
    )
    .on('meta[property="og:url"]', set('content', pageURL))
    .on('script[type="application/ld+json"]', {
      element(el) {
        el.setInnerContent(graph(t, lang, view, pageURL(), site), { html: true });
      },
    })
    .on(
      'a[data-lang="en"]',
      set('href', () => `/${templatePath(t, 'en')}`),
    )
    .on(
      'a[data-lang="fr"]',
      set('href', () => `/${templatePath(t, 'fr')}`),
    )
    .on('main#main', {
      element(el) {
        el.setAttribute('class', 'wrap lg tp');
        el.setInnerContent(pageBody(t, lang, view, row.alias), { html: true });
      },
    });
  if (p.image) {
    rewriter
      .on(
        'meta[property="og:image"]',
        set('content', () => p.image?.url ?? ''),
      )
      .on(
        'meta[name="twitter:image"]',
        set('content', () => p.image?.url ?? ''),
      )
      .on(
        'meta[property="og:image:alt"]',
        set('content', () => p.image?.alt ?? ''),
      )
      .on(
        'meta[name="twitter:image:alt"]',
        set('content', () => p.image?.alt ?? ''),
      );
  }
  const out = rewriter.transform(shell);
  const headers = new Headers(out.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  headers.set('X-Robots-Tag', indexable ? 'all' : 'noindex');
  return new Response(out.body, { status: shell.ok ? 200 : shell.status, headers });
}

// ─── The sitemap ────────────────────────────────────────────────────────────

/**
 * The static sitemap (the home and legal pages, build/seo.ts) completed with the template pages that have a
 * crowd: those that ask to be indexed. The addresses follow the static entries' host (the canonical site).
 */
export async function sitemap(req: Request, env: Env, assets: Fetcher): Promise<Response> {
  const url = new URL(req.url);
  const base = await assets.fetch(new Request(new URL('/sitemap.xml', url), req));
  if (!base.ok) return base;
  let xml = await base.text();
  const db = env.REGISTRY;
  if (db) {
    const first = xml.match(/<loc>([^<]*)<\/loc>/)?.[1];
    const site = first ? first.replace(/&amp;/g, '&') : `${url.origin}/`;
    const rows = await indexableTemplates(db, indexVoters(env));
    const entries = rows.flatMap((r) => {
      const t = templateByKey(r.template);
      if (!t) return [];
      const lastmod = new Date(r.active).toISOString().slice(0, 10);
      return [`  <url><loc>${esc(`${site}${templatePath(t, r.lang)}`)}</loc><lastmod>${lastmod}</lastmod></url>`];
    });
    if (entries.length) xml = xml.replace('</urlset>', `${entries.join('\n')}\n</urlset>`);
  }
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
