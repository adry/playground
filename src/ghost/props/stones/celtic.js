import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { registerStone, inkText } from '../tombstones.js';

// The celtic cross: a ringed cross head on a short arched shaft.
//
// The identity is the RING, and a ring is only a ring if you can see the floor
// through it. So the head is not one blended field with a cross drawn on it,
// it is four separate chunky solids that overlap: a vertical bar, a cross bar
// and a torus, plus a boss over the crossing. The four quadrant openings are
// simply where none of them are, which is the only way to guarantee daylight
// (the pumpkin and the skull both learned that a smooth blended field cannot
// have a hole in it).
//
// The proportions are set by one rule and everything else follows: the ring's
// INNER circle has to clear the top of the slab, or the lower two openings get
// filled in by the shaft's shoulders and the piece reads as a disc with a
// cross on it. That pushes the crossing up and the slab down, which is why the
// shaft here is short: 0.60 of stone over a 0.175 plinth, with the head
// carrying the top half of the silhouette.
//
// Everything above the slab is built from tori and rounded boxes, so no edge
// on the piece is sharper than a 0.055 fillet. Same material as the slab, so
// the head cannot drift away from the set's grey.

// Face is 0.38 by 0.72, which the atlas renders at 541 by 1024 px: right in
// the band the approved stones sit in (their faces are 688 to 798 wide), so
// the engraving treatment stays inside the range it was calibrated for. A tall
// narrow shaft would have taken the face down to the 233 px that sank the last
// attempt at this stone.
const SHAPE = { halfWidth: 0.19, height: 0.72, depth: 0.25, plinth: 0.17 };

const SLAB_TOP = SHAPE.plinth + SHAPE.height; // 0.89, the crown of the arch

// --- the head --------------------------------------------------------------

const ARM = 0.13;         // half thickness of both bars, so they are 0.26 wide
const RING_R = 0.335;     // torus centreline radius
const RING_T = 0.062;     // tube radius, i.e. inner 0.273 and outer 0.397
const ARM_L = 0.44;       // half span of the cross bar, 0.043 clear of the ring
const HEAD_HZ = 0.1075;   // head half depth, a hair shallower than the shaft
const FILLET = 0.05;      // the rounding on every bar edge
const YC = 1.155;         // the crossing, and the centre of the ring
const BAR_TOP = 1.61;     // 0.06 of bar showing above the ring, total height
const BAR_BOTTOM = 0.72;  // buried well inside the slab, no visible joint

// Clearances this depends on, measured rather than eyeballed:
//   the corner of the two bars sits 0.163 from the crossing once its fillet is
//   taken off, and the ring's inner wall is at 0.273, so each opening is about
//   0.11 deep radially and subtends 33 degrees, roughly 0.16 along the arc.
//
//   the ring's inner wall passes y = 0.915 where the vertical bar leaves it,
//   and the slab's arch is at 0.839 there, so all four openings are bounded by
//   the ring and none of them by the shaft's shoulders.

// The face texture is a face-shaped region on the left of the canvas plus a
// narrow strip of plain stone on the right, which everything that is not the
// front face samples. buildTextures owns those numbers and does not hand them
// to extras(), so they are recomputed here. If the registry ever passes its UV
// helpers through, delete this. (column.js carries the same copy.)
function stripBand(shape) {
  const FH = 1024;
  const STRIP = 160;
  const FW = Math.round(FH * ((2 * shape.halfWidth) / shape.height));
  const w = FW + STRIP;
  return { front: FW / w, strip: STRIP / w };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Park a geometry's UVs in the plain strip. Left alone, a box or a torus maps
// its own 0..1 across the whole atlas and drags the inscription over the cross
// head. u runs across the piece and v climbs it, both inside the clean middle
// of the strip: away from its edges so filtering cannot reach the carved face,
// and above the grime band the plinth sits in.
function parkUVs(geo, band, x0, x1, y0, y1) {
  const pos = geo.attributes.position.array;
  const uv = geo.attributes.uv.array;
  for (let i = 0, p = 0; i < uv.length; i += 2, p += 3) {
    uv[i] = band.front + band.strip * (0.15 + 0.7 * clamp01((pos[p] - x0) / (x1 - x0)));
    uv[i + 1] = 0.72 + 0.26 * clamp01((pos[p + 1] - y0) / (y1 - y0));
  }
  geo.attributes.uv.needsUpdate = true;
}

function buildHead({ body, material, shape }) {
  const band = stripBand(shape);
  const geos = [];

  const add = (geo, y = 0, z = 0) => {
    geo.translate(0, y, z);
    parkUVs(geo, band, -ARM_L, ARM_L, BAR_BOTTOM, BAR_TOP);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    geos.push(geo);
    return mesh;
  };

  // The upright. It runs from inside the slab to just over the top of the
  // ring, so the shaft and the cross are one continuous member and the only
  // place the two meet is under the arch, where nothing shows.
  const upH = BAR_TOP - BAR_BOTTOM;
  add(new RoundedBoxGeometry(ARM * 2, upH, HEAD_HZ * 2, 5, FILLET), (BAR_TOP + BAR_BOTTOM) / 2);

  // The cross bar.
  add(new RoundedBoxGeometry(ARM_L * 2, ARM * 2, HEAD_HZ * 2, 5, FILLET), YC);

  // The ring. A torus is round in section, which is exactly the vinyl edge
  // this set wants, but a circular tube 0.136 through would sit visibly
  // shallower than the 0.225 bars, so it is stretched in z to match them. The
  // stretch goes through applyMatrix4, so the normals come out right and the
  // surface stays smooth.
  const ring = new THREE.TorusGeometry(RING_R, RING_T, 20, 80);
  ring.scale(1, 1, HEAD_HZ / RING_T);
  add(ring, YC);

  // A boss over the crossing, front and back. Celtic crosses carry one, and on
  // a toy it does the job a carved motif would do without adding a mark: it
  // gives the middle of the head one soft highlight so the crossing is not a
  // flat plate. Kept shallow, 0.03 proud of the face.
  for (const side of [1, -1]) {
    const boss = new THREE.SphereGeometry(0.092, 32, 20);
    boss.scale(1, 1, 0.42);
    add(boss, YC, side * (HEAD_HZ - 0.012));
  }

  // createTombstone's dispose() knows about the slab, the plinth, the material
  // and the textures, and nothing about whatever extras() built. The material
  // is an event dispatcher and its dispose() fires, so that is the one hook
  // available from in here without touching the registry.
  material.addEventListener('dispose', () => geos.forEach((g) => g.dispose()));
}

// ---------------------------------------------------------------------------

registerStone('celtic', {
  shape: SHAPE,
  // Full half-round arch, the registry's default, which is what the rest of
  // the set has. The upright grows out of the crown of it and the arch falls
  // away either side as the shoulders of the shaft, which is the only taper
  // available from a swept slab and reads as one on this short a shaft.
  topRadius: SHAPE.halfWidth,
  draw(ctx, w, h) {
    // One line, and a small one. The postmortem is blunt that a complex
    // silhouette gets no second thing competing with it, and a ringed cross is
    // about as complex as this set gets, so the shaft carries the family's
    // lettering at the family's ink share and nothing else. No cross in the
    // mark: there is already one standing over it.
    inkText(ctx, 'R.I.P.', w / 2, h * 0.40, h * 0.145, h * 0.012);
    inkText(ctx, '1893', w / 2, h * 0.58, h * 0.125, h * 0.012);
  },
  extras: buildHead,
});
