import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, toyMaterial, SEGMENTS, contactShadow } from '../style.js';
import { createSwing } from '../fence/swing.js';

// A lantern hanging from a shepherd's crook.
//
// A slim iron post with a soft domed foot, curving over at the top into a hook,
// with a glazed lantern hanging off the nose on a ring. The post's crown sits
// at y = 1.36 and the lantern's body hangs between y = 0.68 and y = 0.99, so
// the thing reads at chest height: above the lanterns that sit on the ground
// and well under the street lamp.
//
// THE POINT OF THIS PROP IS THAT IT MOVES. Everything else in this set is
// nailed down. A hanging lantern is the one object in the graveyard with a
// degree of freedom, and a couple of degrees of sway with a light that goes
// with it is worth more than any amount of detail cut into the ironwork. So
// the three things this file spends its effort on are the swing, the flame and
// the glass, in that order, and the model exists to hang them on.
//
// WHAT IT REUSES, AND WHAT IT DOES NOT.
//
//   fence/swing.js does the pendulum, in `stop: 'none'` mode, and it fits with
//   nothing to add: a lantern on a ring is exactly the double-acting case that
//   mode was written for, a leaf free through its whole arc with damping as the
//   only loss. Its sin() restoring torque, its semi-implicit substepping and
//   its dry-friction floor are all things this file would otherwise have had to
//   get wrong once first. Two of them are used, one per horizontal axis, and
//   the couple of things they do not give are named where they are worked
//   around: see the notes on TWO AXES and on WIND below. Nothing about the
//   collision half of that file is used here, because a hanging lantern has
//   nothing to strike; `block()` is never called and `latchAngle` is left at 0.
//
//   The flicker is the pumpkin's, rebuilt rather than imported, because the
//   pumpkin's noise and carriers are module-local to that file. The two lessons
//   it paid for are carried over verbatim in shape: summed smoothstep noise
//   stalls, so the tremble is two sine carriers whose PHASE is dragged by slow
//   noise; and a hard clamp pins every flare flat, so the top of the range is a
//   soft knee that matches value and slope and asymptotes above it.
//
//   The glass borrows the fountain's answer to having no environment map: a
//   three-band procedural sky sampled off the reflected normal, a Schlick
//   fresnel deciding how much of it you see, and one Blinn lobe for the key
//   light, composited over the pane's own transparency in `opaque_fragment`.
//   The sky bands are the same values water.js uses, so the two props reflect
//   the same imaginary world.
//
// THE BUDGET. One PointLight, no shadow. It is parented inside the swinging
// assembly, so it travels with the lantern rather than sitting under it: a
// shape sliding about beneath a fixed pool of light is a worse read than no
// swing at all, because the eye takes the pool as the object and the lantern as
// a reflection of it.

// ---------------------------------------------------------------------------
// palette
//
// PALETTE has no iron in it, because nothing in the set had any until now.
// These are deliberately not black: a soft vinyl toy's "iron" is a dark warm
// grey that still takes the key light on its top surfaces, and true black would
// make the post a silhouette line rather than a bar with a shape.
const IRON = '#4b4f59';
const IRON_DARK = '#3f434d';   // roof and base, a shade down so the cage reads against it
const GLASS = '#cdd7dd';
const WAX = '#e8e0cc';

// The flame's two ends, converted by hand because they are a light's colour.
// Same pair the pumpkin uses, for the obvious reason: it has to be the same
// fire.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// The same two ends for the flame blob's emissive, warmer, because three colour
// manages a material's emissive on the way in and ACES desaturates as it
// brightens.
const BLOB_EMBER = new THREE.Color('#ff7b2c');
const BLOB_FLAME = new THREE.Color('#ffc271');

// Where the lamp, the blob and the pane's inner glow sit at the bottom and the
// top of the flicker. All three ride one value, which is the whole reason the
// light and the glass read as the same flame rather than as two effects.
// 2.15:1, the ratio the pumpkin's flicker was tuned to.
const LAMP = { min: 0.54, max: 1.16 };    // PointLight intensity
const BLOB = { min: 1.05, max: 2.30 };    // flame blob brightness
const INNER = { min: 0.34, max: 0.98 };   // flame washing the inside of the pane
// The level spends its life in the top eighth of its range, so the colour mix
// is levered about the level's measured mean rather than taken off it straight:
// fed through raw, ember is only reachable in a gutter deep enough to have put
// the flame out.
const HUE_MID = 0.88, HUE_GAIN = 1.5;

// ---------------------------------------------------------------------------
// geometry constants, all in units, all at scale 1
//
// The one number to read first: BAR. A real shepherd's crook is a rod, about a
// centimetre through, and at this height that is a hairline. The house style is
// a soft vinyl toy and this is the thinnest thing in the set, so the post is
// four centimetres through at the foot and three at the nose: a fat soft bar
// that still reads as a curve, and thick enough that the key light puts a broad
// roll of shading down one side of it rather than a single bright edge.
const BAR_FOOT = 0.040;   // shaft radius where it leaves the foot
const BAR_NOSE = 0.030;   // shaft radius at the hook's tip

const POST_TOP = 1.185;   // where the straight shaft stops and the hook starts
const HOOK_R = 0.175;     // the hook's radius, so the crown lands at 1.360
const HOOK_END = -18;     // degrees past the horizontal that the nose curls to

const FOOT_R = 0.112;     // the domed foot, and the prop's whole footprint

// The lantern, measured down from the hanging point.
const RING_R = 0.042;     // the ring threaded over the nose
const BAIL_R = 0.070;     // the hoop on the lantern's roof
const GLASS_H = 0.170;
const GLASS_R = 0.070;    // at the waist; it barrels out a little in the middle
const ROOF_H = 0.086;
const BASE_H = 0.056;

// ---------------------------------------------------------------------------
// small deterministic PRNG and 1D value noise. Same construction the pumpkin
// uses. Nothing at module scope, so two crooks with the same seed are the same
// crook and two with different seeds flicker out of step.
function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Smoothstep value noise. Layered it gives the slow wander and the rare events.
// What it cannot give is the fine tremble: smoothstep is flat at every lattice
// node, so a channel at f Hz stands still f times a second by construction. See
// update() for what carries the tremble instead.
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
// a fat soft bar swept along a curve
//
// TubeGeometry would do most of this, and it is not used for two reasons. The
// radius has to taper along the bar, which TubeGeometry cannot do; and the nose
// has to roll off into a ball rather than stop at a flat annulus, which is the
// single most visible way a soft-vinyl prop can go wrong. Where the radius
// rolls to nothing the triangles go degenerate and averaged face normals come
// out as a dark pinched spot, so the normals here are analytic, tilted by the
// slope of the radius profile the way pumpkin.js does its stem.
function sweepBar(curve, radiusOf, along, around) {
  const frames = curve.computeFrenetFrames(along, false);
  const verts = [];
  const nors = [];
  const idx = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  const h = 0.5 / along;
  const lo = (t) => Math.max(0, t - h);
  const hi = (t) => Math.min(1, t + h);
  const speedAt = (t) => curve.getPoint(lo(t)).distanceTo(curve.getPoint(hi(t))) / (hi(t) - lo(t));

  for (let j = 0; j <= along; j++) {
    const t = j / along;
    const c = curve.getPoint(t);
    const T = curve.getTangent(t);
    const N = frames.normals[j];
    const B = frames.binormals[j];
    const r = radiusOf(t);
    const slope = (radiusOf(hi(t)) - radiusOf(lo(t))) / ((hi(t) - lo(t)) * speedAt(t));
    for (let i = 0; i < around; i++) {
      const phi = (i / around) * Math.PI * 2;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      p.copy(c).addScaledVector(N, cs * r).addScaledVector(B, sn * r);
      verts.push(p.x, p.y, p.z);
      n.set(0, 0, 0).addScaledVector(N, cs).addScaledVector(B, sn).addScaledVector(T, -slope).normalize();
      nors.push(n.x, n.y, n.z);
    }
  }
  const vi = (j, i) => j * around + (i % around);
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      idx.push(vi(j, i), vi(j, i + 1), vi(j + 1, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i));
    }
  }
  // The start is buried in the foot, so it gets a flat fan and nobody sees it.
  // The far end rolls off to a point on its own and needs nothing.
  const capStart = verts.length / 3;
  const c0 = curve.getPoint(0);
  const t0 = curve.getTangent(0);
  verts.push(c0.x, c0.y, c0.z);
  nors.push(-t0.x, -t0.y, -t0.z);
  for (let i = 0; i < around; i++) idx.push(capStart, vi(0, i + 1), vi(0, i));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nors, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Nothing on this prop carries a texture, so nothing needs UVs, and dropping
// them is not just tidiness: mergeGeometries refuses a list where some
// geometries have a `uv` attribute and some do not, and the swept bar cannot
// have one while every lathe and torus in three does. Same trap shed/index.js
// documents.
function stripUV(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('uv1');
  return g;
}

// A lathe whose profile is a spline through the given points rather than the
// points themselves. Corners are what this file is trying hardest not to have,
// and a hand-written profile with eight points in it always has eight of them.
function softLathe(pts, steps = 40, segments = SEGMENTS.radial) {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const profile = [];
  for (let i = 0; i <= steps; i++) profile.push(curve.getPoint(i / steps));
  const g = new THREE.LatheGeometry(profile, segments);
  g.computeVertexNormals();
  return stripUV(g);
}

// ---------------------------------------------------------------------------
// the fake optics, lifted from fountain/water.js
//
// There is no environment map in this scene and adding one would light the
// glass out of register with the stone beside it. So the sky is three colours
// and two smoothsteps, the horizon is where the grey floor takes over, and the
// sun is one Blinn lobe. `viewMatrix`, `cameraPosition` and `isOrthographic`
// are all declared by three's own fragment prefix, so this needs no uniforms
// beyond the palette.
const OPTICS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
uniform float uInner;
uniform vec3 uInnerCol;
varying vec3 vGlassN;
varying vec3 vGlassP;

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands, not two. The middle one is the scene's own backdrop and it
// matters most: a pane seen side-on reflects almost horizontally, so its rim
// samples the horizon and nothing else, and a two-colour ramp puts a DARK
// outline round every piece of glass.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with glass's F0, which is 0.04 rather than water's 0.02. Looking
// straight at a pane you see four per cent of the sky in it and essentially all
// of the flame behind it; at the silhouette that inverts, which is what draws
// the bright edge round the glass and is most of what makes it read as glazing
// rather than as a painted panel.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}
`;

// The composite. Three layers in the order light meets them: what bounces off
// the pane, what comes through it from the flame inside, and whatever the frame
// buffer already holds behind it.
//
// Composited as `over`, so the alpha handed to the blender is the alpha the
// glass really has and the reflection does not get multiplied away by an
// opacity slider. That is the classic transparent-glass failure: the highlights
// are computed correctly and then faded out along with the body.
const GLASS_FRAG = `
  vec3 wN = normalize(vGlassN);
  vec3 wV = worldViewDir(vGlassP);
  float ndv = clamp(abs(dot(wN, wV)), 0.0, 1.0);

  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0);
  vec3 h = normalize(wV + uSunDir);
  vec3 refl = skyProbe(reflect(-wV, wN)) + uSunCol * (uGlint * pow(max(dot(wN, h), 0.0), uShine));

  // The flame washing the inside of the pane. The lamp is INSIDE the glass, so
  // three's own shading of these front faces is light arriving from behind them
  // and comes out nearly black; without this term the lantern would be a dark
  // box with a bright ring round it. Strongest looking straight in and falling
  // off toward the silhouette, where the fresnel takes the pane over anyway.
  vec3 inner = uInnerCol * (uInner * (0.35 + 0.65 * ndv));

  vec3 body = outgoingLight + inner;
  float A = uBodyA;
  float a = A + F * (1.0 - A);
  gl_FragColor = vec4((body * A + refl * F * (1.0 - A)) / max(a, 1e-4), a);
`;

export function createCrookLantern({ seed = 1, scale = 1, wind = 1 } = {}) {
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: these are the same prop, not different
  // ones. A hair of height, a hair of curl, and a whole different phase for the
  // flame and the wind, because six of these standing in a row flickering and
  // swaying in lockstep is the one failure a set of props cannot survive.
  const postTop = POST_TOP * (0.97 + rand() * 0.06);
  const hookR = HOOK_R * (0.95 + rand() * 0.10);
  const hookEnd = (HOOK_END + (rand() - 0.5) * 14) * Math.PI / 180;
  const lean = (rand() - 0.5) * 0.030;          // radians, the post is not plumb
  const facing = rand() * Math.PI * 2;          // which way the crook points
  const flickerPhase = rand() * 100;
  const windPhase = rand() * 100;

  const group = new THREE.Group();

  // ---------------------------------------------------------------------------
  // the post
  //
  // One curve for the whole thing, straight shaft and hook together, because a
  // straight tube meeting an arc is a crease however carefully the two radii
  // are matched, and a crease is the one thing the house style has no room for.
  // The arc starts with its radius vector horizontal, which is what makes its
  // tangent vertical there, so the shaft flows into the hook with no join at
  // all.
  const hookC = new THREE.Vector2(hookR, postTop);   // the hook's centre
  const path = [];
  // The shaft. Sampled rather than given as two endpoints so the spline through
  // it cannot bow.
  const shaftFrom = 0.012;
  for (let i = 0; i < 8; i++) {
    path.push(new THREE.Vector3(0, shaftFrom + (postTop - shaftFrom) * (i / 8), 0));
  }
  // The hook, from straight up over the crown and down past the horizontal.
  const HOOK_STEPS = 26;
  for (let i = 0; i <= HOOK_STEPS; i++) {
    const a = Math.PI + (hookEnd - Math.PI) * (i / HOOK_STEPS);
    path.push(new THREE.Vector3(hookC.x + hookR * Math.cos(a), hookC.y + hookR * Math.sin(a), 0));
  }
  const spine = new THREE.CatmullRomCurve3(path, false, 'centripetal', 0.5);

  // Where the ring hangs: the last point on the spine, which is the middle of
  // the nose. The ring rides on the underside of the bar, so the pivot is a
  // bar-radius below the centreline.
  const nose = path[path.length - 1];
  const HANG = new THREE.Vector3(nose.x, nose.y - BAR_NOSE * 0.55, nose.z);

  // The radius profile. Fat at the foot, a little slimmer at the nose, and
  // rolled off into a ball over the last two per cent so the bar ends in a knob
  // rather than in a pipe. The roll is a circular arc in the radius, not a
  // linear taper, which is the difference between a ball and a cone.
  const ROLL = 0.030;
  const barRadius = (t) => {
    const base = BAR_FOOT + (BAR_NOSE - BAR_FOOT) * Math.min(1, t * 1.15);
    if (t <= 1 - ROLL) return base;
    const u = (t - (1 - ROLL)) / ROLL;
    return base * Math.sqrt(Math.max(0, 1 - u * u));
  };

  const shaftGeo = sweepBar(spine, barRadius, 160, 20);

  // The foot. A soft dome with a collar, wide enough to hold the post up and
  // rounded everywhere, so it is a toy's foot rather than a machine flange.
  // There is no spike: a spike is a point and this style has none.
  const footGeo = softLathe([
    [0.000, 0.000],
    [FOOT_R * 0.55, 0.000],
    [FOOT_R * 0.94, 0.006],
    [FOOT_R, 0.022],
    [FOOT_R * 0.93, 0.044],
    [FOOT_R * 0.66, 0.062],
    [FOOT_R * 0.44, 0.074],
    [BAR_FOOT * 1.30, 0.095],
    [BAR_FOOT * 1.02, 0.120],
  ], 30);

  const ironMat = toyMaterial(IRON, { roughness: 0.66, metalness: 0.06 });
  const postGeo = mergeGeometries([shaftGeo, footGeo], false);
  shaftGeo.dispose();
  footGeo.dispose();
  const post = new THREE.Mesh(postGeo, ironMat);
  post.castShadow = true;
  post.receiveShadow = true;

  // The whole post leans a hair and points wherever the seed says. The lantern
  // hangs off the same yaw, so the crook and its load stay in one plane.
  const stand = new THREE.Group();
  stand.rotation.y = facing;
  stand.rotation.z = lean;
  stand.add(post);
  group.add(stand);

  // ---------------------------------------------------------------------------
  // the hanging assembly
  //
  // `pivot` sits at the hanging point and everything below it is built in
  // negative y from there, so the swing is a rotation of one group about the
  // one place a lantern on a ring can actually rotate about.
  const pivot = new THREE.Group();
  pivot.position.copy(HANG);
  stand.add(pivot);

  // The ring, threaded over the nose.
  //
  // Its plane is NOT perpendicular to the bar, which is the first thing that
  // was tried and is wrong twice over. A ring hanging loose on a rod is held up
  // by the rod and pulled down by gravity, so it settles in a VERTICAL plane
  // perpendicular to the rod's horizontal direction, not to the rod itself.
  // Squared to the tangent instead it came out canted thirty degrees off plumb,
  // which reads as a link that has been welded on rather than one that hangs,
  // and it dragged the whole lantern under it out of square as well.
  const noseTangent = spine.getTangent(1);
  const ringN = new THREE.Vector3(noseTangent.x, 0, noseTangent.z).normalize();
  // The bail is threaded through the ring, so its plane is the other one: still
  // vertical, and at right angles to the ring's.
  const bailN = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ringN).normalize();

  const inPlane = (normal, y) => {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal),
    );
    m.setPosition(0, y, 0);
    return m;
  };

  const ringGeo = stripUV(new THREE.TorusGeometry(RING_R, 0.0125, 10, 28));
  ringGeo.applyMatrix4(inPlane(ringN, -RING_R + BAR_NOSE * 0.55));
  const ringBottom = -RING_R * 2 + BAR_NOSE * 0.55;

  // The bail: a big hoop over the roof, hanging in the ring. Half a torus, so
  // its two feet are at its own centre height, and BAIL_DROP is how far down
  // the roof's shoulder they have to land to actually touch it. That number is
  // read off the roof profile below rather than guessed: at BAIL_R = 0.070 the
  // ogee is 46mm below its apex, and getting it wrong by a centimetre is the
  // difference between a bail bolted to a lantern and a bail floating over one.
  const BAIL_DROP = 0.046;
  const roofTop = ringBottom - (BAIL_R - BAIL_DROP);
  const bailGeo = stripUV(new THREE.TorusGeometry(BAIL_R, 0.0125, 10, 30, Math.PI));
  bailGeo.applyMatrix4(inPlane(bailN, roofTop - BAIL_DROP));

  // The roof. An ogee: it leaves the finial almost flat, steepens, and flares
  // out again at the eaves, which is what stops a cone from reading as a cone.
  const roofGeo = softLathe([
    [0.000, roofTop],
    [0.013, roofTop - 0.002],
    [0.034, roofTop - 0.013],
    [0.058, roofTop - 0.033],
    [0.081, roofTop - 0.058],
    [0.099, roofTop - ROOF_H * 0.92],
    [0.110, roofTop - ROOF_H],
    [0.105, roofTop - ROOF_H - 0.015],
    [0.083, roofTop - ROOF_H - 0.022],
  ], 30);
  // A small knob on top, because the ogee has to end somewhere and a lathe that
  // closes to a point at the axis is a spike.
  const finialGeo = stripUV(new THREE.SphereGeometry(0.022, 20, 12));
  finialGeo.translate(0, roofTop + 0.006, 0);

  const glassTop = roofTop - ROOF_H - 0.016;
  const glassBottom = glassTop - GLASS_H;
  // The pane barrels out a little at the waist. A dead straight cylinder of
  // glass is the one part of a toy lantern that always looks like a pipe.
  const glassRadius = (u) => GLASS_R * (1 + 0.085 * Math.sin(Math.PI * u));

  const baseTop = glassBottom + 0.010;
  const baseGeo = softLathe([
    [0.000, baseTop - BASE_H],
    [0.050, baseTop - BASE_H],
    [0.078, baseTop - BASE_H + 0.009],
    [0.096, baseTop - BASE_H + 0.028],
    [0.100, baseTop - 0.015],
    [0.091, baseTop],
    [0.070, baseTop + 0.004],
  ], 28);

  // The cage: four fat uprights following the pane's barrel, standing a couple
  // of millimetres proud of it. They are what says "lantern" at fifty pixels
  // across, and they are the only place on this prop where a hard vertical is
  // allowed, because they are the thing the swing is measured against.
  const cageParts = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const r = glassRadius(u) + 0.009;
      pts.push(new THREE.Vector3(Math.cos(a) * r, glassBottom + GLASS_H * u, Math.sin(a) * r));
    }
    // Run the bar a little past the glass at both ends so it disappears into
    // the roof and the base rather than stopping in mid-air.
    pts.unshift(new THREE.Vector3(Math.cos(a) * (glassRadius(0) + 0.009), glassBottom - 0.020, Math.sin(a) * (glassRadius(0) + 0.009)));
    pts.push(new THREE.Vector3(Math.cos(a) * (glassRadius(1) + 0.009), glassTop + 0.016, Math.sin(a) * (glassRadius(1) + 0.009)));
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    cageParts.push(stripUV(new THREE.TubeGeometry(c, 24, 0.0120, 10, false)));
  }

  const lampIronMat = toyMaterial(IRON_DARK, { roughness: 0.62, metalness: 0.06 });
  const ironParts = [ringGeo, bailGeo, roofGeo, finialGeo, baseGeo, ...cageParts];
  const lampIronGeo = mergeGeometries(ironParts, false);
  for (const g of ironParts) g.dispose();
  const lampIron = new THREE.Mesh(lampIronGeo, lampIronMat);
  lampIron.castShadow = true;
  lampIron.receiveShadow = true;
  pivot.add(lampIron);

  // The glass.
  const glassProfile = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    glassProfile.push(new THREE.Vector2(glassRadius(u), glassBottom + GLASS_H * u));
  }
  const glassGeo = new THREE.LatheGeometry(glassProfile, SEGMENTS.radial);
  glassGeo.computeVertexNormals();

  const optics = {
    // The same imaginary sky water.js reflects, so the two props agree about
    // where they are. Linear, because this is composited before tone mapping.
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#868b95').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.45, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff6ea').convertSRGBToLinear() },
    // How much of the fresnel to believe. Physically 1.0; it is over one
    // because the fake sky is a flat gradient with no bright spots of its own
    // to find, and needs the help to register against pale stone.
    uRimGain: { value: 2.20 },
    uGlint: { value: 1.10 },
    uShine: { value: 150.0 },
    // How much of what is behind the pane the pane hides. Low, because the
    // whole job of this glass is that you can see a flame through it.
    uBodyA: { value: 0.40 },
    uInner: { value: INNER.min },
    uInnerCol: { value: new THREE.Color('#ffb268').convertSRGBToLinear() },
  };

  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS),
    roughness: 0.16,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    depthWrite: true,
    side: THREE.FrontSide,   // the far pane's back faces buy nothing at this size
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, optics);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassN;\nvarying vec3 vGlassP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGlassN = normalize(mat3(modelMatrix) * objectNormal);
  vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OPTICS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // The cache key has to change or three hands this material the depth-only
  // program it compiled for some other MeshStandardMaterial with the same
  // parameters.
  glassMat.customProgramCacheKey = () => 'crook-glass';

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.castShadow = false;   // a shadow pass on a pane you can see through buys nothing
  glass.receiveShadow = false;
  glass.renderOrder = 2;
  pivot.add(glass);

  // A stub of candle and the flame on top of it. The candle is what gives the
  // interior a floor and a scale; without it the flame is a spark hanging in a
  // box.
  const candleGeo = softLathe([
    [0.000, glassBottom + 0.004],
    [0.019, glassBottom + 0.004],
    [0.024, glassBottom + 0.010],
    [0.024, glassBottom + 0.042],
    [0.019, glassBottom + 0.050],
    [0.009, glassBottom + 0.053],
    [0.000, glassBottom + 0.054],
  ], 18, 24);
  const candleMat = toyMaterial(WAX, { roughness: 0.74 });
  const candle = new THREE.Mesh(candleGeo, candleMat);
  candle.castShadow = false;
  pivot.add(candle);

  const flameY = glassBottom + 0.054;

  // The flame. A lathe rather than a scaled sphere, because a scaled sphere is
  // an egg: symmetric top to bottom, and it read as a light bulb sitting on a
  // plinth. A flame is a teardrop, wide and round at the wick and drawn to a
  // point at the top, and the asymmetry is most of what says fire at fifteen
  // pixels tall.
  const blobGeo = softLathe([
    [0.0000, 0.000],
    [0.0080, 0.003],
    [0.0125, 0.010],
    [0.0135, 0.020],
    [0.0115, 0.031],
    [0.0070, 0.040],
    [0.0025, 0.046],
    [0.0000, 0.048],
  ], 20, 18);
  const blobMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd9a0'),
    toneMapped: true,
  });
  // MeshBasic rather than Standard: the flame IS the light source, and a lit
  // material here would be shaded by its own PointLight sitting inside it. Its
  // colour carries the flicker directly, and it is deliberately kept off the
  // white ceiling: ACES desaturates as it brightens, so a blob pushed hard
  // enough to clip comes out as a white pill with a warm rim rather than as a
  // flame, which is exactly what the first pass did.
  const flame = new THREE.Mesh(blobGeo, blobMat);
  flame.position.set(0, flameY, 0);
  flame.renderOrder = 1;
  pivot.add(flame);

  // ---------------------------------------------------------------------------
  // the one light
  //
  // A PointLight, no shadow, parented into `pivot` so it travels with the
  // lantern for free. Distance is set past where inverse-square has already
  // finished the job, so the cutoff fades rather than stops.
  //
  // It sits a little ABOVE the visible flame, and that is not an accident. At
  // the wick it is four centimetres from the cage bars and eighty from the
  // ground, and inverse square over that ratio makes the ironwork four hundred
  // times brighter than the pool it is supposed to be casting. Lifting it into
  // the top of the flame costs nothing on the floor and takes the worst of that
  // off the bars.
  const lamp = new THREE.PointLight(new THREE.Color(PALETTE.glow), LAMP.min, 2.6, 2);
  lamp.castShadow = false;
  lamp.position.set(0, flameY + 0.030, 0);
  pivot.add(lamp);

  const flameHome = lamp.position.clone();

  // ---------------------------------------------------------------------------
  // the swing
  //
  // TWO AXES. swing.js is one angle in and one angle out, and a lantern on a
  // ring is free in two. So there are two of them, one per horizontal axis, and
  // the lantern's tilt is the pair. That is the honest model: a spherical
  // pendulum at small amplitude IS two independent linear ones, and the sin()
  // coupling that would make it genuinely two-dimensional is a fifth-order
  // effect at the two degrees this thing lives at.
  //
  // The cross axis is given a four per cent longer effective length, and that
  // is a deliberate small lie worth naming. Two oscillators with EXACTLY equal
  // periods trace a fixed ellipse forever, so the lantern would swing along one
  // unchanging line or round one unchanging oval for as long as anyone watched,
  // which is the same "authored" tell as a looping flame. Four per cent puts a
  // beat of about twenty-seven seconds between them, so the plane of the swing
  // creeps round and the motion never repeats. A real lantern's ring and bail
  // are not isotropic either, so this is not even much of a lie.
  //
  // The effective length is the compound-pendulum one, I/(m*d), not the
  // distance to the centre of mass. For a body 0.31 tall hanging 0.26 below the
  // ring that is about a centimetre longer than d, which is three per cent on
  // the period: small, and free, since it is one line of arithmetic done once.
  const bodyTop = roofTop;
  const bodyBottom = baseTop - BASE_H;
  const comY = (bodyTop + bodyBottom) * 0.5 + 0.012;   // the roof is the heavy end
  const d = -comY;                                      // pivot is the local origin
  const halfH = (bodyTop - bodyBottom) * 0.5;
  const gyr2 = (halfH * halfH * 4) / 12 + (GLASS_R * GLASS_R) / 4;
  const pendulumL = (d * d + gyr2) / d;

  // DAMPING. swing.js says loudly that its default 0.6 is wrong for `none`, and
  // it is: with nothing to strike, damping is the only loss in the system, and
  // at 0.6 a free pendulum rings at more than two degrees for fifteen seconds,
  // which is the metronome that file exists to warn about. Its gate wanted 2.0.
  // A lantern is not a gate leaf, and the two differences pull opposite ways: a
  // compact box has far less broadside area than a flat plate, so less of the
  // quadratic term, but it hangs on a ring rather than on a greased pin, so
  // rather more of the dry one. 2.4 is where it landed after looking at the
  // measured decay against the render.
  //
  // Free decay, wind off, one nudge, measured on this exact object at 60fps:
  //
  //     peak amplitude    9.27  4.41  2.42  1.30  0.56 degrees
  //     at                0.27  1.33  2.40  3.47  4.53 s
  //     period            1.067s, and 1.067s at every one of them
  //     under one degree  4.5s
  //     dead stop         4.9s, and still exactly zero at sixty
  //
  // The last line is the one the gate's file is warning about and the one worth
  // checking after any retune. Nothing is moving a minute later, to the bit,
  // because the dry-friction term reaches zero in finite time rather than
  // approaching it. The period not moving across that range is not a bug in the
  // sin() torque either: at nine degrees the exact pendulum is 0.2% slower than
  // the small-angle one, which is under two milliseconds and well inside the
  // frame the crossings are measured to. That term earns its keep on a gate
  // swinging through a radian; here it is along for the ride and correct.
  const DAMPING = 2.4;
  const swingX = createSwing({ stop: 'none', damping: DAMPING, length: pendulumL, maxAngle: 0.6 });
  const swingZ = createSwing({ stop: 'none', damping: DAMPING, length: pendulumL * 1.04, maxAngle: 0.6 });

  // WIND, and the one thing swing.js could not give.
  //
  // A damped pendulum with nothing driving it ends up exactly where it started,
  // and a lantern hanging dead still in a graveyard is a lantern nobody
  // notices. So the two axes are driven by a slow noise field. The point of
  // doing it as a FORCE rather than as an animated angle is that everything
  // between the wind and the lantern is still the pendulum: the lantern keeps
  // its own period, a gust arriving at the wrong moment damps it as readily as
  // one arriving at the right moment builds it, and the amplitude therefore
  // wanders instead of holding. That is the whole difference between a swing
  // and a metronome, and it is bought for two noise lookups a frame.
  //
  // THREE OCTAVES, AND THE SLOW ONE ALONE IS NOT ENOUGH. The first attempt was
  // one noise channel at 0.2Hz, a fifth of the pendulum's own 0.94Hz, and it
  // came out wrong in a way that is obvious afterwards: forcing that far below
  // resonance is QUASI-STATIC, so the lantern just leans wherever the wind is
  // pushing and creeps back. It crossed plumb seven times in two minutes and
  // never rang once. A lantern that leans is not a lantern that swings. Real
  // wind is broadband, so the mix carries content up around the natural
  // frequency too and the pendulum picks its own period out of the noise.
  //
  // Measured on the shipped object over 180 seconds:
  //
  //     along the crook    1.49 deg rms, peak 4.85
  //     across it          0.78 deg rms, peak 2.23
  //     crossings of plumb 98, median gap 1.32s against a natural 1.07s
  //     peak per 10s       2.2 3.2 3.6 4.5 4.9 3.8 3.8 3.2 3.8 4.6 3.2 4.4 ...
  //
  // That last row is the thing to protect if these numbers are ever retuned:
  // the amplitude has to keep wandering by a factor of two over the minute.
  // It is what says the wind is weather rather than a loop.
  //
  // The cross axis gets a little over half, because a breeze has a direction
  // and a lantern hung off one side of a crook is not equally exposed both
  // ways. `wind: 0` turns the whole thing off and leaves a plain damped
  // pendulum that settles and stays settled.
  const WIND = 2.4 * Math.max(0, wind);
  const GUST = [0.32, 0.40, 0.28];   // slow breeze, gust, and the fine chop

  // ---------------------------------------------------------------------------
  const patch = contactShadow({ radius: FOOT_R * 2.6, opacity: 0.34, softness: 0.62 });
  group.add(patch);

  group.scale.setScalar(scale);

  const flameCol = new THREE.Color();

  return {
    group,

    // Something went past and knocked it. Angular impulse in rad/s, signed in
    // the crook's own frame, exactly as swing.js means it: 1.2 opens the lantern
    // to about nine degrees. Not part of the interface every prop shares, and
    // here for the same reason the gate's push is: secondary motion is
    // SIMULATED and follows from primary motion, so when the ghost drifts
    // through this the scene should be able to say so rather than have the
    // lantern politely ignore it. It is also what makes the free decay
    // measurable from outside, which is how the damping above was tuned.
    nudge(impulse, cross = 0) {
      swingX.push(impulse);
      if (cross) swingZ.push(cross);
    },

    update(time, dt = 1 / 60) {
      // --- the flame ---------------------------------------------------------
      //
      // Four things at once, and the light only reads as fire when all four
      // are: a fine tremble that never stops, a slower wander breathing under
      // it, the rare event, and the flame physically moving while it does the
      // rest. Straight from pumpkin.js, including both of the things that file
      // learned the hard way.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;

      // Tremble. A carrier at a flame's own flutter rate whose PHASE is dragged
      // about by slow noise. This is the fix for the stall: summed smoothstep
      // noise has zero derivative at every lattice node, so a channel at f Hz
      // stands still f times a second and the light visibly freezes. A carrier
      // never stalls, and frequency-modulating it stops the bare sine reading
      // as a hum. Two of them, both inside the 5 to 15Hz band a real candle
      // flickers in: at 60fps anything past 20Hz is three frames to a period
      // and comes out as sparkle rather than as tremble.
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.034 * wobble(7.3, 0.6, 12.4) + 0.020 * wobble(12.9, 0.9, 55.1);

      // Wander. The slow breathing underneath, over a second or two. Summed
      // noise is right here and its stalls are a feature: a lull is exactly
      // what the slow channel is for, and the tremble runs through it.
      const wander = 0.048 * swing(0.79, 0) + 0.034 * swing(2.3, 17.5);

      // Gutter and flare. Only the top of a slow channel counts, so each is a
      // thing that HAPPENS rather than a rhythm, and squaring the ramp keeps
      // the deep part brief while the onset and recovery stay soft. The flare
      // is set rarer than the gutter, because a flame droops far more often
      // than it draws itself up.
      const g = noise(t * 0.45 + 77.3);
      const gutter = g > 0.73 ? (g - 0.73) / 0.27 : 0;
      const dip = gutter * gutter * (0.40 + 0.28 * noise(t * 9.3 + 5.1));
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.80 ? (fl - 0.80) / 0.20 : 0;
      const flare = flareRamp * flareRamp * (0.11 + 0.07 * noise(t * 7.1 + 91.2));

      // A soft ceiling rather than a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the ceiling and sit there, which pins
      // the lamp at its maximum for the whole event and turns the brightest
      // moment into the flattest one. This bends the top over instead, matching
      // value and slope at the knee and asymptoting above it, so a flare comes
      // out as a peak with a shape on it and the level never quite arrives.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      flameCol.copy(EMBER).lerp(FLAME, hue);
      lamp.color.copy(flameCol);
      lamp.intensity = LAMP.min + (LAMP.max - LAMP.min) * level;

      blobMat.color.copy(BLOB_EMBER).lerp(BLOB_FLAME, hue)
        .multiplyScalar(BLOB.min + (BLOB.max - BLOB.min) * level);
      optics.uInner.value = INNER.min + (INNER.max - INNER.min) * level;
      optics.uInnerCol.value.copy(flameCol);

      // The flame is an object and it moves, and this is the half of the effect
      // that modulating intensity cannot reach. Brightening in place only pumps
      // the pool; moving the source slides the shadows of the four cage bars
      // round the inside of the glass. Small, because the flame is inside a box
      // six centimetres across and a flame that wanders further than that is
      // outside its own lantern.
      const across = 0.007 * (0.55 * swing(0.83, 5.5) + 0.45 * wobble(5.9, 0.5, 71.6));
      const into = 0.006 * swing(0.61, 2.7);
      const rise = 0.004 * swing(1.3, 8.1) + 0.014 * flare - 0.011 * dip;
      lamp.position.set(flameHome.x + across, flameHome.y + rise, flameHome.z + into);
      flame.position.set(across, flameY + rise, into);
      // The blob stands up on a flare and sinks in a gutter, the same way the
      // light does, so the two cannot disagree about what the fire is doing.
      flame.scale.set(0.94 + 0.10 * level, 0.80 + 0.34 * level, 0.94 + 0.10 * level);

      // --- the swing ---------------------------------------------------------
      const w = time + windPhase;
      const gust = (o) => GUST[0] * ((noise(w * 0.19 + o) - 0.5) * 2)
        + GUST[1] * ((noise(w * 0.83 + o + 41.2) - 0.5) * 2)
        + GUST[2] * ((noise(w * 2.30 + o + 7.7) - 0.5) * 2);
      if (WIND > 0) {
        swingX.push(WIND * gust(0) * dt);
        swingZ.push(WIND * 0.55 * gust(88.6) * dt);
      }
      swingX.update(dt);
      swingZ.update(dt);

      // A tilt in x is a rotation about z, and vice versa with the sign the
      // other way. Small angles, so the order the two are applied in is a
      // second-order difference and the default XYZ is fine.
      pivot.rotation.set(swingZ.angle, 0, -swingX.angle);
    },

    dispose() {
      postGeo.dispose();
      lampIronGeo.dispose();
      glassGeo.dispose();
      candleGeo.dispose();
      blobGeo.dispose();
      ironMat.dispose();
      lampIronMat.dispose();
      glassMat.dispose();
      candleMat.dispose();
      blobMat.dispose();
      patch.userData.dispose?.();
      group.clear();
    },
  };
}
