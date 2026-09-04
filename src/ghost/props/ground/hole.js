import * as THREE from 'three';
import { addGroundHole } from '../../ground.js';

// A dug grave: a casket-sized pit cut into the floor, earth walls, dark bottom.
//
// The scene's floor is ONE opaque plane at y = 0, so a pit modelled below it is
// simply invisible. The floor has to be cut, and the cut is done in the
// ground's own fragment shader (see addGroundHole in src/ghost/ground.js): a
// rounded-rectangle footprint whose fragments are discarded. Cheap, exact, no
// extra draw call, composes with several holes, and nothing here depends on
// render order.
//
// A discard leaves a hard, aliased edge, so the geometry is built to hide it:
// the pit's lip rolls up out of the ground and its turf skirt overhangs the cut
// by ~0.15 units in every direction. You never see the cut itself, only a
// rolled clay edge sitting on the floor.
//
//   const hole = createGraveHole({ seed: 3 });
//   hole.group.position.set(2, 0, -1);
//   hole.group.rotation.y = 0.4;
//   scene.add(hole.group);
//   hole.registerWith(ground);      // ground = the mesh from createGround()
//
// Without registerWith() you get the pit and an uncut floor covering it, which
// reads as a low mound. The group's origin is the centre of the mouth, and the
// mouth is at y = 0.

// Mouth half extents, corner radius and depth, in scene units against a 1.6
// unit ghost. 2.0 x 0.9 is casket sized.
//
// The depth is not the 1.0 a grave would want, and that is the whole trick. The
// camera looks in at 29 degrees, so a sight line entering over the near lip
// drops one unit for every 1.8 it travels across: at 1.0 deep it lands on the
// pit floor and you read a shallow dish. At 1.45 it lands on the far wall well
// above the bottom, the bottom is never in frame, and what closes the pit is
// darkness rather than a floor. None of the extra depth is ever seen.
const MOUTH_X = 1.0;
const MOUTH_Z = 0.45;
const CORNER = 0.20;
const DEPTH = 1.45;

// How far outside the mouth the floor is cut. The skirt reaches 0.40 out, so
// 0.18 of it always rests on solid floor and covers the discard edge.
const CUT_MARGIN = 0.11;

const TURF = new THREE.Color('#8f949e'); // the floor's own colour
// Warm, but only just: under ACES with a 2.1 key, a saturated brown tilted up
// toward the light comes back as orange and the hole reads as rust.
const SPOIL = new THREE.Color('#877162'); // broken earth around the lip
const EARTH = new THREE.Color('#8a7059'); // upper wall, still catching light
const SUB = new THREE.Color('#584434'); // wall below the light
const DEEP = new THREE.Color('#20180f'); // bottom

// --- small deterministic noise ----------------------------------------------

function hash2(x, y, seed) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Noise sampled around a circle, so it wraps seamlessly along the perimeter.
function ringNoise(t, y, freq, seed) {
  const a = t * Math.PI * 2;
  return vnoise(Math.cos(a) * freq, Math.sin(a) * freq + y, seed) * 2 - 1;
}

// --- the rounded-rectangle outline ------------------------------------------
//
// Every ring of the pit is the same outline offset in or out: a rounded rect of
// half extents (X + i, Z + i) is the core rect (X - CORNER, Z - CORNER) grown
// by CORNER + i in every direction. So each sample is a fixed core point plus a
// fixed outward direction, and a ring is just a radius.

function outline(A, B, rRef, count) {
  const straightV = 2 * B;
  const straightU = 2 * A;
  const arc = (Math.PI / 2) * rRef;
  const segs = [
    { len: straightV, at: (s) => [[A, -B + s], [1, 0]] },
    { len: arc, at: (s) => { const a = (s / arc) * (Math.PI / 2); return [[A, B], [Math.cos(a), Math.sin(a)]]; } },
    { len: straightU, at: (s) => [[A - s, B], [0, 1]] },
    { len: arc, at: (s) => { const a = Math.PI / 2 + (s / arc) * (Math.PI / 2); return [[-A, B], [Math.cos(a), Math.sin(a)]]; } },
    { len: straightV, at: (s) => [[-A, B - s], [-1, 0]] },
    { len: arc, at: (s) => { const a = Math.PI + (s / arc) * (Math.PI / 2); return [[-A, -B], [Math.cos(a), Math.sin(a)]]; } },
    { len: straightU, at: (s) => [[-A + s, -B], [0, -1]] },
    { len: arc, at: (s) => { const a = 1.5 * Math.PI + (s / arc) * (Math.PI / 2); return [[A, -B], [Math.cos(a), Math.sin(a)]]; } },
  ];
  const total = segs.reduce((n, s) => n + s.len, 0);
  const pts = [];
  for (let i = 0; i < count; i++) {
    let s = (i / count) * total;
    for (const seg of segs) {
      if (s <= seg.len || seg === segs[segs.length - 1]) {
        const [core, dir] = seg.at(Math.min(s, seg.len));
        pts.push({ core, dir, t: i / count });
        break;
      }
      s -= seg.len;
    }
  }
  return { pts, perimeter: total };
}

// --- the pit profile ---------------------------------------------------------
//
// (inset, y) walked from the outer edge of the turf skirt, over the rolled lip,
// down the wall and in across the bottom. inset is added to every half extent,
// so a positive inset is outside the mouth.

function profile(depth) {
  const rings = [];
  const push = (inset, y, o = {}) => rings.push({ inset, y, cut: 0, spade: 0, ...o });

  // Turf skirt: sits a few millimetres above the floor and blends to its
  // colour, so the discarded edge underneath is never on screen. Ortho depth
  // is linear, so 4mm of clearance is thousands of depth units: no z-fight.
  // It stays low and narrow: raised any higher it stops reading as broken turf
  // and starts reading as a rubber gasket laid round the hole.
  push(0.22, 0.004, { rim: 1 });
  push(0.170, 0.007);
  push(0.122, 0.013);
  push(0.082, 0.023);
  push(0.048, 0.032);
  // The lip: a rolled clay edge, not a knife cut.
  push(0.026, 0.038, { cut: 0.4 });
  push(0.008, 0.036, { cut: 0.9 });
  push(-0.010, 0.028, { cut: 1 });
  push(-0.026, 0.015, { cut: 1, spade: 0.35 });
  push(-0.038, -0.012, { cut: 1, spade: 0.75 });
  // Wall. Near vertical, with only enough taper to keep it from reading as
  // extruded: the pit has to look dug, not drilled.
  const wallTop = -0.05;
  const wallBottom = -(depth - 0.16);
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    push(-0.045 - 0.030 * f, wallTop + (wallBottom - wallTop) * f, { cut: 1, spade: 1 });
  }
  // A tight fillet into the bottom. Broad and it domes, and a domed bottom is
  // the one part of a pit that reads as a bowl.
  push(-0.105, -(depth - 0.085), { cut: 1, spade: 0.6 });
  push(-0.160, -(depth - 0.025), { cut: 1, spade: 0.25 });
  push(-0.215, -depth, { cut: 1 });
  return rings;
}

// --- geometry ----------------------------------------------------------------

function buildPit({ seed, depth }) {
  const A = MOUTH_X - CORNER;
  const B = MOUTH_Z - CORNER;
  const { pts, perimeter } = outline(A, B, CORNER, 128);
  const rings = profile(depth);
  const cols = pts.length;
  const rows = rings.length;

  // Spade cuts: broad scoops the width of a blade, walked round the perimeter.
  // The count is whole so they wrap. It wants to be low: at one cut every
  // 270mm the wall came out as corduroy, which is a texture, not a dug hole.
  // Everything below is measured against absolute depth in units, not against
  // the pit's total depth: the top metre is all anyone ever sees, and it must
  // not restyle itself if the pit is dug deeper.
  const scoops = Math.max(5, Math.round(perimeter / 0.26));

  const position = new Float32Array(cols * rows * 3 + 3);
  const color = new Float32Array(cols * rows * 3 + 3);
  const c = new THREE.Color();

  for (let r = 0; r < rows; r++) {
    const ring = rings[r];
    const depthF = Math.min(1, Math.max(0, -ring.y / 1.05));
    for (let i = 0; i < cols; i++) {
      const p = pts[i];
      const t = p.t;

      // Displacement along the outward direction. Positive is away from the
      // pit centre, so a scoop bites into the wall.
      let d = 0;
      let cavity = 0;
      if (ring.spade > 0) {
        // Each scoop is a shallow bite out of the wall, with its own width and
        // its own reach down the wall, so no two are the same and none of them
        // runs the full depth. Lobe is 0 on the ridge between cuts, 1 in the
        // middle of one.
        const s = t * scoops + depthF * 0.06;
        const idx = Math.floor(s) % scoops;
        const lobe = 0.5 - 0.5 * Math.cos((s - Math.floor(s)) * Math.PI * 2);
        const bite = 0.35 + 0.9 * hash2(idx, 7, seed);
        const reach = 0.62 + 0.55 * hash2(idx, 19, seed);
        const start = 0.02 + 0.05 * hash2(idx, 31, seed);
        const along = THREE.MathUtils.smoothstep(depthF, start, start + 0.10)
          * (1 - THREE.MathUtils.smoothstep(depthF, reach - 0.20, reach + 0.12));
        d += ring.spade * 0.048 * bite * lobe * along;
        // The hollow of a cut is occluded by the ridges either side of it. The
        // geometry alone gives that away far too gently at this scale, so the
        // cavity is baked in as well: it is what makes the wall read as cut
        // rather than moulded, and it survives being seen from across the
        // scene where the shading difference does not.
        cavity = lobe * along * bite;
        // Terraces. A grave is dug in layers and the wall keeps the shelf
        // between them: a staircase, not a wave, because a soft horizontal
        // step is the one cue that survives being seen from across the scene.
        const layer = depthF * 3.1 + 0.10 * ringNoise(t, 5.0, 1.6, seed + 21);
        const stepF = layer - Math.floor(layer);
        d += ring.spade * 0.030 * (1 - THREE.MathUtils.smoothstep(stepF, 0.0, 0.30));
        // General lumpiness, low frequency so it reads as clay and not grit.
        d += ring.spade * 0.022 * ringNoise(t, depthF * 2.2 + 11.0, 2.6, seed + 3);
      }
      if (ring.rim) {
        // Break the outer edge of the skirt so the floor's grid does not stop
        // at a stamped oval.
        d += 0.032 * ringNoise(t, 0.5, 4.5, seed + 7);
      }
      if (ring.cut > 0 && ring.cut < 1) {
        // Wobble the lip itself, gently: too much and the rolled edge goes
        // crinkly, and it must never wander out past the skirt.
        d += 0.022 * ring.cut * ringNoise(t, 1.7, 1.8, seed + 5);
      }

      const R = CORNER + ring.inset + d;
      const x = p.core[0] + p.dir[0] * R;
      const z = p.core[1] + p.dir[1] * R;
      let y = ring.y;
      if (ring.rim) y = 0.004;
      else if (ring.y > 0) y += 0.010 * ringNoise(t, 2.3, 3.0, seed + 9);

      const k = (r * cols + i) * 3;
      position[k] = x;
      position[k + 1] = y;
      position[k + 2] = z;

      // Colour: turf outside, broken earth over the lip, darkening down the
      // wall. The darkening is doing the work a single key light cannot: it is
      // what turns a lit box into a hole.
      c.copy(EARTH)
        .lerp(SUB, THREE.MathUtils.smoothstep(depthF, 0.16, 0.66))
        .lerp(DEEP, THREE.MathUtils.smoothstep(depthF, 0.58, 1.15));
      c.lerp(SPOIL, THREE.MathUtils.smoothstep(ring.inset, -0.02, 0.05));
      // The turf blend is pushed well out, so the part of the skirt that tilts
      // up into the key is earth. A raised ring of floor-coloured turf catches
      // the light and reads as a rubber gasket laid round the hole.
      c.lerp(TURF, THREE.MathUtils.smoothstep(ring.inset, 0.085, 0.185));
      // Ambient occlusion, and not much of it: the wall has to stay lit enough
      // to show what it is made of. The dark comes from the ramp above and
      // from the near lip's own cast shadow, not from painting the pit black.
      let shade = 1 - 0.20 * THREE.MathUtils.smoothstep(depthF, 0.08, 1.0);
      // The lip rolls over and hangs a little into the pit, so there is a real
      // occlusion line under it. Drawing it is what makes the edge read as a
      // rolled clay lip rather than a printed outline.
      shade *= 1 - 0.26 * THREE.MathUtils.smoothstep(depthF, 0.004, 0.055)
        * (1 - THREE.MathUtils.smoothstep(depthF, 0.06, 0.24));
      shade *= 1 - 0.24 * cavity;
      c.multiplyScalar(shade * (0.95 + 0.10 * ringNoise(t, depthF * 6.0, 9.0, seed + 13)));
      color[k] = c.r;
      color[k + 1] = c.g;
      color[k + 2] = c.b;
    }
  }

  // Bottom cap: one vertex in the middle, slightly dished.
  const centre = cols * rows;
  position[centre * 3] = 0;
  position[centre * 3 + 1] = -depth - 0.02;
  position[centre * 3 + 2] = 0;
  c.copy(DEEP).multiplyScalar(0.8);
  color[centre * 3] = c.r;
  color[centre * 3 + 1] = c.g;
  color[centre * 3 + 2] = c.b;

  const index = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < cols; i++) {
      const j = (i + 1) % cols;
      const a = r * cols + i;
      const b = r * cols + j;
      const d2 = (r + 1) * cols + i;
      const e = (r + 1) * cols + j;
      index.push(a, d2, b, b, d2, e);
    }
  }
  const last = (rows - 1) * cols;
  for (let i = 0; i < cols; i++) {
    index.push(last + i, centre, last + ((i + 1) % cols));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // The whole surface is one sheet, so one normal decides the winding: the
  // outer skirt has to face up. Flip once if the build came out inside-out.
  if (geo.attributes.normal.getY(0) < 0) {
    const idx = geo.getIndex().array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geo.getIndex().needsUpdate = true;
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A dug grave hole. Mouth at y = 0, group origin at the centre of the mouth.
 *
 * The returned object carries, beyond the usual prop contract:
 *   footprint            the rounded rect the floor must lose, in local units
 *   registerWith(ground) cut it out of that floor and keep it in step
 */
export function createGraveHole({ seed = 1, scale = 1 } = {}) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  group.add(inner);

  const geometry = buildPit({ seed, depth: DEPTH });
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    // The skirt is millimetres above the floor. Ortho depth is linear so this
    // is belt and braces, but a grazing camera costs nothing to insure against.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // It does not cast: nothing here stands more than 4cm off the floor, and the
  // key light is steep enough that the near lip's shadow lands below anything
  // the camera can see. Rendering it into the shadow map bought one more draw
  // and an A/B pair that were the same image.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  inner.add(mesh);

  const footprint = {
    halfX: (MOUTH_X + CUT_MARGIN) * scale,
    halfZ: (MOUTH_Z + CUT_MARGIN) * scale,
    radius: (CORNER + CUT_MARGIN) * scale,
  };

  let handle = null;
  let stamp = '';

  function pose() {
    group.updateWorldMatrix(true, false);
    const e = inner.matrixWorld.elements;
    // Column 0 is the local X axis in world space: (cos, 0, -sin) times scale.
    const s = Math.hypot(e[0], e[1], e[2]) || 1;
    return {
      x: e[12],
      z: e[14],
      rotation: Math.atan2(-e[2] / s, e[0] / s),
      halfX: (MOUTH_X + CUT_MARGIN) * s,
      halfZ: (MOUTH_Z + CUT_MARGIN) * s,
      radius: (CORNER + CUT_MARGIN) * s,
    };
  }

  function sync() {
    if (!handle) return;
    const p = pose();
    const next = `${p.x}|${p.z}|${p.rotation}|${p.halfX}`;
    if (next === stamp) return;
    stamp = next;
    handle.set(p);
  }

  return {
    group,
    footprint,
    // Cut this hole out of a floor built by createGround(). Call it after the
    // group is positioned, or just let update() catch up on the next frame.
    registerWith(ground) {
      if (handle) return handle;
      handle = addGroundHole(ground, pose());
      stamp = '';
      sync();
      return handle;
    },
    // Nothing here animates. The one job is keeping the cut under the pit if
    // the caller moves it, which costs one matrix read and no uniform write
    // when it has not moved.
    update() {
      sync();
    },
    dispose() {
      handle?.remove();
      handle = null;
      geometry.dispose();
      material.dispose();
    },
  };
}
