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
  skeleton: async () => {
    const m = await import('../ghost/props/skeleton/model.js');
    const rig = m.createSkeletonRig();
    // ?pose=crouch bends the figure hard. The spine's seams only have to hold
    // while it is bent, and this character's first seconds are spent hauling
    // itself out of the ground, so a rest-pose-only check proves nothing.
    if (params.get('pose') === 'crouch') {
      const j = rig.joints;
      j.spineLower.rotation.set(0.80, 0.25, 0.10);
      j.spineUpper.rotation.set(-0.90, -0.30, -0.12);
      j.neck.rotation.set(0.60, 0.35, 0);
      j.head.rotation.set(-0.65, -0.25, 0);
      j.jaw.rotation.x = 0.55;
      for (const side of ['L', 'R']) {
        j[`shoulder${side}`].rotation.set(-1.10, 0, side === 'L' ? 0.35 : -0.35);
        j[`elbow${side}`].rotation.x = 1.60;
        j[`hip${side}`].rotation.x = -1.20;
        j[`knee${side}`].rotation.x = 1.70;
        j[`ankle${side}`].rotation.x = 0.40;
      }
      rig.group.position.y = 0.35;
    }
    return rig;
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

// ?view= pins the half-height, for A/B shots that have to stay comparable
// across edits. Left off, the camera frames whatever it was handed: a fixed
// target that suits a pumpkin silently decapitates a two-and-a-half unit
// skeleton, and a prop you cannot see all of is a prop you cannot judge.
const FIXED_VIEW = params.has('view') ? Number(params.get('view')) : null;
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const target = new THREE.Vector3(0, 0.45, 0);
let view = FIXED_VIEW ?? 1.5;

// Frame the prop from its own bounds. Measured on the screen axes the camera
// actually uses, not on world Y, or a wide prop overflows sideways.
function frame(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  target.copy(centre);
  if (FIXED_VIEW !== null) return;

  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(CAM_DIR).normalize();
  const right = new THREE.Vector3().crossVectors(CAM_DIR, up).normalize();
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
  view = Math.max(halfUp, halfRight / Math.max(0.35, aspectNow)) * 1.18;
}

let aspectNow = 1;

function resize(w, h) {
  const aspect = w / h;
  aspectNow = aspect;
  camera.left = -view * aspect;
  camera.right = view * aspect;
  camera.top = view;
  camera.bottom = -view;
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
// Same values as the real scene. These used to be the pre-fix numbers, which
// meant every prop was judged here under shadows that peter-panned and then
// shipped into a scene that did not.
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.006;
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
  frame(prop.group);
  resize(canvas.clientWidth || 900, canvas.clientHeight || 700);
  renderer.render(scene, camera);
  window.__previewReady = true;
}

window.__preview = {
  setSize(w, h) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // Aspect feeds the fit, so re-frame once the real size is known.
    aspectNow = w / h;
    if (prop) frame(prop.group);
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
