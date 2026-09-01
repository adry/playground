import * as THREE from 'three';
import { noiseGLSL } from '../shaders/lib/noise.glsl.js';
import { colorGLSL } from '../shaders/lib/color.glsl.js';
import { FullScreenPass, FULLSCREEN_VERT } from '../engine/fullscreen.js';

// CONTOUR FLOW
// ------------
// Topographic contour lines over a domain-warped noise field.
//
// The whole piece is one full-screen shader, which makes it the cheapest thing
// in the lab and the easiest to restyle: change the ramp and the contour count
// and it becomes a different poster.
//
// Line width is derived from fwidth() rather than a fixed constant, so the
// contours stay exactly one pixel wide wherever the field is steep. That is
// what stops them from turning into moire the moment a platform re-encodes the
// clip at a lower bitrate.

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

${noiseGLSL}
${colorGLSL}

uniform vec2 uResolution;
uniform float uPhase;
uniform vec2 uJitter;
uniform float uScale;
uniform float uWarp;
uniform float uDrift;
uniform float uContours;
uniform float uLineWeight;
uniform float uGlow;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uInk;

float field(vec2 uv, out float warpAmount) {
  vec3 p = vec3(uv * uScale, 0.0);
  vec3 w1 = fbmLoop3(p, uPhase, 2, uDrift);
  vec3 w2 = fbmLoop3(p * 1.7 + w1 * uWarp + 9.4, uPhase, 2, uDrift);
  warpAmount = length(w2.xy);
  return fbmLoop(p * 1.15 + w1 * uWarp + w2 * (uWarp * 0.35), uPhase, 3, uDrift);
}

void main() {
  vec2 uv = (gl_FragCoord.xy + uJitter - 0.5 * uResolution) / uResolution.y;

  float warpAmount;
  float f = field(uv, warpAmount);

  // Contour index. Its screen-space derivative gives the exact line width
  // needed for a constant one-pixel stroke.
  float k = f * uContours;
  float w = fwidth(k) * uLineWeight;
  float dist = abs(fract(k) - 0.5);
  float line = 1.0 - smoothstep(0.0, max(w, 1e-4), dist);

  // A wider, softer copy of the same field reads as light bleeding off the
  // engraving.
  float halo = exp(-dist * dist / max(w * w * 9.0, 1e-6));

  float tone = clamp(f * 0.85 + 0.5 + warpAmount * 0.18, 0.0, 1.0);
  vec3 tint = ramp3(tone, uPalA, uPalB, uPalC);

  // Base wash, then the engraved lines on top.
  vec3 col = uInk * (0.15 + 0.85 * tone) * 0.18;
  col += tint * line * 1.35;
  col += tint * halo * uGlow;

  // Vertical falloff so the composition has a top and a bottom.
  col *= 1.0 - 0.28 * smoothstep(0.1, 0.75, abs(uv.y));

  gl_FragColor = vec4(col, 1.0);
}
`;

export default function contourFlow() {
  let pass;

  return {
    id: 'contour-flow',
    title: 'Contour Flow',
    note: 'Engraved topographic lines drifting through a warped field.',
    duration: 8,
    grade: {
      bloom: 0.42,
      bloomThreshold: 0.7,
      bloomKnee: 0.4,
      bloomRadius: 1.0,
      exposure: 1.05,
      vignette: 0.42,
      grain: 0.012,
    },

    async init() {
      pass = new FullScreenPass(new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: FRAG,
        uniforms: {
          uResolution: { value: new THREE.Vector2(1, 1) },
          uPhase: { value: 0 },
          uJitter: { value: new THREE.Vector2() },
          uScale: { value: 0.82 },
          uWarp: { value: 0.42 },
          uDrift: { value: 0.3 },
          uContours: { value: 9.0 },
          uLineWeight: { value: 1.1 },
          uGlow: { value: 0.28 },
          uPalA: { value: new THREE.Vector3(0.10, 0.52, 1.0) },
          uPalB: { value: new THREE.Vector3(0.58, 0.34, 0.98) },
          uPalC: { value: new THREE.Vector3(1.0, 0.72, 0.40) },
          uInk: { value: new THREE.Vector3(0.10, 0.14, 0.30) },
        },
        depthTest: false,
        depthWrite: false,
      }));
    },

    resize(width, height) {
      pass.material.uniforms.uResolution.value.set(width, height);
    },

    render(renderer, target, { phase, jitter }) {
      const u = pass.material.uniforms;
      u.uPhase.value = phase;
      u.uJitter.value.set(jitter ? jitter[0] : 0, jitter ? jitter[1] : 0);
      pass.render(renderer, target);
    },

    dispose() {
      pass?.dispose();
    },
  };
}
