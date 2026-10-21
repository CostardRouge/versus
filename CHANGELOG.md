# Changelog

What each release of Versus brings to the people who use it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); `.github/workflows/release.yml` turns each section into a
tag and a GitHub Release once it reaches `main` (COMMON-PROJECT-SPEC C13, D123). Written in English, like the code.
Codenames are pastries.

## [Unreleased]

### Added

- Favicons at 16 and 32 px for the browsers that show a bitmap in the tab, and a 192 px maskable icon for Android
  launchers, completing the icon set.

### Fixed

- Screen readers and voice control now name the duel's cards and the Versus logo with the words shown on them,
  including a color's code, so saying what you see on screen selects it.

## [1.1.0] - 2026-10-17 — Croissant

The installed app does more: notifications, sharing from other apps, shortcuts, and room for many more pictures.

### Added

- Notifications for published boards: a voter can be told when a vote closes, and an author as voters come in and
  when a picture is reviewed (asked on a tap; on iPhone and iPad, in the app added to the home screen).
- Share to Versus from other apps: photos, a list or a Versus file go into a new ranking or one you pick (Android).
- Shortcuts on the installed app's icon (New ranking, Resume) and screenshots in its install dialog.

### Changed

- Pictures are kept in the browser's database instead of its small local storage, so a ranking can hold many more.

## [1.0.0] - 2026-10-17 — Chocolatine

The first numbered release: Versus as it is live today at versus.steevepommier.com.

### Added

- Rank anything by comparing two items at a time: text, pictures, colors and gradients, a whole list pasted at once;
  duels by tap, swipe or keyboard, with skip, tie and undo.
- Four scoring methods, switchable at any time on the same duels: Balanced (Bradley-Terry), Dynamic (Elo), Simple
  (win rate) and Exact sort; the result as a podium, a table, or lines comparing two methods.
- Published boards: share a ranking and let a crowd vote on it live, with visibility settings, the crowd's ranking
  next to your own, an end-of-vote page, suggestions from visitors, reports and moderation.
- Your votes: the boards you voted on, kept in your gallery with what changed since your last visit.
- Popular: official boards on divisive topics, each with its own page, and the boards the site features.
- Share a result as an image (post, story, landscape), with link previews for boards and duels.
- English and French, light and dark themes, an installable app that works offline, export and import of every
  ranking.
- A home page with a playable demo, and audience measurement without cookies that anyone can decline.
- The version you are using, at the end of the gallery.
