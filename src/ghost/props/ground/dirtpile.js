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
// The finding is real, and rendering it against this floor and counting the
// pixels says exactly how real. A smooth ellipsoid mound 1.8 by 0.9 by 0.5, in
// a warm earth colour, has 98% of its pixels darker than the floor they
// replaced, and its brightest pixel anywhere is DARKER than the floor's mean.
// There is no lit crown on it at all. It is a closed dark shape, which is what
// the ledger said. Two things do it, and both are the lighting rather than the
// colour:
//
//   * the hemisphere light is the bigger half. At intensity 1.15 the floor,
//     whose normal points straight up, takes the sky colour (0xdfe6f5) neat.
//     Every tilted surface mixes in the ground colour (0x6f7480), which is much
//     darker and much bluer, and a dome is nothing BUT tilted surface.
//   * the key sits at 56 degrees, so the floor gets 0.83 of it and a 45 degree
//     flank about 0.55.
//
// Making it lighter does not fix that; it only trades a dark blob for a pale
// one, and the first render here was a beige potato. What works is not a colour
// at all, it is three things about the form:
//
//   1. NO SMOOTH FALLOFF ANYWHERE. The heap's whole surface is clods: rounded
//      lumps half sunk into a core that is never seen bare. A dome has one
//      continuous ramp from crown to skirt and the eye reads the ramp as a
//      single closed form. A hundred lumps have a hundred little crowns, and
//      even down on the shaded flank each one still catches a rim of key on its
//      own top. The silhouette breaks up too, which is what stops the thing
//      reading as one shape.
//   2. LOW AND LONG. 1.8 by 0.9 by 0.5 is a ridge, not a hemisphere: at that
//      ratio most of the surface the camera sees is turned upward rather than
//      sideways, so most of it is taking the sky colour and most of the key.
//   3. PAINTED UPWARD, and shaded in the crevices. Vertex colour ramps from a
//      light warm tan on up-facing facets to a deep brown between clods, and a
//      baked occlusion term darkens every gap the one shadow-casting light
//      cannot reach into. Both run the same way the light does, so a clod's top
//      and the gap beside it are separated twice over.
//
// Measured with the same probe, the finished heap has 34% of its pixels
// BRIGHTER than the floor, against the mound's 2%, and a brightest pixel of 189
// against the floor's 154 and the mound's 144. The two have almost the same
// mean, 127 against 128: the mean was never the thing. What changed is that the
// heap has highlights and the mound has none, and a shape with highlights in it
// is a lit object while a shape without them is a hole in the ground.
//
// Its mean colour against the floor's, from that probe: #917d5e against
// #979aa3. Warmer and browner, a shade darker in the mean and a great deal
// lighter at the crowns, which is what fresh earth actually is.

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
  top: new THREE.Color('#c4ab83'),
  side: new THREE.Color('#917c60'),
  crevice: new THREE.Color('#554839'),
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
  metal: new THREE.Color('#8e949b'),
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
// The crest is a LINE, not a point. A dome over an ellipse peaks at one spot
// and reads as a dome however it is dressed; a spoil heap tipped along the side
// of a trench has a ridge. RIDGE is the fraction of the half length over which
// the top stays at full height, measured in a stadium-shaped metric, and RIM is
// a second falloff in the plain elliptical metric whose only job is to make
// sure the whole outline still lands on the floor.
const RIDGE = 0.34;
const RIM_Q = 0.30;

function coreProfile(x, z, { a, c, h }) {
  const u = Math.abs(x) / a;
  const rr = Math.hypot(Math.max(0, u - RIDGE) / (1 - RIDGE), z / c);
  const re = Math.hypot(u, z / c);
  if (re >= 1) return 0;
  return h * Math.pow(Math.max(0, 1 - rr * rr), CORE_Q) * Math.pow(1 - re * re, RIM_Q);
}

// The core's actual surface height at a point: the ridge profile, times the
// crest wobble, plus the core's own undulation. ONE function, used to build the
// mesh AND to seat every clod on it, because the two drifting apart is how a
// clod ends up hovering over a bulge or buried under one.
function coreShape(x, z, core, ph) {
  const { a, c } = core;
  const th = Math.atan2(z, x);
  const rho = Math.min(1, Math.hypot(x / a, z / c));
  // Crest wobble, strongest at the top and gone at the rim so the skirt still
  // lands on the floor all the way round.
  const cw = 1 + rho * (1 - rho) * (0.55 * Math.sin(2 * th + ph[2]) + 0.35 * Math.sin(4 * th - ph[0]));
  // The core also undulates. Two seeds put a clod-sized gap in the skin and the
  // render showed a smooth ramp of core through it, which is the dome failure
  // looking out through a hole in the answer to it. A core that is itself lumpy
  // has no smooth ramp anywhere to show.
  const bump = 0.30 * core.h * rho * (1 - rho * rho) * (
    Math.sin(7.3 * x + ph[3]) * Math.sin(9.1 * z - ph[0])
    + 0.7 * Math.sin(12.7 * z + ph[1]) * Math.sin(5.9 * x + ph[2])
  );
  return coreProfile(x, z, core) * cw + bump;
}

function coreGeometry(core, ph) {
  const { a, c } = core;
  const geo = new THREE.SphereGeometry(0.5, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rho = Math.min(1, Math.hypot(v.x, v.z) / 0.5);
    const th = Math.atan2(v.z, v.x);
    // Outline wobble: the footprint of a tipped barrowload is not an ellipse.
    const w = 1 + 0.075 * Math.sin(3 * th + ph[0]) + 0.05 * Math.sin(5 * th + ph[1]);
    const px = a * rho * Math.cos(th) * w;
    const pz = c * rho * Math.sin(th) * w;
    p.setXYZ(i, px, coreShape(px, pz, core, ph), pz);
  }
  geo.computeVertexNormals();
  return geo;
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

// A short-handled digging spade stood in the heap. Optional and off by
// default: it stands a metre tall, which is a real object in a scene that may
// already have something where it wants to be.
//
// Built fat. A spade drawn to a spade's real proportions comes out as a wire
// next to props whose thinnest member is a fence picket, so the shaft is a
// centimetre and a half across and the blade is a rounded slab. The blade is
// stuck in only to its shoulder rather than buried, because a shaft coming out
// of a heap with no blade showing is a stick.
function spadeGeometries(rng, core, ph) {
  const { a, c } = core;
  const out = [];
  const lean = 0.17 + rng() * 0.11;
  const yaw = -0.9 + rng() * 0.7;
  // The entry point is READ off the heap, not chosen: it is the core surface at
  // that spot plus the height a clod stands proud, so the blade's shoulder is
  // clear of the earth and the thing reads as a spade rather than as a stick.
  // Stood near the end of the ridge rather than on the crest, where the earth
  // is low: on the crest the blade is swallowed by the clods around it and all
  // that shows is a stick.
  const fx = a * (0.34 + rng() * 0.22);
  const fz = c * (-0.10 + rng() * 0.34);
  const foot = new THREE.Vector3(fx, coreShape(fx, fz, core, ph) + 0.05, fz);
  const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(yaw), Math.cos(lean), Math.sin(lean) * Math.sin(yaw));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const along = (t) => foot.clone().addScaledVector(dir, t);
  const put = (geo, t, extraQ) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      along(t),
      extraQ ? q.clone().multiply(extraQ) : q,
      new THREE.Vector3(1, 1, 1),
    ));
    out.push(geo);
    return geo;
  };

  // Blade: a rounded slab, in to about its shoulder.
  const blade = new THREE.SphereGeometry(0.5, 16, 12);
  blade.scale(0.24, 0.31, 0.048);
  const steel = put(blade, 0.07);
  // Socket, where the blade takes the shaft.
  const socket = new THREE.CylinderGeometry(0.030, 0.044, 0.10, 10, 1);
  put(socket, 0.235);
  // Shaft.
  put(new THREE.CylinderGeometry(0.026, 0.030, 0.58, 10, 1), 0.565);
  // T-grip across the top, with a collar under it.
  put(new THREE.CylinderGeometry(0.030, 0.030, 0.05, 8, 1), 0.875);
  const grip = new THREE.CylinderGeometry(0.030, 0.030, 0.21, 10, 1);
  const cap = new THREE.SphereGeometry(0.030, 8, 6);
  cap.translate(0, 0.105, 0);
  const cap2 = new THREE.SphereGeometry(0.030, 8, 6);
  cap2.translate(0, -0.105, 0);
  const across = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  put(grip, 0.915, across);
  put(cap, 0.915, across);
  put(cap2, 0.915, across);

  return { steel, wood: out.filter((g) => g !== steel) };
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
 *   scatter  1.2   full width including the loose clods at the foot; follows
 *                  `spread` unless it is given
 *   spade    false stand a spade in it
 *   scale    1     scales the whole prop, clods and all
 *
 * length, spread and height RESHAPE the heap and leave the earth's grain alone:
 * a clod is the same size on a short heap as on a long one, which is what a
 * clod is. To make the whole thing bigger or smaller, use `scale`.
 *
 * Origin is the centre of the footprint, sitting on y = 0. Rotate the group
 * about y to run it along whichever side of the hole the scene wants; for a
 * 2.0 by 0.9 hole the heap sits about 0.95 off the hole's centre line, and its
 * own +X then runs along the hole's length.
 */
export function createDirtPile({
  seed = 1,
  scale = 1,
  length = HEAP.length,
  spread = HEAP.spread,
  height = HEAP.height,
  // Defaults to the same margin past the body that the standard heap has, so
  // narrowing `spread` narrows the spill with it instead of leaving the loose
  // clods stranded out at 1.2.
  scatter = spread + (HEAP.scatter - HEAP.spread),
  spade = false,
} = {}) {
  const rng = mulberry32(seed * 2654435761 + 91);
  const group = new THREE.Group();

  // The core sits a little under the target height and a little inside the
  // target footprint, because the clods stuck into it are what reach both.
  const a = (length / 2) * 0.90;
  const c = (spread / 2) * 0.86;
  const h = height * 0.84;
  const core = { a, c, h };
  // Drawn once, up front: the core's shape has to be known before a clod can be
  // seated on it.
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283];

  // Every clod is PLACED before any of them is BUILT, because the occlusion
  // pass needs the whole heap to shade one vertex of it.
  const clods = [];

  // --- the body: clods stuck into the core ---------------------------------
  // Sampled over the footprint rather than round a ring. This is the bulk of
  // the skin; the crest run and the repair pass below are what guarantee it,
  // because nowhere on the heap may there be a patch of smooth falloff big
  // enough for the eye to read as a dome.
  const BODY = 46;
  for (let i = 0; i < BODY; i++) {
    // Square-root radius so the samples spread evenly over the area instead of
    // bunching at the crest, and a golden-angle spin so no two land on top of
    // each other.
    const rho = Math.sqrt((i + 0.5) / BODY) * (0.96 + rng() * 0.1);
    const th = i * 2.399963 + rng() * 0.55;
    const x = a * rho * Math.cos(th);
    const z = c * rho * Math.sin(th);
    // A wide spread of sizes, because a heap of one size is gravel, with
    // bigger lumps low down where the barrow tipped and the coarse stuff
    // rolled. Both ends of the spread are held: at a floor of 0.62 two seeds in
    // three drew enough small clods in a row to leave bare core showing, and
    // with the top end unclamped the tail of the draw put a 0.5 wide boulder on
    // a 0.9 wide heap, which the eye reads as a rock and not as earth.
    const r = Math.min(0.145, (0.055 + 0.058 * rho) * (0.86 + rng() * rng() * 1.25));
    // How deep the clod is sunk is the whole difference between a heap and a
    // potato, and it has a narrow window. A clod stands 0.72r above its own
    // centre, so sinking it much past half of that leaves nothing proud and
    // the heap closes back up into one smooth dome, which is the ledger's
    // failure arriving by the back door. Tried at 0.9r to 1.65r and the render
    // was a bread roll. This range leaves every clod showing between a fifth
    // and three fifths of its radius.
    const y = coreShape(x, z, core, ph) - r * (0.12 + 0.42 * rng());
    clods.push({
      x, y: Math.max(y, r * 0.22), z, r,
      seg: [11, 7],
      // Flattened: a clod that has been dropped sits wider than it is tall, and
      // a flattened lump turns more of itself at the sky.
      scale: new THREE.Vector3(r * 2.25, r * 1.45, r * 2.0),
      euler: new THREE.Euler(rng() * 0.7 - 0.35, rng() * 6.283, rng() * 0.7 - 0.35),
      tone: TONE.lo + (TONE.hi - TONE.lo) * rng(),
    });
  }

  // --- the crest ------------------------------------------------------------
  // A run of clods walked along the ridge line, on top of the spiral above.
  // The spiral spreads clods evenly over the FOOTPRINT, which is not the same
  // as evenly over the SURFACE, and the place it reliably came up short was the
  // crest: two seeds in five drew a bare knuckle of core at the top of the
  // heap, smooth and pale, and a smooth pale knuckle is the whole failure this
  // piece exists to avoid. The crest is also the part of the heap the camera
  // sees most of, so it is the one place worth guaranteeing.
  const CREST = 13;
  for (let i = 0; i < CREST; i++) {
    const x = a * (-0.62 + 1.24 * ((i + 0.5) / CREST) + (rng() - 0.5) * 0.16);
    const z = c * (rng() - 0.5) * 0.72;
    const r = 0.062 * (0.9 + rng() * 0.7);
    clods.push({
      x, y: coreShape(x, z, core, ph) - r * (0.10 + 0.35 * rng()), z, r,
      seg: [11, 7],
      scale: new THREE.Vector3(r * 2.25, r * 1.5, r * 2.0),
      euler: new THREE.Euler(rng() * 0.7 - 0.35, rng() * 6.283, rng() * 0.7 - 0.35),
      tone: TONE.lo + (TONE.hi - TONE.lo) * rng(),
    });
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
    const r = (0.030 + 0.052 * (1 - t)) * (0.8 + rng() * 0.55);
    clods.push({
      x: rx * Math.cos(th), y: r * 0.62, z: rz * Math.sin(th), r,
      seg: [9, 6],
      scale: new THREE.Vector3(r * 2.3, r * 1.45, r * 2.05),
      euler: new THREE.Euler(rng() * 0.6 - 0.3, rng() * 6.283, rng() * 0.6 - 0.3),
      tone: TONE.lo + (TONE.hi - TONE.lo) * rng(),
    });
  }

  // --- crumbs --------------------------------------------------------------
  // The fine stuff, thrown furthest. Three or four pixels at scene range, which
  // is the point: they soften the edge of the footprint so the heap does not
  // end on a line.
  const CRUMBS = 26;
  for (let i = 0; i < CRUMBS; i++) {
    const th = rng() * 6.283;
    const t = Math.pow(rng(), 0.4);
    const r = 0.016 + 0.026 * rng();
    clods.push({
      x: (length / 2) * (0.98 + 0.10 * t) * Math.cos(th),
      y: r * 0.58,
      z: (scatter / 2) * (0.72 + 0.28 * t) * Math.sin(th),
      r,
      seg: [6, 5],
      scale: new THREE.Vector3(r * 2.3, r * 1.45, r * 2.1),
      euler: new THREE.Euler(0, rng() * 6.283, 0),
      tone: TONE.lo + (TONE.hi - TONE.lo) * rng(),
    });
  }

  // --- coverage repair ------------------------------------------------------
  // The three passes above spread clods evenly over the FOOTPRINT, which is not
  // the same as evenly over the SURFACE: a steep flank has more surface than
  // plan and comes up short, and on some seeds it came up short by a whole
  // clod's worth. What showed through was a smooth pale ramp of bare core,
  // which is precisely the dome the whole piece is built to avoid, arriving
  // through a hole in the answer to it.
  //
  // So it is checked rather than hoped for. A grid of points on the core is
  // tested against every clod's actual ellipsoid, and anything still bare gets
  // a clod of its own. Nothing here is placed at a spacing somebody chose.
  {
    const test = [];
    for (let ir = 0; ir < 10; ir++) {
      const rho = (ir + 0.5) / 10;
      const nth = Math.max(6, Math.round(34 * rho));
      for (let it = 0; it < nth; it++) {
        const th = ((it + 0.5) / nth) * 6.283 + ir * 0.7;
        const x = a * rho * Math.cos(th) * 0.97;
        const z = c * rho * Math.sin(th) * 0.97;
        test.push([x, coreShape(x, z, core, ph), z]);
      }
    }
    // How far a point is from being covered: the smallest ellipsoid distance to
    // any clod, where under 1 means inside one. 0.44 rather than the
    // ellipsoid's true 0.5 because a clod sunk into the core meets it in a
    // circle smaller than its own equator, so counting the equator as covered
    // leaves a visible collar of bare core round every one of them.
    const exposure = ([x, y, z]) => {
      let best = Infinity;
      for (const d of clods) {
        const dx = (x - d.x) / (d.scale.x * 0.44);
        const dy = (y - d.y) / (d.scale.y * 0.48);
        const dz = (z - d.z) / (d.scale.z * 0.44);
        const q = dx * dx + dy * dy + dz * dz;
        if (q < best) best = q;
      }
      return best;
    };
    // Worst first, and stop as soon as nothing is bare. Walking the grid in
    // order and stopping at a budget spends the budget on the first holes it
    // meets and leaves the worst one on the heap.
    for (let pass = 0; pass < 28; pass++) {
      let worst = -1;
      let at = null;
      for (const t of test) {
        const e = exposure(t);
        if (e > worst) { worst = e; at = t; }
      }
      if (worst <= 1 || !at) break;
      const r = 0.058 * (0.9 + rng() * 0.6);
      clods.push({
        x: at[0], y: at[1] - r * (0.05 + 0.3 * rng()), z: at[2], r,
        seg: [11, 7],
        scale: new THREE.Vector3(r * 2.3, r * 1.5, r * 2.05),
        euler: new THREE.Euler(rng() * 0.7 - 0.35, rng() * 6.283, rng() * 0.7 - 0.35),
        tone: TONE.lo + (TONE.hi - TONE.lo) * rng(),
      });
    }
  }

  const parts = [paint(coreGeometry(core, ph), { rng, height, clods, crevice: 0.30 })];
  for (let i = 0; i < clods.length; i++) {
    const d = clods[i];
    const geo = lumpGeometry(rng, d.seg);
    placed(geo, { pos: new THREE.Vector3(d.x, d.y, d.z), scale: d.scale, euler: d.euler });
    parts.push(paint(geo, { rng, height, clods, skip: i, tone: d.tone }));
  }

  // The spade goes into the SAME merge as the earth. It is a different colour,
  // but colour here is a vertex attribute rather than a material, so the whole
  // prop stays one geometry and one draw call.
  if (spade) {
    const { steel, wood } = spadeGeometries(rng, core, ph);
    parts.push(tint(mergeGeometries(wood, false), SPADE.handle, 0.1, rng));
    for (const g of wood) g.dispose();
    parts.push(tint(steel, SPADE.metal, 0.06, rng));
  }

  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const material = toyMaterial(BASE, { vertexColors: true, roughness: 0.94 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  group.scale.setScalar(scale);

  return {
    group,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
