// GROUND COVER: ONE OPAQUE SURFACE, WITH EDGES YOU CAN SEE.
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
//   2. The camera is orthographic and fixed, so a flat patch is seen at a
//      glancing angle, its outline compresses to almost nothing, and its
//      SHADING rather than its silhouette is what the eye reads.
//
// Rule 2 is why sandpath.js is a cambered ribbon with wheel hollows and half
// buried pebbles rather than a lighter stripe, and its header says in as many
// words that a path which is only a lighter colour is a stain. So the ask is
// really: how do two AREAS of ground cover meet, when ground cover is a surface
// and not a colour?
//
// The second answer, after the owner looked at the first one:
//
//     "ground materials should blend into each other better with a slightly
//      clearer demarcation. one would for example like to have the grass stop
//      net with a row of stones and then have a dirt road, also floor material
//      should be opaque and we should not see the grey mat"
//
// Read the first sentence twice, because its two halves pull opposite ways and
// both are meant. A metre and a half of airbrushed cross-fade is a blend and it
// is exactly what is being rejected. What is wanted is a MEETING: one surface
// ending and another beginning, at a line you could point at, which is
// nevertheless not a cut.
//
// ============================================================================
// WHY THE GREY CAME THROUGH. TWO BUGS, BOTH IN THIS FILE
// ============================================================================
//
// The first pass drew ONE TRANSPARENT MESH PER MATERIAL, each carrying its own
// weight as vertex alpha, and argued that because the weights sum to one at a
// border there can be no bare floor between them. That argument is wrong, and
// it is wrong in the way alpha compositing is always wrong: layers do not add,
// they multiply their complements. Two coats at alpha 0.5 leave
//
//     (1 - 0.5) * (1 - 0.5) = 0.25
//
// of the floor still showing. So every internal border had a band down the
// middle of it that was a QUARTER GREY MAT, and a three way junction was worse.
// That grey is also what washed the border out: the two materials were not
// merging into each other, they were both dissolving into the floor.
//
// The second bug was arithmetic. The cover's own opacity was
// `min(1, blurredCoverage * 1.35)`, and the blur is two box passes three cells
// wide. A painted region has to be about four metres across before that reaches
// one, so every brush dab smaller than that was translucent right through its
// middle -- a fact the editor had already given up and documented in its own
// tooltip. Grey through the centre of a painted patch, exactly as reported.
//
// And a third, found while re-rendering it: every surface colour was being
// converted from sRGB TWICE. `new THREE.Color('#8d9873')` already lands in the
// renderer's linear working space (three's ColorManagement is on), and the code
// then called `.convertSRGBToLinear()` on it again. The grass was going down at
// about a quarter of its intended luminance, which is why a painted yard turned
// the arena into a dark hole -- the very failure the old header describes and
// blames on the choice of hue. The hues were fine. The gamma was not.
//
// ============================================================================
// WHAT THIS DOES INSTEAD, IN FOUR PARTS
// ============================================================================
//
// The author paints a coarse field of material per half-metre cell. From it:
//
//   ONE MESH, OPAQUE. Every material lives on a single heightfield, vertex
//   coloured, one draw call, alpha 1.0 everywhere the author painted. There is
//   no stack of coats, so there is nothing for the floor to come through. Alpha
//   is used in one place only -- the last 0.35 m of the OUTER rim, where the
//   cover deliberately dies out into bare floor -- and even there it is a
//   single layer, so the fade is the fade and not a fade of a fade. The rim is
//   at exactly y = 0 and the material carries polygonOffset, which is
//   sandpath.js's convention and for its reason: a lift buys the same guarantee
//   and hands back a visible lip.
//
//   THE BORDER IS A CROSSOVER, NOT A GRADIENT. The painted cells are still
//   blurred wide, because a wide field is what makes a boundary wander in a
//   natural way rather than following the paint's own staircase. But the blur
//   is not what gets drawn. The weights are put through a contrast function
//   (SHARP) that collapses the whole ramp to about 20 cm -- narrower than the
//   25 cm between two nodes, so what is actually drawn is one node's worth of
//   ramp whose POSITION is placed inside the cell by the interpolation. And
//   the field is sampled through a DOMAIN WARP -- the same warp for every
//   material, so it can never open a gap -- which pushes that line off its
//   blurred path by up to 58 cm at a one to three metre wavelength. What comes
//   out is an edge with fingers and bays in it, the shape of a real verge, in
//   a band you can put a finger on. Measured off the built mesh: pure grass at
//   x = -2.00, one blended vertex, pure earth at x = -1.50.
//
//   THE EDGE IS SHADED, NOT DRAWN. A line that is only a change of colour is a
//   stain, at this camera angle above all. So each material sits at its own
//   HEIGHT (MATERIALS[].lift): grass is 2.8 cm of thatch, a dirt road is
//   scraped down to 1. And the crossover between them is not a ramp but a
//   SHOULDER AND A GUTTER (LIP) -- the higher ground rounds up over its own
//   edge, the lower one is scuffed down at the foot of it -- because a ramp
//   only shades when the light happens to cross it, and half the boundaries in
//   a level run along the key's azimuth. Measured off the same mesh: 40 mm on
//   the lawn, 46 mm at the crest, 8 mm in the gutter, 22 mm on the road. A
//   narrow contact darkening is laid into the vertex colour along the line as
//   well, for the same reason a prop gets a contact shadow: one directional
//   light cannot make the junction between two surfaces dark by itself.
//
//   THE DETAIL STILL INTERLEAVES, AND ACROSS A WIDER BAND THAN THE SURFACE.
//   This is what keeps the crisper edge from reading as a cut. The scatter --
//   grass blades, gravel chips, sand pebbles, earth clods -- is driven by the
//   UNSHARPENED weight, so its transition is still a metre and a half wide
//   while the surface's is a quarter of a metre. Grass tufts therefore stand a
//   good half metre out into the dirt, thinning as they go, and pebbles lie
//   back inside the grass. The surface says where the boundary is; the scatter
//   says the two grounds have lived next to each other. That is how a
//   churchyard path actually meets its verge. The one exception is a kerbed
//   boundary, where the scatter is pulled back onto the sharp weight: a row of
//   stones is a thing plants respect, and grass seeding itself across it is
//   the tell that the stones were dropped on a picture of grass.
//
// ============================================================================
// AND THE ROW OF STONES
// ============================================================================
//
// The owner's own example -- grass stops net with a row of stones, then a dirt
// road -- is already a reviewed prop: props/ground/kerb.js lays a run of
// separate, irregular, half sunk blocks along a polyline. Nothing here needed
// to draw stones. What was missing was the join: a kerb is a thing that happens
// AT A BOUNDARY, and a boundary was not something you could name.
//
// Now you can. The level file's ground block takes
//
//     "kerbs": [ ["grass", "earth"] ]
//
// which means: wherever grass meets earth, lay a kerb along the join. The
// boundary itself is extracted from the same weight field the surface is drawn
// from (marching squares on the difference of the two weights), so the stones
// land exactly on the line the shading already describes -- they cannot drift
// off it, and the author never places a single stone. Painting more grass moves
// the kerb. The relief is flattened under the run, and the scatter is cleared
// out of the stones' footprint, because grass growing through a kerb is the
// tell that the stones were dropped on top of a picture of grass.
//
// ============================================================================
// WHAT WAS CONSIDERED AND NOT DONE
// ============================================================================
//
//   * A splat map on the floor plane. It is the documented failure -- a blend
//     of two stains is a stain -- it would have to fight the floor's grid
//     shader, and the grid is not decoration: it is the only thing that says
//     the ghost is moving rather than the world.
//   * Keeping one mesh per material and simply "fixing" the alpha. There is no
//     fix. Two coats of alpha over a floor cannot be opaque unless one of them
//     is 1, at which point it is a single mesh with a hard edge and the other
//     coat is doing nothing. The compositing had to go, not be tuned.
//   * An opaque surface with a hard geometric rim instead of the 35 cm alpha
//     fringe. Cheaper, sorts better, writes depth -- and turns the outside of
//     every painted region into a half-metre staircase, because the paint is on
//     a half-metre grid. The fringe is where the staircase goes to die.
//   * alphaHash for that fringe, which would have kept the whole thing in the
//     opaque pass. It dithers, and a dithered fringe is film grain in a project
//     whose house style is matte clay.
//   * Re-cutting sandpath.js / gravelpath.js / grass.js into area fills. They
//     are ribbon and clump props with their own geometry and their own reasons,
//     and turning them into a fill would be a rewrite of three reviewed props
//     to serve one tool. They are untouched. A path in a level is still one of
//     those ribbons; this is the ground the ribbon is laid on.
//   * Baking anything to a canvas. Nothing here needs one, and the project's
//     own measurement is that a bake after the renderer has drawn costs about
//     five times what it costs before. The only canvas in the whole pass is the
//     one kerb.js bakes per run, which is why the runs are capped.
//   * SUB = 3, which would halve the crossover again to 17 cm. It also puts
//     33k vertices in the buffer and, more to the point, 2.25x the work in the
//     node loop -- and this is rebuilt while a brush is being dragged. 25 cm is
//     eleven pixels at the game's widest zoom, which is an edge.
//   * Computing the surface normals with computeVertexNormals(). They come off
//     the heightfield by central difference instead, which is both cheaper and
//     better: the analytic normal is the smooth surface's, so the shoulder of
//     the lip does not facet along the triangulation.
//
// ============================================================================
// COST
// ============================================================================
//
// One draw call for the whole surface, whatever the mix of materials, plus one
// per material for the scatter and one per kerb run. A 30 by 30 arena painted
// end to end is 3600 cells; at SUB = 2 that is a 121 by 121 node grid, 14.6k
// vertices and 29k triangles in ONE static buffer, which is about what the
// four transparent surfaces cost between them before, at four times the
// resolution and a quarter of the draw calls.
//
// Nothing is rebuilt per frame. The whole thing is rebuilt when the paint
// changes, and THAT is the number that matters, because the editor rebuilds
// while the brush is being dragged. On public/levels/demo.json, a full 60 by
// 60 field with all four materials, warm, in node:
//
//     the old four-surface build          40 ms
//     this, first written                340 ms
//     this, as it stands                  54 ms
//     with 8 kerb runs on top            131 ms   (plus their texture bakes,
//                                                  which only a browser pays)
//
// Getting from 340 to 54 was three things and no cleverness: typed arrays and
// hand-written instance matrices instead of push() and Object3D; analytic
// normals instead of computeVertexNormals; and above all the material mask,
// which lets the middle of a lawn -- most of most levels -- skip the warp and
// the four field samples entirely, because a node with one material near it
// has a weight of 1 and there is nothing to compute.
//
// The kerbs are the expensive part and they are opt-in. Each run is a merged
// geometry plus its own colour and normal bake off a canvas, so KERB_MAX_RUNS
// caps what one paint field can ask for. The bakes happen at build time, never
// after a frame, and kerb.js's height canvas already carries
// willReadFrequently -- the flag that was worth 6.3 s to sandpath.js.

import * as THREE from 'three';
import { toyMaterial } from '../../ghost/props/style.js';
import { createKerbRun } from '../../ghost/props/ground/kerb.js';
import { unpackPaint } from './format.js';

// How far the blur reaches, in cells. Three cells at 0.5 is a metre and a half.
// This is NO LONGER the width of the visible border -- SHARP decides that --
// but it is still the width of the scatter's interleave, and it is the scale at
// which the border is allowed to wander away from the paint.
const FEATHER = 3;

// Nodes per painted cell. The surface is drawn at twice the resolution of the
// paint so that a 20 cm crossover has vertices to happen across; at SUB = 1 the
// narrowest edge the mesh can express is a whole 50 cm cell and every boundary
// snaps to the paint grid. Costs 4x the vertices of the paint grid, which is
// still one third of what the old four-surface build used.
const SUB = 2;

// The contrast applied to the blurred weights. Read it as: two materials share
// the surface only while their blurred coverages are within SHARP of each
// other. The blurred difference climbs at about 0.66 per metre across a
// straight border, so 0.07 asks for a band about 20 cm wide -- narrower than
// the 25 cm between two nodes, which means what actually gets drawn is one
// node's worth of ramp with its position placed sub-cell by the interpolation.
// That is the crispest edge this mesh can carry, and it is a quarter of what
// the first pass drew.
const SHARP = 0.07;

// The lip is deliberately NOT that narrow. It is a shape in the ground, so it
// needs three or four nodes to be sampled smoothly; asked for at 20 cm it would
// land on whichever vertices happened to be near the line and bead along the
// edge at the node pitch. So it is measured off the raw blurred balance instead
// of the sharpened weights: QW = 0.30 of the balance is about 45 cm of ground,
// and the crest and the trough sit about 26 cm either side of the line.
const QW = 0.30;

// The domain warp, in metres of displacement and metres of wavelength. This is
// what makes the crossover a coastline instead of a contour. Both octaves move
// EVERY material's sample together, so the weights still sum to one and a warp
// can never tear a hole between two materials.
const WARP = [
  { amp: 0.42, len: 3.0 },
  { amp: 0.16, len: 1.1 },
];

// The outer rim, where the cover fades into bare floor. This is the ONLY place
// alpha below 1 appears. 0.35 m is about two thirds of a paint cell: long
// enough to swallow the staircase, short enough to read as the grass petering
// out rather than as a soft mask.
const FRINGE = 0.35;
const WARP_MAX = WARP.reduce((a, o) => a + o.amp, 0);

// The swell: a low, long wavelength undulation the whole cover shares, so a
// large fill is not a billiard table. Two centimetres, over a two metre
// wavelength -- enough for the key light to find, far too little to trip over
// or to tilt a headstone.
const RELIEF = 0.016;
const RELIEF_SCALE = 2.0;

// The contact darkening along a crossover. A junction between two surfaces is
// darker than either of them and one directional light will not do that on its
// own; this is the same argument style.js's contactShadow() makes for props.
const SEAM_AO = 0.20;

// The lip. A step alone is a ramp, and a ramp only shades when the light
// happens to cross it: the key comes in on one azimuth and half the boundaries
// in a level run along it. So the crossover is not a ramp but a SHOULDER AND A
// GUTTER -- the higher material rounds up over the edge, the lower one is
// scuffed down at the foot of it -- which puts a lit face and a shaded face
// next to each other whichever way the boundary runs. 1.6 cm, peaking about
// 11 cm either side of the line, so the whole feature is 22 cm wide and lands
// inside the crossover rather than spreading it.
//
// This is also why the flat heights in MATERIALS can stay small. The drama is
// at the edge, where it is wanted; the middle of a lawn is 3 cm of thatch and
// nothing standing on it looks sunk.
const LIP = 0.016;

// Colours and heights.
//
// The hues come from the props that already own these grounds, so a painted
// gravel yard and a gravel path are the same gravel: sand from sandpath.js's
// SAND, gravel from gravelpath.js's GRAVEL.base, earth from dirtpile.js's side
// tone. They are pitched at the floor's own luminance (#8f949e, about 148) on
// purpose: a ground cover that is darker than the floor turns the arena into a
// hole with pale props standing in it. Note that these are handed to
// THREE.Color as sRGB strings and NOT converted again; see the header.
//
// `lift` is what makes the border shade rather than stain. It is a real height
// in metres and the differences are the whole point: grass is thatch and stands
// proud, a dirt road is scraped down to the subsoil. Nothing may be negative --
// the floor is opaque at y = 0 and anything under it is simply gone.
//
// `density` is scatter instances per square metre at full weight.
// `detailColor` is the scatter's own tone and it is NOT the surface's. The old
// build got this for free by accident: its surface was four times too dark, so
// anything strewn on it stood out. With the gamma fixed, a chip the colour of
// its own gravel bed is invisible, and a ground whose detail cannot be seen is
// back to being a stain. Each of these is the same hue two or three steps off
// its bed -- blades darker than thatch, chips and pebbles catching the light,
// clods darker than the scraped earth around them.
export const MATERIALS = {
  grass: { color: '#8d9873', detail: 'blades', density: 6.5, lift: 0.028, detailColor: '#79865b' },
  sand: { color: '#b0a794', detail: 'pebbles', density: 2.4, lift: 0.014, detailColor: '#c6bda8' },
  gravel: { color: '#8b8a88', detail: 'chips', density: 6.0, lift: 0.012, detailColor: '#a8a7a2' },
  earth: { color: '#9c8768', detail: 'clods', density: 3.4, lift: 0.010, detailColor: '#87724f' },
};

// Kerbs. A run shorter than this is a stub and reads as three stones dropped in
// the grass, so it is dropped; and each run bakes its own stone texture, so the
// count is capped rather than left to whatever the paint happens to produce.
const KERB_MIN_RUN = 1.4;
const KERB_MAX_RUNS = 8;
const KERB_STEP = 0.30;      // resampling pitch along an extracted boundary
const KERB_CLEAR = 0.16;     // scatter is cleared this far either side
const KERB_FLAT = 0.55;      // and the swell is flattened this far either side
const KERB_HOLD = 1.70;      // and the scatter stops crossing over, this far out

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

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Handed to setColorAt once per scatter, only so three allocates the instance
// colour buffer; every entry is then written by hand.
const WHITE = new THREE.Color(1, 1, 1);

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

// Cell weights, blurred twice (two box passes are close enough to a gaussian),
// then normalised. This is the SOFT field: it drives the scatter, and it is the
// input the surface's contrast function sharpens. Exported unchanged in shape
// because it was exported before.
export function weightField(ground) {
  const { w, h } = ground;
  const names = ground.materials;
  const cells = ground.cells || unpackPaint(ground.paint, w * h);
  const raw = names.map(() => new Float32Array(w * h));
  const painted = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = cells[i];
    if (v > 0 && v <= names.length) { raw[v - 1][i] = 1; painted[i] = 1; }
  }
  const blurred = raw.map((f) => boxBlur(boxBlur(f, w, h, FEATHER), w, h, FEATHER));
  const total = new Float32Array(w * h);
  for (const f of blurred) for (let i = 0; i < w * h; i++) total[i] += f[i];
  const weight = blurred.map((f) => {
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = total[i] > 1e-4 ? f[i] / total[i] : 0;
    return out;
  });
  // Kept for the old signature. The surface no longer uses it: coverage is a
  // distance to the painted cells now, not a blurred total, precisely because a
  // blurred total never reaches one on a small patch.
  const cover = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cover[i] = Math.min(1, total[i] * 1.35);
  return { cells, weight, cover, painted, names };
}

// Bilinear sample of a cell-resolution field at a world point. Cell centres sit
// at minX + (i + 0.5) * cell, and everything outside clamps to the edge.
//
// No closures in here, deliberately. This is called eight times per node and a
// node grid is fifteen thousand nodes: two arrow functions per call was, when
// measured, most of the cost of the whole build.
function sampleCell(field, w, h, cell, minX, minZ, x, z) {
  const fx = (x - minX) / cell - 0.5;
  const fz = (z - minZ) / cell - 0.5;
  let i0 = Math.floor(fx);
  let j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  let i1 = i0 + 1;
  let j1 = j0 + 1;
  if (i0 < 0) i0 = 0; else if (i0 > w - 1) i0 = w - 1;
  if (i1 < 0) i1 = 0; else if (i1 > w - 1) i1 = w - 1;
  if (j0 < 0) j0 = 0; else if (j0 > h - 1) j0 = h - 1;
  if (j1 < 0) j1 = 0; else if (j1 > h - 1) j1 = h - 1;
  const r0 = j0 * w;
  const r1 = j1 * w;
  const a = field[r0 + i0];
  const b = field[r0 + i1];
  const c = field[r1 + i0];
  const d = field[r1 + i1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// Distance in metres from every node to the nearest node that is inside the
// painted region, by two-pass chamfer. Zero inside. This replaces the blurred
// coverage: a single painted cell is fully covered by it, which is the whole
// bug in part two of the header.
function outsideDistance(inside, nw, nh, step) {
  const BIG = 1e6;
  const d = new Float32Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) d[i] = inside[i] ? 0 : BIG;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const k = j * nw + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) v = Math.min(v, d[k - nw] + D1);
      if (i > 0 && j > 0) v = Math.min(v, d[k - nw - 1] + D2);
      if (i < nw - 1 && j > 0) v = Math.min(v, d[k - nw + 1] + D2);
      d[k] = v;
    }
  }
  for (let j = nh - 1; j >= 0; j--) {
    for (let i = nw - 1; i >= 0; i--) {
      const k = j * nw + i;
      let v = d[k];
      if (i < nw - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < nh - 1) v = Math.min(v, d[k + nw] + D1);
      if (i < nw - 1 && j < nh - 1) v = Math.min(v, d[k + nw + 1] + D2);
      if (i > 0 && j < nh - 1) v = Math.min(v, d[k + nw - 1] + D2);
      d[k] = v;
    }
  }
  for (let i = 0; i < nw * nh; i++) d[i] *= step;
  return d;
}

// Bilinear sample of a node-resolution field at a world point. Same rule about
// closures as sampleCell: this one is called once per scatter instance.
function sampleNode(field, nw, nh, step, minX, minZ, x, z) {
  const fx = (x - minX) / step;
  const fz = (z - minZ) / step;
  let i0 = Math.floor(fx);
  let j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  let i1 = i0 + 1;
  let j1 = j0 + 1;
  if (i0 < 0) i0 = 0; else if (i0 > nw - 1) i0 = nw - 1;
  if (i1 < 0) i1 = 0; else if (i1 > nw - 1) i1 = nw - 1;
  if (j0 < 0) j0 = 0; else if (j0 > nh - 1) j0 = nh - 1;
  if (j1 < 0) j1 = 0; else if (j1 > nh - 1) j1 = nh - 1;
  const r0 = j0 * nw;
  const r1 = j1 * nw;
  const a = field[r0 + i0];
  const b = field[r0 + i1];
  const c = field[r1 + i0];
  const d = field[r1 + i1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// --- the boundary, as a polyline ----------------------------------------------
//
// Marching squares on the difference of two node weights. Only cells where both
// materials between them account for the surface are considered, so a kerb is
// never traced round the outside of the cover or through a third material.

function contour(fa, fb, nw, nh, step, minX, minZ, alpha) {
  const segs = [];
  const at = (i, j) => fa[j * nw + i] - fb[j * nw + i];
  const ok = (i, j) => {
    const k = j * nw + i;
    return fa[k] + fb[k] > 0.55 && alpha[k] > 0.75;
  };
  const px = (i) => minX + i * step;
  const pz = (j) => minZ + j * step;
  // Where the contour crosses one edge of the quad, by linear interpolation.
  const lerp = (x0, z0, v0, x1, z1, v1) => {
    const t = v0 === v1 ? 0.5 : v0 / (v0 - v1);
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  };
  for (let j = 0; j < nh - 1; j++) {
    for (let i = 0; i < nw - 1; i++) {
      if (!ok(i, j) || !ok(i + 1, j) || !ok(i, j + 1) || !ok(i + 1, j + 1)) continue;
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v01 = at(i, j + 1);
      const v11 = at(i + 1, j + 1);
      let code = 0;
      if (v00 > 0) code |= 1;
      if (v10 > 0) code |= 2;
      if (v11 > 0) code |= 4;
      if (v01 > 0) code |= 8;
      if (code === 0 || code === 15) continue;
      const x0 = px(i);
      const x1 = px(i + 1);
      const z0 = pz(j);
      const z1 = pz(j + 1);
      const eB = () => lerp(x0, z0, v00, x1, z0, v10);   // bottom edge
      const eR = () => lerp(x1, z0, v10, x1, z1, v11);   // right
      const eT = () => lerp(x0, z1, v01, x1, z1, v11);   // top
      const eL = () => lerp(x0, z0, v00, x0, z1, v01);   // left
      const push = (a, b) => segs.push([a, b]);
      switch (code) {
        case 1: case 14: push(eL(), eB()); break;
        case 2: case 13: push(eB(), eR()); break;
        case 3: case 12: push(eL(), eR()); break;
        case 4: case 11: push(eR(), eT()); break;
        case 6: case 9: push(eB(), eT()); break;
        case 7: case 8: push(eL(), eT()); break;
        // The two ambiguous saddles. Either resolution is defensible; both
        // segments are emitted, which for a kerb means the join is laid round
        // both lobes rather than through the pinch.
        case 5: push(eL(), eB()); push(eR(), eT()); break;
        case 10: push(eB(), eR()); push(eL(), eT()); break;
        default: break;
      }
    }
  }
  return segs;
}

// Chain loose segments into polylines. Endpoints are quantised to a tenth of a
// millimetre, which is far below the grid and far above float noise.
function chain(segs) {
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const ends = new Map();
  const used = new Array(segs.length).fill(false);
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [segs[i][0], segs[i][1]];
    // Grow from both ends until nothing joins on.
    for (let end = 0; end < 2; end++) {
      for (;;) {
        const tip = end === 0 ? line[line.length - 1] : line[0];
        const cand = ends.get(key(tip)) || [];
        let next = -1;
        for (const c of cand) if (!used[c]) { next = c; break; }
        if (next < 0) break;
        used[next] = true;
        const s = segs[next];
        const same = key(s[0]) === key(tip);
        const grow = same ? s[1] : s[0];
        if (end === 0) line.push(grow); else line.unshift(grow);
      }
    }
    lines.push(line);
  }
  return lines;
}

// Resample a chained polyline at a fixed pitch and smooth it. Marching squares
// on a grid produces a zigzag at the grid's own scale; a kerb stone is 45 cm
// long and would sit on that zigzag like a row of teeth.
function tidy(line, step) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  if (total < 1e-3) return { pts: [], length: 0 };
  const n = Math.max(2, Math.round(total / step) + 1);
  const out = [];
  let seg = 1;
  let walked = 0;
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const want = (total * k) / (n - 1);
    while (seg < line.length) {
      const l = Math.hypot(line[seg][0] - line[seg - 1][0], line[seg][1] - line[seg - 1][1]);
      if (walked + l >= want - 1e-9 || seg === line.length - 1) { prev = walked; break; }
      walked += l;
      seg += 1;
    }
    const a = line[seg - 1];
    const b = line[seg];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, Math.max(0, (want - prev) / l));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  // One pass of a three tap average, ends held.
  const sm = out.map((p) => [p[0], p[1]]);
  for (let i = 1; i < out.length - 1; i++) {
    sm[i][0] = (out[i - 1][0] + 2 * out[i][0] + out[i + 1][0]) / 4;
    sm[i][1] = (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4;
  }
  return { pts: sm, length: total };
}

// The pairs a file asks for, as indices into the material list. Accepts
// ["grass","earth"] or { between: ["grass","earth"], scale }.
function kerbPairs(spec, names) {
  const out = [];
  for (const entry of spec || []) {
    const pair = Array.isArray(entry) ? entry : entry?.between;
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const a = names.indexOf(pair[0]);
    const b = names.indexOf(pair[1]);
    if (a < 0 || b < 0 || a === b) continue;
    out.push({ a, b, scale: (!Array.isArray(entry) && Number(entry.scale)) || 1 });
  }
  return out;
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
//
// ground   the level file's ground block: cell, w, h, minX, minZ, materials,
//          paint (or cells), and optionally kerbs.
// kerbs    overrides ground.kerbs, for a caller that wants to preview one.
//
// The return shape is the one the editor and the viewer already call:
// { group, stats, update, dispose }.

export function createGroundCover({ ground, seed = 1, detail = true, kerbs = null } = {}) {
  const group = new THREE.Group();
  group.name = 'groundcover';
  const disposables = [];
  const parts = [];
  const stats = { surfaces: 0, instances: 0, kerbs: 0, vertices: 0 };
  if (!ground || !ground.w || !ground.h) {
    return { group, stats, update() {}, dispose() {} };
  }

  const { w, h, cell, minX, minZ } = ground;
  const { weight, painted, names } = weightField(ground);

  const nw = w * SUB + 1;
  const nh = h * SUB + 1;
  const step = cell / SUB;
  const nodeX = (i) => minX + i * step;
  const nodeZ = (j) => minZ + j * step;

  // --- coverage --------------------------------------------------------------
  // A node is inside if any cell it touches is painted. Distance out from that
  // set is what the rim fades over, so every painted cell is covered outright
  // however small the patch is.
  const inside = new Uint8Array(nw * nh);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!painted[j * w + i]) continue;
      for (let b = 0; b <= SUB; b++) {
        const row = (j * SUB + b) * nw + i * SUB;
        for (let a = 0; a <= SUB; a++) inside[row + a] = 1;
      }
    }
  }
  const dOut = outsideDistance(inside, nw, nh, step);
  // And the distance the other way, which exists only as an optimisation: a
  // node this far inside the paint cannot be reached by the rim fade however
  // the warp pulls its sample, so it is opaque without asking.
  const notInside = new Uint8Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) notInside[i] = inside[i] ? 0 : 1;
  const dIn = outsideDistance(notInside, nw, nh, step);

  // WHICH MATERIALS CAN POSSIBLY MATTER AT A CELL, as a bit per material,
  // widened by the furthest the warp can drag a sample. Most of a painted
  // arena is the middle of one material, and a node whose mask holds a single
  // bit has a known answer: that material's weight is 1 by construction,
  // because the weights are a normalised share of what is present. Skipping
  // the warp and the four field samples there is what keeps a brush stroke
  // interactive on a full arena.
  const RD = Math.ceil(WARP_MAX / cell) + 1;
  let mask = new Uint16Array(w * h);
  for (let c = 0; c < w * h; c++) {
    let bits = 0;
    for (let m = 0; m < names.length; m++) if (weight[m][c] > 1e-4) bits |= 1 << m;
    mask[c] = bits;
  }
  {
    const tmp = new Uint16Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let bits = 0;
        for (let k2 = -RD; k2 <= RD; k2++) {
          const x = i + k2 < 0 ? 0 : i + k2 > w - 1 ? w - 1 : i + k2;
          bits |= mask[j * w + x];
        }
        tmp[j * w + i] = bits;
      }
    }
    const out = new Uint16Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let bits = 0;
        for (let k2 = -RD; k2 <= RD; k2++) {
          const y = j + k2 < 0 ? 0 : j + k2 > h - 1 ? h - 1 : j + k2;
          bits |= tmp[y * w + i];
        }
        out[j * w + i] = bits;
      }
    }
    mask = out;
  }


  // --- the weights, warped and sharpened -------------------------------------
  const M = names.length;
  const wn = [];
  for (let m = 0; m < M; m++) wn.push(new Float32Array(nw * nh));
  const alpha = new Float32Array(nw * nh);
  const fade = new Float32Array(nw * nh);
  // The signed balance between the two strongest materials at a node, ordered
  // by their lift: +1 deep inside the higher one, -1 deep inside the lower,
  // zero on the line. Taken from the RAW blurred field, not the sharpened one,
  // because the lip is a wide shape and the colour edge is a narrow one.
  const qlip = new Float32Array(nw * nh);
  const raw = new Float32Array(M);
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const k = j * nw + i;
      // Nothing outside the fringe can contribute a vertex, and on a sparsely
      // painted arena that is most of the grid. WARP_MAX is how far a sample
      // can be dragged in from beyond it.
      if (dOut[k] > FRINGE + WARP_MAX) continue;
      const x = nodeX(i);
      const z = nodeZ(j);
      const ci = (i / SUB) | 0;
      const cj = (j / SUB) | 0;
      const bits = mask[(cj > h - 1 ? h - 1 : cj) * w + (ci > w - 1 ? w - 1 : ci)];
      const deep = dIn[k] > WARP_MAX;
      // The single material case: one bit in the mask means nothing else is
      // near enough to be dragged in, so the answer is known.
      if (bits && (bits & (bits - 1)) === 0 && deep) {
        wn[31 - Math.clz32(bits)][k] = 1;
        qlip[k] = 1;
        fade[k] = 1;
        alpha[k] = 1;
        continue;
      }
      // One warp, shared by every field sampled at this node.
      let dx = 0;
      let dz = 0;
      for (let o = 0; o < WARP.length; o++) {
        const { amp, len } = WARP[o];
        dx += amp * (valueNoise(x / len, z / len, seed + 61 + o) - 0.5) * 2;
        dz += amp * (valueNoise(x / len + 37.1, z / len - 12.7, seed + 61 + o) - 0.5) * 2;
      }
      const wx = x + dx;
      const wz = z + dz;

      let mx = 0;
      let r0 = -1;
      let r1 = -1;
      let v0 = 0;
      let v1 = 0;
      for (let m = 0; m < M; m++) {
        const v = bits & (1 << m) ? sampleCell(weight[m], w, h, cell, minX, minZ, wx, wz) : 0;
        raw[m] = v;
        if (v > mx) mx = v;
        if (v > v0) { v1 = v0; r1 = r0; v0 = v; r0 = m; }
        else if (v > v1) { v1 = v; r1 = m; }
      }
      let q = 1;
      if (r1 >= 0 && v0 + v1 > 1e-6) {
        const d = (v0 - v1) / (v0 + v1);
        q = (MATERIALS[names[r0]]?.lift || 0) >= (MATERIALS[names[r1]]?.lift || 0) ? d : -d;
      }
      qlip[k] = q;
      // The contrast function. Everything within SHARP of the strongest
      // material stays, on a smoothstep so the crossover has no corner in it;
      // everything else is gone. Normalised, so the surface is always exactly
      // one material's worth of colour and never a fraction of the floor.
      let sum = 0;
      for (let m = 0; m < M; m++) {
        let t = (raw[m] - (mx - SHARP)) / SHARP;
        t = clamp01(t);
        t = t * t * (3 - 2 * t);
        raw[m] = t;
        sum += t;
      }
      if (sum > 1e-6) for (let m = 0; m < M; m++) wn[m][k] = raw[m] / sum;

      // The rim. Warped, so the cover's outline wanders like its borders do,
      // but never inside the paint: `inside` wins wherever it is set.
      const f = deep ? 1 : 1 - clamp01(sampleNode(dOut, nw, nh, step, minX, minZ, wx, wz) / FRINGE);
      fade[k] = f;
      alpha[k] = inside[k] ? 1 : f;
    }
  }

  // --- kerbs ------------------------------------------------------------------
  // Extracted before the heights, because a kerb flattens the ground it is
  // bedded in and clears the scatter out of its own footprint.
  const pairs = kerbPairs(kerbs || ground.kerbs, names);
  const runs = [];
  if (pairs.length) {
    for (const p of pairs) {
      const lines = chain(contour(wn[p.a], wn[p.b], nw, nh, step, minX, minZ, alpha));
      for (const line of lines) {
        const t = tidy(line, KERB_STEP);
        if (t.length >= KERB_MIN_RUN && t.pts.length >= 2) runs.push({ pts: t.pts, length: t.length, scale: p.scale });
      }
    }
    runs.sort((a, b) => b.length - a.length);
    runs.length = Math.min(runs.length, KERB_MAX_RUNS);
  }

  // Where a kerb is, on the node grid. Two radii off one rasterisation:
  // `kerbMask` is the stones' own footprint, which flattens the swell and takes
  // the scatter out from under the blocks; `kerbHold` is wider and does one
  // other job, below -- a kerb is a thing that STOPS the interleave, and grass
  // seeding itself across a row of stones and onto the road is the tell that
  // the stones were dropped on top of a picture of grass.
  const kerbMask = new Float32Array(nw * nh);
  const kerbHold = new Float32Array(nw * nh);
  if (runs.length) {
    const reach = Math.ceil(KERB_HOLD / step);
    for (const run of runs) {
      for (let s2 = 0; s2 < run.pts.length; s2++) {
        const [px, pz] = run.pts[s2];
        const ci = Math.round((px - minX) / step);
        const cj = Math.round((pz - minZ) / step);
        for (let jj = cj - reach; jj <= cj + reach; jj++) {
          if (jj < 0 || jj >= nh) continue;
          for (let ii = ci - reach; ii <= ci + reach; ii++) {
            if (ii < 0 || ii >= nw) continue;
            const d = Math.hypot(nodeX(ii) - px, nodeZ(jj) - pz);
            const k = jj * nw + ii;
            const v = 1 - clamp01((d - KERB_CLEAR) / (KERB_FLAT - KERB_CLEAR));
            if (v > kerbMask[k]) kerbMask[k] = v;
            const g = 1 - clamp01(d / KERB_HOLD);
            if (g > kerbHold[k]) kerbHold[k] = g;
          }
        }
      }
    }
  }

  // --- the heightfield, and the shape of the edge -----------------------------
  //
  // Three terms. The material's own flat height; the shared swell; and the lip,
  // which is the one that makes a boundary read at this camera.
  //
  // The lip is written against `u`, the balance between the two strongest
  // materials at a node: 1 on pure ground, 0 exactly on the crossover. shape(u)
  // is zero at both ends and peaks a third of the way in, so the higher
  // material rounds UP just inside its own edge and the lower one is scuffed
  // DOWN just inside its own -- a shoulder and a gutter, continuous through the
  // line itself because the sign flips at the same moment u passes zero.
  const height = new Float32Array(nw * nh);
  const seam = new Float32Array(nw * nh);
  // Odd, zero at the line and zero again once the ground is pure, peaking a
  // third of the way in. Beyond +/- 1 it is flat ground.
  const shape = (v) => (v <= -1 || v >= 1 ? 0 : 1.5 * v * (1 - v * v));
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const k = j * nw + i;
      if (fade[k] <= 0 && !inside[k]) continue;
      const x = nodeX(i);
      const z = nodeZ(j);
      let lift = 0;
      let d0 = -1;
      let d1 = -1;
      let w0 = 0;
      let w1 = 0;
      for (let m = 0; m < M; m++) {
        const a = wn[m][k];
        if (a <= 0) continue;
        const spec = MATERIALS[names[m]];
        if (spec) lift += a * spec.lift;
        if (a > w0) { w1 = w0; d1 = d0; w0 = a; d0 = m; }
        else if (a > w1) { w1 = a; d1 = m; }
      }
      const lip = LIP * shape(qlip[k] / QW);
      // The darkening runs off the sharpened weights instead, so it is as
      // narrow as the colour edge: hardest exactly on the line, gone by the
      // time either material is pure.
      if (d1 >= 0 && w1 > 0.02) seam[k] = 1 - (w0 - w1) / (w0 + w1);
      const n = valueNoise(x / RELIEF_SCALE, z / RELIEF_SCALE, seed)
        + 0.45 * valueNoise(x / (RELIEF_SCALE * 0.4), z / (RELIEF_SCALE * 0.4), seed + 11);
      const swell = (n / 1.45) * RELIEF * (1 - 0.8 * kerbMask[k]);
      // Multiplied by the rim fade so the outermost vertices are at exactly
      // y = 0 and the cover cannot show a lip at a grazing angle. Clamped at
      // zero because the gutter is allowed to be deeper than the material it is
      // cut into is high, and anything below the floor plane is simply gone.
      height[k] = Math.max(0, (lift + swell + lip) * fade[k]);
    }
  }

  // --- the surface ------------------------------------------------------------
  // One mesh. One draw call. The only alpha in it is the rim.
  //
  // Written into typed arrays sized for the worst case rather than pushed onto
  // JS arrays and converted at the end: this is rebuilt every time the editor's
  // brush moves, so the difference is felt by a person.
  {
    const index = new Int32Array(nw * nh).fill(-1);
    const maxV = nw * nh;
    const positions = new Float32Array(maxV * 3);
    const normals = new Float32Array(maxV * 3);
    const colors = new Float32Array(maxV * 4);
    const tris = new Uint32Array((nw - 1) * (nh - 1) * 6);
    let vCount = 0;
    let tCount = 0;
    // A name this file does not know can only come from a hand-edited level.
    // It falls back to earth rather than to the floor's own grey, because grey
    // ground is indistinguishable from a hole in the cover and a hole is the
    // one thing this pass exists to abolish.
    const base = names.map((n) => new THREE.Color((MATERIALS[n] || MATERIALS.earth).color));
    const at = (i, j) => height[(j < 0 ? 0 : j > nh - 1 ? nh - 1 : j) * nw + (i < 0 ? 0 : i > nw - 1 ? nw - 1 : i)];
    const nodeOf = (i, j) => {
      const k = j * nw + i;
      if (index[k] >= 0) return index[k];
      const x = nodeX(i);
      const z = nodeZ(j);
      const v = vCount++;
      positions[v * 3] = x;
      positions[v * 3 + 1] = height[k];
      positions[v * 3 + 2] = z;
      // The normal, from the heightfield itself by central difference. This is
      // both cheaper than computeVertexNormals over 29k triangles and better:
      // it is the smooth surface's normal rather than an average of the
      // triangles that happen to touch this vertex, so the lip does not facet.
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
      const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      normals[v * 3] = -gx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -gz * inv;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let m = 0; m < M; m++) {
        const a = wn[m][k];
        if (a <= 0) continue;
        r += base[m].r * a;
        g += base[m].g * a;
        b += base[m].b * a;
      }
      // A little colour noise so a large fill is not one flat tone. Long
      // wavelength on purpose: nothing at the pixel scale, which would read as
      // film grain in a project whose house style is matte clay.
      let t = 0.90 + 0.20 * valueNoise(x * 0.7, z * 0.7, seed + 31);
      // The seam: a narrow darkening exactly along the crossover and nowhere
      // else. Squared, so it is a line rather than a haze.
      t *= 1 - SEAM_AO * seam[k] * seam[k];
      colors[v * 4] = r * t;
      colors[v * 4 + 1] = g * t;
      colors[v * 4 + 2] = b * t;
      colors[v * 4 + 3] = alpha[k];
      index[k] = v;
      return v;
    };
    for (let j = 0; j < nh - 1; j++) {
      for (let i = 0; i < nw - 1; i++) {
        const a = alpha[j * nw + i];
        const b = alpha[j * nw + i + 1];
        const c = alpha[(j + 1) * nw + i];
        const d = alpha[(j + 1) * nw + i + 1];
        if (a + b + c + d < 0.008) continue;
        const ia = nodeOf(i, j);
        const ib = nodeOf(i + 1, j);
        const ic = nodeOf(i, j + 1);
        const id = nodeOf(i + 1, j + 1);
        tris[tCount] = ia; tris[tCount + 1] = ic; tris[tCount + 2] = ib;
        tris[tCount + 3] = ib; tris[tCount + 4] = ic; tris[tCount + 5] = id;
        tCount += 6;
      }
    }
    if (tCount) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vCount * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, vCount * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vCount * 4), 4));
      geo.setIndex(new THREE.BufferAttribute(tris.subarray(0, tCount), 1));
      const mat = toyMaterial('#ffffff', {
        vertexColors: true,
        // Alpha 1 over every painted cell, so this is a transparent material
        // that is only actually transparent in the last 35 cm of the rim. It
        // still has to be flagged, because that rim is a genuine ramp.
        transparent: true,
        depthWrite: false,
        roughness: 0.95,
        // sandpath.js's fix, for its reason: the cover is coplanar with the
        // floor at its rim, and the fight is in the depth buffer rather than in
        // the geometry.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        dithering: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      // Before every other transparent thing in the scene. Contact shadows and
      // kerb stains are transparent too, and they belong ON the ground rather
      // than under it.
      mesh.renderOrder = -2;
      group.add(mesh);
      disposables.push(geo, mat);
      stats.surfaces = 1;
      stats.vertices = vCount;
    }
  }

  // --- the detail that makes the border a merge ---------------------------------
  // Driven by the SOFT weight, so its band is four times wider than the
  // surface's and the two grounds interleave across the edge the surface draws.
  if (detail) {
    for (let m = 0; m < M; m++) {
      const spec = MATERIALS[names[m]];
      if (!spec || !spec.density) continue;
      const perCell = spec.density * cell * cell;
      const wm = weight[m];
      const placed = [];
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          // Sampled at the cell centre on the node grid, which is where the
          // rim fade and the kerb clearance live.
          const ni = Math.min(nw - 1, i * SUB + (SUB >> 1));
          const nj = Math.min(nh - 1, j * SUB + (SUB >> 1));
          const nk = nj * nw + ni;
          // Soft weight away from a kerb, sharp weight near one. That single
          // mix is what makes a kerbed boundary read as a boundary the plants
          // respect and an open one read as two grounds growing into each
          // other, off the same field and with no second code path.
          // The soft weight is the CELL field itself; there is no reason to
          // resample it at a node when the scatter is walking cells anyway.
          const sw = wm[j * w + i];
          const drive = sw + (wn[m][nk] - sw) * kerbHold[nk];
          const a = drive * alpha[nk] * (1 - kerbMask[nk]);
          if (a < 0.03) continue;
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
      const dmat = toyMaterial(spec.detailColor || spec.color, {
        roughness: 0.95,
        side: spec.detail === 'blades' ? THREE.DoubleSide : THREE.FrontSide,
      });
      const inst = new THREE.InstancedMesh(dgeo, dmat, count);
      // The matrices are written straight into the instance buffer. Every one
      // of these is a yaw and a uniform scale, so composing them through an
      // Object3D costs a Quaternion, a Matrix4 and two allocations per blade
      // for six numbers that can be written by hand. At five thousand blades
      // that is most of the build.
      const im = inst.instanceMatrix.array;
      inst.setColorAt(0, WHITE);
      const ic = inst.instanceColor.array;
      for (let q = 0; q < count; q++) {
        const x = placed[q * 4];
        const z = placed[q * 4 + 1];
        const yaw = placed[q * 4 + 2];
        const sc = placed[q * 4 + 3];
        const cs = Math.cos(yaw) * sc;
        const sn = Math.sin(yaw) * sc;
        const o = q * 16;
        im[o] = cs; im[o + 1] = 0; im[o + 2] = -sn; im[o + 3] = 0;
        im[o + 4] = 0; im[o + 5] = sc; im[o + 6] = 0; im[o + 7] = 0;
        im[o + 8] = sn; im[o + 9] = 0; im[o + 10] = cs; im[o + 11] = 0;
        im[o + 12] = x;
        // Stand on the shared surface, not on y = 0, or the detail floats over
        // the swell on one side of it and sinks on the other.
        im[o + 13] = sampleNode(height, nw, nh, step, minX, minZ, x, z);
        im[o + 14] = z; im[o + 15] = 1;
        // Per instance tone. A field of one colour reads as a pattern however
        // random the placement is; this is the frequency that says every blade
        // and every chip is its own object. Written as plain numbers because
        // they are multipliers in the renderer's working space, not colours to
        // be converted from sRGB.
        const tone = 0.86 + 0.28 * hash2(q, m * 31 + q, seed + 3);
        ic[q * 3] = tone;
        ic[q * 3 + 1] = tone * (0.97 + 0.06 * hash2(q, m, seed + 4));
        ic[q * 3 + 2] = tone;
      }
      inst.instanceColor.needsUpdate = true;
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      group.add(inst);
      disposables.push(dgeo, dmat);
      stats.instances += count;
    }
  }

  // --- the stones -------------------------------------------------------------
  // kerb.js lays the run; all this decides is where the line is and how high the
  // bed sits. The whole run is set to one height -- the mean of the flattened
  // ground under it -- because a kerb is laid level and its own stones vary by
  // more than the swell does anyway.
  for (const run of runs) {
    let sum = 0;
    for (const [x, z] of run.pts) sum += sampleNode(height, nw, nh, step, minX, minZ, x, z);
    const made = createKerbRun({ seed: (seed * 131 + runs.indexOf(run) * 17) | 0 || 1, points: run.pts, scale: run.scale });
    made.group.position.y = sum / run.pts.length;
    group.add(made.group);
    parts.push(made);
    stats.kerbs += 1;
  }

  return {
    group,
    stats,
    update() {},
    dispose() {
      for (const p of parts) p.dispose?.();
      for (const d of disposables) d.dispose?.();
      group.clear();
    },
  };
}

export default createGroundCover;
