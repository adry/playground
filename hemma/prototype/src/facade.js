// Each listing gets a drawn facade in the style of its building, so the feed
// has pictures without photos. The flat for sale has its windows lit.
// Paint colours are the buildings' own; sky, ground and glass follow the theme
// through classes styled in CSS.

const PAINT = {
  stenstad: ['#D9A441', '#E3C99A', '#D98B6A', '#EBD58C', '#B9C2A4', '#C2694A', '#E7B9A6', '#D6C3A0'],
  funkis: ['#EEEBE3', '#EBDDA2', '#E3C27E', '#D9D8CF', '#E8CFC0', '#CFD8CC'],
  modern: ['#E9EAE6', '#C9CDCB', '#5E6669', '#D7D2C8', '#2F3A3E'],
  villa: ['#8E2B1F', '#8E2B1F', '#E3C46A', '#E9E4D6', '#9FB3B9'],
  radhus: ['#A5553A', '#7D8F9B', '#D9C7A3', '#8E2B1F'],
};
const ROOF = { copper: '#6E9F8F', tin: '#3B4045', tile: '#9C4A34' };
const FRAME = '#F7F4EC';
const LIT = '#F2C14E';
const DOOR = '#4A3226';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const rect = (x, y, w, h, fill, extra = '') =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ${fill.startsWith('.') ? `class="${fill.slice(1)}"` : `fill="${fill}"`} ${extra}/>`;

function win(x, y, w, h, lit) {
  return `${rect(x - 0.8, y - 0.8, w + 1.6, h + 1.6, FRAME)}${rect(x, y, w, h, lit ? LIT : '.f-glass')}${rect(x + w / 2 - 0.3, y, 0.6, h, FRAME)}`;
}

function sideBuilding(r, x, w, top) {
  const paint = pick(r, PAINT.stenstad);
  let s = rect(x, top, w, 92 - top, shade(paint, -0.06), 'opacity="0.9"');
  const rows = Math.floor((92 - top - 14) / 12);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < 2; c++) {
      s += rect(x + 4 + c * (w / 2 - 1), top + 6 + i * 12, 6, 7, '.f-glass', 'opacity="0.75"');
    }
  }
  return s;
}

function stenstad(r, l) {
  const paint = pick(r, PAINT.stenstad);
  const roof = r() < 0.55 ? ROOF.copper : ROOF.tin;
  const n = l.floors;
  const x0 = 32, x1 = 128, ground = 92, roofH = 10, gfH = 15;
  const upperH = (ground - 14 - roofH - gfH) / (n - 1);
  const top = ground - gfH - upperH * (n - 1);
  let s = sideBuilding(r, -2, 34, top + 6 + r() * 10) + sideBuilding(r, 128, 34, top + r() * 12);
  s += `<polygon points="${x0 - 1},${top} ${x0 + 7},${top - roofH} ${x1 - 7},${top - roofH} ${x1 + 1},${top}" fill="${roof}"/>`;
  for (let d = 0; d < 3; d++) {
    const dx = x0 + 22 + d * 22;
    s += rect(dx, top - roofH + 2, 8, 7, shade(roof, -0.15)) + rect(dx + 2, top - roofH + 3.5, 4, 4, '.f-glass');
  }
  s += rect(x0, top, x1 - x0, ground - top, paint);
  s += rect(x0 - 1.5, top - 1.5, x1 - x0 + 3, 3, shade(paint, -0.22));
  s += rect(x0, ground - gfH, x1 - x0, gfH, shade(paint, -0.1));
  s += rect(x0, ground - gfH - 1, x1 - x0, 1.5, shade(paint, -0.25));
  const cols = 5, ww = 8, gap = (x1 - x0 - cols * ww) / (cols + 1);
  for (let f = 1; f < n; f++) {
    const y = ground - gfH - upperH * f + upperH * 0.22;
    const lit = l.floor === f + 1;
    for (let c = 0; c < cols; c++) {
      const x = x0 + gap + c * (ww + gap);
      s += win(x, y, ww, upperH * 0.56, lit && (c === 1 || c === 2));
      if (f === n - 1 || f === 1) s += rect(x - 1.5, y - 2.4, ww + 3, 1.2, shade(paint, -0.2));
    }
  }
  const mid = (x0 + x1) / 2;
  s += `<path d="M${mid - 5} ${ground} v-9 a5 5 0 0 1 10 0 v9 z" fill="${DOOR}"/>`;
  for (const c of [0, 1, 3, 4]) {
    const x = x0 + gap + c * (ww + gap);
    s += win(x, ground - gfH + 3, ww, 8, l.floor === 1 && (c === 1 || c === 3));
  }
  return s;
}

function funkis(r, l) {
  const paint = pick(r, PAINT.funkis);
  const n = l.floors;
  const x0 = 22, x1 = 138, ground = 92, fh = 13;
  const top = ground - n * fh - 4;
  let s = rect(x0, top, x1 - x0, ground - top, paint);
  s += rect(x0 - 1, top - 2, x1 - x0 + 2, 2.5, shade(paint, -0.18));
  const stair = (x0 + x1) / 2 - 3;
  s += rect(stair, top + 6, 6, ground - top - 18, '.f-glass');
  for (let f = 0; f < n; f++) {
    const y = ground - (f + 1) * fh + 3;
    const lit = l.floor === f + 1;
    const xs = [x0 + 8, x0 + 28, stair + 14, stair + 34];
    xs.forEach((x, i) => {
      s += rect(x - 0.6, y - 0.6, 15.2, 7.2, FRAME) + rect(x, y, 14, 6, lit && i < 2 ? LIT : '.f-glass');
    });
    if (f > 0) {
      const bx = x1 - 26;
      s += rect(bx, y + 6.4, 20, 1.6, shade(paint, -0.3));
      for (let k = 0; k <= 5; k++) s += rect(bx + k * 4, y + 2.6, 0.6, 4, shade(paint, -0.35));
      s += rect(bx, y + 2.4, 20, 0.6, shade(paint, -0.35));
    }
  }
  s += rect(stair - 1, ground - 10, 8, 10, DOOR);
  s += `<circle cx="12" cy="76" r="11" class="f-tree"/>${rect(11, 80, 2, 12, DOOR)}`;
  return s;
}

function modern(r, l) {
  const paint = pick(r, PAINT.modern);
  const accent = '#B07A4A';
  const n = l.floors;
  const x0 = 18, x1 = 142, ground = 92;
  const fh = Math.min(12, 74 / n);
  const top = ground - n * fh;
  let s = rect(x0, top, x1 - x0, ground - top, paint);
  s += rect(x0 + 70, top - fh, x1 - x0 - 70, fh, shade(paint, -0.08));
  s += rect(x0 + 52, top, 12, ground - top, accent);
  for (let f = 0; f < n; f++) {
    const y = ground - (f + 1) * fh + 1.5;
    const lit = l.floor === f + 1;
    for (let c = 0; c < 3; c++) s += rect(x0 + 5 + c * 16, y, 13, fh - 4, lit && c < 2 ? LIT : '.f-glass');
    for (let c = 0; c < 4; c++) s += rect(x0 + 70 + c * 13.5, y, 11, fh - 4, '.f-glass');
    s += rect(x0 + 68, y + fh - 4.6, 56, 2.4, '.f-glass', 'opacity="0.55"');
    s += rect(x0 + 68, y + fh - 2.6, 56, 0.8, shade(paint, -0.35));
  }
  s += rect(x0 + 54, ground - 9, 8, 9, shade(accent, -0.4));
  return s;
}

function villa(r, l) {
  const paint = pick(r, PAINT.villa);
  const roof = paint === '#8E2B1F' ? ROOF.tin : pick(r, [ROOF.tin, ROOF.tile]);
  const x0 = 46, x1 = 118, ground = 86, wallTop = 50, peak = 22;
  let s = rect(0, 80, 160, 20, '.f-lawn');
  s += `<circle cx="26" cy="58" r="15" class="f-tree"/><circle cx="16" cy="68" r="10" class="f-tree"/>${rect(24, 66, 3, 20, DOOR)}`;
  s += `<circle cx="140" cy="66" r="10" class="f-tree"/>${rect(139, 72, 2, 14, DOOR)}`;
  s += rect(x0, wallTop, x1 - x0, ground - wallTop, paint);
  for (let k = 0; k < 18; k++) s += rect(x0 + 2 + k * 4, wallTop + 1, 0.5, ground - wallTop - 1, shade(paint, -0.15), 'opacity="0.7"');
  s += rect(x0, wallTop, 2.2, ground - wallTop, FRAME) + rect(x1 - 2.2, wallTop, 2.2, ground - wallTop, FRAME);
  s += rect(x1 - 26, peak + 6, 6, 18, shade(roof, 0.15));
  s += `<polygon points="${x0 - 6},${wallTop + 1} ${(x0 + x1) / 2},${peak} ${x1 + 6},${wallTop + 1}" fill="${roof}"/>`;
  s += win((x0 + x1) / 2 - 5, 34, 10, 10, true);
  for (const [x, y] of [[x0 + 8, 56], [x1 - 20, 56], [x0 + 8, 70]]) {
    s += win(x, y, 12, 10, false) + rect(x, y + 4.7, 12, 0.6, FRAME);
  }
  s += rect(x1 - 20, 68, 10, 18, FRAME) + rect(x1 - 18.5, 69.5, 7, 16.5, DOOR);
  s += rect(x1 - 23, 85, 16, 2, shade(paint, -0.4));
  return s;
}

function radhus(r, l) {
  const paint = pick(r, PAINT.radhus);
  const roof = pick(r, [ROOF.tin, ROOF.tile]);
  const ground = 88, w = 36, x0 = 26, wallTop = 52;
  let s = rect(0, 82, 160, 18, '.f-lawn');
  s += `<polygon points="${x0 - 5},${wallTop + 1} ${x0 + 8},34 ${x0 + 3 * w - 8},34 ${x0 + 3 * w + 5},${wallTop + 1}" fill="${roof}"/>`;
  for (let u = 0; u < 3; u++) {
    const x = x0 + u * w;
    const p = u === 2 ? shade(paint, 0.08) : u === 1 ? shade(paint, -0.05) : paint;
    s += rect(x, wallTop, w, ground - wallTop, p);
    s += rect(x, wallTop, 0.8, ground - wallTop, shade(paint, -0.3));
    s += win(x + 5, wallTop + 6, 10, 9, u === 2) + win(x + 21, wallTop + 6, 10, 9, false);
    s += win(x + 5, wallTop + 22, 10, 9, false);
    s += rect(x + 21, wallTop + 20, 9, ground - wallTop - 20, DOOR);
    s += rect(x + 2, ground, w - 4, 1.5, shade(paint, -0.4));
  }
  s += `<circle cx="10" cy="72" r="10" class="f-tree"/><circle cx="148" cy="74" r="9" class="f-tree"/>`;
  return s;
}

const DRAW = { stenstad, funkis, modern, villa, radhus };

export function facadeSVG(listing, className = '') {
  const r = rng(listing.seed);
  const body = DRAW[listing.style](r, listing);
  return `<svg class="facade ${className}" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${rect(0, 0, 160, 100, '.f-sky')}${body}${rect(0, 92, 160, 8, '.f-ground')}</svg>`;
}
