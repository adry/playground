// A STAND-IN world, so the rules half can be built and soaked before
// src/game/world/ exists.
//
// This file is temporary and it belongs to the rules half. It implements the
// interface in the message sent to the world agent and nothing else, and the
// day src/game/world/ lands, the single import in soak.mjs changes and this
// file is deleted. It is here because a navigation rewrite and a fairness
// rewrite cannot be measured against a world that does not exist, and inventing
// numbers is worse than inventing a placeholder and saying so.
//
// It is deliberately UNPRETTY. It does not cluster stones into wandering rows
// or curve a path; that is the world agent's job and doing it here would be
// building the same thing twice. What it does reproduce faithfully is the
// STRUCTURE the rules care about:
//
//   - fence runs that are sparse, straight, and mostly open-ended, so most of
//     the world is open ground;
//   - occasional closed PENS with one or two gates, which is the case that
//     makes the jump-versus-gate asymmetry exist at all;
//   - gates as literal gaps in the segment list (G3), so crossing test is pure;
//   - one firefly roughly every FLY_SPACING units, so a firefly is a journey;
//   - graves dense enough that the pen can follow the player;
//   - determinism by chunk hash, so a query depends only on the box.
//
// The one piece of real generation discipline it does keep is the rejection
// pass: a run that crosses a run from a neighbouring chunk is dropped, because
// two fences crossing is both ugly and the way an accidental gateless pocket
// gets built. That pass is why chunk generation is two-phase.

export const CHUNK = 24;

// Mean nearest-neighbour spacing of fireflies, in world units. The owner's
// sixth requirement is "one per screen"; the game camera's view is 9.0, which
// puts a screen at somewhere between 15 and 25 units. 18 is the middle of that
// and every measurement in soak.mjs is quoted at it. It is a parameter and not
// a constant because the world agent is choosing the real number.
export const FLY_SPACING = 18;

export const BARRIER_HALF = 0.10;
export const GATE_HALF = 1.00;

function hashInt(a, b, c) {
  let h = (a | 0) * 0x27d4eb2d ^ (b | 0) * 0x165667b1 ^ (c | 0) * 0x9e3779b1;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Segment-segment intersection, proper crossings only. Used by the rejection
// pass and nowhere else; the rules' own crossing test is a capsule distance.
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// A fence run: a straight line of `panels` 2.0 panels from (x, z) along
// (dx, dz), with `gaps` panel indices left out. Emits the contiguous spans as
// barrier segments and the missing panels as gates, which is G3.
function emitRun(out, x, z, dx, dz, panels, gaps, tag) {
  const gapSet = new Set(gaps);
  let spanStart = -1;
  for (let i = 0; i <= panels; i++) {
    const isGap = i < panels && gapSet.has(i);
    if (!isGap && i < panels) {
      if (spanStart === -1) spanStart = i;
    } else {
      if (spanStart !== -1) {
        out.barriers.push({
          id: `${tag}:b${spanStart}`,
          x0: x + dx * 2.0 * spanStart, z0: z + dz * 2.0 * spanStart,
          x1: x + dx * 2.0 * i, z1: z + dz * 2.0 * i,
          half: BARRIER_HALF,
        });
        spanStart = -1;
      }
      if (isGap) {
        out.gates.push({
          id: `${tag}:g${i}`, barrier: tag,
          x: x + dx * 2.0 * (i + 0.5), z: z + dz * 2.0 * (i + 0.5),
          dx, dz, half: GATE_HALF,
        });
      }
    }
  }
}

// Everything one chunk owns, before the crossing rejection. Pure in (seed, cx,
// cz), which is what lets the rejection pass look at neighbours without
// recursing for ever.
function rawChunk(seed, cx, cz, spacing) {
  const r = mulberry32(hashInt(seed ^ 0x5bf03635, cx, cz));
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const out = { barriers: [], gates: [], props: [], fireflies: [], powerups: [], graves: [] };
  const tag = `${cx},${cz}`;

  // --- fences ---------------------------------------------------------------
  // Sparse on purpose: the second of the owner's five changes is that a fence
  // is an occasional feature and not the structure. One run in a chunk more
  // often than not, a pen about one chunk in six.
  const roll = r();
  if (roll < 0.16) {
    // A pen. 3 to 5 panels a side, one or two gates, and the gates are what
    // makes it fair: a gateless pen is a place no skeleton can ever reach.
    const w = 3 + ((r() * 3) | 0);
    const h = 3 + ((r() * 3) | 0);
    const px = ox + 3 + r() * (CHUNK - 6 - w * 2);
    const pz = oz + 3 + r() * (CHUNK - 6 - h * 2);
    const nGates = r() < 0.45 ? 2 : 1;
    // Perimeter slots, walked as four runs, so a gate index picks a side.
    const sides = [
      { x: px, z: pz, dx: 1, dz: 0, n: w },
      { x: px + w * 2, z: pz, dx: 0, dz: 1, n: h },
      { x: px + w * 2, z: pz + h * 2, dx: -1, dz: 0, n: w },
      { x: px, z: pz + h * 2, dx: 0, dz: -1, n: h },
    ];
    const total = 2 * (w + h);
    const picks = new Set();
    while (picks.size < nGates) picks.add((r() * total) | 0);
    let base = 0;
    for (let s = 0; s < 4; s++) {
      const side = sides[s];
      const gaps = [];
      for (const p of picks) if (p >= base && p < base + side.n) gaps.push(p - base);
      emitRun(out, side.x, side.z, side.dx, side.dz, side.n, gaps, `${tag}:p${s}`);
      base += side.n;
    }
  } else if (roll < 0.72) {
    // An open run. Its ENDS are passages too, and most of the interesting play
    // is at an end rather than a gate: an open run is a thing you go round.
    const n = 3 + ((r() * 6) | 0);
    const ang = (((r() * 8) | 0) * Math.PI) / 4;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const len = n * 2.0;
    const sx = ox + 2 + r() * Math.max(1, CHUNK - 4 - Math.abs(dx) * len);
    const sz = oz + 2 + r() * Math.max(1, CHUNK - 4 - Math.abs(dz) * len);
    const gaps = [];
    if (n >= 4 && r() < 0.55) gaps.push(1 + ((r() * (n - 2)) | 0));
    emitRun(out, sx, sz, dx, dz, n, gaps, `${tag}:r`);
  }

  // --- props ----------------------------------------------------------------
  // Clusters, not rows, because the fifth change says so; the world agent will
  // do this properly. Only `solid` ones block, which is the only bit the rules
  // read. Radii are the measured plinth half-widths from footprints.js's own
  // range rather than invented: a headstone is about 0.35, a vault about 0.9.
  const clusters = 2 + ((r() * 3) | 0);
  for (let c = 0; c < clusters; c++) {
    const cxp = ox + 1.5 + r() * (CHUNK - 3);
    const czp = oz + 1.5 + r() * (CHUNK - 3);
    const k = 1 + ((r() * 4) | 0);
    const big = r() < 0.12;
    for (let i = 0; i < k; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 1.9;
      out.props.push({
        id: `${tag}:s${c}_${i}`,
        kind: big && i === 0 ? 'vault' : 'stone',
        x: cxp + Math.cos(a) * d, z: czp + Math.sin(a) * d,
        yaw: r() * Math.PI * 2,
        radius: big && i === 0 ? 0.90 : 0.30 + r() * 0.14,
        solid: true,
      });
    }
  }

  // --- fireflies ------------------------------------------------------------
  // One per screen. The expected count in a chunk is (CHUNK/spacing)^2, which
  // at 24 and 18 is 1.78, so a chunk holds one or two and the player really
  // does have to cross the screen for the next.
  const want = (CHUNK / spacing) ** 2;
  let n = Math.floor(want);
  if (r() < want - n) n++;
  for (let i = 0; i < n; i++) {
    out.fireflies.push({ id: `${tag}:f${i}`, x: ox + r() * CHUNK, z: oz + r() * CHUNK });
  }

  // --- lanterns and graves --------------------------------------------------
  // One lantern per 64x64 is 0.14 of a chunk; one grave per 32x32 is 0.56, and
  // the floor has to hold for EVERY box and not on average, so it is rounded up
  // to one a chunk with a second sometimes.
  if (r() < 0.16) out.powerups.push({ id: `${tag}:l`, x: ox + 2 + r() * (CHUNK - 4), z: oz + 2 + r() * (CHUNK - 4) });
  const graves = r() < 0.35 ? 2 : 1;
  for (let i = 0; i < graves; i++) {
    out.graves.push({
      id: `${tag}:v${i}`,
      x: ox + 2 + r() * (CHUNK - 4), z: oz + 2 + r() * (CHUNK - 4),
      yaw: r() * Math.PI * 2,
    });
  }
  return out;
}

export function createWorld({ seed = 1, spacing = FLY_SPACING } = {}) {
  const chunks = new Map();

  function chunkAt(cx, cz) {
    const key = `${cx},${cz}`;
    let c = chunks.get(key);
    if (c) return c;
    c = rawChunk(seed, cx, cz, spacing);
    // The rejection pass: drop this chunk's fence entirely if any of its
    // segments properly crosses a segment from a neighbour. Dropping the whole
    // run rather than the offending segment is what keeps a gate from being
    // orphaned from the fence it was cut into.
    let crosses = false;
    for (let dz = -1; dz <= 1 && !crosses; dz++) {
      for (let dx = -1; dx <= 1 && !crosses; dx++) {
        if (!dx && !dz) continue;
        // Ordering rule so the decision is symmetric and order-free: only the
        // chunk with the larger key yields.
        if ((cz + dz) * 1000 + (cx + dx) > cz * 1000 + cx) continue;
        const nb = rawChunk(seed, cx + dx, cz + dz, spacing);
        for (const a of c.barriers) {
          for (const b of nb.barriers) {
            if (segCross(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0, b.x1, b.z1)) { crosses = true; break; }
          }
          if (crosses) break;
        }
      }
    }
    if (crosses) { c = { ...c, barriers: [], gates: [] }; }
    // Props that sit in a gate would violate G5, and a prop on a fence line
    // looks like a mistake. Both are cheaper to drop here than to test for.
    c = {
      ...c,
      props: c.props.filter((p) => {
        for (const g of c.gates) if (Math.hypot(p.x - g.x, p.z - g.z) < 0.95 + p.radius) return false;
        for (const b of c.barriers) if (segPointDist(b, p.x, p.z) < p.radius + b.half + 0.05) return false;
        return true;
      }),
    };
    chunks.set(key, c);
    return c;
  }

  // A query box is grown by the largest thing a neighbouring chunk can reach
  // into it with, which is a fence run: 8 panels is 16 units.
  const PAD = 18;
  function collect(box, key) {
    const c0 = Math.floor((box.minX - PAD) / CHUNK);
    const c1 = Math.floor((box.maxX + PAD) / CHUNK);
    const r0 = Math.floor((box.minZ - PAD) / CHUNK);
    const r1 = Math.floor((box.maxZ + PAD) / CHUNK);
    const out = [];
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (const it of chunkAt(cx, cz)[key]) out.push(it);
      }
    }
    return out;
  }

  return {
    CHUNK,
    spacing,
    spawn: { x: 0, z: 0 },
    barriers: (box) => collect(box, 'barriers'),
    gates: (box) => collect(box, 'gates'),
    props: (box) => collect(box, 'props'),
    fireflies: (box) => collect(box, 'fireflies'),
    powerups: (box) => collect(box, 'powerups'),
    graves: (box) => collect(box, 'graves'),
  };
}

function segPointDist(b, x, z) {
  const dx = b.x1 - b.x0;
  const dz = b.z1 - b.z0;
  const ll = dx * dx + dz * dz || 1;
  let t = ((x - b.x0) * dx + (z - b.z0) * dz) / ll;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (b.x0 + dx * t), z - (b.z0 + dz * t));
}

export default createWorld;
