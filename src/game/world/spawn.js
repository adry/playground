// WHERE A SKELETON COMES OUT OF THE GROUND.
//
// ============================================================================
// WHAT CHANGED, AND WHY THIS FILE EXISTS
// ============================================================================
//
// A level used to carry four SPAWNS: hand-placed graves, each tied to one of
// the four personalities, each with a hole cut in the floor. The pen was those
// four holes and nothing else could be used. That is gone. A skeleton now
// climbs out in front of ANY HEADSTONE, chosen at random, and the four graves a
// level still holds are decoration: a hole, a spoil heap and a marker, exactly
// as pretty as they were and no longer special.
//
// The whole cost of that change is one geometric promise, and this file is it:
//
//     EVERY HEADSTONE THAT CAN BE SPAWNED FROM PUBLISHES A KEEP-CLEAR ZONE IN
//     FRONT OF ITS FACE, AND NOTHING SOLID MAY STAND IN ONE.
//
// ============================================================================
// THE SIZE, MEASURED
// ============================================================================
//
// Not the skeleton's standing footprint. The CLIMB, which uses far more floor
// than the figure does: perform.js plants both hands ahead of the shoulders and
// hauls the ribcage over the lip, then the rise flings the arms out sideways.
//
// Built headless off props/skeleton/model.js and props/skeleton/perform.js,
// driven through 'emerging' and 'rising' at 60 Hz over six seeds, taking the
// extent of every vertex ABOVE THE FLOOR (perform.js clips the figure at
// y = -0.04, so a bone still in the hole is not in the measurement):
//
//   ahead of its own origin   1.247      the right hand, and later the skull
//   behind it                 1.097      a shin swinging clear of the hole
//   either side               0.915      the arms, flung out during the rise
//
// The standing figure is 0.95 across the shoulders and 0.90 deep, so the climb
// wants nearly FOUR TIMES the floor the finished skeleton stands on. Sizing
// this on the body would have put a bench through both its elbows.
//
// Each of those gets MARGIN, the same 0.15 audit.js keeps between any two
// props, because "the climb does not clip the bench" is the same question rule
// 1 asks and deserves the same answer:
//
//   STAND   1.25   from the stone's FRONT FACE to where the figure comes up
//   AHEAD   1.40   from there to the far edge of the zone
//   HALF    1.07   half the zone's width
//
// so the zone is a 2.14 by 2.65 rectangle whose near edge is the stone's front
// face. On the design doc's lattice that is a little more than one 2.0 tile
// wide and a little more than one deep: a headstone with a plot in front of it,
// which is what a headstone has.
//
// ============================================================================
// A RECTANGLE, AND WHY NOT A HALF-DISC
// ============================================================================
//
// A half-disc off the face places better in a tight spot, and it was the
// tempting answer. Two things decided against it.
//
// The first is that the region is not disc shaped. The climb reaches 1.25
// BEHIND the point the figure comes up at, which is why STAND exists at all: a
// half-disc centred on the face would have to be 2.65 in radius to cover the
// far hand, and would then be 2.65 across the stone in both directions, which
// is wider than the rectangle and covers ground the climb never touches.
//
// The second is that the rectangle costs no new geometry anywhere. It is
// exactly the { shape: 'box', halfU, halfV } plus a yaw that every prop in this
// project already publishes, so audit.js's shapeOf, gapBetween, axesOf and
// halfAcross take it unchanged, and so does the editor's placement indicator.
// The first DIRECTIONAL footprint in the project should not also be the first
// footprint nothing can test.
//
// ============================================================================
// WHICH STONES, AND THE ONES THAT ARE NOT SILENTLY EXEMPT
// ============================================================================
//
// A skeleton coming up in front of a bench, or through the lid of a chest tomb,
// or off the middle of a ledger slab, is wrong in a way no clearance fixes. And
// a stone that is as deep as it is wide has no face: pointing a spawn off one
// is choosing a direction the model does not have. So two clauses, and both are
// facts about the prop rather than about the level:
//
//   1. IT MUST BE A MARKER. bench, ledger, chest and kerb are in the stone
//      registry and are not headstones -- footprints.js says so in its own
//      header. A bench is furniture, a ledger is the slab laid ON the plot, a
//      chest tomb is the body, and a kerb is the plot's border. Their front is
//      not free ground.
//   2. IT MUST HAVE A FACE, measured: halfU >= FACE_RATIO * halfV. That takes
//      out boulder, cairn, sundial, pyramid, stump, column, urn, book, vault,
//      calvary and obelisk, all of which are round, square or four-sided in
//      plan.
//
// Fourteen of the twenty-nine variants are left. The point of writing the test
// rather than a list is that a stone added to the registry tomorrow gets an
// answer without anybody remembering this file exists.
//
// AND THE THIRD REASON A STONE DOES NOT SPAWN, which is about the LEVEL and not
// about the prop: its zone may be off the edge of the arena, in a gate's sweep,
// or across a fence. A headstone with its face half a metre from a fence is a
// perfectly good thing to place and no rule should forbid it; what it is not is
// a place a skeleton can come out. Those stones are DEMOTED rather than
// refused, and the count of what is left is what audit.js checks, so a level
// that has run out of places for the herd to come from fails loudly.
//
// A SOLID PROP in a zone is the other case and it is the one that FAILS, since
// it is the case an author creates by accident and can fix by moving one thing.
// That is audit.js's `spawn` rule and repair.js clears it for the generator.

// The stones in the registry that are not markers. See clause 1 above.
export const NOT_MARKERS = new Set(['bench', 'ledger', 'chest', 'kerb']);

// How much wider than deep a stone has to be before it counts as having a face.
// 1.5 is the gap in the measured table rather than a round number: the widest
// stone below it is book at 1.33 and the narrowest above it is draped at 1.59,
// so nothing sits near the line and a re-measure will not flip anything.
export const FACE_RATIO = 1.5;

// The three measured numbers. See the essay above.
export const STAND = 1.25;
export const AHEAD = 1.40;
export const HALF = 1.07;
export const DEPTH = STAND + AHEAD;

// How many usable markers a level must have. Four, because rules.js runs four
// personalities and a level where all four share one stone is a level with a
// pen in it again. It is a FLOOR and not a target: a generated arena averages
// nine and a hand-made one can have twenty.
export const SPAWN_FLOOR = 4;

// Does this prop record publish a zone at all? Takes the record every world
// query publishes, so `foot`, `yaw` and `variant` are already on it.
export function isMarker(p) {
  if (!p || p.kind !== 'stone') return false;
  if (NOT_MARKERS.has(p.variant)) return false;
  const f = p.foot;
  if (!f || f.shape !== 'box') return false;
  return f.halfU >= FACE_RATIO * f.halfV;
}

// The direction a stone faces. stones/index.js builds every headstone with its
// inscription on local +Z and footprints.js says so, and world x/z maps a local
// +Z to (sin yaw, cos yaw), which is the same isometry audit.js's shapeOf uses.
export function faceOf(p) {
  return { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
}

// The zone, as a footprint record with a yaw on it: the same shape every prop
// publishes, so every test already written takes it.
//
//   { x, z, yaw, foot }   the rectangle, centred
//   { at: { x, z } }      where the figure comes up, STAND off the face
//   { of }                the stone's id, so a finding can name it
//
// null for anything that is not a marker.
export function spawnZone(p) {
  if (!isMarker(p)) return null;
  const f = faceOf(p);
  const mid = p.foot.halfV + DEPTH / 2;
  const stand = p.foot.halfV + STAND;
  return {
    of: p.id,
    variant: p.variant,
    x: p.x + f.x * mid,
    z: p.z + f.z * mid,
    yaw: p.yaw,
    foot: { shape: 'box', halfU: HALF, halfV: DEPTH / 2 },
    at: { x: p.x + f.x * stand, z: p.z + f.z * stand },
  };
}

export function spawnZones(props) {
  const out = [];
  for (const p of props) {
    const z = spawnZone(p);
    if (z) out.push(z);
  }
  return out;
}

// --- the geometry, kept here so both halves ask it the same way ---------------
//
// A separating axis on two rectangles, written out rather than imported from
// audit.js: audit.js is a SECOND implementation of the placement rules on
// purpose and must not start importing the thing it checks. What lives here is
// the definition; what lives there is the check.

function cornersOf(z) {
  const c = Math.cos(z.yaw);
  const s = Math.sin(z.yaw);
  const ax = { x: c, z: -s };
  const az = { x: s, z: c };
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => ({
    x: z.x + su * z.foot.halfU * ax.x + sv * z.foot.halfV * az.x,
    z: z.z + su * z.foot.halfU * ax.z + sv * z.foot.halfV * az.z,
  }));
}

function overlapsDisc(z, x, zz, r) {
  const c = Math.cos(z.yaw);
  const s = Math.sin(z.yaw);
  const dx = x - z.x;
  const dz = zz - z.z;
  // Into the zone's own axes: u along local X, v along local Z.
  const u = dx * c + dz * -s;
  const v = dx * s + dz * c;
  const qu = Math.max(0, Math.abs(u) - z.foot.halfU);
  const qv = Math.max(0, Math.abs(v) - z.foot.halfV);
  return qu * qu + qv * qv < r * r - 1e-9;
}

function overlapsBox(z, p) {
  const A = cornersOf(z);
  const B = cornersOf({ x: p.x, z: p.z, yaw: p.yaw, foot: p.foot });
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % 4];
      const nx = -(b.z - a.z);
      const nz = b.x - a.x;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const q of A) { const t = q.x * nx + q.z * nz; a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
      for (const q of B) { const t = q.x * nx + q.z * nz; b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

// Does a prop stand in this zone? Only SOLID props are asked about: a hole is a
// hole, a spoil heap is a mound you climb over and grass is grass, and a
// skeleton coming up through its own grave's spoil is the shot the whole thing
// is for.
export function propInZone(z, p) {
  if (!p.solid) return false;
  if (p.id && p.id === z.of) return false;
  if (Math.hypot(p.x - z.x, p.z - z.z) > p.radius + Math.hypot(z.foot.halfU, z.foot.halfV)) return false;
  if (p.foot?.shape === 'box') return overlapsBox(z, p);
  return overlapsDisc(z, p.x, p.z, p.foot?.r ?? p.radius);
}

export function propsInZone(z, props) {
  return props.filter((p) => propInZone(z, p));
}

// Does a barrier cross this zone? A fence across a stone's front is not an
// error, it is a demotion: see the header.
export function barrierInZone(z, b) {
  // The barrier as the rectangle it is, sampled along its centreline against
  // the zone's rounded-rectangle test. Sixteenths of a unit is finer than the
  // 0.155 post it is made of, so nothing slips between two samples.
  const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
  const n = Math.max(1, Math.ceil(len / 0.0625));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (overlapsDisc(z, b.x0 + (b.x1 - b.x0) * t, b.z0 + (b.z1 - b.z0) * t, b.half)) return true;
  }
  return false;
}

export function gateInZone(z, g) {
  return overlapsDisc(z, g.sweep.x, g.sweep.z, g.sweep.r);
}

// Is the whole zone inside the arena, with the half unit every other
// collectible keeps off the wall?
export function zoneInBounds(z, box) {
  for (const c of cornersOf(z)) {
    if (c.x < box.minX + 0.5 || c.x > box.maxX - 0.5
      || c.z < box.minZ + 0.5 || c.z > box.maxZ - 0.5) return false;
  }
  return true;
}

// WHY A STONE IS NOT A SPAWN POINT, in one word, or null when it is one.
//
// One function, called by the world when it builds the list and by audit.js
// when it checks the level, so a stone cannot be usable to one and not to the
// other. That is the whole of "no headstone is silently exempt": the exemption
// has a name and both halves read it off the same call.
//
//   'prop'      something solid stands in the zone. THE FAILURE: an author put
//               a fountain in front of a headstone and can move it.
//   'fence'     a fence or the arena wall crosses the zone.
//   'gate'      a gate leaf sweeps through it.
//   'bounds'    part of it is outside the arena.
export function spawnFault(z, { props = [], barriers = [], gates = [], box = null } = {}) {
  for (const p of props) if (propInZone(z, p)) return 'prop';
  for (const b of barriers) if (barrierInZone(z, b)) return 'fence';
  for (const g of gates) if (gateInZone(z, g)) return 'gate';
  if (box && !zoneInBounds(z, box)) return 'bounds';
  return null;
}

// Every place a skeleton may come out of, worked out once against the finished
// level. The record is what nav.js hands chase.js, so it carries the pose the
// performance needs and nothing else:
//
//   { id, x, z, yaw, stone, zone }
//
// `x, z` is where the figure comes up and `yaw` is the way it faces, which is
// the way the stone faces, so a skeleton climbs out with its back to the marker
// and its face to the yard.
export function spawnPoints({ props = [], barriers = [], gates = [], box = null } = {}) {
  const out = [];
  for (const z of spawnZones(props)) {
    if (spawnFault(z, { props, barriers, gates, box })) continue;
    out.push({
      id: `spawn/${z.of}`,
      x: z.at.x,
      z: z.at.z,
      yaw: z.yaw,
      stone: z.of,
      variant: z.variant,
      zone: z,
    });
  }
  return out;
}

export default spawnPoints;
