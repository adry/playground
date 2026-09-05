import * as THREE from 'three';
import M from '../metrics.js';
import {
  closedRadial, concentrate, grommet, ellipseOutline, ovoid, roundBox, limb, arcTube,
  put, v3, mix, smoothstep, hump, assertOutward, assertInsideRadial,
} from './forms.js';

// The head. A third of the whole figure, so it IS the character.
//
// ==========================================================================
// THE ONE STRUCTURAL DECISION IN THIS FILE
// ==========================================================================
//
// The cranium is a BALL and nothing is carved into it. Every feature -- both
// eye sockets, the nasal aperture, the mouth -- is a separate volume set into
// that ball by `grommet`, and every one of them is defined against the ball's
// OWN radius function:
//
//     dish  =  dir * (headR(dir) - sink)     sink >= 0
//     rim   =  dir * (headR(dir) + jut)
//
// The third pass did the opposite. It was one parametric shell with the
// features pressed into its own grid and the dark painted on by keeping
// different quads, and POSTMORTEM section 2 is what that cost: five
// constructions for one eye socket, a surface that folded over itself, a
// boundary that staircased, and normals that disagreed across every zone edge.
//
// Four things stop existing when the feature is a separate radial volume:
//
//  1. IT CANNOT ESCAPE THE HEAD. Failure 4 in the postmortem was a dark bowl
//     behind a cut, and it worked square-on and came through as a ring of
//     spikes the moment the walk turned the head twenty degrees -- which this
//     animation does every cycle, with 19 degrees of roll and 20 of lag. A
//     dish at `headR(dir) - sink` with sink >= 0 is at or inside the ball
//     along its own ray FOR EVERY DIRECTION, so no rotation can expose it.
//     That is a property of the geometry, not of a camera angle, and
//     `assertInsideRadial` checks it at build time rather than trusting it.
//
//  2. IT CANNOT DRIFT AGAINST THE HEAD. Failures 2 and 3 reached the surface
//     through an inverse of the base ellipsoid while the shell had a brow, a
//     cheek, a crown swell and three octaves of lumps on top of it, so the
//     two disagreed by a fraction of a millimetre and the dark slivered
//     through the skin. Here nothing is inverted: the direction is built
//     first and `headR` is evaluated on it, so there is no second opinion.
//
//  3. THERE IS NO ZONE PAINTING, so none of POSTMORTEM 2.2 applies. Every
//     material boundary on this head is a real geometric edge between two
//     separate volumes. There is no predicate deciding which side of an
//     outline a quad is on, so it cannot flip from cell to cell; there is no
//     shared surface with two colours on it, so two zones cannot compute
//     different normals along a seam.
//
//  4. THE VISIBLE OUTLINE OF EVERY FEATURE IS ANALYTIC. The ball's cut is
//     ragged at grid resolution, but the cut is not what you see: the rim
//     band is cut LARGER than the hole at both ends and covers it, exactly
//     as the chest cavity's lip ribbon covers its window. What you see is the
//     rim's own edge, which is a true ellipse sampled at 56 points.
//
// The cost is honest and worth stating: a socket is now four surfaces (ball,
// rim, dish wall, dish floor) instead of one, and they must MEET. They do,
// because the rim's inner ring and the dish's outer ring are the same
// expression evaluated at the same phi samples -- see `grommet` in forms.js.
//
// Head-local space: the origin is the ATLAS, the head's pivot, so this whole
// group parents to the neck with no offset to remember.

const H = M.head;

// The ball's grid, and the worst cell size on the face, which every feature's
// cut is checked against.
const BALL_U = 92, BALL_V = 62;
const U_K = 0.58, V_K = 0.52;
const CELL = Math.max(
  (2 * Math.PI / BALL_U) * (1 - U_K),
  (Math.PI / BALL_V) * (1 - V_K));
const RX = H.width / 2;
const RZ = H.depth / 2;
const CHIN = M.y.chin - M.y.atlas;         // head-local
const CROWN = M.y.crown - M.y.atlas;

// --- the ball -----------------------------------------------------------------
//
// A smooth positive radius as a function of DIRECTION, which is what makes the
// volume star-shaped about its centre and everything above possible.
//
// Every modifier is a multiplicative hump that vanishes at the pole it could
// otherwise move, so the crown and the chin land on `M.y.crown` and `M.y.chin`
// to the millimetre and the figure stays 3.03 heads tall. `fitBall` below
// solves the two remaining unknowns and asserts the result.

const crownFactor = (dy) => 1 + H.crownFull * hump(0.10, 1.06, dy);
const jawFactor = (dy) => 1 - (1 - H.jawTaper) * hump(-0.08, -1.10, dy);
const occiputFactor = (dz) => 1 - (1 - H.occiputFlat) * smoothstep(0.10, 0.85, -dz);
// A gentle forward swell over the lower face, so the mouth is cut INTO
// something. Zero at both poles, so it moves no landmark.
const muzzleFactor = (d, r0) => 1 + (H.muzzle / r0) * smoothstep(0.30, 0.95, d.z) * smoothstep(0.10, -0.50, d.y);

function fitBall() {
  const shape = (d, RY) => {
    const base = 1 / Math.hypot(d.x / RX, d.y / RY, d.z / RZ);
    return base * crownFactor(d.y) * jawFactor(d.y) * occiputFactor(d.z) * muzzleFactor(d, base);
  };
  // At the poles the modifiers are pure constants, so RY and the centre come
  // out of two linear equations rather than a search.
  const cTop = crownFactor(1) * jawFactor(1);
  const cBot = crownFactor(-1) * jawFactor(-1);
  const RY = (CROWN - CHIN) / (cTop + cBot);
  const cy = CHIN + RY * cBot;
  const R = (d) => shape(d, RY);
  // Asserted, not assumed: POSTMORTEM 2.2 records a fix that was reported and
  // had never landed, and the landmark heights are the one thing on this
  // figure that the animation half is entitled to believe.
  const gotCrown = cy + R(v3(0, 1, 0));
  const gotChin = cy - R(v3(0, -1, 0));
  if (Math.abs(gotCrown - CROWN) > 1e-4 || Math.abs(gotChin - CHIN) > 1e-4) {
    throw new Error(`zombie/head: ball misses its landmarks. crown ${gotCrown} want ${CROWN}, chin ${gotChin} want ${CHIN}.`);
  }
  return { R, RY, cy };
}

export const BALL = fitBall();
const centre = v3(0, BALL.cy, 0);
const headR = BALL.R;
// A point on the ball for a direction, in head-local space.
const onBall = (d, out = 0) => d.clone().multiplyScalar(headR(d) + out).add(centre);
// The direction from the head's centre to a head-local point.
const dirTo = (p) => p.clone().sub(centre).normalize();
// The direction that reaches a given head-local height on the front centre
// line, at a given x. Used to aim the features; it is a pure normalisation, so
// unlike the third pass's `frontUV` it inverts nothing and can drift from
// nothing.
const aim = (x, y, z = 1) => v3(x, y - BALL.cy, z * RZ).normalize();

// --- where the features sit ---------------------------------------------------
//
// Each is an axis from the head's centre plus an angular half-extent. Sizes
// come from `metrics.js` as LENGTHS on the surface and are converted to angles
// here, so the numbers in metrics stay measurable against the reference.

// A LENGTH on the ball's surface, as an angle from the feature's axis.
//
// The surface point at angle theta from the axis stands `R * sin(theta)` off
// it, so the conversion is an arcsine and NOT an arctangent. Written as an
// arctangent first, and every feature on the face came out 13 per cent small
// -- the mouth worst of all, because it is the widest.
//
// It also divides by `rhoIn`, so the number in metrics.js means THE VISIBLE
// OPENING. A grommet's outline is where its rim's outer edge goes; what a
// person measuring the reference is measuring is where the dark stops, which
// is at rho = rhoIn. Sizing to the outline instead made every feature a
// further tenth too small on top of the arctangent.
const angFor = (halfLen, atDir, rhoIn) => Math.asin(Math.min(0.985, halfLen / headR(atDir))) / rhoIn;

const socketAxis = (side) => aim(side * M.socket.separation / 2, M.y.brow - M.y.atlas);
const noseAxis = aim(0, M.y.nose - M.y.atlas);
const grinAxis = aim(0, M.y.grin - M.y.atlas);

// --- build --------------------------------------------------------------------

export function buildHead({ materials }) {
  const group = new THREE.Group();
  const geos = [];
  const track = (g) => { geos.push(g); return g; };

  // Every feature's cut predicate, collected before the ball is built, because
  // the ball has to omit their quads.
  const feats = [];

  // --- the eye sockets --------------------------------------------------------
  //
  // Round, deep and EMPTY, 29 per cent of head width and 22 per cent of head
  // height. POSTMORTEM 2.4: they were sized at 28 per cent of HEIGHT on the
  // legibility argument, passed the game-scale test, and at arm's length the
  // pair plus their rims covered the whole upper face. The rule that fixed it
  // is worth repeating here because every feature on this face is tempted by
  // it: THE AMOUNT OF SMOOTH GREEN FACE LEFT IS WHAT CARRIES THE CHARM. A
  // broad clear forehead, a clear bridge between the sockets and clear cheek
  // below all have to survive.
  const SOCK_IN = 0.90;
  const socket = (side) => {
    const A = socketAxis(side);
    const ax = angFor(M.socket.width / 2, A, SOCK_IN);
    const ay = angFor(M.socket.height / 2, A, SOCK_IN);
    return grommet({
      R: headR, axis: A, up: v3(0, 1, 0),
      outline: ellipseOutline(ax, ay),
      depth: M.socket.depth,
      seat: M.head.browJut * 0.42,
      // THE BROW RIDGE, and it is part of the rim rather than a shelf carved
      // into the cranium. The crest is tallest directly above the socket and
      // falls away below it, so the key light -- which comes from above --
      // throws the whole orbit into shadow whichever way the head is turned.
      // Built as a carved shelf in the third pass it pressed the top of each
      // orbit down and turned two round sockets into two almonds; built as the
      // rim's own crest it can only push the eye's edge OUT.
      // The crest is concentrated HARD at the top of the orbit, and that is a
      // silhouette fix, not a shading one. At the game's three-quarter camera
      // the far socket sits within a couple of degrees of the head's own
      // outline, so a rim that stands proud all the way round pushes a horn
      // out of the side of the skull -- 16 per cent of the head's radius, and
      // unmistakable in the first game-camera render. Tapered to a fifth at
      // the sides it is half a pixel there and still a full brow above.
      jutMax: (phi) => M.head.browJut * mix(0.20, 1.0, smoothstep(-0.05, 0.92, Math.sin(phi))),
      rhoIn: SOCK_IN, rhoOut: 1.30,
      phiSteps: 40, dishSteps: 7, rimSteps: 5,
      floorFlat: 0.70,
    });
  };
  const socketL = socket(+1), socketR = socket(-1);
  feats.push(socketL.cut(1.11, CELL), socketR.cut(1.11, CELL));

  // THE NOSE IS GONE, and that is the largest single deletion in this pass.
  //
  // It cost the most and bought the least. A nasal aperture is six degrees
  // across on this head, which is smaller than the ball's own grid cells, so
  // it forced the face grid up from 84x56 to 116x78 -- 8,600 triangles, a
  // fifth of the whole figure -- purely so a rim could cover its ragged cut.
  // At 105 px it is two pixels of grey between the sockets and the grin.
  //
  // The ghost is a white sheet with two black eyes and it is the best-loved
  // thing in this project. Two big sockets and a wide grin is that level of
  // simplicity, and the head reads harder without a third small dark mark
  // competing with them. The grid came back down with it.

  // --- the mouth --------------------------------------------------------------
  //
  // A lipless slot: a wide sunken trough with the teeth standing in it, so the
  // teeth read as bright blocks on dark. It sits at `M.y.grin`, which is 21
  // per cent of the head's height ABOVE the chin, and that placement is fault
  // three of the three that killed the third pass: the mouth was at the very
  // bottom of the head with the tooth row hanging below the jawline like a
  // fringe. There is a clear band of green below this one, and because the
  // teeth stand INSIDE a trough whose outline is analytic and well inside the
  // ball, they cannot break the silhouette at any angle.
  //
  // The rim's crest is nearly zero: a raised ring here would read as lips.
  // What it is for is covering the ball's ragged cut, and 1.6 mm does that.
  const GRIN_IN = 0.90;
  const mouth = (() => {
    const A = grinAxis;
    const ax = angFor(M.grin.width / 2, A, GRIN_IN);
    const ay = angFor(M.grin.height / 2, A, GRIN_IN);
    // A GRIN, which is an ellipse whose whole SLOT rises at the ends, not an
    // ellipse that gets taller at the ends.
    //
    // Written the second way first -- scaling the vertical half-extent by
    // (1 + curve * cos^2) -- and it does the opposite of what a grin does: the
    // mouth came out tallest at the corners and pinched to a point in the
    // middle, a lens rather than a smile, and the pinch let the nose's rim
    // hang down into it.
    //
    // So the boundary is the implicit curve
    //     (U/ax)^2 + ((V - k U^2)/ay)^2 = 1
    // with k chosen so the centre line has risen by `curve` of the mouth's own
    // half-height by the time it reaches the corner. `grommet` wants a radial
    // outline, so this is solved for r at each phi. Forty bisection steps on
    // 64 samples is nothing, and the result is a true curve rather than an
    // approximation that has to be tuned.
    const k = (M.grin.curve * ay) / (ax * ax);
    const outline = (phi) => {
      const c = Math.cos(phi), sp = Math.sin(phi);
      const F = (r) => {
        const U = r * c, V = r * sp;
        return Math.pow(U / ax, 2) + Math.pow((V - k * U * U) / ay, 2) - 1;
      };
      let lo = 1e-5, hi = ax * 3;
      if (F(hi) < 0) return hi;
      for (let i = 0; i < 40; i++) {
        const m = 0.5 * (lo + hi);
        if (F(m) < 0) lo = m; else hi = m;
      }
      return 0.5 * (lo + hi);
    };
    return grommet({
      R: headR, axis: A, up: v3(0, 1, 0), outline,
      depth: M.grin.depth,
      seat: M.grin.depth * 0.16,
      jutMax: () => M.head.browJut * 0.10,
      rhoIn: GRIN_IN, rhoOut: 1.18,
      phiSteps: 48, dishSteps: 6, rimSteps: 5,
      floorFlat: 0.52,
    });
  })();
  feats.push(mouth.cut(1.04, CELL));

  // --- the ball itself --------------------------------------------------------
  //
  // 84 by 56 with the samples CONCENTRATED ON THE FACE: 2.6 times the density
  // in u about the front centre line and 2.2 times in v about the brow-to-chin
  // band, which puts a 1.7 by 1.5 degree cell where the features are cut and a
  // 4.4 by 3.3 degree cell round the back where nothing is.
  //
  // The grid's ONLY job is to be a smooth ball. It carries no colour
  // boundaries -- every material change on this head is an edge between
  // separate volumes -- so the density is not buying a crisp outline, which
  // the rims provide analytically. It is buying one thing: cells small enough
  // that a rim can cover the ragged hole cut out of them.
  //
  // That mattered most for the NASAL APERTURE, which is six degrees across.
  // On the uniform grid its hole was cut out of cells nearly as large as the
  // feature, the rim missed the ragged edge, and the background showed through
  // the middle of the face in square notches. `cut` now takes the cell size
  // and throws rather than letting that ship.
  const skip = (dir) => { for (const f of feats) if (f(dir)) return true; return false; };
  const ball = track(closedRadial({
    uSteps: BALL_U, vSteps: BALL_V, R: headR, skip,
    uAt: concentrate(U_K, 0.25), vAt: concentrate(V_K, 0.56),
  }));
  ball.translate(0, BALL.cy, 0);
  assertOutward(ball, centre, 'head ball');
  put(group, ball, materials.skin, { name: 'cranium' });

  // The features. Each dish and rim is built about the head's ORIGIN-centred
  // radius, so it is translated onto the head's centre exactly as the ball is.
  const setFeature = (g, dishMat, name, { rimMat = materials.skin } = {}) => {
    g.dish.translate(0, BALL.cy, 0);
    g.rim.translate(0, BALL.cy, 0);
    track(g.dish); track(g.rim);
    // THE GUARANTEE, CHECKED. A dish that has stopped being radial is exactly
    // the edit that broke the last build silently, so it throws here instead.
    assertInsideRadial(g.dish, centre, headR, `${name} dish`, 1e-6);
    put(group, g.dish, dishMat, { name: `${name}-dish` });
    put(group, g.rim, rimMat, { name: `${name}-rim` });
  };
  setFeature(socketL, materials.socket, 'socketL');
  setFeature(socketR, materials.socket, 'socketR');
  setFeature(mouth, materials.socketDeep, 'mouth');

  // --- ears -------------------------------------------------------------------
  //
  // Small, round, and they earn their place on the SILHOUETTE, not on the
  // face. They are the only thing breaking the outline of a very large smooth
  // ball from three quarters, which is the game's own camera angle. The third
  // pass had them at 3 px and tucked behind the equator, and the head read as
  // a bare ball from every angle.
  //
  // Behind the equator, but not far: on it they catch the same light as the
  // cheek and the dimple in them reads as a third eye; too far back and they
  // stop showing at all.
  const earR = M.ear.radius;
  // How far the lobe's centre is sunk below the skull. It has to be deep
  // enough that the lobe's RIM is inside the ball -- otherwise the ear floats
  // off the head with a gap all round it -- and the threshold is exactly
  // R - sqrt(R^2 - earR^2), so this is that with a margin rather than a guess.
  const EAR_SINK = (() => {
    const probe = v3(1, 0.14, -0.34).normalize();
    const R = headR(probe);
    return (R - Math.sqrt(Math.max(0, R * R - earR * earR))) * 1.7;
  })();
  for (const side of [+1, -1]) {
    const d = v3(side * 0.94, (M.y.ear - M.y.atlas - BALL.cy) / BALL.RY * 0.30, -0.34).normalize();
    const seat = onBall(d, -EAR_SINK);
    // The FLAT axis of the disc goes along `d`, which is the direction out of
    // the side of the head. Built with the long axis along d instead -- which
    // is what an ovoid plus a lookAt does if you forget that lookAt aims local
    // +Z -- each ear comes out as a horn sticking out of the skull, and the
    // three-quarter camera is the view that shows it.
    const lobe = track(ovoid(earR, earR * 0.88, EAR_SINK + M.ear.stand, { uSteps: 14, vSteps: 10 }));
    const m = put(group, lobe, materials.skin, { pos: seat, name: 'ear' });
    m.lookAt(seat.clone().add(d));
  }

  // --- the jaw ----------------------------------------------------------------
  //
  // Identity is CLOSED and POSITIVE rotation.x opens it, exactly as the
  // skeleton publishes and as `model.js` asserts on userData.
  //
  // The jaw carries the LOWER TOOTH ROW AND ITS GUM BAR, and nothing else.
  // POSTMORTEM: the third pass made it a real mandible -- the patch of cranium
  // the mouth carved away, put back on the hinge -- and it was wrong twice
  // over. The head tapers too hard below the cheek for the patch to have a
  // sensible width, and the payoff is nil, because at 34 px of head a dropped
  // chin and a dropped tooth row look identical: what a viewer resolves is the
  // dark band getting taller. So the cranium keeps its chin and the trough is
  // deep enough to swallow the teeth.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, M.y.jawHinge - M.y.atlas, H.jawHingeZ);
  group.add(jaw);

  // --- teeth ------------------------------------------------------------------
  //
  // Five up, four down, with gaps. Ten teeth in a 0.324 grin is 1.8 px each in
  // a shipped frame and dithers into a grey band; five is five white blocks
  // with dark between them, which is what a grin is at this size.
  //
  // Each tooth is placed by DIRECTION in the mouth's own grommet frame and
  // seated on the trough floor at `headR(dir) - depth`. The third pass solved
  // for a target x and put a block there, and the outer teeth ended up
  // floating outside the jaw because the head tapers hard down there and the
  // surface no longer reaches that x. Placing by direction cannot make that
  // mistake: there is no x to solve for.
  const toothGeo = (w, h, t) => roundBox(w / 2, h / 2, t / 2, { n: 3.6, uSteps: 8, vSteps: 6 });
  const rowFor = (count, gapAt, up) => {
    const out = [];
    const span = 0.86;                      // fraction of the outline used
    for (let k = 0; k < count; k++) {
      if (k === gapAt) continue;
      const f = count === 1 ? 0.5 : k / (count - 1);
      const phiX = (f - 0.5) * 2 * span;    // -span .. +span across the mouth
      // A 0..1 hash. The first version took `% 1` of a signed product, which
      // is negative half the time, so half the teeth were driven below the
      // bottom of their own size range instead of across it.
      const h = Math.abs(Math.sin(k * 37.7 + (up ? 0 : 11)) * 43758.5453);
      out.push({ f, phiX, k, jitter: h - Math.floor(h) });
    }
    return out;
  };
  const placeTooth = (parent, phiX, up, hFrac, jitter, fang = false) => {
    // The direction: start on the mouth's axis, swing across by phiX of the
    // outline's horizontal reach and up or down to the trough's own lip.
    const ax = mouth.axis, U = mouth.U, V = mouth.V;
    const across = phiX * mouth.dirAt(1, 0).angleTo(ax);
    const vert = (up ? 1 : -1) * 0.42 * mouth.dirAt(1, Math.PI / 2).angleTo(ax);
    const d = new THREE.Vector3()
      .addScaledVector(ax, 1)
      .addScaledVector(U, Math.tan(across))
      .addScaledVector(V, Math.tan(vert))
      .normalize();
    const w = M.grin.width / 6.6 * mix(0.74, 1.22, jitter);
    const h = M.grin.height * hFrac * mix(0.74, 1.30, jitter) * (fang ? 1.46 : 1);
    // A tooth is LONG. It stands on the trough floor and comes back out to
    // just short of the opening, so its front face is the part that catches
    // the key light. At 0.42 of the trough's depth -- which is where they were
    // first -- every tooth sat two thirds of the way down a hole and the whole
    // grin read as three grey slivers.
    const t = M.grin.depth * 0.86;
    const g = track(toothGeo(w, h, t));
    const base = d.clone().multiplyScalar(headR(d) - M.grin.depth + t * 0.5).add(centre);
    const m = put(parent, g, materials.tooth, { pos: base, name: 'tooth' });
    m.lookAt(base.clone().add(d));
    // A small lean, alternating, so the row is not a picket fence.
    m.rotateZ((jitter - 0.5) * 0.42);
  };
  const T = M.grin.teeth;
  for (const t of rowFor(T.upper, T.gapUpper, true)) placeTooth(group, t.phiX, true, 0.62, t.jitter, t.k === T.fang);
  // The lower row rides the jaw, so opening it drops the teeth into the
  // trough's depth rather than through the chin.
  const jawFrame = new THREE.Object3D();
  jawFrame.position.set(0, -(M.y.jawHinge - M.y.atlas), -H.jawHingeZ);
  jaw.add(jawFrame);
  for (const t of rowFor(T.lower, T.gapLower, false)) placeTooth(jawFrame, t.phiX, false, 0.54, t.jitter);
  // The gum bar, so the lower teeth stand on something rather than floating.
  {
    const A = grinAxis;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const f = k / 10;
      const across = (f - 0.5) * 2 * 0.84 * mouth.dirAt(1, 0).angleTo(A);
      const vert = -0.56 * mouth.dirAt(1, Math.PI / 2).angleTo(A);
      const d = new THREE.Vector3().addScaledVector(mouth.axis, 1)
        .addScaledVector(mouth.U, Math.tan(across)).addScaledVector(mouth.V, Math.tan(vert)).normalize();
      pts.push(d.clone().multiplyScalar(headR(d) - M.grin.depth * 0.34).add(centre));
    }
    const bar = track(arcTube(pts, M.grin.height * 0.10, M.grin.height * 0.10, { radial: 6 }));
    put(jawFrame, bar, materials.flesh, { name: 'gum' });
  }

  return {
    group,
    joints: { jaw },
    dispose() { for (const g of geos) g.dispose(); },
  };
}

// Exported for the probes that measure the face while it is being tuned.
export const headProbe = { headR, centre, onBall, dirTo, aim, BALL };
