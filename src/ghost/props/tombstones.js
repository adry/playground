import * as THREE from 'three';
import { toyMaterial, PALETTE } from './style.js';

// Placeholder. Replaced by the tombstone asset.
export function createTombstone() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.15), toyMaterial(PALETTE.stone));
  mesh.position.y = 0.45;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, update() {}, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); } };
}
