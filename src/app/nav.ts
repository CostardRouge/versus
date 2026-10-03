/**
 * "Draw the view again", for the modules a view is made of: rankings.ts draws the views and imports them, so they
 * don't import it back. The app hands rankings.ts's render over at startup (ui.ts).
 */

type Render = (fallback?: () => HTMLElement | null) => void;

let drawView: Render = () => {};

export function setRender(render: Render): void {
  drawView = render;
}

/** Draws the view the route names again, its focused control kept (rankings.ts). */
export const render: Render = (fallback) => drawView(fallback);
