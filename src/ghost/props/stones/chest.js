import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerStone, buildSlabGeometry } from '../tombstones.js';

// A chest tomb: the raised box that lies over a vault rather than standing at
// the head of it. Base mould, panelled body, and a ledger slab across the top
// that overhangs on every side.
//
// The set is a row of uprights, so what this piece adds is mass and a
// horizontal. It stands 0.845 to the cross stone's 1.56 and its base is 1.63
// long to that stone's 1.07: a little over half the height, half again the
// length, and two and a half times the footprint. That is the whole identity
// and it is all in the silhouette, which is what .ref/STONES-POSTMORTEM.md says
// the last rejected batch spent on outlines and marks instead. At the ninety
// pixels it occupies in the scene it reads as a long low box with a lid on it,
// and nothing else in the graveyard has that shape.
//
// Three decisions worth writing down:
//
// 1. The inscription goes on the long SIDE, not on the top slab. A top face is
//    seen at 29 degrees from this camera and everything on it loses half its
//    height; ledger.js takes that on and tilts its slab to claw a third of it
//    back. Doing that twice would make two pieces with the same problem and the
//    same solution. A chest tomb has a real vertical panel a foot and a half
//    long, so this one keeps its face flat and frontal, which is the one thing
//    the postmortem asks of every carved face. The top slab stays blank, and
//    reads as the lid it is.
//
// 2. The registry's slab IS the body of the chest, not a facing on it. Given a
//    depth of 0.62 the swept quarter-round slab is already a rounded box, so the
//    body, its rounded plan corners and its carved face are one mesh with one
//    analytic normal, and extras only has to add the lid and the corner posts.
//
// 3. "Panelled sides" is spent on geometry, not on ink. A groove following the
//    edge of the panel is exactly the outline-parallel moulding that got the
//    last set called busy: it adds no new shape, it just thickens the
//    silhouette. So the panel is framed the way a real chest tomb frames it,
//    by the base it stands on, the lid that overhangs it and a post at each
//    corner, and the field between them is left as clean stone with one mark on
//    it.

// Body. Height here is the registry's "up the face" axis, so the carved panel
// is 1.48 by 0.58 and its canvas comes out 2611 by 1024. That is a very wide
// face, and wide is the safe side of the engraving treatment: what it could not
// do was the narrow ones, where the groove wall has no room to be both fine and
// legible.
const HALF_LEN = 0.74;
const BODY_H = 0.58;
const BODY_D = 0.62;
// The base mould. The registry grows a plinth to halfWidth + 0.075 by depth +
// 0.13, which on this footprint is a 1.63 by 0.75 pad: near enough exactly the
// projecting base course a chest tomb stands on, so it is used as one.
const PLINTH = 0.16;

// The lid: 1.60 by 0.74 by 0.105, oversailing the body by 62mm all round and
// dying flush with the base mould. Overhang is the piece's one strong
// horizontal shadow line and it was tuned by eye against exactly one failure
// mode: at 0.10 with a thicker slab the reveal under it opens up, the body
// reads as a panel set BETWEEN legs, and the whole thing turns into a table.
// Pulled in to 62mm and thinned, it reads as a lid on a box. The thickness
// stays under the base's, so the tomb sits DOWN on the ground rather than
// balancing on a stalk.
const CAP_OVER = 0.062;
const CAP_T = 0.105;
const CAP_EDGE = 0.045;

// Corner posts. A chest tomb's long side is a panel with a colonnette at each
// end, and at this scale that is one fat rounded post, not a base, shaft and
// cap. They stand 32mm proud of the panel, which is enough for the key to catch
// one side of each and frame the field between them, and little enough that
// they stay corners of the box instead of legs under a top. Without them the
// piece is a rounded brick with a plate on it; that was rendered and it reads
// as a butter dish.
const POST_R = 0.105;
const POST_PROUD = 0.032;

// A hand-set tomb settles. The registry leans the body by up to 0.022 radians
// and sinks it 12mm, which is fine on a stone 0.9 wide and not on a base 1.63
// long: the lean alone lifts a far corner 18mm clear of the floor. It applies
// both AFTER extras and by assignment, so neither can be adjusted from here;
// what can be is where the meshes sit inside the body, and dropping all of them
// another 26mm does it: worked out on the corner of the base, the worst lean
// and the worst tilt together raise it 30mm, the registry's own sink pays 12 of
// that, and this pays the rest with 10mm to spare. It also reads as what it
// should read as, a heavy thing bedded into the turf.
const SINK = 0.026;

// The mark: an hourglass, cut into the middle of the panel.
//
// Chosen for what survives being shrunk. The bat is the set's cautionary tale:
// a mark is judged at the sixty-odd pixels it actually occupies in the scene,
// and what lives at that size is a small number of large features. An hourglass
// is four of them, two bars and two cones, none smaller than a twelfth of the
// mark, and the shape is unmistakable in outline at any size. It is also the
// motif this particular monument carries: on a chest tomb the long panel is
// where the memento mori goes.
//
// One figure and nothing else. No lettering beside it, no date, no border: the
// panel is two and a half times as wide as it is tall and the temptation is to
// fill it, which is the exact move that got the last set called busy. A lot of
// clean stone around one dark shape is the read.
//
// Measured, not guessed: 7.4% of the face, with an ink box 17% of the width by
// 74% of the height, against 3.6, 6.3, 9.1 and 9.1 for the approved cross,
// FRED, bat and ledger. Mid-band, and a long way under the 12 to 19 that got
// the last set rejected. Exported for that measurement and no other reason: the
// only way to weigh a mark is to draw it on a bare canvas and count it.
export function drawChestMark(ctx, w, h) {
  const cx = w / 2;
  const cy = h * 0.47; // a shade above centre: the bottom of the panel is where the grime is
  const H = h * 0.74; // overall height of the glass
  const BW = h * 0.44; // the two bars
  const BT = h * 0.095;
  const r = BT * 0.34; // even the engraved marks get rounded ends

  const top = cy - H / 2;
  const bot = cy + H / 2;
  ctx.beginPath();
  ctx.roundRect(cx - BW / 2, top, BW, BT, r);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - BW / 2, bot - BT, BW, BT, r);
  ctx.fill();

  // The glass itself: two cones with concave flanks meeting at a short neck.
  // The neck is a straight run rather than a point, because a point is a wedge
  // narrower than the groove wall and would close up into a scratch.
  const mouth = BW * 0.44; // half width where the cone meets its bar
  const nw = h * 0.021; // half width of the neck
  const nh = h * 0.020; // half height of it
  const yT = top + BT * 0.86;
  const yB = bot - BT * 0.86;
  const side = (s) => {
    // Down the flank of the top cone, held wide for the first third and then
    // dropping fast, which is what makes it read as a cone and not a triangle.
    ctx.bezierCurveTo(cx + s * mouth * 0.86, yT + (cy - nh - yT) * 0.46, cx + s * nw * 2.6, cy - nh * 2.2, cx + s * nw, cy - nh);
    ctx.lineTo(cx + s * nw, cy + nh);
    ctx.bezierCurveTo(cx + s * nw * 2.6, cy + nh * 2.2, cx + s * mouth * 0.86, yB - (yB - cy - nh) * 0.46, cx + s * mouth, yB);
  };
  ctx.beginPath();
  ctx.moveTo(cx - mouth, yT);
  side(-1);
  ctx.lineTo(cx + mouth, yB);
  ctx.moveTo(cx + mouth, yT);
  side(1);
  ctx.closePath();
  ctx.fill();
}

// Write a piece of extra geometry into the plain strip of the shared texture.
// Everything extras() builds has to be mapped by hand or it samples the
// inscription: u comes back from stripUV, which parks a point in the plain band
// on the right of the map, and only v is ours to choose.
function paintUV(geo, fn) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

// The strip is plain stone from top to bottom, so v is free, and what it buys
// is which part of the mottle a piece lands on. The lid is mapped across its
// DEPTH rather than up its 0.105 of thickness, because by height every vertex
// in it lands on the same row of the map and a 1.60 by 0.74 plate comes out as
// one row of pixels smeared over the whole thing. This band sits above the
// grime wash, which dies out at 0.68, so the lid stays the clean top surface it
// should be and still gets a real swell of mottle across it.
const LID_V = [0.72, 0.98];

registerStone('chest', {
  shape: { halfWidth: HALF_LEN, height: BODY_H, depth: BODY_D, plinth: PLINTH },
  // A box, so both ends of the outline are the same soft rounded rectangle
  // rather than an arch. 0.13 is as round as the corners can go before a
  // 0.58-tall body starts reading as a lozenge.
  topRadius: 0.13,
  bottomRadius: 0.13,
  draw: drawChestMark,

  extras({ body, material, rng, plinthH, halfWidth, height, disposables, stripUV }) {
    // Captured before anything of ours is added, so the sink at the bottom of
    // this function moves the registry's slab and plinth only: everything built
    // here is placed at its sunk height already.
    const registryMeshes = body.children.filter((o) => o.isMesh);

    const add = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      body.add(m);
      return m;
    };

    // --- the lid ------------------------------------------------------------
    // buildSlabGeometry sweeps its outline through the depth axis, so a slab
    // whose "height" is its thickness comes out as exactly this: a flat plate,
    // rounded over its long edges by the sweep and over its ends by the
    // outline. Corner radius is just under half the thickness, which makes both
    // ends a half round.
    const capHalf = halfWidth + CAP_OVER;
    const capGeo = buildSlabGeometry({
      halfWidth: capHalf,
      height: CAP_T,
      depth: BODY_D + 2 * CAP_OVER,
      edge: CAP_EDGE,
      // Corner radius has two hard limits: not below the sweep's own edge
      // radius, or the outline inverts, and the two together not above the
      // thickness, or the corner circles overlap and the sweep folds.
      bottomRadius: CAP_T * 0.46,
      topRadius: CAP_T * 0.46,
      uv: () => [0, 0], // overwritten below: this one is mapped across its depth
    });
    const capD = BODY_D + 2 * CAP_OVER;
    paintUV(capGeo, (x, y, z) => [
      stripUV(x, 0, capHalf, 1)[0],
      LID_V[0] + (LID_V[1] - LID_V[0]) * ((z + capD / 2) / capD),
    ]);
    disposables.push(capGeo);
    const cap = add(capGeo, 0, plinthH + height - SINK, 0);
    // The one thing that varies per seed. A ledger this size was laid on the
    // body by hand and has had a century to shift: a degree and a half of twist
    // and 15mm of slip, which is a tenth of what the overhang can absorb, so
    // the lid still covers the body at every corner. Nothing else on the piece
    // moves, because a chest tomb is a masonry box and a wonky one reads as a
    // modelling error rather than as age.
    cap.rotation.y = (rng() - 0.5) * 0.05;
    cap.position.x += (rng() - 0.5) * 0.03;
    cap.position.z += (rng() - 0.5) * 0.022;

    // --- corner posts -------------------------------------------------------
    // Painted, then cloned into place and merged, so four posts cost one draw
    // call and one shadow pass rather than four of each. The UVs are written
    // before the copies are moved for the reason the merge exists at all: after
    // the translation a post's x is its position in the tomb, and stripUV read
    // with that x would walk straight off the plain strip and into the
    // inscription.
    const post = new THREE.CylinderGeometry(POST_R, POST_R, height + 0.02, 24, 1);
    // These do have height, so they are mapped up it: the grime that washes up
    // the bottom of the carved panel washes up the posts by the same amount.
    paintUV(post, (x, y) => stripUV(x, height / 2 + y, POST_R, height));
    const px = halfWidth - POST_R + POST_PROUD;
    const pz = BODY_D / 2 - POST_R + POST_PROUD;
    const copies = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        copies.push(post.clone().translate(sx * px, plinthH + height / 2 - SINK, sz * pz));
      }
    }
    const postGeo = mergeGeometries(copies);
    post.dispose();
    for (const c of copies) c.dispose();
    disposables.push(postGeo);
    add(postGeo, 0, 0, 0);

    // Bed the whole thing down. See SINK.
    for (const m of registryMeshes) m.position.y -= SINK;
  },
});
