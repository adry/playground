import * as THREE from 'three';

// The water: falling strands, and the pools they land in.
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
//   3. It beads. Surface tension eventually breaks a thinning stream into
//      drops, so the bead amplitude grows along the fall until the stream
//      pinches almost shut between them near the bottom.
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
// bead term swells between the necks by as much as the necks take out.
//
// Everything above is one function, `flowPoint(t, angle)`, evaluated in the
// vertex shader. Nothing about the geometry is precomputed on the CPU, and the
// normals are taken by differencing that same function twice, so the shading
// cannot disagree with the shape however hard the beads pinch.

export const WATER_COLOUR = '#93b2c6';

// Rings buy bead resolution and nothing else, so the count is tied to the bead
// frequency rather than picked: a strand carries a dozen or so necks and each
// one needs enough rings across it not to alias into a straight taper.
const RINGS = 120; // steps down the fall
const CROSS = 8; // steps round the ribbon

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
  // so `stretch` hands the area loss to the thin axis and the wide axis, which
  // is the one the camera reads, only narrows by about a third over the fall.
  // Capped because at the top of a jet's arc the vertical speed passes through
  // zero and an uncapped ratio puts a blob there.
  float area = min(1.45, s0 / sp);
  float stretch = 1.0 + uSheet * t;
  float wide = aShape.y * sqrt(area * stretch);
  float thin = (aShape.y / aShape.w) * sqrt(area / stretch);

  // the water passing through here left the lip at this moment
  float ph = uTime - tau + aShape.z;

  // Two amplitudes, not one. A stream leaving a lip is smooth for the first
  // stretch and only ripples gently; it is further down, once it has thinned,
  // that surface tension starts pinching it apart. The last tenth eases off
  // again so the strand meets the water on a swell and not on a neck.
  float amp = (uBeadAmp * smoothstep(0.32, 0.90, t) + uBreakAmp * smoothstep(0.68, 1.0, t))
            * (1.0 - 0.80 * smoothstep(0.90, 1.0, t));

  // A NOTCH, not a sine: a sinusoidal radius makes a chain of pointed spindles.
  // Water necks. It stays full most of the way and pinches hard over a short
  // stretch, and raising the cosine to a fourth power is what makes the narrow
  // part narrow and leaves the fat part fat.
  //
  // The bead term has to be volume-neutral or it doubles as a taper: `neck`
  // averages about a fifth over a cycle, so the constant here is set to give
  // back between the necks roughly what the necks take out, and `amp` can then
  // ramp all the way up without the mean radius sagging.
  float neck = pow(0.5 + 0.5 * cos(6.2831853 * uBeadFreq * ph), 4.0);
  float girth = 1.0 + amp * (0.34 - 1.25 * neck);
  // A slow swelling and a fine ripple, both running the whole length, so the
  // edge of the strand is never a straight line even where it is not beading.
  girth += 0.13 * sin(6.2831853 * uBeadFreq * 0.11 * ph + 2.1);
  girth += 0.05 * sin(6.2831853 * uBeadFreq * 2.3 * ph + 0.6);
  girth = max(0.17, girth);

  // The foot, where the stream goes into the pool and spreads. It is wide by
  // the time it reaches the waterline rather than at the very last ring,
  // because the last stretch is under the water and nobody sees it.
  girth *= 1.0 + uFoot * smoothstep(0.86, 0.97, t);

  wide *= girth;
  thin *= girth;

  vec3 T = vel / sp;
  vec3 W = normalize(aSide - T * dot(aSide, T));
  vec3 N = cross(T, W);

  float sway = uWaver * smoothstep(0.06, 0.85, t);
  p += W * (sway * sin(6.2831853 * 0.86 * ph + aShape.z));
  p += N * (sway * 0.55 * sin(6.2831853 * 0.61 * ph + 1.7));

  return p + N * (thin * cos(ang)) + W * (wide * sin(ang));
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
`;

function strandGeometry(strands) {
  const geo = new THREE.InstancedBufferGeometry();

  const aT = new Float32Array(RINGS * CROSS + CROSS);
  const aA = new Float32Array(aT.length);
  const col = new Float32Array(aT.length * 4);
  const rows = RINGS + 1;
  for (let i = 0; i < rows; i++) {
    const t = i / RINGS;
    // Alpha along the fall: nearly sheer where it peels off the lip so the
    // strand grows out of the stone instead of being stuck on it, and solid all
    // the rest of the way. It used to fade out again over the last seventh,
    // which is exactly the stretch that has to be legible against a pale pool:
    // the strand went transparent at the one place it had to arrive. What the
    // last stretch does instead is LIGHTEN, because water that has started to
    // come apart is full of air and air is white.
    const alpha = 0.46 + 0.54 * Math.min(1, t / 0.14);
    const airy = 1 + 0.30 * Math.max(0, (t - 0.62) / 0.38);
    for (let j = 0; j < CROSS; j++) {
      const k = i * CROSS + j;
      aT[k] = t;
      aA[k] = (j / CROSS) * Math.PI * 2;
      col[k * 4] = airy;
      col[k * 4 + 1] = airy;
      col[k * 4 + 2] = airy;
      col[k * 4 + 3] = alpha;
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
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
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
// pools

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
uniform float uSwell;
uniform float uChop;
uniform float uFoam;
uniform float uFoamTight;
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

// A fine capillary chop over the whole surface, in the shading only. Two
// crossed travelling waves rather than a second copy of the ring field at a
// scaled coordinate: scaling the coordinate moves the impact points too, and
// what came back was a second, wrong set of rings on top of the right ones.
vec2 chopGradient(vec2 q) {
  const vec2 d1 = vec2(0.829, 0.559);
  const vec2 d2 = vec2(-0.420, 0.907);
  float k1 = 23.0;
  float k2 = 31.0;
  return uChop * (k1 * cos(dot(q, d1) * k1 - uTime * 3.1) * d1
                + k2 * cos(dot(q, d2) * k2 + uTime * 2.3) * d2);
}

// Aerated water where a strand goes in. A strand that lands in the middle of a
// disc of flat colour arrives nowhere: the ring train alone is a normal-map
// effect and at this camera elevation it is far too subtle to say "the water
// comes down HERE". This is the same ring of impact points as the field above,
// read as a patch of white that breathes rather than as a height.
float poolFoam(vec2 q, vec4 pl) {
  float f = 0.0;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    float d = distance(q, c);
    float pulse = 0.86 + 0.14 * sin(6.2831853 * (d * uRingFreq - uTime * uRingSpeed));
    f += exp(-d * uFoamTight) * pulse;
  }
  return clamp(f, 0.0, 1.0);
}

vec2 poolGradient(vec2 q, vec4 pl) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 12; k++) {
    if (float(k) >= pl.y) break;
    float ang = 6.2831853 * (float(k) / pl.y) + pl.z;
    vec2 c = vec2(cos(ang), sin(ang)) * pl.x;
    vec2 dv = q - c;
    float d = max(length(dv), 1e-3);
    float e = exp(-d * uDecay);
    float w = 6.2831853 * (d * uRingFreq - uTime * uRingSpeed);
    g += (6.2831853 * uRingFreq * cos(w) * e - uDecay * sin(w) * e) * (dv / d);
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
varying vec3 vAxX;
varying vec3 vAxY;
varying vec3 vAxZ;
`;

function poolGeometry(pools) {
  const pos = [];
  const nor = [];
  const plane = [];
  const rad = [];
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
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------

function waterMaterial(roughness, opacity, vertexColors) {
  // Deliberately a plain MeshStandardMaterial. A refractive shader would look
  // like a different asset had wandered into the diorama: everything else on
  // this shelf is soft matte vinyl, and at this scale water reads as water
  // because of its silhouette and its motion, not its optics. All this does is
  // sit a little smoother than the marble and let some light through.
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(WATER_COLOUR),
    roughness,
    metalness: 0.0,
    transparent: true,
    opacity,
    vertexColors,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

export function createWater({ strands, pools }) {
  const group = new THREE.Group();

  const uniforms = {
    uTime: { value: 0 },
    uG: { value: 3.4 },
    // How much flatter the ribbon gets between the lip and the water. This is
    // the knob that decides how much of the continuity loss the silhouette
    // pays: at 1.05 the wide axis narrows by about 1.4 over the whole fall,
    // which is a taper you can see and not one you can name.
    uSheet: { value: 1.05 },
    uBeadAmp: { value: 0.34 },
    uBreakAmp: { value: 0.58 },
    // Beads have to be about as long as the strand is wide, or each one reads
    // as a taper in its own right. At 28 a strand carries a dozen necks, the
    // ones near the bottom about two strand-widths apart.
    uBeadFreq: { value: 28.0 },
    uFoot: { value: 1.35 },
    uWaver: { value: 0.026 },
    // Rings die back quickly on purpose. Nine ring trains crossing a pool is
    // what really happens and it looked like crumpled foil: the eye reads
    // interference as noise, not as water. Damped, each strand keeps its own
    // little halo of rings where it lands and the middle of the pool is calm,
    // which is what the reference asks for and what a pool actually looks like.
    uRingFreq: { value: 6.5 },
    uRingSpeed: { value: 1.30 },
    uDecay: { value: 3.6 },
    uSwell: { value: 0.0017 },
    uChop: { value: 0.00055 },
  };

  const strandMat = waterMaterial(0.42, 0.80, true);
  strandMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STRAND_PARS}`)
      .replace('#include <beginnormal_vertex>', `${STRAND_BODY}\n  vec3 objectNormal = wNormal;`)
      .replace('#include <begin_vertex>', '  vec3 transformed = wPos;');
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

  const poolMat = waterMaterial(0.48, 0.80, false);
  poolMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aPlane; // impact radius, impact count, first impact angle, amplitude
attribute float aRad;  // 0 at the centre, 1 at the rim
${POOL_UNIFORMS}${POOL_VARYINGS}${POOL_FIELD}`)
      .replace('#include <begin_vertex>', `
  vec3 transformed = vec3(position);
  vSurf = position.xz;
  vPlane = aPlane;
  // Let the ripple die out before it reaches the wall, or the pool's rim would
  // saw in and out of the stone it is supposed to be sitting inside.
  vDamp = 1.0 - smoothstep(0.78, 1.0, aRad);
  transformed.y += poolHeight(vSurf, aPlane) * vDamp;
  // The frame the fragment stage needs to tilt the normal into. Passed rather
  // than rebuilt from normalMatrix, which three declares only in this stage.
  vAxX = normalMatrix * vec3(1.0, 0.0, 0.0);
  vAxY = normalMatrix * vec3(0.0, 1.0, 0.0);
  vAxZ = normalMatrix * vec3(0.0, 0.0, 1.0);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${POOL_UNIFORMS}${POOL_VARYINGS}${POOL_FIELD}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  {
    // The mesh carries only the long swell -- fine enough tessellation for the
    // ring train would have cost four times the vertices for detail that, at
    // this camera elevation, is read off the shading and not the silhouette.
    // So the fine rings live here instead, and cost nothing per vertex.
    vec2 g = (poolGradient(vSurf, vPlane) + chopGradient(vSurf)) * vDamp;
    normal = normalize(vAxY - g.x * vAxX - g.y * vAxZ);
  }`);
  };
  poolMat.customProgramCacheKey = () => 'fountain-pool';

  const poolGeo = poolGeometry(pools);
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.castShadow = false;
  poolMesh.receiveShadow = true;
  poolMesh.renderOrder = 1;
  group.add(poolMesh);

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
    },
  };
}
