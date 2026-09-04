// Every dimension of the shed, in one place, the way fence/metrics.js does it
// for the fence. Nothing below is invented at a call site.
//
// SCALE. The shed has to stand next to the fence and read as the same
// workshop's timber, so its boards are sized off the fence's boards and not off
// the building. A picket is 0.115 wide and 0.042 thick; cladding is a wider cut
// of the same stock at the same thickness, and a roof board is a wider cut
// again. Nothing here is thicker than the fence's chunkiest member (the post,
// 0.155) except the ridge, which is meant to be the one heavy piece.
//
// The ghost stands about 1.6 and the fence post tops out at 0.86. A shed whose
// eaves are at 1.40 and whose ridge is at 2.02 is a building the ghost can go
// into and the fence comes up to a third of the way up its wall, which is the
// relationship the reference has.

import F from '../fence/metrics.js';

export const S = {
  // --- the box -------------------------------------------------------------
  // X runs along the ridge, Z across the span. The door is in the +Z eave wall
  // and the window in the +X gable, so the scene's isometric camera (looking
  // from +X +Z) sees both without the shed having to be turned to face it.
  body: {
    halfWidth: 0.89,     // half the ridge run, X
    halfSpan: 0.71,      // half the span, Z
    wallTop: 1.40,       // the eaves line, where the roof meets the wall
    rise: 0.62,          // ridge above wallTop. Ridge lands at 2.02.
    // Boards are knocked into the dirt the way the fence's pickets are, and by
    // the fence's own amount so the two sit in the ground alike.
    sink: F.picket.sink,
  },

  // --- cladding ------------------------------------------------------------
  // Vertical boards butted side by side. Picket thickness exactly: this is the
  // one number that decides whether the shed is made of the fence's timber.
  clad: {
    thickness: F.picket.thickness,
    width: 0.148,
    round: F.picket.round,
    warp: 0.010,
    // Fractions of nominal, applied per board from the wall's seed.
    // width is a fraction of nominal; drop is an absolute amount taken OFF
    // the top of a board, in metres, and never added. See cladWall: a board
    // that grows past its nominal top pokes through the roof at a gable end.
    jitter: { width: 0.20, drop: 0.034, twist: 0.02 },
    // Space left between neighbours. Most joints are shut; a few have opened.
    // gapChance is how many have, gap is how far the widest one has gone.
    gap: 0.020,
    gapChance: 0.44,
    // The top of a board is a saw cut with the arris knocked off, not a
    // cardboard edge. Same trick as the fence post's eased top.
    top: { ease: 0.045, take: 0.30 },
    // Rings and segments. Far below the fence's, and deliberately: a picket is
    // one of seven and a clad board is one of sixty, the grain is a fragment
    // effect that does not care about tessellation, and the only thing the
    // extra rings buy is the rounded arris. See the note in index.js on cost.
    segments: 7,
    ring: 12,
  },

  // --- roof ----------------------------------------------------------------
  // Overlapping courses of horizontal boards, laid up the slope from the eaves.
  roof: {
    thickness: 0.038,
    width: 0.175,        // the board, across the slope
    exposure: 0.128,     // how much of it the course above leaves showing
    round: 0.30,
    warp: 0.012,
    // How far the eaves stand out past the wall face, measured horizontally.
    overhang: 0.115,
    // How far the ends of the courses run out past the gable wall. Ragged: a
    // per-end draw between these two, which is what makes the gable edge a
    // torn line instead of a sawn one.
    runOut: [0.015, 0.155],
    segments: 10,
    ring: 12,
    // The ridge board. The one heavy piece on the building.
    ridge: { width: 0.200, thickness: 0.092, round: 0.32, over: 0.115 },
  },

  // --- the doorway ---------------------------------------------------------
  door: {
    // Opening, in the +Z wall. Set off to -X so the leaf has somewhere to swing
    // that is not across the opening in this camera.
    at: -0.235,
    width: 0.60,
    height: 1.05,
    // The head. A single board laid flat across the opening.
    lintel: { width: 0.105, thickness: 0.058, over: 0.085 },
    // The leaf. Four boards on two cross braces with one diagonal between them.
    leaf: {
      clear: 0.018,       // gap between leaf and jamb, all round
      thickness: 0.036,
      boards: 4,
      brace: { width: 0.085, thickness: 0.030, at: [0.17, 0.84] },
      diagonal: { width: 0.072, thickness: 0.028 },
      knob: { radius: 0.032, stem: 0.030, at: 0.60 },
    },
    // Where it is standing. Negative swings the leaf out into +Z; see the note
    // on DOOR_HINGE in index.js.
    open: -0.72,
  },

  // --- the window ----------------------------------------------------------
  // In the +X gable, above the fence line so it is not hidden by a panel run.
  window: {
    width: 0.36,
    height: 0.32,
    sill: 0.86,          // bottom of the opening
    at: 0.06,            // centre along Z
    frame: { width: 0.062, thickness: 0.032, over: 0.055 },
    bars: { count: 2, width: 0.026, thickness: 0.020 },
  },

  // --- the dark inside -----------------------------------------------------
  // How far the interior shell stands inside the cladding's inner face. Small:
  // the point is that a gap between two boards looks into the dark, not into a
  // cavity with a wall some distance behind it.
  interior: {
    clearance: 0.005,
    // Unlit colours, darkest first. See shell.js: these are not lit, so they
    // are the final pixel and not an albedo.
    back: '#0a0908',
    side: '#12100d',
    floor: '#1a1611',
  },

  // --- debris --------------------------------------------------------------
  // Straight into fence/debris.js. Broken planks around the base are the same
  // broken planks the smashed fence panel leaves, and there is no reason for
  // the shed to own a second pile of rubbish.
  debris: {
    pile: { planks: 9, radius: 0.38 },
    scatter: { count: 34, radius: 1.30 },
  },
};

// Pitch, derived rather than stored, so rise and halfSpan cannot drift apart.
export const PITCH = Math.atan2(S.body.rise, S.body.halfSpan);

export default S;
