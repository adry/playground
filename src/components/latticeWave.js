import * as THREE from 'three';
import { noiseGLSL } from '../shaders/lib/noise.glsl.js';
import { colorGLSL } from '../shaders/lib/color.glsl.js';
import { Stage } from '../engine/stage.js';
import { createBackdrop } from '../engine/backdrop.js';
import { applyJitter } from '../engine/camera.js';

// LATTICE WAVE
// ------------
// A field of instanced rods whose heights are driven by a looping noise field
// plus a radial travelling wave.
//
// Nothing is uploaded per frame. Height, colour and tip glow are all derived in
// the vertex shader from the instance's grid cell and the loop phase, so the
// whole field costs one draw call no matter how many rods it holds.

const VERT = /* glsl */ `
${noiseGLSL}
${colorGLSL}

attribute vec2 aCell;
attribute float aJitter;

uniform float uPhase;
uniform float uNoiseScale;
uniform float uAmplitude;
uniform float uBase;
uniform float uRodWidth;
uniform float uWaveAmp;
uniform float uWaveFreq;
uniform float uSpread;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;

varying vec3 vNormal;
varying vec3 vColor;
varying float vTip;
varying float vDepth;
varying float vHeight;

void main() {
  float radius = length(aCell);

  // Radial travelling wave. Two full cycles per loop keeps it seamless while
  // reading as continuous outward motion.
  float wave = sin(radius * uWaveFreq - TAU * uPhase * 2.0);

  float n = fbmLoop(vec3(aCell * uNoiseScale, 0.0), uPhase, 3, 0.45);

  // Domed falloff so the field has a silhouette rather than a flat horizon.
  float dome = exp(-radius * radius / (uSpread * uSpread));

  float height = uBase + uAmplitude * (0.5 + 0.5 * n) * dome + uWaveAmp * wave * dome;
  height = max(height, 0.02);

  vec3 local = position * vec3(uRodWidth * (0.75 + 0.5 * aJitter), height, uRodWidth * (0.75 + 0.5 * aJitter));
  vec3 world = vec3(aCell.x, 0.0, aCell.y) + local;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  vNormal = normalize(normalMatrix * normal);
  vDepth = -mv.z;
  vHeight = height;
  vTip = smoothstep(0.72, 1.0, position.y);
  vColor = ramp3(clamp(height / (uBase + uAmplitude + uWaveAmp) * 1.15, 0.0, 1.0), uPalA, uPalB, uPalC);
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec3 vColor;
varying float vTip;
varying float vDepth;
varying float vHeight;

uniform vec3 uKey;
uniform vec3 uFill;
uniform float uFog;
uniform float uTipGlow;

void main() {
  vec3 n = normalize(vNormal);
  vec3 keyDir = normalize(vec3(0.45, 0.8, 0.4));
  vec3 fillDir = normalize(vec3(-0.6, 0.15, -0.5));

  float key = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;

  vec3 col = vColor * (0.05 + 0.42 * key) * uKey;
  col += vColor * fill * uFill * 0.3;
  col += vColor * sky * 0.1;

  // Emissive caps. The bloom chain turns these into the field of lights that
  // carries the whole composition.
  col += vColor * vTip * uTipGlow * smoothstep(0.1, 0.8, vHeight);

  col *= exp(-uFog * max(vDepth - 3.0, 0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function latticeWave() {
  let scene, camera, geometry, material, mesh, backdrop;

  return {
    id: 'lattice-wave',
    title: 'Lattice Wave',
    note: 'Ten thousand instanced rods riding a travelling noise field.',
    duration: 6,
    grade: {
      bloom: 0.62,
      bloomThreshold: 0.8,
      bloomKnee: 0.45,
      bloomRadius: 1.05,
      exposure: 1.05,
      vignette: 0.5,
      grain: 0.011,
    },

    async init({ quality }) {
      const side = Math.max(40, Math.round(112 * Math.sqrt(quality.particles)));
      const extent = 4.6;
      const count = side * side;

      const cells = new Float32Array(count * 2);
      const jitter = new Float32Array(count);
      let i = 0;
      for (let x = 0; x < side; x++) {
        for (let z = 0; z < side; z++) {
          cells[i * 2] = ((x + 0.5) / side - 0.5) * 2 * extent;
          cells[i * 2 + 1] = ((z + 0.5) / side - 0.5) * 2 * extent;
          jitter[i] = Math.random();
          i++;
        }
      }

      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      geometry = new THREE.InstancedBufferGeometry();
      geometry.index = box.index;
      geometry.setAttribute('position', box.attributes.position);
      geometry.setAttribute('normal', box.attributes.normal);
      geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      geometry.setAttribute('aJitter', new THREE.InstancedBufferAttribute(jitter, 1));
      geometry.instanceCount = count;
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 2);
      box.dispose();

      material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPhase: { value: 0 },
          uNoiseScale: { value: 0.5 },
          uAmplitude: { value: 1.25 },
          uBase: { value: 0.1 },
          uRodWidth: { value: (2 * extent) / side * 0.42 },
          uWaveAmp: { value: 0.34 },
          uWaveFreq: { value: 3.6 },
          uSpread: { value: 2.9 },
          uFog: { value: 0.055 },
          uTipGlow: { value: 0.85 },
          uKey: { value: new THREE.Vector3(1.0, 0.93, 0.84) },
          uFill: { value: new THREE.Vector3(0.34, 0.52, 1.0) },
          uPalA: { value: new THREE.Vector3(0.06, 0.16, 0.42) },
          uPalB: { value: new THREE.Vector3(0.34, 0.30, 0.92) },
          uPalC: { value: new THREE.Vector3(1.0, 0.55, 0.36) },
        },
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;

      scene = new THREE.Scene();
      backdrop = createBackdrop({ inner: '#17224a', outer: '#04050f', power: 1.3, offset: [0.5, 0.62] });
      scene.add(backdrop);
      scene.add(mesh);

      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    },

    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      backdrop.userData.setAspect(width / height);
    },

    render(renderer, target, { phase, jitter, width, height }) {
      material.uniforms.uPhase.value = phase;

      // A slow closed arc around the field: enough parallax to read the depth,
      // never so much that it becomes a turntable.
      const a = Math.PI * 2 * phase;
      camera.position.set(Math.sin(a) * 1.3, 4.9 + Math.sin(a * 2) * 0.28, 8.4 + Math.cos(a) * 0.55);
      camera.lookAt(0, 0.15, 0);
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
