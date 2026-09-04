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
//   - The TUFTS. A hundred and fifty small lumps sitting proud of that dome in
//     two sizes, each a lozenge of its own, mostly buried in the mass, merged
//     into a single geometry and a single draw call. They are what makes the
//     outline scallop instead of curve, and they are what carries the flutter:
//     each tuft has its own phase, so the surface breaks into pieces that move
//     separately instead of one object being shaken.
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
  // Inner group carries the seeded lean, the same arrangement the tombstones
  // use, so the caller still owns position and rotation.y on the outer one.
  const body = new THREE.Group();
  group.add(body);
  const disposables = [];

  // --- proportions ----------------------------------------------------------
  // Knee to waist and wider than tall, which is what an untrimmed yew does when
  // nobody has been round with the shears for a few years.
  //
  // TALL is what the finished prop measures; H is only what the mass under the
  // tufts is built at. The two are not the same and cannot be: the tufts stand
  // proud of the mass by however much their own randomness gave them, which
  // measured out at a quarter of the bush's height and drifting seed to seed.
  // So the prop is built, measured, and then scaled to the height it promised,
  // which is the only way "knee to waist, under the headstones" survives the
  // next four plants being built on top of this.
  const TALL = 0.62 + rand() * 0.14;
  const H = 0.575 + rand() * 0.100;          // nominal height of the mass
  const W = H * (1.20 + rand() * 0.24);      // widest point
  const D = W * (0.80 + rand() * 0.20);      // and its depth, so it is not round
  const BURIED = H * 0.17;                   // how much of the dome is underground

  // --- the mass -------------------------------------------------------------
  // Few large lobes rather than many small ones. Nine modest lobes averaged out
  // into a dome with a texture on it; seven big ones give the mass real shoulders
  // and hollows, which is what the tufts then need in order to sit at different
  // depths instead of paving an even sphere. yBias is slightly negative so the
  // lobes favour the flanks and the skirt: the top of a bush is where it is most
  // even, the bottom is where it is most overgrown, and biasing them upward gave
  // a mushroom.
  const massLobes = makeLobes(rand, {
    count: 7,
    amp: [0.15, 0.36],
    tight: [1.7, 4.0],
    yBias: -0.06,
  });
  const massGeo = blobGeometry({
    detail: 4,
    lobes: massLobes,
    scaleY: 0.90,
    fit: { width: W, depth: D, height: H, buried: BURIED },
  });
  disposables.push(massGeo);

  const massMat = foliageMaterial(FOLIAGE.deep);
  disposables.push(massMat);
  const mass = new THREE.Mesh(massGeo, massMat);
  body.add(mass);

  // --- the clumps -----------------------------------------------------------
  // Placed on the mass's own vertices rather than on an idealised sphere, so a
  // clump always sits on the surface that is actually there: an analytic
  // placement drifted off the deeper hollows of the lobe field and left clumps
  // floating a centimetre out in front of the bush.
  //
  // Two tiers of tuft, not three. A third tier of fine fuzz riding on the tips
  // of the second was built and thrown away: it cost nine thousand triangles and
  // at the size this prop is actually seen in the yard, where the whole bush is
  // a couple of hundred pixels, every one of those lumps was two pixels across
  // and contributed aliasing rather than detail. The texture it was after is
  // bought for nothing instead, by giving each tuft a second, tighter set of
  // lobes: same triangles, same silhouette work, bumps at a quarter of the
  // scale. Detail you cannot resolve is not detail.
  const tuftSites = clumpPlacements(massGeo, {
    rand, W, H,
    limit: 168,
    yMin: 0.05,
    big: [0.055, 0.028],
    small: [0.030, 0.020],
    bigOdds: 0.34,
    gap: 0.44,
  });
  const clumpGeo = mergeLumps(buildTufts(tuftSites, { rand, W, H }));
  disposables.push(clumpGeo);

  // --- fit to the promised height -------------------------------------------
  // Uniform, so no normal has to be recomputed, and about y = 0, so the buried
  // skirt keeps the same proportion of itself underground. Everything that reads
  // a position, meaning the shading bake, the wind weights and the contact
  // patch, happens after this, so nothing has to be corrected for it afterwards.
  const K = TALL / measureExtent(massGeo, clumpGeo).top;
  massGeo.scale(K, K, K);
  clumpGeo.scale(K, K, K);
  // Re-measured rather than taken as W * K, because the tufts stand outside the
  // mass sideways as well as upward: the mass's fitted width under-reports the
  // finished prop by about a fifth, which is exactly the amount a scene laying
  // bushes out would then overlap them by.
  const { width, depth } = measureExtent(massGeo, clumpGeo);

  bakeFoliageTint(massGeo, { top: TALL, floor: 0.44, ceil: 0.86, down: 0.70, rand });
  bakeWind(massGeo, { top: TALL * 0.86, base: 0, power: 1.8, flutter: 0 });
  bakeFoliageTint(clumpGeo, { top: TALL, floor: 0.50, ceil: 1.34, down: 0.56, root: 0.36, spread: 0.26, rand });
  bakeWind(clumpGeo, { top: TALL * 0.86, base: 0, power: 1.8 });

  const clumpMat = foliageMaterial(FOLIAGE.mid);
  disposables.push(clumpMat);
  const tufts = new THREE.Mesh(clumpGeo, clumpMat);
  body.add(tufts);

  // --- wind -----------------------------------------------------------------
  // The two meshes are driven with IDENTICAL bend parameters and differ only in
  // flutter. That is not laziness: the clumps are only half buried in the mass,
  // so any difference in sway or lag between the layers pulls them out of it and
  // opens a crescent of daylight at the crown on the fast part of a gust. All
  // the independence the clumps need comes from uScatter and from the flutter,
  // both of which are bounded well inside the burial depth.
  const bend = {
    sway: 0.088 * TALL,     // authored against the plant's own height
    droop: 1.35,
    lag: 0.26,
    scatter: 0.20,
  };
  attachWind(mass, { ...bend, flutter: 0 });
  attachWind(tufts, { ...bend, flutter: 0.020 * TALL, flutRate: 1.45 });

  // --- lean -----------------------------------------------------------------
  // Nothing grows plumb. Small enough that the silhouette still reads upright,
  // and well inside the depth the dome is buried at, so no daylight opens under
  // the lean.
  body.rotation.z = (rand() - 0.5) * 0.10;
  body.rotation.x = (rand() - 0.5) * 0.08;

  // --- ground contact -------------------------------------------------------
  // The key light and the camera are on the same side of the yard, so the bush's
  // own cast shadow goes behind it and nothing darkens the floor on the side you
  // can see. Measured against a render with it turned off, this patch changes
  // exactly one thing: a thin crescent of floor along the front of the footprint.
  // That is all it should change, and it is why the halo problem that got a
  // painted patch thrown off the tombstones does not arise here: the dome is
  // buried, so its own skirt covers the patch everywhere except at that join.
  const patch = contactShadow({ radius: (width + depth) * 0.21, opacity: 0.22, softness: 0.74 });
  group.add(patch);
  disposables.push({ dispose: () => patch.userData.dispose?.() });

  group.scale.setScalar(scale);

  return {
    group,
    // What the prop actually measures, so a scene can lay bushes out without
    // building one and reading its bounding box back.
    size: { height: TALL * scale, width: width * scale, depth: depth * scale },
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

// What the finished prop actually measures, over every geometry in it.
function measureExtent(...geos) {
  let top = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > top) top = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { top: Math.max(1e-4, top), width: maxX - minX, depth: maxZ - minZ };
}

// One tier of tufts, from a list of sites.
function buildTufts(sites, { rand, W, H, stretch = [0.55, 0.55] }) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();

  for (const c of sites) {
    // A clump big enough to show its own outline gets the finer sphere; the
    // small ones nestled between them are a dozen pixels across at the scale
    // this prop is seen and would pay four times the triangles for an outline
    // nobody can resolve.
    const d = c.r > W * 0.044 ? 2 : 1;
    // Broad lobes give the tuft its shape. The tight ones are the texture, and
    // they only go on tufts fine enough to resolve them: on a 42-vertex sphere a
    // lobe at tight 7 falls between samples and comes out as a random dent.
    const lobes = makeLobes(rand, { count: 5, amp: [0.16, 0.44], tight: [1.4, 3.0], yBias: 0.10 });
    if (d >= 2) lobes.push(...makeLobes(rand, { count: 5, amp: [0.09, 0.20], tight: [5.0, 9.0], yBias: 0.1 }));
    // Elongated, and this is the change that moved the prop from "heap of soap
    // bubbles" to foliage: round lumps of two sizes read as foam whatever you do
    // to their shading, because nothing in a heap of spheres has a direction.
    // The two tangential axes are also scaled unequally so no clump is a body of
    // revolution.
    const kx = 0.72 + rand() * 0.30;
    const kz = 0.72 + rand() * 0.30;
    const pos = lumpPositions({
      detail: d,
      lobes,
      scaleY: 1.15 + rand() * 0.30,
      stretch: c.long * (stretch[0] + rand() * stretch[1]),
    });
    for (let j = 0; j < pos.length; j += 3) {
      pos[j] *= c.r * kx;
      pos[j + 1] *= c.r;
      pos[j + 2] *= c.r * kz;
    }
    q.setFromUnitVectors(up, c.n);
    spin.makeRotationY(rand() * Math.PI * 2);
    m.makeRotationFromQuaternion(q).multiply(spin).setPosition(c.p);

    // Stiffness at the CLUMP CENTRE, not per vertex. See bakeWind: the flutter
    // has to be constant across a clump for the stale-normal argument to hold.
    const u = Math.max(0, Math.min(1, c.p.y / (H * 0.90)));

    parts.push({
      positions: pos,
      index: icosphere(d).index,
      matrix: m.clone(),
      // Fuzz takes its parent tuft's phase, so the two move as one piece.
      phase: c.phase === undefined ? rand() : c.phase,
      tint: rand(),
      flutter: Math.pow(u, 1.8),
    });
  }
  return parts;
}

// Pick tuft sites off a surface: a shuffled sweep of its vertices, accepting one
// only if it is far enough from every tuft already placed. Rejection sampling
// rather than a fixed count of random picks, because random picks bunch up and
// leave a bald patch on one flank about a third of the time, and a bald flank is
// very visible at a fixed camera azimuth.
function clumpPlacements(geo, {
  rand, W, H,
  limit = 140,
  yMin = 0.11,
  big = [0.050, 0.026],     // [base, spread] as a fraction of W
  small = [0.028, 0.019],
  bigOdds = 0.34,
  gap = 0.44,
  parentPhase = null,
}) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const n = pos.count;

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  // Two sizes of clump, mixed, and the spacing test is written in terms of the
  // two radii rather than as one fixed gap. That is what lets a small clump
  // settle into the notch between two big ones instead of being pushed out to
  // arm's length, and detail at more than one scale is most of what separates
  // "fluffy" from "bumpy". A gap below 1 means neighbours overlap and the
  // crevice between them is a slot rather than a valley.
  const out = [];
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();

  for (let k = 0; k < n && out.length < limit; k++) {
    const i = order[k];
    p.fromBufferAttribute(pos, i);
    // Thinned over the lower third so the bush is shaggiest at the crown, which
    // is where the light is, but only thinned. An earlier pass cut the skirt off
    // entirely below a tenth of the height and thinned the rest by nearly half,
    // and what came back was a smooth dark patch of bare mass along the front of
    // the foot that read as a hole in the bush rather than as its shadow.
    if (p.y < H * yMin) continue;
    if (p.y < H * 0.40 && rand() < 0.22) continue;
    nv.fromBufferAttribute(nor, i);
    // Skip anything facing more than slightly downward: a clump on the underside
    // is invisible from an elevated camera and still costs a shadow pass.
    if (nv.y < -0.40) continue;

    // The large ones are kept off the skirt: a big clump low down sticks out
    // past the footprint and the bush grows a bustle.
    const isBig = rand() < bigOdds && p.y > H * 0.34;
    const spec = isBig ? big : small;
    const r = W * (spec[0] + rand() * spec[1]);

    let ok = true;
    for (let j = 0; j < out.length; j++) {
      if (out[j].p.distanceTo(p) < (out[j].r + r) * gap) { ok = false; break; }
    }
    if (!ok) continue;

    // Aimed a little more upright than the surface it sits on: foliage grows
    // toward the light, and clumps aimed exactly along the normal made the
    // flanks read as spines sticking out sideways. Then jittered, because a
    // hundred tufts all pointing exactly along their own normal is a sea
    // urchin: the scatter is what makes it look grown rather than extruded.
    nv.y += 0.24;
    nv.x += (rand() - 0.5) * 0.50;
    nv.z += (rand() - 0.5) * 0.50;
    nv.normalize();
    // One in seven runs long. A few sprigs standing out past the rest is the
    // difference between a trimmed shrub and an overgrown one, and overgrown is
    // what a churchyard corner looks like.
    const long = rand() < 0.14 ? 1.6 + rand() * 0.7 : 1;
    out.push({
      p: p.clone().addScaledVector(nv, r * 0.20),
      n: nv.clone(),
      r,
      long,
      phase: parentPhase ? parentPhase[i] : undefined,
    });
  }
  return out;
}
