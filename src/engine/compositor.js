import * as THREE from 'three';
import { FullScreenPass, FULLSCREEN_VERT } from './fullscreen.js';
import { colorGLSL } from '../shaders/lib/color.glsl.js';

// The compositor owns everything that happens after a component has drawn its
// frame:
//
//   1. sub-frame accumulation  -> real motion blur, the single biggest win for
//      perceived smoothness once the clip is re-encoded by a social platform
//   2. bloom                   -> the glow that makes emissive work read
//   3. tone map + dither       -> one consistent curve, no banding
//
// Everything upstream stays in linear light in a half-float buffer.

const COPY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uWeight;
void main() {
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uWeight, 1.0);
}
`;

const THRESHOLD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  // Soft knee so the bloom ramps in instead of popping at the threshold.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

// 13-tap downsample (Jimenez / "Next Generation Post Processing"). Kills the
// fireflies that a naive box filter turns into flickering sparkle.
const DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
vec3 t(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = t(vec2(-2.0, 2.0)), b = t(vec2(0.0, 2.0)), c = t(vec2(2.0, 2.0));
  vec3 d = t(vec2(-2.0, 0.0)), e = t(vec2(0.0, 0.0)), f = t(vec2(2.0, 0.0));
  vec3 g = t(vec2(-2.0, -2.0)), h = t(vec2(0.0, -2.0)), i = t(vec2(2.0, -2.0));
  vec3 j = t(vec2(-1.0, 1.0)), k = t(vec2(1.0, 1.0));
  vec3 l = t(vec2(-1.0, -1.0)), m = t(vec2(1.0, -1.0));
  vec3 col = e * 0.125;
  col += (a + c + g + i) * 0.03125;
  col += (b + d + f + h) * 0.0625;
  col += (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}
`;

// 9-tap tent upsample, added onto the next level up.
const UP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
vec3 t(vec2 o) { return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 col = t(vec2(-1.0, 1.0)) + t(vec2(0.0, 1.0)) * 2.0 + t(vec2(1.0, 1.0));
  col += t(vec2(-1.0, 0.0)) * 2.0 + t(vec2(0.0, 0.0)) * 4.0 + t(vec2(1.0, 0.0)) * 2.0;
  col += t(vec2(-1.0, -1.0)) + t(vec2(0.0, -1.0)) * 2.0 + t(vec2(1.0, -1.0));
  gl_FragColor = vec4(col / 16.0, 1.0);
}
`;

const PRESENT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uBloom;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uSeed;
uniform float uAberration;

${colorGLSL}

void main() {
  vec2 uv = vUv;
  vec3 scene;
  if (uAberration > 0.0) {
    // Radial channel split, strongest at the frame edge.
    vec2 dir = uv - 0.5;
    float amt = uAberration * dot(dir, dir);
    scene.r = texture2D(tScene, uv - dir * amt).r;
    scene.g = texture2D(tScene, uv).g;
    scene.b = texture2D(tScene, uv + dir * amt).b;
  } else {
    scene = texture2D(tScene, uv).rgb;
  }

  vec3 col = scene + texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;

  float v = 1.0 - uVignette * dot(uv - 0.5, uv - 0.5) * 2.0;
  col *= clamp(v, 0.0, 1.0);

  col = acesFilmic(col);
  col = linearToSRGB(col);

  // Grain after encoding so it stays perceptually even across the tone range.
  if (uGrain > 0.0) {
    float g = hash12(gl_FragCoord.xy + uSeed * 37.19) - 0.5;
    col += g * uGrain;
  }
  col += tpdfDither(gl_FragCoord.xy, uSeed);

  gl_FragColor = vec4(col, 1.0);
}
`;

const RT_OPTIONS = {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  colorSpace: THREE.LinearSRGBColorSpace,
};

export class Compositor {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.levels = options.bloomLevels ?? 5;
    this.grade = {
      bloom: 0.55,
      bloomThreshold: 0.85,
      bloomKnee: 0.4,
      bloomRadius: 1.0,
      exposure: 1.0,
      vignette: 0.35,
      grain: 0.012,
      aberration: 0.0,
      ...options.grade,
    };

    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { ...RT_OPTIONS, depthBuffer: true });
    this.accumTarget = new THREE.WebGLRenderTarget(1, 1, RT_OPTIONS);
    this.brightTarget = new THREE.WebGLRenderTarget(1, 1, RT_OPTIONS);
    this.mips = [];

    this.accumPass = new FullScreenPass(new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tSrc: { value: null }, uWeight: { value: 1 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }));

    this.thresholdPass = new FullScreenPass(new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: THRESHOLD_FRAG,
      uniforms: {
        tSrc: { value: null },
        uThreshold: { value: this.grade.bloomThreshold },
        uKnee: { value: this.grade.bloomKnee },
      },
      depthTest: false,
      depthWrite: false,
    }));

    this.downPass = new FullScreenPass(new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    }));

    this.upPass = new FullScreenPass(new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: UP_FRAG,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: this.grade.bloomRadius },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }));

    this.presentPass = new FullScreenPass(new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: PRESENT_FRAG,
      uniforms: {
        tScene: { value: this.accumTarget.texture },
        tBloom: { value: this.brightTarget.texture },
        uResolution: { value: new THREE.Vector2() },
        uBloom: { value: this.grade.bloom },
        uExposure: { value: this.grade.exposure },
        uVignette: { value: this.grade.vignette },
        uGrain: { value: this.grade.grain },
        uAberration: { value: this.grade.aberration },
        uSeed: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    }));
  }

  applyGrade(grade = {}) {
    Object.assign(this.grade, grade);
    const p = this.presentPass.material.uniforms;
    p.uBloom.value = this.grade.bloom;
    p.uExposure.value = this.grade.exposure;
    p.uVignette.value = this.grade.vignette;
    p.uGrain.value = this.grade.grain;
    p.uAberration.value = this.grade.aberration;
    this.thresholdPass.material.uniforms.uThreshold.value = this.grade.bloomThreshold;
    this.thresholdPass.material.uniforms.uKnee.value = this.grade.bloomKnee;
    this.upPass.material.uniforms.uRadius.value = this.grade.bloomRadius;
  }

  setSize(width, height, bloomLevels = this.levels) {
    this.width = width;
    this.height = height;
    this.levels = bloomLevels;

    this.sceneTarget.setSize(width, height);
    this.accumTarget.setSize(width, height);
    this.brightTarget.setSize(width, height);
    this.presentPass.material.uniforms.uResolution.value.set(width, height);

    for (const mip of this.mips) mip.dispose();
    this.mips = [];
    let w = width;
    let h = height;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      const rt = new THREE.WebGLRenderTarget(w, h, RT_OPTIONS);
      this.mips.push(rt);
      if (w === 1 || h === 1) break;
    }
  }

  // --- sub-frame accumulation -------------------------------------------

  beginFrame() {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.accumTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.setRenderTarget(null);
  }

  accumulate(weight) {
    this.accumPass.material.uniforms.tSrc.value = this.sceneTarget.texture;
    this.accumPass.material.uniforms.uWeight.value = weight;
    this.accumPass.render(this.renderer, this.accumTarget);
  }

  // --- bloom + present ---------------------------------------------------

  present(target = null, seed = 0) {
    const renderer = this.renderer;

    this.thresholdPass.material.uniforms.tSrc.value = this.accumTarget.texture;
    this.thresholdPass.render(renderer, this.brightTarget);

    let src = this.brightTarget;
    for (const mip of this.mips) {
      this.downPass.material.uniforms.tSrc.value = src.texture;
      this.downPass.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.downPass.render(renderer, mip);
      src = mip;
    }

    // Progressive additive upsample back to mip 0. The composite is sampled at
    // half resolution on purpose: it is already a blur, and the bilinear fetch
    // costs nothing.
    for (let i = this.mips.length - 1; i >= 1; i--) {
      const from = this.mips[i];
      this.upPass.material.uniforms.tSrc.value = from.texture;
      this.upPass.material.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      this.upPass.render(renderer, this.mips[i - 1]);
    }

    this.presentPass.material.uniforms.tBloom.value = this.mips[0].texture;
    this.presentPass.material.uniforms.uSeed.value = seed;
    this.presentPass.render(renderer, target);
  }

  dispose() {
    this.sceneTarget.dispose();
    this.accumTarget.dispose();
    this.brightTarget.dispose();
    for (const mip of this.mips) mip.dispose();
    this.accumPass.dispose();
    this.thresholdPass.dispose();
    this.downPass.dispose();
    this.upPass.dispose();
    this.presentPass.dispose();
  }
}
