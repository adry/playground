import * as THREE from 'three';

// Camera moves are described as closed orbits so they land exactly where they
// started at phase 1. A tiny bit of parallax does more for perceived depth
// than any amount of extra geometry.
export function loopOrbit(camera, phase, {
  radius = 6,
  height = 1.2,
  sway = 0.35,
  bob = 0.25,
  turns = 1,
  lookAt = new THREE.Vector3(0, 0, 0),
  phaseOffset = 0,
} = {}) {
  const a = Math.PI * 2 * (phase * turns + phaseOffset);
  const r = radius * (1 + sway * 0.08 * Math.sin(a * 2));
  camera.position.set(
    Math.cos(a) * r,
    height + bob * Math.sin(a * 2),
    Math.sin(a) * r,
  );
  camera.lookAt(lookAt);
}

// Slow drifting dolly that never fully orbits: better for scenes that read as
// a flat composition rather than an object on a turntable.
export function loopDrift(camera, phase, {
  base = new THREE.Vector3(0, 0, 6),
  amplitude = new THREE.Vector3(0.6, 0.35, 0.2),
  lookAt = new THREE.Vector3(0, 0, 0),
} = {}) {
  const a = Math.PI * 2 * phase;
  camera.position.set(
    base.x + Math.cos(a) * amplitude.x,
    base.y + Math.sin(a) * amplitude.y,
    base.z + Math.sin(a * 2) * amplitude.z,
  );
  camera.lookAt(lookAt);
}
