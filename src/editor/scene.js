// THE EDITOR'S VIEW: the level on the game's own floor, under the game's own
// light, plus the overlays an author needs and a player must never see.
//
// Two decisions worth stating.
//
// IT IS THE GAME'S RIG, NOT A TOOL'S RIG. Same floor, same hemisphere and key
// light, same orthographic camera on the same (1, 0.78, 1) axis as
// src/game/viewer.js. A level laid out under a tool's own lighting is a level
// laid out for the tool: the whole prop set was authored for this camera at
// this angle, several pieces read wrong from behind because of it, and the only
// way to see that while placing them is to place them in the light they ship
// in. The plan view is a SECOND camera on the same scene, not a second scene.
//
// IT DIFFS, IT DOES NOT REBUILD. A headstone costs about 6 ms to build with its
// texture bake, so rebuilding the level on every frame of a drag would make
// dragging useless. Everything below is keyed by the document's own ids and
// only what changed is rebuilt: moving a prop writes a position, changing its
// variant builds a new one, and the wall, the fences and the ground cover are
// rebuilt only when their own signature changes.

import * as THREE from 'three';
import { createGround, MAX_GROUND_HOLES } from '../ghost/ground.js';
import { createWall, createVoid, WALL } from '../ghost/props/fence/wall.js';
import { createFencePanel } from '../ghost/props/fence/panel.js';
import { createGate } from '../ghost/props/fence/gate.js';
import { createFireflies } from '../ghost/props/fireflies.js';
import { buildLevelProp } from '../game/level/build.js';
import { createGroundCover } from '../game/level/groundcover.js';
import { PERSONALITIES } from '../game/level/catalogue.js';

const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
const OVER_Y = 0.035;

const sig = (v) => JSON.stringify(v);

// --- how many pixels, and how smooth ------------------------------------------
//
// The owner's display reports devicePixelRatio 2, so an uncapped editor fills
// FOUR TIMES the window's pixels and multisamples all of them. That is the one
// straight quality-for-speed trade in the tool, so it is a setting rather than
// a constant, and quality() reports it so a readout can show what is in force.
//
//   ?dpr=<n>   cap the pixel ratio. Default DPR_CAP.
//   ?aa=0      turn multisampling off.
//
// setQuality() moves the cap at run time without rebuilding the renderer, which
// is what a slider in the editor's own settings would call. Antialiasing cannot
// be changed after a context is made, so that one is load-time only.
const DPR_CAP = 1.5;

export function createEditorScene({ canvas }) {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const antialias = q.get('aa') !== '0';
  let dprCap = Number(q.get('dpr')) > 0 ? Number(q.get('dpr')) : DPR_CAP;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, preserveDrawingBuffer: true });
  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  applyPixelRatio();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The shadow map is re-rendered ONLY when asked. It is a 2048 by 2048 pass
  // over every caster in the level and it cannot change unless the geometry or
  // the light moves, so re-rendering it sixty times a second was doubling the
  // draw calls of a picture that was already on screen. invalidate(true) is how
  // anything says the shadows are stale.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.localClippingEnabled = true;

  // --- when to draw ------------------------------------------------------------
  //
  // AN EDITOR IS NOT A GAME. Nothing in this scene moves on its own: a level
  // sits there until somebody drags something. Drawing it sixty times a second
  // was a full colour pass and a full shadow pass, for an identical picture,
  // for as long as the page was open.
  //
  // So the loop still runs -- main.js hangs its paint flush and its palette
  // thumbnail pump off onFrame and both must keep ticking -- but it only calls
  // renderer.render when something has actually changed. Every entry point that
  // can change the picture calls invalidate(); if one is ever missed the
  // symptom is a stale canvas, so the list below is the whole contract:
  //
  //   sync, overlayOnly     the level or the overlay changed
  //   placeCamera, resize   the view changed, which also moves the light
  //   setView, setMode      likewise
  //   pause(false)          the loop was handed back
  //
  // `shadows` says the change was geometric. A camera move needs a redraw and,
  // because the light follows the target, a shadow pass too; an overlay change
  // needs neither the shadow pass nor anything else re-lit.
  let dirty = true;
  function invalidate(shadows = false) {
    dirty = true;
    if (shadows) renderer.shadowMap.needsUpdate = true;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9bec7').convertSRGBToLinear();
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));

  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 120;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const LIGHT_OFFSET = new THREE.Vector3(3.7, 6.0, 2.4).normalize().multiplyScalar(40);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const target = new THREE.Vector3(0, 0, 0);
  let mode = 'game';   // 'game' or 'plan'

  // --- the camera ---------------------------------------------------------------
  //
  // Three complaints from the owner, and they are one complaint about feel:
  // you could zoom out past the level into void, every notch of the wheel was a
  // jump, and moving around did not behave like moving a thing you were holding.
  //
  //   view      what is on screen this frame
  //   viewWant  what the wheel has asked for; view chases it
  //   maxView   the view at which the whole arena is on screen, computed
  //             rather than guessed, and the hard ceiling. CONTAIN, not cover:
  //             the ask was to see the entire 30 by 30 and no more, so the
  //             arena touches the frame on its binding axis and there is
  //             background on the other unless the window happens to match its
  //             shape. Covering instead would crop the level, which is worse.
  //             Measured 22.3 at 1400x900, and it moves with the window.
  //
  // The wheel handler lives in main.js and is not mine, but it goes through
  // setView, so all of this works without that file changing: setView moves the
  // TARGET and the frame loop eases towards it, anchored on the pointer.
  let view = 18;
  let viewWant = 18;
  let maxView = 60;
  // Half the arena, from the document. Until a level is synced this is the
  // standing 30 by 30.
  let arenaHalfX = 15;
  let arenaHalfZ = 15;
  let arenaCx = 0;
  let arenaCz = 0;

  // How fast the view catches its target and the pan glide dies, per second.
  // 14 settles a wheel notch in about four frames: fast enough not to feel
  // laggy, slow enough that the step is a movement rather than a jump.
  const ZOOM_RATE = 14;
  const PAN_DECAY = 6.5;
  // Below this the glide is over. A tenth of a world unit a second is under a
  // pixel a frame at any zoom this editor allows.
  const PAN_STOP = 0.1;

  const panVel = new THREE.Vector2(0, 0);
  let lastPanAt = -1e9;
  // Where the pointer is over the canvas, so a zoom can be anchored on it. Own
  // listener, passive, and it never invalidates: knowing where the mouse is is
  // not a reason to redraw.
  let pointer = null;
  if (typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
    canvas.addEventListener('pointerleave', () => { pointer = null; }, { passive: true });
  }

  // The view at which the whole arena, wall and all, exactly fills the frame.
  //
  // It is not a number anyone can guess, because the arena stands on its
  // diagonal in this camera and the answer moves with the window's aspect and
  // with the level's own size. So it is measured: the eight corners of the
  // arena box are put through the camera's own basis and the extents read off.
  function fitView(aspect) {
    const probe = new THREE.Object3D();
    if (mode === 'plan') { probe.position.set(0, 200, 0.001); probe.up.set(0, 0, -1); }
    else { probe.position.copy(CAM_DIR).multiplyScalar(120); probe.up.set(0, 1, 0); }
    probe.position.add(new THREE.Vector3(arenaCx, 0, arenaCz));
    probe.lookAt(arenaCx, 0, arenaCz);
    probe.updateMatrixWorld();
    const inv = probe.matrixWorld.clone().invert();
    const p = new THREE.Vector3();
    let mx = 0;
    let my = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, WALL.height]) {
          p.set(arenaCx + sx * arenaHalfX, y, arenaCz + sz * arenaHalfZ).applyMatrix4(inv);
          mx = Math.max(mx, Math.abs(p.x));
          my = Math.max(my, Math.abs(p.y));
        }
      }
    }
    return Math.max(my, mx / Math.max(0.001, aspect));
  }

  // The target cannot leave the arena either. Zooming out is capped at the
  // whole level; panning is capped at its edges, for the same reason.
  function clampTarget() {
    target.x = Math.max(arenaCx - arenaHalfX, Math.min(arenaCx + arenaHalfX, target.x));
    target.z = Math.max(arenaCz - arenaHalfZ, Math.min(arenaCz + arenaHalfZ, target.z));
  }

  // The level decides the ceiling, so it has to be read off the level rather
  // than assumed to be the standing 30 by 30.
  function setArena(bounds) {
    if (!bounds) return;
    const hx = Math.max(1, (bounds.maxX - bounds.minX) / 2);
    const hz = Math.max(1, (bounds.maxZ - bounds.minZ) / 2);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    if (hx === arenaHalfX && hz === arenaHalfZ && cx === arenaCx && cz === arenaCz) return;
    arenaHalfX = hx; arenaHalfZ = hz; arenaCx = cx; arenaCz = cz;
    applyView();
    clampTarget();
    placeCamera();
  }

  const ground = createGround({ fadeStart: 60, fadeEnd: 400 });
  scene.add(ground);

  const level = new THREE.Group();
  scene.add(level);
  const overlay = new THREE.Group();
  scene.add(overlay);

  function placeCamera() {
    if (mode === 'plan') {
      camera.position.set(target.x, 200, target.z + 0.001);
      camera.up.set(0, 0, -1);
    } else {
      camera.position.copy(target).addScaledVector(CAM_DIR, 120);
      camera.up.set(0, 1, 0);
    }
    camera.lookAt(target);
    key.target.position.set(target.x, 0, target.z);
    key.position.copy(key.target.position).add(LIGHT_OFFSET);
    key.target.updateMatrixWorld();
    ground.userData.uniforms?.uFocus.value.copy(target);
    // groundAt is asked questions between renders -- the pointer-anchored zoom
    // below reads the ground twice in one frame -- and a raycast off a stale
    // matrixWorld answers about where the camera used to be.
    camera.updateMatrixWorld();
    // The light hangs off the target, so moving the camera moves every shadow.
    invalidate(true);
  }

  // One frame of camera easing. Both halves are no-ops once they have settled,
  // and neither invalidates when it is a no-op, which is what lets the editor
  // go quiet again after a gesture.
  function stepCamera(dt, now) {
    if (Math.abs(viewWant - view) > 1e-4) {
      // ANCHORED ON THE POINTER. Zooming towards the middle of the screen is
      // most of what makes a zoom feel abrupt even after it has been smoothed:
      // the thing you were looking at slides away while you scroll. Read the
      // ground under the cursor, change the view, read it again, and shift the
      // target by the difference.
      const before = pointer ? groundAt(pointer.x, pointer.y) : null;
      view += (viewWant - view) * (1 - Math.exp(-dt * ZOOM_RATE));
      if (Math.abs(viewWant - view) < Math.max(0.002, view * 0.0015)) view = viewWant;
      applyView();
      placeCamera();
      if (before) {
        const after = groundAt(pointer.x, pointer.y);
        if (after) {
          target.x += before.x - after.x;
          target.z += before.z - after.z;
          clampTarget();
          placeCamera();
        }
      }
    }
    // The glide may only start once the drag has actually stopped, and "has
    // stopped" cannot be a fixed number of milliseconds: on a slow frame the
    // gap between two pointer moves is the frame, and a glide that fires in
    // that gap adds drift while the author is still dragging. So it is a frame
    // and a half, or 120 ms, whichever is longer.
    const quietFor = Math.max(120, dt * 1500);
    if (now - lastPanAt > quietFor && (panVel.x || panVel.y)) {
      const decay = Math.exp(-dt * PAN_DECAY);
      if (Math.abs(panVel.x) > PAN_STOP || Math.abs(panVel.y) > PAN_STOP) {
        target.x += panVel.x * dt;
        target.z += panVel.y * dt;
        clampTarget();
        placeCamera();
        panVel.multiplyScalar(decay);
      } else {
        panVel.set(0, 0);
      }
    }
  }

  // The projection alone, for a zoom step. resize() also resizes the drawing
  // buffer, which a wheel notch has no business doing sixty times.
  function applyView() {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const aspect = w / h;
    maxView = fitView(aspect);
    view = Math.max(3, Math.min(maxView, view));
    viewWant = Math.max(3, Math.min(maxView, viewWant));
    camera.left = -view * aspect; camera.right = view * aspect;
    camera.top = view; camera.bottom = -view;
    camera.updateProjectionMatrix();
    const reach = Math.min(90, view * Math.max(1, aspect) * 1.7);
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach;
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach;
    key.shadow.camera.updateProjectionMatrix();
  }

  function resize() {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const aspect = w / h;
    camera.left = -view * aspect; camera.right = view * aspect;
    camera.top = view; camera.bottom = -view;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const reach = Math.min(90, view * Math.max(1, aspect) * 1.7);
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach;
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach;
    key.shadow.camera.updateProjectionMatrix();
    applyView();
    clampTarget();
    placeCamera();
    invalidate(true);
  }

  // --- picking -----------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  function setRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }

  // Where a click lands on the floor. Everything the author points at is on the
  // floor: a prop is placed at a point, a fence is drawn through points, and a
  // brush paints cells. Picking against the props themselves is a separate
  // question, below.
  function groundAt(clientX, clientY) {
    setRay(clientX, clientY);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
    return { x: hitPoint.x, z: hitPoint.z };
  }

  // What is under the cursor, by the document id the built object carries.
  function pickAt(clientX, clientY) {
    setRay(clientX, clientY);
    const hits = raycaster.intersectObjects(level.children, true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && o !== level) {
        if (o.userData.pickId) return { id: o.userData.pickId, kind: o.userData.pickKind, point: hit.point };
        o = o.parent;
      }
    }
    return null;
  }

  // A world point projected to client pixels, for the DOM badges.
  function toScreen(x, z) {
    const v = new THREE.Vector3(x, 0, z).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
  }

  // --- what is built -------------------------------------------------------------

  const built = new Map();     // pick id -> { group, key, made, cut }
  let wallSig = '';
  let wallBuilt = null;
  let fenceSig = '';
  let fenceBuilt = null;
  let groundSig = '';
  let cover = null;
  // How long the last cover rebuild took. The paint brush throttles itself
  // against this: the cover is a marching-squares pass plus a scatter plus a
  // kerb run or two, and what that costs depends on what groundcover.js is
  // doing this month rather than on anything here.
  let coverMs = 0;
  let flySig = '';
  let flies = null;
  let holeCuts = 0;

  function drop(id) {
    const e = built.get(id);
    if (!e) return;
    // dispose() is what gives a hole's floor cut back. Nothing else does, so
    // the budget below depends on this being the only way a prop leaves.
    level.remove(e.group);
    e.made?.dispose?.();
    built.delete(id);
  }

  function syncProps(world) {
    const seen = new Set();
    // THE FOUR CUTS. src/ghost/ground.js carries at most MAX_GROUND_HOLES and
    // addGroundHole THROWS at the fifth, so the budget is spent in document
    // order: the graves are first in the list and take them, and a decorative
    // fifth grave hole reads as a filled grave, which hole.js documents as the
    // tidy fallback rather than a failure.
    const wantCut = new Set(
      world.props().filter((p) => p.kind === 'hole').slice(0, MAX_GROUND_HOLES).map((p) => p.id),
    );
    holeCuts = wantCut.size;
    for (const p of world.props()) {
      seen.add(p.id);
      const cut = wantCut.has(p.id);
      // The cut state is part of the build key: a hole that loses its slot has
      // to be rebuilt, because registerWith() is one way only.
      const k = `${p.kind}/${p.variant}/${cut ? 'cut' : 'plain'}`;
      let e = built.get(p.id);
      if (e && e.key !== k) { drop(p.id); e = null; }
      if (!e) {
        const made = buildLevelProp(p, { allowCut: cut });
        if (!made) continue;
        made.group.userData.pickId = p.id;
        made.group.userData.pickKind = 'prop';
        made.group.position.set(p.x, 0, p.z);
        made.group.rotation.y = p.yaw || 0;
        level.add(made.group);
        if (cut && made.registerWith) made.registerWith(ground);
        e = { group: made.group, key: k, made, isHole: p.kind === 'hole' };
        built.set(p.id, e);
      }
      e.group.position.set(p.x, 0, p.z);
      e.group.rotation.y = p.yaw || 0;
      // A hole keeps its cut in step through its own update(), which is one
      // matrix read when it has not moved.
      if (e.isHole) e.made.update?.();
    }
    for (const id of [...built.keys()]) if (!seen.has(id)) drop(id);
  }

  function syncWall(doc) {
    const s = sig([doc.wall.points, doc.size, doc.wall.variant, doc.wall.styles]);
    if (s === wallSig) return;
    wallSig = s;
    if (wallBuilt) { level.remove(wallBuilt.group); wallBuilt.dispose?.(); }
    const group = new THREE.Group();
    // variant and styles go straight through: `at` on a style change is a
    // distance along the centreline from points[0], which is the same
    // coordinate a gate uses, so the editor places one with the code it has.
    const made = createWall({
      seed: 1,
      points: doc.wall.points.map(([x, z]) => ({ x, z })),
      closed: true,
      variant: doc.wall.variant,
      styles: doc.wall.styles && doc.wall.styles.length ? doc.wall.styles : null,
    });
    group.add(made.group);
    const h = doc.size / 2;
    const dark = createVoid({ bounds: { x: 0, z: 0, halfX: h, halfZ: h } });
    group.add(dark.group);
    level.add(group);
    wallBuilt = { group, dispose() { made.dispose?.(); dark.dispose?.(); } };
  }

  // Fences are rebuilt whole. They are cheap next to a headstone, and the
  // alternative -- diffing panels along a run whose points just moved -- is a
  // lot of machinery for something the author edits a handful of times.
  function syncFences(world, doc) {
    const s = sig(doc.fences);
    if (s === fenceSig) return;
    fenceSig = s;
    if (fenceBuilt) { level.remove(fenceBuilt.group); fenceBuilt.dispose(); }
    const group = new THREE.Group();
    const made = [];
    for (const b of world.barriers()) {
      if (b.kind !== 'fence') continue;
      const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
      const panels = Math.max(1, Math.round(len / world.PANEL));
      for (let i = 0; i < panels; i++) {
        const t = (i + 0.5) / panels;
        const p = createFencePanel({ seed: (i * 7 + 3) | 0 });
        p.group.position.set(b.x0 + (b.x1 - b.x0) * t, 0, b.z0 + (b.z1 - b.z0) * t);
        p.group.rotation.y = Math.atan2(b.x1 - b.x0, b.z1 - b.z0) + Math.PI / 2;
        p.group.scale.z = 1;
        p.group.userData.pickId = b.run;
        p.group.userData.pickKind = 'fence';
        group.add(p.group);
        made.push(p);
      }
    }
    for (const g of world.gates()) {
      const gate = createGate({ seed: 6, hingeSide: 'left' });
      gate.hinge.rotation.y = -0.5;
      gate.group.position.set(g.prop.x, 0, g.prop.z);
      gate.group.rotation.y = g.prop.yaw;
      gate.group.userData.pickId = g.id;
      gate.group.userData.pickKind = 'gate';
      group.add(gate.group);
      made.push(gate);
    }
    level.add(group);
    fenceBuilt = { group, dispose() { for (const m of made) m.dispose?.(); } };
  }

  function syncGround(doc) {
    const s = sig([doc.ground.paint, doc.ground.w, doc.ground.h, doc.ground.cell, doc.ground.kerbs, doc.seed]);
    if (s === groundSig) return;
    groundSig = s;
    if (cover) { level.remove(cover.group); cover.dispose(); }
    // `kerbs` says which pairs of grounds meet at a row of stones rather than
    // at a plain crossover. It is a field of the document, and it is handed
    // over explicitly because groundcover.js takes it as an argument rather
    // than reading it off the ground block.
    const t0 = performance.now();
    cover = createGroundCover({
      ground: doc.ground, seed: doc.seed, kerbs: doc.ground.kerbs || null,
    });
    coverMs = performance.now() - t0;
    level.add(cover.group);
  }

  function syncFlies(world) {
    const pts = world.fireflies();
    const s = pts.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join('|');
    if (s === flySig) return;
    flySig = s;
    if (flies) { level.remove(flies.group); flies.dispose?.(); }
    flies = createFireflies({ seed: 5, points: pts });
    level.add(flies.group);
  }

  // --- the overlays ---------------------------------------------------------------
  //
  // Flat lines and rings on the floor. Rebuilt every sync, which is fine: they
  // are a few hundred vertices and no textures.

  function clearOverlay() {
    for (const c of [...overlay.children]) {
      overlay.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
  }

  function lineOf(points, color, opacity = 0.95) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, OVER_Y, z)));
    return new THREE.Line(g, new THREE.LineBasicMaterial({
      color, depthTest: false, transparent: true, opacity,
    }));
  }

  function ringOf(x, z, r, color, opacity = 0.9) {
    const pts = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
    return lineOf(pts, color, opacity);
  }

  // The footprint the validator actually tests, drawn where the author can see
  // it. A turned box is the whole reason a row of ledgers reads as a row, so
  // the outline is the turned box and never a circle.
  function footprintOutline(p, color, opacity = 0.9) {
    const f = p.foot;
    if (f.shape === 'disc') return ringOf(p.x, p.z, f.r, color, opacity);
    const c = Math.cos(p.yaw || 0);
    const s = Math.sin(p.yaw || 0);
    const corner = (u, v) => [p.x + u * c + v * s, p.z - u * s + v * c];
    return lineOf([
      corner(-f.halfU, -f.halfV), corner(f.halfU, -f.halfV),
      corner(f.halfU, f.halfV), corner(-f.halfU, f.halfV), corner(-f.halfU, -f.halfV),
    ], color, opacity);
  }

  // WHICH WAY IS IT FACING. Several props were authored to face the camera and
  // look wrong from behind, so the tool says which way each one looks rather
  // than leaving the author to walk round it. The chevron points along the
  // prop's local +Z, which is what footprints.js calls its face, and it turns
  // amber when that face is pointing away from this camera.
  function facingMark(p) {
    const c = Math.cos(p.yaw || 0);
    const s = Math.sin(p.yaw || 0);
    const fx = s;
    const fz = c;
    const reach = (p.foot.shape === 'disc' ? p.foot.r : p.foot.halfV) + 0.34;
    const tip = [p.x + fx * reach, p.z + fz * reach];
    const base = [p.x + fx * (reach - 0.26), p.z + fz * (reach - 0.26)];
    const side = 0.16;
    // The camera looks along -CAM_DIR in plan; a face is "away" when its own
    // normal points into the screen.
    const dot = fx * -CAM_DIR.x + fz * -CAM_DIR.z;
    const colour = dot > 0.35 ? 0xd08a2a : 0x3a7fd0;
    return lineOf([
      [base[0] - fz * side, base[1] + fx * side],
      tip,
      [base[0] + fz * side, base[1] - fx * side],
    ], colour, 0.95);
  }

  let showFootprints = true;
  let showFacing = true;

  function syncOverlay(world, doc, {
    selection = new Set(), flagged = new Set(), hover = null, brush = null, wedges = [],
    gizmo = null, ghost = null, wallHover = null, wallMarks = [], fence = null,
  } = {}) {
    clearOverlay();
    const d = world._derived;

    // The arena edge, always, because everything has to be inside it.
    overlay.add(lineOf([...doc.wall.points, doc.wall.points[0]], 0x4a5160, 0.6));

    // WHERE THE WALL CHANGES HANDS. A change is stored as a distance along the
    // run, which is the right way to store it and no way at all to see it, so
    // each one is drawn as a bar standing across the wall where it stands.
    for (const at of wallMarks) {
      const nx = -at.dz;
      const nz = at.dx;
      overlay.add(lineOf([
        [at.x - nx * 0.9, at.z - nz * 0.9],
        [at.x + nx * 0.9, at.z + nz * 0.9],
      ], 0xf0902a, 0.95));
    }

    // AND WHICH SECTION THE NEXT CLICK PAINTS. Two lines either side of that
    // stretch of the wall's centreline and a bar at each end, so the author can
    // see the five unit square they are about to change before they change it.
    if (wallHover && wallHover.length > 1) {
      const off = (p, s2) => [p.x - p.dz * s2, p.z + p.dx * s2];
      overlay.add(lineOf(wallHover.map((p) => off(p, 0.75)), 0xf0902a, 0.95));
      overlay.add(lineOf(wallHover.map((p) => off(p, -0.75)), 0xf0902a, 0.95));
      for (const end of [wallHover[0], wallHover[wallHover.length - 1]]) {
        overlay.add(lineOf([off(end, 0.75), off(end, -0.75)], 0xf0902a, 0.95));
      }
    }

    for (const g of d.gates) {
      // The approach capsule, which is the thing an author blocks by accident.
      overlay.add(lineOf([[g.clear.x0, g.clear.z0], [g.clear.x1, g.clear.z1]], 0x2fbf6a, 0.8));
      overlay.add(ringOf(g.sweep.x, g.sweep.z, g.sweep.r, 0x2fbf6a, 0.45));
      overlay.add(lineOf([[g.x0, g.z0], [g.x1, g.z1]], 0x2fbf6a, 0.95));
    }

    for (const p of d.props) {
      const bad = flagged.has(p.id);
      const sel = selection.has(p.id);
      if (showFootprints || bad || sel) {
        overlay.add(footprintOutline(p, bad ? 0xd23b3b : sel ? 0x1f6fe0 : 0x8b93a3, bad || sel ? 1 : 0.35));
      }
      if (showFacing && p.foot.shape !== 'disc') overlay.add(facingMark(p));
      if (bad) overlay.add(ringOf(p.x, p.z, p.radius + 0.12, 0xd23b3b, 0.85));
    }

    for (const g of d.graves) {
      overlay.add(ringOf(g.x, g.z, 1.35, selection.has(g.id) ? 0x1f6fe0 : 0x8a5bd0, 0.9));
      overlay.add(lineOf([[g.x, g.z], [g.x + Math.sin(g.yaw) * 1.5, g.z + Math.cos(g.yaw) * 1.5]], 0x8a5bd0, 0.7));
    }
    // The spawn order, drawn as the line a wave of skeletons comes out in.
    const ordered = [...d.graves].sort((a, b) => a.order - b.order);
    for (let i = 0; i + 1 < ordered.length; i++) {
      overlay.add(lineOf([[ordered[i].x, ordered[i].z], [ordered[i + 1].x, ordered[i + 1].z]], 0x8a5bd0, 0.4));
    }

    for (const p of d.powerups) {
      overlay.add(ringOf(p.x, p.z, p.radius + 0.2, selection.has(p.id) ? 0x1f6fe0 : 0xd8a33a, 0.85));
    }

    overlay.add(ringOf(doc.spawn.x, doc.spawn.z, 0.55, 0x2f3542, 0.9));
    overlay.add(ringOf(doc.spawn.x, doc.spawn.z, 3.2, 0x2f3542, 0.25));

    for (const f of d.flies.points) overlay.add(ringOf(f.x, f.z, 0.28, 0xd8c33a, 0.9));

    for (const run of d.runs) {
      const pts = run.source.points.map(([x, z]) => [x, z]);
      if (run.source.closed) pts.push(pts[0]);
      overlay.add(lineOf(pts, selection.has(run.id) ? 0x1f6fe0 : 0x2f6fd0, 0.5));
      for (const [x, z] of run.source.points) overlay.add(ringOf(x, z, 0.12, 0x2f6fd0, 0.8));
    }

    // WEDGES. A place the ghost can vault into that no skeleton can walk to, so
    // the player stands in it and is safe for ever. It is invisible: it is not
    // a prop and not a fence, it is a shape the gaps make, so the only way an
    // author can see one is if the tool draws it. Two rings and a cross, in the
    // error colour, sized by how big the pocket is.
    for (const w of wedges) {
      const r = Math.max(0.5, Math.sqrt((w.cells * 0.25 * 0.25) / Math.PI));
      overlay.add(ringOf(w.x, w.z, r, 0xd23b3b, 1));
      overlay.add(ringOf(w.x, w.z, r + 0.35, 0xd23b3b, 0.5));
      overlay.add(lineOf([[w.x - r, w.z - r], [w.x + r, w.z + r]], 0xd23b3b, 0.7));
      overlay.add(lineOf([[w.x - r, w.z + r], [w.x + r, w.z - r]], 0xd23b3b, 0.7));
    }

    // THE PLACEMENT INDICATOR. What is about to be dropped, where it would
    // land, in green when it may go there and red when it may not -- and when
    // it is red the drop is refused, so this is the rule and not a warning
    // about it. It is drawn as the footprint the checks actually test, turned
    // by the yaw the prop will get, because a headstone is three times as wide
    // as it is deep and a circle would promise room that is not there.
    if (ghost) {
      const colour = ghost.ok ? 0x2f9e5f : 0xd23b3b;
      for (const f of ghost.foots) {
        overlay.add(footprintOutline(f, colour, 1));
        overlay.add(footprintOutline(
          { ...f, foot: grownFoot(f.foot, 0.06) }, colour, 0.45,
        ));
      }
      if (!ghost.ok) {
        const c = ghost.foots[0];
        overlay.add(lineOf([[c.x - 0.35, c.z - 0.35], [c.x + 0.35, c.z + 0.35]], 0xd23b3b, 1));
        overlay.add(lineOf([[c.x - 0.35, c.z + 0.35], [c.x + 0.35, c.z - 0.35]], 0xd23b3b, 1));
      }
    }

    // THE HANDLES. A ring you can grab to turn a thing and a cross you can grab
    // to move it, both on the ground plane, both a fixed size on screen. The
    // camera is a fixed three-quarter orthographic view and there is exactly
    // one axis of rotation, so a ring on the floor is unambiguous to hit and a
    // three-axis gizmo would be three times the machinery for no third axis.
    if (gizmo) {
      overlay.add(ringOf(gizmo.x, gizmo.z, gizmo.ring, 0x1f6fe0, 0.55));
      overlay.add(ringOf(gizmo.x, gizmo.z, gizmo.move, 0x1f6fe0, 0.8));
      // The two axes of movement, as a cross inside the move disc.
      overlay.add(lineOf([[gizmo.x - gizmo.move, gizmo.z], [gizmo.x + gizmo.move, gizmo.z]], 0x1f6fe0, 0.8));
      overlay.add(lineOf([[gizmo.x, gizmo.z - gizmo.move], [gizmo.x, gizmo.z + gizmo.move]], 0x1f6fe0, 0.8));
      // The knob, on the ring, at whatever the thing's own yaw is, so the ring
      // also reads as a dial and not only as a target.
      const kx = gizmo.x + Math.sin(gizmo.yaw) * gizmo.ring;
      const kz = gizmo.z + Math.cos(gizmo.yaw) * gizmo.ring;
      overlay.add(ringOf(kx, kz, gizmo.knob, 0x1f6fe0, 1));
      overlay.add(ringOf(kx, kz, gizmo.knob * 0.55, 0x1f6fe0, 1));
    }

    // THE FENCE ABOUT TO BE DRAWN. The line from the last corner to where the
    // click will land, green when it can be built and red when it cannot, and
    // a ring on whatever it has attached itself to. This is the same indicator
    // the props have; a run used to be drawn only after each click, so an
    // author found out whether a segment was allowed by committing it.
    if (fence) {
      const colour = fence.ok ? 0x2f9e5f : 0xd23b3b;
      if (fence.a) {
        overlay.add(lineOf([[fence.a.x, fence.a.z], [fence.at.x, fence.at.z]], colour, 1));
        // The panels it would be built out of, ticked along it, so a run that
        // is a whole number of them looks like one before it is committed.
        const dx = fence.at.x - fence.a.x;
        const dz = fence.at.z - fence.a.z;
        const len = Math.hypot(dx, dz);
        for (let d = 2; d < len - 0.01; d += 2) {
          const t = d / len;
          const px = fence.a.x + dx * t;
          const pz = fence.a.z + dz * t;
          overlay.add(ringOf(px, pz, 0.1, colour, 0.7));
        }
      }
      overlay.add(ringOf(fence.at.x, fence.at.z, 0.22, colour, 1));
      // What it attached to, so the snap is a thing you can see happening.
      if (fence.to) overlay.add(ringOf(fence.to.x, fence.to.z, 0.5, 0xf0902a, 0.9));
      if (!fence.ok) {
        overlay.add(lineOf([[fence.at.x - 0.3, fence.at.z - 0.3], [fence.at.x + 0.3, fence.at.z + 0.3]], colour, 1));
        overlay.add(lineOf([[fence.at.x - 0.3, fence.at.z + 0.3], [fence.at.x + 0.3, fence.at.z - 0.3]], colour, 1));
      }
    }

    if (hover) overlay.add(ringOf(hover.x, hover.z, 0.2, 0x2f3542, 0.5));
    if (brush) overlay.add(ringOf(brush.x, brush.z, brush.r, 0x2f3542, 0.8));
  }

  const grownFoot = (f, by) => (f.shape === 'disc'
    ? { shape: 'disc', r: f.r + by }
    : { shape: 'box', halfU: f.halfU + by, halfV: f.halfV + by });

  // --- the badges ---------------------------------------------------------------
  //
  // Which skeleton climbs out of which hole, and in what order. This is DOM
  // rather than geometry on purpose: it has to be legible at every zoom, and a
  // plane in the scene is not.

  const badgeLayer = document.createElement('div');
  badgeLayer.className = 'badges';
  canvas.parentElement.appendChild(badgeLayer);

  function syncBadges(world) {
    if (!world) return;
    const graves = world._derived.graves;
    while (badgeLayer.children.length > graves.length) badgeLayer.lastChild.remove();
    while (badgeLayer.children.length < graves.length) {
      const el = document.createElement('div');
      el.className = 'badge';
      badgeLayer.appendChild(el);
    }
    graves.forEach((g, i) => {
      const el = badgeLayer.children[i];
      const s = toScreen(g.x, g.z);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      el.textContent = `${g.order + 1} ${g.personality}`;
      el.dataset.personality = g.personality;
    });
  }

  // --- the public face --------------------------------------------------------

  function sync(world, doc, opts) {
    setArena(world?.bounds);
    syncWall(doc);
    syncGround(doc);
    syncFences(world, doc);
    syncProps(world);
    syncFlies(world);
    syncOverlay(world, doc, opts);
    syncBadges(world);
    // A sync is the geometric change, so the shadow map goes with it.
    invalidate(true);
  }

  let time = 0;
  let last = performance.now();
  let onFrame = null;
  // The only thing in the scene that animates is the firefly field, so the
  // loop can simply be stopped. A capture script does that: a page that is
  // redrawing sixty times a second on a software rasteriser never presents a
  // stable frame, and a screenshot of it waits for ever.
  // --- the readout --------------------------------------------------------------
  //
  // Everything this project has measured for two days came off a software
  // rasteriser where a frame takes hundreds of milliseconds to composite and
  // renderer.render returns in 0.3. That instrument has now twice said a thing
  // was fine when it was not, and it cannot see the owner's display at all --
  // it reports devicePixelRatio 1 where theirs is 2. So this is the same set of
  // numbers, taken on whatever machine the editor is actually running on.
  //
  //   /editor/?perf=1   on at load
  //   F2                toggle
  //
  // It is a plain div and it never draws into the scene, so turning it on
  // cannot change what it is measuring. The only cost it adds is a walk of the
  // scene for texture memory, which is why that runs every two seconds rather
  // than every frame.
  const readout = (() => {
    let el = null;
    let on = q.get('perf') === '1';
    const gaps = [];
    let drawn = 0;
    let drawnAt = performance.now();
    let drawsPerSec = 0;
    let mem = { tex: 0, geo: 0, mat: 0 };
    let memAt = 0;
    let lastPaint = 0;
    const marks = new Map();

    const ensure = () => {
      if (el || typeof document === 'undefined') return;
      el = document.createElement('div');
      el.style.cssText = [
        // Bottom left, above the status line: the palette runs down the left
        // and the properties down the right, and the bottom corner is the one
        // place a fixed box does not cover a control.
        'position:fixed', 'left:8px', 'bottom:30px', 'z-index:99999',
        'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
        'background:rgba(12,14,18,0.82)', 'color:#dfe6f5', 'padding:7px 9px',
        'border-radius:5px', 'white-space:pre', 'pointer-events:none',
        'letter-spacing:0.2px',
      ].join(';');
      document.body.appendChild(el);
    };

    const walk = () => {
      const geos = new Set();
      const mats = new Set();
      const texs = new Set();
      let bytes = 0;
      scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine) return;
        if (o.geometry) geos.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || mats.has(m)) continue;
          mats.add(m);
          for (const k of Object.keys(m)) {
            const t = m[k];
            if (!t || !t.isTexture || texs.has(t)) continue;
            texs.add(t);
            const im = t.image || {};
            const w = im.width || t.source?.data?.width || 0;
            const h = im.height || t.source?.data?.height || 0;
            bytes += w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
          }
        }
      });
      mem = { tex: bytes / 1048576, geo: geos.size, mat: mats.size };
    };

    return {
      get on() { return on; },
      toggle(v) { on = v === undefined ? !on : !!v; if (el) el.style.display = on ? '' : 'none'; if (on) ensure(); },
      // Anything outside this file that wants a number in the readout calls
      // this. main.js has the two that matter: the deep review and the ground
      // cover rebuild.
      mark(name, ms) { marks.set(name, ms); },
      drew() { drawn += 1; },
      tick(now, gap) {
        if (!on) return;
        ensure();
        if (!el) return;
        gaps.push(gap);
        if (gaps.length > 90) gaps.shift();
        if (now - drawnAt >= 1000) {
          drawsPerSec = (drawn * 1000) / (now - drawnAt);
          drawn = 0;
          drawnAt = now;
        }
        if (now - memAt > 2000) { walk(); memAt = now; }
        // Four times a second: a readout that repaints every frame is measuring
        // itself.
        if (now - lastPaint < 250) return;
        lastPaint = now;
        const sorted = [...gaps].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)] || 0;
        const worst = sorted[sorted.length - 1] || 0;
        const info = renderer.info;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const rows = [
          `frame   ${med.toFixed(1)} ms median   ${worst.toFixed(0)} worst`,
          `draws   ${drawsPerSec.toFixed(1)} /s        shadow ${renderer.shadowMap.autoUpdate ? 'every frame' : 'on change'}`,
          `calls   ${info.render.calls}   tris ${info.render.triangles.toLocaleString('en-US')}`,
          `memory  ${mem.tex.toFixed(0)} MB tex   ${mem.geo} geo   ${mem.mat} mat`,
          `pixels  ${size.x}x${size.y}   dpr ${(window.devicePixelRatio || 1)} cap ${dprCap}   aa ${antialias ? 'on' : 'off'}`,
          `props   ${built.size} built`,
          `cover   ${coverMs.toFixed(0)} ms last rebuild`,
        ];
        for (const [k, v] of marks) rows.push(`${k.padEnd(7)} ${v.toFixed(0)} ms`);
        el.textContent = rows.join('\n');
      },
    };
  })();

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      // Shift cycles the pixel-ratio cap instead, so the one quality-for-speed
      // trade in the tool can be felt against the readout rather than argued
      // about. 1 is soft and cheap, 2 is everything the display has.
      if (e.shiftKey) {
        const steps = [1, 1.5, 2];
        const next = steps[(steps.indexOf(dprCap) + 1) % steps.length] ?? 1.5;
        dprCap = next;
        applyPixelRatio();
        resize();
        readout.toggle(true);
        return;
      }
      readout.toggle();
    });
  }

  let running = true;
  // The firefly field is the one thing here that animates, and in an editor it
  // is decoration: holding it still costs nothing anyone is authoring and is
  // the difference between a page that draws sixty times a second and one that
  // draws when you touch it. setAnimating(true) turns it back on for anyone who
  // wants a moving picture, and the loop draws every frame again while it is.
  let animating = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (!running) return;
    time += dt;
    // ALWAYS, even on a frame that draws nothing: main.js flushes its ground
    // paint and pumps one palette thumbnail from here, and both would stop.
    onFrame?.(dt);
    stepCamera(dt, now);
    readout.tick(now, dt * 1000);
    if (animating && flies) { flies.update(time, dt); dirty = true; }
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    readout.drew();
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera, level, overlay, ground,
    sync,
    // For main.js, or anyone who changes something this file cannot see.
    invalidate,
    // The readout, so the editor can show a number this file cannot time. See
    // createEditorScene's readout block: mark('review', ms) and the like.
    mark: (name, ms) => readout.mark(name, ms),
    showPerf: (v) => readout.toggle(v),
    get perfOn() { return readout.on; },
    setAnimating(on) { animating = !!on; if (on) invalidate(); },
    // The overlay alone. Moving the pointer with the ground brush up has to
    // redraw the brush ring and nothing else, and a full sync would rebuild
    // the world and revalidate it sixty times a second to move a circle.
    overlayOnly(w, d, opts) { syncOverlay(w, d, opts); invalidate(); },
    syncBadges,
    groundAt,
    pickAt,
    toScreen,
    set onFrame(fn) { onFrame = fn; },
    pause(on = true) {
      running = !on;
      if (on) { placeCamera(); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); dirty = false; }
      else invalidate(true);
    },
    get view() { return view; },
    // HOW FAR OUT. `view` is the half height of the frame in world units, so
    // the 30 unit arena stands on the diagonal and needs about 21 to fit. The
    // ceiling was 60, not quite three times that, and the owner asked for room
    // to spare: 120 is a frame 240 units deep, eight arenas, which is further
    // out than anyone needs and costs nothing to allow. The floor of 3 is close
    // enough to read the lettering on a headstone.
    // ASKS for a view. It does not take effect this instant: the frame loop
    // eases towards it, anchored on the pointer, which is what turns a wheel
    // notch from a jump into a movement. Clamped to maxView, so no amount of
    // scrolling shows void around the level.
    setView(v) {
      viewWant = Math.max(3, Math.min(maxView, v));
      invalidate(true);
    },
    // Straight there, for a keyboard reset or a fit-to-level button.
    setViewNow(v) {
      viewWant = Math.max(3, Math.min(maxView, v));
      view = viewWant;
      applyView();
      clampTarget();
      placeCamera();
    },
    get maxView() { return maxView; },
    get mode() { return mode; },
    setMode(m) { mode = m === 'plan' ? 'plan' : 'game'; placeCamera(); },
    // One to one with the ground under the pointer, because main.js hands this
    // a delta it worked out from two groundAt() readings and those are already
    // world units. What is added here is the memory of the movement, so a drag
    // that is thrown carries on for a moment after the button comes up.
    //
    // The velocity DECAYS while the pointer is held still, so a drag that is
    // parked and then released does not drift. That falls out of the same
    // decay the glide uses and is the whole reason this is safe to do without
    // main.js telling us when the drag ended.
    pan(dx, dz) {
      const now = performance.now();
      const dt = Math.max(0.008, Math.min(0.1, (now - lastPanAt) / 1000));
      lastPanAt = now;
      target.x += dx; target.z += dz;
      clampTarget();
      // Smoothed, or one jittery sample decides the throw.
      panVel.x += ((dx / dt) - panVel.x) * 0.35;
      panVel.y += ((dz / dt) - panVel.y) * 0.35;
      placeCamera();
    },
    lookAt(x, z) { target.set(x, 0, z); clampTarget(); panVel.set(0, 0); placeCamera(); },
    get target() { return target; },
    // The pixel-ratio cap, live. Anything from 0.5 (soft and fast) upward; the
    // display's own ratio is the ceiling, so raising this past it does nothing.
    setQuality({ dpr }) {
      if (dpr > 0) { dprCap = dpr; applyPixelRatio(); resize(); }
    },
    quality() {
      return {
        dprCap,
        devicePixelRatio: window.devicePixelRatio || 1,
        pixelRatio: renderer.getPixelRatio(),
        antialias,
      };
    },
    setOverlayFlags({ footprints, facing }) {
      if (footprints !== undefined) showFootprints = footprints;
      if (facing !== undefined) showFacing = facing;
      invalidate();
    },
    stats() {
      return {
        built: built.size, cuts: holeCuts, cover: cover?.stats, coverMs,
        max: MAX_GROUND_HOLES, wallHeight: WALL.height,
      };
    },
    personalities: PERSONALITIES,
  };
}

export default createEditorScene;
