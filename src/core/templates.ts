import { DEFAULT_SETTINGS, type PublishInput } from './board.ts';
import type { BoardLang, Fill, Item } from './types.ts';
import { hueOf } from './util.ts';

/**
 * Official templates: the site's own published boards, one per template and language, that anyone can vote on
 * and start their own ranking from (docs/published-boards.md#official-templates). Fixed data, like the demos;
 * the Worker publishes each board the first time its page or the Popular list asks for it, and it never
 * expires. Each has a page of its own, `/t/<slug>/` in English and `/fr/t/<slug>/` in French, that search
 * engines can index once enough people voted.
 */

type Text = Record<BoardLang, string>;

export interface Template {
  /** Language-neutral key, stored with the board (`SharedBoard.template`): the English slug. */
  key: string;
  /** The page's slug in each language. */
  slug: Text;
  title: Text;
  /** One or two sentences under the title: the page's description too. */
  intro: Text;
  items: { label: Text; fill?: Fill }[];
}

const tx = (en: string, fr = en): Text => ({ en, fr });
const solid = (c: string): Fill => ({ type: 'solid', colors: [c] });
const plain = (...labels: [string, string?][]): Template['items'] =>
  labels.map(([en, fr]) => ({ label: tx(en, fr ?? en) }));

/** How many voters a template page needs before search engines are asked to index it (a page with a real crowd). */
export const TEMPLATE_INDEX_VOTERS = 30;

/** The voter id the site publishes its templates under. */
export const OFFICIAL_VOTER = 'versus-official';

export const TEMPLATES: readonly Template[] = [
  {
    key: 'game-consoles',
    slug: tx('game-consoles', 'consoles-de-jeu'),
    title: tx('The best game console of all time', 'La meilleure console de jeu de tous les temps'),
    intro: tx(
      'From the NES to the Switch: which console left the biggest mark? Vote two at a time and see what the crowd thinks.',
      'De la NES à la Switch : quelle console a le plus marqué ? Vote deux par deux et découvre l’avis de la foule.',
    ),
    items: plain(
      ['NES'],
      ['Super Nintendo'],
      ['Mega Drive'],
      ['PlayStation'],
      ['Nintendo 64'],
      ['Dreamcast'],
      ['PlayStation 2'],
      ['GameCube'],
      ['Xbox 360'],
      ['Wii'],
      ['PlayStation 4'],
      ['Nintendo Switch'],
    ),
  },
  {
    key: 'video-games',
    slug: tx('video-games', 'jeux-video'),
    title: tx('The best video game of all time', 'Le meilleur jeu vidéo de tous les temps'),
    intro: tx(
      'Twelve landmark games, one crowd ranking. Which one would you take to a desert island?',
      'Douze jeux marquants, un classement de la foule. Lequel emporterais-tu sur une île déserte ?',
    ),
    items: plain(
      ['Tetris'],
      ['Super Mario 64'],
      ['Zelda: Ocarina of Time'],
      ['Half-Life 2'],
      ['Minecraft'],
      ['The Witcher 3'],
      ['Zelda: Breath of the Wild'],
      ['Elden Ring'],
      ['Portal 2'],
      ['Red Dead Redemption 2'],
      ['Hollow Knight'],
      ['Stardew Valley'],
    ),
  },
  {
    key: 'programming-languages',
    slug: tx('programming-languages', 'langages-de-programmation'),
    title: tx('The best programming language', 'Le meilleur langage de programmation'),
    intro: tx(
      'Python or Rust? TypeScript or Go? Settle the eternal debate one duel at a time, with everyone else.',
      'Python ou Rust ? TypeScript ou Go ? Tranche l’éternel débat un duel à la fois, avec tout le monde.',
    ),
    items: plain(
      ['Python'],
      ['JavaScript'],
      ['TypeScript'],
      ['Rust'],
      ['Go'],
      ['Java'],
      ['C'],
      ['C++'],
      ['C#'],
      ['Ruby'],
      ['Swift'],
      ['Kotlin'],
    ),
  },
  {
    key: 'phone-brands',
    slug: tx('phone-brands', 'marques-de-smartphones'),
    title: tx('iPhone or Android: the best phone brand', 'iPhone ou Android : la meilleure marque de smartphone'),
    intro: tx(
      'Apple, Samsung, Pixel, Xiaomi and the others, face to face. Which phone would you buy tomorrow?',
      'Apple, Samsung, Pixel, Xiaomi et les autres, face à face. Quel téléphone achèterais-tu demain ?',
    ),
    items: plain(
      ['Apple iPhone'],
      ['Samsung Galaxy'],
      ['Google Pixel'],
      ['Xiaomi'],
      ['OnePlus'],
      ['Sony Xperia'],
      ['Nothing Phone'],
      ['Huawei'],
      ['Motorola'],
      ['Fairphone'],
    ),
  },
  {
    key: 'computers',
    slug: tx('computers', 'ordinateurs'),
    title: tx('Mac or PC: the best computer to work on', 'Mac ou PC : le meilleur ordinateur pour travailler'),
    intro: tx(
      'Laptops and desktops, Apple and the rest. Which machine would you want on your desk every day?',
      'Portables et fixes, Apple et les autres. Quelle machine voudrais-tu sur ton bureau tous les jours ?',
    ),
    items: plain(
      ['MacBook Air'],
      ['MacBook Pro'],
      ['iMac'],
      ['Mac mini'],
      ['Mac Studio'],
      ['ThinkPad X1'],
      ['Dell XPS'],
      ['Surface Laptop'],
      ['Framework Laptop'],
      ['Gaming tower PC', 'Tour PC gaming'],
      ['Chromebook'],
    ),
  },
  {
    key: 'cameras',
    slug: tx('cameras', 'appareils-photo'),
    title: tx('The best camera right now', 'Le meilleur appareil photo du moment'),
    intro: tx(
      'Compacts, full-frame bodies and the phones that replaced them: which camera would you carry everywhere?',
      'Compacts, plein format et les téléphones qui les remplacent : quel appareil emporterais-tu partout ?',
    ),
    items: plain(
      ['Fujifilm X100VI'],
      ['Sony A7 IV'],
      ['Canon EOS R6 Mark II'],
      ['Nikon Z6 III'],
      ['Leica Q3'],
      ['Ricoh GR III'],
      ['Panasonic Lumix S5 II'],
      ['OM System OM-1'],
      ['iPhone 16 Pro'],
      ['Google Pixel 9 Pro'],
    ),
  },
  {
    key: 'star-wars',
    slug: tx('star-wars-films', 'films-star-wars'),
    title: tx('Every Star Wars film, ranked by the crowd', 'Tous les films Star Wars, classés par la foule'),
    intro: tx(
      'Eleven films, three trilogies and two spin-offs. Vote pair by pair and find out where the crowd puts them.',
      'Onze films, trois trilogies et deux spin-offs. Vote paire par paire et découvre où la foule les place.',
    ),
    items: plain(
      ['A New Hope', 'Un nouvel espoir'],
      ['The Empire Strikes Back', 'L’Empire contre-attaque'],
      ['Return of the Jedi', 'Le Retour du Jedi'],
      ['The Phantom Menace', 'La Menace fantôme'],
      ['Attack of the Clones', 'L’Attaque des clones'],
      ['Revenge of the Sith', 'La Revanche des Sith'],
      ['The Force Awakens', 'Le Réveil de la Force'],
      ['The Last Jedi', 'Les Derniers Jedi'],
      ['The Rise of Skywalker', 'L’Ascension de Skywalker'],
      ['Rogue One'],
      ['Solo'],
    ),
  },
  {
    key: 'french-pastries',
    slug: tx('french-pastries', 'patisseries-francaises'),
    title: tx('The best French pastry', 'La meilleure pâtisserie française'),
    intro: tx(
      'Croissant, kouign-amann, Paris-Brest: the bakery counter as a duel. A national debate, settled two at a time.',
      'Croissant, kouign-amann, Paris-Brest : la vitrine de la boulangerie en duel. Un débat national, tranché deux par deux.',
    ),
    items: plain(
      ['Croissant'],
      ['Chocolatine (pain au chocolat)'],
      ['Kouign-amann'],
      ['Paris-Brest'],
      ['Coffee éclair', 'Éclair au café'],
      ['Mille-feuille'],
      ['Lemon meringue tart', 'Tarte au citron meringuée'],
      ['Flan pâtissier'],
      ['Chausson aux pommes'],
      ['Cannelé'],
      ['Macaron'],
      ['Religieuse'],
    ),
  },
  {
    key: 'pizzas',
    slug: tx('pizzas', 'pizzas'),
    title: tx('The best pizza', 'La meilleure pizza'),
    intro: tx(
      'Margherita or diavola? Pineapple or never? Ten classics of the pizzeria, ranked by everyone who votes.',
      'Margherita ou diavola ? Ananas ou jamais ? Dix classiques de la pizzeria, classés par tous ceux qui votent.',
    ),
    items: plain(
      ['Margherita'],
      ['Pepperoni'],
      ['Quattro formaggi'],
      ['Hawaiian', 'Hawaïenne'],
      ['Prosciutto e funghi'],
      ['Marinara'],
      ['Calzone'],
      ['Diavola'],
      ['Quattro stagioni'],
      ['Truffle', 'Truffe'],
    ),
  },
  {
    key: 'streaming',
    slug: tx('streaming-services', 'plateformes-de-streaming'),
    title: tx('The best streaming service', 'La meilleure plateforme de streaming'),
    intro: tx(
      'Netflix, Disney+, Prime Video and the others: if you could keep only one subscription, which one?',
      'Netflix, Disney+, Prime Video et les autres : si tu ne pouvais garder qu’un abonnement, lequel ?',
    ),
    items: plain(
      ['Netflix'],
      ['Disney+'],
      ['Prime Video'],
      ['Apple TV+'],
      ['Max'],
      ['Canal+'],
      ['Paramount+'],
      ['Crunchyroll'],
      ['YouTube Premium'],
    ),
  },
  {
    key: 'social-networks',
    slug: tx('social-networks', 'reseaux-sociaux'),
    title: tx('The best social network', 'Le meilleur réseau social'),
    intro: tx(
      'The one you would keep if you had to delete all the others. Twelve networks, one crowd ranking.',
      'Celui que tu garderais s’il fallait supprimer tous les autres. Douze réseaux, un classement de la foule.',
    ),
    items: plain(
      ['Instagram'],
      ['TikTok'],
      ['YouTube'],
      ['X'],
      ['Reddit'],
      ['LinkedIn'],
      ['Snapchat'],
      ['Bluesky'],
      ['Threads'],
      ['Mastodon'],
      ['Pinterest'],
      ['Discord'],
    ),
  },
  {
    key: 'superheroes',
    slug: tx('superheroes', 'super-heros'),
    title: tx('The best superhero', 'Le meilleur super-héros'),
    intro: tx(
      'Marvel and DC in the same arena. Batman or Spider-Man? Wonder Woman or Wolverine? The crowd decides.',
      'Marvel et DC dans la même arène. Batman ou Spider-Man ? Wonder Woman ou Wolverine ? La foule décide.',
    ),
    items: plain(
      ['Batman'],
      ['Superman'],
      ['Spider-Man'],
      ['Iron Man'],
      ['Wonder Woman'],
      ['Wolverine'],
      ['Black Panther'],
      ['Captain America'],
      ['Thor'],
      ['Hulk'],
      ['Deadpool'],
      ['Doctor Strange'],
    ),
  },
  {
    key: 'colors',
    slug: tx('colors', 'couleurs'),
    title: tx('The best color', 'La meilleure couleur'),
    intro: tx(
      'Ten colors, no names to lean on: just pick the one you like more, again and again, and watch a palette emerge.',
      'Dix couleurs, sans nom pour se raccrocher : choisis celle que tu préfères, encore et encore, et regarde une palette émerger.',
    ),
    items: [
      { label: tx('Cobalt'), fill: solid('#2743F5') },
      { label: tx('Coral', 'Corail'), fill: solid('#E4492A') },
      { label: tx('Emerald', 'Émeraude'), fill: solid('#12966B') },
      { label: tx('Saffron', 'Safran'), fill: solid('#F2A516') },
      { label: tx('Plum', 'Prune'), fill: solid('#7A2E6E') },
      { label: tx('Slate', 'Ardoise'), fill: solid('#3E4C5E') },
      { label: tx('Teal', 'Bleu canard'), fill: solid('#1F7A8C') },
      { label: tx('Rose'), fill: solid('#E85D9A') },
      { label: tx('Amber', 'Ambre'), fill: solid('#D97706') },
      { label: tx('Indigo'), fill: solid('#4338CA') },
    ],
  },
];

export const TEMPLATE_LANGS: readonly BoardLang[] = ['en', 'fr'];

/** The template a page's slug names, in that language. */
export const templateBySlug = (lang: BoardLang, slug: string): Template | undefined =>
  TEMPLATES.find((t) => t.slug[lang] === slug);

export const templateByKey = (key: string): Template | undefined => TEMPLATES.find((t) => t.key === key);

/** A template page's path, relative to the site's root: `t/<slug>/`, `fr/t/<slug>/`. */
export const templatePath = (t: Template, lang: BoardLang): string => `${lang === 'fr' ? 'fr/' : ''}t/${t.slug[lang]}/`;

/** The template's items in one language, with stable ids (`t0`, `t1`…). */
export const templateItems = (t: Template, lang: BoardLang): Item[] =>
  t.items.map((it, i) => ({
    id: `t${i}`,
    label: it.label[lang],
    img: null,
    fill: it.fill ?? null,
    h: hueOf(it.label[lang]),
  }));

/** What the Worker publishes for a template in one language: Balanced, results always visible, no votes. */
export const templateInput = (t: Template, lang: BoardLang): PublishInput => ({
  title: t.title[lang],
  items: templateItems(t, lang),
  settings: { ...DEFAULT_SETTINGS },
  voter: OFFICIAL_VOTER,
  duels: [],
  lang,
});
