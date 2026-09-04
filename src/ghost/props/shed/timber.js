import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import F from '../fence/metrics.js';
import { board, rng } from '../fence/wood.js';

// The shed's boards are the fence's boards. board() and rng() come straight
// from fence/wood.js and nothing here draws a plank of its own; what this file
// adds is the two things the shed needs that a seven-picket panel never did.
//
// 1. PAINT. panel.js keeps its paintBoard private, and its woodPanelMaterial
//    (which is exported, and is the material used here) will not draw a board
//    that has no `color` and no `aGrain` attribute: the vertex colour comes out
//    undefined and the grain phase with it. So the same two attributes have to
//    be written here, to the same conventions. `axis` is the one to get right:
//    0 for a board still standing on its length along +Y, 1 for one already
//    laid down along +X by layAlongX. Wrong and the grain runs across the board
//    instead of along it.
//
// 2. MERGE. A shed is sixty boards where a fence panel is ten, and sixty
//    meshes is not a prop, it is a scene. Merging is safe here in a way it is
//    NOT safe in debris.js, and the difference is worth stating because
//    debris.js says the opposite in as many words: woodPanelMaterial reads the
//    grain out of OBJECT space, so merging is only safe when every board going
//    into one geometry already agrees about which way is along the grain.
//    Debris planks lie at every heading on the floor, so merging them puts one
//    world-axis grain across the whole pile. A wall of vertical boards, or one
//    slope's worth of horizontal courses, all agree by construction. That is
//    the whole rule, and it is why the merge groups below are per wall and per
//    slope and not per shed.

export { rng };

const PALE = new THREE.Color(F.wood.pale);
const SHADE = new THREE.Color(F.wood.shade);

export const GRAIN_UP = 0;      // board standing on end, length along +Y
export const GRAIN_ALONG = 1;   // board lying along +X, as railGeometry leaves it

// Writes the vertex colour and the grain attribute panel.js's shader wants.
// Deliberately the same shape as panel.js's paintBoard, including the dirt in
// the first centimetre out of the ground, so a clad board and a picket weather
// alike where they stand next to each other.
export function paint(geo, rand, { axis = GRAIN_UP, groundEnd = true, weather = 0 } = {}) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const grain = new Float32Array(n * 2);
  const c = new THREE.Color();

  const phase = rand() * Math.PI * 2;
  const tint = rand() * F.grain.tint + weather;
  const mottlePhase = rand() * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const along = axis === GRAIN_ALONG ? pos.getX(i) : pos.getY(i);
    let k = tint + 0.10 * (0.5 + 0.5 * Math.sin(along * 4.3 + mottlePhase))
                 + 0.06 * (0.5 + 0.5 * Math.sin(along * 11.7 + phase));
    // Only boards that actually reach the dirt take the grubby foot. A course
    // of roof boards two metres up would otherwise come out dark at one end
    // for no reason, which is the mistake the `groundEnd` flag exists to stop.
    if (groundEnd) k += Math.max(0, 1 - along / 0.09) * 0.22;
    c.copy(PALE).lerp(SHADE, Math.min(1, k));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    grain[i * 2] = phase;
    grain[i * 2 + 1] = axis;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrain', new THREE.BufferAttribute(grain, 2));
  return geo;
}

// A sawn end with the arris knocked off, as a profile for board().
//
// THE TRAP, which cost a render and is the same one fence/metrics.js records
// against the post's eased top, from the other side. board() samples profile(t)
// at evenly spaced rings and lofts straight lines between them, so an ease
// SHORTER than one segment does not come out short: it comes out smeared over
// the whole last segment. The cladding runs 7 segments over 1.4m, so a 14mm
// ease asked for at the top of a wall board arrived as a 200mm spike, every
// board on the shed came to a point, and the wall read as a row of pickets
// with black wedges of interior between them.
//
// Two things follow, and both are load-bearing:
//
//   1. The taper's LENGTH is one segment, whatever is asked for. It cannot be
//      shorter. So it is chosen, not wished for: keep the segment count honest
//      about the board's length and read the taper as "the last segment".
//   2. Because the taper is that long, how much it takes IN WIDTH has to be
//      small, or it opens a wedge between neighbouring boards. The shaping goes
//      into the THICKNESS instead, which is the front-to-back dimension nobody
//      is looking down and which is what actually rounds the top edge over and
//      puts a highlight on it.
//
// Hence two takes rather than one. `take` narrows the board, `roll` thins it.
export function easedTop(ease, take = 0.10, roll = 0.5) {
  return (t) => {
    if (t <= 1 - ease) return [1, 1];
    const k = (t - (1 - ease)) / ease;
    const e = 1 - Math.sqrt(Math.max(0, 1 - k * k));
    return [1 - take * e, 1 - roll * e];
  };
}

// Both ends eased, for a board that is cut at both ends and shows both: a roof
// course, a lintel, a brace. board()'s profile is one function of t, so the two
// ends are the same easing read forwards and backwards and the narrower of the
// two wins wherever they overlap.
export function easedBoth(ease, take = 0.10, roll = 0.5) {
  const one = easedTop(ease, take, roll);
  return (t) => {
    const a = one(t);
    const b = one(1 - t);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  };
}

// How many segments a board of this length wants, so that one segment (and so
// the eased end above) is about `step` long. Clamped, because a 3m roof course
// does not need thirty rings and a 100mm brace still needs a few.
export function segmentsFor(length, step, lo = 5, hi = 16) {
  return Math.min(hi, Math.max(lo, Math.round(length / step)));
}

// Turns a board that board() built standing on +Y into one lying along +X,
// centred on the origin. Exactly railGeometry's rotation, and the reason it is
// a shared helper is that panel.js's shader has the sign of that rotation baked
// into it: +X maps to -Y, so a board laid down any other way gets its grain
// mirrored across its own width.
export function layAlongX(geo, length) {
  geo.rotateZ(-Math.PI / 2);
  geo.translate(-length / 2, 0, 0);
  return geo;
}

// A standing board, at rest on y = 0 growing up +Y.
export function upright({ length, width, thickness, round, warp = 0, profile = null, segments, ring, rand }) {
  return board({
    length,
    width,
    thickness,
    round,
    // Bowing out of the wall rather than along it, for the reason picketGeometry
    // gives: a board is nailed top and bottom so it cannot bow sideways, and a
    // sideways bow eats unevenly into the gaps between boards, which is the one
    // irregularity that reads as a mistake rather than as age.
    warp: (rand() - 0.5) * 2 * warp,
    warpAxis: 'z',
    profile,
    segments,
    ring,
  });
}

// A board lying along +X, centred, ready to be placed by its middle.
export function lying({ length, width, thickness, round, warp = 0, profile = null, segments, ring, rand }) {
  const geo = board({
    length,
    width,
    thickness,
    round,
    // Sag rather than bow, and signed positive: after layAlongX, +X maps to -Y,
    // so a positive warp droops. Same reasoning as the fence rail.
    warp: (0.35 + 0.65 * rand()) * warp,
    warpAxis: 'x',
    profile,
    segments,
    ring,
  });
  return layAlongX(geo, length);
}

// Merge a list of [geometry, matrix] into one. The matrix is baked, which is
// the point: after this there is one mesh where there were forty. Every input
// is disposed, because nothing else holds a reference to them.
export function fuse(parts) {
  const staged = parts.map(([geo, m]) => {
    const g = m ? geo.clone().applyMatrix4(m) : geo;
    if (m) geo.dispose();
    return g;
  });
  const merged = mergeGeometries(staged, false);
  for (const g of staged) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// Placement, as a matrix, since fuse() bakes rather than parents.
export function at(x, y, z, { rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  return m;
}
