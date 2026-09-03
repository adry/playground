import * as THREE from 'three';
import { createGround } from '../ghost/ground.js';

// A prop turntable that reuses the real scene's floor, lighting and camera, so
// what an asset looks like here is what it will look like in the game. Load
// with ?prop=pumpkin and step it from the capture harness.

const PROPS = {
  pumpkin: async () => {
    const m = await import('../ghost/props/pumpkin.js');
    return m.createPumpkin();
  },
  tombstones: async () => {
    const m = await import('../ghost/props/tombstones.js');
    // Lay the variants out in a row so one render shows the whole set.
    const group = new THREE.Group();
    const parts = [];
    const n = m.VARIANTS?.length ?? 3;
    for (let i = 0; i < n; i++) {
      const t = m.createTombstone({ variant: m.VARIANTS ? m.VARIANTS[i] : i, seed: 1000 + i * 77 });
      t.group.position.x = (i - (n - 1) / 2) * 1.15;
      group.add(t.group);
      parts.push(t);
    }
    return {
      group,
      update: (time, dt) => parts.forEach((p) => p.update?.(time, dt)),
      dispose: () => parts.forEach((p) => p.dispose?.()),
    };
  },
};

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const name = params.get('prop') || 'pumpkin';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BACKDROP = new THREE.Color('#b9bec7').convertSRGBToLinear();
const scene = new THREE.Scene();
scene.background = BACKDROP;

const VIEW = Number(params.get('view') || 1.5);
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const target = new THREE.Vector3(0, 0.45, 0);

function resize(w, h) {
  const aspect = w / h;
  camera.left = -VIEW * aspect;
  camera.right = VIEW * aspect;
  camera.top = VIEW;
  camera.bottom = -VIEW;
  camera.updateProjectionMatrix();
  camera.position.copy(target).addScaledVector(CAM_DIR, 20);
  camera.lookAt(target);
  renderer.setSize(w, h, false);
}

scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));
const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
key.position.set(3.2, 6.0, 2.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 30;
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -4;
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
rim.position.set(-4, 2.5, -3);
scene.add(rim);

scene.add(createGround());

let prop = null;
let time = 0;

async function boot() {
  prop = await PROPS[name]();
  scene.add(prop.group);
  resize(canvas.clientWidth || 900, canvas.clientHeight || 700);
  renderer.render(scene, camera);
  window.__previewReady = true;
}

window.__preview = {
  setSize(w, h) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    resize(w, h);
  },
  // Advance and redraw. Lets a flickering light be captured at a chosen moment.
  step(dt = 1 / 60, spin = 0) {
    time += dt;
    prop.update?.(time, dt);
    prop.group.rotation.y = spin;
    renderer.render(scene, camera);
  },
};

boot();
