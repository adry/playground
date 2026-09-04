import * as THREE from 'three';
import M from '../metrics.js';

// The shared bone vocabulary.
//
// Four agents build different parts of this skeleton. If each invents its own
// way to draw a shaft, the figure comes out looking like four sets of bones in
// a bag, and no amount of correct anatomy fixes that. So every bone in the
// character is one of the primitives below, and the toy look lives here rather
// than being re-decided part by part.
//
// The look, stated once: a shaft is a swept tube that is fattest at its ends
// and waisted in the middle; a joint is a ball a little larger than the shaft
// end it caps; nothing has a hard edge anywhere.

export const BONE_COLOR = '#f2e6d2';   // warm ivory, slightly pink. Not white.

export function boneMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(BONE_COLOR),
    roughness: 0.72,
    metalness: 0.0,
    ...options,
  });
}

const RADIAL = 20;   // enough that a shaft's silhouette is smooth at prop size

// A long bone: swept along `path`, fat at both ends, waisted in between.
//
// `path` is a THREE.Curve. `r` is the end radius; the waist is M.shaftWaist of
// it. `endBias` shifts where the fattening starts, so a femur can be more
// swollen at the knee than at the hip the way a real one is.
// NOTE: TubeGeometry has no end caps either, so a free end reads as a chip out
// of the bone. Cap every free end with a bulb, or bury it inside the next one.
export function shaft(path, r, { waist = M.shaftWaist, endBias = 0.5, segments = 28 } = {}) {
  const geo = new THREE.TubeGeometry(path, segments, 1, RADIAL, false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const centre = new THREE.Vector3();

  // TubeGeometry lays vertices out ring by ring, so a vertex's ring index gives
  // its position along the path directly. Rescale each ring about its own
  // centre rather than rebuilding the sweep.
  const rings = segments + 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Distance from the nearer end, remapped so endBias moves the shoulder of
    // the curve without changing the values at t=0 and t=1.
    const d = Math.min(t, 1 - t) / 0.5;
    const k = Math.pow(d, Math.max(0.05, endBias) * 2);
    const radius = r * (1 - (1 - waist) * k);

    centre.copy(path.getPointAt(t));
    for (let j = 0; j <= RADIAL; j++) {
      const idx = i * (RADIAL + 1) + j;
      if (idx >= pos.count) break;
      v.fromBufferAttribute(pos, idx).sub(centre).setLength(radius).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  void rings;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A straight shaft between two points, with an optional sideways bow. Most
// bones want this rather than authoring a curve by hand.
export function straightShaft(a, b, r, { bow = 0, bowAxis = null, ...rest } = {}) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  if (bow !== 0) {
    const axis = bowAxis
      ? bowAxis.clone().normalize()
      : new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 0, 1)).normalize();
    mid.addScaledVector(axis, bow * a.distanceTo(b));
  }
  return shaft(new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone()), r, rest);
}

// A joint bulb. Slightly squashed along its own axis so it reads as a condyle
// rather than a bead threaded on a stick.
export function jointBall(r, { squash = 0.88, axis = null } = {}) {
  const geo = new THREE.SphereGeometry(r * M.jointBallScale, 24, 18);
  if (squash !== 1) {
    geo.scale(1, squash, 1);
    if (axis) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
      geo.applyQuaternion(q);
    }
  }
  return geo;
}

// A flat bone: scapula, hip plate, sternum, sacrum. An extruded outline with a
// generous bevel, because a flat plate with a sharp rim is the one thing that
// breaks the vinyl look fastest.
//
// `points` is an array of THREE.Vector2 tracing the outline once.
// bevelOffset must stay 0: with a negative bevelSize three's extruder silently
// stops cutting the shape's holes, which is a long afternoon to rediscover.
// bevelSegments is a parameter rather than a constant because 4 puts four
// visible facet bands round the rim of a thick plate with a generous bevel.
// Raise it for anything seen edge-on.
export function plate(points, thickness, { bevel = 0.4, holes = [], curveSegments = 16, bevelSegments = 4 } = {}) {
  const shape = new THREE.Shape(points);
  for (const h of holes) shape.holes.push(new THREE.Path(h));
  const b = thickness * bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, thickness - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -(thickness - 2 * b) / 2);
  geo.computeVertexNormals();
  return geo;
}

// A vertebra drum: fattest at its two rims and waisted in the middle, which is
// the real endplate profile. Consecutive drums then interpenetrate at the
// waist, which is what lets the column read as segmented and continuous at the
// same time, and why a bent spine does not crack open.
//
// This is a lathe, so it has NO END CAPS, and because a rim is wider than the
// waist it overlaps, the annulus between them is a see-through hole. It showed
// as a sawtooth down the lumbar column at full bend before anyone noticed.
// Cap both rim planes, or bury them.
export function drum(r, h, { waist = 0.74 } = {}) {
  const pts = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = (t - 0.5) * h;
    const k = Math.abs(t - 0.5) * 2;
    pts.push(new THREE.Vector2(r * (waist + (1 - waist) * k * k), y));
  }
  const geo = new THREE.LatheGeometry(pts, RADIAL);
  geo.computeVertexNormals();
  return geo;
}
