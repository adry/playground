#!/usr/bin/env node
// Records the three skeletons dancing: the finale, where the things that spent
// the run chasing the player line up and dance.
//
//   node capture/dance-record.mjs --seconds 16.3 --view 2.6
//   node capture/dance-record.mjs --strip 0,1,2,3,4,5,6,7 --n 1 --yaw 1.385
//   node capture/dance-record.mjs --still --view 6.2 --tag small
//
// Same frame-stepped approach as capture/chase-record.mjs, and for the same
// reason: the page is advanced by a FIXED dt regardless of how long the
// software rasteriser takes over a frame, so the clip's timing is exact even
// when a frame costs a second to draw. It matters more here than anywhere else
// in this directory, because the whole subject is a routine on a 118 BPM grid.
// A recorder whose dt drifted with the render time would be a recorder of a
// troupe that cannot keep time.
//
// THE STAGE. This file writes its own page into out/ and points the browser at
// it, rather than depending on a lab page somewhere in the tree. The dance has
// no shipped page of its own: it is a finale the game drops into src/game, and
// the only reason a standalone stage exists at all is so it can be filmed. One
// file that carries its own stage stays runnable; a recorder pointing at a
// scratch harness at the repo root is broken the moment that harness is
// deleted, which is what a scratch harness is for.
//
// The camera, the lights and the shadow fitting below are src/ghost/main.js,
// copied rather than imported because main.js builds a whole ghost scene on
// import. Everything that decides what a frame LOOKS like is the shipped
// scene's, because a routine judged under a different camera is not judged.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 900);
const fps = Number(args.fps || 60);
// Two sixteen-beat phrases at 118 BPM is 16.27 s, which is the natural length:
// long enough that the routine repeats and so reads as a routine.
const seconds = Number(args.seconds || 16.27);
// Half-height of the orthographic box, so smaller is tighter. 2.6 is measured
// off the reference clip the owner sent, not guessed: a skeleton stands 2.5, so
// at 2.6 one fills about half the frame's height and three fill two thirds of
// its width. The shipped pages use 6.2 and that is a different shot.
const view = Number(args.view || 2.6);
const dancers = Number(args.n || 3);
const seed = Number(args.seed || 1);
const spacing = Number(args.spacing || 1.15);
// Two headstones, set well back. On by default because an empty floor reads as
// a studio; off with --stones 0 because a busy floor is worse than an empty one
// and at a tighter framing than 2.6 they start to crowd the line.
const stones = args.stones === undefined ? 1 : Number(args.stones);
// Which way the line faces. PI/4 turns each dancer's own +Z at this project's
// fixed camera, so the default is a line facing the viewer. Off-axis values are
// for the pose strip, where a three quarter view shows the depth of a limb that
// a frontal one flattens.
const yaw = args.yaw === undefined ? Math.PI / 4 : Number(args.yaw);
const tag = args.tag || 'dance';

const stageDir = path.resolve('out/dance-stage');
const stageEntry = '/out/dance-stage/index.html';

const STAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Dance stage</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #b9bec7; }
  #view { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<canvas id="view"></canvas>
<script type="module">
import * as THREE from 'three';
import { createGround } from '/src/ghost/ground.js';
import { createSkeletonRig } from '/src/ghost/props/skeleton/model.js';
import { createDanceTroupe, BPM } from '/src/ghost/props/skeleton/dance.js';
import { createTombstone } from '/src/ghost/props/stones/index.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.get(k) === null ? d : Number(params.get(k)));

// --- renderer, camera and lights: src/ghost/main.js ---------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BACKDROP = new THREE.Color('#b9bec7').convertSRGBToLinear();
const scene = new THREE.Scene();
scene.background = BACKDROP;
scene.fog = new THREE.Fog(BACKDROP, 24, 52);

const VIEW_SIZE = num('view', 2.6);
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
// main.js looks at y 0.75, which is set for a ghost that floats at knee height
// on a frame 12.4 units tall. This frame is 5.2 tall and the subject is a line
// of figures 2.5 tall, so the aim comes up to the middle of a dancer.
//
// Sideways it stays on the line's centre, and that was checked rather than
// assumed. Projecting the troupe's single world bounding box says the routine
// runs 47..892 of 900 px and needs a nudge; projecting every mesh's own box
// instead says 52..853, which is even to within 5 px. The difference is the
// measurement, not the dance: one world-axis box projected by its eight
// corners overstates a silhouette badly under a camera that looks along
// (1, 0.78, 1), and the nudge it asked for would have pushed the line off
// centre for real.
const camTarget = new THREE.Vector3(num('tx', 0), num('ty', 1.12), num('tz', 0));

scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));
const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
key.castShadow = num('shadows', 1) === 1;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.006;
key.shadow.radius = 3;
scene.add(key, key.target);
const LIGHT_DIR = new THREE.Vector3(3.7, 6.0, 2.4).normalize();
const LIGHT_DIST = 26;
const LIGHT_OFFSET = LIGHT_DIR.clone().multiplyScalar(LIGHT_DIST);
const CAST_HEIGHT = 3.0;

const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
rim.position.set(-4, 2.5, -3);
scene.add(rim);

// main.js's fitShadowToView, verbatim in everything that matters: the shadow
// camera is fitted to the ground quad the view frustum actually covers. At view
// 2.6 the fixed -8..8 box main.js started with would waste almost all of a 2048
// map on floor that is nowhere near the frame, and the dancers' shadows are
// half of what sells the bounce.
function fitShadowToView(aspect) {
  const probe = new THREE.OrthographicCamera(
    -VIEW_SIZE * aspect, VIEW_SIZE * aspect, VIEW_SIZE, -VIEW_SIZE, 0.1, 100,
  );
  probe.position.copy(CAM_DIR).multiplyScalar(20);
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld(true);
  probe.updateProjectionMatrix();
  const dir = CAM_DIR.clone().negate();

  // A Camera, not an Object3D: Object3D.lookAt points +Z at the target while a
  // camera points -Z at it, so a plain Object3D flips the depth axis here.
  const rig = new THREE.Camera();
  rig.position.copy(LIGHT_OFFSET);
  rig.lookAt(0, 0, 0);
  rig.updateMatrixWorld(true);
  const toLight = rig.matrixWorld.clone().invert();

  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      corner.set(sx, sy, -1).unproject(probe);
      const onGround = corner.clone().addScaledVector(dir, -corner.y / dir.y);
      for (const h of [0, CAST_HEIGHT]) {
        box.expandByPoint(new THREE.Vector3(onGround.x, h, onGround.z).applyMatrix4(toLight));
      }
    }
  }
  const c = key.shadow.camera;
  c.left = box.min.x; c.right = box.max.x;
  c.bottom = box.min.y; c.top = box.max.y;
  c.near = Math.max(0.05, -box.max.z - CAST_HEIGHT);
  c.far = -box.min.z + CAST_HEIGHT;
  c.updateProjectionMatrix();
}

function resize(w, h) {
  const aspect = w / h;
  camera.left = -VIEW_SIZE * aspect;
  camera.right = VIEW_SIZE * aspect;
  camera.top = VIEW_SIZE;
  camera.bottom = -VIEW_SIZE;
  camera.updateProjectionMatrix();
  camera.position.copy(camTarget).addScaledVector(CAM_DIR, 20);
  camera.lookAt(camTarget);
  key.position.copy(camTarget).setY(0).add(LIGHT_OFFSET);
  key.target.position.copy(camTarget).setY(0);
  key.target.updateMatrixWorld();
  fitShadowToView(aspect);
  renderer.setSize(w, h, false);
}

// --- the floor ----------------------------------------------------------------
scene.add(createGround({ fadeStart: 60, fadeEnd: 260 }));

// Two headstones, set back behind the line. Placed in SCREEN coordinates and
// converted, because "behind them and out of the way" is a statement about the
// frame and not about world x and z: screen-right is (x - z) / sqrt(2) and
// screen-up is -(x + z) / sqrt(2).
//
// Both numbers are tighter than they look like they should be. The frame is
// only 5.2 units wide, so a stone at screen-right 2.7 is cut in half by the
// edge, which reads as a mistake rather than as a graveyard; and the ground
// runs off the top of the frame at 7.0 units back, so "well behind" has to mean
// about 4. At 4 back a stone's base sits just above the dancers' heads and its
// top well clear of them, which is the whole of what these are for.
if (num('stones', 1)) {
  const K = Math.SQRT1_2;
  const atScreen = (right, up) => [(right - up) * K, (-up - right) * K];
  for (const s of [
    { v: 'cross', right: -1.9, up: 4.0, yaw: Math.PI / 4 - 0.30, seed: 3 },
    { v: 'gothic', right: 2.0, up: 4.4, yaw: Math.PI / 4 + 0.42, seed: 9 },
  ]) {
    const [x, z] = atScreen(s.right, s.up);
    const st = createTombstone({ variant: s.v, seed: s.seed });
    st.group.position.set(x, 0, z);
    st.group.rotation.y = s.yaw;
    scene.add(st.group);
  }
}

// --- the cast -------------------------------------------------------------------
const rigs = [];
for (let i = 0; i < num('n', 3); i++) {
  const rig = createSkeletonRig();
  scene.add(rig.group);
  rigs.push(rig);
}
const troupe = num('bind', 0) ? { update() {}, metrics: () => ({ maxSlip: 0, maxSlipLoop: 0, maxShort: 0 }) } : createDanceTroupe({
  rigs,
  scene,
  seed: num('seed', 1),
  spacing: num('spacing', 1.15),
  yaw: num('yaw', Math.PI / 4),
});
if (num('bind', 0)) { rigs.forEach((r, i) => { r.group.position.set((i - 1) * 1.15, 0, 0); r.group.rotation.y = num('yaw', Math.PI / 4); }); }

let clock = 0;
// The simulation, with no draw in it. seek() below runs hundreds of these, and
// a software rasterised draw of this scene costs the better part of a second
// against about five microseconds for the springs.
function advance(dt) { clock += dt; troupe.update(dt); }

function step(dt = 1 / 60) {
  advance(dt);
  renderer.render(scene, camera);
}

// Jump to a beat of the loop. It STEPS rather than setting a clock, at the same
// dt the recorder uses, because a pose sampled by teleporting the clock is not
// the pose the routine actually reaches: at any instant half of what is on
// screen is a spring still on its way somewhere. The 4 is the wind-up, which is
// played once before the loop and is not part of it.
function seek(beats) {
  const target = (4 + beats) * (60 / BPM);
  while (clock < target) advance(1 / 60);
  renderer.render(scene, camera);
}

window.__dance = {
  setSize(w, h) {
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    resize(w, h);
  },
  time(n = 2) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.render(scene, camera);
    return +((performance.now() - t0) / n).toFixed(1);
  },
  step,
  seek,
  clock: () => clock,
  metrics: () => troupe.metrics(),
  stats: () => ({
    triangles: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
    programs: renderer.info.programs ? renderer.info.programs.length : 0,
  }),
  // Where the troupe lands in the frame, in pixels, so the framing is measured
  // and not eyeballed. Uses each rig's world bounding box, which is what the
  // silhouette is bounded by, rather than projecting every bone vertex.
  frame(w, h) {
    const box = new THREE.Box3();
    for (const r of rigs) box.expandByObject(r.group);
    const xs = [];
    const ys = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(camera);
          xs.push((v.x * 0.5 + 0.5) * w);
          ys.push((0.5 - v.y * 0.5) * h);
        }
      }
    }
    return {
      pctW: +(((Math.max(...xs) - Math.min(...xs)) / w) * 100).toFixed(1),
      pctH: +(((Math.max(...ys) - Math.min(...ys)) / h) * 100).toFixed(1),
      left: Math.round(Math.min(...xs)), right: Math.round(Math.max(...xs)),
      top: Math.round(Math.min(...ys)), bottom: Math.round(Math.max(...ys)),
    };
  },
};
window.__dance.setSize(canvas.clientWidth || 900, canvas.clientHeight || 900);
step(1 / 60);
window.__danceReady = true;
</script>
</body>
</html>
`;

await mkdir(stageDir, { recursive: true });
await writeFile(path.join(stageDir, 'index.html'), STAGE);

const query = [
  `view=${view}`, `n=${dancers}`, `seed=${seed}`,
  `spacing=${spacing}`, `stones=${stones}`, `yaw=${yaw}`,
  args.ty === undefined ? '' : `ty=${args.ty}`, args.shadows === undefined ? '' : `shadows=${args.shadows}`, args.bind === undefined ? '' : `bind=${args.bind}`,
].filter(Boolean).join('&');

const lab = await openLab({
  width, height, entry: stageEntry, query,
  readyFlag: '__danceReady', verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__dance.setSize(o.w, o.h), { w: width, h: height });
console.log(`draw      ${await lab.page.evaluate(() => window.__dance.time(2))} ms/frame`);

async function report() {
  const m = await lab.page.evaluate(() => window.__dance.metrics());
  const s = await lab.page.evaluate(() => window.__dance.stats());
  const f = await lab.page.evaluate((o) => window.__dance.frame(o.w, o.h), { w: width, h: height });
  console.log(`  slip      max ${m.maxSlip} over the whole run, ${m.maxSlipLoop} in the loop; IK shortfall ${m.maxShort}`);
  console.log(`  scene     ${s.triangles} triangles, ${s.calls} draw calls, ${s.programs} programs`);
  console.log(`  framing   ${f.pctW}% of width, ${f.pctH}% of height (x ${f.left}..${f.right}, y ${f.top}..${f.bottom})`);
}

if (args.strip !== undefined) {
  // A strip of frames one beat apart, so the poses can be judged as poses.
  // Beats only ever increase, so the whole strip costs one pass of the springs.
  const beats = args.strip === true
    ? Array.from({ length: 16 }, (_, i) => i)
    : String(args.strip).split(',').map(Number);
  const outDir = args.out || 'out/dance';
  await mkdir(outDir, { recursive: true });
  for (const b of beats) {
    await lab.page.evaluate((x) => window.__dance.seek(x), b);
    const file = path.join(outDir, `${tag}-b${String(b).replace('.', '_')}.png`);
    await writeFile(file, await grabPNG(lab.page));
    console.log(`  ${file}`);
  }
  await report();
} else if (args.still) {
  const outDir = args.out || 'out/dance';
  await mkdir(outDir, { recursive: true });
  await lab.page.evaluate((x) => window.__dance.seek(x), Number(args.at ?? 0));
  const file = path.join(outDir, `${tag}.png`);
  await writeFile(file, await grabPNG(lab.page));
  console.log(`  ${file}`);
  await report();
} else {
  const outFile = args.out || `out/${tag}-${width}x${height}.mp4`;
  await mkdir(path.dirname(outFile), { recursive: true });
  const frames = Math.round(seconds * fps);
  console.log(`${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames - view ${view} - ${dancers} dancers`);

  const ff = spawn(ffmpegPath, [
    '-y',
    '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-maxrate', '14M', '-bufsize', '28M',
    '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-shortest',
    outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d.toString(); });
  const done = new Promise((res, rej) => {
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}\n${ffErr.slice(-1500)}`))));
  });

  // The wind-up is played once and is not part of the loop, so the clip starts
  // at beat 0 of the routine with the figures already in their stance.
  await lab.page.evaluate(() => window.__dance.seek(0));

  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await lab.page.evaluate((dt) => window.__dance.step(dt), 1 / fps);
    const png = await grabPNG(lab.page);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 20 === 0 || f === frames - 1) {
      const per = (Date.now() - started) / 1000 / (f + 1);
      process.stdout.write(`\r  frame ${f + 1}/${frames}  ${per.toFixed(2)}s/frame  eta ${Math.round(per * (frames - f - 1))}s   `);
    }
  }
  ff.stdin.end();
  await done;
  console.log(`\n  -> ${outFile}`);
  await report();
}

await lab.close();
await rm(stageDir, { recursive: true, force: true });
