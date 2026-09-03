import * as THREE from 'three';
import { toyMaterial, PALETTE } from './style.js';

// Placeholder. Replaced by the pumpkin asset.
export function createPumpkin() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), toyMaterial(PALETTE.pumpkinSkin));
  mesh.position.y = 0.4;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, update() {}, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); } };
}
