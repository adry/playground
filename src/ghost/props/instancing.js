import * as THREE from 'three';
import { flattenByMaterial } from './merge.js';

// Building a field of props out of a handful of draw calls and a handful of
// bakes.
//
// The problem this solves is not one prop being expensive. It is fifty-seven
// props each being built from scratch, each baking its own thousand-row canvas,
// each carrying its own material, and each arriving as five or six meshes. A
// level of that costs half a minute to build and hundreds of draw calls, and an
// endless world that streams a chunk of it while the player walks cannot pay
// either.
//
// Two ideas, and the second only works because of the first:
//
//   THE CACHE. A prop is built once per KEY and never again. The key is the
//   caller's business -- for this graveyard it is kind, variant and a seed
//   slot -- and the point of a slot is that "a hundred stones" becomes "four
//   bakes of each of twenty-nine stones, built once for the whole run". A chunk
//   that streams in later finds every template already built and pays nothing.
//
//   THE FIELD. Every placement of a key is an instance of that key's meshes.
//   A template is flattened to one mesh per material first, so a stone that was
//   a slab, a plinth and a finial is one instanced draw and not three.
//
// What it costs, stated plainly: two props sharing a key are bit-identical.
// That is the trade the slot count buys back, and it is the caller's number to
// choose. See createPropCache.

export function createPropCache({ build }) {
  // key -> { parts: [{ geometry, material, castShadow, receiveShadow, renderOrder }],
  //          extra: Object3D[]  (anything the flatten could not swallow),
  //          prop }
  const templates = new Map();

  return {
    size: () => templates.size,

    // The template for a key, built on first sight.
    //
    // `build(key)` returns whatever the prop factory returns: an object with a
    // `group`, or a bare Object3D. It is called at most once per key for the
    // life of the cache, so it may be as expensive as it likes.
    get(key) {
      let t = templates.get(key);
      if (t) return t;
      const made = build(key);
      const root = made?.group || made;
      if (!root) return null;
      const { merged } = flattenByMaterial(root);
      // The merged meshes are the instanced half and are taken out of the
      // template; whatever is still hanging off root afterwards is the half
      // that cannot be instanced.
      for (const m of merged) root.remove(m);
      let leftover = false;
      root.traverse((o) => {
        if (o === root) return;
        if (o.isMesh || o.isLight || o.isPoints || o.isLine || o.isSprite) leftover = true;
      });
      t = {
        key,
        prop: made,
        parts: merged.map((m) => ({
          geometry: m.geometry,
          material: m.material,
          castShadow: m.castShadow,
          receiveShadow: m.receiveShadow,
          renderOrder: m.renderOrder,
        })),
        // Anything the flatten could not swallow -- a light, a skinned mesh, a
        // sprite, a mesh with a material array -- is cloned per placement
        // instead. A stone has none of it and instances whole. A jack-o'-lantern
        // carries a spotlight and a point light, so it lands here and pays for
        // itself, which is the correct answer rather than a silently unlit
        // pumpkin.
        extra: leftover ? root : null,
      };
      templates.set(key, t);
      return t;
    },

    // The cache owns its geometries and materials and outlives any one chunk,
    // which is the entire point. This is for tearing the whole page down.
    dispose() {
      for (const t of templates.values()) {
        for (const p of t.parts) { p.geometry.dispose(); p.material.dispose(); }
        t.prop?.dispose?.();
      }
      templates.clear();
    },
  };
}

// One group of InstancedMeshes for a list of placements.
//
//   placements: [{ key, x, y, z, yaw, scale }]
//
// `tile` is the same trade as the fence's: an InstancedMesh is culled whole, so
// placements are grouped into square tiles first and a chunk behind the camera
// still drops out. Nothing else about it matters -- a tile is a culling unit,
// not a world concept.
export function createPropField({ placements = [], cache, tile = 16 }) {
  const group = new THREE.Group();
  const buckets = new Map();

  for (const p of placements) {
    const t = cache.get(p.key);
    if (!t) continue;
    for (let i = 0; i < t.parts.length; i++) {
      const bk = `${p.key}#${i}@${Math.floor(p.x / tile)},${Math.floor(p.z / tile)}`;
      let b = buckets.get(bk);
      if (!b) { b = { part: t.parts[i], items: [] }; buckets.set(bk, b); }
      b.items.push(p);
    }
    // Whatever could not be instanced gets a clone. Rare on purpose: if this is
    // running for most props, the props want fixing, not the field.
    if (t.extra) {
      const c = t.extra.clone();
      c.position.set(p.x, p.y || 0, p.z);
      c.rotation.y = p.yaw || 0;
      if (p.scale) c.scale.multiplyScalar(p.scale);
      group.add(c);
    }
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const at = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(b.part.geometry, b.part.material, b.items.length);
    mesh.castShadow = b.part.castShadow;
    mesh.receiveShadow = b.part.receiveShadow;
    mesh.renderOrder = b.part.renderOrder;
    b.items.forEach((p, i) => {
      e.set(0, p.yaw || 0, 0);
      q.setFromEuler(e);
      at.set(p.x, p.y || 0, p.z);
      sc.setScalar(p.scale || 1);
      m.compose(at, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  return {
    group,
    update() {},
    // The geometries and materials belong to the cache and are NOT freed here.
    // Only the instanced meshes are this field's own.
    dispose() {
      for (const c of group.children) c.dispose?.();
      group.clear();
    },
  };
}
