// Which corridors exist, which is the same question as which cells are joined
// into one burial plot.
//
// The maze starts as the full lattice, every corridor open, and then closes
// corridor ribs one at a time. A rib is the 6.0 stretch of corridor between two
// junctions, two plot tiles wide with a junction tile at each end; closing one
// hands its ground to the cells either side of it and merges them into a bigger
// plot. That direction is deliberate. Growing a maze out of nothing means
// proving it is fair afterwards; closing a fair maze one rib at a time means
// every intermediate state is fair too, and a closure that would break the
// rules is simply refused.
//
// The rules, from DESIGN.md's navigation section, checked on the junction graph
// after every attempt:
//
//   one connected component      the whole graveyard is walkable
//   no bridge edges              which is the real form of "every junction has
//                                at least two ways out": a node of degree one
//                                is a dead end, and its only edge is a bridge,
//                                so a graph with no bridges has no dead ends
//                                AND no corridor whose loss splits the map.
//                                A skeleton cannot corner the player anywhere
//                                on a graph like this, because every tile is on
//                                a cycle.
//
// Two more, which are about how it looks rather than whether it is fair:
//
//   mirror symmetry              every closure is made with its mirror image in
//                                u, the screen's horizontal. Pac-Man's maze is
//                                symmetric and it is most of why it reads as
//                                designed rather than generated.
//   a cap on plot size           without it the closures snowball into one
//                                enormous plot with a ring road round it.
//
// The pen is forced rather than found: the middle cells of the middle row are
// merged into one long plot with corridor on all four sides, which is the ghost
// house, and the skeletons climb out of the graves in it.

import { BLOCK } from './grid.js';

function key(dir, i, j) { return dir + i + ',' + j; }

export function buildMaze({ cellsX, cellsZ, rng, maxPlotCells = 3, density = 1 }) {
  const open = new Map();
  const locked = new Set();
  const set = (dir, i, j, value) => open.set(key(dir, i, j), value);
  const isOpen = (dir, i, j) => open.get(key(dir, i, j)) !== false;

  for (let j = 0; j <= cellsZ; j++) for (let i = 0; i < cellsX; i++) set('h', i, j, true);
  for (let j = 0; j < cellsZ; j++) for (let i = 0; i <= cellsX; i++) set('v', i, j, true);

  // --- plots, as a union-find over cells ------------------------------------
  const parent = new Int32Array(cellsX * cellsZ).map((_, k) => k);
  const size = new Int32Array(cellsX * cellsZ).fill(1);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const union = (p, q) => {
    const rp = find(p); const rq = find(q);
    if (rp === rq) return false;
    parent[rq] = rp; size[rp] += size[rq];
    return true;
  };
  const cellId = (i, j) => j * cellsX + i;
  // The two cells a rib separates. A horizontal rib on corridor row j has the
  // cell below it at row j - 1 and the cell above at row j.
  const between = (dir, i, j) => (dir === 'h'
    ? [cellId(i, j - 1), cellId(i, j)]
    : [cellId(i - 1, j), cellId(i, j)]);

  // --- the junction graph ---------------------------------------------------
  const NX = cellsX + 1;
  const jid = (i, j) => j * NX + i;
  const junctions = NX * (cellsZ + 1);
  function edges() {
    const adj = Array.from({ length: junctions }, () => []);
    for (let j = 0; j <= cellsZ; j++) {
      for (let i = 0; i < cellsX; i++) {
        if (!isOpen('h', i, j)) continue;
        adj[jid(i, j)].push(jid(i + 1, j));
        adj[jid(i + 1, j)].push(jid(i, j));
      }
    }
    for (let j = 0; j < cellsZ; j++) {
      for (let i = 0; i <= cellsX; i++) {
        if (!isOpen('v', i, j)) continue;
        adj[jid(i, j)].push(jid(i, j + 1));
        adj[jid(i, j + 1)].push(jid(i, j));
      }
    }
    return adj;
  }

  // Connected and bridgeless, in one iterative pass. Recursion would be fine at
  // this size and is not worth the risk on a level someone asks for at 40 by 40.
  function isTwoEdgeConnected() {
    const adj = edges();
    const disc = new Int32Array(junctions).fill(-1);
    const low = new Int32Array(junctions).fill(0);
    let timer = 0;
    let seen = 0;
    const stack = [[0, -1, 0]];
    disc[0] = low[0] = timer++;
    seen++;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [node, parentNode] = frame;
      if (frame[2] < adj[node].length) {
        const next = adj[node][frame[2]++];
        if (next === parentNode) continue;   // the edge we came in on
        if (disc[next] === -1) {
          disc[next] = low[next] = timer++;
          seen++;
          stack.push([next, node, 0]);
        } else {
          low[node] = Math.min(low[node], disc[next]);
        }
      } else {
        stack.pop();
        if (parentNode !== -1) {
          low[parentNode] = Math.min(low[parentNode], low[node]);
          // A bridge: nothing below `node` reaches back past its parent.
          if (low[node] > disc[parentNode]) return false;
        }
      }
    }
    return seen === junctions;
  }

  // --- the pen --------------------------------------------------------------
  // The middle cells of the middle row, merged, with corridor all round. Three
  // of them when the level has an odd number of columns and two when it has an
  // even number, so the pen is centred and the mirror carries it onto itself.
  const penRow = Math.floor((cellsZ - 1) / 2);
  const penCols = [];
  if (cellsX % 2 === 1) {
    const mid = (cellsX - 1) / 2;
    for (const i of [mid - 1, mid, mid + 1]) if (i >= 0 && i < cellsX) penCols.push(i);
  } else {
    for (const i of [cellsX / 2 - 1, cellsX / 2]) if (i >= 0 && i < cellsX) penCols.push(i);
  }
  const penFirst = penCols[0];
  const penLast = penCols[penCols.length - 1];
  for (let n = 1; n < penCols.length; n++) {
    const i = penCols[n];
    set('v', i, penRow, false);
    union(...between('v', i, penRow));
  }
  // The pen's own walls stay walls, so nothing merges into it and it keeps its
  // ring of corridor: a ghost house with a plot stuck to it is not a ghost
  // house.
  for (const i of penCols) { locked.add(key('h', i, penRow)); locked.add(key('h', i, penRow + 1)); }
  locked.add(key('v', penFirst, penRow));
  locked.add(key('v', penLast + 1, penRow));

  // --- closing ribs ---------------------------------------------------------
  const mirrorOf = (dir, i, j) => (dir === 'h' ? ['h', cellsX - 1 - i, j] : ['v', cellsX - i, j]);
  const candidates = [];
  for (let j = 1; j < cellsZ; j++) for (let i = 0; i < cellsX; i++) candidates.push(['h', i, j]);
  for (let j = 0; j < cellsZ; j++) for (let i = 1; i < cellsX; i++) candidates.push(['v', i, j]);

  const order = rng.shuffle(candidates);
  const budget = Math.round(order.length * density);
  let closed = 0;

  for (const [dir, i, j] of order) {
    if (closed >= budget) break;
    const mirror = mirrorOf(dir, i, j);
    const pair = key(dir, i, j) === key(...mirror) ? [[dir, i, j]] : [[dir, i, j], mirror];
    if (pair.some(([d, ii, jj]) => locked.has(key(d, ii, jj)) || !isOpen(d, ii, jj))) continue;

    // Would the merged plots be too big? Checked before the graph work, since
    // it is the cheaper of the two and refuses more often.
    const roots = new Map();
    let tooBig = false;
    for (const [d, ii, jj] of pair) {
      for (const c of between(d, ii, jj)) {
        const r = find(c);
        if (!roots.has(r)) roots.set(r, size[r]);
      }
    }
    // Both ribs of a mirrored pair can touch the same plot, so the sizes are
    // summed over distinct roots rather than per rib.
    let merged = 0;
    for (const s of roots.values()) merged += s;
    if (merged > maxPlotCells) tooBig = true;
    if (tooBig) continue;

    for (const [d, ii, jj] of pair) set(d, ii, jj, false);
    if (!isTwoEdgeConnected()) {
      for (const [d, ii, jj] of pair) set(d, ii, jj, true);
      continue;
    }
    for (const [d, ii, jj] of pair) union(...between(d, ii, jj));
    closed += pair.length;
  }

  return {
    cellsX, cellsZ,
    isOpen,
    closedCount: closed,
    pen: { row: penRow, cols: penCols },
    plotOf: (i, j) => find(cellId(i, j)),
    plotSize: (i, j) => size[find(cellId(i, j))],
    // Cells (i, j) and (i + di, j + dj) are joined when the rib between them is
    // shut. Only used for direct neighbours.
    joined(i, j, di, dj) {
      if (di === 1) return !isOpen('v', i + 1, j);
      if (di === -1) return !isOpen('v', i, j);
      if (dj === 1) return !isOpen('h', i, j + 1);
      if (dj === -1) return !isOpen('h', i, j);
      return false;
    },
  };
}

// Paint the maze onto the tile map: a closed rib is two plot tiles.
export function applyMaze(tiles, maze) {
  const { cellsX, cellsZ } = maze;
  for (let j = 0; j <= cellsZ; j++) {
    for (let i = 0; i < cellsX; i++) {
      if (maze.isOpen('h', i, j)) continue;
      tiles.set(BLOCK * i + 1, BLOCK * j, 0);
      tiles.set(BLOCK * i + 2, BLOCK * j, 0);
    }
  }
  for (let j = 0; j < cellsZ; j++) {
    for (let i = 0; i <= cellsX; i++) {
      if (maze.isOpen('v', i, j)) continue;
      tiles.set(BLOCK * i, BLOCK * j + 1, 0);
      tiles.set(BLOCK * i, BLOCK * j + 2, 0);
    }
  }
}

export default buildMaze;
