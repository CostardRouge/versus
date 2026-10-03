import type { Lang } from '../i18n/index.ts';
import { mkRank } from './model.ts';
import { methodOf, nextPair, pushDuel } from './scoring.ts';
import type { Fill, MethodKey, Ranking, Rng } from './types.ts';
import { hueOf, mulberry32 } from './util.ts';

type Label = Record<Lang, string>;
interface DemoItem {
  label: Label;
  fill?: Fill;
}
export interface Demo {
  id: string;
  title: Label;
  method: MethodKey;
  seed: number;
  /** Duels simulated from hidden strengths with a seeded PRNG: identical for everyone. */
  duels: number;
  strengths?: number[];
  items: DemoItem[];
}

const lbl = (en: string, fr = en): Label => ({ en, fr });
const grad = (...colors: string[]): Fill => ({ type: 'gradient', colors });
const solid = (c: string): Fill => ({ type: 'solid', colors: [c] });

export const DEMOS: readonly Demo[] = [
  {
    id: 'demo-destinations',
    title: lbl('Next destination', 'Prochaine destination'),
    method: 'bt',
    seed: 11,
    duels: 24,
    strengths: [1650, 1560, 1470, 1600, 1720, 1440, 1560, 1500],
    items: [
      lbl('Kyoto'),
      lbl('Lisbon', 'Lisbonne'),
      lbl('Reykjavik'),
      lbl('Oaxaca'),
      lbl('Hokkaido in winter', 'Hokkaido en hiver'),
      lbl('Tasmania', 'Tasmanie'),
      lbl('Patagonia', 'Patagonie'),
      lbl('Seville', 'Séville'),
    ].map((label) => ({ label })),
  },
  {
    id: 'demo-backgrounds',
    title: lbl('Website background', 'Fond du site perso'),
    method: 'elo',
    seed: 23,
    duels: 9,
    strengths: [1560, 1620, 1480, 1500, 1540, 1460],
    items: [
      { label: lbl('Northern dawn', 'Aube boréale'), fill: grad('#0B1D3A', '#1F7A8C', '#9FE2BF') },
      { label: lbl('Lagoon', 'Lagune'), fill: grad('#03256C', '#2541B2', '#06BEE1') },
      { label: lbl('Terracotta', 'Terre cuite'), fill: grad('#3D1308', '#C8553D', '#F28F3B') },
      { label: lbl('Night neon', 'Néon nocturne'), fill: grad('#120078', '#9D0191', '#FD3A69') },
      { label: lbl('Undergrowth', 'Sous-bois'), fill: grad('#1B2F1E', '#4F772D', '#C9D6A3') },
      { label: lbl('Mist', 'Brume'), fill: grad('#2E3440', '#8FA3B8', '#E5E9F0') },
    ],
  },
  {
    id: 'demo-accent',
    title: lbl('Accent color', 'Couleur d’accent'),
    method: 'sort',
    seed: 5,
    duels: 0,
    items: [
      { label: lbl('Cobalt'), fill: solid('#2743F5') },
      { label: lbl('Coral', 'Corail'), fill: solid('#E4492A') },
      { label: lbl('Emerald', 'Émeraude'), fill: solid('#12966B') },
      { label: lbl('Saffron', 'Safran'), fill: solid('#F2A516') },
      { label: lbl('Plum', 'Prune'), fill: solid('#7A2E6E') },
      { label: lbl('Slate', 'Ardoise'), fill: solid('#3E4C5E') },
    ],
  },
];

/** Plays `n` duels where hidden strengths decide the winner (with some upsets and ties). */
export function simulate(r: Ranking, strengths: number[], n: number, rng: Rng = Math.random): void {
  for (let k = 0; k < n; k++) {
    const p = nextPair(r, null, undefined, rng);
    if (!p) break;
    const ia = r.items.findIndex((i) => i.id === p[0]);
    const ib = r.items.findIndex((i) => i.id === p[1]);
    const pa = 1 / (1 + 10 ** (((strengths[ib] ?? 1500) - (strengths[ia] ?? 1500)) / 220));
    const x = rng();
    pushDuel(r, p[0], p[1], x < 0.06 && methodOf(r) !== 'sort' ? 0.5 : x < pa ? 1 : 0);
  }
  r.pair = null;
}

export function buildDemo(d: Demo, lang: Lang): Ranking {
  const r = mkRank(d.title[lang], d.method);
  r.id = d.id;
  r.demo = true;
  r.items = d.items.map((it, i) => ({
    id: `${d.id}-${i}`,
    label: it.label[lang],
    img: null,
    fill: it.fill ? { type: it.fill.type, colors: [...it.fill.colors] } : null,
    h: hueOf(it.label.en),
  }));
  if (d.duels) simulate(r, d.strengths ?? [], d.duels, mulberry32(d.seed));
  r.created = 0;
  r.updated = 0;
  return r;
}

/** Translates demo titles and labels the user has not renamed. */
export function relabelDemos(ranks: Ranking[], from: Lang, to: Lang): boolean {
  let changed = false;
  for (const d of DEMOS) {
    const r = ranks.find((x) => x.id === d.id);
    if (!r) continue;
    if (r.title === d.title[from] && d.title[from] !== d.title[to]) {
      r.title = d.title[to];
      changed = true;
    }
    for (const it of r.items) {
      if (!it.id.startsWith(`${d.id}-`)) continue;
      const src = d.items[Number(it.id.slice(d.id.length + 1))];
      if (src && it.label === src.label[from] && src.label[from] !== src.label[to]) {
        it.label = src.label[to];
        changed = true;
      }
    }
  }
  return changed;
}
