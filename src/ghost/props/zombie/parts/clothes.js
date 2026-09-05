import * as THREE from 'three';
import M from '../metrics.js';
import { sheet2, tatterAt, put, v3, mix, smoothstep } from './forms.js';

// ONE COAT. That is the whole file.
//
// The pass before this had a jacket body, two lapels, a collar roll, two
// sleeves, three worn-through holes, a scalloped hem, a shorts waistband with
// a hole in it and two shorts cuffs with two more holes, wrinkles and rolled
// lips. Eleven meshes and a paragraph each, and at 105 px the whole lower half
// of the figure was one mottled brown-green area.
//
// The standard is the ghost: a white sheet with two black eyes. So the coat is
// one shell, open at the front, with a torn hem and two short sleeves, and
// nothing else. No holes, no wrinkles, no lapels. What makes it read is not
// detail, it is:
//
//   VALUE. The coat is dark and the skin is light. At game scale the figure is
//   three masses -- a pale head, a dark body, dark boots -- and hue does
//   almost nothing at that size. The previous pass had the cloth within a few
//   per cent of the skin's value and it disappeared into the body.
//
//   SHAPE. It flares from the shoulders to a hem well down the thigh, so the
//   torso is a bell rather than a tube, and the front opens in a V wide enough
//   to frame the wound from any angle the game camera can reach.
//
//   A BOLD HEM. Five big torn points, not thirty small ones. A fine sawtooth
//   at this size is a fuzzy edge; five points is a shape.
//
// THE ARM RULE still holds and is still measured: an arm reads when its OUTER
// edge stands against the background, so the coat may pass behind the arms
// freely, and the test is the outer contour rather than the gap.
//
// The shorts are gone with the rest. The coat's hem is below the point where
// they showed, and bare green shin between a dark coat and dark boots is a
// cleaner rhythm than a third band of cloth in between.

const J = M.jacket;

// THE COAT IS CLOSED. u runs the whole way round.
//
// It spent two rounds hanging open with a V at the front, which is what the
// reference had, and it never read as a garment: at 0.80 rad the opening is 92
// degrees and the coat is two black strips at the sides, and closing it to
// 0.46 only made them two narrower strips with a light stripe between. A dark
// mass split down the middle by a light one is not one mass, it is three.
//
// Closed, it is a single dark bell from the shoulders to mid-thigh, and the
// figure becomes what it should have been from the start: a big pale head, one
// dark body, two dark boots. It also puts the zombie's silhouette where it
// belongs relative to the other two -- the skeleton is open and airy and made
// of gaps, the ghost is a closed dome, and this is a closed squat block.
//
// The wound is not lost with the opening. The coat has ONE TEAR over it, and
// because `sheet2` is a closed solid every open edge it leaves is walled for
// free, so the tear has real thickness and the dark red shows through it.
const azOf = (u) => 2 * Math.PI * u;

// The coat's top edge, per azimuth. Level, it gives the figure square
// shoulders: a horizontal cut across a round body reads as a sandwich board.
function topAt(u) {
  const a = azOf(u);
  const side = Math.min(a, 2 * Math.PI - a) / Math.PI;
  const overShoulder = Math.exp(-Math.pow((side - 0.50) / 0.30, 2));
  return mix(J.top - M.arm.upperRadius * 0.20, J.top, overShoulder);
}

// The cross-section, as an EXPLICIT PROFILE rather than as an offset from the
// trunk.
//
// Reading it off `trunkRadius` is the obvious thing and it is wrong here: the
// trunk's blocks stop at the pelvis, so below 0.554 the lookup returns nothing
// and the coat collapses onto a constant fallback. What that produced was a
// garment that narrowed from the chest to a pinched skirt exactly where it was
// supposed to be widest, which is most of why the first version of it read as
// a shrivelled rag rather than as a coat.
//
// Four stations, interpolated: shoulder, chest, waist, hem. It pulls in a
// little at the waist and swings out at the hem, which is the whole shape of a
// coat and the only reason the torso has a silhouette of its own.
// Shoulder, deltoid, chest, waist, hem. The deltoid station is not optional:
// the drawn arm's bulb reaches x = 0.172 and a coat cut at 0.176 there has the
// shoulder poking through it in pale blotches, which is what the first closed
// version did.
const STATIONS = [
  [J.top, 0.180, 0.146],
  [1.062, 0.208, 0.162],
  [0.900, 0.182, 0.150],
  [0.720, 0.164, 0.140],
  [J.hem, 0.205, 0.176],
];
function coatSection(y) {
  let i = 0;
  while (i < STATIONS.length - 2 && y < STATIONS[i + 1][0]) i++;
  const [y0, w0, d0] = STATIONS[i];
  const [y1, w1, d1] = STATIONS[i + 1];
  const t = smoothstep(y0, y1, y);
  return [mix(w0, w1, t), mix(d0, d1, t)];
}
function coatRadius(y, a) {
  const [hw, hd] = coatSection(y);
  const sa = Math.sin(a), ca = Math.cos(a);
  return 1 / Math.hypot(sa / hw, ca / hd);
}

export function buildJacket({ materials }) {
  const group = new THREE.Group();       // lives in `frames.inUpper`: world heights
  const geos = [];
  const track = (g) => { geos.push(g); return g; };

  const U = 52, V = 18;
  const point = (u, v) => {
    const a = azOf(u);
    // Five big torn points. The sawtooth is measured UP from the hem so it
    // never crosses the top edge.
    const y = mix(topAt(u), J.hem + tatterAt(u, 5, J.tatter, 3.1), v);
    const r = coatRadius(y, a);
    return v3(Math.sin(a) * r, y, Math.cos(a) * r);
  };
  const normalAt = (u) => {
    const a = azOf(u);
    return v3(Math.sin(a), 0, Math.cos(a));
  };
  // The one tear, over the wound. Its centre is the wound's own azimuth and
  // height, so the two are aligned by construction rather than by eye.
  const tearU = J.tearAt / (2 * Math.PI);
  const tearV = (J.top - J.woundY) / (J.top - J.hem);
  // The tear's outline is IRREGULAR, and this is not the disguise the
  // postmortem warns about. There, a wobble was added to an eye socket to hide
  // a staircase on a feature whose reference has clean smooth edges, and it
  // read as corruption. A tear in cloth is genuinely irregular, and the
  // problem here is the opposite one: a smooth ellipse cut out of a quad grid
  // produces AXIS-ALIGNED steps, and a rectilinear edge on a rag reads as
  // pixellation. Three lobes break the steps out of alignment and the edge
  // reads as torn. The grid is also finer than it needs to be for the cloth,
  // for the same reason.
  const keep = (u, v) => {
    const du = u - tearU;
    const wrapped = du - Math.round(du);
    const dv = v - tearV;
    const th = Math.atan2(dv / J.tearTall, wrapped / J.tearWide);
    const edge = 1 + 0.22 * Math.sin(3 * th + 1.1) + 0.10 * Math.sin(5 * th);
    return Math.hypot(wrapped / J.tearWide, dv / J.tearTall) > edge;
  };
  put(group, track(sheet2({ uSteps: U, vSteps: V, point, normalAt, thickness: J.thickness, keep, closedU: true })),
    materials.jacket, { name: 'jacket' });

  // NO SLEEVES. They were two more meshes and they bought nothing.
  //
  // The coat is a bell 0.18 to 0.21 wide at the shoulder and the upper arm
  // hangs at x = 0.12 to 0.20, so a sleeve on it is INSIDE the coat's own
  // silhouette from every angle: invisible when it fits, and when it did not
  // fit it poked through in pale mottled patches, which is what two
  // same-coloured surfaces two tenths of a millimetre apart look like.
  //
  // Without them each arm is one clean green shape from the shoulder to the
  // claw, standing against the dark body along its whole length, which is
  // worth more than a sleeve nobody can see.

  return { group, dispose() { for (const g of geos) g.dispose(); } };
}
