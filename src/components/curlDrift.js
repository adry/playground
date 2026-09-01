import * as THREE from 'three';
import { noiseGLSL } from '../shaders/lib/noise.glsl.js';
import { colorGLSL } from '../shaders/lib/color.glsl.js';
import { Stage } from '../engine/stage.js';
import { createBackdrop } from '../engine/backdrop.js';
import { loopDrift, applyJitter } from '../engine/camera.js';

// CURL DRIFT
// ----------
// Hundreds of thousands of line segments tracing a domain-warped noise field.
//
// The trick that makes this exportable: a particle's position is a pure
// function of (seed, phase) rather than the result of an integration step. So
// the tail of a streak is simply the same function evaluated at an earlier
// phase, and because the field itself is periodic the whole clip loops with no
// seam and no warm-up frames.

const VERT = /* glsl */ `
${noiseGLSL}
${colorGLSL}

attribute float aTrail;
attribute float aRand;

uniform float uPhase;
uniform float uTrailSpan;
uniform float uScale;
uniform float uWarpA;
uniform float uWarpB;
uniform float uDrift;
uniform float uFog;
uniform float uHue;
uniform float uSpin;
uniform float uTwist;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;

varying vec3 vColor;
varying float vAlpha;

vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 fieldPos(vec3 base, float ph, out float energy) {
  // One full revolution per loop. The warp field below stays put in world
  // space, so strands comb through it instead of squirming in place. Exactly
  // one turn keeps the loop seamless; a static twist adds the vortex shape
  // without winding up over time (which would break the loop).
  vec3 b = rotY(base, TAU * ph * uSpin + uTwist * base.y);
  vec3 q = b * uScale;
  // Two warp stages only, both low-octave: the goal is long coherent
  // filaments, not turbulence. More octaves here just reads as hair.
  vec3 w1 = fbmLoop3(q, ph, 2, uDrift);
  vec3 w2 = fbmLoop3(q * 1.55 + w1 * 1.9 + 4.2, ph, 2, uDrift);
  energy = length(w2);
  return b + w1 * uWarpA + w2 * uWarpB;
}

void main() {
  // Per-strand length variation stops the whole field from pulsing as one.
  float span = uTrailSpan * (0.45 + 0.55 * aRand);
  float ph = fract(uPhase - aTrail * span);
  float energy;
  vec3 p = fieldPos(position, ph, energy);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Comet falloff: a bright head with a long thin tail.
  float head = pow(1.0 - aTrail, 1.5);
  float depthFade = exp(-uFog * max(-mv.z - 1.0, 0.0));

  // Large-scale density mask. Carving voids is what turns a uniform hairball
  // into a composition with somewhere for the eye to rest.
  float density = smoothstep(-0.35, 0.35, snoise(position * 0.85 + 12.7));

  // Colour from position rather than purely from the field: a spatial gradient
  // reads as deliberate art direction, where colouring by noise alone reads as
  // noise. Height sets the ramp, field energy only jitters it.
  float k = clamp(0.5 + 0.62 * p.y + 0.55 * (energy - 0.3) + aRand * 0.08 + uHue, 0.0, 1.0);
  vColor = ramp3(k, uPalA, uPalB, uPalC);
  vAlpha = head * (0.45 + 0.55 * aRand) * depthFade * density;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
uniform float uIntensity;
void main() {
  gl_FragColor = vec4(vColor * vAlpha * uIntensity, 1.0);
}
`;

export default function curlDrift() {
  let scene, camera, material, geometry, lines, backdrop;

  return {
    id: 'curl-drift',
    title: 'Curl Drift',
    note: 'Domain-warped noise field, drawn as half a million motion trails.',
    duration: 6,
    grade: {
      bloom: 0.9,
      bloomThreshold: 0.5,
      bloomKnee: 0.35,
      bloomRadius: 1.1,
      exposure: 1.05,
      vignette: 0.45,
      grain: 0.01,
    },

    async init({ quality }) {
      const count = Math.max(2000, Math.round(13000 * quality.particles));
      const segments = 34;
      const vertexCount = count * segments;

      const seeds = new Float32Array(vertexCount * 3);
      const trail = new Float32Array(vertexCount);
      const rand = new Float32Array(vertexCount);
      const index = new Uint32Array(count * (segments - 1) * 2);

      let ii = 0;
      for (let p = 0; p < count; p++) {
        // Uniform-ish points in a ball, biased slightly outward so the centre
        // does not turn into an opaque blob once everything is additive.
        // Seeds live in a shell rather than a solid ball. The hollow centre
        // gives the silhouette an edge instead of a saturated core.
        const r = 0.85 + 0.75 * Math.pow(Math.random(), 0.7);
        const theta = Math.random() * Math.PI * 2;
        const z = Math.random() * 2 - 1;
        const s = Math.sqrt(1 - z * z);
        const bx = r * s * Math.cos(theta);
        const by = r * s * Math.sin(theta) * 0.8;
        const bz = r * z;
        const rnd = Math.random();

        for (let k = 0; k < segments; k++) {
          const v = p * segments + k;
          seeds[v * 3] = bx;
          seeds[v * 3 + 1] = by;
          seeds[v * 3 + 2] = bz;
          trail[v] = k / (segments - 1);
          rand[v] = rnd;
          if (k < segments - 1) {
            index[ii++] = v;
            index[ii++] = v + 1;
          }
        }
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
      geometry.setAttribute('aTrail', new THREE.BufferAttribute(trail, 1));
      geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

      material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPhase: { value: 0 },
          uTrailSpan: { value: 0.13 },
          uSpin: { value: 1.0 },
          uTwist: { value: 1.15 },
          uScale: { value: 0.5 },
          uWarpA: { value: 0.5 },
          uWarpB: { value: 0.18 },
          uDrift: { value: 0.14 },
          uFog: { value: 0.22 },
          uIntensity: { value: 2.1 },
          uHue: { value: 0.02 },
          uPalA: { value: new THREE.Vector3(0.05, 0.42, 1.0) },
          uPalB: { value: new THREE.Vector3(0.72, 0.24, 0.98) },
          uPalC: { value: new THREE.Vector3(1.0, 0.68, 0.30) },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });

      lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;

      scene = new THREE.Scene();
      backdrop = createBackdrop({ inner: '#0a1024', outer: '#02030a', power: 1.5 });
      scene.add(backdrop);
      scene.add(lines);

      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    },

    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      backdrop.userData.setAspect(width / height);
    },

    render(renderer, target, { phase, jitter, width, height }) {
      material.uniforms.uPhase.value = phase;
      loopDrift(camera, phase, {
        base: new THREE.Vector3(0, 0.05, 6.4),
        amplitude: new THREE.Vector3(0.7, 0.4, 0.3),
      });
      applyJitter(camera, jitter, width, height);
      Stage.draw(renderer, target, scene, camera);
    },

    dispose() {
      geometry?.dispose();
      material?.dispose();
      backdrop?.geometry.dispose();
      backdrop?.material.dispose();
    },
  };
}
