import { TTL_DAYS } from '../core/board.ts';
import { LEGAL_PATH } from '../core/site.ts';
import { esc } from '../core/util.ts';
import type { Lang } from '../i18n/index.ts';
import { type LegalKey, type LegalMessages, legalEn } from '../i18n/legal-en.ts';
import { legalFr } from '../i18n/legal-fr.ts';
import { fill } from '../i18n/text.ts';
import { footerHTML, navHTML, type PageLinks } from '../landing/markup.ts';
import { strings } from '../landing/strings.ts';

/**
 * The legal notice (publisher, hosting, privacy, audience measurement, licence), rendered at build time in each
 * language (build/seo-plugin.ts puts it in legal/index.html and fr/mentions-legales/index.html) with the home
 * page's header and footer. Its script (src/legal/main.ts) only counts the view and runs the measurement switch.
 */

const TEXTS: Record<Lang, LegalMessages> = { en: legalEn, fr: legalFr };

export interface LegalOpts {
  /** Where questions, requests and reports go. */
  contact: string;
  /** The repository; its licence is LICENSE on main. */
  source: string;
  author: { name: string; url: string };
}

/** From a legal page back to the site's root. */
const rootOf = (lang: Lang): string => '../'.repeat(LEGAL_PATH[lang].split('/').filter(Boolean).length);

/** Runs before the first paint, from <head>: the saved light or dark theme, and JavaScript marked as running. */
export function legalBoot(): string {
  return `<script>
      (function () {
        var d = document.documentElement;
        d.classList.add('js');
        try {
          var theme = JSON.parse(localStorage.getItem('versus-prefs') || '{}').theme;
          if (theme === 'light' || theme === 'dark') d.dataset.theme = theme;
        } catch (e) {}
      })();
    </script>`;
}

/** Everything inside <body> but the module script. */
export function legalBody(lang: Lang, opts: LegalOpts): string {
  const T = TEXTS[lang];
  const S = strings(lang);
  const root = rootOf(lang);
  const links: PageLinks = { root, versions: { en: `${root}${LEGAL_PATH.en}`, fr: `${root}${LEGAL_PATH.fr}` } };
  const email = `<a href="mailto:${esc(opts.contact)}">${esc(opts.contact)}</a>`;
  const vars: Record<string, string> = {
    email,
    days: String(TTL_DAYS),
    source: esc(opts.source),
    license: esc(`${opts.source}/blob/main/LICENSE`),
  };
  // Trusted strings (src/i18n/legal-*.ts) with their placeholders filled.
  const tx = (key: LegalKey): string => fill(T[key], vars);
  const p = (...keys: LegalKey[]) => keys.map((k) => `<p>${tx(k)}</p>`).join('\n        ');
  const section = (id: string, title: LegalKey, body: string) =>
    `<section class="lg-sec" id="${id}" aria-labelledby="${id}-h">
        <h2 id="${id}-h">${tx(title)}</h2>
        ${body}
      </section>`;
  const sub = (id: string, title: LegalKey, body: string) =>
    `<h3 id="${id}">${tx(title)}</h3>
        ${body}`;
  const toc: [string, LegalKey][] = [
    ['publisher', 'pubTitle'],
    ['hosting', 'hostTitle'],
    ['privacy', 'privTitle'],
    ['measurement', 'countTitle'],
    ['licence', 'licenceTitle'],
    ['liability', 'liabTitle'],
  ];
  // The switch starts hidden: the script shows it with the state of this browser, and without JavaScript the
  // text above it says how to decline anyway.
  const counter = `<div class="lg-count" id="count" hidden>
          <p class="lg-count-state" id="count-state" aria-live="polite"><span data-when="on">${tx('countOn')}</span><span data-when="off" hidden>${tx('countOff')}</span><span data-when="signal" hidden>${tx('countSignal')}</span><span data-when="none" hidden>${tx('countNone')}</span></p>
          <button type="button" class="btn" id="count-toggle" data-when="on off"><span data-when="on">${tx('countStop')}</span><span data-when="off" hidden>${tx('countResume')}</span></button>
        </div>`;
  return `<a class="skip" href="#main">${esc(S.skipLink)}</a>
    ${navHTML(lang, S, links, false)}
    <main id="main" class="wrap lg" tabindex="-1">
      <header class="lg-head">
        <h1 class="lg-h">${tx('title')}</h1>
        <p class="lede">${tx('intro')}</p>
        <nav class="lg-toc" aria-label="${esc(T.tocAria)}"><ol>${toc.map(([id, key]) => `<li><a href="#${id}">${tx(key)}</a></li>`).join('')}</ol></nav>
      </header>
      ${section('publisher', 'pubTitle', p('pub1', 'pubContact', 'pub2'))}
      ${section('hosting', 'hostTitle', p('host1', 'host2', 'host3'))}
      ${section(
        'privacy',
        'privTitle',
        [
          p('privShort'),
          sub('device', 'deviceTitle', p('device1', 'device2')),
          sub('boards', 'boardsTitle', p('boards1', 'boards2', 'boards3')),
          sub('measurement', 'countTitle', `${p('count1', 'count2', 'count3', 'count4')}\n        ${counter}`),
          sub('cookies', 'cookiesTitle', p('cookies1')),
          sub('logs', 'logsTitle', p('logs1')),
          sub('rights', 'rightsTitle', p('rights1')),
        ].join('\n        '),
      )}
      ${section('licence', 'licenceTitle', p('licence1', 'licence2'))}
      ${section('liability', 'liabTitle', p('liab1'))}
      <p class="lg-updated muted">${tx('updated')}</p>
    </main>
    ${footerHTML(lang, S, opts.author, opts.source, links)}`;
}
