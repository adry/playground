import * as THREE from 'three';
import { Ghost } from './ghost.js';
import { createGround } from './ground.js';
import { Input } from './input.js';
import { createPumpkin } from './props/pumpkin.js';
import { createTombstone } from './props/tombstones.js';

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

const props = [];

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

for (const [i, g] of GRAVES.entries()) {
  const [x, z] = atScreen(g.right, g.up);
  addProp(createTombstone({ variant: g.variant, seed: 11 + i * 13 }), x, z, g.yaw);
}

const PUMPKINS = [
  { right: -2.6, up: -1.9, yaw: Math.PI / 4 + 0.30 },
  { right: 2.7, up: -2.3, yaw: Math.PI / 4 - 0.42 },
  { right: 3.9, up: 0.5, yaw: Math.PI / 4 + 0.08 },
];

for (const [i, spot] of PUMPKINS.entries()) {
  const [x, z] = atScreen(spot.right, spot.up);
  addProp(createPumpkin({ seed: 3 + i * 7 }), x, z, spot.yaw);
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

  key.position.copy(camTarget).add(new THREE.Vector3(3.2, 6.0, 2.4));
  key.target.position.copy(camTarget);
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
  step(dt, axis) {
    step(dt, { x: axis?.x ?? 0, y: axis?.y ?? 0, jump: !!axis?.jump });
  },
  state() {
    return {
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
