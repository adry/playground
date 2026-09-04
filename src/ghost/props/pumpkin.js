import * as THREE from 'three';
import { toyMaterial, PALETTE, SEGMENTS } from './style.js';

// A squat ribbed jack-o'-lantern in the house vinyl-toy style: smooth lobes, a
// curved tapering stem, and a carved face that glows from inside.
//
// Everything curved here is generated parametrically rather than assembled from
// primitives, for one reason: the ribs. A lathe or a scaled sphere cannot make
// a lobed silhouette, and a low-segment lobed silhouette reads as faceted --
// exactly the look style.js rules out. So the body is one smooth parametric
// surface, sampled densely enough that the outline never shows a straight run.
//
// The shell is opaque and real holes would need CSG, so the face is built as
// emissive patches *projected onto the same surface function* as the shell and
// pushed out along the local normal by a hair. Because they are evaluated from
// the identical math, they follow the ribs instead of floating over them.

// --- Shape constants -------------------------------------------------------
// Authored against the ghost (1.6 tall, hem near 0.2): the classic body
// measures 0.51 tall and 0.80 across, stem on top, 0.72 overall.
const BODY_R = 0.40;   // equator radius before the ribs bite into it
const BODY_H = 0.345;  // half-height of the un-dished profile
const RIB_SHARP = 1.5; // >1 narrows the groove and widens the lobe crest

// The underside is not the stem dish mirrored, and used to be. Mirrored, the
// shell's lowest point was a ring at only 36% of the body radius and the belly
// then curved outward and upward away from it, so the prop touched the floor
// very nearly at a point and the bottom of its silhouette sat 5% of its own
// height clear of the ground. That is what was being reported as a gap between
// the pumpkin and its shadow: not a shadow bug at all, and no shadow tuning can
// reach it, because the thing casting it really was hovering.
//
// So the underside runs straight down and then turns over into a flat disc, the
// way a real pumpkin's does. BASE_TURN is where the turn starts, BASE_FLAT
// where it finishes and the disc begins. Their midpoint is what sets how deep
// the disc lands, and 0.745 is the depth the old dish's lowest ring had: yBase
// comes out unchanged, so the face solve below -- authored as heights above the
// ground -- stays exactly where it was.
//
// The 0.11 between them is the fillet, and it is the number that matters. The
// silhouette's lowest point is wherever the shell first leans back at more than
// the camera's own elevation, so a long lazy fillet puts that point back up the
// flank and hands most of the gap straight back; solved against the scene
// camera the leftover height comes out as 0.22 * fillet * bodyH, dead linear.
// At 0.11 that is under a hundredth of a unit, which measures as 1.2% of the
// prop's height where the old dish measured 5.0% and is what actually reads as
// touching. Much shorter and the base turns into a rim you can see as a rim.
//
// Where the turn STARTS is per-variant (a squat one sits on a broad foot, a
// gourd on a small one under a round bulb) but the 0.11 fillet is not, and that
// is deliberate: the leftover height works out as 0.22 * fillet * bodyH and the
// prop's own height as 1.49 * bodyH, so a fixed fillet is a fixed 1.2% on every
// body. Scaling it with the variant would make the tiny one hover. Every
// variant's `base` pair below is therefore turn, turn + 0.11.
// A hair of concavity across the disc, so the prop rests on the disc's rim and
// not on its whole face. Real pumpkins are dished there anyway, and a quarter
// of a unit of geometry lying exactly coplanar with the floor is asking for
// z-fighting and shadow acne in the one place the eye is looking.
const BASE_CUP = 0.02;

// The face looks along +x+z so it meets the preview/game camera square-on at
// spin 0; the lobe crest sits at the same angle so the face lands on a bulge.
//
// Exported because anything that wants to aim a pumpkin at something needs it:
// a group rotated by `y` has its face pointing along yaw FACE_YAW + y, so
// aiming at a direction d means `y = Math.atan2(d.x, d.z) - FACE_YAW`. Scenes
// were doing that with a hardcoded Math.PI / 4 and no way to notice if this
// ever moved.
export const FACE_YAW = Math.PI / 4;


// --- Body shapes -----------------------------------------------------------
// Six of them, transcribed from a reference photo of a row of carved pumpkins.
// See .ref/PUMPKIN-SHAPES.md: the photo itself did not survive, and the faces
// in it were angry slit-eyed ones we are explicitly NOT copying. What was
// wanted from it is the range of BODIES, so the carving below is the same
// carving on all six, only refitted.
//
// `classic` is the shape this file spent its whole history on and it must come
// out bit-for-bit unchanged, because three of it are already placed in the
// scene and any drift moves them. Everything a variant can change is therefore
// written so that classic's entry evaluates to the literal it replaced: the
// exponents, the base pair and the shell thickness are the old constants, the
// rib fade returns exactly 1, and the face warp is skipped entirely rather
// than run with an identity transform. Multiplying by an exact 1.0 is exact in
// IEEE; adding and subtracting a pivot is not, which is why the warp is a
// missing step rather than a neutral one.

// Half of a superellipse, as a radius over t = 0 at the widest ring to 1 at the
// pole. n near 2 is an ellipse, higher squares off the shoulder and flattens
// the pole, lower runs out toward a cone. Its slope at t = 0 is zero for any
// n > 1, which is what lets the two halves meet at the widest ring with no
// crease even when they use different exponents.
const superHalf = (n) => (t) => Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);

// A butternut neck, for the gourd. No superellipse makes this shape: what is
// wanted is a fast waist coming off the bulb, then a long near-parallel neck,
// then a quick close at the top, and the superellipse family can do any two of
// those but never the plateau in the middle. So it is built as the three
// stretches it actually is.
//
// `swell` is how much of the half is spent narrowing out of the bulb, `waist`
// the fraction of the full radius the neck then holds, and `tip` how much of
// the top is spent closing. Smoothstep for the first and a quarter circle for
// the last, so the slope is continuous at both joints and at t = 0 -- a kink at
// the widest ring shows up as a hard ring of shading right where the eye is.
const neckHalf = ({ waist, swell, tip }) => (t) => {
  const u = Math.min(1, t / swell);
  const r = waist + (1 - waist) * (1 - u * u * (3 - 2 * u));
  if (t <= 1 - tip) return r;
  const v = (t - (1 - tip)) / tip;
  return r * Math.sqrt(Math.max(0, 1 - v * v));
};

export const PUMPKIN_VARIANTS = ['classic', 'gourd', 'squat', 'tall', 'pear', 'tiny'];

// The face is authored once, in face space, against the classic body. A variant
// moves and resizes it rather than re-authoring it, and the transform is
// applied to the shape samplers -- so the hole in the shell, the wall in the
// hole, the emissive plate and the lamp's gobo all follow from one change
// instead of four sets of numbers being kept in agreement.
//
// The scaling pivot is the base of the nose, because it is a real landmark near
// the middle of the carving rather than an arbitrary height: `lift` then reads
// as "where the nose sits" and `zy` as "how tall the face is", independently.
const FACE_PIVOT = 0.3264;   // = NOSE_BASE, see the carving section below

// Two facts make the face numbers below possible to reason about at all, and
// both fall out of facePoint dividing by FACE_SX = bodyR/BODY_R and
// FACE_SY = bodyH/BODY_H before it touches the body:
//
//   * the ring a face point lands on is s = Y / BODY_H - baseDeep, which does
//     not depend on how big the body is. So `lift` and `zy` place the carving
//     on the profile in the same units whatever the variant's proportions.
//   * its half-width on the body is X * zx * bodyR / BODY_R, with the local
//     profile radius cancelling out. So `zx` is a plain width multiplier.
//
// Which means the face keeps the aspect ratio it was drawn at when
// zx/zy = (bodyH/BODY_H) / (bodyR/BODY_R). The narrow variants are held a
// little under that on purpose -- a grin that wraps much past 40 degrees a side
// starts curving away from the camera at the ends and stops reading as a grin.

const VARIANTS = {
  // 1. Classic large. Wide, round, clearly ribbed, flattened top and bottom.
  // Every number here is the constant it replaced.
  classic: {
    bodyR: BODY_R, bodyH: BODY_H,
    // Nearer 2 is nearer a true ellipsoid. The earlier 2.5 squared off the
    // shoulders and flattened the poles, which is what read as not round enough.
    eq: 0, top: superHalf(2.08), botN: 2.08,
    dip: 0.26,          // how hard the TOP pole is pulled in, making the stem dish
    base: [0.69, 0.80],
    lobes: [9, 3],      // 9..11
    // Shallower grooves: deep ones cut the round silhouette into a gear.
    rib: [0.085, 0.025], ribTop: 1, ribFrom: 0,
    shellT: 0.028,
    face: { zx: 1, zy: 1, lift: 0 },
    flameY: 1.25,
    stem: { girth: 1, length: 1 },
  },

  // 2. Tall gourd. A butternut: narrow shoulders swelling into a heavy rounded
  // base, about 1.5 tall to 1 wide. Ribs shallow, almost smooth on the neck.
  //
  // This is the variant the face has to be told about. Left where classic wears
  // it the eyes land near s = 0.68, which on this profile is a third of the way
  // up the neck, and the carving comes out on the stalk with the bulb blank
  // underneath. The whole face is dropped onto the bulb instead and squashed
  // to fit between the base turn and the waist: it now runs s -0.59 to +0.02,
  // two thirds of the range classic's wears, with the widest ring at -0.36
  // sitting through the middle of it.
  gourd: {
    bodyR: 0.240, bodyH: 0.400,
    eq: -0.36,          // widest ring low down, where the bulb is
    top: neckHalf({ waist: 0.42, swell: 0.55, tip: 0.22 }), botN: 2.20,
    dip: 0.10,          // a neck ends in a small round top, not in a dish
    base: [0.80, 0.91],
    lobes: [9, 3],
    rib: [0.055, 0.020], ribTop: 0.22, ribFrom: -0.30,
    shellT: 0.0168,     // 7% of its own body radius, as classic's is
    face: { zx: 1.20, zy: 0.66, lift: -0.128 },
    flameY: 0.662,
    stem: { girth: 0.80, length: 1.9 },
  },

  // 3. Squat wide. Lower and wider than the classic, strongly ribbed, the ribs
  // deep enough to scallop the silhouette.
  //
  // The transcription says 0.62 tall to 1 wide, and that is the one number in
  // it that cannot be taken at face value: the classic already measures 0.657,
  // so 0.62 would be a 5% difference described as "lower and wider". The
  // relationship is the reliable half of the description, so this goes to 0.53
  // where the difference is legible standing next to the classic.
  squat: {
    bodyR: 0.450, bodyH: 0.324,
    eq: 0, top: superHalf(2.40), botN: 2.40,   // squarer shoulders read as squashed
    dip: 0.30,
    base: [0.66, 0.77],   // broad foot; it is the one that looks planted
    lobes: [10, 3],
    rib: [0.140, 0.035], ribTop: 1, ribFrom: 0,
    // The one variant where 7% of the body radius is the wrong rule. What
    // actually has to survive is the grin's band against the wall's depth, and
    // that ratio is 1.23 * bodyH / bodyR -- so the flatter the pumpkin the
    // worse it gets, and 7% of this radius came out at 2.4 band-heights where
    // classic has 3.1. Rendered, the near lip ate the channel and the middle of
    // the grin closed into a wavy line with the teeth gone. 0.0255 is 5.7% of
    // the radius and puts it back to 3.2.
    shellT: 0.0255,
    face: { zx: 1.12, zy: 1.02, lift: -0.005 },
    flameY: 1.282,
    stem: { girth: 1.10, length: 0.95 },
  },

  // 4. Tall round. Nearly spherical, a touch taller than wide, ribs moderate --
  // a big heavy specimen rather than a squashed one.
  tall: {
    bodyR: 0.355, bodyH: 0.432,
    eq: 0.02,           // the mass a hair above centre, which is what "heavy" is not
    // A true ellipse both halves and only 1.02 tall to 1 wide. 1.09 was tried
    // and it read as a barrel: past about 1.05 the ellipse's flanks are long
    // enough that the ribs run down them as parallel lines and the silhouette
    // stops being a sphere with a face on it.
    top: superHalf(2.00), botN: 2.00,
    dip: 0.20,
    base: [0.77, 0.88],
    lobes: [10, 3],
    rib: [0.080, 0.025], ribTop: 1, ribFrom: 0,
    shellT: 0.0249,
    // Its s range is classic's, but its bodyH is a quarter larger, so the face
    // has to be shortened or it comes out stretched down the belly.
    face: { zx: 1, zy: 0.90, lift: 0.005 },
    flameY: 1.146,
    stem: { girth: 1.05, length: 1.05 },
  },

  // 5. Pear. Narrow at the top, widest well below the middle, soft shoulder.
  // Taller than wide but nowhere near the gourd. No neck: the top is a plain
  // low-exponent superellipse, which runs out toward a cone and is exactly the
  // soft shoulder wanted.
  pear: {
    bodyR: 0.270, bodyH: 0.378,
    // The exponent is the whole variant and the window is narrow: 1.45 came
    // out a cone with a straight sloping shoulder, 1.90 an egg with the mass
    // back in the middle, and 1.62 over a 2.30 bottom still read as a tall egg
    // because the lower half fell away too early to be a bulb. 1.55 over 2.40
    // -- a fuller, squarer bottom under a softer taper -- with the widest ring
    // more than a third of the way down is the one that reads as a pear.
    eq: -0.36,
    top: superHalf(1.55), botN: 2.40,
    dip: 0.14,
    base: [0.83, 0.94],
    lobes: [9, 3],
    rib: [0.070, 0.020], ribTop: 0.55, ribFrom: -0.05,
    shellT: 0.0189,
    face: { zx: 1.08, zy: 0.80, lift: -0.075 },
    flameY: 0.810,
    stem: { girth: 0.85, length: 1.6 },
  },

  // 6. Tiny. A small squat one, proportionally deeper ribs and a proportionally
  // fatter stem, about a third the height of the classic.
  //
  // The two numbers that are not just classic scaled down are the face and the
  // shell. Everything else in this file is scale-invariant -- the grid cell,
  // the skirt and the wall are all in face space or in fractions of bodyR -- so
  // a pure shrink works geometrically and still fails, because at scene scale
  // this thing is thirty pixels tall and a proportional face is three pixels
  // of it.
  //
  // So the carving is opened out to fill most of the front. Nearly all of that
  // has to come from the width: 1.30 in Y was tried first and it is more than
  // the body has to give. The face's ring is s = Y/BODY_H - baseDeep whatever
  // the variant, so stretching Y walks the eyes straight up the profile, and
  // at 1.30 their apexes came out at s = 0.82 -- inside the stem dish, where
  // the outline has to cross rings that are pinching shut and the cut tore into
  // streaks running up to the stalk. 1.25 across by 1.10 up, dropped 0.02 to
  // put the apexes back at classic's s = 0.67, is what the body will take.
  //
  // The shell is then thinned to 5.5% of the body radius rather than 7%, which
  // leaves the grin's band 4.0 wall-thicknesses tall against classic's 3.1.
  // That is what buys the third tooth: budgeted for losing the two upper ones
  // -- a lost tooth being cheaper than a mouth that mushes shut -- and in the
  // event the band was deep enough that all three survive three quarters.
  tiny: {
    bodyR: 0.155, bodyH: 0.125,
    eq: 0, top: superHalf(2.30), botN: 2.30,
    dip: 0.28,
    base: [0.66, 0.77],
    lobes: [8, 2],      // 8..9: fewer lobes, so each one is a bigger event
    rib: [0.150, 0.035], ribTop: 1, ribFrom: 0,
    shellT: 0.0085,
    face: { zx: 1.25, zy: 1.10, lift: -0.020 },
    flameY: 1.222,
    stem: { girth: 1.55, length: 0.95 },
  },
};

// Tessellation. SEGMENTS is sized for plain round surfaces; a lobed one needs
// several times that many steps around, or the grooves stair-step, so the
// counts here scale the house numbers up rather than reusing them blind.
const RINGS = SEGMENTS.height * 4;

// What the lamp, the carving and its bloom look like at the bottom and the top
// of the flicker's swing. All three are driven off the one value, which is what
// makes the light and the face read as the same flame.
// A candle does not swing three to one. The old 1.05..3.10 pumped the pool on
// the floor hard enough to read as a light being turned up and down; this holds
// the same 2.15:1 the rest of the flicker was tuned to and is still plainly
// alive at the far end of the swing.
//
// The absolute numbers are large because the lamp no longer throws a solid
// cone: the gobo below is black over most of the cone and only the carved
// shapes reach 1, so this is the intensity at the middle of an opening rather
// than everywhere. Averaged over the pool it is close to what it always was.
// Raised 1.6x from the pass that fed the old face-space stencil, and the ratio
// between the two ends is untouched. The gobo is a real projection now: the
// light is concentrated into three beams that have to stand clear of the
// lantern's own omnidirectional glow (GLOW_LAMP, further down) rather than
// being most of what is on the floor. At the old level the beams were legible
// with the glow off and a smooth wash with it on.
const LAMP = { min: 6.40, max: 13.80 };    // SpotLight intensity
// Brought down hard, and this is the fix the report was actually asking for.
// At 1.18..1.82 the plate tone-mapped to a flat #f3e0aa -- 95% luminance,
// brighter than anything else in frame -- and the cut wall built at such
// expense beside it could not be seen against that at all: no shaded ceiling,
// no lit lower lip, no wall thickness, just one bright shape with a hard edge.
// Down here the openings are a warm butter that falls off, the wall reads, and
// the depth of every cut comes back. Multiplied by the per-vertex falloff the
// plate carries, so this is the value at the brightest point of the face only.
// The bottom end sits well below anything the flicker reaches in normal
// running: it is there so a gutter has somewhere to go, not to be sat at.
const GLOW = { min: 0.45, max: 1.58 };     // face emissiveIntensity
// The cuts are real holes with a real wall now, so what used to be a painted
// bloom on the skin is instead a faint emissive on that wall: the flame washing
// the inside of the opening. Kept low, because the hemisphere light is what
// gives the cut its shape -- ceiling dark, lower lip catching the sky -- and a
// strong emissive would flatten exactly that.
const WASH = { min: 0.05, max: 0.15 };      // flame washing the inside of the cuts

// The skin around every cut, lit from behind through the wall. Held low on
// purpose: past about a third the shell stops being a pumpkin with light
// inside it and becomes a paper lantern, and the falloff that carries it is
// only a couple of centimetres wide, so a little of this goes a long way.
const SKIN_GLOW = { min: 0.09, max: 0.26 };
// Not the palette's glow. Two centimetres of orange flesh takes the blue out
// first and the green next, so what comes through is closer to an ember than
// to the flame behind it.
const SKIN_EMBER = '#e83c06';

// The flame's two ends: a dull ember at the bottom of a gutter, bright flame at
// the top of a flare.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();
// The same two ends again for the plate, and deliberately not the same values.
// These are a material's emissive, which three colour-manages on the way in,
// where the pair above are the light's colour and are converted by hand; and
// they are warmer, because the plate is the thing the eye actually judges the
// flame by. ACES desaturates as it brightens, so an emissive at the palette's
// own glow washes out to cream well before it is bright enough to read as fire.
const PLATE_EMBER = new THREE.Color('#ff7b2c');
const PLATE_FLAME = new THREE.Color('#ffb44a');
// How the two ends are mixed. The mix is levered about HUE_MID rather than
// taken straight off the flicker's level, because the level spends its life in
// the top eighth of its range: fed straight through, ember was reachable only
// in a gutter deep enough to have put the light out. HUE_MID is the measured
// mean of the level, so the resting colour is unchanged, and HUE_GAIN then says
// how much harder than the brightness the colour swings. At 1.5 the mix
// saturates at flame around level 0.96 and at ember around level 0.29, which
// are respectively the top of a flare and the floor of a real gutter.
const HUE_MID = 0.88, HUE_GAIN = 1.5;

// The skin, which is the palette's pair taken down a little before it is used.
//
// The report was that the orange was too bright and too saturated, and it is
// not wrong: the palette's #ffb268 measures as a FULLY saturated orange at 70%
// lightness -- S = 1.000 to three figures -- which is why it can read as a
// traffic cone beside a cool grey floor and pale stone. But the ask was for "a
// bit" and for "nicer", and the first attempt at it was a rout. Read the second
// paragraph before touching these numbers.
//
// Done here and not in style.js because it is a change to this prop rather than
// to the house palette, and pumpkinSkin/pumpkinShade have no other reader in
// the tree: the palette entry stays what the family was authored against, and
// this file says what the pumpkin does with it.
//
// HOW FAR: 0.90 of the chroma and 0.97 of the value, which is a very small
// move, and small is the finding rather than a failure of nerve. It was first
// taken to 0.70 / 0.88 and that was rejected outright -- "way too dark, maybe
// it was better before". Beside pale stone and a white ghost it had gone from
// pumpkin to terracotta plant pot. Anything past about 0.85 chroma reads as a
// different object rather than as the same object calmer, and it is worth
// knowing why the room for manoeuvre is so small: the pair also goes through
// convertSRGBToLinear below, which under three's ColorManagement is the SECOND
// such decode, so every cut made here is compounded by one already in place.
// out/pumpkin-work/scene-tint.png is 1.00, 0.96, 0.90 and 0.70 in the lab
// scene, and mix-tint.png the same four next to a tombstone, which is where the
// bottom one is obviously wrong and the top three are obviously close.
//
// HOW: a mix toward the colour's own luminance and then a scale, not an HSL
// edit, and that is not a stylistic preference. Pulled down in HSL the pair
// came out brick red at every setting tried -- 0.74/0.86, 0.62/0.90, 0.55/0.86
// and 0.70/0.82 all rendered as terracotta, see tint-grid.png. ACES turns a
// saturated orange toward red as it darkens and HSL's lightness axis takes the
// green channel down fastest, so the two compound. Mixing toward grey keeps
// green and blue up, which holds the hue where it was while the chroma comes
// off it.
//
// TUNE THIS BY LOOKING, IN THE SCENE, AND NOT BY PICKING A HEX. Because of the
// double decode the number in the source is not the colour on screen and never
// was. Do not "fix" that decode as part of a colour tweak either: the face and
// the glow were tuned by eye with it in place, and straightening it out moves
// far more than the skin. Judge on the lab scene, not the turntable -- an empty
// grey floor flatters a colour that goes muddy next to stone.
const SKIN_CHROMA = 0.90, SKIN_VALUE = 0.97;
const skinTone = (hex) => {
  const c = new THREE.Color(hex);
  // Worked in sRGB, the space the palette was authored in, so the conversion
  // that follows is left exactly as it was.
  const r = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const lum = 0.2126 * r.r + 0.7152 * r.g + 0.0722 * r.b;
  const mix = (v) => (lum + (v - lum) * SKIN_CHROMA) * SKIN_VALUE;
  return c.setRGB(mix(r.r), mix(r.g), mix(r.b), THREE.SRGBColorSpace);
};

// Small deterministic PRNG: same seed, same pumpkin, and nothing at module scope.
function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Smooth 1D value noise. Layered at a few rates it gives the light its slow
// wander and its rare events: white noise reads as a failing bulb, a bare sine
// reads as a pulse. What it cannot give is the fine tremble, and the reason is
// visible in the interpolation below: smoothstep is flat at every lattice node,
// so a channel at f Hz stands still f times a second. See update() for what
// carries the tremble instead.
function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f); // smoothstep, so the derivative is continuous
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

export function createPumpkin({ variant = 'classic', seed = 1, scale = 1 } = {}) {
  const V = VARIANTS[variant] || VARIANTS.classic;
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: these are the same toy, not different ones.
  // The draws are made in the same order and from the same ranges whatever the
  // variant, so a seed picks out the same point in each family's spread. The
  // stem's direction and the flame's phase are deliberately NOT drawn from this
  // stream, for the reason set out at `vrand` below.
  const lobes = V.lobes[0] + Math.floor(rand() * V.lobes[1]);
  const ribDepth = V.rib[0] + rand() * V.rib[1];
  const bodyR = V.bodyR * (0.96 + rand() * 0.08);
  const bodyH = V.bodyH * (0.96 + rand() * 0.08);
  // How big this variant is beside the classic, taken from the variant's own
  // nominal radius rather than the seeded one, so it is exactly 1 for classic.
  // The lamp's reach and the stem's build are hung off it.
  const sizeK = V.bodyR / BODY_R;
  // A second stream, with the shape's name mixed into it.
  //
  // Everything about the BODY is drawn from `rand` above, and for a given seed
  // it is deliberately the same point in every variant's own spread: that is
  // what makes the six comparable when they are laid out together. Two things
  // here are not about the body, and were coming out repeated for exactly that
  // reason. Rendered as a row -- which is how this set is actually looked at --
  // six bodies built from one seed wore six copies of one stalk and flickered
  // in lockstep. So the stem's direction and the flame's phase come off a
  // stream the name is folded into instead. Hashed off the name rather than the
  // position in PUMPKIN_VARIANTS, so inserting a seventh shape does not respin
  // the six that already exist.
  const nameHash = [...(VARIANTS[variant] ? variant : 'classic')]
    .reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const vrand = makeRng((Math.imul(seed | 0, 374761393) + nameHash) | 0);

  // Stem direction. Four seeded numbers, where there used to be one and a coin
  // flip, and the change is a deliberate reversal of what was here.
  //
  // The old rule was that the stem leans relative to the *face* rather than to
  // world axes, so the bend would read from whatever angle the face was being
  // seen from. That reasoning is sound and it is also what made every pumpkin
  // in the set carry the same stem: with the lean pinned at 0.38..0.54 of a
  // turn either side of a face direction that is itself fixed at FACE_YAW, the
  // whole family only ever had two narrow bands to choose between, twenty-nine
  // degrees wide each, and a row rendered at one seed came out as six copies of
  // one stem. Face-relative was never the point -- what the point was is that
  // the stem should not habitually lean straight at the camera and sit over the
  // carving, and that survives here as a preference rather than as a rule.
  //
  // So the azimuth is drawn over the whole circle and then warped away from the
  // face. `a + k sin a` with k < 1 is monotonic, so every direction is still
  // reachable, and it stretches the angles near the face apart while packing
  // the ones behind it together: the density comes out as 1/(1 + k cos a),
  // which at k = 0.45 is about two and a half times likelier to lean away from
  // the face than toward it. A gentle thumb on the scale, not a fence.
  const STEM_AWAY = 0.45;
  const aRaw = (vrand() * 2 - 1) * Math.PI;                  // from the face direction
  const aStem = aRaw + STEM_AWAY * Math.sin(aRaw);
  // How far off vertical the stem finishes, and how much of that it starts
  // with. The spine turns linearly in arc length from `stemRoot` at the crown
  // to `stemTip` at the end, so the two together are lean and curl: equal and
  // it is a straight stalk at an angle, root near zero and it is a bow, and a
  // root of the opposite sign is a stem that leaves the crown leaning one way
  // and curls back the other, which is the hook a real stalk often has. Tip is
  // capped short of horizontal so no stem can curl back down into the shell.
  const stemTip = (0.20 + vrand() * 0.68) * (Math.PI / 2);   // 18..79 degrees
  const stemRoot = stemTip * (-0.40 + vrand() * 0.78);
  // How high the crown of the stem reaches, as the fraction of stemL the fixed
  // spine used to reach. Seeded only a little: this is the one thing about the
  // stem that reads as the pumpkin being bigger rather than as its stalk being
  // different, and the variant's own `length` is what is supposed to say it.
  const stemRise = 0.207 * (0.90 + vrand() * 0.26);
  // Where it sits on the crown, in fractions of the body radius and along the
  // lean. Real stalks are not centred, and one that starts off-centre on the
  // near side and reaches over reads differently from one that starts on the
  // far side, so the small negative end of the range is wanted.
  const stemOff = -0.02 + vrand() * 0.11;
  const flickerPhase = vrand() * 100;

  // --- The body surface ----------------------------------------------------
  // s runs -1 (bottom pole) .. +1 (top pole); a is the angle around, measured
  // from the middle of the front lobe.

  // The profile is two halves meeting at the widest ring, which for most of the
  // family sits at s = 0 but on the gourd and the pear is pushed well down. Each
  // half is measured in its own t: 0 at that ring, 1 at its pole. Both halves
  // have zero slope at t = 0, so they meet smoothly however different they are.
  // With EQ = 0 and both halves the same superellipse this is the plain
  // symmetric profile the classic body has always had, term for term.
  const EQ = V.eq;
  const botHalf = superHalf(V.botN);
  const profileR = (s) => (s >= EQ ? V.top((s - EQ) / (1 - EQ)) : botHalf((EQ - s) / (1 + EQ)));

  // Top: pull the last stretch of the pole back toward the centre so the stem
  // sits in a shallow dish, the way a pumpkin does. Bottom: see BASE_TURN --
  // it turns over onto a flat disc instead.
  const DIP = V.dip;
  const BASE_TURN = V.base[0];
  const BASE_FLAT = V.base[1];
  const BASE_L = BASE_FLAT - BASE_TURN;
  const BASE_DEEP = BASE_TURN + BASE_L * 0.5;   // where the disc lands, in bodyH
  const profileY = (s) => {
    if (s >= 0) {
      const t = Math.max(0, (s - 0.55) / 0.45);
      return bodyH * (s - DIP * t * t);
    }
    const x = -s;
    if (x <= BASE_TURN) return -bodyH * x;
    if (x >= BASE_FLAT) {
      const u = (x - BASE_FLAT) / (1 - BASE_FLAT);
      return -bodyH * (BASE_DEEP - BASE_CUP * u * u);
    }
    // Smoothstep the *slope* from 1 to 0 rather than the height, so the flat
    // really is flat and the turn has no curvature step at either end of it.
    // This is the integral of 1 - smoothstep(t); at t = 1 it has descended
    // exactly half the fillet's length, which is where BASE_DEEP comes from.
    const t = (x - BASE_TURN) / BASE_L;
    return -bodyH * (BASE_TURN + BASE_L * (t - t * t * t + 0.5 * t * t * t * t));
  };

  // How much of the groove survives at a given height. Flat 1 on the round
  // bodies, which is the shape this has always been; the gourd and the pear
  // fade theirs out toward the top, because a butternut's neck is smooth and
  // ribs run up a pear's shoulder only faintly. It multiplies the depth rather
  // than the radius so the crest stays put and only the groove shallows out --
  // fading the radius instead swells the whole neck as the ribs go.
  const ribAt = V.ribTop === 1
    ? () => 1
    : (s) => {
      const u = Math.min(1, Math.max(0, (s - V.ribFrom) / (1 - V.ribFrom)));
      return 1 + (V.ribTop - 1) * u * u * (3 - 2 * u);
    };

  // Grooves, deepest at a = ±pi/lobes, zero at the crest so the front lobe is a
  // clean bulge for the face to sit on.
  const rib = (a, s) => 1 - ribDepth * ribAt(s) * Math.pow(0.5 - 0.5 * Math.cos(lobes * a), RIB_SHARP);

  // The lowest point of the shell is the base disc's rim, not the pole -- the
  // disc is cupped. Find it numerically and stand the prop on it, so y = 0 is
  // the ground and the contact is a wide ring rather than a point.
  let lowest = Infinity;
  for (let i = 0; i <= 400; i++) lowest = Math.min(lowest, profileY(-1 + (2 * i) / 400));
  const yBase = -lowest;

  const surface = (a, s, target) => {
    const r = bodyR * profileR(s) * rib(a, s);
    const u = a + FACE_YAW;
    return target.set(r * Math.sin(u), profileY(s) + yBase, r * Math.cos(u));
  };

  // Numeric normal. Cross(d/da, d/ds) points outward for this parameterisation
  // (checked at the equator), which also fixes the triangle winding below.
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const surfaceNormal = (a, s, target) => {
    const e = 2e-3;
    const sc = Math.min(0.999, Math.max(-0.999, s));
    surface(a + e, sc, tmpA).sub(surface(a - e, sc, tmpB));
    surface(a, Math.min(0.999, sc + e), tmpC).sub(surface(a, Math.max(-0.999, sc - e), tmpD));
    return target.crossVectors(tmpA, tmpC).normalize();
  };


  // --- Mapping face coordinates onto the shell -----------------------------
  // Face shapes are authored in (X across the surface, Y height above ground)
  // so they keep their proportions; this inverts the profile to get back to s.
  // S_HI runs well past the widest part of the body on purpose: the reference's
  // eyes sit high enough that their apexes land near s = 0.67, and a table that
  // stopped at the shoulder would clamp them onto the crown.
  // S_HI also has to stay below the crown, where the dish turns the profile
  // back down and the table stops being monotonic (the binary search below
  // needs it to be). The dish's turning point is at 0.55 + 0.10125 / DIP, which
  // for classic's 0.26 is 0.94 and never binds; a deeper dish would, and this
  // is what stops a variant quietly getting a face solved against a table that
  // runs backwards at its top end.
  const S_LO = -0.78, S_N = 512;
  const S_HI = Math.min(0.86, 0.53 + 0.10125 / DIP);
  const yTable = new Float32Array(S_N + 1);
  for (let i = 0; i <= S_N; i++) yTable[i] = profileY(S_LO + ((S_HI - S_LO) * i) / S_N) + yBase;
  const sOfY = (y) => {
    let lo = 0, hi = S_N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (yTable[mid] < y) lo = mid; else hi = mid;
    }
    const span = yTable[hi] - yTable[lo] || 1;
    const f = (y - yTable[lo]) / span;
    return S_LO + ((S_HI - S_LO) * (lo + f)) / S_N;
  };

  // The glowing interior sits at the BOTTOM of the cut, one shell thickness in,
  // not on the skin. Laid on the skin it was a sticker: at three quarters the
  // glow met the outer surface with nothing in between, and no amount of
  // shading on a coplanar patch fixes that. SHELL_T is what the wall built
  // below spans, so plate and wall meet exactly.
  // 7% of the body radius. The reference reads thicker, nearer a tenth, but the
  // grin is only 0.086 tall from lip to lip and a wall that deep swallowed it:
  // seen from three quarters the near lip occluded more than the whole band and
  // the mouth broke into fragments. This is as thick as the thinnest feature on
  // the face can carry.
  //
  // Every variant keeps that 7% of its own radius except `tiny`, which is at
  // 5.5% -- see its entry. The rest of the wall's numbers were solved against
  // 0.028 and are held in proportion to it by WALL_K rather than re-solved: the
  // lip, the taper and the collar are all fractions of the wall's depth, and
  // an absolute collar deeper than a thin shell would put the plug's roof out
  // through the front of the pumpkin. WALL_K is exactly 1 for classic.
  const SHELL_T = V.shellT;
  const WALL_K = SHELL_T / 0.028;
  // A hair below the bottom of the wall rather than exactly level with it.
  // Level, the plate and the wall's inner ring are coplanar and their shared
  // edge speckles.
  const PLATE = SHELL_T + 0.0012 * WALL_K;
  const WALL_TAPER = 0.005 * WALL_K; // how much narrower the cut is at its bottom
  // The wall's top ring laps this far back over the skin, a hair proud of it,
  // rather than meeting the hole edge exactly. Meeting exactly is correct and
  // fragile: at three quarters the far eye, seen nearly edge on, opened a crack
  // of daylight at its sharpest corner. Lapping the joint shuts that for good,
  // and the sliver of darker wall it leaves on the skin reads as the lip of the
  // cut, which the reference has anyway.
  const WALL_LIP = 0.007 * WALL_K, WALL_PROUD = 0.0006 * WALL_K;
  // The seed rescales the shell a few percent in each axis, so the face has to
  // ride that scale instead of sitting at fixed heights. Authored absolutely,
  // the eyes -- which sit high on the shoulder -- ran off the crown of a
  // small-seeded body and got clamped. Scaling X keeps the same angle round the
  // body, scaling Y the same fraction of its height, so every seed wears the
  // same face.
  const FACE_SX = bodyR / BODY_R;
  const FACE_SY = bodyH / BODY_H;
  const facePoint = (X, Y, lift, target) => {
    const s = sOfY(Y * FACE_SY);
    // Angular mapping uses the un-ribbed radius, so the face is not stretched
    // and squeezed as it crosses the grooves -- it just drapes over them.
    const a = (X * FACE_SX) / Math.max(0.05, bodyR * profileR(s));
    surface(a, s, target);
    surfaceNormal(a, s, tmpN);
    return target.addScaledVector(tmpN, lift);
  };

  // Where the flame sits inside the shell. It is what the emissive plate's
  // per-vertex falloff is measured from, and the projector further down takes
  // its HEIGHT from here and stands on the axis at that height -- see LAMP_AT
  // for why it cannot simply sit at this point as well. So what the openings
  // show and what the floor is lit by are still one flame at one height rather
  // than two sources that happen to agree.
  // Its height is a multiple of yBase, one per variant, and each was picked so
  // the lamp sits a hair below the middle of that variant's carving -- which on
  // classic is what 1.25 already worked out to. It cannot just be a fixed
  // multiple: the gourd's face is dropped onto the bulb, and a lamp left at
  // 1.25 there would be parked up inside the neck with the carving below it.
  const faceDir = new THREE.Vector3(Math.sin(FACE_YAW), 0, Math.cos(FACE_YAW));
  // The same frame's other axis, along the face rather than out of it. The
  // flame's sway is resolved in these two so a sideways lean stays sideways
  // whatever FACE_YAW is set to.
  const faceTan = new THREE.Vector3(Math.cos(FACE_YAW), 0, -Math.sin(FACE_YAW));
  const FLAME_AT = new THREE.Vector3(faceDir.x * bodyR * 0.50, yBase * V.flameY, faceDir.z * bodyR * 0.50);

  // How much of the flame reaches the plate at a point on it.
  //
  // The plate is not a lamp in its own right: it is the bottom of a hole with a
  // flame behind it, so what the eye reads there is the flame lighting the BACK
  // of the plug. Flat emissive gave every opening the same value to four
  // figures -- measured off the render, the far corner of an eye and the middle
  // of the grin came out the identical pixel -- and that is what read as one
  // bright shape instead of a lit cavity. So it falls off with distance, and
  // far more visibly with how square the opening is to the flame: the apex of
  // each eye is up on the shoulder and tipped away from a flame sitting below
  // it, and goes deep amber, while the middle of the grin faces it square on
  // and stays pale. Which is the reference's face exactly.
  const tmpP = new THREE.Vector3();
  const tmpL = new THREE.Vector3();
  const tmpFn = new THREE.Vector3();
  const flameAt = (X, Y) => {
    const s = sOfY(Y * FACE_SY);
    const a = (X * FACE_SX) / Math.max(0.05, bodyR * profileR(s));
    surface(a, s, tmpP);
    surfaceNormal(a, s, tmpFn);
    tmpP.addScaledVector(tmpFn, -PLATE);
    tmpL.copy(FLAME_AT).sub(tmpP);
    const d = Math.max(0.02, tmpL.length());
    // Lambert against the INWARD normal: the flame is behind this surface.
    const cos = Math.max(0, -tmpFn.dot(tmpL) / d);
    return cos / (d * d);
  };

  // Builds one geometry from a list of patches, each a 2D sampler over the unit
  // square projected onto the shell. Everything is a grid so the tessellation
  // stays dense and evenly shaped; triangles are authored as degenerate grids
  // (the base edge collapsed to a point at v = 1).
  const patchGeometry = (defs, lift, glowOut) => {
    const verts = [];
    const idx = [];
    const p = new THREE.Vector3();
    let base = 0;
    for (const { nx, ny, sampler } of defs) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const [X, Y] = sampler(i / nx, j / ny);
          facePoint(X, Y, lift, p);
          verts.push(p.x, p.y, p.z);
          if (glowOut) glowOut.push(flameAt(X, Y));
        }
      }
      const vi = (i, j) => base + j * (nx + 1) + i;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          idx.push(vi(i, j), vi(i + 1, j), vi(i, j + 1), vi(i + 1, j), vi(i + 1, j + 1), vi(i, j + 1));
        }
      }
      base += (nx + 1) * (ny + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Triangle: base edge at v = 0, collapsing to the apex at v = 1.
  const triSampler = (ax, ay, blx, bly, brx, bry) => (u, v) => [
    (blx + (brx - blx) * u) * (1 - v) + ax * v,
    (bly + (bry - bly) * u) * (1 - v) + ay * v,
  ];

  // Refits the carving onto this variant's body: widen or narrow it about the
  // face's own axis, shorten or stretch it about the nose, then slide it up or
  // down the profile. Applied to the samplers and nowhere else, because every
  // other piece of face machinery in this file -- the hole cut in the shell,
  // the wall in the hole, the emissive plate, the lamp's gobo -- is walked off
  // those same samplers, so warping them warps all four in step.
  //
  // Classic gets the samplers back untouched rather than run through an
  // identity transform. `pivot + (Y - pivot)` is not exactly Y in floating
  // point, and a face that lands a few ulps off the one this file was tuned
  // against is a face whose quads can fall on the other side of a cut test.
  const FW = V.face;
  const refit = (FW.zx === 1 && FW.zy === 1 && FW.lift === 0)
    ? (sampler) => sampler
    : (sampler) => (u, v) => {
      const q = sampler(u, v);
      return [q[0] * FW.zx, FACE_PIVOT + (q[1] - FACE_PIVOT) * FW.zy + FW.lift];
    };

  // --- The carved face -------------------------------------------------------
  // These numbers are solved off .ref/ref-pumpkin.png, not eyeballed. Each
  // landmark in the photo was measured in pixels, both pumpkins were pinned to
  // their own silhouette (axis, widest row, width) so the two could be laid over
  // each other, and every point was then run back through this camera to find
  // the (X, Y) on this shell that lands on it. Two earlier passes were laid out
  // by feel and both came out with the same tell: a face that had slid down the
  // belly. On the reference the eyes are up on the shoulder, near s = 0.67, and
  // the mouth's corners sit only a little below the equator.
  //
  // Everything below is authored against the nominal BODY_R / BODY_H; facePoint
  // rescales it onto whatever body the seed actually built.

  // Eyes. Tilted triangles, not the level symmetric ones we had: on the
  // reference each base slopes down toward the nose by about 15 degrees, and
  // measured along that tilted base the apex sits a quarter of the way out
  // toward the outer corner rather than over the middle. That lean is most of
  // what stops them reading as a pair of tents. They are also set wide: the
  // outer corner reaches a good deal further round the body than the inner one.
  // Grown 4% from the first solve, applied as a uniform scale about the
  // triangle's own centroid so the tilt, which was right, is untouched.
  const EYE = {
    apexX: 0.1390, apexY: 0.4831,   // apex, high on the shoulder
    outX: 0.2026, outY: 0.4042,     // outer base corner, the high end of the base
    inX: 0.0969, inY: 0.3774,       // inner base corner, dropped toward the nose
  };
  const eye = (dir) => triSampler(
    EYE.apexX * dir, EYE.apexY,
    EYE.outX * dir, EYE.outY,
    EYE.inX * dir, EYE.inY,
  );

  // Nose: an apex-up triangle a little under half an eye by area. Widened and
  // dropped from the first solve: on the reference the gap from its base to the
  // top of the grin measures about three quarters of what we had, so the nose
  // hangs closer to the mouth than to the eyes.
  // NOSE_BASE is also FACE_PIVOT, the height a variant's refit scales about.
  const NOSE_W = 0.0400, NOSE_TIP = 0.3895, NOSE_BASE = 0.3264;
  const nose = triSampler(0, NOSE_TIP, -NOSE_W, NOSE_BASE, NOSE_W, NOSE_BASE);

  // Mouth. One tall opening with teeth intruding into it, which is the whole
  // difference between a carved grin and a row of boxes. The first solve had the
  // right outline but the teeth reached nearly the full height of the band, and
  // that chopped the mouth into five disconnected cells: segment, tooth,
  // segment, tooth, segment. On the reference a continuous channel of light runs
  // the entire width behind the teeth and never closes.
  //
  // Widths and heights below are the re-measured reference: tips at dx 243 of a
  // 862px body, upper edge flat near y 635 and lower near y 705, both taken back
  // through this camera, and then opened up about a tenth. The reference's
  // chamfer is shallow where ours is a real wall a tenth of a body radius deep,
  // and that wall eats into the band from both sides; measured exactly, the
  // glow left between the lips came out thinner than the photograph's.
  const MW = 0.2300;      // half width
  const M_TOP = 0.2710;   // upper edge across the middle
  const M_BOT = 0.1735;   // lower edge across the middle
  const M_TIP = 0.2940;   // where the two edges meet, at the lifted corners
  // The lower edge is not level: on the reference it hangs about 0.009 deeper
  // halfway out than it does at the centre, which is what gives the grin its two
  // rounded lobes either side of the middle tooth. Left level, that stretch came
  // out as a straight shelf.
  const M_SAG = 0.009;
  // Both edges hold their level across the middle and then sweep up into the
  // point. The exponents are a little lower than the reference measures, which
  // starts the taper earlier: our cut is a flat plate with a hard rim where the
  // reference's is chamfered, and without that chamfer eating into the last of
  // the band our ends stopped in a blunt vertical edge instead of a point.

  // Teeth are blocks, not spikes: the little linear triangles we had before
  // merged into the grin and the whole mouth read as a W. block() is a plateau
  // with only the outermost `ramp` of each flank falling away, which gives a
  // trapezoid with shoulders you can actually see; a small ramp keeps the sides
  // near vertical, the way the reference's upper teeth are cut. Smoothstep and
  // not a straight line, so a shoulder lands as a corner rather than a
  // staircase across the sampling grid.
  const block = (d, ramp) => {
    const t = Math.min(1, Math.max(0, (1 - d) / ramp));
    return t * t * (3 - 2 * t);
  };
  // Tooth sizes are absolute, not fractions of the band: they all sit in the
  // flat middle where the band barely changes. Both are under half the band's
  // 0.086 on purpose. Measured off the reference the upper teeth bite about 40% of the
  // way down; past a half and the channel of light behind them closes, which is
  // what turned the first grin into five separate boxes.
  const TOOTH_X = 0.122, TOOTH_HW = 0.046, TOOTH_DEPTH = 0.042, TOOTH_RAMP = 0.16;
  // The lower tooth is a dome five times wider than it is tall, not the tall
  // block it was. Root rather than parabola so the top is broad and the flanks
  // land softly on the lower edge instead of cutting two square notches in it.
  const LOW_HW = 0.098, DOME_H = 0.060, LOW_ROUND = 0.55;
  // Nothing may eat more than this much of the band, so the channel survives
  // whatever the numbers above are nudged to.
  const CLEAR = 0.22;

  const mouth = (u, v) => {
    const x = -MW + 2 * MW * u;
    const q = Math.abs(x) / MW;
    const top0 = M_TOP + (M_TIP - M_TOP) * Math.pow(q, 2.4);
    const sag = Math.max(0, 1 - Math.pow((q - 0.5) / 0.5, 2));
    const bot0 = M_BOT - M_SAG * sag + (M_TIP - M_BOT) * Math.pow(q, 3.8);
    const gap = top0 - bot0;
    // Two teeth hang down from the upper edge, just inside the eyes.
    let bite = 0;
    for (const tx of [-TOOTH_X, TOOTH_X]) {
      bite += TOOTH_DEPTH * block(Math.abs(x - tx) / TOOTH_HW, TOOTH_RAMP);
    }
    // One broad tooth rises from the lower edge in the middle.
    const dLow = Math.min(1, Math.abs(x) / LOW_HW);
    const grow = DOME_H * Math.pow(1 - dLow * dLow, LOW_ROUND);
    const room = Math.max(0, gap * (1 - CLEAR));
    const top = top0 - Math.min(bite, room);
    const bottom = bot0 + Math.min(grow, room);
    return [x, top + (bottom - top) * v];
  };

  // The mouth needs the samples: at 96 across, a tooth flank fell inside a
  // single column and its shoulders came out as a staircase. 240 puts two or
  // three columns in the flank, which is enough for the smoothstep to read.
  const FACE_SHAPES = [
    { nx: 14, ny: 14, sampler: refit(eye(-1)) },
    { nx: 14, ny: 14, sampler: refit(eye(1)) },
    { nx: 10, ny: 10, sampler: refit(nose) },
    { nx: 240, ny: 10, sampler: refit(mouth) },
  ];


  // --- Cutting the openings --------------------------------------------------
  // The face used to be emissive patches lying on the skin. Head on that passes;
  // at three quarters it is plainly a sticker, because a real cut has a wall and
  // a wall is the whole of the depth cue. Turned away from the camera it shows a
  // band of shaded orange between skin and glow, turned toward it that band
  // pinches to nothing, and the near lip hides part of the interior. None of
  // that can be painted on, and every attempt to shade it in falls apart at
  // exactly the angle that matters.
  //
  // No general CSG is needed for it. The shell is already a grid over (a, s) and
  // every face shape is already a closed outline in face space, so an opening is
  // just a region of that grid: drop the quads whose centres fall inside, pull
  // the vertices left on the rim onto the true outline so the edge does not
  // staircase along grid lines, and extrude that rim inward along the surface
  // normal to build the wall.

  // Face-space position of a grid vertex: the inverse of what facePoint does.
  const faceOf = (a, s) => {
    const aw = a > Math.PI ? a - Math.PI * 2 : a;
    return [(aw * bodyR * profileR(s)) / FACE_SX, (profileY(s) + yBase) / FACE_SY];
  };

  // Each cut's outline, walked off the shape's own sampler rather than written
  // out again, so the hole, its wall and the emissive plate at the bottom of it
  // are the same curve by construction instead of by three sets of numbers
  // agreeing with each other.
  const outlineOf = (sampler, n) => {
    const pts = [];
    const add = (u, v) => {
      const q = sampler(u, v);
      const last = pts[pts.length - 1];
      if (!last || Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) > 1e-7) pts.push(q);
    };
    for (let i = 0; i <= n; i++) add(i / n, 0);
    for (let i = 1; i <= n; i++) add(1, i / n);
    for (let i = 1; i <= n; i++) add(1 - i / n, 1);
    for (let i = 1; i < n; i++) add(0, 1 - i / n);
    // Triangles are authored as grids with the top edge collapsed, so the walk
    // above revisits the apex; drop whatever doubles back onto the start.
    while (pts.length > 2) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.abs(f[0] - l[0]) + Math.abs(f[1] - l[1]) < 1e-7) pts.pop(); else break;
    }
    // Wound counter-clockwise, so "into the cut" is one fixed rotation of the
    // edge tangent everywhere. Aiming at the shape's centroid instead would
    // point the wrong way down the flank of a tooth.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const f = pts[i], g = pts[(i + 1) % pts.length];
      area += f[0] * g[1] - g[0] * f[1];
    }
    if (area < 0) pts.reverse();
    return pts;
  };

  const CUTS = FACE_SHAPES.map(({ sampler, nx }) => {
    // The mouth needs the fine walk: its teeth have flanks a few thousandths
    // wide. The triangles are three straight edges and 40 a side is plenty, and
    // the difference matters because the backing skirt spends fifteen vertices
    // on every outline segment.
    const pts = outlineOf(sampler, nx >= 100 ? 160 : 40);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of pts) {
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    }
    return { pts, minX, maxX, minY, maxY };
  });

  // Crossing count, bounding box first. Without the box this runs over every
  // grid vertex against every outline point and costs more than the mesh.
  const inCut = (cut, X, Y) => {
    if (X < cut.minX || X > cut.maxX || Y < cut.minY || Y > cut.maxY) return false;
    const pts = cut.pts;
    let hit = false;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const yi = pts[i][1], yk = pts[k][1];
      if ((yi > Y) !== (yk > Y) && X < ((pts[k][0] - pts[i][0]) * (Y - yi)) / (yk - yi) + pts[i][0]) hit = !hit;
    }
    return hit;
  };
  const cutAt = (X, Y) => {
    for (const cut of CUTS) if (inCut(cut, X, Y)) return cut;
    return null;
  };

  // Nearest point on an outline, and the inward normal of the segment it landed
  // on. That normal is what the wall is built against, so no loop tracing is
  // needed: each rim vertex carries its own direction into the cut.
  const snapTo = (cut, X, Y) => {
    const pts = cut.pts;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const f = pts[i], g = pts[(i + 1) % pts.length];
      const ex = g[0] - f[0], ey = g[1] - f[1];
      const len2 = ex * ex + ey * ey || 1e-12;
      const t = Math.min(1, Math.max(0, ((X - f[0]) * ex + (Y - f[1]) * ey) / len2));
      const cx = f[0] + ex * t, cy = f[1] + ey * t;
      const d = (X - cx) * (X - cx) + (Y - cy) * (Y - cy);
      if (d < bestD) {
        bestD = d;
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        best = { X: cx, Y: cy, nx: -ey * inv, ny: ex * inv };
      }
    }
    return best;
  };

  // --- Light through the skin ------------------------------------------------
  // A pumpkin wall is two centimetres of wet flesh and it is translucent. On a
  // real one the shell is dull and orange nearly everywhere and openly GLOWING
  // for a couple of centimetres around every cut, because that is where the
  // knife has taken the wall down to an edge and where the flame is closest to
  // the outside. It is one of the two or three things that say lit from within
  // rather than painted orange, and nothing in this file was doing it: the
  // lamp is inside a FrontSide shell whose normals all point away from it, so
  // by construction the skin can never catch its own light.
  //
  // Distance from the nearest carved edge, in face space, run through a
  // squared falloff. Not physically integrated through the wall -- that wants
  // a thickness field this mesh does not carry -- but the shape of it is
  // right, and the thing being modelled is a millimetres-thick wedge of flesh
  // at the cut edge lighting up, which is a function of distance from that
  // edge and very little else.
  //
  // The spread is in face-space units, where the classic body is about 0.8
  // across, so 0.055 is a bit under two centimetres of real pumpkin: the depth
  // light actually gets through this stuff before it is gone.
  const GLOW_SPREAD = 0.055;
  // Every fourth outline point. The outlines carry 40 points a side, 160 on
  // the mouth, so a quarter of them still samples a tooth flank several times
  // and the falloff is smooth over a distance many times the gap.
  const GLOW_STEP = 4;
  const skinGlow = (X, Y) => {
    let best = Infinity;
    for (const cut of CUTS) {
      if (X < cut.minX - GLOW_SPREAD || X > cut.maxX + GLOW_SPREAD
        || Y < cut.minY - GLOW_SPREAD || Y > cut.maxY + GLOW_SPREAD) continue;
      const pts = cut.pts;
      for (let i = 0; i < pts.length; i += GLOW_STEP) {
        const dx = X - pts[i][0], dy = Y - pts[i][1];
        const q = dx * dx + dy * dy;
        if (q < best) best = q;
      }
    }
    if (best === Infinity) return 0;
    const t = 1 - Math.min(1, Math.sqrt(best) / GLOW_SPREAD);
    return t * t;
  };

  // --- Shell mesh ----------------------------------------------------------
  // Denser than the plain shell needed. The grid is now the thing being cut, so
  // its cell has to be small next to a tooth flank; at the old 180 x 96 a whole
  // tooth was three cells wide and snapping could not rescue the outline.
  const radial = Math.max(lobes * 22, SEGMENTS.radial * 2);
  const shellVerts = [];
  const shellNors = [];
  const shellColors = [];
  // Per-vertex: how much of the flame comes THROUGH the skin here. See
  // skinGlow below for what it is measuring.
  const shellGlow = [];
  const shellIdx = [];
  const wallVerts = [];
  const wallNors = [];
  const wallColors = [];
  const wallIdx = [];

  (() => {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const skin = skinTone(PALETTE.pumpkinSkin).convertSRGBToLinear();
    const shade = skinTone(PALETTE.pumpkinShade).convertSRGBToLinear();
    const c = new THREE.Color();

    const colorAt = (a, s) => {
      // Paint the grooves with the palette's shade colour. Real shading already
      // darkens them; this keeps them readable when the key light is head-on.
      const g = Math.pow(0.5 - 0.5 * Math.cos(lobes * a), 0.9);
      c.copy(skin).lerp(shade, g * 0.20);
      // A touch more shade in the last of the underside, standing in for the
      // contact occlusion a prop this simple gets no other way. Kept small:
      // overdoing it turns the palette's orange into a muddy red.
      const low = Math.max(0, -s - 0.55) / 0.45;
      return c.lerp(shade, low * low * 0.12);
    };

    // Ring vertices are stored in (a, s) first so the rim ones can be moved
    // before any position is baked.
    const nRing = RINGS - 1;
    const va = new Float64Array(nRing * radial);
    const vs = new Float64Array(nRing * radial);
    const rimNX = new Float64Array(nRing * radial);
    const rimNY = new Float64Array(nRing * radial);
    const isRim = new Uint8Array(nRing * radial);
    const vk = (j, i) => (j - 1) * radial + ((i % radial) + radial) % radial;

    for (let j = 1; j < RINGS; j++) {
      const s = -Math.cos((Math.PI * j) / RINGS);
      for (let i = 0; i < radial; i++) {
        const k = vk(j, i);
        va[k] = (i / radial) * Math.PI * 2;
        vs[k] = s;
      }
    }

    // Quad (j, i) spans rings j..j+1 and columns i..i+1, for j = 1..RINGS-2, and
    // is dropped when its centre falls inside a cut. Testing all four corners
    // instead keeps the hole strictly inside the outline, which is safer, but it
    // also blunts every corner by a whole cell: the nose came out a hexagon.
    // Centre testing keeps the shape and the two guards below cover what it
    // costs -- the rim snap is clamped so no surviving quad can turn itself
    // inside out, and the emissive plate carries a skirt wider than a cell so
    // there is always something behind an overshoot.
    const nQuad = RINGS - 2;
    const qcut = new Array(nQuad * radial).fill(null);
    const qk = (j, i) => (j - 1) * radial + ((i % radial) + radial) % radial;
    for (let j = 1; j <= nQuad; j++) {
      const s0 = -Math.cos((Math.PI * j) / RINGS);
      const s1 = -Math.cos((Math.PI * (j + 1)) / RINGS);
      const sm = (s0 + s1) * 0.5;
      for (let i = 0; i < radial; i++) {
        const am = ((i + 0.5) / radial) * Math.PI * 2;
        const f = faceOf(am, sm);
        qcut[qk(j, i)] = cutAt(f[0], f[1]);
      }
    }
    // A vertex is on the rim when it touches both a dropped quad and a kept one.
    const quadOf = (j, i) => (j < 1 || j > nQuad ? null : qcut[qk(j, i)]);
    for (let j = 1; j < RINGS; j++) {
      for (let i = 0; i < radial; i++) {
        const around = [quadOf(j - 1, i - 1), quadOf(j - 1, i), quadOf(j, i - 1), quadOf(j, i)];
        let cut = null;
        let open = false;
        for (const q of around) {
          if (q) cut = q; else open = true;
        }
        if (!cut || !open) continue;
        const k = vk(j, i);
        const f = faceOf(va[k], vs[k]);
        const hit = snapTo(cut, f[0], f[1]);
        // Clamp the pull to under a cell in each direction. A rim vertex is
        // shared with the quads that survive, and one dragged clean across a
        // neighbour turns it inside out: it back-face culls and leaves a cell of
        // background showing through the pumpkin, which is exactly the speck
        // that appeared at the outer corner of each eye.
        const cellX = ((Math.PI * 2) / radial) * bodyR * profileR(vs[k]) / FACE_SX;
        const cellY = (bodyH * (Math.PI / RINGS) * Math.sin((Math.PI * j) / RINGS)) / FACE_SY;
        const hx = f[0] + Math.max(-0.55 * cellX, Math.min(0.55 * cellX, hit.X - f[0]));
        const hy = f[1] + Math.max(-0.55 * cellY, Math.min(0.55 * cellY, hit.Y - f[1]));
        hit.X = hx;
        hit.Y = hy;
        const sNew = sOfY(hit.Y * FACE_SY);
        const aNew = (hit.X * FACE_SX) / Math.max(0.05, bodyR * profileR(sNew));
        va[k] = aNew < 0 ? aNew + Math.PI * 2 : aNew;
        vs[k] = sNew;
        rimNX[k] = hit.nx;
        rimNY[k] = hit.ny;
        isRim[k] = 1;
      }
    }

    // Bottom pole (index 0).
    surface(0, -1, p);
    surfaceNormal(0, -1, n);
    shellVerts.push(p.x, p.y, p.z);
    shellNors.push(n.x, n.y, n.z);
    const c0 = colorAt(0, -1);
    shellColors.push(c0.r, c0.g, c0.b);
    shellGlow.push(0);

    for (let j = 1; j < RINGS; j++) {
      for (let i = 0; i < radial; i++) {
        const k = vk(j, i);
        surface(va[k], vs[k], p);
        // Analytic normals rather than computeVertexNormals: with quads missing
        // around every opening, averaged face normals would dish the skin at the
        // rim, and the wall needs its own normals anyway so the lip stays a
        // crisp edge instead of smearing into the skin.
        surfaceNormal(va[k], vs[k], n);
        shellVerts.push(p.x, p.y, p.z);
        shellNors.push(n.x, n.y, n.z);
        const cc = colorAt(va[k], vs[k]);
        shellColors.push(cc.r, cc.g, cc.b);
        const fq = faceOf(va[k], vs[k]);
        shellGlow.push(skinGlow(fq[0], fq[1]));
      }
    }

    surface(0, 1, p);
    surfaceNormal(0, 1, n);
    shellVerts.push(p.x, p.y, p.z);
    shellNors.push(n.x, n.y, n.z);
    const c1 = colorAt(0, 1);
    shellColors.push(c1.r, c1.g, c1.b);
    shellGlow.push(0);
    const topIdx = shellVerts.length / 3 - 1;

    const ring = (j, i) => 1 + vk(j, i);
    for (let i = 0; i < radial; i++) shellIdx.push(0, ring(1, i + 1), ring(1, i));
    for (let j = 1; j <= nQuad; j++) {
      for (let i = 0; i < radial; i++) {
        if (qcut[qk(j, i)]) continue;
        const a0 = ring(j, i), a1 = ring(j, i + 1);
        const b0 = ring(j + 1, i), b1 = ring(j + 1, i + 1);
        shellIdx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    for (let i = 0; i < radial; i++) shellIdx.push(ring(RINGS - 1, i), ring(RINGS - 1, i + 1), topIdx);

    // --- The cut walls -------------------------------------------------------
    // One ribbon quad per grid edge that has a dropped quad on one side and a
    // kept one on the other. The rim vertices are already snapped onto the
    // outline, so the ribbon follows the true curve; extruding each of them back
    // along its own surface normal by SHELL_T lands exactly where the emissive
    // plate's boundary is, so wall and plate meet with no seam.
    const wallLap = new THREE.Color().copy(skin);  // the lapped ring must not read at all
    const wallSkin = new THREE.Color().copy(skin).lerp(shade, 0.30);
    const wallDeep = new THREE.Color().copy(skin).lerp(shade, 0.85);
    const P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
    const N0 = new THREE.Vector3(), N1 = new THREE.Vector3();
    const W0 = new THREE.Vector3(), W1 = new THREE.Vector3();
    const e = new THREE.Vector3(), d = new THREE.Vector3(), g3 = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    // The 3D direction that a face-space step of (nx, ny) points in, flattened
    // into the surface's tangent plane. This is the wall's normal: it comes off
    // the outline rather than off the quad, so neighbouring wall quads sharing a
    // rim vertex agree and the ribbon shades smoothly round a curve.
    const wallNormal = (k, N, out) => {
      const f = faceOf(va[k], vs[k]);
      const eps = 2e-3;
      facePoint(f[0] + rimNX[k] * eps, f[1] + rimNY[k] * eps, 0, out);
      facePoint(f[0], f[1], 0, tmp);
      out.sub(tmp);
      out.addScaledVector(N, -out.dot(N));
      const len = out.length();
      return len > 1e-9 ? out.divideScalar(len) : out.copy(N);
    };

    const pushWall = (kA, kB, cut) => {
      surface(va[kA], vs[kA], P0);
      surface(va[kB], vs[kB], P1);
      surfaceNormal(va[kA], vs[kA], N0);
      surfaceNormal(va[kB], vs[kB], N1);
      wallNormal(kA, N0, W0);
      wallNormal(kB, N1, W1);
      e.copy(P1).sub(P0);
      d.copy(N0).multiplyScalar(-SHELL_T);
      g3.crossVectors(e, d);
      const flip = g3.dot(W0) < 0;
      const first = flip ? P1 : P0;
      const second = flip ? P0 : P1;
      const nFirst = flip ? W1 : W0;
      const nSecond = flip ? W0 : W1;
      const iFirst = flip ? N1 : N0;
      const iSecond = flip ? N0 : N1;
      const base = wallVerts.length / 3;
      // Three rings, not two. The outer one laps back over the skin carrying the
      // SKIN's normal, so it shades as skin and simply is not visible; that is
      // the ring that shuts the crack. The middle one sits on the hole edge and
      // carries the wall's normal, and the jump between the two is the lip. Give
      // the lapped ring the wall's normal instead and it lights side-on against
      // the skin, drawing a bright wire round every opening.
      const push = (pt, nr, nm, ring) => {
        if (ring === 0) tmp.copy(pt).addScaledVector(nr, -WALL_LIP).addScaledVector(nm, WALL_PROUD);
        else if (ring === 1) tmp.copy(pt);
        else tmp.copy(pt).addScaledVector(nr, WALL_TAPER).addScaledVector(nm, -SHELL_T);
        wallVerts.push(tmp.x, tmp.y, tmp.z);
        const nn = ring === 0 ? nm : nr;
        wallNors.push(nn.x, nn.y, nn.z);
        const col = ring === 0 ? wallLap : ring === 1 ? wallSkin : wallDeep;
        wallColors.push(col.r, col.g, col.b);
      };
      for (let ring = 0; ring < 3; ring++) {
        push(first, nFirst, iFirst, ring);
        push(second, nSecond, iSecond, ring);
      }
      for (let ring = 0; ring < 2; ring++) {
        const b = base + ring * 2;
        wallIdx.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
      return cut;
    };

    for (let j = 1; j <= nQuad; j++) {
      for (let i = 0; i < radial; i++) {
        const here = qcut[qk(j, i)];
        // Vertical grid edge shared with the quad to the left.
        const left = quadOf(j, i - 1);
        if (!!here !== !!left) pushWall(vk(j, i), vk(j + 1, i), here || left);
        // Horizontal grid edge shared with the quad below.
        const below = quadOf(j - 1, i);
        if (!!here !== !!below) pushWall(vk(j, i), vk(j, i + 1), here || below);
      }
    }
  })();

  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(shellVerts, 3));
  shellGeo.setAttribute('normal', new THREE.Float32BufferAttribute(shellNors, 3));
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(shellColors, 3));
  shellGeo.setAttribute('aGlow', new THREE.Float32BufferAttribute(shellGlow, 1));
  shellGeo.setIndex(shellIdx);
  shellGeo.computeBoundingSphere();

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wallNors, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallColors, 3));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeBoundingSphere();

  // Vertex colours carry the whole hue, so the material's own colour is white.
  const shellMat = toyMaterial('#ffffff', {
    vertexColors: true,
    roughness: 0.78,
    // Deep and red rather than the palette's glow, and that is not a taste
    // call: this is light that has been through two centimetres of orange
    // flesh, which eats blue first and green next. A cut edge on a real lit
    // pumpkin is nearer to embers than to the flame it is passing.
    emissive: new THREE.Color(SKIN_EMBER),
    emissiveIntensity: (SKIN_GLOW.min + SKIN_GLOW.max) / 2,
  });
  // vColor is already spoken for by the skin's own hue, so the transmission
  // rides its own attribute. Emissive rather than a lightened diffuse, because
  // it has to survive being on the shadowed side of the prop: this is light
  // leaving the surface, not light landing on it.
  shellMat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float aGlow;\nvarying float vSkinGlow;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkinGlow = aGlow;');
    shader.fragmentShader = `varying float vSkinGlow;\n${shader.fragmentShader}`
      .replace(
        'vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive * vSkinGlow;',
      );
  };
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.castShadow = true;
  shell.receiveShadow = true;

  // The wall is its own material so it can carry the flame's wash without the
  // skin picking it up, and its own geometry so its normals never average into
  // the skin's at the lip.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    emissive: new THREE.Color(PALETTE.glow),
    emissiveIntensity: (WASH.min + WASH.max) / 2,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.castShadow = false;   // it faces into a hole; a caster here is only acne
  wall.receiveShadow = true;

  // The glowing plate, plus a skirt of the same emissive running a little way
  // out from the outline underneath the skin. The skirt is never meant to be
  // seen: it is there so that where the grid's hole overshoots the outline by a
  // fraction of a cell there is still something behind it. Sunk a whole shell
  // thickness and only a cell and a half wide, the skin covers it from every
  // angle the prop is ever seen from.
  const faceGeo = (() => {
    const glow = [];
    const g = patchGeometry(FACE_SHAPES, -PLATE, glow);
    const pos = Array.from(g.getAttribute('position').array);
    const idx = Array.from(g.getIndex().array);
    const p = new THREE.Vector3();
    // The skirt is in face space and needs to be wider than a grid cell, and a
    // cell in face space is (2*pi/radial) * BODY_R across by BODY_H * pi/RINGS
    // up -- the body's own size cancels out of both. So this one number is
    // right for every variant and is deliberately not scaled.
    const SKIRT = 0.030;
    // The collar's height is a lift, so it IS in world units and does have to
    // follow the shell: on `tiny` an absolute 0.011 would stand a third of a
    // millimetre proud of a 0.0085 shell and put the plug's roof outside the
    // pumpkin. Deep enough that the collar never grazes the skin.
    const COLLAR_TOP = 0.011 * WALL_K;
    const put = (X, Y, lift) => {
      facePoint(X, Y, lift === undefined ? -PLATE : lift, p);
      pos.push(p.x, p.y, p.z);
      glow.push(flameAt(X, Y));
      return pos.length / 3 - 1;
    };
    for (const cut of CUTS) {
      const pts = cut.pts;
      const outs = pts.map((f, i) => {
        const h = pts[(i + 1) % pts.length];
        const ex = h[0] - f[0], ey = h[1] - f[1];
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        // Outward is the reverse of the counter-clockwise inward normal.
        return [ey * inv, -ex * inv];
      });
      for (let i = 0; i < pts.length; i++) {
        const f = pts[i], h = pts[(i + 1) % pts.length];
        const o = outs[i];
        const b0 = put(f[0], f[1]);
        const b1 = put(h[0], h[1]);
        const b2 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const b3 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT);
        idx.push(b0, b1, b2, b0, b2, b3);
        // Fan across the corner. Two neighbouring strips point their offsets in
        // different directions, and at a convex corner that leaves a wedge of
        // nothing behind the sharpest part of the outline. It is exactly where
        // the last of the see-through specks were: at the outer corner of each
        // eye, which is the sharpest turn on the whole face.
        const q = outs[(i + 1) % pts.length];
        const c0 = put(h[0], h[1]);
        const c1 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const c2 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT);
        idx.push(c0, c1, c2);
        // A collar standing up from the skirt's outer edge to just under the
        // skin, so the plug behind each cut is a closed box rather than a floor.
        // Without it a sight line almost parallel to the skin could still slip
        // between a stray grid cell and the wall and come out the far side, and
        // it did: one pixel of daylight at the sharpest corner of the far eye,
        // only ever at three quarters.
        const d0 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT, -COLLAR_TOP);
        const d1 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT, -COLLAR_TOP);
        const d2 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const d3 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT);
        idx.push(d0, d1, d2, d0, d2, d3);
        // and a post across the corner, for the same reason the floor needed a
        // fan there: two neighbouring collar panels lean apart at a convex turn.
        const e0 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT, -COLLAR_TOP);
        const e1 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT, -COLLAR_TOP);
        const e2 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT);
        const e3 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        idx.push(e0, e1, e2, e0, e2, e3);
      }
    }
    // Normalise the arrival against the brightest point on the face rather than
    // against an absolute, so the flicker's own range stays the only thing that
    // sets how bright the pumpkin is and a differently scaled seed does not
    // come out dimmer. Then lift it: raw cosine-over-distance-squared spans
    // about five to one across the face, and left alone the far corner of an
    // eye is a hole with the light off. PLATE_FLOOR is where the dimmest part
    // lands and PLATE_GAMMA how fast it climbs off it; these put the spread at
    // a little over two to one, which is the reference's, where the darkest
    // interior is around half the brightest and still plainly lit.
    const PLATE_FLOOR = 0.28, PLATE_GAMMA = 0.90;
    let peak = 0;
    for (const v of glow) if (v > peak) peak = v;
    const colors = new Float32Array(glow.length * 3);
    for (let i = 0; i < glow.length; i++) {
      const f = PLATE_FLOOR + (1 - PLATE_FLOOR) * Math.pow(peak > 0 ? glow[i] / peak : 1, PLATE_GAMMA);
      colors[i * 3] = f;
      colors[i * 3 + 1] = f;
      colors[i * 3 + 2] = f;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.setIndex(idx);
    out.computeVertexNormals();
    g.dispose();
    return out;
  })();

  // Emissive, so it ignores the scene lights entirely and reads as light on its
  // way out rather than as an orange sticker. Its intensity is driven by the
  // same flicker value as the lamp, which is what ties the two together.
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x1a0a00,
    vertexColors: true,
    emissive: PLATE_FLAME.clone(),
    emissiveIntensity: (GLOW.min + GLOW.max) / 2,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  // The per-vertex value built above is the flame's falloff across the plate,
  // and in the standard material vertex colours drive the diffuse term -- which
  // on a plate this dark is nothing at all. Hand it to the emissive instead.
  faceMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalEmissiveRadiance = emissive;',
      'vec3 totalEmissiveRadiance = emissive * vColor;',
    );
  };
  const face = new THREE.Mesh(faceGeo, faceMat);
  // No shadows: it is coplanar with the shell, and a caster there only produces
  // acne. It is light, not matter.
  face.castShadow = false;
  face.receiveShadow = false;


  // --- Stem ----------------------------------------------------------------
  // A swept tube with its own radius profile rather than a CylinderGeometry:
  // it has to bend, taper, flare where it meets the shell and round off at the
  // tip, and none of that is a primitive.
  // The whole stem is the classic one scaled: sizeK carries it down onto a
  // smaller body, and the variant's own pair then says how it differs from a
  // scaled classic. Girth and length are separate because that is exactly what
  // the reference varies -- the gourd and the pear carry a stem that is longer
  // and thinner than a scaled one (0.80 girth at 1.9 length), the tiny one's is
  // shorter and much fatter (1.55 at 0.95), and the two round ones are a scaled
  // classic with a little more of both.
  const stemK = sizeK * V.stem.girth;
  const stemL = sizeK * V.stem.length;
  const lean = new THREE.Vector2(Math.sin(aStem + FACE_YAW), Math.cos(aStem + FACE_YAW));

  // Where the base sits. Off-centre, so the height it has to start from is the
  // crown's height at that radius rather than at the pole. Near the pole
  // profileR falls away so fast that this is only thousandths of a unit -- an
  // eleventh of the body radius is already at s = 0.93 on the classic -- but it
  // is the thousandths that decide whether a base pushed out toward the rim is
  // buried in the dish or hanging over it. Solved off profileR alone, ignoring
  // the ribs: a groove is narrower than the un-ribbed profile at the same s, so
  // ignoring it errs toward a lower base, which is the safe direction.
  const sAtR = (r) => {
    let lo = Math.max(EQ, 0), hi = 1;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) * 0.5;
      if (profileR(m) > r) lo = m; else hi = m;
    }
    return (lo + hi) * 0.5;
  };
  const stemTop = profileY(sAtR(Math.abs(stemOff))) + yBase;
  const baseX = lean.x * stemOff * bodyR;
  const baseZ = lean.y * stemOff * bodyR;

  // The spine is integrated rather than written out as five control points,
  // because the direction is seeded now and fixed offsets cannot express it.
  // The angle off vertical runs from stemRoot at the crown to stemTip at the
  // end, linear in arc length -- which is how the old fixed points turned
  // anyway: measured off them the tangent went 4, 31, 54 and 71 degrees at even
  // steps along itself, so a spine built this way with a root near zero and a
  // tip near 71 degrees is the stem this file always had.
  //
  // Arc length is solved and not seeded, from how high the stem is meant to
  // reach: a hard curl spends much of its length going sideways and needs a
  // longer spine to stand as tall as a straight one. Left un-solved, the
  // upright seeds came out forty percent taller than the flopped ones and the
  // family read as different-sized pumpkins rather than different stems.
  const SPINE_PTS = 9, SPINE_SUB = 8;
  let meanCos = 0;
  for (let i = 0; i < 32; i++) meanCos += Math.cos(stemRoot + (stemTip - stemRoot) * ((i + 0.5) / 32));
  const spineL = (stemRise * stemL) / Math.max(0.35, meanCos / 32);
  // A little of the spine is buried in the dish, so the flared root sits IN the
  // shell rather than on it.
  const BURY = 0.035 * stemL;
  const spine = [];
  {
    let h = 0, v = -BURY;
    spine.push([h, v]);
    const ds = (spineL + BURY) / ((SPINE_PTS - 1) * SPINE_SUB);
    for (let i = 0; i < (SPINE_PTS - 1) * SPINE_SUB; i++) {
      const u = Math.min(1, Math.max(0, ((i + 0.5) * ds - BURY) / spineL));
      const th = stemRoot + (stemTip - stemRoot) * u;
      h += Math.sin(th) * ds;
      v += Math.cos(th) * ds;
      if ((i + 1) % SPINE_SUB === 0) spine.push([h, v]);
    }
  }
  const stemCurve = new THREE.CatmullRomCurve3(spine.map(([h, v]) =>
    new THREE.Vector3(baseX + lean.x * h, stemTop + v, baseZ + lean.y * h)));
  // The radius profile was authored against the old fixed spine, which measured
  // 0.296 of stemL from buried end to tip. The taper is a fraction of the
  // length and rides any spine, but the root flare and the tip cap are both
  // absolute features -- a lip that spreads over four hundredths of a unit, a
  // nub over five -- so they are held to that length rather than to this one.
  // Left as plain fractions of t, a long floppy stem grew a lip twice as deep
  // as an upright one.
  const REF_L = 0.296 * stemL;
  const SPINE_TOTAL = spineL + BURY;
  const FLARE_T = 0.11 * REF_L / SPINE_TOTAL;
  const CAP_T = 1 - 0.18 * REF_L / SPINE_TOTAL;
  const stemRadius = (t) => {
    const taper = 0.052 * stemK * (1 - 0.42 * Math.pow(t, 1.2));
    const flare = 1 + 1.05 * Math.exp(-t / FLARE_T);  // spreads where it meets the dish
    // A hemispherical roll-off rather than a flat disc: the tip of a toy stem
    // is a soft nub, and a truncated cone reads as a cut-off pencil.
    const cap = t > CAP_T ? Math.sqrt(Math.max(0, 1 - Math.pow((t - CAP_T) / (1 - CAP_T), 2))) : 1;
    return taper * flare * cap;
  };
  const stemGeo = sweep(stemCurve, stemRadius, SEGMENTS.curve * 2, SEGMENTS.radial);
  const stemMat = toyMaterial(PALETTE.stem, { roughness: 0.86 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.castShadow = true;
  stem.receiveShadow = true;

  // --- The lamp inside -----------------------------------------------------
  // A lit pumpkin does two separate things and they are modelled separately,
  // because one number cannot be both.
  //
  //   The BEAMS. Light leaving through the three cuts and through nothing
  //   else. Strong, sharply shaped, and pointed wherever the face is pointed.
  //   That is the spotlight below, and its projected texture IS the carving as
  //   the flame sees it: where the cone points, how wide it is and how soft
  //   its edges are are all solved from the outlines rather than dialled in.
  //
  //   The LANTERN. The shell itself, two centimetres of translucent flesh with
  //   a flame against the inside of all of it, glowing in every direction.
  //   Weak, shapeless, short range. That is glowLamp, further down.
  //
  // A single omnidirectional lamp cannot do the first -- three does not occlude
  // lights without a shadow map, so it lights the ground behind the pumpkin as
  // brightly as the ground in front, where no light can actually get out -- and
  // a single spotlight cannot do the second, because a glow that only exists
  // inside a forward cone is a torch. The file used to have only the spot, and
  // that is most of why nothing standing beside a pumpkin ever caught anything.
  //
  // Real shadow casting is still off. It would give the beams the same answer
  // -- the shell is a real hollow mesh with real holes now -- for the price of
  // six more shadow maps in a scene that already renders one per frame, and
  // the projection below is exact where a 512px shadow map from 20cm away is
  // not.

  // Where the candle stands, which is NOT where FLAME_AT is, and the
  // difference is the whole reason a single projected texture can work.
  //
  // FLAME_AT sits half a body radius forward, tucked up behind the openings.
  // It stays there: it is the point the emissive plate's per-vertex falloff is
  // measured from and that falloff was tuned against it. But a PROJECTOR there
  // sees the carving fill better than 130 degrees -- the outer corner of an eye
  // measures 67 degrees off the axis on the classic -- and no planar gobo holds
  // a field that wide; the corners come apart in the perspective divide. That
  // is the wall the previous pass hit, and it answered it by giving up on
  // projecting and laying the face into the cone in face space instead, which
  // is what made the pools on the floor shapeless: a stencil that is not a
  // projection of anything does not land on anything.
  //
  // A candle does not stand pressed against the inside of the face. It stands
  // on the floor of the cavity, on the axis. From there the same carving
  // measures 40 degrees, a 90 degree field holds it with room to spare, and
  // the projection can be the true one.
  const LAMP_AT = new THREE.Vector3(0, FLAME_AT.y, 0);
  // Near plane shared by the light's own projection and the rasteriser below.
  const GOBO_NEAR = 0.02;

  // The bundle that actually escapes: every point of every cut outline, as a
  // direction from the lamp. Its mean is where the cone has to point, its
  // spread is how wide the cone has to be, and its mean range is the lever arm
  // the flame's own width works on. Solved per variant, so a face carved high
  // on a gourd's neck aims its own light without anyone editing a number.
  const escape = (() => {
    const dirs = [];
    const p = new THREE.Vector3();
    let reach = 0;
    for (const cut of CUTS) {
      for (const q of cut.pts) {
        facePoint(q[0], q[1], 0, p).sub(LAMP_AT);
        reach += p.length();
        dirs.push(p.clone().normalize());
      }
    }
    const axis = new THREE.Vector3();
    for (const d of dirs) axis.add(d);
    axis.normalize();
    let half = 0;
    for (const d of dirs) half = Math.max(half, Math.acos(Math.min(1, d.dot(axis))));
    return { axis, half, reach: reach / Math.max(1, dirs.length) };
  })();

  // The cone has to finish OUTSIDE the widest escaping ray, because its rim is
  // a smoothstep and not a wall: a shape that reaches the rim comes out dimmed
  // by the cone rather than shaped by the carving.
  //
  // The floor under that is for the forward part of the spill: the cut edges
  // scattering, and the cavity bouncing light back out through the same holes
  // off-axis. That is the GOBO_GLOW layer below, it is biased forward rather
  // than even, and it needs somewhere to go, so the cone opens to a full 57
  // degrees even on a face that would fit inside 40. Wider than this and the
  // shapes start losing texels for no gain; narrower and the spill has a rim
  // on it. What the shell throws sideways and backwards is glowLamp's job and
  // deliberately not this cone's.
  const CONE_ANGLE = Math.min(1.20, Math.max(1.00, escape.half + 0.20));
  // Low, and for the opposite reason it used to be high. The rim used to be
  // the only thing keeping the pool from reading as a stain; now the gobo is
  // black everywhere but the three holes, so all a wide penumbra can do is eat
  // the edges of the beams.
  const CONE_PENUMBRA = 0.10;

  // Falloff. A flame is a small source in open air, so the honest exponent is
  // 2, and that is what this is now. It was 0.9, and 0.9 is what you reach for
  // when the lamp is jammed against the inside of the face: from two
  // centimetres away inverse-square puts a hundredfold between the near lip of
  // a cut and the floor just past it, and the near field blows out. From the
  // axis the nearest thing the lamp lights is a cut wall a third of a unit
  // away and the beams do not reach the floor for a unit or more, so there is
  // no near field left to blow out and no reason to fake the exponent.
  const LIGHT_DECAY = 2;
  // Where three clips the light off completely. Physically there is no such
  // distance: this is a budget. It sits well past the far end of the grin's
  // beam, because three squares a (1 - (d/D)^4) window into the falloff and
  // the last third of D is already visibly fading -- put D at the end of the
  // beam and the beam ends in a line drawn across the floor.
  const LIGHT_DISTANCE = 5.0 * sizeK;
  // A smaller lantern holds a smaller flame. This is NOT the old sizeK^0.9,
  // which was there to hold the pool's brightness steady while the cone's
  // REACH scaled with the prop. The throw is angular now, so every variant
  // throws the same pattern by construction and only the lamp's height off the
  // floor decides how far along the ground the beams run, which is exactly how
  // a real one behaves.
  const LAMP_GAIN = sizeK;

  // --- What the light throws -------------------------------------------------
  // three projects a texture through a spotlight's cone if you hand it
  // light.map, and it refreshes the light's matrix whenever a map is present
  // whether or not the light casts shadows -- WebGLLights calls
  // shadow.updateMatrices() off light.map alone. So the mask below is not a
  // decoration painted into the cone: it is rasterised through the very camera
  // three will use to look the mask back up, which is what makes a beam land
  // on the floor, on the ghost, and on anything else standing in it, in the
  // right place and at the right stretch, with no per-receiver work at all.
  //
  // The outlines are CUTS, the same curves the shell was cut with, so the
  // projection follows the carving by construction.
  const GOBO_SIZE = 512;
  // What the lantern throws that is not a beam, in two layers, because the two
  // are different things happening at different scales and one blur cannot be
  // both. Widths are in texels of GOBO_SIZE.
  //
  //   HALO  the flesh immediately around a cut, which is where the wall has
  //         been carved down to nothing and is at its most translucent, plus
  //         the light bouncing about inside the cavity and leaving through the
  //         same hole off-axis. Hugs the carving.
  //   GLOW  the same thing gone soft: nearly featureless, nearly as wide as
  //         the cone, and the reason the ground between the beams is not black.
  //         Only the forward half of the lantern's spill lives here; what it
  //         throws sideways and behind is glowLamp's.
  //
  // Their weights are what is left after the shapes, and they are deliberately
  // small: at anything like the old 0.55 the wash is a fog that hides the very
  // beams this pass exists to produce.
  const GOBO_HALO = 40, GOBO_HALO_W = 0.17;
  const GOBO_GLOW = 150, GOBO_GLOW_W = 0.12;

  const goboMap = (() => {
    // Props are built head-less in tests; with no canvas there is no mask and
    // the lamp falls back to its plain cone.
    if (typeof document === 'undefined') return null;

    // The same camera three builds for this light. SpotLightShadow sets
    // fov = 2 * angle in degrees, aspect 1 and far = light.distance, and the
    // coordinate it samples the map at is that camera's NDC mapped to 0..1.
    // Matching it here to the digit is the whole trick.
    const cam = new THREE.PerspectiveCamera(
      THREE.MathUtils.radToDeg(2 * CONE_ANGLE), 1, GOBO_NEAR, LIGHT_DISTANCE,
    );
    cam.position.copy(LAMP_AT);
    cam.lookAt(LAMP_AT.clone().add(escape.axis));
    cam.updateMatrixWorld(true);
    const toClip = new THREE.Matrix4()
      .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const p = new THREE.Vector3();
    // Canvas y runs down and CanvasTexture uploads flipped, so the canvas's top
    // row is v = 1, which is NDC +1: up. No hand-chosen mirroring anywhere in
    // here, and that is the point -- which way round the grin lands is now the
    // geometry's answer rather than a sign someone had to guess.
    const project = (X, Y) => {
      facePoint(X, Y, 0, p).applyMatrix4(toClip);
      return [(0.5 + p.x * 0.5) * GOBO_SIZE, (0.5 - p.y * 0.5) * GOBO_SIZE];
    };

    const shapes = document.createElement('canvas');
    shapes.width = shapes.height = GOBO_SIZE;
    const sc = shapes.getContext('2d');
    sc.fillStyle = '#ffffff';
    for (const cut of CUTS) {
      sc.beginPath();
      for (let i = 0; i < cut.pts.length; i++) {
        const [px, py] = project(cut.pts[i][0], cut.pts[i][1]);
        if (i) sc.lineTo(px, py); else sc.moveTo(px, py);
      }
      sc.closePath();
      sc.fill();
    }

    // How soft a beam's edge is, measured rather than picked. A flame is not a
    // point: an aperture at range a from a source of width S throws a penumbra
    // subtending S / a AS SEEN FROM THE LAMP, whatever is standing in the beam
    // and however far away it is. So the softening is a constant ANGLE, it
    // belongs in the gobo rather than at the receiver, and a beam that has run
    // three units across the floor is softer in world units than one that has
    // run half a unit -- for free, and correctly.
    //
    // FLAME_W is the luminous core of a candle at this scale. The props are
    // built so a classic pumpkin is about 25cm across, which puts a unit at
    // 31cm, so 0.018 is a shade under 6mm.
    const FLAME_W = 0.018;
    // Radians, then texels: the texture spans 2 * tan(CONE_ANGLE) of tangent
    // across GOBO_SIZE, and near the axis d(tan)/d(theta) is 1. Divided by
    // 2.5 because a Gaussian of sigma s spans roughly 2.5 s of transition.
    const softTexels = ((FLAME_W / escape.reach) / (2 * Math.tan(CONE_ANGLE))) * GOBO_SIZE;
    const GOBO_BLUR = Math.min(20, Math.max(1.2, softTexels / 2.5));

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GOBO_SIZE;
    // Read back once per layer below, which the browser otherwise warns about
    // and pays for by keeping the canvas on the GPU.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Each layer is normalised to its OWN peak before it is weighted, and each
    // is blurred out of the one before it rather than out of the shapes again.
    // Both of those are needed and neither is tidiness.
    //
    // Normalising: a 150-texel blur spreads the same ink over forty times the
    // area, so composited raw it arrives at four per cent of the weight it was
    // given and the numbers above mean nothing.
    //
    // Chaining: an 8-bit canvas holding a 150-texel blur of a small shape has
    // a peak around 18, so normalising it multiplies the quantisation by
    // fourteen and the wash comes out as concentric rings. Blurring the
    // already-normalised previous layer keeps every stage using the full range.
    // It is also the truer picture, light scattering out of light that has
    // already scattered.
    const layer = new Float32Array(GOBO_SIZE * GOBO_SIZE);
    const acc = new Float32Array(GOBO_SIZE * GOBO_SIZE);
    const stage = document.createElement('canvas');
    stage.width = stage.height = GOBO_SIZE;
    const stx = stage.getContext('2d');
    let src = shapes;
    for (const [blur, weight] of [
      [GOBO_BLUR, 1 - GOBO_HALO_W - GOBO_GLOW_W],
      [GOBO_HALO, GOBO_HALO_W],
      [GOBO_GLOW, GOBO_GLOW_W],
    ]) {
      ctx.globalCompositeOperation = 'copy';
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(src, 0, 0);
      const d = ctx.getImageData(0, 0, GOBO_SIZE, GOBO_SIZE).data;
      let peak = 1;
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        // The blur leaves the spread in alpha as well as in luma.
        layer[k] = d[i] * (d[i + 3] / 255);
        if (layer[k] > peak) peak = layer[k];
      }
      const norm = new ImageData(GOBO_SIZE, GOBO_SIZE);
      for (let k = 0, i = 0; k < layer.length; k++, i += 4) {
        const v = (layer[k] / peak) * 255;
        acc[k] += (layer[k] / peak) * weight;
        norm.data[i] = norm.data[i + 1] = norm.data[i + 2] = v;
        norm.data[i + 3] = 255;
      }
      stx.putImageData(norm, 0, 0);
      // A copy, because the next pass reads this one while writing its own.
      src = stage.cloneNode ? (() => {
        const c = document.createElement('canvas');
        c.width = c.height = GOBO_SIZE;
        c.getContext('2d').drawImage(stage, 0, 0);
        return c;
      })() : stage;
    }

    // And once more over the sum, so LAMP on its own says how bright the
    // pumpkin throws and everything above only says what shape it throws.
    let peak = 1e-6;
    for (let k = 0; k < acc.length; k++) if (acc[k] > peak) peak = acc[k];
    const out = ctx.createImageData(GOBO_SIZE, GOBO_SIZE);
    for (let k = 0, i = 0; k < acc.length; k++, i += 4) {
      const v = Math.min(255, Math.round((acc[k] / peak) * 255));
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.putImageData(out, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    // Left raw on purpose: three multiplies the light's colour by this sample
    // with no colour-space decode, so the canvas is a linear multiplier and not
    // a picture. Run through sRGB it would come out far too dark in the wash.
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  })();

  const light = new THREE.SpotLight(
    new THREE.Color(PALETTE.glow),
    ((LAMP.min + LAMP.max) / 2) * LAMP_GAIN,
    LIGHT_DISTANCE * scale,
    CONE_ANGLE,
    CONE_PENUMBRA,
    LIGHT_DECAY,
  );
  light.position.copy(LAMP_AT);
  light.castShadow = false;
  light.map = goboMap;
  // three tests the projected coordinate against the shadow camera's whole
  // frustum and leaves anything outside it UNMASKED, depth included, so the
  // near plane has to sit closer than the nearest thing the cone can reach or
  // the mask ends in a hard arc across it. The wall inside a cut is a third of
  // a unit from the lamp; this is well inside that, and the same value is fed
  // to the camera the mask is rasterised through so the two agree exactly.
  light.shadow.camera.near = GOBO_NEAR;
  light.shadow.camera.updateProjectionMatrix();

  // The target is parented to the group, so the cone turns with the pumpkin
  // instead of staying pinned to a world direction. Local units: the group is
  // scaled below, so these must not be pre-scaled.
  //
  // Aimed straight down the escaping bundle rather than at a patch of floor.
  // That is a real change of intent: the old aim tipped the cone 21 degrees
  // into the ground so that the whole of it landed in a pool, which is also
  // why nothing above ankle height ever saw this light. The bundle points very
  // nearly level, because that is where the holes are relative to the flame,
  // and it sorts itself out on the way: the grin sits below the flame so its
  // beam runs down and lands long, the eyes and the nose sit above it so
  // theirs climb and land on whatever is standing in front of the pumpkin.
  const lightTarget = new THREE.Object3D();
  lightTarget.position.copy(LAMP_AT).addScaledVector(escape.axis, 2.0 * sizeK);
  light.target = lightTarget;

  // --- The lantern itself ----------------------------------------------------
  // The spot above is only half of what a lit pumpkin does. It is the light
  // that leaves through the holes. The other half is the shell: two
  // centimetres of wet flesh is translucent, the flame is directly against the
  // inside of all of it, and the whole thing sits there as a dull orange lamp
  // in its own right. That is why a jack-o'-lantern warms the ground it stands
  // on and everything within a stride of it, in every direction, and not only
  // whatever it happens to be pointing at.
  //
  // Modelled as a point light because from more than a body radius away a
  // glowing shell IS a point source, and because the alternative -- widening
  // the spot until its wash covers the neighbourhood -- cannot cover the sides
  // or the back at all and blows the projection up as the cone approaches a
  // hemisphere.
  //
  // This is not the omnidirectional lamp the file used to warn about. That one
  // was carrying the whole effect and lighting the floor behind the pumpkin as
  // brightly as the floor in front of it, which is nonsense for light coming
  // out of three holes. This one carries only what genuinely does come out in
  // every direction, it is a fraction of the spot's strength, and it dies
  // inside a couple of body-lengths.
  // Same 2.15:1 swing the rest of the flicker is tuned to. The absolute level
  // is a stylistic call and worth naming as one: a real candle behind two
  // centimetres of flesh is far dimmer than this against a floor lit like
  // noon, and at anything like a truthful ratio to the hemisphere and key in
  // main.js nothing this pumpkin does can be seen at all. This is what makes
  // the lantern read as a lantern in THIS scene's light.
  const GLOW_LAMP = { min: 0.52, max: 1.12 };   // rides the same flicker
  const glowLamp = new THREE.PointLight(
    new THREE.Color(PALETTE.glow), 0,
    // Far enough out that the cutoff window is not what ends the glow.
    // Inverse-square already has it down to a twentieth by two body-lengths;
    // clip it much nearer than this and the glow stops rather than fades.
    3.0 * sizeK * scale,
    2,
  );
  glowLamp.position.set(0, yBase, 0);
  glowLamp.castShadow = false;

  const group = new THREE.Group();
  // No painted contact patch under this prop any more. It was here to stand in
  // for the contact the key light's angled shadow cannot give, and while the
  // shell touched the floor almost at a point it was the only thing holding the
  // pumpkin down. Now that the base is a real disc the cast shadow reaches the
  // silhouette on its own, and the patch was doing what the tombstones' did:
  // painting an even dark ring on every side, including the lit one, where a
  // real shadow only lies on one. Checked by looking, patch on and patch off.
  group.add(shell, wall, face, stem, light, lightTarget, glowLamp);
  group.scale.setScalar(scale);

  const lightHome = light.position.clone();

  return {
    group,
    update(time) {
      // A candle is mostly steady, and it is never still. Four things are going
      // on at once here and the light only reads as a flame when all four are:
      // a fine tremble that never stops, a slower wander breathing under it,
      // the rare event -- a gutter that ducks hard, or a flare as the flame
      // straightens and stands up -- and the flame physically moving while it
      // does the rest.
      //
      // This is the third pass. The first swung +-0.21 about 0.84 and spent 37%
      // of its time visibly down: a strobe. The second cut that to three small
      // noise rates about 0.90 bottoming near 0.78, and came back as too
      // subtle. What the second one got wrong is not its range, which is very
      // nearly the range kept here. It is that it stood still: sampled at
      // 60fps, 30% of its frames were within 0.002 of the frame before and 63%
      // within 0.005, so a third of the time the light was doing nothing at
      // all. No amount of extra amplitude fixes that -- it makes a bigger
      // nothing with bigger jumps between.
      //
      // The cause is the noise itself. Smoothstep value noise has zero
      // derivative at every lattice node, so a channel at f Hz stalls f times a
      // second by construction and summing three of them just gives three sets
      // of stalls that sometimes line up. Which is why the tremble below is not
      // summed noise any more.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2; // -1..1

      // Tremble: a carrier at a flame's own flicker rate whose PHASE is dragged
      // about by slow noise. A flame's flutter has a frequency; what wanders is
      // where in the cycle it has got to, not whether it is happening at all.
      // Frequency-modulated like this it never stalls and never repeats, where
      // the bare sine underneath it would read as a hum. Two carriers, both
      // inside the 5..15Hz band a real candle flickers in and nothing faster:
      // at 60fps a 20Hz carrier is three frames to a period and comes out as
      // sparkle rather than as tremble.
      const wobble = (f, drift, o) => Math.sin(Math.PI * 2 * (t * f + noise(t * drift + o) * 4));
      const tremble = 0.034 * wobble(7.3, 0.6, 12.4) + 0.020 * wobble(12.9, 0.9, 55.1);

      // Wander: the slow breathing underneath, over a second or two. Summed
      // noise is right for this one and its stalls are a feature here -- a lull
      // is exactly what the slow channel is for, and the tremble is still
      // running through it.
      const wander = 0.048 * swing(0.79, 0) + 0.034 * swing(2.3, 17.5);

      // Gutter. Only the top of a slow channel counts, so the events are
      // separate things that happen rather than a rhythm, and squaring the ramp
      // keeps the deep part of each one brief while its onset and recovery stay
      // soft. Its depth wobbles on a fast channel of its own, because a flame
      // fighting for air does not duck smoothly.
      const g = noise(t * 0.45 + 77.3);
      const gutter = g > 0.73 ? (g - 0.73) / 0.27 : 0;
      const dip = gutter * gutter * (0.40 + 0.28 * noise(t * 9.3 + 5.1));

      // Flare, the gutter's other half and the one that was missing: now and
      // then the flame straightens, stands up and the whole face goes pale for
      // a second. Built the same way off a slow channel of its own, and set
      // rarer than the gutter, because a flame droops far more often than it
      // draws itself up.
      const fl = noise(t * 0.37 + 143.9);
      const flareRamp = fl > 0.80 ? (fl - 0.80) / 0.20 : 0;
      const flare = flareRamp * flareRamp * (0.11 + 0.07 * noise(t * 7.1 + 91.2));

      // A soft ceiling rather than a clamp, and this is what lets the flare be
      // as big as it is without undoing the carving. Clamped at 1, every flare
      // and a good many ordinary peaks landed flat on the ceiling and sat
      // there, which pins the plate at GLOW.max -- the one state in which the
      // per-vertex falloff stops separating the openings and the cut walls go
      // back to being invisible. This bends the top over instead, matching both
      // value and slope at the knee and asymptoting above it, so a flare comes
      // out as a peak with a shape on it and the plate never quite arrives.
      const KNEE = 0.90;
      const raw = 0.900 + tremble + wander + flare - dip;
      // 0 = guttering, 1 = flaring
      const level = raw <= KNEE
        ? Math.max(0, raw)
        : 1 - (1 - KNEE) * Math.exp(-(raw - KNEE) / (1 - KNEE));

      // What all of that measures, over ten simulated minutes a seed at 60fps,
      // against the pass it replaces:
      //
      //                          this      previous
      //   mean level             0.876     0.877     unchanged, on purpose
      //   spread (sd)            0.084     0.080     the range is NOT the fix
      //   1st percentile         0.50      0.53
      //   99th / max             0.97/0.99 0.98/1.00 no longer pinned
      //   mean step per frame    0.0182    0.0047    four times as much motion
      //   frames within 0.002    8.7%      30.2%     this is the fix
      //
      // and as events, counted with a 0.05 re-arm so the tremble is not
      // miscounted as an event: a duck below 0.80 every 3 seconds, below 0.70
      // every 11, a real gutter past 0.50 every 17 to 33, the deepest past 0.40
      // every 40 to 100, and a flare over 0.96 every 4. The previous pass, on
      // the same metric, went below 0.80 every 10 seconds and past 0.50 every
      // 37 -- fewer events, and nothing at all happening between them.

      const at = (range) => range.min + (range.max - range.min) * level;
      light.intensity = at(LAMP) * LAMP_GAIN;
      // The shell glows off the same flame, so it rides the same level and the
      // same colour. Scaled with the prop rather than with the prop squared:
      // it stands in for an area source whose area goes as sizeK^2 seen from a
      // distance that goes as sizeK, and those two mostly cancel.
      glowLamp.intensity = at(GLOW_LAMP) * sizeK;
      // Lamp, carving and bloom all come off the one value: that is the whole
      // trick. The carving's range is shallower because a real cut-out stays
      // near saturation even as the spill on the ground drops away.
      faceMat.emissiveIntensity = at(GLOW);
      shellMat.emissiveIntensity = at(SKIN_GLOW);
      wallMat.emissiveIntensity = at(WASH);
      // A guttering flame reddens as it drops and a flaring one goes whiter, so
      // the colour rides the same value rather than sitting at a fixed warm
      // white. The plate has to do it too, not just the lamp: the openings are
      // most of what is on screen, and a dip that only dims them reads as a
      // dimmer where a dip that reddens them reads as a flame short of air.
      //
      // Fed the level straight, though, the mix only ever travelled the top
      // quarter of ember..flame, because that is where the level lives. So it
      // is levered about the level's own mean instead: the resting colour is
      // the one this file was tuned to, to three figures, and only the
      // excursions change -- a real gutter now runs the whole way down to ember
      // and a flare the whole way up to flame.
      const hue = Math.min(1, Math.max(0, HUE_MID + (level - HUE_MID) * HUE_GAIN));
      light.color.copy(EMBER).lerp(FLAME, hue);
      glowLamp.color.copy(light.color);
      faceMat.emissive.copy(PLATE_EMBER).lerp(PLATE_FLAME, hue);

      // The flame is an object and it moves, and this is the half of the effect
      // that modulating intensity cannot reach. Brightening and dimming in
      // place can only pump the pool; moving the source swings the cone, slides
      // the gobo's projected face across the floor and changes which side of
      // every cut wall is lit. The lamp's target is parented to the group and
      // stays where it is, so a step sideways is also a small yaw of the cone.
      //
      // Taken in the flame's own frame: `across` runs along the face, `into`
      // back through the shell. Both ride sizeK, or the tiny one's flame would
      // be swinging a third of its own body across the inside of its shell.
      // Across is half slow noise and half a carrier of its own, so the tip
      // whips at about the rate the brightness trembles at instead of drifting
      // smoothly while the light flickers.
      const across = 0.040 * sizeK * (0.55 * swing(0.83, 5.5) + 0.45 * wobble(5.9, 0.5, 71.6));
      const into = 0.030 * sizeK * swing(0.61, 2.7);
      // Up on a flare, down in a gutter, and a fine bob the rest of the time: a
      // flame that stands up is a flame reaching higher, and one starved of air
      // sinks back into the shell. Tied to the same two events, so a gutter
      // drops the pool nearer the pumpkin as it dims it.
      const rise = sizeK * (0.018 * swing(1.3, 8.1) + 0.055 * flare - 0.045 * dip);
      light.position.set(
        lightHome.x + faceTan.x * across + faceDir.x * into,
        lightHome.y + rise,
        lightHome.z + faceTan.z * across + faceDir.z * into,
      );
    },
    dispose() {
      for (const g of [shellGeo, wallGeo, faceGeo, stemGeo]) g.dispose();
      for (const m of [shellMat, wallMat, faceMat, stemMat]) m.dispose();
      goboMap?.dispose();
      group.clear();
    },
  };
}

// Sweeps a circular cross-section of varying radius along a curve. Frenet
// frames keep the tube from twisting; radius(t) does the taper, the flare and
// the rounded tip.
//
// Normals are analytic rather than from computeVertexNormals. Where the radius
// rolls off to nothing at the tip the triangles go degenerate, and averaged
// face normals there come out as a dark pinched spot; the closed form tilts
// smoothly to point straight along the axis instead.
function sweep(curve, radius, along, around) {
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
    const r = radius(t);
    // Slope of the radius profile, in units of the curve's own arc length.
    const slope = (radius(hi(t)) - radius(lo(t))) / ((hi(t) - lo(t)) * speedAt(t));
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
  // Close the (hidden) base with a fan. The far end needs no cap: its radius
  // already rolls off to a point.
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
