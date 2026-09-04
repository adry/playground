import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { shaft } from './bone.js';

// The skull, built from a photograph of a real one.
//
// `.ref/ref-skull-photo.png` is five views of one specimen: a near-lateral, a
// front, and three three-quarters. Every number in the "the reference, measured"
// block below was read off that image by thresholding it and walking the
// silhouette row by row, not transcribed from prose. Where the photograph and
// `.ref/SKULL-ANATOMY.md` disagree the photograph wins, and the two places they
// do are reported at the bottom of this comment.
//
// THE THING SIX PASSES GOT WRONG, WHICH IS NOT ANATOMY. Every rebuild before
// this one was judged on 760 pixel turntable close-ups. IN THE PRODUCT THIS
// HEAD IS ABOUT SEVENTY PIXELS TALL. At seventy pixels the temporal line, the
// mastoid, the coronoid process and the nasal spine are all invisible, and the
// only things that reach the viewer are the outline of the vault, two dark
// holes, a nose hole and a tooth row. The head had been optimised at a size
// nobody sees it at, and it looked, in the user's words, weird.
//
// So the acceptance test for this file is a CROP OF THE HEAD OUT OF A SCENE
// RENDER, not a turntable shot. Turntables are for finding bugs. Where realism
// and legibility conflict at seventy pixels, legibility wins, and every place
// that happens says so in a comment. There are four:
//
//   * The supraorbital shelf is gone (see `browSwell`).
//   * The orbits and the nasal aperture are larger than the specimen's (see
//     the openings block, and `M.skull.socket`).
//   * The vault's upper half-breadth follows an arc rather than the measured
//     rows (see VAULT_HALFW).
//   * The tooth rows sit further apart than occlusion (see AJAR).
//
// WHY THE HEAD IS ASSEMBLED FROM PIECES RATHER THAN BEING ONE FIELD.
//
// It used to be ONE smooth implicit field: a superellipsoid vault driven by a
// profile curve, with holes cut in it. Three things that say "skull" cannot be
// said by a single smooth field at all, and they are still separate meshes:
//
//   1. THE TEMPORAL FOSSA IS A HOLLOW. Subtracted as a real scoop 0.062 of the
//      head's height deep, bounded above by the temporal line, which is added
//      back AFTER the scoop so it is the fossa's edge rather than a scratch.
//   2. THE ZYGOMATIC ARCH IS A BRIDGE WITH DAYLIGHT BEHIND IT. Its own swept
//      bar, both ends buried in abutments that ARE in the field, its middle
//      standing clear of the scooped fossa. The gap is measured and published
//      as `landmarks.zygGap`; a union of two solids is one solid and can never
//      have one.
//   3. THE MASTOID IS A DOWNWARD LUG. Its own tapered mesh hanging behind and
//      below the ear canal, not a bump smin'd into the base, because smin
//      rounds a point off exactly as fast as you sharpen it.
//
// A FOURTH USED TO BE ON THAT LIST AND HAS BEEN DELETED: "the brow overhangs".
// It did overhang, by a swept bar with an authored wedge section buried in the
// frontal. It was also the single weirdest thing in the scene-scale crop. A bar
// laid on a surface has a CREST, the crest is a line running across the front
// of the skull, and above it sat the flat forehead plane that the measured
// profile asked for: brim and crown, a cap. A real supraorbital ridge has no
// edge on its upper side at all. The overhang bought a shadow that is worth
// nothing at seventy pixels, since the socket's darkness comes from the cut
// hole, its walls and the ring of shade around it. So the brow is now a broad
// swelling in the field with a fillet wider than its own radius, and the flat
// plane above it is gone with it.
//
// What is in the field is therefore everything that is genuinely one continuous
// surface: the braincase, the brow, the maxilla, the cheekbone, the nasal
// bones, the cranial base. Only a gap or a point behind it earns its own mesh,
// overlapped into the field's mass so the join happens inside bone.
//
// KEPT FROM THE OLD BUILD, because both were right and both were hard-won:
//
//   * The orbits and the nasal aperture are REAL CUT HOLES in the sampled grid:
//     drop the quads whose centre falls inside an outline, snap the surviving
//     rim onto the true curve clamped to under a cell so it cannot fold, extrude
//     a three-ring wall whose normals are its own, and put a deliberate bowl
//     behind so nothing sees daylight through the head.
//   * The skin's normals come from the FIELD GRADIENT, not
//     computeVertexNormals. With quads missing all round an opening, averaged
//     face normals dish the skin at every rim and put a grey halo exactly where
//     the cut wants a crisp edge.
//
// WHAT THIS FILE AND metrics.js NOW AGREE ON, AND WHY IT MOVED AGAIN.
//
// `M.skull.width` and `M.skull.depth` say f(0.1169) and f(0.1553), which is the
// photograph's answer: a real skull is TALLER than it is long (vertex to
// gnathion 219 px on the front view against glabella to opisthocranion 174.5 px
// on the lateral, corrected for the specimen's ~18 degrees of rotation, so
// 1.075 and not the 0.94 that SKULL-ANATOMY.md claims). This file carries its
// own copies as SKULL_L and SKULL_W and they match.
//
// `M.skull.socket` has been CHANGED by this pass, to f(0.0409) by f(0.0359),
// which is 0.245 by 0.215 of crown-to-chin. That is bigger than the specimen's
// 0.215 by 0.170 and it is the legibility trade, argued at the openings block
// below and again in metrics.js. Previous rounds had to report metric changes
// rather than make them; this one was asked to make them, because the socket
// size turned out to be a legibility problem rather than an anatomy one.
//
// TWO PLACES `.ref/SKULL-ANATOMY.md` IS ALSO WRONG, both checked against the
// photograph rather than against the table:
//
//   * It says the nasal aperture is "about half the orbit's height". It is
//     TALLER than the orbit, not half it. Nasion to nasospinale measured on the
//     lateral is 0.193 of crown-to-chin against an orbit 0.170 tall, and the
//     craniometric means (52 mm nasal height, 34 mm orbital height) put the
//     ratio at 1.5. Half would leave a keyhole punched into the middle of the
//     maxilla, which is what an earlier build had. It is 0.220 here.
//   * The table's eye line at half of vertex-to-chin: already corrected in the
//     file. The photograph puts it at 0.435 and this build sits it at 0.420,
//     the difference being deliberate and explained at ORBIT_V.
//
// M.skull.socket.slant stays at 0.12. The user asked for a friendly face rather
// than a scowl and that is what the slant does. Note that ENLARGING the sockets
// did not bring the scowl back either: the scowl came from a hard diagonal on
// the top edge, not from the size of the opening.
//
// One more number worth saying out loud, though nothing here can act on it:
// relative to the crown and the chin, `M.y.atlas` (ribcageTop + neck.length)
// sits about 0.066 world units LOW. Anatomically the occipital condyles are at
// 0.65 of crown-to-gnathion and the metrics put the parenting plane at 0.808,
// so the cranial base has to be built about 0.15 of the head's height deeper
// than a real one to reach down and cover the top of the neck. It is invisible
// from outside, and the alternative is a floating head.
//
// BONE_COLOR is '#f2e6d2' in bone.js, which is a pale pink-grey ivory. The
// photograph's lit bone averages #e3c2a3 with highlights only reaching #f1d5bc,
// so it is warmer, about twice as saturated and a little darker. '#e6cfae'
// would sit where the reference does. Not changed: bone.js is not mine and the
// whole figure shares the colour.

// ROUND EIGHT: THE MAXILLA AND THE VAULT, AND NOTHING ELSE.
//
// The user named two faults and this pass fixed those two. The brow, the
// orbits, the temporal line, the mandible, the bone colour and the feature
// sizes are all as the previous pass left them.
//
// THE MAXILLA WAS A SLAB, and the pass before this one said so in its own
// report and did not fix it. It was one superellipsoid at exponent 3, which is
// a rounded box, so the mid-face had a flat front, a flat side and a corner
// between, no canine fossa, no zygomaticomaxillary step, and a front that
// leaned BACKWARDS from the brow to the teeth. Measured down a line through the
// canine it moved 0.0018 of the head's height between v 0.594 and v 0.723. It
// is now two blobs whose smin rakes the face plane down and forward, a canine
// eminence and a canine fossa cut as field offsets in the manner of the
// temporal fossa, and an anterior nasal spine; the same line now moves 0.031,
// seventeen times as much, and it moves the right way. See THE MAXILLA,
// REBUILT, in buildSkull, and `maxillaRelief` above it.
//
// THE VAULT WAS ROUND IN TWO SECTIONS AND SQUARE BETWEEN THEM. The profile and
// the plan outlines were both close to arcs, and the head still read as a
// rounded box, because a superellipse of exponent p is round at 0 and at 90
// degrees whatever p is and only the DIAGONAL moves. Three things were putting
// weight on the diagonals and all three are gone: a plan exponent of 2.28 to
// 2.44 through the braincase (VAULT_PLAN), a front taper of 0.60 that pinched
// the front quarter into a flat panel (PLAN_FRONT), and a pair of parietal
// blobs carrying the last 0.024 of the half-breadth through a fillet a third
// of the head wide (EMINENCE, which replaces them). The two midsagittal
// outlines each had a kink in them as well and both are refitted. Measured
// per height as the worst departure from the section's own best-fit ellipse,
// the braincase went from 6.7 / 7.5 / 7.8 / 6.2 / 9.3 / 11.9 / 16.2 / 17.2
// percent at v 0.04 through 0.30 to 4.8 / 4.8 / 4.4 / 6.0 / 14.5 / 12.7 /
// 12.2 / 6.1. What is left above 10% is all on the FRONT quarter and all of it
// is the brow swelling's fillet, which is off this pass's list.
//
// ONE THING OUTSIDE THE TWO FAULTS MOVED, AND THE MAXILLA FORCED IT: the upper
// tooth row went forward 0.013 of the head's height, because the rebuilt
// alveolar process would otherwise have stood a pixel in front of the crowns
// it carries. The mandible did not move. See UPPER_ARCH.
//
// --- the reference, measured ------------------------------------------------
//
// Everything below is in one frame, and it is the frame the photograph was
// measured in rather than the world's:
//
//   v  runs DOWN from the vertex, in units of crown-to-gnathion. 0 is the top
//      of the head, 1 is the point of the chin. It is the front view's own
//      vertical divided by 219 px.
//   zn runs FORWARD, in the same units, from the opisthocranion (the back-most
//      point of the braincase) at 0. Glabella lands at 0.933 and the upper
//      alveolar margin, the front-most point of the whole skull, at 0.970.
//
// LY and LZ carry that frame into world units. LY is pinned by metrics at both
// ends -- LY(0) is the crown and LY(1) the chin, exactly -- so the vertical is
// not a choice. LZ's only free number is where the origin plane sits along the
// skull's length, and that is basion, which craniometry puts 0.38 of the length
// forward of opisthocranion.
const ATLAS_Y = M.y.ribcageTop + M.neck.length;
const Y_CROWN = M.y.crown - ATLAS_Y;
const Y_CHIN = M.y.chin - ATLAS_Y;
const HS = M.skull.height;              // crown to chin; the unit for everything
const Z_BASION = 0.380;
const LY = (v) => Y_CROWN - v * HS;
const LZ = (zn) => (zn - Z_BASION) * HS;

// The head's plan, measured rather than taken from metrics. See the comment
// above: metrics' own numbers are 0.1777 and 0.1386 of standing height and both
// are ~13% large for the height they have to live under.
const SKULL_L = 0.930 * HS;             // glabella to opisthocranion
const SKULL_W = 0.700 * HS;             // maximum breadth, at the parietal eminences
const HW = SKULL_W / 2;

// The bite plane, from metrics, and it checks out: metrics puts it at 0.8365 of
// crown-to-chin and the photograph's lateral puts the upper crowns at 0.822.
// M.skull.jawHeight is the one face number in metrics.js that needs no change.
const Y_BITE = Y_CHIN + M.skull.jawHeight;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Monotone (Fritsch-Carlson) interpolation through a table of [v, value].
//
// Not plain Catmull-Rom. A central-difference tangent at a LOCAL EXTREMUM is
// not zero, so the curve overshoots past it and comes back: at opisthocranion,
// which is exactly such an extremum, that draws a visible kink in the back of
// the head and moves the true furthest point off the landmark. Zeroing the
// tangent wherever the two secants disagree in sign makes every landmark a
// genuine turning point of the curve, which is also what rounds the brow.
function curveThrough(rows) {
  const n = rows.length;
  const xs = rows.map((r) => r[0]);
  const ys = rows.map((r) => r[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]
      + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1]
      + (t3 - t2) * h * m[i + 1];
  };
}

// --- the midsagittal outline ------------------------------------------------
// Read straight off the lateral view's silhouette. The braincase's front and
// back at each height, in zn.
//
// SCENE SCALE GOVERNS THIS TABLE NOW, AND THAT IS A CHANGE OF BRIEF. In the
// product the head is about seventy pixels tall, and at seventy pixels the only
// things the eye gets are the outline of the vault, two dark holes, a nose hole
// and a tooth row. Two of the shapes below were measured honestly off the
// photograph and still came out wrong at that size, so they are gone:
//
//   * THE GROOVE ABOVE THE BROW. The measured outline ran forward fast to zn
//     0.858 by v 0.26, then FLATTENED and came back a hair through v 0.28-0.35
//     before the brow threw forward again. That is three pixels on the
//     photograph and it is real, but it puts a VERTICAL PLANE across the front
//     of the forehead, and with the old separate brow bar standing under it the
//     pair read at scene scale as the flat crown of a cap over the brim of a
//     cap. It was the single weirdest thing in the picture. The frontal now
//     runs one continuous convex slope from the vertex to glabella, which is
//     less true of this specimen and much more like a skull at seventy pixels.
//   * THE OCCIPUT BULGES, and this one stays: the back line sits flat against
//     zn 0.000-0.008 either side of v 0.44, so the back of the head is a broad
//     rounded bulge rather than the end of a taper.
//
// The vault's own glabella is held at 0.905 rather than the measured 0.933
// because the supraorbital swelling (`browSwell`, in the field) carries the
// front-most point of the cranium out from there, exactly as a real brow ridge
// does.
//
// ROUND EIGHT MOVED BOTH OF THESE, AND THE REASON IS CURVATURE RATHER THAN
// POSITION. Neither outline was in the wrong place; both had a KINK in it, and
// a kink is what stops a round outline reading as a dome.
//
//   * THE OCCIPUT ARRIVED TOO EARLY. The old back rows fell zn 0.043 to 0.011
//     between v 0.203 and v 0.264, a slope of -0.52, and then 0.011 to 0.002
//     between v 0.264 and v 0.350, a slope of -0.10. The curvature drops by a
//     factor of five across one interval, which is a CORNER at the top rear of
//     the head: above it the back of the skull runs down and back at 27
//     degrees, below it it runs straight down. The back rows are now a p = 2.2
//     superellipse between the crown and the widest level, fitted through the
//     old v 0.102 row so the upper occiput does not move at all, and the
//     slope now falls smoothly from -0.72 to 0 instead of stepping.
//   * THE FRONTAL WAS FLAT. Against the same p = 2.2 curve the old front rows
//     ran up to 0.017 of the head's height BEHIND it through v 0.20 to v 0.40,
//     then jumped forward to meet the measured glabella: a shallow flat on the
//     forehead with a lip at the bottom of it, which is the ghost of the cap
//     brim the last pass deleted the bar for. The rows now sit about 60% of the
//     way from the measurement to the superellipse.
//
// The head does not get bigger from either change. Glabella and opisthocranion
// are untouched, so the length is what it was; the back moved forward more than
// the front did, so at v 0.264 the vault is 0.008 of the head's height SHORTER
// than before. It is rounder, not larger.
const VAULT_FRONT = curveThrough([
  [0.000, 0.416], [0.020, 0.578], [0.041, 0.639], [0.061, 0.685],
  [0.102, 0.766], [0.163, 0.812], [0.203, 0.839], [0.264, 0.868],
  [0.310, 0.882], [0.352, 0.891], [0.400, 0.900], [0.442, 0.905],
  [0.500, 0.892], [0.560, 0.868], [0.620, 0.828], [0.700, 0.775],
  [0.780, 0.726], [0.860, 0.686],
]);
const VAULT_BACK = curveThrough([
  [0.000, 0.416], [0.020, 0.272], [0.041, 0.219], [0.061, 0.187],
  [0.102, 0.130], [0.163, 0.077], [0.203, 0.053], [0.264, 0.027],
  [0.350, 0.006], [0.442, 0.000], [0.510, 0.008], [0.560, 0.030],
  [0.620, 0.068], [0.700, 0.148], [0.780, 0.205], [0.870, 0.268],
]);
// Half-breadth at each height, from the front view, scaled so the maximum is
// SKULL_W/2. The peak is at v 0.292 and it is a POINT rather than a band --
// the parietal eminence blob below puts it above and behind the ear, which is
// where the photograph's widest point is.
//
// THE POINTED CROWN CAME FROM THIS TABLE AND NOT FROM THE PROFILE. Above the
// eminence the old rows fell away far faster than an arc does: 0.085 at v 0.018
// and 0.158 at v 0.055 where a dome wants 0.117 and 0.195. The profile at the
// same heights is a genuine round cap already (half-depth 0.152 at v 0.02), so
// the top of the head was HALF AS WIDE AS IT WAS LONG: not a dome, a
// fore-and-aft KNIFE EDGE, and at scene scale it read as a sagittal crest
// running over the crown to a point at the top rear. It was the second thing
// the user's eye found after the brow.
//
// So everything from the vertex down to the eminence is now one half-ellipse:
// half-breadth 0.326 * sqrt(2u - u^2) with u = v / 0.292, which is the arc that
// meets the measured maximum at the measured height with zero slope, so the
// widest point is still exactly where the photograph puts it and nothing below
// v 0.292 moves at all. The vertex is still a mathematical point, as every
// surface of revolution's pole is, but the curve now approaches it as sqrt(v)
// rather than linearly, so the last visible cell is round.
//
// (The rows below v 0.292 that follow the ellipse are of course wider than the
// photograph's, by up to 15% at v 0.10. That is the trade: a measured vault
// that reads as a crest is worth less than a slightly full one that reads as a
// skull. Compare with the trim note that used to be here, which pulled these
// same rows DOWN to compensate for the parietal blend, and made the crest
// worse.)
//
// The ellipse's coefficient went 0.326 to 0.336 in round eight, and the rows
// below the eminence went with it, +3% throughout. Nothing about the head's
// breadth changed: the parietal blobs below were carrying the last 0.024 of the
// half-breadth on their own and were drawing a corner doing it (see
// `parietal`), so the smooth profile takes that width back and the blobs are
// shrunk by the same amount. Maximum half-breadth measured on the finished mesh
// is 0.350 of the head's height before and after.
const VAULT_HALFW = curveThrough([
  [0.000, 0.000], [0.008, 0.078], [0.020, 0.123], [0.041, 0.172],
  [0.070, 0.218], [0.102, 0.255], [0.140, 0.287], [0.180, 0.310],
  [0.235, 0.330], [0.292, 0.336], [0.347, 0.332], [0.402, 0.323],
  [0.456, 0.317], [0.511, 0.309], [0.566, 0.292], [0.620, 0.265],
  [0.700, 0.226], [0.780, 0.177], [0.860, 0.121],
]);
// How square the plan section is.
//
// THIS IS WHERE THE VAULT WAS SQUARE, AND IT IS THE FAULT THE OUTLINES COULD
// NOT SHOW. A superellipse of exponent p is round at 0 and 90 degrees whatever
// p is; p only moves the DIAGONAL. At p = 2.28 the 45 degree radius is 4%
// past the ellipse's and every extra percent lands on the four corners of the
// section, so a braincase that measures perfectly round in profile and in plan
// still has a soft edge running down each rear quarter of it and a facet
// between. Measured on the finished mesh the old plan section at v 0.34 stood
// 12.7% outside its own best-fit ellipse at 144 degrees and 3.2% inside it at
// 79 degrees: not a dome, a rounded box seen corner-on.
//
// The exponent was high because a much older build claimed the temporal fossa
// as a side effect of it. It does not any more -- FOSSA_CUT subtracts a real
// scoop from the half-breadth -- so nothing above the ear needs the section
// squared, and the braincase proper is now within 0.1 of a true ellipse. It
// still squares up below v 0.5, where the cranial base is genuinely boxy and
// where the arch wants a flat wall to stand off.
const VAULT_PLAN = curveThrough([
  [0.000, 2.02], [0.180, 2.05], [0.330, 2.10], [0.470, 2.22],
  [0.620, 2.38], [0.860, 2.40],
]);
// The section narrows toward its front: the frontal is a good deal narrower
// than the parietal region behind it. `s` is the signed position through the
// section's depth, -1 at the back and +1 at the front.
//
// The front factor used to be a single ramp, 0.60 at the top of the head to
// 0.86 at the bottom, and that is the other half of the square vault. At 0.60
// the section loses 20% of its half-breadth at 45 degrees off the midline,
// which measured as a genuine HOLLOW on the finished mesh: 14.4% inside the
// best-fit ellipse at 34 degrees at v 0.10, that is, a flat panel running down
// each side of the forehead with a crease at both of its edges. A real frontal
// is narrower than the parietal behind it, but it is narrower by being a
// smaller round section, not by being pinched.
//
// It is a TABLE now rather than a ramp, because a ramp gets the crown wrong
// whichever end you pin it at. A skull's plan is at its most ovoid through the
// forehead, where the temporal lines converge; at the vertex the section is a
// small near-circle and wants no taper at all, and below the ear it opens out
// again. The dip through v 0.18 to 0.36 is also what holds the brow swelling's
// fillet in: measured with a flat 0.79 taper the front quarter of the section
// stood 9% PROUD of its ellipse right across the brow's level, which is the
// soft line up the forehead the brow's own comment warns about.
//
// The back goes 0.90 to 0.94, for the roundness of the occiput.
const PLAN_FRONT = curveThrough([
  [0.000, 0.97], [0.100, 0.90], [0.220, 0.83], [0.360, 0.85],
  [0.520, 0.90], [0.860, 0.92],
]);
const planTaper = (v, s) => {
  const back = 0.94;
  return s >= 0
    ? 1 - (1 - PLAN_FRONT(v)) * s * s
    : 1 - (1 - back) * s * s;
};

// --- 2. the temporal fossa --------------------------------------------------
// A GENUINE HOLLOW, and it is cut by narrowing the vault's own section rather
// than by subtracting a solid from it. Two earlier shapes for this failed and
// both failures are worth keeping:
//
//   * The previous build claimed the fossa as a side effect of a plan exponent
//     -- "above the arch the side of the head is a plane" -- and a plane is not
//     a dish. With nothing hollowed out the arch had nothing to stand off and
//     no amount of proudness would have given it a shadow.
//   * A very large ellipsoid subtracted with smax IS a dish, but its depth is
//     the difference of two big numbers and falls away as the square of the
//     distance from the blob's own centre: a scoop measuring 0.028 deep at its
//     middle measured 0.004 where the arch actually spans it. Worse, an smax
//     against a field with a hard window in it puts extra zero crossings on the
//     sampling rays and the temple came out in horizontal stripes.
//
// Subtracting a constant from the half-breadth inside a smooth window has
// neither problem: the scoop is the same depth everywhere inside the window,
// the field stays a single smooth surface with one crossing per ray, and the
// window's own edges ARE the fossa's boundaries -- the temporal line above, the
// arch's span front to back, the cheek in front.
const FOSSA_CUT = 0.062;                // of the head's height, uniform
const fossaWindow = (v, zn) => smoothstep(0.24, 0.44, v) * (1 - smoothstep(0.56, 0.74, v))
  * smoothstep(0.02, 0.30, zn) * (1 - smoothstep(0.56, 0.86, zn));

// --- the parietal eminences -------------------------------------------------
// THE SAME TRICK WITH THE SIGN REVERSED, and it replaces a pair of blobs that
// were the single least round thing on the head.
//
// They used to be two superellipsoids smin'd into the vault with k = 0.055, and
// the reason they had to go is arithmetic rather than taste. The vault's own
// profile reached 0.326 of the head's height at the eminence and the head is
// 0.350 half-broad, so the blobs were carrying the last 0.024 by themselves,
// which they could only do through a fillet 0.132 of the head's height wide.
// A fillet that size does not add width at a point, it adds it across a whole
// quadrant: measured per height on the finished mesh, the plan section stood
// 15 to 17% outside its own best-fit ellipse at 135 to 150 degrees all the way
// from v 0.18 to v 0.30, against 1 to 5% everywhere else. That is a soft
// vertical edge down each rear quarter of the braincase with a flat between it
// and the midline, and it is what "the back of the head runs to a corner"
// looks like from behind.
//
// Adding to the half-breadth instead cannot do that. The section stays the one
// superellipse it was, so the swelling is spread over the section by the same
// curve that draws the rest of it, and the eminence is the profile's own
// maximum rather than a lump riding on it. The old blobs' stated job was to
// make the widest point a POINT rather than a horizontal band; VAULT_HALFW has
// had a rounded maximum at v 0.292 since the half-ellipse rewrite, so that job
// is already done and the window only has to say where along the head's length
// it happens.
// 0.022 rather than the 0.014 that would close the gap between VAULT_HALFW's
// 0.336 and the head's 0.350 half-breadth on paper: the temporal fossa's window
// still has a fifth of its depth open at v 0.30 and takes 0.013 back there.
// Measured on the finished mesh the maximum half-breadth is 0.353 of the head's
// height, against 0.351 for the pair of blobs this replaces.
const EMINENCE = 0.022;                 // of the head's height, added to the half-breadth
const eminenceWindow = (v, zn) => {
  const a = (v - 0.300) / 0.170;
  const b = (zn - 0.380) / 0.260;
  const t = a * a + b * b;
  return t >= 1 ? 0 : (1 - t) * (1 - t);
};

// --- the mid-face's relief --------------------------------------------------
// THE CANINE EMINENCE AND THE CANINE FOSSA, and they are an OFFSET TO THE FIELD
// rather than a blob smin'd on and an ellipsoid smax'd off. Same technique as
// the temporal fossa above and chosen for the same two reasons, which are
// written out at FOSSA_CUT and are worth repeating because this is where they
// bite hardest:
//
//   * A large ellipsoid subtracted with smax has a depth that is the difference
//     of two big numbers, so it falls away as the square of the distance from
//     its own centre: a hollow measuring 0.020 deep in the middle measures
//     0.003 at its edge, which is nothing, and the canine fossa is ALL edge --
//     what makes it read is the rim it shares with the canine eminence.
//   * An smax against a field that already has a hard window in it puts extra
//     zero crossings on the sampling rays. The temple came out in horizontal
//     stripes the time that was tried, and the mid-face has three cut openings
//     within 0.1 of the head's height of here.
//
// An offset inside a smooth window has neither problem, and its depth is the
// number written here rather than the difference of two large ones. Positive
// moves the surface IN (the fossa), negative moves it OUT (the eminence).
//
// SIZE. The windows are drawn wide on purpose. A field offset of A over a
// window of width W tilts the surface by about A/W, and the offset stops being
// a dent in a surface and becomes a fold in one once that reaches 1. Worst case
// here, all three of the fossa's edges at once, is 0.79. That is the whole
// reason the cut is 0.020 of the head's height and not the 0.030 the
// photograph's shadow suggests.
const CANINE_CUT = 0.020;               // of the head's height, the fossa's depth
const JUGUM_RISE = 0.017;               // of the head's height, over the canine root
// 1 at the middle, 0 at radius 1, flat at both ends. A swelling wants a bump
// and not a window: a window has a plateau, and a plateau on the front of a
// face is the slab this whole block exists to get rid of.
const bump = (t2) => (t2 >= 1 ? 0 : (1 - t2) * (1 - t2));

function maxillaRelief(x, y, z) {
  const zn = z / HS + Z_BASION;
  // Shut behind the face. Nothing this does can reach the temple, the back of
  // the cheekbone or the inside of the orbit.
  const facing = smoothstep(0.830, 0.900, zn);
  if (facing <= 0) return 0;
  const v = (Y_CROWN - y) / HS;
  const ax = Math.abs(x) / HS;
  // The fossa: lateral to the canine eminence, below the infraorbital margin,
  // shutting again where the cheekbone starts to come forward. Its lateral
  // edge IS the zygomaticomaxillary step -- the two are the same fact seen
  // from either side, which is why there is one window and not two.
  const fossa = smoothstep(0.100, 0.160, ax) * (1 - smoothstep(0.190, 0.245, ax))
    * smoothstep(0.540, 0.610, v) * (1 - smoothstep(0.715, 0.785, v));
  // The eminence over the canine's root. It runs down and out, following the
  // root, so the bump is measured in a frame that leans with it.
  const jx = (ax - 0.105 - 0.10 * (v - 0.700)) / 0.072;
  const jv = (v - 0.700) / 0.110;
  return facing * (CANINE_CUT * fossa - JUGUM_RISE * bump(jx * jx + jv * jv)) * HS;
}

const V_BASE = 0.870;                   // where the braincase's surface closes

// The braincase, as a field. Negative inside.
function vaultField(x, y, z) {
  const v = (Y_CROWN - y) / HS;
  if (v < -0.02) return (-0.02 - v) * HS + 0.02;
  if (v > V_BASE) return (v - V_BASE) * HS + 0.02;
  const zn = z / HS + Z_BASION;
  const f = VAULT_FRONT(v), b = VAULT_BACK(v);
  const hd = (f - b) / 2;
  const c = (f + b) / 2;
  if (hd <= 1e-4) return 0.05;
  const s = (zn - c) / hd;
  if (Math.abs(s) > 3) return Math.abs(s) * 0.02;
  const w = VAULT_HALFW(v) * planTaper(v, Math.max(-1, Math.min(1, s)))
    + EMINENCE * eminenceWindow(v, zn)
    - FOSSA_CUT * fossaWindow(v, zn);
  if (w <= 1e-4) return 0.05;
  const p = VAULT_PLAN(v);
  const q = Math.pow(Math.abs(x / (w * HS)), p) + Math.pow(Math.abs(s), p);
  const unit = Math.min(w, hd) * HS;
  return (Math.pow(q, 1 / p) - 1) * unit;
}

// --- the openings -----------------------------------------------------------
// DELIBERATELY LARGER THAN THE PHOTOGRAPH, AND THIS IS THE BIGGEST STYLISATION
// IN THE FILE. Measured off the front view the orbit is 47 px by 36 px against
// a 219 px skull, so 0.215 by 0.170 of crown-to-chin, and that is what was
// built for two rounds. In the product the head is about seventy pixels tall,
// which makes a measured orbit twelve pixels high: it disappears into the
// shading and what is left is a big pale dome with two specks in it. The orbits
// are the thing that says "skull" and they are the first thing the eye finds,
// so if the anatomically correct size does not read at seventy pixels then the
// anatomically correct size is wrong for this character. The pumpkins in this
// same scene have their carved faces oversized for exactly this reason.
//
// 0.245 by 0.215 is +14% wide and +26% tall, checked at scene scale rather than
// on a turntable. It is roughly the orbit of a child's skull, which is also why
// it stays friendly: a big round socket is not a threatening one, a small one
// under a heavy brow is.
//
// ORBIT_U moves out with the width so the bone bridge between the two openings
// keeps the thickness it had; the medial edges sit 0.072 of the head's height
// off the midline either side, against the nasal aperture's 0.063.
const SOCKET_W = 0.245 * HS;
const SOCKET_H = 0.215 * HS;
// Up from 0.435. Not anatomy: with the camera looking down on the figure the
// vault eats screen area that the face does not, so the whole face reads as
// pushed into the bottom of the head. Lifting the eye line 0.015 of the head's
// height and dropping the nose 0.015 splits the difference between the two
// complaints, cranium too big and features too low, without moving a metric.
const ORBIT_V = LY(0.412);
const SLANT = M.skull.socket.slant;
// metrics gives a socket as a bounding box, and rotating an ellipse by s takes
// semi-axes (A, B) to a box of halfW^2 = A^2 cos^2 s + B^2 sin^2 s and
// halfH^2 = A^2 sin^2 s + B^2 cos^2 s. This is that, inverted, so the slant can
// be tuned without the opening changing size.
const SOCKET = (() => {
  const cs = Math.cos(SLANT), sn = Math.sin(SLANT);
  const hw = SOCKET_W / 2, hh = SOCKET_H / 2;
  const c2 = cs * cs - sn * sn;
  return {
    a: Math.sqrt(Math.max(1e-8, (hw * hw * cs * cs - hh * hh * sn * sn) / c2)),
    b: Math.sqrt(Math.max(1e-8, (hh * hh * cs * cs - hw * hw * sn * sn) / c2)),
    cs, sn,
  };
})();

// The nasal aperture. Height comes off the LATERAL view, not the front one: the
// front view's specimen is tipped forward and its lower rim is a lit edge, so
// the dark region there stops 0.08 of the head's height short of the real
// nasospinale. Nasion to nasospinale measured on the lateral is 0.193 of
// crown-to-chin and the craniometric mean is 0.190, so it is 0.230 counting the
// aperture's apex above nasion. Width is 0.115, the front view's 24 px.
// Width goes up with the orbits and for the same reason: the front view's 24 px
// is 0.115 of the head, which is eight pixels at scene scale and reads as a
// scratch. Height is held (it is the one facial opening that was already big
// enough).
//
// THE CENTRE COMES BACK UP 0.012, which is most of the 0.015 an earlier pass
// dropped it by, and the maxilla is why. With the floor at v 0.7375 there were
// 0.052 of the head's height between the aperture and the tooth crowns: at
// seventy pixels that is THREE AND A HALF PIXELS of subnasal bone, so the nose
// hole and the tooth row touched and the two strongest marks on the lower face
// merged into one. At v 0.7255 it is 0.065, near five pixels, and the alveolar
// process has somewhere to be. The apex rises with it, from v 0.5225 to v
// 0.5105, and that costs nothing: the aperture is a point at its apex (see
// `nasalShape`) and it runs up BETWEEN the orbits, whose own floors are at v
// 0.5195 and whose medial edges are 0.0715 off the midline against the
// aperture's 0.014 at that height.
const NASAL_W = 0.128 * HS;
const NASAL_H = 0.215 * HS;
const NASAL_V = LY(0.618);

// Where the face is unwrapped from, and at what radius. u is arc length round
// the vertical axis through P0 measured at FACE_R, v is world height; the
// sphere grid the cranium is sampled on is a grid IN that space, so cutting a
// hole needs no CSG. FACE_R is the axis-to-glabella distance, so an opening on
// the front of the face keeps the size it was authored at.
const P0 = new THREE.Vector3(0, LY(0.500), LZ(0.430));
const FACE_R = LZ(0.933) - P0.z;
const ORBIT_U = 0.194 * HS;             // bearing of the socket's centre, times FACE_R

// Bone thickness at the edge of a cut, and so the depth of the wall inside
// every opening. Below about two grid cells the wall has less than one quad of
// shading in it and reads as a painted line; above about 3% of the head's
// height it exceeds the radius of curvature of the valley between the nasal
// aperture and an orbit's medial wall and folds through itself.
const WALL_T = 0.023 * HS;
const WALL_LIP = 0.42 * WALL_T;         // how far the outer ring laps back over the skin
const WALL_PROUD = 0.02 * WALL_T;
const WALL_TAPER = 0.18 * WALL_T;
const ORBIT_CAVITY = 0.150 * HS;
const NASAL_CAVITY = 0.080 * HS;
// How far the soft shade outside an opening reaches, and how dark it gets (the
// 0.24 in the paint loop below, up from 0.16). Both are legibility numbers: at
// seventy pixels an opening is six or seven pixels across and the rim's own
// shading is one of them, so a ring of shade around it is most of what makes it
// read as a hole rather than as a grey mark.
const AO_REACH = 0.038 * HS;

// Tessellation. Set by the openings, not by the silhouette: the vault is smooth
// at a third of this, but the edge of a cut is a contour crossing the grid at
// an arbitrary angle and can only be as clean as the grid it lands on.
const NTH = 288;
const NPH = 184;

// Polynomial smooth minimum. k is a real length, so a fillet between two parts
// is the same size wherever it happens.
const smin = (a, b, k) => {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

// A superellipsoid as a field, scaled by its smallest semi-axis so the value is
// roughly a length. Two exponents: `ph` squares off the plan and `pv` the
// profile, and they have to be independent, because the maxilla is flat
// underneath and rounded in plan.
function blob(c, s, ph, pv = ph) {
  const unit = Math.min(s[0], s[1], s[2]);
  return (x, y, z) => {
    const ax = Math.abs((x - c[0]) / s[0]);
    const ay = Math.abs((y - c[1]) / s[1]);
    const az = Math.abs((z - c[2]) / s[2]);
    if (ax > 4 || ay > 4 || az > 4) return 1e3;
    const h = Math.pow(Math.pow(ax, ph) + Math.pow(az, ph), pv / ph) + Math.pow(ay, pv);
    return (Math.pow(h, 1 / pv) - 1) * unit;
  };
}

// A capsule chain as a field: the distance to a polyline, minus a radius. Used
// for ridges that have to follow a path (the temporal line, the alveolar
// margin) rather than sit at a place.
function tube(rough, r) {
  const points = rough.length > 2
    ? new THREE.CatmullRomCurve3(rough, false, 'centripetal', 0.5).getSpacedPoints(40)
    : rough;
  const n = points.length;
  const p = new Float32Array(n * 3);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const q = points[i];
    p[i * 3] = q.x; p[i * 3 + 1] = q.y; p[i * 3 + 2] = q.z;
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); z0 = Math.min(z0, q.z);
    x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); z1 = Math.max(z1, q.z);
  }
  const pad = r * 3;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  return (x, y, z) => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return 1e3;
    let best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      const ex = p[i * 3 + 3] - ax, ey = p[i * 3 + 4] - ay, ez = p[i * 3 + 5] - az;
      const wx = x - ax, wy = y - ay, wz = z - az;
      const ee = ex * ex + ey * ey + ez * ez;
      let t = ee > 0 ? (wx * ex + wy * ey + wz * ez) / ee : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - ex * t, dy = wy - ey * t, dz = wz - ez * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best) - r;
  };
}

// Where a horizontal ray at height y and bearing ang leaves a field. Used to
// lay a ridge ON the surface rather than at a guessed radius: author how proud
// it stands, never its x and z.
function surfaceRho(field, ang, y) {
  const sx = Math.sin(ang), sz = Math.cos(ang);
  let lo = 0, hi = SKULL_L;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (field(sx * mid, y, sz * mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- the socket's outline ---------------------------------------------------
// A rounded rectangle rather than an ellipse. The reference is explicit: a real
// orbit is roughly square with generously rounded corners, and a true ellipse
// reads as a cartoon eye. The top edge is the flatter of the two, because the
// supraorbital margin is a sharp edge and the inferior one is rounded off.
//
// The taper is slight and it is the real thing -- an orbit is a touch shallower
// at its medial corner -- rather than an expression. What made an earlier pass
// scowl was a taper of 0.6 with a slant of 0.60 under it; at 0.88 and 0.12 a
// square opening is just a square opening.
const SOCKET_PX = 2.5;
const socketTaper = (kx) => 0.88 + 0.12 * smoothstep(-1, 0.35, kx);
function socketShape(kx, ky) {
  const k = ky / socketTaper(kx);
  const e = ky > 0 ? 2.7 : 2.2;
  return Math.pow(Math.abs(kx), SOCKET_PX) + Math.pow(Math.abs(k), e);
}
function socketTop(kx) {
  const rem = 1 - Math.pow(Math.abs(kx), SOCKET_PX);
  return rem <= 0 ? 0 : socketTaper(kx) * Math.pow(rem, 1 / 2.7);
}
function socketToFace(side, q, w) {
  return [
    side * (ORBIT_U + q * SOCKET.cs - w * SOCKET.sn),
    ORBIT_V + q * SOCKET.sn + w * SOCKET.cs,
  ];
}

// The nasal aperture: an inverted pear, narrow at the top where it runs up
// between the orbits, widening to a sharp lower rim, with the anterior nasal
// spine notching the middle of that rim. b runs -1 at the floor to +1 at the
// apex. The photograph's is unmistakably a heart rather than a keyhole and the
// notch is what does it.
function nasalShape(a, b) {
  const w = Math.pow(clamp01((1 - b) / 2), 0.48);
  const t = Math.pow(Math.abs(a / Math.max(0.10, w)), 2.4) + Math.pow(Math.abs(b), 2.8);
  const sa = a / 0.30, sb = (b + 0.86) / 0.26;
  return t + 0.40 * Math.exp(-(sa * sa + sb * sb));
}

// --- outlines, as closed loops in face space --------------------------------
// Walked off the shape function itself rather than written out a second time,
// so the hole, the wall inside it and the bowl behind it are the same curve by
// construction.
function outlineFrom(shape, n, toFace) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const cx = Math.cos(t), cy = Math.sin(t);
    // March out until the shape function passes 1, then bisect. Marching first
    // matters for the nasal aperture: the spine's bump ADDS to the function
    // inside the outline, so a blind bisection over [0, 2] can trap the wrong
    // crossing on the rays that pass through it.
    let lo = 0, hi = 0.05;
    while (hi < 3 && shape(hi * cx, hi * cy) < 1) { lo = hi; hi += 0.05; }
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (shape(mid * cx, mid * cy) < 1) lo = mid; else hi = mid;
    }
    pts.push(toFace(((lo + hi) / 2) * cx, ((lo + hi) / 2) * cy));
  }
  // Wound counter-clockwise so "into the cut" is one fixed rotation of the edge
  // tangent everywhere. A left socket comes out of socketToFace mirrored and
  // would otherwise carry every wall normal backwards.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const f = pts[i], g = pts[(i + 1) % pts.length];
    area += f[0] * g[1] - g[0] * f[1];
  }
  if (area < 0) pts.reverse();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of pts) {
    if (q[0] < minX) minX = q[0];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] < minY) minY = q[1];
    if (q[1] > maxY) maxY = q[1];
  }
  return { pts, minX, maxX, minY, maxY };
}

// Crossing count, bounding box first: without the box this runs every grid
// vertex against every outline point and costs more than the mesh does.
function inCut(cut, X, Y) {
  if (X < cut.minX || X > cut.maxX || Y < cut.minY || Y > cut.maxY) return false;
  const pts = cut.pts;
  let hit = false;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const yi = pts[i][1], yk = pts[k][1];
    if ((yi > Y) !== (yk > Y) && X < ((pts[k][0] - pts[i][0]) * (Y - yi)) / (yk - yi) + pts[i][0]) hit = !hit;
  }
  return hit;
}

// Nearest point on an outline and the inward normal of the segment it landed
// on. That normal is what the wall is built against, so each rim vertex carries
// its own direction into the cut and no loop tracing is needed.
function snapTo(cut, X, Y) {
  const pts = cut.pts;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const f = pts[i], g = pts[(i + 1) % pts.length];
    const ex = g[0] - f[0], ey = g[1] - f[1];
    const len2 = ex * ex + ey * ey || 1e-12;
    const t = Math.min(1, Math.max(0, ((X - f[0]) * ex + (Y - f[1]) * ey) / len2));
    const cx = f[0] + ex * t, cy = f[1] + ey * t;
    const d = (X - cx) * (X - cx) + (Y - cy) * (Y - cy);
    if (d < bestD) {
      bestD = d;
      const inv = 1 / (Math.hypot(ex, ey) || 1);
      best = { X: cx, Y: cy, nx: -ey * inv, ny: ex * inv, d: 0 };
    }
  }
  best.d = Math.sqrt(bestD);
  return best;
}

// --- swept solids -----------------------------------------------------------
// A bar carrying an AUTHORED, possibly ASYMMETRIC cross-section.
//
// `centre(u, out)` gives the section's centre and `section(u)` an array of
// [h, v] offsets tracing the section once, counter-clockwise in a frame whose
// v is world up flattened into the ring's plane and whose h is the horizontal
// perpendicular to the sweep. So "up" is always up however the bar turns,
// which a Frenet frame will not give you because a Frenet frame rolls.
//
// The asymmetry is the point and it is what bone.js cannot do. `shaft` sweeps a
// radius and both it and a swept superellipse are symmetric about their own
// centre line, so neither can make a section that is blunt on one side and
// drawn in on the other, which the mandible needs at the gonial angle. The
// section list is resampled to a constant length by the caller.
//
// The mandible is now the only caller. A supraorbital shelf used to be the
// other, and the two notes below are kept because they are what that shelf cost
// to get right and the next asymmetric bar will pay the same price.
//
// The seam column is NOT duplicated: two coincident columns get separately
// averaged normals and draw a crease.
// `frame(u, side, vup, T)` overrides the default frame: some bars want one that
// does NOT follow the path. Wherever a path runs vertically, its tangent is
// nearly parallel to up, `T cross up` collapses to zero and the default frame
// flips over. On the old brow that drew the shelf as two flat sheets standing
// out sideways from the face, a whole afternoon of looking for a winding bug
// that was not there; on the mandible it is the ramus.
function sweepShape(centre, section, uMin, uMax, nU, { capStart = true, capEnd = true, frame = null } = {}) {
  const nR = section(uMin).length;
  const verts = [];
  const idx = [];
  const c = new THREE.Vector3();
  const T = new THREE.Vector3();
  const side = new THREE.Vector3();
  const vup = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const du = (uMax - uMin) / nU;
  for (let i = 0; i <= nU; i++) {
    const u = uMin + du * i;
    centre(u, c);
    centre(u + du * 0.02, a);
    centre(u - du * 0.02, b);
    T.subVectors(a, b).normalize();
    if (frame) {
      frame(u, side, vup, T);
    } else {
      side.crossVectors(T, up);
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
      side.normalize();
      vup.crossVectors(side, T).normalize();
    }
    const sec = section(u);
    for (let j = 0; j < nR; j++) {
      const [h, w] = sec[j];
      verts.push(
        c.x + side.x * h + vup.x * w,
        c.y + side.y * h + vup.y * w,
        c.z + side.z * h + vup.z * w,
      );
    }
  }
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nR; j++) {
      const j2 = (j + 1) % nR;
      const a0 = i * nR + j, b0 = i * nR + j2;
      const a1 = (i + 1) * nR + j, b1 = (i + 1) * nR + j2;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // A sweep with an open end reads as a chip out of the bone, exactly as
  // bone.js warns about TubeGeometry. Fan each free end shut on its own centre.
  const capAt = (ring, flip) => {
    centre(ring === 0 ? uMin : uMax, c);
    const base = verts.length / 3;
    verts.push(c.x, c.y, c.z);
    const o = ring * nR;
    for (let j = 0; j < nR; j++) {
      const j2 = (j + 1) % nR;
      if (flip) idx.push(base, o + j2, o + j); else idx.push(base, o + j, o + j2);
    }
  };
  if (capStart) capAt(0, false);
  if (capEnd) capAt(nU, true);
  // WHICH WAY ROUND IT CAME OUT IS MEASURED, NOT DERIVED. The section's winding
  // fixes the orientation only relative to the direction the sweep runs in, and
  // a symmetric pair is naturally authored running in opposite directions, so
  // one of the two comes out inside out and back-face culls. Two rounds of
  // hand-deriving the handedness from (T, side, vup) got it wrong both times
  // and it looks exactly like a bar buried too deep, so: close the solid, take
  // its signed volume, and reverse every triangle if it is negative. A few
  // thousand dot products, once, and it cannot be got wrong again.
  if (capStart && capEnd) {
    let vol = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const p = idx[i] * 3, q = idx[i + 1] * 3, r = idx[i + 2] * 3;
      const ax = verts[p], ay = verts[p + 1], az = verts[p + 2];
      const bx = verts[q], by = verts[q + 1], bz = verts[q + 2];
      const cx = verts[r], cy = verts[r + 1], cz = verts[r + 2];
      vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// A process: a superellipsoid that tapers to a rounded POINT at one end. The
// mastoid and the coronoid are both this, and neither can be a blob in the
// field, because smin rounds a point off exactly as fast as you sharpen it and
// the blend radius that hides the join is the same radius that eats the tip.
// `narrow` is how far the far end draws in; `sign` is +1 to point up, -1 down.
function processGeometry(hx, hy, hz, { exp = 2.6, narrow = 0.4, sign = -1 } = {}) {
  const geo = new THREE.SphereGeometry(0.5, 18, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 2, y = pos.getY(i) * 2, z = pos.getZ(i) * 2;
    const n = Math.pow(
      Math.pow(Math.abs(x), exp) + Math.pow(Math.abs(y), exp) + Math.pow(Math.abs(z), exp),
      1 / exp,
    );
    const k = 0.5 / Math.max(1e-6, n);
    const ty = y * k;
    const t = mix(1.0, narrow, smoothstep(-sign * 0.15, sign * 0.42, ty));
    pos.setXYZ(i, x * k * 2 * hx * t, ty * 2 * hy, z * k * 2 * hz * t);
  }
  geo.computeVertexNormals();
  return geo;
}

// A tooth. bone.js has no vocabulary for one and should not: a tooth is a
// rounded block, not a shaft or a plate, and a superellipsoid at exponent ~3 is
// a block with no edge on it anywhere, which is the house look in one line.
function toothGeometry(w, h, d) {
  const geo = new THREE.SphereGeometry(0.5, 14, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 2, y = pos.getY(i) * 2, z = pos.getZ(i) * 2;
    const n = Math.pow(
      Math.pow(Math.abs(x), 3.1) + Math.pow(Math.abs(y), 3.1) + Math.pow(Math.abs(z), 3.1),
      1 / 3.1,
    );
    const k = 0.5 / Math.max(1e-6, n);
    pos.setXYZ(i, x * k * w, y * k * h, z * k * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// --- the tooth rows ---------------------------------------------------------
// A parabolic arch, arc-length parameterised so the teeth come out evenly
// spaced instead of bunching at the front where the parabola is flat. The curve
// describes the OUTER face of the row; everything else in the mouth is that
// curve inset, which is what keeps bone from creeping in front of the crowns.
// The upper row moved forward 0.013 of the head's height in round eight and it
// is the one thing outside the maxilla that the maxilla forced. With the
// alveolar process built out to zn 0.962 the old row's crowns, whose outer
// faces sat at zn 0.947, were a pixel BEHIND the bone above them and the tooth
// row stopped being one of the four marks that reach the viewer. They are
// flush now. The lower row does not move (it is the mandible's, and it is not
// this pass's), so the overjet goes from 0.013 to 0.026 of the head's height,
// which is under two pixels and is the direction the photograph's specimen
// errs in anyway: its upper incisors overhang its lower ones plainly.
const UPPER_ARCH = { halfW: 0.173 * HS, front: LZ(0.958), back: LZ(0.700) };
const LOWER_ARCH = { halfW: 0.152 * HS, front: LZ(0.932), back: LZ(0.690) };
const TOOTH_H = 0.062 * HS;
const TOOTH_D = 0.040 * HS;
// How far apart the rows sit with the jaw shut. 0.009 of the head's height is
// four thousandths of a world unit, which is a third of a pixel at scene scale:
// the two rows fused into one pale band and the mouth vanished, which is the
// fifth thing the user's crop shows and the reason it barely registers as a
// face. 0.022 is a dark line two or three pixels deep, and a real skull in
// occlusion shows exactly such a line between the crowns.
const AJAR = 0.022 * HS;

function archCurve({ halfW, front, back }, y, { inset = 0, extend = 1, flare = 0 } = {}) {
  const pts = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const u = (-1 + (2 * i) / n) * extend;
    const out = 1 + flare * Math.max(0, Math.abs(u) - 1);
    pts.push(new THREE.Vector3(
      (halfW - inset) * u * out,
      y,
      front - inset - (front - back) * u * u,
    ));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
}

// --- the mandible -----------------------------------------------------------
// Not in the field, and not because of a rendering trick: it moves. The photo's
// specimen has one, biting shut, and it is measured with the rest.
//
// Verticals, in the measured frame: condylion at v 0.500, level with the top of
// the ear canal; gonion at v 0.828; gnathion at v 1.000, which metrics pins.
// The bite plane at v 0.8365 is metrics' own and the photograph agrees with it
// to 1.5%.
const HINGE_Y = LY(0.540);
const HINGE_Z = LZ(0.350);
const HINGE_X = 0.305 * SKULL_W;

// THE MANDIBLE IS ONE SWEPT BONE, condyle to condyle.
//
// The previous build made it a body plus two flat plates for the rami, and the
// plates were the worst thing on the head: an extrusion has two big flat faces,
// the key lamp catches one of them broadside, and what the lateral and rear
// views showed was a paddle stuck on the side of the skull with a visible seam
// where it met the body. Bellying the plate out helped and did not fix it,
// because the fault is the seam, not the flatness. A real mandible has no seam
// there: it is one bone, and the gonial angle is simply where it turns.
//
// So the sweep runs right condyle, down the right ramus, round the angle, along
// the body, round the chin, and back out to the left condyle, and the SECTION
// morphs along it: a deep rounded bar under the teeth, a broad thin plate up
// the ramus, a small knob at the condyle. That needs an authored asymmetric
// frame as well as an authored section, because at the ramus the sweep is
// vertical and `T cross up` collapses -- see sweepShape.
//
// What it costs: no coronoid process and no mandibular notch. A single sweep
// cannot fork, and the alternative is another separate plate, which is the
// thing being fixed. The notch is hidden behind the zygomatic arch from every
// angle but a straight lateral one, and a ramus with a smooth top edge is a far
// smaller error than a paddle.
//
// Stations, from the chin outward. v and zn are the measured frame; x is a
// fraction of the head's breadth; ht is the half thickness across the bone and
// hb the half breadth IN its own plane, which is the body's depth under the
// teeth and the ramus's front-to-back width once the sweep has turned upright;
// p is the section's superellipse exponent; and nx/nz is the outward horizontal
// the thickness is measured along.
const JAW_STATIONS = [
  //  x      v      zn     ht     hb     p    nx    nz
  [0.000, 0.939, 0.876, 0.050, 0.061, 3.0, 0.00, 1.00],   // chin
  [0.052, 0.936, 0.862, 0.048, 0.058, 2.9, 0.28, 0.96],
  [0.104, 0.928, 0.822, 0.046, 0.052, 2.8, 0.55, 0.84],
  [0.150, 0.917, 0.774, 0.043, 0.045, 2.7, 0.72, 0.69],
  [0.190, 0.902, 0.714, 0.041, 0.038, 2.6, 0.86, 0.51],
  [0.235, 0.884, 0.640, 0.039, 0.034, 2.5, 0.94, 0.34],
  [0.290, 0.860, 0.540, 0.037, 0.034, 2.5, 0.98, 0.20],
  [0.352, 0.826, 0.428, 0.037, 0.058, 2.4, 1.00, 0.06],   // the gonial angle
  [0.344, 0.756, 0.382, 0.033, 0.090, 2.3, 1.00, 0.00],   // up the ramus
  [0.322, 0.646, 0.362, 0.029, 0.094, 2.3, 1.00, 0.00],
  [0.305, 0.540, 0.350, 0.032, 0.032, 2.2, 1.00, 0.00],   // condylion
];
const GONION_X = JAW_STATIONS[7][0] * SKULL_W;
const GONION_Y = LY(JAW_STATIONS[7][1]);
const GONION_Z = LZ(JAW_STATIONS[7][2]);

// --- pieces that are meshes, not field --------------------------------------
// There used to be a supraorbital shelf here: a swept bar with an authored
// asymmetric wedge section, buried in the frontal so that its lower-front edge
// could overhang the socket, which a single sampled field cannot do. It is
// gone. See `browSwell` in buildSkull for why: the overhang was real and the
// hard crest that came with it read at scene scale as the brim of a cap.

export function buildSkull({ material }) {
  const group = new THREE.Group();
  // Pieces of the mandible that are built up with the cranium (they need the
  // same helpers) but belong under the jaw's hinge once it exists.
  const jawRootPending = [];
  const geometries = [];
  const materials = [];
  const track = (g) => { geometries.push(g); return g; };

  // The cranium, the walls in its cuts and the bowls behind them carry vertex
  // colours; the teeth and the mandible do not, so they keep the shared
  // material untouched and the head stays the same bone as the body.
  const skin = material.clone();
  skin.vertexColors = true;
  materials.push(skin);

  const add = (geo, mat, name = '') => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ================================================================ the field
  // Only what is genuinely one continuous surface goes in here.

  // ===================================================== THE MAXILLA, REBUILT
  //
  // WHAT IT USED TO BE: one superellipsoid, [0.186, 0.1225, 0.150] of the head's
  // height at exponent 3.0 by 3.4, centred at v 0.668 and zn 0.812. A
  // superellipsoid at exponent 3 is a rounded BOX. Measured on the finished
  // mesh that box gave a mid-face with no relief in it in either direction:
  //
  //   * DOWN a line through the canine, |x| 0.085 to 0.115 of the head's
  //     height, the surface ran zn 0.9540 at v 0.594, 0.9556 at v 0.623, 0.9555
  //     at v 0.680, 0.9537 at v 0.723. Eighteen ten-thousandths of the head's
  //     height of relief across a third of the face: a vertical wall, and one
  //     that then FELL BACK to zn 0.917 at the alveolar margin, so the front of
  //     the face leaned backwards from the brow to the teeth.
  //   * ACROSS it at v 0.62 the surface fell from zn 0.961 at the midline to
  //     0.847 at |x| 0.275 without a single reversal. A real mid-face has three
  //     across that line: out over the canine root, back into the canine fossa,
  //     out again onto the cheekbone.
  //
  // It is four things now, and each of them answers one of those.
  //
  // 1. THE MASS, AS TWO BLOBS RATHER THAN ONE, because the mid-face PROJECTS AS
  //    IT DESCENDS and one superellipsoid has a vertical front face at every
  //    height it covers. The upper is the infraorbital plate under the orbits;
  //    the lower is the alveolar process that carries the teeth, and it sits
  //    0.046 of the head's height further forward and 0.130 lower. Their smin
  //    is the face plane's downward-forward rake. The exponents come down from
  //    3.0/3.4 to 2.7/2.9 and 2.8/3.1 as well: a flat front panel is the other
  //    half of why the old one read as a slab, and the alveolar process keeps
  //    the flatter of the two because it does have to be flat underneath, where
  //    the tooth row hangs off it.
  const maxBody = blob(
    [0, LY(0.596), LZ(0.792)],
    [0.180 * HS, 0.092 * HS, 0.146 * HS], 2.7, 2.9,
  );
  const maxAlveolar = blob(
    [0, LY(0.722), LZ(0.826)],
    [0.172 * HS, 0.082 * HS, 0.120 * HS], 2.8, 3.1,
  );
  const maxilla = (x, y, z) => smin(maxBody(x, y, z), maxAlveolar(x, y, z), 0.020);

  // 2. THE ANTERIOR NASAL SPINE, at the midline on the aperture's floor. Tiny,
  //    and it is not here to be seen at seventy pixels: it is here because the
  //    lower rim of the nasal aperture is a CUT through the field, and a cut is
  //    only as sharp as the surface it is cut in is convex. With a spine under
  //    it the floor of the aperture leaves the face at an angle and the rim
  //    reads as an edge; without one it leaves flat and the rim reads as a
  //    line drawn on a wall.
  const nasalSpine = blob(
    [0, NASAL_V - NASAL_H * 0.44, LZ(0.945)],
    [0.026 * HS, 0.028 * HS, 0.030 * HS], 2.2, 2.6,
  );

  // The cranial base. Anatomically the occipital condyles sit at 0.65 of
  // crown-to-chin and metrics parents the head at 0.808, so this reaches
  // further down and back than a real basiocciput to cover the top of the neck.
  // See the note at the top of the file; it is the one deliberate departure
  // from the photograph in the whole build and it is invisible from outside.
  const cranialBase = blob(
    [0, LY(0.790), LZ(0.470)],
    [0.150 * HS, 0.100 * HS, 0.160 * HS], 2.6, 3.0,
  );

  const base = (x, y, z) => {
    let d = smin(vaultField(x, y, z), maxilla(x, y, z), 0.040);
    d = smin(d, cranialBase(x, y, z), 0.050);
    d = smin(d, nasalSpine(x, y, z), 0.012);
    // 3 and 4: the canine eminence and the canine fossa, as an offset. It goes
    // on HERE, before the cheekbone and the orbital rim are unioned in, so that
    // the fossa is a hollow in the maxilla with the zygomatic standing at the
    // far side of it rather than a dent pressed into both.
    return d + maxillaRelief(x, y, z);
  };

  // The parietal eminences are no longer built here. See EMINENCE, above the
  // field: they are a swelling of the vault's own half-breadth now.

  // The nasal bones. Small, and there for the PROFILE: with the glabella above
  // and the aperture's apex below, the midline strip between the orbits is
  // otherwise a flat continuation of the forehead and the whole front of the
  // head reads as one convex sweep. A real one steps -- glabella out, nasion
  // in, nasal bones out again -- and the notch at nasion is what tells the eye
  // where the braincase stops and the face starts. The dip is not modelled; it
  // is the gap between this and the brow, which is why neither is blended wide.
  const nasalBone = blob(
    [0, LY(0.575), LZ(0.888)],
    [0.046 * HS, 0.050 * HS, 0.045 * HS], 2.4, 2.2,
  );

  // The zygomatic bone, and the root of the arch on the temporal just above and
  // in front of the ear. These two are the arch's ABUTMENTS and they are the
  // only part of the arch in the field; the span between them is a separate
  // mesh standing off the side of the head with daylight behind it.
  const malar = (side) => blob(
    [side * 0.282 * SKULL_W, LY(0.556), LZ(0.808)],
    [0.140 * SKULL_W, 0.082 * HS, 0.098 * HS], 2.6);
  // The lateral orbital margin: the frontal process of the zygomatic, a narrow
  // vertical bar at the outer edge of each orbit running from the end of the
  // brow down to the cheek. In profile it is the one feature that makes an
  // orbit read as a socket rather than as a hole in the side of a dome: a rim
  // standing forward with the temporal fossa dropping away behind it. Kept
  // strictly LATERAL of the socket's outline -- a blob centred inside it does
  // not build a rim, it bulges into the opening.
  //
  // It follows the orbit up when the orbit moves, and it is kept SHORT at the
  // top. Sized for the old smaller socket it reached to v 0.35, which put its
  // upper end out on the open frontal where the blend that buries it drew a
  // soft line running up the forehead: at scene scale that line and its partner
  // on the far side read as a second pair of brows. It now stops at the level
  // the brow swelling starts.
  const orbitalRim = (side) => blob(
    [side * 0.318 * SKULL_W, LY(0.452), LZ(0.835)],
    [0.060 * SKULL_W, 0.088 * HS, 0.056 * HS], 2.4);
  const zygRoot = (side) => blob(
    [side * 0.318 * SKULL_W, LY(0.508), LZ(0.285)],
    [0.082 * SKULL_W, 0.058 * HS, 0.105 * HS], 2.4);

  const malarL = malar(-1), malarR = malar(1);
  const rimL = orbitalRim(-1), rimR = orbitalRim(1);
  const rootL = zygRoot(-1), rootR = zygRoot(1);

  // THE BROW, AND IT IS NOW ONLY THIS.
  //
  // The previous build had a broad swelling here AND a separate swept bar laid
  // over it with an authored asymmetric wedge section, so that the ridge could
  // genuinely overhang the socket the way a real supraorbital margin does. The
  // overhang worked. At scene scale it was still the worst thing on the head:
  // the bar has a crest, the crest is a line running straight across the front
  // of the skull, and with the flat forehead plane that used to sit above it
  // (see VAULT_FRONT) the pair read as the brim and crown of a CAP. The user
  // called the head weird and this is what they were looking at.
  //
  // A real supraorbital ridge has no edge on its upper side at all: it is a
  // swelling that merges up into the frontal with nothing to catch a highlight.
  // So the bar is gone and this tube, which used to be the thing the bar grew
  // out of, is the whole brow: heavier than before, sunk shallower, and blended
  // into the vault with a fillet wider than its own radius so that there is no
  // line anywhere on it. What is lost is the undercut, and at seventy pixels an
  // undercut buys nothing: the socket's darkness comes from the cut hole, its
  // walls and the ring of shade around it, all of which survive. Legibility
  // wins over anatomy here and it is a deliberate change of brief.
  const browSwell = [-1, 1].map((side) => tube(
    [-0.62, -0.30, 0.05, 0.40, 0.72, 1.00].map((kx) => {
      const [u, v] = socketToFace(side, kx * SOCKET.a, Math.pow(socketTop(kx), 0.45) * SOCKET.b + 0.026 * HS);
      const ang = u / FACE_R;
      const rho = surfaceRho(base, ang, v) - 0.030 * HS;
      return new THREE.Vector3(Math.sin(ang) * rho, v, Math.cos(ang) * rho);
    }),
    0.076 * HS,
  ));

  // Bone directly above every upper tooth, all the way to the back of the row.
  // Without it the maxilla's corners lift away from the outer teeth and they
  // hang in air.
  // The inset went from 0.8 of the radius to 1.05 when the arch moved forward:
  // the tube's own front face was then standing 0.005 of the head's height
  // ahead of the crowns it is supposed to sit on top of, and bone in front of
  // a tooth is the one thing this tube must never do.
  const ALV_R = 0.034 * HS;
  const alveolar = tube(
    archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H + 0.020 * HS, { inset: ALV_R * 1.05 })
      .getSpacedPoints(20),
    ALV_R,
  );

  // Everything above, before anything is taken away. The ridges and the fossa
  // are laid on this surface, so they need a surface to be laid on.
  const solid = (x, y, z) => {
    let d = base(x, y, z);
    // A fillet wider than the tube's own radius: this is what stops the brow
    // emerging from the forehead along a line. Nothing else on the head is
    // blended this softly.
    d = smin(d, browSwell[0](x, y, z), 0.042);
    d = smin(d, browSwell[1](x, y, z), 0.042);
    d = smin(d, nasalBone(x, y, z), 0.016);
    // 0.034 before. THE CHEEKBONE NEEDS AN EDGE ON ITS MEDIAL SIDE: a fillet
    // of 0.034 is 0.081 of the head's height wide, which is most of the run
    // between the canine fossa's floor and the zygomatic's prominence, so the
    // step the mid-face is supposed to make there was being rounded off as
    // fast as the fossa cut it. At 0.024 the junction is a crease that catches
    // the key lamp, which is what gives a face its width in a photograph.
    d = smin(d, malarL(x, y, z), 0.024);
    d = smin(d, malarR(x, y, z), 0.024);
    d = smin(d, rimL(x, y, z), 0.024);
    d = smin(d, rimR(x, y, z), 0.024);
    d = smin(d, rootL(x, y, z), 0.026);
    d = smin(d, rootR(x, y, z), 0.026);
    d = smin(d, alveolar(x, y, z), 0.022);
    return d;
  };

  // --------------------------------------------------- 2. the temporal fossa
  // A GENUINE HOLLOW, subtracted. The previous build claimed the fossa as a
  // side effect of a plan exponent -- "above the arch the side of the head is a
  // plane" -- and a plane is not a dish: with nothing hollowed out the arch had
  // nothing to stand off and no amount of proudness would have given it a
  // shadow.
  //
  // It is a very large ellipsoid barely intersecting the side of the head, so
  // the cut is a broad shallow saucer and not a thumbprint. FOSSA_R sets the
  // curvature and FOSSA_CUT the depth and they are independent, which is what
  // stops it reading as a dent. 0.045 of the head's height is half again what
  // the last build cut and it is what makes the shadow in the photograph.
  // The ear canal, as a small pit rather than a painted spot, so it has its own
  // walls and its own shading. Real porion is level with the orbit's lower rim,
  // which is the definition of the Frankfurt horizontal, and this is at 0.520.
  const PORION_Y = LY(0.520);
  const PORION_Z = LZ(0.350);
  const meatus = (side) => blob(
    [side * 0.470 * SKULL_W, PORION_Y, PORION_Z],
    [0.075 * SKULL_W, 0.030 * HS, 0.030 * HS], 2.2);
  const meatusL = meatus(-1), meatusR = meatus(1);

  // The foramen magnum, subtracted rather than dented, so its normals are the
  // pit's own and nothing has to be painted black.
  const foramen = blob([0, LY(0.860), LZ(0.400)],
    [0.240 * SKULL_W, 0.090 * HS, 0.135 * HS], 2.4);

  const scooped = (x, y, z) => {
    let d = solid(x, y, z);
    d = smax(d, -meatusL(x, y, z), 0.012);
    d = smax(d, -meatusR(x, y, z), 0.012);
    d = smax(d, -foramen(x, y, z), 0.022);
    return d;
  };

  // The temporal line: the soft crest that sweeps up and back from the outer
  // corner of the brow, over the temple and down toward the ear. It is the most
  // recognisable line on the reference photograph and the previous build had
  // nothing in its place, which is much of why the vault read as a balloon --
  // with no line on it a dome is just a dome.
  //
  // It is added AFTER the fossa is cut, so it is the fossa's upper EDGE rather
  // than a scratch on a dome. The last point is sunk deep, because a capsule
  // chain ends in a hemisphere and a hemisphere out in the open is a pimple on
  // the back of the head.
  //
  // HOW PROUD IT STANDS IS A SCENE-SCALE NUMBER AND IT CAME DOWN HARD. It used
  // to stand 0.020 of the head's height out of the vault, which on a 760 pixel
  // turntable is the crisp line the photograph shows. At seventy pixels it is
  // two pixels of highlight running up over the side of the head, the eye joins
  // it to its partner across the crown, and what the user sees is a RIDGE OVER
  // THE TOP OF THE SKULL. That was the second complaint in the crop and it was
  // not the profile's fault: the vault under it is a dome. It now stands about
  // 0.006 proud, which is a change of shading rather than a line, and it still
  // does its real job of stopping the temple reading as part of the balloon.
  //
  // [bearing, v, how deep to bury this point].
  const TEMPORAL = [
    [0.86, 0.376, 0.072], [1.02, 0.330, 0.020], [1.34, 0.298, 0.017],
    [1.66, 0.300, 0.019], [1.98, 0.340, 0.030], [2.22, 0.412, 0.062],
    [2.40, 0.480, 0.100],
  ];
  const TEMP_R = 0.024 * HS;
  const temporals = [-1, 1].map((side) => tube(
    TEMPORAL.map(([ang, v, inset]) => {
      const a = side * ang;
      const y = LY(v);
      const rho = surfaceRho(scooped, a, y) - inset * HS;
      return new THREE.Vector3(Math.sin(a) * rho, y, Math.cos(a) * rho);
    }),
    TEMP_R,
  ));

  // The occipital condyles, flanking the foramen. They are the reason the
  // group's origin is where it is, so they may as well be visible.
  const condyle = (side) => blob(
    [side * 0.130 * SKULL_W, LY(0.828), LZ(0.415)],
    [0.055 * SKULL_W, 0.045 * HS, 0.075 * HS], 2);
  const condyleL = condyle(-1), condyleR = condyle(1);

  const field = (x, y, z) => {
    let d = scooped(x, y, z);
    d = smin(d, temporals[0](x, y, z), 0.020);
    d = smin(d, temporals[1](x, y, z), 0.020);
    d = smin(d, condyleL(x, y, z), 0.016);
    d = smin(d, condyleR(x, y, z), 0.016);
    return d;
  };

  // ========================================================= the cranium mesh
  // Columns are NOT duplicated at theta = 0: a duplicated seam column gets its
  // own averaged normals and draws a bright crease straight down the middle of
  // the face, which is the last place a skull can afford one.
  const count = NTH * (NPH + 1);
  const position = new Float64Array(count * 3);
  const color = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const vTh = new Float64Array(count);
  const vPhi = new Float64Array(count);
  const vT = new Float64Array(count);
  const T_MAX = SKULL_L * 1.7;

  // A ray out of P0 walked until the field changes sign, then bisected.
  //
  // Which crossing it stops at matters. Bisecting the whole bracket blind
  // assumes the field crosses zero once along the ray and a smooth union does
  // not have to: the fillet where two parts meet is concave, a grazing ray can
  // cut it three times, and blind bisection then lands on whichever crossing
  // the halving happens to trap -- a different one for neighbouring rays, which
  // tears. So each ray starts from where the ray below it landed, and then
  // LOOKS PAST the crossing it found and takes the outer one if there is more
  // solid within a few steps.
  const STEP = 0.008;
  const LOOKAHEAD = 9;
  const solve = (dx, dy, dz, guess) => {
    const at = (t) => field(P0.x + dx * t, P0.y + dy * t, P0.z + dz * t);
    let lo = Math.max(STEP, guess);
    if (at(lo) >= 0) {
      while (lo > STEP && at(lo) >= 0) lo -= STEP;
    }
    let hi = lo + STEP;
    for (;;) {
      while (hi < T_MAX && at(hi) < 0) { lo = hi; hi += STEP; }
      let jump = 0;
      for (let k = 1; k <= LOOKAHEAD; k++) {
        const t = hi + k * STEP;
        if (t >= T_MAX) break;
        if (at(t) < 0) { jump = t; break; }
      }
      if (!jump) break;
      lo = jump; hi = jump + STEP;
    }
    for (let i = 0; i < 15; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  let seed = T_MAX / 2;
  {
    let lo = 0, hi = T_MAX;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (field(P0.x, P0.y - mid, P0.z) < 0) lo = mid; else hi = mid;
    }
    seed = (lo + hi) / 2;
  }
  const lastT = new Float64Array(NTH).fill(seed);

  const vidx = (iy, ix) => iy * NTH + ((ix % NTH) + NTH) % NTH;
  const place = (k, th, phi, t) => {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    vTh[k] = th; vPhi[k] = phi; vT[k] = t;
    position[k * 3] = P0.x + cp * Math.sin(th) * t;
    position[k * 3 + 1] = P0.y + sp * t;
    position[k * 3 + 2] = P0.z + cp * Math.cos(th) * t;
  };

  for (let iy = 0; iy <= NPH; iy++) {
    const phi = -Math.PI / 2 + (Math.PI * iy) / NPH;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    for (let ix = 0; ix < NTH; ix++) {
      const th = (2 * Math.PI * ix) / NTH;
      const t = solve(cp * Math.sin(th), sp, cp * Math.cos(th), lastT[ix]);
      lastT[ix] = t;
      place(vidx(iy, ix), th, phi, t);
    }
  }

  // The surface point at a given face-space (u, v). u fixes the bearing
  // outright; v is reached by Newton on phi, where dy/dphi is cos(phi) * t to
  // within the ray's own stretch.
  const faceSample = (u, v, seedPhi, seedT) => {
    const th = u / FACE_R;
    let phi = seedPhi;
    let t = seedT;
    for (let i = 0; i < 3; i++) {
      t = solve(Math.cos(phi) * Math.sin(th), Math.sin(phi), Math.cos(phi) * Math.cos(th), t);
      const y = P0.y + Math.sin(phi) * t;
      const dy = Math.cos(phi) * t;
      if (Math.abs(dy) < 1e-7) break;
      const step = (v - y) / dy;
      phi += Math.max(-0.3, Math.min(0.3, step));
      if (Math.abs(step) < 1e-7) break;
    }
    t = solve(Math.cos(phi) * Math.sin(th), Math.sin(phi), Math.cos(phi) * Math.cos(th), t);
    return { th, phi, t };
  };

  // The surface's own normal, from the field's gradient. NOT
  // computeVertexNormals: with quads missing all round every opening, averaged
  // face normals dish the skin at the rim and put a soft grey halo exactly
  // where the cut wants a crisp edge. The gradient does not know or care that
  // the mesh has holes in it.
  const gradNormal = (x, y, z, out) => {
    const e = 3e-4;
    out.set(
      field(x + e, y, z) - field(x - e, y, z),
      field(x, y + e, z) - field(x, y - e, z),
      field(x, y, z + e) - field(x, y, z - e),
    );
    const len = out.length();
    return len > 1e-12 ? out.divideScalar(len) : out.set(0, 1, 0);
  };

  // ------------------------------------------------------------- the openings
  const CUTS = [
    outlineFrom(socketShape, 96, (kx, ky) => socketToFace(-1, kx * SOCKET.a, ky * SOCKET.b)),
    outlineFrom(socketShape, 96, (kx, ky) => socketToFace(1, kx * SOCKET.a, ky * SOCKET.b)),
    outlineFrom(nasalShape, 96, (a, b) => [a * NASAL_W / 2, NASAL_V + b * NASAL_H / 2]),
  ];
  const CAVITY_D = [ORBIT_CAVITY, ORBIT_CAVITY, NASAL_CAVITY];
  const cutAt = (X, Y) => {
    for (const cut of CUTS) if (inCut(cut, X, Y)) return cut;
    return null;
  };

  const uOfColumn = (ixHalf) => {
    let th = (2 * Math.PI * ixHalf) / NTH;
    if (th > Math.PI) th -= 2 * Math.PI;
    return th * FACE_R;
  };

  // A quad is dropped when its CENTRE falls inside a cut. Testing all four
  // corners keeps the hole strictly inside the outline, which is safer, but it
  // blunts every corner by a whole cell. Centre testing keeps the shape, and
  // the two guards below cover what it costs: the rim snap is clamped so no
  // surviving quad can turn itself inside out, and each bowl carries a skirt
  // wider than a cell so there is always something behind an overshoot.
  const qcut = new Array(NPH * NTH).fill(null);
  const qk = (iy, ix) => iy * NTH + ((ix % NTH) + NTH) % NTH;
  for (let iy = 0; iy < NPH; iy++) {
    for (let ix = 0; ix < NTH; ix++) {
      const a = vidx(iy, ix), b = vidx(iy, ix + 1);
      const c = vidx(iy + 1, ix), d = vidx(iy + 1, ix + 1);
      const vm = (position[a * 3 + 1] + position[b * 3 + 1] + position[c * 3 + 1] + position[d * 3 + 1]) / 4;
      qcut[qk(iy, ix)] = cutAt(uOfColumn(ix + 0.5), vm);
    }
  }
  const quadOf = (iy, ix) => (iy < 0 || iy >= NPH ? null : qcut[qk(iy, ix)]);

  // Pull the vertices left on a rim onto the true outline, so the edge follows
  // the curve instead of staircasing along grid lines.
  const rimNU = new Float64Array(count);
  const rimNV = new Float64Array(count);
  const CELL_U = ((2 * Math.PI) / NTH) * FACE_R;
  for (let iy = 0; iy <= NPH; iy++) {
    for (let ix = 0; ix < NTH; ix++) {
      const around = [quadOf(iy - 1, ix - 1), quadOf(iy - 1, ix), quadOf(iy, ix - 1), quadOf(iy, ix)];
      let cut = null;
      let open = false;
      for (const q of around) { if (q) cut = q; else open = true; }
      if (!cut || !open) continue;
      const k = vidx(iy, ix);
      const u = uOfColumn(ix);
      const v = position[k * 3 + 1];
      const hit = snapTo(cut, u, v);
      // Clamped to half a cell in each direction. A rim vertex is shared with
      // the quads that survive, and one dragged clean across a neighbour turns
      // it inside out: it back-face culls, and what shows through the gap is
      // the dark bowl behind.
      const cellV = Math.abs(Math.cos(vPhi[k]) * vT[k]) * (Math.PI / NPH);
      const uN = u + Math.max(-0.50 * CELL_U, Math.min(0.50 * CELL_U, hit.X - u));
      const vN = v + Math.max(-0.50 * cellV, Math.min(0.50 * cellV, hit.Y - v));
      const s = faceSample(uN, vN, vPhi[k], vT[k]);
      place(k, s.th, s.phi, s.t);
      rimNU[k] = hit.nx;
      rimNV[k] = hit.ny;
    }
  }

  // Normals and paint, once the last vertex has stopped moving.
  {
    const n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      gradNormal(position[j], position[j + 1], position[j + 2], n);
      normal[j] = n.x; normal[j + 1] = n.y; normal[j + 2] = n.z;
      // A soft ring of occlusion outside each opening and a little more in the
      // pit of the foramen magnum. That is the whole of the paint on this head.
      // What used to be here instead was a near-black disc inside each socket,
      // because the socket was a dent, its floor faced up into the key lamp,
      // and a 4% albedo under that lamp still renders as a 20% grey once the
      // tone map and the gamma have had it. Real holes have real walls.
      const u = Math.atan2(position[j], position[j + 2] - P0.z) * FACE_R;
      const v = position[j + 1];
      let lum = 1;
      for (const cut of CUTS) {
        if (u < cut.minX - AO_REACH || u > cut.maxX + AO_REACH) continue;
        if (v < cut.minY - AO_REACH || v > cut.maxY + AO_REACH) continue;
        lum *= 1 - 0.24 * (1 - smoothstep(0, AO_REACH, snapTo(cut, u, v).d));
      }
      // The temporal fossa carries a little of its own shade. There is no
      // global illumination in this scene, so a hollow this shallow lights the
      // same as the flat beside it and the scoop has to be helped to read.
      const fx = Math.abs(position[j]) / SKULL_W;
      const fv = (Y_CROWN - v) / HS;
      if (fx > 0.30) {
        lum *= 1 - 0.10 * smoothstep(0.30, 0.42, fx) * smoothstep(0.34, 0.44, fv) * (1 - smoothstep(0.56, 0.66, fv));
      }
      const gz = (position[j + 2] - LZ(0.400)) / (0.22 * SKULL_L);
      const gx = position[j] / (0.20 * SKULL_W);
      if (n.y < -0.2) lum *= 1 - 0.55 * (1 - smoothstep(0.35, 1.05, gx * gx + gz * gz));
      // A touch cooler in the depths: a hole lit only by the sky is bluer than
      // the bone around it, and a purely neutral multiply reads as soot.
      color[j] = lum;
      color[j + 1] = lum * (1 - 0.02 * (1 - lum));
      color[j + 2] = lum * (1 + 0.10 * (1 - lum));
    }
  }

  const index = [];
  for (let iy = 0; iy < NPH; iy++) {
    for (let ix = 0; ix < NTH; ix++) {
      if (qcut[qk(iy, ix)]) continue;
      const a = vidx(iy, ix), b = vidx(iy, ix + 1);
      const c = vidx(iy + 1, ix), d = vidx(iy + 1, ix + 1);
      index.push(a, b, d, a, d, c);
    }
  }

  const craniumGeo = track(new THREE.BufferGeometry());
  craniumGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(position), 3));
  craniumGeo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  craniumGeo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  craniumGeo.setIndex(index);
  craniumGeo.computeBoundingSphere();
  group.add(add(craniumGeo, skin, 'cranium'));

  // =============================================== 1. the brow, as a swelling
  // Nothing is built here any more. The brow is `browSwell`, in the field,
  // above; the swept shelf that used to stand on it is gone with its overhang.
  //
  // How far the brow actually stands proud is still measured rather than
  // asserted, and it is measured the only honest way now that it is part of one
  // surface: the radius of the finished field at the crest, minus the radius
  // the vault alone would have had at the same bearing and height. `base` is
  // the vault, the maxilla and the cranial base with no brow in it, so the
  // difference is the ridge and nothing else.
  let browProud = 0;
  for (const side of [-1, 1]) {
    const [u, v] = socketToFace(side, 0.15 * SOCKET.a, socketTop(0.15) * SOCKET.b + 0.026 * HS);
    const ang = u / FACE_R;
    browProud = Math.max(browProud, surfaceRho(field, ang, v) - surfaceRho(base, ang, v));
  }

  // ================================== 3. the zygomatic arch, with air behind it
  // A slender blade bridging from the zygomatic bone to the root above the ear,
  // its two ends buried deep inside the abutment blobs that ARE in the field and
  // its middle standing clear of the scooped fossa.
  //
  // The whole of the previous build's arch was in the field, swept along the
  // vault's own surface at a fixed inset and blended in with smin. That cannot
  // produce a gap -- a smooth union of two solids is one solid -- so what it
  // produced was a moulding seam. The gap is the single strongest skull cue in
  // a three-quarter view, so the arch stops being part of the head and becomes
  // a bridge over it. The path is authored in world coordinates rather than
  // snapped to the vault, because a path that follows a surface cannot stand
  // off it, and the standoff is measured below and published.
  const ARCH_R = 0.019 * HS;
  const ARCH_FLAT = 1.70;               // taller than it is thick, as a real arch is
  const archPath = (side) => new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.230 * SKULL_W, LY(0.582), LZ(0.830)),
    new THREE.Vector3(side * 0.360 * SKULL_W, LY(0.576), LZ(0.720)),
    new THREE.Vector3(side * 0.432 * SKULL_W, LY(0.564), LZ(0.580)),
    new THREE.Vector3(side * 0.450 * SKULL_W, LY(0.548), LZ(0.435)),
    new THREE.Vector3(side * 0.424 * SKULL_W, LY(0.528), LZ(0.325)),
    new THREE.Vector3(side * 0.352 * SKULL_W, LY(0.510), LZ(0.255)),
  ], false, 'centripetal', 0.5);
  let archGap = Infinity;
  for (const side of [-1, 1]) {
    const path = archPath(side);
    const geo = track(shaft(path, ARCH_R, { waist: 0.94, endBias: 0.9, segments: 40 }));
    const mid = path.getPoint(0.5);
    geo.translate(0, -mid.y, 0);
    geo.scale(1, ARCH_FLAT, 1);
    geo.translate(0, mid.y, 0);
    group.add(add(geo, material, 'arch'));
    for (const t of [0.35, 0.5, 0.65]) {
      const p = path.getPoint(t);
      const ang = Math.atan2(p.x, p.z);
      archGap = Math.min(archGap, Math.hypot(p.x, p.z) - ARCH_R - surfaceRho(field, ang, p.y));
    }
  }

  // ======================================== 4. the mastoid, as a downward lug
  // Behind and below the ear canal, pointing down and a little forward and in.
  // Its own mesh: a superellipsoid tapered to a rounded point, its top third
  // buried in the temporal bone. In the field it would be a bump, because smin
  // rounds a point off as fast as you sharpen it and the blend radius that
  // hides the join is the same radius that eats the tip.
  const MASTOID_TOP = LY(0.500);
  const MASTOID_TIP = LY(0.625);
  for (const side of [-1, 1]) {
    const geo = track(processGeometry(
      0.058 * SKULL_W, (MASTOID_TIP - MASTOID_TOP) / 2, 0.065 * HS,
      { exp: 2.6, narrow: 0.46, sign: -1 },
    ));
    geo.rotateZ(side * -0.16);
    geo.translate(side * 0.406 * SKULL_W, (MASTOID_TOP + MASTOID_TIP) / 2, LZ(0.322));
    group.add(add(geo, material, 'mastoid'));
  }

  // The coronoid process, and with it the mandibular notch. It is not part of
  // the mandible's own sweep: a single sweep cannot fork, and this is the fork.
  // Its base is buried in the ramus, so the join happens inside bone.
  for (const side of [-1, 1]) {
    const top = LY(0.578), bot = LY(0.720);
    const geo = track(processGeometry(
      0.038 * SKULL_W, (bot - top) / 2, 0.046 * HS,
      { exp: 2.4, narrow: 0.30, sign: +1 },
    ));
    geo.translate(side * 0.322 * SKULL_W, (top + bot) / 2, LZ(0.442));
    jawRootPending.push([geo, side]);
  }

  // -------------------------------- the walls and the bowls inside the cuts
  // One ribbon quad per grid edge that has a dropped quad on one side and a
  // kept one on the other. The rim vertices are already snapped onto the
  // outline, so the ribbon follows the true curve; extruding each of them back
  // along its own surface normal by WALL_T lands on the plane the bowl's mouth
  // is built at, so wall and bowl meet to within the half cell the snap is
  // allowed to fall short by, and the bowl's skirt is wider than that.
  //
  // The wall is its own geometry so its normals never average into the skin's.
  // That is what keeps the lip a crisp edge instead of a smeared crease, and it
  // is the difference between a hole and a bruise.
  let orbitDiverge = 0;
  const holeVerts = [];
  const holeNors = [];
  const holeColors = [];
  const holeIdx = [];
  {
    const P0v = new THREE.Vector3(), P1v = new THREE.Vector3();
    const N0 = new THREE.Vector3(), N1 = new THREE.Vector3();
    const W0 = new THREE.Vector3(), W1 = new THREE.Vector3();
    const e = new THREE.Vector3(), dv = new THREE.Vector3(), g3 = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    // The 3D direction a face-space step of (nu, nv) points in, flattened into
    // the surface's tangent plane. It comes off the OUTLINE rather than off the
    // quad, so neighbouring wall quads sharing a rim vertex agree and the
    // ribbon shades smoothly round a curve.
    const wallNormal = (k, N, out) => {
      const th = vTh[k];
      out.set(rimNU[k] * Math.cos(th), rimNV[k], rimNU[k] * -Math.sin(th));
      out.addScaledVector(N, -out.dot(N));
      const len = out.length();
      return len > 1e-9 ? out.divideScalar(len) : out.copy(N);
    };
    const readAt = (k, P, N) => {
      P.set(position[k * 3], position[k * 3 + 1], position[k * 3 + 2]);
      N.set(normal[k * 3], normal[k * 3 + 1], normal[k * 3 + 2]);
    };

    // Three rings, not two. The outer laps back over the skin carrying the
    // SKIN's normal, so it shades as skin and is not visible; that is the ring
    // that shuts the crack where the grid's hole and the true outline disagree
    // by a fraction of a cell. The middle sits on the hole's edge and carries
    // the wall's normal, and the jump between the two is the lip. Give the
    // lapped ring the wall's normal instead and it lights side-on against the
    // skin, drawing a bright wire round every opening.
    const RING_LUM = [1.0, 0.22, 0.028];
    const pushWall = (kA, kB) => {
      readAt(kA, P0v, N0);
      readAt(kB, P1v, N1);
      wallNormal(kA, N0, W0);
      wallNormal(kB, N1, W1);
      e.copy(P1v).sub(P0v);
      dv.copy(N0).multiplyScalar(-WALL_T);
      g3.crossVectors(e, dv);
      const flip = g3.dot(W0) < 0;
      const pf = flip ? P1v : P0v, ps = flip ? P0v : P1v;
      const wf = flip ? W1 : W0, ws = flip ? W0 : W1;
      const nf = flip ? N1 : N0, ns = flip ? N0 : N1;
      const b0 = holeVerts.length / 3;
      const push = (pt, wn, sn, ring) => {
        if (ring === 0) tmp.copy(pt).addScaledVector(wn, -WALL_LIP).addScaledVector(sn, WALL_PROUD);
        else if (ring === 1) tmp.copy(pt);
        else tmp.copy(pt).addScaledVector(wn, WALL_TAPER).addScaledVector(sn, -WALL_T);
        holeVerts.push(tmp.x, tmp.y, tmp.z);
        const nn = ring === 0 ? sn : wn;
        holeNors.push(nn.x, nn.y, nn.z);
        const l = RING_LUM[ring];
        holeColors.push(l, l * (1 - 0.02 * (1 - l)), l * (1 + 0.10 * (1 - l)));
      };
      for (let ring = 0; ring < 3; ring++) {
        push(pf, wf, nf, ring);
        push(ps, ws, ns, ring);
      }
      for (let ring = 0; ring < 2; ring++) {
        const b = b0 + ring * 2;
        holeIdx.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
    };

    for (let iy = 0; iy < NPH; iy++) {
      for (let ix = 0; ix < NTH; ix++) {
        const here = qcut[qk(iy, ix)];
        if (!!here !== !!quadOf(iy, ix - 1)) pushWall(vidx(iy, ix), vidx(iy + 1, ix));
        if (!!here !== !!quadOf(iy - 1, ix)) pushWall(vidx(iy, ix), vidx(iy, ix + 1));
      }
    }

    // Close what is behind, so the head is not a lamp with the light off. A
    // real orbit is a deep bowl, so that is what goes in: the outline sunk one
    // wall thickness is the mouth, and from there a quarter ellipse runs in and
    // back to a pole. Because it is a separate mesh from the skin it cannot
    // fold into it, which is the whole class of bug the old pressed-in dent
    // had. The bowl's normals point at its own mouth's centre, which is what
    // the inside of a hemisphere's normals do: the sides face across the
    // opening and go dark, the back faces out and catches a little light.
    const CAV_RINGS = 7;
    const CAV_SKIRT = 1.3 * CELL_U;
    const CAV_LUM = [0.020, 0.020, 0.016, 0.014, 0.017, 0.022, 0.028, 0.036];
    for (let ci = 0; ci < CUTS.length; ci++) {
      const cut = CUTS[ci];
      const depth = CAVITY_D[ci];
      const n = cut.pts.length;
      let uc = 0, vc = 0;
      for (const q of cut.pts) { uc += q[0]; vc += q[1]; }
      uc /= n; vc /= n;

      let sPhi = 0, sT = SKULL_L * 0.5;
      {
        const s = faceSample(uc, vc, 0, sT);
        sPhi = s.phi; sT = s.t;
      }

      const base0 = holeVerts.length / 3;
      const nrm = new THREE.Vector3();
      const pt = new THREE.Vector3();
      const out = new THREE.Vector3();

      const mouthRing = [];
      const mouthNor = [];
      const skirt = [];
      for (let i = 0; i < n; i++) {
        const f = cut.pts[i];
        const sm = faceSample(f[0], f[1], sPhi, sT);
        sPhi = sm.phi; sT = sm.t;
        const cp = Math.cos(sm.phi), sp = Math.sin(sm.phi);
        pt.set(P0.x + cp * Math.sin(sm.th) * sm.t, P0.y + sp * sm.t, P0.z + cp * Math.cos(sm.th) * sm.t);
        gradNormal(pt.x, pt.y, pt.z, nrm);
        mouthNor.push(nrm.clone());
        const g = cut.pts[(i + 1) % n], h = cut.pts[(i + n - 1) % n];
        const ex = g[0] - h[0], ey = g[1] - h[1];
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        // Outward is the reverse of the counter-clockwise inward normal. The
        // skirt runs out ALONG THE TANGENT PLANE rather than along the skin:
        // following the skin is wrong wherever the skin is concave, and a
        // flange in the tangent plane cannot fold from either sign of
        // curvature.
        out.set(ey * inv * Math.cos(sm.th), -ex * inv, ey * inv * -Math.sin(sm.th));
        out.addScaledVector(nrm, -out.dot(nrm));
        const ol = out.length();
        if (ol > 1e-9) out.divideScalar(ol); else out.set(0, 0, 0);
        skirt.push(pt.clone().addScaledVector(out, CAV_SKIRT).addScaledVector(nrm, -1.9 * WALL_T));
        mouthRing.push(pt.clone().addScaledVector(nrm, -WALL_T));
      }

      // Everything deeper than the mouth is a hemi-ellipsoid in the MOUTH's own
      // frame, about ONE axis. Sinking each ring along its own point's normal
      // instead is the obvious thing and it self-intersects: one step in, the
      // bowl has sunk a fifth of its depth while shrinking 2% of its width, and
      // in the tight valley between the nasal aperture and an orbit's medial
      // wall the normals over that step converge inside the radius of the sink.
      const axis = new THREE.Vector3();
      for (const nv of mouthNor) axis.add(nv);
      axis.normalize();
      if (ci < 2) orbitDiverge = Math.max(orbitDiverge, Math.atan2(Math.abs(axis.x), axis.z));
      const centre = new THREE.Vector3();
      for (const q of mouthRing) centre.add(q);
      centre.divideScalar(n);

      const pushRing = (points, lum) => {
        for (const q of points) {
          holeVerts.push(q.x, q.y, q.z);
          nrm.copy(centre).sub(q);
          const len = nrm.length();
          if (len > 1e-9) nrm.divideScalar(len);
          holeNors.push(nrm.x, nrm.y, nrm.z);
          holeColors.push(lum, lum * (1 - 0.02 * (1 - lum)), lum * (1 + 0.10 * (1 - lum)));
        }
      };
      pushRing(skirt, CAV_LUM[0]);
      pushRing(mouthRing, CAV_LUM[1]);
      for (let r = 2; r <= CAV_RINGS; r++) {
        const s = (r - 1) / CAV_RINGS;
        const shrink = Math.cos((Math.PI / 2) * s);
        const sink = depth * Math.sin((Math.PI / 2) * s);
        pushRing(
          mouthRing.map((q) => new THREE.Vector3()
            .copy(centre).addScaledVector(new THREE.Vector3().subVectors(q, centre), shrink)
            .addScaledVector(axis, -sink)),
          CAV_LUM[Math.min(CAV_LUM.length - 1, r)],
        );
      }
      const apex = centre.clone().addScaledVector(axis, -depth);
      const apexIdx = holeVerts.length / 3;
      holeVerts.push(apex.x, apex.y, apex.z);
      nrm.copy(centre).sub(apex).normalize();
      holeNors.push(nrm.x, nrm.y, nrm.z);
      {
        const l = CAV_LUM[CAV_LUM.length - 1];
        holeColors.push(l, l * (1 - 0.02 * (1 - l)), l * (1 + 0.10 * (1 - l)));
      }
      // Wound so the bowl faces out of its own opening. The outline is
      // counter-clockwise in face space and (u, v, outward normal) is a
      // right-handed frame, so counter-clockwise there is counter-clockwise to
      // someone looking into the hole. The other winding builds the identical
      // bowl and back-face culls it, and what that looks like is daylight
      // straight through the head.
      for (let r = 0; r < CAV_RINGS; r++) {
        for (let i = 0; i < n; i++) {
          const a = base0 + r * n + i, b = base0 + r * n + ((i + 1) % n);
          holeIdx.push(a, b, b + n, a, b + n, a + n);
        }
      }
      for (let i = 0; i < n; i++) {
        const a = base0 + CAV_RINGS * n + i, b = base0 + CAV_RINGS * n + ((i + 1) % n);
        holeIdx.push(a, b, apexIdx);
      }
    }
  }

  const holeGeo = track(new THREE.BufferGeometry());
  holeGeo.setAttribute('position', new THREE.Float32BufferAttribute(holeVerts, 3));
  holeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(holeNors, 3));
  holeGeo.setAttribute('color', new THREE.Float32BufferAttribute(holeColors, 3));
  holeGeo.setIndex(holeIdx);
  holeGeo.computeBoundingSphere();
  const holes = new THREE.Mesh(holeGeo, skin);
  holes.name = 'holes';
  holes.castShadow = false;               // it faces into a hole; a caster here is acne
  holes.receiveShadow = true;
  group.add(holes);

  // ------------------------------------------------------------ mouth cavity
  // So the gap between the tooth rows is a dark slot rather than a bright one.
  // It belongs to the cranium and not the jaw, so opening the mouth reveals it
  // instead of revealing the inside of the head. Sized to sit inside both
  // arches and under the palate on every axis: any bigger and it pushes a black
  // bubble out through the cheek, any smaller and the gap between the rows
  // lights up.
  const cavityMat = new THREE.MeshStandardMaterial({ color: 0x241b14, roughness: 0.95, metalness: 0 });
  materials.push(cavityMat);
  const cavityGeo = track(new THREE.SphereGeometry(1, 20, 14));
  // Measured against the rows rather than guessed: its top has to sit BELOW the
  // upper crowns' tips and its front BEHIND the lower row's outer face, or the
  // black bubble shows through the bite as a slot twice the height of the gap.
  // Grown with AJAR: the slot between the rows is wider than it was, so the
  // dark behind it has to reach higher or the gap lights up in the middle.
  cavityGeo.scale(0.140 * SKULL_W, 0.052 * HS, 0.125 * SKULL_L);
  cavityGeo.translate(0, Y_BITE - 0.037 * HS, LZ(0.790));
  group.add(new THREE.Mesh(cavityGeo, cavityMat));

  // -------------------------------------------------------------- upper teeth
  const upperRow = archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H / 2);
  const upperTooth = track(toothGeometry(
    (upperRow.getLength() / M.skull.teeth.upper) * 0.84, TOOTH_H, TOOTH_D,
  ));
  const up = new THREE.Vector3(0, 1, 0);
  const placeRow = (curve, geo, n, parent, name) => {
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = curve.getPointAt(t);
      curve.getTangentAt(t, tan);
      nrm.crossVectors(tan, up).normalize();
      // The curve is the outer face of the row, so the block sits behind it.
      p.addScaledVector(nrm, -TOOTH_D * 0.45);
      m.makeBasis(tan, up, nrm);
      const mesh = add(geo, material, name);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(p);
      parent.add(mesh);
    }
  };
  placeRow(upperRow, upperTooth, M.skull.teeth.upper, group, 'tooth-upper');

  // ------------------------------------------------------------------ the jaw
  // The hinge node sits ON the axis through both condyles, so the condyle balls
  // do not move when it turns and the joint cannot tear open. Identity is shut,
  // and POSITIVE rotation.x drops the chin: the chin is below and in FRONT of
  // the hinge, so +x swings it down and back. See CONTRACT.md.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, HINGE_Y, HINGE_Z);
  group.add(jaw);
  const jawRoot = new THREE.Object3D();
  jawRoot.position.set(0, -HINGE_Y, -HINGE_Z);
  jaw.add(jawRoot);

  // One sweep, condyle to condyle. The station list is mirrored about the chin
  // and both the path and the section are read off the same index, so the
  // section can never drift out of step with the point it belongs to.
  const JAW_N = JAW_STATIONS.length;
  const jawPts = [];
  for (let i = JAW_N - 1; i >= 1; i--) {
    const [x, v, zn] = JAW_STATIONS[i];
    jawPts.push(new THREE.Vector3(-x * SKULL_W, LY(v), LZ(zn)));
  }
  for (let i = 0; i < JAW_N; i++) {
    const [x, v, zn] = JAW_STATIONS[i];
    jawPts.push(new THREE.Vector3(x * SKULL_W, LY(v), LZ(zn)));
  }
  const jawPath = new THREE.CatmullRomCurve3(jawPts, false, 'centripetal', 0.5);
  const JAW_SEG = jawPts.length - 1;
  // Which station a sweep parameter belongs to. CatmullRomCurve3.getPoint maps
  // t uniformly across its segments, so this is exact rather than approximate.
  const jawAt = (tt) => {
    const t = clamp01(tt);
    const f = Math.max(0, Math.min(JAW_SEG - 1e-9, t * JAW_SEG));
    const i = Math.floor(f);
    const k = f - i;
    const gi = (j) => {
      const idx = j <= JAW_N - 1 ? JAW_N - 1 - j : j - (JAW_N - 1);
      const row = JAW_STATIONS[idx];
      return { row, mirror: j < JAW_N - 1 ? -1 : 1 };
    };
    const a = gi(i), b = gi(Math.min(JAW_SEG, i + 1));
    return {
      ht: mix(a.row[3], b.row[3], k),
      hb: mix(a.row[4], b.row[4], k),
      p: mix(a.row[5], b.row[5], k),
      nx: mix(a.row[6] * a.mirror, b.row[6] * b.mirror, k),
      nz: mix(a.row[7], b.row[7], k),
    };
  };
  const JAW_SEC_N = 22;
  const jawSection = (t) => {
    const { ht, hb, p } = jawAt(t);
    const a = ht * HS, b = hb * HS;
    const sec = [];
    for (let j = 0; j < JAW_SEC_N; j++) {
      const th = (2 * Math.PI * j) / JAW_SEC_N;
      const ct = Math.cos(th), st = Math.sin(th);
      const r = Math.pow(
        Math.pow(Math.abs(ct) / a, p) + Math.pow(Math.abs(st) / b, p),
        -1 / p,
      );
      sec.push([r * ct, r * st]);
    }
    return sec;
  };
  const jawOut = new THREE.Vector3();
  const mandible = track(sweepShape(
    (t, out) => out.copy(jawPath.getPoint(clamp01(t))),
    jawSection,
    0, 1, 132,
    {
      // The thickness axis is the authored outward horizontal, made square to
      // the path; the other axis follows. At the body that comes out as
      // (across the bone, up), and at the ramus, where the path is vertical and
      // the default frame has nothing to work with, as (across the bone, front
      // to back). One frame, no roll, no degenerate station.
      frame: (t, sd, vu, T) => {
        const { nx, nz } = jawAt(t);
        jawOut.set(nx, 0, nz).normalize();
        sd.copy(jawOut).addScaledVector(T, -jawOut.dot(T));
        if (sd.lengthSq() < 1e-10) sd.set(1, 0, 0);
        sd.normalize();
        vu.crossVectors(sd, T).normalize();
      },
    },
  ));
  jawRoot.add(add(mandible, material, 'jaw-body'));
  for (const [geo] of jawRootPending) jawRoot.add(add(geo, material, 'jaw-coronoid'));

  // The condyle heads, as their own bulbs on the axis the hinge turns about, so
  // the joint cannot tear open when the mouth moves.
  for (const side of [-1, 1]) {
    const ball = track(new THREE.SphereGeometry(0.040 * HS, 18, 12));
    ball.scale(1.25, 0.78, 1.0);
    ball.translate(side * HINGE_X, HINGE_Y, HINGE_Z);
    jawRoot.add(add(ball, material, 'jaw-condyle'));
  }

  // -------------------------------------------------------------- lower teeth
  const lowerRow = archCurve(LOWER_ARCH, Y_BITE - TOOTH_H / 2);
  const lowerTooth = track(toothGeometry(
    (lowerRow.getLength() / M.skull.teeth.lower) * 0.84, TOOTH_H, TOOTH_D,
  ));
  placeRow(lowerRow, lowerTooth, M.skull.teeth.lower, jawRoot, 'tooth-lower');

  // Symmetric, so this asserts nothing about the geometry; it is published
  // because metrics.js asks every part to and the assembler checks it.
  group.userData.outwardX = LEFT_X;

  // What the acceptance check reads. Two rejected builds passed three-quarter
  // renders while being wrong in plan, so the test for this part is a table of
  // numbers and a straight-on profile and front, not a look.
  group.userData.landmarks = {
    crownY: Y_CROWN, chinY: Y_CHIN, biteY: Y_BITE,
    lengthWanted: SKULL_L, widthWanted: SKULL_W,
    orbitV: ORBIT_V, orbitW: SOCKET_W, orbitH: SOCKET_H, orbitU: ORBIT_U,
    nasalV: NASAL_V, nasalW: NASAL_W, nasalH: NASAL_H,
    porionY: PORION_Y, porionZ: PORION_Z,
    hingeX: HINGE_X, hingeY: HINGE_Y, hingeZ: HINGE_Z,
    gonionX: GONION_X, gonionY: GONION_Y, gonionZ: GONION_Z,
    // The four features a single field cannot have, as numbers.
    // How far the supraorbital swelling stands out of the frontal it grows
    // from. Not an overhang: there is no overhang on this head any more.
    browProud,
    fossaDepth: FOSSA_CUT * HS,
    zygGap: archGap,                      // daylight behind the arch; must be > 0
    mastoidDrop: MASTOID_TOP - MASTOID_TIP,
    orbitDiverge: orbitDiverge * (180 / Math.PI),
    // What this file wants metrics.js to say. See the header.
    wantDepth: SKULL_L, wantWidth: SKULL_W,
    wantSocketW: SOCKET_W, wantSocketH: SOCKET_H,
  };

  return {
    group,
    joints: { jaw },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

export default buildSkull;
