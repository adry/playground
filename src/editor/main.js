// THE LEVEL EDITOR. /editor/
//
// The owner's authoring tool for the contained graveyard: place props, turn
// them, draw the fences, paint the ground and say what the wall is built of,
// then save the whole thing as a JSON file the game can load.
//
// UNLISTED, NOT PRIVATE. See the comment at the top of editor/index.html. This
// file writes to three places and each one is deliberate: its own localStorage
// autosave, which only this page reads; a JSON file the owner downloads on
// purpose; and, when the play button is pressed, format.js's session key, which
// /lab/?game=1&level=session reads. That last one is the authoring loop and it
// is the only way anything here reaches a page that ships. Nothing links to it,
// it never leaves this browser, and a stranger opening /lab/?game=1 gets the
// level the site ships.
//
// THE ONE RULE THIS TOOL IS BUILT ON. An editor with fewer features that never
// loses work beats a rich one that does. So:
//
//   * every mutation goes through commit(), which pushes an undo snapshot
//     first. There is no path that changes the document without one;
//   * the document is autosaved to localStorage after every commit, so a
//     reload, a crash or a closed tab costs nothing;
//   * validation runs on every commit and shows on the floor, not in a report
//     at save time. A red outline under the headstone you are still dragging
//     tells you which headstone.
//
// WHAT IS DELIBERATELY NOT HERE
//
//   fireflies      The owner asked for them to be automated. They are drawn so
//                  the author can see where the rule will put them, and there
//                  is no tool that moves one.
//   a power pellet The lit jack-o'-lantern was Pac-Man's power pellet and the
//                  owner has taken it out of the game. The kind still exists
//                  everywhere else, so a level written before this still opens
//                  and still draws the ones it has; there is simply no way to
//                  put a new one down.
//   a spawn tool   Skeletons climb out of HEADSTONES now, chosen at random,
//                  so there is nothing for an author to place and no order for
//                  them to set. A level written before this keeps its graves,
//                  draws them and lets them be moved; it is the tool that put
//                  new ones down that is gone.
//   the generator  There is no button that fills the arena. It was here, as a
//                  blank page to edit rather than as a competitor, and the
//                  owner has taken it out: a level is a thing a person makes,
//                  and authoring starts from an empty rectangle every time.
//                  src/game/world/ stays on disk and is load bearing -- its
//                  audit and its wedge finder are the fairness guarantee this
//                  tool runs on every change -- but nothing here builds a
//                  level with it.
//   a play mode    This is not the game and never will be. The PLAY button
//                  hands the document to /lab/?game=1&level=session in a tab
//                  of its own, which is the real game running the real rules;
//                  what would live here instead is a second, worse one.
//                  /lab/?world=1&level=... is the same level with the game
//                  taken out of it, for when the question is about placement.
//   free camera    Two views, the game's and straight down, because those are
//                  the two questions an author asks: what will the player see,
//                  and where actually is everything.
//   a size choice  Thirty by thirty, on the owner's decision. The format still
//                  carries a size and everything downstream still reads it.
//
// AND ONE LIST. There is no tool box separate from the palette: a fence, a
// gate, a path, a patch of ground and a headstone are all things you put in the
// scene, so they are all in the same list, and picking one puts you in whatever
// interaction it needs. Select is the only mode, because it is the only thing
// that acts on what is already there rather than adding to it.

import { createEditorScene } from './scene.js';
import { createThumbnails } from './thumbs.js';
// The ground's own colours, read off the module that paints them rather than
// copied into the panel, so a re-tint of the grass lands on the swatch too.
import { MATERIALS as GROUND_COLOURS } from '../game/level/groundcover.js';
import {
  emptyLevel, normalizeLevel, serializeLevel, createLevelWorld, renumberGraves,
  packPaint, unpackPaint, GROUND_MATERIALS, LEVEL_FORMAT,
  WALL_VARIANTS, WALL_JOINTS, MAX_STYLES, MAX_WALL_CHANGES,
  wallLength, wallDistanceTo, SESSION_KEY, SESSION_LEVEL,
} from '../game/level/format.js';
import {
  validateLevel, reviewLevel, placementCheck, placementProps,
} from '../game/level/validate.js';
import { checkFairness, FAIR_MESSAGES } from '../game/level/fairness.js';
import { PALETTE, PERSONALITIES, levelFootprint } from '../game/level/catalogue.js';
import { LEVEL_SIZE } from '../game/world/field.js';

const AUTOSAVE = 'graveyard-editor/doc/v1';
// Props were authored to face the camera and the camera looks along
// (1, 0.78, 1), so a face on local +Z reads square to the viewer at PI/4. Same
// number pumpkin.js publishes as FACE_YAW.
const FACE_YAW = Math.PI / 4;
const SNAP = 0.5;
const YAW_SNAP = Math.PI / 12;

// --- the document ---------------------------------------------------------------

let doc = load() || emptyLevel({ size: LEVEL_SIZE, seed: 7, name: 'graveyard' });
let world = null;
let report = null;
// THE SLOW HALF, run on a timer after the last change rather than on every
// pointer move. Three things live in here and together they are the whole
// fairness guarantee, because nothing procedural stands between a hand-made
// level and the player any more:
//
//   audit    src/game/world/audit.js's full rule set, a second implementation
//            of the geometry, plus the rules the fast half cannot do: nothing
//            in a path, nothing tall hiding something short, and WEDGES
//   wedges   repair.js's findWedges at 0.25, drawn on the floor. A wedge is a
//            place the ghost can vault into that no skeleton can walk to
//   fair     the soak's eight properties, transcribed in level/fairness.js
//
// Together they are about 350 ms on a full arena, which is nothing between
// gestures and far too much per pointer move.
let fair = { fail: [], where: {}, stale: true };
let review = { issues: [], wedges: [], errors: [], notes: [], stale: true };
let fairTimer = 0;
// How long the hand has to be still before the slow half runs. See refresh().
const DEEP_IDLE = 700;
let lastSig = null;

const undoStack = [];
const redoStack = [];
let nextId = 1;

function load() {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    if (!raw) return null;
    return normalizeLevel(JSON.parse(raw));
  } catch {
    return null;
  }
}

function autosave() {
  try { localStorage.setItem(AUTOSAVE, JSON.stringify(doc)); } catch { /* private window */ }
}

function freshId(prefix) {
  let id;
  do { id = `${prefix}${nextId++}`; } while (used(id));
  return id;
}
function used(id) {
  return doc.props.some((p) => p.id === id) || doc.graves.some((g) => g.id === id)
    || doc.powerups.some((p) => p.id === id) || doc.fences.some((f) => f.id === id)
    ;
}

// EVERY change goes through here. The snapshot is taken before the mutation,
// which is what makes undo exact rather than approximate.
function commit(fn) {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn();
  refresh();
  autosave();
}

// A CHANGE THAT MAY DECLINE TO HAPPEN. Placing a headstone somewhere it does
// not fit, or clicking the gate tool on open ground, is a click that changes
// nothing, and it must not cost an undo step: pressing ctrl+z afterwards has to
// take back the last thing that actually happened rather than a refusal.
//
// The rule the tool is built on is unchanged. The before-image is still taken
// before the mutation runs -- that is what makes undo exact -- it is simply not
// kept when the mutation reports that it did nothing.
function commitIf(fn) {
  const before = JSON.stringify(doc);
  const did = fn();
  if (did === false) { refresh(); return false; }
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  refresh();
  autosave();
  return true;
}

// A live edit -- a drag in progress -- mutates and refreshes without a
// snapshot. beginEdit() takes the one snapshot for the whole gesture.
let editing = false;
function beginEdit() {
  if (editing) return;
  editing = true;
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function endEdit() {
  if (!editing) return;
  editing = false;
  // The gesture is over, so the expensive half of the validation runs once.
  refresh({ deep: true });
  autosave();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  doc = normalizeLevel(JSON.parse(undoStack.pop()));
  refresh();
  autosave();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  doc = normalizeLevel(JSON.parse(redoStack.pop()));
  refresh();
  autosave();
}

// --- the scene ------------------------------------------------------------------

const stage = document.getElementById('stage');
const canvas = document.getElementById('view');
const scene = createEditorScene({ canvas });
// One picture per placeable thing, rendered through the scene's own renderer.
// Nothing is built until a group is opened; see thumbs.js for the whole policy.
const thumbs = createThumbnails({ renderer: scene.renderer });

const selection = new Set();
let tool = 'select';
let brush = { material: 1, radius: 1.5 };
let placeEntry = { kind: 'stone', variant: 'cross' };
// What the wall tool stamps: the stone from this point on, and how the two
// builds meet. Not the same thing as doc.wall.variant, which is what the run
// STARTS in.
let wallPick = { variant: WALL_VARIANTS[1], joint: 'pier' };
// Which two grounds the next kerb goes between.
const kerbPick = { a: GROUND_MATERIALS[0], b: GROUND_MATERIALS[3] || GROUND_MATERIALS[1] };
let snapOn = false;
let hover = null;
let pending = null;   // the fence or path being drawn

// The paint field, kept unpacked while the brush is down and repacked into the
// document when it settles. Repacking is cheap; rebuilding the cover mesh is
// not, so the rebuild is throttled rather than run per pointer move.
let paintCells = null;
let paintDirty = false;
let lastPaint = 0;

function cells() {
  if (!paintCells || paintCells.length !== doc.ground.w * doc.ground.h) {
    paintCells = unpackPaint(doc.ground.paint, doc.ground.w * doc.ground.h);
  }
  return paintCells;
}

// Everything the overlay draws, in one place, so the three callers below
// cannot each show a different set of it.
function overlayOpts(extra = {}) {
  return {
    selection,
    flagged: report ? report.flagged : new Set(),
    hover,
    brush: tool === 'paint' && hover ? { ...hover, r: brush.radius } : null,
    ghost: hover ? previewAt(snapped(hover.x), snapped(hover.z)) : null,
    gizmo: gizmoNow(),
    ...extra,
  };
}

// WHAT THE SLOW HALF ACTUALLY DEPENDS ON. Everything that can change where a
// body may walk, what stands where, or where a firefly lands -- which is the
// whole document except its name and its painted ground. The paint is the
// exclusion that pays: it is decoration, no rule in audit.js or fairness.js
// reads a cell of it, and it is the one thing an author drags across the arena
// for minutes at a time.
function connectivitySig() {
  return JSON.stringify([
    doc.size, doc.seed, doc.spawn, doc.wall, doc.fences,
    doc.props, doc.graves, doc.powerups, doc.fireflies,
  ]);
}

function refresh({ deep = !editing } = {}) {
  paintCells = null;
  world = createLevelWorld(doc);
  report = validateLevel(doc, world, { deep });
  scene.sync(world, doc, overlayOpts());

  // THE SLOW HALF IS SCHEDULED, NOT RUN, and now it is scheduled twice as
  // carefully. It costs 35 to 88 ms warmed and about half a second cold, and
  // most of that is floor work rather than work the level's own size decides:
  // a nearly empty arena pays nearly what a full one does. Two things follow.
  //
  //   IT DOES NOT RUN IF NOTHING IT READS CHANGED. Renaming the level, or
  //   painting a hundred cells of grass, cannot move a wedge, so the last
  //   answer is still the right answer and stays on screen rather than being
  //   marked stale and recomputed.
  //   IT WAITS LONGER. 260 ms fires between one nudge of a headstone and the
  //   next; 700 ms fires once when the hand stops. The cost of waiting is that
  //   the panel is briefly out of date, and the cost of not waiting is a stall
  //   in the middle of a gesture, which is the thing the owner reported.
  //
  // Nothing here can make it not run before a save: saveFile forces it and
  // will not write a file until it has an answer.
  const sig = connectivitySig();
  if (sig !== lastSig) {
    lastSig = sig;
    fair.stale = true;
    review.stale = true;
    clearTimeout(fairTimer);
    fairTimer = setTimeout(deepReview, DEEP_IDLE);
  }

  // NOT DURING A GESTURE. drawPanels rebuilds both columns of the interface,
  // which is most of what an edit costs -- 7.4 ms of 7.6 -- and during a drag
  // none of it can have changed: the palette is the palette and the counts are
  // the counts. Rebuilding the panel under a slider the author is dragging also
  // takes the slider away from them mid-drag. Both columns and the status line
  // are redrawn when the gesture ends, which is what endEdit's refresh is for.
  if (!editing) {
    drawPanels();
    drawStatus();
  }
}

// THE SLOW HALF. Not advisory: F3 and a wedge are both invisible on screen and
// they are the two things most likely to be broken by accident.
function deepReview() {
  if (!world) return;
  // Into the readout at ?perf=1, because this is the one cost in the tool that
  // the frame timer cannot see: it runs between gestures rather than inside a
  // frame, and it is one of the two things most likely to be what a slow
  // editor feels like.
  const t0 = performance.now();
  try {
    review = { ...reviewLevel(world), stale: false };
  } catch (err) {
    review = { issues: [], wedges: [], errors: [], notes: [], stale: false, error: err.message };
  }
  try {
    fair = { ...checkFairness(world), stale: false };
  } catch (err) {
    // A level mid-edit can be geometry nav.js has never been asked about. A
    // check that throws must not take the tool down with it.
    fair = { fail: [], where: {}, stale: false, error: err.message };
  }
  // The wedges go onto the floor as well as into the list. A coordinate in a
  // panel is a number; a red ring where the pocket is, is a place.
  scene.sync(world, doc, overlayOpts({ wedges: review.wedges }));
  drawPanels();
  drawStatus();
  scene.mark('review', performance.now() - t0);
}

// --- finding things ---------------------------------------------------------------

// A derived id can belong to a grave (`g1/hole`), so a click on a grave mouth
// selects the grave and not a prop that does not exist in the document.
function ownerOf(id) {
  if (!id) return null;
  const cut = id.indexOf('/');
  const base = cut > 0 ? id.slice(0, cut) : id;
  if (doc.graves.some((g) => g.id === base)) return base;
  return id;
}

function recordOf(id) {
  return doc.props.find((p) => p.id === id)
    || doc.graves.find((g) => g.id === id)
    || doc.powerups.find((p) => p.id === id)
    || doc.fences.find((f) => f.id === id)
    || null;
}

function kindOf(id) {
  if (doc.props.some((p) => p.id === id)) return 'prop';
  if (doc.graves.some((g) => g.id === id)) return 'grave';
  if (doc.powerups.some((p) => p.id === id)) return 'powerup';
  if (doc.fences.some((f) => f.id === id)) return 'fence';
  return null;
}

function centreOf(id) {
  const r = recordOf(id);
  if (!r) return null;
  if (r.points) {
    let x = 0;
    let z = 0;
    for (const p of r.points) { x += p[0]; z += p[1]; }
    return { x: x / r.points.length, z: z / r.points.length };
  }
  return { x: r.x, z: r.z };
}

function moveRecord(id, dx, dz) {
  const r = recordOf(id);
  if (!r) return;
  if (r.points) {
    for (const p of r.points) { p[0] += dx; p[1] += dz; }
  } else {
    r.x += dx;
    r.z += dz;
  }
}

function turnRecord(id, dyaw, about) {
  const r = recordOf(id);
  if (!r) return;
  if (r.points) {
    const c = Math.cos(dyaw);
    const s = Math.sin(dyaw);
    for (const p of r.points) {
      const x = p[0] - about.x;
      const z = p[1] - about.z;
      p[0] = about.x + x * c - z * s;
      p[1] = about.z + x * s + z * c;
    }
  } else if (r.yaw !== undefined) {
    r.yaw += dyaw;
  } else {
    const c = Math.cos(dyaw);
    const s = Math.sin(dyaw);
    const x = r.x - about.x;
    const z = r.z - about.z;
    r.x = about.x + x * c - z * s;
    r.z = about.z + x * s + z * c;
  }
}

// --- the tools ---------------------------------------------------------------------

// WHAT THE NEXT CLICK WOULD PUT DOWN, AND WHETHER IT MAY.
//
// The tool used to let anything be dropped anywhere and then outline it in red,
// which tells an author what they have already done wrong. This says it before
// the drop: the footprint follows the cursor in green where the thing may go
// and in red where it may not, and a red drop does not happen. The rule is
// validate.js's placementCheck, which is the LOCAL half of audit.js run against
// audit.js's own geometry, so the indicator and the audit cannot disagree. See
// the comment over placementCheck for exactly which rules are in it, and for
// the one that most conspicuously is not: a wedge is emergent and is found by a
// flood over the whole arena, so it stays on the slow timer and on the floor.
function previewAt(x, z) {
  if (!world) return null;
  if (tool === 'place') {
    const cands = placementProps({
      kind: placeEntry.kind, variant: placeEntry.variant, x, z, yaw: FACE_YAW,
    });
    return { ...placementCheck(world, cands), foots: cands };
  }
  return null;
}

// THE HANDLES ON A SELECTED THING. A disc at the middle to move it and a ring
// round it to turn it, both on the ground plane and both a fixed size on
// screen, which is what `scene.view` is for: it is the half height of the frame
// in world units, so a fraction of it is a constant number of pixels at every
// zoom. The expert path -- drag to move, alt-drag to turn, shift to snap, the
// brackets to nudge -- is untouched and still faster; this is the path that
// does not have to be known about first.
function gizmoNow() {
  if (tool !== 'select' || !selection.size || !world) return null;
  let x = 0;
  let z = 0;
  let n = 0;
  for (const id of selection) {
    const c = centreOf(id);
    if (c) { x += c.x; z += c.z; n += 1; }
  }
  if (!n) return null;
  const v = scene.view;
  const only = selection.size === 1 ? recordOf([...selection][0]) : null;
  return {
    x: x / n,
    z: z / n,
    yaw: only && only.yaw !== undefined ? only.yaw : 0,
    move: Math.max(0.35, v * 0.045),
    ring: Math.max(1.1, v * 0.13),
    knob: Math.max(0.22, v * 0.028),
  };
}

// Which handle a click landed on, or null for neither.
function gizmoHit(gz, at) {
  if (!gz) return null;
  const d = Math.hypot(at.x - gz.x, at.z - gz.z);
  if (d <= gz.move) return 'move';
  if (Math.abs(d - gz.ring) <= Math.max(gz.knob, gz.ring * 0.22)) return 'turn';
  return null;
}

function placeAt(x, z) {
  const e = placeEntry;
  const check = previewAt(x, z);
  if (check && !check.ok) { say(`cannot put a ${e.variant || e.kind} there: ${check.why}`); return false; }
  doc.props.push({
    id: freshId('p'), kind: e.kind, variant: e.variant, x, z, yaw: FACE_YAW,
  });
  return true;
}

// A gate is added to whichever fence edge the click is nearest, and clicking an
// existing one takes it away. There is no gate object to drag: the gate is a
// hole in a run, so it lives on the run.
function toggleGate(x, z) {
  let best = null;
  for (const f of doc.fences) {
    const last = f.closed ? f.points.length : f.points.length - 1;
    for (let i = 0; i < last; i++) {
      const a = f.points[i];
      const b = f.points[(i + 1) % f.points.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const ll = dx * dx + dz * dz;
      if (ll < 1e-9) continue;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / ll;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (!best || d < best.d) best = { f, edge: i, t, d, len: Math.sqrt(ll) };
    }
  }
  if (!best || best.d > 1.6) { say('click on a fence to put a gate in it'); return false; }
  const near = best.f.gates.findIndex((g) => g.edge === best.edge && Math.abs(g.t - best.t) * best.len < 1.4);
  if (near >= 0) best.f.gates.splice(near, 1);
  else best.f.gates.push({ edge: best.edge, t: best.t });
  return true;
}

// THE WALL, PIECE BY PIECE. A click on the perimeter changes what it is built
// of from that point on; a click on a change takes it out again. It is the gate
// tool wearing a different hat, and deliberately so: a style change is written
// at a DISTANCE ALONG THE RUN, which is the same coordinate a gate is written
// in, so the two are the same gesture and the same arithmetic.
//
// The budget it can run out of is not the number of changes -- there is no
// useful limit on those -- but the number of STONES, because the geometry
// carries a style index per vertex and wall.js holds MAX_STYLES builds. Ashlar
// to brick and back is two changes and two stones; a fourth stone is the last
// one that fits.
function wallStones(extra) {
  const out = new Set([doc.wall.variant]);
  for (const st of doc.wall.styles) {
    out.add(st.variant);
    if (st.jointVariant) out.add(st.jointVariant);
  }
  if (extra) for (const v of extra) if (v) out.add(v);
  return out;
}

function toggleWallStyle(x, z) {
  const near = wallDistanceTo(doc.wall.points, x, z);
  if (near.away > 2.2) { say('click on the perimeter wall to change what it is built of from there on'); return false; }
  // Within a bay of an existing change is that change, so the same click takes
  // it away. 1.6 is a little under the pier spacing, so two changes can still
  // sit at neighbouring piers.
  const hit = doc.wall.styles.findIndex((st) => Math.abs(st.at - near.at) < 1.6);
  if (hit >= 0) {
    doc.wall.styles.splice(hit, 1);
    say('took that change of stone out');
    return true;
  }
  if (doc.wall.styles.length >= MAX_WALL_CHANGES) {
    say(`a wall carries at most ${MAX_WALL_CHANGES} changes of stone`);
    return false;
  }
  const stones = wallStones([wallPick.variant]);
  if (stones.size > MAX_STYLES) {
    say(`a wall is built of at most ${MAX_STYLES} stones and it already has ${[...wallStones()].join(', ')}. Change one of those first, or pick a stone it already uses.`);
    return false;
  }
  doc.wall.styles.push({
    at: Math.round(near.at * 2) / 2,
    variant: wallPick.variant,
    joint: wallPick.joint,
  });
  doc.wall.styles.sort((a, b) => a.at - b.at);
  return true;
}

function paintAt(x, z, erase) {
  const g = doc.ground;
  const c = cells();
  const r = brush.radius;
  const i0 = Math.max(0, Math.floor((x - r - g.minX) / g.cell));
  const i1 = Math.min(g.w - 1, Math.ceil((x + r - g.minX) / g.cell));
  const j0 = Math.max(0, Math.floor((z - r - g.minZ) / g.cell));
  const j1 = Math.min(g.h - 1, Math.ceil((z + r - g.minZ) / g.cell));
  const value = erase ? 0 : brush.material;
  let touched = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cx = g.minX + (i + 0.5) * g.cell;
      const cz = g.minZ + (j + 0.5) * g.cell;
      if (Math.hypot(cx - x, cz - z) > r) continue;
      if (c[j * g.w + i] !== value) { c[j * g.w + i] = value; touched = true; }
    }
  }
  if (touched) paintDirty = true;
  return touched;
}

// HOW OFTEN THE PAINTED GROUND IS REBUILT WHILE THE BRUSH IS DOWN.
//
// Not a fixed interval, because what it costs is not this file's to know: the
// cover is a marching-squares pass over the weight field plus a scatter plus a
// kerb run per named pair, and level/groundcover.js is free to make that
// heavier. So the throttle is measured. The last rebuild's own cost sets the
// next interval at three times it, which spends at most a third of the time
// during a stroke on rebuilding and leaves the rest to the pointer.
//
// The alternative -- rebuild on brush-up only -- was rejected: the brush ring
// says where the paint is going and nothing says where it went, so an author
// would paint a stroke blind and find out afterwards.
const PAINT_MIN_MS = 110;
function paintInterval() {
  return Math.max(PAINT_MIN_MS, Math.min(600, (scene.stats().coverMs || 0) * 3));
}

function flushPaint(force = false) {
  if (!paintDirty) return;
  const now = performance.now();
  if (!force && now - lastPaint < paintInterval()) return;
  lastPaint = now;
  paintDirty = false;
  doc.ground.paint = packPaint(paintCells);
  const keep = paintCells;
  refresh();
  paintCells = keep;
}

function deleteSelection() {
  const ids = new Set(selection);
  doc.props = doc.props.filter((p) => !ids.has(p.id));
  doc.graves = doc.graves.filter((g) => !ids.has(g.id));
  doc.powerups = doc.powerups.filter((p) => !ids.has(p.id));
  doc.fences = doc.fences.filter((f) => !ids.has(f.id));
  renumberGraves(doc);
  selection.clear();
}

function duplicateSelection() {
  const made = [];
  for (const id of selection) {
    const k = kindOf(id);
    const r = recordOf(id);
    if (!r) continue;
    if (k === 'prop') {
      const copy = { ...r, id: freshId('p'), x: r.x + 0.8, z: r.z + 0.8 };
      doc.props.push(copy);
      made.push(copy.id);
    } else if (k === 'powerup') {
      const copy = { ...r, id: freshId('jack'), x: r.x + 0.8, z: r.z + 0.8 };
      doc.powerups.push(copy);
      made.push(copy.id);
    } else if (k === 'fence') {
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = freshId('f');
      for (const p of copy.points) { p[0] += 0.8; p[1] += 0.8; }
      doc.fences.push(copy);
      made.push(copy.id);
    }
    // A grave is not duplicated: there are four of them and each is a distinct
    // skeleton, so a copy is never what was meant.
  }
  selection.clear();
  for (const id of made) selection.add(id);
}

// --- pointer -------------------------------------------------------------------------

let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  canvas.focus();
  const at = scene.groundAt(e.clientX, e.clientY);
  if (!at) return;

  // Pan: middle button, or space held, whatever the tool.
  if (e.button === 1 || spaceDown) {
    drag = { type: 'pan', anchor: at };
    stage.dataset.pan = '1';
    return;
  }

  if (tool === 'paint') {
    beginEdit();
    drag = { type: 'paint', erase: e.button === 2 || e.altKey };
    paintAt(at.x, at.z, drag.erase);
    flushPaint(true);
    return;
  }

  if (tool === 'place') { commitIf(() => placeAt(snapped(at.x), snapped(at.z))); return; }
  
  if (tool === 'gate') { commitIf(() => toggleGate(at.x, at.z)); return; }
  if (tool === 'wall') { commitIf(() => toggleWallStyle(at.x, at.z)); return; }

  if (tool === 'fence') {
    commit(() => {
      if (!pending) {
        const f = { id: freshId('f'), points: [[snapped(at.x), snapped(at.z)]], closed: false, gates: [] };
        doc.fences.push(f);
        pending = { kind: 'fence', id: f.id };
      } else {
        // An undo mid-draw can take the run out from under `pending`, so the
        // record is looked up rather than assumed. Losing the run is a
        // nuisance; throwing here would lose the session.
        const rec = recordOf(pending.id);
        if (rec) rec.points.push([snapped(at.x), snapped(at.z)]);
        else pending = null;
      }
    });
    return;
  }

  // select. THE HANDLES FIRST: a click inside the move disc or on the turn ring
  // belongs to the gizmo whatever is drawn under it, or a headstone standing on
  // the ring would take its own handle's click.
  const grab = gizmoHit(gizmoNow(), at);
  if (grab) { beginTransform(grab, at, gizmoNow()); return; }

  const hit = scene.pickAt(e.clientX, e.clientY);
  const id = hit ? ownerOf(hit.id) : null;
  if (!id || !kindOf(id)) {
    if (!e.shiftKey) { selection.clear(); refresh(); }
    return;
  }
  if (e.shiftKey) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
  } else if (!selection.has(id)) {
    selection.clear();
    selection.add(id);
  }
  beginTransform(e.altKey ? 'turn' : 'move', at, centreOf(id));
  refresh();
});

canvas.addEventListener('pointermove', (e) => {
  const at = scene.groundAt(e.clientX, e.clientY);
  if (!at) return;
  hover = at;

  if (!drag) {
    // Just the overlay following the pointer: the brush ring, or the green or
    // red footprint of the thing about to be dropped. The document has not
    // changed, so nothing is rebuilt and nothing is revalidated -- the
    // placement check is a millisecond and a half against the world that is
    // already built, which is what makes it affordable per pointer move.
    if (world && (tool === 'paint' || tool === 'place')) {
      scene.overlayOnly(world, doc, overlayOpts({ wedges: review.stale ? [] : review.wedges }));
    }
    return;
  }

  if (drag.type === 'pan') {
    scene.pan(drag.anchor.x - at.x, drag.anchor.z - at.z);
    return;
  }
  if (drag.type === 'paint') {
    if (paintAt(at.x, at.z, drag.erase)) flushPaint();
    return;
  }
  if (drag.type === 'move') {
    if (!drag.moved) { beginEdit(); drag.moved = true; }
    let dx = at.x - drag.anchor.x;
    let dz = at.z - drag.anchor.z;
    if (snapOn !== e.shiftKey) {
      // Snap the primary of the selection to the half-unit lattice and carry
      // the rest of it along, so a group keeps its shape.
      const p = drag.start[0];
      dx = snapped(p.centre.x + dx) - p.centre.x;
      dz = snapped(p.centre.z + dz) - p.centre.z;
    }
    for (const s of drag.start) {
      const c = centreOf(s.id);
      moveRecord(s.id, s.centre.x + dx - c.x, s.centre.z + dz - c.z);
    }
    refresh();
    return;
  }
  if (drag.type === 'turn') {
    if (!drag.moved) { beginEdit(); drag.moved = true; }
    const now = Math.atan2(at.x - drag.about.x, at.z - drag.about.z);
    let dyaw = now - drag.yaw0;
    drag.yaw0 = now;
    // FREE BY DEFAULT, because the owner asked for items in any direction at
    // all. Shift is the modifier that snaps, to fifteen degrees, and it snaps
    // the resulting angle rather than the increment so a snapped prop stays on
    // the lattice however far the pointer travels.
    if (e.shiftKey && selection.size === 1) {
      const r = recordOf([...selection][0]);
      if (r && r.yaw !== undefined) dyaw = Math.round((r.yaw + dyaw) / YAW_SNAP) * YAW_SNAP - r.yaw;
    }
    if (dyaw) {
      for (const id of selection) turnRecord(id, dyaw, drag.about);
      refresh();
    }
  }
});

// One drag, whether it started on a handle or on the thing itself. `about` is
// what a turn turns around: the gizmo's centre when the ring was grabbed, and
// the thing's own centre when the drag started on it.
function beginTransform(type, at, about) {
  if (!about) return;
  drag = {
    type,
    anchor: at,
    about: { x: about.x, z: about.z },
    start: [...selection].map((sid) => ({ id: sid, centre: centreOf(sid) })),
    yaw0: Math.atan2(at.x - about.x, at.z - about.z),
    moved: false,
  };
}

function endDrag() {
  if (drag?.type === 'paint') { flushPaint(true); }
  drag = null;
  delete stage.dataset.pan;
  endEdit();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.setView(scene.view * (1 + Math.sign(e.deltaY) * 0.12));
}, { passive: false });

canvas.addEventListener('dblclick', () => { if (pending) finishPending(false); });

function snapped(v) {
  return snapOn ? Math.round(v / SNAP) * SNAP : v;
}

function finishPending(close) {
  if (!pending) return;
  commit(() => {
    const r = recordOf(pending.id);
    if (!r) { pending = null; return; }
    if (r.points.length < 2) {
      doc.fences = doc.fences.filter((f) => f.id !== pending.id);
    } else if (pending.kind === 'fence') {
      r.closed = close;
      // A closed pen with no gate is a pocket nothing can get into. The
      // validator says so, and the tool puts one in rather than leaving the
      // author with an error they did not ask for.
      if (close && !r.gates.length) r.gates.push({ edge: 0, t: 0.5 });
    }
    pending = null;
  });
}

// --- keys --------------------------------------------------------------------------

let spaceDown = false;
// V is select, the one mode. B is "the prop I last picked", because the palette
// is long and going back to it for the same headstone twice is a waste of a
// hand. Every other letter picks an ENTRY out of the one list -- see
// entryForKey -- so F is a fence run and not merely the fence mode.

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }

  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveFile(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'p') { e.preventDefault(); playLevel(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); commit(duplicateSelection); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'a') {
    e.preventDefault();
    selection.clear();
    for (const p of doc.props) selection.add(p.id);
    refresh();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;

  if (k === '?' || e.key === 'F1') { showKeys(keysEl.dataset.open !== '1'); return; }
  if (k === 'escape') {
    // Abandon the run being drawn outright rather than stepping back one
    // click: escape means "forget this", and undo is still there for the rest.
    if (pending) {
      const id = pending.id;
      pending = null;
      commit(() => {
        doc.fences = doc.fences.filter((f) => f.id !== id);
      });
    } else {
      selection.clear();
      refresh();
    }
    return;
  }
  if (k === 'enter') { finishPending(false); return; }
  if (k === 'c' && pending) { finishPending(true); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); commit(deleteSelection); return; }
  if (k === 'tab') { e.preventDefault(); setMode(scene.mode === 'plan' ? 'game' : 'plan'); return; }
  if (k === '[' || k === ']') {
    if (!selection.size) return;
    const step = (k === '[' ? -1 : 1) * (e.shiftKey ? Math.PI / 180 : (5 * Math.PI) / 180);
    commit(() => {
      for (const id of selection) turnRecord(id, step, centreOf(id));
    });
    return;
  }
  if (k === 'v') { setTool('select'); return; }
  if (k === 'b') { setTool('place'); return; }
  const entry = entryForKey(k);
  if (entry) { pick(entry); return; }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

// --- files -------------------------------------------------------------------------

// Everything that makes a level unplayable, in one list, from all three
// checkers. The wedges are in here because a wedge is audit.js's rule 11 and
// comes back as an ordinary finding; there is no separate wedge case and there
// must not be one, or a check gets added later and forgotten here.
function collectBlocking() {
  return [
    ...report.errors.map((e) => e.message),
    ...review.errors.map((e) => `${e.code}: ${e.message}`),
    ...fair.fail.map((f) => `${f}: ${FAIR_MESSAGES[f] || f}`),
    // A CHECK THAT THREW IS NOT A CHECK THAT PASSED. Both of these come back
    // with an empty finding list when they fall over, which would otherwise
    // read as a clean level: the audit that could not run is the one thing
    // here that is more alarming than a finding, not less.
    ...(review.error ? [`the audit could not run: ${review.error}`] : []),
    ...(fair.error ? [`the fairness check could not run: ${fair.error}`] : []),
  ];
}

// PLAY WHAT IS ON SCREEN, with no file in between.
//
// The loop this replaces was: save a file, find it in the downloads folder,
// move it into public/levels/, type a URL. The editor and the game are the
// same origin, so the document can simply be handed over: it goes into
// localStorage under format.js's own key and the game is opened on
// `level=session`, which is the token that means "read it from there".
//
// Three things this is careful about.
//
//   IT PLAYS WHAT IS ON SCREEN, unsaved changes and all. A play button that
//   quietly played the last SAVED file would be worse than no button, because
//   the owner would believe they were testing the change they just made.
//   IT RUNS THE SAME GUARD AS SAVE. An unplayable level is exactly what the
//   guard exists to catch, and finding a wedge by walking into it is a slower
//   way to learn the same thing.
//   IT IS ONE TAB, REUSED. A named target means the second press reloads the
//   game rather than opening a fourteenth window, and the editor keeps its
//   own state either way. The timestamp is there because a browser handed the
//   same URL twice may focus the tab without reloading it, and the whole point
//   is that it reloads.
function playLevel() {
  if (!guardPasses('play')) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(doc));
  } catch (err) {
    say(`could not hand the level over: ${err.message}`);
    return;
  }
  const url = `/lab/?game=1&level=${SESSION_LEVEL}&t=${Date.now()}`;
  const tab = window.open(url, 'graveyard-play');
  if (!tab) { say(`the browser blocked the new tab. Open ${url} yourself.`); return; }
  say('playing what is on screen, in the other tab. Press play again after a change.');
}

// The check that stands between a level and a player, whichever door it is
// going out of. Both saving and playing run it, because the two answer the
// same question: is this level one somebody can finish?
function guardPasses(verb) {
  let blocking = collectBlocking();
  if (review.stale || fair.stale) {
    // The debounce has not fired yet, so what `blocking` was built from is the
    // last check and not this level. Run both now -- they are synchronous and
    // cost a couple of hundred milliseconds -- rather than send the owner away
    // to press the button again, which is a step they can skip and then the
    // level went out unchecked.
    say('checking the level...');
    deepReview();
    blocking = collectBlocking();
  }
  if (!blocking.length) return true;
  const ok = confirm(
    `This level is not playable:\n\n  ${blocking.slice(0, 6).join('\n  ')}\n\n`
    + `${verb === 'play' ? 'Play' : 'Save'} it anyway?`,
  );
  if (!ok) {
    say(`not ${verb === 'play' ? 'played' : 'saved'}: ${blocking.length} problem${blocking.length === 1 ? '' : 's'} to fix first`);
    return false;
  }
  return true;
}

function saveFile({ anyway = false } = {}) {
  // NOT A QUIET SAVE. The generator used to be the last thing between a broken
  // level and a player and it is gone, so a level that fails a fairness
  // property or carries a geometry error has to be refused out loud. The owner
  // can still force it -- it is their tool -- but never by accident.
  if (!anyway && !guardPasses('save')) return;
  const text = serializeLevel(doc);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(doc.name || 'level').replace(/[^a-z0-9-_]+/gi, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  // THE REAL LINK, not the pattern. Where the file has to go is known -- it is
  // public/levels/, which is the directory the site serves from its root -- so
  // the URL it will have is knowable too, and printing `<url>` for the reader
  // to work out was the tool being coy about the one fact it had.
  const link = `/lab/?game=1&level=/levels/${a.download}`;
  say(`saved ${a.download}. Put it in public/levels/ and it plays at ${link}. The play button needs none of that.`);
}

async function openFile(file) {
  try {
    doc = normalizeLevel(JSON.parse(await file.text()));
    undoStack.length = 0;
    redoStack.length = 0;
    selection.clear();
    pending = null;
    refresh();
    autosave();
    say(`loaded ${file.name}`);
  } catch (err) {
    say(`could not read that file: ${err.message}`);
  }
}

stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.dataset.drop = '1'; });
stage.addEventListener('dragleave', () => { delete stage.dataset.drop; });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  delete stage.dataset.drop;
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});

// --- the panels ----------------------------------------------------------------------

const left = document.getElementById('left');
const right = document.getElementById('right');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
let message = '';

function say(text) {
  message = text;
  drawStatus();
}

// The status line is written as HTML, because the counts in it are marked up.
// A MESSAGE IS NOT, and it used to be: `open it with /lab/?...level=<url>` came
// out as `level=` with the angle brackets swallowed as a tag, which is exactly
// the half of the sentence the reader needed.
function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function setTool(t) {
  tool = t;
  if (pending && t !== 'fence') finishPending(false);
  stage.dataset.tool = t;
  refresh();
}

// The pointer left the canvas, so there is nothing under it: the ghost
// placement footprint and the brush ring have to go with it, or a green
// outline is left sitting on the floor where the author's hand is not.
canvas.addEventListener('pointerleave', () => {
  if (!hover || drag) return;
  hover = null;
  if (world) scene.overlayOnly(world, doc, overlayOpts({ wedges: review.stale ? [] : review.wedges }));
});

function setMode(m) {
  scene.setMode(m);
  drawPanels();
}

function drawPanels() {
  drawLeft();
  drawRight();
}

// ONE LIST OF THINGS YOU CAN PUT IN THE SCENE.
//
// There used to be a TOOL group above a PALETTE group, and the line between
// them was the tool's own idea rather than the author's: a fence, a gate, a
// path and a patch of ground are all things you put in the scene, exactly as a
// headstone is, and the only reason they lived in a different box is that the
// code behind them is a mode rather than a click. The owner said so, and they
// are right. So there is one list, and picking anything out of it puts you in
// whatever interaction that thing needs -- one click for a headstone, click
// click enter for a fence run, a drag for the ground.
//
// SELECT IS THE ONE EXCEPTION and it stays a mode of its own, because it does
// not put anything in the scene: it acts on what is already there.
//
// Each entry says what picking it does, and nothing else knows the difference:
//
//   tool     the interaction it needs. That IS the old tool name, unchanged.
//   kind     for a prop, its kind and variant
//   path     for a line, its material
//   material for the ground, its index in GROUND_MATERIALS
//
// The keyboard shortcuts are the ones that were on the tool buttons, so a hand
// that learnt them keeps them.
function placeGroups() {
  return [
    {
      id: 'boundary',
      label: 'walls, fences and gates',
      items: [
        {
          tool: 'fence', label: 'fence run', key: 'F',
          title: 'Click a corner at a time. Enter finishes the run, c closes it into a pen. A pen gets a gate put in it, because a pen with no way in is a pocket.',
        },
        {
          tool: 'gate', label: 'gate', key: 'G',
          title: 'Click on a fence to cut a gate into it, and on a gate to take it out again. A gate is a hole in the run, so it lives on the run and cannot be dragged away from it.',
        },
        {
          tool: 'wall', label: 'change of stone', key: 'W',
          title: 'Click on the perimeter wall to change what it is built of from that point on, and on a change to take it out. The stone and the joint are the two selects under WALL on the right.',
        },
      ],
    },
    {
      id: 'cover',
      label: 'ground cover',
      items: GROUND_MATERIALS.map((m, i) => ({ tool: 'paint', material: i + 1, label: m })),
      // THE GROUND IS A COLOUR, so the swatch is the control and the name is a
      // caption under it. The colours are groundcover.js's own, read off the
      // module rather than copied, so a re-tint of the grass lands here too.
      swatches: true,
      after: () => el('div', { class: 'stack' }, [
        el('div', { class: 'row' }, [
          el('label', { text: 'brush' }),
          number(brush.radius, 0.5, 6, 0.25, (v) => { brush.radius = v; refresh(); }),
          el('span', { class: 'note', text: 'right-drag erases' }),
        ]),
        // A KERB IS A PAIR OF MATERIALS, NOT A LINE YOU DRAW. groundcover.js
        // finds the join between two painted grounds out of the same field it
        // shades them from, so the stones land on the edge that is already
        // there and repainting the grass moves them. There is nothing here for
        // an author to keep in step with the paint, which is exactly why this
        // is two swatches and not a drawing tool.
        el('p', { class: 'note', text: 'a row of stones where two grounds meet' }),
        ...kerbPairs().map((pair, i) => el('div', { class: 'row' }, [
          el('span', { class: 'grow value', text: `${pair[0]} meets ${pair[1]}` }),
          el('button', {
            text: '×',
            title: 'take the stones out',
            onclick: () => commit(() => { kerbPairs().splice(i, 1); }),
          }),
        ])),
        el('div', { class: 'row' }, [
          materialSwatches(kerbPick.a, (v) => { kerbPick.a = v; drawLeft(); }),
          materialSwatches(kerbPick.b, (v) => { kerbPick.b = v; drawLeft(); }),
          el('button', { text: '+', title: 'lay a row of stones wherever these two grounds meet', onclick: () => commitIf(addKerb) }),
        ]),
      ]),
    },
    ...PALETTE.map((group) => ({
      id: group.id,
      label: group.label,
      items: (group.items || group.variants.map((v) => ({ kind: group.kind, variant: v, label: v })))
        .map((it) => ({
          tool: 'place', kind: it.kind, variant: it.variant, label: it.label,
          title: describeFoot(it.kind, it.variant),
        })),
    })),
  ];
}

// The document's kerb pairs, made sure of. An old file may not have the field.
function kerbPairs() {
  if (!Array.isArray(doc.ground.kerbs)) doc.ground.kerbs = [];
  return doc.ground.kerbs;
}

function addKerb() {
  const { a, b } = kerbPick;
  if (a === b) { say('a kerb goes between two DIFFERENT grounds'); return false; }
  const have = kerbPairs();
  if (have.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) {
    say(`there is already a row of stones where ${a} meets ${b}`);
    return false;
  }
  have.push([a, b]);
  say(`stones wherever ${a} meets ${b}. Paint either one and they follow the join.`);
  return true;
}

// Is this the entry the next click will place?
function isPicked(e) {
  if (tool !== e.tool) return false;
  if (e.tool === 'place') return placeEntry.kind === e.kind && placeEntry.variant === e.variant;
  if (e.tool === 'paint') return brush.material === e.material;
  return true;
}

function pick(e) {
  if (e.tool === 'place') placeEntry = { kind: e.kind, variant: e.variant };
  if (e.tool === 'paint') brush.material = e.material;
  setTool(e.tool);
}

// The shortcut for a tool is the first entry that carries one, so pressing F
// picks the fence run and P picks the sand path rather than merely arming a
// mode with no material chosen.
function entryForKey(k) {
  for (const g of placeGroups()) {
    for (const e of g.items) if (e.key && e.key.toLowerCase() === k) return e;
  }
  return null;
}

function drawLeft() {
  left.replaceChildren(
    // SELECT IS THE ONE MODE, so it is the one thing above the list rather than
    // an entry in it: everything below puts something into the scene and this
    // acts on what is already there.
    el('section', { class: 'card mode' }, [
      el('button', {
        class: 'grow',
        'aria-pressed': String(tool === 'select'),
        title: 'Pick things up. Drag the middle of a selected thing to move it and the ring round it to turn it.',
        onclick: () => setTool('select'),
      }, [el('span', { text: 'select and move' }), el('kbd', { text: 'V' })]),
    ]),
    ...placeGroups().map(placeGroup),
  );
}

// WHICH GROUPS ARE OPEN, remembered across redraws. The panel is rebuilt on
// every commit, so without this a group closes itself the moment you use
// anything inside it: open the ground cover, add a kerb, and the group you were
// working in folds up under your hand. A group also opens itself when the entry
// picked is one of its own, which is what makes a keyboard shortcut show you
// where it went.
// NOT the headstones, however much they are the group an author reaches for
// first. Opening a group is what draws its pictures, and twenty-nine of them is
// the one batch big enough to be felt; having it happen before the tool had
// even appeared would be the stall this whole schedule exists to avoid. The
// group opens the moment it is asked for, and every time after the first the
// pictures are already in storage and it is instant.
const openGroups = new Set(['boundary']);

// THE PICTURES ARE DRAWN A GROUP AT A TIME, OFF THE RENDER LOOP.
//
// This used to be one thumbnail per frame from onFrame, which is the worst of
// both worlds: a canvas bake costs about five times more once the renderer has
// drawn, so a bake a frame puts every bake in the expensive regime, and each
// one also stalled the GPU for its own readback. A tick went to 801 ms, of
// which 630 was this.
//
// Now nothing is drawn until a group is expanded, and then the whole group is
// drawn back to back in one batch with one readback, from a timer rather than
// a frame. The batch blocks, which is why the group paints its "drawing them"
// line first and why the batch waits for that paint before it starts. And it
// runs once per group for the life of the browser rather than once per
// session: the pictures are kept in localStorage.
const drawing = new Set();

function drawGroupThumbs(id, items) {
  if (drawing.has(id) || !thumbs.missing(items)) return;
  drawing.add(id);
  // NOTHING HERE REDRAWS THE PANEL, and that is not a preference. A rebuild
  // sets the `open` attribute on every group, setting it fires `toggle`, and a
  // toggle handler that rebuilt the panel was an endless task loop that
  // saturated the main thread: the tool stayed usable-looking and the
  // compositor never got another frame, so a screenshot could not be taken at
  // all. The line below and the pictures above are both written straight into
  // the DOM that is already there.
  const body = left.querySelector(`details[data-group="${CSS.escape(id)}"] .body`);
  let note = null;
  if (body) {
    note = el('p', { class: 'note', text: 'drawing them...' });
    body.prepend(note);
  }
  // Two frames, then the work: one for the browser to lay the expanded group
  // out and one for it to paint that line. A setTimeout alone can land before
  // the paint and the author watches a frozen tool with no explanation on it.
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    let made = [];
    try {
      made = thumbs.renderBatch(items);
    } finally {
      drawing.delete(id);
    }
    for (const m of made) {
      for (const img of left.querySelectorAll(`img[data-thumb="${CSS.escape(m.key)}"]`)) {
        img.src = m.url;
      }
    }
    note?.remove();
    // The batch borrowed the renderer, so the scene is told to draw itself
    // again: it only renders when something has changed now.
    scene.invalidate();
  }, 0)));
}

function placeGroup(group) {
  const items = group.items;
  const shots = items.filter((e) => e.tool === 'place');
  // Only what is OPEN, which is the whole scheduling policy: a group nobody has
  // expanded costs nothing at all.
  const open = openGroups.has(group.id) || items.some(isPicked);
  if (open && shots.length) drawGroupThumbs(group.id, shots);

  return el('details', {
    class: 'group',
    'data-group': group.id,
    // Remembering the state, and starting the batch. NOT redrawing the panel:
    // see drawGroupThumbs.
    ontoggle: (e) => {
      if (e.target.open) {
        openGroups.add(group.id);
        if (shots.length) drawGroupThumbs(group.id, shots);
      } else {
        openGroups.delete(group.id);
      }
    },
    open: open ? '' : null,
  }, [
    el('summary', {}, [
      el('span', { text: group.label }),
      el('span', { class: 'n', text: String(items.length) }),
    ]),
    el('div', { class: 'body' }, [
      group.swatches ? swatchRow(items) : tileGrid(items),
      group.after ? group.after() : null,
    ]),
  ]);
}

// A PICTURE FOR EVERY TILE, and two kinds of picture.
//
// A prop gets a render of itself: "draped" means nothing until you have seen
// it, and the owner drew all twenty-nine of these by eye. A fence run, a gate,
// a change of stone, a grave and a path are not props and cannot be rendered
// as one -- a fence is a thing you draw, not a thing that exists until you have
// drawn it -- so each gets a drawn mark instead. An empty tile with a name
// under it was the worst of both: it reads as a thumbnail that failed.
// ILLUSTRATIONS FOR THE THINGS THAT ARE NOT PROPS.
//
// A headstone can be photographed because a headstone exists. A fence run does
// not: it is a line you draw, and there is nothing to point a camera at until
// you have drawn it. The same goes for a gate, a change of stone and a path.
// The first version left those tiles empty, which read as a thumbnail that had
// failed -- and was reported as exactly that.
//
// So they are DRAWN, and drawn as the thing rather than as a symbol of it: a
// fence run is several panels in a line, a gate is a run with a leaf swung open
// in the gap, a change of stone is a wall that is one stone on the left and
// another on the right with the join showing, and each path is a ribbon of its
// own material. All of them at the three-quarter angle everything else in the
// project is seen at, so the palette does not change viewpoint halfway down.
//
// Inline SVG rather than a render: these are diagrams, they stay crisp at any
// size, and they cost nothing to draw. The colours come from the same places
// the real things get theirs.
// Pitched against the tile's own pale ground rather than against the panel: a
// bone prop reads there by its shading, but a DRAWING has no shading, so it
// reads by its line. The first pass used the same near-white for both and the
// fence came out as a ghost of itself.
const STONE = '#eef1f5';
const SHADE = '#9aa3b0';
const LINE = '#39404b';

// A fence: pickets standing on a line that recedes to the right, with the two
// rails that make it one run rather than five posts.
const FENCE_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <ellipse cx="24" cy="41" rx="21" ry="3" fill="rgba(0,0,0,0.10)" />
  <path d="M6 31l36-9M6 36l36-9" stroke="${SHADE}" stroke-width="2.4" fill="none" />
  <path d="M7 38V22M16 35.5V20M25 33V18M34 30.5V16M43 28V14"
    stroke="${STONE}" stroke-width="3.4" stroke-linecap="round" fill="none" />
  <path d="M7 38V22M16 35.5V20M25 33V18M34 30.5V16M43 28V14"
    stroke="${LINE}" stroke-width="1.1" fill="none" opacity="0.75" />
</svg>`;

// A gate: the same run, with a gap in it and the leaf standing open across the
// opening. Open, because the opening is the whole idea.
const GATE_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <ellipse cx="24" cy="41" rx="21" ry="3" fill="rgba(0,0,0,0.10)" />
  <path d="M4 32l12-3M32 25l12-3" stroke="${SHADE}" stroke-width="2.2" fill="none" />
  <path d="M5 38V23M15 35.5V20.5M33 31V16M43 28.5V13.5"
    stroke="${STONE}" stroke-width="3.4" stroke-linecap="round" fill="none" />
  <path d="M16 34l12 5v-12l-12-5z" fill="${STONE}" stroke="${LINE}" stroke-width="1" stroke-linejoin="round" />
  <path d="M16 30l12 5M16 26.5l12 5" stroke="${LINE}" stroke-width="0.8" opacity="0.45" fill="none" />
  <path d="M16 37q7 2 13 3" stroke="${LINE}" stroke-width="0.9" stroke-dasharray="2 2" fill="none" opacity="0.5" />
</svg>`;

// A change of stone: one wall, two builds, the join between them standing as a
// pier. This picture says what the tool does better than the sentence beside it.
const WALL_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <ellipse cx="24" cy="40" rx="22" ry="3" fill="rgba(0,0,0,0.10)" />
  <path d="M3 36l19-5.5V15L3 20.5z" fill="${STONE}" stroke="${LINE}" stroke-width="1" stroke-linejoin="round" />
  <path d="M3 28.5l19-5.5M12 33.5v-15" stroke="${LINE}" stroke-width="0.8" opacity="0.5" fill="none" />
  <path d="M26 29.5L45 24V8.5L26 14z" fill="${SHADE}" stroke="${LINE}" stroke-width="1" stroke-linejoin="round" />
  <path d="M26 25.5l19-5.5M26 21.5l19-5.5M26 17.5l19-5.5" stroke="${LINE}" stroke-width="0.7" opacity="0.5" fill="none" />
  <path d="M31 27.9v-15.4M40 25.3v-15.4M35 24.2v-8" stroke="${LINE}" stroke-width="0.7" opacity="0.5" fill="none" />
  <path d="M21 31.5l6-1.7V12.3l-6 1.7z" fill="${STONE}" stroke="${LINE}" stroke-width="1" stroke-linejoin="round" />
</svg>`;

function glyphFor(e) {
  if (e.tool === 'fence') return FENCE_SVG;
  if (e.tool === 'gate') return GATE_SVG;
  if (e.tool === 'wall') return WALL_SVG;
  return null;
}

function tileGrid(items) {
  const wide = items.some((e) => e.label.length > 11);
  return el('div', { class: `tiles${wide ? ' wide' : ''}` }, items.map((e) => {
    const shot = e.tool === 'place' ? thumbs.get(e.kind, e.variant) : null;
    const glyph = glyphFor(e);
    return el('button', {
      title: e.title || null,
      'aria-pressed': String(isPicked(e)),
      onclick: () => pick(e),
    }, [
      e.tool === 'place'
        ? el('img', { class: 'shot', alt: '', 'data-thumb': thumbs.keyOf(e.kind, e.variant), ...(shot ? { src: shot } : {}) })
        : el('span', { class: 'shot glyph', html: glyph || '' }),
      el('span', { class: 'name', text: e.label }),
      e.key ? el('kbd', { text: e.key }) : null,
    ]);
  }));
}

// The ground materials, as their own colours.
function swatchRow(items) {
  return el('div', { class: 'swatchrow' }, items.map((e) => el('button', {
    title: `paint ${e.label}`,
    'aria-pressed': String(isPicked(e)),
    onclick: () => pick(e),
  }, [
    el('span', { class: 'chip', style: `background:${groundColour(e.label)}` }),
    el('span', { class: 'name', text: e.label }),
  ])));
}

// A standalone swatch row that is a choice rather than a tool, for the two ends
// of a kerb pair.
function materialSwatches(value, onpick) {
  return el('div', { class: 'swatchrow grow' }, GROUND_MATERIALS.map((m) => el('button', {
    title: m,
    'aria-pressed': String(value === m),
    onclick: () => onpick(m),
  }, [el('span', { class: 'chip', style: `background:${groundColour(m)}` })])));
}

const groundColour = (name) => (GROUND_COLOURS[name] || { color: '#8b93a3' }).color;

// HOW BIG IT IS, in the units the arena is measured in, which is the one thing
// a picture of a prop cannot tell you: every tile is the same size, so a grass
// tuft and a shed look alike until you read this. "halfU" and "disc r" were
// what the measured table calls them and meant nothing outside it.
function describeFoot(kind, variant) {
  const f = levelFootprint(kind, variant);
  const name = variant ? `${variant} ${kind}` : kind;
  const size = f.shape === 'disc'
    ? `${(f.r * 2).toFixed(1)} across`
    : `${(f.halfU * 2).toFixed(1)} by ${(f.halfV * 2).toFixed(1)}`;
  return `${name}: ${size}, ${f.height.toFixed(1)} tall. The ghost is 1.3 across.`;
}

function select(options, value, onchange) {
  return el('select', {
    class: 'grow',
    onchange: (e) => { onchange(e.target.value); refresh(); },
  }, options.map((o) => el('option', { value: o, text: o, selected: o === value ? '' : null })));
}

function number(value, min, max, step, onchange) {
  return el('input', {
    class: 'grow', type: 'number', value: String(value), min, max, step,
    onchange: (e) => { onchange(Number(e.target.value)); },
  });
}

// A CARD PER SUBJECT. The right column used to be one stream of rows with
// capitals scattered down it, which is a list of settings rather than a set of
// things. LEVEL, WALL, VIEW, SPAWNS, SELECTION and the three checkers are
// separate subjects and now read as separate blocks.
function card(id, title, children, { count = null, bad = false, help = null } = {}) {
  const head = [el('span', { text: title })];
  if (help) {
    head.push(el('button', {
      class: 'info',
      text: '?',
      title: 'what this is',
      'aria-pressed': String(openHelp.has(id)),
      onclick: () => {
        if (openHelp.has(id)) openHelp.delete(id); else openHelp.add(id);
        drawRight();
      },
    }));
  }
  if (count !== null) head.push(el('span', { class: 'count', text: String(count), 'data-bad': bad ? '1' : null }));
  return el('section', { class: 'card' }, [
    el('h2', {}, head),
    ...(help && openHelp.has(id) ? [el('p', { class: 'note', text: help })] : []),
    ...[].concat(children),
  ]);
}

// A SEGMENTED CONTROL. Four stones, three joints, two cameras: a closed set
// small enough to show whole is not a dropdown, because a dropdown hides the
// set and the set is the information.
function segment(options, value, onpick, { labels = null } = {}) {
  return el('div', { class: 'seg' }, options.map((o, i) => el('button', {
    text: labels ? labels[i] : o,
    title: labels ? o : null,
    'aria-pressed': String(o === value),
    onclick: () => onpick(o),
  })));
}

// A SWITCH IS A BUTTON THAT STAYS DOWN. The browser's tick box is a different
// house style, a fixed size and a hit target the width of the tick.
function toggle(label, value, onchange, title = null) {
  return el('button', {
    class: 'grow',
    title,
    'aria-pressed': String(value),
    onclick: () => onchange(!value),
  }, [el('span', { text: label })]);
}

function drawRight() {
  const sel = [...selection];
  const stones = [...wallStones()];
  right.replaceChildren(
    card('level', 'level', [
      el('div', { class: 'row' }, [
        el('label', { text: 'name' }),
        el('input', {
          class: 'grow', type: 'text', value: doc.name,
          onchange: (e) => commit(() => { doc.name = e.target.value; }),
        }),
      ]),
      // THIRTY, AND NO CHOICE. The owner fixed it: thirty is six of the floor's
      // major grid squares and the number every other number in the project was
      // measured against -- the firefly spacing, the camera's framing, the four
      // pellets one to a quadrant. The FORMAT still carries a size and
      // everything downstream still reads it, so a smaller arena remains a
      // thing the file can say and a harness can ask for; it is only the tool
      // that has stopped offering it.
      el('div', { class: 'row' }, [
        el('label', { text: 'arena' }),
        el('span', { class: 'grow value', text: `${doc.size} by ${doc.size}${doc.size === LEVEL_SIZE ? '' : ' (made at another size)'}` }),
      ]),
      // NOT "seed". To us it is the number every random decision is drawn
      // from; to somebody laying out a graveyard it was an unexplained figure
      // in a box next to the level's name. What it DOES to them is shuffle the
      // small stuff, and that is what it is now called.
      el('div', { class: 'row' }, [
        el('label', { text: 'variation' }),
        number(doc.seed, 1, 999999, 1, (v) => commit(() => { doc.seed = v; doc.fireflies.seed = v; })),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'grow play',
          text: 'play this',
          title: 'Open the game on exactly what is on screen, unsaved changes and all. No file, no URL to type.',
          onclick: playLevel,
        }),
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'grow', text: 'save json', onclick: saveFile }),
        el('button', { class: 'grow', text: 'open', onclick: pickFile }),
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'grow', text: 'undo', title: 'ctrl+z', onclick: undo, disabled: undoStack.length ? null : '' }),
        el('button', { class: 'grow', text: 'redo', title: 'ctrl+shift+z', onclick: redo, disabled: redoStack.length ? null : '' }),
        // THE FRONT DOOR. Every level starts here now, so what it gives has to
        // be the whole of a blank page and nothing else: the wall, the ground,
        // and the spot the ghost starts on. emptyLevel is already exactly that
        // -- no props, no fences, no graves, no paint.
        el('button', { class: 'grow danger', text: 'new', onclick: () => {
          if (!confirm('start a new empty level? the current one is only in this tab.')) return;
          commit(() => {
            doc = emptyLevel({ size: LEVEL_SIZE, seed: doc.seed, name: 'graveyard' });
            selection.clear();
            pending = null;
          });
          say('an empty arena. Place a spawn with S, then build outward from it.');
        } }),
      ]),
    ], {
      help: 'Variation shuffles the things you do not place by hand: how each headstone leans, how its stone is grained, where the fireflies land. The same number always draws the same level, so change it only if you want a different shuffle. Play opens the game on what is on screen. Save writes a file, which is how a level becomes permanent.',
    }),

    card('wall', 'wall', [
      el('div', { class: 'row' }, [
        el('label', { text: 'built of' }),
        segment(WALL_VARIANTS, doc.wall.variant, (v) => commit(() => { doc.wall.variant = v; })),
      ]),
      // WHAT THE WALL TOOL STAMPS. Two rows and then clicks on the wall itself,
      // which is how a wall gets built piece by piece: drawing a whole boundary
      // in four clicks is still there and is still the right way to start, and
      // this is the way to work along it afterwards.
      // TWO STONES ON SCREEN AT ONCE, and until these were labelled it was not
      // possible to tell which was which: one is what the wall is made of and
      // one is what the next click will change it to.
      el('p', { class: 'note', text: 'change of stone tool, then click the wall:' }),
      el('div', { class: 'row' }, [
        el('label', { text: 'change to' }),
        segment(WALL_VARIANTS, wallPick.variant, (v) => { wallPick.variant = v; setTool('wall'); }),
      ]),
      el('div', { class: 'row' }, [
        el('label', { text: 'joined by' }),
        segment(WALL_JOINTS, wallPick.joint, (v) => { wallPick.joint = v; setTool('wall'); }),
      ]),
      ...doc.wall.styles.map(styleRow),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'grow',
          text: 'add one halfway along',
          disabled: doc.wall.styles.length >= MAX_WALL_CHANGES ? '' : null,
          onclick: () => commit(() => {
            // A sixth of the way on from the last change, which is a place an
            // author can see rather than a place the arithmetic liked.
            const len = wallLength(doc.wall.points);
            const last = doc.wall.styles.length ? doc.wall.styles[doc.wall.styles.length - 1].at : 0;
            const want = wallStones([wallPick.variant]);
            doc.wall.styles.push({
              at: Math.min(len - 0.5, Math.round((last + len / 6) * 2) / 2),
              variant: want.size <= MAX_STYLES ? wallPick.variant : doc.wall.variant,
              joint: wallPick.joint,
            });
            doc.wall.styles.sort((a, b) => a.at - b.at);
          }),
        }),
      ]),
    ], {
      count: `${stones.length} of ${MAX_STYLES} stones`,
      help: `The wall can change what it is built of as it goes round. Pick the change of stone tool in the palette, then click the wall where you want it to change; click a change to take it out again. Each change is written as how far round the wall it is, measured from the first corner anticlockwise, and the wall is ${wallLength(doc.wall.points).toFixed(0)} across all four sides. This one uses ${stones.join(', ')}, and four different stones is all one wall can carry.`,
    }),

    card('view', 'view', [
      el('div', { class: 'row' }, [
        segment(['game', 'plan'], scene.mode, (v) => setMode(v), { labels: ['game camera', 'from above'] }),
      ]),
      el('div', { class: 'row' }, [
        toggle('grid snap', snapOn, (v) => { snapOn = v; drawRight(); }, 'Half a unit. Shift inverts it while you drag.'),
        toggle('footprints', showFootprints, (v) => {
          showFootprints = v;
          scene.setOverlayFlags({ footprints: v });
          refresh();
        }, 'The box or disc each prop actually takes up.'),
      ]),
      el('div', { class: 'row' }, [
        toggle('facing', showFacing, (v) => {
          showFacing = v;
          scene.setOverlayFlags({ facing: v });
          refresh();
        }, 'Which way each prop looks. Several were authored to face the camera and read wrong from behind.'),
        el('span', { class: 'grow' }),
      ]),
    ]),

    card('selection', 'selection',
      sel.length === 1 ? inspector(sel[0])
        : el('p', { class: 'note', text: sel.length ? `${sel.length} selected` : 'nothing selected. Drag the ring under a selected thing to turn it.' })),

    card('audit', 'audit', auditList(), {
      count: review.stale ? '...' : review.errors.length,
      bad: !review.stale && review.errors.length > 0,
      help: 'The slow, thorough check, run a moment after you stop moving things. It looks for everything the quick one cannot: something standing in a path, something tall hiding something short from the camera, and above all a place the ghost can jump into that no skeleton can walk to. That last one ends a game, because the player stands in it and is safe for ever, and it is invisible until it is drawn on the floor in red.',
    }),

    card('fairness', 'fairness', fairnessList(), {
      count: fair.stale ? '...' : fair.fail.length,
      bad: fair.fail.length > 0,
      help: 'Eight questions about whether this level can be played and lost fairly: can the player reach everything, can the skeletons reach the player, is there anywhere to hide, can one skeleton standing in a gateway trap them. They were proved over three thousand generated levels; now that levels are made by hand, they are asked here instead.',
    }),

    card('problems', 'placement', issuesList(), {
      count: report && (report.errors.length || report.warnings.length)
        ? `${report.errors.length} to fix, ${report.warnings.length} to look at`
        : 'clear',
      bad: !!(report && report.errors.length),
      help: 'The quick check, run while you are still moving something: things overlapping, things standing in a fence or a gateway, things outside the wall. Anything it finds is outlined in red on the floor.',
    }),
  );
}

// Which cards have their explanation open. A person reads it once.
const openHelp = new Set();

let showFootprints = true;
let showFacing = true;


function inspector(id) {
  const r = recordOf(id);
  const k = kindOf(id);
  if (!r) return el('p', { class: 'note', text: 'nothing selected' });
  const rows = [el('div', { class: 'row' }, [
    el('label', { text: 'this is' }),
    el('span', { class: 'grow value', text: k === 'prop' ? `${r.variant || ''} ${r.kind}`.trim() : k }),
  ])];
  if (k === 'prop') {
    const group = PALETTE.find((gp) => gp.kind === r.kind);
    if (group) {
      rows.push(el('div', { class: 'row' }, [
        el('label', { text: 'variant' }),
        select(group.variants, r.variant, (v) => commit(() => { r.variant = v; })),
      ]));
    }
    rows.push(el('p', { class: 'note', text: describeFoot(r.kind, r.variant) }));

  }
  if (r.x !== undefined) {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'x' }), number(round(r.x), -30, 30, 0.1, (v) => commit(() => { r.x = v; })),
      el('label', { text: 'z' }), number(round(r.z), -30, 30, 0.1, (v) => commit(() => { r.z = v; })),
    ]));
  }
  if (r.yaw !== undefined) {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'yaw' }),
      el('input', {
        class: 'grow dial', type: 'range', min: '-180', max: '180', step: '0.5',
        value: String(round((r.yaw * 180) / Math.PI)),
        oninput: (e) => { beginEdit(); r.yaw = (Number(e.target.value) * Math.PI) / 180; refresh(); },
        onchange: endEdit,
      }),
      el('span', { class: 'value', text: `${Math.round((r.yaw * 180) / Math.PI)}°` }),
    ]));
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'grow', text: 'face the camera', onclick: () => commit(() => { r.yaw = FACE_YAW; }) }),
    ]));
  }
  if (k === 'grave') {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'skeleton' }),
      segment(PERSONALITIES, r.personality, (v) => commit(() => { r.personality = v; })),
    ]));
    rows.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'grow',
        text: 'throw the spoil the other way',
        title: 'Which long side the heap lands on. The wrong side puts it through a fence.',
        onclick: () => commit(() => { r.pile = (r.pile || 1) * -1; }),
      }),
    ]));
  }
  if (k === 'fence') {
    rows.push(el('div', { class: 'row' }, [
      toggle('closed pen', r.closed, (v) => commit(() => {
        r.closed = v;
        if (v && !r.gates.length) r.gates.push({ edge: 0, t: 0.5 });
      }), 'A closed run is a pen, and a pen gets a gate put in it because a pen with no way in is a pocket.'),
    ]));
    rows.push(el('p', { class: 'note', text: `${r.points.length} points, ${r.gates.length} gate${r.gates.length === 1 ? '' : 's'}` }));
  }
  return el('div', {}, rows);
}

const round = (v) => Math.round(v * 100) / 100;

// One change of stone along the perimeter. `at` is a distance from the first
// corner, exactly as a gate's is, so this is the gate placement UI wearing a
// different hat.
//
// Two rows, because a change of stone has two halves and they are different
// questions. The first is WHERE and TO WHAT: a distance along the run and the
// variant that holds from there on. The second is HOW THE TWO MEET, which is
// the joint, and it only ever has three answers: a pier standing on the change,
// the new material toothed course by course into the old, or a stepped break
// with the new build proud of the old.
//
// The joint's OWN stone is offered only for a pier, because that is the only
// joint that has one: wall.js reads jointVariant on a pier and nowhere else, a
// tooth is by definition the two materials interlocking, and a step is a face
// of the new build. Its default is not a variant but a sentence -- the older of
// the two -- which is what a real buttress the new work was laid up to would
// be, so the empty option says so rather than repeating a stone name.
function styleRow(st, i) {
  const len = wallLength(doc.wall.points);
  const rows = [el('div', { class: 'row' }, [
    el('label', { text: `at` }),
    number(st.at, 0, Math.round(len), 0.5, (v) => commit(() => {
      // Not zero. createWall drops a change at zero -- from there on IS the
      // base variant -- so an author who typed 0 would watch the row do
      // nothing at all. Half a unit in is the nearest thing that means it.
      st.at = Math.max(0.5, Math.min(len, v));
      doc.wall.styles.sort((a, b) => a.at - b.at);
    })),
    el('button', { text: '×', title: 'take this change out', onclick: () => commit(() => {
      doc.wall.styles.splice(i, 1);
    }) }),
  ])];
  rows.push(el('div', { class: 'row' }, [
    segment(WALL_VARIANTS, st.variant, (v) => commit(() => { st.variant = v; })),
  ]));
  rows.push(el('div', { class: 'row' }, [
    segment(WALL_JOINTS, st.joint, (v) => commit(() => {
      st.joint = v;
      if (v !== 'pier') delete st.jointVariant;
    })),
  ]));
  if (st.joint === 'pier') {
    // FIVE OPTIONS IS WHERE A SEGMENTED CONTROL GIVES UP. Four stones plus "the
    // older of the two" does not fit on a 290px panel without truncating every
    // label to three letters, and a control whose labels read "ol... as... ru..."
    // is worse than the dropdown it replaced. This is the one place in the tool
    // a select survives, which is exactly the rule the stylesheet states.
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'the pier' }),
      select(['the older stone', ...WALL_VARIANTS], st.jointVariant || 'the older stone', (v) => commit(() => {
        if (v === 'the older stone') delete st.jointVariant;
        else st.jointVariant = v;
      })),
    ]));
  }
  return el('div', { class: 'style' }, rows);
}

// audit.js's full rule set plus the wedge pass. A wedge is clickable: it flies
// the camera to the pocket, which is the only way to see one at all.
// NO RULE IDENTIFIERS ANYWHERE THE OWNER CAN SEE THEM. `overlap`, `gateless`
// and `F3safeSpot` are what the code calls its rules, and printing one in front
// of a sentence that already says what is wrong adds nothing to a reader who
// has not read the source and reads as a fault code to one who has not. The
// sentence stays; the label goes.
function auditList() {
  if (review.stale) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'checking...' })]);
  }
  if (review.error) {
    return el('ul', { class: 'issues' }, [el('li', { 'data-severity': 'error', text: `the check could not run: ${review.error}` })]);
  }
  const rows = review.issues.map((i) => el('li', {
    'data-severity': i.severity === 'error' ? 'error' : 'warn',
    text: i.message,
    onclick: () => {
      const m = /at (-?[\d.]+), (-?[\d.]+)/.exec(i.message);
      if (m) scene.lookAt(Number(m[1]), Number(m[2]));
    },
  }));
  if (!rows.length) rows.push(el('li', { class: 'none', text: 'nothing wrong, and nowhere the player can hide' }));
  return el('ul', { class: 'issues' }, rows);
}

// The eight the soak checks, as they stand on THIS level, in the words that say
// what is wrong rather than the names the code files them under.
function fairnessList() {
  if (fair.error) {
    return el('ul', { class: 'issues' }, [el('li', { 'data-severity': 'error', text: `the check could not run: ${fair.error}` })]);
  }
  if (fair.stale) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'checking...' })]);
  }
  if (!fair.fail.length) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'the player can reach everything, the skeletons can reach the player, and there is nowhere to hide' })]);
  }
  return el('ul', { class: 'issues' }, fair.fail.map((code) => el('li', {
    'data-severity': 'error',
    text: FAIR_MESSAGES[code] || code,
    onclick: () => { const w = fair.where[code]; if (w) scene.lookAt(w.x, w.z); },
  })));
}

function issuesList() {
  if (!report || !report.issues.length) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'nothing wrong with this level' })]);
  }
  return el('ul', { class: 'issues' }, report.issues.slice(0, 40).map((i) => el('li', {
    'data-severity': i.severity,
    text: i.message,
    onclick: () => {
      if (i.at) scene.lookAt(i.at.x, i.at.z);
      selection.clear();
      for (const r of i.refs) if (kindOf(ownerOf(r))) selection.add(ownerOf(r));
      refresh();
    },
  })));
}

function pickFile() {
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', () => { if (input.files[0]) openFile(input.files[0]); });
  input.click();
}

function drawStatus() {
  const s = scene.stats();
  const errors = report ? report.errors.length : 0;
  const unfair = fair.fail.length;
  statusEl.innerHTML = [
    `<b>${doc.props.length}</b> props · <b>${doc.graves.length}</b> spawns · `
      + `<b>${world ? world.fireflies().length : 0}</b> fireflies (auto, `
      + `${world ? world._derived.flies.spacing.toFixed(0) : 0} apart)`,
    `${s.cuts}/${s.max} floor cuts · ${world ? world._derived.gates.length : 0} gates`,
    errors ? `<span class="bad">${errors} error${errors === 1 ? '' : 's'}</span>` : 'geometry ok',
    review.stale ? 'checking...' : (review.errors.length || review.wedges.length)
      ? `<span class="bad">${review.errors.length} to fix${review.wedges.length ? `, ${review.wedges.length} of them a place the player could hide` : ''}</span>`
      : 'checks clean',
    fair.stale ? 'fairness: checking' : unfair
      ? `<span class="bad">${unfair} unfair thing${unfair === 1 ? '' : 's'}, listed on the right</span>`
      : 'fair: nowhere to hide, nothing out of reach',
    message ? `<span>${escapeHtml(message)}</span>` : '',
  ].filter(Boolean).join('<br>');
}

// THE KEYS, BEHIND A BUTTON, and remembered. Four lines of shortcuts at the
// bottom of the window are read once and then occupy it for ever. The two
// things a person could only have learnt from this text -- that a prop can be
// moved and turned -- are now handles on the floor, which is what made it
// affordable to fold this away.
const keysEl = document.getElementById('keys');
const keysToggle = document.getElementById('keys-toggle');
const KEYS_OPEN = 'graveyard-editor/keys/v1';

hintEl.innerHTML = [
  'selected: drag the middle to move, drag the ring to turn',
  'or <b>drag</b> to move, <b>alt</b>-drag to turn, <b>shift</b> to snap, <b>[ ]</b> to nudge',
  '<b>space</b> or middle drag pans · <b>wheel</b> zooms · <b>tab</b> swaps camera and plan',
  'runs: click points, <b>enter</b> finishes, <b>c</b> closes · <b>ctrl+z</b> undo · <b>ctrl+s</b> save',
].join('\n');

function showKeys(on) {
  keysEl.dataset.open = on ? '1' : '0';
  keysToggle.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(KEYS_OPEN, on ? '1' : '0'); } catch { /* private window */ }
}
keysToggle.addEventListener('click', () => showKeys(keysEl.dataset.open !== '1'));
// Open the first time somebody opens the tool, closed ever after, because the
// first time is the only time it is news.
let keysWanted = '1';
try { keysWanted = localStorage.getItem(KEYS_OPEN) ?? '1'; } catch { /* private window */ }
showKeys(keysWanted === '1');

// --- go ------------------------------------------------------------------------------

scene.onFrame = () => {
  if (paintDirty) flushPaint();
  scene.syncBadges(world);
};

refresh();
scene.lookAt(0, 0);

// A door for the capture scripts, and for anyone poking at the tool from the
// console. Nothing in the page depends on it.
window.__editor = {
  get doc() { return doc; },
  get report() { return report; },
  get tool() { return tool; },
  get review() { return review; },
  load(json) { doc = normalizeLevel(json); selection.clear(); pending = null; refresh(); },
  setTool, setMode,
  // The two answers the interface is built on, so a harness can ask them
  // directly rather than reading them off a screenshot: may this go here, and
  // where are the handles.
  preview: (x, z) => previewAt(x, z),
  gizmo: () => gizmoNow(),
  select(id) { selection.clear(); if (id) selection.add(id); refresh(); },
  // How many palette pictures exist, and whether a batch is running. A harness
  // waits on these rather than on a timer.
  thumbsDrawn: () => thumbs.size,
  thumbsBusy: () => drawing.size,
  scene,
  serialize: () => serializeLevel(doc),
  format: LEVEL_FORMAT,
};
window.__editorReady = true;
