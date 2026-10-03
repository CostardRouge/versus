/**
 * Timing helpers for the home page's animations: loops that run only while their element is on screen, the
 * tab visible and the animations not paused (WCAG 2.2.2), and stop cleanly when the visitor takes over.
 */

export const STOP = Symbol('stop');
export const calm = (): boolean => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const onErr = (e: unknown): void => {
  if (e !== STOP) console.error(e);
};

let paused = false;
export const isPaused = (): boolean => paused;
/** The page's pause button: loops wait, CSS animations stop (html.paused). */
export function setPaused(v: boolean): void {
  paused = v;
  document.documentElement.classList.toggle('paused', v);
}

const seen = new WeakMap<Element, boolean>();
const watchers = new Map<Element, (visible: boolean) => void>();
const io =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            seen.set(e.target, e.isIntersecting);
            watchers.get(e.target)?.(e.isIntersecting);
          }
        },
        { threshold: 0.12 },
      )
    : null;

/** Calls `cb` whenever `el` enters or leaves the screen. Without IntersectionObserver, it counts as visible. */
export function watch(el: Element, cb: (visible: boolean) => void): void {
  watchers.set(el, cb);
  if (io) io.observe(el);
  else {
    seen.set(el, true);
    cb(true);
  }
}
export const isSeen = (el: Element): boolean => !!seen.get(el) && !document.hidden;

/**
 * A cancellable script: every wait pauses while `ok()` is false, animations are paused, or the visitor asks for
 * reduced motion (also when they ask with the page open), and throws once stopped.
 */
export class Run {
  alive = true;
  constructor(private readonly ok: () => boolean) {}
  stop(): void {
    this.alive = false;
  }
  async wait(ms: number): Promise<void> {
    await sleep(ms);
    while (this.alive && (paused || calm() || !this.ok())) await sleep(250);
    if (!this.alive) throw STOP;
  }
}

/** Starts `fn` the first time `el` shows up (never under reduced motion); it then pauses off screen. */
export function loopWhenSeen(el: Element, fn: (run: Run) => Promise<void>): void {
  let started = false;
  watch(el, (visible) => {
    if (!visible || started || calm()) return;
    started = true;
    fn(new Run(() => isSeen(el))).catch(onErr);
  });
}
