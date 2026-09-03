import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Broken castle masonry scattered over the floor.
//
// The pieces are decoration and terrain, not walls: the ghost floats over them
// rather than being stopped by them, and the cloth drapes across whatever it
// passes over. Each piece contributes a collider used for both.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Knock the corners off. Welding first means a shared corner moves as one
// piece; splitting again afterwards keeps the facets flat, which is what makes
// it read as cut stone rather than a smooth pebble.
function chip(geometry, amount, rand) {
  const welded = mergeVertices(geometry, 1e-4);
  const pos = welded.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rand() - 0.5) * amount,
      pos.getY(i) + (rand() - 0.5) * amount * 0.7,
      pos.getZ(i) + (rand() - 0.5) * amount,
    );
  }
  const out = welded.toNonIndexed();
  out.computeVertexNormals();
  welded.dispose();
  geometry.dispose();
  return out;
}

function buildVariants(rand) {
  return [
    // Ashlar block: the standard dressed stone of a castle wall.
    { geo: chip(new THREE.BoxGeometry(1, 0.62, 0.8, 2, 2, 2), 0.09, rand), kind: 'box', weight: 4 },
    // Thin slab, fallen flat.
    { geo: chip(new THREE.BoxGeometry(1.15, 0.22, 0.9, 2, 1, 2), 0.07, rand), kind: 'box', weight: 3 },
    // Column drum.
    { geo: chip(new THREE.CylinderGeometry(0.42, 0.45, 0.5, 10, 1), 0.05, rand), kind: 'cyl', weight: 2 },
    // Taller fragment of a broken wall, still standing.
    { geo: chip(new THREE.BoxGeometry(0.72, 1.25, 0.62, 2, 3, 2), 0.1, rand), kind: 'box', weight: 2 },
    // Small rubble.
    { geo: chip(new THREE.BoxGeometry(0.42, 0.3, 0.38, 1, 1, 1), 0.11, rand), kind: 'box', weight: 4 },
  ];
}

export function createObstacles({
  seed = 20260903,
  clusters = 10,
  clearRadius = 2.6,
  spread = 19,
  color = '#a9a294',
} = {}) {
  const rand = mulberry32(seed);
  const variants = buildVariants(rand);

  // Weighted pick, so blocks and rubble outnumber standing wall fragments.
  const bag = [];
  variants.forEach((v, i) => { for (let k = 0; k < v.weight; k++) bag.push(i); });

  const placements = variants.map(() => []);
  const colliders = [];
  const dummy = new THREE.Object3D();

  const sites = [];
  for (let c = 0; c < clusters; c++) {
    const a = rand() * Math.PI * 2;
    const r = clearRadius + rand() * (spread - clearRadius);
    sites.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, n: 3 + Math.floor(rand() * 5) });
  }

  for (const site of sites) {
    for (let i = 0; i < site.n; i++) {
      const vi = bag[Math.floor(rand() * bag.length)];
      const v = variants[vi];

      const a = rand() * Math.PI * 2;
      const d = rand() * 1.9;
      const x = site.x + Math.cos(a) * d;
      const z = site.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < clearRadius) continue; // keep the spawn clear

      const s = 0.62 + rand() * 0.75;
      const yaw = rand() * Math.PI * 2;
      // Tipped a little and settled into the ground, so nothing looks placed.
      const tilt = (rand() - 0.5) * 0.26;
      const roll = (rand() - 0.5) * 0.26;

      const box = new THREE.Box3().setFromBufferAttribute(v.geo.attributes.position);
      const size = box.getSize(new THREE.Vector3());
      const height = size.y * s;
      const sink = height * (0.1 + rand() * 0.16);
      const y = height * 0.5 - sink;

      dummy.position.set(x, y, z);
      dummy.rotation.set(tilt, yaw, roll);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      placements[vi].push({
        matrix: dummy.matrix.clone(),
        tint: 0.84 + rand() * 0.3,
      });

      const top = height - sink;
      const hx = (size.x * s) / 2;
      const hz = (size.z * s) / 2;
      colliders.push({
        x,
        z,
        top,
        cos: Math.cos(yaw),
        sin: Math.sin(yaw),
        hx: v.kind === 'cyl' ? hx * 0.92 : hx,
        hz: v.kind === 'cyl' ? hz * 0.92 : hz,
        circle: v.kind === 'cyl',
        radius: Math.max(hx, hz),
        // Broad-phase reject before any oriented-box maths.
        bound: Math.hypot(hx, hz) + 0.05,
      });
    }
  }

  const group = new THREE.Group();

  variants.forEach((v, i) => {
    const list = placements[i];
    if (list.length === 0) return;
    const material = new THREE.MeshStandardMaterial({
      // The stone colour lives on the material, where three handles the colour
      // space conversion. Instance colour is only a multiplier around 1, so it
      // varies the pieces without depending on how it is interpreted.
      color,
      roughness: 0.96,
      metalness: 0.0,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(v.geo, material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    list.forEach((p, k) => {
      mesh.setMatrixAt(k, p.matrix);
      mesh.setColorAt(k, new THREE.Color().setRGB(p.tint, p.tint * 0.995, p.tint * 0.985));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  });

  // Horizontal distance from a point to a piece's footprint; 0 when inside it.
  function footprintDistance(c, x, z) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (c.circle) return Math.max(Math.hypot(dx, dz) - c.radius, 0);
    const lx = Math.abs(dx * c.cos + dz * c.sin) - c.hx;
    const lz = Math.abs(-dx * c.sin + dz * c.cos) - c.hz;
    return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  }

  // Height the ghost should hover above at a point. Sampled over a disc a
  // little wider than the ghost and faded at its edge, so the lift starts
  // before the ghost is over a stone instead of stepping up at its edge.
  function heightAt(x, z, reach = 0.9) {
    let h = 0;
    for (const c of colliders) {
      const d = footprintDistance(c, x, z);
      if (d >= reach) continue;
      const t = 1 - d / reach;
      h = Math.max(h, c.top * (t * t * (3 - 2 * t)));
    }
    return h;
  }

  return { group, colliders, heightAt, footprintDistance };
}
