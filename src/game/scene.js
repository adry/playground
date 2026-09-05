// The game, on screen.
//
//   /lab/?game=1                          the level the site ships, which is
//                                         /levels/demo.json and was authored
//   /lab/?game=1&level=<url>              some other authored level
//   /lab/?game=1&level=session            whatever /editor/ has open, which is
//                                         what its play button opens and is
//                                         the whole of the authoring loop
//   /lab/?game=1&seed=7                   a generated arena. The developer's
//                                         door, and the only one left.
//
// This is the third page in the project and the first one you can lose. The
// other two are a free-roam graveyard and an asset lineup; this one builds a
// level, runs the rules over it and draws the result.
//
// A LEVEL FROM A FILE, which is now the ordinary case. The document answers
// exactly the queries the generator answers -- see src/game/level/format.js, whose whole promise is that one
// sentence -- so the rules half, the navigation and the audit cannot tell the
// difference and none of them has a branch in it. What DOES differ is what is
// drawn: a file carries painted ground cover, a wall variant with style
// changes along it and props of every kind in the palette, and the generator
// carries none of those. Those differences are
// marked `authored` below and nowhere else.
//
// It is still the only door between the editor and a page that ships: the URL
// has to be typed, /editor/ writes only to its own localStorage and to a file
// the owner downloads, and nothing here reads either.
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
// wins. See driveGhost below, which is the one genuinely delicate thing here.

import * as THREE from 'three';
import { createGround, addGroundHole } from '../ghost/ground.js';
import { Ghost } from '../ghost/ghost.js';
import { Input } from '../ghost/input.js';
import { createWorld } from './world/index.js';
import { createWalledLevel, createWall, createVoid } from '../ghost/props/fence/wall.js';
import { createGame, TUNING } from './rules.js';
import {
  loadBoard, submitScore, shareUrl, shareText,
} from './run.js';
// THE SHARED BOARD AND THE PUBLISHED LEVELS, both of them additive and both of
// them allowed to be missing. isLevelSlug is the rule that tells a published
// level's code from a file URL; see src/net/supabase.js, which owns both ends
// of it. Nothing in either import is on the path of a game that has no network.
import { isLevelSlug, fetchPublishedDoc } from '../net/supabase.js';
import * as boards from '../net/leaderboard.js';
import { createShareRecorder } from './share.js';
import { createTombstone } from '../ghost/props/stones/index.js';
import { createPumpkin } from '../ghost/props/pumpkin.js';
import { createFenceRun } from '../ghost/props/fence/panel.js';
import { createFireflies } from '../ghost/props/fireflies.js';
import { createSkeletonRig } from '../ghost/props/skeleton/model.js';
import { createSkeletonPerformance } from '../ghost/props/skeleton/perform.js';
import { createZombieRig } from '../ghost/props/zombie/model.js';
import { createZombiePerformance } from '../ghost/props/zombie/perform.js';
import { createGraveHole } from '../ghost/props/ground/hole.js';
import { createPropCache, createPropField } from '../ghost/props/instancing.js';
import { createFrameHud } from './frame-hud.js';

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
  // Frame-time readout. Off unless asked for, and F2 toggles it at any time.
  const fperf = createFrameHud({
    enabled: params.get('perf') === '1',
    buckets: ['sim', 'skels', 'bake', 'props', 'render'],
  });

  // --- the level -------------------------------------------------------------
  //
  // A LEVEL IS A THING A PERSON MAKES, and this line is where the product says
  // so. `level` names one; with no `level` at all the game plays the one the
  // site ships, which is a level somebody authored in /editor/. There is no
  // longer any URL that quietly hands a player a machine-made arena.
  //
  // `?seed=` is what is left of the generator here, and it is the developer's
  // door rather than a fallback: ask for a seed and you get that seed's arena,
  // which is what world-check.mjs and every capture script want and what
  // nobody typing /lab/?game=1 does.
  //
  // Loaded FIRST, before the renderer exists, for two reasons. It is a fetch,
  // so anything built before it would sit idle waiting; and the whole point of
  // knowing the level up front is that its variant set is known up front too.
  // See BAKE, below: every prop template this level will ever need is baked
  // inside startRun(), which runs before the first requestAnimationFrame,
  // and a canvas bake costs about five times more once the renderer has drawn.
  //
  // The four modules behind it are imported here rather than at the top of the
  // file so that a page generating a level never pays for them. Between them
  // they pull in every prop in the palette -- the fountain, the shed, nine
  // lanterns -- which is most of what an authored level can contain and none
  // of what a generated one does.
  const SHIPPED_LEVEL = '/levels/demo.json';
  // Not a URL: the token that means "the document the editor has open". See
  // loadLevelFrom, which is the only thing that knows what to do with it.
  const SESSION = 'session';
  const levelUrl = params.get('level') || (params.get('seed') ? null : SHIPPED_LEVEL);
  let authored = null;
  if (levelUrl) {
    const [format, build, cover, gate, maingate] = await Promise.all([
      import('./level/format.js'),
      import('./level/build.js'),
      import('./level/groundcover.js'),
      import('../ghost/props/fence/gate.js'),
      import('../ghost/props/fence/maingate.js'),
    ]);
    // loadLevelFrom is the format's own door: fetch, normalise, build. A file
    // that is missing or is not a level throws here, before a renderer exists,
    // which is the right place for it to throw.
    //
    // AND IT IS SAID OUT LOUD. A mistyped level URL used to leave a grey canvas
    // and a line in the console, which is the failure /lab/'s own header warns
    // about: a page that is broken has to LOOK broken. It does not fall back to
    // a generated arena either -- somebody who asked for a particular level and
    // silently got a different one is worse off than somebody who got nothing.
    let first;
    try {
      // A PUBLISHED LEVEL IS A CODE, NOT A URL. `level=k3f9qz2mrt` is ten
      // characters somebody was sent; `level=/levels/demo.json` is a file and
      // `level=session` is the editor's own token. isLevelSlug is the whole of
      // the distinction and it cannot be ambiguous: a code has no slash, no dot
      // and no colon, and every URL has at least one of the three. The document
      // that comes back goes through exactly the same normalise-and-build as one
      // read off disk, so nothing downstream can tell where a level came from.
      first = isLevelSlug(levelUrl)
        ? format.createLevelWorld(format.normalizeLevel(await fetchPublishedDoc(levelUrl)))
        : await format.loadLevelFrom(levelUrl);
    } catch (err) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h1>NO LEVEL</h1><p class="story">${levelUrl}\n${err.message}</p>`;
      document.body.appendChild(card);
      throw err;
    }
    authored = {
      // The DOCUMENT is what is kept, not just the world built from it. A wave
      // rebuilds the world from the document so each wave gets its own arrays
      // and nothing a previous wave held can leak into the next. Rebuilding is
      // a pure function of the document, so every wave is the same level down
      // to the last firefly; wave one uses the world already built above.
      doc: first.doc,
      pending: first,
      createLevelWorld: format.createLevelWorld,
      buildLevelProp: build.buildLevelProp,
      createGroundCover: cover.createGroundCover,
      createGate: gate.createGate,
      createMainGates: maingate.createMainGates,
      mainGateOpenings: maingate.mainGateOpenings,
    };
  }

  // A RUN IS ONE ARENA, PLAYED UNTIL YOU ARE CAUGHT.
  //
  // It used to be a sequence of waves: clear the fireflies, get a bonus, get a
  // new maze with faster skeletons. The owner has replaced that with a board
  // that refills for ever, so there is nothing to clear and nothing to progress
  // to, and the only thing that ends a run is the last life. What is left of
  // the wave machinery is `startRun`, which still builds the level once and is
  // still the only thing that knows where the ghost begins.
  const runSeed = seed;
  const run = {
    seed: runSeed,
    score: 0,
    lives: TUNING.lives,
    fireflies: 0,
    time: 0,
    caughtBy: null,
    over: false,
  };
  // The arena is square and bounded. 30 is the owner's maximum, six of the
  // floor's major grid squares a side, and the only reason to pass anything
  // else is a harness wanting a small level to render quickly. An authored
  // level says how big it is and ?size cannot argue with it.
  const arenaSize = authored ? authored.doc.size
    : (Number(params.get('size')) > 0 ? Number(params.get('size')) : 30);

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
  // Set properly by startRun, which is the only thing that knows where the
  // level puts the ghost. It cannot read `layout` here: there is no layout
  // until the run starts.
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

  // The painted ground cover, which only an authored level has. It belongs to
  // the RUN and not to the wave: the document does not change between waves, so
  // rebuilding a few thousand instanced blades every time one is cleared would
  // be paying twice for the same grass. It is parented to the scene rather than
  // to the wave's group for the same reason the lanterns are.
  const cover = authored
    ? authored.createGroundCover({
      ground: authored.doc.ground,
      seed: authored.doc.seed,
      // Which pairs of grounds meet at a row of stones. groundcover.js takes it
      // as an argument rather than reading it off the ground block.
      kerbs: authored.doc.ground.kerbs || null,
    })
    : null;
  if (cover) scene.add(cover.group);

  // --- the prop cache --------------------------------------------------------
  //
  // Built once for the RUN, not once for the wave, and that is the whole point:
  // a stone costs about half a second to build, almost all of it baking a
  // thousand-row canvas and walking it pixel by pixel to make a normal map, and
  // a wave that builds fifty-seven of them spends half a minute doing it. Waves
  // two onward now build none.
  //
  // THE FOUR LIT JACK-O'-LANTERNS USED TO LIVE HERE, built once for the run and
  // moved between waves for the same reason the skeleton rigs are. They were
  // the power pellet and the owner has taken the pellet out of the game, so
  // there is nothing to build and nothing to move. A pumpkin an author places
  // by hand is an ordinary prop and goes through buildLevelProp with the rest.

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
  // differ. The measured level places 28 stones across 16 variants and never
  // more than three of any one, so at six slots it has no repeated bake in it
  // at all -- every stone is still its own, and the cache still makes the next
  // wave free.
  //
  // Six rather than four for headroom on a bigger level. A slot costs one bake
  // and about 2.8 MB of texture, and only for a variant that actually reaches
  // it; slots no level uses cost nothing. When a level finally does force a
  // repeat it is between the seventh casting of a variant and the first, not
  // between any two of them.
  // How long a frame may spend baking prop templates it did not have. A single
  // bake overruns this -- it is one pass over a canvas and cannot be split --
  // so the budget decides how MANY are attempted per frame, not how long the
  // frame is.
  const BAKE_BUDGET_MS = 8;

  // SPREADING THE BAKES ACROSS FRAMES IS OFF, and it is off because it was
  // measured and it lost. This is the opposite of what everyone expected,
  // including me, so the numbers are here rather than in a commit message.
  //
  // The idea is sound on its face: a level needs eighteen prop templates, a
  // template is a canvas bake of a few hundred milliseconds, so bake one a
  // frame and the player walks around a graveyard that fills in instead of
  // watching a stall. createPropField implements exactly that and it works.
  //
  // On the page it is ten times worse. Measured at 1000x800, seed 1, same
  // level, the only difference this flag:
  //
  //                       build    worst frame   level complete
  //   all in one frame    7569 ms      4012 ms          4012 ms
  //   one bake a frame    4485 ms     46599 ms         93626 ms
  //
  // The cause is the thing the sand path taught us. A canvas bake costs about
  // five times more when it runs after the renderer has drawn than when it runs
  // in a batch before anything is drawn -- 216 ms a template cold against
  // 1082 ms warm, measured. Interleaving one bake per frame does not spread the
  // cost, it puts EVERY bake in the expensive regime. Baking them back to back
  // pays that penalty once.
  //
  // So the batch stays, and the honest caveat is that all of this is measured
  // on a software rasteriser, where canvas raster and the renderer share a CPU.
  // On a real GPU the two might not contend at all and the spread might win.
  // ?spread=1 turns it on; the numbers above are what to beat.
  const SPREAD = params.get('spread') === '1';

  const SLOTS = 6;
  const propCache = createPropCache({
    build(key) {
      const [kind, variant] = key.split('|');
      // The seed is the KEY's, not the placement's, or a cached prop would
      // depend on which of its placements happened to be built first and a
      // chunk rebuilt in a different order would come back looking different.
      const seed = (hashKey(key) & 0x7fffffff) || 1;
      // ONE PROP SWITCH, not two. This used to name stone and pumpkin itself
      // and return null for everything else, so the day a third kind was
      // instanced it would silently vanish rather than build, and the instanced
      // path skipped buildLevelProp's wind guard and its kind aliases with it.
      // Every level a player can load is authored, so the authored builder is
      // the shipped path; ?seed= keeps its own cheap import below.
      if (authored) return authored.buildLevelProp({ kind, variant }, { seed, allowCut: false });
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
    const built = { group, flies: null, holes: [], parts: [], animated: [], buildMs: 0 };
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
    const propBucket = bucket('prop');
    const flyBucket = bucket('flies');
    built.buckets = {
      fence: fenceBucket, prop: propBucket, flies: flyBucket,
    };
    // Per-bucket build cost. A chunk that streams in mid-run is a hitch or it
    // is not, and knowing which of these five is the hitch is the difference
    // between fixing it and rewriting all of it.
    const spent = { fence: 0, prop: 0, flies: 0 };
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
    //
    // The world publishes barriers as straight segments and marks the four
    // perimeter ones `jumpable: false`. Those are the WALL and they are built
    // by createWalledLevel, not out of fence panels: a hop clears 0.86 and the
    // wall is there precisely so it cannot be cleared. Everything else is
    // fence.
    const panels = [];
    for (const b of lay.barriers(lay.bounds)) {
      if (b.jumpable === false) continue;
      const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
      const count = Math.max(1, Math.round(len / 2.0));
      const yaw = Math.atan2(b.x1 - b.x0, b.z1 - b.z0) + Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        panels.push({
          x: b.x0 + (b.x1 - b.x0) * t,
          z: b.z0 + (b.z1 - b.z0) * t,
          yaw,
          seed: (count * 31 + i * 7) | 0,
        });
      }
    }
    const fence = createFenceRun({ panels });
    fenceBucket.add(fence.group);
    built.parts.push(fence);

    // The perimeter, and the darkness beyond it. One closed loop rather than
    // four runs, because four runs cannot make a corner: see wall.js. It is
    // 3,648 triangles and one draw call for the whole enclosure, which is
    // cheaper than any four props in the level.
    //
    // AN AUTHORED WALL IS BUILT FROM THE FILE'S OWN LOOP, with the file's
    // variant and its style changes on it. The owner picks ashlar, brick,
    // rubble or iron in the editor and marks where the stone changes hands and
    // with what joint, and a game that drew all four the same way would be a
    // game where that choice does nothing. It goes through createWall rather
    // than createWalledLevel because a document's wall is a polyline and need
    // not be the centred rectangle createWalledLevel assumes; `at` on a style
    // change is a distance from points[0], which is what the editor's own
    // preview passes and the same coordinate a gate uses.
    let enclosure;
    if (authored) {
      const spec = authored.doc.wall;
      const points = spec.points.map(([x, z]) => ({ x, z }));
      const ats = spec.gates || [];
      const made = createWall({
        seed: 1,
        points,
        closed: true,
        variant: spec.variant,
        styles: spec.styles && spec.styles.length ? spec.styles : null,
        // THE WAYS IN, and they are holes in what you can SEE and nothing else.
        // The barrier list the rules collide against is derived without them
        // and has never known an opening exists, which is the whole reason a
        // locked gate cannot be a way out of the arena.
        gate: ats.length ? authored.mainGateOpenings(ats) : null,
      });
      const gates = ats.length ? authored.createMainGates({ points, ats, seed: 1 }) : null;
      const dusk = createVoid({
        bounds: {
          x: (lay.bounds.minX + lay.bounds.maxX) / 2,
          z: (lay.bounds.minZ + lay.bounds.maxZ) / 2,
          halfX: (lay.bounds.maxX - lay.bounds.minX) / 2,
          halfZ: (lay.bounds.maxZ - lay.bounds.minZ) / 2,
        },
      });
      const group = new THREE.Group();
      group.add(made.group, dusk.group);
      if (gates) group.add(gates.group);
      enclosure = { group, dispose() { made.dispose?.(); dusk.dispose?.(); gates?.dispose?.(); } };
    } else {
      enclosure = createWalledLevel({
        seed: 1,
        size: lay.bounds.maxX - lay.bounds.minX,
        sizeZ: lay.bounds.maxZ - lay.bounds.minZ,
        centre: {
          x: (lay.bounds.minX + lay.bounds.maxX) / 2,
          z: (lay.bounds.minZ + lay.bounds.maxZ) / 2,
        },
        dark: true,
      });
    }
    fenceBucket.add(enclosure.group);
    built.parts.push(enclosure);

    // The gate leaves, and only for an authored level. A gate the author put
    // in a fence is a thing they placed and expect to see; the generated page
    // has never drawn one and this is not the change that starts.
    if (authored) {
      for (const g of lay.gates(lay.bounds)) {
        const made = authored.createGate({ seed: 6, hingeSide: 'left' });
        made.hinge.rotation.y = -0.5;
        made.group.position.set(g.prop.x, 0, g.prop.z);
        made.group.rotation.y = g.prop.yaw;
        fenceBucket.add(made.group);
        built.parts.push(made);
      }
    }

    charge('fence');

    // Stones and pumpkins go through the cache and come out as instances; a
    // grave hole does not, because it cuts the floor and the floor outlives the
    // wave.
    //
    // EVERYTHING ELSE. On a generated level anything the layout emits that is
    // not one of those three is skipped rather than guessed at, and the level
    // is still valid: a missing bench changes nothing about whether a corridor
    // is clear. On an AUTHORED level a skipped prop is the author's fountain
    // not being there, which is the tool lying about what it made, so the rest
    // go through buildLevelProp -- the project's one prop switch, the same one
    // the editor's preview and the viewer draw with. They are one group each
    // rather than instances: the palette's remaining kinds are placed a handful
    // at a time by hand, and instancing a lone fountain costs more machinery
    // than it saves.
    const placements = [];
    // How many of each variant this chunk has placed. See SLOTS: the count IS
    // the slot, so two castings of a variant cannot share a bake until the
    // chunk has run out of slots to give them.
    const seen = new Map();
    for (const p of lay.props(lay.bounds)) {
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
        continue;
      }
      if (p.kind === 'hole') continue;
      if (!authored) continue;
      const made = authored.buildLevelProp(p, { allowCut: false });
      if (!made) continue;
      made.group.position.set(p.x, 0, p.z);
      made.group.rotation.y = p.yaw || 0;
      propBucket.add(made.group);
      built.parts.push(made);
      // A fountain runs water and a lantern flickers, so the ones that publish
      // an update() are collected and stepped with the rest of the frame.
      if (made.update) built.animated.push(made);
    }
    // The props go in as instances the moment their template exists, and the
    // templates that do not exist yet are BAKED OVER THE FOLLOWING FRAMES
    // rather than in this one. See advance(): a bake is a few hundred
    // milliseconds and cannot be cut in half, so the choice is one stall of
    // several seconds or a handful of slow frames the player can still move
    // through. Every wave after the first finds its templates already built
    // and this costs nothing at all.
    const field = createPropField({ placements, cache: propCache, spread: SPREAD });
    propBucket.add(field.group);
    built.parts.push(field);
    built.field = field;

    // A pumpkin an author places is INSTANCED, so its flame lives on a clone of
    // the template's lights and the template's own update() cannot reach it.
    // The field steps every clone it made; a field with no lit prop in it has an
    // empty list and this costs one call a frame.
    if (field.alive) built.animated.push({ update: (t) => field.update(t) });

    charge('prop');

    // One field for the whole level: one draw call however many there are.
    //
    // THE FIELD IS RECONCILED AGAINST THE RULES, NOT DRIVEN BY EVENTS. See
    // syncFlies below for why, and what it cost to find out.
    //
    // The capacity is the level's own spots plus room for the refill to invent
    // some, which it does whenever the pool cannot supply a spot far enough
    // from the player. Sixteen is well past anything the rules will hold on the
    // board at once and costs nothing: an unlit slot is not drawn, and the
    // per-slot attributes are four floats each.
    const flyList = lay.fireflies(lay.bounds);
    built.flies = createFireflies({
      seed: 5,
      points: flyList,
      capacity: Math.max(16, flyList.length + 10),
    });
    // id -> slot, for the fireflies currently lit. Empty at build time: the
    // first frame's sync fills it from whatever the rules say is on the board.
    built.flySlot = new Map();
    // Slots whose bead is going out, with the clock at which they may be used
    // again. A slot handed straight back would cut the flash off.
    built.flyFree = [];
    // Which slots are standing in for a firefly right now. Kept beside the map
    // rather than derived from it, because the answer is wanted once per new
    // firefly and deriving it is a scan. On the world, not on the module, so a
    // new level starts with every slot free.
    built.flyUsed = new Set();
    flyBucket.add(built.flies.group);

    charge('flies');

    built.buildMs = performance.now() - t0;
    return built;
  }

  function disposeWorld(w) {
    if (!w) return;
    // The floor's cuts first, and before anything is disposed: addGroundHole
    // recompiles the ground material by hole count, and a hole left registered
    // against a disposed geometry would be a cut nothing can take back.
    for (const h of w.holes) h.dispose?.();
    // Every hole is also in `parts`, and the ones past the first were being
    // disposed twice: the guard tested one hole where it meant all of them.
    // Harmless as it happens -- a hole's dispose drops its handle first -- but
    // it is not a thing to rely on.
    const holes = new Set(w.holes);
    for (const p of w.parts) if (!holes.has(p)) p.dispose?.();
    w.flies?.dispose?.();
    scene.remove(w.group);
  }

  // --- the ghost -------------------------------------------------------------
  // Built once for the whole run. See driveGhost.
  const ghost = new Ghost({ seed: 12345 });
  // The visual ghost integrates the SAME model as the rules at the SAME speed,
  // so the correction applied below is a few millimetres a frame everywhere
  // except at a wall. Leaving it at 4.5 would make the sheet fight the rules
  // continuously and read as drag.
  ghost.opts.maxSpeed = TUNING.ghostSpeed;
  scene.add(ghost.mesh);

  // Both halves integrate a position and the rules' one wins, because it is the
  // one that collides with walls and the one the skeletons chase.
  //
  // THIS USED TO BE A CORRECTION AFTERWARDS AND THAT WAS THE WIND.
  //
  // The ghost was stepped normally and its position then overwritten with the
  // rules' answer. Away from walls the two agree to within a millimetre, so as
  // a correction to the BODY it was invisible, and I measured exactly that in
  // an earlier pass and concluded it was harmless. It is not harmless to the
  // CLOTH, which is a different consumer of the same number: a Verlet sheet
  // reads its velocity off how far its anchor moved since the last substep, so
  // a correction between frames arrives as a tug rather than as a correction.
  //
  // The two integrators are the same model with the same numbers and this file
  // already matches the speed. What they do not share is how they cut the frame
  // up: ghost.js takes two substeps of 1/120 and rules.js takes one of 1/60,
  // and explicit Euler is not invariant to that. The gap is up to 1.9 mm every
  // frame, and it was landing on the sheet as a 30 Hz shimmer.
  //
  // So the rules' answer is handed over as a PATH before the step rather than
  // as an assignment after it. `drive` lays it out one share per substep, the
  // body reaches exactly the rules' position by the end of the frame, and the
  // sheet sees a straight line. Nothing about who owns the position changes.
  //
  // Anchor jerk per substep over 20 s of the same stick, p99: /ghostly/ 0.425
  // mm, the game before 2.125 mm, the game now 0.185 mm. Substeps rougher than
  // half a millimetre: 0.9%, 35.1%, 0.5%.
  function driveGhost(st) {
    // Velocity FIRST and separately, because it is not a position: the yaw, the
    // lean and the eyes all read it, and it has to be the rules' answer or the
    // ghost keeps its momentum into a wall, leans into a run it is not making
    // and reads as sprinting on the spot.
    ghost.vel.x = st.ghost.vx;
    ghost.vel.z = st.ghost.vz;
  }

  // --- the skeletons ---------------------------------------------------------
  // Built once for the whole run and moved between waves. perform.js owns the
  // figure and the gait; the rules own where it is, through the `driver` hook.
  // Rebuilding four rigs every wave would be the most expensive thing on the
  // page and would buy nothing: they are the same four skeletons.
  const rigs = [];
  // WHICH SLOTS ARE ZOMBIES. Fixed by index rather than rolled, so a run is the
  // same cast every time and a player learns that the second and fourth things
  // out of the ground are the squat ones. Both figures publish the same joint
  // names and both performances take the same options and answer to the same
  // PHASE map below, so nothing downstream knows or cares which it is holding:
  // that is the whole point of the shared contract, and it is why this is a
  // two line change rather than a second code path.
  const ZOMBIE_SLOT = (i) => i % 2 === 1;

  function ensureRigs(n) {
    while (rigs.length < n) {
      const i = rigs.length;
      const zombie = ZOMBIE_SLOT(i);
      const rig = zombie ? createZombieRig() : createSkeletonRig();
      scene.add(rig.group);
      let want = null;
      const make = zombie ? createZombiePerformance : createSkeletonPerformance;
      const perf = make({
        rig, scene, renderer, seed: 5 + i, driver: () => want,
      });
      rigs.push({
        rig, perf, kind: zombie ? 'zombie' : 'skeleton',
        set: (w) => { want = w; },
        homeId: null, homeX: NaN, homeZ: NaN,
      });
    }
  }

  // How a rules state maps onto a performance phase. 'leaving' is the walk out
  // of the pen and it is already a walk, so it drives like a hunt.
  // A DORMANT skeleton is not in the game at all: it has not been spawned yet
  // or it has burrowed back. perform.js's 'buried' is exactly that pose, the
  // figure under the floor behind its own clip plane, so the two map onto each
  // other and nothing extra has to be hidden.
  const PHASE = {
    dormant: 'buried',
    emerging: 'emerging',
    leaving: 'chasing',
    hunting: 'chasing',
    sinking: 'settling',
  };

  // --- starting the run ------------------------------------------------------
  function startRun() {
    disposeWorld(world);
    if (authored) {
      layout = authored.pending || authored.createLevelWorld(authored.doc);
      authored.pending = null;
    } else {
      layout = createWorld({ seed: runSeed, size: arenaSize });
    }
    world = buildWorld(layout);
    game = createGame({ world: layout, seed: runSeed, skeletons: TUNING.skelMax });
    game.state.lives = run.lives;

    // ONE RIG PER SLOT, AND THE COUNT COMES OFF THE HERD.
    //
    // It used to come off `game.state.skeletons.length`, and that was the bug
    // the owner hit as "no skeletons appear at all". `state.skeletons` is
    // filled in by publish(), which runs inside update(), so immediately after
    // createGame it is an EMPTY ARRAY. ensureRigs(0) built nothing, the frame
    // loop's `if (!r) continue` then skipped every skeleton for the rest of the
    // run, and the game had no monsters in it. It was invisible in every
    // headless test, because the headless tests never build a rig.
    //
    // game.herd.list is the slots themselves and it is the right length before
    // a single frame has run.
    ensureRigs(game.herd.list.length);
    for (let i = 0; i < game.herd.list.length; i++) {
      const s = game.herd.list[i];
      // The marker's own yaw, so the figure climbs out with its back to the
      // stone and its face to the yard. It used to be 0 because a grave had no
      // meaningful facing and the hole was round on screen; a headstone has one
      // and the whole point of the zone is that the climb happens off its face.
      rigs[i].perf.reset();
      rigs[i].perf.moveHome(s.home.x, s.home.z, s.home.yaw || 0);
      rigs[i].homeId = s.home.id;
      rigs[i].homeX = s.home.x;
      rigs[i].homeZ = s.home.z;
    }

    ghost.pos.set(layout.spawn.x, ghost.pos.y, layout.spawn.z);
    ghost.vel.set(0, 0, 0);
    // The sheet has to be told, or it stretches across the whole graveyard from
    // wherever the last maze left it. resetCloth rebuilds the body matrix
    // first: ghost.matrix still describes the PREVIOUS spawn at this point, and
    // resetting against it was pinning the sheet there and dragging it across
    // the arena over the next six frames.
    ghost.resetCloth();
    camTarget.set(layout.spawn.x, 0.75, layout.spawn.z);
    placeCamera();
  }

  // The share picture's ring buffer. See src/game/share.js: it copies the last
  // drawn frame four times a second so that the picture posted to X can be the
  // moment before the run ended rather than the dead ghost after it.
  const shots = createShareRecorder({ canvas, camera, state: () => game.state });

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
    // No wave number, because there are no waves. What a player wants instead
    // is how much of the board is left and how many things are after them,
    // which is the only difficulty signal an endless run has.
    const line = `${score.toLocaleString('en-US')}   ${'\u25cf'.repeat(Math.max(0, st.lives))}`
      + `   ${st.flyRemaining} fireflies   ${'\u2620'.repeat(Math.max(0, st.skeletonsUp))}`;
    if (line !== lastHud) { hud.textContent = line; lastHud = line; }
  }

  function showCard() {
    const place = submitScore({
      score: run.score,
      fireflies: run.fireflies,
      seed: run.seed,
      duration: Math.round(run.time),
      caughtBy: run.caughtBy,
    });
    const board = loadBoard();
    // The link has to come back to the SAME level. The one exception is a
    // level handed over from the editor: `level=session` means "whatever that
    // browser has open", which is nothing at all to anybody else, so a score
    // made while testing shares the level the site ships instead.
    const shareLevel = levelUrl && levelUrl !== SESSION ? `&level=${encodeURIComponent(levelUrl)}` : '';
    const url = shareUrl(
      { ...run, duration: Math.round(run.time) },
      `${location.origin}${location.pathname}?game=1${shareLevel}`,
    );

    card.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = place === 1 ? 'BEST RUN' : 'CAUGHT';
    card.appendChild(h);

    const story = document.createElement('p');
    story.className = 'story';
    story.textContent = shareText({ ...run, duration: Math.round(run.time) });
    card.appendChild(story);

    if (board.length) {
      const ol = document.createElement('ol');
      ol.className = 'board';
      for (const row of board) {
        const li = document.createElement('li');
        // NOT `maze ${row.wave}`, which is what this said until the waves went:
        // a row has carried no wave since a run stopped being a sequence of
        // mazes, so every line on the local board read "maze undefined". How
        // long the run lasted is the fact that is still true and still worth
        // knowing beside the score.
        const secs = Math.max(0, Math.floor(row.duration || 0));
        const lasted = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
        li.textContent = `${row.score.toLocaleString('en-US')}   ${lasted}`;
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

    // Everything additive about the share lives behind this one call, and the
    // anchor above still works exactly as it did if it fails.
    shots.attach(share, { run: { ...run, duration: Math.round(run.time) }, best: place === 1 });

    // THE SHARED BOARD, and the score going to it. Additive in the same way and
    // for the same reason: the card above is finished and about to be shown,
    // this returns at once, and everything it does happens into a card that is
    // already on screen. With no network it draws nothing at all and the card
    // is exactly the card it was before. A run on a published level carries its
    // code, so that level gets a board of its own as well as the global one.
    boards.attach(card, {
      run: {
        score: run.score,
        fireflies: run.fireflies,
        seconds: Math.round(run.time),
        // The run's identity, so a score on the shared board can be checked
        // against the rules later. Both are already here; neither is worked out.
        seed: run.seed,
        caughtBy: run.caughtBy,
      },
      levelSlug: isLevelSlug(levelUrl) ? levelUrl : null,
    });

    card.hidden = false;
  }

  function newRun() {
    run.score = 0;
    run.lives = TUNING.lives;
    run.fireflies = 0;
    run.time = 0;
    run.caughtBy = null;
    run.over = false;
    // A new maze, not the same one again. Replaying an identical level after
    // losing is the thing that makes a roguelike feel like a test rather than a
    // game, and the generator is free. An authored run has one level and gets
    // it again; the seed still turns over, because it is the run's identity on
    // the score board as well as the generator's argument.
    run.seed = (Math.random() * 0xffffffff) >>> 0;
    startRun();
  }

  // --- input and loop --------------------------------------------------------
  startRun();
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

  // --- the fireflies the rules actually have on the board ---------------------
  //
  // THIS USED TO LISTEN FOR THE EATEN EVENT AND IT WAS WRONG, in a way that had
  // the owner reporting the game as "stuck when eating a firefly" twice.
  //
  // The scene built one bead per spot the LEVEL lists and mapped the level's
  // ids onto them once. The rules do not work that way any more: refillFlies
  // tops the board back up from a pool of those spots, drops the pool spot's id
  // and mints its own, and invents a spot outright whenever the pool cannot
  // supply one far enough from the player. Measured over a full run, seed 1: 22
  // fireflies eaten, 16 of them naming a bead that did not exist, 4 putting out
  // a bead somewhere else entirely, 2 correct. So the player ate a firefly, the
  // score moved, and the thing they ate was still glowing in front of them.
  //
  // Reconciling instead of listening cannot drift, whatever the rules do with
  // ids, and the rules are still being changed. The whole contract is now: the
  // rules say where the fireflies are, and the field draws a bead at each.
  //
  // The cost is a loop over at most a handful of entries per frame and two Map
  // lookups each, against a list that changes a few times a minute.
  function syncFlies(st) {
    const flies = world.flies;
    const slotOf = world.flySlot;
    const freed = world.flyFree;
    const usedSlots = world.flyUsed;
    const live = st.fireflies || [];

    // Anything on the board that has no bead yet gets one. A slot is reused
    // only once its take has finished playing, or the flash would be cut off
    // mid-flight by the next firefly appearing in the same slot.
    for (const f of live) {
      if (slotOf.has(f.id)) continue;
      let slot = -1;
      for (let i = 0; i < freed.length; i++) {
        if (freed[i].at <= time) { slot = freed[i].slot; freed.splice(i, 1); break; }
      }
      if (slot < 0) {
        // A slot nothing is standing in. Past the level's own list this is a
        // fresh one, which is exactly the case the capacity exists for.
        for (let i = 0; i < flies.capacity; i++) {
          if (!usedSlots.has(i)) { slot = i; break; }
        }
      }
      if (slot < 0) continue;   // out of slots, which the capacity is chosen to prevent
      usedSlots.add(slot);
      slotOf.set(f.id, slot);
      flies.place(slot, f.x, f.z);
    }

    // And anything with a bead that the rules no longer have is out. Eaten or
    // simply withdrawn, the picture is the same: the bead goes.
    if (slotOf.size > live.length) {
      const onBoard = new Set(live.map((f) => f.id));
      for (const [id, slot] of slotOf) {
        if (onBoard.has(id)) continue;
        flies.collect(slot);
        slotOf.delete(id);
        usedSlots.delete(slot);
        freed.push({ slot, at: time + flies.collectTime });
      }
    }
  }
  let time = 0;
  let scripted = null;
  function advance(dt) {
    // Sampled FIRST. At this point the canvas still holds the last frame drawn
    // and the camera is still the camera that drew it, so the crop share.js
    // works out matches the pixels it copies.
    shots.tick(dt);
    time += dt;
    if (!run.over) run.time += dt;
    // input.sample takes the ghost's position because the drag control is
    // relative to where the ghost is on screen. `override` is the harness's
    // way in: a capture script drives a scripted stick and must not be
    // fighting a mouse that is not there.
    const axis = scripted || input.sample(ghost.pos);
    const st = game.update(dt, axis);

    driveGhost(st);
    ghost.update(dt, axis, st.ghost);
    fperf.mark();

    for (let i = 0; i < st.skeletons.length; i++) {
      const s = st.skeletons[i];
      const r = rigs[i];
      if (!r) continue;
      // WHERE IT CLIMBS OUT OF, pushed across whenever the rules change it.
      //
      // The performance's buried and emerging phases play at `home`, which the
      // driver does not touch: the driver only steers a skeleton that is
      // already above ground. So a skeleton that goes under and comes back up
      // somewhere else has to be told, or the climb plays where it climbed out
      // last time while the rules have it somewhere else entirely.
      //
      // This was survivable when there were four graves and a re-home often
      // picked the same one. It is not survivable now: a skeleton comes up in
      // front of a headstone chosen at random out of as many as twenty, so
      // almost every re-home is a different place and a different facing.
      if (r.homeId !== s.home.id || r.homeX !== s.home.x || r.homeZ !== s.home.z) {
        r.perf.moveHome(s.home.x, s.home.z, s.home.yaw);
        r.homeId = s.home.id;
        r.homeX = s.home.x;
        r.homeZ = s.home.z;
      }
      // A DORMANT SKELETON IS NOT SUBMITTED AT ALL.
      //
      // 'buried' snaps the figure to BURIED_Y and turns on the floor clip
      // plane, so it was still being drawn every frame, both passes, and then
      // discarded by the clipper. That is 82 draw calls and 531,364 triangles
      // per buried figure for nothing, and at the start of a run all five are
      // buried. three's projectObject returns on an invisible node before it
      // descends, so this drops the whole subtree from both the camera pass and
      // the shadow pass, while updateMatrixWorld still runs and the performance
      // keeps its state.
      //
      // It is keyed off the RULES' state rather than the performance's own
      // phase because setPhase('buried') snaps rather than eases, so the two
      // agree on the same frame and nothing pops.
      r.rig.group.visible = s.state !== 'dormant';
      r.perf.setPhase(PHASE[s.state] || 'chasing');
      r.set({ x: s.x, z: s.z, yaw: s.yaw, dist: Math.hypot(s.x - st.ghost.x, s.z - st.ghost.z) });
      r.perf.update(dt, null);
    }
    fperf.mark();

    // The cue list. The rules never touch a mesh, so this is the only place a
    // firefly is told it has been eaten, and the only place the run's totals
    // are added up. Reading them off `state` at the end would lose everything
    // that happened in a maze that was cleared and thrown away.
    for (const e of st.events) {
      if (e.type === 'firefly') run.fireflies += 1;
      else if (e.type === 'death') run.caughtBy = e.by;
    }
    syncFlies(st);

    // Any prop template this wave still owes. Costs nothing once the level is
    // complete, which after the first wave transition is almost always.
    if (world.field?.pending) world.field.pump(BAKE_BUDGET_MS);
    fperf.mark();

    world.flies.update(time, dt);
    // An authored level's own props: the fountain's water, a lantern's flame.
    // Empty on a generated level, so this costs a loop over nothing.
    for (const a of world.animated) a.update(time, dt);
    follow(dt);
    drawHud(st);
    fperf.mark();

    // --- the endless part ----------------------------------------------------
    // Both of these are read off `state`, never worked out here. A maze is
    // over when the rules say so, and nothing else ends it.
    if (st.phase === 'over' && !run.over) {
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
    fperf.frameStart(now);
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    advance(dt);
    renderer.render(scene, camera);
    fperf.frameEnd();
  }
  requestAnimationFrame(frame);

  // The harness hook, same shape as the other two pages so the capture scripts
  // can drive this one too.
  window.__game = {
    setSize(w, h) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; resize(); },
    step(dt = 1 / 60, axis = null) {
      live = false;
      scripted = axis;
      fperf.frameStart(performance.now());
      advance(dt);
      renderer.render(scene, camera);
      fperf.frameEnd();
    },
    state: () => game.state,
    run: () => ({ ...run }),
    board: () => loadBoard(),
    // What is actually loaded, so a harness can prove that the file it saved is
    // the file being played rather than infer it from a screenshot.
    level: () => (authored ? { url: levelUrl, name: authored.doc.name, size: authored.doc.size } : null),
    share: () => shareUrl({ ...run, duration: Math.round(run.time) }, ''),
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
    // a page reload changing the level under the measurement. Every template
    // the cache holds is a hit, which is the streaming best case: a chunk the
    // player has already walked through.
    rebuild() { startRun(); return world.buildMs; },
    templates: () => propCache.size(),
    // Templates this wave still owes. Zero means the level is fully built.
    pending: () => world?.field?.pending ?? 0,
    // The named buckets buildWorld parents its work under.
    buckets: () => world?.buckets || {},
    // Every bead the field is currently showing, against every firefly the
    // rules currently have on the board. The whole point of syncFlies is that
    // these two lists agree, and a probe should be able to assert it rather
    // than take a screenshot and squint.
    flies: () => {
      const f = world.flies;
      const lit = [];
      for (let i = 0; i < f.count; i++) {
        if (f.isCollected(i)) continue;
        lit.push({ slot: i, x: +f.positions[i * 3].toFixed(3), z: +f.positions[i * 3 + 2].toFixed(3) });
      }
      const want = (game.state.fireflies || []).map((x) => ({ id: x.id, x: +x.x.toFixed(3), z: +x.z.toFixed(3) }));
      return { lit, want };
    },
    // Frame times, hitch counts and where the worst frame went. The same
    // numbers the on-screen readout shows, for a headless probe to read.
    frames: () => fperf.stats(),
    resetFrames: () => fperf.reset(),
    showFrames: (on) => fperf.show(on),
  };
  window.__gameReady = true;
}
