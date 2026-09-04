import * as THREE from 'three';
import { contactShadow } from '../style.js';
import {
  FOLIAGE, foliageMaterial, foliageRng, makeLobes, blobGeometry,
  lumpPositions, icosphere, mergeLumps, bakeFoliageTint, bakeWind,
  attachWind, disposeWind, updateWind,
} from './wind.js';

// A cemetery bush: a low, overgrown, dark evergreen, knee to waist height so it
// sits under the headstones (1.10 to 1.56) rather than in front of them.
//
// GEOMETRY, and what it is instead of.
//
// Two layers of solid clay, no cards and no alpha anywhere.
//
//   - The MASS. One closed lumpy dome, built as an icosphere with a smooth
//     radial lobe field on it. This is the pumpkin's approach and it is here for
//     the pumpkin's reason: a lobed silhouette cannot be assembled from
//     primitives without creases, and creases are exactly what the house style
//     rules out. Sunk into the floor so it meets the ground along a circle.
//
//   - The CLUMPS. Forty-odd small lumps sitting proud of that dome, each one a
//     tiny blob of its own, half buried in the mass, merged into a single
//     geometry. They are what makes the outline scallop instead of curve, and
//     they are what carries the flutter: each clump has its own phase, so the
//     surface breaks up into things that move separately instead of one object
//     being shaken.
//
// Alpha-cut leaf cards were the obvious alternative and are wrong for this
// scene three times over. There is no environment map, so a card has nothing to
// catch and reads as a flat sticker. The shadow map is the scene's only real
// occlusion and alpha-tested shadows are both expensive and crunchy at this
// resolution. And every other prop on the shelf is opaque soft vinyl, so a
// cloud of textured quads would be the one thing in the yard made of a
// different material. A clay bush is lumps.
//
// A single noise-displaced sphere was the other alternative and is too smooth:
// displacement large enough to read as fluff at this camera distance also makes
// the surface ripple rather than clump, and it gives the wind nothing to break
// into independently moving pieces.

export function createBush({ seed = 1, scale = 1 } = {}) {
  const rand = foliageRng(seed * 7919 + 131);

  const group = new THREE.Group();
  const disposables = [];

  // --- proportions ----------------------------------------------------------
  // Knee to waist and wider than tall, which is what an untrimmed yew does when
  // nobody has been round with the shears for a few years.
  const H = 0.585 + rand() * 0.105;          // visible height above y = 0
  const W = H * (1.40 + rand() * 0.28);      // widest point
  const BURIED = H * 0.17;                   // how much of the dome is underground

  // --- the mass -------------------------------------------------------------
  // yBias slightly negative so the lobes favour the flanks and the skirt: the
  // top of a bush is where it is most even, the bottom is where it is most
  // overgrown, and a lobe set biased upward gave a mushroom.
  const massLobes = makeLobes(rand, {
    count: 9,
    amp: [0.10, 0.27],
    tight: [2.1, 4.8],
    yBias: -0.06,
  });
  const massGeo = blobGeometry({
    detail: 4,
    lobes: massLobes,
    scaleY: 0.90,
    fit: { width: W, height: H, buried: BURIED },
  });
  bakeFoliageTint(massGeo, { top: H, floor: 0.46, ceil: 1.06, down: 0.74, rand });
  bakeWind(massGeo, { top: H * 0.90, base: 0, power: 1.8, flutter: 0 });
  disposables.push(massGeo);

  const massMat = foliageMaterial(FOLIAGE.deep);
  disposables.push(massMat);
  const mass = new THREE.Mesh(massGeo, massMat);
  group.add(mass);

  // --- the clumps -----------------------------------------------------------
  // Placed on the mass's own vertices rather than on an idealised sphere, so a
  // clump always sits on the surface that is actually there: an analytic
  // placement drifted off the deeper hollows of the lobe field and left clumps
  // floating a centimetre out in front of the bush.
  const clumps = clumpPlacements(massGeo, { rand, W, H });

  const clumpParts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  for (let i = 0; i < clumps.length; i++) {
    const c = clumps[i];
    const lobes = makeLobes(rand, { count: 4, amp: [0.14, 0.34], tight: [1.6, 3.4], yBias: 0 });
    // Stretched along its own y, which is then aimed down the surface normal:
    // a tuft standing out of the mass rather than a pebble stuck onto it.
    const pos = lumpPositions({ detail: 2, lobes, scaleY: 1.30 });
    for (let j = 0; j < pos.length; j += 3) {
      pos[j] *= c.r * 0.86;
      pos[j + 1] *= c.r;
      pos[j + 2] *= c.r * 0.86;
    }
    q.setFromUnitVectors(up, c.n);
    spin.makeRotationY(rand() * Math.PI * 2);
    m.makeRotationFromQuaternion(q).multiply(spin).setPosition(c.p);

    // Stiffness at the CLUMP CENTRE, not per vertex. See bakeWind: the flutter
    // has to be constant across a clump for the stale-normal argument to hold.
    const u = Math.max(0, Math.min(1, c.p.y / (H * 0.90)));
    const stiffAtCentre = Math.pow(u, 1.8);

    clumpParts.push({
      positions: pos,
      index: icosphere(2).index,
      matrix: m.clone(),
      phase: rand(),
      flutter: stiffAtCentre,
    });
  }

  const clumpGeo = mergeLumps(clumpParts);
  bakeFoliageTint(clumpGeo, { top: H, floor: 0.52, ceil: 1.16, down: 0.72, rand });
  bakeWind(clumpGeo, { top: H * 0.90, base: 0, power: 1.8 });
  disposables.push(clumpGeo);

  const clumpMat = foliageMaterial(FOLIAGE.mid);
  disposables.push(clumpMat);
  const tufts = new THREE.Mesh(clumpGeo, clumpMat);
  group.add(tufts);

  // --- wind -----------------------------------------------------------------
  // The two meshes are driven with IDENTICAL bend parameters and differ only in
  // flutter. That is not laziness: the clumps are only half buried in the mass,
  // so any difference in sway or lag between the layers pulls them out of it and
  // opens a crescent of daylight at the crown on the fast part of a gust. All
  // the independence the clumps need comes from uScatter and from the flutter,
  // both of which are bounded well inside the burial depth.
  const bend = {
    sway: 0.088 * H,        // authored against the plant's own height
    droop: 1.35,
    lag: 0.26,
    scatter: 0.20,
  };
  attachWind(mass, { ...bend, flutter: 0 });
  attachWind(tufts, { ...bend, flutter: 0.020 * H, flutRate: 1.45 });

  // --- ground contact -------------------------------------------------------
  // The one directional key throws its shadow off to the side, so nothing
  // darkens the floor where the bush actually meets it. Same patch the rest of
  // the set uses, sized to the footprint rather than to the widest point: the
  // dome overhangs its own foot and a patch at full width read as a puddle.
  const patch = contactShadow({ radius: W * 0.40, opacity: 0.34, softness: 0.62 });
  group.add(patch);
  disposables.push({ dispose: () => patch.userData.dispose?.() });

  group.scale.setScalar(scale);

  return {
    group,
    update(time) {
      // Every plant in the yard writes the same value into the same shared
      // uniform. Cheap, and it is what keeps them in one weather system.
      updateWind(time);
    },
    dispose() {
      disposeWind(mass);
      disposeWind(tufts);
      for (const d of disposables) d.dispose?.();
    },
  };
}

// Pick clump sites off the mass: a shuffled sweep of its vertices, accepting one
// only if it is far enough from every clump already placed. Rejection sampling
// rather than a fixed count of random picks, because random picks clump and
// leave a bald patch on one flank about a third of the time, and a bald flank on
// a bush is very visible at a fixed camera azimuth.
function clumpPlacements(geo, { rand, W, H }) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const n = pos.count;

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  const minGap = W * 0.148;
  const out = [];
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();

  for (let k = 0; k < n && out.length < 52; k++) {
    const i = order[k];
    p.fromBufferAttribute(pos, i);
    // Nothing below ankle height: clumps down there are buried in the floor and
    // only cost triangles. Thinned further over the lower third so the bush is
    // shaggiest at the crown, which is where the light is.
    if (p.y < H * 0.10) continue;
    if (p.y < H * 0.42 && rand() < 0.45) continue;
    nv.fromBufferAttribute(nor, i);
    // Skip anything facing more than slightly downward: a clump on the underside
    // is invisible from an elevated camera and still casts into the shadow map.
    if (nv.y < -0.42) continue;

    let ok = true;
    for (let j = 0; j < out.length; j++) {
      if (out[j].p.distanceTo(p) < minGap) { ok = false; break; }
    }
    if (!ok) continue;

    const r = W * (0.085 + rand() * 0.055);
    // Aimed a little more upright than the surface it sits on: foliage grows
    // toward the light, and clumps aimed exactly along the normal made the
    // flanks read as spines sticking out sideways.
    nv.y += 0.30;
    nv.normalize();
    out.push({ p: p.clone().addScaledVector(nv, r * 0.30), n: nv.clone(), r });
  }
  return out;
}
