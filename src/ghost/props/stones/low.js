import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial } from '../style.js';

// The three low pieces of the second graveyard set: an urn on a plinth, a
// spiral-carved boulder, and a small broken round-top stone standing in a ring
// of rubble. Everything is the same soft matte vinyl as the tall stones -- pale
// grey, generously rounded, no hard edges anywhere.
//
// Two things about this file before the code.
//
// FIRST, the engraving. The treatment in tombstones.js -- a wide weak occlusion
// smudge, a dark recess that stops short of black, a shaded wall under the top
// edge of the cut and a catch-light along its bottom lip, all of it doubled by
// a normal map baked off a blurred copy of the same artwork -- is the approved
// look, and the spirals and outline grooves here need exactly it. It is
// reproduced below rather than imported because tombstones.js exports only its
// factory, and that file is not mine to edit. If it is ever refactored, the
// halves to keep in step are buildTextures/lipMask/heightToNormalMap.
//
// SECOND, the curved face. tombstones.js paints its cut into a FLAT slab face,
// where a planar UV projection is exact. The boulder has no flat face; its
// carved side is a bulging surface. What makes the treatment survive that:
//
//   - The seam. The projection covers the +Z hemisphere only, and the ring
//     where the surface turns away from the camera is a real ring of vertices
//     in the mesh, duplicated so the front half carries face UVs and the back
//     half does not. Without that the spirals mirror onto the back.
//   - The rim. A planar projection compresses to nothing at that silhouette
//     ring, so the outermost texels smear all the way round the rock and the
//     derivative-based tangent frame that MeshStandardMaterial builds for the
//     normal map degenerates there. Both maps are therefore faded back to
//     neutral in a band round the edge of the face, and no carving is drawn
//     within 0.078 world units of the silhouette, which is a seventh of the
//     face's height. Inside that margin the surface still faces the camera and
//     the treatment behaves exactly as it does on a slab.
//   - The lips. The catch-light assumes the cut's lower wall faces up. On a
//     face that rolls away at the edges that assumption weakens with the
//     cosine, which is another reason the artwork stays in the middle third of
//     the roll where the face is nearly frontal.
//
// The alternative -- projecting from the camera, or a triplanar blend -- was not
// needed: a spiral is a flat motif and wants to stay circular, and a triplanar
// blend would have cross-faded a second copy of it in from the side.

export const LOW_VARIANTS = ['urn', 'boulder', 'brokenRing'];

// ---------------------------------------------------------------------------
// deterministic noise

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// outlines
//
// Every silhouette in this file -- plinth block, boulder, broken stone, pebble
// -- is the convex hull of a handful of circles. Two properties are why:
//
//   - It cannot produce a hard edge. Between any two circles the hull runs
//     along their common tangent and arrives tangent to each arc, so the curve
//     is C1 everywhere by construction and the vertex normal is the arc's own
//     normal. No computeVertexNormals, no smoothing groups, no faceting.
//   - Insetting is free. Shrinking every radius by d and leaving the centres
//     alone gives the outline offset inward by exactly d, and the tangent
//     angles do not move, because they depend on the DIFFERENCE of two radii
//     and that difference is unchanged. So a swept edge is a family of rings
//     that are all the same shape, and a groove that parallels the outline is
//     the same outline drawn at a different inset.

// Where the common outer tangent leaves circle a and lands on circle b, as an
// angle on both circles, walking counter-clockwise with the interior on the
// left. For equal radii this is the direction a->b turned a right angle
// clockwise, which is the bottom of the pair when b is to the right of a.
function tangentAngle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return Math.atan2(dy, dx) - Math.acos(clamp((a.r - b.r) / L, -1, 1));
}

// Drop circles that cannot contribute an arc: one swallowed by a neighbour, or
// one whose arc has been squeezed to nothing because it sits inside the hull of
// the others. Cheaper and more predictable than a real hull-of-circles pass,
// and enough for hand-placed circles that are already nearly in convex
// position -- which every set in this file is.
function pruneCircles(circles) {
  let list = circles.slice();
  for (let pass = 0; pass < 8 && list.length > 2; pass++) {
    let worst = -1;
    let worstSweep = 1e-3;
    for (let i = 0; i < list.length; i++) {
      const prev = list[(i - 1 + list.length) % list.length];
      const cur = list[i];
      const next = list[(i + 1) % list.length];
      if (Math.hypot(cur.x - next.x, cur.y - next.y) <= Math.abs(cur.r - next.r)) {
        worst = cur.r <= next.r ? i : (i + 1) % list.length;
        worstSweep = -1;
        break;
      }
      let a0 = tangentAngle(prev, cur);
      let a1 = tangentAngle(cur, next);
      while (a1 < a0) a1 += Math.PI * 2;
      if (a1 - a0 < worstSweep) {
        worstSweep = a1 - a0;
        worst = i;
      }
    }
    if (worst < 0) break;
    list = list.filter((_, i) => i !== worst);
  }
  return list;
}

// An outline, ready to be swept. `ring(inset)` is the same curve offset inward,
// sampled at a fixed vertex count so consecutive rings can be stitched.
function makeOutline(circles, budget = SEGMENTS.radial) {
  const list = pruneCircles(circles);
  const n = list.length;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const c = list[i];
    let a0 = tangentAngle(list[(i - 1 + n) % n], c);
    let a1 = tangentAngle(c, list[(i + 1) % n]);
    while (a1 < a0) a1 += Math.PI * 2;
    arcs.push({ cx: c.x, cy: c.y, r: c.r, a0, a1, seg: 2 });
  }
  const total = arcs.reduce((s, a) => s + a.r * (a.a1 - a.a0), 0);
  for (const a of arcs) a.seg = Math.max(2, Math.round((budget * a.r * (a.a1 - a.a0)) / total));
  const count = arcs.reduce((s, a) => s + a.seg + 1, 0);
  // Where each arc's samples begin in the ring, so a caller can stroke an OPEN
  // run of the outline and stop at a chosen tangent line.
  const arcStart = [];
  arcs.reduce((at, a) => {
    arcStart.push(at);
    return at + a.seg + 1;
  }, 0);

  const ring = (inset) => {
    const out = [];
    for (const a of arcs) {
      const r = Math.max(0, a.r - inset);
      for (let j = 0; j <= a.seg; j++) {
        const t = a.a0 + (a.a1 - a.a0) * (j / a.seg);
        const nx = Math.cos(t);
        const ny = Math.sin(t);
        out.push({ x: a.cx + r * nx, y: a.cy + r * ny, nx, ny });
      }
    }
    return out;
  };

  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of ring(0)) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const maxInset = Math.min(...arcs.map((a) => a.r));
  return { arcs, arcStart, count, ring, bounds: { x0, x1, y0, y1 }, maxInset };
}

// A rounded rectangle standing on y = 0, as four circles.
function boxOutline(halfWidth, height, corner) {
  const r = Math.min(corner, halfWidth * 0.9, height * 0.45);
  return [
    { x: halfWidth - r, y: r, r },
    { x: halfWidth - r, y: height - r, r },
    { x: -(halfWidth - r), y: height - r, r },
    { x: -(halfWidth - r), y: r, r },
  ];
}

// ---------------------------------------------------------------------------
// geometry: the puff sweep
//
// The tall stones' construction, in short: run the outline front to back
// through a quarter-round edge profile, so the piece is a slab whose every
// corner and rim is one continuous rounded surface. With edge = depth/2 there
// is no straight side wall left and the result is a pillow, which is what the
// plinth mouldings want. Normals are analytic at every vertex.

function buildPuffGeometry({ outline, depth, edge, uv }) {
  const hz = depth / 2;
  const e = Math.min(edge, hz, outline.maxInset * 0.98);
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));

  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: hz - e + e * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  // The silhouette ring twice over: the front copy carries the face UVs, the
  // back copy plain stone, so the texture seam hides on the widest edge where
  // nothing can see it.
  profile.push({ inset: 0, z: hz - e, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - e), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: -(hz - e + e * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), front: false });
  }

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz, front) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    const [u, v] = uv(x, y, front);
    uvs.push(u, v);
  };

  const N = outline.count;
  for (const p of profile) {
    for (const q of outline.ring(p.inset)) {
      push(q.x, q.y, p.z, q.nx * p.ns, q.ny * p.ns, p.nz, p.front);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j;
      const b = i * N + j2;
      const c = (i + 1) * N + j2;
      const d = (i + 1) * N + j;
      idx.push(a, c, b, a, d, c);
    }
  }

  // Flat front and back caps, fanned from the outline's centre. Convex outline,
  // so a fan is a valid triangulation.
  const mx = (outline.bounds.x0 + outline.bounds.x1) / 2;
  const my = (outline.bounds.y0 + outline.bounds.y1) / 2;
  const cFront = pos.length / 3;
  push(mx, my, hz, 0, 0, 1, true);
  const cBack = pos.length / 3;
  push(mx, my, -hz, 0, 0, -1, false);
  const last = (profile.length - 1) * N;
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    idx.push(cFront, j, j2);
    idx.push(cBack, last + j2, last + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// geometry: the lump
//
// A rock, not a slab. Same outline, but instead of insetting it toward a flat
// face, each ring is the whole outline SCALED about an interior point by sin
// theta while z runs as cos theta -- a generalised ellipsoid. Feed it a circle
// and you get a sphere; feed it a low wide dome and you get a boulder.
//
// Why scaling and not insetting: an inset family closes on a flat cap, and a
// flat cap in the middle of the carved face is precisely where the spirals go.
// Scaling closes on a point, so the face bulges all the way to its pole and the
// grooves have to bend over real curvature.
//
// The normal is analytic. With t the counter-clockwise tangent of the outline
// and n its outward normal, the surface normal is
//   (n.x * hz * sin, n.y * hz * sin, cos * (n . (p - centre)))
// which needs no differencing and, being a formula rather than an average, is
// identical on both copies of the duplicated seam ring. Averaged normals there
// would have left a lit crease all the way round the silhouette.
// Walk a closed polyline and lay n points on it at equal arc length.
//
// makeOutline puts vertices only on the ARCS: between two of them the outline
// is a straight tangent run, and two endpoints describe it exactly. That is
// true of the outline and false of the lump built from it, because scaling a
// straight run toward a pole sweeps a curved surface, and with no vertices
// along the run that surface came out as four flat facets meeting at the pole
// in a dark X. Nothing about the shape was wrong; it had no samples.
function resampleClosed(pts, n) {
  const m = pts.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }
  const out = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (i < m - 1 && walked + seg[i] < want) {
      walked += seg[i];
      i++;
    }
    const t = seg[i] > 1e-9 ? (want - walked) / seg[i] : 0;
    const a = pts[i];
    const b = pts[(i + 1) % m];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function buildLumpGeometry({ outline, centre, halfDepth, sweep = 14, ring = 48, uv }) {
  const eq = resampleClosed(outline.ring(0), Math.max(ring, outline.count));
  const N = eq.length;
  const cx = centre.x;
  const cy = centre.y;
  const K = 2 * sweep;

  // The outline in polar form about the centre, which is what lets a ring be
  // rounded off toward a circle without moving its vertices angularly.
  const polar = eq.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const r = Math.hypot(dx, dy) || 1e-6;
    return { r, ux: dx / r, uy: dy / r };
  });
  const rMean = polar.reduce((acc, q) => acc + q.r, 0) / N;

  // Scaling the outline straight down to a point makes a CONE over that
  // outline, and the outline's straight tangent runs then show up as flat
  // facets radiating from each pole. That was plainly visible as a dark X
  // across the back of the boulder. So each ring is blended toward a circle of
  // the same mean radius as it approaches a pole -- cos^4, which is nothing at
  // the silhouette and nearly total by the time the ring is small enough to
  // matter. The equator, which is the whole silhouette, is untouched.
  const point = (k, j) => {
    const th = (k / K) * Math.PI;
    const s = Math.sin(th);
    const c = Math.cos(th);
    const w = c * c * c * c;
    const r = (polar[j].r * (1 - w) + rMean * w) * s;
    return [cx + polar[j].ux * r, cy + polar[j].uy * r, halfDepth * c];
  };

  const grid = [];
  for (let k = 0; k <= K; k++) {
    const row = [];
    for (let j = 0; j < N; j++) row.push(point(k, j));
    grid.push(row);
  }

  // Normals by central difference on that grid. Analytic normals were fine for
  // a pure scaling but the ring blend is not one, and a difference is exact
  // enough at these segment counts. It also has the property the seam needs:
  // both copies of the equator read the SAME grid rows, so they get bitwise
  // identical normals and the duplicated ring cannot show as a crease.
  const normalAt = (k, j) => {
    if (k === 0) return [0, 0, 1];
    if (k === K) return [0, 0, -1];
    const a = grid[k + 1][j];
    const b = grid[k - 1][j];
    const cN = grid[k][(j + 1) % N];
    const d = grid[k][(j - 1 + N) % N];
    const ux = a[0] - b[0];
    const uy = a[1] - b[1];
    const uz = a[2] - b[2];
    const vx = cN[0] - d[0];
    const vy = cN[1] - d[1];
    const vz = cN[2] - d[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const emit = (k, front) => {
    const t = k / K;
    for (let j = 0; j < N; j++) {
      const q = grid[k][j];
      const n = normalAt(k, j);
      pos.push(q[0], q[1], q[2]);
      nor.push(n[0], n[1], n[2]);
      const [u, v] = uv(q[0], q[1], front, t);
      uvs.push(u, v);
    }
  };

  let rings = 0;
  for (let k = 0; k <= sweep; k++) {
    emit(k, true);
    rings++;
  }
  for (let k = sweep; k <= K; k++) {
    emit(k, false);
    rings++;
  }
  // The two copies of the equator sit at the same place, so the quad ring
  // between them is degenerate and free.
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j;
      const b = i * N + j2;
      const c = (i + 1) * N + j2;
      const d = (i + 1) * N + j;
      idx.push(a, c, b, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// textures
//
// Duplicated from tombstones.js on purpose; see the note at the top of the
// file. The one addition is `rim`, which fades both maps back to neutral in a
// band round the face -- needed only where the face is curved.

const GRIME = 0.2;

function mottle(ctx, w, h, rng, light, dark, strength, speckle = true) {
  for (let i = 0; i < 130; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.035 + rng() * 0.13) * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() < 0.5 ? light : dark;
    g.addColorStop(0, `rgba(${col}, ${strength})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rng() * 0.9), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!speckle) return;
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${rng() < 0.5 ? light : dark}, ${strength * 0.55})`;
    ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }
}

// The band of a mark that lies just inside one of its edges: the mark minus a
// copy of itself shifted off that edge. The two walls of the groove.
function lipMask(marks, dx, dy, colour) {
  const c = document.createElement('canvas');
  c.width = marks.width;
  c.height = marks.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(marks, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(marks, dx, dy);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// Tangent-space normal map from a height canvas. A bumpMap would soften as the
// camera pulls back, because its relief comes from screen-space derivatives;
// slopes baked here hold at any distance.
function heightToNormalMap(canvas, strength) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => src[((y < 0 ? 0 : y > h - 1 ? h - 1 : y) * w + (x < 0 ? 0 : x > w - 1 ? w - 1 : x)) * 4] / 255;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Bottom row first: DataTexture ignores flipY, so the flip a CanvasTexture
    // gets for free has to happen here by hand.
    const row = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const gx = at(x + 2, y) - at(x - 2, y);
      const gy = at(x, y + 2) - at(x, y - 2);
      const nx = -gx * strength;
      const ny = gy * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      out[i] = (nx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Wash the outer band of the face region back to `flat`. On the boulder the
// planar projection is compressed to nothing at the silhouette, so whatever the
// last texel column holds gets smeared right round the rock, and the tangent
// frame the shader derives from those UVs is meaningless there. Neutral grey on
// the height map and white on the colour map means the smear carries nothing.
function fadeRim(ctx, w, h, flat, frac) {
  const band = Math.round(Math.min(w, h) * frac);
  const runs = [
    [0, 0, band, h, band, 0],
    [w - band, 0, band, h, -band, 0],
    [0, 0, w, band, 0, band],
    [0, h - band, w, band, 0, -band],
  ];
  for (const [x, y, rw, rh, gx, gy] of runs) {
    const x0 = gx < 0 ? x + rw : x;
    const y0 = gy < 0 ? y + rh : y;
    const g = ctx.createLinearGradient(x0, y0, x0 + gx, y0 + gy);
    g.addColorStop(0, flat);
    g.addColorStop(1, flat.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, rw, rh);
  }
}

// Colour map and normal map for one stone. The face artwork occupies a region
// of exact face aspect on the left; the strip on the right is plain stone that
// every unmapped mesh samples, so nothing wraps round a corner.
function buildTextures({ faceAspect, draw, rng, rim = 0 }) {
  const FH = 1024;
  const FW = Math.max(64, Math.round(FH * faceAspect));
  const STRIP = 160;
  const w = FW + STRIP;

  const colour = document.createElement('canvas');
  colour.width = w;
  colour.height = FH;
  const cc = colour.getContext('2d');
  // White base: PALETTE.stone lives on the material and stays the single
  // source of truth for the hue; the map only carries detail.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, FH);
  mottle(cc, w, FH, rng, '120,116,110', '255,255,255', 0.085);

  // Ground grime along the bottom edge. It does a second job: pieces mapped
  // into the bottom of the strip pick it up, which is what stops an up-facing
  // moulding from reading as a whiter material than the stone above it.
  const grime = cc.createLinearGradient(0, FH * (1 - GRIME * 3.4), 0, FH);
  grime.addColorStop(0, 'rgba(146,142,136,0)');
  grime.addColorStop(1, 'rgba(146,142,136,0.34)');
  cc.fillStyle = grime;
  cc.fillRect(0, FH * (1 - GRIME * 3.4), w, FH * GRIME * 3.4);

  const height = document.createElement('canvas');
  height.width = w;
  height.height = FH;
  const hc = height.getContext('2d');
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w, FH);
  mottle(hc, w, FH, mulberry32(1), '96,96,96', '176,176,176', 0.065, false);

  if (rim > 0) {
    cc.save();
    cc.beginPath();
    cc.rect(0, 0, FW, FH);
    cc.clip();
    fadeRim(cc, FW, FH, 'rgba(255,255,255,1)', rim);
    cc.restore();
    hc.save();
    hc.beginPath();
    hc.rect(0, 0, FW, FH);
    hc.clip();
    fadeRim(hc, FW, FH, 'rgba(128,128,128,1)', rim);
    hc.restore();
  }

  if (draw) {
    const marks = document.createElement('canvas');
    marks.width = FW;
    marks.height = FH;
    const mctx = marks.getContext('2d');
    mctx.fillStyle = '#000000';
    mctx.strokeStyle = '#000000';
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    draw(mctx, FW, FH);

    // The groove. A wall about eleven texels wide, because this face is a
    // thousand texels shown across maybe a hundred and fifty screen pixels and
    // a narrower wall mips away to nothing before it is ever seen.
    const WALL = Math.max(6, Math.round(FH * 0.011));
    const LIP = Math.max(3, Math.round(FH * 0.006));
    const topLip = lipMask(marks, 0, LIP, '#000000');
    const bottomLip = lipMask(marks, 0, -LIP, '#ffffff');

    const stamp = (ctx, img, alpha, op = 'multiply', blur = 0) => {
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = alpha;
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(img, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    // Wide weak smudge: the ambient that never reaches into a cut, spilling a
    // little past its edges the way a real occlusion does. Then the body of the
    // recess, dark enough to read as shadow and no darker -- pushed harder it
    // goes to ink, and carved stone in shade is grey. Then the two walls.
    stamp(cc, marks, 0.16, 'multiply', WALL * 1.6);
    stamp(cc, marks, 0.36);
    stamp(cc, topLip, 0.4, 'multiply', 1.5);
    stamp(cc, bottomLip, 0.42, 'screen', 1.5);

    // Height: dark is low. Blurred once for a wall that ramps rather than
    // steps, then a tighter second pass so a thin stroke still reaches the
    // bottom of the cut instead of being rounded off into a scratch.
    stamp(hc, marks, 1, 'multiply', WALL);
    stamp(hc, marks, 1, 'multiply', Math.round(WALL * 0.35));
  }

  // A dead flat patch in the middle of the strip, on both maps.
  //
  // This is what the far side of a lump samples, and it is not laziness. Two
  // different UV mappings meeting at the seam ring showed as a lit crease all
  // the way round the rock: on the front the rim is washed to neutral, on the
  // back the strip's own mottle was still there, and worse, the strip is 160
  // texels stretched round a whole hemisphere, so its UV derivatives collapse
  // and the tangent frame the shader builds from them is meaningless. A
  // constant UV makes the derivative exactly zero, which three handles by
  // dropping the perturbation entirely, and the colour matches the washed rim
  // it meets. Detail lost: mottle on the hidden half of a rock.
  // It lives in the top band of the strip, above every other user's v range;
  // parked across the middle it cut a hard horizontal line across the back of
  // anything mapped through the strip with a tall v span.
  cc.fillStyle = '#ffffff';
  cc.fillRect(FW, 0, STRIP, FH * 0.14);
  hc.fillStyle = '#808080';
  hc.fillRect(FW, 0, STRIP, FH * 0.14);

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return {
    map,
    normalMap: heightToNormalMap(height, 14),
    frontFrac: FW / w,
    stripFrac: STRIP / w,
    flat: [(FW + STRIP * 0.5) / w, 0.93],
  };
}

// ---------------------------------------------------------------------------
// artwork

// The two groove widths this file draws with, in world units.
//
// This is the whole reason the artwork was redrawn. A cut reads as carved
// because it is THIN and the light finds its two walls; the first pass stroked
// everything at 0.034, a groove wider than the ridge of stone left between two
// turns of a spiral, and the marks came out stamped into the rock rather than
// cut into it.
//
// The floor is set by the groove treatment itself, not by taste. The recess is
// walled by a blur of WALL texels with a LIP inside each edge -- about
// seventeen of the face's thousand texels all told -- so under roughly 0.010
// world units the two walls meet in the middle and the cut flattens into a
// scratch. These sit just above that, and at eighty pixels they measure about
// the same on screen as the approved set's lettering does.
const GROOVE = 0.0150; // the spirals and the grooves that link them
const HAIRLINE = 0.0110; // the fillers, the small spirals, the edge grooves

const SERIF = '"Liberation Serif", "Times New Roman", Georgia, serif';

// A smooth polyline: quadratic segments through the midpoints of the input, so
// the curve is C1 and no control point has to be authored twice.
function strokeSmooth(ctx, pts, width) {
  if (pts.length < 2) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.quadraticCurveTo(
      pts[pts.length - 2][0], pts[pts.length - 2][1],
      pts[pts.length - 1][0], pts[pts.length - 1][1],
    );
  }
  ctx.stroke();
}

// A dense polyline stroked as it stands. Sampled curves -- an offset outline,
// a zigzag -- already carry their own shape, and running them through
// strokeSmooth would round the corners a chevron is made of.
function strokePoly(ctx, pts, width, close = false) {
  if (pts.length < 2) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

// An Archimedean spiral, sampled from the middle outward and ending at a chosen
// angle so its tail can be aimed at whatever it links to.
function spiralPoints(cx, cy, rOuter, rInner, turns, aEnd, dir) {
  const total = turns * Math.PI * 2;
  const steps = Math.max(64, Math.round(turns * 90));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = aEnd - dir * (1 - t) * total;
    const r = rInner + (rOuter - rInner) * t;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// A run of the outline offset inward: the long grooves that follow the edge of
// the rock, which every kerbstone in the reference carries and the first pass
// had none of.
//
// The run is picked by the outward NORMAL's angle rather than by vertex index,
// which is what keeps it stable when the outline's circles are edited. The
// outline is convex, so its normal angle increases monotonically round the
// ring and an angle window is always exactly one contiguous arc; the straight
// tangent runs between arcs come through as the jumps between consecutive
// samples, which is what makes the top of this rock one long straight groove
// rather than a chain of little ones.
function edgeRun(outline, inset, aFrom, aTo) {
  const pts = [];
  for (const p of outline.ring(inset)) {
    let a = (Math.atan2(p.ny, p.nx) * 180) / Math.PI;
    if (a < aFrom) a += 360;
    if (a >= aFrom && a <= aTo) pts.push([p.x, p.y]);
  }
  return pts;
}

// A chain of lozenges along a line. Neighbours share a vertex, so the chain
// reads as one continuous cut and not as a row of loose diamonds.
function lozengeChain(ctx, from, to, count, halfW, P, width) {
  const dx = (to[0] - from[0]) / count;
  const dy = (to[1] - from[1]) / count;
  const L = Math.hypot(dx, dy) || 1e-6;
  const px = (-dy / L) * halfW;
  const py = (dx / L) * halfW;
  for (let i = 0; i < count; i++) {
    const ax = from[0] + dx * i;
    const ay = from[1] + dy * i;
    const mx = ax + dx / 2;
    const my = ay + dy / 2;
    strokePoly(ctx, [
      [ax, ay], [mx + px, my + py], [ax + dx, ay + dy], [mx - px, my - py],
    ].map(P), width, true);
  }
}

// A chevron band: one zigzag between two points. Nested vees were tried first
// and are the more literal reading of the reference, but three of them inside
// each other is three grooves within a groove's width of one another, and they
// merged into a wedge of shadow long before eighty pixels.
function chevronBand(ctx, from, to, count, amp, P, width) {
  const pts = [];
  for (let i = 0; i <= count * 2; i++) {
    const t = i / (count * 2);
    pts.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + (i % 2 ? amp : -amp) / 2,
    ]);
  }
  strokePoly(ctx, pts.map(P), width);
}

// The Newgrange kerbstone face, in the boulder's own units, drawn through a
// transform that maps face coordinates to texels.
//
// The reference stones are not two big spirals. They carry spirals of several
// sizes, lozenge and chevron bands filling the ground between them, and long
// grooves running parallel to the edge of the rock. The first pass had four
// marks at twice this width; they covered three quarters of the face and read
// as a snail stamped into a pebble. This has nine, every one of them smaller,
// and they cover about half the face box and a fourteenth of its area.
//
// The right-hand third is deliberately bare. That is the end the crack took
// off, and a carving that ran into the break would have to be broken too;
// stopping the composition short of it says the same thing and costs nothing.
//
// Placement is not a free hand. Two rules hold the whole layout together:
//
//   - Nothing comes within 0.078 of the silhouette. Inside that band the
//     planar projection is compressed, the rim fade is already washing both
//     maps back toward neutral, and a groove drawn there stretches into a
//     gash. The first pass ran to 0.040 of it and the long band showed it.
//   - Neighbouring marks keep at least 0.015 of plain rock between their
//     EDGES, not their centres, and a spiral's own turns keep the same. Two
//     cuts closer than the wall blur merge into one wide smudge, which is a
//     large part of what made the first pass look thick.
function drawBoulderFace(ctx, W, H, face, outline) {
  const sx = W / (face.x1 - face.x0);
  const sy = H / (face.y1 - face.y0);
  const X = (x) => (x - face.x0) * sx;
  const Y = (y) => H - (y - face.y0) * sy;
  const P = (p) => [X(p[0]), Y(p[1])];
  const main = GROOVE * sx;
  const fine = HAIRLINE * sx;

  // Four spirals, largest to smallest, walking down the rock from the high
  // left toward the break. Turn counts are set by the pitch and not chosen:
  // each spiral gains about 0.030 of radius per turn, which is twice the
  // groove, so a turn of stone always survives between two turns of cut.
  const A = { x: -0.398, y: 0.302, r: 0.070, aEnd: -0.49 };
  const B = { x: -0.243, y: 0.232, r: 0.052, aEnd: 2.93 };
  const C = { x: -0.150, y: 0.330, r: 0.038, aEnd: -1.22 };
  const D = { x: -0.520, y: 0.225, r: 0.032, aEnd: 1.85 };
  strokeSmooth(ctx, spiralPoints(A.x, A.y, A.r, 0.011, 1.8, A.aEnd, 1).map(P), main);
  strokeSmooth(ctx, spiralPoints(B.x, B.y, B.r, 0.011, 1.5, B.aEnd, -1).map(P), main);
  strokeSmooth(ctx, spiralPoints(C.x, C.y, C.r, 0.008, 1.3, C.aEnd, 1).map(P), fine);
  // The smallest is barely three quarters of a turn. A curl at this size is
  // all the room there is: at a full turn its own two turns are 0.020 apart
  // and they close up.
  strokeSmooth(ctx, spiralPoints(D.x, D.y, D.r, 0.010, 0.75, D.aEnd, -1).map(P), fine);

  // The links. Their ends sit exactly on the spirals' outer ends, so the run
  // reads as one continuous groove rather than as marks that nearly touch.
  const tail = (s) => [s.x + s.r * Math.cos(s.aEnd), s.y + s.r * Math.sin(s.aEnd)];
  strokeSmooth(ctx, [tail(A), [-0.314, 0.250], tail(B)].map(P), main);
  strokeSmooth(ctx, [tail(C), [-0.116, 0.286], [-0.086, 0.262]].map(P), fine);

  // The lozenge chain the smallest spiral runs into, and the chevron band
  // along the bottom. These are the ground filler: at close range they are
  // what makes the face look worked rather than decorated in two places, and
  // at eighty pixels they go to a texture, which is what filler is for.
  lozengeChain(ctx, [-0.086, 0.262], [0.086, 0.176], 3, 0.026, P, fine);
  chevronBand(ctx, [-0.455, 0.128], [-0.190, 0.128], 4, 0.064, P, fine);

  // Two long grooves following the top edge. The window is cut off at 112
  // degrees on purpose: carried further round it swings down the tangent run
  // on the upper left and passes within a groove's width of the big spiral.
  strokePoly(ctx, edgeRun(outline, 0.078, 58, 112).map(P), fine);
  strokePoly(ctx, edgeRun(outline, 0.112, 58, 112).map(P), fine);
}

// The broken stone's face: a border groove that follows the stone's own
// silhouette, a finer line inside it over the crown, and what the weather has
// left of the lettering.
//
// The border is stroked OPEN, starting at the crown arc and running all the
// way round to the point before it, so its two loose ends land on the tangent
// run that is the break. The mason cut this groove before the stone lost its
// corner, so it has to run to the break and stop dead there rather than turn
// the corner with it.
//
// Drawing it from an intact round-top outline instead was tried and is worse:
// the surviving crown is a different circle from the intact one, so the groove
// wandered off the real edge and faded out halfway over the top.
function drawOutlineGroove(ctx, W, H, face, outline, openAtArc, inset, width) {
  const sx = W / (face.x1 - face.x0);
  const sy = H / (face.y1 - face.y0);
  const ring = outline.ring(inset);
  const from = outline.arcStart[openAtArc];
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(from + i) % ring.length];
    pts.push([(p.x - face.x0) * sx, H - (p.y - face.y0) * sy]);
  }
  strokePoly(ctx, pts, width * sx);
}

// Letters cut shallow. Alpha is not a shortcut for grey here: the mark canvas
// is a mask that the recess, both lips and the height map are all stamped
// through, so a half-alpha letter is a half-DEPTH letter, which is what a cut
// that has been weathering for a century and a half actually is.
function inkWornText(ctx, text, cx, cy, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Font metrics put the alphabetic baseline low and the em box high, so
  // centring on the glyphs' own ink is the only way two lines come out even.
  const m = ctx.measureText(text);
  ctx.fillText(text, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  ctx.restore();
}

function drawBrokenFace(ctx, W, H, face, outline, openAtArc) {
  const sx = W / (face.x1 - face.x0);
  const sy = H / (face.y1 - face.y0);
  const X = (x) => (x - face.x0) * sx;
  const Y = (y) => H - (y - face.y0) * sy;

  // The lettering first, because the nicks that follow have to bite the
  // letters and leave the border whole. A stone loses its inscription to
  // weather long before it loses the deep groove round its edge.
  inkWornText(ctx, 'R.I.P.', X(-0.050), Y(0.345), 0.072 * sy, 0.62);
  inkWornText(ctx, '1874', X(-0.050), Y(0.232), 0.052 * sy, 0.40);

  // Five soft bites out of the inscription. Hand-placed rather than seeded:
  // the piece's own rng lays out the rubble ring, and drawing from it here
  // would move sixteen pebbles every time a letter changed.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const [x, y, r] of [
    [-0.150, 0.352, 0.030], [-0.010, 0.362, 0.022], [0.062, 0.330, 0.026],
    [-0.086, 0.238, 0.024], [0.030, 0.222, 0.019],
  ]) {
    const g = ctx.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * sx);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), r * sx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The border, at the inset it has always been at -- only the width has come
  // down, from 0.022 to a shade over half of it -- and a finer line inside it
  // running over the crown alone, the way a headstone's arch is moulded twice.
  // The two are 0.030 apart, which leaves 0.018 of plain stone between them:
  // more than the wall blur on both of them put together, so they read as two
  // lines and not as one wide one.
  drawOutlineGroove(ctx, W, H, face, outline, openAtArc, 0.046, 0.0135);
  strokePoly(ctx, edgeRun(outline, 0.076, 45, 170).map((p) => [X(p[0]), Y(p[1])]), 0.0095 * sx);
}

// ---------------------------------------------------------------------------
// placement

// The true lowest vertex of a mesh in its parent's space. Box3.setFromObject
// will not do: it expands the geometry's bounding BOX by the world matrix, so a
// rotated pebble reports the corner of a tumbling cube and reads as sunk when
// it is resting perfectly.
const _v = new THREE.Vector3();
function lowestY(mesh) {
  mesh.updateMatrix();
  const attr = mesh.geometry.attributes.position;
  let min = Infinity;
  for (let i = 0; i < attr.count; i++) {
    _v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrix);
    if (_v.y < min) min = _v.y;
  }
  return min;
}

// Drop a mesh until its lowest real vertex is exactly on the ground. Every
// leaning or tumbled piece in this file is placed this way; nothing sits at a
// height somebody chose.
function seat(mesh, y = 0) {
  mesh.position.y += y - lowestY(mesh);
  mesh.updateMatrix();
}

// ---------------------------------------------------------------------------
// the urn's profile
//
// A lathe is only as good as its silhouette, and the failure mode is a chess
// pawn: one bulge, one taper, done. This profile has five events in it -- a
// flared foot, an ovoid body, a pinched neck, a lid rim that OVERHANGS that
// neck, and a domed cap with a waisted knob -- because that overhang and that
// waist are the two places the eye checks.
//
// Knots run bottom to top as (radius, height) and are splined, which is what
// keeps every transition rounded in the house manner. Total height 0.566, body
// 0.35 across.
const URN_PROFILE = [
  // foot: a small flared disc on a stem narrow enough that the body is seen to
  // be LIFTED off the plinth. The first pass had no stem and the body sat
  // straight on the cap, which read as a ball balanced on a box.
  [0.000, 0.000], [0.058, 0.000], [0.082, 0.009], [0.080, 0.024],
  [0.060, 0.038], [0.046, 0.050],
  // body. The widest point is TWO THIRDS of the way up it, not halfway: a long
  // sweep up from the foot and a short fall back from a high shoulder is what
  // separates a funerary urn from a ball, and two passes with the bulge at mid
  // height both came out as a sphere however the shoulder was tightened.
  [0.056, 0.070], [0.086, 0.110], [0.114, 0.155], [0.134, 0.205],
  [0.140, 0.250], [0.132, 0.285], [0.108, 0.322], [0.084, 0.348],
  // neck: short, and it has to be visibly STRAIGHT, which takes four almost
  // collinear knots. Without them the lid reads as the top of the pot.
  [0.068, 0.366], [0.066, 0.382], [0.066, 0.398], [0.067, 0.412],
  // lid: a rim overhanging the neck by half its own width again, kept well
  // inside the body's widest so the two do not read as one shape, then a dome
  // that is domed rather than conical.
  [0.096, 0.424], [0.100, 0.435], [0.092, 0.447],
  [0.076, 0.463], [0.052, 0.484], [0.033, 0.500],
  // knob: waisted, or it is just a bump.
  [0.019, 0.517], [0.023, 0.529],
  [0.040, 0.546], [0.038, 0.565], [0.023, 0.580], [0.000, 0.590],
];
const URN_HEIGHT = 0.590;

function buildUrnGeometry() {
  const curve = new THREE.SplineCurve(URN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(96);
  // A spline through knots that turn hard can undershoot past the axis, which
  // would fold the lathe inside out at the poles.
  for (const p of pts) p.x = Math.max(0, p.x);
  return new THREE.LatheGeometry(pts, SEGMENTS.radial);
}

// ---------------------------------------------------------------------------
// the pieces

// Urn on a plinth. Reference: squat classical urn, small relative to a tall
// square plinth whose cap and base are both wider than its shaft. The stack is
// slab, fillet, shaft, fillet, cap -- the two thin fillets are what turn a cap
// into a MOULDED cap at a distance where a profile cannot be seen.
const URN_STACK = [
  { h: 0.100, w: 0.230, edge: 0.026 },
  { h: 0.035, w: 0.196, edge: 0.016 },
  { h: 0.500, w: 0.163, edge: 0.034 },
  { h: 0.035, w: 0.196, edge: 0.016 },
  { h: 0.095, w: 0.222, edge: 0.026 },
];

const PLINTH_TOP = URN_STACK.reduce((h, part) => h + part.h, 0);

function buildUrn(add, texUV) {
  let y = 0;
  for (const part of URN_STACK) {
    const outline = makeOutline(boxOutline(part.w, part.h, part.edge * 1.6), SEGMENTS.radial);
    // Each piece gets its own small window into the strip, low in the band
    // where the grime wash lives -- an up-facing moulding sampling clean stone
    // reads as a whiter material than the shaft under it -- and rising with the
    // piece's place in the stack. Giving every piece the SAME v, which the
    // first pass did, means it samples one row of texels, and one row of a
    // speckled canvas comes out as vertical stripes down the shaft.
    const vBase = 0.02 + 0.16 * (y / PLINTH_TOP);
    const geo = buildPuffGeometry({
      outline,
      depth: part.w * 2,
      edge: part.edge,
      uv: (x, yy) => texUV.strip(x, yy, part.w, part.h, 0.055, vBase),
    });
    const mesh = add(geo);
    mesh.position.y = y;
    y += part.h;
  }
  // A hair of overlap so no seam can open between the urn's foot and the cap.
  // The lathe keeps its own u, which runs round the axis: rebuilding u from x
  // would fold the map back on itself at both sides of the pot.
  const urn = add(buildUrnGeometry(), (x, yy, u0) => [
    texUV.stripU(u0),
    0.34 + clamp(yy / URN_HEIGHT, 0, 1) * 0.40,
  ]);
  urn.position.y = y - 0.006;
  return y - 0.006 + URN_HEIGHT;
}

// The spiral boulder. Low and wide, a crack splitting a chunk off the right end
// and that chunk standing slightly apart.
const BOULDER_MAIN = [
  { x: -0.500, y: 0.115, r: 0.115 },
  { x: 0.140, y: 0.115, r: 0.115 },
  { x: 0.200, y: 0.330, r: 0.075 },
  { x: 0.060, y: 0.360, r: 0.160 },
  { x: -0.220, y: 0.300, r: 0.240 },
  { x: -0.480, y: 0.260, r: 0.160 },
];
// The chunk the crack took off the right-hand end. It has to be nearly as tall
// as the face it broke away from -- the first pass was a small blob and read as
// a second, separate boulder rather than as a piece of this one.
const BOULDER_CHUNK = [
  { x: -0.075, y: 0.095, r: 0.095 },
  { x: 0.075, y: 0.075, r: 0.075 },
  { x: 0.062, y: 0.190, r: 0.100 },
  { x: -0.068, y: 0.292, r: 0.088 },
];

// The broken round-top stone. The crown circle is tangent to the LEFT side and
// carries a real half-round over the top left; a shoulder circle low on the
// right pulls a long tangent run down from that crown, and that run is the
// break. First pass put the crown high and small and the stone came out as a
// gable end: the round top has to survive the break or the piece is not a
// round-top stone any more. Index 3 is the crown, which is where the groove
// starts and therefore where it stops.
const BROKEN_STONE = [
  { x: -0.180, y: 0.065, r: 0.065 },
  { x: 0.180, y: 0.065, r: 0.065 },
  { x: 0.180, y: 0.268, r: 0.065 },
  { x: -0.050, y: 0.380, r: 0.195 },
];
const BROKEN_CROWN = 3;

export function createLowStone({ variant = 'urn', seed = 1, scale = 1 } = {}) {
  const kind = LOW_VARIANTS.includes(variant) ? variant : 'urn';
  const rng = mulberry32(seed * 2654435761 + 61);
  const hasDOM = typeof document !== 'undefined';

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const geometries = [];

  // --- outlines first, because the texture's aspect comes from the face ------
  let mainOutline = null;
  let face = null;
  let draw = null;
  let rim = 0;

  if (kind === 'boulder') {
    mainOutline = makeOutline(BOULDER_MAIN, 108);
    face = mainOutline.bounds;
    // The outline goes in as well as the face box: the edge grooves are the
    // outline itself, offset inward.
    draw = (ctx, W, H) => drawBoulderFace(ctx, W, H, face, mainOutline);
    // 7% of the shorter side. The carving is authored clear of it.
    rim = 0.07;
  } else if (kind === 'brokenRing') {
    mainOutline = makeOutline(BROKEN_STONE, 72);
    face = mainOutline.bounds;
    // No rim fade here, and there must not be one: this face is a flat slab,
    // the planar projection over it is exact, and a fade would only wash out
    // the border groove, which is the mark that has to reach the edge.
    draw = (ctx, W, H) => drawBrokenFace(ctx, W, H, face, mainOutline, BROKEN_CROWN);
  }

  const tex = hasDOM
    ? buildTextures({
      faceAspect: face ? (face.x1 - face.x0) / (face.y1 - face.y0) : 1,
      draw,
      rng,
      rim,
    })
    : null;
  const frontFrac = tex ? tex.frontFrac : 1;
  const stripFrac = tex ? tex.stripFrac : 0;

  // Face UVs are a planar projection over the carved outline's bounding box;
  // everything else is parked inside the plain strip, inset from its own edges
  // so filtering can never drag a groove onto a side wall.
  const texUV = {
    face: (x, y) => [
      ((x - face.x0) / (face.x1 - face.x0)) * frontFrac,
      (y - face.y0) / (face.y1 - face.y0),
    ],
    // The far side of a carved lump: one point in the strip's flat patch.
    flat: tex ? tex.flat : [1, 0.93],
    // An uncarved lump. u runs with the SWEEP, front pole to back pole, and
    // only v comes from the geometry. Driving both from (x, y) folds the
    // texture back on itself at the silhouette, because the far side retraces
    // the same x and y as the near side, and the fold showed as a hard line
    // round the middle of every pebble.
    lump: (t, y, h, vSpan = 1, vBase = 0) => [
      frontFrac + stripFrac * (0.12 + 0.76 * t),
      vBase + clamp(y / h, 0, 1) * vSpan,
    ],
    // vBase picks where in the strip a piece sits. v = 0 is the ground grime
    // and the top band is the flat patch, so anything that is neither wants to
    // start above the one and finish below the other.
    strip: (x, y, halfW, h, vSpan = 1, vBase = 0) => [
      frontFrac + stripFrac * (0.15 + 0.7 * clamp((x + halfW) / (2 * halfW), 0, 1)),
      vBase + clamp(y / h, 0, 1) * vSpan,
    ],
    // u alone, for a mesh that already has a good one of its own -- a lathe's
    // angle around the axis, say.
    stripU: (f) => frontFrac + stripFrac * (0.15 + 0.7 * clamp(f, 0, 1)),
  };

  const material = toyMaterial(PALETTE.stone, {
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
  });

  const add = (geo, parent = body) => {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  if (kind === 'urn') {
    buildUrn((geo, uv) => {
      // buildUrn hands its own UV function for the lathe; the stack passes none
      // because buildPuffGeometry has already baked them.
      if (uv) {
        const attr = geo.attributes.uv;
        const pos = geo.attributes.position;
        for (let i = 0; i < attr.count; i++) {
          const [u, v] = uv(pos.getX(i), pos.getY(i), attr.getX(i));
          attr.setXY(i, u, v);
        }
        attr.needsUpdate = true;
      }
      return add(geo);
    }, texUV);
  } else if (kind === 'boulder') {
    const centre = {
      x: (mainOutline.bounds.x0 + mainOutline.bounds.x1) / 2,
      y: mainOutline.bounds.y0 + (mainOutline.bounds.y1 - mainOutline.bounds.y0) * 0.55,
    };
    add(buildLumpGeometry({
      outline: mainOutline,
      centre,
      halfDepth: 0.172,
      sweep: 18,
      uv: (x, y, front) => (front ? texUV.face(x, y) : texUV.flat),
    }));

    // The split-off chunk. Placed so the crack reads as a gap of about four
    // centimetres, turned and tilted so its faces do not line up with the main
    // mass -- a chunk that is merely translated reads as a second boulder.
    const chunkOutline = makeOutline(BOULDER_CHUNK, 56);
    const chunk = add(buildLumpGeometry({
      outline: chunkOutline,
      centre: { x: 0, y: 0.16 },
      halfDepth: 0.132,
      sweep: 12,
      uv: (x, y, front, t) => texUV.lump(t, y, 0.34, 0.30, 0.05),
    }));
    // Both facing walls are near-vertical tangent runs, and the placement keeps
    // them roughly parallel: the crack has to read as a crack down its whole
    // height, not as a wedge that a pebble happens to sit at the mouth of.
    // Measured closest approach is about 0.017, which is where the crack stops
    // looking like a gap between two rocks.
    chunk.position.set(0.421, 0, 0.014);
    chunk.rotation.set(0.03, 0.07, -0.06);
    seat(chunk);
  } else {
    const slab = add(buildPuffGeometry({
      outline: mainOutline,
      depth: 0.150,
      edge: 0.052,
      uv: (x, y, front) => (front ? texUV.face(x, y) : texUV.strip(x, y, 0.25, 0.58, 0.45, 0.30)),
    }));
    // Leaning back, not forward: rotation.x tips +y toward +z, so the lean is
    // negative. Half sunk is sold by the rubble piled at the foot rather than
    // by burying geometry, which would only work on perfectly flat ground.
    slab.rotation.set(-0.155, 0.06, 0.045);
    seat(slab);

    // The rubble ring. This is the piece that sells the broken stone, so it is
    // a ring and not a scatter: an ellipse round the foot, wider across than
    // deep because the stone is, with the gaps and doubling that a ring of
    // fallen pieces has. Radii start outside the slab's own footprint plus the
    // largest pebble, so nothing can intersect the stone.
    // Radii are measured off the slab's own plan, not off a circle: the
    // distance from the centre to the slab's edge in this direction, plus the
    // pebble and a gap. A circular ring round a slab that is three times wider
    // than it is deep leaves a moat at the front and back and touches at the
    // ends. This hugs.
    const HALF_W = 0.245;
    const HALF_D = 0.075;
    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
      const a = ((i + 0.5) / COUNT) * Math.PI * 2 + (rng() - 0.5) * 0.34;
      const s = 0.030 + rng() * 0.040;
      const flat = 0.46 + rng() * 0.20;
      const reach = Math.min(HALF_W / Math.max(0.08, Math.abs(Math.cos(a))), HALF_D / Math.max(0.08, Math.abs(Math.sin(a))));
      const out = reach + s + 0.012 + rng() * 0.055;

      // A pebble is the same hull of circles as everything else, jittered.
      const circles = [];
      const lobes = 4 + Math.floor(rng() * 2);
      for (let k = 0; k < lobes; k++) {
        const t = (k / lobes) * Math.PI * 2;
        const rr = s * (0.42 + rng() * 0.22);
        circles.push({
          x: Math.cos(t) * s * (0.52 + rng() * 0.30),
          y: s * flat + Math.sin(t) * s * flat * (0.45 + rng() * 0.30),
          r: rr,
        });
      }
      const pebble = add(buildLumpGeometry({
        // A pebble is five centimetres across. It gets the segment counts a
        // five-centimetre pebble deserves, or sixteen of them cost more
        // vertices than the stone they are lying round.
        outline: makeOutline(circles, 24),
        centre: { x: 0, y: s * flat },
        halfDepth: s * (0.55 + rng() * 0.25),
        sweep: 6,
        ring: 26,
        uv: (x, y, front, t) => texUV.lump(t, y, s * 2, GRIME * 1.4),
      }));
      pebble.position.set(Math.cos(a) * out, 0, Math.sin(a) * out);
      pebble.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5);
      seat(pebble);
    }
  }

  // A hand-set piece never stands quite true. Small enough that the silhouette
  // still reads upright. The urn's plinth gets the least of it, because a
  // leaning plinth reads as a mistake rather than as age.
  if (kind === 'urn') {
    body.rotation.z = (rng() - 0.5) * 0.030;
    body.rotation.x = -0.008 - rng() * 0.012;
  } else if (kind === 'boulder') {
    body.rotation.y = (rng() - 0.5) * 0.10;
  }

  // Whatever the lean did, the lowest real vertex of the whole piece ends up on
  // the ground and not a millimetre under it.
  body.updateMatrixWorld(true);
  let min = Infinity;
  body.traverse((node) => {
    if (!node.geometry) return;
    const attr = node.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      _v.fromBufferAttribute(attr, i).applyMatrix4(node.matrixWorld);
      if (_v.y < min) min = _v.y;
    }
  });
  if (Number.isFinite(min)) body.position.y -= min;

  // --- ground contact -------------------------------------------------------
  //
  // Nothing here on purpose, and nothing may be added. A painted contact patch
  // was removed from the tall stones: laid flat on the floor it is the same on
  // every side of the prop, including the side facing the key light, which no
  // shadow is, and it read as a stain in the dirt. The dynamic light casts the
  // only shadow these pieces get. If a joint ever looks weak the fix is in the
  // light -- map resolution, bias, radius -- not a decal under the prop.

  group.scale.setScalar(scale);

  return {
    group,
    update() {}, // static prop
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      if (tex) {
        tex.map.dispose();
        tex.normalMap.dispose();
      }
    },
  };
}
