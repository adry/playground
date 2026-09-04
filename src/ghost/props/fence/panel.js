import * as THREE from 'three';
import F from './metrics.js';
import { board, pointedTop, rng, woodMaterial } from './wood.js';

// One intact fence panel: seven pickets, two rails behind them, a post at each
// end. Origin at the centre of the panel's footprint, on the ground; the run
// goes along local X and the fence faces local +Z.
//
// The piece exists to be repeated. The user wants to lay a gated path out of
// these, so "does one panel look good" is the easy half of the job and "do two
// panels a length apart look like one fence" is the half that decides whether
// the prop is usable at all. Everything below that looks over-careful about
// where a number goes is careful about that.
//
// Three rules fall out of tiling, and they are why this file is shaped the way
// it is:
//
//   1. The picket rhythm is pitch = length / pickets, with the first picket a
//      half pitch in. Then the gap across a panel joint is the same as every
//      gap inside a panel, without the call site knowing anything.
//   2. The rails run the full length and their warp is zero at both ends, so a
//      rail end always sits exactly on the boundary plane and butts its
//      neighbour. The joint then hides inside the shared post.
//   3. The end posts straddle the boundary and are, by default, bit-identical
//      between neighbours. See POST_SEED below; that one is worth reading
//      before changing anything about the posts.
//
// The breakage agent builds damaged variants from picketGeometry, postGeometry,
// railGeometry, PANEL_LAYOUT and panelParts rather than reinventing them, so a
// gap-toothed panel still lines up with an intact one.

// ---------------------------------------------------------------------------
// numbers that are not in metrics.js yet
//
// Flagged in one block rather than folded in silently, because metrics.js is
// the single place dimensions live and this file does not own it. If any of
// these survive review they belong there.
const LOCAL = {
  // How far a board bows over its own length, in world units. board() wants it
  // in world units rather than as a fraction, and it has to stay small: at
  // 0.02 on a picket the fence stopped reading as weathered and started
  // reading as melted.
  warp: { picket: 0.005, post: 0.004, rail: 0.011 },

  // Corner rounding as a fraction of half-thickness. metrics.js has post.round
  // (0.34, "corners knocked well off") but nothing for the thinner stock. The
  // same fraction on a 42mm picket is a much smaller radius in absolute terms,
  // which is exactly what the reference shows: the posts read chamfered, the
  // pickets only read soft.
  round: { picket: 0.34, rail: 0.34 },

  // The last bit of the post's height eases in, so the squared-off top has its
  // rim knocked off too and catches a highlight. Fraction of the height, and
  // how much of the half-section it takes away.
  postTop: { ease: 0.055, take: 0.28 },

  // Boards are set a hair into the dirt. Without it the bottom end cap is
  // coplanar with the floor and a bright seam flickers under every picket.
  sink: 0.012,

  // Grain. Streaks per world unit across the face, how far a streak pulls the
  // pale toward the shade, and how much whole-board tint drift is allowed.
  grain: { frequency: 26, depth: 0.62, tint: 0.15 },

  // Not every picket leans. "Several lean a degree or two" in the reference,
  // not all of them; a row where every board is off true reads as a cartoon
  // fence rather than a real one. The rest still get a fraction of the jitter
  // so nothing is dead straight.
  leanChance: 0.45,
  leanFloor: 0.22,
};

// The shape seed both end posts are built from, unless the caller overrides it.
//
// A post sits ON the boundary, so panel A's right post and panel B's left post
// occupy the same world space. Two posts there with different jitter is a
// visibly doubled post, and it is the one way this prop can fail loudly. Two
// posts there with IDENTICAL geometry and identical world transforms is fine:
// the depth values are bit-identical, the depth test resolves them the same way
// for every fragment, and nothing z-fights.
//
// The cost is that a long run repeats one post. If that ever reads as stamped,
// the fix is postSeeds on createFencePanel: a caller laying out a path knows
// each panel's index and can pass [boundary(i), boundary(i + 1)], which varies
// the posts while keeping every shared pair matched. Do not instead derive the
// post from the panel seed. That is the bug this constant exists to prevent.
const POST_SEED = 8317;

const L = F.panel.length;

// Depth layout. The pickets define the face of the panel at z = 0, the rails
// hang directly behind them, and the post is centred on the whole assembly's
// depth rather than on the pickets.
//
// That last one is not a style choice. The assembly runs from the picket's
// front face at +thickness/2 back to the rail's back face at
// -(thickness/2 + depth), whose midpoint is exactly -depth/2. Put the post
// there and its 0.155 section brackets the 0.117 of assembly with room to
// spare, so it stands proud in front of the pickets AND covers the rail joint
// from behind. Centred on the pickets instead, the rails poked out of the back
// of every post and the joint between two panels was visible from behind,
// which is the view the ghost gives you when it walks past.
const PICKET_Z = 0;
const RAIL_Z = -(F.picket.thickness / 2 + F.rail.depth / 2);
const POST_Z = -F.rail.depth / 2;

// ---------------------------------------------------------------------------
// grain

// Linear once, at module load. These feed a vertex colour attribute, and the
// renderer works in linear space, so converting per vertex would be both wrong
// twice and slow.
const PALE = new THREE.Color(F.wood.pale).convertSRGBToLinear();
const SHADE = new THREE.Color(F.wood.shade).convertSRGBToLinear();

// Soft dark streaks running the length of a board, written into the geometry as
// vertex colours.
//
// Vertex colours rather than a texture, for the same reason the pumpkin carries
// its whole hue that way: there is no UV set on a lofted board, the grain is
// low frequency, and a texture would mean authoring, atlasing and filtering an
// image to say something three sines already say. The mesh is dense enough
// along the length that a streak is smooth; across the width it is only twelve
// vertices, which is why the streak frequency is tuned to three or four bands
// on a picket and not thirty. Ask for more than the mesh can carry and the
// grain aliases into a stripe pattern that crawls when the camera moves.
//
// Called on the board in its own build orientation, length along +Y, so a
// streak that is constant in y runs the length of the board by construction.
function paintGrain(geo, rand, { groundEnd = true } = {}) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();

  const p0 = rand() * Math.PI * 2;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const pw = rand() * Math.PI * 2;

  // A whole-board tint. Weathered stock is not one colour across a fence, and a
  // couple of boards sitting a shade greyer than their neighbours is most of
  // what stops a row of pickets reading as one extrusion.
  const tint = rand() * LOCAL.grain.tint;
  const f = LOCAL.grain.frequency * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // The coordinate ACROSS the board. z is folded in at half weight so a
    // streak carries on round the corner onto the narrow face instead of
    // stopping dead at the arris; the small y term lets a streak wander a
    // little down the board, because a perfectly parallel one reads as print.
    const u = x + 0.5 * z + 0.02 * Math.sin(y * 5.5 + pw);

    let s = Math.sin(u * f + p0) * 0.62
          + Math.sin(u * f * 2.13 + p1) * 0.26
          + Math.sin(u * f * 0.41 + p2) * 0.50;
    s /= 1.38;

    // Only the positive half becomes a streak, and it is raised to a power so
    // the dark lands as narrow lines. Grain spread evenly over half the board
    // is camouflage, not timber.
    const streak = Math.pow(Math.max(0, s), 2.4) * (0.62 + 0.38 * Math.sin(y * 3.1 + p1));

    let k = tint + streak * LOCAL.grain.depth;
    // The first centimetre out of the dirt is grubbier than the rest. Rails
    // never touch the ground, so they opt out; on them y = 0 is simply one end
    // of the board and this would darken it for no reason.
    if (groundEnd) k += Math.max(0, 1 - y / 0.09) * 0.20;

    c.copy(PALE).lerp(SHADE, Math.min(1, k));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// the three pieces
//
// Each comes back at rest at its own origin, and PANEL_LAYOUT says where it
// goes. Pickets and posts stand on y = 0 and grow up +Y; a rail is already
// lying along X, centred on the origin, because a rail is never used any other
// way and making every caller remember the same rotation is how the two of them
// end up disagreeing.
//
// `rand` is a stream from wood.js's rng(), not Math.random. Pass one and the
// same board comes back every time, which is the whole reason panelParts hands
// out a seed per part.

export function picketGeometry({
  rand = rng(1),
  height = F.picket.height,
  width = F.picket.width,
} = {}) {
  const geo = board({
    length: height,
    width,
    thickness: F.picket.thickness,
    round: LOCAL.round.picket,
    // Bowing out of the fence plane rather than along it. A picket is nailed to
    // two rails so it cannot bow sideways much, and a sideways bow would also
    // eat unevenly into the gaps, which is the one irregularity that reads as a
    // mistake instead of as age.
    warp: (rand() - 0.5) * 2 * LOCAL.warp.picket,
    warpAxis: 'z',
    profile: pointedTop(height, width),
    // Enough rings along the length that the warp is a curve and the grain has
    // somewhere to live. The point itself is the top two or three.
    segments: 18,
    ring: 12,
  });
  return paintGrain(geo, rand);
}

export function postGeometry({ rand = rng(POST_SEED) } = {}) {
  const ease = LOCAL.postTop.ease;
  const take = LOCAL.postTop.take;
  // Squared off, not pointed, with the rim eased. A flat cap straight onto the
  // sides gives a 90 degree edge that goes black under the key light and makes
  // the post read as a cardboard tube; a quarter round over the last few per
  // cent of the height is what puts the highlight along the top in the
  // reference. The vertical arrises are already handled by post.round.
  const profile = (t) => {
    if (t <= 1 - ease) return [1, 1];
    const k = (t - (1 - ease)) / ease;
    const s = 1 - take * (1 - Math.sqrt(Math.max(0, 1 - k * k)));
    return [s, s];
  };
  const geo = board({
    length: F.post.height,
    width: F.post.width,
    thickness: F.post.thickness,
    round: F.post.round,
    warp: (rand() - 0.5) * 2 * LOCAL.warp.post,
    warpAxis: 'z',
    profile,
    // High, and deliberately so: the eased top lives in the last 5.5% of the
    // length, and board() samples t evenly. At 16 segments the whole ease fell
    // between two rings and the post came back with a flat top again.
    segments: 44,
    ring: 16,
  });
  return paintGrain(geo, rand);
}

export function railGeometry({ rand = rng(3), length = F.panel.length } = {}) {
  // metrics gives the rail a thickness and a depth. Depth is the Z one, how far
  // it stands back off the pickets; thickness is the vertical one. That way
  // round it is a board laid flat, which is how a rail is fitted and which is
  // why depth is the larger of the two.
  const geo = board({
    length,
    width: F.rail.thickness,
    thickness: F.rail.depth,
    round: LOCAL.round.rail,
    // Sag, not bow. board()'s warp is zero at both ends by construction, which
    // is what lets a rail end sit exactly on the panel boundary and butt its
    // neighbour; the middle is free to droop. Signed positive on purpose: after
    // the rotation below, +X maps to -Y, so a positive warp sags downward. A
    // rail that bellies upward looks sprung, not old.
    warp: (0.35 + 0.65 * rand()) * LOCAL.warp.rail,
    warpAxis: 'x',
    segments: 24,
    ring: 10,
  });
  paintGrain(geo, rand, { groundEnd: false });
  // Painted first, then turned: the grain has to be computed while the length
  // still runs along +Y or the streaks come out crossing the board.
  geo.rotateZ(-Math.PI / 2);
  geo.translate(-length / 2, 0, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// layout

// Where every piece of an untouched panel sits, before any per-seed jitter.
// Exported so a damaged panel can be laid out against the same numbers and
// still line up with an intact neighbour.
export const PANEL_LAYOUT = {
  length: L,
  // Half a pitch in at each end, a full pitch between. This is the tiling rule:
  // the gap across a panel joint comes out identical to the gaps inside one.
  pitch: L / F.panel.pickets,
  height: F.post.height,
  z: { picket: PICKET_Z, rail: RAIL_Z, post: POST_Z },
  posts: [
    { end: -1, x: -L / 2, y: 0, z: POST_Z },
    { end: 1, x: L / 2, y: 0, z: POST_Z },
  ],
  pickets: Array.from({ length: F.panel.pickets }, (_, i) => ({
    index: i,
    x: -L / 2 + (i + 0.5) * (L / F.panel.pickets),
    y: 0,
    z: PICKET_Z,
    width: F.picket.width,
    height: F.picket.height,
  })),
  rails: F.rail.at.map((at, i) => ({
    index: i,
    x: 0,
    y: at * F.picket.height,
    z: RAIL_Z,
    length: L,
  })),
};

// PANEL_LAYOUT with one seed's variation applied, and a geometry seed per part.
//
// createFencePanel builds from exactly this, so a caller that wants a damaged
// panel to match an intact one calls panelParts with the same seed and gets the
// same boards in the same places, then leaves out or replaces the ones it is
// breaking. Nothing has to be kept in step by hand.
export function panelParts({ seed = 1, postSeeds = [POST_SEED, POST_SEED] } = {}) {
  const rand = rng(seed);
  const j = F.picket.jitter;
  const sym = () => rand() * 2 - 1;
  // A seed per board, drawn from the panel's stream. Storing the seed rather
  // than the finished geometry is what lets the breakage agent rebuild one
  // board without replaying the whole panel.
  const geoSeed = () => 1 + Math.floor(rand() * 0xffffff);

  const pickets = PANEL_LAYOUT.pickets.map((p) => {
    const width = p.width * (1 + sym() * j.width);
    const height = p.height * (1 + sym() * j.height);
    const leans = rand() < LOCAL.leanChance;
    const lean = sym() * j.lean * (leans ? 1 : LOCAL.leanFloor);
    const twist = sym() * j.twist;
    // Each board is knocked into the dirt by its own amount. The tops are
    // already uneven from the height jitter; the bottoms being uneven too is
    // what stops the row reading as a set that was cut from one sheet.
    const sink = LOCAL.sink * (0.35 + rand());
    return { ...p, width, height, lean, twist, y: -sink, seed: geoSeed() };
  });

  const rails = PANEL_LAYOUT.rails.map((r) => ({ ...r, seed: geoSeed() }));

  // Posts do NOT draw from the panel's stream. See POST_SEED.
  const posts = PANEL_LAYOUT.posts.map((p, i) => ({
    ...p,
    y: -LOCAL.sink * 0.8,
    seed: postSeeds[i] ?? POST_SEED,
  }));

  return { pickets, rails, posts };
}

// ---------------------------------------------------------------------------
// the panel

export function createFencePanel({ seed = 1, scale = 1, postSeeds } = {}) {
  const parts = panelParts(postSeeds ? { seed, postSeeds } : { seed });

  // One material for the whole panel. The colour lives in the vertex
  // attribute, so the material's own colour has to be white or it would
  // multiply the grain a second time and the fence would come out muddy. Same
  // arrangement as the pumpkin's shell.
  const material = woodMaterial({ color: new THREE.Color(0xffffff), vertexColors: true });

  const group = new THREE.Group();
  const geometries = new Set();

  const add = (geo, part, { lean = 0, twist = 0 } = {}) => {
    geometries.add(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(part.x, part.y, part.z);
    mesh.rotation.z = lean;
    mesh.rotation.y = twist;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Rails first, so the back of the fence is built before the things that hide
  // it. Nothing depends on the order; it just matches the way the piece reads.
  for (const r of parts.rails) {
    add(railGeometry({ rand: rng(r.seed), length: r.length }), r);
  }

  for (const p of parts.pickets) {
    // The lean pivots about the picket's foot, which is where a leaning picket
    // actually pivots: it is still nailed down, it has just gone out of true.
    add(picketGeometry({ rand: rng(p.seed), height: p.height, width: p.width }), p, {
      lean: p.lean,
      twist: p.twist,
    });
  }

  // Two posts sharing one geometry when they share a seed, which is the
  // default. Both ends of a run then match, and so do the two halves of every
  // shared post between panels.
  const postGeos = new Map();
  for (const p of parts.posts) {
    if (!postGeos.has(p.seed)) postGeos.set(p.seed, postGeometry({ rand: rng(p.seed) }));
    add(postGeos.get(p.seed), p);
  }

  group.scale.setScalar(scale);

  // No painted contact patch under this one, for the reason tombstones.js
  // spells out at length: a patch laid flat on the floor is the same on the
  // side facing the key light as on the side away from it, so it reads as a
  // stain rather than a shadow. A fence is worse than a tombstone for it,
  // because a run of them would lay a continuous dark band down the path.

  return {
    group,
    update() {}, // static prop, but the other props have one and callers loop over it
    dispose() {
      for (const geo of geometries) geo.dispose();
      material.dispose();
    },
  };
}

export default createFencePanel;
