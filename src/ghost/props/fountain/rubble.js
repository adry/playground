import * as THREE from 'three';
import { Profile, createSink, sinkToGeometry, latheInto, transformRange, roundedBoxInto } from './lathe.js';
import { marbleTextures, marbleMaterial, mulberry32, VEIN_TINT } from './marble.js';

// The broken marble the reference shows around the fountain: a small fluted
// column standing on a square base, a fallen column drum on its side, and a
// scatter of chips and crumbs.
//
// These are three separate props on purpose. Welded onto the fountain they
// would arrive as a fixed arrangement that every placement in every scene would
// have to live with, and the reference's own arrangement -- column at the front
// left, drum in front of the basin -- is a fact about that photograph's
// composition, not about the object. So the scene places them.
//
// Same marble as the fountain, same recipe, and each piece is one draw call.

// Ten, not fourteen. At the size these pieces are, fourteen flutes on a shaft
// this thin came out at under four angular segments each and read as a faint
// stripe rather than a groove.
const FLUTES = 10;
// A tenth of a flute's own width, which is about what real fluting is. At
// twice that the drum stopped reading as a fluted column lying down and started
// reading as a rolled-up mattress: seen from above, deep flutes are ribs.
const FLUTE_DEPTH = 0.011;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Flutes: rounded vertical grooves cut into the shaft. Concave, so the radius
// dips where the groove is and the stone left between them is what you see.
function fluting(theta, depth = FLUTE_DEPTH) {
  return -depth * Math.pow(0.5 + 0.5 * Math.cos(FLUTES * theta), 0.8);
}

// A snapped face. Low-frequency wander only: the house style has no faceting
// in it, so a break in this material is an uneven lump, not a fracture plane.
//
// It takes the position along the run as well as the angle, and that is not
// decoration. A break shaped by angle alone is constant along every radius, so
// on the flat end of a drum it comes out as a set of ridges converging on the
// centre -- a pinwheel, which is the one thing a snapped face never looks like.
// Twisting the angle with the radius and adding one radial wave turns it into a
// lumpy surface.
function breakSurface(theta, u, ph) {
  const a = theta + 2.2 * u;
  return (
    0.34 * Math.sin(3 * a + ph[0]) +
    0.22 * Math.sin(5 * a + ph[1]) +
    0.14 * Math.sin(8 * a + ph[2]) +
    0.30 * Math.sin(7.5 * u + ph[0] * 0.7)
  );
}

function weathered(a) {
  return [
    1 + (VEIN_TINT.r - 1) * a,
    1 + (VEIN_TINT.g - 1) * a,
    1 + (VEIN_TINT.b - 1) * a,
  ];
}

function finish(sink, seed) {
  const tex = marbleTextures(seed);
  const material = marbleMaterial(tex);
  const geometry = sinkToGeometry(sink);
  return { geometry, material, tex };
}

function wrap(group, geometry, material, tex, scale, extraDispose) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.scale.setScalar(scale);
  return {
    group,
    update() {}, // static
    dispose() {
      geometry.dispose();
      material.dispose();
      if (tex) { tex.map.dispose(); tex.normalMap.dispose(); }
      extraDispose?.();
    },
  };
}

// ---------------------------------------------------------------------------

// A short fluted column standing on a square base, snapped off near the top.
export function createBrokenColumn({ seed = 1, scale = 1 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 51);
  const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const R = 0.112;

  const P = new Profile();
  // The disc the shaft stands on is authored BELOW the top of the square base,
  // so it is buried in it. Landed flush the first time and the two surfaces
  // drew a black ring all the way round the column where they met.
  P.setTag('foot');
  P.moveTo(0, 0.060);
  P.lineTo(0.140, 0.060, 3);
  P.curve([[0.132, 0.078], [0.126, 0.104]], 5);
  P.setTag('shaft');
  P.lineTo(R, 0.150, 2);
  P.lineTo(R * 0.945, 0.560, 13); // a real column tapers, and it reads
  P.setTag('break');
  P.curve([[R * 0.90, 0.592], [R * 0.70, 0.616], [R * 0.34, 0.608]], 7);
  P.lineTo(0, 0.614, 2);
  const profile = P.build();

  const sink = createSink();
  latheInto(sink, {
    profile,
    segments: 56,
    uRepeat: 1,
    vScale: 1.0,
    minRadius: 0.055,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      if (s.tag === 'shaft') {
        dr += fluting(theta) * smoothstep(0.0, 0.10, s.u);
      } else if (s.tag === 'break') {
        dr += fluting(theta) * (1 - smoothstep(0.0, 0.5, s.u));
        const b = breakSurface(theta, s.u, phase);
        dy += 0.034 * b * smoothstep(0.0, 0.22, s.u);
        dr += 0.013 * b * (1 - smoothstep(0.35, 1.0, s.u));
      }
      return [dr, dy];
    },
    tint: (s) => weathered(
      s.tag === 'break' ? 0.75
        : s.tag === 'shaft' ? 0.16 + 0.5 * smoothstep(0.75, 1.0, s.u)
          : 0.42),
  });

  // The square base. Rounded like everything else on this shelf, and sunk a
  // hair so no seam opens between it and the ground.
  const start = sink.pos.length;
  roundedBoxInto(sink, { size: [0.36, 0.098, 0.36], radius: 0.030, segments: 4, tint: () => weathered(0.40) });
  transformRange(sink, start, new THREE.Matrix4().makeTranslation(0, 0.047, 0));

  const { geometry, material, tex } = finish(sink, seed);
  const group = new THREE.Group();
  group.rotation.y = rng() * Math.PI * 2;
  return wrap(group, geometry, material, tex, scale);
}

// A fallen column drum lying on its side, broken at both ends.
export function createFallenDrum({ seed = 1, scale = 1 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 77);
  const phaseA = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const phaseB = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const R = 0.122;
  const L = 0.255;

  // Authored standing up, then laid over: a lathe has to be built on its own
  // axis, and rolling it afterwards is one matrix.
  const P = new Profile();
  P.setTag('endA');
  P.moveTo(0, 0);
  P.lineTo(R - 0.022, 0.004, 4);
  P.arc(R - 0.022, 0.026, 0.022, -Math.PI / 2, 0, 5);
  P.setTag('shaft');
  P.lineTo(R, L - 0.026, 10);
  P.setTag('endB');
  P.arc(R - 0.022, L - 0.026, 0.022, 0, Math.PI / 2, 5);
  P.lineTo(0, L - 0.002, 4);
  const profile = P.build();

  const sink = createSink();
  latheInto(sink, {
    profile,
    segments: 52,
    uRepeat: 1,
    vScale: 1.0,
    minRadius: 0.055,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      if (s.tag === 'shaft') dr += fluting(theta);
      if (s.tag === 'endA') {
        dr += fluting(theta) * smoothstep(0.55, 1.0, s.u);
        dy += 0.026 * breakSurface(theta, s.u, phaseA) * (1 - smoothstep(0.35, 1.0, s.u));
      }
      if (s.tag === 'endB') {
        dr += fluting(theta) * (1 - smoothstep(0.0, 0.45, s.u));
        dy -= 0.026 * breakSurface(theta, s.u, phaseB) * smoothstep(0.0, 0.6, s.u);
      }
      return [dr, dy];
    },
    tint: (s) => weathered(s.tag === 'shaft' ? 0.18 : 0.7),
  });

  // Lay it down, and roll it a little so a flute lands on top rather than the
  // drum resting perfectly on a groove.
  const m = new THREE.Matrix4()
    .makeRotationZ(Math.PI / 2)
    .premultiply(new THREE.Matrix4().makeRotationY(rng() * Math.PI * 2))
    .premultiply(new THREE.Matrix4().makeTranslation(0, R - 0.006, 0));
  transformRange(sink, 0, m);

  const { geometry, material, tex } = finish(sink, seed + 5);
  return wrap(new THREE.Group(), geometry, material, tex, scale);
}

// Chips and crumbs of marble on the ground. One instanced blob, so a scatter of
// any size is still one draw call: the variety comes from per-instance scale,
// rotation and tint rather than from a mesh each.
export function createMarbleChips({ seed = 1, scale = 1, count = 26, radius = 0.85, inner = 0.34 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 199);

  const sink = createSink();
  // Flatter than it is wide: these are chips off a rim, not pebbles.
  roundedBoxInto(sink, { size: [1, 0.50, 0.80], radius: 0.24, segments: 3, tint: () => weathered(0.5) });
  const { geometry, material, tex } = finish(sink, seed + 11);

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Denser near the foot of the fountain and thinning outwards, which is what
    // a scatter that fell off something looks like. Square root of a uniform
    // draw gives an even area density; biasing it inward puts more of them
    // where the damage came from.
    const t = Math.pow(rng(), 1.7);
    const r = inner + (radius - inner) * t;
    const a = rng() * Math.PI * 2;
    const s = 0.018 + Math.pow(rng(), 2.2) * 0.058;
    sc.set(s * (0.8 + rng() * 0.7), s * (0.5 + rng() * 0.55), s * (0.8 + rng() * 0.7));
    // Resting, not hovering. The box's own half-height is 0.25 of its y size,
    // so anything above that leaves daylight under the chip and its shadow.
    pos.set(Math.cos(a) * r, sc.y * 0.21, Math.sin(a) * r);
    e.set(rng() * 0.7 - 0.35, rng() * Math.PI * 2, rng() * 0.7 - 0.35);
    q.setFromEuler(e);
    mesh.setMatrixAt(i, m.compose(pos, q, sc));
    const k = 0.86 + rng() * 0.20;
    mesh.setColorAt(i, col.setRGB(k, k * 0.995, k * 0.98));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(scale);
  return {
    group,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
      if (tex) { tex.map.dispose(); tex.normalMap.dispose(); }
      mesh.dispose();
    },
  };
}
