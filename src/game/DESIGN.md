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
| the ghost pen | **every headstone**, chosen at random | skeletons climb out of the ground, which the skeleton already does, and it takes 3.4 s, which is a spawn animation for free. It used to be four hand-placed graves; see "The pen is the yard" below |
| power pellet | **nothing** | it was a lit jack-o'-lantern and the owner has taken it out. See rules.js for what the game loses |
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
- Props live INSIDE cells. Corridors carry fireflies and nothing else. They
  used to carry the four jack-o'-lanterns too, exempt from the corridor rule on
  purpose because a power pellet the player cannot run over is not a power
  pellet. There is no power pellet, so there is no exemption.

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

The planting publishes one row per variant rather than one for the prop,
because the bush is four shapes now and their heights differ by two thirds:
`ball` 0.476 radius and 0.775 tall, `cone` 0.405 and 1.271, `box` 0.459 by
0.445 and 0.830, `wild` 0.576 and 0.760. Rule 5 is written against height, so
a single row would have to publish the cone's for all four and would then
refuse the ball a spot it fits in perfectly well. The generator places the
ball; the other three are the editor's to place.

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
   rather than a taste one.

   It used to cap the ghost pen, because the pen WAS the graves. It no longer
   caps anything about the herd: a dug grave is a hole, a spoil heap and a
   marker, and it is decoration. What the skeletons come out of is rule 8.

8. **Every headstone with a face publishes a KEEP-CLEAR ZONE**, a 2.14 by 2.65
   rectangle off its face, and it is the first directional footprint in the
   project. `src/game/world/spawn.js` owns it and carries the measurement:
   the climb in `props/skeleton/perform.js` reaches 1.247 ahead of the figure,
   1.097 behind it and 0.915 either side, all measured above the floor over six
   seeds, and each of those gets the same 0.15 margin rule 1 keeps between two
   props. A rectangle rather than a half-disc because the region is not disc
   shaped -- the climb reaches behind the point the body comes up at -- and
   because a box with a yaw is a shape every test in this project already takes.

   A stone is a MARKER when it is not one of the four things in the registry
   that are not headstones (bench, ledger, chest, kerb) and when it is at least
   1.5 times as wide as it is deep, which is a measured fact about its
   footprint and takes out the round, square and four-sided ones. Fourteen of
   the twenty-nine variants qualify.

   A marker whose zone holds something solid, or is crossed by a fence, or
   hangs over the wall, or sits in a gate's sweep, is DEMOTED to an ordinary
   headstone. It is not an error: two stones 2.2 apart in a row cannot both be
   spawn points however they are turned, and a row of stones facing the same way
   is what this document calls cute. What IS an error is a yard with fewer than
   `SPAWN_FLOOR` markers left, which is audit.js's `spawn` rule.

## The pen is the yard

Pac-Man's ghosts leave from a box in the middle of the board, and the reason
that works is that the player always knows where danger comes from. This game
had the same thing, four graves placed by hand with a personality each and an
order. It does not any more: a skeleton going underground comes back up in front
of a headstone chosen at random from the ones in a band 10 to 20 units around
the player, weighted toward the middle of that band, with a 12 s cooldown on a
stone something has just come out of.

**Random rather than best.** The old pick scored every grave and took the
nearest the middle of the band. With four graves that was almost forced, since
the band usually held one or two. With twenty markers a deterministic best
always picks the same stone, the player learns it, and the yard is a pen again.

**The band is the fairness property**, not the count. Ten units is the whole of
what stands between the player and a skeleton surfacing at their shoulder, and
neither edge of the band is preferred: near is cruel and far is a herd that
never arrives.

**Measured, it is not the crueller game it sounds like.** Sixty generated arenas,
the same seeds and the same bot, the only difference being which stones the
spawn list holds:

| | four graves | every marker |
|---|---|---|
| deaths a run, careful bot | 0.25 | 0.13 |
| deaths a run, reckless bot | 1.25 | 1.15 |
| deaths a run, a player who never moves | 2.83 | 2.77 |
| median first death, careful bot | 35.5 s | 17.1 s |
| surfaced at, mean | 12.1 | 12.0 |
| bearing concentration, passive | 0.26 | 0.55 |

Two surprises in that table and both are worth keeping. The first is that it is
very slightly KINDER: four graves often left nothing in the band at all and the
old pick then took the nearest thing outside it, which was frequently nearer
than ten. The second is the last row: **danger became more concentrated, not
less.** The generator's four graves are one per quadrant by construction, so
they surround the player; headstones cluster in plots, so in a generated arena
the herd tends to come from the side of the yard the stones are on. In a
hand-made level that is the author's decision, and it is a real one.

What did get harder is the first surprise: the careful bot's median first death
halves, from 35.5 s to 17.1 s.

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
// world/index.js, and level/format.js answers every one of these identically
createWorld({ seed, size = 30 }) -> {
  bounds,             // { minX, maxX, minZ, maxZ }. The arena.
  spawn,              // { x, z }. Where the GHOST starts.
  barriers(box), gates(box), props(box), paths(box),
  fireflies(box),     // [{ id, x, z }]
  spawns(box),        // [{ id, x, z, yaw, stone, variant, zone }] every
                      // headstone a skeleton may climb out in front of. `yaw`
                      // is the marker's own facing, so the figure comes up with
                      // its back to the stone. `zone` is the keep-clear
                      // rectangle rule 8 is about.
}

// rules.js
createGame({ world }) -> {
  update(dt, input) -> state,
  state: { score, lives, mode, fireflies, skeletons },
}
```

The old maze package, `layout.js`'s `createLayout`, is superseded by `world/`
and is kept only for `world-check.mjs`'s fence-density comparison. It still
publishes `powerups` and a four-grave `spawns`, which is what a level looked
like before this document was last edited, and neither is wired to anything.

Both must run **headless, with no renderer**, because the overnight check is a
few thousand generated levels and a few hundred simulated minutes, and neither
can afford a canvas.

## What "cute" means here, concretely

Not a rule the generator can check, but the thing it is for. A graveyard reads
as cute when it is tidy: stones in rows facing the same way, paths that go
somewhere, a bench looking at something, lanterns spaced evenly enough to look
placed rather than dropped. Rule 8 puts a price on one of those: a row of
stones facing the same way is still exactly right, and only the stone at the
end of the row is somewhere a skeleton can come out of. Randomness should vary WHICH prop and its small
jitter, never whether the arrangement makes sense.


## Two decisions recorded, so they are not re-litigated

**The arena is WORLD-ALIGNED and is not rotated onto the screen axes.** Measured,
a screen-aligned arena hides 12.1% of its ground behind the near wall against a
world-aligned one's 16.4%, so the gain is 4.3 percentage points and not the
"a quarter less" ratio it is easy to quote. Against that: the owner sized the
arena as 6 by 6 of the floor grid's major squares, and that grid is world
aligned in `src/ghost/ground.js`, so rotating divorces the arena from the thing
it was measured with. `world.bounds` would also stop being the arena and become
merely its enclosing box, and the level editor is written against that field.
This is a "not now" rather than a "no": `world.wall` already expresses four
diagonal barriers correctly, so the renderer side is cheap whenever it is worth
the 4.3 points.

**A fairness check must be flat across its raster before its number means
anything.** This was learned three times in one night, by three different pieces
of code, and each time the symptom was a number that looked authoritative:

- the F3 check let the ghost's vault reach scale with the cell size, so a coarse
  raster invented failures. It read 24.0, 23.3, 21.3, 12.0 and 3.3 percent at
  steps 0.6 down to 0.25: falling the whole way, so measuring itself.
- the same check called a cell blocked when its CENTRE was blocked, so a real
  two unit gap between two headstones was invisible to the flood.
- the generator's repair pass then made that second mistake again, one level
  down, in the code written to catch it: it asked whether a body fits at a
  cell's centre, and a wedge 1.26 across can hold a body and contain no cell
  centre of a quarter-unit lattice. It reported a clean sheet over two arenas
  that each had a place the player could stand and be safe for ever.

The shape of the answer is **generous then exact**: flag on a mask that cannot
miss (ask whether a body fits ANYWHERE in the cell, by shrinking the radius by
the cell's half diagonal), then confirm every flagged cell in continuous
geometry. Neither aliasing direction then survives. And run the whole thing at
three raster steps before believing any of it.

One consequence for anything holding a threshold: **count area, not cells.** The
soak's leak threshold is in cells, so a lip of fixed physical size grows in cell
count as the raster refines and the rule tightens roughly sixfold between step
0.5 and step 0.2 on the same world. That is how a converging world can look like
a diverging one.


## Firefly spacing: what a 30 by 30 arena can actually hold

The owner asked to have to cross the screen for the next firefly, which put the
target at 15 to 25 units between neighbours. Measured over 40 arenas, points
placed for distance alone and nothing else, so this is the CEILING and not a
result:

| fireflies | nearest neighbour, mean | min |
|---|---|---|
| 3 to 5 | 19.8 | 19.7 |
| 6 | 15.9 | 14.0 |
| 7 | 14.8 | 14.0 |
| 8 | 13.9 | 13.6 |
| 9 | 13.8 | 13.6 |

So the requirement is reachable at FIVE fireflies and not at nine: nine on a
perfect lattice in this arena is 14 apart, and that is a wall set by the arena's
size rather than by any placement rule. Once they also have to avoid props,
fences and each other, nine come out at about 11.

It is the arena shrinking under the requirement. The straight choice is nine at
about 11, or five at about 20, and it is the owner's to make now that levels are
authored by hand.
