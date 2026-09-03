import { block, drum } from './kit.js';

// Ruined round tower.
//
// The wall is laid course by course as a ring of individual blocks, each
// turned to face outward -- never a solid cylinder -- because the hollow
// interior is the one thing that makes a broken tower read as a *tower* and
// not a plug of stone. A height field over the ring's angle decides, course
// by course, which stones are still there: high where the tower survived,
// low or absent where it collapsed. That single field is what produces the
// jagged crest, the missing stones, and the side the rubble spills toward,
// so the four archetypes below only need to shape that one curve differently.

const TAU = Math.PI * 2;

function rr(rand, a, b) { return a + rand() * (b - a); }
function ri(rand, a, b) { return a + Math.floor(rand() * (b - a + 1)); }

// Smallest signed angle from b to a, so a falloff centred on a direction
// doesn't get confused by the 0/2*PI seam on the far side of the tower.
function angDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// Flat at 1 within `half` radians of centre, flat at 0 beyond `half + sh`,
// eased in between. This one curve is what turns "a ring" into "a ring torn
// away on one side" -- wide and shallow for a stump, narrow and steep for a
// single surviving bay.
function shoulder(d, half, sh) {
  const ad = Math.abs(d);
  if (ad <= half) return 1;
  if (ad >= half + sh) return 0;
  const t = (ad - half) / sh;
  return 1 - t * t * (3 - 2 * t);
}

// Exact vertical half-extent of a box after kit.js's rotation order
// (rotateX, then rotateY, then rotateZ) -- the standard rotated-AABB
// formula, projecting each local axis's half-extent onto world Y and
// summing the absolute contributions. A hand-waved per-axis estimate isn't
// safe here: the Y-spin between the two tilts mixes width into depth (and
// back), so a bound that ignores that mixing can under-count and let a
// tilted stone's corner poke through the ground.
function tiltedRestY(w, h, d, rx, ry, rz) {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const coeffX = sz * cy;
  const coeffY = sz * sy * sx + cz * cx;
  const coeffZ = sz * sy * cx - cz * sx;
  // +0.02 margin absorbs the corner chip's own small random offset.
  return (w / 2) * Math.abs(coeffX) + (h / 2) * Math.abs(coeffY) + (d / 2) * Math.abs(coeffZ) + 0.02;
}

export default function buildTower(rand) {
  const outerR = rr(rand, 0.9, 1.5);
  const wallT = rr(rand, 0.3, 0.42);
  const rMid = outerR - wallT / 2;

  // Four archetypes, weighted so the wide, everyday stump is the common
  // case and the clean half-ring split is the rarest.
  const roll = rand();
  const kind = roll < 0.32 ? 'stump' : roll < 0.58 ? 'chimney' : roll < 0.82 ? 'half' : 'wavy';

  // The compass direction that kept the most height. The fallen material
  // always spills roughly opposite it.
  const survivingCenter = rand() * TAU;

  let peak;
  let trough;
  let spanHalf;
  let sh;
  let N;
  let courseH;
  let waveAmp = 0;
  let waveFreq = 0;
  let wavePhase = 0;

  if (kind === 'stump') {
    // Barely survived: low all round, one wide plateau, a shallow dip
    // rather than a clean collapse to the ground.
    peak = rr(rand, 0.95, 1.3);
    trough = peak - rr(rand, 0.35, 0.55);
    spanHalf = rr(rand, 1.6, 2.3);
    sh = rr(rand, 0.5, 0.9);
    N = ri(rand, 10, 12);
    courseH = rr(rand, 0.28, 0.34);
  } else if (kind === 'chimney') {
    // One bay stands like a broken flue; everywhere else falls away almost
    // to the footing, so the tall arc stays cheap even with many courses.
    peak = rr(rand, 2.0, 2.7);
    trough = rr(rand, 0.15, 0.4);
    spanHalf = rr(rand, 0.35, 0.55);
    sh = rr(rand, 0.35, 0.55);
    N = ri(rand, 11, 12);
    courseH = rr(rand, 0.27, 0.32);
  } else if (kind === 'half') {
    // Roughly a semicircle survives at a fairly even height; the rest is
    // gone to the ground -- a split, not a gradient.
    peak = rr(rand, 1.3, 2.0);
    trough = 0;
    spanHalf = rr(rand, 1.15, 1.5);
    sh = rr(rand, 0.25, 0.45);
    N = ri(rand, 11, 12);
    courseH = rr(rand, 0.27, 0.33);
  } else {
    // 'wavy': no single break -- the whole crest undulates, some bays a
    // course taller than their neighbours, reading as slow piecemeal
    // collapse rather than one event.
    peak = rr(rand, 1.15, 1.55);
    trough = peak - rr(rand, 0.4, 0.6);
    spanHalf = rr(rand, 0.9, 1.4);
    sh = rr(rand, 0.6, 1.0);
    N = ri(rand, 10, 11);
    courseH = rr(rand, 0.3, 0.36);
    waveAmp = rr(rand, 0.12, 0.2);
    waveFreq = ri(rand, 3, 5);
    wavePhase = rand() * TAU;
  }

  function heightAtAngle(a) {
    const d = angDelta(a, survivingCenter);
    let h = trough + (peak - trough) * shoulder(d, spanHalf, sh);
    h += waveAmp * Math.sin(waveFreq * a + wavePhase);
    return Math.max(0, h);
  }

  // Per-column heights, with jitter so neighbouring bays don't all end in
  // lockstep -- that reads as a rendered stump, and real collapse is never
  // that tidy.
  const angles = [];
  const heights = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + rr(rand, -0.03, 0.03);
    angles.push(a);
    heights.push(Math.max(0, heightAtAngle(a) + rr(rand, -0.05, 0.05)));
  }

  // Capped regardless of peak: a narrow surviving bay can otherwise demand
  // a tall stack of courses, and only that bay's few columns pay for the
  // extra rows, but the cap keeps every archetype's primitive count bounded
  // without touching how tall the tower reads.
  const numCourses = Math.min(9, Math.max(2, Math.ceil(Math.max(...heights) / courseH)));
  const fill = rr(rand, 0.82, 0.92); // gap left between stones for the mortar joint
  const stoneW = ((TAU * rMid) / N) * fill;

  // One course gets a projecting string course -- a thin outward step that
  // bands the tower, and being a whole ring it is the cheapest possible way
  // to break up an otherwise uniform stack of identical stones.
  const stringCourse = numCourses > 2 ? ri(rand, 1, numCourses - 2) : -1;
  // One course below that gets a stone or two pulled outward, leaving a gap
  // at the inner face -- the socket a floor joist once sat in.
  const socketCourse = numCourses > 3 ? ri(rand, 1, Math.max(1, stringCourse - 1)) : -1;
  // One included column, roughly mid-height, gets split around a narrow
  // vertical gap -- an arrow loop.
  const loopCourse = numCourses > 2 ? ri(rand, 1, numCourses - 1) : -1;
  let loopColumn = -1;

  const primitives = [];
  const topCourseOf = new Array(N).fill(-1);

  for (let c = 0; c < numCourses; c++) {
    const yBase = c * courseH;
    // A course is judged present at a column if the column's own height
    // reaches past its midline -- majority rule, so the ring's silhouette
    // steps up and down by whole courses instead of needing partial-height
    // blocks.
    const cutoff = yBase + courseH * 0.5;
    // Missing stones get more likely toward the crest: a footing course
    // is never as picked-over as the one at the top of a ruin.
    const dropoutP = 0.04 + (c / numCourses) * 0.3;
    let socketsLeft = c === socketCourse ? ri(rand, 1, 2) : 0;

    for (let i = 0; i < N; i++) {
      if (heights[i] < cutoff) continue;
      if (rand() < dropoutP) continue;

      const a = angles[i];
      const yc = yBase + courseH / 2;
      // Local Z (the block's thin axis) is turned to point radially at
      // angle a, and local X (the long axis) falls in tangentially -- so
      // each stone lies along the ring instead of facing an arbitrary way.
      const yaw = Math.PI / 2 - a;

      if (c === stringCourse) {
        const depth = wallT * 0.5;
        const proj = wallT * rr(rand, 0.18, 0.3); // how far it steps proud of the wall face
        const r = outerR - depth / 2 + proj;
        primitives.push(block({
          pos: [Math.cos(a) * r, yBase + courseH * 0.22, Math.sin(a) * r],
          size: [stoneW, courseH * 0.42, depth],
          rot: [0, yaw, 0],
        }));
        topCourseOf[i] = c;
        continue;
      }

      if (c === loopCourse && loopColumn === -1 && stoneW > 0.34) {
        // Only claim the loop where there is real width either side of the
        // slit -- otherwise the two halves would be thinner than a dressed
        // stone can be and still read as masonry rather than shims.
        loopColumn = i;
        const loopW = rr(rand, 0.1, 0.14);
        const sideW = (stoneW - loopW) / 2;
        for (const sign of [-1, 1]) {
          const off = sign * (loopW / 2 + sideW / 2);
          // Offset along the stone's own tangential axis, not world x/z.
          const tx = Math.cos(a + Math.PI / 2) * off;
          const tz = Math.sin(a + Math.PI / 2) * off;
          primitives.push(block({
            pos: [Math.cos(a) * rMid + tx, yc, Math.sin(a) * rMid + tz],
            size: [sideW, courseH * 0.96, wallT],
            rot: [0, yaw, 0],
          }));
        }
        topCourseOf[i] = c;
        continue;
      }

      if (socketsLeft > 0 && rand() < 0.5) {
        // Pull the stone outward, leaving the inner half of the wall
        // thickness open where a joist once slotted in.
        socketsLeft--;
        const depth = wallT * 0.5;
        const r = outerR - depth / 2;
        primitives.push(block({
          pos: [Math.cos(a) * r, yc, Math.sin(a) * r],
          size: [stoneW, courseH * 0.96, depth],
          rot: [0, yaw, 0],
        }));
        topCourseOf[i] = c;
        continue;
      }

      primitives.push(block({
        pos: [Math.cos(a) * rMid, yc, Math.sin(a) * rMid],
        size: [stoneW, courseH * 0.96, wallT], // 0.96: leaves a hairline coursing gap above and below
        rot: [0, yaw, 0],
      }));
      topCourseOf[i] = c;
    }
  }

  // Crenellation remnants: merlons only on columns that made it to the
  // tower's own top course, in an every-other pattern so the crenels
  // between them actually read as gaps rather than more missing stone.
  let merlonBudget = 6;
  for (let i = 0; i < N && merlonBudget > 0; i++) {
    if (topCourseOf[i] < numCourses - 2) continue;
    if (i % 2 === 1) continue;
    const a = angles[i];
    const yaw = Math.PI / 2 - a;
    const yBaseM = (topCourseOf[i] + 1) * courseH;
    const mH = rr(rand, 0.22, 0.32);
    const mW = Math.min(stoneW * 0.75, rr(rand, 0.22, 0.28));
    primitives.push(block({
      pos: [Math.cos(a) * rMid, yBaseM + mH / 2, Math.sin(a) * rMid],
      size: [mW, mH, wallT * 0.85],
      rot: [0, yaw, 0],
    }));
    merlonBudget--;
  }

  // --- fallen masonry, spilled on the side opposite the surviving height ---
  const spillA = survivingCenter + Math.PI;
  const rubbleCount = kind === 'stump' ? ri(rand, 7, 9) : ri(rand, 4, 6);
  let rubbleReach = 0.4;
  for (let i = 0; i < rubbleCount; i++) {
    const a = spillA + rr(rand, -1.1, 1.1);
    const d = outerR + rr(rand, 0.05, 1.0);
    rubbleReach = Math.max(rubbleReach, d - outerR);
    const w = rr(rand, 0.18, 0.4);
    const h = rr(rand, 0.14, 0.3);
    const dep = rr(rand, 0.18, 0.36);
    const tiltX = rr(rand, -0.5, 0.5);
    const tiltZ = rr(rand, -0.5, 0.5);
    const spin = rand() * TAU;
    const restY = tiltedRestY(w, h, dep, tiltX, spin, tiltZ);
    primitives.push(block({
      pos: [Math.cos(a) * d, restY, Math.sin(a) * d],
      size: [w, h, dep],
      rot: [tiltX, spin, tiltZ],
    }));
  }

  // Occasionally one drum rolled clear of the pile: a shaft or corner-stone
  // that came down whole instead of shattering.
  if (rand() < 0.5) {
    const a = spillA + rr(rand, -0.8, 0.8);
    const d = outerR + rr(rand, 0.3, 1.1);
    rubbleReach = Math.max(rubbleReach, d - outerR);
    const rad = rr(rand, 0.1, 0.16);
    primitives.push(drum({
      pos: [Math.cos(a) * d, rad, Math.sin(a) * d],
      radius: rad,
      height: rr(rand, 0.5, 1.0),
      seg: 8,
      // Rolled onto its side (rotateX first turns the axis from vertical
      // to horizontal), then spun about Y to face an arbitrary way.
      rot: [Math.PI / 2, rand() * TAU, 0],
    }));
  }

  // Hard ceiling regardless of archetype: trims from the tail (rubble,
  // added last) rather than the standing ring, on the rare roll that stacks
  // a wide plateau with a tall wave on top of it.
  while (primitives.length > 68) primitives.pop();

  // --- coarse colliders -------------------------------------------------
  // Four square patches sampled around the surviving direction -- always
  // including it, so the tallest mass is never left undraped -- plus one
  // for the rubble spill. Deliberately not one disc over the whole
  // footprint: the tower is hollow, and cloth should fall through its
  // middle, not drape across it.
  const colliders = [];
  const patch = Math.max(0.32, outerR * 0.4);
  const sampleAngles = [
    survivingCenter,
    survivingCenter + Math.PI / 2,
    survivingCenter + Math.PI,
    survivingCenter - Math.PI / 2,
  ];
  for (const a of sampleAngles) {
    const h = heightAtAngle(a);
    if (h < 0.12) continue; // that side of the tower is gone -- nothing to drape on
    colliders.push({
      x: Math.cos(a) * rMid,
      z: Math.sin(a) * rMid,
      hx: patch,
      hz: patch,
      top: h,
    });
  }
  colliders.push({
    x: Math.cos(spillA) * (outerR + rubbleReach * 0.5),
    z: Math.sin(spillA) * (outerR + rubbleReach * 0.5),
    hx: Math.max(0.5, rubbleReach * 0.9),
    hz: Math.max(0.5, rubbleReach * 0.9),
    top: 0.22,
  });

  return {
    primitives,
    colliders: colliders.slice(0, 5),
    radius: outerR + rubbleReach * 0.6,
  };
}
