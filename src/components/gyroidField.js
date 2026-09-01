import * as THREE from 'three';
import { noiseGLSL } from '../shaders/lib/noise.glsl.js';
import { colorGLSL } from '../shaders/lib/color.glsl.js';
import { FullScreenPass, FULLSCREEN_VERT } from '../engine/fullscreen.js';

// GYROID FIELD
// ------------
// A raymarched triply-periodic minimal surface, shaded like a wet ceramic.
//
// It loops because the surface is 2*pi periodic in every axis: translating the
// field by exactly one period over the clip returns it to its starting state,
// so the "endless tunnelling" motion has no cut.

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

${noiseGLSL}
${colorGLSL}

uniform vec2 uResolution;
uniform float uPhase;
uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uFocal;
uniform vec2 uJitter;
uniform int uSteps;
uniform float uScale;
uniform float uShell;
uniform float uRadius;
uniform vec3 uTint;
uniform vec3 uKey;
uniform vec3 uFill;

// Gyroid: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0
float gyroid(vec3 q) {
  return dot(sin(q), cos(q.zxy));
}

float map(vec3 p) {
  // One full period of travel across the loop -> seamless.
  vec3 q = p * uScale + vec3(0.0, TAU * uPhase, TAU * uPhase * 0.5);

  // A slow breathing of the shell thickness, itself periodic.
  float breathe = uShell + 0.07 * sin(TAU * uPhase);
  float g = abs(gyroid(q)) - breathe;

  // The gyroid gradient is roughly 2-3 in magnitude; dividing keeps the march
  // conservative enough not to overshoot the surface.
  float d = g / (uScale * 2.6);

  // Carve it out of a sphere so the piece has a silhouette.
  float bounds = length(p) - uRadius;
  return max(d, bounds);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0016, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

// A hand-authored environment: a cool gradient plus two soft light bands.
// Reflecting this is what gives the surface its polished read - far cheaper
// and more controllable than loading an HDRI.
vec3 envMap(vec3 d) {
  float up = d.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.015, 0.02, 0.045), vec3(0.20, 0.32, 0.62), pow(up, 1.6));
  float key = smoothstep(0.50, 0.99, dot(d, normalize(vec3(0.45, 0.85, 0.30))));
  sky += vec3(1.0, 0.93, 0.84) * key * 2.2;
  float rim = smoothstep(0.62, 1.0, dot(d, normalize(vec3(-0.75, -0.10, -0.45))));
  sky += vec3(0.32, 0.58, 1.0) * rim * 1.1;
  return sky;
}

// Cheap ambient occlusion from how quickly the field closes in.
float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.13 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.70;
  }
  return clamp(1.0 - 2.4 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy + uJitter - 0.5 * uResolution) / uResolution.y;
  vec3 rd = normalize(uCamBasis * vec3(uv, -uFocal));
  vec3 ro = uCamPos;

  float t = 0.0;
  float hit = 0.0;
  float glow = 0.0;

  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    // Accumulating proximity gives a volumetric haze around the surface for
    // free, which the bloom then picks up.
    glow += 0.0045 / (1.0 + d * d * 140.0);
    if (d < 0.0016) { hit = 1.0; break; }
    if (t > 14.0) break;
    t += d * 0.82;
  }

  vec3 col = vec3(0.0);

  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 v = -rd;
    float occ = ambientOcclusion(p, n);

    vec3 lightA = normalize(vec3(0.45, 0.85, 0.30));
    float diffA = max(dot(n, lightA), 0.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);

    // Near-black body: almost everything visible is reflected environment.
    col += uTint * (0.08 + 0.55 * diffA) * uKey * occ;

    vec3 refl = envMap(reflect(rd, n));
    col += refl * (0.16 + 0.84 * fres) * mix(0.35, 1.0, occ);

    // Iridescence held to a narrow slice of the spectrum instead of a full
    // rainbow, so it reads as a coating rather than an oil slick.
    vec3 iri = ramp3(clamp(fres * 1.5 + n.y * 0.25 + 0.12, 0.0, 1.0),
                     vec3(0.10, 0.45, 0.95),
                     vec3(0.60, 0.32, 0.95),
                     vec3(1.0, 0.66, 0.42));
    col += iri * fres * 1.05;

    // Depth falloff keeps the far side of the lattice from flattening out.
    col *= exp(-0.055 * t * t * 0.25);

  } else {
    // Background is the same environment, dimmed. Anything is better than flat
    // black once a platform re-encodes the clip.
    col = envMap(rd) * 0.13;
  }

  col += glow * vec3(0.35, 0.55, 1.0) * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function gyroidField() {
  let pass, camera;

  return {
    id: 'gyroid-field',
    title: 'Gyroid Field',
    note: 'Raymarched minimal surface, shaded like wet ceramic.',
    duration: 6,
    grade: {
      bloom: 0.5,
      bloomThreshold: 0.75,
      bloomKnee: 0.45,
      bloomRadius: 1.0,
      exposure: 1.08,
      vignette: 0.5,
      grain: 0.01,
      aberration: 0.04,
    },

    async init({ quality }) {
      pass = new FullScreenPass(new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: FRAG,
        uniforms: {
          uResolution: { value: new THREE.Vector2(1, 1) },
          uPhase: { value: 0 },
          uCamPos: { value: new THREE.Vector3() },
          uCamBasis: { value: new THREE.Matrix3() },
          uFocal: { value: 1.6 },
          uJitter: { value: new THREE.Vector2() },
          uSteps: { value: Math.round(140 * quality.steps) },
          uScale: { value: 7.4 },
          uShell: { value: 0.5 },
          uRadius: { value: 1.55 },
          uTint: { value: new THREE.Vector3(0.16, 0.22, 0.36) },
          uKey: { value: new THREE.Vector3(1.0, 0.90, 0.80) },
          uFill: { value: new THREE.Vector3(0.30, 0.52, 1.0) },
        },
        depthTest: false,
        depthWrite: false,
      }));

      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    },

    resize(width, height) {
      pass.material.uniforms.uResolution.value.set(width, height);
    },

    render(renderer, target, { phase, jitter }) {
      const u = pass.material.uniforms;
      u.uPhase.value = phase;
      u.uJitter.value.set(jitter ? jitter[0] : 0, jitter ? jitter[1] : 0);

      // Closed camera path: a gentle arc that returns to its start.
      const a = Math.PI * 2 * phase;
      camera.position.set(
        Math.sin(a) * 0.75,
        0.5 + Math.sin(a * 2) * 0.28,
        5.8 + Math.cos(a) * 0.45,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      u.uCamPos.value.copy(camera.position);
      u.uCamBasis.value.setFromMatrix4(camera.matrixWorld);

      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.setRenderTarget(null);
      pass.render(renderer, target);
    },

    dispose() {
      pass?.dispose();
    },
  };
}
