// The game, on screen.
//
//   /lab/?game=1
//
// This is the third page in the project and the first one you can lose. The
// other two are a free-roam graveyard and an asset lineup; this one builds a
// generated level, runs the rules over it and draws the result.
//
// The division of labour is the whole design and it is worth stating once:
//
//   src/game/layout/  decides WHERE everything is. Headless, no three.
//   src/game/rules.js decides WHAT HAPPENS. Headless, no three.
//   this file         decides what it LOOKS LIKE, and owns nothing else.
//
// Nothing here may make a gameplay decision. If this file ever needs to know
// whether the ghost has been caught, it reads it out of `state`; it never works
// it out. That rule is what let the rules be proved over 3000 levels and a few
// hundred simulated minutes before a single triangle was drawn, and it is worth
// more than any convenience gained by breaking it.
//
// The corollary is that both halves integrate a position, and the rules' one
// wins. See placeGhost below, which is the one genuinely delicate thing here.

import * as THREE from 'three';
import { createGround, addGroundHole } from '../ghost/ground.js';
import { Ghost } from '../ghost/ghost.js';
import { Input } from '../ghost/input.js';
import { createLayout } from './layout/index.js';
import { createGame, TUNING } from './rules.js';
import { createTombstone } from '../ghost/props/stones/index.js';
import { createPumpkin } from '../ghost/props/pumpkin.js';
import { createFencePanel } from '../ghost/props/fence/panel.js';
import { createFireflies } from '../ghost/props/fireflies.js';
import { createSkeletonRig } from '../ghost/props/skeleton/model.js';
import { createSkeletonPerformance } from '../ghost/props/skeleton/perform.js';
import { createGraveHole } from '../ghost/props/ground/hole.js';
import { createSandPath } from '../ghost/props/ground/sandpath.js';

const D = Math.PI / 180;

export async function startGame({ canvas, params }) {
  const seed = Number(params.get('seed')) || 1;
  const testMode = params.get('test') === '1';
  // Fewer props than a full level while this page is young: a 7 by 5 level
  // carries 110 props plus 350 fireflies plus four skeletons, and the point of
  // the first playable build is to find out whether it PLAYS, which a smaller
  // level answers just as well and a great deal faster.
  const cells = (params.get('cells') || '5,4').split(',').map(Number);

  const layout = createLayout({ seed, cells: [cells[0] || 5, cells[1] || 4] });
  const game = createGame({ layout, seed });

  // --- renderer, copied from ghost/main.js -----------------------------------
  // Deliberately copied rather than shared. main.js's rig is tangled with its
  // own scene's needs and pulling it into a module would mean changing the page
  // that is already shipped, on a night when this page does not work yet.
  // Whichever of the two survives should own the rig; today neither does.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(testMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9bec7').convertSRGBToLinear();

  const hemi = new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const LIGHT_DIR = new THREE.Vector3(3.7, 6.0, 2.4).normalize();
  const LIGHT_OFFSET = LIGHT_DIR.clone().multiplyScalar(26);

  // --- camera ----------------------------------------------------------------
  // Looser than the free-roam scene's 6.2. A maze you cannot see the junctions
  // of is a maze you cannot plan in, and Pac-Man is a game of seeing the whole
  // board. This is the one number most likely to want tuning by eye.
  const VIEW = Number(params.get('view')) > 0 ? Number(params.get('view')) : 9.0;
  const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camTarget = new THREE.Vector3(layout.spawns.ghost.x, 0.75, layout.spawns.ghost.z);

  function placeCamera() {
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, 40);
    camera.lookAt(camTarget);
    key.position.copy(camTarget).add(LIGHT_OFFSET);
    key.target.position.copy(camTarget).setY(0);
    key.target.updateMatrixWorld();
  }

  let shadowTexel = 0.01;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.left = -VIEW * aspect;
    camera.right = VIEW * aspect;
    camera.top = VIEW;
    camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    // The shadow box has to cover the visible floor, which at this camera runs
    // far past the frame. Same fit as main.js, scaled to this view size.
    const reach = VIEW * Math.max(1, aspect) * 2.6;
    key.shadow.camera.left = -reach;
    key.shadow.camera.right = reach;
    key.shadow.camera.top = reach;
    key.shadow.camera.bottom = -reach;
    key.shadow.camera.updateProjectionMatrix();
    shadowTexel = (2 * reach) / 2048;
  }

  // --- the floor -------------------------------------------------------------
  const ground = createGround({ fadeStart: 60, fadeEnd: 260 });
  scene.add(ground);

  // --- the maze --------------------------------------------------------------
  // Walls are whole fence runs, which is why the lattice is the panel's own
  // length: `panels` is an integer and no panel is ever cut.
  for (const wall of layout.walls) {
    for (let i = 0; i < wall.panels; i++) {
      const t = (i + 0.5) / wall.panels;
      const panel = createFencePanel({ seed: (wall.panels * 31 + i * 7) | 0 });
      panel.group.position.set(
        wall.a.x + (wall.b.x - wall.a.x) * t,
        0,
        wall.a.z + (wall.b.z - wall.a.z) * t,
      );
      panel.group.rotation.y = wall.yaw;
      scene.add(panel.group);
    }
  }

  // Paths, which are what makes a corridor legible as a corridor rather than as
  // the gap between two fences.
  for (const [i, ribbon] of (layout.paths || []).entries()) {
    if (!ribbon || ribbon.length < 2) continue;
    const path = createSandPath({ seed: 7 + i, width: 1.35, points: ribbon });
    scene.add(path.group);
  }

  // --- props -----------------------------------------------------------------
  const holes = [];
  for (const p of layout.props) {
    let built = null;
    if (p.kind === 'stone') built = createTombstone({ variant: p.variant, seed: (p.x * 977 + p.z * 131) | 0 });
    else if (p.kind === 'pumpkin') built = createPumpkin({ variant: p.variant, seed: (p.x * 613 + p.z * 89) | 0 });
    else if (p.kind === 'hole' && holes.length < 4) {
      const h = createGraveHole({ seed: (p.x * 331) | 0 });
      built = h;
      holes.push(h);
    }
    // Anything else the layout emits that this page does not know how to build
    // yet is skipped rather than guessed at. The level is still valid: a
    // missing bench changes nothing about whether a corridor is clear.
    if (!built) continue;
    built.group.position.set(p.x, 0, p.z);
    built.group.rotation.y = p.yaw || 0;
    scene.add(built.group);
    if (built.registerWith) built.registerWith(ground);
  }

  // --- fireflies -------------------------------------------------------------
  // One field for the whole level, because it is one draw call however many
  // there are, and `collect(i)` indexes it by the same i the rules use.
  const flies = createFireflies({ seed: 5, points: layout.fireflies });
  scene.add(flies.group);

  // The power pellets. A lit jack-o'-lantern is the brightest object in the
  // scene, which is the joke and also why they are legible from across a level.
  const lanterns = layout.powerups.map((p, i) => {
    // createPumpkin has no unlit mode: every one of them carries its candle,
    // which is exactly what a power pellet wants.
    const made = createPumpkin({ variant: 'classic', seed: 40 + i });
    made.group.position.set(p.x, 0, p.z);
    scene.add(made.group);
    return made;
  });

  // --- the ghost -------------------------------------------------------------
  const ghost = new Ghost({ seed: 12345 });
  // The visual ghost integrates the SAME model as the rules at the SAME speed,
  // so the correction applied below is a few millimetres a frame everywhere
  // except at a wall. Leaving it at 4.5 would make the sheet fight the rules
  // continuously and read as drag.
  ghost.opts.maxSpeed = TUNING.ghostSpeed;
  ghost.pos.set(layout.spawns.ghost.x, ghost.pos.y, layout.spawns.ghost.z);
  ghost.cloth.reset(ghost.matrix);
  scene.add(ghost.mesh);

  // Both halves integrate a position and the rules' one wins, because it is the
  // one that collides with walls and the one the skeletons chase. But the cloth
  // solves in WORLD space off this.matrix, so teleporting the anchor tears the
  // sheet. So the ghost is stepped normally, with the real input, and then its
  // anchor is corrected onto the rules' answer. Away from walls the two agree
  // to within a millimetre and the correction is invisible; at a wall the rules
  // stop and this is what stops the sheet walking through it.
  function placeGhost(st) {
    ghost.pos.x = st.ghost.x;
    ghost.pos.z = st.ghost.z;
    // The velocity has to be corrected too, or the body keeps its momentum
    // into the wall, the flare and the trail keep reporting a run, and the
    // ghost reads as sprinting on the spot.
    ghost.vel.x = st.ghost.vx;
    ghost.vel.z = st.ghost.vz;
  }

  // --- the skeletons ---------------------------------------------------------
  // perform.js owns the figure and the gait; the rules own where it is. The
  // `driver` hook is what joins them: see its comment in perform.js.
  const rigs = game.state.skeletons.map((s, i) => {
    const rig = createSkeletonRig();
    rig.group.position.set(s.grave.x, 0, s.grave.z);
    scene.add(rig.group);
    let want = null;
    const perf = createSkeletonPerformance({
      rig, scene, renderer, seed: 5 + i,
      driver: () => want,
    });
    perf.moveHome(s.grave.x, s.grave.z, 0);
    return { rig, perf, set: (w) => { want = w; } };
  });

  // How a rules state maps onto a performance phase. 'leaving' is the walk out
  // of the pen and it is already a walk, so it drives like a hunt.
  const PHASE = {
    buried: 'buried',
    emerging: 'emerging',
    leaving: 'chasing',
    hunting: 'chasing',
    frightened: 'chasing',
    eaten: 'chasing',
    sinking: 'settling',
  };

  // --- HUD -------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.appendChild(hud);
  let lastHud = '';
  function drawHud(st) {
    const line = st.phase === 'over' ? 'GAME OVER'
      : st.phase === 'cleared' ? 'CLEARED'
        : `${st.score}  ${'●'.repeat(Math.max(0, st.lives))}  ${st.fireflies.remaining}`;
    const text = st.power ? `${line}  POWER` : line;
    if (text !== lastHud) { hud.textContent = text; lastHud = text; }
  }

  // --- input and loop --------------------------------------------------------
  const input = new Input(canvas, camera);
  placeCamera();
  resize();
  window.addEventListener('resize', resize);

  function follow(dt) {
    const k = 1 - Math.exp(-dt * 5.6);
    camTarget.x += (ghost.pos.x - camTarget.x) * k;
    camTarget.z += (ghost.pos.z - camTarget.z) * k;
    placeCamera();
    // Snap the light's target to whole shadow texels, or the map slides under
    // the geometry as the camera follows and every shadow edge crawls.
    const snap = Math.max(1e-4, shadowTexel);
    key.target.position.set(
      Math.round(camTarget.x / snap) * snap,
      0,
      Math.round(camTarget.z / snap) * snap,
    );
    key.position.copy(key.target.position).add(LIGHT_OFFSET);
    key.target.updateMatrixWorld();
  }

  let time = 0;
  let scripted = null;
  function advance(dt) {
    time += dt;
    // input.sample takes the ghost's position because the drag control is
    // relative to where the ghost is on screen. `override` is the harness's
    // way in: a capture script drives a scripted stick and must not be
    // fighting a mouse that is not there.
    const axis = scripted || input.sample(ghost.pos);
    const st = game.update(dt, axis);

    ghost.update(dt, axis);
    placeGhost(st);

    for (let i = 0; i < st.skeletons.length; i++) {
      const s = st.skeletons[i];
      const r = rigs[i];
      if (!r) continue;
      r.perf.setPhase(PHASE[s.state] || 'chasing');
      r.set({ x: s.x, z: s.z, yaw: s.yaw, dist: Math.hypot(s.x - st.ghost.x, s.z - st.ghost.z) });
      r.perf.update(dt, null);
    }

    // The cue list. The rules never touch a mesh, so this is the only place a
    // firefly is told it has been eaten.
    for (const e of st.events) {
      if (e.type === 'firefly') flies.collect(e.index);
      else if (e.type === 'power' && lanterns[e.index]) lanterns[e.index].group.visible = false;
    }

    flies.update(time, dt);
    for (const l of lanterns) l.update?.(time, dt);
    follow(dt);
    drawHud(st);
  }

  let live = !testMode;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!live) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    advance(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // The harness hook, same shape as the other two pages so the capture scripts
  // can drive this one too.
  window.__game = {
    setSize(w, h) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; resize(); },
    step(dt = 1 / 60, axis = null) {
      live = false;
      scripted = axis;
      advance(dt);
      renderer.render(scene, camera);
    },
    state: () => game.state,
    layout,
  };
  window.__gameReady = true;
}
