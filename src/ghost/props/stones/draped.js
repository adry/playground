import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';

// A draped slab: an upright headstone with a carved stone pall thrown over its
// top.
//
// The identity is one thing only: the top of this stone is SOFT where every
// other stone's is hard. So the slab underneath is deliberately the dullest in
// the set -- square topped, no arch, no finial -- and everything the eye gets
// is the cloth: a rolled mass over the top, a hang down the front and the back,
// a soft swag between them, and a corner falling past each shoulder. The
// inscription sits on the bare face below the hem, which is a third of a face
// less room than the other stones get, so it is three short lines and nothing
// else.
//
// ---------------------------------------------------------------------------
// How the cloth is built
//
// Not as a sheet dropped on the stone, and not as a lump modelled by hand: as
// an OFFSET OF THE STONE ITSELF, the way urn.js built its drape as a
// displacement of the surface underneath rather than as a separate mesh. The
// reason is the same one urn.js gives: normals taken by central differences off
// the grid that actually got built cannot disagree with the shape that grid
// made. What is different here is that a slab's front face is flat and its
// registered `extras` cannot deform the slab, so the cloth has to be its own
// mesh. It is therefore a closed SHELL whose inner side is the stone's own
// surface pushed out by a few millimetres, so it can never intersect the stone
// and never z-fights with it.
//
// The whole construction rests on one fact about this slab. With topRadius set
// to the slab's own edge radius, the top of the stone is exactly the Minkowski
// sum of a box -- half-extents (W - e) by (D/2 - e), top face at H - e -- with
// a ball of radius e. Every point of the stone up there is `box point + e *
// unit direction`. Push that to e + g and you have a surface exactly parallel
// to the stone; push it to e + g + t and you have the outside of a cloth of
// thickness t. Both are one line of code and neither can drift.
//
// The cloth's own material coordinates (a, b) are a flat rectangle: a across
// the width, b front to back. It is laid on the box by ARC LENGTH, which is
// what a cloth does and a scaled sheet does not: material inside the top face
// lies on the top face, material past an edge wraps the quarter round of radius
// r and then hangs straight down by exactly the length left over. That map is
// isometric everywhere except at the four corners, where no map is isometric
// and real cloth gathers -- and it is there, where the leftover length is the
// DIAGONAL, that the pall hangs lowest and gives each shoulder its falling
// corner for free.
//
// ---------------------------------------------------------------------------
// The five ways urn.js says this goes wrong, and what is done about each
//
//  1. Cloth carried over the lid melts it. Nothing here is carried over
//     anything that has to stay crisp: the drape's whole job is to eat the top,
//     and the slab's top is a plain square shoulder with nothing to lose.
//  2. Cloth carried out past the rim leaves a horizontal shelf that reads as a
//     spiky wing. No part of this cloth is unsupported. The hem is a closed
//     loop lying ON the stone everywhere, and the material never extends past
//     a surface it can hang against.
//  3. A short angular fade puts the whole drop in radius into four columns and
//     creases. There is no fade: thickness is constant across the span and the
//     cloth stops at a hem, which is what cloth does.
//  4. A hem as a ramp is a smudge. The hem is not a ramp.
//  5. A hem as a cliff is a black crack. Nor a cliff. The outer surface turns
//     through a right angle on a circular profile and closes onto the inner
//     one, swelling just above it into a bead, so the free edge is a roll with
//     the key light on top of it and its own thin shadow underneath.

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The slab. Squared off, and a shade narrower and shorter than the cross so the
// cloth's overhang can add its width back without the piece becoming the widest
// thing in the yard. Plinth included it stands 1.48, between fred at 1.10 and
// cross at 1.56.
const SHAPE = { halfWidth: 0.40, height: 1.38, depth: 0.33, plinth: 0.18 };

// ---------------------------------------------------------------------------
// the cloth
//
// Lengths are in stone units. The hang numbers are all measured DOWN FROM THE
// SHOULDER, not from the top of the stone, because that is the number the eye
// reads and the one that decides how much face is left for the lettering.
const CLOTH = {
  thick: 0.032, // a chunky vinyl cloth; below about 0.030 it reads as paper
  gapMin: 0.0035, // clearance at the hem: the shadow line under the roll
  gapMax: 0.0130, // and further in, where nothing can see it, enough to keep
  // the cloth's shadow off the stone it is lying on
  roll: 0.055, // how much material the rolled hem takes, in material units
  bead: 0.34, // and how far it swells past its own thickness just inside it

  endOver: 0.070, // hang down the ENDS of the stone, below the shoulder roll
  fallMid: 0.345, // hang down the front, at the middle
  fallEnd: 0.420, // and at the outer end of the material, which is what sets
  // how far the corner falls past the shoulder
  swag: 0.090, // the middle of the front hem dips this much further again
  tilt: 0.022, // and the whole hem falls further on one side than the other

  // Fewer, deeper. Three ridges across the face, and between them a narrow
  // groove each, because a ridge alone is a swell and a swell is what the light
  // never finds: the first three passes of this drape read as icing poured over
  // the stone. What says cloth at toy scale is the DARK LINE between two folds,
  // so the creases are a third the width of the ridges and cut most of the way
  // through the cloth's thickness.
  ridges: [
    { p: -0.270, w: 0.105, a: 0.80 },
    { p: 0.000, w: 0.150, a: 1.00 },
    { p: 0.270, w: 0.100, a: 0.85 },
  ],
  creases: [
    { p: -0.375, w: 0.050, a: 0.75 },
    { p: -0.155, w: 0.055, a: 1.00 },
    { p: 0.155, w: 0.055, a: 0.95 },
    { p: 0.375, w: 0.050, a: 0.70 },
  ],
  foldDepth: 0.90, // ridge height as a fraction of the cloth's thickness
  creaseDepth: 0.85, // and how much of that thickness a groove takes back
  hemWave: 0.050, // how much lower the hem hangs under a ridge
  // Folds gather at the bottom of a hanging cloth and are pulled out of it over
  // the shoulder, so they open downwards rather than running as parallel pipes.
  foldBase: 0.50,
  foldFrom: 0.090,
  foldTo: 0.430,

  // The swag. Over the top the cloth is carried a little higher at the ends
  // than in the middle, so the ridge running across the top of the stone dips
  // between the two shoulders instead of lying dead flat.
  topSwell: 0.0,
};

// The rolled hem's cross-section, as a multiplier on thickness against distance
// from the free edge in units of CLOTH.roll. A quarter circle, so the surface
// leaves the edge with a vertical tangent and the hem is a true roll rather
// than a wedge; then a low swell just inside it, which is the part that catches
// the key light above the hem's own shadow.
function hemRoll(f) {
  const base = f <= 0 ? 0 : f >= 1 ? 1 : Math.sqrt(f * (2 - f));
  return base * (1 + CLOTH.bead * Math.exp(-Math.pow((f - 1.15) / 0.80, 2)));
}

// ---------------------------------------------------------------------------
// the grid
//
// Cells are packed towards the free edges: the rolled hem turns through ninety
// degrees inside about a twentieth of the material's width, and spread evenly a
// grid fine enough for that costs four times the triangles everywhere else.
const NU = 76; // cells across the width
const NV = 52; // cells front to back
const PACK = 1.55;

const warp = (t) => Math.sign(t) * (1 - Math.pow(1 - Math.abs(t), PACK));

function buildDrape({ halfWidth: W, height: H, depth: D, edge: e, rng }) {
  const ax = W - e;
  const az = D / 2 - e;
  const ytop = H - e;
  // The radius the material is wrapped at: the cloth's inner side, at its
  // thickest clearance. The actual offset varies by a few millimetres inside
  // that, which moves the surface but not the arc length worth arguing about.
  const rw = e + CLOTH.gapMax;
  const quarter = (rw * Math.PI) / 2;

  // Per-stone variation. The fold table is one hand's throw of the cloth; these
  // move it enough that two draped stones in one yard are not one casting, and
  // not so far that the three ridges stop being three ridges.
  const jit = (list, k) => list.map((f) => ({
    p: f.p + (rng() - 0.5) * k,
    w: f.w * (0.9 + rng() * 0.2),
    a: f.a * (0.85 + rng() * 0.3),
  }));
  const jitter = { ridges: jit(CLOTH.ridges, 0.055), creases: jit(CLOTH.creases, 0.045) };
  const backShift = 0.09 + (rng() - 0.5) * 0.06;
  const tilt = CLOTH.tilt * (rng() < 0.5 ? -1 : 1);

  // How far the material runs past the box, per direction.
  const A = ax + quarter + CLOTH.endOver;

  // Ridges, in material a. Gaussians rather than a cosine: hand-placed, uneven,
  // and with real flat cloth between them, which is what "fewer, deeper" means.
  const foldShape = (a, front) => {
    const sgn = front ? 1 : -1;
    let v = 0;
    for (const f of jitter.ridges) v += f.a * Math.exp(-Math.pow((a - sgn * f.p - (front ? 0 : backShift)) / f.w, 2));
    for (const f of jitter.creases) v -= CLOTH.creaseDepth * f.a * Math.exp(-Math.pow((a - sgn * f.p - (front ? 0 : backShift)) / f.w, 2));
    // Folds belong to the two big faces. They are carried to the very edge of
    // the face and die on the corner wrap: faded earlier, the outer third of
    // the front came out glassy and the drape read as a cap again.
    return v * (1 - smooth((Math.abs(a) - (ax - 0.02)) / 0.15));
  };

  // The hem, as hang below the shoulder against material a.
  const fallAt = (a, front) => {
    const t = a / A;
    const mid = CLOTH.swag * (0.5 + 0.5 * Math.cos(Math.PI * clamp(Math.abs(t) / 0.62, 0, 1)));
    return (
      CLOTH.fallMid +
      (CLOTH.fallEnd - CLOTH.fallMid) * t * t +
      mid +
      (front ? tilt : -tilt) * t +
      CLOTH.hemWave * foldShape(a, front)
    );
  };

  const rows = NU + 1;
  const cols = NV + 1;
  const aOf = new Float64Array(rows);
  for (let i = 0; i < rows; i++) aOf[i] = A * warp((2 * i) / NU - 1);
  const bOf = new Float64Array(rows * cols);
  const Bf = new Float64Array(rows);
  const Bb = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    Bf[i] = az + quarter + fallAt(aOf[i], true);
    Bb[i] = az + quarter + fallAt(aOf[i], false);
    for (let j = 0; j < cols; j++) {
      const t = warp((2 * j) / NV - 1);
      bOf[i * cols + j] = t >= 0 ? t * Bf[i] : t * Bb[i];
    }
  }

  // --- the map ---------------------------------------------------------------
  //
  // Material (a, b) onto the stone. Clamp into the box; whatever is left over
  // is the length of cloth hanging past that edge, spent first on the quarter
  // round and then straight down. `dir` comes back as the outward unit of the
  // stone's own surface at that point, which is what both shells are offset
  // along.
  const P = new Float32Array(2 * rows * cols * 3);
  const dir = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) {
    const a = aOf[i];
    for (let j = 0; j < cols; j++) {
      const b = bOf[i * cols + j];
      const cx = clamp(a, -ax, ax);
      const cz = clamp(b, -az, az);
      const dx = a - cx;
      const dz = b - cz;
      const s = Math.hypot(dx, dz);

      let nx = 0;
      let ny = 1;
      let nz = 0;
      let cy = ytop;
      if (s > 1e-9) {
        const phi = Math.min(s / rw, Math.PI / 2);
        const sp = Math.sin(phi);
        nx = (dx / s) * sp;
        ny = Math.cos(phi);
        nz = (dz / s) * sp;
        cy = ytop - Math.max(0, s - quarter);
      }

      // Distance to the free edge, per direction, in material units. Kept as
      // two numbers and multiplied rather than combined into one distance: at a
      // corner of the material the two rolls then round the cloth off in both
      // directions at once instead of creasing along the diagonal.
      const fu = (A - Math.abs(a)) / CLOTH.roll;
      const fv = (b >= 0 ? Bf[i] - b : b + Bb[i]) / CLOTH.roll;
      const grow = CLOTH.foldBase + (1 - CLOTH.foldBase) * smooth((s - CLOTH.foldFrom) / (CLOTH.foldTo - CLOTH.foldFrom));
      // The two faces carry the same ridges out of phase, so across the top
      // face one pattern is walked into the other. Switched instead of blended,
      // the mismatch fell on the middle of the top as a crease from end to end.
      const mix = smooth(0.5 + (0.5 * b) / az);
      const fold = (foldShape(a, false) * (1 - mix) + foldShape(a, true) * mix) * grow;
      const swell = CLOTH.topSwell * (a / A) * (a / A) * (1 - smooth((s - 0.02) / 0.15));
      // Cloth is pulled thin over what it is lying on and gathers where it
      // hangs free. Without this the shoulder carried the full thickness and
      // the drape turned the top of the stone into a loaf.
      const cling = 0.58 + 0.42 * smooth((s - 0.02) / 0.30);
      const t = CLOTH.thick * cling * hemRoll(fu) * hemRoll(fv) * (1 + CLOTH.foldDepth * fold + swell);
      const gap = CLOTH.gapMin + (CLOTH.gapMax - CLOTH.gapMin) * smooth(Math.min(fu, fv));

      const k = (i * cols + j) * 3;
      dir[k] = nx;
      dir[k + 1] = ny;
      dir[k + 2] = nz;
      const inner = e + gap;
      const outer = inner + t;
      P[k] = cx + outer * nx;
      P[k + 1] = cy + outer * ny;
      P[k + 2] = cz + outer * nz;
      const m = (rows * cols + i * cols + j) * 3;
      P[m] = cx + inner * nx;
      P[m + 1] = cy + inner * ny;
      P[m + 2] = cz + inner * nz;
    }
  }

  // --- normals ---------------------------------------------------------------
  //
  // The shell is a pillow: two copies of the same rectangle of material glued
  // along their whole boundary. So a step off the edge of one sheet is a step
  // back onto the other at the mirrored index, and with that one rule central
  // differences work everywhere INCLUDING across the hem, where the surface is
  // turning fastest and where a one-sided difference would have flattened the
  // roll into the thing this is trying not to be.
  const at = (sheet, i, j) => {
    let sh = sheet;
    if (i < 0) { i = -i; sh ^= 1; } else if (i > NU) { i = 2 * NU - i; sh ^= 1; }
    if (j < 0) { j = -j; sh ^= 1; } else if (j > NV) { j = 2 * NV - j; sh ^= 1; }
    return (sh * rows * cols + i * cols + j) * 3;
  };

  const pos = new Float32Array(2 * rows * cols * 3);
  const nor = new Float32Array(2 * rows * cols * 3);
  for (let sh = 0; sh < 2; sh++) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const p0 = at(sh, i + 1, j);
        const p1 = at(sh, i - 1, j);
        const p2 = at(sh, i, j + 1);
        const p3 = at(sh, i, j - 1);
        const ux = P[p0] - P[p1];
        const uy = P[p0 + 1] - P[p1 + 1];
        const uz = P[p0 + 2] - P[p1 + 2];
        const vx = P[p2] - P[p3];
        const vy = P[p2 + 1] - P[p3 + 1];
        const vz = P[p2 + 2] - P[p3 + 2];
        // Sheet 1 is the same chart traversed the other way round, so its cross
        // product is taken in the opposite order and the seam's two rings come
        // out with identical normals rather than mirrored ones.
        let nx;
        let ny;
        let nz;
        if (sh === 0) {
          nx = vy * uz - vz * uy;
          ny = vz * ux - vx * uz;
          nz = vx * uy - vy * ux;
        } else {
          nx = uy * vz - uz * vy;
          ny = uz * vx - ux * vz;
          nz = ux * vy - uy * vx;
        }
        let len = Math.hypot(nx, ny, nz);
        const k = (i * cols + j) * 3;
        if (len < 1e-12) {
          // The four corners of the material, where both differences are the
          // vanishing thickness itself. Eight vertices on the whole piece, and
          // the stone's own outward direction is the right answer at all of
          // them.
          nx = dir[k];
          ny = dir[k + 1];
          nz = dir[k + 2];
          if (sh === 1) { nx = -nx; ny = -ny; nz = -nz; }
          len = 1;
        }
        const o = (sh * rows * cols + i * cols + j) * 3;
        pos[o] = P[o];
        pos[o + 1] = P[o + 1];
        pos[o + 2] = P[o + 2];
        nor[o] = nx / len;
        nor[o + 1] = ny / len;
        nor[o + 2] = nz / len;
      }
    }
  }

  const idx = [];
  for (let sh = 0; sh < 2; sh++) {
    const base = sh * rows * cols;
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const p00 = base + i * cols + j;
        const p01 = p00 + 1;
        const p10 = p00 + cols;
        const p11 = p10 + 1;
        if (sh === 0) idx.push(p00, p01, p11, p00, p11, p10);
        else idx.push(p00, p11, p01, p00, p10, p11);
      }
    }
  }

  return { pos, nor, idx, count: 2 * rows * cols };
}

// ---------------------------------------------------------------------------

registerStone('draped', {
  shape: SHAPE,
  // Square topped. Not a taste decision: the arch is what the pall replaces,
  // and at the slab's own edge radius the top of the stone is exactly a rounded
  // box, which is the surface the cloth is an offset of.
  topRadius: 0.062,
  bottomRadius: 0.10,

  // Three short lines low on the bare face. The drape takes the top third, so
  // there is about two thirds of a face to work in and the block sits below the
  // deepest the hem ever falls, corners included.
  draw(ctx, w, h) {
    const lines = ['IN', 'LOVING', 'MEMORY'];
    const size = h * 0.104;
    lines.forEach((line, i) => inkText(ctx, line, w / 2, h * (0.645 + (i - 1) * 0.145), size, size * 0.05));
  },

  extras({ body, material, shape, rng, plinthH, halfWidth, height, edge, disposables, stripUV }) {
    const { pos, nor, idx, count } = buildDrape({
      halfWidth,
      height,
      depth: shape.depth,
      edge,
      rng,
    });

    // Parked in the plain strip, like every other extra: swept across it by the
    // point's horizontal direction and climbing it with height, so the cloth
    // picks up the same slow mottle as the slab and never a letter. v is held
    // high in the strip because the bottom of that map is the ground grime and
    // this is the top of the stone.
    const uv = new Float32Array(count * 2);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < lo) lo = pos[i];
      if (pos[i] > hi) hi = pos[i];
    }
    const span = Math.max(1e-4, hi - lo);
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
      const x = pos[i];
      const z = pos[i + 2];
      const r = Math.hypot(x, z) || 1;
      const [u, v] = stripUV(x / r, 0.58 + 0.34 * ((pos[i + 1] - lo) / span), 1, 1);
      uv[j] = u;
      uv[j + 1] = v;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = plinthH;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    disposables.push(geo);
    body.add(mesh);
  },
});
