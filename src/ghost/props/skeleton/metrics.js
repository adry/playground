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
    // Where the skull parents. Derived rather than measured: it is the only
    // value that makes crown minus chin come out at M.skull.height.
    atlas: f(0.807) + f(0.058),
    crown: f(1.000),
  },

  skull: {
    height: f(0.167),            // crown to chin, jaw closed
    // A real braincase is LONGER front to back than it is wide: the cranial
    // index, breadth over length, runs 0.75 to 0.80 across human populations.
    // These two were 0.141 and 0.150, an index of 0.94, which is not a human
    // skull of any type and is most of why the head read as a ball.
    //
    // These have now been round the loop twice and the second trip reversed the
    // first, so the history is worth keeping.
    //
    // An earlier pass grew them to f(0.1386) and f(0.1777) on the strength of a
    // line in `.ref/SKULL-ANATOMY.md` saying vertex to gnathion is 0.94 of the
    // glabella to opisthocranion length, that is, that a skull is slightly
    // LONGER than it is tall. Measured off the reference photograph it is
    // 1.075, taller than long, and craniometry agrees. The prose was wrong, and
    // it was wrong in the same way the eye-line rule in that file was wrong:
    // both were rules of thumb for a head with a face on it rather than
    // measurements of a bare skull.
    //
    // So they come back down, 13% smaller, with the cranial index held at 0.75
    // (0.1169 / 0.1553), which is inside the real 0.75 to 0.80 range. Every
    // M.y landmark is untouched either way, so the neck and the whole axial
    // chain never moved through any of this.
    //
    // KNOWN INCONSISTENCY, and the reason these two are worth reading twice.
    // The rebuilt skull.js does not actually READ either of them any more: it
    // carries its own copy of the same measurements, because it derives its
    // silhouette from three authored curves off the photograph rather than
    // from a box. So editing these changes nothing you can see today, which is
    // exactly the sort of number that quietly rots. They are kept, and kept
    // truthful, because they are the figure's published head size and the next
    // part that needs one should find the right value here rather than a stale
    // one. If skull.js is ever refactored to take its proportions from this
    // file, these are already the numbers it wants.
    width: f(0.1169),
    depth: f(0.1553),
    // The mandible is a thin deep bar: this is the whole mouth from the tooth
    // line down to the chin point, and getting it wrong is what made an
    // earlier build's head oversized. f(0.037) was measured off the photo and
    // overshot; the landmark table's gnathion and tooth-crown rows put it at
    // f(0.0273), and every remaining miss below the Frankfurt horizontal in
    // the rebuilt skull traced back to this one number.
    jawHeight: f(0.0273),
    // Measured on the photograph's front view the orbit is 47 by 36 pixels
    // against a 219 pixel skull. The old f(0.049) by f(0.043) was 36% too wide
    // and 51% too tall, and an oversized eye socket is the single loudest
    // "cartoon" signal a skull can send: it is what the eye reads first and it
    // shrinks everything around it by comparison.
    //
    // `slant` is how far the top edge of each orbit cuts down toward the nose,
    // and it stays at 0.12. 0.60 was the original brief and it gave the skull a
    // hard glare; the user asked for a friendlier face. It is the single
    // strongest control over this character's expression, so change it
    // knowingly, and note that shrinking the sockets above did NOT make the
    // face meaner, it made the rest of the head read at its proper size.
    socket: { width: f(0.0359), height: f(0.0284), slant: 0.12 },
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
  //
  // These went in wrong the first time: the axial build reported them in world
  // units and they were wrapped in f() again, which put the sacrum at 69% of
  // the whole pelvis's width. Everything here is a fraction of standing height,
  // always, and a number arriving from a report has to be divided by HEIGHT
  // before it goes through f(). Nothing had read the bad values yet.
  sacrum: {
    top: f(0.5802),
    bottom: f(0.5277),      // the blade's apex
    coccyxTip: f(0.5047),
    width: f(0.0421),
    depth: f(0.0080),
  },

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
    // The landmark heights are the constraint, not this number: hip minus knee
    // is f(0.230) of vertical drop alone, and the femur also splays outward
    // from f(0.050) at the hip to f(0.078) at the knee, so the bone itself has
    // to be a little longer than the drop. An earlier f(0.221) here was shorter
    // than the vertical gap it had to span, which is geometrically impossible
    // and sent the legs build into honouring the landmarks and reporting the
    // conflict. Believe M.y first; these lengths follow from it.
    femur: f(0.232),
    tibia: f(0.230),
    // Foot length. f(0.100) came off the photo and was too short: it built a
    // foot barely wider than the ankle that read as a stump with a fringe of
    // toes. A real foot is about 0.15 of standing height and the photo was
    // almost certainly foreshortening it, since the figure stands square to
    // camera. Stylised feet can run small, but not by a third.
    foot: f(0.142),
    footWidth: f(0.060),
    // Toes splay outward from the walking line, which is most of what stops a
    // foot reading as a rectangle stuck on an ankle.
    toeOut: 0.14,
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
