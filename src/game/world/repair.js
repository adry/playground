// The repair pass, and the measurement that made it necessary.
//
// The rules half pointed its fairness soak at this generator and found F3, the
// safe spot, failing in ONE LEVEL IN FOUR. F3 says: everywhere the ghost can
// reach using its jump must be somewhere a skeleton can reach without one. When
// it fails there is a place the player can stand and be safe for ever, and the
// game stops being a game.
//
// The cause was not the fences. It was the HEADSTONES, and the reason is a
// number this package did not know it had to respect: navigation treats a solid
// prop as a CIRCLE of its bounding radius, and a body needs 0.555 of clearance.
// A headstone therefore blocks a disc of about 1.14, and two headstones placed
// the legal 0.15 apart block everything between them. A wandering row of five,
// which is the prettiest thing this generator makes, is a WALL as far as
// anything that walks is concerned. Lay one against the perimeter and the strip
// behind it is a place the ghost can hop into and no skeleton can follow.
//
// So placement rule 1 is about how a graveyard LOOKS and it is not sufficient.
// This file adds the rule about how it WORKS:
//
//   EVERY PLACE A BODY CAN STAND IS NEAR A CORRIDOR IT COULD HAVE WALKED DOWN.
//
// That is strictly stronger than F3 and it is much easier to enforce and to
// state. If it holds then the skeletons' reachable set is everywhere the ghost
// can be, and the difference F3 measures is empty by construction.
//
// It took three goes to state it right, and the two wrong versions are worth
// keeping because they are the same mistake twice. "The walkable set is
// CONNECTED" is not enough, because a wedge between a headstone and a pen rail
// IS connected, through a channel so narrow that half the rasters measuring the
// level cannot see it. "Repair to a wider body" is not enough either, because a
// body wide enough to force every channel above the visible band cannot get
// through a GATE, which is only 1.845 across, so the pass reads good gates as
// sealed and gives up. The version that works uses two clearances at once: a
// corridor is ground clear at the wide radius, a place to stand is ground clear
// at the real one, and everything in the second has to be within three cells of
// something in the first.
//
// It is enforced by TAKING PROPS BACK OUT. The alternative, refusing them at
// placement time, cannot work: whether a prop closes a passage depends on every
// other prop, so it is a property of the finished level and not of any single
// placement. A row of five that becomes a row of four is still a row, which is
// the same argument layout/motifs.js makes about refusals, applied at the end
// instead of at the beginning.
//
// The same pass fixes the three smaller failures the soak found, because they
// are all the same shape of problem, a prop somewhere a body has to be:
//
//   the ghost's own spawn has to admit a body
//   every headstone's keep-clear zone has to be clear of solid props, or the
//     skeleton that climbs out in front of it comes up inside a fountain
//   every gate's approach corridor has to admit a body, two units either side

// THE RULES HALF'S OWN RASTERISER, IMPORTED RATHER THAN REPRODUCED.
//
// The first version of this file reproduced nav.js's occupancy model here, and
// it cut F3 from 24% to 16% and no further, because a reproduction is not the
// thing: their raster blocks EDGES as well as cells, uses half a unit rather
// than a quarter, and takes its radius from the two bodies rather than from a
// number written down twice. Every one of those differences is a level this
// generator believes is connected and their check does not. So the repair pass
// asks nav.js the same question the soak asks it, on the same grid, and cannot
// drift from it.
// A QUARTER OF A UNIT, not a half.
//
// The repair ran at 0.5 first, matching the soak's own default, and the soak
// then read 0.0% at 0.5, 0.7% at 0.4 and 2.0% at 0.25: climbing rather than
// converging, which is a coarse raster failing to SEE the failures a fine one
// finds. A half unit grid steps over a gap between two headstones that a body
// can walk through and steps over a pocket a body can stand in, and it does the
// second more often than the first. So the repair is done at the finest raster
// anybody measures at, and it costs about forty milliseconds a level.
import { spawnZones, propsInZone } from './spawn.js';

export const NAV_CELL = 0.25;
// THE BODY, PLUS A MARGIN, AND THE MARGIN IS THE POINT.
//
// soak.mjs judges with FAIR_RADIUS = max(TUNING.ghostRadius 0.55, SKEL_RADIUS
// 0.475 + 0.08) = 0.555. Repairing at exactly that left a residue of about one
// arena in a hundred that MOVED between raster steps: seed 139 failed at 0.5
// and 0.4 and passed at 0.3, seed 115 the other way round. A failure that moves
// with the measuring instrument is not a hole in the world, it is a passage
// sitting exactly on the limit, and whether a raster sees it depends on where
// its cell centres happen to land rather than on anything about the level.
//
// So the repair works to a body slightly wider than the one that has to fit.
// The margin cannot be large: a gate's opening is 2.0 between two posts of
// 0.0775, which leaves a body of radius r just 2.0 - 2 * (0.0775 + r) of room
// to steer in, and at r = 0.705 that is 0.435, narrower than the coarse raster
// the first round uses. The repair then reads a perfectly good gate as sealed,
// decides the pen behind it is a pocket, finds no prop to blame and gives up on
// the whole level. That regression cost more than the margin bought. 0.08 keeps
// 0.575 of steering room, wider than any raster in use, and still leaves every
// passage 0.16 wider than the body that has to fit.
// TWO CLEARANCES, AND THE RULE THAT USES BOTH.
//
// This is the number that took three tries to get right, so the reasoning is
// worth writing down.
//
// A flood fill only SEES a passage when a line of cell centres runs through the
// free part of it, so a channel of physical width W is seen at cell size c only
// once W - 2 * 0.555 is about c. Rasters in use run from 0.5 down to 0.2, so
// any channel between 1.11 and 1.61 wide is one that some rasters find and
// others do not, and a region behind such a channel is a pocket that appears
// and disappears with the measuring instrument. Every residual F3 failure was
// one of those: a five cell wedge between a pen's fence and a headstone a
// metre off it, which the ghost vaults into and a skeleton reaches through a
// gap that half the rasters cannot see.
//
// Widening the body does not fix it on its own, and neither does narrowing it,
// because the two errors have opposite signs: a wide body cannot get through a
// GATE, which is only 1.845 between the posts, and a narrow one walks down the
// very channels whose visibility is in question. So the repair uses BOTH, and
// the rule it enforces is stated in terms of both:
//
//   EVERY PLACE A BODY CAN STAND IS WITHIN THREE QUARTERS OF A UNIT OF A
//   CORRIDOR A BODY CAN WALK DOWN.
//
// A corridor is ground clear at the wide radius, so it is at least 1.61 across
// and every raster in use can see it; a place to stand is ground clear at the
// real radius. A wedge between a fence and a headstone is a place to stand with
// no corridor near it, and it is exactly what was left. Gates are re-opened on
// the wide mask by hand, because they are known passable by construction and
// are the one thing narrower than the wide radius that has to conduct.
//
// AND THEN THE SAME MISTAKE ONE LEVEL DOWN. With that rule in place the soak
// answered 0.0% at 0.5, 0.4 and 0.25 and 1.0% at 0.2, and the temptation was to
// call the residue rasterisation and stop. It was not. Two arenas in two
// hundred held a real wedge 1.26 across at its widest, a body fits in 1.11, and
// this pass walked past both of them because it asked whether a body fits at
// the cell's CENTRE and no cell centre on a quarter unit lattice happened to
// land in either. The pass was measuring its own raster exactly as the soak had
// been. So the question a cell is asked is now "does a body fit ANYWHERE in
// you", answered generously by shrinking the radius by the cell's half
// diagonal and then confirmed exactly, in continuous geometry, on the few cells
// that says yes to. It costs half a prop per level and it is the difference
// between converging and looking converged.
export const UNIFORM_R = 0.805;
// The body that actually has to fit, which is soak.mjs's FAIR_RADIUS:
// max(TUNING.ghostRadius 0.55, SKEL_RADIUS 0.475 + 0.08).
export const NAV_R = 0.555;
// How far a body may shuffle off a corridor and still be somewhere it walked
// to rather than somewhere it was dropped. Three cells.
export const FRINGE = 3;
// The body the gates are re-opened for, which is the one that has to fit.
export const GATE_BODY_R = 0.58;
export const SKEL_R = 0.475;
export const GATE_R = 0.60;
export const GATE_REACH = 2.0;
// In CELLS of NAV_CELL, so at a quarter of a unit this is a pocket of an eighth
// of a square unit and a total leak of a fifth of one. The ghost is 1.31 across
// and needs 1.35 square units to stand in, so nothing this small is a place
// anybody can hide; the tolerance exists only for the one or two cells that
// rasterisation leaves at the lip of a gate.
const MIN_POCKET = 2;
// ZERO. The tolerance existed for cells at the lip of a gate, and the fringe
// rule does not produce those: a cell it flags is one a body FITS IN and cannot
// WALK IN, which is a wedge whatever its size. The last four failures were
// slivers of half a square unit between two headstones and a pen rail, too
// small for the ghost to sit in comfortably and big enough for the check to
// count, and there is no size at which one of those is acceptable.
const MAX_LEAK = 0;

const pointSegD2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (px - (ax + dx * t)) ** 2 + (pz - (az + dz * t)) ** 2;
};

export function discClear(barriers, props, x, z, r) {
  for (const b of barriers) {
    const lim = b.half + r;
    if (pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1) < lim * lim - 1e-6) return false;
  }
  for (const p of props) {
    if (!p.solid) continue;
    const lim = p.radius + r;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim - 1e-6) return false;
  }
  return true;
}

// Is there a point inside this cell where a body of NAV_R stands clear of
// everything? The cell centre is not the question: a wedge 1.26 across at its
// widest holds a body and can still miss every cell centre on a quarter unit
// raster, and that is exactly what the last two failures in two hundred were.
// Sampled on a five by five, so the answer is right to a twentieth of a unit.
const FITS_STEPS = 4;
function bodyFits(barriers, props, cx, cz, cell) {
  for (let a = 0; a <= FITS_STEPS; a++) {
    for (let b = 0; b <= FITS_STEPS; b++) {
      const x = cx + (a / FITS_STEPS - 0.5) * cell;
      const z = cz + (b / FITS_STEPS - 0.5) * cell;
      if (discClear(barriers, props, x, z, NAV_R)) return true;
    }
  }
  return false;
}

// Which solid props are the reason a point is blocked.
function blockers(props, x, z, r) {
  const out = [];
  for (const p of props) {
    if (!p.solid || p.keep) continue;
    const lim = p.radius + r;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim) out.push(p);
  }
  return out;
}


// The raster, built directly rather than through nav.makeGrid.
//
// It started as a call to nav.js, on the principle that the repair should ask
// the same question the soak asks and cannot then drift from it. Two things
// changed that. The first is cost: makeGrid also builds an eight way EDGE mask
// and a vault table, which is most of its work and none of what this needs, and
// at a quarter unit that was 160 milliseconds a level. The second is that the
// edge mask stopped mattering: blocking to the wide radius puts six cells of
// blocked ground either side of every fence, so no pair of open cells is ever
// adjacent across one and there is nothing for an edge mask to catch.
//
// What is reproduced is discClear, which is four lines: a circle against a
// capsule for a barrier, a circle against a circle for a solid prop. That is
// nav.js's model exactly, and world-check.mjs asserts the radii agree.
function navGrid(box, barriers, gates, props, spawn, cell = NAV_CELL) {
  const pad = 1.5;
  const x0 = box.minX - pad;
  const z0 = box.minZ - pad;
  const n = Math.ceil((box.maxX - box.minX + 2 * pad) / cell);
  const wx = (i) => x0 + (i % n) * cell + cell / 2;
  const wz = (i) => z0 + (((i / n) | 0) * cell) + cell / 2;
  const blocked = new Uint8Array(n * n);
  const wide = new Uint8Array(n * n);
  // THE THIRD MASK, and the reason it exists.
  //
  // `blocked` asks whether a body fits at the cell's CENTRE. That aliases: a
  // wedge can be 1.26 across at its widest and still have no cell centre
  // inside it at a quarter unit, so the pass walked straight past two arenas in
  // two hundred and the soak found them at a finer raster than this one. This
  // mask asks the honest question instead, whether a body fits ANYWHERE in the
  // cell, by shrinking the radius by the cell's half diagonal. It over-answers
  // by design, so every cell it flags is then confirmed exactly. See the orphan
  // loop. It is stored the other way up, as "no body fits anywhere in here",
  // because that is what dilate() and the orphan loop both want to test.
  const unfit = new Uint8Array(n * n);
  const fitR = Math.max(0.05, NAV_R - cell * Math.SQRT1_2);
  const solid = props.filter((p) => p.solid);
  for (let i = 0; i < n * n; i++) {
    const x = wx(i);
    const z = wz(i);
    let narrow = 0;
    let nofit = 0;
    let big = 0;
    for (const b of barriers) {
      const d2 = pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1);
      if (!narrow && d2 < (b.half + NAV_R) ** 2) narrow = 1;
      if (!nofit && d2 < (b.half + fitR) ** 2) nofit = 1;
      if (!big && d2 < (b.half + UNIFORM_R) ** 2) big = 1;
      if (nofit && big) break;
    }
    if (!(nofit && big)) {
      for (const p of solid) {
        const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (!narrow && d2 < (p.radius + NAV_R) ** 2) narrow = 1;
        if (!nofit && d2 < (p.radius + fitR) ** 2) nofit = 1;
        if (!big && d2 < (p.radius + UNIFORM_R) ** 2) big = 1;
        if (nofit && big) break;
      }
    }
    blocked[i] = narrow;
    unfit[i] = nofit;
    wide[i] = big;
  }
  // And the gates back open on the wide mask. A gate is 1.845 between the
  // posts, which is above the band and passable at every raster, but it is
  // below the wide radius, so blocking it and then re-opening it is the only
  // way to have both. Nothing else in the level gets this treatment.
  for (const g of gates) {
    const a0 = Math.max(0, Math.floor((g.x - 3 - x0) / cell));
    const a1 = Math.min(n - 1, Math.ceil((g.x + 3 - x0) / cell));
    const b0 = Math.max(0, Math.floor((g.z - 3 - z0) / cell));
    const b1 = Math.min(n - 1, Math.ceil((g.z + 3 - z0) / cell));
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const i = b * n + a;
        if (!wide[i] || blocked[i]) continue;
        if (Math.hypot(wx(i) - g.x, wz(i) - g.z) > 3) continue;
        wide[i] = 0;
      }
    }
  }
  void spawn;
  return {
    n, cell, x0, z0, blocked, unfit, wide, wx, wz,
    DIR8,
    wall: null,
  };
}

// The no-jump pieces of the walkable ground, over nav's own edge mask: a step
// between two open cells is not a step if the edge between them crosses a
// barrier, which is a distinction a cell-only raster cannot make.
// Only what is INSIDE the wall counts. The raster reaches a few units past the
// perimeter so the wall itself is represented rather than falling off the edge,
// and the ground out there in the darkness is a component like any other: the
// first version of this pass spent every round trying to remove a headstone
// that would connect the arena to the outside of it.
// The nearest cell of the CORRIDOR network, which is what a body can walk on.
function nearestWide(grid, x, z) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < grid.n * grid.n; i++) {
    if (grid.wide[i]) continue;
    const d = (grid.wx(i) - x) ** 2 + (grid.wz(i) - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The main corridor network, grown by `steps` cells into everywhere a body can
// stand. What it does NOT reach is a wedge.
function dilate(grid, label, main, steps, through = grid.blocked) {
  const N = grid.n * grid.n;
  const out = new Uint8Array(N);
  let front = [];
  for (let i = 0; i < N; i++) if (label[i] === main) { out[i] = 1; front.push(i); }
  for (let s = 0; s < steps; s++) {
    const next = [];
    for (const i of front) {
      const a = i % grid.n;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        if (a + dx < 0 || a + dx >= grid.n) continue;
        const j = i + dz * grid.n + dx;
        if (j < 0 || j >= N || out[j] || through[j]) continue;
        out[j] = 1;
        next.push(j);
      }
    }
    front = next;
  }
  return out;
}

// A component's identity across rounds, since the labels are renumbered every
// time: the world position of its lowest cell, rounded to the nearest unit.
function signature(grid, label, id) {
  for (let i = 0; i < grid.n * grid.n; i++) {
    if (label[i] === id) return `${Math.round(grid.wx(i))},${Math.round(grid.wz(i))}`;
  }
  return 'none';
}

function insideCount(grid, label, id, box) {
  let n = 0;
  for (let i = 0; i < grid.n * grid.n; i++) {
    if (label[i] !== id) continue;
    const x = grid.wx(i);
    const z = grid.wz(i);
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) n++;
  }
  return n;
}

function components(grid) {
  const N = grid.n * grid.n;
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = [];
  const blocked = grid.wide;
  for (let s = 0; s < N; s++) {
    if (blocked[s] || label[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      size++;
      const a = i % grid.n;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        if (a + dx < 0 || a + dx >= grid.n) continue;
        const j = i + dz * grid.n + dx;
        if (j < 0 || j >= N || blocked[j] || label[j] !== -1) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// --- the pass ---------------------------------------------------------------
//
// THE WEDGE CHECK, ON ITS OWN, FOR A LEVEL NOBODY GENERATED.
//
// The repair pass below finds wedges in order to remove the prop making one.
// A hand-authored level wants the finding without the removal: tell the author
// where it is and let them decide. Same code, same two masks, same
// generous-then-exact confirmation, so the editor and the generator cannot
// disagree about what a wedge is.
//
//   findWedges({ box, barriers, gates, props, spawn }) -> [{ x, z, cells }]
//
// One entry per pocket, at its centre, with the number of cells in it. An
// empty array is the level saying every place a body can stand is somewhere a
// body could have walked to. Everything is world space and the arguments are
// the same records world.barriers(), world.gates() and world.props() publish,
// so a level loaded out of a file is checked by exactly this call.
//
// AND THE OTHER END OF THE FLOOD, which is new and is the reason a keep-clear
// zone had to be taught to this function rather than only to the audit.
//
// The flood starts at the GHOST'S spawn, so what it reports is ground the ghost
// cannot walk to. That was the whole question while the skeletons came out of
// four hand-placed graves the generator guaranteed were on the main component.
// They come out of headstones now, chosen at random from every marker in the
// yard, and a marker's own plot can perfectly well sit on the far side of a
// fence the flood never crossed. Nothing about that reads as a pocket: it is
// two cells of ordinary ground with a stone at one end, a body fits there, and
// a body could have walked there from the other side. The level is then unfair
// in the direction nothing was looking, because a skeleton APPEARS in it.
//
// So a spawn point that is not on the ghost's own component is a finding of the
// same kind and comes back in the same list, with `spawn` naming the marker and
// `cells` at zero. An entry with `cells: 0` is a place something arrives at,
// not a place something is trapped in, and a caller that only wants pockets can
// filter on it.
//
// SINGLE CELLS ARE NOT REPORTED, and the floor is the same MIN_POCKET the
// repair uses. The confirmation samples a cell on a five by five, so a cell
// whose extreme corner clears the body by a millimetre counts as a place to
// stand and its neighbours do not. Over sixty generated arenas that produced
// seventeen findings of exactly one cell and none of two or more, against a
// soak that reports those arenas clean at a raster of 0.15. One cell is the
// instrument; two is a place.
export function findWedges({ box, barriers, gates, props, spawn, spawns = null, cell = NAV_CELL, minCells = MIN_POCKET }) {
  const grid = navGrid(box, barriers, gates, props, spawn, cell);
  const { label } = components(grid);
  const spawnCell = nearestWide(grid, spawn.x, spawn.z);
  if (spawnCell < 0) return [];
  const reachable = dilate(grid, label, label[spawnCell], FRINGE, grid.unfit);
  const N = grid.n * grid.n;
  const flagged = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (grid.unfit[i] || reachable[i]) continue;
    const x = grid.wx(i);
    const z = grid.wz(i);
    if (x <= box.minX || x >= box.maxX || z <= box.minZ || z >= box.maxZ) continue;
    if (!bodyFits(barriers, props, x, z, cell)) continue;
    flagged[i] = 1;
  }
  // One finding per pocket rather than per cell, because an author wants to be
  // sent to a place and not to a list of quarter unit squares.
  const seen = new Uint8Array(N);
  const out = [];
  for (let s = 0; s < N; s++) {
    if (!flagged[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let sx = 0;
    let sz = 0;
    let count = 0;
    while (stack.length) {
      const i = stack.pop();
      sx += grid.wx(i);
      sz += grid.wz(i);
      count++;
      const a = i % grid.n;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = DIR8[d];
        if (a + dx < 0 || a + dx >= grid.n) continue;
        const j = i + dz * grid.n + dx;
        if (j < 0 || j >= N || seen[j] || !flagged[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (count >= minCells) out.push({ x: sx / count, z: sz / count, cells: count });
  }
  // And the marker whose plot the ghost's flood never reached. `reachable` is
  // the generous dilation, so a spawn point outside it is outside it at every
  // raster and not merely at this one.
  for (const sp of spawns || []) {
    const a = Math.round((sp.x - grid.x0) / cell - 0.5);
    const b = Math.round((sp.z - grid.z0) / cell - 0.5);
    if (a < 0 || b < 0 || a >= grid.n || b >= grid.n) continue;
    if (reachable[b * grid.n + a]) continue;
    out.push({ x: sp.x, z: sp.z, cells: 0, spawn: sp.stone || sp.id });
  }
  return out;
}

// Returns what it had to take out, and the walkable grid the collectibles are
// then placed against, so a firefly is never put somewhere nothing can walk.
export function repairLevel({ box, barriers, gates, spawn, placer, rounds = 40 }) {
  const report = { removed: 0, rounds: 0, pockets: 0, spawn: 0, zone: 0, gate: 0, stuck: null };
  // Pockets nothing can be removed to open. They are bounded by fence and wall
  // rather than by props, so no prop is to blame and there is nothing this pass
  // can do about them. They are SKIPPED rather than fatal: giving up on the
  // level the moment one appears leaves every other problem in it unfixed,
  // which is how a widened margin made the failure rate go UP.
  //
  // The list is FORGOTTEN whenever a prop comes out, because "no prop is to
  // blame" is a statement about the level as it stood in that round and not
  // about the level. One arena in a hundred and fifty ended with a two cell
  // wedge between a headstone and the divider that this pass had written off
  // in an early round, when its neighbours were still standing and the pocket
  // reached no further than the fence.
  const unfixable = new Set();
  const forget = () => unfixable.clear();

  for (let round = 0; round < rounds; round++) {
    report.rounds = round + 1;
    const props = placer.props;
    // The gross partitions first, on a raster four times cheaper, and then the
    // fine one that decides. A half unit grid finds a row of headstones across
    // the arena in forty milliseconds; it cannot find the last two per cent,
    // which is what the quarter unit rounds are for.
    const cell = round === 0 ? NAV_CELL * 2 : NAV_CELL;
    const grid = navGrid(box, barriers, gates, props, spawn, cell);
    const { label, sizes } = components(grid);

    // The main piece is the one the ghost starts in. If the ghost cannot stand
    // where it starts, that is the first thing to fix.
    const spawnCell = nearestWide(grid, spawn.x, spawn.z);
    if (spawnCell < 0 || Math.hypot(grid.wx(spawnCell) - spawn.x, grid.wz(spawnCell) - spawn.z) > 1.2) {
      const bad = blockers(props, spawn.x, spawn.z, NAV_R + 0.4);
      if (!bad.length) { report.stuck = 'spawn'; break; }
      placer.drop(bad);
      forget();
      report.removed += bad.length;
      report.spawn++;
      continue;
    }
    const main = label[spawnCell];

    // 1. EVERY PLACE A BODY CAN STAND IS NEAR A CORRIDOR IT WALKED DOWN.
    //
    // The corridor network is the wide component the ghost starts in. Every
    // cell a body FITS in has to be within FRINGE cells of it, or it is a wedge
    // between a fence and a headstone: somewhere the ghost can vault into and
    // nothing that walks can get to. Stating it this way rather than as "the
    // walkable set is connected" is what finally caught the residue, because
    // the wedges ARE connected to the rest, through a channel too narrow for
    // half the rasters that measure it to see.
    //
    // Candidates come off the permissive mask and are then CONFIRMED exactly,
    // because the raster alone answers this badly in both directions: a cell
    // centre can sit in a wedge that no body fits in, and a wedge a body does
    // fit in can hold no cell centre at all. The confirmation is the continuous
    // question asked of the cell, is there a point in here where a body of
    // NAV_R stands clear of everything, and it is affordable because it only
    // ever runs on the handful of cells the mask has already flagged.
    const reachable = dilate(grid, label, main, FRINGE, grid.unfit);
    const orphans = [];
    for (let i = 0; i < grid.n * grid.n; i++) {
      if (grid.unfit[i] || reachable[i]) continue;
      const ox = grid.wx(i);
      const oz = grid.wz(i);
      if (ox <= box.minX || ox >= box.maxX || oz <= box.minZ || oz >= box.maxZ) continue;
      if (unfixable.has(`${Math.round(ox)},${Math.round(oz)}`)) continue;
      if (!bodyFits(barriers, props, ox, oz, cell)) continue;
      orphans.push(i);
    }
    // A clean coarse round proves nothing: the fine raster has the last word.
    if (cell > NAV_CELL) continue;
    const scale = (NAV_CELL / cell) ** 2;
    if (orphans.length * scale > MAX_LEAK) {
      report.pockets++;
      // Whatever is walling the wedges in, counted over all of them, so the
      // prop that is most of the wall goes rather than an arbitrary one.
      const votes = new Map();
      for (const i of orphans) {
        // Everything within a body's reach of the pocket that is solid and not
        // a grave. Voting over the pocket's whole boundary means the prop that
        // is most of the wall goes rather than an arbitrary one.
        for (const p of blockers(props, grid.wx(i), grid.wz(i), UNIFORM_R + NAV_CELL * 3)) {
          votes.set(p, (votes.get(p) || 0) + 1);
        }
      }
      if (!votes.size) {
        for (const i of orphans) unfixable.add(`${Math.round(grid.wx(i))},${Math.round(grid.wz(i))}`);
        report.stuck = 'pocket';
        continue;
      }
      let pick = null;
      let best = -1;
      for (const [p, v] of votes) if (v > best) { best = v; pick = p; }
      placer.drop([pick]);
      forget();
      report.removed++;
      continue;
    }

    // 2. NOTHING SOLID IN A HEADSTONE'S KEEP-CLEAR ZONE.
    //
    // This is what the grave step used to be. It asked that each of the four
    // hand-placed graves admitted a skeleton, which was a disc of SKEL_R at one
    // point; the spawn is any marker in the yard now, and what has to be clear
    // is the 2.14 by 2.65 rectangle in front of its face that the climb
    // actually uses. See spawn.js.
    //
    // Only PROPS are cleared. A marker whose zone is crossed by a fence, or
    // hangs over the wall, or sits in a gate's sweep, is demoted to an ordinary
    // headstone by spawnPoints() and nothing is removed for it: a stone against
    // a fence is a good thing to place and this pass has no business pulling
    // the fence down. Measured over twenty seeds, 24% of markers had a prop in
    // the zone and 27% had a fence across it, and after this step every arena
    // is left with at least four usable markers, which is what audit.js asks
    // for and what rules.js's four personalities need.
    let fixed = false;
    for (const z of spawnZones(props)) {
      const bad = propsInZone(z, props).filter((q) => !q.keep);
      if (!bad.length) continue;
      placer.drop(bad);
      forget();
      report.removed += bad.length;
      report.zone++;
      fixed = true;
      break;
    }
    if (fixed) continue;

    // 3. Every gate's approach corridor admits a body, two units either side.
    for (const gate of gates) {
      const bad = [];
      for (let t = -GATE_REACH; t <= GATE_REACH + 1e-9; t += 0.25) {
        const x = gate.x + gate.nx * t;
        const z = gate.z + gate.nz * t;
        if (discClear(barriers, props, x, z, GATE_R)) continue;
        for (const p of blockers(props, x, z, GATE_R)) if (!bad.includes(p)) bad.push(p);
      }
      if (!bad.length) continue;
      placer.drop(bad);
      forget();
      report.removed += bad.length;
      report.gate++;
      fixed = true;
      break;
    }
    if (fixed) continue;

    // Nothing left to fix. Hand back the grid the collectibles will be placed
    // against, with the walkable set already worked out. That one is the STRICT
    // dilation: `reachable` above is deliberately generous so that no wedge
    // escapes the test, and a firefly dropped on a generous cell is a firefly
    // in a wedge.
    const reach = dilate(grid, label, main, FRINGE);
    return { report, grid, reach, ...walkApi(grid, reach) };
  }

  // Ran out of rounds. Hand back what there is; world-check.mjs will say so.
  return finish(box, barriers, gates, placer.props, spawn, report);
}

function finish(box, barriers, gates, props, spawn, report) {
  const grid = navGrid(box, barriers, gates, props, spawn, NAV_CELL);
  const { label } = components(grid);
  const spawnCell = nearestWide(grid, spawn.x, spawn.z);
  const main = spawnCell >= 0 ? label[spawnCell] : -1;
  const reach = dilate(grid, label, main, FRINGE);
  return { report, grid, reach, ...walkApi(grid, reach) };
}

// What the collectibles are placed against: is this somewhere a body can walk
// to, and if not, where is the nearest place that is.
function walkApi(grid, reach) {
  const nearest = (x, z) => {
    const a = Math.max(0, Math.min(grid.n - 1, Math.floor((x - grid.x0) / grid.cell)));
    const b = Math.max(0, Math.min(grid.n - 1, Math.floor((z - grid.z0) / grid.cell)));
    if (reach[b * grid.n + a]) return b * grid.n + a;
    for (let ring = 1; ring < 8; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const na = a + dx;
          const nb = b + dz;
          if (na < 0 || nb < 0 || na >= grid.n || nb >= grid.n) continue;
          if (reach[nb * grid.n + na]) return nb * grid.n + na;
        }
      }
    }
    return -1;
  };
  const walkable = (x, z, within = 1.0) => {
    const c = nearest(x, z);
    return c >= 0 && Math.hypot(grid.wx(c) - x, grid.wz(c) - z) <= within;
  };
  const nearestReachable = (x, z, radius = 6, apart = [], gap = 0) => {
    let best = null;
    let bestD = radius * radius;
    for (let i = 0; i < reach.length; i++) {
      if (!reach[i]) continue;
      const cx = grid.wx(i);
      const cz = grid.wz(i);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d >= bestD) continue;
      if (gap && apart.some((o) => Math.hypot(cx - o.x, cz - o.z) < gap)) continue;
      bestD = d;
      best = { x: cx, z: cz };
    }
    return best;
  };
  return { walkable, nearestReachable };
}

export default repairLevel;
