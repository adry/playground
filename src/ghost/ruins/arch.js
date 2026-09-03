import { block, voussoir, TAU } from './kit.js';

// Collapsing stone arch.
//
// A ring of voussoirs is only convincing if it visibly *used to* close a
// circle and no longer does. So every variant here starts from the same
// intact recipe -- coursed piers, a projecting impost, a semicircular ring
// of wedge stones springing from it -- and then breaks it in one of a few
// distinct, structurally-plausible ways, rather than randomly deleting
// pieces. A real collapse also leaves evidence on the ground, so every
// variant sheds at least one fallen stone near a pier.

// A box's vertical extent changes when it tilts about its local X axis
// (kit.js rotates X, then Y, then Z -- so a Y-yaw applied afterwards only
// spins the footprint and never touches this). Solving for the resting
// height keeps every "fallen" stone's lowest corner safely above the
// y = -0.05 floor without having to special-case each caller.
function restY(size, tilt) {
  const [, sy, sz] = size;
  return (sy / 2) * Math.cos(tilt) + (sz / 2) * Math.abs(Math.sin(tilt)) + 0.035;
}

// A voussoir that fell out of the ring and now lies flat on the ground.
// `block` can't reproduce a wedge's taper, but at this stylised scale a
// tilted dressed slab sized off the same ring dimensions reads the same way
// and is the one signature detail every collapsed arch needs.
function fallenStone(rand, x, z, archThickness, ringDepth) {
  const size = [
    ringDepth * (1.3 + rand() * 1.0),
    ringDepth * (0.5 + rand() * 0.3),
    archThickness * (0.7 + rand() * 0.3),
  ];
  const tilt = (rand() - 0.5) * 0.5; // resting on rubble, not perfectly flat
  const yaw = rand() * TAU;
  return block({ pos: [x, restY(size, tilt), z], size, rot: [tilt, yaw, 0] });
}

// Small debris -- corner spalls knocked off during the fall. Thin on
// purpose; this is the detail that sells "dressed stone" over "crude box".
function spallChip(rand, x, z) {
  const size = [0.1 + rand() * 0.14, 0.035 + rand() * 0.05, 0.08 + rand() * 0.12];
  const tilt = (rand() - 0.5) * 0.6;
  const yaw = rand() * TAU;
  return block({ pos: [x, restY(size, tilt), z], size, rot: [tilt, yaw, 0] });
}

// One pier, coursed from the ground up. Each course is split into two
// stones across the arch's depth, with the split alternating sides between
// courses -- a running bond, so no vertical joint lines up with the one
// below it. `jagged` breaks the top course instead of finishing it flush,
// for a pier that has been reduced to a stump.
function buildPierCourses(rand, primitives, cx, width, depth, courses, courseHeight, jagged) {
  for (let i = 0; i < courses; i++) {
    const courseBottom = i * courseHeight;
    const bias = (i % 2 === 0 ? -1 : 1) * (0.08 + rand() * 0.08);
    const split = depth * bias; // offset from centre, not an absolute z-coordinate
    const isTop = jagged && i === courses - 1;
    const segs = [
      [-depth / 2, split],
      [split, depth / 2],
    ];
    // A sheared-off top course loses a stone to the fall; guard against
    // losing both, or the stump would have no top course at all.
    const drop = segs.map(() => isTop && rand() < 0.45);
    if (drop.every(Boolean)) drop[Math.floor(rand() * drop.length)] = false;
    segs.forEach(([z0, z1], idx) => {
      if (drop[idx]) return;
      const h = isTop ? courseHeight * (0.35 + rand() * 0.45) : courseHeight - rand() * 0.015;
      primitives.push(block({
        pos: [cx, courseBottom + h / 2, (z0 + z1) / 2],
        size: [width, h, z1 - z0],
      }));
    });
  }
  return courses * courseHeight;
}

// The projecting impost/springing block the ring actually rests on. Kept
// thin and slightly wider than the pier -- that projection is what reads as
// a dressed springer course rather than the pier just stopping.
function buildImpost(primitives, cx, topY, width, depth, thickness, proj) {
  primitives.push(block({
    pos: [cx, topY + thickness / 2, 0],
    size: [width + proj * 2, thickness, depth + proj * 2],
  }));
  return topY + thickness;
}

// A short return of walling bonded into a pier's outer face, broken off
// jaggedly -- optional, only added on some rolls. Extends the pier's own
// collider footprint outward so cloth still drapes over it.
function buildStub(rand, primitives, cx, sign, width, depth, courseHeight) {
  let x = cx;
  let len = 0;
  const blocks = 1 + (rand() < 0.5 ? 1 : 0);
  for (let i = 0; i < blocks; i++) {
    const segLen = width * (0.9 - i * 0.35) * (0.7 + rand() * 0.4);
    const h = courseHeight * (0.55 + rand() * 0.4); // broken low, well under a full course
    x += sign * (width / 2 + segLen / 2) - (i === 0 ? 0 : 0);
    primitives.push(block({
      pos: [x, h / 2, (rand() - 0.5) * depth * 0.3],
      size: [segLen, h, depth * (0.7 + rand() * 0.2)],
    }));
    len += segLen;
    x += sign * (segLen / 2);
  }
  return len;
}

export default function buildArch(rand) {
  // Proportions drawn once per piece, all within the brief's ranges.
  const span = 1.4 + rand() * 1.2;
  const archThickness = 0.32 + rand() * 0.18; // also the voussoir extrusion length
  const ringDepth = 0.22 + rand() * 0.12;     // outerR - innerR
  const innerR = span / 2;
  const outerR = innerR + ringDepth;
  const pierWidth = ringDepth; // flush with the ring, so the extrados never overhangs
  const courseHeight = 0.22 + rand() * 0.08;
  const impostThickness = 0.1 + rand() * 0.04;
  const impostProj = 0.035 + rand() * 0.03;
  const courses = 3 + Math.floor(rand() * 2);

  const N = [7, 9, 11][Math.floor(rand() * 3)]; // odd, so the crown has a true keystone
  const step = Math.PI / N;
  const gapAngle = 0.02 + rand() * 0.015; // visible mortar joint between wedges

  const primitives = [];
  const colliders = [];
  const fallen = []; // {x,z} of every stone dropped on the ground, for one debris collider

  const cxR = innerR + pierWidth / 2;
  const cxL = -cxR;

  function ringStone(centre, i, displace) {
    const from = i * step + gapAngle / 2;
    const to = (i + 1) * step - gapAngle / 2;
    const c = displace ? [centre[0] + displace[0], centre[1] + displace[1], centre[2] + displace[2]] : centre;
    primitives.push(voussoir({ centre: c, innerR, outerR, from, to, thickness: archThickness }));
  }

  function dropFallen(sign, count) {
    for (let k = 0; k < count; k++) {
      const x = sign * (innerR + pierWidth * 0.5 + rand() * 0.7);
      const z = (rand() - 0.5) * (archThickness + 0.6);
      primitives.push(fallenStone(rand, x, z, archThickness, ringDepth));
      fallen.push({ x, z });
    }
    if (rand() < 0.7) {
      const x = sign * (innerR + pierWidth * 0.3 + rand() * 0.5);
      const z = (rand() - 0.5) * 0.6;
      primitives.push(spallChip(rand, x, z));
    }
  }

  const roll = rand();
  let variant;

  if (roll < 0.28) {
    // Broken crown: both haunches still stand, but the top of the ring is
    // gone -- the classic silhouette of a collapsing arch.
    variant = 'broken-crown';
    const topL = buildPierCourses(rand, primitives, cxL, pierWidth, archThickness, courses, courseHeight, false);
    const topR = buildPierCourses(rand, primitives, cxR, pierWidth, archThickness, courses, courseHeight, false);
    const springY = buildImpost(primitives, cxL, topL, pierWidth, archThickness, impostThickness, impostProj);
    buildImpost(primitives, cxR, topR, pierWidth, archThickness, impostThickness, impostProj);
    const centre = [0, springY, 0];

    const missing = 2 + Math.floor(rand() * 2); // 2-3 crown stones gone
    const midLo = Math.floor((N - missing) / 2);
    const midHi = midLo + missing;
    for (let i = 0; i < N; i++) {
      if (i >= midLo && i < midHi) continue;
      ringStone(centre, i, null);
    }
    // The stones that came out of that gap didn't vanish.
    dropFallen(rand() < 0.5 ? -1 : 1, 1);
    dropFallen(1, 0); // spall chance only, from the other haunch

    let stubExtra = 0;
    let stubSign = 0;
    if (rand() < 0.35) {
      stubSign = rand() < 0.5 ? -1 : 1;
      stubExtra = buildStub(rand, primitives, stubSign === -1 ? cxL : cxR, stubSign, pierWidth, archThickness, courseHeight);
    }
    pushPierColliders(springY, springY, stubSign, stubExtra);
  } else if (roll < 0.53) {
    // Half arch: one pier still carries its voussoirs out into open air; the
    // far pier never made it past a stump.
    variant = 'half-arch';
    const standSign = rand() < 0.5 ? 1 : -1;
    const cxStand = standSign === 1 ? cxR : cxL;
    const cxStump = standSign === 1 ? cxL : cxR;

    const topStand = buildPierCourses(rand, primitives, cxStand, pierWidth, archThickness, courses, courseHeight, false);
    const springY = buildImpost(primitives, cxStand, topStand, pierWidth, archThickness, impostThickness, impostProj);
    const stumpCourses = 1 + Math.floor(rand() * 2);
    const stumpTop = buildPierCourses(rand, primitives, cxStump, pierWidth, archThickness, stumpCourses, courseHeight, true);

    const centre = [0, springY, 0];
    // Sweep starts at the standing pier's springing angle and stops well
    // short of the far side -- stones ending in mid-air, no support needed
    // because nothing continues past the last one.
    const cutoff = 0.5 + rand() * 0.16; // fraction of PI reached before the break
    const stoneCount = Math.max(2, Math.round((N * cutoff)));
    for (let i = 0; i < stoneCount; i++) {
      const idx = standSign === 1 ? i : N - 1 - i;
      ringStone(centre, idx, null);
    }
    dropFallen(standSign, 1 + Math.floor(rand() * 2));
    dropFallen(-standSign, rand() < 0.6 ? 1 : 0);

    colliders.push({ x: cxStand, z: 0, hx: pierWidth / 2, hz: archThickness / 2, top: springY });
    colliders.push({ x: cxStump, z: 0, hx: pierWidth / 2, hz: archThickness / 2, top: stumpTop });
  } else if (roll < 0.8) {
    // Nearly intact: the full ring still closes, but the wall that once rose
    // above it has broken away, and a stone or two near the crown has
    // slipped -- dropped and pushed sideways out of true, no longer flush
    // with its neighbours.
    variant = 'displaced';
    const topL = buildPierCourses(rand, primitives, cxL, pierWidth, archThickness, courses, courseHeight, false);
    const topR = buildPierCourses(rand, primitives, cxR, pierWidth, archThickness, courses, courseHeight, false);
    const springY = buildImpost(primitives, cxL, topL, pierWidth, archThickness, impostThickness, impostProj);
    buildImpost(primitives, cxR, topR, pierWidth, archThickness, impostThickness, impostProj);
    const centre = [0, springY, 0];

    const slipCount = rand() < 0.5 ? 1 : 2;
    const slipIdx = new Set();
    while (slipIdx.size < slipCount) {
      slipIdx.add(1 + Math.floor(rand() * (N - 2))); // never the springers themselves
    }
    for (let i = 0; i < N; i++) {
      const slip = slipIdx.has(i);
      const displace = slip
        ? [(rand() - 0.5) * 0.05, -(0.05 + rand() * 0.08), (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.09)]
        : null;
      ringStone(centre, i, displace);
    }

    // Jagged wall stub above the crown, ending abruptly -- the masonry that
    // used to rise higher and has since broken away.
    const crownTop = springY + outerR;
    let wy = crownTop;
    const stubCourses = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < stubCourses; i++) {
      const w = (outerR * 0.9) * (1 - i * (0.22 + rand() * 0.1));
      const h = courseHeight * (0.7 + rand() * 0.3);
      if (w < 0.12) break;
      primitives.push(block({
        pos: [(rand() - 0.5) * 0.1, wy + h / 2, (rand() - 0.5) * archThickness * 0.2],
        size: [w, h, archThickness * (0.7 + rand() * 0.2)],
      }));
      wy += h;
    }

    dropFallen(rand() < 0.5 ? -1 : 1, 1);
    pushPierColliders(springY, springY, 0, 0);
  } else {
    // Total collapse: both piers reduced to stumps, the whole ring down as
    // a jumble of fallen stones. No opening to keep clear, so debris can
    // scatter freely between them.
    variant = 'collapsed';
    const stumpCourses = 1 + Math.floor(rand() * 2);
    const topL = buildPierCourses(rand, primitives, cxL, pierWidth, archThickness, stumpCourses, courseHeight, true);
    const topR = buildPierCourses(rand, primitives, cxR, pierWidth, archThickness, stumpCourses, courseHeight, true);
    colliders.push({ x: cxL, z: 0, hx: pierWidth / 2, hz: archThickness / 2, top: topL });
    colliders.push({ x: cxR, z: 0, hx: pierWidth / 2, hz: archThickness / 2, top: topR });

    const debris = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < debris; k++) {
      const x = (rand() - 0.5) * (innerR * 1.6);
      const z = (rand() - 0.5) * (archThickness + 1.0);
      primitives.push(fallenStone(rand, x, z, archThickness, ringDepth));
      fallen.push({ x, z });
    }
    for (let k = 0; k < 2; k++) {
      primitives.push(spallChip(rand, (rand() - 0.5) * innerR, (rand() - 0.5) * 1.0));
    }
  }

  // Piers carry the pier colliders for the two variants above that build a
  // full pair of standing piers; declared once here so both branches share it.
  function pushPierColliders(topLY, topRY, stubSign, stubExtra) {
    let hxL = pierWidth / 2;
    let cxLc = cxL;
    let hxR = pierWidth / 2;
    let cxRc = cxR;
    if (stubSign === -1) {
      hxL = (pierWidth + stubExtra) / 2;
      cxLc = cxL - stubExtra / 2;
    } else if (stubSign === 1) {
      hxR = (pierWidth + stubExtra) / 2;
      cxRc = cxR + stubExtra / 2;
    }
    colliders.push({ x: cxLc, z: 0, hx: hxL, hz: archThickness / 2, top: topLY });
    colliders.push({ x: cxRc, z: 0, hx: hxR, hz: archThickness / 2, top: topRY });
  }

  // One coarse collider over all the fallen debris, so cloth drapes across
  // the rubble instead of hovering above it. Sits well clear of the
  // opening because every fallen stone was placed outside |x| < innerR.
  if (fallen.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const f of fallen) {
      minX = Math.min(minX, f.x - 0.3);
      maxX = Math.max(maxX, f.x + 0.3);
      minZ = Math.min(minZ, f.z - 0.3);
      maxZ = Math.max(maxZ, f.z + 0.3);
    }
    colliders.push({
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      hx: (maxX - minX) / 2,
      hz: (maxZ - minZ) / 2,
      top: 0.22,
    });
  }

  return {
    primitives,
    colliders: colliders.slice(0, 5),
    radius: outerR + 0.6,
  };
}
