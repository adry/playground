import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';
import { Profile, createSink, sinkToGeometry, latheInto, transformRange } from '../fountain/lathe.js';

// The rustic cross: two rough logs lashed together, cut in stone.
//
// This is the Victorian "rusticated" conceit, the same joke stump.js tells and
// a different punchline. stump is one sawn trunk; this is a CROSS made of two
// round timbers, one laid over the other, bound where they meet, with a plaque
// hung under the joint carrying the name. It is stone all the way through: the
// set's one grey, the set's vinyl surface, and no brown anywhere. A barky brown
// version of this is a fence, and a fence is not a headstone.
//
// WHAT SEPARATES IT FROM THE THREE STONES IT COULD BE CONFUSED WITH
//
//   stump   is a single trunk and has no cross in it. This has two members.
//   calvary is a cross whose members are SQUARE in section with a wide chamfer,
//           standing on three horizontal steps. Every member here is ROUND in
//           section and the thing at the bottom is a log going into the dirt.
//   celtic  is a ringed head on a tapering shaft. Nothing here is a ring and
//           nothing here is a slab-sided shaft.
//
// And one feature none of the three has: a flat plaque, tipped back to face the
// camera, hung on a round member. That is the only flat surface on the piece
// and it is where the inscription lives.
//
// THE FIVE THINGS THAT MAKE IT READ AS TIMBER, AND WHAT EACH ONE COST
//
//   1. BARK AS FURROWS, NOT AS NOISE. Fine vertical bark at this camera is the
//      film grain the house style bans and it aliases away to a grey sheen. So
//      the bark here is FOUR broad crowns separated by four narrow furrows, and
//      two of the four furrows open into splits a third of the way into the
//      log. On a member 0.196 through, a furrow is 0.050 across and a split
//      0.045, which at the size the piece is judged is seven and six pixels.
//      That is the floor. What this cost is angular resolution: at 44 steps the
//      splits were in the geometry and invisible in the render, because the
//      lathe takes its normals by central difference over one step either side
//      and a step 0.14 radians wide averages a 0.19 radian wall away. 72 steps
//      is what makes the split a split, and it is most of why this piece is the
//      second heaviest in the set.
//   2. BRANCH STUBS. The single strongest cue that a cylinder is a log, and the
//      one most at risk from the 0.13 floor. Four on the whole piece, and fat:
//      the thinnest is 0.120 across at its sawn tip and 0.148 at its collar.
//      Three break the silhouette and one is the bracket under the plaque.
//   3. SAWN ENDS WITH RINGS, ON THE ONE END THAT PRESENTS ITSELF. There are
//      three sawn faces and they are not worth the same. Worked out rather than
//      guessed: the shipped layout yaws every headstone to PI/4 so its face
//      meets the camera, and the camera itself is 45 degrees round in plan, so
//      an arm end's outward normal comes out EXACTLY perpendicular to the view
//      direction. Square on the camera, zero. So the arm ends get the saw's
//      tilt (0.040 of rise over a 0.10 radius, about 22 degrees) purely to lift
//      their normals out of that dead angle, and the rings go on the TOP of the
//      upright, whose normal dots the view at 0.45 and which the key light hits
//      nearly square. That face is the one the eye actually gets.
//   4. THE LASHING AS BANDS, NOT STRANDS. Two rope wraps, one on each arm hard
//      against the upright. Each is two half-round turns 0.062 through, so the
//      rope stands 0.031 proud of a log whose radius is 0.096, with a narrow
//      flat between the turns that IS the groove. It went through three thin
//      turns first and came back as a screw thread; a lashing at this size is
//      two fat coils or it is nothing, which is the same answer the anchor's
//      rope reached. They are part of the member's own lathe profile, so they
//      cost no extra geometry, have no seam and no normal to reconcile.
//
//   5. THE BOW. Both members wander sideways by a quadratic that is zero at
//      both ends, in a direction drawn per seed, at most 0.055 on the upright
//      and 0.032 on the bar. It is the cheapest of the five and close to the
//      most effective: a dead straight round member is a dowel however good its
//      surface is, and eight degrees of wander at the ends is the difference
//      between a signpost and a piece of wood. Everything seated on a member
//      reads the same bow, so the stubs and the plaque follow it.
//
// It keeps the registry's own lean and its own sink, which nothing else in this
// file has to know about: the upright runs to 0.22 below the floor with a butt
// 0.28 across, so there is no underside for a lean to lift and no seating
// problem to solve. calvary and the chest tomb both had one because they stand
// on a wide flat pad; this stands on a post.
//
// Construction: the upright, the crossbar and the four stubs are one lathe
// surface each, appended into one sink from fountain/lathe.js, so the whole
// timber half of the piece is a single draw call. The plaque is the registry's
// OWN slab, moved and tipped rather than thrown away, which is what buys it the
// family's swept rim, its two-map carving and its grime for nothing. cairn.js
// does the same with its slate.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// --- the two members ---------------------------------------------------------

const TOP = 1.535;      // the sawn top of the upright, before the saw's tilt
const YC = 1.075;       // the crossing, i.e. the crossbar's centre line
const ARM = 0.470;      // half span of the crossbar
const Z_BAR = 0.068;    // how far in front of the upright's axis the bar lies

// The bar is laid ON the upright rather than through it. 0.068 against radii of
// 0.099 and 0.093 leaves the two solids overlapping by 0.124, so the union has
// no gap in it, but the bar's silhouette clearly stands proud in front and
// throws a shadow down the shaft. Two logs tied together is the whole idea and
// a bar buried on the axis reads as one moulded cross instead.

const R_TOP = 0.092;    // upright, at the sawn top
const R_MID = 0.100;    // upright, at the crossing
const R_BUTT = 0.140;   // upright, at the buried butt
const FOOT_Y = -0.22;   // the closing disc, well under the floor

const R_BAR_A = 0.098;  // crossbar at the -x end
const R_BAR_B = 0.088;  // and at the +x end, so the two arms are not a mirror

// Four ends of a cross want to match, and how far an arm projects past the
// upright decides whether it is an arm at all. The first pass ran the members
// at 0.236 through on a 0.332 projection, a ratio of 1.4, and the render is
// unambiguous: the crossbar read as a barrel lying on a hydrant. calvary hit
// the identical wall and wrote the rule down, that projection has to beat
// thickness by half again before an arm looks like an arm. These are 0.196
// through and project 0.385, a ratio of 1.96, and the upper limb stands
// 1.550 - (1.075 + 0.093) = 0.382 over the bar, so all four ends match.

const RE = 0.020;       // the arris rolled onto every sawn end
const SAW = 0.034;      // rise of the upright's sawn top, low side to high
const END_TILT = 0.036; // the same on the two arm ends, and see note 3 above
const RING = 0.0055;    // growth ring amplitude on a sawn face
const RING_K = 262;     // about three rings across the upright's 0.072 of flat

const BARK = 0.0230;    // furrow depth on the radius, see bark() below
const SPLIT = 0.0240;   // extra depth where a furrow opens into a split
const SEG_UP = 72;      // angular steps. Set by the SPLIT, which is the
const SEG_BAR = 64;     // narrowest feature: see the note on splits() below

// --- the bow -----------------------------------------------------------------
//
// The last thing that separates a log from a dowel, and the cheapest. Both
// members are bowed sideways by a quadratic that is zero at both ends and at
// most this much in the middle, in a direction drawn per seed. It is applied to
// the finished vertices rather than to the lathe, because a lathe has an axis
// by definition and this is a displacement OF the axis.
//
// The normals are left alone on purpose. The bow's steepest slope is 4A over
// the member's length, which is 0.055 * 4 / 1.52 = 0.145, so eight degrees at
// the very ends and nothing in the middle. Under about ten degrees the error is
// smaller than the shading difference the bark already puts there, and the
// alternative is re-deriving normals for a deformation whose whole point is
// that it is gentle. calvary's die takes the same view of its 3 degree taper.
const BOW_UP = 0.055;   // the upright's sideways wander, at its widest
const BOW_BAR = 0.032;  // and the crossbar's

// --- the rope wraps ----------------------------------------------------------

const COIL_W = 0.062;   // one turn: a half-round bulge of this diameter
const COIL_GAP = 0.010; // the flat between two turns, which IS the groove floor
const COIL_LIFT = 0.008;// the band's base stands this far proud of the log
const COILS = 2;
const BAND_L = COILS * COIL_W + (COILS - 1) * COIL_GAP; // 0.134

// --- the plaque --------------------------------------------------------------
//
// shape.halfWidth and shape.height are NOT the cross: they are the plaque, and
// they are what sets the face texture's aspect and the slabUV mapping the
// inscription is carved through. 0.58 by 0.35 gives a 1697 x 1024 face canvas.
//
// The width was forced rather than chosen, the same way cairn's was. A slab's
// flat front face is the outline INSET by the 0.062 rim radius all round, so a
// 0.58 wide plaque has 0.456 of flat, and four capitals at the set's own letter
// size need about 0.41 of it. Narrower than this and the name wraps round the
// bead and up the side, which is the reason this is not the small tablet the
// composition would prefer: the letter size is not negotiable and it sets the
// plaque, and the plaque then sets how long the arms have to be to beat it.
const PL_HW = 0.290;
const PL_H = 0.350;
const PL_D = 0.135;     // must clear 2 * edge (0.124) or the swept rim folds
// How far back it lies. The camera sits 29 degrees up, so a vertical face gives
// up nearly all of itself; tipped back into this range the plaque turns toward
// the eye and reads about a fifth taller than it is. cairn's slate uses 0.20 to
// 0.46 for the same reason. This one is fixed rather than seeded, because the
// plaque is the only thing on the piece carrying text and a tip that varies
// varies how legible the name is.
const PL_TIP = 0.28;
const PL_BITE = 0.012;  // how far its top edge presses into the upright, twice
                        // the light's 0.006 normalBias

// --- surface -----------------------------------------------------------------

// Bark, as FOUR deep longitudinal furrows rather than as ripples.
//
// The first pass was a raised cosine to the power 1.7, five of them, which puts
// narrow crests on a wide flat, and at 480 px the logs came back looking turned
// on a lathe and polished. Bark does the opposite: broad crowns of bark with a
// narrow gap between them that you could get a fingernail into. So the power is
// applied to the INVERTED cosine and the result subtracted, which gives a
// function sitting near its maximum over most of a period and diving to zero
// over about half a radian. On a log of radius 0.100 that is a furrow 50 mm
// across and 0.013 deep, which is seven pixels wide at the size the piece is
// judged. Seven is the floor. Anything narrower is the film grain this project
// bans, and it aliases as the camera moves.
//
// Five furrows was the first count and four is the shipped one, purely for
// width: five put the crowns 0.42 radians apart and the whole surface came back
// as a soft corduroy that the lathe's own central-difference normals then
// smoothed away to nothing. One seventh harmonic at a sixth of the depth stops
// the four reading as fluting, and the phase of both drifts along the member,
// about a quarter of a furrow over the whole upright, so the grain wanders
// instead of running dead straight.
function bark(theta, y, ph) {
  const a = 4 * theta + 0.85 * y + ph[0];
  const ridge = 1 - Math.pow(0.5 - 0.5 * Math.cos(a), 2.4);
  return BARK * ((ridge - 0.72) + 0.16 * Math.sin(7 * theta - 0.55 * y + ph[1]));
}

// Two splits, and they are opened along EXISTING furrows rather than cut across
// the crowns between them. That is what a drying log does, and it is also the
// only way the depths stay sane: a gash landing on a crown would have to be
// 0.034 deep before it read as a split at all, and one landing in a furrow only
// has to finish the 0.013 the furrow already took out. Together they reach
// 0.037 on a radius of 0.100, so a split is a third of the way into the log,
// and no two can ever stack because they are opposite furrows.
//
// The split is the narrowest thing on the surface and it is what sets the
// angular step. Its wall runs from 0.09 to 0.28 radians off centre, so 0.19
// radians of wall, and the lathe takes its normals by central difference over one step
// either side, so a step anywhere near that wide averages the wall away. That
// is exactly what happened at 44 steps: the splits were in the geometry and
// invisible in the render. 72 steps is 0.087 radians, comfortably inside the
// wall, and it is also what stump.js settled on for the same reason.
//
// `pick` chooses which two of the four, per seed, and the split rides the same
// phase drift as the furrow it lives in, so it cannot wander off it.
function splits(theta, y, ph, pick) {
  const drift = 0.85 * y + ph[0];
  let d = 0;
  for (const k of pick) {
    const c = (Math.PI + 2 * Math.PI * k - drift) / 4;
    const t = Math.atan2(Math.sin(theta - c), Math.cos(theta - c));
    // A trench with a floor and two walls, not a gaussian. A gaussian of the
    // same depth spends most of its width on the shoulders, and the shoulders
    // are the part the lathe's central difference eats; a plateau 0.18 wide
    // with walls running from 0.09 to 0.28 keeps a floor the eye can see into.
    d += 1 - smoothstep(0.09, 0.28, Math.abs(t));
  }
  return d > 1 ? 1 : d;
}

// The dressed patch the plaque lies against. Bark is planed off the front of
// the upright over the plaque's own band of height, so a ridge cannot stand
// through the back of it and no split runs out from behind its edge.
function planed(theta, y) {
  const d = Math.atan2(Math.sin(theta - Math.PI / 2), Math.cos(theta - Math.PI / 2));
  const across = 1 - smoothstep(0.50, 0.95, Math.abs(d));
  const along = smoothstep(0.46, 0.60, y) * (1 - smoothstep(0.90, 1.00, y));
  return across * along;
}

// Growth rings, as a ripple in the axial direction across a sawn face. A field
// written in polar coordinates pinwheels about its centre, which is wrong
// nearly everywhere and exactly right here: rings ARE concentric. Eased off at
// the axis so the little dome that keeps the pole's normal pointing outward is
// not fighting a ripple, and off again at the rim so the ring does not run into
// the rolled arris.
function rings(r, rEnd, phase) {
  const t = r / rEnd;
  return RING * Math.sin(RING_K * r + phase) * smoothstep(0, 0.22, t) * (1 - smoothstep(0.78, 1.0, t));
}

// --- profiles ----------------------------------------------------------------

// One rope wrap, appended to a profile that has just reached radius `r` at
// height `y0`. Each turn is a true half circle, so the surface leaves and
// rejoins the band's base tangent to the axis and the groove between two turns
// has two vertical walls and a narrow floor. That cusp is deliberate: it is the
// deepest shadow on the piece per unit of geometry.
function ropeBand(P, r, y0) {
  const b = r + COIL_LIFT;
  P.setTag('rope');
  P.lineTo(b, y0, 2);
  for (let k = 0; k < COILS; k++) {
    const a = y0 + k * (COIL_W + COIL_GAP);
    P.arc(b, a + COIL_W / 2, COIL_W / 2, -Math.PI / 2, Math.PI / 2, 7);
    if (k < COILS - 1) P.lineTo(b, a + COIL_W + COIL_GAP, 2);
  }
  P.lineTo(r, y0 + BAND_L + 0.012, 2);
}

// The upright, from a buried disc to the sawn top. A butt swell over the bottom
// tenth and nothing else: a log put in the ground spreads a little where it was
// cut from the root, and that swell is also what seats the piece, since this
// stone has no plinth. It is NOT stump's root flare, which is five separate
// lobes and runs a quarter of the way up that stone. The first pass took the
// swell to 0.150 over the bottom fifth and the render came back as a hydrant.
//
// No rope wrap above the crossing either, though there was one. Between the
// bar's shoulder and the sawn top's rolled arris it put a third disc on the
// same short run of log, and the three together read as a turned bottle neck
// rather than as a bound joint. The two on the arms carry the lashing alone.
function uprightProfile(top) {
  const P = new Profile();
  P.setTag('butt');
  P.moveTo(0, FOOT_Y);
  P.lineTo(R_BUTT, FOOT_Y, 3);
  P.lineTo(R_BUTT - 0.004, -0.070, 3);
  P.setTag('swell');
  P.lineTo(0.122, 0.010, 3);
  P.curve([[0.108, 0.075], [0.104, 0.165]], 7);
  P.setTag('log');
  P.lineTo(R_MID, 0.72, 8);
  P.lineTo(R_TOP + 0.004, 1.20, 6);
  P.lineTo(R_TOP, top - RE, 6);
  P.setTag('rim');
  P.arc(R_TOP - RE, top - RE, RE, 0, Math.PI / 2, 6);
  P.setTag('cut');
  // The face rises a hair to the middle. A face that keeps falling to the axis
  // ends in a pole whose normal the lathe turns over against the ring below it,
  // and that is a black pinhole in the middle of the most visible surface on
  // the piece. Sampled finely because the rings are a ripple in r and a ring
  // the rows step over is a ring that aliases away to nothing.
  P.lineTo(0, top + 0.010, 16);
  return P.build();
}

// The crossbar, laid out along its own +y and rotated into place later, so both
// sawn ends and both rope bands come out of one closed surface. It tapers from
// 0.098 to 0.088 end to end, which is a real limb and not a mirror of itself.
function barProfile(len, bandA, bandB) {
  const rAt = (y) => R_BAR_A + (R_BAR_B - R_BAR_A) * (y / len);
  const P = new Profile();
  P.setTag('cutA');
  P.moveTo(0, -0.010);
  P.lineTo(R_BAR_A - RE, 0, 10);
  P.setTag('rimA');
  P.arc(R_BAR_A - RE, RE, RE, -Math.PI / 2, 0, 5);
  P.setTag('log');
  P.lineTo(rAt(bandA), bandA, 6);
  ropeBand(P, rAt(bandA), bandA);
  P.setTag('log');
  P.lineTo(rAt(bandB), bandB, 6);
  ropeBand(P, rAt(bandB), bandB);
  P.setTag('log');
  P.lineTo(R_BAR_B, len - RE, 6);
  P.setTag('rimB');
  P.arc(R_BAR_B - RE, len - RE, RE, 0, Math.PI / 2, 5);
  P.setTag('cutB');
  P.lineTo(0, len + 0.010, 10);
  return P.build();
}

// A lopped branch. The swelling at the collar is the whole point: a branch
// leaves a trunk through a bulge, and without it a stub is a dowel pushed into
// a hole. The base disc sits well behind the collar so it lands inside the
// member; flush on the surface, two coincident skins draw a black ring round
// the joint. The end is sawn flush and rolled over on the same arris as
// everything else.
function stubProfile(len, r0, r1) {
  const P = new Profile();
  P.setTag('collar');
  P.moveTo(0, -0.15);
  P.lineTo(r0 * 0.86, -0.15, 2);
  P.curve([[r0 * 1.07, 0.02], [r0 * 0.80, len * 0.44]], 8);
  P.setTag('branch');
  P.lineTo(r1, len * 0.86, 4);
  P.setTag('cut');
  P.arc(r1 - 0.016, len * 0.86, 0.016, 0, Math.PI / 2, 4);
  P.lineTo(0, len * 0.86 + 0.022, 4);
  return P.build();
}

// --- the stubs ---------------------------------------------------------------
//
// Four, and their sizes are set by the floor rather than by taste: the thinnest
// tip here is 0.120 across and the fattest collar 0.172, against the 0.13 the
// registry's rim radius makes the practical minimum for anything that has to
// read as a solid. stump's stubs run down to 0.092 at the tip and get away with
// it because they sit on a drum a quarter of a metre across; these sit on logs
// half that, so they have to be fatter in absolute terms, not thinner.
//
// `theta` is the lathe's own angle on the member it grows from, so on the
// upright theta = PI/2 points at +z, which is the face the layout turns toward
// the camera. Three of the four break the silhouette from a different quarter,
// so the piece never presents a bare pole whichever way you walk round it. The
// fourth is the bracket the plaque's foot sits on.
const STUBS = [
  { on: 'up', theta: 2.66, y: 0.40, tilt: 0.52, len: 0.185, r0: 0.080, r1: 0.064, seg: 22 },
  { on: 'up', theta: 0.10, y: 0.50, tilt: 0.26, len: 0.215, r0: 0.076, r1: 0.062, seg: 22 },
  { on: 'up', theta: 4.95, y: 1.29, tilt: 0.62, len: 0.155, r0: 0.070, r1: 0.060, seg: 20 },
  { on: 'bar', x: -0.300, out: -1, phi: 1.55, tilt: 0.72, len: 0.170, r0: 0.072, r1: 0.060, seg: 20 },
];

// Where they are is the argument, not how many. Two low on the shaft, where the
// eye has nothing else to look at; one on the upper limb pointing back and away
// so the piece is not a bare pole from behind; one on the far arm. The fifth
// candidate was on the near arm and it went, because from the shipped yaw it
// lands in front of the crossbar and reads as a lump on it rather than as a
// branch off it.

// r at a given height on a built profile, so a stub is seated on the surface
// rather than at a radius somebody guessed.
function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if ((y >= a.y && y <= b.y) || (y >= b.y && y <= a.y)) {
      const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return R_MID;
}

// --- the mark ----------------------------------------------------------------
//
// One name and nothing else. The registry's postmortem is blunt that a piece
// whose silhouette is doing this much work gets no second thing competing with
// it, and celtic and calvary both landed on one short line for the same reason.
// A rustic cross's plaque carries a name, so this is a name rather than the
// fourth date in the set.
//
// Sizing is measured off the artwork on the real 1697 x 1024 face rather than
// taken from the font metrics: a bold serif caps out at about 0.66 of its point
// size, so a font of 0.390 of the face height gives capitals 0.092 world tall.
// That sits between fred's 0.093 and vault's 0.100, inside the 0.09 to 0.12 the
// set uses. Matching letter SIZE is what has to hold; a coverage figure on a
// face this small is the second question.
const NAMES = ['NORA', 'ABEL', 'RUTH', 'SETH', 'JOAN'];
const NAME_SIZE = 0.390; // font size, in fractions of the face height
const NAME_ROW = 0.545;  // baseline, in fractions of the face height down

// The plaque's visible band is v 0.172 to 0.828: the bottom and top 0.062 roll
// over into the swept rim. The row is set on the middle of THAT band and then
// nudged down a shade, because the plaque lies back and the eye reads a tipped
// face as top heavy.

// ---------------------------------------------------------------------------

function buildRustic({ body, slab, material, rng, disposables, stripUV }) {
  // Per seed: where the bark's ridges and splits sit, which way each saw fell,
  // how high the crossing is, how long the arms are, and how the stubs are
  // aimed. None of them can turn the piece into a different design, and the two
  // that show most are the crossing height and the arm length, because between
  // them they decide the proportion of the head.
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const top = TOP + (rng() - 0.5) * 0.05;
  const yc = YC + (rng() - 0.5) * 0.04;
  const arm = ARM * (1 + (rng() - 0.5) * 0.06);
  const len = arm * 2;
  const sawPhi = Math.PI * 1.1 + rng() * 0.7; // the top cut falls away to the back
  // Which two of the four furrows split open, on each member. A quarter turn
  // apart, never opposite, and that is a section check rather than a taste one:
  // two splits facing each other take 0.037 out of both sides of a log whose
  // radius is 0.100, leaving 0.126 through, which is under the 0.13 floor the
  // rim radius sets for anything on this piece. At a quarter turn the thinnest
  // section is 0.148 and no two splits can ever line up.
  const pick = [Math.floor(rng() * 4), 0];
  pick[1] = (pick[0] + 1) % 4;
  const pickBar = [Math.floor(rng() * 4), 0];
  pickBar[1] = (pickBar[0] + 1) % 4;

  // The bow, drawn once and then used by everything that has to follow it: the
  // upright's own vertices, the stubs seated on it, and the plaque hung off it.
  const bowA = rng() * 6.283;
  const bowB = rng() * 6.283;
  const bowUp = (y) => {
    const t = clamp01(y / top);
    const f = 4 * t * (1 - t);
    return [BOW_UP * f * Math.cos(bowA), BOW_UP * f * Math.sin(bowA)];
  };
  const bowBar = (x, half) => {
    const t = clamp01((x + half) / (2 * half));
    const f = 4 * t * (1 - t);
    return [BOW_BAR * f * Math.cos(bowB), BOW_BAR * f * Math.sin(bowB)];
  };
  const bend = (start, end, fn) => {
    for (let k = start; k < end; k++) {
      const d = fn(sink.pos[k * 3], sink.pos[k * 3 + 1], sink.pos[k * 3 + 2]);
      sink.pos[k * 3] += d[0];
      sink.pos[k * 3 + 1] += d[1];
      sink.pos[k * 3 + 2] += d[2];
    }
  };

  const sink = createSink();
  // Every lathe appended here has its UVs rewritten at the end, so each range
  // records where it started and how wide its grid is.
  const ranges = [];
  const openRange = (segments) => ranges.push({ start: sink.pos.length / 3, cols: segments + 1 });

  // --- the upright -----------------------------------------------------------
  const upright = uprightProfile(top);
  openRange(SEG_UP);
  latheInto(sink, {
    profile: upright,
    segments: SEG_UP,
    uRepeat: 1,
    minRadius: 0.09,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      if (s.tag === 'cut') {
        dy += rings(s.r, R_TOP - RE, ph[4]);
      } else if (s.tag !== 'rim') {
        // Bark everywhere but the sawn end, planed off behind the
        // plaque so a ridge cannot poke through its back, and dying out as the
        // surface turns over the rim.
        const up = 1 - smoothstep(top - 0.13, top - 0.03, s.y);
        const flat = 1 - 0.85 * planed(theta, s.y);
        dr += bark(theta, s.y, ph) * up * flat;
        // The split dies out into the butt swell. Run to the ground it opens a
        // black slot at the one place the eye is looking for a clean joint
        // between the piece and the floor, and it reads as a hole rather than
        // as a crack.
        dr -= SPLIT * splits(theta, s.y, ph, pick) * up * flat * smoothstep(0.06, 0.24, s.y);
      }
      // The saw's tilt on the top face. Scaled by height so it ramps in across
      // the joint rather than folding the surface where it starts, and by
      // radius so that across the face itself the lift falls to nothing at the
      // centre and the cut comes out a tilted plane instead of a saddle.
      dy += SAW * Math.cos(theta - sawPhi)
        * Math.min(smoothstep(top - 0.30, top - 0.02, s.y), s.r / R_TOP);
      return [dr, dy];
    },
  });

  bend(0, sink.pos.length / 3, (x, y) => { const d = bowUp(y); return [d[0], 0, d[1]]; });

  // --- the crossbar ----------------------------------------------------------
  //
  // Built along +y at the origin and laid over a quarter turn, which is the
  // only way one profile gives both sawn ends. The rotation sends the lathe's
  // own +y to world +x and its theta = 0 to world -y, so "the top of an end
  // face" is theta = PI, which is the number the end tilt below is written
  // against.
  const bandA = len / 2 - 0.099 - 0.018 - BAND_L;
  const bandB = len / 2 + 0.099 + 0.018;
  const barStart = sink.pos.length;
  openRange(SEG_BAR);
  latheInto(sink, {
    profile: barProfile(len, bandA, bandB),
    segments: SEG_BAR,
    uRepeat: 1,
    minRadius: 0.09,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      const cut = s.tag === 'cutA' || s.tag === 'cutB';
      if (cut) {
        dy += rings(s.r, (s.tag === 'cutA' ? R_BAR_A : R_BAR_B) - RE, ph[5]);
      } else if (s.tag !== 'rope' && s.tag !== 'rimA' && s.tag !== 'rimB') {
        const ends = smoothstep(0, 0.14, s.y) * (1 - smoothstep(len - 0.14, len, s.y));
        dr += bark(theta, s.y + 3.1, ph) * ends;
        dr -= SPLIT * splits(theta, s.y + 3.1, ph, pickBar) * ends;
      }
      // The two end cuts, each tipped so its top edge leans OUT. Nothing to do
      // with realism: an arm end's normal is square on the view direction in
      // the shipped layout, and about 22 degrees of tilt is what lifts it off
      // that dead angle without the end starting to read as a spike.
      const fa = 1 - smoothstep(0, 0.08, s.y);
      const fb = smoothstep(len - 0.08, len, s.y);
      dy += END_TILT * Math.cos(theta) * Math.min(1, s.r / R_BAR_A) * fa;
      dy -= END_TILT * Math.cos(theta) * Math.min(1, s.r / R_BAR_B) * fb;
      return [dr, dy];
    },
  });
  const bowAtCrossing = bowUp(yc);
  transformRange(sink, barStart, new THREE.Matrix4().compose(
    new THREE.Vector3(-len / 2 + bowAtCrossing[0], yc, Z_BAR + bowAtCrossing[1]),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  ));
  // The bar rides on the upright, so it takes the upright's own wander at the
  // crossing height as an offset and then bows about that.
  bend(barStart / 3, sink.pos.length / 3, (x) => {
    const d = bowBar(x - bowAtCrossing[0], arm);
    return [0, d[0], d[1]];
  });

  // --- the stubs -------------------------------------------------------------
  for (let i = 0; i < STUBS.length; i++) {
    const b = STUBS[i];
    const jitter = 1 + (rng() - 0.5) * 0.18;
    const start = sink.pos.length;
    openRange(b.seg);
    latheInto(sink, {
      profile: stubProfile(b.len * jitter, b.r0, b.r1),
      segments: b.seg,
      uRepeat: 1,
      minRadius: 0.06,
      displace: (s, theta) => {
        if (s.tag === 'cut') return [0, 0];
        // The same ridge language at a third of the depth. A stub is small
        // enough that anything more reads as a knot, and it is faded in along
        // the collar so it cannot start as a notch on the ring that leaves the
        // member.
        const t = s.tag === 'collar' ? smoothstep(0.2, 0.7, s.u) : 1;
        return [0.0040 * Math.cos(5 * theta + ph[i]) * t, 0];
      },
    });

    let pos;
    let dir;
    if (b.on === 'up') {
      const th = b.theta + (rng() - 0.5) * 0.22;
      const tilt = b.tilt + (rng() - 0.5) * 0.14;
      // Seated a little inside the surface: the collar's swelling has to come
      // out OF the log, not sit on it.
      const r = radiusAt(upright, b.y) - 0.040;
      const d = bowUp(b.y);
      pos = new THREE.Vector3(r * Math.cos(th) + d[0], b.y, r * Math.sin(th) + d[1]);
      dir = new THREE.Vector3(Math.cos(th) * Math.cos(tilt), Math.sin(tilt), Math.sin(th) * Math.cos(tilt));
    } else {
      const phi = b.phi + (rng() - 0.5) * 0.22;
      const tilt = b.tilt + (rng() - 0.5) * 0.14;
      const r = 0.092 - 0.040;
      const d = bowBar(b.x, arm);
      pos = new THREE.Vector3(
        b.x + bowAtCrossing[0],
        yc + r * Math.cos(phi) + d[0],
        Z_BAR + bowAtCrossing[1] + r * Math.sin(phi) + d[1],
      );
      // Off a horizontal limb the branch leaves along the surface normal and
      // then leans out along the limb, which is the second rotation here.
      dir = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi))
        .multiplyScalar(Math.cos(tilt))
        .add(new THREE.Vector3(b.out * Math.sin(tilt), 0, 0));
    }
    transformRange(sink, start, new THREE.Matrix4().compose(
      pos,
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
      new THREE.Vector3(1, 1, 1),
    ));
  }

  // --- UVs -------------------------------------------------------------------
  //
  // latheInto lays out (angle, arc length), which would drag the whole cross
  // across the carved region of the atlas and wrap the name round the outside
  // of a log. Rewritten here into the plain strip on the right: u wraps once
  // round each piece, taking its discontinuity on the seam column latheInto
  // duplicates, and v climbs with the real world height of the vertex, so the
  // butt of the upright sits in the same grime band the family's plinths do.
  for (let i = 0; i < ranges.length; i++) {
    const { start, cols } = ranges[i];
    const end = i + 1 < ranges.length ? ranges[i + 1].start : sink.pos.length / 3;
    for (let k = start; k < end; k++) {
      const [u, v] = stripUV(((k - start) % cols) / (cols - 1) - 0.5, 0.03 + 0.94 * clamp01(sink.pos[k * 3 + 1] / top), 0.5, 1);
      sink.uv[k * 2] = u;
      sink.uv[k * 2 + 1] = v;
    }
  }

  const geometry = sinkToGeometry(sink);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);
  disposables.push(geometry);

  // --- the plaque ------------------------------------------------------------
  //
  // The registry's own slab, hung under the crossing and lying back. Its top
  // edge is placed rather than its centre, because what has to be right is that
  // the top tucks under the bar and bites into the upright: a plaque floating a
  // centimetre off a round log is the one way this detail fails.
  //
  // Rotating about x by -PL_TIP sends the face normal to (0, sin, cos), so the
  // plaque looks up and out at the camera. The slab's own origin is the middle
  // of its foot, so the top-back corner is worked back to the origin through
  // the same rotation rather than eyeballed.
  const c = Math.cos(PL_TIP);
  const s = Math.sin(PL_TIP);
  const backY = PL_H * c - (PL_D / 2) * s;
  const backZ = -PL_H * s - (PL_D / 2) * c;
  // Hung clear of the bar rather than jammed under it. The first pass put the
  // plaque's top 0.022 below the bar's shoulder and the two merged into one
  // mass: from a camera 29 degrees up the plaque leans back INTO that gap, so
  // the daylight it needs is more than the gap on paper. 0.075 shows a band of
  // bare shaft between the crossing and the plaque, and the cross reads.
  const hingeY = yc - 0.093 - 0.075;
  const hingeBow = bowUp(hingeY);
  const hingeZ = radiusAt(upright, hingeY) + hingeBow[1] - PL_BITE;
  slab.rotation.x = -PL_TIP;
  slab.position.set(hingeBow[0], hingeY - backY, hingeZ - backZ);
}

// ---------------------------------------------------------------------------

registerStone('rustic', {
  // No plinth. A log is put in the ground, not set on a pad, and the butt swell
  // over the bottom fifth of the upright is this stone's footing. The registry
  // supports plinth 0 directly, which is what the ledger, the bench and the
  // wheel each had to ask for the hard way.
  shape: { halfWidth: PL_HW, height: PL_H, depth: PL_D, plinth: 0 },
  // Nearly square corners. Rounded generously the plaque comes out a lozenge
  // hung on the cross; a plaque wants straight sides and the family's soft rim.
  topRadius: 0.075,
  bottomRadius: 0.075,

  draw(ctx, w, h, rng) {
    const size = h * NAME_SIZE;
    inkText(ctx, NAMES[Math.floor(rng() * NAMES.length) % NAMES.length], w / 2, h * NAME_ROW, size, size * 0.05);
  },

  extras: buildRustic,
});
