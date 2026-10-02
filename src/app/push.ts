import { trackEvent } from '../audience';
import { fromBase64url, type PushRole, pushOn, withPush } from '../core/push';
import { parseRoute } from '../core/route';
import { getLang, t } from '../i18n';
import { toast } from './dom';
import { ApiError, fetchConfig, online, subscribePush, unsubscribePush } from './remote';
import { loadOwners, loadPush, savePush } from './storage';

/**
 * Notifications of published boards on this side (docs/published-boards.md#notifications): a voter asks to be told
 * when a vote closes, the author as voters come in and pictures are reviewed. The browser subscribes once, on a
 * tap (its permission prompt comes from that tap); each board then gets the subscription for one role. The
 * service worker (src/sw/sw.ts) shows what the Worker sends and brings the app back on the board when tapped.
 *
 * Offered where the browser has push and the app's service worker is up (installed or not; on iPhone and iPad,
 * only the app added to the home screen has push), and the server has its keys.
 */

/** The server's public key and the service worker's registration, once both are known. */
let key: string | null = null;
let reg: ServiceWorkerRegistration | null = null;
let ready: Promise<boolean> | null = null;

const supported = (): boolean =>
  online() && 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;

/**
 * Whether notifications can be offered, once the server's config and the service worker answered (the bells
 * render then: asking later, in the tap, would lose the tap's permission to prompt).
 */
export function preparePush(): Promise<boolean> {
  if (!supported()) return Promise.resolve(false);
  ready ??= Promise.all([fetchConfig(), navigator.serviceWorker.ready]).then(
    ([config, registration]) => {
      key = config.push;
      reg = registration;
      if (!key) ready = null;
      return !!key;
    },
    () => {
      ready = null;
      return false;
    },
  );
  return ready;
}

/** Notifications can be offered now (preparePush answered yes). */
export const pushReady = (): boolean => !!key && !!reg && supported();

/** Whether this browser asked a board for notifications in that role. */
export const pushAsked = (alias: string, role: PushRole): boolean => pushOn(loadPush(), alias, role);

/** This browser's subscription, made with the server's key (a key changed since: a new one). */
async function subscription(r: ServiceWorkerRegistration, k: string): Promise<PushSubscription> {
  const current = await r.pushManager.getSubscription();
  const server = fromBase64url(k);
  // A browser that doesn't say which key made it: taken as ours (a new one would silence the other boards).
  const known = current?.options?.applicationServerKey;
  if (current && (!known || new Uint8Array(known).join() === server.join())) return current;
  await current?.unsubscribe();
  return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: server });
}

/**
 * Turns a board's notifications on or off for this role; resolves with whether they are on. Call it straight from
 * the tap: the browser's permission prompt needs it.
 */
export async function togglePush(alias: string, role: PushRole, token?: string): Promise<boolean> {
  if (pushAsked(alias, role)) {
    await turnOff(alias, role);
    return false;
  }
  return turnOn(alias, role, token);
}

async function turnOn(alias: string, role: PushRole, token?: string): Promise<boolean> {
  const r = reg;
  const k = key;
  if (!r || !k || !supported()) return false;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    if (permission === 'denied') toast(t('pushBlocked'));
    return false;
  }
  let sub: PushSubscription;
  try {
    sub = await subscription(r, k);
    await subscribePush(alias, { subscription: sub.toJSON(), role, lang: getLang() }, token);
  } catch (e) {
    toast(t(e instanceof ApiError && e.code === 'closed' ? 'voteClosed' : 'pushFailed'));
    return false;
  }
  savePush({ ...withPush(loadPush(), alias, role, true), endpoint: sub.endpoint });
  trackEvent('notify-on', { role });
  toast(t(role === 'voter' ? 'pushOnVoter' : 'pushOnOwner'));
  return true;
}

async function turnOff(alias: string, role: PushRole): Promise<void> {
  const p = loadPush();
  const next = withPush(p, alias, role, false);
  savePush(next);
  toast(t('pushOff'));
  try {
    await unsubscribePush(alias, { endpoint: p.endpoint, role });
  } catch {
    /* the board forgets it when it ends, or when the push service refuses it */
  }
  // Nothing left to hear about: the browser's subscription goes too.
  if (!Object.keys(next.boards).length) await (await reg?.pushManager.getSubscription())?.unsubscribe();
}

/** A board that closed (the voters were told) or is gone: this browser forgets what it asked of it. */
export function forgetPush(alias: string, role: PushRole | null = null): void {
  const p = loadPush();
  if (p.boards[alias] && (role === null || pushOn(p, alias, role))) savePush(withPush(p, alias, role, false));
}

/**
 * At startup: the browser may have dropped the subscription or renewed it, or the permission been taken back. The
 * bells follow, and the boards learn a renewed endpoint.
 */
export async function checkPush(): Promise<void> {
  const p = loadPush();
  if (!Object.keys(p.boards).length || !supported()) return;
  const sub =
    Notification.permission === 'granted'
      ? await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      : null;
  if (!sub) {
    savePush({ endpoint: '', boards: {} });
    return;
  }
  if (sub.endpoint === p.endpoint) return;
  let next = { ...p, endpoint: sub.endpoint };
  const owners = loadOwners();
  for (const [alias, roles] of Object.entries(p.boards)) {
    for (const role of roles) {
      try {
        await subscribePush(alias, { subscription: sub.toJSON(), role, lang: getLang() }, owners[alias]);
      } catch {
        next = withPush(next, alias, role, false);
      }
    }
  }
  savePush(next);
}

/** A tap on a notification while the app is open: the service worker asks it to open the board. */
export function listenPush(openBoard: (alias: string) => void): void {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { t?: unknown; path?: unknown } | null;
    if (d?.t !== 'open' || typeof d.path !== 'string' || !d.path.startsWith('app/')) return;
    const route = parseRoute(d.path.slice('app/'.length));
    if (route?.view === 'board') openBoard(route.alias);
  });
  // Messages wait until the page says it listens.
  sw.startMessages?.();
}
