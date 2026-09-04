import * as THREE from 'three';
import { toyMaterial } from '../style.js';

// EXPERIMENT 1: the smooth mound. Half an ellipsoid, 1.8 long, 0.9 across,
// 0.5 tall, in a warm earth colour. This is here to be looked at and, if the
// ledger stone is right, thrown away.
export const HEAP = { length: 1.8, spread: 0.9, height: 0.5 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDirtPile({ seed = 1, scale = 1, length = HEAP.length, spread = HEAP.spread, height = HEAP.height } = {}) {
  const rng = mulberry32(seed * 2654435761 + 91);
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(0.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(length, height * 2, spread);
  // A little wander so it is not a perfect dome.
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.06 * Math.sin(v.x * 5.3 + seed) + 0.05 * Math.sin(v.z * 7.1 - seed);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();

  const material = toyMaterial('#9b8468');
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.scale.setScalar(scale);
  rng();

  return {
    group,
    update() {},
    dispose() { geo.dispose(); material.dispose(); },
  };
}
