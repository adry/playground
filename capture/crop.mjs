// Zoom into a region of a rendered PNG so a detail can actually be looked at.
//
//   node capture/crop.mjs <src.png> <out.png> <x> <y> <w> <h> <outWidth>
//
// x/y/w/h are pixels in the source image. Renders are captured large and
// cropped rather than captured small, because a detail judged at 40px is a
// detail not judged at all.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [src, out, x, y, w, h, outW] = process.argv.slice(2);
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const outH = Math.round(outW * h / w);
await page.setViewportSize({ width: +outW, height: outH });
await page.setContent(`<style>body{margin:0}</style><canvas id="c" width="${outW}" height="${outH}"></canvas>`);
await page.evaluate(({ b64, x, y, w, h, outW, outH }) => new Promise(r => {
  const img = new Image();
  img.onload = () => { const c = document.getElementById('c').getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, x, y, w, h, 0, 0, outW, outH); r(); };
  img.src = 'data:image/png;base64,' + b64;
}), { b64, x: +x, y: +y, w: +w, h: +h, outW: +outW, outH });
await page.screenshot({ path: out });
await browser.close();
console.log(out, outW, outH);
