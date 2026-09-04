import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS, toyMaterial, contactShadow } from '../style.js';

// A GATE PILLAR LANTERN: a stubby square stone pillar with a glazed iron
// lantern box bolted on top. The pair of these that stand either side of a
// cemetery entrance.
//
// It is the one prop in the lantern set that pairs two materials, and almost
// everything below is about the two places that pairing can fail: the joint
// where the metal meets the stone, and the glass, which in a scene with no
// environment map has nothing to reflect and defaults to a tinted rectangle.
//
// -----------------------------------------------------------------------------
// WHAT IT IS MEASURED AGAINST
//
// It stands at a gate, so the fence decides its size and not the ghost. From
// fence/metrics.js: a run post is 0.86 tall and 0.155 square, and gate.js takes
// that to 0.92 and 0.186 for the two posts the gate hangs between. A gate
// PILLAR has to beat both at a glance, and it has to beat them on girth more
// than on height: a thin thing 1.5 tall beside a 0.86 post reads as a lamp
// standard, not as masonry.
//
//   stone height      0.940     (fence post 0.86, gate post 0.92)
//   footprint         0.36      (fence post 0.155, gate post 0.186)
//   overall height    1.495     with the lantern, cap and finial on top
//
// So it is 9% taller than the gate post in stone and 1.94 times its section.
// The 0.36 footprint is deliberately most of a grid cell: a gate pillar is the
// one piece of a fence run that is allowed to be furniture.
//
// -----------------------------------------------------------------------------
// THE CORNER RADII, WHICH ARE DOING ALL THE WORK
//
// Two squares, one stacked on the other, is the shape the house style fights
// hardest. Every cross section here is a superellipse, the same primitive
// fence/wood.js uses for a board, parameterised the same way: `p` is the
// exponent, ring points are x = sign(cos a) |cos a|^p, and the ring closes as
// |x|^(2/p) + |z|^(2/p) = 1. p = 0 is a square, p = 1 is a circle.
//
// What p means as a radius: a superellipse pulls its diagonal in by
// sqrt(2)(1 - 2^(-p/2)) of the half-width, and a true circular fillet of radius
// rho pulls it in by 0.414 rho, so rho/halfWidth is about 1.1 p. Measured off
// renders rather than trusted: the numbers below are the ones the range was
// found at, in millimetres on the real 0.30 shaft.
//
//   p = 0.14   rho ~ 23mm   CAD. Reads as a chamfer on a hard edge, and the
//              specular runs as a hard line down the arris.
//   p = 0.22   rho ~ 36mm   still crisp, right for pressed metal
//   p = 0.34   rho ~ 56mm   the stone. Square in silhouette, soft in the
//              highlight, which is exactly the fence post's own 0.34.
//   p = 0.48   rho ~ 79mm   the top of the range. Still square from the front,
//              visibly barrel-y on the diagonal.
//   p = 0.62   rho ~ 102mm  gone. From the diorama's 45-degree camera the shaft
//              is a cylinder with a flat spot.
//
// So the usable window is p = 0.20 to 0.50 and the piece sits at 0.34 for the
// stone and 0.22 for the metal. That split is itself the point: stone is
// weathered and metal is folded, and giving them the same radius made the
// lantern look like it had been cast in one lump with the pillar.
const P_STONE = 0.34;
const P_METAL = 0.22;

// -----------------------------------------------------------------------------
// dimensions

const STONE_H = 0.940;
const PLINTH_H = 0.105;
const PLINTH_R = 0.180;      // half-extent, so the footprint is 0.36
const SHAFT_R0 = 0.150;      // at the top of the plinth
const SHAFT_R1 = 0.1405;     // at the springing of the cornice, a 6% batter
const CORNICE_Y = 0.845;
const CORNICE_R = 0.174;
const TOP_FILLET = 0.026;    // the ovolo on the cornice's top rim
const BOT_FILLET = 0.020;

// The flat the metal lands on, after the top rim has been rounded away.
const CAP_FLAT = CORNICE_R - TOP_FILLET;   // 0.148

// --- the joint ---------------------------------------------------------------
// A metal box set down on a stone pillar looks like two models intersecting
// unless four things happen at once, and all four are here:
//
//   1. the stone reaches UP. The cornice flares from 0.1405 back out to 0.174
//      over the last 95mm, so the masonry is coming to meet the lantern rather
//      than being sawn off under it.
//   2. the metal reaches DOWN AND OUT. The flange is a stepped plate, wide at
//      the bottom and narrowing to the collar the box stands on, so the two
//      flares mirror each other across the seam.
//   3. there is a MARGIN. The flange's 0.126 half sits inside the stone's 0.148
//      flat, leaving a 22mm ring of bare stone all the way round. Matching the
//      two edges was tried first and is the version that looks glued: two
//      coincident silhouettes read as one object badly modelled, where a
//      deliberate step reads as one thing set on another.
//   4. it is BEDDED and BOLTED. The flange sinks 4mm below the stone's top
//      plane, which turns what would be a hairline of daylight (and, at some
//      camera angles, z-fighting) into a dark mortar seam; and four domed bolt
//      heads sit on the plate, one per face, saying the joint is fastened.
const FLANGE_BED = 0.004;    // how far the plate is let into the stone
const FLANGE_R = 0.126;
const FLANGE_H = 0.020;
const COLLAR_R = 0.100;
const COLLAR_H = 0.040;
const BOLT_AT = 0.100;       // mid-face radius of the four bolt heads
const BOLT_R = 0.013;

const BOX_Y = STONE_H - FLANGE_BED + FLANGE_H + COLLAR_H;   // 0.996
const BOX_R = 0.112;         // half-extent over the frame
const BOX_H = 0.315;
const BAR = 0.026;           // corner upright section, and the rail depth
const RAIL_H = 0.028;        // the horizontal band top and bottom
const PANE_Z = 0.102;        // glass sits inboard of the frame's outer face
const PANE_HW = 0.086;       // half width, between the two uprights
const PANE_BOW = 0.013;      // outward crown on the pane: see the glass note

const CAP_Y = BOX_Y + BOX_H;
const CAP_R = 0.141;         // the eave, overhanging the box by 29mm
const CAP_H = 0.132;
const FINIAL_NECK = 0.022;
const FINIAL_R = 0.031;

const TOTAL_H = CAP_Y + CAP_H + FINIAL_NECK + 2 * FINIAL_R;   // 1.495

// -----------------------------------------------------------------------------
// materials

const IRON = '#4a4640';
// Metalness stays at zero on purpose. There is no environment map in this
// scene, and a MeshStandardMaterial with metalness above zero trades its
// diffuse (which the hemisphere light feeds) for a specular that only the two
// directional lights can feed, so the ironwork went nearly black on its shaded
// side the moment it was made metallic. A mid grey at low roughness catches a
// broad highlight off the key and reads as painted iron, which is what a
// cemetery lantern is anyway.
const IRON_ROUGH = 0.46;

// Old cylinder-drawn glazing: a DARK cool green, and dark is the whole point.
// The first pass used a pale tint, the colour a sheet of glass looks in the
// hand, and every pane came out as milk. A MeshStandardMaterial's diffuse does
// not know it is glass: give it a pale colour and the hemisphere light lifts it
// to 0.8 luminance, so a pane at even a tenth of an alpha lays a white veil
// over the lantern's inside and nothing behind it can be seen. Glass has almost
// no diffuse at all: what you see is the reflection on it, the light through
// it, and the dark of whatever is behind it. So the body is nearly black with a
// green in it, and the reflection, the edge and the flame carry everything.
const GLASS_TINT = '#33443f';

// The flame's two ends, taken from pumpkin.js so the two fires in this scene
// are the same fire. The point light's colour is converted by hand because it
// is a light; the emissive pair is handed to three, which colour-manages it.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
const WICK_EMBER = new THREE.Color('#ff7b2c');
const WICK_FLAME = new THREE.Color('#ffc98a');

// -----------------------------------------------------------------------------
// the fake optics
//
// Lifted, with its reasoning, from fountain/water.js. This scene has no
// environment map and cannot be given one without lighting the glass out of
// register with the stone beside it, so the reflection is three sky bands and a
// smoothstep sampled off the reflected normal, a Schlick fresnel deciding how
// much of it you see, and one tight Blinn lobe for the key.
//
// Glass needs it more than water did, and it needs one thing water did not.
// Water is never flat: its normal is churning, so the sky band it samples
// changes across every square centimetre and the reflection has structure for
// free. A flat pane's normal is CONSTANT, so skyProbe returns one colour over
// the whole pane and the fresnel returns one number, and what you get is a
// rectangle of flat grey: exactly the failure the brief warned about. Three
// things fix that here, and the pane only reads as glass with all three:
//
//   a. the pane is BOWED, 8mm of crown over its 154mm, the way hand-drawn
//      glazing sags. That sweeps the surface normal about 9 degrees each way,
//      so the REFLECTED direction sweeps 18 degrees, and the sky gradient
//      becomes a visible vertical wipe across the pane instead of a fill. It
//      also puts the fresnel on a ramp: the middle of the pane is nearly clear
//      and its edges climb toward grazing.
//   b. WAVINESS. Two sine bands in pane-local coordinates tilt the normal by a
//      couple of degrees more, in soft vertical streaks. This is the cue that
//      says old glass rather than acrylic, and it costs two sines.
//   c. the EDGE. A thin bright line where the pane meets the frame, which is
//      the glass's own cut edge picking up light through its thickness. At toy
//      scale it is the single most legible glass cue there is: it draws four
//      bright borders that no opaque panel would have.
//
// And the lantern's own flame is behind all of it, so each pane also carries a
// transmitted warm glow that rides the flicker. That term is what stops the
// glass going dead when the sky reflection happens to fall dark.
const GLASS_OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uGlare;
uniform vec2 uGlareAt;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uGlowCol;
uniform float uGlow;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
uniform float uWave;
uniform float uSeed;
varying vec2 vPane;
varying vec3 vGlassP;
varying float vYaw;

vec3 viewToWorld(vec3 v) {
  return vec3(dot(v, viewMatrix[0].xyz), dot(v, viewMatrix[1].xyz), dot(v, viewMatrix[2].xyz));
}

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands, and the middle one is the scene's own backdrop. A pane standing
// vertical reflects almost horizontally, so nearly everything it finds is the
// horizon: get that band wrong and every pane in the set has a dark outline.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.55, -0.02, r.y));
  c = mix(c, uSkyHi, smoothstep(0.02, 0.62, r.y));
  // A NARROW BRIGHT BAND in the reflection, and it is the single thing that
  // makes these panes read as glass at all. Everything above is a gradient, and
  // a gradient over a pane is still a fill: it has no shape, so nothing in it
  // says surface. What says surface is a HIGHLIGHT, a small bright thing whose
  // position depends on the normal, because the eye reads its curve as the
  // curve of the glass.
  //
  // The key light cannot supply one. A pane here is vertical, the key is 55
  // degrees up, and the half vector between the key and this camera sits 46
  // degrees above horizontal: no vertical surface in the scene can ever satisfy
  // it, so a Blinn lobe on these panes returns zero at every angle the diorama
  // is shot from. Checked before building this, not after.
  //
  // So the band is put in the environment instead, at a fixed elevation, and
  // the pane's 13mm crown sweeps its reflected ray across it. What comes out is
  // a bright streak that bows the way the glass bows and pinches out at the two
  // vertical edges where the crown flattens, which is what a cylinder-drawn
  // pane looks like and what no amount of fresnel gain was buying.
  return c + uGlare * exp(-pow((r.y - uGlareAt.x) / uGlareAt.y, 2.0));
}

// Schlick with glass's F0, 0.04. Flat on at this camera's elevation that is
// four per cent and nothing else, which is why the bow and the edge below are
// carrying the effect rather than the fresnel on its own.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}

float sunGlint(vec3 wN, vec3 wV, float sharp) {
  vec3 h = normalize(wV + uSunDir);
  return pow(max(dot(wN, h), 0.0), sharp);
}
`;

const GLASS_FRAG = `
  vec3 wN = normalize(viewToWorld(normal));
  vec3 wV = worldViewDir(vGlassP);
  // The panes are double sided so the far side of the box is visible through
  // the near one. Turn the shading normal to face the camera whichever surface
  // this fragment is.
  float back = gl_FrontFacing ? 0.0 : 1.0;
  if (dot(wN, wV) < 0.0) wN = -wN;

  // Waviness, in the pane's own frame. The pane is a plane rotated about Y, so
  // its tangent frame is one cosine and one sine and needs no attribute beyond
  // the yaw it was built at.
  vec3 tX = vec3(cos(vYaw), 0.0, -sin(vYaw));
  vec3 tY = vec3(0.0, 1.0, 0.0);
  // Broad and slightly skewed, not fine: at the first frequencies tried the
  // ripple met the glare band edge-on and cut it into a sunburst of hard rays,
  // which reads as brushed metal. Rolled glass waves over centimetres.
  float w1 = sin(vPane.y * 5.4 + vPane.x * 1.4 + uSeed);
  float w2 = sin(vPane.y * 11.1 - vPane.x * 2.2 + uSeed * 1.7);
  wN = normalize(wN + tX * (uWave * (0.55 * w1 + 0.45 * w2)) + tY * (uWave * 0.35 * w2));

  float ndv = clamp(dot(wN, wV), 0.0, 1.0);

  // The cut edge of the pane, where the frame grips it. Bright, thin, and
  // brighter on the two vertical edges than the horizontal ones because that is
  // where the glass's thickness is turned toward the light.
  float ex = smoothstep(0.78, 1.0, abs(vPane.x));
  float ey = smoothstep(0.82, 1.0, abs(vPane.y));
  float edge = clamp(ex + 0.65 * ey, 0.0, 1.0);

  float F = clamp(fresnelGlass(ndv) * uRimGain + edge * 0.55, 0.0, 1.0);
  // A back-facing pane is seen through the front one and through the lantern's
  // own interior, so it must not mirror the sky at full strength or the box
  // fills up with grey.
  F *= mix(1.0, 0.30, back);

  // The cut edge conducts a little of the flame out sideways as well as
  // catching the sky, so it is warmed rather than left the colour of the day.
  vec3 refl = skyProbe(reflect(-wV, wN))
    + uSunCol * (uGlint * sunGlint(wN, wV, uShine))
    + mix(uSkyHi, uGlowCol, 0.40) * (edge * 0.55);

  // What the flame pushes out through the pane. Centred low, because the flame
  // sits in the bottom third of the box, and squeezed a little horizontally so
  // it reads as a source behind the glass rather than as a wash over it. A back
  // pane gets more of it: you are looking at its lit inside face.
  float d = length(vec2(vPane.x * 0.85, (vPane.y + 0.42) * 1.05));
  float lit = exp(-d * d * 4.20) * mix(1.0, 1.55, back);

  vec3 body = outgoingLight + uGlowCol * (uGlow * lit);

  // Composited as an "over", so the alpha handed to the blender is the alpha the
  // glass really has and the reflection is not multiplied away by an opacity
  // slider. That mistake is the classic one and it makes every highlight on a
  // transparent surface disappear exactly when the surface gets clearer.
  float A = uBodyA + 0.30 * edge;
  float a = clamp(A + F * (1.0 - A), 0.0, 1.0);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

// -----------------------------------------------------------------------------
// geometry helpers

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// The quarter-round taken off an end, so a loft's top and bottom are eased
// rather than cut. d is the distance in from that end.
const fillet = (d, e) => (d >= e || e <= 0 ? 0 : e - Math.sqrt(Math.max(0, e * e - (e - d) * (e - d))));

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
}

// A lofted superellipse solid, swept up Y, with its cross section given as a
// function of height.
//
// Rows are placed by ARC LENGTH along the profile rather than evenly in Y, and
// that is not a refinement, it is what makes the whole file affordable. Every
// shape here is mostly straight with a few small fillets on it: the cornice's
// ovolo is 26mm out of a 940mm pillar, so an even sampling fine enough to draw
// it needs six times the rows, and every one of those rows is a full ring. With
// arc-length placement 56 rows put a dozen of themselves in the ovolo and three
// up the whole shaft, which is exactly right, and the pillar costs 5k triangles
// instead of 30k.
//
// `at(y)` returns [halfX, halfZ, p]. p is the superellipse exponent described
// at the top of the file.
function loftY({ y0, y1, at, rows = 56, ring = 44, capBottom = true, capTop = true, dense = 900 }) {
  // Dense pass, to measure the profile before deciding where to put rows.
  const ys = new Float64Array(dense + 1);
  const rs = new Float64Array(dense + 1);
  for (let i = 0; i <= dense; i++) {
    const y = y0 + ((y1 - y0) * i) / dense;
    const [hx, hz] = at(y);
    ys[i] = y;
    rs[i] = Math.max(hx, hz);
  }
  const cum = new Float64Array(dense + 1);
  for (let i = 1; i <= dense; i++) {
    const dy = ys[i] - ys[i - 1];
    const dr = rs[i] - rs[i - 1];
    cum[i] = cum[i - 1] + Math.hypot(dy, dr);
  }
  const total = cum[dense] || 1;

  const rowY = [];
  let k = 0;
  for (let i = 0; i <= rows; i++) {
    const want = (total * i) / rows;
    while (k < dense && cum[k + 1] < want) k++;
    const span = cum[k + 1] - cum[k];
    const f = span > 1e-12 ? (want - cum[k]) / span : 0;
    rowY.push(ys[k] + (ys[Math.min(k + 1, dense)] - ys[k]) * f);
  }
  rowY[0] = y0;
  rowY[rows] = y1;

  const verts = [];
  const index = [];
  for (let i = 0; i <= rows; i++) {
    const y = rowY[i];
    const [hx, hz, p] = at(y);
    for (let j = 0; j < ring; j++) {
      // The seam vertex is NOT duplicated: two coincident chains cannot average
      // their normals and leave a crease running the height of the piece.
      const a = (j / ring) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      verts.push(
        Math.sign(c) * Math.pow(Math.abs(c), p) * hx,
        y,
        Math.sign(s) * Math.pow(Math.abs(s), p) * hz,
      );
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring;
      const a = i * ring + j, an = i * ring + jn;
      const b = (i + 1) * ring + j, bn = (i + 1) * ring + jn;
      index.push(a, b, an, b, bn, an);
    }
  }
  const cap = (row, flip) => {
    const base = row * ring;
    const centre = verts.length / 3;
    verts.push(0, rowY[row], 0);
    for (let j = 0; j < ring; j++) {
      const a = base + j, b = base + ((j + 1) % ring);
      if (flip) index.push(centre, a, b); else index.push(centre, b, a);
    }
  };
  if (capBottom) cap(0, true);
  if (capTop) cap(rows, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A rounded bar: a box with every edge eased, built as one loft up its own
// length so the corner rounding and the end rounding are one surface.
function bar({ length, w, d, p = P_METAL, ends = 0.006, rows = 12, ring = 20 }) {
  const e = Math.min(ends, length * 0.45);
  const at = (y) => {
    const cut = fillet(y, e) + fillet(length - y, e);
    return [Math.max(1e-4, w / 2 - cut), Math.max(1e-4, d / 2 - cut), p];
  };
  return loftY({ y0: 0, y1: length, at, rows, ring });
}

function placed(geo, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0 } = {}) {
  const m = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
    .setPosition(x, y, z);
  geo.applyMatrix4(m);
  return geo;
}

// -----------------------------------------------------------------------------
// the parts

// The stone's dirt, carried in a vertex colour attribute.
//
// It is here because of a side-by-side render, not on principle. Next to a
// tombstone the plain pillar read as a WHITER material than the headstone even
// though both are PALETTE.stone: the headstone carries a painted mottle and a
// band of ground grime along its foot, and against that a clean flat block of
// the same hue looks like new concrete beside old limestone.
//
// Vertex colours rather than a canvas texture, for two reasons. The prop has to
// build head-less (style.js's contactShadow already carries a stub for exactly
// that case, and a document.createElement here would throw), and the shapes are
// lofts with no UV layout to paint into. What a vertex colour cannot do is fine
// detail; what it is asked for here is a slow mottle and three soft washes,
// which is all a block this size needs.
function stoneTint(geo, rand) {
  const pos = geo.attributes.position;
  const s1 = rand() * 9, s2 = rand() * 9, s3 = rand() * 9, s4 = rand() * 9, s5 = rand() * 9;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const m =
      0.55 * Math.sin(x * 11.3 + y * 4.1 + z * 7.9 + s1) * Math.sin(z * 9.7 - y * 3.3 + s2) +
      0.30 * Math.sin(x * 23.1 - z * 19.4 + s3) * Math.sin(y * 17.5 + x * 6.2 + s4) +
      0.15 * Math.sin(x * 41.0 + z * 37.0 + s5);
    let t = 1 + 0.055 * m;
    // Ground grime up the first 180mm, the band that stops a block from
    // looking as though it were set down this morning.
    t *= 1 - 0.15 * smoothstep(0.18, 0.02, y);
    // Two soft occlusions, in the two places a pillar has a re-entrant corner:
    // under the cornice's overhang and in the shoulder above the plinth. The
    // scene's one shadow-casting light comes in at an angle and cannot put
    // anything in either of them.
    t *= 1 - 0.10 * Math.exp(-(((y - (CORNICE_Y + 0.018)) / 0.038) ** 2));
    t *= 1 - 0.08 * Math.exp(-(((y - (PLINTH_H + 0.014)) / 0.030) ** 2));
    col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function stoneGeometry() {
  const at = (y) => {
    const t = clamp01((y - PLINTH_H) / (STONE_H - PLINTH_H));
    let r = SHAFT_R0 + (SHAFT_R1 - SHAFT_R0) * t;
    // The plinth swells below the shaft, with a soft shoulder rather than a
    // step: a hard step there catches the key light as a white line and is the
    // one place this shape can read as CAD even with the corners rounded.
    r += (PLINTH_R - SHAFT_R0) * (1 - smoothstep(PLINTH_H - 0.032, PLINTH_H + 0.024, y));
    // The cornice flares back out, reaching up toward the lantern.
    r += (CORNICE_R - SHAFT_R1) * smoothstep(CORNICE_Y, CORNICE_Y + 0.055, y);
    r -= fillet(y, BOT_FILLET) + fillet(STONE_H - y, TOP_FILLET);
    return [r, r, P_STONE];
  };
  return loftY({ y0: 0, y1: STONE_H, at, rows: 64, ring: SEGMENTS.radial - 4 });
}

// The flange and its four bolts: one geometry, because they are one casting as
// far as the eye is concerned and because the joint wants to be a single dark
// mass sitting in the middle of a pale stone flat.
function flangeGeometry() {
  const base = STONE_H - FLANGE_BED;
  const at = (y) => {
    const h = y - base;
    // Plate, then a cavetto in to the collar the box stands on.
    let r = FLANGE_R + (COLLAR_R - FLANGE_R) * smoothstep(FLANGE_H, FLANGE_H + 0.016, h);
    // The plate's own top and bottom arrises. The bottom one is buried in the
    // stone, which is the point of FLANGE_BED.
    r -= fillet(h, 0.007) + fillet(FLANGE_H + COLLAR_H - h, 0.006);
    return [r, r, P_METAL];
  };
  const parts = [loftY({ y0: base, y1: base + FLANGE_H + COLLAR_H, at, rows: 30, ring: 36 })];

  // Four domed bolt heads, one per face, out at the plate's edge. Half of each
  // is buried in the plate, so what stands proud is a dome and not a ball.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const head = loftY({
      y0: -BOLT_R * 0.55,
      y1: BOLT_R * 0.62,
      at: (y) => {
        const s = Math.sqrt(Math.max(0, BOLT_R * BOLT_R - y * y)) * 0.92;
        return [Math.max(1e-4, s), Math.max(1e-4, s), 0.62];
      },
      rows: 10,
      ring: 18,
    });
    parts.push(placed(head, {
      x: Math.cos(a) * BOLT_AT,
      z: Math.sin(a) * BOLT_AT,
      y: base + FLANGE_H - 0.004,
    }));
  }
  return mergeGeometries(parts, false);
}

// The cage: four corner uprights, a rail band top and bottom on each face, and
// the floor the candle stands on. Twelve bars and a plate, merged, because they
// are one welded frame and because twelve draw calls for a lantern is absurd.
function cageGeometry() {
  const parts = [];
  const c = BOX_R - BAR / 2;   // corner upright centres

  for (let k = 0; k < 4; k++) {
    const sx = k & 1 ? 1 : -1;
    const sz = k & 2 ? 1 : -1;
    parts.push(placed(
      bar({ length: BOX_H, w: BAR, d: BAR, ends: 0.005, rows: 14, ring: 22 }),
      { x: sx * c, z: sz * c, y: BOX_Y },
    ));
  }

  // Rails. Each spans the full face width and dies inside the uprights at both
  // ends, so no join is ever visible.
  const railLen = BOX_R * 2;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    for (const h of [BOX_Y + RAIL_H / 2, BOX_Y + BOX_H - RAIL_H / 2]) {
      const b = bar({ length: railLen, w: RAIL_H, d: BAR * 0.85, ends: 0.004, rows: 8, ring: 18 });
      // Built up Y, laid on its side, then swung round to its face.
      b.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -railLen / 2, 0));
      b.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      parts.push(placed(b, { ry: a, x: Math.sin(a) * (BOX_R - BAR * 0.45), z: Math.cos(a) * (BOX_R - BAR * 0.45), y: h }));
    }
  }

  // The floor of the box, which is also what stops you seeing down the inside
  // of the collar to nothing.
  parts.push(loftY({
    y0: BOX_Y + 0.004,
    y1: BOX_Y + 0.016,
    at: (y) => {
      const h = y - (BOX_Y + 0.004);
      const r = 0.092 - fillet(h, 0.004) - fillet(0.012 - h, 0.004);
      return [r, r, P_METAL];
    },
    rows: 6,
    ring: 30,
  }));

  // The burner. A flame floating a centimetre off a flat plate reads as a bug,
  // and a wax candle would need a second material and a second draw call for
  // something 24mm across seen through glass. A turned iron burner cup is the
  // same iron as everything else in this merge, so it is free.
  parts.push(loftY({
    y0: BOX_Y + 0.014,
    y1: BOX_Y + 0.034,
    at: (y) => {
      const h = y - (BOX_Y + 0.014);
      const r = 0.025 - 0.007 * smoothstep(0.004, 0.020, h) - fillet(0.020 - h, 0.005);
      return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
    },
    rows: 10,
    ring: 20,
  }));

  return mergeGeometries(parts, false);
}

// The pyramidal cap. Straight-sided pyramids read as origami, so the slope
// carries a small outward bulge and the eave carries a drip lip: both are what
// a piece of folded and soldered sheet actually does, and both give the key
// light somewhere to run along, which a flat facet does not.
function capGeometry() {
  // The apex is rounded by the same fillet() every other end here uses, taken
  // off a cone whose tip is already TIP wide rather than off a true point. That
  // matters: rounding a real point means intersecting the slope with a sphere,
  // and the two only agree at one radius, so every other radius leaves a crease
  // ringing the cap a third of the way down. Blunting the cone first makes the
  // fillet tangent by construction and the dome comes out in one surface.
  const TIP = 0.030;
  const at = (y) => {
    const t = clamp01((y - CAP_Y) / CAP_H);
    let r = (CAP_R - TIP) * (1 - t) + TIP + 0.085 * CAP_R * Math.sin(Math.PI * t);
    // The drip lip: the eave stands a hair proud of the slope above it, which
    // is what a folded and soldered sheet does and what gives the key light a
    // line to run along at the widest part of the whole lantern.
    r += 0.010 * (1 - smoothstep(0.0, 0.13, t));
    r -= fillet(y - CAP_Y, 0.010);
    r -= fillet(CAP_Y + CAP_H - y, TIP);
    return [Math.max(1e-4, r), Math.max(1e-4, r), P_METAL];
  };
  // Stopped 2mm short of the apex: the last ring would be a degenerate fan and
  // computeVertexNormals cannot normalise a zero-area triangle. The finial's
  // neck is wider than the ring left behind and swallows it.
  return loftY({ y0: CAP_Y, y1: CAP_Y + CAP_H - 0.002, at, rows: 40, ring: 36 });
}

// Neck and ball. Round in section, not square: it is the one turned part on the
// piece and turning it is what makes the two squares below it read as pressed
// and cut rather than as one extrusion.
function finialGeometry() {
  const y0 = CAP_Y + CAP_H - 0.006;
  const ballC = CAP_Y + CAP_H + FINIAL_NECK + FINIAL_R;
  const y1 = ballC + FINIAL_R;
  const at = (y) => {
    const neck = 0.0125 + 0.006 * smoothstep(y0 + 0.020, y0, y);
    const dy = y - ballC;
    const ball = Math.sqrt(Math.max(0, FINIAL_R * FINIAL_R - dy * dy));
    const r = Math.max(neck * (1 - smoothstep(ballC - FINIAL_R * 1.1, ballC - FINIAL_R * 0.55, y)), ball);
    return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
  };
  return loftY({ y0, y1, at, rows: 34, ring: 24 });
}

// Four bowed panes. `aPane` is -1..1 across each one and `aYaw` is the face it
// was built on, which together are the whole coordinate system the glass shader
// works in.
function glassGeometry() {
  const top = BOX_Y + BOX_H - RAIL_H;
  const bot = BOX_Y + RAIL_H;
  const hh = (top - bot) / 2;
  const mid = (top + bot) / 2;
  const NU = 10, NV = 14;

  const pos = [], pane = [], yaw = [], index = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * 2 - 1;
      for (let i = 0; i <= NU; i++) {
        const u = (i / NU) * 2 - 1;
        // Crown, zero at every edge so the pane meets its frame flush.
        const bow = PANE_BOW * Math.cos((u * Math.PI) / 2) * Math.cos((v * Math.PI) / 2);
        const lx = u * PANE_HW;
        const lz = PANE_Z + bow;
        // Face 0 faces +Z; the rest are the same pane swung round Y.
        pos.push(lx * ca + lz * sa, mid + v * hh, -lx * sa + lz * ca);
        pane.push(u, v);
        yaw.push(a);
      }
    }
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const p0 = base + j * (NU + 1) + i;
        const p1 = p0 + 1, p2 = p0 + (NU + 1), p3 = p2 + 1;
        index.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPane', new THREE.Float32BufferAttribute(pane, 2));
  g.setAttribute('aYaw', new THREE.Float32BufferAttribute(yaw, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The flame. A teardrop, round in section, standing on the box floor. It is a
// real object rather than a painted sprite for the reason pumpkin.js gives:
// modulating brightness in place only pumps the pool, where MOVING the source
// swings the light around inside the box and changes which pane is lit.
function flameGeometry() {
  const H = 0.072;
  const at = (y) => {
    const t = clamp01(y / H);
    // Fat and round at the base, drawn out to a tip.
    const r = 0.021 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - 0.18 * t) + 0.0035 * (1 - t);
    return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
  };
  return loftY({ y0: 0, y1: H, at, rows: 18, ring: 16 });
}

// -----------------------------------------------------------------------------
// smooth 1D value noise, and the warning that comes with it
//
// Layered, this gives the light its slow wander and its rare events. What it
// CANNOT give is the fine tremble, and pumpkin.js paid for finding that out:
// smoothstep interpolation has zero derivative at every lattice node, so a
// channel running at f Hz stands perfectly still f times a second, and summing
// three of them just gives three sets of stalls that occasionally line up.
// Measured on that prop, a summed-noise flicker had 30% of its frames within
// 0.002 of the frame before. See update() for what carries the tremble instead.
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

// What the lamp, the glass and the flame body look like at the bottom and top of
// the swing. All three come off one number, which is what makes the light on
// the ground and the light in the box read as the same fire.
//
// The ratio is 2.15:1, the same as the pumpkin's, so six pumpkins and a pair of
// these do not flicker at two different depths. The absolute level is a
// stylistic call: against a hemisphere at 1.15 and a key at 2.1 a truthful
// candle is invisible, and this is what makes the lantern read as lit.
const LAMP = { min: 0.395, max: 0.85 };
const GLASS_GLOW = { min: 0.30, max: 0.80 };
const WICK = { min: 0.95, max: 2.10 };
const HUE_MID = 0.88, HUE_GAIN = 1.5;

// -----------------------------------------------------------------------------

export function createPillarLantern({ seed = 1, scale = 1 } = {}) {
  const rand = rng(seed);
  const noise = makeNoise(seed);

  const group = new THREE.Group();

  // --- stone ---------------------------------------------------------------
  const stoneGeo = stoneTint(stoneGeometry(), rand);
  // The headstones' colour exactly, because it is the same quarry. Only the
  // roughness moves, and only a little: a pillar is a bigger, wetter block than
  // a headstone and takes a slightly broader sheen.
  const stoneMat = toyMaterial(PALETTE.stone, { roughness: 0.86, vertexColors: true });
  const stone = new THREE.Mesh(stoneGeo, stoneMat);
  stone.castShadow = true;
  stone.receiveShadow = true;

  // --- ironwork ------------------------------------------------------------
  const ironMat = toyMaterial(IRON, { roughness: IRON_ROUGH, metalness: 0.0 });
  const flangeGeo = flangeGeometry();
  const cageGeo = cageGeometry();
  const capGeo = capGeometry();
  const finialGeo = finialGeometry();

  const flange = new THREE.Mesh(flangeGeo, ironMat);
  const cage = new THREE.Mesh(cageGeo, ironMat);
  const cap = new THREE.Mesh(capGeo, ironMat);
  const finial = new THREE.Mesh(finialGeo, ironMat);
  for (const m of [flange, cage, cap, finial]) { m.castShadow = true; m.receiveShadow = true; }

  // --- glass ---------------------------------------------------------------
  const glassGeo = glassGeometry();
  const glassUniforms = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e, so a reflection
    // leaving the pane upward finds the first and one leaving downward finds
    // the second. Linear, because this composites before tone mapping.
    uSkyHi: { value: new THREE.Color('#dbe3f3').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c6cedc').convertSRGBToLinear() },
    // The LOW band is not the floor's own #8f949e, and that is a correction the
    // renders forced. Work out where a pane actually looks: it is vertical, the
    // diorama's camera is 29 degrees up, so the reflected ray leaves 29 degrees
    // DOWN, and the nearest thing 29 degrees down from a lantern pane is the
    // pillar's own pale cornice a hand's breadth below it, not the floor eight
    // times further away. Set to the floor colour the reflection was a dark
    // grey that vanished under the warm interior at every gain tried, which is
    // exactly the flat tinted rectangle this file is trying not to be.
    uSkyLo: { value: new THREE.Color('#989b9c').convertSRGBToLinear() },
    // Amplitude, then where the band sits and how wide it is, in the reflected
    // ray's own y. -0.22 puts it across the upper third of a pane at this
    // camera's elevation, and 0.13 makes it about a fifth of the pane deep: any
    // wider and it is a gradient again.
    uGlare: { value: new THREE.Color('#f2f6ff').convertSRGBToLinear().multiplyScalar(1.95) },
    uGlareAt: { value: new THREE.Vector2(-0.22, 0.155) },
    // Between the key in main.js and the one in the preview harness.
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    uGlowCol: { value: new THREE.Color(PALETTE.glow).convertSRGBToLinear() },
    uGlow: { value: 0.2 },
    // Physically 1.0. It is well over one because the fake sky is a flat
    // gradient with no bright spots of its own to find, so a correct fresnel
    // over it returns a correct amount of nothing. Same argument, and the same
    // fix, as fountain/water.js.
    uRimGain: { value: 4.20 },
    uGlint: { value: 1.70 },
    uShine: { value: 95.0 },
    // How much of the pane is glass and how much is air. Low: you have to see
    // the flame and the far frame through it, and everything that makes it read
    // as a surface is in the reflection and the edge rather than in the body.
    uBodyA: { value: 0.155 },
    uWave: { value: 0.048 },
    uSeed: { value: rand() * 6.283 },
  };

  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS_TINT),
    // Not mirror-smooth. A 0.07 lobe is so tight it misses the key entirely at
    // most of the angles this prop is seen from, and a pane with no highlight on
    // it at all is the flat rectangle this whole section exists to avoid.
    roughness: 0.15,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    // Four panes of a box, all of them see-through. Writing depth would let
    // whichever pane happened to draw first hide the three behind it.
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aPane;
attribute float aYaw;
varying vec2 vPane;
varying vec3 vGlassP;
varying float vYaw;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vPane = aPane;
  vYaw = aYaw;
  vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_OPTICS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Without this three hands the material a program it compiled for some other
  // MeshStandardMaterial with the same parameters, and the patch above is
  // silently dropped.
  glassMat.customProgramCacheKey = () => 'pillar-lantern-glass';

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.castShadow = false;
  glass.receiveShadow = false;
  glass.renderOrder = 2;

  // --- flame ---------------------------------------------------------------
  const flameGeo = flameGeometry();
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: WICK_FLAME.clone(),
    emissiveIntensity: 1.6,
    roughness: 1.0,
    metalness: 0.0,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, BOX_Y + 0.031, 0);
  flame.castShadow = false;
  flame.receiveShadow = false;
  flame.renderOrder = 1;
  const flameHome = flame.position.clone();

  // --- the one light -------------------------------------------------------
  // ONE PointLight, and it does not cast shadows. Six pumpkins already put six
  // point lights and six spotlights into this scene and every one of them is in
  // every fragment shader's loop, so a lantern that wants two is a lantern that
  // does not ship.
  //
  // A spotlight with a shadow map would be the physically right answer here:
  // the box has four opaque corners and a solid cap, so the light really does
  // leave it in four fans and never straight up. It is not worth it. A shadow
  // map is a whole extra render pass per frame, the occluder is a 26mm bar, and
  // at this scale the four fans are two pixels wider than the wash they would
  // replace. The cap being solid is instead paid for by placing the light low
  // in the box and letting the ironwork's own cast shadow, which the key light
  // is already drawing, do the shaping.
  //
  // DECAY IS 1, NOT 2, and that is the one deliberately unphysical number in
  // the file. A lantern hung 1.1 above the ground has its own cornice 0.19
  // away and the floor 1.1 away, a six to one range, which inverse square turns
  // into thirty six to one. There is no intensity that survives that: set so
  // the floor takes a warm pool and the cornice is a white hole with no colour
  // in it, set so the cornice is warm cream and nothing reaches the ground at
  // all. Measured both, kept neither. At decay 1 the same six to one range
  // costs six to one, the cornice sits at about 2.1 against a key of 2.1 and
  // the pool on the floor is still plainly there two-thirds of a unit out.
  const light = new THREE.PointLight(FLAME.clone(), 0, 3.4 * scale, 1);
  light.position.set(0, BOX_Y + 0.155, 0);
  light.castShadow = false;
  const lightHome = light.position.clone();

  const patch = contactShadow({ radius: 0.34, opacity: 0.30, softness: 0.5 });

  group.add(stone, flange, cage, cap, finial, glass, flame, light, patch);

  // A whisker of lean and a whisker of yaw, per seed. A pair of these either
  // side of a gate should not be a mirror of one model, and a settled pillar
  // never stands quite plumb. Kept under a degree: past that the lantern's cap
  // reads as falling off rather than as old.
  group.rotation.z = (rand() - 0.5) * 0.016;
  group.rotation.x = (rand() - 0.5) * 0.014;
  group.rotation.y = (rand() - 0.5) * 0.10;
  group.scale.setScalar(scale);

  const phase = rand() * 100;

  return {
    group,
    update(time) {
      // A candle is mostly steady and it is never still. Four things run at
      // once and the light only reads as flame when all four do: a fine tremble
      // that never stops, a slower wander breathing under it, the rare event (a
      // gutter that ducks hard, a flare as the flame straightens), and the
      // flame physically moving while it does the rest.
      const t = time + phase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;

      // TREMBLE. Not summed noise: see makeNoise above for why that stalls. Two
      // sine carriers whose PHASE is dragged about by slow noise. A flame's
      // flutter has a frequency; what wanders is where in the cycle it has got
      // to, not whether it is happening at all. Frequency-modulated like this
      // it never stalls and never repeats, where the bare sine underneath would
      // read as a hum. Both carriers sit inside the 5..15Hz band a real candle
      // flickers in: at 60fps a 20Hz carrier is three frames to a period and
      // comes out as sparkle rather than as tremble.
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.032 * wobble(7.1, 0.6, 12.4) + 0.019 * wobble(12.3, 0.9, 55.1);

      // WANDER. The slow breathing underneath. Summed noise is right here and
      // its stalls are a feature: a lull is what the slow channel is for, and
      // the tremble is still running through it.
      const wander = 0.046 * swing(0.77, 0) + 0.033 * swing(2.2, 17.5);

      // GUTTER. Only the top of a slow channel counts, so these are separate
      // things that happen rather than a rhythm; squaring the ramp keeps the
      // deep part brief while the onset and recovery stay soft. Its depth
      // wobbles on a fast channel of its own, because a flame short of air does
      // not duck smoothly. A lantern's flame is behind glass and is better
      // sheltered than a pumpkin's, so this is a little shallower.
      const g = noise(t * 0.43 + 77.3);
      const gutter = g > 0.75 ? (g - 0.75) / 0.25 : 0;
      const dip = gutter * gutter * (0.34 + 0.24 * noise(t * 9.1 + 5.1));

      // FLARE, the gutter's other half, and set rarer because a flame droops
      // far more often than it draws itself up.
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.80 ? (fl - 0.80) / 0.20 : 0;
      const flare = flareRamp * flareRamp * (0.11 + 0.07 * noise(t * 7.1 + 91.2));

      // A SOFT CEILING and not a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the maximum and sit there, which pins
      // the glass at its brightest: the one state in which the transmitted glow
      // stops separating the four panes and the box goes white. This bends the
      // top over instead, matching value and slope at the knee and asymptoting
      // above it, so a flare comes out as a peak with a shape on it and the
      // glass never quite arrives.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const at = (r) => r.min + (r.max - r.min) * level;
      light.intensity = at(LAMP) * scale;
      glassUniforms.uGlow.value = at(GLASS_GLOW);
      flameMat.emissiveIntensity = at(WICK);

      // A guttering flame reddens as it drops and a flaring one goes whiter, so
      // the colour rides the same value. Levered about the level's own mean
      // rather than fed the level straight: the level spends its life in the
      // top eighth of its range, so fed straight through the mix would only
      // ever travel the top quarter of ember..flame and a real gutter would
      // never reach ember at all.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      light.color.copy(EMBER).lerp(FLAME, hue);
      glassUniforms.uGlowCol.value.copy(light.color);
      flameMat.emissive.copy(WICK_EMBER).lerp(WICK_FLAME, hue);

      // The flame is an object and it moves, which is the half of the effect
      // that modulating intensity cannot reach. Inside a glazed box the payoff
      // is specific and worth naming: the source sliding 15mm off centre is a
      // fifth of the box's half-width, so the transmitted glow slides visibly
      // from one pane to the next and the four panes stop glowing in unison.
      // Half slow noise and half a carrier of its own, so the tip whips at
      // about the rate the brightness trembles at rather than drifting smoothly
      // underneath a flickering light.
      const ax = 0.015 * (0.55 * swing(0.81, 5.5) + 0.45 * wobble(5.7, 0.5, 71.6));
      const az = 0.015 * (0.55 * swing(0.67, 31.2) + 0.45 * wobble(6.3, 0.5, 24.9));
      // Up on a flare, down in a gutter, and a fine bob the rest of the time.
      const rise = 0.010 * swing(1.3, 8.1) + 0.030 * flare - 0.026 * dip;

      light.position.set(lightHome.x + ax, lightHome.y + rise, lightHome.z + az);
      flame.position.set(flameHome.x + ax * 0.75, flameHome.y + rise * 0.5, flameHome.z + az * 0.75);
      // The flame leans the way it is being pushed, which is what stops the
      // teardrop reading as a bead sliding about on a wire.
      flame.rotation.z = -ax * 5.5;
      flame.rotation.x = az * 5.5;
      flame.scale.set(1, 1 + 0.22 * (level - 0.9) * 3.0, 1);
    },
    dispose() {
      for (const g of [stoneGeo, flangeGeo, cageGeo, capGeo, finialGeo, glassGeo, flameGeo]) g.dispose();
      for (const m of [stoneMat, ironMat, glassMat, flameMat]) m.dispose();
      patch.userData.dispose?.();
      group.clear();
    },
  };
}

// Published so a layout can stand a pair either side of a gate without
// measuring anything off a render.
export const PILLAR = {
  height: TOTAL_H,
  stoneHeight: STONE_H,
  footprint: PLINTH_R * 2,
  lightAt: BOX_Y + 0.055,
};

export default createPillarLantern;
