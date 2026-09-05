# Chibi zombie: what to keep, and what already failed

Written at the end of the third pass on the body, when the owner called for a
redo. The geometry in `parts/` is not worth defending. The findings below are,
because a fresh build walks into every one of them, and most of them cost a
render cycle each to find.

Read the first section before deleting anything and the second before writing
anything.

---

## 1. THREE THINGS THAT MUST SURVIVE THE REDO

### 1.1 `metrics.js`'s joint table and the `REST` assertion

**Do not change the joint map.** The animation half is finished and works. It
was built against a stub, took delivery of `model.js`, and needed no edits,
because it measures every dimension off the rig at construction rather than
importing it. A redo that renames a joint, moves one, or changes the rest pose
breaks a working performance for no reason.

What is fixed:

```
root  spineLower  spineUpper  neck  head  jaw
shoulderL/R  elbowL/R  wristL/R
hipL/R  kneeL/R  ankleL/R
```

These are **exactly the skeleton's names, in the skeleton's order**, which is
what lets one performance drive either figure and what let the animation half
reuse `../skeleton/motion.js` instead of writing a second copy. Every joint is
**identity in the rest pose** with world-aligned local axes, so absolute Euler
targets can be written without first reading the bind pose. Rest-pose flare is
baked into geometry, never into a tilt node above a joint. `jaw` is closed at
identity and opens on **positive** `rotation.x`, published on the node as
`userData.openAxis` / `openSign`.

**`LEFT IS +X.**` The figure faces +Z with +Y up, so left is up cross forward.
Every `L` node is at positive x.

`REST` publishes every joint's rest-pose world position, and `model.js` checks
the built scene graph against it to 1 mm and throws on a mismatch, along with
the LEFT_X sign check. **Keep that assertion.** It is the only reason the two
halves could be built in parallel without drifting, and it is cheap. If the
redo changes a proportion, change `REST` deliberately and let the assertion
catch everything that did not follow.

`shed` publishes `ribL3`, `ribR4`, `fingerL4`, `fingerR3`, again by the
skeleton's names.

### 1.2 The signed-Euler `LIMITS` correction

`LIMITS` holds **signed Euler targets, not magnitudes**, and the table says so
now because the first version did not and was wrong.

The figure faces +Z, so on any limb hanging downward a positive `rotation.x`
swings the lower segment BACKWARD. The two hinges therefore read opposite:

```
knee    [0, 2.20]       positive: the heel comes back. A knee folds back.
elbow   [-2.30, 0.10]   negative: the hand comes forward. An elbow folds forward.
```

`elbow` shipped as `[0, 2.30]` in the first pass, which is a knee. The
animation half caught it only because they took the fold direction off the
rig's own rest pose instead of believing the table. Nothing shipped broken and
the table was still lying.

The rest, checked at the same time and correct as published: `hip` and
`shoulder` are negative-forward, which is why their forward range is the larger
one; `ankle` positive is toes down; `jaw` positive opens; `wrist`, `neck`,
`head` and the two spine joints are near-symmetric and carry no sign trap.

### 1.3 The proportion reasoning

**1.80 standing height, crown to sole, feet at y = 0.** Three arguments, all of
which still hold:

- **The family.** The ghost is 1.72 and the skeleton 2.5. The skeleton is
  deliberately looming. The zombie is the shambler and has to read as a peer of
  the ghost, something that can plausibly chase it rather than step over it.
  Under about 1.6 it reads as a child and stops being a threat; over 2.0 it
  stops being chibi, because a chibi silhouette is squat by definition.
- **Pixels.** The game camera is orthographic with a half-height of 6.2, so a
  720-tall frame maps one world unit to 58 px. 1.80 is 105 px, which is the
  "roughly a hundred pixels tall" the whole legibility budget is sized against.
- **Head count.** At head = 0.330 of height the figure is 3.03 heads tall, the
  classic chibi ratio. A realistic figure is seven and a half; the skeleton is
  six.

Every landmark in `M.y` carries its reasoning beside it and the derivations
between them are consistent: bone lengths follow from the drops between
landmarks plus whatever bow the limb carries, never the other way round.

Two structural consequences are worth restating because they constrain any
redo:

- **There is no neck.** The chin is 4.4 px above the top of the shoulder mass.
  The head sits IN the shoulders, not on a column above them. `neck` therefore
  has almost no travel and the shoulders had to move outward to make room, so
  the head is wider than the shoulders. An arm swing that is fine on the
  skeleton clips the jaw here.
- **`M.y.cavityBottom` is not free.** The belly block's top has to sit below it
  or the belly pokes up inside the chest cavity. That constraint sets
  cavityBottom, not the other way round.

---

## 2. WHAT ALREADY FAILED

### 2.1 The eye socket dark: five constructions, four failures

The problem: make an eye socket read as an empty dark hollow, with no alpha
available, on a head that is 34 px tall in a shipped frame.

**1. A dark BALL seated in the dent.** An ellipsoid falls away from its own
pole faster than a face does, so it is flush only at the very middle and the
rest of the socket stays skin-coloured. Looked like two coffee beans.

**2. A dark PATCH resampled off the built surface**, pushed slightly proud of
the dent floor. Correct in principle, fails on noise. The patch reaches the
surface through an inverse of the BASE ELLIPSOID, while the shell it has to sit
in has a brow shelf, a cheek pad, a crown swell, an orbital rim and three
octaves of lumpiness on top of that. The two disagree by a fraction of a
millimetre, and on a wall as steep as a socket's that is a large fraction of
the depth, so the patch comes through the skin in slivers all round the rim.

**3. A CUP following the dent's own depth profile** with a constant clearance.
The same failure one term further down. Each fix removed one source of drift
and revealed the next: the patch's own polar parameter, then the local normal,
then the lumps. Chasing that term by term is a losing game.

**4. A real HOLE in the shell with a rim ribbon over the cut and a dark bowl
behind it.** This is how the chest cavity is built and it works there. On a
socket it does not, for two reasons the chest does not have:

- The recess was applied along the LOCAL SURFACE NORMAL, which at an orbit is
  raked about 25 degrees off the view. A recess as deep as the socket is wide
  therefore does not push the surface straight back: it slides sideways as it
  goes in, by nearly half a socket radius at the middle and by nothing at the
  rim. **The dent folds over itself.** Every downstream symptom was blamed on
  something else for four rounds. A cut boundary then lands somewhere other
  than where it was measured, and the surviving shell drifts over the hole.
- The bowl behind is a solid whose silhouette has to stay hidden inside a
  curving head from every angle. It does not, once the walk turns the head
  twenty degrees, which it does every cycle. Square on it was fine; in motion
  it came through as a ring of dark spikes.

**5. PAINTING the dark on one continuous surface.** The sockets, the nasal
aperture and the mouth drawn from the same surface as the face, over the same
grid, in three passes that keep different quads. No cut, no hole, nothing
behind anything: the dark is the recess itself. This removes every failure mode
above at once, because there are no longer two surfaces that can disagree.

What it costs is that the boundary between colours is a staircase at grid
resolution, and section 2.2 is what that took.

**If the redo keeps one thing from `parts/head.js`, keep this: do not put a
second surface inside a recess on a curved head. Colour the recess.**

### 2.2 Three things the dense face patch uncovered

The patch itself (a coarse grid over the head with the face rectangle omitted,
and a patch over that rectangle at three times the density, seamed by CELL
INDEX rather than parameter value so both sides quote the same boundary) was
the right lever. It did not fix the edge on its own. It made the remaining
artifact small enough to reason about, and three separate causes came out:

**1. A fix that had silently not applied.** The fixed-axis recess was written
and reported at the end of the previous round, and the edit had not matched the
file. The recess was still normal-aligned and the surface was still folding.
This is the sobering one: a reported fix is not a landed fix. Grep for the
symbol afterwards, or assert it.

**2. The zone test has to run on the surface with the lumpiness OFF.** The
lumps are 0.04 of a socket radius and a grid cell at the boundary is 0.037 of
one. Measured on the lumpy surface the test flips from cell to cell and the
edge is a comb no matter how fine the grid gets. Anything deciding WHICH SIDE
OF AN OUTLINE a point is on measures against the smooth surface.

**3. The zones need ONE SHARED VERTEX BUFFER.** Built as independent meshes,
each runs `computeVertexNormals` over its own faces only, so the two sides
disagree about the normal along the boundary and every step of the staircase
gets a bright or dark fleck. A one-cell edge that would read as a clean step
reads instead as digital corruption. `gridSurfaceSplit` in `parts/skin.js`
computes positions and normals once from the complete grid and gives each zone
its own index buffer over them; shading is then continuous across the boundary
and only the colour changes. **That function is worth keeping.**

And one placement rule that did as much as all three: **put the colour boundary
down the dent wall, not on the crease at the top of it.** At r = 1.00 it lands
where the shading changes fastest and a one-cell step is at its most visible.
At r = 0.94 it sits on a surface already turned away from the key light and the
step disappears into the shadow it is standing in.

A note on what did NOT work, because it is tempting: **wobbling the outline to
disguise the staircase.** It does not disguise it. At close range an irregular
outline and a staircase together read as digital corruption, worse than either
alone. Solve the edge or accept it; do not decorate it.

### 2.3 The inside-out winding trap

Every parametric surface in this vocabulary is authored as `(cos a, y, sin a)`
with `a = 2 pi u`, so `d(u) cross d(v)` points INTO the solid. Wound the naive
way, **every shape on the model is inside out**, and the renders do not
obviously say so: three culls the true outside, you see the far wall lit by its
own flipped normal, and a ball still looks like a ball.

It only shows the moment you cut a hole in something, at which point you look
through the hole and see the inside of the back of the object instead of what
you put behind it. That is how it was found, on the mouth, after most of the
body had been built and judged.

`gridSurface`, `shell2`, `ribbon` and `limb` in `parts/skin.js` all carry the
corrected winding and a note. **If the redo writes its own vocabulary, cut a
hole in a test sphere on day one.**

### 2.4 Oversizing for legibility overshoots

The skeleton's skull went round this loop three times and the lesson was
recorded as "make the feature bigger than the reference and judge it on a crop
of a real scene render". That is right and it is incomplete.

This character's sockets were sized at 28 per cent of head height on that
argument. They passed the game-scale test perfectly, and at arm's length the
pair plus their rims covered nearly the whole upper face: the head read as
mostly hole, and the character read as a corrupted skull rather than a
cute-and-gruesome toy. The reference measures about 29 per cent of head WIDTH
and 20 to 22 per cent of head HEIGHT.

**The test is both: "can I see it at 105 px" AND "is this still a face at arm's
length".** The owner looks at both.

The governing rule, once it was named, was more useful than any measurement:
**the amount of smooth green face left is what carries the charm.** The
reference has a broad clear forehead above the sockets, a clear bridge between
them and clear cheek below, and all three have to survive whatever the features
are doing. The same logic applies anywhere else a feature is being oversized.

### 2.5 The silhouette is the test that should come first

The last note from the coordinator, and it should have been the first check on
day one rather than after three passes of surface work:

**Render the figure as a flat black shape against white, front and three
quarter, and compare it to the reference read the same way.** `?mode=sil` in
`lab.js` does this. If the black shape is a ball on a barrel with no arms,
nothing on the surface will save it.

The three faults that test would have caught immediately, none of which any
amount of face work addresses:

- The head is a teardrop narrowing to a soft point at the crown. The reference
  is close to a sphere, slightly flattened at the back, full and round over the
  top. That roundness is most of the "cute" in a chibi and it is the first
  thing the eye reads at any distance.
- The arms disappear into the body. Shoulder to hip is one continuous mass with
  only fingers emerging near the hem, so the distinctive stripped forearm
  cannot be seen at all. A figure with no visible arms reads as a bollard, and
  at game scale that matters more than the face does.
- The mouth sits at the bottom edge of the head with the teeth hanging below
  the jawline like a fringe. The reference has a clear band of green BELOW the
  teeth. A chin pad and a muzzle were added and did not buy enough; the real
  problem is that the tooth row is wider than the jaw is at that height, so the
  teeth break the silhouette.

### 2.6 Smaller things worth not rediscovering

- **The chest cavity construction works and is the one piece of modelling here
  worth lifting wholesale.** Four layers: a skin shell with the window quads
  genuinely omitted; a lip ribbon swept along the window's TRUE analytic
  outline and cut larger than the hole, because a quad grid can only cut on its
  own cell boundaries and the ribbon is what covers that staircase; a closed
  dark flesh column; and ribs and a spine standing between the two. The flesh
  column must be ANISOTROPIC (wide enough to close the window, shallow enough
  to leave the ribs a gap to stand in). One scale either fails to cover the
  window's edges or comes forward and kills the depth.
- **Three rib pairs, not a cage.** The window is 12 px tall in a shipped frame.
  Four ribs is a 3 px pitch and combs into a grey bar.
- **A rib arc's ends must stop short of the shell**, around 0.86 of it. At 1.0
  the tube's centre line lies on the skin and half of every rib sits outside
  the body.
- **Cloth needs two sheets and a rim on every cut edge.** A single sheet is
  invisible edge-on and its torn hem has no thickness. `shell2` does this and
  rims the edges of holes for free.
- **A jacket needs a V opening and lapels** or it reads as a collar and a belt
  with nothing between them. Opened too far (0.98 rad) it stops being a jacket
  at all, because from the game's three-quarter camera the whole front is bare
  chest and the remaining cloth hides behind the arms.
- **Garments hang from the right joint.** Shorts cuffs on the hips stay put
  while the thigh swings through them. Cuffs go on `hipL`/`hipR`, the jacket
  hangs from `spineUpper`, the sleeve is two pieces so the elbow bends through
  the second rather than dragging it.
- **The trunk must be overlapping closed blocks, one per spine segment**, or a
  single mesh tears the moment `spineLower` moves. This is the skeleton's
  "consecutive vertebrae overlap, not touch" rule applied to a soft body.
- **No contact-shadow decals.** Fourth prop in this scene to go without one.
  The empty `group.userData.contactShadow` array stays published because the
  skeleton's choreography reads it.
- **Triangles were never the constraint.** The body sat between 42k and 74k
  against a budget of "well under 100k each", and every increase bought
  resolution on the head, which is the only place it was ever needed.

---

## 3. If the redo starts from scratch

Order the work by what the silhouette test can see:

1. Block the figure out as solid masses and judge it in `?mode=sil` against the
   reference, front and three quarter, before any surface detail exists.
2. Keep `metrics.js`'s landmarks, joint map, `REST` and `LIMITS`, and keep
   `model.js`'s assertion loop, whatever else changes.
3. Build the chest cavity next, because it is the one feature whose
   construction is settled.
4. Do the face last, colour the recesses rather than filling them, and check it
   at close range, at 105 px, and on a walk frame with the head rolled and
   lagging. It has to survive all three.

Renders from the third pass are in `out/zombie/`, and `shot.mjs` in this folder
drives them on the real scene's floor, lights and camera.
