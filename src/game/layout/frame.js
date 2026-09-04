// The one place that knows how a level's own coordinates become world ones,
// and what the fixed camera does to them.
//
// The generator works in GRID space: u runs across the screen, v runs up it,
// both in world units, both axis aligned, both on the 2.0 lattice. World space
// is the same plane turned 45 degrees, because the scene's camera looks down
// (1, 0.78, 1) and src/ghost/main.js already lays its fence plots out in screen
// units for exactly this reason: a panel turned PI/4 runs ACROSS the screen, so
// a maze built on the world axes comes out as a field of diamonds and a maze
// built on the screen axes comes out as a maze.
//
// The isometry is main.js's own atScreen(), written the other way round:
//
//     x = (u - v) / sqrt(2)          u = (x - z) / sqrt(2)
//     z = -(u + v) / sqrt(2)         v = -(x + z) / sqrt(2)
//
// Two facts fall out of it and both are used everywhere below.
//
//   1. SCREEN ACROSS is u exactly. Two props hide each other only if their u
//      ranges overlap, and that test needs no trigonometry.
//   2. SCREEN DEPTH is x + z = -sqrt(2) v. Bigger x + z is NEARER the camera,
//      so smaller v is nearer. "In front of" means "at lower v".
//
// A caller who wants the level on the world axes instead passes frame: 'axis'
// and gets the identity. Everything downstream is metric, so nothing else in
// the package changes.

export const K = Math.SQRT1_2;

// src/ghost/main.js: CAM_DIR = (1, 0.78, 1) normalised. The horizontal part has
// length sqrt(2), so the camera sits atan(0.78 / sqrt(2)) = 28.9 degrees above
// the horizon.
export const CAM_DIR = { x: 1, y: 0.78, z: 1 };
export const CAM_ELEV = Math.atan2(CAM_DIR.y, Math.SQRT2);

// Apparent height lost per unit of x + z, i.e. how much shorter a prop has to
// be to hide behind one standing a unit further from the camera. It is
// tan(elev) / sqrt(2) = 0.78 / 2, and it is the whole of placement rule 5:
// a prop at depth d1 fully hides one at depth d2 < d1 when
//
//     height1 >= height2 + (d1 - d2) * OCCLUSION
//
// In the screen frame d1 - d2 works out as sqrt(2) * (v2 - v1), so a stone one
// unit further down the screen may be 0.55 taller before it swallows the one
// behind it. The test itself is always done in world x + z, never in v: the
// grid's axes are the camera's only in the screen frame.
export const OCCLUSION = CAM_DIR.y / 2;

export function makeFrame(kind = 'screen') {
  if (kind === 'axis') {
    return {
      kind,
      toWorld: (u, v) => ({ x: u, z: v }),
      toGrid: (x, z) => ({ u: x, v: z }),
      // Local +Z is the face of a headstone, a bench and a shed door alike, so
      // a prop facing grid direction (du, dv) wants this yaw.
      yawFor: (du, dv) => Math.atan2(du, dv),
      depth: (x, z) => x + z,
      across: (x, z) => x - z,
    };
  }
  return {
    kind: 'screen',
    toWorld: (u, v) => ({ x: (u - v) * K, z: -(u + v) * K }),
    toGrid: (x, z) => ({ u: (x - z) * K, v: -(x + z) * K }),
    // (0, -1), screen down and toward the camera, comes out as PI/4, which is
    // the yaw every stone in main.js is authored at.
    yawFor: (du, dv) => Math.atan2((du - dv) * K, -(du + dv) * K),
    depth: (x, z) => x + z,
    across: (x, z) => (x - z) * K,
  };
}

export default makeFrame;
