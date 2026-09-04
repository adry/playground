import * as THREE from 'three';
import M from '../metrics.js';

// The skull, built as a SCULPTED MESH rather than as a sampled field.
//
// Contract, unchanged from the file this can be swapped for:
//   buildSkull({ material }) -> { group, joints: { jaw }, dispose }
// Origin is the ATLAS. `joints.jaw` is identity with the mouth shut and opens
// on POSITIVE rotation.x (the chin is below and in FRONT of the hinge).
//
// WHY A MESH.
//
// Five passes shaped this head as one smooth implicit field, a superellipsoid
// vault driven by a profile curve, and five were rejected. A smooth field
// cannot state the four things that most say "skull" in the reference
// photograph, because each of them is a place where the surface has to fold
// back on itself or crease:
//
//   1. the SUPRAORBITAL RIDGE overhangs, so the orbit sits in its shadow;
//   2. the TEMPORAL FOSSA is a scooped hollow with a visible crest, the
//      temporal line, arcing up and back over it;
//   3. the ZYGOMATIC ARCH is a bridge with daylight behind it;
//   4. the MASTOID PROCESS is a lug that points down behind the ear.
//
// So this is built the way a modeller builds it:
//
//   CAGE -> SCULPT -> SUBDIVIDE -> SCULPT AGAIN -> CUT
//
//   * the CAGE is a cube-sphere, 6 x 14 x 14 quads, no poles and no seam,
//     lofted into the skull's gross silhouette from the lateral landmark
//     table. Getting this right is the whole job; nothing downstream rescues a
//     bad cage.
//   * SCULPT is a list of named anatomical operators, each a local statement
//     in world space ("the brow juts this far forward, here, and nothing below
//     it moves"). Because they move mesh vertices rather than bias a field,
//     an operator with a tight downward falloff produces a real overhang.
//   * SUBDIVIDE is two rounds of Catmull-Clark. That is where the soft vinyl
//     surface comes from: the cage carries the anatomy, the limit surface
//     rounds every edge of it. 1176 quads become 18816.
//   * the second SCULPT adds what subdivision would have smoothed away: the
//     temporal line's welt, the alveolar juga, the nasal sill.
//   * CUT drops the quads inside each opening's outline, snaps the surviving
//     rim onto the true curve, and welds a multi-ring wall and a closed bowl
//     behind it, so an orbit is a hole with a thickness and a dark interior
//     rather than a painted dent.
//
// Two techniques are lifted from the field build because they were right there:
// genuine cut holes with a walled rim and a bowl behind, and taking the skin's
// normals from something other than the cut mesh. Here that second one is
// simpler than a field gradient: normals are computed from the FULL, UNCUT
// quad topology and only then are the faces dropped, so a rim vertex is
// shaded by the surface it belongs to instead of by the hole beside it.
//
// WHERE THIS DISAGREES WITH `.ref/SKULL-ANATOMY.md`. The table is good and it
// is used for the whole midsagittal profile. It implies, by calling glabella
// "front of L", that the glabella is the most anterior point of the skull. In
// the photograph it is not: the nasal bones project a clear 0.03 of L past it.
// So the front silhouette here runs out to +0.632 at the rhinion. Craniometric
// length is glabella to opisthocranion by definition; that is a measuring
// convention, not a claim about the outline.

// ---------------------------------------------------------------- the frame

const ATLAS_Y = M.y.ribcageTop + M.neck.length;
const Y_CROWN = M.y.crown - ATLAS_Y;              // +0.3375
const Y_CHIN = M.y.chin - ATLAS_Y;                // -0.0800
const Y_BITE = Y_CHIN + M.skull.jawHeight;        // -0.0118, the occlusal plane
const L = M.skull.depth;                          //  0.44425, glabella..opisthocranion
const W = M.skull.width;                          //  0.34650
const HS = M.skull.height;                        //  0.41750, crown to chin

// The reference's porion frame: origin at the ear canal, +z forward, +y up,
// one unit = L. It comes out ISOTROPIC here because M.skull.height is 0.9398
// of M.skull.depth and the table's vertex-to-gnathion is 0.94, so pinning the
// crown pins the chin too. Every landmark below is read straight off the table.
const PORION_Y = Y_CROWN - 0.52 * L;              // +0.10649
const PORION_Z = -0.14 * L;                       // -0.06220
const LY = (t) => PORION_Y + t * L;
const LZ = (x) => PORION_Z + x * L;
const TY = (y) => (y - PORION_Y) / L;

// --------------------------------------------------------------- small math

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Monotone cubic (Fritsch-Carlson) through control points, extended linearly
// past both ends. Every control point is hit exactly and no landmark becomes an
// overshoot, which a plain Catmull-Rom does at a turning point: opisthocranion
// is exactly such a point and a spline that overshoots it puts a kink in the
// back of the head.
function mono(pts) {
  const n = pts.length;
  const m = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    if (i === 0 || i === n - 1) return (b[1] - a[1]) / (b[0] - a[0]);
    const sL = (p[1] - a[1]) / (p[0] - a[0]);
    const sR = (b[1] - p[1]) / (b[0] - p[0]);
    if (sL * sR <= 0) return 0;
    const t = (sL + sR) / 2;
    return Math.sign(t) * Math.min(Math.abs(t), 3 * Math.min(Math.abs(sL), Math.abs(sR)));
  });
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1] + (x - pts[0][0]) * m[0];
    if (x >= pts[n - 1][0]) return pts[n - 1][1] + (x - pts[n - 1][0]) * m[n - 1];
    let i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0];
    const t = (x - pts[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// -------------------------------------------------------------- the cage: y

// The cage's vertical extent. The top is the crown. The bottom is the lowest
// bone of the cranium, which without a mandible is the alveolar margin above
// the upper tooth crowns, at t = -0.232.
const T_TOP = 0.520;
const T_BOT = -0.232;
// The height of the maximum breadth, the parietal eminences. Measured off the
// front view of the photograph: the outline is widest 27% of the way down from
// the vertex, which is t = +0.312. High and, in profile, behind.
const T_MID = 0.312;
const Y_TOP = LY(T_TOP), Y_BOT = LY(T_BOT), Y_MID = LY(T_MID);
const HY_UP = Y_TOP - Y_MID, HY_DN = Y_MID - Y_BOT;

// q in [-1,1] is the cage's vertical parameter, taken straight from the
// direction's y so the cube-sphere has no pole to pinch. y is linear in q and
// the section shrinks to nothing at both ends like an ellipse, sqrt(1 - q^2),
// which makes both caps smooth paraboloids rather than cones. The skull's real
// vertical taper is NOT elliptical, and that is carried by the shape functions
// below instead, which divide the cap factor back out.
const yOfQ = (q) => (q >= 0 ? Y_MID + HY_UP * q : Y_MID + HY_DN * q);
const qOfT = (t) => (t >= T_MID ? (t - T_MID) / (T_TOP - T_MID) : (t - T_MID) / (T_MID - T_BOT));
const capOfQ = (q) => Math.sqrt(Math.max(0, 1 - q * q));

// ------------------------------------------------- the cage: the silhouettes

// The midsagittal outline, front and back, in table coordinates. These ARE the
// landmark table, with control points added between the landmarks so the curve
// between them is authored rather than hoped for. Landmarks are marked.
const Z_FRONT = mono([
  [-0.232, 0.548],
  [-0.180, 0.558],
  [-0.110, 0.572],   // nasospinale
  [-0.040, 0.606],
  [ 0.060, 0.630],
  [ 0.120, 0.632],   // rhinion: the nose is forward of the glabella
  [ 0.180, 0.624],
  [ 0.235, 0.585],   // nasion
  [ 0.280, 0.600],   // glabella
  [ 0.335, 0.552],
  [ 0.420, 0.412],
  [ 0.470, 0.300],
  [ 0.500, 0.212],   // bregma is at 0.51 / 0.20
  [ 0.512, 0.168],
  [ 0.520, 0.120],   // vertex
]);
const Z_BACK = mono([
  [-0.232, -0.055],
  [-0.180, -0.118],
  [-0.110, -0.188],
  [-0.040, -0.268],
  [ 0.060, -0.340],  // inion
  [ 0.120, -0.378],
  [ 0.180, -0.400],  // opisthocranion
  [ 0.235, -0.394],
  [ 0.280, -0.379],
  [ 0.335, -0.342],
  [ 0.420, -0.220],  // lambda
  [ 0.470, -0.112],
  [ 0.500, -0.020],
  [ 0.512,  0.048],
  [ 0.520,  0.120],  // vertex
]);

// Plan view. HALF_W is the section's true maximum half-width at each height, as
// a fraction of W/2, reached dead abeam. Above the ears it follows an ellipse
// closing on the crown; an earlier pass held it near full to t = 0.50 and the
// head came out as a rounded box with a lid.
//
// A CATMULL-CLARK LIMIT SURFACE SITS INSIDE ITS CAGE, by about 4.5% where the
// curvature is highest, which measured out as a braincase 8mm narrow at prop
// scale. SHRINK puts it back. It is a property of the subdivision, not of the
// anatomy, so it lives on its own line rather than being folded into the table.
const SHRINK = 1.048;
const HALF_W = mono([
  [-0.232, 0.34], [-0.180, 0.62], [-0.110, 0.83], [-0.040, 0.93],
  [ 0.060, 0.965], [ 0.180, 0.988], [ 0.312, 1.000], [ 0.420, 0.885],
  [ 0.470, 0.690], [ 0.500, 0.470], [ 0.512, 0.300], [ 0.520, 0.0],
]);
// How much the FRONT of the section is squeezed in relative to that maximum.
// This is the wedge: below eye level a skull is wide at the cranial base and
// narrow at the alveolar arch, and one symmetric superellipse cannot say so.
// It is written as a squeeze on the front rather than as a second width table
// because the maximum then stays exactly where HALF_W puts it, which is the
// number that has to come out right.
const NARROW = mono([
  [-0.232, 0.56], [-0.180, 0.52], [-0.110, 0.42], [-0.040, 0.24],
  [ 0.060, 0.12], [ 0.180, 0.14], [ 0.280, 0.32], [ 0.335, 0.28],
  [ 0.420, 0.06], [ 0.470, 0.10], [ 0.520, 0.0],
]);

// Roundness of the horizontal section. 2 is an ellipse; above 2 the section
// squares off, which is what the parietal region does above the ears and what
// the vault does NOT do at the crown.
const PLAN_P = mono([
  [-0.232, 2.25], [-0.110, 2.40], [ 0.060, 2.30], [ 0.180, 2.20],
  [ 0.312, 2.12], [ 0.470, 2.02], [ 0.520, 2.00],
]);

// The shape functions the loft actually evaluates: the true half-extent with
// the cap factor divided back out, sampled off the silhouettes above and
// tabulated once. Near the caps the cap factor goes to zero, so the sampling
// stops short of them and the monotone curve extends itself linearly; the
// product is zero there either way, so the extrapolated value cannot show.
const [SHAPE_D, SHAPE_ZC, SHAPE_W] = (() => {
  const dPts = [], zPts = [], wPts = [];
  for (let i = 0; i <= 48; i++) {
    const t = T_BOT + ((T_TOP - T_BOT) * i) / 48;
    const cap = capOfQ(qOfT(t));
    if (cap < 0.26) continue;
    const zf = Z_FRONT(t) * L + PORION_Z, zb = Z_BACK(t) * L + PORION_Z;
    dPts.push([t, (zf - zb) / 2 / cap]);
    zPts.push([t, (zf + zb) / 2]);
    wPts.push([t, (HALF_W(t) * W * SHRINK) / 2 / cap]);
  }
  return [mono(dPts), mono(zPts), mono(wPts)];
})();

// A cage point for a unit direction. theta is measured from +z (the face)
// toward +x (the figure's left).
function cagePoint(dx, dy, dz, out) {
  const q = clamp(dy, -1, 1);
  const y = yOfQ(q);
  const cap = capOfQ(q);
  const t = TY(y);
  const th = Math.atan2(dx, dz);
  const ct = Math.cos(th), st = Math.sin(th);
  const p = PLAN_P(t), e = 2 / p;
  // The front squeeze. It is zero dead abeam, so the section's true maximum is
  // exactly SHAPE_W and the anterior half tapers away from it toward the
  // midline: an alveolar arch below and a frontal bone above.
  const front = ct > 0 ? Math.pow(ct, 1.4) : 0;
  const halfW = SHAPE_W(t) * (1 - NARROW(t) * front) * cap;
  const halfD = SHAPE_D(t) * cap;
  const x = halfW * Math.sign(st) * Math.pow(Math.abs(st), e);
  const z = SHAPE_ZC(t) + halfD * Math.sign(ct) * Math.pow(Math.abs(ct), e);
  return out.set(x, y, z);
}

// ------------------------------------------------------------ the cube-sphere

// All quads, six faces, no pole and no seam. The tangent warp spaces the grid
// by equal angle instead of equal chord, which keeps the cells within about
// 15% of each other over the whole surface. Catmull-Clark is happiest on a mesh
// like that, and so is a cut outline crossing it at an arbitrary angle.
function cubeSphere(N) {
  const dirs = [];
  const faces = [];
  const map = new Map();
  const key = (x, y, z) => `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}`;
  const add = (x, y, z) => {
    const k = key(x, y, z);
    const hit = map.get(k);
    if (hit !== undefined) return hit;
    const id = dirs.length;
    dirs.push(new THREE.Vector3(x, y, z));
    map.set(k, id);
    return id;
  };
  const AX = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  ];
  const warp = (i) => Math.tan((Math.PI / 4) * ((2 * i) / N - 1));
  for (const [r, u, f] of AX) {
    const grid = [];
    for (let j = 0; j <= N; j++) {
      const b = warp(j);
      const row = [];
      for (let i = 0; i <= N; i++) {
        const a = warp(i);
        let x = r[0] * a + u[0] * b + f[0];
        let y = r[1] * a + u[1] * b + f[1];
        let z = r[2] * a + u[2] * b + f[2];
        const s = 1 / Math.hypot(x, y, z);
        row.push(add(x * s, y * s, z * s));
      }
      grid.push(row);
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        faces.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
      }
    }
  }
  // One consistent outward winding. Checked against the sphere, before any
  // shaping, where every face is guaranteed to face away from the centre.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (const f of faces) {
    a.subVectors(dirs[f[1]], dirs[f[0]]);
    b.subVectors(dirs[f[3]], dirs[f[0]]);
    n.crossVectors(a, b);
    if (n.dot(dirs[f[0]]) < 0) f.reverse();
  }
  return { dirs, faces };
}

// ------------------------------------------------------------ Catmull-Clark

// Textbook, for a closed mesh with no boundary. Face point, edge point, then
// the vertex rule (F + 2R + (n-3)P) / n. Every output face is a quad.
function catmullClark(pos, faces) {
  const V = pos.length, F = faces.length;
  const fp = new Array(F);
  for (let i = 0; i < F; i++) {
    const f = faces[i];
    const c = new THREE.Vector3();
    for (const v of f) c.add(pos[v]);
    fp[i] = c.multiplyScalar(1 / f.length);
  }
  const edges = new Map();
  const ekey = (a, b) => (a < b ? a * V + b : b * V + a);
  for (let i = 0; i < F; i++) {
    const f = faces[i];
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = ekey(a, b);
      let e = edges.get(key);
      if (!e) { e = { a, b, f: [] }; edges.set(key, e); }
      e.f.push(i);
    }
  }
  const out = new Array(V + F);
  for (let i = 0; i < F; i++) out[V + i] = fp[i];
  // Edge points.
  let next = V + F;
  for (const e of edges.values()) {
    const p = new THREE.Vector3().addVectors(pos[e.a], pos[e.b]);
    let w = 2;
    for (const fi of e.f) { p.add(fp[fi]); w++; }
    e.id = next++;
    out[e.id] = p.multiplyScalar(1 / w);
  }
  // Vertex points.
  const Fsum = new Array(V), Rsum = new Array(V), val = new Int32Array(V);
  for (let i = 0; i < V; i++) { Fsum[i] = new THREE.Vector3(); Rsum[i] = new THREE.Vector3(); }
  for (let i = 0; i < F; i++) for (const v of faces[i]) Fsum[v].add(fp[i]);
  const mid = new THREE.Vector3();
  for (const e of edges.values()) {
    mid.addVectors(pos[e.a], pos[e.b]).multiplyScalar(0.5);
    Rsum[e.a].add(mid); Rsum[e.b].add(mid);
    val[e.a]++; val[e.b]++;
  }
  for (let i = 0; i < V; i++) {
    const n = val[i];
    const p = new THREE.Vector3()
      .addScaledVector(Fsum[i], 1 / (n * n))
      .addScaledVector(Rsum[i], 2 / (n * n))
      .addScaledVector(pos[i], (n - 3) / n);
    out[i] = p;
  }
  const nf = [];
  for (let i = 0; i < F; i++) {
    const f = faces[i];
    const k = f.length;
    for (let j = 0; j < k; j++) {
      const prev = edges.get(ekey(f[(j + k - 1) % k], f[j])).id;
      const nextE = edges.get(ekey(f[j], f[(j + 1) % k])).id;
      nf.push([f[j], nextE, V + i, prev]);
    }
  }
  return { pos: out, faces: nf };
}

// Area-weighted vertex normals from a quad mesh. Called on the FULL topology
// before any face is dropped, which is the whole trick: a rim vertex then keeps
// the normal of the surface it lies on instead of being tipped into the hole by
// the faces that are no longer there.
function quadNormals(pos, faces) {
  const nrm = pos.map(() => new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (const f of faces) {
    const k = f.length;
    n.set(0, 0, 0);
    for (let i = 0; i < k; i++) {
      const p = pos[f[i]], q = pos[f[(i + 1) % k]];
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
    }
    for (const v of f) nrm[v].add(n);
  }
  void a; void b;
  for (const v of nrm) { if (v.lengthSq() < 1e-20) v.set(0, 1, 0); else v.normalize(); }
  return nrm;
}

// ------------------------------------------------------------ sculpt helpers

// A smooth bump on an ellipsoidal support: 1 at the centre, 0 at the boundary,
// with zero gradient at both, so nothing an operator does leaves a ring.
const bump = (d) => (d >= 1 ? 0 : (1 - d * d) * (1 - d * d));
function ell(p, cx, cy, cz, rx, ry, rz) {
  const x = (p.x - cx) / rx, y = (p.y - cy) / ry, z = (p.z - cz) / rz;
  return Math.sqrt(x * x + y * y + z * z);
}
// The same support but with the falloff sharpened on ONE side. `kBelow` and
// `kAbove` scale the y half-extent below and above the centre separately. This
// is what makes a brow overhang: the shelf reaches a long way up into the
// forehead and stops dead under itself, so the bone below stays where the loft
// put it and the orbit ends up in shadow.
function ellAsym(p, cx, cy, cz, rx, ryDn, ryUp, rz) {
  const x = (p.x - cx) / rx;
  const dy = p.y - cy;
  const y = dy < 0 ? dy / ryDn : dy / ryUp;
  const z = (p.z - cz) / rz;
  return Math.sqrt(x * x + y * y + z * z);
}
// Distance in the (z, y) plane from a point to a polyline. The temporal line
// and the dental arch are both curves rather than points, and a falloff to a
// curve is what draws a crest instead of a pimple.
function distToPolyline(z, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [z0, y0] = poly[i], [z1, y1] = poly[i + 1];
    const dz = z1 - z0, dy = y1 - y0;
    const len2 = dz * dz + dy * dy;
    let t = len2 > 0 ? ((z - z0) * dz + (y - y0) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const qz = z0 + t * dz - z, qy = y0 + t * dy - y;
    best = Math.min(best, Math.hypot(qz, qy));
  }
  return best;
}

// ------------------------------------------------------------- the landmarks
// Everything the sculpt and the openings are placed against, in one block, in
// world units, so the anatomy is readable without arithmetic.

const EYE_Y = (Y_CROWN + Y_CHIN) / 2;             // +0.12875, the eye line
const BRIDGE = 0.145 * W;                         //  0.05024, orbit to orbit
const ORB_X = BRIDGE / 2 + M.skull.socket.width / 2;
const ORB_HW = M.skull.socket.width / 2;
const ORB_HH = M.skull.socket.height / 2;
const PORION_X = 0.385 * W;                       // half the biauricular breadth
const NASAL_BASE_Y = LY(-0.110);                  // nasospinale
const NASAL_H = 0.190 * L;                        // piriform aperture, real proportion
const NASAL_W = 0.145 * L;
const ALV_Y = Y_BITE + 0.055 * L;                 // the upper alveolar margin
const ARCH_Y = LY(-0.040);                        // the zygomatic arch's own height
const MASTOID_Y = LY(-0.135);

// ------------------------------------------------------------- the sculpt

// Coarse pass, on the cage. Each of these is one anatomical statement. Order
// matters only where two overlap, and where they do the later one is written to
// add to the earlier rather than to fight it.
function sculptCage(pos, nrm) {
  const p = new THREE.Vector3();
  // The temporal line: the crest that bounds the temporal fossa above. Traced
  // in the (z, y) plane, from the zygomatic process of the frontal bone up over
  // the side of the vault and back down to the root of the arch.
  const TEMP_LINE = [
    [ 0.150, 0.148], [ 0.128, 0.196], [ 0.086, 0.232], [ 0.020, 0.250],
    [-0.058, 0.246], [-0.120, 0.222], [-0.158, 0.180], [-0.170, 0.140],
  ];
  // The dental arch, in plan, as a polyline in (z, x) for the alveolar bulge.
  for (let i = 0; i < pos.length; i++) {
    p.copy(pos[i]);
    const n = nrm[i];
    const ax = Math.abs(p.x);
    const sx = p.x >= 0 ? 1 : -1;
    const d = new THREE.Vector3();

    // --- the frontal eminences. Two soft bosses on the forehead. Without them
    // the frontal bone reads as a bare ramp off the brow.
    {
      const f = bump(ell(p, sx * 0.055, 0.262, 0.152, 0.090, 0.070, 0.115));
      d.z += 0.0042 * f;
    }

    // --- THE BROW. The supraorbital ridge, one arc per side plus the glabella
    // between them. ryDn is a third of ryUp, so the shelf grows out of the
    // forehead and stops under itself: that asymmetry IS the overhang.
    {
      const f = bump(ellAsym(p, sx * 0.078, EYE_Y + 0.062, 0.170, 0.088, 0.024, 0.062, 0.110));
      d.z += 0.0190 * f;
      d.y -= 0.0035 * f;
      const g = bump(ellAsym(p, 0, EYE_Y + 0.058, 0.196, 0.038, 0.026, 0.058, 0.090));
      d.z += 0.0105 * g;
    }
    // --- and the recess under it. The orbital opening's surround is pulled
    // BACK, which doubles the brow's projection over it without making the
    // brow itself heavier.
    {
      const f = bump(ellAsym(p, sx * ORB_X, EYE_Y - 0.004, 0.185, 0.085, 0.062, 0.030, 0.095));
      d.z -= 0.0125 * f;
    }

    // --- THE TEMPORAL FOSSA. A genuine scoop in the side of the vault, below
    // and behind the temporal line. Pushed along -x rather than along the
    // normal so the hollow is a flat rather than a dimple, which is what it is.
    {
      const f = bump(ell(p, sx * 0.20, 0.150, 0.010, 0.230, 0.098, 0.150));
      const lateral = smooth(0.02, 0.09, ax);
      d.x -= sx * 0.0165 * f * lateral;
    }
    // --- post-orbital constriction: the waist behind the outer orbital rim,
    // which is the front end of the same hollow and the reason the brow's outer
    // corner stands proud in a three-quarter view.
    {
      const f = bump(ell(p, sx * 0.155, EYE_Y + 0.030, 0.090, 0.075, 0.075, 0.070));
      d.x -= sx * 0.0105 * f * smooth(0.02, 0.08, ax);
    }
    // --- THE TEMPORAL LINE itself: a low welt along the crest. Narrow support,
    // so subdivision keeps it as a crest and not as a swelling.
    {
      const dl = distToPolyline(p.z, p.y, TEMP_LINE);
      const f = bump(clamp(dl / 0.030, 0, 1)) * smooth(0.05, 0.11, ax);
      d.x += sx * 0.0060 * f;
    }

    // --- the parietal eminence. The widest point of the head, high and behind.
    {
      const f = bump(ell(p, sx * 0.165, 0.244, -0.060, 0.135, 0.105, 0.145));
      d.x += sx * 0.0075 * f * smooth(0.03, 0.10, ax);
    }
    // --- the occipital squama and the nuchal plane below it, which turns the
    // back of the head under toward the neck instead of letting it hang.
    {
      const f = bump(ell(p, 0, 0.140, -0.198, 0.150, 0.075, 0.085));
      d.z -= 0.0075 * f;
      const g = bump(ell(p, 0, 0.048, -0.150, 0.135, 0.070, 0.105));
      d.y += 0.0130 * g;
      d.z += 0.0090 * g;
    }
    // --- the basiocciput. M.y.atlas is a derived number and the table's basion
    // lands 0.049 ABOVE it, so the neck would stop short of the skull. The base
    // carries the difference: this reaches down to meet the neck's top.
    {
      const f = bump(ell(p, 0, 0.052, -0.075, 0.085, 0.075, 0.085));
      d.y -= 0.0300 * f;
    }

    // --- THE MASTOID PROCESS. A lug that points down and slightly forward,
    // behind and below the ear canal. On a mesh this is just a hard local pull;
    // in a blended field it was always a smear.
    {
      const f = bump(ell(p, sx * (PORION_X - 0.012), MASTOID_Y + 0.014, PORION_Z - 0.016, 0.052, 0.058, 0.055));
      d.y -= 0.0355 * f;
      d.x += sx * 0.0060 * f;
      d.z -= 0.0035 * f;
    }
    // --- the external auditory meatus, a small pit at porion, and the ridge of
    // the zygomatic process running forward from it that the arch springs off.
    {
      const f = bump(ell(p, sx * PORION_X, PORION_Y, PORION_Z, 0.026, 0.024, 0.024));
      d.x -= sx * 0.0090 * f;
      const g = bump(ell(p, sx * (PORION_X - 0.004), ARCH_Y + 0.030, PORION_Z + 0.020, 0.036, 0.032, 0.040));
      d.x += sx * 0.0055 * g;
    }

    // --- THE ZYGOMATIC BODY. The cheekbone: outward and forward, under the
    // orbit's outer half. The arch bridges from here back to the ear, and the
    // hollow between the two is the temporal fossa above.
    {
      const f = bump(ell(p, sx * 0.140, EYE_Y - 0.048, 0.125, 0.070, 0.060, 0.072));
      d.x += sx * 0.0135 * f;
      d.z += 0.0090 * f;
    }
    // --- the canine fossa, the small hollow beside the nose that separates the
    // cheekbone from the muzzle.
    {
      const f = bump(ell(p, sx * 0.062, 0.048, 0.176, 0.048, 0.042, 0.060));
      d.z -= 0.0075 * f;
    }

    // --- the nasal bones: a low ridge from the nasion down to the aperture,
    // which is what makes the profile read as a nose rather than as a slot.
    {
      const f = bump(ell(p, 0, LY(0.130), 0.205, 0.030, 0.060, 0.055));
      d.z += 0.0075 * f;
      const g = bump(ell(p, 0, LY(0.215), 0.196, 0.030, 0.030, 0.045));
      d.z -= 0.0060 * g;   // the nasion notch
    }

    // --- THE MAXILLA. The alveolar process carrying the upper teeth: a forward
    // and downward block below the nose, narrower than the cheeks, with the
    // tooth row's parabola in its plan.
    {
      const f = bump(ell(p, 0, ALV_Y + 0.014, 0.150, 0.098, 0.048, 0.075));
      d.y -= 0.0080 * f;
      d.z += 0.0060 * f * smooth(0.10, -0.02, p.z * 0 + ax);
    }
    // --- and the palate, pulled up between the tooth rows so the underside of
    // the face is a vault and not a slab.
    {
      const f = bump(ell(p, 0, ALV_Y, 0.100, 0.062, 0.048, 0.090));
      d.y += 0.0130 * f;
    }

    void n;
    pos[i].add(d);
  }
}

// Fine pass, after subdivision. Anything here would have been smoothed away by
// Catmull-Clark if it had been said in the cage.
function sculptFine(pos) {
  const TEMP_LINE = [
    [ 0.150, 0.148], [ 0.128, 0.196], [ 0.086, 0.232], [ 0.020, 0.250],
    [-0.058, 0.246], [-0.120, 0.222], [-0.158, 0.180], [-0.170, 0.140],
  ];
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const ax = Math.abs(p.x), sx = p.x >= 0 ? 1 : -1;
    // Sharpen the temporal line back into a crest.
    const dl = distToPolyline(p.z, p.y, TEMP_LINE);
    p.x += sx * 0.0026 * bump(clamp(dl / 0.016, 0, 1)) * smooth(0.05, 0.11, ax);
    // The alveolar juga: the vertical swellings over the roots of the upper
    // teeth. Cheap, and the single strongest cue that the tooth row is set in
    // bone rather than glued to it.
    if (p.y < ALV_Y + 0.030 && p.y > ALV_Y - 0.020 && p.z > 0.09) {
      const th = Math.atan2(p.x, p.z - 0.055);
      const ripple = Math.cos(th * 11.5);
      const band = bump(clamp(Math.abs(p.y - (ALV_Y + 0.008)) / 0.028, 0, 1));
      const s = 0.0022 * band * Math.max(0, ripple);
      p.z += s * Math.cos(th);
      p.x += s * Math.sin(th);
    }
    // The nasal sill: the flat shelf below the aperture.
    if (p.y > NASAL_BASE_Y - 0.020 && p.y < NASAL_BASE_Y + 0.006 && ax < 0.055 && p.z > 0.15) {
      p.z -= 0.0022 * bump(clamp(ax / 0.055, 0, 1));
    }
  }
}

// -------------------------------------------------------------- the openings

// An opening is a closed outline in a plane, an axis the cut and its wall run
// along, and a depth. The plane's origin sits on the bone; the axis points out
// of the face, tilted the way the real opening faces.
function makeOutline(pts, closedSmooth = true) {
  // Resample a closed control polygon through a centripetal Catmull-Rom, so an
  // authored outline reads as a curve and not as a run of chords.
  const n = pts.length;
  const out = [];
  const S = closedSmooth ? 8 : 1;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < S; s++) {
      const t = s / S, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

function insidePoly(poly, u, v) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i], [uj, vj] = poly[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

function nearestOnPoly(poly, u, v) {
  let bu = poly[0][0], bv = poly[0][1], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length];
    const du = u1 - u0, dv = v1 - v0;
    const len2 = du * du + dv * dv;
    let t = len2 > 0 ? ((u - u0) * du + (v - v0) * dv) / len2 : 0;
    t = clamp(t, 0, 1);
    const qu = u0 + t * du, qv = v0 + t * dv;
    const d = (qu - u) * (qu - u) + (qv - v) * (qv - v);
    if (d < bd) { bd = d; bu = qu; bv = qv; }
  }
  return [bu, bv, Math.sqrt(bd)];
}

// The orbital margin. A rounded square, wider than tall (orbital index 0.85),
// with the lower-medial corner opened out toward the nose the way a real one
// is, and the upper rim a SHALLOW SYMMETRIC ARCH. That last one is deliberate:
// an earlier pass ran the top edge down on a hard diagonal toward the nose and
// the whole figure read as a scowl, and the user asked for the opposite. The
// arch is friendly without being blank, because everything else about the
// socket -- the depth, the wall, the overhanging brow -- is still a skull's.
function orbitOutline(side) {
  const a = ORB_HW, b = ORB_HH;
  const pts = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    const c = Math.cos(th), s = Math.sin(th);
    const e = 2 / 2.85;
    let u = a * Math.sign(c) * Math.pow(Math.abs(c), e);
    let v = b * Math.sign(s) * Math.pow(Math.abs(s), e);
    // Lift the top rim into a gentle arch and drop the lower-medial corner.
    v += 0.10 * b * Math.max(0, s) * (1 - c * c);
    if (v < 0 && u * side < 0) v -= 0.10 * b * (1 - Math.abs(u) / a);
    // The lateral half is a touch taller: the upper-outer corner is the
    // highest point of a real orbit.
    v += 0.05 * b * Math.max(0, s) * clamp(u * side / a, 0, 1);
    pts.push([u * side, v]);
  }
  const rot = M.skull.socket.slant * 0.55 * side;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]);
}

// The piriform aperture. Inverted pear: narrow between the orbits, widest at
// its base, with a sharp lower rim and the ANTERIOR NASAL SPINE showing as a
// pale triangle standing up into the middle of the hole. That spine is the
// detail that reads instantly as a skull's nose, and it is why this outline is
// authored point by point instead of being another superellipse.
function nasalOutline() {
  const hw = NASAL_W / 2, h = NASAL_H;
  const half = [
    [0.000, 1.000],
    [0.170, 0.905],
    [0.300, 0.760],
    [0.430, 0.560],
    [0.540, 0.355],
    [0.610, 0.185],
    [0.590, 0.070],
    [0.440, 0.012],
    [0.240, 0.020],
    [0.115, 0.075],
  ];
  const pts = [];
  for (const [u, v] of half) pts.push([u * hw, v * h]);
  pts.push([0, 0.185 * h]);                       // the spine's tip
  for (let i = half.length - 1; i >= 1; i--) pts.push([-half[i][0] * hw, half[i][1] * h]);
  return pts;
}

// --------------------------------------------------------------- sweeps

// A swept bar with a superelliptical section that can change along its own
// length.
//
// The frame is NOT parallel transport. Both bones swept here, the zygomatic
// arch and the mandible, are bent PLATES, and the direction a plate is thin in
// is a property of the anatomy, not of how a frame happened to roll: it is the
// outward horizontal normal of the bone's own plan curve. Take it from there
// and the plate that is broad front-to-back up the ramus becomes the plate that
// is deep top-to-bottom along the body, all by itself, through the gonial
// angle where the tangent turns a right angle. Parallel transport was tried
// first and did not: it carried the broad axis forward through the corner and
// laid the body of the mandible flat.
//
// `a` is the half-extent along the broad axis, `b` along the thin one.
function sweepBar(path, sectionFn, { steps = 48, radial = 20, cap = true } = {}) {
  const P = [], T = [];
  for (let i = 0; i <= steps; i++) P.push(path(i / steps));
  for (let i = 0; i <= steps; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(steps, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // Plan centroid, so the thin axis can be signed outward consistently.
  const mid = new THREE.Vector3();
  for (const p of P) mid.add(p);
  mid.multiplyScalar(1 / P.length);
  const U = [], V = [];
  let thin = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= steps; i++) {
    const h = new THREE.Vector3(T[i].x, 0, T[i].z);
    if (h.length() > 0.18) {
      const n = new THREE.Vector3(h.z, 0, -h.x).normalize();
      if (n.dot(new THREE.Vector3(P[i].x - mid.x, 0, P[i].z - mid.z)) < 0) n.negate();
      thin = n;
    }
    const v = thin.clone().projectOnPlane(T[i]);
    if (v.lengthSq() < 1e-10) v.set(0, 1, 0).projectOnPlane(T[i]);
    v.normalize();
    const u = new THREE.Vector3().crossVectors(v, T[i]).normalize();
    U.push(u);
    V.push(v);
  }
  const pos = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sec = sectionFn(t);
    const e = 2 / (sec.p ?? 3.0);
    for (let j = 0; j < radial; j++) {
      const th = (2 * Math.PI * j) / radial;
      const c = Math.cos(th), s = Math.sin(th);
      const a = sec.a * Math.sign(c) * Math.pow(Math.abs(c), e);
      const b = sec.b * Math.sign(s) * Math.pow(Math.abs(s), e);
      pos.push(
        P[i].x + U[i].x * a + V[i].x * b,
        P[i].y + U[i].y * a + V[i].y * b,
        P[i].z + U[i].z * a + V[i].z * b,
      );
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      const c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  // TubeGeometry has no end caps and a bare tube end reads as a chip out of the
  // bone, so both ends close on their own centre.
  if (cap) {
    for (const [i, flip] of [[0, true], [steps, false]]) {
      const centre = pos.length / 3;
      pos.push(P[i].x, P[i].y, P[i].z);
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial);
        if (flip) idx.push(centre, a, b); else idx.push(centre, b, a);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// A rounded box, for a tooth. Superellipsoid, so the corners are soft but the
// crown still has flats to catch the light.
function toothGeo(hw, hh, hd, p = 4.0) {
  const NU = 14, NV = 10;
  const pos = [], idx = [];
  const e = 2 / p;
  const sp = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
  for (let j = 0; j <= NV; j++) {
    const phi = -Math.PI / 2 + (Math.PI * j) / NV;
    const cp = Math.cos(phi), sp2 = Math.sin(phi);
    for (let i = 0; i <= NU; i++) {
      const th = (2 * Math.PI * i) / NU;
      pos.push(
        hw * sp(Math.cos(th), e) * sp(cp, e),
        hh * sp(sp2, e),
        hd * sp(Math.sin(th), e) * sp(cp, e),
      );
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function mergeInto(target, geo, mat) {
  const src = geo.attributes.position.array;
  const index = geo.index.array;
  const base = target.pos.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.length; i += 3) {
    v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(mat);
    target.pos.push(v.x, v.y, v.z);
  }
  for (let i = 0; i < index.length; i++) target.idx.push(base + index[i]);
}

// ---------------------------------------------------------------- the build

export function buildSkull({ material }) {
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];
  const track = (g) => { geometries.push(g); return g; };

  const skinMat = material.clone();
  skinMat.vertexColors = true;
  materials.push(skinMat);
  const toothMat = material.clone();
  toothMat.color = new THREE.Color(material.color ? material.color.getHex() : 0xf2e6d2).lerp(new THREE.Color(0xffffff), 0.34);
  toothMat.roughness = Math.max(0.3, (material.roughness ?? 0.72) - 0.22);
  materials.push(toothMat);

  // ------------------------------------------------------------- 1. the cage
  const CAGE_N = 14;
  const { dirs, faces: cageFaces } = cubeSphere(CAGE_N);
  let pos = dirs.map((d) => cagePoint(d.x, d.y, d.z, new THREE.Vector3()));
  let faces = cageFaces;

  // ----------------------------------------------------------- 2. sculpt it
  sculptCage(pos, quadNormals(pos, faces));

  // -------------------------------------------------------- 3. subdivide it
  for (let i = 0; i < 2; i++) {
    const r = catmullClark(pos, faces);
    pos = r.pos;
    faces = r.faces;
  }

  // ------------------------------------------------------ 4. sculpt it again
  sculptFine(pos);

  // Normals from the FULL topology, before a single face is dropped.
  const nrm = quadNormals(pos, faces);

  // ------------------------------------------------------------ 5. the holes
  const rad = (deg) => (deg * Math.PI) / 180;
  const openings = [];
  for (const side of [1, -1]) {
    const axis = new THREE.Vector3(side * Math.sin(rad(23)), 0.055, Math.cos(rad(23))).normalize();
    openings.push({
      name: side > 0 ? 'orbitL' : 'orbitR',
      origin: new THREE.Vector3(side * ORB_X, EYE_Y, 0.150),
      axis,
      poly: orbitOutline(side),
      depth: 0.115,
      taper: 0.42,
      reach: 0.11,
    });
  }
  openings.push({
    name: 'nasal',
    origin: new THREE.Vector3(0, NASAL_BASE_Y, 0.196),
    axis: new THREE.Vector3(0, 0.14, 1).normalize(),
    poly: makeOutline(nasalOutline()),
    depth: 0.072,
    taper: 0.50,
    reach: 0.085,
  });
  for (const o of openings) {
    if (o.name !== 'nasal') o.poly = makeOutline(o.poly);
    o.U = new THREE.Vector3(1, 0, 0).cross(o.axis).lengthSq() > 0
      ? new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), o.axis).normalize()
      : new THREE.Vector3(1, 0, 0);
    o.V = new THREE.Vector3().crossVectors(o.axis, o.U).normalize();
    o.plane = (p, out) => {
      const dx = p.x - o.origin.x, dy = p.y - o.origin.y, dz = p.z - o.origin.z;
      out.u = dx * o.U.x + dy * o.U.y + dz * o.U.z;
      out.v = dx * o.V.x + dy * o.V.y + dz * o.V.z;
      out.n = dx * o.axis.x + dy * o.axis.y + dz * o.axis.z;
      return out;
    };
  }

  const uvn = { u: 0, v: 0, n: 0 };
  const centre = new THREE.Vector3();
  const dropped = new Uint8Array(faces.length);
  const faceCut = new Array(faces.length).fill(null);
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    centre.set(0, 0, 0);
    for (const v of f) centre.add(pos[v]);
    centre.multiplyScalar(1 / f.length);
    // Face normal, for the "is this the near side of the head" test.
    const fn = new THREE.Vector3();
    for (const v of f) fn.add(nrm[v]);
    for (const o of openings) {
      o.plane(centre, uvn);
      if (uvn.n > o.reach || uvn.n < -o.reach) continue;
      if (fn.dot(o.axis) <= 0) continue;
      if (!insidePoly(o.poly, uvn.u, uvn.v)) continue;
      dropped[fi] = 1;
      faceCut[fi] = o;
      break;
    }
  }

  // Snap the surviving rim onto the true curve. A vertex that borders both a
  // dropped face and a kept one is pulled to the nearest point of the outline,
  // clamped to under a cell so a snapped vertex cannot cross a neighbour and
  // turn a surviving quad inside out.
  const rimOf = new Array(pos.length).fill(null);
  {
    const touchCut = new Array(pos.length).fill(null);
    const touchKeep = new Uint8Array(pos.length);
    for (let fi = 0; fi < faces.length; fi++) {
      for (const v of faces[fi]) {
        if (dropped[fi]) touchCut[v] = faceCut[fi];
        else touchKeep[v] = 1;
      }
    }
    // A representative cell size, for the clamp.
    let cell = 0;
    {
      const f = faces[0];
      cell = pos[f[0]].distanceTo(pos[f[1]]);
      for (let i = 0; i < faces.length; i += 97) {
        const g = faces[i];
        cell = Math.max(cell, pos[g[0]].distanceTo(pos[g[1]]));
      }
    }
    for (let v = 0; v < pos.length; v++) {
      const o = touchCut[v];
      if (!o || !touchKeep[v]) continue;
      o.plane(pos[v], uvn);
      const [su, sv] = nearestOnPoly(o.poly, uvn.u, uvn.v);
      const du = clamp(su - uvn.u, -0.55 * cell, 0.55 * cell);
      const dv = clamp(sv - uvn.v, -0.55 * cell, 0.55 * cell);
      pos[v].addScaledVector(o.U, du).addScaledVector(o.V, dv);
      rimOf[v] = o;
    }
  }

  // ------------------------------------------------------- 6. paint the skin
  // The only paint on this head: a soft darkening in the places a real skull
  // holds shadow and dirt. The photograph's skull is aged tan with the recesses
  // several shades down, and flat ivory is most of what makes a render of one
  // read as plastic.
  const col = new Float32Array(pos.length * 3);
  {
    const TEMP_LINE = [
      [0.150, 0.148], [0.128, 0.196], [0.086, 0.232], [0.020, 0.250],
      [-0.058, 0.246], [-0.120, 0.222], [-0.158, 0.180], [-0.170, 0.140],
    ];
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      let k = 1.0;
      // a ring of occlusion just outside every opening
      for (const o of openings) {
        o.plane(p, uvn);
        if (Math.abs(uvn.n) > 0.16) continue;
        const [, , d] = nearestOnPoly(o.poly, uvn.u, uvn.v);
        k *= 1 - 0.30 * bump(clamp(d / 0.030, 0, 1));
      }
      // the temporal fossa holds shade
      const dl = distToPolyline(p.z, p.y, TEMP_LINE);
      k *= 1 - 0.10 * smooth(0.10, 0.02, dl) * smooth(0.05, 0.11, Math.abs(p.x));
      // under the brow, under the cheekbone, and up under the base
      k *= 1 - 0.16 * smooth(0.0, 1.0, bump(ell(p, 0, EYE_Y + 0.030, 0.195, 0.170, 0.030, 0.075)));
      k *= 1 - 0.12 * smooth(0.045, 0.005, p.y - Y_BOT + 0.02);
      // and a gentle tan toward the base, which is what an old skull does
      k *= mix(0.955, 1.0, smooth(0.02, 0.24, p.y));
      col[i * 3] = k;
      col[i * 3 + 1] = k * (1 - 0.035 * (1 - k));
      col[i * 3 + 2] = k * (1 - 0.115 * (1 - k));
    }
  }

  // ------------------------------------------------------- 7. the skin buffer
  {
    const P = new Float32Array(pos.length * 3);
    const Nn = new Float32Array(pos.length * 3);
    for (let i = 0; i < pos.length; i++) {
      P[i * 3] = pos[i].x; P[i * 3 + 1] = pos[i].y; P[i * 3 + 2] = pos[i].z;
      Nn[i * 3] = nrm[i].x; Nn[i * 3 + 1] = nrm[i].y; Nn[i * 3 + 2] = nrm[i].z;
    }
    const idx = [];
    for (let fi = 0; fi < faces.length; fi++) {
      if (dropped[fi]) continue;
      const f = faces[fi];
      idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    group.add(new THREE.Mesh(track(geo), skinMat));
  }

  // ---------------------------------------- 8. the wall and bowl in each hole
  // The wall is welded to the skin's OWN rim vertices, so there is no seam to
  // chase and no lip standing proud where the surface happens to be shallow:
  // ring zero is literally the hole's edge, and the rings behind it march in
  // along the opening's axis with the outline tapering as they go. Its normals
  // are its own, which is what gives the cut a crisp edge instead of a soft
  // grey halo. The last rings close on the axis, so nothing ever sees daylight
  // through the head.
  for (const o of openings) {
    const rim = [];
    for (let v = 0; v < pos.length; v++) {
      if (rimOf[v] !== o) continue;
      o.plane(pos[v], uvn);
      rim.push({ u: uvn.u, v: uvn.v, n: uvn.n, a: Math.atan2(uvn.v - o.cy0 || uvn.v, uvn.u) });
    }
    if (rim.length < 8) continue;
    let cu = 0, cv = 0;
    for (const r of rim) { cu += r.u; cv += r.v; }
    cu /= rim.length; cv /= rim.length;
    for (const r of rim) r.a = Math.atan2(r.v - cv, r.u - cu);
    rim.sort((a, b) => a.a - b.a);

    const RINGS = 7;
    const P = [], C = [], idx = [];
    for (let j = 0; j <= RINGS; j++) {
      const t = j / RINGS;
      const s = j === 0 ? 1 : mix(1, 0, Math.pow(t, 1.55)) * (1 - o.taper) + (1 - o.taper * t) * o.taper;
      const shrink = j === 0 ? 1 : (1 - o.taper * Math.pow(t, 1.3)) * (1 - Math.pow(t, 5));
      const depth = o.depth * (t < 1 ? t * t * (3 - 2 * t) : 1);
      const shade = mix(1.0, 0.13, smooth(0, 0.55, t));
      for (const r of rim) {
        const u = (cu + (r.u - cu) * shrink) * 1;
        const v = (cv + (r.v - cv) * shrink) * 1;
        const n = r.n - depth;
        P.push(
          o.origin.x + o.U.x * u + o.V.x * v + o.axis.x * n,
          o.origin.y + o.U.y * u + o.V.y * v + o.axis.y * n,
          o.origin.z + o.U.z * u + o.V.z * v + o.axis.z * n,
        );
        C.push(shade, shade * 0.965, shade * 0.90);
      }
      void s;
    }
    const K = rim.length;
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < K; i++) {
        const a = j * K + i, b = j * K + ((i + 1) % K);
        const c = a + K, d = b + K;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(track(geo), skinMat));
  }

  // ------------------------------------------------------ 9. the zygomatic arches
  // NOT part of the cage. A bridge needs daylight behind it and a single closed
  // surface cannot have any, so each arch is its own bar, springing from the
  // cheekbone and landing on the root of the zygomatic process in front of the
  // ear, with the temporal fossa scooped away behind it. That gap is the
  // strongest single "this is a skull" cue in a three-quarter view.
  for (const side of [1, -1]) {
    const a = new THREE.Vector3(side * 0.1120, ARCH_Y - 0.016, 0.1380);
    const b = new THREE.Vector3(side * 0.1530, ARCH_Y - 0.008, 0.0620);
    const c = new THREE.Vector3(side * 0.1610, ARCH_Y + 0.006, -0.0060);
    const d = new THREE.Vector3(side * 0.1440, ARCH_Y + 0.022, -0.0560);
    const e = new THREE.Vector3(side * (PORION_X - 0.014), PORION_Y - 0.004, PORION_Z - 0.004);
    const curve = new THREE.CatmullRomCurve3([a, b, c, d, e], false, 'catmullrom', 0.5);
    const geo = sweepBar((t) => curve.getPoint(t), (t) => ({
      a: mix(0.0150, 0.0118, smooth(0.05, 0.72, t)) * mix(1, 1.45, smooth(0.86, 1, t)),
      b: mix(0.0105, 0.0072, smooth(0.05, 0.62, t)) * mix(1, 1.5, smooth(0.86, 1, t)),
      p: 3.2,
    }), { steps: 34, radial: 16 });
    const cols = new Float32Array(geo.attributes.position.count * 3).fill(0.97);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    group.add(new THREE.Mesh(track(geo), skinMat));
  }

  // ------------------------------------------------------------ 10. the teeth
  // Even counts. metrics gives 11 upper and 9 lower, and an odd row puts one
  // tooth astride the midline where a real skull has the gap between the two
  // central incisors, which is visible dead on. Rounded up rather than changed
  // in metrics.js; reported instead.
  const UPPER_N = M.skull.teeth.upper + (M.skull.teeth.upper % 2);
  const LOWER_N = M.skull.teeth.lower + (M.skull.teeth.lower % 2);
  const UP_ARCH = { x: 0.0705, front: 0.1815, back: 0.1120 };
  const LO_ARCH = { x: 0.0615, front: 0.1700, back: 0.1060 };

  function toothRow(n, arch, topY, botY, up) {
    const target = { pos: [], idx: [] };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const u = (2 * i + 1) / n - 1;
      const x = arch.x * u;
      const z = arch.front - arch.back * u * u;
      // Incisors are broad and flat, molars are deep and blocky.
      const k = Math.abs(u);
      const hw = (arch.x / n) * 1.02 * mix(1.05, 1.30, k);
      const hd = mix(0.0068, 0.0115, k);
      const hh = (topY - botY) / 2;
      const yc = (topY + botY) / 2;
      const geo = toothGeo(hw, hh, hd, mix(3.4, 4.4, k));
      const th = Math.atan2(x, z - (arch.front - arch.back - 0.02));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
      m.compose(new THREE.Vector3(x, yc, z), q, new THREE.Vector3(1, 1, 1));
      mergeInto(target, geo, m);
      geo.dispose();
    }
    void up;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(target.pos, 3));
    g.setIndex(target.idx);
    g.computeVertexNormals();
    return g;
  }

  group.add(new THREE.Mesh(track(toothRow(UPPER_N, UP_ARCH, ALV_Y + 0.012, Y_BITE, true)), toothMat));

  // ---------------------------------------------------------- 11. the mandible
  // One swept bar for the whole bone: up the left ramus, round the gonial
  // angle, along the body, through the chin and out the other side. Parallel
  // transport rolls the section as the path turns, so the plate that is broad
  // front-to-back in the ramus is the plate that is deep top-to-bottom in the
  // body without anyone having to say so. The condyles and the coronoid prongs
  // are added on top, because a single sweep cannot grow two horns and a notch
  // between them.
  const HINGE_Y = LY(0.010);                       // condylion
  const HINGE_Z = LZ(-0.030);
  const CONDYLE_X = 0.120;
  const GONION_Y = LY(-0.300);                     // the corner of the jaw
  const GONION_Z = LZ(0.070);
  const GONION_X = 0.122;

  const jaw = new THREE.Object3D();
  jaw.position.set(0, HINGE_Y, HINGE_Z);
  jaw.userData.openAxis = 'x';
  jaw.userData.openSign = 1;
  group.add(jaw);
  const jawRoot = new THREE.Object3D();
  jawRoot.position.set(0, -HINGE_Y, -HINGE_Z);
  jaw.add(jawRoot);

  {
    // The body's own centreline sits half a body-depth above the chin point,
    // so the section's lower edge lands exactly on M.y.chin.
    const BODY_TOP = Y_BITE - 0.045 * L;           // the mandible's alveolar margin
    const CH_Y = (BODY_TOP + Y_CHIN) / 2;
    const CH_A = (BODY_TOP - Y_CHIN) / 2;
    // One half of the bone, condyle first, chin last. The other half is this
    // one mirrored, and the two are spliced without repeating the chin.
    const key = [
      new THREE.Vector3(CONDYLE_X, HINGE_Y, HINGE_Z),
      new THREE.Vector3(GONION_X - 0.004, mix(HINGE_Y, GONION_Y, 0.62), mix(HINGE_Z, GONION_Z, 0.36)),
      new THREE.Vector3(GONION_X, GONION_Y + 0.016, GONION_Z + 0.006),
      new THREE.Vector3(GONION_X - 0.020, CH_Y + 0.004, GONION_Z + 0.058),
      new THREE.Vector3(0.0700, CH_Y, 0.0700),
      new THREE.Vector3(0.0490, CH_Y, 0.1350),
      new THREE.Vector3(0.0000, CH_Y, 0.1690),
    ];
    const pts = [];
    for (let i = 0; i < key.length; i++) pts.push(new THREE.Vector3(-key[i].x, key[i].y, key[i].z));
    for (let i = key.length - 2; i >= 0; i--) pts.push(key[i].clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    // t = 0 and 1 are the condyles, t = 0.5 is the chin.
    const sec = (t) => {
      const s = Math.abs(t - 0.5) * 2;             // 0 at the chin, 1 at a condyle
      // a: the plate's broad axis, vertical along the body and front-to-back up
      // the ramus. b: its thickness, always small.
      const a = mix(CH_A, CH_A * 0.94, smooth(0, 0.42, s))
        * mix(1, 1.68, smooth(0.52, 0.80, s))
        * mix(1, 0.30, smooth(0.90, 1.0, s));
      const b = mix(0.0158, 0.0118, smooth(0.08, 0.62, s)) * mix(1, 0.68, smooth(0.86, 1.0, s));
      return { a, b, p: 3.4 };
    };
    const geo = sweepBar((t) => curve.getPoint(t), sec, { steps: 110, radial: 20 });
    const cols = new Float32Array(geo.attributes.position.count * 3);
    {
      const p = geo.attributes.position.array;
      for (let i = 0; i < cols.length; i += 3) {
        const k = mix(0.90, 1.0, smooth(Y_CHIN, Y_BITE, p[i + 1]));
        cols[i] = k; cols[i + 1] = k * 0.995; cols[i + 2] = k * 0.975;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    jawRoot.add(new THREE.Mesh(track(geo), skinMat));

    // The condyle heads and the coronoid prongs, with the sigmoid notch between
    // them. Without the notch a ramus is a lath.
    for (const side of [1, -1]) {
      const head = new THREE.SphereGeometry(0.0130, 16, 12);
      head.scale(0.72, 0.80, 1.28);
      head.translate(side * CONDYLE_X, HINGE_Y, HINGE_Z);
      const hc = new Float32Array(head.attributes.position.count * 3).fill(0.99);
      head.setAttribute('color', new THREE.BufferAttribute(hc, 3));
      jawRoot.add(new THREE.Mesh(track(head), skinMat));

      const cor = sweepBar(
        (t) => new THREE.Vector3(
          side * (GONION_X - 0.014 - 0.004 * t),
          mix(GONION_Y + 0.058, HINGE_Y - 0.010, t),
          mix(GONION_Z + 0.026, GONION_Z + 0.044, t * t),
        ),
        (t) => ({ a: mix(0.0175, 0.0060, smooth(0.2, 1, t)), b: mix(0.0110, 0.0048, t), p: 3.0 }),
        { steps: 16, radial: 12 },
      );
      const cc = new Float32Array(cor.attributes.position.count * 3).fill(0.97);
      cor.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      jawRoot.add(new THREE.Mesh(track(cor), skinMat));
    }

    jawRoot.add(new THREE.Mesh(
      track(toothRow(LOWER_N, LO_ARCH, Y_BITE, Y_BITE - 0.045 * L, false)),
      toothMat,
    ));
  }

  group.userData.landmarks = {
    crown: Y_CROWN, chin: Y_CHIN, bite: Y_BITE,
    porion: [PORION_X, PORION_Y, PORION_Z],
    eyeLine: EYE_Y, length: L, width: W,
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
