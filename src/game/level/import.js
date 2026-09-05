// A GENERATED LEVEL, TURNED INTO A DOCUMENT THE EDITOR CAN EDIT.
//
// The procedural world in src/game/world/ is no longer where a shipped level
// comes from. It is still the best BLANK PAGE there is: createWorld({ seed })
// produces a complete arena with fences that make pens, a gate in every run,
// four graves one to a quadrant, paths, pellets and about thirty five props,
// and it has been checked for fairness over three thousand seeds. Starting
// from one and moving things is a great deal easier than starting from an
// empty rectangle.
//
// So this is a one-way import. It reads only the world's PUBLISHED queries --
// the same ones the game asks -- and writes a plain document. Nothing here
// reaches back into the generator's internals, so it keeps working while that
// package is being changed underneath it.
//
// THE ONE PIECE OF REAL WORK is the fences. The world publishes a run as a
// list of barrier SEGMENTS with the gate openings already cut out of it, which
// is the right shape for navigation and the wrong shape for an editor: an
// author drags a corner, not eleven collinear panels. So the segments and the
// gate openings are chained back into the polyline they were cut from, the
// collinear joints are dissolved, and each gate becomes a mark at a distance
// along one edge. Chain, dissolve, mark: forty lines, below.
//
// WHAT DOES NOT SURVIVE THE TRIP, and it is short:
//
//   the grave's own props   the generator emits a grave as a pose plus a hole
//                           prop plus a spoil heap. A document stores the pose
//                           and synthesises the other two, so the imported
//                           hole and heap are dropped rather than duplicated.
//   the u/v grid            props keep their world x/z and yaw and lose the
//                           grid coordinates the placer used. Nothing outside
//                           the generator reads them.
//   path curvature          a generated path is sampled every 0.6 units, which
//                           is a hundred points an author cannot drag. The
//                           polyline is simplified to its corners.

import { emptyLevel, renumberGraves, packPaint, wallLoop } from './format.js';
import { PERSONALITIES, MAX_SPAWNS } from './catalogue.js';

const EPS = 0.02;
const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

// Chain a bag of edges into one polyline, following shared endpoints. Returns
// { points, closed } or null if the edges do not make a single chain.
function chain(edges) {
  if (!edges.length) return null;
  const left = edges.slice();
  const first = left.shift();
  const pts = [first.a, first.b];
  let moved = true;
  while (moved && left.length) {
    moved = false;
    for (let i = 0; i < left.length; i++) {
      const e = left[i];
      const head = pts[0];
      const tail = pts[pts.length - 1];
      if (same(e.a, tail)) { pts.push(e.b); }
      else if (same(e.b, tail)) { pts.push(e.a); }
      else if (same(e.a, head)) { pts.unshift(e.b); }
      else if (same(e.b, head)) { pts.unshift(e.a); }
      else continue;
      left.splice(i, 1);
      moved = true;
      break;
    }
  }
  if (left.length) return null;
  let closed = false;
  if (pts.length > 2 && same(pts[0], pts[pts.length - 1])) { pts.pop(); closed = true; }
  return { points: pts, closed };
}

// Take out the points that only continue a straight line, which is every panel
// joint. What is left is the corners an author actually wants handles on.
function dissolve(points, closed) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(points[i]); continue; }
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const scale = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross / scale) > 0.02) out.push(b);
  }
  return out.length >= 2 ? out : points;
}

// Where a point sits on a polyline: which edge, and how far along it.
function markOn(points, closed, x, z) {
  const last = closed ? points.length : points.length - 1;
  let best = null;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const ll = dx * dx + dz * dz;
    if (ll < 1e-9) continue;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / ll;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (!best || d < best.d) best = { edge: i, t, d };
  }
  return best;
}

function runToFence(run, id) {
  const edges = [];
  for (const s of run.segments) edges.push({ a: [s.x0, s.z0], b: [s.x1, s.z1] });
  for (const g of run.gates) edges.push({ a: [g.x0, g.z0], b: [g.x1, g.z1] });
  const chained = chain(edges);
  if (!chained) return null;
  const points = dissolve(chained.points, chained.closed);
  const gates = [];
  for (const g of run.gates) {
    const m = markOn(points, chained.closed, g.x, g.z);
    if (m) gates.push({ edge: m.edge, t: m.t });
  }
  return { id, points, closed: chained.closed, gates };
}

// Drop the sampled points that only continue a straight line, the same idea as
// dissolve() but with a looser tolerance because a generated path is a curve
// and the corners are gentle.
function simplify(points, tol = 0.18) {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const out = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const scale = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross / scale) > tol) out.push([b[0], b[1]]);
  }
  const end = points[points.length - 1];
  out.push([end[0], end[1]]);
  return out;
}

// world -> document. `world` is anything createWorld() returns.
export function levelFromWorld(world, { name = 'generated', paint = true } = {}) {
  const size = world.size;
  const doc = emptyLevel({ size, seed: world.seed || 1, name });
  doc.wall = { points: wallLoop(size), closed: true, variant: 'ashlar', styles: [] };
  doc.spawn = { x: world.spawn.x, z: world.spawn.z };

  // --- the fences ------------------------------------------------------------
  let fi = 0;
  for (const run of world.runs || []) {
    if (!run.segments || !run.segments.length) continue;
    const f = runToFence(run, `f${fi}`);
    if (f) { doc.fences.push(f); fi += 1; }
  }

  // --- the graves, which take the props with them ------------------------------
  // The generator throws the spoil onto whichever long side is away from the
  // nearest path, so the side is read back off where the heap actually is
  // rather than assumed. Put it on the wrong side and it goes through a fence.
  const heaps = world.props().filter((p) => p.kind === 'dirt');
  const graves = world.graves().slice(0, MAX_SPAWNS);
  graves.forEach((g, i) => {
    const yaw = g.yaw || 0;
    let pile = 1;
    let best = Infinity;
    for (const sign of [1, -1]) {
      const x = g.x + Math.sin(yaw) * 1.2 * sign;
      const z = g.z + Math.cos(yaw) * 1.2 * sign;
      for (const h of heaps) {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < best) { best = d; pile = sign; }
      }
    }
    doc.graves.push({
      id: `g${i}`, x: g.x, z: g.z, yaw, order: i, personality: PERSONALITIES[i % 4], pile,
    });
  });
  renumberGraves(doc);

  // --- the props ---------------------------------------------------------------
  // Every hole is a grave's mouth and every heap beside a grave is that
  // grave's spoil, and the document synthesises both from the pose. Anything
  // else the generator put down is kept exactly where it is.
  let pi = 0;
  for (const p of world.props()) {
    if (p.kind === 'hole') continue;
    if (p.kind === 'dirt' && graves.some((g) => Math.hypot(p.x - g.x, p.z - g.z) < 2.6)) continue;
    doc.props.push({
      id: `p${pi++}`, kind: p.kind, variant: p.variant ?? null,
      x: p.x, z: p.z, yaw: p.yaw || 0,
    });
  }

  // --- the pellets and the paths -------------------------------------------------
  world.powerups().forEach((p, i) => doc.powerups.push({ id: `jack${i}`, x: p.x, z: p.z }));
  let qi = 0;
  for (const path of world.paths()) {
    const points = simplify(path.points);
    if (points.length >= 2) {
      doc.paths.push({
        id: `path${qi++}`, material: 'sand', width: path.width || 1.3, points,
      });
    }
  }

  // --- a first coat of ground cover ------------------------------------------------
  // Grass over the yard and sand along the paths. It is not a guess about what
  // the author wants, it is a starting point they can paint over, and it is
  // the difference between opening the tool on a graveyard and opening it on a
  // grey slab.
  if (paint) {
    const g = doc.ground;
    const cells = new Uint8Array(g.w * g.h);
    const grass = g.materials.indexOf('grass') + 1;
    const sand = g.materials.indexOf('sand') + 1;
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const x = g.minX + (i + 0.5) * g.cell;
        const z = g.minZ + (j + 0.5) * g.cell;
        let v = grass;
        for (const p of doc.paths) {
          for (let k = 0; k + 1 < p.points.length && v === grass; k++) {
            const [ax, az] = p.points[k];
            const [bx, bz] = p.points[k + 1];
            const dx = bx - ax;
            const dz = bz - az;
            const ll = dx * dx + dz * dz || 1;
            let t = ((x - ax) * dx + (z - az) * dz) / ll;
            t = Math.max(0, Math.min(1, t));
            if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < p.width / 2 + 1.0) v = sand;
          }
        }
        cells[j * g.w + i] = v;
      }
    }
    g.paint = packPaint(cells);
  }

  return doc;
}

export default levelFromWorld;
