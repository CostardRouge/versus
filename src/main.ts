// Self-hosted fonts (same files as Google Fonts, served from our origin): Bricolage Grotesque with its
// optical size axis, Figtree, JetBrains Mono 500 (latin subsets: it sets numbers and codes). Preloads for the
// first render: build/seo-plugin.ts.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import './styles.css';
import { mount } from './app/ui';
import { startAnalytics } from './audience';

// Audience measurement (docs/analytics.md): the app counts its views as the address follows them (app/router.ts).
startAnalytics();
mount(document);
