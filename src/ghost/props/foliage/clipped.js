import * as THREE from 'three';
import { icosphere, makeLobes, lumpPositions } from './wind.js';

// The machinery for CLIPPED foliage: a ball, a cone and a box, cut by a
// gardener rather than grown by nobody.
//
// bush.js's overgrown shrub is a wandering lobe field with a hundred and
// sixty-eight tufts standing well proud of it, and both of those decisions are
// what make it read as overgrown: the lobes take the outline off any
// recognisable form, and the tufts scallop whatever outline is left. Trimmed
// is the inverse of each. The silhouette has to read as a deliberate geometric
// shape, and the surface still has to read as leaves, so:
//
//   1. an EXACT form, built as a surface with analytic normals, then
//   2. inset by the depth of the leaf layer, and
//   3. covered in a NAP of small clusters whose tips are placed so they land
//      back on the exact form.
//
// Step 3 is the whole trick and it is why the outline survives. A tuft is not
// dropped on the surface and hoped for: its own extent along its own axis is
// measured and the tuft is then sunk by exactly that much, so the shell the
// tips describe is the shape that was asked for, to within the deliberate 12%
// jitter that keeps it from looking turned on a lathe. The mass underneath is
// the crevice between the clusters and nothing else.
//
// TWO BUILDERS, because two kinds of shape.
//
//   profileGeometry  ball and cone. A surface of revolution, from a profile
//                    polyline resampled by ARC LENGTH. That resampling is the
//                    reason the cone exists at all. Its apex arc is 5.5% of the
//                    profile's length, but seen from a point inside the cone it
//                    subtends five degrees and a twentieth of one per cent of
//                    the sphere of directions: mapped radially it collects FOUR
//                    vertices out of the two thousand the mesh has, which is a
//                    spike and not a rounded tip. Mapped by arc length the same
//                    two thousand put NINETEEN on it.
//
//   fieldGeometry    the box. Not a surface of revolution, so it is a signed
//                    distance field bisected along rays from the centre. A box
//                    is convex, so a ray from an interior point crosses its
//                    surface exactly once and bisection cannot go wrong.
//
// Both return an icosphere's topology: indexed, welded, closed, no seam and no
// pole fan. Both compute NORMALS ANALYTICALLY rather than from the triangles,
// which is what lets the box have genuinely flat faces and a genuinely round
// fillet at the tessellation this scene can afford. computeVertexNormals on a
// box this coarse rounds the flats and flattens the round.

// --- profiles ----------------------------------------------------------------
//
// A profile is [[r, y], ...] from the bottom of the axis to the top, r >= 0.
// Both ends should sit on the axis (r = 0) so the surface closes.

const TAU = Math.PI * 2;

// The ball: an ellipse of revolution with its underside cut off flat.
//
// The cut is what makes it a topiary ball rather than a beach ball resting on
// the lawn. A sphere tangent to the floor touches it at a point and shows a
// hairline of daylight all the way round its foot at this camera elevation; cut
// a little below the floor, it meets the ground along a real circle, and the
// prop keeps a flat base to sit on. The kink where the cut meets the ellipse is
// underground, which is the only reason it is allowed to be a kink.
export function ballProfile({ a, b, cy, cut }, inset = 0, steps = 96) {
  const A = Math.max(1e-3, a - inset);
  const B = Math.max(1e-3, b - inset);
  // Shrinking the body lifts the cut with it, so the inset surface is a
  // constant depth inside the outer one at the base as well as up the sides.
  const Y = cut + inset;
  const pts = [];
  // Ellipse parametrised from the bottom of the axis (u = 0) to the top
  // (u = PI). Not by y: near the poles a y parametrisation puts almost no
  // samples where the surface turns hardest.
  const c = Math.max(-1, Math.min(1, (cy - Y) / B));
  const u0 = Math.acos(c);
  if (u0 > 1e-3) pts.push([0, Y], [A * Math.sin(u0), Y]);
  for (let i = 0; i <= steps; i++) {
    const u = u0 + (Math.PI - u0) * (i / steps);
    pts.push([A * Math.sin(u), cy - B * Math.cos(u)]);
  }
  return pts;
}

// The cone: the outline of two circles and the line that is tangent to both.
//
// That construction is the answer to the two things a topiary cone has to get
// right at once. The flank is a straight line, because a gardener cuts a
// straight flank and any curvature in it reads as a bad haircut. The apex is a
// circular arc, because a mathematical point is a singularity: it aliases into
// a flickering spike at this resolution, and no gardener ever cut one either.
// Tangency is what joins them without a crease, and it comes for free from the
// geometry rather than from a fillet routine: sin(beta) = (R1 - R2) / (y2 - y1)
// is the angle at which one line touches both circles.
export function coneProfile({ base, apex, y1, y2, cut }, inset = 0, steps = 40) {
  const R1 = Math.max(1e-3, base - inset);
  const R2 = Math.max(1e-3, apex - inset);
  const d = y2 - y1;
  const sinB = Math.max(-0.999, Math.min(0.999, (R1 - R2) / d));
  const beta = Math.asin(sinB);
  const Y = cut + inset;

  const pts = [];
  // The bottom of the base circle is cut off flat and buried, the same bargain
  // the ball makes: without the cut the cone drags a whole hidden hemisphere
  // of vertices around underground.
  const s0 = Math.max(-1, Math.min(1, (Y - y1) / R1));
  const a0 = Math.asin(s0);
  pts.push([0, Y]);
  for (let i = 0; i <= steps; i++) {
    const al = a0 + (beta - a0) * (i / steps);
    pts.push([R1 * Math.cos(al), y1 + R1 * Math.sin(al)]);
  }
  for (let i = 0; i <= steps; i++) {
    const al = beta + (Math.PI / 2 - beta) * (i / steps);
    pts.push([R2 * Math.cos(al), y2 + R2 * Math.sin(al)]);
  }
  return pts;
}

// Resample a profile to even steps of arc length, and take its normals.
//
// Even arc length is the whole point of the exercise: it is what decides how
// many vertices the apex of the cone gets, and it is measured along the profile
// rather than in y so that a nearly horizontal stretch (the crown of the ball)
// is sampled as finely as a nearly vertical one (its flank).
function resampleProfile(profile, count = 512) {
  const cum = [0];
  for (let i = 1; i < profile.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(
      profile[i][0] - profile[i - 1][0],
      profile[i][1] - profile[i - 1][1],
    ));
  }
  const total = cum[cum.length - 1];
  const r = new Float64Array(count);
  const y = new Float64Array(count);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const want = (total * k) / (count - 1);
    while (j < cum.length - 2 && cum[j + 1] < want) j++;
    const t = (want - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    r[k] = profile[j][0] + (profile[j + 1][0] - profile[j][0]) * t;
    y[k] = profile[j][1] + (profile[j + 1][1] - profile[j][1]) * t;
  }
  // Outward normal of the 2D profile, (dy, -dr) rotated from the tangent. A
  // central difference on a profile that is already C1 everywhere it shows.
  const nr = new Float64Array(count);
  const ny = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const k0 = Math.max(0, k - 1);
    const k1 = Math.min(count - 1, k + 1);
    const dr = r[k1] - r[k0];
    const dy = y[k1] - y[k0];
    const len = Math.hypot(dr, dy) || 1;
    nr[k] = dy / len;
    ny[k] = -dr / len;
  }
  return { r, y, nr, ny, count, length: total };
}

// The same profile, moved in along its own normal by a distance that may vary
// along it.
//
// A constant inset is what every clipped form wants except at the tip of the
// cone, and the tip of the cone is why this exists. The leaf layer is a shell
// of clusters standing one nap depth off the mass, and a cluster is a body
// nine nap depths across: where the surface it stands on is curved
// tighter than that, its neighbours splay apart from it and the tip comes out
// as a raspberry with daylight between the segments. Thinning the nap over the
// top fifth of the cone, and shrinking the clusters to match, keeps the ratio
// of cluster to surface honest all the way to the point. The mass is what
// carries the shape there, and the leaf is a hair of texture on it.
export function insetProfile(profile, insetAt, count = 256) {
  const t = resampleProfile(profile, count);
  const out = [];
  for (let k = 0; k < count; k++) {
    const d = insetAt(k / (count - 1), t.y[k]);
    out.push([Math.max(0, t.r[k] - t.nr[k] * d), t.y[k] - t.ny[k] * d]);
  }
  return out;
}

// A surface of revolution with an icosphere's topology.
//
// The map is polar angle to arc length: a direction theta radians off +y lands
// at (1 - theta / PI) of the way up the profile. Since an icosphere's vertices
// are spread evenly over the sphere of directions, and the profile is spread
// evenly over its own length, the mesh comes out evenly spaced along the
// profile as well, with the rings thinning toward the poles exactly as the
// circumference does.
export function profileGeometry({ profile, detail = 4 }) {
  const { dirs, index } = icosphere(detail);
  const n = dirs.length / 3;
  const table = resampleProfile(profile);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    const s = 1 - Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI;
    const f = s * (table.count - 1);
    const k0 = Math.max(0, Math.min(table.count - 1, Math.floor(f)));
    const k1 = Math.min(table.count - 1, k0 + 1);
    const t = f - k0;
    const r = table.r[k0] + (table.r[k1] - table.r[k0]) * t;
    const y = table.y[k0] + (table.y[k1] - table.y[k0]) * t;
    const pr = table.nr[k0] + (table.nr[k1] - table.nr[k0]) * t;
    const py = table.ny[k0] + (table.ny[k1] - table.ny[k0]) * t;

    // Azimuth. At the poles the meridian direction is undefined and r is zero,
    // so any choice gives the same point; the normal there is +-y because the
    // profile's own normal is.
    const h = Math.hypot(dx, dz);
    const cx = h > 1e-9 ? dx / h : 1;
    const cz = h > 1e-9 ? dz / h : 0;

    pos[i * 3] = r * cx;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = r * cz;
    const nl = Math.hypot(pr, py) || 1;
    nor[i * 3] = (pr / nl) * cx;
    nor[i * 3 + 1] = py / nl;
    nor[i * 3 + 2] = (pr / nl) * cz;
  }

  return finishGeometry(pos, nor, index);
}

// --- the box -----------------------------------------------------------------
//
// A cube at this camera shows three faces and three hard edges, and the house
// style rules out creases. Real clipped box hedging has softly rounded arrises
// anyway, so the answer and the style agree: every edge and every corner gets a
// generous fillet, which is exactly what the rounded-box distance field is.
//
//   sdRoundBox(p, b, r) = |max(|p| - b, 0)| + min(max(|p| - b), 0) - r
//
// The overall half width is b + r, so growing the fillet at a fixed size means
// shrinking b. BATTER is the other half of the read: real hedging is cut a few
// per cent narrower at the top than at the bottom, both because it is cut with
// a straight edge held against a leaning face and because a vertical face
// starves the bottom of light. Four and a half per cent does not read as a
// taper at all, and it is the difference between a top face and a side face
// that shade alike and two that do not.
export function boxField({ hx, hy, hz, cy, fillet, batter = 0 }) {
  const y0 = cy - hy;
  const span = Math.max(1e-4, 2 * hy);
  return (x, y, z) => {
    const u = Math.max(0, Math.min(1, (y - y0) / span));
    const s = 1 - batter * u;
    const qx = Math.abs(x) - hx * s;
    const qy = Math.abs(y - cy) - hy;
    const qz = Math.abs(z) - hz * s;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.hypot(mx, my, mz) + Math.min(Math.max(qx, qy, qz), 0) - fillet;
  };
}

// --- the hedge ---------------------------------------------------------------
//
// A segment of clipped hedge: the same box, but built to TILE.
//
// Three boxes set edge to edge do not read as a hedge, they read as three
// boxes touching, and the fillet is why. Each box rounds its own vertical
// arris, so at every join the two curves leave a dip 0.109 deep over a 0.22
// span, which is 14% of the bush's height, four pixels deep at the size the
// yard shows it, and it repeats on a regular pitch. A regular period is the
// one thing the eye never misses. No amount of tuning the box fixes it,
// because the fillet is exactly what makes the box good standing on its own.
//
// So a hedge segment is a different shape and not a differently sized box:
//
//   - The cross section is a rounded rectangle, so the two long top arrises
//     roll over exactly as the box's do.
//   - The ENDS ARE FLAT, square and unfilleted, cut on the tile plane. Two
//     segments meet along the whole of that plane. The two coincident faces do
//     not fight: each is front-facing away from the other, so the near
//     segment's body hides its neighbour's end face by depth alone.
//   - The BATTER is on the thickness only. A hedge is cut a few per cent
//     narrower at the top like everything else here, but battering the length
//     as well would tilt the tile plane and open a wedge at every join.
//   - An end that has no neighbour is CAPPED instead: the same fillet, rolled
//     round the end, inside the same tile length so a capped segment still
//     occupies exactly its pitch and still lines up on the grid.
//
// The last of those is what the two booleans are for. Where an end is capped
// the core is pulled in by the fillet and the rounding puts it back; where it
// is not, the core runs out to the tile plane and a half space cuts it there,
// which leaves the full rounded-rectangle cross section as a flat face.
// `inset` is taken here rather than by insetField outside, and that is the
// whole difference between a hedge and a row of blocks with daylight between
// them. The leaf layer stands on a mass that is inset by its own depth, and
// pushing the TILE PLANE in with everything else leaves two of those depths of
// slot at every join: eight millimetres each side, which does not sound like
// anything and is a bright line of background straight through the hedge. So
// the body is inset and the end planes are not. Two segments' end faces are
// then coincident, and the clusters on the long faces overhang them from both
// sides and close the join.
export function hedgeField({
  half, hy, hz, cy, fillet, batter = 0, capMinus = false, capPlus = false, inset = 0,
}) {
  const by = Math.max(1e-4, hy - fillet);
  const bz = Math.max(1e-4, hz - fillet);
  const loX = -half + (capMinus ? fillet : 0);
  const hiX = half - (capPlus ? fillet : 0);
  const y0 = cy - hy;
  const span = Math.max(1e-4, 2 * hy);
  return (x, y, z) => {
    const u = Math.max(0, Math.min(1, (y - y0) / span));
    const qx = Math.max(loX - x, x - hiX);
    const qy = Math.abs(y - cy) - by;
    const qz = Math.abs(z) - bz * (1 - batter * u);
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    let d = Math.hypot(mx, my, mz) + Math.min(Math.max(qx, qy, qz), 0) - fillet + inset;
    if (!capMinus) d = Math.max(d, -half - x);
    if (!capPlus) d = Math.max(d, x - half);
    return d;
  };
}

// The same field, cut off flat below y = cut. Used to bury the base: the bottom
// fillet of a box hedge is underground and the vertices spent on it are not
// worth carrying.
export function cutField(field, cut) {
  return (x, y, z) => Math.max(field(x, y, z), cut - y);
}

// The same shape, everywhere `d` further in. Adding a constant to a signed
// distance is an exact inward offset, which is why the box is written as a
// distance field and not as a set of half extents to be shrunk: shrinking the
// half extents moves the flat faces in by d and the corners in by d root two,
// so the inset shape would not be parallel to the outer one and the leaf layer
// standing on it would not reach the same surface at a corner as at a face.
export function insetField(field, d) {
  return (x, y, z) => field(x, y, z) + d;
}

// An implicit surface with an icosphere's topology, found by bisection along
// rays from an interior point.
//
// Bisection rather than sphere tracing because only the SIGN of the field has
// to be right, which frees the shapes above from being exact distance fields,
// and because for a convex shape a ray from inside crosses the surface exactly
// once, so there is nothing for a robust method to buy over a simple one.
// Forty steps is 1e-12 of the search span and costs about a hundred thousand
// evaluations for the whole mesh, once, at build time.
export function fieldGeometry({ field, detail = 4, origin = [0, 0, 0], reach = 4 }) {
  const { dirs, index } = icosphere(detail);
  const n = dirs.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const [ox, oy, oz] = origin;
  // A central difference wide enough to straddle the crease in the field's
  // gradient where a flat face meets its fillet, which is what blends the two
  // normals into each other over a couple of vertices instead of stepping
  // between them.
  const EPS = 6e-4;

  for (let i = 0; i < n; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    let lo = 0, hi = reach;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (field(ox + dx * mid, oy + dy * mid, oz + dz * mid) < 0) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

    const gx = field(x + EPS, y, z) - field(x - EPS, y, z);
    const gy = field(x, y + EPS, z) - field(x, y - EPS, z);
    const gz = field(x, y, z + EPS) - field(x, y, z - EPS);
    const gl = Math.hypot(gx, gy, gz) || 1;
    nor[i * 3] = gx / gl; nor[i * 3 + 1] = gy / gl; nor[i * 3 + 2] = gz / gl;
  }

  return finishGeometry(pos, nor, index);
}

function finishGeometry(pos, nor, index) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
  return geo;
}

// --- the nap -----------------------------------------------------------------
//
// Where to put the leaf clusters: points scattered over the mass, area
// weighted, with a spacing test.
//
// Area weighted and NOT on the mass's own vertices, which is how the overgrown
// bush does it. That works there because a lobed dome is tessellated evenly.
// It fails badly on a box: the radial map spends its vertices where the surface
// turns, so the fillets are dense and the flat faces are nearly empty, and a
// nap placed on vertices comes out as a fur trim round the edges of a bald
// panel. Sampling triangles by area gives the same density everywhere whatever
// the tessellation is doing.
//
// BEST CANDIDATE rather than dart throwing, which is the difference between a
// clipped surface and a moth-eaten one. Throwing darts until they stop landing
// saturates at about two thirds of what the spacing allows, and the third that
// is missing is not spread evenly: it is a handful of cluster-sized holes,
// each of which shows the dark mass underneath and reads as a pit in the
// hedge. Generating a batch of candidates per site and keeping the one
// furthest from everything already placed fills the surface at close to the
// packing limit and puts each new cluster in the emptiest place left, which is
// exactly where a pit would otherwise have been.
export function napSites(geo, {
  rand,
  spacing,              // minimum distance between two cluster centres
  sizeAt = null,        // where the clusters are smaller, so is the spacing
  limit = 400,
  candidates = 10,      // how many are generated for each site kept
  jitter = 0.25,        // tangential nudge after the choice, in spacings
  yMin = 0.02,          // nothing below this: it is underground
  faceDown = -0.45,     // nor nothing pointing further down than this
  keep = null,          // nor anywhere this says no: (point, normal) => boolean
}) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const idx = geo.getIndex();
  const tri = idx.count / 3;

  // Cumulative triangle area, so a uniform draw picks a triangle in proportion
  // to how much surface it actually is.
  const cum = new Float64Array(tri);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < tri; t++) {
    a.fromBufferAttribute(pos, idx.getX(t * 3));
    b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
    c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
    ab.subVectors(b, a); ac.subVectors(c, a);
    total += cr.crossVectors(ab, ac).length() * 0.5;
    cum[t] = total;
  }

  const pick = (r) => {
    let lo = 0, hi = tri - 1;
    const want = r * total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < want) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const out = [];
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const bestP = new THREE.Vector3();
  const bestN = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const bit = new THREE.Vector3();

  // Spacing is per site wherever the clusters are, because size and spacing
  // have to shrink together. The cone tapers its clusters to a third over the
  // top of its height, and holding the spacing constant there scattered small
  // clusters at wide intervals over the tip, which showed the dark mass
  // between them and read as a bud on the end of the cone rather than as its
  // point. The test between two sites uses the mean of their spacings, the
  // same way the overgrown bush's two clump sizes share a gap.
  const sp = (q) => spacing * (sizeAt ? sizeAt(q) : 1);

  // A uniform grid over the sites already placed, so the nearest-neighbour
  // query does not walk the whole list. It is the difference between a bush
  // and a stall: the leaf is small enough now that a box carries a thousand
  // clusters, and the naive query is a thousand candidates times ten tries
  // times a thousand neighbours.
  //
  // Cells are TWO spacings across and the search is the twenty-seven cells
  // around the candidate. That is the smallest neighbourhood that is certainly
  // wide enough: wherever in its own cell the candidate sits, the ring of
  // cells round it reaches at least two spacings past it in every direction.
  // Anything further away than that scores over 2 on the normalised metric
  // below, already past the 1 that decides acceptance, so the only thing the
  // cap costs is that a candidate in genuinely open ground cannot say HOW
  // open: it says "at least 2" and ties with every other such candidate. Early
  // on that makes the first few sites arbitrary, which they are anyway.
  //
  // The key is an integer rather than a string. At a thousand sites and ten
  // candidates each this query runs a quarter of a million times per bush, and
  // building a string for every cell of every one of them cost more than the
  // distance tests it was there to avoid.
  const CELL = spacing * 2;
  const cells = new Map();
  const key = (x, y, z) => (((Math.floor(x / CELL) + 512) << 20)
    | ((Math.floor(y / CELL) + 512) << 10)
    | (Math.floor(z / CELL) + 512));
  const FAR2 = 4;   // (2 spacings)^2, in the normalised metric
  const nearest = (q, mine) => {
    const gx = Math.floor(q.x / CELL), gy = Math.floor(q.y / CELL), gz = Math.floor(q.z / CELL);
    let near = FAR2;
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iy = gy - 1; iy <= gy + 1; iy++) {
        for (let iz = gz - 1; iz <= gz + 1; iz++) {
          const bucket = cells.get(((ix + 512) << 20) | ((iy + 512) << 10) | (iz + 512));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const o = bucket[i];
            const mean = 0.5 * (mine + o.sp);
            const d = q.distanceToSquared(o.p) / (mean * mean);
            if (d < near) near = d;
          }
        }
      }
    }
    return Math.sqrt(near);
  };

  // One candidate: a point drawn uniformly over the surface, left in p and nv.
  // False if it landed somewhere no cluster may go.
  const draw = () => {
    const t = pick(rand());
    const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2);
    // Uniform in the triangle: folding the far half of the unit square back
    // over the diagonal covers it evenly, where scaling would pile the samples
    // into one corner.
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    p.set(
      a.x * w + b.x * u + c.x * v,
      a.y * w + b.y * u + c.y * v,
      a.z * w + b.z * u + c.z * v,
    );
    if (p.y < yMin) return false;
    na.fromBufferAttribute(nor, i0); nb.fromBufferAttribute(nor, i1); nc.fromBufferAttribute(nor, i2);
    nv.set(
      na.x * w + nb.x * u + nc.x * v,
      na.y * w + nb.y * u + nc.y * v,
      na.z * w + nb.z * u + nc.z * v,
    ).normalize();
    if (nv.y < faceDown) return false;
    return keep ? keep(p, nv) : true;
  };

  // How many batches in a row may fail before the surface is called full. One
  // is far too few: long before the surface is saturated there are batches
  // where all ten candidates happen to land in the crowded parts, and stopping
  // at the first of those gave a nap two thirds the density it asked for.
  const patience = 30;
  let idle = 0;
  while (out.length < limit && idle < patience) {
    // Scored in multiples of the spacing the pair asks for, so a candidate on
    // the fine part of the surface competes fairly with one on the coarse
    // part. One is exactly touching; anything under one is too close.
    let far = -1;
    for (let k = 0; k < candidates; k++) {
      if (!draw()) continue;
      const near = nearest(p, sp(p));
      if (near > far) { far = near; bestP.copy(p); bestN.copy(nv); }
    }
    if (far < 1) { idle++; continue; }
    idle = 0;

    // AND THEN IT IS NUDGED OFF ITS OWN BEST SPOT. Best-candidate packs a
    // surface evenly, and on a surface of revolution "evenly" means rings: the
    // emptiest place on a cone is always an annulus, so the clusters land in
    // bands at constant height and the finished cone reads as a pinecone
    // rather than as a clipped yew. A tangential nudge of a quarter of the
    // spacing is small enough that the coverage the search just bought
    // survives it, and large enough that no two neighbouring clusters share a
    // height. Along the surface, not through it, so the cluster still sits on
    // the mass afterwards.
    if (jitter > 0) {
      tan.set(bestN.z, 0, -bestN.x);
      if (tan.lengthSq() < 1e-6) tan.set(1, 0, 0);
      tan.normalize();
      bit.crossVectors(bestN, tan);
      const ang = rand() * TAU;
      const mag = jitter * sp(bestP) * Math.sqrt(rand());
      bestP.addScaledVector(tan, Math.cos(ang) * mag).addScaledVector(bit, Math.sin(ang) * mag);
    }

    const site = { p: bestP.clone(), n: bestN.clone(), sp: sp(bestP) };
    out.push(site);
    const k = key(site.p.x, site.p.y, site.p.z);
    const bucket = cells.get(k);
    if (bucket) bucket.push(site); else cells.set(k, [site]);
  }
  return out;
}

// One leaf cluster per site, sunk so that its tip lands on the shape.
//
// Flattened along its own axis, because a clipped surface is made of clusters
// lying ON it, not of berries sitting on top of it: a round lump reads as a
// bead and a field of beads reads as gravel. Two or three broad lobes give each
// one an outline of its own, which is what keeps the surface from looking
// quilted, and the aim is exactly the surface normal with only a few degrees of
// jitter. The overgrown bush aims its tufts a quarter of a radian upward
// because foliage grows toward the light; a clipped one has had exactly that
// growth cut off, and aiming these upward puts a fringe along the top of every
// face.
export function buildNap(sites, {
  rand,
  radius,               // cluster radius on the surface
  spread = 0.30,        // how much cluster radii vary
  nap,                  // how far a tip stands above the mass
  napAt = null,         // or that depth per site, where the mass was inset unevenly
  jitter = 0.12,        // and how unequal the tips are, as a fraction of nap
  flat = 0.34,          // squash along the cluster's own axis
  tilt = 0.14,          // radians of aim scatter
  flutterTop = 1,       // world y at which flutter reaches full weight
  sizeAt = null,        // per-site multiplier on the cluster radius
  detail = 1,
}) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  const aim = new THREE.Vector3();
  const at = new THREE.Vector3();
  const index = icosphere(detail).index;

  for (const s of sites) {
    const r = radius * (sizeAt ? sizeAt(s.p) : 1) * (1 - spread * 0.5 + rand() * spread);
    const lobes = makeLobes(rand, { count: 3, amp: [0.10, 0.28], tight: [1.6, 3.2], yBias: 0.1 });
    const pos = lumpPositions({ detail, lobes, scaleY: flat });
    // Unequal in plan, so no cluster is a body of revolution and a spun copy of
    // its neighbour.
    const kx = 0.80 + rand() * 0.44;
    const kz = 0.80 + rand() * 0.44;
    let tip = 0;
    for (let j = 0; j < pos.length; j += 3) {
      pos[j] *= r * kx;
      pos[j + 1] *= r;
      pos[j + 2] *= r * kz;
      if (pos[j + 1] > tip) tip = pos[j + 1];
    }

    // THE LINE THAT KEEPS THE OUTLINE. The cluster's own reach along its own
    // axis is measured, not assumed, and it is then sunk by exactly that much
    // less the nap depth. Whatever the lobes did to it, its tip lands on the
    // shape the gardener cut, give or take the jitter.
    const stand = (napAt ? napAt(s.p) : nap) * (1 - jitter * rand());
    aim.copy(s.n);
    aim.x += (rand() - 0.5) * tilt;
    aim.y += (rand() - 0.5) * tilt;
    aim.z += (rand() - 0.5) * tilt;
    aim.normalize();
    at.copy(s.p).addScaledVector(aim, stand - tip);

    q.setFromUnitVectors(up, aim);
    spin.makeRotationY(rand() * TAU);
    m.makeRotationFromQuaternion(q).multiply(spin).setPosition(at);

    // Constant across the cluster, which is the whole argument for leaving
    // flutter out of the shader's Jacobian: see bakeWind in wind.js.
    const u = Math.max(0, Math.min(1, s.p.y / flutterTop));
    parts.push({
      positions: pos,
      index,
      matrix: m.clone(),
      phase: rand(),
      tint: rand(),
      flutter: Math.pow(u, 1.5),
    });
  }
  return parts;
}
