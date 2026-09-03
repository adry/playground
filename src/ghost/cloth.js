// A pinned cloth solver over a polar grid: (rings + 1) rows by `segments`
// columns, wrapping around in the column direction.
//
// Verlet integration plus position-based distance constraints. The part that
// makes it read as a *ghost* rather than a falling rag is shape memory: every
// particle is pulled back toward where the body says it should be, hard near
// the head and almost not at all at the hem. So the head keeps its silhouette
// while the skirt is free to swing, lag and billow.

const TMP = { x: 0, y: 0, z: 0 };

export class ClothSim {
  constructor({ rings, segments, rest, invMass, shapeK, minRadius, pressure }) {
    this.rings = rings;
    this.segments = segments;
    this.count = (rings + 1) * segments;

    this.rest = rest;           // local-space rest positions, count * 3
    this.invMass = invMass;     // 0 = kinematic
    this.shapeK = shapeK;       // per-substep pull toward the rest pose
    this.minRadius = minRadius; // per-particle floor on distance from the body axis
    this.pressure = pressure;   // outward push, standing in for air trapped under the sheet

    this.pos = new Float32Array(this.count * 3);
    this.nrm = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.target = new Float32Array(this.count * 3);

    this.gravity = -3.0;
    this.drag = 0.45;   // isotropic damping, mostly for stability
    this.aero = 5.6;    // force along the surface normal — drag *and* lift
    this.windStrength = 0.55;
    this.groundY = 0.0;
    this.iterations = 6;
    this.colliders = null;
    this.active = null;      // shortlist near the ghost, rebuilt once per frame
    this.activeMaxTop = 0;

    this.#buildConstraints();
  }

  #buildConstraints() {
    const R = this.rings;
    const S = this.segments;
    const idx = (i, j) => i * S + ((j % S) + S) % S;

    const a = [];
    const b = [];
    const stiff = [];

    const add = (p, q, k) => { a.push(p); b.push(q); stiff.push(k); };

    for (let i = 0; i <= R; i++) {
      for (let j = 0; j < S; j++) {
        // Around the ring, and one step further for bending resistance.
        add(idx(i, j), idx(i, j + 1), 1.0);
        add(idx(i, j), idx(i, j + 2), 0.35);

        if (i < R) {
          add(idx(i, j), idx(i + 1, j), 1.0);       // structural, down
          add(idx(i, j), idx(i + 1, j + 1), 0.6);   // shear
          add(idx(i, j), idx(i + 1, j - 1), 0.6);   // shear
        }
        if (i < R - 1) add(idx(i, j), idx(i + 2, j), 0.35); // bend, down
      }
    }

    // Rest lengths come from the rest pose, and any pair that starts coincident
    // (the pole fan) is dropped rather than solved into a singularity.
    const keep = [];
    for (let c = 0; c < a.length; c++) {
      const p = a[c] * 3;
      const q = b[c] * 3;
      const dx = this.rest[q] - this.rest[p];
      const dy = this.rest[q + 1] - this.rest[p + 1];
      const dz = this.rest[q + 2] - this.rest[p + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d > 1e-5) keep.push([a[c], b[c], d, stiff[c]]);
    }

    this.constraintCount = keep.length;
    this.ca = new Int32Array(this.constraintCount);
    this.cb = new Int32Array(this.constraintCount);
    this.crest = new Float32Array(this.constraintCount);
    this.cstiff = new Float32Array(this.constraintCount);
    keep.forEach(([p, q, d, k], c) => {
      this.ca[c] = p;
      this.cb[c] = q;
      this.crest[c] = d;
      this.cstiff[c] = k;
    });
  }

  // Obstacles the fabric drapes over. Nothing is solved against them: they are
  // static, so a positional push each substep is enough.
  setColliders(colliders) {
    this.colliders = colliders && colliders.length ? colliders : null;
    this.active = null;
    this.activeMaxTop = 0;
  }

  // A whole ruined castle is a few hundred colliders, and testing every
  // particle against all of them every substep would dominate the frame. The
  // ghost only ever touches what is next to it, so the list is narrowed once
  // per frame and the inner loop usually runs over nothing at all.
  refreshActive(x, z, radius) {
    if (!this.colliders) return;
    if (!this.active) this.active = [];
    this.active.length = 0;
    this.activeMaxTop = 0;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const reach = radius + c.bound;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      this.active.push(c);
      if (c.top > this.activeMaxTop) this.activeMaxTop = c.top;
    }
  }

  // Places every particle exactly on its rest pose. Used on the first frame so
  // the ghost does not have to fall into shape from the origin.
  reset(matrix) {
    this.#writeTargets(matrix);
    this.pos.set(this.target);
    this.prev.set(this.target);
  }

  #writeTargets(m) {
    const e = m.elements;
    const rest = this.rest;
    const target = this.target;
    for (let p = 0; p < this.count; p++) {
      const o = p * 3;
      const x = rest[o];
      const y = rest[o + 1];
      const z = rest[o + 2];
      target[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      target[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      target[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
  }

  // One fixed substep. `matrix` is the body transform for this instant, so the
  // caller is expected to advance the body first and hand over an already
  // interpolated pose.
  // Surface normal per particle, from the two grid tangents. Needed before
  // integration because the aerodynamic force acts along it.
  #computeNormals() {
    const R = this.rings;
    const S = this.segments;
    const pos = this.pos;
    const nrm = this.nrm;

    for (let i = 0; i <= R; i++) {
      const iPrev = Math.max(i - 1, 0);
      const iNext = Math.min(i + 1, R);
      for (let j = 0; j < S; j++) {
        const jPrev = (j - 1 + S) % S;
        const jNext = (j + 1) % S;

        const a = (iNext * S + j) * 3;
        const b = (iPrev * S + j) * 3;
        const c = (i * S + jNext) * 3;
        const d = (i * S + jPrev) * 3;

        const dx = pos[a] - pos[b];
        const dy = pos[a + 1] - pos[b + 1];
        const dz = pos[a + 2] - pos[b + 2];
        const ax = pos[c] - pos[d];
        const ay = pos[c + 1] - pos[d + 1];
        const az = pos[c + 2] - pos[d + 2];

        // cross(around, down) points out of the sheet.
        let nx = ay * dz - az * dy;
        let ny = az * dx - ax * dz;
        let nz = ax * dy - ay * dx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const o = (i * S + j) * 3;
        if (l > 1e-9) {
          nrm[o] = nx / l;
          nrm[o + 1] = ny / l;
          nrm[o + 2] = nz / l;
        } else {
          nrm[o] = 0;
          nrm[o + 1] = 1;
          nrm[o + 2] = 0;
        }
      }
    }
  }

  substep(h, matrix, time, axis) {
    this.#writeTargets(matrix);
    this.#computeNormals();

    const { pos, prev, target, invMass } = this;
    const hh = h * h;
    const g = this.gravity;
    const drag = this.drag;
    const wind = this.windStrength;

    for (let p = 0; p < this.count; p++) {
      const o = p * 3;

      if (invMass[p] === 0) {
        // Kinematic: snap to the body, and let the previous position carry the
        // body's velocity so the neighbours below get dragged along.
        prev[o] = pos[o];
        prev[o + 1] = pos[o + 1];
        prev[o + 2] = pos[o + 2];
        pos[o] = target[o];
        pos[o + 1] = target[o + 1];
        pos[o + 2] = target[o + 2];
        continue;
      }

      const x = pos[o];
      const y = pos[o + 1];
      const z = pos[o + 2];

      const vx = (x - prev[o]) / h;
      const vy = (y - prev[o + 1]) / h;
      const vz = (z - prev[o + 2]) / h;

      // Cheap swirling breeze. It only needs to be plausible and smooth, and
      // it matters most at the hem, where the fabric is freest.
      const sway = wind * (0.25 + 0.75 * this.shapeKFalloff(p));
      const wx = sway * Math.sin(time * 0.9 + z * 1.4 + y * 0.7);
      const wy = sway * 0.4 * Math.sin(time * 1.7 + x * 1.1);
      const wz = sway * Math.cos(time * 1.1 + x * 0.9 - y * 0.5);

      // Aerodynamics. A sheet only feels air along its normal, and modelling
      // it that way is what produces lift as well as drag: as the skirt swings
      // back its surfaces tilt, the normal picks up a downward component, and
      // the reaction pushes the fabric up into a billow. Isotropic drag can
      // only ever push it backwards and down.
      const o3 = p * 3;
      const nx = this.nrm[o3];
      const ny = this.nrm[o3 + 1];
      const nz = this.nrm[o3 + 2];
      const rvx = vx - wx;
      const rvy = vy - wy;
      const rvz = vz - wz;
      const vn = nx * rvx + ny * rvy + nz * rvz;
      const aeroK = this.aero * vn;

      let ax = -aeroK * nx + drag * (wx - vx);
      let ay = g - aeroK * ny + drag * (wy - vy);
      let az = -aeroK * nz + drag * (wz - vz);

      // Outward pressure from the body axis. Cloth with nothing under it
      // collapses into a flat bag the moment it is dragged sideways; this
      // stands in for the air caught inside and keeps the ghost inflated.
      const press = this.pressure[p];
      if (press > 0) {
        const rx = x - axis.x;
        const rz = z - axis.z;
        const rl = Math.sqrt(rx * rx + rz * rz);
        if (rl > 1e-5) {
          ax += (rx / rl) * press;
          az += (rz / rl) * press;
        }
      }

      prev[o] = x;
      prev[o + 1] = y;
      prev[o + 2] = z;

      pos[o] = x + vx * h + ax * hh;
      pos[o + 1] = y + vy * h + ay * hh;
      pos[o + 2] = z + vz * h + az * hh;
    }

    this.#solve();
    this.#applyShapeMemory();
    this.#applyVolume(axis);
    this.#applyObstacles();
    this.#applyGround();
  }

  // Normalised "how free is this particle" — 0 at the pinned head, 1 at the hem.
  shapeKFalloff(p) {
    return 1 - Math.min(this.shapeK[p] / 0.3, 1);
  }

  #solve() {
    const { pos, invMass, ca, cb, crest, cstiff } = this;
    for (let it = 0; it < this.iterations; it++) {
      for (let c = 0; c < this.constraintCount; c++) {
        const pa = ca[c];
        const pb = cb[c];
        const wa = invMass[pa];
        const wb = invMass[pb];
        const w = wa + wb;
        if (w === 0) continue;

        const o = pa * 3;
        const q = pb * 3;
        const dx = pos[q] - pos[o];
        const dy = pos[q + 1] - pos[o + 1];
        const dz = pos[q + 2] - pos[o + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;

        const f = ((d - crest[c]) / d) * cstiff[c] / w;
        const cx = dx * f;
        const cy = dy * f;
        const cz = dz * f;

        if (wa !== 0) {
          pos[o] += cx * wa;
          pos[o + 1] += cy * wa;
          pos[o + 2] += cz * wa;
        }
        if (wb !== 0) {
          pos[q] -= cx * wb;
          pos[q + 1] -= cy * wb;
          pos[q + 2] -= cz * wb;
        }
      }
    }
  }

  #applyShapeMemory() {
    const { pos, target, shapeK, invMass } = this;
    for (let p = 0; p < this.count; p++) {
      const k = shapeK[p];
      if (k <= 0 || invMass[p] === 0) continue;
      const o = p * 3;
      pos[o] += (target[o] - pos[o]) * k;
      pos[o + 1] += (target[o + 1] - pos[o + 1]) * k;
      pos[o + 2] += (target[o + 2] - pos[o + 2]) * k;
    }
  }

  // Keeps the skirt from sucking inward onto its own axis. Without it the
  // fabric reads as a wet towel rather than something with a body under it.
  #applyVolume(axis) {
    const { pos, invMass, minRadius } = this;
    for (let p = 0; p < this.count; p++) {
      const r = minRadius[p];
      if (r <= 0 || invMass[p] === 0) continue;
      const o = p * 3;
      let dx = pos[o] - axis.x;
      let dz = pos[o + 2] - axis.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= r) continue;
      if (d < 1e-6) { dx = 1; dz = 0; }
      const s = (r - d) / Math.max(d, 1e-6);
      pos[o] += dx * s;
      pos[o + 2] += dz * s;
    }
  }

  // Resolves along the axis of least penetration, which is what gives both
  // behaviours from one test: a particle mostly above a stone gets lifted onto
  // it and drapes, one mostly beside it gets pushed out of the way.
  #applyObstacles() {
    const list = this.active;
    if (!list || list.length === 0) return;
    const { pos, invMass } = this;
    const maxTop = this.activeMaxTop;

    for (let p = 0; p < this.count; p++) {
      if (invMass[p] === 0) continue;
      const o = p * 3;
      const y = pos[o + 1];
      if (y > maxTop) continue; // the head and most of the body, skipped cheaply

      const x = pos[o];
      const z = pos[o + 2];

      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (y > c.top) continue;

        const dx = x - c.x;
        const dz = z - c.z;
        const reach = c.bound;
        if (dx * dx + dz * dz > reach * reach) continue;

        const pUp = c.top - y;

        if (c.circle) {
          const d = Math.sqrt(dx * dx + dz * dz);
          const pr = c.radius - d;
          if (pr <= 0) continue;
          if (pUp <= pr) {
            pos[o + 1] = c.top;
          } else if (d > 1e-6) {
            pos[o] += (dx / d) * pr;
            pos[o + 2] += (dz / d) * pr;
          }
          continue;
        }

        const lx = dx * c.cos + dz * c.sin;
        const lz = -dx * c.sin + dz * c.cos;
        const pX = c.hx - Math.abs(lx);
        const pZ = c.hz - Math.abs(lz);
        if (pX <= 0 || pZ <= 0) continue;

        if (pUp <= pX && pUp <= pZ) {
          pos[o + 1] = c.top;
        } else if (pX <= pZ) {
          const sx = lx < 0 ? -1 : 1;
          pos[o] += c.cos * pX * sx;
          pos[o + 2] += c.sin * pX * sx;
        } else {
          const sz = lz < 0 ? -1 : 1;
          pos[o] += -c.sin * pZ * sz;
          pos[o + 2] += c.cos * pZ * sz;
        }
      }
    }
  }

  #applyGround() {
    const { pos, invMass } = this;
    const floor = this.groundY + 0.004;
    for (let p = 0; p < this.count; p++) {
      if (invMass[p] === 0) continue;
      const o = p * 3 + 1;
      if (pos[o] < floor) pos[o] = floor;
    }
  }
}

export { TMP };
