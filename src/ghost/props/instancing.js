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
//   caller's business -- for this graveyard it is kind, variant and a slot --
//   and the point of a slot is that "a hundred stones" becomes "a handful of
//   bakes of each variant, built once for the run". A chunk that streams in
//   later finds its templates already built and pays nothing for them.
//
//   THE FIELD. Every placement of a key is an instance of that key's meshes.
//   A template is flattened to one mesh per material first, so a stone that was
//   a slab, a plinth and a finial is one instanced draw and not three.
//
// What it costs, stated plainly: two props sharing a key are bit-identical.
// That is the trade the slot count buys back, and it is the caller's number to
// choose. See createPropCache.

// `limit` is the cache's ceiling in TEMPLATES, and an endless world needs one.
//
// A stone's two maps are about 2.8 MB with mips at the shipped 512 rows. One
// level uses twenty-odd templates and the cache is the whole reason a second
// wave costs nothing -- but a long run walks through every variant in the set,
// each up to SLOTS times, and twenty-nine variants at six slots is a hundred
// and seventy-four templates and half a gigabyte of texture. A cache with no
// ceiling is not a cache, it is a leak with good manners.
//
// Eviction is least recently used and only ever takes a template no live field
// is drawing; a field retains what it uses and releases it when its chunk is
// torn down, so nothing in the scene can be evicted out from under it.
//
// 48 is a DIAL, and it has now been argued twice against two different shapes
// of the game, which is worth recording because the second argument replaced
// the first entirely.
//
// It was sized for an endless world, as LRU headroom: one level's worth plus
// half of the next, so the wave being played and the one before it never miss.
// That reasoning is dead. The game is a bounded arena loading an AUTHORED
// level, and a level is built once.
//
// What sizes it now is PREWARMING. A bake is cheap before anything has been
// rendered and dear afterwards -- measured at 319 ms a template against 2,243
// and 5,211 on the two waves after a frame was drawn -- and the only moment a
// page is reliably in the cheap regime is its load. So the templates worth
// baking are the union of the variants of every level the session might open,
// baked at load, and the ceiling has to be AT LEAST that union or prewarming
// evicts itself and is worse than not doing it. Measured on the generator that
// stood in for authored levels, six levels' variants union to 46 distinct
// templates, which is what 48 now holds.
//
// The exchange rate for moving it: about 3 MB of texture and about 0.32 s of
// load per template, on the capture container's software rasteriser, so read
// the ratio rather than the absolute. Size it against the real set of authored
// levels when there is one; until then 46 measured is the best number there is.
export function createPropCache({ build, limit = 48 }) {
  // key -> { parts: [{ geometry, material, castShadow, receiveShadow, renderOrder }],
  //          extra: Object3D  (anything the flatten could not swallow, or null),
  //          prop, refs, used }
  const templates = new Map();
  let clock = 0;

  const free = (t) => {
    for (const p of t.parts) { p.geometry.dispose(); p.material.dispose(); }
    t.prop?.dispose?.();
    templates.delete(t.key);
  };

  return {
    size: () => templates.size,

    // Is this key already built? A field needs to know without building it,
    // because the whole point of the pump below is to decide WHEN to pay.
    peek(key) {
      const t = templates.get(key);
      if (t) t.used = ++clock;
      return t || null;
    },

    // Held by a live field, so it cannot be evicted.
    retain(t) { if (t) t.refs += 1; },
    release(t) { if (t) t.refs = Math.max(0, t.refs - 1); },

    // Drop unreferenced templates, oldest use first, until the cache is inside
    // its ceiling. Called by a field once it has retained what it needs, so the
    // templates this chunk is about to draw are never candidates.
    trim() {
      if (templates.size <= limit) return 0;
      const idle = [...templates.values()].filter((t) => t.refs === 0).sort((a, b) => a.used - b.used);
      let dropped = 0;
      while (templates.size > limit && idle.length) { free(idle.shift()); dropped += 1; }
      return dropped;
    },

    // The template for a key, built on first sight.
    //
    // `build(key)` returns whatever the prop factory returns: an object with a
    // `group`, or a bare Object3D. It is called at most once per key for the
    // life of the cache, so it may be as expensive as it likes.
    get(key) {
      let t = templates.get(key);
      if (t) { t.used = ++clock; return t; }
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
        refs: 0,
        used: ++clock,
      };
      templates.set(key, t);
      return t;
    },

    // The cache owns its geometries and materials and outlives any one chunk,
    // which is the entire point. This is for tearing the whole page down.
    dispose() {
      for (const t of [...templates.values()]) free(t);
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
export function createPropField({ placements = [], cache, tile = 16, spread = true }) {
  const group = new THREE.Group();
  const held = new Set();

  // Templates this field needs and the cache does not have yet.
  //
  // `spread` bakes the missing templates one a frame instead of all at once, so
  // a level fills in rather than stalling. It is OFF by default and scene.js
  // carries the measurement that says why: interleaving a bake with a render
  // puts every bake in the expensive regime and costs ten times more than
  // baking them back to back. The machinery is kept because the finding is
  // specific to a software rasteriser and may not hold on a GPU.
  //
  // Props whose template is already cached are placed immediately either way,
  // which for every wave after the first is most of them.
  const queue = [];
  const ready = [];
  for (const p of placements) {
    const hit = spread ? cache.peek(p.key) : cache.get(p.key);
    if (hit) ready.push([p, hit]);
    else queue.push(p);
  }

  const place = (p, t, buckets) => {
    if (!held.has(t)) { held.add(t); cache.retain?.(t); }
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
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const at = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // Buckets are emitted as soon as their contents are known. A pumped batch
  // adds its own meshes rather than rebuilding every bucket, so a field that
  // fills in over ten frames does ten small pieces of work and not ten
  // increasingly large ones.
  const emit = (buckets) => {
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
  };

  const flush = (items) => {
    const buckets = new Map();
    for (const [p, t] of items) place(p, t, buckets);
    emit(buckets);
  };

  // Everything the cache already had, now.
  flush(ready);

  // Now that this chunk's templates are retained, the cache may drop whatever
  // an older chunk left behind.
  cache.trim?.();

  return {
    group,
    // How many templates are still to bake. Zero means the level is complete.
    get pending() { return queue.length; },
    // Bake at most `budget` milliseconds' worth, then stop. A bake cannot be
    // cut in half, so this overruns by however long the last one took; the
    // budget decides how many are attempted, not how long the frame is.
    pump(budget = 0) {
      if (!queue.length) return 0;
      const t0 = performance.now();
      let done = 0;
      do {
        const p = queue.shift();
        // Every placement of this key at once, or each would get an instanced
        // mesh of its own and the pump would undo the batching it exists to
        // protect.
        const same = [p];
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].key === p.key) same.unshift(queue.splice(i, 1)[0]);
        }
        const t = cache.get(p.key);
        if (t) flush(same.map((q2) => [q2, t]));
        done += 1;
      } while (queue.length && performance.now() - t0 < budget);
      cache.trim?.();
      return done;
    },
    update() {},
    // The geometries and materials belong to the cache and are NOT freed here.
    // Only the instanced meshes are this field's own. Releasing is what makes
    // this chunk's templates evictable again.
    dispose() {
      for (const c of group.children) c.dispose?.();
      group.clear();
      for (const t of held) cache.release?.(t);
      held.clear();
    },
  };
}
