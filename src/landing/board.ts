import { compute, nextPair, pushDuel, stability } from '../core/scoring';
import type { Outcome, Ranking, Rng } from '../core/types';
import { pctText } from '../i18n/text';
import { burst } from './confetti';
import { duelOutcome } from './crowd';
import type { VCursor } from './cursor';
import { item } from './data';
import { cardHTML, eyebrow, forecast, nDuels, podiumHTML, rowsHTML, scoreHTML, stabilityPct } from './frame';
import { calm, type Run, STOP, sleep } from './motion';
import type { Strings } from './strings';

export type Side = 'a' | 'b';
type Pair = [string, string];

export interface BoardOpts {
  /** Takes clicks, taps, swipes and keys; a scripted demo isn't until the visitor takes over. */
  interactive: boolean;
  /** Called on the first interaction with a scripted demo, which then becomes interactive. */
  onTakeover?: () => void;
  /** After every duel played on this frame. */
  onDuel?: (view: BoardView) => void;
}

/**
 * One demo frame of the home page, over the HTML the build rendered (src/landing/frame.ts): the app's duel
 * stage in miniature, with the same scoring (src/core), gestures and keyboard shortcuts.
 */
export class BoardView {
  rank!: Ranking;
  pair: Pair | null = null;
  tab: 'duel' | 'results' = 'duel';
  busy = false;
  /** The visitor touched this frame: its keyboard shortcuts are live while it's on screen. */
  engaged = false;
  private gen = 0;
  private toastTimer = 0;
  readonly stage: HTMLElement;
  private readonly list: HTMLOListElement | null;
  private readonly duelPane: HTMLElement;
  private readonly resPane: HTMLElement;

  constructor(
    readonly root: HTMLElement,
    private readonly S: Strings,
    readonly o: BoardOpts,
  ) {
    const q = <T extends HTMLElement>(sel: string) => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`frame without ${sel}`);
      return el;
    };
    this.stage = q('.stage');
    this.list = root.querySelector('.rl');
    this.duelPane = q('.pane.duel');
    this.resPane = q('.pane.res');
    this.bind();
  }

  private q<T extends HTMLElement>(sel: string): T | null {
    return this.root.querySelector<T>(sel);
  }
  card(side: Side): HTMLElement {
    return this.stage.querySelector(`.card-${side}`) as HTMLElement;
  }
  ctl(act: string): HTMLElement {
    return this.q(`.controls [data-act="${act}"]`) as HTMLElement;
  }
  tabBtn(name: 'duel' | 'results'): HTMLElement | null {
    return this.q(`[data-tab="${name}"]`);
  }

  private bind(): void {
    const st = this.stage;
    let x0: number | null = null;
    let dx = 0;
    let moved = false;
    let downCard: HTMLElement | null = null;
    st.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || this.busy) return;
      // A mouse press takes over at once; a touch may still become a scroll, so it waits for a swipe or a tap.
      if (e.pointerType === 'mouse' && (e.button !== 0 || !this.live())) return;
      x0 = e.clientX;
      dx = 0;
      moved = false;
      downCard = (e.target as Element).closest<HTMLElement>('.card');
      try {
        st.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable: the drag still works inside the stage */
      }
    });
    st.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      if (Math.abs(dx) > 8) moved = true;
      if (!this.o.interactive) {
        if (Math.abs(dx) > 12 && !this.live()) x0 = null;
        return;
      }
      st.classList.add('dragging');
      this.setDrag(dx);
    });
    const end = (e: PointerEvent) => {
      if (x0 === null) return;
      const d = dx;
      const wasMoved = moved;
      const card = downCard;
      x0 = null;
      st.classList.remove('dragging');
      this.resetDrag();
      if (e.type !== 'pointerup' || !this.live()) return;
      if (d < -80) void this.pick('a');
      else if (d > 80) void this.pick('b');
      else if (!wasMoved && card) void this.pick(card.dataset.side as Side);
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    // Enter or Space on a focused card (pointer clicks are handled above).
    st.addEventListener('click', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.card');
      if (card && e.detail === 0 && this.live()) void this.pick(card.dataset.side as Side);
    });
    this.root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-act],[data-tab]');
      if (!b || !this.live()) return;
      if (b.dataset.tab) return this.show(b.dataset.tab === 'results' ? 'results' : 'duel');
      const act = b.dataset.act;
      if (act === 'skip') this.skip();
      else if (act === 'undo') this.undo();
      else if (act === 'a' || act === 'b' || act === 'draw') void this.pick(act);
    });
    const engage = () => {
      if (this.o.interactive) this.engaged = true;
    };
    this.root.addEventListener('pointerdown', engage);
    this.root.addEventListener('focusin', engage);
  }

  /** True when the frame takes input, taking over from the scripted demo if needed. */
  live(): boolean {
    if (this.o.interactive) return true;
    if (!this.o.onTakeover) return false;
    this.o.onTakeover();
    return true;
  }

  setDrag(dx: number): void {
    const p = Math.max(-1, Math.min(1, dx / 140));
    const s = this.stage.style;
    s.setProperty('--dx', String(dx));
    s.setProperty('--pa', String(Math.max(0, -p)));
    s.setProperty('--pb', String(Math.max(0, p)));
  }
  resetDrag(): void {
    for (const p of ['--dx', '--pa', '--pb']) this.stage.style.removeProperty(p);
  }

  load(rank: Ranking, pair: Pair): void {
    this.gen++;
    this.rank = rank;
    this.busy = false;
    const title = this.q('.f-title');
    if (title) title.textContent = rank.title;
    this.stage.classList.remove('picked', 'pick-a', 'pick-b', 'pick-draw', 'dragging', 'skim');
    this.resetDrag();
    this.renderList(true);
    this.updateStab();
    this.setPair(pair, false);
    this.show('duel');
  }

  setPair(pair: Pair, enter = !calm()): void {
    this.pair = pair;
    this.card('a').outerHTML = cardHTML(pair[0], 'a', this.S);
    this.card('b').outerHTML = cardHTML(pair[1], 'b', this.S);
    const C = compute(this.rank);
    const pa = forecast(C, pair);
    const [a, b] = [this.q('.p.pa'), this.q('.p.pb')];
    if (a) a.textContent = String(pa);
    if (b) b.textContent = String(100 - pa);
    const eb = this.q('.f-eyebrow');
    if (eb) eb.textContent = eyebrow(this.rank, this.S);
    this.markList();
    if (enter) {
      this.stage.classList.remove('enter');
      void this.stage.offsetWidth;
      this.stage.classList.add('enter');
    }
  }

  private setFloat(side: Side, d: number): void {
    const el = this.q(`.float.f${side}`);
    if (!el) return;
    const v = Math.round(d);
    el.className = `float f${side} ${v > 0 ? 'up' : v < 0 ? 'down' : 'eq'}`;
    el.textContent = v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '=';
  }

  /** Plays the duel on screen. `next` sets the following pair (the scripted demo chooses its own). */
  async pick(side: Side | 'draw', opts: { next?: () => Pair } = {}): Promise<void> {
    if (this.busy || !this.pair || this.tab !== 'duel') return;
    this.busy = true;
    const gen = this.gen;
    const [a, b] = this.pair;
    const s: Outcome = side === 'a' ? 1 : side === 'b' ? 0 : 0.5;
    const before = compute(this.rank);
    pushDuel(this.rank, a, b, s);
    const after = compute(this.rank);
    this.setFloat('a', (after.st[a]?.score ?? 0) - (before.st[a]?.score ?? 0));
    this.setFloat('b', (after.st[b]?.score ?? 0) - (before.st[b]?.score ?? 0));
    const st = this.stage;
    st.classList.remove('enter');
    st.classList.add('picked', side === 'draw' ? 'pick-draw' : `pick-${side}`);
    await sleep(calm() ? 120 : 640);
    if (gen !== this.gen) return;
    // Back to rest without transitions, then the next pair slides in.
    st.classList.add('reset');
    st.classList.remove('picked', 'pick-a', 'pick-b', 'pick-draw');
    this.resetDrag();
    void st.offsetWidth;
    st.classList.remove('reset');
    this.renderList();
    this.updateStab();
    this.setPair(opts.next ? opts.next() : this.nextPair([a, b]));
    this.busy = false;
    this.o.onDuel?.(this);
  }

  nextPair(avoid: Pair | null = this.pair): Pair {
    return nextPair(this.rank, avoid) as Pair;
  }

  skip(): void {
    if (this.busy || !this.pair || this.tab !== 'duel') return;
    this.setPair(this.nextPair(this.pair));
  }

  undo(): void {
    if (this.busy) return;
    const h = this.rank.history.pop();
    if (!h) return;
    this.renderList();
    this.updateStab();
    this.show('duel');
    this.setPair([h.a, h.b]);
    this.toast(this.S.undone);
  }

  /**
   * "A few duels later": the remaining duels of a stable ranking played at once, out of sight, then the
   * roster settles in one movement. Used by the scripted demo instead of a burst of rapid picks.
   */
  async fastForward(rng: Rng, run: Run): Promise<void> {
    this.stage.classList.add('skim');
    await run.wait(420);
    let prev = this.pair;
    for (let k = 0; k < 60 && stability(this.rank) < 1; k++) {
      const p = nextPair(this.rank, prev, compute(this.rank), rng);
      if (!p) break;
      pushDuel(this.rank, p[0], p[1], duelOutcome(item(p[0]), item(p[1]), rng));
      prev = p;
    }
    this.renderList();
    this.updateStab();
    this.setPair(this.nextPair(prev), false);
    await run.wait(300);
    this.stage.classList.remove('skim');
  }

  updateStab(): void {
    const C = compute(this.rank);
    const s = stabilityPct(this.rank, C);
    const bar = this.q<HTMLElement>('.pane.duel .stab .bar i');
    if (bar) bar.style.width = `${s}%`;
    const txt = this.q('.f-stab');
    if (txt) txt.textContent = pctText(s, this.S.lang);
    const count = this.q('.f-count');
    if (count) count.textContent = nDuels(this.rank.history.length, this.S);
  }

  renderList(first = false): void {
    const list = this.list;
    if (!list) return;
    const C = compute(this.rank);
    if (first) {
      list.innerHTML = rowsHTML(C, this.S);
    } else {
      const up = flip(
        list,
        C.order.map((it) => it.id),
      );
      C.order.forEach((it, k) => {
        const li = list.children[k];
        const [pos, sc] = [li?.querySelector('.pos'), li?.querySelector('.sc')];
        if (pos) pos.textContent = String(k + 1);
        if (sc) sc.innerHTML = scoreHTML(C.st[it.id], C.m, this.S);
      });
      for (const id of up) {
        const li = list.querySelector(`[data-id="${id}"]`);
        li?.classList.remove('up');
        void (li as HTMLElement | null)?.offsetWidth;
        li?.classList.add('up');
      }
    }
    this.markList();
  }

  private markList(): void {
    if (!this.list || !this.pair) return;
    for (const li of Array.from(this.list.children) as HTMLElement[]) {
      li.classList.toggle('in-a', li.dataset.id === this.pair[0]);
      li.classList.toggle('in-b', li.dataset.id === this.pair[1]);
    }
  }

  show(tab: 'duel' | 'results'): void {
    this.tab = tab;
    if (tab === 'results') this.resPane.innerHTML = podiumHTML(this.rank, compute(this.rank), this.S, !calm());
    this.duelPane.classList.toggle('off', tab !== 'duel');
    this.resPane.classList.toggle('off', tab !== 'results');
    this.duelPane.inert = tab !== 'duel';
    this.resPane.inert = tab !== 'results';
    for (const b of Array.from(this.root.querySelectorAll('[data-tab]'))) {
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.tab === tab));
    }
  }

  hover(side: Side, on: boolean): void {
    this.card(side).classList.toggle('vhover', on);
  }

  /** The keycap shown over the stage while the demo "presses" a key. */
  async key(act: Side | 'draw', run: Run): Promise<void> {
    const k = this.q('.kcap');
    const c = this.ctl(act);
    if (!k) return;
    k.textContent = act === 'a' ? '←' : act === 'b' ? '→' : '↓';
    k.classList.add('show');
    await run.wait(420);
    k.classList.add('down', act);
    c.classList.add('kpress');
    await run.wait(170);
    k.classList.remove('down');
    setTimeout(() => {
      k.classList.remove('show', 'a', 'b', 'draw');
      c.classList.remove('kpress');
    }, 380);
  }

  /** The swipe of the demo: the card follows the fingertip, as in the app. */
  drag(to: number, dur: number, run: Run, cur: VCursor): Promise<void> {
    return new Promise((resolve, reject) => {
      const x0 = cur.x;
      const y0 = cur.y;
      const t0 = performance.now();
      const frame = (now: number) => {
        if (!run.alive) {
          this.resetDrag();
          return reject(STOP);
        }
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        this.setDrag(to * e);
        cur.to(x0 + to * e * 0.9, y0);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /** Clears whatever the scripted demo left on screen. */
  settle(): void {
    this.hover('a', false);
    this.hover('b', false);
    this.resetDrag();
    this.stage.classList.remove('dragging', 'skim');
    this.q('.kcap')?.classList.remove('show', 'down', 'a', 'b', 'draw');
    for (const el of Array.from(this.root.querySelectorAll('.kpress'))) el.classList.remove('kpress');
    this.root.classList.remove('dim');
  }

  confetti(): void {
    burst(this.root);
  }

  toast(msg: string): void {
    const el = this.q('.f-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('on'), 2600);
  }
}

/** Reorders a list's items to `ids` and animates each from its old place (FLIP). Returns the ids that moved up. */
export function flip(ol: HTMLElement, ids: readonly string[]): string[] {
  const before = new Map(
    (Array.from(ol.children) as HTMLElement[]).map((li) => [li.dataset.id, li.getBoundingClientRect().top]),
  );
  for (const id of ids) {
    const li = ol.querySelector(`:scope > [data-id="${id}"]`);
    if (li) ol.appendChild(li);
  }
  const up: string[] = [];
  for (const li of Array.from(ol.children) as HTMLElement[]) {
    const d = (before.get(li.dataset.id) ?? 0) - li.getBoundingClientRect().top;
    if (Math.abs(d) < 1) continue;
    if (d > 0 && li.dataset.id) up.push(li.dataset.id);
    if (!calm() && typeof li.animate === 'function') {
      li.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], {
        duration: 560,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }
  return up;
}
