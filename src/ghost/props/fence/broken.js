import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import F from './metrics.js';
import { rng, board } from './wood.js';
import {
  PANEL_LAYOUT, panelParts, picketGeometry, postGeometry, railGeometry, woodPanelMaterial,
} from './panel.js';

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
const ROOT_DEPTH = 0.30;      // of the board's thickness

// Each slice is built a touch wider than the gap it was cut for, so neighbours
// interpenetrate rather than meeting on a seam that a lean can open into a
// hairline slot you see straight through at high zoom. Overlap inside solid
// wood costs nothing.
//
// Inward only, and that is the whole of it: a slice on the edge of the board,
// or one spanning the full thickness of it, must NOT be bled, because then
// every spike stands a fraction proud of the face it came out of. A hundredth
// of a unit of overhang all the way round the break is enough to catch the key
// light and lay a hard horizontal shadow line across the stump, and that line
// reads as a cut. It was the loudest thing wrong with the fourth render and it
// had nothing to do with the shapes of the spikes at all.
const SLICE_BLEED = 0.16;

// How far ABOVE the break plane a splinter carries its full width before it
// necks, as a multiple of the board's thickness. Wildly varied on purpose.
//
// This is what makes the base of a tear a solid ragged mass with notches cut
// into it, rather than a row of separate cones standing on a flat table. Held
// as a fraction of each spike's own length instead, every spike necked within a
// millimetre or two of the plane, they all came apart at once, and the stump's
// flat sawn top showed in the V between every pair. Straight-on at high zoom
// that was unmistakably a cut with spikes glued to it.
// Two numbers: the floor a long spike gets, and how much MORE a short one
// gets. Tying the hold to the spike's own length is what sorts the two jobs a
// spray has to do at once. The nubs are the torn floor and want to carry their
// width almost to their tips; the long ones are fibre and want to be thin
// almost at once. One hold for both gave either a table with cones on it or a
// row of bottles, depending which way it was set.
const TAPER_HOLD = [0.15, 0.95];    // of the board's thickness

// The chance a slice is also split through the thickness into a front and a
// back sliver of different lengths. Without this the spray is a comb -- correct
// from the front, a single flat slab from the side, which is exactly the angle
// the isometric camera looks from. This is the parameter that makes the break
// read in three-quarter view.
const SPLIT_CHANCE = 0.65;

// Adjacent spikes closer than this in length read as a repeated tooth. Pushing
// them apart is cheap and is most of what keeps a spray from looking stamped.
const MIN_NEIGHBOUR_STEP = 0.16;   // of the length range

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// wood.js's rng is an xorshift, and xorshift has a fixed point at zero: seed 0
// hashes to 0 and the generator then returns 0 forever. The panel's own seeds
// go straight to panelParts, but the stream that decides what breaks comes
// through here, so a caller passing 0 gets a fence rather than a row of
// identical stumps.
function seeded(seed) {
  return rng((Math.abs(seed | 0) * 2 + 101) >>> 0);
}

// Iron left behind where a picket was torn off its rail. The one thing in the
// set that is not wood, so the one thing that does not use the wood material.
function nailMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.62, metalness: 0.35 });
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
    const spike = Math.pow(rand(), 2.6);     // median near 0.23, tail to 1
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
  // Plus or minus a quarter of a slice. Went to 0.40 first, which throws up the
  // occasional slice nearly twice the average width, and a slice that wide is a
  // block however it is tapered.
  for (let i = 1; i < n; i++) cuts.push(i / n + (rand() - 0.5) * (0.50 / n));
  cuts.push(1);
  return cuts;
}

// The cross-section of one spike along its length, as board() wants it.
//
// Three stages, and the middle one is the one that matters:
//
//  1. FULL WIDTH through everything that is buried in the stump and a little
//     above it. Measuring the taper from the buried root instead let it start
//     underground, so every spike arrived at the break plane already half its
//     width and left a hole in the partition for the flat cap to show through.
//  2. A short SHOULDER where it necks down to a shaft. This is what a splinter
//     actually looks like: broad where it is still attached to the board, and
//     then suddenly a thin fibre. Without it the long spikes come out as broad
//     triangular fins, which read as shark or as slate, never as timber. How
//     thin the shaft gets is tied to how far the spike runs -- the long ones
//     are the thin ones.
//  3. A near-parallel SHAFT that only points at the very end. Tried 0.8 first,
//     which runs the spike out in a smooth curve and made every spike a horn;
//     then 1.15, near linear, which turned the whole spike back into one long
//     triangle and undid stage 2. The run has to be back-loaded.
//
// Width runs out a little later than thickness, so the tip is a flattened blade
// rather than a peg: wood splits along the grain, it does not sharpen like a
// pencil.
// How much of a spike is broad before it necks down to its shaft, measured as a
// multiple of the BOARD's thickness rather than as a fraction of the spike's
// own length. That distinction is the difference between a splinter and a
// tooth: a fraction of the length means a long spike carries a long broad wedge
// at its base, and it is the wedge that reads as a tooth. In real timber the
// broad part is a fixed few millimetres of wood however far the fibre runs, so
// the longer the spike the sooner it goes thin. Randomised per spike as well,
// because a fixed shoulder puts every waist at the same height and draws a
// visible collar right round the break.
const SHOULDER = [0.12, 0.38];    // of the board's thickness

function splinterProfile({ hold, shaft, shoulder, taper, wobble, phase }) {
  const shaftT = 0.45 + 0.55 * shaft;      // thickness necks less hard than width
  const tipW = taper * shaft;
  const tipT = taper * 0.55 * shaftT;
  return (t) => {
    const k = t <= hold ? 0 : (t - hold) / Math.max(1e-4, 1 - hold);
    const nk = Math.min(1, k / Math.max(0.03, shoulder));
    const neck = nk * nk * (3 - 2 * nk);
    // High exponents on the run-out, so the shaft really is a shaft: near
    // parallel for most of its length and then a point. At 1.15 the run-out is
    // near linear and it eats the shoulder, which leaves the spike one long
    // triangle from base to tip -- which was the fin all over again.
    const w = (1 + (shaft - 1) * neck) * (1 - (1 - tipW / shaft) * Math.pow(k, 2.20));
    const th = (1 + (shaftT - 1) * neck) * (1 - (1 - tipT / shaftT) * Math.pow(k, 1.90));
    // A notch or two along the edge, because a fibre lets go of its neighbour
    // in steps rather than along one clean line.
    const rip = 1 + wobble * Math.sin(t * 11.3 + phase) * Math.min(1, t * 5);
    return [Math.max(0.03, w * rip), Math.max(0.03, th)];
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
  // Biased to the top of the range. Four fibre bundles across a picket makes
  // each of them a third of the board wide, and a wide bundle reads as a fin no
  // matter how it is tapered. The low end of F.splinter.count is there for
  // narrow members like a rail's edge, not for the broad face of a picket.
  const n = nMin + Math.floor(Math.pow(rand(), 0.60) * (nMax - nMin + 1));
  const [lMin, lMax] = F.splinter.length;
  const cuts = widthCuts(rand, n);
  const out = [];

  // The socket floor is not level either: the tear dives deeper on the side the
  // trend runs to, which is what stops the bases lining up.
  const floorTilt = (rand() * 2 - 1) * 0.5;

  // Slices first, then lengths, then the two are paired -- rather than drawing a
  // length for each slice as it is built.
  //
  // The pairing is the point. Length has to go to the NARROW slices: a wide
  // slice that draws a long length comes out as a broad triangular sail, which
  // reads as a shard of slate rather than as fibre, and it was the loudest
  // wrong note in the first render. A narrow bundle of fibre peels a long way;
  // a wide one snaps off near the break. So the lengths are sorted and handed
  // out by slenderness, with enough noise in the ranking that it is a tendency
  // and not a rule you can read off the model.
  const slices = [];
  for (let i = 0; i < n; i++) {
    const x0 = (cuts[i] - 0.5) * width;
    const x1 = (cuts[i + 1] - 0.5) * width;
    const sw = x1 - x0;
    const nrm = sw / (width / n);                     // 1 = an average slice
    slices.push({
      cx: (x0 + x1) / 2,
      sw,
      wide: clamp01((nrm - 0.7) / 0.9),
      rank: clamp01((1.55 - nrm) / 1.15) + (rand() - 0.5) * 0.45,
    });
  }
  const order = slices.map((_, i) => i).sort((a, b) => slices[b].rank - slices[a].rank);
  const lengths = tearLengths(rand, n).slice().sort((a, b) => b - a);
  order.forEach((sliceIndex, k) => { slices[sliceIndex].mix = lengths[k]; });

  const spike = (cx, sw, cz, st, m, longways) => {
    const len = (lMin + (lMax - lMin) * m) * thickness * reach;
    if (len < 1e-4 || sw < 1e-4 || st < 1e-4) return;

    // Root depth, chosen before the shape, because the shape depends on it.
    const across = (cx / Math.max(1e-5, width)) * 2;      // -1 .. 1
    const depth = thickness * ROOT_DEPTH * (0.45 + 0.55 * rand() - 0.4 * floorTilt * across);
    // Clamped against the spike's own length. Without the clamp the shortest
    // nubs -- shorter than the root is deep -- sink entirely below the break
    // plane, and each one leaves a hole in the partition through which the
    // stump's flat sawn cap shows. That flat cap is the one thing this file
    // exists to avoid, and it was plainly visible in the first render.
    const buried = Math.min(Math.max(0, depth), len * 0.62);

    // The taper is held flat over everything that is buried, plus a little
    // more, so the spike is at FULL width where it crosses the break plane.
    // Measuring the hold from the root instead let the taper start underground
    // and every spike arrived at the surface already half-width, which reopened
    // the same holes the clamp above had just closed.
    // Capped at most of what is above the plane rather than a little of it,
    // and this is what makes the short spikes do their real job. A nub that
    // necks straight away is a cone, ten cones standing on the stump's flat top
    // are ten cones standing on a table, and looking along the break you see
    // the table between every pair of them. A nub that carries its full width
    // almost to its tip is a piece of the torn floor instead, and between them
    // the cross section stays covered. Straight-on at high zoom this is the
    // single change that stopped the break reading as a cut.
    const inv = (1 - m) * (1 - m);
    const holdAbove = Math.min(
      thickness * (TAPER_HOLD[0] + TAPER_HOLD[1] * inv) * (0.5 + rand()),
      (len - buried) * 0.70,
    );
    const hold = (buried + holdAbove) / len;

    const geo = board({
      length: len,
      width: sw,
      thickness: st,
      // Well under the 0.35 a board gets. Torn fibre has arrises on it; rounded
      // off it comes back as a row of smooth teeth.
      round: 0.22,
      // The curl. A torn fibre is never straight, and the bend is what sells it
      // as fibre rather than as a shard of something brittle.
      //
      // Through the thickness only. board()'s warp peaks at the middle of the
      // board and is only zero at its two ends, so a spike buried a fifth of
      // its length has already drifted a quarter of a slice width by the time
      // it reaches the break plane. Sideways that tears holes in the partition
      // and you see the stump's flat top through them; through the thickness
      // the slice's own bleed covers it.
      warp: (rand() * 2 - 1) * len * 0.05,
      warpAxis: 'z',
      profile: splinterProfile({
        hold,
        shoulder: clamp01(
          (thickness * (SHOULDER[0] + rand() * (SHOULDER[1] - SHOULDER[0])))
          / Math.max(1e-5, len * (1 - hold)),
        ) || 0.05,
        // The long ones are the thin ones. Same rule as the pairing above,
        // applied a second time inside the spike itself. Started at 0.86 for a
        // nub, which left the short spikes as wide as they were tall: rounded
        // blocks that read as molars rather than as broken fibre.
        shaft: 0.70 - 0.42 * m,
        taper: F.splinter.taper,
        wobble: 0.06 + rand() * 0.07,
        phase: rand() * 6.283,
      }),
      // 16, not 8. The shoulder is only 16% of the run, so at 8 segments it
      // falls between two rings and the loft interpolates straight across it --
      // which quietly turns every spike back into a plain triangle no matter
      // what the profile says. The profile is only as sharp as it is sampled.
      segments: 16,
      ring: 8,
    });

    geo.userData.splinterLength = len;

    // Drop the spike onto its root FIRST, so the lean that follows pivots about
    // the break plane rather than about the buried end. Pivoting about the root
    // swings the buried part sideways out through the face of the board, and
    // the offcuts show up as little chips stuck to the outside of the stump.
    geo.translate(0, -buried, 0);

    // Lean, and the SHORT ones lean hardest. That is the opposite of the first
    // guess and it matters more than it sounds. The long spikes are the fibres
    // that ran; the reference has them standing almost parallel to the board,
    // still attached along an edge. The short ones are the torn floor, and a
    // floor of squat blocks all standing square has flat tops all at much the
    // same height, which is a tier, which reads as a table with lumps on it.
    // Tilt them and their tops meet each other at angles instead, which is what
    // a fracture surface actually looks like. F.splinter.lean is the ceiling
    // and nothing here exceeds it.
    const bend = F.splinter.lean * (1.0 - 0.62 * m);
    // A sliver peeled off one face leans outward, away from the board's middle:
    // that is the direction it was actually prised.
    const tiltZ = longways
      ? Math.sign(cz || rand() - 0.5) * bend * (0.5 + 0.5 * rand())
      : (rand() * 2 - 1) * bend;
    geo.rotateY((rand() * 2 - 1) * 0.15);
    geo.rotateZ((rand() * 2 - 1) * bend);
    geo.rotateX(tiltZ);

    geo.translate(cx, 0, cz);
    if (direction < 0) geo.rotateX(Math.PI);
    out.push(geo);
  };

  const bleedT = thickness * SLICE_BLEED * 0.5;
  slices.forEach((sl, i) => {
    // Bled toward whichever neighbour exists, and not at all on the outside of
    // the board. See SLICE_BLEED.
    const x0 = sl.cx - sl.sw / 2 - (i > 0 ? sl.sw * SLICE_BLEED * 0.5 : 0);
    const x1 = sl.cx + sl.sw / 2 + (i < slices.length - 1 ? sl.sw * SLICE_BLEED * 0.5 : 0);
    const sw = x1 - x0;
    const cx = (x0 + x1) / 2;

    // Wide slices split through the thickness more often than narrow ones: a
    // narrow bundle is already a single fibre, a wide one is a laminate.
    if (rand() < SPLIT_CHANCE * (0.45 + 0.85 * sl.wide)) {
      // Front and back grow toward each other by the bleed and away from each
      // other not at all, so neither stands proud of the board's face.
      const f = 0.30 + rand() * 0.40;
      const front = thickness * f + bleedT;
      const back = thickness * (1 - f) + bleedT;
      // The two layers get very different lengths: one keeps the slice's own
      // draw, the other is drawn short. That asymmetry is what leaves a long
      // sliver hanging off one face, which is the reference's signature.
      const keepFront = rand() < 0.5;
      const other = Math.pow(rand(), 1.8) * 0.55;
      // Splitting makes two thin bundles out of one fat one, so each half is
      // allowed to run further than the slice as a whole would have.
      const bonus = 0.22 * (1 - sl.wide);
      spike(cx, sw, -thickness / 2 + front / 2, front,
        clamp01((keepFront ? sl.mix : other) + bonus), f < 0.45);
      spike(cx, sw, thickness / 2 - back / 2, back,
        clamp01((keepFront ? other : sl.mix) + bonus), 1 - f < 0.45);
    } else {
      spike(cx, sw, 0, thickness, sl.mix, false);
    }
  });

  return out;
}
// --- plumbing ---------------------------------------------------------------

// Merge a list of geometries and dispose the parts, or return null for none.
// Everything in a damaged panel shares one of two materials, so a whole panel
// comes out as two draws.
function fuse(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

// Bodies (weathered) in one bucket, torn fibre in the other.
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
  for (const m of out.group.children) { m.castShadow = true; m.receiveShadow = true; }
}

// --- painting ---------------------------------------------------------------
//
// panel.js's material takes its tone from a `color` attribute and its grain
// streaks from an `aGrain` attribute, and a board missing either comes out
// black or ungrained beside its neighbours. picketGeometry and friends paint
// themselves; the pieces this file has to cut for itself -- a stump, a headless
// post -- do not exist there, so they are painted here.
//
// The two functions below therefore restate the tone ramp panel.js applies
// privately in its paintBoard. That is a duplication and it is on purpose: it
// draws from the SAME rng stream in the SAME order, so a stump rebuilt from a
// picket's seed carries the grain phase and the weathering that picket would
// have had, and a break lines up with the board it broke off. If paintBoard is
// ever exported this should call it instead.

const PALE = new THREE.Color(F.wood.pale);
const SHADE = new THREE.Color(F.wood.shade);

function paintCut(geo, rand, { axis = 0, groundEnd = true } = {}) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const grain = new Float32Array(n * 2);
  const c = new THREE.Color();
  const phase = rand() * Math.PI * 2;
  const tint = rand() * F.grain.tint;
  const mottlePhase = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const along = axis === 1 ? pos.getX(i) : pos.getY(i);
    let k = tint + 0.10 * (0.5 + 0.5 * Math.sin(along * 4.3 + mottlePhase))
                 + 0.06 * (0.5 + 0.5 * Math.sin(along * 11.7 + phase));
    if (groundEnd) k += Math.max(0, 1 - along / 0.09) * 0.22;
    c.copy(PALE).lerp(SHADE, Math.min(1, k));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    grain[i * 2] = phase; grain[i * 2 + 1] = axis;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrain', new THREE.BufferAttribute(grain, 2));
  return geo;
}

// A whole spray, painted for the torn material. The material carries F.wood.torn
// as its colour, so what the vertices carry here is only the shading: a little
// darker down in the socket where the neighbouring spikes crowd it, full tone
// out at the tip. A flat torn colour across the whole spray reads as a plastic
// crown; the full shade-to-torn range across it reads as a two-tone paint job
// and, worse, comes out browner than the weathered stump underneath, which is
// backwards. A fresh break is the pale warm thing in the picture.
function paintSpray(list, rand, axis = 0) {
  const phase = rand() * Math.PI * 2;
  for (const geo of list) {
    const tone = 0.95 + rand() * 0.10;
    const len = geo.userData.splinterLength || 1;
    const base = geo.userData.splinterBase || 0;
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const grain = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const up = axis === 1 ? Math.abs(pos.getX(i) - base) : pos.getY(i) - base;
      // Measured in world units out of the socket, NOT as a fraction of the
      // spike's own length. The spikes' full-width bases all sit at much the
      // same height and light as one continuous pale belt round the break; what
      // separates that belt from the tips above it is that it is down in a
      // socket with wood on three sides of it. A per-spike fraction shades a
      // nub and a needle the same, which is the one thing that does not help.
      const k = 0.72 + 0.28 * Math.pow(clamp01(up / (F.picket.thickness * 1.4)), 0.55);
      const v = k * tone;
      colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
      grain[i * 2] = phase; grain[i * 2 + 1] = axis;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aGrain', new THREE.BufferAttribute(grain, 2));
  }
  return list;
}

// --- members ---------------------------------------------------------------

// A stump: a picket cut off at a height, rebuilt from the same seed the intact
// panel would have used, so it is the same board minus its top.
//
// The first draw off the stream has to be the warp, because that is what
// picketGeometry draws first; get the order wrong and the stump bows a
// different way from the picket beside it.
function stumpGeometry({ rand, height, width }) {
  const geo = board({
    length: height,
    width,
    thickness: F.picket.thickness,
    round: F.picket.round,
    warp: (rand() - 0.5) * 2 * F.picket.warp,
    warpAxis: 'z',
    segments: 14,
    ring: 16,
  });
  return paintCut(geo, rand);
}

function headlessPostGeometry({ rand, height }) {
  const geo = board({
    length: height,
    width: F.post.width,
    thickness: F.post.thickness,
    round: F.post.round,
    warp: (rand() - 0.5) * 2 * F.post.warp,
    warpAxis: 'z',
    segments: 20,
    ring: 20,
  });
  return paintCut(geo, rand);
}

/**
 * A picket snapped at a height, with a splintered top on the stump.
 *
 * `atFraction` is where along the picket it broke, so 0.8 is a picket that has
 * lost only its point and 0.3 is a shin-high stump. The group's origin is the
 * foot of the picket. `rand` is an rng() stream from wood.js, not Math.random.
 */
export function brokenPicket({
  rand = rng(1),
  atFraction = 0.5,
  height = F.picket.height,
  width = F.picket.width,
  materials = null,
} = {}) {
  const mats = materials || {
    wood: woodPanelMaterial(),
    torn: woodPanelMaterial({ color: new THREE.Color(F.wood.torn) }),
    owned: true,
  };
  const breakAt = height * clamp01(atFraction);
  const build = makeBuild();

  build.addBody(stumpGeometry({ rand, height: breakAt, width }));
  const spray = splinteredEnd({ rand, width, thickness: F.picket.thickness, direction: 1 });
  for (const g of spray) {
    g.translate(0, breakAt, 0);
    g.userData.splinterBase = breakAt;
  }
  build.addTornAll(paintSpray(spray, rand));

  const out = { group: new THREE.Group(), geometries: [] };
  meshesFrom(build, mats, out);

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

// Lay a spray down along X, the way railGeometry lays a rail down. +Y goes to
// +X, so a spray built pointing up ends up pointing along the rail.
const layAlongX = (g) => g.rotateZ(-Math.PI / 2);

/**
 * A panel with some pickets whole, some snapped at different heights, some gone
 * entirely, and the rails torn through where a section is missing.
 *
 * Built from panel.js's own parts and PANEL_LAYOUT, off the same seed, so a
 * damaged panel butts an intact one and every board that survived is the board
 * that would have been there.
 *
 * damage runs 0 (intact) to 1 (mostly destroyed), and it is deliberately NOT
 * applied evenly. A fence does not rot away picket by picket; something came
 * through it in one place. So the damage is centred on a breach that widens as
 * damage rises, which is what lets a run of these read as one fence with a hole
 * knocked in it rather than as several differently ruined fences.
 */
export function createBrokenPanel({ seed = 1, damage = 0.5, scale = 1 } = {}) {
  const rand = seeded(seed);
  const dmg = clamp01(damage);
  const parts = panelParts({ seed });
  const materials = {
    wood: woodPanelMaterial(),
    torn: woodPanelMaterial({ color: new THREE.Color(F.wood.torn) }),
  };
  const build = makeBuild();
  const extras = [];

  // One nail head shared by every nail in the panel, built only if this panel
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

  const L = PANEL_LAYOUT.length;
  const spanA = -L / 2;
  const spanB = L / 2;

  // --- where the breach is -------------------------------------------------
  const breachX = (rand() - 0.5) * L * 0.55;
  const breachHalf = (0.08 + 0.52 * dmg) * L;

  const state = [];         // 'whole' | 'snapped' | 'gone', per picket
  const cutAt = [];
  for (const p of parts.pickets) {
    const near = 1 - Math.min(1, Math.abs(p.x - breachX) / breachHalf);
    // Smoothstepped, so the breach has edges. A linear ramp leaves every panel
    // with exactly one picket at every possible height, which is a gradient,
    // not a hole.
    const soft = near * near * (3 - 2 * near);
    const sev = dmg * (0.26 + 0.86 * soft) + (rand() - 0.5) * 0.12;
    if (sev < 0.30) { state.push('whole'); cutAt.push(1); }
    else if (sev < 0.66) {
      state.push('snapped');
      // Just under the point at the shallow end of the band, down to a stump at
      // the deep end.
      // The jitter is wide on purpose. Mapped straight off severity the whole
      // middle of a breach snaps at nearly one height, and a row of stumps all
      // the same height is a hedge, not a fence somebody went through.
      cutAt.push(clamp01(0.78 - ((sev - 0.30) / 0.36) * 0.48 + (rand() - 0.5) * 0.26));
    } else { state.push('gone'); cutAt.push(0); }
  }

  // --- pickets -------------------------------------------------------------
  parts.pickets.forEach((p, i) => {
    // The board's own stream, so a picket this panel keeps is bit for bit the
    // picket the intact panel would have put there.
    const own = rng(p.seed);
    // Baked rather than set on a mesh, because the whole panel merges into one
    // geometry. Same order createFencePanel uses: lean about the foot, then
    // twist, then into place.
    const place = (g) => { g.rotateZ(p.lean); g.rotateY(p.twist); g.translate(p.x, p.y, p.z); return g; };

    if (state[i] === 'whole') {
      build.addBody(place(picketGeometry({ rand: own, height: p.height, width: p.width })));
      return;
    }

    if (state[i] === 'snapped') {
      const at = p.height * cutAt[i];
      build.addBody(place(stumpGeometry({ rand: own, height: at, width: p.width })));
      const spray = splinteredEnd({ rand, width: p.width, thickness: F.picket.thickness, direction: 1 });
      for (const g of spray) { g.translate(0, at, 0); g.userData.splinterBase = at; }
      for (const g of paintSpray(spray, rand)) build.addTorn(place(g));
      return;
    }

    // Gone. What a missing picket left behind is the difference between a fence
    // that was broken and a fence that was built with a gap in it, so it is
    // varied on purpose and one in four leaves nothing at all.
    const evidence = rand();
    if (evidence < 0.38) {
      // A fragment still nailed across the lower rail, torn at both ends. The
      // strongest of the three: it says the picket was pulled, not unscrewed.
      const railLo = parts.rails[0].y;
      const y0 = railLo - 0.05 - rand() * 0.06;
      const y1 = railLo + 0.04 + rand() * 0.09;
      build.addBody(place(stumpGeometry({ rand: own, height: y1 - y0, width: p.width }).translate(0, y0, 0)));
      const up = splinteredEnd({ rand, width: p.width, thickness: F.picket.thickness, direction: 1 });
      for (const g of up) { g.translate(0, y1, 0); g.userData.splinterBase = y1; }
      for (const g of paintSpray(up, rand)) build.addTorn(place(g));
      const down = splinteredEnd({ rand, width: p.width, thickness: F.picket.thickness, direction: -1 });
      for (const g of down) { g.translate(0, y0, 0); g.userData.splinterBase = y0; }
      for (const g of paintSpray(down, rand)) build.addTorn(place(g));
    } else if (evidence < 0.74) {
      // Nails left in the rails. Sub-pixel at scene scale, but at the zoom a
      // break is judged at they are the thing that says a picket used to be
      // here, and they cost two dozen triangles.
      for (const r of parts.rails) {
        if (rand() < 0.25) continue;      // one of them pulled through
        const m = new THREE.Mesh(nails().geo, nails().mat);
        m.position.set(
          p.x + (rand() - 0.5) * p.width * 0.4,
          r.y + (rand() - 0.5) * 0.012,
          r.z + F.rail.depth / 2,
        );
        extras.push(m);
      }
    }
    // else: nothing at all. Some pickets just go.
  });

  // --- rails ---------------------------------------------------------------
  // A rail snapped mid-span is one of the strongest reads there is, and where a
  // run of pickets is missing there is nothing holding the rail up at all. The
  // two rails never tear at the same x: a matched pair of breaks reads as a
  // rectangle cut out of the fence.
  const goneIdx = state.map((s, i) => (s === 'gone' ? i : -1)).filter((i) => i >= 0);
  let gap = null;
  if (goneIdx.length >= 2) {
    let bestA = goneIdx[0], bestB = goneIdx[0], a = goneIdx[0], b = goneIdx[0];
    for (let k = 1; k < goneIdx.length; k++) {
      if (goneIdx[k] === b + 1) b = goneIdx[k];
      else { a = b = goneIdx[k]; }
      if (b - a > bestB - bestA) { bestA = a; bestB = b; }
    }
    if (bestB > bestA) gap = [parts.pickets[bestA].x, parts.pickets[bestB].x];
  }

  for (const r of parts.rails) {
    const own = rng(r.seed);
    // A rail can also let go on its own once the fence is well gone, even where
    // the pickets beside it are still standing.
    const solo = !gap && dmg > 0.40 && rand() < (dmg - 0.40) * 1.3;

    if (!gap && !solo) {
      build.addBody(railGeometry({ rand: own, length: r.length }).translate(r.x, r.y, r.z));
      continue;
    }

    // Tear points, jittered per rail. Where a run of pickets is missing the
    // rail loses a length of itself into the gap; where it simply let go it is
    // one break, the two halves still meeting across the kerf of fibre that
    // went with the other side.
    let tearL, tearR;
    if (gap) {
      tearL = gap[0] + (rand() - 0.4) * (gap[1] - gap[0]) * 0.45;
      tearR = gap[1] - (rand() - 0.4) * (gap[1] - gap[0]) * 0.45;
    } else {
      const t = spanA + L * (0.28 + rand() * 0.44);
      const kerf = 0.005 + rand() * 0.012;
      tearL = t - kerf;
      tearR = t + kerf;
    }

    // At the deep end of the damage a whole half of a rail can be gone rather
    // than merely broken.
    const lostLeft = gap && dmg > 0.72 && rand() < (dmg - 0.72) * 1.6;
    const lostRight = gap && !lostLeft && dmg > 0.72 && rand() < (dmg - 0.72) * 1.6;

    const half = (from, to, tearHigh) => {
      const span = to - from;
      if (span < 0.06) return;
      // railGeometry hands back a rail centred on the origin, so the piece is
      // built at its own length and then slid to where that length sits.
      const body = railGeometry({ rand: own, length: span }).translate(from + span / 2, 0, 0);
      const spray = splinteredEnd({
        rand,
        width: F.rail.thickness,
        thickness: F.rail.depth,
        direction: tearHigh ? 1 : -1,
        // A rail is nearly twice as deep as a picket is thick, so F.splinter's
        // multiples of thickness would hand it spikes as long as the gap. Pulled
        // in, and the tear still comes out heavier than a picket's, which is
        // right: it is a heavier board.
        reach: 0.80,
      });
      for (const g of spray) layAlongX(g).translate(tearHigh ? to : from, 0, 0);
      for (const g of spray) g.userData.splinterBase = tearHigh ? to : from;
      paintSpray(spray, rand, 1);

      // A free end with nothing under it drops. Pivoted about the post end, so
      // the rail stays let into its post and only the torn end sags.
      const pivot = tearHigh ? spanA : spanB;
      const droop = gap ? (tearHigh ? -1 : 1) * (0.015 + rand() * 0.045) : 0;
      const settle = (g) => {
        if (droop) { g.translate(-pivot, 0, 0); g.rotateZ(droop); g.translate(pivot, 0, 0); }
        return g.translate(0, r.y, r.z);
      };
      build.addBody(settle(body));
      for (const g of spray) build.addTorn(settle(g));
    };

    if (!lostLeft) half(spanA, tearL, true);
    if (!lostRight) half(tearR, spanB, false);
  }

  // --- posts ---------------------------------------------------------------
  // The posts are what is left standing when everything between them has gone,
  // so they survive nearly always. At the very deep end one can lose its head,
  // which is worth having: a broken post is a much heavier break than a broken
  // picket and it changes the silhouette of a whole run.
  const postBroken = dmg > 0.80 && rand() < (dmg - 0.80) * 2.2 ? (rand() < 0.5 ? 0 : 1) : -1;
  parts.posts.forEach((p, i) => {
    const own = rng(p.seed);
    const place = (g) => g.translate(p.x, p.y, p.z);
    if (i !== postBroken) {
      build.addBody(place(postGeometry({ rand: own })));
      return;
    }
    const at = F.post.height * (0.48 + rand() * 0.22);
    build.addBody(place(headlessPostGeometry({ rand: own, height: at })));
    const spray = splinteredEnd({
      rand,
      width: F.post.width,
      thickness: F.post.thickness,
      direction: 1,
      // Same reason as the rail, harder: a post is as thick as it is wide, and
      // the honest 2.4x would give it spikes a third of its own height long.
      reach: 0.40,
    });
    for (const g of spray) { g.translate(0, at, 0); g.userData.splinterBase = at; }
    for (const g of paintSpray(spray, rand)) build.addTorn(place(g));
  });

  // --- assemble ------------------------------------------------------------
  const out = { group: new THREE.Group(), geometries: [] };
  meshesFrom(build, materials, out);
  for (const e of extras) { e.castShadow = true; out.group.add(e); }
  out.group.scale.setScalar(scale);

  return {
    group: out.group,
    // Static prop. The interface is here so a damaged panel drops into the same
    // list as the pumpkin and the tombstones without a special case at the call
    // site, which is the only reason props that do not move carry one.
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
