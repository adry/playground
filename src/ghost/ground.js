import * as THREE from 'three';

// A large grey floor with an anti-aliased grid derived from world position.
// The grid is not decoration: with a camera that follows the ghost, it is the
// only thing that tells you the ghost is moving rather than the world.
export function createGround({
  color = '#8f949e',
  lineColor = '#7a7f8a',
  cell = 1.0,
  size = 400,
  fadeStart = 16,
  fadeEnd = 40,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0.0,
  });

  const uniforms = {
    uCell: { value: cell },
    uLine: { value: new THREE.Color(lineColor).convertSRGBToLinear() },
    uFocus: { value: new THREE.Vector3() },
    uFade: { value: new THREE.Vector2(fadeStart, fadeEnd) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `varying vec3 vGWorld;\n${shader.vertexShader}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = `
      varying vec3 vGWorld;
      uniform float uCell;
      uniform vec3 uLine;
      uniform vec3 uFocus;
      uniform vec2 uFade;
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec2 c = vGWorld.xz / uCell;
        // Screen-space derivative gives a line that stays one pixel wide at any
        // distance instead of aliasing into moire.
        vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        float minor = 1.0 - min(min(g.x, g.y), 1.0);

        vec2 c2 = vGWorld.xz / (uCell * 5.0);
        vec2 g2 = abs(fract(c2 - 0.5) - 0.5) / fwidth(c2);
        float major = 1.0 - min(min(g2.x, g2.y), 1.0);

        float d = distance(vGWorld.xz, uFocus.xz);
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, d);

        diffuseColor.rgb = mix(diffuseColor.rgb, uLine, minor * 0.35 * fade);
        diffuseColor.rgb = mix(diffuseColor.rgb, uLine, major * 0.55 * fade);
      }`,
    );
  };

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
