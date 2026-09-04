import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS } from '../style.js';

// A cluster of candle jars: the squat glass votives that get left in a bunch on
// a grave, sitting straight on the earth at whatever angle they were put down.
// Three of them burning and one knocked over and out.
//
// It is the only lantern in the set that is a GROUP rather than an object, and
// that is its whole reason to exist. Every other lantern lays ONE pool. This one
// scatters several small warm points at slightly different heights, out of step
// with each other, over a footprint about 0.42 by 0.36 units. Standing beside a
// `fred` headstone (1.10 tall) it comes up to about a tenth of it: it is the
// smallest thing in the set by a wide margin and it is meant to be, because a
// bunch of votives is small and low and reads by its scatter rather than by its
// silhouette.
//
// Four things decided the build.
//
// ONE LIGHT FOR THREE FLAMES. Six pumpkins and five lanterns already put point
// lights in every fragment shader's loop, and a group prop cannot spend four
// more. See `the one light` below for what the single PointLight does and what
// the visible glow does instead.
//
// FOUR OBJECTS, FIVE DRAW CALLS. A cluster built as four independent props is
// four times the draw calls of a single one, which is the wrong trade for the
// smallest prop in the set. Everything here is merged across the jars instead
// and the per-jar variation is carried in vertex attributes and small uniform
// arrays: all four glasses are one mesh, all four candles and their wicks are
// one mesh, and the three flames are two InstancedMeshes. See `aJar`.
//
// FOUR PHASES. Four candles driven off one flicker are not four candles, they
// are one object with four windows. Each jar gets its own noise instance, its
// own pair of carrier frequencies and its own phase, so no two of them peak
// together. See `flicker`.
//
// GLASS WITH NOTHING TO REFLECT. Same problem and same answer as the ground
// lantern (ground.js), which took it from the fountain (fountain/water.js):
// this scene has no environment map, so the glazing carries a three band
// procedural sky sampled off the reflected normal, a Schlick fresnel deciding
// how much of it you see, and one soft specular lobe for the key. What differs
// here is the shape it sits on, and that is the interesting part: see uRimGain.

// ---------------------------------------------------------------------------
// dimensions
//
// World units, every jar's foot at y = 0, origin at the centre of the cluster.
//
// A jar is authored as: outer radius at the waist, height to the top of the
// rolled rim, and the radius of that roll. Everything else falls out of those
// three, including the wall thickness, which is the roll's own horizontal reach
// (see jarProfile) so that the rim tucks back down onto the inside wall exactly
// rather than nearly.
//
// The absolute size is set against the ground lantern next door: its glazed box
// is 0.25 across and 0.35 to the top of its handle, and a votive jar is the
// thing you would stand three of inside it. So the biggest here is 0.072 in
// radius and 0.118 tall, a little under half the ground lantern's width and a
// third of its height, and the smallest is smaller again. Below about 0.05 the
// rolled rim stops being visible at this camera distance and the jar goes back
// to being a tube, which is the floor on how small these can get.

const FLOOR_T = 0.016;   // thickness of the glass bottom the candle stands on
const BASE_FILLET = 0.010;
const INNER_FILLET = 0.008;

// The jars, in order, and the layout is composed rather than scattered: a bunch
// left on a grave huddles, with the tall one at the back, the short ones leaning
// in toward it, and the dead one fallen away from the group. `seed` jitters all
// of it but never enough to break the huddle.
//
// `burn` is how far down the stub has gone as a fraction of the jar's inside
// depth, and it is the one number that changes what each jar LOOKS like rather
// than where it is. At 0.82 the flame stands clear above the rim and the jar is
// a candle in a glass; at 0.34 the flame is down at the bottom and you get the
// votive, a jar that is simply a warm brick with a bright floor. Having all
// three in one cluster is most of what stops the group reading as one object
// stamped out three times.
const JARS = [
  { x: -0.112, z:  0.062, rOut: 0.062, hgt: 0.100, roll: 0.0105, burn: 0.58, lit: true },
  { x:  0.058, z:  0.104, rOut: 0.054, hgt: 0.084, roll: 0.0095, burn: 0.34, lit: true },
  { x:  0.104, z: -0.052, rOut: 0.072, hgt: 0.118, roll: 0.0115, burn: 0.82, lit: true },
  { x: -0.128, z: -0.118, rOut: 0.058, hgt: 0.092, roll: 0.0100, burn: 0.46, lit: false, tipped: true },
];

// Segments round a jar. SEGMENTS.radial is 48 and sized for props a good deal
// bigger than this; a jar 0.13 across never covers enough pixels for the extra
// eight to show, and there are four of them plus four candles in one prop.
const AROUND = Math.round(SEGMENTS.radial * 0.84);

// ---------------------------------------------------------------------------
// colour
//
// Nothing here invents a hue. The wax, the flame and its two ends are the ground
// lantern's exactly, because the brief for both is the same candle and the two
// props may well stand in the same frame. The glass is a shade paler than the
// ground lantern's pane for the reason a jar differs from a lantern pane: it is
// bottle glass, thicker and less clean, and it wants to sit closer to the
// fountain's water than to a window.

const GLASS_TINT = '#a9c3ce';
const WAX = '#efe4cd';
const WICK = '#2a2118';

// The lamp's colour, converted by hand because these are a light's colour and
// three does not colour-manage those.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// And the flame BODY, which is a material. Above 1 on purpose: ACES rolls a
// bright emissive off toward white, and a flame that does not clip its core
// reads as an orange jelly bean.
const CORE_EMBER = new THREE.Color('#ff8a30');
const CORE_FLAME = new THREE.Color('#ffd08a');

// ---------------------------------------------------------------------------
// the jar
//
// One closed shell: up the outside, over the rolled rim, back down the inside
// and across the floor. Closed matters, because the glass is drawn FrontSide
// only (ground.js's finding: a DoubleSide shell composites its near and far
// halves in triangle order and the tint crawls as the camera turns). A closed
// vessel drawn front-only gives exactly two layers along any ray, the near
// outside wall and the far inside wall, which is what a jar physically is.
//
// The wall is barrelled: fattest a little below the middle, drawing in slightly
// toward the neck. That is the house style asking for a fat rounded jar rather
// than a tube, and it is also load-bearing optically, for the same reason the
// ground lantern's pane needed a barrel. A vertical surface at this camera
// elevation reflects the GROUND, because the reflected ray's height is minus
// the view ray's. A cylinder is only curved horizontally, so on its own it
// sweeps the reflection sideways along the horizon and never up out of it. The
// barrel tilts the lower half of the wall far enough up that its reflected ray
// clears the horizon and finds the pale band of the sky, which is where the
// cool-to-warm gradient down each jar comes from.

function jarProfile(J) {
  const pts = [];
  const push = (r, y) => {
    const last = pts[pts.length - 1];
    // A repeated point is a zero-length profile tangent and a NaN normal.
    if (last && Math.abs(last.x - r) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
    pts.push(new THREE.Vector2(r, y));
  };
  // Angles in degrees in the (r, y) plane: 0 points out along r, 90 points up.
  const arc = (cr, cy, rad, a0, a1, steps) => {
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180;
      push(cr + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
  };

  const { rOut, hgt, roll } = J;
  const rNeck = rOut * 0.965;
  const rBase = rOut * 0.920;
  const bulge = rOut * 0.078;
  // The rim rolls out and then tucks back in through 150 degrees, so the wall
  // thickness is fixed by the roll rather than chosen: cos(150) * roll.
  const tw = roll * Math.cos(Math.PI / 6);
  const yWallTop = hgt - 2 * roll;
  const wallR = (u) => rBase + (rNeck - rBase) * u + bulge * Math.sin(Math.PI * Math.pow(u, 0.88));

  // Outer floor and the roll it stands on. The jar meets the ground on a real
  // rounded rim rather than a sharp circle, which is the difference between a
  // vinyl toy and a tin can.
  push(0, 0);
  push(rBase * 0.45, 0);
  push(rBase - BASE_FILLET, 0);
  arc(rBase - BASE_FILLET, BASE_FILLET, BASE_FILLET, -90, 0, 6);

  const nWall = 14;
  for (let i = 1; i <= nWall; i++) {
    const u = i / nWall;
    push(wallR(u), BASE_FILLET + (yWallTop - BASE_FILLET) * u);
  }

  // The rolled rim: out, over the top and back under. Stopped at 150 rather
  // than 180 so the lip has an undercut you can see from above, which is what
  // makes it read as rolled rather than as a bead stuck on.
  arc(rNeck, hgt - roll, roll, -90, 150, 12);

  // Down the inside, the same barrel a wall thickness in.
  for (let i = nWall; i >= 1; i--) {
    const u = i / nWall;
    push(wallR(u) - tw, BASE_FILLET + (yWallTop - BASE_FILLET) * u);
  }
  push(rBase - tw, FLOOR_T + INNER_FILLET);
  arc(rBase - tw - INNER_FILLET, FLOOR_T + INNER_FILLET, INNER_FILLET, 0, -90, 6);
  push(0, FLOOR_T);

  return pts;
}

// ---------------------------------------------------------------------------
// the candle inside it
//
// A stub with a rounded shoulder and a melted well in the top, standing in its
// own pool of run wax. Nearly filling the jar, because a votive is poured into
// its glass rather than dropped into it, and the millimetre of gap is what
// keeps the two surfaces from z-fighting where they touch.

function candleProfile(rIn, yTop) {
  const pts = [];
  const push = (r, y) => pts.push(new THREE.Vector2(r, y));
  const r = rIn - 0.0025;
  push(0, FLOOR_T);
  push(r, FLOOR_T);
  push(r, yTop - r * 0.34);
  // Shoulder and the melted well, which is the whole reason to lathe this
  // rather than draw a cylinder: a flat-topped candle is a dowel.
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.5;
    push(r * Math.cos(a) * 0.88 + r * 0.12 * Math.cos(a * 0.5), yTop - r * 0.34 + r * 0.34 * Math.sin(a));
  }
  push(r * 0.26, yTop - 0.0015);
  push(0, yTop - 0.004);
  return pts;
}

// ---------------------------------------------------------------------------
// flicker
//
// The scene's flicker, taken from the ground lantern which took it from the
// pumpkin, and the two findings behind it are worth restating because they are
// the ones that get lost:
//
// SUMMED VALUE NOISE STALLS. Smoothstep interpolation is flat at every lattice
// node, so a channel at f Hz stands still f times a second by construction, and
// summing three of them just gives three sets of stalls that sometimes line up.
// Measured at 30% of frames moving by less than 0.002 on the version that did
// that, and the light visibly froze. The tremble here is two sine carriers in
// the 5..15 Hz band a candle flutters in, whose PHASE is dragged about by slow
// noise: the flutter has a frequency and what wanders is where in the cycle it
// has got to. Value noise is still right for the slow wander and for the gutter
// and flare gates, where a stall is a lull and a lull is the point.
//
// A HARD CLAMP PINS EVERY FLARE FLAT. Clamped at 1, every flare and a good many
// ordinary peaks land on the ceiling and sit there. The knee below matches value
// and slope and then asymptotes, so a flare comes out as a peak with a shape.
//
// AND FOUR OF THEM MUST NOT AGREE. This is the part that is this prop's and not
// inherited. Offsetting one flicker in time is not enough: the three lit jars
// are on screen together, so a shared noise field read at three offsets still
// gives three copies of the same gutter arriving in sequence, which reads worse
// than unison because the eye catches the rhythm. Each jar therefore gets its
// own `makeNoise` instance (a different hash field entirely), its own pair of
// carrier frequencies, and its own phase. Nothing is shared but the shape.

function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

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

// Carrier pairs, one per jar, all inside 5..15 Hz. Deliberately not harmonics
// and not near-misses of each other: near-misses beat, and a pair of candles
// beating against each other at a fraction of a hertz is exactly the "one object
// with four windows" failure in slow motion.
const CARRIERS = [
  [6.9, 12.1],
  [8.3, 13.7],
  [6.1, 10.9],
  [7.6, 14.3],
];

// What each thing driven by a flame looks like at the bottom and the top of its
// swing. All of them ride the one level per jar, which is the trick: a lamp that
// dims while the flame body and the glass's inner wash hold still reads as a
// dimmer being turned down in another room.
//
// LAMP is per jar and it is what the single PointLight sums, so the three of
// them together mean a mean total near 1.6 against the ground lantern's 1.05 for
// one candle behind six panes. Not three times, on purpose: three jars are
// three visible points of light, and if the pool they share is three times as
// bright the prop stops being a scatter and becomes one bright puddle with
// decoration in it. Swept at per-jar peaks of 0.45, 0.62 and 0.90 and looked at
// beside a headstone; the top one clipped the floor to a flat disc and took the
// flicker with it, which is the same failure the ground lantern found.
const LAMP = { min: 0.13, max: 0.31 };
const CORE = { min: 1.15, max: 2.45 };   // flame body, above 1 so ACES clips it
const HALO = { min: 0.10, max: 0.26 };   // the soft shell around it
const WASH = { min: 0.85, max: 2.10 };   // the candle on the inside of the glass

// How the flame's colour is mixed between ember and flame. Levered about the
// level's own mean rather than fed the level straight, because the level lives
// in the top eighth of its range: fed straight through, ember is only reachable
// in a gutter deep enough to have put the candle out.
const HUE_MID = 0.88;
const HUE_GAIN = 1.5;

// ---------------------------------------------------------------------------
// glass
//
// The fountain's fake optics, cut down to what a jar needs, plus the two things
// a merged four-jar mesh has to carry that a single pane did not: which jar a
// fragment belongs to, and where up its own jar it is. Both arrive as vertex
// attributes and are resolved to varyings in the vertex shader, so the fragment
// shader never indexes a uniform array.

function glassPars() {
  return `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uInnerCol;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
varying vec3 vGlassP;
varying float vH;
varying float vWash;
varying float vSoot;
varying float vFlameH;

vec3 viewToWorld(vec3 v) {
  return vec3(dot(v, viewMatrix[0].xyz), dot(v, viewMatrix[1].xyz), dot(v, viewMatrix[2].xyz));
}

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands and not two, for the reason water.js gives: a surface seen side on
// reflects almost horizontally, so its silhouette samples the horizon and
// nothing else, and a two colour ramp puts a DARK outline round a piece of
// glass.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with soda glass's F0, which is 0.04 rather than water's 0.02.
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
}

// The composite, in the order light meets the glass, and it is an `over` rather
// than an opacity slider. That is the classic way to lose this effect: the
// fresnel rim gets computed correctly and then faded out along with the body it
// was supposed to stand clear of. A highlight on glass is opaque where it lands.
const GLASS_FRAG = `
  vec3 wN = viewToWorld(normal);
  vec3 wV = worldViewDir(vGlassP);
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);

  // Soot. On a jar it collects in a ring up near the rim where the mouth is,
  // not over the whole wall, and it is most of what stops the glass reading as
  // a clean plastic tumbler.
  float soot = vSoot * smoothstep(0.52, 0.94, vH);

  // The candle on the inside face. A jar is open at the top and packed with wax
  // below the wick, so the wash is brightest level with the flame, spreads
  // upward into the empty neck and is cut off faster below, where the stub
  // itself is in the way. Warmer at a glancing angle for the same reason A is
  // bigger there: more glass to glow through.
  float d = vH - vFlameH;
  float lit = exp(-(d > 0.0 ? 2.9 : 6.4) * abs(d)) * (0.55 + 0.45 * (1.0 - ndv));

  // BODY: the glass's own tint over whatever is behind it, thicker at a
  // glancing angle because the chord through it is longer there.
  vec3 body = outgoingLight * (1.0 - 0.75 * soot) + uInnerCol * (vWash * lit);
  float A = clamp(mix(uBodyA, uBodyA * 3.0, 1.0 - ndv) + 0.55 * soot, 0.0, 1.0);

  // SURFACE: what bounces off the outside, IN FRONT of the body rather than
  // mixed into it.
  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0);
  float glint = clamp(uGlint * sunGlint(wN, wV, uShine), 0.0, 1.0);
  float S = F + glint * (1.0 - F);
  vec3 surf = (skyProbe(reflect(-wV, wN)) * F + uSunCol * (glint * (1.0 - F))) / max(S, 1e-4);

  float a = S + A * (1.0 - S);
  gl_FragColor = vec4((surf * S + body * A * (1.0 - S)) / max(a, 1e-4), a);
`;

// ---------------------------------------------------------------------------

export function createCandleJars({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed);
  const n = JARS.length;

  // --- layout --------------------------------------------------------------
  // Each jar gets a matrix and keeps it: everything below is built in jar space
  // and baked into the merged buffers through this, and the flames read it back
  // at run time to place themselves.
  const placed = JARS.map((J, i) => {
    const jitter = 0.020;
    const x = J.x + (rand() - 0.5) * jitter;
    const z = J.z + (rand() - 0.5) * jitter;
    const spin = rand() * Math.PI * 2;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    if (J.tipped) {
      // On its side, resting on the barrel of its own wall, mouth pointing away
      // from the group. Rolled a little as well, so it is not lying on a seam
      // like something that was placed there rather than knocked over.
      const away = Math.atan2(z, x) + (rand() - 0.5) * 0.7;
      e.set(0, -away, Math.PI / 2 + (rand() - 0.5) * 0.16, 'YXZ');
      // Its axis is horizontal, so it rests at its own widest radius, and it is
      // pushed a hair into the ground because a jar in earth is not on a table.
      m.compose(
        new THREE.Vector3(x, J.rOut * 0.965 + J.roll - 0.0015, z),
        new THREE.Quaternion().setFromEuler(e),
        new THREE.Vector3(1, 1, 1),
      );
    } else {
      // A degree or two of lean, tipped toward the middle of the group: they
      // were set down on earth, and a bunch of them settles inward.
      const lean = 0.030 + rand() * 0.045;
      const toward = Math.atan2(z, x) + Math.PI;
      e.set(Math.sin(toward) * -lean, spin, Math.cos(toward) * lean, 'YXZ');
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromEuler(e),
        new THREE.Vector3(1, 1, 1),
      );
    }
    // Where the flame sits up the jar, in jar space. The stub fills `burn` of
    // the inside depth and the flame stands on top of it.
    const inside = J.hgt - 2 * J.roll - FLOOR_T;
    const waxTop = FLOOR_T + inside * J.burn;
    return { ...J, m, waxTop, flameH: waxTop / J.hgt, phase: rand() * 240, noise: makeNoise(seed * 31 + i * 97 + 7) };
  });

  // --- glass ---------------------------------------------------------------
  // Four lathes, each carrying its own index and its own normalised height, all
  // merged into one buffer. `aJar` is what buys the single draw call: without
  // it the per-jar wash and soot would have to be four materials.
  const glassParts = placed.map((J, i) => {
    const g = new THREE.LatheGeometry(jarProfile(J), AROUND);
    const count = g.attributes.position.count;
    const pos = g.attributes.position.array;
    const aJar = new Float32Array(count);
    const aH = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      aJar[v] = i;
      aH[v] = pos[v * 3 + 1] / J.hgt;
    }
    g.setAttribute('aJar', new THREE.BufferAttribute(aJar, 1));
    g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
    g.applyMatrix4(J.m);
    return g;
  });
  const glassGeo = mergeGeometries(glassParts, false);
  for (const g of glassParts) g.dispose();

  const optics = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e, so a reflection
    // leaving the glass going up finds the first and one going down finds the
    // second. The bottom band is lifted from the literal floor colour, because
    // the lower half of a jar's wall reflects nothing else, and glass that
    // reflects the floor exactly reads as a hole rather than as glass over it.
    // Linear, because this is composited before tone mapping.
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#9aa3b0').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    uInnerCol: { value: new THREE.Color(PALETTE.glow).convertSRGBToLinear() },
    // How much of the fresnel to believe. Physically 1.0. The ground lantern
    // needed 9 and this needs 6, and the difference is the whole argument for
    // why a number like this cannot be copied between props.
    //
    // The gain stands in for a missing surround: Schlick gives glass four per
    // cent face on, which is correct, and which is exactly why a real
    // photograph of a votive is lit with a big soft source the glass can
    // reflect. This scene has no such source and no environment at all. But a
    // jar is a body of revolution, so at any moment a whole vertical band of it
    // IS at a glancing angle to the camera, where a lantern's flat pane is
    // either glancing or not. There is more real fresnel here to begin with,
    // and pushing it as hard as the pane needed turned the jars into pale
    // plastic. Swept at 3, 4.5, 6, 9 and 13: under 4 the glass stops existing
    // and the wax floats, over about 9 it goes milky and swallows the candle.
    uRimGain: { value: 6.0 },
    // The key's own lobe, broad rather than tight. A jar's wall is curved in
    // one direction, so a tight lobe fires as a hard vertical line down one
    // side; broadened, it becomes the soft band of light down the shoulder that
    // curved glass actually does, and it also catches the rolled rim, which is
    // the one place on this prop with curvature in both directions.
    uGlint: { value: 1.55 },
    uShine: { value: 34.0 },
    // How much of what is behind the glass the glass hides, face on. Lower than
    // the ground lantern's pane: you look INTO these, so the candle and the far
    // inside wall have to survive two crossings rather than one.
    uBodyA: { value: 0.13 },
    uWash: { value: placed.map(() => 0) },
    uSoot: { value: placed.map((J) => (J.lit ? 0.26 + 0.10 * ((J.burn * 7) % 1) : 0.30)) },
    uFlameH: { value: placed.map((J) => J.flameH) },
  };

  // Still a plain MeshStandardMaterial and still no transmission: a refractive
  // material drags a render target and a second scene pass behind it and would
  // light the glass out of register with the wax inside it. The shader takes
  // over the last line instead.
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS_TINT),
    roughness: 0.15,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, optics);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aJar;
attribute float aH;
uniform float uWash[${n}];
uniform float uSoot[${n}];
uniform float uFlameH[${n}];
varying vec3 vGlassP;
varying float vH;
varying float vWash;
varying float vSoot;
varying float vFlameH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vH = aH;
  int jarIdx = int(aJar + 0.5);
  vWash = uWash[jarIdx];
  vSoot = uSoot[jarIdx];
  vFlameH = uFlameH[jarIdx];`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${glassPars()}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Exposed so a lab page can turn the optics knobs between frames. Every one of
  // the numbers above was found by rendering a sweep and looking at it, and a
  // rebuild per value is the difference between sweeping ten and sweeping three.
  glassMat.userData.optics = optics;

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 2;
  // Never a caster. A shadow map has no idea the glass is transparent, so a
  // casting jar is a solid black cylinder on the ground, which is the exact
  // opposite of what this prop is for. It receives, so the tipped jar's own
  // shadow still crosses whatever it has rolled against.
  glass.castShadow = false;
  glass.receiveShadow = true;

  // --- wax and wicks -------------------------------------------------------
  // Four candles and four wicks, one mesh, one material. Two colours over
  // vertex colours and one extra attribute to say which vertices are allowed to
  // glow, because a glowing wick is a bright dot at the centre of every flame
  // and it kills the flame's own core.
  const waxParts = [];
  const waxCol = new THREE.Color(WAX);
  const wickCol = new THREE.Color(WICK);
  placed.forEach((J, i) => {
    const rIn = J.rOut * 0.92 - J.roll * Math.cos(Math.PI / 6);
    const tag = (g, jar, glowable, col) => {
      const count = g.attributes.position.count;
      const aJar = new Float32Array(count);
      const aWax = new Float32Array(count);
      const c = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        aJar[v] = jar;
        aWax[v] = glowable;
        c[v * 3] = col.r; c[v * 3 + 1] = col.g; c[v * 3 + 2] = col.b;
      }
      g.setAttribute('aJar', new THREE.BufferAttribute(aJar, 1));
      g.setAttribute('aWax', new THREE.BufferAttribute(aWax, 1));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };

    let waxGeo;
    if (J.tipped) {
      // The stub in the fallen jar has slid down against the wall it is lying
      // on. Built lying down in jar space rather than tipped with the jar, so
      // its own axis stays with the jar's and it simply rests off centre.
      waxGeo = new THREE.LatheGeometry(candleProfile(rIn, J.waxTop), Math.round(AROUND * 0.7));
      waxGeo.translate(rIn * 0.20, 0, 0);
    } else {
      waxGeo = new THREE.LatheGeometry(candleProfile(rIn, J.waxTop), Math.round(AROUND * 0.7));
    }
    waxParts.push(tag(waxGeo, i, 1, waxCol));

    // Two millimetres of dark, and it matters: without it the flame floats a
    // hair above the wax and the whole thing goes to plastic.
    const wickGeo = new THREE.CapsuleGeometry(0.0021, 0.0075, 3, 8);
    const wm = new THREE.Matrix4()
      .makeRotationZ(J.lit ? 0.2 : 0.9)
      .setPosition(J.tipped ? rIn * 0.20 : 0, J.waxTop + 0.001, 0);
    wickGeo.applyMatrix4(wm);
    waxParts.push(tag(wickGeo, i, 0, wickCol));
  });
  waxParts.forEach((g, k) => g.applyMatrix4(placed[Math.floor(k / 2)].m));
  const waxGeo = mergeGeometries(waxParts, false);
  for (const g of waxParts) g.dispose();

  const waxMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.76,
    metalness: 0.0,
    // Wax is translucent and a lit candle glows through its own top centimetre.
    // Cheap stand-in for subsurface: a warm emissive riding that jar's flame,
    // gated by aWax so the wick stays dark.
    emissive: new THREE.Color('#c8712a'),
    emissiveIntensity: 1.0,
  });
  const waxUniforms = { uGlow: { value: placed.map(() => 0) } };
  waxMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waxUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aJar;
attribute float aWax;
uniform float uGlow[${n}];
varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGlow = uGlow[int(aJar + 0.5)] * aWax;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vGlow;');
  };
  const wax = new THREE.Mesh(waxGeo, waxMat);
  // The one caster on the prop, and it is the only thing holding the cluster
  // to the ground. Glass must never cast (a shadow map has no idea it is
  // transparent), and with the glass out of the shadow pass NOTHING here casts
  // and four jars sit a millimetre above the floor. The stubs of wax are opaque
  // and they very nearly fill their jars, so their shadow is the jar's shadow
  // to within a wall thickness, thrown by the key at the same angle as every
  // other prop's. It costs one draw call in the shadow pass and none in the
  // main one.
  wax.castShadow = true;
  wax.receiveShadow = true;

  // --- flames --------------------------------------------------------------
  // A teardrop widest a third of the way up, in two shells: a core bright enough
  // that ACES clips it to white, and a soft halo doing the job a bloom pass
  // would if this project had one.
  //
  // InstancedMesh rather than a mesh per flame, and that is the other half of
  // the draw call budget. Three flames that lean, stretch and change colour
  // independently is exactly per-instance matrix and per-instance colour, so
  // three visible flames cost two draw calls instead of six.
  const lit = placed.filter((J) => J.lit);
  const flameProfile = (amp, hgt) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push(new THREE.Vector2(amp * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 1.3), hgt * t));
    }
    return pts;
  };
  const coreGeo = new THREE.LatheGeometry(flameProfile(0.0115, 0.041), 20);
  const haloGeo = new THREE.LatheGeometry(flameProfile(0.026, 0.058), 20);
  // A vertical gradient baked into the core, and it is the fix for the one
  // thing that was wrong with copying the ground lantern's flame straight
  // across. A single flat emissive colour bright enough for ACES to clip it is
  // clipped EVERYWHERE, so the flame comes out as a white paper cone with a
  // hard silhouette and no inside. A real one is dim and deeply orange down at
  // the wick and only saturates to white in its upper body, so the ramp is
  // baked per vertex and multiplied by the instance colour that carries the
  // flicker. Same one draw call, and the flame gets a middle.
  {
    const pos = coreGeo.attributes.position.array;
    const c = new Float32Array(coreGeo.attributes.position.count * 3);
    for (let v = 0; v < coreGeo.attributes.position.count; v++) {
      const u = pos[v * 3 + 1] / 0.041;
      const t = Math.min(1, Math.max(0, (u - 0.06) / 0.46));
      const k = t * t * (3 - 2 * t);
      c[v * 3] = 0.30 + 0.70 * k;
      c[v * 3 + 1] = 0.09 + 0.91 * k;
      c[v * 3 + 2] = 0.03 + 0.97 * k;
    }
    coreGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: true });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,          // the level rides the instance colour instead, so
    depthWrite: false,     // that three additive shells can differ in one call
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  // The halo darkened toward its own silhouette, which is what turns an
  // additive shell into a glow. Drawn flat, a closed shell adds its front and
  // its back everywhere and so has a hard outline exactly where a glow should
  // be faintest; scaled by how square-on the surface is, the brightness follows
  // the chord through the shape and the edge dissolves. The camera in this
  // scene is orthographic, so the view direction is constant and the whole term
  // is the view-space normal's z.
  haloMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vNdv;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n  vNdv = abs(normalize(transformedNormal).z);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNdv;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= pow(vNdv, 0.85);');
  };
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, lit.length);
  const halos = new THREE.InstancedMesh(haloGeo, haloMat, lit.length);
  cores.frustumCulled = false;
  halos.frustumCulled = false;
  halos.renderOrder = 1;   // ahead of the glass, so the glass always composites
  for (const m of [cores, halos]) { m.castShadow = false; m.receiveShadow = false; }
  // Each flame's home: the jar's own matrix with the wick's top folded in, so
  // the flame inherits the jar's lean without ever being parented to it.
  const flameHome = lit.map((J) => J.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, J.waxTop - 0.003, 0)));
  const haloHome = lit.map((J) => J.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, J.waxTop - 0.010, 0)));

  // --- the one light -------------------------------------------------------
  // ONE PointLight for the whole cluster and it casts no shadow. Six pumpkins
  // and five lanterns already put point lights in this scene, every light is in
  // every fragment shader's loop, and four more for one small prop would be
  // indefensible. So the work is split: the flame cores, the halos, the wash on
  // the inside of each glass and the glow through each stub of wax are all per
  // jar and do the near work, and this single light does nothing but the pool
  // on the ground.
  //
  // Where it goes is the interesting choice and it is not the middle of the
  // cluster. It sits at the LUMINOUS CENTROID of the lit flames, weighted by
  // each flame's current level, and its intensity is the SUM of what the three
  // would have contributed rather than the mean. That is what three sources
  // actually add up to in the far field, and it is worth two things a static
  // light at the centre cannot give: the pool is brighter when the flames
  // happen to peak together and dimmer when they do not, and, because the jars
  // are out of phase, the centroid WANDERS between them, so the pool slides an
  // inch or two on the ground with whichever jar is winning. A cluster whose
  // shared pool never moves is three flames pretending to be one lamp.
  //
  // Point rather than spot because that is what the objects are: open jars
  // throw light in every direction. The range is clipped short so it never
  // reaches a fragment it has no business lighting.
  const lamp = new THREE.PointLight(FLAME.clone(), 0, 2.0 * scale, 2);
  lamp.castShadow = false;

  // --- assembly ------------------------------------------------------------
  // No painted contact patch, and the ground lantern's reasoning applies here
  // twice over. It offers one in style.js and most props want it, but this prop
  // is one of the two things in the set that LIGHTS the ground it stands on: a
  // dark disc under the jars sits in the single brightest part of the floor and
  // reads as a hole punched in the light rather than as contact. Each jar
  // instead meets the ground on a real rolled base, and the pool it casts falls
  // off toward its own foot, which is the contact term.
  const group = new THREE.Group();
  group.add(glass, wax, cores, halos, lamp);
  group.scale.setScalar(scale);

  // Scratch objects, so update() allocates nothing.
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tipV = new THREE.Vector3();
  const cen = new THREE.Vector3();
  const col = new THREE.Color();
  const levels = new Array(n).fill(0);

  return {
    group,
    update(time) {
      cen.set(0, 0, 0);
      let total = 0;
      let hueSum = 0;
      let k = 0;

      for (let i = 0; i < n; i++) {
        const J = placed[i];
        if (!J.lit) { levels[i] = 0; optics.uWash.value[i] = 0; waxUniforms.uGlow.value[i] = 0; continue; }

        // Four things at once, and a flame only reads as a flame when all four
        // are running: a fine tremble that never stops, a slow wander breathing
        // under it, the rare event (a gutter that ducks hard, or a flare as the
        // flame straightens and stands up), and the flame physically moving
        // while it does the rest.
        const noise = J.noise;
        const t = time + J.phase;
        const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
        const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));

        // Tremble: this jar's own two carriers, phase dragged by its own slow
        // noise. Nothing faster than about 15 Hz, because at 60fps a 20 Hz
        // carrier is three frames to a period and comes out as sparkle.
        const [c0, c1] = CARRIERS[i];
        const tremble = 0.034 * wobble(c0, 0.6, 12.4) + 0.019 * wobble(c1, 0.9, 55.1);

        // Wander: the slow breathing underneath, over a second or two. Summed
        // noise is right here and its stalls are a feature, because a lull is
        // exactly what the slow channel is for and the tremble runs through it.
        const wander = 0.046 * swing(0.71, 0) + 0.031 * swing(2.1, 17.5);

        // Gutter. Only the top of a slow channel counts, so the events are
        // things that happen rather than a rhythm, and squaring the ramp keeps
        // the deep part brief while the onset and recovery stay soft. More
        // frequent than the ground lantern's: a jar is open at the top, so
        // these flames stand in the draught where its is behind six panes.
        const g = noise(t * 0.44 + 77.3);
        const gutter = g > 0.74 ? (g - 0.74) / 0.26 : 0;
        const dip = gutter * gutter * (0.38 + 0.28 * noise(t * 9.3 + 5.1));

        // Flare, the gutter's other half: now and then the flame straightens
        // and the jar goes pale for a second. Rarer, because a flame droops far
        // more often than it draws itself up.
        const fl = noise(t * 0.37 + 143.9);
        const flareRamp = fl > 0.81 ? (fl - 0.81) / 0.19 : 0;
        const flare = flareRamp * flareRamp * (0.12 + 0.08 * noise(t * 7.1 + 91.2));

        // A soft ceiling and not a clamp. Clamped at 1, every flare and a good
        // many ordinary peaks land flat on the ceiling and sit there. This
        // bends the top over instead, matching both value and slope at the knee
        // and asymptoting above it, so a flare is a peak with a shape on it.
        const KNEE = 0.90;
        const raw = 0.900 + tremble + wander + flare - dip;
        const level = raw <= KNEE
          ? Math.max(0, raw)
          : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));
        levels[i] = level;

        const at = (r) => r.min + (r.max - r.min) * level;
        // A guttering flame reddens as it drops and a flaring one goes whiter,
        // so the colour rides the same value rather than sitting at a fixed
        // warm white, and the flame BODY has to do it as much as the lamp does.
        const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));

        optics.uWash.value[i] = at(WASH);
        waxUniforms.uGlow.value[i] = 0.10 + 0.16 * level;

        // The flame is an object and it moves, and this is the half of the
        // effect that modulating intensity cannot reach. Moving the source
        // slides the pool, changes which side of the jar is brightest and
        // swings the wax's own shadow round the inside of the glass. Small: it
        // is a wick a centimetre down a jar, so a couple of millimetres is the
        // whole budget, and the body leans and stretches rather than sliding.
        const across = 0.0033 * (0.55 * swing(0.83, 5.5) + 0.45 * wobble(5.4, 0.5, 71.6));
        const into = 0.0028 * swing(0.61, 2.7);
        const rise = 0.0018 * swing(1.3, 8.1) + 0.009 * flare - 0.008 * dip;
        const stretch = 0.86 + 0.30 * level;

        // A flame leans FROM the wick, so the tip travels several times as far
        // as the base does: a rotation about the foot and not a translation.
        tmpE.set(into * 6.5, 0, -across * 6.5);
        tmpQ.setFromEuler(tmpE);

        tmpV.set(across, rise * 0.4, into);
        tmpS.set(0.93 + 0.12 * level, stretch, 0.93 + 0.12 * level);
        tmpM.compose(tmpV, tmpQ, tmpS);
        cores.setMatrixAt(k, tmpM.premultiply(flameHome[k]));
        col.copy(CORE_EMBER).lerp(CORE_FLAME, hue).multiplyScalar(at(CORE));
        cores.setColorAt(k, col);

        tmpV.set(across * 1.4, rise * 0.4, into * 1.4);
        tmpS.set(0.90 + 0.20 * level, 0.84 + 0.34 * level, 0.90 + 0.20 * level);
        tmpM.compose(tmpV, tmpQ, tmpS);
        halos.setMatrixAt(k, tmpM.premultiply(haloHome[k]));
        // Additive blending multiplies by alpha, and alpha is per material, so
        // the halo's level rides its colour instead. Same product, one call.
        col.copy(CORE_EMBER).lerp(CORE_FLAME, hue * 0.6).multiplyScalar(at(HALO));
        halos.setColorAt(k, col);

        // The luminous centroid, and the light rides the tip rather than the
        // foot. three has no sphere light, so a point source sitting in the wax
        // is in an inverse-square singularity and burns the whole stub to flat
        // white long before the pool on the ground is bright enough to see.
        // Lifting it to the flame's tip is the cheapest stand-in for a source
        // with a radius: it quarters the irradiance on the wax and changes the
        // pool, a hundred millimetres away, by about two per cent.
        const w = at(LAMP);
        tipV.set(0, 0.038 + rise, 0).applyMatrix4(flameHome[k]);
        cen.addScaledVector(tipV, w);
        total += w;
        hueSum += hue * w;
        k++;
      }

      if (total > 0) {
        lamp.position.copy(cen).divideScalar(total);
        lamp.intensity = total * scale;
        lamp.color.copy(EMBER).lerp(FLAME, hueSum / total);
      } else {
        lamp.intensity = 0;
      }
      cores.instanceMatrix.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
      if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
      if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const g of [glassGeo, waxGeo, coreGeo, haloGeo]) g.dispose();
      for (const m of [glassMat, waxMat, coreMat, haloMat]) m.dispose();
      cores.dispose();
      halos.dispose();
      group.traverse((o) => { o.userData.dispose?.(); });
      group.clear();
    },
  };
}
