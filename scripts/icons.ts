/**
 * Draws every icon and the social card into public/ from build/site.ts: `npm run icons`, then commit the
 * files. Run it again after changing the mark, the colors or the card, and rename the files (ICONS and
 * OG_IMAGE in build/site.ts) when the drawing changes: search engines and unfurlers cache images by URL.
 *
 * Text goes through satori, which takes the font as bytes and outputs glyphs as paths: the result is the same
 * on any machine, where a renderer that looks fonts up by name draws blank text wherever they are missing.
 * resvg then rasterizes the SVG.
 */

import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { COLORS, ICONS, NAME, OG_IMAGE, pngIcon } from '../build/site.ts';
import { hueOf } from '../src/core/util.ts';
import { en } from '../src/i18n/en.ts';

const require = createRequire(import.meta.url);
const out = new URL('../public/', import.meta.url);

const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
const FONTS = [
  {
    name: 'Bricolage',
    data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-700-normal.woff'),
    weight: 700 as const,
  },
  {
    name: 'Bricolage',
    data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'),
    weight: 800 as const,
  },
  { name: 'Figtree', data: font('@fontsource/figtree', 'figtree-latin-500-normal.woff'), weight: 500 as const },
  { name: 'Figtree', data: font('@fontsource/figtree', 'figtree-latin-700-normal.woff'), weight: 700 as const },
].map((f) => ({ ...f, style: 'normal' as const }));

type Node = { type: string; props: Record<string, unknown> };
type Style = Record<string, string | number>;

/** Element helper. Falsy children are dropped and a single child passed bare: satori reads any array as several. */
const h = (type: string, style: Style = {}, ...children: unknown[]): Node => {
  const kept = children.flat().filter((c) => c !== false && c != null && c !== '');
  return { type, props: { style: { display: 'flex', ...style }, children: kept.length === 1 ? kept[0] : kept } };
};

const render = (node: Node, width: number, height: number) =>
  satori(node as unknown as Parameters<typeof satori>[0], { width, height, fonts: FONTS });

const png = (svg: string, width: number): Buffer =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());

const write = (name: string, data: string | Buffer): void => {
  writeFileSync(new URL(name, out), data);
  console.log(`${name.padEnd(24)} ${data.length} B`);
};

/** "vs" as white glyph paths, centered on a size×size canvas (nudged up: lowercase sits low in the em box). */
async function vsGlyphs(size: number, fontSize: number): Promise<string> {
  const svg = await render(
    h(
      'div',
      { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
      h(
        'div',
        {
          marginTop: -fontSize * 0.12,
          color: COLORS.onAccent,
          fontFamily: 'Bricolage',
          fontWeight: 800,
          fontSize,
          letterSpacing: fontSize * 0.02,
          lineHeight: 1,
        },
        'vs',
      ),
    ),
    size,
    size,
  );
  return svg.match(/<path[^>]*\/>/g)?.join('') ?? '';
}

/** The mark: a disc split cobalt | coral with "vs" (same as the header's .brand-mark and the old favicon). */
async function mark(): Promise<string> {
  const glyphs = await vsGlyphs(64, 27);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${NAME}</title><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath><g clip-path="url(#c)"><rect width="32" height="64" fill="${COLORS.a}"/><rect x="32" width="32" height="64" fill="${COLORS.b}"/></g>${glyphs}</svg>`;
}

/**
 * Full-bleed variant for launchers that cut their own shape: iOS rounds the corners (and paints a transparent
 * icon black), Android masks a maskable icon to a circle or a squircle and keeps only the middle 80 %.
 */
async function tile(scale: number): Promise<string> {
  const glyphs = await vsGlyphs(64, 27 * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="32" height="64" fill="${COLORS.a}"/><rect x="32" width="32" height="64" fill="${COLORS.b}"/>${glyphs}</svg>`;
}

/** ICO container holding PNG images (Vista and later; every current browser). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/** Pastel card background of a text item, as .card in styles.css: 78 % surface, 22 % hsl(hue 72% 56%). */
function cardTint(label: string): string {
  const hue = hueOf(label);
  const k = (n: number) => (n + hue / 30) % 12;
  const a = 0.72 * Math.min(0.56, 1 - 0.56);
  const channel = (n: number) => 0.56 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const surface = [0xfa, 0xfb, 0xfd];
  const mixed = [0, 8, 4].map((n, i) => Math.round((surface[i] ?? 0) * 0.78 + channel(n) * 255 * 0.22));
  return `rgb(${mixed.join(',')})`;
}

/** One duel card as in the app: 4:5, side tag in the corner, the label in the display face. */
const duelCard = (label: string, side: 'A' | 'B', rotate: number): Node =>
  h(
    'div',
    {
      position: 'relative',
      width: 206,
      height: 258,
      borderRadius: 26,
      background: cardTint(label),
      border: `2px solid ${COLORS.line}`,
      alignItems: 'flex-end',
      padding: '22px 24px',
      transform: `rotate(${rotate}deg)`,
      boxShadow: '0 24px 48px rgba(19, 21, 27, 0.16)',
    },
    h(
      'div',
      {
        position: 'absolute',
        top: 16,
        left: 16,
        width: 38,
        height: 38,
        borderRadius: 19,
        background: side === 'A' ? COLORS.a : COLORS.b,
        color: COLORS.onAccent,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Bricolage',
        fontWeight: 800,
        fontSize: 17,
      },
      side,
    ),
    h('div', { color: COLORS.ink, fontFamily: 'Bricolage', fontWeight: 700, fontSize: 44, letterSpacing: -1.5 }, label),
  );

/** A right arrow drawn as a path: the latin subset of Figtree has no U+2192. */
const arrow = (color: string): Node => ({
  type: 'svg',
  props: {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    style: { marginLeft: 12 },
    children: {
      type: 'path',
      props: {
        d: 'M4 12h15M13 5l7 7-7 7',
        fill: 'none',
        stroke: color,
        'stroke-width': 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
    },
  },
});

/** 1200×630 social card: the brand, the promise, and a duel as the app shows it. */
async function socialCard(markSvg: string): Promise<string> {
  const markUri = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`;
  const [line1, line2] = en.tagline.split(', ');
  return render(
    h(
      'div',
      {
        width: OG_IMAGE.width,
        height: OG_IMAGE.height,
        background: COLORS.bg,
        padding: '64px 72px',
        fontFamily: 'Figtree',
      },
      h(
        'div',
        { flexDirection: 'column', justifyContent: 'space-between', width: 600 },
        h(
          'div',
          { alignItems: 'center' },
          { type: 'img', props: { src: markUri, width: 60, height: 60 } },
          h('div', { marginLeft: 16, fontFamily: 'Bricolage', fontWeight: 800, fontSize: 38, color: COLORS.ink }, NAME),
        ),
        h(
          'div',
          { flexDirection: 'column' },
          h(
            'div',
            {
              flexDirection: 'column',
              fontFamily: 'Bricolage',
              fontWeight: 800,
              fontSize: 84,
              lineHeight: 0.98,
              letterSpacing: -3,
              color: COLORS.ink,
            },
            h('div', {}, `${line1},`),
            h('div', {}, line2 ?? ''),
          ),
          h(
            'div',
            { marginTop: 26, fontSize: 30, fontWeight: 500, lineHeight: 1.35, color: COLORS.muted, width: 560 },
            'Text, images or colors. Pick a winner, duel after duel, and the ranking builds itself.',
          ),
        ),
        h(
          'div',
          { alignItems: 'center' },
          h(
            'div',
            {
              alignItems: 'center',
              background: COLORS.ink,
              color: COLORS.bg,
              borderRadius: 999,
              padding: '16px 28px',
              fontSize: 26,
              fontWeight: 700,
            },
            'Start ranking',
            arrow(COLORS.bg),
          ),
          h('div', { marginLeft: 24, fontSize: 24, fontWeight: 500, color: COLORS.muted }, 'Free · No account'),
        ),
      ),
      h(
        'div',
        { position: 'relative', flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
        h('div', { position: 'absolute', left: 4, top: 128 }, duelCard('Kyoto', 'A', -5)),
        h('div', { position: 'absolute', left: 246, top: 128 }, duelCard('Lisbon', 'B', 5)),
        h(
          'div',
          {
            position: 'absolute',
            left: 190,
            top: 219,
            width: 76,
            height: 76,
            borderRadius: 38,
            background: COLORS.ink,
            color: COLORS.bg,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Bricolage',
            fontWeight: 800,
            fontSize: 26,
            border: `5px solid ${COLORS.bg}`,
          },
          'vs',
        ),
      ),
    ),
    OG_IMAGE.width,
    OG_IMAGE.height,
  );
}

const markSvg = await mark();
write(ICONS.svg, markSvg);
for (const legacy of ICONS.legacy) write(legacy, markSvg);
for (const size of ICONS.png) write(pngIcon(size), png(markSvg, size));
write(ICONS.maskable, png(await tile(0.8), 512));
write(ICONS.apple, png(await tile(1), ICONS.appleSize));
write(ICONS.ico, ico(ICONS.icoSizes.map((size) => ({ size, data: png(markSvg, size) }))));
write(OG_IMAGE.path, png(await socialCard(markSvg), OG_IMAGE.width));
