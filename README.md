# Cloth Ghost

A little ghost that is genuinely one sheet of simulated cloth, hovering over an
isometric grey floor. Push it around and the fabric does what fabric does.

```bash
npm install
npm run dev          # http://localhost:5183
```

`W A S D` or arrows to move · `space` to hop · or press and drag to lead it
around. On touch, drag to steer and tap to hop.

## How the cloth works

The ghost is a polar grid of particles — a hemispherical head flowing into a
flared, scalloped skirt — solved with verlet integration and position-based
distance constraints. Nothing about it is rigged or keyframed.

Three things take it from "falling rag" to "fabric with something under it":

**Shape memory with a fast falloff.** Every particle is pulled toward the pose
the body dictates, hard through the head and released by the time the skirt
starts. Without it the sheet collapses; with the falloff spread too wide the
skirt snaps back before any trailing motion is visible. In an early version it
returned to rest in about 65 ms, which read as no cloth at all.

**Aerodynamic force along the surface normal**, not isotropic drag. A sheet only
feels air along its normal, and modelling it that way yields lift as well as
drag: as the skirt swings back its surfaces tilt, the normal picks up a downward
component, and the reaction billows the fabric upward. Isotropic drag can only
push it backwards and down, which reads as a wet towel.

**Outward pressure**, standing in for the air trapped under the sheet, so the
ghost stays inflated instead of flattening when dragged sideways.

The bottom edge is finished with a **rolled hem** built from the simulated edge
each frame rather than simulated itself. A cut edge has no thickness, so nothing
along it catches light and the outline reads as a flat cardboard silhouette;
rolling the last rows under gives it a rounded profile that shades like real
fabric. A hem barely affects how a sheet moves, so generating it costs the
solver nothing and it can never unroll.

## How the eyes work

The eyes are painted into the fabric's UV space inside the material's fragment
shader — they are not separate meshes. So they deform with the cloth for free,
stay glued to the sheet, and cost nothing to move.

The shape is a band of half-thickness `uOpen` wrapped around a centre line that
`uCurve` bows and `uTilt` slopes. Clipping an ellipse with straight lids leaves
hard corners the moment the eye narrows; measuring distance from a bent centre
line keeps the contour rounded at every openness. Those three numbers cover the
whole range:

| | open | tilt | curve |
|---|---|---|---|
| neutral | 1.0 | 0 | 0 |
| blink / closed | → 0 | — | — |
| determined (moving fast) | 0.84 | −0.32 | 0.08 |
| happy squint (idle) | 0.26 | 0 | 0.85 |
| startled (airborne) | 1.0 | — | — (eyes scale up evenly) |

On top of that:

- **Saccades when idle, smooth pursuit when moving.** Real eyes jump between
  fixations rather than gliding, and interpolating smoothly is what makes CG
  eyes look dead. While moving, the gaze instead tracks where the body is
  actually heading versus where it is pointing.
- **A vestibulo-ocular reflex**: whip the body round and the eyes hold their
  heading for a moment before catching up.
- **Blinks** that snap shut and open more slowly, sometimes doubled.
- **A real reflection.** The eye is shaded as a glossy bead sitting on the
  cloth: inside the mask the surface is given a dome's normal instead of the
  flat cloth's. Everything else falls out of that. The highlight sits where the
  scene's lights actually reflect, slides across the eye as the ghost turns, and
  leaves entirely when the light is behind it. The bead also reflects its
  surroundings — the pale floor below, the lighter backdrop above — with a
  Fresnel rim, so it is never a flat black hole even out of the light. There are
  no painted catchlights; an earlier version had them, and they gave the game
  away by sitting still while the ghost turned.
- **No stretching.** The head squashes with the body on a hop or a hard stop,
  and anything painted into its UV space squashes with it. The eye scale cancels
  that transform out, so the eyes hold their shape while the cloth still
  squashes.
- **Reflexes**: eyes screwed shut on landing impact, flung wide on takeoff.
- **The face rides the body's front.** Walk away from the camera and the ghost
  turns its back on you, exactly as a body facing its direction of travel
  should. Because the eyes are only a UV offset, sliding the face elsewhere on
  the sheet is a single number if you ever want it to look over its shoulder.

## Tools

```bash
npm run shot      # scripted route, stills at exact moments, cloth diagnostics
npm run eyes      # renders the expression presets side by side
npm run record    # records the scripted route to MP4
npm run standalone  # bundles everything into one self-contained HTML file
```

All of them step the simulation by hand rather than by `requestAnimationFrame`,
and the RNG is seeded in test mode, so a run is reproducible frame for frame —
otherwise every render would blink in a different place.

`npm run shot` prints `hemLag` and `hemSpread`: how far the hem is trailing the
body and how much of it has lifted. Tuning cloth by measurement rather than by
squinting at renders is what made the snap-back problem obvious — the stills all
looked plausible.

Rendering happens through headless Chromium. On a machine with a GPU this is
near real time; in a container without one, WebGL falls back to CPU rasterisation
and a frame takes a couple of seconds. The output is identical either way. Force
GPU mode with `LAB_GPU=1`.

## Layout

```
index.html            the landing page
src/ghost/
  cloth.js            verlet + PBD solver, aerodynamics, pressure
  ghost.js            rest pose, body motion, eye rig and expressions
  ground.js           isometric floor and grid
  input.js            keyboard, pointer and touch steering
  main.js             scene, camera, lighting, loop
capture/              headless harnesses
scripts/              single-file bundler
```

## Things you will probably want to tune

The feel constants live at the top of `src/ghost/ghost.js`: `maxSpeed`,
`accelTime`, `turnRate`, `hoverHeight`, and the cloth's `gravity`, `drag`,
`aero` and `windStrength` in `cloth.js`. They were set without anyone actually
playing it, so expect to want a pass once you have hands on it.
