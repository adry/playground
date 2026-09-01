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

// Halton(2,3): a low-discrepancy sequence. Used to nudge the projection by a
// fraction of a pixel on each accumulated sub-frame, which turns the motion
// blur buffer into a supersampled anti-aliaser at no extra cost.
function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export function jitterOffset(subframeIndex) {
  return JITTER[subframeIndex % JITTER.length];
}

// Applies a sub-pixel offset to an already-updated projection matrix.
export function applyJitter(camera, jitter, width, height) {
  if (!jitter) return;
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] += (jitter[0] * 2) / width;
  camera.projectionMatrix.elements[9] += (jitter[1] * 2) / height;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
