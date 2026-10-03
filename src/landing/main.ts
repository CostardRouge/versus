// The home page (index.html in English, fr/index.html in French): its HTML is rendered at build time
// (src/landing/markup.ts); this script brings the demos to life and counts the view (docs/analytics.md). Same
// self-hosted fonts as the app.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './landing.css';
import { startAnalytics, trackPage } from '../audience';
import { mountLanding } from './mount';

// The boot script may already be sending the visitor elsewhere (a language chosen before, an installed app):
// the page they land on counts the view.
if (!('leaving' in document.documentElement.dataset)) {
  startAnalytics();
  trackPage();
}
mountLanding(document);
