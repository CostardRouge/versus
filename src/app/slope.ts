import { $$, doc } from './dom';

/**
 * Lines between two rankings of the same items (the end-of-vote page, the local method comparison).
 * Markup contract: a `[data-slope]` container holding `[data-slope-l] li[data-id]`,
 * `[data-slope-r] li[data-id]` and an `svg[data-slope-svg]` between them. The svg's `data-delay`
 * staggers the drawing while an ancestor has `.play` (or the container has `.draw`).
 */

let gradients = 0;

function draw(box: HTMLElement): void {
  const svg = box.querySelector<SVGSVGElement>('svg[data-slope-svg]');
  if (!svg) return;
  const area = svg.getBoundingClientRect();
  const w = area.width;
  svg.setAttribute('viewBox', `0 0 ${w} ${area.height}`);
  const y = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 - area.top;
  };
  const left = $$('[data-slope-l] li[data-id]', box);
  const animated = box.classList.contains('draw') || box.closest('.play') !== null;
  const at = animated ? Number(svg.dataset.delay ?? 0) : 0;
  const id = svg.dataset.grad ?? `slope-g${++gradients}`;
  svg.dataset.grad = id;
  let out = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0"><stop offset="0" style="stop-color:var(--a)"/><stop offset="1" style="stop-color:var(--b)"/></linearGradient></defs>`;
  $$('[data-slope-r] li[data-id]', box).forEach((right, i) => {
    const key = right.dataset.id ?? '';
    const l = left.find((li) => li.dataset.id === key);
    if (!l) return;
    const y1 = y(l);
    const y2 = y(right);
    const same = left.indexOf(l) === i;
    const d = `--d:${(animated ? at + i * 0.06 : 0).toFixed(2)}s`;
    const k = key.replace(/"/g, '');
    out += `<path data-id="${k}" class="${same ? 'sl-same' : 'sl-moved'}" ${same ? '' : `stroke="url(#${id})"`} d="M4 ${y1} C ${w / 2} ${y1}, ${w / 2} ${y2}, ${w - 4} ${y2}" pathLength="1" stroke-dasharray="1" style="${d}"/>`;
    out += `<circle data-id="${k}" class="sl-a" cx="4" cy="${y1}" r="3.5" style="${d}"/><circle data-id="${k}" class="sl-b" cx="${w - 4}" cy="${y2}" r="3.5" style="${d}"/>`;
  });
  svg.innerHTML = out;
}

/** Draws every slope on the page (after a render, on resize, once fonts are in). */
export function drawSlopes(): void {
  for (const box of $$('[data-slope]')) draw(box);
}

/**
 * Pointing at an item (in either ranking, or its line) highlights it on both sides. Its rows are also toggle
 * buttons, for touch and the keyboard: a tap, Enter or Space keeps the item highlighted, a second one lets go.
 */
export function bindSlopes(root: ParentNode = doc): void {
  for (const box of $$('[data-slope]', root)) {
    const rows = $$('[data-slope-l] li[data-id], [data-slope-r] li[data-id]', box);
    let kept: string | null = null;
    const light = (key: string | null) => {
      box.classList.toggle('hovering', key !== null);
      for (const el of $$<Element>('[data-id]', box)) el.classList.toggle('hl', el.getAttribute('data-id') === key);
    };
    const keep = (key: string | null) => {
      kept = key === kept ? null : key;
      for (const li of rows) li.setAttribute('aria-pressed', String(li.dataset.id === kept));
      light(kept);
    };
    for (const li of rows) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', 'false');
    }
    box.addEventListener('pointerover', (e) => {
      if (kept !== null) return;
      const el = (e.target as Element | null)?.closest?.('[data-id]');
      light(el?.getAttribute('data-id') ?? null);
    });
    box.addEventListener('pointerleave', () => light(kept));
    box.addEventListener('click', (e) => {
      const li = (e.target as Element | null)?.closest?.<HTMLElement>('li[data-id]');
      if (li && rows.includes(li)) keep(li.dataset.id ?? null);
    });
    box.addEventListener('keydown', (e) => {
      const li = e.target as HTMLElement;
      if ((e.key !== 'Enter' && e.key !== ' ') || !rows.includes(li)) return;
      e.preventDefault();
      keep(li.dataset.id ?? null);
    });
  }
}

/** After a render: draw now, bind the hover, and draw again once the fonts have settled the layout. */
export function mountSlopes(root: ParentNode = doc): void {
  drawSlopes();
  bindSlopes(root);
  doc.fonts?.ready.then(drawSlopes, () => {});
}
