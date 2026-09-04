import * as THREE from 'three';

// A profile builder and a lathe that sweeps it, with an angular modulation
// hook. Everything carved on this fountain -- the gadroon lobes on the basin,
// the scalloped rims, the hand-made waviness, the chips -- is a change of
// radius (and sometimes of height) as a function of the angle, so one surface
// generator covers all of it. Nothing here is assembled from primitives, for
// the reason style.js gives: a lobed silhouette built from primitives is a
// faceted silhouette, and this set has no facets in it.
//
// The whole stone is ONE profile, run from the axis at the bottom of the
// plinth, out and up the outside, over the basin rim, down its inside, across
// its floor, up the next baluster, and so on to the axis again at the tip of
// the finial. That is not a tidiness point: a lathe of one closed profile is
// one watertight surface with continuous normals across every joint, where
// eight stacked primitives are eight silhouettes that have to be talked into
// lining up and still crease where they meet.

// ---------------------------------------------------------------------------
// profile

// Samples are appended in order. Each carries the tag that was set when it was
// added and its position 0..1 along that tagged run, which is what lets the
// modulation say "gadroons over the middle 70% of the basin's outer wall"
// without hunting for a y range that also catches the inside of the bowl.
export class Profile {
  constructor() {
    this.pts = [];
    this.tag = 'plain';
    this._runStart = 0;
  }

  setTag(tag) {
    this._closeRun();
    this.tag = tag;
    this._runStart = this.pts.length;
    return this;
  }

  _closeRun() {
    const n = this.pts.length - this._runStart;
    for (let i = this._runStart; i < this.pts.length; i++) {
      this.pts[i].u = n > 1 ? (i - this._runStart) / (n - 1) : 0;
    }
  }

  _push(r, y) {
    const last = this.pts[this.pts.length - 1];
    // Skip a duplicate: a zero-length segment makes a zero-length tangent and
    // a NaN normal, and every helper below starts where the previous one ended.
    if (last && Math.abs(last.r - r) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
    this.pts.push({ r, y, tag: this.tag, u: 0 });
  }

  moveTo(r, y) {
    this._push(r, y);
    return this;
  }

  lineTo(r, y, n = 2) {
    const a = this.pts[this.pts.length - 1];
    for (let i = 1; i <= n; i++) this._push(a.r + (r - a.r) * (i / n), a.y + (y - a.y) * (i / n));
    return this;
  }

  // A circular arc, which is how every rounded edge on this piece is made: rims
  // are a torus roll, the plinth's steps are quarter rounds, and the bud of the
  // finial closes on the axis with one.
  arc(cr, cy, R, a0, a1, n = 8) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      this._push(cr + R * Math.cos(a), cy + R * Math.sin(a));
    }
    return this;
  }

  // A centripetal Catmull-Rom through control points, for the turned balusters
  // and the swept undersides of the bowls. Centripetal rather than uniform on
  // purpose: uniform overshoots at a tight waist and puts a cusp in the
  // silhouette, which is exactly the artefact this style cannot have.
  curve(points, n = 16) {
    const last = this.pts[this.pts.length - 1];
    const cps = [];
    if (last) cps.push(new THREE.Vector3(last.r, last.y, 0));
    for (const p of points) cps.push(new THREE.Vector3(p[0], p[1], 0));
    const c = new THREE.CatmullRomCurve3(cps, false, 'centripetal', 0.5);
    for (let i = 1; i <= n; i++) {
      const p = c.getPoint(i / n);
      this._push(p.x, p.y);
    }
    return this;
  }

  // Finish: resolve the last run's u, and hand back samples carrying the
  // cumulative arc length that the lathe uses for its v coordinate.
  build() {
    this._closeRun();
    let s = 0;
    for (let i = 0; i < this.pts.length; i++) {
      if (i > 0) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        s += Math.hypot(b.r - a.r, b.y - a.y);
      }
      this.pts[i].s = s;
    }
    return this.pts;
  }
}

// ---------------------------------------------------------------------------
// mesh sink

// Several surfaces appended into one set of buffers, because the alternative is
// one draw call per piece and this prop already asks the scene for a lot.
export function createSink() {
  return { pos: [], nor: [], uv: [], col: [], idx: [] };
}

export function sinkToGeometry(sink) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(sink.col, 3));
  g.setIndex(sink.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------
// the lathe

// Sweep a profile through `segments` angular steps.
//
//   displace(sample, theta) -> [dr, dy]   pushed on top of the profile point
//   tint(sample, theta, dr) -> [r, g, b]  vertex colour, the weathering
//
// Normals are taken from the finished grid by central differences rather than
// solved analytically. The displacement hook can be anything -- a gadroon, a
// scallop that also dips the rim, a chip scooped out of it -- and every one of
// those would need its own derivative. Differencing the surface that actually
// got built cannot disagree with it.
export function latheInto(sink, {
  profile,
  segments = 84,
  displace = null,
  tint = null,
  uRepeat = 3,
  vScale = 1.0,
  minRadius = 0.07,
}) {
  const rows = profile.length;
  const cols = segments + 1; // seam column duplicated so u can run 0..uRepeat
  const base = sink.pos.length / 3;

  // v is arc length scaled by the LOCAL circumference, not by a constant.
  //
  // u has to wrap, so it must run 0..uRepeat whatever the radius is, which
  // means the map is squeezed hard on anything thin. Measured on this fountain
  // the finial is eleven times denser in u than the basin, and what came back
  // was a bud carved into vertical gores: at that squeeze the normal map's own
  // gradients get multiplied by eleven and read as ridges. Advancing v at the
  // matching rate makes every part of the piece isotropic in texel density, and
  // costs nothing -- v only has to be continuous along the profile, not even.
  const vs = new Float32Array(rows);
  {
    let acc = 0;
    for (let i = 0; i < rows; i++) {
      if (i > 0) {
        const a = profile[i - 1];
        const b = profile[i];
        const ds = Math.hypot(b.r - a.r, b.y - a.y);
        acc += (ds * uRepeat) / (Math.PI * 2 * Math.max(minRadius, (a.r + b.r) / 2));
      }
      vs[i] = acc * vScale;
    }
  }

  // Positions first, whole grid, then normals from it.
  const P = new Float32Array(rows * cols * 3);
  const D = new Float32Array(rows * cols); // the radial displacement, for tint
  for (let i = 0; i < rows; i++) {
    const sample = profile[i];
    for (let j = 0; j < cols; j++) {
      const jj = j === segments ? 0 : j;
      const theta = (jj / segments) * Math.PI * 2;
      let r = sample.r;
      let y = sample.y;
      let dr = 0;
      if (displace) {
        const d = displace(sample, theta);
        dr = d[0];
        r += dr;
        y += d[1];
      }
      if (r < 0) r = 0;
      const k = (i * cols + j) * 3;
      P[k] = r * Math.cos(theta);
      P[k + 1] = y;
      P[k + 2] = r * Math.sin(theta);
      D[i * cols + j] = dr;
    }
  }

  const get = (i, j, out) => {
    const ii = i < 0 ? 0 : i > rows - 1 ? rows - 1 : i;
    // Columns wrap: the duplicated seam holds the same point as column 0, so
    // stepping off either end lands on real geometry and the seam's normals
    // come out identical to their twin's without any fixing up afterwards.
    const jj = ((j % segments) + segments) % segments;
    const k = (ii * cols + jj) * 3;
    return out.set(P[k], P[k + 1], P[k + 2]);
  };

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const n = new THREE.Vector3();

  // Does this ring sit on the axis? Then every column is the same point, the
  // angular difference is zero, and the normal has to come from the profile.
  const degenerate = new Array(rows);
  for (let i = 0; i < rows; i++) degenerate[i] = Math.abs(profile[i].r) < 1e-6;

  for (let i = 0; i < rows; i++) {
    const sample = profile[i];
    for (let j = 0; j < cols; j++) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (degenerate[i]) {
        // A pole. The surface faces along the axis, away from the body: which
        // way is decided by where the neighbouring ring sits.
        const other = i === 0 ? profile[1] : profile[rows - 2];
        ny = other.y > sample.y ? -1 : 1;
      } else {
        get(i, j + 1, a);
        get(i, j - 1, b);
        // Along the profile: skip over a pole ring, whose position is the same
        // for every column and would drag the difference towards the axis.
        let ip = i + 1;
        while (ip < rows - 1 && degenerate[ip]) ip++;
        let im = i - 1;
        while (im > 0 && degenerate[im]) im--;
        get(ip, j, c);
        get(im, j, d);
        du.subVectors(a, b);
        dv.subVectors(c, d);
        n.crossVectors(dv, du);
        if (n.lengthSq() < 1e-18) {
          n.set(P[(i * cols + j) * 3], 0, P[(i * cols + j) * 3 + 2]);
        }
        n.normalize();
        nx = n.x;
        ny = n.y;
        nz = n.z;
      }

      const k = (i * cols + j) * 3;
      sink.pos.push(P[k], P[k + 1], P[k + 2]);
      sink.nor.push(nx, ny, nz);
      sink.uv.push((j / segments) * uRepeat, vs[i]);
      const theta = ((j === segments ? 0 : j) / segments) * Math.PI * 2;
      const t = tint ? tint(sample, theta, D[i * cols + j]) : null;
      if (t) sink.col.push(t[0], t[1], t[2]);
      else sink.col.push(1, 1, 1);
    }
  }

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const p0 = base + i * cols + j;
      const p1 = p0 + 1;
      const p2 = p0 + cols;
      const p3 = p2 + 1;
      // Degenerate rings collapse a quad to a triangle; emitting the zero-area
      // half costs one index pair and keeps the loop free of special cases.
      sink.idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
}

// Move everything appended since `start` into place. Lets one sink collect
// several pieces that are each easiest to author at the origin -- a drum lying
// on its side, a square base under a round column -- and still come out as one
// draw call.
export function transformRange(sink, start, matrix) {
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = start; i < sink.pos.length; i += 3) {
    p.set(sink.pos[i], sink.pos[i + 1], sink.pos[i + 2]).applyMatrix4(matrix);
    sink.pos[i] = p.x; sink.pos[i + 1] = p.y; sink.pos[i + 2] = p.z;
    n.set(sink.nor[i], sink.nor[i + 1], sink.nor[i + 2]).applyMatrix3(nm).normalize();
    sink.nor[i] = n.x; sink.nor[i + 1] = n.y; sink.nor[i + 2] = n.z;
  }
}

// A box with every edge and corner rounded off, built as the Minkowski sum of a
// box and a sphere: for a point on a unit cube, clamp it into the inner box and
// the leftover direction IS the surface normal, so faces, edges and corners all
// fall out of one expression with no seams and no computeVertexNormals.
export function roundedBoxInto(sink, { size, radius, segments = 5, tint = null }) {
  const base = sink.pos.length / 3;
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  const inner = half.map((h) => Math.max(1e-4, h - radius));
  const rows = segments + 1;
  const push = (p) => {
    const c = [
      Math.min(inner[0], Math.max(-inner[0], p[0])),
      Math.min(inner[1], Math.max(-inner[1], p[1])),
      Math.min(inner[2], Math.max(-inner[2], p[2])),
    ];
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const n = [d[0] / len, d[1] / len, d[2] / len];
    sink.pos.push(c[0] + radius * n[0], c[1] + radius * n[1], c[2] + radius * n[2]);
    sink.nor.push(n[0], n[1], n[2]);
    // Planar UVs off the two axes the face does not use. The marble map tiles,
    // so nothing has to line up across an edge.
    sink.uv.push((c[0] + c[2]) * 1.4, (c[1] + c[2] * 0.5) * 1.4);
    const t = tint ? tint(c, n) : null;
    if (t) sink.col.push(t[0], t[1], t[2]);
    else sink.col.push(1, 1, 1);
  };

  // Six faces, each a grid. Border vertices are duplicated between faces but
  // land on the same point with the same normal, so the joint is invisible.
  const AX = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  let vert = base;
  for (const [a, b, c] of AX) {
    for (const sgn of [1, -1]) {
      const first = vert;
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < rows; j++) {
          const p = [0, 0, 0];
          p[a] = half[a] * sgn;
          p[b] = half[b] * (-1 + 2 * (i / segments));
          p[c] = half[c] * (-1 + 2 * (j / segments));
          push(p);
          vert++;
        }
      }
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < segments; j++) {
          const p0 = first + i * rows + j;
          const p1 = p0 + 1;
          const p2 = p0 + rows;
          const p3 = p2 + 1;
          if (sgn > 0) sink.idx.push(p0, p2, p1, p1, p2, p3);
          else sink.idx.push(p0, p1, p2, p1, p3, p2);
        }
      }
    }
  }
}
