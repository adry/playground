import * as THREE from 'three';
import M from '../metrics.js';
import { shell2, put, v } from './skin.js';
import { trunkProfile } from './torso.js';

// The rags. Everything here is GEOMETRY, including every torn edge and every
// hole, because there is no environment map in this scene and an alpha card
// therefore has nothing to reflect: it reads as a flat sticker from the one
// fixed camera. Same rule that shaped the bushes and the fence.
//
// Every garment is a `shell2`, an outer sheet and an inner sheet with a rim
// stitched round every boundary. That rim is the whole point. A rag modelled
// as a single sheet is invisible edge-on and, worse, its torn hem has no
// thickness, so the tears read as a wobbly outline rather than as cloth that
// has been ripped. At game scale the thickness is under a pixel, but it is
// what puts a dark line along every cut edge, and that dark line is what makes
// the tatters visible at all.

// A deterministic hash, so a zombie built twice is the same zombie.
export function hash(i, seed = 1) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// A torn edge: a run of notches of random depth with the odd deep one. Fed a
// continuous parameter so the two ends meet on a closed garment.
export function tornEdge(t, teeth, depth, seed) {
  const s = t * teeth;
  const i = Math.floor(s);
  const fr = s - i;
  const a = hash(i, seed), b = hash(i + 1, seed);
  // A notch is a V rather than a sine: a sine hem reads as scalloped, which is
  // decorative, and this cloth is supposed to look torn.
  const bite = fr < 0.5 ? a * (1 - fr * 2) + b * (fr * 2) : b;
  const deep = hash(i, seed + 17) > 0.78 ? 1.9 : 1.0;
  return depth * bite * deep * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, fr * 1.6)));
}

// --- the jacket ---------------------------------------------------------------
//
// It hangs from the shoulders, so it parents to spineUpper, which is also
// physically what a jacket does: bend at the waist and the jacket does not
// bend with the belly, it swings.
//
// The front gap is M.jacket.openHalfAngle, WIDER than the chest cavity, so the
// two lapels frame the ribcage instead of covering its edges. See the note in
// metrics.js: the reference has them overlapping and it cost a fifth of a
// feature that is only fifteen pixels across.
export function buildJacket({ materials }) {
  const group = new THREE.Group();

  const open = M.jacket.openHalfAngle;
  const arc = Math.PI * 2 - 2 * open;
  const gap = 0.005 * M.height;          // standoff from the body
  const top = M.jacket.top;

  const hemAt = (u) => M.jacket.hem + tornEdge(u, 9, M.jacket.tatter, 3);
  // The top edge is NOT a flat ring. u = 0 and u = 1 are the two front edges,
  // u = 0.5 the middle of the back, so this drops the front of the garment
  // away from the collarbone and keeps it up behind the neck, which is what a
  // jacket does. Built as a flat ring it came out as a barrel hoop round the
  // throat, with the head sitting in it like a bucket.
  const topAt = (u) => {
    const front = 1 - Math.min(1, Math.abs(u - 0.5) * 2.4);
    return top - 0.038 * M.height * (1 - front);
  };
  const yAt = (u, vv) => {
    const h = hemAt(u);
    return h + (topAt(u) - h) * vv;
  };
  // Radius, with a slow fold running round the garment. Cloth that follows the
  // body exactly reads as paint; three shallow folds are enough to break the
  // highlight without turning it into corrugated iron.
  // A jacket has a SHOULDER YOKE: it stands off the body near the top, over
  // the deltoids, and follows it further down. Built without one, the garment
  // hugged the chest at shoulder height and the deltoids pushed straight
  // through it, which read as bare shoulders with a bib hung under them.
  const yoke = (y) => {
    const t = Math.max(0, (y - (M.y.shoulder - 0.075 * M.height)) / (0.075 * M.height));
    return 1 + 0.08 * Math.min(1, t) * Math.min(1, t);
  };
  const radAt = (u, y, out) => {
    const [hw, hd] = trunkProfile(y);
    const a = Math.PI / 2 + open + u * arc;
    const fold = 1 + 0.045 * Math.sin(u * Math.PI * 3.0 + 0.7) * (0.35 + 0.65 * (1 - Math.abs(u - 0.5) * 2));
    const k = gap + out;
    const yk = yoke(y);
    // The yoke widens the garment sideways only: a jacket that stands 30 per
    // cent off the chest as well looks inflated.
    return new THREE.Vector3(Math.cos(a) * (hw * fold * yk + k), y, Math.sin(a) * (hd * fold + k));
  };

  const outer = (u, vv) => radAt(u, yAt(u, vv), M.jacket.thickness);
  const inner = (u, vv) => radAt(u, yAt(u, vv), 0);

  // Two holes worn through the back, because the back of this character is on
  // screen for half of every chase and a garment with damage only at the hem
  // reads as new cloth someone cut the bottom off.
  const keepQuad = (u, vv) => {
    for (const h of [[0.44, 0.52, 0.055, 0.030], [0.62, 0.30, 0.038, 0.026]]) {
      const du = (u - h[0]) / h[2], dv = (vv - h[1]) / h[3];
      if (du * du + dv * dv < 1) return false;
    }
    return true;
  };

  put(group, shell2({
    uSteps: 52, vSteps: 16, closedU: false, outer, inner, keepQuad,
  }), materials.jacket);

  // A short collar behind the neck only, riding the raised part of the top
  // edge. It gives the shoulders a step without ringing the throat.
  put(group, shell2({
    uSteps: 20, vSteps: 3, closedU: false,
    uAt: (i) => 0.30 + 0.40 * (i / 20),
    outer: (u, vv) => radAt(u, topAt(u) - 0.012 * M.height + vv * 0.026 * M.height,
      M.jacket.thickness + vv * 0.010 * M.height),
    inner: (u, vv) => radAt(u, topAt(u) - 0.012 * M.height + vv * 0.026 * M.height, vv * 0.005 * M.height),
  }), materials.jacketDark);

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });
  return { group, dispose() { for (const g of geometries) g.dispose(); } };
}

// --- the shorts ---------------------------------------------------------------
//
// Only the trunk is here. The two leg cuffs are built in `legs.js` and hang off
// the hip joints, because a cuff that stays behind while the thigh swings
// through it is the single most obvious rigging failure a walk cycle can have.
export function buildShortsTrunk({ materials }) {
  const group = new THREE.Group();

  const top = M.shorts.top;
  const bottom = M.shorts.top - 0.098 * M.height;    // down to the crotch
  const gap = 0.009 * M.height;

  const radAt = (u, y, out) => {
    const [hw, hd] = trunkProfile(y);
    const a = u * Math.PI * 2;
    const fold = 1 + 0.05 * Math.sin(u * Math.PI * 6.0);
    return new THREE.Vector3(
      Math.cos(a) * (hw * 1.05 * fold + gap + out), y,
      Math.sin(a) * (hd * 1.05 * fold + gap + out),
    );
  };
  const yAt = (u, vv) => bottom + (top - bottom) * vv;

  // One hole worn through the seat, and the waistband is left whole: a torn
  // waistband makes the garment look like it is falling off, which reads as a
  // different joke.
  const keepQuad = (u, vv) => {
    const du = (u - 0.72) / 0.050, dv = (vv - 0.42) / 0.20;
    return du * du + dv * dv >= 1;
  };

  put(group, shell2({
    uSteps: 40, vSteps: 10, closedU: true,
    outer: (u, vv) => radAt(u, yAt(u, vv), M.shorts.thickness),
    inner: (u, vv) => radAt(u, yAt(u, vv), 0),
    keepQuad,
  }), materials.shorts);

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });
  return { group, dispose() { for (const g of geometries) g.dispose(); } };
}

// A tattered tube around a limb: the shorts cuffs and the torn jacket sleeves
// are both this. `axis` runs from the top of the tube to its nominal hem, and
// the hem is then chewed away by `tatter`.
export function tatteredCuff({
  material, top, bottom, rTop, rBottom, tatter, teeth = 7, seed = 5, thickness,
  holes = [], uSteps = 24, vSteps = 6,
}) {
  const hemAt = (u) => bottom + tornEdge(u, teeth, tatter, seed);
  const at = (u, vv, out) => {
    const h = hemAt(u);
    const y = h + (top - h) * vv;
    const t = (y - bottom) / Math.max(1e-6, top - bottom);
    const r = rBottom + (rTop - rBottom) * t + out;
    const a = u * Math.PI * 2;
    const fold = 1 + 0.05 * Math.sin(u * Math.PI * 5.0 + seed);
    return new THREE.Vector3(Math.cos(a) * r * fold, y, Math.sin(a) * r * fold);
  };
  const keepQuad = holes.length ? (u, vv) => {
    for (const h of holes) {
      const du = (((u - h[0]) % 1) + 1.5) % 1 - 0.5;
      const dv = vv - h[1];
      if ((du / h[2]) ** 2 + (dv / h[3]) ** 2 < 1) return false;
    }
    return true;
  } : null;
  return {
    geometry: shell2({
      uSteps, vSteps, closedU: true,
      outer: (u, vv) => at(u, vv, thickness),
      inner: (u, vv) => at(u, vv, 0),
      keepQuad,
    }),
    material,
  };
}

export { v };
