import * as THREE from 'three';
import { mergeGeometries } from '../merge.js';
import { rng } from './wood.js';
import { WALL } from './wall.js';

// THE MAIN GATE: a wrought-iron cemetery gate, hung in an opening in the
// perimeter wall, and CHAINED SHUT.
//
// ============================================================================
// IT IS NOT A WAY OUT, AND THAT IS THE FIRST THING ABOUT IT
// ============================================================================
//
// The perimeter wall is the edge of the level. Outside it there is darkness and
// nothing generated, and the rules read WALL.vaultable === false to say the
// ghost never leaves. A gate that opened would be a hole in the game rather
// than a feature in the art, so this one does not open, has no hinge node a
// physics agent could write to, and publishes no angle.
//
// THE COLLISION IS UNTOUCHED, and that is a fact about where the collision
// lives rather than a promise made here. src/game/world/fence.js makeWall()
// builds the perimeter as four full-length segments from the level's box, and
// src/game/level/format.js does the same for an authored level. Neither of them
// has ever known about `gate` on createWall, because a wall's openings are a
// fact about its GEOMETRY. So cutting the opening cannot open the collision:
// there is no code path from one to the other. Nothing here adds a barrier,
// removes one, or moves one, and the audit and the wedge finder see exactly the
// arena they saw before.
//
// Everything visible says the same thing twice more, because a player believes
// what they can see and not what is in a comment:
//
//   * the two leaves are SHUT, meeting stile to meeting stile on the
//     centreline, with a chain wrapped round both and a padlock hanging off it;
//   * the wall's plinth runs THROUGH the opening as a threshold (wall.js's
//     `sill`), so there is not even a gap under the gate to look through.
//
// ============================================================================
// WHAT IT IS MADE OF, AND WHY NOT A CARD
// ============================================================================
//
// Bars, as geometry. This project bans alpha cards and is right to: there is no
// environment map in this scene, so a card has nothing to reflect and comes out
// as a grey rectangle with a hole pattern in it. Wrought iron reads BY ITS
// GAPS -- it is the only thing in the level you can see through, and at this
// camera the near gate shows lit floor between its bars and the far one shows
// the darkness outside. That is the whole character and a texture cannot have
// it, because the thing behind the bars is the level.
//
// THIN METAL AT THIS CAMERA, and this is arithmetic rather than judgement,
// because the first pass got it wrong by a factor of two in the direction that
// matters.
//
// The camera is orthographic along (1, 0.78, 1), so screen-right is the unit
// vector (-1, 0, 1) / sqrt(2). A bar of x-width wx and z-depth wz standing on a
// wall that runs along x therefore covers (wx + wz) / sqrt(2) of screen width:
// BOTH of its faces are turned toward the camera and both count. A displacement
// ALONG that wall covers only 1 / sqrt(2) of its length. At the game's own
// framing -- view 9 on an 800 px canvas, so 44.4 px per world unit -- that is
//
//     bar section    on screen   what it is
//     0.036 square   1.6 px      wall.js's railing bar, at a 12.6 px pitch
//     0.092 hex      5.4 px      this gate's bars, at an 8.4 px pitch
//
// TWO NUMBERS COME OUT OF THAT AND THEY PULL AGAINST EACH OTHER. The bar has to
// be thick enough not to shimmer, which wants it fat; the GAPS have to survive,
// which wants it thin and wants few of them, and the gaps are the whole point.
// Measured, per leaf, across the 1.873 between the two stiles:
//
//     bars   pitch     bar      gap       open
//     7      7.4 px    6.2 px   1.2 px    16%    a black panel with lines on it
//     6      8.4 px    5.4 px   3.0 px    36%    a grille
//     5      9.8 px    6.2 px   3.7 px    37%    a grille, and sparse
//
// Seven was built first and rendered as a solid slab from anywhere but a
// close-up, which fails the one thing the gate is for -- it is the only object
// in the level you can see through. SIX, at 0.092, is what is here: a third of
// the gateway is hole at the game's framing, and 5.4 px of bar is three times
// the wall's own railings and does not crawl.
//
// The bars are hexagonal prisms with their ring vertices SHARED, so
// computeVertexNormals rolls the light round them; the rails and stiles are
// rectangles with their ring vertices DUPLICATED, so their arrises stay crisp.
// Flat bar stock and round bar in one kit, from one sweep function, decided by
// one flag. That contrast is most of what says "this is forged" at a distance:
// a gate whose every member shades the same way reads as an extrusion.
//
// BLACK, BUT NOT FLAT BLACK. Pure black at this camera is a silhouette with no
// form in it. The iron is a dark blue-grey at metalness 0.55 and roughness
// 0.46, which is what wall.js's ironwork uses and for the same reason: with no
// environment map the only thing that can show a bar is round is the key
// light's own specular, and that needs metal to land on. On top of it the
// fragment shader breaks the surface with rust -- warmer, matte and much less
// metallic where it has bloomed, gathered at the foot and in the angles -- so
// the value range across one bar is real shading and not a gradient painted on.
//
// ============================================================================
// OUT OF TRUE
// ============================================================================
//
// A gate that hangs square reads as new, and nothing else in this graveyard is
// new. Both leaves droop, by DIFFERENT amounts, and the droop is applied as a
// vertical SHEAR about the hanging stile rather than as a rotation about the
// hinge. That is not a shortcut, it is the correct one of the two: a rigid
// rotation swings the top of each leaf toward the middle as well as dropping
// the free edge, and with both leaves doing it the two meeting stiles cross
// each other by 190 mm at the top. Iron gates that have dropped do not rotate,
// they RACK -- the frame parallelograms and the free edge falls -- which is
// exactly a shear, and it keeps the meeting stiles vertical and touching.
//
// The far leaf has dropped 122 mm and its bottom corner is 24 mm INTO the
// threshold stone. It is not resting near the ground, it is resting ON it, and
// that is the detail that says the thing has not moved in fifty years.

// ---------------------------------------------------------------------------
// the published numbers
//
// Same discipline as metrics.js and wall.js: several agents will read these and
// nobody invents a number. If a piece needs a measurement that is not here it
// gets added here first.

export const MAINGATE = {
  // THE OPENING, jamb pier centre to jamb pier centre, and therefore the
  // `width` handed to createWall.
  //
  // FIVE UNITS, WHICH IS ONE WALL SECTION, AND IT IS CENTRED ON A SECTION
  // BOUNDARY. Those two sentences are the whole placement rule and they are
  // worth separating, because it is the second one that makes everything else
  // line up.
  //
  // The section is 5.0 in three places that all mean the same 5.0:
  // WALL.pier.spacing, the floor's own major grid, and
  // src/game/level/format.js's WALL_SECTION. A 30 unit side is six of them, so
  // a side's MIDPOINT IS A BOUNDARY, and a boundary is exactly where the wall
  // already stands a pier. So a main gate is not squeezed in between the piers:
  // it REPLACES one. `at` is a multiple of the section, the pier that stood
  // there is inside the opening and pierPlan drops it, and the two jamb piers
  // stand half a section either side of where it was.
  //
  // What that buys, in order of how much it matters:
  //
  //   * The gate is CENTRED on its wall, because the wall's midpoint is a
  //     boundary. A pair of gates on opposite sides therefore gives one
  //     straight spine through the middle of the arena and through the spawn at
  //     (0, 0), which is what the owner asked them for -- somewhere to start
  //     the paths. An opening at 10..15 instead would leave 10 of wall one side
  //     and 15 the other, and read as a mistake from anywhere in the level.
  //   * The editor needs no new coordinate. An author picks a section boundary,
  //     which is a thing the wall panel already draws, and `at` is that
  //     boundary's distance. See mainGateFault().
  //   * A style change written at the same boundary lands inside the opening,
  //     where there is no wall to change, which is the correct thing for it to
  //     do rather than an edge case to handle.
  //
  // What it costs is two HALF BAYS, one either side: the jambs land at 12.5 and
  // 17.5 on a 30 unit side, so the bay between the last ordinary pier and the
  // gate pier is 2.5 rather than 5.0. That reads as a gateway cut into a wall
  // that was already standing, which is what it is.
  width: 5.0,

  // What the two piers leave between them, which is what the leaves fill.
  clear: 5.0 - WALL.pier.width,          // 4.14

  // Crown of the jamb pier's capstone. The wall is 2.0 and its ordinary piers
  // cap at about 2.34, so the gate's stand 1.26 above those and 1.60 above the
  // wall itself: at the game's framing that is 55 px of pier over the top of
  // the wall line, which is what makes this read as the way in rather than as a
  // gap. It is also what it COSTS, and the cost is real and worth stating: an
  // orthographic camera at this elevation hides a band h / 0.78 deep behind
  // anything of height h, so each of these piers throws a 4.6 unit finger of
  // hidden ground into the level, against 2.6 for the wall. Two piers, 0.86
  // wide, on the near wall only. That is the whole bill.
  pierTop: 3.62,

  // Which is what createWall is told, since a pier's rise is measured off the
  // wall's crown.
  pierRise: 3.62 - WALL.height,          // 1.62

  // The threshold through the opening, top above the floor. Above the tallest
  // variant's plinth (rubble, 0.20) so the same number works on all four.
  sill: 0.22,

  // The tallest point on the whole prop: the cross on the crown of the
  // overthrow. Nothing in the level is taller.
  top: 3.78,

  // What navigation would need if it ever cared, which it does not, because the
  // wall's collision runs straight through the gateway unchanged. Stated so
  // that a later agent who wonders does not have to measure: nothing on this
  // prop reaches further from the wall's centreline than the jamb piers do, and
  // those are the wall's own piers at the wall's own plan size, so WALL.collide
  // and WALL.cornerCollide already cover it.
  collide: WALL.collide,

  // Stated the way WALL.vaultable is stated, because a rule that lets the ghost
  // through this is a bug in the rule and not a feature of the gate.
  passable: false,
};

// ---------------------------------------------------------------------------
// stock
//
// Numbers that are proportions of MAINGATE rather than published facts about
// it. Marked, and kept here rather than scattered through the builders.

const PIER_HALF = WALL.pier.width / 2;             // 0.43
const JAMB = MAINGATE.width / 2 - PIER_HALF;       // 2.07, the pier's inner face

// The leaf frame.
const BAR = 0.092;          // the main verticals, across the corners
const BAR_SIDES = 6;        // hexagonal: round enough to roll the light at 3 px
const STILE_HANG = 0.095;   // the leaf's hinge edge, the heaviest member
const STILE_MEET = 0.082;   // where the two leaves come together
const DOG = 0.050;          // the short bars in the bottom panel

const LEAF_AIR = 0.02;      // between the hanging stile's face and the pier's
const HANG_X = JAMB - LEAF_AIR - STILE_HANG / 2;   // 2.0025
const MEET_X = STILE_MEET / 2;                     // 0.041, so the pair touch at 0

// Heights, all above the floor and all before the droop.
const Y_FOOT = 0.32;        // the bottom of the leaf frame at the hinge
const Y_BOT = 0.415;        // bottom rail, centre
const Y_DOG = 0.76;         // dog rail, centre: the top of the close-barred band
const Y_TOP_HANG = 2.26;    // top rail centre, at the hanging stile
const Y_TOP_MEET = 2.54;    // and at the meeting stile -- the camber

const RAIL_BOT = [0.150, 0.050];   // [face height, depth through the gate]
const RAIL_DOG = [0.100, 0.045];
const RAIL_TOP = [0.140, 0.050];

const SPEAR_CLEAR = 0.11;   // from the top rail's centre to where the head starts
const SPEAR_LEN = 0.40;     // and how far the head runs from there to the tip
const SPEAR_SWELL = 1.55;   // how far the head stands proud of its own shaft

// The overthrow. Two parabolic bands with droppers between them and a cross on
// the crown. A circular arc was tried and there is nothing in it at this size;
// a parabola needs no radius arithmetic and cannot be given an impossible rise.
const ARCH_OUT = [3.06, 3.42];     // [springing, crown] of the outer band
const ARCH_IN = [2.84, 3.16];      // and of the inner one
const ARCH_BAND = [0.070, 0.045];
const ARCH_DROPS = 7;
const CROSS_H = 0.36;

// How far out of true. See the note at the top on why this is a shear.
// Radians of rack, per leaf, and the SPREAD between them is the number that
// matters rather than either value. At 1.9655 from hinge to meeting stile the
// two free edges end up 79 mm apart in height, which is three pixels at the
// game's framing: enough that the camber's apex has a visible step in it and
// the two rows of spear tips do not line up, which is what "out of true" has to
// look like at this size. The far leaf has dropped 122 mm and its bottom corner
// is 24 mm INTO the threshold stone, which is the picture of a gate that has
// stopped being a gate.
const DROOP = [0.022, 0.062];
const LEAN = 0.009;                // and how far the whole gate leans, shared

// The chain, and the padlock hanging off it.
const LINK = { major: 0.072, tube: 0.022, long: 1.6, count: 11 };
const CHAIN_Y = 1.30;

// Where the hinge hardware and the chain sit through the thickness of the gate:
// on its arena face, not on its centreline. The wall is 0.44 thick so this is
// well inside it, and WALL.collide covers it four times over.
const HARD_Z = 0.055;

// The iron. Not one colour: the frame is a shade darker than the bars, which is
// what stops a grille of identical members reading as a screen door.
const IRON_BAR = '#464b55';
const IRON_FRAME = '#383c44';
const IRON_HARD = '#4c5058';       // hardware, which has been handled

// ---------------------------------------------------------------------------
// the kit
//
// Four primitives and everything on the gate is one of them. Same argument
// gate.js makes for cutting every piece of a garden gate out of panel.js's
// three parts: a prop built from one kit comes out looking like one object.

// A section, in the (m, z) plane of a swept piece: m is the path's own in-plane
// normal and z runs through the gate. Both are wound counter-clockwise, which
// is what orient() below assumes when it decides which way a face points.
const rect = (hw, hd) => [[hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]];

function ngon(r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * (i + 0.5)) / n;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

// Make a block of triangles face the way it should.
//
// This is here rather than reasoned out once and hard-coded, and it is worth
// saying why, because it looks like timidity. The frame a piece is swept in is
// built from its own path, and half the pieces on this gate run in the opposite
// direction to the other half -- the right leaf is the left leaf with every x
// negated, which is a REFLECTION and reverses handedness. A fixed winding is
// therefore right for one leaf and inside out for the other, and an inside-out
// closed solid does not look wrong at this size, it looks like a slightly
// darker one, which is precisely the kind of thing that survives a review.
// Testing the geometry costs one cross product per piece and cannot be wrong.
function orient(position, index, from, want) {
  if (index.length - from < 3) return;
  const [i0, i1, i2] = [index[from], index[from + 1], index[from + 2]];
  const px = (i) => position[i * 3];
  const py = (i) => position[i * 3 + 1];
  const pz = (i) => position[i * 3 + 2];
  const ax = px(i1) - px(i0); const ay = py(i1) - py(i0); const az = pz(i1) - pz(i0);
  const bx = px(i2) - px(i0); const by = py(i2) - py(i0); const bz = pz(i2) - pz(i0);
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const w = want(
    (px(i0) + px(i1) + px(i2)) / 3,
    (py(i0) + py(i1) + py(i2)) / 3,
    (pz(i0) + pz(i1) + pz(i2)) / 3,
  );
  if (nx * w.x + ny * w.y + nz * w.z >= 0) return;
  for (let i = from; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
}

// A section swept along a polyline lying in the gate's own (x, y) plane.
//
//   pts     [{ x, y, s }]  s scales the section at that station, default 1, and
//           it is the whole of how a spear head is made: three stations, the
//           middle one swollen and the last one at nothing.
//   ring    the section, from rect() or ngon()
//   smooth  share the ring's vertices, so computeVertexNormals rolls the light
//           round the piece (a bar); otherwise duplicate them per edge, so
//           every arris stays a crease (flat stock)
//
// No normals are written. Everything on this prop is merged into one buffer and
// the normals are computed there, which is what lets the two treatments live in
// one geometry: pieces never share vertices with each other, so the averaging
// cannot cross a joint.
function sweepPlane(pts, ring, { smooth = false, capA = true, capB = true } = {}) {
  const n = pts.length;
  const R = ring.length;
  const per = smooth ? R : R * 2;

  // The in-plane normal at each station, from the average of the tangents
  // either side of it. No mitre: every bend on this prop is a parabola sampled
  // finely enough that the pinch at a station is under a tenth of a millimetre,
  // and a mitre that divides by cos(half angle) is one more thing that can
  // divide by zero.
  const ms = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    ms.push({ x: -ty / l, y: tx / l });
  }

  const position = [];
  const index = [];
  const put = (i, k) => {
    const p = pts[i];
    const m = ms[i];
    const s = p.s === undefined ? 1 : p.s;
    position.push(p.x + m.x * ring[k][0] * s, p.y + m.y * ring[k][0] * s, ring[k][1] * s);
  };
  for (let i = 0; i < n; i++) {
    if (smooth) for (let k = 0; k < R; k++) put(i, k);
    else for (let k = 0; k < R; k++) { put(i, k); put(i, (k + 1) % R); }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * per;
    const b = (i + 1) * per;
    for (let k = 0; k < R; k++) {
      const p0 = smooth ? k : k * 2;
      const p1 = smooth ? (k + 1) % R : k * 2 + 1;
      index.push(a + p0, b + p0, b + p1, a + p0, b + p1, a + p1);
    }
  }
  // The sides face away from the path's own axis.
  orient(position, index, 0, (x, y, z) => ({ x: x - pts[0].x, y: y - pts[0].y, z }));

  // The ends. A cap faces along the path, backwards at the start and forwards
  // at the end, and is fanned from the axis -- every section here is star
  // shaped about its own centre, so a fan is a valid triangulation of all of
  // them.
  const cap = (i, sign) => {
    const p = pts[i];
    const m = ms[i];
    const s = p.s === undefined ? 1 : p.s;
    const base = position.length / 3;
    const from = index.length;
    position.push(p.x, p.y, 0);
    for (let k = 0; k < R; k++) put(i, k);
    for (let k = 0; k < R; k++) index.push(base, base + 1 + k, base + 1 + ((k + 1) % R));
    const t = { x: m.y * sign, y: -m.x * sign };
    orient(position, index, from, () => ({ x: t.x, y: t.y, z: 0 }));
  };
  if (capA) cap(0, -1);
  if (capB) cap(n - 1, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  return geo;
}

// A straight member: two stations and nothing else.
const strut = (x0, y0, x1, y1, ring, opts) =>
  sweepPlane([{ x: x0, y: y0 }, { x: x1, y: y1 }], ring, opts);

// A parabola between two ends, with a rise over the straight line between them.
// The camber of a gate's head and the curve of an overthrow are the same shape
// at different sizes, so they are the same function.
function camber(x0, y0, x1, y1, rise, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t + rise * 4 * t * (1 - t),
    });
  }
  return out;
}

// One link of chain, as an oval ring lying in its own XY plane. Cheap on
// purpose: at this camera a link is three pixels across and what has to read is
// the CHAIN, which reads because it is a knot of dark loops in the one place
// the two leaves come together.
function linkGeometry() {
  const geo = new THREE.TorusGeometry(LINK.major, LINK.tube, 3, 7);
  geo.scale(LINK.long, 1, 1);
  return geo;
}

// Strip a geometry down to what this prop merges -- position and a flat vertex
// colour -- and hand back the colour with it. Torus geometries arrive with uvs
// and normals and the swept pieces arrive with neither, and mergeGeometries
// takes the INTERSECTION of its inputs' attributes, so a single stray uv would
// silently throw away every colour on the gate.
function plain(geo, colour) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo.deleteAttribute('uv1');
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(colour);
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { buf[i * 3] = c.r; buf[i * 3 + 1] = c.g; buf[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(buf, 3));
  return geo;
}

// The rack. See the note at the top: a dropped iron gate parallelograms, so the
// free edge falls without the top swinging in, and the meeting stiles stay
// vertical and touching instead of crossing each other.
function rack(geo, hinge, droop, lean) {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setXYZ(i, x + (y - Y_FOOT) * lean, y - Math.abs(x - hinge) * droop, pos.getZ(i));
  }
  return geo;
}

// ---------------------------------------------------------------------------
// the surface

export function mainGateMaterial({ seed = 1 } = {}) {
  const rand = rng(seed);
  const uOffset = { value: new THREE.Vector3(rand() * 40, rand() * 40, rand() * 40) };
  const uRust = { value: new THREE.Color('#5f3d28') };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    // Near wall.js's ironwork, and for its reason: with no environment map in
    // the scene the only thing that can show a bar is round is the key light's
    // own specular, and a specular needs metal to land on.
    //
    // Not AT wall.js's numbers, though, and the difference is measured rather
    // than preferred. Its railings are 36 mm bars seen at a distance and are
    // meant to disappear into a silhouette; these are the thing the eye lands
    // on. At metalness 0.55 a metal keeps 45% of its diffuse, and with no
    // environment to reflect, the other 55% is simply gone -- the first render
    // of this gate came back as a flat black cutout with a rust pattern on it.
    // 0.42 keeps enough diffuse for the hexagonal bars to shade round, and the
    // specular is still there to say the material is iron and not paper.
    roughness: 0.52,
    metalness: 0.42,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOffset = uOffset;
    shader.uniforms.uRust = uRust;

    shader.vertexShader = `varying vec3 vObj;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = transformed;');

    shader.fragmentShader = `
      varying vec3 vObj;
      uniform vec3 uOffset;
      uniform vec3 uRust;

      float gateHash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }
      // One octave of value noise and a sine speckle on top. Two octaves were
      // tried and cost eight more sines a fragment for a difference nobody can
      // see on something three pixels wide.
      float gateNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = mix(gateHash(i), gateHash(i + vec3(1.0, 0.0, 0.0)), f.x);
        float b = mix(gateHash(i + vec3(0.0, 1.0, 0.0)), gateHash(i + vec3(1.0, 1.0, 0.0)), f.x);
        float c = mix(gateHash(i + vec3(0.0, 0.0, 1.0)), gateHash(i + vec3(1.0, 0.0, 1.0)), f.x);
        float d = mix(gateHash(i + vec3(0.0, 1.0, 1.0)), gateHash(i + vec3(1.0, 1.0, 1.0)), f.x);
        return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
      }
      ${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // RUST, and it is doing three jobs at once. It is the value range that
        // stops the gate being a silhouette; it is the only warm thing on a
        // black prop, which is what keeps it from going to charcoal against a
        // grey wall; and it is the reason the gate reads as SEIZED rather than
        // merely shut, which is the point of the whole prop.
        //
        // Where it blooms is not random. Iron rusts at the foot, where the wet
        // sits, and in the angles, where the water does not run off -- so the
        // field is biased hard toward the bottom and the top of the gate is
        // very nearly clean.
        vec3 rp = vObj + uOffset;
        float gRust = gateNoise(rp * 3.4) * 0.78
                    + 0.22 * (0.5 + 0.5 * sin(rp.x * 27.0) * sin(rp.y * 23.0));
        gRust += 0.34 * (1.0 - smoothstep(0.0, 1.15, vObj.y));
        gRust = smoothstep(0.46, 0.86, gRust);
        diffuseColor.rgb = mix(diffuseColor.rgb, uRust, gRust * 0.56);
        // And the slow half: grimy at the foot, and the paint that is left
        // catches the sky higher up. Without it a two metre gate is one value
        // from top to bottom, which no vertical thing outdoors ever is.
        diffuseColor.rgb *= 0.82 + 0.30 * smoothstep(0.0, 2.9, vObj.y);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Rust is not metal any more. Losing the specular where it has bloomed
        // is most of why the patches read as a different SUBSTANCE rather than
        // as a brown stain painted on iron.
        roughnessFactor = mix(roughnessFactor, 0.93, gRust);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.05, gRust);`,
      );
  };

  // The same trap wall.js and panel.js document: three keys its program cache
  // on the stock shader source, so without this every gate on the page compiles
  // its own program. Nothing in the source varies between gates -- what differs
  // is uniforms -- so one key covers all of them.
  material.customProgramCacheKey = () => 'graveyard-maingate';
  return material;
}

// ---------------------------------------------------------------------------
// one leaf
//
// Built in the gate's own frame with `dir` folded into every x, rather than
// built once and mirrored with a negative scale. A negative scale reverses
// every triangle's winding, and orient() decides winding from the geometry it
// is handed, so folding the sign in means the right leaf comes out correct by
// construction instead of correct by a second fix-up.

function leafPieces(dir, droop, out) {
  const X = (x) => dir * x;
  const hang = X(HANG_X);
  const meet = X(MEET_X);
  // One lean for BOTH leaves and not one per leaf. Leaning them by dir splays
  // the pair apart at the top, which is symmetric, and symmetric damage reads
  // as a style rather than as damage. Leaning them together tips the whole gate
  // the same way the piers are already tipped, and leaves all the asymmetry to
  // the droop, which is where it belongs.
  const add = (geo, colour) => out.push({ geo: rack(geo, hang, droop, LEAN), colour });

  // Where the top rail runs. Its own centre line, so every station on it can
  // answer "how high is the head here" for the bars that pass through it.
  const head = camber(hang, Y_TOP_HANG, meet, Y_TOP_MEET, 0.045, 10);
  const headAt = (x) => {
    const t = Math.min(1, Math.max(0, (x - hang) / (meet - hang)));
    return Y_TOP_HANG + (Y_TOP_MEET - Y_TOP_HANG) * t + 0.045 * 4 * t * (1 - t);
  };

  // --- the frame ------------------------------------------------------------
  // The hanging stile takes a head too, shorter than the bars beside it. A
  // stile that stops flat while every bar next to it comes to a point reads as
  // an unfinished edge, and it is the edge nearest the pier, where the eye is
  // already comparing the two.
  const hangTop = Y_TOP_HANG + RAIL_TOP[0] / 2 + 0.04;
  add(strut(hang, Y_FOOT, hang, hangTop, rect(STILE_HANG / 2, STILE_HANG / 2)), IRON_FRAME);
  add(sweepPlane([
    { x: hang, y: hangTop - 0.02, s: 1 },
    { x: hang, y: hangTop + 0.045, s: SPEAR_SWELL * 0.9 },
    { x: hang, y: hangTop + 0.30, s: 0.05 },
  ], ngon(STILE_HANG / 2, BAR_SIDES), { smooth: true, capA: false }), IRON_FRAME);

  // The meeting stile carries the tallest head on the leaf, because the two of
  // them together are the middle of the gate and the middle of a gate is where
  // the eye goes.
  const meetTop = Y_TOP_MEET + RAIL_TOP[0] / 2 + 0.06;
  add(strut(meet, Y_FOOT, meet, meetTop, rect(STILE_MEET / 2, STILE_MEET / 2)), IRON_FRAME);
  add(sweepPlane([
    { x: meet, y: meetTop - 0.02, s: 1 },
    { x: meet, y: meetTop + 0.05, s: SPEAR_SWELL },
    { x: meet, y: meetTop + 0.40, s: 0.05 },
  ], ngon(STILE_MEET / 2, BAR_SIDES), { smooth: true, capA: false }), IRON_FRAME);

  // --- the rails ------------------------------------------------------------
  // Ends buried in the stiles, so no cap on either is ever seen and the joint
  // is a joint rather than two boxes touching.
  add(strut(hang, Y_BOT, meet, Y_BOT, rect(RAIL_BOT[0] / 2, RAIL_BOT[1] / 2)), IRON_FRAME);
  add(strut(hang, Y_DOG, meet, Y_DOG, rect(RAIL_DOG[0] / 2, RAIL_DOG[1] / 2)), IRON_FRAME);
  add(sweepPlane(head, rect(RAIL_TOP[0] / 2, RAIL_TOP[1] / 2), { smooth: false }), IRON_FRAME);

  // --- the bars -------------------------------------------------------------
  // Between the two stiles' inner faces, evenly, then the spear head on top of
  // each. SIX of them, and the table at the top of this file is why: seven
  // leaves 1.2 px of hole between 6.2 px of bar at the game's framing, which is
  // a black panel, and the gaps are the whole reason this prop is geometry.
  const a = HANG_X - STILE_HANG / 2;
  const b = MEET_X + STILE_MEET / 2;
  const count = 6;
  const ring = ngon(BAR / 2, BAR_SIDES);
  for (let i = 1; i <= count; i++) {
    const x = X(b + ((a - b) * i) / (count + 1));
    const h = headAt(x);
    add(sweepPlane([
      { x, y: Y_BOT, s: 1 },
      { x, y: h + SPEAR_CLEAR, s: 1 },
      { x, y: h + SPEAR_CLEAR + 0.055, s: SPEAR_SWELL },
      { x, y: h + SPEAR_CLEAR + SPEAR_LEN, s: 0.05 },
    ], ring, { smooth: true, capA: false }), IRON_BAR);
  }

  // --- the dog bars ---------------------------------------------------------
  // The close-barred band at the foot, on the half pitch. It is what an old
  // cemetery gate has and it is also the half of the gate a player reads as
  // "shut": the field above stays open, so the gate is still something you can
  // see through, and only the bottom 400 mm is a thicket.
  const dogRing = ngon(DOG / 2, BAR_SIDES);
  for (let i = 0; i <= count; i++) {
    const x = X(b + ((a - b) * (i + 0.5)) / (count + 1));
    add(strut(x, Y_BOT, x, Y_DOG, dogRing, { smooth: true, capA: false, capB: false }), IRON_BAR);
  }

  // --- the hinge straps -----------------------------------------------------
  // Part of the LEAF and not of the pier, so they rack with it. A strap that
  // has dropped 100 mm while the pintle it hangs on has not is the single
  // clearest picture of a gate that has failed, and it comes free from building
  // the two halves in the two frames they actually belong to.
  for (const y of [Y_BOT, Y_TOP_HANG - 0.06]) {
    const strap = sweepPlane([
      { x: hang - X(0.04), y, s: 1 },
      { x: hang + X(0.30), y, s: 1 },
      { x: hang + X(0.46), y, s: 0.55 },
    ], rect(0.052, 0.016), { smooth: false });
    // On the FACE of the leaf rather than down its middle, which is where a
    // strap hinge goes and is also what stops it reading as a fourth rail. The
    // arena side, because a gate whose hinges can be reached from outside is a
    // gate that comes off its pins.
    strap.translate(0, 0, HARD_Z);
    add(strap, IRON_HARD);
  }
}

// ---------------------------------------------------------------------------
// the fixed frame: what is bolted to the stone and does not hang

function framePieces(out) {
  const add = (geo, colour) => out.push({ geo, colour });

  // --- the overthrow --------------------------------------------------------
  // Two bands and a row of droppers. It ties the two piers together, which is
  // what an overthrow is for, and it is the thing that turns two posts and a
  // gate into a GATEWAY -- without it the piers are just the ends of the wall.
  const outer = camber(-JAMB, ARCH_OUT[0], JAMB, ARCH_OUT[0], ARCH_OUT[1] - ARCH_OUT[0], 18);
  const inner = camber(-JAMB, ARCH_IN[0], JAMB, ARCH_IN[0], ARCH_IN[1] - ARCH_IN[0], 18);
  add(sweepPlane(outer, rect(ARCH_BAND[0] / 2, ARCH_BAND[1] / 2), { smooth: false }), IRON_FRAME);
  add(sweepPlane(inner, rect(ARCH_BAND[0] / 2, ARCH_BAND[1] / 2), { smooth: false }), IRON_FRAME);
  for (let i = 1; i <= ARCH_DROPS; i++) {
    const t = i / (ARCH_DROPS + 1);
    const x = -JAMB + 2 * JAMB * t;
    const yo = ARCH_OUT[0] + (ARCH_OUT[1] - ARCH_OUT[0]) * 4 * t * (1 - t);
    const yi = ARCH_IN[0] + (ARCH_IN[1] - ARCH_IN[0]) * 4 * t * (1 - t);
    add(strut(x, yi, x, yo, ngon(0.026, 5), { smooth: true, capA: false, capB: false }), IRON_BAR);
  }

  // The cross on the crown. Higher than the piers, so it is the last thing on
  // the whole level to catch the light, which is where a cross on a cemetery
  // gate belongs.
  const base = ARCH_OUT[1];
  add(strut(0, base - 0.02, 0, base + CROSS_H, rect(0.030, 0.024)), IRON_FRAME);
  add(strut(-0.13, base + CROSS_H * 0.66, 0.13, base + CROSS_H * 0.66, rect(0.026, 0.022)), IRON_FRAME);

  // --- the pintles ----------------------------------------------------------
  // The lugs the straps hang on, driven into the pier's inner face. They do NOT
  // rack, which is the whole point of building them here.
  for (const s of [-1, 1]) {
    for (const y of [Y_BOT, Y_TOP_HANG - 0.06]) {
      const lug = strut(s * JAMB, y, s * (JAMB - 0.09), y, rect(0.040, 0.030));
      const pin = strut(s * (JAMB - 0.085), y - 0.055, s * (JAMB - 0.085), y + 0.075,
        ngon(0.022, 5), { smooth: true });
      lug.translate(0, 0, HARD_Z);
      pin.translate(0, 0, HARD_Z);
      add(lug, IRON_HARD);
      add(pin, IRON_HARD);
    }
  }
}

// ---------------------------------------------------------------------------
// the chain and the padlock
//
// The one detail that has to survive being ten pixels tall, because it is the
// only thing on the prop that says the gate is not merely closed but CANNOT BE
// OPENED. So it is built big and hung where the eye already is: wrapped round
// both meeting stiles at chest height, with a bight of slack falling in front
// of them and the lock swinging on the bottom of it.

function chainPieces(rand, out) {
  const link = linkGeometry();
  // The chain is wrapped round two stiles that lean, so it leans with them.
  // It does NOT droop with them: it is hanging off the pair, not part of
  // either leaf, and 100 mm of daylight opening up between a chain and the
  // thing it is tied round is the one way this detail could look wrong.
  const chainLean = (CHAIN_Y - Y_FOOT) * LEAN;

  // A closed loop in three dimensions: round the back of both stiles, out to
  // each side, and down the front in a bight.
  const loop = [
    [-0.105, CHAIN_Y + 0.015, -0.085],
    [0.105, CHAIN_Y + 0.015, -0.085],
    [0.140, CHAIN_Y - 0.010, 0.000],
    [0.105, CHAIN_Y - 0.075, 0.090],
    [0.045, CHAIN_Y - 0.250, 0.118],
    [-0.045, CHAIN_Y - 0.255, 0.118],
    [-0.105, CHAIN_Y - 0.075, 0.090],
    [-0.140, CHAIN_Y - 0.010, 0.000],
  ];

  // Walk the loop at a constant pitch so the links touch rather than bunching
  // at the corners, and turn every other one a quarter turn about the run,
  // which is what makes a row of rings read as a chain and not as a string of
  // beads.
  for (const q of loop) q[0] += chainLean;

  const seg = [];
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = new THREE.Vector3(...loop[i]);
    const b = new THREE.Vector3(...loop[(i + 1) % loop.length]);
    const len = a.distanceTo(b);
    seg.push({ a, b, len, at: total });
    total += len;
  }
  const at = (d) => {
    const s = seg.find((q) => d >= q.at && d <= q.at + q.len) || seg[seg.length - 1];
    const t = (d - s.at) / (s.len || 1);
    return {
      p: s.a.clone().lerp(s.b, t),
      t: s.b.clone().sub(s.a).normalize(),
    };
  };

  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < LINK.count; i++) {
    const { p, t } = at((total * (i + 0.5)) / LINK.count);
    const side = new THREE.Vector3().crossVectors(t, up);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    // The link's own plane contains the direction it links along, so its local
    // X is the run and its axis alternates between the two perpendiculars.
    const axis = i % 2 ? side : new THREE.Vector3().crossVectors(side, t).normalize();
    const yAx = new THREE.Vector3().crossVectors(axis, t).normalize();
    const m = new THREE.Matrix4().makeBasis(t, yAx, axis).setPosition(p);
    const g = link.clone();
    g.applyMatrix4(m);
    out.push({ geo: g, colour: IRON_HARD });
  }
  link.dispose();

  // The padlock, on the bottom of the bight. A body and a shackle, and the body
  // is deliberately oversized against a real one: at this camera it is eight
  // pixels tall and a lock that is in proportion is four, which is a smudge.
  const lock = at(total * 0.5);
  const lx = lock.p.x;
  const ly = lock.p.y - 0.085;
  const lz = lock.p.z + 0.010;
  const body = new THREE.BoxGeometry(0.155, 0.190, 0.070);
  body.translate(lx, ly, lz);
  out.push({ geo: body, colour: IRON_HARD });
  const shackle = new THREE.TorusGeometry(0.060, 0.017, 3, 8, Math.PI);
  shackle.rotateZ(0);
  shackle.translate(lx, ly + 0.094, lz);
  out.push({ geo: shackle, colour: IRON_HARD });
  // A keyhole escutcheon, which is one quad's worth of geometry and is the only
  // thing that makes the box read as a lock rather than as a block.
  const face = new THREE.BoxGeometry(0.048, 0.048, 0.016);
  face.translate(lx, ly - 0.024, lz + 0.040);
  out.push({ geo: face, colour: IRON_BAR });

  // A tail of chain hanging free off the wrap. Every chain that was ever put
  // round a gate has one, and it is the piece that stops the wrap reading as a
  // moulded lump.
  const tail = [
    new THREE.Vector3(0.118 + chainLean, CHAIN_Y - 0.05, 0.075),
    new THREE.Vector3(0.150 + chainLean, CHAIN_Y - 0.21, 0.095),
    new THREE.Vector3(0.132 + chainLean, CHAIN_Y - 0.37, 0.088),
  ];
  const tailLink = linkGeometry();
  for (let i = 0; i < 4; i++) {
    const t0 = i / 4;
    const p = tail[0].clone().lerp(tail[1], Math.min(1, t0 * 2))
      .lerp(tail[2], Math.max(0, t0 * 2 - 1));
    const dir = new THREE.Vector3(0.02 * (rand() - 0.5), -1, 0.01).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up.clone().add(new THREE.Vector3(0.3, 0, 0))).normalize();
    const axis = i % 2 ? side : new THREE.Vector3().crossVectors(side, dir).normalize();
    const yAx = new THREE.Vector3().crossVectors(axis, dir).normalize();
    const g = tailLink.clone();
    g.applyMatrix4(new THREE.Matrix4().makeBasis(dir, yAx, axis).setPosition(p));
    out.push({ geo: g, colour: IRON_HARD });
  }
  tailLink.dispose();
}

// ---------------------------------------------------------------------------
// the prop
//
// Origin on the floor at the MIDDLE OF THE OPENING, on the wall's centreline.
// Local +X runs along the wall and local +Z through it, which is the same
// convention panel.js and gate.js use, so a caller that can place one of those
// can place this. There is no hinge node and no angle: see the top of the file.

export function createMainGate({ seed = 1, material = null } = {}) {
  const rand = rng(seed);
  const pieces = [];

  // Which leaf has dropped further is a coin, so a level with two gates in it
  // does not have two identical failures.
  const swap = rand() < 0.5;
  leafPieces(-1, DROOP[swap ? 1 : 0], pieces);
  leafPieces(1, DROOP[swap ? 0 : 1], pieces);
  framePieces(pieces);
  chainPieces(rand, pieces);

  for (const p of pieces) plain(p.geo, p.colour);
  const geometry = mergeGeometries(pieces.map((p) => ({ geometry: p.geo })));
  for (const p of pieces) p.geo.dispose();
  // Written here rather than per piece, which is what lets the hexagonal bars
  // roll and the flat stock crease in one buffer: pieces never share vertices,
  // so the averaging cannot run across a joint, and within a piece it is the
  // ring duplication that decides.
  geometry.computeVertexNormals();

  const own = !material;
  const mat = material || mainGateMaterial({ seed });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  return {
    group,
    mesh,
    // Stated so nobody has to look: this is not a gate that opens.
    passable: false,
    stats: {
      triangles: geometry.index.count / 3,
      vertices: geometry.getAttribute('position').count,
      drawCalls: 1,
    },
    update() {},
    dispose() {
      geometry.dispose();
      if (own) mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// putting them in a wall
//
// Everything below is arithmetic on the wall's own centreline, in the same
// coordinate `gate`, `gaps` and every style change already use: a distance from
// points[0]. So a caller that can place a style change can place one of these.

// Where the gates go on a centred square arena: the middle of the FIRST side
// and the middle of the THIRD.
//
// For the loop createWalledLevel builds -- (-h,-h), (h,-h), (h,h), (-h,h) --
// those two sides are z = -size/2 and z = +size/2, which at this camera are the
// far wall up and to the right of the frame and the near wall down and to the
// left of it. Screen right is (x - z) / sqrt(2) and screen up is -(x + z) /
// sqrt(2), so the midpoint of z = +15 lands at (-10.6, -10.6) and the midpoint
// of z = -15 at (+10.6, +10.6): LOWER LEFT and UPPER RIGHT, which is what was
// asked for. The two are opposite each other through the middle of the arena,
// which is the spine the paths want.
export const mainGateAts = (size = 30) => [size * 0.5, size * 2.5];

// The openings to hand createWall, from the distances.
export const mainGateOpenings = (ats) => ats.map((at) => ({
  at,
  width: MAINGATE.width,
  rise: MAINGATE.pierRise,
  sill: MAINGATE.sill,
}));

// A point on a wall's centreline at a distance from points[0], and the yaw that
// puts a prop's local +X along the run there. The yaw convention is the
// project's own: src/game/world/fence.js's worldYawAlong is atan2(-z, x) on the
// run direction, and this is the same line.
export function mainGateAt(points, at) {
  const n = points.length;
  let total = 0;
  const legs = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    legs.push({ a, b, len, at: total });
    total += len;
  }
  const d = ((at % total) + total) % total;
  const leg = legs.find((l) => d <= l.at + l.len) || legs[legs.length - 1];
  const t = (d - leg.at) / leg.len;
  const dx = (leg.b.x - leg.a.x) / leg.len;
  const dz = (leg.b.z - leg.a.z) / leg.len;
  return {
    at,
    x: leg.a.x + (leg.b.x - leg.a.x) * t,
    z: leg.a.z + (leg.b.z - leg.a.z) * t,
    yaw: Math.atan2(-dz, dx),
  };
}

// Where a main gate MAY go, as the reason it may not rather than a boolean.
//
// This lives here rather than in the level format because every rule in it is a
// fact about the geometry, and the geometry is here. An editor that wants to
// grey out a section, and a loader that wants to drop an opening a hand-edited
// file asked for, both want the same four answers.
//
// Returns [] when every distance is fine, otherwise one { at, why } per fault.
export function mainGateFault(points, ats) {
  const step = WALL.pier.spacing;
  const half = MAINGATE.width / 2;
  const faults = [];

  // Leg lengths, and where each one starts, so an opening can be checked
  // against the leg it falls in.
  const legs = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    legs.push({ at: total, len });
    total += len;
  }

  const sorted = [...ats].sort((p, q) => p - q);
  for (let i = 0; i < sorted.length; i++) {
    const at = sorted[i];
    const say = (why) => faults.push({ at, why });

    // 1. ON THE SECTION LATTICE. Off it, the gate is no longer centred on a
    //    pier, the editor has no control that can express it, and the two half
    //    bays either side come out different lengths.
    if (Math.abs(at / step - Math.round(at / step)) > 1e-6) {
      say(`not on the ${step} unit section lattice`);
    }

    // 2. INSIDE ONE STRAIGHT LEG. A gateway across a corner would need the
    //    jamb piers mitred to each other and the leaves hung out of plane, and
    //    neither this nor wall.js can do it.
    const leg = legs.find((l) => at >= l.at - 1e-6 && at <= l.at + l.len + 1e-6);
    if (!leg) say('past the end of the wall');
    else if (at - half < leg.at - 1e-6 || at + half > leg.at + leg.len + 1e-6) {
      say('the opening runs round a corner');
    } else if (at - half < leg.at + WALL.pier.width || at + half > leg.at + leg.len - WALL.pier.width) {
      // 3. CLEAR OF THE CORNER PIER. A jamb pier standing within a pier's width
      //    of the corner one shares stone with it, and a corner pier is bigger
      //    (WALL.pier.cornerScale), so the two interpenetrate rather than meet.
      say('too near a corner for the jamb pier to stand clear of the corner one');
    }

    // 4. CLEAR OF THE NEXT GATE. Two openings closer than a pier's width apart
    //    would want one pier to be both their jambs, which pierPlan will
    //    happily build and which leaves a two metre island of wall between two
    //    gateways.
    const next = sorted[i + 1];
    if (next !== undefined && next - at < MAINGATE.width + WALL.pier.width) {
      say('too near the next gate');
    }
  }
  return faults;
}

// Both gates for one enclosure, placed and pointed, sharing one material so the
// pair is two draw calls and one program.
//
//   const openings = mainGateOpenings(mainGateAts(30));
//   const wall = createWall({ points, closed: true, gate: openings });
//   const gates = createMainGates({ points, ats: mainGateAts(30) });
//
// The wall and the gates take the SAME distances, which is the only thing a
// caller has to get right, and is why they come from one function.
export function createMainGates({ points, ats = mainGateAts(30), seed = 1 } = {}) {
  const material = mainGateMaterial({ seed });
  const group = new THREE.Group();
  const gates = [];
  let triangles = 0;
  ats.forEach((at, i) => {
    const spot = mainGateAt(points, at);
    const made = createMainGate({ seed: seed * 17 + i * 101, material });
    made.group.position.set(spot.x, 0, spot.z);
    made.group.rotation.y = spot.yaw;
    group.add(made.group);
    gates.push({ ...made, at, x: spot.x, z: spot.z, yaw: spot.yaw });
    triangles += made.stats.triangles;
  });
  return {
    group,
    gates,
    openings: mainGateOpenings(ats),
    stats: { triangles, drawCalls: gates.length },
    update() {},
    dispose() {
      for (const g of gates) g.dispose();
      material.dispose();
    },
  };
}

export default createMainGate;
