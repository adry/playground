import * as THREE from 'three';
import { toyMaterial } from '../style.js';

// The shared foliage system: the palette every plant in the graveyard is
// coloured from, the lumpy-blob primitive they are all built out of, and the
// wind that moves them.
//
// Everything here is written so that a second, third and fourth plant can be
// composed from it without touching this file. A plant is:
//
//   1. one or more geometries built from blobGeometry() (a closed lumpy dome,
//      fitted to a real size) and mergeLumps() (many small placed lumps, one
//      draw call, one wind phase per lump);
//   2. bakeFoliageTint() on each, which paints the crevice and sky-exposure
//      darkening this scene's lighting cannot find on its own;
//   3. bakeWind() on each, which writes the per-vertex aWind attribute: the
//      height stiffness that makes the plant hinge at the ground, its exact
//      derivative for the normal, the flutter weight and the clump phase;
//   4. a foliageMaterial() per mesh, then attachWind() on each mesh, which
//      patches the beauty material AND the depth and distance materials with
//      the same displacement;
//   5. updateWind(time) once a frame from the prop's update().
//
// One material per mesh: attachWind writes onBeforeCompile and a cache key onto
// the material it is given, so two meshes sharing one material would share one
// set of sway parameters and the second call would quietly win.
//
// The wind is global on purpose. Bushes standing next to each other in the same
// gust have to lean at the same moment or the yard reads as a room full of
// people fidgeting rather than as a windy afternoon, so uTime, the direction,
// the gust rates and the strength live in one uniform block shared by reference
// across every foliage material in the scene. Only amplitude-type knobs (how
// far this plant bends, how loose its outer clumps are) are per material.

// --- palette ---------------------------------------------------------------
//
// style.js has no green in it, so this is the set's foliage colour and it is
// chosen to sit with PALETTE.stone (#b9b6b1) rather than against it. A cemetery
// yew is not a lawn: it is dark, dry and grey-shifted, closer to slate with a
// green cast than to anything that would read as spring. Saturation is kept
// under 25% so that under ACES tone mapping and a warm key it lands as "dark
// evergreen" rather than the acid green a saturated mid-green becomes when it
// is lit at 2.1 intensity.
export const FOLIAGE = {
  deep: '#333d31',    // the mass, seen only through the gaps, nearly always shaded
  mid: '#47543c',     // the outer clumps
  light: '#63704f',   // sun-facing clump crowns, reached through the vertex tint
  stem: '#4a443a',    // woody bits, for whatever wants them later
};

// Matte and dry. Rougher than style.js's 0.82 default: foliage has no broad
// highlight at all, and at 0.82 the key put a soft sheen across the top of the
// dome that made it read as a rubber ball.
export function foliageMaterial(color, options = {}) {
  return toyMaterial(color, {
    roughness: 0.95,
    vertexColors: true,
    dithering: true,   // a dark near-flat surface bands badly without it
    ...options,
  });
}

// --- small local rng -------------------------------------------------------
export function foliageRng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the blob primitive ----------------------------------------------------
//
// An icosphere, indexed, with a smooth radial field on it.
//
// Indexed and welded is the whole point. THREE.IcosahedronGeometry is
// non-indexed, so computeVertexNormals on it gives flat facets, which style.js
// rules out in as many words. Welding it first costs a Map lookup per vertex
// once at build time and turns the same triangles into a smooth surface.
const ICO_CACHE = new Map();
export function icosphere(detail = 3) {
  const hit = ICO_CACHE.get(detail);
  if (hit) return hit;

  const src = new THREE.IcosahedronGeometry(1, detail);
  const pos = src.getAttribute('position').array;
  const map = new Map();
  const dirs = [];
  const index = [];
  for (let i = 0; i < pos.length; i += 3) {
    // Quantised to 1e-5, which is far finer than the gap between two distinct
    // vertices of an icosphere at any detail we use and far coarser than the
    // float error that makes two copies of the same vertex differ.
    const key = `${Math.round(pos[i] * 1e5)},${Math.round(pos[i + 1] * 1e5)},${Math.round(pos[i + 2] * 1e5)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = dirs.length / 3;
      map.set(key, id);
      dirs.push(pos[i], pos[i + 1], pos[i + 2]);
    }
    index.push(id);
  }
  src.dispose();

  const out = { dirs: new Float32Array(dirs), index: new Uint16Array(index) };
  ICO_CACHE.set(detail, out);
  return out;
}

// A lobe is a smooth cap of extra radius pointing one way. Summed, a handful of
// them turn a sphere into something with shoulders and hollows and no edges
// anywhere, which is what "fluffy but still clay" has to mean in a scene with
// no alpha and no environment map. exp(-k*(1-cos)) rather than a power of the
// dot product because it stays smooth through the far side instead of clamping
// to zero along a circle, and a clamp to zero along a circle is a crease.
export function makeLobes(rand, {
  count = 8,
  amp = [0.10, 0.24],
  tight = [2.4, 5.5],
  yBias = 0.15,        // >0 pushes lobes to the upper half, <0 to the skirt
} = {}) {
  const lobes = [];
  for (let i = 0; i < count; i++) {
    // Even-ish coverage: a golden-angle spiral jittered, rather than uniform
    // random, because eight uniform random directions clump and leave one side
    // of the bush conspicuously bald about a third of the time.
    const u = (i + 0.5) / count;
    let y = 1 - 2 * u;
    y = Math.max(-0.92, Math.min(0.95, y + yBias + (rand() - 0.5) * 0.35));
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.399963 + rand() * 0.9;
    lobes.push({
      x: Math.cos(a) * r, y, z: Math.sin(a) * r,
      amp: amp[0] + rand() * (amp[1] - amp[0]),
      tight: tight[0] + rand() * (tight[1] - tight[0]),
    });
  }
  return lobes;
}

function lobeRadius(lobes, x, y, z) {
  let r = 1;
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i];
    const c = x * L.x + y * L.y + z * L.z;
    r += L.amp * Math.exp(-L.tight * (1 - c));
  }
  return r;
}

// Raw positions for one blob, in its own space, roughly unit sized.
//
// `stretch` lengthens it along +y by pulling the top half away from the bottom
// half rather than by scaling, which matters more than it sounds. Scaling a
// lobed sphere to two and a half times its width does not make a tuft, it makes
// a CONE: the lobes taper toward the pole and the scale multiplies the taper,
// and a bush covered in those is an agave. Sliding the cap instead leaves the
// end as round as it started, so a stretched lump is a lozenge and a heap of
// lozenges is foliage. The slide is smoothstepped over the equator so the waist
// is a curve and not a crease.
export function lumpPositions({ detail = 3, lobes = [], scaleY = 1, stretch = 0 } = {}) {
  const { dirs } = icosphere(detail);
  const out = new Float32Array(dirs.length);
  for (let i = 0; i < dirs.length; i += 3) {
    const x = dirs[i], y = dirs[i + 1], z = dirs[i + 2];
    const r = lobeRadius(lobes, x, y, z);
    const u = Math.max(0, Math.min(1, (y + 0.22) / 0.5));
    out[i] = x * r;
    out[i + 1] = y * r * scaleY + stretch * (u * u * (3 - 2 * u));
    out[i + 2] = z * r;
  }
  return out;
}

// One blob as a finished geometry, fitted to a real-world size.
//
// `fit` is how a plant says what it wants without doing the arithmetic: the
// blob is built at whatever size the lobes happen to make it, measured, and
// then scaled so its visible part is exactly `height` tall and `width` across,
// with `buried` units of it below y = 0.
//
// Burying it is what makes a bush sit in the ground instead of resting on it.
// A dome tangent to the floor touches at a point and shows a hairline of
// daylight all round its foot at this camera elevation; sunk by a fraction of
// its height it meets the floor along a real circle and the join disappears.
// The cost is some hidden geometry, which is cheaper than the alternatives
// (clamping vertices to y = 0 makes a ring of degenerate triangles, and a
// separately modelled skirt is a second silhouette to keep in agreement).
export function blobGeometry({ detail = 3, lobes = [], scaleY = 1, fit } = {}) {
  const { index } = icosphere(detail);
  const pos = lumpPositions({ detail, lobes, scaleY });

  if (fit) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < minX) minX = pos[i]; if (pos[i] > maxX) maxX = pos[i];
      if (pos[i + 1] < minY) minY = pos[i + 1]; if (pos[i + 1] > maxY) maxY = pos[i + 1];
      if (pos[i + 2] < minZ) minZ = pos[i + 2]; if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
    }
    const buried = fit.buried || 0;
    const big = Math.max(maxX - minX, maxZ - minZ);
    const sx = fit.width / big;
    // Separate depth so a plant is not a body of revolution seen from above. On
    // a fixed isometric camera an axisymmetric footprint is the one thing that
    // makes two seeds of the same prop look like the same prop turned round.
    const sz = (fit.depth === undefined ? fit.width : fit.depth) / big;
    const sy = (fit.height + buried) / (maxY - minY);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = (pos[i] - cx) * sx;
      pos[i + 1] = (pos[i + 1] - minY) * sy - buried;
      pos[i + 2] = (pos[i + 2] - cz) * sz;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
  geo.computeVertexNormals();
  return geo;
}

// Merge a pile of placed lumps into one geometry, one draw call.
//
// Each part carries a `phase` and a `flutter`, which are written per vertex so
// that bakeWind can pick them up. Per-clump phase is not decoration: without it
// every clump on every bush quivers in lockstep and the whole thing reads as
// one rigid object being shaken, which is the single most common way an
// instanced-foliage wind fails.
export function mergeLumps(parts) {
  let nVerts = 0, nIdx = 0;
  for (const p of parts) {
    nVerts += p.positions.length / 3;
    nIdx += p.index.length;
  }
  const pos = new Float32Array(nVerts * 3);
  const idx = nVerts > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
  const phase = new Float32Array(nVerts);
  const flutter = new Float32Array(nVerts);
  // Where a vertex sits along its own clump's axis, 0 at the end buried in the
  // mass and 1 at the exposed tip, plus one random value per clump. Both exist
  // for bakeFoliageTint: without them a field of clumps is a field of evenly
  // lit balls, which is the difference between a bunch of grapes and foliage.
  const lumpU = new Float32Array(nVerts);
  const lumpTint = new Float32Array(nVerts);

  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = p.positions[i * 3 + 1];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const span = Math.max(1e-5, hi - lo);
    for (let i = 0; i < n; i++) {
      lumpU[vo + i] = (p.positions[i * 3 + 1] - lo) / span;
      lumpTint[vo + i] = p.tint === undefined ? 0.5 : p.tint;
      v.set(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
      if (p.matrix) v.applyMatrix4(p.matrix);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
      phase[vo + i] = p.phase || 0;
      flutter[vo + i] = p.flutter === undefined ? 1 : p.flutter;
    }
    for (let i = 0; i < p.index.length; i++) idx[io + i] = p.index[i] + vo;
    vo += n;
    io += p.index.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.userData.windPhase = phase;
  geo.userData.windFlutter = flutter;
  geo.userData.lumpU = lumpU;
  geo.userData.lumpTint = lumpTint;
  return geo;
}

// --- baked shading ---------------------------------------------------------
//
// One directional key, one hemisphere fill and no environment map means a dark
// blob has almost no interior form: the top is lit, everything else is the
// ambient term and the underside of a lump looks the same as the gap next to
// it. This bakes the contact darkening that a real bush gets for free, as
// vertex colour, which the material multiplies into its base colour.
//
// Two terms, both cheap and both honest about what they are approximating:
// height above the ground (light gets in at the top, not at the bottom of a
// dense evergreen) and how far the vertex normal points downward.
export function bakeFoliageTint(geometry, {
  floor = 0.52,       // darkest multiplier at the very bottom
  ceil = 1.10,        // brightest at the crown
  down = 0.78,        // multiplier for a surface facing straight down
  jitter = 0.05,      // per-vertex speckle, breaks the smoothness of the ramp
  root = 0.55,        // multiplier at the buried end of a clump: the crevice
  spread = 0.22,      // how much clumps differ from one another in value
  warm = 0.34,        // hue split: lit foliage warmer, shaded foliage cooler
  top,                // world y that counts as the crown
  rand = null,
} = {}) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const n = pos.count;
  let maxY = top;
  if (maxY === undefined) {
    maxY = -Infinity;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, pos.getY(i));
  }
  const lumpU = geometry.userData.lumpU || null;
  const lumpTint = geometry.userData.lumpTint || null;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const h = Math.max(0, Math.min(1, pos.getY(i) / Math.max(1e-4, maxY)));
    const ny = nor.getY(i);
    let t = floor + (ceil - floor) * (h * h * (3 - 2 * h));
    t *= down + (1 - down) * (0.5 + 0.5 * ny);
    if (lumpU) {
      // The crevice. Two clumps meeting make a slot that light does not reach,
      // and with one directional key and a hemisphere fill nothing in the
      // lighting will find it. Painted in, the field of clumps stops reading as
      // a heap of separate objects and starts reading as one shaggy surface.
      const u = lumpU[i];
      t *= root + (1 - root) * (u * u * (3 - 2 * u));
      // and every clump a slightly different value, so the eye reads variety
      // rather than a repeated part.
      t *= 1 - spread * 0.5 + lumpTint[i] * spread;
    }
    if (rand) t *= 1 - jitter * 0.5 + rand() * jitter;
    // Warm where it is bright, cool where it is dark. One directional key and a
    // blue hemisphere fill already do a little of this, but not nearly enough on
    // a surface this dark, and a foliage mass that is one hue at every value
    // reads as painted plastic. Costs nothing: it is the same vertex colour.
    const k = warm * (t - 1);
    col[i * 3] = t * (1 + k);
    col[i * 3 + 1] = t;
    col[i * 3 + 2] = t * (1 - k);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

// --- the wind attribute ----------------------------------------------------
//
// aWind = (stiffness, d(stiffness)/dy, flutter weight, clump phase).
//
// stiffness is what makes a bush hinge at the ground instead of sliding across
// it: a normalised height raised to a power, so the bottom third barely moves
// and the crown moves fully. Its derivative is baked alongside it because the
// vertex shader has to rotate the normal by the same field it displaces with,
// and it cannot differentiate anything at run time. Both are closed form:
//
//   s(y)  = clamp((y - base) / (top - base), 0, 1) ^ power
//   s'(y) = power * clamp(...)^(power-1) / (top - base), zero outside the range
//
export function bakeWind(geometry, {
  top = 1,
  base = 0,
  power = 1.7,
  flutter = 0,
  phase = 0,
} = {}) {
  const pos = geometry.getAttribute('position');
  const n = pos.count;
  const a = new Float32Array(n * 4);
  const span = Math.max(1e-4, top - base);
  const perVertexFlutter = geometry.userData.windFlutter;
  const perVertexPhase = geometry.userData.windPhase;

  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const u = Math.max(0, Math.min(1, (y - base) / span));
    const s = Math.pow(u, power);
    const inside = u > 0 && u < 1;
    const sdy = inside ? (power * Math.pow(u, power - 1)) / span : 0;

    let ph = typeof phase === 'function' ? phase(i, pos.getX(i), y, pos.getZ(i)) : phase;
    if (perVertexPhase) ph = perVertexPhase[i];

    a[i * 4] = s;
    a[i * 4 + 1] = sdy;
    // Flutter has to be CONSTANT across a clump, because that constancy is the
    // whole argument for leaving it out of the Jacobian: a uniform offset over
    // a connected patch is a rigid translation and rotates no normals. So when
    // mergeLumps has supplied a per-clump weight it is used exactly as given,
    // already faded near the ground by the caller. Only the scalar and callback
    // forms, which have no clump to be constant over, get the height weight.
    a[i * 4 + 2] = perVertexFlutter
      ? perVertexFlutter[i]
      : (typeof flutter === 'function' ? flutter(i, pos.getX(i), y, pos.getZ(i)) : flutter) * s;
    a[i * 4 + 3] = ph;
  }
  geometry.setAttribute('aWind', new THREE.BufferAttribute(a, 4));
  return geometry;
}

// --- the wind itself -------------------------------------------------------
//
// Shared by reference across every foliage material in the scene.
//
// The default direction is not arbitrary. The scene is an isometric camera at
// a fixed elevation looking down (1, e, 1), and the world direction that maps
// to pure screen-horizontal under that view is (1, 0, -1). Wind blowing along
// (1, 0, 1) instead would be blowing straight into the lens: the bush would be
// working just as hard and the frame would show almost nothing. So the default
// is (0.707, -0.707) in world XZ, and the slow direction wander below is what
// keeps it off that rail without ever swinging it onto the dead axis.
const SHARED = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.707, -0.707) },
  uWindStr: { value: 1.0 },
  // Gusts travel across the yard, so two plants a metre apart lean a beat apart.
  // 0.95 rad/unit is a gust about six and a half units long, roughly the size of
  // the yard: neighbours are visibly out of step with each other, and the whole
  // set still moves as one weather system rather than as separate props. At the
  // 0.42 this shipped with first, two bushes a metre apart were five per cent of
  // a cycle apart, which is to say identical.
  uWaveK: { value: 0.95 },
  // Three carriers at incommensurate rates. NOT summed value noise: smoothstep
  // value noise has zero derivative at every lattice node, so a channel at f Hz
  // stalls f times a second and summing three of them just gives three sets of
  // stalls that periodically line up. A bush driven by that freezes on a
  // rhythm, which is far worse than a bush that does not move at all. A sum of
  // sines has a derivative that is itself a sum of sines and is only flat where
  // all three cosines vanish together, which at these ratios (1 : 1.89 : 3.44)
  // effectively never happens. Measured stall fraction is in the report.
  uWindRate: { value: new THREE.Vector3(0.27, 0.51, 0.93) },
  // How much of the amplitude the slow gust envelope is allowed to take away.
  // Never all of it: a true lull is realistic and reads as a bug.
  uWindGust: { value: 0.42 },
};

// --- the switch --------------------------------------------------------------
//
// THE WIND IS OFF UNLESS SOMETHING ASKS FOR IT. The shipped scene is still.
//
// It was on, because the plants were commissioned "fluffy and animated so that
// leaves move in the wind", and having seen a yard where everything green
// breathes at once, the owner does not want it. That is what looking at a
// thing is for. The machinery stays, whole and tested, because a breeze is one
// call away the day it is wanted.
//
// Off means OFF and not merely small: attachWind below skips the shader patch
// entirely, so a still plant costs no vertex work, no second and third program
// for the depth and distance passes, and no compile at build time. The price
// of that is the one thing worth knowing about this switch: it is read when a
// plant is BUILT, not when it is drawn. Turn it on before you build anything
// you want to move. The labs that exist to judge motion (bush-lab, grass-lab,
// flowers-lab) do exactly that at the top of the page.
//
// setWind({ strength }) is the other, finer control and still works as it did:
// on plants that were built with the wind enabled it scales the whole thing,
// zero included, per frame.
let windOn = false;

export function setWindEnabled(on) { windOn = !!on; }
export function windEnabled() { return windOn; }

export function windUniforms() { return SHARED; }

export function updateWind(time) { SHARED.uTime.value = time; }

export function setWind({ dir, strength, waveK, rates, gust } = {}) {
  if (dir) SHARED.uWindDir.value.set(dir.x, dir.y).normalize();
  if (strength !== undefined) SHARED.uWindStr.value = strength;
  if (waveK !== undefined) SHARED.uWaveK.value = waveK;
  if (rates) SHARED.uWindRate.value.set(rates[0], rates[1], rates[2]);
  if (gust !== undefined) SHARED.uWindGust.value = gust;
}

const WIND_PARS = /* glsl */`
uniform float uTime;
uniform vec2  uWindDir;
uniform float uWindStr;
uniform float uWaveK;
uniform vec3  uWindRate;
uniform float uWindGust;
uniform float uSway;
uniform float uFlutter;
uniform float uFlutRate;
uniform float uDroop;
uniform float uLag;
uniform float uScatter;
attribute vec4 aWind;  // stiffness, d(stiffness)/dy, flutter weight, clump phase

// A constant lean on top of the swing. Wind pushes; it does not oscillate about
// rest. Without this the bush spends half of every cycle leaning INTO the gust,
// which is the tell that says "sine wave" rather than "weather".
const float WIND_BIAS = 0.30;

float foliageGust(float t, float sp) {
  return 0.60 * sin(6.2831853 * (t * uWindRate.x) - sp)
       + 0.27 * sin(6.2831853 * (t * uWindRate.y) - sp * 1.63 + 1.7)
       + 0.13 * sin(6.2831853 * (t * uWindRate.z) - sp * 2.41 + 4.1);
}

// Same series differentiated, not sampled twice. The normal has to be rotated
// by the exact field that moved the vertex or the shading and the shape drift
// apart, and a finite difference in t would drift by exactly the step size.
float foliageGustDt(float t, float sp) {
  return 6.2831853 * (
      0.60 * uWindRate.x * cos(6.2831853 * (t * uWindRate.x) - sp)
    + 0.27 * uWindRate.y * cos(6.2831853 * (t * uWindRate.y) - sp * 1.63 + 1.7)
    + 0.13 * uWindRate.z * cos(6.2831853 * (t * uWindRate.z) - sp * 2.41 + 4.1));
}

// The displaced position. jac comes back as the one non-identity column of
// the deformation's Jacobian, the d/dy column, which is all the normal needs.
vec3 foliageWind(vec3 p, vec2 origin, out vec3 jac) {
  float s   = aWind.x;
  float sdy = aWind.y;
  float sp  = uWaveK * dot(origin, uWindDir);

  // The direction wanders slowly. A wind on a fixed axis reads as a machine;
  // +-26 degrees is enough that the bush is buffeted rather than pushed, and
  // small enough that it never swings onto the camera axis where it would
  // vanish. Deliberately independent of position, so the whole yard turns
  // together the way a real gust front does.
  float wob = 0.30 * sin(6.2831853 * 0.081 * uTime + 0.9)
            + 0.16 * sin(6.2831853 * 0.187 * uTime + 2.2);
  float cw = cos(wob), sw = sin(wob);
  vec2 dir = vec2(uWindDir.x * cw - uWindDir.y * sw, uWindDir.x * sw + uWindDir.y * cw);

  // Slow gust envelope, evaluated at un-lagged time on purpose: it then has no
  // y dependence and contributes nothing to the Jacobian below.
  float env = 1.0 - uWindGust + uWindGust * (0.5 + 0.5 * sin(6.2831853 * 0.107 * uTime - sp * 0.6));

  // The crown lags the foot. A stiff object all arrives at once; a bush is a
  // spring and the tip is always a moment behind. uScatter spreads neighbouring
  // clumps by a fraction of that again so the mass is not one plank.
  float tt = uTime - uLag * s + uScatter * aWind.w;
  float g  = foliageGust(tt, sp);
  float gd = foliageGustDt(tt, sp);

  float k  = uWindStr * uSway;
  float A  = k * (WIND_BIAS + env * g) * s;
  float dA = k * ((WIND_BIAS + env * g) - s * env * gd * uLag) * sdy;

  // Bending an arm of fixed length lowers its tip. Without this the crown
  // sweeps a horizontal line and the bush stretches; with it the crown draws an
  // arc, and the vertical component is worth having twice over on an isometric
  // camera, where up-down motion reads at any azimuth.
  float dropY = -uDroop * A * A;
  jac = vec3(dir.x * dA, -2.0 * uDroop * A * dA, dir.y * dA);

  vec3 q = p + vec3(dir.x * A, dropY, dir.y * A);

  // Flutter: the outer clumps quivering inside the bend. Three axes at
  // unrelated rates, phase-offset per clump, so it is never a shiver in step.
  // Constant within a clump, which is exactly why it is left out of the
  // Jacobian: a constant offset over a connected patch is a rigid translation
  // and a rigid translation does not change a normal.
  float fw = aWind.z;
  if (fw > 0.0) {
    float ph = aWind.w;
    float ft = uTime * uFlutRate + ph * 6.2831853;
    vec3 wob3 = vec3(sin(ft), sin(ft * 0.71 + ph * 11.0), sin(ft * 1.37 + ph * 23.0));
    // Leaves quiver harder inside a gust than in the lull between them.
    q += wob3 * (uFlutter * fw * uWindStr * (0.55 + 0.45 * abs(g)));
  }
  return q;
}

// n' = J^-T n, to first order in the shear. J = I + jac * yhat^T, so
// J^-T = I - yhat * jac^T and the whole rotation is one dot product.
vec3 foliageNormal(vec3 n, vec3 jac) {
  return normalize(n - vec3(0.0, 1.0, 0.0) * dot(jac, n));
}
`;

let cacheSalt = 0;

// How much further than its authored amplitude the bend can reach once the
// direction wander and the gust bias are stacked on it.
const WIND_PAD = 0.4;

// Patch a mesh so it bends, AND so its shadow bends with it.
//
// The shadow map is the thing that catches people out here. A bush displaced
// only in its beauty pass waves about while casting a perfectly still shadow,
// and a still shadow under a moving object is more wrong than no motion at all,
// because the eye reads the shadow as the truth. three renders shadows with its
// own MeshDepthMaterial, which knows nothing about a vertex shader written onto
// the standard material, so the identical displacement has to be compiled into
// a customDepthMaterial as well. customDistanceMaterial is the same story for
// any point light that ever casts (the lanterns), and costs nothing until one
// does.
export function attachWind(mesh, {
  sway = 0.10,        // world units the crown travels at strength 1
  flutter = 0.012,    // world units a fully-loose clump quivers
  flutRate = 1.55,    // Hz-ish, the clump quiver carrier
  droop = 0.55,       // 1/unit; how much the bend shortens the standing height
  lag = 0.24,         // seconds the crown is behind the foot
  scatter = 0.18,     // seconds of spread between neighbouring clumps
  castShadow = true,
  receiveShadow = true,
  // On by default. A MeshDistanceMaterial costs a JS object and nothing else
  // until a point light in the scene actually casts, and if one ever does, a
  // plant whose distance pass was left un-patched throws a frozen shadow from
  // the lanterns while waving under the key, which is the same bug as the depth
  // one and harder to notice. Pass false to opt a plant out of point-light
  // shadows entirely.
  distanceShadow = true,
} = {}) {
  const own = {
    uSway: { value: sway },
    uFlutter: { value: flutter },
    uFlutRate: { value: flutRate },
    uDroop: { value: droop },
    uLag: { value: lag },
    uScatter: { value: scatter },
  };

  // Off: the mesh keeps its shadow flags and nothing else happens to it. No
  // onBeforeCompile, so it compiles and draws as the plain toy material every
  // other prop in the yard uses, and its shadow comes from three's own depth
  // material rather than from a patched copy of it.
  if (!windOn) {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    return null;
  }

  // A per-instance salt. three keys its compiled programs by material
  // parameters, so two foliage materials that happen to share a colour and a
  // roughness would otherwise be handed each other's program, and the depth
  // material would be handed the stock un-patched one it compiled for some
  // other MeshDepthMaterial with the same settings.
  const key = `foliage-wind-${cacheSalt++}`;

  const beauty = (shader) => {
    Object.assign(shader.uniforms, SHARED, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      // The normal has to be settled before three transforms it, and three
      // transforms it several includes before begin_vertex. So the displacement
      // is computed here, at the normal's call site, and begin_vertex just
      // takes the answer.
      .replace('#include <beginnormal_vertex>', `
  vec3 wJac;
  vec3 wPos = foliageWind(position, modelMatrix[3].xz, wJac);
  vec3 objectNormal = foliageNormal(normal, wJac);`)
      .replace('#include <begin_vertex>', '  vec3 transformed = wPos;');
  };

  mesh.material.onBeforeCompile = beauty;
  mesh.material.customProgramCacheKey = () => key;

  const depthOnly = (shader) => {
    Object.assign(shader.uniforms, SHARED, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `
  vec3 wJac;
  vec3 transformed = foliageWind(position, modelMatrix[3].xz, wJac);`);
  };

  if (castShadow) {
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = depthOnly;
    depth.customProgramCacheKey = () => `${key}-depth`;
    mesh.customDepthMaterial = depth;
    mesh.userData.windDepth = depth;

    if (distanceShadow) {
      const dist = new THREE.MeshDistanceMaterial();
      dist.onBeforeCompile = depthOnly;
      dist.customProgramCacheKey = () => `${key}-dist`;
      mesh.customDistanceMaterial = dist;
      mesh.userData.windDistance = dist;
    }
  }

  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  // The shader owns the silhouette, so three's bounding sphere is a lower bound
  // on where this mesh actually is. Padded rather than disabled, so culling
  // still works for a yard full of bushes.
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.geometry.boundingSphere.radius += sway * (1 + WIND_PAD) + flutter * 4;

  mesh.userData.windUniforms = own;
  return own;
}


export function disposeWind(mesh) {
  mesh.userData.windDepth?.dispose();
  mesh.userData.windDistance?.dispose();
}
