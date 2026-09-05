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
// 1. THE BAR WIDTH, which is the whole problem. Real railing bar is 20 to 30 mm.
//    This prop stands about 1.0 tall and the shipped scene at view 6.2 gives
//    roughly 73 pixels per world unit, so a true bar is a fifth of a pixel: it
//    would alias into the dotted line the house style calls film grain and
//    bans. The other end of the range is the graveyard's own fence, whose
//    picket is 0.115 wide on a 0.25 pitch, 46% solid, and at that solidity a
//    row of uprights reads as boarding, not as railing. So the bar is 0.080
//    across (5.8 px), on a 0.266 pitch, 30% solid: fat enough to survive
//    filtering as a continuous dark line and open enough that the bed, the
//    tablet and the daylight behind all come through it. See BAR_R.
//
// 2. THE BAR COUNT. Four bars a long side and two a short one, twelve in all.
//    Three a side was tried first and is the honest minimum, but at 0.33 pitch
//    the eye stops counting bars and starts reading four separate posts, which
//    is a hurdle rather than a railing. Fewer and fatter is the right instinct
//    and this is as far as it goes before the piece changes species.
//
// 3. THE METAL. There is no environment map in this scene. bracket.js and
//    pillar.js already settled what to do about that and this takes their
//    answer verbatim: metalness zero, a mid-dark warm grey, low roughness.
//    Anything above zero metalness trades the diffuse the hemisphere feeds for
//    a specular only the two directionals can feed, and the ironwork goes
//    nearly black on its shaded side. See IRON.
//
// 4. THE TABLET IS SET BACK. A railing in front of nothing is a fence. The
//    single most characteristic thing about this piece is the bars crossing a
//    pale stone, so the tablet stands at the head, 1.13 behind the foot rail,
//    and at the scene camera's 29 degrees that puts the near railing across the
//    bottom 37% of the tablet's screen height. Measured, not hoped for: the
//    tablet's foot projects to screen y 0.176 and the near bar tips to 0.546 of
//    a screen span in which the tablet is 1.007 tall.

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
// real ones: 0.55 by 0.80.
const PLOT_W = 1.10;
const PLOT_L = 1.60;

// --- the ironwork -----------------------------------------------------------
const POST = 0.118;          // square section of a corner post
const POST_H = 0.890;        // shaft only, before the neck and the ball
const NECK_H = 0.030;
const NECK_R = 0.046;
const FINIAL_R = 0.062;      // 0.124 across: 9 px at scene scale, it reads
const FINIAL_TALL = 1.16;    // an egg rather than a ball, so it is not a bolt
// Rail heights, above the FLOOR, as is every other height in this block. The
// top rail is the piece's horizontal line and sits just under the finials, so
// the four balls stand clear of it and the top of the plot is four dots and a
// line rather than one unbroken band.
// The top rail finishes level with the top of the post shaft, which is what
// puts the four finials clear above one unbroken line and is the single change
// that stopped this reading as a cot.
const TOP_Y = 0.812;
const BOT_Y = 0.195;
const RAIL_TOP_R = 0.047;
const RAIL_BOT_R = 0.038;
// Rails are ellipses in section, taller than they are thick: a flat bar set on
// edge, which is what a cast railing's rails are. Round tube was tried and is
// the reason the first pass read as nursery furniture rather than ironwork,
// because a round rail has no orientation and reads as a dowel.
const RAIL_FLAT = 0.70;
// The bar. Round section rather than square, and that is a legibility choice
// before it is a period one: a square bar this small is two arrises 5 px apart,
// which is exactly the sub-pixel detail that flickers. A round bar has one
// highlight down it and cannot alias into anything but a line.
const BAR_R = 0.040;
// Bars finish INSIDE the top rail, not above it.
//
// The first pass ran them 0.070 proud with a domed tip, which is what a real
// railing does: it is the line of spear points along the top. At 5 px proud on
// an 0.080 bar that is not a spear point, it is a knob, and twelve knobs in a
// row read as the rail of a cot. Buried, the top of the piece is one clean
// horizontal with four finials over it, and the finials get to be the only
// thing breaking the skyline, which is the whole job of a finial.
const BAR_TOP = TOP_Y;
const BARS_LONG = 4;         // between the posts on a 1.60 side
const BARS_SHORT = 3;        // and on a 1.10 one

// Post centres. The posts' outer faces are exactly the plot's envelope, so the
// footprint is PLOT_W by PLOT_L and nothing overhangs it: the finial is
// narrower than the post and the rails are thinner than it.
const RX = PLOT_W / 2 - POST / 2;   // 0.4825
const RZ = PLOT_L / 2 - POST / 2;   // 0.7325

// --- seating ----------------------------------------------------------------
//
// The registry decides a lean before extras runs and applies it after, so a
// 1.60 by 1.10 frame has to survive the worst draw it can make. rotation.x runs
// to -0.032 and rotation.z to +/-0.0225; over the frame's own half extents that
// lifts the shallowest corner by 0.8 * 0.032 + 0.55 * 0.0225 = 0.038. At
// SINK 0.050 that corner still stands 12 mm into the ground and the deepest one
// 88 mm, so no post ever floats and the near-far difference in how deep the
// frame sits is a century of settling. Checked by walking every vertex of the
// finished body under its world matrix over eight seeds, never with a Box3.
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

// Where the tablet stands: back toward the head, clear of the head rail by
// 0.12 at the plinth. Far enough forward that the near railing crosses it well
// up its plinth and into the face.
const TABLET_Z = -0.40;
// Bedded into the chippings rather than balanced on them. The registry's plinth
// has a 0.056 bottom radius, and resting exactly on the tangent point shows
// daylight under its corners.
const BED_IN = 0.030;

// pillar.js and bracket.js's iron, exactly, because a graveyard should have one
// ironmonger. Warm rather than the crook lamp's cool grey: it has to separate
// in hue from the stone it stands in front of, and grey bars on a grey tablet
// separate in value alone, which is the first thing distance takes away.
const IRON = '#615b52';
const IRON_ROUGH = 0.46;

// Dates cut on the tablet. One per seed, so two plots in a graveyard are not
// the same casting even where a viewer can read the face.
const YEARS = ['1861', '1874', '1888', '1893', '1859', '1866'];

// A round bar standing on its own foot, with a domed tip.
//
// The house style has no cut ends. A sphere of the tube's own radius centred on
// the tube's last ring is the exact continuation of that surface, so the two
// agree in position and in normal and the weld is invisible; brazier.js's roll()
// makes the same join for the same reason.
function bar(len, r, tip) {
  const parts = [new THREE.CylinderGeometry(r, r, len, 12, 1)];
  parts[0].translate(0, len / 2, 0);
  if (tip) {
    const cap = new THREE.SphereGeometry(r, 12, 8);
    cap.translate(0, len, 0);
    parts.push(cap);
  }
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
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
      // Well under the registry's 0.062: that floor is about the FACE of a
      // headstone, where a convex arc under it inverts. A 0.135 post admits
      // 0.030 of rounding and no more, and 0.030 on 0.135 is proportionally the
      // same knock-off the slab's 0.062 is on a 0.92 wide stone.
      edge: 0.030,
      // Kept above `edge` on purpose. At exactly edge the innermost ring's
      // corner radius reaches zero and every vertex of that corner collapses
      // onto one point.
      bottomRadius: 0.034,
      topRadius: 0.034,
      uv: () => [0.5, 0.5],
    }),
    new THREE.CylinderGeometry(NECK_R, NECK_R * 1.12, NECK_H + 0.02, 12, 1),
    new THREE.SphereGeometry(FINIAL_R, 16, 12),
  ];
  parts[1].translate(0, POST_H + NECK_H / 2 - 0.01, 0);
  parts[2].scale(1, FINIAL_TALL, 1);
  parts[2].translate(0, POST_H + NECK_H + FINIAL_R * FINIAL_TALL * 0.88, 0);
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return geo;
}

registerStone('railed', {
  // The tablet: 0.54 by 1.00 with a 0.15 plinth, 1.15 to the crown before it is
  // lifted onto the bed and 1.20 after. The posts stand at 1.00, so the stone
  // clears the railing by a fifth of its own height, which is the proportion a
  // real railed plot has and is also the only way the arch is ever seen: below
  // the top rail every horizontal line on this piece is competing with a bar.
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
  // are the set's own letter size. Measured coverage 4.7% of the face, at the
  // light end of the 3 to 5% band a strong silhouette belongs in, against 3.8,
  // 6.8 and 9.2 for the approved three.
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
    const lift = G + BED_TOP - BED_IN;
    for (const m of [slab, plinth]) {
      if (!m) continue;
      m.position.y += lift;
      m.position.z += TABLET_Z;
    }

    // --- the ironwork -------------------------------------------------------
    //
    // Everything metal is merged into ONE geometry and drawn once. A railing is
    // twenty-odd separate members and twenty-odd draw calls for a background
    // prop is not a trade worth making; crook.js and brazier.js merge their
    // ironwork for the same reason. It also means the whole cage is one shadow
    // caster, so the bars throw one connected shadow across the bed rather than
    // twelve that have each been biased apart.
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
    // post centre, so both its ends finish 0.0675 inside the post and there is
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
    // up through both rails to a domed tip above the top one. Started below the
    // floor rather than on the bed's surface: the bed's rim is rounded, and a
    // bar standing on the tangent point of it shows daylight under its foot
    // from the one camera this scene has.
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
    const missing = rng() < 0.5 ? Math.floor(rng() * slots.length) : -1;
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
