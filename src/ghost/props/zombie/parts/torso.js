import * as THREE from 'three';
import M from '../metrics.js';
import {
  closedRadial, roundBoxR, grommet, ellipseOutline, ovoid, arcTube, limb,
  put, v3, mix, smoothstep, recentre, assertOutward, assertInsideRadial,
} from './forms.js';

// The trunk, and the open ribcage in it.
//
// THREE OVERLAPPING CLOSED BLOCKS, one per spine segment. POSTMORTEM 2.6: a
// single mesh spanning the spine tears the moment `spineLower` moves, and the
// skeleton's "consecutive vertebrae overlap, not touch" rule is the same rule
// applied to a soft body. Pelvis hangs off `root`, belly off `spineLower`,
// chest off `spineUpper`, and each overlaps its neighbour by enough that a
// 0.45 rad bend never opens a gap.
//
// The trunk is NARROW -- see the long note on `M.torso` -- because fault two
// of the three that killed the third pass was that the arms vanished into it.
//
// THE CHEST CAVITY is the one piece of the third pass the postmortem says to
// lift wholesale, and this is it, in the same four layers:
//
//   1. the chest block, with the window's quads GENUINELY OMITTED;
//   2. a lip that funnels from the outer skin down to the cavity floor, so the
//      opening has an honest edge with thickness -- and which, being cut
//      LARGER than the omitted region, covers the ragged edge a quad grid
//      always leaves. That is the trick, and it is the same trick the head's
//      orbital rims use;
//   3. the flesh: a dark closed column, ANISOTROPIC at 0.88 wide by 0.34 deep;
//   4. the ribs and the spine, standing in the gap between the two.
//
// The anisotropy is the number that was found the hard way. One uniform scale
// either leaves you seeing straight past the column at the sides of the window
// or brings it forward to meet the skin and kills the depth the ribs stand in.
//
// It is built with the same `grommet` the head's features use, against the
// chest block's own radius function, so the cavity inherits the same
// guarantee: the flesh column and the lip are at `R(dir) - sink` and cannot
// escape the body at any rotation.

const T = M.torso;
const C = M.cavity;

// Block geometry, in WORLD heights. Every block is star-shaped about its own
// centre so a grommet can be set into it.
const BLOCKS = {
  // The pelvis. Wider than the waist, because the shorts hang on it and a
  // chibi's hips are its widest lower landmark. It reaches from below the hip
  // joint up past the waist, so it overlaps the belly through a full bend.
  pelvis: { cy: 0.672, hh: 0.118, hw: T.pelvisWidth / 2, hd: T.pelvisDepth / 2, n: T.section },
  // The belly's TOP is not free: it has to sit below `M.y.cavityBottom` or it
  // pokes up inside the chest cavity and you see green where the flesh should
  // be. That constraint sets cavityBottom, not the other way round.
  belly: { cy: 0.766, hh: 0.062, hw: T.waistWidth / 2, hd: T.waistDepth / 2, n: T.section * 0.95 },
  chest: { cy: 0.960, hh: 0.172, hw: T.chestWidth / 2, hd: T.chestDepth / 2, n: T.section },
};

if (BLOCKS.belly.cy + BLOCKS.belly.hh > M.y.cavityBottom) {
  throw new Error('zombie/torso: the belly block reaches above M.y.cavityBottom and will show inside the chest cavity.');
}

// A block's radius function, with a taper so it narrows toward the waist and
// toward the shoulders instead of being a barrel.
function blockR(b, { taperDown = 0, taperUp = 0 } = {}) {
  const base = roundBoxR(b.hw, b.hh, b.hd, b.n);
  return (d) => base(d)
    * (1 - taperDown * smoothstep(-0.10, -0.98, d.y))
    * (1 - taperUp * smoothstep(0.10, 0.98, d.y));
}

// The radius of a block's surface at a given world height and azimuth. Solved
// rather than approximated, because the ribs have to stand at a known fraction
// of the way between the flesh column and the skin and "a known fraction" is
// only meaningful if both ends are measured the same way.
function radiusAt(R, cy, height, azimuth) {
  const h = height - cy;
  let lo = 1e-4, hi = 1.0;
  for (let k = 0; k < 40; k++) {
    const r = 0.5 * (lo + hi);
    const p = v3(Math.sin(azimuth) * r, h, Math.cos(azimuth) * r);
    const len = p.length();
    if (len < 1e-9) { lo = r; continue; }
    if (len < R(p.clone().divideScalar(len))) lo = r; else hi = r;
  }
  return 0.5 * (lo + hi);
}

// The trunk's outer radius at a world height and azimuth, so a garment can be
// cut to hang on the body it is actually worn over instead of guessing. The
// blocks overlap, so this takes the widest of whichever ones reach that height.
export function trunkRadius(y, azimuth) {
  let best = 0;
  const each = [
    [BLOCKS.pelvis, blockR(BLOCKS.pelvis, { taperDown: 0.14, taperUp: 0.16 })],
    [BLOCKS.belly, blockR(BLOCKS.belly, { taperDown: 0.06, taperUp: 0.10 })],
    [BLOCKS.chest, blockR(BLOCKS.chest, { taperDown: 0.20, taperUp: 0.12 })],
  ];
  for (const [b, R] of each) {
    if (y < b.cy - b.hh * 1.02 || y > b.cy + b.hh * 1.02) continue;
    best = Math.max(best, radiusAt(R, b.cy, y, azimuth));
  }
  return best;
}

export function buildTorso({ materials }) {
  const group = new THREE.Group();          // sits at `root`, i.e. y = M.y.hip
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const shed = new Map();

  // --- the joint chain --------------------------------------------------------
  // Every one identity at rest with world-aligned axes, and `model.js` checks
  // each against metrics.js REST to 1 mm.
  const spineLower = new THREE.Object3D();
  spineLower.position.y = M.y.waist - M.y.hip;
  group.add(spineLower);
  const spineUpper = new THREE.Object3D();
  spineUpper.position.y = M.y.chest - M.y.waist;
  spineLower.add(spineUpper);
  const neck = new THREE.Object3D();
  neck.position.y = M.y.neck - M.y.chest;
  spineUpper.add(neck);
  const atlas = new THREE.Object3D();
  atlas.position.y = M.y.atlas - M.y.neck;
  neck.add(atlas);

  const shoulderL = new THREE.Object3D();
  shoulderL.position.set(+M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderL);
  const shoulderR = new THREE.Object3D();
  shoulderR.position.set(-M.arm.shoulderSeparation / 2, M.y.shoulder - M.y.chest, 0);
  spineUpper.add(shoulderR);

  // Frames that undo an owner's offset, so a garment can be authored in world
  // heights and still ride the joint it hangs from.
  const inRoot = new THREE.Object3D();
  inRoot.position.y = -M.y.hip;
  group.add(inRoot);
  const inUpper = new THREE.Object3D();
  inUpper.position.y = -M.y.chest;
  spineUpper.add(inUpper);

  // --- pelvis and belly -------------------------------------------------------
  const pelvisR = blockR(BLOCKS.pelvis, { taperDown: 0.14, taperUp: 0.16 });
  const pelvis = track(closedRadial({ uSteps: 26, vSteps: 16, R: pelvisR }));
  pelvis.translate(0, BLOCKS.pelvis.cy - M.y.hip, 0);
  assertOutward(pelvis, v3(0, BLOCKS.pelvis.cy - M.y.hip, 0), 'pelvis');
  put(group, pelvis, materials.skin, { name: 'pelvis' });

  const bellyR = blockR(BLOCKS.belly, { taperDown: 0.06, taperUp: 0.10 });
  const belly = track(closedRadial({ uSteps: 24, vSteps: 14, R: bellyR }));
  belly.translate(0, BLOCKS.belly.cy - M.y.waist, 0);
  assertOutward(belly, v3(0, BLOCKS.belly.cy - M.y.waist, 0), 'belly');
  put(spineLower, belly, materials.skin, { name: 'belly' });

  // --- the chest and its cavity ----------------------------------------------
  const B = BLOCKS.chest;
  const chestR = blockR(B, { taperDown: 0.20, taperUp: 0.12 });
  const chestCentreLocal = v3(0, B.cy - M.y.chest, 0);

  // The window. Its azimuthal half-width is published (0.58 rad, 66 degrees of
  // the body's circumference) because it is what keeps the cavity open and
  // readable when the game's fixed three-quarter camera has the figure turned
  // away; the vertical half-extent is SOLVED so the window's top and bottom
  // land on `M.y.cavityTop` and `M.y.cavityBottom` rather than near them.
  const winCentre = 0.5 * (M.y.cavityTop + M.y.cavityBottom);
  const tilt = Math.atan2(winCentre - B.cy, B.hd);
  const axis = v3(0, Math.sin(tilt), Math.cos(tilt));

  // How much of the outline is actually OPEN. The rim band and the funnel
  // between them occupy everything from `RHO_OPEN` outward, so the hole a
  // viewer sees stops there -- and `M.y.cavityTop`, `M.y.cavityBottom` and
  // `C.halfAngle` describe THE HOLE, not the outline. Both extents are
  // therefore divided through by it. Sized to the outline instead, the window
  // came out a quarter small in both directions and the character's defining
  // feature was a thumbnail.
  // DISH_FROM is how much of the outline the funnel wall occupies. At 0.80 the
  // wall is a quarter of the opening's radius and reads as a thick pale collar
  // round a small hole; the window is the character's defining feature and the
  // lip should frame it, not crowd it.
  const RHO_IN = 0.94, DISH_FROM = 0.88;
  const RHO_OPEN = RHO_IN * DISH_FROM;

  const solveAy = () => {
    const want = 0.5 * (M.y.cavityTop - M.y.cavityBottom) + (winCentre - B.cy);
    const V = v3(0, Math.cos(tilt), -Math.sin(tilt));
    let lo = 0.05, hi = 1.45;
    for (let k = 0; k < 44; k++) {
      const a = 0.5 * (lo + hi);
      const d = axis.clone().multiplyScalar(Math.cos(a * RHO_OPEN))
        .addScaledVector(V, Math.sin(a * RHO_OPEN)).normalize();
      if (d.y * chestR(d) < want) lo = a; else hi = a;
    }
    return 0.5 * (lo + hi);
  };
  const ay = solveAy();
  const ax = C.halfAngle / RHO_OPEN;

  const cavity = grommet({
    R: chestR, axis, up: v3(0, 1, 0),
    outline: ellipseOutline(ax, ay),
    // The lip funnels in by the shell's own thickness AND STOPS. `dishFrom`
    // makes it an annulus with no floor, so the window is genuinely open and
    // what you see through it is the flesh column. Built with the default
    // closed dish it is a plate of skin at one shell-thickness of depth, which
    // caps the cavity shut -- the whole feature disappeared, and from the
    // outside it just looked like a chest that had not been cut.
    depth: T.shellThickness, seat: T.shellThickness * 0.10,
    jutMax: () => T.shellThickness * 0.16,
    rhoIn: RHO_IN, rhoOut: 1.16, dishFrom: DISH_FROM,
    phiSteps: 60, dishSteps: 3, rimSteps: 6,
    floorFlat: 0.0,
  });

  const chest = track(closedRadial({ uSteps: 40, vSteps: 26, R: chestR, skip: cavity.cut(1.04) }));
  chest.translate(0, chestCentreLocal.y, 0);
  assertOutward(chest, chestCentreLocal, 'chest');
  put(spineUpper, chest, materials.skin, { name: 'chest' });

  // The lip. It is a full grommet rim, so it also covers the chest's ragged
  // cut; its dish is the short funnel wall, in skin, because that wall is the
  // body's own thickness seen edge-on.
  cavity.rim.translate(0, chestCentreLocal.y, 0);
  cavity.dish.translate(0, chestCentreLocal.y, 0);
  track(cavity.rim); track(cavity.dish);
  assertInsideRadial(cavity.dish, chestCentreLocal, chestR, 'cavity funnel', 1e-6);
  put(spineUpper, cavity.rim, materials.skin, { name: 'cavity-lip' });
  put(spineUpper, cavity.dish, materials.skin, { name: 'cavity-wall' });

  // --- 3. the flesh column ----------------------------------------------------
  //
  // The chest's own section, scaled ANISOTROPICALLY. 0.88 wide is wide enough
  // to close the window at its corners; 0.34 deep leaves the ribs a real gap
  // to stand in. A single scale does one or the other and never both.
  const flesh = track(closedRadial({ uSteps: 28, vSteps: 18, R: chestR }));
  flesh.scale(C.floorX, 0.97, C.floorZ);
  flesh.translate(0, chestCentreLocal.y, 0);
  assertOutward(flesh, chestCentreLocal, 'flesh column');
  assertInsideRadial(flesh, chestCentreLocal, chestR, 'flesh column', 1e-6);
  put(spineUpper, flesh, materials.flesh, { name: 'flesh' });

  // --- 4. ribs and spine ------------------------------------------------------
  //
  // THREE PAIRS, not a cage. The window is 12 px tall in a shipped frame; four
  // ribs is a 3 px pitch and combs into a grey bar.
  const rShell = (h, a) => radiusAt(chestR, B.cy, h, a);

  // The FLESH COLUMN's radius at a height and azimuth, solved rather than
  // approximated. The column is the chest's own surface under a diagonal
  // scale, and an anisotropic scale MOVES A POINT'S AZIMUTH: scaling z by 0.34
  // and x by 0.88 sends a point at 30 degrees off the front to nearly 60. A
  // first version scaled the shell's radius componentwise and read the result
  // back at the original azimuth, which is a different point on a different
  // ray, and the answer was up to 60 per cent wrong at the sides -- so the
  // ribs, which are placed between this and the skin, stood proud of the skin.
  const rColumn = (h, a) => {
    const hp = h - B.cy;
    let lo = 1e-4, hi = 1.0;
    for (let k = 0; k < 40; k++) {
      const rc = 0.5 * (lo + hi);
      // pull the candidate back through the scale and ask the chest
      const q = v3(Math.sin(a) * rc / C.floorX, hp / 0.97, Math.cos(a) * rc / C.floorZ);
      const len = q.length();
      if (len < 1e-9) { lo = rc; continue; }
      if (len < chestR(q.clone().divideScalar(len))) lo = rc; else hi = rc;
    }
    return 0.5 * (lo + hi);
  };

  // --- 4. ribs and spine ------------------------------------------------------
  //
  // THREE PAIRS, not a cage. The window is 12 px tall in a shipped frame; four
  // ribs is a 3 px pitch and combs into a grey bar.
  // The ribs sweep PAST the edge of the window, not up to it. Stopped at the
  // window's edge their end caps float in the cavity as two bright discs;
  // carried a fifth further round they are behind solid skin, so the cap is
  // hidden by the body rather than by a clamp, and the rib reads as continuing
  // into the chest the way a rib does.
  const ribSpan = C.halfAngle * 1.24;
  const ribs = [];
  for (let k = 0; k < C.ribPairs; k++) {
    const h = C.ribTop - k * C.ribSpacing;
    for (const side of [+1, -1]) {
      const node = new THREE.Object3D();
      spineUpper.add(node);
      const pts = [];
      const N = 11;
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        // Starting well off the centre line, with a sternum strip between the
        // two halves. Started at the centre they meet nose to nose and the
        // three pairs read as a lattice of crossed sticks rather than as ribs.
        const a = side * mix(0.15, ribSpan, f);
        const drop = Math.sin(f * Math.PI * 0.5) * C.ribSpacing * 0.16;
        const hh = h - drop;
        const shell = rShell(hh, a);
        // Where the rib WANTS to be: a fixed fraction of the way from the
        // flesh column out toward the skin, so it stands in the gap.
        const want = mix(rColumn(hh, a), shell, C.ribFront);
        // Where it is ALLOWED to be: far enough in that the tube, not just
        // its centre line, is inside the body. The ends then dive under the
        // skin and their caps are never seen. POSTMORTEM 2.6 gives 0.86 of
        // the shell as a rule of thumb; on a chest this narrow that is not
        // enough on its own, so the clamp is written in terms of the tube's
        // own radius and cannot be outgrown.
        const room = shell - C.ribRadius - T.shellThickness * 0.30;
        const dive = mix(1.0, 0.94, smoothstep(0.80, 1.0, f));
        pts.push(v3(Math.sin(a) * Math.min(want, room) * dive, hh - M.y.chest, Math.cos(a) * Math.min(want, room) * dive));
      }
      const rib = track(arcTube(pts, C.ribRadius, C.ribRadius * 0.72, { radial: 9 }));
      // Checked, not trusted: a rib that has crept outside the skin is exactly
      // the sort of thing that reads as a modelling mistake and is invisible
      // from the one angle you happen to be looking from.
      assertInsideRadial(rib, chestCentreLocal, chestR, `rib ${side > 0 ? 'L' : 'R'}${k + 1}`, 1e-4);
      put(node, rib, materials.bone, { name: `rib${side > 0 ? 'L' : 'R'}${k + 1}` });
      recentre(node);
      ribs.push(node);
      // The shed names are the SKELETON's, so one shed plan drives either
      // figure. Three pairs, so `ribL6`/`ribR7` are simply absent and
      // `shed.get()` returns undefined for them, which the contract allows.
      if (side > 0 && k === 2) shed.set('ribL3', node);
      if (side < 0 && k === 1) shed.set('ribR4', node);
    }
  }
  // The sternum, between the two halves of each pair. Without it the left and
  // right arcs meet on the centre line and the cage reads as crossed sticks.
  {
    const pts = [];
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const h = mix(C.ribTop + C.ribSpacing * 0.42, C.ribTop - C.ribSpacing * (C.ribPairs - 0.55), i / N);
      const rr = Math.min(mix(rColumn(h, 0), rShell(h, 0), C.ribFront), rShell(h, 0) - C.ribRadius);
      pts.push(v3(0, h - M.y.chest, rr));
    }
    const st = track(arcTube(pts, C.ribRadius * 0.54, C.ribRadius * 0.44, { radial: 6 }));
    put(spineUpper, st, materials.bone, { name: 'sternum' });
  }

  // The spine, BEHIND the ribs, so its knobs show through the gaps and below
  // the lowest rib. That is what sells the cavity as an opening with a back to
  // it: you are looking past one piece of geometry at another.
  for (let k = 0; k < C.spineKnobs; k++) {
    const h = C.spineTop - k * C.spineSpacing;
    const rr = mix(rColumn(h, 0), rShell(h, 0), 0.22);
    const knob = track(ovoid(C.spineRadius * 0.92, C.spineRadius * 0.60, C.spineRadius * 0.70, { uSteps: 10, vSteps: 7 }));
    put(spineUpper, knob, materials.bone, { pos: v3(0, h - M.y.chest, rr), name: 'spine' });
  }

  // --- the shoulder yoke ------------------------------------------------------
  //
  // The head sits IN the shoulders, not on a column above them: the chin is
  // 4.4 px above the top of the shoulder mass. This is the piece that carries
  // that, and it is deliberately shallow -- anything taller becomes the neck
  // this character does not have.
  const yokeR = (d) => roundBoxR(M.arm.shoulderSeparation / 2 + M.neck.radius * 0.55, M.neck.length * 2.1, T.chestDepth * 0.46, 2.6)(d);
  const yoke = track(closedRadial({ uSteps: 22, vSteps: 12, R: yokeR }));
  yoke.translate(0, M.y.shoulderTop - M.neck.length * 1.1 - M.y.chest, 0);
  put(spineUpper, yoke, materials.skin, { name: 'yoke' });

  // The neck column. There is no neck on this character -- the chin is 4.4 px
  // above the top of the shoulder mass -- but 4.4 px of nothing is still a gap,
  // and in the first silhouette pass the head visibly FLOATED above the body.
  // This is the short plug that seats it: it rises from inside the yoke to well
  // inside the skull, so it is hidden at both ends and all it ever contributes
  // is filling that band. It hangs off `neck`, so the small follow-through the
  // animation puts there carries it.
  const neckTube = track(limb(
    v3(0, M.y.shoulderTop - M.neck.length * 1.6 - M.y.neck, 0),
    v3(0, M.y.chin + M.neck.length * 0.9 - M.y.neck, -M.neck.radius * 0.10),
    M.neck.radius * 1.02, M.neck.radius * 0.94,
    { radial: 14, segments: 4, waist: 0.96 }));
  put(neck, neckTube, materials.skin, { name: 'neck' });

  return {
    group,
    joints: { spineLower, spineUpper, neck },
    anchors: { atlas, shoulderL, shoulderR },
    frames: { inRoot, inUpper },
    shed,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
