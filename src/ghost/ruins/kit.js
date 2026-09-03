import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Masonry kit.
//
// Ruin builders describe pieces as *primitives* -- dressed blocks, drums,
// arch stones -- never as raw vertex data. Nothing can be inside out, no face
// can be degenerate, and thin details stay thin because they are just thin
// boxes. compile() turns a list of primitives into one merged, flat-shaded
// geometry in the piece's local space, with y = 0 at the ground.

const TAU = Math.PI * 2;

// --- primitive descriptors ---------------------------------------------------

// A dressed rectangular stone. `pos` is its centre, `size` its full extents.
export function block({ pos, size, rot = [0, 0, 0], chip = 0.016 }) {
  return { kind: 'block', pos, size, rot, chip };
}

// A drum or round shaft. Give radiusTop to taper it.
export function drum({ pos, radius, radiusTop = radius, height, seg = 14, rot = [0, 0, 0], chip = 0.012 }) {
  return { kind: 'drum', pos, radius, radiusTop, height, seg, rot, chip };
}

// One stone of an arch ring: an annular sector, extruded across the arch.
// `centre` is the springing point the arch turns about, angles are measured
// from +x toward +y, so 0..PI sweeps a semicircle standing upright.
export function voussoir({
  centre = [0, 0, 0],
  innerR,
  outerR,
  from,
  to,
  thickness,
  chip = 0.012,
}) {
  return { kind: 'voussoir', centre, innerR, outerR, from, to, thickness, chip };
}

// --- geometry ----------------------------------------------------------------

// Knock the corners off. Welding first means a shared corner moves as one, so
// no crack opens between faces; splitting again keeps the facets flat, which is
// what makes it read as cut stone rather than a smooth pebble.
function chipGeometry(geometry, amount, rand) {
  // Must return non-indexed even when there is nothing to chip. The primitives
  // are merged together later, and mergeGeometries refuses a mix of indexed and
  // non-indexed inputs -- so a chip amount that clamped to zero used to break
  // the whole set with an error pointing at the wrong primitive.
  if (amount <= 0) {
    const flat = geometry.toNonIndexed();
    flat.computeVertexNormals();
    geometry.dispose();
    return flat;
  }
  const welded = mergeVertices(geometry, 1e-4);
  const pos = welded.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rand() - 0.5) * amount,
      pos.getY(i) + (rand() - 0.5) * amount,
      pos.getZ(i) + (rand() - 0.5) * amount,
    );
  }
  const out = welded.toNonIndexed();
  out.computeVertexNormals();
  welded.dispose();
  geometry.dispose();
  return out;
}

// An annular sector built as a hexahedron: eight corners, twelve triangles,
// wound outward. Exact by construction, so an arch ring closes properly.
function voussoirGeometry(p) {
  const { innerR, outerR, from, to, thickness } = p;
  if (!(outerR > innerR) || !(thickness > 0) || from === to) {
    throw new Error(`voussoir needs outerR > innerR, positive thickness and from != to`);
  }
  const hz = thickness / 2;
  const c = [];
  for (const a of [from, to]) {
    for (const r of [innerR, outerR]) {
      c.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  // c = [from/inner, from/outer, to/inner, to/outer]
  const v = [];
  const push = (xy, z) => v.push(xy[0], xy[1], z);
  push(c[0], -hz); // 0
  push(c[1], -hz); // 1
  push(c[3], -hz); // 2
  push(c[2], -hz); // 3
  push(c[0], hz);  // 4
  push(c[1], hz);  // 5
  push(c[3], hz);  // 6
  push(c[2], hz);  // 7

  const idx = [
    0, 3, 2, 0, 2, 1, // back face
    4, 5, 6, 4, 6, 7, // front face
    0, 1, 5, 0, 5, 4, // inner? (from-side wall)
    1, 2, 6, 1, 6, 5, // outer arc
    2, 3, 7, 2, 7, 6, // to-side wall
    3, 0, 4, 3, 4, 7, // inner arc
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  const out = geo.toNonIndexed();
  out.computeVertexNormals();
  geo.dispose();
  return out;
}

// The ruins material samples no textures, so UVs are dead weight -- and the
// hand-built voussoir has none, which would make mergeGeometries reject the
// whole set. Keep position and normal only, so every primitive matches.
function stripToPositionNormal(geo) {
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  return geo;
}

function primitiveGeometry(p, rand) {
  let geo;
  let chip = p.chip;

  if (p.kind === 'block') {
    const [w, h, d] = p.size;
    // Fail loudly rather than emitting inverted or zero-area faces, so a
    // builder's arithmetic slip surfaces here instead of as a visual glitch.
    if (!(w > 0) || !(h > 0) || !(d > 0)) {
      throw new Error(`block needs positive extents, got ${w} x ${h} x ${d}`);
    }
    geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
    // Never chip more than a fraction of the thinnest dimension, or a thin
    // slab turns itself inside out.
    chip = Math.min(chip, Math.min(w, h, d) * 0.2);
    geo = stripToPositionNormal(chipGeometry(geo, chip, rand));
    geo.rotateX(p.rot[0]);
    geo.rotateY(p.rot[1]);
    geo.rotateZ(p.rot[2]);
    geo.translate(p.pos[0], p.pos[1], p.pos[2]);
    return geo;
  }

  if (p.kind === 'drum') {
    if (!(p.radius > 0) || !(p.height > 0)) {
      throw new Error(`drum needs positive radius and height, got ${p.radius} / ${p.height}`);
    }
    geo = new THREE.CylinderGeometry(p.radiusTop, p.radius, p.height, p.seg, 1);
    chip = Math.min(chip, Math.min(p.radius, p.height) * 0.15);
    geo = stripToPositionNormal(chipGeometry(geo, chip, rand));
    geo.rotateX(p.rot[0]);
    geo.rotateY(p.rot[1]);
    geo.rotateZ(p.rot[2]);
    geo.translate(p.pos[0], p.pos[1], p.pos[2]);
    return geo;
  }

  if (p.kind === 'voussoir') {
    geo = voussoirGeometry(p);
    chip = Math.min(chip, (p.outerR - p.innerR) * 0.18);
    geo = stripToPositionNormal(chipGeometry(geo, chip, rand));
    geo.translate(p.centre[0], p.centre[1], p.centre[2]);
    return geo;
  }

  throw new Error(`unknown primitive kind: ${p.kind}`);
}

// Merges a piece's primitives into one geometry. Returns null for an empty
// list so a builder can legitimately produce nothing.
export function compile(primitives, rand) {
  const parts = primitives.map((p) => primitiveGeometry(p, rand));
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('mergeGeometries failed - primitives must share attributes');
  merged.computeVertexNormals();
  return merged;
}

export { TAU };
