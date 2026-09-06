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

  // Materials on OTHER meshes that must be cut by the same holes. The floor is
  // no longer the only opaque thing at y = 0: the ground cover lays a second
  // surface over it, and a hole cut in the floor alone is a hole with a lawn
  // stretched across it. See cutWithGroundHoles below.
  const followers = new Set();

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
        float groundHoleSD(vec2 p, vec2 ext, float r) {
          vec2 q = abs(p) - (ext - vec2(r));
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
    // For cutWithGroundHoles: the live count, the shared uniforms, and the set
    // of materials to recompile when the count changes.
    holeCount: () => holes.length,
    uniforms,
    followers,
    add(footprint) {
      if (holes.length >= MAX_GROUND_HOLES) {
        throw new Error(`ground carries at most ${MAX_GROUND_HOLES} holes`);
      }
      const h = { x: 0, z: 0, rotation: 0, halfX: 1, halfZ: 0.5, radius: 0, ...footprint };
      holes.push(h);
      rebuild();
      material.needsUpdate = true;
      for (const m of followers) m.needsUpdate = true;

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
          for (const m of followers) m.needsUpdate = true;
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

// Cut a material by the same holes the floor is cut by.
//
// THE PROBLEM THIS SOLVES, because it is not obvious from either side. A grave
// hole is not geometry, it is a discard in the FLOOR's fragment shader: the pit
// is modelled below y = 0 and would be invisible, so the floor is told to stop
// drawing over it. That worked while the floor was the only opaque thing at
// y = 0, which was true when hole.js was written and stopped being true when
// the ground cover arrived. Paint grass over a grave and the pit vanishes, not
// because the floor healed but because a second surface is now stretched across
// it. The owner reported exactly that.
//
// So a hole has to cut every surface lying on the floor, and the honest way to
// say that is once, here, rather than by each surface reimplementing the same
// signed distance. The material shares the floor's own uniform objects, so it
// needs no updating when a hole moves, and it joins the floor's follower set so
// it recompiles when the COUNT changes, which is the one thing baked into the
// program.
//
//   cutWithGroundHoles(coverMaterial, ground);   // ground = createGround()'s mesh
//
// Safe to call on a floor with no holes: it injects nothing, exactly as the
// floor does, so a page that never digs a grave compiles what it always did.
export function cutWithGroundHoles(material, ground) {
  const reg = ground?.userData?.groundHoles;
  if (!material || !reg) return material;

  reg.followers.add(material);

  // The count is in the compiled program, so it has to be in the cache key or
  // three hands back the program it already has and onBeforeCompile never runs
  // again. This is the same trap the floor's own material documents.
  //
  // Only an OWN key is chained. three's default implementation returns
  // `onBeforeCompile.toString()`, so chaining that would put this entire
  // function, injected shader source and all, into the key of every cover
  // material and rebuild that string on every frame the renderer asks. The
  // default's purpose is to notice that the hook changed, and the hook here is
  // fixed: what varies is the count, which is already in the key.
  const ownKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.customProgramCacheKey = () =>
    `${ownKey ? ownKey() : ''}|ground-holes:${reg.holeCount()}`;

  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    const n = reg.holeCount();
    if (n === 0) return;
    Object.assign(shader.uniforms, {
      uHolePose: reg.uniforms.uHolePose,
      uHoleShape: reg.uniforms.uHoleShape,
    });

    // A separate varying from the floor's vGWorld, because this material may
    // already carry one and two declarations of the same name will not compile.
    shader.vertexShader = `varying vec3 vHoleWorld;\n${shader.vertexShader}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vHoleWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vHoleWorld;
        uniform vec4 uHolePose[${n}];
        uniform vec4 uHoleShape[${n}];

        float groundHoleCutSD(vec2 p, vec2 ext, float r) {
          vec2 q = abs(p) - (ext - vec2(r));
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        void main() {`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        for (int i = 0; i < ${n}; i++) {
          vec4 pose = uHolePose[i];
          vec4 shape = uHoleShape[i];
          vec2 d = vHoleWorld.xz - pose.xy;
          vec2 p = vec2(d.x * pose.z - d.y * pose.w, d.x * pose.w + d.y * pose.z);
          if (groundHoleCutSD(p, shape.xy, shape.z) < 0.0) discard;
        }`,
      );
  };
  material.needsUpdate = true;
  return material;
}
