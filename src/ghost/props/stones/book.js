import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, buildSlabGeometry, buildArcSweepGeometry, inkText } from '../tombstones.js';

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
// trick is the whole reason this piece has a SLOPED base: the book is tipped 20
// degrees, and the wedge under it exists to make that honest rather than a
// stone balanced on a corner.

// --- proportions -----------------------------------------------------------
//
// The flat open spread, in the registry's face coordinates: x runs across both
// pages, y runs along the spine from foot to head. 1.24 by 0.80 is a real open
// book's 1.55:1, and it gives the inscription a 1587 x 1024 canvas, in the
// middle of the engraving treatment's working range.
const W = 0.68; // half the spread
const H = 0.80; // head to foot, along the spine
const GUTTER = 0.036; // the slot the two page blocks leave between them

// Lectern tilt. 20 degrees rather than ledger's 8: this stone stands on a base
// rather than sinking into the ground, so the wedge that buys the tilt is a
// feature and not a stone left hovering. It takes a page from 0.485 of its true
// height on screen to about 0.65.
const TILT = 0.42;
// Each page up and out from the gutter. Enough that the two halves cannot merge
// into one lump, held back from more because the roll turns one page toward the
// camera and the other away, and at much past this the far page goes edge on.
const ROLL = 0.25;
// The curl: the top leaf carries this much roll on top of the block's, so its
// fore-edge lifts about 25mm clear of the pages beneath.
const CURL = 0.045;

// The leaf is a sheet and the block is the mass of pages under it. Both rim
// radii are as close to half the thickness as the sweep allows, which is what
// makes them beads.
const LEAF_D = 0.055;
const LEAF_E = 0.026;
const BLOCK_D = 0.130;
const BLOCK_E = 0.062;
// The block pulled in from the leaf all round, so the fore-edge and the two
// ends show a step: leaf bead, shadow, block bead.
const OUT_INSET = 0.022;
const END_INSET = 0.020;
// ...and the leaf pulled back from the gutter, so it is the BLOCK's bead that
// lines the valley. The leaf's own edge would otherwise swing over the centre
// line when the curl is applied and the two leaves would meet in mid air.
const LEAF_IN = 0.012;
const OVERLAP = 0.010; // leaf sunk into the block at the gutter, so no crack there

// The binding, lying in the bottom of the gutter a little below the page tops.
// Without it the valley floor is the cusp where two rounded lips meet, which is
// the one hard edge this style does not allow, and on a bad seed it is a hole
// through to the base.
const SPINE_R = 0.048;
const SPINE_Z = 0.034;

// --- the base --------------------------------------------------------------
//
// A rounded trapezoid swept along the book's width: flat on the ground, top
// face parallel to the book, near end low and far end high. Built as a sweep
// rather than a rotated slab because a rotated slab has to be buried at one end
// to hide its own footprint, and this one is meant to be SET, not sunk.
const BASE_HALF_X = 0.52; // narrower than the spread, so the pages overhang
const BASE_HALF_Y = 0.28; // half its run up the page
const BASE_DROP = 0.02; // its top face, below the book's own mid plane
const BASE_FRONT = 0.27; // height of the near face
const BASE_SINK = 0.035; // bottom edge carried under the floor
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

const hwLeaf = (W - GUTTER / 2 - LEAF_IN) / 2;
const hwBlock = (W - GUTTER / 2 - OUT_INSET) / 2;

// A convex polygon rounded to radius r, as the arc chain buildArcSweepGeometry
// wants. Points counter-clockwise. Each corner becomes one circle inscribed in
// the angle, and the straight runs between them fall out of the sweep for free,
// exactly as they do for the slab builder's four corners.
function roundedOutline(points, r) {
  const n = points.length;
  return points.map((P, i) => {
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
  // Measured, alpha weighted, on the 1587 x 1024 face: see the note in the lab
  // report. Sized off the PAGE rather than the face, because the face is a
  // double spread and half of it is not available to either word.
  draw(ctx, w, h) {
    const size = h * 0.19;
    // Pages meet at the middle; each word is centred on its own page, pulled a
    // little toward the gutter so it sits on the part of the page nearest the
    // eye rather than out on the lifted fore-edge.
    inkText(ctx, 'GOOD', w * 0.245, h * 0.48, size, size * 0.04);
    inkText(ctx, 'NIGHT', w * 0.755, h * 0.48, size, size * 0.04);
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

    // Per seed: a hair more or less tilt, never less than the mark needs, and a
    // touch of skew on the whole volume so two castings are not one casting.
    const tilt = TILT * (1 + rng() * 0.10);
    const bookGroup = new THREE.Group();
    bookGroup.rotation.x = -Math.PI / 2 + tilt;
    bookGroup.position.y = BOOK_Y;
    body.add(bookGroup);

    for (const s of [-1, 1]) {
      // One group per page, turning about the gutter line, so the roll lifts
      // the fore-edge and leaves the inner edge where it was.
      const page = new THREE.Group();
      page.rotation.y = -s * ROLL * (0.92 + rng() * 0.16);
      bookGroup.add(page);

      // The mass of pages. Its own UVs are the flat spread's, shifted by where
      // this block sits in it, so the two blocks together carry one continuous
      // inscription and neither knows the other exists.
      const bx = s * (hwBlock + GUTTER / 2);
      const block = add(
        page,
        buildSlabGeometry({
          halfWidth: hwBlock,
          height: H - 2 * END_INSET,
          depth: BLOCK_D,
          edge: BLOCK_E,
          bottomRadius: 0.075,
          topRadius: 0.075,
          uv: (x, y, front) => slabUV(x + bx, y + END_INSET, front),
        }),
      );
      block.position.set(bx, -H / 2 + END_INSET, 0);

      // The top leaf, on its own group so the curl turns it about the line
      // where it meets the block rather than about the gutter, which would
      // swing its inner edge across the centre.
      const curl = new THREE.Group();
      curl.position.z = BLOCK_D / 2 - OVERLAP;
      curl.rotation.y = -s * CURL;
      page.add(curl);

      const lx = s * (hwLeaf + GUTTER / 2 + LEAF_IN);
      const leaf = add(
        curl,
        buildSlabGeometry({
          halfWidth: hwLeaf,
          height: H,
          depth: LEAF_D,
          edge: LEAF_E,
          bottomRadius: 0.085,
          topRadius: 0.085,
          uv: (x, y, front) => slabUV(x + lx, y, front),
        }),
      );
      leaf.position.set(lx, -H / 2, LEAF_D / 2);
    }

    // The binding. A capsule rather than a lathe or a tube: both of those come
    // back open at the ends, and a capsule's hemispherical caps are the soft
    // ends the style wants anyway. It runs a little past the pages at head and
    // foot, which is the sliver of spine a real open book shows there.
    const spineGeo = new THREE.CapsuleGeometry(
      SPINE_R,
      H + 0.04 - 2 * SPINE_R,
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
      body,
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

    // No displaced earth and no contact patch. The set has been round both of
    // those and rejected them: a patch laid flat on the floor is the same on
    // every side of the stone, so it rings the piece with a halo that is there
    // on the lit side too. The key light casts the only shadow this has.
  },
});
