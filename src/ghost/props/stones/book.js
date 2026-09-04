import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// An open book on a low sloped base: the memorial that is carved as a volume
// lying face up, two pages falling away from a central gutter, the inscription
// laid across both of them.
//
// The identity is entirely in the section. Seen from the side this is a shallow
// V on a wedge, and that reads as a book from any distance with nothing written
// on it. What it is NOT is a wedge with lines on it, and the difference is
// three things, all geometry:
//
//   the spine gutter is a real valley, deep enough to survive being seen at a
//   glancing angle, not a groove painted down the middle;
//   the page block is two slabs, a thin top leaf sitting proud of the mass
//   beneath it, so the fore-edge shows a soft step rather than one fat lip;
//   the leaf carries a couple of degrees more roll than the block, so it lifts
//   off it toward the fore-edge, which is the paper's curl.
//
// House style forbids the one thing a real book has, a knife edge, so every
// page edge here is a fat quarter-round: the leaf's rim radius is very nearly
// half its own thickness, which makes the edge a bead rather than a sheet, and
// the page count reads as one soft groove instead of a hundred lines.
//
// Camera. The set's camera sits 29 degrees off the floor, so anything lying
// flat is squashed to 0.485 of its height. ledger.js measured this and bought
// back a third of it by tipping the face 8 degrees toward the viewer. The same
// trick is the whole reason this piece has a SLOPED base: the book is tipped 24
// degrees, which takes a page to about 0.65 of its true height, and the wedge
// under it exists to make that honest rather than a stone balanced on a corner.
//
// The one thing that tilt cannot fix is that the camera is 45 degrees round in
// plan as well as 29 up, so of two pages rolled apart, one always turns toward
// it and one away. That is not a bug to tune out, it is what an open book does;
// what it decides is which word goes where. The longer word goes on the page
// that faces the camera at the set's own placement yaw, which is the left one.

// --- proportions -----------------------------------------------------------
//
// The flat open spread, in the registry's face coordinates: x runs across both
// pages, y runs along the spine from foot to head. 1.36 by 0.80 is a real open
// book's 1.7:1, and it gives the inscription a 1741 x 1024 canvas, in the
// middle of the engraving treatment's working range. It is also the number that
// decides how big a word can be: half the face is not available to either page,
// so a word has about 820px to live in whatever the face measures.
//
// Standing 0.81 with the base, this is the small one of the set, under fred's
// 1.10, and 1.36 across it is the second widest after the ledger.
const W = 0.68; // half the spread
const H = 0.80; // head to foot, along the spine
const GUTTER = 0.075; // the slot the two page blocks leave between them

// Lectern tilt. 20 degrees rather than ledger's 8: this stone stands on a base
// rather than sinking into the ground, so the wedge that buys the tilt is a
// feature and not a stone left hovering. It takes a page from 0.485 of its true
// height on screen to about 0.65.
const TILT = 0.42;
// Each page up and out from the gutter. Enough that the two halves cannot merge
// into one lump, held back from more because the roll turns one page toward the
// camera and the other away, and at much past this the far page goes edge on.
const ROLL = 0.28;
// The curl: the top leaf carries this much roll on top of the block's, so its
// fore-edge lifts about 25mm clear of the pages beneath.
const CURL = 0.050;

// Each page is a stack of three slabs, listed from the mass of paper upward.
// This is the page count, and it is deliberately three and not thirty: a real
// book's leaves are a knife edge, this style has no knife edges, so the count
// has to be told with a few fat beads and the soft grooves between them. Each
// layer is pulled in from the one above at the fore-edge and at head and foot
// and pushed OUT at the gutter, which is the direction a page actually runs,
// and each adds a little curl, so the stack fans open toward the fore-edge.
//
// `rim` stays close to half of `depth`: that is what makes an edge a bead
// rather than a sheet, and it is the whole reason this reads as vinyl.
const LAYERS = [
  { depth: 0.110, rim: 0.052, out: 0.019, gut: 0.000, end: 0.017, rOut: 0.132, rIn: 0.080, curl: 0.00 },
  { depth: 0.042, rim: 0.020, out: 0.009, gut: 0.006, end: 0.008, rOut: 0.144, rIn: 0.060, curl: 0.40 },
  { depth: 0.044, rim: 0.021, out: 0.000, gut: 0.012, end: 0.000, rOut: 0.155, rIn: 0.050, curl: 0.60 },
];
// How far the bottom of the stack sits below the book's own mid plane, and how
// far each layer is sunk into the one below it so no crack opens at the gutter.
const STACK_Z = -0.058;
const OVERLAP = 0.010;

// The binding, lying in the bottom of the gutter a little below the page tops.
// Without it the valley floor is the cusp where two rounded lips meet, which is
// the one hard edge this style does not allow, and on a bad seed it is a hole
// through to the base.
const SPINE_R = 0.055;
const SPINE_Z = 0.036;

// --- the base --------------------------------------------------------------
//
// A rounded trapezoid swept along the book's width: flat on the ground, top
// face parallel to the book, near end low and far end high. Built as a sweep
// rather than a rotated slab because a rotated slab has to be buried at one end
// to hide its own footprint, and this one is meant to be SET, not sunk.
const BASE_HALF_X = 0.56; // narrower than the spread, so the pages overhang
const BASE_HALF_Y = 0.28; // half its run up the page
const BASE_DROP = 0.02; // its top face, below the book's own mid plane
const BASE_FRONT = 0.26; // height of the near face
const BASE_SINK = 0.035; // bottom edge carried under the floor
const MIN_SINK = 0.02; // ...and never less than this once it is measured
const BASE_FLARE = 0.035; // bottom a little longer than the top, so it sits
const BASE_R = 0.075; // corner radius: must stay above the rim radius below
const BASE_E = 0.06;

const nY = Math.cos(TILT);
const nZ = Math.sin(TILT); // the book's own normal, in the body frame
const dY = Math.sin(TILT);
const dZ = -Math.cos(TILT); // and up the page, which runs away from the camera
// Height of the book's centre, fixed by where the near face of the base has to
// come out. Everything else on the piece hangs off this one number.
const BOOK_Y = BASE_FRONT + BASE_HALF_Y * dY + BASE_DROP * nY;

// Lowest point of a geometry once its matrix is applied, walked vertex by
// vertex. Box3.setFromObject would grow the local box by the rotation and hand
// back a tumbling cube's corner, which on a piece whose base is a sweep turned
// a quarter turn about y is wrong by most of its own depth.
function lowestVertex(geometry, matrix) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    if (v.y < min) min = v.y;
  }
  return min;
}

// A convex polygon rounded to radius r, as the arc chain buildArcSweepGeometry
// wants. Points counter-clockwise. Each corner becomes one circle inscribed in
// the angle, and the straight runs between them fall out of the sweep for free,
// exactly as they do for the slab builder's four corners.
function roundedOutline(points, radii) {
  const n = points.length;
  return points.map((P, i) => {
    const r = Array.isArray(radii) ? radii[i] : radii;
    const A = points[(i - 1 + n) % n];
    const B = points[(i + 1) % n];
    const la = Math.hypot(A[0] - P[0], A[1] - P[1]);
    const lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const ux = (A[0] - P[0]) / la;
    const uy = (A[1] - P[1]) / la;
    const vx = (B[0] - P[0]) / lb;
    const vy = (B[1] - P[1]) / lb;
    // |u + v| is 2cos(half the interior angle), so the incircle centre sits at
    // r / sin(half) along the bisector. No trig calls and no sign cases.
    const wx = ux + vx;
    const wy = uy + vy;
    const lw = Math.hypot(wx, wy);
    const cosHalf = lw / 2;
    const sinHalf = Math.sqrt(Math.max(1e-6, 1 - cosHalf * cosHalf));
    const d = r / sinHalf;
    // Outward normal of a counter-clockwise edge with direction e is (ey, -ex).
    // The incoming edge runs P-A, i.e. -u; the outgoing one runs +v.
    let a0 = Math.atan2(ux, -uy);
    let a1 = Math.atan2(-vx, vy);
    while (a1 < a0) a1 += Math.PI * 2;
    return { cx: P[0] + (wx / lw) * d, cy: P[1] + (wy / lw) * d, r, a0, a1, sign: 1 };
  });
}

// One page, in the flat spread's own coordinates, so it can be handed slabUV
// unaltered and the two pages together carry one continuous inscription.
//
// The two corners at the fore-edge are rounded hard and the two at the gutter
// barely at all. That asymmetry is the page: a book's outer corners are the
// thumbed ones and its inner ones are buried in the binding, and it is also
// what stops each half from reading as a rounded tile. The slab builder cannot
// express it, since its radii come in a top pair and a bottom pair, which is
// the whole reason these are sweeps.
function pageOutline(s, xInner, xOuter, y0, y1, rInner, rOuter) {
  const lo = Math.min(s * xInner, s * xOuter);
  const hi = Math.max(s * xInner, s * xOuter);
  const rLo = s > 0 ? rInner : rOuter;
  const rHi = s > 0 ? rOuter : rInner;
  return roundedOutline(
    [[lo, y0], [hi, y0], [hi, y1], [lo, y1]],
    [rLo, rHi, rHi, rLo],
  );
}

// The base's profile, in (z, y) of the body frame: the sweep then lies along x.
// The two top corners are the book's own plane offset by BASE_DROP, which is
// what keeps the wedge and the book parallel however TILT is tuned.
function baseOutline() {
  const az = BASE_HALF_Y * -dZ - BASE_DROP * nZ;
  const ay = BOOK_Y - BASE_HALF_Y * dY - BASE_DROP * nY;
  const bz = -BASE_HALF_Y * -dZ - BASE_DROP * nZ;
  const by = BOOK_Y + BASE_HALF_Y * dY - BASE_DROP * nY;
  return roundedOutline(
    [
      [az + BASE_FLARE, -BASE_SINK],
      [az, ay],
      [bz, by],
      [bz - BASE_FLARE, -BASE_SINK],
    ],
    BASE_R,
  );
}

registerStone('book', {
  // depth and plinth here build the registry's own slab and plinth, which this
  // stone throws away in extras: an open book is two page blocks and a wedge,
  // and none of the three is an upright slab on a pad. They are left at
  // ordinary values so the sweep that builds them cannot fold. halfWidth and
  // height are NOT throwaway, they are the flat spread, and they set both the
  // face texture's aspect and the slabUV mapping every page samples through.
  shape: { halfWidth: W, height: H, depth: 0.20, plinth: 0.15 },
  topRadius: 0.10,
  bottomRadius: 0.10,

  // One word per page, centred, nothing else. The temptation on this stone is
  // to fill two pages, which is exactly how the rejected set reached 19% ink;
  // two short words split by the gutter is the most a face seen at 65% of its
  // height can carry, and it uses the gutter as the space between them rather
  // than fighting it.
  //
  // Measured, alpha weighted, on the 1741 x 1024 face: 3.4% ink, against 3.6,
  // 6.3 and 9.1 for the approved cross, fred and bat, and against the 12 to 19
  // that got the last set rejected. The ink's bounding box is 88% of the face
  // wide, which looks alarming beside the approved cross's 29% and is not the
  // same measurement: this is two separate clusters at opposite ends of a
  // double spread, each 36% of the face, with the gutter between them. Neither
  // word is wider than 76% of its own page.
  draw(ctx, w, h) {
    const size = h * 0.195; // a 32-texel stroke, well clear of the 17 at which a cut collapses
    // Each word centred on its own page, pulled a little toward the gutter so
    // it sits on the part of the page nearest the eye rather than out on the
    // lifted fore-edge.
    inkText(ctx, 'SLEEP', w * 0.238, h * 0.48, size, size * 0.04);
    inkText(ctx, 'WELL', w * 0.762, h * 0.48, size, size * 0.04);
  },

  extras({ body, material, rng, disposables, stripUV, slabUV }) {
    // The registry's upright slab and its pad both go. Their geometry is still
    // owned by dispose(), so nothing leaks; what is bought is a silhouette with
    // no competing planes in it, which the postmortem is emphatic about.
    for (const m of body.children.filter((o) => o.isMesh)) body.remove(m);

    const add = (parent, geo) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      disposables.push(geo);
      return mesh;
    };

    // Everything this stone owns hangs off one group, so the seating measured
    // at the end can move the whole piece rather than each mesh in turn.
    const piece = new THREE.Group();
    body.add(piece);

    // Per seed: a hair more or less tilt, never less than the mark needs, so a
    // casting can only ever be more legible than the one it was tuned on.
    const tilt = TILT * (1 + rng() * 0.10);
    const bookGroup = new THREE.Group();
    bookGroup.rotation.x = -Math.PI / 2 + tilt;
    bookGroup.position.y = BOOK_Y;
    piece.add(bookGroup);

    for (const s of [-1, 1]) {
      // One group per page, turning about the gutter line, so the roll lifts
      // the fore-edge and leaves the inner edge where it was.
      const page = new THREE.Group();
      page.rotation.y = -s * ROLL * (0.92 + rng() * 0.16);
      bookGroup.add(page);

      // The stack, bottom up. Each layer hangs off the one below it, so its
      // curl turns it about the line where the two meet rather than about the
      // gutter: turned about the gutter a layer's inner edge would swing across
      // the centre line and the two pages would meet in mid air.
      let host = page;
      let lift = STACK_Z;
      for (const L of LAYERS) {
        const g = new THREE.Group();
        g.position.z = lift;
        g.rotation.y = -s * CURL * L.curl;
        host.add(g);
        const mesh = add(
          g,
          buildArcSweepGeometry({
            outline: pageOutline(s, GUTTER / 2 + L.gut, W - L.out, L.end, H - L.end, L.rIn, L.rOut),
            depth: L.depth,
            edge: L.rim,
            uv: slabUV,
          }),
        );
        mesh.position.set(0, -H / 2, L.depth / 2);
        host = g;
        lift = L.depth - OVERLAP;
      }
    }

    // The binding. A capsule rather than a lathe or a tube: both of those come
    // back open at the ends, and a capsule's hemispherical caps are the soft
    // ends the style wants anyway. It runs a little past the pages at head and
    // foot, which is the sliver of spine a real open book shows there.
    const spineGeo = new THREE.CapsuleGeometry(
      SPINE_R,
      H - 0.02 - 2 * SPINE_R,
      Math.max(6, Math.round(SEGMENTS.curve * 0.5)),
      SEGMENTS.radial,
      1,
    );
    // Its own UVs are cylindrical, which would wrap the inscription round the
    // binding. Parked in the plain strip by angle, so the seam sits where the
    // capsule's own seam already is.
    {
      const pos = spineGeo.getAttribute('position');
      const uv = spineGeo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 0.5;
        const [u, v] = stripUV(a - 0.5, pos.getY(i) + H / 2, 0.5, H);
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
    }
    add(bookGroup, spineGeo).position.set(0, 0, SPINE_Z);

    // The base. Everything on it samples the grime band at the bottom of the
    // texture, the same fifth of it the registry's own plinth uses, so an
    // up-facing slab of clean stone cannot read as a whiter material than the
    // book standing on it.
    const GRIME = 0.2;
    const baseSpan = BASE_HALF_Y + BASE_FLARE + BASE_DROP;
    const base = add(
      piece,
      buildArcSweepGeometry({
        outline: baseOutline(),
        depth: BASE_HALF_X * 2,
        edge: BASE_E,
        uv: (x, y) => stripUV(x, y + BASE_SINK, baseSpan, BOOK_Y + BASE_SINK + 0.2, GRIME),
      }),
    );
    // Built in the (z, y) plane and swept along its own z; a quarter turn puts
    // the sweep across the book's width and the profile front to back.
    base.rotation.y = -Math.PI / 2;

    // And now the one number a viewer can see is checked rather than assumed.
    // The base is meant to be SET: its bottom bead runs under the floor, so no
    // seed and no future change to TILT can leave a corner of it hovering. The
    // registry's own lean and its 12mm sink come after this and only ever add
    // to the margin. Measured at the values above: the bottom lands at -0.035,
    // which is the whole bead.
    base.updateMatrix();
    const low = lowestVertex(base.geometry, base.matrix);
    if (low > -MIN_SINK) piece.position.y = -MIN_SINK - low;

    // No displaced earth and no contact patch. The set has been round both of
    // those and rejected them: a patch laid flat on the floor is the same on
    // every side of the stone, so it rings the piece with a halo that is there
    // on the lit side too. The key light casts the only shadow this has.
  },
});
