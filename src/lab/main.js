import * as THREE from 'three';
import { createGround } from '../ghost/ground.js';

// The asset lineup. Every prop in the project, laid out on the real scene's
// floor and lighting, all turning together so each one can be seen from every
// side without anyone driving a ghost around a graveyard to find it.
//
// This is what /lab/ is for now. The playable graveyard is still there at
// /lab/?play=1, which loads the game exactly as it was; nothing about it has
// moved. The two share a floor and a light rig and nothing else.
//
// preview.html remains the single-prop turntable used by the capture scripts.
// This page is the whole set at once, which is a different question: a prop can
// be right on its own and wrong beside its neighbours, and the fence, the shed
// and the tombstones all have to look like the same workshop made them.

const params = new URLSearchParams(location.search);

if (params.get('play') === '1') {
  // The graveyard, untouched. Imported dynamically so a page showing the
  // lineup never pays for the game's module graph and vice versa.
  await import('../ghost/main.js');
} else {
  await buildLineup();
}

async function buildLineup() {
  const canvas = document.getElementById('view');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The skeleton's climb clips itself against the floor, and the fountain does
  // not, but the flag is per renderer and costs nothing on materials that carry
  // no planes.
  renderer.localClippingEnabled = true;

  const BACKDROP = new THREE.Color('#b9bec7').convertSRGBToLinear();
  const scene = new THREE.Scene();
  scene.background = BACKDROP;

  // Same rig as preview.html and as the scene itself. A prop judged under
  // different light from the one it ships in is not judged.
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.position.set(3.7, 6.0, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);
  scene.add(createGround());

  // --- layout ---------------------------------------------------------------
  // Cells are chosen in SCREEN units and written in world ones, because a grid
  // picked in world space comes out as a lozenge under this camera. Screen
  // right is (x - z) / sqrt(2) and screen up is -(x + z) / sqrt(2), so this
  // inverts that.
  const K = Math.SQRT1_2;
  const atScreen = (right, up) => [(right - up) * K, (-up - right) * K];

  // Spacing is set by the widest thing here, which is the shed at about 2.7
  // across, plus room for it to turn without its corner entering the next cell.
  const CELL = 4.0;
  const COLS = 5;

  const items = [];
  let slot = 0;

  // Where a slot lands, in world. The whole grid is shifted so that SLOT 0 sits
  // at the world origin, because slot 0 is the ghost and the ghost cannot be
  // moved. Its cloth solves in world space and writes world coordinates into
  // the geometry, so it has no usable transform of its own: the first version
  // of this file put it in a positioned group and the sheet tore off across the
  // floor as a spike, and setting its `pos` after construction only teleported
  // the anchor and stretched the sheet from wherever the particles already
  // were. Moving the grid instead of the ghost costs nothing and cannot fail.
  function slotAt(n) {
    const col = n % COLS;
    const row = Math.floor(n / COLS);
    return atScreen((col - (COLS - 1) / 2) * CELL, -row * CELL);
  }
  const [BASE_X, BASE_Z] = slotAt(0);

  function place(entry) {
    const [sx, sz] = slotAt(slot);
    slot += 1;
    const x = sx - BASE_X;
    const z = sz - BASE_Z;
    entry.group.position.set(x, 0, z);
    scene.add(entry.group);
    entry.anchor = new THREE.Vector3(x, 0, z);
    items.push(entry);
    return entry;
  }

  const [
    ghostMod, pumpkin, tombstones, panel, broken, debris, gate, skeleton, fountain, shed,
  ] = await Promise.all([
    import('../ghost/ghost.js'),
    import('../ghost/props/pumpkin.js'),
    import('../ghost/props/tombstones.js'),
    import('../ghost/props/fence/panel.js'),
    import('../ghost/props/fence/broken.js'),
    import('../ghost/props/fence/debris.js'),
    import('../ghost/props/fence/gate.js'),
    import('../ghost/props/skeleton/model.js'),
    import('../ghost/props/fountain/index.js'),
    import('../ghost/props/shed/index.js'),
  ]);

  // Slot 0, and the reason the grid is offset rather than the ghost. See
  // slotAt above. It stays at the world origin, unparented and unspun: turning
  // a group under a cloth solver drags the sheet sideways every frame.
  {
    const g = new ghostMod.Ghost({ seed: 12345 });
    scene.add(g.mesh);
    slot += 1;
    // Settled before the first frame is shown. A sheet released from its rest
    // pose swings for about a second, and a lineup whose first asset is
    // flapping reads as broken rather than as alive.
    for (let i = 0; i < 120; i++) g.update(1 / 60, { x: 0, y: 0 });
    items.push({
      label: 'ghost',
      group: g.mesh,
      spin: false,
      anchor: new THREE.Vector3(0, 0, 0),
      update: (time, dt) => g.update(dt, { x: 0, y: 0 }),
    });
  }

  place({ label: 'skeleton', group: skeleton.createSkeletonRig().group });

  for (const variant of pumpkin.PUMPKIN_VARIANTS) {
    const p = pumpkin.createPumpkin({ variant, seed: 3 });
    place({ label: `pumpkin ${variant}`, group: p.group, update: p.update });
  }

  for (const variant of tombstones.VARIANTS) {
    const t = tombstones.createTombstone({ variant, seed: 11 });
    place({ label: `stone ${variant}`, group: t.group, update: t.update });
  }

  place({ label: 'fence panel', group: panel.createFencePanel({ seed: 4 }).group });
  place({ label: 'fence broken', group: broken.createBrokenPanel({ seed: 21, damage: 0.7 }).group });

  {
    const g = gate.createGate({ seed: 6, hingeSide: 'left' });
    // Held ajar rather than shut, so the leaf, the hinge post and the latch
    // post are three separate things instead of one flat wall.
    g.hinge.rotation.y = -0.55;
    place({ label: 'gate', group: g.group });
  }

  {
    const holder = new THREE.Group();
    holder.add(debris.createDebrisPile({ seed: 7 }).group);
    holder.add(debris.createChipScatter({ seed: 7, count: 120 }).group);
    place({ label: 'fence debris', group: holder });
  }

  {
    const f = fountain.createFountain({ seed: 1 });
    const holder = new THREE.Group();
    holder.add(f.group);
    const col = fountain.createBrokenColumn({ seed: 2 });
    col.group.position.set(-0.62, 0, 0.86);
    holder.add(col.group);
    const drum = fountain.createFallenDrum({ seed: 3 });
    drum.group.position.set(0.42, 0, 0.94);
    holder.add(drum.group);
    holder.add(fountain.createMarbleChips({ seed: 4, count: 34, radius: 1.25, inner: 0.62 }).group);
    place({ label: 'fountain', group: holder, update: f.update });
  }

  place({ label: 'shed', group: shed.createShed({ seed: 3 }).group });

  // --- camera ---------------------------------------------------------------
  const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const target = new THREE.Vector3();
  let view = 10;
  // Read before the fit below rather than after, since the fit divides by it.
  let aspect = (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight);

  // Frame the whole lineup on the axes the camera actually uses. Fitting on
  // world Y instead is how a wide layout ends up overflowing sideways.
  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(CAM_DIR).normalize();
  const right = new THREE.Vector3().crossVectors(CAM_DIR, up).normalize();
  {
    const box = new THREE.Box3();
    for (const it of items) box.expandByObject(it.group);
    const centre = box.getCenter(new THREE.Vector3());
    target.copy(centre);
    let halfUp = 0;
    let halfRight = 0;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).sub(centre);
      halfUp = Math.max(halfUp, Math.abs(corner.dot(up)));
      halfRight = Math.max(halfRight, Math.abs(corner.dot(right)));
    }
    // Fit on both screen axes, with the horizontal one divided by the aspect
    // because the frustum is widened by it. A little slack for the labels,
    // which hang below each item.
    view = Math.max(halfUp, halfRight / Math.max(0.5, aspect)) * 1.10;
  }
  const home = { target: target.clone(), view };

  function place3() {
    camera.left = -view * aspect;
    camera.right = view * aspect;
    camera.top = view;
    camera.bottom = -view;
    camera.updateProjectionMatrix();
    camera.position.copy(target).addScaledVector(CAM_DIR, 60);
    camera.lookAt(target);
    // The shadow camera has to cover the whole VISIBLE GROUND, which is a much
    // bigger ask than covering the lineup, and getting it wrong does not look
    // like a missing shadow. Beyond the shadow camera's frustum three leaves
    // surfaces unshadowed, so the floor there renders a shade brighter, and
    // because the frustum is a box in LIGHT space its edge lands on the ground
    // as a hard straight diagonal. The first version of this page had one, and
    // it read as a twenty unit white wedge lying across the corner of the
    // scene. It was the floor.
    //
    // The factor is generous rather than derived: the ground the camera sees is
    // the view box divided by the sine of the light's elevation, and a margin
    // on top of that is cheaper than another round of this. 4096 keeps the
    // texel small enough at that size in a browser. Tried and reverted: the
    // software rasteriser the capture harness uses dies outright on a 4096 map
    // here, so it stays at 2048 and the shadows are a little softer than they
    // would be in the scene, which for an inspection page is a fair trade.
    const s = view * 2.6;
    key.shadow.camera.left = -s * aspect;
    key.shadow.camera.right = s * aspect;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.camera.far = 140;
    key.shadow.camera.updateProjectionMatrix();
    key.target.position.copy(target).setY(0);
    key.position.copy(key.target.position).add(new THREE.Vector3(3.7, 6.0, 2.4).multiplyScalar(4));
    key.target.updateMatrixWorld();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    aspect = w / h;
    renderer.setSize(w, h, false);
    place3();
  }
  window.addEventListener('resize', resize);

  // --- labels ---------------------------------------------------------------
  // HTML rather than textures. The text stays crisp at any zoom, costs no draw
  // calls, and does not have to be re-baked when a name changes.
  const layer = document.getElementById('labels');
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'tag';
    el.textContent = it.label;
    layer.appendChild(el);
    it.el = el;
  }

  const v = new THREE.Vector3();
  function positionLabels() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    for (const it of items) {
      v.copy(it.anchor).project(camera);
      it.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      it.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      // Cull rather than let a label sit on the edge pointing at nothing.
      it.el.style.opacity = Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 ? '1' : '0';
    }
  }

  // --- controls -------------------------------------------------------------
  // Drag to pan, wheel to zoom, because "inspect" means getting closer to one
  // of them, and a fixed frame of seventeen assets is a contact sheet rather
  // than an inspection.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = canvas.clientHeight || window.innerHeight;
    // Pixels to world, along the camera's own screen axes, so a drag moves the
    // scene exactly as far as the cursor went.
    const k = (2 * view) / h;
    target.addScaledVector(right, -(e.clientX - lastX) * k);
    target.addScaledVector(up, (e.clientY - lastY) * k);
    lastX = e.clientX;
    lastY = e.clientY;
    place3();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view = Math.min(home.view * 1.5, Math.max(0.6, view * Math.exp(e.deltaY * 0.0012)));
    place3();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      target.copy(home.target);
      view = home.view;
      place3();
    }
    if (e.key === ' ') { spinning = !spinning; e.preventDefault(); }
  });

  // --- loop -----------------------------------------------------------------
  // One revolution every twenty seconds, all of them together. Together
  // matters: a set turning in step can be compared face to face, and a set
  // turning at its own rates cannot.
  const TURN = (Math.PI * 2) / 20;
  let spinning = true;
  let spin = 0;
  let time = 0;
  let last = performance.now();

  resize();

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    if (spinning) spin += TURN * dt;
    for (const it of items) {
      if (it.spin !== false) it.group.rotation.y = spin;
      it.update?.(time, dt);
    }
    positionLabels();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // The capture harness drives this the same way it drives every other page.
  // Handles for a headless probe. Cheap, and the alternative is guessing at
  // which object is the twenty unit white wedge in the corner of a render.
  window.__lab = {
    // Everything in the scene bigger than a threshold, whatever it is and
    // whoever put it there.
    big(min = 5) {
      const box = new THREE.Box3();
      const out = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        box.setFromObject(o);
        const s = box.getSize(new THREE.Vector3());
        if (Math.max(s.x, s.y, s.z) >= min) {
          const c = box.getCenter(new THREE.Vector3());
          out.push({ name: o.name || o.type, mat: o.material?.type, size: [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)], centre: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)] });
        }
      });
      return out;
    },
    bounds() {
      const box = new THREE.Box3();
      return items.map((it) => {
        box.setFromObject(it.group);
        const s = box.getSize(new THREE.Vector3());
        const c = box.getCenter(new THREE.Vector3());
        return { label: it.label, size: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)], centre: [+c.x.toFixed(2), +c.z.toFixed(2)] };
      });
    },
  };

  window.__preview = {
    setSize(w, h) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      resize();
    },
    step(dt = 1 / 60, at = null) {
      if (at !== null) spin = at;
      else spin += TURN * dt;
      time += dt;
      for (const it of items) {
        if (it.spin !== false) it.group.rotation.y = spin;
        it.update?.(time, dt);
      }
      positionLabels();
      renderer.render(scene, camera);
    },
  };
  window.__previewReady = true;
}
