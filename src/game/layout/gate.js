// The gate's numbers, copied off the gate rather than guessed at.
//
// fence/gate-controller.js publishes gateKeepOut(gate), but it wants a built
// gate: a three.js object with a world matrix on it. This package never builds
// a mesh, so it takes the two numbers that keep-out is made of straight from
// fence/gate.js's own GATE_LAYOUT, which is a plain object of constants and
// imports cleanly headless.
//
// sweepRadius is the leaf's REACH, and the region it forbids is the FULL disc
// about the hinge rather than a half moon, because the gate is double acting.
// hingeX is how far the pivot sits from the gate's own origin along the fence
// line, which is what places the disc relative to the prop.

import { GATE_LAYOUT } from '../../ghost/props/fence/gate.js';

export const GATE = {
  hingeX: GATE_LAYOUT.hingeX,
  sweepRadius: GATE_LAYOUT.sweepRadius,
  panel: GATE_LAYOUT.length,
};

export default GATE;
