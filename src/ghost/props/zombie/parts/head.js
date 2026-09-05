import * as THREE from 'three';
import M from '../metrics.js';
import { mesh, gridSurface, softBox, ball, limb, put, v, smoothstep } from './skin.js';

// The head. A third of the whole figure, so it is the character: everything
// else on this model is supporting cast.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE. The camera is fixed and
// orthographic, there is no environment map, and the head is 34 px tall in a
// shipped frame. A smooth ball under one key light has exactly one terminator
// across it and no silhouette change as it turns, so it reads as a flat disc.
// Shading is what carries a prop in this scene, and shading needs FORM.
//
// So the ball is not a ball. Five things break it up, and every one of them is
// low-frequency enough to survive being 34 px tall:
//
//   1. a brow shelf standing proud over the sockets, which throws the sockets
//      into shadow from the key light no matter which way the head turns;
//   2. two deep sockets, a quarter of the head's height, with steep walls;
//   3. a flattened occiput, so the three-quarter silhouette is not a circle;
//   4. a jaw that tapers below the cheek, so the lower half of the head is a
//      different width from the upper half;
//   5. a soft ridge from between the brows down to the mouth, which gives the
//      centre of the face a highlight to sit on.
//
// Everything is one continuous surface with the features displaced INTO it,
// rather than parts stuck onto it, because a bump stuck onto a vinyl toy reads
// as a bump stuck onto a vinyl toy.
//
// THE GRID IS NOT UNIFORM. `uAt`/`vAt` push more than twice the sample density
// onto the face than onto the back of the cranium. A uniform grid dense enough
// to cut a crisp socket wall is dense enough to model the occiput four times
// over, and the occiput is a smooth dome that needs none of it.

// Head-local space: the origin is the ATLAS, the head's pivot, so this whole
// group can be parented to the neck and rotated with no offset to remember.
const CROWN = M.y.crown - M.y.atlas;
const CHIN = M.y.chin - M.y.atlas;
const CENTRE_Y = (CROWN + CHIN) / 2;
const RY = (CROWN - CHIN) / 2;
const RX = M.head.width / 2;
const RZ = M.head.depth / 2;

const BROW_Y = M.y.brow - M.y.atlas;
const GRIN_Y = M.y.grin - M.y.atlas;
const EAR_Y = M.y.ear - M.y.atlas;
const HINGE_Y = M.y.jawHinge - M.y.atlas;

const SOCK_X = M.socket.separation / 2;
const SOCK_HW = M.socket.width / 2;
const SOCK_HH = M.socket.height / 2;
const GRIN_HW = M.grin.width / 2;
const GRIN_HH = M.grin.height / 2;

// Where the mandible cap's recess ends, in head-local y. The cap runs from
// just under the mouth down over the chin.
const CHIN_RECESS_Y = CHIN + M.head.height * 0.115;

// Concentrate grid samples near `at`. The derivative is 1 - k cos(2 pi (t-at)),
// so k = 0.55 puts 2.2x the samples on the face.
const concentrate = (t, at, k) => t - (k / (2 * Math.PI)) * Math.sin(2 * Math.PI * (t - at));

// v is NOT periodic: it runs pole to pole. The raw warp above shifts both ends,
// which pushed v past 1 at the crown and folded the mesh back over the top pole
// as a dark disc. Subtracting the value at t = 0 pins both ends exactly,
// because concentrate(1) - concentrate(0) is identically 1.
const vWarp = (t, at, k) => concentrate(t, at, k) - concentrate(0, at, k);

const U_FRONT = 0.25;       // azimuth u at which the surface faces +Z
// Where the extra v samples land, chosen so that after the pinning above the
// dense band comes out at v = 0.42, between the sockets and the grin.
const V_FACE = 0.445;

// --- the surface -------------------------------------------------------------
//
// One function, called with the features switched on or off. The mandible cap
// is built from the SAME function with the mouth recess turned off, which is
// what guarantees the cap sits flush in the recess it fills: it is literally
// the piece of head that was carved away, put back.

function unitDir(u, vv) {
  const a = u * Math.PI * 2;
  const b = (vv - 0.5) * Math.PI;
  const cb = Math.cos(b);
  return new THREE.Vector3(cb * Math.cos(a), Math.sin(b), cb * Math.sin(a));
}

function surfacePoint(u, vv, { mouth = true, sockets = true } = {}) {
  const d = unitDir(u, vv);

  // --- 3. flattened occiput. Only the back, and only the outer part of it,
  // so the sides keep their round.
  const backK = d.z < 0 ? Math.pow(-d.z, 1.4) : 0;
  const rzHere = RZ * (1 - (1 - M.head.occiputFlat) * backK);

  // --- 4. jaw taper. Below the cheek line the head narrows in both x and z.
  const jawK = smoothstep(-0.10, -0.92, d.y);
  const taper = 1 - (1 - M.head.jawTaper) * jawK;

  const p = new THREE.Vector3(
    d.x * RX * taper,
    CENTRE_Y + d.y * RY,
    d.z * rzHere * taper,
  );

  // Outward normal of the base ellipsoid, close enough to displace along.
  const n = new THREE.Vector3(d.x / RX, d.y / RY, d.z / rzHere).normalize();
  const front = smoothstep(0.05, 0.45, d.z);   // 0 behind, 1 on the face

  // --- 1. the brow shelf. A band above the sockets, front only, that stands
  // proud. This is the single most valuable piece of form on the model: it is
  // what puts the sockets in shadow under a key light coming from above.
  {
    const dy = (p.y - (BROW_Y + SOCK_HH * 0.95)) / (M.head.height * 0.085);
    const band = Math.exp(-dy * dy);
    const across = smoothstep(RX * 1.05, RX * 0.35, Math.abs(p.x));
    p.addScaledVector(n, M.head.browJut * band * across * front);
  }

  // --- 5. the centre ridge, brows to mouth. Very shallow; it exists to give
  // the middle of the face a highlight so the two sockets do not read as two
  // holes in a plate.
  {
    const dy = (p.y - (BROW_Y - M.head.height * 0.10)) / (M.head.height * 0.20);
    const band = Math.exp(-dy * dy);
    const across = Math.exp(-Math.pow(p.x / (RX * 0.20), 2));
    p.addScaledVector(n, M.head.browJut * 0.55 * band * across * front);
  }

  // --- 2. the sockets. Deep, steep-walled, and EMPTY.
  //
  // The falloff runs 0.80 to 1.02 rather than 0 to 1, so four fifths of the
  // socket is at full depth and the wall is nearly vertical. A gentle dish
  // fills with bounce light and turns grey; this one holds its own shadow.
  if (sockets) {
    for (const side of [1, -1]) {
      const dx = p.x - side * SOCK_X;
      const dxIn = -side * dx;                       // positive toward the nose
      const dy = (p.y - BROW_Y) + M.socket.slant * dxIn;
      const r = Math.hypot(dx / SOCK_HW, dy / SOCK_HH);
      const k = 1 - smoothstep(0.80, 1.02, r);
      if (k > 0) p.addScaledVector(n, -M.socket.depth * k * front);
    }
  }

  // --- the mouth. A lipless slot: a lens-shaped trough whose corners rise,
  // continued downward as a shallower recess over the chin. The mandible cap
  // fills the lower part of that recess at rest and swings out of it when the
  // jaw opens.
  if (mouth) {
    const dx = p.x;
    const lift = M.grin.curve * GRIN_HH * Math.pow(Math.min(1, Math.abs(dx) / GRIN_HW), 2);
    const dy = p.y - (GRIN_Y + lift);
    const r = Math.hypot(dx / GRIN_HW, dy / GRIN_HH);
    const slot = 1 - smoothstep(0.72, 1.02, r);

    // the chin recess below it
    const below = smoothstep(GRIN_Y - GRIN_HH * 0.2, CHIN_RECESS_Y, p.y) *
                  (1 - smoothstep(GRIN_HW * 0.92, GRIN_HW * 1.25, Math.abs(dx)));
    const depth = Math.max(slot, below * 0.62);
    if (depth > 0) p.addScaledVector(n, -M.grin.depth * depth * front);
  }

  return p;
}

// The (u, v) of the point on the FRONT of the head nearest a given head-local
// (x, y). Derived from the base ellipsoid, which is close enough: everything
// that uses it then evaluates the real surface function there.
function frontUV(x, y) {
  const dy = Math.min(0.999, Math.max(-0.999, (y - CENTRE_Y) / RY));
  const dx = Math.min(0.999, Math.max(-0.999, x / RX));
  const dz = Math.sqrt(Math.max(1e-4, 1 - dx * dx - dy * dy));
  return [Math.atan2(dz, dx) / (Math.PI * 2), 0.5 + Math.asin(dy) / Math.PI];
}

// The outward normal of the real surface, by finite difference, so a feature
// pressed into the head is placed against the surface as built rather than
// against the ellipsoid it started as.
function surfaceNormal(u, vv, opts) {
  const e = 2e-3;
  const p = surfacePoint(u, vv, opts);
  const pu = surfacePoint(u + e, vv, opts).sub(p);
  const pv = surfacePoint(u, Math.min(1, vv + e), opts).sub(p);
  const n = new THREE.Vector3().crossVectors(pv, pu).normalize();
  const out = p.clone().sub(new THREE.Vector3(0, CENTRE_Y, 0));
  if (n.dot(out) < 0) n.negate();
  return n;
}

// The u at which the real surface reaches a given x on the front of the head,
// at a given height. Bisection, because the surface has a taper, a brow shelf
// and a mouth trough in it and there is no closed form.
function uForX(targetX, y) {
  let lo = U_FRONT, hi = U_FRONT + 0.245;
  const xAt = (u) => surfacePoint(u, vAtHeight(y), { mouth: true }).x;
  const sgn = Math.sign(targetX) || 1;
  if (sgn < 0) { lo = U_FRONT; hi = U_FRONT - 0.245; }
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(xAt(mid)) < Math.abs(targetX)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// The v value at which the surface is at a given head-local height, on the
// front centre line. Used to size the mandible patch.
function vAtHeight(y) {
  const s = Math.min(1, Math.max(-1, (y - CENTRE_Y) / RY));
  return 0.5 + Math.asin(s) / Math.PI;
}

// A two-sided patch of surface: an outer sheet, an inner sheet, and a rim
// stitched all the way round. Both sheets come from the same (u, v) patch, so
// they cannot drift apart at the edges.
function patchShell(uA, uB, vA, vB, uSteps, vSteps, outer, inner) {
  const pts = [];
  const at = (layer, i, j) => layer * (uSteps + 1) * (vSteps + 1) + i * (vSteps + 1) + j;
  for (const fn of [outer, inner]) {
    for (let i = 0; i <= uSteps; i++) {
      const u = uA + (uB - uA) * (i / uSteps);
      for (let j = 0; j <= vSteps; j++) {
        const vv = vA + (vB - vA) * (j / vSteps);
        pts.push(fn(u, vv));
      }
    }
  }
  const idx = [];
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      idx.push(at(0, i, j), at(0, i + 1, j), at(0, i + 1, j + 1));
      idx.push(at(0, i, j), at(0, i + 1, j + 1), at(0, i, j + 1));
      idx.push(at(1, i, j), at(1, i + 1, j + 1), at(1, i + 1, j));
      idx.push(at(1, i, j), at(1, i, j + 1), at(1, i + 1, j + 1));
    }
  }
  // rim, all four edges
  const edge = [];
  for (let i = 0; i <= uSteps; i++) edge.push([i, 0]);
  for (let j = 1; j <= vSteps; j++) edge.push([uSteps, j]);
  for (let i = uSteps - 1; i >= 0; i--) edge.push([i, vSteps]);
  for (let j = vSteps - 1; j >= 1; j--) edge.push([0, j]);
  for (let e = 0; e < edge.length; e++) {
    const [i0, j0] = edge[e];
    const [i1, j1] = edge[(e + 1) % edge.length];
    idx.push(at(0, i0, j0), at(1, i0, j0), at(1, i1, j1));
    idx.push(at(0, i0, j0), at(1, i1, j1), at(0, i1, j1));
  }
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, k) => { arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z; });
  return mesh(arr, idx);
}

// --- teeth --------------------------------------------------------------------
//
// Five up, four down, and the gaps are deliberate. Ten teeth in a 0.31 unit
// grin is 1.8 px each in a shipped frame and dithers into a grey band; five is
// five white blocks with black between them, which is what a grin actually is
// at this size. Uneven heights and a couple of missing ones do the rest.
function toothRow(parent, material, { count, gap, up, seed }) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const span = M.grin.width * 0.86;
  // Teeth are placed by AZIMUTH, not by a target x, and this is the bug the
  // first pass had. Solving for an x and then putting a block there works on
  // the middle of the face and fails at the corners of the grin, because the
  // head is tapering hard by then: the outer teeth were asked to sit at an x
  // the surface no longer reaches, and came out floating outside the jaw.
  const uEnd = uForX(span / 2, GRIN_Y);
  for (let i = 0; i < count; i++) {
    if (i === gap) continue;                        // a missing tooth
    const t = count === 1 ? 0.5 : i / (count - 1);
    const uu0 = U_FRONT + (t - 0.5) * 2 * (uEnd - U_FRONT);
    const x = surfacePoint(uu0, vAtHeight(GRIN_Y), { mouth: true }).x;
    const lift = M.grin.curve * GRIN_HH * Math.pow(Math.min(1, Math.abs(x) / GRIN_HW), 2);
    const w = (span / count) * (0.62 + rnd() * 0.20);
    const h = M.grin.height * (up ? 0.46 : 0.38) * (0.78 + rnd() * 0.42);
    const y = GRIN_Y + lift + (up ? 1 : -1) * (M.grin.height * 0.05 + h / 2);
    const uu = uu0;
    const vv = vAtHeight(y);
    const floor = surfacePoint(uu, vv, { mouth: true });
    const n = surfaceNormal(uu, vv, { mouth: true });
    const g = softBox(w, h, M.grin.depth * 1.15, { round: 0.42, uSteps: 8, vSteps: 6 });
    const m = put(parent, g, material, {
      pos: floor.clone().addScaledVector(n, M.grin.depth * 0.44),
    });
    m.quaternion.setFromUnitVectors(v(0, 0, 1), n);
    m.rotateZ((rnd() - 0.5) * 0.34);                // uneven
    m.rotateX((rnd() - 0.5) * 0.20);
  }
}

// --- stitches -----------------------------------------------------------------
//
// Short crossed lines, as real rods. There is no texture pipeline here and an
// alpha card has nothing to reflect, so a painted scar is not available.
//
// The length comes from LEGIBILITY, not from the reference: at 4.4 px a rod
// still reads as a line, and below that it is a speck. What actually carries
// the scar at game scale is the RHYTHM of three or four dark marks in a row,
// not any one of them, which is why the crosses are spaced rather than tight.
function stitchScar(parent, material, { from, to, count, thickness }) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  // The scar line itself, thin, laid along the surface.
  const g = limb(from, to, thickness * 0.55, thickness * 0.55, { radial: 6, segments: 4, waist: 1 });
  put(parent, g, material);
  // The crosses, alternating lean so the ladder reads as stitching.
  const side = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const c = from.clone().addScaledVector(dir, len * t);
    const lean = (i % 2 ? 1 : -1) * 0.42;
    const arm = new THREE.Vector3()
      .addScaledVector(side, M.stitch.length * 0.5)
      .addScaledVector(dir, M.stitch.length * 0.5 * lean);
    const a = c.clone().sub(arm);
    const b = c.clone().add(arm);
    // Push each cross out along the head normal so it sits on the skin.
    const push = c.clone().normalize().multiplyScalar(0.0);
    a.add(push); b.add(push);
    put(parent, limb(a, b, thickness, thickness, { radial: 6, segments: 3, waist: 1 }), material);
  }
}

// Lay a point on the head surface, then lift it out by `out`.
function onHead(u, vv, out = 0) {
  const p = surfacePoint(u, vv);
  return p.clone().add(p.clone().sub(v(0, CENTRE_Y, 0)).normalize().multiplyScalar(out));
}

// --- build --------------------------------------------------------------------

export function buildHead({ materials }) {
  const group = new THREE.Group();
  group.userData.outwardX = 1;

  const U = 88;
  const V = 56;

  // The shell. Non-uniform in both directions: dense across the face, dense
  // through the band that carries the sockets and the mouth.
  const shell = gridSurface({
    uSteps: U,
    vSteps: V,
    closedU: true,
    uAt: (i) => concentrate(i / U, U_FRONT, 0.55),
    vAt: (j) => vWarp(j / V, V_FACE, 0.45),
    point: (u, vv) => surfacePoint(u, vv),
  });
  put(group, shell.geometry, materials.skin);

  // The dark that lives in the sockets. The dent walls are skin, but the floor
  // has to be genuinely dark or the socket reads as a dimple.
  //
  // Each dark is a flattened ball seated ON the dent floor, found by asking the
  // surface function itself where that floor is rather than by guessing an
  // offset from the head's radius. Guessing is what put the first pass's darks
  // OUTSIDE the head, as two black bubbles on the face: the head at brow height
  // is not RZ deep, it is RZ times the cosine of the latitude times the jaw
  // taper, and the dent then takes another socket.depth out of it.
  for (const side of [1, -1]) {
    const [u0, v0] = frontUV(side * SOCK_X, BROW_Y);
    const floor = surfacePoint(u0, v0);
    const n = surfaceNormal(u0, v0);
    // Flat, and NOT turned to face along the normal. Turning it tilts the dark
    // outward with the cheek and the pair come out leaning like eyebrows,
    // which is the difference between a blank stare and a scowl. Flat also
    // kills the highlight: a curved dark ball catches a bright streak off the
    // hemisphere light and the socket stops looking empty.
    const half = M.socket.depth * 0.32;
    const g = ball(SOCK_HW * 0.94, SOCK_HH * 0.94, half, 16);
    put(group, g, materials.socket, {
      pos: floor.clone().addScaledVector(n, -half + M.head.height * 0.005),
    });
  }

  // The dark inside the mouth. Seated on the mouth trough's own floor, and
  // deep enough that when the jaw swings open there is a throat behind it
  // rather than a green wall.
  {
    const [u0, v0] = frontUV(0, GRIN_Y);
    const floor = surfacePoint(u0, v0);
    const n = surfaceNormal(u0, v0);
    const half = M.grin.depth * 1.10;
    const g = ball(GRIN_HW * 1.02, GRIN_HH * 1.45, half, 16);
    put(group, g, materials.socket, {
      pos: floor.clone().addScaledVector(n, -half + M.head.height * 0.005)
        .add(v(0, -GRIN_HH * 0.15, 0)),
    });
  }

  // Upper teeth ride on the cranium.
  toothRow(group, materials.tooth, { count: M.grin.teeth.upper, gap: M.grin.teeth.gapUpper, up: true, seed: 7 });

  // --- the jaw ------------------------------------------------------------
  //
  // Identity is CLOSED and POSITIVE rotation.x opens it, exactly as the
  // skeleton publishes. The figure faces +Z, so the chin is below and in front
  // of the hinge and a positive x rotation drops it; negative drives it up
  // through the cranium. The model publishes this on userData so an animator
  // can assert it instead of trusting this paragraph.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, HINGE_Y, M.head.jawHingeZ);
  group.add(jaw);

  // The cap: the piece of head the mouth recess carved away, put back. Built
  // from the same surface function with the mouth switched off, so its outer
  // face continues the cranium exactly, and with the mouth switched on for its
  // inner face, so it seats in the recess.
  {
    // vLo is clamped well clear of the bottom pole. The first pass let it run
    // to v = 0, where every u sample collapses onto one point, and the patch
    // came out as a fan of slivers that read as a shelf hanging off the chin.
    const vLo = Math.max(0.09, vAtHeight(CHIN_RECESS_Y - M.head.height * 0.045));
    const vHi = vAtHeight(GRIN_Y - GRIN_HH * 0.10);
    const uHalf = Math.abs(uForX(GRIN_HW * 1.10, (GRIN_Y + CHIN_RECESS_Y) / 2) - U_FRONT);
    const outer = (u, vv) => {
      const p = surfacePoint(u, vv, { mouth: false });
      return p.clone().add(p.clone().sub(v(0, CENTRE_Y, 0)).normalize().multiplyScalar(M.head.height * 0.004));
    };
    const inner = (u, vv) => surfacePoint(u, vv, { mouth: true });
    const cap = patchShell(U_FRONT - uHalf, U_FRONT + uHalf, vLo, vHi, 18, 10, outer, inner);
    cap.translate(0, -HINGE_Y, -M.head.jawHingeZ);
    put(jaw, cap, materials.skin);
  }

  // Lower teeth ride on the cap.
  const lower = new THREE.Group();
  lower.position.set(0, -HINGE_Y, -M.head.jawHingeZ);
  jaw.add(lower);
  toothRow(lower, materials.tooth, { count: M.grin.teeth.lower, gap: M.grin.teeth.gapLower, up: false, seed: 23 });

  // --- ears ---------------------------------------------------------------
  // Small and round, and pressed flat against the head. They matter less for
  // charm than for the three-quarter silhouette, where they are the only thing
  // breaking the outline of a very large smooth ball.
  for (const side of [1, -1]) {
    // Behind the equator, not on it. On the equator the ear catches the same
    // light as the face and, from the game's three-quarter camera, the dark
    // dimple in it reads as a third eye. Behind it, the ear is a silhouette
    // bump and nothing else, which is all it is for.
    const uEar = side > 0 ? -0.035 : 0.535;
    const p = onHead(uEar, vAtHeight(EAR_Y), -M.ear.radius * 0.30);
    const g = ball(M.ear.thickness, M.ear.radius, M.ear.radius * 0.80, 14);
    const m = put(group, g, materials.skin, { pos: p });
    m.rotation.z = side * 0.18;
    const inner = ball(M.ear.thickness * 0.42, M.ear.radius * 0.34, M.ear.radius * 0.30, 10);
    put(group, inner, materials.stitch, {
      pos: p.clone().add(v(side * M.ear.thickness * 0.42, -M.ear.radius * 0.04, -M.ear.radius * 0.04)),
    });
  }

  // --- stitched scars -------------------------------------------------------
  // Three across the forehead, two on the figure's LEFT cheek, which is +X.
  {
    const scars = new THREE.Group();
    group.add(scars);
    // Over the figure's LEFT brow rather than across the centre line. A scar
    // straight down the middle of a symmetrical face reads as a seam in the
    // moulding; off to one side it reads as damage.
    const foreheadV = vAtHeight(BROW_Y + M.head.height * 0.17);
    const a = onHead(U_FRONT + 0.020, foreheadV, M.stitch.thickness * 0.4);
    const b = onHead(U_FRONT + 0.088, vAtHeight(BROW_Y + M.head.height * 0.25), M.stitch.thickness * 0.4);
    stitchScar(scars, materials.stitch, { from: a, to: b, count: M.stitch.forehead, thickness: M.stitch.thickness });

    const cheekV = vAtHeight(BROW_Y - M.head.height * 0.22);
    const c = onHead(U_FRONT - 0.062, cheekV, M.stitch.thickness * 0.4);
    const d = onHead(U_FRONT - 0.098, vAtHeight(BROW_Y - M.head.height * 0.32), M.stitch.thickness * 0.4);
    stitchScar(scars, materials.stitch, { from: c, to: d, count: M.stitch.cheek, thickness: M.stitch.thickness });
  }

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });

  return {
    group,
    joints: { jaw },
    dispose() { for (const g of geometries) g.dispose(); },
  };
}

export { surfacePoint as headSurfacePoint, CENTRE_Y as HEAD_CENTRE_Y };
