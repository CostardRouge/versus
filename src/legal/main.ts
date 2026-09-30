// The legal notice (legal/index.html in English, fr/mentions-legales/index.html in French): its HTML is rendered at
// build time (src/legal/markup.ts); this script counts the view and runs the measurement switch.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '../landing/landing.css';
import './legal.css';
import { startAnalytics, trackPage } from '../audience';
import { mountCount, rememberLanguage, stickyHeader } from './mount';

startAnalytics();
trackPage();
mountCount(document);
rememberLanguage(document);
stickyHeader(document);
