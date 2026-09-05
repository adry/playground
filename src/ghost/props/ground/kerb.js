import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, toyMaterial } from '../style.js';
import { mulberry32, buildSlabGeometry, heightToNormalMap, GRIME } from '../tombstones.js';

// Kerb stones: the low edging blocks that run along a gravel walk and keep it
// out of the grass. Half sunk, so what shows is a rounded bar about a hand
// high.
//
// The one thing that makes a kerb read as a kerb is that it is MANY SEPARATE
// STONES. An extruded ribbon with grooves in it looks like an extruded ribbon
// with grooves in it, at any distance. So each stone here is its own block with
// its own length, height, width, yaw, tilt and depth of settle, and the joints
// between them are irregular because the stones are, not because a texture says
// so. They are merged into one geometry afterwards, which costs nothing:
// the run is static, so a single draw call gets all of it.
//
// Same quarry as the headstones. The material, the palette entry, the mottle,
// the grime wash and the normal-map strength are tombstones.js's, so a kerb
// laid past a grave is visibly the same rock as the grave marker.

// ---------------------------------------------------------------------------
// The stone.
//
// Against a 1.6 unit ghost and a 0.86 fence post: 0.45 long, 0.16 across, and
// 0.10 of it above the dirt. The buried part is not decoration -- the scene's
// floor is one opaque plane at y = 0, so a stone that sits ON it reads as
// dropped there, and a stone that passes THROUGH it reads as bedded in.
export const KERB = {
  length: 0.45,
  width: 0.16,
  reveal: 0.10,  // how much stands proud of the ground
  buried: 0.11,  // how much is below it
};

// The rounding. A fixed radius in world units rather than a fraction of the
// block, for the reason tombstones.js gives: a proportional radius on a short
// stone becomes a hairline and the piece stops reading as vinyl.
// EDGE started at 0.045 out of an 0.08 half-depth, which is 56% of the way to a
// half-round and turned the run into a line of soft sausages. A kerb stone is a
// BLOCK: it needs a top plane and two side planes that read as different
// surfaces, with the corner rolled off between them.
const EDGE = 0.033;       // the roll across the stone, front and back
const TOP_R = 0.058;      // the roll at the two ends, seen from above
const BOT_R = 0.035;      // the buried corners, only ever seen in silhouette

// How much any of it is allowed to differ, stone to stone. Read these as the
// whole charm of the prop: pushed to zero it is a ribbon again.
const VARY = {
  length: 0.20,           // +/- fraction of the nominal length
  width: 0.08,
  reveal: 0.20,           // a stone standing lower is a stone laid by hand
  yaw: 0.070,             // rad, +/-. About 4 degrees off the run's direction
  roll: 0.065,            // rad, tipped sideways across the run
  tip: 0.050,             // rad, tipped along it
  lateral: 0.016,         // world units off the line, left or right
  gapMin: 0.010,          // the joint between two stones
  gapMax: 0.040,
  settleChance: 0.30,     // fraction of stones that have sunk further
  settleMax: 0.035,
  // Per-stone tone, as a vertex colour multiplying the shared map.
  //
  // The mottle is authored at headstone scale, where one blob is 6 to 28cm
  // across: a 45cm kerb stone therefore sees a fraction of one blob and comes
  // out very nearly flat, so twenty of them off one map read as one moulded
  // strip however different their shapes are. This is the missing frequency,
  // and it is the one a real run has most of: block to block, not within a
  // block. Kept small enough that no stone drifts away from the headstones'
  // grey, which is the whole reason the map is shared in the first place.
  tone: 0.050,            // +/- multiplier on the whole stone
  warm: 0.014,            // +/- red against blue, so the tone is not just value
};

// Two bits of baked occlusion, also carried on the vertex colour. Both are
// there for the same reason: a kerb is background furniture, so it has to read
// as separate blocks bedded in dirt at 300 pixels wide, where a joint is one
// pixel across and the shading either side of it is all there is to see.
const JOINT_AO = 0.16;    // the end faces, which look into a 2cm gap
const GROUND_AO = 0.14;   // the last few centimetres before the dirt
const GROUND_AO_H = 0.05; // over how much height that fades out

// The soft stain in the dirt where a stone is bedded. One patch per stone, not
// a ribbon along the path: a wide joint gets a gap in the stain too, which is
// half of what makes the run read as separate blocks from far enough away that
// the joints themselves are a pixel wide.
const CONTACT = {
  long: 1.30,             // multiples of the stone's own length
  across: 2.60,           // and of its width
  opacity: 0.40,
};

// ---------------------------------------------------------------------------
// The weathered stone, laid out in metres.
//
// mottle() is inlined rather than imported because tombstones.js's version has
// its blob and speckle counts hard-coded for one 848x1024 canvas. This canvas
// is a different shape and a different number of world units across, so the
// counts scale with its area, exactly as lanterns/post.js does it. Same grain
// size in the world either way, which is the whole point: a kerb stone and a
// headstone have to look quarried from the same block.

const PPU = 620;          // texture pixels per world unit, post.js's number
const TEX_U = 1.80;       // world units the map spans along the run, at scale 1
const TEX_V = 0.34;       // and vertically
const V_BELOW = 0.16;     // how far below y = 0 the bottom of the map sits

// The map covers a fixed number of WORLD units, so a run built at scale 2 needs
// a canvas twice as big rather than the same canvas stretched: the pixels per
// unit, and with them the grain, have to stay where they are. Everything that
// converts between world and UV goes through one of these.
const frameFor = (scale) => {
  const k = Math.max(1, scale);
  return { u: TEX_U * k, v: TEX_V * k, below: V_BELOW * k };
};

// The headstones' grime runs from GRIME * 3.4 of a 1.37-high stone down to its
// foot: 0.93 world units, which is where post.js got its own number. Reused
// verbatim so that a kerb, a lantern and a grave are equally dirty at equal
// heights. A kerb lives entirely inside the bottom eighth of that band, so it
// comes out near the full wash, which is correct: it is the dirtiest stone in
// the yard.
const GRIME_TOP = GRIME * 3.4 * 1.37;
const GRIME_ALPHA = 0.34;

function mottle(ctx, w, h, rng, light, dark, strength, speckle = true) {
  const area = (w * h) / (848 * 1024); // tombstones' own canvas, for the counts
  const blobs = Math.round(130 * area);
  for (let i = 0; i < blobs; i++) {
    const x = rng() * w;
    const y = rng() * h;
    // 1024 rather than h: the blob is a fixed size in the WORLD, and this
    // canvas is nothing like a headstone's shape.
    const r = (0.035 + rng() * 0.13) * 1024;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() < 0.5 ? light : dark;
    g.addColorStop(0, `rgba(${col}, ${strength})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rng() * 0.9), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!speckle) return;
  const grains = Math.round(2600 * area);
  for (let i = 0; i < grains; i++) {
    ctx.fillStyle = `rgba(${rng() < 0.5 ? light : dark}, ${strength * 0.55})`;
    ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }
}

// World height to canvas row. v = (worldY + below) / frame.v and the canvas is
// flipped, so this is the one place the mapping is written down.
const rowAt = (h, worldY, f) => h * (1 - (worldY + f.below) / f.v);

function buildTextures(rng, f) {
  const w = Math.round(f.u * PPU);
  const h = Math.round(f.v * PPU);

  const colour = document.createElement('canvas');
  colour.width = w;
  colour.height = h;
  const cc = colour.getContext('2d');
  // White base: PALETTE.stone lives on the material and stays the single source
  // of truth for the hue, exactly as on a headstone.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, h);
  mottle(cc, w, h, rng, '120,116,110', '255,255,255', 0.085);

  // Ground grime. Both ends of the gradient are placed by world height, so most
  // of it falls off the top of this short canvas and what is left is the very
  // bottom of the same wash a headstone gets. Canvas gradients clamp outside
  // their endpoints, so filling the whole canvas is safe.
  const grime = cc.createLinearGradient(0, rowAt(h, GRIME_TOP, f), 0, rowAt(h, 0, f));
  grime.addColorStop(0, 'rgba(146,142,136,0)');
  grime.addColorStop(1, `rgba(146,142,136,${GRIME_ALPHA})`);
  cc.fillStyle = grime;
  cc.fillRect(0, 0, w, h);

  // One thing a kerb has that a headstone does not: a crown that boots and rain
  // have kept clean. Narrow, and keyed to world height like everything else, so
  // it lands on the top few centimetres of every stone however deep it sits.
  const k = f.v / TEX_V; // the run's scale, recovered from the frame
  const worn = cc.createLinearGradient(
    0, rowAt(h, (KERB.reveal + 0.020) * k, f),
    0, rowAt(h, (KERB.reveal - 0.055) * k, f),
  );
  worn.addColorStop(0, 'rgba(255,253,250,0.30)');
  worn.addColorStop(1, 'rgba(255,253,250,0)');
  cc.fillStyle = worn;
  cc.fillRect(0, 0, w, h);

  const height = document.createElement('canvas');
  height.width = w;
  height.height = h;
  // Read back whole by heightToNormalMap and never uploaded, so it belongs
  // in software. See sandpath.js for what this flag was worth: 6.3 s.
  const hc = height.getContext('2d', { willReadFrequently: true });
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w, h);
  // Half the colour map's amplitude and no speckle: on the height map those
  // high frequencies come back through the normals as sandpaper.
  mottle(hc, w, h, mulberry32(1), '96,96,96', '176,176,176', 0.065, false);

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, normalMap: heightToNormalMap(height, 14) };
}

// A soft round stain, for the contact patches. style.js's contactShadow() makes
// one of these as a whole mesh, which would be a draw call per stone; this is
// the same gradient with the mesh part left to the caller.
function contactTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry

// One block. Local axes: +X along the run, +Y up, +Z across it, origin at the
// centre of the bottom face so a tilt pivots about where the stone is bedded.
function stoneGeometry({ length, width, height }) {
  return buildSlabGeometry({
    halfWidth: length / 2,
    height,
    depth: width,
    edge: Math.min(EDGE, width * 0.48),
    bottomRadius: Math.min(BOT_R, length / 2, height * 0.4),
    topRadius: Math.min(TOP_R, length / 2, height * 0.4),
    // UVs are rewritten below from the finished positions and normals; the
    // callback only sees (x, y) and the top face needs z.
    uv: () => [0, 0],
  });
}

// Lay the map on in world units.
//
// u runs along the stone, v runs up it from frame.below under the ground, so the
// grime band lands at the right absolute height whatever the stone is doing.
// The |n| terms are the whole trick: with a plain planar map the top face has
// one v for its entire 16cm width and every blob smears into a stripe along the
// run. Folding z in where the normal points that way turns the top and the two
// ends into proper planar patches of their own, and because the normals roll
// over smoothly across the rounded edges, so does the mapping.
function layUV(geo, baseY, uOff, f) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    uv.setXY(
      i,
      (uOff + x + z * nx) / f.u,
      (f.below + baseY + y + z * ny) / f.v,
    );
  }
  uv.needsUpdate = true;
}

// The per-stone tone and the baked occlusion, as a vertex attribute so the run
// still merges into a single mesh. See VARY.tone and JOINT_AO for why each of
// the three terms is here.
function shade(geo, tone, warm, baseY) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const n = pos.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(nor.getX(i));
    // Squared, so this stays on the end caps and their shoulders instead of
    // creeping along the long faces.
    let k = 1 - JOINT_AO * nx * nx;
    const t = Math.min(1, Math.max(0, (baseY + pos.getY(i)) / GROUND_AO_H));
    k *= 1 - GROUND_AO * (1 - t * t);
    c[i * 3] = tone * k * (1 + warm);
    c[i * 3 + 1] = tone * k;
    c[i * 3 + 2] = tone * k * (1 - warm);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

// ---------------------------------------------------------------------------
// The path

// `points` is a polyline in the XZ plane. Every entry may be
//   [x, z]                     a two-number array
//   { x, z }                   a plain object, or anything with an x and a z
//   THREE.Vector3              x and z are used, y is ignored
//   THREE.Vector2              x and y are read as x and z
// Mixed forms in one array are fine. Two points make a straight run; three or
// more make one with bends in it.
function normalisePoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('createKerbRun: points must be an array of at least two XZ positions');
  }
  const out = [];
  for (const p of points) {
    let x;
    let z;
    if (Array.isArray(p)) { [x, z] = p; }
    else if (p && typeof p === 'object') { x = p.x; z = 'z' in p ? p.z : p.y; }
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error('createKerbRun: every point must be [x, z], {x, z}, a Vector2 or a Vector3');
    }
    // A repeated point has no direction and would divide by zero downstream.
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.z - z) < 1e-9) continue;
    out.push({ x, z });
  }
  if (out.length < 2) throw new Error('createKerbRun: points must describe a path with some length');
  return out;
}

// Arc-length lookup along the polyline.
function pathOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const total = cum[cum.length - 1];
  const at = (s) => {
    const t = Math.min(total, Math.max(0, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < t) i++;
    const span = cum[i] - cum[i - 1];
    const f = span > 1e-9 ? (t - cum[i - 1]) / span : 0;
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
      z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * f,
    };
  };
  return { total, at };
}

// ---------------------------------------------------------------------------

/**
 * A run of kerb stones laid along a polyline.
 *
 * @param {object}  opts
 * @param {number}  opts.seed    every stone's size, angle and settle comes off this
 * @param {Array}   opts.points  the path, in the XZ plane. See normalisePoints
 *                               above: [x, z] pairs, {x, z} objects, Vector2s
 *                               or Vector3s, at least two of them. World units,
 *                               local to the returned group.
 * @param {number}  opts.scale   scales the STONES, not the path. The run still
 *                               covers the polyline you gave it, with more or
 *                               fewer, larger or smaller blocks along it.
 * @returns {{ group: THREE.Group, update: Function, dispose: Function }}
 */
export function createKerbRun({ seed = 1, points, scale = 1 } = {}) {
  const pts = normalisePoints(points);
  const path = pathOf(pts);
  const rng = mulberry32(seed * 2654435761 + 17);

  const group = new THREE.Group();
  const hasDOM = typeof document !== 'undefined';
  const frame = frameFor(scale);
  const tex = hasDOM ? buildTextures(rng, frame) : null;
  const material = toyMaterial(PALETTE.stone, {
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
    vertexColors: true,
  });

  const nomLength = KERB.length * scale;
  const nomGap = (VARY.gapMin + VARY.gapMax) * 0.5 * scale;

  // Pick a whole number of stones, then hand each one a random share of the
  // path. Sharing out the length rather than walking along it and stopping is
  // what keeps the run from ending in half a metre of bare dirt: every stone
  // still differs, but the joints land where the path ends.
  const count = Math.max(1, Math.round(path.total / (nomLength + nomGap)));
  const share = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const w = 1 + (rng() * 2 - 1) * VARY.length;
    share.push(w);
    sum += w;
  }
  const unit = path.total / sum;

  const parts = [];
  const stains = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  let s = 0;
  for (let i = 0; i < count; i++) {
    const pitch = share[i] * unit;
    const gap = (VARY.gapMin + rng() * (VARY.gapMax - VARY.gapMin)) * scale;
    const length = Math.max(0.12 * scale, pitch - gap);

    const width = KERB.width * scale * (1 + (rng() * 2 - 1) * VARY.width);
    let reveal = KERB.reveal * scale * (1 + (rng() * 2 - 1) * VARY.reveal);
    // A few have gone down further than their neighbours. This is the read that
    // says the ground moved under them and nobody came back to lift them.
    if (rng() < VARY.settleChance) reveal -= rng() * VARY.settleMax * scale;
    const height = reveal + KERB.buried * scale;

    // Orientation from the chord between the stone's own two ends, so a bend in
    // the path splays the stones apart at the joint the way a straight block
    // laid round a corner actually does. The centre is pulled halfway back onto
    // the polyline so the run does not cut the corner by the full sagitta.
    const a = path.at(s);
    const b = path.at(s + length);
    const mid = path.at(s + length / 2);
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const cx = ((a.x + b.x) / 2 + mid.x) / 2;
    const cz = ((a.z + b.z) / 2 + mid.z) / 2;

    const lat = (rng() * 2 - 1) * VARY.lateral * scale;

    // World height of the stone's own y = 0, i.e. how deep it is bedded.
    const baseY = reveal - height;

    const geo = stoneGeometry({ length, width, height });
    // Every stone starts somewhere else in the map, so twenty blocks off one
    // texture do not come out as twenty copies of the same grain. The range
    // keeps a whole stone inside the map with no wrap, so the joint faces never
    // pick up a seam.
    layUV(geo, baseY, 0.10 + rng() * Math.max(0.02, frame.u - length - 0.24), frame);
    shade(geo, 1 + (rng() * 2 - 1) * VARY.tone, (rng() * 2 - 1) * VARY.warm, baseY);

    // Yaw so +X follows the chord, then the two tilts in the stone's own frame:
    // roll tips it sideways across the run, tip rocks it along the run. Euler
    // order YXZ is R = Ry * Rx * Rz, so both happen before the yaw is applied.
    const yaw = Math.atan2(-dz, dx) + (rng() * 2 - 1) * VARY.yaw;
    e.set((rng() * 2 - 1) * VARY.roll, yaw, (rng() * 2 - 1) * VARY.tip, 'YXZ');
    q.setFromEuler(e);
    // (-dz, dx) is the perpendicular of the chord in XZ: the wander off the line.
    p.set(cx + lat * -dz, baseY, cz + lat * dx);
    geo.applyMatrix4(m.compose(p, q, one));

    parts.push(geo);

    // The contact stain, flat on the ground, carrying the stone's yaw but none
    // of its tilt. rotateX first so the plane lies down with its width along
    // the stone; then the yaw and the position, in that order.
    if (hasDOM) {
      const stain = new THREE.PlaneGeometry(length * CONTACT.long, width * CONTACT.across);
      stain.rotateX(-Math.PI / 2);
      stain.rotateY(yaw);
      stain.translate(p.x, 0.004, p.z);
      stains.push(stain);
    }

    s += pitch;
  }

  // One geometry, one material, one draw call for the whole run. Merging rather
  // than instancing because every stone is a genuinely different block: an
  // InstancedMesh would have to make the length, width and height variation out
  // of a non-uniform scale on one base block, which scales the corner radii with
  // it, and a rounding that changes size stone to stone is the one thing this
  // house style cannot afford. Merged, each stone carries its own absolute
  // radii, and its UVs are baked in world units so the grime lands at the right
  // height on a stone that has settled.
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  let stainGeo = null;
  let stainMat = null;
  let stainTex = null;
  if (stains.length) {
    stainGeo = mergeGeometries(stains, false);
    for (const g of stains) g.dispose();
    stainTex = contactTexture();
    stainMat = new THREE.MeshBasicMaterial({
      map: stainTex,
      transparent: true,
      opacity: CONTACT.opacity,
      depthWrite: false,      // never occlude anything, it is only a stain
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const stainMesh = new THREE.Mesh(stainGeo, stainMat);
    stainMesh.renderOrder = -1;
    group.add(stainMesh);
  }

  return {
    group,
    // Nothing here moves: a kerb is laid once and then it is furniture. The
    // signature is kept so a scene can drive every prop the same way.
    update() {},
    dispose() {
      merged.dispose();
      material.dispose();
      if (tex) { tex.map.dispose(); tex.normalMap.dispose(); }
      if (stainGeo) { stainGeo.dispose(); stainMat.dispose(); stainTex.dispose(); }
      group.clear();
    },
  };
}

/**
 * One kerb stone on its own, centred on the origin and lying along +X.
 *
 * This is the same code path as a run: a two-point path exactly one stone long
 * comes out as a single block, with the same texture, the same variation and
 * the same bedding depth.
 *
 * @param {object} opts
 * @param {number} opts.seed
 * @param {number} opts.scale
 * @returns {{ group: THREE.Group, update: Function, dispose: Function }}
 */
export function createKerbStone({ seed = 1, scale = 1 } = {}) {
  const half = (KERB.length * scale) / 2;
  return createKerbRun({ seed, scale, points: [[-half, 0], [half, 0]] });
}
