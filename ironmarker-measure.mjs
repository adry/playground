// Scratch: read real pixels off a render. Deleted with the lab.
//
//   node ironmarker-measure.mjs <png> <x0> <w> <y0> <y1>
//
// For every row in [y0, y1) inside the column window [x0, x0+w), prints how
// many pixels are darker than the floor, and the darkest and lightest of them.
// That is the only honest way to answer "how thin can the post be": at scene
// size a post is four pixels and an eye on a 4x crop cannot count them.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto('data:text/html,<canvas id=c></canvas>');
const A = process.argv.slice(2);
for (let k = 0; k < A.length; k += 5) {
  const f = A[k], x0 = +A[k + 1], w = +A[k + 2], y0 = +A[k + 3], y1 = +A[k + 4];
  const b64 = fs.readFileSync(f).toString('base64');
  const rows = await page.evaluate(async (o) => {
    const img = new Image();
    img.src = o.src;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const out = [];
    for (let y = o.y0; y < o.y1; y++) {
      const d = g.getImageData(o.x0, y, o.w, 1).data;
      const L = [];
      for (let i = 0; i < o.w; i++) L.push(Math.round(((d[i * 4] * 0.30 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255) * 99));
      // The floor is whatever the two ends of the window are; the iron is
      // everything a clear margin under it.
      const floor = Math.max(L[0], L[o.w - 1]);
      const inside = L.filter((v) => v < floor - 32);
      out.push([y, inside.length, inside.length ? Math.min(...inside) : 0, inside.length ? Math.max(...inside) : 0, floor, Math.min(...L), Math.max(...L)]);
    }
    return out;
  }, { src: 'data:image/png;base64,' + b64, x0, w, y0, y1 });
  const n = rows.map((r) => r[1]);
  const lo = rows.filter((r) => r[1]).map((r) => r[2]);
  const hi = rows.filter((r) => r[1]).map((r) => r[3]);
  console.log(path.basename(f).padEnd(16),
    'rows', rows.length,
    '| iron px/row min', Math.min(...n), 'median', n.slice().sort((a, b) => a - b)[n.length >> 1], 'max', Math.max(...n),
    '| empty rows', n.filter((v) => v === 0).length,
    '| darkest', Math.min(...lo), 'lightest', Math.max(...hi), 'floor', rows[0][4],
    '| whole window min', Math.min(...rows.map((r) => r[5])), 'max', Math.max(...rows.map((r) => r[6])));
  console.log('    per row:', n.join(''));
}
await browser.close();
