import * as THREE from 'three';
import { Ghost } from './ghost.js';
import { createGround } from './ground.js';
import { Input } from './input.js';
import { createPumpkin } from './props/pumpkin.js';
import { createTombstone } from './props/tombstones.js';
import { createFencePanel } from './props/fence/panel.js';
import { createBrokenPanel } from './props/fence/broken.js';
import { createDebrisPile, createChipScatter } from './props/fence/debris.js';
import { createGate, GATE_LAYOUT } from './props/fence/gate.js';
import { createSwing } from './props/fence/swing.js';
import { createSkeletonRig } from './props/skeleton/model.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const BACKDROP = new THREE.Color('#b9bec7').convertSRGBToLinear();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: testMode,
});
renderer.setPixelRatio(testMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = BACKDROP;
scene.fog = new THREE.Fog(BACKDROP, 24, 52);

// True isometric-ish: 45 degrees around, ~30 degrees up, orthographic so there
// is no perspective convergence.
const VIEW_SIZE = 6.2;
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const camTarget = new THREE.Vector3(0, 0.75, 0);

function placeCamera() {
  camera.position.copy(camTarget).addScaledVector(CAM_DIR, 20);
  camera.lookAt(camTarget);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const aspect = w / h;
  camera.left = -VIEW_SIZE * aspect;
  camera.right = VIEW_SIZE * aspect;
  camera.top = VIEW_SIZE;
  camera.bottom = -VIEW_SIZE;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  fitShadowToView(aspect);
}

// --- lighting ---------------------------------------------------------------

const hemi = new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 30;
key.shadow.camera.left = -8;
key.shadow.camera.right = 8;
key.shadow.camera.top = 8;
key.shadow.camera.bottom = -8;
// Peter-panning: a large normalBias pushes the shadow away along the surface
// normal, and on a prop whose sides are near-vertical where it meets the floor
// that opens a bright gap between the prop and its own shadow. The shadow
// camera is 16 units across at 2048, so a texel is ~8mm and 0.02 was two and a
// half of them. Pulled down to just enough to stop the floor self-shadowing.
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.006;
key.shadow.radius = 3;
scene.add(key);
scene.add(key.target);

// The shadow camera has to cover what is on screen, and the visible ground is
// far bigger than it looks. An orthographic camera 6.2 half-heights tall,
// looking down at 29 degrees, lays the floor out so its far corners sit about
// 16 units from the middle of the frame: 32 units of ground across, against
// the 16 the old fixed -8..8 box covered. Every prop past that simply stopped
// casting, which is why shadows vanished toward the edges of the scene, and
// worse, which props were past it changed as the camera followed the ghost.
//
// So the box is fitted to the visible ground instead of guessed. The light's
// direction never changes, only its position, so the extents depend on aspect
// alone and this runs on resize rather than per frame.
// Direction only. Where a directional light SITS does not change its shading,
// but it does decide what its shadow camera can see, and the old position was
// 7.3 units from the middle of the frame while the visible floor runs out to
// 17.9. Half the ground was literally behind the lamp. Standing it well back
// along the same direction puts the whole scene in front of it.
// This direction is a deliberate choice, not an oversight, and it was tried
// the other way. From here a shadow travels mostly up the screen and only
// slightly sideways, so it tucks in behind the thing that cast it and stays
// short. Swinging the key to the screen's upper left throws every shadow down
// and to the right into open floor, which is the conventional isometric setup
// and makes each one far more visible: the user looked at both and preferred
// this, because the alternative put too much shadow in the frame. Keep it.
//
// Note that this is separate from the shadow camera's coverage. That was a
// real bug and its fix stands whichever way the light points.
const LIGHT_DIR = new THREE.Vector3(3.2, 6.0, 2.4).normalize();
const LIGHT_DIST = 26;
const LIGHT_OFFSET = LIGHT_DIR.clone().multiplyScalar(LIGHT_DIST);
// Tall enough to hold the skeleton, which stands 2.5.
const CAST_HEIGHT = 3.0;
let shadowTexel = 1;

function fitShadowToView(aspect) {
  // Ground corners of the view frustum, as offsets from whatever the camera is
  // looking at. Orthographic, so they do not depend on where that is.
  const probe = new THREE.OrthographicCamera(
    -VIEW_SIZE * aspect, VIEW_SIZE * aspect, VIEW_SIZE, -VIEW_SIZE, 0.1, 100,
  );
  probe.position.copy(CAM_DIR).multiplyScalar(20);
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld(true);
  probe.updateProjectionMatrix();
  const dir = CAM_DIR.clone().negate();

  // A Camera, not a plain Object3D. Object3D.lookAt points +Z AT the target
  // while a camera points -Z at it, so a plain Object3D here silently flips
  // the depth axis and every near and far plane comes out inside out.
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
  // The camera looks down -z in its own space, so a point in front of it has
  // negative z and its distance is -z. Nearest is -box.max.z, furthest is
  // -box.min.z. Getting this inverted is what clipped the middle of the scene
  // out of the shadow map and made the ghost's own shadow vanish.
  c.near = Math.max(0.05, -box.max.z - CAST_HEIGHT);
  c.far = -box.min.z + CAST_HEIGHT;
  c.updateProjectionMatrix();

  shadowTexel = (c.right - c.left) / key.shadow.mapSize.width;
}

// The rim edges the side the key does not reach, so it sits opposite it.
const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
rim.position.set(-4, 2.5, -3);
scene.add(rim);

// --- world ------------------------------------------------------------------

const ground = createGround();
scene.add(ground);

// A fixed seed in test mode so scripted runs reproduce the same blinks
// and glances frame for frame.
const ghost = new Ghost(testMode ? { seed: 12345 } : {});
scene.add(ghost.mesh);

// --- props ------------------------------------------------------------------
// This camera projects +X to screen-right-down and +Z to screen-left-down, so
// a yaw of PI/4 turns a prop's local +Z face toward the viewer.
//
// The page decides how much of the world to build. /ghostly/ is the version
// that goes out to people, and it is deliberately just the ghost and the
// floor: nothing half-finished, nothing that might be mid-rework. /lab/ loads
// everything currently being built. The two share this file rather than
// forking it, so the public page never drifts away from what is being tested.
const SCENE = document.body.dataset.scene === 'minimal' ? 'minimal' : 'full';
const props = [];
// Scene-level updaters that are not props in their own right, such as the one
// driving the gate from the ghost's motion.
const gateProps = [];
let gateAngle = () => 0;

function addProp(prop, x, z, yaw = Math.PI / 4) {
  prop.group.position.set(x, 0, z);
  prop.group.rotation.y = yaw;
  scene.add(prop.group);
  props.push(prop);
  return prop;
}

// Positions are solved in screen axes rather than guessed in world ones:
// screen-right is (x - z) / sqrt(2) and screen-up is -(x + z) / sqrt(2). Picked
// in world space, the first stone sat directly behind the ghost.
function atScreen(right, up) {
  const k = Math.SQRT1_2;
  return [(right - up) * k, (-up - right) * k];
}

// A small graveyard rather than a test rig: stones set back along the top of
// the frame, pumpkins down front, and the middle two thirds left empty so the
// ghost always has somewhere to drift. Every prop is turned near PI/4 -- enough
// variation to look hand-placed, close enough that the carved faces and the
// inscriptions stay readable from this one fixed camera.
//
// Pumpkin count is deliberate: each one carries a spotlight, and every lit
// material in the scene pays for all of them.
const GRAVES = [
  { variant: 'cross', right: -3.3, up: 2.7, yaw: Math.PI / 4 - 0.34 },
  { variant: 'fred', right: -1.9, up: 1.9, yaw: Math.PI / 4 + 0.52 },
  { variant: 'bat', right: 1.5, up: 2.5, yaw: Math.PI / 4 - 0.18 },
  { variant: 'cross', right: 3.1, up: 1.7, yaw: Math.PI / 4 + 0.66 },
  { variant: 'fred', right: -4.4, up: 1.2, yaw: Math.PI / 4 - 0.88 },
  { variant: 'bat', right: 4.4, up: 3.0, yaw: Math.PI / 4 - 0.60 },
];

if (SCENE === 'full') {
  for (const [i, g] of GRAVES.entries()) {
    const [x, z] = atScreen(g.right, g.up);
    addProp(createTombstone({ variant: g.variant, seed: 11 + i * 13 }), x, z, g.yaw);
  }
}

const PUMPKINS = [
  { variant: 'classic', right: -2.6, up: -1.9, yaw: Math.PI / 4 + 0.30 },
  { variant: 'squat', right: 2.7, up: -2.3, yaw: Math.PI / 4 - 0.42 },
  { variant: 'pear', right: 3.9, up: 0.5, yaw: Math.PI / 4 + 0.08 },
  { variant: 'gourd', right: -4.9, up: -1.2, yaw: Math.PI / 4 - 0.55 },
  { variant: 'tiny', right: -3.0, up: 2.3, yaw: Math.PI / 4 + 0.9 },
  { variant: 'tall', right: 1.1, up: -2.9, yaw: Math.PI / 4 + 0.18 },
];

if (SCENE === 'full') {
  for (const [i, spot] of PUMPKINS.entries()) {
    const [x, z] = atScreen(spot.right, spot.up);
    addProp(createPumpkin({ variant: spot.variant, seed: 3 + i * 7 }), x, z, spot.yaw);
  }

  // The fence lays the ground out into burial plots with paths between them,
  // which is what a cemetery actually looks like from above and what turns a
  // scattering of headstones into somewhere.
  //
  // Panels run along their own local X, and this camera maps world (1,0,-1) to
  // screen-right and world (-1,0,-1) to screen-up. So a panel turned PI/4 runs
  // across the screen and one turned 3*PI/4 runs up it, and a plot laid out in
  // screen units comes out as a rectangle on screen rather than a lozenge.
  const PANEL = 2.0;
  const FENCE_UP_PLOT = 0.6;
  const ACROSS = Math.PI / 4;
  const UPWARD = (3 * Math.PI) / 4;

  // One side of a plot. `gap` drops a panel to leave a way in, counted from the
  // start of the run; `broken` swaps one for a wrecked panel instead.
  function fenceRun({ right, up, along, count, seed, gap = -1, broken = -1 }) {
    for (let i = 0; i < count; i++) {
      if (i === gap) continue;
      const step = (i + 0.5) * PANEL;
      const r = along === 'across' ? right + step : right;
      const u = along === 'across' ? up : up + step;
      const [x, z] = atScreen(r, u);
      const part = i === broken
        ? createBrokenPanel({ seed: seed + i * 17, damage: 0.55 + 0.35 * ((i * 7) % 3) / 2 })
        : createFencePanel({ seed: seed + i * 17 });
      addProp(part, x, z, along === 'across' ? ACROSS : UPWARD);
    }
  }

  // A plot, addressed by its near-left corner in screen units. Width and height
  // are in panels, so the corners always meet.
  function fencePlot({ right, up, w, h, seed, gates = {}, broken = {} }) {
    fenceRun({ right, up, along: 'across', count: w, seed, gap: gates.front ?? -1, broken: broken.front ?? -1 });
    fenceRun({ right, up: up + h * PANEL, along: 'across', count: w, seed: seed + 101, gap: gates.back ?? -1, broken: broken.back ?? -1 });
    fenceRun({ right, up, along: 'up', count: h, seed: seed + 202, gap: gates.left ?? -1, broken: broken.left ?? -1 });
    fenceRun({ right: right + w * PANEL, up, along: 'up', count: h, seed: seed + 303, gap: gates.right ?? -1, broken: broken.right ?? -1 });
  }

  // Two sections with a path up the middle and a path across the front. The
  // left plot is kept, the right one has lost a stretch of its back fence.
  fencePlot({ right: -7.0, up: FENCE_UP_PLOT, w: 3, h: 2, seed: 4, gates: { front: 1 } });

  // A gate standing in the gap that plot leaves in its front fence. The
  // geometry is a real double-acting gate and the physics is a real pendulum,
  // so the two are wired with the options each half asked for: no framed stop,
  // and damping 2.0 rather than the module's default, because with nothing to
  // strike there is no other loss in the system and at 0.6 the leaf rings above
  // two degrees for fifteen seconds like a metronome.
  const gate = createGate({ seed: 6, hingeSide: 'left' });
  const swing = createSwing({
    stop: 'none',
    damping: 2.0,
    latchAngle: GATE_LAYOUT.latchAngle,
    length: 0.5,
  });
  {
    const [gx, gz] = atScreen(-7.0 + 1.5 * PANEL, FENCE_UP_PLOT);
    addProp(gate, gx, gz, ACROSS);
  }

  // The ghost shoves the gate by walking through it. The impulse is his speed
  // ACROSS the gate's closed plane, so brushing it sideways barely moves it and
  // running straight through throws it wide, and the sign decides which way it
  // swings. A cooldown stops a ghost loitering in the gap from pumping the leaf
  // every frame, which is a pendulum driven at its own frequency and goes over
  // the top given a few seconds.
  const gateAt = new THREE.Vector3();
  const gatePlane = new THREE.Vector3(Math.sin(ACROSS + Math.PI / 2), 0, Math.cos(ACROSS + Math.PI / 2));
  const toGhost = new THREE.Vector3();
  let gateCooldown = 0;
  // Reported through the test hook so the wiring can be checked without
  // rendering: the lab scene is heavy enough that a software-rendered strip of
  // frames takes minutes, and the question here is only whether the ghost's
  // passage drives the leaf.
  gateAngle = () => swing.angle;
  gateProps.push({
    update(dt) {
      gate.hinge.getWorldPosition(gateAt);
      toGhost.subVectors(ghost.pos, gateAt).setY(0);
      gateCooldown = Math.max(0, gateCooldown - dt);
      if (toGhost.length() < PANEL * 0.7 && gateCooldown === 0) {
        const through = ghost.vel.dot(gatePlane);
        if (Math.abs(through) > 0.4) {
          swing.push(through * 5.5);
          gateCooldown = 0.5;
        }
      }
      swing.update(dt);
      gate.hinge.rotation.y = swing.angle;
    },
  });
  fencePlot({ right: 1.0, up: FENCE_UP_PLOT, w: 3, h: 2, seed: 40, gates: { front: 1 }, broken: { back: 1, right: 0 } });

  // The skeleton, standing in its rest pose so it can be judged before anyone
  // rigs it. Out on the path between the two plots, turned a little off square
  // because dead-on hides the depth of the ribcage and the pelvis both.
  const [skx, skz] = atScreen(-1.0, -1.8);
  addProp(createSkeletonRig(), skx, skz, Math.PI / 4 + 0.35);

  // The wreckage sits in the breach in the right plot's back fence.
  const [bx, bz] = atScreen(1.0 + 1.5 * PANEL, 0.6 + 2 * PANEL - 0.35);
  addProp(createDebrisPile({ seed: 7 }), bx, bz, ACROSS);
  addProp(createChipScatter({ seed: 7, count: 150 }), bx, bz, ACROSS);
}

const input = new Input(canvas, camera);

placeCamera();
resize();
window.addEventListener('resize', resize);

// --- loop -------------------------------------------------------------------

function follow(dt) {
  const k = 1 - Math.exp(-dt * 5.6);
  camTarget.x += (ghost.pos.x - camTarget.x) * k;
  camTarget.z += (ghost.pos.z - camTarget.z) * k;
  placeCamera();

  // Snap the light's target to whole shadow texels. Without it the map slides
  // continuously under the geometry as the camera follows the ghost, and every
  // shadow edge crawls and shimmers the whole time he is moving.
  const snap = Math.max(1e-4, shadowTexel);
  key.target.position.set(
    Math.round(camTarget.x / snap) * snap,
    0,
    Math.round(camTarget.z / snap) * snap,
  );
  key.position.copy(key.target.position).add(LIGHT_OFFSET);
  key.target.updateMatrixWorld();

  ground.userData.uniforms.uFocus.value.copy(camTarget);
}

let sceneTime = 0;

function step(dt, axis) {
  sceneTime += dt;
  ghost.update(dt, axis);
  // The pumpkin's lamp flickers, so props advance with the scene clock rather
  // than a wall clock -- a scripted capture then reproduces the same flame.
  for (const prop of props) prop.update?.(sceneTime, dt);
  for (const g of gateProps) g.update(dt);
  follow(dt);
  renderer.render(scene, camera);
}

let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  step(dt, input.sample(ghost.pos));
}

// --- test hook --------------------------------------------------------------
// Lets the capture harness drive the simulation frame by frame with scripted
// input, so cloth behaviour can be checked without a human at the keyboard.

window.__ghost = {
  // Shadow coverage is invisible until something stops casting, and then it is
  // hard to tell a frustum miss from a lighting bug. This reports the fitted
  // box and whether a given world point would land inside it.
  shadow(points = []) {
    const c = key.shadow.camera;
    c.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    const v = new THREE.Vector3();
    return {
      box: { left: c.left, right: c.right, top: c.top, bottom: c.bottom, near: c.near, far: c.far },
      target: key.target.position.toArray(),
      inside: points.map((p) => {
        v.set(p[0], p[1], p[2]).applyMatrix4(m);
        return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1;
      }),
    };
  },
  step(dt, axis) {
    step(dt, { x: axis?.x ?? 0, y: axis?.y ?? 0, jump: !!axis?.jump });
  },
  state() {
    return {
      gate: gateAngle(),
      pos: ghost.pos.toArray(),
      vel: ghost.vel.toArray(),
      yaw: ghost.yaw,
      grounded: ghost.grounded,
      ...ghost.metrics(),
      particles: ghost.cloth.count,
      constraints: ghost.cloth.constraintCount,
      // Lid state, so the harness can assert that expressions actually fire
      // rather than relying on someone spotting them in a crop.
      eye: {
        open: +ghost.eyeUniforms.uOpen.value.toFixed(3),
        tilt: +ghost.eyeUniforms.uTilt.value.toFixed(3),
        curve: +ghost.eyeUniforms.uCurve.value.toFixed(3),
        scaleY: +ghost.eyeUniforms.uEyeScale.value.y.toFixed(3),
      },
    };
  },
  // Forces lid parameters and redraws without stepping, so expression shapes
  // can be inspected directly instead of waiting for the right moment.
  setEyes(p) {
    const u = ghost.eyeUniforms;
    if (p.open !== undefined) u.uOpen.value = p.open;
    if (p.tilt !== undefined) u.uTilt.value = p.tilt;
    if (p.curve !== undefined) u.uCurve.value = p.curve;
    if (p.scale !== undefined) u.uEyeScale.value.set(p.scale[0], p.scale[1]);
    if (p.turn !== undefined) u.uEyeTurn.value = p.turn;
    if (p.look !== undefined) u.uLook.value.set(p.look[0], p.look[1]);
    renderer.render(scene, camera);
  },

  setRuins(visible) {
    setRuinsVisible(visible);
  },

  setSize(w, h) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    renderer.setSize(w, h, false);
    resize();
  },
};

if (!testMode) requestAnimationFrame(tick);
window.__ghostReady = true;
