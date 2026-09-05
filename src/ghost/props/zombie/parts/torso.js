import * as THREE from 'three';
import M from '../metrics.js';
import {
  closedRadial, roundBoxR, grommet, ellipseOutline, ovoid, arcTube, limb,
  put, v3, mix, smoothstep, recentre, assertOutward, assertInsideRadial,
} from './forms.js';

// The trunk, and the open ribcage in it.
//
// THREE OVERLAPPING CLOSED BLOCKS, one per spine segment. POSTMORTEM 2.6: a
// single mesh spanning the spine tears the moment `spineLower` moves, and the
// skeleton's "consecutive vertebrae overlap, not touch" rule is the same rule
// applied to a soft body. Pelvis hangs off `root`, belly off `spineLower`,
// chest off `spineUpper`, and each overlaps its neighbour by enough that a
// 0.45 rad bend never opens a gap.
//
// The trunk is NARROW -- see the long note on `M.torso` -- because fault two
// of the three that killed the third pass was that the arms vanished into it.
//
// THE CHEST CAVITY is the one piece of the third pass the postmortem says to
// lift wholesale, and this is it, in the same four layers:
//
//   1. the chest block, with the window's quads GENUINELY OMITTED;
//   2. a lip that funnels from the outer skin down to the cavity floor, so the
//      opening has an honest edge with thickness -- and which, being cut
//      LARGER than the omitted region, covers the ragged edge a quad grid
//      always leaves. That is the trick, and it is the same trick the head's
//      orbital rims use;
//   3. the flesh: a dark closed column, ANISOTROPIC at 0.88 wide by 0.34 deep;
//   4. the ribs and the spine, standing in the gap between the two.
//
// The anisotropy is the number that was found the hard way. One uniform scale
// either leaves you seeing straight past the column at the sides of the window
// or brings it forward to meet the skin and kills the depth the ribs stand in.
//
// It is built with the same `grommet` the head's features use, against the
// chest block's own radius function, so the cavity inherits the same
// guarantee: the flesh column and the lip are at `R(dir) - sink` and cannot
// escape the body at any rotation.

const T = M.torso;
const C = M.cavity;

// Block geometry, in WORLD heights. Every block is star-shaped about its own
// centre so a grommet can be set into it.
const BLOCKS = {
  // The pelvis. Wider than the waist, because the shorts hang on it and a
  // chibi's hips are its widest lower landmark. It reaches from below the hip
  // joint up past the waist, so it overlaps the belly through a full bend.
  pelvis: { cy: 0.672, hh: 0.118, hw: T.pelvisWidth / 2, hd: T.pelvisDepth / 2, n: T.section },
  // The belly's TOP is not free: it has to sit below `M.y.cavityBottom` or it
  // pokes up inside the chest cavity and you see green where the flesh should
  // be. That constraint sets cavityBottom, not the other way round.
  belly: { cy: 0.766, hh: 0.062, hw: T.waistWidth / 2, hd: T.waistDepth / 2, n: T.section * 0.95 },
  chest: { cy: 0.960, hh: 0.172, hw: T.chestWidth / 2, hd: T.chestDepth / 2, n: T.section },
};

if (BLOCKS.belly.cy + BLOCKS.belly.hh > M.y.cavityBottom) {
  throw new Error('zombie/torso: the belly block reaches above M.y.cavityBottom and will show inside the chest cavity.');
}

// A block's radius function, with a taper so it narrows toward the waist and
// toward the shoulders instead of being a barrel.
function blockR(b, { taperDown = 0, taperUp = 0 } = {}) {
  const base = roundBoxR(b.hw, b.hh, b.hd, b.n);
  return (d) => base(d)
    * (1 - taperDown * smoothstep(-0.10, -0.98, d.y))
    * (1 - taperUp * smoothstep(0.10, 0.98, d.y));
}

// The trunk's outer radius at a world height and azimuth, so a garment can be
// cut to hang on the body it is actually worn over instead of guessing. The
// blocks overlap, so this takes the widest of whichever ones reach that height.
export function buildTorso({ materials }) {
  const group = new THREE.Group();          // sits at `root`, i.e. y = M.y.hip
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const shed = new Map();

  // --- the joint chain --------------------------------------------------------
  // Every one identity at rest with world-aligned axes, and `model.js` checks
  // each against metrics.js REST to 1 mm.
  const spineLower = new THREE.Object3D();
  spineLower.position.y = M.y.waist - M.y.hip;
  group.add(spineLower);
  const spineUpper = new THREE.Object3D();
  spineUpper.position.y = M.y.chest - M.y.waist;
  spineLower.add(spineUpper);
  const neck = new THREE.Object3D();
  neck.position.y = M.y.neck - M.y.chest;
  spineUpper.add(neck);
  const atlas = new THREE.Object3D();
  atlas.position.y = M.y.atlas - M.y.neck;
  neck.add(atlas);

  const shoulderL = new THREE.Object3D();
  shoulderL.position.set(+M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderL);
  const shoulderR = new THREE.Object3D();
  shoulderR.position.set(-M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderR);

  // Frames that undo an owner's offset, so a garment can be authored in world
  // heights and still ride the joint it hangs from.
  const inRoot = new THREE.Object3D();
  inRoot.position.y = -M.y.hip;
  group.add(inRoot);
  const inUpper = new THREE.Object3D();
  inUpper.position.y = -M.y.chest;
  spineUpper.add(inUpper);

  // --- pelvis and belly -------------------------------------------------------
  const pelvisR = blockR(BLOCKS.pelvis, { taperDown: 0.14, taperUp: 0.16 });
  const pelvis = track(closedRadial({ uSteps: 22, vSteps: 14, R: pelvisR }));
  pelvis.translate(0, BLOCKS.pelvis.cy - M.y.hip, 0);
  assertOutward(pelvis, v3(0, BLOCKS.pelvis.cy - M.y.hip, 0), 'pelvis');
  put(group, pelvis, materials.skin, { name: 'pelvis' });

  const bellyR = blockR(BLOCKS.belly, { taperDown: 0.06, taperUp: 0.10 });
  const belly = track(closedRadial({ uSteps: 20, vSteps: 12, R: bellyR }));
  belly.translate(0, BLOCKS.belly.cy - M.y.waist, 0);
  assertOutward(belly, v3(0, BLOCKS.belly.cy - M.y.waist, 0), 'belly');
  put(spineLower, belly, materials.skin, { name: 'belly' });

  // --- the chest, and the one wound -----------------------------------------
  //
  // THE EXPOSED RIBCAGE IS GONE. It was the most expensive thing on the figure
  // and the least legible: four layers deep, a window with its quads omitted,
  // a funnel lip, an anisotropic flesh column, three rib pairs, a sternum and
  // five spine knobs, and at 105 px the whole assembly is a dim smudge on the
  // chest. Close up it was a lattice of small pale sticks, which is texture,
  // and this medium cannot do texture.
  //
  // ONE BOLD WOUND instead. A single dark hole in the chest, dark red inside,
  // with one bone splinter across it and nothing else. It is the same grommet
  // the eye sockets are, against the chest block's own radius function, so it
  // inherits the same guarantee: it cannot escape the body at any rotation and
  // it cannot drift against it. Four meshes where there were seventeen, and it
  // reads as a hole from across the room, which the cavity never did.
  const B = BLOCKS.chest;
  const chestR = blockR(B, { taperDown: 0.20, taperUp: 0.12 });
  const chestCentreLocal = v3(0, B.cy - M.y.chest, 0);

  // Off the centre line, to the figure's LEFT, and that is deliberate: a wound
  // dead centre on a symmetrical body reads as a design element rather than as
  // damage. It sits inside the coat's front opening from every angle the game
  // can show, because the opening is +/-0.80 rad and this is inside +/-0.42.
  const woundAxis = v3(Math.sin(0.20), Math.sin(-0.10), Math.cos(0.20)).normalize();
  const wound = grommet({
    R: chestR, axis: woundAxis, up: v3(0, 1, 0),
    outline: ellipseOutline(C.woundWide, C.woundTall),
    depth: C.woundDepth,
    seat: C.woundDepth * 0.20,
    // Barely a lip. The skin's own edge rolling into the hole, which is what
    // makes it a hole through something solid rather than a dark patch.
    jutMax: () => T.shellThickness * 0.22,
    rhoIn: 0.86, rhoOut: 1.44,
    phiSteps: 40, dishSteps: 6, rimSteps: 5,
    floorFlat: 0.62,
  });

  // The chest's grid, and the rim-coverage guard is what sets it. The wound is
  // 0.46 rad wide, so a 30x20 chest gives cells nearly a third of the feature
  // and the rim cannot cover the ragged cut. 44x28 brings the ragged band
  // inside the rim with room, and it is the only place on the trunk that needs
  // any density at all.
  const CHEST_U = 44, CHEST_V = 28;
  const CHEST_CELL = Math.max(2 * Math.PI / CHEST_U, Math.PI / CHEST_V);
  const chest = track(closedRadial({ uSteps: CHEST_U, vSteps: CHEST_V, R: chestR, skip: wound.cut(1.12, CHEST_CELL) }));
  chest.translate(0, chestCentreLocal.y, 0);
  assertOutward(chest, chestCentreLocal, 'chest');
  put(spineUpper, chest, materials.skin, { name: 'chest' });

  wound.dish.translate(0, chestCentreLocal.y, 0);
  wound.rim.translate(0, chestCentreLocal.y, 0);
  track(wound.dish); track(wound.rim);
  assertInsideRadial(wound.dish, chestCentreLocal, chestR, 'wound', 1e-6);
  put(spineUpper, wound.dish, materials.flesh, { name: 'wound' });
  put(spineUpper, wound.rim, materials.skin, { name: 'wound-lip' });

  // NO SPLINTER, and the wound is a plain slash.
  //
  // With the ribcage gone this is the only feature on the torso, so the eye
  // goes to it, and an irregular dark opening with something pale inside it is
  // exactly what the grin is. Two of those, one above the other, on a figure
  // whose whole identity is its face, and the chest starts competing with the
  // head. A tall narrow tear with nothing in it reads as damage and stops
  // asking to be looked at.

  // --- the shoulder yoke ------------------------------------------------------
  //
  // The head sits IN the shoulders, not on a column above them: the chin is
  // 4.4 px above the top of the shoulder mass. This is the piece that carries
  // that, and it is deliberately shallow -- anything taller becomes the neck
  // this character does not have.
  // Kept LOW on purpose. At 2.1 neck-lengths tall the yoke's crown reached
  // above the coat's collar and showed as two pale blotches on the shoulders,
  // which is the sort of thing that looks like a texture bug rather than like
  // anatomy.
  const yokeR = (d) => roundBoxR(M.arm.shoulderSeparation / 2 + M.neck.radius * 0.55, M.neck.length * 1.6, T.chestDepth * 0.46, 2.6)(d);
  const yoke = track(closedRadial({ uSteps: 18, vSteps: 10, R: yokeR }));
  yoke.translate(0, M.y.shoulderTop - M.neck.length * 1.1 - M.y.chest, 0);
  put(spineUpper, yoke, materials.skin, { name: 'yoke' });

  // The neck column. There is no neck on this character -- the chin is 4.4 px
  // above the top of the shoulder mass -- but 4.4 px of nothing is still a gap,
  // and in the first silhouette pass the head visibly FLOATED above the body.
  // This is the short plug that seats it: it rises from inside the yoke to well
  // inside the skull, so it is hidden at both ends and all it ever contributes
  // is filling that band. It hangs off `neck`, so the small follow-through the
  // animation puts there carries it.
  // TAPERED, and wide at the bottom on purpose: its lower end plugs the coat's
  // collar from inside so there is no ring to look down into, and its upper
  // end narrows to something the size of the underside of a jaw, because above
  // the collar the head's chin is a point and anything wider than that reads
  // as a green disc stuck under the skull.
  const neckTube = track(limb(
    v3(0, M.y.shoulderTop - M.neck.length * 1.9 - M.y.neck, 0),
    v3(0, M.y.chin + M.neck.length * 1.3 - M.y.neck, -M.neck.radius * 0.10),
    M.neck.radius * 1.25, M.neck.radius * 0.55,
    { radial: 14, segments: 4, waist: 0.98 }));
  put(neck, neckTube, materials.skin, { name: 'neck' });

  return {
    group,
    joints: { spineLower, spineUpper, neck },
    anchors: { atlas, shoulderL, shoulderR },
    frames: { inRoot, inUpper },
    shed,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
