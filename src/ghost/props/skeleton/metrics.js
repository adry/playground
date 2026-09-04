// Every proportion in the skeleton, in one place.
//
// Four agents build the parts of this character separately, so the thing that
// keeps them one figure rather than four is that none of them invents a number.
// If a part needs a dimension that is not here, it gets added here first.
//
// The fractions are measured off `.ref/ref-skeleton.jpg` with the figure pinned
// to its own standing height, so they survive a change of overall scale. They
// were checked once against a built model and every landmark came within 3%.
//
// Anatomy note that drives the whole design brief: the bone INVENTORY is
// realistic (the bones a real skeleton has, in the places a real skeleton has
// them) and the bone SHAPES are not. Every shaft is waisted and every joint is
// a rounded bulb, because that is what makes it read as a vinyl toy next to the
// cloth ghost rather than as a museum cast.

// WHICH SIDE IS LEFT.
//
// The figure faces +Z with +Y up, so its own left hand is at +X: left is
// up x forward, and Y cross Z is X. Every part must put its 'L' bones at
// POSITIVE x. This is not a matter of taste and it is not negotiable per part,
// because the animator gets one flat joint map and `shoulderL` and `hipL`
// landing on opposite sides of the body is a bug nobody sees until the walk
// cycle comes out cross-limbed. An earlier pass had exactly that.
//
// Parts publish `group.userData.outwardX` so the assembler can assert it.
export const LEFT_X = 1;

export const HEIGHT = 2.5;              // crown to sole, world units
const H = HEIGHT;

// Fraction of standing height -> world units.
const f = (v) => v * H;

export const M = {
  height: H,

  // --- heights of the landmarks above the floor, so parts meet without
  // anyone having to guess where the next part starts.
  y: {
    sole: 0,
    ankle: f(0.030),
    knee: f(0.260),
    hip: f(0.490),               // femoral head, the pivot
    pelvisTop: f(0.570),
    lumbarTop: f(0.660),         // where the ribcage's bottom edge sits
    ribcageTop: f(0.807),
    shoulder: f(0.775),          // glenoid, the pivot
    chin: f(0.833),
    crown: f(1.000),
  },

  skull: {
    height: f(0.167),            // crown to chin, jaw closed
    width: f(0.141),
    depth: f(0.150),             // slightly less than width: a skull is not a ball
    // The mandible is a thin deep bar. Measured off the photo the whole mouth
    // from the tooth line to the chin point is only this tall, and getting it
    // wrong is what made an earlier build's head oversized.
    jawHeight: f(0.037),
    socket: { width: f(0.049), height: f(0.043), slant: 0.60 },
    teeth: { upper: 11, lower: 9 },
  },

  neck: { length: f(0.058), radius: f(0.021) },

  ribcage: {
    width: f(0.174),
    height: f(0.147),
    depth: f(0.115),
    pairs: 8,                    // what the photo has; 12 at this size is a comb
    trueRibs: 5,                 // the ones that close on the sternum
  },

  pelvis: { width: f(0.168), height: f(0.116), depth: f(0.088) },

  // The sacrum belongs to the axial part and the hip plates belong to the legs
  // part, so its extent has to be published rather than each side guessing.
  // These are the values the axial build settled on.
  sacrum: { top: f(0.570), bottom: f(0.499), width: f(0.116), depth: f(0.058) },

  arm: {
    humerus: f(0.154),
    forearm: f(0.143),
    hand: f(0.090),
    shoulderSeparation: f(0.203),
    // Glenoid depth. Separation and M.y.shoulder fix the other two axes; this
    // one was being guessed at separately by the axial and arms builds.
    glenoidZ: f(0.0016),
    // Radians the A-pose holds the arm out from vertical, as a length-weighted
    // mean over the whole limb. Measured off the photo at the scale that
    // reproduces shoulderSeparation to within 1%: the humerus leaves the
    // glenoid at about 0.34 and the forearm continues at about 0.13. An
    // earlier 0.14 here put the wrist 0.055 too close to the centreline, so
    // the arms hugged the body.
    flare: 0.22,
  },

  leg: {
    femur: f(0.221),
    tibia: f(0.230),
    foot: f(0.100),
    hipSeparation: f(0.100),
    bow: 0.035,                  // outward bow at mid-shaft, as a fraction of length
  },

  // --- the bone vocabulary's default proportions -------------------------
  // A shaft is this fraction of its end radius at the waist. Uniform across
  // every long bone in the figure, which is most of what makes them look like
  // one set.
  shaftWaist: 0.62,
  jointBallScale: 1.22,          // ball radius over the shaft's end radius
};

export default M;
