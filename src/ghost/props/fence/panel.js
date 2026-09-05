import * as THREE from 'three';
import F from './metrics.js';
import { board, pointedTop, rng, woodMaterial } from './wood.js';
import { mergeGeometries } from '../merge.js';

// One intact fence panel: a row of pickets, two rails behind them, a post at
// each end. Origin at the centre of the panel's footprint, on the ground; the
// run goes along local X and the fence faces local +Z.
//
// The piece exists to be repeated. The user wants to lay a gated path out of
// these, so "does one panel look good" is the easy half of the job and "do two
// panels a length apart look like one fence" is the half that decides whether
// the prop is usable at all. Everything below that looks over-careful about
// where a number goes is careful about that.
//
// Three rules fall out of tiling, and they are why this file is shaped the way
// it is:
//
//   1. The picket rhythm is pitch = length / (pickets + 1), with a picket on
//      every step except the two ends. That leaves one empty step centred on
//      each boundary for the post to stand in, so a run reads as one even
//      rhythm of boards with a post occupying one slot -- and the step across a
//      panel joint is the same as every step inside a panel, without the call
//      site knowing anything. Spacing them at length / pickets instead, half a
//      pitch in at each end, also tiles, and was rejected: it leaves eight
//      millimetres between the last picket and the post, so both ends of every
//      panel look jammed while the middle looks airy.
//   2. The rails run the full length and their warp is zero at both ends, so a
//      rail end always sits exactly on the boundary plane and butts its
//      neighbour. The joint then hides inside the shared post.
//   3. The end posts straddle the boundary and are, by default, bit-identical
//      between neighbours. See POST_SEED below; that one is worth reading
//      before changing anything about the posts.
//
// The breakage agent builds damaged variants from picketGeometry, postGeometry,
// railGeometry, PANEL_LAYOUT and panelParts rather than reinventing them, so a
// gap-toothed panel still lines up with an intact one.

// The shape seed both end posts are built from, unless the caller overrides it.
//
// A post sits ON the boundary, so panel A's right post and panel B's left post
// occupy the same world space. Two posts there with different jitter is a
// visibly doubled post, and it is the one way this prop can fail loudly. Two
// posts there with IDENTICAL geometry and identical world transforms is fine:
// the depth values are bit-identical, the depth test resolves them the same way
// for every fragment, and nothing z-fights.
//
// The cost is that a long run repeats one post. If that ever reads as stamped,
// the fix is postSeeds on createFencePanel: a caller laying out a path knows
// each panel's index and can pass [boundary(i), boundary(i + 1)], which varies
// the posts while keeping every shared pair matched. Do not instead derive the
// post from the panel seed. That is the bug this constant exists to prevent.
const POST_SEED = 8317;

const L = F.panel.length;

// Depth layout. The pickets define the face of the panel at z = 0, the rails
// hang directly behind them, and the post is centred on the whole assembly's
// depth rather than on the pickets.
//
// That last one is not a style choice. The assembly runs from the picket's
// front face at +thickness/2 back to the rail's back face at
// -(thickness/2 + depth), whose midpoint is exactly -depth/2. Put the post
// there and its 0.155 section brackets the 0.117 of assembly with room to
// spare, so it stands proud in front of the pickets AND covers the rail joint
// from behind. Centred on the pickets instead, the rails poked out of the back
// of every post and the joint between two panels was visible from behind,
// which is the view the ghost gives you when it walks past.
const PICKET_Z = 0;
const RAIL_Z = -(F.picket.thickness / 2 + F.rail.depth / 2);
const POST_Z = -F.rail.depth / 2;

// ---------------------------------------------------------------------------
// grain
//
// Soft dark streaks running the length of every board. Split across two places,
// and the split is not arbitrary:
//
//   * The slow half -- a whole-board tint, a lengthwise mottle, and the dirt
//     picked up in the first centimetre out of the ground -- rides in a vertex
//     colour attribute, the way the pumpkin carries its whole hue.
//
//   * The streaks themselves are evaluated per fragment, from the board's own
//     object space, in a small patch on the standard material.
//
// Vertex colours alone were tried first and cannot do the streaks, for a reason
// worth writing down because it is not obvious and it will catch the next
// person. board() spaces its ring vertices evenly in ANGLE around a
// superellipse, and the superellipse for a board four times wider than it is
// thick is very flat, so nearly every angle maps to a point near one of the two
// narrow edges. Measured on a real picket at ring 40: of the nineteen vertices
// on the 115mm front face, eighteen sit in the outer 20mm and exactly one lands
// anywhere near the middle. Streaks written into those vertices are averaged
// away to nothing -- which is precisely what the first render showed, a plain
// cream board -- and raising the ring count does not help, because the
// bunching is in the parametrisation, not the resolution.
//
// This is also why there is no texture: the problem was never resolution, it
// was that a lofted board has no UVs and no even sampling to hang them on. A
// dozen lines of sine in the fragment shader need neither, cost nothing, and
// stay sharp at any distance. ground.js already patches a standard material the
// same way.

// Built once, at module load, because a Color per vertex is pure waste.
//
// No convertSRGBToLinear here, and that is deliberate. THREE.ColorManagement is
// on by default in this version of three, so `new THREE.Color('#e2d5bd')`
// already lands in the renderer's linear working space; converting again takes
// the pale cream to #c2aa82 and the whole fence comes back a saturated tan. The
// first pass of this file did exactly that. (pumpkin.js converts twice as well,
// but its colours were chosen with the second conversion already in them, so
// there it looks intended. Do not copy that line into new code.)
const PALE = new THREE.Color(F.wood.pale);
const SHADE = new THREE.Color(F.wood.shade);
// The darkest a streak gets. A little past the shade colour, because shade is
// the tone of a whole weathered face and a grain line has to sit under it or it
// does not read as a line.
const GRAIN = SHADE.clone().multiplyScalar(0.78);

// Writes both halves onto a board: the vertex colour, and the two numbers the
// fragment patch needs.
//
// Called while the board still stands on its own axis, length along +Y. `axis`
// is 0 for a board used that way up and 1 for one whose geometry has already
// been laid down along X, which is the rail; the shader swaps its across and
// along coordinates accordingly. Getting this wrong does not look subtle, the
// grain simply runs the wrong way across the board.
function paintBoard(geo, rand, { groundEnd = true, axis = 0 } = {}) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const grain = new Float32Array(n * 2);
  const c = new THREE.Color();

  // One phase per board. Held in an attribute rather than derived from the
  // mesh's world position, so that a given seed gives the same fence wherever
  // the panel is dropped in the scene.
  const phase = rand() * Math.PI * 2;
  // A whole-board tint. Weathered stock is not one colour across a fence, and a
  // couple of boards sitting a shade greyer than their neighbours is most of
  // what stops a row of pickets reading as one extrusion.
  const tint = rand() * F.grain.tint;
  const mottlePhase = rand() * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const along = axis === 1 ? pos.getX(i) : pos.getY(i);

    // Slow weathering up the length. This one IS well sampled -- there are
    // eighteen rings along a picket and forty-four up a post -- so it is the
    // half of the grain that belongs in the vertices.
    let k = tint + 0.10 * (0.5 + 0.5 * Math.sin(along * 4.3 + mottlePhase))
                 + 0.06 * (0.5 + 0.5 * Math.sin(along * 11.7 + phase));

    // The first centimetre out of the dirt is grubbier than the rest. Rails
    // never touch the ground and opt out; on them the length coordinate starts
    // at one end of the board and this would darken it for no reason.
    if (groundEnd) k += Math.max(0, 1 - along / 0.09) * 0.22;

    c.copy(PALE).lerp(SHADE, Math.min(1, k));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    grain[i * 2] = phase;
    grain[i * 2 + 1] = axis;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrain', new THREE.BufferAttribute(grain, 2));
  // The board's own space, frozen before anything moves the board.
  //
  // The grain is evaluated from this rather than from the vertex position, and
  // the two are the same number right up until a panel is baked into one
  // buffer. After that the position is in panel space and reading the grain off
  // it would run the streaks straight through seven pickets as if they had been
  // sawn from one plank -- which is exactly what the first merged panel looked
  // like. Copying the position here costs 12 bytes a vertex and is the entire
  // reason a panel can be one mesh.
  geo.setAttribute('aBoard', new THREE.BufferAttribute(Float32Array.from(pos.array), 3));
  return geo;
}

// The surface every piece of this fence is drawn with: wood.js's material, told
// to take its colour from the vertex attribute, plus the streaks.
//
// Exported because the pieces are exported. A damaged panel built from
// picketGeometry and friends needs this material or its boards come out plain
// next to an intact neighbour's. A fresh break wants F.wood.torn instead, which
// is what the `color` option is for; the streaks come along either way.
// `boardSpace` opts into reading the grain off the aBoard attribute rather than
// off the vertex position. It is OFF by default and must stay that way: the
// shed, the debris pile, the gate and the broken panels all write their own
// aGrain without an aBoard beside it, and a missing attribute does not fail, it
// reads as zero and takes the grain with it. Only geometry that has been
// through paintBoard -- which is to say, an intact panel -- may ask for it.
export function woodPanelMaterial({ boardSpace = false, ...options } = {}) {
  const uniforms = {
    uGrain: { value: GRAIN.clone() },
    uGrainDepth: { value: F.grain.depth },
    uGrainFreq: { value: F.grain.frequency * Math.PI * 2 },
  };
  // White, so the vertex colour is the colour. Left at F.wood.pale it would
  // multiply the grain a second time and the fence comes out muddy.
  const material = woodMaterial({ color: new THREE.Color(0xffffff), vertexColors: true, ...options });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      attribute vec2 aGrain;
      ${boardSpace ? 'attribute vec3 aBoard;' : ''}
      varying vec3 vBoard;
      varying vec2 vGrain;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Object space on purpose. A picket's lean and twist are on the mesh, so
      // its grain has to be read before them or the streaks shear off the
      // board as it goes out of true.
      //
      // Once a whole panel is baked into one buffer, object space is the
      // PANEL's, and reading the grain off it runs the streaks through seven
      // pickets as if they had been sawn from one plank. aBoard is each
      // vertex's position in its own board's space, written by paintBoard
      // before anything moves the board, and boardSpace switches to it.
      vBoard = ${boardSpace ? 'aBoard' : 'transformed'};
      vGrain = aGrain;`,
    );

    shader.fragmentShader = `
      varying vec3 vBoard;
      varying vec2 vGrain;
      uniform vec3 uGrain;
      uniform float uGrainDepth;
      uniform float uGrainFreq;
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float ph = vGrain.x;
        // Rails arrive already lying along X, so their across and along
        // coordinates are the other way round. The rotation that laid them
        // down sends +X to -Y, hence the sign.
        float across = mix(vBoard.x, -vBoard.y, vGrain.y) + 0.5 * vBoard.z;
        float along  = mix(vBoard.y, vBoard.x, vGrain.y);
        // A streak wanders a little down the board. Dead parallel lines read
        // as printed stripes, which is worse than no grain at all.
        float u = across + 0.02 * sin(along * 5.5 + ph);
        float f = uGrainFreq;
        float s = sin(u * f + ph) * 0.62
                + sin(u * f * 2.13 + ph * 1.7) * 0.26
                + sin(u * f * 0.41 + ph * 0.6) * 0.50;
        s /= 1.38;
        // Only the positive half becomes a streak, raised to a power so the
        // dark lands as narrow lines. Grain spread evenly over half the board
        // is camouflage, not timber. The second term lets a line fade out and
        // pick up again along its length.
        float streak = pow(max(0.0, s), 2.0) * (0.55 + 0.45 * sin(along * 3.1 + ph));
        diffuseColor.rgb = mix(diffuseColor.rgb, uGrain, clamp(streak, 0.0, 1.0) * uGrainDepth);
      }`,
    );
  };
  // Without this every fence material recompiles into its own program, because
  // three keys the cache on the stock shader and these two are not stock. The
  // two grain spaces are two programs and have to key apart.
  material.customProgramCacheKey = () => (boardSpace ? 'fence-wood-grain-board' : 'fence-wood-grain');
  return material;
}

// ---------------------------------------------------------------------------
// the three pieces
//
// Each comes back at rest at its own origin, and PANEL_LAYOUT says where it
// goes. Pickets and posts stand on y = 0 and grow up +Y; a rail is already
// lying along X, centred on the origin, because a rail is never used any other
// way and making every caller remember the same rotation is how the two of them
// end up disagreeing.
//
// `rand` is a stream from wood.js's rng(), not Math.random. Pass one and the
// same board comes back every time, which is the whole reason panelParts hands
// out a seed per part.

export function picketGeometry({
  rand = rng(1),
  height = F.picket.height,
  width = F.picket.width,
} = {}) {
  // Ring counts here and on the other two pieces buy silhouette only -- the
  // rounded arris and the taper into the point -- because the grain is in the
  // fragment shader and does not care how the surface is tessellated. That is
  // worth knowing before anyone raises them: an earlier pass ran the picket at
  // ring 40 trying to make vertex-colour grain read, which cost five thousand
  // vertices a panel and did not work. See the note above paintBoard.
  const ring = 16;
  const geo = board({
    length: height,
    width,
    thickness: F.picket.thickness,
    round: F.picket.round,
    // Bowing out of the fence plane rather than along it. A picket is nailed to
    // two rails so it cannot bow sideways much, and a sideways bow would also
    // eat unevenly into the gaps, which is the one irregularity that reads as a
    // mistake instead of as age.
    warp: (rand() - 0.5) * 2 * F.picket.warp,
    warpAxis: 'z',
    // The roof point, blunt apex and all, straight from wood.js. Both numbers
    // it needs are in metrics: pointRise for the chamfer angle, apex for how
    // much board is left at the tip.
    profile: pointedTop(height, width),
    // Enough rings along the length that the warp is a curve and the grain has
    // somewhere to live. The point itself is the top two or three.
    segments: 18,
    ring,
  });
  return paintBoard(geo, rand);
}

export function postGeometry({ rand = rng(POST_SEED) } = {}) {
  const { ease, take } = F.post.top;
  // Squared off, not pointed, with the rim eased. A flat cap straight onto the
  // sides gives a 90 degree edge that goes black under the key light and makes
  // the post read as a cardboard tube; a quarter round over the last few per
  // cent of the height is what puts the highlight along the top in the
  // reference. The vertical arrises are already handled by post.round.
  const profile = (t) => {
    if (t <= 1 - ease) return [1, 1];
    const k = (t - (1 - ease)) / ease;
    const s = 1 - take * (1 - Math.sqrt(Math.max(0, 1 - k * k)));
    return [s, s];
  };
  // A little denser than the picket: the post is the chunkiest thing in the
  // set, so its rounded corners are the ones that show faceting first.
  const ring = 20;
  const geo = board({
    length: F.post.height,
    width: F.post.width,
    thickness: F.post.thickness,
    round: F.post.round,
    warp: (rand() - 0.5) * 2 * F.post.warp,
    warpAxis: 'z',
    profile,
    // High, and deliberately so: the eased top lives in the last 5.5% of the
    // length, and board() samples t evenly. At 16 segments the whole ease fell
    // between two rings and the post came back with a flat top again.
    segments: 44,
    ring,
  });
  return paintBoard(geo, rand);
}

export function railGeometry({ rand = rng(3), length = F.panel.length } = {}) {
  const ring = 14;
  // metrics gives the rail a thickness and a depth. Depth is the Z one, how far
  // it stands back off the pickets; thickness is the vertical one. That way
  // round it is a board laid flat, which is how a rail is fitted and which is
  // why depth is the larger of the two.
  const geo = board({
    length,
    width: F.rail.thickness,
    thickness: F.rail.depth,
    round: F.rail.round,
    // Sag, not bow. board()'s warp is zero at both ends by construction, which
    // is what lets a rail end sit exactly on the panel boundary and butt its
    // neighbour; the middle is free to droop. Signed positive on purpose: after
    // the rotation below, +X maps to -Y, so a positive warp sags downward. A
    // rail that bellies upward looks sprung, not old.
    warp: (0.35 + 0.65 * rand()) * F.rail.warp,
    warpAxis: 'x',
    segments: 24,
    ring,
  });
  // Turned down flat and centred, which is the only way a rail is ever used.
  // Doing it here rather than at every call site is how the two of them end up
  // disagreeing about which way a rail points.
  geo.rotateZ(-Math.PI / 2);
  geo.translate(-length / 2, 0, 0);
  return paintBoard(geo, rand, { groundEnd: false, axis: 1 });
}

// ---------------------------------------------------------------------------
// layout

// Where every piece of an untouched panel sits, before any per-seed jitter.
// Exported so a damaged panel can be laid out against the same numbers and
// still line up with an intact neighbour.
export const PANEL_LAYOUT = {
  length: L,
  // One step per picket plus one for the post at the boundary. This is the
  // tiling rule; see the note at the top of the file.
  pitch: L / (F.panel.pickets + 1),
  height: F.post.height,
  z: { picket: PICKET_Z, rail: RAIL_Z, post: POST_Z },
  posts: [
    { end: -1, x: -L / 2, y: 0, z: POST_Z },
    { end: 1, x: L / 2, y: 0, z: POST_Z },
  ],
  pickets: Array.from({ length: F.panel.pickets }, (_, i) => ({
    index: i,
    x: -L / 2 + (i + 1) * (L / (F.panel.pickets + 1)),
    y: 0,
    z: PICKET_Z,
    width: F.picket.width,
    height: F.picket.height,
  })),
  rails: F.rail.at.map((at, i) => ({
    index: i,
    x: 0,
    y: at * F.picket.height,
    z: RAIL_Z,
    length: L,
  })),
};

// PANEL_LAYOUT with one seed's variation applied, and a geometry seed per part.
//
// createFencePanel builds from exactly this, so a caller that wants a damaged
// panel to match an intact one calls panelParts with the same seed and gets the
// same boards in the same places, then leaves out or replaces the ones it is
// breaking. Nothing has to be kept in step by hand.
export function panelParts({ seed = 1, postSeeds = [POST_SEED, POST_SEED] } = {}) {
  const rand = rng(seed);
  const j = F.picket.jitter;
  const sym = () => rand() * 2 - 1;
  // A seed per board, drawn from the panel's stream. Storing the seed rather
  // than the finished geometry is what lets the breakage agent rebuild one
  // board without replaying the whole panel.
  const geoSeed = () => 1 + Math.floor(rand() * 0xffffff);

  const pickets = PANEL_LAYOUT.pickets.map((p) => {
    const width = p.width * (1 + sym() * j.width);
    const height = p.height * (1 + sym() * j.height);
    const leans = rand() < F.picket.leanChance;
    const lean = sym() * j.lean * (leans ? 1 : F.picket.leanFloor);
    const twist = sym() * j.twist;
    // Each board is knocked into the dirt by its own amount. The tops are
    // already uneven from the height jitter; the bottoms being uneven too is
    // what stops the row reading as a set that was cut from one sheet.
    const sink = F.picket.sink * (0.35 + rand());
    return { ...p, width, height, lean, twist, y: -sink, seed: geoSeed() };
  });

  const rails = PANEL_LAYOUT.rails.map((r) => ({ ...r, seed: geoSeed() }));

  // Posts do NOT draw from the panel's stream. See POST_SEED.
  const posts = PANEL_LAYOUT.posts.map((p, i) => ({
    ...p,
    // No F.post.sink, so the picket's bedding depth stands in, eased off
    // because a post is a heavier thing that sits prouder of the dirt.
    y: -F.picket.sink * 0.8,
    seed: postSeeds[i] ?? POST_SEED,
  }));

  return { pickets, rails, posts };
}

// ---------------------------------------------------------------------------
// the panel

// One panel's eleven boards, transformed into place and baked into a single
// buffer.
//
// A panel was eleven meshes for as long as there was one of it. A level is a
// hundred and thirty-eight, which is fifteen hundred meshes and, once the
// shadow pass has had its turn, three thousand draw calls for a fence. The
// boards already shared a material and already never move relative to each
// other, so there was never anything for eleven meshes to buy.
//
// Nothing about the panel's SHAPE changes here. The same three geometry
// builders are called with the same seeds and put in the same places; the only
// difference is that the placement is baked into the vertices instead of
// living on a Mesh. See paintBoard's aBoard for the one thing that had to
// change to make that safe.
export function panelGeometry({ seed = 1, postSeeds } = {}) {
  const parts = panelParts(postSeeds ? { seed, postSeeds } : { seed });
  const entries = [];
  const own = [];
  const place = (geo, part, { lean = 0, twist = 0 } = {}) => {
    own.push(geo);
    const m = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(0, twist, lean, 'XYZ'))
      .setPosition(part.x, part.y, part.z);
    entries.push({ geometry: geo, matrix: m });
  };

  // Rails first, so the back of the fence is built before the things that hide
  // it. Nothing depends on the order; it just matches the way the piece reads.
  for (const r of parts.rails) place(railGeometry({ rand: rng(r.seed), length: r.length }), r);

  for (const p of parts.pickets) {
    // The lean pivots about the picket's foot, which is where a leaning picket
    // actually pivots: it is still nailed down, it has just gone out of true.
    place(picketGeometry({ rand: rng(p.seed), height: p.height, width: p.width }), p, {
      lean: p.lean,
      twist: p.twist,
    });
  }

  // Two posts sharing one geometry when they share a seed, which is the
  // default. Both ends of a run then match, and so do the two halves of every
  // shared post between panels. Baked, the two posts are two copies of the same
  // vertices at two offsets, which is the same guarantee by another route.
  const postGeos = new Map();
  for (const p of parts.posts) {
    if (!postGeos.has(p.seed)) postGeos.set(p.seed, postGeometry({ rand: rng(p.seed) }));
    place(postGeos.get(p.seed), p);
  }

  const merged = mergeGeometries(entries);
  // The eleven parts have been copied into the merged buffer and are dead.
  for (const g of own) g.dispose();
  return merged;
}

// The one material every intact panel is drawn with.
//
// It carries no per-panel state -- three uniforms, all constants -- so a
// material per panel bought a hundred and thirty-eight uniform binds and a
// hundred and thirty-eight things that cannot batch. Built lazily so importing
// this module still costs nothing on a page that draws no fence.
let SHARED_MATERIAL = null;
export function sharedPanelMaterial() {
  if (!SHARED_MATERIAL) SHARED_MATERIAL = woodPanelMaterial({ boardSpace: true });
  return SHARED_MATERIAL;
}

export function createFencePanel({ seed = 1, scale = 1, postSeeds } = {}) {
  const geometry = panelGeometry({ seed, postSeeds });
  const material = sharedPanelMaterial();

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.scale.setScalar(scale);

  // No painted contact patch under this one, for the reason tombstones.js
  // spells out at length: a patch laid flat on the floor is the same on the
  // side facing the key light as on the side away from it, so it reads as a
  // stain rather than a shadow. A fence is worse than a tombstone for it,
  // because a run of them would lay a continuous dark band down the path.

  return {
    group,
    mesh,
    update() {}, // static prop, but the other props have one and callers loop over it
    dispose() {
      geometry.dispose();
      // The material is shared and outlives the panel. Nothing to free.
    },
  };
}

// ---------------------------------------------------------------------------
// a whole run of fence, in a handful of draw calls
//
//   createFenceRun({ panels: [{ x, z, yaw, seed }, ...] })
//
// A hundred and thirty-eight panels is a hundred and thirty-eight of the same
// object at different places, which is what an InstancedMesh is for. Two things
// decide how it is cut up:
//
//   variants  how many DISTINCT panels get built. Every panel drawn from the
//             same variant is bit-identical, so this is the whole of the
//             fence's variety and it is worth being honest about: at 6, a
//             level's panels repeat, but a picket's lean is a few millimetres
//             and the repeat is invisible next to the fact that all 138 were
//             already the same panel design. Raise it and the only cost is
//             build time and vertex memory.
//   tile      instancing kills per-panel frustum culling: one InstancedMesh
//             spanning a level is either drawn whole or not at all. Panels are
//             therefore grouped into square tiles first, so a run behind the
//             camera still culls. The tile wants to be about the size of the
//             chunk a streaming world hands over; smaller costs draw calls,
//             larger costs triangles.
export function createFenceRun({ panels = [], variants = 6, tile = 16, postSeeds } = {}) {
  const group = new THREE.Group();
  const material = sharedPanelMaterial();
  const geometries = new Map();
  const buckets = new Map();

  for (const p of panels) {
    // The variant is chosen from the panel's own seed, so a panel keeps the
    // shape it had wherever it is rebuilt -- which is what a chunk that streams
    // out and back in again needs, or the fence changes behind the player.
    const v = Math.abs(p.seed | 0) % variants;
    const key = `${v}:${Math.floor(p.x / tile)}:${Math.floor(p.z / tile)}`;
    let b = buckets.get(key);
    if (!b) { b = { variant: v, items: [] }; buckets.set(key, b); }
    b.items.push(p);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3();
  for (const b of buckets.values()) {
    if (!geometries.has(b.variant)) {
      geometries.set(b.variant, panelGeometry({ seed: b.variant * 7919 + 13, postSeeds }));
    }
    const mesh = new THREE.InstancedMesh(geometries.get(b.variant), material, b.items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    b.items.forEach((p, i) => {
      e.set(0, p.yaw || 0, 0);
      q.setFromEuler(e);
      at.set(p.x, p.y || 0, p.z);
      m.compose(at, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  return {
    group,
    meshes: group.children,
    update() {},
    dispose() {
      for (const g of geometries.values()) g.dispose();
      for (const c of group.children) c.dispose?.();
      group.clear();
    },
  };
}

export default createFencePanel;
