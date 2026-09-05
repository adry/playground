import * as THREE from 'three';
import { createGround } from '../../ground.js';
import { createZombieRig } from './model.js';
import M from './metrics.js';

// A private turntable for the zombie, living inside the zombie's own folder so
// that building this character touches nothing outside it.
//
// The camera, the lights and the floor are copied from `src/preview/main.js`
// verbatim, which in turn copies the real game scene, so what an asset looks
// like here is what it looks like in the game. That is not a nicety: the
// skeleton's skull was judged three times on a turntable with different
// lighting and was wrong three times.
//
//   ?mode=solo      the zombie alone, framed to fit
//   ?mode=family    the zombie beside the ghost and the skeleton
//   ?mode=game      framed exactly as the game frames it, for the size crop
//   ?mode=sil       flat black on white, which is the only honest test of a
//                   silhouette. Surface detail cannot rescue a shape that is
//                   wrong as a black blob, and a figure whose arms vanish into
//                   its body reads as a bollard however good its face is.
//   ?focus=head     frame tightly on one region, with ?view for the half-height.
//                   Tuning only, like ?mode=face.
//   ?bare=1         hide the clothes, so the ribcage cavity and the body's own
//                   forms can be judged without a jacket over them. A tuning
//                   view like ?mode=face: nothing is judged on it.
//   ?pose=crouch    bend everything hard, to prove the seams hold
//   ?pose=walk      one frame of a stride, to prove the limbs are not crossed

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'solo';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const SIL = mode === 'sil';
const BACKDROP = new THREE.Color(SIL ? '#ffffff' : '#b9bec7').convertSRGBToLinear();
const scene = new THREE.Scene();
scene.background = BACKDROP;

// ?mode=face is a flat orthographic elevation, used only while building the
// face. It is NOT how the character is judged: the scene camera below is. It
// exists because a feature that is in the wrong place is far easier to see
// without a 29 degree downward projection folded on top of it.
const CAM_DIR = (mode === 'face' || SIL)
  ? new THREE.Vector3(0, 0, 1)
  : new THREE.Vector3(1, 0.78, 1).normalize();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const target = new THREE.Vector3(0, 0.45, 0);
let view = params.has('view') ? Number(params.get('view')) : 1.5;
let aspectNow = 1;
const FIXED_VIEW = params.has('view');

function frame(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  target.copy(centre);
  if (FIXED_VIEW) return;
  const up = new THREE.Vector3(0, 1, 0).projectOnPlane(CAM_DIR).normalize();
  const right = new THREE.Vector3().crossVectors(CAM_DIR, up).normalize();
  let halfUp = 0, halfRight = 0;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre);
    halfUp = Math.max(halfUp, Math.abs(corner.dot(up)));
    halfRight = Math.max(halfRight, Math.abs(corner.dot(right)));
  }
  view = Math.max(halfUp, halfRight / Math.max(0.35, aspectNow)) * 1.15;
}

function resize(w, h) {
  aspectNow = w / h;
  camera.left = -view * aspectNow;
  camera.right = view * aspectNow;
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
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.006;
key.shadow.radius = 3;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
rim.position.set(-4, 2.5, -3);
scene.add(rim);
if (!SIL) scene.add(createGround());

const holder = new THREE.Group();
scene.add(holder);
const parts = [];
let rig = null;

function pose(r) {
  const j = r.joints;
  if (params.get('pose') === 'crouch') {
    j.spineLower.rotation.set(0.55, 0.20, 0.08);
    j.spineUpper.rotation.set(-0.45, -0.25, -0.10);
    j.neck.rotation.set(0.22, 0.25, 0);
    j.head.rotation.set(-0.40, -0.30, 0);
    j.jaw.rotation.x = 0.55;
    for (const s of ['L', 'R']) {
      j[`shoulder${s}`].rotation.set(-1.10, 0, s === 'L' ? 0.35 : -0.35);
      j[`elbow${s}`].rotation.x = -1.60;   // negative folds an elbow FORWARD
      j[`hip${s}`].rotation.x = -1.20;
      j[`knee${s}`].rotation.x = 1.70;
      j[`ankle${s}`].rotation.x = 0.40;
    }
    r.group.position.y = 0.30;
  } else if (params.get('pose') === 'walk') {
    // One frame of a shamble: LEFT leg forward, LEFT arm back. If the model
    // ever puts L on the wrong side this frame comes out with both limbs on
    // the same side of the body, which is the whole reason it exists.
    j.hipL.rotation.x = -0.55; j.kneeL.rotation.x = 0.25;
    j.hipR.rotation.x = 0.35; j.kneeR.rotation.x = 0.55;
    j.ankleR.rotation.x = -0.30;
    j.shoulderL.rotation.x = 0.45; j.shoulderR.rotation.x = -0.85;
    j.elbowL.rotation.x = -0.55; j.elbowR.rotation.x = -1.05;
    j.spineUpper.rotation.set(-0.18, 0.10, 0);
    // The head as the animation half actually drives it: it rolls about 19
    // degrees once a cycle and rides 10 to 20 degrees behind the chest, both
    // emergent from the walk rather than posed. The face therefore has to read
    // TURNING AND LAGGING, not square on, so this frame is the one the brow,
    // the sockets and the nose are judged on.
    j.neck.rotation.set(0.10, -0.14, 0.14);
    j.head.rotation.set(-0.16, -0.22, 0.19);
    j.jaw.rotation.x = 0.28;
  } else if (params.get('pose') === 'reach') {
    for (const s of ['L', 'R']) {
      j[`shoulder${s}`].rotation.set(-1.45, 0, s === 'L' ? 0.10 : -0.10);
      j[`elbow${s}`].rotation.x = -0.35;
    }
    j.jaw.rotation.x = 0.5;
    j.spineUpper.rotation.x = -0.15;
  }
}

async function boot() {
  rig = createZombieRig();
  if (params.get('bare')) {
    const CLOTH = /jacket|lapel|collar|sleeve|shorts/;
    rig.group.traverse((o) => { if (o.isMesh && CLOTH.test(o.name)) o.visible = false; });
  }
  pose(rig);
  parts.push(rig);

  if (mode === 'family') {
    const { Ghost } = await import('../../ghost.js');
    const g = new Ghost({ seed: 5 });
    // The cloth needs settling before it has a finite bounding box at all: one
    // frame in, half the sheet is still NaN and anything that measures the
    // scene comes back empty.
    const idle = { x: 0, y: 0, jump: false };   // the shape Input.sample() returns
    for (let i = 0; i < 180; i++) g.update(1 / 60, idle);
    const ghostHolder = new THREE.Group();
    ghostHolder.add(g.mesh);
    ghostHolder.position.set(-1.45, 0, 0);
    holder.add(ghostHolder);
    parts.push({ update: (dt) => g.update(dt, idle), dispose: () => {} });

    rig.group.position.set(0, 0, 0);
    holder.add(rig.group);

    const sk = await import('../skeleton/model.js');
    const s = sk.createSkeletonRig();
    s.group.position.set(1.55, 0, 0);
    holder.add(s.group);
    parts.push(s);
  } else {
    holder.add(rig.group);
  }

  if (SIL) {
    // One flat black material over everything, no lights, no floor. What is
    // left is the shape and nothing else.
    const flat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    holder.traverse((o) => { if (o.isMesh) o.material = flat; });
    renderer.shadowMap.enabled = false;
  }

  if (mode === 'game') {
    // Exactly the game's own framing: half height 6.2, target y 0.75.
    view = 6.2;
    target.set(0, 0.75, 0);
  } else if (mode === 'family') {
    // Fixed, not fitted. The ghost is simulated cloth and its bounds move
    // every frame, so a fitted camera would breathe between takes and the
    // three figures could not be compared across edits.
    view = 1.62;
    target.set(0.10, 1.20, 0);
  } else {
    frame(holder);
  }
  const focus = params.get('focus');
  if (focus) {
    const at = { head: M.y.brow, face: M.y.grin, chest: 0.5 * (M.y.cavityTop + M.y.cavityBottom), hips: M.y.hip };
    target.set(0, at[focus] ?? Number(focus), 0);
    if (!FIXED_VIEW) view = 0.40;
  }
  resize(canvas.clientWidth || 900, canvas.clientHeight || 700);
  renderer.render(scene, camera);
  window.__zombie = {
    triangles: rig.group.userData.triangles,
    joints: Object.fromEntries(Object.entries(rig.joints).map(([k, o]) => {
      const p = o.getWorldPosition(new THREE.Vector3());
      return [k, [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]];
    })),
    metrics: { height: M.height },
  };
  window.__previewReady = true;
}

window.__preview = {
  setSize(w, h) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    aspectNow = w / h;
    if (mode !== 'game' && mode !== 'family' && !FIXED_VIEW) frame(holder);
    resize(w, h);
  },
  step(dt = 1 / 60, spin = 0) {
    for (const p of parts) p.update?.(dt, dt);
    holder.rotation.y = spin;
    renderer.render(scene, camera);
  },
};

boot();
