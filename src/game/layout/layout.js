// createLayout: the whole level, in the order a level is built.
//
//   1. the tile map           every corridor open, the full lattice
//   2. the maze               close ribs until it stops being fair to close more
//   3. plots and bays         what the closures left behind
//   4. the gate               in the perimeter fence, and its keep-out disc
//   5. the pen                the middle plot, one open grave per skeleton
//   6. the set pieces         one fountain, one shed, in the plots that fit them
//   7. the rest of the bays   a motif each
//   8. fireflies              down every corridor centreline at 1.0
//   9. the jack-o'-lanterns   four power pellets, near the four corners
//  10. the spawns             the ghost below the pen, the skeletons in it
//  11. the graph              path tiles as nodes, 2.0 edges between them
//
// Steps 1 to 3 decide whether the level is FAIR, and nothing after them can
// break that: props only ever go on plot ground, and a prop cannot move a
// corridor. Steps 5 to 7 decide whether it is PRETTY. Keeping those two apart
// is the reason the overnight check can run thousands of levels and mean
// something: the navigation rules are proved by construction and then tested
// anyway, and the placement rules are tested on every prop.
//
// Everything runs headless. Nothing in this package builds a mesh, creates a
// scene or touches a canvas: the only things it takes from the rest of the
// project are two published constants, the gate's sweep radius and the floor's
// limit on how many holes it can carry, and the prop footprints in
// footprints.js, which were measured off the props once and written down.

import { createRng } from './rng.js';
import { makeFrame } from './frame.js';
import { createTiles, TILE, BLOCK } from './grid.js';
import { buildMaze, applyMaze } from './maze.js';
import { findPlots, plotTiles } from './plots.js';
import { createPlacer } from './place.js';
import { MOTIFS, chooseMotif, lanternCorners } from './motifs.js';
import { footprintOf } from './footprints.js';
import { GATE } from './gate.js';
// The floor can only be cut so many times: each hole costs a distance test per
// ground fragment and addGroundHole() THROWS past the limit, so the number of
// open graves in a level is an engine constraint and not a taste one. Taken
// from the floor itself rather than copied.
import { MAX_GROUND_HOLES } from '../../ghost/ground.js';

export function createLayout({
  seed = 1,
  cells = [7, 5],
  frame: frameKind = 'screen',
  // How hard the maze tries to merge cells into bigger plots. 1 attempts every
  // interior rib; lower leaves a plainer grid.
  density = 1,
  // Rule 6's "one big thing or three small ones", as a cap on how many cells
  // one plot may swallow. Three is a 16.0 by 4.0 plot, which is a long row of
  // graves and the widest thing that still reads as one plot.
  maxPlotCells = 3,
  // Firefly spacing along a corridor. 1.0 puts one at every node and one at
  // every edge midpoint.
  fireflySpacing = 1.0,
  // How many graves may be open at once, floor cuts and skeleton spawns
  // together. src/ghost/ground.js allows four and throws at the fifth.
  maxHoles = MAX_GROUND_HOLES,
} = {}) {
  const [cellsX, cellsZ] = cells;
  const rng = createRng(seed);
  const frame = makeFrame(frameKind);

  // --- 1 to 3: the ground ---------------------------------------------------
  const tiles = createTiles(cellsX, cellsZ);
  const maze = buildMaze({ cellsX, cellsZ, rng: rng.fork('maze'), maxPlotCells, density });
  applyMaze(tiles, maze);
  const plots = findPlots(tiles, maze);

  // --- 4: the gate ----------------------------------------------------------
  // In the middle of the near fence, which is the outer edge of the corridor
  // along the bottom of the screen, so the player walks in through it. The
  // keep-out is fence/gate-controller.js's own: the FULL disc of the leaf's
  // reach about the hinge, because the gate is double acting.
  const gateHinge = { u: 0, v: tiles.bounds.minV };
  const gate = {
    ...frame.toWorld(gateHinge.u - GATE.hingeX, gateHinge.v),
    yaw: frame.yawFor(0, 1) + Math.PI,     // the leaf runs along the fence line
    hinge: frame.toWorld(gateHinge.u, gateHinge.v),
    keepOut: { ...frame.toWorld(gateHinge.u, gateHinge.v), radius: GATE.sweepRadius },
    keepOutShape: { shape: 'disc', x: gateHinge.u, z: gateHinge.v, r: GATE.sweepRadius },
  };

  // --- 5 to 7: the props ----------------------------------------------------
  const placer = createPlacer({ tiles, gate, frame });
  // The pen keeps all but one of the floor's holes, so there is still a dug
  // grave somewhere in the graveyard for the look of the thing.
  const out = { graves: [], budget: { holes: maxHoles } };

  const bays = [];
  for (const plot of plots) for (const bay of plot.bays) bays.push(bay);

  const penRow = maze.pen.row;
  const penCols = new Set(maze.pen.cols);
  const isPenBay = (bay) => bay.j === penRow && bay.cols.some((i) => penCols.has(i));

  const penBay = bays.find(isPenBay);
  if (penBay) {
    MOTIFS.pen({ bay: penBay, rng: rng.fork('pen'), placer, tiles, out, penBudget: Math.max(1, maxHoles - 1) });
  }

  // The two set pieces go to the widest bays that are not the pen, one per
  // level, chosen before anything else has taken the ground.
  const roomy = bays
    .filter((b) => b !== penBay && b.cells >= 2)
    .sort((a, b) => (b.width - a.width) || (a.cv - b.cv) || (a.cu - b.cu));
  const featureRng = rng.fork('features');
  const fountainBay = roomy.length ? featureRng.pick(roomy.slice(0, Math.min(3, roomy.length))) : null;
  const shedBay = roomy.find((b) => b !== fountainBay) || null;
  const assigned = new Map();
  if (fountainBay) assigned.set(fountainBay, 'fountainCourt');
  if (shedBay) assigned.set(shedBay, 'shedYard');

  // The two places a player has to be able to find, lit: the pen and the way in
  // through the gate. Matched lanterns on the plot corners either side, before
  // the motifs run, so a bay works around them rather than over them.
  const lampRng = rng.fork('lamps');
  const lampVariant = lampRng.pick(['ground', 'hurricane', 'pillar']);
  if (penBay) {
    const off = 1.0 + footprintOf('lantern', lampVariant).r + 0.3;
    lanternCorners({
      placer, rng: lampRng, variant: lampVariant,
      corners: [
        [penBay.u0 - off, penBay.v0 - off], [penBay.u1 + off, penBay.v0 - off],
        [penBay.u0 - off, penBay.v1 + off], [penBay.u1 + off, penBay.v1 + off],
      ],
    });
  }
  {
    const off = 1.0 + footprintOf('lantern', lampVariant).r + 0.3;
    const gv = tiles.bounds.minV + 2 + off;
    lanternCorners({
      placer, rng: lampRng, variant: lampVariant,
      corners: [[-3 - off, gv], [3 + off, gv]],
    });
  }

  for (const bay of bays) {
    if (bay === penBay) continue;
    const bayRng = rng.fork(`bay:${bay.j}:${bay.cols[0]}`);
    const motif = assigned.get(bay) || chooseMotif(bay, bayRng);
    MOTIFS[motif]({ bay, rng: bayRng, placer, tiles, out });
    bay.motif = motif;
  }

  // --- 8 and 9: fireflies and power pellets ---------------------------------
  const paths = [];
  for (let b = 0; b < tiles.th; b++) {
    for (let a = 0; a < tiles.tw; a++) if (tiles.isPath(a, b)) paths.push([a, b]);
  }

  // Four power pellets, one per corner, mirrored in u so the pair on the right
  // is the pair on the left. Pac-Man puts them in the corners and so does this.
  // Inset from the corner the way Pac-Man's are, and clamped so a very small
  // graveyard does not ask for a tile off the end of itself.
  const inset = Math.max(1, Math.min(3, Math.floor(Math.min(tiles.tw, tiles.th) / 4)));
  const corners = [];
  for (const sv of [-1, 1]) {
    const targetV = tiles.V(sv < 0 ? inset : tiles.th - 1 - inset);
    const targetU = tiles.U(inset);
    let best = null;
    for (const [a, b] of paths) {
      const d = Math.abs(tiles.U(a) - targetU) + Math.abs(tiles.V(b) - targetV);
      if (!best || d < best.d) best = { a, b, d };
    }
    corners.push([best.a, best.b]);
    corners.push([tiles.tw - 1 - best.a, best.b]);
  }
  // A level small enough for two corners to land on one tile gets one power
  // pellet there, not two stacked.
  const seenCorner = new Set();
  const corner4 = corners.filter(([a, b]) => {
    const k = a + ',' + b;
    if (seenCorner.has(k)) return false;
    seenCorner.add(k);
    return true;
  });
  const jackFoot = footprintOf('pumpkin', 'classic');
  const powerups = corner4.map(([a, b]) => ({
    kind: 'jack',
    ...frame.toWorld(tiles.U(a), tiles.V(b)),
    u: tiles.U(a), v: tiles.V(b),
    yaw: frame.yawFor(0, -1),
    radius: jackFoot.r,
  }));

  // --- 10: the spawns -------------------------------------------------------
  // The ghost starts on the corridor below the pen, which is where Pac-Man
  // starts, and never inside the gate's sweep.
  const penV = penBay ? penBay.cv : 0;
  let ghostTile = null;
  const powerTiles = new Set(corner4.map(([a, b]) => a + ',' + b));
  for (const [a, b] of paths) {
    const u = tiles.U(a);
    const v = tiles.V(b);
    // Not in the gate's sweep, and not on top of a power pellet: a ghost that
    // starts the level already eating one has skipped the first decision.
    if (powerTiles.has(a + ',' + b)) continue;
    if (Math.hypot(u - gate.keepOutShape.x, v - gate.keepOutShape.z) < GATE.sweepRadius + 0.8) continue;
    const score = Math.abs(u) + 2 * Math.abs(v - (penV - 6));
    if (!ghostTile || score < ghostTile.score) ghostTile = { a, b, score };
  }
  const ghost = frame.toWorld(tiles.U(ghostTile.a), tiles.V(ghostTile.b));

  // --- fireflies ------------------------------------------------------------
  const fireflies = [];
  const taken = new Set();
  const mark = (u, v) => taken.add(`${u.toFixed(2)},${v.toFixed(2)}`);
  const isTaken = (u, v) => taken.has(`${u.toFixed(2)},${v.toFixed(2)}`);
  for (const p of powerups) mark(p.u, p.v);
  mark(tiles.U(ghostTile.a), tiles.V(ghostTile.b));

  const steps = Math.max(1, Math.round(TILE / fireflySpacing));
  const addFly = (u, v) => {
    if (isTaken(u, v)) return;
    if (Math.hypot(u - gate.keepOutShape.x, v - gate.keepOutShape.z) < GATE.sweepRadius + 0.15) return;
    mark(u, v);
    fireflies.push({ ...frame.toWorld(u, v), u, v });
  };
  for (const [a, b] of paths) {
    const u = tiles.U(a);
    const v = tiles.V(b);
    addFly(u, v);
    // Along each edge to a neighbour, but only the two positive directions, so
    // no midpoint is offered twice.
    for (const [da, db] of [[1, 0], [0, 1]]) {
      if (!tiles.isPath(a + da, b + db)) continue;
      for (let s = 1; s < steps; s++) {
        addFly(u + (da * TILE * s) / steps, v + (db * TILE * s) / steps);
      }
    }
  }

  // --- 11: the graph --------------------------------------------------------
  const nodeIndex = new Map();
  const nodes = paths.map(([a, b], id) => {
    nodeIndex.set(a + ',' + b, id);
    const world = frame.toWorld(tiles.U(a), tiles.V(b));
    return { id, a, b, u: tiles.U(a), v: tiles.V(b), x: world.x, z: world.z, edges: [] };
  });
  const edges = [];
  for (const node of nodes) {
    for (const [da, db] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const other = nodeIndex.get((node.a + da) + ',' + (node.b + db));
      if (other === undefined) continue;
      node.edges.push(other);
      if (other > node.id) edges.push({ a: node.id, b: other });
    }
  }

  // --- the paths ------------------------------------------------------------
  //
  // The corridors again, as polylines rather than tiles, because that is what
  // ground/sandpath.js wants: hand it a line and it lays a ribbon along it. A
  // path that runs the length of the maze in one piece is what makes the maze
  // read as somewhere you walk rather than as a grid of gaps.
  const ribbons = [];
  const runLine = (fixedIsRow, fixed, from, to) => {
    const a = fixedIsRow ? { u: tiles.U(from), v: tiles.V(fixed) } : { u: tiles.U(fixed), v: tiles.V(from) };
    const b = fixedIsRow ? { u: tiles.U(to), v: tiles.V(fixed) } : { u: tiles.U(fixed), v: tiles.V(to) };
    const p0 = frame.toWorld(a.u, a.v);
    const p1 = frame.toWorld(b.u, b.v);
    ribbons.push({ points: [[p0.x, p0.z], [p1.x, p1.z]], width: TILE, tiles: to - from + 1 });
  };
  for (let b = 0; b < tiles.th; b++) {
    let from = null;
    for (let a = 0; a <= tiles.tw; a++) {
      if (tiles.isPath(a, b)) { if (from === null) from = a; continue; }
      if (from !== null && a - from >= 2) runLine(true, b, from, a - 1);
      from = null;
    }
  }
  for (let a = 0; a < tiles.tw; a++) {
    let from = null;
    for (let b = 0; b <= tiles.th; b++) {
      if (tiles.isPath(a, b)) { if (from === null) from = b; continue; }
      if (from !== null && b - from >= 2) runLine(false, a, from, b - 1);
      from = null;
    }
  }

  // --- the fences -----------------------------------------------------------
  // Every plot's outline, in whole 2.0 panels, which is the maze made visible.
  // Not part of the interface DESIGN.md asks for, but the maze IS the fence
  // runs, and working them out is this file's job rather than the scene's.
  const walls = [];
  for (const plot of plots) {
    const own = new Set(plotTiles(plot, maze).map(([a, b]) => a + ',' + b));
    const runs = new Map();
    for (const key of own) {
      const [a, b] = key.split(',').map(Number);
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (own.has((a + da) + ',' + (b + db))) continue;
        // The edge between the two tiles, as a segment in grid units.
        const cu = tiles.U(a) + da * 1.0;
        const cv = tiles.V(b) + db * 1.0;
        const along = da !== 0 ? 'v' : 'u';
        const line = along === 'v' ? cu : cv;
        const key2 = `${along}:${line.toFixed(2)}`;
        if (!runs.has(key2)) runs.set(key2, []);
        runs.get(key2).push(along === 'v' ? cv : cu);
      }
    }
    for (const [key2, list] of runs) {
      const [along, lineStr] = key2.split(':');
      const line = Number(lineStr);
      list.sort((x, y) => x - y);
      let start = list[0];
      let prev = list[0];
      const flush = (from, to) => {
        const a0 = along === 'v' ? { u: line, v: from - 1 } : { u: from - 1, v: line };
        const a1 = along === 'v' ? { u: line, v: to + 1 } : { u: to + 1, v: line };
        const mid = { u: (a0.u + a1.u) / 2, v: (a0.v + a1.v) / 2 };
        walls.push({
          ...frame.toWorld(mid.u, mid.v),
          yaw: along === 'v' ? frame.yawFor(1, 0) : frame.yawFor(0, 1),
          panels: Math.round(Math.hypot(a1.u - a0.u, a1.v - a0.v) / TILE),
          a: frame.toWorld(a0.u, a0.v),
          b: frame.toWorld(a1.u, a1.v),
        });
      };
      for (let k = 1; k <= list.length; k++) {
        if (list[k] === prev + TILE) { prev = list[k]; continue; }
        flush(start, prev);
        start = list[k];
        prev = list[k];
      }
    }
  }

  // --- bounds ---------------------------------------------------------------
  const edge = [
    frame.toWorld(tiles.bounds.minU, tiles.bounds.minV),
    frame.toWorld(tiles.bounds.maxU, tiles.bounds.minV),
    frame.toWorld(tiles.bounds.minU, tiles.bounds.maxV),
    frame.toWorld(tiles.bounds.maxU, tiles.bounds.maxV),
  ];
  const bounds = {
    minX: Math.min(...edge.map((c) => c.x)), maxX: Math.max(...edge.map((c) => c.x)),
    minZ: Math.min(...edge.map((c) => c.z)), maxZ: Math.max(...edge.map((c) => c.z)),
  };

  const props = placer.props.map((p) => ({
    kind: p.kind, variant: p.variant,
    x: p.x, z: p.z, yaw: p.yaw,
    radius: p.radius, height: p.height,
    foot: p.foot, u: p.u, v: p.v, gridYaw: p.gridYaw,
  }));

  return {
    seed,
    graph: { nodes, edges },
    props,
    fireflies,
    powerups,
    spawns: {
      ghost,
      graves: out.graves.map((g) => ({ x: g.x, z: g.z, yaw: g.yaw })),
    },
    bounds,
    gate,
    walls,
    paths: ribbons,
    // Everything below is extra: the interface in DESIGN.md is the five fields
    // above, and these are what a checker or a renderer needs to do its job
    // without rebuilding the grid.
    // The corridor, as the union of 2.0 squares on the lattice: centre, half
    // extent and the world yaw of the square's own axes, which is all a checker
    // or a path renderer needs to test a point against the maze without knowing
    // anything about the grid.
    corridor: {
      half: 1.0,
      yaw: frame.yawFor(0, 1),
      tiles: paths.map(([a, b]) => ({ ...frame.toWorld(tiles.U(a), tiles.V(b)), u: tiles.U(a), v: tiles.V(b) })),
    },
    grid: {
      cellsX, cellsZ, tile: TILE, block: BLOCK, frame: frameKind,
      bounds: tiles.bounds,
      plots: plots.length,
      rejects: placer.rejects,
      bays: bays.map((b) => ({ cu: b.cu, cv: b.cv, width: b.width, cells: b.cells, motif: b.motif || 'pen' })),
    },
  };
}

export default createLayout;
