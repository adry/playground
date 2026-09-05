# Chibi zombie rig contract

> **The body is being rebuilt.** Read `POSTMORTEM.md` in this folder first: it
> lists the three things that must survive the redo (this file's joint map and
> the `REST` assertion, the signed-Euler `LIMITS` correction, and the
> proportion reasoning in `metrics.js`) and records what has already been tried
> and failed. Everything else in `parts/` is up for replacement.

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

`parts/` was rebuilt from scratch in the fourth pass. `parts/skin.js` is gone
and `parts/forms.js` replaces it; `POSTMORTEM.md` is why, and the header of
`parts/forms.js` is how. The seam above did not move: the animation half took
delivery of the new body with no edits, because it measures every dimension off
the rig at construction rather than importing it.

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

**Signs.** `LIMITS` holds signed Euler targets, not magnitudes. The figure
faces +Z, so on any limb hanging downward a positive `rotation.x` swings the
lower segment BACKWARD. The two hinges therefore read opposite: `knee` is
`[0, 2.20]` (positive, heel back) and `elbow` is `[-2.30, 0.10]` (negative,
hand forward). `elbow` was published as `[0, 2.30]` in the first pass, which
is a knee; the animation half caught it by taking the fold direction off the
rig's own rest pose rather than believing the table. `hip` and `shoulder` are
negative-forward, `ankle` positive is toes down, `jaw` positive opens, and the
rest are near-symmetric.

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

## What this figure is, and what was deleted to get there

**The target is the ghost, not a reference photograph.** A white sheet with two
black eyes is the best-loved thing in this project, and it is loved because you
can read it as a shape from across the room. This medium is hand-written
procedural geometry with flat matte materials: it is superb at hard objects
made of simple forms and it cannot reproduce a sculpt. Three passes were spent
adding fine detail at a size where fine detail cannot read, and each one made
the figure muddier rather than closer.

So the zombie is **six shapes**:

1. a pale green ball head, slightly flattened at the back;
2. two big sunken dark sockets with a brow rim;
3. one wide grin with five big uneven teeth;
4. two small round ears, which exist for the silhouette and nothing else;
5. one dark coat: a closed bell from the jaw to mid-thigh, torn hem, one tear;
6. two green arms with clawed hands, two green legs, two dark boots.

Plus **one wound**: a plain dark slash behind the coat's one tear, with nothing
in it. It had a bone splinter for one round and that was a mistake worth
recording: with the ribcage gone it is the only feature on the torso, so the
eye goes to it, and an irregular dark opening with something pale inside is
exactly what the grin is. Two of those on a figure whose whole identity is its
face, and the chest starts competing with the head.

### The value ladder

**This is a rule for every character and prop in this scene, not a fact about
this coat.**

Decide what a figure's masses are, then space them evenly by RELATIVE
LUMINANCE, and check the spacing as numbers rather than by eye. This one is
three rungs against its own skin:

```
skin  1.00        #a6c47f      the head, the arms, the legs
coat  0.59        #6b7060      the body
boot  0.22        #2b2825      the feet
```

Hue does almost nothing at 105 px. What the eye resolves is a light mass, a
dark mass, and where the boundary between them is. Two failures were had here
and they are the two ends of the same mistake:

- **Too close.** The third pass had the cloth at 0.85 of the skin. The torso
  came out as one mottled area with no boundary in it anywhere, and every
  round of added detail made it muddier. That is what "muddy" meant.
- **Too far.** The fourth pass overcorrected to 0.36, which is nearly the
  boots. The result was not a dark mass but a VOID: every fold, edge and
  shaded face in the garment went to the same black, the coat lost all its own
  form, and the figure read as a head and two legs with a hole between them.

**A mass has to be dark enough to separate and light enough to still be
shaded.** Somewhere near 0.6 of its neighbour is the working range for a matte
material under this key light. Below about 0.4 it stops being a mass.

The corollary is what makes it worth writing down: **if two masses are not
separating, the answer is almost never more detail.** Detail at 105 px is
noise. Move the values apart.

### Deleted in the fourth pass, and what was lost

| gone | what it cost | what was lost |
| --- | --- | --- |
| the exposed ribcage (window, funnel, flesh column, 3 rib pairs, sternum, 5 spine knobs) | ~17 meshes | a dim smudge at game scale |
| the wound's bone splinter | 1 mesh | it made the chest a second grin |
| the nasal aperture | 8,600 triangles of face grid it forced | two pixels of grey |
| the stripped forearm (cuff, tear ring, 2 bones, flexor) | 5 volumes | a thin pale line |
| the shorts (waistband, 2 cuffs, 4 holes, wrinkles, rolled lip) | 3 meshes | nothing, the coat covers it |
| the sleeves | 2 meshes | nothing, they were inside the coat |
| the lapels and the collar roll | 3 meshes | the coat closed instead |
| the socket pits and the ear conchae | 4 meshes | a second value in a hole |
| the coat's three worn holes | | noise |
| stitched scars | already gone | |

**49,394 triangles to 29,202; 60 draw calls to 44.** Five on screen is 146,010
triangles and 220 draw calls. The saving is a symptom rather than a goal: every
one of those deletions was made because the feature could not be seen, and the
triangles went with them.

## How the body is built, in one page

Everything is a CLOSED VOLUME. There is no shared parametric shell with
features carved into it, which is what the third pass was and what
`POSTMORTEM.md` section 2 is the bill for.

`parts/forms.js` has one structural idea and the rest follows from it:

* `closedRadial` builds a volume that is **star-shaped about its own centre**.
  Its surface is `dir * R(dir)` for a smooth positive `R`. The cranium and the
  three trunk blocks are all one of these.
* `grommet` sets a feature into such a volume -- an eye socket, the nasal
  aperture, the mouth, the chest window -- by evaluating **the same `R` at the
  same direction** and offsetting along that ray. A dish is `dir * (R - sink)`
  with `sink >= 0`; a rim is `dir * (R + jut)`.

Three consequences, and they are the reason the rebuild took this shape:

1. **A feature cannot escape its host at any rotation.** Containment is a
   property of the construction, not of a viewing angle, and
   `assertInsideRadial` checks it at build time. That is the answer to the
   postmortem's failure 4, which worked square-on and broke the moment the
   walk turned the head twenty degrees.
2. **A feature cannot drift against its host.** Nothing is inverted: the
   direction is built first and `R` is evaluated on it, so there is no second
   opinion to disagree by a fraction of a millimetre. That is the answer to
   failures 2 and 3.
3. **There are no colour zones inside any one surface.** Every material
   boundary on this figure is a real geometric edge between two separate
   volumes, so nothing in postmortem section 2.2 has anywhere to occur.

The host's own hole is cut on cell boundaries and is ragged. It is never what
you see: the rim band is cut larger than the hole at both ends and covers it,
which is the chest cavity's lip-ribbon trick applied everywhere.
`grommet(...).cut(rhoCut, cellAngle)` **throws** if the rim cannot cover the
ragged band, because that failure is silent from most angles and unmistakable
from one.

### A feature smaller than its host's cells is not a small feature, it is an expensive one

The guard above is what makes this visible, so read the two together.

A feature's hole is cut on the host's grid, so the ragged edge is plus or minus
half a cell **measured in units of the feature's own size**. On a big feature
that is a few per cent and any rim covers it. On a feature the size of a cell
it is plus or minus half the feature, and no rim can cover it without reaching
so far that it collides with whatever is next to it. The only remedies are to
make the feature bigger, make the whole host's grid finer, or delete it.

**Refining the grid is almost always the wrong one**, and the nasal aperture is
the worked example. It was six degrees across against four-and-a-half degree
cells. Covering its cut needed the face grid to go from 84x56 to 116x78:

```
8,600 triangles       a fifth of the entire figure
                      spent so that a rim could cover one hole
for two pixels of grey between the sockets and the grin at game scale
```

It was deleted and **the head reads harder without it**, because two sockets
and a grin no longer have a third small dark mark competing with them. The grid
came back down with it.

So when the guard throws, the first question is not "how much finer does the
grid need to be" but **"what is this feature worth, and can I see it at 105
px?"** If the honest answer is no, delete it: the triangles it was costing were
never buying the feature, they were buying its edge.

Two more things that throw rather than being trusted, both for the reason
recorded in postmortem 2.2: `assertOutward` on every closed volume (the winding
trap of 2.3), and the `REST`/`LEFT_X` loop in `model.js` that was already there.

`model.js` finishes with `mergeWithinNodes`, which collapses the meshes under
each joint to one per material and never merges across a joint. 104 meshes to
60, losslessly, and the triangle count is asserted unchanged.

## The arm rule, because it is the one that is easy to get wrong

**An arm reads when its OUTER edge stands against the background.** What is
behind the inner edge, cloth or body, does not matter.

The fourth pass first required DAYLIGHT on both sides of each arm, measured
that no jacket hem anywhere can satisfy it, and took the jacket off the figure
to get it. Both halves of that were true and the conclusion was wrong: the
reference's arms overlap its own jacket freely and are perfectly legible, and a
zombie in a torn coat with slightly crowded armpits is far closer to the
reference than a green figure in a scrap.

So the test is the outer contour, at the front camera and at both three-quarter
ones. Below the deltoid every arm currently stands 4 to 9 px clear of the
jacket's outline; the only negative readings are at the shoulder cap, where the
sleeve and the jacket body are the same garment and an arm is supposed to
merge.

`REST` still fixes the shoulder, the elbow and the wrist, so the trunk is what
moved to make room, and `M.arm.outboard` and `M.arm.handSplay` are the two
small levers that live in geometry rather than in a joint.

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
    node src/ghost/props/zombie/shot.mjs --mode sil --spins 0,0.785   # THE FIRST TEST

`--mode sil` is flat black on white and it is the test that comes FIRST, before
a minute is spent on surface detail. All three faults that killed the third
pass were silhouette faults and none of them is expensive to fix; see
`POSTMORTEM.md` 2.5.

Two tuning views, neither of which anything is judged on:

    --bare 1              hide the clothes, to see the ribcage and the body's forms
    --focus head|face|chest|hips --view 0.3    frame one region close

`?mode=face` is a flat orthographic elevation and is for tuning only. Nothing
is judged on it: the scene camera and a crop at game scale are what decide.
Front, three-quarter, side and back, every cycle. The skeleton survived eight
iterations looking right from the front while having no spine at all.
