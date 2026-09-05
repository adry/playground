import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
for (const f of process.argv.slice(2)) {
  const b64 = fs.readFileSync(f).toString('base64');
  const r = await page.evaluate(({ b64 }) => new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const L = (x, y) => { const i = (y * img.width + x) * 4; return (d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; };
      // background/floor sits around 0.62-0.70; iron is well under 0.45.
      const rows = [];
      for (let y = 0; y < img.height; y++) {
        let n = 0, lo = 1, hi = 0, x0 = -1, x1 = -1;
        for (let x = 0; x < img.width; x++) {
          const v = L(x, y);
          if (v < 0.46) { n++; if (x0 < 0) x0 = x; x1 = x; if (v < lo) lo = v; if (v > hi) hi = v; }
        }
        if (n) rows.push({ y, n, x0, x1, lo: +lo.toFixed(3), hi: +hi.toFixed(3) });
      }
      return rows;
    };
    img.src = 'data:image/png;base64,' + b64;
  }), { b64 });
  // The post band: the last third of the dark rows, i.e. below the plate.
  const y0 = r[0].y, y1 = r[r.length - 1].y;
  const band = r.filter((q) => q.y > y0 + (y1 - y0) * 0.62);
  const wid = band.map((q) => q.x1 - q.x0 + 1);
  const con = band.map((q) => +(q.hi - q.lo).toFixed(3));
  console.log(f.split('/').pop().padEnd(22),
    'plate+post rows', String(y1 - y0 + 1).padStart(3),
    '| post px wide min/med/max',
    Math.min(...wid), wid.sort((a, b) => a - b)[wid.length >> 1], Math.max(...wid),
    '| post lit-to-shade spread med', con.sort((a, b) => a - b)[con.length >> 1],
    '| darkest', Math.min(...band.map((q) => q.lo)));
}
await browser.close();
