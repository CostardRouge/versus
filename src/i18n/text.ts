/**
 * What every dictionary does with its texts (the app's, the home page's, the legal notice's, the moderation page's,
 * the Worker's): no texts here, so the Worker and the build import it without a dictionary.
 */

/** The languages the site speaks. */
export type Lang = 'en' | 'fr';

/** A text's `{name}` placeholders filled from `vars`; a missing one comes out empty. */
export const fill = (text: string, vars: Readonly<Record<string, string | number>> = {}): string =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** Whether `n` takes the plural form: French treats 0 and 1 as singular. */
export const pluralIsMany = (n: number, lang: Lang): boolean => (lang === 'fr' ? n > 1 : n !== 1);

/** A percentage as each language writes it: French puts a narrow no-break space before the sign. */
export const pctText = (v: number, lang: Lang): string => (lang === 'fr' ? `${v}\u202F%` : `${v}%`);

/** The locale numbers and dates are written in. */
export const intlLocale = (lang: Lang): string => (lang === 'fr' ? 'fr-FR' : 'en-GB');
