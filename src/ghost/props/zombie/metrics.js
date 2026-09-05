// Every proportion in the chibi zombie, in one place.
//
// Two agents build this character in parallel: one the body, one the
// animation. This file is the seam. Nothing in either half invents a
// dimension; if a number is needed and is not here, it gets added here first
// and the other half is told. That is the same discipline that kept the
// skeleton (four agents, `../skeleton/metrics.js`) one figure rather than four,
// and it is the only reason this works.
//
// Reference: a chibi zombie toy. Enormous smooth bald head, roughly a third of
// the figure. Sunken lightless eye sockets, wide lipless grin of uneven teeth,
// stitched scars. A torn jacket hanging open over an EXPOSED RIBCAGE, pale
// ribs over dark red flesh with the spine below them. Ragged shorts with holes,
// one forearm stripped to muscle and bone, long claw nails, scuffed boots.
// Matte clay/vinyl finish, no gloss, which is the house style of the ghost,
// the pumpkins and the skeleton it will stand beside.

// WHICH SIDE IS LEFT.
//
// Identical convention to the skeleton, deliberately, because the two figures
// publish the same joint map and are meant to be able to share a performance.
//
// The figure faces +Z with +Y up, so its own left is at POSITIVE x: left is
// up cross forward, and Y cross Z is X. Every part puts its 'L' geometry at
// positive x, no exceptions. The skeleton had a pass where the shoulders used
// one convention and the hips the other, which is invisible in the rest pose
// and comes out as a cross-limbed walk the moment anything moves. `model.js`
// asserts this at build time rather than trusting the comment.
export const LEFT_X = 1;

// --- standing height ---------------------------------------------------------
//
// 1.80, crown to sole, and it is chosen against three things at once.
//
// 1. THE FAMILY. The ghost is 1.72 and the skeleton is 2.5. The skeleton is
//    deliberately looming, a head and a half above the player. The zombie is
//    the shambler: it has to read as a peer of the ghost, something that can
//    plausibly chase it rather than step over it, so it stands eye to eye with
//    the ghost and comes up to the skeleton's chest. Anything under about 1.6
//    reads as a child and stops being a threat; anything over 2.0 stops being
//    chibi, because a chibi silhouette is squat by definition.
//
// 2. PIXELS. The game camera is orthographic with a half-height of 6.2, so a
//    720-tall frame maps one world unit to 58 px and a 1080-tall frame to 87.
//    1.80 is 105 px at 720p, which is exactly the "roughly a hundred pixels
//    tall" the whole legibility budget below is sized against. Every feature
//    in this file was then checked at that size on a crop of a real scene
//    render, not on a turntable. See LEGIBILITY.
//
// 3. HEAD COUNT. At head = 0.330 of height (below), 1.80 is 3.03 heads tall.
//    Three heads is the classic chibi ratio. A realistic figure is seven and a
//    half; the skeleton is six.
export const HEIGHT = 1.80;
const H = HEIGHT;

// Fraction of standing height -> world units. Everything in M goes through it,
// so a number arriving from anywhere else must be divided by HEIGHT before it
// is passed in. The skeleton lost an afternoon to a value that had been through
// f() twice.
const f = (v) => v * H;

// --- LEGIBILITY: the rule that overrides the reference ----------------------
//
// Read this before changing any facial number. The skeleton's skull went round
// the design loop three times because features measured accurately off a photo
// simply vanish at game scale, and the fix each time was the same: make the
// feature bigger than it should be and judge it on a crop of an actual scene
// render.
//
// At 58 px per world unit the head is 0.594 units, that is 34 px tall. That is
// the entire budget for a face. Inside it:
//   - a socket at a "correct" 15% of head height is 5 px and disappears into
//     the shading of the brow above it;
//   - a stitch measured off the reference at 12 mm scale is under 2 px and
//     dissolves;
//   - a tooth in a row of ten is 1.8 px and the grin turns into a grey smear.
//
// So three things are deliberately oversized against the reference, and the
// number in brackets is what the reference actually shows:
//   sockets   0.248 of head height  (reference ~0.17)
//   grin      0.567 of head width   (reference ~0.45)
//   stitches  4.4 px long, x2 thick (reference: hairline)
// and one thing is deliberately REDUCED, because more of it is less:
//   teeth     5 upper / 4 lower     (reference: ten-plus, uneven)
//
// The oversized socket is also why the character stays cute rather than
// turning threatening. A big round eye socket is a child's proportion. The
// skeleton's `socket.slant` note makes the same point: the single strongest
// control over this face's expression is how hard the top edge of the socket
// cuts down toward the nose, and it is kept shallow on purpose.
export const LEGIBILITY = {
  pxPerUnit720: 58,
  headPx720: 34,
  // What a value in fractions-of-height is worth in pixels at 720p.
  px: (frac) => frac * H * 58,
};

export const M = {
  height: H,

  // --- landmark heights above the floor ------------------------------------
  //
  // Parts meet at these, so no part has to guess where the next one starts.
  // Believe these before believing any bone length below: the lengths are
  // derived from the drops between landmarks plus whatever bow or splay the
  // bone carries, never the other way round.
  y: {
    sole: 0,
    ankle: f(0.052),          // pivot at the centre of the boot's ankle bulb
    knee: f(0.180),
    hip: f(0.345),            // femoral head, the pivot, and `root`
    pelvisTop: f(0.405),
    waist: f(0.425),          // spineLower pivot
    cavityBottom: f(0.470),   // bottom lip of the open ribcage window
    chest: f(0.520),          // spineUpper pivot
    cavityTop: f(0.600),      // top lip of the window, under the collarbone
    shoulder: f(0.598),       // glenoid, the pivot
    shoulderTop: f(0.628),    // top of the deltoid mass, where the jacket sits
    neck: f(0.640),           // neck pivot. See the note under `neck` below.
    chin: f(0.670),
    atlas: f(0.700),          // head pivot, at the base of the skull ball
    grin: f(0.745),           // centre line of the mouth
    // The jaw hinge, well above the mouth and behind it, where a real condyle
    // sits under the ear. Putting it at the mouth makes an opening jaw slide
    // rather than swing, which reads as the teeth falling off.
    jawHinge: f(0.790),
    brow: f(0.872),           // centre line of the eye sockets
    ear: f(0.862),
    crown: f(1.000),
  },

  // --- the head ------------------------------------------------------------
  //
  // A third of the figure, which is the single loudest thing about a chibi.
  //
  // It is NOT a sphere, and this is the constraint that shapes the modelling.
  // The camera is fixed and orthographic and there is no environment map in
  // this scene, so a ball has one broad terminator across it and reads as a
  // flat disc at 34 px. The head therefore carries real form: a brow shelf
  // over the sockets, a cheek plane under them, a flattened occiput, and a
  // jaw that narrows below the ears. Those four planes are what give the
  // three-quarter view a silhouette break; smoothness alone gives none.
  //
  // width < depth for the same reason the skeleton's cranial index is 0.75: a
  // head as wide as it is deep has a circular horizontal section and turns to
  // camera with no change of silhouette at all. 0.943 here is far rounder than
  // a real skull because it is a toy, but it is not 1.0.
  head: {
    height: f(0.330),         // chin to crown
    width: f(0.300),
    depth: f(0.318),
    // How far the brow shelf stands proud of the ball. This is small in
    // absolute terms and does most of the shading work on the upper face.
    browJut: f(0.022),
    // How far behind the head's centre plane the jaw condyle sits.
    jawHingeZ: f(-0.026),
    // How much narrower the head is at the chin than at the cheekbones, as a
    // fraction of width. A chibi jaw is barely tapered; 1.0 would be a ball.
    jawTaper: 0.80,
    // Flatten the back of the cranium slightly. Stops the three-quarter
    // silhouette being a perfect circle, which is what makes a big head read
    // as a balloon.
    occiputFlat: 0.93,
  },

  // Deep, dark, and EMPTY: no eyeball, just shadow. The depth matters more
  // than the outline. A shallow socket lit by this key light fills with
  // bounce and turns grey; at 0.038 the socket floor is in the light's shadow
  // from every camera angle the game can show, so it stays black without any
  // material trickery.
  socket: {
    width: f(0.090),
    height: f(0.086),
    depth: f(0.038),
    // Centre to centre. f(0.115) was the first pass and the two sockets came
    // within 0.02 of touching over the bridge, which read as one wide dark
    // band rather than two eyes. Pushed out until there is a clear strip of
    // green between them at game scale.
    separation: f(0.140),
    // How far the upper rim cuts down toward the nose. The skeleton's note
    // applies verbatim: 0.60 is a glare, this is a stare. Change knowingly.
    slant: 0.02,
  },

  // Lipless: the mouth is a slot cut into the face, not lips laid on it, so
  // the teeth sit in a dark trough and read as bright blocks on black. That
  // contrast is the whole reason the grin survives to 34 px.
  grin: {
    width: f(0.186),          // 0.62 of head width
    height: f(0.062),
    depth: f(0.030),
    curve: 0.55,              // how far the corners rise, as a fraction of height
    // Fewer teeth, bigger teeth. Ten uneven teeth at this size is a grey
    // dither; five is five white blocks and a gap you can actually see.
    teeth: { upper: 5, lower: 4, gapUpper: 3, gapLower: 1 },
  },

  ear: { radius: f(0.030), thickness: f(0.014) },

  // Short crossed lines, and they are drawn as real geometry rods rather than
  // painted, because there is no texture pipeline here and an alpha card has
  // nothing to reflect in a scene with no environment map. Same rule that
  // shaped the bushes and the fence.
  //
  // length is set by LEGIBILITY, not by the reference: 4.4 px at 720p is the
  // shortest mark that still reads as a line rather than a speck.
  stitch: {
    length: f(0.030),
    thickness: f(0.0034),
    forehead: 3,
    cheek: 2,
  },

  // A chibi has NO NECK, and that is a structural fact rather than a cosmetic
  // one. The chin is at 0.670 and the top of the shoulder mass is at 0.628:
  // that is f(0.042), 0.076 world units, 4.4 px. The head does not sit on a
  // column above the shoulders, it sits IN them, and the back of the skull
  // overlaps the trapezius.
  //
  // Two consequences the animation half needs:
  //   1. `neck` has almost no travel. Past about 0.30 rad in any axis the
  //      skull ball drives through the deltoid. Use `head` for the range and
  //      `neck` for the last little follow-through.
  //   2. The shoulders had to move OUT to make room. shoulderSeparation is
  //      0.185 against a head width of 0.300, so the head is wider than the
  //      shoulders. That is correct chibi and it is why an arm swing that
  //      would be fine on the skeleton clips the jaw here.
  neck: { length: f(0.030), radius: f(0.056) },

  // --- torso ---------------------------------------------------------------
  torso: {
    chestWidth: f(0.230),
    chestDepth: f(0.160),
    waistWidth: f(0.196),
    waistDepth: f(0.138),
    pelvisWidth: f(0.212),
    pelvisDepth: f(0.150),
    // Shell thickness at the rim of the cavity. This is what you see edge-on
    // when you look into the chest, and it is the thing that makes the
    // opening read as a hole through a solid body rather than as a decal.
    shellThickness: f(0.020),
  },

  // --- the exposed ribcage -------------------------------------------------
  //
  // The hardest thing in the model. It is an opening you see OTHER GEOMETRY
  // through, and it has to work with no alpha anywhere.
  //
  // It is built as a real cavity, in four layers, front to back:
  //   1. the torso shell, with a window of quads genuinely omitted;
  //   2. a rim wall funnelling from the outer skin down to the cavity floor,
  //      `torso.shellThickness` deep, same skin material, so the opening has
  //      an honest edge;
  //   3. the flesh: a dark red inner shell at `cavity.floor` of the local
  //      radius, which is what you actually see through the gaps between ribs;
  //   4. the ribs and the spine, standing proud of that floor.
  //
  // `halfAngle` is the azimuthal half-width of the window about +Z. 0.70 rad
  // is 80 degrees of the body's circumference, which at the game's fixed
  // three-quarter camera keeps the cavity open and readable when the figure is
  // turned up to 40 degrees away from the lens. Narrower and the cavity closes
  // to a slot the moment it walks off-axis, which is the failure mode: the
  // feature that defines this character must not be a front-view-only feature.
  cavity: {
    halfAngle: 0.62,
    // The cavity floor, as a fraction of the shell's own section. It is
    // ANISOTROPIC and that is the whole trick.
    //
    // Built as one scale, 0.34 both ways, the flesh was a narrow column down
    // the middle of the chest: it was correctly deep, but only two thirds as
    // wide as the window, so looking into the opening you saw dark red in the
    // middle and straight past it at the edges. Widening it uniformly instead
    // filled the window and destroyed the depth, because the floor came
    // forward to meet the skin and the ribs had nowhere to stand.
    //
    // So: wide enough to close the window (floorX), shallow enough to leave
    // the ribs a real gap to stand in (floorZ).
    floorX: 0.88,
    floorZ: 0.34,
    ribFront: 0.62,           // where the ribs sit, between floor and shell
    // THREE pairs, not the reference's full cage, and this is the biggest
    // single concession to size on the model. The window is 0.205 units tall,
    // which is TWELVE PIXELS in a shipped frame. Four ribs in it is a 3 px
    // pitch and dithers into a grey bar; three at a 4.4 px pitch is three
    // separate pale lines with dark between them, which is what a ribcage is
    // at this size. The count is set by the pixel pitch, not by anatomy.
    ribPairs: 3,
    ribRadius: f(0.0105),
    ribSpacing: f(0.040),
    ribTop: f(0.588),
    // The spine runs down the middle of the cavity BEHIND the ribs, so its
    // top knobs show through the rib gaps and its bottom ones are exposed
    // below the lowest rib. That is what sells the cavity as an opening with
    // a back to it rather than as a patch painted on the chest: you are
    // looking past one piece of geometry at another.
    spineKnobs: 5,
    spineTop: f(0.578),
    spineSpacing: f(0.024),
    spineRadius: f(0.016),
  },

  // --- clothing -------------------------------------------------------------
  //
  // All of it geometry. The torn edges are a real sawtooth in the mesh outline
  // and the holes are real openings, for the same no-alpha reason as above.
  jacket: {
    top: f(0.616),            // sits on the deltoid
    hem: f(0.395),
    // The front gap is WIDER than the cavity (0.62), not narrower, so the two
    // lapels frame the ribcage instead of covering its edges. The reference
    // has them overlapping and built that way it ate a fifth of a feature
    // that is only fifteen pixels across to begin with.
    //
    // It is only a little wider, though, and that is the other half of the
    // lesson. Opened to 0.98 the garment stopped reading as a jacket at all:
    // from the game's three-quarter camera the front 112 degrees were bare
    // chest, the remaining cloth hid behind the arms, and what was left looked
    // like a collar and a separate belt. A jacket has to close enough of the
    // torso to be a jacket.
    openHalfAngle: 0.74,
    thickness: f(0.010),
    tatter: f(0.022),         // depth of the sawtooth at the hem and cuffs
    sleeveTo: f(0.500),       // the sleeves are torn off just above the elbow
  },

  shorts: {
    top: f(0.400),
    hem: f(0.245),
    thickness: f(0.013),
    tatter: f(0.026),
    holes: 3,                 // one of them shows bone, on the left thigh
  },

  // --- arms ----------------------------------------------------------------
  //
  // Short, which is most of what makes a chibi silhouette. Hanging straight,
  // the fingertips reach f(0.274), which is upper thigh: hip is f(0.345) and
  // knee f(0.180). A realistic arm reaches mid-thigh; this one stops short and
  // that gap is deliberate.
  //
  // The right forearm is the stripped one: flesh gone, one bone shaft and a
  // strap of dark red muscle beside it, with the skin ending in a torn cuff.
  // It is on the right so it does not fight the exposed ribcage, which sits
  // slightly to the figure's left of centre in the reference.
  arm: {
    upper: f(0.130),
    fore: f(0.118),
    hand: f(0.076),
    shoulderSeparation: f(0.185),
    upperRadius: f(0.038),
    elbowRadius: f(0.032),
    wristRadius: f(0.026),
    // Radians the rest pose holds the arm out from vertical, length-weighted
    // over the limb. Smaller than the skeleton's 0.22 because these arms are
    // shorter and a wide flare on a short arm reads as a shrug.
    flare: 0.20,
    // The stripped forearm. `strippedSide` is which arm it is.
    strippedSide: 'R',
    boneRadius: f(0.014),
  },

  hand: {
    palmLength: f(0.036),
    palmWidth: f(0.046),
    palmDepth: f(0.024),
    fingers: 4,
    fingerLength: f(0.030),
    fingerRadius: f(0.0085),
    thumbLength: f(0.024),
    // Long dark claw nails. 0.016 is 1.7 px at game scale on its own, which
    // is nothing, but a nail is read by the SILHOUETTE it puts on the end of a
    // finger, not by its own shading, so it survives where a stitch would not.
    nailLength: f(0.016),
    nailRadius: f(0.006),
  },

  // --- legs ----------------------------------------------------------------
  //
  // The landmark drops are the constraint. hip to knee is f(0.165) of pure
  // vertical and knee to ankle f(0.128); each bone is a little longer than its
  // drop because it also bows outward. Believe M.y first.
  leg: {
    femur: f(0.172),
    tibia: f(0.134),
    thighRadius: f(0.050),
    kneeRadius: f(0.042),
    shinRadius: f(0.040),
    ankleRadius: f(0.032),
    hipSeparation: f(0.110),
    bow: 0.045,               // outward bow at mid-shaft, fraction of length
  },

  // Scuffed boots, and they are big. 0.150 of standing height is a realistic
  // foot proportion, which on a three-head figure reads as oversized, and that
  // is exactly right for a toy: big feet are what let a short-legged character
  // stand without looking like it is about to topple. The left boot has toes
  // coming through the front.
  boot: {
    length: f(0.150),
    width: f(0.078),
    height: f(0.090),         // sole to the top of the shaft
    heel: f(0.020),
    toeOut: 0.13,             // radians each foot splays off the walking line
    toesOutSide: 'L',
  },

  // --- shared surface vocabulary -------------------------------------------
  // Kept here rather than in each part, so the figure looks like one object.
  limbWaist: 0.86,            // limbs are barely waisted: this is soft flesh,
                              // not the skeleton's 0.62 hourglass bone
  jointBallScale: 1.10,       // joint bulbs, gentler than the skeleton's 1.22
};

// --- the joint map ----------------------------------------------------------
//
// EXACTLY the skeleton's names, in the skeleton's order. That is not a
// coincidence and it is not negotiable: it is what lets the animation half
// reuse the skeleton's machinery instead of writing a second copy of it, and
// what will let a zombie and a skeleton share one performance later.
//
// Every one of these is identity in the rest pose, with world-aligned local
// axes, so absolute Euler targets can be written without first reading the
// bind pose. Rest-pose flare is baked into geometry, never into a tilt node.
export const JOINTS = [
  'root',                                   // hips; the whole body hangs off it
  'spineLower', 'spineUpper', 'neck', 'head',
  'jaw',                                    // identity closed, +rotation.x opens
  'shoulderL', 'shoulderR',
  'elbowL', 'elbowR',
  'wristL', 'wristR',
  'hipL', 'hipR',
  'kneeL', 'kneeR',
  'ankleL', 'ankleR',
];

// Where each joint sits in the rest pose, in the rig group's own space, feet
// at y = 0 and facing +Z. Published so the animation half can plan a stride,
// a reach or a ground-contact test without importing the model or measuring a
// built scene graph. `model.js` asserts every one of these against the real
// scene graph at build time, so if this table and the model ever disagree the
// build fails rather than the walk drifting.
//
// x is the world x of the joint, and LEFT_X is already applied: the L entries
// are positive.
const S = M.arm.shoulderSeparation / 2;
const P = M.leg.hipSeparation / 2;
export const REST = {
  root:       [0, M.y.hip, 0],
  spineLower: [0, M.y.waist, 0],
  spineUpper: [0, M.y.chest, 0],
  neck:       [0, M.y.neck, 0],
  head:       [0, M.y.atlas, 0],
  jaw:        [0, M.y.jawHinge, M.head.jawHingeZ],
  shoulderL:  [+S, M.y.shoulder, 0],
  shoulderR:  [-S, M.y.shoulder, 0],
  elbowL:     [+S + M.arm.upper * Math.sin(M.arm.flare), M.y.shoulder - M.arm.upper * Math.cos(M.arm.flare), 0],
  elbowR:     [-S - M.arm.upper * Math.sin(M.arm.flare), M.y.shoulder - M.arm.upper * Math.cos(M.arm.flare), 0],
  wristL:     [+S + (M.arm.upper + M.arm.fore) * Math.sin(M.arm.flare), M.y.shoulder - (M.arm.upper + M.arm.fore) * Math.cos(M.arm.flare), 0],
  wristR:     [-S - (M.arm.upper + M.arm.fore) * Math.sin(M.arm.flare), M.y.shoulder - (M.arm.upper + M.arm.fore) * Math.cos(M.arm.flare), 0],
  hipL:       [+P, M.y.hip, 0],
  hipR:       [-P, M.y.hip, 0],
  kneeL:      [+P, M.y.knee, 0],
  kneeR:      [-P, M.y.knee, 0],
  ankleL:     [+P, M.y.ankle, 0],
  ankleR:     [-P, M.y.ankle, 0],
};

// How far each joint may be driven before the geometry self-intersects
// visibly. These are not physical limits, they are the angles this particular
// silhouette survives, measured on renders. The animation half is free to
// exceed them knowingly; they exist so nobody discovers the jaw clipping the
// sternum at frame 300 of a recording.
//
// The tight ones are all consequences of the head being a third of the figure:
// there is no neck to bend, the shoulders are narrower than the skull, and the
// arms are short enough that a full forward reach brings the hands to the chin.
export const LIMITS = {
  neck:       { x: [-0.30, 0.30], y: [-0.35, 0.35], z: [-0.22, 0.22] },
  head:       { x: [-0.55, 0.50], y: [-0.80, 0.80], z: [-0.35, 0.35] },
  jaw:        { x: [0.00, 0.62] },
  spineLower: { x: [-0.45, 0.75], y: [-0.40, 0.40], z: [-0.30, 0.30] },
  spineUpper: { x: [-0.50, 0.60], y: [-0.45, 0.45], z: [-0.30, 0.30] },
  shoulder:   { x: [-2.60, 1.10], y: [-0.90, 0.90], z: [-0.35, 1.45] },
  elbow:      { x: [0.00, 2.30] },
  wrist:      { x: [-0.80, 0.80], y: [-0.50, 0.50], z: [-0.45, 0.45] },
  hip:        { x: [-1.70, 0.90], y: [-0.40, 0.40], z: [-0.35, 0.60] },
  knee:       { x: [0.00, 2.20] },
  ankle:      { x: [-0.60, 0.75], y: [-0.25, 0.25], z: [-0.25, 0.25] },
};

// A walk cycle needs these three and nothing else about the legs, so they are
// derived once here rather than being re-measured in the animation half.
//
//   groundClear  how high the hip must lift for a swing foot to clear the
//                floor with the knee at its comfortable bend
//   stride       a natural full stride length for this leg, heel to heel
//   shamble      the stride a zombie actually takes, as a fraction of it. A
//                shambler is defined by taking short steps at a normal
//                cadence, not by taking normal steps slowly.
export const GAIT = {
  legLength: M.y.hip,
  groundClear: f(0.028),
  stride: M.y.hip * 0.72,
  shamble: 0.55,
};

export default M;
