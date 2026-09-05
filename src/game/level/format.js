// THE LEVEL FILE, and the loader that turns one into a world.
//
// ============================================================================
// WHY THIS EXISTS AND WHAT IT PROMISES
// ============================================================================
//
// src/game/world/index.js generates a level. The editor at /editor/ AUTHORS
// one. The rules half must not be able to tell the difference, so the promise
// this file makes is exactly one sentence:
//
//     createLevelWorld(doc) answers every query createWorld() answers, with
//     the same names, the same box argument and the same record shapes.
//
// That is the whole design constraint. A caller that holds `world` and asks
// `world.barriers(box)`, `world.gates(box)`, `world.props(box)`,
// `world.fireflies(box)`, `world.spawns(box)`,
// `world.paths(box)` or `world.blocks(...)` cannot tell whether it was handed a
// seed or a file. Where the generator publishes an extra field, this publishes
// it too: `kind` and `jumpable` on every barrier, the CAPSULE `clear` on every
// gate, `foot`, `radius`, `height` and `solid` on every prop.
//
// Three things the file does NOT store, and why.
//
//   fireflies   The owner asked for them to be automated. The file carries the
//               RULE and the loader runs it (see fireflies.js). Five positions
//               in a file would be five positions that go stale the moment a
//               headstone moves.
//   barriers    A fence is stored as a POLYLINE with gate marks on it. The
//               barrier list is derived, and derived is the only way to keep
//               the generator's hardest invariant true by construction: A GATE
//               IS A HOLE IN THE BARRIER LIST, NOT AN EXCEPTION TO IT. Store
//               segments and gates separately and the two drift apart on the
//               first edit; derive them from one polyline and they cannot.
//   the grid    The generator works in its own u/v frame. Nothing here does.
//               Everything in the file is WORLD x/z, which is what an author
//               points at and what every query publishes.
//
// ============================================================================
// THE FILE
// ============================================================================
//
// {
//   "format": "graveyard-level",  what this is. Refuse anything else.
//   "version": 1,                 bumped when a field changes meaning
//   "name": "my graveyard",
//   "size": 30,                   the arena is size by size, centred on 0,0.
//                                 At most 30, which is six of the floor's
//                                 major grid squares (src/ghost/ground.js).
//   "seed": 7,                    drives every per-prop wobble and the
//                                 fireflies, so a file renders the same twice
//   "spawn": { "x": 0, "z": 0 },  where the ghost starts
//
//   "wall": {
//     "points": [[x,z],...],      ONE CLOSED LOOP, which is what
//                                 src/ghost/props/fence/wall.js takes. Not
//                                 four runs; see that file's header for why.
//     "closed": true,
//     "variant": "ashlar",        the style the wall STARTS in: ashlar, brick,
//                                 rubble or iron
//     "styles": [                 style changes along the run
//       { "at": 22, "variant": "brick", "joint": "tooth" },
//       { "at": 58, "variant": "rubble", "joint": "pier", "jointVariant": "iron" }
//     ]                           `at` is a distance along the centreline from
//                                 points[0], the same coordinate a gate uses.
//                                 joint is 'pier', 'tooth' or 'step'. At most
//                                 MAX_STYLES distinct styles on one wall.
//   },
//
//   "fences": [                   pens and dividers, one polyline each
//     { "id": "f0",
//       "points": [[x,z], ...],
//       "closed": true,           a closed loop is a pen
//       "gates": [ { "edge": 2, "t": 0.5 } ] }
//                                 a gate sits on edge `edge` of the polyline,
//                                 `t` of the way along it. The loader cuts a
//                                 2 * GATE_HALF hole there and publishes the
//                                 gate record; the segments either side stop
//                                 at the jambs.
//   ],
//
//   "props": [
//     { "id": "p0", "kind": "stone", "variant": "celtic",
//       "x": -4.5, "z": 2.0, "yaw": 0.7854 }
//                                 yaw is radians, continuous, never snapped by
//                                 the format. radius / height / solid / foot
//                                 are DERIVED from the measured table, never
//                                 stored, so a re-measure lands everywhere.
//   ],
//
//   "paths": [
//     { "id": "path0", "material": "sand" | "gravel" | "kerb",
//       "width": 1.3, "points": [[x,z], ...] }
//                                 `material` is the one field the generator's
//                                 paths() does not carry. Adding a field is
//                                 compatible; a caller that ignores it gets
//                                 the generator's own record.
//   ],
//
//   "graves": [
//     { "id": "g0", "x": 3, "z": -2, "yaw": 0.78, "order": 0,
//       "personality": "chaser", "pile": 1, "head": 1, "headstone": "cross" }
//                                 A DUG GRAVE, AND NO LONGER A SPAWN. Skeletons
//                                 climb out in front of HEADSTONES now, any of
//                                 them, chosen at random: see world/spawn.js.
//                                 So a grave is three props in a pose and
//                                 nothing else, and its `order` and
//                                 `personality` are dead fields that a file
//                                 written before the change still carries. They
//                                 are read, kept and written back untouched so
//                                 that an old file round-trips and the editor
//                                 can still show what it has; nothing in the
//                                 game reads either of them. At most four,
//                                 because ground.js still cuts at most four
//                                 holes.
//
//                                 A GRAVE IS THREE PROPS AND THE FILE STORES
//                                 ONE POSE. The mouth, the spoil heap and the
//                                 headstone are synthesised from it in exactly
//                                 the arrangement layout/motifs.js builds, so
//                                 audit.js's grave rule passes by construction:
//                                 `head` is which end the stone stands at and
//                                 `pile` which long side the spoil is thrown
//                                 onto, both 1 or -1, and `headstone` is the
//                                 stone's variant or null for a grave with no
//                                 marker. The wrong `pile` puts the heap
//                                 through a fence or on the path side, which
//                                 the audit calls out and the editor can flip.
//   ],
//
//   "powerups": [ { "id": "jack0", "x": 8, "z": 8 } ],
//                                 LEGACY, and read for the same reason. The lit
//                                 jack-o'-lantern was the power pellet and the
//                                 owner has taken the pellet out, so nothing in
//                                 the game collects one and no world query
//                                 publishes them. A file that has some still
//                                 opens, still keeps them, and the editor can
//                                 still delete them.
//
//   "ground": {                   the painted ground cover; see groundcover.js
//     "cell": 0.5, "minX": -15, "minZ": -15, "w": 60, "h": 60,
//     "materials": ["grass", "sand", "gravel", "earth"],
//     "paint": "3600:0",          run-length: "<count>:<index>,..." where index
//                                 0 is bare floor and n is materials[n-1]
//     "kerbs": [["grass","earth"]]
//                                 which pairs of grounds meet at a row of
//                                 stones rather than at a plain crossover.
//                                 groundcover.js owns what that means.
//   },
//
//   "fireflies": { "count": 5, "gap": 12, "edge": 1.5, "seed": 7 }
//                                 THE RULE, not the positions. FIVE is the
//                                 owner's number and `gap` is a floor rather
//                                 than a target: the sampler maximises the
//                                 spacing by itself and reaches about twenty,
//                                 which is a screen's width. See fireflies.js
//                                 for the measurements behind both, and
//                                 DEFAULT_FLY_RULE for the fields left out
//                                 here, which a file rarely sets.
// }
//
// ============================================================================
// HOW THE GAME LOADS ONE
// ============================================================================
//
//   /lab/?game=1&level=/levels/mine.json    play it
//   /lab/?world=1&level=/levels/mine.json   walk it, with no game in it
//   /lab/?game=1&level=session              play what the editor has open,
//                                           which is what its play button
//                                           opens. See loadLevelFrom.
//
// Both pages take a `level` query parameter and, when it is there, build from
// the file instead of from a seed: src/game/scene.js is the game and
// src/game/viewer.js is the placement viewer. That parameter is the ONLY door:
// nothing the editor writes reaches a shipped page except through a URL the
// owner types, so a level in the editor's autosave cannot leak into /,
// /ghostly/ or /lab/.
//
// A level the game SHIPS WITH lives in public/levels/, which Vite copies to the
// site root, so /levels/demo.json is a level anyone can be sent to. That is
// still a typed URL and still nothing any page links to.

import {
  PANEL, FENCE_HALF, BARRIER_HEIGHT, GATE_HALF, GATE_APPROACH, GATE_CLEAR_R,
} from '../world/fence.js';
import { GATE } from '../layout/gate.js';
import { LEVEL_SIZE, WALL_HALF, WALL_HEIGHT, PATH_HALF } from '../world/field.js';
import { WALL, MAX_STYLES } from '../../ghost/props/fence/wall.js';
import { levelFootprint, boundingRadius, isSolid, MAX_SPAWNS, PERSONALITIES } from './catalogue.js';
import { spawnPoints } from '../world/spawn.js';
import { placeFireflies, DEFAULT_FLY_RULE } from './fireflies.js';

export const LEVEL_FORMAT = 'graveyard-level';
export const LEVEL_VERSION = 1;

// The body the rules half moves. src/game/world/level.js exports the same
// number; it is repeated rather than imported because importing level.js pulls
// the whole generator, and this module has to load in a page that has no use
// for it. If BODY moves there it moves here.
export const BODY = 0.60;

export const GROUND_MATERIALS = ['grass', 'sand', 'gravel', 'earth'];

// Read off the prop rather than written down twice. wall.js publishes the four
// it builds and the cap on how many one wall may carry.
export const WALL_VARIANTS = WALL.variants.slice();
export const WALL_JOINTS = ['pier', 'tooth', 'step'];
export { MAX_STYLES };

// HOW MANY TIMES A WALL MAY CHANGE HANDS, which is a different number from how
// many stones it may be built of, and confusing the two is what stopped a wall
// being crafted piece by piece.
//
// wall.js's cap is on DISTINCT STYLES: at most MAX_STYLES of them, because the
// geometry carries a style index per vertex and the shader holds that many
// builds. It says nothing at all about how many CHANGES there may be, and it
// does not need to: ashlar to brick and back to ashlar is two changes and two
// styles. This file used to keep only the first MAX_STYLES - 1 changes, which
// meant three, which meant an author could put a change at three of the wall's
// twenty-four piers and no more -- a limit nothing in the prop asked for.
//
// So the real constraint is enforced instead, below: a change is kept while the
// set of stones it needs still fits in MAX_STYLES. This is only a bound against
// a pathological file; a wall of a hundred and twenty units has twenty-four
// piers and there is no reason to want a change between every pair of them.
export const MAX_WALL_CHANGES = 64;
export const GROUND_CELL = 0.5;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const levelBoxOf = (size) => ({
  minX: -size / 2, maxX: size / 2, minZ: -size / 2, maxZ: size / 2,
});

// The perimeter, as the one closed loop wall.js wants.
// How long the wall's centreline is, which is the range every `at` lives in.
export function wallLength(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

// A point on the wall's centreline at a distance from points[0], and the
// direction the run is going there. This is the inverse of the coordinate every
// style change and every gate is written in, so it is what turns "a change at
// 34" into a mark the author can see on the floor and a click on the floor into
// a distance.
export function wallPointAt(points, at) {
  const total = wallLength(points);
  let d = ((at % total) + total) % total;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    if (d <= len) {
      const t = d / len;
      return {
        x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t,
        dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len,
      };
    }
    d -= len;
  }
  const a = points[0];
  return { x: a[0], z: a[1], dx: 1, dz: 0 };
}

// The nearest point ON the wall to somewhere the author clicked, as a distance
// along it. Same coordinate, the other way round.
export function wallDistanceTo(points, x, z) {
  let acc = 0;
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const ll = dx * dx + dz * dz;
    if (ll < 1e-9) continue;
    const len = Math.sqrt(ll);
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / ll;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const away = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (!best || away < best.away) best = { away, at: acc + t * len };
    acc += len;
  }
  return best || { away: Infinity, at: 0 };
}

export function wallLoop(size) {
  const h = size / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]];
}

// --- the document ------------------------------------------------------------

export function emptyLevel({ size = LEVEL_SIZE, seed = 1, name = 'untitled' } = {}) {
  const box = levelBoxOf(size);
  const w = Math.round((box.maxX - box.minX) / GROUND_CELL);
  const h = Math.round((box.maxZ - box.minZ) / GROUND_CELL);
  return {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    name,
    size,
    seed,
    spawn: { x: 0, z: 0 },
    wall: { points: wallLoop(size), closed: true, variant: WALL_VARIANTS[0], styles: [] },
    fences: [],
    props: [],
    paths: [],
    graves: [],
    powerups: [],
    ground: {
      cell: GROUND_CELL, minX: box.minX, minZ: box.minZ, w, h,
      materials: GROUND_MATERIALS.slice(),
      paint: `${w * h}:0`,
      kerbs: [],
    },
    fireflies: { ...DEFAULT_FLY_RULE, seed },
  };
}

// Fill in everything a file may have left out, clamp everything that has a
// limit, and give every record an id. A file the owner hand-edited is still a
// file, so nothing here throws on a missing field.
export function normalizeLevel(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not a level file');
  if (raw.format && raw.format !== LEVEL_FORMAT) {
    throw new Error(`not a ${LEVEL_FORMAT} file (found "${raw.format}")`);
  }
  const size = Math.max(6, Math.min(LEVEL_SIZE, num(raw.size, LEVEL_SIZE)));
  const doc = emptyLevel({ size, seed: num(raw.seed, 1), name: String(raw.name || 'untitled') });

  if (raw.spawn) doc.spawn = { x: num(raw.spawn.x, 0), z: num(raw.spawn.z, 0) };
  if (raw.wall) {
    const w = raw.wall;
    if (w.points?.length >= 3) {
      doc.wall.points = w.points.map((p) => [num(p[0], 0), num(p[1], 0)]);
    }
    doc.wall.variant = WALL_VARIANTS.includes(w.variant) ? w.variant : WALL_VARIANTS[0];
    // A style change wall.js would refuse for needing a fifth stone is dropped
    // rather than thrown: a file the owner hand-edited should open. The stones
    // are counted as wall.js counts them -- the base variant, then each
    // change's own and each pier joint's own -- and a change is kept as long as
    // what it needs still fits.
    const stones = new Set([doc.wall.variant]);
    doc.wall.styles = (w.styles || [])
      .map((st) => ({
        at: Math.max(0, num(st.at, 0)),
        variant: WALL_VARIANTS.includes(st.variant) ? st.variant : WALL_VARIANTS[1],
        joint: WALL_JOINTS.includes(st.joint) ? st.joint : 'pier',
        ...(WALL_VARIANTS.includes(st.jointVariant) ? { jointVariant: st.jointVariant } : {}),
      }))
      .sort((a, b) => a.at - b.at)
      .filter((st) => {
        const want = new Set(stones);
        want.add(st.variant);
        if (st.jointVariant) want.add(st.jointVariant);
        if (want.size > MAX_STYLES) return false;
        for (const v of want) stones.add(v);
        return true;
      })
      .slice(0, MAX_WALL_CHANGES);
  }

  doc.fences = (raw.fences || []).map((f, i) => ({
    id: f.id || `f${i}`,
    points: (f.points || []).map((p) => [num(p[0], 0), num(p[1], 0)]),
    closed: !!f.closed,
    gates: (f.gates || []).map((g) => ({
      edge: Math.max(0, Math.round(num(g.edge, 0))),
      t: Math.min(1, Math.max(0, num(g.t, 0.5))),
    })),
  })).filter((f) => f.points.length >= 2);

  doc.props = (raw.props || []).map((p, i) => ({
    id: p.id || `p${i}`,
    kind: String(p.kind || 'stone'),
    variant: p.variant == null ? null : String(p.variant),
    x: num(p.x, 0), z: num(p.z, 0), yaw: num(p.yaw, 0),
  }));

  doc.paths = (raw.paths || []).map((p, i) => ({
    id: p.id || `path${i}`,
    material: ['sand', 'gravel', 'kerb'].includes(p.material) ? p.material : 'sand',
    width: Math.max(0.4, num(p.width, PATH_HALF * 2)),
    points: (p.points || []).map((q) => [num(q[0], 0), num(q[1], 0)]),
  })).filter((p) => p.points.length >= 2);

  // At most four, and the order is a permutation of 0..n-1 whatever the file
  // said. A file with two graves both marked "order 3" is a file somebody
  // hand-edited, and the fix is to renumber rather than to refuse.
  doc.graves = (raw.graves || []).slice(0, MAX_SPAWNS).map((g, i) => ({
    id: g.id || `g${i}`,
    x: num(g.x, 0), z: num(g.z, 0), yaw: num(g.yaw, 0),
    order: num(g.order, i),
    personality: PERSONALITIES.includes(g.personality) ? g.personality : PERSONALITIES[i % 4],
    pile: num(g.pile, 1) < 0 ? -1 : 1,
    head: num(g.head, 1) < 0 ? -1 : 1,
    headstone: g.headstone === null ? null : String(g.headstone || 'cross'),
  }));
  renumberGraves(doc);

  doc.powerups = (raw.powerups || []).map((p, i) => ({
    id: p.id || `jack${i}`, x: num(p.x, 0), z: num(p.z, 0),
  }));

  if (raw.ground) {
    const g = raw.ground;
    const cell = Math.max(0.1, num(g.cell, GROUND_CELL));
    const w = Math.max(1, Math.round(num(g.w, doc.ground.w)));
    const h = Math.max(1, Math.round(num(g.h, doc.ground.h)));
    doc.ground = {
      cell, w, h,
      minX: num(g.minX, doc.ground.minX),
      minZ: num(g.minZ, doc.ground.minZ),
      materials: Array.isArray(g.materials) && g.materials.length
        ? g.materials.slice() : GROUND_MATERIALS.slice(),
      paint: typeof g.paint === 'string' ? g.paint : `${w * h}:0`,
      // WHICH PAIRS OF GROUNDS MEET AT A KERB, as [["grass","earth"], ...].
      // This block belongs to level/groundcover.js and not to anything here:
      // the format's job is to carry it from the file to that module without
      // an opinion, so a pair naming a material this level does not have is
      // kept rather than dropped. Absent is the common case and means every
      // border is a plain crossover.
      kerbs: (Array.isArray(g.kerbs) ? g.kerbs : [])
        .filter((k) => Array.isArray(k) && k.length === 2)
        .map(([a, b]) => [String(a), String(b)]),
    };
  }

  doc.fireflies = { ...DEFAULT_FLY_RULE, seed: doc.seed, ...(raw.fireflies || {}) };
  return doc;
}

// Sort by the order the author gave and then renumber 0..n-1, so the sequence
// is always a clean run with no holes and no ties.
export function renumberGraves(doc) {
  doc.graves.sort((a, b) => a.order - b.order);
  doc.graves.forEach((g, i) => { g.order = i; });
  return doc;
}

export function serializeLevel(doc) {
  return JSON.stringify(doc, null, 2);
}

// --- the painted ground, packed and unpacked ---------------------------------
//
// Run length, "<count>:<index>", comma separated, index 0 meaning bare floor.
// A 60 by 60 field of one material is eleven characters; a busy one is a few
// hundred. It stays readable in the file, which matters because the file is
// something the owner may open in an editor.

export function packPaint(cells) {
  const out = [];
  let run = 0;
  let cur = cells[0] | 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i] | 0;
    if (v === cur) { run += 1; continue; }
    out.push(`${run}:${cur}`);
    cur = v; run = 1;
  }
  out.push(`${run}:${cur}`);
  return out.join(',');
}

export function unpackPaint(text, count) {
  const cells = new Uint8Array(count);
  let at = 0;
  for (const part of String(text || '').split(',')) {
    if (!part) continue;
    const [n, v] = part.split(':');
    const run = Math.max(0, parseInt(n, 10) || 0);
    const val = Math.max(0, parseInt(v, 10) || 0);
    for (let i = 0; i < run && at < count; i++) cells[at++] = val;
  }
  return cells;
}

// --- barriers, derived from the polylines -------------------------------------

function segmentRecord({ id, run, kind, x0, z0, x1, z1, half, height, jumpable }) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  return {
    id, run, kind, jumpable,
    x0, z0, x1, z1,
    half, length: len, panels: Math.max(1, Math.round(len / PANEL)),
    height,
    yaw: Math.atan2(-(z1 - z0), x1 - x0),
    box: {
      minX: Math.min(x0, x1) - half, maxX: Math.max(x0, x1) + half,
      minZ: Math.min(z0, z1) - half, maxZ: Math.max(z0, z1) + half,
    },
  };
}

// One polyline plus its gate marks, cut into barrier segments and gate records.
//
// The cut is the whole point. For each edge the gates on it become intervals
// [s - GATE_HALF, s + GATE_HALF] in arc length along that edge, the intervals
// are removed, and what is left becomes segments. So the barrier list has a
// literal hole where the gate is, exactly as world/fence.js builds it, and no
// caller anywhere needs a gate case.
function cutRun(run, { half, height, jumpable, id }) {
  const pts = run.points;
  const edges = [];
  const last = run.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 1e-6) edges.push({ i, a, b, len, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len });
  }

  const segments = [];
  const gates = [];
  for (const e of edges) {
    const holes = (run.gates || [])
      .filter((g) => g.edge === e.i)
      // Keep the whole opening on the edge: a gate that hangs off the end
      // would leave a jamb in mid air and a hole in the perimeter of a pen.
      .map((g) => Math.min(e.len - GATE_HALF, Math.max(GATE_HALF, g.t * e.len)))
      .filter((s) => e.len >= 2 * GATE_HALF + 0.05)
      .sort((p, q) => p - q);

    let at = 0;
    for (const s of holes) {
      const a0 = s - GATE_HALF;
      const b0 = s + GATE_HALF;
      if (a0 - at > 0.05) {
        segments.push(segmentRecord({
          id: `${id}/s${segments.length}`, run: id, kind: jumpable ? 'fence' : 'wall',
          x0: e.a[0] + e.dx * at, z0: e.a[1] + e.dz * at,
          x1: e.a[0] + e.dx * a0, z1: e.a[1] + e.dz * a0,
          half, height, jumpable,
        }));
      }
      gates.push(gateRecord({
        id: `${id}/g${gates.length}`, run: id,
        ax: e.a[0] + e.dx * a0, az: e.a[1] + e.dz * a0,
        bx: e.a[0] + e.dx * b0, bz: e.a[1] + e.dz * b0,
        dx: e.dx, dz: e.dz, edge: e.i, t: s / e.len,
      }));
      at = b0;
    }
    if (e.len - at > 0.05) {
      segments.push(segmentRecord({
        id: `${id}/s${segments.length}`, run: id, kind: jumpable ? 'fence' : 'wall',
        x0: e.a[0] + e.dx * at, z0: e.a[1] + e.dz * at,
        x1: e.b[0], z1: e.b[1],
        half, height, jumpable,
      }));
    }
  }
  return { segments, gates };
}

function gateRecord({ id, run, ax, az, bx, bz, dx, dz, edge, t }) {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  // The normal through the opening, which is the direction a body walks.
  const nx = -dz;
  const nz = dx;
  const prop = { x: ax - GATE.hingeX * dx, z: az - GATE.hingeX * dz };
  return {
    id, run, barrier: run, edge, t,
    x: mx, z: mz,
    dx, dz, nx, nz,
    half: GATE_HALF,
    x0: ax, z0: az, x1: bx, z1: bz,
    hinge: { x: ax, z: az },
    sweep: { x: ax, z: az, r: GATE.sweepRadius },
    // A CAPSULE, not a disc, and for the reason world/index.js gives: the
    // question is not whether a body fits through the opening but whether it
    // can reach it, and a disc lets a prop sit a thousandth outside and plug
    // the mouth.
    clear: {
      x0: mx - nx * GATE_APPROACH, z0: mz - nz * GATE_APPROACH,
      x1: mx + nx * GATE_APPROACH, z1: mz + nz * GATE_APPROACH,
      r: GATE_CLEAR_R,
    },
    prop: { x: prop.x, z: prop.z, yaw: Math.atan2(dx, dz) + Math.PI / 2 },
    box: {
      minX: mx - GATE.sweepRadius - GATE_APPROACH, maxX: mx + GATE.sweepRadius + GATE_APPROACH,
      minZ: mz - GATE.sweepRadius - GATE_APPROACH, maxZ: mz + GATE.sweepRadius + GATE_APPROACH,
    },
  };
}

// The prop record every query publishes, built from what the file stores plus
// the measured table. Nothing derived is ever written to the file.
export function propRecord(p, index = 0) {
  const foot = levelFootprint(p.kind, p.variant);
  return {
    id: p.id || `p${index}`,
    kind: p.kind, variant: p.variant,
    x: p.x, z: p.z, yaw: p.yaw || 0,
    radius: boundingRadius(foot),
    height: foot.height,
    solid: isSolid(p.kind),
    foot,
  };
}

// --- the world ---------------------------------------------------------------

const boxesOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
const padBox = (b, p) => ({ minX: b.minX - p, maxX: b.maxX + p, minZ: b.minZ - p, maxZ: b.maxZ + p });
const inBox = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
const PROP_REACH = 2.2;

export function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const s = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = s(cx, cz, dx, dz, ax, az);
  const d2 = s(cx, cz, dx, dz, bx, bz);
  const d3 = s(ax, az, bx, bz, cx, cz);
  const d4 = s(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// A GRAVE IS THREE PROPS AND THE FILE STORES ONE POSE.
//
// The generator's graves are a pose plus a hole, a spoil heap and a headstone,
// and `graves(box)` points at the hole. A hand-made level stores only the pose,
// because a spawn the author can move in one piece is the whole point of the
// tool, and the three props are synthesised here. They come out of props()
// exactly as the generator's do, which is what keeps the renderer, the audit
// and the reachability fill on one code path.
//
// THE ARRANGEMENT IS layout/motifs.js's graveGroup, TO THE CENTIMETRE, and it
// has to be: audit.js's grave rule asks that the heap sits on a long side and
// the stone at an end, and the numbers below are the ones that satisfy it with
// the audit's 0.15 margin to spare. The hole is 2.0 by 0.9 in plan with its
// long axis along local X, so
//
//   the heap   local ( -head * HEAP_SHIFT, pile * (0.45 + 0.643 + 0.22) )
//   the stone  local ( head * (1.0 + stone.halfU + 0.25), 0 )
//
// and all three carry the grave's own yaw, so turning a grave turns the whole
// plot. Local to world is x + lx * (cos, -sin) + lz * (sin, cos), which is what
// a three.js rotation about Y does.
//
// It is exported because the EDITOR has to know it too: the placement
// indicator has to say whether a grave will fit before it is dropped, and the
// only honest way to answer that is to ask about the three props it is
// actually going to be.
const HEAP_SHIFT = 0.45;

export function graveProps(g) {
  const id = g.id || 'g';
  const yaw = g.yaw || 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const head = g.head === -1 ? -1 : 1;
  const pile = g.pile === -1 ? -1 : 1;
  const at = (lx, lz) => ({ x: g.x + lx * c + lz * s, z: g.z - lx * s + lz * c });
  const hole = levelFootprint('hole');
  const dirt = levelFootprint('dirt');
  const out = [propRecord({ id: `${id}/hole`, kind: 'hole', variant: 'grave', x: g.x, z: g.z, yaw })];
  const heap = at(-head * HEAP_SHIFT, pile * (hole.halfV + dirt.halfV + 0.22));
  out.push(propRecord({ id: `${id}/dirt`, kind: 'dirt', variant: null, x: heap.x, z: heap.z, yaw }));
  if (g.headstone) {
    const stone = levelFootprint('stone', g.headstone);
    const p = at(head * (hole.halfU + stone.halfU + 0.25), 0);
    out.push(propRecord({ id: `${id}/head`, kind: 'stone', variant: g.headstone, x: p.x, z: p.z, yaw }));
  }
  return out;
}

// Everything derived from a document, in one place, so the editor and the
// loader agree on what a document means down to the last segment.
export function deriveLevel(doc) {
  const box = levelBoxOf(doc.size);
  const wall = cutRun(
    { points: doc.wall.points, closed: true, gates: [] },
    { half: WALL_HALF, height: WALL_HEIGHT, jumpable: false, id: 'wall' },
  );
  // THE RUN'S KIND IS THE GENERATOR'S VOCABULARY, because audit.js reads it and
  // treats the three differently: a PEN is closed and must have a gate and
  // exactly the two free ends its opening makes; a DIVIDER is an open run with
  // a gate in it; a STUB is an open run whose opening IS its open end, which
  // needs no gate. An open run an author draws and leaves ungated is a stub,
  // and calling it one is a statement about its geometry rather than a way
  // round the check: you walk round its end.
  const runs = doc.fences.map((f) => {
    const cut = cutRun(f, { half: FENCE_HALF, height: BARRIER_HEIGHT, jumpable: true, id: f.id });
    return {
      id: f.id,
      kind: f.closed ? 'pen' : (cut.gates.length ? 'divider' : 'stub'),
      ...cut,
      source: f,
    };
  });
  const barriers = [...wall.segments, ...runs.flatMap((r) => r.segments)];
  const gates = runs.flatMap((r) => r.gates);
  // The graves, each one three props. See graveProps above.
  const props = [...doc.props.map(propRecord), ...doc.graves.flatMap(graveProps)];
  const paths = doc.paths.map((p) => ({
    id: p.id, material: p.material, width: p.width, points: p.points.map((q) => [q[0], q[1]]),
  }));
  const graves = doc.graves.map((g) => ({
    id: g.id, x: g.x, z: g.z, yaw: g.yaw, order: g.order, personality: g.personality,
    pile: g.pile, head: g.head, headstone: g.headstone,
  }));
  const powerups = doc.powerups.map((p, i) => ({
    id: p.id || `jack${i}`, kind: 'jack', x: p.x, z: p.z, yaw: Math.PI / 4,
    radius: levelFootprint('pumpkin', 'classic').r,
  }));
  const flies = placeFireflies({
    box, barriers, gates, props, paths, spawn: doc.spawn, rule: doc.fireflies,
  });
  // Every headstone with a face and a clear plot in front of it. Worked out
  // here rather than stored, for the reason the fireflies are: a spawn point in
  // a file is a spawn point that goes stale the moment a bench moves.
  const spawns = spawnPoints({ props, barriers, gates, box });
  return { box, wall, runs, barriers, gates, props, paths, graves, powerups, spawns, flies };
}

// The world, shaped exactly as createWorld() shapes one.
export function createLevelWorld(input) {
  const doc = input && input.format === LEVEL_FORMAT ? input : normalizeLevel(input);
  const d = deriveLevel(doc);
  const clip = (list, q) => (q ? list.filter((e) => inBox(padBox(q, PROP_REACH), e.x, e.z)) : list);

  return {
    doc,
    seed: doc.seed,
    size: doc.size,
    bounds: d.box,
    spawn: { ...doc.spawn },

    BODY,
    WALL_HEIGHT,
    WALL_HALF,
    BARRIER_HEIGHT,
    BARRIER_HALF: FENCE_HALF,
    GATE_HALF,
    PANEL,
    PATH_HALF,

    wall: d.wall.segments,
    runs: d.runs,

    props(q) {
      if (!q) return d.props;
      return d.props.filter((p) => p.x + p.radius >= q.minX && p.x - p.radius <= q.maxX
        && p.z + p.radius >= q.minZ && p.z - p.radius <= q.maxZ);
    },
    barriers(q) {
      if (!q) return d.barriers;
      return d.barriers.filter((s) => boxesOverlap(s.box, q));
    },
    gates(q) {
      if (!q) return d.gates;
      return d.gates.filter((g) => boxesOverlap(g.box, q));
    },
    fireflies: (q) => clip(d.flies.points, q),
    spawns: (q) => clip(d.spawns, q),
    paths(q) {
      if (!q) return d.paths;
      const pad = padBox(q, PROP_REACH);
      return d.paths.filter((p) => p.points.some(([x, z]) => inBox(pad, x, z)));
    },

    blocks(x0, z0, x1, z1) {
      for (const s of d.barriers) {
        if (segmentsCross(x0, z0, x1, z1, s.x0, s.z0, s.x1, s.z1)) return s;
      }
      return null;
    },

    // The bounded world builds everything at once. These are here only so a
    // caller written against the endless one keeps working, exactly as
    // world/index.js keeps them.
    ensureAround: () => [],
    release: () => 0,

    ground: doc.ground,
    stats: {
      props: d.props.length, gates: d.gates.length,
      fireflies: d.flies.points.length, spawns: d.spawns.length,
    },
    _derived: d,
  };
}

// THE HANDOVER, and it is the whole of the authoring loop.
//
// `level=session` is not a URL and nothing fetches it. It means "the document
// the editor has open right now", which the editor writes to this key the
// moment its play button is pressed. The alternative was the loop the owner
// actually had: save a file, find it in the downloads folder, move it into
// public/levels/, type a URL. Four steps between moving a headstone and seeing
// how it plays, several hundred times.
//
// localStorage rather than sessionStorage, because sessionStorage is per tab
// and a copy of it is what a new tab inherits, so the second press of play
// would hand over a stale document. This key is shared by every tab on the
// origin and is written fresh on every press.
//
// WHAT THIS DOES TO THE EDITOR'S PROMISE, said plainly rather than left for
// somebody to find. /editor/ used to be unable to put anything on a shipped
// page at all. It now can, through this one key, and only into a page opened
// with `level=session` in its URL. Nothing links to that, a stranger opening
// /lab/?game=1 gets the level the site ships, and the key never leaves the
// browser it was written in. What is gone is "cannot", and what replaces it is
// "only when the person at the keyboard asks for it by name".
export const SESSION_LEVEL = 'session';
export const SESSION_KEY = 'graveyard-editor/session/v1';

// Fetch and load in one call, for a page that takes a level as a URL.
export async function loadLevelFrom(url) {
  if (url === SESSION_LEVEL) {
    let raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch { /* private window */ }
    if (!raw) {
      throw new Error('nothing has been sent from the editor in this browser. Open /editor/ and press play.');
    }
    return createLevelWorld(normalizeLevel(JSON.parse(raw)));
  }
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`level ${url}: ${res.status}`);
  return createLevelWorld(normalizeLevel(await res.json()));
}

export default createLevelWorld;
