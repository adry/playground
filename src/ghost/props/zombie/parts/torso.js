import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { gridSurface, ribbon, tube, ball, limb, put, v, smoothstep } from './skin.js';

// The trunk, and the hardest thing on the model: the EXPOSED RIBCAGE.
//
// --- how the cavity is built --------------------------------------------------
//
// The brief allows no alpha anywhere, which rules out the usual answer (a card
// with a hole painted in it). The opening therefore has to be a real hole in a
// real solid, and you have to be able to see other geometry through it from
// every angle the fixed camera can show. It is four layers, front to back:
//
//   1. THE SKIN SHELL, a closed parametric surface round the chest, with the
//      quads inside the window genuinely omitted. Not scaled to zero, not
//      pushed inward: absent. Look at the chest edge-on and there is nothing
//      there.
//
//   2. THE LIP, a ribbon swept along the window's true outline. This exists
//      because a quad grid can only cut on its own cell boundaries, so the
//      hole in layer 1 is a staircase; the lip is placed analytically, made a
//      little larger than the cut, and covers it. It also does the job the
//      opening needs done anyway: it runs from slightly proud of the skin,
//      inward and backward to the flesh, so the body wall has a visible
//      thickness. That thickness is the single strongest cue that this is a
//      hole through something and not a decal on it.
//
//   3. THE FLESH, a closed dark red column down the middle of the chest at
//      M.cavity.floor of the shell radius. It is closed all the way round
//      rather than being a backdrop panel, so no camera angle and no amount of
//      spine bend can ever see past it into an empty torso.
//
//   4. THE RIBS AND THE SPINE, standing in the gap between 3 and 1. Three rib
//      pairs at M.cavity.ribFront of the shell radius, and the spine running
//      down the centre BEHIND them at the flesh radius, so its top knobs show
//      through the rib gaps. Two depths of geometry inside the opening is what
//      makes it read as a cavity rather than as a striped patch.
//
// --- why the trunk is three overlapping blocks --------------------------------
//
// spineLower and spineUpper are real joints, so a single trunk mesh would tear
// the moment either of them moved. The trunk is therefore three closed blocks,
// one per segment, that INTERPENETRATE at the seams rather than meeting at
// them: pelvis on `root`, belly on `spineLower`, chest on `spineUpper`. This is
// the skeleton's vertebra rule ("consecutive vertebrae must overlap, not
// touch") applied to a soft body, and it is why bending this figure double
// does not open a gap at the waist.
//
// The seam heights are not free. The belly block's top has to sit BELOW
// M.y.cavityBottom, or the belly pokes up inside the chest cavity and you see
// green skin where the flesh should be. That constraint is what sets
// cavityBottom, not the other way round.

const PELVIS = { lo: M.y.hip - 0.047 * M.height, hi: 0.448 * M.height };
const BELLY = { lo: 0.408 * M.height, hi: 0.462 * M.height };
const CHEST = { lo: 0.432 * M.height, hi: 0.652 * M.height };

const U_FRONT = 0.25;   // the u at which the surface faces +Z

// The trunk's half-width and half-depth at a world height. One profile for the
// whole trunk, sampled by all three blocks, so the blocks are slices of one
// shape and the seams are invisible even before they overlap.
function profile(y) {
  const keys = [
    [M.y.hip - 0.06 * M.height, M.torso.pelvisWidth * 0.44, M.torso.pelvisDepth * 0.46],
    [M.y.hip, M.torso.pelvisWidth / 2, M.torso.pelvisDepth / 2],
    [M.y.pelvisTop, M.torso.pelvisWidth / 2 * 0.98, M.torso.pelvisDepth / 2 * 0.97],
    [M.y.waist, M.torso.waistWidth / 2, M.torso.waistDepth / 2],
    [M.y.chest, M.torso.chestWidth / 2, M.torso.chestDepth / 2],
    [M.y.shoulderTop, M.torso.chestWidth / 2 * 1.03, M.torso.chestDepth / 2 * 0.93],
    [M.y.shoulderTop + 0.05 * M.height, M.torso.chestWidth * 0.40, M.torso.chestDepth * 0.38],
  ];
  if (y <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (y <= keys[i][0]) {
      const t = (y - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      const s = t * t * (3 - 2 * t);
      return [
        keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * s,
        keys[i - 1][2] + (keys[i][2] - keys[i - 1][2]) * s,
      ];
    }
  }
  return [keys[keys.length - 1][1], keys[keys.length - 1][2]];
}

// A block of trunk between two heights, rounded off at both ends so it is a
// closed solid. `k` scales the radius, which is how the flesh column reuses
// exactly the same section as the skin.
function blockPoint(lo, hi, u, vv, kx = 1, capFrac = 0.09, kz = null) {
  const y = lo + (hi - lo) * vv;
  const [hw, hd] = profile(y);
  let cap = 1;
  if (vv < capFrac) cap = Math.sqrt(Math.max(0, 1 - Math.pow((capFrac - vv) / capFrac, 2)));
  else if (vv > 1 - capFrac) cap = Math.sqrt(Math.max(0, 1 - Math.pow((vv - (1 - capFrac)) / capFrac, 2)));
  const a = u * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(a) * hw * kx * cap,
    y,
    Math.sin(a) * hd * (kz === null ? kx : kz) * cap,
  );
}

const uHalfOf = (rad) => rad / (Math.PI * 2);

export function buildTorso({ materials }) {
  const group = new THREE.Group();          // origin at M.y.hip, parents to root
  group.userData.outwardX = LEFT_X;

  // --- joint chain. Each is identity at rest, positioned in its parent's space.
  const spineLower = new THREE.Object3D();
  spineLower.position.y = M.y.waist - M.y.hip;
  group.add(spineLower);

  const spineUpper = new THREE.Object3D();
  spineUpper.position.y = M.y.chest - M.y.waist;
  spineLower.add(spineUpper);

  const neck = new THREE.Object3D();
  neck.position.y = M.y.neck - M.y.chest;
  spineUpper.add(neck);

  const atlas = new THREE.Object3D();       // the head parents here
  atlas.position.y = M.y.atlas - M.y.neck;
  neck.add(atlas);

  const shoulderL = new THREE.Object3D();
  shoulderL.position.set(LEFT_X * M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderL);
  const shoulderR = new THREE.Object3D();
  shoulderR.position.set(-LEFT_X * M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderR);

  // Local frames: each block is authored in world heights and then shifted
  // into its owner's space, so every number above stays a landmark height.
  const inRoot = new THREE.Group();
  inRoot.position.y = -M.y.hip;
  group.add(inRoot);
  const inLower = new THREE.Group();
  inLower.position.y = -M.y.waist;
  spineLower.add(inLower);
  const inUpper = new THREE.Group();
  inUpper.position.y = -M.y.chest;
  spineUpper.add(inUpper);
  const inNeck = new THREE.Group();
  inNeck.position.y = -M.y.neck;
  neck.add(inNeck);

  // --- 1. pelvis and belly, plain closed blocks ---------------------------
  put(inRoot, gridSurface({
    uSteps: 30, vSteps: 18, closedU: true,
    point: (u, vv) => blockPoint(PELVIS.lo, PELVIS.hi, u, vv, 1, 0.14),
  }).geometry, materials.skin);

  put(inLower, gridSurface({
    uSteps: 28, vSteps: 10, closedU: true,
    point: (u, vv) => blockPoint(BELLY.lo, BELLY.hi, u, vv, 1.0, 0.20),
  }).geometry, materials.skin);

  // --- 2. the chest, with the window cut out ------------------------------
  const uHalf = uHalfOf(M.cavity.halfAngle);
  const vOfY = (y) => (y - CHEST.lo) / (CHEST.hi - CHEST.lo);
  const vLo = vOfY(M.y.cavityBottom);
  const vHi = vOfY(M.y.cavityTop);

  // The window's outline is a ROUNDED rectangle, not a rectangle. A square
  // corner on an opening in flesh reads as a machined panel; the corner radius
  // is what makes it read as torn away. `windowR` is 1 exactly on the outline,
  // and the cut, the lip and nothing else all use it, so they cannot disagree.
  const CORNER = 3.2;
  const windowR = (u, vv) => {
    const du = (((u - U_FRONT + 1.5) % 1) - 0.5) / uHalf;
    const dv = (vv - (vLo + vHi) / 2) / ((vHi - vLo) / 2);
    return Math.pow(Math.pow(Math.abs(du), CORNER) + Math.pow(Math.abs(dv), CORNER), 1 / CORNER);
  };

  // The cut is a little smaller than the true outline all round, so the lip
  // ribbon that follows the true outline covers the staircase it leaves.
  put(inUpper, gridSurface({
    uSteps: 64, vSteps: 30, closedU: true,
    point: (u, vv) => blockPoint(CHEST.lo, CHEST.hi, u, vv),
    // The hole is cut a little LARGER than the lip's outline, not smaller, so
    // the lip's outer flange lies over the cut edge. Cut smaller and the
    // shell's staircase stands proud of the lip and you see every step of it.
    keepQuad: (u, vv) => windowR(u, vv) > 1.10,
  }).geometry, materials.skin);

  // --- 3. the lip ---------------------------------------------------------
  //
  // Frames along the true window outline. `t` is the in-surface direction
  // pointing OUT of the hole and `n` the outward surface normal, both found by
  // finite difference on the same block function, so the lip cannot drift off
  // the surface it is supposed to be sitting in.
  {
    const frames = [];
    const N = 76;
    const eps = 1e-3;
    const corner = 0.16;   // fraction of each side spent rounding the corners
    for (let i = 0; i < N; i++) {
      // Walk a rounded rectangle in (u, v) space.
      const t = i / N;
      let du, dv;
      const box = (s) => {
        // s in 0..1 round a unit superellipse with the same corner radius the
        // cut above used, so the lip lands exactly on the edge of the hole.
        const a = s * Math.PI * 2;
        const cx = Math.cos(a), cy = Math.sin(a);
        const k = Math.pow(Math.pow(Math.abs(cx), CORNER) + Math.pow(Math.abs(cy), CORNER), -1 / CORNER);
        return [cx * k, cy * k];
      };
      [du, dv] = box(t);
      const u = U_FRONT + du * uHalf;
      const vv = (vLo + vHi) / 2 + dv * (vHi - vLo) / 2;
      const p = blockPoint(CHEST.lo, CHEST.hi, u, vv);
      const pu = blockPoint(CHEST.lo, CHEST.hi, u + eps, vv).sub(p);
      const pv = blockPoint(CHEST.lo, CHEST.hi, u, vv + eps).sub(p);
      const n = new THREE.Vector3().crossVectors(pv, pu).normalize();
      if (n.dot(new THREE.Vector3(p.x, 0, p.z)) < 0) n.negate();
      // Outward in the surface, away from the hole's centre.
      const tan = new THREE.Vector3()
        .addScaledVector(pu.normalize(), du)
        .addScaledVector(pv.normalize(), dv)
        .normalize();
      frames.push({ p, t: tan, n });
    }
    // The profile: proud of the skin at the outside, then a steep roll inward
    // and back to the flesh. The last point lands at the flesh radius, so the
    // lip and the flesh column meet rather than leaving a slot to see through.
    const wall = M.torso.shellThickness;
    const back = M.torso.chestDepth / 2 * (1 - M.cavity.floorZ);
    put(inUpper, ribbon(frames, [
      { t: wall * 1.75, n: -wall * 0.14 },  // tucked under the skin, outside the cut
      { t: wall * 0.50, n: wall * 0.30 },   // the proud torn edge
      { t: -wall * 0.10, n: -wall * 0.30 },
      { t: -wall * 0.55, n: -back * 0.55 },
      { t: -wall * 1.00, n: -back * 1.15 },
    ]), materials.flesh);
  }

  // --- 4. the flesh column, closed all the way round ----------------------
  put(inUpper, gridSurface({
    uSteps: 26, vSteps: 14, closedU: true,
    point: (u, vv) => blockPoint(
      M.y.cavityBottom - 0.030 * M.height,
      M.y.cavityTop + 0.020 * M.height,
      u, vv, M.cavity.floorX, 0.16, M.cavity.floorZ,
    ),
  }).geometry, materials.flesh);

  // --- 5. the ribs --------------------------------------------------------
  //
  // Each rib is one arc crossing the whole opening and buried in the skin at
  // both ends, rather than two half ribs meeting at a sternum. At this size a
  // sternum is one more pale vertical bar and it fights the spine behind it;
  // what you want is three clean horizontals.
  const shed = new Map();
  for (let k = 0; k < M.cavity.ribPairs; k++) {
    const y = M.cavity.ribTop - k * M.cavity.ribSpacing;
    const [hw, hd] = profile(y);
    const reach = M.cavity.halfAngle + 0.30;      // past the lip, into the skin
    const pts = [];
    const STEPS = 14;
    for (let i = 0; i <= STEPS; i++) {
      const a = Math.PI / 2 + (i / STEPS - 0.5) * 2 * reach;
      // Ribs are shallower than the skin at the front and meet it at the sides,
      // which is what makes them sit INSIDE the cavity rather than on it.
      // The ends stop at 0.86 of the shell rather than reaching 1.0. At 1.0 the
      // tube's CENTRE line lies on the skin, so half of every rib sits outside
      // the body and the three of them read as fat pale sausages strapped
      // across the chest, which is what the first pass looked like.
      const inset = M.cavity.ribFront + (0.86 - M.cavity.ribFront) *
        smoothstep(M.cavity.halfAngle * 0.72, reach, Math.abs(a - Math.PI / 2));
      // and they droop forward and down, as real ribs do.
      const droop = 0.12 * M.cavity.ribSpacing *
        (1 - Math.pow(Math.abs(a - Math.PI / 2) / reach, 2));
      pts.push(new THREE.Vector3(Math.cos(a) * hw * inset, y - droop, Math.sin(a) * hd * inset));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = tube(curve, M.cavity.ribRadius, M.cavity.ribRadius, { radial: 8, segments: 22 });
    const m = put(inUpper, g, materials.bone);
    m.name = `rib${k}`;
  }

  // Two of the ribs are marked shed-safe. A rib that leaves this cavity does
  // not open a hole in the silhouette, because what is behind it is the flesh
  // column, which is exactly what the gap between two ribs already shows. The
  // names match the skeleton's so the same shed plan drives both figures.
  {
    const meshes = [];
    inUpper.traverse((o) => { if (o.isMesh && o.name?.startsWith('rib')) meshes.push(o); });
    if (meshes[0]) shed.set('ribL3', meshes[0]);
    if (meshes[2]) shed.set('ribR4', meshes[2]);
  }

  // --- 6. the spine, behind the ribs --------------------------------------
  for (let k = 0; k < M.cavity.spineKnobs; k++) {
    const y = M.cavity.spineTop - k * M.cavity.spineSpacing;
    const [, hd] = profile(y);
    const r = M.cavity.spineRadius * (k < 2 ? 0.82 : 1.0);
    // BEHIND the ribs, not level with them. Sitting them at the ribs' own
    // depth put the knobs in front of the bars and the cavity flattened into
    // one plane of pale shapes; a tenth of the chest's depth further back is
    // enough that the top ones read as glimpsed THROUGH the rib gaps, which is
    // the whole reason the spine is in there.
    put(inUpper, ball(r, r * 0.62, r * 0.75, 12), materials.bone, {
      pos: v(0, y, hd * (M.cavity.floorZ + 0.12)),
    });
  }

  // --- 7. the neck stub ---------------------------------------------------
  // Almost nothing, which is the point: see the note under M.neck. It exists
  // so a head turn does not reveal a gap between skull and shoulders.
  put(inNeck, limb(
    v(0, M.y.neck - M.neck.length * 1.6, -0.004 * M.height),
    v(0, M.y.neck + M.neck.length * 1.4, 0),
    M.neck.radius * 1.02, M.neck.radius * 0.94,
    { radial: 16, segments: 5, waist: 0.96 },
  ), materials.skin);

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });

  return {
    group,
    joints: { spineLower, spineUpper, neck },
    anchors: { atlas, shoulderL, shoulderR },
    frames: { inUpper, inRoot },
    shed,
    dispose() { for (const g of geometries) g.dispose(); },
  };
}

export { profile as trunkProfile, CHEST as CHEST_SPAN, PELVIS as PELVIS_SPAN };
