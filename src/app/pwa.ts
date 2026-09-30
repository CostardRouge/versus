import { t } from '../i18n';
import { $, doc, toast } from './dom';

/**
 * Installable, offline app (docs/pwa.md). Production builds register the service worker (src/sw/sw.ts). A new
 * version waits for the user: a bar offers to reload, so a deploy never interrupts a duel. The install button
 * shows only when the browser offers installation (Chromium, on desktop and Android).
 */

/** Chromium's `beforeinstallprompt` event, missing from the DOM types. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

let installPrompt: InstallPrompt | null = null;
let waiting: ServiceWorker | null = null;
/** Set when the user asked for the new version, so the page reloads once it takes over (and only then). */
let reloading = false;
/** An installed app can stay open for days: look for a new version when it comes back, at most hourly. */
const UPDATE_EVERY = 60 * 60 * 1000;

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Our own button instead of Chrome's mini-infobar on Android.
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    renderPwa();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderPwa();
    toast(t('installed'));
    void persist();
  });
  if (installed()) void persist();
  const sw = navigator.serviceWorker;
  if (!import.meta.env.PROD || !sw) return;
  // After the page's own downloads, so the precache doesn't compete with the first render.
  if (doc.readyState === 'complete') void register(sw);
  else window.addEventListener('load', () => void register(sw), { once: true });
}

async function register(sw: ServiceWorkerContainer): Promise<void> {
  try {
    const reg = await sw.register('./sw.js');
    // The first install has no controller to replace: nothing to offer.
    if (reg.waiting && sw.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => {
        if (next.state === 'installed' && sw.controller) offerUpdate(next);
      });
    });
    sw.addEventListener('controllerchange', () => {
      if (reloading) location.reload();
    });
    let checked = Date.now();
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState !== 'visible' || Date.now() - checked < UPDATE_EVERY) return;
      checked = Date.now();
      reg.update().catch(() => {});
    });
  } catch {
    /* no offline support (blocked storage, some private modes): the app still works online */
  }
}

/** Shows the update bar for a worker that is installed and waiting. */
export function offerUpdate(worker: ServiceWorker): void {
  waiting = worker;
  renderPwa();
}

export function applyUpdate(): void {
  if (!waiting) return;
  reloading = true;
  // Still waiting: ask it to take over (the page reloads on controllerchange). Another tab may already have
  // done so, in which case only this page is left to reload.
  if (waiting.state === 'installed') waiting.postMessage('skip-waiting');
  else location.reload();
}

/** Later: the new version starts when every tab of the app is closed. */
export function dismissUpdate(): void {
  waiting = null;
  renderPwa();
}

export async function install(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  // The event can be used once; Chromium fires a new one if the user declines.
  installPrompt = null;
  renderPwa();
  try {
    await prompt.prompt();
  } catch {
    /* already shown or refused by the browser: the address bar still offers installation */
  }
}

/** Install button and update bar, in the current language. */
export function renderPwa(): void {
  const btn = $<HTMLButtonElement>('#install');
  if (btn) {
    btn.hidden = !installPrompt;
    btn.title = t('installHint');
    const label = $('span', btn);
    if (label) label.textContent = t('install');
  }
  const bar = $('#update');
  if (bar) {
    bar.innerHTML = waiting
      ? `<span>${t('updateReady')}</span><button class="btn sm ghost" type="button" data-action="update-later">${t('updateLater')}</button><button class="btn sm primary" type="button" data-action="update">${t('updateReload')}</button>`
      : '';
  }
}

/** Opened from the home screen or as an installed window rather than in a browser tab. */
function installed(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches
  );
}

/** Asks the browser not to evict the rankings under storage pressure. Granted silently to installed apps. */
async function persist(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
}
