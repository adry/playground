// Every dimension of the fence, in one place.
//
// Same discipline as the skeleton: several agents build different pieces, so
// nobody invents a number. If a piece needs a measurement that is not here, it
// gets added here first.
//
// The fence exists to be a gate the ghost can clear and the skeleton cannot, so
// its height is a gameplay value before it is an art value. The ghost hovers at
// 1.34 and stands about 1.8 tall; the skeleton is 2.5. A fence the ghost hops
// has to read as low and hoppable at a glance, which is why the pickets come up
// to roughly the ghost's hem rather than its shoulder.

export const F = {
  // --- the panel -----------------------------------------------------------
  // The floor grid is 1 unit, so a panel spanning two cells tiles cleanly into
  // a path layout without anyone doing arithmetic at the call site.
  panel: { length: 2.0, pickets: 7 },

  picket: {
    height: 0.72,
    width: 0.115,
    thickness: 0.042,
    round: 0.34,
    warp: 0.008,
    // How far a board is bedded into the dirt, so none of them float.
    sink: 0.012,
    // jitter.lean says how far a board leans, not how many of them do.
    leanChance: 0.45,
    leanFloor: 0.22,
    // The tops are a shallow roof point, two chamfers meeting at an apex, not a
    // sharp spike. Height of that point as a fraction of the picket's width.
    pointRise: 0.62,
    // Width left at the very tip, as a fraction of the board's. Running the
    // taper to nothing gives a knife edge, and the reference's points are
    // visibly blunt: a sawn chamfer, not a whittled spike.
    apex: 0.24,
    // Boards are hand-cut, so no two are quite the same. Fractions of the
    // nominal, applied per picket from the panel's seed.
    jitter: { width: 0.12, height: 0.06, lean: 0.035, twist: 0.05 },
  },

  post: {
    height: 0.86,
    width: 0.155,
    thickness: 0.155,
    // Posts in the reference are squared off rather than pointed, with the
    // corners knocked well off.
    round: 0.34,
    warp: 0.005,
    // The squared top is not a sharp edge either; its rim is eased.
    top: { ease: 0.055, take: 0.28 },
  },

  rail: {
    count: 2,
    thickness: 0.055,
    depth: 0.075,
    // Heights up the picket, as fractions of picket height.
    at: [0.30, 0.72],
    round: 0.24,
    warp: 0.011,
  },

  // --- breakage ------------------------------------------------------------
  // The signature of this reference is the break: wood does not snap clean, it
  // tears along the grain into long fibrous spikes of very different lengths.
  // A flat or a jagged-but-even break reads as stone, not timber.
  splinter: {
    count: [4, 9],           // spikes per broken end, inclusive range
    length: [0.35, 2.4],     // as multiples of the board's thickness
    taper: 0.18,             // tip width over base width
    lean: 0.30,              // radians a spike may lean off the board's axis
  },

  // --- the wood ------------------------------------------------------------
  // Grain runs along the length of every board. It lives in the material rather
  // than the geometry, so a board drawn with a plain woodMaterial() comes out
  // flat cream next to a grained neighbour; use woodPanelMaterial().
  grain: { frequency: 21, depth: 0.86, tint: 0.18 },

  wood: {
    pale: '#e2d5bd',
    shade: '#cbb99b',
    // Torn fibre catches the light differently from a weathered face, so a
    // fresh break is slightly warmer and slightly less grey than the outside.
    torn: '#e9dcc2',
  },
};

export default F;
