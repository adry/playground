import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SEGMENTS, toyMaterial } from '../style.js';

// A BRACKET LANTERN: a glazed iron lantern hung off a scrolled arm that bolts
// to something vertical. A gate pillar, a shed wall, a fence post.
//
// -----------------------------------------------------------------------------
// WHERE ITS ORIGIN IS, WHICH IS NOT WHERE ANY OTHER LANTERN'S IS
//
// Every other lantern in this set has its origin on the ground, at the middle
// of its footprint, and a caller drops it on the floor. This one does not touch
// the floor at all.
//
//   THE ORIGIN IS THE MOUNTING POINT ON THE WALL.
//   THE BACK PLATE'S FACE LIES IN THE PLANE z = 0 AND FACES +Z.
//   THE ARM REACHES OUT ALONG +Z AND THE LANTERN HANGS BELOW, AT NEGATIVE Y.
//
// The whole prop is mirror-symmetric about x = 0. So a caller puts the origin
// on the spot on the wall where the plate is to sit, yaws about Y until +Z is
// the wall's outward normal, and is done: nothing else needs measuring and
// there is no ground contact to line up.
//
//   group.position.set(1.0, 0.72, 0.040);   // the +Z face of a fence post
//   group.rotation.y = 0;                   // +Z is already the way it faces
//
// Reach and drop from that origin, published as BRACKET at the foot of the file
// so a layout never has to measure them off a render:
//
//   reach   0.330   to the hanging plane; 0.436 to the front of the eaves
//   drop    0.470   origin to the tip of the base finial
//   rise    0.156   origin to the top of the arm's arc
//   width   0.212   across the eaves, and 0.116 across the back plate
//
// The plate is 0.236 tall against 0.116 wide, a two to one upright, and it is
// that tall for a compositional reason rather than a structural one. The arm
// springs off it at +0.048 and the scroll at -0.080, and between them those two
// fat bars hide most of a plate that stops at 0.104: what was left read as the
// arm simply ending at the wall. At 0.118 the plate shows a clear margin above
// the arm and below the scroll, and it is the margin, not the plate, that says
// the thing is bolted on.
//
// Those are picked off the two things it is likely to be bolted to. A fence
// post (fence/metrics.js) is 0.86 tall and 0.155 square: mounted at 0.72 the
// plate's 0.236 height sits inside the post's top with a little to spare, the
// plate's 0.116 width leaves 20mm of post showing on each side, and
// the lantern's foot lands at 0.25, clear of the ground and clear of the top
// rail at 0.52. A shed wall (shed/metrics.js) has its eaves at 1.40 and its
// door head at 1.05: mounted at 1.22 the lantern hangs its flame at 0.89, just
// over the door, which is what a bracket lantern is for.
//
// The plate is BEDDED 9mm: its back face sits at z = -0.009, behind the origin
// plane, so it is let into whatever it is bolted to rather than laid on it. A
// fence post is 0.155 deep and a shed's cladding 0.042, so 9mm is safe on
// either. That bed is doing the job style.js's contactShadow does for a prop on
// the ground, and it is the reason there is no decal here: a soft dark patch on
// the wall would work on a shed's flat side, but on a 0.155 post it would hang
// 38mm out into thin air on each side, which is worse than the problem.
//
// -----------------------------------------------------------------------------
// THE SCROLL, WHICH IS THE TRAP
//
// A real bracket scroll is thin ribbon iron curled tight, three or four turns
// of something 4mm thick. Modelled honestly at this scale it is a wire: it
// aliases to nothing at the diorama's camera and it is the opposite of the
// house style, which has no thin parts anywhere.
//
// So the scroll here is ONE fat bar with ONE lazy curl of 0.95 of a turn,
// 52mm deep where it leaves the plate and tapering to 24mm at the rolled tip.
// Its outer radius is 58mm and its inner 18mm, which is a curl a finger could
// be put through, and at 0.95 of a turn the windings never touch: worked out on
// paper first, a second turn brings them within 2mm, and 2mm at this scale is
// not a gap, it is a smudge.
//
// The one other thing that scroll is doing is bracing. It springs from the
// bottom of the plate, winds forward and up, and its top meets the arm's
// underside at z = 0.104, so the triangle plate-arm-scroll is closed and the
// arm is not cantilevered off nothing. That is why there is one member here and
// not a brace plus an ornament: the brace IS the ornament, which is what a real
// bracket does too. It is also why the curl is set 80mm out from the plate face
// rather than tucked against it: the lead-in bar crossing that gap is what
// reads as the scroll SPRINGING from the plate, and with the curl pushed back
// against the plate the whole cluster came out as one blob.
//
// -----------------------------------------------------------------------------
// WHAT IS BORROWED
//
// The glass optics and the flicker are pillar.js's, with its reasoning, and the
// three findings it paid for are used rather than rediscovered: every pane
// carries an outward crown so its reflected ray SWEEPS the sky instead of
// returning one colour; the fake sky carries a narrow bright band for the crown
// to drag a streak out of, because the half vector between the key and this
// camera sits 46 degrees up and no vertical pane in this scene can satisfy a
// Blinn lobe; and the transmitted term has a floor of warm interior air under
// it, because a box glazed on four sides shows the pale backdrop straight
// through and the top of every pane reads as milk without one.
//
// The swept-bar builder is crook.js's idea with a different frame; see
// sweepPlanar for why the Frenet frames are not used.
//
// -----------------------------------------------------------------------------
// WHAT IT COSTS
//
// Four meshes, five draw calls, 24,400 triangles, measured off renderer.info
// rather than counted by hand. The four meshes are the bracket (plate, bolts,
// arm, eye and scroll merged), the lantern that hangs off it (bail, cage,
// reflector, cap and foot merged), the glazing and the flame. The fifth call is
// the glazing again: a double-sided transparent material is drawn back faces
// then front faces, which is what lets the far pane appear through the near one
// in the right order, and it is worth the call.
//
// ONE PointLight, and it does not cast shadows. There is no contact decal and
// no second light. See the note by the light itself.

// -----------------------------------------------------------------------------
// dimensions
//
// All of them measured from the origin, so a negative y is below the mounting
// point and a positive z is out from the wall.

// --- the back plate ---
const PLATE_HX = 0.058;      // half width, so the plate is 0.116 across
const PLATE_HY = 0.118;      // half height, 0.236 tall
const PLATE_BED = 0.009;     // how far the back face is let into the wall
const PLATE_T = 0.032;       // total thickness, so the face stands 23mm proud
// The plate's corner exponent. Same superellipse the whole set uses: 0 is a
// square, 1 is an ellipse. At 0.48 it is unmistakably a plate with corners on
// it, and the corners are a roll rather than a break.
const PLATE_P = 0.48;
const BOLT_R = 0.0115;
const BOLT_X = 0.031;
const BOLT_Y = 0.080;

// --- the arm ---
const REACH = 0.330;         // origin to the hanging plane
const ARM_RISE = 0.126;      // the crown of the arm's arc, above the origin
const EYE_Y = -0.055;        // centre of the eye the bail hangs in
const EYE_R = 0.030;         // its major radius
const EYE_TUBE = 0.0145;     // and the bar it is rolled from

// --- the lantern, hung below the eye ---
const CAP_APEX = -0.145;
const BOX_TOP = -0.235;      // which is also the eave line
const BOX_BOT = -0.420;
const BOX_H = BOX_TOP - BOX_BOT;      // 0.185
const BOX_R = 0.084;         // half extent over the frame
const CAP_R = 0.106;         // the eave, overhanging the box by 22mm
const CAP_H = CAP_APEX - BOX_TOP;     // 0.090, and CAP_APEX is ABOVE BOX_TOP
const BAR = 0.021;           // corner upright section
const RAIL_H = 0.023;        // the band top and bottom of each face
const PANE_Z = 0.076;        // glass sits inboard of the frame's outer face
const PANE_HW = 0.060;       // half width, between the two uprights
const PANE_BOW = 0.011;      // outward crown: see the glass note
const FOOT_BOT = -0.470;     // the tip of the base finial

const PANE_TOP = BOX_TOP - RAIL_H;
const PANE_BOT = BOX_BOT + RAIL_H;
const FLAME_AT = BOX_BOT + 0.034;     // the top of the burner cup
const LIGHT_AT = BOX_BOT + 0.090;

// The metal's corner exponent, tighter than the plate's. Folded and cut sheet
// keeps more of its arris than a cast plate does, and giving the two the same
// radius made the lantern look grown out of the bracket rather than hung on it.
const P_METAL = 0.22;

// -----------------------------------------------------------------------------
// materials

// pillar.js's iron exactly, because these two hang at the same gate.
//
// Metalness stays at zero. There is no environment map in this scene, and a
// MeshStandardMaterial with metalness above zero trades the diffuse the
// hemisphere light feeds for a specular only the two directionals can feed, so
// the ironwork goes nearly black on its shaded side the moment it is made
// metallic. A mid grey at low roughness reads as painted iron, which is what a
// cemetery lantern is.
const IRON = '#4a4640';
const IRON_ROUGH = 0.46;

// Old cylinder-drawn glazing: a DARK cool green, and dark is the point. A
// MeshStandardMaterial's diffuse does not know it is glass, so a pale tint gets
// lifted to milk by the hemisphere light and lays a veil over the lantern's
// inside. Glass has almost no diffuse: what you see is the reflection on it,
// what comes through it, and the dark behind it.
const GLASS_TINT = '#33443f';

// The flame's two ends, from pumpkin.js by way of pillar.js, so every fire in
// this scene is the same fire. The light's colour is converted by hand because
// it is a light; the emissive pair is handed to three, which manages it.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
const WICK_EMBER = new THREE.Color('#ff6a1e');
const WICK_FLAME = new THREE.Color('#ffb862');

// -----------------------------------------------------------------------------
// the fake optics
//
// pillar.js's, whole, with its uniforms retuned only where this lantern's panes
// are a different size. See the note at the top of this file for the three
// things it establishes; the comments below cover only what is decided here.

const GLASS_OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uGlare;
uniform vec2 uGlareAt;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uGlowCol;
uniform float uGlow;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
uniform float uWave;
uniform float uSeed;
varying vec2 vPane;
varying vec3 vGlassP;
varying float vYaw;

vec3 viewToWorld(vec3 v) {
  return vec3(dot(v, viewMatrix[0].xyz), dot(v, viewMatrix[1].xyz), dot(v, viewMatrix[2].xyz));
}

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands and one narrow bright one. The gradient alone is a fill: it has
// no shape, so nothing in it says surface. The bright band does, because the
// pane's crown sweeps its reflected ray across it and what comes out is a
// streak that bows the way the glass bows and pinches out at the two vertical
// edges where the crown flattens.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.55, -0.02, r.y));
  c = mix(c, uSkyHi, smoothstep(0.02, 0.62, r.y));
  return c + uGlare * exp(-pow((r.y - uGlareAt.x) / uGlareAt.y, 2.0));
}

// Schlick with glass's F0. Flat on at this camera's elevation that is four per
// cent and nothing else, which is why the crown and the cut edge carry the
// effect rather than the fresnel on its own.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}

float sunGlint(vec3 wN, vec3 wV, float sharp) {
  vec3 h = normalize(wV + uSunDir);
  return pow(max(dot(wN, h), 0.0), sharp);
}
`;

const GLASS_FRAG = `
  vec3 wN = normalize(viewToWorld(normal));
  vec3 wV = worldViewDir(vGlassP);
  // Double sided, so the far side of the box is seen through the near one.
  // Turn the shading normal to face the camera whichever surface this is.
  float back = gl_FrontFacing ? 0.0 : 1.0;
  if (dot(wN, wV) < 0.0) wN = -wN;

  // Waviness in the pane's own frame. The pane is a plane rotated about Y, so
  // its tangent frame is one cosine and one sine and needs no attribute beyond
  // the yaw it was built at. NOTE that the yaw is the pane's yaw within the
  // lantern and the lantern itself is hung under a group that sways, so this
  // frame is only approximate once the sway is running. It is a normal
  // perturbation of a couple of degrees; half a degree of sway does not show.
  vec3 tX = vec3(cos(vYaw), 0.0, -sin(vYaw));
  vec3 tY = vec3(0.0, 1.0, 0.0);
  // Broad, not fine. At high frequencies the ripple meets the glare band
  // edge-on and cuts it into a sunburst of hard rays, which reads as brushed
  // metal. Rolled glass waves over centimetres.
  float w1 = sin(vPane.y * 5.4 + vPane.x * 1.4 + uSeed);
  float w2 = sin(vPane.y * 11.1 - vPane.x * 2.2 + uSeed * 1.7);
  wN = normalize(wN + tX * (uWave * (0.55 * w1 + 0.45 * w2)) + tY * (uWave * 0.35 * w2));

  float ndv = clamp(dot(wN, wV), 0.0, 1.0);

  // The cut edge of the pane where the frame grips it: bright, thin, and
  // brighter on the two vertical edges, where the glass's thickness is turned
  // toward the light. At toy scale this is the most legible glass cue there is,
  // because it draws four bright borders no opaque panel would have.
  float ex = smoothstep(0.78, 1.0, abs(vPane.x));
  float ey = smoothstep(0.82, 1.0, abs(vPane.y));
  float edge = clamp(ex + 0.65 * ey, 0.0, 1.0);

  float F = clamp(fresnelGlass(ndv) * uRimGain + edge * 0.55, 0.0, 1.0);
  F *= mix(1.0, 0.30, back);

  vec3 refl = skyProbe(reflect(-wV, wN))
    + uSunCol * (uGlint * sunGlint(wN, wV, uShine))
    + mix(uSkyHi, uGlowCol, 0.40) * (edge * 0.55);

  // What the flame pushes out through the pane, centred low because the flame
  // sits in the bottom third of the box. The 0.30 floor is the warm interior
  // air: without it a ray through the near pane goes out through the far one
  // and finds the scene's pale backdrop.
  float d = length(vec2(vPane.x * 0.85, (vPane.y + 0.40) * 1.05));
  // The floor is the warm air the box is full of, and the falloff only says
  // where the flame is brightest. It is a touch lower than the pillar
  // lantern's, because here the reflector behind the glass is a REAL surface
  // lit by the real point light, and that carries most of what this term was
  // faking there.
  float lit = (0.32 + 0.72 * exp(-d * d * 3.20)) * mix(1.0, 1.55, back);

  vec3 body = outgoingLight + uGlowCol * (uGlow * lit);

  // Composited as an "over", so the alpha handed to the blender is the alpha
  // the glass really has and the reflection is not multiplied away by an
  // opacity slider. That mistake makes every highlight on a transparent surface
  // disappear exactly when the surface gets clearer.
  float A = uBodyA + 0.30 * edge;
  float a = clamp(A + F * (1.0 - A), 0.0, 1.0);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

// -----------------------------------------------------------------------------
// geometry helpers

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// The quarter round taken off an end, so a loft's top and bottom are eased
// rather than cut. d is the distance in from that end.
const fillet = (d, e) => (d >= e || e <= 0 ? 0 : e - Math.sqrt(Math.max(0, e * e - (e - d) * (e - d))));

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
}

// A superellipse ring point, the primitive every cross section in this file is
// made of: x = sign(cos a)|cos a|^p, and the ring closes as
// |x|^(2/p) + |z|^(2/p) = 1. p = 0 is a square, p = 1 is a circle.
const se = (a, p) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [Math.sign(c) * Math.pow(Math.abs(c), p), Math.sign(s) * Math.pow(Math.abs(s), p)];
};

// A lofted superellipse solid swept up Y, with its cross section given as a
// function of height. Rows are placed by ARC LENGTH along the profile rather
// than evenly in Y, which is what makes small fillets on long shapes
// affordable: the cap's 10mm drip lip gets a dozen rows and the 90mm of slope
// above it gets four, instead of the whole thing being sampled fine enough to
// draw the lip. Straight out of pillar.js.
//
// `at(y)` returns [halfX, halfZ, p].
function loftY({ y0, y1, at, rows = 40, ring = 32, capBottom = true, capTop = true, dense = 600 }) {
  const ys = new Float64Array(dense + 1);
  const rs = new Float64Array(dense + 1);
  for (let i = 0; i <= dense; i++) {
    const y = y0 + ((y1 - y0) * i) / dense;
    const [hx, hz] = at(y);
    ys[i] = y;
    rs[i] = Math.max(hx, hz);
  }
  const cum = new Float64Array(dense + 1);
  for (let i = 1; i <= dense; i++) cum[i] = cum[i - 1] + Math.hypot(ys[i] - ys[i - 1], rs[i] - rs[i - 1]);
  const total = cum[dense] || 1;

  const rowY = [];
  let k = 0;
  for (let i = 0; i <= rows; i++) {
    const want = (total * i) / rows;
    while (k < dense && cum[k + 1] < want) k++;
    const span = cum[k + 1] - cum[k];
    const f = span > 1e-12 ? (want - cum[k]) / span : 0;
    rowY.push(ys[k] + (ys[Math.min(k + 1, dense)] - ys[k]) * f);
  }
  rowY[0] = y0;
  rowY[rows] = y1;

  const verts = [];
  const index = [];
  for (let i = 0; i <= rows; i++) {
    const y = rowY[i];
    const [hx, hz, p] = at(y);
    for (let j = 0; j < ring; j++) {
      // The seam vertex is NOT duplicated: two coincident chains cannot average
      // their normals and leave a crease running the height of the piece.
      const [u, v] = se((j / ring) * Math.PI * 2, p);
      verts.push(u * hx, y, v * hz);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring;
      const a = i * ring + j, an = i * ring + jn;
      const b = (i + 1) * ring + j, bn = (i + 1) * ring + jn;
      index.push(a, b, an, b, bn, an);
    }
  }
  const cap = (row, flip) => {
    const base = row * ring;
    const centre = verts.length / 3;
    verts.push(0, rowY[row], 0);
    for (let j = 0; j < ring; j++) {
      const a = base + j, b = base + ((j + 1) % ring);
      if (flip) index.push(centre, a, b); else index.push(centre, b, a);
    }
  };
  if (capBottom) cap(0, true);
  if (capTop) cap(rows, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A rounded bar: a box with every edge eased, built as one loft up its own
// length so the corner rounding and the end rounding are one surface.
function bar({ length, w, d, p = P_METAL, ends = 0.005, rows = 12, ring = 20 }) {
  const e = Math.min(ends, length * 0.45);
  const at = (y) => {
    const cut = fillet(y, e) + fillet(length - y, e);
    return [Math.max(1e-4, w / 2 - cut), Math.max(1e-4, d / 2 - cut), p];
  };
  return loftY({ y0: 0, y1: length, at, rows, ring });
}

function placed(geo, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0 } = {}) {
  geo.applyMatrix4(new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
    .setPosition(x, y, z));
  return geo;
}

// A fat bar swept along a PLANAR curve, with a superellipse section that may
// taper along the length.
//
// TubeGeometry cannot taper and cannot change its section, so this is written
// out, and the frame is written out too rather than taken from
// computeFrenetFrames. Every curve in this file lies in one plane: the arm and
// the scroll in x = 0, the bail and the eye in z = REACH. For a planar curve
// the correct frame is known exactly, B is the plane's own normal and N is
// B x T, and it is constant-twist by construction. Frenet frames are
// parallel-transported from a seeded initial normal and, on a curve that is
// nearly straight at one end, that seed is chosen off the smallest tangent
// component and can come out rotated: the first version of the arm had its
// strap section standing on edge at the plate and lying flat at the eye, which
// is a bug that costs an hour to see and a line to avoid.
//
// `sectionOf(t)` returns [rN, rB, p]. rN is the in-plane half thickness, which
// for a strap of iron bent on edge is the tall one; rB is across the plane.
function sweepPlanar(curve, planeNormal, sectionOf, along, around, { closed = false, capStart = true, capEnd = true } = {}) {
  const B = planeNormal.clone().normalize();
  const verts = [];
  const index = [];
  const N = new THREE.Vector3();
  const pt = new THREE.Vector3();

  const rings = closed ? along : along + 1;
  for (let j = 0; j < rings; j++) {
    const t = j / along;
    const c = curve.getPoint(t);
    const T = curve.getTangent(t);
    N.crossVectors(B, T).normalize();
    const [rN, rB, p] = sectionOf(t);
    for (let i = 0; i < around; i++) {
      const [u, v] = se((i / around) * Math.PI * 2, p);
      pt.copy(c).addScaledVector(N, u * rN).addScaledVector(B, v * rB);
      verts.push(pt.x, pt.y, pt.z);
    }
  }
  const vi = (j, i) => (j % rings) * around + (i % around);
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      index.push(vi(j, i), vi(j, i + 1), vi(j + 1, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i));
    }
  }
  if (!closed) {
    const fan = (j, flip) => {
      const c = curve.getPoint(j / along);
      const centre = verts.length / 3;
      verts.push(c.x, c.y, c.z);
      for (let i = 0; i < around; i++) {
        if (flip) index.push(centre, vi(j, i + 1), vi(j, i));
        else index.push(centre, vi(j, i), vi(j, i + 1));
      }
    };
    if (capStart) fan(0, true);
    if (capEnd) fan(along, false);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Points in the x = 0 plane, given as [y, z].
const yz = (pts) => pts.map(([y, z]) => new THREE.Vector3(0, y, z));
// Points in the z = REACH plane, given as [x, y].
const xy = (pts, z) => pts.map(([x, y]) => new THREE.Vector3(x, y, z));

// -----------------------------------------------------------------------------
// the parts

// The back plate. A rounded slab standing in the wall's own plane, so it is
// lofted along its thickness and then swung so that thickness runs down +Z.
//
// Its face is chamfered on both edges, which matters more here than on a prop
// seen from the front: this plate is nearly always seen at a raking angle, and
// a chamfer is what turns its rim from a black outline into a lit bevel.
function plateGeometry() {
  const T = PLATE_T;
  const at = (t) => {
    // The back edge's chamfer is bigger than the front's. It is the one that
    // meets the wall, and a generous relief there is what stops the seam
    // reading as a printed line: the plate goes into the wall rather than
    // stopping against it.
    const cut = fillet(t, 0.010) + fillet(T - t, 0.006);
    return [Math.max(1e-4, PLATE_HX - cut), Math.max(1e-4, PLATE_HY - cut), PLATE_P];
  };
  // Lofted up +Y from 0 to T, then rotated so +Y becomes +Z and the section's
  // own y stands up. rotateX(+90) sends (x, t, s) to (x, -s, t).
  // SEGMENTS.radial less eight. The plate is the widest smooth silhouette on
  // the prop and the one thing here that is nearly a turned shape, so it takes
  // most of the set's standard ring; the ironwork below runs far coarser
  // because a 42mm bar seen at the diorama's camera is thirty pixels across.
  const g = loftY({ y0: 0, y1: T, at, rows: 26, ring: SEGMENTS.radial - 8 });
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  g.translate(0, 0, -PLATE_BED);

  const parts = [g];
  // Four domed bolt heads. Sunk 3mm into the face, so what stands proud is a
  // dome and not a ball resting on a plate.
  const face = PLATE_T - PLATE_BED;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const head = loftY({
        y0: -BOLT_R * 0.55,
        y1: BOLT_R * 0.78,
        at: (y) => {
          const s = Math.sqrt(Math.max(0, BOLT_R * BOLT_R - y * y)) * 0.92;
          return [Math.max(1e-4, s), Math.max(1e-4, s), 0.62];
        },
        rows: 10,
        ring: 18,
      });
      head.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      parts.push(placed(head, { x: sx * BOLT_X, y: sy * BOLT_Y, z: face - 0.003 }));
    }
  }
  return mergeGeometries(parts, false);
}

// The arm: up off the plate, over in a lazy arc and down to the eye.
//
// It is a STRAP, not a rod: 60mm deep in the plane it bends in and 42mm across.
// That is the shape a piece of bar iron takes when it is bent on edge, it is
// the only orientation that is stiff the way the silhouette says it should be,
// and it gives the key light a long flat to run down instead of a hot line
// along a cylinder.
//
// The section tapers to 38 by 32 at the eye. A parallel bar all the way looks
// extruded, and a bracket arm really does lighten toward its tip.
function armCurve(rand) {
  const rise = ARM_RISE + (rand() - 0.5) * 0.010;
  const reach = REACH;
  return new THREE.CatmullRomCurve3(yz([
    [0.048, -0.006],           // buried in the plate
    [0.078, 0.046],
    [0.106, 0.104],
    [rise - 0.002, 0.172],
    [rise, 0.238],
    [0.108, 0.292],
    [0.068, reach - 0.006],
    [0.010, reach],
    [EYE_Y + EYE_R, reach],    // arrives straight down onto the top of the eye
  ]), false, 'centripetal', 0.5);
}

function armGeometry(rand) {
  const curve = armCurve(rand);
  const section = (t) => {
    const k = smoothstep(0.15, 1.0, t);
    const rN = 0.030 - 0.011 * k;
    const rB = 0.021 - 0.005 * k;
    // Rolled off at the very tip so the bar does not stop on a flat disc where
    // it runs into the eye. The start is inside the plate and needs nothing.
    const e = fillet((1 - t) * 0.34, 0.010);
    return [Math.max(1e-4, rN - e), Math.max(1e-4, rB - e), 0.80];
  };
  return sweepPlanar(curve, new THREE.Vector3(1, 0, 0), section, 74, 18);
}

// The eye at the tip of the arm: a closed fat ring in the x = 0 plane, so its
// hole faces along X and the bail's apex, which runs along X, threads it.
// A 30mm ring rolled from a 29mm bar leaves a 15.5mm hole and the bail is
// 13.5mm, so there is 2mm of daylight round it: enough to read as a hole at the
// diorama's camera, which is the whole reason the eye is worth its triangles.
function eyeGeometry() {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, EYE_Y + EYE_R * Math.cos(a), REACH + EYE_R * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  return sweepPlanar(
    curve,
    new THREE.Vector3(1, 0, 0),
    () => [EYE_TUBE, EYE_TUBE * 0.86, 0.9],
    40,
    14,
    { closed: true },
  );
}

// The scroll. See the note at the top of the file: one fat bar, one lazy curl,
// and it braces the arm as well as decorating it.
function scrollGeometry(rand) {
  const cy = 0.022, cz = 0.104;
  const r0 = 0.058, r1 = 0.018;
  const turns = 0.95 + (rand() - 0.5) * 0.06;
  const phiMax = turns * Math.PI * 2;

  // The lead-in, from the bottom of the plate up to where the curl starts. It
  // is a separate few points rather than part of the spiral because a spiral
  // that starts at the plate has to start at its widest, and its widest has to
  // be out where the arm is: the curl would end up hanging in front of the
  // plate instead of in the pocket under the arm.
  const pts = yz([
    [-0.080, 0.004],
    [-0.072, 0.048],
    [-0.056, 0.082],
  ]);
  const N = 46;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const phi = f * phiMax;
    // The radius eases in rather than falling linearly, so the first half turn
    // stays open and the tightening happens where the curl is tucked away. A
    // linear taper made the outside of the curl look dented.
    const r = r0 + (r1 - r0) * (f * f * (3 - 2 * f));
    pts.push(new THREE.Vector3(0, cy - r * Math.cos(phi), cz + r * Math.sin(phi)));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const section = (t) => {
    // Thick where it leaves the plate, thin at the rolled tip. Wrought iron
    // drawn out into a scroll really does thin as it winds.
    const k = t * t * (3 - 2 * t);
    const rN = 0.026 - 0.014 * k;
    const rB = 0.019 - 0.009 * k;
    const e = fillet((1 - t) * 0.30, 0.009);
    return [Math.max(1e-4, rN - e), Math.max(1e-4, rB - e), 0.82];
  };
  return sweepPlanar(curve, new THREE.Vector3(1, 0, 0), section, 96, 16);
}

// The bail the lantern hangs by: an arch in the z = REACH plane, from one
// shoulder of the cap, up through the eye, and down to the other. Its apex runs
// along X exactly where the eye's hole is, which is how a real lantern hangs
// and is the reason the eye is in the x = 0 plane and this is not.
//
// Built in the hanging group's own frame, so its ends move with the lantern and
// its apex stays put in the eye when the thing sways.
function bailGeometry() {
  const curve = new THREE.CatmullRomCurve3(xy([
    [-0.046, -0.194],
    [-0.047, -0.140],
    [-0.043, -0.098],
    [-0.030, -0.068],
    [-0.014, -0.0565],
    [0.000, -0.055],
    [0.014, -0.0565],
    [0.030, -0.068],
    [0.043, -0.098],
    [0.047, -0.140],
    [0.046, -0.194],
  ], REACH), false, 'centripetal', 0.5);
  return sweepPlanar(
    curve,
    new THREE.Vector3(0, 0, 1),
    () => [0.0135, 0.0115, 0.85],
    56,
    14,
  );
}

// The cage: four corner uprights, a rail band top and bottom on each face, the
// floor the candle stands on and the burner it stands in. Merged, because they
// are one welded frame and because thirteen draw calls for a lantern is absurd.
function cageGeometry() {
  const parts = [];
  const c = BOX_R - BAR / 2;

  for (let k = 0; k < 4; k++) {
    const sx = k & 1 ? 1 : -1;
    const sz = k & 2 ? 1 : -1;
    parts.push(placed(
      bar({ length: BOX_H, w: BAR, d: BAR, ends: 0.004, rows: 12, ring: 20 }),
      { x: sx * c, z: REACH + sz * c, y: BOX_BOT },
    ));
  }

  // Rails. Each spans the full face and dies inside the uprights at both ends,
  // so no join is ever visible.
  const railLen = BOX_R * 2;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    for (const h of [BOX_BOT + RAIL_H / 2, BOX_TOP - RAIL_H / 2]) {
      const b = bar({ length: railLen, w: RAIL_H, d: BAR * 0.85, ends: 0.003, rows: 7, ring: 16 });
      b.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -railLen / 2, 0));
      b.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      parts.push(placed(b, {
        ry: a,
        x: Math.sin(a) * (BOX_R - BAR * 0.45),
        z: REACH + Math.cos(a) * (BOX_R - BAR * 0.45),
        y: h,
      }));
    }
  }

  // The REFLECTOR: the wall-facing face, sheet iron rather than glass. See the
  // note on glassGeometry for why. It is flush with the corner uprights' outer
  // face and it laps 7mm into each of them, so no seam of daylight can open at
  // the two back corners, which is the one way this could have gone wrong.
  //
  // It is a rounded slab and not a plane: a plane has no thickness to catch the
  // key at its edges and, more to the point, the flame is 80mm off it and a
  // point light on a flat plane draws a hard elliptical hot spot. The 14mm of
  // roll on its rim breaks that into something with a shape.
  const back = bar({
    length: BOX_H - 0.004,
    w: 2 * (BOX_R - BAR * 0.33),
    d: 0.014,
    p: 0.30,
    ends: 0.006,
    rows: 10,
    ring: 22,
  });
  parts.push(placed(back, { y: BOX_BOT + 0.002, z: REACH - (BOX_R - 0.007) }));

  // The floor, which is also what stops you seeing down through the box.
  parts.push(placed(loftY({
    y0: BOX_BOT + 0.004,
    y1: BOX_BOT + 0.016,
    at: (y) => {
      const h = y - (BOX_BOT + 0.004);
      const r = 0.072 - fillet(h, 0.004) - fillet(0.012 - h, 0.004);
      return [r, r, P_METAL];
    },
    rows: 6,
    ring: 26,
  }), { z: REACH }));

  // The burner. A flame floating a centimetre off a flat plate reads as a bug,
  // and a wax candle would cost a second material for something 40mm across
  // seen through glass. A turned iron burner cup is the same iron as everything
  // else in this merge, so it is free.
  parts.push(placed(loftY({
    y0: BOX_BOT + 0.014,
    y1: BOX_BOT + 0.034,
    at: (y) => {
      const h = y - (BOX_BOT + 0.014);
      const r = 0.021 - 0.006 * smoothstep(0.004, 0.020, h) - fillet(0.020 - h, 0.005);
      return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
    },
    rows: 10,
    ring: 18,
  }), { z: REACH }));

  return mergeGeometries(parts, false);
}

// The pyramidal cap, and the collar on top of it the bail's legs are welded
// into. Straight-sided pyramids read as origami, so the slope carries a small
// outward bulge and the eave carries a drip lip: both are what a piece of
// folded and soldered sheet does, and both give the key light somewhere to run
// along, which a flat facet does not.
function capGeometry() {
  const TIP = 0.026;
  const at = (y) => {
    const t = clamp01((y - BOX_TOP) / CAP_H);
    let r = (CAP_R - TIP) * (1 - t) + TIP + 0.085 * CAP_R * Math.sin(Math.PI * t);
    // The drip lip: the eave stands a hair proud of the slope above it, which
    // gives the key a line to run along at the widest part of the lantern.
    r += 0.009 * (1 - smoothstep(0.0, 0.13, t));
    r -= fillet(y - BOX_TOP, 0.009);
    r -= fillet(BOX_TOP + CAP_H - y, TIP);
    return [Math.max(1e-4, r), Math.max(1e-4, r), P_METAL];
  };
  // Stopped 2mm short of the apex: the last ring would be a degenerate fan and
  // computeVertexNormals cannot normalise a zero-area triangle. The collar is
  // wider than the ring left behind and swallows it.
  const parts = [loftY({ y0: BOX_TOP, y1: BOX_TOP + CAP_H - 0.002, at, rows: 30, ring: SEGMENTS.radial - 16 })];

  // The collar. Round in section, not square: it is the one turned part up
  // here, and turning it is what makes the pressed cap below read as pressed.
  parts.push(loftY({
    y0: CAP_APEX - 0.014,
    y1: CAP_APEX + 0.018,
    at: (y) => {
      const h = y - (CAP_APEX - 0.014);
      const r = 0.026 - 0.008 * smoothstep(0.004, 0.030, h) - fillet(h, 0.006) - fillet(0.032 - h, 0.007);
      return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
    },
    rows: 14,
    ring: 20,
  }));
  return placed(mergeGeometries(parts, false), { z: REACH });
}

// The base: a stepped foot under the box and a drop finial under that. The
// finial is the piece that stops the lantern reading as a box with its bottom
// sawn off, and on a HANGING lantern it does more than on a standing one,
// because the underside is the face a viewer standing below actually sees.
function footGeometry() {
  const y0 = FOOT_BOT;
  const y1 = BOX_BOT + 0.006;
  const at = (y) => {
    const h = y - y0;                    // 0 at the tip of the finial
    const H = y1 - y0;                   // 0.056, the whole foot
    // A ball at the bottom, swelling into a plate at the top.
    const ballC = 0.020;
    const ballR = 0.020;
    const dy = h - ballC;
    const ball = Math.sqrt(Math.max(0, ballR * ballR - dy * dy));
    const neck = 0.014 + 0.076 * smoothstep(0.028, H - 0.004, h);
    let r = Math.max(ball, neck);
    r -= fillet(H - h, 0.006);
    return [Math.max(1e-4, r), Math.max(1e-4, r), h > 0.046 ? P_METAL : 1.0];
  };
  return placed(loftY({ y0, y1, at, rows: 34, ring: 28 }), { z: REACH });
}

// THREE bowed panes, not four, and this is the one place where being a wall
// lantern changes the model rather than only its origin.
//
// A lantern glazed on four sides has nothing behind its far pane but whatever
// the world puts there, and pillar.js found what that costs: the pale backdrop
// comes straight through and the top half of every pane reads as milk. Standing
// on a pillar that is mostly sky, and a warm floor under the transmitted term
// covers it. This one hangs at chest height off a post or a shed side, so what
// is behind it is a big pale sunlit object 200mm away filling the entire
// background, and no floor under the transmitted term was enough: at the
// strength that made the box read as lit, the glass had stopped being glass.
//
// The honest answer is that a real bracket lantern is not glazed on the wall
// side. There is nothing back there to light, so that face is sheet iron and it
// works as a reflector. So: three panes, and the fourth face is the plate built
// in cageGeometry. It costs nothing, it removes the failure instead of
// covering it, and it pays twice over, because the one PointLight in the box is
// 80mm off that plate and lights it to a warm glow that every pane then has
// behind it.
//
// `aPane` is -1..1 across each one and `aYaw` is the face it was built on,
// which together are the whole coordinate system the glass shader works in.
function glassGeometry() {
  const hh = (PANE_TOP - PANE_BOT) / 2;
  const mid = (PANE_TOP + PANE_BOT) / 2;
  const NU = 10, NV = 14;

  const pos = [], pane = [], yaw = [], index = [];
  // k = 2 is the face whose normal is -Z, the one turned to the wall. It is the
  // reflector, not glass.
  for (const k of [0, 1, 3]) {
    const a = (k * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * 2 - 1;
      for (let i = 0; i <= NU; i++) {
        const u = (i / NU) * 2 - 1;
        // Crown, zero at every edge so the pane meets its frame flush.
        const bow = PANE_BOW * Math.cos((u * Math.PI) / 2) * Math.cos((v * Math.PI) / 2);
        const lx = u * PANE_HW;
        const lz = PANE_Z + bow;
        pos.push(lx * ca + lz * sa, mid + v * hh, REACH + (-lx * sa + lz * ca));
        pane.push(u, v);
        yaw.push(a);
      }
    }
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const p0 = base + j * (NU + 1) + i;
        const p1 = p0 + 1, p2 = p0 + (NU + 1), p3 = p2 + 1;
        index.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPane', new THREE.Float32BufferAttribute(pane, 2));
  g.setAttribute('aYaw', new THREE.Float32BufferAttribute(yaw, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The flame: a teardrop, round in section, standing on the burner. It is a real
// object rather than a painted sprite for the reason pumpkin.js gives, and the
// reason is sharper inside a glazed box: modulating brightness in place only
// pumps the pool, where MOVING the source swings the light around inside the
// box and changes which pane is lit.
function flameGeometry() {
  const H = 0.070;
  const R = 0.018;
  const KNEE = 0.26;
  const at = (y) => {
    const t = clamp01(y / H);
    // Round underneath, then drawn out to a tip. Two multiplied sines give a
    // lemon: fat in the middle and pointed at both ends, which is a leaf. A
    // flame is heaviest low down.
    const base = t < KNEE ? Math.sqrt(Math.max(0, 1 - ((KNEE - t) / KNEE) ** 2)) : 1;
    const tip = Math.pow(Math.max(0, 1 - t) / (1 - KNEE), 0.55);
    const r = R * (t < KNEE ? base : tip);
    return [Math.max(1e-4, r), Math.max(1e-4, r), 1.0];
  };
  return loftY({ y0: 0, y1: H, at, rows: 18, ring: 14 });
}

// -----------------------------------------------------------------------------
// smooth 1D value noise, and the warning that comes with it
//
// Layered, this gives the light its slow wander and its rare events. What it
// CANNOT give is the fine tremble: smoothstep interpolation has zero derivative
// at every lattice node, so a channel running at f Hz stands perfectly still f
// times a second, and summing three of them gives three sets of stalls that
// occasionally line up. Measured on pumpkin.js, a summed-noise flicker had 30%
// of its frames within 0.002 of the frame before. See update() for what carries
// the tremble instead.
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

// What the lamp, the glass and the flame body look like at the bottom and top
// of the swing. All three come off one number, which is what makes the light on
// the wall and the light in the box read as the same fire.
//
// The ratio is 2.15:1, the pumpkin's and the pillar's, so the fires in this
// scene do not flicker at two different depths. The absolute level is a
// stylistic call: against a hemisphere at 1.15 and a key at 2.1 a truthful
// candle is invisible.
//
// The lamp is a little dimmer than the pillar's, and that is not timidity. A
// bracket lantern hangs a hand's breadth off a wall, so its nearest lit surface
// is 0.15 away rather than the pillar's 0.19, and the same intensity put a
// white hole on the post it was bolted to.
const LAMP = { min: 0.315, max: 0.685 };
const GLASS_GLOW = { min: 0.360, max: 0.95 };
// The flame body's own brightness, and it is nearly twice the pillar
// lantern's. Not a style choice: the flame is seen AGAINST something here,
// and that something is sunlit timber sitting at a linear luminance around
// 1.6. At the pillar's levels the flame was DARKER than its own background
// and read as a smudge on the glass rather than as a fire.
const WICK = { min: 0.88, max: 1.85 };
const HUE_MID = 0.88, HUE_GAIN = 1.5;

// -----------------------------------------------------------------------------

export function createBracketLantern({ seed = 1, scale = 1 } = {}) {
  const rand = rng(seed);
  const noise = makeNoise(seed);

  // ORIGIN: the mounting point on the wall. The back plate's face is in the
  // z = 0 plane and faces +Z; the arm reaches out along +Z and the lantern
  // hangs below, at negative y. Nothing here touches the ground.
  const group = new THREE.Group();

  // The bracket proper: everything rigidly fixed to the wall.
  const fixedGeo = mergeGeometries([
    plateGeometry(),
    armGeometry(rand),
    eyeGeometry(),
    scrollGeometry(rand),
  ], false);

  // The lantern, which hangs. Its own group pivots at the eye's centre so a
  // sway rotates it about the point it is really hung from, and the bail's apex
  // stays inside the eye while it does. Everything below is authored in world
  // coordinates and then shifted back by the pivot, so the numbers at the top
  // of this file stay readable as heights below the mounting point rather than
  // as offsets from a pivot nobody can picture.
  const hang = new THREE.Group();
  hang.position.set(0, EYE_Y, REACH);
  const PIVOT = new THREE.Matrix4().makeTranslation(0, -EYE_Y, -REACH);

  const hungGeo = mergeGeometries([
    bailGeometry(),
    cageGeometry(),
    capGeometry(),
    footGeometry(),
  ], false);
  hungGeo.applyMatrix4(PIVOT);

  const ironMat = toyMaterial(IRON, { roughness: IRON_ROUGH, metalness: 0.0 });
  const fixed = new THREE.Mesh(fixedGeo, ironMat);
  const hung = new THREE.Mesh(hungGeo, ironMat);
  for (const m of [fixed, hung]) { m.castShadow = true; m.receiveShadow = true; }

  // --- glass ---------------------------------------------------------------
  const glassGeo = glassGeometry();
  glassGeo.applyMatrix4(PIVOT);
  const glassUniforms = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e. Linear, because
    // this composites before tone mapping.
    uSkyHi: { value: new THREE.Color('#dbe3f3').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c6cedc').convertSRGBToLinear() },
    // The LOW band is not the floor's colour. A pane is vertical and this
    // camera is 29 degrees up, so the reflected ray leaves 29 degrees DOWN, and
    // for THIS lantern what is 29 degrees down is nothing at all: it hangs off
    // a wall with clear air under it, so the ray reaches the ground eventually
    // and finds it dim and far off. A touch darker than the pillar's, whose
    // reflection lands on its own pale cornice a hand's breadth below.
    uSkyLo: { value: new THREE.Color('#8f9498').convertSRGBToLinear() },
    // Amplitude, then where the band sits and how wide it is, in the reflected
    // ray's own y. Any wider and it is a gradient again.
    //
    // Both are well under the pillar lantern's 4.00 and 0.060, and the two
    // renders that settled it are worth naming, because this term is the one
    // most likely to be copied on faith. Killed outright, the box reads as a
    // warm lit lantern and the panes read as holes: no surface, exactly the
    // failure the band exists to prevent. At the pillar's values it laid a pale
    // wash over the upper half of every pane and the box went cold, and the
    // three passes before this one all misread that wash as the backdrop
    // showing through and went hunting in uBodyA, which is not where it was.
    // The difference between the two lanterns is what is BEHIND the glass: a
    // pillar lantern has sky back there and a reflection can be the brightest
    // thing on the pane without hurting anything, where this one has a warm
    // interior that has to win. So the band stays, at 1.55 and 40mm of spread,
    // where it is a streak with an edge on it and not a fill.
    uGlare: { value: new THREE.Color('#f2f6ff').convertSRGBToLinear().multiplyScalar(1.55) },
    uGlareAt: { value: new THREE.Vector2(-0.245, 0.040) },
    // Between the key in main.js and the one in the preview harness.
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    uGlowCol: { value: new THREE.Color(PALETTE.glow).convertSRGBToLinear() },
    uGlow: { value: 0.2 },
    // Physically 1.0. It is over one because the fake sky is a flat gradient
    // with no bright spots of its own to find, so a correct fresnel over it
    // returns a correct amount of nothing. Lower than the pillar's 3.40 for the
    // same reason the glare band is: this lantern's job is to look lit from
    // inside, and every point of rim gain is pale sky laid over that.
    uRimGain: { value: 2.30 },
    uGlint: { value: 1.70 },
    uShine: { value: 95.0 },
    // How much of the pane is glass and how much is air. Low: the flame and the
    // far frame have to be seen through it.
    uBodyA: { value: 0.420 },
    uWave: { value: 0.048 },
    uSeed: { value: rand() * 6.283 },
  };

  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS_TINT),
    // Not mirror smooth. A 0.07 lobe is so tight it misses the key at most of
    // the angles this prop is seen from, and a pane with no highlight on it is
    // the flat rectangle this whole section exists to avoid.
    roughness: 0.15,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    // Four panes, all see-through. Writing depth would let whichever drew first
    // hide the three behind it.
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aPane;
attribute float aYaw;
varying vec2 vPane;
varying vec3 vGlassP;
varying float vYaw;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vPane = aPane;
  vYaw = aYaw;
  vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_OPTICS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Without this three hands the material a program it compiled for some other
  // MeshStandardMaterial with the same parameters and the patch above is
  // silently dropped.
  glassMat.customProgramCacheKey = () => 'bracket-lantern-glass';

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.castShadow = false;
  glass.receiveShadow = false;
  glass.renderOrder = 2;

  // --- flame ---------------------------------------------------------------
  const flameGeo = flameGeometry();
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: WICK_FLAME.clone(),
    emissiveIntensity: 1.6,
    roughness: 1.0,
    metalness: 0.0,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, FLAME_AT - EYE_Y, 0);
  flame.castShadow = false;
  flame.receiveShadow = false;
  flame.renderOrder = 1;
  const flameHome = flame.position.clone();

  // --- the one light -------------------------------------------------------
  // ONE PointLight, and it does not cast shadows. Six pumpkins and the rest of
  // the lantern set already put point lights into every fragment shader's loop
  // in this scene, so a lantern that wants two is a lantern that does not ship.
  //
  // DECAY IS 1, NOT 2, and it is the one deliberately unphysical number here.
  // The wall this thing is bolted to is 0.33 away, the eaves it hangs under are
  // 0.15 away and the ground is a metre and a half down: a nine to one range,
  // which inverse square turns into eighty to one. There is no intensity that
  // survives that. At decay 1 the wall takes a warm wash, the cap's underside
  // is lit rather than blown, and there is still something on the ground.
  const light = new THREE.PointLight(FLAME.clone(), 0, 2.4 * scale, 1);
  light.position.set(0, LIGHT_AT - EYE_Y, 0);
  light.castShadow = false;
  const lightHome = light.position.clone();

  hang.add(hung, glass, flame, light);
  group.add(fixed, hang);

  // No contact patch. Every other prop in this set gets one because the
  // scene's one shadow-casting light comes in at an angle and leaves nothing
  // dark where the prop meets the floor; this one does not meet the floor, and
  // its equivalent, the seam where the plate meets the wall, is paid for in
  // geometry by PLATE_BED instead. See the note at the top of the file for why
  // a decal was tried and dropped.

  group.scale.setScalar(scale);

  const phase = rand() * 100;
  // A lantern hung on a bail never hangs quite square, and it never stops
  // moving either. Both are tiny on purpose: the sway is half a degree, which
  // is a thing you notice only because the highlight on the cap creeps, and a
  // bracket lantern in still air does no more than that. Past about two degrees
  // it stops reading as hanging and starts reading as a physics bug.
  const tilt0 = (rand() - 0.5) * 0.010;
  const SWAY = 0.0085;

  return {
    group,
    update(time) {
      // A candle is mostly steady and it is never still. Four things run at
      // once and the light only reads as flame when all four do: a fine tremble
      // that never stops, a slower wander breathing under it, the rare event (a
      // gutter that ducks hard, a flare as the flame straightens), and the
      // flame physically moving while it does the rest.
      const t = time + phase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;

      // TREMBLE. Not summed noise: see makeNoise above for why that stalls. Two
      // sine carriers whose PHASE is dragged about by slow noise. A flame's
      // flutter has a frequency; what wanders is where in the cycle it has got
      // to, not whether it is happening at all. Both carriers sit inside the
      // 5..15Hz band a real candle flickers in: at 60fps a 20Hz carrier is
      // three frames to a period and comes out as sparkle, not as tremble.
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.031 * wobble(7.4, 0.58, 12.4) + 0.019 * wobble(12.9, 0.88, 55.1);

      // WANDER. The slow breathing underneath. Summed noise is right here and
      // its stalls are a feature: a lull is what the slow channel is for, and
      // the tremble is still running through it.
      const wander = 0.044 * swing(0.79, 0) + 0.031 * swing(2.1, 17.5);

      // GUTTER. Only the top of a slow channel counts, so these are separate
      // things that happen rather than a rhythm; squaring the ramp keeps the
      // deep part brief while the onset and recovery stay soft. Its depth
      // wobbles on a fast channel of its own, because a flame short of air does
      // not duck smoothly. This flame is behind four panes AND tucked against a
      // wall out of the draught, so it is the best sheltered in the set.
      const g = noise(t * 0.41 + 77.3);
      const gutter = g > 0.74 ? (g - 0.74) / 0.26 : 0;
      const dip = gutter * gutter * (0.34 + 0.24 * noise(t * 9.1 + 5.1));

      // FLARE, the gutter's other half, and rarer, because a flame droops far
      // more often than it draws itself up.
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.81 ? (fl - 0.81) / 0.19 : 0;
      const flare = flareRamp * flareRamp * (0.10 + 0.07 * noise(t * 7.1 + 91.2));

      // A SOFT CEILING and not a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the maximum and sit there, which pins
      // the glass at its brightest: the one state in which the transmitted glow
      // stops separating the four panes and the box goes white. This bends the
      // top over instead, matching value and slope at the knee and asymptoting
      // above it, so a flare comes out as a peak with a shape on it.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      // Measured over ten simulated minutes at 60fps, seed 1, against the
      // pumpkin's published figures for the same technique:
      //
      //                          this      pumpkin   pumpkin, stalling version
      //   mean level             0.882     0.876     0.877
      //   spread (sd)            0.069     0.084     0.080
      //   1st percentile         0.574     0.50      0.53
      //   99th / max             0.97/0.99 0.97/0.99 0.98/1.00
      //   mean step per frame    0.0171    0.0182    0.0047
      //   frames within 0.002    9.1%      9.0%      30.2%
      //
      // The last row is the one that matters and is why the tremble above is
      // two carriers and not three noise channels. Seeds 2 and 7 measure 9.0%
      // and 8.8% on the same run, so it is the technique and not one lucky
      // stream. As events, counted with a 0.05 re-arm so the tremble is not
      // miscounted: a duck below 0.80 every 5.4 seconds, below 0.70 every 12,
      // a real gutter past 0.50 every 40, past 0.40 every 600, and a flare over
      // 0.96 every 11. Shallower at the bottom end than an open pumpkin,
      // because this flame is behind glass AND tucked against a wall.
      const at = (r) => r.min + (r.max - r.min) * level;
      light.intensity = at(LAMP) * scale;
      glassUniforms.uGlow.value = at(GLASS_GLOW);
      flameMat.emissiveIntensity = at(WICK);

      // A guttering flame reddens as it drops and a flaring one goes whiter, so
      // the colour rides the same value. Levered about the level's own mean
      // rather than fed the level straight: the level spends its life in the
      // top eighth of its range, so fed straight through, the mix would only
      // travel the top quarter of ember..flame and a gutter would never reach
      // ember at all.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      light.color.copy(EMBER).lerp(FLAME, hue);
      glassUniforms.uGlowCol.value.copy(light.color);
      flameMat.emissive.copy(WICK_EMBER).lerp(WICK_FLAME, hue);

      // The flame is an object and it moves, which is the half of the effect
      // modulating intensity cannot reach. Inside a glazed box the payoff is
      // specific: the source sliding 13mm off centre is a fifth of the box's
      // half width, so the transmitted glow slides visibly from one pane to the
      // next and the four panes stop glowing in unison. Half slow noise and
      // half a carrier of its own, so the tip whips at about the rate the
      // brightness trembles at rather than drifting smoothly underneath it.
      const ax = 0.013 * (0.55 * swing(0.81, 5.5) + 0.45 * wobble(5.7, 0.5, 71.6));
      const az = 0.013 * (0.55 * swing(0.67, 31.2) + 0.45 * wobble(6.3, 0.5, 24.9));
      const rise = 0.009 * swing(1.3, 8.1) + 0.026 * flare - 0.022 * dip;

      light.position.set(lightHome.x + ax, lightHome.y + rise, lightHome.z + az);
      flame.position.set(flameHome.x + ax * 0.75, flameHome.y + rise * 0.5, flameHome.z + az * 0.75);
      // The flame leans the way it is being pushed, which stops the teardrop
      // reading as a bead sliding about on a wire.
      flame.rotation.z = -ax * 5.5;
      flame.rotation.x = az * 5.5;
      flame.scale.set(1, 1 + 0.22 * (level - 0.9) * 3.0, 1);

      // The sway. Two slow channels at incommensurable rates so it never comes
      // back to the same place, and it is NOT driven off the flicker: a lantern
      // that rocks in time with its own flame reads as one mechanism, and the
      // point of the sway is that the air outside the glass and the flame
      // inside it are two different things.
      hang.rotation.z = tilt0 + SWAY * swing(0.13, 61.0);
      hang.rotation.x = SWAY * 0.7 * swing(0.11, 8.7);
    },
    dispose() {
      for (const g of [fixedGeo, hungGeo, glassGeo, flameGeo]) g.dispose();
      for (const m of [ironMat, glassMat, flameMat]) m.dispose();
      group.clear();
    },
  };
}

// Published so a layout can bolt one to a post or a wall without measuring
// anything off a render. Everything is relative to the mounting point, which is
// the group's origin; the plate's face is the plane z = 0 and it looks down +Z.
export const BRACKET = {
  // Origin to the hanging plane, and to the front of the eaves.
  reach: REACH,
  reachOverall: REACH + CAP_R,
  // Origin to the tip of the base finial, and to the top of the arm's arc.
  drop: -FOOT_BOT,
  rise: ARM_RISE + 0.030,
  // Across the eaves, and across the back plate.
  width: CAP_R * 2,
  plate: { width: PLATE_HX * 2, height: PLATE_HY * 2, bed: PLATE_BED },
  // Where the fire is, in case a layout wants to know what it is lighting.
  lightAt: { y: LIGHT_AT, z: REACH },
};

export default createBracketLantern;
