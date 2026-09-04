import * as THREE from 'three';
import F from './metrics.js';

// The shared wood vocabulary.
//
// Several agents build different fence pieces. If each invents its own way to
// draw a board, the fence comes out looking like parts from three different
// kits, and correct geometry will not save it. Every piece of timber in the set
// is one of the primitives below.
//
// The look, stated once: sawn boards that have stood outside for years. Flat
// faces, corners knocked well off, a slight warp along the length so nothing is
// machine-straight, and a pale bleached tone. Same soft vinyl family as the
// pumpkin and the ghost, in wood.

export function woodMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(F.wood.pale),
    roughness: 0.86,
    metalness: 0.0,
    ...options,
  });
}

// Deterministic per-piece randomness. A fence has to look hand-built and has to
// look the SAME hand-built every reload, or a captured video will not loop.
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    return a / 4294967296;
  };
}

// A board: a rounded box, optionally warped along its length and tapered.
//
// Built as a lofted grid rather than a BoxGeometry so the warp is real geometry
// and the corner rounding is part of the same surface. `profile(t)` returns
// [halfWidth, halfThickness] at t in 0..1 along the length, which is what lets
// a picket come to a point and a splinter come to a spike using one primitive.
export function board({
  length,
  width,
  thickness,
  round = 0.35,          // corner radius as a fraction of half-thickness
  warp = 0,              // sideways drift over the length, in world units
  warpAxis = 'x',
  profile = null,
  segments = 14,
  ring = 12,
} = {}) {
  const hw = width / 2;
  const ht = thickness / 2;
  const r = Math.min(round, 0.999) * ht;

  const verts = [];
  const index = [];
  const prof = profile || (() => [1, 1]);

  // A superellipse cross section gives a flat face with a rounded corner in one
  // expression, and the exponent falls out of the radius asked for. Cheaper and
  // smoother than filleting a box after the fact.
  const n = 2 / Math.max(0.06, r / ht);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const [sw, st] = prof(t);
    const y = t * length;
    const drift = warp * Math.sin(Math.PI * t);
    // Note the exclusive bound: the seam vertex is NOT duplicated. A duplicated
    // seam leaves two coincident vertex chains whose normals cannot average, so
    // a hard crease runs down the middle of the board's widest face. It looks
    // like a fold in the timber and it is the first thing the eye finds.
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * hw * sw;
      const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * ht * st;
      verts.push(
        x + (warpAxis === 'x' ? drift : 0),
        y,
        z + (warpAxis === 'z' ? drift : 0),
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring;
      const a = i * ring + j;
      const an = i * ring + jn;
      const b = (i + 1) * ring + j;
      const bn = (i + 1) * ring + jn;
      index.push(a, b, an, b, bn, an);
    }
  }

  // Cap both ends, or an end reads as a hole. A lofted tube has no caps, which
  // has already cost this project time twice on the skeleton.
  const capAt = (i, flip) => {
    const base = i * ring;
    const centre = verts.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < ring; j++) {
      cx += verts[(base + j) * 3]; cy += verts[(base + j) * 3 + 1]; cz += verts[(base + j) * 3 + 2];
    }
    verts.push(cx / ring, cy / ring, cz / ring);
    for (let j = 0; j < ring; j++) {
      const a = base + j, b = base + ((j + 1) % ring);
      if (flip) index.push(centre, b, a); else index.push(centre, a, b);
    }
  };
  // The ring runs x = cos(a), z = sin(a) with a increasing, which is clockwise
  // seen from +Y. So the TOP cap is the one that needs reversing to face up,
  // and the bottom one does not. The first version had these the other way
  // round and both caps faced inward: invisible on a picket's tapered tip, but
  // a post rendered as a hollow tube with a black trough on top.
  capAt(0, false);
  capAt(segments, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// The picket's roof point: two chamfers meeting at an apex. Returned as a
// profile function for board(), so the point is part of the same surface rather
// than a second mesh sitting on top of the first.
export function pointedTop(length, width, rise = F.picket.pointRise, apex = F.picket.apex) {
  const startsAt = 1 - (rise * width) / length;
  return (t) => {
    if (t <= startsAt) return [1, 1];
    const k = (t - startsAt) / Math.max(1e-4, 1 - startsAt);
    // The floor is the apex width, not a token epsilon. Tapering to nothing
    // gives a whittled knife edge; the reference's points are sawn chamfers
    // that stop while there is still board left.
    return [Math.max(apex, 1 - k), Math.max(0.35, 1 - k * 0.5)];
  };
}
