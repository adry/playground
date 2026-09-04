import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// The gothic arch: the tall narrow one of the set.
//
// The point is the whole identity, and buildSlabGeometry cannot make one: it
// sweeps a quarter-round profile around a four-circle outline, so its top is
// always a round arch or a squared-off pair of corners. So the slab is asked
// for the smallest top radius it allows and is treated as the body only, and
// the arch head is a second swept piece added in extras.
//
// It is built on exactly the same principle as the slab, generalised from four
// corner circles to an arbitrary convex core curve: every point of the
// silhouette is a core point pushed out by a fixed radius r0 along a known
// normal, so "inset by d" is "pushed out by r0 - d" and the normal is the same.
// Nothing is faceted, and the apex is a corner of the CORE, which means the
// silhouette there is a circular cap of radius r0: a soft vinyl peak rather
// than a spike, by construction rather than by tuning.
//
// The head overlaps the slab rather than butting onto it. Two rounded pieces
// meeting end to end leave a valley at the joint; overlapping, with the same
// depth, the same edge radius and the same face UVs, the two front faces are
// one coplanar surface carrying one continuous texture and the joint has
// nothing to show. The head is a hair wider (EPS) so the two side rims never
// coincide and fight; a millimetre and a half on a stone two thirds of a metre
// wide is a third of a pixel at scene scale.

// Both of these mirror numbers inside tombstones.js. EDGE is the slab's own
// rim radius: the head has to roll over by the same amount or the silhouette
// changes width where they meet. STRIP is the plain-stone column on the right
// of the texture that everything except the face samples from.
const EDGE = 0.062;
const STRIP = 160;

// Shape. The set runs 1.10 to 1.56 tall including the plinth and 0.74 to 1.00
// wide; this is 1.69 by 0.69, so it is the tallest and the narrowest thing in
// the graveyard, which is what a gothic arch is for. Width is held at 0.41 of
// the height rather than the set's 0.6: any wider and the arch reads as a
// round-top with a dent, any narrower and it is a plank.
//
// `height` is the SLAB, i.e. the carved face, and the arch head stands 0.52
// above it. The face is 0.69 by 1.00, which at the texture's 1024 rows is 707
// px wide: the same order as the approved stones (688, 770, 798) so the
// engraving treatment is used inside the range it was calibrated in.
const W = 0.345;
const H = 1.0;

// The head. SPRING is how far above the slab's top the flanks start turning
// in: the slab's own rounded top corners have to stay inside the full-width
// part of the head or they poke out of it as ears. DROP is how far the head
// reaches down behind the face, and only has to bury its own bottom rim.
// RATIO is the flank arc's radius over the core half width, and it is the one
// number that says how pointed the arch is: 1.0 is a plain half-round, 2.0 is
// a full equilateral lancet. 1.75 puts the tangent at the apex 65 degrees off
// vertical, which reads as a point without turning the stone into a spire.
const R0 = 0.075;
const EPS = 0.0015;
const SPRING = 0.02;
const DROP = 0.17;
const RATIO = 1.75;
// The head is above the face texture, so its front face samples the face map
// mirrored back down from the top edge, squashed by this factor. Continuous at
// the joint, and it never reaches the ink as long as the marks stay below
// v = 1 - VSQUASH * (peak - H) / H, which is 0.84 here.
const VSQUASH = 0.3;

// ---------------------------------------------------------------------------
// the arch head

// The convex core outline, counter-clockwise from the bottom right corner.
// Each sample is a core point and the outward normal there; a run of samples
// sharing a normal is a straight edge, and a run sharing a point is a rounded
// corner. The silhouette is these points pushed out by R0.
function archCore({ halfWidth, yBottom, ySpring }) {
  const wc = halfWidth - R0;
  const R = RATIO * wc;
  const end = Math.acos((R - wc) / R); // where the two flanks meet on the axis
  const yApex = ySpring + R * Math.sin(end);
  const yc = yBottom + R0;

  const ring = [];
  const at = (cx, cy, a) => ring.push({ cx, cy, nx: Math.cos(a), ny: Math.sin(a) });
  const arcSeg = Math.max(10, Math.round(SEGMENTS.curve * 0.9));
  const cornerSeg = 6;
  const apexSeg = 12;
  // The straight sides are subdivided rather than left as one long edge. The
  // face's v is piecewise: one slope over the slab, another over the head. A
  // triangle spanning the break interpolates across it, and short segments keep
  // that error down where the head's face lies over the slab's.
  const sideSeg = 6;

  for (let j = 0; j <= cornerSeg; j++) at(wc, yc, -Math.PI / 2 + (Math.PI / 2) * (j / cornerSeg));
  for (let j = 1; j <= sideSeg; j++) at(wc, yc + (ySpring - yc) * (j / sideSeg), 0);
  const cx = wc - R;
  for (let j = 1; j <= arcSeg; j++) {
    const a = end * (j / arcSeg);
    ring.push({ cx: cx + R * Math.cos(a), cy: ySpring + R * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  for (let j = 1; j <= apexSeg; j++) at(0, yApex, end + (Math.PI - 2 * end) * (j / apexSeg));
  for (let j = arcSeg - 1; j >= 0; j--) {
    const a = end * (j / arcSeg);
    ring.push({ cx: -(cx + R * Math.cos(a)), cy: ySpring + R * Math.sin(a), nx: -Math.cos(a), ny: Math.sin(a) });
  }
  for (let j = 1; j <= sideSeg; j++) at(-wc, ySpring + (yc - ySpring) * (j / sideSeg), Math.PI);
  for (let j = 1; j <= cornerSeg; j++) at(-wc, yc, Math.PI + (Math.PI / 2) * (j / cornerSeg));

  return { ring, yApex };
}

// Sweep the core outline front to back through the same quarter-round profile
// the slab uses, so the two pieces have the same rim and read as one moulding.
function buildArchGeometry({ ring, depth, uv, yMid }) {
  const hz = depth / 2;
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: EDGE * (1 - Math.sin(a)), z: hz - EDGE + EDGE * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  // Doubled silhouette ring, as in the slab: the front half carries the face
  // UVs, the sides must not, so the seam hides on the widest edge.
  profile.push({ inset: 0, z: hz - EDGE, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - EDGE), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: EDGE * (1 - Math.sin(a)), z: -(hz - EDGE + EDGE * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), front: false });
  }

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz, front) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    const [u, v] = uv(x, y, front);
    uvs.push(u, v);
  };

  const N = ring.length;
  for (const p of profile) {
    const r = R0 - p.inset;
    for (const s of ring) {
      push(s.cx + r * s.nx, s.cy + r * s.ny, p.z, s.nx * p.ns, s.ny * p.ns, p.nz, p.front);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j;
      const b = i * N + j2;
      const c = (i + 1) * N + j2;
      const d = (i + 1) * N + j;
      idx.push(a, c, b, a, d, c);
    }
  }

  const cFront = pos.length / 3;
  push(0, yMid, hz, 0, 0, 1, true);
  const cBack = pos.length / 3;
  push(0, yMid, -hz, 0, 0, -1, false);
  const last = (profile.length - 1) * N;
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    idx.push(cFront, j, j2);
    idx.push(cBack, last + j2, last + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// the mark

// A trefoil: three lobes grown off a central boss. Drawn as four filled discs
// rather than a traced outline, because the union of discs cannot produce a
// feature finer than the groove treatment can hold, and because the concave
// corner where a lobe meets the boss is a real notch -- the thing that stops
// three circles reading as a cloud.
//
// The boss is slightly smaller than a lobe and the lobes sit 1.2 lobe-radii
// out, which leaves each notch a fifth of a lobe wide at its throat and more
// than a lobe deep. `span` is the overall width; the figure is 0.93 of that
// tall and is centred on (cx, cy) by its own bounding box, not by the lobe
// circle, so it sits square on the face.
function inkTrefoil(ctx, cx, cy, span) {
  const r = span / 4.078;
  const d = r * 1.2;
  const oy = cy + 0.25 * d;
  const disc = (x, y, rad) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  disc(cx, oy, r * 0.95);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    disc(cx + d * Math.cos(a), oy + d * Math.sin(a), r);
  }
}

// ---------------------------------------------------------------------------

registerStone('gothic', {
  shape: { halfWidth: W, height: H, depth: 0.27, plinth: 0.17 },
  // Squared off: the arch head covers the top of the slab, and any rounding
  // left up there would be a shoulder poking out from under it.
  topRadius: EDGE,

  // One closed figure high on the face and one short line under it, on a lot
  // of clean stone. The date does the job R.I.P. does on the cross without
  // repeating it, and four digits hold together at the sixty-odd pixels the
  // mark gets at scene scale where a longer line would smear.
  draw(ctx, w, h) {
    inkTrefoil(ctx, w / 2, h * 0.315, w * 0.34);
    inkText(ctx, '1666', w / 2, h * 0.575, h * 0.11, h * 0.012);
  },

  extras({ body, material, shape, plinthH, halfWidth, height }) {
    const halfW = halfWidth + EPS;
    const { ring, yApex } = archCore({
      halfWidth: halfW,
      yBottom: height - DROP,
      ySpring: height + SPRING,
    });

    // The face map is the artwork on the left and a plain strip on the right;
    // the split is the one number the slab keeps to itself, so it is recovered
    // from the texture it handed over. Without a document there is no map and
    // the whole face collapses to u = 0, which is exactly what an offscreen
    // build wants.
    const img = material.map?.image;
    const texW = img ? img.width : 0;
    const frontFrac = texW ? (texW - STRIP) / texW : 1;
    const stripFrac = texW ? STRIP / texW : 0;

    // Below the slab's top this is the slab's own mapping, vertex for vertex,
    // so the head's face and the slab's face are one surface with one texture.
    // Above it the map is mirrored back down and squashed, which keeps the
    // stone continuous at the joint and puts nothing but mottle on the arch.
    const faceV = (y) => (y <= height ? y / height : 1 - (VSQUASH * (y - height)) / height);
    const uv = (x, y, front) =>
      front
        ? [((x + halfWidth) / (2 * halfWidth)) * frontFrac, faceV(y)]
        : [
            frontFrac + stripFrac * (0.15 + 0.7 * ((x + halfW) / (2 * halfW))),
            Math.min(1, Math.max(0, faceV(y))),
          ];

    const geo = buildArchGeometry({
      ring,
      depth: shape.depth,
      uv,
      yMid: (height - DROP + yApex + R0) / 2,
    });
    const head = new THREE.Mesh(geo, material);
    head.position.y = plinthH;
    head.castShadow = true;
    head.receiveShadow = true;
    body.add(head);
  },
});
