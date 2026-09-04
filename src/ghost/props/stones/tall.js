import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial } from '../style.js';

// The three tall pieces of the second graveyard set: a ringed celtic cross, a
// gothic ogee-arch headstone carrying a tree of life, and an obelisk with a
// radiant sun, an open book and a scroll.
//
// Everything here is the same soft vinyl toy as ../tombstones.js, and the two
// hard parts are solved the same way, deliberately:
//
//   * Silhouettes are swept outlines. An outline is a closed list of tangent
//     arcs; straight runs fall out between them for free. Because the whole
//     outline is built from arcs whose centres never move, "inset by d" is only
//     "convex radii minus d, concave radii plus d", every ring of the sweep is
//     an exact offset of the last, and the normal at every vertex is known
//     analytically. No computeVertexNormals, no faceting, no seams.
//   * Engraving is a colour map plus a normal map baked from a height canvas.
//     Copied wholesale from tombstones.js, including the numbers: a wide weak
//     occlusion smudge, a body dark enough to read as shade and no darker, a
//     shaded wall under the mark's top edge and a lit lip along its bottom one.
//     That combination is what survives being filtered down to the hundred-odd
//     pixels a stone actually occupies, and it was approved as-is. Do not
//     simplify it back to "blur the mask and darken it".
//
// The one thing added here that tombstones.js has no need for is a second,
// shallower mask: the gothic arch's recessed panel. It rides the same pipeline
// at lower amplitude, so the panel floor sits between the face and the tree.

export const TALL_VARIANTS = ['celtic', 'arch', 'obelisk'];

// ---------------------------------------------------------------------------
// deterministic noise

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// outlines
//
// An arc is { cx, cy, r, a0, a1 }. a1 > a0 means it is traversed
// counter-clockwise, which for a counter-clockwise loop is a convex corner; a1
// < a0 is a concave one. That sign is the only thing insetting needs to know.

const TAU = Math.PI * 2;

// Round every corner of a closed polygon. Radii may be a single number or one
// per vertex. Concave corners are handled by the same code: the turn's sign
// picks which side the fillet centre goes.
function roundPolygon(points, radii) {
  const n = points.length;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const r = Array.isArray(radii) ? radii[i] : radii;

    const inx = p[0] - prev[0];
    const iny = p[1] - prev[1];
    const il = Math.hypot(inx, iny);
    const ux = inx / il;
    const uy = iny / il;
    const onx = next[0] - p[0];
    const ony = next[1] - p[1];
    const ol = Math.hypot(onx, ony);
    const vx = onx / ol;
    const vy = ony / ol;

    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    const delta = Math.atan2(cross, dot); // signed turn
    if (Math.abs(delta) < 1e-6) continue; // collinear: no corner to round
    const sign = Math.sign(delta);
    const t = r * Math.tan(Math.abs(delta) / 2);
    const t1x = p[0] - t * ux;
    const t1y = p[1] - t * uy;
    // Fillet centre sits off the incoming edge, on the inside of the turn.
    const nx = -uy * sign;
    const ny = ux * sign;
    const cx = t1x + r * nx;
    const cy = t1y + r * ny;
    const a0 = Math.atan2(t1y - cy, t1x - cx);
    arcs.push({ cx, cy, r, a0, a1: a0 + delta });
  }
  return arcs;
}

// Sample one loop of arcs, offset inward by `inset`, into a ring of positions
// and 2D outward normals. Straight runs between arcs need no samples of their
// own: consecutive arc endpoints are tangent to the same line, so the quad
// strip between them is that line.
function sampleLoop(arcs, inset, density) {
  const out = [];
  for (const a of arcs) {
    const sweep = a.a1 - a.a0;
    const sign = Math.sign(sweep);
    const r = a.r - inset * sign;
    const seg = Math.max(2, Math.round(density * Math.abs(sweep) / (Math.PI / 2)));
    for (let j = 0; j <= seg; j++) {
      const t = a.a0 + sweep * (j / seg);
      const c = Math.cos(t);
      const s = Math.sin(t);
      out.push({ x: a.cx + r * c, y: a.cy + r * s, nx: c * sign, ny: s * sign });
    }
  }
  return out;
}

// Bounding box of a loop at inset 0, for planar UV mapping.
function loopBounds(loops) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of sampleLoop(loop, 0, 6)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// a flat slab with a rounded rim, from one or more arc loops
//
// `loops[0]` is the outer boundary, counter-clockwise; any further loops are
// holes, wound clockwise. The rim is a quarter-round of radius `edge` swept
// front to back, so face, rim and the joint between them are one continuous
// surface. Same construction as tombstones.js, generalised to non-convex
// outlines and holes -- which is what a ringed cross needs and a plain
// headstone does not.
function buildOutlineSlab({ loops, depth, edge: e, uv, density = SEGMENTS.curve }) {
  const hz = depth / 2;
  const rings = loops.map((loop) => sampleLoop(loop, 0, density).length);
  const N = rings.reduce((a, b) => a + b, 0);

  // (inset, z) profile: quarter circle out to the silhouette, a straight side
  // wall, then its mirror round the back. Half the curve budget across the
  // 90-degree turn -- a quarter of it banded visibly on the side highlight.
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: hz - e + e * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  // The silhouette ring is duplicated so the texture seam lands on the widest
  // edge: the front copy carries face UVs, the back copy does not.
  profile.push({ inset: 0, z: hz - e, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - e), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: -(hz - e + e * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), front: false });
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

  const capPoints = [];
  for (const p of profile) {
    for (let li = 0; li < loops.length; li++) {
      const ring = sampleLoop(loops[li], p.inset, density);
      for (const s of ring) {
        push(s.x, s.y, p.z, s.nx * p.ns, s.ny * p.ns, p.nz, p.front);
        if (p === profile[0]) capPoints.push(new THREE.Vector2(s.x, s.y));
      }
    }
  }

  for (let i = 0; i < profile.length - 1; i++) {
    let base = 0;
    for (const count of rings) {
      for (let j = 0; j < count; j++) {
        const j2 = (j + 1) % count;
        const a = i * N + base + j;
        const b = i * N + base + j2;
        const c = (i + 1) * N + base + j2;
        const d = (i + 1) * N + base + j;
        idx.push(a, c, b, a, d, c);
      }
      base += count;
    }
  }

  // Caps. The first profile ring is already the front face's boundary (inset
  // e, z = hz, normal +Z) and the last is the back's, so the caps are a
  // triangulation of those rings rather than new geometry. Ear clipping rather
  // than a centre fan, because a plus-shaped cross is not convex.
  const contour = capPoints.slice(0, rings[0]);
  const holes = [];
  let off = rings[0];
  for (let li = 1; li < loops.length; li++) {
    holes.push(capPoints.slice(off, off + rings[li]));
    off += rings[li];
  }
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const last = (profile.length - 1) * N;
  for (const f of faces) {
    idx.push(f[0], f[1], f[2]);
    idx.push(last + f[2], last + f[1], last + f[0]);
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
// a tapering column with a rounded-square section
//
// The obelisk. Its silhouette in (halfWidth, height) is a filleted polyline and
// its cross-section is a rounded square scaled by that half-width, so corner
// radius tapers with the shaft and the apex closes to a point on its own.
//
// The section is generated as four separate spans -- front, left, back, right,
// split at the diagonals -- with the boundary vertices duplicated. That
// duplication is the only way a face can own a slice of the texture without its
// neighbour's UVs being dragged round the corner.

// Unit rounded square in (x, z), +Z front, walked counter-clockwise from the
// front-right diagonal. `q` is the corner radius as a fraction of the half-size.
// kappa is the section's support term; it is what keeps the swept normal exact
// where the corner radius, and therefore the local curvature, is not a circle's.
function roundedSquareSection(q, perSpan) {
  const spans = [];
  const c = 1 - q;
  // Corner centres, in walk order starting front-right.
  const corners = [
    [c, c],   // front-right
    [-c, c],  // front-left
    [-c, -c], // back-left
    [c, -c],  // back-right
  ];
  for (let f = 0; f < 4; f++) {
    // Each span is the second half of one corner arc, the straight edge, then
    // the first half of the next.
    const a0 = Math.PI / 4 + f * (Math.PI / 2);
    const pts = [];
    const emit = (x, z, nx, nz) => {
      // Support function of the rounded square: distance from the section's
      // centre to the tangent line at this point. On a straight edge it is 1.
      const k = c * (Math.abs(nx) + Math.abs(nz)) + q;
      pts.push({ x, z, nx, nz, k });
    };
    const arc = (ci, from, to, n) => {
      const [ox, oz] = corners[ci];
      for (let j = 0; j <= n; j++) {
        const a = from + (to - from) * (j / n);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        emit(ox + q * ca, oz + q * sa, ca, sa);
      }
    };
    const half = Math.max(2, Math.round(perSpan * 0.34));
    arc(f, a0, a0 + Math.PI / 4, half);
    arc((f + 1) % 4, a0 + Math.PI / 4, a0 + Math.PI / 2, half);
    spans.push(pts);
  }
  return spans;
}

// The obelisk's silhouette in (halfWidth, height): up the tapering shaft, a
// filleted shoulder, the pyramidal cap, and a rounded nose on top. Returned as
// samples of (s, y) with the outward 2D normal, walking from the bottom of the
// axis to the apex with the solid on the left.
function obeliskSilhouette({ s0, s1, shoulder, apex, footFillet, shoulderFillet, noseRadius }, density) {
  const out = [];
  const push = (s, y, ns, ny) => {
    const l = Math.hypot(ns, ny);
    out.push({ s, y, ns: ns / l, ny: ny / l });
  };
  const arc = (cx, cy, r, a0, a1, n) => {
    for (let j = 0; j <= n; j++) {
      const a = a0 + (a1 - a0) * (j / n);
      push(cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a));
    }
  };

  // Bottom face, out from the axis. Sits on the base block, so it is never
  // seen; it exists so the solid is closed.
  push(0, 0, 0, -1);
  push(s0 - footFillet, 0, 0, -1);
  // Foot round, from straight-down to the shaft's own slight lean.
  const shaftDx = s1 - s0;
  const shaftDy = shoulder;
  const shaftL = Math.hypot(shaftDx, shaftDy);
  const sux = shaftDx / shaftL;
  const suy = shaftDy / shaftL;
  const shaftN = [suy, -sux]; // outward: right of travel
  const aFoot0 = -Math.PI / 2;
  const aFoot1 = Math.atan2(shaftN[1], shaftN[0]);
  arc(s0 - footFillet, footFillet, footFillet, aFoot0, aFoot1, Math.max(2, Math.round(density * 0.25)));

  // The cap's straight run, aimed at a nominal sharp apex on the axis.
  const A = [s1, shoulder];
  const capDx = 0 - s1;
  const capDy = apex - shoulder;
  const capL = Math.hypot(capDx, capDy);
  const cux = capDx / capL;
  const cuy = capDy / capL;
  const capN = [cuy, -cux];

  // Shoulder fillet between shaft and cap.
  const aSh0 = Math.atan2(shaftN[1], shaftN[0]);
  const aSh1 = Math.atan2(capN[1], capN[0]);
  const turn = aSh1 - aSh0;
  const tLen = shoulderFillet * Math.tan(Math.abs(turn) / 2);
  const shT1 = [A[0] - tLen * sux, A[1] - tLen * suy];
  const shC = [shT1[0] + shoulderFillet * -shaftN[0], shT1[1] + shoulderFillet * -shaftN[1]];
  push(shT1[0], shT1[1], shaftN[0], shaftN[1]); // wait: emitted by the arc below
  out.pop();
  arc(shC[0], shC[1], shoulderFillet, aSh0, aSh1, Math.max(3, Math.round(density * Math.abs(turn) / (Math.PI / 2))));

  // Nose: a circle centred on the axis, tangent to the cap's line. Solving for
  // its centre rather than picking one keeps the cap dead straight right up to
  // where the round starts, which is what makes a blunt tip read as a blunt
  // point and not as a dome.
  const yc = shoulder + (noseRadius + s1 * cuy) / Math.abs(cux);
  const t = (0 - A[0]) * cux + (yc - A[1]) * cuy;
  const T = [A[0] + t * cux, A[1] + t * cuy];
  const aNose0 = Math.atan2(T[1] - yc, T[0] - 0);
  arc(0, yc, noseRadius, aNose0, Math.PI / 2, Math.max(4, Math.round(density * 0.6)));
  return { samples: out, height: yc + noseRadius };
}

// Sweep a rounded-square section along a silhouette.
function buildTaperedColumn({ silhouette, corner, uv, density = SEGMENTS.curve }) {
  const spans = roundedSquareSection(corner, density);
  const counts = spans.map((s) => s.length);
  const N = counts.reduce((a, b) => a + b, 0);

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];

  for (const r of silhouette) {
    for (let f = 0; f < 4; f++) {
      for (const p of spans[f]) {
        pos.push(r.s * p.x, r.y, r.s * p.z);
        const nx = p.nx * r.ns;
        const ny = r.ny * p.k;
        const nz = p.nz * r.ns;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l, ny / l, nz / l);
        const [u, v] = uv(f, p, r);
        uvs.push(u, v);
      }
    }
  }

  for (let i = 0; i < silhouette.length - 1; i++) {
    let base = 0;
    for (const count of counts) {
      for (let j = 0; j < count - 1; j++) {
        const a = i * N + base + j;
        const b = i * N + base + j + 1;
        const c = (i + 1) * N + base + j + 1;
        const d = (i + 1) * N + base + j;
        idx.push(a, c, b, a, d, c);
      }
      base += count;
    }
  }
  // The spans are separate strips, so the four straight edges between them --
  // the seams down the corners of the square -- have to be stitched by hand.
  for (let i = 0; i < silhouette.length - 1; i++) {
    let base = 0;
    for (let f = 0; f < 4; f++) {
      const end = base + counts[f] - 1;
      const start = (base + counts[f]) % N;
      idx.push(i * N + end, (i + 1) * N + start, i * N + start);
      idx.push(i * N + end, (i + 1) * N + end, (i + 1) * N + start);
      base += counts[f];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
