import * as THREE from 'three';
import { ClothSim } from './cloth.js';

// The ghost is a single sheet of cloth: a hemispherical head that flows into a
// flared, scalloped skirt. Nothing is rigid — the head only holds its shape
// because shape memory is strong there.
//
// The eyes are painted into the fabric's UV space rather than being separate
// meshes. That means they deform with the cloth for free, stay glued to the
// front as the body turns, and can never drift off the surface.

const TAU = Math.PI * 2;

const DEFAULTS = {
  rings: 26,
  segments: 38,
  headRadius: 0.42,
  headSpan: 0.36,   // fraction of the sheet that forms the head dome
  bodyHeight: 1.18,
  flare: 0.44,
  scallop: 0.1,     // wave in the hem
  hoverHeight: 1.34,
  maxSpeed: 3.2,
  accelTime: 0.28,
  turnRate: 7.0,
  seed: undefined,
  // Azimuth the face drifts toward. With a fixed isometric camera this is a
  // constant, so the ghost can always keep an eye on the player.
  viewAngle: Math.PI / 4,
  // How much the body's own facing pulls the face away from the camera.
  // 0 = always dead-on, 1 = eyes rigidly on the body's front.
  faceBias: 0.12,
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

      turn: 0,
      vor: 0,       // vestibulo-ocular: eyes hold still as the head whips round
      prevYaw: this.yaw,
      idleTime: 0,
      moodTimer: 0,
      moodCooldown: 4,
    };

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
        const wave = Math.cos(6 * theta);
        const rr = r * (1 + scallop * wave * skirt * skirt);
        const yy = y + 0.07 * Math.cos(6 * theta + 0.6) * skirt * skirt;

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
    const { rings: R, segments: S } = this.opts;
    const cols = S + 1; // duplicated seam column so UVs are continuous
    const verts = (R + 1) * cols;

    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const index = [];

    for (let i = 0; i <= R; i++) {
      for (let j = 0; j < cols; j++) {
        const v = i * cols + j;
        uv[v * 2] = j / S;
        uv[v * 2 + 1] = i / R;
        if (i < R && j < S) {
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
  }

  #buildMaterial() {
    // uOpen / uTilt / uCurve are a small lid rig rather than a single blink
    // value. Together they cover the whole expression range: wide, narrowed,
    // determined (upper lid tilted down at the inner corner), happy squint (a
    // thin band following an upward arc) and fully closed.
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
      uGlint: { value: new THREE.Vector2(-0.34, -0.36) },
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
        // unmirrored coordinates, which the glint needs so it tracks the gaze
        // the same way in both eyes instead of splaying outward.
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
          // uEyeTurn slides the face around the sheet, so the ghost can look
          // over its shoulder instead of showing the player a blank back.
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
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90), gm * 0.85);
        }`,
      );
    };
  }

  // --- per-frame ------------------------------------------------------------

  update(dt, input) {
    const sub = 2;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.time += h;
      this.#stepBody(h, input);
      this.cloth.substep(h, this.matrix, this.time, this.axis);
    }
    this.#updateEyes(dt);
    this.#syncGeometry();
  }

  #stepBody(h, input) {
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

    // Hop. The interesting part is not the arc, it is what the skirt does on
    // the way down.
    if (input.jump && this.grounded) {
      this.airV = 3.6;
      this.grounded = false;
      this.squash = -0.55;
      if (this.eyes) this.eyes.startle = 1;
    }
    if (!this.grounded) {
      this.airV -= 9.0 * h;
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
    if (e.idleTime > 2.5 && e.moodCooldown <= 0 && e.moodTimer <= 0 && this.rand() < dt * 0.5) {
      e.moodTimer = 1.15;
      e.moodCooldown = 7 + this.rand() * 6;
    }

    // --- expression targets --------------------------------------------------
    let openT = 1;
    let tiltT = 0;
    let curveT = 0;
    let sxT = 1;
    let syT = 1;

    if (!this.grounded) {
      // Wide-eyed in the air.
      sxT = 1.10;
      syT = 1.16;
    } else if (sp > 0.22) {
      // Narrowed and tilted down at the inner corner: determined, leaning in.
      const k = smoothstep((sp - 0.22) / 0.55);
      openT = 1 - 0.34 * k;
      tiltT = -0.5 * k;
      curveT = 0.16 * k;
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

    // --- face orientation ----------------------------------------------------
    // Keep the face pointed near the camera. The body still turns freely --
    // that is what drives the cloth -- but the eyes drift around to stay
    // readable, which is both practical and very ghost-like.
    //
    // The rest pose runs local +Z at theta = PI, so a point's world compass
    // angle is yaw + PI - 2*PI*u. Solving for u puts the sign on (yaw - target),
    // not the other way round.
    const off = wrapAngle(this.opts.viewAngle - this.yaw) * (1 - this.opts.faceBias);
    e.turn += wrapAngle(off - e.turn) * (1 - Math.exp(-dt / 0.18));

    // --- push to the shader --------------------------------------------------
    const u = this.eyeUniforms;
    u.uOpen.value = open;
    u.uTilt.value = e.tilt;
    u.uCurve.value = e.curve;
    u.uEyeScale.value.set(e.scaleX, e.scaleY);
    u.uEyeTurn.value = -e.turn / TAU + e.vor / TAU;
    u.uLook.value.set(-e.gaze.x * 0.013, e.gaze.y * 0.014);
    // The glint drifts within the eye as the gaze moves, in unmirrored local
    // coordinates so both eyes catch the light on the same side.
    u.uGlint.value.set(-0.34 - e.gaze.x * 0.30, -0.36 + e.gaze.y * 0.26);
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
    this.geometry.attributes.position.needsUpdate = true;

    this.geometry.computeVertexNormals();
    this.#weldNormals();
    this.geometry.attributes.normal.needsUpdate = true;
  }

  // computeVertexNormals only sees each side of the seam, and the pole fan is
  // degenerate. Both need fixing up or the ghost shows a hard crease down its
  // back and a pinch at the crown.
  #weldNormals() {
    const { rings: R, segments: S } = this.opts;
    const cols = this.cols;
    const n = this.geometry.attributes.normal.array;

    for (let i = 0; i <= R; i++) {
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
