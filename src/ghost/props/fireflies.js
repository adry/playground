import * as THREE from 'three';

// The pellets: a field of hovering fireflies strung along the corridor
// centrelines, which the ghost sweeps up one at a time.
//
// THE CONSTRAINT THAT SHAPES EVERYTHING HERE
//
// A level carries a hundred or more of these and not one of them may be a
// light. Six pumpkins and ten lanterns already put point lights into every
// fragment shader's light loop; a hundred more would not dim the scene, it
// would end it. So a firefly is a self-lit thing that never illuminates
// anything else: a billboarded sprite with its glow painted in, and the whole
// field is ONE InstancedMesh, so a hundred of them is one draw call and two
// hundred triangles.
//
// For the same reason nothing about them is animated on the CPU. Drift and
// pulse are functions of one time uniform and a handful of per-instance
// attributes, evaluated in the vertex shader, so update() is a single
// assignment however many fireflies are on the floor. The only per-frame CPU
// work proportional to the count is none.
//
// WHY THEY ARE LEGIBLE ON A PALE FLOOR
//
// The scene's floor is a light grey lit by a 2.1 key, and a purely additive
// sprite on a light background barely registers: adding light to something
// that is already bright moves it a few per cent toward white and the shape
// disappears. The first pass looked fine on black and vanished on the ground.
//
// So a firefly is drawn in two parts with one blend mode. The BEAD is a small
// opaque disc in three bands, a blown-out white middle, a warm green ring and
// a near-black rim, which gives the thing an outline and therefore a shape
// that survives any background, bright or dark. The HALO around it is additive
// and carries the glow. Both come out of one fragment shader because the
// material blends PREMULTIPLIED alpha: dst is scaled by 1 - src.a, and src.rgb is added on
// top, so alpha = 0 with colour is pure addition (the halo) and alpha = 1 with
// colour replaces (the bead). One material, one draw call, and the sprite can
// be darker than the floor and brighter than the sky in the same pixel.

// --- palette ---------------------------------------------------------------
//
// A touch greener than the pumpkins' #ffc061, so the two kinds of light read
// as different kinds of thing at a glance. The bead core is nearly white with
// a green cast, because a small light source of any colour blows out to white
// in its middle, and the halo carries the actual hue.
const CORE_COLOR = '#fff6d2';
const HALO_COLOR = '#d2ee55';
// Not black. A dead-black rim reads as a hole punched in the floor; a very
// dark green reads as the unlit body of the insect.
const RIM_COLOR = '#141c0d';

// --- sprite geometry, in units of the quad's half extent -------------------
// The quad is 2 by 2 in local space and scaled by SIZE world units, so d = 1
// is the edge of the halo and everything below is a fraction of that.
const BEAD_R = 0.30;    // the opaque bead ends here
const BEAD_SOFT = 0.10; // and fades over this much, so its edge is not a stair
const CORE_IN = 0.07;   // solid bright out to here
const CORE_OUT = 0.26;  // and dark by here, which is the rim
const HALO_K = 5.2;     // gaussian falloff of the additive glow

// World size of one firefly, the half extent of its quad. The bead is BEAD_R
// of it, so about 0.10 across, and the halo reaches 0.17 from the centre. At
// the scene's own framing that is a bead of about 7 pixels in a glow of 24.
const SIZE = 0.17;

// How bright the bead and halo are before the pulse rides on them. These are
// linear values fed through the scene's ACES curve, so the core sits above 1
// on purpose: it is the one thing in the graveyard allowed to clip.
const CORE_GAIN = 2.60;
const WARM_GAIN = 1.15;  // the halo hue at bead strength, the ring inside it
const HALO_GAIN = 0.66;
// How hard the pulse rides the halo compared with the bead. See the fragment
// shader for why it is not 1.
const HALO_PULSE_EXP = 2.2;

// Hover band. The ghost's eyes are at about 0.8, so a pellet at this height is
// something it swallows rather than steps on. The band is narrower than the
// 0.5 to 0.9 it is allowed because the vertical drift and the bob are added on
// top of it: at the worst phase of both, an anchor at 0.58 reaches 0.506 and
// one at 0.82 reaches 0.894, so the whole field stays inside the band rather
// than merely centring on it.
const HOVER = { min: 0.58, max: 0.82 };

// --- the pulse -------------------------------------------------------------
//
// The trap the candle flicker fell into: summed smoothstep value noise has
// zero derivative at every lattice node, so a channel at f Hz stands still f
// times a second, and three of them summed just gives three sets of stalls
// that occasionally line up. A firefly pulse is slower and softer than a
// candle's, which makes a stall MORE visible and not less, because there is no
// fast tremble on top of it to hide the freeze.
//
// So the pulse is two sine carriers whose PHASE is dragged around by two much
// slower sines. Frequency modulated like that a carrier never stalls (its
// derivative is zero only at the instantaneous peak, and the peak keeps
// moving) and never repeats, because the carrier and its modulator are at
// incommensurate rates.
//
// Measured over fifteen simulated minutes at 60fps, on the level in 0 to 1
// that comes out of fireflyPulse, beside the same job done with two summed
// smoothstep value noise channels of the same amplitudes. The noise is shown
// twice: once at the rates a firefly pulse actually wants, and once with its
// rates scaled up by 5.6 until its mean step per frame MATCHES this one, so
// the stall figure cannot be waved away as the noise version simply being
// slower.
//
//                        this        noise, same rate   noise, matched speed
//   mean level           0.597       0.591 to 0.605     0.596 to 0.610
//   spread (sd)          0.221       0.154 to 0.162     0.156 to 0.159
//   1st percentile       0.192       0.263 to 0.285     0.273 to 0.280
//   99th / max           0.96/0.96   0.91 to 0.93       0.93/1.02
//   mean step per frame  0.0138 to 0.0162    0.0028     0.0156 to 0.0164
//   frames within 0.002  6.4 to 7.5%   46.7 to 48.7%    9.9 to 11.4%
//
// The last row is the whole reason the pulse is written the way it is. Seeds
// 1, 2 and 7 give the ranges above, so it is the technique and not one lucky
// stream. At the rate a firefly wants, summed noise spends nearly half its
// life standing still.
const PULSE = {
  mid: 0.60,      // level about which the carriers swing
  a1: 0.29,       // fast carrier, the breath itself
  a2: 0.13,       // slow carrier, so no two breaths are the same size
  ratio: 0.41,    // second carrier's rate as a fraction of the first
  fm1: 0.22,      // how far the fast carrier's phase is dragged, in cycles
  fm2: 0.31,
  drift1: 0.071,  // rates of the two draggers, in Hz, deliberately unrelated
  drift2: 0.113,
  knee: 0.88,     // soft ceiling, so a bright peak has a shape and not a flat
};

// A pellet must stay visible, so the pulse never takes a firefly out. At level
// 0 the bead is still a bead, because its middle is clipped white at either
// end of the swing, and the halo, which carries most of the visible change,
// falls to about a fifth of its brightest. That reads as a lull, not as an
// extinction, which matters: a pellet the player cannot see is a pellet the
// player cannot plan a route through.
const PULSE_MIN = 0.62;
const PULSE_MAX = 1.22;

// --- collect ---------------------------------------------------------------
// Duration of the take, in seconds. Long enough to see, short enough that a
// player sweeping a corridor at speed is not trailed by a queue of them.
const COLLECT_TIME = 0.52;
const COLLECT_RISE = 0.42;  // how far it lifts as it goes
const COLLECT_SWELL = 1.05; // extra size at the flash, as a fraction
const COLLECT_FLASH = 1.60; // extra brightness at the flash

// The tiny PRNG the stones use, copied rather than imported so a field of
// fireflies does not pull the headstone module and its canvases in with it.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The pulse, written once in GLSL and once in JS. Both are generated from the
// PULSE constants above so the numbers cannot drift apart; if you change the
// SHAPE of one, change the other, because the JS twin is what the stall
// measurement runs on and it is only worth anything while it matches.
const PULSE_GLSL = /* glsl */`
  // t: seconds. f: this firefly's own carrier rate in Hz. p: its phase seeds.
  float fireflyPulse(float t, float f, vec4 p) {
    float TAU = 6.2831853;
    float drag1 = sin(TAU * (t * ${PULSE.drift1.toFixed(4)} + p.z));
    float drag2 = sin(TAU * (t * ${PULSE.drift2.toFixed(4)} + p.w));
    float c1 = sin(TAU * (t * f + p.x + ${PULSE.fm1.toFixed(3)} * drag1));
    float c2 = sin(TAU * (t * f * ${PULSE.ratio.toFixed(3)} + p.y + ${PULSE.fm2.toFixed(3)} * drag2));
    float raw = ${PULSE.mid.toFixed(3)} + ${PULSE.a1.toFixed(3)} * c1 + ${PULSE.a2.toFixed(3)} * c2;
    // Soft ceiling rather than a clamp: matched in value and slope at the knee
    // and asymptotic above it, so the top of a breath is a curve and not a
    // plateau the level sits on.
    float k = ${PULSE.knee.toFixed(3)};
    return raw <= k ? max(0.0, raw) : 1.0 - (1.0 - k) * exp(-(raw - k) / (1.0 - k));
  }
`;

// The JS twin of the above. Exported for the stall measurement only.
export function fireflyPulse(t, f, p) {
  const TAU = Math.PI * 2;
  const drag1 = Math.sin(TAU * (t * PULSE.drift1 + p[2]));
  const drag2 = Math.sin(TAU * (t * PULSE.drift2 + p[3]));
  const c1 = Math.sin(TAU * (t * f + p[0] + PULSE.fm1 * drag1));
  const c2 = Math.sin(TAU * (t * f * PULSE.ratio + p[1] + PULSE.fm2 * drag2));
  const raw = PULSE.mid + PULSE.a1 * c1 + PULSE.a2 * c2;
  const k = PULSE.knee;
  return raw <= k ? Math.max(0, raw) : 1 - (1 - k) * Math.exp(-(raw - k) / (1 - k));
}

const VERTEX = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform float uSize;
  uniform float uScale;

  // Per instance. instanceMatrix carries the anchor (three declares it for us
  // because this is an InstancedMesh), so these only carry the motion.
  attribute vec4 aPulse;   // xy: carrier phases, zw: dragger phases
  attribute vec4 aDrift;   // xyz: drift amplitude, w: this firefly's pulse rate
  attribute vec4 aRate;    // xyz: drift rates in Hz, w: bob rate
  attribute vec4 aOffset;  // xyz: drift phases, w: bob phase
  attribute float aTaken;  // time the collect began, or -1 while it is alive

  varying vec2 vQuad;
  varying float vBright;
  varying float vFade;
  varying float vBead;
  varying float vFlash;

  #include <fog_pars_vertex>

  ${PULSE_GLSL}

  void main() {
    float t = uTime;

    // DRIFT. Two sines per axis at rates that are not multiples of each other,
    // so the path is a slow open Lissajous that never closes and never repeats.
    // Bounded by the amplitude itself, which is the whole point: a pellet that
    // drifts is charming, a pellet that leaves its corridor is a bug, and the
    // sum of the two terms below can never exceed aDrift no matter the phase.
    float TAU = 6.2831853;
    vec3 d1 = vec3(
      sin(TAU * (t * aRate.x + aOffset.x)),
      sin(TAU * (t * aRate.y + aOffset.y)),
      sin(TAU * (t * aRate.z + aOffset.z))
    );
    vec3 d2 = vec3(
      sin(TAU * (t * aRate.x * 1.61 + aOffset.z)),
      sin(TAU * (t * aRate.y * 1.37 + aOffset.x)),
      sin(TAU * (t * aRate.z * 1.83 + aOffset.y))
    );
    vec3 drift = aDrift.xyz * (0.62 * d1 + 0.38 * d2);
    // A small quick bob on top, because insects do not glide.
    drift.y += aDrift.y * 0.35 * sin(TAU * (t * aRate.w + aOffset.w));

    float pulse = fireflyPulse(t, aDrift.w, aPulse);
    float bright = ${PULSE_MIN.toFixed(3)} + (${(PULSE_MAX - PULSE_MIN).toFixed(3)}) * pulse;
    // A brighter firefly reads as a slightly bigger one, but only slightly:
    // past about a tenth the pulse starts to look like it is moving toward the
    // camera rather than glowing harder.
    float size = uSize * uScale * (0.94 + 0.10 * pulse);
    float fade = 1.0;
    // The bead's radius as a fraction of the quad. It only moves during a
    // collect, and it is what keeps the flash from reading as a balloon: the
    // quad grows so the halo can bloom, and the bead shrinks by the same
    // factor so the body of the insect stays the size it always was.
    float bead = 1.0;
    float flash = 1.0;

    // COLLECT. aTaken is the clock time the take began. Everything about the
    // animation is a function of how long ago that was, so taking a firefly is
    // one attribute write and no per-frame bookkeeping at all.
    if (aTaken >= 0.0) {
      float e = clamp((t - aTaken) / ${COLLECT_TIME.toFixed(3)}, 0.0, 1.0);
      // A flash on the way out: a narrow bump early, then a shrink to nothing
      // while it lifts. The bead going out is what tells the player it counted.
      float swell = exp(-pow((e - 0.16) / 0.15, 2.0));
      float shrink = 1.0 - smoothstep(0.22, 1.0, e);
      float grow = 1.0 + ${COLLECT_SWELL.toFixed(3)} * swell;
      size *= grow * shrink;
      bead = (1.0 + 0.25 * swell) / grow;
      // The flash is kept OUT of the pulse level and multiplied in at the end,
      // because the halo raises the pulse to a power greater than one: pushed
      // through that, a flash of this size comes out as a flat white disc with
      // no falloff left in it, which reads as a bubble and not as a spark.
      flash = 1.0 + ${COLLECT_FLASH.toFixed(3)} * swell;
      drift.y += ${COLLECT_RISE.toFixed(3)} * smoothstep(0.0, 1.0, e);
      fade = shrink;
      // Fully spent. Collapse the quad to a point so it rasterises nothing at
      // all, which is cheaper and safer than trusting a zero alpha.
      if (e >= 1.0) size = 0.0;
    }

    vQuad = position.xy;
    vBright = bright;
    vFade = fade;
    vBead = bead;
    vFlash = flash;

    // Billboard in view space. The scene's camera is a fixed orthographic
    // isometric, but doing it this way costs nothing and keeps the sprite
    // square to whatever camera a lab or a menu screen points at it.
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(drift, 1.0);
    centre.xy += position.xy * size;
    gl_Position = projectionMatrix * centre;

    // The scene fogs to the backdrop from 24 units out, and a field that spans
    // the level has fireflies out there. Depth is taken from the sprite's
    // centre rather than its corners so a quad cannot fog unevenly across
    // itself.
    #ifdef USE_FOG
      vFogDepth = -centre.z;
    #endif
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  // The tone mapping and colour space helpers are already in the renderer's
  // own fragment prefix, so including their pars chunks here redefines every
  // one of them and the program fails to link. Only fog needs declaring.
  #include <fog_pars_fragment>

  uniform vec3 uCore;
  uniform vec3 uWarm;
  uniform vec3 uHalo;
  uniform vec3 uRim;

  varying vec2 vQuad;
  varying float vBright;
  varying float vFade;
  varying float vBead;
  varying float vFlash;

  void main() {
    float d = length(vQuad);
    if (d > 1.0) discard;
    // The bead is measured in its own radius, so a collect can bloom the halo
    // without inflating the body with it. Outside a collect vBead is 1 and
    // this is the same number.
    float b = d / vBead;

    // The bead: an opaque disc with a soft edge. This is the part that gives a
    // firefly a shape on a pale floor, and it is why the material blends
    // premultiplied rather than additive.
    float bead = 1.0 - smoothstep(${(BEAD_R - BEAD_SOFT).toFixed(3)}, ${BEAD_R.toFixed(3)}, b);
    // Three bands across it, which is what makes a small disc read as a light
    // rather than as a sticker: a blown-out white middle, the warm green of
    // the glow around it, and the dark rim that draws the outline.
    float core = 1.0 - smoothstep(${CORE_IN.toFixed(3)}, ${CORE_OUT.toFixed(3)}, b);
    float rim = smoothstep(${(CORE_OUT * 0.8).toFixed(3)}, ${BEAD_R.toFixed(3)}, b);
    vec3 body = mix(uWarm, uCore, core) * vBright * vFlash;
    vec3 beadColor = mix(body, uRim, rim);

    // The halo: additive, and held out of the bead so the dark rim cannot be
    // filled back in by its own glow.
    float halo = exp(-d * d * ${HALO_K.toFixed(2)}) * (1.0 - bead);

    // The pulse is carried mostly by the HALO. The bead's middle is blown out
    // by design and cannot get any whiter, so putting the swing there would
    // make a light that breathes on paper and sits still on screen. The glow
    // around it has all the headroom in the world, which is why the exponent
    // below is greater than one: it exaggerates what is actually visible.
    float glow = pow(vBright, ${HALO_PULSE_EXP.toFixed(2)});

    float alpha = bead * vFade;
    vec3 rgb = beadColor * alpha + uHalo * halo * glow * vFlash * vFade;

    gl_FragColor = vec4(rgb, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // Fog, but not three's fog_fragment chunk, which mixes toward the fog
    // COLOUR. On a premultiplied sprite that would paint a grey square over
    // the floor wherever the halo is transparent. Fogging a light means it
    // stops reaching you, so both the colour and the coverage go to zero
    // together and the sprite dissolves into the backdrop instead.
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor *= 1.0 - fogFactor;
    #endif
  }
`;

/**
 * A field of fireflies.
 *
 * @param {object}   opts
 * @param {number}   opts.seed    varies hover height, pulse rate and drift
 * @param {Array}    opts.points  [{ x, z }] on corridor centrelines
 * @param {number}   opts.scale   size of one firefly, 1 is the authored size
 * @returns {{
 *   group: THREE.Group,
 *   update: (time: number, dt: number) => void,
 *   collect: (index: number) => boolean,
 *   reset: () => void,
 *   count: number,
 *   positions: Float32Array,
 *   collected: Uint8Array,
 *   remaining: () => number,
 *   isCollected: (index: number) => boolean,
 *   dispose: () => void,
 * }}
 */
export function createFireflies({ seed = 1, points = [], scale = 1 } = {}) {
  const rng = mulberry32(Math.imul(seed >>> 0, 2654435761) + 12345);
  const count = points.length;
  const n = Math.max(1, count); // buffers of length zero upset some drivers

  // Two triangles. A quad 2 by 2 in local space so its corners land at
  // plus and minus one and the fragment shader's radius is a clean fraction.
  const geometry = new THREE.PlaneGeometry(2, 2);

  const pulseAttr = new Float32Array(n * 4);
  const driftAttr = new Float32Array(n * 4);
  const rateAttr = new Float32Array(n * 4);
  const offsetAttr = new Float32Array(n * 4);
  const takenAttr = new Float32Array(n).fill(-1);

  // What the rules layer tests proximity against: the ANCHOR of each firefly,
  // not its drifting position. Drift is bounded well below any sensible pickup
  // radius, so the anchor is the honest centre of the thing and a pellet does
  // not become easier or harder to take depending on which way it happens to
  // be leaning.
  const positions = new Float32Array(count * 3);
  const collected = new Uint8Array(count);

  const uniforms = {
    // Fog uniforms have to be present by name, because the renderer refreshes
    // them by writing straight into this object when material.fog is true.
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uSize: { value: SIZE },
    uScale: { value: scale },
    uCore: { value: new THREE.Color(CORE_COLOR).convertSRGBToLinear().multiplyScalar(CORE_GAIN) },
    uWarm: { value: new THREE.Color(HALO_COLOR).convertSRGBToLinear().multiplyScalar(WARM_GAIN) },
    uHalo: { value: new THREE.Color(HALO_COLOR).convertSRGBToLinear().multiplyScalar(HALO_GAIN) },
    uRim: { value: new THREE.Color(RIM_COLOR).convertSRGBToLinear() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Premultiplied alpha, which is what lets one sprite be both darker and
    // brighter than what it sits on. src is added as it comes and dst is
    // scaled by 1 - src.a, so alpha 0 with colour is a pure additive glow and
    // alpha 1 with colour is an opaque bead.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // Tested against the scene so a headstone in front of a firefly hides it,
    // but never written, so a hundred overlapping halos do not fight.
    depthTest: true,
    depthWrite: false,
    toneMapped: true,
    fog: true,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const m = new THREE.Matrix4();

  for (let i = 0; i < count; i++) {
    const p = points[i];
    const y = HOVER.min + (HOVER.max - HOVER.min) * rng();
    positions[i * 3 + 0] = p.x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = p.z;
    m.makeTranslation(p.x, y, p.z);
    mesh.setMatrixAt(i, m);

    // Four independent phases per firefly. The carrier phases alone would be
    // enough to keep a hundred of them out of step for a while, but not
    // forever: with one rate they would beat back into unison. The RATE varies
    // too, which is what makes the field permanently incoherent.
    pulseAttr[i * 4 + 0] = rng();
    pulseAttr[i * 4 + 1] = rng();
    pulseAttr[i * 4 + 2] = rng();
    pulseAttr[i * 4 + 3] = rng();

    // Drift amplitudes, in world units. Horizontal is the number that matters:
    // a corridor is 2.0 wide and a firefly sits on its centreline, so even the
    // widest of these leaves 0.85 of clearance to the kerb.
    driftAttr[i * 4 + 0] = (0.055 + 0.070 * rng()) * scale;
    driftAttr[i * 4 + 1] = (0.025 + 0.030 * rng()) * scale;
    driftAttr[i * 4 + 2] = (0.055 + 0.070 * rng()) * scale;
    driftAttr[i * 4 + 3] = 0.62 + 0.46 * rng(); // pulse rate, Hz

    rateAttr[i * 4 + 0] = 0.055 + 0.075 * rng();
    rateAttr[i * 4 + 1] = 0.070 + 0.090 * rng();
    rateAttr[i * 4 + 2] = 0.055 + 0.075 * rng();
    rateAttr[i * 4 + 3] = 0.45 + 0.55 * rng(); // the quick bob

    offsetAttr[i * 4 + 0] = rng();
    offsetAttr[i * 4 + 1] = rng();
    offsetAttr[i * 4 + 2] = rng();
    offsetAttr[i * 4 + 3] = rng();
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;

  const taken = new THREE.InstancedBufferAttribute(takenAttr, 1);
  geometry.setAttribute('aPulse', new THREE.InstancedBufferAttribute(pulseAttr, 4));
  geometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(driftAttr, 4));
  geometry.setAttribute('aRate', new THREE.InstancedBufferAttribute(rateAttr, 4));
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsetAttr, 4));
  geometry.setAttribute('aTaken', taken);


  // The vertex shader moves every corner in view space, so three's bounding
  // sphere describes where the anchors are and not where the sprites end up.
  // Rather than pad it and hope, the field opts out: it is one draw call for
  // the whole level, and the only thing culling it could ever save is that one
  // call in the rare frame where no corridor at all is on screen.
  mesh.frustumCulled = false;
  // After the opaque pass, with the other transparent props.
  mesh.renderOrder = 3;

  const group = new THREE.Group();
  group.name = 'fireflies';
  group.add(mesh);

  let now = 0;

  return {
    group,
    count,
    positions,
    collected,

    // `time` is the scene clock in seconds, the same one every other prop's
    // update takes. If a caller only has a dt, this still runs: the clock is
    // accumulated instead. One uniform write, whatever the count.
    update(time, dt = 0) {
      now = Number.isFinite(time) ? time : now + (Number.isFinite(dt) ? dt : 0);
      uniforms.uTime.value = now;
    },

    // Take one. Returns false if the index is not a live firefly, so the rules
    // layer can call it on a proximity hit without tracking state twice.
    collect(index) {
      if (!(index >= 0) || index >= count || collected[index]) return false;
      collected[index] = 1;
      takenAttr[index] = now;
      taken.needsUpdate = true;
      return true;
    },

    reset() {
      collected.fill(0);
      takenAttr.fill(-1);
      taken.needsUpdate = true;
    },

    isCollected(index) {
      return collected[index] === 1;
    },

    remaining() {
      let left = 0;
      for (let i = 0; i < count; i++) if (!collected[i]) left++;
      return left;
    },

    dispose() {
      group.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
