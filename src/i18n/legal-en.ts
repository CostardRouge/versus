/**
 * Texts of the legal notice (src/legal/), rendered at build time in each language; the header and footer borrow
 * the home page's words (src/landing/strings.ts). Strings may hold trusted inline HTML (<b>, <i>, <code>, <a>).
 * Placeholders: {email} the contact address as a link, {days} the inactivity delay of published rankings,
 * {source} and {license} the repository and its licence.
 */
export const legalEn = {
  title: 'Legal notice and privacy',
  intro:
    'Who publishes Versus, who hosts it, and what it knows about you: very little. Your rankings never leave your browser unless you publish one.',
  updated: 'Last updated on 30 September 2026.',
  tocAria: 'On this page',

  pubTitle: 'Publisher',
  pub1: 'Versus is published by <b>Steeve Pommier</b>, a private individual, on a non-commercial basis: it is free, shows no ads and sells nothing.',
  pubContact: 'Contact: {email}',
  pub2: 'As a non-professional publisher, the personal details required by French law (Loi pour la confiance dans l’économie numérique, art. 6-III) are kept with the hosting provider named below.',

  hostTitle: 'Hosting',
  host1:
    '<b>versus.steevepommier.com</b> runs on Cloudflare Workers, which also store the published rankings: Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United States, <a href="https://www.cloudflare.com">cloudflare.com</a>.',
  host2:
    'A copy without publishing is served by GitHub Pages at <b>costardrouge.github.io/versus</b>: GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States, <a href="https://github.com">github.com</a>.',
  host3: 'Audience measurement runs on the publisher’s own server (see Privacy).',

  privTitle: 'Privacy',
  privShort: 'In short: Versus doesn’t know who you are and doesn’t try to. No account, no cookie, no advertising.',

  deviceTitle: 'On your device',
  device1:
    'Your rankings, their items (images included), your duels and your preferences (language, theme, display choices) are kept in your browser’s storage (local storage, and IndexedDB for images), on this device only. So are, if you use published rankings, an anonymous voter id (a random string), the keys of the rankings you published, the cards under “Your votes” and which rankings you asked to be notified about.',
  device2:
    'The installed app also keeps its own files in the browser’s cache to work offline: files, never your data, except for a moment what you share to it from another app, until it opens. None of this is sent anywhere, except what you publish, or a file you export yourself. To erase it, delete your rankings in the app, or clear this site’s data in your browser’s settings.',

  boardsTitle: 'Published rankings',
  boards1:
    'When you publish a ranking, its title, its items (text and colors) and its settings are sent to the server so that others can vote, along with a picture of it (its title and items, drawn by your browser) that shows when its link is pasted somewhere; sharing a duel draws one of that duel too. When the publisher allows it, your items’ images are sent as well, kept for the publisher’s review and shown to voters only once approved; a refused image is deleted. Each vote is stored with the anonymous voter id of the browser that cast it, the pair, the choice and the time: no name, no email, no IP address.',
  boards2:
    'A published ranking is deleted when its author withdraws it, or after {days} days without activity. Anyone with its link can see it and vote, so don’t publish anything personal. The author’s link carries a key after the <code>#</code>, which browsers never send to a server: keep it to yourself.',
  boards3:
    'Reporting a ranking sends the reason you pick, your note if any, and the same anonymous voter id, so that one browser counts once; the publisher reads reports to decide whether to take a ranking down, hide it from the site’s lists or leave it. Nothing else is stored about you.',
  boards4:
    'If you ask to be notified (when a vote closes, or as its author, when voters come in and pictures are reviewed), your browser gives the ranking an address at its push service (Google, Mozilla, Apple or Microsoft, depending on the browser) and two keys; the ranking keeps them, with the language to write in, until the vote closes, you turn notifications off, or the ranking is deleted. Each notification is encrypted for your browser: the push service carries it without being able to read it.',

  countTitle: 'Audience measurement',
  count1:
    'Visits are counted with <a href="https://umami.is">Umami</a>, self-hosted on the publisher’s own server at <code>insight.steevepommier.com</code>: no third party receives the data, and none of it serves advertising.',
  count2:
    '<b>Counted:</b> the pages viewed, with whatever identifies a ranking or a published ranking replaced by a placeholder (<code>/app/r/:id</code>); the site you came from; a few anonymous events (a ranking created or finished, a ranking published, a first vote on a published ranking and every pair voted, a result or a duel shared as an image and how, an installation, a shortcut of its icon used, a file exported or imported, something shared to Versus from another app and notifications turned on, with counts only, a side taken in the chocolatine debate); your browser, system, type of device, screen size, language and country.',
  count3:
    '<b>Never counted:</b> the content of your rankings, their titles or items, the address of a published ranking, the author’s key, your IP address (it gives the country, then is discarded), or anything that could follow you from one site to another. No cookie is set.',
  count4:
    'The counter isn’t even loaded when your browser sends <i>Do Not Track</i> or <i>Global Privacy Control</i>, or when you switch it off below; that choice is kept in this browser.',
  countOn: 'Your visits are counted, anonymously, in this browser.',
  countOff: 'Your visits aren’t counted in this browser.',
  countSignal: 'Your browser asks not to be tracked: your visits aren’t counted.',
  countNone: 'This copy of Versus doesn’t count visits.',
  countStop: 'Stop counting my visits',
  countResume: 'Count my visits again',

  cookiesTitle: 'Cookies',
  cookies1:
    'Versus sets no cookie, so there is no consent banner: there is nothing to consent to. When publishing asks for a check against bots, Cloudflare Turnstile runs in your browser, under Cloudflare’s privacy policy.',

  logsTitle: 'Hosting and abuse',
  logs1:
    'Like any host, Cloudflare (and GitHub for the copy) processes your IP address to deliver the pages and protect the site: see <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>. Versus uses it, without keeping it, to limit how often one address can publish or call the server, and keeps technical logs of calls to the server for a few days to fix errors.',

  rightsTitle: 'Your rights',
  rights1:
    'Under the GDPR you may ask to access or erase data about you. Versus keeps none that names you: your rankings are on your device, and published votes carry only an anonymous id. For any question or request, write to {email}; you may also lodge a complaint with the <a href="https://www.cnil.fr">CNIL</a>.',

  licenceTitle: 'Licence and content',
  licence1:
    'Versus is free software: its <a href="{source}">source code</a> is published under the <a href="{license}">MIT licence</a>.',
  licence2:
    'What you put in Versus remains yours. When you publish a ranking, you are responsible for it and must have the right to share what it contains. Something illegal or offensive on a published ranking? Use its <b>Report</b> button, or send its link to {email}, and it will be taken down.',

  liabTitle: 'Liability',
  liab1:
    'Versus is provided as is, in good faith, with no warranty of any kind: a ranking is an opinion made of duels, not a fact. Links to other sites are given for convenience; their content is theirs.',
};

export type LegalKey = keyof typeof legalEn;
export type LegalMessages = Record<LegalKey, string>;
