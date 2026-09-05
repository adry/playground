import * as THREE from 'three';
import { registerStone, inkText, inkCross } from '../tombstones.js';

// The boulder: a rough natural fieldstone stood on end, with one face dressed
// flat and a shallow panel cut into it for the inscription.
//
// Every other stone in the yard was cut to a shape before it was carved. This
// one was found in a field, tipped upright and worked in exactly one place.
// Three things carry that, and every one of them had a cheaper wrong answer
// that a render threw out.
//
// 1. FACETS, NOT NOISE. A rock reads as a rock through a few large planes
//    meeting at soft arrises, not through fine displacement. So the mass is a
//    literal intersection of half spaces, softened: fourteen planes, and the
//    surface is a radial function of direction alone,
//
//        r_i(u) = d_i / (u . n_i)          the ray's hit on plane i
//        R(u)   = -k ln( sum_i exp(-r_i/k) )
//
//    the exponential smooth minimum of them, which is the exact polyhedron as
//    k goes to zero and a version with a fillet of roughly k at every arris
//    otherwise. Being radial it cannot self intersect, it tessellates as a
//    plain quad grid, and its normals come off the parametrisation rather than
//    out of computeVertexNormals.
//
//    The smooth min is LOCAL and that is the whole reason it is this and not
//    the p-norm, which was written first. A p-norm blends every plane
//    everywhere -- two planes whose ray distances differ by a tenth still pull
//    each other in by a twentieth -- so a dozen planes on a sphere sum to a
//    sphere, and the first render was a smooth egg with an inscription on it
//    and not one flat face anywhere. The smooth min above weighs planes by
//    exp(-(r_i - r_min)/k): at k = 0.017 a plane 50 mm further out contributes
//    e^-3, and one a whole radius further out contributes nothing at all. So a
//    facet stays flat right up to its own arris, which is what a broken
//    fieldstone actually looks like.
//
// 2. THE SILHOUETTE IS NOT MONOTONIC, AND THAT IS THE WHOLE DESIGN. The second
//    pass of this stone was rejected on exactly this and it is the trap worth
//    naming, because the geometry above walks straight into it. An intersection
//    of half spaces seated on its own flat bottom is a stone with a batter: it
//    is widest where it meets the floor and narrows all the way to the top, and
//    that is the profile of a CUT stone. Four seeds of it side by side were
//    four traffic bollards. Jittering the plane distances cannot fix it, since
//    every jitter is still a convex body sitting on its widest section.
//
//    Four things fix it, and all four are structural rather than surface:
//
//      IT IS NOT CONVEX. This is the one that matters most and it took two
//      passes to see, because it is a property of the machinery rather than of
//      the numbers fed to it: an intersection of half spaces is convex, and a
//      convex body has a convex OUTLINE from every angle. No plane table and no
//      jitter can put a notch in it. Real rock is full of notches, because that
//      is what a conchoidal fracture leaves. So the radial function has two or
//      three SCOOPS subtracted from it: broad shallow dishes, 45 to 95 mm deep
//      and 180 to 420 mm across, in seeded directions. A radial function stays
//      single valued whatever is subtracted from it while it stays positive, so
//      the surface still cannot self intersect and everything downstream --
//      normals, seating, the pocket's clearance bisection -- goes on working
//      unaltered. What changes is that the outline now has bites out of it.
//      They also give the shading something honest to do: a dish and the
//      inscription's pocket are the only two places this body occludes itself
//      at all.
//
//      THE FOOT IS TUCKED. Five planes at about -18 degrees of elevation, one
//      in five dropped per seed, cut the base in to about two thirds of the
//      waist, so the widest section of the stone is well above the floor and
//      the flanks OVERHANG the ground below them. Five and not three: see the
//      note on the table itself, since three was tried and did not reach the
//      outline.
//
//      THE TOP IS A BREAK, NOT AN APEX. One big slanted plane whose azimuth
//      swings 45 degrees either way per seed, plus two smaller ones that snap a
//      corner off it. Two symmetric top planes meeting in a tidy ridge is the
//      other half of the bollard.
//
//      IT IS NOT PLUMB. Up to eight degrees of roll and a little pitch, seeded.
//      A found stone was shoved into a hole, not set by a mason, and the axis
//      being off vertical is most of what says so at a glance.
//
//    Measured over sixteen seeds, against the version that was rejected, on the
//    outline the camera actually sees (boulder-lab's silhouette() probe):
//
//                       rejected                 this
//      widest section   0.05 of the height       0.40, from 0.10 to 0.73
//      widest / base    1.007, sd 0.017          1.125, sd 0.096, up to 1.34
//      same in plan     1.011, sd 0.026          1.129, sd 0.144, up to 1.57
//      outward travel   0.043                    0.141
//      height/width     0.99                     1.13
//
//    The first two lines are the whole argument. A stone with a batter is 1.00
//    by definition and the rejected one measured 1.007 with a standard
//    deviation of 0.017, which is to say it was that stone on every seed. The
//    third line is the same question asked of the solid rather than of one view
//    of it, and its standard deviation going from 0.026 to 0.144 is where the
//    four seeds stopped being four of the same object.
//
// 3. THE DRESSED PANEL IS A POCKET, NOT A DECAL. It is milled into the rock
//    along the panel normal: a flat floor 32 mm below the dressed face, a 10 mm
//    roll off that floor, a short vertical wall, and a 16 mm roll where the
//    wall meets the rough stone. The mesh runs continuously through all four,
//    so the boundary is real geometry that turns in the light rather than a
//    line in a texture, and it is the sharpest edge on the piece.
//
//    A convex body cannot have a recess, which is the trap here: the smooth min
//    surface is convex by construction, so the pocket cannot be a plane pushed
//    in. It is built instead as a run of rings that leave the panel plane,
//    climb the wall and rejoin the convex surface at a curve found by
//    intersection rather than by assumption -- wallTop() bisects for it, and
//    fitOutline() shrinks the pocket until every column of it clears. That
//    check is not theoretical: at the first fillet width the facet was only
//    flat in the middle third of itself and the pocket shrank to two thirds of
//    its size, which ran the letters off the edge of the panel.
//
// SHADING. See the TONE block below. Short version: the renderer alone lights
// every facet of a convex body at nearly the same value and the piece came back
// reading as smooth clay. The fix is vertex colour, and it is the same finding
// dirtpile.js and gravelpath.js each reached on their own.
//
// LEAN AND THE CAMERA. The camera is orthographic, 45 degrees round and 29
// degrees up, so a plumb face pointed at it presents 0.875 of itself and a face
// tipped back 29 degrees presents all of it. The dressed face is tipped back
// 20, which buys 0.985 and is also simply what a fieldstone stood on end does.
// The inscription is therefore on a face very nearly square to the camera,
// which is the whole reason this design can carry the registry's flat face
// texture at all.

const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// --- the panel -------------------------------------------------------------
//
// PW and PH are the registry's halfWidth and height/2: the bounding box of the
// pocket, and therefore the rectangle the face texture is mapped onto. They are
// also what fixes the physical size of the carving, since the registry's groove
// wall is 1.1% of the face texture's height whatever that height is: at
// 2 * PH = 0.54 that is a 5.9 mm wall, between book.js's 8.8 and stump.js's
// 3.1. A rough stone's inscription being a shade finer than the family's is the
// right side to be out on.
//
// 0.50 by 0.54 is a little over half the width of the rock and half its height,
// which is what a mason dressing one face of a found stone actually leaves: a
// worked patch with rough rock all round it, not a planed front.
const PW = 0.25;
const PH = 0.27;
// Where the panel points. Tipped back 20 degrees (see the header) and skewed 7
// degrees off the family's front, because a found stone's flat face does not
// line up with anything and a hair of skew is free legibility at the set's own
// camera azimuth.
const PANEL_AZ = 7 * DEG;
const PANEL_EL = 20 * DEG;
// The panel plane's distance from the rock's centre. SMALL on purpose: the
// nearer the plane, the deeper the cut and the wider the flat facet it leaves,
// and the facet has to be comfortably bigger than the pocket or the pocket's
// corners hang out in space. At 0.235 against corner chamfers at 0.35 the facet
// is a little larger than the pocket all round, which is a dressed patch with
// rough rock at its edges rather than a whole planed front.
const DP = 0.235;
const RECESS = 0.032;  // how far the panel floor sits below the dressed face
const FILLET = 0.010;  // roll off the floor onto the wall
const ARRIS = 0.016;   // roll where the wall meets the rough rock

// The pocket's outline, in panel coordinates: a superellipse, which at k = 3.2
// is a rectangle with generously rounded corners, a chiselled patch rather than
// a lozenge or a tile. The corners matter: at the bbox corner the panel plane
// is 57 degrees off axis and the rock has started to turn away, so a square
// patch is exactly the shape that cannot clear.
const OUT_AX = 0.840;
const OUT_AY = 0.840;
const OUT_K = 3.2;

// --- the mass --------------------------------------------------------------
//
// Fourteen planes, as (azimuth, elevation, distance). Azimuth is measured from
// the family's front (+z) toward +x, elevation from the horizon. The dressed
// face is the fifteenth and lives in radius(), not here, because it gets its
// own tighter fillet.
//
// `spin` is how many degrees of azimuth this plane is allowed to wander per
// seed, and `drop` is the chance it is left out of a given stone altogether.
// Both exist because ordinary jitter was not enough: a previous pass moved
// every direction by 11 degrees and every distance by 10 percent and the four
// seeds still came out indistinguishable, because a small move of a plane that
// is always present changes a corner and not a shape. Dropping a plane changes
// which faces the stone HAS. Only the corner cuts and the foot planes may go;
// the six dominant faces are always there or the body stops being closed.
//
// The horizontal distances were raised ten percent and the vertical ones cut
// thirteen on the last pass, and the reason is worth keeping: tucking the foot
// narrows a stone without shortening it, so the first version of the tuck took
// the outline's height over its width from 0.99 to 1.39 and the piece stopped
// being the squat one of the set, which is half of why it is here.
//
// The list is not a regular solid either, and two passes that went that way
// came back as a moulded doorstop. What a broken fieldstone has is a few
// DOMINANT faces and then a scatter of small ones that only cut a corner off,
// so the distances run from 0.38 to 0.52 and the near ones are the corner cuts.
// A plane at 0.385 between the front and a flank leaves a wide chamfer where the
// two would otherwise meet in one long arris, and that chamfer is most of what
// says "this broke" rather than "this was moulded".
const PLANES = [
  // the dominant faces
  { az: 196, el: 0, d: 0.457 },                        // back
  { az: -86, el: 6, d: 0.501 },                        // left flank
  { az: 94, el: -4, d: 0.517 },                        // right flank
  { az: 0, el: -88, d: 0.487 },                        // the bottom it stands on
  { az: 128, el: 46, d: 0.522, spin: 90, elspin: 34 }, // the top, one big slanted break
  // the foot. These are what put the widest section of the stone ABOVE the
  // ground and give the flanks something to overhang, and there are five of
  // them, evenly round, because three scattered ones did not work. A plane only
  // narrows the base in ITS OWN direction, and the outline you see is set by
  // the two azimuths square to the camera; with three tucks at random azimuths
  // the odds are against either of those being one of them, and the measured
  // flare came back 1.02, which is a stone with a batter. Five at 60 degree
  // spacing, with a fifth of them dropped per seed, narrow the base from every
  // side while still leaving the undercut lopsided.
  //
  // -18 degrees rather than the -26 tried first: the shallower the plane, the
  // higher up the stone it stops binding, and the height of the widest section
  // is the whole point. At -18 and 0.42 the base comes in to about two thirds
  // of the waist and the waist lands near 0.35 of the height.
  //
  // None of them is in front. The dressed face is one plane running the full
  // height of the stone, which is what a mason planing one side of a boulder
  // actually leaves, and a tuck under it would both cut into the panel's
  // clearance and make the face lean out over its own foot.
  { az: 65, el: -18, d: 0.468, spin: 22, drop: 0.22 },
  { az: 125, el: -16, d: 0.457, spin: 22, drop: 0.22 },
  { az: 180, el: -21, d: 0.484, spin: 22, drop: 0.22 },
  { az: 235, el: -19, d: 0.462, spin: 22, drop: 0.22 },
  { az: 295, el: -17, d: 0.446, spin: 22, drop: 0.22 },
  // the corner cuts
  { az: 48, el: 16, d: 0.402, spin: 22, drop: 0.15 },  // front to right flank
  { az: -40, el: 10, d: 0.385, spin: 22, drop: 0.15 }, // front to left flank
  { az: -138, el: 14, d: 0.451, spin: 26, drop: 0.30 },
  { az: 142, el: 10, d: 0.473, spin: 26, drop: 0.30 },
  { az: -34, el: 62, d: 0.496, spin: 56, drop: 0.25 }, // snaps the top left corner off
  { az: 68, el: 70, d: 0.522, spin: 56, drop: 0.35 },  // and nicks the top right
];

// The fillet the smooth min puts on an arris, in world units, and it is two
// numbers rather than one.
//
// SMIN_K is what the rough facets meet each other on, and finding it was the
// longest part of this build. The registry rolls every edge in the set on a
// 62 mm quarter round, so 60 was tried first: it is far too much here. A fillet
// that size is wider than the corner chamfers above are long, so it eats them,
// and what comes back is one smooth wedge with an inscription on it. Rendering
// the same planes at 6 mm settled it, because that version has the silhouette
// the piece wants, straight runs and real corners, and the only thing missing
// from the 60 mm one was the fillet size. 45 and 26 were still soft.
//
// 17 mm is the answer, and the tessellation is why it cannot go lower: rings
// are about 30 mm apart on the rough shell, so a fillet tighter than this is
// sampled once, the grid crosses the arris at a grazing angle and scallops it,
// and the render comes back with a crimped seam down the edge. 17 mm is one
// pixel at scene scale, so nothing there reads as sharp; it is eight at the
// size the piece is inspected, which is a soft edge and not a knife.
//
// SMIN_PANEL is what the DRESSED face meets the rough rock on, and it is
// smaller still. A worked face has a harder boundary than a broken one, that
// difference is the whole "someone did this" of the design, and it is also what
// makes the panel possible at all: the pocket cut into the facet has to clear
// the rock all the way round, and at 60 mm the facet was only flat in the
// middle third of itself, which shrank the pocket to two thirds of its size and
// ran the letters off the edge of it.
const SMIN_K = 0.017;
const SMIN_PANEL = 0.012;

// The scoops: how many, how deep, how wide. Width is the half angle of the
// dish measured from the rock's centre, so at a radius near 0.45 a scoop of
// 0.40 rad is about 190 mm across and one of 0.80 rad about 420 mm. Kept
// SHALLOW relative to that: a dish deeper than about a seventh of its width
// stops reading as a fracture scar and starts reading as a bite out of an
// apple, which is cracked.js's territory and not this stone's.
const SCOOP_MIN = 2;
const SCOOP_MAX = 3;
const SCOOP_DEEP = [0.045, 0.095];
const SCOOP_WIDE = [0.38, 0.82];

// A very slow swell over the rough surface, three waves in DIRECTION rather
// than in position, so the whole thing stays a single valued radial function.
// 9 mm on a stone a metre tall: enough that a facet is not a machined plane,
// far too broad to be the fine displacement the brief bans. It is faded out
// over the dressed face, which is both correct (that face was worked) and
// necessary (the pocket's clearance is measured against this surface).
const SWELL = 0.009;

// The height the stone is normalised to, before it is sunk. It is a RANGE and
// it is applied by measurement, not by hope: fourteen jittered planes, some of
// them missing, put the top anywhere between 1.1 and 1.6 on their own, and the
// first render of this pass came back a third of a metre too tall. measureH()
// samples the radial function over a Fibonacci sphere and every rough plane is
// then scaled by the ratio, twice, which is exact because the surface is
// homogeneous in the plane distances. So height stays a deliberate variable
// with a known range instead of being whatever the jitter happened to produce.
// These are LOCAL heights, before the tilt shortens the piece and the sink
// takes 100 mm off it; measured on the finished prop over twelve seeds they
// come out between 1.00 and 1.19, which is the band the brief asked for.
const TARGET_LO = 1.08;
const TARGET_HI = 1.26;

const SEG_A = 96;   // columns round the piece
const SEG_R = 46;   // rings from the pocket rim round to the back

// How deep the whole piece is buried. A found stone is bedded, not stood on the
// grass; the registry adds another 12 mm of its own sink on top of this. It is
// also 100 rather than 55 because the tucked foot narrows toward the floor, and
// burying the last of that taper is what stops the stone reading as balanced on
// a point.
const SINK = 0.100;

// --- how it is not plumb ---------------------------------------------------
//
// Roll is the big one: it is the axis tipping sideways, it is the most visible
// thing in the silhouette, and at eight degrees on a metre of stone the top
// moves 150 mm off the base. Pitch is biased FORWARD, because forward brings
// the dressed face nearer to square with a camera that is only 29 degrees up
// and backward takes it away.
const ROLL = 0.28;          // full width, so up to 8 degrees either way
const PITCH_MIN = -0.02;
const PITCH_MAX = 0.075;

// --- the foot --------------------------------------------------------------
//
// A few small stones round the base. They are not decoration: a single convex
// mass meeting a flat floor along one clean curve reads as a prop set down on
// the ground, and three or four lumps half buried against it read as a stone
// that has been there long enough for the ground to come up round it.
const FOOT_MIN = 3;
const FOOT_MAX = 6;

// --- tone ------------------------------------------------------------------
//
// The renderer cannot separate the facets of a convex body on its own and the
// render proved it: arrises visible, every face the same value, the whole thing
// reading as smooth clay. dirtpile.js and gravelpath.js each hit this and
// reached the same answer independently, that a field of rounded forms lit from
// above with no occlusion between them is one soft mass whatever value it is
// painted. So the modelling that the light cannot give is baked into vertex
// colour. It costs no triangles and no draw calls: the geometry is already one
// buffer, and the registry's material is this stone's alone once its slab is
// removed, so switching vertexColors on affects nothing else.
//
// Four terms, and each answers something real:
//
//   FACET TONE. Every plane gets its own value, blended by the same smooth min
//   weights that built the surface, so the blend follows the geometry exactly
//   and a facet is one flat tone right up to its arris. This is the term that
//   does the work. A broken stone's faces are different ages: the one that
//   snapped last is clean and the one that has faced the weather for a century
//   is not, and half a stop between them is what makes a rock read as a rock
//   rather than as a moulded lump.
//
//   ARRIS. A little darker where two faces meet. On a real stone that is grit
//   and lichen in the fracture; here it is also what stops the blend between
//   two tones reading as a smooth ramp, which would undo the term above.
//
//   SKY. Down-facing surfaces see less of the sky. The hemisphere light does
//   some of this already, so the amount here is small: it is a nudge that
//   separates a top facet from a side one, not a second lighting model.
//
//   GROUND. The floor occludes the sky for anything close to it, which is the
//   contact term a single directional light cannot give. It runs over the
//   bottom 240 mm, and the foot stones get it too.
//
// The dressed face is exempt from the arris term and carries its own slightly
// LIGHTER tone. It was worked, so it is fresher stone than the broken faces
// round it, and it is also the one surface on the piece the eye has to read.
const TONE_SPREAD = 0.160;
const PANEL_TONE = 1.06;
const ARRIS_DARK = 0.24;
const SKY_DARK = 0.15;
const GROUND_DARK = 0.20;
const GROUND_REACH = 0.24;
// Inside the pocket. Its floor is occluded by its own wall, most at the edges,
// and the wall itself is occluded most at the bottom. This one and the scoop
// term below are honest occlusion rather than nudges: they are the two places
// the surface is genuinely concave.
const POCKET_EDGE = 0.12;
const POCKET_WALL = 0.26;
// And in a scoop, which is the other concavity and the honest one: the floor of
// a dish sees a good deal less of the sky than the facet round it. Scaled by
// how deep into the dish the point is, against the deepest a dish can be.
const SCOOP_DARK = 0.26;

// Initials rather than a phrase. A field boulder is the marker a parish put on
// a grave it could not afford a mason for, and two letters is what those carry.
// It is also the quietest mark available: the panel is the second smallest face
// in the set and the postmortem in tombstones.js is emphatic that the marks
// were never what carried a stone's identity.
const INITIALS = ['J.S.', 'A.H.', 'T.B.', 'R.C.', 'E.P.'];

// ---------------------------------------------------------------------------
// the rough mass

function dir(azDeg, elDeg) {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// The panel's frame. e3 is the panel normal, e2 is up ON the panel and e1 is
// panel-right, ordered so that e1 cross e2 is e3: seen from outside, +e1 runs
// the way +x runs on the family's front face, which is the direction slabUV
// maps to increasing u. Get that backwards and the inscription is mirrored.
function panelFrame(azSkew, elTilt) {
  const az = PANEL_AZ + azSkew;
  const el = PANEL_EL + elTilt;
  const e3 = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const e2 = new THREE.Vector3(0, 1, 0).addScaledVector(e3, -e3.y).normalize();
  const e1 = new THREE.Vector3().crossVectors(e2, e3).normalize();
  return { e1, e2, e3 };
}

function makeRock(rng) {
  const planes = [];
  for (const p of PLANES) {
    const roll = rng();
    if (p.drop && roll < p.drop) continue;
    planes.push({
      n: dir(p.az + (rng() - 0.5) * (p.spin ?? 14), p.el + (rng() - 0.5) * (p.elspin ?? 12)),
      d: p.d * (0.88 + rng() * 0.24),
      tone: 1 + (rng() - 0.5) * 2 * TONE_SPREAD,
    });
  }
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const frame = panelFrame((rng() - 0.5) * 0.20, (rng() - 0.5) * 0.10);

  // The scoops, in directions drawn away from the dressed face. Away, because
  // the face was worked flat and because a dish reaching into it would eat the
  // clearance the pocket needs; the same reason the swell is faded off it.
  const scoops = [];
  const nScoop = SCOOP_MIN + Math.floor(rng() * (SCOOP_MAX - SCOOP_MIN + 1));
  for (let i = 0; i < nScoop; i++) {
    // No rejection loop needed: an azimuth at least 75 degrees off the face's,
    // at any elevation, is always clear of it.
    const away = PANEL_AZ / DEG + (rng() < 0.5 ? -1 : 1) * (75 + rng() * 105);
    // The first one is held near the horizon, where the outline is: a dish up
    // on the shoulder shades nicely and does nothing at all to the silhouette.
    const el = i === 0 ? -14 + rng() * 34 : -50 + rng() * 115;
    scoops.push({
      n: dir(away, el),
      depth: SCOOP_DEEP[0] + rng() * (SCOOP_DEEP[1] - SCOOP_DEEP[0]),
      w: SCOOP_WIDE[0] + rng() * (SCOOP_WIDE[1] - SCOOP_WIDE[0]),
    });
  }
  // The dressed face is one of the rock's own bounding planes and it has to be
  // there: left out, the front of the mass is bounded by whatever is next to
  // it, the panel plane ends up a couple of hundred millimetres inside the
  // stone, and the pocket becomes a well drilled into solid rock. That was the
  // first render and it looked exactly like a potato with a slot in it. It is
  // applied in radius() rather than pushed onto this list because it gets its
  // own, tighter fillet.
  const rock = {
    planes,
    ph,
    frame,
    scoops,
    hits: new Float64Array(planes.length),
    who: new Int32Array(planes.length),
  };
  // Normalise the height. Twice, because the dressed face is folded in at a
  // fixed distance and does not scale with the rest, so one pass leaves a
  // percent or so on the table.
  const want = TARGET_LO + rng() * (TARGET_HI - TARGET_LO);
  for (let pass = 0; pass < 2; pass++) {
    const k = want / measureH(rock);
    for (const p of rock.planes) p.d *= k;
  }
  return rock;
}

// The body's height, sampled over a Fibonacci sphere. 512 directions is about
// a degree and a half apart, which on a shape whose smallest fillet is 17 mm
// finds the top and the bottom to well under a millimetre.
const _mu = new THREE.Vector3();
function measureH(rock) {
  let top = -Infinity;
  let bot = Infinity;
  const N = 512;
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    _mu.set(r * Math.cos(th), y, r * Math.sin(th));
    const py = radius(_mu, rock) * y;
    if (py > top) top = py;
    if (py < bot) bot = py;
  }
  return top - bot;
}

// How deep into a scoop a direction is, 0 outside every dish and 1 at the
// bottom of one. The falloff is (1 - (a/w)^2)^2, which is flat at the middle,
// tangent to zero at the rim and has no corner anywhere, so the dish blends
// into the facet it is cut out of instead of ending on a crease.
function scoopAt(u, rock) {
  let s = 0;
  for (const sc of rock.scoops) {
    const c = u.dot(sc.n);
    if (c <= 0) continue;
    const a = Math.acos(Math.min(1, c)) / sc.w;
    if (a >= 1) continue;
    const t = 1 - a * a;
    s += t * t * sc.depth;
  }
  return s;
}

// Radius of the surface in a direction. The dressed face is exempt from the
// swell and from the scoops, which is why this takes the frame.
function radius(u, rock) {
  // Ray distance to every rough plane the ray can actually reach, then the
  // smooth min of them, offset by the smallest so the exponentials cannot
  // overflow. The dressed face is held out of that sum and folded in after, on
  // its own tighter fillet.
  let best = Infinity;
  const hits = rock.hits;
  let n = 0;
  for (const p of rock.planes) {
    const c = u.dot(p.n);
    if (c <= 0.02) continue;   // edge on or behind: this plane bounds nothing here
    const t = p.d / c;
    hits[n++] = t;
    if (t < best) best = t;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.exp(-(hits[i] - best) / SMIN_K);
  let r = best - SMIN_K * Math.log(sum);

  const cp = u.dot(rock.frame.e3);
  if (cp > 0.02) {
    const rp = DP / cp;
    const m = Math.min(r, rp);
    r = m - SMIN_PANEL * Math.log(Math.exp(-(r - m) / SMIN_PANEL) + Math.exp(-(rp - m) / SMIN_PANEL));
  }

  // The slow swell over the rough surface. Faded out over the dressed face,
  // which is both correct (that face was worked) and necessary, since the
  // pocket's clearance is measured against this surface.
  const worked = smoothstep(0.85, 1.30, Math.acos(clamp01(cp)));
  const ph = rock.ph;
  const swell =
    0.48 * Math.sin(2.7 * u.x + ph[0]) +
    0.27 * Math.sin(2.3 * u.y + ph[1]) +
    0.25 * Math.sin(3.1 * u.z + ph[2]);
  return r + SWELL * swell * worked - scoopAt(u, rock) * worked;
}

// Which face a direction belongs to, and how much of an arris it is standing
// on. Both come out of the SAME smooth min weights that built the surface, so
// the tone boundary and the geometric arris are the same curve to the pixel.
// `tone` is the weighted blend of the planes' own tones and `arris` is one
// minus the largest single weight, so it is 0 in the middle of a facet and a
// half where two faces meet.
const _shade = { tone: 1, arris: 0 };
function faceShade(u, rock) {
  let best = Infinity;
  const hits = rock.hits;
  const who = rock.who;
  let n = 0;
  for (let i = 0; i < rock.planes.length; i++) {
    const c = u.dot(rock.planes[i].n);
    if (c <= 0.02) continue;
    const t = rock.planes[i].d / c;
    hits[n] = t;
    who[n] = i;
    n++;
    if (t < best) best = t;
  }
  let sum = 0;
  let toneSum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-(hits[i] - best) / SMIN_K);
    sum += w;
    toneSum += w * rock.planes[who[i]].tone;
    if (w > peak) peak = w;
  }
  let tone = toneSum / sum;
  let arris = 1 - peak / sum;

  // Fold the dressed face in on its own weights, exactly as radius() does.
  const cp = u.dot(rock.frame.e3);
  if (cp > 0.02) {
    const rr = best - SMIN_K * Math.log(sum);
    const rp = DP / cp;
    const m = Math.min(rr, rp);
    const wr = Math.exp(-(rr - m) / SMIN_PANEL);
    const wp = Math.exp(-(rp - m) / SMIN_PANEL);
    const s = wr + wp;
    tone = (wr * tone + wp * PANEL_TONE) / s;
    // The dressed face's own edge is a worked one, so it does not take the
    // grit-in-the-fracture darkening the broken arrises do; what it gets is the
    // geometry of the pocket rim, which is sharper than any of them.
    arris = (wr / s) * arris;
  }
  _shade.tone = tone;
  _shade.arris = arris;
  return _shade;
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _uu = new THREE.Vector3();
const AXIS_A = new THREE.Vector3(0, 1, 0);
const AXIS_B = new THREE.Vector3(1, 0, 0);
const NEPS = 0.0035;

function surfacePoint(u, rock, out) {
  return out.copy(u).multiplyScalar(radius(u, rock));
}

// Normal from the parametrisation rather than from the plane sum, so the swell
// and the smooth min are differentiated together and there is nothing to keep
// in step. Two tangent steps and a cross product; this runs a few thousand
// times at build time and never again.
function surfaceNormal(u, rock, out) {
  _t1.crossVectors(u, Math.abs(u.y) < 0.9 ? AXIS_A : AXIS_B).normalize();
  _t2.crossVectors(u, _t1).normalize();
  surfacePoint(u, rock, _p0);
  surfacePoint(_uu.copy(u).addScaledVector(_t1, NEPS).normalize(), rock, _p1).sub(_p0);
  surfacePoint(_uu.copy(u).addScaledVector(_t2, NEPS).normalize(), rock, _p2).sub(_p0);
  out.crossVectors(_p1, _p2).normalize();
  if (out.dot(u) < 0) out.negate();
  return out;
}

// ---------------------------------------------------------------------------
// the pocket outline, in panel coordinates

function outlinePoint(phi, wob, scale) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const ax = PW * OUT_AX;
  const ay = PH * OUT_AY;
  const r = Math.pow(Math.pow(Math.abs(c) / ax, OUT_K) + Math.pow(Math.abs(s) / ay, OUT_K), -1 / OUT_K);
  // The chisel never ran straight. Three harmonics, small enough that the
  // outline is still recognisably the rectangle the texture is mapped onto.
  const k = 1 + 0.078 * Math.sin(2 * phi + wob[0]) + 0.052 * Math.sin(3 * phi + wob[1]) + 0.030 * Math.sin(5 * phi + wob[2]);
  return [r * c * k * scale, r * s * k * scale];
}

// Where the wall, run out from the panel floor at a given panel coordinate,
// leaves the rough surface. Bisected rather than assumed: the surface there is
// the smooth min's own blend of the panel plane with whatever is next to it,
// which is always a little inside the plane and by a different amount at every
// column.
function wallTop(px, py, rock, floorPlane) {
  const { e1, e2, e3 } = rock.frame;
  const base = new THREE.Vector3().addScaledVector(e3, floorPlane).addScaledVector(e1, px).addScaledVector(e2, py);
  const probe = new THREE.Vector3();
  const f = (s) => {
    probe.copy(base).addScaledVector(e3, s);
    const len = probe.length();
    return len - radius(_uu.copy(probe).divideScalar(len), rock);
  };
  let lo = 0;
  let hi = RECESS * 4;
  if (f(lo) > 0) return -1;    // the floor is already outside the rock
  if (f(hi) < 0) return -1;    // no crossing: the wall never reaches daylight
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Shrink the pocket until every one of its columns has a wall with room for
// both rolls in it. Nothing here is a number somebody chose: the failure it
// catches is the pocket's corner landing outside the rock, and on a shape that
// is regenerated from a dozen-odd jittered planes per seed, with some of them
// missing, that has to be measured rather than trusted.
function fitOutline(rock, wob) {
  const need = FILLET + ARRIS * 0.5 + 0.004;
  let scale = 1;
  for (let attempt = 0; attempt < 14; attempt++) {
    const cols = [];
    let ok = true;
    for (let j = 0; j <= SEG_A; j++) {
      const phi = (j / SEG_A) * Math.PI * 2;
      const [px, py] = outlinePoint(phi, wob, scale);
      const s = wallTop(px, py, rock, DP - RECESS);
      if (s < need) { ok = false; break; }
      cols.push({ phi, px, py, s });
    }
    if (ok) return { cols, scale };
    scale *= 0.94;
  }
  return null;
}

// ---------------------------------------------------------------------------
// mesh assembly
//
// One quad grid. Every ring below carries SEG_A + 1 columns, the last
// duplicating the first so the strip UVs can run 0 to 1 without relying on a
// wrap mode. Rings run from the middle of the panel floor, out over the roll,
// up the wall, round the arris and away over the rough rock to the back pole.
// A ring may be emitted twice at the same positions: that is the UV seam where
// the carved face region stops and the plain strip begins, and the quad band
// between the two copies has zero area.
//
// Each vertex carries its shading factor alongside its position, because the
// tone comes out of the direction the vertex was generated from and there is no
// recovering that after the piece has been tilted and seated.

class Sink {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.face = [];   // per vertex: is this in the carved face region
    this.shade = [];  // per vertex: the baked tone, before the world-space terms
    this.idx = [];
    this.rings = 0;
  }

  ring(points) {
    const start = this.pos.length / 3;
    for (const p of points) {
      this.pos.push(p.p.x, p.p.y, p.p.z);
      this.nor.push(p.n.x, p.n.y, p.n.z);
      this.uv.push(p.u, p.v);
      this.face.push(p.face ? 1 : 0);
      this.shade.push(p.k);
    }
    if (this.rings > 0) {
      const prev = start - points.length;
      for (let j = 0; j < points.length - 1; j++) {
        const a = prev + j;
        const b = start + j;
        const c = start + j + 1;
        const d = prev + j + 1;
        this.idx.push(a, b, d, b, c, d);
      }
    }
    this.rings++;
    return start;
  }
}

function buildBoulder(rock, wob, slabUV) {
  const { e1, e2, e3 } = rock.frame;
  const fit = fitOutline(rock, wob);
  if (!fit) return null;
  const floorPlane = DP - RECESS;

  // Everything the rings need, worked out once per column.
  const cols = fit.cols.map(({ phi, px, py, s }) => {
    // Outward normal of the outline in the panel plane, from a finite
    // difference of the outline itself, which is exact enough at 96 columns and
    // needs no special cases at the superellipse's flat runs.
    const d = 0.004;
    const a = outlinePoint(phi - d, wob, fit.scale);
    const b = outlinePoint(phi + d, wob, fit.scale);
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    // Counter-clockwise outline, so (ty, -tx) points outward.
    const nx = ty / tl;
    const ny = -tx / tl;
    const nWall = new THREE.Vector3().addScaledVector(e1, nx).addScaledVector(e2, ny).normalize();
    return { phi, px, py, s, nx, ny, nWall };
  });

  const sink = new Sink();

  const panelPoint = (px, py, s, out) =>
    out.set(0, 0, 0).addScaledVector(e3, floorPlane + s).addScaledVector(e1, px).addScaledVector(e2, py);
  const faceUV = (px, py) => slabUV(px, py + PH, true);

  // --- the floor -----------------------------------------------------------
  // Dead flat, and the only part of the piece that is. Rings scale the outline,
  // pulled in by the roll's radius, from the middle out. The floor darkens
  // toward its edge, where its own wall shades it.
  const FLOOR_RINGS = 4;
  for (let i = 0; i <= FLOOR_RINGS; i++) {
    const t = Math.pow(i / FLOOR_RINGS, 0.82);
    const k = PANEL_TONE * (1 - POCKET_EDGE * t * t);
    sink.ring(cols.map((c) => {
      const px = (c.px - c.nx * FILLET) * t;
      const py = (c.py - c.ny * FILLET) * t;
      const [u, v] = faceUV(px, py);
      return { p: panelPoint(px, py, 0, new THREE.Vector3()), n: e3.clone(), u, v, face: true, k };
    }));
  }

  // --- the roll off the floor ---------------------------------------------
  const ROLL_RINGS = 3;
  for (let i = 1; i <= ROLL_RINGS; i++) {
    const th = (i / ROLL_RINGS) * (Math.PI / 2);
    const inset = FILLET * (1 - Math.sin(th));
    const rise = FILLET * (1 - Math.cos(th));
    const k = PANEL_TONE * (1 - POCKET_EDGE - (POCKET_WALL - POCKET_EDGE) * Math.sin(th));
    sink.ring(cols.map((c) => {
      const px = c.px - c.nx * inset;
      const py = c.py - c.ny * inset;
      const [u, v] = faceUV(px, py);
      const n = c.nWall.clone().multiplyScalar(Math.sin(th)).addScaledVector(e3, Math.cos(th)).normalize();
      return { p: panelPoint(px, py, rise, new THREE.Vector3()), n, u, v, face: true, k };
    }));
  }

  // The seam. Same positions again, this time parked in the plain strip: the
  // carved region ends at the top of the roll, and without a duplicated ring
  // the quad that crosses out of it would smear a letter up the wall.
  sink.ring(cols.map((c, j) => ({
    p: panelPoint(c.px, c.py, FILLET, new THREE.Vector3()),
    n: c.nWall.clone(),
    u: j / SEG_A,
    v: 0,
    face: false,
    k: PANEL_TONE * (1 - POCKET_WALL),
  })));

  // --- the wall ------------------------------------------------------------
  // Darkest at the bottom, where the pocket closes on it, opening up as it
  // climbs out.
  const WALL_RINGS = 2;
  for (let i = 1; i <= WALL_RINGS; i++) {
    const f = i / WALL_RINGS;
    const k = PANEL_TONE * (1 - POCKET_WALL * (1 - 0.55 * f));
    sink.ring(cols.map((c, j) => {
      const top = c.s - ARRIS * 0.5;
      const s = FILLET + (top - FILLET) * f;
      return { p: panelPoint(c.px, c.py, s, new THREE.Vector3()), n: c.nWall.clone(), u: j / SEG_A, v: 0, face: false, k };
    }));
  }

  // --- the arris where the wall meets the rough rock ------------------------
  //
  // A quadratic through the corner. A is the top of the wall pulled back by
  // half the roll, B is a point out on the rough surface the same distance
  // past the corner, and the corner itself is the control point, so the band is
  // a real fillet of about ARRIS rather than a normal-only cheat. This is the
  // sharpest edge on the piece: 16 mm, which is about a pixel at scene scale
  // and eight at the 700 px size the panel is judged at.
  const arrisCols = cols.map((c) => {
    const A = panelPoint(c.px, c.py, c.s - ARRIS * 0.5, new THREE.Vector3());
    const K = panelPoint(c.px, c.py, c.s, new THREE.Vector3());
    // Walk out along the rough surface, away from the panel, by the same
    // amount: rotate the corner's own direction away from the panel normal.
    const uK = K.clone().normalize();
    const aK = Math.acos(clamp01(uK.dot(e3)));
    const tangent = new THREE.Vector3().addScaledVector(e1, Math.cos(c.phi)).addScaledVector(e2, Math.sin(c.phi)).normalize();
    const step = ARRIS / Math.max(0.15, K.length());
    const uB = e3.clone().multiplyScalar(Math.cos(aK + step)).addScaledVector(tangent, Math.sin(aK + step)).normalize();
    const B = surfacePoint(uB, rock, new THREE.Vector3());
    const nB = surfaceNormal(uB, rock, new THREE.Vector3());
    const sB = faceShade(uB, rock);
    return { A, K, B, nB, tangent, aK: aK + step, kB: sB.tone * (1 - ARRIS_DARK * Math.min(1, sB.arris * 2)) };
  });
  const ARRIS_RINGS = 3;
  const kWallTop = PANEL_TONE * (1 - POCKET_WALL * 0.45);
  for (let i = 1; i <= ARRIS_RINGS; i++) {
    const t = i / ARRIS_RINGS;
    const w = smoothstep(0, 1, t);
    sink.ring(arrisCols.map((a, j) => {
      const it = 1 - t;
      const p = a.A.clone().multiplyScalar(it * it)
        .addScaledVector(a.K, 2 * t * it)
        .addScaledVector(a.B, t * t);
      const n = cols[j].nWall.clone().multiplyScalar(1 - w).addScaledVector(a.nB, w).normalize();
      return { p, n, u: j / SEG_A, v: 0, face: false, k: kWallTop * (1 - w) + a.kB * w };
    }));
  }

  // --- the rough rock ------------------------------------------------------
  //
  // Rings of constant angle off the panel normal, starting from the curve the
  // arris left off at and closing at the back pole. The start angle varies by
  // column, so the grid conforms to the pocket rather than crossing it.
  for (let i = 1; i <= SEG_R; i++) {
    const t = i / SEG_R;
    // Eased so rings crowd a little near the pocket, where the eye is, and
    // stretch out round the back where nothing happens.
    const g = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    sink.ring(arrisCols.map((a, j) => {
      const ang = a.aK + (Math.PI - a.aK) * g;
      const u = e3.clone().multiplyScalar(Math.cos(ang)).addScaledVector(a.tangent, Math.sin(ang)).normalize();
      const p = surfacePoint(u, rock, new THREE.Vector3());
      const n = surfaceNormal(u, rock, new THREE.Vector3());
      const s = faceShade(u, rock);
      const dip = clamp01(scoopAt(u, rock) / SCOOP_DEEP[1]);
      return {
        p,
        n,
        u: j / SEG_A,
        v: 0,
        face: false,
        k: s.tone * (1 - ARRIS_DARK * Math.min(1, s.arris * 2)) * (1 - SCOOP_DARK * dip),
      };
    }));
  }

  return sink;
}

// ---------------------------------------------------------------------------
// the small stones at the foot: the same generator, fewer planes, no pocket

function footStone(rng, seg, ringN) {
  const planes = [];
  const n = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    // Golden-angle spiral over the sphere so a handful of planes still enclose
    // a volume: drawn independently they clump and leave the body open on one
    // side, which the smooth min answers with a spike.
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963 + rng() * 0.9;
    planes.push({
      n: new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th)).normalize(),
      d: 0.42 + rng() * 0.22,
      tone: 1 + (rng() - 0.5) * 2 * TONE_SPREAD,
    });
  }
  const rock = {
    planes,
    ph: [rng() * 6.283, rng() * 6.283, rng() * 6.283],
    frame: { e3: new THREE.Vector3(0, 1, 0) },
    scoops: [],   // a stone this size does not need one, and radius() wants the array
    hits: new Float64Array(planes.length),
    who: new Int32Array(planes.length),
  };
  // A whole-stone tone on top of the per-facet one: these are separate stones,
  // not chips off this one, and a scatter of identical greys reads as a scatter
  // of one object.
  const whole = 0.88 + rng() * 0.20;
  const sink = new Sink();
  for (let i = 0; i <= ringN; i++) {
    const ang = (i / ringN) * Math.PI;
    const pts = [];
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * Math.PI * 2;
      const u = new THREE.Vector3(Math.sin(ang) * Math.cos(phi), Math.cos(ang), Math.sin(ang) * Math.sin(phi));
      const s = faceShade(u, rock);
      pts.push({
        p: surfacePoint(u, rock, new THREE.Vector3()),
        n: surfaceNormal(u, rock, new THREE.Vector3()),
        u: j / seg,
        v: 0,
        face: false,
        k: whole * s.tone * (1 - ARRIS_DARK * Math.min(1, s.arris * 2)),
      });
    }
    sink.ring(pts);
  }
  return sink;
}

function appendSink(dst, src, matrix) {
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const base = dst.pos.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.pos.length / 3; i++) {
    v.set(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]).applyMatrix4(matrix);
    dst.pos.push(v.x, v.y, v.z);
    v.set(src.nor[i * 3], src.nor[i * 3 + 1], src.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
    dst.nor.push(v.x, v.y, v.z);
    dst.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
    dst.face.push(src.face[i]);
    dst.shade.push(src.shade[i]);
  }
  for (const k of src.idx) dst.idx.push(base + k);
}

// ---------------------------------------------------------------------------

function buildStone({ body, material, rng, disposables, stripUV, slabUV }) {
  const rock = makeRock(rng);
  const wob = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const sink = buildBoulder(rock, wob, slabUV);
  // The rock is built BEFORE the registry's slab is thrown away, so that if
  // fitOutline ever gives up -- it has fourteen goes and has not yet, but a
  // future change to the plane table could make it -- what is left standing is
  // the family's own slab rather than nothing at all.
  if (!sink) return;

  // The registry's slab and its plinth both go. A boulder is one mass; the
  // slab's only remaining job is the texture atlas, whose carved region takes
  // its aspect from 2 * halfWidth / height, which is why those two numbers are
  // the panel's. Its geometry is still owned by the registry's dispose().
  for (const m of body.children.filter((o) => o.isMesh)) body.remove(m);

  // Not plumb: see the ROLL block above. Baked into the geometry rather than
  // hung on a group, so the seating below can measure the real lowest point of
  // the real thing. Yaw is not among them, since it would swing the dressed
  // face away from the front and the front is where the camera is.
  const tilt = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(PITCH_MIN + rng() * (PITCH_MAX - PITCH_MIN), 0, (rng() - 0.5) * ROLL, 'ZXY'),
  );

  // Seated before anything else is placed. The boulder's own lowest point under
  // its tilt, walked vertex by vertex: Box3.setFromObject grows the local box
  // by the rotation and would hand back a tumbling cube's corner, which is
  // book.js's finding and the reason this counts vertices at all.
  let low = Infinity;
  let high = -Infinity;
  {
    const v = new THREE.Vector3();
    for (let i = 0; i < sink.pos.length; i += 3) {
      v.set(sink.pos[i], sink.pos[i + 1], sink.pos[i + 2]).applyMatrix4(tilt);
      if (v.y < low) low = v.y;
      if (v.y > high) high = v.y;
    }
  }
  const dy = -SINK - low;
  const top = high + dy;
  const place = new THREE.Matrix4().makeTranslation(0, dy, 0).multiply(tilt);

  const all = { pos: [], nor: [], uv: [], face: [], shade: [], idx: [] };
  appendSink(all, sink, place);
  const bodyEnd = all.pos.length;   // where the boulder ends and its foot stones begin

  // How far the boulder's own base reaches, per azimuth, measured off the mesh
  // that was just built. The first pass placed the foot stones on a guessed
  // radius and half of them landed INSIDE the boulder, which came back as a
  // crumpled fringe of little bumps all round the bottom edge -- at four seeds
  // side by side it was the most obviously wrong thing in the frame. Nothing
  // here is a radius somebody chose: each stone is set against the base where
  // the base actually is, which now matters more than it did, since the tucked
  // foot means the base is nowhere near the widest part of the stone.
  const BINS = 36;
  const reach = new Float64Array(BINS);
  for (let i = 0; i < bodyEnd; i += 3) {
    if (all.pos[i + 1] > 0.16) continue;
    const b = (Math.floor(((Math.atan2(all.pos[i], all.pos[i + 2]) / (Math.PI * 2)) + 1) * BINS) % BINS + BINS) % BINS;
    const r = Math.hypot(all.pos[i], all.pos[i + 2]);
    if (r > reach[b]) reach[b] = r;
  }
  const reachAt = (th) => {
    const b = (Math.floor(((th / (Math.PI * 2)) + 1) * BINS) % BINS + BINS) % BINS;
    return Math.max(reach[b], reach[(b + 1) % BINS], reach[(b + BINS - 1) % BINS], 0.24);
  };

  // The foot stones, in the SAME frame the seated boulder now lives in. Placed
  // before the seating they were carried up with it, which an early render
  // showed as a ring of chips hovering half way up the sides.
  const feet = FOOT_MIN + Math.floor(rng() * (FOOT_MAX - FOOT_MIN + 1));
  for (let i = 0; i < feet; i++) {
    const s = 0.038 + rng() * 0.050;
    const th = (i / feet) * Math.PI * 2 + rng() * 0.8;
    const rad = reachAt(th) + s * (0.35 + 1.5 * rng());
    const m = new THREE.Matrix4().compose(
      // Sunk between a third and two thirds of the way in. A pebble sitting ON
      // the floor is a pebble somebody put there; one the ground has come up
      // round it is what a stone that has stood a century has at its foot.
      new THREE.Vector3(Math.sin(th) * rad, s * (0.16 - 0.34 * rng()), Math.cos(th) * rad),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.283, rng() * 6.283, rng() * 6.283)),
      new THREE.Vector3(s * 2.0, s * 1.30, s * 1.80),
    );
    appendSink(all, footStone(rng, 14, 8), m);
  }

  // --- the plain UVs -------------------------------------------------------
  //
  // Everything that is not the carved panel samples the texture's plain strip,
  // with v climbing with real height so the foot of the boulder and the stones
  // round it sit in the same grime band the family's plinths do.
  for (let i = 0; i < all.face.length; i++) {
    if (all.face[i]) continue;
    const [u, v] = stripUV(all.uv[i * 2] - 0.5, 0.03 + 0.94 * clamp01(all.pos[i * 3 + 1] / top), 0.5, 1);
    all.uv[i * 2] = u;
    all.uv[i * 2 + 1] = v;
  }

  // --- the world-space half of the shading ---------------------------------
  //
  // The facet tone and the arris darkening were baked as the vertices were
  // made, in the rock's own frame. These last two need the seated position and
  // normal, so they go on here: the sky term, which is a nudge on top of what
  // the hemisphere light already does, and the ground term, which is the
  // contact occlusion a single directional light cannot give at all.
  const colour = new Float32Array(all.face.length * 3);
  for (let i = 0; i < all.face.length; i++) {
    const ny = all.nor[i * 3 + 1];
    const y = all.pos[i * 3 + 1];
    let k = all.shade[i];
    k *= 1 - SKY_DARK * (1 - smoothstep(-0.70, 0.45, ny));
    k *= 1 - GROUND_DARK * (1 - smoothstep(0, GROUND_REACH, y));
    colour[i * 3] = k;
    colour[i * 3 + 1] = k;
    colour[i * 3 + 2] = k;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.setIndex(all.idx);
  geometry.computeBoundingSphere();
  // The boulder and its foot stones are one buffer and one draw call, so this
  // is the only record of where one ends and the others begin. Anything that
  // wants to measure the STONE rather than the scatter round it needs it: the
  // silhouette probe that this pass was judged on does, since the foot stones
  // sit outside the base and would otherwise report themselves as the widest
  // part of the piece.
  geometry.userData.bodyVertices = bodyEnd / 3;

  // The registry's material is this stone's own -- createTombstone builds one
  // per instance -- and its only other users, the slab and the plinth, were
  // removed above. So this switch reaches nothing else in the set. The colours
  // are grey multipliers on a map that carries only detail, so PALETTE.stone
  // stays the single source of truth for the hue.
  material.vertexColors = true;
  material.needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);
  disposables.push(geometry);

  // The registry's own lean still applies on top: it turns the whole body about
  // the origin, which is at the floor, so it is a stone settling in the ground
  // rather than a stone balanced on a corner. SINK covers the worst corner it
  // can lift.
}

registerStone('boulder', {
  // halfWidth and height are the DRESSED PANEL, not the rock: they set the face
  // texture's aspect and the slabUV mapping the panel samples through, exactly
  // as stump.js's tablet does. depth and plinth build a slab that extras throws
  // away, and are left at values the sweep cannot fold on. plinth is 0: a
  // boulder was never set on a pad.
  shape: { halfWidth: PW, height: PH * 2, depth: 0.20, plinth: 0 },
  topRadius: 0.062,
  bottomRadius: 0.062,

  // A small cross and two initials, both well inside the pocket's outline,
  // which wanders a little per seed. Letters 0.104 world units tall, against
  // 0.123 for cross and 0.096 for fred; the cross is smaller than the one on
  // `cross` because this face is a third of that one's area and the brief for a
  // found stone is quiet. Measured, alpha weighted, on the 948 x 1024 face:
  // 4.8% ink, against 3.7, 6.4 and 9.2 for the approved cross, fred and bat.
  //
  // The one thing worth checking again if these numbers move: the pocket is
  // sized per seed, so the mark has to fit the SMALLEST pocket, not the drawn
  // canvas. Over sixteen seeds the tightest pocket covers u 0.122 to 0.888 and
  // v 0.107 to 0.884 of the face region, and the ink here sits inside u 0.177
  // to 0.823 and v 0.25 to 0.81, so it clears on every one of them.
  draw(ctx, w, h, rng) {
    inkCross(ctx, w / 2, h * 0.275, h * 0.165);
    const size = h * 0.285;
    inkText(ctx, INITIALS[Math.floor(rng() * INITIALS.length) % INITIALS.length], w / 2, h * 0.655, size, size * 0.05);
  },

  extras: buildStone,
});
