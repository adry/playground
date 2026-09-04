import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, toyMaterial, contactShadow } from '../style.js';

// The iron brazier: a fire basket on three splayed legs, with an open fire
// burning in it.
//
// It is the only lantern in the set with no glass anywhere, and that absence is
// the entire reason it exists. Every other one of the ten is a flame behind a
// pane, which is a flame with a lid on it: sheltered, slow, and separated from
// the scene by a surface that has to be faked. This one has nothing between the
// fire and the air, so it is allowed to be the brightest, the fastest and the
// warmest of the set, and its light goes straight out through the gaps in the
// bars onto whatever is standing behind it.
//
// Three decisions settled the build.
//
// HEIGHT AND FOOTPRINT. The rim sits at 0.78 and the fire reaches about 1.15,
// against a ghost at 1.60 and a cross headstone at 1.56. That is deliberately
// low: a brazier is a thing you stand round, and the whole point of the prop is
// that its light travels UP. Put the rim at chest height and the fire lights
// the top of a headstone, which is the least interesting part of it and the
// part the scene's key light already reaches. At 0.80 the flame is below the
// carving on a cross and the stone behind is raked from underneath, which is
// the one lighting direction nothing else in the graveyard supplies. The feet
// splay to 0.72 across against a 0.57 mouth, so the silhouette stands as a
// tripod and not as a goblet.
//
// The first build put the base ring at 0.50 with a 0.30 bowl over it, and it
// rendered as a wire stool: legs and basket the same length, so neither read as
// the point of the object. The bowl now starts at 0.40 and is 0.38 deep against
// 0.40 of leg, and it bellies out to 0.306 before drawing back to a 0.286 rim.
// That in-turn at the mouth is what separates a bowl from a bucket, and it is
// worth the two centimetres it costs.
//
// BARS. A real fire basket is sixteen to twenty rods of thin flat stock. At
// this size that is a wire cage: the bars alias into a grey haze and the gaps
// between them, which are the thing that actually matters here, close up. So
// there are NINE bars and each is a finger-thick rounded roll 0.052 across,
// which leaves a 0.14 gap between neighbours at the rim. Nine rather than eight
// because an odd count never presents a bar dead centre and a gap dead centre
// at the same time from any angle, so the basket reads as round from every side
// rather than as two flat faces.
//
// THE FIRE. See the FIRE block below. It is four surfaces and it is the piece
// the prop lives or dies on.

// ---------------------------------------------------------------------------
// palette

const IRON = '#464b54';          // a shade darker than the street lamp's, since
                                 // this one is soot-blackened, not painted
const IRON_HOT = '#6a4a3a';      // what the bars go towards when the fire flares

// The fire's two ends. Everything the flame drives is a lerp between an ember
// state at the bottom of a gutter and a flame state at the top of a flare.
const EMBER = new THREE.Color('#ff5a12').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// The flame BODY runs hotter than the light does. These are multiplied above 1
// on purpose so ACES clips the core to white: a flame whose core does not clip
// reads as an orange jelly bean, which is the pumpkin's finding and it holds
// here at four times the size.
const CORE_EMBER = new THREE.Color('#ff5a10');
const CORE_FLAME = new THREE.Color('#ff9c3c');
// The additive layers saturate to white far sooner than an emissive does, so
// the tongues and the halo get their own deeper pair or the whole fire comes
// out as a cream disc with an orange edge.
const BLOOM_EMBER = new THREE.Color('#ff4a08');
const BLOOM_FLAME = new THREE.Color('#ff9a30');
// Coals: nearly black iron oxide that glows from inside.
const COAL = new THREE.Color('#241a16');
const COAL_EMBER = new THREE.Color('#ff3208');
const COAL_FLAME = new THREE.Color('#ff7a24');

// What each thing driven by the fire looks like at the bottom and the top of
// its swing. All of them ride ONE level, which is the trick the whole set uses:
// four things driven separately read as four things.
//
// LAMP is the brightest in the set by a wide margin and that is the brief. For
// scale, the ground lantern runs 0.66 to 1.45 at decay 2 and the street lamp
// 2.4 to 5.2 at decay 1.25 from 2.6 up. This one sits at 0.95 with nothing in
// front of it, so it needs less than the street lamp's number to land more on
// the ground, and its swing is the widest of the three (2.5 : 1 against their
// 2.17 and 2.2) because an open fire in the wind is not a candle in a box.
const LAMP = { min: 2.35, max: 5.95 };
const CORE = { min: 1.90, max: 3.90 };   // the flame body, above 1 so it clips
const TONGUE = { min: 0.62, max: 1.45 }; // the licks around it, additive
const HALO = { min: 0.46, max: 1.05 };   // the shell around the core, additive
const COALS = { min: 0.42, max: 1.25 };  // emissive on the coal bed
const POOL = { min: 0.16, max: 0.42 };   // the painted warm on the ground
const IRONGLOW = { min: 0.030, max: 0.115 };  // the bars catching their own fire

// How the colour is mixed between ember and flame. Levered about the level's
// own mean rather than fed the level straight, because the level lives in the
// top of its range: fed straight through, ember would only be reachable in a
// gutter deep enough to have put the fire out.
const HUE_MID = 0.86;
const HUE_GAIN = 1.6;

// ---------------------------------------------------------------------------
// dimensions, all in scene units with the ground at y = 0

const M = {
  footR: 0.330,        // how far the feet splay
  footY: 0.022,        // the ball on the end of each leg
  hipR: 0.268,         // where a leg is at two fifths of its height, knee out
  hipY: 0.170,
  baseR: 0.152,        // the ring the basket is built up from
  baseY: 0.400,
  bellyR: 0.312,       // the widest point of the bowl, just under the rim
  bellyY: 0.700,
  rimR: 0.292,         // the mouth, drawn back in from the belly so the basket
  rimY: 0.780,         // reads as a bowl and not as a bucket
  bar: 0.029,          // radius of a bar, so 0.058 across: finger thick
  leg: 0.032,          // legs a touch fatter than bars, they carry the thing
  ring: 0.032,
  bars: 9,
  legs: 3,
};
const PAN_Y = 0.462;   // the ash pan's floor, which is what the coals sit in
const FIRE_Y = 0.535;  // the foot of the flame, just above the coal bed

// ---------------------------------------------------------------------------
// noise and rng
//
// Same construction as the rest of the set. The important half of this is what
// the noise is NOT used for: see the flicker note in update().

function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

// ---------------------------------------------------------------------------
// surface helpers

// Revolve a (radius, height) profile. Lifted from the street lamp, and for its
// two reasons: the seam vertex is not duplicated so no crease runs up the
// piece, and a profile that reaches radius zero at either end is welded to a
// single pole vertex, where THREE.LatheGeometry would leave the end open.
function revolve(profile, segments = 28, rowT = null, fade = null, section = null) {
  const rows = profile.length;
  const verts = [];
  const uvs = [];
  const index = [];
  const rowStart = new Array(rows);
  const cols = [];
  // Hot white at the root falling to the material's own colour by the shoulder,
  // and on the tongues down to black at the tip so an additive lick dissolves
  // rather than ending on an edge.
  const shade = (t) => {
    const heat = Math.pow(Math.max(0, 1 - t / 0.60), 1.6);
    const k = fade
      ? fade.floor + (1 - fade.floor) * Math.pow(Math.max(0, 1 - t), fade.power)
      : 1;
    const v = (1 + fade.heat * heat) * k;
    return [v, v, v];
  };
  const ang = [];
  for (let j = 0; j < segments; j++) ang.push((j / segments) * Math.PI * 2);
  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i];
    if (r < 1e-6 && (i === 0 || i === rows - 1)) {
      rowStart[i] = -(verts.length / 3) - 1;
      verts.push(0, y, 0);
      uvs.push(0.5, i / (rows - 1));
      if (rowT) cols.push(...shade(rowT[i]));
      continue;
    }
    rowStart[i] = verts.length / 3;
    const ti = rowT ? rowT[i] : i / (rows - 1);
    for (let j = 0; j < segments; j++) {
      const rr = r * (section ? section(ang[j], ti) : 1);
      verts.push(Math.cos(ang[j]) * rr, y, Math.sin(ang[j]) * rr);
      uvs.push(j / segments, i / (rows - 1));
      if (rowT) cols.push(...shade(rowT[i]));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    const lo = rowStart[i], hi = rowStart[i + 1];
    const loPole = lo < 0, hiPole = hi < 0;
    const l = loPole ? -lo - 1 : lo;
    const h = hiPole ? -hi - 1 : hi;
    for (let j = 0; j < segments; j++) {
      const jn = (j + 1) % segments;
      if (loPole && hiPole) continue;
      if (loPole) { index.push(l, h + j, h + jn); continue; }
      if (hiPole) { index.push(l + j, h, l + jn); continue; }
      index.push(l + j, h + j, l + jn, l + jn, h + j, h + jn);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  // A uv nobody samples, and it is not decoration: mergeGeometries refuses a
  // set of parts whose attribute lists differ, and everything else going into
  // the ironwork is a stock three primitive that carries one.
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (rowT) geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// A rounded roll of iron following a 3D path: a tube with a hemisphere welded
// on each end.
//
// The house style has no cut ends anywhere, and this is where that rule bites
// hardest, because a fire basket is nothing but the ends of bars. A sphere of
// the tube's own radius centred on the tube's last ring is exactly the
// continuation of that surface, so the two agree in position AND in normal and
// the join is invisible without a single extra vertex of blending.
function roll(points, radius, { tubular = 16, radial = 10, capSeg = 8 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const parts = [new THREE.TubeGeometry(curve, tubular, radius, radial, false)];
  for (const t of [0, 1]) {
    const cap = new THREE.SphereGeometry(radius, radial, capSeg);
    const p = curve.getPointAt(t);
    cap.translate(p.x, p.y, p.z);
    parts.push(cap);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

// A torus laid flat in the XZ plane.
function ring(R, r, y, seg = 40) {
  const g = new THREE.TorusGeometry(R, r, 12, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// The shape every part of the fire is cut from.
//
// The first pass used the candle teardrop the other lanterns use, scaled up
// four times, and at brazier size it was wrong in a way it is not at candle
// size: a candle flame IS a spike, and four spikes side by side read as a paper
// crown glued into a basket. This profile is a lobe instead. It is fat from a
// fifth of the way up to nearly two thirds, so the body has volume and the eye
// gets a rounded silhouette in the middle of the prop where all the light is,
// and then it rounds over rather than tapering to a needle.
//
// The numbers are (height fraction, radius fraction) and they are sampled
// through a Catmull-Rom, so every one of them is a soft corner and the surface
// that comes out has no crease anywhere. That is the house style rule applied
// to something that is not made of anything.
const FLAME_LOBE = [
  [0.00, 0.34], [0.10, 0.70], [0.24, 0.96], [0.38, 1.00],
  [0.52, 0.94], [0.66, 0.78], [0.80, 0.54], [0.91, 0.30], [1.00, 0.00],
];

// A flame is hottest at its root and coolest at its tip, and that gradient is
// most of what tells the eye it is fire rather than a plastic carrot. Baked
// into the vertices as colour rather than driven by a shader, because it never
// changes shape: what changes is the ONE colour the material multiplies it by.
//
// On the additive tongues the same attribute does a second job that is worth
// more than the first. Their tips fade to black, and black added is nothing, so
// a lick does not END anywhere: it thins, goes transparent and is gone. A hard
// silhouette edge at the top of a flame is the single most artificial thing a
// stylised fire can have, and this is what removes it without a texture, an
// alpha map or a sort order.
function flameGeometry(amp, height, { rows = 26, segments = 20, fade, section = null, curl = 0 } = {}) {
  const spline = new THREE.SplineCurve(FLAME_LOBE.map(([t, r]) => new THREE.Vector2(t, r)));
  const pts = [];
  const ts = [];
  for (let i = 0; i <= rows; i++) {
    const p = spline.getPoint(i / rows);
    const t = Math.min(1, Math.max(0, p.x));
    pts.push(new THREE.Vector2(amp * Math.max(0, p.y), height * t));
    ts.push(t);
  }
  // Force the last row onto the axis so revolve() welds the tip shut.
  pts[pts.length - 1].x = 0;
  const geo = revolve(pts, segments, ts, fade, section);
  // A curl baked up the height. A flame does not stand plumb, and a lathe that
  // does reads as a bud on a stalk. Shearing the tip sideways by the square of
  // the height gives the one asymmetry a body of revolution can never have, and
  // because the mesh is rotated about its own ROOT in update(), the curl swings
  // with the lean instead of fighting it.
  if (curl) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / height;
      pos.setX(i, pos.getX(i) + curl * height * t * t);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

// Alpha off the dot of the surface normal with the view, so a surface fades out
// where it turns away and is at full strength where it faces you. Same trick as
// the street lamp's bloom, and here it does two jobs.
//
// On the halo it is the bloom this project has no post pass for. On the TONGUES
// it is the fix for the one thing that was wrong with them: an additive closed
// surface drawn double sided gets a BRIGHT rim, because at the silhouette you
// are adding the front face and the back face of the same shell, and a lick
// with a bright hard outline reads as a shard of glass. Turning the falloff
// round so the middle is brightest and the edge goes to nothing is both what
// the eye expects of a glowing volume and the thing that puts the licks back in
// the soft vinyl register the rest of the prop is in.
// The same dot product used on an OPAQUE surface, multiplying colour instead of
// alpha. A flame is a glowing volume, so you look through more of it at the
// middle than at the edge, and the edge is therefore both dimmer and redder:
// the core is driven well past 1 so its middle clips to white through ACES,
// while the rim comes back down into the orange the colour actually is. Without
// this the core is one flat bright shape with a hard outline, which is a
// lightbulb. It is one dot product and it is the single biggest thing on the
// whole prop per line of code.
function limbDarken(material, key, floor = 0.42, power = 0.55) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBN;\nvarying vec3 vBP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vBN = normalize(mat3(modelMatrix) * normal);
  vBP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBN;\nvarying vec3 vBP;')
      .replace('#include <opaque_fragment>', `
  vec3 vd = isOrthographic
    ? normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z))
    : normalize(cameraPosition - vBP);
  float d = clamp(dot(normalize(vBN), vd), 0.0, 1.0);
  gl_FragColor = vec4(outgoingLight * (FLOOR + (1.0 - FLOOR) * pow(d, POWER)), diffuseColor.a);`
        .replace(/FLOOR/g, floor.toFixed(3))
        .replace('POWER', power.toFixed(2)));
  };
  material.customProgramCacheKey = () => key;
  return material;
}

function softLimb(material, key, power = 2.2) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBN;\nvarying vec3 vBP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vBN = normalize(mat3(modelMatrix) * normal);
  vBP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBN;\nvarying vec3 vBP;')
      .replace('#include <opaque_fragment>', `
  vec3 vd = isOrthographic
    ? normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z))
    : normalize(cameraPosition - vBP);
  float d = clamp(dot(normalize(vBN), vd), 0.0, 1.0);
  gl_FragColor = vec4(outgoingLight, diffuseColor.a * pow(d, POWER));`.replace('POWER', power.toFixed(2)));
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// The warm on the ground, painted rather than lit.
//
// The point light does most of this job honestly, since the fire is only 0.95
// up and its own inverse square reaches the floor at a useful level. What the
// light cannot give is the near field: at 0.2 from the source the falloff is
// vicious enough that a level tuned for the ground at 0.8 out has already
// scorched the legs white. So the light is set where the IRONWORK looks right
// and the outer half of the pool is painted, the same machinery as style.js's
// contact shadow and for the mirror image of its reason.
//
// The profile is not a generic gradient: irradiance from a point at height h on
// the floor at lateral distance x goes as cos(theta) / d^decay. Baked from that
// rather than smoothstepped, the pool falls off the way the light it is
// standing in for would.
function lightPool({ radius = 1.9, height = 0.95, decay = 1.35 } = {}) {
  if (typeof document === 'undefined') {
    const stub = new THREE.Object3D();
    stub.userData.dispose = () => {};
    return stub;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = (size - 1) / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i - c) / c) * radius;
      const z = ((j - c) / c) * radius;
      const lat = Math.hypot(x, z);
      const d = Math.hypot(lat, height);
      let v = (height / d) / Math.pow(d / height, decay);
      // A very shallow dip in the middle. There is no shadow map on this light,
      // so the one piece of occlusion that would be legible, the ash pan's own
      // disc thrown straight down between the feet, is painted in. It has to be
      // slight: the first pass took it to a third and the pool came out as a
      // dark doughnut, which reads as a stain and not as shade, and the key
      // light's real cast shadow is already sitting across the same ground.
      v *= 0.80 + 0.20 * Math.min(1, Math.pow(lat / 0.36, 1.5));
      // Taken to zero at the quad's edge or the decal ends on a visible disc.
      v *= Math.max(0, 1 - Math.pow(lat / radius, 2.0));
      const k = (j * size + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * Math.max(0, Math.min(1, v)));
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: POOL.min,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  mesh.userData.dispose = () => { texture.dispose(); material.dispose(); mesh.geometry.dispose(); };
  return mesh;
}

// ---------------------------------------------------------------------------

export function createBrazier({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: one design off one shelf, not ten braziers.
  // A turn about the axis so two never present the same leg, and a degree of
  // lean because it is standing on earth.
  const spin = rand() * Math.PI * 2;
  const leanDir = rand() * Math.PI * 2;
  const lean = 0.008 + rand() * 0.014;
  const flickerPhase = rand() * 100;

  const disposables = [];

  // --- ironwork ------------------------------------------------------------
  // Legs, feet, two rings, nine bars and the ash pan, all one material and
  // therefore one draw call.
  const iron = [];

  // The two rings the basket is strung between.
  iron.push(ring(M.baseR, M.ring * 0.85, M.baseY, 32));
  iron.push(ring(M.rimR, M.ring, M.rimY, 44));

  // The bars. Each one leaves the base ring going out and up, bellies past the
  // widest point and comes back in a little to the rim, which is what makes the
  // basket a bowl rather than a bucket. They are drawn as space curves rather
  // than as a lathe because they have to be separate objects with gaps between
  // them, and the gaps are what the light comes through.
  for (let i = 0; i < M.bars; i++) {
    const a = (i / M.bars) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // A hair of tangential lean, alternating, so the cage has a little life in
    // it and does not read as a machined part.
    const tw = (i % 2 ? 1 : -1) * 0.030;
    const at = (r, y, k = 0) => [
      r * (ca * Math.cos(k) - sa * Math.sin(k)),
      y,
      r * (sa * Math.cos(k) + ca * Math.sin(k)),
    ];
    iron.push(roll([
      at(M.baseR * 0.72, M.baseY - 0.030),
      at(M.baseR * 1.04, M.baseY + 0.020),
      at(M.bellyR * 0.86, M.bellyY - 0.130, tw * 0.5),
      at(M.bellyR, M.bellyY, tw),
      at(M.rimR, M.rimY + 0.004, tw * 0.6),
    ], M.bar, { tubular: 20, radial: 9 }));
  }

  // The legs. Out and down from under the base ring, splaying past the rim so
  // the tripod is wider than the bowl, with a ball foot on the end.
  for (let i = 0; i < M.legs; i++) {
    // Offset half a bar pitch so a leg never sits directly under a bar: aligned,
    // the leg and the bar above it merge into one long S and the tripod stops
    // reading as a separate structure.
    const a = (i / M.legs) * Math.PI * 2 + Math.PI / M.bars;
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (r, y) => [r * ca, y, r * sa];
    iron.push(roll([
      at(M.baseR * 0.80, M.baseY + 0.045),
      at(M.baseR * 1.02, M.baseY - 0.060),
      at(M.hipR, M.hipY),
      at(M.footR, M.footY + 0.030),
      at(M.footR, M.footY),
    ], M.leg, { tubular: 18, radial: 10 }));
    const foot = new THREE.SphereGeometry(M.leg * 1.42, 14, 10);
    foot.scale(1, 0.72, 1);
    foot.translate(M.footR * ca, M.footY, M.footR * sa);
    iron.push(foot);
  }

  // The ash pan. A shallow dish inside the base ring, so the fire is sitting in
  // something rather than floating over a hole. Its floor is a couple of
  // centimetres of iron the coals can bed into.
  iron.push(revolve([
    new THREE.Vector2(0.000, PAN_Y - 0.034),
    new THREE.Vector2(0.070, PAN_Y - 0.030),
    new THREE.Vector2(0.132, PAN_Y - 0.008),
    new THREE.Vector2(0.163, PAN_Y + 0.030),
    new THREE.Vector2(0.165, PAN_Y + 0.058),
    new THREE.Vector2(0.148, PAN_Y + 0.062),
    new THREE.Vector2(0.124, PAN_Y + 0.030),
    new THREE.Vector2(0.062, PAN_Y - 0.002),
    new THREE.Vector2(0.000, PAN_Y - 0.006),
  ], 32));

  const ironGeo = mergeGeometries(iron, false);
  for (const g of iron) g.dispose();
  // Emissive rather than plain: the bars stand INSIDE the fire's near field and
  // an unshadowed point light cannot warm the ones on the far side, which is
  // exactly where a real basket glows most. A dull red-brown emissive riding
  // the flame's level puts the heat back on every bar at once.
  const ironMat = toyMaterial(IRON, {
    roughness: 0.62,
    emissive: new THREE.Color(IRON_HOT),
    emissiveIntensity: IRONGLOW.min,
  });
  const ironMesh = new THREE.Mesh(ironGeo, ironMat);
  ironMesh.castShadow = true;
  ironMesh.receiveShadow = true;
  disposables.push(ironGeo, ironMat);

  // --- FIRE ----------------------------------------------------------------
  // Four surfaces, in the order the eye reads them, and the fire only works
  // when all four are running.
  //
  //   COALS   a bed of lumps in the pan, nearly black, glowing from inside.
  //           This is the half of a fire that does not move, and it is what
  //           stops the flame reading as a decal floating in a basket. It is
  //           also the only part visible THROUGH the bars from a low angle.
  //   CORE    one big teardrop, opaque, driven bright enough that ACES clips
  //           its middle to white. This is the fire's silhouette and at prop
  //           size it is most of what you see.
  //   TONGUES three smaller teardrops leaning out of the core on their own
  //           phases, additively blended. Additive is doing real work here:
  //           over the core they add nothing because the core is already
  //           clipped, and past its edge they read as the translucent licks a
  //           flame's outside actually is. That is the difference between a
  //           fire and a carrot.
  //   SHELL   a copy of the core a third bigger, additive and parented to it,
  //           which softens the core's silhouette and stands in for the bloom
  //           pass this project does not have.
  //
  // What this is NOT is a particle system. Four rigid meshes leaning and
  // stretching on carriers is legible at two hundred pixels, where a hundred
  // sprites would be an orange smudge, and it is one draw call each rather
  // than a buffer update every frame.

  // Coals. Squashed spheres scattered in the pan, merged into one mesh.
  const coalParts = [];
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.018 + Math.sqrt(rand()) * 0.138;
    const s = 0.028 + rand() * 0.028;
    const lump = new THREE.SphereGeometry(s, 10, 7);
    lump.scale(1, 0.62 + rand() * 0.22, 1);
    lump.translate(
      Math.cos(a) * r,
      PAN_Y + 0.020 + rand() * 0.034 - r * 0.16,
      Math.sin(a) * r,
    );
    coalParts.push(lump);
  }
  const coalGeo = mergeGeometries(coalParts, false);
  for (const g of coalParts) g.dispose();
  const coalMat = new THREE.MeshStandardMaterial({
    color: COAL.clone(),
    roughness: 0.95,
    metalness: 0,
    emissive: COAL_FLAME.clone(),
    emissiveIntensity: COALS.min,
  });
  const coals = new THREE.Mesh(coalGeo, coalMat);
  coals.castShadow = false;
  coals.receiveShadow = false;
  disposables.push(coalGeo, coalMat);

  // Core.
  // Floored at 0.42 rather than run to zero: the core is opaque, so a tip that
  // faded all the way out would be a black point against a bright sky rather
  // than a cool one against the fire.
  // The cross section is not a circle, and that is the last thing that stops the
  // core reading as a hot air balloon. A body of revolution has a perfectly
  // even silhouette from every angle, which is exactly what fire never has. A
  // three lobed rose with a five lobed one under it, both twisting as they rise,
  // puts three soft vertical creases up the flame that catch the vertex heat
  // gradient at different rates, so the outline breaks and the surface has
  // somewhere for the light to change. It is 0.09 and 0.045 of the radius,
  // which is nothing, and it is the difference between fire and fruit.
  const coreGeo = flameGeometry(0.158, 0.455, {
    rows: 28, segments: 30,
    fade: { floor: 0.42, power: 1.1, heat: 0.80 },
    section: (a, t) => 1 + 0.090 * Math.cos(3 * a + 2.6 * t) + 0.045 * Math.cos(5 * a - 1.4 * t),
    curl: 0.14,
  });
  const coreMat = limbDarken(new THREE.MeshBasicMaterial({
    color: CORE_FLAME.clone(),
    vertexColors: true,
    toneMapped: true,
  }), 'brazier-core', 0.12, 1.15);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = FIRE_Y;
  core.castShadow = false;
  disposables.push(coreGeo, coreMat);

  // Tongues. Three, at three sizes and three offsets, so no two are ever at the
  // same height at the same moment and the fire never looks symmetrical.
  const tongueGeo = flameGeometry(0.104, 0.225, {
    rows: 20, segments: 18,
    fade: { floor: 0.0, power: 1.35, heat: 0.55 },
    section: (a, t) => 1 + 0.075 * Math.cos(2 * a + 3.1 * t),
    curl: 0.30,
  });
  const tongueMat = softLimb(new THREE.MeshBasicMaterial({
    color: BLOOM_FLAME.clone(),
    transparent: true,
    opacity: TONGUE.min,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    toneMapped: true,
  }), 'brazier-tongue', 2.40);
  const tongues = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(tongueGeo, tongueMat);
    const a = (i / 3) * Math.PI * 2 + rand() * 0.8;
    t.userData.home = new THREE.Vector3(
      Math.cos(a) * 0.086,
      FIRE_Y + 0.035 + i * 0.034,
      Math.sin(a) * 0.086,
    );
    t.userData.dir = a;
    t.userData.size = 0.66 + i * 0.26;
    t.userData.phase = rand() * 10;
    t.position.copy(t.userData.home);
    t.renderOrder = 3;
    t.castShadow = false;
    tongues.push(t);
  }
  disposables.push(tongueGeo, tongueMat);

  // The shell. A copy of the core's own shape, a third bigger and additively
  // blended, PARENTED to the core so it leans, stretches and curls with it.
  //
  // This started as a sphere, which is what the street lamp uses for its bloom,
  // and a sphere is right there because its flame is a speck two and a half
  // units up. Here the fire is the biggest thing on the prop and a round bloom
  // round a pointed body just put a halo behind a solid shape: you could still
  // see exactly where the opaque core stopped. A shell of the same shape blurs
  // the silhouette instead of framing it, and blurring the silhouette is the
  // whole difference between fire and a plastic teardrop, because the one thing
  // a real flame has no trace of is a hard edge.
  const shellGeo = flameGeometry(0.158 * 1.36, 0.455 * 1.16, {
    rows: 22, segments: 24,
    fade: { floor: 0.0, power: 1.25, heat: 0.45 },
    section: (a, t) => 1 + 0.070 * Math.cos(3 * a + 2.6 * t),
    curl: 0.16,
  });
  const shellMat = softLimb(new THREE.MeshBasicMaterial({
    color: BLOOM_FLAME.clone(),
    transparent: true,
    opacity: HALO.min,
    depthWrite: false,
    vertexColors: true,
    toneMapped: true,
    blending: THREE.AdditiveBlending,
  }), 'brazier-shell', 1.45);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.y = -0.030;
  shell.renderOrder = 2;
  shell.castShadow = false;
  core.add(shell);
  disposables.push(shellGeo, shellMat);

  // --- the one light -------------------------------------------------------
  // A point light, no shadow map, and that is the whole allowance. Six pumpkins
  // and five lanterns already put point lights into every fragment shader's
  // loop in this scene; this prop is the brightest of them, and being brightest
  // is a level and a colour, not a second light.
  //
  // It sits at the flame's TIP and not at its foot. three has no sphere light,
  // so a point source down in the coals sits in an inverse square singularity
  // an inch from the ash pan and burns the whole bed to flat white long before
  // anything a metre away has been lit at all. Lifting it to the tip is the
  // cheapest stand-in for a source with a radius, and it costs almost nothing
  // where it matters: the headstone a metre off changes by a couple of per
  // cent, and the pan stops clipping.
  //
  // Decay 1.4 rather than 2, for the reason the street lamp records. The bars
  // are 0.25 from the flame and the headstone behind is 1.0: a true inverse
  // square hands the bars sixteen times what it hands the stone, so any level
  // that lights the stone renders the near bars as white paste. At 1.4 that
  // ratio is six, which is the difference between iron that still has form on
  // it and iron that has gone to paper.
  const light = new THREE.PointLight(FLAME.clone(), LAMP.min, 7.0, 1.4);
  light.position.set(0, FIRE_Y + 0.400, 0);
  light.castShadow = false;

  // --- assembly ------------------------------------------------------------
  const body = new THREE.Group();
  body.add(ironMesh, coals, core, ...tongues, light);
  body.rotation.y = spin;
  body.rotation.x = Math.cos(leanDir) * lean;
  body.rotation.z = Math.sin(leanDir) * lean;

  const group = new THREE.Group();
  group.add(body);

  // The contact patch and the pool both go on the OUTER group, so the seeded
  // lean cannot tip either off the floor and leave an edge cutting through the
  // ground plane. The patch is small and dark and sits UNDER the painted pool:
  // three ball feet touch the earth over about a tenth of a unit each, and that
  // is the ground the fire above cannot reach, so darkening it is contact
  // rather than a hole punched in the light.
  const patch = contactShadow({ radius: 0.34, opacity: 0.24, softness: 0.66 });
  const pool = lightPool({ height: FIRE_Y + 0.40 });
  const poolMat = pool.material || null;
  group.add(patch, pool);
  group.scale.setScalar(scale);

  // PointLight.distance is in world units and three does not scale it by the
  // object's matrix, and its intensity is candela against a distance that grows
  // with the prop. Both are corrected or a brazier at scale 2 lights a quarter
  // as much ground as one at scale 1.
  const lightGain = scale * scale;
  light.distance = 7.0 * scale;

  // Read by the lab harness to plot the flicker without a screenshot. Nothing
  // in the prop reads it.
  group.userData.flame = { level: 1 };

  const lightHome = light.position.clone();
  const coreHome = core.position.clone();

  return {
    group,

    update(time, dt = 0) {
      // Four channels at once, and the fire only reads as fire when all four
      // are running: a fast tremble that never stops, a slow wander breathing
      // under it, the rare event, and the flame physically moving while it does
      // the rest.
      //
      // THE STALL IS THE THING TO WATCH, and it is not a matter of amplitude.
      // Smoothstep value noise has zero derivative at every lattice node, so a
      // channel at f Hz stands still f times a second by construction, and
      // summing three of them just gives three sets of stalls that occasionally
      // line up. The pumpkin's second pass measured 30% of its frames within
      // 0.002 of the one before doing exactly that, and the light visibly
      // froze. So the tremble below is NOT summed noise: it is sine carriers at
      // a flame's own flutter rate whose PHASE is dragged about by slow noise.
      // The flutter has a frequency; what wanders is where in the cycle it has
      // got to.
      //
      // This fire is in the open air, so it runs harder than either glazed
      // lantern: three carriers instead of two, the top one at 14 Hz, and a
      // gutter that is both commoner and deeper. Nothing above 15 Hz, because
      // at 60fps a 20 Hz carrier is three frames to a period and comes out as
      // sparkle rather than as flame.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));

      const tremble = 0.042 * wobble(6.7, 0.6, 12.4)
                    + 0.028 * wobble(10.3, 0.9, 55.1)
                    + 0.016 * wobble(14.1, 1.3, 88.7);

      // Wander: the breathing underneath, over a second or two. Summed noise is
      // right here and its stalls are a feature, a lull is what the slow channel
      // is for, and the tremble runs on through it regardless.
      const wander = 0.052 * swing(0.78, 0) + 0.034 * swing(2.3, 17.5);

      // Gutter: the wind takes the fire down. Only the top of a slow channel
      // counts, so these are events rather than a rhythm, and squaring the ramp
      // keeps the deep part brief while the onset and recovery stay soft. Far
      // commoner and deeper than a glazed lantern's, because there is no glass.
      const g = noise(t * 0.52 + 77.3);
      const gutter = g > 0.70 ? (g - 0.70) / 0.30 : 0;
      const dip = gutter * gutter * (0.44 + 0.30 * noise(t * 9.7 + 5.1));

      // Flare: the other half, when the fire catches and stands up.
      const fl = noise(t * 0.46 + 143.9);
      const flareRamp = fl > 0.76 ? (fl - 0.76) / 0.24 : 0;
      const flare = flareRamp * flareRamp * (0.16 + 0.10 * noise(t * 7.9 + 91.2));

      // A soft ceiling and not a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the ceiling and sit there, which is a
      // fire with no top end at all and, worse, a stall exactly where the eye is
      // looking. This bends the top over instead, matching value and slope at
      // the knee and asymptoting above it, so a flare is a peak with a shape.
      const KNEE = 0.88;
      const raw = 0.870 + tremble + wander + flare - dip;
      let level = raw <= KNEE
        ? raw
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      // And the same knee upside down at the bottom, which the glazed lanterns
      // do not need and this one does. Their gutters are shallow because they
      // have a chimney over them; an open fire's deepest gutters ran to 0.07
      // measured, which is a prop that goes out and comes back several times a
      // minute. A fire has coals under it and coals do not blow out, so the
      // bottom bends over to a floor at 0.30 instead of running to zero. It
      // matters more than the ceiling does: a blackout is the loudest thing a
      // light can do and this one was doing it by accident.
      const FLOOR = 0.30, FKNEE = 0.48;
      if (level < FKNEE) {
        level = FLOOR + (FKNEE - FLOOR) * Math.exp(-(FKNEE - level) / (FKNEE - FLOOR));
      }

      const at = (range) => range.min + (range.max - range.min) * level;

      // A guttering fire reddens as it drops and a flaring one goes whiter, so
      // colour rides the same value rather than sitting at a fixed warm white,
      // and the flame BODY has to do it as much as the light does.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));

      light.intensity = at(LAMP) * lightGain;
      light.color.copy(EMBER).lerp(FLAME, hue);

      coreMat.color.copy(CORE_EMBER).lerp(CORE_FLAME, hue).multiplyScalar(at(CORE));
      tongueMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, hue);
      tongueMat.opacity = at(TONGUE);
      shellMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, hue * 0.75);
      shellMat.opacity = at(HALO);
      ironMat.emissiveIntensity = at(IRONGLOW);
      if (poolMat) {
        poolMat.opacity = at(POOL);
        poolMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, hue);
      }

      // The coals lag the flame. A bed of embers has thermal mass: it does not
      // duck when the wind does, it glows on through a gutter and that is what
      // makes the gutter read as the FLAME being blown about rather than as
      // somebody turning a dimmer down on the whole prop. A cheap one pole
      // filter, floored so it never goes out.
      const coalLevel = 0.62 + 0.38 * level;
      coalMat.emissiveIntensity = COALS.min + (COALS.max - COALS.min) * coalLevel;
      coalMat.emissive.copy(COAL_EMBER).lerp(COAL_FLAME, hue * 0.55);

      // --- the fire moves ------------------------------------------------
      // This is the half of the effect that modulating intensity cannot reach,
      // and on an open fire it is the bigger half. The source slides, so the
      // pool on the ground slides with it and the side of the headstone that is
      // lit changes.
      const across = 0.026 * (0.5 * swing(0.9, 5.5) + 0.5 * wobble(3.3, 0.6, 71.6));
      const into = 0.024 * (0.5 * swing(0.7, 2.7) + 0.5 * wobble(2.7, 0.8, 33.4));
      const rise = 0.030 * flare - 0.026 * dip + 0.006 * swing(1.5, 8.1);
      const stretch = 0.74 + 0.42 * level;

      core.position.set(coreHome.x + across, coreHome.y + rise * 0.35, coreHome.z + into);
      core.scale.set(0.90 + 0.16 * level, stretch, 0.90 + 0.16 * level);
      // A flame leans from its root, so the tip travels several times as far as
      // the body does. Rotating about the base is what turns a sliding blob into
      // something hinged at the coals.
      core.rotation.set(into * 3.4, 0, -across * 3.4);

      // Each tongue on its own phase, and each one lives on a cycle of its own:
      // it grows up out of the core, thins, and drops back. That cycle is the
      // one thing here that does not ride the shared level, because licks
      // detaching and dying is what an open fire does WHILE it is otherwise
      // steady, and if every part of the fire moved together the whole thing
      // would read as one object breathing.
      for (let i = 0; i < tongues.length; i++) {
        const T = tongues[i];
        const p = T.userData.phase;
        const lick = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (t * (0.72 + i * 0.19) + noise(t * 0.5 + p) * 3));
        const lean = 0.30 + 0.55 * lick;
        const dirX = Math.cos(T.userData.dir), dirZ = Math.sin(T.userData.dir);
        const sway = 0.030 * wobble(4.1 + i * 1.3, 0.7, p * 7);
        T.position.set(
          T.userData.home.x + across * 1.5 + dirX * lick * 0.028 + sway * dirZ,
          T.userData.home.y + rise + lick * 0.062,
          T.userData.home.z + into * 1.5 + dirZ * lick * 0.028 - sway * dirX,
        );
        const s = T.userData.size * (0.62 + 0.30 * level);
        T.scale.set(s * (1.05 - 0.32 * lick), s * (0.80 + 0.75 * lick), s * (1.05 - 0.32 * lick));
        T.rotation.set(
          (into * 3.0 + dirZ * lean * 0.30),
          0,
          -(across * 3.0 + dirX * lean * 0.30),
        );
      }

      // The light rides the flame's tip, so the pool and the wash on the stone
      // swing with the fire rather than sitting nailed to the axis.
      light.position.set(
        lightHome.x + across * 2.2,
        lightHome.y + rise * 1.6 + 0.030 * (level - 0.87),
        lightHome.z + into * 2.2,
      );

      group.userData.flame.level = level;
    },

    dispose() {
      for (const d of disposables) d.dispose();
      patch.userData.dispose?.();
      pool.userData.dispose?.();
      light.dispose?.();
    },
  };
}
