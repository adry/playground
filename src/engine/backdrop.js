import * as THREE from 'three';

// A camera-independent gradient backdrop drawn behind everything else. Flat
// black reads as "unfinished" once a platform re-compresses the clip; a slow
// radial falloff gives the encoder something to hold on to and makes the
// bloom sit in a space instead of on a void.
export function createBackdrop({ inner = '#0d1220', outer = '#03040a', power = 1.4, offset = [0.5, 0.55] } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: new THREE.Color(inner).convertSRGBToLinear() },
      uOuter: { value: new THREE.Color(outer).convertSRGBToLinear() },
      uPower: { value: power },
      uOffset: { value: new THREE.Vector2(offset[0], offset[1]) },
      uAspect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform vec3 uInner;
      uniform vec3 uOuter;
      uniform float uPower;
      uniform float uAspect;
      uniform vec2 uOffset;
      void main() {
        vec2 d = (vUv - uOffset) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0));
        float r = clamp(length(d) * 1.35, 0.0, 1.0);
        gl_FragColor = vec4(mix(uInner, uOuter, pow(r, uPower)), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.setAspect = (aspect) => { material.uniforms.uAspect.value = aspect; };
  return mesh;
}
