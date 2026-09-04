import * as THREE from 'three';

// A laid gravel path: loose grey chippings, kerb-crisp at the edge, cambered so
// it sheds water and so it has something to SHADE.
//
// Three decisions carry this file, and they are all forced by the same fact:
// the camera is orthographic at about 38 degrees, so a path is seen almost
// edge-on. Its outline is compressed to nearly nothing and the only thing left
// that can say "gravel" is the way light falls across the surface.
//
// 1. THE MASS IS A NORMAL MAP, NOT GEOMETRY. Gravel is thousands of chips.
//    Modelling them is out of the question, and at this camera angle it would
//    also be wasted: a 2 cm chip is a handful of pixels and its silhouette
//    never resolves. What resolves is the shading, so the chips are baked into
//    a procedural height field and read as a normal map plus an albedo with the
//    crevices darkened. Pebbles are drawn as flattened spherical caps and the
//    field takes the highest one at each texel, which is what packs them.
//
// 2. THE SURFACE IS CAMBERED AND SHOULDERED. A flat ribbon with a normal map on
//    it still reads as a stain, because at a glancing angle a plane has one
//    shading value across its whole width. A crown of 3 cm falling away to a
//    steep shoulder gives the ribbon a bright side and a dim side and a defined
//    lip, and that is what makes it read as something laid ON the ground rather
//    than printed on it.
//
// 3. CORNERS ARE FILLETED BEFORE THE RIBBON IS BUILT. The usual failure of
//    ribbon geometry is the mitre at a joint: the outer corner stretches into a
//    fan of long thin triangles and the inner one folds through itself. Rather
//    than mitre harder, the polyline's corners are replaced with tangent arcs
//    and the whole thing is resampled at a fixed step, so no joint in the
//    geometry ever turns more than a few degrees and there is no mitre to get
//    wrong. A laid path turns on a curve anyway; a knife-edge corner in gravel
//    is not a thing that exists.
//
// The instanced chips on top are NOT the mass. They are there for the rim: the
// one place the silhouette does resolve is where the path edge crosses the
// floor, and a perfectly smooth rim line gives the game away. A few hundred
// real pebbles straddling that line break it, and cost one draw call.

// --- z-fighting ------------------------------------------------------------
//
// The floor is an opaque plane at exactly y = 0, so anything coplanar with it
// shimmers. The two answers are lifting the ribbon or polygonOffset, and this
// prop uses polygonOffset, on purpose.
//
// Lifting works, but it buys the shimmer off with a lip. This camera is 38
// degrees above the ground, which is the worst case for a lip: a step of h
// shows up as h/tan(38) ~ 1.3h of exposed vertical wall running the whole
// length of the path, lit differently from both the floor and the top surface.
// On a prop whose entire selling point is a CRISP edge, a bright hairline
// tracing that edge is exactly the artefact you would notice first.
//
// polygonOffset costs nothing visually. The rim sits at y = 0 exactly, so the
// gravel meets the floor with no step at all, and the depth bias resolves the
// tie in the fragment stage where the tie actually lives. The mesh does not
// cast shadows, so there is no second pass with an unbiased material to worry
// about, which is the usual reason polygonOffset comes back to bite.
//
// One honest note, because it was measured rather than assumed. With the
// cambered profile below, the only part of this mesh that is coplanar with the
// floor is the rim ITSELF: the shoulder leaves y = 0 immediately, so the
// contact is a LINE and not an area, and a line of tied fragments does not
// shimmer. Rendered at a grazing angle with the bias switched off, the frame
// comes out identical. So the bias here is not rescuing a broken surface, it
// is a guarantee that the tie along that line and across the flat base of the
// end caps always falls the same way, on any driver, at any depth precision,
// for nothing. The reason a lift is still the wrong answer is unchanged: it
// would buy the same guarantee and hand back a lip.
const OFFSET_FACTOR = -1;
const OFFSET_UNITS = -4;

// --- the cross section -----------------------------------------------------

// Crown height at the centreline, in world units. Three centimetres over a
// 60 cm half width. Below about two the ribbon flattens into a stain at this
// camera angle; above about four it starts to read as a mound of spoil rather
// than as a path somebody laid and rolled.
const CROWN = 0.034;
// Where the gentle camber stops and the shoulder starts, as a fraction of the
// half width. The last tenth is the shoulder, and it is what makes the edge
// crisp: a path that feathers out over a third of its width is a track worn by
// feet, not a path with a kerb line.
const SHOULDER_AT = 0.92;
// How much of the crown is left by the time the shoulder starts.
const SHOULDER_TOP = 0.72;

// Height of the surface at |u| across, u = 0 at the centreline and 1 at the rim.
function profileY(u) {
  const a = Math.min(1, Math.abs(u));
  if (a <= SHOULDER_AT) {
    const t = a / SHOULDER_AT;
    return CROWN * (1 - (1 - SHOULDER_TOP) * t * t);
  }
  const t = (a - SHOULDER_AT) / (1 - SHOULDER_AT);
  // Exponent under 1 so the fall is steepest at the BOTTOM. The shoulder
  // therefore meets the floor close to vertical, which is the whole point, and
  // rolls over softly at the top, which is what keeps it a clay toy rather
  // than a chamfered box.
  return CROWN * SHOULDER_TOP * Math.pow(1 - t, 0.65);
}

// Stations across the ribbon, from the centreline out to one rim. Clustered
// toward the rim, because that is where the profile has all of its curvature
// and a shoulder resolved by two vertices is a bevel.
const ACROSS = 13;
const CROSS_U = Array.from({ length: ACROSS }, (_, j) => {
  const t = j / (ACROSS - 1);
  // Two thirds of the stations land in the outer third.
  return Math.pow(t, 0.62);
});

// Spacing along the path. Fine enough that a fillet arc is smooth and that the
// per-station width wobble reads as a wobble rather than as a polygon.
const STEP = 0.11;

// --- the texture -----------------------------------------------------------

// Side of one tile of gravel, in world units, and the texture resolution used
// for it. A metre at 512 is 2 mm per texel.
const TILE = 1.0;
const TEX = 512;
// Chip radius in world units, and this is the number the first render was lost
// on. Real path chippings are 10 to 20 mm across, and at 10 mm they came out
// THREE PIXELS WIDE at the distance this prop is actually seen from, which is
// not gravel, it is film grain, which the house style forbids outright. So the
// chips are scaled up until they read: 4 to 8 cm across is coarse shingle in
// real life, and on screen it is a rounded pebble you can see the shape of.
// This is the same call every other prop on this shelf has made: the fence's
// grain and the marble's veining are both coarser than life for the same
// reason.
const CHIP_R = [0.020, 0.040];
// A chip's height as a fraction of its own radius. Chippings settle; they are
// not ball bearings sitting on a floor.
const CHIP_FLAT = 0.52;

function mulberry32(a) {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// The palette. Cooler and lighter than the floor's #8f949e, which is the whole
// brief: a made path of grey chippings next to a warm unmade sand path has to
// be tellable apart at a glance, and hue is what does that at this size, not
// detail. Everything here is a desaturated blue-grey; nothing in it is warm.
const GRAVEL = {
  base: '#d4d9e3',
  pale: '#e6e8ee',   // the top of a chip catching the key
  dark: '#b8bfcc',   // a chip that has sat wet
  crevice: '#9ca3b4', // the gap between chips, which is where the depth is
};

// A wrapping box blur, run separably with a running sum so a wide radius costs
// the same as a narrow one. Used to high-pass the height field.
function boxBlurWrap(src, radius) {
  const r = Math.max(1, radius | 0);
  const w = 1 / (2 * r + 1);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < TEX; y++) {
    const row = y * TEX;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + ((k % TEX) + TEX) % TEX];
    for (let x = 0; x < TEX; x++) {
      tmp[row + x] = acc * w;
      acc += src[row + ((x + r + 1) % TEX)] - src[row + ((x - r + TEX) % TEX)];
    }
  }
  for (let x = 0; x < TEX; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((((k % TEX) + TEX) % TEX) * TEX) + x];
    for (let y = 0; y < TEX; y++) {
      out[y * TEX + x] = acc * w;
      acc += tmp[(((y + r + 1) % TEX) * TEX) + x] - tmp[((((y - r + TEX) % TEX)) * TEX) + x];
    }
  }
  return out;
}

// One tile of packed chippings, as an albedo map and a normal map.
//
// Built as a height field rather than as painted circles, because the normal
// map has to be the derivative of the SAME surface the shading of the albedo
// implies. Draw the two independently and the crevices land in one and not the
// other, and the surface reads as a photograph with a bump map bolted on.
function gravelTextures(seed) {
  const rand = mulberry32(seed * 2654435761 + 907);

  const n = TEX * TEX;
  const height = new Float32Array(n);
  // Which chip owns each texel, so the albedo can tint per chip rather than
  // per texel. Per-texel colour is film grain and is banned by the house style.
  const owner = new Int32Array(n).fill(-1);

  // Enough chips to bury the tile several times over. Coverage of one chip is
  // pi r^2; three times over is what stops bald patches showing through where
  // the draw happens to leave a hole.
  const rMid = (CHIP_R[0] + CHIP_R[1]) * 0.5 * (TEX / TILE);
  const count = Math.round((2.6 * TEX * TEX) / (Math.PI * rMid * rMid));

  const tint = [];
  for (let i = 0; i < count; i++) {
    const cx = rand() * TEX;
    const cy = rand() * TEX;
    // Biased small: a laid path is mostly one grade of chipping with a few
    // bigger stones in it, not an even spread of every size.
    const r = (CHIP_R[0] + (CHIP_R[1] - CHIP_R[0]) * Math.pow(rand(), 1.6)) * (TEX / TILE);
    // Chippings are not marbles. An elongated cap with a random heading is the
    // difference between a bed of gravel and a bed of peas, and it costs one
    // rotation per chip.
    const aspect = 1 + rand() * 0.55;
    const ra = r * aspect;
    const rb = r / aspect;
    const ang = rand() * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    // A little settle jitter, so chips do not all peak at the same height and
    // the field gets a coarse unevenness on top of the chip-scale one.
    const peak = r * CHIP_FLAT * (0.72 + rand() * 0.5);
    const bed = (rand() - 0.5) * r * 0.16;
    tint.push(rand());

    const reach = Math.ceil(Math.max(ra, rb)) + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      const py = Math.round(cy) + dy;
      // Wrapping is done on the texel index, so every chip that runs off one
      // edge comes back on the other and the tile is seamless by construction.
      const iy = ((py % TEX) + TEX) % TEX;
      const fy = py - cy;
      for (let dx = -reach; dx <= reach; dx++) {
        const px = Math.round(cx) + dx;
        const fx = px - cx;
        const u1 = (fx * ca + fy * sa) / ra;
        const u2 = (-fx * sa + fy * ca) / rb;
        const d2 = u1 * u1 + u2 * u2;
        if (d2 > 1) continue;
        const ix = ((px % TEX) + TEX) % TEX;
        const h = bed + peak * Math.sqrt(1 - d2);
        const k = iy * TEX + ix;
        if (h > height[k]) { height[k] = h; owner[k] = i; }
      }
    }
  }

  // One soft wrapping blur over the height field. Without it the seam where two
  // chips meet is a step and the normal map fires a one-texel black line along
  // every contact, which at distance aliases into exactly the film grain this
  // surface is not allowed to have. The blur rounds the contact into a valley,
  // which is also what the house style wants: no hard edges anywhere.
  const blur = (src) => {
    const dst = new Float32Array(n);
    for (let y = 0; y < TEX; y++) {
      const ym = ((y - 1 + TEX) % TEX) * TEX;
      const y0 = y * TEX;
      const yp = ((y + 1) % TEX) * TEX;
      for (let x = 0; x < TEX; x++) {
        const xm = (x - 1 + TEX) % TEX;
        const xp = (x + 1) % TEX;
        dst[y0 + x] = (
          src[ym + xm] + 2 * src[ym + x] + src[ym + xp] +
          2 * src[y0 + xm] + 4 * src[y0 + x] + 2 * src[y0 + xp] +
          src[yp + xm] + 2 * src[yp + x] + src[yp + xp]
        ) / 16;
      }
    }
    return dst;
  };
  const blurred = blur(blur(height));

  // The crevice term below darkens the gaps between chips, and it has to be
  // driven by the LOCAL height, not the absolute one. Driven by the absolute
  // height it picks up every place the field happens to run low over a patch
  // several chips wide, and those patches render as blotches a hand's width
  // across: at the distance this prop is seen from that is the only thing you
  // see, and a path covered in blotches is a stain, which is the exact failure
  // the brief warns about. So the field is high-passed against a wide blur of
  // itself first, and what is left is chip-scale and nothing else.
  const wide = boxBlurWrap(blurred, Math.round((CHIP_R[1] * 1.6) * (TEX / TILE)));
  const detail = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { const d = blurred[i] - wide[i]; detail[i] = d; sum += d * d; }
  // Two standard deviations either side covers the field without one deep gap
  // setting the scale for the whole tile.
  const sigma = Math.max(1e-6, Math.sqrt(sum / n)) * 2;

  const base = new THREE.Color(GRAVEL.base);
  const pale = new THREE.Color(GRAVEL.pale);
  const dark = new THREE.Color(GRAVEL.dark);
  const crev = new THREE.Color(GRAVEL.crevice);
  const c = new THREE.Color();

  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);

  // World size of one texel, used to turn the height difference between
  // neighbours into a real slope.
  const texel = TEX / TILE;

  for (let y = 0; y < TEX; y++) {
    const ym = ((y - 1 + TEX) % TEX) * TEX;
    const y0 = y * TEX;
    const yp = ((y + 1) % TEX) * TEX;
    for (let x = 0; x < TEX; x++) {
      const xm = (x - 1 + TEX) % TEX;
      const xp = (x + 1) % TEX;
      const k = y0 + x;

      // --- normal, as the true gradient of the height field ---
      const gx = (blurred[y0 + xp] - blurred[y0 + xm]) * 0.5;
      const gy = (blurred[yp + x] - blurred[ym + x]) * 0.5;
      let nx = -gx;
      let ny = -gy;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv;
      const nzn = nz * inv;
      const o = k * 4;
      normal[o] = (nx * 0.5 + 0.5) * 255;
      // Green is +v, which for the UVs built below runs along +Z. OpenGL
      // convention, which is what three expects.
      normal[o + 1] = (ny * 0.5 + 0.5) * 255;
      normal[o + 2] = (nzn * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;

      // --- albedo ---
      const h = clamp(0.5 + (detail[k] / sigma) * 0.5, 0, 1);
      const who = owner[k];
      const t = who < 0 ? 0.5 : tint[who];
      // Each chip gets one colour off the ramp, so a chip reads as one stone.
      // The spread here is deliberately narrow. A wide one looked right in a
      // close-up and came apart at the distance the prop is actually seen
      // from: neighbouring chips that happen to share a tint clump into
      // blotches a hand's width across, and the path reads as a stained
      // surface rather than an even bed of chippings. Even is the brief.
      c.copy(base);
      if (t < 0.45) c.lerp(dark, ((0.45 - t) / 0.45) * 0.55);
      else c.lerp(pale, ((t - 0.45) / 0.55) * 0.32);
      // Then the crevices go down. This is contact occlusion baked in, and it
      // is doing most of the work: at a glancing angle the key light barely
      // separates one chip from the next, and without a dark line between them
      // the surface flattens back into a stain.
      c.lerp(crev, (1 - smoothstep(0.16, 0.62, h)) * 0.50);
      albedo[o] = c.r * 255;
      albedo[o + 1] = c.g * 255;
      albedo[o + 2] = c.b * 255;
      albedo[o + 3] = 255;
    }
  }

  const make = (data, srgb) => {
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return { map: make(albedo, true), normalMap: make(normal, false) };
}

// Two paths in one graveyard with the same seed are the same gravel, and the
// tile costs about a seventh of a second to bake. Shared and reference counted,
// so a scene that lays four of them pays once and a scene that disposes one of
// them does not pull the texture out from under the other three.
const TEXTURE_CACHE = new Map();

function acquireTextures(seed) {
  let entry = TEXTURE_CACHE.get(seed);
  if (!entry) {
    entry = { tex: gravelTextures(seed), refs: 0 };
    TEXTURE_CACHE.set(seed, entry);
  }
  entry.refs++;
  return entry.tex;
}

function releaseTextures(seed) {
  const entry = TEXTURE_CACHE.get(seed);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  entry.tex.map.dispose();
  entry.tex.normalMap.dispose();
  TEXTURE_CACHE.delete(seed);
}

// --- the centreline --------------------------------------------------------

// Accepts [x, z] pairs, {x, z}, THREE.Vector2 (x, y read as x, z) and
// THREE.Vector3 (x and z read, y ignored). All four turn up in this repo's
// call sites and none of them is more correct than the others.
function toXZ(p) {
  if (Array.isArray(p)) return [p[0], p[1]];
  if (p.isVector3) return [p.x, p.z];
  if (p.isVector2) return [p.x, p.y];
  if (typeof p.z === 'number') return [p.x, p.z];
  return [p.x, p.y];
}

// Replace every corner with a tangent arc. This is the whole answer to the
// bend: a ribbon laid along a filleted polyline never has to mitre, because
// there is no corner left to mitre.
//
// The arc radius wants to be comfortably bigger than the half width, or the
// inner edge still folds. It is clamped by the two segments meeting at the
// corner, because an arc that eats more than half of a segment would run into
// the arc at the far end of it.
function fillet(pts, halfWidth) {
  const target = Math.max(halfWidth * 1.6, 0.5);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1];
    const [vx, vz] = pts[i];
    const [nx2, nz2] = pts[i + 1];
    let ax = vx - px, az = vz - pz;
    let bx = nx2 - vx, bz = nz2 - vz;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    ax /= la; az /= la; bx /= lb; bz /= lb;

    const cosPhi = clamp(ax * bx + az * bz, -1, 1);
    const phi = Math.acos(cosPhi);
    if (phi < 0.03) { out.push(pts[i]); continue; }
    if (phi > Math.PI - 0.02) { out.push(pts[i]); continue; } // a doubling back; nothing sane to do

    const half = phi / 2;
    let d = target * Math.tan(half);
    d = Math.min(d, la * 0.48, lb * 0.48);
    const r = d / Math.tan(half);

    const Ax = vx - ax * d, Az = vz - az * d;
    const Bx = vx + bx * d, Bz = vz + bz * d;
    // Bisector toward the inside of the turn.
    let mx = bx - ax, mz = bz - az;
    const lm = Math.hypot(mx, mz) || 1;
    mx /= lm; mz /= lm;
    const Cx = vx + mx * (r / Math.cos(half));
    const Cz = vz + mz * (r / Math.cos(half));

    let a0 = Math.atan2(Az - Cz, Ax - Cx);
    let a1 = Math.atan2(Bz - Cz, Bx - Cx);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.14));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (sweep * s) / steps;
      out.push([Cx + Math.cos(a) * r, Cz + Math.sin(a) * r]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Walk the polyline at a fixed step. Even spacing is what lets the width wobble
// and the surface noise below be authored in world units rather than per
// vertex, and it is also what keeps the triangles the same size everywhere,
// including round the arcs.
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (seg < 1e-9) continue;
    let t = step - carry;
    while (t <= seg) {
      const f = t / seg;
      out.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]);
      t += step;
    }
    carry = (carry + seg) % step;
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  // Snap the tail onto the real end rather than leaving a stub shorter than a
  // step, which would show as a nicked-off corner at the end of the path.
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) < step * 0.5) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

// --- surface unevenness ----------------------------------------------------
//
// Low frequency only. Gravel is loose, so the top of a laid path is not a
// mathematical surface, but a MADE path has been raked and rolled and its
// unevenness is centimetres over a metre, not over a chip. Chip scale lives in
// the normal map; anything chip-scale in here would fight it.
function lumps(x, z, ph) {
  return (
    0.55 * Math.sin(x * 1.9 + ph[0]) * Math.cos(z * 2.3 + ph[1]) +
    0.30 * Math.sin(x * 4.7 + z * 3.1 + ph[2]) +
    0.15 * Math.cos(x * 3.3 - z * 5.9 + ph[3])
  );
}

// ---------------------------------------------------------------------------

export function createGravelPath({ seed = 1, width = 1.2, points, scale = 1 } = {}) {
  const rand = mulberry32(seed * 2654435761 + 31);
  const phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const halfWidth = Math.max(0.15, width) / 2;

  // A straight six-unit run, so the prop is renderable with no arguments at all.
  const raw = (points && points.length >= 2 ? points : [[0, -3], [0, 3]]).map(toXZ);
  const cleaned = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-5);
  if (cleaned.length < 2) cleaned.push([cleaned[0][0], cleaned[0][1] + 1]);

  const line = resample(fillet(cleaned, halfWidth), STEP);
  const N = line.length;

  // Per-station frame. The tangent is a central difference rather than the
  // forward segment: on an arc the forward segment leans the normal half a step
  // off true, and the two edges then run very slightly out of parallel, which
  // reads as a wobble in the rim exactly where the path is curving.
  const nx = new Float64Array(N);
  const nz = new Float64Array(N);
  const curve = new Float64Array(N);   // signed curvature, + when +n is the inside
  for (let i = 0; i < N; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(N - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    nx[i] = tz; nz[i] = -tx;
  }
  for (let i = 1; i < N - 1; i++) {
    // Turn angle per unit length, signed against the normal.
    const p0 = line[i - 1], p1 = line[i], p2 = line[i + 1];
    const ux = p1[0] - p0[0], uz = p1[1] - p0[1];
    const vx = p2[0] - p1[0], vz = p2[1] - p1[1];
    const lu = Math.hypot(ux, uz) || 1;
    const lv = Math.hypot(vx, vz) || 1;
    const cross = (ux * vz - uz * vx) / (lu * lv);
    const turn = Math.asin(clamp(cross, -1, 1));
    // n is (tz, -tx), so a positive cross product turns AWAY from n and the
    // inner side of that turn is -n. Negating gives the convention used below:
    // a positive curvature means the +n side is the inner one.
    curve[i] = -turn / ((lu + lv) * 0.5);
  }
  curve[0] = curve[1] || 0;
  curve[N - 1] = curve[N - 2] || 0;

  // --- geometry ---
  const cols = ACROSS * 2 - 1;                       // -1 .. +1 across
  const uAcross = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    const k = j - (ACROSS - 1);
    uAcross[j] = Math.sign(k) * CROSS_U[Math.abs(k)];
  }

  const pos = new Float32Array(N * cols * 3);
  const uv = new Float32Array(N * cols * 2);

  // How far across the profile you have actually travelled, including the
  // vertical part. Used for the v coordinate, so the near-vertical shoulder
  // gets its own share of texture instead of a smeared streak of one texel.
  const arc = new Float64Array(cols);
  for (let j = 1; j < cols; j++) {
    const dx = (uAcross[j] - uAcross[j - 1]) * halfWidth;
    const dy = profileY(uAcross[j]) - profileY(uAcross[j - 1]);
    arc[j] = arc[j - 1] + Math.hypot(dx, dy);
  }
  const arcMid = arc[ACROSS - 1];

  for (let i = 0; i < N; i++) {
    const [cx, cz] = line[i];
    const s = i * STEP;
    // Width wobble. Small: a laid path has a straight edge, and this is here to
    // stop the rim being a drawn line, not to make it look worn.
    const wob = 1 + 0.016 * Math.sin(s * 1.7 + phase[0]) + 0.010 * Math.sin(s * 4.3 + phase[1]);
    // Never let the inner edge of a curve fold back through the centreline.
    // With the fillet above this almost never binds; it binds when a caller
    // hands in a hairpin between two very short segments, and then it is the
    // difference between a pinched-looking corner and a knot.
    const k = curve[i];
    const limPos = k > 1e-6 ? Math.min(halfWidth * wob, 0.88 / k) : halfWidth * wob;
    const limNeg = k < -1e-6 ? Math.min(halfWidth * wob, 0.88 / -k) : halfWidth * wob;

    for (let j = 0; j < cols; j++) {
      const u = uAcross[j];
      const hw = u >= 0 ? limPos : limNeg;
      const off = u * hw;
      const x = cx + nx[i] * off;
      const z = cz + nz[i] * off;
      // The surface noise is damped to nothing at the rim, so the rim stays
      // exactly at y = 0 and exactly where the polygonOffset argument above
      // says it is.
      const damp = 1 - smoothstep(0.62, 1.0, Math.abs(u));
      const y = profileY(u) + lumps(x, z, phase) * 0.0055 * damp;

      const o = (i * cols + j) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;

      // World-space UVs, projected on XZ and pushed out by the profile's extra
      // arc length. This is why there is no stretch at a bend and no seam
      // between segments: the texture is nailed to the ground, not to the
      // ribbon's parameterisation, so a corner cannot smear it.
      const across = arc[j] - arcMid;
      const ux = cx + nx[i] * across;
      const uz = cz + nz[i] * across;
      const p = (i * cols + j) * 2;
      uv[p] = ux / TILE;
      uv[p + 1] = uz / TILE;
    }
  }

  const idx = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c2 = a + cols;
      const d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  }

  // End caps. The path stops with a shoulder across it rather than fading out,
  // because a laid path is laid up to something: a gate, a step, the next path.
  // A fade would also put a dip wherever two of these props meet.
  const capBase = N * cols;
  const capPos = [];
  for (const i of [0, N - 1]) {
    for (let j = 0; j < cols; j++) {
      const o = (i * cols + j) * 3;
      capPos.push(pos[o], 0, pos[o + 2]);
    }
  }
  for (let j = 0; j < cols - 1; j++) {
    const t0 = 0 * cols + j;
    const t1 = t0 + 1;
    const b0 = capBase + j;
    const b1 = b0 + 1;
    idx.push(t0, t1, b0, b1, b0, t1);         // start cap, wound outward
    const s0 = (N - 1) * cols + j;
    const s1 = s0 + 1;
    const e0 = capBase + cols + j;
    const e1 = e0 + 1;
    idx.push(s0, e0, s1, s1, e0, e1);         // end cap
  }

  const allPos = new Float32Array(pos.length + capPos.length);
  allPos.set(pos, 0);
  allPos.set(capPos, pos.length);
  const allUV = new Float32Array(uv.length + (capPos.length / 3) * 2);
  allUV.set(uv, 0);
  for (let i = 0; i < capPos.length / 3; i++) {
    allUV[uv.length + i * 2] = capPos[i * 3] / TILE;
    allUV[uv.length + i * 2 + 1] = capPos[i * 3 + 2] / TILE;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(allUV, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // DataTexture, not a canvas, so this works headless as well as in a page.
  const tex = acquireTextures(seed);

  const material = new THREE.MeshStandardMaterial({
    color: tex ? '#ffffff' : GRAVEL.base,
    map: tex?.map || null,
    normalMap: tex?.normalMap || null,
    // Strong enough that the chips read at a glancing angle, short of the point
    // where the crevices go black and the surface stops being a matte toy.
    normalScale: tex ? new THREE.Vector2(0.62, 0.62) : undefined,
    roughness: 0.93,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: OFFSET_FACTOR,
    polygonOffsetUnits: OFFSET_UNITS,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  // A three centimetre crown casts nothing you would ever see, and leaving it
  // out of the shadow pass keeps polygonOffset an argument about one pass.
  mesh.castShadow = false;

  // --- the chips on top ------------------------------------------------------
  //
  // Real pebbles, and only at the scale where real pebbles buy something: the
  // rim. Most of them straddle the edge line, a few sit out on the floor as
  // though they were kicked off, and a scattering sits on the crown so the top
  // surface is not perfectly smooth against the sky at the far end of the path.
  const length = (N - 1) * STEP;
  const chipCount = Math.max(20, Math.round(length * 26));

  // Eight around and six up. These are drawn two to four pixels across; the
  // segments past this buy nothing and there are a couple of hundred of them.
  const unit = new THREE.SphereGeometry(1, 8, 6);
  {
    // Lumped, so a chip is a pebble rather than an egg. One shape for all of
    // them; the rotation and the three independent scales do the variety.
    const p = unit.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const f = 1 + 0.16 * Math.sin(v.x * 3.1 + 1.2) * Math.cos(v.z * 2.7)
        + 0.10 * Math.sin(v.y * 4.3 + 0.6);
      p.setXYZ(i, v.x * f, v.y * f, v.z * f);
    }
    unit.computeVertexNormals();
    // White vertex colours, because instanceColor only reaches the fragment
    // under USE_COLOR, which is material.vertexColors -- and with that on and
    // no colour attribute present the shader reads the disabled attribute's
    // default of black and every chip renders black. This has cost this repo a
    // prop before; see fence/debris.js.
    const white = new Float32Array(p.count * 3).fill(1);
    unit.setAttribute('color', new THREE.BufferAttribute(white, 3));
  }

  const chipMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });

  const chips = new THREE.InstancedMesh(unit, chipMat, chipCount);
  chips.castShadow = true;
  chips.receiveShadow = true;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const base = new THREE.Color(GRAVEL.base);
    const dark = new THREE.Color(GRAVEL.dark);
    const crev = new THREE.Color(GRAVEL.crevice);

    for (let i = 0; i < chipCount; i++) {
      const f = rand() * (N - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(N - 1, i0 + 1);
      const ft = f - i0;
      const cx = line[i0][0] + (line[i1][0] - line[i0][0]) * ft;
      const cz = line[i0][1] + (line[i1][1] - line[i0][1]) * ft;
      const ndx = nx[i0] + (nx[i1] - nx[i0]) * ft;
      const ndz = nz[i0] + (nz[i1] - nz[i0]) * ft;
      const nl = Math.hypot(ndx, ndz) || 1;

      const side = rand() < 0.5 ? 1 : -1;
      // Seven in ten sit at the rim, which is the only place a real pebble
      // changes the silhouette; the rest are on the crown, keeping the top from
      // reading as a moulded surface where it catches the key.
      //
      // And they sit ON the shoulder rather than off it. An earlier pass threw
      // a fringe of chips several centimetres out onto the floor and the path
      // stopped reading as laid: a spill of scree is what an UNMADE path does,
      // and the sand path in the same frame is the one that should be doing it.
      // Only the last few centimetres of the draw land past the rim.
      let u;
      if (rand() < 0.70) u = side * (0.84 + Math.pow(rand(), 1.5) * 0.22);
      else u = side * Math.pow(rand(), 0.8) * 0.80;

      const r = 0.014 + Math.pow(rand(), 1.7) * 0.017;
      sc.set(r * (0.85 + rand() * 0.5), r * CHIP_FLAT * (0.8 + rand() * 0.6), r * (0.85 + rand() * 0.5));

      const off = u * halfWidth;
      const x = cx + (ndx / nl) * off;
      const z = cz + (ndz / nl) * off;
      // Sit on the surface it is actually on: the profile inside the rim, the
      // floor outside it. Then bed it, because a loose chip settles into the
      // ones under it rather than balancing on top of them.
      const ground = Math.abs(u) <= 1 ? profileY(u) : 0;
      p.set(x, ground + sc.y * 0.34, z);

      e.set((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9);
      q.setFromEuler(e);
      chips.setMatrixAt(i, m.compose(p, q, sc));

      // Deliberately DARKER than the mass, which looks wrong written down and
      // is right on screen. A chip standing proud presents a face pointing
      // straight at the sky, while the mass around it is a field of broken
      // normals averaging well off vertical. Give the two the same albedo and
      // the chips come out as chalk-white pebbles scattered on grey gravel.
      // Taking the instances down about a fifth lands them on the same value.
      const t = rand();
      col.copy(dark);
      if (t < 0.5) col.lerp(crev, ((0.5 - t) / 0.5) * 0.55);
      else col.lerp(base, ((t - 0.5) / 0.5) * 0.60);
      chips.setColorAt(i, col);
    }
    chips.instanceMatrix.needsUpdate = true;
    if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
  }

  const group = new THREE.Group();
  group.add(mesh, chips);
  group.scale.setScalar(scale);

  let disposed = false;
  return {
    group,
    // Gravel does not move. The signature is here because every prop on this
    // shelf has it and a scene should not have to know which ones are static.
    update() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      unit.dispose();
      chipMat.dispose();
      chips.dispose();
      releaseTextures(seed);
      group.clear();
    },
  };
}

export default { createGravelPath };
