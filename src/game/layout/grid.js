// The floor, as a tile map.
//
// DESIGN.md gives three numbers: the lattice is 2.0, a corridor is 2.0 wide,
// and a cell is 4.0 by 4.0 enclosed by four corridor segments. Those three only
// fit together one way. If a cell is 4.0 of CLEAR ground and the corridors
// round it are 2.0 wide, then corridor centrelines are 6.0 apart, which is
// three lattice steps. So:
//
//     tile        2.0 by 2.0, the lattice cell, and the whole map is tiles
//     corridor    one tile wide, so every third tile column and row
//     cell        the 2 by 2 block of tiles between them, 4.0 by 4.0
//     block       3 tiles, 6.0, one corridor plus one cell
//
//   a:  0   1   2   3   4   5   6
//     +---+---+---+---+---+---+---+
//     | # | . | . | # | . | . | # |     # corridor tile, path
//     +---+---+---+---+---+---+---+     . plot tile, four of them make a cell
//
// Everything downstream falls out of that. A wall is a tile edge, so it is
// always a whole 2.0 fence panel and never needs cutting, which is the reason
// DESIGN.md gives for the lattice in the first place. A corridor is a union of
// squares, so "does this prop intrude into a corridor" is a prop against a few
// squares and nothing more. And the navigation graph is the path tiles with
// their centres as nodes, 2.0 apart, which is what the design asks for: nodes
// at lattice intersections, edges the 2.0 segments between them.
//
// Grid coordinates are centred on the origin, because the scene's camera looks
// at it: tile (a, b) has its centre at U(a), V(b) and its corners half a tile
// away. u runs across the screen, v runs up it. See frame.js.

export const TILE = 2.0;        // the lattice, the corridor width, a panel
export const HALF = TILE / 2;
export const BLOCK = 3;         // tiles per block: one corridor, two of cell
export const CELL = 4.0;        // clear ground inside one cell

export const PATH = 1;
export const PLOT = 0;

export function createTiles(cellsX, cellsZ) {
  const tw = BLOCK * cellsX + 1;
  const th = BLOCK * cellsZ + 1;
  const map = new Uint8Array(tw * th);
  // Start with every corridor open. Closing them is maze.js's business.
  for (let b = 0; b < th; b++) {
    for (let a = 0; a < tw; a++) {
      if (a % BLOCK === 0 || b % BLOCK === 0) map[b * tw + a] = PATH;
    }
  }
  const originU = tw - 1;
  const originV = th - 1;
  return {
    cellsX, cellsZ, tw, th, map,
    // Tile centre in grid units.
    U: (a) => TILE * a - originU,
    V: (b) => TILE * b - originV,
    // And back, for a checker that only has world coordinates.
    A: (u) => Math.round((u + originU) / TILE),
    B: (v) => Math.round((v + originV) / TILE),
    at: (a, b) => (a < 0 || b < 0 || a >= tw || b >= th ? PLOT : map[b * tw + a]),
    set: (a, b, value) => { map[b * tw + a] = value; },
    isPath: (a, b) => (a < 0 || b < 0 || a >= tw || b >= th ? false : map[b * tw + a] === PATH),
    bounds: {
      minU: -originU - HALF, maxU: originU + HALF,
      minV: -originV - HALF, maxV: originV + HALF,
    },
  };
}

// Tiles of one cell, and where its clear ground is. Cell (i, j) is the 2 by 2
// block of plot tiles between the corridors, so its tiles are the two columns
// after corridor column 3i and the two rows after corridor row 3j.
export function cellTiles(i, j) {
  const a0 = BLOCK * i + 1;
  const b0 = BLOCK * j + 1;
  return [[a0, b0], [a0 + 1, b0], [a0, b0 + 1], [a0 + 1, b0 + 1]];
}

export function cellCentre(tiles, i, j) {
  const a0 = BLOCK * i + 1;
  const b0 = BLOCK * j + 1;
  return { u: (tiles.U(a0) + tiles.U(a0 + 1)) / 2, v: (tiles.V(b0) + tiles.V(b0 + 1)) / 2 };
}

// The two tiles a rib occupies. A rib is the stretch of corridor between two
// junctions: `h` runs across the screen along corridor row 3j, `v` runs up it
// along corridor column 3i.
export function ribTiles(dir, i, j) {
  return dir === 'h'
    ? [[BLOCK * i + 1, BLOCK * j], [BLOCK * i + 2, BLOCK * j]]
    : [[BLOCK * i, BLOCK * j + 1], [BLOCK * i, BLOCK * j + 2]];
}

export default createTiles;
