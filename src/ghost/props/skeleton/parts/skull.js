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
//    watertight parametric surface -- a smooth union of a few blobs and swept
//    tubes, sampled on a sphere grid -- exactly the call pumpkin.js makes for
//    its lobed shell. The mandible and the teeth, which ARE long-bone-shaped,
//    do come from the vocabulary.
//
// 2. The orbits and the nasal aperture are dents painted near-black through
//    vertex colours, not holes. Real holes need CSG, and a CSG'd skull stops
//    being one watertight mesh. A deep dent with a crisp dark edge reads as a
//    hole at every size this prop is ever seen at, which is the same trade
//    pumpkin.js makes for its carved face.
//
// The single thing that makes this head read as the reference and not as a
// generic skull is the glare: the top edge of each orbit runs on a diagonal
// that dives toward the nose (M.skull.socket.slant), with the brow ridge
// riding that same diagonal above it. Everything else is supporting cast.

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
const HD = M.skull.depth / 2;

// --- the vault -------------------------------------------------------------
// Bottom sits a hair below the condyle plane so the skull base is a shallow
// dome where the atlas meets it rather than tapering to a point at y = 0.
const VAULT_BASE = -0.012 * M.skull.height;
// How the skull's depth is split about the atlas. The occipital condyles are
// behind the middle of a real skull, but only just: put them much further back
// and the whole head reads as an egg tipping forward off the neck, which was
// the other fault in the previous build. 54/46 is as far back as it takes.
const Z_BACK = -0.54 * M.skull.depth;
const Z_FACE = Z_BACK + M.skull.depth;        // front of the maxilla
// The vault itself stops short of the face: the last 7% of the depth is the
// brow and cheek riding on top of it.
const Z_VAULT_FRONT = Z_BACK + 0.90 * M.skull.depth;

// --- the face --------------------------------------------------------------
// The maxilla is a rounded box rather than an ellipsoid (exponent well above
// 2), because the tooth row has to have bone directly above it all the way out
// to the back molars. An ellipsoid's underside curves away at the corners and
// leaves the outer teeth hanging in air -- the exact fault the last build had.
const MAX_TOP = 0.283 * M.skull.height;
const MAX_BOTTOM = 0.091 * M.skull.height;    // the palate, just above the crowns
const MAX_HALF_W = 0.298 * M.skull.width;
const MAX_BACK = Z_FACE - 0.643 * M.skull.depth;

// --- the tooth rows --------------------------------------------------------
// Not in metrics.js: only the counts are. Sized off the photo, where the
// visible tooth row is a shade under half the skull's width, and written as
// fractions of the measurements that ARE there so a change of scale carries.
const UPPER_ARCH = { halfW: 0.262 * M.skull.width, front: 0.400 * M.skull.depth, back: 0.208 * M.skull.depth };
const LOWER_ARCH = { halfW: 0.222 * M.skull.width, front: 0.379 * M.skull.depth, back: 0.197 * M.skull.depth };
const TOOTH_H = 0.066 * M.skull.height;
const TOOTH_D = 0.045 * M.skull.height;
// The rows do not meet. In the reference there is a dark line between them and
// it is most of what stops the mouth reading as a painted stripe.
const AJAR = 0.018 * M.skull.height;

// --- the mandible ----------------------------------------------------------
// A thin deep bar: thin side to side, deep top to bottom, and no deeper than
// M.skull.jawHeight allows. A round swept tube cannot be thin one way and deep
// the other, so the body is swept round and then squashed.
const JAW_R = 0.043 * M.skull.height;         // half the bar's side-to-side wall
const RAMUS_R = 0.052 * M.skull.height;
// The hinge. Level with the root of the zygomatic arch and just behind the
// middle of the skull, which is where the fossa is; the condyle balls sit half
// buried in the skull base there so the joint has somewhere to be.
const HINGE_Y = 0.096 * M.skull.height;
const HINGE_Z = -0.080 * M.skull.depth;
// Tucked in. At 0.355 and again at 0.300 the two rami stood clear of the jaw
// bar in the front view and read as a pair of handles on the sides of the head.
const HINGE_X = 0.272 * M.skull.width;
const FORAMEN_Z = -0.150 * M.skull.depth;

// --- the glare -------------------------------------------------------------
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
// the size metrics gives it and rides a little higher than the photo's does,
// which costs some forehead and buys back a face.
const ORBIT_V = Y_CROWN - 0.495 * M.skull.height;
const ORBIT_DEPTH = 0.52 * M.skull.socket.height;

// The nasal aperture is not in metrics.js. Written against the socket so the
// two stay in proportion; measured off the photo it is about a third of the
// socket's width and half its height.
const NASAL_W = 0.66 * M.skull.socket.width;
const NASAL_H = 0.66 * M.skull.socket.height;
const NASAL_V = Y_CROWN - 0.625 * M.skull.height;
const NASAL_DEPTH = 0.62 * NASAL_H;

// The face is unwrapped about the vertical axis so a socket keeps its size as
// it curls round onto the temple. FACE_R is the radius that arc length is
// measured at: it is the distance from the axis out to the brow, so the socket
// is honest where it matters and only slightly stretched elsewhere.
const FACE_R = 0.45 * M.skull.width;

// Where the sphere grid is centred. Deep inside the vault, so every ray out of
// it crosses the surface exactly once.
const P0 = new THREE.Vector3(0, 0.335 * M.skull.height, 0);

// Tessellation. The dark edge of a socket is a hard line and it lands on this
// grid, so the count around is high; 96 was tried and the socket rims came out
// visibly stepped at the head crop.
const NTH = 176;
const NPH = 120;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Polynomial smooth minimum. k is a real length, so the blend fillet between
// two parts is the same size wherever it happens.
const smin = (a, b, k) => {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

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

// Signed distance from a point to a shape function's 1-contour, near enough
// for shading. The shape functions below are not distance fields: a socket's
// value climbs through 1 far faster at its pointed medial end than along its
// long top edge, so a band of fixed width in shape-function units comes out as
// a hairline in one place and a staircase across the mesh grid in another.
// Dividing by the gradient makes one band width mean one length everywhere.
function rim(f, x, y) {
  const e = 1e-4;
  const s = f(x, y);
  const gx = (f(x + e, y) - s) / e;
  const gy = (f(x, y + e) - s) / e;
  const g = Math.sqrt(gx * gx + gy * gy);
  return g > 1e-5 ? (s - 1) / g : -1;
}
// How wide the painted edge of a hole is, and how far its outside shadow
// reaches. EDGE has to be a little over one cell of the vault's grid or the
// edge lands between rows and steps.
const EDGE = 0.0050;
const AO_REACH = 0.011;

// --- the socket ------------------------------------------------------------
// The almond, in the frame the slant rotates into. kx runs -1 (medial, down by
// the nose) to +1 (lateral, up by the temple). The medial end is shallower and
// the top edge is straighter than the bottom -- that straight upper edge, tilted,
// IS the glare.
function socketShape(kx, ky) {
  const taper = 0.60 + 0.40 * smoothstep(-1, 0.30, kx);
  const k = ky / taper;
  const e = ky > 0 ? 3.0 : 2.05;
  return Math.pow(Math.abs(kx), 2.5) + Math.pow(Math.abs(k), e);
}
// The top edge of the socket, in the same frame, at a given kx.
function socketTop(kx) {
  const taper = 0.60 + 0.40 * smoothstep(-1, 0.30, kx);
  const rem = 1 - Math.pow(Math.abs(kx), 2.5);
  return rem <= 0 ? 0 : taper * Math.pow(rem, 1 / 3.0);
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
function archCurve({ halfW, front, back }, y, { inset = 0, extend = 1, rise = 0 } = {}) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const u = (-1 + (2 * i) / n) * extend;
    pts.push(new THREE.Vector3(
      (halfW - inset) * u,
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

  // The vault and the face need vertex colours to carry the sockets; the teeth
  // and the mandible do not, so they keep the shared material untouched.
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
  const vault = blob(
    [0, (Y_CROWN + VAULT_BASE) / 2, (Z_VAULT_FRONT + Z_BACK) / 2],
    [HW, (Y_CROWN - VAULT_BASE) / 2, (Z_VAULT_FRONT - Z_BACK) / 2],
    // Flat-ish in plan so there is a frontal plane for the sockets to sit on:
    // at 2.15 both ways the face came to a point and the orbits curled round
    // onto the temples. Domed in section, because the crown is a dome.
    2.45, 2.02,
  );
  const maxilla = blob(
    [0, (MAX_TOP + MAX_BOTTOM) / 2, (Z_FACE + MAX_BACK) / 2],
    [MAX_HALF_W, (MAX_TOP - MAX_BOTTOM) / 2, (Z_FACE - MAX_BACK) / 2],
    2.8, 4.0,
  );
  const base = (x, y, z) => smin(vault(x, y, z), maxilla(x, y, z), 0.055);

  // The brow ridges, laid along the top edge of each socket and lifted a
  // little proud of it. This is the other half of the glare: the socket alone
  // is a dark hole, the socket with a ridge hanging over it is a scowl.
  // The brow hugs the top edge of the socket. Lifted 0.030 and fattened to
  // 0.068 it stopped being a brow and became a wedge: the two ridges met over
  // the nose in a raised triangle that read as a snout.
  const BROW_LIFT = 0.016 * M.skull.height;
  const BROW_R = 0.054 * M.skull.height;
  const BROW_INSET = 0.024 * M.skull.height;
  const brows = [-1, 1].map((side) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const kx = -0.90 + (1.82 * i) / 12;
      const [u, v] = socketToFace(side, kx * SOCKET.a, socketTop(kx) * SOCKET.b + BROW_LIFT);
      const ang = u / FACE_R;
      const rho = surfaceRho(base, ang, v) - BROW_INSET;
      pts.push(new THREE.Vector3(Math.sin(ang) * rho, v, Math.cos(ang) * rho));
    }
    return tube(pts, BROW_R);
  });

  // The zygomatic arches, running back from the outer orbital rim to the ear.
  // Same trick: the path is a bearing and a height, the radius comes off the
  // vault, so the arch hugs whatever shape the vault happens to be.
  // Kept short and low. Run back to 103 degrees and stood 0.013 proud it
  // stopped being a cheekbone and became a moulding seam running right round
  // the side of the head.
  const ZYG_R = 0.038 * M.skull.height;
  const ZYG_INSET = 0.015 * M.skull.height;
  const zygos = [-1, 1].map((side) => {
    const pts = [];
    for (let i = 0; i <= 9; i++) {
      const f = i / 9;
      const ang = side * (0.80 + 0.72 * f);
      const y = (0.245 - 0.095 * f - 0.018 * Math.sin(Math.PI * f)) * M.skull.height;
      const rho = surfaceRho(base, ang, y) - ZYG_INSET;
      pts.push(new THREE.Vector3(Math.sin(ang) * rho, y, Math.cos(ang) * rho));
    }
    return tube(pts, ZYG_R);
  });

  // The alveolar ridge: bone directly above every upper tooth, all the way to
  // the back of the row. Without it the maxilla's corners lift away from the
  // outer teeth and they hang in air, which is what went wrong last time.
  const alveolarR = 0.036 * M.skull.height;
  const alveolar = tube(
    archCurve(UPPER_ARCH, Y_BITE + AJAR + TOOTH_H + 0.020 * M.skull.height, { inset: alveolarR * 0.85 })
      .getSpacedPoints(20),
    alveolarR,
  );

  // The occipital condyles themselves, two small bumps flanking the foramen
  // magnum. They are the reason the group's origin is where it is, so they may
  // as well be visible from underneath.
  const condyle = (side) => blob(
    [side * 0.068 * M.skull.width, 0.012 * M.skull.height, FORAMEN_Z],
    [0.048 * M.skull.width, 0.048 * M.skull.height, 0.055 * M.skull.depth], 2);
  const condyleL = condyle(-1);
  const condyleR = condyle(1);

  // Mastoid processes. Two jobs: they are real bone, and they are what the top
  // of each ramus tucks behind. Kept small: at 0.15 of the skull's height they
  // stopped being processes and turned the back of the head into a lamp
  // standing on two legs.
  const mastoid = (side) => blob(
    [side * 0.290 * M.skull.width, 0.028 * M.skull.height, -0.230 * M.skull.depth],
    [0.058 * M.skull.width, 0.090 * M.skull.height, 0.058 * M.skull.depth], 2.3);
  const mastoidL = mastoid(-1);
  const mastoidR = mastoid(1);

  // An occipital shelf, a blob carrying the back of the vault on down behind
  // the ear, was tried here and dropped. At every blend width from 0.02 to 0.10
  // the join drew a hard contour line right round the back of the head, and
  // that line is far more damaging than the daylight it was closing.

  const field = (x, y, z) => {
    let d = base(x, y, z);
    d = smin(d, brows[0](x, y, z), 0.013);
    d = smin(d, brows[1](x, y, z), 0.013);
    d = smin(d, zygos[0](x, y, z), 0.017);
    d = smin(d, zygos[1](x, y, z), 0.017);
    d = smin(d, alveolar(x, y, z), 0.024);
    d = smin(d, condyleL(x, y, z), 0.016);
    d = smin(d, condyleR(x, y, z), 0.016);
    d = smin(d, mastoidL(x, y, z), 0.030);
    d = smin(d, mastoidR(x, y, z), 0.030);
    return d;
  };

  // ---------------------------------------------------------- the cranium mesh
  // Columns are NOT duplicated at theta = 0. A duplicated seam column gets its
  // own averaged normals and draws a bright crease straight down the middle of
  // the face, which is the last place a skull can afford one.
  const count = NTH * (NPH + 1);
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  // Nothing on this head is further than this from P0; the bisection needs a
  // bracket it is certain straddles the surface.
  const T_MAX = M.skull.depth * 1.6;

  // Pass one: the undented vault. A ray out of P0 is walked until the field
  // changes sign and the crossing is then bisected.
  //
  // The walk matters. Bisecting the whole bracket blind assumes the field
  // crosses zero once along the ray, and a smooth union does not have to: the
  // fillet where two parts meet is concave, a grazing ray can cut it three
  // times, and blind bisection then lands on whichever crossing the halving
  // happens to trap -- a different one for neighbouring rays, which tears.
  //
  // Each ray starts from where the ray below it landed, so it tracks the same
  // sheet as its neighbour and usually finds the bracket in two or three steps.
  const STEP = 0.008;
  const solve = (dx, dy, dz, guess) => {
    const at = (t) => field(P0.x + dx * t, P0.y + dy * t, P0.z + dz * t);
    let lo, hi;
    if (at(guess) < 0) {
      lo = guess; hi = guess + STEP;
      while (hi < T_MAX && at(hi) < 0) { lo = hi; hi += STEP; }
    } else {
      hi = guess; lo = guess - STEP;
      while (lo > STEP && at(lo) > 0) { hi = lo; lo -= STEP; }
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

  let vi = 0;
  for (let iy = 0; iy <= NPH; iy++) {
    const phi = -Math.PI / 2 + (Math.PI * iy) / NPH;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    for (let ix = 0; ix < NTH; ix++) {
      const th = (2 * Math.PI * ix) / NTH;
      const dx = cp * Math.sin(th), dy = sp, dz = cp * Math.cos(th);
      const t = solve(dx, dy, dz, lastT[ix]);
      lastT[ix] = t;
      position[vi] = P0.x + dx * t;
      position[vi + 1] = P0.y + dy * t;
      position[vi + 2] = P0.z + dz * t;
      vi += 3;
    }
  }

  const index = [];
  for (let iy = 0; iy < NPH; iy++) {
    for (let ix = 0; ix < NTH; ix++) {
      const nx = (ix + 1) % NTH;
      const a = iy * NTH + ix;
      const b = iy * NTH + nx;
      const c = a + NTH;
      const d = b + NTH;
      index.push(a, b, d, a, d, c);
    }
  }

  const craniumGeo = track(new THREE.BufferGeometry());
  craniumGeo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  craniumGeo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  craniumGeo.setIndex(index);
  // The normals of the UNDENTED surface, which is what the dents are then
  // pressed along. Pressing along the ray out of P0 instead was tried first
  // and it smears: out at the lateral rim of a socket the ray is nearly
  // tangent to the skull, so the vertex slides across the cheek rather than
  // sinking, and the socket frays into a fan of spikes.
  craniumGeo.computeVertexNormals();
  const normal = craniumGeo.attributes.normal.array;

  // Pass two: press the sockets, the nasal aperture and the rest in, and paint
  // them.
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    const px = position[j], py = position[j + 1], pz = position[j + 2];
    const u = Math.atan2(px, pz) * FACE_R;
    let dent = 0;
    let lum = 1;

    // --- the sockets
    for (const side of [-1, 1]) {
      const du = side * u - ORBIT_U;
      const dv = py - ORBIT_V;
      // into the socket's own frame: q along the slant (positive lateral),
      // w across it (positive up).
      const q = du * SOCKET.cs + dv * SOCKET.sn;
      const w = -du * SOCKET.sn + dv * SOCKET.cs;
      const d = rim((a, b) => socketShape(a / SOCKET.a, b / SOCKET.b), q, w);
      // The bowl is soft and the dark edge is hard. The other way round -- a
      // sharp geometric rim with a soft gradient painted on it -- was tried
      // and reads as a bruise, not a hole.
      dent = Math.max(dent, ORBIT_DEPTH * (1 - smoothstep(-ORBIT_DEPTH * 0.5, EDGE, d)));
      lum *= 1 - 0.962 * (1 - smoothstep(-EDGE, EDGE, d));
      lum *= 1 - 0.17 * (1 - smoothstep(EDGE, EDGE + AO_REACH, d));
    }

    // --- the nasal aperture
    {
      const d = rim(
        (a, b) => nasalShape(a / (NASAL_W / 2), b / (NASAL_H / 2)),
        u, py - NASAL_V,
      );
      dent = Math.max(dent, NASAL_DEPTH * (1 - smoothstep(-NASAL_DEPTH * 0.5, EDGE, d)));
      lum *= 1 - 0.945 * (1 - smoothstep(-EDGE, EDGE, d));
      lum *= 1 - 0.15 * (1 - smoothstep(EDGE, EDGE + AO_REACH * 0.6, d));
    }

    // --- the temporal fossa, the shallow hollow above the cheekbone. Almost
    // nothing, but it is what separates the arch from the side of the vault.
    {
      const a = (Math.abs(u) - 1.30 * FACE_R) / (0.50 * FACE_R);
      const b = (py - 0.440 * M.skull.height) / (0.20 * M.skull.height);
      const s = a * a + b * b;
      dent = Math.max(dent, 0.010 * M.skull.height * (1 - smoothstep(0.2, 1.0, s)));
      lum *= 1 - 0.05 * (1 - smoothstep(0.3, 1.1, s));
    }

    // --- the foramen magnum, on the underside between the condyles.
    if (normal[j + 1] < -0.35) {
      const fz = (pz - FORAMEN_Z) / (0.17 * M.skull.depth);
      const fx = px / (0.15 * M.skull.width);
      const s = fx * fx + fz * fz;
      dent = Math.max(dent, 0.05 * M.skull.height * (1 - smoothstep(0.3, 1.05, s)));
      lum *= 1 - 0.93 * (1 - smoothstep(0.5, 1.05, s));
    }

    position[j] -= normal[j] * dent;
    position[j + 1] -= normal[j + 1] * dent;
    position[j + 2] -= normal[j + 2] * dent;
    // A touch cooler in the depths: a hole lit only by the sky is bluer than
    // the bone around it, and a purely neutral multiply reads as soot.
    color[j] = lum;
    color[j + 1] = lum * (1 - 0.02 * (1 - lum));
    color[j + 2] = lum * (1 + 0.10 * (1 - lum));
  }
  // Blur the painted edges by one ring of vertices. The dark rim of a socket
  // is a contour crossing the grid at whatever angle it likes, and a band only
  // a cell and a half wide comes out of it fringed with one-cell spikes.
  // Widening the band instead was tried and it costs the hole its edge, which
  // is the one thing the paint is there for; this leaves the 50% contour
  // exactly where it was and only takes the teeth off it.
  {
    const idx = craniumGeo.index.array;
    const acc = new Float32Array(count * 3);
    const hits = new Uint16Array(count);
    for (let pass = 0; pass < 2; pass++) {
      acc.fill(0);
      hits.fill(0);
      for (let t = 0; t < idx.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = idx[t + e];
          const b = idx[t + ((e + 1) % 3)];
          acc[a * 3] += color[b * 3];
          acc[a * 3 + 1] += color[b * 3 + 1];
          acc[a * 3 + 2] += color[b * 3 + 2];
          hits[a]++;
        }
      }
      for (let i = 0; i < count; i++) {
        const n = hits[i];
        if (!n) continue;
        const w = 2;
        for (let c = 0; c < 3; c++) {
          const j = i * 3 + c;
          color[j] = (color[j] * w + acc[j]) / (w + n);
        }
      }
    }
    craniumGeo.attributes.color.needsUpdate = true;
  }

  craniumGeo.attributes.position.needsUpdate = true;
  craniumGeo.computeVertexNormals();
  group.add(add(craniumGeo, skin));

  // ------------------------------------------------------------ mouth cavity
  // So the gap between the tooth rows is a dark slot rather than a bright one.
  // It belongs to the cranium, not the jaw, so that opening the mouth reveals
  // it instead of revealing the inside of the head.
  const cavityMat = new THREE.MeshStandardMaterial({ color: 0x241b14, roughness: 0.95, metalness: 0 });
  materials.push(cavityMat);
  const cavityGeo = track(new THREE.SphereGeometry(1, 20, 14));
  cavityGeo.scale(0.187 * M.skull.width, 0.101 * M.skull.height, 0.187 * M.skull.depth);
  cavityGeo.translate(0, Y_BITE - 0.059 * M.skull.height, 0.155 * M.skull.depth);
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
    const len = curve.getLength();
    void len;
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
  const bodyTop = Y_BITE - TOOTH_H + 0.006 * M.skull.height;
  const JAW_SQUASH = ((bodyTop - Y_CHIN) / 2) / JAW_R;
  // Same parabola as the lower tooth row, pushed out by the bar's own half
  // thickness and carried on past the last molar to the angle. Giving the body
  // its own shallower curve was tried: it left the back of the row standing
  // over nothing and needed a separate gum bar to patch, and that bar read as
  // a brace clipped over the front teeth.
  const bodyCurve = archCurve(
    { halfW: LOWER_ARCH.halfW * 1.01, front: LOWER_ARCH.front, back: LOWER_ARCH.back },
    0,
    { inset: JAW_R, extend: 1.62, rise: JAW_R * 0.38 },
  );
  // waist near 1: shaft() thins the middle of a bone, and the middle of this
  // one is the chin, which is the last place that should be thin.
  const bodyGeo = track(shaft(bodyCurve, JAW_R, { waist: 0.93, endBias: 0.85, segments: 48 }));
  bodyGeo.scale(1, JAW_SQUASH, 1);
  bodyGeo.translate(0, (bodyTop + Y_CHIN) / 2, 0);
  jawRoot.add(add(bodyGeo, material));

  // Rami and condyles. The gonion is wherever the body curve ends, so the
  // ramus always lands on the bone rather than near it.
  const gonion = bodyCurve.getPoint(1);
  const gonionY = (bodyTop + Y_CHIN) / 2 - JAW_R * 0.2;
  for (const side of [-1, 1]) {
    const a = new THREE.Vector3(side * HINGE_X, gonionY, gonion.z);
    const b = new THREE.Vector3(side * HINGE_X, HINGE_Y, HINGE_Z);
    const ramus = track(straightShaft(a, b, RAMUS_R, { waist: 0.80, segments: 20 }));
    // Both ends share an x, so the plate can be squeezed about that plane
    // without dragging the condyle off the hinge axis.
    ramus.translate(-side * HINGE_X, 0, 0);
    ramus.scale(0.60, 1, 1.25);
    ramus.translate(side * HINGE_X, 0, 0);
    jawRoot.add(add(ramus, material));
    const ball = track(jointBall(RAMUS_R * 0.80));
    ball.translate(b.x, b.y, b.z);
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
