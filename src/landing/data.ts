import { DEMOS } from '../core/demos.ts';
import type { Fill, Outcome } from '../core/types.ts';
import type { Lang } from '../i18n/index.ts';

/**
 * Fixed content of the home page: the items its demos play with, in both languages. Like the app's demos
 * (core/demos.ts), everything is seeded so every visitor, and the static HTML, see the same thing.
 */

export type Label = Record<Lang, string>;
/** Pastry drawings of the page's SVG sprite (src/landing/sprite.ts). */
export type Pic = 'croissant' | 'amandes' | 'pac' | 'kouign' | 'raisins' | 'chausson' | 'brioche';

export interface ShowItem {
  id: string;
  label: Label;
  /** Illustrated item: a drawing on a pastel backdrop (two stops of a radial gradient). */
  pic?: Pic;
  bg?: readonly [string, string];
  fill?: Fill;
  /** Hidden strength (Elo-like) deciding simulated duels. */
  s: number;
}

const l = (en: string, fr = en): Label => ({ en, fr });
const pastry = (id: string, label: Label, pic: Pic, bg: [string, string], s: number): ShowItem => ({
  id,
  label,
  pic,
  bg,
  s,
});
const word = (id: string, label: Label, s = 1500): ShowItem => ({ id, label, s });

export const PASTRIES: readonly ShowItem[] = [
  pastry('croissant', l('Croissant'), 'croissant', ['#DCE8F7', '#A9C4EA'], 1600),
  pastry('pac', l('Pain au chocolat'), 'pac', ['#FADBD2', '#EFA997'], 1630),
  // Same drawing as the pain au chocolat, on purpose.
  pastry('choc', l('Chocolatine'), 'pac', ['#D3EEDB', '#9CD4AE'], 1630),
  pastry('kouign', l('Kouign-amann'), 'kouign', ['#E3DCF7', '#B7A7E8'], 1700),
  pastry('amandes', l('Almond croissant', 'Croissant aux amandes'), 'amandes', ['#F8DCE6', '#E9A6BF'], 1660),
  pastry('raisins', l('Pain aux raisins'), 'raisins', ['#D2EEEA', '#93D0C8'], 1480),
  pastry('chausson', l('Apple turnover', 'Chausson aux pommes'), 'chausson', ['#E8EFD0', '#C3D48F'], 1520),
  pastry('brioche', l('Brioche'), 'brioche', ['#F1E0D2', '#DDB99B'], 1440),
];

const CHEESES: readonly ShowItem[] = [
  word('comte', l('Comté')),
  word('roquefort', l('Roquefort')),
  word('epoisses', l('Époisses')),
  word('montdor', l('Mont d’Or')),
  word('brie', l('Brie de Meaux')),
  word('crottin', l('Crottin de Chavignol')),
];

const NAMES: readonly ShowItem[] = ['Alma', 'Louise', 'Gabriel', 'Noé', 'Jade', 'Aurèle'].map((n) =>
  word(`name-${n.toLowerCase()}`, l(n)),
);

/** The app's own demos (core/demos.ts), as show items with ids of their own. */
function fromDemo(id: string, prefix: string): { title: Label; items: ShowItem[] } {
  const d = DEMOS.find((x) => x.id === id);
  if (!d) throw new Error(`missing demo ${id}`);
  return {
    title: d.title,
    items: d.items.map((it, i) => ({
      id: `${prefix}-${i}`,
      label: it.label,
      ...(it.fill ? { fill: it.fill } : {}),
      s: d.strengths?.[i] ?? 1500,
    })),
  };
}
const DESTINATIONS = fromDemo('demo-destinations', 'dest');
const BACKGROUNDS = fromDemo('demo-backgrounds', 'bg');
const ACCENTS = fromDemo('demo-accent', 'acc');

const byId = (ids: readonly string[]): ShowItem[] =>
  ids.map((id) => {
    const it = PASTRIES.find((p) => p.id === id);
    if (!it) throw new Error(`missing pastry ${id}`);
    return it;
  });

export const PASTRY_TITLE = l('Best pastry', 'Meilleure viennoiserie');

/** The hero's scripted demo: six pastries, three duels already played, then the pair it opens on. */
export const HERO = {
  items: byId(['croissant', 'pac', 'choc', 'kouign', 'amandes', 'raisins']),
  seed: [
    ['kouign', 'raisins', 1],
    ['amandes', 'croissant', 1],
    ['pac', 'raisins', 1],
  ] as const satisfies ReadonlyArray<readonly [string, string, Outcome]>,
  first: ['croissant', 'kouign'] as [string, string],
  /** Seed of the simulated duels after the scripted ones. */
  rng: 7,
};

export interface Topic {
  id: string;
  tab: Label;
  title: Label;
  items: readonly ShowItem[];
  /** Item shown in the topic's tab. */
  thumb: string;
}

/** The "try it here" topics; six items each, so a stable ranking takes 19 duels. */
export const TOPICS: readonly Topic[] = [
  {
    id: 'pastries',
    tab: l('Pastries', 'Viennoiseries'),
    title: PASTRY_TITLE,
    items: HERO.items,
    thumb: 'kouign',
  },
  {
    id: 'cheeses',
    tab: l('Cheeses', 'Fromages'),
    title: l('The king of cheeses', 'Le roi des fromages'),
    items: CHEESES,
    thumb: 'comte',
  },
  {
    id: 'destinations',
    tab: l('Destinations'),
    title: DESTINATIONS.title,
    items: DESTINATIONS.items.slice(0, 6),
    thumb: 'dest-0',
  },
  {
    id: 'backgrounds',
    tab: l('Backgrounds', 'Fonds d’écran'),
    title: BACKGROUNDS.title,
    items: BACKGROUNDS.items,
    thumb: 'bg-1',
  },
  { id: 'colors', tab: l('Colors', 'Couleurs'), title: ACCENTS.title, items: ACCENTS.items, thumb: 'acc-0' },
  {
    id: 'names',
    tab: l('First names', 'Prénoms'),
    title: l('Baby name', 'Prénom du bébé'),
    items: NAMES,
    thumb: 'name-alma',
  },
];

/** Every item the page can show, by id. */
export const ITEMS: ReadonlyMap<string, ShowItem> = new Map(
  [...PASTRIES, ...CHEESES, ...NAMES, ...DESTINATIONS.items, ...BACKGROUNDS.items, ...ACCENTS.items].map((it) => [
    it.id,
    it,
  ]),
);

export function item(id: string): ShowItem {
  const it = ITEMS.get(id);
  if (!it) throw new Error(`unknown item ${id}`);
  return it;
}

/** The scoring methods section: the eight pastries after 30 simulated duels. */
export const METHODS_DEMO = { items: PASTRIES, duels: 30, seed: 11 };

/** The published board example: votes simulated from the pastries' strengths. */
export const CROWD = {
  items: byId(['kouign', 'pac', 'choc', 'croissant', 'amandes', 'chausson']),
  seed: 99,
  votes: 230,
  voters: 48,
  agree: [11, 14] as const,
};

/** Use cases scrolling under the hero: a question and one of its duels. */
export interface UseCase {
  title: Label;
  a: Label;
  b: Label;
  /** Real colors for a color question; otherwise dots tinted from the labels. */
  colors?: readonly [string, string];
}
const uc = (title: Label, a: Label, b: Label, colors?: readonly [string, string]): UseCase =>
  colors ? { title, a, b, colors } : { title, a, b };

export const CASES: readonly UseCase[] = [
  uc(l('The baby’s name', 'Le prénom du bébé'), l('Alma'), l('Louise')),
  uc(l('Friday night pizza', 'La pizza du vendredi'), l('Margherita', 'Reine'), l('Four cheese', '4 fromages')),
  uc(l('The club’s logo', 'Le logo de l’asso'), l('Version 2'), l('Version 3')),
  uc(l('Summer trip', 'La destination de l’été'), l('Lisbon', 'Lisbonne'), l('Kyoto')),
  uc(l('Profile picture', 'La photo de profil'), l('Beach', 'Plage'), l('Mountain', 'Montagne')),
  uc(l('Tonight’s movie', 'Le film de ce soir'), l('Thriller', 'Polar'), l('Comedy', 'Comédie')),
  uc(l('Living room color', 'La couleur du salon'), l('Sage', 'Sauge'), l('Terracotta'), ['#9CAF88', '#C8553D']),
  uc(l('Quarter priorities', 'Les priorités du trimestre'), l('Redesign', 'Refonte'), l('Hiring', 'Recrutement')),
  uc(l('The cat’s name', 'Le nom du chat'), l('Whiskers', 'Moustache'), l('Pixel')),
  uc(l('Website font', 'La police du site'), l('Serif'), l('Sans serif')),
  uc(l('Wedding dessert', 'Le dessert du mariage'), l('Fraisier'), l('Croquembouche', 'Pièce montée')),
  uc(l('Next read', 'La prochaine lecture'), l('Novel', 'Roman'), l('Comic book', 'BD')),
  uc(l('Cheese board', 'Le fromage du plateau'), l('Comté'), l('Époisses')),
  uc(l('Game night', 'Le jeu de la soirée'), l('Trivia', 'Quiz'), l('Werewolf', 'Loup-garou')),
];

/** "Choose" vignette: pairs and the key that decides each. */
export const PICKS: ReadonlyArray<readonly [string, string, 'a' | 'b' | 'draw']> = [
  ['comte', 'roquefort', 'a'],
  ['bg-1', 'bg-2', 'b'],
  ['choc', 'pac', 'draw'],
  ['dest-1', 'dest-0', 'b'],
];

/** "Discover" vignette: the order settling as stability grows (bar widths are illustrative). */
export const SETTLING = [
  { order: ['brioche', 'croissant', 'kouign', 'pac'], w: [52, 50, 49, 47], s: 8 },
  { order: ['croissant', 'kouign', 'brioche', 'pac'], w: [64, 58, 46, 40], s: 36 },
  { order: ['kouign', 'croissant', 'pac', 'brioche'], w: [74, 62, 52, 30], s: 71 },
  { order: ['kouign', 'pac', 'croissant', 'brioche'], w: [84, 66, 57, 26], s: 100 },
] as const;
