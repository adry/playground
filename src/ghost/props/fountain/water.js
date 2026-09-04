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
//   1. It thins. Volume through any cross-section is constant, so area times
//      speed is constant and the radius goes as one over the square root of the
//      speed. The strand is fat at the lip and about half as wide by the time
//      it lands, and that is not an art choice, it is the same equation.
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
// lip, pulled round by the time it lands.
//
// Everything above is one function, `flowPoint(t, angle)`, evaluated in the
// vertex shader. Nothing about the geometry is precomputed on the CPU, and the
// normals are taken by differencing that same function twice, so the shading
// cannot disagree with the shape however hard the beads pinch.

export const WATER_COLOUR = '#93b2c6';

const RINGS = 44; // steps down the fall
const CROSS = 8; // steps round the ribbon

// ---------------------------------------------------------------------------
// falling strands

const STRAND_PARS = `
attribute float aT;
attribute float aA;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aSide;
attribute vec4 aShape; // flight time, lip radius, phase seed, flatten

uniform float uTime;
uniform float uG;
uniform float uBeadAmp;
uniform float uBreakAmp;
uniform float uBeadFreq;
uniform float uWaver;

vec3 flowPoint(float t, float ang) {
  float tau = t * aShape.x;
  vec3 vel = aVel + vec3(0.0, -uG * tau, 0.0);
  vec3 p = aOrigin + aVel * tau + vec3(0.0, -0.5 * uG * tau * tau, 0.0);

  // continuity: area times speed is constant, so radius goes as 1/sqrt(speed)
  float sp = max(length(vel), 1e-4);
  float s0 = max(length(aVel), 1e-4);
  // Capped on the way up: at the top of a jet's arc the vertical speed passes
  // through zero, and an uncapped 1/sqrt(speed) puts a blob there.
  float r = aShape.y * min(1.25, sqrt(s0 / sp));

  // the water passing through here left the lip at this moment
  float ph = uTime - tau + aShape.z;

  // Two amplitudes, not one. A stream leaving a lip is smooth for the first
  // stretch and only ripples gently; it is further down, once it has thinned,
  // that surface tension starts pinching it apart. A single ramp gave every
  // strand one big taper and they came back reading as icicles.
  float amp = uBeadAmp * smoothstep(0.10, 0.60, t) + uBreakAmp * smoothstep(0.64, 1.0, t);

  // And a NOTCH, not a sine. A sinusoidal radius makes a chain of pointed
  // spindles, which is the second thing that read as icicles. Water necks: it
  // stays full most of the way and pinches hard over a short stretch, and by
  // the bottom those pinches are deep enough to cut it into drops. Raising the
  // cosine to a power is what makes the narrow part narrow.
  float w = 0.5 + 0.5 * cos(6.2831853 * uBeadFreq * ph);
  float swell = 0.5 + 0.5 * cos(6.2831853 * uBeadFreq * 0.41 * ph + 1.7);
  // Plus a fine ripple that never stops, so the edge of the strand is never a
  // straight line even where it is not beading yet.
  float fine = 0.045 * sin(6.2831853 * uBeadFreq * 2.4 * ph + 0.6);
  r *= max(0.13, 1.0 - amp * pow(w, 3.5) + 0.20 * amp * swell + fine);

  // The foot, where the stream goes into the pool and spreads. Without it the
  // strand ends on a needle point hanging over the water.
  r *= 1.0 + 0.85 * smoothstep(0.93, 1.0, t);

  // a ribbon at the lip, pulled round by surface tension on the way down
  // named ribbon because flat is a reserved word in GLSL
  float ribbon = aShape.w * (1.0 - smoothstep(0.0, 0.70, t));
  float wide = r * (1.0 + ribbon);
  float thin = r * (1.0 - 0.70 * ribbon);

  vec3 T = vel / sp;
  vec3 W = normalize(aSide - T * dot(aSide, T));
  vec3 N = cross(T, W);

  float sway = uWaver * smoothstep(0.10, 1.0, t);
  p += W * (sway * sin(6.2831853 * 0.82 * ph));
  p += N * (sway * 0.65 * sin(6.2831853 * 0.57 * ph + 1.7));

  return p + N * (thin * cos(ang)) + W * (wide * sin(ang));
}
`;

const STRAND_BODY = `
  vec3 wPos = flowPoint(aT, aA);
  float sgn = aT < 0.97 ? 1.0 : -1.0;
  vec3 dT = flowPoint(aT + sgn * 0.02, aA) - wPos;
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
    // strand grows out of the stone instead of being stuck on it, solid through
    // the body, softening again as it breaks up into the pool. The last stretch
    // also lightens, because water that has started to come apart is full of
    // air and air is white.
    const alpha = 0.42 + 0.58 * Math.min(1, t / 0.16) - 0.34 * Math.max(0, (t - 0.86) / 0.14);
    const airy = 1 + 0.18 * Math.max(0, (t - 0.55) / 0.45);
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
    shape.set([s.tau, s.rLip, s.seed, s.flatten], i * 4);
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
    uBeadAmp: { value: 0.42 },
    uBreakAmp: { value: 0.62 },
    uBeadFreq: { value: 10.5 },
    uWaver: { value: 0.022 },
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

  const strandMat = waterMaterial(0.42, 0.76, true);
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
