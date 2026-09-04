// Plots and bays: the ground a motif is handed.
//
// A PLOT is a maximal set of cells joined by shut ribs, which is one burial
// plot with one fence round it. A BAY is a run of cells inside a plot that are
// joined side by side along u, so its ground is one clear rectangle 4.0 deep
// and 4.0, 10.0 or 16.0 wide, with nothing in the middle of it.
//
// Motifs work on bays rather than plots because a row is the unit of tidiness
// here: a row of stones wants a rectangle to run along, and an L shaped plot
// has no single row through it. A plot shaped like an L is simply two bays, and
// each gets its own arrangement.

import { BLOCK, cellCentre } from './grid.js';

export function findPlots(tiles, maze) {
  const { cellsX, cellsZ } = maze;
  const byRoot = new Map();
  for (let j = 0; j < cellsZ; j++) {
    for (let i = 0; i < cellsX; i++) {
      const root = maze.plotOf(i, j);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push({ i, j });
    }
  }

  const plots = [];
  for (const [root, cells] of byRoot) {
    const bays = [];
    const rows = new Map();
    for (const c of cells) {
      if (!rows.has(c.j)) rows.set(c.j, []);
      rows.get(c.j).push(c.i);
    }
    for (const [j, cols] of rows) {
      cols.sort((a, b) => a - b);
      let run = [cols[0]];
      for (let k = 1; k <= cols.length; k++) {
        const i = cols[k];
        const joined = i === run[run.length - 1] + 1 && maze.joined(run[run.length - 1], j, 1, 0);
        if (joined) { run.push(i); continue; }
        const first = cellCentre(tiles, run[0], j);
        const last = cellCentre(tiles, run[run.length - 1], j);
        bays.push({
          plot: root, j, cols: run.slice(),
          u0: first.u - 2, u1: last.u + 2, v0: first.v - 2, v1: first.v + 2,
          cu: (first.u + last.u) / 2, cv: first.v,
          width: last.u - first.u + 4, height: 4,
          cells: run.length,
        });
        if (i !== undefined) run = [i];
      }
    }
    plots.push({ root, cells, bays, size: cells.length });
  }
  // Sorted, so a level is built in the same order whatever a Map iterates in.
  plots.sort((a, b) => a.root - b.root);
  for (const p of plots) p.bays.sort((x, y) => (x.j - y.j) || (x.cols[0] - y.cols[0]));
  return plots;
}

// The tiles of one plot, for drawing its fence.
export function plotTiles(plot, maze) {
  const out = new Set();
  const add = (a, b) => out.add(a + ',' + b);
  for (const { i, j } of plot.cells) {
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) add(BLOCK * i + 1 + a, BLOCK * j + 1 + b);
    // The shut ribs, whose ground belongs to the plot now.
    if (maze.joined(i, j, 1, 0)) { add(BLOCK * i + 3, BLOCK * j + 1); add(BLOCK * i + 3, BLOCK * j + 2); }
    if (maze.joined(i, j, 0, 1)) { add(BLOCK * i + 1, BLOCK * j + 3); add(BLOCK * i + 2, BLOCK * j + 3); }
  }
  return [...out].map((s) => s.split(',').map(Number));
}

export default findPlots;
