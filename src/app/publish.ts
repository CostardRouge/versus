import { trackEvent } from '../audience';
import { CROWD_METHODS, DEFAULT_SETTINGS, LIMITS } from '../core/board';
import { lastDuelPerPair, type PublishBlock, publishBlock, publishMethod, publishRequest } from '../core/published';
import type { BoardSettings, MethodKey, Ranking, Visibility } from '../core/types';
import { getLang, methodText as M, type MsgKey, plural, t } from '../i18n';
import { boardURL } from './board';
import { $, ask, copyText, doc, toast } from './dom';
import { openBoard } from './rankings';
import { ApiError, publishBoard } from './remote';
import { uploadPublishedCard } from './share';
import { S, save } from './state';
import { saveOwner } from './storage';

/** Publishing a local ranking, and the settings form shared by the publish modal and the author panel. */

const VISIBILITIES: readonly Visibility[] = ['always', 'after', 'blind'];

/** Results visibility and scoring method. Exact sort is listed but can't be picked, with the reason. */
export function settingsHTML(prefix: string, s: BoardSettings): string {
  const radio = (name: string, value: string, checked: boolean) =>
    `<input type="radio" name="${prefix}-${name}" value="${value}" ${checked ? 'checked' : ''}>`;
  const vis = (v: Visibility) => {
    if (v !== 'after') {
      return `<label class="opt">${radio('vis', v, s.visibility === v)} ${t(v === 'always' ? 'visAlways' : 'visBlind')}</label>`;
    }
    return `<div class="opt"><label class="opt">${radio('vis', v, s.visibility === v)} ${t('visAfterPre')}</label>
      <input class="opt-n mono" type="number" id="${prefix}-n" min="1" max="${LIMITS.revealAfter}" value="${s.revealAfter}" aria-label="${t('visAfterPre')} … ${t('visAfterPost')}"> ${t('visAfterPost')}</div>`;
  };
  const method = (k: MethodKey) =>
    `<label class="opt">${radio('m', k, s.method === k)} <b>${M(k).name}</b> <span class="muted mono">${M(k).tech}</span></label>`;
  return `<fieldset class="set"><legend>${t('settingResults')}</legend>${VISIBILITIES.map(vis).join('')}</fieldset>
    <fieldset class="set"><legend>${t('settingMethod')}</legend>${CROWD_METHODS.map(method).join('')}
      <div class="opt off" aria-disabled="true"><span class="opt-dot" aria-hidden="true"></span><span><b>${M('sort').name}</b> <span class="mono">${M('sort').tech}</span><small>${t('sortCrowd')}</small></span></div>
    </fieldset>`;
}

/** Whether voters can change their votes, and whether visitors can add items. */
export const optionsHTML = (prefix: string, s: BoardSettings): string =>
  `<label class="opt"><input type="checkbox" id="${prefix}-change" ${s.allowChange ? 'checked' : ''}> ${t('allowChange')}</label>
  <label class="opt"><input type="checkbox" id="${prefix}-visitors" ${s.visitorsAddItems ? 'checked' : ''}> ${t('visitorsAdd')}</label>`;

/** The settings a form holds; the server validates them again. */
export function readSettings(root: ParentNode, prefix: string): Partial<BoardSettings> {
  const input = (sel: string) => root.querySelector<HTMLInputElement>(sel);
  const out: Partial<BoardSettings> = {};
  const vis = input(`input[name="${prefix}-vis"]:checked`)?.value;
  if (VISIBILITIES.includes(vis as Visibility)) out.visibility = vis as Visibility;
  const n = Number(input(`#${prefix}-n`)?.value);
  if (Number.isInteger(n) && n >= 1 && n <= LIMITS.revealAfter) out.revealAfter = n;
  const m = input(`input[name="${prefix}-m"]:checked`)?.value;
  if (CROWD_METHODS.includes(m as MethodKey)) out.method = m as MethodKey;
  const change = input(`#${prefix}-change`);
  if (change) out.allowChange = change.checked;
  const visitors = input(`#${prefix}-visitors`);
  if (visitors) out.visitorsAddItems = visitors.checked;
  return out;
}

const BLOCKS: Record<PublishBlock, MsgKey> = {
  images: 'blockImages',
  too_few: 'blockTooFew',
  too_many: 'blockTooMany',
};

let publishing = false;

// ─── Turnstile (only when a site key is configured; the server checks the token) ──

interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string }): string;
  getResponse(id: string): string | undefined;
  remove(id: string): void;
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
let turnstileScript: Promise<TurnstileApi | undefined> | null = null;

function loadTurnstile(): Promise<TurnstileApi | undefined> {
  turnstileScript ??= new Promise((resolve) => {
    const script = doc.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve((window as { turnstile?: TurnstileApi }).turnstile);
    script.onerror = () => {
      turnstileScript = null;
      resolve(undefined);
    };
    doc.head.append(script);
  });
  return turnstileScript;
}

const PUBLISH_ERRORS: Partial<Record<string, MsgKey>> = {
  captcha: 'captchaFailed',
  rate_limited: 'tooManyTries',
  images_not_allowed: 'blockImages',
};

export async function publishRanking(r: Ranking | undefined): Promise<void> {
  if (!r || r.pub || publishing) return;
  const block = publishBlock(r);
  if (block) {
    await ask({ title: t('cantPublish'), body: t(BLOCKS[block], { n: LIMITS.items }), ok: t('gotIt'), cancel: false });
    return;
  }
  const duels = lastDuelPerPair(r).length;
  const settings: BoardSettings = { ...DEFAULT_SETTINGS, method: publishMethod(r) };
  const html = `<p>${t('publishBody')}</p>
    ${duels ? `<label class="opt pub-votes"><input type="checkbox" id="pub-votes" checked> ${t('publishVotes', { duels: plural(duels, 'duel') })}</label>` : ''}
    ${settingsHTML('pub', settings)}
    <details class="more"><summary>${t('moreOptions')}</summary>${optionsHTML('pub', settings)}</details>
    ${SITE_KEY ? '<div class="pub-captcha" id="pub-captcha"></div>' : ''}`;
  const asked = ask({ title: t('publishTitle'), html, ok: t('publish') });
  let widget: { api: TurnstileApi; id: string } | null = null;
  if (SITE_KEY) {
    void loadTurnstile().then((api) => {
      const el = $('#pub-captcha');
      if (api && el) widget = { api, id: api.render(el, { sitekey: SITE_KEY }) };
    });
  }
  const confirmed = await asked;
  const current = widget as { api: TurnstileApi; id: string } | null;
  const turnstile = current ? current.api.getResponse(current.id) : undefined;
  current?.api.remove(current.id);
  if (!confirmed) return;
  if (SITE_KEY && !turnstile) {
    toast(t('captchaMissing'));
    return;
  }
  const form = $('#m-body');
  if (!form) return;
  const chosen = readSettings(form, 'pub');
  const withVotes = $<HTMLInputElement>('#pub-votes', form)?.checked ?? false;
  publishing = true;
  try {
    const request = {
      ...publishRequest(r, S.voter, chosen, withVotes, getLang()),
      ...(turnstile ? { turnstile } : {}),
    };
    const { alias, owner } = await publishBoard(request);
    const used = { ...settings, ...chosen };
    trackEvent('board-published', {
      method: used.method,
      visibility: used.visibility,
      items: r.items.length,
      votes: withVotes,
    });
    r.pub = { alias, status: 'open' };
    r.updated = Date.now();
    saveOwner(alias, owner);
    save();
    // The link's preview image, drawn here from the same items and votes the server just received.
    uploadPublishedCard(r, alias, withVotes);
    const copied = await copyText(boardURL(alias));
    openBoard(alias);
    toast(t(copied ? 'published' : 'publishedShare'));
  } catch (e) {
    toast(t((e instanceof ApiError && PUBLISH_ERRORS[e.code]) || 'publishFailed'));
  } finally {
    publishing = false;
  }
}
