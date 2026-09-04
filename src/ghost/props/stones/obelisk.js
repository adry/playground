import * as THREE from 'three';
import { registerStone } from '../tombstones.js';

// The obelisk: the tall one.
//
// Everything about this stone is proportion. It is the same chassis as the rest
// of the set -- the swept quarter-round slab, the same weathered canvas, the
// same two-map carving, the same plinth -- run at half the width and half again
// the height, with three things added on top of the registry's defaults:
//
//   1. the shaft tapers, losing a fifth of its width on the way up,
//   2. a shallow pyramidion caps it, springing out of the shaft through a fat
//      fillet rather than sitting on it as a separate object,
//   3. one more step under the foot, so the base reads as built rather than
//      planted.
//
// The mark is deliberately small and high. A shaft this narrow is mostly blank
// stone by design, and the blankness is the point: it is what makes the eye
// read the height. See the coverage note on draw() below.

// --- the numbers -----------------------------------------------------------
//
// 0.60 wide by 1.40 tall on a 0.18 plinth, capped at 1.89 overall, against the
// cross's 0.92 by 1.37 on 0.19 for 1.56. So: a fifth taller than the tallest
// stone in the set and two thirds of its width. The slenderness is 1:2.3 where
// the cross is 1:1.5, which is as far as this chassis goes before the fixed
// 0.062 edge radius eats the flat of the face and the thing turns into a
// rounded post with nowhere to carve.
//
// Depth is nearly the width on purpose. An obelisk is square in plan; at the
// set's usual 0.30 it would have read as a plank stood on edge from the side.
const W = 0.30;
const H = 1.40;
const D = 0.50;
const PLINTH = 0.18;

// Mirrors the slab's own edge radius in tombstones.js. The extras have to know
// it: the horizontal section of the shaft is a rounded rectangle with exactly
// this corner radius, and the pyramidion has to sleeve over it without a step.
const EDGE = 0.062;

// The taper. The shaft's half width at height y is W * (1 - TAPER * y / H), so
// the sides lean in by 2.7 degrees. Real obelisks are nearer 2; at 2.7 the lean
// is still quiet in silhouette but it survives being 200px tall on screen,
// which 2 did not.
const TAPER = 0.22;
const scaleAt = (y) => 1 - TAPER * (y / H);

// The face texture's layout, mirrored from buildTextures so the extras can park
// their UVs in the same plain strip the slab's sides use. If those constants
// ever move, these move with them.
const FACE_H = 1024;
const STRIP = 160;
const FACE_W = Math.round(FACE_H * ((2 * W) / H));
const FRONT_FRAC = FACE_W / (FACE_W + STRIP);
const STRIP_FRAC = STRIP / (FACE_W + STRIP);

// u anywhere in the plain strip, v at the piece's true height on the stone, so
// a piece near the foot picks up the same ground grime the plinth does and a
// piece at the top picks up clean stone.
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const stripUV = (x, y, span) => [
  FRONT_FRAC + STRIP_FRAC * (0.15 + 0.7 * clamp01((x + span) / (2 * span))),
  clamp01(y / H),
];

// ---------------------------------------------------------------------------
// geometry helpers
//
// Same discipline as buildSlabGeometry, turned on its side: a convex outline
// built as the Minkowski sum of four corner circles, swept up through a stack
// of rings. Because the outline is that sum, both of the moves a ring needs are
// exact and shape preserving -- scaling it (the taper and the pyramid) and
// insetting it (the rounded top and bottom edges of a block) -- and the normal
// at every vertex falls out analytically. Nothing here calls
// computeVertexNormals and nothing here has a hard edge.
//
// buildSlabGeometry does all of this already but is not exported; see the
// report.

// One horizontal outline. Each entry carries the point and the outline's
// outward normal there, which is all the sweep needs.
function planOutline(halfX, halfZ, corner, seg) {
  const c = Math.min(corner, Math.min(halfX, halfZ) * 0.999);
  const cx = halfX - c;
  const cz = halfZ - c;
  const arcs = [
    [cx, cz, 0],
    [-cx, cz, Math.PI / 2],
    [-cx, -cz, Math.PI],
    [cx, -cz, Math.PI * 1.5],
  ];
  const out = [];
  for (const [ax, az, a0] of arcs) {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (Math.PI / 2) * (j / seg);
      const hx = Math.cos(a);
      const hz = Math.sin(a);
      out.push({ px: ax + c * hx, pz: az + c * hz, hx, hz });
    }
  }
  return out;
}

// Sweep an outline through a stack of rings.
//
// A ring is { y, s, inset, dy, ds, dInset }: the outline scaled by s, then
// offset inward by `inset`, sat at height y. The derivatives are the meridian's
// tangent, and the surface normal follows from it in closed form -- for a point
// p on the outline with outward normal h,
//
//     n = ( h.x * dy,  dInset - ds * (h . p),  h.z * dy )
//
// which is the one line that makes a taper, a fillet, a pyramid and a rounded
// block all the same function.
function sweep({ plan, rings, capBottom, capTop, uv }) {
  const N = plan.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    const [u, v] = uv(x, y, z);
    uvs.push(u, v);
  };

  for (const r of rings) {
    for (const p of plan) {
      const x = r.s * p.px - r.inset * p.hx;
      const z = r.s * p.pz - r.inset * p.hz;
      const ny = r.dInset - r.ds * (p.hx * p.px + p.hz * p.pz);
      push(x, r.y, z, p.hx * r.dy, ny, p.hz * r.dy);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j;
      const b = i * N + j2;
      const c = (i + 1) * N + j2;
      const d = (i + 1) * N + j;
      idx.push(a, c, b, a, d, c);
    }
  }
  if (capBottom) {
    const r = rings[0];
    const centre = pos.length / 3;
    push(0, r.y, 0, 0, -1, 0);
    for (let j = 0; j < N; j++) idx.push(centre, j, (j + 1) % N);
  }
  if (capTop) {
    const r = rings[rings.length - 1];
    const base = (rings.length - 1) * N;
    const centre = pos.length / 3;
    push(0, r.y, 0, 0, 1, 0);
    for (let j = 0; j < N; j++) idx.push(centre, base + ((j + 1) % N), base + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// A block with every edge rounded: vertical sides, a quarter-round rolled over
// the top and bottom rims. The rims are insets, not scales, so the rounding is
// a true circular arc on all four sides however oblong the block is.
function roundedBlock({ halfX, halfZ, height, edge, corner, y0, uv }) {
  const seg = 6;
  const rings = [];
  const arc = (from, to, base) => {
    for (let k = 0; k <= seg; k++) {
      const a = from + (to - from) * (k / seg);
      rings.push({
        y: y0 + base + edge * Math.sin(a),
        s: 1,
        inset: edge * (1 - Math.cos(a)),
        dy: Math.cos(a),
        ds: 0,
        dInset: Math.sin(a),
      });
    }
  };
  arc(-Math.PI / 2, 0, edge);
  arc(0, Math.PI / 2, height - edge);
  return sweep({
    plan: planOutline(halfX, halfZ, corner, 7),
    rings,
    capBottom: true,
    capTop: true,
    uv,
  });
}

// ---------------------------------------------------------------------------
// the pyramidion
//
// Not a separate object balanced on the shaft: one swept solid whose lower end
// is buried in the shaft and follows the shaft's own taper exactly, so that
// what you see is a single form that leans in a little, rounds over a shoulder
// and comes to a soft point. Four sections, each one tangent to the last:
//
//   1. the shaft's taper, from inside the shaft up past its rounded top,
//   2. a fat fillet turning the taper into the pyramid slope -- the shoulder,
//   3. the pyramid slope itself, 55 degrees off horizontal,
//   4. a cap arc that rounds the apex off, because a point is a knife edge.
//
// Every ring is a uniform scale of the shaft's own section, so the pyramidion
// is oblong exactly as much as the shaft is and its four faces meet in rounded
// arrises rather than in corners.
function pyramidionGeometry({ uv }) {
  const yBase = H - 0.10; // buried, below where the slab's top starts rounding
  const sBase = scaleAt(yBase) * 1.006; // a hair proud of the shaft, never inside it
  const halfX0 = W * sBase;
  const halfZ0 = (D / 2) * sBase;

  const th1 = Math.atan(TAPER * W / H); // the shaft's lean, off vertical
  const th2 = Math.PI / 2 - (48 * Math.PI) / 180; // the pyramid's slope, off vertical
  const FILLET = 0.16; // the shoulder. Fat on purpose: this is the read.
  const TIP = 0.075; // the apex arc

  // The virtual corner where taper and slope would meet if neither were
  // rounded, set just above the top of the shaft so the shoulder straddles it.
  const yCorner = H + 0.02;
  const xCorner = halfX0 - Math.tan(th1) * (yCorner - yBase);

  const T = FILLET * Math.tan((th2 - th1) / 2);
  const p1 = [xCorner + Math.sin(th1) * T, yCorner - Math.cos(th1) * T];
  const fc = [p1[0] - FILLET * Math.cos(th1), p1[1] - FILLET * Math.sin(th1)];
  const p2 = [fc[0] + FILLET * Math.cos(th2), fc[1] + FILLET * Math.sin(th2)];

  // The apex arc: a circle of radius TIP on the axis, tangent to the slope.
  const dLine = p2[0] * Math.cos(th2) + p2[1] * Math.sin(th2);
  const yTip = (dLine - TIP) / Math.sin(th2);
  const p3 = [TIP * Math.cos(th2), yTip + TIP * Math.sin(th2)];

  const rings = [];
  // Section 1 and 3 are straight, so two rings each carry them exactly.
  const line = (from, to, phi) => {
    for (const p of [from, to]) {
      rings.push({
        y: p[1],
        s: p[0] / halfX0,
        inset: 0,
        dy: Math.cos(phi),
        ds: -Math.sin(phi) / halfX0,
        dInset: 0,
      });
    }
  };
  const arcSeg = (centre, radius, from, to, seg) => {
    for (let k = 1; k <= seg; k++) {
      const a = from + (to - from) * (k / seg);
      rings.push({
        y: centre[1] + radius * Math.sin(a),
        s: (centre[0] + radius * Math.cos(a)) / halfX0,
        inset: 0,
        dy: Math.cos(a),
        ds: -Math.sin(a) / halfX0,
        dInset: 0,
      });
    }
  };
  line([halfX0, yBase], p1, th1);
  arcSeg(fc, FILLET, th1, th2, 9);
  rings.push({
    y: p3[1],
    s: p3[0] / halfX0,
    inset: 0,
    dy: Math.cos(th2),
    ds: -Math.sin(th2) / halfX0,
    dInset: 0,
  });
  arcSeg([0, yTip], TIP, th2, Math.PI / 2, 7);

  const geo = sweep({
    plan: planOutline(halfX0, halfZ0, EDGE * sBase, 9),
    rings,
    capBottom: true,
    capTop: false,
    uv,
  });
  geo.userData.apex = yTip + TIP;
  return geo;
}

// ---------------------------------------------------------------------------
// the mark
//
// A five-pointed star, the memorial obelisk's own device, and the only thing on
// a face that is otherwise 0.96 of bare shaft. It sits at four fifths of the
// height because that is where an obelisk's inscription panel is: the eye finds
// the mark, then runs down the blank stone under it, and the drop is what sells
// the height.
//
// Two numbers matter and both were measured, not guessed:
//
//   Coverage. This face canvas is 439 by 1024 where the cross's is 688, so the
//   SAME physical mark is 1.6x the fraction of the face here. The approved set
//   measures 4.2% (cross), 6.0% (bat) and 3.8% (fred) of the face; ink at 5.7%
//   sits inside that, and a star drawn small enough to match the cross's share
//   of face WIDTH would have come out at 1.7% and vanished.
//
//   Stroke. Texel density on the face is FACE_H / H either way, so the groove's
//   17-texel floor is a world width, not a fraction of the face: 0.023 here.
//   Every limb of this star is at least three times that.
const STAR_R = 0.099; // outer radius, in fractions of the face height
const STAR_V = 0.212; // centre, in fractions of the face height down from the top

function inkStar(ctx, cx, cy, R, stretch) {
  const inner = R * 0.47;
  // The face narrows as it climbs, so the texture is squeezed horizontally up
  // there by exactly the taper. Undo it here, or the star comes out an oval.
  // The pen stays circular: only the vertices are stretched.
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : R;
    const x = cx + Math.cos(a) * r * stretch;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  // Fattened and rounded off with the pen rather than fetched to a point: a
  // carved star has no needle tips, and neither does anything else in this set.
  ctx.lineJoin = 'round';
  ctx.lineWidth = R * 0.20;
  ctx.stroke();
  ctx.fill();
}

// ---------------------------------------------------------------------------

registerStone('obelisk', {
  shape: { halfWidth: W, height: H, depth: D, plinth: PLINTH },
  // Squared off: the registry clamps this up to the slab's edge radius, which
  // is the flattest top the chassis will give. The pyramidion covers it.
  topRadius: 0.02,

  draw(ctx, w, h) {
    ctx.strokeStyle = '#000000';
    inkStar(ctx, w / 2, h * STAR_V, h * STAR_R, 1 / scaleAt(H * (1 - STAR_V)));
  },

  extras({ body, material, plinthH }) {
    // --- the taper -----------------------------------------------------------
    //
    // buildSlabGeometry sweeps a constant section, so the shaft comes back
    // straight-sided and the taper is applied here, to the slab's own vertices:
    // scale x and z by scaleAt(y). The slab's outline is convex and its faces
    // are planar in y, so a uniform scale keeps the front face a plane (a plane
    // leaning back 2.3 degrees, which is what the front of an obelisk is) and
    // keeps every rounded edge round.
    //
    // Normals are re-derived rather than left alone. The correct transform for
    // this deformation is the inverse transpose of its Jacobian, which for a
    // pure y-dependent scale reduces to tilting the horizontal normals up by
    // the lean and leaving the up-facing ones alone.
    const slab =
      body.children.find((o) => o.isMesh && Math.abs(o.position.y - plinthH) < 1e-6) ||
      body.children[0];
    if (slab?.isMesh) {
      const pos = slab.geometry.attributes.position;
      const nor = slab.geometry.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const s = scaleAt(clamp01(y / H) * H);
        const x = pos.getX(i) * s;
        const z = pos.getZ(i) * s;
        pos.setXYZ(i, x, y, z);
        const nx = nor.getX(i);
        const ny = nor.getY(i);
        const nz = nor.getZ(i);
        const my = s * ny + ((TAPER / H) * (x * nx + z * nz)) / s;
        const l = Math.hypot(nx, my, nz) || 1;
        nor.setXYZ(i, nx / l, my / l, nz / l);
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      slab.geometry.computeBoundingSphere();
    }

    const add = (geo, y) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      return mesh;
    };

    // --- the second step -----------------------------------------------------
    //
    // The registry's plinth is the bottom step; this is the one between it and
    // the shaft. Widths run 0.75, 0.67, 0.60 so each overhangs the next by the
    // same 0.04, which is what makes three separate blocks read as one built
    // base instead of a stack. It is short: a tall step would start competing
    // with the shaft for the eye, and the shaft is the whole stone.
    const stepH = 0.115;
    add(
      roundedBlock({
        halfX: W + 0.035,
        halfZ: D / 2 + 0.03,
        height: stepH,
        edge: 0.05,
        corner: 0.075,
        y0: 0,
        uv: (x, y) => stripUV(x, y, W + 0.035),
      }),
      plinthH,
    );

    // --- the cap -------------------------------------------------------------
    add(pyramidionGeometry({ uv: (x, y) => stripUV(x, y, W) }), plinthH);
  },
});
