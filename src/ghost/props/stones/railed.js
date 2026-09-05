import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerStone, buildSlabGeometry, inkCross, inkText, mottle } from '../tombstones.js';
import { toyMaterial } from '../style.js';

// A RAILED PLOT: a small Victorian grave enclosed by a low cast-iron railing.
// Four corner posts with ball finials, a top and a bottom rail on each side,
// plain bars between them, a modest tablet standing inside, and the ground
// within the rail raised into a flat bed of pale chippings.
//
// The set already has kerb.js, a 2.35 by 0.90 kerbed plot, and this piece has
// to be clearly a different thing rather than a second one of those. It is,
// and the whole difference is one word: kerb LIES and this one STANDS. A kerb
// set is a line drawn on the ground; a railing is a cage you look THROUGH, and
// every decision below is in service of that.
//
// Four things the piece is made of.
//
// 1. THE BAR WIDTH, which is the whole problem. Real railing bar is 20 to
//    30 mm. The shipped scene's 6.2 view is 12.4 units tall, so on a 900 px
//    canvas it gives 72.6 pixels per world unit and a true 25 mm bar is 1.8 px
//    across; on a 300 px one it is 0.6 px. Below about two pixels an
//    antialiased edge stops being a line and starts being a dotted one, which
//    is exactly the film grain this project bans.
//
//    The other end of the range is the graveyard's own fence, whose picket is
//    0.115 wide on a 0.25 pitch, 46% solid, and at that solidity a row of
//    uprights reads as boarding, not as railing.
//
//    So the bar is 0.072 across, 5.2 px at the shipped framing and 1.7 px at
//    the smallest one, on a 0.273 pitch down the long sides: 26% solid, with a
//    0.20 gap that is 14.6 px of daylight. Fat enough to hold as a continuous
//    dark line, open enough that the bed, the tablet and the sky all come
//    through it. 0.080 was tried and is also fine to look at; it was given back
//    for a reason that is nothing to do with taste, see RAIL_FLAT.
//
// 2. THE BAR COUNT. Four bars a long side and three a short one, fourteen in
//    all, which is as few as this gets. Three a side down the long runs, at a
//    0.34 pitch, is the honest minimum and was tried: the eye stops counting
//    bars and starts reading four separate uprights, which is a hurdle. Two on
//    a short run, also tried, leaves the face nearest the viewer as one big
//    open rectangle and the piece reads as a gate. The two counts give
//    different world pitches, 0.273 and 0.216, and that is deliberate: the long
//    runs point at the camera and foreshorten to 0.485, so on SCREEN their
//    pitch is 0.132 against the short runs' 0.216, and matching the world
//    pitches would have left the near face twice as open as the sides.
//
// 3. THE METAL. There is no environment map in this scene. bracket.js and
//    pillar.js already settled what to do about that and this takes their
//    answer verbatim: metalness zero, a mid-dark warm grey, low roughness.
//    Anything above zero metalness trades the diffuse the hemisphere feeds for
//    a specular only the two directionals can feed, and the ironwork goes
//    nearly black on its shaded side. See IRON.
//
// 4. THE TABLET IS SET BACK, BUT NOT AS FAR BACK AS A GRAVE WOULD PUT IT. A
//    railing in front of nothing is a fence, and the single most characteristic
//    thing about this piece is the bars crossing a pale stone. The camera is at
//    29 degrees, so every metre the tablet retreats up the plot costs 0.48 of
//    screen height off the crossing: at the head rail the near railing would
//    have caught only the tablet's plinth. At TABLET_Z it stands a bit under a
//    third of the way down the plot, and the numbers come out: the tablet runs
//    from 0.204 to 1.211 of a screen span, the top of the near top rail lands
//    at 0.397, and the bottom 19% of the tablet is behind ironwork, plinth and
//    the foot of the face both. Below the rail there are three bars across it
//    as well, which is what actually reads.

// --- the plot ---------------------------------------------------------------
//
// 1.60 head to foot along local +Z, 1.10 across. The plot runs FORWARD from the
// tablet, toward the camera, for the reason kerb.js sets out: a grave is read
// from its foot, and laid the other way the enclosure would hide behind the one
// thing meant to be standing at the head of it.
//
// Unlike kerb.js this is centred on the prop's origin rather than hung off the
// head of it, and the tablet is moved back instead. kerb runs from z -0.21 to
// z 2.14, so the box a layout generator measures off its bounding box is 2.16
// deep for a 2.35 plot and half of that box is empty ground behind the stone.
// Centring costs one line in extras and makes the measured half extents the
// real ones. Nominal 0.55 by 0.80, and 0.568 by 0.834 once the registry's lean
// has tipped a 1.19 tall piece over; that second pair is what a bounding box
// probe reports and what a layout generator should reserve.
const PLOT_W = 1.10;
const PLOT_L = 1.60;

// --- the ironwork -----------------------------------------------------------
const POST = 0.118;          // square section of a corner post
const POST_H = 0.890;        // shaft only, before the neck and the ball
// The neck under the finial. It leaves the shaft almost as wide as the shaft
// is, which is not a detail: at 0.046 the post's flat top showed as a bright
// annulus round the neck, an up-facing ring taking the full key light with
// nothing above it, and at scene scale that reads as a washer under the ball.
// Widened to 0.057 at the foot it is covered, and the waist above it is still
// 2 px of visible neck, which is all a finial of this size can carry.
const NECK_H = 0.042;
const NECK_R = 0.048;      // at the top, under the ball
const NECK_R0 = 0.057;     // where it leaves the shaft
const FINIAL_R = 0.062;      // 0.124 across: 9 px at scene scale, it reads
const FINIAL_TALL = 1.16;    // an egg rather than a ball, so it is not a bolt
// Rail heights, above the FLOOR, as is every height in this block. The top rail
// finishes level with the top of the post shaft, so the four finials stand
// clear above one unbroken horizontal, and the top of the plot is a line with
// four dots over it rather than a band.
const TOP_Y = 0.812;
const BOT_Y = 0.195;
const RAIL_TOP_R = 0.050;
const RAIL_BOT_R = 0.042;
// Rails are ellipses in section, taller than they are thick: a flat bar set on
// edge, which is what a cast railing's rails are. Round tube was tried and is
// the reason the first pass read as nursery furniture rather than ironwork,
// because a round rail has no orientation and reads as a dowel.
const RAIL_FLAT = 0.82;
// A rail also has to be DEEPER than a bar is thick, which is not a proportion
// anyone would think about until the render shows why: a bar ending inside a
// rail thinner than itself leaves the flat disc of its own cut end sticking out
// front and back, and an up-facing disc under a key light this strong is a
// bright notch at every joint. That is what took the bar back from 0.080 to
// 0.072: the top rail is 0.100 tall by 0.082 deep, and 0.082 is as deep as a
// rail can be and still read as a bar on edge rather than as a tube.

// The bar. Round section rather than square, and that is a legibility choice
// before it is a period one: a square bar this small is two arrises 5 px apart,
// which is exactly the sub-pixel detail that flickers. A round bar has one
// highlight down it and cannot alias into anything but a line.
const BAR_R = 0.036;
// Bars finish INSIDE the top rail, not above it.
//
// The first pass ran them 0.070 proud with a domed tip, which is what a real
// railing does: it is the line of spear points along the top. At five pixels
// proud that is not a spear point, it is a knob, and fourteen knobs in a row
// read as the rail of a cot. Buried, the top of the piece is one clean
// horizontal with four finials over it, and the finials get to be the only
// thing breaking the skyline, which is the whole job of a finial.
//
// Fifteen millimetres above the rail's own centre line rather than on it: the
// section is an ellipse, so it is narrowest at its top and bottom, and a cut
// end left dead on the centre line was within half a millimetre of daylight.
const BAR_TOP = TOP_Y + 0.015;
const BARS_LONG = 4;         // between the posts on a 1.60 side
const BARS_SHORT = 3;        // and on a 1.10 one

// Post centres. The posts' outer faces are exactly the plot's envelope, so the
// footprint is PLOT_W by PLOT_L and nothing overhangs it: the finial is
// narrower than the post and the rails are thinner than it.
const RX = PLOT_W / 2 - POST / 2;   // 0.491
const RZ = PLOT_L / 2 - POST / 2;   // 0.741

// --- seating ----------------------------------------------------------------
//
// The registry decides a lean before extras runs and applies it after, so a
// 1.60 by 1.10 frame has to survive the worst draw it can make. rotation.x runs
// to -0.032 and rotation.z to +/-0.0225; over the post centres that lifts the
// shallowest corner by 0.74 * 0.032 + 0.49 * 0.0225 = 0.035.
//
// Then it is CHECKED, and not with a bounding box: a box reports the lowest
// vertex on the whole piece, and what floats is the shallowest CORNER, which is
// a different question and usually a different answer. The four post feet were
// transformed under the body's own world matrix over twelve seeds, and of those
// forty-eight the shallowest stands 18.7 mm into the ground and the deepest
// 81 mm. Nothing floats, and the near-far difference in how deep the frame sits
// reads as a century of settling.
const SINK = 0.050;

// --- the raised bed ---------------------------------------------------------
//
// FLAT, and that is not a shortcut. ledger.js spent five passes proving a dome
// lit by this key comes out darker than the floor whatever colour it is given,
// so a heaped plot would have read as a dark shape inside a dark cage. So the
// bed is a flat pad standing 0.075 proud of the turf with a square edge, and
// the raise is carried by that edge and by the shadow the rail throws across
// it, not by any curvature.
//
// It is PALE, and that is the second half of the contrast argument. The piece
// is a dark cage; give it a mid-grey interior and the bars have nothing to be
// seen against. White marble chippings are period-correct, and lighter than
// both the turf and the stone they sit under, so every bar crossing the bed
// reads as a dark line on a light ground and every bar crossing the sky above
// the rail reads as a dark line on a light ground too. kerb.js's bed is grey
// gravel measuring 158 to 164 against a floor of 152; this one is aimed a clear
// step above the tablet.
const BED_TOP = 0.075;
const BED_H = 0.110;
const BED_LAP = 0.020;   // how far the bed reaches past the line of the bars
const BED_R = 0.100;     // plan corner radius, inside the corner posts

// Where the tablet stands: back toward the head, its plinth clearing the head
// rail by about 0.20, and far enough forward of it that the near railing
// crosses the plinth and the foot of the face rather than the plinth alone.
const TABLET_Z = -0.34;
// Bedded into the chippings rather than balanced on them. The registry's plinth
// has a 0.056 bottom radius, and resting exactly on the tangent point shows
// daylight under its corners.
const BED_IN = 0.030;

// bracket.js and pillar.js's iron, LIGHTENED, and the lightening is the one
// place this piece departs from them rather than reusing them. Their treatment
// is taken whole: metalness zero, low roughness, a warm grey and no environment
// map. Their VALUE cannot be, and the reason is that they are thin. A lantern
// at #4a4640 is a few dark lines against the sky and reads as ironwork; a
// railing at #4a4640 is thirty members enclosing a solid area, and it rendered
// at 40,35,29 in a frame whose floor is 152 and whose stone is around 200. That
// is not a dark prop, it is a hole in the scene. Lifted here it still reads as
// iron, still has the darkest value in the graveyard, and now has form in it:
// a lit top and a shaded side on every bar instead of one flat silhouette.
//
// Warm rather than the crook lamp's cool grey, so it separates from the stone
// in HUE as well as value. Value alone is the first thing distance takes away.
const IRON = '#615b52';
const IRON_ROUGH = 0.46;

// Dates cut on the tablet. One per seed, so two plots in a graveyard are not
// the same casting even where a viewer can read the face.
const YEARS = ['1861', '1874', '1888', '1893', '1859', '1866'];

// A round bar standing on its own foot, optionally domed at the top.
//
// The house style has no cut ends anywhere a viewer can see one. A sphere of
// the tube's own radius centred on the tube's last ring is the exact
// continuation of that surface, so the two agree in position and in normal and
// the weld is invisible; brazier.js's roll() makes the same join for the same
// reason. The bars here pass `tip` false because both their ends finish inside
// something else, one in the top rail and one under the bed.
function bar(len, r, tip) {
  const shaft = new THREE.CylinderGeometry(r, r, len, 12, 1);
  shaft.translate(0, len / 2, 0);
  if (!tip) return shaft;
  const cap = new THREE.SphereGeometry(r, 12, 8);
  cap.translate(0, len, 0);
  const geo = mergeGeometries([shaft, cap], false);
  shaft.dispose();
  cap.dispose();
  return geo;
}

// A rail lying along local X, centred. Its ends are buried in the posts, so it
// needs no caps of its own.
function rail(len, r) {
  const geo = new THREE.CylinderGeometry(r, r, len, 12, 1);
  geo.rotateZ(Math.PI / 2);
  // Squashed across, which BufferGeometry.scale does through applyMatrix4 and
  // so carries the normals with it: no recompute, no faceting.
  geo.scale(1, 1, RAIL_FLAT);
  return geo;
}

// One corner post: a rounded square shaft, a short neck and a ball.
//
// The shaft is the house's own swept slab stood on end, which is what makes it
// a post rather than a pipe: the bars round it are circular in section and the
// post is square with the arris knocked off, and that difference is most of
// what says "post" at a size where neither is more than a few pixels across.
function post() {
  const half = POST / 2;
  const parts = [
    buildSlabGeometry({
      halfWidth: half,
      height: POST_H,
      depth: POST,
      // Well under the registry's 0.062, and allowed to be: that floor is
      // about the FACE of a headstone, where an arc tighter than the rim
      // radius inverts and the sweep self-crosses. Here the constraint is the
      // post's own half-section, 0.059, and 0.030 is a hair over half of it:
      // as much arris as a post this size can lose and still have a flat on
      // each face to catch the key light.
      edge: 0.030,
      // Kept above `edge` on purpose. At exactly edge the innermost ring's
      // corner radius reaches zero and every vertex of that corner collapses
      // onto one point.
      bottomRadius: 0.034,
      topRadius: 0.034,
      uv: () => [0.5, 0.5],
    }),
    new THREE.CylinderGeometry(NECK_R, NECK_R0, NECK_H, 12, 1),
    new THREE.SphereGeometry(FINIAL_R, 16, 12),
  ];
  // Sunk 12 mm into the shaft, so there is no seam to catch a highlight.
  parts[1].translate(0, POST_H - 0.012 + NECK_H / 2, 0);
  parts[2].scale(1, FINIAL_TALL, 1);
  // ...and the ball swallows the top of the neck for the same reason.
  parts[2].translate(0, POST_H + NECK_H - 0.012 + FINIAL_R * FINIAL_TALL * 0.82, 0);
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return geo;
}

registerStone('railed', {
  // The tablet: 0.54 by 1.00 with a 0.15 plinth, 1.15 to the crown before it is
  // lifted onto the bed and 1.19 after. The posts stand at 1.00, so the stone
  // clears the finials by a sixth of its own height and the top rail by a
  // third. That is the proportion a real railed plot has, and it is also the
  // only way the arch is ever seen: below the top rail every horizontal line on
  // this piece is competing with a bar.
  //
  // The face comes out 553 px on the inscription canvas, above the 500 px floor
  // the engraving treatment needs.
  shape: { halfWidth: 0.27, height: 1.00, depth: 0.17, plinth: 0.15 },
  // Not the set's default half-round. A segmental top, tangent nowhere, is the
  // plainest tablet the treatment can make, and plain is what belongs inside a
  // piece whose identity is entirely in the ironwork around it.
  topRadius: 0.20,
  bottomRadius: 0.07,

  // A cross and a date, and nothing else. Everything on this face is going to
  // be seen through bars, so the mark has to be a small number of large closed
  // figures that survive being crossed by two dark lines: a cross does that
  // better than any other mark in the set, and four digits at 0.095 world units
  // are the set's own letter size. Measured coverage 4.21% of the face, in a
  // bounding box 38% of the face wide by 50% tall: the light end of the 3 to 5%
  // band a strong silhouette belongs in, against 3.8, 6.8 and 9.2 for the
  // approved three.
  draw(ctx, w, h, rng) {
    inkCross(ctx, w / 2, h * 0.325, h * 0.25);
    inkText(ctx, YEARS[Math.floor(rng() * YEARS.length)], w / 2, h * 0.665, h * 0.095, h * 0.008);
  },

  extras({ body, slab, plinth, material, rng, disposables, lean }) {
    // The frame has to be properly planted, so the whole body drops. The
    // registry's own default is -0.012, which a piece this long would ride
    // straight off on the lean alone.
    lean.sink = -SINK;
    // Body-local y of the floor, now that the body itself has dropped.
    const G = SINK;

    // --- the tablet ---------------------------------------------------------
    //
    // Moved back to the head of the plot and lifted onto the bed. The registry
    // hands both meshes over by name, so nothing here has to guess which is
    // which from where it happens to sit.
    //
    // It also gets a small turn and shuffle of its own, and that is the piece's
    // best per-seed difference by some way. The railing is one casting and
    // cannot go out of true member by member, but a stone standing loose inside
    // it can and does: three degrees of yaw is instantly readable as a stone
    // that has been shoved, because the cage around it stays dead square and
    // gives the eye something to measure the stone against. Nothing else on
    // this prop offers that reference.
    const lift = G + BED_TOP - BED_IN;
    const skew = (rng() - 0.5) * 0.11;
    const dx = (rng() - 0.5) * 0.035;
    const dz = (rng() - 0.5) * 0.05;
    for (const m of [slab, plinth]) {
      if (!m) continue;
      m.position.y += lift;
      m.position.x += dx;
      m.position.z += TABLET_Z + dz;
      // Both meshes are centred on x and z in their own geometry, so both turn
      // about the same axis and the stone stays on its base.
      m.rotation.y = skew;
    }

    // --- the ironwork -------------------------------------------------------
    //
    // Everything metal is merged into ONE geometry and drawn once. A railing is
    // twenty-six separate members and twenty-six draw calls for a background
    // prop is not a trade worth making; crook.js and brazier.js merge their
    // ironwork for the same reason. It also means the whole cage is one shadow
    // caster, so the bars throw one connected shadow across the bed rather than
    // fourteen that have each been biased apart.
    const parts = [];
    const postGeo = post();
    const railTopHead = rail(2 * RX, RAIL_TOP_R);
    const railBotHead = rail(2 * RX, RAIL_BOT_R);
    const railTopSide = rail(2 * RZ, RAIL_TOP_R);
    const railBotSide = rail(2 * RZ, RAIL_BOT_R);

    const put = (src, { x = 0, y = 0, z = 0, yaw = 0, tilt = 0 } = {}) => {
      const g = src.clone();
      if (tilt) g.rotateX(tilt);
      if (yaw) g.rotateY(yaw);
      g.translate(x, y, z);
      parts.push(g);
    };

    // Four posts, each turned a hair off square, and each buried by SINK: the
    // iron group's own origin is the FLOOR, so a post placed at y = -SINK is a
    // post driven into it. A cast railing is one welded assembly and does not
    // settle member by member, so the only per-post freedom is which way its
    // section faces. A couple of degrees is enough to stop the four corners
    // being one stamping seen four times, and it cannot open a joint, because
    // every rail ends deep inside the post it meets.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        put(postGeo, { x: sx * RX, y: -SINK, z: sz * RZ, yaw: (rng() - 0.5) * 0.07 });
      }
    }

    // Rails. The head and foot runs go along X and are the SHORT pair; the two
    // sides go along Z and are the long pair. Each rail runs from post centre to
    // post centre, so both its ends finish 0.059 inside the post and there is
    // no cut end anywhere on the piece.
    for (const sz of [-1, 1]) {
      put(railTopHead, { y: TOP_Y, z: sz * RZ });
      put(railBotHead, { y: BOT_Y, z: sz * RZ });
    }
    for (const sx of [-1, 1]) {
      put(railTopSide, { x: sx * RX, y: TOP_Y, yaw: Math.PI / 2 });
      put(railBotSide, { x: sx * RX, y: BOT_Y, yaw: Math.PI / 2 });
    }

    // --- the bars -----------------------------------------------------------
    //
    // Evenly pitched between the post inner faces, running from below the floor
    // up through the bottom rail and finishing inside the top one. Started
    // below the floor rather than on the bed's surface: the bed's rim is
    // rounded, and a bar standing on the tangent point of it shows daylight
    // under its foot from the one camera this scene has.
    //
    // One plot in two has lost a bar. It is the cheapest per-seed difference on
    // the piece and by a distance the most visible, because the gap is a bright
    // slot in the one thing the eye is reading the prop by, and a hundred and
    // fifty years of frost taking a bar out of a plot railing is what these
    // actually look like. cracked.js already establishes that this set is
    // allowed to be derelict.
    const slots = [];
    const longPitch = (2 * RZ - POST) / (BARS_LONG + 1);
    for (const sx of [-1, 1]) {
      for (let i = 1; i <= BARS_LONG; i++) {
        slots.push({ x: sx * RX, z: -RZ + POST / 2 + i * longPitch, yaw: Math.PI / 2 });
      }
    }
    const shortPitch = (2 * RX - POST) / (BARS_SHORT + 1);
    for (const sz of [-1, 1]) {
      for (let i = 1; i <= BARS_SHORT; i++) {
        slots.push({ x: -RX + POST / 2 + i * shortPitch, z: sz * RZ, yaw: 0 });
      }
    }

    const FOOT = -0.070;   // below the underside of the bed, so nothing floats
    const missing = rng() < 0.55 ? Math.floor(rng() * slots.length) : -1;
    for (let i = 0; i < slots.length; i++) {
      if (i === missing) continue;
      const s = slots[i];
      // A bar's own length and bow. Small: these are cast into two rails and
      // can only bend, and a bar visibly out of parallel with its neighbour
      // reads as a modelling error rather than as age. The bow is applied
      // before the yaw so it always runs ALONG the rail it belongs to.
      const len = BAR_TOP - FOOT + (rng() - 0.5) * 0.012;
      const g = bar(len, BAR_R, false);
      g.rotateZ((rng() - 0.5) * 0.026);
      if (s.yaw) g.rotateY(s.yaw);
      g.translate(s.x, FOOT, s.z);
      parts.push(g);
    }

    const ironGeo = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    postGeo.dispose();
    for (const r of [railTopHead, railBotHead, railTopSide, railBotSide]) r.dispose();

    const ironMat = toyMaterial(IRON, { roughness: IRON_ROUGH, metalness: 0.0 });
    const iron = new THREE.Mesh(ironGeo, ironMat);
    // The iron's origin is the floor, so every height above reads as a height
    // above the turf and the SINK only ever appears where a member is driven
    // into it.
    iron.position.y = G;
    iron.castShadow = true;
    iron.receiveShadow = true;
    body.add(iron);
    disposables.push(ironGeo, ironMat);

    // --- the bed of chippings -----------------------------------------------
    const bedHalfX = RX + BED_LAP;
    const bedHalfZ = RZ + BED_LAP;
    // One tile per 0.75 world units. kerb.js runs its gravel at 1.15 for chips
    // of 30 to 65 mm; marble chippings are graded finer than plot gravel, and
    // at 0.75 these come out 20 to 40 mm, which is as fine as this camera can
    // be given before the bed turns to speckle.
    const TILE = 0.75;
    const bedGeo = buildSlabGeometry({
      halfWidth: bedHalfX,
      height: bedHalfZ * 2,
      depth: BED_H,
      edge: 0.026,
      bottomRadius: BED_R,
      topRadius: BED_R,
      uv: (x, y) => [(x + bedHalfX) / TILE, y / TILE],
    });
    disposables.push(bedGeo);

    // The bed's own material. Taken FROM the shared stone rather than invented,
    // the way kerb.js takes its gravel, so it cannot drift away from the set:
    // the same stone, lifted and warmed, which is what a broken white marble
    // chipping is next to a weathered grey tablet.
    const bedColour = material.color.clone().multiplyScalar(1.05).lerp(new THREE.Color('#e6dfd2'), 0.20);
    const grain = chipTexture();
    const bedMat = toyMaterial(bedColour, { map: grain, roughness: 0.95 });
    disposables.push(bedMat);
    if (grain) disposables.push(grain);

    const bed = new THREE.Mesh(bedGeo, bedMat);
    // Laid face up. Rotating -90 about x sends the builder's y down -z and its
    // depth up into y, so the pad spans z in [-2*bedHalfZ, 0]: hence the shift.
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(0, G + BED_TOP - BED_H / 2, bedHalfZ);
    // The railing's shadow falling across it is the only relief it gets, and
    // the only relief it is allowed.
    bed.receiveShadow = true;
    body.add(bed);
  },
});

// Marble chippings, as colour only.
//
// No normal map and no height. tombstones.js carries the same warning on its
// own mottling and kerb.js repeats it: a field of chips is exactly the high
// frequency that comes back through normals as sandpaper. What survives at
// scene scale is tone, so tone is all this paints, on white, because the colour
// lives on the material.
function chipTexture() {
  if (typeof document === 'undefined') return null;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);

  // Fixed seed, as kerb.js's is: two railed plots in one graveyard differ in
  // their lean, their missing bar and their date, and there is no reading of a
  // chipping bed at this size that a second noise field would improve.
  let a = 0x51ed270b;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const WRAP9 = [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]];

  // A slow swell underneath so the bed is not one tone end to end. Weaker than
  // kerb.js's, because this bed is pale and a pale surface shows a gradient
  // that a mid grey one swallows.
  for (let i = 0; i < 22; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = (0.13 + rnd() * 0.20) * S;
    const dark = rnd() < 0.55;
    const squash = 0.6 + rnd() * 0.7;
    const rot = rnd() * Math.PI;
    for (const [ox, oy] of WRAP9) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, dark ? 'rgba(150,145,136,0.13)' : 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The chips. Smaller and denser than the kerb's gravel, and each one is an
  // angular quad rather than an ellipse: broken marble fractures on flats,
  // rounded river gravel does not, and at this density the difference is the
  // only thing separating the two beds when they stand in the same graveyard.
  for (let i = 0; i < 1650; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 4.2 + rnd() * 5.0;
    const rot = rnd() * Math.PI;
    const tone = rnd();
    const pts = [];
    const sides = 4 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < sides; k++) {
      const th = rot + (k / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const rr = r * (0.62 + rnd() * 0.55);
      pts.push([Math.cos(th) * rr, Math.sin(th) * rr * 0.82]);
    }
    for (const [ox, oy] of WRAP9) {
      const px = x + ox;
      const py = y + oy;
      if (px < -20 || px > S + 20 || py < -20 || py > S + 20) continue;
      const face = (dx, dy, style) => {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(px + pts[0][0] + dx, py + pts[0][1] + dy);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(px + pts[k][0] + dx, py + pts[k][1] + dy);
        ctx.closePath();
        ctx.fill();
      };
      // The chip's own contact shade first, then the chip over it.
      face(1.4, 1.9, 'rgba(138,133,124,0.15)');
      face(0, 0, tone < 0.5
        ? `rgba(255,255,255,${0.13 + tone * 0.24})`
        : `rgba(176,170,158,${0.05 + (tone - 0.5) * 0.16})`);
    }
  }

  // A last very low mottle over the top, which is what stops a field of drawn
  // shapes reading as a pattern.
  mottle(ctx, S, S, rnd, '255,255,255', '158,152,142', 0.05, false);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
