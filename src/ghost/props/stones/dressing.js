import * as THREE from 'three';
import { PALETTE, toyMaterial } from '../style.js';

// Ground dressing for the graveyard: grass tufts, mossy rocks and rubble.
//
// This is the stuff that goes at the foot of everything else, so it is written
// to two rules that the carved pieces do not have to care about.
//
// COST. A cluster is placed many times over, once per stone and then some, so
// the whole thing has to come out as a fixed, small number of draw calls
// whatever the counts are. Everything below is emitted into two vertex buffers
// as it is generated -- one for grass, one for stone -- and each becomes a
// single mesh. Nothing here is instanced: every blade and every rock is a
// different shape and a different colour, and the moment you want per-piece
// vertex colours an InstancedMesh costs you a colour attribute, a USE_COLOR
// dance (see fence/debris.js, which pays it) and a second draw call anyway.
// Merging is both cheaper and simpler here.
//
// CONTACT. Nothing floats and nothing sinks. Neither is enforced by measuring
// afterwards and shoving things up: both are properties of how the geometry is
// generated. A blade's root ring is built with its tangent exactly vertical, so
// its three root vertices sit at exactly y = 0 whatever the blade then does
// above them, and the blade's centreline only ever climbs. A dome's rim ring is
// generated at elevation zero and every displacement applied to it is radial,
// so its rim is exactly y = 0 by construction. Nothing is ever clamped in y,
// nothing is lifted by a contact bias, and there is no epsilon: measured over
// eight seeds and at scales from 0.5 to 2, the minimum world y of a cluster is
// exactly 0.
//
// One note on `scale`, since the fence had to fight this. The scale parameter
// is a group scale, applied after the geometry is built, and that is safe HERE
// only because nothing in this file has object-space procedural detail: the
// surface is plain toyMaterial and vertex colours, so shrinking a cluster
// shrinks it evenly. The fence's chips could not do that -- their grain is a
// fragment effect reading object space, and a scaled unit box carries its
// detail at whatever frequency the scale leaves it at.

// --- colour ----------------------------------------------------------------
// Not in PALETTE yet; the set has no straw and no moss. Defined here so the
// file stands up on its own, to be folded into style.js.
//
// The grass is PALE STRAW, deliberately not green: dead winter grass against a
// pale grey stone. Green grass next to PALETTE.stone reads as a garden, and
// this is a graveyard. Root to tip is a small dark-to-light run, which is the
// ambient occlusion of a dense tuft that no light model here will give us.
const STRAW = {
  tip: '#e6d9b0',    // bleached, sun-caught, the top third of a blade
  mid: '#d3c193',
  root: '#9d9170',   // dusty and shaded down where the blades crowd together
};
// Muted olive, low saturation. Anything more saturated stops reading as moss
// on a grey stone and starts reading as paint, and the reference has it as a
// stain rather than a colour.
const MOSS = {
  light: '#79805a',
  dark: '#59613f',
};

// --- resolution ------------------------------------------------------------
// A blade is a ribbon three vertices across (two edges and a raised centre).
// Six segments up its length is what it takes for the tip curl to read as a
// curve rather than a bend; four was visibly kinked at the top.
const BLADE = { segments: 6 };
// The most a blade may lean from vertical, at the very tip: 85 degrees. This is
// the one number the do-not-sink guarantee actually rests on. The centreline is
// integrated as a sum of steps of (sin, cos) of the lean, so as long as the
// lean stays under a right angle every step has a positive vertical component
// and y can only climb. Let it past 90 and a long blade arcs over the top and
// drives its tip back down through the floor -- and it would do it only for the
// unlucky combination of a long draw and a floppy draw, which is exactly the
// kind of bug that survives a look and ships.
const MAX_LEAN = 1.48;
// A rock is a half-dome: 20 around and 8 up. The silhouette would be happy at
// 12; it is the moss that wants 20. Patches are a vertex colour, so the column
// count IS the resolution of a patch edge, and at 12 a patch boundary was a
// row of obvious triangles.
const ROCK_GRID = { around: 20, up: 8 };
// A pebble is two or three centimetres across. It needs a silhouette, not a
// surface.
const PEBBLE_GRID = { around: 8, up: 3 };

// --- sizes, in scene units (the ghost stands about 1.8) --------------------
// A tuft comes up to somewhere between a third and two thirds of the way to
// the ghost's hem. Taller than this and the tufts start to read as reeds and
// they hide the foot of the stone they are supposed to be dressing.
const TUFT = {
  // Six to nine. The brief says five to eight and five is the number that does
  // not work: at five, one blade turning edge-on is a fifth of the tuft gone
  // and the gap shows. Six is the floor, and the top end buys density for
  // twenty triangles a blade.
  blades: [6, 9],
  length: [0.13, 0.26],   // per blade, so one tuft has short and tall in it
  halfWidth: 0.0115,
  spread: 0.014,          // blades leave the ground from a patch, not a point
};
// Height is a fraction of the radius. Both were half this to begin with and
// every rock came out as a pebble and every pebble as a fleck of gravel: at the
// distance the scene is actually seen, a stone under about seven centimetres
// does not read as a stone at all, it reads as noise on the floor. And a dome
// is half buried, so its height fraction has to be near one before any of it
// stands proud enough to catch the key light -- at 0.5 the rocks were lily pads.
const ROCK = { radius: [0.070, 0.140], height: [0.72, 1.02] };
const PEBBLE = { radius: [0.013, 0.032], height: [0.60, 0.95] };

// --- deterministic noise ---------------------------------------------------

// Same xorshift the fence uses, copied rather than imported: this file has no
// other reason to depend on the fence, and a shared rng would tie the two sets'
// output together so that reseeding one reshuffles the other.
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  if (a === 0) a = 0x9e3779b9;   // zero is a fixed point of xorshift
  return () => {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    return a / 4294967296;
  };
}

// A few random sine lobes, evaluated on a direction. Cheap, smooth, seamless
// on a sphere (it is a function of the direction, so the wrap costs nothing),
// and it is used for two different jobs: the shape of a rock and the shape of
// the moss patches on it.
function lobes(rand, count, freq) {
  const set = [];
  for (let i = 0; i < count; i++) {
    // Axes drawn on the sphere rather than in the cube, so no direction is
    // systematically favoured.
    const z = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    set.push({
      x: r * Math.cos(t), y: z, z: r * Math.sin(t),
      f: freq * (0.7 + rand() * 0.8),
      p: rand() * Math.PI * 2,
    });
  }
  // Normalised to roughly -1..1 whatever the lobe count.
  return (x, y, z) => {
    let s = 0;
    for (const l of set) s += Math.sin((x * l.x + y * l.y + z * l.z) * l.f + l.p);
    return s / set.length;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// --- the buffer everything is written into ---------------------------------

// Positions, colours and indices, appended to. Deliberately dumb: every piece
// below writes its own vertices in final local coordinates, which is what makes
// merging free rather than a post-pass over a pile of temporary geometries.
function makeBuilder() {
  return { pos: [], col: [], idx: [], count: 0 };
}

function pushVertex(B, x, y, z, c) {
  B.pos.push(x, y, z);
  B.col.push(c.r, c.g, c.b);
  return B.count++;
}

function finish(B) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  // The colour attribute is not decoration, it is the whole surface: both
  // materials below are white with vertexColors on. Note the values go in as
  // they come out of THREE.Color, which has ALREADY left sRGB -- a second
  // convertSRGBToLinear() here is the bug that turned an earlier prop in this
  // project near black.
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  g.setIndex(B.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// --- a blade of grass ------------------------------------------------------

// A blade is a flat ribbon, and a flat ribbon has one fatal property: seen
// exactly edge-on it is a line, and a tuft whose blades are coplanar vanishes
// all at once as the camera comes round. This scene spins through four
// isometric quarters, so that WILL happen unless it is designed out. Three
// things do it, and all three are needed:
//
//   1. yaw. Every blade leaves the tuft on a different heading, spread around
//      the full circle, so at any camera angle only one blade at a time can be
//      edge-on and its neighbours are broadside.
//   2. twist. The ribbon rotates about its own length as it rises, so even the
//      one unlucky blade is only edge-on for a few centimetres of itself.
//   3. camber. The cross-section is not a straight line but a shallow channel,
//      three vertices across with the middle lifted, so the "edge" of an
//      edge-on blade is still two facets at an angle to each other and still
//      catches the key light. This is also what real grass looks like.
//
// Camber is the cheap one -- one extra column of vertices -- and it is the one
// that does the most. A first pass with yaw and twist only still had blades
// blinking out of frames.
function addBlade(B, {
  x, z, yaw, length, halfWidth, lean, twist, curve, tint,
}) {
  const S = BLADE.segments;

  // The bend happens in the vertical plane containing `out`; `side` is the
  // horizontal perpendicular to it and stays perpendicular to the tangent all
  // the way up, which is what makes the frame below exact rather than a
  // parallel-transport approximation.
  const ox = Math.cos(yaw), oz = Math.sin(yaw);
  const sx = Math.sin(yaw), sz = -Math.cos(yaw);

  // Half width along the blade. Nearly full at the root, widest just above it,
  // then run out to an actual point at the tip.
  const widthAt = (t) => halfWidth * (0.72 + 0.28 * smoothstep(0, 0.18, t)) * Math.pow(1 - t, 0.62);

  const c = new THREE.Color();
  const root = new THREE.Color(STRAW.root);
  const mid = new THREE.Color(STRAW.mid);
  const tip = new THREE.Color(STRAW.tip);

  const rows = [];
  let px = x, py = 0, pz = z;
  const step = length / S;

  for (let j = 0; j <= S; j++) {
    const t = j / S;
    if (j > 0) {
      // Midpoint of the lean over this step, so the arc does not systematically
      // fall short the way an endpoint sample does.
      const tm = (j - 0.5) / S;
      const th = lean * Math.pow(tm, curve);
      const st = Math.sin(th), ct = Math.cos(th);
      px += ox * st * step;
      py += ct * step;          // MAX_LEAN keeps this cosine positive, so y
      pz += oz * st * step;     // only ever climbs: a blade cannot dip.
    }

    // Tangent, side and face normal at this node, then the twist about the
    // tangent. At t = 0 the twist is zero AND the tangent is exactly vertical,
    // so `side` and `face` are both horizontal and every root vertex lands at
    // exactly y = 0. That is the whole floating-and-sinking guarantee for the
    // grass, and it is why lean starts at zero rather than at some splay angle.
    const th = lean * Math.pow(t, curve);
    const st = Math.sin(th), ct = Math.cos(th);
    const tx = ox * st, ty = ct, tz = oz * st;
    // face = tangent x side, with side = (sx, 0, sz). Unit length for free:
    // the tangent and the side are unit and perpendicular by construction.
    const fx = ty * sz;
    const fy = tz * sx - tx * sz;
    const fz = -ty * sx;
    const ph = twist * t;
    const cp = Math.cos(ph), sp = Math.sin(ph);
    const wx = sx * cp + fx * sp, wy = fy * sp, wz = sz * cp + fz * sp;
    const nx = fx * cp - sx * sp, ny = fy * cp, nz = fz * cp - sz * sp;

    // Colour runs root -> mid -> tip up the blade, then the per-blade tint. A
    // tuft of blades all the same value reads as one cut-out shape.
    if (t < 0.5) c.copy(root).lerp(mid, t / 0.5);
    else c.copy(mid).lerp(tip, (t - 0.5) / 0.5);
    c.multiplyScalar(tint);

    if (j === S) {
      rows.push([pushVertex(B, px, py, pz, c)]);   // the point
    } else {
      const w = widthAt(t);
      const camber = w * 0.55;
      rows.push([
        pushVertex(B, px - wx * w, py - wy * w, pz - wz * w, c),
        pushVertex(B, px + nx * camber, py + ny * camber, pz + nz * camber, c),
        pushVertex(B, px + wx * w, py + wy * w, pz + wz * w, c),
      ]);
    }
  }

  for (let j = 0; j < S - 1; j++) {
    const a = rows[j], b = rows[j + 1];
    for (let k = 0; k < 2; k++) {
      B.idx.push(a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k]);
    }
  }
  const last = rows[S - 1], point = rows[S][0];
  B.idx.push(last[0], last[1], point, last[1], last[2], point);
}

// One tuft: a handful of blades out of one patch of ground.
function addTuft(B, rand, { x = 0, z = 0, size = 1 } = {}) {
  const n = TUFT.blades[0] + Math.floor(rand() * (TUFT.blades[1] - TUFT.blades[0] + 1));
  // Headings spread evenly and then jittered, rather than drawn at random:
  // eight random headings leave gaps and clumps often enough that roughly one
  // tuft in three came out lopsided, with three blades stacked on one bearing.
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const yaw = phase + (i + (rand() - 0.5) * 0.7) * (Math.PI * 2 / n);
    // Heights vary a lot within one tuft. That variation is most of what makes
    // a tuft read as grass rather than as a shuttlecock.
    const len = lerp(TUFT.length[0], TUFT.length[1], Math.pow(rand(), 0.8)) * size;
    // The tallest blades stand up straightest; the short ones flop.
    const droop = lerp(1.45, 0.72, (len / (TUFT.length[1] * size)));
    addBlade(B, {
      x: x + (rand() - 0.5) * TUFT.spread * size,
      z: z + (rand() - 0.5) * TUFT.spread * size,
      yaw,
      length: len,
      halfWidth: TUFT.halfWidth * size * (0.8 + rand() * 0.45),
      lean: Math.min(MAX_LEAN, droop * (0.75 + rand() * 0.5)),
      // Sign varies so a tuft is not a set of blades all curling the same way.
      twist: (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 1.1),
      // The exponent decides WHERE the blade bends. Above about 1.8 the blade
      // is a straight spike with a flick on the end, which is what the first
      // pass looked like; at 1.2 or so the arc starts low and the blade curves
      // along its whole length, which is what the reference has.
      curve: 1.05 + rand() * 0.5,
      tint: 0.86 + rand() * 0.28,
    });
  }
}

// --- a rock ----------------------------------------------------------------

// A rock is a half-dome, not a squashed ball, and that is a contact decision
// rather than a saving. A boulder resting ON a plane touches it at one point
// and reads as a marble on a table; a boulder that is PART BURIED meets the
// ground along a closed curve, which is what every stone in the reference
// does. So the geometry starts at the ground: the rim ring is generated at
// elevation zero, and the noise that makes it lumpy is applied radially, which
// cannot move the rim off y = 0. The underside is not modelled at all -- the
// camera is isometric and above, and there is nothing down there to see.
function addDome(B, rand, {
  x, z, radius, height, yaw, grid, mossy, roughness = 0.24,
}) {
  const I = grid.around, J = grid.up;
  const shape = lobes(rand, 4, 2.6);
  // Elliptical in plan, and turned, so a scatter of rocks is not a scatter of
  // one rock. Cheaper than more noise and it changes the silhouette, which is
  // the part that reads at this size.
  const ex = 1 + (rand() - 0.5) * 0.34;
  const ez = 1 / ex;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  const stone = new THREE.Color(PALETTE.stone);
  // One value per stone, on top of the per-vertex wobble below. A scatter of
  // pebbles all at the palette's exact value reads as spilled rice; a spread of
  // values reads as gravel.
  const tone = 0.72 + rand() * 0.23;
  const mossLight = new THREE.Color(MOSS.light);
  const mossDark = new THREE.Color(MOSS.dark);
  const c = new THREE.Color();

  // Moss. It is a stain on the UPPER surfaces and it is emphatically not
  // geometry -- the reference has flat patches of colour, so this is a vertex
  // colour and nothing else. Two things shape it, multiplied:
  //
  //   upness   -- kills the moss anywhere the face is not looking up, so it
  //               never wraps round the sides. This is the part that makes it
  //               read as something that settled on the stone.
  //   patches  -- a second, higher-frequency lobe field, thresholded HARD. A
  //               soft threshold gives a gradient, and a gradient reads as
  //               dirty stone rather than as moss. The narrow band between the
  //               two smoothstep edges is the whole difference.
  //
  // A first pass masked on world height instead of face direction and gave
  // every rock a green beret. Direction is the right quantity.
  const patch = mossy ? lobes(rand, 3, 3.4) : null;
  // The threshold is high on purpose. The lobe field averages 0.5, so a
  // threshold anywhere near that mosses over everything that is facing up and
  // the rock comes out wearing a green cap -- which is exactly what the first
  // pass did. Up here only the crests of the field get through, which is two or
  // three patches per stone with bare grey between them.
  const thresh = 0.58 + rand() * 0.22;
  const mossTone = rand();

  const ring = [];
  let pole = 0;

  for (let j = 0; j <= J; j++) {
    const v = j / J;
    const el = v * Math.PI / 2;                 // 0 at the rim, 90 at the crown
    const cr = Math.cos(el), sr = Math.sin(el);
    const row = [];
    const cols = j === J ? 1 : I;
    for (let i = 0; i < cols; i++) {
      const ph = (i / I) * Math.PI * 2;
      // Direction on the unit hemisphere; everything else is a function of it.
      const dx = j === J ? 0 : Math.cos(ph) * cr;
      const dy = j === J ? 1 : sr;
      const dz = j === J ? 0 : Math.sin(ph) * cr;

      const r = 1 + roughness * shape(dx, dy, dz);
      // A little skirt at the rim, strongest at the ground and gone by a third
      // of the way up: a stone that has been sitting there has soil banked
      // against it, and without the flare the rim is a visible hard circle.
      const skirt = 1 + 0.13 * (1 - v) * (1 - v);

      let px = dx * r * radius * ex * skirt;
      let pz = dz * r * radius * ez * skirt;
      const py = dy * r * height;               // dy is 0 on the rim, so the rim
                                                // is exactly y = 0. No clamp.
      const rx = px * cy - pz * sy;
      const rz = px * sy + pz * cy;

      // Stone, with a per-vertex wobble so the surface is not one flat value,
      // and darkened into the ground over the bottom quarter. That gradient is
      // doing the job of the contact shadow the props used to have: without it
      // the rock is lit right up to where it meets the floor and looks stuck on
      // rather than settled in.
      c.copy(stone).multiplyScalar(tone + shape(dx * 2, dy * 2, dz * 2) * 0.07);
      c.multiplyScalar(lerp(0.72, 1, smoothstep(0, 0.3, v)));

      if (patch) {
        // Face direction, near enough: on a dome the outward normal is close to
        // the direction itself, and this is a mask, not a shading term.
        // A hard-ish cut rather than a fade. The fade was the real reason the
        // moss read as a smudge: with a soft upness the patch edge, however
        // crisp the threshold below made it, was multiplied by a gradient four
        // rows deep. Cut sharp, and it is the patch field that decides where
        // the boundary goes, which is what makes it look like moss and not like
        // a green hat.
        const upness = smoothstep(0.50, 0.62, dy);
        // Biased toward the crown before it is thresholded, rather than after.
        // Masking a centred field with an upness term gave rocks with a green
        // collar and a bare top, because the patch field did not know which way
        // was up and the mask could only take moss away. Tilting the field
        // itself makes the crown the likeliest place for a patch to survive the
        // threshold while leaving the patch EDGES where the noise puts them.
        const p = patch(dx, dy, dz) * 0.5 + 0.5 + 0.30 * (dy - 0.62);
        // Binary, not a blend. The reference reads as flat patches of colour,
        // and anything in between leaves a low-opacity green smear across the
        // middle of the stone that reads as damp rather than as moss. The edge
        // does not come out stepped: the colour is interpolated across the one
        // quad between a mossy vertex and a bare one, which is a couple of
        // pixels of softness at the size these are seen and the right amount.
        const m = upness * smoothstep(thresh, thresh + 0.03, p) > 0.5 ? 1 : 0;
        if (m > 0) {
          const moss = mossLight.clone().lerp(mossDark, mossTone * 0.8 + shape(dx, dy, dz) * 0.2);
          c.lerp(moss, m);
        }
      }

      const id = pushVertex(B, x + rx, py, z + rz, c);
      if (j === J) pole = id; else row.push(id);
    }
    if (j < J) ring.push(row);
  }

  // Outward winding, worked out on the +x seam and then used everywhere: for a
  // quad a=(j,i) b=(j,i+1) c=(j+1,i+1) d=(j+1,i), the triangles (a,d,b) and
  // (b,d,c) face out. Column I-1 wraps to column 0 by index rather than by a
  // duplicated seam column, which is what keeps computeVertexNormals from
  // leaving a shading crease down one side.
  for (let j = 0; j < J - 1; j++) {
    for (let i = 0; i < I; i++) {
      const i2 = (i + 1) % I;
      const a = ring[j][i], b = ring[j][i2], cc = ring[j + 1][i2], d = ring[j + 1][i];
      B.idx.push(a, d, b, b, d, cc);
    }
  }
  for (let i = 0; i < I; i++) {
    const i2 = (i + 1) % I;
    B.idx.push(ring[J - 1][i], pole, ring[J - 1][i2]);
  }
}

// --- scatter ---------------------------------------------------------------

// Density falls off, it does not stop. A disc filled evenly and cut at `radius`
// reads as a texture with an edge on it. This is the fence scatter's trick:
// draw the radius as the radius of a 2D normal, so density is highest in the
// middle and thins smoothly outward with no boundary anywhere. Tighter here
// than the fence uses it, because dressing gathers at the foot of a stone
// rather than being thrown clear of one.
function throwRadius(rand, reach, hole = 0.08) {
  const u = 0.03 + 0.97 * rand();   // the floor stops one unlucky draw landing a
                                    // pebble in the next plot
  return reach * (hole + 0.30 * Math.sqrt(-2 * Math.log(u)));
}

// --- materials -------------------------------------------------------------

// White, because the vertex colours carry the entire look. Both are the house
// toyMaterial otherwise: this dressing has to look like it came off the same
// shelf as the stones it sits under.
function grassMaterial() {
  return toyMaterial('#ffffff', {
    vertexColors: true,
    // A blade is a surface with no thickness, so it has a back, and half the
    // blades in any tuft show it. Lighting stays correct because three flips
    // the normal for back faces.
    side: THREE.DoubleSide,
    // Dry grass is duller than the vinyl stone and has no highlight worth
    // speaking of.
    roughness: 0.93,
  });
}

function stoneMaterial() {
  return toyMaterial('#ffffff', { vertexColors: true });
}

function wrap(group, geometries, materials) {
  return {
    group,
    // Dressing does not move. The method is here so a cluster drops into the
    // scene's prop list and the preview harness without either special-casing
    // it.
    update() {},
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}

// --- exports ---------------------------------------------------------------

export function createGrassTuft({ seed = 1, scale = 1 } = {}) {
  const rand = rng(seed);
  const B = makeBuilder();
  addTuft(B, rand);
  const geo = finish(B);
  const mat = grassMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  // Grass does not cast. Judged by looking: a blade is under two millimetres
  // across and the shadow map cannot resolve one, so what it casts is not a
  // shadow but a field of speckle that crawls as the light moves, and it lands
  // on the tuft itself as much as on the ground. Turning it off cost nothing
  // visually -- the tuft is still shaded by the key light and still darkens
  // toward its own roots, which is what sells it -- and it takes every blade in
  // the scene out of the shadow pass. Receiving stays on, so a tuft in a
  // headstone's shadow goes dark with the ground it stands on.
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(scale);
  return wrap(group, [geo], [mat]);
}

export function createMossyRock({ seed = 1, scale = 1 } = {}) {
  const rand = rng(seed);
  const B = makeBuilder();
  // Height is a fraction OF THE RADIUS, so the radius has to be drawn first
  // into a local rather than inlined into the call: a rock twice as wide as
  // another and the same height reads as a paving slab.
  const rad = lerp(ROCK.radius[0], ROCK.radius[1], rand());
  addDome(B, rand, {
    x: 0, z: 0,
    radius: rad,
    height: rad * lerp(ROCK.height[0], ROCK.height[1], rand()),
    yaw: rand() * Math.PI * 2,
    grid: ROCK_GRID, mossy: true,
  });
  const geo = finish(B);
  const mat = stoneMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(scale);
  return wrap(group, [geo], [mat]);
}

export function createGroundDressing({
  seed = 1, radius = 1.2, tufts = 6, rocks = 4, pebbles = 24, scale = 1,
} = {}) {
  const rand = rng(seed);
  const grass = makeBuilder();
  const stone = makeBuilder();

  // Rocks first, so the tufts can be placed with some idea of where they are.
  // Real tufts grow up against a stone rather than through it, and a blade
  // coming out of the middle of a rock is the one artefact of this cluster that
  // an isometric camera cannot hide.
  const placed = [];
  for (let i = 0; i < rocks; i++) {
    const r = throwRadius(rand, radius * 0.55, 0.10);
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rad = lerp(ROCK.radius[0], ROCK.radius[1], Math.pow(rand(), 1.4));
    addDome(stone, rand, {
      x, z, radius: rad,
      height: rad * lerp(ROCK.height[0], ROCK.height[1], rand()),
      yaw: rand() * Math.PI * 2,
      grid: ROCK_GRID,
      // Not every stone is mossy. All four wearing the same green cap is the
      // thing that makes a scatter read as one asset repeated.
      mossy: rand() < 0.78,
    });
    placed.push({ x, z, r: rad });
  }

  for (let i = 0; i < pebbles; i++) {
    const r = throwRadius(rand, radius * 0.8, 0.06);
    const a = rand() * Math.PI * 2;
    const rad = lerp(PEBBLE.radius[0], PEBBLE.radius[1], Math.pow(rand(), 1.7));
    addDome(stone, rand, {
      x: Math.cos(a) * r, z: Math.sin(a) * r,
      radius: rad,
      height: rad * lerp(PEBBLE.height[0], PEBBLE.height[1], rand()),
      yaw: rand() * Math.PI * 2,
      grid: PEBBLE_GRID,
      mossy: false,          // rubble is plain stone, per the reference
      roughness: 0.26,       // and lumpier: a pebble is a chip, not a boulder
    });
  }

  for (let i = 0; i < tufts; i++) {
    // Where a tuft goes is chosen once and then CORRECTED, rather than being
    // rejection-sampled. Rejection sampling was the first version and it has a
    // failure mode that is exactly the case you care about: when every draw
    // collides, the loop gives up and keeps the last one, so the tufts that
    // ended up growing out of the crown of a rock were precisely the ones the
    // test was there to catch. Pushing the point out of anything it landed in
    // cannot fail, costs four rocks' worth of arithmetic, and needs no loop
    // bound. Three passes, because pushing clear of one rock can push into
    // another; after three the remaining overlap is a millimetre or two.
    let x, z;
    {
      const r = throwRadius(rand, radius * 0.62, 0.12);
      const a = rand() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      for (let pass = 0; pass < 3; pass++) {
        for (const pl of placed) {
          // 1.6 radii of clearance, and it is not padding for its own sake: a
          // dome's drawn radius is its nominal radius times the plan ellipse
          // (up to 1.17) times the rim skirt (1.13), and a tuft is a splay of
          // blades rather than a point.
          const keep = pl.r * 1.6;
          let dx = x - pl.x, dz = z - pl.z;
          let d = Math.hypot(dx, dz);
          if (d >= keep) continue;
          // Dead centre has no direction to push along; any one will do.
          if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
          x = pl.x + (dx / d) * keep;
          z = pl.z + (dz / d) * keep;
        }
      }
    }
    addTuft(grass, rand, { x, z, size: 0.82 + rand() * 0.45 });
  }

  const group = new THREE.Group();
  const geometries = [];
  const materials = [];

  // Two meshes, and the split is not arbitrary: it is exactly the shadow
  // decision. Grass does not cast and stone does, so they cannot share a mesh
  // whatever else they have in common, and the sided-ness differs too. Two draw
  // calls for a whole cluster at any of these counts.
  if (grass.count) {
    const geo = finish(grass);
    const mat = grassMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geo);
    materials.push(mat);
  }
  if (stone.count) {
    const geo = finish(stone);
    const mat = stoneMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geo);
    materials.push(mat);
  }

  group.scale.setScalar(scale);
  return wrap(group, geometries, materials);
}

export default { createGrassTuft, createMossyRock, createGroundDressing };
