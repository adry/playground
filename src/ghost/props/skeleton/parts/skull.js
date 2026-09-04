import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { shaft, straightShaft, jointBall } from './bone.js';

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
//    lobed shell. The mandible and the teeth, which ARE long-bone-shaped, do
//    come from the vocabulary.
//
// 2. The orbits and the nasal aperture are REAL HOLES, cut out of that grid,
//    with a wall of bone in the cut and a dark rounded cavity behind. See "the
//    openings" below for how, and for the two builds' worth of history that
//    says why nothing less will do.
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
// Bottom sits a hair below the condyle plane so the skull base is a shallow
// dome where the atlas meets it rather than tapering to a point at y = 0.
const VAULT_BASE = -0.012 * HS;
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
// The brow's own dimensions have to be declared up here, because the vault's
// frontal plane is derived FROM them. The glabella is a midline swelling on the
// brow and it is the front reference for the skull's length, so the glabella is
// what lands on Z_FACE, and the plane the brow rides on is Z_FACE less however
// proud the brow stands off it.
const BROW_R = 0.046 * HS;
const BROW_INSET = 0.018 * HS;
const BROW_PROUD = BROW_R - BROW_INSET;
const Z_VAULT_FRONT = Z_FACE - BROW_PROUD;

// --- the vault's profile ---------------------------------------------------
// This is the part of the head that was most wrong, and it was wrong in a way
// that only measuring catches. The vault used to be one plain superellipsoid
// with semi-axes 0.176 x 0.171 x 0.169: a ball, to within 4%. A ball has no
// forehead, no temple, no occiput and no widest point -- and because the game
// camera looks DOWN at the figure, the crown of that ball is the largest single
// area in the head crop. It read as a balloon with a face printed low on it.
//
// A real braincase, measured, is nothing like a ball:
//   * it is LONGER than it is wide (length : breadth : height about 1 : 0.78 :
//     0.73), so the depth has to carry the mass, not the width;
//   * it has a widest point at all, and it is not the ellipsoid's equator: a
//     dry skull is broadest high, at the parietal eminences, and the reference
//     photo's toy head is broadest a little over half way down. Either way the
//     vault tapers into the crown, and an ellipsoid does not;
//   * the forehead is a near-vertical plane at the brow that RECEDES going up,
//     so the crown sits well behind the glabella;
//   * the occiput projects backwards furthest at about ear level and tucks in
//     both above and below it;
//   * there is a flat, slightly hollow temple above and behind the eye, which
//     is what lets the zygomatic arch read as an arch rather than a seam.
//
// All five are profiles along the vault's own height, so rather than blending
// more blobs in (an occipital blob was tried in the previous build and drew a
// hard contour line right round the back of the head at every blend width from
// 0.02 to 0.10), the vault is ONE superellipsoid whose cross-section is scaled,
// shifted and squared off as a function of height. There is no join anywhere in
// it, so there is nothing to crease -- which is the whole reason it is done this
// way and not with more blobs.
//
// WHAT THIS PASS CHANGED, and why it could not have been done before. All of
// the above was already true of the previous build and the head still read as a
// ball, because M.skull.width was 0.141 and M.skull.depth 0.150: an index of
// 0.94, a braincase wider than it was long. Every profile below could only fix
// the SIDE view, and the plan view stayed square whatever they did. metrics.js
// now says 0.125 by 0.160, an index of 0.781, and with a plan that is finally
// longer than it is wide four things become expressible that were not:
//
//   * the widest point can be put high AND behind, because there is now a
//     front-to-back axis to put it behind the middle OF. `planTaper` narrows
//     the section toward the face, which is the plan view of a real skull and
//     was simply not available on a square one;
//   * the forehead can slope back over a real distance instead of a token one;
//   * the occiput can project without the head going spherical, because the
//     projection is now a small part of a long axis rather than a large part of
//     a short one;
//   * the temporal flat has somewhere to be. On the old plan the side of the
//     head was the widest thing about it from the eye backwards, so a flat
//     there ate the silhouette; on this one the side aft of the eye is already
//     inboard of the parietal eminence and the flat costs nothing.
//
// `vaultV` is 0 at the base of the braincase and 1 at the crown.
const VAULT_SPAN = Y_CROWN - VAULT_BASE;
const vaultV = (y) => (y - VAULT_BASE) / VAULT_SPAN;

const VY_C = (Y_CROWN + VAULT_BASE) / 2;
const VY_A = (Y_CROWN - VAULT_BASE) / 2;
const VZ_C = (Z_VAULT_FRONT + Z_BACK) / 2;
const VZ_A = (Z_VAULT_FRONT - Z_BACK) / 2;
// Squarer in section than the old 2.02, which is what flattens the crown. The
// profiles below narrow the top at the same time, so it comes out a broad dome
// rather than the helmet a high exponent alone gives.
const VAULT_PV = 2.35;
const VAULT_UNIT = Math.min(HW, VY_A, VZ_A);
// The vault's own maximum half-width, as a fraction of HW. It is deliberately
// short of 1: the crest of the temporal line rides on top of the parietal
// eminence at very nearly the same height and bearing, and the two together are
// what M.skull.width measures. Give the vault the full width as well and the
// measured breadth comes out over by twice the ridge's proudness, which is
// enough to push the cranial index from 0.78 to 0.82.
const WIDTH_PEAK = 1.017;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Half-width as a fraction of WIDTH_PEAK * HW, against height.
//
// The previous build put the widest point "a little over half way down from the
// crown", measured off the toy in the reference photo, and tapered gently. That
// is not where a skull is widest. The parietal eminences sit about two thirds
// of the way UP the braincase -- v = 0.66, which is 0.28 of the whole head's
// height below the crown -- and the vault falls away from them in every
// direction, into the crown above and into the temporal squama below. The
// plateau here is deliberately short so that "the widest point" is a place on
// the head and not a band.
const vaultWidth = (v) => WIDTH_PEAK * (1
  - 0.30 * smoothstep(0.70, 1.02, v)
  - 0.36 * (1 - smoothstep(0.02, 0.62, v)));
// How square the cross-section is. Flat sides and a flat frontal plane across
// the temples, rounding off toward the crown and the base -- one exponent for
// the whole vault cannot do that: high enough for a face plane the sockets can
// sit on and the crown squares off into a helmet, low enough for a round crown
// and the face comes to a point and the orbits curl onto the temples. Raised
// from 2.82 at the eye line because the sockets are a larger fraction of a
// narrower head now: at the old exponent the outer third of each orbit lay on
// curvature that was already turning into the temple.
const vaultPlan = (v) => 2.30
  + 1.35 * smoothstep(0.08, 0.40, v) * (1 - smoothstep(0.62, 1.02, v));
// How far the vault reaches forward, as a fraction of VZ_A. Full from the top of
// the orbit up to the brow and receding above it: that recession is the
// forehead's backward slope, and it is what puts the crown behind the glabella
// instead of over it. It falls away below the orbit too, where the maxilla
// takes the front over.
const vaultFront = (v) => 1
  - 0.30 * smoothstep(0.60, 1.00, v)
  - 0.30 * (1 - smoothstep(0.10, 0.40, v));
// How far it reaches back. Full between v = 0.50 and 0.68, which is above ear
// level and level with the parietal eminence, and tucking in hard above and
// below: that is what makes the occiput read as a projection rather than as the
// back half of a sphere. The old peak sat at v = 0.30 to 0.46, which is at and
// below the ear, and a bulge down there is not an occiput -- it is the back of
// an egg, and in profile that is exactly what it looked like. It never exceeds
// 1: M.skull.depth is the budget and the occiput spends all of it, it does not
// get to overspend.
const vaultBack = (v) => 1
  - 0.26 * smoothstep(0.75, 1.05, v)
  - 0.40 * (1 - smoothstep(0.16, 0.58, v));
// The plan view's own taper: how wide the section is at a given point along its
// OWN depth, front to back. This is the piece that only became possible when
// the plan stopped being square. A skull seen from above is a blunt egg, widest
// behind the middle at the parietal eminences and narrowing toward the temples
// and the face; a superellipse with one half-width per height is symmetric front
// to back and can only ever be a lozenge. zn runs -1 at the occiput to +1 at the
// face, and the peak is parked at -0.25 so the widest point of the head is
// behind its own mid-length in plan as well as high up in profile.
const ZN_PEAK = -0.25;
const planTaper = (zn) => {
  const q = Math.max(-1.6, Math.min(1.6, zn)) - ZN_PEAK;
  return 1 - (q > 0 ? 0.115 : 0.107) * q * q;
};

function vaultField(x, y, z) {
  const v = vaultV(y);
  const f = vaultFront(v);
  const b = vaultBack(v);
  const ph = vaultPlan(v);
  const sz = VZ_A * (f + b) * 0.5;
  const cz = VZ_C + VZ_A * (f - b) * 0.5;
  const zn = (z - cz) / sz;
  const ax = Math.abs(x / (HW * vaultWidth(v) * planTaper(zn)));
  const az = Math.abs(zn);
  const ay = Math.abs((y - VY_C) / VY_A);
  const h = Math.pow(Math.pow(ax, ph) + Math.pow(az, ph), VAULT_PV / ph);
  return (Math.pow(h + Math.pow(ay, VAULT_PV), 1 / VAULT_PV) - 1) * VAULT_UNIT;
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
const UPPER_ARCH = { halfW: 0.262 * M.skull.width, front: 0.352 * M.skull.depth, back: 0.176 * M.skull.depth };
const LOWER_ARCH = { halfW: 0.222 * M.skull.width, front: 0.333 * M.skull.depth, back: 0.166 * M.skull.depth };
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
// A thin deep bar: thin side to side, deep top to bottom, and no deeper than
// M.skull.jawHeight allows. A round swept tube cannot be thin one way and deep
// the other, so the body is swept round and then squashed.
const JAW_R = 0.043 * HS;                     // half the bar's side-to-side wall
const RAMUS_R = 0.062 * HS;
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
const JAW_EXTEND = 1.68;
const JAW_FLARE = 0.40;
// The hinge, which is also where this build measures the ear canal: the condyle
// sits in the mandibular fossa immediately in front of the meatus and the two
// are within a couple of millimetres of each other on a real skull.
//
// It has come up by 0.083 of the head's height. Two things put it there. The
// Frankfurt horizontal, the plane a real skull is measured on, runs through the
// ear canal and the orbit's lower rim, so with the eye line at half the height
// the ear canal lands at 0.63 below the crown; and that also puts the base of
// the braincase -- the line from the brow back to the ear -- at two thirds of
// the way down, which is the cranium-to-face split the reference asks for. The
// old 0.096 put it at 0.71, which shortened the ramus to less than half the
// length of a real one and hung the jaw joint below the skull's own base.
const HINGE_Y = 0.163 * HS;
const HINGE_Z = -0.085 * M.skull.depth;
// The condyle rides NARROWER than the gonion, so the ramus leans inward on its
// way up and the joint tucks under the root of the zygomatic arch instead of
// standing off the side of the head as a bare knob. A real bicondylar breadth
// is wider than a bigonial one, but a real skull is also wider at the ear than
// this one gets to be, and of the two errors a condyle outside the silhouette
// is the one that shows.
const HINGE_X = 0.58 * (M.skull.width / 2);
const FORAMEN_Z = -0.150 * M.skull.depth;

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
// else in the face is checked against them. So this is 0.500 now and it is not
// a tuning parameter. It costs 0.038 of the head's height off the forehead and
// hands it to the face, which is the direction both rejected builds needed to
// move in and neither did far enough.
const ORBIT_V = Y_CROWN - 0.500 * HS;

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
// be. The floor clears the tooth crowns by 0.05 of the head's height.
const NASAL_W = 0.46 * M.skull.socket.width;
const NASAL_H = 0.52 * M.skull.socket.height;
const NASAL_V = Y_CROWN - 0.588 * HS;

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
const SOCKET_PX = 2.75;
function socketTaper(kx) {
  return SOCKET_TAPER_LO + (1 - SOCKET_TAPER_LO) * smoothstep(-1, 0.35, kx);
}
function socketShape(kx, ky) {
  const k = ky / socketTaper(kx);
  const e = ky > 0 ? 2.70 : 2.50;
  return Math.pow(Math.abs(kx), SOCKET_PX) + Math.pow(Math.abs(k), e);
}
// The top edge of the socket, in the same frame, at a given kx.
function socketTop(kx) {
  const rem = 1 - Math.pow(Math.abs(kx), SOCKET_PX);
  return rem <= 0 ? 0 : socketTaper(kx) * Math.pow(rem, 1 / 2.70);
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

  // The glabella: the smooth midline swelling between the brows. It is the
  // front reference for the skull's length and the reference asks for it
  // explicitly, and it is also the only way to have one: the two brow shelves
  // stop short of the midline on purpose (carried all the way in they converge
  // into a V that reads as a snout), so without this there is nothing between
  // them but bare frontal plane and the most anterior point on the head ends up
  // being a pair of points either side of the nose.
  //
  // Its front face is on Z_FACE by construction -- that is what Z_VAULT_FRONT
  // was derived backwards from -- so it projects past the frontal plane by
  // exactly BROW_PROUD and past the face plane below it by a little more.
  const GLAB_D = 0.100 * M.skull.depth;
  const glabella = blob(
    [0, ORBIT_V + SOCKET.b + 0.055 * HS, Z_FACE - GLAB_D],
    [0.115 * M.skull.width, 0.062 * HS, GLAB_D], 2.6, 2.2,
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
    [side * 0.300 * M.skull.width, ORBIT_V - 0.115 * HS, 0.270 * M.skull.depth],
    [0.115 * M.skull.width, 0.085 * HS, 0.105 * M.skull.depth], 2.4);
  const zygRoot = (side) => blob(
    [side * 0.340 * M.skull.width, HINGE_Y + 0.030 * HS, -0.150 * M.skull.depth],
    [0.085 * M.skull.width, 0.058 * HS, 0.105 * M.skull.depth], 2.4);
  const malarL = malar(-1), malarR = malar(1);
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
    [0.95, 0.372, 0.058], [1.25, 0.322, 0.030], [1.60, 0.300, 0.024],
    [1.95, 0.310, 0.026], [2.25, 0.362, 0.042], [2.48, 0.436, 0.080],
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
  const mastoid = (side) => blob(
    [side * 0.300 * M.skull.width, HINGE_Y - 0.105 * HS, -0.215 * M.skull.depth],
    [0.060 * M.skull.width, 0.095 * HS, 0.062 * M.skull.depth], 2.3);
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
    d = smin(d, glabella(x, y, z), 0.022);
    d = smin(d, malarL(x, y, z), 0.028);
    d = smin(d, malarR(x, y, z), 0.028);
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
  const ARCH_R = 0.029 * HS;
  const ARCH_FLAT = 1.55;               // taller than it is thick, as a real arch is
  const archPath = (side) => new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.285 * M.skull.width, ORBIT_V - 0.105 * HS, 0.300 * M.skull.depth),
    new THREE.Vector3(side * 0.395 * M.skull.width, ORBIT_V - 0.128 * HS, 0.185 * M.skull.depth),
    new THREE.Vector3(side * 0.428 * M.skull.width, ORBIT_V - 0.130 * HS, 0.045 * M.skull.depth),
    new THREE.Vector3(side * 0.412 * M.skull.width, ORBIT_V - 0.118 * HS, -0.080 * M.skull.depth),
    new THREE.Vector3(side * 0.352 * M.skull.width, ORBIT_V - 0.100 * HS, -0.175 * M.skull.depth),
  ], false, 'centripetal', 0.5);
  // How much daylight there is behind the middle of the arch: the bar's inner
  // face against the dished vault at the same height and bearing. Measured, not
  // assumed -- the whole reason the arch is built this way is this number being
  // greater than zero.
  let archGap = Infinity;
  for (const side of [-1, 1]) {
    const path = archPath(side);
    const geo = track(shaft(path, ARCH_R, { waist: 0.86, endBias: 0.9, segments: 40 }));
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
  const cavityGeo = track(new THREE.SphereGeometry(1, 20, 14));
  cavityGeo.scale(0.187 * M.skull.width, 0.101 * HS, 0.187 * M.skull.depth);
  cavityGeo.translate(0, Y_BITE - 0.059 * HS, 0.155 * M.skull.depth);
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

  // The body: the lower arch pushed out a little and carried back past the
  // last molar to the angle of the jaw. Swept round at y = 0 and then squashed,
  // because the bar has to be thin side to side and deep top to bottom, and a
  // round tube is neither.
  const bodyTop = Y_BITE - TOOTH_H + 0.006 * HS;
  const JAW_SQUASH = ((bodyTop - Y_CHIN) / 2) / JAW_R;
  // Same parabola as the lower tooth row, pushed out by the bar's own half
  // thickness and a little further, so the bar's outer wall stands lateral to
  // the crowns the way a real mandible's does; at 1.01 it was exactly flush and
  // the jaw came to a narrow point under the chin. Giving the body
  // its own shallower curve was tried: it left the back of the row standing
  // over nothing and needed a separate gum bar to patch, and that bar read as
  // a brace clipped over the front teeth.
  const bodyCurve = archCurve(
    { halfW: LOWER_ARCH.halfW * 1.06, front: LOWER_ARCH.front, back: LOWER_ARCH.back },
    0,
    { inset: JAW_R, extend: JAW_EXTEND, rise: JAW_R * 0.28, flare: JAW_FLARE },
  );
  // No waist at all: shaft() thins the middle of a bone, and the middle of this
  // one is the chin. At 0.93 the chin sat 0.6% of the head's height short of
  // M.y.chin, which is small but it is the wrong direction on the one dimension
  // an early build got wrong.
  const bodyGeo = track(shaft(bodyCurve, JAW_R, { waist: 1, endBias: 0.85, segments: 48 }));
  bodyGeo.scale(1, JAW_SQUASH, 1);
  bodyGeo.translate(0, (bodyTop + Y_CHIN) / 2, 0);
  jawRoot.add(add(bodyGeo, material, 'jaw-body'));

  // Rami and condyles. The gonion is wherever the body curve ends, so the
  // ramus always lands on the bone rather than near it.
  const gonion = bodyCurve.getPoint(1);
  const gonionX = Math.abs(gonion.x);
  const gonionY = gonion.y * JAW_SQUASH + (bodyTop + Y_CHIN) / 2;
  for (const side of [-1, 1]) {
    // The angle of the jaw. It caps the swept bar, which like every tube out of
    // bone.js has no end cap of its own: uncapped, the bar's back end showed as
    // a scoop out of the jaw from any three-quarter view. It also thickens the
    // gonion, which is what a real one does anyway.
    const cap = track(jointBall(JAW_R * 0.98, { squash: 1 }));
    cap.scale(1, JAW_SQUASH * 0.80, 1);
    cap.translate(side * gonionX, gonionY, gonion.z);
    jawRoot.add(add(cap, material, 'jaw-gonion'));

    // The ramus is a flat plate, so it is swept round and then squeezed to a
    // little over half its width -- and its two ends no longer share an x, because the
    // condyle leans in. Squeezing about the mid plane would drag both ends with
    // it, so the sweep is built PRE-STRETCHED about that plane by the reciprocal
    // and the squeeze lands the ends exactly back on gonion and hinge.
    const mx = (gonionX + HINGE_X) / 2;
    const SQ = 0.55;
    const preX = (x) => side * (mx + (x - mx) / SQ);
    const a = new THREE.Vector3(preX(gonionX), gonionY - JAW_R * 0.35, gonion.z);
    const b = new THREE.Vector3(preX(HINGE_X), HINGE_Y, HINGE_Z);
    const ramus = track(straightShaft(a, b, RAMUS_R, { waist: 0.80, segments: 20 }));
    ramus.translate(-side * mx, 0, 0);
    ramus.scale(SQ, 1, 1);
    ramus.translate(side * mx, 0, 0);
    jawRoot.add(add(ramus, material, 'jaw-ramus'));
    const ball = track(jointBall(RAMUS_R * 0.66));
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
