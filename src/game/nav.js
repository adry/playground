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

// The window the rules keep resident around the player, rebuilt only once the
// player has drifted SLACK from where it was last built.
//
// WHY 64. It is a navigation query radius and not an instantiation radius: what
// it holds is a few hundred line segments and prop circles, tens of kilobytes,
// and it costs the renderer nothing. The renderer's streaming radius is
// independent of this number and should be whatever it can afford.
//
// The 64 is derived rather than picked. The furthest thing the rules ever look
// at is a scatter target 26 units from the ghost, plus the 24 units a skeleton
// standing on it looks out for a way past a fence, which is 50. Add SLACK,
// which is how far the ghost may drift from where the window was last built,
// and the window has to be 60. 64 is that with margin. If either of those two
// numbers moves, this one moves with them, and soak.mjs asserts the relation.
export const WINDOW = 64;
export const SLACK = 10;
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

// ---------------------------------------------------------------------------
// WHAT A PROP ACTUALLY TAKES UP ON THE FLOOR
//
// A prop record publishes two things: `radius`, the circle that CONTAINS its
// footprint, and `foot`, the footprint itself. Everything that decides WHERE
// PROPS GO has always used `foot` -- layout/geom.js, the placer, the audit, the
// repair pass, the editor's placement indicator, the keep-clear zone in front
// of a headstone -- and the one thing that decided WHERE THE GHOST MAY GO used
// `radius`. So the game collided against a circle drawn round a box the level
// was authored against, and the two disagreed by the corner of every box:
//
//   scroll    0.834 circle around a 1.62 by 0.41 stone: 0.63 of nothing
//   chest     0.922 around 1.67 by 0.79:                0.53 of nothing
//   twin      0.777 around 1.48 by 0.48:                0.54 of nothing
//   kerb      2.196 around a 0.93 wide plot border:     1.73 of nothing
//
// Over the shipped level that is 38.6 square units of collision against 23.4 of
// authored footprint, 65% more, and it is what the owner was reporting: the
// ghost stopping half a metre in front of a headstone with nothing there. It is
// also what MANUFACTURED the two sealed pockets in the pen, since a chest's
// 0.53 of phantom radius is most of what closes that corner.
//
// So a prop with a box footprint is now collided against as an oriented box.
// The circle stays for anything genuinely round (pumpkins, lanterns, the
// fountain) and for any world that publishes no `foot` at all, which is the
// honest fallback: a caller that cannot say what shape a prop is gets the
// conservative answer it always got.
//
// THE FRAME. `halfU` runs along the prop's local X and `halfV` along its local
// Z, and a three.js yaw about Y puts local (u, v) at world
// (u*cos + v*sin, -u*sin + v*cos). That is the same convention as
// layout/geom.js discBox and the same one scene.js applies to the mesh, which
// is the whole point: the collider is now the shape you can see. stuck.mjs
// checks the two implementations against each other so they cannot drift.
//
// THE HEDGE gets this for free and needs it most. Two hedge segments are meant
// to touch along their own U axis with no gap at all (`abut: 'u'`, see
// layout/footprints.js), and a run of them is meant to be a wall. As circles
// their keep-out bulged 0.27 beyond the leaves on both faces of the run; as
// boxes an abutting pair is one continuous wall exactly as wide as the hedge.
const boxFoot = (p) => {
  const f = p.foot;
  return f && f.shape === 'box' && f.halfU > 0 && f.halfV > 0 ? f : null;
};

// The prop's own frame. Written into these rather than returned, because this
// runs a few million times in the overnight check and an object per call is the
// only allocation in the whole resolver.
let locU = 0;
let locV = 0;
let locC = 1;
let locS = 0;
function intoProp(p, x, z) {
  locC = Math.cos(p.yaw || 0);
  locS = Math.sin(p.yaw || 0);
  const dx = x - p.x;
  const dz = z - p.z;
  locU = dx * locC - dz * locS;
  locV = dx * locS + dz * locC;
}

// Squared distance from a point to an axis-aligned rectangle centred at the
// origin. Zero inside it.
function pointRectD2(u, v, hu, hv) {
  const du = Math.abs(u) - hu;
  const dv = Math.abs(v) - hv;
  const au = du > 0 ? du : 0;
  const av = dv > 0 ? dv : 0;
  return au * au + av * av;
}

// Does the segment touch the rectangle? The slab test, unrolled.
function segRectHits(au, av, bu, bv, hu, hv) {
  const du = bu - au;
  const dv = bv - av;
  let t0 = 0;
  let t1 = 1;
  if (du > -1e-12 && du < 1e-12) {
    if (au < -hu || au > hu) return false;
  } else {
    let ta = (-hu - au) / du;
    let tb = (hu - au) / du;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (dv > -1e-12 && dv < 1e-12) {
    if (av < -hv || av > hv) return false;
  } else {
    let ta = (-hv - av) / dv;
    let tb = (hv - av) / dv;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

// DOES THIS PROP BLOCK A BODY OF RADIUS r STANDING AT (x, z)?
//
// The one implementation of "a prop's footprint against a body", exported
// because it is reproduced elsewhere and reproductions drift. world/repair.js
// carries its own four-line copy of the circle version and says so in a
// comment; until it imports this instead, the repair pass and the audit are
// judging levels against a fatter prop than the game collides with, which is
// safe in the direction of removing props that did not need removing and NOT
// safe in the other: a pocket that only exists once the props are their real
// size is a pocket the audit cannot see. See rules.js tryJump, which is what
// currently stops one of those costing a run.
export function propBlocks(p, x, z, r, slack = 1e-6) {
  const f = boxFoot(p);
  if (f) {
    intoProp(p, x, z);
    return pointRectD2(locU, locV, f.halfU, f.halfV) < r * r - slack;
  }
  const lim = p.radius + r;
  return (x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim - slack;
}

// Squared distance from a segment to a prop's box. Exact: for two disjoint
// convex sets the closest pair always has a vertex at one end, so it is the
// smallest of the two endpoints against the rectangle and the four corners
// against the segment.
function segPropD2(p, f, ax, az, bx, bz) {
  intoProp(p, ax, az);
  const au = locU;
  const av = locV;
  const c = locC;
  const s = locS;
  const dx = bx - p.x;
  const dz = bz - p.z;
  const bu = dx * c - dz * s;
  const bv = dx * s + dz * c;
  const hu = f.halfU;
  const hv = f.halfV;
  if (segRectHits(au, av, bu, bv, hu, hv)) return 0;
  let best = pointRectD2(au, av, hu, hv);
  const other = pointRectD2(bu, bv, hu, hv);
  if (other < best) best = other;
  for (let i = 0; i < 4; i++) {
    const cu = i === 0 || i === 3 ? -hu : hu;
    const cv = i < 2 ? -hv : hv;
    const d = pointSegD2(cu, cv, au, av, bu, bv);
    if (d < best) best = d;
  }
  return best;
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
      // A box that is not a box. An infinite coordinate makes b0 and b1 both
      // Infinity, and `for (let b = Infinity; b <= Infinity; b++)` never
      // advances: the loop below runs for ever, filling `out` until the tab
      // dies. The oversize test above does not catch it, because
      // Infinity - Infinity is NaN and NaN > 4096 is false. Everything upstream
      // of here should be keeping NaN and Infinity out of a position, and this
      // is the line that says so if one gets through.
      if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) {
        for (const it of items) out.push(it);
        return out;
      }
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
  const scratch3 = [];
  let hasWalls = false;

  function rebuild(x, z) {
    centreX = x;
    centreZ = z;
    const box = boxOf(x, z, win);
    barriers = world.barriers(box);
    props = world.props(box).filter((p) => p.solid !== false);
    gates = world.gates(box);
    hasWalls = barriers.some(unjumpable);
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

  // Shorten a segment's START by `skip`, and why that option has to exist.
  //
  // A swept test asks "does a disc of radius r sliding from A to B touch
  // anything". If the disc is ALREADY touching something at A, the answer is
  // yes for every B, and a mover that plans with a clearance larger than its
  // body is always already touching something whenever it is against a wall.
  // Every direction then reads as blocked, and the mover stops for ever. That
  // one mistake produced three different symptoms before it was understood: a
  // skeleton frozen in a gate mouth, a skeleton frozen in a corner, and a
  // wall-follow that chose the direction pointing INTO the wall because the
  // test it used to pick a side failed both ways.
  //
  // Forgiving the first `skip` units of the segment is the fix, and it is
  // sound: what the mover needs to know is whether the way AHEAD is clear, and
  // where it is standing right now is not a question it can act on.
  function trimStart(ax, az, bx, bz, skip) {
    if (!skip) return [ax, az];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len <= skip * 1.5) return [ax, az];
    return [ax + (dx / len) * skip, az + (dz / len) * skip];
  }

  // Does the segment from (ax,az) to (bx,bz), swept by a disc of radius r,
  // touch a fence? The one question chase.js asks, thousands of times a second.
  function crossesBarrier(ax, az, bx, bz, r = 0, skip = 0) {
    if (skip) [ax, az] = trimStart(ax, az, bx, bz, skip);
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

  // The arena's perimeter. It is tall on purpose and it is the one thing in the
  // world the ghost cannot vault, which is what makes the arena an arena:
  // without it the answer to "can I get out" is always yes and the boundary is
  // decoration. Everything else about it is a barrier, so it is the same list
  // with one flag rather than a second kind of object.
  //
  // The world publishes that flag as `jumpable: false`; the stand-in used
  // `wall: true`. Both are read, so neither generator has to change for the
  // other, and a barrier with neither field is a fence, which is the safe
  // default: a rule that guessed the other way would let the ghost out.
  const unjumpable = (b) => b.jumpable === false || b.wall === true;
  function crossesWall(ax, az, bx, bz, r = 0) {
    if (!hasWalls) return false;
    const minX = Math.min(ax, bx) - r - 0.6;
    const maxX = Math.max(ax, bx) + r + 0.6;
    const minZ = Math.min(az, bz) - r - 0.6;
    const maxZ = Math.max(az, bz) + r + 0.6;
    barrierIx.query(minX, minZ, maxX, maxZ, scratch3);
    for (const b of scratch3) {
      if (!unjumpable(b)) continue;
      const lim = b.half + r;
      if (segSegD2(ax, az, bx, bz, b.x0, b.z0, b.x1, b.z1) < lim * lim - 1e-9) return true;
    }
    return false;
  }

  function crossesProp(ax, az, bx, bz, r = 0, skip = 0) {
    if (skip) [ax, az] = trimStart(ax, az, bx, bz, skip);
    const minX = Math.min(ax, bx) - r - 1.2;
    const maxX = Math.max(ax, bx) + r + 1.2;
    const minZ = Math.min(az, bz) - r - 1.2;
    const maxZ = Math.max(az, bz) + r + 1.2;
    propIx.query(minX, minZ, maxX, maxZ, scratch2);
    for (const p of scratch2) {
      const f = boxFoot(p);
      if (f) {
        if (segPropD2(p, f, ax, az, bx, bz) < r * r - 1e-9) return true;
      } else {
        const lim = p.radius + r;
        if (pointSegD2(p.x, p.z, ax, az, bx, bz) < lim * lim - 1e-9) return true;
      }
    }
    return false;
  }

  // A skeleton's leg, and the bot's straight line: clear of both.
  const visible = (ax, az, bx, bz, r = 0, skip = 0) => !crossesBarrier(ax, az, bx, bz, r, skip)
    && !crossesProp(ax, az, bx, bz, r, skip);

  // --- the ghost's collision ------------------------------------------------
  //
  // A disc against capsules and circles, pushed out of whatever it overlaps.
  // Sliding falls out of it exactly as it did against the old lattice: the
  // component of the move along a surface survives the push.
  //
  // `air` is the whole jump: an airborne ghost is resolved against props and
  // not against fences.
  //
  // ONE CONTACT AT A TIME, DEEPEST FIRST, and that is a change from the three
  // passes over every contact in list order this used to make. Sequential
  // projection does not converge when the keep-out regions of two colliders
  // OVERLAP: out of A is into B, out of B is into A, and each pass hands the
  // body back to the other one. The order the two happen to come out of the
  // index then decides where it lands, and where it lands can be a fixed point
  // of the whole step -- integrate, resolve, arrive back at exactly the same
  // coordinates -- for every direction the stick can be pushed. That is a lost
  // run: the ghost stands there and nothing the player does moves it.
  //
  // Taking the deepest contact first is the standard cure and it costs nothing.
  // It converges wherever a free point exists nearby, because each step is the
  // largest single correction available and cannot be undone by a smaller one.
  // The common cases are cheaper than they were, too: one contact resolves in
  // two iterations rather than three passes, and no contact in one.
  //
  // Where no free point exists at all -- a genuine WEDGE, which is what two
  // props closer together than a body makes, and which the bushes are about to
  // make many more of -- no amount of iterating can succeed, and the fallback
  // below is what guarantees the ghost is never held.
  const CONTACT_PASSES = 12;

  // The deepest overlap at (x, z), as the place the centre has to move to.
  // Returns the depth, or 0 when the body is clear.
  let pushX = 0;
  let pushZ = 0;
  function deepestPush(x, z, r, air) {
    let depth = 0;
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
        if (!(d < lim - 1e-9)) continue;
        if (lim - d <= depth) continue;
        if (d < 1e-9) {
          // Dead on the centreline after a pathological step, or a barrier of
          // zero length. Leave by the fence's own normal where there is one and
          // by a fixed direction where there is not: a degenerate segment has
          // no normal, and the alternative is a division by zero that puts NaN
          // into the position and never comes out of it.
          const len = Math.hypot(dx, dz);
          if (len > 1e-9) { nx = -dz / len; nz = dx / len; } else { nx = 1; nz = 0; }
          d = 1;
        } else { nx /= d; nz /= d; }
        depth = lim - d;
        pushX = qx + nx * lim;
        pushZ = qz + nz * lim;
      }
    }
    propIx.query(x - r - 1.2, z - r - 1.2, x + r + 1.2, z + r + 1.2, scratch2);
    for (const p of scratch2) {
      const f = boxFoot(p);
      if (f) {
        intoProp(p, x, z);
        const hu = f.halfU;
        const hv = f.halfV;
        // The nearest point of the rectangle, in the prop's own frame.
        const qu = locU < -hu ? -hu : locU > hu ? hu : locU;
        const qv = locV < -hv ? -hv : locV > hv ? hv : locV;
        const eu = locU - qu;
        const ev = locV - qv;
        const d = Math.hypot(eu, ev);
        let tu;
        let tv;
        let deep;
        if (d > 1e-9) {
          if (d >= r - 1e-9) continue;    // outside the box and clear of it
          deep = r - d;
          tu = qu + (eu / d) * r;
          tv = qv + (ev / d) * r;
        } else {
          // The centre is INSIDE the box, which one frame of movement cannot
          // do to a body but a spawn or a moved prop can. Out by the nearest
          // face, because leaving a box by its long axis when the short one is
          // a hand's breadth away is a teleport.
          const du = hu - Math.abs(locU);
          const dv = hv - Math.abs(locV);
          if (du <= dv) {
            deep = du + r;
            tu = (locU >= 0 ? 1 : -1) * (hu + r);
            tv = locV;
          } else {
            deep = dv + r;
            tu = locU;
            tv = (locV >= 0 ? 1 : -1) * (hv + r);
          }
        }
        if (deep <= depth) continue;
        depth = deep;
        pushX = p.x + tu * locC + tv * locS;
        pushZ = p.z - tu * locS + tv * locC;
        continue;
      }
      const lim = p.radius + r;
      if (!(lim > 0)) continue;   // a prop with no footprint, or a NaN one
      let nx = x - p.x;
      let nz = z - p.z;
      let d = Math.hypot(nx, nz);
      if (!(d < lim - 1e-9)) continue;
      if (lim - d <= depth) continue;
      if (d < 1e-9) { nx = 1; nz = 0; d = 1; } else { nx /= d; nz /= d; }
      depth = lim - d;
      pushX = p.x + nx * lim;
      pushZ = p.z + nz * lim;
    }
    return depth;
  }

  // NOWHERE LEFT TO STAND, so find the nearest place there is.
  //
  // Reached only when the passes above have run out with the body still inside
  // something, which means the keep-out regions around it cover every point it
  // could be pushed to. Rings outward from where it is, nearest first, and the
  // first free point wins.
  //
  // TWO THINGS IT MAY NOT DO, and they are why this is not simply "the nearest
  // clear point". It may not put the body somewhere it could not have walked
  // to: a straight line from here to there that crosses a fence would hand the
  // player a vault they did not earn, and one that crosses the perimeter wall
  // would put them outside the arena, which is the one place the resolver can
  // never get them back from. And it may not cross a prop, because coming out
  // of the far side of a headstone is a teleport.
  //
  // Bounded at a body's width. A wedge a body deep is a hole in the level and
  // wants finding by world/repair.js, not papering over here; what this has to
  // fix is the centimetre or two of penetration one frame of movement can
  // produce.
  const WEDGE_RINGS = 6;
  const WEDGE_SPOKES = 24;
  function nearestFree(x, z, r, air) {
    const reach = r * 1.6;
    for (let k = 1; k <= WEDGE_RINGS; k++) {
      const d = (k / WEDGE_RINGS) * reach;
      for (let s = 0; s < WEDGE_SPOKES; s++) {
        const a = (s / WEDGE_SPOKES) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (!discClear(px, pz, r, air)) continue;
        if (!air && crossesBarrier(x, z, px, pz, 0)) continue;
        if (crossesProp(x, z, px, pz, 0)) continue;
        return { x: px, z: pz };
      }
    }
    return null;
  }

  function resolveDisc(x, z, r, air = false) {
    // A position that has already gone bad cannot be resolved into a good one,
    // and returning it unchanged propagates the NaN into everything downstream.
    // The window's centre is the last place anything is known to have been.
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return { x: Number.isFinite(centreX) ? centreX : 0, z: Number.isFinite(centreZ) ? centreZ : 0 };
    }
    for (let iter = 0; iter < CONTACT_PASSES; iter++) {
      if (!deepestPush(x, z, r, air)) return { x, z };
      x = pushX;
      z = pushZ;
    }
    const out = nearestFree(x, z, r, air);
    return out || { x, z };
  }

  // Push a walker out of anything it has ended up inside. The ghost has always
  // had this; the skeletons did not, and the omission was a hard failure rather
  // than an untidiness: a skeleton that walks to a scatter target outside the
  // arena presses into the wall, ends up 0.80 from a surface it needs 0.825
  // from, and from there EVERY leg it considers is blocked because the swept
  // test measures from a start point that is already in violation. It stands
  // still for the rest of the run. Three of them doing that is why a player who
  // never moved survived a quarter of arenas.
  function resolveWalker(x, z, r) {
    return resolveDisc(x, z, r, false);
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
      if (propBlocks(p, x, z, r)) return false;
    }
    return true;
  }

  // IS THERE ANYWHERE TO GO FROM HERE?
  //
  // Fitting and being somewhere you can leave are not the same question, and
  // rule 6 only ever asked the first one. A vault is allowed to cross a fence,
  // so it is the one move that can put the ghost somewhere walking never could:
  // the corner of a pen with a headstone across its mouth is a patch of ground
  // the body fits on, cannot walk into, and having landed on, can never walk
  // out of. Measured on the shipped level, the north-west corner of the pen is
  // a 13 centimetre island of exactly that, and src/game/stuck.mjs --jump gives
  // the recipe: run at 3.19 units a second from (2.25, -4.75) along
  // (0.92, 0.38) and jump.
  //
  // `need` is one body diameter, and it is not an arbitrary number: it is a
  // little more than the run-up the jump itself demands. Takeoff is refused
  // below 2.0 units a second, which from rest takes 0.095 s and 0.11 units of
  // ground, so anywhere the ghost can travel 1.10 units is somewhere it can
  // build a jump and leave again. Anywhere it cannot is a dead end whichever
  // way you look at it.
  //
  // A straight march rather than a flood, which is the conservative direction:
  // a pocket that is passable but BENDS inside 1.10 units reads as a dead end
  // and the jump into it is refused. That is a jump not taken; the alternative
  // is a run lost.
  function roomAt(x, z, r, need = 1.10, spokes = 16, step = 0.15) {
    const steps = Math.ceil(need / step);
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let ok = true;
      for (let k = 1; k <= steps; k++) {
        const d = Math.min(need, k * step);
        if (!discClear(x + dx * d, z + dz * d, r)) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
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
  // THREE KINDS OF END, and only one of them is a passage.
  //
  //   joint      two segments meet here, as at the corner of a pen. Not a way
  //              past. Detected by a shared endpoint.
  //   gate cheek the segment stops here because a GATE was cut out of the run.
  //              Not a way past either, or rather it is, but it is the gate and
  //              the gate is already in the list; counting it twice puts two
  //              aim points a metre apart in the same opening and a skeleton
  //              dithers between them.
  //   free end   the run simply stops. This IS a passage, and in a world where
  //              fences are sparse and mostly open it is the commoner one.
  //
  // The world is being asked to publish `end0`/`end1` as 'free' | 'gate' |
  // 'joint' so this is read rather than inferred, because splitting a run at a
  // gate makes a cheek that is conceptually shared and numerically is not. If
  // the flag is absent the geometry is inferred below, exactly: a cheek is an
  // endpoint lying within the gate's own opening, measured along the run.
  const PASS_CLEAR = 0.85;
  function endKind(b, which) {
    const flag = which < 0 ? b.end0 : b.end1;
    if (flag) return flag;
    return null;
  }
  function isGateCheek(b, x, z) {
    const dx = b.x1 - b.x0;
    const dz = b.z1 - b.z0;
    const il = 1 / Math.max(1e-9, Math.hypot(dx, dz));
    for (const g of gates) {
      const ox = x - g.x;
      const oz = z - g.z;
      // Along the run, and across it. A cheek is at the opening's lip, so
      // within half the opening along and on the line across.
      const along = Math.abs(ox * dx * il + oz * dz * il);
      const across = Math.abs(ox * -dz * il + oz * dx * il);
      if (across < 0.35 && along <= g.half + 0.30) return true;
    }
    return false;
  }
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
        const flag = endKind(b, s);
        if (flag ? flag !== 'free' : (ends.get(key(x, z)) !== 1 || isGateCheek(b, x, z))) continue;
        out.push({
          x: x + dx * il * PASS_CLEAR * s,
          z: z + dz * il * PASS_CLEAR * s,
          kind: 'end', id: `${b.id}${s > 0 ? '+' : '-'}`,
        });
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
  //   wall[i]     8 bytes, one per neighbour, set if that step is impossible
  //   fence[i]    the subset of those that are impossible because of a FENCE
  //   jump        a Map from cell to the cells a VAULT from it arrives at.
  //               Everything the asymmetry means, in one table, and derived
  //               from the geometry rather than from the raster: see below.
  const DIR8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function makeGrid({ x, z, half, cell = 1.25, radius = 0.55, jumpReach = 1.525 }) {
    const n = Math.max(2, Math.ceil((half * 2) / cell));
    const x0 = x - (n * cell) / 2;
    const z0 = z - (n * cell) / 2;
    const blocked = new Uint8Array(n * n);
    const wall = new Uint8Array(n * n * 8);
    // Which of those walls is a FENCE rather than a prop or a blocked cell.
    // The two have to be kept apart because the airborne ghost ignores exactly
    // one of them, and the bot's jump edges are laid on exactly this mask.
    const fence = new Uint8Array(n * n * 8);
    // A CELL'S REPRESENTATIVE POINT, and why it is not simply its centre.
    //
    // A raster flood is only as good as the points it samples, and sampling
    // cell centres asks the wrong question: it asks whether the MIDDLE of this
    // square is clear, when what matters is whether ANY of it is. A corridor
    // two units wide between two headstones is walkable, but if no cell centre
    // happens to land in it the flood cannot use it, and the region beyond
    // reads as unreachable. That error does not go away as the raster refines,
    // it merely gets luckier: F3 against the real generator came out at 24.0%,
    // 23.3%, 21.3%, 12.0% and 3.3% at 0.6 down to 0.25, falling the whole way
    // and still falling. A check that answers differently every time you ask it
    // more precisely is not measuring the world, and reporting its coarsest
    // answer as a defect rate would have been reporting the raster.
    //
    // So each cell keeps the best point IN it rather than the point at the
    // middle of it: the centre when the centre is clear, otherwise the clearest
    // of a small sub-sample. A cell is blocked only when no point in it can
    // hold a body. Everything downstream, the edges, the floods, the vault
    // links and the bot's pursuit, uses these points.
    const px = new Float64Array(n * n);
    const pz = new Float64Array(n * n);
    const SUB = [0, -0.34, 0.34];
    for (let i = 0; i < n * n; i++) {
      const bx = x0 + (i % n) * cell + cell / 2;
      const bz = z0 + ((i / n) | 0) * cell + cell / 2;
      px[i] = bx;
      pz[i] = bz;
      if (discClear(bx, bz, radius)) continue;
      let found = false;
      for (let a = 0; a < 3 && !found; a++) {
        for (let b = 0; b < 3 && !found; b++) {
          if (!a && !b) continue;
          const qx = bx + SUB[a] * cell;
          const qz = bz + SUB[b] * cell;
          if (!discClear(qx, qz, radius)) continue;
          px[i] = qx;
          pz[i] = qz;
          found = true;
        }
      }
      if (!found) blocked[i] = 1;
    }
    const cx = (i) => px[i];
    const cz = (i) => pz[i];
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
        // THE FULL RADIUS, not half of it. The step is a swept disc and it
        // needs the room a disc needs. An earlier version halved it to be
        // forgiving at corners, and the forgiveness bought a planner that
        // routed the ghost through gaps its own body does not fit through: it
        // jammed against a headstone at full stick for a hundred and ten
        // seconds and the run still reported itself as alive and well.
        if (crossesBarrier(cx(i), cz(i), cx(j), cz(j), radius)) { wall[i * 8 + d] = 1; fence[i * 8 + d] = 1; }
        else if (crossesProp(cx(i), cz(i), cx(j), cz(j), radius)) wall[i * 8 + d] = 1;
      }
    }
    // --- the vault links -------------------------------------------------
    //
    // Where the ghost can cross a fence, as pairs of cells. Getting this right
    // took two attempts and the first one was wrong in a way worth recording,
    // because it is the kind of wrong that looks like a working check.
    //
    // THE FIRST VERSION walked outward from each cell along an axis until it
    // found an open one, up to `jumpReach + cell` away. That last term is the
    // bug: the reach it searched DEPENDED ON THE CELL SIZE, so the ghost could
    // jump further on a coarse raster than on a fine one. The fairness rate it
    // produced was not converging as the raster refined, it was wandering:
    // F3 came out at 16.7%, 26.7% and 13.3% at 0.4, 0.5 and 0.75 on the same
    // three hundred levels. A check whose answer depends on how finely you ask
    // is not measuring the world.
    //
    // THIS VERSION asks the geometry instead, and the raster is only used to
    // say which cells the two ends fall in. A ghost hard against a fence is
    // `half + r` from its centreline; it must land at least `half + r` past it
    // on the other side; the jump carries `jumpReach`. So a vault exists at a
    // point on a fence exactly when a disc of radius r fits on both sides
    // within that budget, which is a question about two discs and a line and
    // has nothing to do with cell size. Refining the raster now only finds
    // more of the same links, which is convergence rather than drift.
    const jump = new Map();
    const addLink = (i, j) => {
      if (i < 0 || j < 0 || i === j) return;
      let list = jump.get(i);
      if (!list) jump.set(i, (list = []));
      if (!list.includes(j)) list.push(j);
    };
    const cellAt = (wx, wz) => {
      const a = Math.floor((wx - x0) / cell);
      const b = Math.floor((wz - z0) / cell);
      return a < 0 || b < 0 || a >= n || b >= n ? -1 : b * n + a;
    };
    // The cell to ATTACH a vault end to, which is not the cell containing the
    // point. A takeoff point is hard against the fence by definition, and the
    // cell containing it is therefore blocked at its centre almost always: an
    // earlier version required that cell to be open and threw away most of the
    // links, which made a one-gate pen look like a pin and fired F4 on 40% of
    // a generator that has no pins in it. The geometry decides whether the
    // vault exists; the raster only has to name where its ends are, so walk
    // outward along the fence's normal to the first cell that can hold a body.
    const attach = (px, pz, ax, az) => {
      for (let d = 0; d <= 1.4; d += cell * 0.5) {
        const i = cellAt(px + ax * d, pz + az * d);
        if (i >= 0 && !blocked[i]) return i;
      }
      return -1;
    };
    const SCAN = 0.25;
    for (const b of barriers) {
      if (unjumpable(b)) continue;
      const bx = b.x1 - b.x0;
      const bz = b.z1 - b.z0;
      const len = Math.hypot(bx, bz);
      if (len < 1e-6) continue;
      const ux = bx / len;
      const uz = bz / len;
      const nx = -uz;
      const nz = ux;
      const out = b.half + radius + 0.02;      // hard against the fence
      const far = jumpReach - out;             // the furthest the landing can be
      if (far < b.half + radius) continue;     // no room for a landing at all
      const steps = Math.max(1, Math.ceil(len / SCAN));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = b.x0 + bx * t;
        const pz = b.z0 + bz * t;
        for (const side of [1, -1]) {
          const tx = px - nx * side * out;
          const tz = pz - nz * side * out;
          if (!discClear(tx, tz, radius)) continue;
          const ti = attach(tx, tz, -nx * side, -nz * side);
          if (ti < 0) continue;
          // Try the near edge of the landing band first, then the far edge.
          for (const d of [b.half + radius + 0.03, far - 0.03]) {
            if (d < b.half + radius) continue;
            const lx = px + nx * side * d;
            const lz = pz + nz * side * d;
            if (!discClear(lx, lz, radius)) continue;
            const li = attach(lx, lz, nx * side, nz * side);
            if (li < 0) continue;
            if (crossesProp(tx, tz, lx, lz, radius)) continue;
            if (crossesWall(tx, tz, lx, lz, 0)) continue;
            addLink(ti, li);
            break;
          }
        }
      }
    }
    return {
      n, cell, x0, z0, blocked, wall, fence, jump, DIR8, jumpReach,
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
    crossesWall,
    crossesProp,
    visible,
    // The arena's extent, when the world is bounded. Undefined means unbounded,
    // and everything above works either way.
    get bounds() { return world.bounds; },
    resolveDisc,
    resolveWalker,
    discClear,
    roomAt,
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
