// Self-hosted fonts (same files as Google Fonts, served from our origin): Bricolage Grotesque with its
// optical size axis, Figtree, JetBrains Mono 500. Preloads for the first render: build/seo-plugin.ts.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { mount } from './app/ui';

mount(document);
