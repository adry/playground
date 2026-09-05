import * as THREE from 'three';
import { ClothSim } from './cloth.js';

// The ghost is a single sheet of cloth: a hemispherical head that flows into a
// flared, scalloped skirt. Nothing is rigid — the head only holds its shape
// because shape memory is strong there.
//
// The eyes are painted into the fabric's UV space rather than being separate
// meshes. That means they deform with the cloth for free, stay glued to the
// front as the body turns, and can never drift off the surface.
//
// ===========================================================================
// DRIVEN BODIES, AND WHY THE CLOTH CARES
// ===========================================================================
//
// On /ghostly/ this model is the only authority: input goes in, the body moves,
// the sheet hangs off the result. In the game it is NOT. rules.js owns where
// the ghost is, because collision, catching, the vault and every fairness check
// depend on the rules being the truth, and the scene used to reconcile the two
// by letting this model integrate and then OVERWRITING its position afterwards.
//
// That is fine for the body and wrong for the sheet. A Verlet cloth infers its
// velocity from how far its anchor moved since the last substep, so a
// correction applied between frames is not a correction to the cloth, it is a
// tug. Both integrators are the same model with the same numbers -- an
// exponential approach to input times speed with a 0.12 s time constant -- and
// scene.js already matches the speed. What they did not share is HOW THEY CUT
// THE FRAME UP: this one takes two substeps of 1/120, and rules.js takes one of
// 1/60, because its own cap of maxStep/fastest is 54.6 ms and a frame fits
// inside it whole. Explicit Euler is not invariant to that. Two half steps and
// one whole step of the same approach land up to 1.9 mm apart, every frame,
// and the sheet was being handed that gap as motion.
//
// Measured over 20 s of the same stick, the change in the anchor's travel from
// one substep to the next:
//
//                         p50        p99        max     substeps rougher
//                                                        than half a mm
//   /ghostly/          0.135 mm   0.425 mm   1.971 mm         0.9%
//   the game, before   0.201 mm   2.125 mm   2.645 mm        35.1%
//
// Five times the jerk at the tail, on a third of all substeps, on a sheet whose
// whole job is to react to motion. That is what the owner saw as a wind on the
// game's ghost and not on /ghostly/'s.
//
// So `update` takes an optional `drive`: the position the caller insists the
// body reaches by the end of the frame. The body still integrates, still turns,
// still leans and still hops on its own; only its horizontal position is laid
// out along a straight line to the driven point, one share per substep. The
// rules keep owning where the ghost IS, exactly as before, and the sheet is
// handed a smooth path instead of a correction.

const TAU = Math.PI * 2;

// The step the cloth is tuned for, and the most of them one frame may run.
// At 60fps this is exactly the two substeps the solver shipped with, so a
// frame at the intended rate is unchanged to the bit.
const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 4;

const DEFAULTS = {
  rings: 26,
  segments: 60,
  // The hem is finished with a rolled lip built from the simulated edge rather
  // than simulated itself. A real hem barely affects how a sheet moves, and
  // generating it means it can never unroll or fight the solver.
  hemRows: 5,
  hemRadius: 0.032,
  headRadius: 0.42,
  headSpan: 0.36,   // fraction of the sheet that forms the head dome
  bodyHeight: 1.18,
  flare: 0.44,
  scallop: 0.1,     // wave in the hem
  hoverHeight: 1.34,
  // Feel: quick off the mark and quick to stop. accelTime governs both, so
  // lowering it is what makes the ghost feel connected to the input rather
  // than merely fast.
  maxSpeed: 4.5,
  accelTime: 0.12,
  turnRate: 11.0,

  // THE HOP, and why it is two numbers rather than a hard-coded pair.
  //
  // 3.6 up against 9.0 down is 0.80 s in the air with an apex of 0.72, and it
  // was authored as CHARACTER: a slow floaty bob that suits a ghost drifting
  // round a graveyard, on the page where the hop means nothing but delight.
  //
  // The game needs the same hop to be an ACTION, because a jump is now how the
  // player crosses a fence, and 0.80 s is 2.4 units of committed travel that
  // sails past any fence it was aimed at. The game passes 5.0 and 20.0, which
  // is 0.50 s with an apex of 0.625: the arc looks almost the same and happens
  // in five eighths of the time. The apex is what you SEE and the air time is
  // what you FEEL, and only the second was wrong for the game.
  //
  // Both live here as options rather than one of them winning, because the two
  // pages want genuinely different things and there is no version that is right
  // for both. /ghostly/ keeps the hop it shipped with.
  jumpUp: 3.6,
  jumpGravity: 9.0,

  seed: undefined,
};

// Deterministic RNG. Blinks and glances are random, which would otherwise make
// every headless test run render something slightly different.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function smoothstep(t) {
  t = Math.min(Math.max(t, 0), 1);
  return t * t * (3 - 2 * t);
}

export class Ghost {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    const { rings: R, segments: S } = this.opts;

    this.time = 0;
    this.pos = new THREE.Vector3(0, this.opts.hoverHeight, 0);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI / 4; // face the camera on load
    this.lean = new THREE.Vector2();
    this.bob = 0;
    this.airY = 0;
    this.airV = 0;
    this.grounded = true;
    this.squash = 0;

    this.matrix = new THREE.Matrix4();
    this.axis = new THREE.Vector3();
    this.#buildRest();

    this.cloth = new ClothSim({
      rings: R,
      segments: S,
      rest: this.rest,
      invMass: this.invMass,
      shapeK: this.shapeK,
      minRadius: this.minRadius,
      pressure: this.pressure,
    });

    this.#buildGeometry();
    this.#buildMaterial();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    this.rand = mulberry32(this.opts.seed ?? (Math.random() * 2 ** 32));

    this.eyes = {
      // Rendered lid state, eased toward the targets each frame.
      open: 1,
      tilt: 0,
      curve: 0,
      scaleX: 1,
      scaleY: 1,

      blink: 0,
      blinkPhase: 0,
      blinkTimer: 1.4,
      blinkQueue: 0,

      squeeze: 0,   // eyes screwed shut on impact
      startle: 0,   // eyes flung wide on takeoff

      gaze: new THREE.Vector2(),
      gazeFrom: new THREE.Vector2(),
      gazeTo: new THREE.Vector2(),
      gazeT: 1,
      gazeDur: 0.07,
      holdTimer: 0.8,

      vor: 0,       // vestibulo-ocular: eyes hold still as the head whips round
      prevYaw: this.yaw,
      idleTime: 0,
      moodTimer: 0,
      moodCooldown: 1.2,
    };

    // Keep the rolled lip clear of the floor; the solver only knows about the
    // edge it simulates, which now sits a hem's thickness above the geometry.
    this.cloth.groundY = this.opts.hemRadius * 1.2;

    this.#composeMatrix();
    this.cloth.reset(this.matrix);
    this.#syncGeometry();
  }

  // --- rest pose ------------------------------------------------------------

  #buildRest() {
    const { rings: R, segments: S, headRadius, headSpan, bodyHeight, flare, scallop } = this.opts;
    const count = (R + 1) * S;

    this.rest = new Float32Array(count * 3);
    this.invMass = new Float32Array(count);
    this.shapeK = new Float32Array(count);
    this.minRadius = new Float32Array(count);
    this.pressure = new Float32Array(count);
    this.restRadius = new Float32Array(R + 1);

    for (let i = 0; i <= R; i++) {
      const t = i / R;
      let r;
      let y;
      let skirt = 0;

      if (t <= headSpan) {
        const a = (t / headSpan) * (Math.PI / 2);
        r = headRadius * Math.sin(a);
        y = headRadius * Math.cos(a);
      } else {
        skirt = (t - headSpan) / (1 - headSpan);
        r = headRadius * (1 + flare * Math.pow(skirt, 1.3));
        y = -bodyHeight * skirt;
      }
      this.restRadius[i] = r;

      // Shape memory: rigid through the head, then released quickly. The
      // falloff has to finish around headSpan -- if it lingers into the skirt,
      // the fabric snaps back before any trailing motion can be seen.
      const k = 0.30 * Math.pow(1 - smoothstep((t - 0.10) / 0.32), 2) + 0.002;

      for (let j = 0; j < S; j++) {
        const theta = TAU * (j / S);
        // theta = PI faces +Z, so the UV seam lands on the ghost's back.
        // Two coprime frequencies so the hem reads as folds of cloth rather
        // than a repeating scallop stamp.
        const wave = Math.cos(6 * theta) + 0.26 * Math.cos(11 * theta + 1.1);
        const rr = r * (1 + scallop * wave * skirt * skirt);
        const yy = y + 0.07 * (Math.cos(6 * theta + 0.6) + 0.3 * Math.cos(11 * theta + 2.2))
          * skirt * skirt;

        const p = i * S + j;
        const o = p * 3;
        this.rest[o] = rr * Math.sin(theta);
        this.rest[o + 1] = yy;
        this.rest[o + 2] = -rr * Math.cos(theta);

        this.invMass[p] = i <= 1 ? 0 : 1;
        this.shapeK[p] = i <= 1 ? 0 : k;
        this.minRadius[p] = i <= 1 ? 0 : r * 0.46;
        // Strongest through the middle of the skirt, easing off at the hem so
        // the edge still flutters instead of standing out like a lampshade.
        this.pressure[p] = i <= 1 ? 0 : 3.4 * Math.sin(Math.PI * Math.min(skirt * 1.15, 1)) * 0.9 + 0.4;
      }
    }
  }

  #buildGeometry() {
    const { rings: R, segments: S, hemRows } = this.opts;
    const cols = S + 1; // duplicated seam column so UVs are continuous
    const rows = R + 1 + hemRows;
    const verts = rows * cols;

    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const index = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const v = i * cols + j;
        uv[v * 2] = j / S;
        // v keeps running past 1 across the rolled rows, so the eye positions
        // stay where they were when the hem was a bare edge.
        uv[v * 2 + 1] = i / R;
        if (i < rows - 1 && j < S) {
          const a = i * cols + j;
          const b = a + 1;
          const c = a + cols;
          const d = c + 1;
          // Wind counter-clockwise seen from outside, so gl_FrontFacing is
          // true on the ghost's exterior and the eyes land on the right side
          // of the sheet.
          index.push(a, b, c, b, d, c);
        }
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(index);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
    this.cols = cols;
    this.rows = rows;
  }

  #buildMaterial() {
    // uOpen / uTilt / uCurve are a small lid rig rather than a single blink
    // value. Together they cover the whole expression range: wide, narrowed,
    // determined (upper lid tilted down at the inner corner), happy squint (a
    // thin band following an upward arc) and fully closed.
    //
    // The surface itself is deliberately flat: a solid dark oval with one crisp
    // catchlight. A physically shaded version reflecting the scene's lights was
    // tried and reverted -- it was more realistic and less characterful.
    this.eyeUniforms = {
      uEyeV: { value: 0.255 },
      uEyeSep: { value: 0.063 },
      uEyeSize: { value: new THREE.Vector2(0.034, 0.055) },
      uEyeScale: { value: new THREE.Vector2(1, 1) },
      uOpen: { value: 1 },
      uTilt: { value: 0 },
      uCurve: { value: 0 },
      uLook: { value: new THREE.Vector2() },
      uEyeTurn: { value: 0 },
      uEyeColor: { value: new THREE.Color('#1a1d2b').convertSRGBToLinear() },
      uGlint: { value: new THREE.Vector2(-0.3, -0.32) },
    };

    this.material = new THREE.MeshStandardMaterial({
      color: '#eceef5',
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.eyeUniforms);

      shader.vertexShader = `varying vec2 vGUv;\n${shader.vertexShader}`.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vGUv = uv;',
      );

      shader.fragmentShader = `
        varying vec2 vGUv;
        uniform float uEyeV;
        uniform float uEyeSep;
        uniform vec2 uEyeSize;
        uniform vec2 uEyeScale;
        uniform float uOpen;
        uniform float uTilt;
        uniform float uCurve;
        uniform vec2 uLook;
        uniform float uEyeTurn;
        uniform vec3 uEyeColor;
        uniform vec2 uGlint;

        // Eye-local coordinates, roughly -1..1 across the eye. u has to wrap
        // because it is an angle around the ghost. \`mirror\` flips x so that
        // +x is the outer corner for both eyes, which lets one tilt value
        // drive a symmetric pair of lids.
        //
        // Returns the lid field (positive inside the eye) and hands back the
        // unmirrored coordinates, which the catchlight needs so it sits on the
        // same side in both eyes instead of splaying outward.
        float ghostEyeField(vec2 uv, float cu, float cv, float mirror, out vec2 raw) {
          float du = fract(uv.x - cu + 0.5) - 0.5;
          float dv = uv.y - cv;
          raw = vec2(du / (uEyeSize.x * uEyeScale.x), dv / (uEyeSize.y * uEyeScale.y));
          vec2 e = vec2(raw.x * mirror, raw.y);

          // The eye is a band of half-thickness uOpen wrapped around a centre
          // line, not an ellipse clipped by straight lids. Clipping leaves hard
          // corners the moment the eye narrows; measuring distance from a bent
          // centre line keeps the contour rounded at every openness.
          //
          //   uCurve bows the line upward at the middle  -> happy crescent
          //   uTilt  slopes it down at the inner corner  -> determined
          //   uOpen  is the half-thickness               -> blink / narrow
          float centre = -uCurve * (1.0 - e.x * e.x) + uTilt * e.x;
          float open = max(uOpen, 0.05);
          return 1.0 - length(vec2(e.x, (e.y - centre) / open));
        }

        float ghostGlintField(vec2 raw) {
          return 1.0 - length((raw - uGlint) / 0.32);
        }
        ${shader.fragmentShader}
      `.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (gl_FrontFacing) {
          float cv = uEyeV + uLook.y;
          // uEyeTurn nudges the face around the sheet. The face otherwise
          // rides the body's front, so the ghost shows its back when it walks
          // away from you.
          float cu = 0.5 + uEyeTurn + uLook.x;

          vec2 rawL, rawR;
          float fL = ghostEyeField(vGUv, cu - uEyeSep, cv, -1.0, rawL);
          float fR = ghostEyeField(vGUv, cu + uEyeSep, cv, 1.0, rawR);
          float f = max(fL, fR);

          // Derivative-based edge so the lids stay crisp at any zoom.
          float mask = smoothstep(0.0, max(fwidth(f) * 1.4, 0.005), f);
          diffuseColor.rgb = mix(diffuseColor.rgb, uEyeColor, mask);

          float g = max(min(ghostGlintField(rawL), fL), min(ghostGlintField(rawR), fR));
          float gm = smoothstep(0.0, max(fwidth(g) * 1.6, 0.02), g);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), gm * 0.9);
        }`,
      );
    };
  }

  // Puts the sheet back onto the body, wherever the body has just been moved
  // to. THE MATRIX HAS TO BE REBUILT FIRST, and that is the whole reason this
  // exists rather than callers reaching for `cloth.reset(ghost.matrix)`.
  //
  // `ghost.matrix` is composed once per substep inside update(), so between a
  // teleport and the next update it still describes where the ghost USED TO
  // BE. Resetting against it pins every particle at the old place and then
  // lets the next frame drag the whole sheet across to the new one. On a level
  // start that is a spawn corner against the world origin: measured at a spawn
  // 11.5 units out, the sheet was reset centred on x = 0.01 with the body at
  // x = 11.5, and spent six frames between 9.8 and 2.4 units wide against a
  // rest width of 1.30 before it recovered. That is the distortion players saw
  // at the start of a run, and it is much the larger half of it.
  resetCloth() {
    this.#composeMatrix();
    this.cloth.reset(this.matrix);
    this.#syncGeometry();
  }

  // --- per-frame ------------------------------------------------------------

  // `drive` is an optional { x, z } the caller insists the body must reach by
  // the end of this frame. See the block above `at` below, and DRIVEN BODIES
  // in the class comment.
  update(dt, input, drive = null) {
    // THE SUBSTEP SIZE IS FIXED, THE COUNT IS NOT.
    //
    // This used to be a fixed COUNT of two, which made h grow with the frame.
    // The cloth is Verlet plus position-based constraints and it is tuned for
    // one step size; hand it a bigger one and it visibly tears away from the
    // body. The game clamps dt at 1/20 s, and a level start spends its first
    // frames there while props are still baking, so the sheet was being
    // stepped at 25 ms, three times what it is tuned for. That is the
    // distortion players saw at the start of a run.
    //
    // Measured over the same two seconds of input, shape error in body-local
    // space against a 1/960 s reference, in world units, before and after:
    //
    //   frame pattern                 max err        rms err     worst slack
    //   60fps steady               0.62 -> 0.60   0.241 -> 0.240  0.098 -> 0.098
    //   30fps steady               0.91 -> 0.59   0.351 -> 0.237  0.098 -> 0.098
    //   20fps steady, the clamp    2.08 -> 0.67   0.957 -> 0.245  0.468 -> 0.095
    //   0.6 s clamped then 60fps   0.85 -> 0.60   0.369 -> 0.239  0.468 -> 0.098
    //   alternating 4 / 50 ms      0.73 -> 0.60   0.274 -> 0.236  0.110 -> 0.097
    //
    // The ghost is 1.18 units tall, so 0.468 of stretch on a single edge is
    // the sheet coming apart, not a wobble. Afterwards the error no longer
    // depends on the frame rate at all, which is the point.
    //
    // AND WHAT THAT IS ON SCREEN, because that is the only test that counts.
    // The ghost is about 47 by 70 pixels at the shipped 900x700 framing, which
    // is 38.9 px per world unit. Worst edge overstretch, in pixels, over the
    // first twenty frames:
    //
    //   60fps, any input                     0 to  2 px    unchanged
    //   20fps, walking a straight line       3 px  ->  1 px
    //   20fps, changing direction fast      17 px  ->  4 px
    //
    // So the fault needed BOTH a long frame and a player working the stick,
    // which is exactly the first second of a run: the level is still baking and
    // the player is trying to move. A gentle walk at 20fps was never the
    // problem and this does not pretend to fix one.
    //
    // A steady 60fps frame is bit-identical to what shipped: round(2) is 2 and
    // (1/60)/2 is exactly 1/120, so nothing that was running well changes, and
    // the 60fps captures reproduce.
    //
    // The cap is what keeps a stall from turning into a spiral: past it the
    // ghost simply runs a little slow for that frame, which is invisible next
    // to the stall that caused it. Four bounds the cost at twice a 60fps
    // frame while still holding h to 12.5 ms at the clamp.
    const sub = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(dt / SUBSTEP)));
    const h = dt / sub;
    // Where the body starts the frame, so a driven path can be laid out across
    // the substeps rather than arriving all at once. See `drive` above.
    const sx = this.pos.x;
    const sz = this.pos.z;
    for (let s = 0; s < sub; s++) {
      this.time += h;
      let at = null;
      if (drive) {
        const k = (s + 1) / sub;
        at = { x: sx + (drive.x - sx) * k, z: sz + (drive.z - sz) * k };
      }
      this.#stepBody(h, input, at);
      this.cloth.substep(h, this.matrix, this.time, this.axis);
    }
    this.#updateEyes(dt);
    this.#syncGeometry();
  }

  // `at` is where an outside authority says the body must be at the END of this
  // substep. It replaces the integrated position and nothing else: velocity,
  // yaw, lean, the hop and the bob are all still this model's own, because they
  // are what the FIGURE does rather than where it is.
  #stepBody(h, input, at = null) {
    const o = this.opts;

    const desiredX = input.x * o.maxSpeed;
    const desiredZ = input.y * o.maxSpeed;
    const blend = 1 - Math.exp(-h / o.accelTime);

    const prevVX = this.vel.x;
    const prevVZ = this.vel.z;
    this.vel.x += (desiredX - this.vel.x) * blend;
    this.vel.z += (desiredZ - this.vel.z) * blend;

    this.pos.x += this.vel.x * h;
    this.pos.z += this.vel.z * h;
    if (at) { this.pos.x = at.x; this.pos.z = at.z; }

    // Hop. The interesting part is not the arc, it is what the skirt does on
    // the way down.
    if (input.jump && this.grounded) {
      this.airV = o.jumpUp;
      this.grounded = false;
      this.squash = -0.55;
      if (this.eyes) this.eyes.startle = 1;
    }
    if (!this.grounded) {
      this.airV -= o.jumpGravity * h;
      this.airY += this.airV * h;
      if (this.airY <= 0) {
        this.airY = 0;
        this.airV = 0;
        this.grounded = true;
        this.squash = 0.75;
        if (this.eyes) this.eyes.squeeze = 1;
      }
    }
    this.squash += (0 - this.squash) * (1 - Math.exp(-h / 0.09));

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.12) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let d = want - this.yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.yaw += d * (1 - Math.exp(-h * o.turnRate));
    }

    // Lean into the acceleration, like something with mass being pushed.
    const accX = (this.vel.x - prevVX) / h;
    const accZ = (this.vel.z - prevVZ) / h;
    const leanBlend = 1 - Math.exp(-h / 0.16);
    this.lean.x += (THREE.MathUtils.clamp(accX * 0.045, -0.32, 0.32) - this.lean.x) * leanBlend;
    this.lean.y += (THREE.MathUtils.clamp(accZ * 0.045, -0.32, 0.32) - this.lean.y) * leanBlend;

    this.bob = Math.sin(this.time * 2.3) * 0.045 + Math.sin(this.time * 1.31) * 0.02;

    this.#composeMatrix();
  }

  #composeMatrix() {
    const y = this.pos.y + this.bob + this.airY;
    this.axis.set(this.pos.x, y, this.pos.z);

    const q = new THREE.Quaternion();
    // Lean is a world-space tilt: rotate about the axis perpendicular to the
    // push, then yaw underneath it.
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lean.y, 0, -this.lean.x, 'XYZ'));
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    q.copy(tilt).multiply(yawQ);

    const s = 1 + this.squash * 0.16;
    // Kept so the eyes can cancel it out; the head squashes with the body, and
    // anything painted into its UV space squashes with it unless told not to.
    this.bodyScaleY = s;
    const scale = new THREE.Vector3(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));

    this.matrix.compose(new THREE.Vector3(this.pos.x, y, this.pos.z), q, scale);
  }

  #updateEyes(dt) {
    const e = this.eyes;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const sp = Math.min(speed / this.opts.maxSpeed, 1);

    // --- reflexes ------------------------------------------------------------
    e.squeeze *= Math.exp(-dt / 0.10);
    e.startle *= Math.exp(-dt / 0.20);

    // --- blinking ------------------------------------------------------------
    e.blinkTimer -= dt;
    if (e.blinkTimer <= 0 && e.blinkPhase === 0) {
      e.blinkPhase = 1e-4;
      // Every so often it double-blinks, which reads far more alive than a
      // perfectly regular metronome.
      e.blinkQueue = this.rand() < 0.24 ? 1 : 0;
      e.blinkTimer = 2.2 + this.rand() * 3.6;
    }
    if (e.blinkPhase > 0) {
      e.blinkPhase += dt / 0.15;
      // Snaps shut, opens back more slowly — the asymmetry is what makes a
      // blink read as a blink rather than a pulse.
      e.blink = e.blinkPhase < 0.38
        ? e.blinkPhase / 0.38
        : Math.max(0, 1 - (e.blinkPhase - 0.38) / 0.62);
      if (e.blinkPhase >= 1) {
        e.blinkPhase = 0;
        e.blink = 0;
        if (e.blinkQueue > 0) { e.blinkQueue -= 1; e.blinkPhase = 1e-4; }
      }
    }

    // --- idle mood -----------------------------------------------------------
    if (speed < 0.15 && this.grounded) e.idleTime += dt; else e.idleTime = 0;
    e.moodTimer -= dt;
    e.moodCooldown -= dt;
    // Needs to be reachable in an ordinary pause. Requiring 2.5s of stillness
    // on top of a 4s cooldown meant it never fired at all.
    if (e.idleTime > 1.6 && e.moodCooldown <= 0 && e.moodTimer <= 0 && this.rand() < dt * 0.9) {
      e.moodTimer = 1.15;
      e.moodCooldown = 6 + this.rand() * 5;
    }

    // --- expression targets --------------------------------------------------
    let openT = 1;
    let tiltT = 0;
    let curveT = 0;
    let sxT = 1;
    let syT = 1;

    if (!this.grounded) {
      // Wide-eyed in the air. Scaled evenly on both axes -- stretching one of
      // them reads as a distortion rather than an expression.
      sxT = 1.05;
      syT = 1.05;
    } else if (sp > 0.22) {
      // Narrowed and tilted down at the inner corner: determined, leaning in.
      // Held well back from a slit; the eyes should stay round enough to read
      // as eyes while the ghost is moving.
      const k = smoothstep((sp - 0.22) / 0.55);
      openT = 1 - 0.16 * k;
      tiltT = -0.32 * k;
      curveT = 0.08 * k;
    }

    if (e.moodTimer > 0) {
      // Happy squint: a thin crescent riding a strong upward arc.
      const w = Math.min(e.moodTimer / 0.22, 1) * Math.min((1.15 - e.moodTimer) / 0.22, 1);
      const k = Math.max(0, Math.min(w, 1));
      openT = openT * (1 - k) + 0.26 * k;
      curveT = curveT * (1 - k) + 0.85 * k;
      tiltT *= 1 - k;
    }

    const ease = 1 - Math.exp(-dt / 0.11);
    e.open += (openT - e.open) * ease;
    e.tilt += (tiltT - e.tilt) * ease;
    e.curve += (curveT - e.curve) * ease;
    e.scaleX += (sxT - e.scaleX) * ease;
    e.scaleY += (syT - e.scaleY) * ease;

    // Blink and impact close the lids on top of whatever expression is held;
    // startle briefly overrides in the other direction.
    const closed = Math.max(e.blink, e.squeeze);
    const open = Math.max(e.open * (1 - closed) + 0.18 * e.startle, 0);

    // --- gaze ----------------------------------------------------------------
    if (speed > 0.3) {
      // Smooth pursuit: track where the body is actually heading relative to
      // where it is pointing.
      const heading = Math.atan2(this.vel.x, this.vel.z);
      const d = wrapAngle(heading - this.yaw);
      e.gazeTo.set(THREE.MathUtils.clamp(d * 1.2, -1, 1), 0.42);
      e.gazeFrom.copy(e.gaze);
      e.gazeT = 1;
      e.gaze.lerp(e.gazeTo, 1 - Math.exp(-dt / 0.12));
      e.holdTimer = 0.25 + this.rand() * 0.4;
    } else {
      // Saccades: hold a fixation, then jump. Real eyes do not glide between
      // points, and interpolating smoothly is what makes CG eyes look dead.
      e.holdTimer -= dt;
      if (e.holdTimer <= 0 && e.gazeT >= 1) {
        e.gazeFrom.copy(e.gaze);
        e.gazeTo.set((this.rand() - 0.5) * 1.5, (this.rand() - 0.5) * 1.1);
        e.gazeT = 0;
        e.gazeDur = 0.045 + this.rand() * 0.045;
        e.holdTimer = 0.5 + this.rand() * 1.9;
      }
      if (e.gazeT < 1) {
        e.gazeT = Math.min(1, e.gazeT + dt / e.gazeDur);
        const t = 1 - (1 - e.gazeT) * (1 - e.gazeT);
        e.gaze.copy(e.gazeFrom).lerp(e.gazeTo, t);
      }
    }
    if (!this.grounded) e.gaze.y = Math.min(e.gaze.y, -0.75); // glance up mid-hop

    // Vestibulo-ocular reflex: when the body whips round, the eyes hold their
    // heading for a moment and then catch up.
    const dYaw = wrapAngle(this.yaw - e.prevYaw);
    e.prevYaw = this.yaw;
    e.vor = THREE.MathUtils.clamp(e.vor + dYaw * 0.5, -0.12, 0.12) * Math.exp(-dt / 0.12);

    // --- push to the shader --------------------------------------------------
    // The face rides the body's front, so the ghost turns its back on you when
    // it walks away. uEyeTurn carries only the reflex offset.
    const u = this.eyeUniforms;
    u.uOpen.value = open;
    u.uTilt.value = e.tilt;
    u.uCurve.value = e.curve;
    // Cancel the body's squash and stretch. The head is scaled by s vertically
    // and 1/sqrt(s) horizontally, so a fixed patch of UV maps to a taller,
    // narrower area on screen -- which is exactly the stretch you would
    // otherwise see on the eyes during a hop or a hard stop. Countering it here
    // keeps them round while the cloth still squashes.
    const bs = this.bodyScaleY || 1;
    u.uEyeScale.value.set(e.scaleX * Math.sqrt(bs), e.scaleY / bs);

    // The catchlight drifts a little with the gaze, as in the original.
    u.uGlint.value.set(-0.3 - e.gaze.x * 0.16, -0.32 + e.gaze.y * 0.14);
    u.uEyeTurn.value = e.vor / TAU;
    u.uLook.value.set(-e.gaze.x * 0.013, e.gaze.y * 0.014);
    // A reflection sits on the surface, so it should stay roughly put while
    // the eye moves under it rather than being dragged along. These offsets
    // partly cancel the gaze shift applied to the eye centre above.
  }

  // --- geometry sync --------------------------------------------------------

  #syncGeometry() {
    const { rings: R, segments: S } = this.opts;
    const cols = this.cols;
    const src = this.cloth.pos;
    const position = this.geometry.attributes.position.array;

    for (let i = 0; i <= R; i++) {
      for (let j = 0; j < cols; j++) {
        const v = (i * cols + j) * 3;
        const p = (i * S + (j % S)) * 3;
        position[v] = src[p];
        position[v + 1] = src[p + 1];
        position[v + 2] = src[p + 2];
      }
    }

    this.#buildHemRoll(position);
    this.geometry.attributes.position.needsUpdate = true;

    this.geometry.computeVertexNormals();
    this.#weldNormals();
    this.geometry.attributes.normal.needsUpdate = true;
  }

  // Finishes the bare simulated edge with a rolled lip.
  //
  // A cut edge is what makes cloth read as a flat cardboard silhouette: it has
  // no thickness, so nothing on it catches light and the outline is a hard
  // polygon. Rolling the last rows under gives the edge a rounded profile that
  // shades like a real hem, and because it is generated from the simulated
  // edge each frame it follows every fold exactly.
  #buildHemRoll(position) {
    const { rings: R, segments: S, hemRows, hemRadius } = this.opts;
    const cols = this.cols;
    const src = this.cloth.pos;

    for (let j = 0; j < cols; j++) {
      const jj = j % S;
      const o = (R * S + jj) * 3;
      const up = ((R - 1) * S + jj) * 3;
      const next = (R * S + ((jj + 1) % S)) * 3;
      const prev = (R * S + ((jj - 1 + S) % S)) * 3;

      const px = src[o];
      const py = src[o + 1];
      const pz = src[o + 2];

      // Down the sheet, and along the hem.
      let dx = px - src[up];
      let dy = py - src[up + 1];
      let dz = pz - src[up + 2];
      let dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;

      let ex = src[next] - src[prev];
      let ey = src[next + 1] - src[prev + 1];
      let ez = src[next + 2] - src[prev + 2];
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el; ey /= el; ez /= el;

      // cross(along-hem, down-sheet) points out of the ghost, matching the
      // convention the solver uses for its own normals.
      let nx = ey * dz - ez * dy;
      let ny = ez * dx - ex * dz;
      let nz = ex * dy - ey * dx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      for (let k = 1; k <= hemRows; k++) {
        // A half turn: down, under, and back up inside the skirt.
        const a = (k / hemRows) * Math.PI;
        const along = hemRadius * Math.sin(a);
        const under = hemRadius * (1 - Math.cos(a));
        const v = ((R + k) * cols + j) * 3;
        position[v] = px + dx * along - nx * under;
        position[v + 1] = py + dy * along - ny * under;
        position[v + 2] = pz + dz * along - nz * under;
      }
    }
  }

  // computeVertexNormals only sees each side of the seam, and the pole fan is
  // degenerate. Both need fixing up or the ghost shows a hard crease down its
  // back and a pinch at the crown.
  #weldNormals() {
    const { segments: S } = this.opts;
    const cols = this.cols;
    const n = this.geometry.attributes.normal.array;

    for (let i = 0; i < this.rows; i++) {
      const a = (i * cols) * 3;
      const b = (i * cols + S) * 3;
      const x = n[a] + n[b];
      const y = n[a + 1] + n[b + 1];
      const z = n[a + 2] + n[b + 2];
      const l = Math.hypot(x, y, z) || 1;
      n[a] = n[b] = x / l;
      n[a + 1] = n[b + 1] = y / l;
      n[a + 2] = n[b + 2] = z / l;
    }

    let px = 0;
    let py = 0;
    let pz = 0;
    for (let j = 0; j < cols; j++) {
      const o = j * 3;
      px += n[o];
      py += n[o + 1];
      pz += n[o + 2];
    }
    const l = Math.hypot(px, py, pz) || 1;
    for (let j = 0; j < cols; j++) {
      const o = j * 3;
      n[o] = px / l;
      n[o + 1] = py / l;
      n[o + 2] = pz / l;
    }
  }

  // Diagnostics for the headless harness: how far the hem is trailing behind
  // the body, and how much of it has lifted. Numbers beat squinting at stills
  // when tuning cloth.
  metrics() {
    const { rings: R, segments: S } = this.opts;
    const pos = this.cloth.pos;
    let cx = 0;
    let cz = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < S; j++) {
      const o = (R * S + j) * 3;
      cx += pos[o];
      cz += pos[o + 2];
      minY = Math.min(minY, pos[o + 1]);
      maxY = Math.max(maxY, pos[o + 1]);
    }
    cx /= S;
    cz /= S;
    return {
      hemLag: Math.hypot(cx - this.pos.x, cz - this.pos.z),
      hemSpread: maxY - minY,
      hemLow: minY,
    };
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
