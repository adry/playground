import * as THREE from 'three';
import M from '../metrics.js';

// The zombie's shared surface vocabulary: one palette, one set of materials,
// one set of shape primitives. The skeleton's `parts/bone.js` exists for the
// same reason and the reasoning transfers verbatim: if each part invents its
// own way to draw a limb the figure comes out looking like a bag of parts, and
// no amount of correct proportion fixes that.
//
// The look, stated once. Matte clay or vinyl, no gloss, nothing faceted,
// nothing with a hard edge. Limbs are soft tapered tubes barely waisted at all
// (M.limbWaist = 0.86, against the skeleton's bony 0.62), joints are gentle
// bulbs, and every cut edge in the clothing is a real sawtooth in the mesh.
//
// NO ALPHA ANYWHERE. There is no environment map in this scene, so a card has
// nothing to reflect and reads as a flat sticker from the one fixed camera.
// Every rag, every torn edge, every hole is geometry. Same rule as the bushes
// and the fence.

export const PALETTE = {
  // Pale sick green. Desaturated enough to sit next to the ghost's white
  // without shouting, light enough that the sunken sockets read as holes in
  // it rather than as two more mid-greys.
  skin: '#9db983',
  // The inside of the chest. Dark and slightly brown rather than bright
  // crimson: at 34 px of chest a saturated red turns into a glowing chip and
  // pulls the eye off the ribs, which are the thing that has to read.
  flesh: '#5e2a28',
  muscle: '#8a3a33',
  // Ribs, spine, the stripped forearm. Cooler and greyer than the skeleton's
  // warm ivory, so a zombie rib next to a skeleton rib is clearly a dirtier
  // one, and because a warm ivory against the red flesh went pink.
  bone: '#ddd2b8',
  tooth: '#efe8d2',
  // Not black. Pure black at this scale flattens into a hole with no form at
  // all; a very dark warm grey still takes a little bounce off the cheek and
  // keeps the socket looking deep rather than punched out.
  socket: '#17141a',
  jacket: '#aba08a',
  jacketDark: '#7d745f',
  shorts: '#7d8365',
  boot: '#4c4038',
  nail: '#33291f',
  stitch: '#3d3128',
};

export function zombieMaterials() {
  const mk = (color, roughness = 0.86) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0.0,
  });
  return {
    skin: mk(PALETTE.skin, 0.88),
    flesh: mk(PALETTE.flesh, 0.72),   // wet, so a touch less rough than skin
    muscle: mk(PALETTE.muscle, 0.70),
    bone: mk(PALETTE.bone, 0.74),
    tooth: mk(PALETTE.tooth, 0.55),
    socket: mk(PALETTE.socket, 1.0),
    jacket: mk(PALETTE.jacket, 0.94),  // cloth, the roughest thing on the model
    jacketDark: mk(PALETTE.jacketDark, 0.94),
    shorts: mk(PALETTE.shorts, 0.94),
    boot: mk(PALETTE.boot, 0.80),
    nail: mk(PALETTE.nail, 0.66),
    stitch: mk(PALETTE.stitch, 0.80),
  };
}

export function disposeMaterials(mats) {
  for (const m of Object.values(mats)) m.dispose();
}

// --- low level ---------------------------------------------------------------

export function mesh(positions, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const flat = (pts) => {
  const a = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) { a[i * 3] = pts[i].x; a[i * 3 + 1] = pts[i].y; a[i * 3 + 2] = pts[i].z; }
  return a;
};

// A parametric surface over a (u, v) grid.
//
// `point(u, v)` takes both in 0..1 and returns a Vector3. `closedU` wraps the
// grid in u. `uAt` / `vAt` remap the sample positions, which is how the head
// gets four times the resolution across the face than round the back of the
// cranium without paying for it everywhere: a uniform grid dense enough to cut
// a crisp eye socket is dense enough to model the occiput four times over.
//
// `keepQuad(u, v)` is called at each quad's centre; return false to omit it.
// Omitted quads leave a real hole in the mesh, which is how every opening on
// this character is made.
export function gridSurface({
  uSteps, vSteps, closedU = true, point, keepQuad = null, uAt = null, vAt = null,
}) {
  const uN = closedU ? uSteps : uSteps + 1;
  const vN = vSteps + 1;
  const uOf = uAt || ((i) => i / uSteps);
  const vOf = vAt || ((j) => j / vSteps);
  const pts = [];
  for (let i = 0; i < uN; i++) {
    for (let j = 0; j < vN; j++) pts.push(point(uOf(i), vOf(j)));
  }
  const at = (i, j) => ((i % uN) + uN) % uN * vN + j;
  const idx = [];
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      if (keepQuad) {
        const uc = (uOf(i) + uOf(i + 1 === uN ? uSteps : i + 1)) / 2;
        const vc = (vOf(j) + vOf(j + 1)) / 2;
        if (!keepQuad(uc, vc)) continue;
      }
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      // Wound so the face normal is d(u) cross d(v) NEGATED, that is, OUTWARD.
      //
      // Worth stating, because it was wrong for a whole build and the renders
      // did not obviously say so. Every surface here is parameterised as
      // (cos a, y, sin a) with a = 2 pi u, so increasing u runs +X toward +Z
      // and du cross dv points INTO the solid. Wound the naive way, every
      // shape on this model was inside out: three culls the true outside, you
      // see the far wall lit by its own flipped normal, and a ball still looks
      // like a ball. It only shows the moment you cut a hole in something, at
      // which point you look through the hole and see the inside of the back
      // of the object instead of what you put behind it. That is exactly how
      // it was found, on the mouth.
      idx.push(a, c, b, a, d, c);
    }
  }
  return { geometry: mesh(flat(pts), idx), pts, at, uN, vN };
}

// A ribbon swept along a closed run of frames. Each frame is a point with an
// outward in-surface direction `t` and an outward normal `n`; the profile is a
// list of (t, n) offsets from that point.
//
// This is how every hole in this model gets an honest edge. A quad grid can
// only cut a hole on its own cell boundaries, so an analytically placed
// opening comes out as a staircase; the ribbon follows the true outline and is
// made slightly larger than the cut, so it covers the staircase and turns it
// into a lip you can see the thickness of. The chest cavity's rim is the
// important one.
export function ribbon(frames, profile) {
  const n = frames.length, m = profile.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const fr = frames[i];
    for (let k = 0; k < m; k++) {
      pts.push(new THREE.Vector3()
        .copy(fr.p)
        .addScaledVector(fr.t, profile[k].t)
        .addScaledVector(fr.n, profile[k].n));
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = i2 * m + k, c = i2 * m + k + 1, d = i * m + k + 1;
      // Same outward convention as gridSurface. The frames run the same way
      // round the opening as the surface's own u, so the naive winding faces
      // into the body and the lip is invisible from outside: you see the raw
      // staircase of the cut instead of the lip that was put there to hide it.
      idx.push(a, c, b, a, d, c);
    }
  }
  return mesh(flat(pts), idx);
}

// A two-sided sheet: an outer surface, an inner surface, and a rim stitched
// along EVERY boundary, including the edges of any holes.
//
// This is what all the clothing is. A rag with no thickness reads as a decal
// from the one fixed camera the moment it turns edge-on, and the torn hems are
// the point of the garment, so every cut edge has to show its own thickness.
// Holes come from `keepQuad`, exactly as on the body, and get rimmed for free.
export function shell2({
  uSteps, vSteps, closedU = false, outer, inner, keepQuad = null, uAt = null, vAt = null,
}) {
  const uN = closedU ? uSteps : uSteps + 1;
  const vN = vSteps + 1;
  const uOf = uAt || ((i) => i / uSteps);
  const vOf = vAt || ((j) => j / vSteps);
  const pts = [];
  const at = (layer, i, j) => layer * uN * vN + (((i % uN) + uN) % uN) * vN + j;
  for (const fn of [outer, inner]) {
    for (let i = 0; i < uN; i++) for (let j = 0; j < vN; j++) pts.push(fn(uOf(i), vOf(j)));
  }
  const idx = [];
  const kept = new Set();
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      if (keepQuad) {
        const uc = (uOf(i) + uOf(i + 1 === uN ? uSteps : i + 1)) / 2;
        const vc = (vOf(j) + vOf(j + 1)) / 2;
        if (!keepQuad(uc, vc)) continue;
      }
      kept.add(`${i},${j}`);
      // Same outward convention as gridSurface above; the inner sheet is the
      // mirror of it, so a garment is solid from both sides.
      const a = at(0, i, j), b = at(0, i + 1, j), c = at(0, i + 1, j + 1), d = at(0, i, j + 1);
      idx.push(a, c, b, a, d, c);
      const A = at(1, i, j), B = at(1, i + 1, j), C = at(1, i + 1, j + 1), D = at(1, i, j + 1);
      idx.push(A, B, C, A, C, D);
    }
  }
  // Rim every directed edge whose neighbouring quad is absent.
  const has = (i, j) => {
    if (j < 0 || j >= vSteps) return false;
    let ii = i;
    if (closedU) ii = ((i % uSteps) + uSteps) % uSteps;
    else if (i < 0 || i >= uSteps) return false;
    return kept.has(`${ii},${j}`);
  };
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      if (!has(i, j)) continue;
      // corners of this quad, in the outer surface's own winding
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const neighbour = [[i, j - 1], [i + 1, j], [i, j + 1], [i - 1, j]];
      for (let e = 0; e < 4; e++) {
        if (has(neighbour[e][0], neighbour[e][1])) continue;
        const [ai, aj] = corners[e];
        const [bi, bj] = corners[(e + 1) % 4];
        const oA = at(0, ai, aj), oB = at(0, bi, bj);
        const iA = at(1, ai, aj), iB = at(1, bi, bj);
        idx.push(oA, iB, iA, oA, oB, iB);
      }
    }
  }
  return mesh(flat(pts), idx);
}

// --- shape primitives ---------------------------------------------------------

// A soft tapered limb from a to b. Barely waisted, ends rounded off into caps,
// so a limb is one closed shape rather than a tube that needs plugging.
// `bow` bends it sideways at mid-shaft as a fraction of its length, which is
// what stops a leg reading as a pipe.
export function limb(a, b, r0, r1, {
  bow = 0, bowAxis = null, radial = 14, segments = 12, waist = M.limbWaist,
} = {}) {
  const A = a.clone(), B = b.clone();
  const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
  if (bow !== 0) {
    const axis = bowAxis
      ? bowAxis.clone().normalize()
      : new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3(0, 0, 1)).normalize();
    mid.addScaledVector(axis, bow * A.distanceTo(B));
  }
  const curve = new THREE.QuadraticBezierCurve3(A, mid, B);

  // A frame that does not flip: pick any up not parallel to the tangent and
  // carry it along, which is enough for a limb that never loops.
  const up0 = Math.abs(curve.getTangentAt(0).y) > 0.9
    ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const pts = [];
  const CAP = 3;                       // rings that round each end off
  const total = segments + 2 * CAP;
  let up = up0.clone();
  for (let s = 0; s <= total; s++) {
    // t runs 0..1 over the shaft; the cap rings sit at the ends and shrink.
    const shaft = Math.min(1, Math.max(0, (s - CAP) / segments));
    const p = curve.getPointAt(shaft);
    const tan = curve.getTangentAt(shaft).normalize();
    up.addScaledVector(tan, -up.dot(tan)).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const base = (r0 + (r1 - r0) * shaft) * (1 - (1 - waist) * Math.pow(1 - Math.abs(shaft * 2 - 1), 1.6));
    // Cap shaping: a quarter circle of radius closing the end.
    let scale = 1, slide = 0;
    if (s < CAP) { const k = (CAP - s) / CAP; scale = Math.sqrt(Math.max(0, 1 - k * k)); slide = -r0 * k * 0.8; }
    else if (s > CAP + segments) {
      const k = (s - CAP - segments) / CAP;
      scale = Math.sqrt(Math.max(0, 1 - k * k)); slide = r1 * k * 0.8;
    }
    const centre = p.clone().addScaledVector(tan, slide);
    for (let j = 0; j < radial; j++) {
      const a2 = (j / radial) * Math.PI * 2;
      pts.push(centre.clone()
        .addScaledVector(side, Math.cos(a2) * base * scale)
        .addScaledVector(up, Math.sin(a2) * base * scale));
    }
  }
  const idx = [];
  for (let s = 0; s < total; s++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a2 = s * radial + j, b2 = s * radial + j2;
      const c2 = (s + 1) * radial + j2, d2 = (s + 1) * radial + j;
      // Outward, for the same reason as gridSurface: the ring runs
      // (cos a * side + sin a * up) with side = tangent cross up, so going
      // round the ring and then along the shaft gives an INWARD cross product.
      idx.push(a2, c2, b2, a2, d2, c2);
    }
  }
  return mesh(flat(pts), idx);
}

// A tapered tube swept along an arbitrary curve, with rounded ends. Ribs and
// the spine need a real arc rather than a bowed straight line.
export function tube(curve, r0, r1, { radial = 10, segments = 20 } = {}) {
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  const centre = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Round the last eighth off at each end so a free end is a cap, not a hole.
    const cap = Math.min(1, Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(t * 2 - 1) / 1.0, 12))));
    const r = (r0 + (r1 - r0) * t) * cap;
    centre.copy(curve.getPointAt(t));
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      if (k >= pos.count) break;
      p.fromBufferAttribute(pos, k).sub(centre).setLength(Math.max(1e-5, r)).add(centre);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A joint bulb. Softer and rounder than the skeleton's condyle.
export function bulb(r, { squash = 0.92 } = {}) {
  const geo = new THREE.SphereGeometry(r * M.jointBallScale, 14, 10);
  geo.scale(1, squash, 1);
  return geo;
}

export function ball(rx, ry, rz, seg = 16) {
  const geo = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.62)));
  geo.scale(rx, ry, rz);
  return geo;
}

// A superellipsoid: a box with its corners rounded off as much as you like.
// `round` 1 is a sphere, 0.4 is a clay brick with soft corners. Boots, the
// torso block and the tooth blocks are all this one shape, which is most of
// what keeps them looking like they were pressed in the same mould.
export function softBox(w, h, d, { round = 0.5, uSteps = 20, vSteps = 14 } = {}) {
  const e = round;
  const p = (x) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const { geometry } = gridSurface({
    uSteps, vSteps, closedU: true,
    point: (u, v) => {
      const a = u * Math.PI * 2;
      const b = (v - 0.5) * Math.PI;
      const cb = p(Math.cos(b)), sb = p(Math.sin(b));
      return new THREE.Vector3((w / 2) * cb * p(Math.cos(a)), (h / 2) * sb, (d / 2) * cb * p(Math.sin(a)));
    },
  });
  return geometry;
}

// --- assembly helpers ---------------------------------------------------------

export function put(parent, geometry, material, { pos = null, rot = null, scale = null } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (pos) m.position.copy(pos);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  parent.add(m);
  return m;
}

export function v(x, y, z) { return new THREE.Vector3(x, y, z); }

// Smooth 0..1 ramp. Used everywhere a feature has to fade into the surface
// around it instead of stopping at an edge.
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Counts what a subtree costs, so the triangle budget is a measured number
// rather than an estimate. Five of these may be on screen at once.
export function triangleCount(object3D) {
  let n = 0;
  object3D.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return n;
}

export function collectGeometries(object3D) {
  const set = new Set();
  object3D.traverse((o) => { if (o.isMesh) set.add(o.geometry); });
  return set;
}
