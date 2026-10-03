import { compute, nextPair, pushDuel } from '../core/scoring';
import type { Ranking, Rng } from '../core/types';
import { esc, mulberry32 } from '../core/util';
import { fill } from '../i18n/text';
import { BoardView, type Side } from './board';
import { VCursor } from './cursor';
import { HERO, item, PASTRY_TITLE } from './data';
import { rankOf } from './frame';
import { calm, isSeen, onErr, Run, watch } from './motion';
import type { Strings } from './strings';

/**
 * The hero's scripted demo: a virtual pointer plays the app (a click, a key, a swipe, a tie), then a few
 * calm duels that alternate sides, then "a few duels later" settles the ranking in one movement, and the
 * podium. Any click, tap or swipe on the frame hands it over to the visitor.
 */

interface Demo {
  view: BoardView;
  cur: VCursor;
  S: Strings;
  run: Run | null;
  say: (text: string) => void;
  live: HTMLElement;
  btn: HTMLElement;
  ok: () => boolean;
}

export function heroRank(S: Strings): Ranking {
  const r = rankOf(HERO.items, PASTRY_TITLE[S.lang], S.lang);
  for (const [a, b, s] of HERO.seed) pushDuel(r, a, b, s);
  return r;
}

function narrator(el: HTMLElement): (text: string) => void {
  let last = '';
  return (text) => {
    if (text === last) return;
    last = text;
    el.innerHTML = text
      .split(' ')
      .map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`)
      .join(' ');
  };
}

/** Next pair with its likely winner (the stronger item) on `side`, so the pointer's clicks alternate. */
function oriented(r: Ranking, side: Side, rng: Rng): [string, string] {
  const last = r.history[r.history.length - 1];
  const p = nextPair(r, last ? [last.a, last.b] : null, compute(r), rng) as [string, string];
  const [x, y] = p.map(item);
  const firstWins = (x?.s ?? 0) >= (y?.s ?? 0);
  return firstWins === (side === 'a') ? p : [p[1], p[0]];
}

async function play(D: Demo, run: Run): Promise<void> {
  const { view: V, cur, S } = D;
  const rest = () => cur.pt(V.stage, 0.93, 0.97);
  for (;;) {
    const rng = mulberry32(HERO.rng);
    V.load(heroRank(S), HERO.first);
    V.settle();
    cur.touch(false);
    cur.press(false);
    cur.place(cur.pt(V.stage, 0.86, 0.92));
    cur.show(true);

    // A click on the preferred card.
    D.say(S.say1);
    await run.wait(1400);
    await cur.move(V.card('b'), { ox: 0.5, oy: 0.42 }, run);
    V.hover('b', true);
    await run.wait(450);
    await cur.click(run);
    V.hover('b', false);
    await V.pick('b', { next: () => ['raisins', 'amandes'] });
    await run.wait(1000);

    // The keyboard.
    D.say(S.say2);
    await cur.move(rest(), {}, run);
    await run.wait(500);
    await V.key('b', run);
    await V.pick('b', { next: () => ['kouign', 'pac'] });
    await run.wait(1000);

    // A swipe towards the chosen side.
    D.say(S.say3);
    cur.touch(true);
    await cur.move(V.card('a'), { ox: 0.6, oy: 0.55 }, run);
    cur.press(true);
    V.stage.classList.add('dragging');
    await run.wait(220);
    await V.drag(-160, 640, run, cur);
    cur.press(false);
    V.stage.classList.remove('dragging');
    await V.pick('a', { next: () => ['choc', 'pac'] });
    cur.touch(false);
    await run.wait(900);

    // The eternal debate ends in a tie.
    D.say(S.say4);
    await cur.move(V.card('a'), { ox: 0.5, oy: 0.45 }, run);
    V.hover('a', true);
    await run.wait(750);
    V.hover('a', false);
    await cur.move(V.card('b'), { ox: 0.5, oy: 0.45 }, run);
    V.hover('b', true);
    await run.wait(750);
    V.hover('b', false);
    D.say(S.say5);
    await cur.move(V.ctl('draw'), {}, run);
    await run.wait(260);
    await cur.click(run);
    await V.pick('draw', { next: () => oriented(V.rank, 'a', rng) });
    await run.wait(1000);

    // Three calm duels, one side then the other.
    D.say(S.say6);
    const sides: Side[] = ['a', 'b', 'a'];
    for (let k = 0; k < sides.length; k++) {
      const side = sides[k] as Side;
      const then = sides[k + 1];
      await cur.move(V.card(side), { ox: 0.5, oy: 0.45 }, run);
      V.hover(side, true);
      await run.wait(380);
      await cur.click(run);
      V.hover(side, false);
      await V.pick(side, then ? { next: () => oriented(V.rank, then, rng) } : {});
      await run.wait(950);
    }

    // The rest in one movement, then the podium.
    D.say(S.say7);
    await cur.move(rest(), {}, run);
    await V.fastForward(rng, run);
    await run.wait(700);
    D.say(S.say8);
    V.confetti();
    await run.wait(900);
    const tab = V.tabBtn('results');
    if (tab) {
      await cur.move(tab, {}, run);
      await run.wait(200);
      await cur.click(run);
    }
    V.show('results');
    await run.wait(2800);
    const top = compute(V.rank).order[0];
    D.say(fill(S.say9, { name: top?.label ?? '' }));
    await run.wait(4200);
    V.root.classList.add('dim');
    await run.wait(500);
  }
}

function takeover(D: Demo, quiet = false): void {
  const V = D.view;
  if (V.o.interactive) return;
  D.run?.stop();
  V.o.interactive = true;
  V.engaged = true;
  D.cur.show(false);
  D.cur.touch(false);
  D.cur.press(false);
  V.settle();
  D.live.classList.add('off');
  const label = D.live.lastElementChild;
  if (label) label.textContent = D.S.demoYou;
  D.say(quiet ? D.S.sayCalm : D.S.sayYou);
  D.btn.textContent = D.S.demoReplay;
}

function start(D: Demo): void {
  D.run?.stop();
  const V = D.view;
  V.o.interactive = false;
  V.engaged = false;
  D.live.classList.remove('off');
  const label = D.live.lastElementChild;
  if (label) label.textContent = D.S.demoLive;
  D.btn.textContent = D.S.demoPlay;
  D.run = new Run(D.ok);
  play(D, D.run).catch(onErr);
}

/** Sets up the hero demo on its frame; it starts once on screen, never under reduced motion. */
export function heroDemo(frame: HTMLElement, S: Strings): BoardView {
  const sayEl = document.getElementById('hero-say') as HTMLElement;
  const live = document.getElementById('hero-live') as HTMLElement;
  const btn = document.getElementById('hero-btn') as HTMLElement;
  const D: Demo = {
    S,
    run: null,
    live,
    btn,
    say: narrator(sayEl),
    ok: () => isSeen(frame),
    // Assigned right below: the view's takeover callback needs the demo.
    view: undefined as unknown as BoardView,
    cur: new VCursor(frame),
  };
  D.view = new BoardView(frame, S, { interactive: false, onTakeover: () => takeover(D) });
  D.view.load(heroRank(S), HERO.first);
  btn.addEventListener('click', () => {
    if (D.view.o.interactive) start(D);
    else {
      takeover(D);
      D.view.show('duel');
    }
  });
  if (calm()) {
    takeover(D, true);
    btn.hidden = true;
  } else {
    let started = false;
    watch(frame, (visible) => {
      if (visible && !started) {
        started = true;
        start(D);
      }
    });
  }
  return D.view;
}
