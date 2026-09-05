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
//   sockets   0.26 of head height   (reference ~0.17)
//   grin      0.62 of head width    (reference ~0.45)
//   stitches  3.1 px long, x2 thick (reference: hairline)
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
    cavityTop: f(0.588),      // top lip of the window, just under the glenoid
    shoulder: f(0.598),       // glenoid, the pivot
    shoulderTop: f(0.628),    // top of the deltoid mass, where the jacket sits
    neck: f(0.640),           // neck pivot. See the note under `neck` below.
    chin: f(0.670),
    atlas: f(0.700),          // head pivot, at the base of the skull ball
    grin: f(0.740),           // centre line of the mouth
    // The jaw hinge, well above the mouth and behind it, where a real condyle
    // sits under the ear. Putting it at the mouth makes an opening jaw slide
    // rather than swing, which reads as the teeth falling off.
    jawHinge: f(0.790),
    // The nasal aperture, tucked between the lower halves of the orbits.
    // High and small, because that is where a skull's is and because the only
    // room for it is between the sockets: put it any lower and it merges with
    // the grin into one dark smear at game scale.
    nose: f(0.796),
    brow: f(0.874),           // centre line of the eye sockets
    ear: f(0.858),
    crown: f(1.000),
  },

  // --- the head ------------------------------------------------------------
  //
  // A third of the figure, which is the single loudest thing about a chibi.
  //
  // IT IS CLOSE TO A SPHERE. The third pass argued the opposite -- that a ball
  // has one broad terminator and reads as a flat disc at 34 px -- and built
  // real planes into it: a brow shelf, a cheek plane, a hard jaw taper, a
  // converging crown. What came back was a TEARDROP, narrowing to a soft point
  // at the top, and the owner rejected it on the silhouette before anyone got
  // as far as the shading. See POSTMORTEM 2.5.
  //
  // The argument was not wrong about shading; it was wrong about where the
  // shading has to come from. Form on the head now comes from SEPARATE
  // VOLUMES set into a plain ball -- two orbital rims, a nasal aperture, a
  // mouth trough, two ears -- every one of which throws a real shadow and a
  // real silhouette break without touching the ball's own outline. The ball
  // stays a ball.
  //
  // So: 0.316 wide, 0.326 deep, 0.330 tall. Those are within 4 per cent of
  // each other and the deviations do useful work -- depth beats width so the
  // horizontal section is not a circle and the head changes silhouette as it
  // turns, which is the one thing a true sphere cannot do. `crownFull` widens
  // the upper cranium so an ellipsoid's natural convergence toward its pole
  // does not creep back in, and it is tapered to vanish exactly at the pole so
  // the crown lands on its landmark height. `jawTaper` narrows the SIDES of
  // the jaw and vanishes at the chin point, for the same reason.
  head: {
    height: f(0.330),         // chin to crown
    // Within 4 per cent of the height and of each other: this is a ball.
    // Depth beats width on purpose, so the horizontal section is an ellipse
    // and the head changes silhouette as the walk turns it.
    width: f(0.316),
    depth: f(0.326),
    // Widens the upper cranium so the ellipsoid's convergence toward its pole
    // never reads as a point. Applied as a smooth hump that is zero at the
    // equator AND zero at the crown pole, so the head's height is still
    // exactly chin-to-crown and `M.y.crown` is honoured to the millimetre.
    crownFull: 0.055,
    // The orbital rim's crest height above the ball, at the top of the socket
    // where the brow ridge is. This is the raised ring of the eye grommet, not
    // a shelf carved into the cranium: the third pass's brow shelf pressed the
    // top of each orbit down and turned two round sockets into two almonds.
    browJut: f(0.021),
    // How far behind the head's centre plane the jaw condyle sits.
    jawHingeZ: f(-0.026),
    // A gentle forward swell over the lower face, so the mouth is a hole cut
    // INTO something. Half what the third pass used: the mouth is now a real
    // sunken trough with its own walls, so the swell no longer has to do the
    // work of making the opening read as an opening.
    muzzle: f(0.010),
    // How much narrower the head is at the SIDES of the jaw than at the
    // cheekbones. Applied as a hump that vanishes at the chin point, so the
    // chin lands on `M.y.chin` exactly and the lower face keeps its mass.
    // There has to be a broad band of green below the mouth or the grin reads
    // as a strip of teeth clipped under a skull, which is fault three of the
    // three that killed the last pass.
    jawTaper: 0.93,
    // Flatten the back of the cranium slightly. Stops the three-quarter
    // silhouette being a perfect circle, which is what makes a big head read
    // as a balloon.
    occiputFlat: 0.90,
  },

  // Deep, dark, and EMPTY: no eyeball, just shadow. The depth matters more
  // than the outline. A shallow socket lit by this key light fills with
  // bounce and turns grey; at 0.038 the socket floor is in the light's shadow
  // from every camera angle the game can show, so it stays black without any
  // material trickery.
  socket: {
    // ROUND, and the same both ways. The first build had them 0.090 by 0.086
    // with a slant, and between the brow pressing the top edge down and the
    // cheek pushing the bottom up they came out as angular almonds: a Roswell
    // grey, not a corpse. Round, deep, with a rim all the way round and a
    // colour inside that is not black.
    // 0.092 by 0.073 is 29 per cent of head WIDTH and 22 per cent of head
    // HEIGHT, measured off the reference. They were 0.092 square, which is 28
    // per cent of the height, and the pair plus their rims covered nearly the
    // whole upper face: the head read as mostly hole, and as a corrupted skull
    // rather than the reference's cute-and-gruesome toy.
    //
    // The rule that sets this, and it is worth stating because the legibility
    // argument pulls the other way: THE AMOUNT OF SMOOTH GREEN FACE LEFT IS
    // WHAT CARRIES THE CHARM. The reference has a broad clear forehead above
    // the sockets, a clear bridge between them and clear cheek below, and all
    // three have to survive. Oversizing for 34 px was right and it overshot;
    // the test is not only "can I see them at game scale" but "is this still
    // a face at arm's length".
    width: f(0.092),
    height: f(0.073),
    depth: f(0.030),
    // The socket is a GROMMET now, not a recess in the head's own surface:
    // a rim band and a dish, both built radially against the ball's own radius
    // function. `parts/head.js` has the reasoning and `parts/forms.js` has the
    // machinery. Three numbers that used to live here have gone with the
    // construction they described and are not silently still in force:
    //
    //   rim / rimAt / rimWide  the old raised ring's height, position and
    //                          falloff. The rim's crest is now `head.browJut`
    //                          and its shape is the grommet's jut profile.
    //   wobble                 a three- and five-lobed irregularity on the
    //                          outline, added for one round to disguise the
    //                          staircase where painted dark met skin. It did
    //                          not disguise it -- the two together read as
    //                          digital corruption -- and there is no staircase
    //                          to disguise any more: the visible edge of a
    //                          socket is the rim's own analytic ellipse.
    //   slant                  how hard the upper rim cut down toward the
    //                          nose. Any slant at all turned two round sockets
    //                          into two angry eyebrows, so it was zero, and a
    //                          zero with a paragraph attached is a trap for
    //                          the next person.
    //
    // Centre to centre. f(0.115) was the first pass and the two sockets came
    // within 0.02 of touching over the bridge, which read as one wide dark
    // band rather than two eyes. Pushed out until there is a clear strip of
    // green between them at game scale.
    separation: f(0.152),
  },

  // The nasal aperture. A skull's is a pear or teardrop: a narrow point at the
  // top between the orbits, widening to two lobes at the bottom. It is a third
  // of what says "the flesh has gone off this face", and the first build did
  // not have one at all, which is most of why the face read as smooth and
  // alien. Small, because there is only the gap between the sockets to put it
  // in, and dark inside for the same reason the sockets are.
  nose: {
    // SMALLER than the third pass, and the constraint is not the reference,
    // it is `M.y`. The aperture's centre is fixed at 0.796 and the mouth's at
    // 0.740, and both are landmarks. At 0.062 tall the aperture's own opening
    // ended 1 mm above the mouth's and its RIM hung down over the dark, which
    // reads as a flap of skin in the mouth. Shrunk to 0.046 there is a clear
    // strip of green between the two, which is what a skull has.
    width: f(0.058),
    height: f(0.042),
    depth: f(0.026),
    // Where the widest part of the pear sits, as a fraction of the aperture's
    // height measured from the bottom. Below the middle: that is what makes it
    // a teardrop rather than a lens.
    bulge: 0.34,
  },

  // Lipless: the mouth is a slot cut into the face, not lips laid on it, so
  // the teeth sit in a dark trough and read as bright blocks on black. That
  // contrast is the whole reason the grin survives to 34 px.
  grin: {
    // WIDE, and this is the feature carrying the most character in the
    // reference. 0.196 is 62 per cent of head width, up from 0.180: at 0.57
    // with small teeth in a shallow slot the face read as an orc rather than
    // as a corpse, and the difference is almost entirely the grin.
    //
    // It cannot go much wider. The mouth is a grommet and its rim reaches
    // `rhoOut` times the outline; at 0.205 the rim's corners arrive at the
    // side of the head and start wrapping round it.
    width: f(0.196),          // 0.62 of head width
    // Taller too, because big teeth need somewhere to stand. 5.4 px of slot
    // at game scale was not enough to seat a tooth AND leave dark around it,
    // and a tooth with no dark around it is a grey smear.
    height: f(0.058),
    depth: f(0.038),
    // How far the whole SLOT rises at the corners, as a fraction of the
    // mouth's own half-height. It raises the slot; it does not make it taller,
    // which is what the first version did and which produced a lens with a
    // pinched middle rather than a smile. See the outline solve in head.js.
    //
    // 0.32, not 0.55. At 0.55 the corners rise so far that the top edge in the
    // MIDDLE drops 1.7 px below the corners, and with the nasal aperture
    // sitting 0.056 above it that strip of skin reads as an upper lip on a
    // face that is supposed to be lipless. The corners still turn up; they
    // just no longer take the middle of the mouth down with them.
    curve: 0.32,
    // Fewer teeth, BIGGER teeth, and real gaps. Ten at this size is a grey
    // dither. Five upper positions with one missing and four lower with one
    // missing gives seven teeth in a 0.353 grin, which is a tooth every 5.8 px
    // at game scale: wide enough to be a block rather than a line, with dark
    // between every pair.
    //
    // The unevenness is the other half. Every tooth takes its own width,
    // length and lean from a hash of its index, over a range wide enough to
    // read (0.74 to 1.30 of nominal), and one upper tooth is a long fang. A
    // row of identical blocks reads as dentures.
    teeth: { upper: 5, lower: 4, gapUpper: 3, gapLower: 1, fang: 1 },
  },

  // Small round ears, and they matter far more than their size suggests: they
  // break the egg silhouette and they say "this was a person". The first build
  // had them at f(0.030), which is three pixels, tucked behind the equator and
  // effectively invisible; the head read as a bare ball from every angle.
  // `stand` is how far the ear stands PROUD of the skull, and it is the only
  // number here that matters -- an ear on this character is a silhouette
  // feature and nothing else.
  //
  // It is written as a protrusion rather than as a thickness because the
  // arithmetic is not obvious and got it wrong twice. A flat disc of radius r
  // seated on a ball of radius R, sunk by d, has its rim at
  // sqrt((R-d)^2 + r^2), and for a 0.046 ear on a 0.158 head that is still
  // INSIDE the ball for any sink over 12 mm: the first flat ear was entirely
  // swallowed and the silhouette test showed a bare skull. The lobe is
  // therefore sized from `stand` outward, and `sink` is chosen so the rim
  // still merges into the skull instead of floating off it.
  ear: { radius: f(0.046), stand: f(0.019) },

  // NO STITCHED SCARS in this pass, and the block that specified them has gone
  // rather than sitting here unread.
  //
  // The third pass drew them as real rods, correctly -- there is no texture
  // pipeline here and an alpha card has nothing to reflect -- and at the
  // shortest length that still reads as a line rather than a speck, 4.4 px.
  // They are off the model because the face is now carrying a brow ridge, two
  // orbital rims, a nasal aperture and a mouth trough as separate raised and
  // sunken volumes, and adding a ladder of small dark marks on top of that is
  // the thing POSTMORTEM 2.4 warns about from the other direction: the amount
  // of smooth green face left is what carries the charm. If they come back,
  // they belong over one brow rather than across the centre line, because a
  // mark down the middle of a symmetrical face reads as a seam in the moulding.

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
  // The neck is a PLUG, not a column: it fills the 4.4 px between the top of
  // the shoulder mass and the chin and is buried at both ends. Wider than the
  // third pass's 0.056, because at 0.056 the head visibly sat on a stalk in
  // the very first silhouette render -- a narrow neck under a head this large
  // reads as a bobblehead spring, which is a different character.
  neck: { length: f(0.030), radius: f(0.074) },

  // --- torso ---------------------------------------------------------------
  //
  // NARROW, and this is the single most important number on the body.
  //
  // Fault two of the three that killed the third pass: "the arms disappear
  // into the body. Shoulder to hip is one continuous mass with only fingers
  // emerging near the hem. A figure with no visible arms reads as a bollard."
  // The reference has clear daylight between each arm and the torso, and the
  // stripped forearm -- one of the character's two defining features -- is
  // only visible at all if that gap exists.
  //
  // The gap cannot be bought by moving the arms out. `REST` fixes the shoulder
  // at 0.0925, the elbow at 0.2130 and the wrist at 0.2552, and the animation
  // half is built against those. So the trunk moves IN instead, and these
  // widths are derived from the arm rather than chosen:
  //
  //   at the elbow  (y = 0.847) the arm's inner edge is at x = 0.155
  //   at the waist  (y = 0.765) it is at x = 0.176
  //   at the wrist  (y = 0.639) it is at x = 0.208
  //
  // Half a trunk width plus 0.040 of clearance has to stay under those. 0.040
  // is 2.3 px at game scale, which is the narrowest gap that still reads as a
  // gap rather than as a seam. The waist is therefore 0.124 -- against the
  // third pass's 0.196, which overlapped the arm by 21 mm and produced the
  // bollard. A chibi trunk SHOULD be this narrow under a head a third of the
  // figure tall; the old numbers were a realistic torso on a toy.
  //
  // Depth is barely reduced, so the body does not become a plank: the trunk is
  // now deeper than it is wide at the waist, which is also what keeps the
  // three-quarter silhouette from collapsing.
  torso: {
    chestWidth: f(0.176),
    chestDepth: f(0.124),
    // The narrowest point on the figure, and it is where the forearm passes.
    // A hard waist pinch is worth more to the silhouette than anything else on
    // the body: it is the only place the trunk can get out of the arm's way at
    // the three-quarter camera, because higher up the ribcage window needs the
    // width and lower down the pelvis has to carry the shorts.
    waistWidth: f(0.096),
    waistDepth: f(0.098),
    pelvisWidth: f(0.112),
    pelvisDepth: f(0.104),
    // The trunk's cross-section exponent. 3.2 was a rounded BOX and its
    // corners are what the three-quarter camera sees: a box projects its
    // diagonal, which is 1.41 times its face. 2.4 is nearly an ellipse and
    // projects 7 per cent narrower at 45 degrees for the same front width.
    section: 2.4,
    // Shell thickness at the rim of the cavity. This is what you see edge-on
    // looking into the chest, and it is what makes the opening read as a hole
    // through a solid body rather than as a decal.
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
    // WIDENED from 0.58 to 0.66 -- 76 degrees of the body's circumference.
    // The trunk had to lose width for the arms to read, and the window's
    // horizontal extent goes with it; opening the angle buys most of it back
    // and costs nothing, because a window that wraps further round the front
    // is exactly what the game's three-quarter camera wants. Narrower and the
    // cavity closes to a slot the moment the figure walks off-axis, which is
    // the failure mode: the feature that defines this character must not be a
    // front-view-only feature.
    halfAngle: 0.66,
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
    ribRadius: f(0.0086),
    ribSpacing: f(0.040),
    ribTop: f(0.572),
    // The spine runs down the middle of the cavity BEHIND the ribs, so its
    // top knobs show through the rib gaps and its bottom ones are exposed
    // below the lowest rib. That is what sells the cavity as an opening with
    // a back to it rather than as a patch painted on the chest: you are
    // looking past one piece of geometry at another.
    spineKnobs: 5,
    spineTop: f(0.548),
    spineSpacing: f(0.020),
    spineRadius: f(0.013),
  },

  // --- clothing -------------------------------------------------------------
  //
  // All of it geometry. The torn edges are a real sawtooth in the mesh outline
  // and the holes are real openings, for the same no-alpha reason as above.
  jacket: {
    top: f(0.616),            // sits on the deltoid
    // The hem hangs BELOW the shorts' waistband (0.400), not level with it,
    // so the two read as a jacket worn over shorts rather than as three
    // stacked bands of cloth round the hips.
    //
    // It was cropped to 0.452 for one round, on a measurement that turned out
    // to be answering the wrong question. The measurement was right: there is
    // no azimuth where a long hem leaves DAYLIGHT between the arm and the
    // trunk, because the near arm competes with the cloth at 42 to 109 degrees
    // and the far arm with 161 to 289, and the union is everything but the
    // front opening.
    //
    // But daylight is not what makes an arm read. AN ARM READS WHEN ITS OUTER
    // EDGE STANDS AGAINST THE BACKGROUND; what is behind the inner edge, cloth
    // or body, does not matter. The reference's arms overlap its jacket freely
    // and are perfectly legible. The test in `outer` (see the note in
    // parts/clothes.js) measures the outer contour instead, and a full-length
    // hem passes it with room to spare, so the coat comes back.
    hem: f(0.352),
    openHalfAngle: 0.80,
    thickness: f(0.010),
    tatter: f(0.022),         // depth of the sawtooth at the hem and cuffs
    sleeveTo: f(0.500),       // the sleeves are torn off just above the elbow
  },

  shorts: {
    top: f(0.400),
    hem: f(0.245),
    // Thicker and more ragged than the third pass. The jacket now covers the
    // waistband, so all the shorts have to say "cloth" with is the 11 px band
    // of cuff between the jacket's hem and the bare knee. A thin sheet with a
    // shallow sawtooth in that space reads as a painted band the same colour
    // as the leg; a thick one with a deep torn hem reads as rag.
    thickness: f(0.019),
    tatter: f(0.042),
    // Two, not the reference's three. One worn through the seat, on the
    // waistband piece, and one on the LEFT thigh cuff with a shard of bone
    // behind it. A hole in a rag with more rag behind it is not a wound, so
    // every hole here has to have something to show, and there are only two
    // places on a pair of shorts where that is true.
    holes: 2,
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
    //
    // FROZEN: `REST` derives the elbow and the wrist from it, and the
    // animation half is built against those positions.
    flare: 0.20,
    // How far the drawn arm sits OUTBOARD of its own joint line, at the
    // shoulder, the elbow and the wrist. The joints stay exactly where `REST`
    // puts them -- this is the contract's "rest-pose flare is baked into
    // geometry, never into a tilt node" taken literally, and it is the only
    // lever left once the joint positions are frozen and the trunk has already
    // been narrowed as far as the ribcage allows.
    //
    // Kept small on purpose. The elbow's visual centre ends up 2.3 px inboard
    // of its pivot, so a bent elbow swings about a point slightly inside the
    // bulb; at 105 px that is not resolvable, and anything larger would read
    // as the elbow sliding as it folds.
    outboard: [f(0.013), f(0.026), f(0.038)],
    // How far the HAND hangs out from vertical, at the wrist. Wider than the
    // arm's own flare: it costs no pivot accuracy, because there is no joint
    // below the wrist for it to displace.
    handSplay: 0.44,
    // The stripped forearm. `strippedSide` is which arm it is.
    strippedSide: 'R',
    boneRadius: f(0.017),
  },

  hand: {
    palmLength: f(0.036),
    palmWidth: f(0.041),
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
    // Slimmer than the third pass. The hands hang beside the upper thigh, so
    // the thigh is the LAST thing between the arm and the background: a fat
    // thigh closes the daylight the narrow waist just opened.
    // The thigh is thin and the shin is not, and that split is deliberate.
    // The hands hang beside the THIGH, so every millimetre there costs
    // daylight; nothing hangs beside the shin, so the calf is free to carry
    // the chunk a toy needs. It also reads correctly: a chibi's mass belongs
    // low, in the calves and the boots.
    thighRadius: f(0.040),
    kneeRadius: f(0.043),
    shinRadius: f(0.043),
    ankleRadius: f(0.033),
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
// EVERY NUMBER IS A SIGNED EULER TARGET on the joint's own axes, not a
// magnitude. The joints are identity at rest with world-aligned axes and the
// figure faces +Z, so on any limb hanging downward a POSITIVE rotation.x
// swings the lower segment BACKWARD and a negative one swings it forward.
// That makes the two hinges read opposite:
//
//     knee    [0, 2.20]     positive: the heel comes back. A knee folds back.
//     elbow   [-2.30, 0.10] negative: the hand comes forward. An elbow folds
//                           forward, and this entry was published as
//                           [0, 2.30] in the first pass, which is a knee. The
//                           animation half caught it by taking the fold
//                           direction off the rig's own rest pose instead of
//                           believing the table, so nothing shipped broken,
//                           but the table was lying.
//
// The rest, checked at the same time and correct as published: `hip` and
// `shoulder` are negative-forward, which is why their forward range is the
// larger one; `ankle` positive is toes down; `jaw` positive opens, which is
// also published on the node as userData.openSign; `wrist`, `neck`, `head`
// and the two spine joints are near-symmetric and carry no sign trap.
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
  elbow:      { x: [-2.30, 0.10] },
  wrist:      { x: [-0.80, 0.80], y: [-0.50, 0.50], z: [-0.45, 0.45] },
  hip:        { x: [-1.70, 0.90], y: [-0.40, 0.40], z: [-0.35, 0.60] },
  knee:       { x: [0.00, 2.20] },   // positive: heel back. See the note above.
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
