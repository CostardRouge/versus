import { measurement, setOptOut } from '../audience';

/**
 * The legal page's switch for audience measurement: shows what this browser does (counted, switched off, a
 * privacy signal, a build without measurement) and turns counting off or back on. Turning it back on takes
 * effect from the next page: the tracker isn't loaded on a page where the visitor had said no.
 */
export function mountCount(doc: Document): void {
  const box = doc.getElementById('count');
  if (!box) return;
  const show = () => {
    const state = measurement();
    for (const el of box.querySelectorAll<HTMLElement>('[data-when]')) {
      el.hidden = !(el.dataset.when ?? '').split(' ').includes(state);
    }
    box.dataset.state = state;
  };
  show();
  box.hidden = false;
  doc.getElementById('count-toggle')?.addEventListener('click', () => {
    const off = measurement() === 'on';
    setOptOut(off);
    show();
  });
}

/** The sticky header gets its rule once the page scrolls, as on the home page. */
export function stickyHeader(doc: Document): void {
  const nav = doc.getElementById('nav');
  const onScroll = () => nav?.classList.toggle('scrolled', (doc.defaultView?.scrollY ?? 0) > 8);
  doc.defaultView?.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/** A click on a language remembers it, as on the home page, so the home page and the app open in it. */
export function rememberLanguage(doc: Document): void {
  doc.addEventListener('click', (e) => {
    const lang = (e.target as Element).closest<HTMLElement>('a[data-lang]')?.dataset.lang;
    if (lang !== 'en' && lang !== 'fr') return;
    try {
      const prefs = JSON.parse(localStorage.getItem('versus-prefs') ?? '{}');
      localStorage.setItem(
        'versus-prefs',
        JSON.stringify({ ...(prefs && typeof prefs === 'object' ? prefs : {}), lang }),
      );
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  });
}
