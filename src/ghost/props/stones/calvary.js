import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';

// The calvary: a free-standing Latin cross on a tapered pedestal, standing on
// three square steps.
//
// Two stones in this set already have a cross in them and neither is this one.
// `cross` is a cross INKED into the face of a rounded slab, so its cross is a
// hole in a stone; `celtic` is a ringed head on a shaft, so its cross is a
// wheel. Here the cross is a REAL OBJECT standing in the air with daylight in
// all four quadrants, and the thing under it is a pyramid of horizontal planes.
// Those are the two reads, and both of them are geometry rather than surface.
//
// The steps are the strongest differentiator in the piece and the reason it
// carries them. Nothing else in the set terraces horizontally, and this camera
// (29 degrees off the floor, ACES tone mapping, one high key) is the best
// possible camera for horizontal planes: every up-facing surface catches the
// key nearly square on and comes back as a bright band, so three of them
// stacked read as three even at 70 pixels, where a vertical moulding of the
// same size reads as nothing at all.
//
// The trap the steps set is that a constant ratio makes a wedding cake. Real
// calvary steps lose tread much faster than they lose rise, because the tread
// is what carries the eye up and the rise is only what holds the tread. So the
// two ratios here are deliberately different, and they are stated rather than
// eyeballed:
//
//   tread (the shelf each step shows all round)  0.105, 0.080, 0.060
//                                       ratio          0.762, 0.750
//   rise  (the height of each step)              0.125, 0.112, 0.100
//                                       ratio          0.896, 0.893
//
// Tread falls at about 0.76 a step, rise at about 0.89. Four passes were run at
// a shared ratio near 0.85 and every one of them read as a cake: the treads
// were still wide at the top, so the top step looked like it was holding a
// cake board rather than a monument. Splitting the two ratios is what makes the
// stack read as architecture. The tread is the same number in x and in z, so
// the shelf is a constant width all the way round and the camera's 45 degrees
// in plan sees the same step on both visible faces.
//
// The ink goes on the pedestal and nowhere else. A silhouette this strong gets
// no second thing competing with it (the registry's own postmortem is blunt
// about that, and celtic reached the same conclusion for the same reason), so
// the cross stays bare stone and the pedestal carries one short word.

// --- the stack --------------------------------------------------------------
//
// Half extents in x and z, and the rise, for each step from the ground up.
// Depth trails width by the same 0.055 at every level, so the plan is a
// consistent 1.12:1 oblong rather than three unrelated rectangles.
const STEPS = [
  { hx: 0.520, hz: 0.465, rise: 0.125 },
  { hx: 0.415, hz: 0.360, rise: 0.112 },
  { hx: 0.335, hz: 0.280, rise: 0.100 },
];
const STEPS_TOP = STEPS.reduce((y, s) => y + s.rise, 0); // 0.337

// The rim on a step. Smaller than the slab's own 0.062 on purpose: this is the
// one place in the piece where a horizontal plane meets a vertical one and the
// meeting IS the read, so the arris is softened rather than rolled away. At
// the slab radius a 0.100 rise loses two thirds of its face to rounding and
// the three steps merge into one lump.
const STEP_EDGE = 0.038;
const STEP_CORNER = 0.075; // the rounding on the four vertical arrises in plan

// --- the pedestal -----------------------------------------------------------
//
// This is the registry's own slab, kept rather than thrown away. book.js and
// ledger.js both bin it, and they are right to: neither an open book nor a
// coffin slab is an upright block on a pad. A calvary's die IS an upright
// block, so binning it here would mean rebuilding the swept quarter-round
// outline, the slabUV front mapping and the whole two-map carving treatment by
// hand to arrive back at the same object. What goes instead is the PLINTH, and
// it goes by asking for none at all (`plinth: 0`), which the registry supports
// directly: the bottom step is the plinth, and the registry's fixed +0.075 by
// +0.065 overhang is not the tread this design wants.
//
// 0.55 by 0.50 gives an 1126 x 1024 face canvas, near enough square and well
// inside the range the engraving treatment works in.
const W = 0.275;
const H = 0.50;
const D = 0.44;
// The die tapers 2.6 degrees, which is obelisk's number and was chosen there
// because 2 did not survive being 200 px tall on screen. Linear in y, and it
// has to be: the slab has vertices only where its outline curves, so its long
// straight sides are one quad end to end and anything with a knee in it gets
// smeared over the whole block.
const TAPER = 0.09;
const scaleAt = (y) => 1 - TAPER * (y / H);
// The die is set INTO the top step rather than stood on it. 0.035 is well over
// the key light's 0.006 normalBias, under which a tenon makes the block it
// sits in shadow itself in a dotted band that looks exactly like z-fighting.
const DIE_BURY = 0.035;
const DIE_TOP = STEPS_TOP - DIE_BURY + H; // 0.802

// --- the cross --------------------------------------------------------------
//
// 1.82 overall, which puts it with the obelisk's 1.85 and the stele's 1.73 in
// the tall group and a clear 0.20 over celtic's 1.62. It must still read as a
// cross and not as a spire, and the number that decides that is the span: at
// 0.670 across a 1.018 rise above the pedestal the head is 0.66 as wide as it
// is tall, which is a Latin cross's own proportion. The camera is 45 degrees
// round in plan, so an arm along x is seen at about 0.79 of its true length;
// the span is set from what it measures ON SCREEN, not on paper.
const TOP = 1.820;
const ARM_L = 0.335; // half span of the cross bar
const YC = 1.480; // the crossing, i.e. the centre line of the bar

// The upright runs in one piece from inside the pedestal to the top, so the
// shaft and the head are the same stone and no joint shows at the crossing.
const SHAFT_BURY = 0.070; // below the pedestal's top face, clear of its 0.062 shoulder
const SHAFT_Y0 = DIE_TOP - SHAFT_BURY;
const SHAFT_HX = 0.134; // half width where it leaves the pedestal, so 0.268 through
const SHAFT_HZ = 0.118;
const SHAFT_LEAN = 0.026; // radians off vertical: the upright's taper, 1.5 degrees

// Each arm is its own solid running from inside the upright outward, which is
// what lets one limb builder make all three members. 0.232 thick at the
// crossing and never under 0.219 where it leaves the upright: the brief's floor
// is 0.13 and the rim radius sets a hard 0.124, but an arm under about 0.16
// simply loses itself against the floor behind it at scene size, so these are
// half again that.
const ARM_HX = 0.116; // half thickness at the crossing (vertical, once placed)
const ARM_HZ = 0.108; // half depth
const ARM_IN = 0.060; // how far past the centre line each arm starts, buried
const ARM_LEAN = 0.035; // radians: the arms taper twice as hard as the upright

// The rounding on the four long arrises of every member. Fat on purpose, 0.052
// against a 0.134 half width: this is the chamfer, and in a style with no
// knife edges in it a chamfer is a wide soft roll rather than a cut band.
const SHAFT_CORNER = 0.052;
const ARM_CORNER = 0.048;

// --- the ends ---------------------------------------------------------------
//
// The one detail that decides whether a stone cross looks cut or looks like
// three boxes glued together. Every limb ends the same way, in four sections
// each tangent to the last, working up the meridian:
//
//   1. the taper, straight;
//   2. a hollow cove that turns the taper from leaning IN to leaning OUT;
//   3. the flare, straight, 9 degrees the other way;
//   4. a quarter-round that rolls the end over, because nothing in this set
//      comes to a corner.
//
// The flare is 0.013, about a ninth of the limb's half width, so the end
// measures 0.245 where the limb behind it measures 0.219. That is small enough
// to read as cut stone and large enough to survive: on the 300 x 400 scene
// shot the whole end is about eleven pixels, and the difference between a
// belled end and a parallel one at that size is one pixel of overhang plus the
// shadow the overhang throws down the limb, which is what actually carries it.
const COVE_R = 0.090;
const FLARE = 0.16; // radians off vertical, the other way
const FLARE_L = 0.075; // its length along the meridian
const TIP_R = 0.050; // the arc that rolls the end over
const COVE_SEG = 5;
const TIP_SEG = 7;

// How much height one end costs, which is what the taper section has to leave
// room for. Derived rather than measured off a render: the cove's rise, plus
// the flare's, plus the tip arc's.
const endRun = (lean) =>
  COVE_R * (Math.sin(lean) + Math.sin(FLARE)) +
  FLARE_L * Math.cos(FLARE) +
  TIP_R * (Math.sin(FLARE) + 1);

// ---------------------------------------------------------------------------
// geometry
//
// A vertical sweep: one horizontal outline carried up a stack of rings, each
// ring a uniform scale of it. This is the third verbatim copy of obelisk.js's
// sweep in this directory (pyramid.js has the second), and the registry's own
// comment says three is a pattern. See the report.

// One horizontal outline: the point and the outline's outward normal there.
function planOutline(halfX, halfZ, corner, seg) {
  const c = Math.min(corner, Math.min(halfX, halfZ) * 0.999);
  const cx = halfX - c;
  const cz = halfZ - c;
  const out = [];
  for (const [ax, az, a0] of [
    [cx, cz, 0],
    [-cx, cz, Math.PI / 2],
    [-cx, -cz, Math.PI],
    [cx, -cz, Math.PI * 1.5],
  ]) {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (Math.PI / 2) * (j / seg);
      const hx = Math.cos(a);
      const hz = Math.sin(a);
      out.push({ px: ax + c * hx, pz: az + c * hz, hx, hz });
    }
  }
  return out;
}

// Sweep an outline up through rings. A ring is { y, s, inset, dy, ds, dInset }:
// the outline scaled by s, offset inward by `inset`, sat at height y, with the
// rest the meridian's tangent. For a point p with outward normal h,
//
//     n = ( h.x * dy,  dInset - ds * (h . p),  h.z * dy )
//
// which is the one line that makes a taper, a cove, a flare and a rolled end
// all the same function. Nothing here calls computeVertexNormals, so nothing
// here has a hard edge it did not ask for.
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
      push(
        r.s * p.px - r.inset * p.hx,
        r.y,
        r.s * p.pz - r.inset * p.hz,
        p.hx * r.dy,
        r.dInset - r.ds * (p.hx * p.px + p.hz * p.pz),
        p.hz * r.dy,
      );
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
    const centre = pos.length / 3;
    push(0, rings[0].y, 0, 0, -1, 0);
    for (let j = 0; j < N; j++) idx.push(centre, j, (j + 1) % N);
  }
  if (capTop) {
    const base = (rings.length - 1) * N;
    const centre = pos.length / 3;
    push(0, rings[rings.length - 1].y, 0, 0, 1, 0);
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
// the top and bottom rims. The rims are insets rather than scales, so the
// rounding is a true circular arc on all four sides however oblong the block.
// This is a step.
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

// One limb of the cross, built along +y from y0 to y1: a straight taper, then
// the cove, flare and rolled end described above. The arms are the same solid
// rotated a quarter turn about z, which is why this takes a length and not a
// direction.
function limbGeometry({ hx0, hz0, corner, y0, y1, lean, uv }) {
  const rings = [];
  const at = (h, y, phi) =>
    rings.push({ y, s: h / hx0, inset: 0, dy: Math.cos(phi), ds: -Math.sin(phi) / hx0, dInset: 0 });

  // 1. the taper, straight, so two rings carry it exactly.
  const yA = y1 - endRun(lean);
  const hA = hx0 - Math.tan(lean) * (yA - y0);
  at(hx0, y0, lean);
  at(hA, yA, lean);

  // 2. the cove. Concave, so its centre sits OUTSIDE the surface and the point
  //    is centre minus the radius along the outward normal, which is the one
  //    sign that separates a hollow from a bullnose.
  const cc = [hA + COVE_R * Math.cos(lean), yA + COVE_R * Math.sin(lean)];
  let h = hA;
  let y = yA;
  for (let k = 1; k <= COVE_SEG; k++) {
    const a = lean + (-FLARE - lean) * (k / COVE_SEG);
    h = cc[0] - COVE_R * Math.cos(a);
    y = cc[1] - COVE_R * Math.sin(a);
    at(h, y, a);
  }

  // 3. the flare, straight and tangent to both neighbours.
  h += FLARE_L * Math.sin(FLARE);
  y += FLARE_L * Math.cos(FLARE);
  at(h, y, -FLARE);

  // 4. the end, rolled over on a circle tangent to the flare.
  const tc = [h - TIP_R * Math.cos(FLARE), y + TIP_R * Math.sin(FLARE)];
  for (let k = 1; k <= TIP_SEG; k++) {
    const a = -FLARE + (Math.PI / 2 + FLARE) * (k / TIP_SEG);
    at(tc[0] + TIP_R * Math.cos(a), tc[1] + TIP_R * Math.sin(a), a);
  }

  return sweep({
    plan: planOutline(hx0, hz0, corner, 9),
    rings,
    capBottom: true, // buried, but a solid open at one end throws a holed shadow
    capTop: true, // the rolled end closes on a small flat, not on a point
    uv,
  });
}

// Lowest point of a geometry once a matrix is applied, walked vertex by vertex.
// Box3.setFromObject grows the local box by the rotation and trusts cached
// bounding boxes, so on a leaning stack a metre wide it hands back a tumbling
// cube's corner and the piece gets buried twice as deep as it needs.
function lowestVertex(geometry, matrix) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    if (v.y < min) min = v.y;
  }
  return min;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Park a geometry's UVs in the plain strip on the right of the face texture.
// Left alone, a sweep maps its own 0..1 across the whole atlas and drags the
// inscription round the outside of the cross. The band 0.70 to 0.98 is above
// the grime the steps sit in and clear of the strip's edges, so filtering can
// never reach the carved face. The gradient runs along the member's own axis,
// which for an arm means along the arm: that is only mottle, and one texel row
// stretched up a whole face is what the alternative looks like.
function parkUVs(geo, stripUV, y0, y1, span) {
  const pos = geo.attributes.position.array;
  const uv = geo.attributes.uv.array;
  for (let i = 0, p = 0; i < uv.length; i += 2, p += 3) {
    const v = 0.70 + 0.28 * clamp01((pos[p + 1] - y0) / (y1 - y0));
    const st = stripUV(pos[p], v, span, 1);
    uv[i] = st[0];
    uv[i + 1] = st[1];
  }
  geo.attributes.uv.needsUpdate = true;
}

// --- the mark ---------------------------------------------------------------
//
// One word, low on the die, and nothing anywhere else on the piece. PAX is the
// wayside calvary's own word and no other stone in the set carries it; three
// already carry a bare date, which is why this is not one.
//
// Sizing. The face is 1126 x 1024, so a font size of 0.27 of the face height
// is 0.135 in world units and a cap height of about 0.096, which sits inside
// the 0.09 to 0.12 the set uses and beside celtic's 0.115 and pyramid's 0.15.
// Matching letter SIZE is what matters here rather than matching a coverage
// number, because this face is narrower than the cross's and the same chisel
// covers more of it.
//
// The die tapers, so the texture is squeezed horizontally as it climbs and the
// letters narrow with it. obelisk.js undoes that on its star; here it is left
// alone deliberately. The taper is 0.09 over the full height and the word sits
// at a fifth of it, so the squeeze at the baseline is 2 percent, which on a
// 615 px word is 12 texels spread across three letters and lands under half a
// pixel on screen. Correcting it would cost a transform in draw() and buy
// nothing measurable.
const WORD = 'PAX';
const WORD_SIZE = 0.27; // font size, in fractions of the face height
const WORD_ROW = 0.53; // baseline, in fractions of the face height down from the top

// The visible band of the die is v 0.07 to 0.876: the bottom 0.035 is buried in
// the top step and the top 0.062 rolls over into the shoulder the cross stands
// on. The word is centred on THAT band rather than on the canvas.

// ---------------------------------------------------------------------------

registerStone('calvary', {
  // plinth 0 means no plinth, which the registry supports directly. The bottom
  // step is this stone's plinth and it is built here, because the registry's
  // is a fixed +0.075 by +0.065 overhang and the whole design is in the three
  // treads being 0.105, 0.080 and 0.060 the same amount all round.
  shape: { halfWidth: W, height: H, depth: D, plinth: 0 },
  // Both ends squared off, down to the rim radius the registry clamps at. A
  // die is a plain block between a step and a cross: an arch on top of it would
  // be a third idea, and a rounded foot would round the block away exactly
  // where the top step wraps it.
  topRadius: 0,
  bottomRadius: 0,

  draw(ctx, w, h) {
    const size = h * WORD_SIZE;
    inkText(ctx, WORD, w / 2, h * WORD_ROW, size, size * 0.05);
  },

  extras({ body, slab, material, rng, disposables, stripUV, lean }) {
    const add = (parent, geo) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      disposables.push(geo);
      return mesh;
    };

    // --- the die -------------------------------------------------------------
    //
    // The registry stood its slab on a plinth of zero, so it is sitting on the
    // floor. Lift it onto the steps and sink it into the top one, then taper
    // it.
    slab.position.y = STEPS_TOP - DIE_BURY;

    // The taper is applied to the slab's own vertices because
    // buildSlabGeometry sweeps a CONSTANT section and cannot be asked for one.
    // Scaling x and z by scaleAt(y) keeps the front face a plane (a plane
    // leaning back 2.6 degrees, which is what the front of a die is) and keeps
    // every rounded edge round, because the outline is a Minkowski sum and a
    // uniform scale of it is exact.
    //
    // Normals are re-derived rather than left alone. The correct transform is
    // the inverse transpose of the deformation's Jacobian, which for a
    // y-dependent uniform scale reduces to tilting the horizontal normals up by
    // the lean and leaving the up-facing ones alone.
    {
      const pos = slab.geometry.attributes.position;
      const nor = slab.geometry.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const s = scaleAt(y);
        const x = pos.getX(i) * s;
        const z = pos.getZ(i) * s;
        pos.setXYZ(i, x, y, z);
        const nx = nor.getX(i);
        const ny = nor.getY(i);
        const nz = nor.getZ(i);
        const my = s * ny + ((TAPER / H) / s) * (x * nx + z * nz);
        const l = Math.hypot(nx, my, nz) || 1;
        nor.setXYZ(i, nx / l, my / l, nz / l);
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      slab.geometry.computeBoundingSphere();
    }

    // --- the steps -----------------------------------------------------------
    //
    // All three are mapped through the plinth's own band of the texture: the
    // whole stack is squeezed into the bottom fifth of the strip, which is the
    // fifth the registry's plinths sample and where the ground grime lives. So
    // the bottom step is the grimiest thing on the piece and the top step is
    // already coming clean, which is what a base standing in wet grass does,
    // and no up-facing slab of clean stone can read as a whiter material than
    // the die above it.
    const GRIME = 0.2;
    const stepUV = (span) => (x, y) => stripUV(x, y, span, STEPS_TOP, GRIME);
    let y0 = 0;
    let bottomStep = null;
    for (const s of STEPS) {
      const mesh = add(
        body,
        roundedBlock({
          halfX: s.hx,
          halfZ: s.hz,
          height: s.rise,
          edge: STEP_EDGE,
          corner: STEP_CORNER,
          y0,
          uv: stepUV(s.hx),
        }),
      );
      bottomStep = bottomStep || mesh;
      y0 += s.rise;
    }

    // --- the cross -----------------------------------------------------------
    //
    // Per seed, three knobs, all small and none of them able to turn the piece
    // into a different design: a little more or less headroom, a little more or
    // less span, and a couple of degrees of yaw on the cross alone, as if it
    // had been set on the die by hand and never quite squared. The yaw is the
    // one that shows most, because it changes how much of each arm the camera
    // gets, and it is why two of these in one graveyard are not one casting
    // twice.
    const top = TOP + (rng() - 0.5) * 0.06;
    const armL = ARM_L * (1 + (rng() - 0.5) * 0.08);
    const cross = new THREE.Group();
    cross.rotation.y = (rng() - 0.5) * 0.09;
    body.add(cross);

    const upright = limbGeometry({
      hx0: SHAFT_HX,
      hz0: SHAFT_HZ,
      corner: SHAFT_CORNER,
      y0: SHAFT_Y0,
      y1: top,
      lean: SHAFT_LEAN,
      uv: () => [0, 0], // replaced wholesale by parkUVs below
    });
    parkUVs(upright, stripUV, SHAFT_Y0, top, SHAFT_HX);
    add(cross, upright);

    // Each arm is built along +y from inside the upright outward, then laid
    // over a quarter turn. Two solids rather than one bar through the middle,
    // because a bar would need its own mirrored meridian to flare at both ends
    // and this way the same builder makes all three members. The joint is
    // 0.060 inside the upright, which at the crossing is 0.232 wide, so both
    // caps are buried well past the 0.006 the shadow bias needs.
    for (const side of [1, -1]) {
      const geo = limbGeometry({
        hx0: ARM_HX,
        hz0: ARM_HZ,
        corner: ARM_CORNER,
        y0: -ARM_IN,
        y1: armL,
        lean: ARM_LEAN,
        uv: () => [0, 0],
      });
      parkUVs(geo, stripUV, -ARM_IN, armL, ARM_HX);
      const arm = add(cross, geo);
      // -90 about z sends the limb's own +y to +x and its own +x to -y, so the
      // half width the taper works on becomes the arm's thickness.
      arm.rotation.z = side * -Math.PI / 2;
      arm.position.y = YC;
    }

    // --- seating -------------------------------------------------------------
    //
    // The registry decides the lean before extras runs and applies it after, so
    // the sink can be measured here instead of guessed. It has to be: the
    // bottom step's footprint half diagonal is 0.698, and the lean reaches
    // 0.032 radians in x and 0.022 in z, which lifts a far corner up to 0.024
    // clear of the floor. The registry's own 0.012 sink does not cover that,
    // and a stone with one corner of its bottom step hanging in the air is the
    // exact failure the chest tomb and the kerbed plot each had to solve.
    //
    // So the lean is built as a matrix, the bottom step's vertices are walked
    // under it, and the sink is whatever puts the lowest one MIN_SINK under the
    // floor. Never less than the registry's own, so this can only ever bury the
    // piece deeper than the default, not float it.
    const MIN_SINK = 0.014;
    const m = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(lean.enabled ? lean.x : 0, 0, lean.enabled ? lean.z : 0, 'XYZ'),
    );
    const low = lowestVertex(bottomStep.geometry, m);
    lean.sink = Math.min(lean.sink, -MIN_SINK - low);

    // No displaced earth and no contact patch. The set has been round both and
    // rejected them: a patch laid flat on the floor is the same on every side
    // of the stone, so it rings the piece with a halo that is there on the lit
    // side too. The key light casts the only shadow this has, and on this piece
    // it is doing real work, because the three treads throw three of them.
  },
});
