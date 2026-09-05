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
  WALL_VARIANTS, WALL_JOINTS, MAX_STYLES, WALL_SECTION, MAX_MAIN_GATES,
  wallDistanceTo, wallPointAt, wallSections, wallSectionCount, setWallSections,
  SESSION_KEY, SESSION_LEVEL,
} from '../game/level/format.js';
import {
  validateLevel, reviewLevel, placementCheck, placementProps, segmentCheck,
} from '../game/level/validate.js';
import { checkFairness, FAIR_MESSAGES } from '../game/level/fairness.js';
import { PALETTE, levelFootprint } from '../game/level/catalogue.js';
import { spawnZone, spawnFault } from '../game/world/spawn.js';
import { mainGateFault, mainGateAt } from '../ghost/props/fence/maingate.js';
import { LEVEL_SIZE } from '../game/world/field.js';
// THE ONLINE HALF: an account, the levels in it, and the choice to make one
// public. All of it lives in src/net/online.js, which owns the requests, the
// panel and every way each of them can fail. What is here is two buttons and
// the four things that panel needs from this file, because a level going out
// over the network has to answer to the same guard as one going out as a file,
// and because opening one from the account is the same act as opening a file.
//
// NONE OF IT IS ON THE PATH OF THE EDITOR WORKING. Signed out, offline, or with
// the whole database turned off, everything above this line behaves exactly as
// it did before it existed.
import { createOnlinePanel } from '../net/online.js';

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
// What a click on the wall does: change the stone of a section, or put a
// gateway in the boundary between two.
let wallClick = 'stone';
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

// WHERE A SKELETON COULD CLIMB OUT, and where it could not and why.
//
// A headstone is a spawn marker if the ground in front of it is clear, and the
// piece of ground it needs is 2.14 by 2.65, which is bigger than it looks: the
// measured demo had eight of its twelve markers blocked, all of them by other
// headstones in tidy rows. An author cannot see that and cannot be told it in a
// sentence, so it is drawn.
//
// Not all of them all the time: twenty three rectangles is the floor. The
// selected stone always, and the whole set when the space overlay is on.
function spawnZoneOverlay() {
  if (!world) return [];
  const ctx = {
    props: world.props(), barriers: world.barriers(), gates: world.gates(), box: world.bounds,
  };
  const out = [];
  for (const p of world.props()) {
    const z = spawnZone(p);
    if (!z) continue;
    if (!showFootprints && !selection.has(p.id)) continue;
    out.push({ ...z, fault: spawnFault(z, ctx) });
  }
  return out;
}

// Everything the overlay draws, in one place, so the three callers below
// cannot each show a different set of it.
function overlayOpts(extra = {}) {
  return {
    selection,
    flagged: report ? report.flagged : new Set(),
    hover,
    brush: tool === 'paint' && hover ? { ...hover, r: brush.radius } : null,
    // The green or red footprint: of the thing about to be dropped, or of the
    // thing currently being dragged, which are the same question.
    ghost: drag && (drag.type === 'move' || drag.type === 'turn')
      ? dragCheck()
      : (hover ? previewAt(snapped(hover.x), snapped(hover.z)) : null),
    // WHICH SECTION OF WALL THE NEXT CLICK PAINTS. Without it an author is
    // clicking a hundred and twenty units of wall and guessing where the five
    // unit boundaries fall.
    wallHover: tool === 'wall' && wallClick === 'stone' && hover && wallSectionAt(hover.x, hover.z)
      ? wallSectionOutline(wallSectionAt(hover.x, hover.z).i)
      : null,
    // The join a gateway would go in, and whether it can. Same idea as the
    // section band: an author should not have to guess where a boundary falls.
    wallGate: tool === 'wall' && wallClick === 'gate' && hover && wallBoundaryAt(hover.x, hover.z)
      ? (() => {
        const b = wallBoundaryAt(hover.x, hover.z);
        const on = (doc.wall.gates || []).some((g) => Math.abs(g - b.at) < 1e-6);
        const at = mainGateAt(doc.wall.points.map(([x, z]) => ({ x, z })), b.at);
        return { x: at.x, z: at.z, yaw: at.yaw, ok: on || !gateFaultAt(b.at), on };
      })()
      : null,
    // Every way in the wall already has, so they can be seen and found.
    wallGates: (doc.wall.gates || []).map((g) => mainGateAt(doc.wall.points.map(([x, z]) => ({ x, z })), g)),
    wallMarks: doc.wall.styles.map((st) => wallPointAt(doc.wall.points, st.at)),
    // THE FENCE ABOUT TO BE DRAWN. Green or red, and a ring on whatever the
    // point has attached itself to, because a snap the author cannot see is a
    // snap that fights them.
    // The ground in front of every headstone, and whether a skeleton could
    // actually come up there. Only while something is selected or the space
    // overlay is on, because twenty three green rectangles is the whole floor.
    spawnZones: spawnZoneOverlay(),
    fence: tool === 'fence' && hover ? (() => {
      const look = fencePreview(hover.x, hover.z, altDown);
      return look && { ...look, to: look.at.to };
    })() : null,
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

// The overlay alone, for the things that change under the pointer without the
// document changing: the ghost footprint, the fence line, the wall section.
function redrawOverlay() {
  if (!world) return;
  scene.overlayOnly(world, doc, overlayOpts({ wedges: review.stale ? [] : review.wedges }));
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

// IS WHERE THIS HAS BEEN DRAGGED TO ALLOWED? The same question the drop asks,
// about a prop that is already in the level, so that moving something into a
// fence is refused the same way putting it there would have been. Turning
// counts too: a footprint is a turned box, and a headstone's keep-clear ground
// turns with it.
//
// The props being dragged are left out of their own overlap test, or a thing
// collides with itself as soon as it has moved less than its own width.
function dragCheck() {
  if (!world || !drag || !drag.start.length) return null;
  const ids = new Set(drag.start.map((d) => d.id));
  const cands = [];
  for (const id of ids) {
    if (kindOf(id) !== 'prop') continue;
    const r = recordOf(id);
    if (r) cands.push(...placementProps({ kind: r.kind, variant: r.variant, x: r.x, z: r.z, yaw: r.yaw || 0 }));
  }
  if (!cands.length) return null;
  return { ...placementCheck(world, cands, { ignore: ids }), foots: cands };
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

// THE WALL IS BUILT IN SECTIONS, and a section is one large square of the
// floor's own grid: five units, six to a side, twenty four round a 30 by 30
// arena. Click a section, it is made of the stone you picked. That is the whole
// of the tool and it needs no explanation, which is the point of it.
//
// What it replaced was a distance model: a change of stone written at "34 units
// along the run, anticlockwise from the first corner", with a number box, an
// add button and a paragraph explaining that a change holds until the next one.
// It was exact, it matched the file, and nobody who had not read the file could
// use it. The FILE still stores changes at distances -- see setWallSections --
// because that is what wall.js takes and it is the run length encoding of the
// sections anyway.
//
// THE LIMIT THAT BITES. wall.js carries at most MAX_STYLES distinct stones,
// because the geometry holds a style index per vertex, and with twenty four
// sections an author reaches for a fifth long before they have run out of wall.
// So it is shown at the point of use: a stone that would be the fifth is
// offered greyed out with the reason on it, rather than failing at the click or
// throwing at save.
function wallStones(sections = wallSections(doc.wall), extra = null) {
  const out = new Set(sections);
  if (extra) out.add(extra);
  return out;
}

// Which section of the wall a point on the floor is nearest to, and how far
// away it is. Null when the pointer is nowhere near the perimeter.
function wallSectionAt(x, z) {
  const near = wallDistanceTo(doc.wall.points, x, z);
  if (near.away > 2.6) return null;
  const n = wallSectionCount(doc.wall.points);
  const i = Math.min(n - 1, Math.max(0, Math.floor(near.at / WALL_SECTION)));
  return { i, n, away: near.away };
}

// The section drawn on the floor: the centreline of that stretch of wall,
// sampled rather than assumed straight, so a section that crossed a corner
// would still draw as the wall goes. On a square arena none does, because a
// side is exactly six sections.
function wallSectionOutline(i) {
  const pts = [];
  for (let d = 0; d <= WALL_SECTION + 1e-6; d += 0.5) {
    const at = wallPointAt(doc.wall.points, i * WALL_SECTION + d);
    pts.push(at);
  }
  return pts;
}

// Would this stone fit, if that section were made of it?
function stoneFits(i, stone) {
  const sections = wallSections(doc.wall);
  sections[i] = stone;
  return wallStones(sections).size <= MAX_STYLES;
}

// THE WAYS IN. A gateway goes on the boundary between two sections, which is
// where the wall already stands a pier, so it replaces that pier rather than
// squeezing between two and it lands on the lattice by construction. The
// author picks a boundary exactly as they pick a section, and the arithmetic is
// the same arithmetic.
//
// Every reason one cannot go somewhere comes from mainGateFault, in its own
// words: the geometry owns those rules and the tool should not be keeping a
// second opinion about them.
function wallBoundaryAt(x, z) {
  const near = wallDistanceTo(doc.wall.points, x, z);
  if (near.away > 2.6) return null;
  const n = wallSectionCount(doc.wall.points);
  const i = Math.round(near.at / WALL_SECTION) % n;
  return { i, at: i * WALL_SECTION };
}

function gateFaultAt(at) {
  const pts = doc.wall.points.map(([px, pz]) => ({ x: px, z: pz }));
  const want = [...(doc.wall.gates || []), at];
  const fault = mainGateFault(pts, want).find((f) => Math.abs(f.at - at) < 1e-6);
  return fault ? fault.why : null;
}

function toggleMainGate(x, z) {
  const b = wallBoundaryAt(x, z);
  if (!b) { say('click the join between two sections of the wall to put a gateway there'); return false; }
  const gates = doc.wall.gates || (doc.wall.gates = []);
  const had = gates.findIndex((g) => Math.abs(g - b.at) < 1e-6);
  if (had >= 0) {
    gates.splice(had, 1);
    say('closed that gateway up');
    return true;
  }
  if (gates.length >= MAX_MAIN_GATES) {
    say(`${MAX_MAIN_GATES} ways in is the most a wall can have, one to a side`);
    return false;
  }
  const why = gateFaultAt(b.at);
  if (why) { say(`no gateway there: ${why}`); return false; }
  gates.push(b.at);
  gates.sort((p, q) => p - q);
  say('a gateway. It is chained shut, and it is a hole in the wall you can see and in nothing else.');
  return true;
}

function paintWallSection(x, z) {
  const hit = wallSectionAt(x, z);
  if (!hit) { say('click a section of the perimeter wall to change what it is built of'); return false; }
  const sections = wallSections(doc.wall);
  if (sections[hit.i] === wallPick.variant) {
    say(`that section is already ${wallPick.variant}`);
    return false;
  }
  if (!stoneFits(hit.i, wallPick.variant)) {
    say(`a wall can be built of ${MAX_STYLES} stones at once and this one already uses ${[...wallStones()].join(', ')}`);
    return false;
  }
  // A change of stone on a boundary with a gateway in it is allowed and is
  // toothed rather than piered, because there is no wall at that distance for a
  // pier to stand in. setWallSections is where that is decided; nothing here
  // needs to know, which is the point of it being decided there.
  sections[hit.i] = wallPick.variant;
  setWallSections(doc.wall, sections, wallPick.joint);
  return true;
}

// ============================================================================
// DRAWING A FENCE: WHERE THE NEXT POINT LANDS, AND WHETHER IT MAY
// ============================================================================
//
// "the next fence attaches itself to the previous one logically", which is
// three separate things and all three are here.
//
//   IT ATTACHES. Within a unit of the end of a run that already exists, the
//   point lands exactly on it. A hairline gap between two fences looks like a
//   join and is not one: it is a hole a skeleton walks through, so it changes
//   whether the level is fair while looking correct. The perimeter counts too,
//   so a divider run out to the boundary meets it rather than stopping short.
//
//   IT IS A WHOLE NUMBER OF PANELS. A fence is built out of panels of a fixed
//   length and a run that is not a multiple of one either gets a cut panel or
//   gets stretched. Quantised to the panel from the previous corner.
//
//   IT IS SQUARE. Forty five degree steps, because the camera is isometric and
//   everything else in the scene is on those axes; a fence a degree and a half
//   off square is visible immediately and is almost never meant.
//
// ALL THREE ARE ESCAPABLE with alt held, and all three SHOW: the point that the
// click will use is ringed on the floor, and when it has attached to something
// the thing it attached to is ringed too.
//
// The radii are in WORLD units and not in pixels on purpose. The camera now
// zooms from three units to the whole arena, so a snap measured on screen would
// be a grab of half the level at one end of that range and unusable at the
// other.
const SNAP_END = 1.0;      // to the end of a run that is already there
const SNAP_WALL = 0.9;     // onto the perimeter's own line
const SNAP_ANGLE = Math.PI / 4;

// Every corner a run could attach to.
function fenceAnchors() {
  const out = [];
  for (const f of doc.fences) {
    for (const [x, z] of f.points) out.push({ x, z, id: f.id });
  }
  for (const [x, z] of doc.wall.points) out.push({ x, z, id: 'wall' });
  return out;
}

// Where the next click would actually put a point.
function fenceSnap(x, z, free = false) {
  if (free) return { x, z, to: null };

  let best = null;
  for (const a of fenceAnchors()) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < SNAP_END && (!best || d < best.d)) best = { d, a };
  }
  if (best) return { x: best.a.x, z: best.a.z, to: best.a };

  // The perimeter's own line, so a run that reaches the boundary meets it.
  const onWall = wallDistanceTo(doc.wall.points, x, z);
  if (onWall.away < SNAP_WALL) {
    const p = wallPointAt(doc.wall.points, onWall.at);
    return { x: p.x, z: p.z, to: { x: p.x, z: p.z, id: 'wall' } };
  }

  const prev = pendingLastPoint();
  if (!prev) return { x: snapped(x), z: snapped(z), to: null };

  // Square and a whole number of panels, from the corner before it.
  const panel = world ? world.PANEL : 2;
  const dx = x - prev.x;
  const dz = z - prev.z;
  const angle = Math.round(Math.atan2(dz, dx) / SNAP_ANGLE) * SNAP_ANGLE;
  const len = Math.max(panel, Math.round(Math.hypot(dx, dz) / panel) * panel);
  return { x: prev.x + Math.cos(angle) * len, z: prev.z + Math.sin(angle) * len, to: null };
}

function pendingLastPoint() {
  if (!pending) return null;
  const r = recordOf(pending.id);
  if (!r || !r.points.length) return null;
  const [x, z] = r.points[r.points.length - 1];
  return { x, z };
}

// THE SEGMENT ABOUT TO BE COMMITTED, green or red, on the same rules and
// through the same function as the drop that follows it.
function fencePreview(x, z, free = false) {
  if (!world) return null;
  const at = fenceSnap(x, z, free);
  const prev = pendingLastPoint();
  if (!prev) {
    const b = world.bounds;
    const inside = at.x >= b.minX && at.x <= b.maxX && at.z >= b.minZ && at.z <= b.maxZ;
    return { at, ok: inside, why: inside ? '' : 'outside the wall', a: null };
  }
  // Its own run is ignored, or every corner would read as crossing the
  // segment that ends on it.
  const check = segmentCheck(world, prev, at, { ignore: pending ? pending.id : null });
  return { ...check, at, a: prev };
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

  // A CLICK ON A THING SELECTS IT, whatever tool is up. If the drop would have
  // been refused anyway -- and standing on top of something is exactly the case
  // that is refused -- then what the author meant by clicking a headstone is
  // the headstone. This is the way back to selecting without going to find the
  // select button, and it is why "click a thing, it is selected" is true in
  // this tool without qualification.
  if (tool === 'place') {
    const look = previewAt(snapped(at.x), snapped(at.z));
    if (look && !look.ok) {
      const hit = scene.pickAt(e.clientX, e.clientY);
      const id = hit ? ownerOf(hit.id) : null;
      if (id && kindOf(id)) {
        setTool('select');
        selection.clear();
        selection.add(id);
        say(`selected the ${kindOf(id)}. Drag the middle to move it, the ring to turn it.`);
        refresh();
        return;
      }
    }
    commitIf(() => placeAt(snapped(at.x), snapped(at.z)));
    return;
  }
  
  if (tool === 'gate') { commitIf(() => toggleGate(at.x, at.z)); return; }
  if (tool === 'wall') {
    commitIf(() => (wallClick === 'gate' ? toggleMainGate(at.x, at.z) : paintWallSection(at.x, at.z)));
    return;
  }

  if (tool === 'fence') {
    const look = fencePreview(at.x, at.z, e.altKey);
    if (!look.ok) { say(`the fence cannot go there: ${look.why}`); return; }
    commitIf(() => {
      if (!pending) {
        const f = { id: freshId('f'), points: [[look.at.x, look.at.z]], closed: false, gates: [] };
        doc.fences.push(f);
        pending = { kind: 'fence', id: f.id };
        say('click the next corner. Enter finishes the run, c closes it into a pen.');
      } else {
        // An undo mid-draw can take the run out from under `pending`, so the
        // record is looked up rather than assumed. Losing the run is a
        // nuisance; throwing here would lose the session.
        const rec = recordOf(pending.id);
        if (rec) rec.points.push([look.at.x, look.at.z]);
        else pending = null;
      }
      return true;
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
    if (tool === 'paint' || tool === 'place' || tool === 'wall' || tool === 'fence') redrawOverlay();
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
    start: [...selection].map((sid) => ({
      id: sid, centre: centreOf(sid), yaw: recordOf(sid)?.yaw,
    })),
    yaw0: Math.atan2(at.x - about.x, at.z - about.z),
    moved: false,
  };
}

function endDrag() {
  // A MOVE OR A TURN THAT ENDED SOMEWHERE IT CANNOT BE goes back where it came
  // from. Refusing at the release rather than during the drag is deliberate:
  // dragging THROUGH a fence to somewhere clear on the other side is a normal
  // gesture, and a tool that snatched the prop back mid-drag would fight it.
  if (drag && (drag.type === 'move' || drag.type === 'turn') && drag.moved) {
    const check = dragCheck();
    if (check && !check.ok) {
      for (const st of drag.start) {
        const c = centreOf(st.id);
        if (c) moveRecord(st.id, st.centre.x - c.x, st.centre.z - c.z);
        const r = recordOf(st.id);
        if (r && st.yaw !== undefined && r.yaw !== undefined) r.yaw = st.yaw;
      }
      say(`put back: ${check.why}`);
    }
  }
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
// ALT IS THE ESCAPE FROM SNAPPING, tracked rather than read off the event,
// because the fence preview is drawn from a pointer move and has to know
// whether the key is down at that moment. Pressing or releasing it redraws.
let altDown = false;
// V is select, the one mode. B is "the prop I last picked", because the palette
// is long and going back to it for the same headstone twice is a waste of a
// hand. Every other letter picks an ENTRY out of the one list -- see
// entryForKey -- so F is a fence run and not merely the fence mode.

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  if (e.key === 'Alt' && !altDown) { altDown = true; redrawOverlay(); return; }

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
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
  if (e.key === 'Alt' && altDown) { altDown = false; redrawOverlay(); }
});
// The window can lose the keyboard with alt still held.
window.addEventListener('blur', () => { spaceDown = false; if (altDown) { altDown = false; redrawOverlay(); } });

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
// The three doors a level can go out of, and what to call each one in the
// sentence the guard writes. A table rather than a ternary, because there were
// two doors and now there are three and the next one should not have to touch
// the grammar.
const VERBS = {
  play: ['Play', 'played'],
  save: ['Save', 'saved'],
};

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
  const [asked, done] = VERBS[verb] || VERBS.save;
  const ok = confirm(
    `This level is not playable:\n\n  ${blocking.slice(0, 6).join('\n  ')}\n\n`
    + `${asked} it anyway?`,
  );
  if (!ok) {
    say(`not ${done}: ${blocking.length} problem${blocking.length === 1 ? '' : 's'} to fix first`);
    return false;
  }
  return true;
}

// SAVE ONLINE AND MY LEVELS, beside save. A file is how a level is KEPT: it is
// committed, it ships, it survives the database being turned off, and none of
// that changes. An account is where a level LIVES while it is being made, and
// where a link to send somebody comes from. Same guard, same document.
const online = createOnlinePanel({
  getDoc: () => doc,
  setDoc: (raw, label) => openDoc(raw, label),
  guard: guardPasses,
  say,
});

// WHERE A LEVEL GOES WHEN IT IS SAVED, and the one function that decides.
//
// It goes to the author's account. That is what the owner asked accounts for:
// levels are theirs, they follow them between machines, and they are private
// until they say otherwise. The download beside it is what it says, a copy, for
// getting a level out of the browser and into the site.
//
// SIGNED OUT, THIS ASKS. It does not quietly write a file instead. A primary
// action that means two different things depending on a state the person may
// not have noticed is worse than one that stops and says which state it is in,
// and the panel it opens is one click from being signed in. Everything else in
// the tool keeps working while they decide: building, playing, and the download.
function saveLevel() {
  online.save();
}

function saveFile({ anyway = false, copy = false } = {}) {
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
  say(copy
    ? `downloaded ${a.download}. Put it in public/levels/ and it plays at ${link}`
    : `saved as ${a.download}. Play needs none of this; once the file is in public/levels/ it plays at ${link}`);
}

// PUTTING A DOCUMENT IN THE EDITOR, from wherever it came. A file off disk and
// a level out of the account are the same act once the json is in hand, and
// they were two copies of this for about an hour.
function openDoc(raw, label) {
  try {
    doc = normalizeLevel(raw);
    undoStack.length = 0;
    redoStack.length = 0;
    selection.clear();
    pending = null;
    refresh();
    autosave();
    say(`loaded ${label}`);
    return true;
  } catch (err) {
    say(`could not read ${label}: ${err.message}`);
    return false;
  }
}

async function openFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (err) {
    say(`could not read that file: ${err.message}`);
    return;
  }
  openDoc(raw, file.name);
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
          title: 'Click a corner at a time; enter finishes the run and c closes it into a pen. A closed pen always gets a gate, because one with no way in is somewhere the player can hide.',
        },
        {
          tool: 'gate', label: 'gate', key: 'G',
          title: 'Click a fence to cut a gateway into it, and click a gateway to close it up again. A gateway belongs to its fence, so it moves when the fence does.',
        },
        {
          tool: 'wall', label: 'wall stone', key: 'W',
          title: 'Click a section of the perimeter wall to change what it is built of. A section is one large square of the floor grid, five units across.',
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
        title: 'Click a thing to select it. Then drag the middle of the ring to move it, drag the ring to turn it, and press delete to take it out.',
        onclick: () => { setTool('select'); },
      }, [el('span', { text: 'select' }), el('kbd', { text: 'V' })]),
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
  //
  // A ROWFUL AT A TIME, with a yield between rows. Twenty nine headstones in
  // one go measured at 6.2 seconds of solid main thread on the first pick of a
  // session, which is six seconds in which the tool does not answer the
  // pointer. The total is the same; what changes is that the tiles arrive in
  // waves of eight and the hand stays connected to the tool. See renderBatch
  // for why the gap has to be a gap and not a frame.
  const chunk = () => {
    let out = { made: [], done: true };
    try {
      out = thumbs.renderBatch(items);
    } finally {
      if (out.done) drawing.delete(id);
    }
    for (const m of out.made) {
      for (const img of left.querySelectorAll(`img[data-thumb="${CSS.escape(m.key)}"]`)) {
        img.src = m.url;
      }
    }
    if (!out.done) { setTimeout(chunk, 0); return; }
    note?.remove();
    // The batch borrowed the renderer, so the scene is told to draw itself
    // again: it only renders when something has changed now.
    scene.invalidate();
  };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(chunk, 0)));
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

// The three seams, drawn small: a pier standing on the join, the new stone
// toothed into the old course by course, and a straight step with the new build
// standing slightly proud. Two stones, light and dark, so which is which reads
// at this size.
const JOINT_WORDS = {
  pier: 'A pillar of stone stands on the join, wide enough to take any change of thickness. The workhorse.',
  tooth: 'The two stones bite into each other course by course, with no pillar and no vertical line.',
  step: 'A straight vertical break, with the new build standing a little proud of the old.',
};
const JOINT_SVGS = {
  pier: `<svg viewBox="0 0 40 22" aria-hidden="true">
    <path d="M1 6h15v12H1z" fill="${STONE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M24 6h15v12H24z" fill="${SHADE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M1 12h15M24 10h15M24 14h15" stroke="${LINE}" stroke-width="0.6" opacity="0.5" />
    <path d="M16 3h8v16h-8z" fill="${STONE}" stroke="${LINE}" stroke-width="0.9" />
  </svg>`,
  tooth: `<svg viewBox="0 0 40 22" aria-hidden="true">
    <path d="M1 6h19v12H1z" fill="${STONE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M20 6h19v12H20z" fill="${SHADE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M14 6h6v4h-6zM20 10h6v4h-6zM14 14h6v4h-6z" fill="${STONE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M1 10h13M1 14h13M26 10h13M26 14h13" stroke="${LINE}" stroke-width="0.6" opacity="0.5" />
  </svg>`,
  step: `<svg viewBox="0 0 40 22" aria-hidden="true">
    <path d="M1 7h18v11H1z" fill="${STONE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M21 4h18v14H21z" fill="${SHADE}" stroke="${LINE}" stroke-width="0.9" />
    <path d="M19 7v11M21 4v14" stroke="${LINE}" stroke-width="0.9" />
    <path d="M1 12h18M21 9h18M21 13h18" stroke="${LINE}" stroke-width="0.6" opacity="0.5" />
  </svg>`,
};

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
  // A card that has nothing to act on returns null and simply is not there.
  rightCards(
    card('level', 'level', [
      el('div', { class: 'row' }, [
        el('label', { text: 'name' }),
        el('input', {
          class: 'grow', type: 'text', value: doc.name,
          onchange: (e) => commit(() => { doc.name = e.target.value; }),
        }),
      ]),
      // THE ARENA'S SIZE IS NOT HERE. It is thirty, it cannot be anything else
      // from this tool, and a row that always says the same thing is furniture.
      // The FORMAT still carries a size and everything downstream still reads
      // it, so a smaller arena remains a thing a file can say and a harness can
      // ask for; the number is in this card's help for anyone who wonders.
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
      // SAVE, AND A COPY. "save json" named the file format, which is a fact
      // about how the tool works rather than about what the button does. Save
      // is the primary act; the download is how a level leaves this browser and
      // is secondary. THE SEAM: saveLevel is the one function that decides where
      // a level goes, so when the database lands it changes there and the button
      // does not move.
      el('div', { class: 'row' }, [
        el('button', {
          class: 'grow', text: 'save',
          title: 'Keep this level in your account. Private until you choose to share it.',
          onclick: saveLevel,
        }),
        el('button', { class: 'grow', text: 'open', title: 'Read a level file back in.', onclick: pickFile }),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'grow', text: 'download a copy',
          title: 'Write the level out as a file, which is how it gets into the site.',
          onclick: () => saveFile({ copy: true }),
        }),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'grow',
          text: 'my levels',
          title: 'Your account: the levels in it, which of them are public, and the link to send somebody.',
          onclick: () => online.open(),
        }),
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
          say('an empty arena. Pick something out of the list on the left and click the floor.');
        } }),
      ]),
    ], {
      help: `The arena is ${doc.size} by ${doc.size} and every level is. Variation shuffles the things you do not place by hand: how each headstone leans, how its stone is grained, where the fireflies land. The same number always draws the same level, so change it only if you want a different shuffle. Play opens the game on exactly what is on screen. Save writes a file, which is how a level is kept.`,
    }),

    // THE WALL'S CONTROLS ONLY WHILE THE WALL IS WHAT YOU ARE EDITING. A stone
    // and a joint on screen while somebody is planting a headstone are two
    // things to read past. The rule goes for the whole panel: a card that
    // cannot act on anything right now is not taking space. The two exceptions
    // are the checkers, whose whole job is to tell you about something you are
    // NOT currently looking at.
    tool === 'wall' ? card('wall', 'wall', [
      // ONE STONE PICKER, not two. There used to be a "starts in" and a "stamp"
      // side by side and no way to tell which was which; with sections there is
      // only one question, which is what the next click paints.
      el('div', { class: 'row' }, [
        el('label', { text: 'clicking' }),
        segment(['stone', 'gate'], wallClick, (v) => { wallClick = v; setTool('wall'); },
          { labels: ['changes the stone', 'puts a way in'] }),
      ]),
      el('p', { class: 'note', text: wallClick === 'gate'
        ? `click the join between two sections. ${(doc.wall.gates || []).length} of ${MAX_MAIN_GATES} ways in.`
        : 'click a section of the wall, five units of it' }),
      el('div', { class: 'row' }, [
        el('label', { text: 'make it' }),
        el('div', { class: 'seg' }, WALL_VARIANTS.map((v) => {
          // A FIFTH STONE IS OFFERED GREYED OUT WITH THE REASON ON IT. The wall
          // carries four at once and an author with twenty four sections will
          // reach for a fifth; finding that out at the click, or at the save,
          // would be the tool keeping a rule to itself.
          const fits = stones.includes(v) || stones.length < MAX_STYLES;
          return el('button', {
            text: v,
            disabled: fits ? null : '',
            title: fits ? `click a section to make it ${v}`
              : `the wall already uses ${stones.join(', ')}, and it can carry ${MAX_STYLES} stones at once`,
            'aria-pressed': String(wallPick.variant === v),
            onclick: () => { wallPick.variant = v; setTool('wall'); },
          });
        })),
      ]),
      // THE SEAM, DRAWN. "Joined by: pier, tooth, step" was three words the
      // owner asked the meaning of, and the answer is a picture: it is what the
      // wall looks like where one stone becomes another.
      el('p', { class: 'note', text: 'where one stone meets another' }),
      el('div', { class: 'seg tall' }, WALL_JOINTS.map((j) => el('button', {
        title: JOINT_WORDS[j],
        'aria-pressed': String(wallPick.joint === j),
        onclick: () => commit(() => {
          wallPick.joint = j;
          // Every boundary at once, because with sections a boundary either has
          // a joint or it is not a boundary, and one wall wants one answer.
          setWallSections(doc.wall, wallSections(doc.wall), j);
        }),
      }, [
        el('span', { class: 'seam', html: JOINT_SVGS[j] }),
        el('span', { text: j }),
      ]))),
    ], {
      count: `${stones.length} of ${MAX_STYLES} stones`,
      help: `The wall is built in sections, and a section is one large square of the floor: five across, six to a side, ${wallSectionCount(doc.wall.points)} round the whole arena. Click one and it is made of the stone you picked. Four stones at once is all the wall can carry.`,
    }) : null,

    card('view', 'view', [
      el('div', { class: 'row' }, [
        segment(['game', 'plan'], scene.mode, (v) => setMode(v), { labels: ['game camera', 'from above'] }),
      ]),
      el('div', { class: 'row' }, [
        toggle('grid snap', snapOn, (v) => { snapOn = v; drawRight(); }, 'Half a unit. Shift inverts it while you drag.'),
        // NAMED BY WHAT THEY SHOW. "Footprints" and "facing" are what the code
        // calls the data; the owner asked what both meant, which is the answer
        // to whether they were good names.
        toggle('space needed', showFootprints, (v) => {
          showFootprints = v;
          scene.setOverlayFlags({ footprints: v });
          refresh();
        }, 'Draw the ground each thing takes up and needs kept clear.'),
      ]),
      el('div', { class: 'row' }, [
        toggle('which way it faces', showFacing, (v) => {
          showFacing = v;
          scene.setOverlayFlags({ facing: v });
          refresh();
        }, 'Draw an arrow out of the front of each thing. Several of them were made to face the camera and look wrong from behind.'),
        el('span', { class: 'grow' }),
      ]),
    ]),

    sel.length ? card('selection', sel.length === 1 ? 'selected' : `${sel.length} selected`,
      sel.length === 1 ? inspector(sel[0]) : el('div', { class: 'stack' }, [
        el('p', { class: 'note', text: 'drag the middle of the ring to move them together, the ring to turn them' }),
        el('button', { class: 'grow danger', text: 'delete these', onclick: () => commit(deleteSelection) }),
      ])) : null,

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

function rightCards(...cards) {
  right.replaceChildren(...cards.filter(Boolean));
}

// Which cards have their explanation open. A person reads it once.
const openHelp = new Set();

let showFootprints = true;
let showFacing = true;


// WHAT YOU CAN DO TO THE THING YOU HAVE SELECTED, with the two the owner asked
// for three times at the top of it rather than under a line of text: TURN IT
// and DELETE IT. The ring on the floor and the delete key both still work; a
// control that exists and cannot be found is worth what no control is worth,
// and that has now been the answer three times running.
function inspector(id) {
  const r = recordOf(id);
  const k = kindOf(id);
  if (!r) return el('p', { class: 'note', text: 'nothing selected' });
  const rows = [];
  if (r.yaw !== undefined) {
    rows.push(el('div', { class: 'row' }, [
      el('label', { text: 'turn it' }),
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
      el('button', { class: 'grow danger', text: 'delete', title: 'or press delete', onclick: () => commit(deleteSelection) }),
    ]));
  } else {
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'grow danger', text: 'delete', title: 'or press delete', onclick: () => commit(deleteSelection) }),
    ]));
  }
  rows.push(el('div', { class: 'row' }, [
    el('label', { text: 'this is' }),
    el('span', { class: 'grow value', text: k === 'prop' ? `${r.variant || ''} ${r.kind}`.trim() : k }),
  ]));
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
  // A GRAVE FROM AN OLDER FILE. Nothing places one any more -- a skeleton
  // climbs out in front of a headstone now -- so what is offered here is the
  // two things you might want to do to one that is already there: turn the
  // heap of earth round, or take the whole plot out.
  if (k === 'grave') {
    rows.push(el('p', { class: 'note', text: 'an open grave from an older level. It is scenery: a skeleton climbs out in front of a headstone now, so this hole is a hole.' }));
    rows.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'grow',
        text: 'heap the earth the other side',
        title: 'Which long side of the hole the spoil lands on. The wrong side puts it through a fence.',
        onclick: () => commit(() => { r.pile = (r.pile || 1) * -1; }),
      }),
    ]));
  }
  if (k === 'fence') {
    rows.push(el('div', { class: 'row' }, [
      toggle('closed pen', r.closed, (v) => commit(() => {
        r.closed = v;
        if (v && !r.gates.length) r.gates.push({ edge: 0, t: 0.5 });
      }), 'A closed run always gets a gateway, because one with no way in is somewhere the player can hide.'),
    ]));
    rows.push(el('p', { class: 'note', text: `${r.points.length} corners, ${r.gates.length} gateway${r.gates.length === 1 ? '' : 's'}` }));
  }
  return el('div', {}, rows);
}

const round = (v) => Math.round(v * 100) / 100;

// NO RULE IDENTIFIERS ANYWHERE THE OWNER CAN SEE THEM. `overlap`, `gateless`
// and `F3safeSpot` are what the code calls its rules, and printing one in front
// of a sentence that already says what is wrong adds nothing to a reader who
// has not read the source and reads as a fault code to one who has not. The
// sentence stays; the label goes.
// THE AUDIT'S OWN WORDS, WITH ITS OWN NAMES TAKEN OUT OF THEM. audit.js writes
// for whoever is debugging audit.js, and it says things like "stone/celtic and
// dirt/null gap 0.031" and "fly/2 cannot be walked to". The finding is right
// and the nouns are ours: a `kind/variant` pair is how the catalogue keys a
// prop and `fly/2` is a firefly's id. Rewritten here rather than there, because
// there they are the right words for the job that file does.
function plainly(text) {
  return String(text)
    .replace(/\bfly\/\d+/g, 'a firefly')
    .replace(/\bjack\/\d+/g, 'a pellet')
    .replace(/\bg\d+\/(hole|dirt|head)\b/g, 'a grave')
    .replace(/\b([a-z]+)\/(null|undefined)\b/g, '$1')
    .replace(/\b([a-z]+)\/([a-z]+)\b/g, '$2 $1')
    .replace(/\bgap (-?[\d.]+)/g, 'with only $1 between them');
}

function auditList() {
  if (review.stale) {
    return el('ul', { class: 'issues' }, [el('li', { class: 'none', text: 'checking...' })]);
  }
  if (review.error) {
    return el('ul', { class: 'issues' }, [el('li', { 'data-severity': 'error', text: `the check could not run: ${review.error}` })]);
  }
  const rows = review.issues.map((i) => el('li', {
    'data-severity': i.severity === 'error' ? 'error' : 'warn',
    text: plainly(i.message),
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

// WHAT IS IN THE LEVEL, AND WHETHER IT CAN BE PLAYED. Two lines, and every
// number in them is one somebody would act on.
//
// What used to be here and is not any more: "0/4 floor cuts", which is our word
// for how many grave holes the floor shader is carrying and is a fact about the
// renderer rather than about the level; "N spawns", from when an author placed
// them; and "geometry ok", which said that one of three checks had passed while
// the other two were still running and read as a verdict on all of them. A
// status that is always the same, or that nobody can act on, is a line of
// permanent furniture.
function drawStatus() {
  const errors = report ? report.errors.length : 0;
  const unfair = fair.fail.length;
  const flies = world ? world.fireflies().length : 0;
  const apart = world ? world._derived.flies.spacing.toFixed(0) : 0;
  const checking = review.stale || fair.stale;
  const wrong = errors + (review.stale ? 0 : review.errors.length) + unfair;
  // HOW MANY HEADSTONES A SKELETON CAN ACTUALLY CLIMB OUT OF. This is the
  // number an author most needs and would never guess: a stone only counts if
  // the ground in front of it is clear, and stones in a tidy row two metres
  // apart block each other. A beautiful graveyard with no monsters in it is the
  // failure this line exists to prevent.
  const spawns = world ? world.spawns().length : 0;
  statusEl.innerHTML = [
    `<b>${doc.props.length}</b> things · <b>${spawns}</b> stones a skeleton can climb out of · `
      + `<b>${flies}</b> fireflies, ${apart} apart`,
    checking ? 'checking whether it can be played...'
      : wrong
        ? `<span class="bad">${wrong} thing${wrong === 1 ? '' : 's'} to fix before it can be played</span>`
        : '<span class="ok">ready to play</span>',
    message ? `<span class="say">${escapeHtml(message)}</span>` : '',
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
  'a fence snaps to what is already there, to square, and to whole panels: <b>alt</b> frees it',
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

// WHAT IS LEFT IN THE FRAME LOOP, which is as close to nothing as it goes.
//
// The palette's pictures used to be pumped from here, one prop build a frame,
// and it was measured at 2,787 ms of 3,117 across twenty pointer moves --
// eighty nine per cent of the cost of moving the mouse -- because the guard was
// "not dragging and not editing" and moving the pointer with a palette item
// picked is neither. It does not live here at all any more: a group is drawn in
// chunks off a timer when it is opened. See drawGroupThumbs.
//
// What remains is the ground brush, and it only does anything while the brush
// is down. The spawn badges used to be here too and are gone with the thing
// they named. So on a frame in which nothing is being painted this costs a
// property read and returns, and the scene itself only draws when something
// has changed.
scene.onFrame = () => {
  if (paintDirty) flushPaint();
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
  fencePreview: (x, z, free) => fencePreview(x, z, free),
  wallSections: () => wallSections(doc.wall),
  thumbsDrawn: () => thumbs.size,
  thumbsBusy: () => drawing.size,
  scene,
  serialize: () => serializeLevel(doc),
  format: LEVEL_FORMAT,
};
window.__editorReady = true;
