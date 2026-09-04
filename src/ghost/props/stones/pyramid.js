import * as THREE from 'three';
import { registerStone, buildSlabGeometry, inkText } from '../tombstones.js';

// The pyramid monument: the Egyptian-revival grave, and the broad one.
//
// The obelisk is the other stone in this set with a pyramid on it, so the first
// job of every number below is to keep the two from reading as one idea at two
// sizes. They are opposites on purpose:
//
//                      obelisk            pyramid
//   overall            1.85 tall          1.21 tall, the squat one
//   width              0.60               1.00, the widest upright in the set
//   plan               0.60 x 0.50        1.00 x 0.90, square enough to spin
//   shaft              tapered, 1.40      a straight block, 0.60
//   the cap            0.27, a seventh    0.44, over a third of it
//   the joint          swallowed, no line a ledge all the way round
//   the mark           high on the shaft  low on the base, and wide
//
// So: where the obelisk is a shaft with a hat, this is a hat with a base under
// it. The pyramid is a third of the whole, it springs from the TOP of the base
// rather than out of its sides, and the base keeps the ledge it lands on, which
// is the one line that says "set on" instead of "grown out of".
//
// Everything else is the registry's: the swept slab is the base block and
// carries the inscription, the plinth is the bottom step of the stepped base,
// and one more step goes in between.

// --- the numbers -----------------------------------------------------------
//
// A base 1.00 by 0.60 on a 0.17 plinth, capped by a pyramid 0.44 tall, for 1.21
// overall against the cross's 1.56 and fred's 1.10. Height over width is 1.21
// here where the cross is 1.7 and the obelisk 3.1: this is the stone that is
// nearly as wide as it is tall, and the only one whose silhouette is a triangle
// over a bar.
//
// Depth is 0.90 against a width of 1.00, so the plan is very nearly square. It
// has to be. A pyramid on an oblong plan seen from the scene's 45-degree camera
// has one pair of faces foreshortened to a sliver and reads as a gable roof,
// and the four faces meeting at a point are the whole identity of the piece.
const W = 0.50; // half width
const H = 0.60; // the base block, above the plinth
const D = 0.90;
const PLINTH = 0.17;

// --- the pyramid ------------------------------------------------------------
//
// XL is its half width where it lands on the base, and the ceiling on it is the
// base's own flat top: the slab rounds its top edge over at the rim radius
// (0.062), so anything springing from the flat has to stay inside W - 0.062 =
// 0.438 in x and D/2 - 0.062 = 0.388 in z, and the BURIED ring below the flat
// is wider still. At 0.39 and 0.35 the buried ring measures 0.417 by 0.374 and
// clears both by about 0.02.
//
// That ceiling is also what sets the ledge: 0.11 of stone shows all round the
// foot of the pyramid, which is the whole reason this does not read as the
// obelisk's cap. Trying to close it up would put the pyramid's foot out through
// the base's rounded shoulder, where a 52-degree slope and a quarter-round pass
// through tangency and the intersection turns to stipple.
const XL = 0.39;
const ZL = 0.35;
// 52 degrees off horizontal, which is Giza's and about as shallow as a pyramid
// goes before it reads as a lid. Held as its complement, the angle the meridian
// makes with vertical, because that is the angle the sweep below wants.
const PHI = Math.PI / 2 - (52 * Math.PI) / 180;
const TIP = 0.095; // radius of the apex arc: no pyramid in this set has a point
const BURY = 0.035; // how far the pyramid's foot sits below the base's top face
const HIP = 0.09; // corner radius of the plan, i.e. how fat the four hip edges are

// ---------------------------------------------------------------------------
// geometry
//
// A vertical sweep: one horizontal outline carried up a stack of rings, each
// ring a uniform scale of it. Same discipline as buildSlabGeometry turned on
// its side, and the same reason for existing -- the outline is the Minkowski
// sum of four corner circles, so scaling it is exact and shape preserving and
// the normal at every vertex is known in closed form. Nothing here calls
// computeVertexNormals, so nothing here has a hard edge.
//
// This is the obelisk's sweep, minus the parts a pyramid does not need (the
// inset rings its rounded blocks used; the second step here is a slab from the
// registry instead). Neither this nor buildSlabGeometry's private version is
// exported, which is the one thing missing from the contract; see the report.

// One horizontal outline: the point and the outline's outward normal there.
function planOutline(halfX, halfZ, corner, seg) {
  const c = Math.min(corner, Math.min(halfX, halfZ) * 0.999);
  const cx = halfX - c;
  const cz = halfZ - c;
  const out = [];
  for (const [ax, az, a0] of [
    [cx, cz, 0],
    [-cx, cz, Math.PI / 2],
    [-cx, -cz, Math.PI],
    [cx, -cz, Math.PI * 1.5],
  ]) {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (Math.PI / 2) * (j / seg);
      const hx = Math.cos(a);
      const hz = Math.sin(a);
      out.push({ px: ax + c * hx, pz: az + c * hz, hx, hz });
    }
  }
  return out;
}

// Sweep an outline up through rings. A ring is { y, s, dy, ds }: the outline
// scaled by s, sat at height y, with (ds, dy) the meridian's tangent. For a
// point p on the outline with outward normal h the surface normal is
//
//     n = ( h.x * dy,  -ds * (h . p),  h.z * dy )
//
// which is the one line that makes the slope, the apex arc and a straight side
// all the same function.
function sweep({ plan, rings, uv }) {
  const N = plan.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    const [u, v] = uv(x, y, z);
    uvs.push(u, v);
  };

  for (const r of rings) {
    for (const p of plan) {
      push(
        r.s * p.px,
        r.y,
        r.s * p.pz,
        p.hx * r.dy,
        -r.ds * (p.hx * p.px + p.hz * p.pz),
        p.hz * r.dy,
      );
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      idx.push(i * N + j, (i + 1) * N + j2, i * N + j2);
      idx.push(i * N + j, (i + 1) * N + j, (i + 1) * N + j2);
    }
  }
  // Bottom cap only. It is buried in the base block and never seen, but a solid
  // that is open at the bottom throws a shadow with a hole in it. The top needs
  // nothing: the apex ring is scaled to zero, so it is already a point.
  const centre = pos.length / 3;
  push(0, rings[0].y, 0, 0, -1, 0);
  for (let j = 0; j < N; j++) idx.push(centre, j, (j + 1) % N);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// The pyramid itself, in the base block's own frame.
//
// Two straight-sided sections and one arc, tangent throughout:
//
//   1. the slope, from a ring buried BURY under the base's top face up to
//      where the apex arc takes over,
//   2. the apex arc, a circle of radius TIP on the axis, tangent to the slope,
//      because the house style has no points in it.
//
// The foot is buried rather than landed flush, and that is deliberate. The slab
// under it is flat there and the slope crosses it at 52 degrees, so the two
// surfaces separate at once and the intersection is a clean line. The joint the
// obelisk had to solve -- two surfaces running parallel a hair apart, which on a
// 16-bit depth buffer is a band of stipple rather than a hairline -- cannot
// happen here because nothing is parallel to anything.
// The buried base ring, and the scale from the ledge outline up to it.
const R0 = XL + (BURY * Math.sin(PHI)) / Math.cos(PHI);
const Y0 = H - BURY;
// Centre of the apex arc, on the axis. The slope line is y = H + K*(XL - x)
// with K the rise over run, and the circle of radius TIP tangent to it has its
// centre TIP/sin(PHI) below where that line crosses the axis. The apex itself
// is TIP above the centre, so rounding the point off costs 0.056 of height,
// which the numbers at the top already account for.
const CENTRE_Y = H + (Math.cos(PHI) / Math.sin(PHI)) * XL - TIP / Math.sin(PHI);
const APEX = CENTRE_Y + TIP;

function pyramidGeometry({ uv }) {
  const r0 = R0;
  const k = r0 / XL;
  const y0 = Y0;
  const centreY = CENTRE_Y;
  const rings = [];
  const at = (r, y, phi) => rings.push({ y, s: r / r0, dy: Math.cos(phi), ds: -Math.sin(phi) / r0 });

  // Tangency point: on the arc, the point whose outward normal points along the
  // slope's own normal, which is at angle PHI off the horizontal.
  const tx = TIP * Math.cos(PHI);
  const ty = centreY + TIP * Math.sin(PHI);

  at(r0, y0, PHI);
  at(tx, ty, PHI);
  const SEG = 8;
  for (let i = 1; i <= SEG; i++) {
    const a = PHI + (Math.PI / 2 - PHI) * (i / SEG);
    at(TIP * Math.cos(a), centreY + TIP * Math.sin(a), a);
  }

  return sweep({
    plan: planOutline(r0, ZL * k, HIP * k, 10),
    rings,
    uv,
  });
}

// ---------------------------------------------------------------------------
// the mark
//
// One line, low and wide, because that is what the base of a monument carries
// and because this face is the widest in the set: 1.00 by 0.60 gives a 1707 by
// 1024 canvas, two and a half times the cross's area. Coverage is the number
// that decides whether a stone reads busy beside its neighbours, and on a face
// this big a mark sized by eye lands under it. Measured off the real artwork on
// the same code path, the approved cross covers 3.7% of its face and fred 6.3%;
// this line covers 3.8%, and 5.3% of the part of the face that can be SEEN.
//
// That last number is the one to hold on to, because a quarter of this face is
// never on show: the step wraps the bottom 0.11 of the block and the top 0.06
// rolls over into the ledge, so the visible band is v 0.18 to 0.90 and the line
// is centred on IT rather than on the canvas. Ink bounding box 70% of the face
// wide by 17% tall, which is the widest in the set on the widest face in it.
//
// Stroke holds up: texel density is 1024/H either way, so the treatment's
// 17-texel floor is 0.010 in world units here, and the stem of these letters
// measures 41 texels, 0.024, well over twice it.
const LINE = 'AT REST';
const SIZE = 0.25; // cap height, in fractions of the face height
const ROW = 0.46; // baseline of the line, down from the top of the canvas

// ---------------------------------------------------------------------------

registerStone('pyramid', {
  shape: { halfWidth: W, height: H, depth: D, plinth: PLINTH },
  // Both ends squared off, down to the rim radius the chassis clamps at. The
  // base block is a plain die between a step and a pyramid: an arch on top of
  // it would be a third idea, and rounded bottom corners would round the block
  // away exactly where the step wraps it.
  topRadius: 0,
  bottomRadius: 0,

  draw(ctx, w, h) {
    inkText(ctx, LINE, w / 2, h * ROW, h * SIZE, h * SIZE * 0.05);
  },

  extras({ body, material, plinthH, disposables, stripUV }) {
    const add = (geo) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = plinthH; // both extras live in the base block's frame
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      disposables.push(geo);
    };
    // Everything here samples the plain strip on the right of the face texture,
    // at its true height on the stone, so the step picks up the same ground
    // grime the plinth does and the pyramid picks up clean stone, and no piece
    // drags a letter round a corner.
    const parkUV = (span) => (x, y) => stripUV(x, y, span, H);

    // --- the middle step ------------------------------------------------------
    //
    // The registry's plinth is the bottom step and this is the one between it
    // and the base block, so the foot reads as built rather than planted. Half
    // widths run 0.575, 0.535, 0.50: each overhangs the next by the same 0.035,
    // which is what makes three blocks read as one stepped base instead of a
    // stack. It is a slab from the registry rather than a new solid, which is
    // also how it inherits the same rim radius as everything else.
    const sW = W + 0.035;
    const sD = D + 0.07;
    add(
      buildSlabGeometry({
        halfWidth: sW,
        height: 0.11,
        depth: sD,
        edge: 0.05,
        bottomRadius: 0.056,
        topRadius: 0.056,
        uv: parkUV(sW),
      }),
    );

    // --- the pyramid ----------------------------------------------------------
    //
    // Parked in the strip like everything else, but NOT at its true height. The
    // whole cap stands above the base block, so its true height clamps every
    // vertex to the strip's top row, and one row of mottle stretched up four
    // faces this size is a set of vertical streaks. Its own 0 to 1 is mapped
    // into a clean band of the strip instead -- above the grime, short of the
    // top edge -- so the faces get two-dimensional mottling again.
    add(
      pyramidGeometry({
        uv: (x, y) => stripUV(x, H * (0.42 + 0.5 * ((y - Y0) / (APEX - Y0))), R0, H),
      }),
    );
  },
});
