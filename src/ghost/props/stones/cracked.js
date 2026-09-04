import * as THREE from 'three';
import { registerStone, inkCross, inkText } from '../tombstones.js';

// The old one.
//
// Every other stone in the set is sound and very nearly upright. This is the
// derelict: it leans about five times as far as its neighbours, a piece of the
// arch is gone, a crack runs across the face, and the inscription has worn back
// to the few marks the weather did not reach. It is the piece that makes the
// row read as an old graveyard rather than a new one.
//
// It is deliberately the SAME stone as `cross`, in worse condition: the same
// swept slab, the same plinth, the same arch, and literally the same
// inscription drawn at the same numbers, then eaten. Nothing here invents a new
// silhouette, because the last set of new stones spent its identity on
// silhouettes and was rejected for it. What is new is only damage.
//
// Two choices worth stating, because both had a cheaper wrong answer.
//
// THE CRACK IS DRAWN, NOT CUT. It goes into the face artwork, so it gets the
// set's two-map carving for free: a dark floor, a shaded wall under its upper
// edge, a lit lip along its lower one, and a baked normal that holds its depth
// when the camera pulls back. Cut instead, it would have to be a seam through a
// slab whose whole construction exists to avoid seams, at a tessellation that
// carries exactly two rings across the depth, and the postmortem's warning
// applies: a geometric edge beats a mark, so a cut crack would compete with the
// inscription instead of joining it. Drawn, it is the same kind of mark as the
// letters and sits in the same plane as them. The only cost is ink, and a crack
// spends ink fast, so it is budgeted below with everything else.
//
// THE MISSING CORNER IS GEOMETRY, because it is a silhouette change and no
// amount of paint makes a silhouette. It is taken out of the slab in extras(),
// as a subtraction the sweep can express exactly: see chipSlab().

const SHAPE = {
  // Held tight to `cross` (0.46 / 1.37 / 0.30 / 0.19) so the two read as one
  // pattern of stone. A shade narrower and noticeably shorter: 1.40 against the
  // cross's 1.56 and the little one's 1.10, which puts it between them, and an
  // old stone that has settled into the ground is the short one for a reason.
  // The face works out 727 by 1024 texels, inside the band the engraving
  // treatment was calibrated for and well clear of the floor it collapses at.
  halfWidth: 0.44,
  height: 1.24,
  depth: 0.29,
  plinth: 0.16,
};

// No topRadius: the default full half-round arch. The break has to be read
// against a shape the eye already knows from the other stones, or it is not a
// break, it is just an odd outline.

// --- the chip ---------------------------------------------------------------
//
// Circles subtracted from the slab's outline, positioned on the arch. `deg` is
// where on the arch the circle sits (90 is top centre, 0 is the right side),
// `bite` is how far inside the outline it reaches, `r` is how broad the scoop
// is. Three of them, unequal and overlapping, because one circle is a bite out
// of an apple and three are a chip.
//
// Kept soft on purpose. This is a chipped bath toy, not shattered granite: the
// scoop is concave and its lips are rounded by the same quarter-round sweep
// that rounds every other edge on the piece, so nothing along the break is
// sharper than the arch it came out of.
// The first pass ran these from 98 to 174 degrees with a bite of 0.15, and the
// render was decisive: the crown of the arch went with it, the stone came back
// as a triangular shard and stopped reading as a headstone at all. A corner is
// a corner. The crown has to survive, or the silhouette is spent, which is
// exactly what the postmortem says killed the last set.
//
// The two outer circles are the ones that make it vinyl rather than flint. A
// circle that cuts deep meets the arch at a steep angle, and that junction is a
// spike: the second render came back with a little horn standing up where the
// scoop started. So the ends of the chip are wide, shallow circles that barely
// break the surface, and they feather the scoop into the intact outline over
// twenty-odd degrees instead of meeting it at a point. Nothing on this stone is
// allowed to be sharper than the arch.
//
// On the RIGHT shoulder, and that is a decision about the camera rather than
// about the stone. The set is lit and viewed from front right, so a break put
// on the left shoulder shows only as a notch in the far silhouette and its
// scoop, the whole point of it, faces away into shade. Rendered on the left it
// read as a wonky arch; the same numbers mirrored read as a corner knocked off,
// because the key light rakes straight into the dish.
// Two lobes rather than one scoop, and the depths deliberately do not run in
// order. Three circles of gently increasing depth union into a single lens,
// which came back as a long straight bevel: the stone read as a shouldered
// design rather than a damaged one. A deep lobe, a shallower waist and a second
// deep lobe is what makes it lumpy, which is what a chipped bath toy is.
const CHIP = [
  { deg: 70, r: 0.150, bite: 0.030 },   // feather, into the crown
  { deg: 45, r: 0.175, bite: 0.135 },   // the scoop
  { deg: 20, r: 0.090, bite: 0.062 },   // a nick where it ran out
];
// A bite deeper than its own circle puts that circle's centre INSIDE the stone,
// and then the subtraction is a hole rather than a scoop: the outline has no
// way to express it and the vertices fold out through the face as a flap. It is
// unmistakable in a render and worth failing quietly instead, so the depth is
// clamped here rather than trusted from the table above. A deep scoop is
// therefore also a wide one, which is true of real chips as well.
const MAX_BITE = 0.8;   // of the circle's own radius
// How far the three circles melt into each other. Zero leaves two visible
// creases where they cross, which is the one hard edge this piece must not
// have.
// Six circles at 0.055 blended into one long shallow bevel and the stone read
// as a shouldered design rather than a damaged one: a blend as wide as the gaps
// between the circles eats exactly the concavity that says "broken". Three
// circles, spaced, at half the blend.
const CHIP_BLEND = 0.032;

// --- the lean ---------------------------------------------------------------
//
// createTombstone applies its own seeded lean AFTER extras runs, straight onto
// `body`, so there is nothing to be gained by setting body.rotation here: it is
// overwritten a few lines later. Instead extras slips a group in between body
// and the meshes and leans THAT, and the set's own lean then composes on top of
// it. So the total is this plus up to about 0.022 either way, which is the
// point: this stone is still a member of the set, it has just been leaning for
// a century longer.
const LEAN_Z = 0.125;   // about 7 degrees sideways
const LEAN_X = -0.035;  // and a little more of the backward tip the set already has
// Leaning about the foot lifts one corner of the plinth clear of the ground, so
// the whole thing is sunk by roughly what the lean lifts. It reads as settled
// rather than as floating, which is what an old stone does anyway.
const SINK = 0.052;

// ---------------------------------------------------------------------------
// the face
//
// INK BUDGET. The measured tell on the approved stones is 5 to 10% of the face
// covered; the rejected set ran 12 to 19%. A crack counts as ink and a long one
// spends more than it looks like it should, so it is paid for out of the same
// purse as the lettering: the inscription starts as the cross stone's, which is
// inside the band on its own, and the wear pass then takes back more than the
// crack adds.

const SERIF_SIZE = 0.135;   // of face height, the cross stone's own number

// A crack, as a filled ribbon rather than a stroked line, because a stroke is
// one width everywhere and a crack is a sliver: nothing at the ends, widest
// somewhere in the middle, and never the same for long.
//
// Points are fractions of the face. It starts at the lip of the missing corner,
// which is the whole story of the piece in one line: the stone broke, and the
// break ran on down through it.
//
// The run matters more than the width. Drawn first as a long sweep from the
// break down the left side and away to the right edge, it cut a triangle off
// the bottom-left corner of the face, and a mark that fences off a corner stops
// being a line and becomes the boundary between two planes: the render came
// back with what looked like a peeled flap, which is the postmortem's
// competing-planes failure done in ink instead of geometry. Down and across,
// leaving the face in two big pieces and running off the bottom edge, it is a
// crack again.
const CRACK = [
  [0.838, 0.284],
  [0.778, 0.392],
  [0.732, 0.520],
  [0.704, 0.652],
  [0.628, 0.790],
  [0.530, 0.918],
  [0.452, 1.020],
];
// A short second leg off the main run. One branch, not three: a net of cracks
// is a shattered windscreen, and this stone is meant to be old, not hit.
const BRANCH = [
  [0.724, 0.556],
  [0.804, 0.658],
  [0.870, 0.724],
];

// Where the inscription has gone. Soft erasers, hand placed rather than
// scattered by a seed, because which letters survive is the one thing on this
// stone the eye actually reads. `soft` is where the eraser starts to fade, as a
// fraction of its radius; `a` is how much it takes at full strength, so a value
// under 1 thins a mark instead of removing it.
//
// The damage is all down the right of the face, with the crack and the missing
// corner: one side of this stone took the weather, which is what makes it look
// like a thing that happened rather than a texture that was applied. What is
// left of R.I.P. is R.I., which is the read: enough to know what it said and
// not enough to have said it.
const WEAR = [
  { x: 0.700, y: 0.545, r: 0.135, soft: 0.22, a: 1.00 },  // the P, gone
  { x: 0.610, y: 0.560, r: 0.080, soft: 0.35, a: 0.90 },  // and the stop before it
  { x: 0.300, y: 0.556, r: 0.090, soft: 0.30, a: 0.70 },  // the R, half eaten
  { x: 0.602, y: 0.300, r: 0.095, soft: 0.30, a: 0.90 },  // the cross's right arm
  { x: 0.500, y: 0.395, r: 0.080, soft: 0.35, a: 0.75 },  // the foot of it
  { x: 0.440, y: 0.196, r: 0.070, soft: 0.40, a: 0.55 },  // a thin patch at the head
  { x: 0.394, y: 0.500, r: 0.055, soft: 0.45, a: 0.45 },  // a nibble, low contrast
];

// Catmull-Rom through the control points, so the crack curves instead of
// turning corners. Corners in a crack read as a lightning bolt from a sticker
// sheet.
function spline(cp, n) {
  const at = (i) => cp[Math.max(0, Math.min(cp.length - 1, i))];
  const out = [];
  for (let s = 0; s < cp.length - 1; s++) {
    const p0 = at(s - 1);
    const p1 = at(s);
    const p2 = at(s + 1);
    const p3 = at(s + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(cp[cp.length - 1].slice());
  return out;
}

// One crack, filled. `wide` is the widest the sliver ever gets, in pixels.
//
// The width runs to zero at both ends, so the tips are points and need no cap,
// and it wanders on the way: a constant-width ribbon with tapered ends is a
// leaf, and a leaf on a headstone is not a crack.
function ribbon(ctx, ctrl, w, h, wide, phase) {
  const pts = spline(ctrl.map(([x, y]) => [x * w, y * h]), 14);
  const n = pts.length;
  const half = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Fat over most of the run and pointed at the ends. The exponent is low so
    // the fat part is broad: at 1 the whole thing is a lens and the middle is
    // the only part wide enough to survive the groove treatment.
    const taper = Math.pow(Math.sin(Math.PI * t), 0.45);
    const wobble = 0.66 + 0.34 * Math.sin(t * 15.7 + phase) * Math.sin(t * 6.1 + phase * 1.7);
    half.push((wide * taper * wobble) / 2);
  }
  const nx = [];
  const ny = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    nx.push(-dy / len);
    ny.push(dx / len);
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](pts[i][0] + nx[i] * half[i], pts[i][1] + ny[i] * half[i]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(pts[i][0] - nx[i] * half[i], pts[i][1] - ny[i] * half[i]);
  ctx.closePath();
  ctx.fill();
}

// The marks. Black on clear, and everything painted here is read as cut into
// the stone.
function carve(ctx, w, h) {
  // The cross stone's inscription, at the cross stone's numbers. This is the
  // point of the piece: same marks, a hundred years later.
  inkCross(ctx, w / 2, h * 0.28, h * 0.22);
  inkText(ctx, 'R.I.P.', w / 2, h * 0.55, h * SERIF_SIZE, h * 0.011);

  // The weather. destination-out with a soft edge, so a mark does not vanish at
  // an outline: it thins, goes shallow, and then it is gone, which is what a
  // worn carving does. Anything left at partial alpha comes out of the
  // treatment as a shallower groove for free.
  ctx.globalCompositeOperation = 'destination-out';
  for (const e of WEAR) {
    const r = e.r * h;
    const g = ctx.createRadialGradient(e.x * w, e.y * h, r * e.soft, e.x * w, e.y * h, r);
    g.addColorStop(0, `rgba(0,0,0,${e.a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(e.x * w, e.y * h, r, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';

  // The crack last, so the weather does not eat it. Wear is a century of rain
  // on a carving; the crack is what happened to the stone itself, and it is the
  // one mark on this face that is meant to be crisp.
  //
  // Widest at about 2.5% of the face, a shade over eighteen texels: under
  // seventeen the groove's two lips overlap and a cut reads as a smudge, so the
  // middle of the run has to clear that even though the tips deliberately do
  // not.
  ribbon(ctx, CRACK, w, h, w * 0.025, 0.0);
  ribbon(ctx, BRANCH, w, h, w * 0.016, 2.3);
}

// ---------------------------------------------------------------------------
// the break
//
// The slab is a convex outline swept front to back through a quarter-round
// edge, and the reason it has no seams is that every ring of that sweep is the
// SAME outline inset by a known amount, so each vertex's normal is known
// analytically. A chip has to survive that, and a circle subtracted from the
// outline does, exactly:
//
//     inset(A minus B, d) = inset(A, d) minus dilate(B, d)
//
// so the family of inset outlines is still analytic: the same corner circles
// with radii reduced by d, minus the chip circles with radii INCREASED by d.
// That last sign is the whole reason this looks right. Near the front face,
// where d is largest, the chip is at its widest, which is precisely the rounded
// lip the quarter-round gives every other edge on the stone. The break is
// rounded by the same rule as the arch, not by a fudge.
//
// So this does not rebuild the slab. It moves the vertices that the chip
// swallowed out onto the chip's surface, where the sweep would have put them if
// the outline had had a bite in it all along, and rewrites their normals to
// match. Each vertex's own inset d is recovered from its z, and its two sweep
// factors are recovered from the length of its existing normal, so nothing here
// has to know how the slab was tessellated.
//
// What was tried first and is wrong: projecting vertices out of a SPHERE. A
// sphere is not a prism, so it moves front-face vertices forward out of the
// slab instead of trimming them, and the flat front is one fan from its centre
// with no interior tessellation, so it came back as a funnel with the
// inscription smeared into it. A break through a slab goes through the whole
// thickness anyway.

const smin = (a, b, k) => {
  const t = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - t * t * k * 0.25;
};

// Distance to the chip, at an outline inset of d. Negative inside.
function chipField(x, y, d, circles) {
  let f = 1e9;
  for (const c of circles) f = smin(f, Math.hypot(x - c.x, y - c.y) - (c.r + d), CHIP_BLEND);
  return f;
}

// How far this ring of the sweep is inset from the silhouette, from its z
// alone. The profile is a quarter circle of radius e: z = hz - e + e*cos(a) and
// inset = e*(1 - sin(a)), so cos(a) falls straight out of z.
function insetAt(z, hz, e) {
  const c = (Math.abs(z) - (hz - e)) / e;
  if (c <= 0) return 0;
  const cc = Math.min(1, c);
  return e * (1 - Math.sqrt(1 - cc * cc));
}

function chipSlab(slab, { W, H, D, e, slabUV }) {
  const geo = slab.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const hz = D / 2;
  const archY = H - W;
  const circles = CHIP.map((c) => {
    const a = (c.deg * Math.PI) / 180;
    const dist = W + c.r - Math.min(c.bite, c.r * MAX_BITE);
    return { x: Math.cos(a) * dist, y: archY + Math.sin(a) * dist, r: c.r };
  });

  const EPS = 1e-4;
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    let x = x0;
    let y = y0;
    const z = pos.getZ(i);
    const d = insetAt(z, hz, e);
    if (chipField(x, y, d, circles) >= 0) continue;

    // Walk out to the surface. The field is very nearly a distance function, so
    // a handful of Newton steps along its gradient lands on it.
    let gx = 0;
    let gy = 0;
    for (let k = 0; k < 5; k++) {
      const f = chipField(x, y, d, circles);
      gx = (chipField(x + EPS, y, d, circles) - chipField(x - EPS, y, d, circles)) / (2 * EPS);
      gy = (chipField(x, y + EPS, d, circles) - chipField(x, y - EPS, d, circles)) / (2 * EPS);
      const g2 = gx * gx + gy * gy;
      if (g2 < 1e-9) break;
      x -= (f * gx) / g2;
      y -= (f * gy) / g2;
    }
    const gl = Math.hypot(gx, gy) || 1;
    pos.setXY(i, x, y);

    // The sweep's own two factors, recovered from the normal that is already
    // there: how much of it lies in the face plane, and how much points front
    // or back. Only the direction within the plane changes, and it now points
    // into the scoop.
    const ns = Math.hypot(nor.getX(i), nor.getY(i));
    if (ns > 1e-6) nor.setXY(i, (-gx / gl) * ns, (-gy / gl) * ns);

    // Front-mapped vertices carry the inscription's planar UVs, and a vertex
    // that has moved has to be remapped or it drags the texture into the break.
    // Everything else is parked in the plain strip and does not care.
    const was = slabUV(x0, y0, true);
    if (Math.abs(uv.getX(i) - was[0]) < 1e-5 && Math.abs(uv.getY(i) - was[1]) < 1e-5) {
      const now = slabUV(x, y, true);
      uv.setXY(i, now[0], now[1]);
    }
  }

  pos.needsUpdate = true;
  nor.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeBoundingSphere();
}

registerStone('cracked', {
  shape: SHAPE,
  draw: carve,
  extras({ body, shape, halfWidth, height, edge, slabUV }) {
    // The slab is the mesh standing on the plinth; the plinth itself is at zero
    // and keeps every corner it was cast with.
    const slab = body.children.find((m) => m.isMesh && m.position.y > 1e-6);
    if (slab) chipSlab(slab, { W: halfWidth, H: height, D: shape.depth, e: edge, slabUV });

    // The lean. A group slipped in under body, because body's own rotation is
    // set after this returns and would overwrite anything put on it here.
    const tilt = new THREE.Group();
    for (const child of [...body.children]) tilt.add(child);
    tilt.rotation.z = LEAN_Z;
    tilt.rotation.x = LEAN_X;
    tilt.position.y = -SINK;
    body.add(tilt);
  },
});
