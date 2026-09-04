# Skeleton rig contract

Three agents build this character in parallel, so the seam between them is
fixed here first. Nobody changes this file without saying so: it is the only
thing keeping the three halves compilable against each other.

Reference photo: `.ref/ref-skeleton.jpg`. The house style is the same soft
vinyl toy as the pumpkin, the tombstones and the ghost. Every joint in the
reference is a visible rounded bulb, and that is the strongest style cue in
the whole model.

## Units and orientation

Same world as the rest of the scene. The ghost stands about 1.6 units tall
with its hem near y = 0.2. In the reference the skeleton is roughly twice the
ghost's height, so the rig is authored at a **total standing height of 2.5**
with the soles of the feet at **y = 0**. `scale` multiplies that.

Rest pose faces **local +Z**, standing, arms hanging with a slight outward
flare, exactly the reference's A-pose. Local +Y is up.

## `model.js` -- owned by the model agent

```js
export function createSkeletonRig({ scale = 1 } = {}) -> {
  group,        // THREE.Group, feet at y = 0, faces +Z
  joints,       // see below, every value is a THREE.Object3D already parented
  shed,         // Map<string, THREE.Object3D> bones safe to detach mid-animation
  dispose(),    // frees every geometry, material and texture it made
}
```

`joints` must contain at least these names, each an `Object3D` whose
**rotation is identity in the rest pose**, so an animator can write absolute
Euler targets without first reading the bind pose:

```
root          hips, the whole body hangs off this
spineLower    waist bend
spineUpper    chest bend
neck
head
jaw           hinges open around local +X, closed at identity
shoulderL/R   arm root at the collarbone
elbowL/R
wristL/R
hipL/R
kneeL/R
ankleL/R
```

Each joint's pivot must sit at the anatomical centre of its bulb, not at the
end of the bone, or every rotation will visibly pop the joint apart.

The jaw's sign is worth stating twice, because this file originally had it
backwards. The rest pose faces +Z, so the chin sits below and in FRONT of the
hinge, and the rotation that drops it is **positive** `rotation.x`. Negative
drives the chin up through the skull. The model also publishes this as
`joints.jaw.userData.openAxis` and `openSign`, so an animator can assert it
rather than trust this paragraph.

The model also hangs a ground-contact patch off `group.userData.contactShadow`.
It is not part of the returned object, so the contract shape is unchanged, but
choreography has to hide it while the skeleton is still underground.

`shed` maps a name to a detachable `Object3D`, for bones that shake loose and
drop. At minimum: `ribL3`, `ribR4`, `fingerL2`, `fingerR3`. Each must be a
self-contained mesh whose world transform is meaningful when reparented to the
scene, and removing it must leave no hole that reads as a bug.

## `motion.js` -- owned by the motion agent

Model-independent. No import from `model.js`.

```js
export class Spring {              // critically-dampable second order spring
  constructor({ stiffness, damping, value = 0 })
  set target(v)
  step(dt) -> number               // current value
}
export function easeOutBack(t), easeInOutCubic(t), easeOutElastic(t)  // 0..1 -> 0..1
export function createDebris({ scene, gravity = -9.8, bounce = 0.35 }) -> {
  spawn(object3D, { velocity, spin }),  // takes ownership, reparents to scene
  update(dt),
  clear(),
}
```

`createDebris` runs real ballistic arcs with one bounce and a settle. It must
handle an object that is mid-flight when the scene disposes.

## `skeleton.js` -- owned by the choreography agent

```js
export function createSkeleton({ scale = 1, seed = 1 } = {}) -> {
  group,
  update(time, dt, ghostPos),   // ghostPos is a THREE.Vector3, may be undefined
  state,                        // 'buried' | 'emerging' | 'rising' | 'chasing' | 'settling'
  dispose(),
}
```

Same `update(time, dt)` shape the other props use, plus the ghost's position.
`main.js` calls props as `prop.update?.(sceneTime, dt)`, so the third argument
is supplied by a small wrapper at the call site, not by changing every prop.

## What "polished" means here

The ghost's motion is good because it is simulated rather than keyframed:
Verlet cloth, aerodynamic lift along the surface normal, shape memory, a real
rolled hem. Match that instinct. Secondary motion must FOLLOW from primary
motion, not be drawn on top of it. A jaw on a spring that clacks because the
skull just stopped moving reads as alive. A jaw on a sine wave does not.
