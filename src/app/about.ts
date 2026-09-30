// Imports carry their extension and stay type-only: build/seo.ts renders this module while Vite loads its config.
import type { MethodKey } from '../core/types.ts';
import type { MsgKey } from '../i18n/en.ts';

/**
 * What Versus is, under the gallery: the page's only prose, so also what search engines and language models
 * read. index.html carries a static English copy with the page's h1 (build/seo.ts), for crawlers that don't
 * run JavaScript; the app replaces it with the gallery, where this section comes back in the visitor's
 * language one level down, "Your rankings" being the h1 there.
 */

/** Where the section links to; build/site.ts takes the author and repository from here too. */
export const LINKS = {
  author: { name: 'Steeve Pommier', url: 'https://steevepommier.com/' },
  source: 'https://github.com/CostardRouge/versus',
} as const;

const METHODS: readonly MethodKey[] = ['bt', 'elo', 'win', 'sort'];

/** `t()` in the app, the English messages at build time. */
export type Text = (key: MsgKey) => string;

export function aboutHTML(tx: Text, opts: { h1: boolean; publish: boolean }): string {
  const top = opts.h1 ? 'h1' : 'h2';
  const sub = opts.h1 ? 'h2' : 'h3';
  const method = (k: MethodKey) =>
    `<div><dt>${tx(`m_${k}`)} <span class="mono">${tx(`m_${k}_tech`)}</span></dt><dd>${tx(`m_${k}_desc`)}</dd></div>`;
  return `<section class="about" aria-labelledby="about-title">
      <${top} id="about-title">${tx('aboutTitle')}</${top}>
      <p class="about-lead">${tx('aboutLead')}</p>
      <div class="about-cols">
        <div>
          <${sub}>${tx('aboutHowTitle')}</${sub}>
          <ol class="about-steps"><li>${tx('aboutStep1')}</li><li>${tx('aboutStep2')}</li><li>${tx('aboutStep3')}</li></ol>
        </div>
        <div>
          <${sub}>${tx('aboutMethodsTitle')}</${sub}>
          <p>${tx('aboutMethodsIntro')}</p>
          <dl class="about-methods">${METHODS.map(method).join('')}</dl>
        </div>
        <div>
          <${sub}>${tx('aboutPrivateTitle')}</${sub}>
          <p>${tx('aboutPrivate')}</p>${opts.publish ? `\n          <${sub}>${tx('aboutPublishTitle')}</${sub}>\n          <p>${tx('aboutPublish')}</p>` : ''}
        </div>
      </div>
      <p class="about-foot">${tx('aboutBy')} <a href="${LINKS.author.url}">${LINKS.author.name}</a> · <a href="${LINKS.source}">${tx('aboutSource')}</a></p>
    </section>`;
}
