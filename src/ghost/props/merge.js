import * as THREE from 'three';

// Turning a pile of meshes into one mesh.
//
// Every prop in this set is built as a little scene graph -- a slab, a plinth,
// a finial, seven pickets and two posts -- and every node of that graph is a
// draw call, twice over once the shadow pass has had its turn. The graph is the
// right way to AUTHOR a prop and the wrong way to DRAW one, and this file is
// the join between the two: build however you like, then flatten before the
// prop goes into a scene.
//
// Two rules, and they are the whole of it:
//
//   1. Only `position`, `normal` and `tangent` are spatial. Everything else --
//      colour, uv, and the fence's aGrain and aBoard -- is carried across
//      verbatim. That is what lets the fence keep a per-board grain after its
//      boards have been baked into one buffer: aBoard holds each vertex's
//      position in the board's own space, the merge does not touch it, and the
//      shader reads the grain off it instead of off the merged position.
//
//   2. Meshes only merge when nothing but their geometry differs. Material,
//      castShadow, receiveShadow, renderOrder, frustumCulled and visible are
//      all part of the key, so flattening can never quietly change what a mesh
//      does -- it can only change how many of them there are.

// Which attributes move when the geometry does.
const POSITIONAL = new Set(['position']);
const DIRECTIONAL = new Set(['normal', 'tangent']);

// One geometry from many, each with its own transform.
//
//   entries: [{ geometry, matrix }]   matrix optional, identity if absent
//
// The attribute set is the INTERSECTION of the inputs', because a merged buffer
// with a missing attribute on some of its vertices is worse than one without
// the attribute at all: three would read whatever happened to be at index zero.
export function mergeGeometries(entries) {
  const list = entries.filter((e) => e && e.geometry);
  if (!list.length) return null;
  if (list.length === 1 && !list[0].matrix) return list[0].geometry;

  let names = Object.keys(list[0].geometry.attributes);
  for (const e of list) {
    const has = e.geometry.attributes;
    names = names.filter((n) => has[n] && has[n].itemSize === list[0].geometry.attributes[n].itemSize);
  }
  if (!names.includes('position')) return null;

  let vertexCount = 0;
  let indexCount = 0;
  for (const e of list) {
    const g = e.geometry;
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  const buffers = {};
  for (const n of names) {
    const size = list[0].geometry.attributes[n].itemSize;
    buffers[n] = { size, data: new Float32Array(vertexCount * size) };
  }
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vOff = 0;
  let iOff = 0;
  for (const e of list) {
    const g = e.geometry;
    const m = e.matrix || null;
    if (m) nm.getNormalMatrix(m);
    const count = g.attributes.position.count;
    for (const n of names) {
      const src = g.attributes[n];
      const dst = buffers[n];
      const size = dst.size;
      if (m && POSITIONAL.has(n)) {
        for (let i = 0; i < count; i++) {
          v.fromBufferAttribute(src, i).applyMatrix4(m);
          dst.data[(vOff + i) * size] = v.x;
          dst.data[(vOff + i) * size + 1] = v.y;
          dst.data[(vOff + i) * size + 2] = v.z;
        }
      } else if (m && DIRECTIONAL.has(n)) {
        for (let i = 0; i < count; i++) {
          v.fromBufferAttribute(src, i).applyMatrix3(nm).normalize();
          dst.data[(vOff + i) * size] = v.x;
          dst.data[(vOff + i) * size + 1] = v.y;
          dst.data[(vOff + i) * size + 2] = v.z;
          // A tangent is a vec4; its handedness rides in w and is not spatial.
          if (size === 4) dst.data[(vOff + i) * size + 3] = src.getW(i);
        }
      } else {
        for (let i = 0; i < count * size; i++) dst.data[vOff * size + i] = src.array[i];
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[iOff + i] = g.index.array[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < count; i++) index[iOff + i] = vOff + i;
      iOff += count;
    }
    vOff += count;
  }

  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(buffers[n].data, buffers[n].size));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Everything under `root` collapsed to one mesh per material.
//
// The transforms are baked relative to `root`, so the returned meshes sit at
// root's own origin and the caller keeps owning root's position and rotation.
// Nested groups, leans and sinks all survive; per-frame animation of a child
// does NOT, which is why this is opt-in and why anything that moves is left
// where it is.
//
// Anything the merge cannot swallow is returned in `kept` and re-parented
// unchanged: skinned meshes, instanced meshes, meshes with a material array or
// geometry groups, points and lines. A prop is never silently broken by being
// flattened; at worst it is not flattened.
export function flattenByMaterial(root, { onlyStatic = true } = {}) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();

  const groups = new Map();
  const kept = [];
  const originals = [];

  root.traverse((o) => {
    if (o === root) return;
    if (!o.isMesh) {
      if (o.isPoints || o.isLine) kept.push(o);
      return;
    }
    originals.push(o);
    const bad = o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh
      || Array.isArray(o.material)
      || (o.geometry.groups && o.geometry.groups.length > 1)
      || o.morphTargetInfluences
      || (onlyStatic && o.userData.animated === true);
    if (bad) { kept.push(o); return; }
    const key = [
      o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder,
      o.frustumCulled, o.visible, o.layers.mask,
    ].join('|');
    let g = groups.get(key);
    if (!g) { g = { mesh: o, entries: [] }; groups.set(key, g); }
    g.entries.push({ geometry: o.geometry, matrix: inverse.clone().multiply(o.matrixWorld) });
  });

  if (!groups.size) return { merged: [], kept, geometries: [] };

  const merged = [];
  const geometries = [];
  for (const { mesh, entries } of groups.values()) {
    const geo = entries.length === 1
      ? applyMatrix(entries[0].geometry, entries[0].matrix)
      : mergeGeometries(entries);
    if (!geo) { kept.push(mesh); continue; }
    geometries.push(geo);
    const out = new THREE.Mesh(geo, mesh.material);
    out.castShadow = mesh.castShadow;
    out.receiveShadow = mesh.receiveShadow;
    out.renderOrder = mesh.renderOrder;
    out.frustumCulled = mesh.frustumCulled;
    out.visible = mesh.visible;
    out.layers.mask = mesh.layers.mask;
    merged.push(out);
  }

  // Detach in a second pass: mutating the graph inside traverse skips nodes.
  for (const o of originals) o.parent?.remove(o);
  for (const o of kept) if (o.parent !== root) root.add(o);
  for (const m of merged) root.add(m);
  return { merged, kept, geometries };
}

// A single geometry with a transform baked in, without going through the merge
// path. Used when a material has exactly one mesh under it, which is the common
// case for a stone's one extra piece.
function applyMatrix(geometry, matrix) {
  if (!matrix || matrixIsIdentity(matrix)) return geometry;
  const geo = geometry.clone();
  geo.applyMatrix4(matrix);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function matrixIsIdentity(m) {
  const e = m.elements;
  return e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0
    && e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0
    && e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0
    && e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1;
}
