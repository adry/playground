import * as THREE from 'three';
import { Profile, createSink, sinkToGeometry, latheInto } from './lathe.js';
import { VEIN_TINT } from './marble.js';

// The marble. One profile, run from the axis at the bottom of the plinth all
// the way round to the axis at the tip of the finial, with an angular
// modulation that carves the gadroons, the scallops, the hand-made waviness and
// the chips out of the rim.
//
// Numbers are authored against the ghost, which stands about 1.6 units with its
// hem near 0.2 and which the headstones already reach four fifths of. The
// fountain finishes just under 1.9 and its bottom basin is 1.5 across: it is
// the piece the rest of the yard is arranged around, so it is taller than a
// headstone and much wider than anything else in the set.

// Lobe counts. The bottom basin's gadroons and the two scalloped rims are each
// a single N-fold feature that runs from the underside up over the lip, so the
// count is shared between the swept wall and the rim above it -- a bowl whose
// underside lobes did not line up with its own scallops would read as two
// carvings fighting.
const GADROONS = 12; // fat egg lobes round the bottom basin
const BOWL_LOBES = 9; // middle bowl, and therefore nine falling strands
const DISH_LOBES = 8; // top dish, and eight strands

// Where the water sits in each bowl, and how wide the disc is. Each radius is a
// hair inside the wall at that height: the disc is a separate mesh and pushing
// it out to meet the stone exactly would z-fight along the whole waterline.
export const TIERS = {
  basin: { y: 0.906, radius: 0.622 },
  bowl: { y: 1.410, radius: 0.344 },
  dish: { y: 1.678, radius: 0.196 },
};

export const GRAVITY = 3.4;

// The chips knocked out of the bottom basin's rim. Angles are fixed rather than
// seeded: three is few enough that a bad draw is a real risk, and these three
// are placed so one faces the scene camera, one is on the shaded side and one
// sits near the silhouette where it breaks the rim's outline.
const CHIPS = [
  { theta: -0.62, width: 0.20, depth: 0.052 },
  { theta: 1.94, width: 0.13, depth: 0.036 },
  { theta: 3.41, width: 0.17, depth: 0.044 },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A ring of lobes. `sharp` under 1 widens the crest and narrows the groove,
// which is what makes a gadroon read as a row of fat eggs rather than a
// sine wave; the same knob the pumpkin's ribs use, for the same reason.
function lobes(theta, count, phase, sharp) {
  const c = 0.5 + 0.5 * Math.cos(count * (theta - phase));
  return Math.pow(c, sharp);
}

// A window over one tagged run of the profile, so a carving can start and stop
// somewhere along a sweep instead of at a joint.
function window01(u, a0, a1, b0, b1) {
  return smoothstep(a0, a1, u) * (1 - smoothstep(b0, b1, u));
}

export function buildProfile() {
  const P = new Profile();

  // --- plinth: two rounded steps ------------------------------------------
  const step = (R, y0, y1, e, n) => {
    P.lineTo(R - e, y0, n);
    P.arc(R - e, y0 + e, e, -Math.PI / 2, 0, 4);
    P.lineTo(R, y1 - e, 2);
    P.arc(R - e, y1 - e, e, 0, Math.PI / 2, 4);
  };
  P.setTag('plinth');
  P.moveTo(0, 0);
  step(0.575, 0.000, 0.105, 0.028, 5);
  step(0.478, 0.105, 0.205, 0.026, 2);

  // --- turned baluster foot ------------------------------------------------
  P.setTag('foot');
  P.lineTo(0.262, 0.205, 2);
  P.curve([[0.212, 0.236], [0.190, 0.268]], 5);
  P.curve([[0.248, 0.300], [0.202, 0.336]], 7); // collar ring
  P.curve([[0.258, 0.378], [0.294, 0.428], [0.270, 0.474]], 12); // belly
  P.curve([[0.210, 0.500], [0.202, 0.520]], 5);

  // --- bottom basin --------------------------------------------------------
  // Steeper than a saucer on purpose. The gadroons are the point of this wall
  // and a wall that leans out past the camera's own elevation cannot be seen at
  // all: the first pass swept the underside out almost flat, and every lobe on
  // it was hidden under the rim's own overhang from the angle the scene is
  // actually viewed from. This one climbs at about forty degrees, so the whole
  // ring of lobes faces the camera.
  P.setTag('basin-out');
  P.curve([[0.290, 0.548], [0.410, 0.588], [0.548, 0.660], [0.664, 0.760], [0.726, 0.848], [0.744, 0.896]], 24);
  P.setTag('basin-rim');
  P.arc(0.704, 0.930, 0.0525, -0.698, Math.PI, 14);
  P.setTag('basin-in');
  P.curve([[0.630, 0.906], [0.556, 0.884], [0.400, 0.874], [0.225, 0.872]], 12);

  // --- middle baluster -----------------------------------------------------
  P.setTag('mid-stem');
  P.curve([[0.165, 0.876], [0.130, 0.912], [0.120, 0.956]], 6);
  P.curve([[0.154, 0.988], [0.122, 1.020]], 6); // collar ring
  P.curve([[0.115, 1.076], [0.124, 1.126]], 6);

  // --- middle bowl ---------------------------------------------------------
  P.setTag('bowl-out');
  P.curve([[0.164, 1.162], [0.248, 1.216], [0.348, 1.298], [0.414, 1.368], [0.432, 1.408]], 18);
  P.setTag('bowl-rim');
  P.arc(0.402, 1.428, 0.036, -0.588, Math.PI, 11);
  P.setTag('bowl-in');
  P.curve([[0.350, 1.412], [0.292, 1.398], [0.162, 1.394]], 9);

  // --- top baluster --------------------------------------------------------
  P.setTag('top-stem');
  P.curve([[0.107, 1.398], [0.090, 1.428], [0.086, 1.468]], 6);
  P.curve([[0.112, 1.492], [0.088, 1.518]], 5); // collar ring

  // --- top dish ------------------------------------------------------------
  P.setTag('dish-out');
  P.curve([[0.117, 1.548], [0.178, 1.597], [0.234, 1.646], [0.251, 1.677]], 12);
  P.setTag('dish-rim');
  P.arc(0.235, 1.692, 0.0215, -0.733, Math.PI, 9);
  P.setTag('dish-in');
  P.curve([[0.200, 1.680], [0.152, 1.670], [0.077, 1.668]], 8);

  // --- finial --------------------------------------------------------------
  // The reference calls this a bud with two little side lobes and a rounded
  // top. On a piece that is turned on one axis all the way up, two side lobes
  // seen square-on is what a collar ring looks like, so that is what this is:
  // a flared collar under a teardrop bud. Modelling literally two lobes would
  // have been the only asymmetric thing on the whole fountain.
  P.setTag('finial');
  P.curve([[0.052, 1.676], [0.044, 1.704]], 5);
  P.curve([[0.076, 1.726], [0.088, 1.750], [0.060, 1.772]], 8); // collar
  P.curve([[0.048, 1.790], [0.066, 1.824], [0.074, 1.864], [0.060, 1.902]], 12); // bud
  P.arc(0.0, 1.902, 0.060, 0, Math.PI / 2, 7);

  return P.build();
}

// How much a sample belongs to each carving. Returned as one object per call so
// the displacement and the tint agree by construction: the weathering is meant
// to be strongest exactly where the carving is deepest.
function carving(sample) {
  const { tag, u } = sample;
  let gad = 0;
  let bowl = 0;
  let dish = 0;
  let rim = 0; // proximity to a lip, for the weathering

  if (tag === 'basin-out') gad = window01(u, 0.06, 0.28, 0.74, 0.98);
  if (tag === 'basin-out') rim = smoothstep(0.72, 1.0, u) * 0.75;
  if (tag === 'basin-rim') rim = 1;
  if (tag === 'basin-in') rim = 1 - smoothstep(0.0, 0.45, u);

  if (tag === 'bowl-out') {
    bowl = smoothstep(0.06, 0.55, u);
    rim = smoothstep(0.60, 1.0, u) * 0.8;
  }
  if (tag === 'bowl-rim') { bowl = 1; rim = 1; }
  if (tag === 'bowl-in') {
    bowl = 1 - smoothstep(0.0, 0.55, u);
    rim = 1 - smoothstep(0.0, 0.5, u);
  }

  if (tag === 'dish-out') {
    dish = smoothstep(0.30, 0.85, u);
    rim = smoothstep(0.65, 1.0, u) * 0.8;
  }
  if (tag === 'dish-rim') { dish = 1; rim = 1; }
  if (tag === 'dish-in') {
    dish = 1 - smoothstep(0.0, 0.55, u);
    rim = 1 - smoothstep(0.0, 0.5, u);
  }

  return { gad, bowl, dish, rim };
}

// How deep a chip bites at this angle and this point along the profile. A
// smooth scoop rather than a fracture: the house style has no faceting in it,
// and a chip in a soft vinyl toy is a dent.
function chipBite(sample, theta) {
  const { tag, u } = sample;
  let prof = 0;
  if (tag === 'basin-rim') prof = 1;
  else if (tag === 'basin-out') prof = smoothstep(0.86, 1.0, u);
  else if (tag === 'basin-in') prof = 1 - smoothstep(0.0, 0.35, u);
  if (prof <= 0) return 0;

  let bite = 0;
  for (const c of CHIPS) {
    let d = theta - c.theta;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const t = d / c.width;
    bite += c.depth * Math.exp(-t * t) * prof;
  }
  return bite;
}

export function buildBodyGeometry({ segments = 84 } = {}) {
  const profile = buildProfile();

  const displace = (sample, theta) => {
    const w = carving(sample);
    let dr = 0;
    let dy = 0;

    if (w.gad > 0) dr += 0.072 * w.gad * (lobes(theta, GADROONS, 0, 0.55) - 0.45);

    if (w.bowl > 0) {
      const s = lobes(theta, BOWL_LOBES, 0, 0.62);
      dr += 0.040 * w.bowl * (s - 0.42);
      // The rim dips where it bulges, so the lowest point of the scallop is
      // also its outermost. That is not decoration: it is where each strand
      // hangs from, and water leaving a lip that dips inboard of its widest
      // point would run back down the outside of the bowl.
      dy -= 0.016 * w.bowl * s;
    }
    if (w.dish > 0) {
      const s = lobes(theta, DISH_LOBES, 0, 0.62);
      dr += 0.024 * w.dish * (s - 0.42);
      dy -= 0.011 * w.dish * s;
    }

    // The bottom basin's rim is a plain torus, but a hand-made one: a slow
    // wander in both radius and height, big enough to see on the silhouette and
    // small enough that it never reads as a second carving.
    if (sample.tag === 'basin-rim' || sample.tag === 'basin-out' || sample.tag === 'basin-in') {
      const near = sample.tag === 'basin-rim' ? 1
        : sample.tag === 'basin-out' ? smoothstep(0.55, 1.0, sample.u)
          : 1 - smoothstep(0.0, 0.5, sample.u);
      dr += near * (0.0125 * Math.sin(3 * theta + 0.7) + 0.0068 * Math.sin(5 * theta + 2.1));
      dy -= near * 0.0075 * Math.sin(4 * theta + 1.3);
    }

    const bite = chipBite(sample, theta);
    dr -= bite;
    dy -= bite * 0.62;

    return [dr, dy];
  };

  // Weathering. Grey-brown veining strongest near the rims and around the
  // chips, and a wash of ground grime up the plinth. This rides on a vertex
  // colour rather than on the map because it is a fact about where you are on
  // the object, and the map tiles.
  const tint = (sample, theta) => {
    const w = carving(sample);
    let a = w.rim * 0.55;
    const bite = chipBite(sample, theta);
    a = Math.min(1, a + Math.min(1, bite / 0.03) * 0.5);
    if (sample.tag === 'plinth') a = Math.max(a, 0.22 * (1 - smoothstep(0.0, 0.72, sample.u)));
    // Bowl interiors sit wet all day and never quite dry out.
    if (sample.tag === 'basin-in' || sample.tag === 'bowl-in' || sample.tag === 'dish-in') {
      a = Math.max(a, 0.30);
    }
    return [
      1 + (VEIN_TINT.r - 1) * a,
      1 + (VEIN_TINT.g - 1) * a,
      1 + (VEIN_TINT.b - 1) * a,
    ];
  };

  const sink = createSink();
  latheInto(sink, { profile, segments, displace, tint, uRepeat: 2, vScale: 0.62 });
  const geometry = sinkToGeometry(sink);

  return { geometry, profile, displace };
}

// Where a strand leaves a rim, found on the surface that actually got built
// rather than guessed from the profile: the outermost point of the scallop at
// this angle, dropped to the underside of the lip, which is where a stream
// running over a rounded edge lets go.
export function findSpout(profile, displace, tag, theta) {
  let best = null;
  for (const s of profile) {
    if (s.tag !== tag) continue;
    const [dr, dy] = displace(s, theta);
    const r = s.r + dr;
    if (!best || r > best.r) best = { r, y: s.y + dy };
  }
  return best;
}

// Ballistic flight time from y0 down to yTarget with a signed vertical speed.
// One formula for both cases: a strand leaving a lip (vy negative) and a jet
// thrown up out of the finial (vy positive).
export function flightTime(y0, vy, yTarget, g = GRAVITY) {
  const drop = y0 - yTarget;
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * drop))) / g;
}

export { GADROONS, BOWL_LOBES, DISH_LOBES };
