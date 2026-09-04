import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// The heart-topped stone: the small sentimental one in the set.
//
// The danger with this one is sweetness, so nothing about it is a valentine. It
// is a short thick slab wearing a heart the way a stone wears a top, the two
// lobes are different sizes, one sits higher than the other, the valley between
// them is off centre, and the face carries two small words on a lot of blank
// stone.
//
// WHY IT IS BUILT THIS WAY
//
// buildSlabGeometry sweeps its profile round a CONVEX outline, and a heart's
// notch is exactly what a convex outline cannot have, so the registry's slab
// cannot be the whole silhouette. The two honest routes were a squared slab with
// lobes bolted on in extras, or authoring the outline here. Lobes lose twice
// over: a separate solid meeting the slab's flat face is either coplanar with it
// or leaves a crease at the junction, and a union of two discs can only cross in
// a V, which is the slot the brief forbids.
//
// So the outline is authored here and the house's own quarter-round profile is
// swept round it, with the arc chain generalised to allow CONCAVE arcs. Two of
// them do work no convex outline can:
//
//   * the valley is a real fillet, externally tangent to both lobes, so the dip
//     is G1 continuous with the domes either side of it and comes out soft;
//   * each shoulder is a fillet too, tangent to the stone's own straight side,
//     which is what lets the lobes stand PROUD of the shaft. That is the whole
//     silhouette. Without it a lobe has to be a circle tangent to that side from
//     the inside, which caps its width at the shaft's and, worse, puts its
//     centre one rim radius BELOW the top of the slab, so the top of each lobe
//     is buried in the stone it grows out of and what stands above is a segment
//     three times wider than it is tall. That version rendered as a slab with a
//     nick in it. With the cove, the stone swells at the shoulders into two
//     round lobes wider than its own body, and the underside of that swell is a
//     cove rather than a ledge.
//
// Offsetting still costs nothing, which is what makes the generalisation honest
// rather than a hack: a convex arc's radius shrinks by the inset and a concave
// one's grows by it, the centres never move, and two externally tangent circles
// stay tangent at the same angles when one loses d and the other gains it. So
// every ring of the sweep is the same outline with the same arc endpoints and
// the normals stay analytic, as they do in tombstones.js.
//
// Following twin.js, the piece is a CROWN rather than a top: it sinks into the
// squared-off slab, its straight sides on the slab's own half width and its
// front face coplanar with the slab's carrying the same UVs, so the coincident
// surfaces shade identically and there is nothing to z-fight about.
//
// WHAT THE FIXED RIM RADIUS DID AT THIS SIZE
//
// The rim is a fixed 0.062 rather than a fraction of the stone, and the warning
// in tombstones.js is about it thinning to a hairline on a big slab. Going the
// other way it is the lobes that pay, and it cost me the version described
// above. A lobe here is 0.13 in the radius, so the flat front face -- the
// outline inset by the full rim -- keeps barely half of it, and two lobes much
// smaller than these shrink past each other on the way in until the face pinches
// shut at the centre, which is a stone with a slot in it. It also sets the floor
// under the valley fillet, since a fillet tighter than the rim would be the one
// edge on the piece the rim could not round. The radius is right for the set. It
// is simply a much larger fraction of a small stone, and the shape had to be
// drawn around it rather than scaled down into it.

// Body 0.62 across and 1.08 to the top of the taller lobe, against fred's 0.74
// and 1.10: the smallest stone in the set, which is what the sentimental one
// should be. Thick for its size on purpose, because a thin heart-topped stone
// reads as a cut-out card. The face comes out at 0.84 of its own height, near
// enough fred's 0.78, so it is 858 texels wide against his 797 and the engraving
// treatment is working at the size it was tuned at.
const SHAPE = { halfWidth: 0.31, height: 0.78, depth: 0.23, plinth: 0.13 };

// The heart, as fractions of the half width so the shape survives a resize.
// `lobe` is each lobe's radius, `shoulder` the cove it flares out of, `flare`
// how far round that cove the lobe is carried before it starts, which is what
// sets the overhang, and `valley` the fillet radius of the dip between them.
// `lopsided` and `tilt` are the hand-cut part: one lobe larger, and the smaller
// one flaring less so it sits lower, which puts the valley off centre.
const HEART = { lobe: 0.514, shoulder: 0.3, flare: 15, valley: 0.194, lopsided: 0.05, tilt: 0.05 };

// How far the crown sinks into the slab. Only has to bury the slab's top edge
// rounding and the joint; the rest is margin.
const CROWN_SINK = 0.2;

// ---------------------------------------------------------------------------
// the outline

// Two circles meet at two points; this returns the upper one. It places the
// valley fillet, which is lobe radius + valley radius away from each lobe centre
// and therefore sits where two circles of those radii cross.
function upperMeet(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  return dx >= 0 ? { x: mx - (h * dy) / d, y: my + (h * dx) / d } : { x: mx + (h * dy) / d, y: my - (h * dx) / d };
}

// One lobe and the cove it grows out of, on the side given by `s`. The cove is
// tangent to the straight side x = s*W at the height the slab's own corner
// rounding begins, so the crown's silhouette leaves the slab's already parallel
// to it, and the lobe is externally tangent to the cove, so it leaves that
// already parallel too. Nothing in the chain turns a corner.
function lobeAt(W, ys, s, radius, flare) {
  const rs = W * HEART.shoulder;
  const R = W * radius;
  const cove = { x: s * (W + rs), y: ys };
  const b = (flare * Math.PI) / 180;
  return {
    rs,
    R,
    cove,
    centre: { x: cove.x - s * (R + rs) * Math.cos(b), y: ys + (R + rs) * Math.sin(b) },
    // Angles about the cove centre and about the lobe centre of the point where
    // the two touch. Half a turn apart, because the point is on the line joining
    // them, and neither angle moves as the sweep insets.
    coveA: s > 0 ? Math.PI - b : b,
    lobeA: s > 0 ? -b : Math.PI + b,
  };
}

// Counter-clockwise from the buried bottom-right corner. `sign` is +1 for an arc
// the stone bulges out of and -1 for one it is scooped in by; it flips both the
// direction the inset moves the radius and the outward normal.
function heartOutline(W, H, edge) {
  const rb = Math.max(edge, 0.09); // buried corners, never tighter than the rim
  const yb = H - CROWN_SINK;
  const ys = H - edge; // where the slab's straight sides stop
  const r = lobeAt(W, ys, +1, HEART.lobe * (1 + HEART.lopsided), HEART.flare * (1 + HEART.tilt));
  const l = lobeAt(W, ys, -1, HEART.lobe * (1 - HEART.lopsided), HEART.flare * (1 - HEART.tilt));
  const rv = W * HEART.valley;
  const f = upperMeet(r.centre, r.R + rv, l.centre, l.R + rv);
  const ar = Math.atan2(f.y - r.centre.y, f.x - r.centre.x);
  const al = Math.atan2(f.y - l.centre.y, f.x - l.centre.x);
  return [
    { cx: W - rb, cy: yb + rb, r: rb, a0: -Math.PI / 2, a1: 0, sign: 1 },
    { cx: r.cove.x, cy: r.cove.y, r: r.rs, a0: Math.PI, a1: r.coveA, sign: -1 },
    { cx: r.centre.x, cy: r.centre.y, r: r.R, a0: r.lobeA, a1: ar, sign: 1 },
    // Walked clockwise, through the bottom of the dip, from one tangency to the
    // other. Both are half a turn round from the lobe angles.
    { cx: f.x, cy: f.y, r: rv, a0: ar - Math.PI, a1: al - Math.PI, sign: -1 },
    { cx: l.centre.x, cy: l.centre.y, r: l.R, a0: al, a1: l.lobeA, sign: 1 },
    { cx: l.cove.x, cy: l.cove.y, r: l.rs, a0: l.coveA, a1: 0, sign: -1 },
    { cx: -(W - rb), cy: yb + rb, r: rb, a0: Math.PI, a1: Math.PI * 1.5, sign: 1 },
  ];
}

// ---------------------------------------------------------------------------
// the sweep

// The same sweep as buildSlabGeometry, over an arc chain that may turn either
// way. Kept here rather than asked for in tombstones.js because only the stones
// with a notch need a non-convex outline, and twin.js already carries its own.
function buildCrownGeometry({ outline, depth, edge: e, uv }) {
  const hz = depth / 2;
  // One segment per ~14mm of arc, matching twin.js, so the lobes and the little
  // coves under them are both smooth at the size the eye meets them.
  const arcs = outline.map((c) => ({ ...c, seg: Math.max(8, Math.ceil((Math.abs(c.a1 - c.a0) * c.r) / 0.014)) }));
  const N = arcs.reduce((n, c) => n + c.seg + 1, 0);

  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const t = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(t)), z: hz - e + e * Math.cos(t), ns: Math.sin(t), nz: Math.cos(t), front: true });
  }
  profile.push({ inset: 0, z: hz - e, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - e), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const t = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(t)), z: -(hz - e + e * Math.cos(t)), ns: Math.sin(t), nz: -Math.cos(t), front: false });
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

  for (const p of profile) {
    for (const c of arcs) {
      const r = c.r - c.sign * p.inset;
      for (let j = 0; j <= c.seg; j++) {
        const t = c.a0 + (c.a1 - c.a0) * (j / c.seg);
        const ct = Math.cos(t);
        const st = Math.sin(t);
        push(c.cx + r * ct, c.cy + r * st, p.z, ct * c.sign * p.ns, st * c.sign * p.ns, p.nz, p.front);
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
  // full rim radius with its normal facing straight forward, and the last ring
  // is its mirror, so both faces are triangulations of that one polygon and need
  // no vertices of their own. twin.js fans its faces from a hub, which asks the
  // outline to be star shaped; this one has a deeper valley and a cove scooped
  // into each side, so rather than argue the hub can see past all three it goes
  // through three's own ear clip, which does not care.
  const contour = [];
  for (let j = 0; j < N; j++) contour.push(new THREE.Vector2(pos[j * 3], pos[j * 3 + 1]));
  const back = (profile.length - 1) * N;
  for (const [p0, p1, p2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
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
  shape: SHAPE,
  // Squared off: the crown supplies the top and the slab's own corners are
  // buried inside it. Zero clamps up to the sweep's own rim radius, whatever
  // that is, which is what the crown's shoulders are placed against.
  topRadius: 0,

  // Two short words and nothing else. The outline is already the sentiment, so a
  // carved heart on top of it would be the mistake the postmortem names: a mark
  // that parallels the silhouette adds no new shape, it only thickens what is
  // already there.
  draw(ctx, w, h) {
    const size = h * 0.14;
    inkText(ctx, 'EVER', w / 2, h * 0.42, size, size * 0.05);
    inkText(ctx, 'DEAR', w / 2, h * 0.59, size, size * 0.05);
  },

  extras({ body, material, shape, plinthH, halfWidth: W, height: H, edge, slabUV, disposables }) {
    const geo = buildCrownGeometry({
      outline: heartOutline(W, H, edge),
      depth: shape.depth,
      edge, // the slab's rim radius: the two have to agree or the joint shows
      // The slab's own mapping, so the crown's front face carries the same
      // texture in the same place and the coincident faces shade identically.
      // It clamps v, which is what the crown standing above the face needs.
      uv: slabUV,
    });
    const crown = new THREE.Mesh(geo, material);
    crown.position.y = plinthH;
    crown.castShadow = true;
    crown.receiveShadow = true;
    body.add(crown);
    disposables.push(geo);
  },
});
