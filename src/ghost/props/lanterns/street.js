import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS, toyMaterial, contactShadow } from '../style.js';

// The tall street lamp: a wrought iron post with a moulded foot, a slender
// tapering shaft and a glazed head with a peaked cap and a finial.
//
// This is the tallest thing in the set, so it is the piece that draws the
// graveyard's skyline, and everything below is decided by silhouette first and
// detail second. Three things were settled before any geometry was written.
//
// HEIGHT: 3.30. The ghost is 1.60, the skeleton 2.50, the tallest headstone
// 1.56, the fence 0.86, the shed's ridge 2.02. At 3.30 the lamp is 2.06 ghosts
// tall and stands a full 0.8 over the skeleton, which is the smallest margin
// that still reads as "and then there is the lamp" rather than as "one more
// tall thing". The camera is framed for a 1.6 ghost, so the top end matters as
// much: at 3.6 the head leaves the frame in the scene's standard three-quarter
// shot, and a lantern you cannot see is not worth 3.6 units of post. 3.30 also
// puts the flame at 2.62, which is above the skeleton's skull and below the
// top of the frame, so the brightest point in the prop sits where the eye is
// already looking. See out/street/ for the renders it was chosen on.
//
// GIRTH: the shaft is 0.20 across where its taper starts, 0.17 at its middle
// and 0.12 at the neck, so at its thinnest it is one part in twenty seven of
// the height. A real cast iron column is nearer one part in forty, and at this
// size that renders as bent wire and disappears entirely at a distance. The
// rule that kept it honest is the brief's: anything that would be a rod on a
// real lamp is a finger-thick rounded bar here, so the four glazing bars round
// the head are 0.052 across rather than the 0.015 the reference has, and there
// is no crossbar, no ladder rest and no scrollwork, because every one of those
// is a wire that cannot be made fat without becoming a plank.
//
// GLASS: the scene has no environment map, so the panes have nothing to
// reflect and a plain transparent material renders as grey nothing. The
// fountain hit this first and its answer is borrowed wholesale below: a small
// procedural sky sampled off the reflected normal, a Schlick fresnel deciding
// how much of it you see, and one tight Blinn lobe for the key light. See
// GLASS_OPTICS.
//
// WHAT IT COSTS: six draw calls and 19,100 triangles. Four of the calls are
// the ironwork merged into one geometry, the glazing, the flame and its bloom;
// the other two are the two floor decals, the contact patch and the light pool.
// The ironwork is 17k of the triangles and it is where any further saving is:
// the head runs at 40 steps round and the post at 28, and both were checked at
// a close-up the prop will never actually be seen at.

// ---------------------------------------------------------------------------
// metrics
//
// Every dimension in one place, in the same spirit as the fence's metrics.js.
// Profiles are lists of [radius, height] corners, later filleted, so a number
// here is a corner of the silhouette and never a face of it.
const M = {
  height: 3.30,

  // The post: foot, shaft and neck as one continuous turned profile, so there
  // is no seam anywhere down the two metres the eye actually travels.
  post: [
    [0.000, 0.000],
    [0.300, 0.000],
    [0.300, 0.048],
    [0.226, 0.112],
    [0.244, 0.146],
    [0.244, 0.192],
    [0.146, 0.296],
    [0.122, 0.372],
    [0.102, 0.500],
    [0.084, 1.090],
    [0.099, 1.156],
    [0.099, 1.202],
    [0.080, 1.268],
    [0.066, 2.010],
    [0.085, 2.062],
    [0.085, 2.108],
    [0.062, 2.168],
    [0.062, 2.230],
    [0.000, 2.230],
  ],
  // Fillet radius at each corner above. Generous on the foot, tight on the two
  // beads, which are only 0.015 proud and would be filleted clean away.
  postRound: [
    0.000, 0.030, 0.030, 0.052, 0.013, 0.013, 0.060, 0.045, 0.055,
    0.055, 0.012, 0.012, 0.016, 0.048, 0.014, 0.014, 0.018, 0.020, 0.000,
  ],

  // The lantern's floor: a flared skirt closed top and bottom, so the post's
  // own top disappears inside it and no ring gap can open where they meet.
  skirt: [
    [0.000, 2.150],
    [0.104, 2.150],
    [0.136, 2.196],
    [0.226, 2.278],
    [0.262, 2.336],
    [0.260, 2.376],
    [0.226, 2.398],
    [0.000, 2.398],
  ],
  skirtRound: [0.000, 0.030, 0.034, 0.048, 0.030, 0.020, 0.026, 0.000],

  // The glazing. Given a slight belly rather than a straight taper: a straight
  // one reads as a machined tube and the whole set is moulded.
  glass: [
    [0.220, 2.386],
    [0.229, 2.470],
    [0.220, 2.620],
    [0.201, 2.740],
    [0.186, 2.802],
  ],
  glassRound: [0.000, 0.090, 0.090, 0.070, 0.000],

  // Top rim, eaves and peaked cap, again as one turned piece. The eave flares
  // to 0.262 and comes back, which is the overhang; filleting turns the two
  // corners of that into a drip edge.
  cap: [
    [0.000, 2.792],
    [0.196, 2.792],
    [0.218, 2.812],
    [0.218, 2.856],
    [0.200, 2.872],
    [0.284, 2.892],
    [0.278, 2.932],
    [0.152, 3.062],
    [0.062, 3.152],
    [0.000, 3.186],
  ],
  capRound: [0.000, 0.016, 0.014, 0.014, 0.014, 0.020, 0.030, 0.042, 0.032, 0.000],

  // The finial. Fat by design: a spike here would be the one sharp thing in a
  // set with nothing sharp in it, and it is the highest point in the scene.
  finial: [
    [0.000, 3.100],
    [0.040, 3.104],
    [0.036, 3.146],
    [0.064, 3.184],
    [0.064, 3.212],
    [0.036, 3.246],
    [0.030, 3.266],
    [0.019, 3.292],
    [0.000, 3.300],
  ],
  finialRound: [0.000, 0.016, 0.014, 0.020, 0.020, 0.018, 0.012, 0.010, 0.000],

  // The burner the flame stands on. Small, and it earns its 300 triangles: the
  // lantern's floor is 0.2 below a point light and renders as one flat cream
  // disc, which was the brightest and emptiest thing on the prop. A cup with a
  // rim breaks that disc into a lit ring, a shaded bowl and a highlight, and it
  // gives the flame something to be standing on rather than hovering over.
  burner: [
    [0.000, 2.398],
    [0.088, 2.400],
    [0.092, 2.428],
    [0.070, 2.460],
    [0.042, 2.472],
    [0.038, 2.540],
    [0.000, 2.548],
  ],
  burnerRound: [0.000, 0.016, 0.018, 0.022, 0.016, 0.014, 0.000],

  // The four glazing bars. Finger-thick, see the note at the top.
  bar: { radius: 0.026, bottom: 2.372, top: 2.818 },

  // How square the head is. 2 is a circle; this is a soft square whose corner
  // stands 20% further out than its faces. It was 3.4 and that was too round:
  // seen square on, where the two visible corners are the silhouette, the cap
  // came out as a dome rather than as a peaked roof and the whole head read as
  // a jar. At 4.2 the corner ridges are definite enough to draw the roof and
  // still have a radius on them you could not cut yourself on.
  section: 4.2,

  flameY: 2.615,
};

// Tessellation. The post is 0.17 across and never needs 48 steps round; the
// head is the piece the eye lands on and does.
const SEG = {
  post: Math.round(SEGMENTS.radial * 0.58),   // 28
  head: Math.round(SEGMENTS.radial * 0.83),   // 40
  bar: 12,
};

// Painted cast iron. Rougher than metal and smoother than stone, which is what
// old enamelled ironwork is: metalness stays at zero because with no
// environment map a metal in this scene renders black.
const IRON = '#4d535c';
const GLASS_TINT = '#cfd8d4';

// The flame's two ends, and the same trick the pumpkin uses to reach them:
// the level spends its life in the top eighth of its range, so the colour mix
// is levered about the level's mean rather than taken off it raw.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
const PLATE_EMBER = new THREE.Color('#ff7b2c');
const PLATE_FLAME = new THREE.Color('#ffb44a');
const HUE_MID = 0.912, HUE_GAIN = 1.5;

// What the flame drives, at the bottom and the top of its swing.
//
// One PointLight and no shadow map, which is the budget rule and is also the
// right answer here. Six pumpkins already put six point lights into every
// fragment shader's loop; a seventh is the whole allowance. A shadow-casting
// spot from 2.62 up would spend its entire map on the lamp's own post drawn as
// a stripe across the graveyard, and the thing a lantern actually does to a
// scene, a soft pool of warm on the ground and a warm side on everything near
// it, is exactly what an unshadowed point light does for free.
const LAMP = { min: 2.4, max: 5.2 };      // PointLight intensity, 2.17:1
const INNER = { min: 0.26, max: 0.80 };   // the glass lit from inside
const WICK = { min: 0.70, max: 1.70 };    // the flame mesh's emissive
const HALO = { min: 0.18, max: 0.44 };    // the bloom around it
const POOL = { min: 0.10, max: 0.26 };    // the warm on the ground under it
// The halo and the pool composite ADDITIVELY, and additive light saturates to
// white long before an emissive does. So they get their own pair, a good deal
// deeper than the plate's, or the flame's core and the pool's middle both come
// out as cream discs with an orange edge.
const BLOOM_EMBER = new THREE.Color('#ff5410');
const BLOOM_FLAME = new THREE.Color('#ff9a35');

// ---------------------------------------------------------------------------
// profile and surface helpers

// Smooth 1D value noise, same construction as the pumpkin's. Layered it gives
// the slow wander and the rare events. What it cannot give is the tremble:
// smoothstep is flat at every lattice node, so a channel at f Hz stands still
// f times a second. See update() for what carries the tremble instead.
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

function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Round every corner of a [radius, height] polyline into a real arc, and
// return it densely sampled.
//
// This is the whole reason nothing on this prop has a hard edge: the numbers in
// M are corners of a draughtsman's silhouette, and a lathe run over them
// directly gives cast iron with a machined chamfer on it. Filleted first, the
// same numbers give a moulding.
//
// The fence's board() records the trap this has to avoid: sample at even t and
// loft straight between rings and an ease shorter than one segment smears
// across a whole segment. So the arcs get their OWN samples, proportional to
// how far they turn, rather than being asked to appear in a fixed grid.
function fillet(points, radii, perTurn = 7) {
  const P = points.map(([r, y]) => new THREE.Vector2(r, y));
  const out = [P[0].clone()];

  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const u = new THREE.Vector2().subVectors(a, b);
    const v = new THREE.Vector2().subVectors(c, b);
    const lu = u.length(), lv = v.length();
    if (lu < 1e-6 || lv < 1e-6) continue;
    u.divideScalar(lu); v.divideScalar(lv);

    const cosT = Math.max(-0.9999, Math.min(0.9999, u.dot(v)));
    const theta = Math.acos(cosT);            // the angle the corner encloses
    // A straight run needs no fillet, and tan(theta/2) blows up there.
    if (theta > Math.PI - 1e-3) { out.push(b.clone()); continue; }

    // Tangent length for the asked radius, then clamped so a fillet can never
    // eat more than 45% of either neighbouring segment. Without this the two
    // beads on the shaft, whose segments are 12mm long, swallowed each other.
    let r = Math.max(0, radii[i] || 0);
    let t = r / Math.tan(theta / 2);
    const tMax = Math.min(lu, lv) * 0.45;
    if (t > tMax) { t = tMax; r = t * Math.tan(theta / 2); }
    if (r < 1e-5) { out.push(b.clone()); continue; }

    const pA = new THREE.Vector2().copy(b).addScaledVector(u, t);
    const pC = new THREE.Vector2().copy(b).addScaledVector(v, t);
    // Centre of the arc: along the corner's bisector, at r / sin(theta/2).
    const bis = new THREE.Vector2().addVectors(u, v).normalize();
    const centre = new THREE.Vector2().copy(b).addScaledVector(bis, r / Math.sin(theta / 2));

    const a0 = Math.atan2(pA.y - centre.y, pA.x - centre.x);
    let a1 = Math.atan2(pC.y - centre.y, pC.x - centre.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    const steps = Math.max(2, Math.ceil(perTurn * Math.abs(d) / (Math.PI / 2)));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + d * (k / steps);
      out.push(new THREE.Vector2(centre.x + r * Math.cos(ang), centre.y + r * Math.sin(ang)));
    }
  }
  out.push(P[P.length - 1].clone());

  // Split any long straight run, so the shading has somewhere to put a gradient
  // and a merged geometry does not carry one 800mm quad. Not finer than this:
  // a straight run of a solid of revolution has an exact normal at every ring
  // whatever the spacing, so extra rows down the shaft buy nothing at all, and
  // at 0.075 they were a third of the prop's triangles.
  const dense = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const gap = out[i].distanceTo(out[i - 1]);
    const n = Math.max(1, Math.ceil(gap / 0.16));
    for (let k = 1; k <= n; k++) dense.push(new THREE.Vector2().lerpVectors(out[i - 1], out[i], k / n));
  }
  return dense;
}

// A superellipse cross section: 2 is a circle, higher is squarer, and the
// corner comes out rounded by construction rather than by filleting a box.
// Same expression the fence's boards use.
function superSection(n) {
  const e = 2 / n;
  return (ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [
      Math.sign(c) * Math.pow(Math.abs(c), e),
      Math.sign(s) * Math.pow(Math.abs(s), e),
    ];
  };
}

const ROUND_SECTION = (ang) => [Math.cos(ang), Math.sin(ang)];

// Revolve a filleted profile, optionally through a non-circular section.
//
// Two things it does that THREE.LatheGeometry does not, and both are why it is
// here. The seam vertex is not duplicated, so normals average across it and no
// crease runs up the post. And a profile that reaches radius zero at either end
// is welded to a single pole vertex, which both closes the piece and keeps the
// pole smooth: LatheGeometry has no end caps at all, and a ring of coincident
// vertices would shade as a facet fan.
function revolve(profile, { section = ROUND_SECTION, segments = 32 } = {}) {
  const rows = profile.length;
  const verts = [];
  const index = [];
  const rowStart = new Array(rows);

  const cs = [];
  for (let j = 0; j < segments; j++) cs.push(section((j / segments) * Math.PI * 2));

  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i];
    if (r < 1e-6 && (i === 0 || i === rows - 1)) {
      rowStart[i] = -(verts.length / 3) - 1;   // negative marks a welded pole
      verts.push(0, y, 0);
      continue;
    }
    rowStart[i] = verts.length / 3;
    for (let j = 0; j < segments; j++) verts.push(cs[j][0] * r, y, cs[j][1] * r);
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
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// One glazing bar: a capsule, so both ends are closed by the surface itself
// rather than by a cap that could face the wrong way. The hemispherical ends
// get their own dense rings for the same reason the fillets do.
function capsule({ length, r0, r1, segments = 12, capSteps = 5 }) {
  const rows = [];
  for (let k = 0; k <= capSteps; k++) {
    const phi = (k / capSteps) * (Math.PI / 2);
    rows.push(new THREE.Vector2(r0 * Math.sin(phi), r0 * (1 - Math.cos(phi))));
  }
  const body = 5;
  for (let k = 1; k < body; k++) {
    const t = k / body;
    rows.push(new THREE.Vector2(r0 + (r1 - r0) * t, r0 + (length - r0 - r1) * t));
  }
  for (let k = capSteps; k >= 0; k--) {
    const phi = (k / capSteps) * (Math.PI / 2);
    rows.push(new THREE.Vector2(r1 * Math.sin(phi), length - r1 * (1 - Math.cos(phi))));
  }
  // Pole rows so revolve() welds and closes them.
  rows.unshift(new THREE.Vector2(0, 0));
  rows.push(new THREE.Vector2(0, length));
  return revolve(rows, { segments });
}

// The warm on the ground, as a decal rather than as light.
//
// This is not laziness about the point light, it is the only way to have both.
// The lantern is 2.6 up and the scene is broad daylight: a hemisphere at 1.15
// and a key at 2.1 already put about 2.9 on the floor, so a point light needs
// to land near 1.0 there before anything reads, and one that does is a hundred
// times over the top on the glazing bars 0.24 from it. Flattening the decay
// (see the light below) buys most of the gap and not all of it. So the point
// light is set where the IRONWORK looks right, and the last of the pool is
// painted on, the same trick and the same machinery as style.js's contact
// shadow, which exists for the mirror-image reason.
//
// The profile is not a generic gradient. Irradiance from a point at height h on
// the floor at lateral distance x goes as cos(theta) / d^decay, so it is widest
// where the lamp is tallest; baked here rather than smoothstepped, the pool
// reaches about a third of its centre value at x = h, which is what makes it
// read as thrown from up there and not as a puddle at the foot.
function lightPool({ radius = 3.0, height = 2.575, decay = 1.25 } = {}) {
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
      // Taken to zero at the quad's edge, or the decal ends on a visible disc.
      v *= Math.max(0, 1 - Math.pow(lat / radius, 2.2));
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
  // Above the contact patch, which is at 0.004. The two are not fighting: the
  // patch is 0.44 across and darkens the few centimetres the foot actually
  // touches, which is ground a lamp cannot light anyway.
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  mesh.userData.dispose = () => { texture.dispose(); material.dispose(); mesh.geometry.dispose(); };
  return mesh;
}

// ---------------------------------------------------------------------------
// the glass
//
// Borrowed from the fountain, whose note on it is the one to read: this scene
// has no environment map, so a transparent material has nothing to reflect and
// renders as grey nothing however low its roughness goes. The sky here is three
// bands and a smoothstep, the horizon is where the grey floor takes over, and
// the sun is one Blinn lobe. No texture fetch, no uniforms beyond the palette,
// and it is the difference between glazing and a hole.
//
// The lamp's glass has one thing the fountain's water does not: it is lit from
// the inside, and by a flame that moves. So the body term is the flame's own
// colour rather than the material's shading, and it rides the same level the
// point light does. And it is sooted at the top, because every real lamp glass
// is: that costs one smoothstep and it is what stops the pane reading as
// moulded acrylic.
const GLASS_OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uFlameCol;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uInner;
uniform float uBody;
varying vec3 vGN;
varying vec3 vGP;
varying float vGT;

// Both cameras in this project are orthographic, so this is one constant per
// frame and the branch costs nothing. The transpose trick gets a world-space
// vector out of a view-space one without an inverse, which GLSL ES 1.0 lacks.
vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands, not two. The middle one is the scene's own backdrop and it
// matters most: a curved pane seen near its silhouette reflects almost
// horizontally, so its rim samples the horizon and nothing else.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with glass's F0 rather than water's: 0.04, so a pane facing you
// reflects four per cent and its silhouette reflects nearly all of it. That
// gradient IS the glazing.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}
`;

const GLASS_FRAG = `
  vec3 wN = normalize(vGN);
  vec3 wV = worldViewDir(vGP);
  float ndv = clamp(abs(dot(wN, wV)), 0.0, 1.0);

  // Soot, thickest at the top of the pane where the flame's plume sits against
  // it. It takes the shine off as well as darkening, which is the half that
  // actually reads.
  float soot = smoothstep(0.42, 0.98, vGT) * 0.80;

  vec3 h = normalize(wV + uSunDir);
  float glint = pow(max(dot(wN, h), 0.0), uShine);
  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0) * (1.0 - soot * 0.75);
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * glint);

  // What you see THROUGH the pane: the flame behind it, warmest low down where
  // the flame is, plus whatever the scene puts on the glass itself.
  float lit = uInner * mix(1.0, 0.35, smoothstep(0.25, 1.0, vGT));
  vec3 body = (outgoingLight + uFlameCol * lit) * (1.0 - soot * 0.55);

  float A = clamp(uBody + soot * 0.34, 0.0, 1.0);
  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

// ---------------------------------------------------------------------------

export function createStreetLamp({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed * 2654435761 + 41);
  const noise = makeNoise(seed);
  const flickerPhase = rand() * 100;

  const group = new THREE.Group();
  // Inner group carries the seeded lean, so the caller still owns the outer
  // one's position and yaw. Same arrangement the tombstones use.
  const body = new THREE.Group();
  group.add(body);

  const section = superSection(M.section);
  const disposables = [];

  // --- the ironwork --------------------------------------------------------
  // Five turned pieces plus four bars, merged into one geometry. They share a
  // material and never move relative to each other, so as separate meshes they
  // would be nine draw calls buying nothing.
  const ironParts = [
    revolve(fillet(M.post, M.postRound), { segments: SEG.post }),
    revolve(fillet(M.skirt, M.skirtRound, 9), { section, segments: SEG.head }),
    revolve(fillet(M.cap, M.capRound, 9), { section, segments: SEG.head }),
    revolve(fillet(M.burner, M.burnerRound, 8), { segments: SEG.post }),
    revolve(fillet(M.finial, M.finialRound, 10), { segments: SEG.post }),
  ];

  // The bars stand at the section's four corners, which for a superellipse are
  // the diagonals, and they lean in with the head's taper. Half of each bar is
  // inside the glass, which is what a real glazing bar does and what stops the
  // four of them reading as pipes strapped to the outside.
  {
    const corner = (halfWidth) => {
      const [cx, cz] = section(Math.PI / 4);
      return Math.hypot(cx, cz) * halfWidth;
    };
    const rBot = corner(0.220);
    const rTop = corner(0.188);
    const len = M.bar.top - M.bar.bottom;
    const lean = Math.atan2(rBot - rTop, len);
    const geo = capsule({ length: len / Math.cos(lean), r0: M.bar.radius, r1: M.bar.radius * 0.94, segments: SEG.bar });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * (Math.PI / 2);
      const m = new THREE.Object3D();
      m.position.set(Math.cos(a) * rBot, M.bar.bottom, Math.sin(a) * rBot);
      // Tip the bar toward the axis by `lean`, about the horizontal axis at
      // right angles to its own radius.
      m.rotateOnWorldAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).normalize(), -lean);
      m.updateMatrix();
      ironParts.push(geo.clone().applyMatrix4(m.matrix));
    }
    geo.dispose();
  }

  const ironGeo = mergeGeometries(ironParts, false);
  ironParts.forEach((g) => g.dispose());
  const ironMat = toyMaterial(IRON, { roughness: 0.58 });
  const iron = new THREE.Mesh(ironGeo, ironMat);
  iron.castShadow = true;
  iron.receiveShadow = true;
  body.add(iron);
  disposables.push(ironGeo, ironMat);

  // --- the glazing ---------------------------------------------------------
  const glassGeo = revolve(fillet(M.glass, M.glassRound, 8), { section, segments: SEG.head });
  {
    // A 0..1 up the pane, for the soot and for the flame's falloff. Written as
    // an attribute rather than derived from world Y in the shader, so scaling
    // or moving the prop cannot slide the soot along it.
    const pos = glassGeo.getAttribute('position');
    const t = new Float32Array(pos.count);
    const y0 = M.glass[0][1], y1 = M.glass[M.glass.length - 1][1];
    for (let i = 0; i < pos.count; i++) t[i] = (pos.getY(i) - y0) / (y1 - y0);
    glassGeo.setAttribute('aPane', new THREE.BufferAttribute(t, 1));
  }

  const glassUniforms = {
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#868b95').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.2, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff4e6').convertSRGBToLinear() },
    uFlameCol: { value: FLAME.clone() },
    // Over one on purpose. The fake sky is a flat gradient with no bright spots
    // of its own to find, so a physically honest fresnel leaves the pane's edge
    // barely separated from the iron behind it.
    uRimGain: { value: 1.90 },
    uGlint: { value: 1.15 },
    uShine: { value: 150.0 },
    uInner: { value: INNER.min },
    // How much of the pane is pane rather than reflection. Low: this is
    // glazing, and the flame behind it has to come through.
    uBody: { value: 0.19 },
  };

  const glassMat = toyMaterial(GLASS_TINT, {
    roughness: 0.14,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPane;
varying vec3 vGN;
varying vec3 vGP;
varying float vGT;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGN = normalize(mat3(modelMatrix) * objectNormal);
  vGP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGT = aPane;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_OPTICS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Or three hands this material a depth program it compiled for some other
  // MeshStandardMaterial with the same parameters.
  glassMat.customProgramCacheKey = () => 'street-lamp-glass';

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 3;
  glass.castShadow = false;   // a shadow-casting pane would black out its own lantern
  body.add(glass);
  disposables.push(glassGeo, glassMat);

  // --- the flame -----------------------------------------------------------
  // A small teardrop on a wick. Emissive rather than lit, because this is light
  // leaving a surface and it has to survive being on the shadowed side.
  const flameGeo = revolve(fillet([
    [0.000, 0.000],
    [0.042, 0.016],
    [0.050, 0.062],
    [0.038, 0.120],
    [0.016, 0.168],
    [0.000, 0.190],
  ], [0.000, 0.018, 0.030, 0.036, 0.028, 0.000], 8), { segments: 22 });
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0x110800,
    emissive: PLATE_FLAME.clone(),
    emissiveIntensity: WICK.min,
    roughness: 1.0,
    metalness: 0.0,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = M.flameY - 0.086;
  body.add(flame);
  disposables.push(flameGeo, flameMat);

  // The bloom around it. A sphere with an additive falloff off its own normal,
  // which on a sphere is a soft radial blob and costs one power function. The
  // lamp is small in frame at this height, and without it the head reads as a
  // dark box with a speck in it.
  const haloGeo = new THREE.SphereGeometry(0.088, 20, 14);
  const haloMat = new THREE.MeshBasicMaterial({
    color: BLOOM_FLAME.clone(),
    transparent: true,
    opacity: HALO.min,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  haloMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHN;\nvarying vec3 vHP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vHN = normalize(mat3(modelMatrix) * normal);
  vHP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHN;
varying vec3 vHP;`)
      .replace('#include <opaque_fragment>', `
  vec3 vd = isOrthographic
    ? normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z))
    : normalize(cameraPosition - vHP);
  float d = clamp(dot(normalize(vHN), vd), 0.0, 1.0);
  gl_FragColor = vec4(outgoingLight, diffuseColor.a * pow(d, 2.4));`);
  };
  haloMat.customProgramCacheKey = () => 'street-lamp-halo';
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = M.flameY;
  halo.renderOrder = 2;
  body.add(halo);
  disposables.push(haloGeo, haloMat);

  // --- the light -----------------------------------------------------------
  // Decay is 1.25, and this is the one number on the prop that is a frank
  // cheat. A point source in the middle of a lantern is the worst case for
  // inverse square: the glazing bars are 0.24 from it and the ground is 2.6, so
  // a physical falloff hands the bars a hundred and twenty times what it hands
  // the floor. Tuned to light the floor, the bars rendered white hot and lost
  // their shading entirely, and every version of "turn it down" that fixed the
  // bars left nothing at all on the ground. Flattening the exponent squeezes
  // that ratio from 120 to 15, which is the whole fix: the bars come back as
  // warm bronze with their form intact and the pool under the post still reads.
  // Physically the shortfall it stands in for is real enough, a lantern's glass
  // is an area source and this scene has no bounce, and neither of those obeys
  // an inverse square either. distance closes the light off before it reaches
  // the far side of the plot.
  const light = new THREE.PointLight(FLAME.clone(), LAMP.min, 11.0, 1.25);
  light.position.set(0, M.flameY, 0);
  light.castShadow = false;
  body.add(light);

  // The contact patch. A lamp post's footprint is small and the key light comes
  // in at an angle, so its own cast shadow lands well off to one side and
  // nothing darkens the ground where the foot actually meets it.
  const patch = contactShadow({ radius: 0.44, opacity: 0.40, softness: 0.5 });
  body.add(patch);

  // The pool goes on the OUTER group, so the post's seeded lean cannot tip it
  // off the floor and leave one edge cutting into the ground plane.
  const pool = lightPool({ height: M.flameY });
  const poolMat = pool.material || null;
  group.add(pool);

  // A hand-set post never stands quite true, and a lamp that does looks
  // dropped in. Small: the silhouette still has to read as vertical over three
  // and a third units, where the same lean that flatters a headstone would put
  // the finial 60mm off plumb.
  body.rotation.z = (rand() - 0.5) * 0.022;
  body.rotation.x = (rand() - 0.5) * 0.018;
  // Bedded four millimetres, because a 0.6 foot tilted by eleven milliradians
  // lifts its far edge three millimetres clear of the floor, and a prop that
  // hovers is the one thing a contact patch cannot fix.
  body.position.y = -0.004;
  // The head is square, so which way it faces is a real choice and should not
  // be the same one every time.
  body.rotation.y = rand() * Math.PI * 2;

  group.scale.setScalar(scale);
  // PointLight.distance is in world units and three does not scale it by the
  // object's matrix, and its intensity is candela against a distance that grows
  // with the prop. So both are corrected here, or a lamp at scale 2 lights a
  // quarter as much ground as one at scale 1.
  const lightGain = scale * scale;
  light.distance = 11.0 * scale;

  // Read by the lab harness to plot the flicker without a screenshot. Nothing
  // in the prop reads it.
  group.userData.flame = { level: 1 };

  return {
    group,

    update(time) {
      // A candle is mostly steady and it is never still, and this one is behind
      // glass: sheltered from the wind that makes a jack-o-lantern's flame
      // duck, so it guts less often and less deep than the pumpkin's and its
      // wander is slower. What it must not do is stop.
      //
      // The stall is the thing to watch and it is not a matter of amplitude.
      // Smoothstep value noise has zero derivative at every lattice node, so a
      // channel at f Hz stands still f times a second by construction, and
      // summing three of them just gives three sets of stalls that occasionally
      // line up. The pumpkin measured 30% of its frames within 0.002 of the one
      // before doing exactly that. So the tremble below is not summed noise.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;

      // Tremble: a carrier at a flame's own flicker rate whose PHASE is dragged
      // about by slow noise. A flame's flutter has a frequency; what wanders is
      // where in the cycle it has got to, not whether it is happening. Two
      // carriers, both inside the 5 to 15Hz band a real flame flickers in and
      // nothing faster, because at 60fps a 20Hz carrier is three frames to a
      // period and reads as sparkle rather than as tremble.
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.026 * wobble(6.4, 0.55, 12.4) + 0.015 * wobble(11.7, 0.85, 55.1);

      // Wander: the breathing underneath, over a second or two. Summed noise is
      // right for this one and its stalls are a feature, a lull is what the
      // slow channel is for, and the tremble runs through it regardless.
      const wander = 0.036 * swing(0.62, 0) + 0.024 * swing(1.7, 17.5);

      // Gutter. Only the top of a slow channel counts, so these are separate
      // events rather than a rhythm, and squaring the ramp keeps the deep part
      // brief while onset and recovery stay soft. Rarer and shallower than the
      // pumpkin's: this flame has a chimney over it.
      const g = noise(t * 0.34 + 77.3);
      const gutter = g > 0.80 ? (g - 0.80) / 0.20 : 0;
      const dip = gutter * gutter * (0.30 + 0.20 * noise(t * 8.1 + 5.1));

      // Flare, the other half: now and then the flame straightens and stands up
      // and the whole head goes pale for a second.
      const fl = noise(t * 0.29 + 143.9);
      const flareRamp = fl > 0.82 ? (fl - 0.82) / 0.18 : 0;
      const flare = flareRamp * flareRamp * (0.09 + 0.06 * noise(t * 6.3 + 91.2));

      // A soft ceiling rather than a clamp. Clamped at 1, every flare and a
      // good many ordinary peaks land flat on the ceiling and sit there, which
      // pins the glass at INNER.max, the one state in which the pane's own
      // gradient stops separating from the soot. This bends the top over
      // instead, matching value and slope at the knee and asymptoting above it,
      // so a flare comes out as a peak with a shape on it.
      const KNEE = 0.90;
      const raw = 0.925 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const at = (range) => range.min + (range.max - range.min) * level;
      // Lamp, glass, wick and bloom all come off the one value. That is the
      // whole trick: four things driven separately read as four things.
      light.intensity = at(LAMP) * lightGain;
      glassUniforms.uInner.value = at(INNER);
      flameMat.emissiveIntensity = at(WICK);
      haloMat.opacity = at(HALO);
      if (poolMat) poolMat.opacity = at(POOL);

      // Colour, levered about the level's mean so ember is reachable inside a
      // real gutter rather than only inside a blackout.
      const k = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      light.color.copy(EMBER).lerp(FLAME, k);
      glassUniforms.uFlameCol.value.copy(EMBER).lerp(FLAME, k);
      flameMat.emissive.copy(PLATE_EMBER).lerp(PLATE_FLAME, k);
      haloMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, k);
      if (poolMat) poolMat.color.copy(BLOOM_EMBER).lerp(BLOOM_FLAME, k);

      // The flame physically moves while it does the rest, which is the fourth
      // channel and the one that stops the head reading as a bulb on a dimmer.
      // Across is a carrier of its own so the tip whips at about the rate the
      // brightness trembles at instead of drifting with the wander.
      const sway = 0.010 * Math.sin(Math.PI * 2 * (t * 3.1 + noise(t * 0.7 + 31.0) * 4));
      const sway2 = 0.010 * Math.sin(Math.PI * 2 * (t * 2.6 + noise(t * 0.9 + 63.0) * 4));
      flame.position.x = sway;
      flame.position.z = sway2;
      flame.scale.set(1, 0.80 + 0.34 * level, 1);
      halo.position.x = sway * 0.6;
      halo.position.z = sway2 * 0.6;
      light.position.set(sway * 0.5, M.flameY + 0.012 * (level - 0.9), sway2 * 0.5);

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

export default createStreetLamp;
