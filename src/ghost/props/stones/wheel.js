import * as THREE from 'three';
import { registerStone, buildSlabGeometry } from '../tombstones.js';

// The wheel-head cross: a solid disc head on a short, stout, tapering shaft,
// with a Latin cross cut INTO the face of the disc.
//
// It stands next to celtic.js, so the first thing to say is how the two are not
// the same monument. The celtic cross is a RING: its identity is the four
// openings, real daylight through real holes, which is why it is built as
// separate overlapping solids and why its head has to be half a metre of
// nothing between the bars. This one is the opposite claim. The head is one
// unbroken plate of stone and the cross is a groove in it, so at any distance
// the celtic reads as a lit cross with sky behind it and this reads as a solid
// dark coin with a mark on it. The other half of the separation is proportion:
// the celtic is the tallest thing in the set (1.62) on a slim shaft over a low
// die, and this is squat (1.37) with a broad head over a stubby flared shaft.
// Tall-and-pierced against short-and-solid.
//
// WHY THE REGISTRY'S SLAB IS THE DISC. buildSlabGeometry places its four corner
// arcs at (+-(W - r), ...) and, with both radii equal to the half width and the
// height equal to the width, all four centres collapse onto one point and all
// four radii are W: the outline is exactly a circle. So the head needs no new
// geometry at all. It arrives as a swept quarter-round disc with the set's own
// rim fillet, the set's planar face UVs, the set's weathering, and the set's
// two-map carving treatment, and the piece cannot drift away from its
// neighbours because it IS its neighbours' slab. All extras() has to build is
// the shaft, and lift the disc onto it.
//
// WHY THE CROSS IS PAINTED AND NOT CUT. It is the whole subject of the stone,
// which is the argument for cutting it, and it is exactly why it is painted
// instead. The set's carving is the two-map treatment -- dark floor, shaded
// wall under the upper edge, lit lower lip, and a normal map baked from a
// blurred copy so the mark reads lower at any distance -- and that treatment
// has one known failure mode: faces too NARROW to hold an 11 px groove wall.
// It broke on a 233 px obelisk face. This face is 1024 by 1024 px, the widest
// in the set, so the subject of the stone is being drawn where the treatment is
// at its strongest rather than where it is at its weakest. Cutting instead
// would mean giving up that slab and replacing the disc with a displaced grid
// whose normals are computed by hand -- reintroducing the seams, the recomputed
// normals and the faceting that the whole sweep exists to avoid -- to buy relief
// the baked normal already carries. The postmortem's warning points the same
// way: a geometric edge beats a mark, so a cut cross would stop being a mark on
// a face and start being joinery, on a stone whose entire read is one flat plate
// against one groove. Rounded floors and lips, which the house style asks for,
// are a roundRect and a blur here and a tessellation problem there.
//
// THE MARK IS THE ONLY MARK. No date, no R.I.P., and in particular no groove
// following the rim: an outline-parallel line adds no new shape, it only
// thickens the silhouette, which is one of the things the last set was rejected
// for. Measured off the finished colour map, the ink is 7.7% of the face box,
// which is inside the 5 to 10% the postmortem records for the approved stones
// and, on the same threshold, sits between fred's 6.4% and the top of the band.
// The face box here is the square the disc is inscribed in, so against the
// visible stone of the disc alone it is about 10%.

// --- proportions -----------------------------------------------------------

const R = 0.39; // disc radius, so a 0.78 head against the cross stone's 0.92 slab

// halfWidth = R and height = 2R is what turns the slab into the disc. The depth
// is the set's own range (0.25 to 0.32); a thin wheel would read as a coin
// stood on edge rather than as a plate of stone.
const SHAPE = { halfWidth: R, height: 2 * R, depth: 0.27, plinth: 0.17 };

// How far the disc is lifted clear of the plinth, i.e. the shaft. Total height
// works out at 0.17 + 0.50 + 0.78 = 1.45: between fred's 1.10 and the cross
// stone's 1.56, and a clear head shorter than the celtic's 1.62. The first cut
// of this had a 0.40 shaft and read as a ball on a stump; a wheel head needs
// enough shaft under it that the head is a HEAD.
const RISE = 0.50;

const DISC_Y = SHAPE.plinth + RISE; // bottom of the disc

// The shaft. Buried 0.07 into the plinth at the bottom and 0.09 into the disc at
// the top, so neither joint is a visible seam. Half width 0.28 falling to 0.215:
// a real taper, but a stout one. The celtic's shaft is slim because its ring
// only has openings if the shaft gets out of the way; nothing here is pierced,
// so the shaft is free to be the thick flared stump a wheel head wants under it.
const SHAFT_Y0 = 0.10;
const SHAFT_Y1 = 0.76;
const HW_BOT = 0.260;
const HW_TOP = 0.200;
const HZ_BOT = 0.125;
const HZ_TOP = 0.108;

// The shaft is buried at the top only if it fits inside the disc's circle
// there: at y = 0.76 the circle's half chord is sqrt(R^2 - 0.30^2) = 0.249,
// against a shaft half width of 0.200. The two outlines cross at about y = 0.73,
// which is where the cove under the head sits: 0.56 of exposed shaft, a little
// under three quarters of the head's diameter.

// Where the shaft samples the shared texture's plain right-hand strip. Low
// enough to still be inside the ground grime, which fades out two thirds of the
// way up the map, so the shaft is weathered like the plinth under it and the
// head is the clean part. The band has to be a band and not a single line: at
// one constant v the mottling would be the same texel all the way up and the
// shaft would come out vertically streaked.
const V0 = 0.16;
const V1 = 0.50;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- the shaft -------------------------------------------------------------

// The registry's own slab builder, squared off at both ends and then squeezed
// linearly as it climbs. Two reasons it is the slab and not a RoundedBoxGeometry:
// the rim fillet then matches the disc's exactly, because it is the same sweep
// at the same radius, and the normals come out of the sweep analytically instead
// of computeVertexNormals faceting every rounded edge.
//
// The taper is safe here for the reason buildSlabGeometry's own comment gives:
// the outline only places vertices where it CURVES, so a straight side is one
// quad end to end and anything applied per vertex has to be linear in y. A
// linear taper is.
function taperedShaft(edge, uv) {
  const h = SHAFT_Y1 - SHAFT_Y0;
  const geo = buildSlabGeometry({
    halfWidth: HW_BOT,
    height: h,
    depth: HZ_BOT * 2,
    edge,
    bottomRadius: edge,
    topRadius: edge,
    uv,
  });
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const kx = HW_TOP / HW_BOT - 1;
  const kz = HZ_TOP / HZ_BOT - 1;
  // The wall leans back by this much per unit of height, and the normal leans
  // with it. Tilting the existing normals rather than recomputing them is what
  // keeps the rounded edges rounded.
  const slopeX = (HW_BOT - HW_TOP) / h;
  const slopeZ = (HZ_BOT - HZ_TOP) / h;
  for (let i = 0; i < pos.length; i += 3) {
    const t = clamp01(pos[i + 1] / h);
    pos[i] *= 1 + kx * t;
    pos[i + 2] *= 1 + kz * t;
    const ny = nor[i + 1] + slopeX * Math.abs(nor[i]) + slopeZ * Math.abs(nor[i + 2]);
    const inv = 1 / Math.hypot(nor[i], ny, nor[i + 2]);
    nor[i] *= inv;
    nor[i + 1] = ny * inv;
    nor[i + 2] *= inv;
  }
  geo.translate(0, SHAFT_Y0, 0);
  geo.computeBoundingSphere();
  return geo;
}

// --- the mark --------------------------------------------------------------

// A Latin cross, incised. The four tips all sit the same distance from the
// centre of the disc, 0.69 of the radius, which is what makes an off-centre
// crossing still look laid out to the rim rather than shoved upwards: the top
// arm is short and the foot is half again as long, but all four end on one
// circle, and that circle leaves a seventh of the disc as clean stone inside
// the rim. An equal-armed cross was the first cut and it read as a plus sign.
//
// The arms are GROOVES, not a filled cross. A solid cross of this span would be
// 17% of the face in ink, twice the budget, and the postmortem is explicit that
// what got the last set rejected was tone rather than legibility. At 0.062 of
// the face the groove is 63 px wide, nearly four times the ~17 texel floor below
// which the two lip masks overlap and a cut reads as a smudge.
const GROOVE = 0.062;
const CROSS_Y = 0.415; // the crossing, a sixth of the disc above its middle
const ARM_UP = 0.260;
const ARM_DOWN = 0.430;
const ARM_SIDE = 0.325;

function drawCross(ctx, w, h) {
  const g = GROOVE * w;
  const r = g * 0.42; // rounded ends: a groove floor that turns, not a chisel stop
  const cx = w / 2;
  const cy = CROSS_Y * h;
  ctx.beginPath();
  ctx.roundRect(cx - g / 2, cy - ARM_UP * h, g, (ARM_UP + ARM_DOWN) * h, r);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - ARM_SIDE * w, cy - g / 2, ARM_SIDE * 2 * w, g, r);
  ctx.fill();
}

// --- assembly --------------------------------------------------------------

function build({ body, material, plinthH, edge, disposables, stripUV }) {
  // The registry parents the slab first and the plinth second, and the slab is
  // the one it stood on the plinth. That slab is this stone's head, so it goes
  // up onto the shaft; the plinth stays on the ground.
  const disc = body.children.find((m) => m.position.y === plinthH) || body.children[0];
  disc.position.y = DISC_Y;

  const h = SHAFT_Y1 - SHAFT_Y0;
  // v is handed to stripUV as the second argument with a height of 1, which is
  // the registry's way of saying "this IS the v I want".
  const geo = taperedShaft(edge, (x, y) => stripUV(x, V0 + (V1 - V0) * clamp01(y / h), HW_BOT, 1));
  const shaft = new THREE.Mesh(geo, material);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  body.add(shaft);
  disposables.push(geo);
}

// ---------------------------------------------------------------------------

registerStone('wheel', {
  shape: SHAPE,
  // Both radii equal to the half width: this is the line that makes the slab a
  // circle. Anything less and the head is a rounded rectangle on a stick.
  topRadius: R,
  bottomRadius: R,
  draw: drawCross,
  extras: build,
});
