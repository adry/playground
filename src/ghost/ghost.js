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
  // Azimuth the face drifts toward. With a fixed isometric camera this is a
  // constant, so the ghost can always keep an eye on the player.
  viewAngle: Math.PI / 4,
  // How much the body's own facing pulls the face away from the camera.
  // 0 = always dead-on, 1 = eyes rigidly on the body's front.
  faceBias: 0.22,
};

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

    this.eyes = {
      blink: 0,
      blinkTimer: 1.2,
      blinkPhase: 0,
      look: new THREE.Vector2(),
      lookTarget: new THREE.Vector2(),
      wanderTimer: 0,
      turn: 0,
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
    this.eyeUniforms = {
      uEyeV: { value: 0.255 },
      uEyeSep: { value: 0.063 },
      uEyeSize: { value: new THREE.Vector2(0.034, 0.055) },
      uBlink: { value: 0 },
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
        uniform float uBlink;
        uniform vec2 uLook;
        uniform float uEyeTurn;
        uniform vec3 uEyeColor;
        uniform vec2 uGlint;

        // Horizontal distance has to wrap: u is an angle around the ghost.
        float ghostEye(vec2 uv, float cu, float cv, float blink) {
          float du = abs(fract(uv.x - cu + 0.5) - 0.5);
          float dv = uv.y - cv;
          vec2 d = vec2(du / uEyeSize.x, dv / (uEyeSize.y * max(1.0 - blink, 0.07)));
          return 1.0 - smoothstep(0.80, 1.02, length(d));
        }

        float ghostGlint(vec2 uv, float cu, float cv, float blink) {
          float du = (fract(uv.x - cu + 0.5) - 0.5) - uGlint.x * uEyeSize.x;
          float dv = (uv.y - cv) - uGlint.y * uEyeSize.y;
          vec2 d = vec2(du / (uEyeSize.x * 0.30), dv / (uEyeSize.y * 0.30));
          return (1.0 - smoothstep(0.5, 1.0, length(d))) * (1.0 - blink);
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
          float lu = cu - uEyeSep;
          float ru = cu + uEyeSep;
          float mask = max(ghostEye(vGUv, lu, cv, uBlink), ghostEye(vGUv, ru, cv, uBlink));
          diffuseColor.rgb = mix(diffuseColor.rgb, uEyeColor, mask);
          float glint = max(ghostGlint(vGUv, lu, cv, uBlink), ghostGlint(vGUv, ru, cv, uBlink));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), glint * mask * 0.9);
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
    this.#updateEyes(dt, input);
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
    }
    if (!this.grounded) {
      this.airV -= 9.0 * h;
      this.airY += this.airV * h;
      if (this.airY <= 0) {
        this.airY = 0;
        this.airV = 0;
        this.grounded = true;
        this.squash = 0.75;
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

  #updateEyes(dt, input) {
    const e = this.eyes;

    e.blinkTimer -= dt;
    if (e.blinkTimer <= 0) {
      e.blinkPhase = 0.001;
      e.blinkTimer = 2.4 + Math.random() * 3.4;
    }
    if (e.blinkPhase > 0) {
      e.blinkPhase += dt / 0.16;
      // Close fast, open a little slower.
      e.blink = e.blinkPhase < 0.45
        ? e.blinkPhase / 0.45
        : Math.max(0, 1 - (e.blinkPhase - 0.45) / 0.55);
      if (e.blinkPhase >= 1) { e.blinkPhase = 0; e.blink = 0; }
    }

    // Look where you are going, in body-relative terms, plus idle wandering.
    e.wanderTimer -= dt;
    if (e.wanderTimer <= 0) {
      e.wanderTimer = 0.9 + Math.random() * 2.2;
      e.lookTarget.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    let tx = e.lookTarget.x;
    let ty = e.lookTarget.y;
    if (speed > 0.25) {
      // Angle between where the body points and where it is actually going.
      const heading = Math.atan2(this.vel.x, this.vel.z);
      let d = heading - this.yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      tx = THREE.MathUtils.clamp(d * 1.1, -1, 1);
      ty = 0.35;
    }
    if (!this.grounded) ty = -0.6; // eyes up on the way through the air

    const k = 1 - Math.exp(-dt / 0.13);
    e.look.x += (tx * 0.012 - e.look.x) * k;
    e.look.y += (ty * 0.014 - e.look.y) * k;

    // Keep the face pointed near the camera. The body still turns freely --
    // that is what drives the cloth -- but the eyes drift around to stay
    // readable, which is both practical and very ghost-like.
    const off = wrapAngle(this.opts.viewAngle - this.yaw) * (1 - this.opts.faceBias);
    e.turn += wrapAngle(off - e.turn) * (1 - Math.exp(-dt / 0.25));
    this.eyeUniforms.uEyeTurn.value = e.turn / TAU;

    this.eyeUniforms.uBlink.value = e.blink;
    this.eyeUniforms.uLook.value.copy(e.look);
    this.eyeUniforms.uGlint.value.set(-0.3 + e.look.x * 12, -0.32 + e.look.y * 10);
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
