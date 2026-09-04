import * as THREE from 'three';

// The water: falling strands, the drops that come off them, and the pools they
// land in.
//
// The reference photograph is of a still object, so its water reads as drawn
// glass. Ours has to run, and the whole problem is that a stream is only
// convincing in MOTION. A ribbon that scrolls a texture at a constant speed is
// a barber's pole no matter how good the ribbon is. What separates falling
// water from a moving stripe is that a stream ACCELERATES, and three things
// follow from that, all of which are here:
//
//   1. It thins. Volume through any cross-section is constant, so the AREA of
//      that cross-section goes as one over the speed. Which of the ribbon's two
//      axes gives that area up is a separate question, and the answer for a
//      sheet peeling off a lip is that it keeps its width and loses its depth.
//   2. Its features accelerate. Every wobble and every bead is sampled at the
//      EMISSION time of the water that is passing through that point, which is
//      `uTime - tau`, where tau is the flight time to get there. A feature is a
//      line of constant `uTime - tau`, so its tau advances one second per
//      second while its DEPTH, which goes as tau squared, does not. Features
//      start slow at the lip and are moving fastest where they land. This one
//      line is the entire difference between falling and scrolling.
//   3. It beads, and then it BREAKS. Surface tension pinches a thinning stream
//      into drops, and past the break-up point those drops are on their own.
//
// It is also a ribbon and not a cylinder: wide and flat where it leaves the
// lip, and flatter still by the time it lands.
//
// WHY THIS WAS ICICLES, TWICE. The first pass thinned by one over root speed,
// which is only a factor of two over a fall this short, and then multiplied
// that by a second envelope: `1.0 + flatten * (1 - smoothstep(0, 0.7, t))`,
// which quietly narrowed the wide axis by another 1.55 over the first two
// thirds of the drop. Two monotone tapers multiplied together is 3.3 from lip
// to tip, and 3.3 IS an icicle however good the reasoning behind either factor
// was. On top of that the bead term `1 - amp * pow(w, 3.5)` only ever SUBTRACTED
// radius, so as `amp` ramped up along the fall it worked as a third taper.
// Both are fixed below: the area loss is spent on the thin axis alone, and the
// bead term swells between the necks by as much as the necks take out. Every
// width term added since is either volume-neutral by construction or dies out
// inside a tenth of the fall, and the width profile is MEASURED off the render
// rather than argued for here.
//
// Everything about the strand's shape is one function, `flowPoint(t, angle)`,
// evaluated in the vertex shader. Nothing about the geometry is precomputed on
// the CPU, and the normals are taken by differencing that same function twice,
// so the shading cannot disagree with the shape however hard the beads pinch.
//
// WHAT THIS PASS ADDED, AND THE ONE RULE IT FOLLOWED. Water reads as water
// through its optics far more than through its shape, and the scene has no
// environment map to reflect. So the optics here are all faked, cheaply and
// deliberately: a two-colour procedural sky sampled off the reflected normal, a
// Schlick fresnel that decides how much of it you see, and one tight Blinn lobe
// for the key light. Where a physically correct effect would cost real work and
// land under a pixel at this size, it is not here and the comment says so.
// Screen-space refraction is the big one: see `pools` below.

export const WATER_COLOUR = '#93b2c6';

// Rings buy bead resolution and nothing else, so the count is tied to the bead
// frequency rather than picked: a strand carries a dozen or so necks and each
// one needs enough rings across it not to alias into a straight taper. The
// break-up cuts below run at a THIRD of that frequency for exactly this reason
// -- a cut has to close over several rings or it aliases into a dotted line.
const RINGS = 120; // steps down the fall
const CROSS = 8; // steps round the ribbon

// ---------------------------------------------------------------------------
// shared fake optics
//
// No environment map exists in this scene and adding one would light the water
// out of register with the marble beside it. So: the sky is two colours and a
// smoothstep, the horizon is where the grey floor takes over, and the sun is a
// single Blinn lobe. Three numbers, no texture fetch, and it is the single
// biggest reason the water now reads as wet rather than as pale blue vinyl.
//
// `viewMatrix`, `cameraPosition` and `isOrthographic` are all declared by
// three's own fragment prefix, so this needs no uniforms of its own beyond the
// palette. The transpose trick gets a world-space vector out of a view-space
// one without an inverse, which GLSL ES 1.0 does not have.
const OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;

vec3 viewToWorld(vec3 v) {
  return vec3(dot(v, viewMatrix[0].xyz), dot(v, viewMatrix[1].xyz), dot(v, viewMatrix[2].xyz));
}

// Direction from the surface TOWARD the camera, in world space. Both cameras in
// this project are orthographic, so this is one constant per frame and the
// branch costs nothing.
vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

vec3 skyProbe(vec3 r) {
  return mix(uSkyLo, uSkyHi, smoothstep(-0.18, 0.55, r.y));
}

// Schlick, with water's F0. At the elevation this scene is shot from a flat
// pool reflects about six per cent, which is why the pools below are nearly
// clear and why the RIPPLES are where all the shine comes from: a facet tilted
// ten degrees toward the horizon reflects several times as much as the flat
// water around it, and that difference is the sparkle.
float fresnelWater(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.02 + 0.98 * m2 * m2 * m;
}

// One specular lobe for the key light, tight enough to break into glitter on a
// rippled surface instead of washing the whole pool.
float sunGlint(vec3 wN, vec3 wV, float sharp) {
  vec3 h = normalize(wV + uSunDir);
  return pow(max(dot(wN, h), 0.0), sharp);
}

// Aerated water is not a surface, it is a cloud of bubbles, and light that goes
// into one comes out of every side of it. Wrapped diffuse rather than the
// standard N dot L, and with a floor under it, because a lobe that reaches zero
// puts a BLACK band across every drop where its underside faces away from the
// key. That band was the most obvious artefact of the break-up work, and it is
// not a lighting bug: the standard model was answering the question correctly
// for an opaque solid, which foam is not.
vec3 aeratedLight(vec3 wN) {
  return uFoamCol * (0.52 + 0.60 * (0.5 + 0.5 * dot(wN, uSunDir)));
}
`;

// ---------------------------------------------------------------------------
// falling strands

const STRAND_PARS = `
attribute float aT;
attribute float aA;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aSide;
attribute vec4 aShape; // flight time, lip half-width, phase seed, lip aspect

uniform float uTime;
uniform float uG;
uniform float uSheet;
uniform float uBeadAmp;
uniform float uBreakAmp;
uniform float uBeadFreq;
uniform float uFoot;
uniform float uWaver;
uniform float uLipSheet;
uniform float uBreakT;
uniform float uCutFreq;
uniform float uDropSpan;
uniform float uDropGirth;

varying float vAir;   // how aerated, and therefore how white and how opaque
varying float vCut;   // 1 in the body of the stream, 0 inside a break

// How far the stream has come apart at this point of the fall. Zero above the
// break-up point, and eased back off over the last few per cent so a strand
// meets the pool as water and not as a dotted line.
float breakup(float t) {
  return smoothstep(uBreakT, min(uBreakT + 0.17, 0.99), t) * (1.0 - 0.55 * smoothstep(0.90, 1.0, t));
}

vec3 flowPoint(float t, float ang) {
  float tau = t * aShape.x;
  vec3 vel = aVel + vec3(0.0, -uG * tau, 0.0);
  vec3 p = aOrigin + aVel * tau + vec3(0.0, -0.5 * uG * tau * tau, 0.0);

  float sp = max(length(vel), 1e-4);
  float s0 = max(length(aVel), 1e-4);

  // Continuity, spent on the right axis. Volume through any cross-section is
  // constant, so AREA times speed is, and the area shrinks as s0/sp. A round
  // stream would pay for that equally on both axes and lose 1/sqrt(sp) of its
  // silhouette; a ribbon does not. It keeps its width and thins front to back,
  // so the stretch term hands the area loss to the thin axis and the wide axis,
  // which is the one the camera reads, only narrows by about a third.
  // Capped because at the top of a jet's arc the vertical speed passes through
  // zero and an uncapped ratio puts a blob there.
  float area = min(1.45, s0 / sp);
  float stretch = 1.0 + uSheet * t;
  float wide = aShape.y * sqrt(area * stretch);
  float thin = (aShape.y / aShape.w) * sqrt(area / stretch);

  // THE LIP SHEET. Water leaving a rounded rim clings to it and runs as a thin
  // wide sheet before surface tension gathers it into a strand, and ours used
  // to start life as a tube bolted to the stone. This widens and flattens the
  // first tenth of the fall and is GONE by t = 0.12, which matters: a widening
  // at the top is a taper going down, and a taper that ran any further would be
  // the icicle bug again with a better justification attached. It is also
  // volume-neutral -- the wide axis gains exactly what the thin axis gives up
  // -- so the strand below it is untouched.
  float lip = uLipSheet * (1.0 - smoothstep(0.0, 0.09, t));
  wide *= 1.0 + lip;
  thin /= 1.0 + lip;

  // the water passing through here left the lip at this moment
  float ph = uTime - tau + aShape.z;

  // Two amplitudes, not one. A stream leaving a lip is smooth for the first
  // stretch and only ripples gently; it is further down, once it has thinned,
  // that surface tension starts pinching it apart. The last tenth eases off
  // again so the strand meets the water on a swell and not on a neck.
  float amp = (uBeadAmp * smoothstep(0.32, 0.90, t) + uBreakAmp * smoothstep(0.68, 1.0, t))
            * (1.0 - 0.80 * smoothstep(0.90, 1.0, t));
  // Beat the amplitude against a slow detuned wave so the beads are not all the
  // same depth. Without it the chain is a perfect repeat, which reads as a
  // machined thread rather than as water coming apart.
  amp *= 0.72 + 0.42 * sin(6.2831853 * uBeadFreq * 0.17 * ph + 1.3);

  // A NOTCH, not a sine: a sinusoidal radius makes a chain of pointed spindles.
  // Water necks. It stays full most of the way and pinches hard over a short
  // stretch, so the pinch is a high power of the cosine and the bead between two
  // pinches is a low power of its complement: a narrow waist and a round lump,
  // rather than the flat-topped segments a plain constant gives.
  //
  // The pair has to be volume-neutral or the bead term doubles as a taper, which
  // is how the last attempt turned its beads into a third taper envelope. Over a
  // cycle the waist averages 0.3125 and the lump 0.375, so these two coefficients
  // cancel to within three per cent and the amplitude can ramp all the way up to
  // the water without the mean width sagging on the way down.
  float c = 0.5 + 0.5 * cos(6.2831853 * uBeadFreq * ph);
  float waist = c * c * c;
  float lump = (1.0 - c) * (1.0 - c);
  float girth = 1.0 + amp * (0.75 * lump - 1.00 * waist);
  // Two slow swellings running the whole length, so the strand varies in width
  // everywhere and not only where it is beading. Both are well BELOW the bead
  // frequency on purpose: a ripple above it corrugates the strand into a screw
  // thread, which is the one silhouette worse than an icicle.
  girth += 0.13 * sin(6.2831853 * uBeadFreq * 0.11 * ph + 2.1);
  girth += 0.055 * sin(6.2831853 * uBeadFreq * 0.29 * ph + 0.6);
  girth = max(0.17, girth);

  // BREAK-UP. The beads above never actually separated: the floor of 0.17 left a
  // two-pixel thread joining every bead to the next, and two pixels of thread is
  // what makes a chain of drops read as a rope.
  //
  // What replaces the thread is not a deeper neck, it is a different PROFILE.
  // Below the break-up point the radius stops being "a stream with a waist in
  // it" and becomes "a round drop with nothing either side of it": a circular
  // arc over uDropSpan of each cycle and flat zero over the rest. The first
  // attempt here just pinched the existing bead term harder and the result was
  // a row of turned chess pieces, because a hump that fills its whole cycle is a
  // spindle however deep the neck between two of them is.
  //
  // The two numbers are volume, not taste. A stream of radius r broken into
  // drops one wavelength L apart makes spheres of radius (3 r^2 L / 4)^(1/3);
  // at the bottom of this fall that is about 1.7 times the stream's own radius,
  // and a sphere that fat spans about 0.45 of the wavelength. Both fall out of
  // continuity, and the width measured off the render agrees with them.
  //
  // The cut frequency is a THIRD of the bead frequency, for two separate
  // reasons that point the same way. One is resolution: at 120 rings a bead
  // cycle is eight rings, and a gap inside one of those would be a single ring,
  // which aliases into a dotted line rather than reading as a gap. The other is
  // physics: Rayleigh break-up picks a wavelength of about four and a half
  // stream diameters, which over a fall this short is two or three drops, not
  // fourteen.
  float br = breakup(t);
  float u = fract(uCutFreq * ph + 0.35);
  float dphi = abs(u - 0.5) * 2.0;                    // 0 at a drop, 1 mid-gap
  float x = min(dphi / uDropSpan, 1.0);
  float drop = uDropGirth * sqrt(max(0.0, 1.0 - x * x));
  girth = mix(girth, drop, br);
  // Never exactly zero. The normals are differenced round the ring, so a ring
  // of radius zero has no two distinct samples to difference and hands the
  // fragment stage a NaN. A hundredth of a strand width is a third of a pixel
  // and the alpha below has taken it out anyway.
  girth = max(girth, 0.010);

  wide *= girth;
  thin *= girth;

  // The foot, where the stream goes into the pool. Water hitting a surface
  // spreads ACROSS it, so this goes almost entirely into the wide axis rather
  // than swelling the strand into a knob on a nail. It is at full width by the
  // waterline rather than at the very last ring, because the last stretch is
  // under the water and nobody sees it.
  // Suppressed wherever the stream has come apart: a detached drop is not
  // touching anything yet, so it has nothing to spread across. Without this the
  // foot multiplied the last drop of every chain into a balloon.
  float foot = uFoot * smoothstep(0.82, 0.965, t) * (1.0 - 0.85 * br);
  wide *= 1.0 + foot;
  thin *= 1.0 + 0.55 * foot;

  vec3 T = vel / sp;
  vec3 W = normalize(aSide - T * dot(aSide, T));
  vec3 N = cross(T, W);

  float sway = uWaver * smoothstep(0.06, 0.85, t);
  p += W * (sway * sin(6.2831853 * 0.86 * ph + aShape.z));
  p += N * (sway * 0.55 * sin(6.2831853 * 0.61 * ph + 1.7));

  return p + N * (thin * cos(ang)) + W * (wide * sin(ang));
}

// AERATION. Falling water entrains air and air is white; a fall is palest where
// it is coming apart and at the moment it lands, and nearly clear where it
// peels off the lip. Ours used to be one flat pale blue from top to bottom,
// which is most of why it read as a moulded part. Three terms: a ramp down the
// fall, a much stronger one keyed to the break-up so the whiteness arrives with
// the drops rather than on a schedule of its own, and a per-bead beat so
// neighbouring lumps are not the same white.
float aeration(float t) {
  float ph = uTime - t * aShape.x + aShape.z;
  float a = 0.18 * smoothstep(0.10, 0.85, t);
  a += 0.55 * breakup(t);
  a += 0.16 * smoothstep(0.90, 1.0, t);
  a *= 0.80 + 0.34 * sin(6.2831853 * uCutFreq * ph + 2.4);
  return clamp(a, 0.0, 1.0);
}
`;

// The differencing step down the strand is one ring, not a fixed 0.02. At the
// bead frequency this shader now runs, 0.02 of t is a quarter of a neck, and a
// normal taken over a quarter of a neck is the normal of the average shape:
// the beads were there in the silhouette and absent from the shading.
const STRAND_BODY = `
  vec3 wPos = flowPoint(aT, aA);
  float sgn = aT < 0.985 ? 1.0 : -1.0;
  vec3 dT = flowPoint(aT + sgn * ${(1 / RINGS).toFixed(6)}, aA) - wPos;
  vec3 dA = flowPoint(aT, aA + 0.14) - wPos;
  vec3 wNormal = normalize(cross(sgn * dT, dA));
  vAir = aeration(aT);
  {
    // Same profile as flowPoint's, so the alpha goes out exactly where the
    // radius does and a collapsed ring leaves no ghost behind it.
    float phc = uTime - aT * aShape.x + aShape.z;
    float uu = fract(uCutFreq * phc + 0.35);
    float xx = min(abs(uu - 0.5) * 2.0 / uDropSpan, 1.0);
    vCut = mix(1.0, smoothstep(0.015, 0.22, sqrt(max(0.0, 1.0 - xx * xx))), breakup(aT));
  }
`;

// A strand is a thin tube of water, so what the camera reads off it is almost
// entirely optical: nearly clear looking straight through the middle, bright at
// the silhouette where the chord through the water is long and where fresnel
// climbs to one, and white wherever it has air in it. That combination is what
// separates a stream from a glass rod, and none of it costs geometry.
const STRAND_FRAG = `
  vec3 wN = normalize(vWaterN);
  vec3 wV = worldViewDir(vWaterP);
  float ndv = clamp(abs(dot(wN, wV)), 0.0, 1.0);

  // Chord through the tube, longest at the silhouette. Aerated water scatters
  // instead of transmitting, so it thickens the body term rather than the rim.
  float path = 1.0 / max(ndv, 0.16);
  float A = 1.0 - exp(-uBodyA * path * (0.55 + 2.3 * vAir));
  A = min(A, 0.96) * vCut;

  float F = clamp(fresnelWater(ndv) * uRimGain, 0.0, 1.0) * vCut;
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * sunGlint(wN, wV, uShine));

  // Air is white and it is white in the DIFFUSE, not in the reflection, so it
  // goes on the body colour rather than on the rim.
  vec3 body = mix(outgoingLight, aeratedLight(wN), vAir);

  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

function strandGeometry(strands) {
  const geo = new THREE.InstancedBufferGeometry();

  const aT = new Float32Array(RINGS * CROSS + CROSS);
  const aA = new Float32Array(aT.length);
  const rows = RINGS + 1;
  for (let i = 0; i < rows; i++) {
    const t = i / RINGS;
    for (let j = 0; j < CROSS; j++) {
      const k = i * CROSS + j;
      aT[k] = t;
      aA[k] = (j / CROSS) * Math.PI * 2;
    }
  }
  const idx = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < CROSS; j++) {
      const j2 = (j + 1) % CROSS;
      const a = i * CROSS + j;
      const b = i * CROSS + j2;
      const c = (i + 1) * CROSS + j;
      const d = (i + 1) * CROSS + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 1));
  // `position` is never read by the shader, but three needs one to exist and
  // uses it for the bounding volume, so it holds the straight-line rest shape.
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aT.length * 3), 3));
  geo.setIndex(idx);

  const n = strands.length;
  const org = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const side = new Float32Array(n * 3);
  const shape = new Float32Array(n * 4);
  strands.forEach((s, i) => {
    org.set([s.origin.x, s.origin.y, s.origin.z], i * 3);
    vel.set([s.vel.x, s.vel.y, s.vel.z], i * 3);
    side.set([s.side.x, s.side.y, s.side.z], i * 3);
    shape.set([s.tau, s.halfWidth, s.seed, s.aspect], i * 4);
  });
  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(org, 3));
  geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  geo.setAttribute('aSide', new THREE.InstancedBufferAttribute(side, 3));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
  geo.instanceCount = n;
  return geo;
}

// ---------------------------------------------------------------------------
// loose drops
//
// The cuts above break the CHAIN, but every drop in a broken chain still shares
// one flight path, so the silhouette is a straight column of blobs. Real drops
// leave the stream with a sideways nudge and go their own way, and that spread
// is what a falling jet actually looks like from four metres. The same mesh
// carries the crown of spray that comes off each impact, because a splash drop
// is only a drop whose initial velocity points up: one instanced draw for both.
//
// Everything about a drop is fixed at build time and the shader just runs the
// clock, so this costs one uniform update a frame and nothing else.
const DROP_PARS = `
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec4 aDrop; // radius, loop period, phase, life
attribute float aTint;

uniform float uTime;
uniform float uG;
uniform float uDropStretch;

varying float vFade;
varying float vTint;
varying vec3 vWaterN;
varying vec3 vWaterP;
`;

const DROP_BODY = `
  float s = mod(uTime + aDrop.z, aDrop.y);
  float u = s / aDrop.w;
  // Alive only for the first aDrop.w seconds of each loop. Outside that the
  // radius is zero, which collapses every triangle to a point: no pixels, no
  // branch, no cost beyond the vertex itself.
  float live = step(s, aDrop.w);
  // In fast, out slow. A drop appears as it separates and stops existing when
  // it goes under, so the tail is a fade rather than a pop.
  vFade = live * smoothstep(0.0, 0.16, u) * (1.0 - smoothstep(0.80, 1.0, u));
  vTint = aTint;

  vec3 vel = aV0 + vec3(0.0, -uG * s, 0.0);
  vec3 centre = aP0 + aV0 * s + vec3(0.0, -0.5 * uG * s * s, 0.0);
  float sp = max(length(vel), 1e-4);
  vec3 ax = vel / sp;

  // Drops are not spheres, they are teardrops stretched along the flight. At
  // three or four pixels across nobody can see a teardrop, but they CAN see the
  // difference between a dot and a short streak, so the stretch is the part
  // that is worth paying for and the teardrop is not.
  vec3 q = position * (aDrop.x * live);
  q += ax * (dot(q, ax) * uDropStretch * sp);
  vec3 wPos = centre + q;
  vec3 wNormal = normalize(position);
`;

const DROP_FRAG = `
  vec3 wN = normalize(vWaterN);
  vec3 wV = worldViewDir(vWaterP);
  float ndv = clamp(abs(dot(wN, wV)), 0.0, 1.0);
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * 1.6 * sunGlint(wN, wV, uShine));
  float F = clamp(fresnelWater(ndv) * uRimGain, 0.0, 1.0);
  vec3 body = mix(outgoingLight, aeratedLight(wN), vTint);
  float A = mix(0.62, 0.94, vTint);
  float a = (A + F * (1.0 - A)) * vFade;
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(A + F * (1.0 - A), 1e-4), a);
`;

// A twenty-triangle icosahedron. A drop is three to six pixels across in the
// shipping frame, so anything smoother is spent on nothing.
function dropGeometry(drops) {
  const base = new THREE.IcosahedronGeometry(1, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.getAttribute('position'));
  if (base.getIndex()) geo.setIndex(base.getIndex());
  base.dispose();

  const n = drops.length;
  const p0 = new Float32Array(n * 3);
  const v0 = new Float32Array(n * 3);
  const par = new Float32Array(n * 4);
  const tint = new Float32Array(n);
  drops.forEach((d, i) => {
    p0.set([d.p0.x, d.p0.y, d.p0.z], i * 3);
    v0.set([d.v0.x, d.v0.y, d.v0.z], i * 3);
    par.set([d.radius, d.period, d.phase, d.life], i * 4);
    tint[i] = d.tint;
  });
  geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(p0, 3));
  geo.setAttribute('aV0', new THREE.InstancedBufferAttribute(v0, 3));
  geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(par, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
  geo.instanceCount = n;
  return geo;
}

// ---------------------------------------------------------------------------
// pools
//
// THE ONE THING THESE ARE NOT DOING, AND WHY. A pool three centimetres deep
// over pale marble is, optically, almost nothing: about six per cent reflected
// at this camera's elevation and essentially no absorption over that path. The
// correct effect is refraction -- the floor seen through the surface, displaced
// by the ripples -- and it needs the frame buffer read back, which means a
// render target, which means editing the scene's own render loop for a
// displacement of one or two pixels at the size this prop ships at. It is not
// here. What IS here is everything that displacement was going to sell: the
// floor is genuinely visible through the water, the tint deepens with the real
// depth of the bowl, and the ripples carry the shine. That reads; the refraction
// would not have.
//
// The surface of a bowl, rippled by the strands falling into it. A steady
// stream does not make one expanding ring, it makes a continuous train of them,
// which is a standing radial wave with a moving phase -- exactly the thing an
// analytic sum can do exactly and a texture scroll cannot.
//
// The impacts are evenly spaced on a circle because the scallops they fall from
// are, so a pool only needs to know how many there are and where the first one
// is. That fits in one vec4 and lets all three pools live in a single mesh.
const POOL_UNIFORMS = `
uniform float uTime;
uniform float uRingFreq;
uniform float uRingSpeed;
uniform float uDecay;
uniform float uRingFine;
uniform float uFineAmp;
uniform float uCoarseTilt;
uniform float uSwell;
uniform float uChop;
uniform float uChopCalm;
uniform float uFoam;
uniform float uFoamTight;
uniform float uFoamRing;
uniform float uFoamReach;
uniform float uTurbTight;
uniform float uAbsorb;
`;

// Shared by both stages: the vertex stage displaces by the field, the fragment
// stage tilts the normal by its gradient. Same field, differentiated rather
// than sampled, so the shape and the shading can never drift apart.
const POOL_FIELD = `
float poolHeight(vec2 q, vec4 pl) {
  float h = 0.0;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    float d = max(distance(q, c), 1e-3);
    h += sin(6.2831853 * (d * uRingFreq - uTime * uRingSpeed)) * exp(-d * uDecay);
  }
  h *= pl.w;
  // A slow swell underneath, so the surface between the ring trains is never
  // dead flat and the whole pool is never still.
  h += uSwell * sin(q.x * 7.3 + uTime * 0.9) * sin(q.y * 6.1 - uTime * 0.7);
  return h;
}

// How close this point is to somewhere water is landing. A real pool is not one
// texture: it is churned where the strands come down and glassy out at the rim,
// and that CONTRAST is a stronger cue than either state on its own. One cheap
// scalar drives all of it -- how much chop, how much foam, how much of the
// mirror survives.
float poolTurb(vec2 q, vec4 pl) {
  float f = 0.0;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    f += exp(-distance(q, c) * uTurbTight);
  }
  return clamp(f, 0.0, 1.0);
}

// A fine capillary chop, in the shading only. Two crossed travelling waves
// rather than a second copy of the ring field at a scaled coordinate: scaling
// the coordinate moves the impact points too, and what came back was a second,
// wrong set of rings on top of the right ones.
vec2 chopGradient(vec2 q, float turb) {
  const vec2 d1 = vec2(0.829, 0.559);
  const vec2 d2 = vec2(-0.420, 0.907);
  const vec2 d3 = vec2(0.966, -0.259);
  float k1 = 23.0;
  float k2 = 31.0;
  float k3 = 47.0;
  vec2 g = k1 * cos(dot(q, d1) * k1 - uTime * 3.1) * d1
         + k2 * cos(dot(q, d2) * k2 + uTime * 2.3) * d2;
  // The third wave is the churn, and it only exists near the impacts.
  g += turb * k3 * cos(dot(q, d3) * k3 - uTime * 5.7) * d3 * 1.6;
  return uChop * g * mix(uChopCalm, 1.0, turb);
}

// Aerated water where a strand goes in, and the foam that drifts out of it. A
// strand that lands in the middle of a disc of flat colour arrives nowhere: the
// ring train alone is a normal-map effect and at this camera elevation it is far
// too subtle to say "the water comes down HERE".
//
// Two parts. The bright core is the column of bubbles the strand drags under.
// The ring is the raft of foam it pushes outward, which thins as it spreads and
// dies before it reaches the wall -- two copies half a cycle apart so one is
// always growing while the other fades, and a coarse angular wobble on both so
// they are rafts and not hoops.
float poolFoam(vec2 q, vec4 pl) {
  float f = 0.0;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    vec2 dv = q - c;
    float d = length(dv);
    float pulse = 0.86 + 0.14 * sin(6.2831853 * (d * uRingFreq - uTime * uRingSpeed));
    f += exp(-d * uFoamTight) * pulse;

    float ragged = 0.55 + 0.45 * sin(atan(dv.y, dv.x) * 5.0 + float(k) * 2.3 + uTime * 0.8);
    for (int j = 0; j < 2; j++) {
      float p = fract(uTime * 0.60 + float(j) * 0.5 + float(k) * 0.137);
      // Stops well short of the neighbouring impact. Rafts that meet turn the
      // whole pool into one sheet of white, which is the failure this replaced.
      float r = p * uFoamReach;
      float w = 0.012 + 0.026 * p;
      f += uFoamRing * ragged * (1.0 - p) * exp(-((d - r) * (d - r)) / (w * w));
    }
  }
  return clamp(f, 0.0, 1.0);
}

// TWO ring trains, and the second one is the reason the pools stopped looking
// marbled. The coarse train is the one the MESH is displaced by, and it can only
// be as fine as the mesh: eighteen rings across a bowl is about one vertex per
// wavelength as it is. On its own that is a handful of very long, very smooth
// swells, and a long smooth swell shaded from a light source is a decorative
// blue-and-white curl, not water. The second train is three and a half times
// finer, lives in the SHADING only, costs one more cosine per impact, and dies
// out faster so the pool goes from busy at the impacts to glassy at the wall.
// That contrast is the cue; neither state on its own is.
vec2 poolGradient(vec2 q, vec4 pl) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    vec2 dv = q - c;
    float d = max(length(dv), 1e-3);
    vec2 u = dv / d;
    float e = exp(-d * uDecay);
    float w = 6.2831853 * (d * uRingFreq - uTime * uRingSpeed);
    g += uCoarseTilt * (6.2831853 * uRingFreq * cos(w) * e - uDecay * sin(w) * e) * u;

    float kf = uRingFreq * uRingFine;
    float df = uDecay * 2.0;
    float ef = exp(-d * df);
    float wf = 6.2831853 * (d * kf - uTime * uRingSpeed * uRingFine * 0.7);
    g += uFineAmp * (6.2831853 * kf * cos(wf) * ef - df * sin(wf) * ef) * u;
  }
  g *= pl.w;
  g += uSwell * vec2(
    7.3 * cos(q.x * 7.3 + uTime * 0.9) * sin(q.y * 6.1 - uTime * 0.7),
    6.1 * sin(q.x * 7.3 + uTime * 0.9) * cos(q.y * 6.1 - uTime * 0.7));
  return g;
}
`;

const POOL_VARYINGS = `
varying vec2 vSurf;
varying vec4 vPlane;
varying float vDamp;
varying float vDeep;
varying vec3 vAxX;
varying vec3 vAxY;
varying vec3 vAxZ;
varying vec3 vWaterP;
`;

function poolGeometry(pools) {
  const pos = [];
  const nor = [];
  const plane = [];
  const rad = [];
  const dep = [];
  const idx = [];
  for (const p of pools) {
    const base = pos.length / 3;
    const RAD = p.radial;
    const ANG = p.angular;
    // Outer radius sampled per angle so the disc ends exactly where the bowl's
    // wall is, groove or crest.
    const edge = new Float32Array(ANG);
    for (let j = 0; j < ANG; j++) edge[j] = p.edge((j / ANG) * Math.PI * 2);
    for (let i = 0; i <= RAD; i++) {
      const fr = i / RAD;
      for (let j = 0; j < ANG; j++) {
        const a = (j / ANG) * Math.PI * 2;
        const r = fr * edge[j];
        pos.push(r * Math.cos(a), p.y, r * Math.sin(a));
        nor.push(0, 1, 0);
        plane.push(p.impactRadius, p.impactCount, p.impactPhase, p.amp);
        rad.push(fr);
        // How much water is actually over the stone here, read off the same
        // profile the bowl is lathed from. This is what makes the water get
        // bluer toward the middle of a bowl and vanish at the rim, which is
        // both what happens and, at this size, the only depth cue there is.
        dep.push(p.depth ? p.depth(r, a) : 0.03);
      }
    }
    for (let i = 0; i < RAD; i++) {
      for (let j = 0; j < ANG; j++) {
        const j2 = (j + 1) % ANG;
        const a = base + i * ANG + j;
        const b = base + i * ANG + j2;
        const c = base + (i + 1) * ANG + j;
        const d = base + (i + 1) * ANG + j2;
        // Wound so the disc faces UP. It went in the other way first and the
        // whole pool vanished: front-face culled, and a pool you cannot see
        // looks exactly like a pool that is not there.
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPlane', new THREE.Float32BufferAttribute(plane, 4));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 1));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// The composite. Three layers, in the order light meets them: what bounces off
// the surface, what comes back up through the water, and the stone underneath
// that the frame buffer already holds.
//
//   A  how much of the floor the water body hides. Beer over the real depth of
//      the bowl, along the slanted path the eye takes through it, plus the foam,
//      which is the only genuinely opaque part of a pool this shallow.
//   F  how much the surface reflects. Schlick, so it is nearly nothing looking
//      down at flat water and nearly everything on a ripple facing away.
//
// Composited as `over`, so the alpha handed to the blender is the alpha the
// water really has and the reflection does not get multiplied away by an
// opacity slider. Getting this wrong is the classic transparent-water failure:
// the highlights are computed correctly and then faded out with the body.
const POOL_FRAG = `
  vec3 wN = viewToWorld(normal);
  vec3 wV = worldViewDir(vWaterP);
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);
  float turb = poolTurb(vSurf, vPlane) * vDamp;
  float foam = uFoam * poolFoam(vSurf, vPlane) * vDamp;

  // Beer over the real depth of the bowl, along the path the eye takes through
  // it. Deliberately measured against LEVEL water and not against the rippled
  // normal: refraction bends the ray back toward vertical the moment it enters,
  // so a tilted facet barely changes how much water is under it. Using the
  // rippled normal here instead was tried and is wrong twice over -- it banded
  // the pool into blue and white worms, and it put all the ripple contrast in
  // the absorption, which is the one place water does not carry it. The ripples
  // belong in the reflection below.
  float ndvFlat = clamp(dot(vec3(0.0, 1.0, 0.0), wV), 0.08, 1.0);
  float A = 1.0 - exp(-uAbsorb * vDeep / ndvFlat);
  A = clamp(A + foam, 0.0, 1.0);

  // Foam is a diffuse scatterer, not a mirror, so it kills the reflection under
  // it rather than adding to it.
  float gloss = 1.0 - 0.75 * clamp(foam * 1.6, 0.0, 1.0);
  float F = clamp(fresnelWater(ndv) * uRimGain, 0.0, 1.0) * gloss;
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * sunGlint(wN, wV, uShine) * gloss);

  vec3 body = mix(outgoingLight, aeratedLight(wN), clamp(foam * 2.2, 0.0, 1.0));

  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

// ---------------------------------------------------------------------------

function waterMaterial(roughness, opacity) {
  // Still a plain MeshStandardMaterial, and still no transmission: a refractive
  // material would drag a render target and a second scene pass behind it and
  // would light the water out of register with the marble it sits in. What the
  // shader does instead is take over the very last line, `opaque_fragment`, and
  // composite its own reflection and its own transparency over three's shading.
  // That gets the two things the diorama actually needed -- you can see through
  // it, and it glints -- for one fresnel and one power function.
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(WATER_COLOUR),
    roughness,
    metalness: 0.0,
    transparent: true,
    opacity,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

export function createWater({ strands, pools, drops = [] }) {
  const group = new THREE.Group();

  const optics = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e, so a reflection
    // that leaves the water going up finds the first and one going out finds
    // the second. Linear, because this is composited before tone mapping.
    uSkyHi: { value: new THREE.Color('#cfd8e6').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#8f959f').convertSRGBToLinear() },
    // Between the key light in main.js and the one in the preview harness.
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    uFoamCol: { value: new THREE.Color('#eef4fa').convertSRGBToLinear() },
    // How much of the fresnel to believe. Physically this is 1.0; it is over
    // one because the fake sky is a flat gradient rather than a real
    // environment, so the reflection has no bright spots of its own to find and
    // needs the help to register at all against pale marble.
    uRimGain: { value: 1.45 },
    uGlint: { value: 1.30 },
    uShine: { value: 190.0 },
  };

  const uniforms = {
    uTime: { value: 0 },
    uG: { value: 3.4 },
    // How much flatter the ribbon gets between the lip and the water. This is
    // the knob that decides how much of the continuity loss the silhouette
    // pays: at 1.05 the wide axis narrows by about 1.4 over the whole fall,
    // which is a taper you can see and not one you can name.
    uSheet: { value: 1.05 },
    uBeadAmp: { value: 0.26 },
    uBreakAmp: { value: 0.58 },
    // Beads have to be about as long as the strand is wide, or each one reads
    // as a taper in its own right. At 28 a strand carries a dozen necks, the
    // ones near the bottom about two strand-widths apart.
    uBeadFreq: { value: 28.0 },
    uFoot: { value: 0.58 },
    uWaver: { value: 0.026 },
    // The sheet at the lip: half again as wide, and gone by a tenth of the way
    // down. See flowPoint for why it is not allowed to run any further.
    uLipSheet: { value: 0.28 },
    // Where the chain starts letting go, as a fraction of the fall.
    uBreakT: { value: 0.66 },
    uCutFreq: { value: 15.0 },
    // Fraction of a break-up wavelength a drop occupies, and how much fatter it
    // is than the stream that made it. Both come out of continuity; see the
    // note on break-up in flowPoint.
    uDropSpan: { value: 0.46 },
    uDropGirth: { value: 1.34 },
    uDropStretch: { value: 0.16 },
    uBodyA: { value: 0.88 },
    // Rings die back quickly on purpose. Nine ring trains crossing a pool is
    // what really happens and it looked like crumpled foil: the eye reads
    // interference as noise, not as water. Damped, each strand keeps its own
    // little halo of rings where it lands and the middle of the pool is calm,
    // which is what the reference asks for and what a pool actually looks like.
    uRingFreq: { value: 7.4 },
    uRingSpeed: { value: 1.30 },
    uDecay: { value: 6.0 },
    uRingFine: { value: 3.5 },
    uFineAmp: { value: 0.34 },
    uCoarseTilt: { value: 0.60 },
    uSwell: { value: 0.0021 },
    // Ten times what this used to be. The old chop tilted the surface by about
    // one degree, which is invisible: a facet has to turn several degrees
    // before its fresnel changes enough to catch anything, and catching things
    // is the entire job of a chop.
    uChop: { value: 0.0055 },
    uChopCalm: { value: 0.22 },
    uTurbTight: { value: 9.0 },
    uFoam: { value: 0.30 },
    uFoamTight: { value: 34.0 },
    uFoamRing: { value: 0.30 },
    uFoamReach: { value: 0.115 },
    // Extinction per unit depth. The bowls are three centimetres deep, so this
    // is small by construction and the pools are nearly clear, which is what a
    // fountain bowl looks like.
    uAbsorb: { value: 7.0 },
    ...optics,
  };

  // --- falling strands -------------------------------------------------------
  const strandMat = waterMaterial(0.30, 1.0);
  strandMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWaterN;\nvarying vec3 vWaterP;\n${STRAND_PARS}`)
      .replace('#include <beginnormal_vertex>', `${STRAND_BODY}\n  vec3 objectNormal = wNormal;`)
      .replace('#include <begin_vertex>', `  vec3 transformed = wPos;
  vWaterN = normalize(mat3(modelMatrix) * wNormal);
  vWaterP = (modelMatrix * vec4(wPos, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBodyA;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform vec3 uFoamCol;
varying float vAir;
varying float vCut;
varying vec3 vWaterN;
varying vec3 vWaterP;
${OPTICS}`)
      .replace('#include <opaque_fragment>', STRAND_FRAG);
  };
  // Cache key has to change or three hands this material the depth-only program
  // it compiled for some other MeshStandardMaterial with the same parameters.
  strandMat.customProgramCacheKey = () => 'fountain-strand';

  const strandGeo = strandGeometry(strands);
  const strandMesh = new THREE.Mesh(strandGeo, strandMat);
  strandMesh.frustumCulled = false; // the shader owns the shape; `position` is empty
  strandMesh.castShadow = false; // five shadow passes of a translucent thread buys nothing
  strandMesh.receiveShadow = true;
  strandMesh.renderOrder = 2;
  group.add(strandMesh);

  // --- pools -----------------------------------------------------------------
  const poolMat = waterMaterial(0.16, 1.0);
  poolMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aPlane; // impact radius, impact count, first impact angle, amplitude
attribute float aRad;  // 0 at the centre, 1 at the rim
attribute float aDepth; // metres of water over the stone here
${POOL_UNIFORMS}${POOL_VARYINGS}${POOL_FIELD}`)
      .replace('#include <begin_vertex>', `
  vec3 transformed = vec3(position);
  vSurf = position.xz;
  vPlane = aPlane;
  vDeep = aDepth;
  // Let the ripple die out before it reaches the wall, or the pool's rim would
  // saw in and out of the stone it is supposed to be sitting inside.
  vDamp = 1.0 - smoothstep(0.78, 1.0, aRad);
  transformed.y += poolHeight(vSurf, aPlane) * vDamp;
  vWaterP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  // The frame the fragment stage needs to tilt the normal into. Passed rather
  // than rebuilt from normalMatrix, which three declares only in this stage.
  vAxX = normalMatrix * vec3(1.0, 0.0, 0.0);
  vAxY = normalMatrix * vec3(0.0, 1.0, 0.0);
  vAxZ = normalMatrix * vec3(0.0, 0.0, 1.0);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform vec3 uFoamCol;
${POOL_UNIFORMS}${POOL_VARYINGS}${POOL_FIELD}${OPTICS}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  {
    // The mesh carries only the long swell -- fine enough tessellation for the
    // ring train would have cost four times the vertices for detail that, at
    // this camera elevation, is read off the shading and not the silhouette.
    // So the fine rings live here instead, and cost nothing per vertex.
    float turb0 = poolTurb(vSurf, vPlane);
    vec2 g = (poolGradient(vSurf, vPlane) + chopGradient(vSurf, turb0)) * vDamp;
    normal = normalize(vAxY - g.x * vAxX - g.y * vAxZ);
  }`)
      .replace('#include <opaque_fragment>', POOL_FRAG);
  };
  poolMat.customProgramCacheKey = () => 'fountain-pool';

  const poolGeo = poolGeometry(pools);
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.castShadow = false;
  poolMesh.receiveShadow = true;
  poolMesh.renderOrder = 1;
  group.add(poolMesh);

  // --- loose drops -----------------------------------------------------------
  let dropGeo = null;
  let dropMat = null;
  if (drops.length) {
    dropMat = waterMaterial(0.22, 1.0);
    dropMat.depthWrite = false; // a cloud of tiny transparent blobs, not a solid
    dropMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${DROP_PARS}`)
        .replace('#include <beginnormal_vertex>', `${DROP_BODY}\n  vec3 objectNormal = wNormal;`)
        .replace('#include <begin_vertex>', `  vec3 transformed = wPos;
  vWaterN = normalize(mat3(modelMatrix) * wNormal);
  vWaterP = (modelMatrix * vec4(wPos, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform vec3 uFoamCol;
varying float vFade;
varying float vTint;
varying vec3 vWaterN;
varying vec3 vWaterP;
${OPTICS}`)
        .replace('#include <opaque_fragment>', DROP_FRAG);
    };
    dropMat.customProgramCacheKey = () => 'fountain-drop';

    dropGeo = dropGeometry(drops);
    const dropMesh = new THREE.Mesh(dropGeo, dropMat);
    dropMesh.frustumCulled = false;
    dropMesh.castShadow = false;
    dropMesh.receiveShadow = false;
    dropMesh.renderOrder = 3;
    group.add(dropMesh);
  }

  return {
    group,
    uniforms,
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      strandGeo.dispose();
      strandMat.dispose();
      poolGeo.dispose();
      poolMat.dispose();
      if (dropGeo) dropGeo.dispose();
      if (dropMat) dropMat.dispose();
    },
  };
}
