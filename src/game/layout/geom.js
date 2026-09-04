// The three shape tests the placement rules need, and nothing else.
//
// Rule 1 says two props are clear when the distance between their centres
// exceeds the sum of their radii plus 0.15, and that the hole and the ledger
// get a box test instead. That is two rules, so this file has both and picks by
// shape: disc against disc is the circle test, and anything with a face is an
// oriented box. A grave hole and the spoil heap beside it are 1.9 apart on the
// circle test and 0.6 apart in truth, so without the box test rule 4 cannot be
// obeyed at all.
//
// Separation, not overlap. Everything here answers "is there at least `margin`
// of daylight between these two", because that is the question every caller
// asks and because it makes the conservative direction the safe one.

// Distance between an axis-aligned box centred at the origin and a point.
function pointBoxDistance(px, pz, halfU, halfV) {
  const dx = Math.max(Math.abs(px) - halfU, 0);
  const dz = Math.max(Math.abs(pz) - halfV, 0);
  return Math.hypot(dx, dz);
}

// A shape is { shape, x, z, yaw, r | halfU, halfV } in whatever frame the
// caller is working in. Grid or world, it does not matter: every test here is
// an isometry away from every other.
export function discBox(disc, box) {
  const c = Math.cos(box.yaw || 0);
  const s = Math.sin(box.yaw || 0);
  const dx = disc.x - box.x;
  const dz = disc.z - box.z;
  // Into the box's own frame. Local +X is (cos, -sin) in a three.js yaw, so the
  // inverse rotation is this one.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return pointBoxDistance(lx, lz, box.halfU, box.halfV) - disc.r;
}

// Separating-axis gap between two oriented boxes: the largest gap over the four
// face normals. Positive means disjoint by at least that much, since a gap
// between two projections is a lower bound on the distance between the sets.
// Negative is a real overlap. It underestimates the true distance for two boxes
// meeting corner to corner, which is the direction that keeps props apart
// rather than the one that lets them collide.
export function boxBox(a, b) {
  let best = -Infinity;
  for (const [box, other] of [[a, b], [b, a]]) {
    const c = Math.cos(box.yaw || 0);
    const s = Math.sin(box.yaw || 0);
    // The box's own axes, in the shared frame.
    const axes = [{ x: c, z: -s }, { x: s, z: c }];
    const halves = [box.halfU, box.halfV];
    const oc = Math.cos(other.yaw || 0);
    const os = Math.sin(other.yaw || 0);
    const oAxes = [{ x: oc, z: -os }, { x: os, z: oc }];
    const oHalves = [other.halfU, other.halfV];
    for (let k = 0; k < 2; k++) {
      const ax = axes[k];
      const centre = Math.abs((other.x - box.x) * ax.x + (other.z - box.z) * ax.z);
      let reach = 0;
      for (let m = 0; m < 2; m++) {
        reach += oHalves[m] * Math.abs(oAxes[m].x * ax.x + oAxes[m].z * ax.z);
      }
      best = Math.max(best, centre - halves[k] - reach);
    }
  }
  return best;
}

// The gap between any two footprints. Negative means they intersect.
export function gap(a, b) {
  if (a.shape === 'disc' && b.shape === 'disc') {
    return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  }
  if (a.shape === 'disc') return discBox(a, b);
  if (b.shape === 'disc') return discBox(b, a);
  return boxBox(a, b);
}

export function clears(a, b, margin) {
  return gap(a, b) >= margin;
}

// A shape against an axis-aligned square, which is how every corridor tile is
// tested. Written out rather than routed through gap() with a yaw of zero,
// because it runs a few million times in the overnight check.
export function gapToSquare(shape, cx, cz, half) {
  if (shape.shape === 'disc') {
    return pointBoxDistance(shape.x - cx, shape.z - cz, half, half) - shape.r;
  }
  return boxBox(shape, { x: cx, z: cz, yaw: 0, halfU: half, halfV: half });
}

export default gap;
