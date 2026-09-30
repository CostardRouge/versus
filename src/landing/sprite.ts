/**
 * The pastry drawings, one <symbol> each, inlined once in the page and drawn with <use href="#p-…">.
 * Gradients live in the sprite's <defs>: a gradient inside a hidden symbol doesn't paint in every browser.
 * Colors are the drawings' own (like a photo), the same in both themes.
 */

const f1 = (n: number): string => n.toFixed(1);

/** Archimedean spiral of the pain aux raisins, and its raisins between the turns. */
function raisins(): { path: string; dots: string } {
  let path = '';
  for (let t = 0.6; t <= 5.4 * Math.PI; t += 0.18) {
    const r = 3 + t * 2.75;
    path += `${path ? 'L' : 'M'}${f1(100 + r * Math.cos(t))} ${f1(102 + r * Math.sin(t) * 0.88)}`;
  }
  let dots = '';
  for (let k = 0; k < 9; k++) {
    const t = 2.2 + k * 1.55;
    const r = 7.5 + t * 2.75;
    const x = f1(100 + r * Math.cos(t));
    const y = f1(102 + r * Math.sin(t) * 0.88);
    dots += `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="2.7" transform="rotate(${Math.round(t * 57.3 + 90)} ${x} ${y})"/>`;
  }
  return { path, dots };
}

const R = raisins();

const DEFS = `<defs>
<linearGradient id="g-dough" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FAD48A"/><stop offset=".5" stop-color="#E39A3B"/><stop offset="1" stop-color="#A65B1A"/></linearGradient>
<linearGradient id="g-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCE6B4"/><stop offset=".6" stop-color="#EDB262"/><stop offset="1" stop-color="#C98433"/></linearGradient>
<linearGradient id="g-caramel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3B75A"/><stop offset=".55" stop-color="#C46D18"/><stop offset="1" stop-color="#7D3A0A"/></linearGradient>
<linearGradient id="g-choc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E3B22"/><stop offset="1" stop-color="#34170A"/></linearGradient>
<linearGradient id="g-brioche" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7BE62"/><stop offset=".55" stop-color="#D27A22"/><stop offset="1" stop-color="#8C4210"/></linearGradient>
<radialGradient id="g-shine" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF7E0" stop-opacity=".8"/><stop offset="1" stop-color="#FFF7E0" stop-opacity="0"/></radialGradient>
<radialGradient id="g-shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1A0E05" stop-opacity=".35"/><stop offset="1" stop-color="#1A0E05" stop-opacity="0"/></radialGradient>
</defs>`;

const CROISSANT = `<symbol id="p-croissant" viewBox="0 0 200 200">
<ellipse cx="100" cy="150" rx="78" ry="12" fill="url(#g-shadow)"/>
<g fill="url(#g-dough)" stroke="#7A3F0E" stroke-opacity=".35" stroke-width="1.5">
<ellipse cx="38" cy="130" rx="20" ry="11" transform="rotate(-42 38 130)"/><ellipse cx="162" cy="130" rx="20" ry="11" transform="rotate(42 162 130)"/>
<ellipse cx="62" cy="113" rx="25" ry="23" transform="rotate(-24 62 113)"/><ellipse cx="138" cy="113" rx="25" ry="23" transform="rotate(24 138 113)"/>
<ellipse cx="100" cy="103" rx="31" ry="33"/>
</g>
<g fill="none" stroke="#8A4A12" stroke-opacity=".4" stroke-width="2" stroke-linecap="round"><path d="M84 78 Q78 104 86 130"/><path d="M116 78 Q122 104 114 130"/><path d="M50 100 Q46 116 54 132"/><path d="M150 100 Q154 116 146 132"/></g>
<ellipse cx="97" cy="86" rx="17" ry="10" fill="url(#g-shine)"/>
<ellipse cx="60" cy="100" rx="10" ry="6" fill="url(#g-shine)" transform="rotate(-24 60 100)"/><ellipse cx="140" cy="100" rx="10" ry="6" fill="url(#g-shine)" transform="rotate(24 140 100)"/>
</symbol>`;

const ALMONDS: ReadonlyArray<readonly [number, number, number]> = [
  [86, 84, -20],
  [104, 80, 25],
  [118, 92, -35],
  [92, 100, 10],
  [74, 94, 40],
  [126, 108, -10],
  [60, 106, -30],
  [140, 104, 30],
  [102, 114, -15],
  [80, 114, 20],
  [50, 120, -45],
  [150, 120, 45],
];
const SUGAR: ReadonlyArray<readonly [number, number]> = [
  [95, 76],
  [110, 86],
  [82, 90],
  [98, 92],
  [120, 100],
  [68, 102],
  [132, 96],
  [90, 108],
  [112, 106],
  [56, 112],
  [144, 112],
  [100, 84],
  [76, 80],
  [124, 82],
];

const AMANDES = `<symbol id="p-amandes" viewBox="0 0 200 200">
<use href="#p-croissant" width="200" height="200"/>
<g fill="#F3E3C3" stroke="#C49A5E" stroke-width="1" stroke-opacity=".7">${ALMONDS.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="2.8" transform="rotate(${a} ${x} ${y})"/>`).join('')}</g>
<g fill="#FFFFFF" opacity=".85">${SUGAR.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${(1.1 + (i % 3) * 0.2).toFixed(1)}"/>`).join('')}</g>
</symbol>`;

const PAIN_AU_CHOCOLAT = `<symbol id="p-pac" viewBox="0 0 200 200">
<ellipse cx="100" cy="146" rx="72" ry="11" fill="url(#g-shadow)"/>
<rect x="30" y="96" width="140" height="12" rx="4" fill="url(#g-choc)"/><rect x="33" y="117" width="134" height="12" rx="4" fill="url(#g-choc)"/>
<rect x="42" y="74" width="116" height="68" rx="26" fill="url(#g-dough)" stroke="#7A3F0E" stroke-opacity=".35" stroke-width="1.5"/>
<g fill="none" stroke="#8A4A12" stroke-opacity=".38" stroke-width="2" stroke-linecap="round"><path d="M50 110 Q100 102 150 110"/><path d="M54 128 Q100 122 146 128"/></g>
<path d="M60 81 Q100 73 140 81" fill="none" stroke="#FFF1CF" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="96" cy="89" rx="36" ry="9" fill="url(#g-shine)"/>
</symbol>`;

const KOUIGN = `<symbol id="p-kouign" viewBox="0 0 200 200">
<ellipse cx="100" cy="152" rx="66" ry="11" fill="url(#g-shadow)"/>
<g fill="url(#g-caramel)" stroke="#5E2A08" stroke-opacity=".35" stroke-width="1.5"><rect x="55" y="56" width="90" height="90" rx="24" transform="rotate(45 100 101)"/><rect x="58" y="59" width="84" height="84" rx="22"/></g>
<g fill="none" stroke="#6B3009" stroke-linecap="round" stroke-width="2.2"><path d="M100 101 L70 71 M100 101 L130 71 M100 101 L70 131 M100 101 L130 131" stroke-opacity=".4"/><path d="M100 101 L100 58 M100 101 L143 101 M100 101 L100 144 M100 101 L57 101" stroke-opacity=".2"/></g>
<circle cx="100" cy="101" r="14" fill="#8C4410"/><circle cx="100" cy="101" r="14" fill="url(#g-shine)" opacity=".5"/>
<g fill="#FFE9B8" opacity=".9"><circle cx="80" cy="80" r="1.8"/><circle cx="122" cy="84" r="1.5"/><circle cx="116" cy="120" r="1.8"/><circle cx="82" cy="118" r="1.5"/><circle cx="100" cy="68" r="1.4"/><circle cx="134" cy="102" r="1.6"/><circle cx="66" cy="100" r="1.6"/><circle cx="98" cy="134" r="1.4"/><circle cx="90" cy="92" r="1.2"/><circle cx="111" cy="108" r="1.2"/></g>
<ellipse cx="90" cy="76" rx="22" ry="9" fill="url(#g-shine)"/>
</symbol>`;

const RAISINS = `<symbol id="p-raisins" viewBox="0 0 200 200">
<ellipse cx="100" cy="152" rx="66" ry="11" fill="url(#g-shadow)"/>
<ellipse cx="100" cy="102" rx="54" ry="48" fill="url(#g-light)" stroke="#8A4A12" stroke-opacity=".3" stroke-width="1.5"/>
<path d="${R.path}" fill="none" stroke="#A65B1A" stroke-opacity=".75" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#4A1C2C">${R.dots}</g>
<ellipse cx="86" cy="74" rx="24" ry="9" fill="url(#g-shine)"/>
</symbol>`;

const CHAUSSON = `<symbol id="p-chausson" viewBox="0 0 200 200">
<ellipse cx="100" cy="148" rx="72" ry="11" fill="url(#g-shadow)"/>
<path d="M32 134 C32 84 62 62 100 62 C138 62 168 84 168 134 C132 142 68 142 32 134 Z" fill="url(#g-dough)" stroke="#7A3F0E" stroke-opacity=".35" stroke-width="1.5"/>
<path d="M38 134 C74 142 126 142 162 134" fill="none" stroke="#B9722A" stroke-width="7" stroke-linecap="round" stroke-dasharray=".5 9"/>
<g fill="none" stroke="#7A3F0E" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"><path d="M76 96 Q84 108 88 118"/><path d="M98 88 Q102 102 102 114"/><path d="M122 94 Q118 106 112 116"/></g>
<ellipse cx="92" cy="80" rx="30" ry="9" fill="url(#g-shine)"/>
</symbol>`;

const BRIOCHE = `<symbol id="p-brioche" viewBox="0 0 200 200">
<ellipse cx="100" cy="154" rx="64" ry="11" fill="url(#g-shadow)"/>
<path d="M40 108 C40 90 160 90 160 108 L146 146 C120 154 80 154 54 146 Z" fill="url(#g-brioche)" stroke="#6E3310" stroke-opacity=".35" stroke-width="1.5"/>
<path d="M52 105 L58 147 M68 101 L72 149 M84 99 L86 150 M100 98.5 L100 151 M116 99 L114 150 M132 101 L128 149 M148 105 L142 147" fill="none" stroke="#6E3310" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="84" cy="104" rx="26" ry="7" fill="url(#g-shine)"/>
<circle cx="100" cy="80" r="25" fill="url(#g-brioche)" stroke="#6E3310" stroke-opacity=".35" stroke-width="1.5"/>
<ellipse cx="92" cy="70" rx="11" ry="7" fill="url(#g-shine)"/>
</symbol>`;

export const SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false">${DEFS}${CROISSANT}${AMANDES}${PAIN_AU_CHOCOLAT}${KOUIGN}${RAISINS}${CHAUSSON}${BRIOCHE}</svg>`;
