# Skeleton parts contract

The skeleton is rebuilt from the ground up by four agents working in parallel,
one per region. This file is the seam between them. `CONTRACT.md` still governs
what the finished rig must expose to the rest of the game; this file governs how
the four halves fit together. Nobody edits either without saying so.

## The rules that apply to everyone

**Read `metrics.js` and use it.** Every dimension comes from `M`. If you need a
measurement that is not there, say so in your report and use a local constant in
the meantime, clearly marked. Do not quietly invent proportions: four agents each
inventing their own is exactly how a figure ends up looking like four sets of
bones in a bag.

**Read `parts/bone.js` and build from it.** `shaft`, `straightShaft`,
`jointBall`, `plate` and `drum` are the whole vocabulary. They are smoke-tested
and they carry the house look: shafts waisted to 0.62 of their end radius, joints
as rounded bulbs, nothing with a hard edge. Do not write your own tube or sphere
unless the vocabulary genuinely cannot express the shape, and say so if you do.

**The bone inventory is realistic; the bone shapes are not.** The user asked for
"the same bones as a realistic skeleton only more rounded and cute". So: the
bones a real skeleton has, in the places a real skeleton has them, in the numbers
a real skeleton has them (except the rib count, see `M.ribcage.pairs`). Then
every one of them drawn as a soft vinyl toy part. Do not drop bones to simplify,
and do not add anatomy that is not in a real skeleton.

**Joints are identity at rest.** Every joint Object3D must have zero rotation in
the rest pose, with world-aligned local axes, so an animator can write absolute
Euler targets. Bake any rest-pose flare into the bone geometry, never into a
tilt node above the joint.

**Pivots sit at the centre of their bulb**, never at the end of a bone, or the
joint visibly pulls apart the moment it rotates.

**Author facing +Z, Y up, in world units.** Do not apply `scale`; the assembler
does that.

## The four parts

Each module exports one builder. Each returns its own subtree plus the joints it
created. The assembler (`model.js`, owned by the coordinator) parents them
together and publishes the contract's flat `joints` object.

### `parts/skull.js` -- owned by the skull agent
```js
export function buildSkull({ material }) -> {
  group,               // origin at the ATLAS: the skull's occipital condyles sit
                       // at y=0 of this group, cranium above, jaw hanging below
  joints: { jaw },     // identity = closed. POSITIVE rotation.x opens it.
  dispose(),
}
```
Cranium, mandible as separate hinged geometry, both tooth rows, eye sockets,
nasal aperture, cheekbones, occipital. `M.skull` has the numbers.

### `parts/axial.js` -- owned by the axial agent
```js
export function buildAxial({ material }) -> {
  group,               // origin at M.y.hip
  joints: { spineLower, spineUpper, neck },   // chained in that order
  anchors: { atlas, shoulderL, shoulderR },   // empty Object3Ds to parent onto
  shed,                // Map<string, Object3D>, at least ribL3 and ribR4
  dispose(),
}
```
The spine curve (sacrum to atlas, with the real lumbar-forward,
thoracic-back, cervical-forward double bend), all vertebrae with spinous and
transverse processes, the sacrum and coccyx, all `M.ribcage.pairs` rib pairs
attached to their own vertebra, costal cartilage, and the sternum with manubrium
and xiphoid.

**Consecutive vertebrae must overlap, not touch**, and a bead must sit exactly on
each of `spineLower` / `spineUpper` / `neck` so that rotating one turns that bead
about its own centre and the seam cannot open. This is the single most important
thing in the whole model: the previous build was rejected for gaps in the
backbone. Verify it by rendering a bent pose from behind.

`anchors.atlas` is where the skull group parents. `anchors.shoulderL/R` are at
the glenoid, `M.arm.shoulderSeparation` apart at `M.y.shoulder`.

### `parts/arms.js` -- owned by the arms agent
```js
export function buildArm({ material, side }) -> {   // side is 'L' or 'R'
  group,               // origin AT the glenoid, parents to axial's shoulder anchor
  joints: { shoulder, elbow, wrist },
  shed,                // Map<string, Object3D> of finger bones
  dispose(),
}
```
Clavicle, scapula, humerus, radius AND ulna as two separate bones, all eight
carpals may be simplified to one rounded block, five metacarpals, and three
phalanges per finger plus two for the thumb. `M.arm` has the numbers, and
`M.arm.flare` is the A-pose angle to bake into the geometry.

### `parts/legs.js` -- owned by the legs agent
```js
export function buildLower({ material }) -> {
  group,               // origin at M.y.hip, parents to root
  joints: { hipL, hipR, kneeL, kneeR, ankleL, ankleR },
  dispose(),
}
```
Both hip bones as plates with a real obturator foramen and a genuine gap at the
pubic symphysis, femur with head-neck-greater-trochanter, patella, tibia AND
fibula as two separate bones, calcaneus and talus, five metatarsals, and toes.
`M.leg` has the numbers, including `bow`.

The sacrum belongs to `axial.js`, not here. Leave room for it between the plates.

## How everyone validates

Preview your part alone while you build it, then check it in the whole figure.
The assembler wires `?prop=skeleton`, and `?pose=crouch` bends the figure hard.

    node capture/prop-shot.mjs --prop skeleton --spins 0.785,2.356,3.927,5.498 --w 900 --h 1200
    node capture/prop-shot.mjs --prop "skeleton&pose=crouch" --spins 3.927,2.356 --w 950 --h 1000
    node capture/crop.mjs <src> <out> <x> <y> <w> <h> <outW>

**All four views, every cycle.** The previous build survived eight iterations
looking correct from the front while having no spine at all, because nobody
rendered the back. Front, side, back and three-quarter, every time, and Read
them. A part is not done until it holds from behind.
