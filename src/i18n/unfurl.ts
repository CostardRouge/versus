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
  item: ['élément', 'éléments'],
  vote: ['vote', 'votes'],
  voter: ['votant', 'votants'],
};

export type UnfurlLang = 'en' | 'fr';
export const UNFURL: Record<UnfurlLang, typeof unfurlEn> = { en: unfurlEn, fr: unfurlFr };

/** "3 votes", "1 vote"; French treats 0 and 1 as singular. */
export const unfurlPlural = (lang: UnfurlLang, n: number, key: 'item' | 'vote' | 'voter'): string => {
  const [one, many] = UNFURL[lang][key];
  return `${n} ${lang === 'fr' ? (n > 1 ? many : one) : n === 1 ? one : many}`;
};

/** A text with its placeholders filled. */
export const unfurlText = (
  lang: UnfurlLang,
  key: 'boardTitle' | 'boardDesc' | 'closedDesc' | 'duelTitle' | 'duelDesc' | 'imageAlt' | 'duelImageAlt',
  vars: Record<string, string>,
): string => UNFURL[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
