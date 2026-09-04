import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// The twin arch: one wide stone with two round tops and a soft valley between
// them, the kind that marks a couple. The widest piece in the set, and the only
// one carrying two inscriptions.
//
// WHY IT IS BUILT THIS WAY
//
// buildSlabGeometry sweeps its profile round a CONVEX outline, and two arches
// with a notch between them is not convex, so the registry's slab cannot be the
// whole silhouette. The two honest routes were a squared slab with caps bolted
// on top, or authoring the outline here. Caps lose either way: a separate solid
// meeting a flat face leaves a crease at the junction, and a union of two discs
// can only ever cross in a V, which is the slot the house style forbids.
//
// So the outline is authored here, as an arc chain that the same quarter-round
// profile is swept around -- the house technique, generalised to allow one
// CONCAVE arc. That concave arc is the whole point: it is a real fillet, tangent
// to both arch circles, so the valley is G1 continuous with the domes either
// side of it and comes out as a soft dip rather than a crease. Offsetting still
// costs nothing: a convex arc's radius shrinks by the inset, a concave arc's
// grows by it, the centres never move, and two externally tangent circles stay
// tangent at the same angles when one loses d and the other gains it. So every
// ring of the sweep is the same outline with the same arc endpoints, and the
// normals stay analytic exactly as they do in tombstones.js.
//
// The piece this file adds is a CROWN, not a top: it sinks CROWN_SINK into the
// squared-off slab so the joint is buried. Its straight sides are at the slab's
// own halfWidth and its arch circles are tangent to them, so where the crown's
// silhouette leaves the slab's the two are already parallel. Its front face is
// coplanar with the slab's and carries the same UVs, so the coincident surfaces
// shade identically and the junction is invisible -- there is nothing to
// z-fight about when both sides of the fight are the same pixel.

// Widest in the set at 1.32 across, against bat's 1.00, and 1.48 tall to the
// arch tops against bat's 1.52. Wider than tall would be a wall; this is still
// a hair taller than it is wide, and the notch keeps the top from reading as
// one flat run. The face left for lettering is 1.32 by 0.92, which is the price
// of two domes above and a deep plinth below.
const SHAPE = { halfWidth: 0.66, height: 0.92, depth: 0.34, plinth: 0.20 };

// The arches. radius + centre = halfWidth, which is what makes each dome
// tangent to its own side of the stone. radius above half the width is what
// makes the two circles overlap, and how far above sets how deep the notch is:
// at exactly half they would meet in a cusp running all the way down to the
// springing line. valley is the fillet radius, the softness of the dip.
const ARCH = { radius: 0.36, centre: 0.30, valley: 0.09 };

// How far the crown sinks into the slab. Only has to clear the slab's top edge
// rounding; the rest is margin.
const CROWN_SINK = 0.24;

const BOTTOM_R = 0.09; // buried corners, still >= the sweep's edge radius

// ---------------------------------------------------------------------------
// the outline

// Counter-clockwise from the buried bottom-right corner. sign is +1 for an arc
// the stone bulges out of and -1 for one it is scooped in by; it flips both the
// direction the inset moves the radius and the outward normal.
function crownOutline(W, H) {
  const { radius: R, centre: xc, valley: rv } = ARCH;
  const ya = H;                 // springing line, level with the slab's top
  const yb = H - CROWN_SINK;
  // Fillet centre: externally tangent to both arch circles, so it sits on the
  // centre line at the height where the two circles are R + rv away.
  const yf = ya + Math.sqrt((R + rv) * (R + rv) - xc * xc);
  // The tangent point, as an angle about the arch centre and about the fillet
  // centre. They differ by half a turn because the point is on the line joining
  // the two centres, and neither angle moves as the sweep insets.
  const a = Math.atan2(yf - ya, -xc);
  return [
    { cx: W - BOTTOM_R, cy: yb + BOTTOM_R, r: BOTTOM_R, a0: -Math.PI / 2, a1: 0, sign: 1 },
    { cx: xc, cy: ya, r: R, a0: 0, a1: a, sign: 1 },
    { cx: 0, cy: yf, r: rv, a0: a - Math.PI, a1: -a, sign: -1 },
    { cx: -xc, cy: ya, r: R, a0: Math.PI - a, a1: Math.PI, sign: 1 },
    { cx: -(W - BOTTOM_R), cy: yb + BOTTOM_R, r: BOTTOM_R, a0: Math.PI, a1: Math.PI * 1.5, sign: 1 },
  ];
}

// The same sweep as buildSlabGeometry, over an arc chain that may turn either
// way. Kept here rather than asked for in tombstones.js because it is the only
// stone that needs a non-convex outline.
function buildCrownGeometry({ outline, depth, edge: e, uv, fanY }) {
  const hz = depth / 2;
  const arcs = outline.map((c) => ({
    ...c,
    // One segment per ~14mm of arc, so the domes and the little valley are both
    // smooth at the size the eye actually meets them.
    seg: Math.max(10, Math.ceil((Math.abs(c.a1 - c.a0) * c.r) / 0.014)),
  }));
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

  // The outline is not convex, so the flat faces cannot be fanned from just
  // anywhere. It is star-shaped about a point on the centre line down in the
  // straight-sided part, which is where fanY puts the hub.
  const cFront = pos.length / 3;
  push(0, fanY, hz, 0, 0, 1, true);
  const cBack = pos.length / 3;
  push(0, fanY, -hz, 0, 0, -1, false);
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
// the marks

// A plump heart, all curve, no cusp at the sides. Small on purpose: it is the
// hinge between the two names, not a third inscription.
function inkHeart(ctx, cx, cy, width) {
  const s = width / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.98);
  ctx.bezierCurveTo(cx - s * 0.58, cy + s * 0.44, cx - s, cy + s * 0.02, cx - s, cy - s * 0.40);
  ctx.bezierCurveTo(cx - s, cy - s * 0.92, cx - s * 0.40, cy - s * 1.06, cx, cy - s * 0.52);
  ctx.bezierCurveTo(cx + s * 0.40, cy - s * 1.06, cx + s, cy - s * 0.92, cx + s, cy - s * 0.40);
  ctx.bezierCurveTo(cx + s, cy + s * 0.02, cx + s * 0.58, cy + s * 0.44, cx, cy + s * 0.98);
  ctx.closePath();
  ctx.fill();
}

registerStone('twin', {
  shape: SHAPE,
  // Squared off: the crown supplies the top, and the slab's own corners are
  // buried inside it. Anything at or under the sweep's edge radius clamps to it.
  topRadius: 0.062,

  // Two inscriptions, one under each dome, and the heart on the centre line
  // just under the valley. The face canvas stops at the springing line, so the
  // top of it IS the notch: there is no texture above, and nothing should be
  // drawn expecting the arches to carry it.
  draw(ctx, w, h) {
    // Each block sits under its own arch's apex rather than in the middle of
    // its half of the face; a hair inboard, which is where the eye puts them.
    const ax = (ARCH.centre / (2 * SHAPE.halfWidth)) * w;
    // Letters end up 0.115 world tall, between fred's 0.094 and cross's 0.122.
    // Matching the set's letter SIZE matters more than matching its ink
    // percentage: this face is half as tall again as it is wide, so the same
    // letters cover less of it, and the failure being guarded against is a
    // stone that reads dark and busy, not one that reads clean.
    const size = h * 0.19;
    const spacing = size * 0.05;
    const rows = [h * 0.355, h * 0.565];
    inkText(ctx, 'OUR', w / 2 - ax, rows[0], size, spacing);
    inkText(ctx, 'MA', w / 2 - ax, rows[1], size, spacing);
    inkText(ctx, 'OUR', w / 2 + ax, rows[0], size, spacing);
    inkText(ctx, 'PA', w / 2 + ax, rows[1], size, spacing);
    inkHeart(ctx, w / 2, h * 0.135, w * 0.075);
  },

  extras({ body, material, shape, plinthH, halfWidth: W, height: H }) {
    // Recover the face/strip split of the texture atlas. buildTextures lays the
    // face out at exact face aspect on the left and a plain strip on the right,
    // so the split falls out of the map's own pixel dimensions. Without this the
    // crown could not share the slab's UVs, and sharing them is what makes the
    // joint disappear.
    const img = material.map?.image;
    const frontFrac = img ? Math.round(img.height * ((2 * W) / H)) / img.width : 1;
    const stripFrac = img ? 1 - frontFrac : 0;

    // Identical to the slab's mapping, including the clamp: above the springing
    // line the face texture has run out and the top row repeats, which is plain
    // mottled stone.
    const uv = (x, y, front) =>
      front
        ? [((x + W) / (2 * W)) * frontFrac, Math.min(1, y / H)]
        : [frontFrac + stripFrac * (0.15 + 0.7 * ((x + W) / (2 * W))), Math.min(1, Math.max(0, y / H))];

    const geo = buildCrownGeometry({
      outline: crownOutline(W, H),
      depth: shape.depth,
      edge: 0.062, // the slab's edge radius: the two rims have to agree
      uv,
      fanY: H - CROWN_SINK / 2,
    });
    const crown = new THREE.Mesh(geo, material);
    crown.position.y = plinthH;
    crown.castShadow = true;
    crown.receiveShadow = true;
    // createTombstone's dispose() only knows about the meshes it made itself.
    crown.userData.dispose = () => geo.dispose();
    body.add(crown);
  },
});
