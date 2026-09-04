import * as THREE from 'three';
import { registerStone, inkText, inkCross } from '../tombstones.js';

// The boulder: a rough natural fieldstone stood on end, with one face dressed
// flat and a shallow panel cut into it for the inscription.
//
// Every other stone in the yard was cut to a shape before it was carved. This
// one was found in a field, tipped upright and worked in exactly one place.
// That contrast is the whole identity, and it is carried by two things, both of
// which had a cheaper wrong answer that the renders threw out.
//
// 1. FACETS, NOT NOISE. A rock reads as a rock through a few large planes
//    meeting at soft arrises, not through fine displacement. So the mass is a
//    literal intersection of half spaces, softened: eleven planes, and the
//    surface is the p-norm
//
//        R(u) = ( sum_i max(0, u.n_i / d_i)^P ) ^ (-1/P)
//
//    which is the exact polyhedron as P goes to infinity and a rounded version
//    of it at any finite P. The arris radius is about d/P, so P = 7 on a stone
//    half a metre through gives a 60 mm roll, which is the same fat quarter
//    round the registry's own sweep puts on every other stone in the set. It is
//    a radial function of direction alone, so it can never self intersect, its
//    tessellation is a plain quad grid, and its normals come off the
//    parametrisation rather than out of computeVertexNormals.
//
//    A displaced sphere was tried first and it is the failure the brief warned
//    about: at four low frequency waves it is dirtpile's clod, which is a lump
//    of earth and not a rock, and at anything higher it is film grain that
//    aliases at scene distance. What separates this from that is that the
//    surface here is FLAT over large areas. The only high frequency content on
//    the piece is the panel's rim, which is the one edge that is meant to be
//    sharp.
//
// 2. THE DRESSED PANEL IS A POCKET, NOT A DECAL. It is milled into the rock
//    along the panel normal: a flat floor 26 mm below the surrounding rock, a
//    10 mm roll off the floor, a short vertical wall, and a 14 mm roll where
//    the wall meets the rough stone. The mesh runs continuously through all
//    four, so the boundary is real geometry that turns in the light rather than
//    a line in a texture, and it is the only crisp edge on the piece.
//
//    A convex body cannot have a recess, which is the trap here: the p-norm
//    surface is convex by construction, so the pocket cannot be a plane pushed
//    in. It is built instead as a run of rings that leave the panel plane,
//    climb the wall and rejoin the convex surface at a curve found by
//    intersection rather than by assumption -- wallTop() below bisects for it,
//    and fitOutline() shrinks the pocket until every column of it clears. Two
//    seeds in the first batch had the rock's own surface fall inside the panel
//    plane at a corner, which without that check is a panel poking out through
//    the back of the rock it is cut into.
//
// LEAN. The camera is orthographic, 45 degrees round and 29 degrees up, so a
// plumb face pointed at it presents 0.875 of itself and a face tipped back 29
// degrees presents all of it. The panel is tipped back 20, which buys 0.985
// and is also simply what a fieldstone stood on end does. The inscription is
// therefore on a face that is very nearly square to the camera, which is the
// whole reason this design can carry the registry's flat face texture at all.

const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// --- the panel -------------------------------------------------------------
//
// PW and PH are the registry's halfWidth and height/2: the bounding box of the
// pocket, and therefore the rectangle the face texture is mapped onto. They are
// also what fixes the physical size of the carving, since the registry's groove
// wall is 1.1% of the face texture's height whatever that height is: at
// 2 * PH = 0.54 that is a 5.9 mm wall, between book.js's 8.8 and stump.js's
// 3.1. A rough stone's inscription being a shade finer than the family's is the
// right side to be out on.
//
// 0.50 by 0.54 is a little over half the width of the rock and a half of its
// height, which is what a mason dressing one face of a found stone actually
// leaves: a worked patch with a rough margin all round it, not a planed front.
const PW = 0.25;
const PH = 0.27;
// Where the panel points. Tipped back 20 degrees (see the header) and skewed 7
// degrees off the family's front, because a found stone's flat face does not
// line up with anything and a hair of skew is free legibility at the set's own
// camera azimuth.
const PANEL_AZ = 7 * DEG;
const PANEL_EL = 20 * DEG;
// The panel plane's distance from the rock's centre. SMALL on purpose: the
// nearer the plane, the deeper the cut and the wider the flat facet it leaves,
// and the facet has to be comfortably bigger than the pocket or the pocket's
// corners hang out in space. At 0.235 against side planes near 0.46 the facet
// runs to about 60 degrees off the panel normal and the pocket to 55.
const DP = 0.235;
const RECESS = 0.026;  // how far the panel floor sits below the rough surface
const FILLET = 0.010;  // roll off the floor onto the wall
const ARRIS = 0.016;   // roll where the wall meets the rough rock

// The pocket's outline, in panel coordinates: a superellipse, which at k = 3.2
// is a rectangle with generously rounded corners -- a chiselled patch rather
// than a lozenge or a tile. The corners matter: at the bbox corner the panel
// plane is 57 degrees off axis and the rock has started to turn away, so a
// square patch is exactly the shape that cannot clear.
const OUT_AX = 0.865;
const OUT_AY = 0.865;
const OUT_K = 3.2;

// --- the mass --------------------------------------------------------------
//
// Eleven planes, as (azimuth, elevation, distance). Azimuth is measured from
// the family's front (+z) toward +x, elevation from the horizon. Distances are
// from the rock's centre, so the sums of opposite pairs are roughly the extents:
// about 0.95 across, 0.72 through and 1.06 tall before the arris rolls eat into
// them.
//
// The list is not random. A boulder that has been stood on end has a broad flat
// bottom (it would not stand otherwise), two big flanks, a back, and a top made
// of two planes meeting in a ridge rather than one cap -- a single top plane
// gives a stone that reads as sawn off, which is stump.js's silhouette and not
// this one. The rest are the chamfers between.
const PLANES = [
  { az: 186, el: 4, d: 0.395 },    // back
  { az: -80, el: 8, d: 0.470 },    // left flank
  { az: 86, el: -4, d: 0.480 },    // right flank
  { az: 18, el: 64, d: 0.520 },    // top, front slope
  { az: 208, el: 56, d: 0.475 },   // top, back slope: the two make a ridge
  { az: 0, el: -88, d: 0.470 },    // the bottom it stands on
  { az: 6, el: -50, d: 0.455 },    // front chamfer down into the ground
  { az: -126, el: 22, d: 0.430 },  // back left
  { az: 130, el: 16, d: 0.445 },   // back right
  { az: -62, el: -32, d: 0.450 },  // left, below the flank
  { az: 58, el: 38, d: 0.470 },    // right shoulder
];
// Softening. The arris radius is roughly d/P, so 7 on these distances is a
// 60 to 70 mm roll: the same order as the registry's own 62 mm rim, which is
// what keeps this in the family. At 12 the piece came back as cut gemstone and
// at 4 as a pebble with no planes in it at all.
const P_NORM = 7;

// A very slow swell over the rough surface, three waves in DIRECTION rather
// than in position, so the whole thing stays a single valued radial function.
// 9 mm on a stone a metre tall: enough that a facet is not a machined plane,
// far too broad to be the fine displacement the brief bans. It is faded out
// over the dressed face, which is both correct (that face was worked) and
// necessary (the pocket's clearance is measured against this surface).
const SWELL = 0.009;

const SEG_A = 80;   // columns round the piece
const SEG_R = 32;   // rings from the pocket rim round to the back

// How deep the whole piece is buried. A found stone is bedded, not stood on the
// grass; the registry adds another 12 mm of its own sink on top of this.
const SINK = 0.055;

// --- the foot --------------------------------------------------------------
//
// A few small stones round the base. They are not decoration: a single convex
// mass meeting a flat floor along one clean curve reads as a prop set down on
// the ground, and three or four lumps half buried against it read as a stone
// that has been there long enough for the ground to come up round it.
const FOOT_MIN = 3;
const FOOT_MAX = 6;

// Initials rather than a phrase. A field boulder is the marker a parish put on
// a grave it could not afford a mason for, and two letters is what those carry.
// It is also the quietest mark available: the panel is the second smallest face
// in the set and the postmortem in tombstones.js is emphatic that the marks
// were never what carried a stone's identity.
const INITIALS = ['J.S.', 'A.H.', 'T.B.', 'R.C.', 'E.P.'];

// ---------------------------------------------------------------------------
// the p-norm rock

function dir(azDeg, elDeg) {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// The panel's frame. e3 is the panel normal, e2 is up ON the panel and e1 is
// panel-right, ordered so that e1 cross e2 is e3: seen from outside, +e1 runs
// the way +x runs on the family's front face, which is the direction slabUV
// maps to increasing u. Get that backwards and the inscription is mirrored.
function panelFrame(azSkew, elTilt) {
  const az = PANEL_AZ + azSkew;
  const el = PANEL_EL + elTilt;
  const e3 = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const e2 = new THREE.Vector3(0, 1, 0).addScaledVector(e3, -e3.y).normalize();
  const e1 = new THREE.Vector3().crossVectors(e2, e3).normalize();
  return { e1, e2, e3 };
}

function makeRock(rng) {
  const planes = PLANES.map((p) => ({
    n: dir(p.az + (rng() - 0.5) * 11, p.el + (rng() - 0.5) * 9),
    // Ten percent either way is the difference between two rocks and not
    // between two castings of one: it moves which facet dominates a corner, so
    // an arris that was a ridge on one seed is a blunt corner on the next.
    d: p.d * (0.90 + rng() * 0.20),
  }));
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const frame = panelFrame((rng() - 0.5) * 0.20, (rng() - 0.5) * 0.10);
  return { planes, ph, frame };
}

// Radius of the rough surface in a direction. The dressed face is exempt from
// the swell, which is why this takes the frame.
function radius(u, rock) {
  let s = 0;
  for (const p of rock.planes) {
    const t = u.dot(p.n) / p.d;
    if (t > 0) s += Math.pow(t, P_NORM);
  }
  const r = Math.pow(s, -1 / P_NORM);
  const worked = smoothstep(0.85, 1.30, Math.acos(clamp01(u.dot(rock.frame.e3))));
  const ph = rock.ph;
  const swell =
    0.55 * Math.sin(2.7 * u.x + ph[0]) +
    0.30 * Math.sin(2.3 * u.y + ph[1]) +
    0.28 * Math.sin(3.1 * u.z + ph[2]);
  return r * (1 + SWELL * swell * worked / 0.45);
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _uu = new THREE.Vector3();
const AXIS_A = new THREE.Vector3(0, 1, 0);
const AXIS_B = new THREE.Vector3(1, 0, 0);
const NEPS = 0.0035;

function surfacePoint(u, rock, out) {
  return out.copy(u).multiplyScalar(radius(u, rock));
}

// Normal from the parametrisation rather than from the plane sum, so the swell
// and the p-norm are differentiated together and there is nothing to keep in
// step. Two tangent steps and a cross product; this runs a few thousand times
// at build time and never again.
function surfaceNormal(u, rock, out) {
  _t1.crossVectors(u, Math.abs(u.y) < 0.9 ? AXIS_A : AXIS_B).normalize();
  _t2.crossVectors(u, _t1).normalize();
  surfacePoint(u, rock, _p0);
  surfacePoint(_uu.copy(u).addScaledVector(_t1, NEPS).normalize(), rock, _p1).sub(_p0);
  surfacePoint(_uu.copy(u).addScaledVector(_t2, NEPS).normalize(), rock, _p2).sub(_p0);
  out.crossVectors(_p1, _p2).normalize();
  if (out.dot(u) < 0) out.negate();
  return out;
}

// ---------------------------------------------------------------------------
// the pocket outline, in panel coordinates

function outlinePoint(phi, wob, scale) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const ax = PW * OUT_AX;
  const ay = PH * OUT_AY;
  const r = Math.pow(Math.pow(Math.abs(c) / ax, OUT_K) + Math.pow(Math.abs(s) / ay, OUT_K), -1 / OUT_K);
  // The chisel never ran straight. Three harmonics, small enough that the
  // outline is still recognisably the rectangle the texture is mapped onto.
  const k = 1 + 0.055 * Math.sin(2 * phi + wob[0]) + 0.038 * Math.sin(3 * phi + wob[1]) + 0.022 * Math.sin(5 * phi + wob[2]);
  return [r * c * k * scale, r * s * k * scale];
}

// Where the wall, run out from the panel floor at a given panel coordinate,
// leaves the rough surface. Bisected rather than assumed: the surface there is
// the p-norm's own blend of the panel plane with whatever is next to it, which
// is always a little inside the plane and by a different amount at every
// column.
function wallTop(px, py, rock, floorPlane) {
  const { e1, e2, e3 } = rock.frame;
  const base = new THREE.Vector3().addScaledVector(e3, floorPlane).addScaledVector(e1, px).addScaledVector(e2, py);
  const probe = new THREE.Vector3();
  const f = (s) => {
    probe.copy(base).addScaledVector(e3, s);
    const len = probe.length();
    return len - radius(_uu.copy(probe).divideScalar(len), rock);
  };
  let lo = 0;
  let hi = RECESS * 4;
  if (f(lo) > 0) return -1;    // the floor is already outside the rock
  if (f(hi) < 0) return hi;    // should not happen; caller treats it as a miss
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Shrink the pocket until every one of its columns has a wall with room for
// both rolls in it. Nothing here is a number somebody chose: the failure it
// catches is the pocket's corner landing outside the rock, and on a shape that
// is regenerated from eleven jittered planes per seed that has to be measured
// rather than trusted.
function fitOutline(rock, wob) {
  const need = FILLET + ARRIS * 0.5 + 0.004;
  let scale = 1;
  for (let attempt = 0; attempt < 14; attempt++) {
    const cols = [];
    let ok = true;
    for (let j = 0; j <= SEG_A; j++) {
      const phi = (j / SEG_A) * Math.PI * 2;
      const [px, py] = outlinePoint(phi, wob, scale);
      const s = wallTop(px, py, rock, DP - RECESS);
      if (s < need) { ok = false; break; }
      cols.push({ phi, px, py, s });
    }
    if (ok) return { cols, scale };
    scale *= 0.94;
  }
  return null;
}

// ---------------------------------------------------------------------------
// mesh assembly
//
// One quad grid. Every ring below carries SEG_A + 1 columns, the last
// duplicating the first so the strip UVs can run 0 to 1 without relying on a
// wrap mode. Rings run from the middle of the panel floor, out over the roll,
// up the wall, round the arris and away over the rough rock to the back pole.
// A ring may be emitted twice at the same positions: that is the UV seam where
// the carved face region stops and the plain strip begins, and the quad band
// between the two copies has zero area.

class Sink {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.face = [];   // per vertex: is this in the carved face region
    this.idx = [];
    this.rings = 0;
  }

  ring(points) {
    const start = this.pos.length / 3;
    for (const p of points) {
      this.pos.push(p.p.x, p.p.y, p.p.z);
      this.nor.push(p.n.x, p.n.y, p.n.z);
      this.uv.push(p.u, p.v);
      this.face.push(p.face ? 1 : 0);
    }
    if (this.rings > 0) {
      const prev = start - points.length;
      for (let j = 0; j < points.length - 1; j++) {
        const a = prev + j;
        const b = start + j;
        const c = start + j + 1;
        const d = prev + j + 1;
        this.idx.push(a, b, d, b, c, d);
      }
    }
    this.rings++;
    return start;
  }
}

function buildBoulder(rock, wob, slabUV) {
  const { e1, e2, e3 } = rock.frame;
  const fit = fitOutline(rock, wob);
  if (!fit) return null;
  const floorPlane = DP - RECESS;

  // Everything the rings need, worked out once per column.
  const cols = fit.cols.map(({ phi, px, py, s }) => {
    // Outward normal of the outline in the panel plane, from the analytic
    // tangent of the superellipse: a finite difference of the outline itself,
    // which is exact enough at 80 columns and needs no special cases at the
    // superellipse's flat runs.
    const d = 0.004;
    const a = outlinePoint(phi - d, wob, fit.scale);
    const b = outlinePoint(phi + d, wob, fit.scale);
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    // Counter-clockwise outline, so (ty, -tx) points outward.
    const nx = ty / tl;
    const ny = -tx / tl;
    const nWall = new THREE.Vector3().addScaledVector(e1, nx).addScaledVector(e2, ny).normalize();
    return { phi, px, py, s, nx, ny, nWall };
  });

  const sink = new Sink();
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();

  const panelPoint = (px, py, s, out) =>
    out.set(0, 0, 0).addScaledVector(e3, floorPlane + s).addScaledVector(e1, px).addScaledVector(e2, py);
  const faceUV = (px, py) => slabUV(px, py + PH, true);

  // --- the floor -----------------------------------------------------------
  // Dead flat, and the only part of the piece that is. Rings scale the outline,
  // pulled in by the roll's radius, from the middle out.
  const FLOOR_RINGS = 4;
  for (let i = 0; i <= FLOOR_RINGS; i++) {
    const t = Math.pow(i / FLOOR_RINGS, 0.82);
    sink.ring(cols.map((c) => {
      const px = (c.px - c.nx * FILLET) * t;
      const py = (c.py - c.ny * FILLET) * t;
      const [u, v] = faceUV(px, py);
      return { p: panelPoint(px, py, 0, new THREE.Vector3()), n: e3.clone(), u, v, face: true };
    }));
  }

  // --- the roll off the floor ---------------------------------------------
  const ROLL_RINGS = 3;
  for (let i = 1; i <= ROLL_RINGS; i++) {
    const th = (i / ROLL_RINGS) * (Math.PI / 2);
    const inset = FILLET * (1 - Math.sin(th));
    const rise = FILLET * (1 - Math.cos(th));
    sink.ring(cols.map((c) => {
      const px = c.px - c.nx * inset;
      const py = c.py - c.ny * inset;
      const [u, v] = faceUV(px, py);
      const n = c.nWall.clone().multiplyScalar(Math.sin(th)).addScaledVector(e3, Math.cos(th)).normalize();
      return { p: panelPoint(px, py, rise, new THREE.Vector3()), n, u, v, face: true };
    }));
  }

  // The seam. Same positions again, this time parked in the plain strip: the
  // carved region ends at the top of the roll, and without a duplicated ring
  // the quad that crosses out of it would smear a letter up the wall.
  const seamRing = cols.map((c) => ({
    p: panelPoint(c.px, c.py, FILLET, new THREE.Vector3()),
    n: c.nWall.clone(),
  }));
  sink.ring(seamRing.map((r, j) => ({ p: r.p.clone(), n: r.n.clone(), u: j / SEG_A, v: 0, face: false })));

  // --- the wall ------------------------------------------------------------
  const WALL_RINGS = 2;
  for (let i = 1; i <= WALL_RINGS; i++) {
    sink.ring(cols.map((c, j) => {
      const top = c.s - ARRIS * 0.5;
      const s = FILLET + (top - FILLET) * (i / WALL_RINGS);
      return { p: panelPoint(c.px, c.py, s, new THREE.Vector3()), n: c.nWall.clone(), u: j / SEG_A, v: 0, face: false };
    }));
  }

  // --- the arris where the wall meets the rough rock ------------------------
  //
  // A quadratic through the corner. A is the top of the wall pulled back by
  // half the roll, B is a point out on the rough surface the same distance
  // past the corner, and the corner itself is the control point, so the band
  // is a real fillet of about ARRIS rather than a normal-only cheat. This is
  // the crisp edge of the piece: 16 mm, which is half a pixel at scene scale
  // and about five at the size a reviewer looks at it.
  const arrisCols = cols.map((c) => {
    const A = panelPoint(c.px, c.py, c.s - ARRIS * 0.5, new THREE.Vector3());
    const K = panelPoint(c.px, c.py, c.s, new THREE.Vector3());
    // Walk out along the rough surface, away from the panel, by the same
    // amount: rotate the corner's own direction away from the panel normal.
    const uK = K.clone().normalize();
    const aK = Math.acos(clamp01(uK.dot(e3)));
    const tangent = new THREE.Vector3().addScaledVector(e1, Math.cos(c.phi)).addScaledVector(e2, Math.sin(c.phi)).normalize();
    const step = ARRIS / Math.max(0.15, K.length());
    const uB = e3.clone().multiplyScalar(Math.cos(aK + step)).addScaledVector(tangent, Math.sin(aK + step)).normalize();
    const B = surfacePoint(uB, rock, new THREE.Vector3());
    const nB = surfaceNormal(uB, rock, new THREE.Vector3());
    return { A, K, B, nB, uB, aK: aK + step, tangent };
  });
  const ARRIS_RINGS = 3;
  for (let i = 1; i <= ARRIS_RINGS; i++) {
    const t = i / ARRIS_RINGS;
    sink.ring(arrisCols.map((a, j) => {
      const it = 1 - t;
      const p = a.A.clone().multiplyScalar(it * it)
        .addScaledVector(a.K, 2 * t * it)
        .addScaledVector(a.B, t * t);
      const w = smoothstep(0, 1, t);
      const n = cols[j].nWall.clone().multiplyScalar(1 - w).addScaledVector(a.nB, w).normalize();
      return { p, n, u: j / SEG_A, v: 0, face: false };
    }));
  }

  // --- the rough rock ------------------------------------------------------
  //
  // Rings of constant angle off the panel normal, starting from the curve the
  // arris left off at and closing at the back pole. The start angle varies by
  // column, so the grid conforms to the pocket rather than crossing it.
  for (let i = 1; i <= SEG_R; i++) {
    const t = i / SEG_R;
    // Eased so rings crowd a little near the pocket, where the eye is, and
    // stretch out round the back where nothing happens.
    const g = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    sink.ring(arrisCols.map((a, j) => {
      const ang = a.aK + (Math.PI - a.aK) * g;
      const u = e3.clone().multiplyScalar(Math.cos(ang)).addScaledVector(a.tangent, Math.sin(ang)).normalize();
      const p = surfacePoint(u, rock, new THREE.Vector3());
      const n = surfaceNormal(u, rock, new THREE.Vector3());
      return { p, n, u: j / SEG_A, v: 0, face: false };
    }));
  }

  return sink;
}

// ---------------------------------------------------------------------------
// the small stones at the foot: the same generator, fewer planes, no pocket

function footStone(rng, seg, ringN) {
  const planes = [];
  const n = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    // Golden-angle spiral over the sphere so a handful of planes still enclose
    // a volume: drawn independently they clump and leave the body open on one
    // side, which the p-norm answers with a spike.
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963 + rng() * 0.9;
    planes.push({
      n: new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th)).normalize(),
      d: 0.42 + rng() * 0.22,
    });
  }
  const rock = { planes, ph: [rng() * 6.283, rng() * 6.283, rng() * 6.283], frame: { e3: new THREE.Vector3(0, 1, 0) } };
  const sink = new Sink();
  for (let i = 0; i <= ringN; i++) {
    const ang = (i / ringN) * Math.PI;
    const pts = [];
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * Math.PI * 2;
      const u = new THREE.Vector3(Math.sin(ang) * Math.cos(phi), Math.cos(ang), Math.sin(ang) * Math.sin(phi));
      pts.push({
        p: surfacePoint(u, rock, new THREE.Vector3()),
        n: surfaceNormal(u, rock, new THREE.Vector3()),
        u: j / seg,
        v: 0,
        face: false,
      });
    }
    sink.ring(pts);
  }
  return sink;
}

function appendSink(dst, src, matrix) {
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const base = dst.pos.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.pos.length / 3; i++) {
    v.set(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]).applyMatrix4(matrix);
    dst.pos.push(v.x, v.y, v.z);
    v.set(src.nor[i * 3], src.nor[i * 3 + 1], src.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
    dst.nor.push(v.x, v.y, v.z);
    dst.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
    dst.face.push(src.face[i]);
  }
  for (const k of src.idx) dst.idx.push(base + k);
}

// ---------------------------------------------------------------------------

function buildStone({ body, material, rng, disposables, stripUV, slabUV, lean }) {
  // The registry's slab and its plinth both go. A boulder is one mass; the
  // slab's only remaining job is the texture atlas, whose carved region takes
  // its aspect from 2 * halfWidth / height, which is why those two numbers are
  // the panel's. Its geometry is still owned by the registry's dispose().
  for (const m of body.children.filter((o) => o.isMesh)) body.remove(m);

  const rock = makeRock(rng);
  const wob = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const sink = buildBoulder(rock, wob, slabUV);
  if (!sink) return;

  // A found stone is not plumb. Its own tilt, on top of the registry's, and
  // applied to the geometry rather than to a group so the seating below can
  // measure the real lowest point instead of a rotated bounding box -- which
  // is book.js's finding and the reason this walks vertices at all.
  //
  // Yaw is NOT among them: it would swing the dressed face away from the front,
  // and the front is where the camera is. Only the two tilts vary, and the face
  // keeps whatever skew its own frame was given.
  const tilt = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler((rng() - 0.5) * 0.10, 0, (rng() - 0.5) * 0.11, 'ZXY'),
  );

  const all = { pos: [], nor: [], uv: [], face: [], idx: [] };
  appendSink(all, sink, tilt);

  // The foot stones, placed round the base and half buried. Kept off the
  // front centre: a lump in front of the panel is the one place a small stone
  // can do harm.
  const feet = FOOT_MIN + Math.floor(rng() * (FOOT_MAX - FOOT_MIN + 1));
  for (let i = 0; i < feet; i++) {
    const s = 0.055 + rng() * 0.075;
    const th = (i / feet) * Math.PI * 2 + rng() * 0.8;
    const rad = 0.40 + rng() * 0.22;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(th) * rad, s * (0.30 + rng() * 0.30), Math.cos(th) * rad * 0.85),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.283, rng() * 6.283, rng() * 6.283)),
      new THREE.Vector3(s * 2.0, s * 1.35, s * 1.85),
    );
    appendSink(all, footStone(rng, 16, 9), m);
  }

  // --- seating -------------------------------------------------------------
  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < all.pos.length; i += 3) {
    if (all.pos[i] < low) low = all.pos[i];
    if (all.pos[i] > high) high = all.pos[i];
  }
  const dy = -SINK - low;
  for (let i = 1; i < all.pos.length; i += 3) all.pos[i] += dy;
  const top = high + dy;

  // --- the plain UVs -------------------------------------------------------
  //
  // Everything that is not the carved panel samples the texture's plain strip,
  // with v climbing with real height so the foot of the boulder and the stones
  // round it sit in the same grime band the family's plinths do.
  for (let i = 0; i < all.face.length; i++) {
    if (all.face[i]) continue;
    const [u, v] = stripUV(all.uv[i * 2] - 0.5, 0.03 + 0.94 * clamp01(all.pos[i * 3 + 1] / top), 0.5, 1);
    all.uv[i * 2] = u;
    all.uv[i * 2 + 1] = v;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
  geometry.setIndex(all.idx);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);
  disposables.push(geometry);

  // The registry's own lean still applies on top: it turns the whole body
  // about the origin, which is at the floor, so it is a stone settling in the
  // ground rather than a stone balanced on a corner. SINK covers the worst
  // corner it can lift.
  lean.sink -= 0.004;
}

registerStone('boulder', {
  // halfWidth and height are the DRESSED PANEL, not the rock: they set the face
  // texture's aspect and the slabUV mapping the panel samples through, exactly
  // as stump.js's tablet does. depth and plinth build a slab that extras throws
  // away, and are left at values the sweep cannot fold on. plinth is 0: a
  // boulder was never set on a pad.
  shape: { halfWidth: PW, height: PH * 2, depth: 0.20, plinth: 0 },
  topRadius: 0.062,
  bottomRadius: 0.062,

  // A small cross and two initials, both well inside the pocket's outline,
  // which wanders a little per seed. Letters about 0.10 world units tall, the
  // same as the family's; the cross is smaller than the one on `cross` because
  // this face is a third of that one's area and the brief for a found stone is
  // quiet.
  draw(ctx, w, h, rng) {
    inkCross(ctx, w / 2, h * 0.30, h * 0.255);
    const size = h * 0.295;
    inkText(ctx, INITIALS[Math.floor(rng() * INITIALS.length) % INITIALS.length], w / 2, h * 0.665, size, size * 0.05);
  },

  extras: buildStone,
});
