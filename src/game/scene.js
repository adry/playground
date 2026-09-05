// The game, on screen.
//
//   /lab/?game=1
//
// This is the third page in the project and the first one you can lose. The
// other two are a free-roam graveyard and an asset lineup; this one builds a
// generated level, runs the rules over it and draws the result.
//
// The division of labour is the whole design and it is worth stating once:
//
//   src/game/layout/  decides WHERE everything is. Headless, no three.
//   src/game/rules.js decides WHAT HAPPENS. Headless, no three.
//   this file         decides what it LOOKS LIKE, and owns nothing else.
//
// Nothing here may make a gameplay decision. If this file ever needs to know
// whether the ghost has been caught, it reads it out of `state`; it never works
// it out. That rule is what let the rules be proved over 3000 levels and a few
// hundred simulated minutes before a single triangle was drawn, and it is worth
// more than any convenience gained by breaking it.
//
// The corollary is that both halves integrate a position, and the rules' one
// wins. See placeGhost below, which is the one genuinely delicate thing here.

import * as THREE from 'three';
import { createGround, addGroundHole } from '../ghost/ground.js';
import { Ghost } from '../ghost/ghost.js';
import { Input } from '../ghost/input.js';
import { createLayout } from './layout/index.js';
import { createGame, TUNING } from './rules.js';
import {
  waveTuning, waveCells, waveSeed, clearBonus,
  loadBoard, submitScore, shareUrl, shareText,
} from './run.js';
import { createTombstone } from '../ghost/props/stones/index.js';
import { createPumpkin } from '../ghost/props/pumpkin.js';
import { createFenceRun } from '../ghost/props/fence/panel.js';
import { createFireflies } from '../ghost/props/fireflies.js';
import { createSkeletonRig } from '../ghost/props/skeleton/model.js';
import { createSkeletonPerformance } from '../ghost/props/skeleton/perform.js';
import { createGraveHole } from '../ghost/props/ground/hole.js';
import { createSandPath } from '../ghost/props/ground/sandpath.js';
import { createPropCache, createPropField } from '../ghost/props/instancing.js';

const D = Math.PI / 180;

// A small string hash, so a cache key is also its own seed. Nothing subtle: it
// only has to spread and to be the same number every run.
function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function startGame({ canvas, params }) {
  const seed = Number(params.get('seed')) || 1;
  const testMode = params.get('test') === '1';
  // Fewer props than a full level while this page is young: a 7 by 5 level
  // carries 110 props plus 350 fireflies plus four skeletons, and the point of
  // the first playable build is to find out whether it PLAYS, which a smaller
  // level answers just as well and a great deal faster.
  const cells = (params.get('cells') || '5,4').split(',').map(Number);

  // A RUN is a sequence of waves. Everything about the level lives in `world`
  // below and is thrown away between waves; everything about the run outlives
  // them. Keeping the two apart is what makes "endless" a small change rather
  // than a rewrite: a wave has no idea it is not the first.
  const runSeed = seed;
  const run = {
    seed: runSeed,
    wave: 1,
    cleared: 0,
    score: 0,
    lives: TUNING.lives,
    fireflies: 0,
    eaten: 0,
    time: 0,
    caughtBy: null,
    over: false,
  };
  // The override is for the harness and for anyone who wants a particular size;
  // otherwise the curve decides, and it grows.
  const fixedCells = params.get('cells') ? [cells[0] || 5, cells[1] || 4] : null;

  let layout = null;
  let game = null;
  let world = null;

  // --- renderer, copied from ghost/main.js -----------------------------------
  // Deliberately copied rather than shared. main.js's rig is tangled with its
  // own scene's needs and pulling it into a module would mean changing the page
  // that is already shipped, on a night when this page does not work yet.
  // Whichever of the two survives should own the rig; today neither does.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(testMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9bec7').convertSRGBToLinear();

  const hemi = new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const LIGHT_DIR = new THREE.Vector3(3.7, 6.0, 2.4).normalize();
  const LIGHT_OFFSET = LIGHT_DIR.clone().multiplyScalar(26);

  // --- camera ----------------------------------------------------------------
  // Looser than the free-roam scene's 6.2. A maze you cannot see the junctions
  // of is a maze you cannot plan in, and Pac-Man is a game of seeing the whole
  // board. This is the one number most likely to want tuning by eye.
  const VIEW = Number(params.get('view')) > 0 ? Number(params.get('view')) : 9.0;
  const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  // Set properly by startWave, which is the only thing that knows where a
  // maze puts the ghost. It cannot read `layout` here: there is no layout
  // until a wave starts.
  const camTarget = new THREE.Vector3(0, 0.75, 0);

  function placeCamera() {
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, 40);
    camera.lookAt(camTarget);
    key.position.copy(camTarget).add(LIGHT_OFFSET);
    key.target.position.copy(camTarget).setY(0);
    key.target.updateMatrixWorld();
  }

  // The tallest thing that can cast into the frame. The obelisk is 1.85 and the
  // skeleton 2.5; 3.2 is those with room over the top. It only decides how far
  // OUTSIDE the visible floor a caster still has to be drawn, so being generous
  // here is cheap and being mean is a shadow that pops in at the frame edge.
  const CASTER_HEIGHT = 3.2;

  let shadowTexel = 0.01;

  // How big the shadow box actually has to be.
  //
  // It was VIEW * aspect * 2.6, copied from main.js, and 2.6 is a number that
  // covers the floor with a lot to spare -- 29 units of half extent at this
  // view against the 20 the frame can actually see. Everything inside that box
  // is drawn again into the shadow map, so the spare is paid for twice: once in
  // draw calls for casters that could never appear, and once in resolution,
  // because 2048 texels spread over a box half again too big are half again too
  // coarse.
  //
  // So it is fitted rather than guessed. The four corners of the camera's
  // frustum are dropped onto the floor to give the quad the player can actually
  // see, that quad is lifted to CASTER_HEIGHT, and the eight points are
  // measured in the LIGHT's own frame. The answer is the smallest box that
  // cannot clip a shadow belonging to anything on screen.
  //
  // It stays SQUARE on purpose even though the fitted quad is not. The snapping
  // in follow() rounds the light's target to a whole shadow texel to stop every
  // shadow edge crawling as the camera moves, and one texel size is what that
  // code is written against. A rectangle would buy perhaps a fifth more and
  // wants the snap done per axis in light space; it is a fair next step, not a
  // free one.
  const fitReach = (aspect) => {
    const cam = new THREE.OrthographicCamera(-VIEW * aspect, VIEW * aspect, VIEW, -VIEW, 0.1, 200);
    cam.position.copy(CAM_DIR).multiplyScalar(40);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    // The light's frame, built the same way three builds the shadow camera's:
    // it looks from the offset back at the target, so its basis is fixed and
    // only its position follows the player.
    const lamp = new THREE.Object3D();
    lamp.position.copy(LIGHT_OFFSET);
    lamp.lookAt(0, 0, 0);
    lamp.updateMatrixWorld();
    const toLight = lamp.matrixWorld.clone().invert();
    const p = new THREE.Vector3();
    let reach = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const corner = new THREE.Vector3(sx, sy, -1).unproject(cam);
        // Onto the floor. A frustum corner and the floor always meet: this
        // camera looks down at 29 degrees and cannot be levelled.
        corner.addScaledVector(forward, -corner.y / forward.y);
        for (const y of [0, CASTER_HEIGHT]) {
          p.set(corner.x, y, corner.z).applyMatrix4(toLight);
          reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
        }
      }
    }
    return reach;
  };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.left = -VIEW * aspect;
    camera.right = VIEW * aspect;
    camera.top = VIEW;
    camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const reach = fitReach(aspect);
    key.shadow.camera.left = -reach;
    key.shadow.camera.right = reach;
    key.shadow.camera.top = reach;
    key.shadow.camera.bottom = -reach;
    key.shadow.camera.updateProjectionMatrix();
    shadowTexel = (2 * reach) / 2048;
  }

  // --- the floor -------------------------------------------------------------
  const ground = createGround({ fadeStart: 60, fadeEnd: 260 });
  scene.add(ground);

  // --- the prop cache --------------------------------------------------------
  //
  // Built once for the RUN, not once for the wave, and that is the whole point:
  // a stone costs about half a second to build, almost all of it baking a
  // thousand-row canvas and walking it pixel by pixel to make a normal map, and
  // a wave that builds fifty-seven of them spends half a minute doing it. Waves
  // two onward now build none.
  //
  // The power pellets live here for the same reason as the skeleton rigs:
  // built once for the run and moved between waves. Parented straight to the
  // scene, so a wave's teardown cannot take them with it.
  const lanternHome = new THREE.Group();
  lanternHome.userData.perf = 'lantern';
  scene.add(lanternHome);
  const lanterns = [];
  function ensureLanterns(n) {
    while (lanterns.length < n) {
      // createPumpkin has no unlit mode: every one carries its candle, which is
      // exactly what a power pellet wants.
      const made = createPumpkin({ variant: 'classic', seed: 40 + lanterns.length });
      lanternHome.add(made.group);
      lanterns.push(made);
    }
  }

  // SLOTS is the compromise and it should be read as one. Two props sharing a
  // key are bit-identical -- same lean, same mottle, same worn letters -- so
  // this is how much per-casting variety survives.
  //
  // It is spent carefully rather than hashed, and the first version of this got
  // it wrong in a way worth recording. Folding the placement's seed down with a
  // hash gives every prop an independent 1-in-SLOTS chance of colliding with
  // every other of its variant, and a level with two calvary crosses in it duly
  // came back with two IDENTICAL calvary crosses five units apart, in frame
  // together -- which is precisely the failure that got stones sent back while
  // the set was being built. The slot is now the prop's OCCURRENCE within its
  // variant, so the first SLOTS castings of any variant are guaranteed to
  // differ, and this level -- whose commonest variant appears four times -- has
  // no repeat in it at all.
  //
  // Six rather than four for headroom on a bigger level. A slot costs one bake
  // and about 2.8 MB of texture, and only for a variant that actually reaches
  // it; slots no level uses cost nothing. When a level finally does force a
  // repeat it is between the seventh casting of a variant and the first, not
  // between any two of them.
  const SLOTS = 6;
  const propCache = createPropCache({
    build(key) {
      const [kind, variant, slot] = key.split('|');
      // The seed is the KEY's, not the placement's, or a cached prop would
      // depend on which of its placements happened to be built first and a
      // chunk rebuilt in a different order would come back looking different.
      const seed = (hashKey(key) & 0x7fffffff) || 1;
      if (kind === 'stone') return createTombstone({ variant, seed });
      if (kind === 'pumpkin') return createPumpkin({ variant, seed });
      return null;
    },
  });

  // --- one wave's world ------------------------------------------------------
  //
  // Everything between here and disposeWorld belongs to ONE maze and is torn
  // down when it is cleared. The floor, the renderer, the camera and the ghost
  // are not in here: they belong to the run, and rebuilding the ghost would
  // mean rebuilding its cloth, which is a second of settling the player would
  // watch every time they cleared a maze.
  function buildWorld(lay) {
    const t0 = performance.now();
    const group = new THREE.Group();
    scene.add(group);
    const built = { group, flies: null, lanterns: [], holes: [], parts: [], buildMs: 0 };
    // Named buckets so the perf probe can attribute a draw call to a thing
    // rather than to the scene as a whole. They cost one Group each and nothing
    // per frame; the alternative is guessing which half of 1229 is the fence.
    const bucket = (name) => {
      const g = new THREE.Group();
      g.userData.perf = name;
      group.add(g);
      return g;
    };
    const fenceBucket = bucket('fence');
    const pathBucket = bucket('path');
    const propBucket = bucket('prop');
    const flyBucket = bucket('flies');
    // The lanterns are the run's, not the wave's, so their group is not one of
    // this wave's children. It is still named here so the probe can charge
    // their draw calls to them.
    built.buckets = {
      fence: fenceBucket, path: pathBucket, prop: propBucket, flies: flyBucket, lantern: lanternHome,
    };
    // Per-bucket build cost. A chunk that streams in mid-run is a hitch or it
    // is not, and knowing which of these five is the hitch is the difference
    // between fixing it and rewriting all of it.
    const spent = { fence: 0, path: 0, prop: 0, flies: 0, lantern: 0 };
    let mark = performance.now();
    const charge = (name) => { const t = performance.now(); spent[name] += t - mark; mark = t; };
    built.spent = spent;

    // Walls are whole fence runs, which is why the lattice is the panel's own
    // length: `panels` is an integer and no panel is ever cut.
    //
    // The placements are collected first and handed to createFenceRun in one
    // go. It was a panel at a time, which meant 138 props, 1518 meshes and
    // 1116 draw calls in the camera pass alone for a fence that is one object
    // repeated. See createFenceRun: same panels, same places, six geometries
    // and a dozen instanced draws.
    const panels = [];
    for (const wall of lay.walls) {
      for (let i = 0; i < wall.panels; i++) {
        const t = (i + 0.5) / wall.panels;
        panels.push({
          x: wall.a.x + (wall.b.x - wall.a.x) * t,
          z: wall.a.z + (wall.b.z - wall.a.z) * t,
          yaw: wall.yaw,
          seed: (wall.panels * 31 + i * 7) | 0,
        });
      }
    }
    const fence = createFenceRun({ panels });
    fenceBucket.add(fence.group);
    built.parts.push(fence);

    charge('fence');

    // Paths, which are what make a corridor legible as a corridor rather than
    // as the gap between two fences.
    for (const [i, ribbon] of (lay.paths || []).entries()) {
      if (!ribbon || ribbon.length < 2) continue;
      const path = createSandPath({ seed: 7 + i, width: 1.35, points: ribbon });
      pathBucket.add(path.group);
      built.parts.push(path);
    }

    charge('path');

    // Stones and pumpkins go through the cache and come out as instances; a
    // grave hole does not, because it cuts the floor and the floor outlives the
    // wave. Anything else the layout emits that this page cannot build yet is
    // skipped rather than guessed at. The level is still valid: a missing bench
    // changes nothing about whether a corridor is clear.
    const placements = [];
    // How many of each variant this chunk has placed. See SLOTS: the count IS
    // the slot, so two castings of a variant cannot share a bake until the
    // chunk has run out of slots to give them.
    const seen = new Map();
    for (const p of lay.props) {
      if (p.kind === 'stone' || p.kind === 'pumpkin') {
        const variant = `${p.kind}|${p.variant}`;
        const n = seen.get(variant) || 0;
        seen.set(variant, n + 1);
        placements.push({ key: `${variant}|${n % SLOTS}`, x: p.x, z: p.z, yaw: p.yaw || 0 });
        continue;
      }
      if (p.kind === 'hole' && built.holes.length < 4) {
        const made = createGraveHole({ seed: (p.x * 331) | 0 });
        built.holes.push(made);
        made.group.position.set(p.x, 0, p.z);
        made.group.rotation.y = p.yaw || 0;
        propBucket.add(made.group);
        built.parts.push(made);
        // A hole cuts the FLOOR, which outlives the wave, so its cut has to be
        // taken back on teardown or the next maze inherits four holes in the
        // wrong places and the fifth registration throws.
        if (made.registerWith) made.registerWith(ground);
      }
    }
    const field = createPropField({ placements, cache: propCache });
    propBucket.add(field.group);
    built.parts.push(field);

    charge('prop');

    // One field for the whole level: one draw call however many there are, and
    // collect(i) indexes it by the same i the rules use.
    built.flies = createFireflies({ seed: 5, points: lay.fireflies });
    flyBucket.add(built.flies.group);

    charge('flies');

    // The power pellets, moved rather than rebuilt. A lit jack-o'-lantern is
    // the brightest object in the scene, which is the joke and also why they
    // read from across a level -- and it is three seconds of building, every
    // one of which the player would watch again at every wave for four objects
    // that are the same four objects. Same argument as the skeleton rigs above.
    ensureLanterns(lay.powerups.length);
    for (let i = 0; i < lanterns.length; i++) {
      const p = lay.powerups[i];
      lanterns[i].group.visible = !!p;
      if (p) lanterns[i].group.position.set(p.x, 0, p.z);
    }
    built.lanterns = lanterns.slice(0, lay.powerups.length);

    charge('lantern');
    built.buildMs = performance.now() - t0;
    return built;
  }

  function disposeWorld(w) {
    if (!w) return;
    // The floor's cuts first, and before anything is disposed: addGroundHole
    // recompiles the ground material by hole count, and a hole left registered
    // against a disposed geometry would be a cut nothing can take back.
    for (const h of w.holes) h.dispose?.();
    for (const p of w.parts) if (p !== w.holes[0]) p.dispose?.();
    w.flies?.dispose?.();
    // NOT the lanterns. They belong to the run and the next wave moves them.
    scene.remove(w.group);
  }

  // --- the ghost -------------------------------------------------------------
  // Built once for the whole run. See placeGhost.
  const ghost = new Ghost({ seed: 12345 });
  // The visual ghost integrates the SAME model as the rules at the SAME speed,
  // so the correction applied below is a few millimetres a frame everywhere
  // except at a wall. Leaving it at 4.5 would make the sheet fight the rules
  // continuously and read as drag.
  ghost.opts.maxSpeed = TUNING.ghostSpeed;
  scene.add(ghost.mesh);

  // Both halves integrate a position and the rules' one wins, because it is the
  // one that collides with walls and the one the skeletons chase. But the cloth
  // solves in WORLD space off this.matrix, so teleporting the anchor tears the
  // sheet. So the ghost is stepped normally, with the real input, and then its
  // anchor is corrected onto the rules' answer. Away from walls the two agree
  // to within a millimetre and the correction is invisible; at a wall the rules
  // stop and this is what stops the sheet walking through it.
  function placeGhost(st) {
    ghost.pos.x = st.ghost.x;
    ghost.pos.z = st.ghost.z;
    // The velocity has to be corrected too, or the body keeps its momentum
    // into the wall, the flare and the trail keep reporting a run, and the
    // ghost reads as sprinting on the spot.
    ghost.vel.x = st.ghost.vx;
    ghost.vel.z = st.ghost.vz;
  }

  // --- the skeletons ---------------------------------------------------------
  // Built once for the whole run and moved between waves. perform.js owns the
  // figure and the gait; the rules own where it is, through the `driver` hook.
  // Rebuilding four rigs every wave would be the most expensive thing on the
  // page and would buy nothing: they are the same four skeletons.
  const rigs = [];
  function ensureRigs(n) {
    while (rigs.length < n) {
      const i = rigs.length;
      const rig = createSkeletonRig();
      scene.add(rig.group);
      let want = null;
      const perf = createSkeletonPerformance({
        rig, scene, renderer, seed: 5 + i, driver: () => want,
      });
      rigs.push({ rig, perf, set: (w) => { want = w; } });
    }
  }

  // How a rules state maps onto a performance phase. 'leaving' is the walk out
  // of the pen and it is already a walk, so it drives like a hunt.
  const PHASE = {
    buried: 'buried',
    emerging: 'emerging',
    leaving: 'chasing',
    hunting: 'chasing',
    frightened: 'chasing',
    eaten: 'chasing',
    sinking: 'settling',
  };

  // --- starting a wave -------------------------------------------------------
  function startWave(wave) {
    disposeWorld(world);
    const tuning = waveTuning(wave);
    layout = createLayout({
      seed: waveSeed(runSeed, wave),
      cells: fixedCells || waveCells(wave),
    });
    world = buildWorld(layout);
    game = createGame({ layout, seed: waveSeed(runSeed, wave), tuning });
    // The run's lives, not a fresh three. This is the whole of what makes a run
    // a run rather than a sequence of games.
    game.state.lives = run.lives;

    ensureRigs(game.state.skeletons.length);
    for (let i = 0; i < game.state.skeletons.length; i++) {
      const s = game.state.skeletons[i];
      rigs[i].perf.reset();
      rigs[i].perf.moveHome(s.grave.x, s.grave.z, 0);
    }

    ghost.pos.set(layout.spawns.ghost.x, ghost.pos.y, layout.spawns.ghost.z);
    ghost.vel.set(0, 0, 0);
    // The sheet has to be told, or it stretches across the whole graveyard from
    // wherever the last maze left it.
    ghost.cloth.reset(ghost.matrix);
    camTarget.set(layout.spawns.ghost.x, 0.75, layout.spawns.ghost.z);
    placeCamera();
  }

  // --- HUD and the end card --------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.appendChild(hud);
  const card = document.createElement('div');
  card.className = 'card';
  card.hidden = true;
  document.body.appendChild(card);

  let lastHud = '';
  function drawHud(st) {
    // The run's score, not the wave's: a player deep in a run should never see
    // a number go backwards because a new maze started.
    const score = run.score + st.score;
    const line = `WAVE ${run.wave}   ${score.toLocaleString('en-US')}   ${'\u25cf'.repeat(Math.max(0, st.lives))}   ${st.fireflies.remaining} left`;
    const text = st.power ? `${line}   POWER` : line;
    if (text !== lastHud) { hud.textContent = text; lastHud = text; }
  }

  function showCard() {
    const place = submitScore({
      score: run.score,
      wave: run.wave,
      cleared: run.cleared,
      fireflies: run.fireflies,
      eaten: run.eaten,
      seed: run.seed,
      duration: Math.round(run.time),
      caughtBy: run.caughtBy,
    });
    const board = loadBoard();
    const url = shareUrl(
      { ...run, remaining: game.state.fireflies.remaining },
      `${location.origin}${location.pathname}?game=1`,
    );

    card.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = place === 1 ? 'BEST RUN' : 'CAUGHT';
    card.appendChild(h);

    const story = document.createElement('p');
    story.className = 'story';
    story.textContent = shareText({ ...run, remaining: game.state.fireflies.remaining });
    card.appendChild(story);

    if (board.length) {
      const ol = document.createElement('ol');
      ol.className = 'board';
      for (const row of board) {
        const li = document.createElement('li');
        li.textContent = `${row.score.toLocaleString('en-US')}   maze ${row.wave}`;
        // The row just played is marked rather than the top one, because the
        // question a player has is "where did THIS go", not "what is the best".
        if (row.at === board.find((r) => r.seed === run.seed && r.duration === Math.round(run.time))?.at) {
          li.className = 'mine';
        }
        ol.appendChild(li);
      }
      card.appendChild(ol);
    }

    const share = document.createElement('a');
    share.className = 'share';
    share.href = url;
    share.target = '_blank';
    share.rel = 'noopener noreferrer';
    share.textContent = 'Post it on X';
    card.appendChild(share);

    const again = document.createElement('button');
    again.className = 'again';
    again.type = 'button';
    again.textContent = 'Again';
    again.addEventListener('click', () => { card.hidden = true; newRun(); });
    card.appendChild(again);

    card.hidden = false;
  }

  function newRun() {
    run.wave = 1;
    run.cleared = 0;
    run.score = 0;
    run.lives = TUNING.lives;
    run.fireflies = 0;
    run.eaten = 0;
    run.time = 0;
    run.caughtBy = null;
    run.over = false;
    // A new maze, not the same one again. Replaying an identical level after
    // losing is the thing that makes a roguelike feel like a test rather than a
    // game, and the generator is free.
    run.seed = (Math.random() * 0xffffffff) >>> 0;
    startWave(1);
  }

  // --- input and loop --------------------------------------------------------
  startWave(1);
  const input = new Input(canvas, camera);
  placeCamera();
  resize();
  window.addEventListener('resize', resize);

  function follow(dt) {
    const k = 1 - Math.exp(-dt * 5.6);
    camTarget.x += (ghost.pos.x - camTarget.x) * k;
    camTarget.z += (ghost.pos.z - camTarget.z) * k;
    placeCamera();
    // Snap the light's target to whole shadow texels, or the map slides under
    // the geometry as the camera follows and every shadow edge crawls.
    const snap = Math.max(1e-4, shadowTexel);
    key.target.position.set(
      Math.round(camTarget.x / snap) * snap,
      0,
      Math.round(camTarget.z / snap) * snap,
    );
    key.position.copy(key.target.position).add(LIGHT_OFFSET);
    key.target.updateMatrixWorld();
  }

  let time = 0;
  let scripted = null;
  function advance(dt) {
    time += dt;
    if (!run.over) run.time += dt;
    // input.sample takes the ghost's position because the drag control is
    // relative to where the ghost is on screen. `override` is the harness's
    // way in: a capture script drives a scripted stick and must not be
    // fighting a mouse that is not there.
    const axis = scripted || input.sample(ghost.pos);
    const st = game.update(dt, axis);

    ghost.update(dt, axis);
    placeGhost(st);

    for (let i = 0; i < st.skeletons.length; i++) {
      const s = st.skeletons[i];
      const r = rigs[i];
      if (!r) continue;
      r.perf.setPhase(PHASE[s.state] || 'chasing');
      r.set({ x: s.x, z: s.z, yaw: s.yaw, dist: Math.hypot(s.x - st.ghost.x, s.z - st.ghost.z) });
      r.perf.update(dt, null);
    }

    // The cue list. The rules never touch a mesh, so this is the only place a
    // firefly is told it has been eaten, and the only place the run's totals
    // are added up. Reading them off `state` at the end would lose everything
    // that happened in a maze that was cleared and thrown away.
    for (const e of st.events) {
      if (e.type === 'firefly') { world.flies.collect(e.index); run.fireflies += 1; }
      else if (e.type === 'power' && world.lanterns[e.index]) world.lanterns[e.index].group.visible = false;
      else if (e.type === 'eat') run.eaten += 1;
      else if (e.type === 'death') run.caughtBy = e.by;
    }

    world.flies.update(time, dt);
    for (const l of world.lanterns) l.update?.(time, dt);
    follow(dt);
    drawHud(st);

    // --- the endless part ----------------------------------------------------
    // Both of these are read off `state`, never worked out here. A maze is
    // cleared when the rules say so and a run is over when the rules say so.
    if (st.phase === 'cleared') {
      run.score += st.score + clearBonus(run.wave);
      run.cleared += 1;
      run.lives = st.lives;
      run.wave += 1;
      startWave(run.wave);
    } else if (st.phase === 'over' && !run.over) {
      run.over = true;
      run.score += st.score;
      run.lives = 0;
      showCard();
    }
  }

  let live = !testMode;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!live) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    advance(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // The harness hook, same shape as the other two pages so the capture scripts
  // can drive this one too.
  window.__game = {
    setSize(w, h) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; resize(); },
    step(dt = 1 / 60, axis = null) {
      live = false;
      scripted = axis;
      advance(dt);
      renderer.render(scene, camera);
    },
    state: () => game.state,
    run: () => ({ ...run }),
    board: () => loadBoard(),
    share: () => shareUrl({ ...run, remaining: game.state.fireflies.remaining }, ''),
    get layout() { return layout; },
  };
  // For the performance probe. renderer.info is the only honest source for
  // draw calls and texture count, and it cannot be reached from outside.
  window.__renderer = renderer;
  window.__perf = {
    scene,
    camera,
    // How long the last wave's props took to build, which is the number that
    // decides whether a streamed chunk is a hitch or not.
    buildMs: () => world?.buildMs ?? 0,
    buildParts: () => {
      const s = world?.spent || {};
      return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(1)]));
    },
    // Rebuild the same wave, so the build can be timed more than once without
    // a page reload changing the level under the measurement.
    rebuild() { startWave(run.wave); return world.buildMs; },
    // The named buckets buildWorld parents its work under.
    buckets: () => world?.buckets || {},
  };
  window.__gameReady = true;
}
