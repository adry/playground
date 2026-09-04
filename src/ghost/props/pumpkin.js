import * as THREE from 'three';
import { toyMaterial, PALETTE, SEGMENTS, contactShadow } from './style.js';

// A squat ribbed jack-o'-lantern in the house vinyl-toy style: smooth lobes, a
// curved tapering stem, and a carved face that glows from inside.
//
// Everything curved here is generated parametrically rather than assembled from
// primitives, for one reason: the ribs. A lathe or a scaled sphere cannot make
// a lobed silhouette, and a low-segment lobed silhouette reads as faceted --
// exactly the look style.js rules out. So the body is one smooth parametric
// surface, sampled densely enough that the outline never shows a straight run.
//
// The shell is opaque and real holes would need CSG, so the face is built as
// emissive patches *projected onto the same surface function* as the shell and
// pushed out along the local normal by a hair. Because they are evaluated from
// the identical math, they follow the ribs instead of floating over them.

// --- Shape constants -------------------------------------------------------
// Authored against the ghost (1.6 tall, hem near 0.2): body ~0.39 tall and
// ~0.80 across, stem on top, ~0.6 overall.
const BODY_R = 0.40;   // equator radius before the ribs bite into it
const BODY_H = 0.345;  // half-height of the un-dished profile
// Nearer 2 is nearer a true ellipsoid. The earlier 2.5 squared off the
// shoulders and flattened the poles, which is what read as not round enough.
const SQUASH = 2.08;
const DIP = 0.26;      // how hard the poles are pulled back in, making the stem dish
const RIB_SHARP = 1.5; // >1 narrows the groove and widens the lobe crest

// The face looks along +x+z so it meets the preview/game camera square-on at
// spin 0; the lobe crest sits at the same angle so the face lands on a bulge.
const FACE_YAW = Math.PI / 4;

// Tessellation. SEGMENTS is sized for plain round surfaces; a lobed one needs
// several times that many steps around, or the grooves stair-step, so the
// counts here scale the house numbers up rather than reusing them blind.
const RINGS = SEGMENTS.height * 4;

// What the lamp, the carving and its bloom look like at the bottom and the top
// of the flicker's swing. All three are driven off the one value, which is what
// makes the light and the face read as the same flame.
const LAMP = { min: 1.05, max: 3.10 };     // PointLight intensity
// Raised once the interior was recessed. Sunk a shell thickness behind a wall,
// the plate lost the light the old flush patch caught, and at game size the
// faces went dim. The reference's openings are close to white anyway.
const GLOW = { min: 1.18, max: 1.82 };     // face emissiveIntensity
// The cuts are real holes with a real wall now, so what used to be a painted
// bloom on the skin is instead a faint emissive on that wall: the flame washing
// the inside of the opening. Kept low, because the hemisphere light is what
// gives the cut its shape -- ceiling dark, lower lip catching the sky -- and a
// strong emissive would flatten exactly that.
const WASH = { min: 0.07, max: 0.20 };      // flame washing the inside of the cuts

// The flame's two ends: a dull ember at the bottom of a gutter, bright flame at
// the top of a flare.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();

// Small deterministic PRNG: same seed, same pumpkin, and nothing at module scope.
function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Smooth 1D value noise. Layered at a few rates this is what makes the light
// read as a flame: white noise reads as a failing bulb, a sine reads as a pulse.
function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f); // smoothstep, so the derivative is continuous
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

export function createPumpkin({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: these are the same toy, not different ones.
  const lobes = 9 + Math.floor(rand() * 3);          // 9..11
  // Shallower grooves: deep ones cut the round silhouette into a gear.
  const ribDepth = 0.085 + rand() * 0.025;
  const bodyR = BODY_R * (0.96 + rand() * 0.08);
  const bodyH = BODY_H * (0.96 + rand() * 0.08);
  // The stem leans relative to the *face*, not to world axes, so the bend reads
  // from the angle the face is being seen from.
  const side = rand() < 0.5 ? -1 : 1;
  const aStem = side * (0.38 + rand() * 0.16) * Math.PI;   // out to one side
  const flickerPhase = rand() * 100;

  // --- The body surface ----------------------------------------------------
  // s runs -1 (bottom pole) .. +1 (top pole); a is the angle around, measured
  // from the middle of the front lobe.

  // Superellipse profile: full through the middle, flat-shouldered at the poles.
  const profileR = (s) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), SQUASH)), 1 / SQUASH);

  // Pull the last stretch of each pole back toward the centre so the top and
  // bottom sit in a shallow dish, the way a pumpkin does around its stem.
  const profileY = (s) => {
    const t = Math.max(0, (Math.abs(s) - 0.55) / 0.45);
    return bodyH * (s - Math.sign(s) * DIP * t * t);
  };

  // Grooves, deepest at a = ±pi/lobes, zero at the crest so the front lobe is a
  // clean bulge for the face to sit on.
  const rib = (a) => 1 - ribDepth * Math.pow(0.5 - 0.5 * Math.cos(lobes * a), RIB_SHARP);

  // Because of the dish, the lowest point of the shell is a ring rather than the
  // pole. Find it numerically and stand the prop on it, so y = 0 is the ground.
  let lowest = Infinity;
  for (let i = 0; i <= 400; i++) lowest = Math.min(lowest, profileY(-1 + (2 * i) / 400));
  const yBase = -lowest;

  const surface = (a, s, target) => {
    const r = bodyR * profileR(s) * rib(a);
    const u = a + FACE_YAW;
    return target.set(r * Math.sin(u), profileY(s) + yBase, r * Math.cos(u));
  };

  // Numeric normal. Cross(d/da, d/ds) points outward for this parameterisation
  // (checked at the equator), which also fixes the triangle winding below.
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const surfaceNormal = (a, s, target) => {
    const e = 2e-3;
    const sc = Math.min(0.999, Math.max(-0.999, s));
    surface(a + e, sc, tmpA).sub(surface(a - e, sc, tmpB));
    surface(a, Math.min(0.999, sc + e), tmpC).sub(surface(a, Math.max(-0.999, sc - e), tmpD));
    return target.crossVectors(tmpA, tmpC).normalize();
  };


  // --- Mapping face coordinates onto the shell -----------------------------
  // Face shapes are authored in (X across the surface, Y height above ground)
  // so they keep their proportions; this inverts the profile to get back to s.
  // S_HI runs well past the widest part of the body on purpose: the reference's
  // eyes sit high enough that their apexes land near s = 0.67, and a table that
  // stopped at the shoulder would clamp them onto the crown.
  const S_LO = -0.78, S_HI = 0.86, S_N = 512;
  const yTable = new Float32Array(S_N + 1);
  for (let i = 0; i <= S_N; i++) yTable[i] = profileY(S_LO + ((S_HI - S_LO) * i) / S_N) + yBase;
  const sOfY = (y) => {
    let lo = 0, hi = S_N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (yTable[mid] < y) lo = mid; else hi = mid;
    }
    const span = yTable[hi] - yTable[lo] || 1;
    const f = (y - yTable[lo]) / span;
    return S_LO + ((S_HI - S_LO) * (lo + f)) / S_N;
  };

  // The glowing interior sits at the BOTTOM of the cut, one shell thickness in,
  // not on the skin. Laid on the skin it was a sticker: at three quarters the
  // glow met the outer surface with nothing in between, and no amount of
  // shading on a coplanar patch fixes that. SHELL_T is what the wall built
  // below spans, so plate and wall meet exactly.
  // 7% of the body radius. The reference reads thicker, nearer a tenth, but the
  // grin is only 0.086 tall from lip to lip and a wall that deep swallowed it:
  // seen from three quarters the near lip occluded more than the whole band and
  // the mouth broke into fragments. This is as thick as the thinnest feature on
  // the face can carry.
  const SHELL_T = 0.028;
  const WALL_TAPER = 0.005; // how much narrower the cut is at its bottom
  // The wall's top ring laps this far back over the skin, a hair proud of it,
  // rather than meeting the hole edge exactly. Meeting exactly is correct and
  // fragile: at three quarters the far eye, seen nearly edge on, opened a crack
  // of daylight at its sharpest corner. Lapping the joint shuts that for good,
  // and the sliver of darker wall it leaves on the skin reads as the lip of the
  // cut, which the reference has anyway.
  const WALL_LIP = 0.007, WALL_PROUD = 0.0006;
  // The seed rescales the shell a few percent in each axis, so the face has to
  // ride that scale instead of sitting at fixed heights. Authored absolutely,
  // the eyes -- which sit high on the shoulder -- ran off the crown of a
  // small-seeded body and got clamped. Scaling X keeps the same angle round the
  // body, scaling Y the same fraction of its height, so every seed wears the
  // same face.
  const FACE_SX = bodyR / BODY_R;
  const FACE_SY = bodyH / BODY_H;
  const facePoint = (X, Y, lift, target) => {
    const s = sOfY(Y * FACE_SY);
    // Angular mapping uses the un-ribbed radius, so the face is not stretched
    // and squeezed as it crosses the grooves -- it just drapes over them.
    const a = (X * FACE_SX) / Math.max(0.05, bodyR * profileR(s));
    surface(a, s, target);
    surfaceNormal(a, s, tmpN);
    return target.addScaledVector(tmpN, lift);
  };

  // Builds one geometry from a list of patches, each a 2D sampler over the unit
  // square projected onto the shell. Everything is a grid so the tessellation
  // stays dense and evenly shaped; triangles are authored as degenerate grids
  // (the base edge collapsed to a point at v = 1).
  const patchGeometry = (defs, lift) => {
    const verts = [];
    const idx = [];
    const p = new THREE.Vector3();
    let base = 0;
    for (const { nx, ny, sampler } of defs) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const [X, Y] = sampler(i / nx, j / ny);
          facePoint(X, Y, lift, p);
          verts.push(p.x, p.y, p.z);
        }
      }
      const vi = (i, j) => base + j * (nx + 1) + i;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          idx.push(vi(i, j), vi(i + 1, j), vi(i, j + 1), vi(i + 1, j), vi(i + 1, j + 1), vi(i, j + 1));
        }
      }
      base += (nx + 1) * (ny + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Triangle: base edge at v = 0, collapsing to the apex at v = 1.
  const triSampler = (ax, ay, blx, bly, brx, bry) => (u, v) => [
    (blx + (brx - blx) * u) * (1 - v) + ax * v,
    (bly + (bry - bly) * u) * (1 - v) + ay * v,
  ];

  // --- The carved face -------------------------------------------------------
  // These numbers are solved off .ref/ref-pumpkin.png, not eyeballed. Each
  // landmark in the photo was measured in pixels, both pumpkins were pinned to
  // their own silhouette (axis, widest row, width) so the two could be laid over
  // each other, and every point was then run back through this camera to find
  // the (X, Y) on this shell that lands on it. Two earlier passes were laid out
  // by feel and both came out with the same tell: a face that had slid down the
  // belly. On the reference the eyes are up on the shoulder, near s = 0.67, and
  // the mouth's corners sit only a little below the equator.
  //
  // Everything below is authored against the nominal BODY_R / BODY_H; facePoint
  // rescales it onto whatever body the seed actually built.

  // Eyes. Tilted triangles, not the level symmetric ones we had: on the
  // reference each base slopes down toward the nose by about 15 degrees, and
  // measured along that tilted base the apex sits a quarter of the way out
  // toward the outer corner rather than over the middle. That lean is most of
  // what stops them reading as a pair of tents. They are also set wide: the
  // outer corner reaches a good deal further round the body than the inner one.
  // Grown 4% from the first solve, applied as a uniform scale about the
  // triangle's own centroid so the tilt, which was right, is untouched.
  const EYE = {
    apexX: 0.1390, apexY: 0.4831,   // apex, high on the shoulder
    outX: 0.2026, outY: 0.4042,     // outer base corner, the high end of the base
    inX: 0.0969, inY: 0.3774,       // inner base corner, dropped toward the nose
  };
  const eye = (dir) => triSampler(
    EYE.apexX * dir, EYE.apexY,
    EYE.outX * dir, EYE.outY,
    EYE.inX * dir, EYE.inY,
  );

  // Nose: an apex-up triangle a little under half an eye by area. Widened and
  // dropped from the first solve: on the reference the gap from its base to the
  // top of the grin measures about three quarters of what we had, so the nose
  // hangs closer to the mouth than to the eyes.
  const NOSE_W = 0.0400, NOSE_TIP = 0.3895, NOSE_BASE = 0.3264;
  const nose = triSampler(0, NOSE_TIP, -NOSE_W, NOSE_BASE, NOSE_W, NOSE_BASE);

  // Mouth. One tall opening with teeth intruding into it, which is the whole
  // difference between a carved grin and a row of boxes. The first solve had the
  // right outline but the teeth reached nearly the full height of the band, and
  // that chopped the mouth into five disconnected cells: segment, tooth,
  // segment, tooth, segment. On the reference a continuous channel of light runs
  // the entire width behind the teeth and never closes.
  //
  // Widths and heights below are the re-measured reference: tips at dx 243 of a
  // 862px body, upper edge flat near y 635 and lower near y 705, both taken back
  // through this camera, and then opened up about a tenth. The reference's
  // chamfer is shallow where ours is a real wall a tenth of a body radius deep,
  // and that wall eats into the band from both sides; measured exactly, the
  // glow left between the lips came out thinner than the photograph's.
  const MW = 0.2300;      // half width
  const M_TOP = 0.2710;   // upper edge across the middle
  const M_BOT = 0.1735;   // lower edge across the middle
  const M_TIP = 0.2940;   // where the two edges meet, at the lifted corners
  // The lower edge is not level: on the reference it hangs about 0.009 deeper
  // halfway out than it does at the centre, which is what gives the grin its two
  // rounded lobes either side of the middle tooth. Left level, that stretch came
  // out as a straight shelf.
  const M_SAG = 0.009;
  // Both edges hold their level across the middle and then sweep up into the
  // point. The exponents are a little lower than the reference measures, which
  // starts the taper earlier: our cut is a flat plate with a hard rim where the
  // reference's is chamfered, and without that chamfer eating into the last of
  // the band our ends stopped in a blunt vertical edge instead of a point.

  // Teeth are blocks, not spikes: the little linear triangles we had before
  // merged into the grin and the whole mouth read as a W. block() is a plateau
  // with only the outermost `ramp` of each flank falling away, which gives a
  // trapezoid with shoulders you can actually see; a small ramp keeps the sides
  // near vertical, the way the reference's upper teeth are cut. Smoothstep and
  // not a straight line, so a shoulder lands as a corner rather than a
  // staircase across the sampling grid.
  const block = (d, ramp) => {
    const t = Math.min(1, Math.max(0, (1 - d) / ramp));
    return t * t * (3 - 2 * t);
  };
  // Tooth sizes are absolute, not fractions of the band: they all sit in the
  // flat middle where the band barely changes. Both are under half the band's
  // 0.086 on purpose. Measured off the reference the upper teeth bite about 40% of the
  // way down; past a half and the channel of light behind them closes, which is
  // what turned the first grin into five separate boxes.
  const TOOTH_X = 0.122, TOOTH_HW = 0.046, TOOTH_DEPTH = 0.042, TOOTH_RAMP = 0.16;
  // The lower tooth is a dome five times wider than it is tall, not the tall
  // block it was. Root rather than parabola so the top is broad and the flanks
  // land softly on the lower edge instead of cutting two square notches in it.
  const LOW_HW = 0.098, DOME_H = 0.060, LOW_ROUND = 0.55;
  // Nothing may eat more than this much of the band, so the channel survives
  // whatever the numbers above are nudged to.
  const CLEAR = 0.22;

  const mouth = (u, v) => {
    const x = -MW + 2 * MW * u;
    const q = Math.abs(x) / MW;
    const top0 = M_TOP + (M_TIP - M_TOP) * Math.pow(q, 2.4);
    const sag = Math.max(0, 1 - Math.pow((q - 0.5) / 0.5, 2));
    const bot0 = M_BOT - M_SAG * sag + (M_TIP - M_BOT) * Math.pow(q, 3.8);
    const gap = top0 - bot0;
    // Two teeth hang down from the upper edge, just inside the eyes.
    let bite = 0;
    for (const tx of [-TOOTH_X, TOOTH_X]) {
      bite += TOOTH_DEPTH * block(Math.abs(x - tx) / TOOTH_HW, TOOTH_RAMP);
    }
    // One broad tooth rises from the lower edge in the middle.
    const dLow = Math.min(1, Math.abs(x) / LOW_HW);
    const grow = DOME_H * Math.pow(1 - dLow * dLow, LOW_ROUND);
    const room = Math.max(0, gap * (1 - CLEAR));
    const top = top0 - Math.min(bite, room);
    const bottom = bot0 + Math.min(grow, room);
    return [x, top + (bottom - top) * v];
  };

  // The mouth needs the samples: at 96 across, a tooth flank fell inside a
  // single column and its shoulders came out as a staircase. 240 puts two or
  // three columns in the flank, which is enough for the smoothstep to read.
  const FACE_SHAPES = [
    { nx: 14, ny: 14, sampler: eye(-1) },
    { nx: 14, ny: 14, sampler: eye(1) },
    { nx: 10, ny: 10, sampler: nose },
    { nx: 240, ny: 10, sampler: mouth },
  ];


  // --- Cutting the openings --------------------------------------------------
  // The face used to be emissive patches lying on the skin. Head on that passes;
  // at three quarters it is plainly a sticker, because a real cut has a wall and
  // a wall is the whole of the depth cue. Turned away from the camera it shows a
  // band of shaded orange between skin and glow, turned toward it that band
  // pinches to nothing, and the near lip hides part of the interior. None of
  // that can be painted on, and every attempt to shade it in falls apart at
  // exactly the angle that matters.
  //
  // No general CSG is needed for it. The shell is already a grid over (a, s) and
  // every face shape is already a closed outline in face space, so an opening is
  // just a region of that grid: drop the quads whose centres fall inside, pull
  // the vertices left on the rim onto the true outline so the edge does not
  // staircase along grid lines, and extrude that rim inward along the surface
  // normal to build the wall.

  // Face-space position of a grid vertex: the inverse of what facePoint does.
  const faceOf = (a, s) => {
    const aw = a > Math.PI ? a - Math.PI * 2 : a;
    return [(aw * bodyR * profileR(s)) / FACE_SX, (profileY(s) + yBase) / FACE_SY];
  };

  // Each cut's outline, walked off the shape's own sampler rather than written
  // out again, so the hole, its wall and the emissive plate at the bottom of it
  // are the same curve by construction instead of by three sets of numbers
  // agreeing with each other.
  const outlineOf = (sampler, n) => {
    const pts = [];
    const add = (u, v) => {
      const q = sampler(u, v);
      const last = pts[pts.length - 1];
      if (!last || Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) > 1e-7) pts.push(q);
    };
    for (let i = 0; i <= n; i++) add(i / n, 0);
    for (let i = 1; i <= n; i++) add(1, i / n);
    for (let i = 1; i <= n; i++) add(1 - i / n, 1);
    for (let i = 1; i < n; i++) add(0, 1 - i / n);
    // Triangles are authored as grids with the top edge collapsed, so the walk
    // above revisits the apex; drop whatever doubles back onto the start.
    while (pts.length > 2) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.abs(f[0] - l[0]) + Math.abs(f[1] - l[1]) < 1e-7) pts.pop(); else break;
    }
    // Wound counter-clockwise, so "into the cut" is one fixed rotation of the
    // edge tangent everywhere. Aiming at the shape's centroid instead would
    // point the wrong way down the flank of a tooth.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const f = pts[i], g = pts[(i + 1) % pts.length];
      area += f[0] * g[1] - g[0] * f[1];
    }
    if (area < 0) pts.reverse();
    return pts;
  };

  const CUTS = FACE_SHAPES.map(({ sampler }) => {
    const pts = outlineOf(sampler, 160);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of pts) {
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    }
    return { pts, minX, maxX, minY, maxY };
  });

  // Crossing count, bounding box first. Without the box this runs over every
  // grid vertex against every outline point and costs more than the mesh.
  const inCut = (cut, X, Y) => {
    if (X < cut.minX || X > cut.maxX || Y < cut.minY || Y > cut.maxY) return false;
    const pts = cut.pts;
    let hit = false;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const yi = pts[i][1], yk = pts[k][1];
      if ((yi > Y) !== (yk > Y) && X < ((pts[k][0] - pts[i][0]) * (Y - yi)) / (yk - yi) + pts[i][0]) hit = !hit;
    }
    return hit;
  };
  const cutAt = (X, Y) => {
    for (const cut of CUTS) if (inCut(cut, X, Y)) return cut;
    return null;
  };

  // Nearest point on an outline, and the inward normal of the segment it landed
  // on. That normal is what the wall is built against, so no loop tracing is
  // needed: each rim vertex carries its own direction into the cut.
  const snapTo = (cut, X, Y) => {
    const pts = cut.pts;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const f = pts[i], g = pts[(i + 1) % pts.length];
      const ex = g[0] - f[0], ey = g[1] - f[1];
      const len2 = ex * ex + ey * ey || 1e-12;
      const t = Math.min(1, Math.max(0, ((X - f[0]) * ex + (Y - f[1]) * ey) / len2));
      const cx = f[0] + ex * t, cy = f[1] + ey * t;
      const d = (X - cx) * (X - cx) + (Y - cy) * (Y - cy);
      if (d < bestD) {
        bestD = d;
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        best = { X: cx, Y: cy, nx: -ey * inv, ny: ex * inv };
      }
    }
    return best;
  };

  // --- Shell mesh ----------------------------------------------------------
  // Denser than the plain shell needed. The grid is now the thing being cut, so
  // its cell has to be small next to a tooth flank; at the old 180 x 96 a whole
  // tooth was three cells wide and snapping could not rescue the outline.
  const radial = Math.max(lobes * 22, SEGMENTS.radial * 2);
  const shellVerts = [];
  const shellNors = [];
  const shellColors = [];
  const shellIdx = [];
  const wallVerts = [];
  const wallNors = [];
  const wallColors = [];
  const wallIdx = [];

  (() => {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const skin = new THREE.Color(PALETTE.pumpkinSkin).convertSRGBToLinear();
    const shade = new THREE.Color(PALETTE.pumpkinShade).convertSRGBToLinear();
    const c = new THREE.Color();

    const colorAt = (a, s) => {
      // Paint the grooves with the palette's shade colour. Real shading already
      // darkens them; this keeps them readable when the key light is head-on.
      const g = Math.pow(0.5 - 0.5 * Math.cos(lobes * a), 0.9);
      c.copy(skin).lerp(shade, g * 0.20);
      // A touch more shade in the last of the underside, standing in for the
      // contact occlusion a prop this simple gets no other way. Kept small:
      // overdoing it turns the palette's orange into a muddy red.
      const low = Math.max(0, -s - 0.55) / 0.45;
      return c.lerp(shade, low * low * 0.12);
    };

    // Ring vertices are stored in (a, s) first so the rim ones can be moved
    // before any position is baked.
    const nRing = RINGS - 1;
    const va = new Float64Array(nRing * radial);
    const vs = new Float64Array(nRing * radial);
    const rimNX = new Float64Array(nRing * radial);
    const rimNY = new Float64Array(nRing * radial);
    const isRim = new Uint8Array(nRing * radial);
    const vk = (j, i) => (j - 1) * radial + ((i % radial) + radial) % radial;

    for (let j = 1; j < RINGS; j++) {
      const s = -Math.cos((Math.PI * j) / RINGS);
      for (let i = 0; i < radial; i++) {
        const k = vk(j, i);
        va[k] = (i / radial) * Math.PI * 2;
        vs[k] = s;
      }
    }

    // Quad (j, i) spans rings j..j+1 and columns i..i+1, for j = 1..RINGS-2, and
    // is dropped when its centre falls inside a cut. Testing all four corners
    // instead keeps the hole strictly inside the outline, which is safer, but it
    // also blunts every corner by a whole cell: the nose came out a hexagon.
    // Centre testing keeps the shape and the two guards below cover what it
    // costs -- the rim snap is clamped so no surviving quad can turn itself
    // inside out, and the emissive plate carries a skirt wider than a cell so
    // there is always something behind an overshoot.
    const nQuad = RINGS - 2;
    const qcut = new Array(nQuad * radial).fill(null);
    const qk = (j, i) => (j - 1) * radial + ((i % radial) + radial) % radial;
    for (let j = 1; j <= nQuad; j++) {
      const s0 = -Math.cos((Math.PI * j) / RINGS);
      const s1 = -Math.cos((Math.PI * (j + 1)) / RINGS);
      const sm = (s0 + s1) * 0.5;
      for (let i = 0; i < radial; i++) {
        const am = ((i + 0.5) / radial) * Math.PI * 2;
        const f = faceOf(am, sm);
        qcut[qk(j, i)] = cutAt(f[0], f[1]);
      }
    }
    // A vertex is on the rim when it touches both a dropped quad and a kept one.
    const quadOf = (j, i) => (j < 1 || j > nQuad ? null : qcut[qk(j, i)]);
    for (let j = 1; j < RINGS; j++) {
      for (let i = 0; i < radial; i++) {
        const around = [quadOf(j - 1, i - 1), quadOf(j - 1, i), quadOf(j, i - 1), quadOf(j, i)];
        let cut = null;
        let open = false;
        for (const q of around) {
          if (q) cut = q; else open = true;
        }
        if (!cut || !open) continue;
        const k = vk(j, i);
        const f = faceOf(va[k], vs[k]);
        const hit = snapTo(cut, f[0], f[1]);
        // Clamp the pull to under a cell in each direction. A rim vertex is
        // shared with the quads that survive, and one dragged clean across a
        // neighbour turns it inside out: it back-face culls and leaves a cell of
        // background showing through the pumpkin, which is exactly the speck
        // that appeared at the outer corner of each eye.
        const cellX = ((Math.PI * 2) / radial) * bodyR * profileR(vs[k]) / FACE_SX;
        const cellY = (bodyH * (Math.PI / RINGS) * Math.sin((Math.PI * j) / RINGS)) / FACE_SY;
        const hx = f[0] + Math.max(-0.55 * cellX, Math.min(0.55 * cellX, hit.X - f[0]));
        const hy = f[1] + Math.max(-0.55 * cellY, Math.min(0.55 * cellY, hit.Y - f[1]));
        hit.X = hx;
        hit.Y = hy;
        const sNew = sOfY(hit.Y * FACE_SY);
        const aNew = (hit.X * FACE_SX) / Math.max(0.05, bodyR * profileR(sNew));
        va[k] = aNew < 0 ? aNew + Math.PI * 2 : aNew;
        vs[k] = sNew;
        rimNX[k] = hit.nx;
        rimNY[k] = hit.ny;
        isRim[k] = 1;
      }
    }

    // Bottom pole (index 0).
    surface(0, -1, p);
    surfaceNormal(0, -1, n);
    shellVerts.push(p.x, p.y, p.z);
    shellNors.push(n.x, n.y, n.z);
    const c0 = colorAt(0, -1);
    shellColors.push(c0.r, c0.g, c0.b);

    for (let j = 1; j < RINGS; j++) {
      for (let i = 0; i < radial; i++) {
        const k = vk(j, i);
        surface(va[k], vs[k], p);
        // Analytic normals rather than computeVertexNormals: with quads missing
        // around every opening, averaged face normals would dish the skin at the
        // rim, and the wall needs its own normals anyway so the lip stays a
        // crisp edge instead of smearing into the skin.
        surfaceNormal(va[k], vs[k], n);
        shellVerts.push(p.x, p.y, p.z);
        shellNors.push(n.x, n.y, n.z);
        const cc = colorAt(va[k], vs[k]);
        shellColors.push(cc.r, cc.g, cc.b);
      }
    }

    surface(0, 1, p);
    surfaceNormal(0, 1, n);
    shellVerts.push(p.x, p.y, p.z);
    shellNors.push(n.x, n.y, n.z);
    const c1 = colorAt(0, 1);
    shellColors.push(c1.r, c1.g, c1.b);
    const topIdx = shellVerts.length / 3 - 1;

    const ring = (j, i) => 1 + vk(j, i);
    for (let i = 0; i < radial; i++) shellIdx.push(0, ring(1, i + 1), ring(1, i));
    for (let j = 1; j <= nQuad; j++) {
      for (let i = 0; i < radial; i++) {
        if (qcut[qk(j, i)]) continue;
        const a0 = ring(j, i), a1 = ring(j, i + 1);
        const b0 = ring(j + 1, i), b1 = ring(j + 1, i + 1);
        shellIdx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    for (let i = 0; i < radial; i++) shellIdx.push(ring(RINGS - 1, i), ring(RINGS - 1, i + 1), topIdx);

    // --- The cut walls -------------------------------------------------------
    // One ribbon quad per grid edge that has a dropped quad on one side and a
    // kept one on the other. The rim vertices are already snapped onto the
    // outline, so the ribbon follows the true curve; extruding each of them back
    // along its own surface normal by SHELL_T lands exactly where the emissive
    // plate's boundary is, so wall and plate meet with no seam.
    const wallLap = new THREE.Color().copy(skin);  // the lapped ring must not read at all
    const wallSkin = new THREE.Color().copy(skin).lerp(shade, 0.30);
    const wallDeep = new THREE.Color().copy(skin).lerp(shade, 0.85);
    const P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
    const N0 = new THREE.Vector3(), N1 = new THREE.Vector3();
    const W0 = new THREE.Vector3(), W1 = new THREE.Vector3();
    const e = new THREE.Vector3(), d = new THREE.Vector3(), g3 = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    // The 3D direction that a face-space step of (nx, ny) points in, flattened
    // into the surface's tangent plane. This is the wall's normal: it comes off
    // the outline rather than off the quad, so neighbouring wall quads sharing a
    // rim vertex agree and the ribbon shades smoothly round a curve.
    const wallNormal = (k, N, out) => {
      const f = faceOf(va[k], vs[k]);
      const eps = 2e-3;
      facePoint(f[0] + rimNX[k] * eps, f[1] + rimNY[k] * eps, 0, out);
      facePoint(f[0], f[1], 0, tmp);
      out.sub(tmp);
      out.addScaledVector(N, -out.dot(N));
      const len = out.length();
      return len > 1e-9 ? out.divideScalar(len) : out.copy(N);
    };

    const pushWall = (kA, kB, cut) => {
      surface(va[kA], vs[kA], P0);
      surface(va[kB], vs[kB], P1);
      surfaceNormal(va[kA], vs[kA], N0);
      surfaceNormal(va[kB], vs[kB], N1);
      wallNormal(kA, N0, W0);
      wallNormal(kB, N1, W1);
      e.copy(P1).sub(P0);
      d.copy(N0).multiplyScalar(-SHELL_T);
      g3.crossVectors(e, d);
      const flip = g3.dot(W0) < 0;
      const first = flip ? P1 : P0;
      const second = flip ? P0 : P1;
      const nFirst = flip ? W1 : W0;
      const nSecond = flip ? W0 : W1;
      const iFirst = flip ? N1 : N0;
      const iSecond = flip ? N0 : N1;
      const base = wallVerts.length / 3;
      // Three rings, not two. The outer one laps back over the skin carrying the
      // SKIN's normal, so it shades as skin and simply is not visible; that is
      // the ring that shuts the crack. The middle one sits on the hole edge and
      // carries the wall's normal, and the jump between the two is the lip. Give
      // the lapped ring the wall's normal instead and it lights side-on against
      // the skin, drawing a bright wire round every opening.
      const push = (pt, nr, nm, ring) => {
        if (ring === 0) tmp.copy(pt).addScaledVector(nr, -WALL_LIP).addScaledVector(nm, WALL_PROUD);
        else if (ring === 1) tmp.copy(pt);
        else tmp.copy(pt).addScaledVector(nr, WALL_TAPER).addScaledVector(nm, -SHELL_T);
        wallVerts.push(tmp.x, tmp.y, tmp.z);
        const nn = ring === 0 ? nm : nr;
        wallNors.push(nn.x, nn.y, nn.z);
        const col = ring === 0 ? wallLap : ring === 1 ? wallSkin : wallDeep;
        wallColors.push(col.r, col.g, col.b);
      };
      for (let ring = 0; ring < 3; ring++) {
        push(first, nFirst, iFirst, ring);
        push(second, nSecond, iSecond, ring);
      }
      for (let ring = 0; ring < 2; ring++) {
        const b = base + ring * 2;
        wallIdx.push(b, b + 1, b + 3, b, b + 3, b + 2);
      }
      return cut;
    };

    for (let j = 1; j <= nQuad; j++) {
      for (let i = 0; i < radial; i++) {
        const here = qcut[qk(j, i)];
        // Vertical grid edge shared with the quad to the left.
        const left = quadOf(j, i - 1);
        if (!!here !== !!left) pushWall(vk(j, i), vk(j + 1, i), here || left);
        // Horizontal grid edge shared with the quad below.
        const below = quadOf(j - 1, i);
        if (!!here !== !!below) pushWall(vk(j, i), vk(j, i + 1), here || below);
      }
    }
  })();

  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(shellVerts, 3));
  shellGeo.setAttribute('normal', new THREE.Float32BufferAttribute(shellNors, 3));
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(shellColors, 3));
  shellGeo.setIndex(shellIdx);
  shellGeo.computeBoundingSphere();

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wallNors, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallColors, 3));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeBoundingSphere();

  // Vertex colours carry the whole hue, so the material's own colour is white.
  const shellMat = toyMaterial('#ffffff', { vertexColors: true, roughness: 0.78 });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.castShadow = true;
  shell.receiveShadow = true;

  // The wall is its own material so it can carry the flame's wash without the
  // skin picking it up, and its own geometry so its normals never average into
  // the skin's at the lip.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    emissive: new THREE.Color(PALETTE.glow),
    emissiveIntensity: (WASH.min + WASH.max) / 2,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.castShadow = false;   // it faces into a hole; a caster here is only acne
  wall.receiveShadow = true;

  // The glowing plate, plus a skirt of the same emissive running a little way
  // out from the outline underneath the skin. The skirt is never meant to be
  // seen: it is there so that where the grid's hole overshoots the outline by a
  // fraction of a cell there is still something behind it. Sunk a whole shell
  // thickness and only a cell and a half wide, the skin covers it from every
  // angle the prop is ever seen from.
  const faceGeo = (() => {
    // A hair below the bottom of the wall rather than exactly level with it.
    // Level, the plate and the wall's inner ring are coplanar and their shared
    // edge speckles.
    const PLATE = SHELL_T + 0.0012;
    const g = patchGeometry(FACE_SHAPES, -PLATE);
    const pos = Array.from(g.getAttribute('position').array);
    const idx = Array.from(g.getIndex().array);
    const p = new THREE.Vector3();
    const SKIRT = 0.030;
    const COLLAR_TOP = 0.011;   // deep enough that the collar never grazes the skin
    const put = (X, Y, lift) => {
      facePoint(X, Y, lift === undefined ? -PLATE : lift, p);
      pos.push(p.x, p.y, p.z);
      return pos.length / 3 - 1;
    };
    for (const cut of CUTS) {
      const pts = cut.pts;
      const outs = pts.map((f, i) => {
        const h = pts[(i + 1) % pts.length];
        const ex = h[0] - f[0], ey = h[1] - f[1];
        const inv = 1 / (Math.hypot(ex, ey) || 1);
        // Outward is the reverse of the counter-clockwise inward normal.
        return [ey * inv, -ex * inv];
      });
      for (let i = 0; i < pts.length; i++) {
        const f = pts[i], h = pts[(i + 1) % pts.length];
        const o = outs[i];
        const b0 = put(f[0], f[1]);
        const b1 = put(h[0], h[1]);
        const b2 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const b3 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT);
        idx.push(b0, b1, b2, b0, b2, b3);
        // Fan across the corner. Two neighbouring strips point their offsets in
        // different directions, and at a convex corner that leaves a wedge of
        // nothing behind the sharpest part of the outline. It is exactly where
        // the last of the see-through specks were: at the outer corner of each
        // eye, which is the sharpest turn on the whole face.
        const q = outs[(i + 1) % pts.length];
        const c0 = put(h[0], h[1]);
        const c1 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const c2 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT);
        idx.push(c0, c1, c2);
        // A collar standing up from the skirt's outer edge to just under the
        // skin, so the plug behind each cut is a closed box rather than a floor.
        // Without it a sight line almost parallel to the skin could still slip
        // between a stray grid cell and the wall and come out the far side, and
        // it did: one pixel of daylight at the sharpest corner of the far eye,
        // only ever at three quarters.
        const d0 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT, -COLLAR_TOP);
        const d1 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT, -COLLAR_TOP);
        const d2 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        const d3 = put(f[0] + o[0] * SKIRT, f[1] + o[1] * SKIRT);
        idx.push(d0, d1, d2, d0, d2, d3);
        // and a post across the corner, for the same reason the floor needed a
        // fan there: two neighbouring collar panels lean apart at a convex turn.
        const e0 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT, -COLLAR_TOP);
        const e1 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT, -COLLAR_TOP);
        const e2 = put(h[0] + q[0] * SKIRT, h[1] + q[1] * SKIRT);
        const e3 = put(h[0] + o[0] * SKIRT, h[1] + o[1] * SKIRT);
        idx.push(e0, e1, e2, e0, e2, e3);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx);
    out.computeVertexNormals();
    g.dispose();
    return out;
  })();

  // Emissive, so it ignores the scene lights entirely and reads as light on its
  // way out rather than as an orange sticker. Its intensity is driven by the
  // same flicker value as the lamp, which is what ties the two together.
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x1a0a00,
    emissive: new THREE.Color(PALETTE.glow),
    emissiveIntensity: (GLOW.min + GLOW.max) / 2,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(faceGeo, faceMat);
  // No shadows: it is coplanar with the shell, and a caster there only produces
  // acne. It is light, not matter.
  face.castShadow = false;
  face.receiveShadow = false;


  // --- Stem ----------------------------------------------------------------
  // A swept tube with its own radius profile rather than a CylinderGeometry:
  // it has to bend, taper, flare where it meets the shell and round off at the
  // tip, and none of that is a primitive.
  const stemTop = profileY(1) + yBase;
  const lean = new THREE.Vector2(Math.sin(aStem + FACE_YAW), Math.cos(aStem + FACE_YAW));
  // The control points lean progressively rather than all at once, so the stem
  // bends along its length instead of kinking at one joint.
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, stemTop - 0.035, 0),
    new THREE.Vector3(lean.x * 0.006, stemTop + 0.045, lean.y * 0.006),
    new THREE.Vector3(lean.x * 0.042, stemTop + 0.105, lean.y * 0.042),
    new THREE.Vector3(lean.x * 0.105, stemTop + 0.150, lean.y * 0.105),
    new THREE.Vector3(lean.x * 0.170, stemTop + 0.172, lean.y * 0.170),
  ]);
  const stemRadius = (t) => {
    const taper = 0.052 * (1 - 0.42 * Math.pow(t, 1.2));
    const flare = 1 + 1.05 * Math.exp(-t / 0.11);     // spreads where it meets the dish
    // A hemispherical roll-off rather than a flat disc: the tip of a toy stem
    // is a soft nub, and a truncated cone reads as a cut-off pencil.
    const cap = t > 0.82 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.82) / 0.18, 2))) : 1;
    return taper * flare * cap;
  };
  const stemGeo = sweep(stemCurve, stemRadius, SEGMENTS.curve * 2, SEGMENTS.radial);
  const stemMat = toyMaterial(PALETTE.stem, { roughness: 0.86 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.castShadow = true;
  stem.receiveShadow = true;

  // --- The lamp inside -----------------------------------------------------
  // A point light was wrong here. Three does not occlude lights without a
  // shadow map, so an omnidirectional lamp inside an opaque shell lit the
  // ground evenly all the way round -- including behind the pumpkin, where no
  // light can actually get out. Turning shadows on does not fix it either: the
  // shell has no real holes, so it would block everything.
  //
  // What the light physically does is leave through the cuts, so it is a cone
  // aimed out of the face and tilted down at the floor.
  //
  // Where the cone starts turned out to matter more than how wide it is. Parked
  // at the middle of the shell it was a quarter of a unit above the floor, and
  // the ring of floor the pumpkin actually stands on sat four degrees off the
  // cone's axis at a range of 0.39 -- which, falling off as d^1.5, lit that ring
  // to near white. That was the reported bug: a bright collar between the
  // pumpkin and its own shadow, with the contact patch and the key light's cast
  // shadow both drowned underneath it. Nothing about the shadow maps was wrong.
  //
  // So the lamp is parked where the light really leaves, just inside the carved
  // face at mouth height, and the cone is narrow enough that the floor within
  // the base is behind it rather than under it. The pool now starts a little
  // clear of the pumpkin and washes forward, which is what was wanted anyway.
  const LIGHT_DISTANCE = 3.2;
  const light = new THREE.SpotLight(
    new THREE.Color(PALETTE.glow),
    (LAMP.min + LAMP.max) / 2,
    LIGHT_DISTANCE * scale,
    0.52,  // half-cone: the lower edge clears the base ring by a few centimetres
    0.92,  // penumbra: nearly all edge, so the pool has no rim to read as a stain
    // Gentler than inverse-square. Three openings scattering light is a soft
    // source, and a steep decay is exactly what made the near field explode.
    0.9,
  );
  const faceDir = new THREE.Vector3(Math.sin(FACE_YAW), 0, Math.cos(FACE_YAW));
  light.position.copy(faceDir).multiplyScalar(bodyR * 0.50);
  light.position.y = yBase * 1.25;
  light.castShadow = false;

  // The target is parented to the group, so the cone turns with the pumpkin
  // instead of staying pinned to a world direction.
  const lightTarget = new THREE.Object3D();
  // Local units: the group is scaled below, so these must not be pre-scaled.
  // Aimed low and long rather than steeply down: with the cone this narrow, a
  // steep aim put the whole pool in one puddle a foot from the pumpkin and it
  // read as a spotlight. Flatter, it runs out to a couple of units and fades.
  lightTarget.position.copy(faceDir).multiplyScalar(1.9);
  lightTarget.position.y = -0.42;
  light.target = lightTarget;

  const group = new THREE.Group();
  // Tighter and darker than the old 0.46/0.40. With the spill pulled off it the
  // contact is the only thing holding the pumpkin down, and a pumpkin meets the
  // floor on a small ring rather than over its whole width.
  const contact = contactShadow({ radius: 0.42, opacity: 0.52, softness: 0.62 });
  group.add(shell, wall, face, stem, light, lightTarget, contact);
  group.scale.setScalar(scale);

  const lightHome = light.position.clone();

  return {
    group,
    update(time) {
      // A candle mostly burns near full and occasionally ducks. Summed smooth
      // noise on its own only wanders about its middle, which is why the first
      // version read as a dimmer being nudged rather than a flame. So the
      // steady part sits high, and a separate sparse guttering term pulls it
      // down.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2; // -1..1

      const steady = 0.84 + 0.10 * swing(1.3, 0) + 0.07 * swing(6.1, 13.2) + 0.04 * swing(15.7, 41.7);

      // Only the top of this slow channel counts, so dips are occasional and
      // brief rather than rhythmic; squaring the ramp keeps their onset soft.
      const g = noise(t * 0.62 + 77.3);
      const gutter = g > 0.70 ? (g - 0.70) / 0.30 : 0;
      const dip = gutter * gutter * 0.52 * (0.55 + 0.45 * noise(t * 9.3 + 5.1));

      const level = Math.min(1, Math.max(0, steady - dip)); // 0 = guttering, 1 = flaring

      const at = (range) => range.min + (range.max - range.min) * level;
      light.intensity = at(LAMP);
      // Lamp, carving and bloom all come off the one value: that is the whole
      // trick. The carving's range is shallower because a real cut-out stays
      // near saturation even as the spill on the ground drops away.
      faceMat.emissiveIntensity = at(GLOW);
      wallMat.emissiveIntensity = at(WASH);
      // A guttering flame reddens as it drops, so the colour rides the same
      // value rather than sitting at a fixed warm white.
      light.color.copy(EMBER).lerp(FLAME, level);

      // A candle is not nailed down; a few millimetres of sway makes the pool of
      // light on the ground breathe.
      light.position.set(
        lightHome.x + (noise(t * 0.9 + 5.5) - 0.5) * 0.03,
        lightHome.y + (noise(t * 1.3 + 8.1) - 0.5) * 0.02,
        lightHome.z + (noise(t * 0.8 + 2.7) - 0.5) * 0.03,
      );
    },
    dispose() {
      for (const g of [shellGeo, wallGeo, faceGeo, stemGeo]) g.dispose();
      for (const m of [shellMat, wallMat, faceMat, stemMat]) m.dispose();
      contact.userData.dispose();
      group.clear();
    },
  };
}

// Sweeps a circular cross-section of varying radius along a curve. Frenet
// frames keep the tube from twisting; radius(t) does the taper, the flare and
// the rounded tip.
//
// Normals are analytic rather than from computeVertexNormals. Where the radius
// rolls off to nothing at the tip the triangles go degenerate, and averaged
// face normals there come out as a dark pinched spot; the closed form tilts
// smoothly to point straight along the axis instead.
function sweep(curve, radius, along, around) {
  const frames = curve.computeFrenetFrames(along, false);
  const verts = [];
  const nors = [];
  const idx = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  const h = 0.5 / along;
  const lo = (t) => Math.max(0, t - h);
  const hi = (t) => Math.min(1, t + h);
  const speedAt = (t) => curve.getPoint(lo(t)).distanceTo(curve.getPoint(hi(t))) / (hi(t) - lo(t));

  for (let j = 0; j <= along; j++) {
    const t = j / along;
    const c = curve.getPoint(t);
    const T = curve.getTangent(t);
    const N = frames.normals[j];
    const B = frames.binormals[j];
    const r = radius(t);
    // Slope of the radius profile, in units of the curve's own arc length.
    const slope = (radius(hi(t)) - radius(lo(t))) / ((hi(t) - lo(t)) * speedAt(t));
    for (let i = 0; i < around; i++) {
      const phi = (i / around) * Math.PI * 2;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      p.copy(c).addScaledVector(N, cs * r).addScaledVector(B, sn * r);
      verts.push(p.x, p.y, p.z);
      n.set(0, 0, 0).addScaledVector(N, cs).addScaledVector(B, sn).addScaledVector(T, -slope).normalize();
      nors.push(n.x, n.y, n.z);
    }
  }
  const vi = (j, i) => j * around + (i % around);
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      idx.push(vi(j, i), vi(j, i + 1), vi(j + 1, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i));
    }
  }
  // Close the (hidden) base with a fan. The far end needs no cap: its radius
  // already rolls off to a point.
  const capStart = verts.length / 3;
  const c0 = curve.getPoint(0);
  const t0 = curve.getTangent(0);
  verts.push(c0.x, c0.y, c0.z);
  nors.push(-t0.x, -t0.y, -t0.z);
  for (let i = 0; i < around; i++) idx.push(capStart, vi(0, i + 1), vi(0, i));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nors, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
