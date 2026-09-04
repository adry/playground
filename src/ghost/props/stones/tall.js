import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial } from '../style.js';

// The three tall pieces of the second graveyard set: a ringed celtic cross, a
// gothic ogee-arch headstone carrying a tree of life, and an obelisk with a
// radiant sun, an open book and a scroll.
//
// Everything here is the same soft vinyl toy as ../tombstones.js, and the two
// hard parts are solved the same way, deliberately:
//
//   * Silhouettes are swept outlines. An outline is a closed list of tangent
//     arcs; straight runs fall out between them for free. Because the whole
//     outline is built from arcs whose centres never move, "inset by d" is only
//     "convex radii minus d, concave radii plus d", every ring of the sweep is
//     an exact offset of the last, and the normal at every vertex is known
//     analytically. No computeVertexNormals, no faceting, no seams.
//   * Engraving is a colour map plus a normal map baked from a height canvas.
//     Copied wholesale from tombstones.js, including the numbers: a wide weak
//     occlusion smudge, a body dark enough to read as shade and no darker, a
//     shaded wall under the mark's top edge and a lit lip along its bottom one.
//     That combination is what survives being filtered down to the hundred-odd
//     pixels a stone actually occupies, and it was approved as-is. Do not
//     simplify it back to "blur the mask and darken it".
//
// The one thing added here that tombstones.js has no need for is a second,
// shallower mask: the gothic arch's recessed panel. It rides the same pipeline
// at lower amplitude, so the panel floor sits between the face and the tree.

export const TALL_VARIANTS = ['celtic', 'arch', 'obelisk'];

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

// ---------------------------------------------------------------------------
// outlines
//
// An arc is { cx, cy, r, a0, a1 }. a1 > a0 means it is traversed
// counter-clockwise, which for a counter-clockwise loop is a convex corner; a1
// < a0 is a concave one. That sign is the only thing insetting needs to know.

const TAU = Math.PI * 2;

// Round every corner of a closed polygon. Radii may be a single number or one
// per vertex. Concave corners are handled by the same code: the turn's sign
// picks which side the fillet centre goes.
function roundPolygon(points, radii) {
  const n = points.length;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const r = Array.isArray(radii) ? radii[i] : radii;

    const inx = p[0] - prev[0];
    const iny = p[1] - prev[1];
    const il = Math.hypot(inx, iny);
    const ux = inx / il;
    const uy = iny / il;
    const onx = next[0] - p[0];
    const ony = next[1] - p[1];
    const ol = Math.hypot(onx, ony);
    const vx = onx / ol;
    const vy = ony / ol;

    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    const delta = Math.atan2(cross, dot); // signed turn
    if (Math.abs(delta) < 1e-6) continue; // collinear: no corner to round
    const sign = Math.sign(delta);
    const t = r * Math.tan(Math.abs(delta) / 2);
    const t1x = p[0] - t * ux;
    const t1y = p[1] - t * uy;
    // Fillet centre sits off the incoming edge, on the inside of the turn.
    const nx = -uy * sign;
    const ny = ux * sign;
    const cx = t1x + r * nx;
    const cy = t1y + r * ny;
    const a0 = Math.atan2(t1y - cy, t1x - cx);
    arcs.push({ cx, cy, r, a0, a1: a0 + delta });
  }
  return arcs;
}

// Sample one loop of arcs, offset inward by `inset`, into a ring of positions
// and 2D outward normals. Straight runs between arcs need no samples of their
// own: consecutive arc endpoints are tangent to the same line, so the quad
// strip between them is that line.
function sampleLoop(arcs, inset, density) {
  const out = [];
  for (const a of arcs) {
    const sweep = a.a1 - a.a0;
    const sign = Math.sign(sweep);
    // Clamped: an artwork inset can be asked for that is deeper than a convex
    // corner's radius, which would turn the arc inside out.
    const r = Math.max(1e-4, a.r - inset * sign);
    const seg = Math.max(2, Math.round(density * Math.abs(sweep) / (Math.PI / 2)));
    for (let j = 0; j <= seg; j++) {
      const t = a.a0 + sweep * (j / seg);
      const c = Math.cos(t);
      const s = Math.sin(t);
      out.push({ x: a.cx + r * c, y: a.cy + r * s, nx: c * sign, ny: s * sign });
    }
  }
  // A loop given as a single full turn (a plain circle) closes on itself, and
  // the repeated vertex would make one degenerate quad and confuse the cap
  // triangulator. Every other loop here has real straight runs between its
  // arcs, so nothing else can trip this.
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-9) out.pop();
  return out;
}

// Bounding box of a loop at inset 0, for planar UV mapping.
function loopBounds(loops) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of sampleLoop(loop, 0, 6)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// a flat slab with a rounded rim, from one or more arc loops
//
// `loops[0]` is the outer boundary, counter-clockwise; any further loops are
// holes, wound clockwise. The rim is a quarter-round of radius `edge` swept
// front to back, so face, rim and the joint between them are one continuous
// surface. Same construction as tombstones.js, generalised to non-convex
// outlines and holes -- which is what a ringed cross needs and a plain
// headstone does not.
function buildOutlineSlab({ loops, depth, edge: e, uv, density = SEGMENTS.curve }) {
  const hz = depth / 2;
  const rings = loops.map((loop) => sampleLoop(loop, 0, density).length);
  const N = rings.reduce((a, b) => a + b, 0);

  // (inset, z) profile: quarter circle out to the silhouette, a straight side
  // wall, then its mirror round the back. Half the curve budget across the
  // 90-degree turn -- a quarter of it banded visibly on the side highlight.
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: hz - e + e * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), face: 'front' });
  }
  // The silhouette ring is duplicated so the texture seams land on the widest
  // edge, where nothing can be dragged across them. The three surfaces are
  // named rather than flagged front/not-front because the celtic cross wants
  // its groove on the back face as well, and only the rim left plain.
  profile.push({ inset: 0, z: hz - e, ns: 1, nz: 0, face: 'rim' });
  profile.push({ inset: 0, z: -(hz - e), ns: 1, nz: 0, face: 'rim' });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: -(hz - e + e * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), face: 'back' });
  }

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz, face) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    const [u, v] = uv(x, y, face);
    uvs.push(u, v);
  };

  const capPoints = [];
  for (const p of profile) {
    for (let li = 0; li < loops.length; li++) {
      const ring = sampleLoop(loops[li], p.inset, density);
      for (const s of ring) {
        push(s.x, s.y, p.z, s.nx * p.ns, s.ny * p.ns, p.nz, p.face);
        if (p === profile[0]) capPoints.push(new THREE.Vector2(s.x, s.y));
      }
    }
  }

  for (let i = 0; i < profile.length - 1; i++) {
    let base = 0;
    for (const count of rings) {
      for (let j = 0; j < count; j++) {
        const j2 = (j + 1) % count;
        const a = i * N + base + j;
        const b = i * N + base + j2;
        const c = (i + 1) * N + base + j2;
        const d = (i + 1) * N + base + j;
        idx.push(a, c, b, a, d, c);
      }
      base += count;
    }
  }

  // Caps. The first profile ring is already the front face's boundary (inset
  // e, z = hz, normal +Z) and the last is the back's, so the caps are a
  // triangulation of those rings rather than new geometry. Ear clipping rather
  // than a centre fan, because a plus-shaped cross is not convex.
  const contour = capPoints.slice(0, rings[0]);
  const holes = [];
  let off = rings[0];
  for (let li = 1; li < loops.length; li++) {
    holes.push(capPoints.slice(off, off + rings[li]));
    off += rings[li];
  }
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const last = (profile.length - 1) * N;
  for (const f of faces) {
    idx.push(f[0], f[1], f[2]);
    idx.push(last + f[2], last + f[1], last + f[0]);
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
// a tapering column with a rounded-square section
//
// The obelisk. Its silhouette in (halfWidth, height) is a filleted polyline and
// its cross-section is a rounded square scaled by that half-width, so corner
// radius tapers with the shaft and the apex closes to a point on its own.
//
// The section is generated as four separate spans -- front, left, back, right,
// split at the diagonals -- with the boundary vertices duplicated. That
// duplication is the only way a face can own a slice of the texture without its
// neighbour's UVs being dragged round the corner.

// Unit rounded square in (x, z), +Z front, walked counter-clockwise from the
// front-right diagonal. `q` is the corner radius as a fraction of the half-size.
// kappa is the section's support term; it is what keeps the swept normal exact
// where the corner radius, and therefore the local curvature, is not a circle's.
function roundedSquareSection(q, perSpan) {
  const spans = [];
  const c = 1 - q;
  // Corner centres, in walk order starting front-right.
  const corners = [
    [c, c],   // front-right
    [-c, c],  // front-left
    [-c, -c], // back-left
    [c, -c],  // back-right
  ];
  for (let f = 0; f < 4; f++) {
    // Each span is the second half of one corner arc, the straight edge, then
    // the first half of the next.
    const a0 = Math.PI / 4 + f * (Math.PI / 2);
    const pts = [];
    const emit = (x, z, nx, nz) => {
      // Support function of the rounded square: distance from the section's
      // centre to the tangent line at this point. On a straight edge it is 1.
      const k = c * (Math.abs(nx) + Math.abs(nz)) + q;
      pts.push({ x, z, nx, nz, k });
    };
    const arc = (ci, from, to, n) => {
      const [ox, oz] = corners[ci];
      for (let j = 0; j <= n; j++) {
        const a = from + (to - from) * (j / n);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        emit(ox + q * ca, oz + q * sa, ca, sa);
      }
    };
    const half = Math.max(2, Math.round(perSpan * 0.34));
    arc(f, a0, a0 + Math.PI / 4, half);
    arc((f + 1) % 4, a0 + Math.PI / 4, a0 + Math.PI / 2, half);
    spans.push(pts);
  }
  return spans;
}

// The obelisk's silhouette in (halfWidth, height): up the tapering shaft, a
// filleted shoulder, the pyramidal cap, and a rounded nose on top. Returned as
// samples of (s, y) with the outward 2D normal, walking from the bottom of the
// axis to the apex with the solid on the left, so the outward normal is always
// the right of travel.
function obeliskSilhouette({ s0, s1, shoulder, apex, footFillet, shoulderFillet, noseRadius }, density) {
  const out = [];
  const norm = (x, y) => { const l = Math.hypot(x, y); return [x / l, y / l]; };
  const arc = (cx, cy, r, a0, a1, n) => {
    for (let j = 0; j <= n; j++) {
      const a = a0 + (a1 - a0) * (j / n);
      out.push({ s: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ns: Math.cos(a), ny: Math.sin(a) });
    }
  };
  // Fillet of radius r at `p` between two unit directions. Same construction as
  // roundPolygon, in the (s, y) half-plane.
  const fillet = (p, u, v, r, seg) => {
    const cross = u[0] * v[1] - u[1] * v[0];
    const delta = Math.atan2(cross, u[0] * v[0] + u[1] * v[1]);
    const sign = Math.sign(delta);
    const t = r * Math.tan(Math.abs(delta) / 2);
    const t1 = [p[0] - t * u[0], p[1] - t * u[1]];
    const c = [t1[0] + r * -u[1] * sign, t1[1] + r * u[0] * sign];
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    arc(c[0], c[1], r, a0, a0 + delta, Math.max(3, Math.round(seg * Math.abs(delta) / (Math.PI / 2))));
  };

  const outward = [0, -1];        // bottom face
  const shaft = norm(s1 - s0, shoulder);
  const cap = norm(-s1, apex - shoulder);

  out.push({ s: 0, y: 0, ns: outward[0], ny: outward[1] });
  fillet([s0, 0], [1, 0], shaft, footFillet, density);
  fillet([s1, shoulder], shaft, cap, shoulderFillet, density);

  // Nose: a circle centred on the axis, tangent to the cap's line. Solving for
  // its centre rather than picking one keeps the cap dead straight right up to
  // where the round starts, which is what makes a blunt tip read as a blunt
  // point rather than as a dome stuck on a stump.
  const yc = shoulder + (s1 * cap[1] - noseRadius) / Math.abs(cap[0]);
  const t = (0 - s1) * cap[0] + (yc - shoulder) * cap[1];
  const T = [s1 + t * cap[0], shoulder + t * cap[1]];
  arc(0, yc, noseRadius, Math.atan2(T[1] - yc, T[0]), Math.PI / 2, Math.max(4, Math.round(density * 0.65)));
  return { samples: out, height: yc + noseRadius };
}

// Sweep a rounded-square section along a silhouette.
function buildTaperedColumn({ silhouette, corner, uv, density = SEGMENTS.curve }) {
  const spans = roundedSquareSection(corner, density);
  const counts = spans.map((s) => s.length);
  const N = counts.reduce((a, b) => a + b, 0);

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];

  for (const r of silhouette) {
    for (let f = 0; f < 4; f++) {
      for (const p of spans[f]) {
        pos.push(r.s * p.x, r.y, r.s * p.z);
        const nx = p.nx * r.ns;
        const ny = r.ny * p.k;
        const nz = p.nz * r.ns;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l, ny / l, nz / l);
        const [u, v] = uv(f, p, r);
        uvs.push(u, v);
      }
    }
  }

  for (let i = 0; i < silhouette.length - 1; i++) {
    let base = 0;
    for (const count of counts) {
      for (let j = 0; j < count - 1; j++) {
        const a = i * N + base + j;
        const b = i * N + base + j + 1;
        const c = (i + 1) * N + base + j + 1;
        const d = (i + 1) * N + base + j;
        idx.push(a, c, b, a, d, c);
      }
      base += count;
    }
  }
  // The spans do not need stitching to each other: each span's last vertex is
  // coincident with the next span's first, duplicated only so the two can hold
  // different UVs. The strips therefore already meet exactly along the corners.

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// engraving
//
// Everything from here to buildTextures is lifted from tombstones.js with its
// numbers intact. It was tuned against the one test that matters -- a stone
// filtered down to the hundred-odd pixels it occupies on screen -- and the
// approved result is the combination, not any one part of it.

// The band of a mark that lies just inside one of its edges, as an opaque mask:
// the mark, minus a copy of itself shifted off that edge. This is what paints
// the two walls of the groove -- the one under the top edge faces down and away
// from the key light, the one above the bottom edge faces up into it.
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

// Faint mottling so the grey reads as stone rather than moulded plastic. The
// speckle pass is colour-only: on the height map its high frequencies come back
// through the normals as sandpaper.
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

// Turn the height canvas into a tangent-space normal map. A bumpMap would be
// cheaper, but its relief is driven by screen-space derivatives, so the carving
// would soften as the camera pulls back. Slopes baked here hold at any distance.
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

// Fraction of the texture's height that a plinth is mapped into, measured up
// from the bottom -- i.e. how far into the grime band it sits.
const GRIME = 0.2;

// Colour map + normal map for one piece.
//
// `regions` are the parts of the surface that carry artwork, each an aspect
// ratio and a pair of draw calls: `marks` for what is cut all the way in, and
// `recess` for a broad shallow pocket the marks sit inside (only the gothic
// arch has one). They are laid out left to right, and a plain strip of stone
// is left on the right for every surface that carries nothing, so no motif can
// ever be dragged round a corner by filtering.
function buildTextures(regions, rng) {
  const FH = 1024;
  const STRIP = 160;
  const widths = regions.map((r) => Math.round(FH * r.aspect));
  const w = widths.reduce((a, b) => a + b, 0) + STRIP;

  const colour = document.createElement('canvas');
  colour.width = w;
  colour.height = FH;
  const cc = colour.getContext('2d');
  // White base: the palette colour lives on the material, so PALETTE.stone
  // stays the single source of truth for the hue.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, FH);
  mottle(cc, w, FH, rng, '120,116,110', '255,255,255', 0.085);

  // A wash of ground grime along the bottom edge. It also does a second job:
  // plinths and base blocks sample nothing but this band, which stops an
  // up-facing slab of clean stone from reading as a whiter material.
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
  // Half the colour map's amplitude: at the normal strength used below, the
  // colour map's value turned the stone into hammered metal.
  mottle(hc, w, FH, mulberry32(1), '96,96,96', '176,176,176', 0.065, false);

  const layer = (fn) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = FH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    let x = 0;
    let any = false;
    for (let i = 0; i < regions.length; i++) {
      const f = regions[i][fn];
      if (f) {
        ctx.save();
        ctx.translate(x, 0);
        f(ctx, widths[i], FH);
        ctx.restore();
        any = true;
      }
      x += widths[i];
    }
    return any ? c : null;
  };
  const marks = layer('marks');
  const recess = layer('recess');

  const stamp = (ctx, img, alpha, op = 'multiply', blur = 0) => {
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(img, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const WALL = Math.max(6, Math.round(FH * 0.011));
  const LIP = Math.max(3, Math.round(FH * 0.006));

  // The recessed panel first, so the marks are cut into its floor rather than
  // fighting it. Wider wall, weaker everything: it is a pocket a few
  // millimetres deep, not a groove.
  if (recess) {
    const rWall = WALL * 2.2;
    stamp(cc, recess, 0.10, 'multiply', rWall * 1.5);
    stamp(cc, recess, 0.13);
    stamp(cc, lipMask(recess, 0, LIP * 2, '#000000'), 0.30, 'multiply', 3);
    stamp(cc, lipMask(recess, 0, -LIP * 2, '#ffffff'), 0.34, 'screen', 3);
    stamp(hc, recess, 0.55, 'multiply', rWall);
  }

  if (marks) {
    // A wide, weak smudge first: the ambient light that never reaches into a
    // cut, spilling a little past its edges the way a real occlusion does.
    stamp(cc, marks, 0.16, 'multiply', WALL * 1.6);
    // Then the body of the recess. The lips carry the shape, so this only has
    // to be dark enough to read as shadow; pushed harder it goes to ink, and
    // carving is grey stone in shade, not a printed letter.
    stamp(cc, marks, 0.36);
    stamp(cc, lipMask(marks, 0, LIP, '#000000'), 0.4, 'multiply', 1.5);
    stamp(cc, lipMask(marks, 0, -LIP, '#ffffff'), 0.42, 'screen', 1.5);
    // Height: dark is low. Blurred once for a wall that ramps rather than
    // steps, then again tighter so thin strokes still reach the bottom of the
    // cut instead of being rounded off into a scratch by the blur alone.
    stamp(hc, marks, 1, 'multiply', WALL);
    stamp(hc, marks, 1, 'multiply', Math.round(WALL * 0.35));
  }

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const spans = {};
  let x = 0;
  regions.forEach((r, i) => {
    spans[r.key] = [x / w, (x + widths[i]) / w];
    x += widths[i];
  });
  spans.strip = [x / w, 1];
  return { map, normalMap: heightToNormalMap(height, 14), spans };
}

// ---------------------------------------------------------------------------
// artwork
//
// Every mark here was drawn twice: once at full texture resolution, and once
// downsampled to the eighty-odd pixels the piece actually covers in a frame.
// Anything that only worked at the first size was thrown away. What survives is
// a small number of fat strokes.

// Stroke a loop, offset inward, as a groove. This is the celtic cross's whole
// decoration: a line running parallel to the outline a little way in, which is
// what stops a flat cross reading as cut from card.
function inkLoopGroove(ctx, arcs, inset, width, project) {
  const pts = sampleLoop(arcs, inset, 26);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = project(p.x, p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// A spiral of `turns`, unrolling counter-clockwise from the centre. Used for
// the tree's crown and the obelisk's scroll.
function spiralPath(ctx, cx, cy, r0, r1, turns, phase = 0) {
  const steps = Math.max(12, Math.round(turns * 18));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = phase + t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

// The tree of life, in the box (0,0)-(w,h) of the arch's recessed panel.
//
// Two pairs of limbs, a coiled crown and four roots: nine strokes in all. The
// first version had six limbs and small hooked ends, and downsampled to the
// thirty-odd pixels the panel really covers it read as a candelabra -- straight
// trunk, symmetrical arms, nothing curling. What fixed it was fewer limbs, a
// wider canopy, and ending each limb in a whole turn of spiral big enough to
// still be a spiral after filtering, rather than a hook that closes up.
//
// Nothing here is narrower than a twentieth of the box. That is the floor at
// which a groove survives being a pixel and a half wide on screen.
function inkTree(ctx, w, h) {
  const X = (t) => t * w;
  const Y = (t) => t * h;
  const S = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Trunk: a filled taper, wide at the foot, so it can splay into the roots
  // without a stroke width having to change halfway along.
  ctx.beginPath();
  ctx.moveTo(X(0.398), Y(0.965));
  ctx.bezierCurveTo(X(0.443), Y(0.86), X(0.462), Y(0.76), X(0.462), Y(0.625));
  ctx.lineTo(X(0.538), Y(0.625));
  ctx.bezierCurveTo(X(0.538), Y(0.76), X(0.557), Y(0.86), X(0.602), Y(0.965));
  ctx.closePath();
  ctx.fill();

  // Roots. Four, splaying wide and shallow; they read as a foot rather than as
  // the arrowhead that three symmetrical ones made.
  ctx.lineWidth = S * 0.062;
  ctx.beginPath();
  ctx.moveTo(X(0.47), Y(0.905));
  ctx.bezierCurveTo(X(0.36), Y(0.94), X(0.30), Y(0.945), X(0.185), Y(0.99));
  ctx.moveTo(X(0.53), Y(0.905));
  ctx.bezierCurveTo(X(0.64), Y(0.94), X(0.70), Y(0.945), X(0.815), Y(0.99));
  ctx.moveTo(X(0.485), Y(0.93));
  ctx.quadraticCurveTo(X(0.44), Y(0.965), X(0.395), Y(0.995));
  ctx.moveTo(X(0.515), Y(0.93));
  ctx.quadraticCurveTo(X(0.56), Y(0.965), X(0.605), Y(0.995));
  ctx.stroke();

  // A limb: out and up from the trunk, then a full turn of spiral at the end.
  // The spiral unrolls away from the trunk so the coil's opening faces out,
  // which is what stops it reading as a blob on a stick.
  const limb = (dir, y0, cx1, cy1, cx2, cy2, ex, ey, width, coil) => {
    ctx.lineWidth = S * width;
    ctx.beginPath();
    ctx.moveTo(X(0.5 + dir * 0.028), Y(y0));
    ctx.bezierCurveTo(X(0.5 + dir * cx1), Y(cy1), X(0.5 + dir * cx2), Y(cy2), X(0.5 + dir * ex), Y(ey));
    ctx.stroke();
    ctx.beginPath();
    spiralPath(ctx, X(0.5 + dir * ex) + dir * S * coil * 0.9, Y(ey) - h * coil * 0.55,
      S * 0.012, S * coil, 0.92, dir > 0 ? Math.PI * 0.75 : Math.PI * 0.25);
    ctx.stroke();
  };
  // Both pairs leave the trunk climbing. An earlier pass had the lower pair
  // leave level and sag before rising, and at any size it read as a moustache.
  for (const d of [-1, 1]) {
    limb(d, 0.625, 0.19, 0.585, 0.38, 0.520, 0.455, 0.405, 0.060, 0.090);
    limb(d, 0.530, 0.10, 0.470, 0.21, 0.372, 0.258, 0.272, 0.052, 0.074);
  }

  // Trunk on up to the crown, and the crown itself: a flat coil, the one place
  // the reference's spirals survive being shrunk.
  ctx.lineWidth = S * 0.060;
  ctx.beginPath();
  ctx.moveTo(X(0.5), Y(0.655));
  ctx.lineTo(X(0.5), Y(0.275));
  ctx.stroke();
  ctx.lineWidth = S * 0.058;
  ctx.beginPath();
  spiralPath(ctx, X(0.5), Y(0.215), S * 0.015, S * 0.105, 1.05, Math.PI / 2);
  ctx.stroke();
}

// The obelisk's front face: a radiant sun near the top, an open book with an
// eye below it.
function inkSunAndBook(ctx, w, h) {
  const S = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- sun ---
  const sx = w * 0.5;
  const sy = h * 0.185;
  const disc = S * 0.155;
  ctx.beginPath();
  ctx.arc(sx, sy, disc, 0, TAU);
  ctx.fill();
  // Ten rays. Twelve merged into a collar at scene scale; eight read as a cog.
  const rays = 10;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TAU - Math.PI / 2;
    const half = 0.085;
    const r0 = disc * 1.12;
    const r1 = disc * 2.05;
    ctx.beginPath();
    ctx.moveTo(sx + r0 * Math.cos(a - half), sy + r0 * Math.sin(a - half));
    ctx.lineTo(sx + r1 * Math.cos(a), sy + r1 * Math.sin(a));
    ctx.lineTo(sx + r0 * Math.cos(a + half), sy + r0 * Math.sin(a + half));
    ctx.closePath();
    ctx.fill();
  }

  // --- book ---
  // Cut as a solid, with the eye and its dots left standing proud inside it. An
  // outlined book vanished at scene scale; a solid one with a light lens on it
  // does not. The dots were outside the book to begin with and the eye read
  // them as part of its silhouette, which turned the whole motif into a bat.
  //
  // Width is against the face, not against the texture region. The region maps
  // the shaft's widest section and the book sits two thirds of the way up,
  // where the shaft has tapered, so a book sized to the region ran round both
  // corners and read as a black belt.
  const by = h * 0.505;
  const bw = S * 0.300;
  const bh = S * 0.375;
  // One page. The two edges that carry "open book" are the top, which peaks at
  // the spine, and the bottom, which sags to it: a shape whose top and bottom
  // both bulged outward read as two bricks with a gap.
  const page = (dir) => {
    ctx.beginPath();
    ctx.moveTo(sx + dir * S * 0.048, by - bh * 0.46);
    ctx.quadraticCurveTo(sx + dir * bw * 0.52, by - bh * 0.44, sx + dir * bw, by - bh * 0.26);
    ctx.quadraticCurveTo(sx + dir * bw * 1.01, by + bh * 0.06, sx + dir * bw * 0.96, by + bh * 0.26);
    ctx.quadraticCurveTo(sx + dir * bw * 0.50, by + bh * 0.30, sx + dir * S * 0.048, by + bh * 0.50);
    ctx.closePath();
    ctx.fill();
  };
  page(-1);
  page(1);

  // The eye, and the dots radiating from it, erased out of the book together.
  // Two cubics rather than two quadratics for the lens: quadratics gave it
  // corners, and at scene scale a lens with corners is a diamond.
  // Bridge the spine behind the eye, so the lens sits on solid stone-shade
  // instead of being cut in half by the gap between the pages.
  const ey = by - bh * 0.02;
  const ew = S * 0.115;
  const eh = S * 0.066;
  ctx.beginPath();
  ctx.roundRect(sx - S * 0.16, ey - S * 0.105, S * 0.32, S * 0.21, S * 0.05);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(sx - ew, ey);
  ctx.bezierCurveTo(sx - ew * 0.45, ey - eh, sx + ew * 0.45, ey - eh, sx + ew, ey);
  ctx.bezierCurveTo(sx + ew * 0.45, ey + eh, sx - ew * 0.45, ey + eh, sx - ew, ey);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.80 + (i / 3) * Math.PI * 0.60;
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * S * 0.165, ey + Math.sin(a) * S * 0.105, S * 0.014, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(sx, ey, S * 0.034, 0, TAU);
  ctx.fill();
}

// The obelisk's side face: a double spiral, low down.
function inkScroll(ctx, w, h) {
  const S = w;
  ctx.lineCap = 'round';
  ctx.lineWidth = S * 0.085;
  const cy = h * 0.70;
  ctx.beginPath();
  spiralPath(ctx, w * 0.5 - S * 0.20, cy - S * 0.10, S * 0.02, S * 0.155, 0.95, Math.PI * 0.5);
  ctx.stroke();
  ctx.beginPath();
  spiralPath(ctx, w * 0.5 + S * 0.20, cy + S * 0.10, S * 0.02, S * 0.155, 0.95, Math.PI * 1.5);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// the gothic ogee outline
//
// An ogee is two arcs a side: a convex one off the springing, curving in like
// any arch, then a reversal into a concave one that runs up to the point. The
// pair have to be tangent where they meet or the join shows as a crease that no
// amount of rounding hides.
//
// Rather than solve for an arc through a sharp apex and then try to blunt it --
// the blunting radius that construction allows works out at about a
// centimetre, thinner than the slab's own edge round, so the tip came out
// pinched -- the tip is a circle of chosen radius sitting on the centreline,
// and the concave arc is placed tangent to both it and the lower arc. Two
// circles of known radius about two known centres: the concave arc's centre is
// simply where those two intersect.
function ogeeOutline({ halfWidth: W, height: H, springing: ys, lowerR: r1, upperR: r2, tipR: rc, bottomR: br }) {
  const C1 = [W - r1, ys];
  const F = [0, H - rc];
  const dx = F[0] - C1[0];
  const dy = F[1] - C1[1];
  const dist = Math.hypot(dx, dy);
  const Ra = r1 + r2;   // tangent to the lower arc, both convex outward
  const Rb = r2 + rc;   // tangent to the tip circle
  const a = (dist * dist + Ra * Ra - Rb * Rb) / (2 * dist);
  const hh = Math.sqrt(Math.max(0, Ra * Ra - a * a));
  const mx = C1[0] + (a * dx) / dist;
  const my = C1[1] + (a * dy) / dist;
  const C2 = [mx + (hh * dy) / dist, my - (hh * dx) / dist];

  const ang = (p, c) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const theta1 = ang(C2, C1);                       // arc1 ends aimed at C2
  const P1 = [C1[0] + r1 * Math.cos(theta1), C1[1] + r1 * Math.sin(theta1)];
  const alpha1 = ang(P1, C2);
  const T = [C2[0] + (r2 * (F[0] - C2[0])) / Rb, C2[1] + (r2 * (F[1] - C2[1])) / Rb];
  const alpha2 = ang(T, C2);
  const phi = ang(T, F);

  return [
    { cx: W - br, cy: br, r: br, a0: -Math.PI / 2, a1: 0 },
    { cx: C1[0], cy: C1[1], r: r1, a0: 0, a1: theta1 },
    { cx: C2[0], cy: C2[1], r: r2, a0: alpha1, a1: alpha2 },
    { cx: 0, cy: F[1], r: rc, a0: phi, a1: Math.PI - phi },
    { cx: -C2[0], cy: C2[1], r: r2, a0: Math.PI - alpha2, a1: Math.PI - alpha1 },
    { cx: -C1[0], cy: C1[1], r: r1, a0: Math.PI - theta1, a1: Math.PI },
    { cx: -(W - br), cy: br, r: br, a0: Math.PI, a1: Math.PI * 1.5 },
  ];
}

// A rounded rectangle as an arc loop: plinths, steps and base blocks.
function roundedRect(halfWidth, height, r) {
  return [
    { cx: halfWidth - r, cy: r, r, a0: -Math.PI / 2, a1: 0 },
    { cx: halfWidth - r, cy: height - r, r, a0: 0, a1: Math.PI / 2 },
    { cx: -(halfWidth - r), cy: height - r, r, a0: Math.PI / 2, a1: Math.PI },
    { cx: -(halfWidth - r), cy: r, r, a0: Math.PI, a1: Math.PI * 1.5 },
  ];
}

// ---------------------------------------------------------------------------
// sizes
//
// Against the ghost as it actually measures on screen, about 1.78. The
// reference has the arch and the obelisk reaching its shoulder and the celtic
// cross at about 0.62 of the arch, which lands them just above and just below
// the existing set's tallest stone at 1.56.

// The celtic cross is a three-way squeeze and the numbers are all on the edge
// of one of the three, so none of them is arbitrary:
//   * the ring's band must be wider than twice the edge round, or the front
//     face of the ring inverts -- the outer edge insets past the inner one --
//     and the annulus triangulates into a solid disc. A first pass had an 0.08
//     band against an 0.045 round and the four openings simply vanished;
//   * the ring's inner radius must clear the arms' corner, at arm * root two,
//     or the openings close up anyway;
//   * the arms have to reach a good way past the ring or they read as four
//     bumps on a wheel rather than as a cross.
// A fourth constraint turned up once the openings were there: for the groove to
// run parallel to the outline down both sides of an arm rather than converging
// into one slot along its centreline, the arm's half-thickness has to exceed
// the groove's inset plus its own half-width. At an 0.066 arm the two sides met
// and the cross came out with a slot cut down it. So the arms are thicker, and
// the ring is enlarged to keep the openings the arms would otherwise close.
const CELTIC = {
  H: 0.96,             // cross alone, on top of 0.156 of stepped plinth
  W: 0.368,            // arm span 0.736
  arm: 0.084,          // half-thickness of the arms and of the upper shaft
  foot: 0.126,         // the shaft widens toward the base, as the reference's does
  // The crossing sits at 62% of the cross's height. At 59% the shaft below the
  // ring was barely longer than the head above it and the piece read as a
  // wheel on a stub rather than as a standing cross.
  cross: 0.592,
  R: 0.272,            // arms and head stand 0.096 proud of the ring
  Ri: 0.167,           // 0.105 of band against an 0.034 round; clears 0.084 * 1.41
  depth: 0.158,
  edge: 0.034,
  groove: 0.058,       // inset of the groove from the silhouette
};

const ARCH = {
  H: 1.60,
  W: 0.44,
  depth: 0.34,         // at 0.30 the slab read as a flagstone from the side
  plinth: 0.185,       // 1.785 all in
  edge: 0.046,
  // The tip's radius has to clear the edge round for the same reason the ring's
  // band does. It also wants to be barely clear of it: at 0.085 the point came
  // out as a mushroom cap, which from behind was the first thing the eye found.
  tipR: 0.05,
  // The recessed panel is the stone's own outline scaled about a point, not
  // offset inward by a constant. An offset deeper than the tip's radius turns
  // the tip inside out, and the panel has to be a good 9cm in to read at all.
  // Scaling keeps every arc valid and keeps the panel unmistakably the same
  // shape as the stone, which is what the reference shows.
  panelScale: 0.82,
  panelAbout: 1.11,    // gives 0.088 of border at the top, 0.079 at the sides
};

const OBELISK = {
  s0: 0.182,           // half-width at the foot of the shaft
  s1: 0.123,           // at the shoulder
  shoulder: 1.475,
  // Where the cap's faces would meet if they ran to a point. Only 0.155 above
  // the shoulder: the reference's cap is shallow, and a taller one turned the
  // piece into a pencil.
  apex: 1.63,
  base: 0.13,
  baseHalf: 0.245,
};

// ---------------------------------------------------------------------------

export function createTallStone({ variant = 'celtic', seed = 1, scale = 1 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 17);
  const hasDOM = typeof document !== 'undefined';

  const group = new THREE.Group();
  // Inner group carries the seeded lean, so the caller still owns position and
  // rotation.y on the outer one.
  const body = new THREE.Group();
  group.add(body);

  const geos = [];
  const add = (geo, y = 0) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
    return m;
  };

  let material = null;
  let tex = null;
  const regions = [];
  // Filled in by the variant below, then read back once the texture exists.
  const build = { spans: null };
  const span = (key, t) => {
    const [u0, u1] = build.spans ? build.spans[key] : [0, 1];
    return u0 + (u1 - u0) * (0.03 + 0.94 * Math.min(1, Math.max(0, t)));
  };
  const strip = (t, v) => [span('strip', 0.15 + 0.7 * t), Math.min(1, Math.max(0, v))];

  if (variant === 'obelisk') {
    const O = OBELISK;
    const sil = obeliskSilhouette(
      { s0: O.s0, s1: O.s1, shoulder: O.shoulder, apex: O.apex, footFillet: 0.030, shoulderFillet: 0.055, noseRadius: 0.045 },
      SEGMENTS.curve,
    );
    const artH = sil.height;
    const aspect = (2 * O.s0) / artH;
    regions.push({ key: 'front', aspect, marks: inkSunAndBook });
    regions.push({ key: 'side', aspect, marks: inkScroll });
    tex = hasDOM ? buildTextures(regions, rng) : null;
    build.spans = tex ? tex.spans : null;
    material = toyMaterial(PALETTE.stone, { map: tex ? tex.map : null, normalMap: tex ? tex.normalMap : null });

    const shaftUV = (f, p, r) => {
      const v = r.y / artH;
      const xw = (r.s * p.x) / (2 * O.s0) + 0.5;
      const zw = (r.s * p.z) / (2 * O.s0) + 0.5;
      if (f === 0) return [span('front', xw), v];
      if (f === 3) return [span('side', zw), v];
      if (f === 1) return [span('side', 1 - zw), v];
      return strip(xw, v);
    };
    add(buildTaperedColumn({ silhouette: sil.samples, corner: 0.30, uv: shaftUV }), O.base);
    add(buildOutlineSlab({
      loops: [roundedRect(O.baseHalf, O.base, 0.05)],
      depth: O.baseHalf * 2,
      edge: 0.045,
      uv: (x, y) => strip((x + O.baseHalf) / (2 * O.baseHalf), (y / O.base) * GRIME),
    }));
    body.rotation.z = (rng() - 0.5) * 0.024;
    body.rotation.x = -0.008 - rng() * 0.012;
  } else if (variant === 'arch') {
    const A = ARCH;
    const outline = ogeeOutline({ halfWidth: A.W, height: A.H, springing: 1.02, lowerR: 0.30, upperR: 0.42, tipR: A.tipR, bottomR: 0.10 });
    const k = A.panelScale;
    const y0 = A.panelAbout;
    const panel = outline.map((a) => ({ cx: a.cx * k, cy: y0 + (a.cy - y0) * k, r: a.r * k, a0: a.a0, a1: a.a1 }));
    const pb = loopBounds([panel]);

    regions.push({
      key: 'front',
      aspect: (2 * A.W) / A.H,
      recess: (ctx, w, h) => {
        const P = (x, y) => [((x + A.W) / (2 * A.W)) * w, (1 - y / A.H) * h];
        const pts = sampleLoop(panel, 0, 26);
        ctx.beginPath();
        pts.forEach((p, i) => {
          const [X, Y] = P(p.x, p.y);
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        });
        ctx.closePath();
        ctx.fill();
      },
      marks: (ctx, w, h) => {
        // The tree's box, in the panel's own coordinates. Kept well inside the
        // panel wall on every side: a limb that runs into the wall stops being
        // a limb and reads as a crack in the stone.
        const P = (x, y) => [((x + A.W) / (2 * A.W)) * w, (1 - y / A.H) * h];
        const half = (pb.maxX - pb.minX) / 2;
        const [x0, yTop] = P(-half * 0.84, pb.minY + (pb.maxY - pb.minY) * 0.985);
        const [x1, yBot] = P(half * 0.84, pb.minY + (pb.maxY - pb.minY) * 0.045);
        ctx.save();
        ctx.translate(x0, yTop);
        inkTree(ctx, x1 - x0, yBot - yTop);
        ctx.restore();
      },
    });
    tex = hasDOM ? buildTextures(regions, rng) : null;
    build.spans = tex ? tex.spans : null;
    material = toyMaterial(PALETTE.stone, { map: tex ? tex.map : null, normalMap: tex ? tex.normalMap : null });

    // Only the front carries the panel. The reference's back is plain stone and
    // so is tombstones.js's, and a tree mirrored onto the back would be the
    // first thing the eye caught from behind.
    const slabUV = (x, y, face) => (face === 'front'
      ? [span('front', (x + A.W) / (2 * A.W)), Math.min(1, Math.max(0, y / A.H))]
      : strip((x + A.W) / (2 * A.W), y / A.H));
    add(buildOutlineSlab({ loops: [outline], depth: A.depth, edge: A.edge, uv: slabUV }), A.plinth);

    const pW = A.W + 0.075;
    const pD = A.depth + 0.13;
    add(buildOutlineSlab({
      loops: [roundedRect(pW, A.plinth, 0.056)],
      depth: pD,
      edge: 0.05,
      uv: (x, y) => strip((x + pW) / (2 * pW), (y / A.plinth) * GRIME),
    }));
    body.rotation.z = (rng() - 0.5) * 0.024;
    body.rotation.x = -0.008 - rng() * 0.012;
  } else {
    const C = CELTIC;
    const yc = C.cross;
    const a = C.arm;
    const plinth1 = 0.084;
    const plinth2 = 0.072;
    const base = plinth1 + plinth2;

    // The plus, counter-clockwise from the bottom of the right-hand side. The
    // shaft widens toward the foot, which is what stops a ringed cross reading
    // as a lollipop on a stick.
    const pts = [
      [C.foot, 0], [a, yc - a], [C.W, yc - a], [C.W, yc + a], [a * 0.94, yc + a], [a * 0.9, C.H],
      [-a * 0.9, C.H], [-a * 0.94, yc + a], [-C.W, yc + a], [-C.W, yc - a], [-a, yc - a], [-C.foot, 0],
    ];
    // Arm-end and head radii are just under the arm's own half-thickness, so
    // the ends come out properly round rather than as clipped tabs.
    const rr = [0.048, 0.055, 0.067, 0.067, 0.055, 0.06, 0.06, 0.055, 0.067, 0.067, 0.055, 0.048];
    const plus = roundPolygon(pts, rr);
    const ring = [
      [{ cx: 0, cy: yc, r: C.R, a0: 0, a1: TAU }],
      [{ cx: 0, cy: yc, r: C.Ri, a0: TAU, a1: 0 }],
    ];

    const edge = C.edge;
    regions.push({
      key: 'front',
      aspect: (2 * C.W) / C.H,
      marks: (ctx, w, h) => {
        const k = w / (2 * C.W);
        const P = (x, y) => [(x + C.W) * k, (1 - y / C.H) * h];
        ctx.lineCap = 'round';
        inkLoopGroove(ctx, plus, C.groove, 0.022 * k, P);
        // The ring gets the same treatment: one groove down the middle of the
        // band. Two, one inside each edge, merged into a smear at scene scale.
        ctx.beginPath();
        ctx.arc(...P(0, yc), ((C.R + C.Ri) / 2) * k, 0, TAU);
        ctx.lineWidth = 0.019 * k;
        ctx.stroke();
      },
    });
    tex = hasDOM ? buildTextures(regions, rng) : null;
    build.spans = tex ? tex.spans : null;
    material = toyMaterial(PALETTE.stone, { map: tex ? tex.map : null, normalMap: tex ? tex.normalMap : null });

    // "Every face carries a groove": the back samples the same artwork as the
    // front, mirrored, so the piece is finished from behind. Only the rim is
    // parked in the plain strip.
    const crossUV = (x, y, face) => {
      const v = Math.min(1, Math.max(0, y / C.H));
      const t = (x + C.W) / (2 * C.W);
      if (face === 'front') return [span('front', t), v];
      if (face === 'back') return [span('front', 1 - t), v];
      return strip(t, v);
    };

    add(buildOutlineSlab({ loops: [plus], depth: C.depth, edge, uv: crossUV }), base);
    // The ring is a hair shallower than the arms so its rim tucks into them
    // rather than crossing them, which is what turns the join into a joint.
    add(buildOutlineSlab({ loops: ring, depth: C.depth * 0.94, edge, uv: crossUV }), base);

    const p1W = 0.248;
    const p2W = 0.205;
    add(buildOutlineSlab({
      loops: [roundedRect(p1W, plinth1, 0.05)],
      depth: 0.30,
      edge: 0.045,
      uv: (x, y) => strip((x + p1W) / (2 * p1W), (y / plinth1) * GRIME * 0.55),
    }));
    add(buildOutlineSlab({
      loops: [roundedRect(p2W, plinth2, 0.05)],
      depth: 0.255,
      edge: 0.045,
      uv: (x, y) => strip((x + p2W) / (2 * p2W), GRIME * 0.55 + (y / plinth2) * GRIME * 0.45),
    }), plinth1);
    body.rotation.z = (rng() - 0.5) * 0.032;
    body.rotation.x = -0.010 - rng() * 0.016;
  }

  // Sunk a hair so the lean cannot open a gap under the base.
  body.position.y = -0.012;

  // --- ground contact -------------------------------------------------------
  //
  // Nothing here on purpose, and this is not an oversight to be tidied up. A
  // painted contact patch was tried on the first set of stones and rejected: a
  // decal laid flat on the floor is the same on every side of the prop, so it
  // ringed each one with a dark halo on the side facing the key light too,
  // which no shadow does. The key light casts a real one. If the joint ever
  // looks weak the fix is in the light, not in a stain under the stone.

  group.scale.setScalar(scale);

  return {
    group,
    update() {}, // static props
    dispose() {
      for (const g of geos) g.dispose();
      material.dispose();
      if (tex) {
        tex.map.dispose();
        tex.normalMap.dispose();
      }
    },
  };
}
