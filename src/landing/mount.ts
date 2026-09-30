import type { BoardView } from './board';
import { burst } from './confetti';
import { heroDemo } from './demo';
import type { PageData } from './markup';
import { chrome, crowdBoard, finale, keyboard, languages, methods, rotator, tryIt, vignettes } from './sections';

/** Brings the static home page to life, from the data the build embedded in it. */
export function mountLanding(doc: Document): void {
  const raw = doc.getElementById('landing-data')?.textContent;
  if (!raw) return;
  const data = JSON.parse(raw) as PageData;
  const S = data.S;
  const views: BoardView[] = [];
  const hero = doc.getElementById('hero-frame');
  if (hero) views.push(heroDemo(hero, S));
  const tried = tryIt(S, data);
  if (tried) views.push(tried);
  keyboard(views);
  rotator(S);
  vignettes(S);
  methods(S, data);
  crowdBoard(S);
  finale(S, doc.querySelector('.nav-cta')?.getAttribute('href') ?? 'app/', burst);
  languages(S);
  chrome(S);
}
