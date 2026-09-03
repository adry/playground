import * as THREE from 'three';
import { Ghost } from './ghost.js';
import { createGround } from './ground.js';
import { Input } from './input.js';

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
scene.fog = new THREE.Fog(BACKDROP, 16, 34);

// True isometric-ish: 45 degrees around, ~30 degrees up, orthographic so there
// is no perspective convergence.
const VIEW_SIZE = 2.35;
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
key.shadow.camera.far = 24;
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -4;
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key);
scene.add(key.target);

const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
rim.position.set(-4, 2.5, -3);
scene.add(rim);

// --- world ------------------------------------------------------------------

const ground = createGround();
scene.add(ground);

const ghost = new Ghost();
scene.add(ghost.mesh);

const input = new Input(canvas, camera);

placeCamera();
resize();
window.addEventListener('resize', resize);

// --- loop -------------------------------------------------------------------

function follow(dt) {
  const k = 1 - Math.exp(-dt * 4.2);
  camTarget.x += (ghost.pos.x - camTarget.x) * k;
  camTarget.z += (ghost.pos.z - camTarget.z) * k;
  placeCamera();

  key.position.copy(camTarget).add(new THREE.Vector3(3.2, 6.0, 2.4));
  key.target.position.copy(camTarget);
  key.target.updateMatrixWorld();

  ground.userData.uniforms.uFocus.value.copy(camTarget);
}

function step(dt, axis) {
  ghost.update(dt, axis);
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
    };
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
