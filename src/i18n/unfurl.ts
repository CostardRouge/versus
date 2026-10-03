import { fill, type Lang, pluralIsMany } from './text.ts';

/**
 * Texts of a board's link preview (title and description a social network shows when the link is pasted),
 * written by the Worker into the app page's head (worker/src/index.ts) in the board's language. Kept apart
 * from the app's dictionary so the Worker bundles these few lines only. Placeholders: {title}, {a}, {b} the
 * two items of a duel, {items}, {votes}, {voters} with their numbers already worded.
 */
export const unfurlEn = {
  boardTitle: '{title} · Versus',
  boardDesc:
    'Which one wins? Vote two at a time and watch the crowd’s ranking move live. {items} · {votes} · {voters}.',
  closedDesc: 'The vote is closed: here is the crowd’s final ranking. {items} · {votes} · {voters}.',
  duelTitle: '{a} vs {b} · {title}',
  duelDesc: '{a} or {b}? Cast your vote, then keep going: the crowd’s ranking builds two at a time.',
  imageAlt: 'The ranking “{title}” on Versus',
  duelImageAlt: '{a} against {b}, a duel of the ranking “{title}” on Versus',
  // The template pages (/t/<slug>/), rendered by the Worker in the legal page's shell.
  tplKicker: 'A ranking everyone votes on',
  tplVote: 'Vote now',
  tplMakeMine: 'Make my own version',
  tplCounts: '{items} · {votes} · {voters}',
  tplRankingTitle: 'The crowd’s ranking',
  tplRankingLive: 'Live: it moves as people vote. Your votes count as soon as you cast them.',
  tplRankingEmpty: 'Nobody has voted yet. Be the first: the ranking appears with the first duels.',
  tplWinRate: 'wins',
  tplHowTitle: 'How this ranking is made',
  tplHow1:
    'Versus never asks you to rank the whole list. It shows two items at a time and you pick the one you prefer, as many times as you like. Every visitor gets the pairs the crowd has seen least, and one browser counts once per pair.',
  tplHow2:
    'The crowd’s ranking is computed with a Bradley-Terry model (the “Balanced” method): it estimates, for each item, the probability that a random voter prefers it, and absorbs the crowd’s contradictions. The share shown next to each item is how often it won its duels.',
  tplHow3:
    'Want the same duel with your own list? Open the ranking and make your own version: a ranking of yours, with these items, ready to change and publish.',
  tplMoreTitle: 'More rankings to vote on',
  tplAbout: 'Made with Versus, the free app that ranks anything two at a time.',
  item: ['item', 'items'],
  vote: ['vote', 'votes'],
  voter: ['voter', 'voters'],
};

export const unfurlFr: typeof unfurlEn = {
  boardTitle: '{title} · Versus',
  boardDesc:
    'Lequel gagne ? Vote deux par deux et regarde le classement de la foule bouger en direct. {items} · {votes} · {voters}.',
  closedDesc: 'Le vote est clos : voici le classement final de la foule. {items} · {votes} · {voters}.',
  duelTitle: '{a} vs {b} · {title}',
  duelDesc: '{a} ou {b} ? Vote, puis continue : le classement de la foule se construit deux par deux.',
  imageAlt: 'Le classement « {title} » sur Versus',
  duelImageAlt: '{a} contre {b}, un duel du classement « {title} » sur Versus',
  tplKicker: 'Un classement où tout le monde vote',
  tplVote: 'Voter maintenant',
  tplMakeMine: 'Faire ma version',
  tplCounts: '{items} · {votes} · {voters}',
  tplRankingTitle: 'Le classement de la foule',
  tplRankingLive: 'En direct : il bouge au fil des votes. Les tiens comptent dès que tu les donnes.',
  tplRankingEmpty: 'Personne n’a encore voté. Sois le premier : le classement apparaît avec les premiers duels.',
  tplWinRate: 'de victoires',
  tplHowTitle: 'Comment ce classement est fait',
  tplHow1:
    'Versus ne te demande jamais de classer toute la liste. Il montre deux éléments à la fois et tu choisis celui que tu préfères, autant de fois que tu veux. Chaque visiteur reçoit les paires que la foule a le moins vues, et un navigateur compte une fois par paire.',
  tplHow2:
    'Le classement de la foule est calculé avec un modèle de Bradley-Terry (la méthode « Équilibré ») : il estime, pour chaque élément, la probabilité qu’un votant pris au hasard le préfère, et absorbe les contradictions de la foule. La part affichée à côté de chaque élément est la fréquence à laquelle il a gagné ses duels.',
  tplHow3:
    'Envie du même duel avec ta propre liste ? Ouvre le classement et fais ta version : un classement à toi, avec ces éléments, prêt à modifier et à publier.',
  tplMoreTitle: 'D’autres classements où voter',
  tplAbout: 'Fait avec Versus, l’app gratuite qui classe n’importe quoi deux par deux.',
  item: ['élément', 'éléments'],
  vote: ['vote', 'votes'],
  voter: ['votant', 'votants'],
};

export type UnfurlLang = Lang;
export const UNFURL: Record<UnfurlLang, typeof unfurlEn> = { en: unfurlEn, fr: unfurlFr };

/** "3 votes", "1 vote"; French treats 0 and 1 as singular. */
export const unfurlPlural = (lang: UnfurlLang, n: number, key: 'item' | 'vote' | 'voter'): string => {
  const [one, many] = UNFURL[lang][key];
  return `${n} ${pluralIsMany(n, lang) ? many : one}`;
};

export type UnfurlKey = Exclude<keyof typeof unfurlEn, 'item' | 'vote' | 'voter'>;

/** A text with its placeholders filled. */
export const unfurlText = (lang: UnfurlLang, key: UnfurlKey, vars: Record<string, string> = {}): string =>
  fill(UNFURL[lang][key], vars);
