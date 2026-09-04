import * as THREE from 'three';

// How many holes one floor can carry at once. Each one costs a rounded-box
// distance test per ground fragment, so this is deliberately small: the
// graveyard has a handful of open graves, not a colander.
export const MAX_GROUND_HOLES = 4;

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
    // Per hole: (centre.x, centre.z, cos(rotY), sin(rotY)) and
    // (halfX, halfZ, cornerRadius, unused). Empty until something registers.
    uHolePose: { value: [] },
    uHoleShape: { value: [] },
  };

  // Footprints punched out of the floor. Kept in registration order; the
  // arrays above are rebuilt whenever the count changes, because the shader
  // declares them at exactly the length it loops over.
  const holes = [];

  function rebuild() {
    const pose = [];
    const shape = [];
    for (const h of holes) {
      pose.push(new THREE.Vector4(h.x, h.z, Math.cos(h.rotation), Math.sin(h.rotation)));
      shape.push(new THREE.Vector4(h.halfX, h.halfZ, h.radius, 0));
    }
    uniforms.uHolePose.value = pose;
    uniforms.uHoleShape.value = shape;
  }

  function write(i) {
    const h = holes[i];
    uniforms.uHolePose.value[i].set(h.x, h.z, Math.cos(h.rotation), Math.sin(h.rotation));
    uniforms.uHoleShape.value[i].set(h.halfX, h.halfZ, h.radius, 0);
  }

  // The count is baked into the compiled program, so it has to be part of the
  // cache key: without this three would hand the material back the program it
  // already has and onBeforeCompile would never run again.
  material.customProgramCacheKey = () => `ground-holes:${holes.length}`;

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

    // Nothing below is injected while no hole is registered, so a floor with
    // no holes compiles the exact source it compiled before any of this
    // existed. That is the guarantee every other page in the project relies on.
    if (holes.length === 0) return;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec4 uHolePose[${holes.length}];
        uniform vec4 uHoleShape[${holes.length}];

        // Signed distance to a rounded rectangle, negative inside.
        float groundHoleSD(vec2 p, vec2 half, float r) {
          vec2 q = abs(p) - (half - vec2(r));
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        void main() {`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        for (int i = 0; i < ${holes.length}; i++) {
          vec4 pose = uHolePose[i];
          vec4 shape = uHoleShape[i];
          vec2 d = vGWorld.xz - pose.xy;
          // Undo the hole's Y rotation: local = transpose(Ry) * world.
          vec2 p = vec2(d.x * pose.z - d.y * pose.w, d.x * pose.w + d.y * pose.z);
          if (groundHoleSD(p, shape.xy, shape.z) < 0.0) discard;
        }`,
      );
  };

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;

  // The floor's own hole registry. addGroundHole() below is the public door;
  // this is here so a hole can find it through the mesh it was handed.
  mesh.userData.groundHoles = {
    max: MAX_GROUND_HOLES,
    add(footprint) {
      if (holes.length >= MAX_GROUND_HOLES) {
        throw new Error(`ground carries at most ${MAX_GROUND_HOLES} holes`);
      }
      const h = { x: 0, z: 0, rotation: 0, halfX: 1, halfZ: 0.5, radius: 0, ...footprint };
      holes.push(h);
      rebuild();
      material.needsUpdate = true;

      let live = true;
      return {
        // Move or resize the footprint. Cheap: no recompile, one uniform write.
        set(next) {
          if (!live) return;
          Object.assign(h, next);
          write(holes.indexOf(h));
        },
        remove() {
          if (!live) return;
          live = false;
          const i = holes.indexOf(h);
          if (i >= 0) holes.splice(i, 1);
          rebuild();
          material.needsUpdate = true;
        },
      };
    },
  };

  return mesh;
}

// Punch a rounded-rectangle hole in a floor made by createGround().
//
// The floor is one opaque plane, so anything modelled below y = 0 is invisible
// until the plane is cut. It is cut here, in the fragment shader: the test is
// a rounded-box distance in the hole's own frame and fragments inside it are
// discarded. Exact, order-independent, no extra draw call, and it composes
// with several holes at once.
//
//   const cut = addGroundHole(ground, { x: 2, z: -1, halfX: 1.1, halfZ: 0.6, radius: 0.3 });
//   cut.set({ x: 3 });   // move it
//   cut.remove();        // floor is whole again
//
// Whatever fills the hole has to cover the cut from every angle the camera can
// reach, or you will see straight through the world. createGraveHole() in
// props/ground/hole.js does that with a lip that overhangs the cut edge.
export function addGroundHole(ground, footprint = {}) {
  const registry = ground?.userData?.groundHoles;
  if (!registry) throw new Error('addGroundHole() wants the mesh returned by createGround()');
  return registry.add(footprint);
}
