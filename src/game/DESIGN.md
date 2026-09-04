# Graveyard, the game

A Pac-Man in a cemetery. This file is the contract between the layout
generator, the game rules and the props, so that three people can build them
without agreeing on anything else.

## The mapping, and why each piece is what it is

| Pac-Man | here | why |
|---|---|---|
| the maze | fence runs, hedges, kerbed plots | the fence already exists and is 0.86 tall, low enough to see over and high enough to read as a wall |
| corridors | sand and gravel paths | a path is a corridor you can see, so the maze is legible without a HUD |
| pellets | fireflies | they can drift and glow, so a corridor reads as alive rather than dotted |
| the ghost pen | graves | skeletons climb out of the ground, which the skeleton already does, and it takes 3.4 s, which is a spawn animation for free |
| power pellet | a lit jack-o'-lantern | the scene's brightest object, and eating light to gain power is its own joke |
| Pac-Man | the cloth ghost | already the player character |

The one deliberate inversion: **the ghost is the player and the skeletons are
the monsters**, so a ghost is running from skeletons in a graveyard. Keep it.

## The floor is a lattice

Everything is laid out on a **2.0 unit lattice**, which is the fence panel's
own length, so a wall is always a whole number of panels and never needs
cutting.

- **Corridor width is 2.0.** The skeleton is 0.95 across the shoulders and the
  ghost is 1.31 across its skirt, so two of them pass with 0.3 to spare either
  side. Narrower and a chase becomes a collision; wider and the maze stops
  reading as corridors.
- **A cell is 4.0 by 4.0 of CLEAR GROUND**, which with 2.0 corridors puts
  corridor centrelines 6.0 apart. The floor is therefore a map of 2.0 tiles
  where every third row and column is corridor and the 2x2 block between them
  is a cell. This was written the other way round first, as though a cell were
  the 4.0 pitch itself, and on that reading the shed, the fountain, any grave
  with its spoil heap and rule 6's own "three small ones" all fit nowhere.
- Props live INSIDE cells. Corridors carry fireflies, the four jack-o'-lanterns
  and nothing else. The lanterns are pickups rather than props and they are
  exempt from the corridor rule on purpose: a power pellet the player cannot
  run over is not a power pellet.

**Which frame.** The level is laid out in a grid turned 45 degrees into world,
matching `main.js`'s `atScreen`, so corridors run across and up the SCREEN.
A layout on the world axes is a field of diamonds. `createLayout` takes
`frame: 'axis'` if you want the identity instead, and the difference is not
cosmetic: rule 5 is about the camera, so it has to be measured in camera axes
in either frame.

This is the whole reason the layout can be checked cheaply: a corridor is
either clear or it is not, and a cell either holds a prop or it does not.

## Footprints

Every placeable prop must publish a footprint, measured, not guessed, and
`src/game/layout/footprints.js` is where the measured ones live.
`footprints-probe.mjs` beside it regenerates them off the props themselves.

They are **boxes, not radii**, and they include the plinth, which is usually
the widest part. An early version of this table gave a headstone as "0.46" and
meant the half width of its visible body; the same stone is really a 0.54 by
0.22 box on a 0.62 by 0.35 plinth. Two more numbers here were simply wrong:
the shed's 1.93 was its debris apron rather than the building (1.04 by 0.88),
and the fountain measures 0.851 rather than 1.13.

A radius is still published for a quick reject, but the test that decides is
the box test, because circles cannot express rule 4: a circle test puts the
spoil heap 1.9 units from the hole it came out of.

## Placement rules

1. **Nothing overlaps.** Boxes clear by 0.15. Everything with a face gets the
   box test, not only the hole and the ledger.
2. **Nothing enters a corridor.** A prop's footprint must not cross a corridor
   edge, or the skeleton's path is blocked and the level can become unwinnable.
   The margin is 0.05.
3. **Nothing enters the gate's sweep.** `fence/gate-controller.js` publishes
   `sweepRadius` (1.7215), and it is a full disc rather than a half moon
   because the gate is double-acting.
4. **A grave hole needs its dirt pile**, on the long side away from the nearest
   corridor, and a headstone at its head. Space the unit on the WHOLE grave and
   not on the hole: a grave reaches further at the head than at the foot, and
   spacing on the hole put the end unit's headstone through the fence.
5. **Tall props do not stand in front of short ones** on the camera axis, and
   the camera supplies the number. `CAM_DIR (1, 0.78, 1)` sits 28.9 degrees up,
   so a prop loses 0.39 of apparent height per unit of screen depth, which is
   x + z. Measure it in the camera's own axes, depth x + z and across
   (x - z)/sqrt(2), in BOTH frames: measured in grid axes it is right in the
   screen frame by accident and broken in 83% of levels in the axis frame.
   One exception: a hole in the ground has no silhouette and cannot be hidden,
   so nothing is judged against it, including the headstone that belongs to it.
6. **A cell holds one big thing or three small ones**, never a crowd. The shed
   and the fountain take a cell each.
7. **At most four open graves.** `src/ghost/ground.js` exports
   `MAX_GROUND_HOLES = 4` and `addGroundHole` THROWS at the fifth, because each
   cut costs a distance test per ground fragment. This is an engine constraint
   rather than a taste one, and it caps the ghost pen.

## Navigation

The skeletons run on a **graph of corridor centrelines**, not a navmesh. Nodes
are lattice intersections, edges are the 2.0 segments between them. That is
what Pac-Man does and it is why its ghosts read as intelligent: the decision
happens at junctions and nowhere else.

The ghost moves freely and is blocked by walls, so it can cut corners a
skeleton cannot. That asymmetry is the game.

**Every level must be checked for**: one connected component over all corridor
nodes, every firefly reachable from the ghost's spawn, and **2-edge-connectivity**
over the junction graph. "At least two ways out of every junction" was the
first version of that last rule and it is too weak: a degree-2 corridor that is
a bridge still corners the player. 2-edge-connectivity subsumes dead ends, and
it is cheap both to enforce while closing ribs and to check afterwards.

Enforcing it DURING generation rather than proving it after is what makes the
overnight check meaningful: the maze starts fully open and closes one rib at a
time, refusing any closure that would break connectivity or bridgelessness, so
fairness is true of every intermediate state.

## Interfaces

```js
// layout.js
createLayout({ seed, cells = [7, 5], frame = 'screen' }) -> {
  graph,          // { nodes: [{ id, x, z, edges }], edges: [{ a, b }] }
  props,          // [{ kind, variant, x, z, yaw, radius, height, foot }]
  fireflies,      // [{ x, z }] on corridor centrelines
  powerups,       // [{ x, z }] the four jack-o'-lanterns, also on centrelines
  spawns,         // { ghost: {x,z}, graves: [{x,z,yaw}] }
  bounds,         // { minX, maxX, minZ, maxZ }
  // and, for a checker or a renderer that should not have to rebuild the grid:
  gate, walls, paths, corridor, grid,
}

// rules.js
createGame({ layout }) -> {
  update(dt, input) -> state,
  state: { score, lives, mode, fireflies, skeletons, powerUntil },
}
```

Both must run **headless, with no renderer**, because the overnight check is a
few thousand generated levels and a few hundred simulated minutes, and neither
can afford a canvas.

## What "cute" means here, concretely

Not a rule the generator can check, but the thing it is for. A graveyard reads
as cute when it is tidy: stones in rows facing the same way, paths that go
somewhere, a bench looking at something, lanterns spaced evenly enough to look
placed rather than dropped. Randomness should vary WHICH prop and its small
jitter, never whether the arrangement makes sense.
