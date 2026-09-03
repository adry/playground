import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { compile } from './kit.js';
import buildWall from './wall.js';
import buildArch from './arch.js';
import buildTower from './tower.js';
import buildStones from './stones.js';

// Assembles a ruined castle from the piece builders.
//
// The layout is deliberate rather than a uniform sprinkle: a broken arc of
// curtain wall with towers on it, a cluster of standing fragments where a keep
// would have been, and loose stone thickening around both. Random placement
// reads as scattered props; this reads as something that used to be a building.
//
// Every piece is baked into one static geometry, since nothing here moves.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDERS = { wall: buildWall, arch: buildArch, tower: buildTower, stones: buildStones };

export function createRuins({
  seed = 20260903,
  clearRadius = 2.3,
  color = '#a9a294',
} = {}) {
  const rand = mulberry32(seed);

  const placed = [];   // { x, z, radius } for spacing rejection
  const geometries = [];
  const colliders = [];

  // Rejection sampling on the pieces' own reported footprints, so no two ruins
  // ever intersect. Interpenetrating masonry is the single most obvious tell
  // that a scene was generated.
  function fits(x, z, radius) {
    if (Math.hypot(x, z) < clearRadius + radius * 0.5) return false;
    for (const p of placed) {
      if (Math.hypot(x - p.x, z - p.z) < (radius + p.radius) * 0.82) return false;
    }
    return true;
  }

  function place(type, x, z, yaw) {
    const piece = BUILDERS[type](rand);
    if (!piece || !piece.primitives.length) return false;
    const radius = piece.radius ?? 1;
    if (!fits(x, z, radius)) return false;

    const geo = compile(piece.primitives, rand);
    if (!geo) return false;

    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, 0, z);
    geo.applyMatrix4(m);

    // Per-piece tint, baked in as vertex colour so the whole castle stays one
    // draw call.
    const tint = 0.84 + rand() * 0.3;
    const count = geo.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      col[i * 3] = tint;
      col[i * 3 + 1] = tint * 0.995;
      col[i * 3 + 2] = tint * 0.98;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometries.push(geo);

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const c of piece.colliders || []) {
      // The piece's local collider boxes turn with it, so the box keeps its
      // own half extents and carries the piece's yaw.
      colliders.push({
        x: x + c.x * cos + c.z * sin,
        z: z - c.x * sin + c.z * cos,
        top: c.top,
        hx: c.hx,
        hz: c.hz,
        cos,
        sin,
        circle: false,
        radius: Math.max(c.hx, c.hz),
        bound: Math.hypot(c.hx, c.hz) + 0.05,
      });
    }

    placed.push({ x, z, radius });
    return true;
  }

  // --- a broken arc of curtain wall, with towers standing on it -------------
  const circuit = 8.4 + rand() * 1.6;
  const arcFrom = rand() * Math.PI * 2;
  const arcSpan = Math.PI * 1.15;
  const stations = 11;
  for (let i = 0; i < stations; i++) {
    // Gaps in the circuit: a curtain wall that survived intact all the way
    // round would not be a ruin.
    if (rand() < 0.28) continue;
    const a = arcFrom + (i / (stations - 1)) * arcSpan;
    const r = circuit + (rand() - 0.5) * 0.9;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Tangential, so walls run along the circuit instead of across it.
    const yaw = -a + Math.PI / 2 + (rand() - 0.5) * 0.18;
    const type = i === 2 || i === stations - 3 ? 'tower' : (rand() < 0.22 ? 'arch' : 'wall');
    place(type, x, z, yaw);
  }

  // --- the keep: standing fragments closer in -------------------------------
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3.4 + rand() * 2.6;
    const roll = rand();
    const type = roll < 0.42 ? 'wall' : roll < 0.72 ? 'arch' : 'tower';
    place(type, Math.cos(a) * r, Math.sin(a) * r, rand() * Math.PI * 2);
  }

  // --- loose stone, thickening around whatever is already standing ----------
  for (let i = 0; i < 150; i++) {
    let x;
    let z;
    if (placed.length && rand() < 0.62) {
      const host = placed[Math.floor(rand() * placed.length)];
      const a = rand() * Math.PI * 2;
      const d = host.radius + rand() * 2.2;
      x = host.x + Math.cos(a) * d;
      z = host.z + Math.sin(a) * d;
    } else {
      const a = rand() * Math.PI * 2;
      const r = clearRadius + rand() * 13;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    place('stones', x, z, rand() * Math.PI * 2);
  }

  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  if (!merged) throw new Error('ruins: mergeGeometries failed');
  merged.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0.0,
    vertexColors: true,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  function footprintDistance(c, x, z) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = Math.abs(dx * c.cos + dz * c.sin) - c.hx;
    const lz = Math.abs(-dx * c.sin + dz * c.cos) - c.hz;
    return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  }

  // Height the ghost hovers above at a point. Sampled over a disc a little
  // wider than the ghost and faded at its edge, so the lift starts before the
  // ghost arrives instead of stepping up at a stone's edge.
  function heightAt(x, z, reach = 0.9) {
    let h = 0;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const gate = reach + c.bound;
      if (dx * dx + dz * dz > gate * gate) continue;
      const d = footprintDistance(c, x, z);
      if (d >= reach) continue;
      const t = 1 - d / reach;
      const eased = c.top * (t * t * (3 - 2 * t));
      if (eased > h) h = eased;
    }
    return h;
  }

  return {
    group,
    colliders,
    heightAt,
    footprintDistance,
    stats: {
      pieces: placed.length,
      colliders: colliders.length,
      triangles: merged.attributes.position.count / 3,
    },
  };
}
