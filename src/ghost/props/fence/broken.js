import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import F from './metrics.js';
import { woodMaterial, rng, board, pointedTop } from './wood.js';

// The breakage.
//
// One observation carries this whole file: wood does not snap clean. It tears
// along the grain into fibrous spikes of wildly different lengths, four to nine
// of them across a picket, the longest two or three times the board's thickness
// and the shortest barely a nub, all leaning a little off the board's axis and
// tapering to points.
//
// Things that were tried and are wrong:
//  - A flat cap on the stump. Reads as a saw cut, every time.
//  - An even zigzag across the end. Reads as stone, or as a cartoon crack.
//  - Spikes scattered as separate sticks with air between them. Reads as a
//    brush, because a real tear is a PARTITION of the cross section: every
//    fibre bundle is still touching its neighbours at the root, and the ragged
//    silhouette comes from their different lengths, not from gaps.
//
// So the spray below starts from the cross section and cuts it up, rather than
// starting from a spike and repeating it. That is the difference between torn
// timber and a stamp.

// --- how a tear is shaped --------------------------------------------------

// How far below the break plane a splinter's root sits. The roots are buried in
// the stump so that no flat plane is ever visible between the spikes, and so
// the lean below has something to pivot about that is inside the wood.
const ROOT_DEPTH = 0.42;      // of the board's thickness

// Each slice is built a touch wider than the gap it was cut for. Leaning a
// slice about a buried root shifts it sideways by a fraction of a millimetre,
// and without the bleed that opens hairline slots you can see straight through
// at high zoom. Overlap inside solid wood costs nothing.
const SLICE_BLEED = 0.14;

// How far up a splinter its full width is carried before the taper starts. A
// fibre torn out of a board does not narrow from the root: it runs at full
// width and then runs out. Tapering from t=0 gave cones, which read as teeth.
const TAPER_HOLD = [0.10, 0.34];

// The chance a slice is also split through the thickness into a front and a
// back sliver of different lengths. Without this the spray is a comb -- correct
// from the front, a single flat slab from the side, which is exactly the angle
// the isometric camera looks from. This is the parameter that makes the break
// read in three-quarter view.
const SPLIT_CHANCE = 0.55;

// Adjacent spikes closer than this in length read as a repeated tooth. Pushing
// them apart is cheap and is most of what keeps a spray from looking stamped.
const MIN_NEIGHBOUR_STEP = 0.16;   // of the length range

// Fresh timber, in the two tones a torn fibre actually shows: down in the
// socket it is shaded, out at the tip it is the bright fresh face. A single
// flat torn colour across the whole spray reads as a plastic crown.
//
// The root is only PART of the way to the shade tone, and the ramp reaches the
// tip colour early. First attempt ran the full shade-to-torn range over the
// whole spike and the spray came out visibly browner than the weathered stump
// under it, which is backwards: a fresh break is the pale warm thing and the
// outside of the board is the dull one. What is wanted is a hint of occlusion
// in the socket, not a two-tone paint job.
const TORN_TIP = new THREE.Color(F.wood.torn).convertSRGBToLinear();
const TORN_ROOT = new THREE.Color(F.wood.shade).convertSRGBToLinear().lerp(TORN_TIP, 0.45);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// wood.js's rng is an xorshift, and xorshift has a fixed point at zero: seed 0
// hashes to 0 and the generator then returns 0 forever. Every seed that reaches
// this file goes through here so a caller passing 0 gets a fence rather than a
// row of identical stubs.
function seeded(seed) {
  return rng((Math.abs(seed | 0) * 2 + 101) >>> 0);
}

// The torn material is white with the tone in the vertex colours, so one
// material can carry the root-to-tip ramp and every splinter in a panel can be
// merged into a single draw. Same trick the pumpkin's shell uses.
export function tornMaterial(options = {}) {
  return woodMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.90, ...options });
}

// Iron left behind where a picket was torn off its rail.
function nailMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.62, metalness: 0.35 });
}

function tintTorn(geo, length, tone) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Brighten fast out of the socket: the shaded part is only the bit the
    // neighbouring spikes actually shadow, which is the first millimetre.
    const k = Math.pow(clamp01(pos.getY(i) / Math.max(1e-5, length)), 0.30);
    c.copy(TORN_ROOT).lerp(TORN_TIP, k).multiplyScalar(tone);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

// The lengths of one tear, as mix values in 0..1 across the width.
//
// Three things layered, and all three are needed:
//  1. a trend, because a break runs across a board rather than starting
//     everywhere at once, so one side of the end is generally longer;
//  2. a heavy-tailed per-fibre draw, so MOST spikes are stubs and a couple run
//     long. A uniform draw gives a row of middling spikes, which is the single
//     most cartoon-looking failure this file can have;
//  3. forced extremes, so even an unlucky seed has one spike near the top of
//     the range and one barely there. The contrast is the read.
function tearLengths(rand, n) {
  const slope = (rand() * 2 - 1) * 0.85;
  const bow = (rand() * 2 - 1) * 0.55;
  const mix = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const trend = slope * (u - 0.5) + bow * (0.25 - (u - 0.5) * (u - 0.5));
    const spike = Math.pow(rand(), 2.1);     // median near 0.28, tail to 1
    mix.push(clamp01(0.16 + 0.55 * trend + 0.78 * spike));
  }

  const iLong = Math.floor(rand() * n);
  mix[iLong] = 0.84 + rand() * 0.16;
  let iShort = Math.floor(rand() * n);
  if (iShort === iLong) iShort = (iShort + 1 + Math.floor(rand() * (n - 1))) % n;
  mix[iShort] = rand() * 0.10;

  // Push neighbours apart, away from whichever of the pair is already the
  // taller, so the forced long spike stays long.
  for (let i = 1; i < n; i++) {
    const d = mix[i] - mix[i - 1];
    if (Math.abs(d) < MIN_NEIGHBOUR_STEP) {
      const push = (MIN_NEIGHBOUR_STEP - Math.abs(d)) * (d >= 0 ? 1 : -1);
      mix[i] = clamp01(mix[i] + push);
    }
  }
  return mix;
}

// Cut the width into n contiguous slices of unequal width. Torn fibre bundles
// are not the same size as each other, and evenly cut slices read as a comb
// even when their lengths differ.
function widthCuts(rand, n) {
  const cuts = [0];
  for (let i = 1; i < n; i++) cuts.push(i / n + (rand() - 0.5) * (0.80 / n));
  cuts.push(1);
  return cuts;
}

function splinterProfile(hold, taper, wobble, phase) {
  return (t) => {
    const k = t <= hold ? 0 : (t - hold) / (1 - hold);
    // Exponents under 1, which is the whole difference between a splinter and
    // a spike. A linear taper draws a triangle, and a long triangle reads as a
    // shard of something brittle. Necking down fast and then running thin all
    // the way out is what a fibre does, and it is what makes the long ones look
    // like fibre rather than like sails.
    //
    // Width runs out slightly later than thickness, so the tip is a flattened
    // blade rather than a peg: wood splits along the grain, it does not sharpen
    // like a pencil.
    const w = 1 - (1 - taper) * Math.pow(k, 0.80);
    const th = 1 - (1 - taper * 0.55) * Math.pow(k, 0.65);
    const rip = 1 + wobble * Math.sin(t * 8.2 + phase) * Math.min(1, t * 5);
    return [Math.max(0.05, w * rip), Math.max(0.04, th)];
  };
}

/**
 * The spray of spikes for one torn end.
 *
 * Built in the broken board's own frame: the break plane is y = 0, the width
 * runs along x, the thickness along z, and the spray points along +y for
 * direction 1 and -y for direction -1. Ready to merge or to add.
 *
 * `reach` scales the lengths for members whose thickness is not a good ruler
 * for their splinters -- a post is as thick as it is wide, and F.splinter's
 * multiples of thickness would give it spikes half its own height.
 */
export function splinteredEnd({
  rand = Math.random,
  width = F.picket.width,
  thickness = F.picket.thickness,
  direction = 1,
  reach = 1,
} = {}) {
  const [nMin, nMax] = F.splinter.count;
  const n = nMin + Math.floor(rand() * (nMax - nMin + 1));
  const [lMin, lMax] = F.splinter.length;
  const cuts = widthCuts(rand, n);
  const mix = tearLengths(rand, n);
  const out = [];

  // The socket floor is not level either: the tear dives deeper on the side the
  // trend runs to, which is what stops the bases lining up.
  const floorTilt = (rand() * 2 - 1) * 0.5;

  const spike = (cx, sw, cz, st, m, longways) => {
    const len = (lMin + (lMax - lMin) * m) * thickness * reach;
    if (len < 1e-4 || sw < 1e-4 || st < 1e-4) return;

    const hold = TAPER_HOLD[0] + rand() * (TAPER_HOLD[1] - TAPER_HOLD[0]);
    const geo = board({
      length: len,
      width: sw * (1 + SLICE_BLEED),
      thickness: st * (1 + SLICE_BLEED),
      round: 0.55,
      // The curl. A torn fibre is never straight, and the bend is what sells it
      // as fibre rather than as a shard of something brittle.
      warp: (rand() * 2 - 1) * len * 0.16,
      warpAxis: rand() < 0.5 ? 'x' : 'z',
      profile: splinterProfile(hold, F.splinter.taper, 0.05 + rand() * 0.05, rand() * 6.283),
      segments: 8,
      ring: 8,
    });

    tintTorn(geo, len, 0.94 + rand() * 0.12);

    // Lean. Longer spikes lean further, because they have more of themselves to
    // be bent by whatever broke the board. F.splinter.lean is the ceiling and
    // nothing here exceeds it: the reference's spikes lean SLIGHTLY, and the
    // long thin ones that are still attached along one edge lie nearly parallel
    // to the board, so a big lean would be the wrong note in both cases.
    const bend = F.splinter.lean * (0.25 + 0.75 * m);
    // A sliver peeled off one face leans outward, away from the board's middle:
    // that is the direction it was actually prised. Everything else leans
    // wherever it likes.
    const tiltX = (rand() * 2 - 1) * bend;
    const tiltZ = longways
      ? Math.sign(cz || rand() - 0.5) * bend * (0.5 + 0.5 * rand())
      : (rand() * 2 - 1) * bend;
    geo.rotateY((rand() * 2 - 1) * 0.35);
    geo.rotateZ(tiltX);
    geo.rotateX(tiltZ);

    // Roots vary in depth so that neither the sockets nor the bases of the
    // spikes agree with each other, and the whole floor tips one way.
    //
    // Then clamped against the spike's own length. Without the clamp the
    // shortest nubs -- which are shorter than the root is deep -- sink entirely
    // below the break plane, and every one of them leaves a hole in the
    // partition through which the stump's flat sawn cap shows. That flat cap is
    // the exact thing this file exists to avoid, and it was visible in the
    // first render as a pale tilted plane between the spikes.
    const across = (cx / Math.max(1e-5, width)) * 2;      // -1 .. 1
    const depth = thickness * ROOT_DEPTH * (0.45 + 0.55 * rand() - 0.4 * floorTilt * across);
    const root = -Math.min(Math.max(0, depth), len * 0.62);
    geo.translate(cx, root, cz);
    if (direction < 0) geo.rotateX(Math.PI);
    out.push(geo);
  };

  for (let i = 0; i < n; i++) {
    const x0 = (cuts[i] - 0.5) * width;
    const x1 = (cuts[i + 1] - 0.5) * width;
    const sw = x1 - x0;
    const cx = (x0 + x1) / 2;

    // Length is tied to slenderness, and this matters more than it sounds. A
    // wide slice that also draws a long length comes out as a broad triangular
    // sail, which reads as a shard of slate. Real long splinters are the THIN
    // ones: a narrow bundle of fibre peels a long way, a wide one snaps off
    // near the break. So the draw above is scaled back for fat slices.
    const nrm = sw / (width / n);                        // 1 = average slice
    const wide = clamp01((nrm - 0.7) / 0.9);
    const slender = clamp01((1.55 - nrm) / 1.15);
    const reachOf = (m) => m * (0.40 + 0.60 * slender);

    // Wide slices split through the thickness more often than narrow ones: a
    // narrow bundle is already a single fibre, a wide one is a laminate.
    if (rand() < SPLIT_CHANCE * (0.45 + 0.85 * wide)) {
      const f = 0.30 + rand() * 0.40;
      const front = thickness * f;
      const back = thickness * (1 - f);
      // The two layers get very different lengths: one of them keeps the
      // slice's own mix, the other is drawn short. That asymmetry is what makes
      // a long sliver hanging off one face, which is the reference's signature.
      const keepFront = rand() < 0.5;
      const other = Math.pow(rand(), 1.8) * 0.55;
      // A split slice is two thin bundles, so each half gets to run longer than
      // the slice as a whole would have.
      const bonus = 0.30;
      spike(cx, sw, -thickness / 2 + front / 2, front, clamp01(reachOf(keepFront ? mix[i] : other) + bonus * slender), f < 0.45);
      spike(cx, sw, thickness / 2 - back / 2, back, clamp01(reachOf(keepFront ? other : mix[i]) + bonus * slender), 1 - f < 0.45);
    } else {
      spike(cx, sw, 0, thickness, reachOf(mix[i]), false);
    }
  }

  return out;
}

// Merge a list of geometries and dispose the parts, or return null for none.
function fuse(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

// A small collector: bodies (weathered) in one bucket, torn fibre in another,
// so a whole damaged panel comes out as two draws and one dispose each.
function makeBuild() {
  return {
    body: [],
    torn: [],
    addBody(g) { if (g) this.body.push(g); },
    addTorn(g) { if (g) this.torn.push(g); },
    addTornAll(list) { for (const g of list) this.torn.push(g); },
  };
}

function meshesFrom(build, materials, out) {
  const body = fuse(build.body);
  const torn = fuse(build.torn);
  if (body) { out.geometries.push(body); out.group.add(new THREE.Mesh(body, materials.wood)); }
  if (torn) { out.geometries.push(torn); out.group.add(new THREE.Mesh(torn, materials.torn)); }
}

// --- members ---------------------------------------------------------------

// A picket, whole. Only used when the panel module has not supplied one; see
// resolveParts below.
function localPicket(rand, height, width, thickness) {
  return board({
    length: height,
    width,
    thickness,
    warp: (rand() * 2 - 1) * F.picket.jitter.lean * width,
    profile: pointedTop(height, width),
    segments: 18,
  });
}

function localPost(rand) {
  return board({
    length: F.post.height,
    width: F.post.width,
    thickness: F.post.thickness,
    round: F.post.round,
    warp: (rand() * 2 - 1) * 0.006,
    segments: 10,
    ring: 16,
  });
}

// A rail runs along +x. board() builds along +y, so the cross section is
// authored as width = the rail's vertical thickness and thickness = its depth
// through the fence, and the whole thing is tipped over. Splinters for its torn
// ends are generated in the same upright frame and tipped with it, which is why
// they are collected before the rotation rather than after.
function railPiece({ rand, from, to, tearAt, tearLo, warp = 0 }) {
  const span = to - from;
  const body = board({
    length: span,
    width: F.rail.thickness,
    thickness: F.rail.depth,
    round: 0.30,
    warp,
    warpAxis: 'z',
    segments: 12,
  });
  const torn = [];
  const addTear = (atTop) => {
    const list = splinteredEnd({
      rand,
      width: F.rail.thickness,
      thickness: F.rail.depth,
      direction: atTop ? 1 : -1,
      reach: 0.85,
    });
    for (const g of list) {
      g.translate(0, atTop ? span : 0, 0);
      torn.push(g);
    }
  };
  if (tearAt) addTear(true);
  if (tearLo) addTear(false);

  const lay = (g) => { g.rotateZ(-Math.PI / 2); g.translate(from, 0, 0); return g; };
  return { body: lay(body), torn: torn.map(lay) };
}

/**
 * A picket snapped at a height, with a splintered top on the stump.
 *
 * `atFraction` is where along the picket it broke, so 0.35 is a low stump and
 * 0.8 is a picket that has lost only its point. The group's origin is the foot
 * of the picket, on the ground.
 */
export function brokenPicket({
  rand = Math.random,
  atFraction = 0.5,
  height = F.picket.height,
  width = F.picket.width,
  thickness = F.picket.thickness,
  materials = null,
} = {}) {
  const mats = materials || { wood: woodMaterial(), torn: tornMaterial(), owned: true };
  const breakAt = height * clamp01(atFraction);
  const build = makeBuild();

  build.addBody(board({
    length: breakAt,
    width,
    thickness,
    warp: (rand() * 2 - 1) * F.picket.jitter.lean * width,
    segments: 12,
  }));
  const spray = splinteredEnd({ rand, width, thickness, direction: 1 });
  for (const g of spray) g.translate(0, breakAt, 0);
  build.addTornAll(spray);

  const out = { group: new THREE.Group(), geometries: [] };
  meshesFrom(build, mats, out);
  for (const m of out.group.children) { m.castShadow = true; m.receiveShadow = true; }

  return {
    group: out.group,
    breakAt,
    dispose() {
      for (const g of out.geometries) g.dispose();
      if (mats.owned) { mats.wood.dispose(); mats.torn.dispose(); }
      out.group.clear();
    },
  };
}

// --- the panel -------------------------------------------------------------

const HALF = F.panel.length / 2;
// Pickets are nailed to the front of the rails and the rails are let into the
// posts, so the three sit at three different depths. The rails are centred in
// the post and the pickets hang off the front of them, which puts the picket
// face a whisker proud of the post face -- which is how a picket fence looks.
const RAIL_Z = 0;
const PICKET_Z = -(F.rail.depth + F.picket.thickness) / 2;

function fallbackLayout() {
  const pitch = F.panel.length / F.panel.pickets;
  const picketX = [];
  for (let i = 0; i < F.panel.pickets; i++) picketX.push(-HALF + pitch * (i + 0.5));
  return {
    length: F.panel.length,
    picketX,
    picketZ: PICKET_Z,
    postX: [-HALF, HALF],
    postZ: 0,
    railY: F.rail.at.map((f) => f * F.picket.height),
    railZ: RAIL_Z,
    railSpan: [-HALF, HALF],
  };
}

// The panel module owns the intact fence and exports its parts so a damaged
// panel lines up with an intact neighbour. It is loaded lazily and by hand
// because the two files land at different times and a static import of a file
// that is not there yet takes the whole build down; when it is absent the
// locals above stand in and the geometry is the same vocabulary either way.
let PANEL = null;
export function usePanelParts(parts) { PANEL = parts || null; }

function resolveLayout() {
  const fallback = fallbackLayout();
  const L = PANEL && PANEL.PANEL_LAYOUT;
  if (!L) return fallback;
  const picketX = L.picketX
    || (Array.isArray(L.pickets) ? L.pickets.map((p) => (typeof p === 'number' ? p : p.x)) : null);
  return {
    length: L.length ?? fallback.length,
    picketX: picketX ?? fallback.picketX,
    picketZ: L.picketZ ?? fallback.picketZ,
    postX: L.postX ?? fallback.postX,
    postZ: L.postZ ?? fallback.postZ,
    railY: L.railY ?? L.rails?.map((r) => (typeof r === 'number' ? r : r.y)) ?? fallback.railY,
    railZ: L.railZ ?? fallback.railZ,
    railSpan: L.railSpan ?? fallback.railSpan,
  };
}

/**
 * A panel with some pickets whole, some snapped at different heights, some gone
 * entirely, and the rails torn through where a section is missing.
 *
 * damage runs 0 (intact) to 1 (mostly destroyed). It is not applied evenly: a
 * fence is not weathered down picket by picket, something came through it in
 * one place, so the damage is centred on a breach that widens as damage rises.
 * That is what lets a run of these read as one fence with a hole in it rather
 * than as several differently rotten fences.
 */
export function createBrokenPanel({ seed = 1, damage = 0.5, scale = 1 } = {}) {
  const rand = seeded(seed);
  const dmg = clamp01(damage);
  const layout = resolveLayout();
  const materials = { wood: woodMaterial(), torn: tornMaterial() };
  const build = makeBuild();
  const extras = [];        // meshes with their own material, ie the nails

  // One nail head shared by every nail in the panel, built only if the panel
  // turns out to need one.
  let nailParts = null;
  const nails = () => {
    if (!nailParts) {
      const geo = new THREE.SphereGeometry(0.0075, 7, 5);
      geo.scale(1, 1, 0.55);
      nailParts = { geo, mat: nailMaterial() };
    }
    return nailParts;
  };

  const height = F.picket.height;
  const railY = layout.railY;

  // --- where the breach is -------------------------------------------------
  const breachX = (rand() - 0.5) * layout.length * 0.55;
  const breachHalf = (0.10 + 0.62 * dmg) * layout.length;

  const state = [];         // 'whole' | 'snapped' | 'gone', per picket
  const breakAt = [];
  for (let i = 0; i < layout.picketX.length; i++) {
    const x = layout.picketX[i];
    const near = 1 - Math.min(1, Math.abs(x - breachX) / breachHalf);
    // Smoothstep, so the breach has edges rather than a linear ramp that leaves
    // every panel with one picket at every possible height.
    const soft = near * near * (3 - 2 * near);
    const sev = dmg * (0.30 + 0.85 * soft) + (rand() - 0.5) * 0.12;
    if (sev < 0.30) { state.push('whole'); breakAt.push(1); }
    else if (sev < 0.66) {
      state.push('snapped');
      // Just under the point at the shallow end, down to a shin-high stump at
      // the deep end.
      const f = 0.80 - ((sev - 0.30) / 0.36) * 0.56 + (rand() - 0.5) * 0.10;
      breakAt.push(clamp01(f));
    } else { state.push('gone'); breakAt.push(0); }
  }

  // --- pickets -------------------------------------------------------------
  for (let i = 0; i < layout.picketX.length; i++) {
    const x = layout.picketX[i];
    const w = F.picket.width * (1 + (rand() - 0.5) * F.picket.jitter.width);
    const h = height * (1 + (rand() - 0.5) * F.picket.jitter.height);
    const lean = (rand() - 0.5) * F.picket.jitter.lean;
    const place = (g) => { g.rotateZ(lean); g.translate(x, 0, layout.picketZ); return g; };

    if (state[i] === 'whole') {
      const g = PANEL?.picketGeometry
        ? PANEL.picketGeometry({ rand, seed: seed * 31 + i, index: i, height: h, width: w, thickness: F.picket.thickness })
        : localPicket(rand, h, w, F.picket.thickness);
      build.addBody(place(g));
      continue;
    }

    if (state[i] === 'snapped') {
      const at = h * breakAt[i];
      build.addBody(place(board({
        length: at,
        width: w,
        thickness: F.picket.thickness,
        warp: (rand() * 2 - 1) * F.picket.jitter.lean * w,
        segments: 12,
      })));
      const spray = splinteredEnd({ rand, width: w, thickness: F.picket.thickness, direction: 1 });
      for (const g of spray) { g.translate(0, at, 0); build.addTorn(place(g)); }
      continue;
    }

    // Gone. A picket that is gone still left something behind most of the time,
    // and which something it left is the difference between a fence that was
    // broken and a fence that was built with a gap in it.
    const evidence = rand();
    if (evidence < 0.38) {
      // A fragment still nailed across the lower rail, torn at both ends.
      const y0 = railY[0] - 0.05 - rand() * 0.06;
      const y1 = railY[0] + 0.04 + rand() * 0.09;
      build.addBody(place(board({
        length: y1 - y0,
        width: w,
        thickness: F.picket.thickness,
        segments: 8,
      }).translate(0, y0, 0)));
      for (const g of splinteredEnd({ rand, width: w, thickness: F.picket.thickness, direction: 1 })) {
        build.addTorn(place(g.translate(0, y1, 0)));
      }
      for (const g of splinteredEnd({ rand, width: w, thickness: F.picket.thickness, direction: -1 })) {
        build.addTorn(place(g.translate(0, y0, 0)));
      }
    } else if (evidence < 0.72) {
      // Nails left in the rails. Sub-pixel at scene scale, but at the zoom the
      // break is judged at they are the thing that says a picket used to be
      // here, and they cost two dozen triangles.
      for (const y of railY) {
        if (rand() < 0.25) continue;      // one of them pulled through
        const m = new THREE.Mesh(nails().geo, nails().mat);
        m.position.set(x + (rand() - 0.5) * w * 0.4, y + (rand() - 0.5) * 0.012, layout.railZ - F.rail.depth / 2);
        extras.push(m);
      }
    }
    // else: nothing at all. Some pickets just go.
  }

  // --- rails ---------------------------------------------------------------
  // Where a run of pickets is missing there is nothing holding the rail, so the
  // rail is torn through as well. The two rails never tear at the same x: a
  // matched pair of breaks reads as a cut-out, and one of the strongest reads
  // in the reference is a rail snapped mid-span while its neighbour holds.
  const goneIdx = state.map((s, i) => (s === 'gone' ? i : -1)).filter((i) => i >= 0);
  let gap = null;
  if (goneIdx.length >= 2) {
    // Longest contiguous run of missing pickets.
    let bestA = goneIdx[0], bestB = goneIdx[0], a = goneIdx[0], b = goneIdx[0];
    for (let k = 1; k < goneIdx.length; k++) {
      if (goneIdx[k] === b + 1) b = goneIdx[k];
      else { a = b = goneIdx[k]; }
      if (b - a > bestB - bestA) { bestA = a; bestB = b; }
    }
    if (bestB > bestA) gap = [layout.picketX[bestA], layout.picketX[bestB]];
  }

  const [spanA, spanB] = layout.railSpan;
  for (let r = 0; r < railY.length; r++) {
    const y = railY[r];
    const place = (g) => { g.translate(0, y, layout.railZ); return g; };

    // A rail can also let go on its own once the fence is well gone, even where
    // the pickets beside it are still standing.
    const solo = !gap && dmg > 0.40 && rand() < (dmg - 0.40) * 1.3;

    if (!gap && !solo) {
      const g = PANEL?.railGeometry
        ? PANEL.railGeometry({ rand, index: r, from: spanA, to: spanB })
        : railPiece({ rand, from: spanA, to: spanB }).body;
      build.addBody(place(g));
      continue;
    }

    // Tear points, jittered per rail so the two rails never line up. Where a
    // run of pickets is missing the rail loses a length of itself into the gap;
    // where it simply let go it is one break with the two halves still meeting,
    // parted by the kerf of fibre that went with the other side.
    let tearL, tearR;
    if (gap) {
      const lo = gap[0];
      const hi = gap[1];
      tearL = lo + (rand() - 0.4) * (hi - lo) * 0.45;
      tearR = hi - (rand() - 0.4) * (hi - lo) * 0.45;
    } else {
      const t = spanA + (spanB - spanA) * (0.28 + rand() * 0.44);
      const kerf = 0.005 + rand() * 0.012;
      tearL = t - kerf;
      tearR = t + kerf;
    }

    // At the deep end of the damage a whole half of a rail can be gone rather
    // than merely broken.
    const lostLeft = gap && dmg > 0.72 && rand() < (dmg - 0.72) * 1.6;
    const lostRight = gap && !lostLeft && dmg > 0.72 && rand() < (dmg - 0.72) * 1.6;

    if (!lostLeft && tearL > spanA + 0.05) {
      const piece = railPiece({ rand, from: spanA, to: tearL, tearAt: true });
      // A free end with nothing under it drops. Rotated about the post end, so
      // the rail stays let into the post and only the torn end sags.
      const droop = gap ? -(0.015 + rand() * 0.045) : 0;
      const sag = (g) => { g.translate(-spanA, 0, 0); g.rotateZ(droop); g.translate(spanA, 0, 0); return place(g); };
      build.addBody(sag(piece.body));
      for (const g of piece.torn) build.addTorn(sag(g));
    }
    if (!lostRight && tearR < spanB - 0.05) {
      const piece = railPiece({ rand, from: tearR, to: spanB, tearLo: true });
      const droop = gap ? (0.015 + rand() * 0.045) : 0;
      const sag = (g) => { g.translate(-spanB, 0, 0); g.rotateZ(droop); g.translate(spanB, 0, 0); return place(g); };
      build.addBody(sag(piece.body));
      for (const g of piece.torn) build.addTorn(sag(g));
    }
  }

  // --- posts ---------------------------------------------------------------
  // The posts are what is left standing when everything between them has gone,
  // so they survive nearly always. At the very deep end one of them can lose
  // its head, which is worth having because a broken post is a much heavier
  // break than a broken picket and it changes the silhouette of the whole run.
  const postBroken = dmg > 0.80 && rand() < (dmg - 0.80) * 2.2 ? (rand() < 0.5 ? 0 : 1) : -1;
  for (let p = 0; p < layout.postX.length; p++) {
    const x = layout.postX[p];
    const place = (g) => { g.translate(x, 0, layout.postZ); return g; };
    if (p !== postBroken) {
      const g = PANEL?.postGeometry ? PANEL.postGeometry({ rand, index: p }) : localPost(rand);
      build.addBody(place(g));
      continue;
    }
    const at = F.post.height * (0.48 + rand() * 0.22);
    build.addBody(place(board({
      length: at,
      width: F.post.width,
      thickness: F.post.thickness,
      round: F.post.round,
      segments: 8,
      ring: 16,
    })));
    // reach is pulled well in here: F.splinter.length is in multiples of the
    // board's THICKNESS, and a post is as thick as it is wide, so the honest
    // 2.4x would hand it spikes a third of its own height long.
    for (const g of splinteredEnd({
      rand, width: F.post.width, thickness: F.post.thickness, direction: 1, reach: 0.45,
    })) build.addTorn(place(g.translate(0, at, 0)));
  }

  // --- assemble ------------------------------------------------------------
  const out = { group: new THREE.Group(), geometries: [] };
  meshesFrom(build, materials, out);
  for (const e of extras) out.group.add(e);
  for (const m of out.group.children) { m.castShadow = true; m.receiveShadow = true; }
  out.group.scale.setScalar(scale);

  return {
    group: out.group,
    // Static prop. The interface is here so a damaged panel drops into the same
    // list as the pumpkin and the tombstones without a special case at the call
    // site, which is the only reason props that do not move still carry it.
    update() {},
    dispose() {
      for (const g of out.geometries) g.dispose();
      if (nailParts) { nailParts.geo.dispose(); nailParts.mat.dispose(); }
      materials.wood.dispose();
      materials.torn.dispose();
      out.group.clear();
    },
  };
}

export default createBrokenPanel;
