import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS, contactShadow } from '../style.js';

// A ground candle lantern: the small squat one that is left standing on the
// earth beside a headstone. A glazed hexagon in a fat rounded frame, a domed
// cap with a ring handle, and a stub candle burning inside it.
//
// Three things decided the whole build.
//
// SIZE. It is the smallest of the five lanterns and it has to stay small next
// to a headstone, so it is 0.35 units to the top of its handle and about 0.25
// across, against a cross tombstone at 1.56 and a ghost at 1.6. That is a
// little under knee height on the figure. Everything below is authored at that
// size, which is why the radii are in the tenths and the fillets in the
// thousandths: a fillet you cannot see is a fillet that is not there, and at
// this scale the frame's tube radius (0.015) is a sixth of the body's radius.
// The same shape drawn at a fence post's scale would look like a balloon.
//
// ONE SURFACE GENERATOR. The base, the two rails, the glazing and the cap are
// all the same thing: a profile in (radius, height) swept round a ROUNDED
// hexagon rather than round a circle. See `hexR` and `revolveHex`. A hexagonal
// lantern assembled from six flat panes and twelve mitred corners is a faceted
// lantern, and style.js has no facets in it. Sweeping one profile gives a body
// whose corners are soft by construction and whose normals are continuous the
// whole way round, and it costs one cosine per vertex.
//
// GLASS WITH NOTHING TO REFLECT. This scene has no environment map, so a
// physically-correct transmissive material would be a clear pane showing you
// the grey floor and nothing else. The glazing borrows the fountain's answer
// (src/ghost/props/fountain/water.js, the fake optics block): a three band
// procedural sky sampled off the reflected normal, a Schlick fresnel deciding
// how much of it you see, and one tight specular lobe for the key light,
// composited over the pane's own transparency in `opaque_fragment` so the
// highlights are not faded out along with the body. On top of that the pane
// carries the candle's wash on its inside face and a little soot toward the
// cap, both riding the flame, which is the half of "lit from within" that no
// reflection model can give you.

// ---------------------------------------------------------------------------
// dimensions
//
// All in world units, base at y = 0, origin at the centre of the footprint.

const H = {
  baseTop: 0.038,      // the floor the candle stands on
  railLo: 0.046,       // centre of the bottom rail
  railHi: 0.198,       // centre of the top rail
  glassLo: 0.032,
  glassHi: 0.210,
  capSeat: 0.220,      // underside of the cap
  capTop: 0.286,
  ring: 0.310,         // centre of the handle ring
};

const R = {
  base: 0.096,         // apothem of the foot before its roll
  glass: 0.082,        // apothem of the glazing at the ends of the barrel
  bulge: 0.006,        // extra apothem at the waist
  rail: 0.092,         // apothem the rails' centreline follows
  tube: 0.015,         // rail and post section
  post: 0.098,         // corner radius the posts stand on
  cap: 0.100,          // apothem of the cap before its roll
  ringMajor: 0.030,
  ringTube: 0.010,
};

// How sharp the hexagon is. See `hexR`: at 10 the corners land about 7.5% out
// from the flats where a true hexagon's would be 15.5%, so it is halfway to a
// circle. Tuned by looking, and the direction of the error matters more than
// the number: sharper than this and the corner posts sit on a visible crease,
// which is the one thing a vinyl toy never has.
const HEX_K = 10;

// Six faces need enough steps that each flat is genuinely flat and each corner
// genuinely round. SEGMENTS.radial is sized for plain round surfaces; twelve
// steps to a face is the least that stops the corners stair-stepping.
const AROUND = 72;

// ---------------------------------------------------------------------------
// colour
//
// Nothing here invents a hue. The flame is the palette's glow, the ironwork is
// the palette's stone taken well down and pulled toward the blue the scene's
// rim light already puts in every shadow, and the glass sits in the same pale
// cool register as the fountain's water.

// Iron. Fat and soft rather than wrought: high roughness, no metalness at all,
// exactly like every other surface in the set. What makes it read as metal is
// that it is much darker than the stone beside it, not that it is shiny.
const IRON = new THREE.Color(PALETTE.stone).multiplyScalar(0.46)
  .lerp(new THREE.Color('#3b4452'), 0.42);

// The glazing's own tint, a shade paler and greener than the fountain's
// #93b2c6 because a pane is a millimetre of glass where a bowl is centimetres
// of water.
const GLASS_TINT = '#a6c1cd';

// Wax. Warm off white, and deliberately not the palette's stone: wax beside
// stone should read as the warmer of the two even before the candle is lit.
const WAX = '#efe4cd';

// The flame's two ends, the same pair the pumpkin uses so the two candles in
// this scene are the same fire. Converted by hand because these are a light's
// colour, which three does not colour-manage.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// And again for the flame body, which is a material rather than a light. Set
// well above 1 on purpose: ACES rolls a bright emissive off toward white, and
// a flame that does not clip its core reads as an orange jelly bean.
const CORE_EMBER = new THREE.Color('#ff8a30');
const CORE_FLAME = new THREE.Color('#ffd08a');

// ---------------------------------------------------------------------------
// the rounded hexagon
//
// A convex polygon's boundary in polar form is 1 / max_i(cos(t - phi_i) / a),
// with phi_i the face normals and a the apothem. Swap the max for a soft max
// (log sum exp) and the corners round off smoothly, with a derivative that is
// continuous everywhere, which is what the normals below are differenced from.
// A blend between a hexagon and a circle would not do: it rounds the FLATS as
// much as the corners, and the flats are the whole point of a glazed box.

function hexR(theta, k = HEX_K) {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Math.exp(k * Math.cos(theta - (i * Math.PI) / 3));
  return k / Math.log(sum);
}

// Where the corners are. The face normals sit at 0, 60, ... so the corners sit
// halfway between, and this is the radius the posts stand on.
const CORNER_K = hexR(Math.PI / 6);

// ---------------------------------------------------------------------------
// profiles
//
// A profile is a list of { r, y }: radius as a multiple of the apothem the
// caller asked for, and height. Built with lines and arcs so that every corner
// on this prop is a real fillet with a stated radius rather than a bevel.

class Profile {
  constructor() { this.pts = []; }

  _push(r, y) {
    const last = this.pts[this.pts.length - 1];
    // A repeated point is a zero-length profile tangent and a NaN normal.
    if (last && Math.abs(last.r - r) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
    this.pts.push({ r, y });
  }

  moveTo(r, y) { this._push(r, y); return this; }

  lineTo(r, y, steps = 2) {
    const a = this.pts[this.pts.length - 1] || { r, y };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._push(a.r + (r - a.r) * t, a.y + (y - a.y) * t);
    }
    return this;
  }

  // Angles in degrees, measured in the (r, y) plane: 0 points out along r,
  // 90 points up.
  arc(cr, cy, rad, a0, a1, steps = 8) {
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180;
      this._push(cr + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
    return this;
  }

  // An arbitrary function of the run parameter, for the barrel on the glazing.
  curve(fn, steps) {
    for (let i = 1; i <= steps; i++) {
      const p = fn(i / steps);
      this._push(p.r, p.y);
    }
    return this;
  }
}

// Sweep a profile round the rounded hexagon.
//
// Normals are taken by differencing the surface itself, twice: once around
// (analytically, at half a step either side) and once along the profile
// (against the neighbouring rows). Nothing is left for computeVertexNormals,
// which would crease the seam and facet the poles, and differencing the real
// surface means the shading cannot disagree with the shape however hard the
// corners pinch.
function revolveHex(profile, { segments = AROUND, closedV = false, k = HEX_K } = {}) {
  const pts = profile.pts;
  const n = pts.length;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const d = (Math.PI * 2) / segments / 2;

  const at = (j, th) => {
    const p = pts[j];
    const rr = p.r * hexR(th, k);
    return [rr * Math.cos(th), p.y, rr * Math.sin(th)];
  };

  const nrm = new THREE.Vector3();
  const tu = new THREE.Vector3();
  const tv = new THREE.Vector3();

  for (let j = 0; j < n; j++) {
    const j0 = closedV ? (j - 1 + n) % n : Math.max(0, j - 1);
    const j1 = closedV ? (j + 1) % n : Math.min(n - 1, j + 1);
    for (let i = 0; i < segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      const p = at(j, th);
      pos.push(p[0], p[1], p[2]);
      uv.push(i / segments, n > 1 ? j / (n - 1) : 0);

      const a = at(j, th - d);
      const b = at(j, th + d);
      tu.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const c = at(j0, th);
      const e = at(j1, th);
      tv.set(e[0] - c[0], e[1] - c[1], e[2] - c[2]);
      // Outward: with theta running x toward z and the profile running upward,
      // tv cross tu points away from the axis.
      nrm.crossVectors(tv, tu);
      if (nrm.lengthSq() < 1e-18) {
        // A pole, where the ring has collapsed and there is no tangent around
        // to cross with. Cap it with the axis.
        nrm.set(0, j === 0 ? -1 : 1, 0);
      } else {
        nrm.normalize();
      }
      nor.push(nrm.x, nrm.y, nrm.z);
    }
  }

  const rows = closedV ? n : n - 1;
  for (let j = 0; j < rows; j++) {
    const jn = (j + 1) % n;
    for (let i = 0; i < segments; i++) {
      const inx = (i + 1) % segments;
      const a = j * segments + i;
      const b = jn * segments + i;
      const c = jn * segments + inx;
      const e = j * segments + inx;
      idx.push(a, b, c, a, c, e);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// the parts
//
// Each returns a geometry already standing where it belongs, so the ironwork
// can be merged into a single draw call at the end.

// The foot. A shallow rounded pad with a half-round rim, closed at the top so
// the candle has a floor rather than a hole to sit over.
function footGeometry() {
  const p = new Profile()
    .moveTo(0, 0)
    .lineTo(R.base * 0.55, 0, 3)
    .lineTo(R.base, 0.001, 3)
    .arc(R.base, 0.013, 0.013, -90, 90, 10)
    .lineTo(R.base * 0.90, 0.032, 3)
    .lineTo(R.base * 0.62, H.baseTop, 3)
    .lineTo(0, H.baseTop, 3);
  return revolveHex(p);
}

// A rail: a circular section swept round the hexagon, so it comes out as a
// rounded hex ring that is a touch beefier at the corners than along the
// flats, which is where a real one would carry its weld.
function railGeometry(y) {
  const p = new Profile();
  const steps = 18;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    p._push(R.rail + R.tube * Math.cos(a), y + R.tube * Math.sin(a));
  }
  return revolveHex(p, { segments: AROUND, closedV: true });
}

// The cap: a rolled lip over the frame and a soft dome above it. The lip
// overhangs the rails by about a tube radius, which is what stops the cap
// reading as a lid balanced on top and starts it reading as a roof.
function capGeometry() {
  const p = new Profile()
    .moveTo(0, H.capSeat + 0.002)
    .lineTo(R.cap * 0.60, H.capSeat, 4)
    .lineTo(R.cap, H.capSeat, 3)
    .arc(R.cap, H.capSeat + 0.014, 0.014, -90, 55, 10);
  // The dome, a quarter ellipse off the top of the roll. Sampled rather than
  // arced because its shoulder wants to be softer than a circle's.
  const y0 = H.capSeat + 0.014 + 0.014 * Math.sin((55 * Math.PI) / 180);
  const r0 = R.cap + 0.014 * Math.cos((55 * Math.PI) / 180);
  p.curve((t) => {
    const a = (t * Math.PI) / 2;
    return { r: r0 * Math.pow(Math.cos(a), 0.78), y: y0 + (H.capTop - y0) * Math.sin(a) };
  }, 16);
  return revolveHex(p);
}

// ---------------------------------------------------------------------------
// glass
//
// The fountain's fake optics, cut down to what a pane needs. Everything here
// is one cosine ramp and two power functions; there is no texture fetch and no
// second scene pass. `viewMatrix`, `cameraPosition` and `isOrthographic` all
// come from three's own fragment prefix.

const GLASS_PARS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uInnerCol;
uniform float uInner;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
uniform float uSoot;
varying vec3 vGlassP;
varying float vGlassY;

vec3 viewToWorld(vec3 v) {
  return vec3(dot(v, viewMatrix[0].xyz), dot(v, viewMatrix[1].xyz), dot(v, viewMatrix[2].xyz));
}

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands and not two, for the reason water.js gives: a pane seen side on
// reflects almost horizontally, so its rim samples the horizon and nothing
// else, and a two colour ramp puts a DARK outline round a piece of glass.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with soda glass's F0, which is 0.04 rather than water's 0.02. Twice
// as reflective face on, and at the elevation this scene is shot from that is
// still almost nothing: the rim is where all the shine lives.
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

// The composite, in the order light meets the pane: what bounces off the
// outside, and what comes through from the candle and the floor behind.
//
//   A  how much of what is behind the pane the pane hides. Small, because glass
//      is clear, and bigger at a glancing angle because the chord through it is
//      longer there.
//   F  how much the pane reflects. Schlick, so it is a few per cent face on and
//      most of the light at the silhouette.
//
// Composited as `over` and NOT through an opacity slider, which is the classic
// way to lose this: the fresnel rim gets computed correctly and then faded out
// along with the body it was supposed to stand clear of.
const GLASS_FRAG = `
  vec3 wN = viewToWorld(normal);
  vec3 wV = worldViewDir(vGlassP);
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);

  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0);
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * sunGlint(wN, wV, uShine));

  // The candle on the inside face. Strongest low down where the flame is and
  // dying off toward the cap, and warmer at a glancing angle for the same
  // reason A is bigger there: more glass to glow through.
  float lit = exp(-9.0 * max(vGlassY - 0.15, 0.0)) * (0.55 + 0.45 * (1.0 - ndv));
  // Soot. A candle lantern's panes are dirtiest where the smoke collects, just
  // under the cap, and this is most of what stops the glazing reading as a
  // clean plastic bottle.
  float soot = uSoot * smoothstep(0.14, 0.21, vGlassY);

  vec3 body = outgoingLight * (1.0 - 0.75 * soot) + uInnerCol * (uInner * lit);
  float A = clamp(mix(uBodyA, uBodyA * 2.4, 1.0 - ndv) + 0.55 * soot, 0.0, 1.0);

  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
  if (uShine > 9000.0) gl_FragColor = vec4(A, F, a, 1.0);
`;

// ---------------------------------------------------------------------------
// flicker
//
// Lifted wholesale from the pumpkin, because the two are the same candle and
// nothing about this one earns a different fire. The two findings that shaped
// it are worth restating where they will be read:
//
// SUMMED VALUE NOISE STALLS. Smoothstep interpolation is flat at every lattice
// node, so a channel at f Hz stands still f times a second by construction, and
// three of them summed just gives three sets of stalls that sometimes line up.
// Measured on the pumpkin's second pass, 30% of frames moved by less than 0.002
// and the light visibly froze. The tremble here is therefore two sine carriers
// inside the 5..15 Hz band a candle flutters in, whose PHASE is dragged about
// by slow noise: the flutter has a frequency, and what wanders is where in the
// cycle it has got to. Frequency modulated like that it never stalls and never
// repeats, where the bare sine under it would read as a hum.
//
// A HARD CLAMP PINS EVERY FLARE FLAT. Clamped at 1, every flare and a good many
// ordinary peaks land on the ceiling and sit there, which is a light with no
// top end at all. The knee below matches value and slope and then asymptotes,
// so a flare comes out as a peak with a shape on it.
//
// Value noise is still right for the slow wander and for the gutter and flare
// gates, where a stall is a lull and a lull is the point.

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

// What each thing driven by the flame looks like at the bottom and the top of
// its swing. All of them ride the one level, which is the whole trick: a lamp
// that dims while the flame body and the pane's inner wash hold still reads as
// a dimmer being turned down in another room.
//
// The lamp's absolute level is a stylistic call and worth naming as one. A real
// candle behind glass, against a floor lit like noon by the hemisphere and key
// in main.js, throws light you cannot see at all. This is what makes the
// lantern read as a lantern in THIS scene's light. The 2.2 : 1 ratio between
// the ends is the pumpkin's and is the part that is not stylistic.
const LAMP = { min: 1.05, max: 2.30 };
const CORE = { min: 1.70, max: 3.60 };   // flame body, above 1 so ACES clips it
const HALO = { min: 0.20, max: 0.46 };   // the soft shell around it
const WASH = { min: 0.55, max: 1.35 };   // the candle on the inside of the pane

// How the flame's colour is mixed between ember and flame. Levered about the
// level's own mean rather than fed the level straight, because the level lives
// in the top eighth of its range: fed straight through, ember is reachable only
// in a gutter deep enough to have put the candle out.
const HUE_MID = 0.88;
const HUE_GAIN = 1.5;

// ---------------------------------------------------------------------------

export function createGroundLantern({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: five lanterns off one shelf, not five
  // different lanterns. A turn about the axis so two of them never present the
  // same corner, a degree or so of lean because the ground is earth and not a
  // table, and a candle that has burnt down by a different amount.
  const spin = rand() * Math.PI * 2;
  const leanDir = rand() * Math.PI * 2;
  const lean = (0.010 + rand() * 0.016);
  const burn = 0.68 + rand() * 0.30;      // how much of the stub is left
  const flickerPhase = rand() * 100;

  // --- ironwork ------------------------------------------------------------
  // Foot, two rails, six posts, cap, finial knob and the ring handle, all one
  // material and therefore all one draw call.
  const iron = [];
  iron.push(footGeometry());
  iron.push(railGeometry(H.railLo));
  iron.push(railGeometry(H.railHi));

  const postLen = H.railHi - H.railLo;
  // Capsule rather than a cylinder with two spheres: one surface, no seam, and
  // the cap is a real hemisphere so the post reads as a soft rod. This is the
  // bath toy handle the house style asks for and not wrought iron.
  const post = new THREE.CapsuleGeometry(R.tube, postLen, 6, 20);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const g = post.clone();
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(
      R.post * CORNER_K * Math.cos(a),
      H.railLo + postLen / 2,
      R.post * CORNER_K * Math.sin(a),
    ));
    iron.push(g);
  }
  post.dispose();

  iron.push(capGeometry());

  // The finial the handle is hung from. Squashed, because a sphere on a dome
  // reads as a bead sitting on it rather than as part of the same casting.
  const knob = new THREE.SphereGeometry(0.017, 24, 16);
  knob.scale(1, 0.78, 1);
  knob.translate(0, H.capTop + 0.004, 0);
  iron.push(knob);

  // The ring. Standing in a vertical plane with its bottom buried in the knob,
  // so it hangs off the finial rather than floating above it.
  const ring = new THREE.TorusGeometry(R.ringMajor, R.ringTube, 14, 44);
  ring.translate(0, H.ring, 0);
  iron.push(ring);

  const ironGeo = mergeGeometries(iron, false);
  for (const g of iron) g.dispose();
  const ironMat = new THREE.MeshStandardMaterial({
    color: IRON,
    // Lower than the house 0.82. Iron under a coat of enamel is the one thing
    // on this prop allowed a broad soft highlight, and without it the frame
    // goes flat black against the glass.
    roughness: 0.58,
    metalness: 0.0,
  });
  const ironMesh = new THREE.Mesh(ironGeo, ironMat);

  // --- candle --------------------------------------------------------------
  // A stub with a rounded shoulder and a dished top, standing in its own small
  // pool of run wax. Round, not hexagonal: it is the one part of this prop that
  // was not cast in the same mould as the box.
  const waxTop = H.baseTop + 0.030 + 0.052 * burn;
  const candleProfile = [];
  {
    const push = (r, y) => candleProfile.push(new THREE.Vector2(r, y));
    push(0, H.baseTop);
    push(0.050, H.baseTop);
    // The pool of run wax at the foot, which is what makes it a candle that has
    // been burning rather than one just set down.
    for (let i = 0; i <= 6; i++) {
      const a = (-90 + 90 * (i / 6)) * Math.PI / 180;
      push(0.044 + 0.006 * Math.cos(a), H.baseTop + 0.007 + 0.007 * Math.sin(a));
    }
    push(0.040, waxTop - 0.012);
    // Shoulder and the melted well in the top.
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI / 2;
      push(0.040 * Math.cos(a) * 0.86 + 0.040 * 0.14 * Math.cos(a * 0.5), waxTop - 0.012 + 0.012 * Math.sin(a));
    }
    push(0.012, waxTop - 0.002);
    push(0, waxTop - 0.004);
  }
  const candleGeo = new THREE.LatheGeometry(candleProfile, SEGMENTS.radial);
  candleGeo.computeVertexNormals();
  const candleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(WAX),
    roughness: 0.72,
    metalness: 0.0,
    // Wax is translucent and a lit candle glows through its own top centimetre.
    // Cheap stand-in for subsurface: a warm emissive that rides the flame.
    emissive: new THREE.Color('#c8712a'),
    emissiveIntensity: 0.22,
  });
  const candle = new THREE.Mesh(candleGeo, candleMat);

  // --- flame ---------------------------------------------------------------
  // A teardrop, widest a third of the way up. Two shells: a core bright enough
  // that ACES clips it to white, and a soft halo round it doing the job a bloom
  // pass would if this project had one.
  const flameBase = waxTop - 0.004;
  const flameProfile = (amp, hgt) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(new THREE.Vector2(amp * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 1.3), hgt * t));
    }
    return pts;
  };
  const coreGeo = new THREE.LatheGeometry(flameProfile(0.0135, 0.048), 20);
  const haloGeo = new THREE.LatheGeometry(flameProfile(0.030, 0.070), 20);
  const coreMat = new THREE.MeshBasicMaterial({ color: CORE_FLAME.clone(), toneMapped: true });
  const haloMat = new THREE.MeshBasicMaterial({
    color: CORE_EMBER.clone(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  core.position.y = flameBase;
  halo.position.y = flameBase - 0.008;
  // Ahead of the glazing in the transparent pass, so the pane always composites
  // over the flame and never the other way about.
  halo.renderOrder = 1;

  // The wick. Two millimetres of dark, and it matters: without it the flame
  // floats a hair above the wax and the whole thing goes to plastic.
  const wickGeo = new THREE.CapsuleGeometry(0.0022, 0.008, 3, 8);
  const wickMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2118'), roughness: 0.9 });
  const wick = new THREE.Mesh(wickGeo, wickMat);
  wick.position.set(0, flameBase + 0.002, 0);
  wick.rotation.z = 0.18;

  // --- glazing -------------------------------------------------------------
  const glassProfile = new Profile()
    .moveTo(0, H.glassLo)
    .lineTo(R.glass * 0.85, H.glassLo, 3)
    .arc(R.glass * 0.85, H.glassLo + 0.012, 0.012, -90, 0, 6);
  {
    const y0 = H.glassLo + 0.012;
    const y1 = H.glassHi - 0.012;
    const r0 = R.glass * 0.85 + 0.012;
    // A barrel of six thousandths over eighteen hundredths. Almost nothing, and
    // it is the difference between a pane and a slab: the highlight travels
    // across the flat as the camera moves instead of switching on and off.
    glassProfile.curve((t) => ({
      r: r0 + R.bulge * Math.sin(Math.PI * t),
      y: y0 + (y1 - y0) * t,
    }), 22);
  }
  glassProfile
    .arc(R.glass * 0.85, H.glassHi - 0.012, 0.012, 0, 90, 6)
    .lineTo(0, H.glassHi, 3);
  const glassGeo = revolveHex(glassProfile);

  // Still a plain MeshStandardMaterial and still no transmission: a refractive
  // material drags a render target and a second scene pass behind it and would
  // light the glass out of register with the iron beside it. The shader takes
  // over the last line instead and composites its own reflection and its own
  // transparency over three's shading.
  //
  // FrontSide, and that is deliberate. A closed shell drawn front only is one
  // layer of glass between the eye and the candle: you see through it once,
  // cleanly, with no sorting to get wrong. Drawn DoubleSide the near and far
  // panes composite in whatever order the triangles happen to arrive in and the
  // tint crawls as the camera turns.
  const glassUniforms = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e, so a reflection
    // that leaves the pane going up finds the first and one going down finds
    // the second. Linear, because this is composited before tone mapping.
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#868b95').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    uInnerCol: { value: new THREE.Color(PALETTE.glow).convertSRGBToLinear() },
    uInner: { value: 0.9 },
    // How much of the fresnel to believe. Physically 1.0; over one because the
    // fake sky is a flat gradient with no bright spots of its own to find, so
    // the reflection needs the help to register at all.
    uRimGain: { value: 1.9 },
    uGlint: { value: 1.15 },
    uShine: { value: 99999.0 },
    // How much of what is behind the pane the pane hides, face on.
    uBodyA: { value: 0.13 },
    uSoot: { value: 0.34 },
  };
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS_TINT),
    roughness: 0.16,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassP;\nvarying float vGlassY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGlassY = position.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_PARS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 2;

  // --- the one light -------------------------------------------------------
  // A point light and nothing else. Six pumpkins already put six point lights
  // in this scene and every light is in every fragment shader's loop, so this
  // prop gets one, it casts no shadow, and its range is clipped short enough
  // that it never reaches a fragment it has no business lighting.
  //
  // Point rather than spot because that is what the object is: a candle inside
  // clear glass throws light in every direction, and the only thing a cone
  // could add here is the cap's shadow on the ground, which is a black ring the
  // size of a coin.
  const lamp = new THREE.PointLight(FLAME.clone(), 0, 2.4 * scale, 2);
  lamp.position.set(0, flameBase + 0.022, 0);
  lamp.castShadow = false;

  // --- assembly ------------------------------------------------------------
  const body = new THREE.Group();
  body.add(ironMesh, candle, wick, core, halo, glass, lamp);

  const group = new THREE.Group();
  // The contact term the key light's angled shadow cannot give: at this size
  // the cast shadow lands entirely outside the footprint and nothing darkens
  // the earth where the foot actually meets it.
  group.add(contactShadow({ radius: 0.20, opacity: 0.38, softness: 0.5 }));
  group.add(body);
  body.rotation.y = spin;
  // Lean, applied about the foot so the pad stays in the ground.
  body.rotation.x = Math.cos(leanDir) * lean;
  body.rotation.z = Math.sin(leanDir) * lean;
  group.scale.setScalar(scale);

  const lampHome = lamp.position.clone();
  const coreHome = core.position.clone();
  const haloHome = halo.position.clone();

  return {
    group,
    update(time) {
      // Four things at once, and the flame only reads as a flame when all four
      // are running: a fine tremble that never stops, a slow wander breathing
      // under it, the rare event (a gutter that ducks hard or a flare as the
      // flame straightens and stands up), and the flame physically moving while
      // it does the rest.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));

      // Tremble: two carriers in the 5..15 Hz band, phase dragged by slow
      // noise. Nothing faster, because at 60fps a 20 Hz carrier is three frames
      // to a period and comes out as sparkle rather than as tremble. This
      // lantern's flame stands in still air behind glass, so both carriers are
      // a shade gentler than the pumpkin's open one.
      const tremble = 0.030 * wobble(6.9, 0.6, 12.4) + 0.017 * wobble(12.1, 0.9, 55.1);

      // Wander: the slow breathing underneath, over a second or two. Summed
      // noise is right here and its stalls are a feature: a lull is exactly
      // what the slow channel is for, and the tremble runs on through it.
      const wander = 0.044 * swing(0.71, 0) + 0.030 * swing(2.1, 17.5);

      // Gutter. Only the top of a slow channel counts, so the events are things
      // that happen rather than a rhythm, and squaring the ramp keeps the deep
      // part brief while the onset and recovery stay soft. Rarer than the
      // pumpkin's, because glass on all six sides is what a lantern is FOR.
      const g = noise(t * 0.41 + 77.3);
      const gutter = g > 0.78 ? (g - 0.78) / 0.22 : 0;
      const dip = gutter * gutter * (0.36 + 0.26 * noise(t * 9.3 + 5.1));

      // Flare, the gutter's other half: now and then the flame straightens and
      // the whole box goes pale for a second. Rarer still, because a flame
      // droops far more often than it draws itself up.
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.82 ? (fl - 0.82) / 0.18 : 0;
      const flare = flareRamp * flareRamp * (0.11 + 0.07 * noise(t * 7.1 + 91.2));

      // A soft ceiling and not a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the ceiling and sit there. This bends
      // the top over instead, matching both value and slope at the knee and
      // asymptoting above it, so a flare is a peak with a shape on it.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const at = (range) => range.min + (range.max - range.min) * level;

      // A guttering flame reddens as it drops and a flaring one goes whiter, so
      // the colour rides the same value rather than sitting at a fixed warm
      // white, and the flame BODY has to do it as much as the lamp does.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));

      lamp.intensity = at(LAMP) * scale;
      lamp.color.copy(EMBER).lerp(FLAME, hue);

      const cIntensity = at(CORE);
      coreMat.color.copy(CORE_EMBER).lerp(CORE_FLAME, hue).multiplyScalar(cIntensity);
      haloMat.color.copy(CORE_EMBER).lerp(CORE_FLAME, hue * 0.6);
      haloMat.opacity = at(HALO);
      candleMat.emissiveIntensity = 0.14 + 0.20 * level;
      glassUniforms.uInner.value = at(WASH);

      // The flame is an object and it moves, and this is the half of the effect
      // that modulating intensity cannot reach. Moving the source slides the
      // pool on the ground, changes which pane is brightest and swings the
      // frame's own shadow across the glass. Small: it is a wick in still air
      // inside a box, so a couple of millimetres is the whole budget, and the
      // body leans and stretches rather than sliding rigidly.
      const across = 0.0035 * (0.55 * swing(0.83, 5.5) + 0.45 * wobble(5.4, 0.5, 71.6));
      const into = 0.0030 * swing(0.61, 2.7);
      // Up on a flare, down in a gutter, plus a fine bob: a flame that stands
      // up is a flame reaching higher, and one starved of air sinks back.
      const rise = 0.0020 * swing(1.3, 8.1) + 0.010 * flare - 0.009 * dip;
      const stretch = 0.86 + 0.30 * level;

      core.position.set(coreHome.x + across, coreHome.y + rise * 0.4, coreHome.z + into);
      core.scale.set(0.93 + 0.12 * level, stretch, 0.93 + 0.12 * level);
      // A flame leans from the wick, so the tip travels several times as far as
      // the base does: that is a rotation about the foot and not a translation.
      core.rotation.set(into * 6.5, 0, -across * 6.5);
      halo.position.set(haloHome.x + across * 1.4, haloHome.y + rise * 0.4, haloHome.z + into * 1.4);
      halo.scale.set(0.90 + 0.20 * level, 0.84 + 0.34 * level, 0.90 + 0.20 * level);
      halo.rotation.copy(core.rotation);
      lamp.position.set(lampHome.x + across * 2.0, lampHome.y + rise, lampHome.z + into * 2.0);
    },
    dispose() {
      for (const g of [ironGeo, candleGeo, coreGeo, haloGeo, wickGeo, glassGeo]) g.dispose();
      for (const m of [ironMat, candleMat, coreMat, haloMat, wickMat, glassMat]) m.dispose();
      group.traverse((o) => { o.userData.dispose?.(); });
      group.clear();
    },
  };
}
