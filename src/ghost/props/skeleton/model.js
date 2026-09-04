import * as THREE from 'three';
import { toyMaterial, SEGMENTS, contactShadow } from '../style.js';

// The skeleton's model and rig. See CONTRACT.md next door: motion.js and
// skeleton.js are built against this by other hands, so the shape of what is
// returned here is fixed and only the geometry inside it is mine.
//
// The reference is a soft vinyl toy skeleton, not an anatomy chart, and the one
// cue that carries that read is that EVERY joint is a visible rounded ball.
// Second to that: no long bone is a straight cylinder. They are all waisted in
// the middle and swollen at both ends, which is what stops the figure looking
// like it was assembled out of dowel.
//
// Two things are faked rather than modelled, both for the same reason -- real
// holes need CSG and CSG here would cost more than it buys:
//   * the eye sockets and the nose are deep dents in the skull surface, painted
//     dark at the bottom, not openings. At any size this prop is actually seen
//     they read as holes, and they keep the skull one watertight mesh.
//   * the dark gap between the tooth rows is a small dark blob sitting behind
//     the teeth rather than a view into an empty skull.

// --- Bone palette ----------------------------------------------------------
// Not in style.js yet: PALETTE is owned elsewhere and this gets folded into it
// later. Sampled off the reference, which is warm cream ivory rather than
// white, and distinctly pinker on the body than on the cranium.
const BONE = {
  body: '#f2dcc2',
  skull: '#f5ecdd',
  tooth: '#f7eddd',
  hollow: '#2b211a',
};

// --- Proportions -----------------------------------------------------------
// Authored at a 2.5 standing height with the soles at y = 0, per the contract.
// The numbers come off the reference photo, which is 645 px sole to crown, and
// were then nudged where the render disagreed with the photo. The figure is
// about 5.9 heads tall: that is a toy proportion, not a human one, and shrinking
// the skull toward anatomical was tried and immediately lost the character.
// Landmarks, all of them checked against the photo by pinning both figures to
// their own total height and comparing fractions. Where a number moved in the
// second pass the reference fraction is written next to it.
const Y = {
  ankle: 0.125,   // 0.946 of height down from the crown; photo 0.946
  knee: 0.700,    // 0.720; photo 0.716
  hip: 1.250,     // root, the femoral head line. 0.500; photo 0.495
  waist: 1.420,   // spineLower, sitting on top of the sacrum
  chest: 1.570,   // spineUpper, at the bottom of the ribcage
  neck: 1.945,
  head: 2.116,    // the atlas; the crown lands at exactly 2.5 from here
  shoulder: 1.930, // 0.228; photo 0.225
};
const X = { hip: 0.175, knee: 0.203, ankle: 0.235, shoulder: 0.255 };

// The A-pose flare, measured off the reference: the shoulders sit 0.255 out
// from the centreline and the wrists 0.475, so the arms hang a long way from
// the body. It is baked into the bone curves rather than put on the joints,
// because the contract needs every joint at identity rotation in the rest pose
// and because it leaves each joint's local axes world-aligned -- an animator
// writing elbowL.rotation.x then gets a forward bend, not a diagonal one.
const ARM = { outElbow: 0.150, dropElbow: 0.355, outWrist: 0.068, dropWrist: 0.349 };
const LEG = { outKnee: 0.028, dropKnee: 0.550, outAnkle: 0.032, dropAnkle: 0.575 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// --- Geometry kit ----------------------------------------------------------
// Everything below builds indexed grids whose seam column is shared and whose
// poles are single vertices, then leans on computeVertexNormals. That is the
// same choice pumpkin.js makes and for the same reason: shared vertices across
// the wrap are what stop a smooth surface showing a facet seam.

// An indexed lat/long blob. v runs 0 at the bottom pole to 1 at the top, u is
// the azimuth from +Z toward +X. `colorAt` is optional; when it is supplied the
// geometry carries a colour attribute and wants a vertexColors material.
function blobGeometry(rings, radial, point, colorAt) {
  const pos = [];
  const col = [];
  const idx = [];
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const push = (u, v) => {
    point(u, v, p);
    pos.push(p.x, p.y, p.z);
    if (colorAt) {
      colorAt(u, v, p, c);
      col.push(c.r, c.g, c.b);
    }
  };

  push(0, 0);
  for (let j = 1; j < rings; j++) {
    for (let i = 0; i < radial; i++) push((i / radial) * Math.PI * 2, j / rings);
  }
  push(0, 1);
  const top = pos.length / 3 - 1;

  const ring = (j, i) => 1 + (j - 1) * radial + (i % radial);
  for (let i = 0; i < radial; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rings - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a0 = ring(j, i), a1 = ring(j, i + 1);
      const b0 = ring(j + 1, i), b1 = ring(j + 1, i + 1);
      idx.push(a0, a1, b0, a1, b1, b0);
    }
  }
  for (let i = 0; i < radial; i++) idx.push(ring(rings - 1, i), ring(rings - 1, i + 1), top);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A ball. Used for every joint bulb in the rig, which is most of the model.
function ballGeometry(r, sx = 1, sy = 1, sz = 1) {
  return blobGeometry(18, 28, (u, v, t) => {
    const a = Math.PI * v;
    t.set(r * sx * Math.sin(a) * Math.sin(u), -r * sy * Math.cos(a), r * sz * Math.sin(a) * Math.cos(u));
  });
}

// A rounded box, as a superquadric pushed out from the unit sphere. The teeth
// are the only place it is used and they want flat faces with soft corners;
// scaled spheres there read as a mouthful of peas.
function nubGeometry(w, h, d, hard = 4.5) {
  return blobGeometry(14, 20, (u, v, t) => {
    const a = Math.PI * v;
    const x = Math.sin(a) * Math.sin(u);
    const y = -Math.cos(a);
    const z = Math.sin(a) * Math.cos(u);
    const n = Math.pow(
      Math.pow(Math.abs(x), hard) + Math.pow(Math.abs(y), hard) + Math.pow(Math.abs(z), hard),
      1 / hard,
    );
    t.set((x / n) * w, (y / n) * h, (z / n) * d);
  });
}

// A vertebra: a short drum with rolled edges. Lathe rather than a cylinder,
// because a cylinder's rim catches a hard specular line that no other surface
// on this model has.
function drumGeometry(r, h, f, seg = 30) {
  const pts = [new THREE.Vector2(1e-4, -h / 2)];
  const arc = 6;
  for (let i = 0; i <= arc; i++) {
    const a = (Math.PI / 2) * (i / arc);
    pts.push(new THREE.Vector2(r - f + f * Math.sin(a), -h / 2 + f * (1 - Math.cos(a))));
  }
  for (let i = 0; i <= arc; i++) {
    const a = (Math.PI / 2) * (i / arc);
    pts.push(new THREE.Vector2(r - f * (1 - Math.cos(a)), h / 2 - f + f * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(1e-4, h / 2));
  return new THREE.LatheGeometry(pts, seg);
}

// Sweeps an elliptical cross-section along a curve. `radius(t)` returns either
// a number or a [across, through] pair; with `up` supplied the frame is
// stabilised against that vector instead of using Frenet frames, so a curve
// that is mostly horizontal keeps its section upright instead of rolling.
//
// The ends are rolled down to a sliver and closed with a flat fan rather than
// taken to a point: a true point makes averaged normals pinch into a dark spot,
// and at these radii the remaining disc is well under a pixel.
function sweepTube(curve, radius, opts = {}) {
  const along = opts.along ?? 30;
  const around = opts.around ?? 20;
  const upVec = opts.up ? new THREE.Vector3(...opts.up).normalize() : null;
  const frames = upVec ? null : curve.computeFrenetFrames(along, false);

  const pos = [];
  const idx = [];
  const p = new THREE.Vector3();
  const U = new THREE.Vector3();
  const V = new THREE.Vector3();
  const T = new THREE.Vector3();

  for (let j = 0; j <= along; j++) {
    const t = j / along;
    const c = curve.getPoint(t);
    curve.getTangent(t, T);
    if (upVec) {
      U.crossVectors(upVec, T);
      if (U.lengthSq() < 1e-9) U.set(1, 0, 0);
      U.normalize();
      V.crossVectors(T, U).normalize();
    } else {
      U.copy(frames.normals[j]);
      V.copy(frames.binormals[j]);
    }
    const r = radius(t);
    const ra = Array.isArray(r) ? r[0] : r;
    const rb = Array.isArray(r) ? r[1] : r;
    for (let i = 0; i < around; i++) {
      const phi = (i / around) * Math.PI * 2;
      p.copy(c).addScaledVector(U, Math.cos(phi) * ra).addScaledVector(V, Math.sin(phi) * rb);
      pos.push(p.x, p.y, p.z);
    }
  }

  const vi = (j, i) => j * around + (i % around);
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      idx.push(vi(j, i), vi(j, i + 1), vi(j + 1, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i));
    }
  }
  const capA = pos.length / 3;
  const c0 = curve.getPoint(0);
  pos.push(c0.x, c0.y, c0.z);
  for (let i = 0; i < around; i++) idx.push(capA, vi(0, i + 1), vi(0, i));
  const capB = pos.length / 3;
  const c1 = curve.getPoint(1);
  pos.push(c1.x, c1.y, c1.z);
  for (let i = 0; i < around; i++) idx.push(capB, vi(along, i), vi(along, i + 1));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const curveThrough = (pts, closed = false) =>
  new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), closed, 'catmullrom', 0.5);

// The radius profile of a long bone: waisted through the shaft, swollen at both
// ends, rolled off at the very tips. `endA`/`endB` are the multiples of the
// shaft radius each end swells to.
function shaftProfile(r, { endA = 1.55, endB = 1.55, waist = 0.16, spread = 0.18 } = {}) {
  const bump = (t) => Math.exp(-((t / spread) * (t / spread)));
  return (t) => {
    let k = 1 - waist * Math.sin(Math.PI * t);
    k += (endA - 1) * bump(t) + (endB - 1) * bump(1 - t);
    const over = Math.max(0, Math.abs(2 * t - 1) - 0.93) / 0.07;
    return r * k * Math.sqrt(Math.max(0.014, 1 - over * over));
  };
}

// A bone that hangs from its proximal joint at the origin down to -length,
// bowed a little on the way. Straight ones were tried first; nothing else made
// the figure look so much like plumbing.
function boneCurve(length, { bowZ = 0, bowX = 0 } = {}) {
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const s = Math.sin(Math.PI * t);
    pts.push([bowX * s, -length * t, bowZ * s]);
  }
  return curveThrough(pts);
}

// Welds an ExtrudeGeometry back into an indexed mesh so its bevel can be
// smooth-shaded. Extrude output is unindexed and computeVertexNormals on it
// gives every bevel step a hard facet.
function weld(geo, eps = 1e-5) {
  const pos = geo.getAttribute('position');
  const src = geo.index ? geo.index.array : null;
  const count = src ? src.length : pos.count;
  const map = new Map();
  const verts = [];
  const idx = [];
  const q = 1 / eps;
  for (let n = 0; n < count; n++) {
    const i = src ? src[n] : n;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * q)}|${Math.round(y * q)}|${Math.round(z * q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(x, y, z);
    }
    idx.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  geo.dispose();
  return out;
}

// A rounded plate from a 2D outline, with optional holes through it. The
// outline points are control points on a closed spline, not the silhouette
// itself, so the edge comes out smooth however few of them there are.
function plateGeometry(outline, holes, { depth = 0.04, bevel = 0.012, samples = 150 } = {}) {
  const loop = (pts, n) => {
    const p = curveThrough(pts.map(([x, y]) => [x, y, 0]), true).getPoints(n);
    p.pop();
    return p.map((v) => new THREE.Vector2(v.x, v.y));
  };
  const shape = new THREE.Shape(loop(outline, samples));
  for (const h of holes) shape.holes.push(new THREE.Path(loop(h, 60)));
  const core = Math.max(0.002, depth - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    // bevelOffset must stay 0. Setting it to -bevelSize keeps the authored
    // outline as the true silhouette, but it also grows the hole contours, and
    // in that combination the extruder's cap triangulation silently stops
    // cutting the holes at all: the pelvis comes out as a solid paddle.
    bevelOffset: 0,
    bevelSegments: 5,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -core / 2);
  return weld(geo);
}

// --- Skull -----------------------------------------------------------------
// One watertight surface for the cranium, the face and the upper jaw, built as
// a deformed superellipsoid. A plain ellipsoid was the first pass and it fails
// in two specific places: its underside pinches to a point, so the mouth ends up
// far too narrow to hang teeth on, and its profile below the brow falls away so
// the face reads as a muzzle. The superellipse exponent fixes the first and the
// maxilla push fixes the second.
const SKULL = {
  cy: 0.206, cz: -0.018,     // centre, relative to the atlas at Y.head
  rx: 0.178, ry: 0.178, rz: 0.178,   // width 0.142 of height; photo 0.141
  eyeX: 0.077, eyeY: 0.158,  // socket centres, measured off the reference
  eyeA: 0.057, eyeB: 0.058,  // half-extents of the oval before the slant trims it
  noseY: 0.100,
  toothY: 0.058,             // the alveolar arch the upper teeth hang from
};

// The base shape, with no features cut into it. Split out because the tooth
// rows have to sit exactly on the jaw line of this surface, and the only way to
// be sure of that is to ask the same function where it is.
function skullBase(u, v, out) {
  const S = SKULL;
  const h = -Math.cos(Math.PI * v);            // -1 chin end .. +1 crown
  // Rounder at the crown, flatter underneath, which is what keeps the jaw line
  // wide enough for a row of teeth. A plain ellipsoid pinches to a point here
  // and the mouth ends up half the width it should be.
  // 2.30 at the crown rather than 2.05: the photo's cranium has a flatter top
  // than a plain ellipsoid gives, and at 2.05 ours read as a balloon.
  const n = 2.30 + 0.75 * smoothstep(0.25, -0.35, h);
  const ring = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(h), n)), 1 / n);

  let y = S.cy + S.ry * h;
  let x = S.rx * ring * Math.sin(u);
  let z = S.cz + S.rz * ring * Math.cos(u);
  const front = Math.cos(u);                   // -1 occiput .. +1 face

  // The face is narrower than the braincase.
  x *= 1 - 0.19 * smoothstep(0.215, 0.055, y);

  // Carry the maxilla forward so the profile from brow to teeth is close to
  // vertical rather than falling away into a muzzle.
  // The push has to die off as the ring shrinks toward the bottom pole, or the
  // single vertex at the pole gets shoved forward on its own and puts a spike
  // through the palate.
  const fr = Math.max(0, front);
  z += Math.pow(fr, 1.4) * clamp01(ring / 0.55) *
    (0.055 * smoothstep(0.160, 0.030, y) + 0.012 * smoothstep(0.265, 0.130, y));
  // The occiput hangs back and down behind the ear, but the back of the crown
  // above it is flattened: on the photo the rear of the skull is a plane, not a
  // continuation of the dome.
  const back = Math.max(0, -front);
  z -= 0.020 * Math.pow(back, 1.6) * smoothstep(0.310, 0.100, y);
  z += 0.020 * back * back * smoothstep(0.130, 0.330, y);

  // Cheekbones. Small, but without them the face below the sockets is a
  // featureless sheet and the whole head goes soft.
  const cheek =
    Math.exp(-Math.pow((Math.abs(x) - 0.112) / 0.048, 2)) *
    Math.exp(-Math.pow((y - 0.082) / 0.045, 2)) * fr;
  x += Math.sign(x) * 0.015 * cheek;
  z += 0.011 * cheek;

  return out.set(x, y, z);
}

function buildSkullGeometry() {
  const S = SKULL;
  const bone = new THREE.Color(BONE.skull).convertSRGBToLinear();
  const hollow = new THREE.Color(BONE.hollow).convertSRGBToLinear();
  const base = new THREE.Vector3();
  let dark = 0;

  const point = (u, v, out) => {
    skullBase(u, v, base);
    const x = base.x, y = base.y, z = base.z;
    const front = Math.cos(u);

    // Features displace along the ellipsoid normal at the base point.
    const nx = x / (S.rx * S.rx);
    const ny = (y - S.cy) / (S.ry * S.ry);
    const nz = (z - S.cz) / (S.rz * S.rz);
    const nl = Math.hypot(nx, ny, nz) || 1;

    const gate = smoothstep(0.16, 0.52, front);  // features are face-only
    let d = 0;
    dark = 0;

    // Eye socket: an ellipse intersected with a half plane whose edge slants
    // down toward the nose. That diagonal top edge is the whole glare, and a
    // plain oval socket loses the expression completely.
    const ax = (Math.abs(x) - S.eyeX) / S.eyeA;
    const by = (y - S.eyeY) / S.eyeB;
    // 0.60 is measured off the photo. The first pass used 0.95 and the ridge
    // it implies runs clean over the top of the skull and turns the cranium
    // into a teardrop.
    const slantTop = 0.32 + 0.60 * ax;
    const socket =
      smoothstep(0, 1, clamp01((1 - Math.hypot(ax, by)) / 0.26)) *
      smoothstep(0, 1, clamp01((slantTop - by) / 0.28)) * gate;
    // Shallow. A deeper well folds the surface back through itself and the
    // shading tears into black streaks along the rim.
    d -= 0.030 * socket;
    dark = Math.max(dark, smoothstep(0.10, 0.40, socket));

    // Brow ridge, riding just above the slant. The two sides meet in a V over
    // the nose bridge; that V is what the reference's scowl actually is.
    d += 0.018 *
      Math.exp(-Math.pow((by - (slantTop + 0.44)) / 0.50, 2)) *
      clamp01((1.25 - Math.abs(ax)) / 0.40) * gate;

    // Nose: a rounded triangle, apex up, its base notched into a shallow heart
    // the way the reference's is.
    const nax = x / 0.036;
    const nby = (y - S.noseY) / 0.036;
    const nBase = -1 + 0.45 * clamp01(1 - Math.abs(nax));
    const nose =
      smoothstep(0, 1, clamp01((((1 - nby) / 2) - Math.abs(nax)) / 0.30)) *
      smoothstep(0, 1, clamp01((nby - nBase) / 0.30)) * gate;
    d -= 0.021 * nose;
    dark = Math.max(dark, smoothstep(0.04, 0.62, nose));

    // Nasal bridge between the sockets.
    d += 0.010 * Math.exp(-Math.pow(x / 0.028, 2)) *
      smoothstep(0.120, 0.170, y) * smoothstep(0.260, 0.210, y) * gate;

    out.set(x + (nx / nl) * d, y + (ny / nl) * d, z + (nz / nl) * d);
  };

  // Dense. The socket rim is a hard edge in both the surface and the colour,
  // and at 144 around it fell across two or three vertices and fringed into
  // black spikes. This is a static head on a hero prop; the triangles are cheap
  // next to getting the one feature everybody looks at to hold together.
  return blobGeometry(148, 224, point, (u, v, p, c) => c.copy(bone).lerp(hollow, dark));
}

// --- Ribcage ---------------------------------------------------------------
// Eight pairs, counted off the reference. Real skeletons have twelve; eight is
// what the photo has and twelve at this scale turns the chest into a comb.
// The top five close on the sternum, the last three are left free and their
// tips describe the costal margin.
//
// Columns: spine attachment height (chest-local), lateral half-width, half
// depth, how much of a half turn the rib sweeps, and how far it drops between
// the spine and its front end.
const RIBS = [
  [0.360, 0.122, 0.130, 0.93, 0.045, true],
  [0.330, 0.164, 0.145, 0.93, 0.060, true],
  [0.296, 0.191, 0.152, 0.93, 0.073, true],
  [0.258, 0.207, 0.157, 0.93, 0.086, true],
  [0.220, 0.215, 0.159, 0.93, 0.099, true],
  [0.182, 0.214, 0.155, 0.80, 0.132, false],
  [0.146, 0.205, 0.146, 0.70, 0.162, false],
  [0.112, 0.188, 0.131, 0.60, 0.190, false],
];
const RIB_Z = -0.012;   // where the barrel is centred front to back

function ribGeometry(side, [ySpine, halfW, halfD, arc, drop, attached]) {
  const pts = [];
  const N = 16;
  for (let k = 0; k <= N; k++) {
    const a = Math.PI * arc * (k / N);
    pts.push([
      side * halfW * Math.sin(a),
      ySpine - drop * (1 - Math.cos(a)) / 2,
      RIB_Z - halfD * Math.cos(a),
    ]);
  }
  const radius = (t) => {
    const base = 0.0205 - 0.0068 * t;
    const head = 1 + 0.45 * Math.exp(-Math.pow(t / 0.11, 2));   // the rib head
    // A free rib needs a real rounded tip; an attached one is buried in the
    // sternum, so it only needs enough of a roll-off to close cleanly.
    const w = attached ? 0.04 : 0.13;
    const over = Math.max(0, t - (1 - w)) / w;
    return base * head * Math.sqrt(Math.max(0.02, 1 - over * over));
  };
  return sweepTube(curveThrough(pts), radius, { along: 40, around: 16 });
}

// --- Pelvis ----------------------------------------------------------------
// One half of the butterfly, authored flat in XY around the pelvis centre and
// then bent forward at the edges. The outline is control points on a closed
// spline, so the iliac crest comes out as one smooth sweep.
//
// Clockwise from the sacroiliac corner: up over the crest, down the outer edge
// past the hip socket, round the ischium, in along the pubic ramus to the
// symphysis at the midline, then back up the pelvic brim.
const HIP_OUTLINE = [
  [0.036, 0.148],
  [0.112, 0.180],
  [0.178, 0.156],
  [0.212, 0.096],
  [0.216, 0.034],
  [0.202, -0.012],
  [0.196, -0.048],
  [0.168, -0.114],
  [0.126, -0.154],
  [0.070, -0.164],
  [0.026, -0.142],
  [0.012, -0.110],
  [0.034, -0.078],
  [0.082, -0.044],
  [0.106, 0.002],
  [0.082, 0.062],
  [0.052, 0.112],
];
// The obturator foramen. The reference has this hole and the big opening
// between the brim and the sacrum, and losing either one takes the butterfly
// with it.
const HIP_HOLE = [
  [0.108, -0.030],
  [0.156, -0.070],
  [0.152, -0.118],
  [0.104, -0.142],
  [0.060, -0.110],
  [0.062, -0.060],
];

// The sacrum, authored in the same flat XY as the hip bones: a wedge that is
// broad where the two blades bury into it and tapers away to the tail.
// Shoulder blade: a rounded triangle, point down. As a lens it read as a
// pancake stuck on the ribs; the corners are what make it a scapula.
const SCAPULA_OUTLINE = [
  [-0.052, 0.062],
  [0.020, 0.078],
  [0.062, 0.046],
  [0.048, -0.024],
  [0.012, -0.080],
  [-0.030, -0.030],
];

const SACRUM_OUTLINE = [
  [0, 0.108],
  [0.062, 0.090],
  [0.054, 0.020],
  [0.032, -0.050],
  [0, -0.090],
  [-0.032, -0.050],
  [-0.054, 0.020],
  [-0.062, 0.090],
];

export function createSkeletonRig({ scale = 1 } = {}) {
  const geometries = [];
  const keep = (g) => { geometries.push(g); return g; };

  const matBone = toyMaterial(BONE.body, { roughness: 0.80 });
  const matSkull = toyMaterial('#ffffff', { vertexColors: true, roughness: 0.78 });
  const matTooth = toyMaterial(BONE.tooth, { roughness: 0.60 });
  const matHollow = toyMaterial(BONE.hollow, { roughness: 0.95 });
  const materials = [matBone, matSkull, matTooth, matHollow];

  const mesh = (geo, parent, mat = matBone) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  };
  // Joints and the tilt nodes between them. A joint's own rotation stays at
  // identity in the rest pose per the contract, so every bit of the A-pose
  // splay lives on a tilt node underneath it instead.
  const node = (parent, name, [x = 0, y = 0, z = 0] = [], rot = null) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    if (rot) o.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    parent.add(o);
    return o;
  };
  // Every joint gets its ball centred exactly on the pivot. That is both the
  // reference's strongest style cue and the thing that makes the rig safe to
  // pose: a sphere on the axis of rotation cannot tear away from either bone.
  const bulb = (joint, r, sx = 1, sy = 1, sz = 1) => mesh(ballGeometry(r, sx, sy, sz), joint);

  const group = new THREE.Group();
  const joints = {};
  const shed = new Map();

  // --- Root and pelvis -----------------------------------------------------
  const root = node(group, 'root', [0, Y.hip, 0]);
  joints.root = root;

  // Pelvis local space has its origin at the hip line, so the outline's y is
  // offset up by the distance from the hip socket to the pelvis centre.
  const pelvis = node(root, 'pelvis', [0, 0.050, -0.010]);

  for (const side of [-1, 1]) {
    // Mirrored by reversing the loops rather than by negating x in place: a
    // straight negate flips the winding and the extruder triangulates the
    // result inside out.
    const flip = (loop) => (side < 0 ? loop.map(([x, y]) => [-x, y]).reverse() : loop);
    const half = plateGeometry(
      flip(HIP_OUTLINE),
      [flip(HIP_HOLE)],
      { depth: 0.027, bevel: 0.0095 },
    );
    // Swung open on a vertical axis through the hip socket rather than bent
    // per vertex. Bending was the first attempt and it makes the extruder's
    // flat cap non planar, at which point its very coarse triangulation starts
    // showing as facets right across the widest, flattest surface on the model.
    // Rotating leaves the cap planar and the pelvis reads as the same bowl.
    const PIVOT = 0.100;
    half.translate(-side * PIVOT, 0, 0);
    const blade = mesh(half, pelvis);
    blade.position.x = side * PIVOT;
    blade.rotation.y = -side * 0.34;
  }

  // Sacrum: a wedge at the back of the midline, deliberately oversized so the
  // inner corners of both blades bury into it and there is no seam to see.
  // Sacrum: broad at the top where the blades bury into it, tapering to the
  // tail. A ball was quicker and read as a pudding sitting in the bowl.
  const sacrum = mesh(
    plateGeometry(SACRUM_OUTLINE, [], { depth: 0.044, bevel: 0.015, samples: 90 }),
    pelvis,
  );
  sacrum.position.set(0, 0.040, -0.052);
  sacrum.rotation.x = -0.20;

  // --- Spine ---------------------------------------------------------------
  const spineLower = node(root, 'spineLower', [0, Y.waist - Y.hip, -0.026]);
  joints.spineLower = spineLower;
  const spineUpper = node(spineLower, 'spineUpper', [0, Y.chest - Y.waist, 0.012]);
  joints.spineUpper = spineUpper;

  // Lumbar: fat drums with a knob out each side, which the reference shows
  // clearly because nothing sits in front of them.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const y = 0.008 + i * 0.040;
    const v = mesh(drumGeometry(0.044 - 0.004 * t, 0.028, 0.011), spineLower);
    v.position.set(0, y, 0.004 * i);
    for (const s of [-1, 1]) {
      const knob = mesh(ballGeometry(0.013, 1, 0.7, 1.5), spineLower);
      knob.position.set(s * 0.042, y + 0.004, -0.010 + 0.004 * i);
    }
  }

  // Thoracic: inside the ribcage and only really seen from behind, so they are
  // plain drums sitting where the rib heads land.
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const v = mesh(drumGeometry(0.036 - 0.007 * t, 0.026, 0.010), spineUpper);
    v.position.set(0, 0.012 + i * 0.048, -0.150 + 0.090 * t * t);
    const spine = mesh(ballGeometry(0.015, 0.8, 1.3, 1.7), spineUpper);
    spine.position.set(0, 0.002 + i * 0.048, -0.186 + 0.104 * t * t);
  }

  const neck = node(spineUpper, 'neck', [0, Y.neck - Y.chest, -0.058]);
  joints.neck = neck;
  for (let i = 0; i < 4; i++) {
    const v = mesh(drumGeometry(0.031 - 0.002 * i, 0.029, 0.011), neck);
    v.position.set(0, 0.010 + i * 0.043, 0.002 * i);
  }
  const head = node(neck, 'head', [0, Y.head - Y.neck, 0.018]);
  joints.head = head;

  // --- Head ----------------------------------------------------------------
  mesh(buildSkullGeometry(), head, matSkull);

  // Ask the skull surface itself where the alveolar arch is, rather than
  // guessing a radius: the maxilla push moves it and a hard-coded arch drifts
  // off the jaw line every time that number is touched.
  const probe = new THREE.Vector3();
  const toothV = (() => {
    let lo = 0.001, hi = 0.5;
    for (let i = 0; i < 32; i++) {
      const m = (lo + hi) / 2;
      skullBase(0, m, probe);
      if (probe.y < SKULL.toothY) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  })();

  // Upper row. Eleven of them, small and square. Fewer and larger was tried and
  // reads as a jack-o'-lantern rather than a skull.
  //
  // The mouth is left slightly ajar at rest, as the reference's is: a closed
  // one loses the dark line that makes the two rows read as two rows.
  const UPPER_TEETH = 11;
  const upperArch = [];
  for (let i = 0; i < UPPER_TEETH; i++) {
    const u = -0.82 + (1.64 * i) / (UPPER_TEETH - 1);
    skullBase(u, toothV, probe);
    const dx = probe.x;
    const dz = probe.z - SKULL.cz;
    const len = Math.hypot(dx, dz) || 1;
    const x = probe.x - (dx / len) * 0.005;
    const z = probe.z - (dz / len) * 0.005;
    const yaw = Math.atan2(dx, dz);
    upperArch.push([x, z, yaw]);
    const t = mesh(nubGeometry(0.0090, 0.0155, 0.0070), head, matTooth);
    t.position.set(x, 0.0429, z);
    t.rotation.y = yaw;
  }

  // The dark behind the teeth. A shallow blob rather than a hollowed skull: the
  // gap between the rows is a couple of millimetres and all it needs is
  // something dark sitting just behind it.
  const cavity = mesh(ballGeometry(1, 0.064, 0.030, 0.058), head, matHollow);
  cavity.position.set(0, 0.018, 0.076);
  cavity.castShadow = false;

  // Jaw. Hinged at the condyles, separate geometry, so it can drop.
  //
  // CONTRACT NOTE: the contract says the jaw "hinges open around local -X".
  // With the rest pose facing +Z the chin sits below and in front of the hinge,
  // so the rotation that swings it down is a POSITIVE rotation.x; negative
  // rotation.x drives the chin up into the skull. Positive is what is
  // implemented, and userData records it so a caller does not have to guess.
  const jaw = node(head, 'jaw', [0, 0.077, -0.050]);
  jaw.userData.openAxis = 'x';
  jaw.userData.openSign = 1;
  joints.jaw = jaw;

  // The mandible is a thin, deep bar and not the slab the first pass made it.
  // Measured off the photo, the whole mouth from the alveolar arch to the point
  // of the chin is 0.037 of standing height, and the upper crowns, the gap and
  // the lower crowns account for all but 0.008 of it. Deepening the jaw to make
  // it read from the game's high camera pushed the head 11% over the
  // reference's, which is the single thing that made the figure look wrong.
  const JW = 0.102;    // half-width of the mandible at the angle of the jaw
  const jawBody = curveThrough([
    [-JW, -0.0930, 0.043],
    [-0.098, -0.0962, 0.113],
    [-0.077, -0.0982, 0.171],
    [-0.040, -0.0992, 0.199],
    [0, -0.0996, 0.2075],
    [0.040, -0.0992, 0.199],
    [0.077, -0.0982, 0.171],
    [0.098, -0.0962, 0.113],
    [JW, -0.0930, 0.043],
  ]);
  mesh(
    sweepTube(jawBody, (t) => {
      // Deeper through the chin, shallower at the back, and taller than it is
      // deep everywhere: a round tube here reads as a wire coat hanger.
      const front = Math.sin(Math.PI * t);
      return [0.013 + 0.008 * front, 0.0105 + 0.004 * front];
    }, { along: 56, around: 18, up: [0, 1, 0] }),
    jaw,
  );

  for (const side of [-1, 1]) {
    // Ascending ramus up to the condyle.
    mesh(
      sweepTube(
        curveThrough([
          [side * JW, -0.096, 0.041],
          [side * 0.107, -0.062, 0.008],
          [side * 0.111, -0.024, -0.010],
          [side * 0.110, 0.000, -0.006],
        ]),
        shaftProfile(0.016, { endA: 1.22, endB: 1.28, waist: 0.10 }),
        { along: 26, around: 16 },
      ),
      jaw,
    );
    const condyle = mesh(ballGeometry(0.023, 1.15, 1, 1), jaw);
    condyle.position.set(side * 0.110, 0, -0.002);
  }

  // Lower row, riding the same arch pulled in a little.
  const LOWER_TEETH = 9;
  for (let i = 0; i < LOWER_TEETH; i++) {
    const [ux, uz, ua] = upperArch[Math.round((i / (LOWER_TEETH - 1)) * (UPPER_TEETH - 1))];
    const t = mesh(nubGeometry(0.0092, 0.0175, 0.0070), jaw, matTooth);
    t.position.set(ux * 0.93, -0.0748, (uz - SKULL.cz) * 0.93 + SKULL.cz + 0.050);
    t.rotation.y = ua;
  }

  // --- Ribcage, sternum, shoulder girdle -----------------------------------
  for (let i = 0; i < RIBS.length; i++) {
    for (const side of [-1, 1]) {
      const rib = mesh(ribGeometry(side, RIBS[i]), spineUpper);
      rib.name = `rib${side < 0 ? 'L' : 'R'}${i + 1}`;
      // Every rib is detachable. Dropping one leaves a gap between its
      // neighbours and a complete vertebra where it was attached, so nothing
      // reads as a hole in the model.
      shed.set(rib.name, rib);
    }
  }

  // Sternum: a flat strip, widest through the manubrium and tapering to a point
  // at the xiphoid. Swept with a flattened section rather than modelled round,
  // since the reference's is a plate sitting proud of the rib ends.
  mesh(
    sweepTube(
      curveThrough([[0, 0.146, 0.149], [0, 0.212, 0.144], [0, 0.298, 0.128], [0, 0.376, 0.112]]),
      (t) => [0.017 + 0.022 * smoothstep(0.0, 0.66, t) - 0.005 * smoothstep(0.86, 1.0, t), 0.017],
      { along: 40, around: 20, up: [0, 0, 1] },
    ),
    spineUpper,
  );

  for (const side of [-1, 1]) {
    // Clavicle: an S from the top of the sternum out to the shoulder ball. A
    // straight strut here is the single fastest way to make a chest look wrong.
    mesh(
      sweepTube(
        curveThrough([
          [side * 0.016, 0.356, 0.110],
          [side * 0.086, 0.348, 0.128],
          [side * 0.164, 0.340, 0.100],
          [side * 0.222, 0.337, 0.050],
          [side * 0.252, 0.336, 0.014],
        ]),
        shaftProfile(0.0145, { endA: 1.32, endB: 1.38, waist: 0.12 }),
        { along: 34, around: 16 },
      ),
      spineUpper,
    );
    // Scapula, a lens behind the shoulder. It barely shows from the front and
    // carries the whole back view.
    const blade = mesh(
      plateGeometry(
        side < 0 ? SCAPULA_OUTLINE.map(([x, y]) => [-x, y]).reverse() : SCAPULA_OUTLINE,
        [],
        { depth: 0.026, bevel: 0.009, samples: 80 },
      ),
      spineUpper,
    );
    blade.position.set(side * 0.146, 0.232, -0.182);
    blade.rotation.set(0.12, side * 0.44, side * 0.30);
  }

  // --- Arms ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const shoulder = node(spineUpper, `shoulder${S}`, [side * X.shoulder, 0.336, 0.010]);
    joints[`shoulder${S}`] = shoulder;
    bulb(shoulder, 0.040);

    mesh(
      sweepTube(
        curveThrough([
          [0, 0, 0],
          [side * ARM.outElbow * 0.26, -ARM.dropElbow * 0.25, 0.006],
          [side * ARM.outElbow * 0.52, -ARM.dropElbow * 0.50, 0.009],
          [side * ARM.outElbow * 0.77, -ARM.dropElbow * 0.75, 0.007],
          [side * ARM.outElbow, -ARM.dropElbow, 0.004],
        ]),
        shaftProfile(0.0262, { endA: 1.32, endB: 1.28, waist: 0.15 }),
        { along: 40, around: 18 },
      ),
      shoulder,
    );

    const elbow = node(shoulder, `elbow${S}`, [side * ARM.outElbow, -ARM.dropElbow, 0.004]);
    joints[`elbow${S}`] = elbow;
    bulb(elbow, 0.032, 1.18, 1, 1);

    // Radius and ulna. One fat bone is quicker but the pair is what makes a
    // forearm read as a forearm at three quarters.
    const fore = (off, r, endA, endB) =>
      mesh(
        sweepTube(
          curveThrough([
            [0, -0.004, off],
            [side * ARM.outWrist * 0.34, -ARM.dropWrist * 0.34, off * 0.85 + 0.004],
            [side * ARM.outWrist * 0.68, -ARM.dropWrist * 0.68, off * 0.5 + 0.006],
            [side * ARM.outWrist, -ARM.dropWrist, 0.004],
          ]),
          shaftProfile(r, { endA, endB, waist: 0.14 }),
          { along: 34, around: 16 },
        ),
        elbow,
      );
    fore(0.017, 0.0215, 1.25, 1.30);
    fore(-0.017, 0.0160, 1.30, 1.20);

    const wrist = node(elbow, `wrist${S}`, [side * ARM.outWrist, -ARM.dropWrist, 0.004]);
    joints[`wrist${S}`] = wrist;
    bulb(wrist, 0.026, 1.15, 0.9, 1);

    // Hand: a flat palm and four stubby digits. The reference's hands are
    // barely articulated and trying for knuckle-by-knuckle detail at this size
    // only produces mush.
    mesh(
      sweepTube(
        curveThrough([[0, -0.006, 0.002], [0, -0.030, 0.006], [side * 0.004, -0.052, 0.004]]),
        (t) => [0.027 + 0.012 * Math.sin(Math.PI * t), 0.0150],
        { along: 18, around: 18, up: [0, 0, 1] },
      ),
      wrist,
    );
    // Digits hang off knuckles that belong to the palm, so shedding one leaves
    // a rounded stub rather than a cut face.
    const DIGITS = [
      [-0.026, -0.056, 0.004, -0.14, 0.060],
      [-0.009, -0.060, 0.006, -0.04, 0.067],
      [0.009, -0.059, 0.005, 0.05, 0.062],
      [0.031, -0.040, 0.002, 0.85, 0.044],   // thumb, off the side and shorter
    ];
    DIGITS.forEach(([dx, dy, dz, splay, len], k) => {
      const kx = side * dx;
      const knuckle = mesh(ballGeometry(0.0115), wrist);
      knuckle.position.set(kx, dy, dz);
      const tip = [
        kx + Math.sin(splay) * len * (k === 3 ? side : 1),
        dy - Math.cos(splay) * len,
        dz + 0.010 + 0.004 * k,
      ];
      const digit = mesh(
        sweepTube(
          curveThrough([
            [kx, dy, dz],
            [(kx + tip[0]) / 2, (dy + tip[1]) / 2 + 0.002, (dz + tip[2]) / 2 + 0.003],
            tip,
          ]),
          (t) => 0.0098 * (1 - 0.22 * t) *
            (1 + 0.20 * Math.exp(-Math.pow((t - 0.5) / 0.18, 2))) *
            Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.max(0, t - 0.82) / 0.18, 2))),
          { along: 18, around: 12 },
        ),
        wrist,
      );
      digit.name = `finger${S}${k + 1}`;
      shed.set(digit.name, digit);
    });
  }

  // --- Legs ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const hip = node(root, `hip${S}`, [side * X.hip, 0, 0.004]);
    joints[`hip${S}`] = hip;
    bulb(hip, 0.042);

    // Femur. The first two control points are the neck: the head sits in the
    // socket and the shaft starts a little outboard of it, which is what gives
    // the reference its wide-set stance without splaying the whole leg.
    mesh(
      sweepTube(
        curveThrough([
          [0, 0, 0],
          [side * 0.024, -0.040, -0.006],
          [side * 0.036, -0.108, 0.008],
          [side * 0.038, -0.290, 0.020],
          [side * 0.034, -0.450, 0.014],
          [side * LEG.outKnee, -LEG.dropKnee, 0],
        ]),
        shaftProfile(0.0330, { endA: 1.05, endB: 1.30, waist: 0.16, spread: 0.20 }),
        { along: 46, around: 20 },
      ),
      hip,
    );

    const knee = node(hip, `knee${S}`, [side * LEG.outKnee, -LEG.dropKnee, 0]);
    joints[`knee${S}`] = knee;
    // Wider than it is deep: the reference's knee is a squashed condyle, and a
    // plain sphere there makes the leg look like a doll's ball joint.
    bulb(knee, 0.041, 1.16, 1, 0.94);

    const shin = (off, r, endA, endB) =>
      mesh(
        sweepTube(
          curveThrough([
            [side * off, -0.006, off === 0 ? 0.004 : -0.010],
            [side * (LEG.outAnkle * 0.34 + off * 0.7), -LEG.dropAnkle * 0.34, 0.010],
            [side * (LEG.outAnkle * 0.70 + off * 0.4), -LEG.dropAnkle * 0.70, 0.008],
            [side * LEG.outAnkle, -LEG.dropAnkle, 0],
          ]),
          shaftProfile(r, { endA, endB, waist: 0.15 }),
          { along: 40, around: 18 },
        ),
        knee,
      );
    shin(0, 0.0302, 1.30, 1.22);
    shin(0.028, 0.0135, 1.20, 1.15);   // fibula, outboard and thin

    const ankle = node(knee, `ankle${S}`, [side * LEG.outAnkle, -LEG.dropAnkle, 0]);
    joints[`ankle${S}`] = ankle;
    bulb(ankle, 0.032, 1.1, 1, 1);

    // Foot. Toed out, as the reference's are, on a node under the ankle so the
    // ankle joint itself stays axis aligned.
    // Lifted 4mm: the sole of the swept foot dips just below its lowest
    // control point, and the contract wants the soles exactly on y = 0.
    const foot = node(ankle, `foot${S}`, [0, 0.004, 0], [0, side * 0.20, 0]);
    mesh(
      sweepTube(
        curveThrough([
          [0, -0.062, -0.062],
          [0, -0.086, -0.010],
          [0, -0.096, 0.038],
          [0, -0.098, 0.074],
        ]),
        (t) => [0.040 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.3)), 0.046 - 0.019 * t],
        { along: 26, around: 20, up: [0, 1, 0] },
      ),
      foot,
    );
    const heel = mesh(ballGeometry(1, 0.040, 0.040, 0.034), foot);
    heel.position.set(0, -0.082, -0.070);

    for (let k = 0; k < 5; k++) {
      const f = k / 4;
      const x = -0.040 + 0.020 * k;
      const r = 0.0135 - 0.0035 * f;
      mesh(
        sweepTube(
          curveThrough([
            [x, -0.100, 0.062],
            [x * 1.08, -0.108, 0.092],
            [x * 1.14, -0.111, 0.118 - 0.016 * f],
          ]),
          (t) => r * (1 - 0.16 * t) * Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.max(0, t - 0.72) / 0.28, 2))),
          { along: 14, around: 12 },
        ),
        foot,
      );
    }
  }

  // A stain under the feet. The scene's one shadow-casting light comes in at an
  // angle, so without this the figure reads as hovering. It is parented to the
  // group at the ground plane and left on userData: whoever animates the rig
  // owns whether it is visible while the skeleton is underground.
  const contact = contactShadow({ radius: 0.62, opacity: 0.36, softness: 0.62 });
  group.add(contact);
  group.userData.contactShadow = contact;

  group.scale.setScalar(scale);

  return {
    group,
    joints,
    shed,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      contact.userData.dispose();
      // Shed bones may have been reparented into the scene by now, so cut them
      // loose from wherever they ended up rather than only clearing the group.
      for (const bone of shed.values()) bone.removeFromParent();
      group.clear();
    },
  };
}
