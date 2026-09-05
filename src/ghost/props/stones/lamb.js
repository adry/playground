import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';

// The Victorian child's grave: a lamb lying couchant on a low plinth, head up,
// legs folded under it.
//
// This is the only ANIMAL in a set of twenty three pieces of architecture, and
// that is the whole risk of it. A lamb built the way a toy lamb is built, a
// body with four legs and two ears stuck on, would be a soft toy sitting on a
// gravestone. What is wanted is a CARVING of a lamb: one lump of stone that a
// mason has coaxed a creature out of, and that a century of rain has taken the
// edges off again.
//
// Three decisions carry that, and all three are about mass rather than detail.
//
//   1. It is one surface, not an assembly. Body, haunches, fleece, neck, head,
//      muzzle, ears and the folded legs are sixteen ellipsoids blended with a
//      smooth minimum and contoured as a single implicit surface, so there is
//      no seam anywhere on the animal and no place where two primitives cross
//      at an angle. A stack of spheres reads as a snowman, because the eye
//      finds the intersection curve between any two of them instantly.
//   2. The fleece is four lumps and no more. Curls, dimples, a wool texture:
//      all of it disappears at the seventy pixels this prop actually occupies,
//      and all of it makes the piece read as plush rather than as stone. Three
//      swells along the back and one over each haunch is the whole fleece, and
//      they are big enough to survive being seen from thirty feet.
//   3. It grows out of its plinth. A low wide foot is blended into the body at
//      the block's top face, and the implicit surface is cut off flat 25mm
//      INSIDE the block, so the lamb has no underside of its own: where the
//      animal meets the stone there is a fillet, which is what a carved lamb
//      has and a lamb placed on a shelf does not.
//
// The plinth is the registry's own slab with its arch squared off, so the block
// gets the family rim, the family mottle and the family engraving treatment,
// and the inscription needs no special handling at all. It is a low, wide,
// nearly cubic die: 0.72 by 0.32 by 0.34 on a 0.12 pad. Standing 0.87 to the
// top of the head, this belongs with bench at 0.81 and book at 0.81, at the
// bottom of the set, which is the point. It is a child's grave.

// --- the plinth -------------------------------------------------------------

const W = 0.36;      // half width of the die, so 0.72 along the lamb
const H = 0.32;      // its height
const D = 0.34;      // and its depth, just enough for the ears to sit over
const PLINTH = 0.12; // the pad under it
const TOP = PLINTH + H; // 0.46, the top face the lamb is carved out of

// --- the lamb ---------------------------------------------------------------
//
// Lamb coordinates have their origin at the middle of the block's top face:
// x runs along the body from rump at negative to chest at positive, y is up
// from the top face, z is toward the inscribed front.
//
// Every number here is a half extent, so a part's smallest dimension is twice
// its smallest radius. That matters: the registry's rim radius is 0.062 and
// nothing in this set is allowed to be thinner than about 0.13 across, or it
// stops reading as the same material as its neighbours. The ear, the thinnest
// thing on the piece, is 0.15 long and 0.096 wide before the blend fattens it.
//
// `k` is the blend radius against everything already accumulated. Large values
// melt a part into the mass, which is what the fleece wants; small values let
// it keep its own shape, which is what the muzzle wants.
const PARTS = [
  // The foot: a low wide swell right at the block's top face. Never seen as a
  // shape of its own, but it is what puts a fillet all the way round where the
  // animal meets the stone.
  { c: [-0.040, 0.010, 0], r: [0.225, 0.070, 0.120], k: 0.075 },

  // The barrel. One ellipsoid, and every other part on the body is a swelling
  // hung off it.
  { c: [-0.055, 0.128, 0], r: [0.185, 0.120, 0.108], k: 0.070 },

  // The hind legs, folded against the flanks. They are not legs, they are the
  // two biggest lumps on the piece: on a couchant animal the hind quarter is a
  // single mass with a knee somewhere in it, and carving it as anything more is
  // how a lamb turns into a deer. Blended tighter than the fleece so the flank
  // keeps an edge to catch the key light.
  { c: [-0.145, 0.105, 0.082], r: [0.135, 0.100, 0.060], k: 0.045 },
  { c: [-0.145, 0.105, -0.082], r: [0.135, 0.100, 0.060], k: 0.045 },

  // The fleece: three swells along the back, biggest over the rump, smallest
  // over the shoulder, so the topline falls from tail to neck the way a real
  // one does, with a shallow dip behind the shoulder. Three and not thirty:
  // curls disappear at the seventy pixels this prop occupies and take the read
  // with them, so what has to survive is a big soft lump and the valley beside
  // it.
  { c: [-0.175, 0.196, 0], r: [0.098, 0.098, 0.098], k: 0.034 },
  { c: [-0.040, 0.186, 0], r: [0.090, 0.086, 0.092], k: 0.034 },
  { c: [0.070, 0.166, 0], r: [0.082, 0.076, 0.086], k: 0.034 },
  { c: [-0.115, 0.140, 0.078], r: [0.078, 0.078, 0.064], k: 0.034 },
  { c: [-0.115, 0.140, -0.078], r: [0.078, 0.078, 0.064], k: 0.034 },
  { c: [0.010, 0.130, 0.080], r: [0.074, 0.074, 0.062], k: 0.034 },
  { c: [0.010, 0.130, -0.080], r: [0.074, 0.074, 0.062], k: 0.034 },

  // The chest, and the forelegs tucked under it. The foreleg is one long low
  // roll along the base with a knee at the front of it: from above, which is
  // where this camera lives, that is all a folded foreleg ever shows. The knee
  // gets the tightest blend on the animal after the muzzle, because it is the
  // one place the light has to find a shadow under something.
  { c: [0.100, 0.130, 0], r: [0.102, 0.100, 0.100], k: 0.055 },
  { c: [0.070, 0.050, 0.086], r: [0.150, 0.048, 0.052], k: 0.034 },
  { c: [0.070, 0.050, -0.086], r: [0.150, 0.048, 0.052], k: 0.034 },
  { c: [0.182, 0.062, 0.082], r: [0.060, 0.060, 0.052], k: 0.030 },
  { c: [0.182, 0.062, -0.082], r: [0.060, 0.060, 0.052], k: 0.030 },

  // Neck and head. The one gap on the whole animal is the notch between the
  // back of the head and the shoulder fleece, and it is the feature that says
  // "head up" rather than "asleep": the neck is kept narrow, the shoulder lump
  // is kept behind it, and the head is carried high enough that the notch
  // survives the blend.
  { c: [0.150, 0.258, 0.012], r: [0.068, 0.118, 0.072], k: 0.046 },
  { c: [0.188, 0.368, 0.026], r: [0.084, 0.078, 0.076], yaw: 0.18, k: 0.042 },
  // The muzzle. Short and blunt: a lamb's is, and anything longer immediately
  // reads as a horse. Blended tighter than anything else so the head keeps a
  // brow above it.
  { c: [0.248, 0.320, 0.040], r: [0.062, 0.052, 0.054], yaw: 0.18, pitch: -0.22, k: 0.028 },
  // The ears, dropped along the cheeks rather than held out. Held out they
  // caught the key light along their whole length and read as horns from the
  // set's own camera. Flat lugs, not leaves: 0.14 long, 0.096 across and 0.064
  // thick, which is as thin as this style goes.
  { c: [0.196, 0.331, 0.099], r: [0.058, 0.032, 0.046], yaw: 1.46, pitch: -0.466, k: 0.026 },
  { c: [0.196, 0.331, -0.099], r: [0.058, 0.032, 0.046], yaw: -1.46, pitch: -0.466, k: 0.026 },
];

// Where the implicit surface is cut off flat. 25mm below the block's top face,
// so the cap is buried in the die and the lamb has no underside: at that depth
// the die is still 0.328 by 0.158 in plan, well outside the foot's own 0.235 by
// 0.135, so no part of the cut can surface through the block's rolled rim.
const CUT = -0.025;

// Contour cell. The ear is 0.064 through, so this puts seven cells across the
// thinnest thing on the piece; halving it doubles the triangle count and moved
// no silhouette by a pixel at prop size.
const CELL = 0.0120;

// --- the implicit surface ---------------------------------------------------

// The polynomial smooth minimum. Two distance fields joined by this get a
// fillet of radius roughly k where they meet, and nothing anywhere else, which
// is exactly the mason's thumb: soft in the crooks, unaltered on the swells.
function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

// The field, as one flat table of parts rather than an array of objects. Each
// part is twelve numbers: centre, inverted radii, smallest radius, the cosine
// and sine of its yaw and of its pitch, and its blend radius. This is read
// about two million times per lamb, and a table of doubles is roughly three
// times the speed of the same numbers held on seventeen little objects.
const STRIDE = 12;

function packParts(parts) {
  const t = new Float64Array(parts.length * STRIDE);
  parts.forEach((p, i) => {
    const yaw = p.yaw || 0;
    const pitch = p.pitch || 0;
    t.set([
      p.c[0], p.c[1], p.c[2],
      1 / p.r[0], 1 / p.r[1], 1 / p.r[2],
      Math.min(p.r[0], p.r[1], p.r[2]),
      Math.cos(yaw), Math.sin(yaw),
      Math.cos(pitch), Math.sin(pitch),
      p.k,
    ], i * STRIDE);
  });
  return t;
}

// Signed distance to the whole animal, negative inside, cut off flat where the
// lamb enters the plinth.
//
// Each part is an ellipsoid in its own yawed and pitched frame, measured with
// the standard gradient-corrected bound rather than a true distance. That is
// fine here: the smooth minimum only needs a field that is smooth, near-metric
// and correctly signed, and the correction is what keeps the blend radius the
// same at the pole of a long part as it is at its equator.
//
// The blend itself is the polynomial smooth minimum, which puts a fillet of
// roughly k where two parts meet and changes nothing anywhere else. That is
// exactly the mason's thumb: soft in every crook, untouched on every swell.
function fieldAt(t, x, y, z) {
  let d = 1e9;
  for (let o = 0; o < t.length; o += STRIDE) {
    let dx = x - t[o];
    let dy = y - t[o + 1];
    let dz = z - t[o + 2];
    // Into the part's frame. Yaw turns the part's long axis toward +z, pitch
    // lifts it toward +y, and both are applied as their inverse here.
    const cy = t[o + 7];
    const sy = t[o + 8];
    let u = dx * cy + dz * sy;
    dz = dz * cy - dx * sy;
    const cp = t[o + 9];
    const sp = t[o + 10];
    dx = u * cp + dy * sp;
    dy = dy * cp - u * sp;

    const ax = dx * t[o + 3];
    const ay = dy * t[o + 4];
    const az = dz * t[o + 5];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    let di;
    if (k0 < 1e-6) {
      di = -t[o + 6];
    } else {
      const bx = ax * t[o + 3];
      const by = ay * t[o + 4];
      const bz = az * t[o + 5];
      di = (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
    }

    const k = t[o + 11];
    const m = d < di ? d : di;
    const h = Math.max(0, k - Math.abs(d - di)) / k;
    d = m - h * h * k * 0.25;
  }
  // The flat cut, buried in the plinth.
  return d > CUT - y ? d : CUT - y;
}

// --- contouring -------------------------------------------------------------
//
// Surface nets rather than marching cubes. One vertex per cell placed at the
// average of that cell's edge crossings, quads between the four cells around
// every crossed grid edge: it needs no 256-entry triangle table, it puts
// vertices where the surface is rather than on the grid lines, and its output
// is a well-shaped quad mesh instead of the sliver triangles marching cubes
// leaves wherever the surface passes close to a corner.
//
// Normals are NOT taken from the triangles. They are the gradient of the same
// field the surface came from, sampled at the finished vertex, so the shading
// is that of the ideal blended surface and carries none of the contouring
// grid's own quantisation. That one choice is the difference between a smooth
// carved animal and a faceted one.
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
// The twelve edges as pairs of corner indices, one bit apart.
const EDGES = [];
for (let a = 0; a < 8; a++) {
  for (let b = a + 1; b < 8; b++) {
    const x = a ^ b;
    if (x === 1 || x === 2 || x === 4) EDGES.push([a, b]);
  }
}

function contour(parts) {
  const t = packParts(parts);

  // Bounds. Each part's extent along a world axis is the length of its radius
  // vector projected through its own rotation, not its largest radius: taking
  // the lazy route here put a quarter of the grid outside the animal, since the
  // ears are 0.15 long and lie across z while nothing else on the piece is more
  // than 0.12 deep.
  let x0 = 1e9; let y0 = 1e9; let z0 = 1e9;
  let x1 = -1e9; let y1 = -1e9; let z1 = -1e9;
  const hyp3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);
  for (const p of parts) {
    const cy = Math.cos(p.yaw || 0);
    const sy = Math.sin(p.yaw || 0);
    const cp = Math.cos(p.pitch || 0);
    const sp = Math.sin(p.pitch || 0);
    const [rx, ry, rz] = p.r;
    const ex = hyp3(cy * cp * rx, cy * sp * ry, sy * rz) + p.k;
    const ey = hyp3(sp * rx, cp * ry, 0) + p.k;
    const ez = hyp3(sy * cp * rx, sy * sp * ry, cy * rz) + p.k;
    x0 = Math.min(x0, p.c[0] - ex); x1 = Math.max(x1, p.c[0] + ex);
    y0 = Math.min(y0, p.c[1] - ey); y1 = Math.max(y1, p.c[1] + ey);
    z0 = Math.min(z0, p.c[2] - ez); z1 = Math.max(z1, p.c[2] + ez);
  }
  y0 = Math.max(y0, CUT);
  const pad = 2 * CELL;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const NX = Math.ceil((x1 + pad - x0) / CELL) + 1;
  const NY = Math.ceil((y1 + pad - y0) / CELL) + 1;
  const NZ = Math.ceil((z1 + pad - z0) / CELL) + 1;
  const SY = NX;
  const SZ = NX * NY;

  // The field, one row of x at a time, sampled only where it matters.
  //
  // OUTSIDE the animal the field is very nearly a distance: measured over the
  // whole grid, its gradient never exceeds 1.11. So a sample of 0.09 promises
  // there is no surface within about 0.08 of it, and the next seven samples
  // along the row can be filled in from that promise rather than computed. Only
  // the band within NEAR of the surface is evaluated exactly, and that is the
  // only band a cell corner is ever interpolated from: a filled sample is at
  // least NEAR out, its neighbours are within one cell diagonal of it, and
  // NEAR is more than that diagonal, so no cell that touches a filled sample
  // can straddle the surface.
  //
  // INSIDE, none of that holds and every sample is computed. The ellipsoid
  // bound is only near-metric outside its own shape; deep in the middle of a
  // flattened part its gradient reaches 35, because "how far to the surface"
  // there swings between the part's smallest and largest radius over almost no
  // distance at all. Skipping on the strength of an interior sample is what put
  // a one-quad hole in the crook behind an ear, which is the sort of thing that
  // renders as a black speck at prop size and is invisible at turntable size.
  const NEAR = 3 * CELL;
  const STEP = 0.82 * CELL;
  const field = new Float32Array(NX * NY * NZ);
  for (let k = 0; k < NZ; k++) {
    const z = z0 + k * CELL;
    for (let j = 0; j < NY; j++) {
      const y = y0 + j * CELL;
      const o = k * SZ + j * SY;
      let i = 0;
      while (i < NX) {
        const v = fieldAt(t, x0 + i * CELL, y, z);
        field[o + i] = v;
        const skip = v > NEAR ? Math.floor((v - NEAR) / STEP) : 0;
        if (skip > 0) {
          const last = Math.min(skip, NX - 1 - i);
          for (let n = 1; n <= last; n++) field[o + i + n] = v - n * STEP;
          i += skip + 1;
        } else {
          i++;
        }
      }
    }
  }

  // One vertex per crossed cell, at the mean of that cell's edge crossings.
  const CX = NX - 1;
  const CY = NY - 1;
  const CZ = NZ - 1;
  const cellVert = new Int32Array(CX * CY * CZ).fill(-1);
  const pos = [];
  const c = new Float32Array(8);

  for (let k = 0; k < CZ; k++) {
    for (let j = 0; j < CY; j++) {
      const row = k * SZ + j * SY;
      for (let i = 0; i < CX; i++) {
        const b = row + i;
        c[0] = field[b];
        c[1] = field[b + 1];
        c[2] = field[b + SY];
        c[3] = field[b + SY + 1];
        c[4] = field[b + SZ];
        c[5] = field[b + SZ + 1];
        c[6] = field[b + SZ + SY];
        c[7] = field[b + SZ + SY + 1];
        let mask = 0;
        for (let n = 0; n < 8; n++) if (c[n] < 0) mask |= 1 << n;
        if (mask === 0 || mask === 255) continue;
        let sx = 0; let sy = 0; let sz = 0; let n = 0;
        for (let e = 0; e < EDGES.length; e++) {
          const a = EDGES[e][0];
          const bb = EDGES[e][1];
          if ((c[a] < 0) === (c[bb] < 0)) continue;
          const f = c[a] / (c[a] - c[bb]);
          sx += CORNERS[a][0] + f * (CORNERS[bb][0] - CORNERS[a][0]);
          sy += CORNERS[a][1] + f * (CORNERS[bb][1] - CORNERS[a][1]);
          sz += CORNERS[a][2] + f * (CORNERS[bb][2] - CORNERS[a][2]);
          n++;
        }
        cellVert[(k * CY + j) * CX + i] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * CELL, y0 + (j + sy / n) * CELL, z0 + (k + sz / n) * CELL);
      }
    }
  }

  // Quads. One per crossed grid edge, joining the four cells around it, wound
  // so the front face is the one the field says is outside. The cells all exist
  // wherever a crossing does, which the two cells of air around the bounds
  // guarantee.
  const idx = [];
  const cv = (i, j, k) => cellVert[(k * CY + j) * CX + i];
  const quad = (a, b, c2, d, flip) => {
    if (a < 0 || b < 0 || c2 < 0 || d < 0) return;
    if (flip) idx.push(a, b, c2, a, c2, d);
    else idx.push(a, c2, b, a, d, c2);
  };
  for (let k = 1; k < NZ - 1; k++) {
    for (let j = 1; j < NY - 1; j++) {
      const row = k * SZ + j * SY;
      for (let i = 1; i < NX - 1; i++) {
        const inside = field[row + i] < 0;
        if (inside !== (field[row + i + 1] < 0)) {
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), inside);
        }
        if (inside !== (field[row + i + SY] < 0)) {
          quad(cv(i - 1, j, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i - 1, j, k), !inside);
        }
        if (inside !== (field[row + i + SZ] < 0)) {
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), inside);
        }
      }
    }
  }

  // Normals from the field's own gradient. The step is a third of a cell: wide
  // enough that the ellipsoid bound's own rounding error cancels, narrow enough
  // to keep the fillets crisp.
  const nor = new Float32Array(pos.length);
  const e = CELL / 3;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v];
    const y = pos[v + 1];
    const z = pos[v + 2];
    const gx = fieldAt(t, x + e, y, z) - fieldAt(t, x - e, y, z);
    const gy = fieldAt(t, x, y + e, z) - fieldAt(t, x, y - e, z);
    const gz = fieldAt(t, x, y, z + e) - fieldAt(t, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor[v] = gx / l;
    nor[v + 1] = gy / l;
    nor[v + 2] = gz / l;
  }

  return { pos: new Float32Array(pos), nor, idx };
}

// ---------------------------------------------------------------------------

// Four letters at most, and a child's name rather than an epitaph. A lamb needs
// no explaining and this face is small: at the set's own letter height, which
// is 0.10 world units of cap, a five letter word already runs into the rolled
// rim of a 0.68 wide face.
const NAMES = ['ADA', 'AMY', 'IDA', 'EVA', 'TOM'];

registerStone('lamb', {
  // A low die rather than a headstone. topRadius just clear of the rim radius
  // squares the top off, which it has to be: the lamb is carved out of the top
  // face and an arch would leave it standing on a ridge.
  shape: { halfWidth: W, height: H, depth: D, plinth: PLINTH },
  topRadius: 0.07,
  bottomRadius: 0.07,

  // One line, centred a little above the middle of the face, and nothing else.
  draw(ctx, w, h, rng) {
    const size = h * 0.42;
    inkText(ctx, NAMES[Math.floor(rng() * NAMES.length) % NAMES.length], w / 2, h * 0.47, size, size * 0.05);
  },

  extras({ body, material, rng, lean, disposables, stripUV }) {
    // Per casting variation, all of it small and none of it able to break the
    // read: a hair more or less turn in the head, ears at slightly different
    // angles, and each fleece lump within four percent of its authored size.
    // Two lambs side by side are the same animal carved twice, not two animals.
    const jitter = (v, a) => v * (1 + (rng() - 0.5) * a);
    const turn = (rng() - 0.5) * 0.14;
    const parts = PARTS.map((p, i) => {
      let yaw = p.yaw || 0;
      let pitch = p.pitch || 0;
      if (i >= 17) yaw += turn; // head, muzzle and both ears turn together
      if (i >= 19) pitch = jitter(pitch, 0.30);
      return {
        c: p.c,
        r: p.r.map((v) => (i >= 4 && i <= 10 ? jitter(v, 0.08) : v)),
        yaw,
        pitch,
        k: p.k,
      };
    });

    const { pos, nor, idx } = contour(parts);

    // UVs. The lamb samples the plain strip on the right of the texture, never
    // the face, so no letter can be dragged round the animal: u sweeps with the
    // horizontal direction from the body's axis and v climbs it, both parked
    // well above the grime band at the bottom of the map, which belongs to the
    // pad on the ground.
    const uv = new Float32Array((pos.length / 3) * 2);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < lo) lo = pos[i];
      if (pos[i] > hi) hi = pos[i];
    }
    const span = Math.max(1e-4, hi - lo);
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
      const r = Math.hypot(pos[i], pos[i + 2]) || 1;
      const [u, v] = stripUV(pos[i] / r, 0.55 + 0.35 * ((pos[i + 1] - lo) / span), 1, 1);
      uv[j] = u;
      uv[j + 1] = v;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = TOP;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    disposables.push(geo);
    body.add(mesh);

    // The registry's lean stands, because a hand-set plinth settles like any
    // other and the lamb is carved out of the block rather than balanced on it,
    // so nothing can slide. It does need a little more sink than the default:
    // the pad is 0.83 by 0.47 and the worst lean lifts a corner by about 12mm,
    // which is the whole of the standard sink on its own.
    lean.sink -= 0.006;
  },
});
