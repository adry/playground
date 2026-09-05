// The layout package, in one import.
//
//   import { createLayout } from './game/layout/index.js';
//   const level = createLayout({ seed: 7, cells: [7, 5] });
//
// Nothing in here imports three or touches a canvas, so a level can be built,
// checked and drawn in node. See layout.js for the order a level is built in
// and DESIGN.md for what the fields mean.

export { createLayout, default } from './layout.js';
export { makeFrame, OCCLUSION, CAM_DIR, K } from './frame.js';
export { footprintOf, boundingRadius, STONES, PUMPKINS, LANTERNS, BUSHES, MISC } from './footprints.js';
export { gap, clears, gapToSquare } from './geom.js';
export { PROP_MARGIN, CORRIDOR_MARGIN } from './place.js';
export { GATE } from './gate.js';
export { sheet, drawLayout, toPNG, createSurface } from './plot.js';
