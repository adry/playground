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

// How much fence the world has, as a multiple of the stand-in's own default.
// It is a parameter because the answer to "does the vault-versus-gate asymmetry
// produce play" turns out to depend on it far more than on anything in the
// rules: a world with sparse SHORT fences is one the ghost walks round exactly
// as the skeleton does, and the mechanic never fires. soak.mjs sweeps it.
export const FENCE = 1;

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
function rawChunk(seed, cx, cz, spacing, fence) {
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
  const penP = 0.16 * fence;
  const runP = penP + 0.56 * Math.min(1.4, fence);
  if (roll < penP) {
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
  } else if (roll < runP) {
    // An open run. Its ENDS are passages too, and most of the interesting play
    // is at an end rather than a gate: an open run is a thing you go round.
    const n = Math.max(2, Math.round((3 + r() * 6) * Math.min(1.8, fence)));
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

// THE ARENA. A bounded 30 by 30 level with a tall wall round it and darkness
// beyond, which is what the owner asked for after the endless plane turned out
// to cost too much to load. It is a different generator rather than a clipped
// one, because at 30 by 30 the interesting fence is not a scattered run but a
// PEN: a run of 20 units is two thirds of the level, so a fence is either a
// closed thing you go into or it is a wall of the level.
//
// The wall is published as ordinary barriers carrying `wall: true`, which is the
// one flag the rules read: a wall barrier cannot be vaulted. Everything else
// about it is a fence.
//
// LANE is a clear ring inside the wall, and it is the single most load bearing
// number in here. It is a fairness device and not a look one: it is Pac-Man's
// outer corridor, the loop that means the edge of the board is somewhere you
// run rather than somewhere you are cornered.
//
// 3.5 is derived. The wall's own half thickness is 0.35 and a body needs 0.555
// of clearance from each side, so a lane of L leaves L - 0.35 - 1.11 of
// walkable width: 2.6 leaves 1.14, which is passable but so tight that a 0.75
// raster cannot always see it, and 3% of arenas failed F3 on strips between a
// pen and the wall that a skeleton could not be proved to fit down. 3.5 leaves
// 2.04, which is the corridor width the original lattice design used and had
// its own reasons for: two bodies pass in it.
export function createArena({ seed = 1, size = 30, lane = 3.5, wallHalf = 0.35, fireflies = 9 } = {}) {
  const r = mulberry32(hashInt(seed ^ 0x1a7e91, 7, 13));
  const h = size / 2;
  const bounds = { minX: -h, minZ: -h, maxX: h, maxZ: h };
  const out = { barriers: [], gates: [], props: [], fireflies: [], powerups: [], graves: [] };

  // The perimeter. Four segments, `wall: true`, ends flagged as joints so none
  // of them is ever mistaken for a fence run you can walk round the end of.
  const W = [[-h, -h, h, -h], [h, -h, h, h], [h, h, -h, h], [-h, h, -h, -h]];
  W.forEach((w, i) => out.barriers.push({
    id: `w${i}`, x0: w[0], z0: w[1], x1: w[2], z1: w[3],
    half: wallHalf, wall: true, end0: 'joint', end1: 'joint',
  }));

  const pens = [];
  const inner = h - lane;
  const clear = (x, z, rad, offFence = 0) => {
    if (Math.abs(x) > inner - rad || Math.abs(z) > inner - rad) return false;
    for (const b of out.barriers) if (!b.wall && segPointDist(b, x, z) < rad + b.half + offFence) return false;
    for (const p of out.props) if (Math.hypot(p.x - x, p.z - z) < rad + p.radius) return false;
    return true;
  };
  const inPen = (x, z, pad = 0) => pens.some((q) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad);
  const inGate = (x, z, rad) => {
    for (const g of out.gates) {
      const nx = -g.dz;
      const nz = g.dx;
      const along = (x - g.x) * nx + (z - g.z) * nz;
      const t = along < -2.2 ? -2.2 : along > 2.2 ? 2.2 : along;
      if (Math.hypot(x - (g.x + nx * t), z - (g.z + nz * t)) < 0.62 + rad) return true;
    }
    return false;
  };

  // Two or three pens, each with one or two gates, placed inside the lane and
  // not touching each other. A pen is the case where the vault is worth the
  // most, so the arena is mostly pens on purpose.
  const want = 2 + ((r() * 2) | 0);
  for (let tries = 0; tries < 200 && pens.length < want; tries++) {
    const w = 3 + ((r() * 2) | 0);
    const d = 3 + ((r() * 2) | 0);
    const px = -inner + 1 + r() * Math.max(0.1, inner * 2 - 2 - w * 2);
    const pz = -inner + 1 + r() * Math.max(0.1, inner * 2 - 2 - d * 2);
    const box = { x0: px, z0: pz, x1: px + w * 2, z1: pz + d * 2 };
    if (box.x1 > inner || box.z1 > inner) continue;
    let clash = false;
    for (const q of pens) {
      if (box.x0 < q.x1 + 3.5 && box.x1 > q.x0 - 3.5 && box.z0 < q.z1 + 3.5 && box.z1 > q.z0 - 3.5) { clash = true; break; }
    }
    if (clash) continue;
    pens.push(box);
    const sides = [
      { x: box.x0, z: box.z0, dx: 1, dz: 0, n: w },
      { x: box.x1, z: box.z0, dx: 0, dz: 1, n: d },
      { x: box.x1, z: box.z1, dx: -1, dz: 0, n: w },
      { x: box.x0, z: box.z1, dx: 0, dz: -1, n: d },
    ];
    const total = 2 * (w + d);
    const nG = r() < 0.5 ? 2 : 1;
    const picks = new Set();
    while (picks.size < nG) picks.add((r() * total) | 0);
    let base = 0;
    for (let i = 0; i < 4; i++) {
      const gaps = [];
      for (const q of picks) if (q >= base && q < base + sides[i].n) gaps.push(q - base);
      emitRun(out, sides[i].x, sides[i].z, sides[i].dx, sides[i].dz, sides[i].n, gaps, `p${pens.length}s${i}`);
      base += sides[i].n;
    }
  }

  const place = (list, rad, n, extra, offFence = 0, banPen = false) => {
    for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
      const x = -inner + r() * inner * 2;
      const z = -inner + r() * inner * 2;
      if (!clear(x, z, rad, offFence) || inGate(x, z, rad)) continue;
      if (banPen && inPen(x, z, 0.5)) continue;
      list.push({ id: `${list.length}`, x, z, ...(extra ? extra(r) : {}) });
      i++;
    }
  };
  // TWO CONSTRAINTS ON PROPS, and both are fairness rather than looks. They are
  // the two the soak found on the endless stand-in and they cost 5% of arenas
  // their F4 and 3% their F3 before they were here.
  //
  //   1.5 OFF A FENCE. A vault takes off 0.65 from the fence's centreline and
  //   lands 0.88 the other side, and the ghost's disc needs 0.55 there. A stone
  //   any nearer than that makes a stretch of fence unvaultable, and a pen whose
  //   fence cannot be vaulted and which has one gate is the pin that
  //   2-edge-connectivity used to forbid.
  //
  //   NOT INSIDE A PEN. Two stones can partition a pen's interior, and the half
  //   the gate does not open into is then a place the ghost can vault in to and
  //   no skeleton can ever walk to. That is F3, the safe spot, and it is the one
  //   that ends the game rather than annoying anybody.
  place(out.props, 0.45, 10 + ((r() * 8) | 0), (rr) => ({ kind: 'stone', yaw: rr() * 6.28, radius: 0.30 + rr() * 0.16, solid: true }), 1.5, true);
  out.props.forEach((p, i) => { p.id = `s${i}`; });
  place(out.fireflies, 0.70, fireflies);
  out.fireflies.forEach((f, i) => { f.id = `f${i}`; });
  place(out.powerups, 0.85, 2);
  out.powerups.forEach((p, i) => { p.id = `l${i}`; });
  place(out.graves, 0.80, 4, (rr) => ({ yaw: rr() * 6.28 }));
  out.graves.forEach((g, i) => { g.id = `v${i}`; });

  let spawn = { x: 0, z: 0 };
  for (let i = 0; i < 60 && !clear(spawn.x, spawn.z, 0.62); i++) {
    const a = i * 2.4;
    spawn = { x: Math.cos(a) * i * 0.5, z: Math.sin(a) * i * 0.5 };
  }

  const all = (k) => () => out[k];
  return {
    CHUNK: size, size, lane, bounds, spawn,
    barriers: all('barriers'),
    gates: all('gates'),
    props: all('props'),
    fireflies: all('fireflies'),
    powerups: all('powerups'),
    graves: all('graves'),
  };
}

export function createWorld({ seed = 1, spacing = FLY_SPACING, fence = 1 } = {}) {
  const raws = new Map();
  const chunks = new Map();

  function raw(cx, cz) {
    const key = `${cx},${cz}`;
    let c = raws.get(key);
    if (!c) raws.set(key, (c = rawChunk(seed, cx, cz, spacing, fence)));
    return c;
  }

  // A chunk's own items, rejected against its 3x3 neighbourhood. Rejection is
  // what makes the stand-in FAIR rather than merely present: a firefly inside a
  // headstone or a grave under a fence is an unfair world, and a soak run
  // against an unfair world measures the world instead of the rules.
  function chunkAt(cx, cz) {
    const key = `${cx},${cz}`;
    let c = chunks.get(key);
    if (c) return c;
    const me = raw(cx, cz);
    const nbBarriers = [];
    const nbProps = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = raw(cx + dx, cz + dz);
        for (const b of n.barriers) nbBarriers.push(b);
        for (const p of n.props) nbProps.push(p);
      }
    }
    // Two fences crossing is both ugly and the way an accidental gateless
    // pocket gets built. The whole run yields rather than the offending
    // segment, so a gate is never orphaned from the fence it was cut into, and
    // only the chunk with the larger key yields, so the decision is symmetric.
    let crosses = false;
    for (let dz = -1; dz <= 1 && !crosses; dz++) {
      for (let dx = -1; dx <= 1 && !crosses; dx++) {
        if (!dx && !dz) continue;
        if ((cz + dz) * 1000 + (cx + dx) > cz * 1000 + cx) continue;
        const nb = raw(cx + dx, cz + dz);
        for (const a of me.barriers) {
          for (const b of nb.barriers) {
            if (segCross(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0, b.x1, b.z1)) { crosses = true; break; }
          }
          // And a run that ends INSIDE a neighbour's pen by walking through its
          // gate. That crosses no segment, so the intersection test above never
          // sees it, and it plugs the only way in. It cost 1 world in 200 its
          // F3 before this was here, which is the kind of thing that is only
          // ever found by checking rather than by looking.
          if (!crosses) {
            for (const g of nb.gates) if (segPointDist(a, g.x, g.z) < 1.5) { crosses = true; break; }
          }
          if (crosses) break;
        }
      }
    }
    const barriers = crosses ? [] : me.barriers;
    const gates = crosses ? [] : me.gates;
    const liveBarriers = nbBarriers.filter((b) => !crosses || me.barriers.indexOf(b) === -1);

    const clearOf = (x, z, r) => {
      for (const b of liveBarriers) if (segPointDist(b, x, z) < r + b.half) return false;
      for (const p of nbProps) if (Math.hypot(p.x - x, p.z - z) < r + p.radius) return false;
      return true;
    };
    // A gate has to admit a disc of 0.60, and it is the APPROACH and not the
    // opening that has to be clear. A prop 1.271 from a gate centre, just
    // outside a keep-out disc of 1.270, plugged the mouth of one of these and
    // cost 3% of worlds their F3: a walker cannot use an opening it cannot
    // reach. So the keep-out is a CAPSULE about the line THROUGH the gate,
    // 2.2 units either side, which is the corridor a body has to travel.
    const nbGates = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const g of raw(cx + dx, cz + dz).gates) nbGates.push(g);
    const inGate = (x, z, r) => {
      for (const g of nbGates) {
        const nx = -g.dz;
        const nz = g.dx;
        const along = (x - g.x) * nx + (z - g.z) * nz;
        const t = along < -2.2 ? -2.2 : along > 2.2 ? 2.2 : along;
        if (Math.hypot(x - (g.x + nx * t), z - (g.z + nz * t)) < 0.62 + r) return true;
      }
      return false;
    };

    c = {
      barriers,
      gates,
      // Props keep clear of fences and gates. They may still touch each other,
      // which is a look problem rather than a fairness one.
      props: me.props.filter((p) => {
        for (const b of liveBarriers) if (segPointDist(b, p.x, p.z) < p.radius + b.half + 0.05) return false;
        return !inGate(p.x, p.z, p.radius);
      }),
      // A firefly must be somewhere the ghost's own disc can reach it, so it
      // needs the pick radius of room and not merely its own point.
      fireflies: me.fireflies.filter((f) => clearOf(f.x, f.z, 0.62) && !inGate(f.x, f.z, 0.2)),
      powerups: me.powerups.filter((p) => clearOf(p.x, p.z, 0.75)),
      // A grave must admit the skeleton's body, or something climbs out of the
      // ground already stuck.
      graves: me.graves.filter((g) => clearOf(g.x, g.z, 0.70) && !inGate(g.x, g.z, 0.4)),
    };
    chunks.set(key, c);
    return c;
  }

  // Chunk selection is padded by the longest thing a neighbour can reach in
  // with, which is a fence run of 8 panels. POINT items are then filtered back
  // to the box, so a query returns what is in the box and not what is in the
  // chunks that overlap it. Segments are kept if their extent overlaps.
  const PAD = 18;
  function collect(box, key, point) {
    const c0 = Math.floor((box.minX - PAD) / CHUNK);
    const c1 = Math.floor((box.maxX + PAD) / CHUNK);
    const r0 = Math.floor((box.minZ - PAD) / CHUNK);
    const r1 = Math.floor((box.maxZ + PAD) / CHUNK);
    const out = [];
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (const it of chunkAt(cx, cz)[key]) {
          if (point) {
            if (it.x < box.minX || it.x > box.maxX || it.z < box.minZ || it.z > box.maxZ) continue;
          } else if (Math.min(it.x0 ?? it.x, it.x1 ?? it.x) > box.maxX
            || Math.max(it.x0 ?? it.x, it.x1 ?? it.x) < box.minX
            || Math.min(it.z0 ?? it.z, it.z1 ?? it.z) > box.maxZ
            || Math.max(it.z0 ?? it.z, it.z1 ?? it.z) < box.minZ) continue;
          out.push(it);
        }
      }
    }
    return out;
  }

  // The spawn has to be somewhere the ghost fits, and (0, 0) is not always.
  // Spiral out until it is.
  let spawn = { x: 0, z: 0 };
  {
    const near = (x, z) => {
      const box = { minX: x - 4, minZ: z - 4, maxX: x + 4, maxZ: z + 4 };
      for (const b of collect(box, 'barriers', false)) if (segPointDist(b, x, z) < 0.75) return false;
      for (const p of collect(box, 'props', true)) if (Math.hypot(p.x - x, p.z - z) < 0.62 + p.radius) return false;
      return true;
    };
    for (let r = 0; r < 40 && !near(spawn.x, spawn.z); r++) {
      const a = r * 2.4;
      spawn = { x: Math.cos(a) * r * 0.8, z: Math.sin(a) * r * 0.8 };
    }
  }

  return {
    CHUNK,
    spacing,
    fence,
    spawn,
    barriers: (box) => collect(box, 'barriers', false),
    gates: (box) => collect(box, 'gates', true),
    props: (box) => collect(box, 'props', true),
    fireflies: (box) => collect(box, 'fireflies', true),
    powerups: (box) => collect(box, 'powerups', true),
    graves: (box) => collect(box, 'graves', true),
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
