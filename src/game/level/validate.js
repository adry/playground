// IS THIS LEVEL PLAYABLE? Asked continuously, never at save time.
//
// The rule the editor is built on is that a violation shows up the moment it
// happens. A report at save time tells you that something you did twenty
// minutes ago was wrong; a red outline under the headstone you are still
// dragging tells you which headstone, while your hand is on it. So everything
// here is cheap enough to run on every change: it is a few hundred props
// against a few dozen segments, which is microseconds.
//
// What it checks, and where each rule comes from:
//
//   OVERLAP        Two solid props may not share ground. The test is the
//                  MEASURED box or disc out of layout/footprints.js, turned by
//                  the prop's own yaw, because a headstone is much wider than
//                  it is deep and a circle test spaces a row of ledgers 1.9
//                  apart until the row stops being a row.
//   BARRIER        No prop may stand in a fence or a wall. The barrier is a
//                  capsule of its own published `half`.
//   GATE           Nothing solid may touch a gate's approach capsule or the
//                  leaf's sweep disc. world/index.js is emphatic about why the
//                  keep-out is a capsule: the question is not whether a body
//                  fits through the opening but whether it can REACH it.
//   ARENA          Everything inside the wall, footprint included.
//   PERIMETER      The wall is one closed loop with no gate in it. That is what
//                  makes it the edge of the level rather than a fence.
//   SEALED PEN     A closed fence run with no gate is a pocket the ghost can
//                  vault into and no skeleton can ever reach. The generator
//                  forbids it by construction (rule 1: every run has exactly
//                  one gate) and a hand-made level has to be told.
//   RUN GAP        Two fence runs closer than the body can pass between are a
//                  pocket closed BETWEEN two runs, which is the generator's
//                  rule 3.
//   SPAWNS         At most four graves, because src/ghost/ground.js cuts at
//                  most four holes and throws at the fifth, and rules.js runs
//                  exactly four personalities.
//   REACHABLE      A flood fill at body radius from the ghost's spawn. Anything
//                  a body cannot walk to is called out: a firefly there is
//                  uncollectable and a grave there strands a skeleton.
//
// Severity is honest. An `error` makes the level unplayable; a `warn` makes it
// worse than it should be.
//
// ============================================================================
// THIS IS THE FAST HALF. THE OTHER HALF IS THE AUDIT.
// ============================================================================
//
// Everything above runs on every pointer move, which is what puts a red
// outline under the headstone while your hand is still on it. It is not the
// whole rule set and it never was: src/game/world/audit.js is, and it is a
// SECOND IMPLEMENTATION of the geometry on purpose, corner based where this is
// axis based, so the two disagreeing is information. It also carries three
// rules this cannot: nothing standing in a path, nothing tall hiding something
// short from the camera, and WEDGES.
//
// A WEDGE is a place a body fits that nothing can walk to, and it is the
// failure that ends the game: the ghost vaults in, no skeleton can follow, and
// the player stands there and is safe for ever. No flood fill at a single cell
// size can see one -- 0.5 reported zero on generated arenas that held eleven --
// so repair.js's findWedges asks the question generously at 0.25 and then
// confirms each hit in continuous geometry. It is exported for exactly this
// and it takes the arrays the world already publishes.
//
// reviewLevel() below runs both. It costs a couple of hundred milliseconds,
// which is nothing between gestures and far too much per pointer move, so the
// editor debounces it. Nothing else about it is optional: with the generator
// no longer standing between a hand-made level and the player, this IS the
// fairness guarantee.

import { BODY, propRecord, graveProps } from './format.js';
import { isSolid } from './catalogue.js';
import {
  auditFindings, shapeOf as auditShape, gapBetween, barrierPoly, pointPoly, pathPoints,
  MARGIN, PATH_MARGIN, FENCE_MARGIN, GATE_BODY,
} from '../world/audit.js';
import { findWedges } from '../world/repair.js';

const RUN_GAP = 2.4;      // world/index.js rule 3, the least ground between two runs
const NAV_CELL = 0.5;
export const GHOST_R = 0.55;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- shapes -------------------------------------------------------------------

// A prop's footprint as an oriented box or a disc, in world space.
export function shapeOf(p) {
  const f = p.foot;
  if (f.shape === 'disc') return { disc: true, x: p.x, z: p.z, r: f.r };
  return { disc: false, x: p.x, z: p.z, yaw: p.yaw || 0, hu: f.halfU, hv: f.halfV };
}

// The disc, in the box's own frame. A yaw of theta puts the box's local X axis
// at (cos, -sin) in world and its local Z at (sin, cos), which is what a
// three.js rotation about Y does, so the projection onto those two axes IS the
// local coordinate. Writing it as a rotation by -theta instead, which is the
// obvious thing to try, gets the sign of one term wrong in each row and turns
// the test into a different box: an eighteen unit fence then reads as
// overlapping a bush six units away from it.
function discBox(d, b, pad) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = d.x - b.x;
  const dz = d.z - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = lx - clamp(lx, -b.hu, b.hu);
  const qz = lz - clamp(lz, -b.hv, b.hv);
  return Math.hypot(qx, qz) < d.r + pad;
}

function axes(b) {
  return [
    { x: Math.cos(b.yaw), z: -Math.sin(b.yaw) },
    { x: Math.sin(b.yaw), z: Math.cos(b.yaw) },
  ];
}

function boxBox(a, b, pad) {
  for (const box of [a, b]) {
    for (const ax of axes(box)) {
      const proj = (o) => {
        const c = (o.x - 0) * ax.x + (o.z - 0) * ax.z;
        const e = Math.abs(ax.x * Math.cos(o.yaw) - ax.z * Math.sin(o.yaw)) * o.hu
          + Math.abs(ax.x * Math.sin(o.yaw) + ax.z * Math.cos(o.yaw)) * o.hv;
        return { c, e };
      };
      const pa = proj(a);
      const pb = proj(b);
      if (Math.abs(pa.c - pb.c) > pa.e + pb.e + pad) return false;
    }
  }
  return true;
}

export function shapesOverlap(p, q, pad = 0) {
  const a = shapeOf(p);
  const b = shapeOf(q);
  if (a.disc && b.disc) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + pad;
  if (a.disc) return discBox(a, b, pad);
  if (b.disc) return discBox(b, a, pad);
  return boxBox(a, b, pad);
}

export function pointSegD(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - x0) * dx + (pz - z0) * dz) / ll : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

// A prop against a CAPSULE: a fence, a wall, or a gate's approach corridor.
//
// It has to be the prop's real footprint and not its bounding circle. A
// headstone is 0.54 wide and 0.22 deep, so its circumscribed circle is 0.29
// bigger than its own depth, and a row of stones standing a comfortable
// hand's width from a fence reads as four errors under the circle test. That
// was not hypothetical: the generator's own levels, which the placer proves
// clear against the same fences, came back with three "stone stands in the
// fence" the first time this was written with a circle.
//
// A capsule is exactly a rectangle plus a disc at each end -- it IS the
// Minkowski sum of the segment and the disc -- so the test is three exact
// tests and no approximation anywhere.
function shapeNearCapsule(p, x0, z0, x1, z1, r) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len > 1e-6) {
    const bar = {
      x: (x0 + x1) / 2, z: (z0 + z1) / 2,
      yaw: Math.atan2(-(z1 - z0), x1 - x0),
      foot: { shape: 'box', halfU: len / 2, halfV: r },
    };
    if (shapesOverlap(p, bar)) return true;
  }
  const cap = (x, z) => shapesOverlap(p, { x, z, yaw: 0, foot: { shape: 'disc', r } });
  return cap(x0, z0) || cap(x1, z1);
}

// --- the flood fill -------------------------------------------------------------

export function reachability({ box, barriers, props, spawn, radius = BODY / 2 + 0.05 }) {
  const pad = 1.0;
  const minX = box.minX - pad;
  const minZ = box.minZ - pad;
  const w = Math.ceil((box.maxX - box.minX + 2 * pad) / NAV_CELL);
  const h = Math.ceil((box.maxZ - box.minZ + 2 * pad) / NAV_CELL);
  const open = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const solids = props.filter((p) => p.solid);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = minX + (i + 0.5) * NAV_CELL;
      const z = minZ + (j + 0.5) * NAV_CELL;
      let ok = x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ;
      if (ok) {
        for (const b of barriers) {
          if (pointSegD(x, z, b.x0, b.z0, b.x1, b.z1) < b.half + radius) { ok = false; break; }
        }
      }
      if (ok) {
        for (const p of solids) {
          if (Math.hypot(x - p.x, z - p.z) < p.radius + radius) { ok = false; break; }
        }
      }
      open[j * w + i] = ok ? 1 : 0;
    }
  }
  const at = (x, z) => {
    const i = Math.round((x - minX) / NAV_CELL - 0.5);
    const j = Math.round((z - minZ) / NAV_CELL - 0.5);
    if (i < 0 || j < 0 || i >= w || j >= h) return -1;
    return j * w + i;
  };
  // Start from the nearest open cell to the spawn, so a spawn that is itself a
  // hair inside something does not make the whole level unreachable.
  let start = at(spawn.x, spawn.z);
  if (start < 0 || !open[start]) {
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < open.length; k++) {
      if (!open[k]) continue;
      const x = minX + ((k % w) + 0.5) * NAV_CELL;
      const z = minZ + (Math.floor(k / w) + 0.5) * NAV_CELL;
      const d = Math.hypot(x - spawn.x, z - spawn.z);
      if (d < bd) { bd = d; best = k; }
    }
    start = best;
  }
  if (start >= 0) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop();
      const i = k % w;
      const j = (k / w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const n = y * w + x;
        if (seen[n] || !open[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return {
    // Reachable means "the player can get to this spot", and the raster is
    // half a unit, so the question is asked of the cell the point is in AND
    // its neighbours. Without that, a firefly standing a clear 0.6 from a
    // fountain is called unreachable because the CENTRE of its cell happens to
    // be inside the fountain, which is an artefact of the grid and not a fact
    // about the level.
    reachable(x, z) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const k = at(x + di * NAV_CELL, z + dj * NAV_CELL);
          if (k >= 0 && seen[k] === 1) return true;
        }
      }
      return false;
    },
    open(x, z) {
      const k = at(x, z);
      return k >= 0 && open[k] === 1;
    },
  };
}

// --- the whole check ------------------------------------------------------------

// `world` is anything createLevelWorld() returns; `doc` the document behind it.
// `deep` runs the flood fill. It is the one check here that costs anything --
// a 0.5 raster over the whole arena against every barrier and every prop --
// so a drag in progress asks for the cheap half and the gesture's last call
// asks for all of it. Everything else runs on every pointer move.
export function validateLevel(doc, world, { deep = true } = {}) {
  const issues = [];
  const d = world._derived;
  const add = (severity, code, message, at, refs = []) => issues.push({
    severity, code, message, at, refs,
  });

  // --- the perimeter ---------------------------------------------------------
  const pts = doc.wall.points;
  if (pts.length < 3) {
    add('error', 'perimeter', 'the wall needs at least three points', null);
  } else {
    const total = d.wall.segments.reduce((s, b) => s + b.length, 0);
    let want = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      want += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (Math.abs(total - want) > 0.05 || d.wall.gates.length) {
      add('error', 'perimeter', 'the perimeter is not closed: it is the edge of the level and takes no gate', null);
    }
  }

  // --- the fences ------------------------------------------------------------
  for (const run of d.runs) {
    if (run.source.closed && run.gates.length === 0) {
      const p = run.source.points[0];
      add('error', 'sealed', `fence ${run.id} is a closed pen with no gate: the ghost can vault in and no skeleton can follow`, { x: p[0], z: p[1] }, [run.id]);
    }
    if (run.gates.length > 1) {
      add('warn', 'gates', `fence ${run.id} has ${run.gates.length} gates; the generator gives every run exactly one`, { x: run.gates[1].x, z: run.gates[1].z }, [run.id]);
    }
  }
  // The closest approach between two runs, reported once per pair rather than
  // once per pair of segments: a pen beside a divider would otherwise raise the
  // same warning eight times.
  for (let i = 0; i < d.runs.length; i++) {
    for (let j = i + 1; j < d.runs.length; j++) {
      let gap = Infinity;
      let at = null;
      for (const a of d.runs[i].segments) {
        for (const b of d.runs[j].segments) {
          const g = Math.min(
            pointSegD(a.x0, a.z0, b.x0, b.z0, b.x1, b.z1),
            pointSegD(a.x1, a.z1, b.x0, b.z0, b.x1, b.z1),
            pointSegD(b.x0, b.z0, a.x0, a.z0, a.x1, a.z1),
            pointSegD(b.x1, b.z1, a.x0, a.z0, a.x1, a.z1),
          );
          if (g < gap) { gap = g; at = { x: (a.x0 + b.x0) / 2, z: (a.z0 + b.z0) / 2 }; }
        }
      }
      if (gap < RUN_GAP) {
        add('warn', 'rungap', `fences ${d.runs[i].id} and ${d.runs[j].id} come within ${gap.toFixed(2)}; under ${RUN_GAP} closes a pocket between them`, at, [d.runs[i].id, d.runs[j].id]);
      }
    }
  }

  // --- the props -------------------------------------------------------------
  const props = d.props;
  const box = d.box;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (p.x - p.radius < box.minX || p.x + p.radius > box.maxX
      || p.z - p.radius < box.minZ || p.z + p.radius > box.maxZ) {
      add('error', 'arena', `${p.kind} is outside the wall`, p, [p.id]);
    }
    for (const b of d.barriers) {
      if (shapeNearCapsule(p, b.x0, b.z0, b.x1, b.z1, b.half)) {
        add('error', 'barrier', `${p.kind} stands in the ${b.kind}`, p, [p.id]);
        break;
      }
    }
    if (p.solid) {
      for (const g of d.gates) {
        if (shapesOverlap(p, { x: g.sweep.x, z: g.sweep.z, yaw: 0, foot: { shape: 'disc', r: g.sweep.r } })) {
          add('error', 'gate', `${p.kind} is inside the gate leaf's sweep`, p, [p.id, g.id]);
          break;
        }
        if (shapeNearCapsule(p, g.clear.x0, g.clear.z0, g.clear.x1, g.clear.z1, g.clear.r)) {
          add('error', 'gate', `${p.kind} blocks the approach to a gate`, p, [p.id, g.id]);
          break;
        }
      }
      for (let j = i + 1; j < props.length; j++) {
        const q = props[j];
        if (!q.solid) continue;
        if (Math.abs(p.x - q.x) > p.radius + q.radius || Math.abs(p.z - q.z) > p.radius + q.radius) continue;
        if (shapesOverlap(p, q)) {
          add('error', 'overlap', `${p.kind} and ${q.kind} overlap`, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, [p.id, q.id]);
        }
      }
    }
  }

  // --- the spawns ------------------------------------------------------------
  if (doc.graves.length > 4) {
    add('error', 'spawns', 'at most four skeleton spawns: the floor cuts four holes and throws at the fifth', null);
  }
  const orders = doc.graves.map((g) => g.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i)) {
    add('warn', 'order', 'the spawn order is not a clean run from 0', null);
  }
  const seenPersonality = new Set();
  for (const g of doc.graves) {
    if (seenPersonality.has(g.personality)) {
      add('warn', 'personality', `two spawns are both the ${g.personality}`, g, [g.id]);
    }
    seenPersonality.add(g.personality);
  }
  if (doc.graves.length && doc.graves.length < 4) {
    add('warn', 'spawns', `${doc.graves.length} of 4 skeleton spawns placed`, null);
  }

  if (d.flies.missed > 0) {
    add('warn', 'fireflies', `${d.flies.missed} of ${d.flies.cells} firefly cells had nowhere to put one`, null);
  }

  // --- the ghost's own ground -------------------------------------------------
  let nav = null;
  if (deep) {
    nav = reachability({ box, barriers: d.barriers, props, spawn: doc.spawn });
    if (!nav.open(doc.spawn.x, doc.spawn.z)) {
      add('error', 'spawn', 'the ghost starts inside something', doc.spawn);
    }
    for (const g of d.graves) {
      if (!nav.reachable(g.x, g.z)) {
        add('error', 'unreachable', `grave ${g.order + 1} is somewhere a body cannot walk to`, g, [g.id]);
      }
    }
    for (const f of d.flies.points) {
      if (!nav.reachable(f.x, f.z)) {
        add('warn', 'unreachable', 'a firefly landed somewhere a body cannot walk to', f);
      }
    }
    for (const p of d.powerups) {
      if (!nav.reachable(p.x, p.z)) {
        add('error', 'unreachable', 'a pellet is somewhere a body cannot walk to', p, [p.id]);
      }
    }
  }

  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warn'),
    // Which props are implicated, so the editor can outline them.
    flagged: new Set(issues.flatMap((i) => i.refs)),
    nav,
  };
}

export default validateLevel;


// --- the slow half ---------------------------------------------------------------

// Which audit rules are worth blocking a save on. ALL OF THEM, now.
//
// There used to be one exception here. audit.js asked for at least eight
// fireflies while the owner had already fixed the number at five, so the
// finding was downgraded to a note rather than train the owner to ignore the
// panel. That constant has since moved -- audit.js's floor is five, which is
// level/fireflies.js's count -- so the exception was suppressing a real
// failure: a level with nowhere to put a fifth firefly would have saved
// without a word. There is no exception list any more, and there should not be
// one: a rule worth writing down is worth blocking on, and a rule that is not
// belongs out of the audit rather than in a filter here.
function auditSeverity() {
  return 'error';
}

// The full rule set plus the wedge pass, as issues in the same shape the fast
// half produces, so the editor has one list to render and one rule for what
// blocks a save.
export function reviewLevel(world) {
  const issues = [];
  let wedges = [];
  let audited = false;
  try {
    const found = auditFindings(world);
    // The audit's rule 11 IS the wedge pass, so its answer is already here.
    // This used to run findWedges a second time straight afterwards, which is
    // two floods of the whole arena for one question.
    wedges = found.wedges || [];
    audited = true;
    for (const f of found) {
      const severity = auditSeverity(f.rule, f.message);
      issues.push({ severity, code: f.rule, message: f.message, at: null, refs: [], from: 'audit' });
    }
  } catch (err) {
    // A CHECK THAT DID NOT RUN IS NOT A CHECK THAT PASSED. This is the whole
    // fairness guarantee, so the honest answer to "the audit threw" is that
    // this level is not known to be playable, and saving it has to be as loud
    // as saving a level with a finding in it.
    issues.push({ severity: 'error', code: 'audit', message: `the audit could not run, so this level is unchecked: ${err.message}`, at: null, refs: [], from: 'audit' });
  }
  // Only if the audit threw before it got to rule 11, because a check that did
  // not run is not a check that passed and the wedge list is what the editor
  // draws.
  if (!audited) {
    try {
      wedges = findWedges({
        box: world.bounds,
        barriers: world.barriers(),
        gates: world.gates(),
        props: world.props(),
        spawn: world.spawn,
      });
    } catch (err) {
      issues.push({ severity: 'error', code: 'wedge', message: `the wedge pass could not run, so this level is unchecked: ${err.message}`, at: null, refs: [], from: 'audit' });
    }
  }
  return {
    issues,
    wedges,
    errors: issues.filter((i) => i.severity === 'error'),
    notes: issues.filter((i) => i.severity === 'note'),
  };
}


// --- may this go here? ------------------------------------------------------------
//
// THE PLACEMENT INDICATOR'S RULE. Asked once per pointer move, about ONE thing
// that is not in the document yet, and it decides whether the drop happens at
// all. So it has two obligations and they pull against each other:
//
//   it must be instant           it runs on every pointer move
//   it must never refuse a drop  a refusal the audit would have accepted is a
//   the audit would accept       lie the author cannot argue with, and worse
//                                than the red outline it replaces
//
// The second is why this calls AUDIT.JS'S OWN geometry -- shapeOf, gapBetween,
// barrierPoly, pointPoly -- with audit.js's own margins, rather than a second
// opinion written here. Five of the audit's thirteen rules are decidable for
// one prop at one position and all five are below:
//
//   bounds      rule 7,  inside the wall, footprint included
//   overlap     rule 1,  MARGIN clear of every other prop
//   fence       rule 3,  FENCE_MARGIN clear of every barrier and the wall
//   gate        rule 4,  out of the leaf's sweep, out of the approach capsule,
//                        and, if it is solid, GATE_BODY from the middle
//   path        rule 2,  PATH_MARGIN clear of every path
//
// WHAT IS NOT HERE, and why each one cannot be:
//
//   occlusion   rule 6 is a statement about a PAIR of props under the camera,
//               and it is a matter of degree: a row of headstones raises it
//               and is still what a graveyard looks like. Refusing the drop
//               would make a row impossible to lay. It stays on the slow pass.
//   grave       rule 5 asks about an arrangement of three props, which the
//               format synthesises, so a single prop cannot break it except by
//               standing where the audit will pick it as the wrong heap. That
//               is emergent and it is rare.
//   sealed      rule 9 is a flood over the whole arena.
//   wedge       rule 11 is a flood at a quarter-unit raster, it is emergent
//               from every prop and every fence at once, and it is usually not
//               the fault of the thing in your hand. It costs a couple of
//               hundred milliseconds and it stays on the slow timer, drawn on
//               the floor where it is. THE INDICATOR CANNOT SEE A WEDGE AND
//               MUST NOT PRETEND TO.
//   gateless    rules 8, 10, 12 and 13 are about the level as a whole -- how
//   wall        many graves, how many pellets, whether a pen has a way in --
//   holes       and adding one prop cannot decide any of them.
//   floor
//
// So the indicator is the LOCAL half of the audit, exactly, and the slow pass
// remains the whole of it. A green preview means "nothing about this spot is
// wrong"; it does not mean the level is playable, which is what the audit
// panel and the save guard are for.

// The candidate props for a thing about to be dropped. A prop is one; a grave
// is the three the format will synthesise, because the question the author is
// asking is whether the GRAVE fits, and a grave is a hole, a heap and a stone.
export function placementProps(entry) {
  if (entry.grave) return graveProps({ id: 'new', ...entry.grave });
  return [propRecord({ id: 'new', ...entry })];
}

export function placementCheck(world, cands) {
  const box = world.bounds;
  const barriers = world.barriers();
  const gates = world.gates();
  const others = world.props();
  const half = world.PATH_HALF;
  // Sampled once per call rather than once per candidate; a level has a
  // handful of paths and this is the only part of the test that is not O(1).
  const path = pathPoints(world);

  for (const p of cands) {
    const S = auditShape(p);
    const distTo = (x, z) => (S.circle ? Math.hypot(x - S.x, z - S.z) - S.r : pointPoly(x, z, S));

    if (p.x - p.radius < box.minX || p.x + p.radius > box.maxX
      || p.z - p.radius < box.minZ || p.z + p.radius > box.maxZ) {
      return { ok: false, why: 'outside the wall' };
    }
    for (const q of others) {
      if (Math.hypot(p.x - q.x, p.z - q.z) > p.radius + q.radius + MARGIN) continue;
      if (gapBetween(S, auditShape(q)) < MARGIN - 1e-6) {
        return { ok: false, why: `too close to the ${q.kind}${q.variant ? `/${q.variant}` : ''} already there` };
      }
    }
    for (const b of barriers) {
      if (Math.hypot(p.x - (b.x0 + b.x1) / 2, p.z - (b.z0 + b.z1) / 2)
        > p.radius + b.length / 2 + FENCE_MARGIN + 0.3) continue;
      if (gapBetween(S, barrierPoly(b)) < FENCE_MARGIN - 1e-6) {
        return { ok: false, why: `in the ${b.kind}` };
      }
    }
    for (const g of gates) {
      if (distTo(g.sweep.x, g.sweep.z) < g.sweep.r - 1e-6) return { ok: false, why: 'in the gate leaf\'s sweep' };
      if (!p.solid) continue;
      if (distTo(g.x, g.z) < GATE_BODY - 1e-6) return { ok: false, why: 'in the mouth of a gate' };
      let near = Infinity;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        near = Math.min(near, distTo(
          g.clear.x0 + (g.clear.x1 - g.clear.x0) * t,
          g.clear.z0 + (g.clear.z1 - g.clear.z0) * t,
        ));
      }
      if (near < g.clear.r - 0.06) return { ok: false, why: 'blocking the way to a gate' };
    }
    for (const [x, z] of path) {
      if (Math.abs(x - p.x) > p.radius + half + 0.4 || Math.abs(z - p.z) > p.radius + half + 0.4) continue;
      if (distTo(x, z) < half + PATH_MARGIN - 1e-6) return { ok: false, why: 'standing in a path' };
    }
  }
  return { ok: true, why: '' };
}
