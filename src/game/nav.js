// Navigation, for both halves of the chase, in an endless open world.
//
// WHAT REPLACED WHAT
//
// The old version of this file described a 2.0 lattice: the ghost moved freely
// inside a union of corridor squares and the skeletons ran on a graph of
// corridor centrelines. Both descriptions are gone with the lattice. What
// replaces them:
//
//   the ground     is open. There is no corridor and no cell. A point is
//                  walkable if a disc of the mover's radius fits there, which
//                  means clear of every SOLID PROP and every BARRIER capsule.
//   a barrier      is a fence segment, a line with a half thickness. It blocks
//                  a skeleton absolutely and a GROUNDED ghost absolutely, and
//                  it does not exist at all to a ghost in the air. That single
//                  asymmetry is the game.
//   a gate         is a literal GAP in the barrier list. The world publishes
//                  the spans either side of it and a marker at the opening, so
//                  "does this line cross a fence" is a pure segment test with
//                  no gate exception in it. That test is the hottest thing in
//                  this file and it is why the interface is shaped that way.
//   a passage      is a gate OR the free end of a fence run. Both are places
//                  where a skeleton can get past a fence, and the distinction
//                  between them matters to nobody: an open run is a thing you
//                  walk round, a pen is a thing you walk into, and to a
//                  skeleton choosing a way past, they are the same kind of
//                  decision. Passages are the JUNCTIONS of the new world and
//                  chase.js is built on that claim.
//
// WHAT IS DELIBERATELY NOT HERE
//
// There is no path finder. chase.js does not call one and must not: Pac-Man's
// ghosts do not path find, they take a greedy local decision at a junction, and
// copying the trick rather than the behaviour is the whole reason they read as
// intelligent. What this file supplies is the two primitives that decision
// needs, VISIBILITY and PASSAGES, and nothing above them.
//
// The bot does plan, over a grid, because a bot is a model of a PLAYER and a
// player plans. `makeGrid` is here rather than in bot.js because soak.mjs needs
// exactly the same occupancy rasterisation to answer its fairness questions,
// and two copies of it would drift.
//
// Everything is in WORLD x/z. The grid frame, the isometry and the u/v
// coordinates are gone; there is one frame now and it is the one the world
// generator publishes in.

// The window the rules keep resident around the player. Everything above pulls
// from this, so it has to hold the furthest thing any of them looks at: a
// scatter target is 26 units out, a re-homed grave up to 20, and the bot plans
// over 60. 72 covers all of them with room, and the window is only rebuilt when
// the player has moved SLACK from where it was built.
export const WINDOW = 72;
const SLACK = 20;
// Bucket size for the barrier and prop indexes. A bucket has to be bigger than
// the longest thing in it is thick and small enough that a query touches few:
// 4.0 puts about two panels and a handful of stones in each.
const BUCKET = 4.0;

const boxOf = (x, z, r) => ({ minX: x - r, minZ: z - r, maxX: x + r, maxZ: z + r });

// Squared distance from point (px, pz) to segment (ax, az)-(bx, bz).
function pointSegD2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t;
  const qz = az + dz * t;
  return (px - qx) ** 2 + (pz - qz) ** 2;
}

// Squared distance between two segments. This is the whole crossing test: a
// line from A to B crosses a fence if it comes within (half + radius) of the
// fence's centreline, and that is exact for a capsule rather than an
// approximation of one. It also handles the case a plain intersection test
// gets wrong, a line that stops just short of the fence but leaves no room for
// the body that is following it.
function segSegD2(ax, az, bx, bz, cx, cz, dx, dz) {
  // Proper crossing first, which is the common case for a long leg.
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  let m = pointSegD2(ax, az, cx, cz, dx, dz);
  const b1 = pointSegD2(bx, bz, cx, cz, dx, dz);
  if (b1 < m) m = b1;
  const c1 = pointSegD2(cx, cz, ax, az, bx, bz);
  if (c1 < m) m = c1;
  const d5 = pointSegD2(dx, dz, ax, az, bx, bz);
  if (d5 < m) m = d5;
  return m;
}

function makeIndex(items, extentOf) {
  const map = new Map();
  for (const it of items) {
    const e = extentOf(it);
    const a0 = Math.floor(e.minX / BUCKET);
    const a1 = Math.floor(e.maxX / BUCKET);
    const b0 = Math.floor(e.minZ / BUCKET);
    const b1 = Math.floor(e.maxZ / BUCKET);
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const k = a * 73856093 ^ b * 19349663;
        let list = map.get(k);
        if (!list) map.set(k, (list = []));
        list.push(it);
      }
    }
  }
  return {
    // Everything whose bucket overlaps the box. May repeat an item that spans
    // several buckets, which every caller here is a min or an any over, so it
    // costs a little time and never an answer.
    query(minX, minZ, maxX, maxZ, out) {
      out.length = 0;
      const a0 = Math.floor(minX / BUCKET);
      const a1 = Math.floor(maxX / BUCKET);
      const b0 = Math.floor(minZ / BUCKET);
      const b1 = Math.floor(maxZ / BUCKET);
      // A big query would visit more buckets than there are items; fall back.
      if ((a1 - a0 + 1) * (b1 - b0 + 1) > 4096) { for (const it of items) out.push(it); return out; }
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const list = map.get(a * 73856093 ^ b * 19349663);
          if (list) for (const it of list) out.push(it);
        }
      }
      return out;
    },
  };
}

export function createNav(world, { window: win = WINDOW } = {}) {
  let centreX = NaN;
  let centreZ = NaN;
  let barriers = [];
  let props = [];
  let gates = [];
  let barrierIx = null;
  let propIx = null;
  let passageList = null;
  let epoch = 0;
  const scratch = [];
  const scratch2 = [];

  function rebuild(x, z) {
    centreX = x;
    centreZ = z;
    const box = boxOf(x, z, win);
    barriers = world.barriers(box);
    props = world.props(box).filter((p) => p.solid !== false);
    gates = world.gates(box);
    barrierIx = makeIndex(barriers, (b) => ({
      minX: Math.min(b.x0, b.x1) - b.half, maxX: Math.max(b.x0, b.x1) + b.half,
      minZ: Math.min(b.z0, b.z1) - b.half, maxZ: Math.max(b.z0, b.z1) + b.half,
    }));
    propIx = makeIndex(props, (p) => ({
      minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius,
    }));
    passageList = null;
    epoch++;
  }

  // Called once a frame with the player's position. Everything else assumes
  // the window is current, which is cheaper than every query checking.
  function focus(x, z) {
    if (!Number.isFinite(centreX) || Math.hypot(x - centreX, z - centreZ) > SLACK) rebuild(x, z);
  }

  // --- the two primitives ---------------------------------------------------

  // Does the segment from (ax,az) to (bx,bz), swept by a disc of radius r,
  // touch a fence? The one question chase.js asks, thousands of times a second.
  function crossesBarrier(ax, az, bx, bz, r = 0) {
    const minX = Math.min(ax, bx) - r - 0.2;
    const maxX = Math.max(ax, bx) + r + 0.2;
    const minZ = Math.min(az, bz) - r - 0.2;
    const maxZ = Math.max(az, bz) + r + 0.2;
    barrierIx.query(minX, minZ, maxX, maxZ, scratch);
    for (const b of scratch) {
      const lim = b.half + r;
      if (segSegD2(ax, az, bx, bz, b.x0, b.z0, b.x1, b.z1) < lim * lim - 1e-9) return true;
    }
    return false;
  }

  function crossesProp(ax, az, bx, bz, r = 0) {
    const minX = Math.min(ax, bx) - r - 1.2;
    const maxX = Math.max(ax, bx) + r + 1.2;
    const minZ = Math.min(az, bz) - r - 1.2;
    const maxZ = Math.max(az, bz) + r + 1.2;
    propIx.query(minX, minZ, maxX, maxZ, scratch2);
    for (const p of scratch2) {
      const lim = p.radius + r;
      if (pointSegD2(p.x, p.z, ax, az, bx, bz) < lim * lim - 1e-9) return true;
    }
    return false;
  }

  // A skeleton's leg, and the bot's straight line: clear of both.
  const visible = (ax, az, bx, bz, r = 0) => !crossesBarrier(ax, az, bx, bz, r) && !crossesProp(ax, az, bx, bz, r);

  // --- the ghost's collision ------------------------------------------------
  //
  // A disc against capsules and circles, pushed out of everything it overlaps,
  // three passes. Sliding falls out of it exactly as it did against the old
  // lattice: the component of the move along a surface survives the push.
  //
  // `air` is the whole jump: an airborne ghost is resolved against props and
  // not against fences.
  function resolveDisc(x, z, r, air = false) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      if (!air) {
        barrierIx.query(x - r - 0.2, z - r - 0.2, x + r + 0.2, z + r + 0.2, scratch);
        for (const b of scratch) {
          const lim = b.half + r;
          const dx = b.x1 - b.x0;
          const dz = b.z1 - b.z0;
          const ll = dx * dx + dz * dz;
          let t = ll > 1e-12 ? ((x - b.x0) * dx + (z - b.z0) * dz) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = b.x0 + dx * t;
          const qz = b.z0 + dz * t;
          let nx = x - qx;
          let nz = z - qz;
          let d = Math.hypot(nx, nz);
          if (d >= lim - 1e-9) continue;
          if (d < 1e-9) {
            // Dead on the centreline after a pathological step. Leave by the
            // fence's own normal, which is always defined.
            const il = 1 / Math.max(1e-9, Math.hypot(dx, dz));
            nx = -dz * il; nz = dx * il; d = 1;
          } else { nx /= d; nz /= d; }
          x = qx + nx * lim;
          z = qz + nz * lim;
          moved = true;
        }
      }
      propIx.query(x - r - 1.2, z - r - 1.2, x + r + 1.2, z + r + 1.2, scratch2);
      for (const p of scratch2) {
        const lim = p.radius + r;
        let nx = x - p.x;
        let nz = z - p.z;
        let d = Math.hypot(nx, nz);
        if (d >= lim - 1e-9) continue;
        if (d < 1e-9) { nx = 1; nz = 0; d = 1; } else { nx /= d; nz /= d; }
        x = p.x + nx * lim;
        z = p.z + nz * lim;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  function discClear(x, z, r, air = false) {
    if (!air) {
      barrierIx.query(x - r - 0.2, z - r - 0.2, x + r + 0.2, z + r + 0.2, scratch);
      for (const b of scratch) {
        const lim = b.half + r;
        if (pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1) < lim * lim - 1e-6) return false;
      }
    }
    propIx.query(x - r - 1.2, z - r - 1.2, x + r + 1.2, z + r + 1.2, scratch2);
    for (const p of scratch2) {
      const lim = p.radius + r;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim - 1e-6) return false;
    }
    return true;
  }

  // --- passages -------------------------------------------------------------
  //
  // The junctions. A gate is one. So is the free END of a fence run, and it is
  // the more common one in a world where fences are sparse and mostly open:
  // going round the end of a fence is the same decision as going through a gate
  // and reads the same on screen.
  //
  // An end is FREE if no other barrier segment ends at the same point, which is
  // what distinguishes the corner of a pen (two segments meet, you cannot get
  // past) from the tip of a run (one segment stops, you can). The passage point
  // is that tip pushed out along the run by `clear`, so a mover aiming at it
  // does not clip the post.
  const PASS_CLEAR = 0.85;
  function passages() {
    if (passageList) return passageList;
    const out = [];
    for (const g of gates) out.push({ x: g.x, z: g.z, kind: 'gate', id: g.id });
    const ends = new Map();
    const key = (x, z) => `${Math.round(x * 32)},${Math.round(z * 32)}`;
    for (const b of barriers) {
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z1]]) {
        const k = key(x, z);
        ends.set(k, (ends.get(k) || 0) + 1);
      }
    }
    for (const b of barriers) {
      const dx = b.x1 - b.x0;
      const dz = b.z1 - b.z0;
      const il = 1 / Math.max(1e-9, Math.hypot(dx, dz));
      for (const [x, z, s] of [[b.x0, b.z0, -1], [b.x1, b.z1, 1]]) {
        if (ends.get(key(x, z)) !== 1) continue;
        const px = x + dx * il * PASS_CLEAR * s;
        const pz = z + dz * il * PASS_CLEAR * s;
        // An end that sits in a gate's mouth is the gate, said twice.
        let dup = false;
        for (const g of gates) if ((g.x - px) ** 2 + (g.z - pz) ** 2 < 2.5 * 2.5) { dup = true; break; }
        if (!dup) out.push({ x: px, z: pz, kind: 'end', id: `${b.id}${s > 0 ? '+' : '-'}` });
      }
    }
    passageList = out;
    return out;
  }

  // Passages within `r` of a point, into `out`. chase.js's whole world view.
  function passagesNear(x, z, r, out = []) {
    out.length = 0;
    const r2 = r * r;
    for (const p of passages()) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= r2) out.push(p);
    return out;
  }

  // --- the occupancy grid ---------------------------------------------------
  //
  // Used by the bot to plan and by the soak to answer every fairness question.
  // It is a rasterisation of exactly the two primitives above, so a claim
  // proved on the grid is a claim about the same geometry the characters move
  // in, at the grid's resolution and no finer. That last clause is the honest
  // caveat and the soak states it.
  //
  //   blocked[i]  a disc of radius r does not fit at the cell centre
  //   wall[i]     8 bits, one per neighbour, set if a BARRIER lies across that
  //               step. Kept apart from blocked because the ghost in the air
  //               ignores exactly this and nothing else.
  const DIR8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function makeGrid({ x, z, half, cell = 1.25, radius = 0.55 }) {
    const n = Math.max(2, Math.ceil((half * 2) / cell));
    const x0 = x - (n * cell) / 2;
    const z0 = z - (n * cell) / 2;
    const blocked = new Uint8Array(n * n);
    const wall = new Uint8Array(n * n * 8);
    const cx = (i) => x0 + (i % n) * cell + cell / 2;
    const cz = (i) => z0 + ((i / n) | 0) * cell + cell / 2;
    for (let i = 0; i < n * n; i++) if (!discClear(cx(i), cz(i), radius)) blocked[i] = 1;
    for (let i = 0; i < n * n; i++) {
      if (blocked[i]) continue;
      const a = i % n;
      const b = (i / n) | 0;
      for (let d = 0; d < 8; d++) {
        const na = a + DIR8[d][0];
        const nb = b + DIR8[d][1];
        if (na < 0 || nb < 0 || na >= n || nb >= n) { wall[i * 8 + d] = 1; continue; }
        const j = nb * n + na;
        if (blocked[j]) { wall[i * 8 + d] = 1; continue; }
        if (crossesBarrier(cx(i), cz(i), cx(j), cz(j), radius * 0.5)) wall[i * 8 + d] = 1;
        else if (crossesProp(cx(i), cz(i), cx(j), cz(j), radius * 0.5)) wall[i * 8 + d] = 1;
      }
    }
    return {
      n, cell, x0, z0, blocked, wall, DIR8,
      index: (wx, wz) => {
        const a = Math.floor((wx - x0) / cell);
        const b = Math.floor((wz - z0) / cell);
        return a < 0 || b < 0 || a >= n || b >= n ? -1 : b * n + a;
      },
      wx: cx,
      wz: cz,
      // The nearest cell a disc actually fits in, for a point that landed on a
      // blocked cell because the grid is coarser than the geometry.
      nearestOpen(wx, wz) {
        let a = Math.floor((wx - x0) / cell);
        let b = Math.floor((wz - z0) / cell);
        a = a < 0 ? 0 : a >= n ? n - 1 : a;
        b = b < 0 ? 0 : b >= n ? n - 1 : b;
        if (!blocked[b * n + a]) return b * n + a;
        for (let ring = 1; ring < 6; ring++) {
          for (let dz = -ring; dz <= ring; dz++) {
            for (let dx = -ring; dx <= ring; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
              const na = a + dx;
              const nb = b + dz;
              if (na < 0 || nb < 0 || na >= n || nb >= n) continue;
              if (!blocked[nb * n + na]) return nb * n + na;
            }
          }
        }
        return -1;
      },
    };
  }

  return {
    world,
    focus,
    get epoch() { return epoch; },
    get barriers() { return barriers; },
    get props() { return props; },
    get gates() { return gates; },
    crossesBarrier,
    crossesProp,
    visible,
    resolveDisc,
    discClear,
    passages,
    passagesNear,
    makeGrid,
    // For anything that wants the raw world through the same window.
    near: (x, z, r, key) => world[key](boxOf(x, z, r)),
    pointSegD2,
    segSegD2,
  };
}

export default createNav;
