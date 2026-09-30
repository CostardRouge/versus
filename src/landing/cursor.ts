import { type Run, STOP } from './motion';

/** The demo's virtual pointer: a cursor (or a fingertip for swipes) moving along gentle curves inside its frame. */
export class VCursor {
  x = 0;
  y = 0;
  private bend = 1;
  readonly el: HTMLElement;

  constructor(private readonly host: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'vcur';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<span class="ring"></span><span class="touch"></span><svg width="24" height="26" viewBox="0 0 24 26"><path d="M2.5 1.5v19.2l5-4.6 3.4 7.6 3.3-1.5-3.3-7.4h6.9z"/></svg>';
    host.appendChild(el);
    this.el = el;
  }

  to(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  }
  place(p: { x: number; y: number }): void {
    this.to(p.x, p.y);
  }
  show(on: boolean): void {
    this.el.classList.toggle('on', on);
  }
  touch(on: boolean): void {
    this.el.classList.toggle('touch-mode', on);
  }
  press(on: boolean): void {
    this.el.classList.toggle('down', on);
  }

  /** A point of `target`, in the frame's coordinates (0.5, 0.5 is its center). */
  pt(target: Element, ox = 0.5, oy = 0.5): { x: number; y: number } {
    const f = this.host.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    return { x: r.left - f.left + r.width * ox, y: r.top - f.top + r.height * oy };
  }

  /** Moves along a quadratic curve that bends one way then the other, eased in and out. */
  move(
    target: Element | { x: number; y: number },
    o: { ox?: number; oy?: number; dur?: number },
    run: Run,
  ): Promise<void> {
    const p = target instanceof Element ? this.pt(target, o.ox, o.oy) : target;
    const x0 = this.x;
    const y0 = this.y;
    const dx = p.x - x0;
    const dy = p.y - y0;
    const len = Math.hypot(dx, dy) || 1;
    const dur = o.dur ?? Math.min(1100, 420 + len * 0.9);
    this.bend = -this.bend;
    const b = 0.16 * len * this.bend;
    const cx = x0 + dx / 2 - (dy / len) * b;
    const cy = y0 + dy / 2 + (dx / len) * b;
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const frame = (now: number) => {
        if (!run.alive) return reject(STOP);
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        const u = 1 - e;
        this.to(u * u * x0 + 2 * u * e * cx + e * e * p.x, u * u * y0 + 2 * u * e * cy + e * e * p.y);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async click(run: Run): Promise<void> {
    this.press(true);
    await run.wait(120);
    this.press(false);
    this.el.classList.remove('clk');
    void this.el.offsetWidth;
    this.el.classList.add('clk');
  }
}
