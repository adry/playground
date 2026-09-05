import * as THREE from 'three';
import { contactShadow, toyMaterial } from '../style.js';
import {
  FOLIAGE, foliageMaterial, foliageRng, makeLobes,
  lumpPositions, icosphere, mergeLumps, bakeFoliageTint, bakeWind,
  attachWind, disposeWind, updateWind,
} from '../foliage/wind.js';

// Graveyard flowers: the only colour in the yard.
//
//   const clump = createFlowerClump({
//     seed: 4,              // every head, leaf, lean and tint hangs off this
//     variant: 'daisies',   // one of FLOWER_VARIANTS, or omitted to pick by seed
//     radius: 0.45,         // the footprint the clump is allowed to spread over
//     scale: 1,             // applied to the whole group
//   });
//   scene.add(clump.group); // { group, size, variant, update(time, dt), dispose() }
//
// FOUR KINDS, AND WHY THOSE FOUR.
//
// They are chosen for silhouette, not for botany. Measured at the shipped
// framing, 900 pixels at view 6.2, a clump occupies between 22 x 27 and 46 x 29
// pixels, so a head is four or five pixels and the species is unreadable: the
// OUTLINE is the whole read. The set is therefore picked so that four clumps in
// a row are four different shapes.
//
//   'daisies'  a low spreading mound speckled with flat pale heads. WIDE and
//              FLAT, 0.22 tall by 0.70 across, the widest thing here.
//   'spires'   four or five upright tapering spikes over a leaf rosette. TALL
//              and VERTICAL, the only one with an up-down grain, and the
//              tallest at 0.36.
//   'posy'     a cut bunch tied at the waist and laid down against a stone.
//              DIAGONAL, lying at 24 to 30 degrees with the heads bunched at
//              the raised end. The only one that reads as put there by a person
//              rather than grown.
//   'jar'      a zinc pot of chrysanthemums. A hard straight-sided cylinder
//              under a dense ball of heads: the only manufactured edge in the
//              set, and the only one whose flowers hinge above the ground.
//
// Anything that would have shared one of those four outlines (a wreath ring is
// a daisy mound with a hole nobody can resolve; a single laid stem is a thinner
// posy) is not a fifth variant, it is the same variant with extra draw calls.
//
// COLOUR, which is the hard part.
//
// FOLIAGE in wind.js is deliberately dark and grey-shifted so that it sits with
// PALETTE.stone. Flowers are the one thing allowed off that leash and they are
// also the one thing that can wreck it: the scene is a warm 2.1 key under ACES,
// which pushes any saturated mid-tone up its shoulder and turns it acid, and a
// petal is small, so a colour that reads as "pink" on a wall reads as a hot
// speck at twenty pixels. Everything here is therefore a TINT: a pale base with
// the chroma taken out of it, and exactly one deeper accent per variant carried
// on a fraction of the heads.
//
// Every colour below was chosen by rendering it rather than by reading the hex,
// because this scene does not render a colour anywhere near where it is
// authored. Measured on the shipped frame, the pipeline multiplies the
// saturation of a lit petal by about 1.45: an albedo at 0.40 saturation comes
// back at 0.58 and reads as a hot dot. So the working limit for anything that
// covers a whole head is about 0.30 in the albedo, and the numbers in the
// comments below are what the rendered pixels actually measured, not what the
// hex says.
//
// The accent costs nothing, which is worth spelling out because it is what lets
// a clump be two colours in one draw call. The material carries the LIGHTEST
// colour of the variant and the accent heads are multiplied down to the deeper
// one by their vertex colour, which is the same attribute bakeFoliageTint is
// already writing. Every accent below is therefore darker than its base in all
// three channels; a lighter accent would need a second material and a second
// draw call and is not worth one.
export const FLOWER = {
  // The whites. Not white: #ffffff petals clip on the key side and the head
  // loses its own form before the scene is even tone mapped. These are a warm
  // bone and a cool chalk, both of which still read as "white flower" next to
  // #8f949e floor and #b9b6b1 stone.
  cream: '#e3dbc7',
  chalk: '#dcdcd6',
  // Dusty rose. The pink that survives the key: value up, chroma right down.
  // #d98a95, a normal cartoon pink, went fluorescent at 2.1 and read as a
  // safety marker. #c08a8c, the second try, measured 0.56 saturation on the
  // rendered pixel and read at scene size as a red dot rather than as a pink
  // flower: at forty pixels a head is four, and four pixels of anything read as
  // their hue and nothing else, so the chroma has to come down again.
  rose: '#c49a9c',
  // Faded violet, likewise. Cooled towards grey so it sits beside the stone
  // rather than in front of it.
  violet: '#a79cc4',
  // The deeper accents. Only ever on a minority of heads, only ever as the
  // dark end of a variant that already has a pale base. Both are the SAME hue
  // as their base taken down in value, not a different hue: a contrasting
  // accent on a four-pixel head is a colour error, not an accent.
  wine: '#8e6870',
  plum: '#7d729b',
  // The one warm note in the set, for the pot. Cemetery chrysanthemums are
  // bronze and gold and nothing else will read as them, but gold is the single
  // most dangerous hue under this key: at #c0964f the rendered pixel measured
  // 0.68 saturation and the pot read as a hazard marker two grid squares away.
  // Taken down to a straw ochre it still reads as the warm one in the row.
  bronze: '#c6ac78',
  rust: '#9d8058',
  // The eye of an open flower, as a multiplier off whatever pale base the
  // variant has. One warm lump three pixels across in the middle of a white
  // head, and it is the whole difference between a daisy and a bottle cap.
  eye: '#c9b184',
  // Woody. Cut stems, the tie on the posy.
  cut: '#8d8468',
  // The pot. Zinc, the standard cemetery flower pot, and a grey the palette
  // already owns.
  zinc: '#9a9691',
};

export const FLOWER_VARIANTS = ['daisies', 'spires', 'posy', 'jar'];

// Authored against the ghost at 1.72 and the shortest headstone at 0.81.
// Flowers are ankle furniture: the two that stand up top out at 0.36, which is
// under half the shortest stone and about a fifth of the ghost, and the two
// that do not stand up are half that again. Any taller and a clump stops
// reading as ground dressing and starts competing with the markers.
//
// These are the heights the finished prop is FITTED to, not the heights of the
// parts it is built from, and the difference matters: the heads stand proud of
// whatever the leaves happened to reach by an amount that drifts a fifth seed
// to seed. So every variant is built, measured and then scaled, the same way
// the bush is. Rendered and measured over seeds 1, 4 and 9 the finished props
// come out at:
//
//   daisies  0.198 to 0.223 tall, 0.67 to 0.75 across
//   spires   0.338 to 0.363 tall, 0.40 to 0.55 across
//   posy     0.176 to 0.193 tall, 0.31 to 0.46 long
//   jar      0.307 to 0.328 tall, 0.24 to 0.31 across
const SPEC = {
  daisies: { tall: [0.19, 0.26], spread: 0.78, petal: 'cream', accent: 'rose', accentOdds: 0.24 },
  spires:  { tall: [0.33, 0.40], spread: 0.46, petal: 'violet', accent: 'plum', accentOdds: 0.34 },
  posy:    { tall: [0.17, 0.22], spread: 0.62, petal: 'chalk', accent: 'wine', accentOdds: 0.30 },
  jar:     { tall: [0.30, 0.36], spread: 0.40, petal: 'bronze', accent: 'rust', accentOdds: 0.30 },
};

// COST.
//
// Two meshes per clump, three for the jar, plus the shared contact patch: so
// three draw calls, four for the jar, and no more however many heads a seed
// rolls. Everything that is not the pot goes through mergeLumps, which is what
// buys that: the foliage is one geometry and the petals are another, and the
// accent colours ride on the vertex colour rather than on a second material.
//
// Measured over seeds 1, 4, 9 and 17: daisies 10.1k to 12.2k triangles, spires
// 8.0k to 11.0k, posy 4.7k to 6.2k, jar 11.4k to 13.0k. For scale the bush next
// door is 21.6k to 22.8k and stands three times as tall, so a clump costs about
// half a bush. The first pass ran at 16k to 18k and was trimmed by taking heads
// and petals off rather than by dropping the icosphere detail: the petals are
// already at detail 1, which is 80 triangles a petal, and at detail 0 a petal
// is a twelve-vertex solid whose silhouette is visibly a hexagon in any shot
// closer than the shipped frame.

// --- small geometry helpers -------------------------------------------------

// The petal ring for a BUD, not for an open flower: a lobe field that pushes a
// small sphere out in a ring so it reads as a closed head with divisions in it.
// This is what the spike bells are, and it is all they need to be at the size
// they are seen.
//
// It is NOT what an open flower is made of, and the first pass here got that
// wrong: a shallow lobed dome with a raised boss, built at detail 2, renders as
// a smooth white cap on a stalk, which is to say a MUSHROOM. Even at amp 0.55
// the scallops between the lobes are a few per cent of the radius by the time
// the 162-vertex sphere has sampled them, and a smooth cap has no petals in it
// at any distance. See headParts below for what replaced it.
function budLobes(rand, { petals = 4, amp = 0.40, tight = 3.4, ring = 0.10, boss = 0.20 } = {}) {
  const lobes = [];
  const a0 = rand() * Math.PI * 2;
  for (let i = 0; i < petals; i++) {
    const a = a0 + (i / petals) * Math.PI * 2 + (rand() - 0.5) * 0.24;
    const y = ring + (rand() - 0.5) * 0.10;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    lobes.push({
      x: Math.cos(a) * r, y, z: Math.sin(a) * r,
      amp: amp * (0.80 + rand() * 0.40),
      tight: tight * (0.88 + rand() * 0.24),
    });
  }
  if (boss > 0) lobes.push({ x: 0, y: 1, z: 0, amp: boss, tight: 7.0 });
  return lobes;
}

// Scale a raw lump so its widest horizontal measurement is exactly `width`, and
// if `height` is given, so its total vertical extent is exactly that.
//
// Heads have to agree with each other in size across a clump far more than they
// have to agree with any nominal radius, and the lobe field's own size drifts by
// a third depending on how the amplitudes rolled: an amp of 0.34 and an amp of
// 0.55 are the same shape at different sizes, and a clump built without this
// step comes out with heads that vary by half and read as a size bug rather
// than as variety.
function fitLump(pos, width, height) {
  let m = 1e-6, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const d = Math.hypot(pos[i], pos[i + 2]);
    if (d > m) m = d;
    if (pos[i + 1] < lo) lo = pos[i + 1];
    if (pos[i + 1] > hi) hi = pos[i + 1];
  }
  const k = width / (2 * m);
  const sy = height === undefined ? k : height / Math.max(1e-5, hi - lo);
  const mid = height === undefined ? 0 : (lo + hi) / 2;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= k;
    pos[i + 1] = (pos[i + 1] - mid) * sy;
    pos[i + 2] *= k;
  }
  return pos;
}

// A fat rod, standing on y = 0 and pointing +y, used for every stem and every
// leaf in the file. `len` and `r` are BOTH in world units and the rod really
// measures them: length is not a multiple of the radius, because a stem that
// gets longer when it gets fatter is unusable.
//
// Thickness is the whole argument for building it this way at all. A
// botanically honest stem at this scale is four millimetres, which is a third
// of a pixel in the shipped frame: it does not render as a thin line, it
// renders as a dashed row of half-lit pixels that crawls when the wind moves
// it, and that crawl is the single most common way a plant prop fails at
// distance. So nothing here is thinner than STEM_MIN, which is 18mm across and
// measures one and a third pixels of solid at view 6.2 in a 900px frame, and a
// stem is a solid rounded rod rather than a cylinder with a cap on it.
const STEM_MIN = 0.009;    // radius, so 18mm across
function rod(rand, { detail = 1, r = 0.02, len = 0.1, lobes = 2, amp = 0.08, flat = 1 } = {}) {
  const ls = lobes > 0 ? makeLobes(rand, { count: lobes, amp: [amp * 0.5, amp], tight: [2.0, 4.0], yBias: 0 }) : [];
  const stretch = Math.max(0, len / Math.max(1e-4, r) - 2);
  const pos = lumpPositions({ detail, lobes: ls, scaleY: 1, stretch });
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] < lo) lo = pos[i];
    if (pos[i] > hi) hi = pos[i];
  }
  const sy = len / Math.max(1e-5, hi - lo);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= r;
    pos[i + 1] = (pos[i + 1] - lo) * sy;
    pos[i + 2] *= r * flat;
  }
  return pos;
}

// Taper a built lump along its own +y. lumpPositions' comment explains why you
// cannot get a spike by SCALING a lobed sphere (you get an agave), and the same
// argument says you cannot get one by stretching either, because a stretched
// lump is a lozenge and stays as round at the top as at the bottom. A spike is
// round at the bottom and pointed at the top, so the taper is applied here, as
// a shaping pass over the finished positions.
function taper(pos, { power = 1.4, to = 0.34 } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] < lo) lo = pos[i];
    if (pos[i] > hi) hi = pos[i];
  }
  const span = Math.max(1e-5, hi - lo);
  for (let i = 0; i < pos.length; i += 3) {
    const t = Math.pow((pos[i + 1] - lo) / span, power);
    const k = 1 - (1 - to) * t;
    pos[i] *= k;
    pos[i + 2] *= k;
  }
  return pos;
}

// The accent multiplier, in the space the vertex colour actually multiplies in.
// Vertex colours are working (linear) space under three's colour management and
// the material's own colour is converted out of sRGB for it, so the ratio has
// to be taken between the two LINEAR colours or the accent lands somewhere else
// than it was authored. Clamped at 1 because a vertex colour above 1 does not
// brighten a petal, it posterises the shading on it.
function accentRatio(baseHex, accentHex) {
  const a = new THREE.Color(baseHex).convertSRGBToLinear();
  const b = new THREE.Color(accentHex).convertSRGBToLinear();
  return [
    Math.min(1, b.r / Math.max(1e-4, a.r)),
    Math.min(1, b.g / Math.max(1e-4, a.g)),
    Math.min(1, b.b / Math.max(1e-4, a.b)),
  ];
}

// Multiply the baked vertex colour of whole parts. Runs after bakeFoliageTint,
// so the shading it painted (crown, crevice, warm split) survives underneath
// the hue change instead of being replaced by it.
function tintParts(geo, parts) {
  const col = geo.getAttribute('color');
  let vo = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    if (p.rgb) {
      for (let i = 0; i < n; i++) {
        col.setXYZ(vo + i,
          col.getX(vo + i) * p.rgb[0],
          col.getY(vo + i) * p.rgb[1],
          col.getZ(vo + i) * p.rgb[2]);
      }
    }
    vo += n;
  }
  col.needsUpdate = true;
}

// What the finished prop actually measures, over every geometry in it. Same
// function as the one in bush.js, and deliberately a copy rather than a shared
// import: wind.js does not export one and this file is not allowed to add it.
function measureExtent(...geos) {
  let top = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of geos) {
    if (!g) continue;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > top) top = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { top: Math.max(1e-4, top), width: maxX - minX, depth: maxZ - minZ };
}

const UP = new THREE.Vector3(0, 1, 0);
// Build the placement matrix for one part: aim its +y along `dir`, spin it about
// its own axis so no two lumps off the same seed are the same lump, and drop it
// at `p`.
function placeAt(p, dir, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  return m.multiply(new THREE.Matrix4().makeRotationY(spin)).setPosition(p);
}

// --- leaves -----------------------------------------------------------------
//
// The two variants that are GROWING, daisies and spires, share a base rosette:
// a ring of fat blades laid at a low angle and rooted a little BELOW y = 0. The
// posy is cut, so it has no leaves at its foot at all, and the jar's stems come
// out of the pot rather than out of the ground.
//
// Rooting them under the floor is the answer to the ground rule, and it is the
// bush's answer rather than the path's. A path is a ribbon coplanar with the
// floor and settles its z-fight with polygonOffset; a plant is a solid that
// INTERSECTS the floor, so it has no coplanar surface to fight with at all.
// Burying the feet is also what stops the hairline of daylight that otherwise
// shows under every leaf tip at a 38 degree camera.
function buildLeaves(rand, parts, { count, len, spread, tilt = [0.10, 0.34], flutter = 0.25 }) {
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const a0 = rand() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    const up = tilt[0] + rand() * (tilt[1] - tilt[0]);
    dir.set(Math.cos(a), up, Math.sin(a)).normalize();
    const L = len * (0.62 + rand() * 0.62);
    p.set(Math.cos(a) * spread * 0.12, -0.020 - rand() * 0.014, Math.sin(a) * spread * 0.12);
    parts.push({
      // Flattened across, so a leaf is a blade and not a sausage, but only to
      // 0.45: a true blade is a card, and a card has no thickness to catch the
      // key with. This is a thick vinyl leaf.
      positions: rod(rand, { detail: 1, r: L * 0.115, len: L, lobes: 3, amp: 0.20, flat: 0.42 }),
      index: icosphere(1).index,
      matrix: placeAt(p.clone(), dir.clone(), rand() * Math.PI * 2),
      phase: rand(),
      tint: rand(),
      // Faded by how far off the ground this leaf actually gets. bakeWind uses a
      // per-clump flutter weight EXACTLY as given and says in as many words that
      // the caller owes it the height fade, because the weight has to be
      // constant over a connected patch for the stale-normal argument to hold.
      // A leaf lying almost flat therefore quivers almost not at all, which is
      // also what a leaf lying almost flat does.
      flutter: flutter * Math.min(1, up / 0.5),
    });
  }
}

// A basis-aimed placement: X, Y and Z of the lump go where you say. placeAt
// cannot do this, because a petal has THREE distinct axes (long, wide, thin)
// and aiming one of them leaves the other two wherever the shortest-arc
// quaternion happened to put them, which for a flat blade means half of them
// end up standing on edge.
function placeBasis(x, y, z, p) {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}

// AN OPEN FLOWER HEAD: a ring of separate fat petals round a raised eye.
//
// This is the shape of the prop. The cheap version, one lobed dome per head,
// was built first and rendered as a mushroom (see budLobes), and no amount of
// lobe amplitude fixes it: a petal has to be a separate piece of geometry with
// daylight between it and the next one, because the gaps ARE the read. From
// above and slightly to the side, which is the only angle this scene has, a
// disc with notches in it is a disc and a ring of separate straps is a flower.
//
// It is also CHEAPER, which was the surprise. A detail-2 dome is 320 triangles;
// six detail-1 petals and an eye are 560, but the dome needed detail 2 purely to
// resolve lobes that did not read anyway, and a petal at detail 1 is a solid
// rounded strap that is still smooth in silhouette at four times scene size.
// Every petal is a rod, so the STEM_MIN argument covers them too: the thinnest
// dimension of a petal is its thickness, and it is a fifth of its width rather
// than the nothing a real petal is.
//
// The eye is its own lump and its own tint. On a daisy it is what stops the head
// being a white blob: one warm lump in the middle, three pixels across at scene
// size, and it is the difference between a flower and a bottle cap.
function headParts(rand, out, {
  p, axis, width,
  petals = 6,
  tilt = [0.18, 0.46],       // radians above the head plane
  petalLen = 0.52,           // as a fraction of the head width
  petalWid = 0.34,
  petalThick = 0.13,
  eye = 0.40,                // eye width, as a fraction of the head width
  eyeRgb = null,
  detail = 1,
  phase = 0, rgb = null, flutter = 1,
}) {
  const n = axis.clone().normalize();
  const seed = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(n, seed).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const a0 = rand() * Math.PI * 2;
  const idx = icosphere(detail).index;

  for (let i = 0; i < petals; i++) {
    const a = a0 + (i / petals) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const outward = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).normalize();
    const t = tilt[0] + rand() * (tilt[1] - tilt[0]);
    const dir = outward.clone().multiplyScalar(Math.cos(t)).addScaledVector(n, Math.sin(t)).normalize();
    // Tangential, and it is the petal's WIDE axis; the thin axis is whatever is
    // left over, which is roughly the head normal. A petal thin the other way
    // round is a fin standing on edge.
    const tang = new THREE.Vector3().crossVectors(n, outward).normalize();
    const thin = new THREE.Vector3().crossVectors(tang, dir).normalize();
    const L = width * petalLen * (0.86 + rand() * 0.28);
    // The inner end is pushed slightly INTO the eye, so no petal shows a gap at
    // its root where the floor colour comes through the middle of the flower.
    const foot = p.clone().addScaledVector(outward, -width * 0.05).addScaledVector(n, -width * 0.03);
    out.push({
      positions: rod(rand, {
        detail,
        r: width * petalWid * 0.5,
        len: L,
        lobes: 2, amp: 0.14,
        flat: petalThick / petalWid,
      }),
      index: idx,
      matrix: placeBasis(tang, dir, thin, foot),
      phase, tint: rand(), flutter, rgb,
    });
  }

  if (eye > 0) {
    out.push({
      positions: fitLump(lumpPositions({ detail, lobes: [] }), width * eye, width * eye * 0.62),
      index: idx,
      matrix: placeAt(p.clone().addScaledVector(n, width * 0.035), n, rand() * Math.PI * 2),
      phase, tint: rand(), flutter, rgb: eyeRgb || rgb,
    });
  }
}

// One closed bud or bell, as a single lump. Used for the spike whorls, where the
// flowers really are closed and are four pixels across.
function budPart(rand, { p, dir, width, flat, lobes, detail = 1, phase, rgb, flutter = 1 }) {
  return {
    positions: fitLump(lumpPositions({ detail, lobes }), width, width * flat),
    index: icosphere(detail).index,
    matrix: placeAt(p, dir, rand() * Math.PI * 2),
    phase, tint: rand(), flutter, rgb,
  };
}

// --- the variants -----------------------------------------------------------
//
// Each returns { foliage: [parts], petals: [parts], pot? } in the clump's own
// space, unfitted. The caller measures the lot and scales it to the promised
// height afterwards.

// A low spreading mound. Every stem is built from where it comes out of the
// ground TO where its head sits, rather than being given a length and a
// direction and hoped over: the head is the thing whose position matters, so it
// is placed first and the stem is solved to reach it. A stem that misses its
// head by two centimetres is a head floating in the air, which at this camera
// elevation is the most visible failure the prop has.
function buildDaisies(rand, { R, tall, base, accent, accentOdds }) {
  const foliage = [];
  const petals = [];
  buildLeaves(rand, foliage, { count: 15, len: R * 0.90, spread: R, tilt: [0.10, 0.40] });

  const n = 14 + Math.floor(rand() * 5);
  const placed = [];
  const foot = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // Rejection-sampled over the footprint, so the heads are spread rather than
    // clustered: twenty uniform random points leave a bald third of the mound
    // often enough to matter at a fixed camera azimuth.
    let x = 0, z = 0;
    for (let k = 0; k < 24; k++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * R * 0.88;
      x = Math.cos(a) * rr; z = Math.sin(a) * rr;
      if (placed.every((q) => Math.hypot(q.x - x, q.z - z) > R * 0.30)) break;
    }
    placed.push({ x, z });

    // Shorter towards the rim: a self-seeded patch is domed, not a plateau, and
    // a flat-topped one reads as a printed decal on the ground.
    const edge = Math.hypot(x, z) / R;
    const h = tall * (0.94 - 0.30 * edge * edge) * (0.86 + rand() * 0.22);
    const hw = R * (0.21 + rand() * 0.07);

    // The stem, solved from the ground to the head. Its foot is pulled in
    // towards the middle of the clump, so the stems splay outward and the
    // silhouette is a fan rather than a bundle of parallel bars.
    foot.set(x * (0.35 + rand() * 0.25), -0.022, z * (0.35 + rand() * 0.25));
    dir.set(x - foot.x, h - foot.y, z - foot.z);
    const len = dir.length();
    dir.normalize();
    const phase = rand();
    foliage.push({
      positions: rod(rand, { detail: 1, r: STEM_MIN * (1.0 + rand() * 0.30), len, lobes: 2, amp: 0.10 }),
      index: icosphere(1).index,
      matrix: placeAt(foot.clone(), dir.clone(), rand() * Math.PI * 2),
      phase, tint: rand(), flutter: 0,
    });

    // The head is tipped off vertical by up to 20 degrees, leaning the way its
    // own stem leans. A field of heads all facing straight up is a field of
    // identical ellipses under a fixed camera, and the tip is what gives each
    // one its own light side.
    headParts(rand, petals, {
      p: new THREE.Vector3(x, h, z),
      axis: new THREE.Vector3(dir.x * 0.75 + (rand() - 0.5) * 0.30, 1, dir.z * 0.75 + (rand() - 0.5) * 0.30).normalize(),
      width: hw,
      petals: 5 + ((rand() * 3) | 0),
      tilt: [0.10, 0.34],       // laid nearly flat: a daisy is a disc
      petalLen: 0.54, petalWid: 0.32, petalThick: 0.115,
      eye: 0.40,
      eyeRgb: accentRatio(base, FLOWER.eye),
      phase,
      rgb: rand() < accentOdds ? accentRatio(base, accent) : null,
    });
  }
  return { foliage, petals };
}

// Upright spikes. Each is a tapered core carrying a dozen bells, which is the
// bush's mass-plus-tufts recipe stood on end: the core owns the silhouette and
// the height, and the bells break its outline into something that reads as many
// small flowers rather than as one painted cone.
function buildSpires(rand, { R, tall, base, accent, accentOdds }) {
  const foliage = [];
  const petals = [];
  buildLeaves(rand, foliage, { count: 11, len: R * 1.15, spread: R * 0.7, tilt: [0.22, 0.70] });

  const n = 4 + ((rand() * 2) | 0);
  const foot = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 1.1;
    const rr = R * (0.12 + rand() * 0.48);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = tall * (0.70 + rand() * 0.32);
    const phase = rand();
    const rgb = rand() < accentOdds ? accentRatio(base, accent) : null;

    // The bare stalk, from the ground up to where the flowering part starts.
    const start = h * (0.24 + rand() * 0.12);
    foot.set(x * 0.55, -0.030, z * 0.55);
    dir.set(x - foot.x, start - foot.y, z - foot.z);
    const stalk = dir.length();
    dir.normalize();
    foliage.push({
      positions: rod(rand, { detail: 1, r: STEM_MIN * (1.5 + rand() * 0.5), len: stalk, lobes: 2, amp: 0.12 }),
      index: icosphere(1).index,
      matrix: placeAt(foot.clone(), dir.clone(), rand() * Math.PI * 2),
      phase, tint: rand(), flutter: 0,
    });

    // The core. Taper THEN fit: the taper is a shaping pass in the lump's own
    // space and the fit is what gives it its real size, and doing them the
    // other way round scales the taper by the fit and gives a spike whose point
    // moves with its height.
    const spikeH = h - start;
    const w = R * (0.26 + rand() * 0.09);
    const core = fitLump(taper(lumpPositions({
      detail: 2,
      lobes: makeLobes(rand, { count: 5, amp: [0.10, 0.22], tight: [2.4, 4.4], yBias: 0.1 }),
      stretch: 1.6,
    }), { power: 1.5, to: 0.32 }), w, spikeH);
    // Leaning on from the stalk, so a spike is not a plumb bar.
    axis.set((rand() - 0.5) * 0.34, 1, (rand() - 0.5) * 0.34).normalize();
    const bottom = new THREE.Vector3(x, start, z);
    const mid = bottom.clone().addScaledVector(axis, spikeH * 0.5);
    petals.push({
      positions: core,
      index: icosphere(2).index,
      matrix: placeAt(mid.clone(), axis.clone(), rand() * Math.PI * 2),
      phase, tint: rand(), flutter: 0.4, rgb,
    });

    // The bells, in whorls up the core, each sized to the taper it sits on so
    // the spike keeps its cone even though its outline is all bumps.
    // A robust perpendicular pair. (axis.z, 0, -axis.x) is the obvious one and
    // is a zero vector whenever the spike happens to stand plumb, which the
    // random lean makes rare rather than impossible, and one NaN here poisons
    // every bell on the spike.
    const seedV = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(axis, seedV).normalize();
    const side2 = new THREE.Vector3().crossVectors(axis, side).normalize();
    const whorls = 5 + ((rand() * 2) | 0);
    for (let k = 0; k < whorls; k++) {
      const t = 0.08 + (k / whorls) * 0.86;
      const per = t < 0.55 ? 4 : 3;
      const shrink = 1 - 0.80 * Math.pow(t, 1.5);
      const a0 = rand() * Math.PI * 2;
      for (let j = 0; j < per; j++) {
        const ang = a0 + (j / per) * Math.PI * 2;
        const ring = w * 0.40 * shrink;
        const out = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side2, Math.sin(ang));
        const bp = bottom.clone().addScaledVector(axis, spikeH * t).addScaledVector(out, ring);
        const bd = out.clone().multiplyScalar(0.95).addScaledVector(axis, -0.30 + rand() * 0.7).normalize();
        petals.push(budPart(rand, {
          p: bp, dir: bd,
          width: w * (0.46 + rand() * 0.18) * shrink,
          flat: 0.78,
          detail: 1,
          lobes: budLobes(rand, { petals: 4, amp: 0.44, tight: 4.0, ring: 0.20, boss: 0.16 }),
          phase, rgb,
        }));
      }
    }
  }
  return { foliage, petals };
}

// A cut bunch, tied and laid down. The one that is not growing: it lies at a
// shallow angle with its cut ends on the ground and its heads propped up, which
// is what a bunch left against a stone actually does, and it is the only
// silhouette in the set with a horizontal axis.
function buildPosy(rand, { R, tall, base, accent, accentOdds }) {
  const foliage = [];
  const petals = [];
  // The bunch's own axis, in plan. The caller's yaw turns the whole clump, so
  // this only has to be a direction, not a chosen one.
  // The bunch is aimed ACROSS THE SCREEN rather than anywhere, and this is the
  // one place the prop is allowed to know where the camera is. It is the same
  // fact wind.js picks its default wind direction from: the scene camera is
  // fixed at 45 degrees of azimuth, so the world direction (1, 0, -1) is the
  // one that maps to pure screen-horizontal. A bunch pointing along (1, 0, 1)
  // instead is pointing straight into the lens, its whole length foreshortens
  // to nothing, and what is on screen is a standing bundle of stems. Left to a
  // free yaw that happened about a quarter of the time, which is a quarter of
  // all posies not reading as the thing the variant exists to be.
  //
  // Plus or minus 43 degrees of spread and a coin flip end for end still gives
  // four distinguishable lays, and the outer group's rotation.y is left at zero
  // for this variant alone so nothing downstream spins it back onto the dead
  // axis.
  const yaw = -Math.PI / 4 + (rand() - 0.5) * 1.5 + (rand() < 0.5 ? 0 : Math.PI);
  const ax = Math.cos(yaw), az = Math.sin(yaw);
  const len = R * (1.20 + rand() * 0.28);
  // The prop angle is SOLVED, not chosen, and this is the one place in the file
  // where that matters. Every other variant stands up, so fitting it to a
  // promised height afterwards costs nothing; a bunch lying down is mostly
  // horizontal, so a uniform fit that pulls its height down to 0.16 also pulls
  // its LENGTH down to 0.16 and what comes back is a thimble. So the bunch is
  // built at the length it should be and tipped up by exactly the angle that
  // puts the heads at the height it should be, and the fit downstream is then
  // very nearly a no-op.
  // Capped at 0.50, which is 30 degrees. Without a cap the solve happily
  // returns a bunch standing at 45 degrees when the length rolls short, and a
  // bunch at 45 degrees does not read as laid down at all: it reads as a
  // bouquet stood in an invisible vase, which is what the first render of this
  // fix showed. Below 30 degrees it is unmistakably lying on the ground, which
  // is the only thing this variant is for.
  const sinA = Math.min(0.50, (tall * 0.78) / len);
  const cosA = Math.sqrt(1 - sinA * sinA);

  const n = 7 + ((rand() * 3) | 0);
  const dir = new THREE.Vector3();
  const heads = [];
  for (let i = 0; i < n; i++) {
    // Fanned about the bunch axis, converging at the tie.
    const fan = (i / (n - 1) - 0.5) * (0.55 + rand() * 0.40);
    const cs = Math.cos(fan), sn = Math.sin(fan);
    const dx = (ax * cs - az * sn) * cosA;
    const dz = (ax * sn + az * cs) * cosA;
    dir.set(dx, sinA * (0.84 + rand() * 0.34), dz).normalize();
    const L = len * (0.84 + rand() * 0.32);
    // Cut ends just under the floor, and splayed sideways there too, so the
    // butt of the bunch is a spray of ends rather than a single point.
    const foot = new THREE.Vector3(
      -dx * L * 0.50 - az * (rand() - 0.5) * R * 0.26,
      -0.012 - rand() * 0.012,
      -dz * L * 0.50 + ax * (rand() - 0.5) * R * 0.26);
    foliage.push({
      positions: rod(rand, { detail: 1, r: STEM_MIN * (0.85 + rand() * 0.25), len: L, lobes: 2, amp: 0.08 }),
      index: icosphere(1).index,
      matrix: placeAt(foot.clone(), dir.clone(), rand() * Math.PI * 2),
      phase: 0.5, tint: rand(), flutter: 0,
    });
    // Heads pushed out past the end of their own stem by a little, and spread
    // sideways, so the flowering end is a CLUSTER rather than a row of dots on
    // top of a bar. At scene size the posy is thirty pixels of dark stem and
    // eight of flower, and the eight are the whole prop.
    heads.push({
      p: foot.clone()
        .addScaledVector(dir, L * (0.96 + rand() * 0.12))
        .addScaledVector(new THREE.Vector3(-az, 0, ax), (rand() - 0.5) * R * 0.30),
      d: dir.clone(),
    });
  }

  // The tie. A short fat band across the waist of the bunch, darker and warmer
  // than the stems, and the one detail that says somebody wrapped this.
  const tieDir = new THREE.Vector3(ax * cosA, sinA, az * cosA).normalize();
  const tie = tieDir.clone().multiplyScalar(len * 0.10);
  tie.y += 0.004;
  foliage.push({
    positions: fitLump(lumpPositions({ detail: 1, lobes: [] }), R * 0.36, R * 0.17),
    index: icosphere(1).index,
    matrix: placeAt(tie, tieDir, 0),
    phase: 0.5, tint: 0.7, flutter: 0,
    rgb: accentRatio(FOLIAGE.mid, FLOWER.cut),
  });

  for (const h of heads) {
    headParts(rand, petals, {
      p: h.p,
      axis: new THREE.Vector3(h.d.x * 0.45 + (rand() - 0.5) * 0.4, 1, h.d.z * 0.45 + (rand() - 0.5) * 0.4).normalize(),
      width: R * (0.30 + rand() * 0.09),
      petals: 6 + ((rand() * 2) | 0),
      tilt: [0.16, 0.44],
      petalLen: 0.50, petalWid: 0.34, petalThick: 0.13,
      eye: 0.42,
      eyeRgb: accentRatio(base, FLOWER.eye),
      phase: 0.5 + rand() * 0.2,
      rgb: rand() < accentOdds ? accentRatio(base, accent) : null,
    });
  }
  return { foliage, petals };
}

// A pot of chrysanthemums. The pot is a real lathe, not a blob: it is the only
// manufactured object in the set and it needs a straight side and a rim to read
// as one next to four grown things. It also does not bend, so it is its own
// mesh with no wind on it at all, and the flowers above it are given
// bakeWind({ base: rim }) so that they hinge AT THE RIM rather than at the
// ground. Hinging at the ground would have swung the stems out through the pot.
function buildJar(rand, { R, tall, base, accent, accentOdds }) {
  const foliage = [];
  const petals = [];
  const potR = R * 0.62;
  // Half the prop's height is pot. A shorter pot leaves a long bare stem
  // between the rim and the heads and the whole thing reads as weeds in a
  // bucket, which is what the first close-up showed.
  const potH = tall * 0.50;
  const rim = potH * 0.92;

  const n = 14 + ((rand() * 4) | 0);
  const foot = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // A dome of heads over the rim, denser in the middle and lower at the edge.
    const a = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 0.55);
    const x = Math.cos(a) * rr * potR * 1.35;
    const z = Math.sin(a) * rr * potR * 1.35;
    const h = rim + (tall - rim) * (0.55 + 0.36 * (1 - rr * rr) + rand() * 0.08);
    const phase = rand();
    // Stems start INSIDE the pot, below the rim, so nothing is seen to begin in
    // mid air at the lip.
    foot.set(x * 0.18, rim * 0.80, z * 0.18);
    dir.set(x - foot.x, h - foot.y, z - foot.z);
    const len = dir.length();
    dir.normalize();
    foliage.push({
      positions: rod(rand, { detail: 1, r: STEM_MIN * (0.9 + rand() * 0.3), len, lobes: 2, amp: 0.10 }),
      index: icosphere(1).index,
      matrix: placeAt(foot.clone(), dir.clone(), rand() * Math.PI * 2),
      phase, tint: rand(), flutter: 0,
    });
    headParts(rand, petals, {
      p: new THREE.Vector3(x, h, z),
      axis: new THREE.Vector3(dir.x * 0.6 + (rand() - 0.5) * 0.3, 1, dir.z * 0.6 + (rand() - 0.5) * 0.3).normalize(),
      width: R * (0.33 + rand() * 0.09),
      // Short petals steeply tilted, and a big eye. A chrysanthemum is a BALL of
      // petals where a daisy is a disc with a rim, and that difference plus the
      // pot under it is most of what tells the two variants apart at twenty
      // pixels. The tilt is what does it: the same petals laid flat are a daisy.
      petals: 6 + ((rand() * 2) | 0),
      tilt: [0.52, 0.98],
      petalLen: 0.44, petalWid: 0.30, petalThick: 0.16,
      eye: 0.52,
      phase,
      rgb: rand() < accentOdds ? accentRatio(base, accent) : null,
    });
  }

  // What is packing the pot. Without it the rim rolls over onto an empty bowl
  // and the camera, which is looking down at 38 degrees, looks straight into
  // it: a pot of flowers with a visible empty floor reads as a bucket someone
  // has stuck some stalks in. One dark squashed lump under the rim is enough,
  // and it sits below the wind's hinge height so it never moves.
  foliage.push({
    positions: fitLump(lumpPositions({ detail: 2, lobes: makeLobes(rand, { count: 5, amp: [0.06, 0.14], tight: [2.0, 4.0] }) }),
      potR * 1.72, potR * 0.9),
    index: icosphere(2).index,
    matrix: placeAt(new THREE.Vector3(0, rim * 0.86, 0), new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
    phase: 0, tint: 0.25, flutter: 0,
  });

  // The pot itself. Buried a little at the foot for the same reason everything
  // else is.
  const prof = [];
  const belly = potR;
  const base0 = potR * 0.76;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -potH * 0.14 + t * (potH + potH * 0.14);
    // Straight-sided and slightly flared, with the corners rolled off: a zinc
    // pot, not a vase. The roll is what keeps it in the vinyl-toy house style,
    // where nothing is allowed a hard edge.
    let r = base0 + (belly - base0) * Math.pow(t, 0.80);
    if (t < 0.10) r *= 0.74 + 0.26 * (t / 0.10);
    prof.push(new THREE.Vector2(r, y));
  }
  // Rolled over into a rim and turned back down inside, rather than left as an
  // open tube: an open lathe shows its own backfaces through the gaps between
  // the stems, which at this camera elevation is exactly where you look.
  prof.push(new THREE.Vector2(belly * 1.06, potH * 1.02));
  prof.push(new THREE.Vector2(belly * 0.96, potH * 1.06));
  prof.push(new THREE.Vector2(belly * 0.80, potH * 0.90));
  prof.unshift(new THREE.Vector2(0, -potH * 0.15));

  return { foliage, petals, pot: { prof, rim } };
}

const BUILDERS = { daisies: buildDaisies, spires: buildSpires, posy: buildPosy, jar: buildJar };

// ---------------------------------------------------------------------------

export function createFlowerClump({ seed = 1, variant, radius = 0.45, scale = 1 } = {}) {
  const rand = foliageRng(seed * 6151 + 977);
  const kind = FLOWER_VARIANTS.includes(variant)
    ? variant
    : FLOWER_VARIANTS[Math.floor(foliageRng(seed * 104729 + 13)() * FLOWER_VARIANTS.length) % FLOWER_VARIANTS.length];
  const spec = SPEC[kind];

  const group = new THREE.Group();
  // Inner group carries the seeded lean, so the caller still owns position and
  // rotation.y on the outer one. Same arrangement as the bush and the stones.
  const body = new THREE.Group();
  group.add(body);
  const disposables = [];

  const TALL = spec.tall[0] + rand() * (spec.tall[1] - spec.tall[0]);
  const R = Math.max(0.12, radius) * spec.spread;
  const baseHex = FLOWER[spec.petal];
  const accentHex = FLOWER[spec.accent];

  const built = BUILDERS[kind](rand, {
    R, tall: TALL, base: baseHex, accent: accentHex, accentOdds: spec.accentOdds,
  });

  const leafGeo = mergeLumps(built.foliage);
  const petalGeo = mergeLumps(built.petals);
  disposables.push(leafGeo, petalGeo);

  // Built, measured, then scaled to the height it promised. The heads stand
  // proud of whatever the leaves happened to reach by an amount that drifts a
  // fifth seed to seed, so "0.19 to 0.26 tall" only survives if it is fitted
  // afterwards rather than assumed. Uniform and about y = 0, so no normal has
  // to be recomputed and the buried skirt keeps its proportion underground.
  const K = TALL / measureExtent(leafGeo, petalGeo).top;
  leafGeo.scale(K, K, K);
  petalGeo.scale(K, K, K);
  const rim = (built.pot ? built.pot.rim : 0) * K;
  const { width, depth } = measureExtent(leafGeo, petalGeo);

  // Foliage: the wind.js defaults, darker, because these leaves are a base
  // rosette in shade under the heads rather than a lit crown.
  bakeFoliageTint(leafGeo, { top: TALL, floor: 0.42, ceil: 0.92, down: 0.66, root: 0.44, spread: 0.24, rand });
  // Petals: the same bake with the floor lifted right up. A petal is thin and
  // translucent in life and reads as evenly bright; taken down to the foliage's
  // 0.52 floor the heads went muddy at the bottom of the clump and the whole
  // thing lost the one job it has, which is to be the bright thing. `root` is
  // left low on purpose: it is what darkens the UNDERSIDE of each head, which
  // is the shading that makes a dome of petals read as a dome.
  bakeFoliageTint(petalGeo, { top: TALL, floor: 0.80, ceil: 1.06, down: 0.72, root: 0.52, spread: 0.16, warm: 0.20, jitter: 0.04, rand });
  tintParts(leafGeo, built.foliage);
  tintParts(petalGeo, built.petals);

  // Hinge. `base` is the pot rim for the jar and the ground for everything
  // else, and power 2.0 rather than the bush's 1.8 because a flower is a stem
  // with a weight on the end: almost all of the movement wants to be in the top
  // third, and a lower power slid the whole rosette sideways.
  bakeWind(leafGeo, { top: TALL * 0.92, base: rim, power: 2.0 });
  bakeWind(petalGeo, { top: TALL * 0.92, base: rim, power: 2.0 });

  const leafMat = foliageMaterial(FOLIAGE.mid);
  const petalMat = foliageMaterial(baseHex);
  disposables.push(leafMat, petalMat);
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  const blooms = new THREE.Mesh(petalGeo, petalMat);
  body.add(leaves, blooms);

  // IDENTICAL bend on both meshes, differing only in flutter, for the reason
  // bush.js gives: a head sits on the tip of a stem in the other mesh, and any
  // difference in sway or lag between the two pulls the head off the stem on
  // the fast part of a gust. All the independence the heads need comes from
  // uScatter and from the flutter, both bounded well inside the overlap.
  const bend = {
    sway: 0.115 * TALL,   // proportionally more than the bush: a stem is limper
    droop: 1.5,
    lag: 0.30,
    scatter: 0.26,
  };
  attachWind(leaves, { ...bend, flutter: 0.014 * TALL, flutRate: 1.7 });
  attachWind(blooms, { ...bend, flutter: 0.022 * TALL, flutRate: 1.7 });

  if (built.pot) {
    // LatheGeometry works out its own normals, and they are RIGHT: it knows
    // which of its duplicated seam vertices belong together. Calling
    // computeVertexNormals over the top of them undoes that and leaves a hard
    // vertical crease down the front of the pot, which is exactly what showed
    // up in the first close-up render.
    const potGeo = new THREE.LatheGeometry(
      built.pot.prof.map((v) => new THREE.Vector2(v.x * K, v.y * K)), 32);
    const potMat = toyMaterial(FLOWER.zinc, { roughness: 0.78 });
    disposables.push(potGeo, potMat);
    const pot = new THREE.Mesh(potGeo, potMat);
    // No wind on it. A zinc pot does not bend, and the flowers above it are
    // hinged at its rim instead, which is what bakeWind's `base` is for.
    pot.castShadow = true;
    pot.receiveShadow = true;
    body.add(pot);
  }

  // Nothing grows plumb, and nothing anybody laid down is square. Small enough
  // that the silhouette still reads upright and well inside the depth the feet
  // are buried at, so no daylight opens under the lean. The jar gets a third of
  // it: a pot is a made object that was PUT there, so a visible lean on one
  // reads as knocked over rather than as grown crooked.
  body.rotation.z = (rand() - 0.5) * (kind === 'jar' ? 0.04 : 0.13);
  body.rotation.x = (rand() - 0.5) * (kind === 'jar' ? 0.04 : 0.11);
  // Free, except for the posy, whose own lay angle is aimed at the camera on
  // purpose. See buildPosy.
  body.rotation.y = kind === 'posy' ? 0 : rand() * Math.PI * 2;

  // The contact term. The key and the camera are on the same side of the yard,
  // so the clump's own cast shadow falls away behind it and nothing darkens the
  // floor on the side you can see; without this the clump reads as hovering a
  // millimetre up. Sized off the measured footprint, not off `radius`.
  const patch = contactShadow({
    radius: (width + depth) * (kind === 'jar' ? 0.20 : 0.26),
    opacity: kind === 'posy' ? 0.30 : 0.24,
    softness: 0.72,
  });
  group.add(patch);
  disposables.push({ dispose: () => patch.userData.dispose?.() });

  group.scale.setScalar(scale);

  return {
    group,
    variant: kind,
    colors: { petal: baseHex, accent: accentHex },
    // What the prop actually measures, so a scene can lay clumps out without
    // building one and reading its bounding box back.
    size: { height: TALL * scale, width: width * scale, depth: depth * scale },
    update(time) {
      // Every plant in the yard writes the same value into the same shared
      // uniform. Cheap, and it is what keeps them in one weather system: a
      // clump of daisies at the foot of a bush has to lean in the same gust.
      updateWind(time);
    },
    dispose() {
      disposeWind(leaves);
      disposeWind(blooms);
      for (const d of disposables) d.dispose?.();
    },
  };
}
