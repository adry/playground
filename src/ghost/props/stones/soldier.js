import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText, inkCross } from '../tombstones.js';

// The war grave: a plain upright tablet with a segmental head, a regimental
// badge standing proud at the top, three lines of small lettering and a plain
// cross low down.
//
// THIS IS THE ONE STONE IN THE SET WHOSE SUBJECT IS UNIFORMITY.
//
// Every other piece here is trying to be somebody. A war grave is deliberately
// identical to the ten thousand beside it: one width, one head, one badge, one
// rhythm of rank, name, date, cross. That is not a shortcut, it is the whole
// content of the object, and it changes three decisions that every other stone
// in this directory made the other way.
//
// 1. NOTHING ABOUT THE SHAPE VARIES PER SEED. Not the head, not the badge, not
//    the width, not the depth, not the position of a single line. rng touches
//    the rank, the name, the year and the mottle, and nothing else. cracked.js
//    varies its break, boulder.js varies its whole silhouette; this one is cast
//    from one mould on purpose, and a second instance beside the first has to
//    look like the same object twice.
//
// 2. THE ROLL IS DAMPED TO A FIFTH AND THE PITCH TO ABOUT HALF. See the note
//    over the extras() call. A row of these is the intended look, and a row is
//    exactly what a random roll destroys.
//
// 3. THE FACE CARRIES MORE TEXT THAN ANYTHING ELSE IN THE SET AND THE LETTERS
//    ARE SMALLER THAN THE SET'S. Three lines plus a cross plus a device inside
//    the badge, against the cross stone's one mark and one line. The way that
//    is paid for is size, not omission: see the block over LETTER below.
//
// WHY THE REGISTRY'S SLAB IS REPLACED RATHER THAN USED
//
// buildSlabGeometry puts the top corner circles at (+-(W - rt), H - rt), so the
// top of anything it builds is either a flat run between two corners or, at
// rt = W, a half round. A war grave's head is neither: it is a shallow
// segmental arc, radius about four times the stone's half width, meeting the
// vertical sides through a soft shoulder. The exported arc sweep can express
// that in five arcs, so the body is one arc sweep and the registry's slab is
// removed in extras, which is what vault.js, book.js and boulder.js already do.
//
// The offsetting lemma the whole file rests on survives the shoulder: the
// fillet circle is INTERNALLY tangent to the crown circle, distance between
// centres exactly CROWN_R - RS, and insetting both by the same d keeps that
// distance equal to (CROWN_R - d) - (RS - d). Every ring of the sweep is the
// same five arcs with smaller radii and the same centres, tangency intact, no
// normal averaged. Curvature only ever drops going over the shoulder, from
// 1/RS to 1/CROWN_R, so the outline stays convex and the front face
// triangulates.
//
// WHAT THE HEAD IS ACTUALLY WORTH, MEASURED
//
// The crown sags 29 mm from apex to shoulder across a 548 mm span. At scene
// size that is under two pixels, and a flat top with the same 0.09 shoulders
// would have been free. It is here because a row of three is the intended
// look, the tops line up, and two pixels repeated three times is the only
// shape cue this stone has. Set CROWN_R to something enormous to get the flat
// top back and compare; the numbers below all stay valid.

// --- the tablet ------------------------------------------------------------
//
// CWGC proportion is 2:1 tall to wide. Straight 2:1 on a 1.28 stone gives a
// 0.64 face, which at the texture's 1024 rows is a 512 px face, under the
// 528 px floor the engraving treatment was calibrated at. 0.69 by 1.28 is
// 552 px, inside the range, and 1.86:1 rather than 2:1, which no one will
// measure. The number that actually governs the carving is texels per world
// unit, 1024 / H = 800, against the approved cross's 747: this face is finer
// than the calibration, not coarser.
const W = 0.345;          // 0.69 across, the narrowest upright bar the gothic
const H = 1.28;           // 1.255 standing once the sink is taken off
const DEPTH = 0.19;       // thin. Only the cairn's slate and the kerb are less
const RB = 0.065;         // bottom corners, barely over the rim so the foot
                          // goes into the turf square rather than tapering
const RS = 0.09;          // the shoulder, where the side turns into the head
const CROWN_R = 1.30;     // the segmental top, just under 4 x the half width

// The head, all of it forced by the three numbers above.
//
// rise = CROWN_R - sqrt((CROWN_R - RS)^2 - (W - RS)^2), and it cannot go below
// RS however flat the crown is made: a shoulder fillet of radius RS already
// lifts the outline by its own radius. So RS is the coarse control of how tall
// the head is and CROWN_R only decides how much of that is curve.
const CROWN_D = Math.sqrt((CROWN_R - RS) ** 2 - (W - RS) ** 2); // centre to centre
const RISE = CROWN_R - CROWN_D;   // 0.117: apex above the springing
const Y_SPRING = H - RISE;        // 1.163: where the straight side ends
const CY = H - CROWN_R;           // the crown circle's centre, well below ground
const PHI = Math.atan2(Y_SPRING - CY, W - RS); // 77.8 deg, where crown meets fillet

// Sunk deep enough that the bottom rounding is under the turf, so the tablet
// reads as set into the ground rather than stood on it. Worst corner lift from
// the damped lean is about 3.4 mm against the 25 mm here.
const SINK = -0.025;

// --- the badge -------------------------------------------------------------
//
// The only ornament, and it carries the piece, so every decision about it was
// made against the 80 pixel test rather than against a photograph.
//
// It stands PROUD, it is not incised. A cut badge is a dark patch that the
// grime band and the mottle both compete with; a raised one has a lit top edge
// and a shadow under its bottom edge, which is two hard value steps in a place
// where the rest of the stone has none. At 80 px the whole badge is 21 px tall
// and everything inside it is texture, so what has to survive is the OUTLINE
// and the value step, and both do.
//
// It is a heater shield, drawn as the convex hull of three circles: one at each
// top corner and one at the point. That construction is worth naming because it
// makes the outline an arc chain with straight runs between, tangent by
// construction, which is exactly what buildArcSweepGeometry wants and exactly
// what a hand-authored shield outline gets wrong.
//
// Its rim is 0.022 and not the house's 0.062. That is the same move stele.js
// makes for its palmette and obelisk.js for its pyramidion: a small applied
// piece is a thinner slab set on the face, and it gets a rim in proportion to
// itself. 0.062 on a shield 0.34 across would have rounded the point away.
const BADGE = {
  cy: 0.985,      // centre height on the face, tucked just under the crown
  hw: 0.17,       // half width, so 0.34 across against the face's 0.69
  half: 0.17,     // half height
  ra: 0.05,       // the two top corners
  waist: 0.03,    // where the vertical sides stop and the flanks start, off cy
  rt: 0.026,      // the point
  depth: 0.10,    // the plate's own thickness
  edge: 0.018,    // its own rim, and it has to stay under rt or the point cusps
  proud: 0.035,   // how far it stands off the face
};

// The device inside the shield: two crossed blades, and nothing else.
//
// A wreath is out by the brief and by arithmetic: a leaf that reads at 80 px is
// 4 px across, and eight of them round a ring is a dark annulus. A crown is
// five shapes and a scallop. A single upright sword lost to the plain cross
// lower down the face, because at scene size a vertical bar with a crossguard
// and a vertical bar with a crossarm are the same 6 by 10 px mark twice. Two
// diagonals are not that mark: they are the only diagonals on the whole stone.
//
// Sized off the shield's own flanks rather than off its bounding box. The first
// version was laid out against the 0.17 half width, on a shield whose flanks
// were only 0.07 out at the hilts, and both pommels hung in the air outside it.
// `hilt` is the fraction of the blade that lies below the crossing. Under 1 it
// puts the crossing above centre, which is where two swords crossed on a badge
// actually cross, and it is the one number that stops the mark reading as a
// plain saltire.
const BLADE = { ax: 0.080, ay: 0.090, dy: 0.000, half: 0.015, hilt: 0.62 };

// --- the lettering ---------------------------------------------------------
//
// A rank, a name and a year is three lines where the set's own stones carry one
// mark and one line, and the brief's 3 to 5 percent ink target was written for
// those. The stones this project rejected for busy lettering measured 12 to 19
// percent, so the conflict is real and it is not solved by writing less: a war
// grave without a rank is not a war grave.
//
// It is solved by SIZE, and by hierarchy. The name is the set's own letter,
// cap 0.090 against fred's 0.100 and the cross's R.I.P. at 0.129. The rank and
// the year are cut to cap 0.062, which is smaller than anything else in the
// graveyard, and that is what pays for the third line. Ink goes quadratically
// in cap height, so dropping the two outer lines from 0.090 to 0.062 costs
// nothing legible and saves more ink than deleting a whole line at full size
// would have.
//
// WHERE THE FLOOR IS. Rendered at scene size (the stone 80 px tall, 63 px per
// world unit) at cap 0.050, 0.056, 0.062, 0.070, 0.078 and 0.090:
//   0.090  5.7 px  every letter separately visible
//   0.078  5.0 px  legible as words, individual letters starting to merge
//   0.070  4.4 px  a line of text, not readable, still clearly lettering
//   0.062  3.9 px  a textured band that reads as an inscription. THE FLOOR.
//   0.056  3.6 px  grey mush, reads as a smear or a stain
//   0.050  3.2 px  gone, the normal map contributes nothing at all
// So about four pixels of cap height is where a carved letter stops being a
// letter in this treatment, and 0.062 world at this stone's height is the last
// size above it. That number is a property of the treatment (an 11 texel groove
// wall and a 6 texel lip at 1024 rows) and not of this stone, so it transfers:
// on a face of height Hf the floor is roughly 0.062 * (Hf / 1.28) if the stone
// is meant to be seen at the same distance.
//
// `em` is the font size the set's inkText takes. Cap height is 0.649 of it,
// measured off this face rather than assumed: the first pass used the nominal
// 0.70 and every line came out 7 percent short of the number it asked for.
const CAP_TO_EM = 1 / 0.649;
// Exported so the capture harness can build the same tablet at a range of
// letter sizes and photograph them side by side. Nothing in the scene writes
// to it.
export const LETTER = {
  rank: { cap: 0.062, y: 0.705 },
  name: { cap: 0.090, y: 0.580 },
  year: { cap: 0.062, y: 0.455 },
};
// No line may run wider than this, so a SERJEANT block is the same width as a
// GUNNER block and the row stays a row. Long ranks are scaled down to fit
// rather than tracked in, because tracking a rank out to the same width as the
// name is the one thing that would make two of these look different.
const LINE_MAX = 0.50;

// The cross. Low, small and plain: 0.175 tall against the cross stone's 0.30,
// because there it is the only mark on the face and here it is the fourth
// thing. Its bar is 0.20 of its height, which is 0.035 world, 2.2 px at scene
// size, right at what the groove treatment can still hold.
const CROSS = { y: 0.255, h: 0.175 };

// Rank, name and year. This is the entire per-seed variation on the piece,
// which is the point: two soldier stones side by side differ in who is under
// them and in nothing else. Ranks are held to eight characters so the fit
// scaling almost never has to bite.
const RANKS = [
  'PRIVATE', 'GUNNER', 'SAPPER', 'DRIVER', 'TROOPER',
  'RIFLEMAN', 'CORPORAL', 'SERJEANT', 'SEAMAN', 'AIRMAN',
];
const NAMES = [
  'J. HALE', 'A. MOSS', 'W. REED', 'T. GRAY', 'R. FINCH',
  'E. BLYTH', 'H. DALE', 'S. QUINN', 'C. WREN', 'P. LOWE',
];
const YEARS = ['1914', '1915', '1916', '1917', '1918'];

// --- outlines --------------------------------------------------------------

// The tablet, counter-clockwise from the bottom right corner. Two bottom
// corners, two shoulder fillets, one crown, and the four straight runs fall out
// between them for free because every arc ends tangent to the run that follows
// it.
const BODY_OUTLINE = [
  { cx: W - RB, cy: RB, r: RB, a0: -Math.PI / 2, a1: 0, sign: 1 },
  { cx: W - RS, cy: Y_SPRING, r: RS, a0: 0, a1: PHI, sign: 1 },
  { cx: 0, cy: CY, r: CROWN_R, a0: PHI, a1: Math.PI - PHI, sign: 1 },
  { cx: -(W - RS), cy: Y_SPRING, r: RS, a0: Math.PI - PHI, a1: Math.PI, sign: 1 },
  { cx: -(W - RB), cy: RB, r: RB, a0: Math.PI, a1: Math.PI * 1.5, sign: 1 },
];

// The convex hull of a set of circles, as an arc chain, given the circles in
// counter-clockwise hull order.
//
// For two circles on a counter-clockwise hull the shared outer tangent has unit
// normal n with n . (Cj - Ci) = ri - rj, which is one equation plus a unit
// length; the branch is picked by the perpendicular that points out of a
// counter-clockwise polygon, (dy, -dx). Each circle's tangency points lie at
// its own radius along the normals of the two edges either side of it, so the
// arc runs between those two bearings and every join is tangent with no angle
// tuned by hand and no straight run measured.
//
// This is why the shield is authored as circles rather than as an outline. A
// heater shield hand-written as arcs has five tangency conditions in it and
// getting any one of them wrong is a crease down the badge; written as five
// circles there are none to get wrong.
function hullOutline(circles) {
  const n = circles.length;
  const bearing = circles.map((a, i) => {
    const b = circles[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const k = (b.r - a.r) / L;
    const s = Math.sqrt(1 - k * k);
    return Math.atan2((-k * dy) / L - (s * dx) / L, (-k * dx) / L + (s * dy) / L);
  });
  return circles.map((c, i) => {
    const a0 = bearing[(i + n - 1) % n];
    let a1 = bearing[i];
    while (a1 < a0) a1 += 2 * Math.PI;
    return { cx: c.x, cy: c.y, r: c.r, a0, a1, sign: 1 };
  });
}

// The heater shield: five circles, counter-clockwise from the point.
//
// The waist pair is the whole difference between a shield and a rounded
// triangle. Without it the outline runs straight from the top corners to the
// point, and the first render came back with a badge that read as an inverted
// rounded triangle. The waist circles share the top pair's x and radius, which
// is what makes the tangent between them exactly vertical: the shield is full
// width from the waist up, and only then converges.
function shieldOutline() {
  const { cy, hw, half, ra, waist, rt } = BADGE;
  return hullOutline([
    { x: 0, y: cy - half + rt, r: rt },
    { x: hw - ra, y: cy + waist, r: ra },
    { x: hw - ra, y: cy + half - ra, r: ra },
    { x: -(hw - ra), y: cy + half - ra, r: ra },
    { x: -(hw - ra), y: cy + waist, r: ra },
  ]);
}

// --- the face --------------------------------------------------------------

// Exported for the capture harness, which measures ink and letter height off
// the same code the stone carves rather than off a copy of it that drifts.
// chest.js and sundial.js export their marks for the same reason.
export function drawSoldierFace(ctx, w, h, rng) {
  const S = h / H;                        // canvas pixels per world unit
  const px = (x) => (x + W) * S;
  const py = (y) => (H - y) * S;
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

  // One line, centred, scaled down if it would run past LINE_MAX. Scaling
  // rather than tracking, so every stone's text block is the same block.
  const line = (text, spec) => {
    const em = spec.cap * CAP_TO_EM * S;
    const spacing = em * 0.05;
    ctx.font = `bold ${em}px "Liberation Serif", "Times New Roman", Georgia, serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    const wide = ctx.measureText(text).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const cap = LINE_MAX * S;
    const fit = wide > cap ? cap / wide : 1;
    inkText(ctx, text, w / 2, py(spec.y), em * fit, spacing * fit);
  };

  // The device first, because it is the one mark whose position is fixed by
  // geometry rather than by taste: it has to land inside the raised shield.
  const bx = px(0);
  const by = py(BADGE.cy + BLADE.dy);
  const blade = (side) => {
    const ex = side * BLADE.ax * S;
    const ey = -BLADE.ay * S;             // canvas y runs down, the tip runs up
    const len = Math.hypot(ex, ey);
    const ux = ex / len;
    const uy = ey / len;
    const t = BLADE.half * S;
    const hx = bx - ex * BLADE.hilt;      // the pommel end, short of the tip
    const hy = by - ey * BLADE.hilt;
    // A tapered blade from a round pommel to a point, drawn as one path: the
    // two flanks meet at the tip and the cap closes the hilt.
    ctx.beginPath();
    ctx.moveTo(hx + uy * t, hy - ux * t);
    ctx.lineTo(bx + ex, by + ey);
    ctx.lineTo(hx - uy * t, hy + ux * t);
    ctx.arc(hx, hy, t, Math.atan2(-ux, uy), Math.atan2(ux, -uy), true);
    ctx.closePath();
    ctx.fill();
  };
  blade(1);
  blade(-1);

  line(pick(RANKS), LETTER.rank);
  line(pick(NAMES), LETTER.name);
  line(pick(YEARS), LETTER.year);

  inkCross(ctx, bx, py(CROSS.y), CROSS.h * S);
}

// ---------------------------------------------------------------------------

registerStone('soldier', {
  // plinth 0 on purpose. A war grave is set straight into the turf and the one
  // upright in the set with no base course reads as exactly that from any
  // distance. It also keeps the footprint at 0.345 by 0.130, the tightest of
  // any upright here, which is what lets a row of them stand as close together
  // as a row of them should.
  shape: { halfWidth: W, height: H, depth: DEPTH, plinth: 0 },
  // The registry's own slab is discarded in extras, so these two only decide
  // how much geometry is built and thrown away. Held at the rim radius, which
  // is the cheapest the sweep will go.
  topRadius: 0.062,
  bottomRadius: 0.062,

  draw: drawSoldierFace,

  extras({ body, slab, material, shape, edge, disposables, slabUV, lean, rng }) {
    // See the header: the slab cannot make a segmental head, so the body is
    // built here and the slab goes. The registry still builds and disposes its
    // geometry, which is the one thing this contract has no way to decline.
    body.remove(slab);

    const add = (geo, z = 0) => {
      if (z) geo.translate(0, 0, z);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      disposables.push(geo);
      return mesh;
    };

    // The tablet. slabUV is the registry's own face mapping and the outline is
    // authored in exactly its coordinates, x over [-W, W] and y over [0, H], so
    // the inscription lands on this body precisely as it would have landed on
    // the slab it replaces, grime band and all.
    add(buildArcSweepGeometry({ outline: BODY_OUTLINE, depth: shape.depth, edge, uv: slabUV }));

    // The badge. Its front face takes the SAME face mapping, which is what puts
    // the crossed blades on it: the device is drawn into the face canvas at the
    // badge's own x and y, so the shield samples the artwork sitting behind it
    // and the tablet's own face, hidden underneath, samples the identical
    // texels. Nothing is drawn twice and no second texture is needed.
    //
    // Depth bookkeeping. The plate is 0.10 thick and the face is at z = 0.095,
    // so a centre at 0.080 leaves 0.035 standing proud and 0.065 buried inside
    // the tablet, which is ten times the light's 0.006 normal bias and nowhere
    // near the dotted self-shadow band a shallow tenon gives. The plate's
    // widest ring is at 0.108, in front of the face, so the shield meets the
    // stone on its way out and never undercuts.
    const zc = shape.depth / 2 + BADGE.proud - BADGE.depth / 2;
    add(
      buildArcSweepGeometry({
        outline: shieldOutline(),
        depth: BADGE.depth,
        edge: BADGE.edge,
        uv: slabUV,
      }),
      zc,
    );

    // --- the lean ------------------------------------------------------------
    //
    // The registry hands every stone a roll of up to 1.29 degrees and a
    // backward pitch of 0.69 to 1.83. On this piece those two are not the same
    // kind of error and they are treated differently, which is the first time
    // in the set that anyone has split them.
    //
    // THE ROLL IS THE ONE THAT BREAKS A ROW. At full strength it moves the top
    // of a 1.28 tablet 29 mm sideways, and since the sign is random, two
    // neighbours can differ by 58 mm. At scene size, where the stone is 80 px
    // tall, that is nearly four pixels of disagreement between adjacent tops,
    // and a rank of war graves is the one arrangement in this graveyard where
    // the eye is measuring exactly that. vault.js scaled the whole lean to 0.45
    // because a listing gable reads as a modelling error; cairn.js switched it
    // off because a heap of loose stones cannot tilt as a rigid body. Neither
    // reason applies here. This one is about the ROW, so the roll goes to 0.20,
    // which is 0.26 degrees and 6 mm at the top, under half a pixel of
    // raggedness, while still being a different number on every casting.
    //
    // THE PITCH DOES NOT BREAK A ROW, because its sign is not random: every
    // stone the registry makes tips backwards. Ten of them all leaning a degree
    // away from the viewer is a rank of stones that have settled, which is what
    // a hundred years of frost actually does to a war cemetery. It is only
    // damped to 0.55 so the spread between the shallowest and the steepest
    // stays under two thirds of a degree.
    //
    // Switching the lean off entirely was tried and rejected in render: three
    // identical tablets standing dead true read as three instances of one mesh,
    // which is exactly what they are and exactly what they must not look like.
    lean.z *= 0.20;
    lean.x *= 0.55;
    lean.sink = SINK;

    // Nothing else here touches rng, and that is the stone. The shape, the
    // head, the badge, the device, the cross and the position of every line are
    // the same on every casting; the rank, the name, the year and the mottle
    // are not. Named rather than left out, so it reads as a decision.
    void rng;
  },
});
