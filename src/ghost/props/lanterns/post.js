import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial } from '../style.js';

// A stone post lantern for the graveyard set.
//
// The other four lanterns are metal. This one is quarried from the same block
// as the headstones and is here to say so: a squat carved pillar, waist height,
// stacked out of rounded blocks the way a real stone lantern is, with a hollowed
// head near the top and a wide overhanging roof capping it.
//
// Two things carry the piece.
//
// The stone. It has to be the tombstones' stone or the prop has no reason to
// exist, so the weathered treatment here is theirs: the same low-contrast
// mottle, the same fine speckle, a normal map baked from a separate height
// canvas at the same strength, and the same wash of ground grime along the
// bottom. None of those helpers are exported from tombstones.js, so they are
// duplicated below rather than approximated. Anything that reads as a
// difference in material between this and a headstone is a bug.
//
// The openings. They are real holes: the head is a parametric surface over
// (angle, height), the four arched windows are outlines in the surface's own
// face space, and a window is cut by dropping the quads whose centres fall
// inside it, snapping the vertices left on the rim onto the true curve, and
// running a ribbon from that rim through the thickness of the stone to a second
// shell inside. That is pumpkin.js's technique. What is different here is that
// the wall rolls over at both ends instead of meeting the skin at an edge: this
// is vinyl, and a 5cm slab of toy stone has a fat radius on every lip.

// ---------------------------------------------------------------------------
// Deterministic noise.
//
// mulberry32 is tombstones.js's, makeNoise is pumpkin.js's. Both are private to
// those files; both are a handful of lines, so they are copied rather than
// worked around.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D value noise. Good for the slow channels and useless for the fast
// one: smoothstep has zero derivative at every lattice node, so a channel at
// f Hz stands still f times a second. See update() for what carries the tremble.
function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

// ---------------------------------------------------------------------------
// The cross-section.
//
// Every block in the stack is a lathe swept through the same squircle,
// |x|^4 + |z|^4 = 1: a square with corners of about four tenths of its half
// width, which is what says "carved out of a block" without a single sharp
// edge anywhere. A circle would have read as turned on a lathe, and a real
// square is out of the question in this house.
const SQ = 4;

function section(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const S = Math.pow(Math.abs(c), SQ) + Math.pow(Math.abs(s), SQ);
  const rho = Math.pow(S, -1 / SQ);
  // For SQ = 4, cos^4 + sin^4 collapses to 1 - sin^2(2a)/2 and its derivative
  // to -sin(4a). Written out because the general form needs sign(cos) branches
  // that this one does not.
  const dS = -Math.sin(4 * a);
  const drho = -(1 / SQ) * Math.pow(S, -1 / SQ - 1) * dS;
  return {
    x: rho * c,
    z: rho * s,
    dx: drho * c - rho * s,
    dz: drho * s + rho * c,
  };
}

// ---------------------------------------------------------------------------
// Profiles.
//
// A profile is a list of samples in (r, y) carrying the unit tangent along it,
// ordered bottom to top. Sweeping it gives a surface whose normal is exact at
// every vertex, so nothing here ever needs computeVertexNormals and nothing
// facets.
//
// Everything is built from arcs plus the straight runs between them, and the
// straight runs are never written down: two arcs that share an outer tangent
// are joined by a quad strip that IS the tangent line. tangentT() is what finds
// the angle where they touch, so a rounded edge always leaves tangent to the
// side it runs into and there is no crease to find.

function makeProfile() {
  const pts = [];
  const push = (r, y, tr, ty) => {
    const L = Math.hypot(tr, ty) || 1;
    const p = { r, y, tr: tr / L, ty: ty / L };
    const last = pts[pts.length - 1];
    if (last
      && Math.abs(last.r - p.r) < 1e-9 && Math.abs(last.y - p.y) < 1e-9
      && Math.abs(last.tr - p.tr) < 1e-6 && Math.abs(last.ty - p.ty) < 1e-6) return;
    pts.push(p);
  };
  const api = {
    pts,
    line(r0, y0, r1, y1) {
      push(r0, y0, r1 - r0, y1 - y0);
      push(r1, y1, r1 - r0, y1 - y0);
      return api;
    },
    arc(cr, cy, rad, a0, a1, seg) {
      const dir = Math.sign(a1 - a0) || 1;
      for (let i = 0; i <= seg; i++) {
        const t = a0 + (a1 - a0) * (i / seg);
        push(cr + rad * Math.cos(t), cy + rad * Math.sin(t), -Math.sin(t) * dir, Math.cos(t) * dir);
      }
      return api;
    },
  };
  return api;
}

// The angle on both circles at which they share an outer tangent. Both radii
// point the same way there, which is the whole reason the profile can walk from
// one arc straight into the next.
function tangentT(c0, c1) {
  const dr = c1.cr - c0.cr;
  const dy = c1.cy - c0.cy;
  const amp = Math.hypot(dr, dy) || 1e-9;
  const k = Math.max(-1, Math.min(1, (c0.rad - c1.rad) / amp));
  const t = Math.atan2(dy, dr) - Math.acos(k);
  // Wrapped into (-pi, pi]. Unwrapped, an arc that ends at -5.1 rather than 1.2
  // is asked to sweep the long way round and comes out as a whole sphere with
  // the rest of the prop inside it, which is exactly what happened.
  return ((t + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

// A rounded block: bottom face, rolled bottom edge, tapered side, rolled top
// edge, top face. The workhorse of the stack.
function roundedBlock(rBot, rTop, y0, y1, edge, seg = 7) {
  const c0 = { cr: rBot - edge, cy: y0 + edge, rad: edge };
  const c1 = { cr: rTop - edge, cy: y1 - edge, rad: edge };
  const t = tangentT(c0, c1);
  return makeProfile()
    .line(0, y0, c0.cr, y0)
    .arc(c0.cr, c0.cy, edge, -Math.PI / 2, t, seg)
    .arc(c1.cr, c1.cy, edge, t, Math.PI / 2, seg)
    .line(c1.cr, y1, 0, y1)
    .pts;
}

// ---------------------------------------------------------------------------
// Proportions.
//
// Authored against the headstones, which measure 1.10 for the short one and
// 1.56 for the tall pair with the ghost at about 1.78. This tops out at 1.27,
// which puts the head at a standing figure's waist and the roof clear of the
// short stone's shoulder. Every block is wider than it is tall: the piece has
// to read as heavy, and a slender stone lantern is a metal lantern's silhouette
// in the wrong material.
const FOOT = { rBot: 0.300, rTop: 0.286, y0: 0.000, y1: 0.112, edge: 0.050 };
const PLATE = { rBot: 0.232, rTop: 0.222, y0: 0.100, y1: 0.182, edge: 0.042 };
const SHAFT = { rBot: 0.190, rTop: 0.158, y0: 0.170, y1: 0.648, edge: 0.055 };
// The little table the head sits on, flared out over the shaft.
const TABLE = { rBot: 0.176, rTop: 0.250, y0: 0.600, y1: 0.730, edge: 0.046 };

// The head. rv is the radius that rolls its top and bottom edges over, t the
// thickness of the stone: the inner shell is the outer one pushed t along its
// own normal, so t has to stay under rv or the rolled corner turns itself
// inside out.
const HEAD = { r: 0.256, y0: 0.700, y1: 1.032, rv: 0.060, t: 0.048 };

// One arched window, in the head's face space: x across the face, y in world
// height. It is the headstones' own outline shrunk to a hand's width, which is
// not a joke at the set's expense so much as the cheapest way to say the two
// things came from the same yard.
const WIN = { half: 0.088, y0: 0.776, y1: 0.952, rBot: 0.026 };
// The other two faces get a small round moon instead. See FACE_CUTS for why.
const MOON_HOLE = { y: 0.880, r: 0.047 };
// How far the lip rolls over before the wall goes straight. Nearly half the
// thickness, so both ends of the wall are round and the little straight run in
// the middle is all that is left of the flat.
const LIP = 0.019;

const ROOF = {
  // The eave: a fat half-round, the widest thing in the piece, and the reason
  // the head reads as sheltered rather than merely open.
  eave: { cr: 0.322, cy: 1.066, rad: 0.054 },
  under: 1.012,
  // The cap, an arc of a big circle so the slope is a hair convex. Flat and it
  // reads as a pyramid, which is a different lantern.
  dome: { cr: 0, cy: 0.930, rad: 0.280 },
};
const FINIAL = { y: 1.202, r: 0.056 };

const TOTAL_H = 1.258;

// ---------------------------------------------------------------------------
// The weathered stone.
//
// Lifted from tombstones.js, numbers and all, because matching it by eye from a
// description is exactly the kind of thing that comes out a different material.
// mottle(), heightToNormalMap() and the grime wash are private there; if they
// are ever exported this block should become three imports.
//
// Two changes, both so the grain and the grime land at the same size in WORLD
// units as they do on a headstone rather than at the same fraction of a
// texture. A stone lantern is a different shape to a slab, so the maps here are
// laid out in metres and the counts scale with the area.

const PPU = 620;        // texture pixels per world unit
const TEX_U = 2.50;     // world units the map spans around the piece
const TEX_V = 1.36;     // and up it
// The tombstones' grime runs from 0.34 at the ground to nothing 0.93 above it.
// Same numbers here, so a lantern and a headstone are equally dirty at equal
// heights.
const GRIME_TOP = 0.93;
const GRIME_ALPHA = 0.34;

function mottle(ctx, w, h, rng, light, dark, strength, speckle = true) {
  const area = (w * h) / (848 * 1024); // tombstones' own canvas, for the counts
  const blobs = Math.round(130 * area);
  for (let i = 0; i < blobs; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.035 + rng() * 0.13) * 1024;
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
  const grains = Math.round(2600 * area);
  for (let i = 0; i < grains; i++) {
    ctx.fillStyle = `rgba(${rng() < 0.5 ? light : dark}, ${strength * 0.55})`;
    ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }
}

// Height canvas to tangent-space normal map. A bumpMap would be cheaper and its
// relief would soften as the camera pulls back; slopes baked here hold up at
// any distance.
function heightToNormalMap(canvas, strength) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => src[((y < 0 ? 0 : y > h - 1 ? h - 1 : y) * w + (x < 0 ? 0 : x > w - 1 ? w - 1 : x)) * 4] / 255;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // DataTexture ignores flipY, so the flip a CanvasTexture gets for free has
    // to happen here by hand.
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

function buildTextures(rng) {
  const w = Math.round(TEX_U * PPU);
  const h = Math.round(TEX_V * PPU);

  const colour = document.createElement('canvas');
  colour.width = w;
  colour.height = h;
  const cc = colour.getContext('2d');
  // White base: PALETTE.stone lives on the material and stays the single source
  // of truth for the hue, exactly as on a headstone.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, h);
  mottle(cc, w, h, rng, '120,116,110', '255,255,255', 0.085);

  // Ground grime, strongest where the stone meets the dirt. v runs up the
  // piece, so the band is at the bottom of the canvas.
  const band = h * (GRIME_TOP / TEX_V);
  const grime = cc.createLinearGradient(0, h - band, 0, h);
  grime.addColorStop(0, 'rgba(146,142,136,0)');
  grime.addColorStop(1, `rgba(146,142,136,${GRIME_ALPHA})`);
  cc.fillStyle = grime;
  cc.fillRect(0, h - band, w, band);

  const height = document.createElement('canvas');
  height.width = w;
  height.height = h;
  const hc = height.getContext('2d');
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w, h);
  // Half the colour map's amplitude and no speckle: on the height map those
  // high frequencies come back through the normals as sandpaper.
  mottle(hc, w, h, mulberry32(1), '96,96,96', '176,176,176', 0.065, false);

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, normalMap: heightToNormalMap(height, 14) };
}

// ---------------------------------------------------------------------------
// The flame.
//
// Same fire as pumpkin.js, and the ranges are pinned to the same 2.15:1 swing
// so the two read as the same candle at different distances. The absolute
// levels are this file's own: there is one light here doing every job the
// pumpkin splits between a gobo spot and an omni glow.
const LAMP = { min: 0.40, max: 0.86 };     // the one PointLight
const FLAME_EM = { min: 1.95, max: 4.20 }; // the visible tongue of flame
// The interior, and it is held well under the flame on purpose. Taken up until
// the chamber reads as a lightbox, the tongue of flame in front of it goes to a
// dark smudge: the one thing in the frame that is actually on fire has to be
// the brightest thing in it.
const BOX = { min: 0.40, max: 0.86 };

const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// The emissive pair is warmer than the light's: ACES desaturates as it
// brightens, so an emissive at the palette's glow washes to cream before it is
// bright enough to read as fire.
const PLATE_EMBER = new THREE.Color('#ff7b2c');
const PLATE_FLAME = new THREE.Color('#ffb44a');
// The interior is stone, so what is painted on it is the flame's colour after
// it has bounced off grey rock rather than the flame itself.
const BOX_EMBER = new THREE.Color('#f8853a');
const BOX_FLAME = new THREE.Color('#ffcb86');
// The level spends its life in the top eighth of its range, so the colour mix
// is levered about its mean rather than taken off it straight.
const HUE_MID = 0.88;
const HUE_GAIN = 1.5;

// ---------------------------------------------------------------------------

export function createPostLantern({ seed = 1, scale = 1 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 17);
  const noise = makeNoise(seed);
  const flickerPhase = rng() * 100;

  // Segment counts. SEGMENTS is sized for a plain round surface; the head is
  // the thing being cut, so its grid has to have a cell small next to the
  // width of a window's arch.
  const RADIAL = SEGMENTS.radial + 24;        // 72, for the stacked blocks
  const HEAD_RADIAL = SEGMENTS.radial * 2 + 32; // 128, for the head
  // The seam, where u wraps. Parked on a back corner of the squircle: the
  // corners are the one place on this shape where a texture join has a
  // silhouette to hide behind.
  const SEAM = Math.PI * 1.25;

  // --- shared buffers -------------------------------------------------------
  // Every piece of stone lands in one geometry. They are all the same material
  // and none of them animates, so a stack of six blocks and a cut head is one
  // draw call.
  const stone = { pos: [], nor: [], uv: [], idx: [] };
  // The interior is its own buffer: it is a painted lightbox rather than a lit
  // surface, for reasons set out where its material is built.
  const box = { pos: [], nor: [], uv: [], col: [], idx: [] };

  // Surface normal of a lathe with a modulated cross-section. The exact cross
  // product of the two parameter derivatives, which is worth the four lines:
  // there is no averaging, so no faceting and no seam.
  const laneNormal = (sec, tr, ty, out) => {
    out.set(ty * sec.dz, tr * (sec.z * sec.dx - sec.x * sec.dz), -ty * sec.dx);
    return out.normalize();
  };

  const tmpN = new THREE.Vector3();

  function emitLathe(target, profile, radial, rRef) {
    const base = target.pos.length / 3;
    const n = profile.length;
    const secs = [];
    for (let i = 0; i <= radial; i++) {
      const a = SEAM + (i / radial) * Math.PI * 2;
      secs.push({ a, s: section(a) });
    }
    for (let j = 0; j < n; j++) {
      const p = profile[j];
      for (let i = 0; i <= radial; i++) {
        const s = secs[i].s;
        target.pos.push(p.r * s.x, p.y, p.r * s.z);
        laneNormal(s, p.tr, p.ty, tmpN);
        target.nor.push(tmpN.x, tmpN.y, tmpN.z);
        target.uv.push((i / radial) * (Math.PI * 2 * rRef) / TEX_U, p.y / TEX_V);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < radial; i++) {
        const a = base + j * (radial + 1) + i;
        const b = a + 1;
        const c = a + radial + 1;
        const d = c + 1;
        target.idx.push(a, c, b, b, c, d);
      }
    }
  }

  emitLathe(stone, roundedBlock(FOOT.rBot, FOOT.rTop, FOOT.y0, FOOT.y1, FOOT.edge), RADIAL, FOOT.rBot);
  emitLathe(stone, roundedBlock(PLATE.rBot, PLATE.rTop, PLATE.y0, PLATE.y1, PLATE.edge), RADIAL, PLATE.rBot);
  emitLathe(stone, roundedBlock(SHAFT.rBot, SHAFT.rTop, SHAFT.y0, SHAFT.y1, SHAFT.edge, 9), RADIAL, SHAFT.rBot);
  emitLathe(stone, roundedBlock(TABLE.rBot, TABLE.rTop, TABLE.y0, TABLE.y1, TABLE.edge), RADIAL, TABLE.rTop);

  // The roof: flat underside out to the eave, the eave rolling over, then the
  // slope and the domed cap. The slope is never written down, it is the tangent
  // line between the eave circle and the dome.
  {
    const tE = tangentT({ cr: ROOF.eave.cr, cy: ROOF.eave.cy, rad: ROOF.eave.rad }, ROOF.dome);
    const roof = makeProfile()
      .line(0, ROOF.under, ROOF.eave.cr, ROOF.under)
      .arc(ROOF.eave.cr, ROOF.eave.cy, ROOF.eave.rad, -Math.PI / 2, tE, 12)
      .arc(ROOF.dome.cr, ROOF.dome.cy, ROOF.dome.rad, tE, Math.PI / 2, 12)
      .pts;
    emitLathe(stone, roof, RADIAL, ROOF.eave.cr + ROOF.eave.rad);
  }

  // A ball on top. It is the one round thing on the piece, and it is what stops
  // the roof from reading as unfinished.
  {
    const seg = 12;
    const ball = makeProfile();
    ball.line(0, FINIAL.y - FINIAL.r * 0.62, FINIAL.r * 0.5, FINIAL.y - FINIAL.r * 0.62);
    ball.arc(0, FINIAL.y, FINIAL.r, -Math.asin(0.62), Math.PI / 2, seg);
    emitLathe(stone, ball.pts, RADIAL, FINIAL.r);
  }

  // --- the head -------------------------------------------------------------

  // The head's profile as a function of height, so a vertex that gets dragged
  // off the grid by the rim snap still lands exactly on the surface.
  const headAt = (y) => {
    const { r, y0, y1, rv } = HEAD;
    if (y <= y0 + rv) {
      const t = Math.asin(Math.max(-1, Math.min(1, (y - (y0 + rv)) / rv)));
      return { r: r - rv + rv * Math.cos(t), tr: -Math.sin(t), ty: Math.cos(t) };
    }
    if (y >= y1 - rv) {
      const t = Math.asin(Math.max(-1, Math.min(1, (y - (y1 - rv)) / rv)));
      return { r: r - rv + rv * Math.cos(t), tr: -Math.sin(t), ty: Math.cos(t) };
    }
    return { r, tr: 0, ty: 1 };
  };

  // A point on the head, offset along its own normal. off = 0 is the outside of
  // the stone, off = -HEAD.t the inside.
  const headPoint = (a, y, off, outP, outN) => {
    const s = section(a);
    const p = headAt(y);
    laneNormal(s, p.tr, p.ty, outN);
    outP.set(p.r * s.x, y, p.r * s.z).addScaledVector(outN, off);
    return outP;
  };

  // Face space. The head has four faces, a vertex belongs to the one it is
  // nearest, and x is its offset across that face measured at the head's full
  // width. An opening is then one outline in (x, y) rather than four sets of
  // numbers agreeing with each other.
  const faceOffset = (a) => a - Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  const faceIndex = (a) => ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
  const faceX = (da) => HEAD.r * section(da).z;
  // and back again, by bisection: faceX is monotonic across a face.
  const faceA = (x) => {
    let lo = -Math.PI / 4;
    let hi = Math.PI / 4;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (faceX(mid) < x) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // An outline walked counter-clockwise off a list of corner arcs, and its
  // bounding box. Four arcs give the arch: a rounded foot, straight sides and a
  // true half-round top tangent to them, which is the headstones' own
  // construction at a hand's size. One arc gives the moon.
  const outlineOf = (corners) => {
    const pts = [];
    for (const c of corners) {
      for (let i = 0; i <= c.seg; i++) {
        const t = c.a0 + (c.a1 - c.a0) * (i / c.seg);
        const x = c.cx + c.r * Math.cos(t);
        const y = c.cy + c.r * Math.sin(t);
        const last = pts[pts.length - 1];
        if (!last || Math.abs(x - last[0]) + Math.abs(y - last[1]) > 1e-7) pts.push([x, y]);
      }
    }
    while (pts.length > 2) {
      const f = pts[0];
      const l = pts[pts.length - 1];
      if (Math.abs(f[0] - l[0]) + Math.abs(f[1] - l[1]) < 1e-7) pts.pop(); else break;
    }
    return pts.reduce((b, q) => ({
      minX: Math.min(b.minX, q[0]), maxX: Math.max(b.maxX, q[0]),
      minY: Math.min(b.minY, q[1]), maxY: Math.max(b.maxY, q[1]), pts,
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, pts });
  };

  const ARCH = outlineOf([
    { cx: WIN.half - WIN.rBot, cy: WIN.y0 + WIN.rBot, r: WIN.rBot, a0: -Math.PI / 2, a1: 0, seg: 7 },
    { cx: 0, cy: WIN.y1 - WIN.half, r: WIN.half, a0: 0, a1: Math.PI / 2, seg: 16 },
    { cx: 0, cy: WIN.y1 - WIN.half, r: WIN.half, a0: Math.PI / 2, a1: Math.PI, seg: 16 },
    { cx: -(WIN.half - WIN.rBot), cy: WIN.y0 + WIN.rBot, r: WIN.rBot, a0: Math.PI, a1: Math.PI * 1.5, seg: 7 },
  ]);
  const MOON = outlineOf([{ cx: 0, cy: MOON_HOLE.y, r: MOON_HOLE.r, a0: 0, a1: Math.PI * 2, seg: 30 }]);

  // Two arches and two moons, and which face gets which is the whole reason the
  // moons exist. Four identical arches means every arch has another arch
  // directly behind it, so at any camera angle the eye looks clean through the
  // head and out the far side, and what should be a lit chamber is a slot with
  // the sky in it. Opposite faces carry different openings instead: behind
  // every arch is a lit wall with a small round moon in it, which is a thing to
  // look at rather than a hole, and the two moons still let the flame out.
  const FACE_CUTS = [ARCH, ARCH, MOON, MOON];

  // Crossing count, bounding box first.
  const inCut = (cut, x, y) => {
    if (x < cut.minX || x > cut.maxX || y < cut.minY || y > cut.maxY) return false;
    const pts = cut.pts;
    let hit = false;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const yi = pts[i][1];
      const yk = pts[k][1];
      if ((yi > y) !== (yk > y) && x < ((pts[k][0] - pts[i][0]) * (y - yi)) / (yk - yi) + pts[i][0]) hit = !hit;
    }
    return hit;
  };

  // Nearest point on the outline, and the normal of the segment it landed on,
  // pointing into the opening. That normal is what the wall is built against,
  // so no loop tracing is needed: every rim vertex carries its own direction
  // into the cut.
  const snapTo = (cut, x, y) => {
    const pts = cut.pts;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const f = pts[i];
      const g = pts[(i + 1) % pts.length];
      const ex = g[0] - f[0];
      const ey = g[1] - f[1];
      const len2 = ex * ex + ey * ey || 1e-12;
      const t = Math.min(1, Math.max(0, ((x - f[0]) * ex + (y - f[1]) * ey) / len2));
      const cx = f[0] + ex * t;
      const cy = f[1] + ey * t;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        best = { x: cx, y: cy, nx: -ey * inv, ny: ex * inv };
      }
    }
    return best;
  };

  // The head's grid. Rows are the profile: the rolled top and bottom edges get
  // their own arcs, and the straight middle, which is where the windows live,
  // gets a cell about as tall as it is wide.
  const headRows = (() => {
    const ys = [];
    const { y0, y1, rv } = HEAD;
    const cap = 8;
    for (let i = 0; i <= cap; i++) {
      const t = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
      ys.push(y0 + rv + rv * Math.sin(t));
    }
    const midRows = 26;
    for (let i = 1; i < midRows; i++) ys.push((y0 + rv) + ((y1 - rv) - (y0 + rv)) * (i / midRows));
    for (let i = 0; i <= cap; i++) {
      const t = (i / cap) * (Math.PI / 2);
      ys.push(y1 - rv + rv * Math.sin(t));
    }
    return ys;
  })();

  const HR = HEAD_RADIAL;
  const nCols = HR + 1;
  const nRows = headRows.length;
  const gA = new Float64Array(nRows * nCols);
  const gY = new Float64Array(nRows * nCols);
  const at = (j, i) => j * nCols + i;
  for (let j = 0; j < nRows; j++) {
    for (let i = 0; i < nCols; i++) {
      gA[at(j, i)] = SEAM + (i / HR) * Math.PI * 2;
      gY[at(j, i)] = headRows[j];
    }
  }

  // Drop the quads whose centre falls inside a window. Testing the centre
  // rather than all four corners lets a quad straddle the outline, which the
  // rim snap then pulls back onto the true curve; testing the corners instead
  // would keep the hole strictly inside the outline and cost it a whole cell of
  // width all the way round.
  const nQuadRows = nRows - 1;
  const dropped = new Uint8Array(nQuadRows * HR);
  const qAt = (j, i) => j * HR + i;
  for (let j = 0; j < nQuadRows; j++) {
    for (let i = 0; i < HR; i++) {
      const a = (gA[at(j, i)] + gA[at(j, i + 1)]) / 2;
      const y = (gY[at(j, i)] + gY[at(j + 1, i)]) / 2;
      if (inCut(FACE_CUTS[faceIndex(a)], faceX(faceOffset(a)), y)) dropped[qAt(j, i)] = 1;
    }
  }

  // A vertex is on the rim when it touches both a dropped quad and a kept one.
  // Pull it onto the outline, clamped to under a cell in each direction: a rim
  // vertex is shared with the quads that survive, and one dragged clean across
  // a neighbour turns that quad inside out.
  const isRim = new Uint8Array(nRows * nCols);
  const rimNX = new Float64Array(nRows * nCols);
  const rimNY = new Float64Array(nRows * nCols);
  {
    const quadOf = (j, i) => (j < 0 || j >= nQuadRows || i < 0 || i >= HR ? 0 : dropped[qAt(j, i)]);
    const cellA = (Math.PI * 2) / HR;
    for (let j = 0; j < nRows; j++) {
      for (let i = 0; i < nCols; i++) {
        const around = [quadOf(j - 1, i - 1), quadOf(j - 1, i), quadOf(j, i - 1), quadOf(j, i)];
        if (!around.some(Boolean) || around.every(Boolean)) continue;
        const k = at(j, i);
        const da = faceOffset(gA[k]);
        const hit = snapTo(FACE_CUTS[faceIndex(gA[k])], faceX(da), gY[k]);
        if (!hit) continue;
        const cellY = Math.max(
          j > 0 ? gY[k] - gY[at(j - 1, i)] : 0,
          j < nRows - 1 ? gY[at(j + 1, i)] - gY[k] : 0,
        );
        const targetA = gA[k] - da + faceA(hit.x);
        gA[k] += Math.max(-cellA * 0.92, Math.min(cellA * 0.92, targetA - gA[k]));
        gY[k] += Math.max(-cellY * 0.92, Math.min(cellY * 0.92, hit.y - gY[k]));
        isRim[k] = 1;
        rimNX[k] = hit.nx;
        rimNY[k] = hit.ny;
      }
    }
  }

  // --- the two shells -------------------------------------------------------
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();

  const headOuterBase = stone.pos.length / 3;
  for (let j = 0; j < nRows; j++) {
    for (let i = 0; i < nCols; i++) {
      const k = at(j, i);
      headPoint(gA[k], gY[k], 0, P, N);
      stone.pos.push(P.x, P.y, P.z);
      stone.nor.push(N.x, N.y, N.z);
      stone.uv.push((i / HR) * (Math.PI * 2 * HEAD.r) / TEX_U, gY[k] / TEX_V);
    }
  }
  const boxInnerBase = box.pos.length / 3;
  // Where the flame sits, and what the interior is shaded against.
  const FLAME_Y = 0.845;
  const LIGHT = new THREE.Vector3(0, FLAME_Y, 0);
  // Baked falloff for the lightbox: a diffuse term against the flame plus an
  // inverse-square that is softened at the bottom, because a candle is a small
  // flame and not a point.
  const boxShade = (p, n) => {
    const dx = LIGHT.x - p.x;
    const dy = LIGHT.y - p.y;
    const dz = LIGHT.z - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2) || 1e-6;
    const lambert = Math.max(0, (dx * n.x + dy * n.y + dz * n.z) / d);
    // The half-power distance is 0.23, a little over the width of the chamber.
    // That is not the inverse square a real flame throws and it is not meant to
    // be: over 20cm a true falloff is 25:1 between the floor and the far
    // corner, which paints the interior black everywhere except right under the
    // candle. Flattened to about 2:1 the chamber still has a gradient across
    // it, the corners still fall away, and nothing is crushed.
    return (0.16 + 0.84 * lambert) * (0.055 / (0.055 + d2));
  };
  {
    const c = new THREE.Vector3();
    for (let j = 0; j < nRows; j++) {
      for (let i = 0; i < nCols; i++) {
        const k = at(j, i);
        headPoint(gA[k], gY[k], -HEAD.t, P, N);
        // Normals point into the chamber: this face is seen from inside.
        box.pos.push(P.x, P.y, P.z);
        box.nor.push(-N.x, -N.y, -N.z);
        box.uv.push((i / HR) * (Math.PI * 2 * HEAD.r) / TEX_U, gY[k] / TEX_V);
        c.set(-N.x, -N.y, -N.z);
        const s = boxShade(P, c);
        box.col.push(s, s, s);
      }
    }
  }

  for (let j = 0; j < nQuadRows; j++) {
    for (let i = 0; i < HR; i++) {
      if (dropped[qAt(j, i)]) continue;
      const a = headOuterBase + at(j, i);
      const b = a + 1;
      const c = a + nCols;
      const d = c + 1;
      stone.idx.push(a, c, b, b, c, d);
      const e = boxInnerBase + at(j, i);
      const f = e + 1;
      const g = e + nCols;
      const h = g + 1;
      box.idx.push(e, f, g, f, h, g); // wound the other way, seen from inside
    }
  }

  // Caps. The outer ones are buried in the table below and the roof above and
  // are here only so the shell is closed to the shadow map; the inner ones are
  // the chamber's floor and ceiling and are very much on show.
  const capRing = (target, ring, y, up, base, shade) => {
    const centre = target.pos.length / 3;
    target.pos.push(0, y, 0);
    target.nor.push(0, up, 0);
    target.uv.push(0.5, y / TEX_V);
    if (shade) {
      const s = boxShade(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, up, 0));
      target.col.push(s, s, s);
    }
    for (let i = 0; i < HR; i++) {
      const a = base + ring * nCols + i;
      const b = base + ring * nCols + i + 1;
      // Seen from above, increasing angle runs clockwise in the xz plane, so an
      // up-facing fan is wound (centre, b, a) and a down-facing one the other
      // way. Backwards, the chamber floor culls and the window shows the
      // background through the bottom of the head.
      if (up > 0) target.idx.push(centre, b, a); else target.idx.push(centre, a, b);
    }
  };
  capRing(stone, 0, HEAD.y0, -1, headOuterBase, false);
  capRing(stone, nRows - 1, HEAD.y1, 1, headOuterBase, false);
  capRing(box, 0, HEAD.y0 + HEAD.t, 1, boxInnerBase, true);
  capRing(box, nRows - 1, HEAD.y1 - HEAD.t, -1, boxInnerBase, true);

  // --- the window walls -----------------------------------------------------
  //
  // One ribbon per grid edge with a dropped quad on one side and a kept one on
  // the other. The rim is already snapped onto the outline, so the ribbon
  // follows the true arch; what it does through the thickness is the house
  // style's doing. A straight extrusion would meet the skin at an edge, and
  // there are no edges on this shelf, so the wall leaves the outer skin
  // tangent, rolls over a radius of LIP into the throat of the opening, runs
  // straight for what is left of the stone, and rolls back out tangent to the
  // inner skin. Both lips are fat and round and the opening has a visible
  // thickness from every angle.
  const WALL_RINGS = (() => {
    const rings = [];
    const rollSeg = 5;
    for (let i = 0; i <= rollSeg; i++) {
      const phi = (i / rollSeg) * (Math.PI / 2);
      rings.push({ e: LIP * Math.sin(phi), d: LIP * (1 - Math.cos(phi)), nf: Math.sin(phi), nn: Math.cos(phi) });
    }
    for (let i = rollSeg; i >= 0; i--) {
      const phi = (i / rollSeg) * (Math.PI / 2);
      rings.push({ e: LIP * Math.sin(phi), d: HEAD.t - LIP * (1 - Math.cos(phi)), nf: Math.sin(phi), nn: -Math.cos(phi) });
    }
    return rings;
  })();

  const wallBase = stone.pos.length / 3;
  const wallOf = new Map(); // rim vertex -> its column of wall vertices
  {
    const p0 = new THREE.Vector3();
    const n0 = new THREE.Vector3();
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    const F = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const EPS = 1e-3;

    const buildColumn = (k) => {
      if (wallOf.has(k)) return wallOf.get(k);
      const first = stone.pos.length / 3;
      const da = faceOffset(gA[k]);
      const x = faceX(da);
      const y = gY[k];
      const nx = rimNX[k];
      const ny = rimNY[k];
      for (const ring of WALL_RINGS) {
        const fx = x + nx * ring.e;
        const fy = y + ny * ring.e;
        const a = gA[k] - da + faceA(fx);
        headPoint(a, fy, -ring.d, P, N);
        stone.pos.push(P.x, P.y, P.z);
        // The direction "into the opening" in three dimensions, taken off the
        // surface itself rather than assumed flat.
        headPoint(gA[k] - da + faceA(x + nx * EPS), y + ny * EPS, -ring.d, pa, n0);
        headPoint(gA[k] - da + faceA(x - nx * EPS), y - ny * EPS, -ring.d, pb, n0);
        F.copy(pa).sub(pb).normalize();
        headPoint(a, fy, -ring.d, p0, n0);
        nn.copy(n0).multiplyScalar(ring.nn).addScaledVector(F, ring.nf).normalize();
        stone.nor.push(nn.x, nn.y, nn.z);
        stone.uv.push(
          (((gA[k] - SEAM) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) * HEAD.r / TEX_U,
          fy / TEX_V,
        );
      }
      wallOf.set(k, first);
      return first;
    };

    const ribbon = (kA, kB) => {
      const cA = buildColumn(kA);
      const cB = buildColumn(kB);
      const n = WALL_RINGS.length;
      // Winding from the geometry rather than from a case analysis of which
      // side the hole is on: build one quad, compare its face normal with the
      // normal the wall is meant to have, and swap the pair if it is backwards.
      const ax = stone.pos[cA * 3], ay = stone.pos[cA * 3 + 1], az = stone.pos[cA * 3 + 2];
      const bx = stone.pos[cB * 3], by = stone.pos[cB * 3 + 1], bz = stone.pos[cB * 3 + 2];
      const a2 = (cA + 1) * 3;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = stone.pos[a2] - ax, vy = stone.pos[a2 + 1] - ay, vz = stone.pos[a2 + 2] - az;
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const want = cA * 3;
      const flip = (cx * stone.nor[want] + cy * stone.nor[want + 1] + cz * stone.nor[want + 2]) < 0;
      const L = flip ? cB : cA;
      const R = flip ? cA : cB;
      for (let m = 0; m < n - 1; m++) {
        stone.idx.push(L + m, R + m, L + m + 1, R + m, R + m + 1, L + m + 1);
      }
    };

    const quadOf = (j, i) => (j < 0 || j >= nQuadRows || i < 0 || i >= HR ? 0 : dropped[qAt(j, i)]);
    for (let j = 0; j < nRows; j++) {
      for (let i = 0; i < nCols; i++) {
        // Vertical grid edge, between this vertex and the one above it.
        if (j < nRows - 1 && quadOf(j, i - 1) !== quadOf(j, i)) ribbon(at(j, i), at(j + 1, i));
        // Horizontal grid edge, between this vertex and the one to its right.
        if (i < nCols - 1 && quadOf(j - 1, i) !== quadOf(j, i)) ribbon(at(j, i), at(j, i + 1));
      }
    }
  }
  void wallBase;

  // --- the candle -----------------------------------------------------------
  // A stub of wax on the chamber floor. It is small and it is only ever seen
  // through a hand-sized window, but without it the flame is a flame floating
  // in a box.
  {
    const cy0 = HEAD.y0 + HEAD.t;
    const prof = roundedBlock(0.038, 0.035, cy0, cy0 + 0.056, 0.015, 5);
    const base = box.pos.length / 3;
    const radial = 24;
    const secs = [];
    for (let i = 0; i <= radial; i++) secs.push(section(SEAM + (i / radial) * Math.PI * 2));
    const c = new THREE.Vector3();
    for (let j = 0; j < prof.length; j++) {
      const p = prof[j];
      for (let i = 0; i <= radial; i++) {
        const s = secs[i];
        laneNormal(s, p.tr, p.ty, tmpN);
        P.set(p.r * s.x, p.y, p.r * s.z);
        box.pos.push(P.x, P.y, P.z);
        box.nor.push(tmpN.x, tmpN.y, tmpN.z);
        box.uv.push((i / radial) * (Math.PI * 2 * 0.036) / TEX_U, p.y / TEX_V);
        c.copy(tmpN);
        const sh = Math.min(1.6, boxShade(P, c) * 1.25);
        box.col.push(sh, sh, sh);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) {
      for (let i = 0; i < radial; i++) {
        const a = base + j * (radial + 1) + i;
        box.idx.push(a, a + radial + 1, a + 1, a + 1, a + radial + 1, a + radial + 2);
      }
    }
  }

  // --- geometry -------------------------------------------------------------
  const finish = (target, withColour) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(target.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(target.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(target.uv, 2));
    if (withColour) g.setAttribute('color', new THREE.Float32BufferAttribute(target.col, 3));
    g.setIndex(target.idx);
    g.computeBoundingSphere();
    return g;
  };

  const stoneGeo = finish(stone, false);
  const boxGeo = finish(box, true);

  const hasDOM = typeof document !== 'undefined';
  const tex = hasDOM ? buildTextures(rng) : null;
  if (tex) {
    tex.map.wrapS = THREE.RepeatWrapping;
    tex.map.wrapT = THREE.ClampToEdgeWrapping;
    tex.normalMap.wrapS = THREE.RepeatWrapping;
    tex.normalMap.wrapT = THREE.ClampToEdgeWrapping;
  }

  const stoneMat = toyMaterial(PALETTE.stone, {
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
  });

  // The interior is painted, not lit, and the reason is arithmetic. The one
  // light this prop is allowed sits 15cm from the back of the chamber, so on
  // any lit material the inside of the head is four hundred times brighter than
  // the ground outside and tone maps to flat white, taking the stone with it.
  // Turning the light down far enough to fix that leaves nothing on the ground.
  // So the interior carries its own falloff in its vertex colours, its own hue
  // in the material colour, and takes no light at all: the same trick as the
  // pumpkin's emissive plate, and it decouples what the windows look like from
  // what the lantern throws.
  const boxMat = new THREE.MeshBasicMaterial({
    map: tex ? tex.map : null,
    color: new THREE.Color(BOX_FLAME),
    vertexColors: true,
    toneMapped: true,
  });

  // The flame itself: a small teardrop, unlit, carrying its own gradient.
  //
  // Emissive on a lit material was the obvious way to build this and it came
  // out as a pale blob: one flat value over the whole tongue, clipped white at
  // any brightness that read as fire. A flame is not one value. It is dim and
  // sullen at the wick, white in the throat and orange at the tip, and that
  // gradient is most of what the eye recognises. So the shape carries it per
  // vertex and the material is unlit, which also keeps it out of the way of a
  // scene light that has no business shading a flame.
  const FLAME_H = 0.098;
  const FLAME_W = 0.021;
  const flameGeo = (() => {
    const seg = 18;
    const p = makeProfile();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const r = FLAME_W * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75);
      p.pts.push({ r: Math.max(1e-4, r), y: t * FLAME_H, tr: 0, ty: 1, t });
    }
    // Tangents from the samples, so the tip shades round instead of spiking.
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[Math.max(0, i - 1)];
      const b = p.pts[Math.min(p.pts.length - 1, i + 1)];
      const dr = b.r - a.r;
      const dy = b.y - a.y;
      const L = Math.hypot(dr, dy) || 1;
      p.pts[i].tr = dr / L;
      p.pts[i].ty = dy / L;
    }
    const target = { pos: [], nor: [], uv: [], idx: [] };
    emitLathe(target, p.pts, 20, FLAME_W);
    // Bright through the throat, falling away at both ends.
    const col = [];
    const radial = 21;
    for (const q of p.pts) {
      const t = q.t;
      const v = 0.30 + 1.15 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 1.3) * (1 - 0.45 * t);
      for (let i = 0; i < radial; i++) col.push(v, v, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(target.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(target.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(target.idx);
    g.computeBoundingSphere();
    return g;
  })();

  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PLATE_FLAME),
    vertexColors: true,
  });

  const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;

  const boxMesh = new THREE.Mesh(boxGeo, boxMat);
  boxMesh.castShadow = false;
  boxMesh.receiveShadow = false;

  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, HEAD.y0 + HEAD.t + 0.050, 0);
  flame.castShadow = false;
  flame.receiveShadow = false;

  // ONE PointLight, and it does not cast shadows. Six pumpkins already put six
  // point lights in this scene and every light is in every fragment shader's
  // loop; a spot with a shadow map, which is what would be needed to throw the
  // windows' shape across the ground, is not worth what it costs here. So the
  // shaped light is where it can be seen without one: on the arch walls, on the
  // lit interior behind them and on the flame showing through. What this light
  // does is the soft warm pool that a lantern lays around itself.
  // decay 1 rather than 2, and it is the only number in this file chosen
  // against physics. The wall of an opening is 20cm from the flame and the
  // ground it has to pool on is a metre away: under an inverse square that is
  // 25 to 1, so any intensity that lays a pool on the floor renders the inside
  // of every arch as flat white and takes the roll of its lip with it. At
  // decay 1 the same two distances are 5 to 1, the wall glows warm instead of
  // clipping, and the pool is still a pool. The cutoff then does the far end of
  // the job: the wash is gone by two metres rather than trailing across the
  // graveyard the way a 1/d falloff would on its own.
  const lamp = new THREE.PointLight(new THREE.Color(PALETTE.glow), 0, 2.4, 1);
  lamp.position.set(0, FLAME_Y, 0);
  lamp.castShadow = false;

  const group = new THREE.Group();
  const body = new THREE.Group();
  body.add(stoneMesh, boxMesh, flame, lamp);
  group.add(body);

  // A stone this heavy was set by hand and never stood quite true. Small enough
  // that the roof still reads level, and sunk a hair so the lean opens no gap.
  body.rotation.z = (rng() - 0.5) * 0.030;
  body.rotation.x = -0.008 - rng() * 0.014;
  body.position.y = -0.008;
  // Only a jitter, not a free spin: the four windows want to sit square to the
  // scene so at least one of them faces any given camera.
  body.rotation.y = (rng() - 0.5) * 0.10;

  group.scale.setScalar(scale);

  const lampHome = lamp.position.clone();
  const flameHome = flame.position.clone();
  const boxTint = new THREE.Color();
  const flameCol = new THREE.Color();

  return {
    group,
    update(time) {
      // The pumpkin's flame, and deliberately the same one: two lanterns in a
      // graveyard that flicker differently are two different fires.
      //
      // A candle is mostly steady and never still. The tremble is a pair of
      // carriers inside the 5 to 15Hz band a real flame flickers in, whose
      // PHASE is dragged about by slow noise. It is not summed value noise, and
      // that is the whole point: smoothstep noise has zero derivative at every
      // lattice node, so a channel at f Hz stands still f times a second and
      // the light visibly freezes. Frequency-modulated carriers never stall.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.034 * wobble(7.3, 0.6, 12.4) + 0.020 * wobble(12.9, 0.9, 55.1);

      // The slow breathing underneath. Summed noise is right for this one and
      // its stalls are a feature: a lull is what the slow channel is for, and
      // the tremble runs on through it.
      const wander = 0.048 * swing(0.79, 0) + 0.034 * swing(2.3, 17.5);

      // Gutter and flare. Only the top of a slow channel counts, so these are
      // separate things that happen rather than a rhythm, and squaring the ramp
      // keeps the deep part of each one brief while its onset and recovery stay
      // soft. The flare is set rarer: a flame droops far more often than it
      // draws itself up.
      const g = noise(t * 0.45 + 77.3);
      const gutter = g > 0.73 ? (g - 0.73) / 0.27 : 0;
      const dip = gutter * gutter * (0.40 + 0.28 * noise(t * 9.3 + 5.1));
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.80 ? (fl - 0.80) / 0.20 : 0;
      const flare = flareRamp * flareRamp * (0.11 + 0.07 * noise(t * 7.1 + 91.2));

      // A soft ceiling, not a clamp. Clamped at 1, every flare and a good many
      // ordinary peaks land flat on the maximum and sit there, which pins the
      // interior at its brightest and is the one state in which the arch walls
      // stop reading against it. This bends the top over instead, matching
      // value and slope at the knee, so a flare has a shape on it.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const to = (range) => range.min + (range.max - range.min) * level;
      lamp.intensity = to(LAMP);

      // A guttering flame reddens and a flaring one goes whiter, so the colour
      // rides the same value. Levered about the level's own mean rather than
      // taken off it straight: fed through raw, the mix would only ever travel
      // the top quarter of ember to flame, because that is where the level
      // lives.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      lamp.color.copy(EMBER).lerp(FLAME, hue);
      flameMat.color.copy(flameCol.copy(PLATE_EMBER).lerp(PLATE_FLAME, hue)).multiplyScalar(to(FLAME_EM));
      boxTint.copy(BOX_EMBER).lerp(BOX_FLAME, hue);
      boxMat.color.copy(boxTint).multiplyScalar(to(BOX));

      // The flame is an object and it moves. Brightening in place can only pump
      // the pool; moving the source slides the light across the inside of the
      // chamber and changes which side of every arch wall is lit, which is the
      // half of this that intensity cannot reach. Small: the chamber is 20cm
      // across and a flame that wanders 4cm is a flame in a draught.
      const across = 0.011 * (0.55 * swing(0.83, 5.5) + 0.45 * wobble(5.9, 0.5, 71.6));
      const into = 0.009 * swing(0.61, 2.7);
      const rise = 0.004 * swing(1.3, 8.1) + 0.016 * flare - 0.013 * dip;
      lamp.position.set(lampHome.x + across, lampHome.y + rise, lampHome.z + into);
      flame.position.set(flameHome.x + across * 0.8, flameHome.y + rise * 0.5, flameHome.z + into * 0.8);
      // A flame that stands up is taller as well as brighter.
      flame.scale.set(1 - 0.10 * (1 - level), 0.72 + 0.31 * level, 1 - 0.10 * (1 - level));
    },
    dispose() {
      stoneGeo.dispose();
      boxGeo.dispose();
      flameGeo.dispose();
      stoneMat.dispose();
      boxMat.dispose();
      flameMat.dispose();
      if (tex) {
        tex.map.dispose();
        tex.normalMap.dispose();
      }
      group.clear();
    },
  };
}

// Height, footprint and where the light sits, for a lab or a scene that wants
// to place this without measuring it.
export const POST_LANTERN = {
  height: TOTAL_H,
  footprint: FOOT.rBot * 2,
  eave: ROOF.eave.cr + ROOF.eave.rad,
  flameY: 0.845,
};
