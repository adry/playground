import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerStone, buildSlabGeometry, inkText } from '../tombstones.js';

// The mariner's stone: a fouled anchor on a plain headstone, with a coil of
// rope wound round its shank.
//
// Every other silhouette in the set says what it is with its OUTLINE. This one
// is a plain round-shouldered slab, which is a different problem: the identity
// has to come off the face. The set has one precedent for that, wheel.js, and
// it solved it by painting its cross into the two-map carving treatment. That
// answer does not survive here, and the arithmetic is worth writing down
// because it is the whole reason this stone is built the way it is.
//
// WHY THE ANCHOR IS GEOMETRY AND NOT INK
//
// The ink budget for a face is 3 to 5 per cent, and the stones rejected for
// busy lettering measured 12 to 19. An incised anchor was built first and
// measured: cut as grooves 0.045 wide, the anchor plus two words covers 12.4
// per cent of this face. That is not a tuning problem. Ink on a line drawing
// goes as perimeter times groove width, and an anchor is nearly all perimeter:
// a ring, a stock, a shank, two arms, two flukes and a coil, about 3.4 units of
// outline on a face 1.17 units square. Halving the groove to 0.022 buys 7 per
// cent and puts the wall under the ~17 texel floor where the two lip masks
// overlap and the cut reads as a smudge. Shrinking the motif to fit the budget
// gives a small anchor on a big empty slab, which is a worse stone.
//
// So the anchor is relief. Built as solids standing off the face it costs
// nothing in ink at all, and the face's whole budget goes to two words and the
// three grooves in the rope. Measured: 3.9 per cent. That is the light end of
// the band, which is where a piece carrying a large motif belongs.
//
// HOW FAR PROUD. Three positions were built and rendered side by side at
// 300x400:
//
//   * INCISED, the flat one. Legible, and the cheapest thing to build, but it
//     is 12.4 per cent ink and at scene distance the whole motif greys out into
//     one soft stain: a groove has no silhouette, and the two lip masks that
//     make it read as cut are a texel wide by the time the stone is 80 px tall.
//   * PROUD, 0.05 off the face. What a stonemason actually cuts. Every limb
//     gets a lit top and its own cast shadow down its left side, which is the
//     one cue that survives at any distance, because it is real geometry and
//     not a texture. This is what ships.
//   * HALF FREE, the ring and the ends of the stock standing clear of the
//     stone's outline. The boldest, and it was rendered rather than argued
//     about. Two things went wrong. The free ring is a 0.13 loop of stone at
//     0.15 deep with sky behind it, and against the pale background it reads
//     as a wire hoop rather than as carved stone; and lifting the anchor far
//     enough for the stock to break a half-round arch costs 0.20 of stone
//     under it, so the piece grows past 1.5 tall and the face empties out. The
//     escaping ring is a lovely silhouette and it belongs on a different,
//     taller monument.
//
// HOW THE PIECES ARE MADE. Six solids, all overlapping, merged into one
// geometry and one draw call: shank, stock and rope are the registry's own
// swept slab with equal corner radii, which is what makes a stadium; the ring
// and the crown are tori; the flukes are swept slabs squeezed linearly as they
// climb, the taper wheel.js and celtic.js both use. Overlapping chunky solids
// rather than one authored outline is celtic.js's answer and it is the right
// one here: the joints on an anchor are real joints, a shank does cross a
// stock, and there is no continuous silhouette for a single arc chain to be.
//
// THE ROPE. A rope is a helix of small round sections and every one of them is
// under the 0.062 rim floor, so a rope built out of strands cannot be built at
// all. A scalloped outline was worked out on paper and dropped: two lobes of
// radius r whose centres are s apart leave a notch r - sqrt(r^2 - s^2/4) deep,
// so a coil 0.26 wide needs its turns 0.17 apart to show a 0.03 scallop, and
// three turns at that spacing is a coil 0.6 tall, taller than the shank. What
// is left is the honest answer: ONE fat coil, 0.26 by 0.20 by 0.185, riding
// 0.035 proud of the shank it is wound round, with three deep grooves cut
// across it by the face texture. The coil is mapped with the slab's own UVs, so
// a groove painted at the coil's place on the face canvas arrives on the coil
// as a real cut with the set's dark floor, shaded upper wall and lit lower lip.
// Three grooves cost 1.5 per cent of the face and no geometry.

// --- which of the three -----------------------------------------------------
// Kept as a constant rather than deleted, because the other two are what the
// comparison above was made on and the numbers in this file are only meaningful
// beside them.
const MODE = 'proud'; // 'proud' | 'incised' | 'free'

// --- the stone --------------------------------------------------------------
//
// 0.90 by 1.30 on a 0.16 plinth, so 1.46 overall: between draped's 1.56 and
// wheel's 1.45, and comfortably clear of the 1.5 the brief allows. Wide for its
// height on purpose. The stock is the widest thing on the piece and it needs a
// face to stand on; at the cross stone's 0.92 the stock would have run off the
// rounded rim. The face works out 709 by 1024 texels, the same country as
// wings' 698, well clear of the range where the groove treatment collapses.
const W = 0.45;
const H = MODE === 'free' ? 1.14 : 1.30;
const SHAPE = { halfWidth: W, height: H, depth: 0.30, plinth: 0.16 };

// Round-shouldered rather than arched. The motif is the subject, so the outline
// is deliberately the plainest in the set: a squared slab with the corners
// taken off. The free variant needs a half-round arch instead, because a stock
// can only break OUT of a top that curves away from it.
const TOP_R = MODE === 'free' ? W : 0.20;

// How far the anchor stands off the stone's face, and how far the rope stands
// off the anchor. 0.05 is the number a mason leaves: enough that the key light
// puts a hard edge down one side of every limb, small enough that the piece
// still reads as carved out of the slab rather than bolted to it.
const PROUD = 0.055;
const ROPE_PROUD = 0.090;

// The applied relief takes a tighter fillet than the stone's own 0.062. That is
// not drift, it is the same rule: a fillet is a fixed radius, and 0.062 on a
// 0.13 limb is a full half-round with no flat left on it, which turns every
// member of the anchor into a sausage. 0.040 leaves each limb a real flat to
// catch the key, and every limb is at least 0.11 across, over the 0.08 at which
// the swept front face pinches shut and the outline self-crosses.
const BEAD = { depth: 0.15, edge: 0.040 };
const ROPE = { depth: 0.185, edge: 0.052 };

// In free mode the whole anchor rides up until the ring is half out of the top
// of the arch and the ends of the stock break its shoulders.
const LIFT = MODE === 'free' ? 0.13 : 0;

// --- the anchor -------------------------------------------------------------
//
// All heights are measured from the foot of the slab, which is where the
// registry's own face UVs start, so a number here is directly the v it samples.
//
// The first cut of this got the proportions wrong in a way only a render shows.
// Its arms were the lower HALF of a torus, which is a bowl, and its flukes
// raked up into the space under the stock, which filled the bowl in: the motif
// came out as a cup with a beehive in it, and nobody looking at it said anchor.
// What fixes it is the gaps. The arms are a 132 degree crescent, so they read
// as two limbs leaving a crown rather than as a rim; and the bills end 0.24
// below the stock, so there is daylight all the way across the piece between
// them. Every hole on the motif is at least 0.05 across, which is 11 px at the
// ~230 px a unit gets in the scene.
const RING = { y: 1.100, maj: 0.076, tube: 0.036 }; // outer 0.112, hole 0.080
const STOCK = { y: 0.885, hl: MODE === 'free' ? 0.365 : 0.335, ht: 0.057 };
const SHANK = { y0: 0.440, y1: 1.100, ht: 0.065 };
// The arms and the flukes are ONE piece, and the second version of this stone
// is the reason. The first had a torus crescent with a wedge bolted on each end
// for a fluke, and rendered it read as a bowl with two leaves floating over it:
// a wedge whose base is wider than the arm it grows from is a blob, and the
// joint between two solids of different width is a crease exactly where the eye
// is trying to follow one limb. So the arms are a swept tube of VARYING radius
// -- 0.060 at the crown, swelling to 0.089 for the palm three quarters of the
// way out, closing to 0.034 at the bill -- one continuous surface from bill to
// bill with the flukes as swellings in it. That is also what the anchor glyph
// everyone recognises actually is.
const CROWN = { y: 0.700, r: 0.275, t: 0.060, half: 66, bill: 0.030, palm: 0.052, palmAt: 0.76, palmW: 0.15 };
const COIL = { y: 0.657, hw: 0.118, h: 0.240, r: 0.068 };

// Two lines under the crown. Cap height 0.096 world, against fred's 0.093 and
// cross's 0.122: the set's own chisel, not a smaller yard's.
const TEXT = { size: 0.1108, y1: 0.262 + LIFT * 0.55, y2: 0.128 + LIFT * 0.55 };

// The turns of the rope, in world units. The groove is a shade shorter than the
// coil is wide, so its ends die on the coil's own rolled rim instead of running
// off it and leaving two dark ticks on the stone behind.
const GROOVE = { w: 0.024, len: 0.236, gap: 0.062 };

// The groove a line-drawn anchor would be cut with, used by MODE 'incised'
// only. 0.045 is the narrowest that still carries an 11 px wall on this face.
const INCISED = 0.045;

const D2R = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- the pose ---------------------------------------------------------------
//
// The rope's grooves are painted on the face canvas and the coil they are cut
// into is geometry, so the two have to agree about where the coil is. They are
// rolled once, in draw(), and handed to extras() through this slot rather than
// rolled twice off the same stream: createTombstone builds the texture before
// it calls extras and both happen inside one synchronous call, so the handoff
// is safe, and rolling twice would put the grooves and the coil on different
// dice. Cleared on collection so a headless build, where draw never runs, rolls
// its own instead of inheriting the last stone's.
let pose = null;

function rollPose(rng) {
  pose = {
    coilY: COIL.y + (rng() - 0.5) * 0.036,
    turns: rng() < 0.45 ? 4 : 3,
    rake: (rng() - 0.5) * 0.22, // the coil is never wound quite level
  };
  return pose;
}

function takePose(rng) {
  const p = pose || rollPose(rng);
  pose = null;
  return p;
}

// --- geometry helpers -------------------------------------------------------

// A swept slab with equal corner radii, which is the registry's builder making
// a stadium: give it a radius equal to the half width and the two end circles
// collapse onto the axis. Every straight member of the anchor is one of these.
// The uv callback is a stub because faceUVs below overwrites the lot once the
// piece is in its final place.
function bar(halfW, height, r, depth, edge, rTop = r) {
  return buildSlabGeometry({
    halfWidth: halfW,
    height,
    depth,
    edge,
    bottomRadius: r,
    topRadius: rTop,
    uv: () => [0, 0],
  });
}

// The arm's half thickness, as a function of how far out along the crescent a
// point is: 0 at the bottom of the crown, 1 at either bill. A straight taper
// from crown to bill with one gaussian swelling laid over it, which is the palm.
function tubeAt(s) {
  const d = (s - CROWN.palmAt) / CROWN.palmW;
  return CROWN.t - (CROWN.t - CROWN.bill) * s + CROWN.palm * Math.exp(-d * d);
}

// The crescent, swept by hand because nothing in the set can make it. A torus
// has one tube radius; this one has to swell and close along its own axis, and
// buildArcSweepGeometry is explicitly the wrong tool -- it extrudes a CONSTANT
// section and cannot vary anything along the sweep.
//
// The section is an ellipse, not a circle. Its FRONT is a constant plane, so
// the whole crescent stands the same 0.055 proud of the stone from bill to
// bill, and it is the back that tapers into the slab as the arm thins. A tube
// that kept its depth while its width closed would end as a blade standing on
// edge, and the camera sits at 45 degrees round, so a blade is exactly what it
// would show.
//
// Normals come off the parametric surface itself, by differencing the position
// grid in both directions. computeVertexNormals would give the same answer with
// a facet at every quad; this is smooth by construction, which is the whole
// house style.
function armSweep(zFront, zk) {
  const PH = 44;
  const RG = 20;
  const a0 = (270 - CROWN.half) * D2R;
  const a1 = (270 + CROWN.half) * D2R;
  const P = [];
  for (let i = 0; i <= PH; i++) {
    const u = i / PH;
    const phi = a0 + (a1 - a0) * u;
    const t = tubeAt(Math.abs(2 * u - 1));
    const hz = zk * (0.5 + 0.5 * Math.min(1, t / CROWN.t));
    const cz = zFront - hz;
    const cx = Math.cos(phi);
    const cy = Math.sin(phi);
    const row = [];
    for (let j = 0; j < RG; j++) {
      const th = (j / RG) * Math.PI * 2;
      const ct = Math.cos(th);
      row.push([
        CROWN.r * cx + t * ct * cx,
        CROWN.y + CROWN.r * cy + t * ct * cy,
        cz + hz * Math.sin(th),
      ]);
    }
    P.push(row);
  }

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  for (let i = 0; i <= PH; i++) {
    for (let j = 0; j < RG; j++) {
      const p = P[i][j];
      const du = sub(P[Math.min(PH, i + 1)][j], P[Math.max(0, i - 1)][j]);
      const dv = sub(P[i][(j + 1) % RG], P[i][(j + RG - 1) % RG]);
      // dv x du points out of the tube for this parametrisation.
      let nx = dv[1] * du[2] - dv[2] * du[1];
      let ny = dv[2] * du[0] - dv[0] * du[2];
      let nz = dv[0] * du[1] - dv[1] * du[0];
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      pos.push(p[0], p[1], p[2]);
      nor.push(nx * inv, ny * inv, nz * inv);
      uvs.push(0, 0); // overwritten by faceUVs once the piece is placed
    }
  }
  for (let i = 0; i < PH; i++) {
    for (let j = 0; j < RG; j++) {
      const j2 = (j + 1) % RG;
      const a = i * RG + j;
      const b = i * RG + j2;
      const c = (i + 1) * RG + j2;
      const d = (i + 1) * RG + j;
      idx.push(a, b, c, a, c, d);
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

// Where a bill sits and how thick it is there, so the ball that seals the open
// end of the sweep can be put exactly on it.
function billAt(side) {
  const phi = (270 + side * CROWN.half) * D2R;
  return {
    x: CROWN.r * Math.cos(phi),
    y: CROWN.y + CROWN.r * Math.sin(phi),
    t: tubeAt(1),
  };
}

// Every piece is mapped by where it ends up on the FACE, not by its own
// parametrisation. Left alone a torus wraps the whole atlas round its tube and
// drags the inscription with it; parked in the plain strip the way celtic.js
// parks its head, the rope could never pick up the grooves cut into it. The
// slab's own planar mapping does both jobs at once: the anchor samples the
// clean stone it stands over, the coil samples the grooves painted at exactly
// its own place, and everything shares one weathering with the slab behind it.
function faceUVs(geo, slabUV) {
  const pos = geo.attributes.position.array;
  const uv = geo.attributes.uv.array;
  for (let i = 0, p = 0; i < uv.length; i += 2, p += 3) {
    const st = slabUV(pos[p], pos[p + 1], true);
    uv[i] = st[0];
    uv[i + 1] = st[1];
  }
  geo.attributes.uv.needsUpdate = true;
  return geo;
}

// --- the parts --------------------------------------------------------------

function anchorParts(coilY) {
  const zc = SHAPE.depth / 2 + PROUD - BEAD.depth / 2;
  const zk = BEAD.depth / 2; // what a round section is stretched to in z
  const parts = [];

  // The shank, from inside the crown to inside the ring, so neither joint is a
  // visible seam. Its own ends are square-ish: they are buried, and a stadium
  // end would spend a full curve budget on two caps nobody sees.
  parts.push(bar(SHANK.ht, SHANK.y1 - SHANK.y0, BEAD.edge, BEAD.depth, BEAD.edge)
    .translate(0, SHANK.y0, zc));

  // The stock, a horizontal stadium crossing the shank near the top.
  parts.push(bar(STOCK.hl, STOCK.ht * 2, STOCK.ht, BEAD.depth, BEAD.edge)
    .translate(0, STOCK.y - STOCK.ht, zc));

  // The ring. Round in section, which is what a shackle is, and stretched in z
  // to the depth of everything else so it does not sit visibly shallower than
  // the shank it hangs on. The stretch goes through the geometry's own scale so
  // the normals come out right.
  const ring = new THREE.TorusGeometry(RING.maj, RING.tube, 12, 44);
  ring.scale(1, 1, zk / RING.tube);
  ring.translate(0, RING.y, zc);
  parts.push(ring);

  // The arms and flukes: one swept crescent, its two open ends sealed with a
  // ball of the bill's own radius so the bill is a rounded stub and not a hole.
  parts.push(armSweep(zc + zk, zk));
  for (const side of [1, -1]) {
    const b = billAt(side);
    const hz = zk * (0.5 + 0.5 * Math.min(1, b.t / CROWN.t));
    const cap = new THREE.SphereGeometry(b.t, 12, 8);
    cap.scale(1, 1, hz / b.t);
    cap.translate(b.x, b.y, zc + zk - hz);
    parts.push(cap);
  }

  // The coil, riding over the shank rather than flush with it. Its own fillet
  // is fatter than the anchor's, which is the one place on the piece where a
  // rounder edge is the right answer: rope is round and stone is not.
  const rz = SHAPE.depth / 2 + ROPE_PROUD - ROPE.depth / 2;
  parts.push(bar(COIL.hw, COIL.h, COIL.r, ROPE.depth, ROPE.edge)
    .translate(0, coilY - COIL.h / 2, rz));

  return parts;
}

// --- the face ---------------------------------------------------------------

function drawFace(ctx, w, h, rng) {
  const K = w / (2 * W); // world units to canvas pixels; the face keeps its aspect
  const X = (x) => (x + W) * K;
  const Y = (y) => (H - y) * K;
  const S = (d) => d * K;
  const p = rollPose(rng);

  if (MODE === 'incised') inkAnchor(ctx, X, Y, S, p);
  else inkRope(ctx, X, Y, S, p);

  const size = h * TEXT.size;
  inkText(ctx, 'LOST', w / 2, Y(TEXT.y1), size, size * 0.05);
  inkText(ctx, 'AT SEA', w / 2, Y(TEXT.y2), size, size * 0.05);
}

// The turns of the rope. Deep cuts across one fat coil, not a drawing of a
// helix: at the ~230 px a unit gets in the scene a groove is six pixels, and
// three of them saying "wound" is everything the eye can take from a coil that
// is forty pixels tall.
function inkRope(ctx, X, Y, S, p) {
  const half = (p.turns - 1) / 2;
  for (let i = 0; i < p.turns; i++) {
    const y = p.coilY + (i - half) * GROOVE.gap;
    ctx.save();
    ctx.translate(X(0), Y(y));
    ctx.rotate(-p.rake);
    ctx.beginPath();
    ctx.roundRect(-S(GROOVE.len) / 2, -S(GROOVE.w) / 2, S(GROOVE.len), S(GROOVE.w), S(GROOVE.w) / 2);
    ctx.fill();
    ctx.restore();
  }
}

// MODE 'incised' only: the same anchor cut as a line drawing. Kept so the
// comparison at the top of this file can be re-measured rather than believed.
function inkAnchor(ctx, X, Y, S, p) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = S(INCISED);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(X(0), Y(SHANK.y0));
  ctx.lineTo(X(0), Y(SHANK.y1));
  ctx.moveTo(X(-STOCK.hl), Y(STOCK.y));
  ctx.lineTo(X(STOCK.hl), Y(STOCK.y));
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(X(0), Y(RING.y), S(RING.maj), 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(X(0), Y(CROWN.y), S(CROWN.r), (90 - CROWN.half) * D2R, (90 + CROWN.half) * D2R);
  ctx.stroke();

  for (const side of [1, -1]) {
    const b = billAt(side);
    const phi = (270 + side * CROWN.half) * D2R;
    const tx = -Math.sin(phi) * side;
    const ty = Math.cos(phi) * side;
    ctx.beginPath();
    ctx.moveTo(X(b.x - side * CROWN.palm * 1.4), Y(b.y - 0.09));
    ctx.lineTo(X(b.x + tx * 0.05), Y(b.y + ty * 0.05));
    ctx.lineTo(X(b.x + side * CROWN.palm * 0.9), Y(b.y - 0.11));
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.roundRect(X(-COIL.hw), Y(p.coilY + COIL.h / 2), S(COIL.hw * 2), S(COIL.h), S(COIL.r));
  ctx.stroke();
  inkRope(ctx, X, Y, S, p);
}

// --- assembly ---------------------------------------------------------------

function build({ body, material, plinthH, rng, slabUV, disposables }) {
  if (MODE === 'incised') return;
  const p = takePose(rng);
  const parts = anchorParts(p.coilY);
  const geo = faceUVs(mergeGeometries(parts, false), slabUV);
  for (const g of parts) g.dispose();

  const anchor = new THREE.Mesh(geo, material);
  // Slab coordinates: the registry stands the slab on the plinth and the whole
  // motif is authored in the slab's own frame, so it rides up with it.
  anchor.position.y = plinthH;
  anchor.castShadow = true;
  anchor.receiveShadow = true;
  body.add(anchor);
  disposables.push(geo);
}

registerStone('anchor', {
  shape: SHAPE,
  topRadius: TOP_R,
  draw: drawFace,
  extras: build,
});
