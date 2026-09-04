import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, contactShadow } from '../style.js';
import { Profile, createSink, sinkToGeometry, latheInto, transformRange } from '../fountain/lathe.js';

// A hurricane lamp: the old tin storm lantern. A round oil font at the bottom,
// a brass burner with a wick knob on its side, a bulging glass chimney, a
// vented cap over it, two side tubes and a wire carrying handle that has fallen
// over onto the cap.
//
// This is the most OBJECT of the lanterns. The others are fixtures: they stand
// where somebody built them. This one has a handle, which means it was carried,
// which means it was PUT DOWN, and everything below is in service of that one
// read. Four decisions carried the build.
//
// IT STANDS, WITH ITS HANDLE FALLEN. The brief offered two rests: tipped
// against something, or upright with the handle flopped to one side. Upright
// won, and not for an easy life. A prop that leans on something is only correct
// beside that something, and this module cannot know what the graveyard will
// put next to it; a lamp leaning on nothing is the worst of both. Upright with
// the bail dropped over onto the cap says "set down" just as loudly, is true
// wherever it lands, and costs no contract with its neighbours. What it does
// cost is honesty about where the bail comes to rest, so the fall angle is not
// a number typed in: `restAngle` swings the bail down from vertical until it
// touches the body and stops there. See the note on it.
//
// THE HANDLE IS THE TRAP AND IT WAS SOLVED BY MOVING IT, NOT BY THINNING IT.
// A real bail is 3mm wire. Here it is a 25mm rounded bar, one part in seven of
// the span it crosses, which on the reference photograph would look like a roll
// bar. Two things make it read anyway. It is SHORT: the pivots sit at the top
// of the side tubes and the arc is a half circle on that span and no more, so
// the bar never has a long lonely run where the eye can measure its thickness
// against nothing. And it is DOWN: fallen over, it lies along the cap and the
// chimney's shoulder, and a bar with something behind it all the way reads as a
// handle where the same bar hooped in mid air reads as a hoop.
//
// THE CHIMNEY IS THE EASY CASE AND THE BARREL IS WHY. The scene has no
// environment map, so glass borrows the fountain's fake optics (water.js) as
// the ground lantern and the pillar did. What those two had to fight for, this
// one gets from its shape. A vertical pane seen from a camera 29 degrees up
// reflects the FLOOR, whatever way it faces, so the ground lantern had to belly
// its panes and the pillar had to crown them just to drag the reflected ray up
// to the horizon. This chimney swells from 0.056 to 0.084 and back over 150mm:
// its surface tilts through about 55 degrees between the waist and the neck, so
// the reflection sweeps from well above the horizon at the bottom of the bulge
// to deep floor at the top, in one pass, on the shape the object already has.
// That gradient down the glass is the whole difference between glazing and a
// hole, and here it cost nothing.
//
// ONE POINT LIGHT, NO SHADOW. Six pumpkins and five lanterns are already in
// every fragment shader's light loop. The flame gets one unshadowed PointLight
// and it sits at the flame's TIP: three has no sphere light, so a point source
// down at the wick sits in an inverse-square singularity that burns the burner
// plate white before the ground sees anything at all.

// ---------------------------------------------------------------------------
// metrics
//
// World units, the fount's rim resting at y = 0, origin on the axis.
//
// Overall: 0.382 to the top of the vent crown, 0.216 across the fount. Against
// createTombstone({ variant: 'fred' }) at 1.10 and the ghost at 1.60, that is a
// third of the little headstone and just under a quarter of the ghost: shin
// height, which is where a lamp somebody set down belongs. It is deliberately
// the fattest of the set rather than the tallest, height over width 1.77 where
// the real article is nearer 2.4. A storm lantern squashed toward its own
// footprint is the shape a vinyl toy of one would be.
const M = {
  // The fount is deliberately NARROWER than the cage of tubes round the
  // chimney, and that waist is the storm lantern's whole silhouette. At 0.106
  // against a 0.108 bow the two were the same width and the prop read as a
  // straight-sided drum with a lid; at 0.098 against 0.114 there is a visible
  // step in and the tubes become part of the outline instead of decoration on
  // the front of it.
  fount: {
    rim: 0.080,        // the ring the whole prop stands on, at y = 0
    belly: 0.098,      // widest point
    bellyY: 0.034,
    seam: 0.005,       // the crimp where the two stampings meet
    seamY: 0.046,
    plate: 0.082,      // the flat top the burner is screwed into
    plateY: 0.098,
  },
  burner: {
    baseR: 0.060,
    baseY: 0.102,
    collarR: 0.067,    // the knurled ring you grip to lift the burner out
    galleryR: 0.063,   // the cup the chimney's foot sits in
    topY: 0.146,
    plateY: 0.133,     // where the wick comes through, and the flame's floor
  },
  glass: {
    lo: 0.136,
    hi: 0.292,
    foot: 0.054,
    bulge: 0.084,
    bulgeY: 0.196,
    neck: 0.048,
  },
  hood: {
    seatY: 0.292,
    seatR: 0.058,
    // The brim, and it is the number that decides where the handle ends up.
    // A bail can only fall as far as the widest thing under its pivots, so the
    // arc has to clear the brim by its own bar radius or it stops dead on it.
    // At 0.084 the swing halted at 87 degrees, which is a handle LEANING; at
    // 0.076, against a bail of 0.096, it carries on to 128 and lies down on the
    // chimney's shoulder, which is a handle that has fallen. Still 28
    // thousandths of overhang past the chimney's neck, so it is still a cap.
    brim: 0.076,
    brimY: 0.311,
    crownY: 0.362,
    topY: 0.382,
  },
  tube: {
    radius: 0.0125,    // the side tubes and the bail: one section for both
    footR: 0.088,      // where they leave the fount's shoulder
    footY: 0.080,
    bowR: 0.114,       // bowed out round the chimney, as the real ones are
    bowY: 0.203,
    waistR: 0.084,     // tucked back in against the cap's brim
    waistY: 0.302,
    topR: 0.096,       // and kicked out again to carry the bail's ear
    topY: 0.326,
  },
  knob: {
    az: -0.62,         // which way the wick wheel points, before the seeded spin
    y: 0.121,
    reach: 0.080,      // centre of the wheel, out from the axis
    wheel: 0.021,
    thick: 0.0085,
  },
  flameY: 0.131,
};

// Steps round. The chimney is the piece the eye lands on and the only one whose
// silhouette is a long smooth curve, so it gets the most; the fount and cap are
// short runs and 40 is already past the point where another step shows.
const SEG = { glass: 48, body: 40, tube: 10 };

// ---------------------------------------------------------------------------
// colour
//
// Two metals, and the second one is worth its draw call. A hurricane lamp is a
// painted tin body with a BRASS burner in the middle of it, and that brass is
// the only warm thing on the object when the flame is out. Rendered in one
// metal the burner disappeared into the fount and the middle third of the prop
// went to a single grey column; in two, the eye is drawn to exactly the part
// that does something, which is where the wick knob is and where the flame
// comes out. Both are metalness 0, like everything else in this set: with no
// environment map a metal in this scene renders black.

// Galvanised tin. The palette's stone taken down and tilted the same way
// ground.js tilts its ironwork, but only to 0.58 of value rather than 0.42:
// this body is thin painted sheet catching the sky, not wrought iron. Worked in
// sRGB, the space the palette was authored in, for the reason ground.js records
// (a linear lerp toward a blue lands on a dead neutral, and a neutral dark next
// to candlelight reads as mud).
const TIN = (() => {
  const c = new THREE.Color(PALETTE.stone);
  const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const V = 0.58;
  const TILT = [0.93, 1.05, 1.24];
  return c.setRGB(s.r * V * TILT[0], s.g * V * TILT[1], s.b * V * TILT[2], THREE.SRGBColorSpace);
})();

// Dull brass. Off the palette's stem brown rather than invented from nothing,
// lifted in value and pushed hard toward yellow, so it belongs to the same set
// as the pumpkin's stalk.
//
// It is TARNISHED brass and not polished, and that is a lighting decision as
// much as a colour one. The first pass was #ad813c, which is bright brass, and
// it put the lightest surface on the prop three centimetres under a point light
// with an inverse square falloff: the gallery and the collar went to flat white
// and took the flame with them, so the whole lower chimney read as one cream
// cloud with a wick in it. Every fix from the light's side made it worse, since
// turning the lamp down or flattening its decay far enough to save the brass
// also took away the pool on the ground, which is the one thing in this scene
// only a lantern can do. Darkening the metal instead costs nothing and gives
// the brass back its form under the flame.
const BRASS = (() => {
  const c = new THREE.Color(PALETTE.stem);
  const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return c.setRGB(
    Math.min(1, s.r * 1.16),
    Math.min(1, s.g * 1.26),
    Math.min(1, s.b * 0.92),
    THREE.SRGBColorSpace,
  );
})();

const GLASS_TINT = '#adc4cd';
const CHAR = '#2a2018';

// The flame's two ends, the same pair the pumpkin and the ground lantern use,
// so every fire in this scene is the same fire. Converted by hand because a
// light's colour is not colour-managed by three.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// And again for the flame body, which is a material and not a light. Set well
// over 1 on purpose: ACES rolls a bright emissive off toward white, and a flame
// that does not clip its core reads as an orange jelly bean.
const CORE_EMBER = new THREE.Color('#ff8a30');
const CORE_FLAME = new THREE.Color('#ffd08a');

// What the one flame level drives, at the bottom and top of its swing. All of
// them ride the same number, which is the whole trick: driven separately they
// read as four things happening near each other.
const LAMP = { min: 0.72, max: 1.52 };   // the PointLight, 2.11 : 1
const CORE = { min: 1.20, max: 2.50 };   // the flame body
const HALO = { min: 0.07, max: 0.19 };   // the soft shell round it
const WASH = { min: 0.50, max: 1.30 };   // the flame on the inside of the glass
const HUE_MID = 0.90;
const HUE_GAIN = 1.5;

// ---------------------------------------------------------------------------
// noise
//
// Smooth 1D value noise, the pumpkin's construction. Right for the slow wander
// and for the gutter and flare gates, where a stall is a lull and a lull is the
// point. Wrong for the tremble: smoothstep is flat at every lattice node, so a
// channel at f Hz stands still f times a second by construction. See update().

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
// profiles
//
// Every turned piece on this lamp is one Profile from fountain/lathe.js, swept
// by latheInto, which already carries the angular displacement hook the vent
// louvres and the knurled wheel need. There is no second surface generator in
// this file and there did not need to be: a font and a chimney are both lathes,
// and the two things that are not (the side tubes and the bail) are tubes along
// a curve, which is a different problem and gets three's own TubeGeometry.

// The oil font: a dished underside standing on a rolled rim, a belly with the
// crimp seam of two stampings round it, and a flat top plate.
//
// The seam is not decoration. Without it the fount is a smooth pebble and the
// prop's biggest single surface has nothing on it at all; with it there is one
// horizontal line round the widest part of the object, which is what says
// "pressed out of sheet in two halves" in the only place a viewer will look.
function fountProfile() {
  const f = M.fount;
  return new Profile()
    .setTag('fount')
    .moveTo(0, 0.019)
    .curve([[0.032, 0.017], [0.060, 0.009], [f.rim, 0.000]], 8)
    // The rolled foot. Centre inboard of the rim so the arc runs from the
    // lowest point of the prop out and up into the belly.
    .arc(f.rim, 0.012, 0.012, -Math.PI / 2, 0.42, 7)
    .curve([[0.095, 0.026], [f.belly, f.bellyY]], 5)
    // The crimp where the two stampings meet, five thousandths proud over
    // twelve of height. It was three and a half and invisible: on a fount this
    // is the ONLY line anywhere on the biggest surface of the prop, and without
    // it the tank is a smooth pebble that could have been turned from solid.
    .curve([
      [f.belly - 0.001, f.seamY - 0.006],
      [f.belly + f.seam, f.seamY],
      [f.belly - 0.002, f.seamY + 0.006],
    ], 8)
    // The shoulder, and it falls away rather than running straight up: a fount
    // with parallel sides is a tin can, and this one has to read as pressed.
    .curve([[0.094, 0.066], [0.089, f.plateY - 0.014], [f.plate, f.plateY - 0.005]], 9)
    .arc(f.plate - 0.006, f.plateY - 0.005, 0.006, 0, Math.PI / 2, 4)
    .lineTo(M.burner.baseR + 0.004, f.plateY + 0.001, 4)
    .lineTo(M.burner.baseR + 0.004, f.plateY + 0.003, 1);
}

// The brass burner: a drum screwed into the fount's plate, a knurled collar
// round its middle, the gallery that the chimney's foot drops into, and the
// deflector that closes the top with the wick coming through it.
//
// The deflector is its own tagged run because it is a different COLOUR from the
// rest of the piece, not a different shape. See the tint hook at the call site:
// this is the plate that sits directly under the flame and on any lamp that has
// been lit it is black with soot.
function burnerProfile() {
  const b = M.burner;
  return new Profile()
    .setTag('base')
    .moveTo(0, b.baseY - 0.002)
    .lineTo(b.baseR, b.baseY - 0.002, 3)
    .arc(b.baseR, b.baseY + 0.003, 0.005, -Math.PI / 2, 0, 3)
    .setTag('collar')
    .lineTo(b.baseR, b.baseY + 0.008, 2)
    .curve([[b.collarR, b.baseY + 0.013], [b.collarR, b.baseY + 0.020]], 5)
    .setTag('drum')
    .curve([[b.baseR - 0.002, b.baseY + 0.026], [0.056, b.baseY + 0.032]], 5)
    // The gallery: a cup that flares out to catch the chimney's foot. The
    // chimney's own glass hides the joint, which is exactly what it does on the
    // real thing.
    .curve([[b.galleryR, b.topY - 0.008], [b.galleryR, b.topY]], 6)
    // ...and back in over the top, closing the piece on the axis. Closed rather
    // than open: an open tube shows its own back face through the glass, and at
    // this size that is a black crescent under the flame. DISHED rather than
    // flat, because a flat one is a disc thirty per cent of the frame's width
    // with a single value on it, and a dish has a lit far side and a shaded
    // near one whichever way the lamp is turned.
    .setTag('deflector')
    .curve([[0.055, b.topY - 0.004], [0.046, b.plateY + 0.004]], 5)
    .curve([[0.030, b.plateY - 0.002], [0.013, b.plateY - 0.003]], 5)
    .lineTo(0, b.plateY - 0.003, 2);
}

// The chimney. A closed shell: a disc at the bottom hidden inside the gallery,
// the barrel, a disc at the top hidden under the cap. Closed and drawn
// FrontSide is one clean layer of glass between the eye and the flame, with no
// sorting to get wrong; DoubleSide would composite the near and far walls in
// whatever order the triangles arrived in and the tint would crawl as the
// camera turned.
function glassProfile() {
  const g = M.glass;
  return new Profile()
    .setTag('glass')
    .moveTo(0, g.lo)
    .lineTo(g.foot - 0.008, g.lo, 3)
    .arc(g.foot - 0.008, g.lo + 0.008, 0.008, -Math.PI / 2, 0, 4)
    // The barrel. Sampled rather than arced: the swell wants to be fuller below
    // the waist than above it, the way a blown globe is, and a circular arc is
    // symmetric by definition.
    .curve([
      [g.foot + 0.014, 0.160],
      [g.bulge - 0.004, 0.180],
      [g.bulge, g.bulgeY],
      [g.bulge - 0.008, 0.224],
      [0.066, 0.256],
      [g.neck + 0.006, g.hi - 0.010],
    ], 22)
    .arc(g.neck - 0.002, g.hi - 0.010, 0.010, 0, Math.PI / 2, 4)
    .lineTo(0, g.hi, 3);
}

// The vented cap: a flared brim over the chimney's neck, a soft dome, and a
// raised crown with a lid over it, which is the vent every storm lantern has
// and the only way heat leaves the thing.
function hoodProfile() {
  const h = M.hood;
  return new Profile()
    .setTag('under')
    .moveTo(0, h.seatY - 0.005)
    .lineTo(0.044, h.seatY - 0.005, 3)
    .lineTo(h.seatR, h.seatY, 3)
    // The eave. Out almost flat to the brim, rolled over its edge and then back
    // in, which is street.js's drip edge and is what turns a dome into a roof:
    // the first pass ran the brim straight into the dome and the cap came out
    // as a bowler hat. This run is also the one the louvres are cut into.
    .setTag('vent')
    .curve([[0.066, h.seatY + 0.008], [h.brim, h.brimY - 0.004]], 8)
    .arc(h.brim - 0.0055, h.brimY - 0.004, 0.0055, 0, Math.PI / 2, 5)
    .setTag('dome')
    .curve([[0.066, 0.318], [0.054, 0.334], [0.038, 0.352], [0.028, h.crownY]], 12)
    // The crown, and the shadow slot under its lid is the other half of
    // "vented": louvres you can only see from the side, and a dark ring under
    // the top that you can see from anywhere above the horizon.
    .setTag('crown')
    .lineTo(0.024, 0.370, 2)
    .lineTo(0.036, 0.372, 2)
    .arc(0.032, 0.3745, 0.0045, -Math.PI / 2, Math.PI / 2, 5)
    .curve([[0.026, h.topY - 0.002], [0, h.topY]], 5);
}

// The wick wheel, authored flat about the Y axis and stood on edge afterwards.
// A disc with a knurl round its rim, and the knurl is the lathe's angular
// displacement hook doing the job it was written for: eighteen soft flutes cut
// only into the run tagged 'rim', which is the only place a wheel is knurled.
function wheelProfile() {
  const k = M.knob;
  const t = k.thick / 2;
  return new Profile()
    .setTag('face')
    .moveTo(0, -t)
    .lineTo(k.wheel - 0.004, -t, 3)
    .setTag('rim')
    .arc(k.wheel - 0.004, 0, t, -Math.PI / 2, Math.PI / 2, 7)
    .setTag('face2')
    .lineTo(0, t, 3);
}

// ---------------------------------------------------------------------------
// where the bail comes to rest
//
// The handle is not placed at a typed-in angle. It is swung down from vertical
// about its pivots, half a degree at a time, and stopped the step before its
// bar first touches the lamp. `outer` is the body's silhouette radius as a
// function of height, sampled off the geometry that was actually built, so if a
// profile changes the handle re-lands on it instead of sinking into it.
//
// Only the middle half of the arc is tested. Near the pivots the bail is
// welded to the tube tops and passes through the cap's brim on purpose, exactly
// as it does on the real lamp; treating that as a collision would stop the
// swing at zero degrees and hoop the handle in the air.
function restAngle(outer, { bailR, pivotY, tubeR }) {
  const clearance = 0.0018;
  let best = 0;
  for (let deg = 0; deg <= 155; deg += 0.5) {
    const th = (deg * Math.PI) / 180;
    let ok = true;
    for (let i = 0; i <= 32 && ok; i++) {
      const phi = Math.PI * (0.25 + 0.5 * (i / 32));
      const s = bailR * Math.sin(phi);
      const x = bailR * Math.cos(phi);
      const y = pivotY + s * Math.cos(th);
      const z = s * Math.sin(th);
      const wall = outer(y);
      // Only a height the body actually occupies can stop the swing. Without
      // this guard the apex fails at zero degrees: standing upright it sits on
      // the axis in clear air, and `outer` is zero up there, so a naive
      // "further out than the wall" test rejects it for being near the middle
      // of nothing.
      if (y < tubeR) ok = false;
      else if (wall > 1e-4 && Math.hypot(x, z) < wall + tubeR + clearance) ok = false;
    }
    if (!ok) break;
    best = deg;
  }
  return (best * Math.PI) / 180;
}

// A max-radius-by-height table off a finished geometry. Coarse on purpose: the
// bail is a 25mm bar and it does not need to know the body's silhouette to
// better than a millimetre, and a table cannot be fooled by a profile it was
// not told about the way a hand-written bound can.
function silhouette(geometries, { top = 0.42, step = 0.002 } = {}) {
  const bins = new Float32Array(Math.ceil(top / step) + 2);
  for (const g of geometries) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0 || y > top) continue;
      const r = Math.hypot(p.getX(i), p.getZ(i));
      const b = Math.round(y / step);
      if (r > bins[b]) bins[b] = r;
    }
  }
  // One dilation, so a bin that happened to fall between two rings of vertices
  // cannot report a waist the body does not have.
  const out = bins.slice();
  for (let i = 1; i < bins.length - 1; i++) out[i] = Math.max(bins[i - 1], bins[i], bins[i + 1]);
  return (y) => {
    if (y < 0 || y > top) return 0;
    return out[Math.round(y / step)] || 0;
  };
}

// ---------------------------------------------------------------------------
// the glass
//
// water.js's fake optics, cut down to what a chimney needs, and composited the
// way ground.js found it has to be: the reflection goes IN FRONT of the body as
// an `over`, not mixed into it through an opacity slider. Get that wrong and
// the fresnel rim is computed correctly and then faded out along with the body
// it was supposed to stand clear of.
const GLASS_PARS = `
uniform vec3 uSkyHi;
uniform vec3 uSkyMid;
uniform vec3 uSkyLo;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uInnerCol;
uniform float uInner;
uniform float uRimGain;
uniform float uGlint;
uniform float uShine;
uniform float uBodyA;
uniform float uSoot;
varying vec3 vGP;
varying vec3 vGN;
varying float vGT;

vec3 worldViewDir(vec3 wPos) {
  if (isOrthographic) return normalize(vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z));
  return normalize(cameraPosition - wPos);
}

// Three bands and not two, for water.js's reason: a curved surface seen near
// its silhouette reflects almost horizontally, so its rim samples the horizon
// and nothing else, and a two colour ramp puts a DARK outline round the glass.
vec3 skyProbe(vec3 r) {
  vec3 c = mix(uSkyLo, uSkyMid, smoothstep(-0.50, -0.02, r.y));
  return mix(c, uSkyHi, smoothstep(0.02, 0.60, r.y));
}

// Schlick with soda glass's F0 rather than water's: 0.04, four per cent face on
// and nearly all of it at the silhouette. That gradient IS the glazing.
float fresnelGlass(float ndv) {
  float m = clamp(1.0 - ndv, 0.0, 1.0);
  float m2 = m * m;
  return 0.04 + 0.96 * m2 * m2 * m;
}
`;

const GLASS_FRAG = `
  vec3 wN = normalize(vGN);
  vec3 wV = worldViewDir(vGP);
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);

  // Soot, and on a hurricane lamp it is not evenly spread. The draught comes up
  // through the burner and out of the cap, so the plume rides the neck and the
  // waist stays clear: heaviest at the top, and there is a second, lighter band
  // right down at the foot where the glass meets the gallery and never gets
  // wiped. This is most of what stops the chimney reading as a plastic bottle.
  float soot = uSoot * (smoothstep(0.62, 1.00, vGT) + 0.34 * (1.0 - smoothstep(0.0, 0.16, vGT)));

  // The flame on the inside face. Strongest across the waist, where the flame
  // actually is, dying off up the neck, and warmer at a glancing angle for the
  // same reason A is bigger there: more glass to glow through.
  float lit = exp(-6.5 * abs(vGT - 0.28)) * (0.58 + 0.42 * (1.0 - ndv));

  // BODY: the chimney's own tint over whatever is behind it, thicker at a
  // glancing angle because the chord through the glass is longer there.
  vec3 body = outgoingLight * (1.0 - 0.72 * soot) + uInnerCol * (uInner * lit);
  float A = clamp(mix(uBodyA, uBodyA * 3.0, 1.0 - ndv) + 0.50 * soot, 0.0, 1.0);

  // SURFACE: what bounces off the outside, over the body rather than mixed into
  // it. A highlight on glass is opaque where it lands.
  float F = clamp(fresnelGlass(ndv) * uRimGain, 0.0, 1.0) * (1.0 - 0.55 * soot);
  float glint = clamp(uGlint * pow(max(dot(wN, normalize(wV + uSunDir)), 0.0), uShine), 0.0, 1.0);
  float S = F + glint * (1.0 - F);
  vec3 surf = (skyProbe(reflect(-wV, wN)) * F + uSunCol * (glint * (1.0 - F))) / max(S, 1e-4);

  float a = S + A * (1.0 - S);
  gl_FragColor = vec4((surf * S + body * A * (1.0 - S)) / max(a, 1e-4), a);
`;

// ---------------------------------------------------------------------------

export function createHurricaneLamp({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed * 2654435761 + 91);
  const noise = makeNoise(seed);
  const flickerPhase = rand() * 100;

  // Per-seed variation, kept small: five lanterns off one shelf. Which way it
  // was set down, which way the handle fell, a degree or so of settle because
  // the ground is earth, and how sooty the chimney has got.
  const spin = rand() * Math.PI * 2;
  const bailYaw = (rand() - 0.5) * 0.22;
  const settleDir = rand() * Math.PI * 2;
  const settle = 0.010 + rand() * 0.016;
  const soot = 0.30 + rand() * 0.16;

  const disposables = [];

  // --- tin ------------------------------------------------------------------
  // Fount, cap, side tubes and bail: one sink, one geometry, one draw call.
  const tinSink = createSink();
  latheInto(tinSink, { profile: fountProfile().build(), segments: SEG.body, uRepeat: 1 });

  // The cap's louvres. Eighteen soft flutes pressed into the brim, windowed to
  // nothing at both ends of the run so they cannot leave a step where the brim
  // meets the dome. Displacement rather than holes: at 84mm across, a hole
  // punched through this brim is four pixels and reads as noise, where a flute
  // catches the key light and reads as a row all the way round.
  latheInto(tinSink, {
    profile: hoodProfile().build(),
    segments: SEG.body,
    uRepeat: 1,
    displace: (s, th) => {
      if (s.tag !== 'vent') return [0, 0];
      // Windowed with a fat sine rather than a plain one, so the flutes are at
      // full depth across the brim's outer third instead of only at one ring
      // of it, and still taper to nothing where the run joins its neighbours.
      // Six thousandths on a seventy-six brim is eight per cent, which is the
      // depth at which they show up in the SILHOUETTE and not only in shading.
      // At four they were invisible from every angle the prop is ever seen at.
      const window = Math.pow(Math.sin(Math.PI * s.u), 0.55);
      return [-0.0060 * window * (0.5 - 0.5 * Math.cos(18 * th)), 0];
    },
  });

  const tinLathes = sinkToGeometry(tinSink);
  tinLathes.deleteAttribute('color');   // nothing here is vertex-tinted

  // The two side tubes and the bail. These are the only pieces on the lamp that
  // are not solids of revolution, and they get three's tube sweep rather than a
  // fourth surface generator.
  const tubeParts = [];
  const bailPivots = [];
  {
    const t = M.tube;
    // A side tube leaves the fount's shoulder, bows out round the widest part
    // of the chimney and comes back in under the cap. The bow is what stops the
    // pair reading as two straight sticks strapped on.
    // The kink at the top is not decoration either: the tube comes back in to
    // touch the cap, which is what joins the two, and then flares out again to
    // put the bail's ear outboard of the brim, which is what lets the handle
    // fall. Both are on the real object for exactly these two reasons.
    const sideCurve = (sx) => new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * (t.footR - 0.012), t.footY - 0.016, 0),
      new THREE.Vector3(sx * t.footR, t.footY, 0),
      new THREE.Vector3(sx * t.bowR, t.bowY, 0),
      new THREE.Vector3(sx * t.waistR, t.waistY, 0),
      new THREE.Vector3(sx * t.topR, t.topY, 0),
    ], false, 'centripetal', 0.5);
    for (const sx of [1, -1]) {
      tubeParts.push(new THREE.TubeGeometry(sideCurve(sx), 26, t.radius, SEG.tube, false));
      // The pivot boss, which is also the cap on the open end of the tube.
      const boss = new THREE.SphereGeometry(t.radius * 1.32, 14, 10);
      boss.translate(sx * t.topR, t.topY, 0);
      tubeParts.push(boss);
      bailPivots.push(new THREE.Vector3(sx * t.topR, t.topY, 0));
    }
  }

  // Everything the bail could land on, measured off the geometry rather than
  // asserted. The tubes are excluded: the bail's own ends live on them.
  const glassGeoForBound = (() => {
    const s = createSink();
    latheInto(s, { profile: glassProfile().build(), segments: 20, uRepeat: 1 });
    return sinkToGeometry(s);
  })();
  const outer = silhouette([tinLathes, glassGeoForBound]);
  glassGeoForBound.dispose();

  const bailR = M.tube.topR;
  const bailAngle = restAngle(outer, { bailR, pivotY: M.tube.topY, tubeR: M.tube.radius });

  {
    // The bail itself: a half circle on the pivot span, rotated down by the
    // angle the swing found, with a slight bow so the bar is not a perfect
    // machine arc. Twenty-two points through a centripetal spline, which is
    // enough that the sweep's own frames stay smooth round the apex.
    const pts = [];
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const phi = Math.PI * (i / n);
      // A hand-bent bail is flatter over the top than a true semicircle.
      const rr = bailR * (1 + 0.055 * Math.sin(phi) * Math.sin(phi));
      const s = rr * Math.sin(phi);
      pts.push(new THREE.Vector3(
        bailR * Math.cos(phi),
        M.tube.topY + s * Math.cos(bailAngle),
        s * Math.sin(bailAngle),
      ));
    }
    // The ends are pinned back onto the pivots, whatever the bow did to them.
    pts[0].copy(bailPivots[0]);
    pts[n].copy(bailPivots[1]);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    tubeParts.push(new THREE.TubeGeometry(curve, 44, M.tube.radius, SEG.tube, false));
    // A knuckle at each end, so the bar ends in a joint rather than in a hole.
    for (const p of bailPivots) {
      const k = new THREE.SphereGeometry(M.tube.radius * 1.18, 14, 10);
      k.translate(p.x, p.y, p.z);
      tubeParts.push(k);
    }
  }

  const tinGeo = mergeGeometries([tinLathes, ...tubeParts], false);
  tinLathes.dispose();
  tubeParts.forEach((g) => g.dispose());
  const tinMat = new THREE.MeshStandardMaterial({
    color: TIN,
    // Below the house 0.82. Painted sheet is the one thing on this prop allowed
    // a broad soft highlight, and without it the body goes flat beside the
    // glass and the brass.
    roughness: 0.56,
    metalness: 0.0,
  });
  const tin = new THREE.Mesh(tinGeo, tinMat);
  tin.castShadow = true;
  tin.receiveShadow = true;
  disposables.push(tinGeo, tinMat);

  // --- brass ----------------------------------------------------------------
  const brassSink = createSink();
  latheInto(brassSink, {
    profile: burnerProfile().build(),
    segments: SEG.body,
    uRepeat: 1,
    // The collar is knurled, the same way the wheel is and for the same reason:
    // it is the ring a hand grips.
    displace: (s, th) => (s.tag === 'collar'
      ? [0.0018 * Math.sin(Math.PI * s.u) * (0.5 - 0.5 * Math.cos(30 * th)), 0]
      : [0, 0]),
    // Soot on the deflector, and it is the single most load-bearing four lines
    // on the prop. That plate sits 45mm under a point light with an inverse
    // square falloff and it is the widest surface inside the lamp, so in brass
    // it rendered as a flat white disc filling the lower half of the chimney
    // and the FLAME WAS INVISIBLE AGAINST IT. Rendered dark, the flame is the
    // brightest thing in the lamp again, which is the only arrangement that
    // reads. Tinted through the lathe's own vertex-colour hook rather than
    // split into a second mesh, so it costs no draw call and no seam, and
    // ramped over the run so there is no band where the brass ends.
    tint: (s) => {
      if (s.tag !== 'deflector') return [1, 1, 1];
      const t = Math.min(1, s.u / 0.5);
      const k = 1 - 0.84 * (t * t * (3 - 2 * t));
      return [k, k * 0.94, k * 0.88];
    },
  });

  // The wick knob. Built flat, then stood on edge and pushed out to the side of
  // the burner on its stem. transformRange is exactly this: author a piece
  // where it is easy to author and still come out in the same draw call.
  {
    const k = M.knob;
    const start = brassSink.pos.length;
    latheInto(brassSink, {
      profile: wheelProfile().build(),
      segments: 30,
      uRepeat: 1,
      displace: (s, th) => (s.tag === 'rim'
        ? [0.0022 * (0.5 - 0.5 * Math.cos(18 * th)), 0]
        : [0, 0]),
    });
    const place = new THREE.Matrix4()
      .makeTranslation(Math.cos(k.az) * k.reach, k.y, Math.sin(k.az) * k.reach)
      // Stand the disc on edge and turn its axis out along the radius: the
      // same pair the stem below uses, which is the point of doing it this way
      // rather than by eye. RotZ(-90) sends the lathe's +Y to +X, and RotY(-az)
      // swings that round to the azimuth the knob sits at.
      .multiply(new THREE.Matrix4().makeRotationY(-k.az))
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    transformRange(brassSink, start, place);

    // The stem it turns on, from the side of the burner out to the wheel.
    const stemStart = brassSink.pos.length;
    latheInto(brassSink, {
      profile: new Profile()
        .moveTo(0, 0)
        .lineTo(0.0075, 0, 2)
        .lineTo(0.0075, 0.030, 3)
        .arc(0.0035, 0.030, 0.004, 0, Math.PI / 2, 3)
        .lineTo(0, 0.034, 2)
        .build(),
      segments: 14,
      uRepeat: 1,
    });
    transformRange(brassSink, stemStart, new THREE.Matrix4()
      .makeTranslation(Math.cos(k.az) * 0.050, k.y, Math.sin(k.az) * 0.050)
      .multiply(new THREE.Matrix4().makeRotationY(-k.az))
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)));
  }

  // The filler cap on the fount's plate, off to the other side from the knob.
  {
    const az = M.knob.az + Math.PI * 0.80;
    const start = brassSink.pos.length;
    latheInto(brassSink, {
      profile: new Profile()
        .moveTo(0, 0)
        .lineTo(0.015, 0, 3)
        .arc(0.0115, 0, 0.0035, -Math.PI / 2, Math.PI / 2, 4)
        .curve([[0.009, 0.010], [0, 0.012]], 5)
        .build(),
      segments: 22,
      uRepeat: 1,
    });
    // Sunk five thousandths into the plate, so it reads as a cap screwed into
    // the tank rather than a button glued onto it.
    transformRange(brassSink, start, new THREE.Matrix4().makeTranslation(
      Math.cos(az) * 0.050, M.fount.plateY - 0.005, Math.sin(az) * 0.050,
    ));
  }

  const brassGeo = sinkToGeometry(brassSink);
  const brassMat = new THREE.MeshStandardMaterial({
    color: BRASS,
    roughness: 0.55,
    metalness: 0.0,
    vertexColors: true,   // the deflector's soot, see the tint hook above
  });
  const brass = new THREE.Mesh(brassGeo, brassMat);
  brass.castShadow = true;
  brass.receiveShadow = true;
  disposables.push(brassGeo, brassMat);

  // --- the wick -------------------------------------------------------------
  // A flat wick standing in the burner's slot. Two millimetres of char, and it
  // matters far past its size: without it the flame floats a hair above the
  // brass and the whole thing goes to plastic.
  const wickGeo = new THREE.CapsuleGeometry(0.0032, 0.009, 3, 10);
  wickGeo.scale(2.2, 1, 0.62);
  wickGeo.translate(0, M.burner.plateY - 0.001, 0);
  const wickMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CHAR), roughness: 0.92 });
  const wick = new THREE.Mesh(wickGeo, wickMat);
  wick.castShadow = false;
  wick.receiveShadow = false;
  disposables.push(wickGeo, wickMat);

  // --- the flame ------------------------------------------------------------
  // A hurricane lamp burns a FLAT wick, so its flame is a leaf rather than a
  // teardrop: wide one way, thin the other. Built as a lathe and then squashed
  // on one axis, which is a scale on the mesh and costs nothing.
  const flameProfile = (amp, hgt) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push(new THREE.Vector2(amp * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.60)), 1.25), hgt * t));
    }
    return pts;
  };
  // Both shells are taller than they are wide, and the halo more so than the
  // core. Recorded as a strip and read back (out/hurricane/mo), the first pass
  // had a halo 60 wide by 60 tall, which on the frames where it flared came out
  // as a horizontal orange ellipse: a flame that goes ROUND when it brightens
  // is a glow, and this one has to go UP.
  const coreGeo = new THREE.LatheGeometry(flameProfile(0.0150, 0.058), 16);
  const haloGeo = new THREE.LatheGeometry(flameProfile(0.0255, 0.088), 16);
  const coreMat = new THREE.MeshBasicMaterial({ color: CORE_FLAME.clone(), toneMapped: true });
  const haloMat = new THREE.MeshBasicMaterial({
    color: CORE_EMBER.clone(),
    transparent: true,
    opacity: HALO.min,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    // A transparent double-sided material is TWO draw calls by default: three
    // renders its back faces and then its front faces so they composite in
    // order. Measured, that was the prop's eighth call for one small blob. It
    // is bought back for nothing here because this shell composites ADDITIVELY,
    // and addition does not care what order it happens in.
    forceSinglePass: true,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  core.position.y = M.flameY;
  halo.position.y = M.flameY - 0.011;
  core.renderOrder = 1;
  halo.renderOrder = 1;
  for (const m of [core, halo]) { m.castShadow = false; m.receiveShadow = false; }
  disposables.push(coreGeo, haloGeo, coreMat, haloMat);

  // --- the chimney ----------------------------------------------------------
  const glassGeo = (() => {
    const s = createSink();
    latheInto(s, { profile: glassProfile().build(), segments: SEG.glass, uRepeat: 1 });
    const g = sinkToGeometry(s);
    g.deleteAttribute('color');
    // A 0..1 up the chimney, written as an attribute rather than derived from
    // world Y in the shader, so scaling or moving the prop cannot slide the
    // soot along it.
    const p = g.getAttribute('position');
    const a = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) a[i] = (p.getY(i) - M.glass.lo) / (M.glass.hi - M.glass.lo);
    g.setAttribute('aPane', new THREE.BufferAttribute(a, 1));
    return g;
  })();

  const glassUniforms = {
    // The scene's backdrop is #b9bec7 and its floor #8f949e, so a ray leaving
    // the glass going up finds the first and one going down finds the second.
    uSkyHi: { value: new THREE.Color('#d6def0').convertSRGBToLinear() },
    uSkyMid: { value: new THREE.Color('#c4ccda').convertSRGBToLinear() },
    uSkyLo: { value: new THREE.Color('#9aa3b0').convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(3.2, 6.0, 2.4).normalize() },
    uSunCol: { value: new THREE.Color('#fff4e6').convertSRGBToLinear() },
    uInnerCol: { value: FLAME.clone() },
    uInner: { value: WASH.min },
    // How much of the fresnel to believe. Physically 1.0, and this stands in
    // for the whole missing surround: the scene has no environment and no big
    // soft source for a curved surface to find, so without a gain the chimney
    // is four per cent reflective face on and simply is not there.
    //
    // Swept and looked at at 0 (off), 1.5, 3.4, 6, 8.5 and 12, at a close
    // three-quarter framing, with the interior already darkened so the flame
    // was not doing the glass's job for it: out/hurricane/g2 and g3. Under
    // about 3 the chimney reads as an open cage. Past about 9 the upper barrel
    // goes hazy and starts veiling the flame. Six is where the sky gradient
    // down the barrel is unmistakable and the flame is still crisp behind it.
    uRimGain: { value: 6.0 },
    // The key's lobe, and BROAD rather than tight, which is the opposite of
    // what the shape suggested. The first pass used 96 on the theory that a
    // barrel would give a tight lobe a highlight line of its own; rendered with
    // the lobe switched off, the frame was identical (out/hurricane/g3), which
    // is the answer: with the key 53 degrees up and the chimney's normals
    // within 29 degrees of horizontal, the half vector never comes close enough
    // to a normal for an exponent that sharp to fire at all. At 44 it lights
    // the swell's shoulders as a soft band, which is what curved glass does.
    uGlint: { value: 1.6 },
    uShine: { value: 44.0 },
    uBodyA: { value: 0.15 },
    uSoot: { value: soot },
  };

  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(GLASS_TINT),
    roughness: 0.14,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPane;
varying vec3 vGP;
varying vec3 vGN;
varying float vGT;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vGP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGN = normalize(mat3(modelMatrix) * objectNormal);
  vGT = aPane;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_PARS}`)
      .replace('#include <opaque_fragment>', GLASS_FRAG);
  };
  // Or three hands this material a depth program it compiled for some other
  // MeshStandardMaterial with the same parameters.
  glassMat.customProgramCacheKey = () => 'hurricane-chimney';
  // Exposed so a lab page can turn the optics between frames: every number
  // above was found by rendering a sweep and looking at it, and a rebuild per
  // value is the difference between sweeping ten and sweeping three.
  glassMat.userData.optics = glassUniforms;

  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 2;
  // Never a caster: a shadow map has no idea the chimney is transparent, so a
  // glazed lamp that casts is a solid black cylinder on the ground.
  glass.castShadow = false;
  glass.receiveShadow = true;
  disposables.push(glassGeo, glassMat);

  // --- the one light --------------------------------------------------------
  const lamp = new THREE.PointLight(FLAME.clone(), 0, 2.6 * scale, 2);
  // At the flame's TIP, not its foot. three has no sphere light, so a point
  // source down in the wick sits in an inverse-square singularity: it burns the
  // burner plate 10mm away to flat white long before the ground 150mm away sees
  // anything. Lifting it to the tip is the cheapest stand-in for a source with
  // a radius, and it changes the pool on the floor by about two per cent.
  lamp.position.set(0, M.flameY + 0.046, 0);
  lamp.castShadow = false;

  // --- assembly -------------------------------------------------------------
  const body = new THREE.Group();
  body.add(tin, brass, wick, core, halo, glass, lamp);
  // The bail was built in the xz plane of the body; turning it here means the
  // handle's fall direction is seeded without re-solving the rest angle.
  body.rotation.y = spin;

  const group = new THREE.Group();
  group.add(body);

  // A contact patch, and unlike the ground lantern's this one earns its place.
  // That prop lights the floor it stands on and a painted disc punched a hole
  // through the middle of its own pool. This lamp's flame is 130mm up inside a
  // sooted chimney with a solid fount under it, so the ground directly beneath
  // is the one place the lamp does NOT light: it is the prop's own shadow, and
  // the key light throws its cast shadow well off to the side.
  const patch = contactShadow({ radius: 0.20, opacity: 0.44, softness: 0.62 });
  body.add(patch);

  // Settle. A lamp set down on earth is never quite plumb, and a tilt about
  // the origin lifts one side of the standing rim by rim * sin(settle) exactly
  // as it buries the other. So the whole body drops by that full lift plus a
  // hair: the raised edge of the rim finishes level with the floor and the
  // buried one goes about five millimetres under, which on 380 of prop is one
  // part in seventy and reads as pressed into earth rather than as balanced on
  // it. Measured after the fact with the harness's lowest(), which walks every
  // vertex under its own world matrix -- NOT Box3.setFromObject, which
  // transforms the corners of the local box and so grows it by the rotation and
  // always reports a prop deeper than it is.
  body.rotation.x = Math.cos(settleDir) * settle;
  body.rotation.z = Math.sin(settleDir) * settle;
  body.position.y = -M.fount.rim * Math.sin(settle) - 0.0008;

  group.scale.setScalar(scale);
  // PointLight.distance is in world units and three does not scale it by the
  // object's matrix, and intensity is candela against a distance that grows
  // with the prop, so both are corrected here.
  const lightGain = scale * scale;

  // Read by the lab harness to plot the flicker without a screenshot. Nothing
  // in the prop reads it.
  group.userData.flame = { level: 1 };
  group.userData.bailAngle = bailAngle;

  const lampHome = lamp.position.clone();
  const coreHome = core.position.clone();
  const haloHome = halo.position.clone();

  return {
    group,

    update(time) {
      // Four channels at once, and the flame only reads as a flame when all
      // four run: a fine tremble that never stops, a slow wander breathing
      // under it, the rare event, and the flame physically moving while it does
      // the rest.
      //
      // This is the STEADIEST flame in the set and that is the object's whole
      // purpose: a hurricane lamp is the one lantern built to keep burning in
      // weather, with a draught drawn up through the burner and out of the cap.
      // So its gutters are rarer and shallower than the ground lantern's and
      // its wander is slower. What it must not do is stop.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2;
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));

      // Tremble: two carriers inside the 5..15 Hz band a flame flutters in,
      // whose PHASE is dragged about by slow noise. That is the anti-stall
      // trick and it is the reason this is not summed value noise: smoothstep
      // interpolation is flat at every lattice node, so a noise channel at f Hz
      // stands still f times a second by construction, and three of them summed
      // just gives three sets of stalls that sometimes line up. A frequency
      // modulated carrier never stalls and never repeats, where the bare sine
      // under it would read as a hum. Nothing over 15 Hz either: at 60fps a
      // 20 Hz carrier is three frames to a period and reads as sparkle.
      // Measured over fifteen simulated minutes at 60fps, beside the ground
      // lantern's published figures for the same metric:
      //
      //                         this     ground lantern
      //   mean level            0.901    0.880
      //   spread (sd)           0.049    0.077   calmer, which is the point
      //   1st percentile        0.67     0.53
      //   99th / max            0.96/0.98  0.97/0.99   pinned at neither end
      //   mean step per frame   0.0156   0.0151
      //   frames within 0.002   9.6%     9.9%    the anti-stall number
      //
      // and as events, counted with a 0.05 re-arm so the tremble is not
      // miscounted: a duck below 0.80 every 20 seconds, below 0.70 every 30, a
      // real gutter past 0.50 every three minutes, and a flare over 0.96 every
      // 10. The gutters are three to five times rarer than the ground candle's,
      // which is the whole difference between a flame in a box and a flame in a
      // lamp designed to stay lit outdoors.
      //
      // The two rows to read together are the third and the last. This flame
      // swings a THIRD as far as the open candle's and still MOVES slightly
      // more per frame, which is what a storm lantern is: a fire that keeps its
      // level in weather and is never for one frame still. The first pass at
      // 0.022 and 0.013 hit 14.7% of frames stalled, and the fix was not more
      // amplitude but more RATE: a carrier's per-frame step goes as amplitude
      // times frequency, so moving 6.2 and 11.4 Hz up to 7.8 and 13.0 bought
      // most of it without widening the swing.
      const tremble = 0.030 * wobble(7.8, 0.52, 12.4) + 0.017 * wobble(13.0, 0.80, 55.1);

      // Wander: the breathing underneath, over a second or two. Summed noise is
      // right here and its stalls are a feature, since a lull is exactly what
      // the slow channel is for and the tremble runs on through it.
      const wander = 0.038 * swing(0.58, 0) + 0.024 * swing(1.6, 17.5);

      // Gutter. Only the top of a slow channel counts, so these are events that
      // happen rather than a rhythm, and squaring the ramp keeps the deep part
      // brief while onset and recovery stay soft.
      const g = noise(t * 0.31 + 77.3);
      const gutter = g > 0.82 ? (g - 0.82) / 0.18 : 0;
      const dip = gutter * gutter * (0.30 + 0.20 * noise(t * 8.6 + 5.1));

      // Flare, the gutter's other half: now and then the flame draws itself up
      // and the whole chimney goes pale for a second. Rarer still, because a
      // flame droops far more often than it stands.
      const fl = noise(t * 0.27 + 143.9);
      const flareRamp = fl > 0.84 ? (fl - 0.84) / 0.16 : 0;
      const flare = flareRamp * flareRamp * (0.10 + 0.06 * noise(t * 6.7 + 91.2));

      // A soft ceiling and not a clamp. Clamped at 1, every flare and a good
      // many ordinary peaks land flat on the ceiling and sit there, which is a
      // light with no top end at all. This bends the top over instead, matching
      // value and slope at the knee and asymptoting above it, so a flare comes
      // out as a peak with a shape on it.
      const KNEE = 0.90;
      const raw = 0.912 + tremble + wander + flare - dip;
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      const at = (range) => range.min + (range.max - range.min) * level;

      // A guttering flame reddens as it drops and a flaring one goes whiter, so
      // the colour rides the same value. Levered about the level's own mean
      // rather than fed the level straight, because the level lives in the top
      // eighth of its range: fed straight through, ember is reachable only in a
      // gutter deep enough to have put the lamp out.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));

      lamp.intensity = at(LAMP) * lightGain;
      lamp.color.copy(EMBER).lerp(FLAME, hue);

      coreMat.color.copy(CORE_EMBER).lerp(CORE_FLAME, hue).multiplyScalar(at(CORE));
      haloMat.color.copy(CORE_EMBER).lerp(CORE_FLAME, hue * 0.6);
      haloMat.opacity = at(HALO);
      glassUniforms.uInner.value = at(WASH);
      glassUniforms.uInnerCol.value.copy(EMBER).lerp(FLAME, hue);

      // The flame is an object and it moves, which is the half of the effect no
      // amount of modulating intensity can reach: moving the source slides the
      // pool on the floor, changes which side of the chimney is brightest and
      // swings the burner's own shadow across the glass. Small, because this
      // flame is inside a chimney in a draught that is going one way: a
      // millimetre or two is the whole budget, and it leans from the wick
      // rather than sliding rigidly, so the tip travels several times as far as
      // the base does.
      const across = 0.0028 * (0.55 * swing(0.78, 5.5) + 0.45 * wobble(5.1, 0.5, 71.6));
      const into = 0.0024 * swing(0.57, 2.7);
      const rise = 0.0018 * swing(1.2, 8.1) + 0.010 * flare - 0.008 * dip;
      const stretch = 0.86 + 0.30 * level;

      core.position.set(coreHome.x + across, coreHome.y + rise * 0.4, coreHome.z + into);
      // Thin across the flat wick and full the other way, and it breathes on
      // the wide axis only, the way a flat flame does.
      core.scale.set(0.94 + 0.12 * level, stretch, 0.50);
      core.rotation.set(into * 6.0, 0, -across * 6.0);
      halo.position.set(haloHome.x + across * 1.4, haloHome.y + rise * 0.4, haloHome.z + into * 1.4);
      halo.scale.set(0.92 + 0.18 * level, 0.84 + 0.32 * level, 0.56);
      halo.rotation.copy(core.rotation);
      lamp.position.set(lampHome.x + across * 2.0, lampHome.y + rise, lampHome.z + into * 2.0);

      group.userData.flame.level = level;
    },

    dispose() {
      for (const d of disposables) d.dispose();
      patch.userData.dispose?.();
      lamp.dispose?.();
      group.clear();
    },
  };
}

export default createHurricaneLamp;
