// The moderation page (admin/index.html): the app's fonts and tokens, its own small stylesheet, and the page
// module. No audience measurement here: the page is the publisher's. Its bundle is named after this file
// (admin-*.js), which keeps it out of the service worker's precache (build/pwa.ts).
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import '../tokens.css';
import './admin.css';
import { mountAdmin } from './page';

const configured = import.meta.env.VITE_API_URL as string | undefined;
const API: string | null = configured !== undefined ? configured.replace(/\/+$/, '') : import.meta.env.DEV ? '' : null;

const storage = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

const root = document.getElementById('admin');
if (root) {
  mountAdmin({
    root,
    api: API,
    lang: navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en',
    fetch: (input, init) => fetch(input, init),
    storage: storage(),
    confirm: (message) => window.confirm(message),
    boardURL: (alias) => new URL(`../app/b/${alias}`, location.href).href,
    locale: navigator.language,
  });
}
