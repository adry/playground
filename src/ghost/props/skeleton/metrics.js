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
    // The second correction is the one that matters more. A real skull is also
    // slightly LONGER than it is tall: the lateral landmark table in
    // `.ref/SKULL-ANATOMY.md` puts vertex to gnathion at 0.94 of the glabella
    // to opisthocranion length. At 0.125 over 0.160 the height came out at
    // 1.044 of the length, taller than long by 11%, and because the crown, the
    // chin and the eye line are all pinned, the whole of that excess landed in
    // the braincase: it had to stretch 1.37x as hard as the face did, which is
    // why the face read small no matter how far forward the skull build pushed
    // it. No shaping inside skull.js can fix that; it is the box, not the
    // shape in it. These two grow to put the length where the table wants it,
    // holding the 0.78 index (0.1386 / 0.1777 = 0.780) and leaving every y
    // landmark, and therefore every other part of the figure, untouched.
    // The alternative was to shrink M.skull.height to f(0.1504), which reaches
    // the same ratio but moves the chin and drags the neck and the whole axial
    // chain with it.
    width: f(0.1386),
    depth: f(0.1777),
    // The mandible is a thin deep bar: this is the whole mouth from the tooth
    // line down to the chin point, and getting it wrong is what made an
    // earlier build's head oversized. f(0.037) was measured off the photo and
    // overshot; the landmark table's gnathion and tooth-crown rows put it at
    // f(0.0273), and every remaining miss below the Frankfurt horizontal in
    // the rebuilt skull traced back to this one number.
    jawHeight: f(0.0273),
    // The slant is how far the top edge of each orbit cuts down toward the
    // nose. 0.60 was the original brief and it gave the skull a hard glare;
    // the user asked for a friendlier face, so it is 0.12 now, which reads as
    // a gentle curve rather than a scowl. It is the single strongest control
    // over the character's expression, so change it knowingly.
    socket: { width: f(0.049), height: f(0.043), slant: 0.12 },
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
