import * as THREE from 'three';
import { registerStone } from '../tombstones.js';

// A sunken ledger: the flat coffin slab that lies over a grave rather than
// standing at the head of it. Every other stone in the set is an upright, so
// the diversity this piece buys is not a new outline, it is a new posture:
// ground furniture, long and low, wide enough that the eye reads a slab of
// paving and not a chip of debris.
//
// Three things follow from lying down, and all three are decided here:
//
// 1. The registry stands its slab up and sets a plinth under it. Neither is
//    wanted, and neither can be switched off from a registration, so `extras`
//    lays the slab the registry has already built face-up and drops the plinth.
//
// 2. The inscription faces the sky, so the fixed scene camera sees it at 29
//    degrees rather than head on and everything on it is squashed to about
//    half height. The mark is therefore one big closed figure with fat strokes,
//    laid along the length of the slab, which is the axis that does NOT
//    foreshorten from this camera. Coverage is ~10% of the face: the top of the
//    approved set's 5-10% band, spent deliberately on the one stone whose face
//    is turned away from the viewer.
//
// 3. Sunk has to be real. The stone is seated from its own lowest transformed
//    vertex, never a bounding box, so the low end genuinely passes through the
//    floor instead of resting a millimetre over it.

// Plan is 1.56 by 0.88, thickness 0.18: a body-length slab, near enough the
// ghost's own 1.6, and the widest thing in the graveyard. Height here is the
// registry's "up the face" axis, which once the slab is laid down runs away
// from the camera, so the face reads 1.77:1 and the inscription gets a 1815 px
// canvas, well inside the engraving treatment's working range.
const HALF_WIDTH = 0.78;
const LENGTH_Y = 0.88;
const THICK = 0.18;
// The registry builds a plinth whatever a stone asks for, and a plinth of
// nearly nothing is worse than a plinth: at a height near zero the outline's
// two corner circles overlap and the sweep folds through itself. So this asks
// for an ordinary one, uses it to tell the two meshes apart, and drops it.
const PLINTH = 0.11;

// Face tipped toward the viewer: the far edge lifts, the near edge settles, and
// the mark is seen at 37 degrees instead of 29, which is about a quarter more
// apparent height for free. This is the whole reason the piece is legible at
// all from a camera that is only 29 degrees off the floor.
const TILT = 0.15;
// The subsidence, and it is the real one: a roll along the length that carries
// the -x end down into the earth. Nine degrees.
const DIP = 0.19;
// The stone is seated by the one number a viewer can actually see: where the
// floor crosses the carved face, as a fraction of the half-length in from the
// low end. Sinking by a depth instead is guesswork, and sinking by less than the
// slab's own thickness buries nothing but the underside, which is exactly how a
// slab resting on a lawn looks. At 0.56 a fifth of the
// stone is gone, the cut runs where the sides are parallel so it reads as a cut
// and not as the stone's own rounded end, and it takes the foot of the cross
// with it: a mark walking into the ground says buried in a way no heap of soil
// beside the stone managed to.
const WATERLINE = -0.56;
// ...and the depth is then checked, not assumed. Nothing may be left hovering.
const MIN_BURY = 0.05;

// Lowest point of a geometry once its matrix is applied, walked vertex by
// vertex. Box3.setFromObject would grow the local box by the rotation and hand
// back a tumbling cube's corner, which reads as a stone buried twice as deep as
// it is.
function lowestVertex(geometry, matrix) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    if (v.y < min) min = v.y;
  }
  return min;
}

function drawLedgerCross(ctx, w, h) {
  // Measured, not guessed: this comes out at 9.2% of the face against 3.6, 6.3
  // and 9.1 for the approved cross, FRED and bat. Top of the set's band and no
  // further, which is where a mark seen at 37 degrees rather than head on
  // belongs, and a long way under the 12 to 19 that got the last set rejected.
  const T = h * 0.110; // stroke, 0.097 in world: fat enough to survive being
  const L = w * 0.60; // seen at half height and squashed by the tone map
  const B = h * 0.55;
  const r = T * 0.34; // even the engraved marks get rounded ends
  const cx = w * 0.5;
  const cy = h * 0.5;
  ctx.beginPath();
  ctx.roundRect(cx - L / 2, cy - T / 2, L, T, r);
  ctx.fill();
  // Crossbar a quarter of the way down from the head, and the head is the
  // raised end: the busiest part of the mark sits on the part of the slab
  // that is highest, best lit and furthest from the earth.
  ctx.beginPath();
  ctx.roundRect(cx + L / 2 - L * 0.26 - T / 2, cy - B / 2, T, B, r);
  ctx.fill();
}

registerStone('ledger', {
  shape: { halfWidth: HALF_WIDTH, height: LENGTH_Y, depth: THICK, plinth: PLINTH },
  // Lying down, "top" and "bottom" are just the far and near long edges, so both
  // are set and set the same: a ledger is a rounded rectangle, not an arch. A
  // fifth of the half-width in each corner is as soft as the outline can go
  // before it turns into a lozenge.
  topRadius: 0.20,
  bottomRadius: 0.20,

  // One Latin cross running the length of the slab, which is what a real coffin
  // slab carries and, from this camera, the only orientation that keeps the
  // long stroke of the mark off the foreshortened axis. No lettering under it:
  // one closed figure on clean stone is the whole read, and a second element
  // would only fill the face up.
  draw: drawLedgerCross,

  extras({ body, rng, plinthH, halfWidth, height }) {
    const meshes = body.children.filter((o) => o.isMesh);
    // The registry lifts the slab onto the plinth and leaves the plinth at the
    // origin, so the two are told apart by where they sit rather than by the
    // order they happen to arrive in.
    const slab = meshes.find((m) => Math.abs(m.position.y - plinthH) < 1e-6) || meshes[0];
    const ridge = meshes.find((m) => m !== slab);

    // Lay it down. Rotating -90 about x puts the carved face up and sends the
    // top of the inscription away from the camera, which is how a ledger is
    // read: from its foot. The dip is applied in the parent's frame afterwards
    // so it tips one END of the slab down rather than one long edge.
    // Jittered per seed, and every knob only in the direction that cannot hurt:
    // the tilt never falls below what the mark needs, the dip never goes flat.
    // Two of these in one graveyard should not be the same casting.
    const tilt = TILT * (1 + rng() * 0.22);
    const dip = DIP * (0.9 + rng() * 0.35);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + tilt, 0, 0));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), dip));
    slab.quaternion.copy(q);

    // Centre the slab on the plot: its own middle is half way up the face.
    const centre = new THREE.Vector3(0, height / 2, 0).applyQuaternion(q);
    slab.position.set(-centre.x, -centre.y, -centre.z);

    // Drop it until the floor crosses the face where it is meant to. The
    // transform is affine, so the mid-line of the face is linear in x and one
    // sample of it is the whole answer.
    const faceMid = (x) => new THREE.Vector3(x, height / 2, THICK / 2).applyQuaternion(q).add(slab.position);
    slab.position.y -= faceMid((WATERLINE + (rng() - 0.5) * 0.14) * halfWidth).y;
    slab.updateMatrix();

    // Now check rather than trust. The deepest point of a rotated slab is not
    // the corner of its bounding box, and Box3.setFromObject would grow the
    // local box by the rotation and hand back a tumbling cube's corner, so this
    // walks the vertices. If the pose ever left the low end grazing the floor
    // instead of through it, the stone goes down until it is not.
    const low = lowestVertex(slab.geometry, slab.matrix);
    if (low > -MIN_BURY) {
      slab.position.y -= MIN_BURY + low;
      slab.updateMatrix();
    }

    // The registry's plinth goes. A ledger is not set on anything, and there is
    // no honest job left for a flat-topped bar: dressed as soil it reads as a
    // flat-topped bar of soil. Removing it costs a draw call and a shadow-map
    // pass rather than hiding it under the floor, and dispose() still owns its
    // geometry, so nothing leaks.
    if (ridge) body.remove(ridge);

    // No displaced earth, and this was tried properly before being given up:
    // five passes, from a run of clods to one long swept berm to a wide flat
    // swell in the floor's own colour, at close range and at the scene's own
    // 6.2 view size. Every one of them read as a puddle. A dome lit by a key
    // this high is darker than the flat floor around it however it is coloured,
    // so any mound at this scale becomes a closed dark shape sitting NEXT to the
    // stone, and a dark shape next to a stone is the exact failure the set's
    // rejected contact patches were: a stain in the dirt. What actually carries
    // the sink is the floor cutting a diagonal across the carved face, which is
    // geometry and cannot be argued with, and the diagonal is why the seating
    // above is measured rather than eyeballed.
  },
});

// TEMP-MEASURE
export { drawLedgerCross as __mark };
