import { trackEvent } from '../audience';
import { fillInk, fillNeedsHalo, haloOf, hslToHex, normHex, rgbOf } from '../core/colors';
import type { RankingView } from '../core/protocol';
import { agreement, lastDuelPerPair, ownRanking } from '../core/published';
import { methodOf, validHistory } from '../core/scoring';
import {
  CARD_FORMATS,
  CARD_ROWS,
  CARD_SIZES,
  type CardFormat,
  type CardRow,
  type CardSpec,
  type CardTexts,
  compareSpec,
  crowdSpec,
  duelQuery,
  duelSpec,
  duoSpec,
  localSpec,
  OG_FORMAT,
  rankingSpec,
} from '../core/share';
import type { Fill, Item, ItemStats, MethodKey, Ranking } from '../core/types';
import { esc, initials } from '../core/util';
import { methodText as M, type MsgKey, pct, plural, t } from '../i18n';
import { boardShareData, boardURL, resultView } from './board';
import { $, ask, copyText, doc, toast } from './dom';
import { podiumWho } from './finale';
import { fmtScore } from './format';
import { putCard } from './remote';
import { compareWith, rankView } from './results';
import { siteURL } from './router';

/**
 * Sharing a result as an image: the app draws it on a canvas, in the app's fonts and colors, in three
 * formats (post, story, landscape), and hands it to the system share sheet (Web Share API, with the message
 * and the link), the clipboard or a download. The landscape card of a board, or of one of its duels, is also
 * sent to the server, which serves it as the preview image of the link (docs/seo.md). Nothing here is drawn
 * on the server: the free plan has no time for it, and the browser already has the fonts.
 */

// ─── Palette and fonts ──────────────────────────────────────────────────────

interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  line: string;
  a: string;
  b: string;
  onAccent: string;
  display: string;
  body: string;
  mono: string;
}

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

// ─── Colors ─────────────────────────────────────────────────────────────────

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** `k` of `over` mixed into `base`, in sRGB (close enough to the stylesheet's oklab mix for these tints). */
function mix(base: string, over: string, k: number): string {
  const [r1, g1, b1] = rgbOf(base);
  const [r2, g2, b2] = rgbOf(over);
  return hex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

/** The pastel of a text item, as .card and .fin-tile paint it: the surface with a touch of the item's hue. */
const tint = (P: Palette, it: Item, k = 0.24): string => mix(P.surface, hslToHex(it.h, 72, 56), k);

/** A gradient fill as CSS draws it (155°, the middle stop at 55 %), a solid one as is. */
function fillPaint(
  ctx: CanvasRenderingContext2D,
  f: Fill,
  x: number,
  y: number,
  w: number,
  h: number,
): string | CanvasGradient {
  const c = f.colors.map(normHex);
  const a = c[0] ?? '#000000';
  if (f.type === 'solid' || c.length === 1) return a;
  const m = c[1] ?? a;
  const z = c[c.length - 1] ?? a;
  // 155° in CSS: from the top-left towards the bottom-right, slightly steeper than the diagonal.
  const angle = ((155 - 90) * Math.PI) / 180;
  const len = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
  const dx = (Math.cos(angle) * len) / 2;
  const dy = (Math.sin(angle) * len) / 2;
  const g = ctx.createLinearGradient(x + w / 2 - dx, y + h / 2 - dy, x + w / 2 + dx, y + h / 2 + dy);
  g.addColorStop(0, a);
  g.addColorStop(0.55, m);
  g.addColorStop(1, z);
  return g;
}

// ─── Drawing helpers ────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, HTMLImageElement>;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const font = (weight: number, size: number, family: string): string => `${weight} ${Math.round(size)}px ${family}`;

/** Word-wrapped lines within `max`; a word too long for a line is cut. */
function wrap(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) {
      line = next;
      while (ctx.measureText(line).width > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > max) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

interface Fitted {
  size: number;
  lines: string[];
}

/**
 * The largest size from `size` down to `min` at which the text holds in `maxLines` without cutting a word;
 * at `min`, the last line is cut if needed.
 */
function fitText(
  ctx: Ctx,
  text: string,
  max: number,
  maxLines: number,
  size: number,
  min: number,
  face: (s: number) => string,
): Fitted {
  const words = text.split(/\s+/).filter(Boolean);
  let s = size;
  for (;;) {
    ctx.font = face(s);
    const lines = wrap(ctx, text, max);
    const whole = words.every((w) => ctx.measureText(w).width <= max);
    if ((lines.length <= maxLines && whole) || s <= min) {
      const kept = lines.slice(0, maxLines);
      if (lines.length > maxLines)
        kept[maxLines - 1] = ellipsize(ctx, `${kept[maxLines - 1] ?? ''} ${lines.slice(maxLines).join(' ')}`, max);
      return { size: s, lines: kept };
    }
    s = Math.max(min, s - 2);
  }
}

/** Draws fitted lines from (x, y) downwards; returns the y after the last line. */
function lines(ctx: Ctx, f: Fitted, x: number, y: number, lineHeight = 1.1, align: CanvasTextAlign = 'left'): number {
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  let cy = y + f.size;
  for (const l of f.lines) {
    ctx.fillText(l, x, cy);
    cy += f.size * lineHeight;
  }
  return cy - f.size * lineHeight + f.size * 0.3;
}

/** An item's picture in a rounded box: its fill, its image (covered), or its tint with its initials or label. */
function drawMedia(
  ctx: Ctx,
  P: Palette,
  it: Item,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  images: Images,
  label: 'initials' | 'none',
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const img = it.img ? images.get(it.img) : undefined;
  if (it.fill) {
    ctx.fillStyle = fillPaint(ctx, it.fill, x, y, w, h);
    ctx.fillRect(x, y, w, h);
  } else if (img) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = tint(P, it, 0.3);
    ctx.fillRect(x, y, w, h);
    if (label === 'initials') {
      ctx.fillStyle = P.ink;
      ctx.font = font(700, h * 0.36, P.display);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(it.label), x + w / 2, y + h / 2 + h * 0.02);
    }
  }
  ctx.restore();
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
}

/** The mark: a disc split cobalt | coral with "vs". */
function drawMark(ctx: Ctx, P: Palette, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = P.a;
  ctx.fillRect(cx - r, cy - r, r, r * 2);
  ctx.fillStyle = P.b;
  ctx.fillRect(cx, cy - r, r, r * 2);
  ctx.restore();
  ctx.fillStyle = P.onAccent;
  ctx.font = font(800, r * 0.9, P.display);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('vs', cx, cy + r * 0.04);
}

/** A number in a small dark disc (a podium place). */
function drawBadge(ctx: Ctx, P: Palette, text: string, cx: number, cy: number, r: number, bg = P.ink, fg = P.bg): void {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = font(800, r * 1.05, P.display);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + r * 0.06);
}

/**
 * Draws an item's caption in the ink its card needs: dark or white over a fill (with the halo a mid-tone fill needs,
 * like the app's cards), white over a picture, the page's ink over a text card.
 */
function caption(ctx: Ctx, P: Palette, it: Item, size: number, draw: () => void): void {
  const ink = it.fill ? fillInk(it.fill) : it.img ? '#ffffff' : P.ink;
  ctx.save();
  ctx.fillStyle = ink;
  if (it.fill && fillNeedsHalo(it.fill)) {
    ctx.shadowColor = haloOf(ink);
    ctx.shadowBlur = size * 0.3;
  }
  draw();
  ctx.restore();
}

/** A podium tile as the end-of-vote page draws it: the item's picture, its name at the bottom, its place. */
function drawTile(
  ctx: Ctx,
  P: Palette,
  row: CardRow,
  place: number | null,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Images,
): void {
  const r = Math.round(w * 0.11);
  drawMedia(ctx, P, row.it, x, y, w, h, r, images, 'none');
  const it = row.it;
  const pad = w * 0.08;
  if (it.img) {
    // A shade under the name, as on the duel cards.
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y + h, 0, y + h * 0.45);
    g.addColorStop(0, 'rgba(8, 10, 14, 0.7)');
    g.addColorStop(1, 'rgba(8, 10, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  const label = fitText(ctx, it.label, w - pad * 2, 3, w * 0.13, w * 0.075, (s) => font(700, s, P.display));
  const height = label.lines.length * label.size * 1.05;
  caption(ctx, P, it, label.size, () => lines(ctx, label, x + pad, y + h - pad - height, 1.05));
  if (place !== null) drawBadge(ctx, P, String(place), x + pad + w * 0.07, y + pad + w * 0.07, w * 0.085);
}

/** A row of a list: place, picture, name, score. */
function drawRow(
  ctx: Ctx,
  P: Palette,
  row: CardRow,
  place: number | null,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Images,
): void {
  const s = h * 0.72;
  let cx = x;
  if (place !== null) {
    ctx.fillStyle = P.muted;
    ctx.font = font(500, h * 0.38, P.mono);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(place), x + h * 0.7, y + h / 2);
    cx += h * 0.95;
  }
  drawMedia(ctx, P, row.it, cx, y + (h - s) / 2, s, s, s * 0.26, images, 'initials');
  cx += s + h * 0.3;
  ctx.font = font(500, h * 0.36, P.mono);
  const metaW = row.meta ? ctx.measureText(row.meta).width : 0;
  if (row.meta) {
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.meta, x + w, y + h / 2);
  }
  ctx.fillStyle = P.ink;
  ctx.font = font(600, h * 0.44, P.body);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(ellipsize(ctx, row.it.label, x + w - cx - metaW - (row.meta ? h * 0.4 : 0)), cx, y + h / 2);
}

/** A duel card as the app shows it: 4:5, its side tag in a corner, the name in the display face. */
function drawDuelCard(
  ctx: Ctx,
  P: Palette,
  it: Item,
  side: 'a' | 'b',
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  images: Images,
): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = 'rgba(19, 21, 27, 0.18)';
  ctx.shadowBlur = w * 0.18;
  ctx.shadowOffsetY = w * 0.07;
  ctx.fillStyle = P.surface;
  roundRect(ctx, 0, 0, w, h, w * 0.1);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  drawMedia(ctx, P, it, 0, 0, w, h, w * 0.1, images, 'none');
  const pad = w * 0.09;
  if (it.img) {
    ctx.save();
    roundRect(ctx, 0, 0, w, h, w * 0.1);
    ctx.clip();
    const g = ctx.createLinearGradient(0, h, 0, h * 0.5);
    g.addColorStop(0, 'rgba(8, 10, 14, 0.66)');
    g.addColorStop(1, 'rgba(8, 10, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const label = fitText(ctx, it.label, w - pad * 2, 3, w * 0.17, w * 0.09, (s) => font(700, s, P.display));
  const height = label.lines.length * label.size * 1.05;
  caption(ctx, P, it, label.size, () => lines(ctx, label, pad, h - pad - height, 1.05));
  drawBadge(ctx, P, side.toUpperCase(), pad + w * 0.06, pad + w * 0.06, w * 0.08, side === 'a' ? P.a : P.b, P.onAccent);
  ctx.restore();
}

// ─── The frame: brand, footer ───────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the content stays from the top and the bottom edges, beyond the padding (a story's own chrome). */
const INSETS: Record<CardFormat, { top: number; bottom: number }> = {
  post: { top: 0, bottom: 0 },
  story: { top: 160, bottom: 200 },
  landscape: { top: 0, bottom: 0 },
};

/** Background, brand at the top, the link at the bottom; returns the box left for the content. */
function frame(ctx: Ctx, P: Palette, spec: CardSpec, format: CardFormat, W: number, H: number, u: number): Box {
  const pad = 64 * u;
  const top0 = pad + INSETS[format].top * u;
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);
  drawMark(ctx, P, pad + 27 * u, top0 + 27 * u, 27 * u);
  ctx.fillStyle = P.ink;
  ctx.font = font(800, 34 * u, P.display);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.texts.brand, pad + 68 * u, top0 + 27 * u + 2 * u);
  // Footer: "Vote at" or "Made with Versus", and the link without its scheme.
  const link = spec.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const local = (spec.kind === 'ranking' || spec.kind === 'compare') && !spec.url.includes('/b/');
  const lead = local ? spec.texts.made : spec.texts.vote;
  ctx.font = font(500, 22 * u, P.mono);
  const linkW = ctx.measureText(link).width;
  ctx.font = font(600, 24 * u, P.body);
  const leadW = ctx.measureText(lead).width;
  const oneLine = leadW + 14 * u + linkW <= W - pad * 2;
  const footY = H - pad - INSETS[format].bottom * u;
  ctx.fillStyle = P.muted;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (oneLine) {
    ctx.fillText(lead, pad, footY);
    ctx.font = font(500, 22 * u, P.mono);
    ctx.fillStyle = P.ink;
    ctx.fillText(link, pad + leadW + 14 * u, footY);
  } else {
    ctx.fillText(lead, pad, footY - 32 * u);
    ctx.font = font(500, 22 * u, P.mono);
    ctx.fillStyle = P.ink;
    ctx.fillText(ellipsize(ctx, link, W - pad * 2), pad, footY);
  }
  const top = top0 + 54 * u + 44 * u;
  return { x: pad, y: top, w: W - pad * 2, h: footY - (oneLine ? 40 * u : 72 * u) - top };
}

/** Title and subtitle at the top of a box; returns the y under them. */
function heading(ctx: Ctx, P: Palette, spec: CardSpec, box: Box, u: number, maxLines: number, size = 66): number {
  ctx.fillStyle = P.ink;
  const title = fitText(ctx, spec.title, box.w, maxLines, size * u, 34 * u, (s) => font(700, s, P.display));
  let y = lines(ctx, title, box.x, box.y, 1.04);
  if (spec.subtitle) {
    ctx.fillStyle = P.muted;
    ctx.font = font(500, 28 * u, P.body);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    y += 16 * u;
    ctx.fillText(ellipsize(ctx, spec.subtitle, box.w), box.x, y + 28 * u);
    y += 28 * u;
  }
  return y;
}

// ─── The four kinds ─────────────────────────────────────────────────────────

/** The podium (the first three, the winner taller in the middle) and the rest as rows. */
function drawStandings(
  ctx: Ctx,
  P: Palette,
  spec: CardSpec,
  box: Box,
  u: number,
  maxRows: number,
  images: Images,
): void {
  const rows = spec.rows;
  const n = Math.min(3, rows.length);
  if (!n) return;
  const gap = 18 * u;
  const tileW = (box.w - gap * (n - 1)) / n;
  const heights = n === 3 ? [0.82, 1, 0.72] : n === 2 ? [1, 0.82] : [1];
  const order = n === 3 ? [1, 0, 2] : [0, 1];
  const podiumH = Math.min(tileW * 1.05, box.h * 0.5);
  const base = box.y + podiumH;
  order.slice(0, n).forEach((idx, col) => {
    const row = rows[idx] as CardRow;
    const h = podiumH * (heights[col] ?? 1);
    const x = box.x + col * (tileW + gap);
    if (idx === 0 && spec.ranked) {
      // The winner's ring, cobalt to coral.
      const g = ctx.createLinearGradient(x, base - h, x + tileW, base);
      g.addColorStop(0, P.a);
      g.addColorStop(1, P.b);
      ctx.strokeStyle = g;
      ctx.lineWidth = 5 * u;
      roundRect(ctx, x - 6 * u, base - h - 6 * u, tileW + 12 * u, h + 12 * u, tileW * 0.11 + 6 * u);
      ctx.stroke();
    }
    drawTile(ctx, P, row, spec.ranked ? idx + 1 : null, x, base - h, tileW, h, images);
    if (row.meta) {
      ctx.fillStyle = P.muted;
      ctx.font = font(500, 22 * u, P.mono);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(row.meta, x + tileW / 2, base + 34 * u);
    }
  });
  const rowH = 62 * u;
  let y = base + 62 * u;
  const rest = rows.slice(3, maxRows);
  for (const [i, row] of rest.entries()) {
    if (y + rowH > box.y + box.h) break;
    drawRow(ctx, P, row, spec.ranked ? i + 4 : null, box.x, y, box.w, rowH, images);
    y += rowH;
    if (i < rest.length - 1) {
      ctx.fillStyle = P.line;
      ctx.fillRect(box.x + rowH * 0.95, y - 0.5 * u, box.w - rowH * 0.95, 1);
    }
  }
}

/** The landscape standings: the podium on the right of the title, two more rows under it. */
function drawStandingsWide(ctx: Ctx, P: Palette, spec: CardSpec, box: Box, u: number, images: Images): void {
  const left: Box = { ...box, w: box.w * 0.44 };
  heading(ctx, P, spec, left, u, 3, 54);
  const right: Box = { x: box.x + box.w * 0.5, y: box.y - 16 * u, w: box.w * 0.5, h: box.h + 16 * u };
  drawStandings(ctx, P, spec, right, u, CARD_ROWS.landscape, images);
}

/**
 * Two orders of the same items facing each other, joined by lines: the sharer's and the crowd's (the agreement in
 * big figures), or a ranking's by two methods.
 */
function drawDuo(ctx: Ctx, P: Palette, spec: CardSpec, box: Box, u: number, wide: boolean, images: Images): void {
  const top = wide ? heading(ctx, P, spec, { ...box, w: box.w * 0.6 }, u, 2, 42) : heading(ctx, P, spec, box, u, 2);
  let y = top + 28 * u;
  if (spec.agree !== null) {
    const big = font(800, (wide ? 84 : 110) * u, P.display);
    ctx.font = big;
    const figure = pct(spec.agree);
    const fw = ctx.measureText(figure).width;
    const ax = wide ? box.x + box.w - fw : box.x;
    const ay = wide ? box.y + 84 * u : y + 100 * u;
    ctx.fillStyle = P.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(figure, ax, ay);
    ctx.fillStyle = P.muted;
    ctx.font = font(500, 26 * u, P.body);
    const words = wrap(ctx, spec.texts.agree, wide ? box.w * 0.34 : box.w - fw - 24 * u);
    if (wide) {
      ctx.textAlign = 'right';
      for (const [i, l] of words.slice(0, 2).entries()) ctx.fillText(l, box.x + box.w, ay + 34 * u + i * 30 * u);
    } else {
      for (const [i, l] of words.slice(0, 2).entries()) ctx.fillText(l, ax + fw + 24 * u, ay - 44 * u + i * 30 * u);
      y = ay + 30 * u;
    }
  }
  if (wide) y = top + 20 * u;
  // Two columns with a gap for the lines. Upright, rows grow to fill the card when there are few of them.
  const gap = wide ? 150 * u : 130 * u;
  const colW = (box.w - gap) / 2;
  const headH = wide ? 34 * u : 40 * u;
  const room = box.y + box.h - y - headH;
  const rowH = wide ? 40 * u : Math.max(56 * u, Math.min(88 * u, room / Math.max(1, spec.mine.length)));
  const maxRows = Math.max(1, Math.min(spec.mine.length, Math.floor(room / rowH)));
  // A column's label: a colored dot at the outer edge, the text next to it.
  const label = (text: string, x: number, dot: string, align: CanvasTextAlign) => {
    const left = align === 'left';
    const cy = y + headH / 2;
    ctx.fillStyle = P.muted;
    ctx.font = font(700, 20 * u, P.body);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), left ? x + 24 * u : x - 24 * u, cy);
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(left ? x + 7 * u : x - 7 * u, cy, 7 * u, 0, Math.PI * 2);
    ctx.fill();
  };
  const [leftName, rightName] = spec.columns ?? [spec.texts.me, spec.texts.crowd];
  label(leftName, box.x, P.a, 'left');
  label(rightName, box.x + box.w, P.b, 'right');
  y += headH;
  const mine = spec.mine.slice(0, maxRows);
  const crowd = spec.rows.slice(0, maxRows);
  const at = (i: number) => y + i * rowH + rowH / 2;
  const x1 = box.x + colW + 10 * u;
  const x2 = box.x + colW + gap - 10 * u;
  // Lines first, under the rows.
  const leftPos = new Map(mine.map((r, i) => [r.it.id, i]));
  const rightPos = new Map(crowd.map((r, j) => [r.it.id, j]));
  // An item whose counterpart is below the rows shown: its line fades out towards the bottom.
  const fade = (x: number, cy: number, dir: 1 | -1, c: string) => {
    const [cr, cg, cb] = rgbOf(c);
    const g = ctx.createLinearGradient(x, 0, x + dir * gap * 0.5, 0);
    g.addColorStop(0, c);
    g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    const end = y + maxRows * rowH + rowH * 0.3;
    ctx.bezierCurveTo(x + dir * gap * 0.3, cy, x + dir * gap * 0.35, end, x + dir * gap * 0.5, end);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, cy, 5 * u, 0, Math.PI * 2);
    ctx.fill();
  };
  mine.forEach((r, i) => {
    if (!rightPos.has(r.it.id)) fade(x1, at(i), 1, P.a);
  });
  crowd.forEach((r, j) => {
    if (!leftPos.has(r.it.id)) fade(x2, at(j), -1, P.b);
  });
  crowd.forEach((r, j) => {
    const i = leftPos.get(r.it.id);
    if (i === undefined) return;
    const same = i === j;
    if (same) ctx.strokeStyle = P.line;
    else {
      const g = ctx.createLinearGradient(x1, 0, x2, 0);
      g.addColorStop(0, P.a);
      g.addColorStop(1, P.b);
      ctx.strokeStyle = g;
    }
    ctx.lineWidth = same ? 2.5 * u : 4 * u;
    ctx.beginPath();
    ctx.moveTo(x1, at(i));
    ctx.bezierCurveTo(x1 + gap * 0.45, at(i), x2 - gap * 0.45, at(j), x2, at(j));
    ctx.stroke();
    for (const [x, cy, c] of [
      [x1, at(i), P.a],
      [x2, at(j), P.b],
    ] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, cy, 5 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const s = rowH * 0.66;
  mine.forEach((r, i) => {
    const cy = at(i);
    ctx.fillStyle = P.muted;
    ctx.font = font(500, rowH * 0.36, P.mono);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), box.x + colW - 4 * u, cy);
    drawMedia(ctx, P, r.it, box.x + colW - 24 * u - s - 12 * u, cy - s / 2, s, s, s * 0.26, images, 'initials');
    ctx.fillStyle = P.ink;
    ctx.font = font(600, rowH * 0.4, P.body);
    ctx.textAlign = 'right';
    ctx.fillText(ellipsize(ctx, r.it.label, colW - s - 52 * u), box.x + colW - 24 * u - s - 24 * u, cy);
  });
  crowd.forEach((r, j) => {
    const cy = at(j);
    const x0 = box.x + colW + gap;
    ctx.fillStyle = P.muted;
    ctx.font = font(500, rowH * 0.36, P.mono);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(j + 1), x0 + 4 * u, cy);
    drawMedia(ctx, P, r.it, x0 + 36 * u, cy - s / 2, s, s, s * 0.26, images, 'initials');
    ctx.fillStyle = P.ink;
    ctx.font = font(600, rowH * 0.4, P.body);
    ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, r.it.label, colW - s - 52 * u), x0 + 36 * u + s + 12 * u, cy);
  });
}

/** Two cards facing each other, the "vs" disc between them. */
function drawDuel(ctx: Ctx, P: Palette, spec: CardSpec, box: Box, u: number, wide: boolean, images: Images): void {
  const [A, B] = spec.pair as [Item, Item];
  let stage: Box;
  if (wide) {
    const left: Box = { ...box, w: box.w * 0.42 };
    const y = heading(ctx, P, spec, left, u, 3, 46);
    ctx.fillStyle = P.ink;
    const q = fitText(ctx, spec.texts.question, left.w, 2, 30 * u, 22 * u, (s) => font(600, s, P.body));
    lines(ctx, q, left.x, y + 22 * u, 1.15);
    stage = { x: box.x + box.w * 0.47, y: box.y - 30 * u, w: box.w * 0.53, h: box.h + 50 * u };
  } else {
    const y = heading(ctx, P, spec, box, u, 2, 56);
    ctx.fillStyle = P.ink;
    const q = fitText(ctx, spec.texts.question, box.w, 2, 38 * u, 26 * u, (s) => font(700, s, P.display));
    const qy = lines(ctx, q, box.x, y + 30 * u, 1.1);
    stage = { x: box.x, y: qy + 30 * u, w: box.w, h: box.y + box.h - qy - 30 * u };
  }
  const cardW = Math.min(stage.w * 0.47, stage.h / 1.25 / 1.02);
  const cardH = cardW * 1.25;
  const cy = stage.y + stage.h / 2 - cardH / 2;
  const mid = stage.x + stage.w / 2;
  const off = wide ? cardW * 0.56 : cardW * 0.55;
  drawDuelCard(ctx, P, A, 'a', mid - off - cardW / 2, cy, cardW, cardH, -5, images);
  drawDuelCard(ctx, P, B, 'b', mid + off - cardW / 2, cy, cardW, cardH, 5, images);
  // The disc, with a ring of the background so it reads over both cards.
  const r = cardW * 0.16;
  ctx.fillStyle = P.bg;
  ctx.beginPath();
  ctx.arc(mid, cy + cardH / 2, r + 5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.ink;
  ctx.beginPath();
  ctx.arc(mid, cy + cardH / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.bg;
  ctx.font = font(800, r * 0.72, P.display);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('vs', mid, cy + cardH / 2 + r * 0.05);
}

/** Draws a card into a fresh canvas; null where the browser has no 2D canvas. */
export function drawCard(spec: CardSpec, format: CardFormat, P: Palette, images: Images): HTMLCanvasElement | null {
  const { width: W, height: H } = CARD_SIZES[format];
  const canvas = doc.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const wide = format === 'landscape';
  const u = wide ? W / 1200 : W / 1080;
  const box = frame(ctx, P, spec, format, W, H, u);
  if (spec.kind === 'duel' && spec.pair) drawDuel(ctx, P, spec, box, u, wide, images);
  else if (spec.kind === 'duo' || spec.kind === 'compare') drawDuo(ctx, P, spec, box, u, wide, images);
  else if (wide) drawStandingsWide(ctx, P, spec, box, u, images);
  else {
    const y = heading(ctx, P, spec, box, u, format === 'story' ? 3 : 2);
    drawStandings(ctx, P, spec, { ...box, y: y + 36 * u, h: box.y + box.h - y - 36 * u }, u, CARD_ROWS[format], images);
  }
  return canvas;
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
  const items = [...spec.rows, ...spec.mine].map((r) => r.it).concat(spec.pair ?? []);
  const srcs = [...new Set(items.map((i) => i.img).filter((s): s is string => !!s))];
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
  return drawCard(spec, format, P, images);
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
  if (spec.kind === 'duel' && spec.pair) {
    return `${t('shareMsgOr', { a: spec.pair[0].label, b: spec.pair[1].label })} ${vote}`;
  }
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
    const [a, b] = spec.columns ?? ['', ''];
    return `${spec.title} · ${spec.subtitle}\n${a}: ${three(spec.mine)}\n${b}: ${three(spec.rows)}\n\n${t('cardMade')} · ${spec.url}`;
  }
  const head = spec.subtitle ? `${spec.title} · ${spec.subtitle}` : spec.title;
  const foot = spec.kind === 'crowd' ? vote : `${t('cardMade')} · ${spec.url}`;
  return `${head}\n${top(spec.rows)}\n\n${foot}`;
}

// ─── Specs from what is on screen ───────────────────────────────────────────

const countsLine = (votes: number, voters: number): string => `${plural(votes, 'vote')} · ${plural(voters, 'voter')}`;

/** A local ranking, from the Ranking tab: its podium and rows. */
export function localCardSpec(r: Ranking): CardSpec {
  const spec = localSpec(r, '', siteURL(), texts(), scoreMeta);
  const duels = validHistory(r).length;
  spec.subtitle = `${plural(r.items.length, 'item')} · ${plural(duels, 'duel')} · ${M(methodOf(r)).name}`;
  return spec;
}

/** A local ranking by its method facing the one the Ranking tab's lines compare it with; null when there is none. */
export function compareCardSpec(r: Ranking): CardSpec | null {
  const m = methodOf(r);
  const other = compareWith(r);
  const duels = validHistory(r).length;
  if (!other || !duels || r.items.length < 2) return null;
  const sub = `${plural(r.items.length, 'item')} · ${plural(duels, 'duel')}`;
  return compareSpec(r, other, [M(m).name, M(other).name], sub, siteURL(), texts());
}

/** The board on screen: the crowd's standings as this viewer may see them. */
export function boardCardSpec(): CardSpec | null {
  const b = boardShareData();
  if (!b) return null;
  const sub = b.ranking
    ? countsLine(b.counts.votes, b.counts.voters)
    : `${plural(b.view.items.length, 'item')} · ${plural(b.counts.votes, 'vote')}`;
  return crowdSpec(b.view, b.ranking, sub, boardURL(b.alias), texts(), crowdMeta);
}

/** The duel on screen. */
export function duelCardSpec(): CardSpec | null {
  const b = boardShareData();
  if (!b?.pair) return null;
  const [A, B] = b.pair;
  return duelSpec(b.view.title, A, B, `${boardURL(b.alias)}${duelQuery(A.id, B.id)}`, texts());
}

/** The pictures the end-of-vote page can be shared as: the crowd's podium, the voter's, and the voter facing the crowd. */
export interface FinaleCards {
  crowd: CardSpec | null;
  mine: CardSpec;
  duo: CardSpec | null;
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
 * somewhere. Quiet: a failure changes nothing for the person sharing.
 */
export function uploadCard(spec: CardSpec, alias: string, pair: readonly [string, string] | null): void {
  const key = `${alias}${pair ? `/${pair[0]}.${pair[1]}` : ''}`;
  if (uploaded.has(key)) return;
  uploaded.add(key);
  void (async () => {
    try {
      const canvas = await renderCard(spec, OG_FORMAT, true);
      const blob = canvas ? await toBlob(canvas) : null;
      if (blob) await putCard(alias, blob, pair);
    } catch {
      uploaded.delete(key);
    }
  })();
}

/** Right after publishing: the board's card from the local ranking (the server has the same items and votes). */
export function uploadPublishedCard(r: Ranking, alias: string, withVotes: boolean): void {
  const spec = localSpec(r, '', boardURL(alias), texts(), scoreMeta);
  spec.kind = 'crowd';
  const votes = withVotes ? lastDuelPerPair(r).length : 0;
  if (!votes) {
    spec.ranked = false;
    spec.rows = r.items.map((it) => ({ it, meta: '' }));
  }
  spec.subtitle = `${plural(r.items.length, 'item')} · ${plural(votes, 'vote')}`;
  uploadCard(spec, alias, null);
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
    <div class="share-preview ${p.format}" id="share-preview" aria-label="${t('sharePreviewAlt')}" role="img"><span class="share-wait">…</span></div>
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
  const canvas = await canvasOf(p, p.format);
  if (panel !== p || run !== p.drawing || !box.isConnected) return;
  box.innerHTML = canvas ? '' : `<span class="share-wait">${esc(t('shareNoImage'))}</span>`;
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

/** The board page: the crowd's standings; its landscape card also becomes the link's preview. */
export function shareBoard(): void {
  const spec = boardCardSpec();
  const b = boardShareData();
  if (!spec || !b) return;
  uploadCard(spec, b.alias, null);
  openShare(spec, 'board');
}

/** The duel on screen: the link opens the board on it. */
export function shareDuel(): void {
  const spec = duelCardSpec();
  const b = boardShareData();
  if (!spec?.pair || !b) return;
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

const fileName = (p: Panel): string =>
  `versus-${p.spec.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)}-${p.format}.png`;

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
