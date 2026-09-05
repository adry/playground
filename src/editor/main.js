// THE LEVEL EDITOR. /editor/
//
// The owner's authoring tool for the contained graveyard: place props, turn
// them, draw the fences and the paths, say which skeleton climbs out of which
// grave and in what order, paint the ground, and save the whole thing as a JSON
// file the game can load.
//
// UNLISTED, NOT PRIVATE. See the comment at the top of editor/index.html. This
// file is the part that keeps the promise: everything it writes goes either to
// this page's own localStorage autosave or to a file the owner downloads on
// purpose, and neither can reach a shipped page. /lab/ loads a level only from
// a URL typed by hand.
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
//   a play mode    This is not the game. /lab/?world=1&level=... is, and it is
//                  one link away from a saved file.
//   free camera    Two views, the game's and straight down, because those are
//                  the two questions an author asks: what will the player see,
//                  and where actually is everything.

import { createEditorScene } from './scene.js';
import {
  emptyLevel, normalizeLevel, serializeLevel, createLevelWorld, renumberGraves,
  packPaint, unpackPaint, GROUND_MATERIALS, LEVEL_FORMAT,
  WALL_VARIANTS, WALL_JOINTS, MAX_STYLES, wallLength,
} from '../game/level/format.js';
import { validateLevel, reviewLevel } from '../game/level/validate.js';
import { checkFairness, FAIR_MESSAGES } from '../game/level/fairness.js';
import { PALETTE, PERSONALITIES, MAX_SPAWNS, levelFootprint } from '../game/level/catalogue.js';
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
    || doc.paths.some((p) => p.id === id);
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

const selection = new Set();
let tool = 'select';
let brush = { material: 1, radius: 1.5 };
let placeEntry = { kind: 'stone', variant: 'cross' };
let pathStyle = { material: 'sand', width: 1.3 };
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

function refresh({ deep = !editing } = {}) {
  paintCells = null;
  world = createLevelWorld(doc);
  report = validateLevel(doc, world, { deep });
  scene.sync(world, doc, { selection, flagged: report.flagged, hover, brush: tool === 'paint' && hover ? { ...hover, r: brush.radius } : null });
  fair.stale = true;
  review.stale = true;
  clearTimeout(fairTimer);
  fairTimer = setTimeout(deepReview, 260);
  drawPanels();
  drawStatus();
}

// THE SLOW HALF. Not advisory: F3 and a wedge are both invisible on screen and
// they are the two things most likely to be broken by accident.
function deepReview() {
  if (!world) return;
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
  scene.sync(world, doc, {
    selection, flagged: report.flagged, hover, wedges: review.wedges,
    brush: tool === 'paint' && hover ? { ...hover, r: brush.radius } : null,
  });
  drawPanels();
  drawStatus();
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
    || doc.paths.find((p) => p.id === id)
    || null;
}

function kindOf(id) {
  if (doc.props.some((p) => p.id === id)) return 'prop';
  if (doc.graves.some((g) => g.id === id)) return 'grave';
  if (doc.powerups.some((p) => p.id === id)) return 'powerup';
  if (doc.fences.some((f) => f.id === id)) return 'fence';
  if (doc.paths.some((p) => p.id === id)) return 'path';
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

function placeAt(x, z) {
  const e = placeEntry;
  if (e.kind === 'jack') {
    doc.powerups.push({ id: freshId('jack'), x, z });
    return;
  }
  doc.props.push({
    id: freshId('p'), kind: e.kind, variant: e.variant, x, z, yaw: FACE_YAW,
  });
}

function addSpawn(x, z) {
  if (doc.graves.length >= MAX_SPAWNS) {
    say(`four skeleton spawns is the limit. src/ghost/ground.js cuts at most ${MAX_SPAWNS} holes in the floor and throws at the fifth, and the rules run exactly four personalities.`);
    return false;
  }
  const taken = new Set(doc.graves.map((g) => g.personality));
  const free = PERSONALITIES.find((p) => !taken.has(p)) || PERSONALITIES[0];
  const g = {
    id: freshId('g'), x, z, yaw: FACE_YAW, order: doc.graves.length, personality: free, pile: 1,
  };
  doc.graves.push(g);
  renumberGraves(doc);
  // The heap goes on whichever long side is clear. Trying both here saves the
  // author an error they did not cause and would not guess the fix for.
  const errs = (side) => {
    g.pile = side;
    const w = createLevelWorld(doc);
    return validateLevel(doc, w, { deep: false }).errors.length;
  };
  if (errs(1) > errs(-1)) g.pile = -1; else g.pile = 1;
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

function flushPaint(force = false) {
  if (!paintDirty) return;
  const now = performance.now();
  if (!force && now - lastPaint < 110) return;
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
  doc.paths = doc.paths.filter((p) => !ids.has(p.id));
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
    } else if (k === 'path' || k === 'fence') {
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = freshId(k === 'path' ? 'path' : 'f');
      for (const p of copy.points) { p[0] += 0.8; p[1] += 0.8; }
      (k === 'path' ? doc.paths : doc.fences).push(copy);
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

  if (tool === 'place') { commit(() => placeAt(snapped(at.x), snapped(at.z))); return; }
  if (tool === 'spawn') { commit(() => { addSpawn(snapped(at.x), snapped(at.z)); }); return; }
  if (tool === 'gate') { commit(() => { toggleGate(at.x, at.z); }); return; }

  if (tool === 'fence' || tool === 'path') {
    commit(() => {
      if (!pending) {
        if (tool === 'fence') {
          const f = { id: freshId('f'), points: [[snapped(at.x), snapped(at.z)]], closed: false, gates: [] };
          doc.fences.push(f);
          pending = { kind: 'fence', id: f.id };
        } else {
          const p = {
            id: freshId('path'), material: pathStyle.material, width: pathStyle.width,
            points: [[snapped(at.x), snapped(at.z)]],
          };
          doc.paths.push(p);
          pending = { kind: 'path', id: p.id };
        }
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

  // select
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
  const centre = centreOf(id);
  drag = {
    type: e.altKey ? 'turn' : 'move',
    anchor: at,
    about: centre,
    start: [...selection].map((sid) => ({ id: sid, centre: centreOf(sid) })),
    yaw0: Math.atan2(at.x - centre.x, at.z - centre.z),
    moved: false,
  };
  refresh();
});

canvas.addEventListener('pointermove', (e) => {
  const at = scene.groundAt(e.clientX, e.clientY);
  if (!at) return;
  hover = at;

  if (!drag) {
    // Just the brush ring following the pointer. The document has not changed,
    // so nothing is rebuilt and nothing is revalidated.
    if (tool === 'paint' && world) {
      scene.overlayOnly(world, doc, {
        selection, flagged: report.flagged, hover, brush: { ...hover, r: brush.radius },
      });
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
      doc.paths = doc.paths.filter((p) => p.id !== pending.id);
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
const TOOL_KEYS = { v: 'select', b: 'place', f: 'fence', g: 'gate', p: 'path', s: 'spawn', k: 'paint' };

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
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); commit(duplicateSelection); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'a') {
    e.preventDefault();
    selection.clear();
    for (const p of doc.props) selection.add(p.id);
    refresh();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;

  if (k === 'escape') {
    // Abandon the run being drawn outright rather than stepping back one
    // click: escape means "forget this", and undo is still there for the rest.
    if (pending) {
      const id = pending.id;
      pending = null;
      commit(() => {
        doc.fences = doc.fences.filter((f) => f.id !== id);
        doc.paths = doc.paths.filter((f) => f.id !== id);
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
  if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

// --- files -------------------------------------------------------------------------

function saveFile({ anyway = false } = {}) {
  // NOT A QUIET SAVE. The generator used to be the last thing between a broken
  // level and a player and it is gone, so a level that fails a fairness
  // property or carries a geometry error has to be refused out loud. The owner
  // can still force it -- it is their tool -- but never by accident.
  const blocking = [
    ...report.errors.map((e) => e.message),
    ...review.errors.map((e) => `${e.code}: ${e.message}`),
    ...fair.fail.map((f) => `${f}: ${FAIR_MESSAGES[f] || f}`),
  ];
  if (review.stale || fair.stale) {
    say('checking the level before saving; press save again in a moment');
    deepReview();
    return;
  }
  if (blocking.length && !anyway) {
    const ok = confirm(
      `This level is not playable:\n\n  ${blocking.slice(0, 6).join('\n  ')}\n\n`
      + 'Save it anyway?',
    );
    if (!ok) { say(`not saved: ${blocking.length} problem${blocking.length === 1 ? '' : 's'} to fix first`); return; }
  }
  const text = serializeLevel(doc);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(doc.name || 'level').replace(/[^a-z0-9-_]+/gi, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  say(`saved ${a.download}. open it with /lab/?world=1&level=<url>`);
}

// THE GENERATOR AS A BLANK PAGE. It no longer competes with the editor: it
// produces one complete, fairness-checked arena which the owner then edits by
// hand. Imported lazily so a page that never presses the button never pays for
// the generator's module graph.
async function generateInto(seed) {
  say('generating...');
  const [{ createWorld }, { levelFromWorld }] = await Promise.all([
    import('../game/world/index.js'),
    import('../game/level/import.js'),
  ]);
  const gen = createWorld({ seed, size: doc.size });
  commit(() => {
    doc = levelFromWorld(gen, { name: `${doc.name || 'level'}` });
    doc.seed = seed;
    doc.fireflies.seed = seed;
    selection.clear();
    pending = null;
  });
  say(`generated seed ${seed}: ${doc.props.length} props, ${doc.fences.length} fences, ${doc.graves.length} spawns. Now move things.`);
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
  if (pending && t !== 'fence' && t !== 'path') finishPending(false);
  stage.dataset.tool = t;
  refresh();
}

function setMode(m) {
  scene.setMode(m);
  drawPanels();
}

function drawPanels() {
  drawLeft();
  drawRight();
}

function drawLeft() {
  left.replaceChildren(
    el('h2', { text: 'tool' }),
    el('div', { class: 'tools' }, [
      toolButton('select', 'select', 'V'),
      toolButton('place', 'place', 'B'),
      toolButton('fence', 'fence', 'F'),
      toolButton('gate', 'gate', 'G'),
      toolButton('path', 'path', 'P'),
      toolButton('spawn', 'spawn', 'S'),
      toolButton('paint', 'ground', 'K'),
    ]),

    el('h2', { text: 'palette' }),
    ...PALETTE.map(paletteGroup),

    el('h2', { text: 'lines' }),
    el('div', { class: 'row' }, [
      el('label', { text: 'material' }),
      select(['sand', 'gravel', 'kerb'], pathStyle.material, (v) => { pathStyle.material = v; }),
    ]),
    el('div', { class: 'row' }, [
      el('label', { text: 'width' }),
      number(pathStyle.width, 0.4, 3, 0.1, (v) => { pathStyle.width = v; }),
    ]),

    el('h2', { text: 'ground cover' }),
    el('div', { class: 'swatches' }, GROUND_MATERIALS.map((m, i) => el('button', {
      text: m,
      'aria-pressed': String(brush.material === i + 1),
      onclick: () => { brush.material = i + 1; setTool('paint'); },
    }))),
    el('div', { class: 'row' }, [
      el('label', { text: 'brush' }),
      number(brush.radius, 0.5, 6, 0.25, (v) => { brush.radius = v; refresh(); }),
    ]),
    el('p', { class: 'note', text: 'right-drag or alt-drag erases. Materials blend across about 1.5 units where they meet.' }),
  );
}

function toolButton(id, label, keyName) {
  return el('button', {
    'aria-pressed': String(tool === id),
    onclick: () => setTool(id),
  }, [el('span', { text: label }), el('kbd', { text: keyName })]);
}

function paletteGroup(group) {
  const items = group.items
    ? group.items
    : group.variants.map((v) => ({ kind: group.kind, variant: v, label: v }));
  return el('details', { open: group.id === 'stones' ? '' : null }, [
    el('summary', { text: `${group.label} (${items.length})` }),
    el('div', { class: 'swatches' }, items.map((it) => el('button', {
      text: it.label,
      title: describeFoot(it.kind, it.variant),
      'aria-pressed': String(placeEntry.kind === it.kind && placeEntry.variant === it.variant),
      onclick: () => {
        placeEntry = { kind: it.kind, variant: it.variant };
        setTool('place');
      },
    }))),
  ]);
}

function describeFoot(kind, variant) {
  const f = levelFootprint(kind, variant);
  return f.shape === 'disc'
    ? `${kind}/${variant}  disc r ${f.r.toFixed(2)}  height ${f.height.toFixed(2)}`
    : `${kind}/${variant}  box ${(f.halfU * 2).toFixed(2)} by ${(f.halfV * 2).toFixed(2)}  height ${f.height.toFixed(2)}`;
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

function drawRight() {
  const sel = [...selection];
  right.replaceChildren(
    el('h2', { text: 'level' }),
    el('div', { class: 'row' }, [
      el('label', { text: 'name' }),
      el('input', {
        class: 'grow', type: 'text', value: doc.name,
        onchange: (e) => commit(() => { doc.name = e.target.value; }),
      }),
    ]),
    el('div', { class: 'row' }, [
      el('label', { text: 'size' }),
      select(['10', '15', '20', '25', '30'], String(doc.size), (v) => commit(() => resize(Number(v)))),
    ]),
    el('div', { class: 'row' }, [
      el('label', { text: 'seed' }),
      number(doc.seed, 1, 999999, 1, (v) => commit(() => { doc.seed = v; doc.fireflies.seed = v; })),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'grow', text: 'save json', onclick: saveFile }),
      el('button', { class: 'grow', text: 'open', onclick: pickFile }),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'grow', text: 'undo', onclick: undo }),
      el('button', { class: 'grow', text: 'redo', onclick: redo }),
      el('button', { class: 'grow danger', text: 'new', onclick: () => {
        if (!confirm('start a new empty level? the current one is only in this tab.')) return;
        commit(() => { doc = emptyLevel({ size: doc.size, seed: doc.seed, name: 'graveyard' }); selection.clear(); });
      } }),
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'grow',
        text: 'generate a starting level',
        title: 'Fill the arena from the procedural generator at this seed, then edit it by hand. Undo puts it back.',
        onclick: () => generateInto(doc.seed),
      }),
    ]),

    el('h2', { text: 'wall' }),
    el('div', { class: 'row' }, [
      el('label', { text: 'stone' }),
      select(WALL_VARIANTS, doc.wall.variant, (v) => commit(() => { doc.wall.variant = v; })),
    ]),
    ...doc.wall.styles.map(styleRow),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'grow',
        text: `add a change of stone (${doc.wall.styles.length}/${MAX_STYLES - 1})`,
        disabled: doc.wall.styles.length >= MAX_STYLES - 1 ? '' : null,
        onclick: () => commit(() => {
          const len = wallLength(doc.wall.points);
          const n = doc.wall.styles.length;
          doc.wall.styles.push({
            at: Math.round((len * (n + 1)) / (MAX_STYLES + 1)),
            variant: WALL_VARIANTS[(WALL_VARIANTS.indexOf(doc.wall.variant) + 1 + n) % WALL_VARIANTS.length],
            joint: 'pier',
          });
          doc.wall.styles.sort((a, b) => a.at - b.at);
        }),
      }),
    ]),
    el('p', { class: 'note', text: `the wall runs ${wallLength(doc.wall.points).toFixed(0)} units from the first corner, anticlockwise. A change at that distance holds until the next one.` }),

    el('h2', { text: 'view' }),
    el('div', { class: 'row' }, [
      el('button', { class: 'grow', text: 'game camera', 'aria-pressed': String(scene.mode === 'game'), onclick: () => setMode('game') }),
      el('button', { class: 'grow', text: 'from above', 'aria-pressed': String(scene.mode === 'plan'), onclick: () => setMode('plan') }),
    ]),
    el('div', { class: 'row' }, [
      checkbox('grid snap 0.5', snapOn, (v) => { snapOn = v; }),
    ]),
    el('div', { class: 'row' }, [
      checkbox('footprints', showFootprints, (v) => { showFootprints = v; scene.setOverlayFlags({ footprints: v }); refresh(); }),
    ]),
    el('div', { class: 'row' }, [
      checkbox('facing arrows', showFacing, (v) => { showFacing = v; scene.setOverlayFlags({ facing: v }); refresh(); }),
    ]),

    el('h2', { text: `skeleton spawns  ${doc.graves.length}/${MAX_SPAWNS}` }),
    doc.graves.length
      ? el('ul', { class: 'spawns' }, doc.graves.map(spawnRow))
      : el('p', { class: 'note', text: 'the spawn tool puts a grave down. The number is which skeleton climbs out and when.' }),

    el('h2', { text: 'selection' }),
    sel.length === 1 ? inspector(sel[0]) : el('p', { class: 'note', text: sel.length ? `${sel.length} selected` : 'nothing selected' }),

    el('h2', { text: `audit  ${review.stale ? '...' : review.errors.length}` }),
    auditList(),

    el('h2', { text: 'fairness' }),
    fairnessList(),

    el('h2', { text: `problems  ${report ? report.errors.length : 0} / ${report ? report.warnings.length : 0}` }),
    issuesList(),
  );
}

let showFootprints = true;
let showFacing = true;

function checkbox(label, value, onchange) {
  const id = `cb-${label.replace(/\W+/g, '')}`;
  return el('label', { class: 'grow', for: id }, [
    el('input', {
      id, type: 'checkbox', checked: value ? '' : null,
      onchange: (e) => onchange(e.target.checked),
    }),
    el('span', { text: ` ${label}` }),
  ]);
}

function spawnRow(g, i) {
  return el('li', {}, [
    el('span', { class: 'n', text: String(g.order + 1) }),
    select(PERSONALITIES, g.personality, (v) => commit(() => { g.personality = v; })),
    el('button', { text: '↑', title: 'earlier', onclick: () => commit(() => reorder(i, -1)) }),
    el('button', { text: '↓', title: 'later', onclick: () => commit(() => reorder(i, 1)) }),
    el('button', { text: '×', title: 'remove', onclick: () => commit(() => {
      doc.graves.splice(i, 1);
      renumberGraves(doc);
    }) }),
  ]);
}

function reorder(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= doc.graves.length) return;
  const a = doc.graves[i];
  doc.graves[i] = doc.graves[j];
  doc.graves[j] = a;
  doc.graves.forEach((g, k) => { g.order = k; });
}

function inspector(id) {
  const r = recordOf(id);
  const k = kindOf(id);
  if (!r) return el('p', { class: 'note', text: 'nothing selected' });
  const rows = [el('div', { class: 'row' }, [el('label', { text: 'id' }), el('span', { class: 'grow', text: `${k} ${id}` })])];
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
        class: 'grow', type: 'range', min: '-180', max: '180', step: '0.5',
        value: String(round((r.yaw * 180) / Math.PI)),
        oninput: (e) => { beginEdit(); r.yaw = (Number(e.target.value) * Math.PI) / 180; refresh(); },
        onchange: endEdit,
      }),
      el('span', { text: `${Math.round((r.yaw * 180) / Math.PI)}°` }),
    ]));
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'grow', text: 'face the camera', onclick: () => commit(() => { r.yaw = FACE_YAW; }) }),
    ]));
  }
  if (k === 'grave') {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'spawn' }),
      select(PERSONALITIES, r.personality, (v) => commit(() => { r.personality = v; })),
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
  if (k === 'path') {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'material' }),
      select(['sand', 'gravel', 'kerb'], r.material, (v) => commit(() => { r.material = v; })),
    ]));
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'width' }),
      number(r.width, 0.4, 3, 0.1, (v) => commit(() => { r.width = v; })),
    ]));
  }
  if (k === 'fence') {
    rows.push(el('div', { class: 'row' }, [
      checkbox('closed pen', r.closed, (v) => commit(() => {
        r.closed = v;
        if (v && !r.gates.length) r.gates.push({ edge: 0, t: 0.5 });
      })),
    ]));
    rows.push(el('p', { class: 'note', text: `${r.points.length} points, ${r.gates.length} gate${r.gates.length === 1 ? '' : 's'}` }));
  }
  return el('div', {}, rows);
}

const round = (v) => Math.round(v * 100) / 100;

// One change of stone along the perimeter. `at` is a distance from the first
// corner, exactly as a gate's is, so this is the gate placement UI wearing a
// different hat.
function styleRow(st, i) {
  const len = wallLength(doc.wall.points);
  return el('div', { class: 'row' }, [
    el('span', { class: 'n', text: String(i + 1) }),
    number(st.at, 0, Math.round(len), 0.5, (v) => commit(() => {
      st.at = Math.max(0, Math.min(len, v));
      doc.wall.styles.sort((a, b) => a.at - b.at);
    })),
    select(WALL_VARIANTS, st.variant, (v) => commit(() => { st.variant = v; })),
    select(WALL_JOINTS, st.joint, (v) => commit(() => { st.joint = v; })),
    el('button', { text: '×', title: 'remove', onclick: () => commit(() => {
      doc.wall.styles.splice(i, 1);
    }) }),
  ]);
}

// audit.js's full rule set plus the wedge pass. A wedge is clickable: it flies
// the camera to the pocket, which is the only way to see one at all.
function auditList() {
  if (review.stale) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'running the audit and the wedge pass...' })]);
  }
  if (review.error) {
    return el('ul', { class: 'issues' }, [el('li', { 'data-severity': 'error', text: `the audit could not run: ${review.error}` })]);
  }
  const rows = review.issues.map((i) => el('li', {
    'data-severity': i.severity === 'error' ? 'error' : 'warn',
    text: `${i.code}: ${i.message}`,
    onclick: () => {
      const m = /at (-?[\d.]+), (-?[\d.]+)/.exec(i.message);
      if (m) scene.lookAt(Number(m[1]), Number(m[2]));
    },
  }));
  if (!rows.length) rows.push(el('li', { class: 'none', text: 'audit.js finds nothing wrong, and no wedges' }));
  return el('ul', { class: 'issues' }, rows);
}

// The eight the soak checks, as they stand on THIS level. See level/fairness.js
// for what each one means and why F3 is the one to read first.
function fairnessList() {
  if (fair.error) {
    return el('ul', { class: 'issues' }, [el('li', { 'data-severity': 'error', text: `the fairness check could not run: ${fair.error}` })]);
  }
  if (fair.stale) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'checking the eight fairness properties...' })]);
  }
  if (!fair.fail.length) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'passes all eight: spawn, F1 chase, F2 sealed, F3 safe spot, F4 pin, firefly reach, grave clearance, gate width' })]);
  }
  return el('ul', { class: 'issues' }, fair.fail.map((code) => el('li', {
    'data-severity': 'error',
    text: `${code} - ${FAIR_MESSAGES[code] || ''}`,
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

function resize(size) {
  doc.size = size;
  doc.wall = { points: emptyLevel({ size }).wall.points, closed: true };
  const g = emptyLevel({ size }).ground;
  // The paint field is re-cut to the new arena rather than rescaled: half a
  // metre is half a metre whatever the level is, and a rescale would smear the
  // borders the author just painted.
  const old = { ...doc.ground, cells: unpackPaint(doc.ground.paint, doc.ground.w * doc.ground.h) };
  const next = new Uint8Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const x = g.minX + (i + 0.5) * g.cell;
      const z = g.minZ + (j + 0.5) * g.cell;
      const oi = Math.floor((x - old.minX) / old.cell);
      const oj = Math.floor((z - old.minZ) / old.cell);
      if (oi >= 0 && oj >= 0 && oi < old.w && oj < old.h) next[j * g.w + i] = old.cells[oj * old.w + oi];
    }
  }
  doc.ground = { ...g, paint: packPaint(next) };
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
    review.stale ? 'audit: checking' : review.errors.length
      ? `<span class="bad">audit ${review.errors.length}, ${review.wedges.length} wedge${review.wedges.length === 1 ? '' : 's'}</span>`
      : 'audit: clean, no wedges',
    fair.stale ? 'fairness: checking' : unfair
      ? `<span class="bad">fails ${fair.fail.join(', ')}</span>`
      : 'fairness: all eight pass',
    message ? `<span>${message}</span>` : '',
  ].filter(Boolean).join('<br>');
}

hintEl.textContent = [
  'drag select · alt-drag turns freely, +shift snaps 15° · [ ] nudge 5° · shift-drag snaps to the grid',
  'space or middle drag pans · wheel zooms · tab swaps the game camera and the plan',
  'fence and path: click points, enter finishes, c closes · ctrl+z undo · ctrl+s save',
].join('\n');

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
  load(json) { doc = normalizeLevel(json); refresh(); },
  setTool, setMode,
  scene,
  serialize: () => serializeLevel(doc),
  format: LEVEL_FORMAT,
};
window.__editorReady = true;
