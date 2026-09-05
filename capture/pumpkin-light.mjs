// THE CLOTH TEST, at the game's own camera.
//
//   node capture/pumpkin-light.mjs --out out/pumpkin-light
//   node capture/pumpkin-light.mjs --at -1.4,-4.6      a different pumpkin
//
// A jack-o'-lantern that is working throws light on whatever is standing next
// to it. That one sentence is the whole check, and it is the check that caught
// this the last two times: renders of a pumpkin on its own always look
// plausible, because the emissive face glows whether or not a single photon is
// leaving the prop.
//
// So the ghost is walked up to a pumpkin in the shipped level and three things
// are written down:
//
//   the frame, at the game camera, so the pools on the ground can be looked at
//   the frame again with every pumpkin light switched off
//   the difference between the two, over the ghost's own pixels
//
// The third one is the measurement. It is what the light does to the CLOTH, in
// levels of 255, and it cannot be argued with: at zero the pumpkin is lighting
// nothing, whatever the face looks like.
//
// It also prints what each pumpkin's lights are actually doing -- where the
// spot is aimed and how bright the lantern is -- because when this number is
// zero, that table says which of the two is wrong.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 700);
const outDir = args.out || 'out/pumpkin-light';
// The classic pumpkin in public/levels/demo.json. Beside it, not on it.
const [px, pz] = String(args.at || '-6.8,-2.4').split(',').map(Number);
const STAND = 1.25;   // how far from the pumpkin the ghost is parked
// IN FRONT OF THE FACE, and it has to be. Both halves of the effect are aimed:
// the beams leave through the three cuts and nothing else, so a ghost parked
// round the back is only ever lit by the lantern and the picture cannot tell a
// mis-aimed spotlight from a working one. demo.json's pumpkins are yawed PI/4
// and pumpkin.js's FACE_YAW is PI/4, so both of them look along +x.
const FACE = { x: 1, z: 0 };

const lab = await openLab({
  width, height, entry: '/lab/',
  // No seed: no seed is what loads the level the site ships.
  query: `game=1&test=1&view=${args.view || 6.5}`,
  readyFlag: '__gameReady', verbose: !!args.verbose,
});
// THE WALK IS RENDERED AT A QUARTER OF THE SIZE. Stepping the game draws a
// frame, a frame here is software-rasterised, and the walk is fifty of them
// against the four that are kept. Nothing about the walk depends on the
// viewport, so it happens small and the canvas is grown again before anything
// is captured.
const SMALL = { w: Math.round(width / 2.2), h: Math.round(height / 2.2) };
await lab.page.evaluate((o) => window.__game.setSize(o.w, o.h), SMALL);
await mkdir(outDir, { recursive: true });

// Walk there. The stick is the same one a player holds, so the ghost arrives
// under its own steam and the cloth is moving the way it moves in play.
const target = { x: px + FACE.x * STAND, z: pz + FACE.z * STAND };
// Twenty steps a second rather than sixty, and it is not a detail: every step
// renders, and a frame on a container's software rasteriser is a second or
// more. The rules substep internally at their own cap, so the walk is the same
// walk; only the number of frames drawn on the way changes.
const arrive = await lab.page.evaluate(async (t) => {
  let last = null;
  for (let i = 0; i < 20 * 8; i++) {
    const g = window.__game.state().ghost;
    const dx = t.x - g.x;
    const dz = t.z - g.z;
    const d = Math.hypot(dx, dz);
    last = { x: g.x, z: g.z, d };
    if (d < 0.15) break;
    // Ease off over the last stride or the ghost sails past and comes back.
    const k = Math.min(1, d / 1.2);
    window.__game.step(1 / 20, { x: (dx / d) * k, y: (dz / d) * k });
  }
  // A moment to settle, so the cloth is hanging rather than mid-swing.
  for (let i = 0; i < 12; i++) window.__game.step(1 / 20, { x: 0, y: 0 });
  const g = window.__game.state().ghost;
  return { ...last, at: { x: g.x, z: g.z } };
}, target);
console.log(`ghost at (${arrive.at.x.toFixed(2)}, ${arrive.at.z.toFixed(2)}), `
  + `${Math.hypot(arrive.at.x - px, arrive.at.z - pz).toFixed(2)} from the pumpkin`);

// Full size for the pictures, and two steps to settle the cloth into it.
await lab.page.evaluate((o) => {
  window.__game.setSize(o.w, o.h);
  for (let i = 0; i < 2; i++) window.__game.step(1 / 20, { x: 0, y: 0 });
}, { w: width, h: height });

// WHICH LIGHTS BELONG TO A PUMPKIN, and it has to be answered without relying
// on anything this fix added, or the before and the after are not the same
// measurement. So: a spot or a point light standing within a body radius of one
// of the level's jack-o'-lanterns. The level's other lights -- the lanterns,
// the fireflies -- are all further away than that from these two spots.
const jacks = String(args.jacks || '-6.8,-2.4;-1.4,-4.6').split(';')
  .map((s) => s.split(',').map(Number));

const lights = await lab.page.evaluate((o) => {
  const at = (m) => ({ x: m.elements[12], y: m.elements[13], z: m.elements[14] });
  const out = [];
  window.__perf.scene.updateMatrixWorld(true);
  window.__perf.scene.traverse((l) => {
    if (!l.isSpotLight && !l.isPointLight) return;
    const w = at(l.matrixWorld);
    if (!o.jacks.some((j) => Math.hypot(w.x - j[0], w.z - j[1]) < 0.9)) return;
    const row = {
      kind: l.isSpotLight ? 'spot' : 'lantern',
      name: l.name || '(unnamed)',
      intensity: +l.intensity.toFixed(3),
      at: [+w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2)],
    };
    if (l.isSpotLight) {
      const t = at(l.target.matrixWorld);
      const d = Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z) || 1;
      row.aim = [+((t.x - w.x) / d).toFixed(2), +((t.y - w.y) / d).toFixed(2), +((t.z - w.z) / d).toFixed(2)];
      row.aimedAt = [+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2)];
      let p = l.target;
      let rooted = false;
      while (p) { if (p === window.__perf.scene) rooted = true; p = p.parent; }
      row.aimInScene = rooted;
    }
    out.push(row);
  });
  return out;
}, { jacks });
for (const l of lights) console.log(' ', JSON.stringify(l));

// The frame, lit.
const lit = await grabPNG(lab.page);
await writeFile(path.join(outDir, 'lit.png'), lit);

// The same frame with every pumpkin light turned off, and the difference over
// the ghost's own pixels.
const measured = await lab.page.evaluate((o) => {
  const scene = window.__perf.scene;
  const camera = window.__perf.camera;
  const canvas = document.getElementById('view');
  const read = () => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  const before = read();
  const off = [];
  const at = (m) => ({ x: m.elements[12], y: m.elements[13], z: m.elements[14] });
  scene.traverse((l) => {
    if (!l.isSpotLight && !l.isPointLight) return;
    const w = at(l.matrixWorld);
    if (!o.jacks.some((j) => Math.hypot(w.x - j[0], w.z - j[1]) < 0.9)) return;
    off.push([l, l.intensity]);
    l.intensity = 0;
  });
  window.__renderer.render(scene, camera);
  const after = read();
  const dark = (() => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c.toDataURL('image/png');
  })();
  for (const [l, i] of off) l.intensity = i;
  window.__renderer.render(scene, camera);

  // Where the ghost is on screen. The camera is orthographic, so this is exact.
  const g = window.__game.state().ghost;
  const v = { x: g.x, y: 0.75, z: g.z };
  const m = camera.matrixWorldInverse.elements;
  const p = camera.projectionMatrix.elements;
  const cam = {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  };
  const ndc = { x: p[0] * cam.x + p[12], y: p[5] * cam.y + p[13] };
  const sx = Math.round((ndc.x * 0.5 + 0.5) * canvas.width);
  const sy = Math.round((0.5 - ndc.y * 0.5) * canvas.height);

  const stat = (x0, y0, x1, y1) => {
    let sum = 0;
    let peak = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(canvas.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(canvas.width, x1); x++) {
        const i = (y * canvas.width + x) * 4;
        const d = Math.max(
          Math.abs(before[i] - after[i]),
          Math.abs(before[i + 1] - after[i + 1]),
          Math.abs(before[i + 2] - after[i + 2]),
        );
        sum += d;
        if (d > peak) peak = d;
        n++;
      }
    }
    return { mean: +(sum / Math.max(1, n)).toFixed(2), peak };
  };
  return {
    ghostPx: [sx, sy],
    cloth: stat(sx - o.box, sy - o.box, sx + o.box, sy + o.box),
    frame: stat(0, 0, canvas.width, canvas.height),
    dark,
  };
}, { box: Math.round(height * 0.11), jacks });

await writeFile(path.join(outDir, 'unlit.png'),
  Buffer.from(measured.dark.slice(measured.dark.indexOf(',') + 1), 'base64'));
await writeFile(path.join(outDir, 'lit.png'), await grabPNG(lab.page));

console.log(`ghost on screen at ${measured.ghostPx.join(',')}`);
console.log(`WHAT THE PUMPKIN PUTS ON THE CLOTH: mean ${measured.cloth.mean} of 255, peak ${measured.cloth.peak}`);
console.log(`over the whole frame:               mean ${measured.frame.mean} of 255, peak ${measured.frame.peak}`);
console.log(`${outDir}/lit.png, ${outDir}/unlit.png`);
await lab.close();
