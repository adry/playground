import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// The gothic arch: the tall narrow one of the set.
//
// The point is the whole identity, and buildSlabGeometry cannot make one: it
// sweeps a quarter-round profile around a convex four-circle outline, so its
// top is a half-round arch or a pair of squared corners and nothing else. So
// the slab is kept, round top and all, as the body and the carved face, and a
// second swept piece added in extras carries the point.
//
// The head is built on the slab's own principle, generalised from four corner
// circles to an arbitrary convex core curve: every point of the silhouette is
// a core point pushed out by a fixed radius R0 along a known normal, so "inset
// by d" is "pushed out by R0 - d" and the normal is unchanged. Nothing is
// faceted, no normals are averaged, and the apex is a CORNER OF THE CORE, which
// makes the silhouette there a circular cap of radius R0: a soft vinyl peak by
// construction rather than by tuning.
//
// Three things make the joint disappear.
//
// The head SWALLOWS the slab's round top rather than butting onto it. A pointed
// arch and a half-round of the same span springing from the same height are
// tangent at the springing and the pointed one is wider at every height above
// it, so the head's outline contains the slab's, and with the same depth and
// the same edge radius the head's solid contains the slab's. Two rounded pieces
// meeting end to end would leave a valley; this leaves nothing.
//
// The head's front face is exactly coplanar with the slab's and carries exactly
// the slab's face UVs, so where they overlap the two surfaces are the same
// surface, same normal, same texture: coplanar depth values there cannot
// disagree about anything visible. The head is a hair wider (EPS) so the two
// rims never coincide and fight, and its bottom is a flat cut, not a rounded
// edge, so it ends inside the slab without a rim to show.
//
// Above the slab there is no face texture, so the head mirrors the map back
// down from the top edge. The mirror is exactly one to one: an earlier version
// squashed it to keep the mark clear of the reflection, and a squashed normal
// map applies unsquashed slopes over stretched features, which came back as
// stripes down the moulding. Springing the head from the slab's own arch is
// what buys the room: only the top 19% of the map is ever mirrored, and the
// marks live below that.

// Shape. The set runs 1.10 to 1.56 tall including the plinth and 0.74 to 1.00
// wide; this is 1.70 by 0.68, the tallest and the narrowest thing in the
// graveyard, which is what a gothic arch is for. Width is 0.40 of the height
// against the set's 0.6: wider and the point reads as a dent in a round top,
// narrower and it is a plank.
//
// `height` is the slab and so the carved face: 0.68 by 1.284, which at the
// texture's 1024 rows is a 542 px face. The engraving treatment was calibrated
// on faces 528 to 638 px wide, so it is being used inside its range.
const W = 0.34;
const H = 1.284;

// The head. It springs exactly where the slab's own round top does, at
// height - halfWidth: any lower and the slab's shoulders come out through the
// flanks. SKIRT is how far the head continues straight down past the springing
// before its cut; it only has to be long enough that the 1.5 mm side step lands
// somewhere unremarkable. RATIO is the flank arc's radius over the core half
// width and is the one number that says how pointed the arch is: 1.0 is a plain
// half-round, 2.0 an equilateral lancet. 2.3 brings the flanks in to 54 degrees
// off vertical at the apex, which reads as a point at a glance and still leaves
// the tip a rounded cap a fifth of the stone's width across.
const R0 = 0.07;
const EPS = 0.0015;
const SKIRT = 0.1;
const RATIO = 2.3;

// ---------------------------------------------------------------------------
// the arch head

// The convex core outline, counter-clockwise from the bottom right corner.
// Each sample carries a core point, the direction the silhouette is pushed out
// along, and the normal to shade with. Usually those two directions are the
// same: a run of samples sharing a direction is a straight edge, a run sharing
// a core point is a rounded corner, and the silhouette is the core pushed out
// by R0.
//
// The bottom is the exception, and it is why the two directions are separate.
// It is not an edge of the stone, it is a cut through it: the head is sunk into
// the slab and the cut is buried. Rounding it would put a rim halfway up the
// side of the finished stone -- which is exactly what it did on the first
// render -- so the bottom samples push out sideways, like the sides they
// continue, and only their shading normal turns down.
function archCore({ halfWidth, yBottom, ySpring }) {
  const wc = halfWidth - R0;
  const R = RATIO * wc;
  const end = Math.acos((R - wc) / R); // where the two flanks meet on the axis
  const yApex = ySpring + R * Math.sin(end);

  const ring = [];
  const at = (cx, cy, a) => {
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    ring.push({ cx, cy, px: nx, py: ny, nx, ny });
  };
  const cut = (sx) => ring.push({ cx: sx * wc, cy: yBottom, px: sx, py: 0, nx: 0, ny: -1 });
  const arcSeg = Math.max(10, Math.round(SEGMENTS.curve * 0.9));
  const apexSeg = 12;
  // The straight sides are subdivided rather than left as one long edge. The
  // face's v is piecewise: one slope over the slab, another over the head. A
  // triangle spanning the break interpolates across it, and short segments keep
  // that error down where the head's face lies over the slab's.
  const sideSeg = 6;

  cut(1);
  for (let j = 0; j <= sideSeg; j++) at(wc, yBottom + (ySpring - yBottom) * (j / sideSeg), 0);
  const cx = wc - R;
  for (let j = 1; j <= arcSeg; j++) {
    const a = end * (j / arcSeg);
    ring.push({ cx: cx + R * Math.cos(a), cy: ySpring + R * Math.sin(a), px: Math.cos(a), py: Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  for (let j = 1; j <= apexSeg; j++) at(0, yApex, end + (Math.PI - 2 * end) * (j / apexSeg));
  for (let j = arcSeg - 1; j >= 0; j--) {
    const a = end * (j / arcSeg);
    ring.push({ cx: -(cx + R * Math.cos(a)), cy: ySpring + R * Math.sin(a), px: -Math.cos(a), py: Math.sin(a), nx: -Math.cos(a), ny: Math.sin(a) });
  }
  for (let j = 1; j <= sideSeg; j++) at(-wc, ySpring + (yBottom - ySpring) * (j / sideSeg), Math.PI);
  cut(-1);

  return { ring, yApex };
}

// Sweep the core outline front to back through the same quarter-round profile
// the slab uses, so the two pieces have the same rim and read as one moulding.
function buildArchGeometry({ ring, depth, edge, uv, yMid }) {
  const hz = depth / 2;
  const B = Math.max(6, Math.round(SEGMENTS.curve / 2));
  const profile = [];
  for (let k = 0; k <= B; k++) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: edge * (1 - Math.sin(a)), z: hz - edge + edge * Math.cos(a), ns: Math.sin(a), nz: Math.cos(a), front: true });
  }
  // Doubled silhouette ring, as in the slab: the front half carries the face
  // UVs, the sides must not, so the seam hides on the widest edge.
  profile.push({ inset: 0, z: hz - edge, ns: 1, nz: 0, front: false });
  profile.push({ inset: 0, z: -(hz - edge), ns: 1, nz: 0, front: false });
  for (let k = B; k >= 0; k--) {
    const a = (k / B) * (Math.PI / 2);
    profile.push({ inset: edge * (1 - Math.sin(a)), z: -(hz - edge + edge * Math.cos(a)), ns: Math.sin(a), nz: -Math.cos(a), front: false });
  }

  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz, front, t) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    const [u, v] = uv(x, y, front, t);
    uvs.push(u, v);
  };

  const N = ring.length;
  profile.forEach((p, i) => {
    const r = R0 - p.inset;
    const t = i / (profile.length - 1);
    for (const s of ring) {
      push(s.cx + r * s.px, s.cy + r * s.py, p.z, s.nx * p.ns, s.ny * p.ns, p.nz, p.front, t);
    }
  });
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j;
      const b = i * N + j2;
      const c = (i + 1) * N + j2;
      const d = (i + 1) * N + j;
      idx.push(a, c, b, a, d, c);
    }
  }

  const cFront = pos.length / 3;
  push(0, yMid, hz, 0, 0, 1, true, 0);
  const cBack = pos.length / 3;
  push(0, yMid, -hz, 0, 0, -1, false, 1);
  const last = (profile.length - 1) * N;
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    idx.push(cFront, j, j2);
    idx.push(cBack, last + j2, last + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// the mark

// A trefoil: three lobes grown off a central boss. Drawn as four filled discs
// rather than a traced outline, because the union of discs cannot produce a
// feature finer than the groove treatment can hold, and because the concave
// corner where a lobe meets the boss is a real notch -- the thing that stops
// three circles reading as a cloud.
//
// The boss is slightly smaller than a lobe and the lobes sit 1.2 lobe-radii
// out, which leaves each notch a fifth of a lobe wide at its throat and more
// than a lobe deep. `span` is the overall width; the figure is 0.93 of that
// tall and is centred on (cx, cy) by its own bounding box, not by the lobe
// circle, so it sits square on the face.
function inkTrefoil(ctx, cx, cy, span) {
  const r = span / 4.078;
  const d = r * 1.2;
  const oy = cy + 0.25 * d;
  const disc = (x, y, rad) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  disc(cx, oy, r * 0.95);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    disc(cx + d * Math.cos(a), oy + d * Math.sin(a), r);
  }
}

// ---------------------------------------------------------------------------

registerStone('gothic', {
  shape: { halfWidth: W, height: H, depth: 0.27, plinth: 0.17 },
  // topRadius is left at the default full half-round on purpose: that arch is
  // the shape the head is built to swallow, and it is what carries the face all
  // the way up to where the point starts.

  // One closed figure high on the face and one short line under it, on a lot
  // of clean stone. The date does the job R.I.P. does on the cross without
  // repeating it, and four digits hold together at the sixty-odd pixels the
  // mark gets at scene scale where a longer line would smear.
  draw(ctx, w, h) {
    inkTrefoil(ctx, w / 2, h * 0.33, w * 0.38);
    inkText(ctx, '1666', w / 2, h * 0.56, h * 0.1, h * 0.012);
  },

  extras({ body, material, shape, plinthH, halfWidth, height, edge, disposables, frontFrac, stripFrac }) {
    const halfW = halfWidth + EPS;
    const ySpring = height - halfWidth; // where the slab's own round top starts
    const { ring, yApex } = archCore({
      halfWidth: halfW,
      yBottom: ySpring - SKIRT,
      ySpring,
    });

    // Below the slab's top this is the slab's own face mapping, vertex for
    // vertex, so the head's face and the slab's face are one surface carrying
    // one texture. Above it the map is mirrored back down and squashed, which
    // keeps the stone continuous at the joint and puts nothing but mottle on
    // the arch. Everything that is not the front face goes to the plain strip,
    // same as the slab's sides.
    const faceV = (y) => (y <= height ? y / height : 2 - y / height);
    // The sides and back take the plain strip, but across the DEPTH rather than
    // across x. stripUV keys u to x, which on the slab's vertical sides means
    // one texel column smeared over the whole side wall: uv then has no
    // gradient at all in the depth direction, the tangent frame the normal map
    // needs is degenerate there, and the profile's rings come back as stripes
    // down the moulding. Running u along the sweep instead gives the side a
    // real two-dimensional patch of the same plain stone, and the stripes go.
    const uv = (x, y, front, t) =>
      front
        ? [((x + halfWidth) / (2 * halfWidth)) * frontFrac, faceV(y)]
        : [frontFrac + stripFrac * (0.15 + 0.7 * t), Math.min(1, Math.max(0, faceV(y)))];

    const geo = buildArchGeometry({
      ring,
      depth: shape.depth,
      edge,
      uv,
      yMid: (ySpring - SKIRT + yApex + R0) / 2,
    });
    const head = new THREE.Mesh(geo, material);
    head.position.y = plinthH;
    head.castShadow = true;
    head.receiveShadow = true;
    body.add(head);
    disposables.push(geo);
  },
});
