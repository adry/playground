// GROUND COVER THAT MERGES AT ITS BORDERS.
//
// ============================================================================
// THE PROBLEM, AND WHY IT IS NOT THE ONE IT LOOKS LIKE
// ============================================================================
//
// The owner asked to "merge ground textures on borders between them". The word
// texture is the trap. There is no ground texture in this project and there
// deliberately never was: props/ground/README.md states the two rules the whole
// package is built on, and the second one decides this file.
//
//   1. The floor is ONE opaque plane at exactly y = 0. Anything below it is
//      invisible unless the plane is cut; anything exactly on it z-fights.
//   2. The camera is orthographic at about 38 degrees, so a flat patch is seen
//      at a glancing angle, its outline compresses to almost nothing, and its
//      SHADING rather than its silhouette is what the eye reads.
//
// Rule 2 is why sandpath.js is a cambered ribbon with wheel hollows and half
// buried pebbles rather than a lighter stripe, and its header says in as many
// words that a path which is only a lighter colour is a stain. That approach
// has already been tried here and rejected, so the obvious implementation of
// "merge the textures" -- paint a splat map into the floor's fragment shader
// and cross-fade two colours across a border -- is the exact failure the
// package was built to avoid. Blending two stains produces a blended stain.
//
// So the ask is really: how do two AREAS of ground cover meet without a hard
// line, when ground cover is a surface and not a colour?
//
// ============================================================================
// WHAT THIS DOES INSTEAD, IN THREE PARTS
// ============================================================================
//
// The author paints a coarse field of material per half-metre cell. From it:
//
//   ONE SHARED SURFACE. The relief -- a low, long-wavelength swell, a couple of
//   centimetres at most -- is computed ONCE for the whole covered area and
//   every material sits on it. That is what makes a border possible at all: two
//   materials on two independent surfaces have to meet at an edge, and two
//   materials on the same surface merely change what the surface is made of.
//   The relief is multiplied by the coverage, so the outer rim of the whole
//   cover is at exactly y = 0 and cannot show a lip at a grazing angle. The
//   material carries polygonOffset for the same reason sandpath.js does.
//
//   A WEIGHT PER MATERIAL, NOT A REGION. The painted cells are blurred, and
//   each material's weight at a point is its blurred coverage divided by the
//   total. At an internal border the two weights cross over and always sum to
//   one, so there is never a seam of bare floor between them; at the outer edge
//   the total itself falls away, so the cover fades out rather than stopping.
//   That is a real transition band about a metre and a half wide, not an
//   antialiased edge.
//
//   THE DETAIL INTERLEAVES. This is the part that makes it read as merged
//   rather than cross-faded, and it is the part a texture cannot do. Each
//   material scatters its own real geometry -- grass blades, gravel chips, sand
//   pebbles, earth clods -- at a density proportional to its weight. In the
//   band you therefore get grass thinning out THROUGH gravel that is thickening
//   up, with individual blades standing between individual chips, each catching
//   the key light and reading at exactly the glancing angle rule 2 is about.
//   That is how the two grounds actually meet in a real churchyard and it is
//   why the border survives the camera.
//
// ============================================================================
// WHAT WAS CONSIDERED AND NOT DONE
// ============================================================================
//
//   * A splat map on the floor plane. Rejected above: it is the documented
//     failure, it would also have to fight the floor's grid shader, and the
//     grid is not decoration -- it is the only thing that says the ghost is
//     moving rather than the world.
//   * Re-cutting sandpath.js / gravelpath.js / grass.js into area fills. They
//     are ribbon and clump props with their own geometry and their own reasons,
//     they are used by the generator, and turning them into a fill would be a
//     rewrite of three reviewed props to serve one tool. They are untouched.
//     A path in a level is still one of those ribbons; this is the ground the
//     ribbon is laid on.
//   * Alpha-blended overlapping quads per region. That is the stain again with
//     an extra draw call.
//
// ============================================================================
// COST
// ============================================================================
//
// One draw call per material for the surface and one per material for the
// scatter, so eight at the very most, and each is a static merged buffer. A
// 30 by 30 arena painted end to end is about 3600 cells, 3700 vertices per
// surface and a few thousand instances of a twelve-triangle tuft. Nothing here
// is rebuilt per frame; the whole thing is rebuilt when the paint changes.

import * as THREE from 'three';
import { toyMaterial } from '../../ghost/props/style.js';
import { unpackPaint } from './format.js';

// How far the blur reaches, in cells. Three cells at 0.5 is a metre and a half
// of transition, which is about a ghost and a half wide: wide enough to read as
// a merge at the game's framing and narrow enough that a two metre patch of
// gravel is still recognisably gravel in the middle.
const FEATHER = 3;

// The relief. Three centimetres of swell over a two metre wavelength. Enough
// for the key light to find, far too little to trip over, and small enough
// that a headstone standing on it is not visibly tilted. It was 0.022 and read
// as nothing at the game's framing, which is the stain failure creeping back
// in through the geometry rather than the colour.
const RELIEF = 0.030;
const RELIEF_SCALE = 2.0;

// Colours. The hues come from the props that already own these grounds, so a
// painted gravel yard and a gravel path are the same gravel: sand from
// sandpath.js's SAND, gravel from gravelpath.js's GRAVEL.base, earth from
// dirtpile.js's side tone.
//
// The LUMINANCES are pitched at the floor's own, and that is the part that was
// got wrong first time. The floor is #8f949e and reads about 148. The first
// grass was foliage green, #66744f at about 110, and painting the yard with it
// turned the arena into a dark hole with pale props standing in it: the props'
// contact shadows vanished and the whole frame went muddy. Each of these is
// within a few points of 148 and says what it is by HUE and by the detail
// standing in it, not by being darker than the ground it covers.
export const MATERIALS = {
  grass: { color: '#8d9873', detail: 'blades', density: 6.5 },
  sand: { color: '#b0a794', detail: 'pebbles', density: 1.8 },
  gravel: { color: '#93928e', detail: 'chips', density: 6.0 },
  earth: { color: '#9c8768', detail: 'clods', density: 2.6 },
};

// --- noise -------------------------------------------------------------------

function hash2(ix, iz, salt) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, z, salt) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

// --- the weight field ---------------------------------------------------------

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const x = Math.min(w - 1, Math.max(0, i + k));
        s += src[j * w + x];
      }
      tmp[j * w + i] = s / n;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const y = Math.min(h - 1, Math.max(0, j + k));
        s += tmp[y * w + i];
      }
      out[j * w + i] = s / n;
    }
  }
  return out;
}

// Cell weights, blurred twice (two box passes are close enough to a gaussian
// for a metre and a half of feather), then normalised so that at an internal
// border the two weights sum to one and no bare floor shows through.
export function weightField(ground) {
  const { w, h } = ground;
  const names = ground.materials;
  const cells = ground.cells || unpackPaint(ground.paint, w * h);
  const raw = names.map(() => new Float32Array(w * h));
  for (let i = 0; i < w * h; i++) {
    const v = cells[i];
    if (v > 0 && v <= names.length) raw[v - 1][i] = 1;
  }
  const blurred = raw.map((f) => boxBlur(boxBlur(f, w, h, FEATHER), w, h, FEATHER));
  const total = new Float32Array(w * h);
  for (const f of blurred) for (let i = 0; i < w * h; i++) total[i] += f[i];
  const weight = blurred.map((f) => {
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = total[i] > 1e-4 ? f[i] / total[i] : 0;
    return out;
  });
  // The cover's own opacity. Gained a little so the middle of a painted region
  // is fully covered rather than asymptotically approaching it.
  const cover = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cover[i] = Math.min(1, total[i] * 1.35);
  return { cells, weight, cover, names };
}

// Cell values sampled at a grid NODE, which is the average of the up to four
// cells that touch it.
function atNode(field, w, h, i, j) {
  let s = 0;
  let n = 0;
  for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const x = i + di;
    const y = j + dj;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    s += field[y * w + x];
    n += 1;
  }
  return n ? s / n : 0;
}

// --- the detail --------------------------------------------------------------
//
// Small enough that only its shading reads, which is the whole point, and built
// once as a single geometry that is then instanced.

function bladeTuft() {
  // Three tapered blades leaning out of one root, buried a centimetre so there
  // is no daylight where they meet the ground. Same idea as grass.js's blade,
  // at a fraction of the vertex count, because there are thousands of these
  // and each is four pixels tall.
  const geos = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + 0.6;
    const len = 0.14 + 0.07 * hash2(b, 7, 3);
    const g = new THREE.BufferGeometry();
    const wdt = 0.012;
    const lean = 0.045;
    const pos = new Float32Array([
      -wdt, -0.01, 0, wdt, -0.01, 0,
      -wdt * 0.7, len * 0.55, lean * 0.4, wdt * 0.7, len * 0.55, lean * 0.4,
      0, len, lean,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 4]);
    g.rotateY(a);
    g.computeVertexNormals();
    geos.push(g);
  }
  return mergeSimple(geos);
}

function pebble(radius, flat) {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  g.scale(1, flat, 1);
  // Half buried, always, for rule 1: a stone sitting ON the floor reads as
  // dropped there and one passing through it reads as bedded in.
  g.translate(0, -radius * flat * 0.35, 0);
  return g;
}

function mergeSimple(geos) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    pos.set(p, vo * 3);
    nor.set(n, vo * 3);
    const gi = g.index ? g.index.array : null;
    const c = g.attributes.position.count;
    for (let k = 0; k < (gi ? gi.length : c); k++) idx[io + k] = (gi ? gi[k] : k) + vo;
    io += gi ? gi.length : c;
    vo += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function detailGeometry(kind) {
  switch (kind) {
    case 'blades': return bladeTuft();
    case 'chips': return pebble(0.055, 0.45);
    case 'pebbles': return pebble(0.045, 0.40);
    case 'clods': return pebble(0.070, 0.55);
    default: return pebble(0.05, 0.5);
  }
}

// --- the build ----------------------------------------------------------------

export function createGroundCover({ ground, seed = 1, detail = true } = {}) {
  const group = new THREE.Group();
  group.name = 'groundcover';
  const disposables = [];
  const stats = { surfaces: 0, instances: 0 };
  if (!ground || !ground.w || !ground.h) {
    return { group, dispose() {}, stats };
  }

  const { w, h, cell, minX, minZ } = ground;
  const { weight, cover, names } = weightField(ground);

  // The shared surface. One height per node, used by every material, faded to
  // zero at the rim so the cover has no lip.
  const nw = w + 1;
  const nh = h + 1;
  const relief = new Float32Array(nw * nh);
  const nodeCover = new Float32Array(nw * nh);
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const x = minX + i * cell;
      const z = minZ + j * cell;
      const c = atNode(cover, w, h, i, j);
      const n = valueNoise(x / RELIEF_SCALE, z / RELIEF_SCALE, seed)
        + 0.45 * valueNoise(x / (RELIEF_SCALE * 0.4), z / (RELIEF_SCALE * 0.4), seed + 11);
      relief[j * nw + i] = (n / 1.45) * RELIEF * c;
      nodeCover[j * nw + i] = c;
    }
  }

  for (let m = 0; m < names.length; m++) {
    const spec = MATERIALS[names[m]];
    if (!spec) continue;
    const wm = weight[m];

    // --- the surface ---------------------------------------------------------
    const nodeAlpha = new Float32Array(nw * nh);
    let any = false;
    for (let j = 0; j < nh; j++) {
      for (let i = 0; i < nw; i++) {
        const a = atNode(wm, w, h, i, j) * nodeCover[j * nw + i];
        nodeAlpha[j * nw + i] = a;
        if (a > 0.004) any = true;
      }
    }
    if (!any) continue;

    const index = new Int32Array(nw * nh).fill(-1);
    const positions = [];
    const colors = [];
    const base = new THREE.Color(spec.color).convertSRGBToLinear();
    const nodeOf = (i, j) => {
      const k = j * nw + i;
      if (index[k] >= 0) return index[k];
      const x = minX + i * cell;
      const z = minZ + j * cell;
      positions.push(x, relief[k], z);
      // A little colour noise so a large fill is not one flat tone. Long
      // wavelength on purpose: nothing at the pixel scale, which would read as
      // film grain in a project whose house style is matte clay.
      const t = 0.88 + 0.24 * valueNoise(x * 0.7, z * 0.7, seed + 31);
      colors.push(base.r * t, base.g * t, base.b * t, nodeAlpha[k]);
      index[k] = positions.length / 3 - 1;
      return index[k];
    };
    const tris = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = nodeAlpha[j * nw + i];
        const b = nodeAlpha[j * nw + i + 1];
        const c = nodeAlpha[(j + 1) * nw + i];
        const d = nodeAlpha[(j + 1) * nw + i + 1];
        if (a + b + c + d < 0.008) continue;
        const ia = nodeOf(i, j);
        const ib = nodeOf(i + 1, j);
        const ic = nodeOf(i, j + 1);
        const id = nodeOf(i + 1, j + 1);
        tris.push(ia, ic, ib, ib, ic, id);
      }
    }
    if (!tris.length) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geo.setIndex(tris);
    geo.computeVertexNormals();
    const mat = toyMaterial('#ffffff', {
      vertexColors: true,
      transparent: true,
      // The rim is a genuine alpha ramp, so it must not write depth or it
      // punches a hole in whatever is drawn after it.
      depthWrite: false,
      roughness: 0.95,
      // The same fix sandpath.js uses, and for the same reason: the cover is
      // coplanar with the floor at its rim, and the fight is in the depth
      // buffer rather than in the geometry.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      dithering: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1 + m;
    group.add(mesh);
    disposables.push(geo, mat);
    stats.surfaces += 1;

    // --- the detail that makes the border a merge ----------------------------
    if (!detail || !spec.density) continue;
    const perCell = spec.density * cell * cell;
    const dummy = new THREE.Object3D();
    const placed = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const a = wm[k] * cover[k];
        if (a < 0.03) continue;
        // Density follows the weight, which is what interleaves two materials
        // across a border rather than butting them.
        const want = perCell * a;
        const n = Math.floor(want) + (hash2(i, j, m * 977 + seed) < want % 1 ? 1 : 0);
        for (let q = 0; q < n; q++) {
          const rx = hash2(i * 31 + q, j, m + seed * 7);
          const rz = hash2(i, j * 31 + q, m + seed * 13);
          const x = minX + (i + rx) * cell;
          const z = minZ + (j + rz) * cell;
          placed.push(x, z, hash2(i + q, j + q, m + 5) * Math.PI * 2, 0.75 + 0.5 * hash2(q, i + j, m + 9));
        }
      }
    }
    const count = placed.length / 4;
    if (!count) continue;
    const dgeo = detailGeometry(spec.detail);
    const dmat = toyMaterial(spec.color, {
      roughness: 0.95,
      side: spec.detail === 'blades' ? THREE.DoubleSide : THREE.FrontSide,
    });
    const inst = new THREE.InstancedMesh(dgeo, dmat, count);
    for (let q = 0; q < count; q++) {
      const x = placed[q * 4];
      const z = placed[q * 4 + 1];
      // Stand on the shared surface, not on y = 0, or the detail floats over
      // the swell on one side of it and sinks on the other.
      const gi = Math.min(nw - 1, Math.max(0, Math.round((x - minX) / cell)));
      const gj = Math.min(nh - 1, Math.max(0, Math.round((z - minZ) / cell)));
      dummy.position.set(x, relief[gj * nw + gi], z);
      dummy.rotation.set(0, placed[q * 4 + 2], 0);
      dummy.scale.setScalar(placed[q * 4 + 3]);
      dummy.updateMatrix();
      inst.setMatrixAt(q, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    group.add(inst);
    disposables.push(dgeo, dmat);
    stats.instances += count;
  }

  return {
    group,
    stats,
    update() {},
    dispose() {
      for (const d of disposables) d.dispose?.();
      group.clear();
    },
  };
}

export default createGroundCover;
