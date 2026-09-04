import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS, toyMaterial, contactShadow } from '../style.js';

// THE TWIN-HEAD LAMP POST: one squat column, a fat collar near the top, and two
// curved arms that sweep out and up from it, each carrying a round glass globe.
// The pair-of-lamps standard from a park gate.
//
// -----------------------------------------------------------------------------
// WHY IT IS NOT THE STREET LAMP
//
// street.js is already in this set and it is 3.30 tall, 0.68 across at its
// widest, with a SQUARE tapering head (superellipse 4.2), four glazing bars, a
// peaked cap and a finial over the top of it. Read as a rectangle that is 4.9
// times taller than it is wide. If this prop were the same drawing at a smaller
// size it would be worthless, so the two are separated on every axis that
// survives being seen from thirty units away:
//
//                          street        twin
//   height                 3.30          2.544
//   widest                 0.68          1.584
//   height / width         4.85          1.61
//   heads                  one           two, 1.240 apart
//   head section           square, 4.2   circular, everywhere
//   head shape             peaked roof   globe with a domed crown
//   glazing bars           four          none
//   shaft at its thinnest  0.066         0.098
//   height / thinnest      50            26
//
// The two silhouettes cannot be confused: one is a vertical stroke with a box
// on it, the other is a low wide Y with two balls on it. The 2.544 is chosen
// inside the brief's 2.4 to 2.8 and it is chosen from the top down, not the
// bottom up: the globes' crowns are the top of the prop, and at 2.544 they sit
// just above a 2.50 skeleton's skull and well under the street lamp's 3.30, so
// in a frame with both the street lamp still wins the skyline and this one
// reads as the thing standing beside it. Nothing on the axis rises past the
// globes: the central ornament stops at 2.162, for a reason that turns out to
// be about the light and is set out at THE ONE LIGHT below.
//
// -----------------------------------------------------------------------------
// THE ARMS, WHICH ARE THE WHOLE RISK
//
// They are the thinnest thing on the prop and they carry the silhouette, which
// is exactly the combination street.js refused to build: its note says there is
// no crossbar, no ladder rest and no scrollwork because each is a wire that
// becomes a plank at finger thickness. This prop cannot refuse its arms, so the
// two rules it follows instead are:
//
//   FAT. Each arm is a swept tube 0.070 in radius at the collar and 0.054 at
//   the cup, with a 0.006 swell through the middle so it is not a monotone
//   taper. That is 0.140 across at the root against a 0.588 sweep, so the arm
//   is 4.6 diameters long. street.js's glazing bar, the fattest wire it allowed
//   itself, is 4.3. This is a bar with a curve in it, not a wire.
//
//   SHORT, NOT THIN. The brief's fallback, and it is the one the collar buys.
//   The arms do not spring from the shaft, they spring from a bell 0.152 in
//   radius, so the horizontal run they have to cover to reach 0.620 is 0.488
//   rather than 0.522. Six per cent off the length at no cost to the spread,
//   because the spread is measured between the GLOBES and the collar is not one.
//
// The sweep itself is lazy on purpose: a cubic whose first control point leaves
// the collar almost level and whose last arrives almost vertical, so the arm
// goes out, thinks about it, and then stands the globe up. A circular arc there
// reads as plumbing.
//
// -----------------------------------------------------------------------------
// THE ONE LIGHT
//
// One PointLight for the whole prop and it casts no shadows. Six pumpkins and
// five lanterns are already in every fragment shader's light loop, so this prop
// gets one and it has two flames to answer for.
//
// It goes on the axis, level with the two flames, at (0, 2.302, 0). Midway
// between the heads is the obvious answer and it took two corrections to make
// it the right one.
//
// The first is that the obvious point was not empty. The prop wanted a tall
// central finial between the arms, the way a candelabra has one, and a point
// light inside a lathed stem lights none of it: every outward normal on that
// stem faces away from a source on its own axis, so the one part of the prop
// nearest the lamp would have rendered as the one cold part of it. The
// ornament was cut down to a bud topping out at 2.162 and the light sits 0.14
// clear above it, in air.
//
// The second is the pool. A single light midway lays a single pool where two
// are expected, and that objection is real but it is aimed at the wrong thing:
// at 2.30 up in a scene whose hemisphere and key already put about 2.9 on the
// floor, this light lands almost nothing there whatever it does. street.js
// found the same and its answer is borrowed: the point light is set where the
// IRONWORK looks right and the ground pool is a painted decal. So the decal
// here is baked from BOTH flame positions, two lobes summed, and the two-pool
// expectation is met in the only place it is visible. At 1.24 apart and 2.30 up
// the lobes overlap heavily and come out as one pool with a long axis, which is
// the honest answer for two lamps that close together, and that long axis is
// what says "two" from a distance.
//
// What the light is actually spent on is the metal: the collar, both arms, both
// cups and both crowns are symmetric about that point, so neither head is the
// lit one and neither is the dead one. And because a fixture that never moves
// reads as a fixture, the light's x slides a little toward whichever head is
// momentarily brighter, so the pool leans left and right as the two flames
// trade places.
//
// The inside of each globe is lit per head and not by that light at all: the
// emissive flame, its bloom, and the glass's own inner wash each ride their own
// head's level. That is what keeps the two heads separate objects.
//
// Decay is 1.25 rather than 2, which is street.js's frank cheat taken over
// wholesale and for the same reason. It is less violent here: this light is
// 0.62 from the nearest glass rather than 0.24 from a glazing bar, so the ratio
// it is flattening starts smaller.
//
// -----------------------------------------------------------------------------
// GLASS. No environment map in this scene, so a transparent material has
// nothing to reflect and renders as grey nothing. The fountain's fake optics
// (src/ghost/props/fountain/water.js) via street.js: a three band procedural
// sky sampled off the reflected normal, a Schlick fresnel deciding how much of
// it you see, one tight Blinn lobe for the key. Both globes are ONE mesh with a
// per-vertex head index, so the two of them cost one draw call and still carry
// two independent flame colours and two independent inner levels.
//
// WHAT IT COSTS: measured, see the report in the harness. Eight draw calls,
// about 23k triangles.

// ---------------------------------------------------------------------------
// metrics
//
// Profiles are lists of [radius, height] corners, filleted before they are
// revolved, so a number here is a corner of the silhouette and never a face.
const M = {
  height: 2.544,
  spread: 1.240,       // between globe centres
  width: 1.584,        // outside of glass to outside of glass

  // The column. Wider in the foot and fatter in the shaft than the street
  // lamp's, which is most of what makes it read as squat rather than as the
  // same post cut off. One continuous turned profile from the ground to the
  // top of the collar, so no seam runs anywhere the eye travels.
  post: [
    [0.000, 0.000],
    [0.340, 0.000],
    [0.340, 0.054],
    [0.256, 0.126],
    [0.276, 0.164],
    [0.276, 0.216],
    [0.168, 0.330],
    [0.142, 0.424],
    [0.124, 0.560],
    [0.104, 1.360],
    [0.124, 1.432],
    [0.124, 1.480],
    [0.102, 1.546],
    [0.098, 1.682],
    [0.152, 1.740],   // the collar bell the arms spring from
    [0.156, 1.814],
    [0.120, 1.876],
    [0.074, 1.912],
    [0.070, 1.970],
    [0.000, 1.970],
  ],
  postRound: [
    0.000, 0.034, 0.034, 0.056, 0.014, 0.014, 0.064, 0.048, 0.058,
    0.058, 0.014, 0.014, 0.018, 0.030, 0.044, 0.028, 0.038, 0.030, 0.018, 0.000,
  ],

  // The centre bud. Deliberately short: see THE ONE LIGHT. It still has to be
  // there, because two arms leaving a collar with nothing between them reads as
  // a broken post, and it still has to be fat, because it is the one thing on
  // the prop small enough to go spindly.
  bud: [
    [0.000, 1.918],
    [0.076, 1.928],
    [0.058, 1.998],
    [0.062, 2.036],
    [0.094, 2.062],
    [0.086, 2.104],
    [0.046, 2.140],
    [0.000, 2.162],
  ],
  budRound: [0.000, 0.022, 0.024, 0.020, 0.024, 0.026, 0.020, 0.000],

  // The arm, as a cubic in its own (out, up) plane. p1 almost level off the
  // collar and p3 almost vertical into the cup: out, then up, with the turn in
  // the last third.
  arm: {
    p0: [0.132, 1.788],
    p1: [0.348, 1.802],
    p2: [0.548, 1.878],
    p3: [0.620, 2.060],
    r0: 0.078,
    r1: 0.062,
    swell: 0.007,
  },

  // Everything from here is in the head's own frame, with its origin at the arm
  // tip, so a head can be moved by moving one number.
  headAt: [0.620, 2.060],

  // The cup the globe stands in. Closed over the top, so it is also the floor
  // the flame stands on and there is no way to see up inside the arm.
  cup: [
    [0.000, -0.036],
    [0.096, -0.030],
    [0.126, 0.004],
    [0.148, 0.050],
    [0.150, 0.086],
    [0.118, 0.106],
    [0.000, 0.116],
  ],
  cupRound: [0.000, 0.026, 0.028, 0.028, 0.020, 0.022, 0.000],

  // The globe: an arc of an ellipse rather than a filleted polyline, because a
  // sphere is the one shape a fillet cannot improve. Slightly taller than it is
  // wide, which is what stops it reading as a bubble.
  globe: { cy: 0.262, rx: 0.172, ry: 0.178, a0: -1.20, a1: 1.16 },

  // The domed crown over the globe's mouth, with a soft knob.
  crown: [
    [0.000, 0.398],
    [0.090, 0.404],
    [0.104, 0.426],
    [0.082, 0.456],
    [0.044, 0.474],
    [0.000, 0.486],
  ],
  crownRound: [0.000, 0.020, 0.020, 0.022, 0.016, 0.000],

  // Where the flame's teardrop stands and where its light lives.
  wickY: 0.152,
  flameY: 0.242,
};

// The two globe centres in the body's frame, and the one light between them.
const HEAD_X = M.headAt[0];
const FLAME_Y = M.headAt[1] + M.flameY;   // 2.302

// Tessellation. The globes are what the eye lands on; the post is 0.2 across
// and never needed 48 steps round.
const SEG = {
  post: Math.round(SEGMENTS.radial * 0.54),   // 26
  head: Math.round(SEGMENTS.radial * 0.71),   // 34
  arm: 14,
};

// Painted cast iron, the street lamp's. Metalness stays at zero: with no
// environment map a metal in this scene renders black.
const IRON = '#4d535c';
const GLASS_TINT = '#cfd8d4';

// The flame's two ends. The level spends its life in the top eighth of its
// range, so the colour mix is levered about the level's mean rather than taken
// off it raw, which is the pumpkin's trick by way of street.js.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
const PLATE_EMBER = new THREE.Color('#ff7b2c');
const PLATE_FLAME = new THREE.Color('#ffb44a');
const HUE_MID = 0.912, HUE_GAIN = 1.5;

// What a flame drives, at the bottom and the top of its swing. LAMP is the one
// shared channel: it takes the MEAN of the two levels, because there is one
// light and it is between them.
const LAMP = { min: 0.55, max: 1.25 };    // PointLight intensity, see LIGHT LEVEL
const INNER = { min: 0.26, max: 0.80 };   // the glass lit from inside, per head
const WICK = { min: 0.70, max: 1.70 };    // the flame mesh's emissive, per head
const HALO = { min: 0.18, max: 0.44 };    // the bloom around it, per head
const POOL = { min: 0.12, max: 0.29 };    // the warm on the ground, from the mean
// Additive light saturates to white long before an emissive does, so the halo
// and the pool get their own pair, deeper than the plate's.
const BLOOM_EMBER = new THREE.Color('#ff5410');
const BLOOM_FLAME = new THREE.Color('#ff9a35');

// ---------------------------------------------------------------------------
// noise, and the shape of the flicker
//
// Smooth 1D value noise. Layered it gives the slow wander and the rare events.
// What it cannot give is the tremble: smoothstep is flat at every lattice node,
// so a channel at f Hz stands still f times a second by construction. See
// makeFlicker for what carries the tremble instead.
function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// One head's flame, as a closure over its own noise field.
//
// The tremble is two sine carriers whose PHASE is dragged about by slow noise,
// and NOT summed smoothstep noise: a flame's flutter has a frequency, and what
// wanders is where in the cycle it has got to, not whether it is happening.
// Both carriers stay inside the 5 to 15Hz band a real flame flickers in, and
// nothing faster, because at 60fps a 20Hz carrier is three frames to a period
// and reads as sparkle.
//
// THE TWO HEADS MUST NOT BLINK TOGETHER. Three things separate them and all
// three are needed. Different noise SEEDS, so the wander, the gutters and the
// flares are different events. Different carrier FREQUENCIES, 7.2/12.1 against
// 6.5/13.0, so even a chance alignment drifts apart inside a second instead of
// locking. And a constant offset in t, so they do not start together either.
// Detuning alone is not enough, because two carriers beat: at 7.2 and 6.5 the
// beat period is 1.4s, and twice in that beat the two heads really are in step
// for a moment. The seeds are what carry those moments. Measured over 90
// seconds and five seeds, the two levels correlate between -0.17 and +0.14,
// and the gap between them reaches 0.36 to 0.56 of the level's own range.
//
// The AMPLITUDES and the carrier rates are set by the stall measurement and
// not by taste. At 0.028/0.016 on 6.4 and 11.7Hz the tremble measured 19% of
// frames within 0.002 of the one before, which is nearly the summed-noise
// number the whole construction exists to beat. The cause is not flatness in
// any one channel, it is that the two carriers' derivatives cancel wherever
// they are near a simple ratio: 11.7 over 6.4 is 1.83, close enough to 2 that
// the envelope of the sum's slope collapses twice a beat. Moving them to 7.2
// and 12.1 (1.68) and raising both amplitudes to 0.044 and 0.030 takes it to
// 5.9 to 6.8% of all frames, measured over two minutes at five seeds. The
// number that actually matters is the WORST fifteen second window inside that,
// because that is what a viewer sees: 7.5 to 9.6%, longest dead run four
// frames. The amplitudes are set by that measurement and not by taste.
function makeFlicker({ seed, phase, f1, f2 }) {
  const noise = makeNoise(seed);
  return (time) => {
    const t = time + phase;
    const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
    const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 7));

    const tremble = 0.044 * wobble(f1, 0.70, 12.4) + 0.030 * wobble(f2, 1.05, 55.1);

    // The breathing underneath, over a second or two. Summed noise is right for
    // this one and its stalls are a feature: a lull is what the slow channel is
    // for, and the tremble runs through it regardless.
    const wander = 0.036 * swing(0.62, 0) + 0.024 * swing(1.7, 17.5);

    // Gutter. Only the top of a slow channel counts, so these are separate
    // events and not a rhythm, and squaring the ramp keeps the deep part brief
    // while onset and recovery stay soft. A glazed flame guts rarely.
    const g = noise(t * 0.34 + 77.3);
    const gutter = g > 0.80 ? (g - 0.80) / 0.20 : 0;
    const dip = gutter * gutter * (0.30 + 0.20 * noise(t * 8.1 + 5.1));

    // Flare, the other half: the flame straightens and the head goes pale.
    const fl = noise(t * 0.29 + 143.9);
    const flareRamp = fl > 0.82 ? (fl - 0.82) / 0.18 : 0;
    const flare = flareRamp * flareRamp * (0.09 + 0.06 * noise(t * 6.3 + 91.2));

    // A soft exponential knee rather than a clamp. Clamped at 1, every flare
    // and a good many ordinary peaks land flat on the ceiling and sit there,
    // which pins the glass at INNER.max, the one state in which the pane's own
    // gradient stops separating from its soot. This bends the top over instead,
    // matching value and slope at the knee and asymptoting above it, so a flare
    // comes out as a peak with a shape on it.
    const KNEE = 0.90;
    const raw = 0.925 + tremble + wander + flare - dip;
    return raw <= KNEE
      ? Math.max(0, raw)
      : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));
  };
}

// ---------------------------------------------------------------------------
// surface helpers

// Round every corner of a [radius, height] polyline into a real arc and return
// it densely sampled. This is why nothing here has a hard edge: the numbers in
// M are a draughtsman's corners, and a lathe run over them directly gives cast
// iron with a machined chamfer on it. Filleted first, the same numbers give a
// moulding. The arcs get their OWN samples in proportion to how far they turn,
// rather than appearing in a fixed grid, or a short ease smears across a whole
// segment.
function fillet(points, radii, perTurn = 7) {
  const P = points.map(([r, y]) => new THREE.Vector2(r, y));
  const out = [P[0].clone()];

  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const u = new THREE.Vector2().subVectors(a, b);
    const v = new THREE.Vector2().subVectors(c, b);
    const lu = u.length(), lv = v.length();
    if (lu < 1e-6 || lv < 1e-6) continue;
    u.divideScalar(lu); v.divideScalar(lv);

    const cosT = Math.max(-0.9999, Math.min(0.9999, u.dot(v)));
    const theta = Math.acos(cosT);
    if (theta > Math.PI - 1e-3) { out.push(b.clone()); continue; }

    // Clamped so a fillet can never eat more than 45% of either neighbouring
    // segment, or the two beads on the shaft swallow each other.
    let r = Math.max(0, radii[i] || 0);
    let t = r / Math.tan(theta / 2);
    const tMax = Math.min(lu, lv) * 0.45;
    if (t > tMax) { t = tMax; r = t * Math.tan(theta / 2); }
    if (r < 1e-5) { out.push(b.clone()); continue; }

    const pA = new THREE.Vector2().copy(b).addScaledVector(u, t);
    const pC = new THREE.Vector2().copy(b).addScaledVector(v, t);
    const bis = new THREE.Vector2().addVectors(u, v).normalize();
    const centre = new THREE.Vector2().copy(b).addScaledVector(bis, r / Math.sin(theta / 2));

    const a0 = Math.atan2(pA.y - centre.y, pA.x - centre.x);
    let a1 = Math.atan2(pC.y - centre.y, pC.x - centre.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    const steps = Math.max(2, Math.ceil(perTurn * Math.abs(d) / (Math.PI / 2)));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + d * (k / steps);
      out.push(new THREE.Vector2(centre.x + r * Math.cos(ang), centre.y + r * Math.sin(ang)));
    }
  }
  out.push(P[P.length - 1].clone());

  // Split long straight runs so the shading has somewhere to put a gradient.
  // Not finer than this: a straight run of a solid of revolution has an exact
  // normal at every ring whatever the spacing, so extra rows buy nothing.
  const dense = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const gap = out[i].distanceTo(out[i - 1]);
    const n = Math.max(1, Math.ceil(gap / 0.16));
    for (let k = 1; k <= n; k++) dense.push(new THREE.Vector2().lerpVectors(out[i - 1], out[i], k / n));
  }
  return dense;
}

// An arc of an ellipse as a profile, for the globe. Angles are measured from
// the centre, -pi/2 is the bottom pole.
function arcProfile({ cy, rx, ry, a0, a1, steps = 26 }) {
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (a1 - a0) * (k / steps);
    out.push(new THREE.Vector2(rx * Math.cos(a), cy + ry * Math.sin(a)));
  }
  return out;
}

// Revolve a profile about Y.
//
// Two things it does that THREE.LatheGeometry does not, and both are why it is
// here. The seam vertex is not duplicated, so normals average across it and no
// crease runs up the post. And a profile that reaches radius zero at either end
// is welded to a single pole vertex, which closes the piece and keeps the pole
// smooth: LatheGeometry has no end caps, and a ring of coincident vertices
// shades as a facet fan.
function revolve(profile, segments = 32) {
  const rows = profile.length;
  const verts = [];
  const index = [];
  const rowStart = new Array(rows);

  const cs = [];
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    cs.push([Math.cos(a), Math.sin(a)]);
  }

  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i];
    if (r < 1e-6 && (i === 0 || i === rows - 1)) {
      rowStart[i] = -(verts.length / 3) - 1;   // negative marks a welded pole
      verts.push(0, y, 0);
      continue;
    }
    rowStart[i] = verts.length / 3;
    for (let j = 0; j < segments; j++) verts.push(cs[j][0] * r, y, cs[j][1] * r);
  }

  stitch(index, rowStart, rows, segments);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// The index pattern shared by revolve() and sweep(): quads between consecutive
// rings, fans where a ring collapses onto a welded pole.
function stitch(index, rowStart, rows, segments) {
  for (let i = 0; i < rows - 1; i++) {
    const lo = rowStart[i], hi = rowStart[i + 1];
    const loPole = lo < 0, hiPole = hi < 0;
    const l = loPole ? -lo - 1 : lo;
    const h = hiPole ? -hi - 1 : hi;
    for (let j = 0; j < segments; j++) {
      const jn = (j + 1) % segments;
      if (loPole && hiPole) continue;
      if (loPole) { index.push(l, h + j, h + jn); continue; }
      if (hiPole) { index.push(l + j, h, l + jn); continue; }
      index.push(l + j, h + j, l + jn, l + jn, h + j, h + jn);
    }
  }
}

// Sweep a circular section along a planar curve, with hemispherical ends.
//
// The curve lives in the XY plane, so the frame needs no parallel transport at
// all: the binormal is +Z for the whole length and the normal is the tangent
// turned a quarter turn in plane. That is the only reason the arm is a swept
// tube rather than a chain of capsules, and it is why it cannot twist.
//
// The ends are hemispheres rather than caps for the same reason street.js's
// glazing bars are capsules: a cap is a separate surface that can face the
// wrong way, and a hemisphere is the tube's own surface closing itself. Here
// the root hemisphere is buried in the collar and the tip one inside the cup,
// so neither is ever seen, but they close the mesh and they cost 60 triangles.
function sweep({ point, tangent, radius, steps = 26, segments = 14, capSteps = 5 }) {
  const rows = [];
  const push = (c, T, r) => {
    const n = new THREE.Vector3(-T.y, T.x, 0).normalize();
    rows.push({ c, n, b: new THREE.Vector3(0, 0, 1), r });
  };

  const P0 = point(0), T0 = tangent(0), r0 = radius(0);
  for (let k = 0; k <= capSteps; k++) {
    const phi = (k / capSteps) * (Math.PI / 2);
    push(P0.clone().addScaledVector(T0, -r0 * Math.cos(phi)), T0, r0 * Math.sin(phi));
  }
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    push(point(t), tangent(t), radius(t));
  }
  const P1 = point(1), T1 = tangent(1), r1 = radius(1);
  for (let k = capSteps; k >= 0; k--) {
    const phi = (k / capSteps) * (Math.PI / 2);
    push(P1.clone().addScaledVector(T1, r1 * Math.cos(phi)), T1, r1 * Math.sin(phi));
  }

  const verts = [];
  const index = [];
  const rowStart = new Array(rows.length);
  const cs = [];
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    cs.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i < rows.length; i++) {
    const R = rows[i];
    if (R.r < 1e-6 && (i === 0 || i === rows.length - 1)) {
      rowStart[i] = -(verts.length / 3) - 1;
      verts.push(R.c.x, R.c.y, R.c.z);
      continue;
    }
    rowStart[i] = verts.length / 3;
    for (let j = 0; j < segments; j++) {
      const [ca, sa] = cs[j];
      verts.push(
        R.c.x + R.r * (ca * R.n.x + sa * R.b.x),
        R.c.y + R.r * (ca * R.n.y + sa * R.b.y),
        R.c.z + R.r * (ca * R.n.z + sa * R.b.z),
      );
    }
  }
  stitch(index, rowStart, rows.length, segments);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// One arm: the cubic from M.arm, swept.
function armGeometry({ p0, p1, p2, p3, r0, r1, swell }) {
  const V = (p) => new THREE.Vector3(p[0], p[1], 0);
  const A = V(p0), B = V(p1), C = V(p2), D = V(p3);
  const point = (t) => {
    const u = 1 - t;
    return new THREE.Vector3()
      .addScaledVector(A, u * u * u)
      .addScaledVector(B, 3 * u * u * t)
      .addScaledVector(C, 3 * u * t * t)
      .addScaledVector(D, t * t * t);
  };
  const tangent = (t) => {
    const u = 1 - t;
    return new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().subVectors(B, A), 3 * u * u)
      .addScaledVector(new THREE.Vector3().subVectors(C, B), 6 * u * t)
      .addScaledVector(new THREE.Vector3().subVectors(D, C), 3 * t * t)
      .normalize();
  };
  // Not a monotone taper: the swell keeps the middle of the arm from reading as
  // the thin part of a cone.
  const radius = (t) => r0 + (r1 - r0) * t + swell * Math.sin(Math.PI * t);
  return sweep({ point, tangent, radius, steps: 26, segments: SEG.arm, capSteps: 5 });
}

// ---------------------------------------------------------------------------
// the ground pool, as a decal rather than as light
//
// Not laziness about the point light, it is the only way to have both. The
// heads are 2.3 up and the scene is broad daylight: a hemisphere at 1.15 and a
// key at 2.1 already put about 2.9 on the floor, so a point light has to land
// near 1.0 there before anything reads, and one that does is wildly over the
// top on ironwork half a unit from it. street.js's answer, and its machinery.
//
// The difference is that this one is baked from TWO sources, at +/- 0.62 either
// side of the axis. The profile is not a generic gradient: irradiance from a
// point at height h on the floor at lateral distance x goes as cos(theta) over
// d^decay, so the lobe is widest where the lamp is tallest. Summed, at this
// separation and this height, the two lobes come out as one pool with a long
// axis along the arms, which is what two lamps 1.24 apart actually do.
function lightPool({ radius = 3.2, height = FLAME_Y, sep = HEAD_X, decay = 1.25 } = {}) {
  if (typeof document === 'undefined') {
    const stub = new THREE.Object3D();
    stub.userData.dispose = () => {};
    return stub;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = (size - 1) / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i - c) / c) * radius;
      const z = ((j - c) / c) * radius;
      let v = 0;
      for (const sx of [-sep, sep]) {
        const lat = Math.hypot(x - sx, z);
        const d = Math.hypot(lat, height);
        v += 0.5 * (height / d) / Math.pow(d / height, decay);
      }
      // Taken to zero at the quad's edge, or the decal ends on a visible disc.
      v *= Math.max(0, 1 - Math.pow(Math.hypot(x, z) / radius, 2.2));
      const k = (j * size + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * Math.max(0, Math.min(1, v)));
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: POOL.min,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  // Above the contact patch at 0.004. The two are not fighting: the patch is
  // 0.5 across and darkens the few centimetres the foot actually touches, which
  // is ground a lamp cannot light anyway.
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  mesh.userData.dispose = () => { texture.dispose(); material.dispose(); mesh.geometry.dispose(); };
  return mesh;
}

// ---------------------------------------------------------------------------
// the glass
//
// The fountain's fake optics, by way of street.js. The one thing added here is
// aHead: both globes are a single merged mesh, and every uniform that belongs
// to a flame comes in pairs and is chosen per vertex. That is what buys two
// independently lit lanterns for one draw call.
const GLASS_OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uFlameA;
uniform vec3 uFlameB;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uInnerA;
uniform float uInnerB;
uniform float uBody;
varying vec3 vGN;
varying vec3 vGP;
varying float vGT;
varying float vGH;

// Both cameras in this project are orthographic, so this is one constant per
// frame and the branch costs nothing. The transpose trick gets a world-space
// vector out of a view-space one without an inverse, which GLSL ES 1.0 lacks.
vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands, not two. The middle one is the scene's own backdrop and it
// matters most on a SPHERE: most of a globe's silhouette reflects almost
// horizontally, so most of its rim samples the horizon and nothing else.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with glass's F0: 0.04, so a pane facing you reflects four per cent
// and its silhouette reflects nearly all of it. That gradient IS the glazing,
// and on a globe it is a bright ring right round the edge.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}
`;

const GLASS_FRAG = `
  vec3 wN = normalize(vGN);
  vec3 wV = worldViewDir(vGP);
  float ndv = clamp(abs(dot(wN, wV)), 0.0, 1.0);

  // Soot, thickest at the crown where the flame's plume sits against the glass.
  // It takes the shine off as well as darkening, which is the half that reads.
  float soot = smoothstep(0.46, 0.99, vGT) * 0.78;

  vec3 h = normalize(wV + uSunDir);
  float glint = pow(max(dot(wN, h), 0.0), uShine);
  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0) * (1.0 - soot * 0.75);
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * glint);

  // What you see THROUGH the globe: its own flame, warmest low down where the
  // flame is, plus whatever the scene puts on the glass itself. Which flame is
  // decided per vertex, so one mesh carries two lanterns.
  float inner = mix(uInnerA, uInnerB, vGH);
  vec3 flameCol = mix(uFlameA, uFlameB, vGH);
  float lit = inner * mix(1.0, 0.35, smoothstep(0.25, 1.0, vGT));
  vec3 body = (outgoingLight + flameCol * lit) * (1.0 - soot * 0.55);

  float A = clamp(uBody + soot * 0.34, 0.0, 1.0);
  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

// ---------------------------------------------------------------------------

export function createTwinLamp({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed * 2654435761 + 41);

  const group = new THREE.Group();
  // Inner group carries the seeded lean, so the caller still owns the outer
  // one's position and yaw. Same arrangement the tombstones use.
  const body = new THREE.Group();
  group.add(body);

  const disposables = [];

  // Two heads, told apart by everything that can tell them apart. The
  // asymmetry is small on purpose: it has to read as hand-hung, not as broken.
  const lean = [(rand() - 0.5) * 0.028, (rand() - 0.5) * 0.028];
  const heads = [
    { sign: 1, dy: lean[0], flick: makeFlicker({ seed: seed * 7 + 3, phase: rand() * 100, f1: 7.2, f2: 12.1 }), sway: makeNoise(seed * 13 + 5) },
    { sign: -1, dy: lean[1], flick: makeFlicker({ seed: seed * 7 + 61, phase: rand() * 100 + 37.2, f1: 6.5, f2: 13.0 }), sway: makeNoise(seed * 13 + 44) },
  ];

  // --- the ironwork --------------------------------------------------------
  // Post, bud, two arms, two cups, two crowns: eight turned or swept pieces
  // merged into one geometry. They share a material and never move relative to
  // each other, so as separate meshes they would be eight draw calls buying
  // nothing at all.
  const ironParts = [
    revolve(fillet(M.post, M.postRound), SEG.post),
    revolve(fillet(M.bud, M.budRound, 9), SEG.post),
  ];

  const cupGeo = revolve(fillet(M.cup, M.cupRound, 9), SEG.head);
  const crownGeo = revolve(fillet(M.crown, M.crownRound, 9), SEG.head);
  const armGeo = armGeometry(M.arm);

  for (const head of heads) {
    // The arm is authored going out along +x. The far one is the same tube
    // turned round, not a second cubic: two arms that are not each other's
    // mirror would read as a mistake long before they read as handmade.
    const m = new THREE.Object3D();
    m.rotation.y = head.sign > 0 ? 0 : Math.PI;
    m.position.y = head.dy;
    m.updateMatrix();
    ironParts.push(armGeo.clone().applyMatrix4(m.matrix));

    const h = new THREE.Object3D();
    h.position.set(head.sign * M.headAt[0], M.headAt[1] + head.dy, 0);
    h.updateMatrix();
    ironParts.push(cupGeo.clone().applyMatrix4(h.matrix));
    ironParts.push(crownGeo.clone().applyMatrix4(h.matrix));
    head.origin = h.position.clone();
  }
  cupGeo.dispose(); crownGeo.dispose(); armGeo.dispose();

  const ironGeo = mergeGeometries(ironParts, false);
  ironParts.forEach((g) => g.dispose());
  const ironMat = toyMaterial(IRON, { roughness: 0.58 });
  const iron = new THREE.Mesh(ironGeo, ironMat);
  iron.castShadow = true;
  iron.receiveShadow = true;
  body.add(iron);
  disposables.push(ironGeo, ironMat);

  // --- the glazing, both globes in one mesh --------------------------------
  const glassParts = [];
  for (let i = 0; i < heads.length; i++) {
    const g = revolve(arcProfile(M.globe), SEG.head);
    const pos = g.getAttribute('position');
    // aPane: 0..1 up the globe, for the soot and the flame's falloff. Written
    // as an attribute rather than derived from world Y in the shader, so
    // scaling or moving the prop cannot slide the soot along it.
    const pane = new Float32Array(pos.count);
    const headIdx = new Float32Array(pos.count);
    const y0 = M.globe.cy + M.globe.ry * Math.sin(M.globe.a0);
    const y1 = M.globe.cy + M.globe.ry * Math.sin(M.globe.a1);
    for (let k = 0; k < pos.count; k++) {
      pane[k] = (pos.getY(k) - y0) / (y1 - y0);
      headIdx[k] = i;
    }
    g.setAttribute('aPane', new THREE.BufferAttribute(pane, 1));
    g.setAttribute('aHead', new THREE.BufferAttribute(headIdx, 1));
    const m = new THREE.Object3D();
    m.position.copy(heads[i].origin);
    m.updateMatrix();
    glassParts.push(g.applyMatrix4(m.matrix));
  }
  const glassGeo = mergeGeometries(glassParts, false);
  glassParts.forEach((g) => g.dispose());

  const glassUniforms = {
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#868b95').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.2, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff4e6').convertSRGBToLinear() },
    uFlameA: { value: FLAME.clone() },
    uFlameB: { value: FLAME.clone() },
    // Over one on purpose. The fake sky is a flat gradient with no bright spots
    // of its own to find, so a physically honest fresnel leaves the globe's
    // edge barely separated from the iron behind it.
    uRimGain: { value: 1.90 },
    uGlint: { value: 1.15 },
    uShine: { value: 150.0 },
    uInnerA: { value: INNER.min },
    uInnerB: { value: INNER.min },
    // How much of the pane is pane rather than reflection. Low: this is
    // glazing, and the flame behind it has to come through.
    uBody: { value: 0.19 },
  };

  const glassMat = toyMaterial(GLASS_TINT, {
    roughness: 0.14,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPane;
attribute float aHead;
varying vec3 vGN;
varying vec3 vGP;
varying float vGT;
varying float vGH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGN = normalize(mat3(modelMatrix) * objectNormal);
  vGP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGT = aPane;
  vGH = aHead;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_OPTICS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Or three hands this material a depth program it compiled for some other
  // MeshStandardMaterial with the same parameters.
  glassMat.customProgramCacheKey = () => 'twin-lamp-glass';

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 3;
  glass.castShadow = false;   // a shadow-casting globe would black out its own lantern
  body.add(glass);
  disposables.push(glassGeo, glassMat);

  // --- the flames ----------------------------------------------------------
  // A small teardrop on a wick, one per head. Emissive rather than lit, because
  // this is light leaving a surface and it has to survive being on the shadowed
  // side. Two meshes and not one: they sway independently, which is half of
  // what stops the pair reading as a single object blinking.
  const flameGeo = revolve(fillet([
    [0.000, 0.000],
    [0.052, 0.020],
    [0.062, 0.078],
    [0.047, 0.150],
    [0.020, 0.210],
    [0.000, 0.238],
  ], [0.000, 0.022, 0.038, 0.045, 0.035, 0.000], 8), 22);
  disposables.push(flameGeo);

  // The bloom. A sphere with an additive falloff off its own normal, which on a
  // sphere is a soft radial blob and costs one power function. Without it a
  // globe at this size reads as a grey ball with a speck in it.
  const haloGeo = new THREE.SphereGeometry(0.108, 20, 14);
  disposables.push(haloGeo);
  const haloPatch = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHN;\nvarying vec3 vHP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vHN = normalize(mat3(modelMatrix) * normal);
  vHP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHN;
varying vec3 vHP;`)
      .replace('#include <opaque_fragment>', `
  vec3 vd = isOrthographic
    ? normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z))
    : normalize(cameraPosition - vHP);
  float d = clamp(dot(normalize(vHN), vd), 0.0, 1.0);
  gl_FragColor = vec4(outgoingLight, diffuseColor.a * pow(d, 2.4));`);
  };

  for (const head of heads) {
    const fm = new THREE.MeshStandardMaterial({
      color: 0x110800,
      emissive: PLATE_FLAME.clone(),
      emissiveIntensity: WICK.min,
      roughness: 1.0,
      metalness: 0.0,
    });
    const flame = new THREE.Mesh(flameGeo, fm);
    flame.position.copy(head.origin).add(new THREE.Vector3(0, M.wickY, 0));
    body.add(flame);
    disposables.push(fm);

    const hm = new THREE.MeshBasicMaterial({
      color: BLOOM_FLAME.clone(),
      transparent: true,
      opacity: HALO.min,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    hm.onBeforeCompile = haloPatch;
    hm.customProgramCacheKey = () => 'twin-lamp-halo';
    const halo = new THREE.Mesh(haloGeo, hm);
    halo.position.copy(head.origin).add(new THREE.Vector3(0, M.flameY, 0));
    halo.renderOrder = 2;
    body.add(halo);
    disposables.push(hm);

    head.flame = flame;
    head.halo = halo;
    head.flameMat = fm;
    head.haloMat = hm;
    head.rest = halo.position.clone();
  }

  // --- the one light -------------------------------------------------------
  // See THE ONE LIGHT at the top. On the axis, level with both flames, in the
  // gap the shortened bud leaves for it.
  const light = new THREE.PointLight(FLAME.clone(), LAMP.min, 11.0, 1.15);
  light.position.set(0, FLAME_Y, 0);
  light.castShadow = false;
  body.add(light);

  // The contact patch. The key light comes in at an angle, so the post's own
  // cast shadow lands off to one side and nothing darkens the ground where the
  // foot actually meets it.
  const patch = contactShadow({ radius: 0.50, opacity: 0.40, softness: 0.5 });
  body.add(patch);

  // The pool is elongated along the arms, so unlike the street lamp's it cannot
  // go on the outer group and ignore the yaw. It gets a group of its own that
  // carries the yaw and nothing else: the seeded lean must not reach it, or one
  // edge of a 6.4 unit quad cuts into the ground plane.
  const poolPivot = new THREE.Group();
  const pool = lightPool();
  const poolMat = pool.material || null;
  poolPivot.add(pool);
  group.add(poolPivot);

  // A hand-set post never stands quite true. Smaller than a headstone's,
  // because this one is 2.5 tall and the same lean that flatters a slab would
  // put a globe 50mm off where its partner is.
  body.rotation.z = (rand() - 0.5) * 0.020;
  body.rotation.x = (rand() - 0.5) * 0.016;
  body.rotation.y = rand() * Math.PI * 2;
  poolPivot.rotation.y = body.rotation.y;
  // Bedded four millimetres: a 0.68 foot tilted by ten milliradians lifts its
  // far edge three millimetres clear of the floor, and a prop that hovers is
  // the one thing a contact patch cannot fix.
  body.position.y = -0.004;

  group.scale.setScalar(scale);
  // PointLight.distance is in world units and three does not scale it by the
  // object's matrix, and its intensity is candela against a distance that grows
  // with the prop. So both are corrected, or a lamp at scale 2 lights a quarter
  // as much ground as one at scale 1.
  const lightGain = scale * scale;
  light.distance = 11.0 * scale;

  // Read by the lab harness to plot the flicker without a screenshot. Nothing
  // in the prop reads it.
  group.userData.flame = { level: 1, a: 1, b: 1 };

  const emberMix = new THREE.Color();
  const flameMix = new THREE.Color();

  return {
    group,

    update(time) {
      let sum = 0;
      for (let i = 0; i < heads.length; i++) {
        const head = heads[i];
        const level = head.flick(time);
        sum += level;

        const at = (range) => range.min + (range.max - range.min) * level;
        head.flameMat.emissiveIntensity = at(WICK);
        head.haloMat.opacity = at(HALO);

        // Colour, levered about the level's mean so ember is reachable inside a
        // real gutter rather than only inside a blackout.
        const k = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
        head.flameMat.emissive.copy(PLATE_EMBER).lerp(PLATE_FLAME, k);
        head.haloMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, k);

        const uInner = i === 0 ? glassUniforms.uInnerA : glassUniforms.uInnerB;
        const uCol = i === 0 ? glassUniforms.uFlameA : glassUniforms.uFlameB;
        uInner.value = at(INNER);
        uCol.value.copy(EMBER).lerp(FLAME, k);

        // The flame physically moves while it does the rest, which is the
        // channel that stops a head reading as a bulb on a dimmer. Across is a
        // carrier of its own, so the tip whips at about the rate the brightness
        // trembles at instead of drifting with the wander. Each head's carrier
        // is dragged by its OWN noise, so the two never sway together.
        const n = head.sway;
        const sx = 0.011 * Math.sin(Math.PI * 2 * (time * 3.1 + n(time * 0.7 + 31.0) * 4));
        const sz = 0.011 * Math.sin(Math.PI * 2 * (time * 2.6 + n(time * 0.9 + 63.0) * 4));
        head.flame.position.set(head.origin.x + sx, head.origin.y + M.wickY, head.origin.z + sz);
        head.flame.scale.set(1, 0.80 + 0.34 * level, 1);
        head.halo.position.set(head.origin.x + sx * 0.6, head.rest.y, head.origin.z + sz * 0.6);

        head.level = level;
      }

      const mean = sum / heads.length;

      // The one light takes the mean, and it LEANS. The x offset is the two
      // levels' difference carried a third of the way to a head, so when the
      // left globe flares the pool slides left and the fixture stops reading as
      // a thing of its own sitting between them. Bounded, because a light that
      // travels a whole half-width is a light that has visibly left the lamp.
      const tilt = Math.max(-0.34, Math.min(0.34, (heads[0].level - heads[1].level) * 3.2));
      light.intensity = LAMP.min + (LAMP.max - LAMP.min) * mean * lightGain;
      light.position.set(tilt * HEAD_X, FLAME_Y + 0.012 * (mean - 0.9), 0);

      const km = Math.min(1, Math.max(0, HUE_MID + (mean - HUE_MID) * HUE_GAIN));
      light.color.copy(EMBER).lerp(FLAME, km);
      if (poolMat) {
        poolMat.opacity = POOL.min + (POOL.max - POOL.min) * mean;
        poolMat.color.copy(emberMix.copy(BLOOM_EMBER).lerp(flameMix.copy(BLOOM_FLAME), km));
      }

      group.userData.flame.level = mean;
      group.userData.flame.a = heads[0].level;
      group.userData.flame.b = heads[1].level;
    },

    dispose() {
      for (const d of disposables) d.dispose();
      patch.userData.dispose?.();
      pool.userData.dispose?.();
      light.dispose?.();
    },
  };
}

export default createTwinLamp;
