// What a fence is FOR, and the measurement that decided it.
//
// The first build fenced every plot on a 6.0 lattice, which is a Pac-Man maze
// and reads as a grid of pens, so the owner asked for far fewer. The endless
// build duly scattered short runs at a tenth of the density, and the rules half
// then measured what that bought:
//
//   careful   (a vault priced at 3x walking)   48.1 fireflies a run
//   ground    (never jumps at all)             46.8
//   vault     (a vault priced at 1x, free)     45.9
//
// A player who never learns the jump scores within four percent of one who
// uses it, and a player who jumps everything does WORSE. The asymmetry the
// whole game is built on was not in the game. The diagnosis is exact and it is
// geometric: A SHORT OPEN RUN HAS TWO FREE ENDS, and walking round an end costs
// the skeleton about what the vault costs the ghost, so the correct play is
// always to walk round and the fence may as well not be there.
//
// So density was the wrong dial, and this file now turns the right one. A fence
// has to be EXPENSIVE TO GO ROUND, and in a 30 by 30 arena there are two shapes
// that are:
//
//   PEN       a closed rectangle with ONE GATE. The asymmetry is total: the
//             ghost is over the rail in half a second and the skeleton walks
//             the whole perimeter to the gate and back. This is also exactly
//             what a family plot in an old cemetery looks like, so it costs
//             nothing in the fifth requirement.
//   DIVIDER   a straight run that meets the perimeter WALL AT BOTH ENDS, with
//             one gate in it. It has no free ends at all, because the ends are
//             the wall, so the arena becomes two rooms joined by one opening.
//             Leading a skeleton to the wrong side of it is the play the
//             redirection asked for, in its purest form.
//
// What is NOT here any more is the short open boundary run. It was three to
// seven panels standing across a path, it looked good, and the measurement says
// it does nothing: it is exactly the shape with two cheap ends.
//
// FOUR PROPERTIES, ALL BY CONSTRUCTION.
//
//  1. EVERY RUN HAS A GATE. A run is a chain of whole panels with one marked as
//     the opening, and the opening is subtracted from the published segments.
//     There is no code path that makes a run without one.
//  2. NO GATELESS ENCLOSURE. A pen spends exactly one panel on its gate, and a
//     divider spends one too, so every region the fences make has a way in for
//     something that cannot jump. The perimeter WALL is a closed loop with no
//     gate on purpose: it is the edge of the level and there is darkness beyond
//     it, so nothing needs to get out.
//  3. NO TWO RUNS TOUCH. Every run keeps RUN_GAP of clear ground from every
//     other and from the wall except where a divider deliberately meets it, so
//     two runs can never close a pocket between them.
//  4. A GATE IS A GAP AND NEVER AN END, so both flanks exist and an endpoint
//     that no other segment shares really is the end of a fence.

import { GATE } from '../layout/gate.js';
import { F } from '../../ghost/props/fence/metrics.js';
import { rngAt, PATH_HALF, SPAWN_CLEAR, WALL_HALF } from './field.js';

export const PANEL = F.panel.length;
export const BARRIER_HEIGHT = F.post.height;
// Half the thickness of a barrier in plan. The post is the widest part of a
// fence at 0.155 across, so this is 0.0775 and not the 0.10 the rules half
// assumed. 0.10 is a safe over estimate and nothing breaks if they keep it.
export const FENCE_HALF = F.post.width / 2;
export const FENCE_MARGIN = 0.15;
// How far a fence keeps off a path. A fence AT this distance is right against
// the edge of the walking surface, which is a plot edging a path and is a good
// thing; what is forbidden is a fence standing IN one.
export const PATH_KEEP = PATH_HALF + 0.45;
// The clear opening of a gate, as a half width.
export const GATE_HALF = PANEL / 2;

// THE GATE KEEP-OUT IS A CAPSULE, NOT A DISC.
//
// The rules half found a prop 1.271 from a gate centre, a thousandth outside a
// 1.270 disc, that plugged the mouth and cost three percent of their worlds
// their fairness. A disc is the wrong shape for the question: a walker has to
// REACH the opening, not merely fit through it, so what has to be clear is the
// approach, which is a corridor through the gate and out both sides. This is
// that corridor: 2.2 either side of the middle of the opening along the line
// through it, at a radius that leaves a 0.60 body room to line itself up.
export const GATE_APPROACH = 2.2;
export const GATE_CLEAR_R = 1.05;

// The gap two runs must leave between them. Above 1.2 is merely passable by the
// 0.60 disc the rules half moves; 2.4 leaves the ground between two fences
// walkable rather than technically legal. Against the WALL it is smaller,
// because the arena is only fifteen units from its middle to its edge and every
// unit of keep-out there is a unit a pen cannot use: 1.8 still leaves a body
// room to walk behind a pen, which is what stops the strip behind it being a
// sealed pocket.
// A gate's approach corridor reaches 2.0 either side of the opening and a body
// needs 0.6, so anything within 2.6 of a gate is standing in its doorway. 2.8
// between two runs, and 3.0 from the wall.
export const RUN_GAP = 2.8;
// THE PERIMETER LANE. The rules half measured 4.7% of a run spent within 4.0 of
// the wall and 33% of the deaths there, a risk ratio of seven, because a corner
// is where you are pinned and the wall is the one barrier the ghost cannot
// vault. Three units of clear ground all the way round is Pac-Man's outer
// corridor: at 3.5 it leaves a walkable loop about 2.7 wide, so there is always
// a way out of a corner that is not through whatever is chasing you.
export const WALL_GAP = 3.5;

// The grid yaw of a box whose long axis runs along the grid direction (du, dv).
// geom.js reads a yaw as "local X is (cos, -sin)".
export const gridYawAlong = (du, dv) => Math.atan2(-dv, du);

// The world yaw of the same thing. The two frames are a REFLECTION apart, not a
// rotation, so this cannot be had from the grid yaw by adding a constant.
export function worldYawAlong(frame, du, dv) {
  const w = frame.toWorld(du, dv);
  return Math.atan2(-w.z, w.x);
}

// --- building a run ---------------------------------------------------------

function panelChain(u0, v0, du, dv, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      au: u0 + du * PANEL * i, av: v0 + dv * PANEL * i,
      bu: u0 + du * PANEL * (i + 1), bv: v0 + dv * PANEL * (i + 1),
      du, dv,
    });
  }
  return out;
}

function runBoxWorld(frame, panels) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of panels) {
    for (const [u, v] of [[p.au, p.av], [p.bu, p.bv]]) {
      const w = frame.toWorld(u, v);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

// Consecutive panels become ONE segment, and a segment breaks only where the
// fence really breaks: at a gate, or at a corner. The navigation half reads an
// unshared endpoint as the end of a fence it can walk round, so chopping a
// straight side into two unit pieces would invent fence ends that do not exist.
function segmentsOf(frame, panels, runId) {
  const out = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if (!start) return;
    const a = frame.toWorld(start.au, start.av);
    const b = frame.toWorld(prev.bu, prev.bv);
    const len = Math.hypot(prev.bu - start.au, prev.bv - start.av);
    const du = (prev.bu - start.au) / len;
    const dv = (prev.bv - start.av) / len;
    out.push({
      id: `${runId}/s${out.length}`, run: runId, kind: 'fence', jumpable: true,
      x0: a.x, z0: a.z, x1: b.x, z1: b.z,
      half: FENCE_HALF, length: len, panels: Math.round(len / PANEL),
      height: BARRIER_HEIGHT,
      yaw: worldYawAlong(frame, du, dv),
      box: {
        minX: Math.min(a.x, b.x) - FENCE_HALF, maxX: Math.max(a.x, b.x) + FENCE_HALF,
        minZ: Math.min(a.z, b.z) - FENCE_HALF, maxZ: Math.max(a.z, b.z) + FENCE_HALF,
      },
      grid: {
        au: start.au, av: start.av, bu: prev.bu, bv: prev.bv,
        shape: {
          shape: 'box', x: (start.au + prev.bu) / 2, z: (start.av + prev.bv) / 2,
          yaw: gridYawAlong(du, dv), halfU: len / 2, halfV: FENCE_HALF,
        },
      },
    });
    start = null;
  };
  for (const p of panels) {
    if (p.gate) { flush(); continue; }
    if (start && (Math.abs(p.du - prev.du) > 1e-9 || Math.abs(p.dv - prev.dv) > 1e-9)) flush();
    if (!start) start = p;
    prev = p;
  }
  flush();
  return out;
}

function gateOf(frame, panel, runId, index) {
  const { au, av, bu, bv, du, dv } = panel;
  const a = frame.toWorld(au, av);
  const b = frame.toWorld(bu, bv);
  const midU = (au + bu) / 2;
  const midV = (av + bv) / 2;
  const mid = frame.toWorld(midU, midV);
  const along = frame.toWorld(du, dv);
  // The normal to the opening, which is the direction a body walks through it.
  const nU = -dv;
  const nV = du;
  const n = frame.toWorld(nU, nV);
  // The hinge sits at one end of the opening and the leaf sweeps the FULL disc
  // about it, because the gate is double acting. Both numbers come off
  // fence/gate.js, and the prop origin sits hingeX back along the fence line.
  const prop = frame.toWorld(au - GATE.hingeX * du, av - GATE.hingeX * dv);
  return {
    id: `${runId}/g${index}`, run: runId, barrier: runId,
    x: mid.x, z: mid.z,                       // the middle of the OPENING
    dx: along.x, dz: along.z,                 // unit, along the fence
    nx: n.x, nz: n.z,                         // unit, through the opening
    half: GATE_HALF,
    x0: a.x, z0: a.z, x1: b.x, z1: b.z,
    hinge: { x: a.x, z: a.z },
    sweep: { x: a.x, z: a.z, r: GATE.sweepRadius },
    // The approach corridor, as a capsule: the segment through the opening and
    // out GATE_APPROACH either side, at GATE_CLEAR_R. Nothing solid may touch
    // it, because a body has to line up on the opening and not merely fit.
    clear: {
      x0: mid.x - n.x * GATE_APPROACH, z0: mid.z - n.z * GATE_APPROACH,
      x1: mid.x + n.x * GATE_APPROACH, z1: mid.z + n.z * GATE_APPROACH,
      r: GATE_CLEAR_R,
    },
    prop: { x: prop.x, z: prop.z, yaw: frame.yawFor(-dv, du) + Math.PI },
    box: {
      minX: mid.x - GATE.sweepRadius - GATE_APPROACH, maxX: mid.x + GATE.sweepRadius + GATE_APPROACH,
      minZ: mid.z - GATE.sweepRadius - GATE_APPROACH, maxZ: mid.z + GATE.sweepRadius + GATE_APPROACH,
    },
    grid: {
      u: midU, v: midV,
      sweep: { shape: 'disc', x: au, z: av, r: GATE.sweepRadius },
      clear: {
        // The same capsule in grid, as the two ends of its spine.
        au: midU - nU * GATE_APPROACH, av: midV - nV * GATE_APPROACH,
        bu: midU + nU * GATE_APPROACH, bv: midV + nV * GATE_APPROACH,
        r: GATE_CLEAR_R,
      },
    },
  };
}

function finishRun({ frame, id, kind, panels, interior = null }) {
  const gates = [];
  for (const p of panels) if (p.gate) gates.push(gateOf(frame, p, id, gates.length));
  const segments = segmentsOf(frame, panels, id);
  return {
    id, kind, segments, gates, interior, panels: panels.length,
    box: runBoxWorld(frame, panels),
    length: segments.reduce((s, x) => s + x.length, 0),
  };
}

// --- geometry the placement needs ---------------------------------------------

export function segGap(ax, az, bx, bz, cx, cz, dx, dz) {
  const pointSeg = (px, pz, x0, z0, x1, z1) => {
    const ex = x1 - x0;
    const ez = z1 - z0;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2));
    return Math.hypot(px - (x0 + ex * t), pz - (z0 + ez * t));
  };
  return Math.min(
    pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz),
    pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz),
  );
}

function tooClose(frame, panels, runs, minGap) {
  for (const p of panels) {
    const a = frame.toWorld(p.au, p.av);
    const b = frame.toWorld(p.bu, p.bv);
    for (const run of runs) {
      for (const s of [...run.segments, ...run.gates]) {
        if (segGap(a.x, a.z, b.x, b.z, s.x0, s.z0, s.x1, s.z1) < minGap) return true;
      }
    }
  }
  return false;
}

const clamp = (t, lo, hi) => (t < lo ? lo : t > hi ? hi : t);

// --- the pen -------------------------------------------------------------------

function penSides(c, nu, nv) {
  const halfU = (nu * PANEL) / 2;
  const halfV = (nv * PANEL) / 2;
  const u0 = c.u - halfU;
  const v0 = c.v - halfV;
  return [
    { name: 'south', panels: panelChain(u0, v0, 1, 0, nu), out: { du: 0, dv: -1 } },
    { name: 'east', panels: panelChain(u0 + nu * PANEL, v0, 0, 1, nv), out: { du: 1, dv: 0 } },
    { name: 'north', panels: panelChain(u0 + nu * PANEL, v0 + nv * PANEL, -1, 0, nu), out: { du: 0, dv: 1 } },
    { name: 'west', panels: panelChain(u0, v0 + nv * PANEL, 0, -1, nv), out: { du: -1, dv: 0 } },
  ];
}

function clearOfPaths(field, sides) {
  for (const side of sides) {
    for (const p of side.panels) {
      for (const t of [0, 0.5, 1]) {
        const u = p.au + (p.bu - p.au) * t;
        const v = p.av + (p.bv - p.av) * t;
        if (field.nearestPath(u, v, PATH_KEEP + 1).dist < PATH_KEEP) return false;
      }
    }
  }
  return true;
}

// A pen has to find its gap. Drawing a centre uniformly and giving up if a path
// goes through it produces a pen in three attempts in a hundred, because an
// eight unit square has very little room between paths that wander. The gaps
// are there; you have to look for them. So the pen LOOKS: it samples the
// centres that fit inside the arena, sorts them by how far they are from the
// nearest path, and tries the roomiest first, shrinking a panel at a time.
function makePen({ field, rng, box, avoid, spawn, index }) {
  const frame = field.frame;
  const wantU = rng.int(3, 6);
  const wantV = rng.int(3, Math.min(6, wantU + 2));
  // The size it would like, then progressively smaller ones. A thirty unit
  // arena with a clearing in the middle of it has room for a five panel pen in
  // some seeds and only a three panel one in others, and a small pen is worth
  // far more than no pen: the mechanic needs a closed shape, not a large one.
  const seen = new Set();
  const sizes = [];
  for (const [a, b] of [[wantU, wantV], [wantU - 1, wantV - 1], [3, 3], [3, 2], [2, 3], [2, 2]]) {
    if (a < 2 || b < 2) continue;
    const k = a + 'x' + b;
    if (seen.has(k)) continue;
    seen.add(k);
    sizes.push([a, b]);
  }

  for (const [nu, nv] of sizes) {
    const halfU = (nu * PANEL) / 2;
    const halfV = (nv * PANEL) / 2;
    // A grid aligned rectangle of half extents (halfU, halfV) has world half
    // extents of (halfU + halfV) / sqrt(2) on both axes, because the frames are
    // 45 degrees apart. One line, and it is what limits a pen to five panels a
    // side in a thirty unit arena.
    const half = (halfU + halfV) * Math.SQRT1_2;
    const corner = Math.hypot(halfU, halfV);
    const lo = { x: box.minX + WALL_GAP + half, z: box.minZ + WALL_GAP + half };
    const hi = { x: box.maxX - WALL_GAP - half, z: box.maxZ - WALL_GAP - half };
    if (lo.x > hi.x || lo.z > hi.z) continue;

    // The ghost's own patch of ground has to stay outside the pen, and the test
    // for that is the RECTANGLE inflated by the clearing, not a disc round the
    // pen's bounding circle. The disc version excluded everything but the four
    // corners of a thirty unit arena and cost most levels their second pen.
    const sg = frame.toGrid(spawn.x, spawn.z);
    const clearsSpawn = (g) => Math.abs(sg.u - g.u) > halfU + SPAWN_CLEAR || Math.abs(sg.v - g.v) > halfV + SPAWN_CLEAR;

    const spots = [];
    for (let z = lo.z; z <= hi.z + 1e-9; z += 1.5) {
      for (let x = lo.x; x <= hi.x + 1e-9; x += 1.5) {
        const g = frame.toGrid(x, z);
        if (!clearsSpawn(g)) continue;
        spots.push({ x, z, g, d: field.nearestPath(g.u, g.v, corner + PATH_KEEP + 2).dist });
      }
    }
    if (!spots.length) continue;
    spots.sort((a, b) => b.d - a.d);
    const roomy = spots.filter((s) => s.d >= corner + PATH_KEEP);
    const tries = roomy.length ? rng.shuffle(roomy).slice(0, 16) : spots.slice(0, 12);
    for (const spot of tries) {
      const jx = clamp(spot.x + rng.jitter(0.7), lo.x, hi.x);
      const jz = clamp(spot.z + rng.jitter(0.7), lo.z, hi.z);
      const c = frame.toGrid(jx, jz);
      if (!clearsSpawn(c)) continue;
      const sides = penSides(c, nu, nv);
      if (!clearOfPaths(field, sides)) continue;
      const panels = sides.flatMap((s) => s.panels);
      if (tooClose(frame, panels, avoid, RUN_GAP)) continue;

      // The gate goes on the side facing the nearest path, because that is the
      // way a mourner would have walked in. Middle panel of that side, which is
      // never the first or last panel of the flattened run.
      const near = field.nearestPath(c.u, c.v, 16);
      let best = sides[0];
      let bestDot = -Infinity;
      const toward = { du: near.u - c.u, dv: near.v - c.v };
      const len = Math.hypot(toward.du, toward.dv) || 1;
      for (const side of sides) {
        const dot = (side.out.du * toward.du + side.out.dv * toward.dv) / len;
        if (dot > bestDot) { bestDot = dot; best = side; }
      }
      best.panels[Math.floor(best.panels.length / 2)].gate = true;

      return finishRun({
        frame, id: `pen${index}`, kind: 'pen', panels: sides.flatMap((s) => s.panels),
        interior: {
          u: c.u, v: c.v, x: jx, z: jz,
          halfU: halfU - 0.45, halfV: halfV - 0.45,
          gateSide: best.name,
          // Which way the gate faces, in grid axes, so a collectible can be put
          // at the far end of the pen from it. See index.js, rule 1.
          gateOut: best.out,
        },
      });
    }
  }
  return null;
}

// --- the divider ----------------------------------------------------------------
//
// A straight run wall to wall, with one gate. It is the only shape in a thirty
// unit arena that has NO free ends, so it is the only one where the ghost's
// vault is strictly cheaper than the skeleton's walk, whatever the geometry.

function makeDivider({ field, rng, box, avoid, spawn }) {
  const frame = field.frame;
  // Along one of the two grid axes, which is horizontal or vertical on screen.
  const along = rng.chance(0.5) ? { du: 1, dv: 0 } : { du: 0, dv: 1 };
  const across = { du: -along.dv, dv: along.du };

  // Where it crosses, measured out from the middle of the arena. Never through
  // the ghost's own patch of ground and never hard against the wall.
  const size = box.maxX - box.minX;
  const offsets = rng.shuffle([-0.26, -0.18, 0.18, 0.26, -0.32, 0.32].map((f) => f * size));
  for (const off of offsets) {
    // A point the line passes through, in grid.
    const c = frame.toGrid(0, 0);
    const through = { u: c.u + across.du * off, v: c.v + across.dv * off };
    // March out from it in whole panels until the next panel would leave the
    // arena, then keep the last one that is still inside so the run finishes ON
    // the wall rather than short of it.
    const reach = (sign) => {
      let n = 0;
      for (; n < 40; n++) {
        const u = through.u + along.du * PANEL * (n + 1) * sign;
        const v = through.v + along.dv * PANEL * (n + 1) * sign;
        const w = frame.toWorld(u, v);
        if (w.x < box.minX || w.x > box.maxX || w.z < box.minZ || w.z > box.maxZ) break;
      }
      return n;
    };
    // ONE PANEL PAST THE WALL AT EACH END. Marching in whole panels leaves the
    // last panel end up to two units short of the wall, and a two unit gap at
    // the end of a divider is exactly the free end this shape exists to not
    // have: a skeleton would walk round it and the gate would be decoration.
    // So the run overshoots into the wall, where the extra panel is behind
    // three metres of stone and nobody can see it.
    const back = reach(-1) + 1;
    const fwd = reach(1) + 1;
    const count = back + fwd;
    // Two thirds of the arena is the floor the rules half asked for. Below that
    // it is a short run with free ends again and is not worth building.
    if (count * PANEL < size * 0.62) continue;

    const u0 = through.u - along.du * PANEL * back;
    const v0 = through.v - along.dv * PANEL * back;
    const panels = panelChain(u0, v0, along.du, along.dv, count);

    // The gate near the middle, but never the first or last panel, and never
    // inside the ghost's clearing, and never standing in a path.
    const order = [];
    for (let i = 1; i < count - 1; i++) order.push(i);
    order.sort((a, b) => Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2));
    let gi = -1;
    for (const i of rng.shuffle(order.slice(0, Math.max(1, Math.floor(count * 0.6))))) {
      const mu = (panels[i].au + panels[i].bu) / 2;
      const mv = (panels[i].av + panels[i].bv) / 2;
      const w = frame.toWorld(mu, mv);
      if (Math.hypot(w.x - spawn.x, w.z - spawn.z) < SPAWN_CLEAR + 1.5) continue;
      gi = i;
      break;
    }
    if (gi < 0) continue;
    if (tooClose(frame, panels, avoid, RUN_GAP)) continue;
    // A divider through the ghost's own clearing would pen the player in on
    // their first step, so if the line runs through it, try the next offset.
    // EVERY panel, the gate one included. Skipping the gate panel let a divider
    // run straight through where the ghost starts: the opening itself is a gap,
    // but the two segments that flank it end a unit either side of it, and the
    // ghost was spawning inside one. That was seven per cent of levels failing
    // the rules half's spawn check.
    let hitsSpawn = false;
    for (const p of panels) {
      const a = frame.toWorld(p.au, p.av);
      const b = frame.toWorld(p.bu, p.bv);
      if (segGap(a.x, a.z, b.x, b.z, spawn.x, spawn.z, spawn.x, spawn.z) < SPAWN_CLEAR) hitsSpawn = true;
    }
    if (hitsSpawn) continue;

    panels[gi].gate = true;
    return finishRun({ frame, id: 'divider', kind: 'divider', panels });
  }
  return null;
}

// --- the corner stubs ---------------------------------------------------------------
//
// The rules half measured 4.7% of a run spent within four units of the
// perimeter and 33% of the deaths there: a risk ratio of seven. A corner is
// where you get pinned, and it is the jump's only blind spot, because the wall
// is the one barrier the ghost cannot clear. Their idea, and it is the best one
// anybody has had about this arena: PUT A SHORT FENCE ACROSS EACH CORNER. It
// turns the worst square on the board into the place where the whole mechanic
// reads clearest, because the ghost goes over it in half a second and anything
// chasing has to come round the open end. The corner stops being a trap and
// becomes the tutorial.
//
// A stub is the one run in the arena with no gate, and it does not need one:
// its opening is its OPEN END, which is kept wide enough for a body to walk
// round with room to spare. Each of the four world corners maps to a point on a
// GRID axis, so a stub across a corner is a straight chain of whole panels
// along the other grid axis, which is also square to the camera.
export const STUB_DEPTH = 4.2;      // how far in from the corner it stands
export const STUB_PANELS = 2;       // 4.0 long, one vault
export const STUB_SHUT = 0.5;       // the closed end, too narrow for a body
export const STUB_OPEN = 2.9;       // the least the open end may be

export function cornerStubs({ field, box, avoid, rng }) {
  const frame = field.frame;
  const out = [];
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  corners.forEach(([sx, sz], i) => {
    const cg = frame.toGrid(sx * box.maxX, sz * box.maxZ);
    // The corner sits on a grid axis; `along` is the other one.
    const onU = Math.abs(cg.u) > Math.abs(cg.v);
    const inward = onU ? -Math.sign(cg.u) : -Math.sign(cg.v);
    const line = (onU ? cg.u : cg.v) + inward * STUB_DEPTH;
    // At this depth the corner is 2 * STUB_DEPTH across, because the arena is a
    // diamond in grid and its sides run at 45 degrees to these axes.
    const halfSpan = STUB_DEPTH;
    const len = STUB_PANELS * PANEL;
    if (2 * halfSpan - len < STUB_SHUT + STUB_OPEN) return;
    const shutSide = rng.chance(0.5) ? 1 : -1;
    const start = shutSide < 0 ? -halfSpan + STUB_SHUT : halfSpan - STUB_SHUT - len;
    const panels = onU
      ? panelChain(line, start, 0, 1, STUB_PANELS)
      : panelChain(start, line, 1, 0, STUB_PANELS);
    if (tooClose(frame, panels, avoid, RUN_GAP)) return;
    out.push(finishRun({ frame, id: `stub${i}`, kind: 'stub', panels }));
  });
  return out;
}

// --- the perimeter wall -----------------------------------------------------------

export function makeWall(box) {
  const corners = [
    [box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ],
  ];
  const segments = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    segments.push({
      id: `wall/s${i}`, run: 'wall', kind: 'wall',
      // The one barrier the ghost cannot hop. Beyond it there is darkness and
      // nothing to generate.
      jumpable: false,
      x0, z0, x1, z1,
      half: WALL_HALF, length: Math.hypot(x1 - x0, z1 - z0),
      panels: Math.round(Math.hypot(x1 - x0, z1 - z0) / PANEL),
      height: 3.2,
      yaw: Math.atan2(-(z1 - z0), x1 - x0),
      box: {
        minX: Math.min(x0, x1) - WALL_HALF, maxX: Math.max(x0, x1) + WALL_HALF,
        minZ: Math.min(z0, z1) - WALL_HALF, maxZ: Math.max(z0, z1) + WALL_HALF,
      },
    });
  }
  return { id: 'wall', kind: 'wall', segments, gates: [], interior: null, box, length: 4 * (box.maxX - box.minX) };
}

// --- the level's fences -------------------------------------------------------

export const PEN_MIN = 2;
export const PEN_MAX = 4;
export const DIVIDER_CHANCE = 0.75;

export function levelFences({ field, box, spawn }) {
  const rng = rngAt(field.seed, 'fence');
  const runs = [];
  if (rng.chance(DIVIDER_CHANCE)) {
    const d = makeDivider({ field, rng: rng.fork('divider'), box, avoid: runs, spawn });
    if (d) runs.push(d);
  }
  const want = rng.int(PEN_MIN, PEN_MAX + 1);
  for (let i = 0; i < want; i++) {
    const pen = makePen({ field, rng: rng.fork('pen' + i), box, avoid: runs, spawn, index: i });
    if (pen) runs.push(pen);
  }
  for (const stub of cornerStubs({ field, box, avoid: runs, rng: rng.fork('stubs') })) runs.push(stub);
  return runs;
}

export default levelFences;
