import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { registerStone, inkText } from '../tombstones.js';

// The celtic cross: a ringed cross on a tapering shaft, standing on a die.
//
// The identity is the RING, and a ring is only a ring if you can see the floor
// through it. So the head is not one blended field with a cross drawn on it,
// it is separate chunky solids that overlap: the tapering upright, a cross bar,
// a torus and a boss over the crossing. The four quadrant openings are simply
// where none of them are, which is the only way to guarantee daylight, because
// a smooth blended field cannot have a hole in it (which is what the pumpkin
// and the skull both found out the hard way).
//
// Why the registry's slab is the DIE and not the shaft. Two numbers fight on
// this stone. The engraving treatment wants a wide face, and it broke last time
// on a 233 px one. A celtic cross wants a narrow shaft, because the ring's
// inner wall has to clear the corner where the two bars meet: the openings only
// exist if the ring's inner radius beats the arm half thickness by root two and
// a margin, so every millimetre of shaft width costs about three of ring. Built
// as one wide slab the head came out half again as wide as its neighbours and
// the shaft was a stub. Built as a die with the shaft above it the two numbers
// stop fighting: the inscription sits on a face 1605 px across, and the shaft
// is free to be as slim as a shaft should be.
//
// Everything above the die is rounded box and torus, so no edge on the piece is
// sharper than a 0.048 fillet, and it is all built with the material handed in
// so the head cannot drift away from the set's grey.

// The die. Wide and low, and square-ish in plan so it reads as a block that the
// shaft is set into rather than as a slab. 0.54 by 0.32 puts the carved face at
// 1728 by 1024 px, the same country as column.js's die and well clear of the
// range where the groove treatment collapses.
const SHAPE = { halfWidth: 0.27, height: 0.32, depth: 0.33, plinth: 0.16 };
const DIE_TOP = SHAPE.plinth + SHAPE.height; // 0.48

// --- the cross -------------------------------------------------------------

const TOP = 1.62;         // the whole piece, near enough the ghost's own 1.6
const ARM = 0.14;         // half thickness of the cross bar, so 0.28 through
const ARM_L = 0.47;       // half span of the cross bar: 0.047 clear of the ring
const RING_R = 0.355;     // torus centreline radius
const RING_T = 0.068;     // tube radius, i.e. inner 0.287 and outer 0.423
// The top of the upright stands as far over the ring as the arms stand out
// past it, so the four ends of the cross match.
const YC = TOP - RING_R - RING_T - 0.085; // 1.112, the crossing and ring centre
const HEAD_HZ = 0.118;    // half depth of the head, matched to the shaft there
const FILLET = 0.048;     // the rounding on every bar edge

const SHAFT_BOTTOM = 0.36; // buried inside the die, so no joint shows
const HW_BOT = 0.170;      // half width where the shaft leaves the die
const HW_TOP = 0.133;      // half width at the top of the upright
const HZ_BOT = 0.132;      // and the same taper in depth
const HZ_TOP = 0.110;

// Clearances the openings depend on, measured rather than eyeballed. The shaft
// is 0.148 half wide where it passes the crossing and the bar is 0.14 half
// thick, so the rounded corner between them stands 0.183 from the centre; the
// ring's inner wall is at 0.287. Each opening is therefore 0.10 deep radially
// and subtends 31 degrees, about 0.155 along the arc. At the size a stone takes
// up in the scene that is a hole of order 35 by 25 px, which still reads as
// four holes and not as one dark disc.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Park a geometry's UVs in the texture's plain right-hand strip. Left alone, a
// box or a torus maps its own 0..1 across the whole atlas and drags the
// inscription around the outside of the cross head. u runs across the piece;
// for v the registry's helper is fed a height of 1 so the second argument IS
// the v wanted, which puts the whole head in the clean band between 0.72 and
// 0.98: above the grime the plinth sits in, and clear of the strip's edges so
// filtering can never reach the carved face.
function parkUVs(geo, stripUV, y0, y1) {
  const pos = geo.attributes.position.array;
  const uv = geo.attributes.uv.array;
  for (let i = 0, p = 0; i < uv.length; i += 2, p += 3) {
    const v = 0.72 + 0.26 * clamp01((pos[p + 1] - y0) / (y1 - y0));
    const st = stripUV(pos[p], v, ARM_L, 1);
    uv[i] = st[0];
    uv[i + 1] = st[1];
  }
  geo.attributes.uv.needsUpdate = true;
}

// A rounded box squeezed linearly as it climbs, which is the taper. The slope
// is 0.030 in x and 0.018 in z, about a degree and a half off vertical, and the
// normals are tilted by that much rather than recomputed: computeVertexNormals
// on a non-indexed box would replace the rounding's smooth normals with flat
// per-triangle ones and facet every edge on the piece.
function taperedShaft(y0, y1) {
  const h = y1 - y0;
  const geo = new RoundedBoxGeometry(HW_BOT * 2, h, HZ_BOT * 2, 5, FILLET);
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const kx = (HW_TOP / HW_BOT - 1);
  const kz = (HZ_TOP / HZ_BOT - 1);
  const slopeX = (HW_BOT - HW_TOP) / h;
  const slopeZ = (HZ_BOT - HZ_TOP) / h;
  for (let i = 0; i < pos.length; i += 3) {
    const t = clamp01(pos[i + 1] / h + 0.5);
    pos[i] *= 1 + kx * t;
    pos[i + 2] *= 1 + kz * t;
    const ny = nor[i + 1] + slopeX * Math.abs(nor[i]) + slopeZ * Math.abs(nor[i + 2]);
    const inv = 1 / Math.hypot(nor[i], ny, nor[i + 2]);
    nor[i] *= inv;
    nor[i + 1] = ny * inv;
    nor[i + 2] *= inv;
  }
  geo.translate(0, (y0 + y1) / 2, 0);
  return geo;
}

function buildCross({ body, material, disposables, stripUV }) {
  const add = (geo, y = 0, z = 0) => {
    geo.translate(0, y, z);
    parkUVs(geo, stripUV, SHAFT_BOTTOM, TOP);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    disposables.push(geo);
  };

  // The upright: one member from inside the die to over the top of the ring, so
  // shaft and cross are the same piece of stone and the joint is buried.
  add(taperedShaft(SHAFT_BOTTOM, TOP));

  // The cross bar. Its thickness is the width the tapering upright happens to
  // have at the crossing, so the four arms match.
  add(new RoundedBoxGeometry(ARM_L * 2, ARM * 2, HEAD_HZ * 2, 5, FILLET), YC);

  // The ring. A torus is round in section, which is exactly the edge this set
  // wants, but a circular tube 0.12 through would sit visibly shallower than
  // the 0.23 bars, so it is stretched in z to match them. The stretch goes
  // through applyMatrix4, so the normals come out right and it stays smooth.
  const ring = new THREE.TorusGeometry(RING_R, RING_T, 20, 80);
  ring.scale(1, 1, HEAD_HZ / RING_T);
  add(ring, YC);

  // A boss over the crossing, front and back. Celtic crosses carry one, and on
  // a toy it does the work a carved motif would without adding any ink: it puts
  // one soft highlight in the middle of the head so the crossing is not a flat
  // plate. Shallow, 0.03 proud of the face.
  for (const side of [1, -1]) {
    const boss = new THREE.SphereGeometry(0.095, 32, 20);
    boss.scale(1, 1, 0.40);
    add(boss, YC, side * (HEAD_HZ - 0.012));
  }
}

// ---------------------------------------------------------------------------

registerStone('celtic', {
  shape: SHAPE,
  // Square the die off. Left alone the registry gives every slab a half-round
  // arch, which on a die this wide would be a dome with a cross growing out of
  // it rather than a block the shaft is set into.
  topRadius: 0.06,
  draw(ctx, w, h) {
    // One short line, low and centred on the die. The postmortem is blunt that
    // a complex silhouette gets no second thing competing with it, and a ringed
    // cross is the most complex silhouette in the set, so the die carries a
    // date and nothing else: a monument's year cut into its base. No cross in
    // the mark, there is already one standing over it.
    inkText(ctx, '1893', w / 2, h * 0.52, h * 0.36, h * 0.02);
  },
  extras: buildCross,
});
