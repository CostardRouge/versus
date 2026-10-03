import { trackEvent } from '../audience';
import { imageSrc } from '../core/model';
import type { RankingView } from '../core/protocol';
import { agreement, lastDuelPerPair, ownRanking } from '../core/published';
import { methodOf, validHistory } from '../core/scoring';
import {
  CARD_FORMATS,
  type CardFormat,
  type CardRow,
  type CardSpec,
  type CardTexts,
  type CompareCard,
  cardItems,
  compareSpec,
  crowdSpec,
  type DuelCard,
  type DuoCard,
  duelQuery,
  duelSpec,
  duoSpec,
  localSpec,
  OG_FORMAT,
  previewSpec,
  publishedSpec,
  rankingSpec,
  type StandingsCard,
} from '../core/share';
import type { BoardSettings, ItemStats, MethodKey, Ranking } from '../core/types';
import { esc, fileSlug } from '../core/util';
import { methodText as M, type MsgKey, pct, plural, t } from '../i18n';
import { boardShareData, boardURL, resultView } from './board';
import { $, ask, copyText, doc, toast } from './dom';
import { podiumWho } from './finale';
import { fmtScore } from './format';
import { ApiError, putCard } from './remote';
import { compareWith, rankView } from './results';
import { siteURL } from './router';
import { drawCard, type Images, type Palette } from './share-draw';
import { loadOwners } from './storage';

/**
 * Sharing a result as an image: the app draws it on a canvas (share-draw.ts), in the app's fonts and colors, in
 * three formats (post, story, landscape), and hands it to the system share sheet (Web Share API, with the message
 * and the link), the clipboard or a download. The landscape card of a board, or of one of its duels, is also
 * sent to the server, which serves it as the preview image of the link (docs/seo.md). Nothing here is drawn
 * on the server: the free plan has no time for it, and the browser already has the fonts.
 */

// ─── Palette and fonts ──────────────────────────────────────────────────────

/** The light palette's values, for a page without the stylesheet (tests); the real ones come from the CSS tokens. */
const FALLBACK: Palette = {
  bg: '#eceef2',
  surface: '#fafbfd',
  surface2: '#e1e4eb',
  ink: '#13151b',
  muted: '#5a6072',
  line: '#d2d6df',
  a: '#2743f5',
  b: '#e4492a',
  onAccent: '#ffffff',
  display: '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif',
  body: '"Figtree Variable", "Figtree", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

/**
 * The page's design tokens. `light` forces the light palette whatever the theme (the cards links unfurl with
 * look the same for everyone): the switch is undone in the same task, before anything is painted.
 */
export function palette(light = false): Palette {
  const root = doc.documentElement;
  const prev = root.dataset.theme;
  const force = light && prev !== 'light';
  if (force) root.dataset.theme = 'light';
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const p: Palette = {
    bg: v('--bg', FALLBACK.bg),
    surface: v('--surface', FALLBACK.surface),
    surface2: v('--surface-2', FALLBACK.surface2),
    ink: v('--ink', FALLBACK.ink),
    muted: v('--muted', FALLBACK.muted),
    line: v('--line', FALLBACK.line),
    a: v('--a', FALLBACK.a),
    b: v('--b', FALLBACK.b),
    onAccent: v('--on-accent', FALLBACK.onAccent),
    display: v('--f-display', FALLBACK.display),
    body: v('--f-body', FALLBACK.body),
    mono: v('--f-mono', FALLBACK.mono),
  };
  if (force) {
    if (prev === undefined) delete root.dataset.theme;
    else root.dataset.theme = prev;
  }
  return p;
}

/** Waits for the fonts the cards use, so the canvas doesn't draw with a fallback face. */
async function fonts(P: Palette): Promise<void> {
  const set = doc.fonts;
  if (!set?.load) return;
  try {
    await Promise.all([
      set.load(`700 40px ${P.display}`),
      set.load(`800 40px ${P.display}`),
      set.load(`600 30px ${P.body}`),
      set.load(`500 30px ${P.body}`),
      set.load(`500 24px ${P.mono}`),
    ]);
  } catch {
    /* a font that fails to load: the canvas uses the fallback face */
  }
}

// ─── Rendering: fonts, images, blobs ────────────────────────────────────────

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      // A picture that never answers must not hold the card back: it is left blank.
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

async function imagesOf(spec: CardSpec): Promise<Images> {
  const srcs = [
    ...new Set(
      cardItems(spec)
        .map(imageSrc)
        .filter((s): s is string => !!s),
    ),
  ];
  const loaded = await Promise.all(srcs.map(loadImage));
  const out: Images = new Map();
  srcs.forEach((s, i) => {
    const img = loaded[i];
    if (img) out.set(s, img);
  });
  return out;
}

/** A card as a canvas, fonts and pictures loaded first; `light` forces the light palette. */
export async function renderCard(spec: CardSpec, format: CardFormat, light = false): Promise<HTMLCanvasElement | null> {
  const P = palette(light);
  const [, images] = await Promise.all([fonts(P), imagesOf(spec)]);
  const canvas = doc.createElement('canvas');
  return drawCard(canvas, spec, format, P, images) ? canvas : null;
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });

// ─── Texts ──────────────────────────────────────────────────────────────────

const texts = (): CardTexts => ({
  brand: 'Versus',
  crowd: t('finCrowd'),
  me: t('cardMe'),
  agree: t('finAgree'),
  question: t('question'),
  vote: t('cardVote'),
  made: t('cardMade'),
});

const scoreMeta = (m: MethodKey, s: ItemStats): string => (m === 'sort' ? '' : fmtScore(m, s));
const crowdMeta = (m: MethodKey, x: RankingView['stats'][string]): string =>
  m === 'win' ? pct(Math.round(x.score * 100)) : String(Math.round(x.score));

const top = (rows: readonly CardRow[], n = 5): string =>
  rows
    .slice(0, n)
    .map((r, i) => `${i + 1}. ${r.it.label}`)
    .join('\n');

/** The message that goes with the image: the standings, or the duel's question, and the link. */
export function shareMessage(spec: CardSpec): string {
  const vote = `${t('shareVoteToo')} ${spec.url}`;
  if (spec.kind === 'duel') return `${t('shareMsgOr', { a: spec.pair[0].label, b: spec.pair[1].label })} ${vote}`;
  const three = (rows: readonly CardRow[]) =>
    rows
      .slice(0, 3)
      .map((r) => r.it.label)
      .join(' · ');
  if (spec.kind === 'duo') {
    const agree = spec.agree === null ? '' : `${t('shareAgree', { pct: pct(spec.agree) })}\n`;
    return `${spec.title}\n${agree}${t('shareMyTop')} ${three(spec.mine)}\n${t('shareCrowdTop')} ${three(spec.rows)}\n\n${vote}`;
  }
  if (spec.kind === 'compare') {
    const [a, b] = spec.columns;
    return `${spec.title} · ${spec.subtitle}\n${a}: ${three(spec.mine)}\n${b}: ${three(spec.rows)}\n\n${t('cardMade')} · ${spec.url}`;
  }
  const head = spec.subtitle ? `${spec.title} · ${spec.subtitle}` : spec.title;
  const foot = spec.kind === 'crowd' ? vote : `${t('cardMade')} · ${spec.url}`;
  return `${head}\n${top(spec.rows)}\n\n${foot}`;
}

// ─── Specs from what is on screen ───────────────────────────────────────────

const countsLine = (votes: number, voters: number): string => `${plural(votes, 'vote')} · ${plural(voters, 'voter')}`;

/** A local ranking, from the Ranking tab: its podium and rows. */
export function localCardSpec(r: Ranking): StandingsCard {
  const duels = validHistory(r).length;
  const sub = `${plural(r.items.length, 'item')} · ${plural(duels, 'duel')} · ${M(methodOf(r)).name}`;
  return localSpec(r, sub, siteURL(), texts(), scoreMeta);
}

/** A local ranking by its method facing the one the Ranking tab's lines compare it with; null when there is none. */
export function compareCardSpec(r: Ranking): CompareCard | null {
  const m = methodOf(r);
  const other = compareWith(r);
  const duels = validHistory(r).length;
  if (!other || !duels || r.items.length < 2) return null;
  const sub = `${plural(r.items.length, 'item')} · ${plural(duels, 'duel')}`;
  return compareSpec(r, other, [M(m).name, M(other).name], sub, siteURL(), texts());
}

/** The board on screen: the crowd's standings as this viewer may see them. */
export function boardCardSpec(): StandingsCard | null {
  const b = boardShareData();
  if (!b) return null;
  const sub = b.ranking
    ? countsLine(b.counts.votes, b.counts.voters)
    : `${plural(b.view.items.length, 'item')} · ${plural(b.counts.votes, 'vote')}`;
  return crowdSpec(b.view, b.ranking, sub, boardURL(b.alias), texts(), crowdMeta);
}

/** The duel on screen. */
export function duelCardSpec(): DuelCard | null {
  const b = boardShareData();
  if (!b?.pair) return null;
  const [A, B] = b.pair;
  return duelSpec(b.view.title, A, B, `${boardURL(b.alias)}${duelQuery(A.id, B.id)}`, texts());
}

/** The pictures the end-of-vote page can be shared as: the crowd's podium, the voter's, and the voter facing the crowd. */
export interface FinaleCards {
  crowd: StandingsCard | null;
  mine: StandingsCard;
  duo: DuoCard | null;
}

/** The end-of-vote page's cards; the crowd's two are null while it stays hidden from this voter. */
export function finaleCards(): FinaleCards | null {
  const b = boardShareData();
  if (!b) return null;
  const counts = countsLine(b.counts.votes, b.counts.voters);
  const url = boardURL(b.alias);
  const method = b.view.settings.method;
  const own = ownRanking(b.view.items, b.mine, method);
  const mine = rankingSpec(
    b.view.title,
    own,
    `${plural(b.mine.length, 'vote')} · ${t('finMe')}`,
    url,
    texts(),
    scoreMeta,
    false,
  );
  if (!b.ranking) return { crowd: null, mine, duo: null };
  const share = agreement(b.mine, b.ranking);
  const sub = share === null ? counts : `${counts} · ${t('agreeShort', { pct: pct(Math.round(share * 100)) })}`;
  return {
    crowd: crowdSpec(b.view, b.ranking, sub, url, texts(), crowdMeta),
    mine,
    duo: duoSpec(b.view, b.ranking, b.mine, method, counts, url, texts()),
  };
}

// ─── The cards links unfurl with ────────────────────────────────────────────

const uploaded = new Set<string>();

/**
 * Sends the landscape card to the server, once per link and session, so the link shows it when pasted
 * somewhere; with the author's token when this browser holds it (the board's own card needs it, a duel's card
 * then replaces the one drawn first). Quiet: a failure changes nothing for the person sharing, and a duel that
 * has its card already (`exists`) is done.
 */
export function uploadCard(spec: CardSpec, alias: string, pair: readonly [string, string] | null): void {
  const key = `${alias}${pair ? `/${pair[0]}.${pair[1]}` : ''}`;
  if (uploaded.has(key)) return;
  uploaded.add(key);
  void (async () => {
    try {
      const canvas = await renderCard(spec, OG_FORMAT, true);
      const blob = canvas ? await toBlob(canvas) : null;
      if (blob) await putCard(alias, blob, pair, loadOwners()[alias]);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'exists')) uploaded.delete(key);
    }
  })();
}

/**
 * Right after publishing: the board's card from the local ranking (the server has the same items and votes), its
 * standings only when the chosen settings show them to everyone.
 */
export function uploadPublishedCard(
  r: Ranking,
  alias: string,
  withVotes: boolean,
  settings: Pick<BoardSettings, 'visibility'>,
): void {
  const votes = withVotes ? lastDuelPerPair(r).length : 0;
  const sub = `${plural(r.items.length, 'item')} · ${plural(votes, 'vote')}`;
  const spec = publishedSpec(r, votes > 0, sub, boardURL(alias), texts(), scoreMeta);
  uploadCard(previewSpec(spec, r.items, settings, 'open'), alias, null);
}

// ─── The share panel ────────────────────────────────────────────────────────

/** One of the pictures a share can show (a podium, lines), named as the page names its view. */
export interface ShareView {
  key: string;
  label: string;
  spec: CardSpec;
}

interface Panel {
  views: ShareView[];
  /** The picture shown: the view on screen when the panel opened, or the one picked in it. */
  view: ShareView;
  spec: CardSpec;
  kind: 'rank' | 'board' | 'duel' | 'finale';
  format: CardFormat;
  message: string;
  /** Drawn cards, by view and format. */
  canvases: Partial<Record<string, Promise<HTMLCanvasElement | null>>>;
  /** Drawing in progress, so a format or picture switch mid-way doesn't show a stale card. */
  drawing: number;
}

let panel: Panel | null = null;
/** The format chosen last, kept for the session. */
let lastFormat: CardFormat = 'post';

const FORMAT_KEYS: Record<CardFormat, MsgKey> = { post: 'fmtPost', story: 'fmtStory', landscape: 'fmtLandscape' };

const canShareFiles = (): boolean => typeof navigator.share === 'function';
const canCopyImage = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

function panelHTML(p: Panel): string {
  const fmts = CARD_FORMATS.map(
    (f) =>
      `<button type="button" data-action="share-fmt" data-fmt="${f}" aria-pressed="${f === p.format}">${t(FORMAT_KEYS[f])}</button>`,
  ).join('');
  // Which picture, when the page has more than one view of the result (D117).
  const views =
    p.views.length > 1
      ? `<div class="share-fmts share-views" role="group" aria-label="${t('shareView')}">${p.views
          .map(
            (v) =>
              `<button type="button" data-action="share-view" data-view="${esc(v.key)}" aria-pressed="${v === p.view}">${esc(v.label)}</button>`,
          )
          .join('')}</div>`
      : '';
  return `<div class="share" id="share">
    <div class="share-preview ${p.format}" id="share-preview" aria-busy="true"><span class="share-wait" role="status">${t('drawingCard')}</span></div>
    ${views}
    <div class="share-fmts" role="group" aria-label="${t('shareFormat')}">${fmts}</div>
    <div class="share-acts">
      ${canShareFiles() ? `<button class="btn primary" type="button" data-action="share-native">${t('shareNative')}</button>` : ''}
      <button class="btn" type="button" data-action="share-copy-text">${t('shareCopyText')}</button>
      ${canCopyImage() ? `<button class="btn" type="button" data-action="share-copy-image">${t('shareCopyImage')}</button>` : ''}
      <button class="btn" type="button" data-action="share-download">${t('shareDownload')}</button>
    </div>
    <p class="share-msg" id="share-msg">${esc(p.message)}</p>
  </div>`;
}

function canvasOf(p: Panel, format: CardFormat): Promise<HTMLCanvasElement | null> {
  const key = `${p.view.key}/${format}`;
  let c = p.canvases[key];
  if (!c) {
    c = renderCard(p.spec, format);
    p.canvases[key] = c;
  }
  return c;
}

async function showPreview(p: Panel): Promise<void> {
  const box = $('#share-preview');
  if (!box) return;
  const run = ++p.drawing;
  box.className = `share-preview ${p.format}`;
  // The card on screen stays until the next one is drawn; meanwhile the preview is busy (the canvas names itself).
  box.setAttribute('aria-busy', 'true');
  const canvas = await canvasOf(p, p.format);
  if (panel !== p || run !== p.drawing || !box.isConnected) return;
  box.innerHTML = canvas ? '' : `<span class="share-wait">${esc(t('shareNoImage'))}</span>`;
  box.removeAttribute('aria-busy');
  if (canvas) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('sharePreviewAlt'));
    box.append(canvas);
  }
}

const TITLES: Record<Panel['kind'], MsgKey> = {
  rank: 'shareRankTitle',
  board: 'shareRankTitle',
  duel: 'shareDuelTitle',
  finale: 'shareResultTitle',
};

/**
 * Opens the panel for a card: preview, formats and the ways to share it. Given several views (a podium, lines), it
 * offers to switch between them, starting from `current`: the one on screen.
 */
export function openShare(card: CardSpec | ShareView[], kind: Panel['kind'], current?: string): void {
  const views = Array.isArray(card) ? card : [{ key: 'card', label: '', spec: card }];
  const view = views.find((v) => v.key === current) ?? views[0];
  if (!view) return;
  const p: Panel = {
    views,
    view,
    spec: view.spec,
    kind,
    format: lastFormat,
    message: shareMessage(view.spec),
    canvases: {},
    drawing: 0,
  };
  panel = p;
  void ask({ title: t(TITLES[kind]), html: panelHTML(p), ok: t('done'), cancel: false }).then(() => {
    if (panel === p) panel = null;
  });
  void showPreview(p);
}

/** Another picture in the open panel: the card and its message change, the format stays. */
export function shareView(key: string | undefined): void {
  const p = panel;
  const view = p?.views.find((v) => v.key === key);
  if (!p || !view || view === p.view) return;
  p.view = view;
  p.spec = view.spec;
  p.message = shareMessage(view.spec);
  for (const b of doc.querySelectorAll<HTMLElement>('[data-action="share-view"]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === key));
  }
  const msg = $('#share-msg');
  if (msg) msg.textContent = p.message;
  void showPreview(p);
}

/** The Ranking tab of a local ranking: its podium, or its lines facing another method, as on screen. */
export function shareLocal(r: Ranking | undefined): void {
  if (!r || r.items.length < 2) return;
  const lines = compareCardSpec(r);
  const views: ShareView[] = [{ key: 'podium', label: t('rankPodium'), spec: localCardSpec(r) }];
  if (lines) views.push({ key: 'lines', label: t('rankLines'), spec: lines });
  openShare(views, 'rank', rankView());
}

/**
 * The board page: the crowd's standings as the sharer sees them. Shared by its author, its landscape card also
 * becomes the link's preview, the standings only when everyone may see them.
 */
export function shareBoard(): void {
  const spec = boardCardSpec();
  const b = boardShareData();
  if (!spec || !b) return;
  if (b.isOwner) uploadCard(previewSpec(spec, b.view.items, b.view.settings, b.view.status), b.alias, null);
  openShare(spec, 'board');
}

/** The duel on screen: the link opens the board on it. */
export function shareDuel(): void {
  const spec = duelCardSpec();
  const b = boardShareData();
  if (!spec || !b) return;
  uploadCard(spec, b.alias, [spec.pair[0].id, spec.pair[1].id]);
  openShare(spec, 'duel');
}

/**
 * The end-of-vote page: the crowd's podium, the voter's, or the voter facing the crowd, starting from the view on
 * screen. While the crowd stays hidden, the voter's podium only.
 */
export function shareFinale(): void {
  const cards = finaleCards();
  if (!cards) return;
  const views: ShareView[] = [];
  if (cards.crowd) views.push({ key: 'crowd', label: t('finCrowdPodium'), spec: cards.crowd });
  views.push({ key: 'mine', label: t('finMyPodium'), spec: cards.mine });
  if (cards.duo) views.push({ key: 'duo', label: t('finDuo'), spec: cards.duo });
  const current = resultView() === 'duo' ? 'duo' : podiumWho() === 'me' ? 'mine' : 'crowd';
  openShare(views, 'finale', current);
}

export function shareFormat(fmt: string | undefined): void {
  const p = panel;
  if (!p || !CARD_FORMATS.includes(fmt as CardFormat) || fmt === p.format) return;
  p.format = fmt as CardFormat;
  lastFormat = p.format;
  for (const b of doc.querySelectorAll<HTMLElement>('[data-action="share-fmt"]')) {
    b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt));
  }
  void showPreview(p);
}

const track = (p: Panel, how: string) => trackEvent('shared', { kind: p.spec.kind, format: p.format, how });

async function blobOf(p: Panel): Promise<Blob | null> {
  const canvas = await canvasOf(p, p.format);
  return canvas ? toBlob(canvas) : null;
}

/** `versus-next-destination-post.png`; `versus-post.png` for a title with nothing to keep. */
const fileName = (p: Panel): string => `${['versus', fileSlug(p.spec.title), p.format].filter(Boolean).join('-')}.png`;

/** The system share sheet, with the image when the browser can share files. */
export async function shareNative(): Promise<void> {
  const p = panel;
  if (!p || typeof navigator.share !== 'function') return;
  const blob = await blobOf(p);
  const file = blob ? new File([blob], fileName(p), { type: 'image/png' }) : null;
  const withFile = file && (navigator.canShare?.({ files: [file] }) ?? false);
  const data: ShareData = withFile ? { files: [file], text: p.message } : { text: p.message };
  try {
    await navigator.share(data);
    track(p, withFile ? 'share-image' : 'share-text');
  } catch (e) {
    // The person closed the sheet: nothing to say.
    if (!(e instanceof DOMException && e.name === 'AbortError')) toast(t('shareFailed'));
  }
}

export async function shareCopyText(): Promise<void> {
  const p = panel;
  if (!p) return;
  const ok = await copyText(p.message);
  toast(ok ? t('shareTextCopied') : t('copyNA'));
  if (ok) track(p, 'copy-text');
}

export async function shareCopyImage(): Promise<void> {
  const p = panel;
  if (!p || !canCopyImage()) return;
  const blob = await blobOf(p);
  if (!blob) {
    toast(t('shareNoImage'));
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(t('shareImageCopied'));
    track(p, 'copy-image');
  } catch {
    toast(t('shareFailed'));
  }
}

export async function shareDownload(): Promise<void> {
  const p = panel;
  if (!p) return;
  const blob = await blobOf(p);
  if (!blob || typeof URL.createObjectURL !== 'function') {
    toast(t('shareNoImage'));
    return;
  }
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(p);
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  track(p, 'download');
}
