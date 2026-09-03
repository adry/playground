import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial } from './style.js';

// Carved headstones for the graveyard set.
//
// House style: a soft vinyl toy. Every silhouette here is built by sweeping a
// quarter-round profile around a convex outline, so the whole piece -- arch,
// sides, corners, the joint where the face meets the edge -- is one continuous
// rounded surface. Nothing is faceted or chipped.
//
// The inscription is drawn once per stone with the 2D canvas API -- there is no
// font file to feed TextGeometry -- and used twice: as a colour map, where the
// letters read darker, and as a normal map baked from the same artwork, where
// they read *lower*. The second one is what makes it a carving and not a print.

export const VARIANTS = ['cross', 'bat', 'fred'];

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
// geometry

// One rounded slab: a convex outline (rounded rectangle, optionally with a
// half-round arch for a top) swept front-to-back through a quarter-round edge.
//
// The trick that keeps this smooth is that the outline is the Minkowski sum of
// four fixed corner circles, so "inset by d" is just "same corner centres,
// radii minus d". Every ring of the sweep is therefore the same outline shape
// with smaller corner radii, and the normal at every vertex is known
// analytically -- no computeVertexNormals, no faceting, no seams.
function buildSlabGeometry({ halfWidth: W, height: H, depth: D, edge: e, bottomRadius: rb, topRadius: rt, uv }) {
  const hz = D / 2;
  const segSmall = Math.max(5, Math.round(SEGMENTS.curve * 0.35));
  // The arch is the piece the eye reads as "round", so it gets the full budget.
  const segTop = Math.max(5, Math.round(SEGMENTS.curve * Math.min(1, rt / W)));

  // Counter-clockwise from the bottom-right corner. Straight edges fall out for
  // free between consecutive arcs, and because an arc ends tangent to the
  // straight run its endpoint normal is already the flat edge's normal.
  const corners = [
    { cx: W - rb, cy: rb, r: rb, a0: -Math.PI / 2, a1: 0, seg: segSmall },
    { cx: W - rt, cy: H - rt, r: rt, a0: 0, a1: Math.PI / 2, seg: segTop },
    { cx: -(W - rt), cy: H - rt, r: rt, a0: Math.PI / 2, a1: Math.PI, seg: segTop },
    { cx: -(W - rb), cy: rb, r: rb, a0: Math.PI, a1: Math.PI * 1.5, seg: segSmall },
  ];
  const N = corners.reduce((n, c) => n + c.seg + 1, 0);

  // The sweep profile in (inset, z). A quarter circle of radius e out to the
  // silhouette, a straight side wall, then the mirror of it round the back.
  // Half the curve budget across a 90-degree turn. A quarter of it left visible
  // banding on the highlight running down the side edge.
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: e * (1 - Math.sin(a)), z: hz - e + e * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  // Duplicated silhouette ring: the front half carries the inscription's UVs,
  // the sides must not, so the texture seam is hidden on the widest edge.
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

  for (const p of profile) {
    for (const c of corners) {
      const r = c.r - p.inset;
      for (let j = 0; j <= c.seg; j++) {
        const a = c.a0 + (c.a1 - c.a0) * (j / c.seg);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        push(c.cx + r * ca, c.cy + r * sa, p.z, ca * p.ns, sa * p.ns, p.nz, p.front);
      }
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

  // Flat front and back faces, fanned from a centre point. The outline is
  // convex, so a fan is a valid triangulation.
  const cFront = pos.length / 3;
  push(0, H / 2, hz, 0, 0, 1, true);
  const cBack = pos.length / 3;
  push(0, H / 2, -hz, 0, 0, -1, false);
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
// inscription artwork

const SERIF = '"Liberation Serif", "Times New Roman", Georgia, serif';

// Optically centred text: font metrics put the alphabetic baseline low and the
// em box high, so centring on the glyphs' own ink is the only way three lines
// come out evenly spaced.
function inkText(ctx, text, cx, cy, size, spacing) {
  ctx.font = `bold ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  const m = ctx.measureText(text);
  ctx.fillText(text, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function inkCross(ctx, cx, cy, h) {
  const bar = h * 0.20;
  const arm = h * 0.34;
  const r = bar * 0.34; // even the engraved marks get rounded ends
  ctx.beginPath();
  ctx.roundRect(cx - bar / 2, cy - h / 2, bar, h, r);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - arm, cy - h * 0.5 + h * 0.26 - bar / 2, arm * 2, bar, r);
  ctx.fill();
}

function inkBat(ctx, cx, cy, s) {
  // Body, head and ears first, then a wing on each side. Each piece is filled
  // separately so overlapping subpaths union instead of cancelling.
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.02 * s, 0.10 * s, 0.21 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 0.20 * s, 0.105 * s, 0.095 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 0.02 * s, cy - 0.24 * s);
    ctx.quadraticCurveTo(cx + dir * 0.11 * s, cy - 0.42 * s, cx + dir * 0.13 * s, cy - 0.23 * s);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + dir * 0.08 * s, cy - 0.15 * s);
    // leading edge, shoulder out to the tip
    ctx.bezierCurveTo(cx + dir * 0.40 * s, cy - 0.52 * s, cx + dir * 0.76 * s, cy - 0.50 * s, cx + dir * 1.0 * s, cy - 0.36 * s);
    // trailing edge: membranes sagging between three finger tips, which is what
    // separates a bat from a moth at this size
    ctx.quadraticCurveTo(cx + dir * 0.86 * s, cy + 0.02 * s, cx + dir * 0.66 * s, cy - 0.10 * s);
    ctx.quadraticCurveTo(cx + dir * 0.56 * s, cy + 0.20 * s, cx + dir * 0.38 * s, cy + 0.01 * s);
    ctx.quadraticCurveTo(cx + dir * 0.30 * s, cy + 0.26 * s, cx + dir * 0.08 * s, cy + 0.14 * s);
    ctx.closePath();
    ctx.fill();
  }
}

// Marks for one variant, drawn black on white into its own canvas. Black on
// white so it can simply be multiplied into both the colour and the height map
// at different strengths.
function drawInscription(variant, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';

  if (variant === 'fred') {
    const lines = ['HERE', 'LIES', 'FRED'];
    const size = h * 0.14;
    lines.forEach((line, i) => inkText(ctx, line, w / 2, h * (0.465 + i * 0.175), size, size * 0.05));
  } else {
    if (variant === 'bat') inkBat(ctx, w / 2, h * 0.26, w * 0.35);
    else inkCross(ctx, w / 2, h * 0.27, h * 0.30);
    inkText(ctx, 'R.I.P.', w / 2, h * 0.63, h * 0.145, h * 0.012);
  }
  return c;
}

// Faint mottling so the grey reads as stone rather than moulded plastic. Kept
// low contrast on purpose: this is a toy headstone, not a granite scan.
// The speckle pass is colour-only -- on the height map its high frequencies
// would come back through the normals as sandpaper.
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

// Turn the height canvas into a tangent-space normal map.
//
// A bumpMap would be cheaper, but its relief is driven by screen-space
// derivatives, so the carving would soften as the camera pulls back. Slopes
// baked here hold up at any distance, and the strength is a number rather than
// a happy accident of texture resolution.
function heightToNormalMap(canvas, strength) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => src[((y < 0 ? 0 : y > h - 1 ? h - 1 : y) * w + (x < 0 ? 0 : x > w - 1 ? w - 1 : x)) * 4] / 255;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Written bottom row first: DataTexture ignores flipY, so the flip that the
    // CanvasTexture colour map gets for free has to happen here by hand.
    const row = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const gx = at(x + 2, y) - at(x - 2, y);
      const gy = at(x, y + 2) - at(x, y - 2);
      // v runs up the stone while canvas y runs down, hence the sign on gy.
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

// Fraction of the texture's height that the plinth is mapped into, measured up
// from the bottom -- i.e. how far into the grime band it sits.
const GRIME = 0.2;

// Colour map + height map for one stone. The face artwork occupies a region of
// exact face aspect on the left; the narrow strip on the right is plain stone
// that the sides and back sample, so nothing wraps around the corner.
function buildTextures(variant, faceAspect, rng) {
  const FH = 1024;
  const FW = Math.round(FH * faceAspect);
  const STRIP = 160;
  const w = FW + STRIP;

  const colour = document.createElement('canvas');
  colour.width = w;
  colour.height = FH;
  const cc = colour.getContext('2d');
  // White base: the palette colour lives on the material, the map only carries
  // detail, so PALETTE.stone stays the single source of truth for the hue.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, FH);
  mottle(cc, w, FH, rng, '120,116,110', '255,255,255', 0.085);

  // A wash of ground grime along the bottom edge. It also does a second job:
  // the plinth samples nothing but this band, which stops an up-facing slab of
  // clean stone from reading as a whiter material than the headstone above it.
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
  mottle(hc, w, FH, mulberry32(1), '96,96,96', '176,176,176', 0.13, false);

  const marks = drawInscription(variant, FW, FH);
  // 0.4 of black through multiply lands the letters on PALETTE.stoneEngrave,
  // and lets the mottling show through the groove instead of flat-filling it.
  cc.globalCompositeOperation = 'multiply';
  cc.globalAlpha = 0.4;
  cc.drawImage(marks, 0, 0);
  cc.globalAlpha = 1;
  cc.globalCompositeOperation = 'source-over';

  // Blurred so the groove has walls that ramp instead of a printed-on step --
  // dark is low, which is what makes the light read the letters as cut in.
  hc.globalCompositeOperation = 'multiply';
  hc.filter = 'blur(4px)';
  hc.drawImage(marks, 0, 0);
  hc.filter = 'none';
  hc.globalCompositeOperation = 'source-over';

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, normalMap: heightToNormalMap(height, 7), frontFrac: FW / w, stripFrac: STRIP / w };
}

// ---------------------------------------------------------------------------

const SHAPES = {
  cross: { halfWidth: 0.31, height: 0.88, depth: 0.19, plinth: 0.11 },
  bat: { halfWidth: 0.33, height: 0.92, depth: 0.20, plinth: 0.12 },
  fred: { halfWidth: 0.25, height: 0.64, depth: 0.17, plinth: 0.09 },
};

export function createTombstone({ variant = 'cross', seed = 1, scale = 1 } = {}) {
  const shape = SHAPES[variant] || SHAPES.cross;
  const rng = mulberry32(seed * 2654435761 + 17);

  const group = new THREE.Group();
  // Inner group carries the seeded lean, so the caller still owns position and
  // rotation.y on the outer one.
  const body = new THREE.Group();
  group.add(body);

  const W = shape.halfWidth;
  const H = shape.height;
  const plinthH = shape.plinth;
  const edge = 0.05;

  const hasDOM = typeof document !== 'undefined';
  const tex = hasDOM ? buildTextures(variant, (2 * W) / H, rng) : null;
  const frontFrac = tex ? tex.frontFrac : 1;
  const stripFrac = tex ? tex.stripFrac : 0;

  // Planar UVs over the front face; everything else is parked in the plain
  // strip, inset from its edges so filtering can never drag a letter onto a
  // side wall.
  const stripUV = (x, y, halfW, h, vSpan = 1) => [
    frontFrac + stripFrac * (0.15 + 0.7 * ((x + halfW) / (2 * halfW))),
    Math.min(1, Math.max(0, y / h)) * vSpan,
  ];
  const slabUV = (x, y, front) =>
    front ? [(((x + W) / (2 * W)) * frontFrac), y / H] : stripUV(x, y, W, H);

  const material = toyMaterial(PALETTE.stone, {
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
  });

  const slabGeo = buildSlabGeometry({
    halfWidth: W,
    height: H,
    depth: shape.depth,
    edge,
    bottomRadius: 0.075,
    topRadius: W, // arch: a true half-round, tangent to the sides
    uv: slabUV,
  });
  const slab = new THREE.Mesh(slabGeo, material);
  slab.position.y = plinthH;

  const pW = W + 0.075;
  const pD = shape.depth + 0.10;
  const plinthGeo = buildSlabGeometry({
    halfWidth: pW,
    height: plinthH,
    depth: pD,
    edge: 0.042,
    bottomRadius: 0.048,
    topRadius: 0.048,
    uv: (x, y) => stripUV(x, y, pW, plinthH, GRIME),
  });
  const plinth = new THREE.Mesh(plinthGeo, material);

  for (const m of [slab, plinth]) {
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
  }

  // A hand-placed stone never stands perfectly true. Small enough that the
  // silhouette still reads upright; sunk a hair so no gap opens under the lean.
  body.rotation.z = (rng() - 0.5) * 0.045;
  body.rotation.x = -0.012 - rng() * 0.02;
  body.position.y = -0.012;
  group.scale.setScalar(scale);

  return {
    group,
    update() {}, // static prop
    dispose() {
      slabGeo.dispose();
      plinthGeo.dispose();
      material.dispose();
      if (tex) {
        tex.map.dispose();
        tex.normalMap.dispose();
      }
    },
  };
}
