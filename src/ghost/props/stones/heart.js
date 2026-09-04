import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';
import { SEGMENTS } from '../style.js';

// The heart-topped stone: the small sentimental one in the set.
//
// It is a plain chunky slab, squared off, wearing a heart for a top. The danger
// with this one is sweetness, so nothing about it is a valentine: it is short
// and thick, the two lobes are different sizes, the valley between them sits
// off centre, and the inscription is two small words on a lot of blank stone.
//
// --- how the top is built ---------------------------------------------------
//
// buildSlabGeometry sweeps its quarter-round profile around a CONVEX outline,
// and a heart's notch is the one thing an outline of four corner circles cannot
// be. The two honest routes were "square the slab off and stick two lobes on in
// extras" and "author the outline yourself". This is the second, because the
// first cannot be made to join: any lobe added as its own mesh either has a flat
// front face coplanar with the slab's (z-fighting straight down the face) or is
// pushed out of that plane and reads as a piece screwed onto the front.
//
// So the top is one mesh swept through the SAME profile as the slab -- same
// depth, same fixed edge radius -- around an outline of my own. Two facts make
// that join invisible:
//
//   1. Because both solids are the same 2D outline swept through the same
//      profile, their surfaces agree wherever their outlines agree. Each lobe is
//      a circle tangent to the line the slab's own straight side lies on, so the
//      cap carries that side upward, holds it for a moment and then rounds over:
//      side, straight run, lobe, every join tangent, no corner anywhere. The
//      slab's top corners and top edge end up buried inside the cap.
//   2. The cap's outline bottom is a straight edge at height - 2*edge, so its
//      flat front face begins exactly at height - edge, where the slab's flat
//      front face ends. The two faces abut along a line and never overlap, and
//      everything of the cap below that line is inside the slab.
//
// The notch is a concave fillet arc tangent to both lobes, never a slot. A
// concave arc behaves under the sweep's inward offset exactly as a convex one
// does -- radius grows instead of shrinks, centre does not move -- so the valley
// stays a valley all the way from the silhouette to the flat face, and gets
// softer and deeper as it comes forward. Every tangency in the chain is offset
// invariant, so one ring of arc angles serves every ring of the sweep.
//
// --- what the fixed edge radius did at this size ----------------------------
//
// The rounded edge is a fixed 0.062 rather than a fraction of the stone, and the
// warning in tombstones.js is about it shrinking to a hairline on a big slab.
// Going the other way it is the lobes that pay, twice over, and both cost me a
// version.
//
// The first is the flat face. It is the outline inset by the full edge radius,
// so every lobe loses 0.062 of its radius before it gets there. Lobes much under
// half the half-width shrink past each other on the way in and the face pinches
// shut at the centre, which is a stone with a slot in it. Half the half-width is
// where this one sits, and the measured clearance at the pinch is reported by
// the probe as the "neck".
//
// The second cost the whole shape. A lobe drawn as a circle through the corner
// of the slab has its centre level with the slab's top CORNER centre, which is
// one edge radius BELOW the top of the slab -- so the top 0.062 of each lobe is
// hidden inside the slab it grows out of, and what is left standing above the
// stone is a shallow segment nearly three times wider than it is tall. Rendered,
// that is not a heart, it is a rounded slab with a nick in it. The fix is the
// `LIFT` below: the sides run straight up past the top of the slab before the
// lobes round over, which is free (a vertical run between two arcs both tangent
// to it, exactly how the slab gets its own straight sides) and turns each lobe
// back into a dome. On a bigger stone the same edge radius would have cost a
// fifth of this, and none of it would have come up.
const LOBE = 0.4; // lobe radius as a fraction of the half-width
const LIFT = 0.35; // straight rise above the shoulders before the lobes round over
const VALLEY = 0.25; // fillet radius in the notch, same units
const LOPSIDED = 0.04; // one lobe this much larger, the other that much smaller
const TILT = 0.022; // and one sits that much higher than the other

// Two circles, radius r1 about c1 and r2 about c2, meet at two points. Returns
// the upper one, which is the fillet centre sitting above the notch.
function upperIntersection(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  const nx = -dy / d;
  const ny = dx / d;
  return ny >= 0 ? { x: mx + h * nx, y: my + h * ny } : { x: mx - h * nx, y: my - h * ny };
}

// The heart top as a tangent-continuous chain of arcs, counter-clockwise from
// the bottom right. Straight runs fall out for free between consecutive arcs,
// exactly as they do in buildSlabGeometry.
//
// `concave` marks the notch fillet: its radius grows under the inward offset and
// its outward normal points back at its own centre.
function heartArcs(W, H, e) {
  const R = W * LOBE;
  const r1 = R * (1 + LOPSIDED);
  const r2 = R * (1 - LOPSIDED);
  const rf = W * VALLEY;
  // y0 is the height of the slab's top corner centres, which is where its
  // straight sides stop. Every lobe is widest at exactly the half-width, so its
  // centre sits on the axis of that side and the two run into each other with no
  // corner: straight side, straight run, lobe, all tangent. The lift is what
  // stands the lobes up above the stone instead of half burying them in it.
  const y0 = H - e;
  const c1 = { x: W - r1, y: y0 + W * (LIFT + TILT) };
  const c2 = { x: -(W - r2), y: y0 + W * (LIFT - TILT) };
  const f = upperIntersection(c1, r1 + rf, c2, r2 + rf);

  // Unit vectors from each lobe centre towards the fillet centre. The tangency
  // between lobe and fillet lies along them, and their direction does not change
  // as the outline is offset inward, which is what keeps one set of angles valid
  // for every ring of the sweep.
  const u1 = { x: f.x - c1.x, y: f.y - c1.y };
  const u2 = { x: f.x - c2.x, y: f.y - c2.y };
  const a1 = Math.atan2(u1.y, u1.x);
  const a2 = Math.atan2(u2.y, u2.x);
  // Seen from the fillet centre the two tangencies are in the opposite
  // direction, and the arc between them is walked the short way, clockwise
  // through the bottom of the valley.
  const f1 = a1 + Math.PI;
  let f2 = a2 + Math.PI;
  while (f2 > f1) f2 -= Math.PI * 2;

  const seg = (angle, r) => Math.max(6, Math.round(SEGMENTS.curve * Math.abs(angle) / (Math.PI / 2) * Math.min(1, r / W)));
  // The bottom of the cap, buried in the slab. These corners are circles of
  // exactly the edge radius, so they close the outline against the straight
  // sides and then collapse to a point on the flat face instead of fighting the
  // slab's face for the same plane.
  const k1 = { cx: W - e, cy: y0, r: e, a0: -Math.PI / 2, a1: 0, seg: 4 };
  const k2 = { cx: -(W - e), cy: y0, r: e, a0: Math.PI, a1: Math.PI * 1.5, seg: 4 };
  return [
    k1,
    { cx: c1.x, cy: c1.y, r: r1, a0: 0, a1, seg: seg(a1, r1) },
    { cx: f.x, cy: f.y, r: rf, a0: f1, a1: f2, seg: 9, concave: true },
    { cx: c2.x, cy: c2.y, r: r2, a0: a2, a1: Math.PI, seg: seg(Math.PI - a2, r2) },
    k2,
  ];
}

// The same sweep as the slab's, over an arbitrary tangent-continuous arc chain
// rather than four convex corners. Every ring is the outline offset inward by
// the profile's inset: convex arcs lose that much radius, concave arcs gain it,
// and no centre moves, so the offset is exact and every normal is known
// analytically. No computeVertexNormals, no seams.
function buildCapGeometry({ arcs, depth: D, edge: e, uv }) {
  const hz = D / 2;
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: hz - e + e * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  profile.push({ inset: 0, z: hz - e, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - e), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: -(hz - e + e * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), front: false });
  }

  const N = arcs.reduce((n, c) => n + c.seg + 1, 0);
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  for (const p of profile) {
    for (const c of arcs) {
      const s = c.concave ? -1 : 1;
      const r = c.r - s * p.inset;
      for (let j = 0; j <= c.seg; j++) {
        const a = c.a0 + (c.a1 - c.a0) * (j / c.seg);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = c.cx + r * ca;
        const y = c.cy + r * sa;
        pos.push(x, y, p.z);
        nor.push(s * ca * p.ns, s * sa * p.ns, p.nz);
        const [u, v] = uv(x, y, p.front);
        uvs.push(u, v);
      }
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

  // Front and back faces. The first ring is already the outline inset by the
  // full edge radius with its normal facing straight forward, and the last ring
  // is its mirror, so both faces are triangulations of that one polygon and need
  // no vertices of their own. It is not convex -- the notch sees to that -- so
  // this is an ear clip rather than the slab's fan. Points that collapse
  // together at full inset (the two bottom corners do, by construction) are
  // dropped first: a repeated vertex is what breaks an ear clip.
  const contour = [];
  const ring = [];
  for (let j = 0; j < N; j++) {
    const x = pos[j * 3];
    const y = pos[j * 3 + 1];
    const prev = contour[contour.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-7 && Math.abs(prev.y - y) < 1e-7) continue;
    contour.push(new THREE.Vector2(x, y));
    ring.push(j);
  }
  const back = (profile.length - 1) * N;
  for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const [p0, p1, p2] = t.map((k) => ring[k]);
    const area =
      (pos[p1 * 3] - pos[p0 * 3]) * (pos[p2 * 3 + 1] - pos[p0 * 3 + 1]) -
      (pos[p2 * 3] - pos[p0 * 3]) * (pos[p1 * 3 + 1] - pos[p0 * 3 + 1]);
    const [a, b, c] = area >= 0 ? [p0, p1, p2] : [p0, p2, p1];
    idx.push(a, b, c);
    idx.push(back + a, back + c, back + b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

registerStone('heart', {
  // The little one, and smaller than the little one: 1.09 to the top of the
  // taller lobe against fred's 1.10, on a 0.64 body against his 0.74. Thick for
  // its size on purpose, since a thin heart-topped stone reads as a cut-out
  // card. The face comes out at 0.81 of its own height, within a whisker of
  // fred's 0.78, so it is 819 texels wide against his 797 and the engraving
  // treatment is working at the size it was tuned at.
  shape: { halfWidth: 0.32, height: 0.77, depth: 0.23, plinth: 0.13 },
  // Squared off: the top corners and the top edge are swallowed by the lobes, so
  // all this has to do is not be an arch. Zero is clamped up to the edge radius,
  // which is the squarest the vinyl style allows and is what the cap assumes.
  topRadius: 0,

  // Two short words and nothing else. The stone's own outline is already the
  // sentiment, so a carved heart on top of it would be the mistake the
  // postmortem names: a mark that parallels the silhouette adds no new shape,
  // it only thickens what is already there.
  draw(ctx, w, h) {
    const size = h * 0.17;
    inkText(ctx, 'EVER', w / 2, h * 0.4, size, size * 0.05);
    inkText(ctx, 'DEAR', w / 2, h * 0.58, size, size * 0.05);
  },

  extras({ body, material, shape, plinthH, halfWidth, height, edge, disposables, slabUV }) {
    const geo = buildCapGeometry({
      arcs: heartArcs(halfWidth, height, edge),
      depth: shape.depth,
      edge,
      // slabUV is the slab's own mapping, so the mottling runs up off the face
      // and onto the lobes without a break. It clamps above the face, which is
      // all the cap needs: the inscription is nowhere near the top of the stone.
      uv: slabUV,
    });
    const cap = new THREE.Mesh(geo, material);
    cap.position.y = plinthH;
    cap.castShadow = true;
    cap.receiveShadow = true;
    body.add(cap);
    disposables.push(geo);
  },
});
