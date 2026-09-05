# Chibi zombie rig contract

Two agents build this character in parallel, one the body and one the
animation, so the seam between them is fixed here. Nobody changes this file
or `metrics.js` without saying so: they are the only things keeping the two
halves compilable against each other. This is the same discipline that kept
the skeleton one figure rather than four; see `../skeleton/CONTRACT.md` and
`../skeleton/PARTS.md`, which govern that character and are worth reading
first.

## Units and orientation

Same world as the rest of the scene. The ghost is 1.72 tall and the skeleton
2.5; this figure is authored at a total standing height of **1.80**, soles at
**y = 0**, and the reasoning is written out at the top of `metrics.js`.
`scale` multiplies it.

Rest pose faces **local +Z**, standing, arms hanging with a slight outward
flare. Local +Y is up.

**LEFT IS +X.** Left is up cross forward, and Y cross Z is X. Every `L` node
is at positive x. `model.js` asserts it at build time rather than trusting
this paragraph, because the failure is invisible at rest and comes out as a
cross-limbed walk.

## Who owns what

| owner | files |
| --- | --- |
| body | `metrics.js`, `model.js`, `parts/*`, `lab.html`, `lab.js`, `shot.mjs` |
| animation | everything else in this directory |

Nothing outside `src/ghost/props/zombie/` belongs to either of us.

## `metrics.js` -- owned by the body agent

Every proportion in the figure, as fractions of standing height, with the
reasoning for each written down beside it. It also publishes four things the
animation half is expected to build against rather than measure:

```js
export const HEIGHT            // 1.80
export const LEFT_X            // +1
export const JOINTS            // the joint names, in order
export const REST              // every joint's rest-pose world position
export const LIMITS            // how far each joint can be driven before the
                               // geometry self-intersects visibly
export const GAIT              // legLength, groundClear, stride, shamble
export const LEGIBILITY        // px-per-unit at 720p, and the rule that
                               // overrides the reference when they conflict
```

`REST` is not documentation: `model.js` checks the built scene graph against
it to 1 mm and throws if they disagree, so the two can never drift.

## `model.js` -- owned by the body agent

```js
export function createZombieRig({ scale = 1 } = {}) -> {
  group,        // THREE.Group, feet at y = 0, faces +Z
  joints,       // see below, every value an Object3D already parented
  shed,         // Map<string, Object3D> of pieces safe to detach mid-animation
  update(),     // no-op; the body has no motion of its own
  dispose(),    // frees every geometry and material it made
}
```

`group.userData.triangles` is the measured triangle count and
`group.userData.contactShadow` is an empty array, published because the
skeleton's choreography reads it and treats "no patches" as nothing to do.

### The joint map

**Exactly the skeleton's names, in the skeleton's order.** That is the whole
point of it: it lets the animation half reuse the skeleton's machinery instead
of writing a second copy, and it is what will let a zombie and a skeleton share
one performance later.

```
root          hips, the whole body hangs off this
spineLower    waist bend
spineUpper    chest bend
neck          almost no travel; see the note under M.neck
head
jaw           identity CLOSED, POSITIVE rotation.x opens it
shoulderL/R   arm root at the glenoid
elbowL/R
wristL/R
hipL/R
kneeL/R
ankleL/R
```

Every one is **identity in the rest pose** with world-aligned local axes, so
absolute Euler targets can be written without first reading the bind pose. The
rest-pose arm flare is baked into geometry, never into a tilt node above a
joint.

The jaw's sign is also published on the node, so it can be asserted rather than
trusted:

```js
joints.jaw.userData.openAxis === 'x'
joints.jaw.userData.openSign === 1
```

### `shed`

Detachable pieces, by the same names the skeleton publishes, so one shed plan
can drive either figure: `ribL3`, `ribR4`, `fingerL4`, `fingerR3`. Each is a
self-contained subtree whose world transform is meaningful when reparented, and
removing it leaves no hole that reads as a bug. A rib that leaves the chest
cavity exposes the flesh column behind it, which is already what the gap
between two ribs shows.

The skeleton's `perform.js` shed plan also names `ribL6` and `ribR7`. This
figure has three rib pairs, not eight, so those two are absent and
`shed.get()` returns undefined for them.

## Three things about this body that a walk cycle has to know

1. **There is no neck.** The chin is 4.4 px above the top of the shoulder mass.
   Past about 0.30 rad the skull drives through the deltoid. Use `head` for the
   range and `neck` for follow-through only. `LIMITS` has the numbers.
2. **The head is wider than the shoulders.** A shoulder swing that is fine on
   the skeleton clips the jaw here.
3. **The arms are short.** Hanging straight, the fingertips reach the upper
   thigh, not mid-thigh. A full forward reach brings the hands to the chin.

## How the body half validates

Renders on the real scene's floor, lights and camera, from the character's own
folder so that building it touches nothing outside:

    node src/ghost/props/zombie/shot.mjs --mode solo --spins 0.785,0,2.356,3.927
    node src/ghost/props/zombie/shot.mjs --mode game            # true game scale
    node src/ghost/props/zombie/shot.mjs --mode family          # beside the others
    node src/ghost/props/zombie/shot.mjs --mode solo --pose walk
    node src/ghost/props/zombie/shot.mjs --mode solo --pose crouch
    node src/ghost/props/zombie/shot.mjs --mode face            # flat elevation

`?mode=face` is a flat orthographic elevation and is for tuning only. Nothing
is judged on it: the scene camera and a crop at game scale are what decide.
Front, three-quarter, side and back, every cycle. The skeleton survived eight
iterations looking right from the front while having no spine at all.
