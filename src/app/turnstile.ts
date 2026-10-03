import { $, doc } from './dom';

/**
 * Cloudflare Turnstile, only when a site key is configured (VITE_TURNSTILE_SITE_KEY, set together with the Worker's
 * TURNSTILE_SECRET, docs/online-architecture.md#turnstile-optional); the server checks the token. Asked at
 * publication, and before a first vote on the site's own boards.
 */

export interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string }): string;
  getResponse(id: string): string | undefined;
  remove(id: string): void;
}

/** The site key, or undefined when the build has none (no check is ever shown). */
export const turnstileKey = (): string | undefined =>
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

let script: Promise<TurnstileApi | undefined> | null = null;

/** Turnstile's script, loaded once (and not at all when the page has it already). */
function loadTurnstile(): Promise<TurnstileApi | undefined> {
  const loaded = (window as { turnstile?: TurnstileApi }).turnstile;
  if (loaded) return Promise.resolve(loaded);
  script ??= new Promise((resolve) => {
    const tag = doc.createElement('script');
    tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tag.async = true;
    tag.onload = () => resolve((window as { turnstile?: TurnstileApi }).turnstile);
    tag.onerror = () => {
      script = null;
      resolve(undefined);
    };
    doc.head.append(tag);
  });
  return script;
}

/**
 * Renders the widget into the element `sel` names (in a modal just opened) once the script is there. `take()` reads
 * its token, if any, and removes it: call it when the modal closes.
 */
export function turnstileWidget(sel: string): { take(): string | undefined } {
  const key = turnstileKey();
  let widget: { api: TurnstileApi; id: string } | null = null;
  if (key) {
    void loadTurnstile().then((api) => {
      const el = $(sel);
      if (api && el) widget = { api, id: api.render(el, { sitekey: key }) };
    });
  }
  return {
    take() {
      const current = widget as { api: TurnstileApi; id: string } | null;
      widget = null;
      const token = current ? current.api.getResponse(current.id) : undefined;
      current?.api.remove(current.id);
      return token;
    },
  };
}
