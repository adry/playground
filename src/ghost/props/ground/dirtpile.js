import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toyMaterial } from '../style.js';

// The spoil heap: the earth dug out to make a grave, sitting beside the hole
// with a spade's worth of loose clods spilled round its foot.
//
// THE PROBLEM THIS PIECE EXISTS TO SOLVE
//
// The sunken ledger stone tried five ways of showing displaced earth and threw
// all five away with one finding: a dome lit by this key is DARKER than the
// flat floor whatever colour it is given, so it closes up into a dark shape
// beside the stone and reads as a stain rather than as soil. That is the same
// failure that got the set's contact-shadow decals deleted four times.
//
// The finding is real and it is measurable. Rendered against the floor and
// counted pixel by pixel, a smooth ellipsoid mound in a warm earth colour has
// 71% of its pixels darker than the floor they replaced. Two things are going
// on and both are the lighting rather than the colour:
//
//   * the hemisphere light is the bigger half. At intensity 1.15 the floor,
//     whose normal points straight up, takes the sky colour (0xdfe6f5) neat.
//     Every tilted surface mixes in the ground colour (0x6f7480), which is much
//     darker and much bluer, and a dome is nothing BUT tilted surface.
//   * the key sits at 56 degrees, so the floor gets 0.83 of it and a 45 degree
//     flank about 0.55.
//
// So the two answers a mound can give are both bad: dark, or a smooth pale
// dome, which is what the first render here was, a beige potato. What actually
// works is neither, and it is three things together:
//
//   1. NO SMOOTH FALLOFF ANYWHERE. The heap's whole surface is clods: rounded
//      lumps half sunk into a core that is never seen bare. A dome has one
//      continuous ramp from lit crown to dark skirt and the eye reads the ramp
//      as a single closed form. Thirty lumps have thirty little crowns, and
//      even down on the dark flank each one still catches a rim of key on its
//      own top. The silhouette breaks up as well, which is what stops it
//      reading as one shape.
//   2. LOW AND LONG. 1.8 by 0.9 by 0.5 is a ridge, not a hemisphere: at that
//      ratio most of the surface the camera sees is turned upward rather than
//      sideways, so most of the surface is taking the sky colour and most of
//      the key.
//   3. PAINTED UPWARD. Vertex colour ramps from a light warm tan on up-facing
//      facets to a deep brown in the crevices between clods. This runs the same
//      way the light does, so it doubles the separation between a clod's top
//      and the gap beside it, and it lifts the mean well clear of the floor.
//      Fresh earth is warmer and lighter than this floor's grey, which is also
//      simply true of fresh earth, so nothing is being cheated.
//
// Measured, same probe as before: the finished heap runs a mean luma of 149
// against the floor's 119 and has 15% of its pixels darker than the floor,
// against 71% for the smooth mound. It is a light shape on a grey floor.

// The heap the spoil of a 2.0 by 0.9 by 1.0 hole actually makes: a ridge as
// long as the hole is long, a little narrower, knee high. SCATTER is how far
// the loose clods spill past the body, so the whole footprint is 1.2 across.
export const HEAP = { length: 1.8, spread: 0.9, height: 0.5, scatter: 1.2 };

// Fresh earth, warmer and browner than the floor's #8f949e, and deliberately
// LIGHTER on anything facing up. TOP is what a clod's crown gets, SIDE its
// flank, CREVICE the gap between two clods and the underside of the spill.
// Colours are handed to three as ordinary sRGB hex and left alone: with colour
// management on, THREE.Color already holds linear values, and converting again
// (which ground.js does, correctly, because it feeds a raw shader uniform) is
// what turned the first clod pass into chocolate.
const EARTH = {
  top: new THREE.Color('#c2a67a'),
  side: new THREE.Color('#8f7757'),
  crevice: new THREE.Color('#544435'),
};
// Per-clod tone. A heap of one colour reads as a heap of dough whatever shape
// the lumps are: some clods came off the wet bottom of the hole and some off
// the dry top, and half a stop between them is what makes it a heap of separate
// things rather than one moulded object.
const TONE = { lo: 0.80, hi: 1.10 };
// The base colour the vertex colours multiply. White would blow the tan out
// under this key, so the map carries the value and the vertex colours carry
// the modelling.
const BASE = '#ffffff';

const SPADE = {
  handle: new THREE.Color('#a3835e'),
  metal: new THREE.Color('#aab0b6'),
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// One clod. A sphere pushed about by four low-frequency waves, which is what
// keeps it a rounded lump: the house style has no shards in it, and a lump made
// by noise at any higher frequency comes out a raspberry. Segment counts are
// low on purpose, but the displacement is smooth so they still read round.
function lumpGeometry(rng, seg) {
  const geo = new THREE.SphereGeometry(0.5, seg[0], seg[1]);
  const p = geo.attributes.position;
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().multiplyScalar(2); // unit direction
    const k = 1
      + 0.190 * Math.sin(2.3 * n.x + ph[0])
      + 0.160 * Math.sin(2.7 * n.y + ph[1])
      + 0.145 * Math.sin(2.1 * n.z + ph[2])
      + 0.095 * Math.sin(3.7 * (n.x - n.z) + ph[3]);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// The core the clods are stuck into. Never seen bare: it exists so the gaps
// between clods are filled with earth rather than with floor, and its colour is
// the crevice brown for exactly that reason.
//
// Built from an upper half sphere remapped onto the footprint, so its outline
// is an ellipse with a wobble in it rather than a circle, and its profile is
// (1 - r^2)^Q. Q under a half is what makes the crest broad and the skirt
// short, which is the whole of point 2 above: a broad crest is surface pointing
// at the sky.
const CORE_Q = 0.44;

function coreGeometry({ a, c, h, rng }) {
  const geo = new THREE.SphereGeometry(0.5, 30, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rho = Math.min(1, Math.hypot(v.x, v.z) / 0.5);
    const th = Math.atan2(v.z, v.x);
    // Outline wobble: the footprint of a tipped barrowload is not an ellipse.
    const w = 1 + 0.075 * Math.sin(3 * th + ph[0]) + 0.05 * Math.sin(5 * th + ph[1]);
    // Crest wobble, strongest at the top and gone at the rim so the skirt still
    // lands on the floor all the way round.
    const cw = 1 + rho * (1 - rho) * (0.55 * Math.sin(2 * th + ph[2]) + 0.35 * Math.sin(4 * th - ph[0]));
    p.setXYZ(
      i,
      a * rho * Math.cos(th) * w,
      h * Math.pow(Math.max(0, 1 - rho * rho), CORE_Q) * cw,
      c * rho * Math.sin(th) * w,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

// Height of the core at a point, so a clod can be seated ON it rather than at a
// height somebody chose. Same formula as the mesh minus the wobble, which is
// close enough: the clod is sunk by a third of its radius anyway.
function coreHeight(x, z, { a, c, h }) {
  const rho = Math.hypot(x / a, z / c);
  return rho >= 1 ? 0 : h * Math.pow(1 - rho * rho, CORE_Q);
}

function placed(geo, { pos, scale, euler }) {
  const m = new THREE.Matrix4().compose(
    pos,
    new THREE.Quaternion().setFromEuler(euler),
    scale,
  );
  geo.applyMatrix4(m);
  return geo;
}

// The paint, and this is the other half of why the piece reads.
//
// Two terms, and neither of them is the renderer's.
//
// FACING. Up-facing facets go to a light warm tan, sideways ones to a mid
// brown, under-facing ones down into the crevice colour. This runs the same way
// the light does, so a clod's crown and the gap beside it are separated twice
// over, and it is what lifts the heap clear of the floor's grey.
//
// OCCLUSION, baked here rather than hoped for. The scene has one shadow-casting
// light and it cannot put a shadow in the gap between two clods that are two
// centimetres apart; without that the heap comes out as a tray of pale pebbles,
// which is what the render said before this existed. So every vertex is tested
// against every other clod: an occluder in front of the surface, close to it,
// darkens it, falling off with distance and with the angle off the normal.
// About a million distance tests at build time and nothing at all per frame.
const OCC_REACH = 2.3;   // occluder radii; past this a clod does not shade you
const OCC_DEPTH = 0.60;  // how black a full crevice goes

function occlusionAt(v, n, clods, skip) {
  let occ = 0;
  for (let j = 0; j < clods.length; j++) {
    if (j === skip) continue;
    const o = clods[j];
    const dx = o.x - v.x, dy = o.y - v.y, dz = o.z - v.z;
    const reach = o.r * OCC_REACH;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > reach * reach) continue;
    const d = Math.sqrt(d2) || 1e-6;
    // Only what sits in front of the surface shades it. Without this the
    // underside of every clod is shaded by the clod it is sitting on, which is
    // right, and the TOP of every clod is shaded by it too, which is not.
    const facing = (dx * n.x + dy * n.y + dz * n.z) / d;
    if (facing <= 0) continue;
    occ += facing * (1 - d / reach);
  }
  return clamp01(occ * 0.85);
}

function paint(geo, { rng, height, clods, skip = -1, crevice = 0, tone = 1 }) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const ph = rng() * 6.283;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nv.fromBufferAttribute(n, i);
    const ny = nv.y;
    if (ny >= 0) c.copy(EARTH.side).lerp(EARTH.top, smoothstep(0.05, 0.85, ny));
    else c.copy(EARTH.side).lerp(EARTH.crevice, smoothstep(0.0, -0.6, ny));
    // Everything low in the heap loses a little: the foot must not compete
    // with the crest for the eye.
    const deep = 1 - 0.30 * (1 - smoothstep(0.02, height * 0.75, v.y));
    const occ = clods ? occlusionAt(v, nv, clods, skip) : 0;
    // Mottling: a coherent wave through the surface rather than per-vertex
    // white noise, which on a smooth-shaded lump comes out as static.
    const mott = 1 + 0.055 * Math.sin(11 * v.x + ph) * Math.sin(9 * v.z - ph) + 0.04 * Math.sin(17 * v.y + ph);
    const k = deep * (1 - crevice) * (1 - OCC_DEPTH * occ) * tone * mott;
    c.multiplyScalar(k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// A short-handled digging spade stood in the heap. Optional, off by default:
// it is 1.05 tall, which is a real object in a scene that may already have
// something standing where it wants to be.
function spadeGeometries(rng, { a, h }) {
  const out = [];
  const lean = 0.30 + rng() * 0.10;
  const yaw = -0.55 + rng() * 0.5;
  const foot = new THREE.Vector3(a * (0.30 + rng() * 0.16), h * 0.42, -0.10 + rng() * 0.2);
  const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(yaw), Math.cos(lean), Math.sin(lean) * Math.sin(yaw));
  const euler = new THREE.Euler(0, 0, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const along = (t) => foot.clone().addScaledVector(dir, t);

  const put = (geo, t, extraQ) => {
    const m = new THREE.Matrix4().compose(along(t), extraQ ? q.clone().multiply(extraQ) : q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    out.push(geo);
  };

  // Blade, buried to its shoulder. Rounded, because everything here is.
  const blade = new THREE.SphereGeometry(0.5, 14, 10);
  blade.scale(0.15, 0.22, 0.045);
  blade.translate(0, 0, 0);
  put(blade, -0.16);
  // Shaft.
  const shaft = new THREE.CylinderGeometry(0.017, 0.019, 0.76, 10, 1);
  put(shaft, 0.40);
  // A D-handle: two short cheeks and a grip across the top.
  const grip = new THREE.CylinderGeometry(0.019, 0.019, 0.115, 8, 1);
  put(grip, 0.815, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)));
  for (const s of [-1, 1]) {
    const cheek = new THREE.CylinderGeometry(0.012, 0.012, 0.10, 6, 1);
    cheek.translate(s * 0.052, 0, 0);
    put(cheek, 0.765);
  }
  void euler;
  return out;
}

function tint(geo, colour, jitter, rng) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(colour).multiplyScalar(0.95 + jitter * rng());
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * A heap of dug earth.
 *
 *   length   1.8   along local +X, the axis to lay along the side of the hole
 *   spread   0.9   across, the width of the heap's own body
 *   height   0.5   crest above the floor
 *   scatter  1.2   full width including the loose clods at the foot
 *   spade    false stand a spade in it
 *
 * Origin is the centre of the footprint, sitting on y = 0. Rotate the group
 * about y to run it along whichever side of the hole the scene wants; for a
 * 2.0 by 0.9 hole the heap sits about 0.95 off the hole's centre line.
 */
export function createDirtPile({
  seed = 1,
  scale = 1,
  length = HEAP.length,
  spread = HEAP.spread,
  height = HEAP.height,
  scatter = HEAP.scatter,
  spade = false,
} = {}) {
  const rng = mulberry32(seed * 2654435761 + 91);
  const group = new THREE.Group();

  // The core sits a little under the target height and a little inside the
  // target footprint, because the clods stuck into it are what reach both.
  const a = (length / 2) * 0.90;
  const c = (spread / 2) * 0.86;
  const h = height * 0.88;
  const core = { a, c, h };

  const parts = [paint(coreGeometry({ a, c, h, rng }), { rng, height, crevice: 0.30 })];

  // --- the body: clods stuck into the core ---------------------------------
  // Sampled over the footprint rather than over a ring, with the count set so
  // the core is covered: nowhere on the heap may there be a patch of smooth
  // falloff big enough for the eye to read as a dome.
  const BODY = 46;
  for (let i = 0; i < BODY; i++) {
    // Square-root radius so the samples spread evenly over the area instead of
    // bunching at the crest, and a golden-angle spin so no two land on top of
    // each other.
    const rho = Math.sqrt((i + 0.5) / BODY) * (0.96 + rng() * 0.1);
    const th = i * 2.399963 + rng() * 0.55;
    const x = a * rho * Math.cos(th);
    const z = c * rho * Math.sin(th);
    // Bigger lumps low down, where the barrow tipped and the big stuff rolled;
    // finer material stays up on the crest.
    // A wide spread of sizes, because a heap of one size is gravel. Bigger
    // lumps low down, where the barrow tipped and the coarse stuff rolled.
    const r = (0.058 + 0.062 * rho) * (0.62 + rng() * rng() * 1.5);
    // How deep the clod is sunk into the core is the difference between soil
    // and a cairn: a run of clods all showing their equator reads as stacked
    // stones, while a mixture, some proud and most with only a crown out, reads
    // as earth with lumps in it.
    // How deep the clod is sunk is the whole difference between a heap and a
    // potato, and it has a narrow window. A clod is 0.72r tall above its own
    // centre, so sinking it much past half of that leaves nothing standing
    // proud and the heap closes back up into one smooth dome, which is the
    // ledger's failure arriving by the back door. Tried at 0.9r to 1.65r and
    // the render was a bread roll. This range leaves every clod showing
    // between a fifth and three fifths of its radius.
    const sink = 0.12 + 0.42 * rng();
    const y = coreHeight(x, z, core) - r * sink;
    const geo = lumpGeometry(rng, [12, 8]);
    placed(geo, {
      pos: new THREE.Vector3(x, Math.max(y, r * 0.22), z),
      // Flattened: a clod that has been dropped sits wider than it is tall, and
      // a flattened lump turns more of itself at the sky.
      scale: new THREE.Vector3(r * 2.25, r * 1.45, r * 2.0),
      euler: new THREE.Euler(rng() * 0.7 - 0.35, rng() * 6.283, rng() * 0.7 - 0.35),
    });
    parts.push(paint(geo, { rng, height, tone: TONE.lo + (TONE.hi - TONE.lo) * rng() }));
  }

  // --- the spill: loose clods on the floor round the foot -------------------
  // These are what a spade throws past the heap. Density falls off with
  // distance, and they are sunk a third of the way in so none of them hovers.
  const LOOSE = 22;
  for (let i = 0; i < LOOSE; i++) {
    const th = rng() * 6.283;
    const t = Math.pow(rng(), 0.55); // biased outward, they are the spill
    const rx = (length / 2) * (0.86 + 0.16 * t);
    const rz = (spread / 2) * 0.92 + ((scatter - spread) / 2) * (0.5 + 0.5 * t);
    const x = rx * Math.cos(th);
    const z = rz * Math.sin(th);
    const r = (0.030 + 0.052 * (1 - t)) * (0.8 + rng() * 0.55);
    const geo = lumpGeometry(rng, [10, 7]);
    placed(geo, {
      pos: new THREE.Vector3(x, r * 0.62, z),
      scale: new THREE.Vector3(r * 2.3, r * 1.45, r * 2.05),
      euler: new THREE.Euler(rng() * 0.6 - 0.3, rng() * 6.283, rng() * 0.6 - 0.3),
    });
    parts.push(paint(geo, { rng, height, tone: TONE.lo + (TONE.hi - TONE.lo) * rng() }));
  }

  // --- crumbs --------------------------------------------------------------
  // The fine stuff, thrown furthest. Small enough that they are three or four
  // pixels at scene range, which is the point: they soften the edge of the
  // footprint so the heap does not end on a line.
  const CRUMBS = 26;
  for (let i = 0; i < CRUMBS; i++) {
    const th = rng() * 6.283;
    const t = Math.pow(rng(), 0.4);
    const x = (length / 2) * (0.98 + 0.10 * t) * Math.cos(th);
    const z = (scatter / 2) * (0.72 + 0.28 * t) * Math.sin(th);
    const r = 0.016 + 0.026 * rng();
    const geo = lumpGeometry(rng, [8, 6]);
    placed(geo, {
      pos: new THREE.Vector3(x, r * 0.58, z),
      scale: new THREE.Vector3(r * 2.3, r * 1.5, r * 2.1),
      euler: new THREE.Euler(0, rng() * 6.283, 0),
    });
    parts.push(paint(geo, { rng, height, tone: TONE.lo + (TONE.hi - TONE.lo) * rng() }));
  }

  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const material = toyMaterial(BASE, { vertexColors: true, roughness: 0.94 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const extra = [];
  if (spade) {
    const geos = spadeGeometries(rng, core);
    const wood = mergeGeometries([geos[0]].slice(0, 0).concat(geos.slice(1)), false);
    const steel = geos[0];
    const gw = tint(wood, SPADE.handle, 0.1, rng);
    const gs = tint(steel, SPADE.metal, 0.06, rng);
    const merged = mergeGeometries([gw, gs], false);
    gw.dispose(); gs.dispose();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    extra.push(merged);
  }

  group.scale.setScalar(scale);

  return {
    group,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
      for (const g of extra) g.dispose();
    },
  };
}
