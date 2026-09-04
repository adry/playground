import * as THREE from 'three';
import { PALETTE, SEGMENTS, toyMaterial, contactShadow } from './style.js';

// Carved headstones for the graveyard set.
//
// House style: a soft vinyl toy. Every silhouette here is built by sweeping a
// quarter-round profile around a convex outline, so the whole piece -- arch,
// sides, corners, the joint where the face meets the edge -- is one continuous
// rounded surface. Nothing is faceted or chipped.
//
// The inscription is drawn once per stone with the 2D canvas API -- there is no
// font file to feed TextGeometry -- and then used as both maps. The normal map,
// baked from a blurred copy of the same artwork, makes the mark read *lower*.
// The colour map carries what the normal map cannot hold once distance filters
// it away: a dark floor to the cut, a shaded wall under its top edge and a lit
// one along its bottom lip. Together they are what makes it a carving and not
// a print.

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

// The Batman silhouette, traced off .ref/ref-bat.png rather than invented.
// Two earlier passes were drawn from a description and both failed the only
// test that matters: shrunk to the sixty-odd pixels the mark actually occupies
// on a stone in the scene, they collapsed into a moustache. What survives at
// that size is a small number of large features, and the reference has exactly
// six per side: an ear, one long concave crescent along the top of the wing, a
// hooked tip, a slender outer blade ending in a point, one lobe hanging under
// the wing, and the body edge running down to the tail.
//
// Numbers come from a column scan of the reference: x is in half-spans and y is
// in the same units measured from the centre of the mark's bounding box, so the
// artwork is 2.0 by 0.866, the reference's 2.31:1. Y stays as a squash knob but
// wants to be 1: the proportions are already the reference's.
//
// Only the right half is authored, from the middle of the flat top of the head
// round to the point of the tail; the left half is the same segments walked
// backwards with x negated, which is the only way the two ears and the two
// wingtips are guaranteed to match. Each entry is one cubic: two control points
// then the end point.
const BAT_TOP = [0, -0.222]; // middle of the head's flat top, on the mirror line
const BAT_HALF = [
  // The ears are the one place this departs from the trace. The reference's are
  // needle thin, and at scene scale they are narrower than the blur that gives
  // the groove its walls, so they came out as a single nub with a crack in it.
  // Widened by a third at the base and lengthened a little; everything else is
  // the reference's own geometry.
  [0.013, -0.222, 0.027, -0.222, 0.040, -0.222], // flat top of the head
  [0.058, -0.270, 0.077, -0.317, 0.095, -0.365], // inner edge of the ear, dead straight
  [0.113, -0.286, 0.132, -0.207, 0.150, -0.128], // outer edge, down to the shoulder
  // The crescent. It leaves the shoulder level and climbs barely a twelfth of a
  // span over two thirds of its length, which is what makes the hook at the end
  // of it read as a hook.
  [0.240, -0.128, 0.380, -0.157, 0.459, -0.199],
  // The hook: out to its widest at x 0.53, then back inward and up to the tip.
  // The tip overhangs the curve below it, so this segment reverses in x.
  [0.560, -0.248, 0.532, -0.338, 0.478, -0.433],
  [0.608, -0.400, 0.700, -0.354, 0.800, -0.275], // outer edge of the blade
  [0.880, -0.215, 0.978, -0.060, 1.000, 0.054], // out to the wing's outer point
  [0.880, 0.030, 0.730, -0.020, 0.600, 0.077], // underside of the blade, nearly flat
  [0.578, 0.090, 0.546, 0.160, 0.535, 0.221], // plunge to the lobe's hanging point
  [0.480, 0.188, 0.410, 0.172, 0.360, 0.172], // up over the notch between lobe and body
  [0.290, 0.172, 0.210, 0.203, 0.150, 0.248], // and away down the side of the body
  [0.100, 0.286, 0.045, 0.367, 0.000, 0.432], // to the tail point at bottom centre
];

function inkBat(ctx, cx, cy, halfSpan, Y = 1) {
  const px = (x) => cx + x * halfSpan;
  const py = (y) => cy + y * halfSpan * Y;
  ctx.beginPath();
  ctx.moveTo(px(BAT_TOP[0]), py(BAT_TOP[1]));
  for (const s of BAT_HALF) ctx.bezierCurveTo(px(s[0]), py(s[1]), px(s[2]), py(s[3]), px(s[4]), py(s[5]));
  // Back up the left side: same segments in reverse, control points swapped so
  // the curve is traversed the other way, and every x mirrored.
  for (let i = BAT_HALF.length - 1; i >= 0; i--) {
    const s = BAT_HALF[i];
    const prev = i > 0 ? BAT_HALF[i - 1] : null;
    const ex = prev ? prev[4] : BAT_TOP[0];
    const ey = prev ? prev[5] : BAT_TOP[1];
    ctx.bezierCurveTo(px(-s[2]), py(s[3]), px(-s[0]), py(s[1]), px(-ex), py(ey));
  }
  ctx.closePath();
  ctx.fill();
}

// Marks for one variant, opaque black on a transparent canvas. Transparent
// rather than white-backed because every consumer wants a mask: multiplied over
// a colour or a height, a transparent pixel leaves the destination alone, and
// destination-out against a shifted copy of the same canvas gives the groove's
// upper and lower lips for free.
function drawInscription(variant, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';

  if (variant === 'fred') {
    // Three lines centred on the middle of the face, a shade above it. Font
    // metrics are not involved: inkText centres each line on its own ink, so
    // the block's centre really is the middle line's centre.
    const lines = ['HERE', 'LIES', 'FRED'];
    const size = h * 0.15;
    lines.forEach((line, i) => inkText(ctx, line, w / 2, h * (0.485 + (i - 1) * 0.175), size, size * 0.05));
  } else if (variant === 'bat') {
    // No lettering under the bat. The reference stone carries the mark alone,
    // and an R.I.P. below it only crowded a symbol that wants the whole face.
    // Span is 0.80 of the face: the outer eighth of the half-width is the slab's
    // rounded edge, and wingtips that reach it get bent round the corner. cy is
    // the centre of the mark's own bounding box, so it sits square on the face
    // instead of hanging off whatever its tallest feature happens to be.
    inkBat(ctx, w / 2, h * 0.46, w * 0.40);
  } else {
    inkCross(ctx, w / 2, h * 0.28, h * 0.22);
    inkText(ctx, 'R.I.P.', w / 2, h * 0.55, h * 0.135, h * 0.011);
  }
  return c;
}

// The band of the mark that lies just inside one of its edges, as an opaque
// mask: the mark, minus a copy of itself shifted off that edge. Used to paint
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
  // The lit lip has to be drawn in white to survive a screen blend, so the
  // mask keeps its alpha and swaps its colour.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
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
  // Halved from 0.13 because the normal strength below doubled: this mottling
  // is meant to be a slow swell across the face, and at the new strength the
  // old amplitude turned the stone into hammered metal.
  mottle(hc, w, FH, mulberry32(1), '96,96,96', '176,176,176', 0.065, false);

  const marks = drawInscription(variant, FW, FH);

  // --- the groove -----------------------------------------------------------
  //
  // What was here before was a normal map off a 4px blur plus a 40% dark fill,
  // and it read as printed rather than cut. Two reasons. The wall was about
  // eight texture pixels wide, and this face is a thousand pixels mapped onto
  // maybe a hundred and fifty on screen, so the whole wall landed inside one
  // pixel and mipped away to nothing. And a groove that is uniformly dark has
  // no interior: real carving is dark under its top edge and bright along its
  // bottom lip, because that lip is the one surface in the cut that faces the
  // sky.
  //
  // So the wall is now ~11px of blur, wide enough to survive at scene scale,
  // and the two lips are painted into the colour map as well. That second part
  // is what holds up when distance filters the normal map away.
  const WALL = Math.max(6, Math.round(FH * 0.011));
  const LIP = Math.max(3, Math.round(FH * 0.006));
  const topLip = lipMask(marks, 0, LIP, '#000000'); // inside the mark's upper edge
  const bottomLip = lipMask(marks, 0, -LIP, '#ffffff'); // inside its lower edge

  const stamp = (ctx, img, alpha, op = 'multiply', blur = 0) => {
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(img, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // A wide, weak smudge first: the ambient light that never reaches into a cut,
  // spilling a little past its edges the way a real occlusion does.
  stamp(cc, marks, 0.16, 'multiply', WALL * 1.6);
  // Then the body of the recess. The lips carry the shape, so this only has to
  // be dark enough to read as shadow: pushed harder it goes to ink, and the
  // reference's carving is grey stone in shade, not a printed letter.
  stamp(cc, marks, 0.36);
  // Shaded upper-inner wall, and the catch-light on the lower one.
  stamp(cc, topLip, 0.4, 'multiply', 1.5);
  stamp(cc, bottomLip, 0.42, 'screen', 1.5);

  // Height: dark is low. Blurred once for a wall that ramps rather than steps,
  // then a second, tighter pass so thin strokes still reach the bottom of the
  // cut instead of being rounded off into a scratch by the blur alone.
  stamp(hc, marks, 1, 'multiply', WALL);
  stamp(hc, marks, 1, 'multiply', Math.round(WALL * 0.35));

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, normalMap: heightToNormalMap(height, 14), frontFrac: FW / w, stripFrac: STRIP / w };
}

// ---------------------------------------------------------------------------

// Sized against the ghost as it actually measures on screen, which is about
// 1.78 -- hoverHeight 1.34 plus headRadius 0.42 -- and not against the 1.6 in
// SCENE_SCALE, which is a rounder number for the body alone. The two big stones
// come up to a bit over four fifths of that and the short one to about two
// thirds of them. The previous set topped out at 1.04 and read as a row of
// markers on a lawn rather than headstones somebody stands among.
//
// Width is held near two thirds of height for the tall pair, which is what the
// reference measures, and nearer three quarters for the squat ones. These are
// chunky slabs -- an earlier attempt at taller-and-no-wider gave thin flagstones
// that the arch made look like doors.
const SHAPES = {
  cross: { halfWidth: 0.46, height: 1.37, depth: 0.30, plinth: 0.19 }, // 1.56, 82% of the ghost
  bat: { halfWidth: 0.50, height: 1.33, depth: 0.32, plinth: 0.19 }, // 1.52, wide enough for the wings
  fred: { halfWidth: 0.37, height: 0.95, depth: 0.25, plinth: 0.15 }, // 1.10, still clearly the little one
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
  // The rounded edge is a fixed radius, not a fraction of the stone, so it grew
  // with the slab: at 0.05 on a slab half again as wide the corner rounding had
  // become a hairline and the piece stopped reading as vinyl.
  const edge = 0.062;

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
    bottomRadius: 0.09,
    topRadius: W, // arch: a true half-round, tangent to the sides
    uv: slabUV,
  });
  const slab = new THREE.Mesh(slabGeo, material);
  slab.position.y = plinthH;

  // Reference plinths overhang by about a sixth of the stone's half-width and
  // are properly deep -- they are the part that says the stone was set, not
  // pushed into the ground.
  const pW = W + 0.075;
  const pD = shape.depth + 0.13;
  const plinthGeo = buildSlabGeometry({
    halfWidth: pW,
    height: plinthH,
    depth: pD,
    edge: 0.05,
    bottomRadius: 0.056,
    topRadius: 0.056,
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

  // --- ground contact -------------------------------------------------------
  //
  // The plinth footprint is two and a half times wider than it is deep, and a
  // single stretched patch under it is an ellipse: it pulls away from the long
  // sides and leaves clean floor at all four corners, which is exactly where
  // the eye checks whether a thing is standing on the ground. Worse, one patch
  // has to choose between hugging the base and spreading far enough to give the
  // stone any weight.
  //
  // So it is built in two layers. A row of round patches, each about as wide as
  // the plinth is deep, paves the footprint: overlapped, their union is a
  // stadium, which is as close to a rectangle as a radial gradient gets. Under
  // them, one broad very soft patch is the ambient pool the stone sits in.
  const contacts = [];
  const patch = (hx, hz, x, opacity, softness) => {
    const c = contactShadow({ radius: 0.5, opacity, softness });
    // The plane is laid flat by a -90 degree turn about X, so its local y is
    // the world depth axis.
    c.scale.set(hx / 0.5, hz / 0.5, 1);
    c.position.x = x;
    group.add(c);
    contacts.push(c);
  };

  // Core. contactShadow's gradient is opaque out to (1 - softness) of the
  // patch's half-extent and fades over the rest, so dividing by (1 - softness)
  // is what puts the end of the opaque part where you want it: here, a
  // centimetre or so past the plinth, so the floor is still fully dark at the
  // joint and only starts to lift beyond it. Sized the other way round -- patch
  // barely bigger than the plinth -- the fade begins underneath the stone and
  // the joint goes bright again, which is the gap this is here to close.
  const soft = 0.5;
  const reach = 0.06; // how far past the plinth the opaque part of the patch runs
  const core = (pD / 2 + reach) / (1 - soft);
  const span = pW - pD / 2; // outer centres, so their opaque discs reach the corners
  for (const t of [-1, 0, 1]) patch(core, core, t * span, 0.68, soft);
  // Pool: soft and wide, the ambient dish the stone sits in. Low opacity
  // because it stacks on top of the three above.
  patch(pW + 0.5, pD / 2 + 0.44, 0, 0.26, 0.9);

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
      for (const c of contacts) c.userData.dispose();
    },
  };
}
