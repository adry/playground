// What each prop actually takes up on the floor, and how tall it stands.
//
// MEASURED, NOT GUESSED, and not copied out of DESIGN.md either. Every number
// below came off the prop's own geometry: build it headless with three, take
// the world bounding box of the returned group over several seeds, keep the
// largest. footprints-probe.mjs beside this file is that measurement and it
// prints this table; run it again if a prop changes shape.
//
// The design doc's table is HALF EXTENTS of the visible body, which is the
// right number for an artist and the wrong one for a collision test: it leaves
// out the depth of a slab and the plinth's overhang, so a "0.46" headstone is a
// 0.54 by 0.22 box on a 0.62 by 0.35 plinth. Where the two disagree the
// measurement wins, and the difference is called out in the notes.
//
// Two shapes, because two tests:
//
//   disc  { r }            pumpkins, lanterns, the fountain, the shed. Round in
//                          plan, so a yaw does nothing to their footprint.
//   box   { halfU, halfV } everything with a face. halfU is along the prop's
//                          own local X, halfV along its local Z, both before
//                          the prop's yaw is applied. A stone is much wider
//                          than it is deep and a row of them only reads as a
//                          row if the test knows that, which a circumscribed
//                          circle does not: the circle test alone spaces a row
//                          of ledgers 1.9 apart and the row stops being a row.
//
// `height` is the top of the prop above y = 0. It is only ever used by
// placement rule 5, the one about a tall thing standing in front of a short
// one, so it is the silhouette height and nothing else.

// --- headstones ------------------------------------------------------------
//
// All 29 registered variants, in the order stones/index.js loads them, which is
// small to large. `face` is what the inscription faces: local +Z, so a stone
// yawed to face the camera is at PI/4 in the screen frame.
//
// bench, ledger and chest are in the same registry but are not headstones:
// they are furniture and body stones, and the motifs treat them as such.
export const STONES = {
  cross:   { halfU: 0.539, halfV: 0.218, height: 1.560 },
  bat:     { halfU: 0.579, halfV: 0.228, height: 1.521 },
  fred:    { halfU: 0.448, halfV: 0.193, height: 1.098 },
  heart:   { halfU: 0.388, halfV: 0.182, height: 1.080 },
  // Nearly square in plan and wider than it is tall, because the box takes in
  // the foot stones scattered round its base. Like vault, a yaw does not
  // shrink it.
  boulder: { halfU: 0.744, halfV: 0.762, height: 1.144 },
  scroll:  { halfU: 0.809, halfV: 0.203, height: 0.983 },
  ledger:  { halfU: 0.797, halfV: 0.452, height: 0.336 },
  bench:   { halfU: 0.730, halfV: 0.290, height: 0.833 },
  book:    { halfU: 0.666, halfV: 0.500, height: 0.871 },
  chest:   { halfU: 0.834, halfV: 0.393, height: 0.831 },
  lamb:    { halfU: 0.438, halfV: 0.257, height: 0.876 },
  cairn:   { halfU: 0.456, halfV: 0.547, height: 0.909 },
  sundial: { halfU: 0.341, halfV: 0.354, height: 1.174 },
  urn:     { halfU: 0.350, halfV: 0.258, height: 1.551 },
  column:  { halfU: 0.349, halfV: 0.340, height: 1.389 },
  pyramid: { halfU: 0.579, halfV: 0.518, height: 1.213 },
  wheel:   { halfU: 0.469, halfV: 0.203, height: 1.448 },
  stump:   { halfU: 0.440, halfV: 0.448, height: 1.349 },
  cracked: { halfU: 0.642, halfV: 0.235, height: 1.376 },
  twin:    { halfU: 0.739, halfV: 0.239, height: 1.485 },
  wings:   { halfU: 0.685, halfV: 0.208, height: 1.544 },
  draped:  { halfU: 0.479, halfV: 0.302, height: 1.599 },
  celtic:  { halfU: 0.498, halfV: 0.233, height: 1.613 },
  gothic:  { halfU: 0.419, halfV: 0.203, height: 1.696 },
  stele:   { halfU: 0.418, halfV: 0.221, height: 1.724 },
  // The widest headstone by a distance, and the only building. Its box is
  // nearly square, so unlike every other stone here a yaw does not shrink it:
  // it needs 2.11 across whichever way it is turned, and it will simply be
  // refused in a 2.0 cell rather than nudged.
  vault:   { halfU: 0.748, halfV: 0.733, height: 1.768 },
  calvary: { halfU: 0.523, halfV: 0.467, height: 1.822 },
  obelisk: { halfU: 0.379, halfV: 0.318, height: 1.848 },
};

// The registry grows: stones/index.js is what a scene imports and other people
// keep adding to it. Anything registered but not listed above is simply not
// placed, which is the safe way round, and `kerb` is left out on purpose: it is
// a 4.3 long plot border rather than a headstone and wants its own motif.

// Upright headstones, tall enough to read as a stone in a row. Sorted by
// height, because a row is laid out short at the front and tall at the back and
// the motifs walk this list rather than sorting one of their own.
export const UPRIGHT = [
  'heart', 'boulder', 'fred', 'sundial', 'pyramid', 'stump', 'cracked', 'column', 'wheel',
  'twin', 'bat', 'wings', 'urn', 'cross', 'draped', 'celtic', 'gothic', 'stele',
  'vault', 'calvary', 'obelisk',
];
// Low stones. They go at the front of a plot, where a tall one would hide
// whatever is behind it.
export const LOW = ['ledger', 'chest', 'scroll', 'book', 'lamb', 'cairn'];

// --- pumpkins --------------------------------------------------------------
// Round in plan to within a millimetre, so a disc. The design doc's 0.16 / 0.40
// / 0.46 for tiny / classic / squat are the body radii and the measurement
// agrees to within the rib depth.
export const PUMPKINS = {
  tiny:    { r: 0.158, height: 0.275 },
  gourd:   { r: 0.244, height: 0.996 },
  pear:    { r: 0.274, height: 0.930 },
  tall:    { r: 0.362, height: 0.942 },
  classic: { r: 0.406, height: 0.768 },
  squat:   { r: 0.459, height: 0.730 },
};

// --- lanterns --------------------------------------------------------------
// bracket.js is missing on purpose: it hangs off a wall and has no footprint on
// the floor, so it is not a placeable prop for this generator.
//
// The street lamp is 3.3 tall and the twin lamp 2.6, which is taller than the
// skeleton. Rule 5 does not forbid them, it just means they belong at the back
// of a plot or on a corner, and the motifs only ever use them there.
export const LANTERNS = {
  ground:    { r: 0.174, height: 0.354 },
  hurricane: { r: 0.169, height: 0.382 },
  jars:      { r: 0.191, height: 0.122 },
  pillar:    { r: 0.195, height: 1.527 },
  post:      { r: 0.410, height: 1.261 },
  crook:     { r: 0.439, height: 1.365 },
  brazier:   { r: 0.514, height: 1.039 },
  twinlamp:  { r: 0.823, height: 2.562 },
  street:    { r: 0.436, height: 3.299 },
};
// The ones small enough to line a path without crowding it.
export const PATH_LANTERNS = ['ground', 'hurricane', 'pillar', 'post', 'crook'];

// --- the rest --------------------------------------------------------------
export const MISC = {
  // fountain/index.js measures 0.851 across its widest ring, not the 1.13 the
  // design doc lists. The doc's number looks like the rubble ring that
  // fountain/rubble.js scatters separately and this generator does not place,
  // so the reserved radius is the honest 0.86 and the fountain court motif
  // keeps a metre of clear apron round it anyway.
  fountain: { shape: 'disc', r: 0.851, height: 1.948 },

  // The shed BUILDING measures 1.04 by 0.88 with its eaves, but createShed also
  // scatters broken planks around its door out to 2.9 on the +Z side. Those are
  // flat on the ground and nothing collides with them, yet a headstone standing
  // in the middle of them looks wrong. So the shed keeps the design doc's 1.93,
  // which is a 4.0 cell to itself with 0.07 to spare, exactly as rule 6 says.
  shed: { shape: 'disc', r: 1.93, height: 2.139 },


  // ground/hole.js: MOUTH_X 1.0, MOUTH_Z 0.45, long axis along local X. The
  // turf skirt reaches 0.40 further out but it is flat ground that a headstone
  // is meant to stand on, so the box is the mouth, as the design doc has it.
  hole: { shape: 'box', halfU: 1.0, halfV: 0.45, height: 0 },

  // ground/dirtpile.js: HEAP.length 1.8 along local X, spread 0.9, and loose
  // clods out to scatter 1.2. Measured over the clods: 2.0 by 1.29.
  dirt: { shape: 'box', halfU: 1.0, halfV: 0.643, height: 0.571 },
};

// --- planting ----------------------------------------------------------------
//
// Four bushes off one prop: three clipped forms and the overgrown shrub they
// were reworked from. They are listed separately because their heights differ
// by two thirds, and height is what placement rule 5 is written against: a
// cone at 1.27 stands taller than nine of the headstones and must not be
// allowed in front of one, while a ball at 0.78 can stand in front of
// anything. A single row for `bush` would have to publish the cone's height
// for all four and would then refuse the ball a spot it fits perfectly well.
//
// The box is a box. Its faces are 0.90 by 0.87 and a circle round that corner
// to corner is 0.627, which is 39% of floor it does not occupy; the box test
// gets it back. The ball and the cone are round in plan and a yaw does nothing
// to them.
//
// A caller that names no variant gets the ball, which is what a level written
// before the topiary existed is holding when it says `bush`.
export const BUSHES = {
  ball: { shape: 'disc', r: 0.600, height: 0.813 },
  cone: { shape: 'disc', r: 0.405, height: 1.270 },
  box: { shape: 'box', halfU: 0.450, halfV: 0.436, height: 0.809 },
  wild: { shape: 'disc', r: 0.576, height: 0.760 },
};

// Every footprint, addressed as the props list addresses them.
export function footprintOf(kind, variant) {
  if (kind === 'stone' || kind === 'bench') {
    const s = STONES[variant] || STONES.cross;
    return { shape: 'box', halfU: s.halfU, halfV: s.halfV, height: s.height };
  }
  if (kind === 'pumpkin' || kind === 'jack') {
    const p = PUMPKINS[variant] || PUMPKINS.classic;
    return { shape: 'disc', r: p.r, height: p.height };
  }
  if (kind === 'lantern') {
    const l = LANTERNS[variant] || LANTERNS.post;
    return { shape: 'disc', r: l.r, height: l.height };
  }
  if (kind === 'bush') return { ...(BUSHES[variant] || BUSHES.ball) };
  const m = MISC[kind];
  if (m) return { ...m };
  throw new Error(`no footprint for ${kind}/${variant}`);
}

// The radius the layout publishes for every prop, box or disc: the circle that
// contains the footprint. Rule 1's cheap test uses it; the box test refines it.
export function boundingRadius(foot) {
  return foot.shape === 'disc' ? foot.r : Math.hypot(foot.halfU, foot.halfV);
}

export default footprintOf;
