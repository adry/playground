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
const Z_BACK = -0.54 * M.skull.depth;
const Z_FACE = Z_BACK + M.skull.depth;        // front of the maxilla
// The vault itself stops short of the face: the last tenth of the depth is the
// brow, the cheek and the maxilla riding on the front of it.
const Z_VAULT_FRONT = Z_BACK + 0.90 * M.skull.depth;

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
//   * its widest point is high, at the parietal eminences, about a quarter of
//     the crown-to-chin height below the crown -- not at eye level, which is
//     where an ellipsoid's equator puts it;
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
// 0.02 to 0.10), the vault is ONE superellipsoid whose cross-section is scaled
// and shifted as a function of height. There is no join, so there is nothing to
// crease.
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
const VAULT_PV = 2.28;
const VAULT_UNIT = Math.min(HW, VY_A, VZ_A);

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Half-width as a fraction of HW. Broadest across the temples and tapering
// steadily into the crown, which is the egg the reference photo's head is; the
// old ellipsoid put its widest point at eye level and had the same width all
// the way up to the parting.
//
// A real dry skull is widest higher, at the parietal eminences. The reference
// is not a dry skull, it is a toy, and measured off the photo its widest point
// is a little over half way down from the crown. That is also the shape that
// survives the game camera, which looks DOWN at the figure and so presents the
// crown broadside: a vault that is still full width up there fills the head
// crop with forehead.
const vaultWidth = (v) => 1
  - 0.150 * smoothstep(0.60, 1.00, v)
  - 0.110 * (1 - smoothstep(0.02, 0.36, v));
// How square the cross-section is. Flat sides and a flat frontal plane across
// the temples, rounding off toward the crown and the base -- one exponent for
// the whole vault cannot do that: high enough for a face plane the sockets can
// sit on and the crown squares off into a helmet, low enough for a round crown
// and the face comes to a point and the orbits curl onto the temples. This is
// also most of the temporal flat: above the arch the side of the head is a
// plane, and the arch standing off it is what makes the arch read.
const vaultPlan = (v) => 2.20
  + 0.62 * smoothstep(0.06, 0.36, v) * (1 - smoothstep(0.50, 1.00, v));
// How far the vault reaches forward, as a fraction of VZ_A. Full at the brow,
// receding above it: this is the forehead's backward slope, and it is what puts
// the crown behind the glabella instead of over it.
const vaultFront = (v) => 1
  - 0.26 * smoothstep(0.50, 1.00, v)
  - 0.24 * (1 - smoothstep(0.02, 0.38, v));
// How far it reaches back. Full at ear level and tucking in hard above and
// below, which is what makes the occiput read as a projection rather than as
// the back half of a sphere. It never exceeds 1: M.skull.depth is the budget
// and the occiput spends all of it, it does not get to overspend.
const vaultBack = (v) => 1
  - 0.24 * smoothstep(0.46, 1.00, v)
  - 0.46 * (1 - smoothstep(0.00, 0.30, v));

function vaultField(x, y, z) {
  const v = vaultV(y);
  const f = vaultFront(v);
  const b = vaultBack(v);
  const ph = vaultPlan(v);
  const sz = VZ_A * (f + b) * 0.5;
  const cz = VZ_C + VZ_A * (f - b) * 0.5;
  const ax = Math.abs(x / (HW * vaultWidth(v)));
  const az = Math.abs((z - cz) / sz);
  const ay = Math.abs((y - VY_C) / VY_A);
  const h = Math.pow(Math.pow(ax, ph) + Math.pow(az, ph), VAULT_PV / ph);
  return (Math.pow(h + Math.pow(ay, VAULT_PV), 1 / VAULT_PV) - 1) * VAULT_UNIT;
}

// --- the face --------------------------------------------------------------
// The maxilla is a rounded box rather than an ellipsoid (exponent well above
// 2), because the tooth row has to have bone directly above it all the way out
// to the back molars. An ellipsoid's underside curves away at the corners and
// leaves the outer teeth hanging in air -- a fault two builds back had.
const MAX_TOP = 0.305 * HS;
const MAX_BOTTOM = 0.091 * HS;                // the palate, just above the crowns
// Wider than it was. The face plane has to carry a cheek out to the root of
// the zygomatic arch, and at 0.298 the maxilla stopped short of it and left the
// arch springing out of nowhere.
const MAX_HALF_W = 0.318 * M.skull.width;
const MAX_BACK = Z_FACE - 0.643 * M.skull.depth;

// --- the tooth rows --------------------------------------------------------
// Not in metrics.js: only the counts are. Sized off the photo, where the
// visible tooth row is a shade under half the skull's width, and written as
// fractions of the measurements that ARE there so a change of scale carries.
const UPPER_ARCH = { halfW: 0.262 * M.skull.width, front: 0.400 * M.skull.depth, back: 0.208 * M.skull.depth };
const LOWER_ARCH = { halfW: 0.222 * M.skull.width, front: 0.379 * M.skull.depth, back: 0.197 * M.skull.depth };
const TOOTH_H = 0.066 * HS;
const TOOTH_D = 0.045 * HS;
// The rows do not meet. In the reference there is a dark line between them and
// it is most of what stops the mouth reading as a painted stripe.
const AJAR = 0.018 * HS;

// --- the mandible ----------------------------------------------------------
// A thin deep bar: thin side to side, deep top to bottom, and no deeper than
// M.skull.jawHeight allows. A round swept tube cannot be thin one way and deep
// the other, so the body is swept round and then squashed.
const JAW_R = 0.043 * HS;                     // half the bar's side-to-side wall
const RAMUS_R = 0.062 * HS;
// How far past the last molar the body runs, and how far it swings OUT on the
// way. The flare is the fix for a jaw with no visible angle: at extend 1.62 and
// no flare the gonion sat at 0.56 of the skull's half-width, tucked inside the
// silhouette, and from the side the mandible read as a hoop hanging under the
// head with no corner to it. A real bigonial breadth is about 0.72 of the
// cranium's; 0.67 is as far as this can go before the condyle, which rides the
// same x, floats clear of the skull at the hinge.
const JAW_EXTEND = 1.55;
const JAW_FLARE = 0.55;
// The hinge. Level with the root of the zygomatic arch and just behind the
// middle of the skull, which is where the fossa is; the condyle balls sit half
// buried in the skull base there so the joint has somewhere to be.
const HINGE_Y = 0.096 * HS;
const HINGE_Z = -0.080 * M.skull.depth;
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
// 0.495 was the previous value and it was still too low: it left 0.07 of the
// head's height between the orbit's floor and the crowns of the upper teeth,
// where a real skull has nearly 0.20, and the face came out crushed against the
// mouth under an enormous forehead. At 0.462 the crown-to-orbit-rim distance is
// 0.33 of crown-to-chin, which is what a real skull measures, and there is half
// as much face again below the eye.
const ORBIT_V = Y_CROWN - 0.462 * HS;

// The nasal aperture is not in metrics.js. Written against the socket so the
// two stay in proportion. Its floor has to clear the crowns of the upper teeth:
// at the previous height and size it hung 0.007 BELOW them, which is why the
// nose and the mouth used to run together into one dark smear on the front of
// the face.
const NASAL_W = 0.60 * M.skull.socket.width;
const NASAL_H = 0.62 * M.skull.socket.height;
const NASAL_V = Y_CROWN - 0.570 * HS;

// How thick the bone is at the edge of a cut, which is the depth of the wall
// inside every opening. A real cranial vault is about 5mm on a 145mm skull and
// an orbital margin is thicker; 3% of the head's height is that, and it is also
// about two and a half grid cells, which is the least a wall can be and still
// have more than one quad's worth of shading in it.
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
const FACE_R = 0.45 * M.skull.width;

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
// and they have to be independent: a single exponent high enough to give the
// skull the flat frontal plane the sockets sit on also squares the crown off
// into a helmet. Flat in plan, domed in section is exactly the split.
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
// The exponents sit a little above 2 so the opening is a rounded rectangle
// rather than a pure ellipse. A true ellipse read as a cartoon eye; the
// straight-ish stretches along the top and bottom are what keep it a skull.
const SOCKET_TAPER_LO = 0.88;
const SOCKET_PX = 2.35;
function socketTaper(kx) {
  return SOCKET_TAPER_LO + (1 - SOCKET_TAPER_LO) * smoothstep(-1, 0.35, kx);
}
function socketShape(kx, ky) {
  const k = ky / socketTaper(kx);
  const e = ky > 0 ? 2.5 : 2.2;
  return Math.pow(Math.abs(kx), SOCKET_PX) + Math.pow(Math.abs(k), e);
}
// The top edge of the socket, in the same frame, at a given kx.
function socketTop(kx) {
  const rem = 1 - Math.pow(Math.abs(kx), SOCKET_PX);
  return rem <= 0 ? 0 : socketTaper(kx) * Math.pow(rem, 1 / 2.5);
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

  const add = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ---------------------------------------------------------------- the field
  const maxilla = blob(
    [0, (MAX_TOP + MAX_BOTTOM) / 2, (Z_FACE + MAX_BACK) / 2],
    [MAX_HALF_W, (MAX_TOP - MAX_BOTTOM) / 2, (Z_FACE - MAX_BACK) / 2],
    // Rounded in plan, flat underneath. Boxy both ways (3.6) put a hard
    // vertical corner where the face plane met the side of the head.
    2.8, 4.0,
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
  const BROW_LIFT = 0.020 * HS;
  const BROW_R = 0.048 * HS;
  const BROW_INSET = 0.018 * HS;
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

  // The zygomatic arches, running back from the outer orbital rim toward the
  // ear. Same trick: the path is a bearing and a height, the radius comes off
  // the vault, so the arch hugs whatever shape the vault happens to be.
  //
  // Kept short and low. Carried back to 103 degrees and standing far proud it
  // stopped being a cheekbone and became a moulding seam running right round
  // the side of the head. It stands a little prouder than it did because the
  // temple behind it is dished now -- the arch is not bigger, the head next to
  // it is smaller, which is the anatomy.
  const ZYG_R = 0.038 * HS;
  const ZYG_INSET = 0.009 * HS;
  const zygos = [-1, 1].map((side) => {
    const pts = [];
    for (let i = 0; i <= 11; i++) {
      const f = i / 11;
      // Carried back to 1.80 radians and dropped to the hinge's own height at
      // the far end, so it finishes as a root over the jaw joint. It used to
      // stop short at 1.56 and a hand's breadth above the condyle, which left
      // the condyle ball hanging off the side of the head as a bare knob -- the
      // one thing about the jaw that read worst in the back view.
      const ang = side * (0.80 + 1.00 * f);
      const y = (0.245 - 0.135 * f - 0.020 * Math.sin(Math.PI * f)) * HS;
      const rho = surfaceRho(base, ang, y) - ZYG_INSET;
      pts.push(new THREE.Vector3(Math.sin(ang) * rho, y, Math.cos(ang) * rho));
    }
    return tube(pts, ZYG_R);
  });

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
  const TEMP_R = 0.034 * HS;
  // [bearing, height BELOW THE CROWN as a fraction of the skull's height, how
  // deep to bury this point]. It starts level with the top of the orbit and
  // climbs, which is the whole character of the line; run at the orbit's own
  // height all the way round -- as it was on the first attempt -- it crosses the
  // middle of the side of the head and reads as a dent, not a line.
  //
  // The third number is the fix for a capsule chain's ends. tube() sweeps ONE
  // radius, so a run that stops out in the open stops with a hemisphere on it,
  // and that hemisphere came out as a pimple on the back of the head. Sinking
  // the last point or two deeper than the ridge itself buries the cap instead.
  const TEMPORAL = [
    [0.86, 0.340, 0.062], [1.12, 0.314, 0.034], [1.42, 0.296, 0.025],
    [1.72, 0.294, 0.026], [2.00, 0.322, 0.040], [2.26, 0.386, 0.078],
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
  // standing on two legs.
  const mastoid = (side) => blob(
    [side * 0.290 * M.skull.width, 0.028 * HS, -0.230 * M.skull.depth],
    [0.058 * M.skull.width, 0.090 * HS, 0.058 * M.skull.depth], 2.3);
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

  const field = (x, y, z) => {
    let d = base(x, y, z);
    d = smin(d, brows[0](x, y, z), 0.020);
    d = smin(d, brows[1](x, y, z), 0.020);
    d = smin(d, zygos[0](x, y, z), 0.017);
    d = smin(d, zygos[1](x, y, z), 0.017);
    d = smin(d, temporals[0](x, y, z), 0.022);
    d = smin(d, temporals[1](x, y, z), 0.022);
    d = smin(d, alveolar(x, y, z), 0.024);
    d = smin(d, condyleL(x, y, z), 0.016);
    d = smin(d, condyleR(x, y, z), 0.016);
    d = smin(d, mastoidL(x, y, z), 0.030);
    d = smin(d, mastoidR(x, y, z), 0.030);
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
  const isRim = new Uint8Array(count);
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
      // through the gap is the dark cavity behind. At the 0.55 pumpkin.js uses
      // two neighbours could between them move 1.1 cells toward each other,
      // and a scatter of black specks appeared on the bridge of the nose doing
      // exactly that. Half a cell each is the most that cannot cross.
      const cellV = Math.abs(Math.cos(vPhi[k]) * vT[k]) * (Math.PI / NPH);
      const uN = u + Math.max(-0.50 * CELL_U, Math.min(0.50 * CELL_U, hit.X - u));
      const vN = v + Math.max(-0.50 * cellV, Math.min(0.50 * cellV, hit.Y - v));
      const s = faceSample(uN, vN, vPhi[k], vT[k]);
      place(k, s.th, s.phi, s.t);
      rimNU[k] = hit.nx;
      rimNV[k] = hit.ny;
      isRim[k] = 1;
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
  group.add(add(craniumGeo, skin));

  // Step three: the wall inside each cut. One ribbon quad per grid edge that
  // has a dropped quad on one side and a kept one on the other. The rim
  // vertices are already snapped onto the outline, so the ribbon follows the
  // true curve; extruding each of them back along its own surface normal by
  // WALL_T lands exactly where the cavity's mouth is, so wall and cavity meet
  // with no seam.
  //
  // The wall is its own geometry so its normals never average into the skin's:
  // that is what keeps the lip a crisp edge instead of a smeared crease, and it
  // is the difference between a hole and a bruise.
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
    // off. A real orbit is a deep bowl, so that is what goes in: rings of the
    // outline shrunk toward its own centre and sunk along the skin's normal,
    // which traces a quarter ellipse from the mouth of the hole to a pole at
    // the back. Because it is a separate mesh from the skin it cannot fold into
    // it, which is the whole class of bug the old pressed-in dent had: pressed
    // along the normal, a wall steeper than about 45 degrees folded the mesh
    // over itself and dragged unpainted skin in front of the socket floor as a
    // bright crescent that read as an eyeball. Nothing here can do that.
    //
    // The bowl's normals point at the MOUTH's centre, which is what the inside
    // of a hemisphere's normals do. So the sides of the bowl face across the
    // opening and go dark, the back of it faces out and catches a little light,
    // and the socket reads as a cavity with a floor rather than as a black
    // sticker. The colours have to stay very low all the same: this scene has
    // no global illumination, so the hemisphere light reaches the back of the
    // bowl as if nothing were in the way.
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

      // Seeds for the Newton walk: start each ring from the previous ring's
      // solution, which is never more than a cell away.
      let sPhi = 0, sT = M.skull.depth * 0.5;
      {
        const s = faceSample(uc, vc, 0, sT);
        sPhi = s.phi; sT = s.t;
      }
      const mouth = (() => {
        const s = faceSample(uc, vc, sPhi, sT);
        const cp = Math.cos(s.phi), sp = Math.sin(s.phi);
        const p = new THREE.Vector3(
          P0.x + cp * Math.sin(s.th) * s.t, P0.y + sp * s.t, P0.z + cp * Math.cos(s.th) * s.t);
        const nn = gradNormal(p.x, p.y, p.z, new THREE.Vector3());
        return p.addScaledVector(nn, -WALL_T);
      })();

      const base0 = holeVerts.length / 3;
      const nrm = new THREE.Vector3();
      const pt = new THREE.Vector3();
      const out = new THREE.Vector3();
      for (let r = 0; r <= CAV_RINGS; r++) {
        // r = 0 is the hidden skirt, r = 1 the outline itself at the bottom of
        // the wall, and from there the quarter ellipse inward and back.
        const s = r <= 1 ? 0 : (r - 1) / CAV_RINGS;
        const shrink = Math.cos((Math.PI / 2) * s);
        // The skirt is sunk deeper than the wall's own floor, because it is the
        // one ring that must never surface: it lies under skin, and skin only a
        // couple of grid cells wide between two openings has nothing to spare.
        const sink = (r === 0 ? 1.9 * WALL_T : WALL_T) + depth * Math.sin((Math.PI / 2) * s);
        for (let i = 0; i < n; i++) {
          const f = cut.pts[i];
          const u = uc + (f[0] - uc) * shrink;
          const v = vc + (f[1] - vc) * shrink;
          const sm = faceSample(u, v, sPhi, sT);
          sPhi = sm.phi; sT = sm.t;
          const cp = Math.cos(sm.phi), sp = Math.sin(sm.phi);
          pt.set(P0.x + cp * Math.sin(sm.th) * sm.t, P0.y + sp * sm.t, P0.z + cp * Math.cos(sm.th) * sm.t);
          gradNormal(pt.x, pt.y, pt.z, nrm);
          if (r === 0) {
            // The skirt runs out from the rim ALONG THE TANGENT PLANE, not along
            // the skin. Following the skin was the first attempt and it is wrong
            // wherever the skin is concave: the valley between the nasal
            // aperture and the medial wall of the orbit turns tighter than the
            // wall is thick, so normals a cell apart cross, the sunk ring folds
            // through itself and a few of its vertices surface on the bridge of
            // the nose as black specks. A flange in the tangent plane cannot do
            // that from either sign of curvature -- the skin bends away from the
            // tangent plane when convex and away from the flange when concave.
            const g = cut.pts[(i + 1) % n], h = cut.pts[(i + n - 1) % n];
            const ex = g[0] - h[0], ey = g[1] - h[1];
            const inv = 1 / (Math.hypot(ex, ey) || 1);
            // Outward is the reverse of the counter-clockwise inward normal.
            const ou = ey * inv, ov = -ex * inv;
            out.set(ou * Math.cos(sm.th), ov, ou * -Math.sin(sm.th));
            out.addScaledVector(nrm, -out.dot(nrm));
            const ol = out.length();
            if (ol > 1e-9) pt.addScaledVector(out, CAV_SKIRT / ol);
          }
          pt.addScaledVector(nrm, -sink);
          holeVerts.push(pt.x, pt.y, pt.z);
          nrm.copy(mouth).sub(pt);
          const len = nrm.length();
          if (len > 1e-9) nrm.divideScalar(len);
          holeNors.push(nrm.x, nrm.y, nrm.z);
          const l = CAV_LUM[Math.min(CAV_LUM.length - 1, r)];
          holeColors.push(l, l * (1 - 0.02 * (1 - l)), l * (1 + 0.10 * (1 - l)));
        }
      }
      // The pole. Its normal is straight out of the hole.
      const apex = (() => {
        const sm = faceSample(uc, vc, sPhi, sT);
        const cp = Math.cos(sm.phi), sp = Math.sin(sm.phi);
        pt.set(P0.x + cp * Math.sin(sm.th) * sm.t, P0.y + sp * sm.t, P0.z + cp * Math.cos(sm.th) * sm.t);
        gradNormal(pt.x, pt.y, pt.z, nrm);
        pt.addScaledVector(nrm, -(WALL_T + depth));
        return pt.clone();
      })();
      const apexIdx = holeVerts.length / 3;
      holeVerts.push(apex.x, apex.y, apex.z);
      nrm.copy(mouth).sub(apex).normalize();
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
  group.add(cavity);

  // ------------------------------------------------------------- upper teeth
  const upperRow = archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H / 2);
  const upperLen = upperRow.getLength();
  const upperTooth = track(toothGeometry(
    (upperLen / M.skull.teeth.upper) * 0.82, TOOTH_H, TOOTH_D,
  ));
  const up = new THREE.Vector3(0, 1, 0);
  const placeRow = (curve, geo, n, parent) => {
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
      const mesh = add(geo, material);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(p);
      parent.add(mesh);
    }
  };
  placeRow(upperRow, upperTooth, M.skull.teeth.upper, group);

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
  // thickness and carried on past the last molar to the angle. Giving the body
  // its own shallower curve was tried: it left the back of the row standing
  // over nothing and needed a separate gum bar to patch, and that bar read as
  // a brace clipped over the front teeth.
  const bodyCurve = archCurve(
    { halfW: LOWER_ARCH.halfW * 1.01, front: LOWER_ARCH.front, back: LOWER_ARCH.back },
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
  jawRoot.add(add(bodyGeo, material));

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
    jawRoot.add(add(cap, material));

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
    jawRoot.add(add(ramus, material));
    const ball = track(jointBall(RAMUS_R * 0.66));
    ball.translate(side * HINGE_X, HINGE_Y, HINGE_Z);
    jawRoot.add(add(ball, material));
  }

  // ------------------------------------------------------------- lower teeth
  const lowerRow = archCurve(LOWER_ARCH, Y_BITE - TOOTH_H / 2);
  const lowerTooth = track(toothGeometry(
    (lowerRow.getLength() / M.skull.teeth.lower) * 0.82, TOOTH_H, TOOTH_D,
  ));
  placeRow(lowerRow, lowerTooth, M.skull.teeth.lower, jawRoot);

  // Symmetric, so this asserts nothing about the skull's own geometry; it is
  // published because metrics.js asks every part to, and the assembler checks.
  group.userData.outwardX = LEFT_X;

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
