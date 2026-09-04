import * as THREE from 'three';
import F from './metrics.js';
import { rng } from './wood.js';
import {
  PANEL_LAYOUT, picketGeometry, postGeometry, railGeometry, woodPanelMaterial,
} from './panel.js';

// A garden gate for the picket fence: a hinge post, a latch post, and a leaf
// hung between them that swings a full quarter turn either way.
//
// Origin on the ground at the HINGE POST's centre, gate closed, spanning the
// same width as one panel (post centre to post centre), so a run can be laid
// out as panel, panel, gate, panel without anyone doing arithmetic. The run
// goes along local X and the gate faces local +Z, same as panel.js.
//
// Everything here is cut from panel.js's three parts. Not a single new
// primitive: the posts are postGeometry scaled, the leaf is picketGeometry and
// railGeometry, and every piece of hardware is a length of rail stock resized.
// That is not thrift, it is the only way the gate comes out of the same kit as
// the fence -- and it is also what keeps the grain right, because the grain
// rides in vertex attributes that only panel.js writes. A board built here with
// board() and drawn with woodPanelMaterial() would come out black (no colour
// attribute) or flat cream (plain woodMaterial), which is the trap metrics.js
// warns about.
//
// THE SEAM WITH THE PHYSICS. The leaf and its hardware hang off `hinge` and off
// nothing else. `hinge.rotation` is identity at rest and `rotation.y = 0` is
// exactly closed, so the physics agent owns that one number and nothing here
// pre-rotates anything or animates a second node. `hinge.position` is NOT zero
// and cannot be: the pivot is out in the gap between post and leaf, about
// 0.17 from the group's origin, and the group's origin is pinned to the post's
// centre by the contract. It is a fixed offset, set once at build time, never
// written again.

const L = PANEL_LAYOUT.length;
const RAIL_Z = PANEL_LAYOUT.z.rail;
const POST_Z = PANEL_LAYOUT.z.post;

// ---------------------------------------------------------------------------
// stock
//
// Numbers that are not in metrics.js live here, marked, and are all fractions
// of things that are. See the report at the end of the session for the ones
// worth promoting into F.

// How much stouter and taller a gate post is than a run post. Stouter because
// it carries the swing, and that much stouter for a second reason: a gate
// dropped into a run shares its boundary with a panel, so the panel's own end
// post stands in the same world spot. The two are concentric, so the fix is to
// swallow it whole -- 20% on the section clears the panel post's face by 15mm
// against a worst case of 11mm of combined warp, and 7% on the height puts the
// two square tops well apart instead of coplanar and z-fighting. Tried 14%
// first, which left the two faces 0.1mm apart at the unlucky end of the warp
// range and shimmered.
const POST_STOUT = 1.20;
const POST_TALLER = 1.07;
const POST_HALF = (F.post.width * POST_STOUT) / 2;

// The leaf's depth, straight off the panel's own layering: pickets on the face,
// rails behind them.
const LEAF_FRONT = F.picket.thickness / 2;
const LEAF_BACK = -(F.picket.thickness / 2 + F.rail.depth);
// Dead centre of that sandwich. It comes out at -F.rail.depth / 2, which is
// exactly PANEL_LAYOUT.z.post -- the panel already centres its posts on the
// assembly's depth for its own reasons, and the gate needs the same plane for
// a different one (below). Asserted rather than assumed.
const LEAF_MID = (LEAF_FRONT + LEAF_BACK) / 2;
const LEAF_HALF = (LEAF_FRONT - LEAF_BACK) / 2;

// Hardware thicknesses. A strap and a latch bar are boards like everything
// else, just small ones.
const STRAP_T = 0.012;
const STRAP_TALL = 0.052;
const BAR_T = 0.022;
const BAR_TALL = 0.050;

// The air the leaf keeps off both posts through the whole swing.
const SWING_CLEAR = 0.011;

// WHERE THE PIVOT GOES, and it is the number the whole file is built around.
//
// The leaf has to clear the post at a full quarter turn EACH way. Turn the leaf
// 90 degrees and its depth, which was lying flat in the fence plane, is now
// standing across the opening: the material that was on its front face is now
// at x = pivot - halfDepth. So the pivot has to stand off the post's face by
// the leaf's half depth plus whatever the straps add plus the working air, or
// the leaf's own face sweeps through the post. There is no cleverness
// available: hanging the pivot on the post's face, the way a face-mounted strap
// hinge really works, buys a gate that swings one way and eats the post the
// other, and moving the pivot off the leaf's depth centre makes the two
// directions differ, which fails the same test on one side.
//
// So the pivot sits in the gap, on the leaf's mid-depth plane, and the gap it
// opens up -- about 82mm between post face and leaf edge -- is not a mistake to
// be tuned away, it is what a gate that swings both ways costs. Worth knowing
// before anyone tries to close it: it is still NARROWER than the 135mm the
// fence leaves between two pickets, so it reads as one more gap in the rhythm
// rather than as a hole, and the straps cross it at both rail heights.
const HINGE_X = POST_HALF + LEAF_HALF + STRAP_T + SWING_CLEAR;

// The far end is a radius, not a width. Every point of the swinging leaf sits
// at some distance from the pivot and keeps it forever, so the leaf clears the
// LATCH post at every angle if and only if its furthest point is nearer the
// pivot than the latch post's nearest point is. That distance, less the working
// air, is the whole budget:
const REACH = (L - POST_HALF) - HINGE_X - SWING_CLEAR;
// and the leaf's length is what is left of the budget after its own half depth,
// counting the latch bar, since the corner is what is furthest out.
const LEAF_HALF_MAX = LEAF_HALF + BAR_T;
const LEAF_LEN = Math.sqrt(REACH * REACH - LEAF_HALF_MAX * LEAF_HALF_MAX);

// How high the leaf hangs off the dirt. A gate that touches the ground is a
// panel; this is the shadow line under it that says the thing moves. The leaf's
// pickets are cut short by the same amount so their tops still land at
// F.picket.height and the gate does not stand proud of the fence it is in.
const GROUND_CLEAR = 0.05;

// Both gate posts are built from one seed, for the same reason panel.js pins
// POST_SEED: a pair either side of an opening is looked at as a pair, and two
// different jitters there read as a mistake. Not shared with the panel's, since
// these are scaled anyway and could never be bit-identical to one.
const GATE_POST_SEED = 5231;

// The angle the physics wants: below this the leaf's latch edge is still inside
// the latch post's depth, so the latch bar is still beside its keeper and a
// swing at this end of the range is a swing into the stop. Above it the leaf's
// edge has swung clear of the post's shadow altogether and nothing on the post
// can touch it.
//
// It is the angle at which the trailing corner of the leaf leaves the band
// |z - postZ| < postHalf: rotate (LEAF_LEN, LEAF_HALF_MAX) about the pivot and
// solve for the corner crossing that plane. Symmetric by construction, because
// the pivot is on the leaf's mid-depth plane, which is the same fact that makes
// the swing symmetric.
const LATCH_ANGLE = Math.asin(POST_HALF / Math.hypot(LEAF_LEN, LEAF_HALF_MAX))
                  + Math.atan2(LEAF_HALF_MAX, LEAF_LEN);

// ---------------------------------------------------------------------------
// hardware, cut from rail stock
//
// Both stock pieces spend the FIRST draw of their stream on how far out of
// true the board is: the rail on its sag, as (0.35 + 0.65 * r) * F.rail.warp,
// the picket on its bow, as (r - 0.5) * 2 * F.picket.warp. There is no way to
// ask for a straighter one through the front door, and the flattest rail the
// stock gives is still a 3.9mm droop. Fine over two metres and very much not
// fine over a 300mm strap, where it reads as a banana rather than as age.
//
// So a hardware seed is walked forward until its first draw lands where the
// piece wants it, which costs a few hundred hashes at build time and leaves the
// rest of the stream, and therefore the grain, exactly as it was. Rejected:
// scaling the board down after the fact, which scales the bow with it and keeps
// the same one-in-thirty droop.
function seedWhere(seed, ok) {
  for (let s = seed; s < seed + 4096; s++) if (ok(rng(s)())) return s;
  return seed;
}
const FLAT = (r) => r < 0.02;              // rail: least sag on offer
const TRUE_ = (r) => Math.abs(r - 0.5) < 0.02;  // picket: least bow on offer

// A length of the fence's rail, resized. `tall` is its vertical face and `deep`
// how far it stands off whatever it is nailed to, matching railGeometry's own
// convention. Comes back lying along X, centred, painted, with both ends
// capped, because it IS a rail.
function stick({ length, tall, deep, seed }) {
  const geo = railGeometry({ rand: rng(seedWhere(seed, FLAT)), length });
  geo.scale(1, tall / F.rail.thickness, deep / F.rail.depth);
  return geo;
}

// A length of the fence's PICKET, resized and laid on its side, so it comes
// with the set's own sawn taper on one end. That taper is why the straps and
// the latch bar are cut from picket stock rather than rail: a strap hinge and a
// latch bar are both tapered in every reference, and a plain rectangular cleat
// at a rail's height reads as a second rail rather than as hardware. It was
// tried that way first and the gate came out looking like a panel with four
// rails on it.
//
// Comes back running along +Y with the point at the top, ready for the -90
// degree lean that lays it along +X, point outward.
function tapered({ length, width, thick, seed }) {
  const geo = picketGeometry({ rand: rng(seedWhere(seed, TRUE_)), height: length, width });
  geo.scale(1, 1, thick / F.picket.thickness);
  return geo;
}
const LIE_DOWN = -Math.PI / 2;

// ---------------------------------------------------------------------------
// layout
//
// Everything below is written for a gate hinged at the -X end. `hingeSide`
// mirrors it by flipping the sign of every x and of every rotation, which needs
// no mirrored geometry: a board's section is symmetric across its own axis and
// its sag is symmetric along it, so a reflected placement of the same board is
// a board. Scaling a mesh by -1 would have been the short way and is wrong --
// it inverts the winding and the leaf renders inside out.

export const GATE_LAYOUT = {
  length: L,
  pitch: PANEL_LAYOUT.pitch,
  hingeX: HINGE_X,
  leaf: { x0: HINGE_X, length: LEAF_LEN, bottom: GROUND_CLEAR, mid: LEAF_MID },
  post: { half: POST_HALF, height: F.post.height * POST_TALLER },
  latchAngle: LATCH_ANGLE,
};

export function createGate({ seed = 1, scale = 1, hingeSide = 'left' } = {}) {
  // 'left' and 'right' as seen from in front of the fence, which faces +Z, so
  // left is the -X end. A pair of gates facing each other is one of each.
  const s = hingeSide === 'right' ? -1 : 1;

  const rand = rng(seed);
  const sym = () => rand() * 2 - 1;
  const geoSeed = () => 1 + Math.floor(rand() * 0xffffff);

  const material = woodPanelMaterial();
  const geometries = new Set();

  const group = new THREE.Group();

  // The one moving node. Identity rotation, and the offset below is the pivot's
  // place in the frame, not an animation.
  const hinge = new THREE.Object3D();
  hinge.position.set(s * HINGE_X, 0, LEAF_MID);
  group.add(hinge);

  // x and z are always given in gate coordinates -- x from the hinge post's
  // centre, z in the fence's own depth -- whichever node the piece ends up on,
  // so that nothing in this file has to think in two frames at once.
  const add = (parent, geo, x, y, z, { lean = 0, spin = 0, name = '' } = {}) => {
    geometries.add(geo);
    const mesh = new THREE.Mesh(geo, material);
    // Named because two different readers need to pick pieces out by hand: the
    // clearance harness, which tests the swing against the posts and has to
    // know which is which, and anyone debugging the hinge later.
    mesh.name = name;
    if (parent === hinge) mesh.position.set(s * (x - HINGE_X), y, z - LEAF_MID);
    else mesh.position.set(s * x, y, z);
    mesh.rotation.z = s * lean;
    mesh.rotation.y = s * spin;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // --- the frame -----------------------------------------------------------

  const postGeo = postGeometry({ rand: rng(GATE_POST_SEED) });
  postGeo.scale(POST_STOUT, POST_TALLER, POST_STOUT);
  // Bedded like a panel post: no F.post.sink exists, so the picket's depth
  // eased off, exactly as panelParts does it.
  const postY = -F.picket.sink * 0.8;
  add(group, postGeo, 0, postY, POST_Z, { name: 'hingePost' });
  add(group, postGeo, L, postY, POST_Z, { name: 'latchPost' });

  const railY = F.rail.at.map((at) => at * F.picket.height);

  // The post face the hardware is nailed to, and the two planes the swing test
  // above says nothing static may cross: x = HINGE_X - LEAF_HALF - STRAP_T on
  // the hinge side, x = L - POST_HALF on the latch side. Both are held to here
  // with SWING_CLEAR to spare.
  const postFaceZ = POST_Z + POST_HALF;
  const plateReach = HINGE_X - LEAF_HALF - STRAP_T - SWING_CLEAR / 2;

  // Hinge plates: the half of each strap that stays with the post. A strap
  // hinge really is two pieces meeting at the pin, so this is not a shortcut,
  // it is the joint. The moving half cannot lap onto the post -- anything that
  // did would swing straight into it -- and this half cannot lean out into the
  // gap for the same reason in reverse, so they meet a couple of centimetres
  // short of each other, on the pin, which is what a hinge looks like anyway.
  for (const y of railY) {
    // Rooted inside the post, so the cut end that carries the stock's
    // ground-dirt tint is buried rather than sitting on the face, and pointing
    // at the pin. Short on purpose: a bracket that spanned the post's whole
    // width sat at exactly the height the neighbouring panel's rail arrives at
    // and read as that rail running straight over the post.
    const from = -0.02;
    add(group, tapered({
      length: plateReach - from, width: 0.046, thick: 0.014, seed: geoSeed(),
    }), from, y - 0.023, postFaceZ + 0.007, { lean: LIE_DOWN, name: 'hingePlate' });
  }

  // The pin. Standing rail stock, near square, on the pivot line: being
  // concentric with the swing it can never be hit by it, which is what lets it
  // be the one piece of the hinge that bridges the gap.
  const pinLen = railY[1] - railY[0] + STRAP_TALL * 2.4;
  add(group, stick({ length: pinLen, tall: 0.026, deep: 0.026, seed: geoSeed() }),
    HINGE_X, (railY[0] + railY[1]) / 2, LEAF_MID, { lean: Math.PI / 2, name: 'pin' });

  // The keeper. Sits on the latch post's front face with its inner end flush
  // with the post's inner face and not a millimetre proud of it, because the
  // gap in front of that face is swept by the leaf at some angle or other.
  const keeperX0 = L - POST_HALF;
  add(group, stick({ length: 0.132, tall: 0.062, deep: 0.015, seed: geoSeed() }),
    keeperX0 + 0.066, railY[1], postFaceZ + 0.0075, { name: 'keeper' });
  // The lip the bar drops behind, standing proud of the plate and hooking back
  // toward the leaf as far as the sweep allows, which is not far.
  add(group, stick({ length: 0.030, tall: 0.104, deep: 0.020, seed: geoSeed() }),
    keeperX0 + 0.017, railY[1] - 0.012, postFaceZ + 0.025, { name: 'keeperLip' });

  // --- the leaf ------------------------------------------------------------

  const x0 = HINGE_X;
  const x1 = HINGE_X + LEAF_LEN;

  // Rails first, same order as a panel, and the full width of the leaf so their
  // ends make its edges.
  for (const y of railY) {
    add(hinge, railGeometry({ rand: rng(geoSeed()), length: LEAF_LEN }),
      (x0 + x1) / 2, y, RAIL_Z);
  }

  // The brace. A gate hung on two rails alone racks at the latch corner and
  // hangs its nose in the dirt within a season, and the brace is the piece that
  // says out loud that this is a gate and not a panel someone cut down. It runs
  // UP from the hinge end so it works in compression; the other diagonal reads
  // the same in a still frame and is the wrong one, so it is worth being right.
  // Kept a little shallower than a rail so it sits inside the rails' depth band
  // and behind the pickets, and long enough that both cut ends are buried in a
  // rail rather than hanging in the air.
  const bx0 = x0 + 0.03;
  const bx1 = x1 - 0.03;
  const braceLen = Math.hypot(bx1 - bx0, railY[1] - railY[0]);
  add(hinge, stick({ length: braceLen, tall: 0.044, deep: 0.052, seed: geoSeed() }),
    (bx0 + bx1) / 2, (railY[0] + railY[1]) / 2, RAIL_Z,
    { lean: Math.atan2(railY[1] - railY[0], bx1 - bx0) });

  // Pickets, at the fence's own pitch and centred in the leaf, so the rhythm
  // inside the gate is the fence's rhythm and only the two steps across the
  // posts are a hair wide. Matching the fence's ABSOLUTE picket positions was
  // tried first and is worse: the leaf hangs off centre in its opening, so it
  // leaves 22mm of bare rail at one end and 92mm at the other.
  const n = F.panel.pickets;
  const margin = (LEAF_LEN - (n - 1) * PANEL_LAYOUT.pitch - F.picket.width) / 2;
  const j = F.picket.jitter;
  for (let i = 0; i < n; i++) {
    const x = x0 + margin + F.picket.width / 2 + i * PANEL_LAYOUT.pitch;
    const width = F.picket.width * (1 + sym() * j.width);
    // Hanging, not planted: the bottoms are as uneven as a panel's tops are,
    // and both ends jitter about the same amount they do on the fence.
    const bottom = GROUND_CLEAR + rand() * 0.012;
    const height = (F.picket.height - bottom) * (1 + sym() * j.height);
    // A picket nailed to a braced frame has far less room to go out of true
    // than one nailed to a fence that is settling, so the lean is held down to
    // the floor value rather than drawn against leanChance.
    add(hinge, picketGeometry({ rand: rng(geoSeed()), height, width }), x, bottom, 0, {
      lean: sym() * j.lean * F.picket.leanFloor,
      spin: sym() * j.twist,
    });
  }

  // --- hardware on the leaf ------------------------------------------------

  // Two straps. Each is three boards: a blade along the face, a wrap round the
  // hinge edge, and a knuckle reaching in to the pin. The wrap is what makes it
  // a strap rather than a cleat, and it is also the piece that has to be
  // counted in HINGE_X, since it thickens the leaf exactly where the swing is
  // tightest.
  for (const y of railY) {
    // The blade, tapering away from the hinge the way a strap does. Its butt
    // end is against the wrap, which hides the cut.
    add(hinge, tapered({ length: 0.30, width: 0.05, thick: STRAP_T, seed: geoSeed() }),
      x0, y - 0.025, LEAF_FRONT + STRAP_T / 2, { lean: LIE_DOWN });
    // Standing across the leaf's depth, so it laps both faces and caps the end
    // grain. Turned with rotation.y rather than built along Z, because the only
    // board this set has runs along X.
    add(hinge, stick({
      length: (LEAF_FRONT - LEAF_BACK) + STRAP_T * 2, tall: STRAP_TALL, deep: STRAP_T, seed: geoSeed(),
    }), x0 - STRAP_T / 2, y, LEAF_MID, { spin: Math.PI / 2 });
    // The eye. Stops at the pin, where the plate on the post picks the line up.
    add(hinge, stick({ length: 0.062, tall: 0.036, deep: 0.036, seed: geoSeed() }),
      x0 - 0.024, y, LEAF_MID);
  }

  // The latch: a bar along the closing edge with a hook dropping off its end,
  // sitting a centimetre from the keeper. It cannot reach INTO the keeper, and
  // that is not a compromise: a bar that engaged a keeper on the post would be
  // a bar that fouled it on the way past, which is the same thing this file
  // spends its whole budget avoiding. The centimetre is the throw, and
  // LATCH_ANGLE is how much swing it is worth.
  add(hinge, tapered({ length: 0.34, width: BAR_TALL, thick: BAR_T, seed: geoSeed() }),
    x1 - 0.34, railY[1] - BAR_TALL / 2, LEAF_FRONT + BAR_T / 2, { lean: LIE_DOWN });
  // The thumb piece at the near end, so the bar reads as something a hand
  // lifts rather than as a batten nailed across the boards.
  add(hinge, stick({ length: 0.075, tall: 0.026, deep: BAR_T, seed: geoSeed() }),
    x1 - 0.335, railY[1] + 0.03, LEAF_FRONT + BAR_T / 2, { lean: Math.PI / 2 });

  group.scale.setScalar(scale);

  return {
    group,
    hinge,
    latchAngle: LATCH_ANGLE,
    // Inert, like the panel's. The swing belongs to whoever owns the physics;
    // this prop must never write hinge.rotation itself or there would be two
    // hands on it.
    update() {},
    dispose() {
      for (const geo of geometries) geo.dispose();
      material.dispose();
    },
  };
}

export default createGate;
