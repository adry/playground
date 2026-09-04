import * as THREE from 'three';
import F from '../fence/metrics.js';
import { woodPanelMaterial } from '../fence/panel.js';
import { createDebrisPile, createChipScatter } from '../fence/debris.js';
import S, { PITCH } from './metrics.js';
import { createInteriorShell } from './shell.js';
import {
  rng, paint, upright, lying, easedTop, easedBoth, fuse, at,
  GRAIN_UP, GRAIN_ALONG,
} from './timber.js';

// A wooden shed, built out of the fence's timber.
//
// WHAT MAKES IT MATCH THE FENCE. Not a palette and not a shader: it is the
// same board. Every stick of wood below comes out of fence/wood.js's board(),
// at fence thicknesses, painted with the fence's grain and drawn with
// fence/panel.js's woodPanelMaterial. Nothing in this directory draws a plank,
// picks a wood colour or writes a shader. The two numbers that carry the match
// are the cladding thickness, which IS F.picket.thickness rather than a number
// near it, and the corner rounding, which is F.picket.round. Change either and
// the shed stops being from the same workshop, however good it looks alone.
//
// COST, and why this file merges when debris.js insists on not merging.
// A shed is about sixty boards. Sixty meshes is not a prop. woodPanelMaterial
// reads the grain out of OBJECT space, so a merge is only safe when everything
// going into one geometry already agrees which way the grain runs; see the long
// note at the top of timber.js. Every merge group here is one wall or one roof
// slope, which are exactly the groups where that holds. The shed proper comes
// out at nine draw calls.
//
// FRAME. X runs along the ridge, Z across the span, origin at the centre of the
// footprint on the ground. The door is in the +Z wall and the window in the +X
// gable, which is the pair of faces the scene's isometric camera sees.

const { body, clad, roof, door: DOOR, window: WIN } = S;

const RIDGE_Y = body.wallTop + body.rise;
const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);

// ---------------------------------------------------------------------------
// cladding
//
// One run of vertical boards, laid out first as pure numbers so an opening can
// be snapped to real board edges before any geometry exists. That ordering is
// the point of splitting layout from build: a doorway whose edges fall in the
// middle of two boards has to either cut them lengthwise, which no one does to
// a shed, or leave a ragged jamb. Snapped to the joints either side, the
// opening is bounded by two whole boards and the door leaf is then sized to
// the hole that actually got made, rather than to the hole that was asked for.

function layoutRun(rand, length) {
  const sym = () => rand() * 2 - 1;
  const n = Math.max(3, Math.round(length / clad.width));

  const widths = [];
  const gaps = [];
  for (let i = 0; i < n; i++) {
    widths.push(clad.width * (1 + sym() * clad.jitter.width));
    // Most joints are shut. A third of them have opened, and how far is its own
    // draw, so the open ones are not all open by the same amount.
    gaps.push(i === n - 1 ? 0 : (rand() < clad.gapChance ? rand() * clad.gap : 0));
  }
  // Stretch the whole run to land exactly on the corners. Done to widths and
  // gaps together so the ratio between them is untouched.
  const total = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const k = length / total;

  const boards = [];
  let cursor = -length / 2;
  for (let i = 0; i < n; i++) {
    const w = widths[i] * k;
    boards.push({
      index: i,
      x: cursor + w / 2,
      width: w,
      x0: cursor,
      x1: cursor + w,
      seed: 1 + Math.floor(rand() * 0xffffff),
      twist: sym() * clad.jitter.twist,
      warpSeed: 1 + Math.floor(rand() * 0xffffff),
      // Each board is knocked into the dirt by its own amount, the way the
      // fence's pickets are, so the bottoms of a wall are as uneven as the tops.
      sink: body.sink * (0.35 + rand()),
      // Downward only. A board is cut short of its nominal top, never past
      // it: at a gable end the nominal top IS the underside of the roof, and a
      // board that grew would come through the roof.
      drop: rand() * clad.jitter.drop,
    });
    cursor += w + gaps[i] * k;
  }
  return boards;
}

// Snap a wanted opening out to the joints either side of it. Returns the real
// opening and marks the boards that go.
function snapOpening(boards, want0, want1) {
  let left = null;
  let right = null;
  for (const b of boards) {
    if (b.x1 <= want0 || (b.x0 < want0 && b.x < want0)) left = b;
  }
  for (let i = boards.length - 1; i >= 0; i--) {
    const b = boards[i];
    if (b.x0 >= want1 || (b.x1 > want1 && b.x > want1)) right = b;
  }
  const x0 = left ? left.x1 : boards[0].x0;
  const x1 = right ? right.x0 : boards[boards.length - 1].x1;
  return { x0, x1 };
}

// One clad wall as a single merged geometry.
//
// `top(x)` is the height of the board at x, which is what lets the gable walls
// be the same function as the eave walls: a gable end is not a special piece of
// carpentry, it is the same run of boards cut off along the roof line.
// `openings` are rectangles in the wall's own coordinates that no board crosses.
function cladWall({ boards, top, openings = [] }) {
  const parts = [];

  for (const b of boards) {
    // What is left of this board once the openings have been taken out of it.
    const height = top(b.x) - b.drop;
    let spans = [[-b.sink, height]];
    for (const o of openings) {
      if (b.x1 <= o.x0 || b.x0 >= o.x1) continue;
      const next = [];
      for (const [s0, s1] of spans) {
        if (o.y0 > s0) next.push([s0, Math.min(s1, o.y0)]);
        if (o.y1 < s1) next.push([Math.max(s0, o.y1), s1]);
      }
      spans = next;
    }

    for (const [s0, s1] of spans) {
      const len = s1 - s0;
      if (len < clad.width * 0.4) continue;
      const grounded = s0 <= 0;
      const rand = rng(b.seed + Math.round(s0 * 1000));
      // A board that reaches the dirt is eased at the top only; a stub over a
      // doorway is a cut at both ends and shows both.
      const profile = grounded
        ? easedTop(clad.top.ease * (clad.width / len) * 3, clad.top.take)
        : easedBoth(clad.top.ease * (clad.width / len) * 3, clad.top.take);
      const geo = upright({
        length: len,
        width: b.width,
        thickness: clad.thickness,
        round: clad.round,
        warp: clad.warp,
        profile,
        segments: clad.segments,
        ring: clad.ring,
        rand,
      });
      paint(geo, rand, { axis: GRAIN_UP, groundEnd: grounded });
      parts.push([geo, at(b.x, s0, 0, { ry: b.twist })]);
    }
  }

  return fuse(parts);
}

// ---------------------------------------------------------------------------
// roof
//
// One slope, in its own frame: +X along the ridge, +Y up the slope, +Z out of
// the roof. The parent group carries the pitch, so nothing in here has to think
// about the building.
//
// HOW THE COURSES SIT, because this is what decides whether the roof reads as
// planks or as a textured wedge. Each course laps the one below it, so its
// lower edge rides one board thickness proud of the rafter plane while its
// upper edge comes back down onto it. That means every board is tilted, and
// the tilt is not a free choice: for the pattern to repeat instead of walking
// off the roof, the lower edge of course i+1 has to land exactly where the
// lower edge of course i did, which works out at tan(tilt) = thickness /
// exposure. The payoff is a real shadow line under every course, thrown by the
// key light, which no amount of shading on a flat wedge gives you.

const TILT = Math.atan2(roof.thickness, roof.exposure);

function slopeGeometry({ seed, halfWidth, slopeLen }) {
  const rand = rng(seed);
  const sym = () => rand() * 2 - 1;

  const w = roof.width;
  const t = roof.thickness;
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  // Lower edge height, from the periodicity above.
  const A = t / 2 + w * sin;

  const count = Math.max(2, Math.ceil((slopeLen - w) / roof.exposure) + 1);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const u0 = i * roof.exposure;
    // Ragged ends. Drawn per end, not per board, which is the whole difference
    // between a torn gable edge and a sawn one.
    const outA = roof.runOut[0] + rand() * (roof.runOut[1] - roof.runOut[0]);
    const outB = roof.runOut[0] + rand() * (roof.runOut[1] - roof.runOut[0]);
    const length = 2 * halfWidth + outA + outB;
    const xc = (outB - outA) / 2;

    const geo = lying({
      length,
      width: w * (1 + sym() * 0.06),
      thickness: t,
      round: roof.round,
      warp: roof.warp,
      profile: easedBoth(0.030, 0.34),
      segments: roof.segments,
      ring: roof.ring,
      rand,
    });
    paint(geo, rand, { axis: GRAIN_ALONG, groundEnd: false, weather: 0.06 });

    const uc = u0 + (w / 2) * cos;
    const zc = A - (w / 2) * sin;
    parts.push([geo, at(xc, uc, zc, { rx: -TILT })]);
  }

  return fuse(parts);
}

// ---------------------------------------------------------------------------
// the door leaf
//
// Built in its own frame with the hinge line at x = 0, so the leaf runs from
// the pivot out along +X and hangs off one node and nothing else. See
// DOOR_HINGE at the assembly for the contract that node keeps.

function knobGeometry(rand) {
  const { radius, stem } = DOOR.leaf.knob;
  const ball = new THREE.SphereGeometry(radius, 14, 10);
  const shaft = new THREE.CylinderGeometry(radius * 0.42, radius * 0.5, stem, 10, 1);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, stem / 2);
  ball.translate(0, 0, stem + radius * 0.75);
  // board() geometries carry no UVs, and mergeGeometries will not merge two
  // geometries with different attribute sets. Dropping them here is cheaper
  // than giving every board a UV channel nothing reads.
  ball.deleteAttribute('uv');
  shaft.deleteAttribute('uv');
  const geo = fuse([[ball, null], [shaft, null]]);
  return paint(geo, rand, { axis: GRAIN_UP, groundEnd: false, weather: 0.10 });
}

function doorLeaf({ seed, width, height }) {
  const rand = rng(seed);
  const sym = () => rand() * 2 - 1;
  const L = DOOR.leaf;
  const parts = [];

  // The face: vertical boards, same stock as the walls, cut narrower so four
  // of them make a leaf. Small gaps between, so daylight shows through the door
  // the way it shows through the walls.
  const gap = 0.008;
  const bw = (width - gap * (L.boards - 1)) / L.boards;
  for (let i = 0; i < L.boards; i++) {
    const r = rng(seed + 31 * (i + 1));
    const x = i * (bw + gap) + bw / 2;
    const geo = upright({
      length: height,
      width: bw * (1 + sym() * 0.04),
      thickness: L.thickness,
      round: clad.round,
      warp: clad.warp * 0.6,
      profile: easedBoth(0.028, 0.32),
      segments: clad.segments,
      ring: clad.ring,
      rand: r,
    });
    paint(geo, r, { axis: GRAIN_UP, groundEnd: false });
    parts.push([geo, at(x, 0, 0)]);
  }

  // Two cross braces on the inside face, and one diagonal between them. The
  // braces sit behind the boards, which is where a ledged door's ledges go, so
  // from outside you see boards and from inside you see the frame.
  const bz = -(L.thickness / 2 + L.brace.thickness / 2);
  const braceY = L.brace.at.map((f) => f * height);
  for (const y of braceY) {
    const r = rng(seed + 977 + Math.round(y * 1000));
    const len = width - 0.02;
    const geo = lying({
      length: len,
      width: L.brace.width,
      thickness: L.brace.thickness,
      round: 0.30,
      warp: 0.006,
      profile: easedBoth(0.05, 0.34),
      segments: 8,
      ring: 12,
      rand: r,
    });
    paint(geo, r, { axis: GRAIN_ALONG, groundEnd: false });
    parts.push([geo, at(width / 2, y, bz)]);
  }

  {
    // Corner to corner between the braces, from the bottom brace at the hinge
    // side up to the top brace at the free edge, which is the way round that
    // carries the leaf's weight back onto the hinge.
    const r = rng(seed + 4441);
    const x0 = 0.05;
    const x1 = width - 0.05;
    const y0 = braceY[0] + L.brace.width / 2;
    const y1 = braceY[1] - L.brace.width / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const geo = lying({
      length: len,
      width: L.diagonal.width,
      thickness: L.diagonal.thickness,
      round: 0.30,
      warp: 0.005,
      profile: easedBoth(0.05, 0.34),
      segments: 10,
      ring: 12,
      rand: r,
    });
    paint(geo, r, { axis: GRAIN_ALONG, groundEnd: false });
    parts.push([geo, at((x0 + x1) / 2, (y0 + y1) / 2, bz, { rz: Math.atan2(dy, dx) })]);
  }

  // The knob, on the outside face near the free edge.
  parts.push([
    knobGeometry(rng(seed + 60013)),
    at(width - 0.075, L.knob.at * height, L.thickness / 2),
  ]);

  return fuse(parts);
}

// ---------------------------------------------------------------------------

export function createShed({ seed = 1, scale = 1 } = {}) {
  const rand = rng(seed);
  const wallSeed = () => 1 + Math.floor(rand() * 0xffffff);

  const material = woodPanelMaterial();
  const group = new THREE.Group();
  group.name = 'shed';
  const geometries = [];
  const owned = [];

  const addMesh = (geo, name, parent = group) => {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const flatTop = () => body.wallTop;

  // The gable line, which is the underside of the roof and not the rafter
  // plane. This one cost two renders, so it is written out.
  //
  // The courses lap, so a course's lower edge rides w*sin(TILT) proud of the
  // rafter plane and its upper edge comes back down to the plane. Cut the gable
  // cladding off at the plane and a wedge of daylight opens under every course,
  // all the way up both slopes. Raise it by a constant instead and the boards
  // come THROUGH the roof between the courses, which is what the second render
  // showed: there is no single height that fits, because the surface being
  // fitted to is a sawtooth.
  //
  // So the cladding is cut to the sawtooth. roofUnderside(u) is the perpendicular
  // clearance of the covering course at a distance u up the slope, and dividing
  // it by cos(pitch) turns a perpendicular offset into the vertical one a
  // board's top needs.
  const LAP_RUN = roof.width * Math.cos(TILT);
  const LAP_RISE = roof.width * Math.sin(TILT);
  const roofUnderside = (u) => {
    if (u <= 0) return LAP_RISE;
    const s = u - Math.floor(u / roof.exposure) * roof.exposure;
    return Math.max(0, LAP_RISE * (1 - s / LAP_RUN));
  };
  const gableTop = (x) => {
    const d = Math.abs(x);
    const plane = body.wallTop + body.rise * Math.max(0, 1 - d / body.halfSpan);
    const u = (body.halfSpan + roof.overhang - d) / COS_P;
    // A few millimetres of overlap, so the board is behind the roof rather than
    // exactly touching it and no seam can open through rounding.
    return plane + roofUnderside(u) / COS_P + 0.006;
  };

  // --- the front wall, and the hole in it ----------------------------------
  //
  // Built before the door leaf on purpose. The opening is snapped out to the
  // joints either side of where it was asked for, so how wide the hole actually
  // came out is not known until the boards are laid, and the leaf is sized from
  // that rather than from metrics. Sized the other way round, the leaf and the
  // jamb disagree by whatever the snap moved, which on a door standing open is
  // exactly the gap the eye goes to.
  const eaveLen = 2 * body.halfWidth;
  const frontBoards = layoutRun(rng(wallSeed()), eaveLen);
  const opening = snapOpening(
    frontBoards,
    DOOR.at - DOOR.width / 2,
    DOOR.at + DOOR.width / 2,
  );
  const openW = opening.x1 - opening.x0;

  const frontParts = [];
  {
    const geo = cladWall({
      boards: frontBoards,
      top: flatTop,
      openings: [{ x0: opening.x0, x1: opening.x1, y0: -1, y1: DOOR.height }],
    });
    frontParts.push([geo, null]);
  }
  {
    // The lintel: one board laid flat across the head of the opening, lapping
    // onto the boards either side. It sits proud of the wall face, so it reads
    // as a piece nailed on over the cladding rather than as part of it.
    const r = rng(wallSeed());
    const Ln = DOOR.lintel;
    const len = openW + Ln.over * 2;
    const geo = lying({
      length: len,
      width: Ln.width,
      thickness: Ln.thickness,
      round: 0.30,
      warp: 0.008,
      profile: easedBoth(0.045, 0.34),
      segments: 10,
      ring: 12,
      rand: r,
    });
    paint(geo, r, { axis: GRAIN_ALONG, groundEnd: false });
    frontParts.push([
      geo,
      at((opening.x0 + opening.x1) / 2, DOOR.height + Ln.width / 2,
        clad.thickness / 2 + Ln.thickness / 2 - 0.004),
    ]);
  }
  const front = addMesh(fuse(frontParts), 'shedWallFront');
  front.position.z = body.halfSpan;

  // --- the back wall -------------------------------------------------------
  const back = addMesh(
    cladWall({ boards: layoutRun(rng(wallSeed()), eaveLen), top: flatTop }),
    'shedWallBack',
  );
  back.position.z = -body.halfSpan;
  back.rotation.y = Math.PI;

  // --- the gables ----------------------------------------------------------
  //
  // Shorter by half a board each side so they butt INSIDE the eave walls
  // rather than crossing them at the corner. The eave walls run the full width
  // and cover the joint, which is the way a real shed is clad and also the
  // cheapest way to stop two boards fighting over the same corner.
  const gableLen = 2 * (body.halfSpan - clad.thickness / 2);

  const winBoards = layoutRun(rng(wallSeed()), gableLen);
  const winOpen = snapOpening(winBoards, WIN.at - WIN.width / 2, WIN.at + WIN.width / 2);
  const winParts = [];
  winParts.push([
    cladWall({
      boards: winBoards,
      top: gableTop,
      openings: [{ x0: winOpen.x0, x1: winOpen.x1, y0: WIN.sill, y1: WIN.sill + WIN.height }],
    }),
    null,
  ]);
  {
    // A simple frame: a sill and a head lapping past the opening, two jambs
    // between them, and two thin bars. Nailed on over the cladding, same as the
    // lintel.
    const Fr = WIN.frame;
    const z = clad.thickness / 2 + Fr.thickness / 2 - 0.004;
    const xc = (winOpen.x0 + winOpen.x1) / 2;
    const w = winOpen.x1 - winOpen.x0;
    const y0 = WIN.sill;
    const y1 = WIN.sill + WIN.height;

    for (const y of [y0 - Fr.width / 2, y1 + Fr.width / 2]) {
      const r = rng(wallSeed());
      const geo = lying({
        length: w + Fr.over * 2,
        width: Fr.width,
        thickness: Fr.thickness,
        round: 0.30,
        warp: 0.005,
        profile: easedBoth(0.05, 0.34),
        segments: 8,
        ring: 12,
        rand: r,
      });
      paint(geo, r, { axis: GRAIN_ALONG, groundEnd: false });
      winParts.push([geo, at(xc, y, z)]);
    }
    for (const sx of [-1, 1]) {
      const r = rng(wallSeed());
      const geo = upright({
        length: WIN.height,
        width: Fr.width,
        thickness: Fr.thickness,
        round: 0.30,
        warp: 0.004,
        profile: easedBoth(0.06, 0.34),
        segments: 8,
        ring: 12,
        rand: r,
      });
      paint(geo, r, { axis: GRAIN_UP, groundEnd: false });
      winParts.push([geo, at(xc + sx * (w / 2 + Fr.width / 2), y0, z)]);
    }
    for (let i = 0; i < WIN.bars.count; i++) {
      const r = rng(wallSeed());
      const f = (i + 1) / (WIN.bars.count + 1);
      const geo = upright({
        length: WIN.height + 0.02,
        width: WIN.bars.width,
        thickness: WIN.bars.thickness,
        round: 0.34,
        warp: 0.004,
        profile: easedBoth(0.06, 0.34),
        segments: 8,
        ring: 10,
        rand: r,
      });
      paint(geo, r, { axis: GRAIN_UP, groundEnd: false });
      // Behind the frame, in the plane of the cladding, so the bars read as
      // set into the opening rather than nailed across the front of it.
      winParts.push([geo, at(winOpen.x0 + w * f, y0 - 0.01, 0)]);
    }
  }
  const gableA = addMesh(fuse(winParts), 'shedGableWindow');
  gableA.position.x = body.halfWidth;
  gableA.rotation.y = Math.PI / 2;

  const gableB = addMesh(
    cladWall({ boards: layoutRun(rng(wallSeed()), gableLen), top: gableTop }),
    'shedGableBlank',
  );
  gableB.position.x = -body.halfWidth;
  gableB.rotation.y = -Math.PI / 2;

  // --- the roof ------------------------------------------------------------
  //
  // The eave stands out past the wall face by roof.overhang measured
  // horizontally, so the eave edge hangs BELOW the wall top by that times the
  // pitch. The slope's own origin is that eave edge, which is why the numbers
  // below look like they are hanging the roof off its bottom corner: they are.
  const eaveZ = body.halfSpan + roof.overhang;
  const eaveY = body.wallTop - roof.overhang * (body.rise / body.halfSpan);
  const slopeLen = eaveZ / COS_P;

  for (const sign of [1, -1]) {
    const geo = slopeGeometry({
      // A seed per slope, so the two gable edges are torn differently. Mirroring
      // one slope onto the other would put the same ragged line on both ends of
      // the building, which is the kind of symmetry that reads as a stamp.
      seed: wallSeed(),
      halfWidth: body.halfWidth,
      slopeLen,
    });
    const mesh = addMesh(geo, sign > 0 ? 'shedRoofFront' : 'shedRoofBack');
    mesh.position.set(0, eaveY, sign * eaveZ);
    // Local +Y onto the up-slope direction. Rotating by (pitch - 90) about X
    // sends +Y to (0, sin p, -cos p) and +Z to (0, cos p, sin p), which is the
    // slope's outward normal. The -Z slope is the same thing turned about Y.
    // YXZ order, so the half turn that puts the second slope on the other
    // side of the ridge is applied AFTER the pitch rather than before it. In
    // the default XYZ order the same two angles tip the slope the wrong way
    // and the roof comes out as a folded card.
    mesh.rotation.set(PITCH - Math.PI / 2, sign > 0 ? 0 : Math.PI, 0, 'YXZ');
  }

  {
    // The ridge board: laid flat over the apex, wide across the span and thick
    // in the vertical, which is the one heavy piece on the building and the
    // thing that stops the two slopes meeting in a visible seam.
    const r = rng(wallSeed());
    const R = roof.ridge;
    const len = 2 * body.halfWidth + R.over * 2;
    const geo = lying({
      length: len,
      // lying() puts width along Y and thickness along Z. A ridge cap is thick
      // in the vertical and wide across the span, so the two are swapped here
      // rather than a second primitive being written.
      width: R.thickness,
      thickness: R.width,
      round: R.round,
      warp: 0.010,
      profile: easedBoth(0.035, 0.36),
      segments: 12,
      ring: 14,
      rand: r,
    });
    paint(geo, r, { axis: GRAIN_ALONG, groundEnd: false, weather: 0.08 });
    const mesh = addMesh(geo, 'shedRidge');
    // Sitting on the top course rather than on the rafter line: the courses
    // stand roof.thickness proud of the plane, so the cap has to clear that or
    // it sinks into the roof it is supposed to cover.
    mesh.position.set(0, RIDGE_Y + roof.thickness / COS_P + R.thickness / 2 - 0.028, 0);
  }

  // --- the dark inside -----------------------------------------------------
  const shell = createInteriorShell({
    halfWidth: body.halfWidth - clad.thickness / 2 - S.interior.clearance,
    halfSpan: body.halfSpan - clad.thickness / 2 - S.interior.clearance,
    wallTop: body.wallTop,
    apex: RIDGE_Y - 0.02,
  });
  group.add(shell.mesh);
  owned.push(shell);

  // --- the door ------------------------------------------------------------
  //
  // DOOR_HINGE. The leaf and its knob hang off `doorHinge` and off nothing
  // else, and the node keeps the same contract fence/gate.js's `hinge` keeps,
  // so fence/swing.js can drive it later without anything here changing:
  //
  //   * rotation is IDENTITY when the door is shut. The leaf is modelled in the
  //     shut position and standing open is a value written to rotation.y, not a
  //     pre-rotation baked into the geometry. Nothing else in the shed is
  //     animated, so there is no second node to keep in step.
  //   * position is the pivot, out in the jamb, and is not zero.
  //   * a NEGATIVE rotation.y swings the leaf out into +Z, which is out of the
  //     building. `doorLeafSign` on the returned object reports that, rather
  //     than leaving a physics caller to guess which way its impulses open the
  //     door.
  //
  // Hung on the -X jamb, which is the far one from the scene camera at +X +Z.
  // Hung on the near jamb instead, the open leaf swings toward the camera and
  // stands across its own doorway, and the dark interior the reference is built
  // around is not visible at all. The transcription says "hung on its left
  // edge" without saying whose left, so this is the reading that shows what the
  // door is for.
  const hinge = new THREE.Object3D();
  hinge.name = 'doorHinge';
  const clear = DOOR.leaf.clear;
  hinge.position.set(
    opening.x0 + clear,
    clear * 0.5,
    body.halfSpan + clad.thickness / 2 + DOOR.leaf.thickness / 2,
  );
  group.add(hinge);

  const leafW = openW - clear * 2;
  const leafH = DOOR.height - clear * 1.5;
  const leaf = addMesh(doorLeaf({ seed: wallSeed(), width: leafW, height: leafH }), 'shedDoorLeaf', hinge);
  leaf.name = 'shedDoorLeaf';
  hinge.rotation.y = DOOR.open;

  // --- debris --------------------------------------------------------------
  //
  // Straight out of fence/debris.js, unchanged. A broken plank at the foot of
  // the shed is the same broken plank the fence leaves when a panel goes
  // through, down to the stock it is cut from, and the pile's hard-won bits
  // (planks resting on each other's real vertices, chips built at the size they
  // are seen so their grain does not moire) are not worth re-deriving.
  const pile = createDebrisPile({
    seed: seed * 7 + 13,
    planks: S.debris.pile.planks,
    radius: S.debris.pile.radius,
  });
  pile.group.position.set(body.halfWidth * 0.86, 0, body.halfSpan + 0.22);
  pile.group.rotation.y = 0.5;
  group.add(pile.group);
  owned.push(pile);

  const scatter = createChipScatter({
    seed: seed * 31 + 5,
    count: S.debris.scatter.count,
    radius: S.debris.scatter.radius,
  });
  // Pushed out in front of the shed rather than centred on it: centred, half
  // the litter lands on the floor inside, where it is lit while the room is
  // not and every chip reads as a bright speck floating in the dark.
  scatter.group.position.set(body.halfWidth * 0.25, 0, body.halfSpan + 0.45);
  group.add(scatter.group);
  owned.push(scatter);

  group.scale.setScalar(scale);

  // No painted contact patch, for the reason tombstones.js and panel.js both
  // spell out: a patch laid flat on the floor is the same on the side facing
  // the key light as on the side away from it, so it reads as a stain. A
  // building is the worst case for it, because the patch would have to be the
  // size of the footprint.

  return {
    group,
    // The one moving node, for a caller that wants to hang fence/swing.js off
    // it. See DOOR_HINGE above.
    hinge,
    doorLeafSign: -1,
    doorOpen: DOOR.open,
    update() {},
    dispose() {
      for (const g of geometries) g.dispose();
      for (const o of owned) o.dispose();
      material.dispose();
      group.clear();
    },
  };
}

export default createShed;
