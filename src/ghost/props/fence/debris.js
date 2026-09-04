import * as THREE from 'three';
import F from './metrics.js';
import { board, rng, woodMaterial } from './wood.js';

// The ground debris: what is left lying on the floor where a panel has been
// smashed through.
//
// Two exports, because they are two different problems. The pile is ten-odd
// broken planks resting on each other and it lives or dies on contact and
// height. The scatter is a litter of chips and specks and it lives or dies on
// falloff and cost.
//
// The rule the pile is built on, stated once because everything below is in
// service of it: A PLANK IS DROPPED ONTO WHATEVER IS ALREADY THERE. The pile
// keeps a coarse height field of its own top surface. Each new plank picks a
// heading and a spot, takes its lean from the shape of the field along its own
// length, and is then lowered until its lowest ACTUAL VERTEX touches the column
// beneath it. Nothing is placed at a height somebody chose.
//
// That single rule buys three things at once, which is why it is worth the
// height field. Planks rest ON each other rather than passing through each
// other, because no vertex may go below the field. The pile gains real height,
// because the field grows as planks land on it, so the later ones start higher.
// And nothing can sink through the floor, because the field is zero outside the
// pile and never negative inside it, so "above the field" is "above the ground"
// for free.
//
// Doing this on bounding boxes would not have worked and is the trap: a board's
// box is not its lowest extent once the board is rotated, and a lean of twenty
// degrees puts a corner well under a box that still says it is sitting on the
// floor. Every height decision here reads real vertices through the real
// matrix.

// --- stock -----------------------------------------------------------------
// Debris is not a new kind of timber. Every piece on the ground came off the
// panel, so a fragment's section is a picket's section or a rail's section, and
// its length is a fraction of the piece it broke off. There is no new dimension
// in this file: a pile of boards that are not the fence's boards reads as
// somebody else's rubbish parked next to the fence.
const STOCK = [
  {
    // Picket stock. Seven pickets to two rails in a panel, so most of what ends
    // up on the floor is picket.
    weight: 0.7,
    width: F.picket.width,
    thickness: F.picket.thickness,
    full: F.picket.height,
    cut: [0.34, 1.0],    // a snapped-off stub, through to the whole picket
  },
  {
    // Rail stock: near square in section and much longer. This is where the
    // pile gets the two or three long pieces that give it its span, and the
    // chunkier section is most of what stops the pile reading as ten copies of
    // one board.
    weight: 0.3,
    width: F.rail.depth,
    thickness: F.rail.thickness,
    full: F.panel.length,
    // A rail tears out between pickets, so a fragment is a small whole number
    // of picket bays: about a seventh of the panel up to a little under half.
    cut: [0.16, 0.50],
  },
];

// A plank leaning more than about thirty degrees against another plank slides
// off it and the pile settles flatter. This is a backstop rather than the look:
// the resting fit below rarely asks for more, but when it does (one end up on
// the mound, the other over a hole) the answer has to be capped somewhere.
const MAX_LEAN = 0.52;

// Boards do not land dead flat on a face. A few degrees of roll about their own
// length is what breaks up the parallel-planes look that an unrolled stack has.
// Small on purpose: across a picket's 0.115 width, twelve degrees lifts one
// long edge by more than half the board's own thickness, and a board balanced
// on one edge holds everything above it up in the air.
const MAX_ROLL = 0.13;

// Height field resolution, and the number that governs how tightly the pile
// packs. A plank's top is written into the field by splatting its vertices,
// each over its own cell and the ring around it, so the field stands a cell
// PROUD of the plank's real edge and the next plank up rests that much high.
// At 0.018 (a picket is 0.042 thick) the gap was visible from a low angle as
// daylight between the layers. Everything that samples the field is stepped
// off this value, so tightening it tightens the pile.
const FIELD_CELL = 0.012;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// --- the height field ------------------------------------------------------

function heightField(span) {
  const n = Math.max(8, Math.ceil(span / FIELD_CELL));
  const half = (n * FIELD_CELL) / 2;
  const h = new Float32Array(n * n);

  const index = (x, z) => {
    const i = Math.floor((x + half) / FIELD_CELL);
    const j = Math.floor((z + half) / FIELD_CELL);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  };

  return {
    // Off the edge of the field the answer is the floor. That is deliberate and
    // it is what makes the drop rule and the do-not-sink rule the same rule
    // rather than two rules that have to agree.
    at(x, z) {
      const k = index(x, z);
      return k < 0 ? 0 : h[k];
    },
    // Splat a point in as a max over its own cell and the ring around it. One
    // cell per vertex leaves pinholes between the vertex rings of a board this
    // coarse, and a pinhole in the support is a plank dropping a centimetre
    // into the one below it -- which is exactly the interpenetration the field
    // exists to prevent.
    raise(x, z, y) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const k = index(x + di * FIELD_CELL, z + dj * FIELD_CELL);
          if (k >= 0 && y > h[k]) h[k] = y;
        }
      }
    },
  };
}

// The lean a rigid plank settles to over a given support profile.
//
// A plank dropped on uneven ground does not average the ground, it bridges it:
// it ends up touching the UPPER CONVEX HULL of what is underneath, at two
// points, and it is the hull edge spanning the plank's middle that it comes to
// rest on, because that is where its weight is. Sampling the field and fitting
// a least-squares line instead gives a plank that sinks into every high spot,
// which is the flat-mat look.
function restingLean(support, half) {
  // One sample per field cell along the plank, so a ridge the drop below is
  // going to find cannot fall between two samples up here. When it does, the
  // fit lands the plank flat and the drop then stands it on the one vertex that
  // found the ridge, which is a plank floating on a corner.
  const samples = clamp(Math.round((2 * half) / FIELD_CELL) | 1, 9, 61);
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const u = -half + (2 * half * i) / (samples - 1);
    pts.push({ u, h: support(u) });
  }

  // Upper hull, left to right: keep the right turns, pop the rest.
  const hull = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if ((b.u - a.u) * (p.h - a.h) - (b.h - a.h) * (p.u - a.u) < 0) break;
      hull.pop();
    }
    hull.push(p);
  }

  // Whichever hull edge spans u = 0. If the middle is off the end of the hull
  // the plank is overhanging and would tip; the terminal edge is where it tips
  // to, and MAX_LEAN catches it if that is absurd.
  let a = hull[0];
  let b = hull[hull.length - 1];
  for (let i = 0; i < hull.length - 1; i++) {
    if (hull[i].u <= 0 && hull[i + 1].u >= 0) {
      a = hull[i];
      b = hull[i + 1];
      break;
    }
  }
  if (b.u === a.u) return 0;
  return Math.atan((b.h - a.h) / (b.u - a.u));
}

// --- one broken plank ------------------------------------------------------

// A break tears along the grain into spikes of very different lengths
// (F.splinter). board() varies the section along the length and cannot grow
// separate spikes, so at pile scale the tear is spent where it actually shows:
// the section runs out RAGGEDLY over the last few thicknesses instead of
// stopping square. The run-out length is drawn from the same F.splinter.length
// range the standing panel's spikes are, so the two sets of broken ends come
// out of the same cloth even though they are built by different means.
//
// Tried and rejected: a clean symmetric taper at each end. It reads as a
// sharpened stake, not a break, because the eye reads symmetry as intent.
function tornEnds(length, thickness, rand) {
  const zone = () => {
    const [lo, hi] = F.splinter.length;
    // Capped at a third of the board so a short stub is not all run-out.
    return Math.min(length * 0.33, thickness * (lo + rand() * (hi - lo)));
  };
  const steps = () => {
    const [lo, hi] = F.splinter.count;
    const n = lo + Math.floor(rand() * (hi - lo + 1));
    // 0.45 to 1.25 of the full taper per step: some fibres are torn back to
    // nothing, some are barely nicked. Width and thickness get separate step
    // lists so the end is ragged in both, not a wedge.
    return Array.from({ length: n }, () => 0.45 + rand() * 0.8);
  };

  const ends = [
    { z: zone(), w: steps(), t: steps() },
    { z: zone(), w: steps(), t: steps() },
  ];

  const runOut = (u, arr) => {
    const k = arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
    // Floored well above F.splinter.taper. On the standing panel the taper is
    // the width of one spike's TIP; here it is the width the whole section has
    // run out to, and taking that to nearly nothing gives a sharpened pencil
    // with a rounded nub on the end rather than a torn-off board.
    return Math.max(0.28, 1 - (1 - F.splinter.taper) * (1 - u) * k);
  };

  const profile = (t) => {
    const d0 = t * length;
    const d1 = (1 - t) * length;
    if (d0 < ends[0].z) return [runOut(d0 / ends[0].z, ends[0].w), runOut(d0 / ends[0].z, ends[0].t)];
    if (d1 < ends[1].z) return [runOut(d1 / ends[1].z, ends[1].w), runOut(d1 / ends[1].z, ends[1].t)];
    return [1, 1];
  };

  // board() runs t from 0 at its origin, and the lay-down below puts t = 0 at
  // local -x. Hand the zones back in that order so the colouring can find them.
  return { profile, zones: [ends[0].z, ends[1].z] };
}

function plankGeometry({ length, width, thickness, rand }) {
  const { profile, zones } = tornEnds(length, thickness, rand);

  const geo = board({
    length,
    width,
    thickness,
    // A board is a FLAT thing with the corners knocked off, and the flat is
    // most of what says board. 0.46 was tried first, on the theory that these
    // have been kicked about and rained on since the panel went, and at a
    // picket's 42mm thickness it rounded the section away entirely: the pile
    // came out as a heap of pool noodles. This leaves a chamfer you can see and
    // two faces you can read.
    round: 0.24,
    // Hand-sawn boards are never straight and broken ones are worse. Held under
    // a tenth of the length; past that it reads as rubber rather than timber.
    warp: length * (rand() - 0.5) * 0.055,
    warpAxis: rand() < 0.5 ? 'x' : 'z',
    profile,
    // Segments are set by length rather than fixed, because they do two jobs
    // and the second one sets the rate. They carry the warp and the run-out,
    // which a dozen would do; and they are what writes the plank's top into the
    // height field, which needs the vertex rings landing no further apart than
    // the splat is wide, or the next plank up drops into the gaps between them.
    segments: clamp(Math.round(length / (FIELD_CELL * 1.6)), 10, 44),
    // Fourteen round as well: with the section this flat, ten put a visible
    // kink across the middle of the wide face where two ring vertices had to
    // stand in for a straight run.
    ring: 14,
  });

  // board() runs from its origin along +Y with the width on X. Lay it down
  // here, once, at build time: centred on its own middle, length on X,
  // thickness vertical. Baking it means the placement matrix below is nothing
  // but three angles and a position, which is what makes the drop easy to
  // reason about and easy to trust.
  geo.translate(0, -length / 2, 0);
  geo.rotateZ(-Math.PI / 2);
  geo.rotateX(Math.PI / 2);

  return { geo, zones };
}

// --- the pile --------------------------------------------------------------

export function createDebrisPile({ seed = 1, radius = 0.55, planks = 10, scale = 1 } = {}) {
  const rand = rng(seed);

  const pickStock = () => {
    const r = rand();
    let acc = 0;
    for (const s of STOCK) {
      acc += s.weight;
      if (r < acc) return s;
    }
    return STOCK[STOCK.length - 1];
  };

  // Plan the whole pile before placing any of it, for two reasons: the field
  // can then be sized to what will actually be on it, and the planks can be
  // placed longest first. Longest first matters -- the long pieces make the
  // base and the span, the short stubs come down on top of them. Placing in
  // random length order gives a long board balanced on a heap of stubs, which
  // is not how a panel falls.
  const specs = [];
  for (let i = 0; i < planks; i++) {
    const stock = pickStock();
    const [lo, hi] = stock.cut;
    // Skewed toward the short end, but only just. An even draw gives a pile of
    // similar boards, which reads as stacked lumber. Skewed hard (1.7 was
    // tried) it gives a pile of stubs whose length is barely three times their
    // width, and a board that is not much longer than it is wide is a brick.
    const f = lo + (hi - lo) * Math.pow(rand(), 1.25);
    specs.push({ stock, length: stock.full * f });
  }
  specs.sort((a, b) => b.length - a.length);

  // Two of them are meant to end up propped. The nestling rule below is good
  // at its job -- left to itself it lays every plank into the lowest hollow it
  // can find and the pile comes out a flat mat, which is the other failure the
  // reference rules out. So two pieces, chosen from the second half of the
  // sequence (by then there is a heap for them to catch on) go the other way
  // and keep the candidate that leans HARDEST. Those are the two that give the
  // pile its skyline; everything else settles.
  const propped = new Set(
    specs.length >= 6
      ? [Math.floor(specs.length * 0.45), Math.floor(specs.length * 0.65), Math.floor(specs.length * 0.85)]
      : [],
  );

  const longest = specs.length ? specs[0].length : 0;
  const field = heightField(2 * (radius + longest * 0.5) * 1.08);

  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  // Plain THREE.Color, NOT .convertSRGBToLinear(). Colour management is on, so
  // the constructor has already taken the hex out of sRGB into the working
  // space; converting a second time takes it out twice and the timber comes out
  // near black. Same trap, same reason, as the instance colours in the scatter
  // below -- it has cost this project a prop once already.
  const pale = new THREE.Color(F.wood.pale);
  const torn = new THREE.Color(F.wood.torn);
  const shade = new THREE.Color(F.wood.shade);
  const col = new THREE.Color();

  const m = new THREE.Matrix4();
  const nrm = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (let i = 0; i < specs.length; i++) {
    const { stock, length } = specs[i];
    const { geo, zones } = plankGeometry({
      length,
      width: stock.width,
      thickness: stock.thickness,
      rand,
    });
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const half = length / 2;
    // Each plank gets its own place between the palette's pale and its shade.
    // Every board on exactly F.wood.pale is the single thing that most made an
    // earlier pass read as one moulded object with grooves in it rather than as
    // a dozen loose boards: with no tonal separation the eye has only the
    // silhouette to go on, and inside a pile there is no silhouette.
    const weather = Math.pow(rand(), 1.3) * 0.55;

    // Where it lands. The spread closes as the pile builds, so the later,
    // shorter pieces come down over what is already there.
    //
    // Note that `radius` is the radius of the PILE, not the radius the plank
    // centres are drawn from: a board half a metre long dropped anywhere in a
    // 0.55 disc reaches most of a metre out, and a dozen of those laid at
    // random over that disc do not touch each other. The centres go into the
    // middle of it and the lengths do the rest.
    const k = specs.length > 1 ? i / (specs.length - 1) : 0;
    // 0.68 was tried and the pile came out as an asterisk: with every centre
    // that close in, a dozen planks at a dozen headings all cross at the same
    // point and radiate. Wider, they cross each other in several places, which
    // is what the reference actually shows.
    const spread = radius * 0.82 * (1 - 0.22 * k);

    // Four candidate places, and the plank takes the one it sits LOWEST in.
    //
    // This is the difference between a pile and a cairn, and it is worth the
    // four passes. Dropped at the first spot it is offered, a plank quite often
    // comes down across the peak of the heap, balances on it like a see-saw and
    // holds both of its own ends -- and everything that lands on it after --
    // up in the air. Trying a few spots and keeping the lowest is what a board
    // sliding off a heap does, and it nestles the pile into itself instead of
    // building it upward.
    const wantsProp = propped.has(i);
    let best = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = rand() * Math.PI * 2;
      // Between even-over-the-disc (sqrt) and crowded-at-the-centre (linear).
      const r = spread * Math.pow(rand(), 0.7);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      // Full circle. Crossed at all angles is the whole character of the pile;
      // any bias in the heading and it starts to read as a stack again.
      const yaw = rand() * Math.PI * 2;
      const roll = (rand() - 0.5) * 2 * MAX_ROLL;

      // Under Ry(yaw) the plank's own +x runs along (cos, -sin) in world xz and
      // its width runs along (sin, cos).
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const ox = sy * stock.width * 0.5;
      const oz = cy * stock.width * 0.5;
      const support = (u) => {
        const px = cx + u * cy;
        const pz = cz - u * sy;
        // Highest of three lines across the width: a plank rides the ridge
        // under any part of it, not the ridge under its centreline.
        return Math.max(field.at(px, pz), field.at(px + ox, pz + oz), field.at(px - ox, pz - oz));
      };

      // The lean is READ OFF the pile, not chosen. A plank with one end up on
      // the mound and the other out over bare floor comes out propped, and
      // those are the one or two leaning pieces that give the pile a
      // silhouette. Choosing random lean angles instead gives planks tilted for
      // no visible reason, which the eye reads as floating.
      const lean = clamp(restingLean(support, half), -MAX_LEAN, MAX_LEAN);

      // YZX: roll about the plank's own length first, then the lean about the
      // axis across it, then the heading. In any other order the lean is
      // applied to an axis that has already been swung and stops being a lean.
      euler.set(roll, yaw, lean, 'YZX');
      m.makeRotationFromEuler(euler);
      m.setPosition(cx, 0, cz);

      // The drop. Every vertex, under the real rotation, has to clear the
      // column beneath it; the plank falls by the smallest clearance in the
      // whole set, so it comes to rest touching in one place and above the
      // field everywhere else. This is the line that makes the no-sink
      // guarantee true: field.at() is zero over bare ground, so the worst this
      // loop can do is put a plank's lowest vertex exactly on the floor.
      let drop = Infinity;
      let top = -Infinity;
      for (let vi = 0; vi < pos.count; vi++) {
        p.fromBufferAttribute(pos, vi).applyMatrix4(m);
        const clearance = p.y - field.at(p.x, p.z);
        if (clearance < drop) drop = clearance;
        if (p.y > top) top = p.y;
      }
      // Score on where the plank's own crown ends up, not on where its middle
      // ends up: a long piece leaning off the heap has a low centre and a high
      // end, and it is the high end that reads as perched. The two propped
      // pieces are scored the other way up, on the lean itself.
      const score = wantsProp ? -Math.abs(lean) : top - drop;
      if (best === null || score < best.score) best = { cx, cz, yaw, lean, roll, drop, score };
    }

    euler.set(best.roll, best.yaw, best.lean, 'YZX');
    m.makeRotationFromEuler(euler);
    m.setPosition(best.cx, -best.drop, best.cz);
    nrm.getNormalMatrix(m);

    // Bake straight into the merged buffers. These are static props: ten
    // separate meshes would be ten draw calls for a thing that never moves
    // relative to itself.
    const base = positions.length / 3;
    for (let vi = 0; vi < pos.count; vi++) {
      p.fromBufferAttribute(pos, vi);
      const localX = p.x;
      p.applyMatrix4(m);
      positions.push(p.x, p.y, p.z);

      n.fromBufferAttribute(nor, vi).applyMatrix3(nrm).normalize();
      normals.push(n.x, n.y, n.z);

      // Torn fibre catches the light warmer than a weathered face (F.wood.torn),
      // so the run-out at each end carries it and the length between stays pale.
      const zone = Math.max(1e-4, localX < 0 ? zones[0] : zones[1]);
      const tear = clamp(1 - (half - Math.abs(localX)) / zone, 0, 1);
      col.copy(pale).lerp(shade, weather).lerp(torn, tear * 0.85);

      // A whisper of the shade colour on whatever is nearly touching the
      // ground. The scene's one shadow-casting light comes in at an angle and
      // leaves the undersides of a low pile completely unshaded, which is
      // exactly where the eye looks for contact. Kept to a fifth: more and the
      // pile looks wet.
      const low = clamp(1 - p.y / (stock.thickness * 3), 0, 1);
      col.lerp(shade, low * low * 0.22);
      colors.push(col.r, col.g, col.b);

      // The plank's own surface is now support for whatever lands next.
      field.raise(p.x, p.z, p.y);
    }

    const idx = geo.index.array;
    for (let t = 0; t < idx.length; t++) indices.push(base + idx[t]);
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  merged.computeBoundingSphere();

  // White base colour: the pale and the torn are both in the vertex colours
  // now, and three multiplies the attribute against material.color.
  const material = woodMaterial({ color: 0xffffff, vertexColors: true });

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(scale);

  return {
    group,
    // Debris does not move. The method is here so the pile drops into the prop
    // list and the preview harness without either of them special-casing it.
    update() {},
    dispose() {
      merged.dispose();
      material.dispose();
      group.clear();
    },
  };
}

// --- the scatter -----------------------------------------------------------

// Chip and speck sizes are multiples of the thinnest thing the fence is made
// of, F.picket.thickness. A chip is a piece of a board; there is no separate
// measurement for one and there should not be.
// The draws are skewed by `bias`: with an even draw every chip comes out
// middling and the litter reads as one repeated object. Squared, the short
// stubby ones outnumber the long slivers the way they do in the reference.
const CHIP = {
  length: [0.75, 3.1],   // short chips through to long slivers
  width: [0.30, 1.15],
  thick: [0.22, 0.70],
  bias: 2.0,
};
const GRIT = {
  length: [0.30, 0.85],  // sawdust and grit, below the size where shape means anything
  width: [0.18, 0.42],
  thick: [0.09, 0.20],
  bias: 1.5,
};

// The ground is a plane at y = 0 and a chip lying dead flat all but shares it.
// A fifth of a millimetre of air costs nothing and takes z-fighting off the
// table for good.
const CONTACT_BIAS = 0.0002;

export function createChipScatter({ seed = 1, radius = 1.4, count = 40, scale = 1 } = {}) {
  const rand = rng(seed);

  // Two populations in one call, because they are one thing to look at and two
  // things to draw. Chips still have a readable grain direction; grit is dust
  // and dirt. The split is fixed rather than exposed: the ratio IS what litter
  // looks like, and a caller who wants denser litter wants more of both. The
  // cost of the whole scatter is two draw calls at any count.
  const chipCount = Math.max(1, Math.round(count * 0.28));
  const gritCount = Math.max(1, count - chipCount);

  // One unit piece, scaled per instance. Non-uniform instance scale skews the
  // rounding of the section slightly, which at a centimetre across is not a
  // thing anybody can see, and it is the reason this is two draw calls rather
  // than a hundred. Three segments and an eight-sided ring: a speck needs a
  // silhouette, not a surface.
  const unit = board({ length: 1, width: 0.5, thickness: 0.28, round: 0.55, segments: 3, ring: 8 });
  unit.translate(0, -0.5, 0);
  unit.rotateZ(-Math.PI / 2);
  unit.rotateX(Math.PI / 2);
  unit.computeBoundingSphere();

  // A white colour attribute, and it is not optional. three only multiplies
  // instanceColor into the fragment under USE_COLOR, which is
  // material.vertexColors -- and switching that on with no colour attribute
  // present leaves the shader reading the disabled attribute's default of
  // (0, 0, 0) and every instance renders black. So: white attribute, white
  // material colour, and the instance colours below carry the whole look.
  const white = new Float32Array(unit.attributes.position.count * 3).fill(1);
  unit.setAttribute('color', new THREE.BufferAttribute(white, 3));

  const T = F.picket.thickness;
  const span = ([lo, hi], bias) => T * (lo + (hi - lo) * Math.pow(rand(), bias));

  // Density has to FALL OFF, not stop. A disc filled evenly and cut at `radius`
  // reads as a texture with an edge on it; the reference thins outward for
  // several board-lengths and there is no line anywhere in it. So the radius is
  // drawn as the radius of a 2D normal: density is highest in the middle, falls
  // smoothly outward, and has no edge at all. `radius` is the nominal extent;
  // a handful of pieces land at half as far again, and the eye reads that as
  // stuff thrown outward rather than stuff placed in a circle.
  //
  // The 0.18 is a hole in the middle, where the pile itself stands.
  const throwRadius = (reach) => {
    // Box-Muller's radius. The floor on u is what stops one unlucky draw
    // landing a speck ten metres away.
    const u = 0.02 + 0.98 * rand();
    return reach * (0.14 + 0.38 * Math.sqrt(-2 * Math.log(u)));
  };

  const material = woodMaterial({ color: 0xffffff, vertexColors: true });

  const pale = new THREE.Color(F.wood.pale);
  const torn = new THREE.Color(F.wood.torn);
  const shade = new THREE.Color(F.wood.shade);
  // Sawdust and grit are the same timber seen as a shadow rather than a face:
  // no light gets back out of a speck of dust. Derived by taking the palette's
  // shade colour down in the working space rather than by inventing a brown,
  // so the litter can never drift off the fence's palette. F has no colour for
  // this; if one is ever wanted it belongs in metrics.js as wood.dust.
  const dust = new THREE.Color(F.wood.shade).multiplyScalar(0.30);

  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const col = new THREE.Color();

  const build = (n, size, reach, tipChance, colorFor) => {
    const mesh = new THREE.InstancedMesh(unit, material, n);
    const verts = unit.attributes.position;

    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = throwRadius(reach);
      sc.set(span(size.length, size.bias), span(size.thick, size.bias), span(size.width, size.bias));

      const yaw = rand() * Math.PI * 2;
      // Flat, mostly. One piece in eight or so is tipped up on an edge or
      // caught leaning on its neighbour, and those are what stop the litter
      // reading as printed on the floor.
      const lean = rand() < tipChance ? 0.35 + rand() * 0.5 : rand() * 0.09;
      const about = rand() * Math.PI * 2;
      euler.set(Math.sin(about) * lean, yaw, Math.cos(about) * lean, 'YZX');
      quat.setFromEuler(euler);

      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      m.compose(pos, quat, sc);

      // Same guarantee as the pile, by the same means: find the true lowest
      // vertex UNDER THE ROTATION and stand the piece on it. A tipped-up chip's
      // bounding box says one thing and its actual corner says another.
      let low = Infinity;
      for (let vi = 0; vi < verts.count; vi++) {
        p.fromBufferAttribute(verts, vi).applyMatrix4(m);
        if (p.y < low) low = p.y;
      }
      pos.y = CONTACT_BIAS - low;
      m.compose(pos, quat, sc);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colorFor(col, r / reach));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  };

  const chips = build(chipCount, CHIP, radius, 0.13, (c, t) =>
    // Freshly broken, so chips run warm. Then two things pull them back down.
    // A wide random draw toward the weathered shade, because a scatter of
    // identically pale flecks reads as spilled rice; and distance, because the
    // ones that landed furthest are the ones that have been out there longest,
    // and dimming them is most of what makes the litter fade rather than end.
    c.copy(pale).lerp(torn, 0.25 + rand() * 0.55).lerp(shade, 0.15 + rand() * 0.45 + clamp(t, 0, 1) * 0.3));
  chips.castShadow = true;
  chips.receiveShadow = true;

  // Grit is thrown further than chips are -- dust carries. And it does not cast:
  // a two-millimetre speck's shadow is a shadow-map artefact rather than a
  // shadow, and there are a lot of them.
  const grit = build(gritCount, GRIT, radius * 1.25, 0.04, (c) =>
    c.copy(dust).lerp(shade, rand() * 0.45));
  grit.castShadow = false;
  grit.receiveShadow = true;

  const group = new THREE.Group();
  group.add(chips, grit);
  group.scale.setScalar(scale);

  return {
    group,
    update() {},
    dispose() {
      unit.dispose();
      material.dispose();
      chips.dispose();
      grit.dispose();
      group.clear();
    },
  };
}

export default { createDebrisPile, createChipScatter };
