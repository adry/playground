import * as THREE from 'three';

// Minimal full-screen triangle helper. A single oversized triangle beats two
// triangles: no diagonal seam, one fewer vertex, and no wasted quad overdraw.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class FullScreenPass {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.material.dispose();
  }
}

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
