import { calm } from './motion';

/** A burst of confetti in the accent colors over `host`, for the moments a ranking settles. */
export function burst(host: HTMLElement): void {
  if (calm()) return;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext?.('2d');
  if (!ctx) return;
  cv.className = 'confetti';
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const w = host.clientWidth;
  const h = host.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr;
  cv.height = h * dpr;
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(host);
  const colors = ['--a', '--b', '--good', '--ink'].map((v) => cs.getPropertyValue(v).trim() || '#888');
  const parts = Array.from({ length: 110 }, (_, i) => ({
    x: w * (0.3 + Math.random() * 0.4),
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 10,
    vy: -4 - Math.random() * 9,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    s: 5 + Math.random() * 6,
    c: colors[i % colors.length] ?? '#888',
  }));
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = now - t0;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2000);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t < 2000) requestAnimationFrame(frame);
    else cv.remove();
  };
  requestAnimationFrame(frame);
}
