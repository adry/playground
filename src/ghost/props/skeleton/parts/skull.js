import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { shaft, jointBall, plate } from './bone.js';

// The skull.
//
// Origin is the ATLAS: the occipital condyles sit at y = 0, the vault above,
// the mandible hanging below. `joints.jaw` is identity when the mouth is shut
// and POSITIVE rotation.x drops the chin (the chin is below and in FRONT of the
// hinge, so +x swings it down and back -- the previous build had this the wrong
// way round and drove the chin up through the palate).
//
// Two things about the way this file is built, both deliberate departures from
// the rest of the figure.
//
// 1. The cranium is not made out of bone.js primitives. `shaft`, `jointBall`,
//    `plate` and `drum` are a vocabulary for long bones and flat bones, and a
//    skull is neither: it is one continuous vault with a face pushed into the
//    front of it. So the braincase, brow, cheekbones and maxilla are a single
//    parametric surface -- a smooth union of a few blobs and swept tubes,
//    sampled on a sphere grid -- exactly the call pumpkin.js makes for its
//    lobed shell. The teeth come from the vocabulary, and so do the ramus of
//    the mandible, which is plate(), and its condyle, which is jointBall().
//    The BODY of the mandible does not: it needs a section that changes along
//    its own length, which shaft() cannot sweep, so it has sweepBar() of its
//    own. See "the mandible".
//
// 2. The orbits and the nasal aperture are REAL HOLES, cut out of that grid,
//    with a wall of bone in the cut and a dark rounded cavity behind. See "the
//    openings" below for how, and for the two builds' worth of history that
//    says why nothing less will do.
//
// 3. The zygomatic arches are NOT in that field. They are two separate swept
//    bars whose ends are buried in abutments that are, so that there is real
//    daylight between each arch and the temporal fossa behind it. A smooth
//    union cannot have a gap in it; see "the zygomatic arch" below.
//
// EARLIER PASSES. The head was rejected twice, the second time as "very bad",
// and rebuilt against `.ref/SKULL-ANATOMY.md`, a measured reference. Almost
// everything that was wrong came from two numbers: M.skull.width and .depth
// used to be 0.141 and 0.150 of the figure's height, a cranial index of 0.94 --
// a braincase wider than it was long, which no human skull is. They are 0.1386
// and 0.1777 now, an index of 0.780, and the corrections that followed are
// commented at the places they were made. The load-bearing ones:
//
//   * the eye line is at exactly half of vertex-to-chin, where a real one is,
//     rather than at 0.462 aimed at the forehead instead;
//   * the braincase's length is the whole of M.skull.depth, glabella to
//     opisthocranion, so the cranial index is built rather than tuned;
//   * the braincase stops above the level of the tooth crowns instead of
//     running down to the atlas, so it is 0.79 as tall as it is long and not
//     0.86, and the back of the head no longer hangs to the jaw;
//   * the widest point of the head is a pair of parietal eminences, high and
//     behind, and not a horizontal band with a ridge riding on it;
//   * there is a temporal fossa that is actually hollowed, and an arch with a
//     gap behind it;
//   * face space is unwrapped at a radius taken from the depth, not the width,
//     which is what stopped the orbits curling onto the temples.
//
// AND THEN THE PROFILE WAS AUTHORED. Even after all of the above the side view
// still read as a teardrop, and the landmark table kept passing while it did,
// because a table of extremes says nothing about the curve between them. The
// reference now gives the lateral profile as seventeen coordinates, and the
// midsagittal outline is built as two interpolating curves through them rather
// than hoped for as an emergent property of a blended field. See "the vault's
// profile". The same lesson as the zygomatic arch, one level up: when a thing
// has to pass through specified points, take it out of the blend.
//
// `group.userData.landmarks` publishes what the acceptance check reads. The
// numbers in it, the sixteen-height posterior sweep and the profile view are
// the test for this part -- three builds passed three-quarter renders while
// being wrong in plan or in profile.
//
// THIS PASS closes the conflict the last one reported. The reference has
// vertex-to-gnathion at 0.94 of the skull's length, and metrics.js has grown
// M.skull.depth and .width to put it exactly there. Three things followed:
//
//   * THE PORION FRAME IS SQUARE NOW. It was being pinned to the orbit's lower
//     rim, which on a head with a deliberately oversized cute socket is not
//     where the table's porion is: it sat 0.071 of L low, so the vault was
//     being drawn 14% tall and everything below the ear 17% short by two
//     different stretches. Pinned to the table instead, both stretches equal
//     the skull's length and every landmark reads straight off. That one line
//     moved basion-to-vertex from 0.699 to the reference's 0.65 and the face's
//     share of the silhouette from 22% to 29%.
//   * THE MANDIBLE IS REBUILT. It was a swept round tube with a global squash
//     on it and it read as a wire hoop with a lath for a ramus. It is an
//     authored superellipse swept by sweepBar() now, deep at the chin, and the
//     ramus is a plate half again as broad. See "the mandible".
//   * The vault's plan exponent relaxes into the crown instead of staying
//     squared, which is what made the parietal region read as a lid with a
//     corner on it from behind, and the zygomatic arch is thicker.
//
// M.skull.jawHeight is the one number still short of the table: at 0.154 of L
// against the table's prosthion-to-gnathion of 0.185, the mandible is working
// in five sixths of the room a real one has. It is reported, not absorbed; the
// bone spends what there is on bone rather than on air.
//
// The expression is DELIBERATELY NEUTRAL. An earlier pass followed the
// reference photo's face, which scowls: the top edge of each orbit ran on a
// hard diagonal diving toward the nose and the brow ridge rode that diagonal
// into a V over the bridge. It worked, and the user saw it in the whole figure
// and asked for a friendlier head. So the sockets are near-level rounded
// openings and the brow is a soft shelf over them, which is what a plain
// anatomical skull looks like anyway. Keep the reference for the SHAPE of the
// head and ignore its face.
//
// The line between neutral and blank is the orbits still reading as deep dark
// holes with a real rim, and the nasal aperture and the tooth row still being
// there. Neutral is a skull with no expression, not a skull with no face.

// --- where the skull sits relative to its own origin -----------------------
// metrics.js does not name the atlas height directly, but it is pinned by the
// numbers that are there: the neck runs M.neck.length up from the top of the
// ribcage, and the crown and chin are both given as absolute heights. The
// three agree -- crown minus chin comes out at exactly M.skull.height -- which
// is the check that this reading of the metrics is the intended one.
const ATLAS_Y = M.y.ribcageTop + M.neck.length;
const Y_CROWN = M.y.crown - ATLAS_Y;          // top of the vault
const Y_CHIN = M.y.chin - ATLAS_Y;            // lowest point of the mandible
// The bite line. M.skull.jawHeight is the whole mouth from here down to the
// chin, and it is small on purpose: an earlier build deepened it twice to make
// it read from the high preview camera and ended up with a head 11% oversize.
// Nothing below fudges it.
const Y_BITE = Y_CHIN + M.skull.jawHeight;

const HW = M.skull.width / 2;
const HS = M.skull.height;                    // crown to chin, the unit for the face

// --- the vault -------------------------------------------------------------
// The braincase's floor is no longer a number picked here. It used to be
// -0.012 of the head's height, a hair below the condyle plane, so the vault ran
// the whole way down to the atlas and the back of the head hung to within a
// fifth of the head's height of the chin. It is derived from the reference's
// own basion now, down with the profile.
//
// How the skull's depth is split about the atlas. The occipital condyles are
// behind the middle of a real skull, but only just: put them much further back
// and the whole head reads as an egg tipping forward off the neck, which was
// the other fault two builds ago. 54/46 is as far back as it takes.
//
// These two are now the ENDS of the skull's length rather than approximations
// to it: Z_BACK is the opisthocranion and Z_FACE is the glabella, so the whole
// of M.skull.depth is spent between them and the cranial index falls out as
// M.skull.width / M.skull.depth = 0.781 by construction instead of by tuning.
// The build before this one spent only 0.90 of the depth on the braincase and
// gave the rest to the maxilla, which put the index back at 0.87 even once the
// metrics themselves had been corrected. A number that has to come out right
// should be built out of the numbers that fix it, not aimed at.
const Z_BACK = -0.54 * M.skull.depth;
const Z_FACE = Z_BACK + M.skull.depth;
// The brow's own dimensions. It rides very nearly flush now: the vault's own
// frontal profile carries the glabella, so a shelf standing proud of it would
// put the front of the skull somewhere other than where the reference says.
const BROW_R = 0.046 * HS;
const BROW_INSET = 0.037 * HS;

// --- the vault's profile ---------------------------------------------------
// AUTHORED, not blended.
//
// Three builds tried to reach a skull's side view by shaping a field made of
// smoothly unioned primitives, checking a landmark table each time, and all
// three came out as a teardrop or a bicycle helmet. The table passed while the
// silhouette was wrong, because a table of extremes does not constrain the
// curve between them, and a smooth union is very good at organic mass and very
// bad at passing through specified points.
//
// `.ref/SKULL-ANATOMY.md` now gives the lateral profile as seventeen
// coordinates. So the profile is no longer an emergent property of the field:
// the midsagittal outline IS two interpolating curves through those points, and
// the vault is a loft of superelliptical sections hung on them. Front and back
// are exact at every landmark by construction, and the only freedom left is the
// plan view, which is a separate profile and cannot disturb them.
//
// THE FRAME. The reference works in porion-relative coordinates: origin at the
// ear canal, x forward, y up, units of the skull's length L from glabella to
// opisthocranion. It is SQUARE here: one world unit of L along z and one along
// y, so SY_UP and SY_DN below both come out at L_SKULL and every coordinate in
// the table can be read straight off. See PORION_Y for what that cost and why
// it is worth it.
//
// THE CONFLICT IS GONE. The reference has vertex to gnathion at 0.94 of L: a
// real skull is slightly LONGER than it is tall. With M.skull.depth at f(0.160)
// this build came out at 1.044, taller than long by 11%, and because the crown,
// the chin and the eye line are all pinned, the whole excess landed in the
// braincase, which had to stretch 1.37x as hard as the face did. That was the
// box, not this file, and it was reported rather than absorbed. M.skull.depth
// and .width have since grown to f(0.1777) and f(0.1386) -- the same 0.78
// index, the table's length -- so M.skull.height is now 0.94 of M.skull.depth
// to four places and the two stretches are equal by construction rather than by
// luck. If they ever diverge again, the box has drifted and metrics.js is where
// to look, not here.
const ORBIT_V = Y_CROWN - 0.500 * HS;
const L_SKULL = M.skull.depth;
// Porion comes off the TABLE, not off the socket. It used to be placed at the
// orbit's lower rim, ORBIT_V - socket.height / 2, on the reasoning that the
// Frankfurt horizontal runs through porion and orbitale. That is true of a real
// skull and it was the wrong thing to build from, because this skull's orbit is
// a cute one: M.skull.socket.height is 0.242 of L where a real orbit is about
// 0.19, and with the eye line pinned at half the head's height an oversized
// socket pushes its own floor, and therefore the ear canal, DOWN. Measured, it
// put porion 0.071 of L below where the table wants it, which is what made the
// two stretches below disagree by 37% -- the whole vault ran 14% tall and
// everything below the ear ran 17% short. That is the real reason the mandible
// came out as a wire hoop: the ramus outline and the body's height are authored
// in this frame, so they were being squashed by a sixth before they were drawn.
// The vertex is at +0.52 of L above porion and gnathion at -0.42, they sum to
// the table's 0.94, and M.skull.height is now exactly 0.94 of M.skull.depth --
// so pinning porion to either end pins it to both, and the frame comes out
// ISOTROPIC: SY_UP and SY_DN both equal L_SKULL to four places. Every landmark
// in the table is then reachable at its own coordinates rather than through two
// different stretches, which is the point of having a table at all.
//
// What it costs: orbitale now sits 0.071 of L below porion instead of level
// with it, so the Frankfurt horizontal tilts by that much. Of the two, an
// out-of-square measuring convention is much cheaper than a face and a vault
// that are scaled differently, and the socket's size is metrics.js's to change.
const PORION_Y = Y_CROWN - 0.52 * L_SKULL;
const PORION_Z = Z_BACK + 0.40 * L_SKULL;               // opisthocranion at x = -0.40
const SY_UP = (Y_CROWN - PORION_Y) / 0.52;              // vertex at y = +0.52
const SY_DN = (PORION_Y - Y_CHIN) / 0.42;               // gnathion at y = -0.42
const LY = (t) => PORION_Y + t * (t >= 0 ? SY_UP : SY_DN);
const LZ = (t) => PORION_Z + t * L_SKULL;

// A cubic Hermite through (y, z) with Catmull-Rom tangents, extended linearly
// past both ends. It passes through every control point exactly, which is the
// entire reason this is here rather than another smoothstep: a smoothstep is a
// shape you hope lands on a landmark, and this is a landmark you interpolate
// between.
function silhouette(pts) {
  const n = pts.length;
  // Fritsch-Carlson tangents, not plain Catmull-Rom ones. A plain central
  // difference at a LOCAL EXTREMUM is not zero, so the curve overshoots past
  // it and comes back: at opisthocranion, which is exactly such an extremum,
  // that drew a visible kink in the back of the head and put the true furthest
  // point a little above where the reference says. Zeroing the tangent wherever
  // the two secants disagree in sign, and limiting it elsewhere, makes every
  // landmark a genuine turning point of the curve. It also rounds the brow: at
  // the glabella the outline stops going forward and starts going back, and
  // that is the same condition.
  const m = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    if (i === 0 || i === n - 1) return (b[1] - a[1]) / (b[0] - a[0]);
    const sL = (p[1] - a[1]) / (p[0] - a[0]);
    const sR = (b[1] - p[1]) / (b[0] - p[0]);
    if (sL * sR <= 0) return 0;
    const t = (sL + sR) / 2;
    const lim = 3 * Math.min(Math.abs(sL), Math.abs(sR));
    return Math.sign(t) * Math.min(Math.abs(t), lim);
  });
  return (y) => {
    if (y <= pts[0][0]) return pts[0][1] + (y - pts[0][0]) * m[0];
    if (y >= pts[n - 1][0]) return pts[n - 1][1] + (y - pts[n - 1][0]) * m[n - 1];
    let i = 0;
    while (i < n - 2 && y > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0];
    const t = (y - pts[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1]
      + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * pts[i + 1][1]
      + (t3 - t2) * h * m[i + 1];
  };
}

// The posterior outline. basion, inion, opisthocranion, lambda, vertex. The
// two points that matter most are opisthocranion at only 0.18 above the ear --
// the furthest-back point is in the LOWER half of the vault, not the upper
// third, which is what both previous builds got wrong -- and inion, which is
// what drags the outline forward by a third of L while it drops to the base.
// Without inion the back of the head goes out, stays high and falls vertically,
// and that is the teardrop.
const BACK_LINE = silhouette([
  [LY(-0.13), LZ(-0.08)],   // basion
  [LY(+0.06), LZ(-0.34)],   // inion
  [LY(+0.18), LZ(-0.40)],   // opisthocranion
  [LY(+0.42), LZ(-0.22)],   // lambda
  [LY(+0.51), LZ(+0.086)],  // between lambda and the vertex, so the top rounds
  [LY(+0.52), LZ(+0.12)],   // vertex
]);
// The anterior outline. It runs down from the vertex over bregma, out to the
// glabella, in a little to nasion, and in again to orbitale; below that the
// maxilla takes the front over and this only has to stay out of its way.
const FRONT_LINE = silhouette([
  [LY(-0.11), LZ(+0.52)],
  [LY(+0.00), LZ(+0.50)],   // orbitale
  [LY(+0.235), LZ(+0.585)], // nasion
  [LY(+0.28), LZ(+0.60)],   // glabella, the front of L
  [LY(+0.51), LZ(+0.20)],   // bregma
  [LY(+0.52), LZ(+0.12)],   // vertex
]);

// Where the braincase stops. Basion is its lowest authored point; below that
// there is nothing but the condyles, the foramen, the mastoids and the jaw,
// exactly as on a real skull.
const VAULT_BASE = LY(-0.155);
const VAULT_SPAN = Y_CROWN - VAULT_BASE;
const vaultV = (y) => (y - VAULT_BASE) / VAULT_SPAN;
// The largest half-span the authored profile reaches, used to normalise the
// plan's own closure against it.
const SZ_REF = (() => {
  let best = 0;
  for (let i = 0; i <= 200; i++) {
    const y = VAULT_BASE + (VAULT_SPAN * i) / 200;
    best = Math.max(best, (FRONT_LINE(y) - BACK_LINE(y)) / 2);
  }
  return best;
})();
const VAULT_UNIT = Math.min(HW, SZ_REF);

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// The vault's own maximum half-width, as a fraction of HW. It is deliberately
// short of 1, because the vault is not the widest thing on the head: the
// parietal eminences are, and they are a pair of blobs blended on top of it
// down in buildSkull.
const WIDTH_PEAK = 0.965;
// Half-width against height, as a fraction of WIDTH_PEAK * HW. The parietal
// eminences sit about two thirds of the way UP the braincase and the vault
// falls away from them into the crown above and the temporal squama below.
const vaultWidth = (v) => WIDTH_PEAK * (1
  - 0.24 * smoothstep(0.70, 1.06, v)
  - 0.22 * (1 - smoothstep(0.02, 0.62, v)));
// How square the cross-section is, against height. Flat sides and a flat
// frontal plane across the temples, rounding off toward the crown and the base.
// One exponent for the whole vault cannot do that: high enough for a face plane
// the sockets can sit on and the crown squares off into a helmet, low enough
// for a round crown and the face comes to a point and the orbits curl onto the
// temples.
// The upper rolloff used to start at 0.62 and finish past the crown at 1.02,
// so the exponent was still 3.5 at the parietal eminences and 2.9 in the cap.
// A superellipse at 3.5 is 0.82 of its semi-axis on the diagonal against a
// circle's 0.71: from behind and above that is a flat lid meeting flat sides
// along a corner, which is exactly what the rear three-quarter view showed.
// It now finishes at 0.96, inside the vault, so the parietal region rounds.
const vaultPlan = (v) => 2.30
  + 1.35 * smoothstep(0.08, 0.40, v) * (1 - smoothstep(0.50, 0.96, v));
// What the cap relaxes the exponent TOWARD. The cap already replaces the
// authored half-span and half-width with a dome's, but it was leaving the
// exponent alone, so the top of the head was a squared dome: round in outline
// and square in section, which reads as a lid.
const CAP_PLAN = 2.10;
// The plan view's own taper: how wide the section is at a given point along its
// own depth, front to back. A skull seen from above is a blunt egg, widest
// behind the middle at the parietal eminences and narrowing toward the temples
// and the face; a superellipse with one half-width per height is symmetric
// front to back and can only ever be a lozenge. zn runs -1 at the occiput to +1
// at the face, and the peak is parked at -0.25 so the widest point of the head
// is behind its own mid-length in plan as well as high up in profile.
const ZN_PEAK = -0.25;
const planTaper = (zn) => {
  const q = Math.max(-1.6, Math.min(1.6, zn)) - ZN_PEAK;
  return 1 - (q > 0 ? 0.115 : 0.107) * q * q;
};

// The section at a height: its z centre and half-span come straight off the two
// authored curves, and its half-width is the plan profile closed off at both
// ends of the vault.
//
// The plan's closure is tied to the PROFILE's rather than authored separately:
// where the outline is narrow front to back, near the crown, the head is narrow
// side to side too, which is what a dome does. Only the base needs its own
// term, because the profile does not close there -- the braincase's floor is a
// real edge on a real skull, and cb rounds it rather than leaving a rim.
const cb = (y) => Math.sqrt(smoothstep(VAULT_BASE, VAULT_BASE + 0.16 * VAULT_SPAN, y));
// ...and the crown needs its own, for a different reason. The reference puts
// bregma only 0.01 of L below the vertex, so the two authored curves converge
// over almost no height at all: their half-span goes to zero LINEARLY in the
// last millimetre and the vault caps in a wedge, a visible spike on the top of
// the head. Tapering that linear span by a further square root only made it
// worse (the product closes as the 1.5 power, which is sharper still).
//
// So the top eighteen per cent of the vault does not use the authored
// convergence at all. It is a circular cap -- half-span proportional to the
// square root of the distance below the crown, which is what a dome is -- blended
// into the authored profile with a smoothstep whose derivative vanishes at both
// ends, so the join is C1 and leaves no shading crease. The same factor closes
// the PLAN, otherwise the section stays wide side to side while going thin
// front to back and the crown comes to a blade instead of a dome.
const CAP_FRAC = 0.18;
const Y_CAP = Y_CROWN - CAP_FRAC * VAULT_SPAN;
const VERTEX_Z = LZ(0.12);
function vaultSection(y) {
  if (y > Y_CROWN || y < VAULT_BASE) return null;
  const zf = FRONT_LINE(y), zb = BACK_LINE(y);
  let half = (zf - zb) / 2;
  let cz = (zf + zb) / 2;
  const v = vaultV(y);
  let sx = HW * vaultWidth(v) * Math.pow(clamp01(half / SZ_REF), 0.55);
  let ph = vaultPlan(v);
  if (y > Y_CAP) {
    const u = clamp01((Y_CROWN - y) / (CAP_FRAC * VAULT_SPAN));
    const w = u * u * (3 - 2 * u);
    const rc = Math.sqrt(Math.max(0, 2 * u - u * u));
    half = (1 - w) * CAP.half * rc + w * half;
    cz = (1 - w) * (VERTEX_Z + (CAP.cz - VERTEX_Z) * rc) + w * cz;
    sx = (1 - w) * CAP.sx * rc + w * sx;
    ph = (1 - w) * CAP_PLAN + w * ph;
  }
  const k = cb(y);
  if (half <= 1e-5 || sx <= 1e-5) return null;
  return { cz, sz: half * k, sx: sx * k, ph };
}
// The section the cap is hung on, sampled just below the join so the values it
// blends toward are the authored ones.
const CAP = (() => {
  const y = Y_CAP;
  const zf = FRONT_LINE(y), zb = BACK_LINE(y);
  const half = (zf - zb) / 2;
  return {
    half,
    cz: (zf + zb) / 2,
    sx: HW * vaultWidth(vaultV(y)) * Math.pow(clamp01(half / SZ_REF), 0.55),
  };
})();

function vaultField(x, y, z) {
  const s = vaultSection(y);
  // Outside the vault's own height band the field is positive and constant, so
  // a ray walking up past the crown or down past the base leaves cleanly.
  if (!s || s.sx <= 1e-5 || s.sz <= 1e-5) return 0.5 * VAULT_UNIT;
  const zn = (z - s.cz) / s.sz;
  const ax = Math.abs(x / (s.sx * planTaper(zn)));
  const az = Math.abs(zn);
  const r = Math.pow(Math.pow(ax, s.ph) + Math.pow(az, s.ph), 1 / s.ph);
  return (r - 1) * VAULT_UNIT;
}

// --- the face --------------------------------------------------------------
// The maxilla is a rounded box rather than an ellipsoid (exponent well above
// 2), because the tooth row has to have bone directly above it all the way out
// to the back molars. An ellipsoid's underside curves away at the corners and
// leaves the outer teeth hanging in air -- a fault two builds back had.
//
// It also stops SHORT of the glabella now, by 0.035 of the skull's depth. The
// glabella is the front reference for the skull's length and it has to be the
// most anterior thing on the head or the cranial index is measured off the
// wrong landmark; a face plane flush with it also loses the small step under
// the brow that reads, in profile, as a brow at all.
const MAX_TOP = 0.215 * HS;
const MAX_BOTTOM = 0.105 * HS;                // the palate, just above the crowns
// Wider than it was. The face plane has to carry a cheek out to the root of
// the zygomatic arch, and at 0.298 the maxilla stopped short of it and left the
// arch springing out of nowhere.
const MAX_HALF_W = 0.330 * M.skull.width;
const MAX_FRONT = Z_FACE - 0.035 * M.skull.depth;
const MAX_BACK = MAX_FRONT - 0.600 * M.skull.depth;

// --- the tooth rows --------------------------------------------------------
// Not in metrics.js: only the counts are. Sized off the photo, where the
// visible tooth row is a shade under half the skull's width, and written as
// fractions of the measurements that ARE there so a change of scale carries.
// The two arches are held as fractions of the skull's depth, which just grew by
// 7%, so the rows would have run forward of the face if they were left alone.
// They are pulled back to keep the incisors under the nasal aperture rather
// than in front of it.
// ...and then pushed forward again, harder, when the reference's coordinate
// table arrived: prosthion, the front of the upper tooth row, is at +0.555 of L
// and pogonion, the front of the chin, at +0.525, both measured from the ear
// canal. The rows were sitting 0.06 of L behind that, which is most of why the
// face read as a small snout tucked under the braincase rather than as a block.
const UPPER_ARCH = { halfW: 0.262 * M.skull.width, front: 0.412 * M.skull.depth, back: 0.236 * M.skull.depth };
const LOWER_ARCH = { halfW: 0.222 * M.skull.width, front: 0.3855 * M.skull.depth, back: 0.2185 * M.skull.depth };
// Shorter crowns than the 0.066 this used to be. The eye line is at half the
// head's height now, which is where a real one is, and that leaves 0.19 of the
// height between the orbit's floor and the bite line for a nasal aperture, a
// nasal floor and a strip of maxilla under it. Tall teeth eat that strip, and
// what they eat first is the clearance the nasal floor needs.
const TOOTH_H = 0.056 * HS;
const TOOTH_D = 0.042 * HS;
// The rows do not meet. In the reference there is a dark line between them and
// it is most of what stops the mouth reading as a painted stripe.
const AJAR = 0.015 * HS;

// --- the mandible ----------------------------------------------------------
// A bone, not a hoop. This is the third attempt and the first two failed the
// same way, so the method matters more than the numbers.
//
// The body used to be shaft(): ONE swept radius, squashed vertically
// afterwards. A single radius plus a single global squash gives the chin and
// the angle of the jaw the same section, and a mandible's whole character is
// that they are not the same -- the symphysis is a deep block with a squared
// bottom-front corner, the body behind it is a thinner blade, and the angle
// swells again where the masseter lands. What it produced was a bar of even
// thinness that read as wire, with the lower border almost flat, so the jaw was
// a hoop slung under the head. The note above shaft() about a round tube not
// being able to be thin one way and deep the other was right as far as it went;
// it just did not go far enough, because the section also has to CHANGE.
//
// So the body is swept by sweepBar() below, which carries an authored
// superellipse: half-height, half-thickness and squareness are each a function
// of the distance from the chin. Nothing is squashed afterwards.
//
// The heights come off the table and the metric, in that order. M.skull.
// jawHeight is the bite line to the chin and it is 0.154 of L, where the
// table's prosthion-to-gnathion is 0.185: the bone is working in about five
// sixths of the room a real one has, and that is the box, not this file. What
// this file can do with what is left is spend it on bone rather than on air,
// which is what these three numbers are for.
const HH_CHIN = 0.049 * HS;                   // half thickness, front to back at the chin
const HH_MID = 0.039 * HS;                    // and side to side along the body
const HH_ANGLE = 0.050 * HS;                  // swelling again at the angle
// How square the section is: a real symphysis is nearly a rounded rectangle
// and it is the only way gnathion, the BOTTOM of the chin, reaches +0.50 of L
// forward. A circular section's bottom-front corner curves away and measured
// +0.44 there, which is the single miss the previous pass could not shift.
const SEC_P_CHIN = 3.6;
const SEC_P_MID = 2.7;
const SEC_P_ANGLE = 3.1;
const RAMUS_R = 0.062 * HS;                   // only the condyle's ball now
// How far past the last molar the body runs, and how far it swings OUT on the
// way. The flare is the fix for a jaw with no visible angle: at extend 1.62 and
// no flare the gonion sat at 0.56 of the skull's half-width, tucked inside the
// silhouette, and from the side and from behind the mandible read as a hoop
// hanging under the head with no corner to it. These put it at 0.75, and a real
// bigonial breadth is about 0.72 of the cranium's. The flare only bites beyond
// the last tooth, so the tooth row does not widen with it.
// Extended from 1.55 and the flare eased from 0.55 to keep the same bigonial
// breadth: the extra length is spent taking the angle of the jaw BACKWARD past
// the hinge rather than outward. At 1.55 the gonion came out at z = -0.058 of
// the depth and the hinge at -0.080, so the corner of the jaw sat in FRONT of
// the ear canal -- the reference is explicit that it belongs below and behind
// it, and a gonion in front of the hinge is most of why the old mandible read
// as a hoop slung under the head rather than as a jaw hung off a joint.
const JAW_EXTEND = 1.568;
const JAW_FLARE = 0.60;
// The hinge, which is also where this build measures the ear canal: the condyle
// sits in the mandibular fossa immediately in front of the meatus and the two
// are within a couple of millimetres of each other on a real skull.
//
// Both coordinates come off the reference's table now rather than being aimed
// at: condylion is at (-0.03, +0.01) in the porion frame, so the hinge sits
// just behind and just above the ear canal, and the ear canal is on the
// Frankfurt horizontal through orbitale. Nothing here is free.
const HINGE_Y = PORION_Y + 0.01 * SY_UP;
const HINGE_Z = PORION_Z - 0.03 * L_SKULL;
// The condyle rides NARROWER than the gonion, so the ramus leans inward on its
// way up and the joint tucks under the root of the zygomatic arch instead of
// standing off the side of the head as a bare knob. A real bicondylar breadth
// is wider than a bigonial one, but a real skull is also wider at the ear than
// this one gets to be, and of the two errors a condyle outside the silhouette
// is the one that shows.
// Widened from 0.58. The condyle still has to be narrower than the gonion, and
// is, but at 0.58 the whole top of the ramus -- the notch and the coronoid with
// it -- sat medial to the surface of the cheek and was invisible in profile. A
// notch nobody can see is not a notch.
const HINGE_X = 0.63 * (M.skull.width / 2);
const FORAMEN_Z = -0.150 * M.skull.depth;

// The body's two borders, as functions of s, the distance from the chin along
// the sweep with 1 at the angle. A mandible is not a bar of constant depth:
// its lower border climbs from gnathion to the gonion and its upper border,
// the alveolar margin, stays level under the teeth and then climbs much
// harder past the last molar into the ramus. Authoring the two borders and
// deriving the section from them, rather than authoring a centreline and a
// thickness, is what keeps the tooth-bearing part level while the angle rises.
//
// BODY_TOP buries the bottom quarter of each lower crown. On a dry skull the
// crowns stand entirely clear of the bone, and building it that way is what
// left the teeth perched on a rail with the body a sliver under them: of the
// 0.154 of L between the bite line and the chin the crowns were taking a third
// and the bone got the rest. A slightly high alveolar margin reads as a jaw
// with teeth in it and costs nothing that can be seen.
const BODY_TOP = Y_BITE - 0.72 * TOOTH_H;
// The gonion. The table puts it at -0.30 of L, 0.12 above gnathion; at that
// height, with this jawHeight, the body would have to close to nothing before
// it got there. -0.315 is as much rise as the box affords and it still reads
// as a lower border that climbs, which is the point of it.
const GONION_Y = LY(-0.315);
// And how far the alveolar margin climbs past the last molar. This is the
// retromolar rise, and it is most of what turns the back of the jaw from a
// rod into the foot of a ramus.
const ANGLE_TOP = BODY_TOP + 0.109 * HS;
const jawTop = (s) => BODY_TOP + (ANGLE_TOP - BODY_TOP) * smoothstep(0.55, 1.0, s);
const jawBot = (s) => Y_CHIN + (GONION_Y - Y_CHIN) * s * s * s;
const jawHV = (s) => (jawTop(s) - jawBot(s)) / 2;
const jawCY = (s) => (jawTop(s) + jawBot(s)) / 2;
const jawHH = (s) => HH_CHIN
  + (HH_MID - HH_CHIN) * smoothstep(0.00, 0.50, s)
  + (HH_ANGLE - HH_MID) * smoothstep(0.60, 1.00, s);
const jawSecP = (s) => SEC_P_CHIN
  + (SEC_P_MID - SEC_P_CHIN) * smoothstep(0.00, 0.50, s)
  + (SEC_P_ANGLE - SEC_P_MID) * smoothstep(0.60, 1.00, s);

// --- the openings ----------------------------------------------------------
// How far the top edge of each orbit cuts down toward the nose. Small: enough
// that the sockets are not dead level and mechanically symmetrical, nowhere
// near enough to read as a frown. It was 0.60 for one pass, which is a hard
// glare, and metrics.js has the history.
const SLANT = M.skull.socket.slant;
// metrics gives the socket as a width and a height, which is its bounding box.
// Rotating an ellipse by s takes semi-axes (A, B) to a box of
//   halfW^2 = A^2 cos^2 s + B^2 sin^2 s,  halfH^2 = A^2 sin^2 s + B^2 cos^2 s,
// so the almond that fits the given box is this, inverted. Authoring A and B
// directly instead was tried and rejected: the socket then grows and shrinks
// whenever the slant is tuned, and the two are not supposed to be coupled.
const SOCKET = (() => {
  const cs = Math.cos(SLANT), sn = Math.sin(SLANT);
  const hw = M.skull.socket.width / 2, hh = M.skull.socket.height / 2;
  const c2 = cs * cs - sn * sn;
  return {
    a: Math.sqrt(Math.max(1e-8, (hw * hw * cs * cs - hh * hh * sn * sn) / c2)),
    b: Math.sqrt(Math.max(1e-8, (hh * hh * cs * cs - hw * hw * sn * sn) / c2)),
    cs, sn,
  };
})();
// Gap across the nasal bridge, measured off the photo as a fraction of skull
// width. Everything else about the orbit's placement follows from it.
const BRIDGE = 0.145 * M.skull.width;
const ORBIT_U = BRIDGE / 2 + M.skull.socket.width / 2;
// metrics' socket is a fifth taller, relative to the skull, than the photo's
// is; taking it at face value and hanging it at the photo's height leaves
// almost no maxilla between the socket and the tooth row. So the socket keeps
// the size metrics gives it and rides higher than the photo's does, which costs
// forehead and buys back a face.
//
// 0.495 was the value two passes ago and 0.462 the last one, and both were
// aimed at the crown-to-brow distance instead of at the eye line itself. The
// eye line is the one landmark in a head that is worth measuring first: the
// centres of the orbits sit at exactly half of vertex-to-chin, and everything
// else in the face is checked against them. So it is 0.500 and it is not a
// tuning parameter. ORBIT_V itself is declared up with the vault, because the
// eye line is what pins the face's whole vertical: it is at exactly half of
// vertex-to-chin, and everything in the face is measured from it.

// The nasal aperture is not in metrics.js. Written against the socket so the
// two stay in proportion. Its floor has to clear the crowns of the upper teeth:
// two builds ago it hung 0.007 BELOW them, which is why the nose and the mouth
// used to run together into one dark smear on the front of the face.
//
// Now sized off the reference rather than guessed: the aperture is about half
// the orbit's height, and as wide at its base as it is tall. Its apex reaches up
// BETWEEN the orbits, just under the eye line, which is what makes it read as a
// pear rather than as a keyhole punched into the middle of the maxilla -- there
// is no room below the orbits for the whole of it, and there is not supposed to
// be. The floor clears the tooth crowns by 0.10 of the head's height.
//
// Dropped from 0.588. With the porion frame square the aperture's floor
// measured -0.096 of L against the table's nasospinale at -0.110, so the strip
// of maxilla between the nose and the tooth tips was running 0.156 of L where
// the table's nasospinale-to-prosthion is 0.125. A long blank strip there is
// the thing that makes a face read as a muzzle, and it is the last of the face
// landmarks that was still out.
const NASAL_W = 0.46 * M.skull.socket.width;
const NASAL_H = 0.52 * M.skull.socket.height;
const NASAL_V = Y_CROWN - 0.603 * HS;

// How thick the bone is at the edge of a cut, which is the depth of the wall
// inside every opening. Two things bracket it. Below about two grid cells the
// wall has less than one quad of shading in it and reads as a painted line
// rather than as a thickness; above about 3% of the head's height it exceeds
// the radius of curvature of the valley between the nasal aperture and the
// medial wall of an orbit, and anything offset inward by more than that in
// there folds through itself. 2.3% is between the two, and it is also roughly
// what a 5mm vault measures on a 145mm skull.
const WALL_T = 0.023 * HS;
// The rest of the wall's numbers are held as fractions of it rather than
// authored separately, exactly as pumpkin.js holds its own: change the
// thickness and the lip, the taper and the lap follow.
const WALL_LIP = 0.42 * WALL_T;               // how far the top ring laps back over the skin
const WALL_PROUD = 0.02 * WALL_T;             // and how far it stands off it
const WALL_TAPER = 0.18 * WALL_T;             // the cut narrows slightly toward its floor
// How deep the cavity behind an opening goes, measured from the bottom of the
// wall. A real orbit is deep -- deeper than this -- but the two of them have to
// pass either side of the nasal cavity without meeting, and a bowl this deep
// already occludes its own far side from three quarters, which is the whole
// point of it.
const ORBIT_CAVITY = 0.135 * HS;
const NASAL_CAVITY = 0.075 * HS;

// The face is unwrapped about the vertical axis so a socket keeps its size as
// it curls round onto the temple. FACE_R is the radius that arc length is
// measured at: it is the distance from the axis out to the brow, so the socket
// is honest where it matters and only slightly stretched elsewhere.
//
// It used to be a fraction of the WIDTH, which was very nearly the same as a
// fraction of the depth while the two were equal, and stopped being so the
// moment they were corrected: 0.45 of the new width is 0.141 against a face
// that stands 0.184 out from the axis, so every opening was being placed at a
// third again the bearing its arc length called for. The orbits' outer rims
// came out at 60 degrees round the head, curling onto the temples, and the pair
// of them spanned almost the whole frontal arc. Held against the DEPTH instead
// they land at 50 degrees with the temporal flat and the arch's root clear
// behind them, and the sockets come out the size metrics says they are.
const FACE_R = 0.42 * M.skull.depth;

// Where the sphere grid is centred. Deep inside the vault, so that every ray
// out of it reaches the surface without leaving the solid on the way.
const P0 = new THREE.Vector3(0, 0.335 * HS, 0);

// Tessellation. The count is set by the openings, not by the silhouette: the
// vault is smooth at a third of this, but the edge of a cut is a contour
// crossing the grid at an arbitrary angle and it can only be as clean as the
// grid it lands on. At 96 rows it stepped visibly in a head crop; at 176 the
// painted edge of the old dented socket was clean but a real cut, which shows
// its own wall, wants more. These put roughly 27 cells across an orbit.
const NTH = 224;
const NPH = 152;

// Polynomial smooth minimum. k is a real length, so the blend fillet between
// two parts is the same size wherever it happens.
const smin = (a, b, k) => {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
// ...and its max, which is how a pit gets subtracted out of the solid.
const smax = (a, b, k) => -smin(-a, -b, k);

// A superellipsoid as a field: negative inside, zero on the surface. Scaled by
// its smallest semi-axis so the value is roughly a length, which is what lets
// smin blend a big vault into a small cheekbone without the small one being
// swallowed.
//
// Two exponents, not one. `ph` squares off the PLAN view and `pv` the profile,
// and they have to be independent: the maxilla has to be flat underneath so the
// tooth row has bone over it, and rounded in plan so the face plane does not
// meet the side of the head at a corner. The vault wants the same split and
// wants it to VARY with height, which is why it has its own field above rather
// than calling this.
function blob(c, s, ph, pv = ph) {
  const unit = Math.min(s[0], s[1], s[2]);
  const round = ph === 2 && pv === 2;
  return (x, y, z) => {
    const ax = Math.abs((x - c[0]) / s[0]);
    const ay = Math.abs((y - c[1]) / s[1]);
    const az = Math.abs((z - c[2]) / s[2]);
    if (round) return (Math.sqrt(ax * ax + ay * ay + az * az) - 1) * unit;
    const h = Math.pow(Math.pow(ax, ph) + Math.pow(az, ph), pv / ph);
    return (Math.pow(h + Math.pow(ay, pv), 1 / pv) - 1) * unit;
  };
}

// A swept tube as a field: the brow ridges, the zygomatic arches and the
// alveolar ridge are all this. Bounded, so a point nowhere near it costs six
// comparisons rather than a walk down the polyline.
//
// The polyline is resampled fine on the way in. A capsule chain is only C0 at
// its joints, and at thirteen segments along a brow those joints came through
// the socket pressed underneath them as a fan of streaks.
function tube(rough, r) {
  const points = rough.length > 2
    ? new THREE.CatmullRomCurve3(rough, false, 'centripetal', 0.5).getSpacedPoints(44)
    : rough;
  const n = points.length;
  const p = new Float32Array(n * 3);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = points[i];
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
  }
  const pad = r * 3;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  return (x, y, z) => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return 1e3;
    let best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      const bx = p[i * 3 + 3], by = p[i * 3 + 4], bz = p[i * 3 + 5];
      const ex = bx - ax, ey = by - ay, ez = bz - az;
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
// lay the brow and the cheekbone ON the vault rather than at guessed radii:
// tune the ridge's height and how proud it stands, never its x and z.
function surfaceRho(field, ang, y) {
  const sx = Math.sin(ang), sz = Math.cos(ang);
  let lo = 0, hi = M.skull.depth;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (field(sx * mid, y, sz * mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- the socket ------------------------------------------------------------
// A wide soft oval that fills most of the box metrics gives it. kx runs -1
// (medial, by the nose) to +1 (lateral, by the temple).
//
// What is NOT here any more: a medial taper that dropped the socket to 0.6 of
// its height by the nose, and a top exponent of 3 that straightened the upper
// edge into a hard lid. Together with the old slant those made the almond that
// scowled. The taper that is left is slight, and it is the real thing -- an
// anatomical orbit is a touch shallower at its medial corner -- rather than an
// expression.
//
// The exponents sit well above 2 so the opening is a rounded rectangle rather
// than a pure ellipse. A true ellipse read as a cartoon eye; the straight-ish
// stretches along the top and bottom are what keep it a skull, and the
// reference is explicit that a real orbit is roughly square with generously
// rounded corners -- neither an almond nor a circle. Raised from 2.35 and
// 2.5/2.2 for this pass. The warning in the history stands and is worth
// repeating: at 3.0 on the top edge, with the old medial taper of 0.6 and the
// old slant of 0.60 under it, this was the frown. What makes it safe here is
// that the taper is 0.88 and the slant is 0.12; a square opening is only a glare
// when something else is already pulling its top edge down toward the nose.
const SOCKET_TAPER_LO = 0.88;
const SOCKET_PX = 2.55;
function socketTaper(kx) {
  return SOCKET_TAPER_LO + (1 - SOCKET_TAPER_LO) * smoothstep(-1, 0.35, kx);
}
function socketShape(kx, ky) {
  const k = ky / socketTaper(kx);
  // The bottom edge is rounder than the top. That is the anatomy -- the
  // supraorbital margin is a sharp edge and the inferior one is rounded -- and
  // the top edge is the one that has to stay straight for the opening to read as
  // a skull's rather than as an eye. It was ALSO tried as a fix for the game
  // camera, which looks down at the figure and foreshortens each socket into a
  // wedge that reads as a glare, and it does nothing for that: the wedge is the
  // lit floor of the socket showing on its medial side, not the shape of the
  // outline, and it was in the two builds before this one for the same reason.
  const e = ky > 0 ? 2.55 : 2.20;
  return Math.pow(Math.abs(kx), SOCKET_PX) + Math.pow(Math.abs(k), e);
}
// The top edge of the socket, in the same frame, at a given kx.
function socketTop(kx) {
  const rem = 1 - Math.pow(Math.abs(kx), SOCKET_PX);
  return rem <= 0 ? 0 : socketTaper(kx) * Math.pow(rem, 1 / 2.55);
}
// Face-space (u across, v up) coordinates of a point in the socket's own frame.
function socketToFace(side, q, w) {
  return [
    side * (ORBIT_U + q * SOCKET.cs - w * SOCKET.sn),
    ORBIT_V + q * SOCKET.sn + w * SOCKET.cs,
  ];
}

// The nasal aperture: an inverted teardrop, apex up between the orbits, with
// the anterior nasal spine notching its lower lip. b runs -1 (bottom) to +1.
function nasalShape(a, b) {
  const w = Math.pow(clamp01((1 - b) / 2), 0.55);
  const t = Math.pow(Math.abs(a / Math.max(0.10, w)), 2.2) + Math.pow(Math.abs(b), 3.0);
  const sa = a / 0.34, sb = (b + 0.82) / 0.30;
  return t + 0.34 * Math.exp(-(sa * sa + sb * sb));
}

// --- the openings, as closed outlines in face space ------------------------
// Face space is (u across the face, v up): u is arc length round the vertical
// axis measured at FACE_R, v is world height. It is the same space the socket
// and the nasal aperture were already authored in, and -- this is the point --
// the sphere grid the cranium is sampled on is a grid IN it: a vertex's u is
// its bearing times FACE_R and its v is its own height. So an opening is just a
// region of that grid, and cutting it needs no CSG at all. pumpkin.js proved
// the whole method on its carved face; this is the same four steps.
//
// Each outline is walked off the shape function itself rather than written out
// a second time, so the hole, the wall inside it and the cavity behind it are
// the same curve by construction.
function outlineFrom(shape, n, toFace) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const cx = Math.cos(t), cy = Math.sin(t);
    // March out until the shape function passes 1, then bisect. Marching first
    // matters for the nasal aperture: the spine's bump adds to the function
    // inside the outline, so a blind bisection over [0, 2] can trap the wrong
    // crossing on the rays that pass through it.
    let lo = 0, hi = 0.05;
    while (hi < 3 && shape(hi * cx, hi * cy) < 1) { lo = hi; hi += 0.05; }
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (shape(mid * cx, mid * cy) < 1) lo = mid; else hi = mid;
    }
    pts.push(toFace((lo + hi) / 2 * cx, (lo + hi) / 2 * cy));
  }
  // Wound counter-clockwise, so "into the cut" is one fixed rotation of the
  // edge tangent everywhere. A left socket comes out of socketToFace mirrored
  // and would otherwise carry every wall normal backwards.
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

// Crossing count, bounding box first. Without the box this runs over every grid
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

// Nearest point on an outline, and the inward normal of the segment it landed
// on. That normal is what the wall is built against, so no loop tracing is
// needed: each rim vertex carries its own direction into the cut.
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

// How far outside a cut the skin still picks up some occlusion from it. There
// is no global illumination in this scene, so the soft dark ring a real
// opening sits in has to be painted; it is small, and it is the only paint left
// on this head now that the sockets are holes.
const AO_REACH = 0.030 * HS;

// A tooth. bone.js has no vocabulary for one, and it should not: a tooth is a
// rounded block, not a shaft or a plate. A superellipsoid at exponent ~3 is a
// block with no edge on it anywhere, which is the house look in one line.
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

// A dental arch as an arc-length parameterised curve, so the teeth come out
// evenly spaced instead of bunching at the front where the parabola is flat.
// The arch describes the OUTER face of the tooth row; everything else in the
// mouth is that curve inset, which is what keeps bone from creeping in front
// of the crowns and swallowing them.
// `rise` lifts the ends of the curve. The mandible's lower border is not a
// flat line: it climbs from the chin to the angle, and without that the bar
// reads as a bib clipped on under the teeth.
// `flare` swings the ends OUTWARD, and only the part beyond the last tooth
// (|u| > 1), so the mandible can reach a real gonial width without the tooth
// row widening with it.
function archCurve({ halfW, front, back }, y, { inset = 0, extend = 1, rise = 0, flare = 0 } = {}) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const u = (-1 + (2 * i) / n) * extend;
    const out = 1 + flare * Math.max(0, Math.abs(u) - 1);
    pts.push(new THREE.Vector3(
      (halfW - inset) * u * out,
      y + rise * u * u,
      front - inset - (front - back) * u * u,
    ));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
}

// A swept bar carrying an AUTHORED cross-section.
//
// `centre(u)` gives the section's centre for a parameter u, and `section(u)`
// gives {hv, hh, p}: half-height, half-thickness and the superellipse exponent
// there. The section's own axes are world up flattened into the ring's plane,
// and the horizontal perpendicular to the sweep, so "half-height" always means
// up and down however the bar turns -- which is what a jaw needs and what a
// Frenet frame will not give you, since a Frenet frame rolls.
//
// This exists because shaft() cannot: it sweeps one radius, and squashing the
// result afterwards applies the same squash to every station. See the mandible
// block above for the two builds that cost.
//
// The seam column is NOT duplicated, for the same reason the cranium's is not:
// two coincident columns get separately averaged normals and draw a crease.
function sweepBar(centre, section, uMin, uMax, nU, nR = 24) {
  const verts = new Float32Array((nU + 1) * nR * 3);
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
    side.crossVectors(T, up);
    if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
    side.normalize();
    vup.crossVectors(side, T).normalize();
    const { hv, hh, p } = section(u);
    for (let j = 0; j < nR; j++) {
      const th = (2 * Math.PI * j) / nR;
      const ct = Math.cos(th), st = Math.sin(th);
      const r = Math.pow(
        Math.pow(Math.abs(ct) / hh, p) + Math.pow(Math.abs(st) / hv, p),
        -1 / p,
      );
      const k = (i * nR + j) * 3;
      verts[k] = c.x + side.x * r * ct + vup.x * r * st;
      verts[k + 1] = c.y + side.y * r * ct + vup.y * r * st;
      verts[k + 2] = c.z + side.z * r * ct + vup.z * r * st;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildSkull({ material }) {
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];
  const track = (g) => { geometries.push(g); return g; };

  // The vault, the walls in its cuts and the cavities behind them all carry
  // vertex colours; the teeth and the mandible do not, so they keep the shared
  // material untouched.
  const skin = material.clone();
  skin.vertexColors = true;
  materials.push(skin);

  // Named, because the landmark check reads the built geometry rather than the
  // constants above and has to know which mesh is which.
  const add = (geo, mat, name = '') => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ---------------------------------------------------------------- the field
  const maxilla = blob(
    [0, (MAX_TOP + MAX_BOTTOM) / 2, (MAX_FRONT + MAX_BACK) / 2],
    [MAX_HALF_W, (MAX_TOP - MAX_BOTTOM) / 2, (MAX_FRONT - MAX_BACK) / 2],
    // Rounded in plan, flat underneath. Boxy both ways (3.6) put a hard
    // vertical corner where the face plane met the side of the head.
    3.1, 4.0,
  );
  const base = (x, y, z) => smin(vaultField(x, y, z), maxilla(x, y, z), 0.055);

  // The supraorbital shelves, laid along the top edge of each socket and
  // standing slightly proud of it. Every number here came down once already: a
  // ridge this size is the difference between a brow and a scowl, and the
  // socket under it is level now, so all it has to do is give the opening a
  // rim.
  //
  // Lifted 0.030 clear and fattened to 0.068 it met its opposite number over
  // the nose in a raised triangle that read as a snout. At 0.054 with the old
  // diagonal under it, it was the frown itself. What HAS gone up is how proud
  // it stands (0.030 of the head's height rather than 0.018): the socket is a
  // real hole now, so its rim is a crisp edge and the shelf above it has to be
  // a real shelf or the eye reads the edge and nothing else.
  // BROW_R and BROW_INSET now live at the top of the file: the vault's frontal
  // plane is derived from how proud they make the brow stand, so that the
  // glabella between them lands exactly on Z_FACE.
  const BROW_LIFT = 0.020 * HS;
  const brows = [-1, 1].map((side) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      // Stops short of the medial corner. Carried all the way in, the two
      // shelves converge over the bridge and rebuild the V by themselves.
      const kx = -0.72 + (1.60 * i) / 12;
      const [u, v] = socketToFace(side, kx * SOCKET.a, socketTop(kx) * SOCKET.b + BROW_LIFT);
      const ang = u / FACE_R;
      const rho = surfaceRho(base, ang, v) - BROW_INSET;
      pts.push(new THREE.Vector3(Math.sin(ang) * rho, v, Math.cos(ang) * rho));
    }
    return tube(pts, BROW_R);
  });

  // There is no glabella blob any more. There used to be one, because the
  // vault's frontal plane stopped short of the face and something had to carry
  // the most anterior point of the skull; the profile is authored through the
  // glabella now, so the vault's own surface IS the glabella and a blob on top
  // of it would only push the front of the head past where the reference puts
  // it. The brows likewise ride nearly flush rather than proud.

  // The parietal eminences: the pair of low, broad swellings that are the
  // widest part of a real braincase. They were left to the width profile alone
  // at first, which cannot do it: a profile varies with HEIGHT, so the widest
  // point it produces is a whole horizontal band, and whichever ridge happens to
  // ride on that band wins the measurement. The temporal line did, and the
  // widest point of the head came out at the line's crest -- level with the ear
  // canal in plan rather than behind it. Two thirds up the braincase and a third
  // of the way forward from the occiput is a POINT, so it is a blob.
  // Held a little under half the skull's width rather than at it: the smin that
  // blends the eminence into the vault carries the surface out past the blob's
  // own radius, and the pair of them ARE what M.skull.width measures. Trimmed
  // against the measured breadth until the two agreed.
  const PARIETAL_RX = 0.096 * M.skull.width;
  const PARIETAL_X = 0.4335 * M.skull.width;
  const parietal = (side) => blob(
    [side * (PARIETAL_X - PARIETAL_RX), VAULT_BASE + 0.667 * VAULT_SPAN, Z_BACK + 0.360 * M.skull.depth],
    [PARIETAL_RX, 0.155 * HS, 0.210 * M.skull.depth], 2);

  // The nasal bones. Small, and only there for the PROFILE: with the glabella
  // above it and the nasal aperture's apex below it, the strip of midline face
  // between the orbits was a flat continuation of the forehead, so the whole
  // front of the head from brow to teeth read as one convex sweep. A real one
  // has a step in it -- glabella out, nasion in, nasal bones out again -- and
  // the notch at nasion is what tells the eye where the braincase stops and the
  // face starts. The dip is not modelled: it is the gap between this blob and
  // the glabella above, which is why neither of them is blended wide.
  const nasalBone = blob(
    // Pulled back from Z_FACE. The authored profile puts the front of the face
    // at its own height, and a bump that reached the glabella's own plane made
    // the nose the front of the skull instead of the brow: measured, the
    // front-most point of the head was at +0.60 of L but 0.14 up rather than
    // 0.28 up, which is the nose, not the glabella.
    [0, ORBIT_V + 0.048 * HS, Z_FACE - 0.112 * M.skull.depth],
    [0.072 * M.skull.width, 0.034 * HS, 0.075 * M.skull.depth], 2.4, 2.2,
  );

  // The zygomatic bone, at the outer-lower corner of the orbit, and the root of
  // the arch on the temporal bone just above and in front of the ear canal.
  // These two are the arch's ABUTMENTS and they are the only part of it in the
  // field; the span between them is a separate mesh, built below, standing off
  // the side of the head with daylight behind it.
  //
  // The whole of the previous build's arch was in the field, swept along the
  // vault's own surface at a fixed inset, and blended into it with smin. That
  // cannot produce a gap -- a smooth union of two solids is one solid -- so what
  // it produced instead was a moulding seam, and the note it left behind about
  // standing "a little prouder" was chasing an effect the method cannot reach.
  // The gap is the single strongest skull cue in a three-quarter view, so the
  // arch stops being part of the head and becomes a bridge over it.
  const malar = (side) => blob(
    [side * 0.300 * M.skull.width, ORBIT_V - 0.158 * HS, 0.265 * M.skull.depth],
    [0.120 * M.skull.width, 0.072 * HS, 0.105 * M.skull.depth], 2.4);
  const zygRoot = (side) => blob(
    [side * 0.345 * M.skull.width, HINGE_Y + 0.048 * HS, -0.155 * M.skull.depth],
    [0.090 * M.skull.width, 0.070 * HS, 0.125 * M.skull.depth], 2.4);
  // The lateral orbital margin: the frontal process of the zygomatic, a narrow
  // vertical bar of bone at the outer edge of each orbit running from the end of
  // the brow down to the cheek. In profile it is the single feature that makes
  // an orbit read as a socket rather than as a hole in the side of a dome --
  // there is a rim standing forward and the temporal fossa dropping away behind
  // it, and the eye reads the step between them. Kept strictly LATERAL of the
  // socket's own outline: a blob centred inside it does not build a rim, it
  // bulges into the opening.
  const orbitalRim = (side) => blob(
    [side * 0.400 * M.skull.width, ORBIT_V - 0.015 * HS, 0.235 * M.skull.depth],
    [0.070 * M.skull.width, 0.135 * HS, 0.070 * M.skull.depth], 2.4);
  const malarL = malar(-1), malarR = malar(1);
  const rimL = orbitalRim(-1), rimR = orbitalRim(1);
  const rootL = zygRoot(-1), rootR = zygRoot(1);

  // The temporal fossa: the shallow dish on the side of the vault between the
  // temporal line above and the arch below. It is subtracted, not implied.
  //
  // The previous build claimed the fossa as a side effect of the vaultPlan
  // exponent -- "above the arch the side of the head is a plane" -- and a plane
  // is not a dish. With nothing hollowed out, the arch had nothing to stand off
  // and no amount of proudness would have given it a shadow. This is a very
  // large ellipsoid barely intersecting the side of the head, so the cut is a
  // broad shallow saucer about 0.024 of the head's height deep rather than a
  // thumbprint: FOSSA_RX sets the curvature and FOSSA_CUT sets the depth, and
  // they are independent, which is what stops it reading as a dent.
  const FOSSA_RX = 0.62 * M.skull.width;
  const FOSSA_CUT = 0.030 * HS;
  const fossa = (side) => blob(
    [side * (0.845 * HW + FOSSA_RX - FOSSA_CUT), ORBIT_V - 0.075 * HS, -0.038 * M.skull.depth],
    [FOSSA_RX, 0.420 * HS, 0.500 * M.skull.depth], 2);
  const fossaL = fossa(-1), fossaR = fossa(1);

  // The temporal line: the soft ridge that sweeps up and back from the outer
  // corner of the brow, over the temple, and turns down toward the ear. It is
  // the most recognisable line on the reference photo's head and the previous
  // build had nothing at all in its place, which is a large part of why the
  // vault read as a balloon: with no line on it, a dome is just a dome. Below
  // the line the vaultPlan exponent has already flattened the side of the head,
  // so all this has to do is mark where the flat starts.
  //
  // It stands only 0.012 of the head's height proud. The zygomatic arch's
  // history is the warning here: a ridge on the side of a skull turns into a
  // moulding seam the moment it is tall enough to catch a specular.
  //
  // It has a second job now that it did not have before: it is the UPPER BOUND
  // of the temporal fossa. The dish is subtracted just below it, so the line is
  // where the flat starts, and a ridge with a hollow under it reads as an edge
  // of something rather than as a scratch on a dome. Its crest also rides on the
  // parietal eminence, which is why the vault's own peak width is held at
  // WIDTH_PEAK rather than 1.
  const TEMP_R = 0.034 * HS;
  // [bearing, height BELOW THE CROWN as a fraction of the skull's height, how
  // deep to bury this point]. It starts at the outer corner of the brow and
  // climbs, which is the whole character of the line; run at the orbit's own
  // height all the way round -- as it was on the first attempt -- it crosses the
  // middle of the side of the head and reads as a dent, not a line. The far end
  // turns DOWN toward the root of the arch above the ear, which is the real
  // course of the supramastoid crest and also stops the line running off the
  // back of the head into nothing.
  //
  // The third number is the fix for a capsule chain's ends. tube() sweeps ONE
  // radius, so a run that stops out in the open stops with a hemisphere on it,
  // and that hemisphere came out as a pimple on the back of the head. Sinking
  // the last point or two deeper than the ridge itself buries the cap instead.
  const TEMPORAL = [
    [0.95, 0.372, 0.058], [1.24, 0.320, 0.028], [1.54, 0.300, 0.024],
    [1.84, 0.312, 0.027], [2.08, 0.360, 0.050], [2.26, 0.424, 0.088],
  ];
  const temporals = [-1, 1].map((side) => tube(
    TEMPORAL.map(([a, h, inset]) => {
      const ang = side * a;
      const y = Y_CROWN - h * HS;
      const rho = surfaceRho(base, ang, y) - inset * HS;
      return new THREE.Vector3(Math.sin(ang) * rho, y, Math.cos(ang) * rho);
    }),
    TEMP_R,
  ));

  // The alveolar ridge: bone directly above every upper tooth, all the way to
  // the back of the row. Without it the maxilla's corners lift away from the
  // outer teeth and they hang in air, which is what went wrong two builds back.
  const alveolarR = 0.036 * HS;
  const alveolar = tube(
    archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H + 0.020 * HS, { inset: alveolarR * 0.85 })
      .getSpacedPoints(20),
    alveolarR,
  );

  // The occipital condyles themselves, two small bumps flanking the foramen
  // magnum. They are the reason the group's origin is where it is, so they may
  // as well be visible from underneath.
  const condyle = (side) => blob(
    [side * 0.068 * M.skull.width, 0.012 * HS, FORAMEN_Z],
    [0.048 * M.skull.width, 0.048 * HS, 0.055 * M.skull.depth], 2);
  const condyleL = condyle(-1);
  const condyleR = condyle(1);

  // Mastoid processes. Two jobs: they are real bone, and they are what the top
  // of each ramus tucks behind. Kept small: at 0.15 of the skull's height they
  // stopped being processes and turned the back of the head into a lamp
  // standing on two legs. They hang from just behind the ear canal, so they
  // followed the hinge up this pass -- left where they were they would have been
  // a pair of lumps on the underside of the skull with nothing above them.
  // Moved forward and down against the reference's frame: it was reaching to
  // -0.14 of L behind the ear canal, further back than basion, which put a lump
  // under the occiput exactly where the outline is supposed to be closing in.
  // A mastoid hangs BELOW porion and only a little behind it.
  const mastoid = (side) => blob(
    [side * 0.300 * M.skull.width, HINGE_Y - 0.150 * HS, PORION_Z - 0.040 * M.skull.depth],
    [0.060 * M.skull.width, 0.100 * HS, 0.062 * M.skull.depth], 2.3);
  const mastoidL = mastoid(-1);
  const mastoidR = mastoid(1);

  // The foramen magnum, subtracted rather than dented. It used to be a dimple
  // pressed into the finished mesh and painted black; a smooth subtraction from
  // the field is a real pit, so its normals are the pit's own and there is no
  // post-pass moving vertices around behind the shading's back. It is also the
  // last thing on this head that was ever pressed in, so with it gone the
  // vertex pass is pure paint.
  const foramen = blob([0, -0.005, FORAMEN_Z],
    [0.085 * M.skull.width, 0.096 * HS, 0.120 * M.skull.depth], 2.4);

  // Order matters here in one place: the fossa is subtracted AFTER the malar and
  // the arch's root are added, so the dish is cut between the two abutments and
  // they stand out of it. Subtract first and the abutments simply fill it in.
  const field = (x, y, z) => {
    let d = base(x, y, z);
    d = smin(d, brows[0](x, y, z), 0.020);
    d = smin(d, brows[1](x, y, z), 0.020);
    d = smin(d, parietal(-1)(x, y, z), 0.058);
    d = smin(d, parietal(1)(x, y, z), 0.058);
    d = smin(d, nasalBone(x, y, z), 0.019);
    d = smin(d, malarL(x, y, z), 0.028);
    d = smin(d, malarR(x, y, z), 0.028);
    d = smin(d, rimL(x, y, z), 0.026);
    d = smin(d, rimR(x, y, z), 0.026);
    d = smin(d, rootL(x, y, z), 0.026);
    d = smin(d, rootR(x, y, z), 0.026);
    d = smin(d, temporals[0](x, y, z), 0.022);
    d = smin(d, temporals[1](x, y, z), 0.022);
    d = smin(d, alveolar(x, y, z), 0.024);
    d = smin(d, condyleL(x, y, z), 0.016);
    d = smin(d, condyleR(x, y, z), 0.016);
    d = smin(d, mastoidL(x, y, z), 0.030);
    d = smin(d, mastoidR(x, y, z), 0.030);
    d = smax(d, -fossaL(x, y, z), 0.030);
    d = smax(d, -fossaR(x, y, z), 0.030);
    d = smax(d, -foramen(x, y, z), 0.022);
    return d;
  };

  // ---------------------------------------------------------- the cranium mesh
  // Columns are NOT duplicated at theta = 0. A duplicated seam column gets its
  // own averaged normals and draws a bright crease straight down the middle of
  // the face, which is the last place a skull can afford one.
  const count = NTH * (NPH + 1);
  const position = new Float64Array(count * 3);
  const color = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  // A vertex's ray, kept alongside its position: a rim vertex has to be MOVED
  // in face space and then re-solved, and (theta, phi) is what it moves in.
  const vTh = new Float64Array(count);
  const vPhi = new Float64Array(count);
  const vT = new Float64Array(count);
  // Nothing on this head is further than this from P0, so the walk below can
  // stop here and be certain it has left the solid.
  const T_MAX = M.skull.depth * 1.6;

  // A ray out of P0 is walked until the field changes sign and the crossing is
  // then bisected.
  //
  // The walk matters, and so does which crossing it stops at. Bisecting the
  // whole bracket blind assumes the field crosses zero once along the ray, and
  // a smooth union does not have to: the fillet where two parts meet is
  // concave, a grazing ray can cut it three times, and blind bisection then
  // lands on whichever crossing the halving happens to trap -- a different one
  // for neighbouring rays, which tears.
  //
  // Each ray starts from where the ray below it landed, so it tracks the same
  // sheet as its neighbour and usually finds the bracket in two or three steps.
  // Then it LOOKS PAST the crossing it found, and if there is more solid within
  // a few steps it walks on and takes the outer one. Without that, a single ray
  // in the crease between the nasal bone and the medial wall of an orbit stops
  // on the inner sheet while all its neighbours stop on the outer, and the
  // funnel that leaves shows as one black pixel on the bridge of the nose. It
  // was three pixels here and they survived every guess about the cut, the
  // wall and the rim snap before the surface itself turned out to be the
  // culprit.
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

  // Seed the bottom pole with a plain bisection; nothing sits below it for the
  // walk to have tracked from.
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

  // The surface point at a given face-space (u, v), which is what the cavity
  // rings behind each opening are laid out on and what a snapped rim vertex is
  // re-solved to. u fixes the bearing outright; v is reached by Newton on phi,
  // where dy/dphi is cos(phi) * t to within the ray's own stretch. Three passes
  // is far more than the half-cell moves this is ever asked for need.
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
  // Step one of four: which quads fall inside an outline.
  const CUTS = [
    outlineFrom(
      (kx, ky) => socketShape(kx, ky), 96,
      (kx, ky) => socketToFace(-1, kx * SOCKET.a, ky * SOCKET.b),
    ),
    outlineFrom(
      (kx, ky) => socketShape(kx, ky), 96,
      (kx, ky) => socketToFace(1, kx * SOCKET.a, ky * SOCKET.b),
    ),
    outlineFrom(
      (a, b) => nasalShape(a, b), 96,
      (a, b) => [a * NASAL_W / 2, NASAL_V + b * NASAL_H / 2],
    ),
  ];
  const CAVITY_D = [ORBIT_CAVITY, ORBIT_CAVITY, NASAL_CAVITY];
  const cutAt = (X, Y) => {
    for (const cut of CUTS) if (inCut(cut, X, Y)) return cut;
    return null;
  };

  // Face-space u of a column, wrapped to (-pi, pi] first: the sockets sit about
  // 30 degrees off the front and the wrap only matters at the back of the head,
  // but an unwrapped u would put the whole back of the skull inside a bounding
  // box test it has no business being in.
  const uOfColumn = (ixHalf) => {
    let th = (2 * Math.PI * ixHalf) / NTH;
    if (th > Math.PI) th -= 2 * Math.PI;
    return th * FACE_R;
  };

  // A quad is dropped when its CENTRE falls inside a cut. Testing all four
  // corners instead keeps the hole strictly inside the outline, which is safer,
  // but it also blunts every corner by a whole cell -- pumpkin.js found its
  // triangular nose came out a hexagon that way. Centre testing keeps the
  // shape, and the two guards below cover what it costs: the rim snap is
  // clamped so no surviving quad can turn itself inside out, and each cavity
  // carries a skirt wider than a cell so there is always something behind an
  // overshoot.
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

  // Step two: pull the vertices left on the rim onto the true outline, so the
  // edge follows the curve instead of staircasing along grid lines.
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
      // Clamp the pull to half a cell in each direction. A rim vertex is
      // shared with the quads that survive, and one dragged clean across a
      // neighbour turns it inside out: it back-face culls, and what shows
      // through the gap is the dark cavity behind. pumpkin.js clamps at 0.55,
      // which lets two neighbours move 1.1 cells toward each other and so does
      // not quite rule the crossing out; half a cell each does. The cost is
      // that a vertex more than half a cell from the outline lands short of it,
      // which is the last of the staircase left on a rim -- and it is smaller
      // than the pixel the head occupies at prop size.
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
      // A soft ring of occlusion outside each opening, and a little more in the
      // pit of the foramen magnum. That is the whole of the paint on this head
      // now. What used to be here instead: a near-black disc inside each socket
      // at 0.9% albedo, because the socket was a dent, its floor faced up into
      // the key lamp, and a 4% albedo under that lamp still renders as a 20%
      // grey once the tone map and the gamma have had it. That grey filled the
      // bottom half of every eye. Real holes have real walls, so nothing has to
      // be painted out any more; the note stays because the same arithmetic
      // still governs how dark the cavity colours below have to be.
      const u = Math.atan2(position[j], position[j + 2]) * FACE_R;
      const v = position[j + 1];
      let lum = 1;
      for (const cut of CUTS) {
        if (u < cut.minX - AO_REACH || u > cut.maxX + AO_REACH) continue;
        if (v < cut.minY - AO_REACH || v > cut.maxY + AO_REACH) continue;
        lum *= 1 - 0.14 * (1 - smoothstep(0, AO_REACH, snapTo(cut, u, v).d));
      }
      const fz = (position[j + 2] - FORAMEN_Z) / (0.20 * M.skull.depth);
      const fx = position[j] / (0.16 * M.skull.width);
      if (n.y < -0.2) lum *= 1 - 0.55 * (1 - smoothstep(0.35, 1.05, fx * fx + fz * fz));
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

  // ------------------------------------------------------- the zygomatic arch
  // A slender bar bridging from the zygomatic bone to the root above the ear,
  // its two ends buried deep inside the abutment blobs that are in the field and
  // its middle standing clear of the temporal fossa. Both ends being inside the
  // solid is what makes the join invisible: the bar emerges from bone at each
  // end the way a real arch does, and there is no seam to fillet because there
  // is no meeting of surfaces out in the open.
  //
  // The path is authored in world coordinates rather than snapped to the vault
  // with surfaceRho, which is how the old arch was placed. That was the bug in
  // miniature: a path that follows the surface cannot stand off it. The standoff
  // is the whole point, so it is a number here, checked below and reported.
  // Thicker than it was, and barely waisted. At 0.032 with a 0.86 waist the
  // span read as a wire strung between two lumps rather than as a bone: in a
  // three-quarter view the whole cue is the ARCH, and a bar that thin loses its
  // own shading and reads as an edge. 0.039 with the waist nearly out is 0.087
  // of L across and 0.148 deep, which is heavier than a real arch and lighter
  // than it looks, because the head it bridges is a stylised one and much
  // rounder than a real skull's temple. The daylight behind it is measured
  // below and is what stops this from being a moulding.
  const ARCH_R = 0.039 * HS;
  const ARCH_FLAT = 1.70;               // taller than it is thick, as a real arch is
  const archPath = (side) => new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.300 * M.skull.width, ORBIT_V - 0.180 * HS, 0.272 * M.skull.depth),
    new THREE.Vector3(side * 0.402 * M.skull.width, ORBIT_V - 0.148 * HS, 0.175 * M.skull.depth),
    new THREE.Vector3(side * 0.452 * M.skull.width, ORBIT_V - 0.132 * HS, 0.040 * M.skull.depth),
    new THREE.Vector3(side * 0.418 * M.skull.width, ORBIT_V - 0.118 * HS, -0.085 * M.skull.depth),
    new THREE.Vector3(side * 0.352 * M.skull.width, ORBIT_V - 0.098 * HS, -0.180 * M.skull.depth),
  ], false, 'centripetal', 0.5);
  // How much daylight there is behind the middle of the arch: the bar's inner
  // face against the dished vault at the same height and bearing. Measured, not
  // assumed -- the whole reason the arch is built this way is this number being
  // greater than zero.
  let archGap = Infinity;
  for (const side of [-1, 1]) {
    const path = archPath(side);
    const geo = track(shaft(path, ARCH_R, { waist: 0.95, endBias: 0.9, segments: 40 }));
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

  // Step three: the wall inside each cut. One ribbon quad per grid edge that
  // has a dropped quad on one side and a kept one on the other. The rim
  // vertices are already snapped onto the outline, so the ribbon follows the
  // true curve; extruding each of them back along its own surface normal by
  // WALL_T lands on the same plane the cavity's mouth is built at, so wall and
  // cavity meet to within the half cell the rim snap is allowed to fall short
  // by -- and the cavity's skirt is wider than that, so the joint is shut.
  //
  // The wall is its own geometry so its normals never average into the skin's:
  // that is what keeps the lip a crisp edge instead of a smeared crease, and it
  // is the difference between a hole and a bruise.
  // How far each orbit's own axis points away from the midline, filled in when
  // the bowls are built. A real orbit diverges about 23 degrees, and since the
  // bowl's axis is the mean of the skin's normals round the opening it is a
  // measurement of how the face is shaped rather than a number that can be set:
  // flatten the frontal plane and the orbits look more forward, round it off
  // and they splay. That is why it is reported.
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
    // the surface's tangent plane. This is the wall's normal, and it comes off
    // the OUTLINE rather than off the quad, so neighbouring wall quads sharing
    // a rim vertex agree and the ribbon shades smoothly round a curve.
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

    // Three rings, not two. The outer one laps back over the skin carrying the
    // SKIN's normal, so it shades as skin and simply is not visible; that is
    // the ring that shuts the crack where the grid's hole and the true outline
    // disagree by a fraction of a cell. The middle one sits on the hole edge
    // and carries the wall's normal, and the jump between the two is the lip.
    // Give the lapped ring the wall's normal instead and it lights side-on
    // against the skin, drawing a bright wire round every opening.
    const RING_LUM = [1.0, 0.24, 0.030];
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
        // The grid edge shared with the quad to the left, and the one shared
        // with the quad below.
        if (!!here !== !!quadOf(iy, ix - 1)) pushWall(vidx(iy, ix), vidx(iy + 1, ix));
        if (!!here !== !!quadOf(iy - 1, ix)) pushWall(vidx(iy, ix), vidx(iy, ix + 1));
      }
    }

    // Step four: close what is behind, so the head is not a lamp with the light
    // off. A real orbit is a deep bowl, so that is what goes in: the outline
    // sunk one wall thickness is the bowl's mouth, and from there a quarter
    // ellipse runs in and back to a pole. Because it is a separate mesh from
    // the skin it cannot fold into it, which is the whole class of bug the old
    // pressed-in dent had: pressed along the surface normal, a wall steeper
    // than about 45 degrees folded the mesh over itself and dragged unpainted
    // skin in front of the socket floor as a bright crescent that read as an
    // eyeball. Nothing here can do that, which is why real holes are a
    // simplification and not just a feature.
    //
    // The bowl's normals point at its own mouth's centre, which is what the
    // inside of a hemisphere's normals do. So the sides face across the opening
    // and go dark, the back faces out and catches a little light, and the
    // socket reads as a cavity with a floor rather than as a black sticker. The
    // colours have to stay very low all the same: this scene has no global
    // illumination, so the hemisphere light reaches the back of the bowl as if
    // nothing were in the way.
    const CAV_RINGS = 7;
    // The mouth ring is carried this far out past the outline, under the skin,
    // before it turns and goes back. It is never meant to be seen: it is there
    // so that where the grid's hole overshoots the outline by a fraction of a
    // cell there is still cavity behind it and not daylight.
    const CAV_SKIRT = 1.3 * CELL_U;
    const CAV_LUM = [0.022, 0.022, 0.018, 0.016, 0.019, 0.024, 0.030, 0.038];
    for (let ci = 0; ci < CUTS.length; ci++) {
      const cut = CUTS[ci];
      const depth = CAVITY_D[ci];
      const n = cut.pts.length;
      let uc = 0, vc = 0;
      for (const q of cut.pts) { uc += q[0]; vc += q[1]; }
      uc /= n; vc /= n;

      // Seed for the Newton walk that puts a face-space point on the surface:
      // each outline point starts from the one before it, which is never more
      // than a cell away, and the first starts from the outline's own centre.
      let sPhi = 0, sT = M.skull.depth * 0.5;
      {
        const s = faceSample(uc, vc, 0, sT);
        sPhi = s.phi; sT = s.t;
      }

      const base0 = holeVerts.length / 3;
      const nrm = new THREE.Vector3();
      const pt = new THREE.Vector3();
      const out = new THREE.Vector3();

      // Ring 1, the mouth: the outline itself, sunk a wall thickness along the
      // skin's own normal, which is exactly where the wall's bottom edge lands.
      // Its skirt, ring 0, runs out from it ALONG THE TANGENT PLANE rather than
      // along the skin -- following the skin is wrong wherever the skin is
      // concave, and a flange in the tangent plane cannot fold from either sign
      // of curvature.
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
        // Outward is the reverse of the counter-clockwise inward normal.
        out.set(ey * inv * Math.cos(sm.th), -ex * inv, ey * inv * -Math.sin(sm.th));
        out.addScaledVector(nrm, -out.dot(nrm));
        const ol = out.length();
        if (ol > 1e-9) out.divideScalar(ol); else out.set(0, 0, 0);
        skirt.push(pt.clone().addScaledVector(out, CAV_SKIRT).addScaledVector(nrm, -1.9 * WALL_T));
        mouthRing.push(pt.clone().addScaledVector(nrm, -WALL_T));
      }

      // Everything deeper than the mouth is a hemi-ellipsoid in the MOUTH's own
      // frame: the rim vector shrunk by a cosine, the depth grown by a sine,
      // both about the single axis `axis`. Sinking each ring along ITS OWN
      // point's surface normal instead is the obvious thing and it is what this
      // did first: it self-intersects. One step in, the bowl has sunk 22% of its
      // depth while shrinking only 2.5% of its width, and in the tight concave
      // valley between the nasal aperture and the medial wall of an orbit the
      // normals over that step converge inside the radius of the sink -- the
      // ring folds through itself and a couple of its vertices surface on the
      // bridge of the nose as black specks. One axis for the whole bowl has no
      // such failure mode, and it is also what makes the normals below honest.
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
      // The pole. Its normal is straight out of the hole.
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
      // someone looking into the hole -- outer ring forward, inner ring back.
      // The other winding builds the identical bowl and back-face culls it, and
      // what that looks like is daylight straight through the head.
      for (let r = 0; r < CAV_RINGS; r++) {
        for (let i = 0; i < n; i++) {
          const a = base0 + r * n + i, b = base0 + r * n + ((i + 1) % n);
          const c = a + n, d = b + n;
          holeIdx.push(a, b, d, a, d, c);
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
  // It faces into a hole; a caster here is only shadow acne on its own wall.
  holes.castShadow = false;
  holes.receiveShadow = true;
  group.add(holes);

  // ------------------------------------------------------------ mouth cavity
  // So the gap between the tooth rows is a dark slot rather than a bright one.
  // It belongs to the cranium, not the jaw, so that opening the mouth reveals
  // it instead of revealing the inside of the head.
  const cavityMat = new THREE.MeshStandardMaterial({ color: 0x241b14, roughness: 0.95, metalness: 0 });
  materials.push(cavityMat);
  // Sized to sit just inside both tooth arches and just under the palate: any
  // bigger and it pushes a black bubble out through the cheek or the roof of
  // the mouth, any smaller and the ajar gap between the rows lights up.
  //
  // It came down hard this pass. It was reaching 0.187 of the skull's depth
  // back from its own centre and 0.101 of the head's height down, which put its
  // rear half BEHIND the last molar and its floor BELOW the mandible's lower
  // border, so in profile the mouth was a black lens hanging out of the back of
  // the jaw. It is now inside the lower tooth row's own parabola on every axis
  // and shorter than the body of the mandible is deep, and the check is that
  // nothing of it is visible in a lateral view with the jaw shut.
  const cavityGeo = track(new THREE.SphereGeometry(1, 20, 14));
  cavityGeo.scale(0.150 * M.skull.width, 0.055 * HS, 0.150 * M.skull.depth);
  cavityGeo.translate(0, Y_BITE - 0.030 * HS, 0.190 * M.skull.depth);
  const cavity = new THREE.Mesh(cavityGeo, cavityMat);
  cavity.name = 'mouth-cavity';
  group.add(cavity);

  // ------------------------------------------------------------- upper teeth
  const upperRow = archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H / 2);
  const upperLen = upperRow.getLength();
  const upperTooth = track(toothGeometry(
    (upperLen / M.skull.teeth.upper) * 0.82, TOOTH_H, TOOTH_D,
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

  // ----------------------------------------------------------------- the jaw
  // The hinge node itself sits on the axis through both condyles, so the
  // condyle balls do not move when it turns and the joint cannot tear open.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, HINGE_Y, HINGE_Z);
  group.add(jaw);
  const jawRoot = new THREE.Object3D();
  jawRoot.position.set(0, -HINGE_Y, -HINGE_Z);
  jaw.add(jawRoot);

  // The body. A single swept bar from one angle of the jaw, round the chin, to
  // the other, carrying the authored section from the mandible block above.
  //
  // Its path is the lower tooth row's own parabola pushed out by the section's
  // own half thickness, so the bar's OUTER wall stands lateral to the crowns
  // the way a real one does, and carried past the last molar by JAW_EXTEND
  // with JAW_FLARE swinging the last of it outward to the gonion. Giving the
  // body a shallower curve of its own was tried two passes ago: it left the
  // back of the row standing over nothing and needed a separate gum bar to
  // patch, and the bar read as a brace clipped over the front teeth.
  //
  // The vertical is NOT in this path in the old sense. The curve carries the
  // section's centre height, which is the mean of the two authored borders, so
  // the lower border climbs to the gonion while the alveolar margin stays level
  // under the teeth. A single `rise` on the whole curve cannot do that: it
  // moves both borders together and lifts the tooth row with them.
  const BODY_HALF_W = LOWER_ARCH.halfW * 1.06;
  // The last few per cent of the sweep closes the bar off as a dome, so the
  // tube has no open end. bone.js's tubes have no caps and the previous build
  // patched that with a ball at the angle; a ball big enough to shut the hole
  // is a bead on the end of a stick, which is exactly what the jaw was reading
  // as from behind.
  const CAP_U = 0.045;
  const bodyS = (u) => Math.min(1, Math.abs(u) / JAW_EXTEND);
  const bodyCentre = (u, out) => {
    const uc = Math.max(-JAW_EXTEND, Math.min(JAW_EXTEND, u));
    const s = bodyS(uc);
    const flare = 1 + JAW_FLARE * Math.max(0, Math.abs(uc) - 1);
    const hh = jawHH(s);
    return out.set(
      (BODY_HALF_W - hh) * uc * flare,
      jawCY(s),
      (LOWER_ARCH.front - hh) - (LOWER_ARCH.front - LOWER_ARCH.back) * uc * uc,
    );
  };
  const bodySection = (u) => {
    const s = bodyS(u);
    const over = Math.max(0, Math.abs(u) - JAW_EXTEND) / CAP_U;
    const cap = over > 0 ? Math.sqrt(Math.max(0, 1 - over * over)) : 1;
    return { hv: jawHV(s) * cap, hh: jawHH(s) * cap, p: jawSecP(s) };
  };
  jawRoot.add(add(
    track(sweepBar(bodyCentre, bodySection,
      -JAW_EXTEND - CAP_U, JAW_EXTEND + CAP_U, 96, 26)),
    material, 'jaw-body',
  ));

  // Rami and condyles. The gonion is wherever the body's sweep ends, so the
  // ramus always lands on the bone rather than near it.
  const gonion = bodyCentre(JAW_EXTEND, new THREE.Vector3());
  const gonionX = Math.abs(gonion.x);
  const gonionY = GONION_Y;
  for (const side of [-1, 1]) {
    // The ramus. It used to be a swept round tube squeezed to half its width,
    // which in profile is a rod: no top edge, so no mandibular notch, so no
    // angle to the jaw at all and the whole mandible read as one sausage. It is
    // an extruded PLATE now, authored as an outline in the profile plane, which
    // is the plane the shape actually lives in -- posterior border, condylar
    // neck, the notch, the coronoid process, anterior border, and the lower
    // edge running inside the body's bar. plate()'s bevel does the house
    // rounding, and the notch is cut deeper than the bevel is wide so that it
    // survives being rounded off.
    //
    // A flat plate cannot have its two ends at different x, and they have to be:
    // the gonion is wide and the condyle is narrow. So it is built at x = 0 and
    // SHEARED, each vertex moved out by the lean its own height calls for.
    // The old pre-stretch-and-squeeze trick did the same job for a swept tube
    // and does not generalise to an extrusion.
    // The outline is run through a CLOSED Catmull-Rom before it is extruded.
    // plate() takes a THREE.Shape, and a Shape built straight from these points
    // is a polygon: the first attempt at this read as a flat card with corners
    // stuck on the side of the jaw, because plate()'s bevel rounds the EDGE of
    // an extrusion and does nothing at all to the corners of its outline.
    // Resampling the loop as a spline is what makes it a bone.
    //
    // WIDENED, and this is the change that matters. The outline used to span
    // 0.07 to 0.09 of L between its two borders, against a height of 0.34: a
    // plate three and a half times as tall as it is wide is a lath, and from
    // behind the pair of them read as two sticks with the head balanced on
    // them. A real ramus is about 0.17 of L across. This one is 0.13 to 0.15,
    // which is what the table's own gonion at +0.07 and coronoid at +0.13 leave
    // room for, and it is a plate rather than a stick at that width.
    // It is also thicker: 0.046 of the head's height where it was 0.038.
    const RAMUS_T = 0.046 * HS;
    // Authored in the reference's own porion frame, like the vault's profile,
    // so the three landmarks it has to hit -- condylion (-0.03, +0.015),
    // the coronoid tip (+0.13, -0.015) and the gonion (+0.07, -0.30) -- are
    // literally in the list rather than being aimed at with offsets. The two
    // two lowest corners are the FOOT, and where they sit is not free: the body
    // is at its full section only between about +0.07 and +0.20 of L (behind
    // that its end is closing into the cap) and only below about -0.22 of L.
    // The first cut of this outline put the posterior corner at +0.036, out
    // past where the body had already begun to close, and the plate hung below
    // and lateral to the bone as a paddle -- which is what the rear view
    // showed. Both corners are inside the bar's own hull now, and the rounded
    // end of the bar behind the foot IS the angle of the jaw.
    const ramusOutline = new THREE.CatmullRomCurve3([
      [+0.072, -0.272],   // lower posterior corner, buried in the body's bar
      [+0.038, -0.215],   // posterior border of the ramus
      [+0.005, -0.110],
      [-0.022, -0.025],   // condylar neck
      [-0.030, +0.015],   // CONDYLION
      [+0.012, -0.028],   // down into the mandibular notch
      [+0.060, -0.070],   // the notch's floor
      [+0.108, -0.048],
      [+0.132, -0.015],   // CORONOID TIP
      [+0.152, -0.105],   // anterior border
      [+0.172, -0.215],
      [+0.170, -0.298],   // lower anterior, buried in the body
    ].map(([x, y]) => new THREE.Vector3(LZ(x), LY(y), 0)), true, 'centripetal', 0.5)
      .getPoints(84)
      .map((q) => new THREE.Vector2(q.x, q.y));
    // The plate rides a little OUTBOARD of the body's centreline at its foot.
    // The body is thicker than the ramus is, so a plate sheared to the body's
    // own axis leaves the bar's rounded end standing proud of it, and that read
    // as a separate pebble stuck on the outside of the angle. Leaning the foot
    // out by rather less than the difference puts the ramus's outer face just
    // lateral to the bar's, which is where a real one is: the two surfaces are
    // continuous across the angle.
    const RAMUS_LEAN = 0.036 * HS;
    const ramus = track(plate(ramusOutline, RAMUS_T, { bevel: 0.42, bevelSegments: 4 }));
    ramus.rotateY(-Math.PI / 2);
    {
      const pos = ramus.attributes.position;
      const span = HINGE_Y - gonionY;
      for (let i = 0; i < pos.count; i++) {
        const t = Math.max(0, Math.min(1, (pos.getY(i) - gonionY) / span));
        const base = gonionX + RAMUS_LEAN;
        pos.setX(i, pos.getX(i) + side * (base + (HINGE_X - base) * t));
      }
      pos.needsUpdate = true;
      ramus.computeVertexNormals();
    }
    jawRoot.add(add(ramus, material, 'jaw-ramus'));
    const ball = track(jointBall(RAMUS_R * 0.66));
    ball.scale(1.25, 1, 0.85);
    ball.translate(side * HINGE_X, HINGE_Y, HINGE_Z);
    jawRoot.add(add(ball, material, 'jaw-condyle'));
  }

  // ------------------------------------------------------------- lower teeth
  const lowerRow = archCurve(LOWER_ARCH, Y_BITE - TOOTH_H / 2);
  const lowerTooth = track(toothGeometry(
    (lowerRow.getLength() / M.skull.teeth.lower) * 0.82, TOOTH_H, TOOTH_D,
  ));
  placeRow(lowerRow, lowerTooth, M.skull.teeth.lower, jawRoot, 'tooth-lower');

  // Symmetric, so this asserts nothing about the skull's own geometry; it is
  // published because metrics.js asks every part to, and the assembler checks.
  group.userData.outwardX = LEFT_X;

  // The landmarks a skull is judged on, published so they can be checked
  // against the reference rather than eyeballed. Two rejected builds passed
  // three-quarter renders while being wrong in plan, so the acceptance test for
  // this part is a table of numbers and a straight-on profile, not a look.
  // Everything here is a world-space height or length; the checker turns them
  // into fractions of crown-to-chin itself.
  group.userData.landmarks = {
    orbitV: ORBIT_V,
    browY: ORBIT_V + SOCKET.b + BROW_LIFT,
    hingeY: HINGE_Y,
    hingeZ: HINGE_Z,
    hingeX: HINGE_X,
    gonionY,
    gonionZ: gonion.z,
    gonionX,
    nasalFloor: NASAL_V - NASAL_H / 2,
    nasalH: NASAL_H,
    nasalW: NASAL_W,
    orbitDiverge: orbitDiverge * (180 / Math.PI),
    zygGap: archGap,
    vaultBase: VAULT_BASE,
    // The reference's own frame, so the checker can measure in it.
    porionY: PORION_Y, porionZ: PORION_Z, L: L_SKULL, syUp: SY_UP, syDn: SY_DN,
    basionY: LY(-0.13),
    zFace: Z_FACE, zBack: Z_BACK,
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
