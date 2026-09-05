// THE WORLD VIEWER. /lab/?world=1
//
// A graveyard you can walk around in, with no game in it. No skeletons, no
// score, no lives, nothing that can end. It exists for one job: to look at how
// the endless world places things, so the placement rules can be argued from
// what is actually on screen rather than from a plan view or a table.
//
// It is therefore deliberately NOT the game page. `scene.js` is the game and
// has to be honest about cost and rules; this one is allowed to show you the
// fence lines and the firefly spacing and let you fly out to a hundred units,
// because those are the things you need in order to judge a layout.
//
// Controls, all on screen in the hint line:
//
//   drag / arrows / wasd   move the ghost, which is also the streaming centre
//   scroll                 zoom, 6 to 60
//   g                      the placement overlay: fence runs, gates, firefly
//                          links, chunk edges
//   f                      follow on and off. Off lets the camera be dragged
//                          away from the ghost to look at somewhere else
//   r                      a new seed, so a bad arrangement can be checked for
//                          being this seed's fault or the rules' fault. It does
//                          nothing when a level came out of a file: there is no
//                          seed to change and nothing to go back to.
//
// A LEVEL FROM A FILE. ?level=<url> loads a hand-made level written by the
// editor at /editor/ instead of generating one:
//
//   /lab/?world=1&level=/levels/mine.json
//
// The file answers exactly the queries the generator answers, so nothing below
// this line knows the difference; see src/game/level/format.js. This is also
// the ONLY door between the editor and a page that ships, and it needs a URL
// typed by hand, which is the point.
//
// STREAMING. The world is infinite and the renderer is not, so props exist only
// within RADIUS of the ghost and are thrown away beyond it. The one thing that
// must never happen is a hitch when a chunk arrives, so a chunk's props are
// built a few at a time across frames rather than all at once. See pump().

import * as THREE from 'three';
import { createGround } from '../ghost/ground.js';
import { Ghost } from '../ghost/ghost.js';
import { Input } from '../ghost/input.js';
import { createWorld } from './world/index.js';
import { createFencePanel } from '../ghost/props/fence/panel.js';
import { createWall, createVoid } from '../ghost/props/fence/wall.js';
import { createGate } from '../ghost/props/fence/gate.js';
import { createFireflies } from '../ghost/props/fireflies.js';
// The prop switch this file used to carry lives here now, so the editor at
// /editor/ builds a level the same way this page does. See level/build.js.
import { buildLevelProp } from './level/build.js';
import { loadLevelFrom } from './level/format.js';
import { createGroundCover } from './level/groundcover.js';

// How far from the ghost props exist. 46 covers a screen and a half at the
// widest useful zoom, so nothing pops in inside the frame at normal play, and
// zooming further out is honest about it: you SEE the edge of what is built,
// which when you are judging a layout is information rather than a bug.
const RADIUS = 46;
// Props built per frame while catching up. Measured rather than picked: a
// headstone is the expensive one at about 6 ms with its texture bake, so eight
// is roughly half a frame's budget at 60 Hz and the queue drains in under a
// second at a walk.
const BUILD_BUDGET = 8;

export async function startViewer({ canvas, params }) {
  const testMode = params.get('test') === '1';
  let seed = Number(params.get('seed')) || 1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(testMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9bec7').convertSRGBToLinear();
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));

  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const LIGHT_OFFSET = new THREE.Vector3(3.7, 6.0, 2.4).normalize().multiplyScalar(30);

  const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const camTarget = new THREE.Vector3(0, 0.75, 0);
  let view = Number(params.get('view')) > 0 ? Number(params.get('view')) : 14;
  let follow = true;
  let shadowTexel = 0.02;

  function placeCamera() {
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, 90);
    camera.lookAt(camTarget);
    const snap = Math.max(1e-4, shadowTexel);
    key.target.position.set(
      Math.round(camTarget.x / snap) * snap, 0, Math.round(camTarget.z / snap) * snap,
    );
    key.position.copy(key.target.position).add(LIGHT_OFFSET);
    key.target.updateMatrixWorld();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.left = -view * aspect; camera.right = view * aspect;
    camera.top = view; camera.bottom = -view;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    // The shadow box tracks the zoom, or zooming out drops every shadow past
    // the old box and the graveyard goes flat.
    const reach = Math.min(70, view * Math.max(1, aspect) * 1.7);
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach;
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach;
    key.shadow.camera.updateProjectionMatrix();
    shadowTexel = (2 * reach) / 2048;
  }

  const ground = createGround({ fadeStart: 90, fadeEnd: 400 });
  scene.add(ground);

  // --- the world -------------------------------------------------------------
  // A LEVEL FROM A FILE, or a level from a seed.
  //
  //   /lab/?world=1                      the generator, as before
  //   /lab/?world=1&level=/levels/a.json a hand-made level from /editor/
  //
  // This is the ONLY way an authored level reaches a page that ships. The
  // editor writes to its own localStorage and to a file the owner downloads;
  // nothing here reads either, so a level in progress cannot appear on a
  // shipped page by accident. The URL has to be typed.
  const levelUrl = params.get('level');
  let world = levelUrl ? await loadLevelFrom(levelUrl) : createWorld({ seed });

  // A hand-made level can carry painted ground cover, which the generator has
  // no equivalent of. It is one static group; see level/groundcover.js.
  let cover = null;
  function refreshCover() {
    if (cover) { scene.remove(cover.group); cover.dispose(); cover = null; }
    if (!world.ground) return;
    cover = createGroundCover({
      ground: world.ground, seed: world.seed || seed, kerbs: world.ground.kerbs || null,
    });
    scene.add(cover.group);
  }
  refreshCover();

  // THE PERIMETER IS A WALL, and only for a level that came out of a file.
  //
  // The streaming loop below draws every barrier as fence panels, which is what
  // this page has always done and is why a generated arena's perimeter reads as
  // a very long picket fence. That is left exactly as it was: this page ships,
  // it is being worked on for render cost, and changing what a generated world
  // looks like is not this change's business.
  //
  // A FILE is different. A level file carries the wall's variant and its style
  // transitions, the owner picks both in the editor, and a page that draws them
  // as pickets is a page where that choice does nothing. So when a level is
  // loaded, the real wall is built once from the file's own closed loop and the
  // wall barriers are skipped in the panel loop below.
  let walled = null;
  if (levelUrl && world.doc?.wall) {
    const spec = world.doc.wall;
    const made = createWall({
      seed: 1,
      points: spec.points.map(([x, z]) => ({ x, z })),
      closed: true,
      variant: spec.variant,
      styles: spec.styles && spec.styles.length ? spec.styles : null,
    });
    const b = world.bounds;
    const dusk = createVoid({
      bounds: {
        x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
        halfX: (b.maxX - b.minX) / 2, halfZ: (b.maxZ - b.minZ) / 2,
      },
    });
    walled = new THREE.Group();
    walled.add(made.group, dusk.group);
    scene.add(walled);
  }

  // What is currently built, by the world's own stable ids, so a prop is never
  // built twice and never lost. The world guarantees an id is deterministic in
  // the seed and the chunk, which is what makes this a set membership problem
  // rather than a diff.
  let live = new Map();
  let queue = [];
  let holeCount = 0;

  // The switch moved to level/build.js so the editor cannot drift from it. The
  // one thing that stays here is the floor's four-cut budget, because it is a
  // property of THIS page's floor and not of the prop: past four, the pit is
  // simply not registered and reads as a filled grave, which is the tidy
  // fallback hole.js documents rather than a missing prop.
  function buildProp(p) {
    return buildLevelProp(p, { allowCut: holeCount < 4 });
  }

  function add(id, made, x, z, yaw) {
    if (!made) return;
    made.group.position.set(x, 0, z);
    made.group.rotation.y = yaw || 0;
    scene.add(made.group);
    if (made.__wantsCut && made.registerWith) { made.registerWith(ground); holeCount += 1; }
    live.set(id, made);
  }

  // One frame's worth of building. Everything expensive happens here and it is
  // capped, which is the difference between a world that streams and a world
  // that stutters every time you cross a chunk edge.
  function pump() {
    let n = 0;
    // Nearest first, so what is still queued is behind you rather than in the
    // middle of the frame. A full sort every call would be wasteful, so it only
    // runs when there is a real backlog.
    if (queue.length > BUILD_BUDGET) {
      const cx = ghost.pos.x, cz = ghost.pos.z;
      queue.sort((a, b) => (
        ((a.x - cx) ** 2 + (a.z - cz) ** 2) - ((b.x - cx) ** 2 + (b.z - cz) ** 2)
      ));
    }
    while (queue.length && n < BUILD_BUDGET) {
      const job = queue.shift();
      if (live.has(job.id)) continue;
      add(job.id, job.make(), job.x, job.z, job.yaw);
      n += 1;
    }
  }

  function want(x, z) {
    const r = RADIUS;
    const box = { minX: x - r, minZ: z - r, maxX: x + r, maxZ: z + r };
    world.ensureAround(x, z, r);
    const seen = new Set();

    for (const p of world.props(box)) {
      seen.add(p.id);
      if (!live.has(p.id) && !queue.some((q) => q.id === p.id)) {
        queue.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw, make: () => buildProp(p) });
      }
    }
    for (const b of world.barriers(box)) {
      // Already standing as one merged stone enclosure; see `walled` above.
      if (walled && b.kind === 'wall') continue;
      // A run is drawn as whole panels along its own line. The world guarantees
      // a run is a whole number of panels precisely so this is possible.
      const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
      const panels = Math.max(1, Math.round(len / 2.0));
      for (let i = 0; i < panels; i++) {
        const id = `${b.id}:p${i}`;
        seen.add(id);
        if (live.has(id) || queue.some((q) => q.id === id)) continue;
        const t = (i + 0.5) / panels;
        queue.push({
          id,
          x: b.x0 + (b.x1 - b.x0) * t,
          z: b.z0 + (b.z1 - b.z0) * t,
          yaw: Math.atan2(b.x1 - b.x0, b.z1 - b.z0) + Math.PI / 2,
          make: () => createFencePanel({ seed: (i * 7 + 3) | 0 }),
        });
      }
    }
    for (const g of world.gates(box)) {
      seen.add(g.id);
      if (live.has(g.id) || queue.some((q) => q.id === g.id)) continue;
      const at = g.prop || g;
      queue.push({
        id: g.id, x: at.x, z: at.z,
        yaw: Math.atan2(g.dx, g.dz) + Math.PI / 2,
        make: () => {
          const made = createGate({ seed: 6, hingeSide: 'left' });
          // Held ajar, so a gate reads as a way through rather than as a panel
          // with a frame. This is a viewer, and the thing being reviewed is
          // whether you can SEE where a skeleton would go.
          made.hinge.rotation.y = -0.5;
          return made;
        },
      });
    }

    // Let go of everything outside. Dropping a hole gives its cut back, which
    // is what keeps the four-cut budget from filling up as you walk.
    for (const [id, made] of live) {
      if (seen.has(id)) continue;
      if (made.__wantsCut) holeCount = Math.max(0, holeCount - 1);
      scene.remove(made.group);
      made.dispose?.();
      live.delete(id);
    }
    queue = queue.filter((q) => seen.has(q.id));
  }

  // --- fireflies -------------------------------------------------------------
  // Rebuilt rather than streamed. There are only a few dozen in radius at this
  // spacing, they are one draw call, and a field with a stable identity is not
  // worth the machinery when nothing is collecting them.
  let flies = null;
  let flyKey = '';
  function refreshFlies(x, z) {
    const box = { minX: x - RADIUS, minZ: z - RADIUS, maxX: x + RADIUS, maxZ: z + RADIUS };
    const pts = world.fireflies(box);
    const k = pts.map((p) => p.id).join(',');
    if (k === flyKey) return;
    flyKey = k;
    if (flies) { scene.remove(flies.group); flies.dispose?.(); }
    flies = createFireflies({ seed: 5, points: pts });
    scene.add(flies.group);
  }

  // --- the placement overlay -------------------------------------------------
  // Flat lines on the floor: fence runs, gates, the link from each firefly to
  // its nearest neighbour, and the chunk grid. This is the thing that makes the
  // page useful for arguing about rules rather than just pretty.
  const overlay = new THREE.Group();
  overlay.visible = false;
  scene.add(overlay);
  const OVER_Y = 0.03;
  function line(pts, color) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  }
  function refreshOverlay(x, z) {
    if (!overlay.visible) return;
    for (const c of [...overlay.children]) { overlay.remove(c); c.geometry.dispose(); c.material.dispose(); }
    const box = { minX: x - RADIUS, minZ: z - RADIUS, maxX: x + RADIUS, maxZ: z + RADIUS };
    for (const b of world.barriers(box)) {
      overlay.add(line([
        new THREE.Vector3(b.x0, OVER_Y, b.z0), new THREE.Vector3(b.x1, OVER_Y, b.z1),
      ], 0x2f6fd0));
    }
    for (const g of world.gates(box)) {
      const ox = g.dx * (g.half || 1), oz = g.dz * (g.half || 1);
      overlay.add(line([
        new THREE.Vector3(g.x - ox, OVER_Y, g.z - oz), new THREE.Vector3(g.x + ox, OVER_Y, g.z + oz),
      ], 0x2fbf6a));
    }
    // Each firefly to its nearest neighbour. The point of the picture is the
    // SPACING: if the links are all short the world is too generous, and if the
    // graph is in two halves the player has a gap to cross that nothing is
    // leading them over.
    const f = world.fireflies(box);
    for (const a of f) {
      let best = null; let bd = Infinity;
      for (const b of f) {
        if (a === b) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        overlay.add(line([
          new THREE.Vector3(a.x, OVER_Y, a.z), new THREE.Vector3(best.x, OVER_Y, best.z),
        ], 0xd8c33a));
      }
    }
    const C = world.CHUNK;
    for (let i = Math.floor((x - RADIUS) / C); i <= Math.ceil((x + RADIUS) / C); i++) {
      overlay.add(line([
        new THREE.Vector3(i * C, OVER_Y, z - RADIUS), new THREE.Vector3(i * C, OVER_Y, z + RADIUS),
      ], 0x9aa3b2));
    }
    for (let j = Math.floor((z - RADIUS) / C); j <= Math.ceil((z + RADIUS) / C); j++) {
      overlay.add(line([
        new THREE.Vector3(x - RADIUS, OVER_Y, j * C), new THREE.Vector3(x + RADIUS, OVER_Y, j * C),
      ], 0x9aa3b2));
    }
  }

  // --- the ghost, purely for scale -------------------------------------------
  const ghost = new Ghost({ seed: 12345 });
  ghost.pos.set(world.spawn.x, ghost.pos.y, world.spawn.z);
  ghost.cloth.reset(ghost.matrix);
  scene.add(ghost.mesh);

  // --- readout ---------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.appendChild(hud);

  function reset(newSeed) {
    seed = newSeed;
    for (const [, made] of live) { scene.remove(made.group); made.dispose?.(); }
    live = new Map(); queue = []; holeCount = 0;
    if (flies) { scene.remove(flies.group); flies.dispose?.(); flies = null; }
    flyKey = '';
    world = createWorld({ seed });
    ghost.pos.set(world.spawn.x, ghost.pos.y, world.spawn.z);
    ghost.vel.set(0, 0, 0);
    ghost.cloth.reset(ghost.matrix);
    camTarget.set(world.spawn.x, 0.75, world.spawn.z);
  }

  const input = new Input(canvas, camera);
  resize();
  placeCamera();
  window.addEventListener('resize', resize);
  window.addEventListener('wheel', (e) => {
    view = Math.min(60, Math.max(6, view * (1 + Math.sign(e.deltaY) * 0.12)));
    resize();
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') { overlay.visible = !overlay.visible; refreshOverlay(ghost.pos.x, ghost.pos.z); }
    else if (e.key === 'f' || e.key === 'F') follow = !follow;
    // A new seed throws the level away, so it is refused when the level came
    // out of a file rather than out of the generator.
    else if ((e.key === 'r' || e.key === 'R') && !levelUrl) reset((Math.random() * 1e9) | 0);
  });

  let time = 0;
  let scripted = null;
  let sinceStream = 1;
  function advance(dt) {
    time += dt;
    const axis = scripted || input.sample(ghost.pos);
    ghost.update(dt, axis);

    // Streaming is not a per-frame job. Four times a second is more than enough
    // at a walk of 3 units a second, and it keeps the set arithmetic off the
    // frame budget.
    sinceStream += dt;
    if (sinceStream > 0.25) {
      sinceStream = 0;
      want(ghost.pos.x, ghost.pos.z);
      refreshFlies(ghost.pos.x, ghost.pos.z);
      refreshOverlay(ghost.pos.x, ghost.pos.z);
    }
    pump();

    if (follow) {
      const k = 1 - Math.exp(-dt * 5.6);
      camTarget.x += (ghost.pos.x - camTarget.x) * k;
      camTarget.z += (ghost.pos.z - camTarget.z) * k;
    }
    placeCamera();
    // The grid's fade is anchored on uFocus, and nothing was driving it, so it
    // sat at the world origin: walk far enough and the grid quietly stops
    // being drawn under your feet while the floor stays the same grey. It is
    // invisible while a level sits near the origin and is a bug the moment one
    // does not. Both other pages already do this; this one did not.
    ground.userData.uniforms?.uFocus.value.copy(camTarget);
    flies?.update(time, dt);

    hud.textContent = `seed ${seed}   ${ghost.pos.x.toFixed(0)}, ${ghost.pos.z.toFixed(0)}   `
      + `${live.size} built${queue.length ? ` (+${queue.length})` : ''}   view ${view.toFixed(0)}`
      + `${follow ? '' : '   FREE'}`;
  }

  // Build what is in shot before the first frame, and no more.
  //
  // The first version drained the WHOLE queue here, which is every prop within
  // 46 units, and that was wrong twice over. It is about 270 props at roughly
  // 6 ms each with their texture bakes, so it blocks for a second and a half on
  // a good machine and for many minutes on a software rasteriser, and it does
  // it BEFORE the page reports ready, so a harness waiting on that flag times
  // out on a page that is working perfectly and merely busy. That is exactly
  // what happened the first time this was rendered.
  //
  // So the pre-build is capped by TIME rather than by count, small enough that
  // a slow machine gives up on it rather than hanging. What is left streams in
  // over the next second, and the queue is ordered nearest first so what
  // streams is behind you rather than in front of you.
  want(ghost.pos.x, ghost.pos.z);
  refreshFlies(ghost.pos.x, ghost.pos.z);
  {
    const until = performance.now() + 700;
    while (queue.length && performance.now() < until) pump();
  }

  let running = !testMode;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    advance(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  window.__viewer = {
    setSize(w, h) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; resize(); },
    step(dt = 1 / 60, axis = null) { running = false; scripted = axis; advance(dt); renderer.render(scene, camera); },
    zoom(v) { view = v; resize(); },
    overlay(on) { overlay.visible = !!on; refreshOverlay(ghost.pos.x, ghost.pos.z); },
    reset,
    at: () => ({ x: ghost.pos.x, z: ghost.pos.z, built: live.size, queued: queue.length }),
    info: () => ({ ...renderer.info.render, ...renderer.info.memory }),
    world: () => world,
  };
  window.__viewerReady = true;
}
