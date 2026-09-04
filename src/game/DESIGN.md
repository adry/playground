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
- **A cell is 4.0 by 4.0**, the space enclosed by four corridor segments. That
  is one fence plot, which is what the scene already builds at 3 by 2 panels.
- Props live INSIDE cells. Corridors carry fireflies and nothing else.

This is the whole reason the layout can be checked cheaply: a corridor is
either clear or it is not, and a cell either holds a prop or it does not.

## Footprints

Every placeable prop must publish a footprint radius, measured, not guessed.
The measured ones so far, across the widest horizontal axis:

| prop | radius | notes |
|---|---|---|
| pumpkin tiny / classic / squat | 0.16 / 0.40 / 0.46 | |
| headstones | 0.31 to 0.78 | scroll is the widest at 0.73, ledger is 0.78 long |
| bench | 0.72 | wants a yaw, its back has a wrong side |
| fountain | 1.13 | plus rubble to 1.25 |
| shed | 1.93 | the largest, needs a cell to itself |
| lantern ground / post / pillar / crook / street | 0.17 / 0.45 / 0.18 / 0.16 / 0.30 | |
| grave hole | 1.0 by 0.45 | rectangular, so it needs a yaw and a box test, not a radius |
| dirt pile | 0.9 | sits beside a hole |

## Placement rules

1. **Nothing overlaps.** Two props clear if the distance between centres
   exceeds the sum of their radii plus 0.15. The hole and the ledger are boxes
   and get a box test.
2. **Nothing enters a corridor.** A prop's radius must not cross a corridor
   edge, or the skeleton's path is blocked and the level can become unwinnable.
3. **Nothing enters the gate's sweep.** `fence/gate-controller.js` already
   publishes `keepOut`, and it is a full disc rather than a half moon because
   the gate is double-acting.
4. **A grave hole needs its dirt pile**, on the long side away from the nearest
   corridor, and a headstone at its head.
5. **Tall props do not stand in front of short ones** on the camera axis. The
   camera is fixed, so "in front" is a fact you can compute: screen depth is
   x + z, and a prop 1.85 tall in front of one 0.81 tall hides it completely.
6. **A cell holds one big thing or three small ones**, never a crowd. The shed
   and the fountain take a cell each.

## Navigation

The skeletons run on a **graph of corridor centrelines**, not a navmesh. Nodes
are lattice intersections, edges are the 2.0 segments between them. That is
what Pac-Man does and it is why its ghosts read as intelligent: the decision
happens at junctions and nowhere else.

The ghost moves freely and is blocked by walls, so it can cut corners a
skeleton cannot. That asymmetry is the game.

**Every level must be checked for**: one connected component over all corridor
nodes, every firefly reachable from the ghost's spawn, and at least two
distinct routes out of every junction, or a skeleton corners the player in a
dead end and the game is unfair rather than hard.

## Interfaces

```js
// layout.js
createLayout({ seed, cells = [7, 5] }) -> {
  graph,          // { nodes: [{ id, x, z, edges }], edges: [{ a, b }] }
  props,          // [{ kind, variant, x, z, yaw, radius }]
  fireflies,      // [{ x, z }] on corridor centrelines
  spawns,         // { ghost: {x,z}, graves: [{x,z,yaw}] }
  bounds,         // { minX, maxX, minZ, maxZ }
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
