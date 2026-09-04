import * as THREE from 'three';
import { toyMaterial } from '../style.js';
import { heightToNormalMap, mulberry32 } from '../tombstones.js';

// An unmade sand-and-dirt track for the graveyard floor.
//
// You hand it a polyline in the XZ plane and it lays a ribbon along it, so a
// scene routes a path between plots rather than placing tiles:
//
//   createSandPath({ points: [[-5, 3], [0, 0.5], [4, -2]], width: 1.25 })
//
// Two things drive every decision in here.
//
// 1. The floor (src/ghost/ground.js) is ONE opaque plane at exactly y = 0.
//    A ribbon sitting on it z-fights. The fix used here is polygonOffset on the
//    material, NOT a lift. The ribbon's outer edge is at exactly y = 0, so it
//    cannot show its own thickness as a lip at a grazing angle, and it cannot
//    float over a kerb or a grave lip that is also lying flat. The depth bias
//    settles the coplanar fight in the depth buffer instead, which is where the
//    fight actually is.
//
// 2. The camera is orthographic at about 38 degrees. A flat patch is seen at a
//    glancing angle: its outline is compressed to almost nothing and its
//    SHADING is what the eye reads. A path that is only a lighter colour is a
//    stain. So the ribbon is a surface: a real cambered crown, real wheel
//    hollows sunk into it, a normal map for the scuffs and foot prints too
//    small to be geometry, and a scatter of real half-buried pebbles that catch
//    the key light and throw their own little shadows.
//
// House style is a soft matte clay toy, so every one of those is low contrast
// and long wavelength. No photographic gravel, and nothing at the pixel scale
// that would read as film grain.

const DEFAULT_POINTS = [[-4, 0], [4, 0]];

// Pale warm sand. Lighter than the floor's #8f949e and warmer, but well short
// of a beach: this is dry trodden dirt in an overcast graveyard.
const SAND = '#c3b49b';
// The floor colour, used only to work out what the ribbon's frayed fringe has
// to fade towards so the boundary is a surface petering out and not a cut edge.
const FLOOR = '#8f949e';

// --- small helpers ---------------------------------------------------------

// Smooth 1D value noise, clamped rather than wrapped, so a long path never
// walks back into noise it has already used. `cells` is how many unit cells the
// caller will ask for; t is measured in cells.
function makeNoise(rng, cells) {
  const a = new Float32Array(Math.max(2, Math.ceil(cells) + 3));
  for (let i = 0; i < a.length; i++) a[i] = rng() * 2 - 1;
  const last = a.length - 2;
  return (t) => {
    const x = t < 0 ? 0 : t > last ? last : t;
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return a[i] * (1 - s) + a[i + 1] * s;
  };
}

// Accepts [x, z] pairs, { x, z } objects, and Vector2/Vector3 (a Vector2's y is
// read as z, which is what a caller who laid the route out on paper means).
function normalizePoints(points) {
  const src = Array.isArray(points) && points.length >= 2 ? points : DEFAULT_POINTS;
  const out = [];
  for (const p of src) {
    let x;
    let z;
    if (Array.isArray(p)) { x = p[0]; z = p[1]; }
    else if (p && typeof p === 'object') { x = p.x; z = p.z !== undefined ? p.z : p.y; }
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    // Drop a repeated point: a zero-length segment has no tangent and would
    // poison every normal downstream of it.
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-6 && Math.abs(prev.y - z) < 1e-6) continue;
    out.push(new THREE.Vector2(x, z));
  }
  if (out.length < 2) return DEFAULT_POINTS.map((p) => new THREE.Vector2(p[0], p[1]));
  return out;
}

// --- the centreline --------------------------------------------------------
//
// The usual ribbon failure is at a corner: offsetting a hard vertex stretches
// the outer edge into a wedge and folds the inner one through itself. Both come
// from the same thing, a centreline with infinite curvature at one point.
//
// So the corner is rounded before anything is offset. A circular fillet of
// radius r replaces the vertex, which is also what a real path does: nobody
// walks a right angle, they cut the corner. As long as r stays comfortably
// larger than the half width, the inner edge has nothing to fold through, and
// the outer edge is a plain arc with no wedge in it. Where the caller's points
// are too close together for that, the per-sample curvature clamp further down
// pinches the inner half width instead of letting it cross the centre.
function filletPolyline(pts, radius) {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const P = pts[i];
    const d0 = new THREE.Vector2().subVectors(P, pts[i - 1]);
    const d1 = new THREE.Vector2().subVectors(pts[i + 1], P);
    const l0 = d0.length();
    const l1 = d1.length();
    d0.divideScalar(l0);
    d1.divideScalar(l1);

    const cross = d0.x * d1.y - d0.y * d1.x;
    const dot = Math.min(1, Math.max(-1, d0.dot(d1)));
    const theta = Math.acos(dot); // how far the path turns at this vertex
    if (theta < 0.02) { out.push(P.clone()); continue; }

    const half = theta / 2;
    // Tangent length the requested radius asks for, clamped so two fillets on a
    // short segment cannot overrun each other.
    let t = radius * Math.tan(half);
    t = Math.min(t, l0 * 0.48, l1 * 0.48);
    const r = t / Math.tan(half);

    const start = new THREE.Vector2().copy(P).addScaledVector(d0, -t);
    const end = new THREE.Vector2().copy(P).addScaledVector(d1, t);
    // Centre sits off the incoming segment, on whichever side the turn goes.
    const sign = cross >= 0 ? 1 : -1;
    const n0 = new THREE.Vector2(-d0.y, d0.x).multiplyScalar(sign);
    const C = new THREE.Vector2().copy(start).addScaledVector(n0, r);

    const a0 = Math.atan2(start.y - C.y, start.x - C.x);
    const steps = Math.max(2, Math.ceil((theta * r) / 0.05));
    out.push(start);
    for (let k = 1; k < steps; k++) {
      const a = a0 + sign * theta * (k / steps);
      out.push(new THREE.Vector2(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r));
    }
    out.push(end);
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

// Even arc-length resampling. Everything after this point assumes samples are a
// fixed distance apart, which is what makes the width noise and the texture's v
// axis agree with each other.
function resample(pts, step) {
  const out = [pts[0].clone()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = a.distanceTo(b);
    if (seg < 1e-9) continue;
    let d = step - carry;
    while (d <= seg) {
      out.push(new THREE.Vector2().lerpVectors(a, b, d / seg));
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1].distanceTo(last) > step * 0.4) out.push(last.clone());
  else out[out.length - 1].copy(last);
  return out;
}

// --- the ribbon ------------------------------------------------------------

export function createSandPath({ seed = 1, width = 1.2, points, scale = 1 } = {}) {
  const rng = mulberry32(seed * 1013904223 + 61);
  const group = new THREE.Group();
  const disposables = [];

  const hw = Math.max(0.15, width) / 2;
  const route = normalizePoints(points);

  // A fillet a little wider than the path itself. Below that the inner edge has
  // to be pinched to stay out of its own way, and a pinched corner reads as a
  // crease rather than a bend.
  const centre = resample(filletPolyline(route, hw * 1.9), Math.min(0.05, hw * 0.09));
  const n = centre.length;

  // Arc length, tangent and signed curvature at every sample.
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + centre[i].distanceTo(centre[i - 1]);
  const length = S[n - 1];

  const tan = [];
  for (let i = 0; i < n; i++) {
    const a = centre[Math.max(0, i - 1)];
    const b = centre[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a);
    if (t.lengthSq() < 1e-12) t.copy(tan[i - 1] || new THREE.Vector2(1, 0));
    tan.push(t.normalize());
  }
  // Positive curvature turns left, i.e. towards the +normal side.
  const curv = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ds = S[i + 1] - S[i - 1];
    if (ds < 1e-9) continue;
    const c = tan[i - 1].x * tan[i + 1].y - tan[i - 1].y * tan[i + 1].x;
    const d = Math.min(1, Math.max(-1, tan[i - 1].dot(tan[i + 1])));
    curv[i] = (Math.sign(c) * Math.acos(d)) / ds;
  }

  // A hand-worn path never runs true even between two fixed ends, so the
  // centreline meanders a little inside the route it was given. Tapered to zero
  // at both ends, so the ribbon still starts and finishes on the caller's
  // points and can be butted against another one.
  const meander = makeNoise(rng, length / 2.6 + 2);
  const N = [];
  for (let i = 0; i < n; i++) {
    N.push(new THREE.Vector2(-tan[i].y, tan[i].x));
    const taper = Math.min(1, S[i] / 1.2, (length - S[i]) / 1.2);
    centre[i].addScaledVector(N[i], meander(S[i] / 2.6) * hw * 0.22 * Math.max(0, taper));
  }

  // --- width -------------------------------------------------------------
  //
  // The two sides are frayed independently, at two wavelengths: long lobes
  // where the path bulges out around something, and a finer tooth where the
  // grass has been worn back unevenly. An unmade path is defined by where the
  // grass stops, so this boundary is the whole read at ground level.
  const lobeL = makeNoise(rng, length / 1.4 + 2);
  const lobeR = makeNoise(rng, length / 1.4 + 2);
  const toothL = makeNoise(rng, length / 0.28 + 2);
  const toothR = makeNoise(rng, length / 0.28 + 2);
  const halfL = new Float64Array(n);
  const halfR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const fl = 1 + 0.17 * lobeL(s / 1.4) + 0.075 * toothL(s / 0.28);
    const fr = 1 + 0.17 * lobeR(s / 1.4) + 0.075 * toothR(s / 0.28);
    // The inner side of a bend can never reach the centre of curvature or the
    // ribbon folds through itself. 0.82 of that radius leaves the fold well
    // clear even after the fray noise is added.
    const k = Math.abs(curv[i]);
    const limit = k > 1e-6 ? 0.82 / k : Infinity;
    halfL[i] = Math.min(hw * fl, curv[i] > 0 ? limit : Infinity);
    halfR[i] = Math.min(hw * fr, curv[i] < 0 ? limit : Infinity);
  }

  // --- height ------------------------------------------------------------
  //
  // Every term is multiplied by a profile that vanishes at both edges, so the
  // rim of the ribbon is at exactly y = 0 all the way along and there is no lip
  // to catch the light at a grazing angle. The crown in the middle is what
  // turns a coloured patch into a surface.
  const camber = 0.013 * (hw / 0.6);
  const swell = makeNoise(rng, length / 1.9 + 2);
  const rutAn = makeNoise(rng, length / 3.1 + 2);
  const rutBn = makeNoise(rng, length / 3.1 + 2);
  const rutDepth = 0.0075 * (hw / 0.6);
  const RUT_W = 0.15; // in u, the across-path coordinate

  const rutA = new Float64Array(n);
  const rutB = new Float64Array(n);
  const swellAt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rutA[i] = 0.30 + 0.055 * rutAn(S[i] / 3.1);
    rutB[i] = 0.70 + 0.055 * rutBn(S[i] / 3.1);
    swellAt[i] = 0.0055 * swell(S[i] / 1.9) * (hw / 0.6);
  }

  const crown = (u) => Math.pow(Math.max(0, 4 * u * (1 - u)), 0.7);
  const hollow = (u, c) => {
    const d = (u - c) / RUT_W;
    return Math.exp(-d * d);
  };
  function heightAt(i, u) {
    const p = crown(u);
    let y = (camber + swellAt[i]) * p;
    y -= rutDepth * hollow(u, rutA[i]) * p;
    y -= rutDepth * hollow(u, rutB[i]) * p;
    return y;
  }
  const offsetAt = (i, u) => -halfL[i] + (halfL[i] + halfR[i]) * u;

  // --- geometry ----------------------------------------------------------
  const COLS = 17;
  const pos = new Float32Array(n * COLS * 3);
  const nor = new Float32Array(n * COLS * 3);
  const uv = new Float32Array(n * COLS * 2);
  const idx = new Uint32Array((n - 1) * (COLS - 1) * 6);

  const P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < COLS; j++) {
      const u = j / (COLS - 1);
      const off = offsetAt(i, u);
      const y = heightAt(i, u);
      P.set(centre[i].x + N[i].x * off, y, centre[i].y + N[i].y * off);
      const k = (i * COLS + j) * 3;
      pos[k] = P.x; pos[k + 1] = P.y; pos[k + 2] = P.z;
      const m = (i * COLS + j) * 2;
      uv[m] = u;
      uv[m + 1] = S[i] / length;
    }
  }
  // Normals from the height field rather than from face averaging: the across
  // slope is tiny and finite differences on the analytic surface keep the
  // camber reading as one smooth dome instead of a row of facets.
  for (let i = 0; i < n; i++) {
    const ds = Math.max(1e-4, (S[Math.min(n - 1, i + 1)] - S[Math.max(0, i - 1)]) / 2);
    for (let j = 0; j < COLS; j++) {
      const u = j / (COLS - 1);
      const du = 0.5 / (COLS - 1);
      const wu = halfL[i] + halfR[i];
      const dydu = (heightAt(i, Math.min(1, u + du)) - heightAt(i, Math.max(0, u - du))) / (Math.min(1, u + du) - Math.max(0, u - du)) / Math.max(1e-4, wu);
      const dyds = (heightAt(Math.min(n - 1, i + 1), u) - heightAt(Math.max(0, i - 1), u)) / (2 * ds);
      // Tangent frame: N[i] is across, tan[i] is along, both in the XZ plane.
      const nx = -dydu * N[i].x - dyds * tan[i].x;
      const nz = -dydu * N[i].y - dyds * tan[i].y;
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      const k = (i * COLS + j) * 3;
      nor[k] = nx * inv; nor[k + 1] = inv; nor[k + 2] = nz * inv;
    }
  }
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < COLS - 1; j++) {
      const a = i * COLS + j;
      const b = a + 1;
      const c = a + COLS;
      const d = c + 1;
      // +j runs towards +normal and +i along the path, so this winding is the
      // one whose face points at the sky.
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  // --- maps --------------------------------------------------------------
  const tex = typeof document !== 'undefined' ? buildMaps(rng, width, length) : null;

  const material = toyMaterial(SAND, {
    roughness: 0.97,
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
    // THE Z-FIGHT FIX. The ribbon is coplanar with the floor at its rim, which
    // is exactly where a lift would have shown a lip, so the bias is applied in
    // depth instead of in space. Negative pulls it towards the camera.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  if (tex) material.normalScale.set(0.85, 0.85);

  const ribbon = new THREE.Mesh(geo, material);
  ribbon.receiveShadow = true;
  // It is the floor. It has nothing to cast onto and casting would only give it
  // shadow acne against its own coplanar neighbour.
  ribbon.castShadow = false;
  group.add(ribbon);

  // --- pebbles -----------------------------------------------------------
  //
  // Trodden out of the dirt and half sunk back into it. These are the only part
  // of the path with a silhouette of its own, and at 38 degrees a handful of
  // real bumps with real contact shadows does more than any amount of texture.
  const count = Math.max(6, Math.round(length * 3.2));
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 1);
  const pebbleMat = toyMaterial('#ffffff', { roughness: 0.9 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, count);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let p = 0; p < count; p++) {
    const i = Math.min(n - 1, Math.floor(rng() * n));
    const u = 0.07 + rng() * 0.86;
    const off = offsetAt(i, u);
    const r = (0.016 + rng() * 0.022) * (hw / 0.6);
    const sink = 0.45 + rng() * 0.3; // how much of it is still buried
    pv.set(
      centre[i].x + N[i].x * off,
      heightAt(i, u) + r * (0.55 - sink) + r * 0.5,
      centre[i].y + N[i].y * off,
    );
    e.set(rng() * 3.14, rng() * 3.14, rng() * 3.14);
    q.setFromEuler(e);
    sv.set(r * (0.9 + rng() * 0.5), r * (0.5 + rng() * 0.25), r * (0.9 + rng() * 0.5));
    m4.compose(pv, q, sv);
    pebbles.setMatrixAt(p, m4);
    // Warm greys either side of the sand, never a contrast note.
    const g = 0.72 + rng() * 0.34;
    tint.setRGB(g * 0.80, g * 0.77, g * 0.71, THREE.SRGBColorSpace);
    pebbles.setColorAt(p, tint);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  group.add(pebbles);

  group.scale.setScalar(scale);

  return {
    group,
    update() {}, // static prop
    dispose() {
      geo.dispose();
      material.dispose();
      pebbleGeo.dispose();
      pebbleMat.dispose();
      pebbles.dispose();
      tex?.map.dispose();
      tex?.normalMap.dispose();
      for (const d of disposables) d.dispose?.();
    },
  };
}

// --- the maps --------------------------------------------------------------
//
// Baked once for the WHOLE ribbon rather than tiled, at a resolution that falls
// as the path gets longer. That is what buys "no visible repeat" outright: with
// v running 0..1 over the entire arc length and the texture clamped, there is
// no second copy of anything to spot.
function buildMaps(rng, width, length) {
  const px = Math.max(26, Math.min(88, 2048 / Math.max(1, length)));
  const w = Math.max(48, Math.min(256, Math.round(width * px)));
  const h = Math.max(64, Math.min(2048, Math.round(length * px)));
  const pxU = w / width; // pixels per world unit across
  const pxV = h / length; // pixels per world unit along

  const colour = document.createElement('canvas');
  colour.width = w; colour.height = h;
  const cc = colour.getContext('2d');
  const height = document.createElement('canvas');
  height.width = w; height.height = h;
  const hc = height.getContext('2d');

  // White base on the colour map: the hue lives on the material so SAND stays
  // the single source of truth. Mid grey on the height map, so features can go
  // either way from it.
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, w, h);
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w, h);

  // A soft blotch. Drawn to both maps at once when it is a real dent in the
  // surface, colour only when it is just a change of dirt.
  const blot = (ctx, x, y, rx, ry, rot, col, a) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(0.6, `rgba(${col},${a * 0.45})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(rx, ry);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // 1. Broad dirt patches. Long wavelength on purpose: at this camera a patch
  //    smaller than a hand is invisible, and a lot of small ones is grain.
  for (let i = 0; i < Math.round(length * 2.6) + 6; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.14 + rng() * 0.4) * Math.min(w, pxV * 1.4);
    const dark = rng() < 0.55;
    blot(cc, x, y, r, r * (0.6 + rng() * 0.9), rng() * Math.PI, dark ? '150,140,126' : '255,252,245', dark ? 0.16 : 0.2);
  }

  // 2. The two wheel hollows. The geometry already sinks them; this is the dirt
  //    that has been pressed darker and smoother inside them, plus the little
  //    ridge of loose sand thrown up along their edges.
  for (const base of [0.30, 0.70]) {
    let uu = base;
    for (let y = -pxV * 0.4; y < h + pxV * 0.4; y += pxV * 0.16) {
      uu += (rng() - 0.5) * 0.012;
      const x = Math.max(0.05, Math.min(0.95, uu)) * w;
      blot(cc, x, y, pxU * 0.11, pxV * 0.16, 0, '146,136,122', 0.13);
      blot(hc, x, y, pxU * 0.09, pxV * 0.16, 0, '40,40,40', 0.12);
    }
  }

  // 3. Foot hollows. Soft ovals a bit longer than they are wide, scattered down
  //    the middle of the path where the walking happens.
  for (let i = 0; i < Math.round(length * 5) + 4; i++) {
    const u = 0.16 + rng() * 0.68;
    const x = u * w;
    const y = rng() * h;
    const rx = pxU * (0.045 + rng() * 0.03);
    const ry = pxV * (0.075 + rng() * 0.05);
    const rot = (rng() - 0.5) * 0.5;
    blot(hc, x, y, rx, ry, rot, '38,38,38', 0.3);
    blot(cc, x, y, rx * 1.15, ry * 1.15, rot, '150,141,128', 0.11);
    // The lip of sand pushed up on one side, which is what makes a print read
    // as pressed rather than painted.
    blot(hc, x + rx * 1.1, y, rx * 0.7, ry * 0.85, rot, '215,215,215', 0.16);
  }

  // 4. Scuffed edges. The outer band of a worn path is thinner sand over the
  //    grey underneath, so it fades towards the floor colour rather than
  //    stopping at a ruled line. Computed as the linear ratio between the two
  //    colours, because the map is a multiplier on SAND.
  const fade = fadeToFloor();
  for (const side of [0, 1]) {
    const g = cc.createLinearGradient(side ? w : 0, 0, side ? w * 0.76 : w * 0.24, 0);
    g.addColorStop(0, `rgba(${fade},0.92)`);
    g.addColorStop(0.45, `rgba(${fade},0.4)`);
    g.addColorStop(1, `rgba(${fade},0)`);
    cc.fillStyle = g;
    cc.fillRect(side ? w * 0.76 : 0, 0, w * 0.24, h);
    // Tongues of bare sand pushing back out into the fringe, and of dirt
    // pushing in, so the transition is not a clean gradient either.
    for (let i = 0; i < Math.round(length * 3.4) + 4; i++) {
      const y = rng() * h;
      const depth = pxU * (0.05 + rng() * 0.13);
      const x = side ? w - depth * 0.4 : depth * 0.4;
      blot(cc, x, y, depth, pxV * (0.09 + rng() * 0.14), 0, rng() < 0.5 ? '255,252,245' : fade, 0.3);
    }
    // Slightly lower at the very rim: the sand thins out into the floor.
    const gh = hc.createLinearGradient(side ? w : 0, 0, side ? w * 0.88 : w * 0.12, 0);
    gh.addColorStop(0, 'rgba(60,60,60,0.5)');
    gh.addColorStop(1, 'rgba(60,60,60,0)');
    hc.fillStyle = gh;
    hc.fillRect(side ? w * 0.88 : 0, 0, w * 0.12, h);
  }

  // 5. Grit. Small enough to be many, big enough not to be grain: a pebble here
  //    is about two centimetres and it is a bump with a lit top, not a speck.
  for (let i = 0; i < Math.round(length * 26) + 20; i++) {
    const x = 0.06 * w + rng() * w * 0.88;
    const y = rng() * h;
    const r = pxU * (0.012 + rng() * 0.018);
    blot(hc, x, y, r, r * (pxV / pxU) * 0.9, 0, '225,225,225', 0.5);
    blot(cc, x, y, r * 1.2, r * (pxV / pxU) * 1.1, 0, rng() < 0.6 ? '255,253,247' : '158,150,138', 0.22);
  }

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8; // seen at 38 degrees, so the along-path axis is squashed
  map.needsUpdate = true;

  const normalMap = heightToNormalMap(height, 2.2);
  normalMap.wrapS = THREE.ClampToEdgeWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;

  return { map, normalMap };
}

// The multiplier that turns SAND into FLOOR, in the space the map is sampled
// in. Worked out rather than eyeballed so the fringe lands on the floor colour
// exactly and the boundary has nowhere to show a seam.
function fadeToFloor() {
  const a = new THREE.Color(SAND).convertSRGBToLinear();
  const b = new THREE.Color(FLOOR).convertSRGBToLinear();
  const c = new THREE.Color(
    Math.min(1, b.r / Math.max(1e-4, a.r)),
    Math.min(1, b.g / Math.max(1e-4, a.g)),
    Math.min(1, b.b / Math.max(1e-4, a.b)),
  ).convertLinearToSRGB();
  return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
}
