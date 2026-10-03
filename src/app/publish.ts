import { trackEvent } from '../audience';
import { CROWD_METHODS, DEFAULT_SETTINGS, LIMITS, VISIBILITIES, validSettings } from '../core/board';
import {
  dataURLBytes,
  lastDuelPerPair,
  type PublishBlock,
  pictureItems,
  publishBlock,
  publishMethod,
  publishRequest,
} from '../core/published';
import type { BoardSettings, MethodKey, Ranking, Visibility } from '../core/types';
import { getLang, methodText as M, type MsgKey, plural, t } from '../i18n';
import { picturesToast, sendPicture } from './author';
import { boardURL } from './board';
import { $, ask, copyText, toast } from './dom';
import { errorKey, PUBLISH_ERRORS } from './errors';
import { openBoard } from './rankings';
import { fetchConfig, publishBoard } from './remote';
import { S, save } from './state';
import { saveOwner } from './storage';
import { turnstileKey, turnstileWidget } from './turnstile';

/** Publishing a local ranking, and the settings form shared by the publish modal and the board's settings. */

const radio = (prefix: string, name: string, value: string, checked: boolean): string =>
  `<input type="radio" name="${prefix}-${name}" value="${value}" ${checked ? 'checked' : ''}>`;

/** Results visibility: always, after N votes, or hidden until the vote closes. */
export function visibilityHTML(prefix: string, s: BoardSettings): string {
  const vis = (v: Visibility) => {
    if (v !== 'after') {
      return `<label class="opt">${radio(prefix, 'vis', v, s.visibility === v)} ${t(v === 'always' ? 'visAlways' : 'visBlind')}</label>`;
    }
    return `<div class="opt"><label class="opt">${radio(prefix, 'vis', v, s.visibility === v)} ${t('visAfterPre')}</label>
      <input class="opt-n mono" type="number" id="${prefix}-n" min="1" max="${LIMITS.revealAfter}" value="${s.revealAfter}" aria-label="${t('visAfterPre')} … ${t('visAfterPost')}"> ${t('visAfterPost')}</div>`;
  };
  return `<fieldset class="set"><legend>${t('settingResults')}</legend>${VISIBILITIES.map(vis).join('')}</fieldset>`;
}

/** Results visibility and scoring method. Exact sort is listed but can't be picked, with the reason. */
export function settingsHTML(prefix: string, s: BoardSettings): string {
  const method = (k: MethodKey) =>
    `<label class="opt">${radio(prefix, 'm', k, s.method === k)} <b>${M(k).name}</b> <span class="muted mono">${M(k).tech}</span></label>`;
  return `${visibilityHTML(prefix, s)}
    <fieldset class="set"><legend>${t('settingMethod')}</legend>${CROWD_METHODS.map(method).join('')}
      <div class="opt off" aria-disabled="true"><span class="opt-dot" aria-hidden="true"></span><span><b>${M('sort').name}</b> <span class="mono">${M('sort').tech}</span><small>${t('sortCrowd')}</small></span></div>
    </fieldset>`;
}

/** Whether voters can change their votes, and whether visitors can add items. */
export const optionsHTML = (prefix: string, s: BoardSettings): string =>
  `<label class="opt"><input type="checkbox" id="${prefix}-change" ${s.allowChange ? 'checked' : ''}> ${t('allowChange')}</label>
  <label class="opt"><input type="checkbox" id="${prefix}-visitors" ${s.visitorsAddItems ? 'checked' : ''}> ${t('visitorsAdd')}</label>`;

/** The valid settings a form holds (the fields it has); the server validates them again. */
export function readSettings(root: ParentNode, prefix: string): Partial<BoardSettings> {
  const input = (sel: string) => root.querySelector<HTMLInputElement>(sel);
  return validSettings({
    method: input(`input[name="${prefix}-m"]:checked`)?.value,
    visibility: input(`input[name="${prefix}-vis"]:checked`)?.value,
    revealAfter: Number(input(`#${prefix}-n`)?.value),
    allowChange: input(`#${prefix}-change`)?.checked,
    visitorsAddItems: input(`#${prefix}-visitors`)?.checked,
  });
}

const BLOCKS: Record<PublishBlock, MsgKey> = {
  images: 'blockImages',
  too_few: 'blockTooFew',
  too_many: 'blockTooMany',
};

let publishing = false;

/** What the server answered a publication with, and what was sent. */
interface Published {
  alias: string;
  owner: string;
  chosen: Partial<BoardSettings>;
  withVotes: boolean;
}

/**
 * Sends the pictures the published items announced, one by one, for the moderator's review. A picture that
 * fails leaves its item as text, and the author's list offers to send it again (author.ts).
 */
async function sendPictures(r: Ranking, alias: string, owner: string): Promise<void> {
  let sent = 0;
  let failed = 0;
  for (const it of pictureItems(r)) {
    const data = dataURLBytes(it.img);
    if (!data) continue;
    if (await sendPicture(alias, owner, it.id, new Blob([data.bytes], { type: 'image/jpeg' }))) sent++;
    else failed++;
  }
  picturesToast(sent, failed);
}

export async function publishRanking(r: Ranking | undefined): Promise<void> {
  if (!r || r.pub || publishing) return;
  publishing = true;
  try {
    await publish(r);
  } finally {
    publishing = false;
  }
}

/**
 * The publish dialog: settings, then Publish, which keeps the dialog open and busy until the server answers. What
 * goes wrong shows in it, the settings as chosen; once published, the board opens.
 */
async function publish(r: Ranking): Promise<void> {
  let block = publishBlock(r);
  // Pictures travel only when the server reviews them (docs/published-boards.md#images).
  let pictures = 0;
  if (block === 'images' && (await fetchConfig()).images === 'review') {
    pictures = pictureItems(r).length;
    block = publishBlock({ ...r, items: r.items.map((it) => ({ ...it, img: null })) });
  }
  if (block) {
    await ask({ title: t('cantPublish'), body: t(BLOCKS[block], { n: LIMITS.items }), ok: t('gotIt'), cancel: false });
    return;
  }
  const duels = lastDuelPerPair(r).length;
  const settings: BoardSettings = { ...DEFAULT_SETTINGS, method: publishMethod(r) };
  // Turnstile, only when a site key is configured (the server checks the token).
  const check = turnstileKey() !== undefined;
  const html = `<p>${t('publishBody')}</p>
    ${pictures ? `<p class="pub-pictures">${t('publishPictures', { pictures: plural(pictures, 'picture') })}</p>` : ''}
    ${duels ? `<label class="opt pub-votes"><input type="checkbox" id="pub-votes" checked> ${t('publishVotes', { duels: plural(duels, 'duel') })}</label>` : ''}
    ${settingsHTML('pub', settings)}
    <details class="more"><summary>${t('moreOptions')}</summary>${optionsHTML('pub', settings)}</details>
    ${check ? `<div class="pub-captcha" id="pub-captcha"></div><p class="m-error" id="pub-captcha-err" role="alert" hidden>${t('captchaFailed')}</p>` : ''}`;
  let done: Published | null = null;
  const send = async (): Promise<string | true> => {
    const turnstile = widget.token();
    if (check && !turnstile) return t('captchaMissing');
    const form = $('#m-body');
    if (!form) return t('publishFailed');
    const chosen = readSettings(form, 'pub');
    const withVotes = $<HTMLInputElement>('#pub-votes', form)?.checked ?? false;
    try {
      const { alias, owner } = await publishBoard({
        ...publishRequest(r, S.voter, chosen, withVotes, getLang(), pictures > 0),
        ...(turnstile ? { turnstile } : {}),
      });
      done = { alias, owner, chosen, withVotes };
      return true;
    } catch (e) {
      // The token was spent (or may have been): another check for the next try.
      widget.reset();
      return t(errorKey(e, PUBLISH_ERRORS, 'publishFailed'));
    }
  };
  const asked = ask({
    title: t('publishTitle'),
    html,
    ok: t('publish'),
    confirm: { run: send, busy: t('publishing') },
  });
  // With a check, Publish waits for its token.
  const ok = $<HTMLButtonElement>('#m-ok');
  if (check && ok) ok.disabled = true;
  const widget = turnstileWidget('#pub-captcha', (state) => {
    if (ok && $('#pub-captcha')) ok.disabled = state !== 'ready';
    const err = $('#pub-captcha-err');
    if (err) err.hidden = state !== 'failed';
  });
  const confirmed = await asked;
  widget.take();
  // Set by send(), which TypeScript can't see run.
  const published = done as Published | null;
  if (!confirmed || !published) return;
  const { alias, owner, chosen, withVotes } = published;
  const used = { ...settings, ...chosen };
  trackEvent('board-published', {
    method: used.method,
    visibility: used.visibility,
    items: r.items.length,
    votes: withVotes,
    pictures,
  });
  r.pub = { alias, status: 'open' };
  r.updated = Date.now();
  saveOwner(alias, owner);
  save();
  // The link's preview image, drawn here from the same items and votes the server just received.
  // The drawing code loads with it, in the background.
  void import('./share').then((m) => m.uploadPublishedCard(r, alias, withVotes, used));
  if (pictures) void sendPictures(r, alias, owner);
  const copied = await copyText(boardURL(alias));
  openBoard(alias);
  toast(t(copied ? 'published' : 'publishedShare'));
}
