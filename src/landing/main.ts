// The home page (index.html in English, fr/index.html in French): its HTML is rendered at build time
// (src/landing/markup.ts); this script brings the demos to life. Same self-hosted fonts as the app.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/jetbrains-mono/500.css';
import './landing.css';
import { mountLanding } from './mount';

mountLanding(document);
