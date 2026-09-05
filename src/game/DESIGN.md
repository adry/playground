# Graveyard, the game

A Pac-Man in a cemetery. This file is the contract between the layout
generator, the game rules and the props, so that three people can build them
without agreeing on anything else.

## The mapping, and why each piece is what it is

| Pac-Man | here | why |
|---|---|---|
| the maze | fence runs, hedges, kerbed plots | the fence already exists and is 0.86 tall, low enough to see over and high enough to read as a wall |
| corridors | sand and gravel paths | a path is a corridor you can see, so the maze is legible without a HUD |
| pellets | fireflies | they can drift and glow, so a corridor reads as alive rather than dotted. SIX on the board, and five more the moment one is left |
| the ghost pen | **every headstone**, chosen at random | skeletons climb out of the ground, which the skeleton already does, and it takes 3.4 s, which is a spawn animation for free. It used to be four hand-placed graves; see "The pen is the yard" below |
| power pellet | **nothing** | it was a lit jack-o'-lantern and the owner has taken it out. See rules.js for what the game loses |
| Pac-Man | the cloth ghost | already the player character |

The one deliberate inversion: **the ghost is the player and the skeletons are
the monsters**, so a ghost is running from skeletons in a graveyard. Keep it.

**And the run is endless.** There are no waves, nothing is cleared and there is
no progression from one arena to the next. One yard, six fireflies, five more
whenever one is left, until something catches you. What replaces the wave curve
is the HERD: one skeleton at the start and one more allowed every six fireflies
up to five, so the difficulty is driven by how well the player is doing rather
than by how long they have been alive.

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
`ball` 0.482 radius and 0.775 tall, `cone` 0.405 and 1.270, `box` 0.450 by
0.436 and 0.809, `wild` 0.576 and 0.760. Rule 5 is written against height, so
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

## The pen is the yard, and the player opens it

A skeleton comes out because **the player walked past a tombstone**. That is the
whole spawn mechanic: no schedule, no pen, no timer. Passing within 6.5 of a
spawn-capable headstone rolls once, and on a hit a skeleton climbs out in front
of that stone, which teaches the player to fear the stones, which is what a
graveyard is for.

Four rules hold it together, and `rules.js`'s TUNING block carries the numbers:

- **Never all the time.** The roll is `spawnChance` times READINESS times
  PRESSURE. Readiness is time since the last spawn over `spawnPeriod`, so it is
  zero right after one and climbs back over four and a half seconds; without it
  an unlucky player walks past three stones in two seconds and meets three
  skeletons, which is a death nobody could have played around. Pressure is how
  far the herd is below its allowance, so the population converges on the cap
  instead of wandering under it, and at the start, where the cap is one and one
  is up, it is zero and the stones are quiet.
- **Never on top of you.** A stone nearer than `spawnMin` 2.0 does not fire.
  Beyond that the emergence itself is the reaction window: the climb takes 3.4 s
  and the figure is not solid until it ends, which at the ghost's 3.66 is 12.4
  units of escape. There is no spawn a moving player cannot get away from.
- **At least one, at all times.** With nothing up, one is forced, and it comes
  up where the old pen band put it: ten to twenty units away, weighted to the
  middle. Not the nearest stone, which is a spawn on top of a player who has
  just been caught, and not the furthest, which is a monster that takes twenty
  seconds to become one.
- **And they leave.** A skeleton that has been up for `retireAfter` 45 s burrows
  back, unless it is the last one. This is the decision most worth arguing with:
  if they never left, the count would climb to five and stay there, "gradually
  more" would be a one-way ramp, and passing a stone would stop mattering the
  moment the cap was reached.

**What the level owes the mechanic**, and it is a new obligation: the rate the
whole thing runs at is set by HOW MANY SPAWN-CAPABLE HEADSTONES THERE ARE.
Measured on generated arenas, 4.6 markers produce 9.5 ring entries a minute and
about three skeletons a minute; the shipped demo has four markers out of
twenty-three headstones. A yard laid out for this mechanic wants many more, and
the audit's `spawn` rule count is now a gameplay number and not only a fairness
floor.

## Where a skeleton comes out

Pac-Man's ghosts leave from a box in the middle of the board, and the reason
that works is that the player always knows where danger comes from. This game
had the same thing, four graves placed by hand with a personality each and an
order. It does not any more: every headstone with a face and a clear plot is a
place a skeleton can climb out of, and the section above says who decides when.

The FORCED spawn, and the leash, still choose for themselves, and they choose
the same way: at random from the markers in a band 10 to 20 units around the
player, weighted toward the middle of it, with a 12 s cooldown on a stone
something has just come out of.

**Random rather than best.** The old pick scored every grave and took the
nearest the middle of the band. With four graves that was almost forced, since
the band usually held one or two. With twenty markers a deterministic best
always picks the same stone, the player learns it, and the yard is a pen again.

**The band is the fairness property**, not the count. Ten units is the whole of
what stands between the player and a skeleton surfacing at their shoulder, and
neither edge of the band is preferred: near is cruel and far is a herd that
never arrives.

**Measured against the four graves it replaced, before the proximity mechanic
went in, it is not the crueller game it sounds like.** Sixty generated arenas,
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
createGame({ world, skeletons = 5 }) -> {
  update(dt, input) -> state,
  state: {
    score, lives, mode, fireflies,     // the six on the board, as they stand
    flyRemaining,                      // 6 down to 1, then 6 again
    skeletons,                         // all five slots, `live` false for the
                                       // ones that are not in the game
    skeletonsUp, skeletonCap,
  },
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


## Where a firefly may not go

Two exclusions, and only one of them is geometry.

**The two near walls hide a band each.** The camera is orthographic down
(1, 0.78, 1), so it stands at +x, +y, +z and the walls between it and the ground
are `x = +15` and `z = +15`, which are the lower right and lower left edges of
the screen. A point at height h projects `h / 0.78` further from the camera in
BOTH x and z, so each of those walls hides a band that deep along the inside of
itself. The wall's coping is at 2.0 and its piers stand 0.34 above that every
5.0, so the tallest thing is 2.34 and the band is **3.25** including the wall's
own half thickness. The pier crown is used rather than the coping deliberately:
a pier is 0.86 wide and hides the extra 0.44 for about a sixth of the wall's
length, and a rule that is right five times in six is a rule that gets reported
as a bug the sixth time.

**And three of the four corners.** Screen right is `(x - z) / sqrt(2)` and
screen up is `-(x + z) / sqrt(2)`, so `(-15, +15)` is hard left, `(+15, +15)` is
the bottom, `(+15, -15)` is hard right and only `(-15, -15)` is the top. The
three that are low or to the side are where a firefly cannot be picked out, and
nothing collectible goes within 7.0 of them. That radius is a judgement and not
a measurement, and what it costs is in the table below.

`field.js`'s `inView` is the only definition and every placer asks it: the
generator's own lattice, `level/fireflies.js` for a hand-made level, and
`rules.js`'s runtime refill, so the five that appear when one is left obey the
same rule as the first six. `audit.js` fails a level whose fireflies are not all
in view, which is how the last placer fallback that ignored it was found.

**What it costs, and this is the trade to take back to the owner.**

| available | six fireflies, best nearest neighbour |
|---|---|
| the whole arena | 15.9 |
| less the two blind bands | 12.3 |
| less the three dim corners as well | 11.5 |
| and once they also dodge props and fences | 11.9 mean, 9.0 worst, measured over 100 arenas |

The original requirement was 15 to 25, "have to cross the screen for the next
one". **Six fireflies in the visible arena cannot meet it.** Five in the same
region reach about 13 and still miss it. This is the same shrinking-arena
problem the table below records, arriving a second time from a different
direction, and the choice is the owner's: six and 11.5, or five and 13, or the
corners back and 12.3.

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
