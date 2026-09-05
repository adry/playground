import * as THREE from 'three';
import M from '../metrics.js';
import { gridSurface, ribbon, softBox, ball, limb, tube, put, v, smoothstep } from './skin.js';

// The head. A third of the whole figure, so it is the character: everything
// else on this model is supporting cast.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE. The camera is fixed and
// orthographic, there is no environment map, and the head is 34 px tall in a
// shipped frame. A smooth ball under one key light has exactly one terminator
// across it and no silhouette change as it turns, so it reads as a flat disc.
// Shading is what carries a prop in this scene, and shading needs FORM.
//
// So the ball is not a ball. Five things break it up, and every one of them is
// low-frequency enough to survive being 34 px tall:
//
//   1. a brow shelf standing proud over the sockets, which throws the sockets
//      into shadow from the key light no matter which way the head turns;
//   2. two deep sockets, a quarter of the head's height, with steep walls;
//   3. a flattened occiput, so the three-quarter silhouette is not a circle;
//   4. a jaw that tapers below the cheek, so the lower half of the head is a
//      different width from the upper half;
//   5. a soft ridge from between the brows down to the mouth, which gives the
//      centre of the face a highlight to sit on.
//
// Everything is one continuous surface with the features displaced INTO it,
// rather than parts stuck onto it, because a bump stuck onto a vinyl toy reads
// as a bump stuck onto a vinyl toy.
//
// THE GRID IS NOT UNIFORM. `uAt`/`vAt` push more than twice the sample density
// onto the face than onto the back of the cranium. A uniform grid dense enough
// to cut a crisp socket wall is dense enough to model the occiput four times
// over, and the occiput is a smooth dome that needs none of it.

// Head-local space: the origin is the ATLAS, the head's pivot, so this whole
// group can be parented to the neck and rotated with no offset to remember.
const CROWN = M.y.crown - M.y.atlas;
const CHIN = M.y.chin - M.y.atlas;
const CENTRE_Y = (CROWN + CHIN) / 2;
const RY = (CROWN - CHIN) / 2;
const RX = M.head.width / 2;
const RZ = M.head.depth / 2;

const BROW_Y = M.y.brow - M.y.atlas;
const NOSE_Y = M.y.nose - M.y.atlas;
const GRIN_Y = M.y.grin - M.y.atlas;
const EAR_Y = M.y.ear - M.y.atlas;
const HINGE_Y = M.y.jawHinge - M.y.atlas;

const SOCK_X = M.socket.separation / 2;
const SOCK_HW = M.socket.width / 2;
const SOCK_HH = M.socket.height / 2;
const GRIN_HW = M.grin.width / 2;
const GRIN_HH = M.grin.height / 2;
const NOSE_HW = M.nose.width / 2;
const NOSE_HH = M.nose.height / 2;

// Concentrate grid samples near `at`. The derivative is 1 - k cos(2 pi (t-at)),
// so k = 0.55 puts 2.2x the samples on the face.
const concentrate = (t, at, k) => t - (k / (2 * Math.PI)) * Math.sin(2 * Math.PI * (t - at));

// v is NOT periodic: it runs pole to pole. The raw warp above shifts both ends,
// which pushed v past 1 at the crown and folded the mesh back over the top pole
// as a dark disc. Subtracting the value at t = 0 pins both ends exactly,
// because concentrate(1) - concentrate(0) is identically 1.
const vWarp = (t, at, k) => concentrate(t, at, k) - concentrate(0, at, k);

const U_FRONT = 0.25;       // azimuth u at which the surface faces +Z
// The surface with no feature cut into it: what the cuts and the rims measure
// against, so they all share one coordinate frame.
const BARE = { mouth: false, sockets: false };
// Where the extra v samples land, chosen so that after the pinning above the
// dense band comes out at v = 0.42, between the sockets and the grin.
const V_FACE = 0.445;

// --- the surface -------------------------------------------------------------
//
// One function, called with the features switched on or off. The mandible cap
// is built from the SAME function with the mouth recess turned off, which is
// what guarantees the cap sits flush in the recess it fills: it is literally
// the piece of head that was carved away, put back.

// The direction every feature on this head is displaced along: the outward
// normal of the BASE ellipsoid, before any feature has moved anything. It is
// smooth by construction, which is exactly why the dents use it, and anything
// that has to sit in a dent has to use the same one.
function baseNormal(u, vv) {
  const d = unitDir(u, vv);
  const backK = d.z < 0 ? Math.pow(-d.z, 1.4) : 0;
  const rzHere = RZ * (1 - (1 - M.head.occiputFlat) * backK);
  return new THREE.Vector3(d.x / RX, d.y / RY, d.z / rzHere).normalize();
}

function unitDir(u, vv) {
  const a = u * Math.PI * 2;
  const b = (vv - 0.5) * Math.PI;
  const cb = Math.cos(b);
  return new THREE.Vector3(cb * Math.cos(a), Math.sin(b), cb * Math.sin(a));
}

// How far a head-local point is from the centre of the mouth, in units of the
// grin's own half-size: 0 at the middle, 1 on its outline. One function, used
// by the dent, by the hole cut in the shell and by the dark behind it, so the
// three can never disagree about where the mouth is.
// A small three- and five-lobed wobble on a feature's outline. Everything on
// this face was a clean geometric primitive in the first build and the note
// back was that the whole character was too smooth and too regular: the
// reference's charm is in the irregularity. This is the cheapest honest way to
// get it, and because it is a function of the ANGLE round the feature it is
// the same wobble whichever way the feature is sampled, so the dent, the dark
// disc inside it and the rim around it all agree.
function lobes(theta, amount, phase) {
  return 1 + amount * (Math.sin(3 * theta + phase) + 0.55 * Math.sin(5 * theta - phase * 1.7)) / 1.55;
}

function grinR(x, y) {
  const lift = M.grin.curve * GRIN_HH * Math.pow(Math.min(1, Math.abs(x) / GRIN_HW), 2);
  const dx = x / GRIN_HW;
  const dy = (y - (GRIN_Y + lift)) / GRIN_HH;
  return Math.hypot(dx, dy) / lobes(Math.atan2(dy, dx), M.grin.wobble, 0.4);
}

// The same, for one eye socket. `side` is +1 for the figure's left.
function socketR(x, y, side) {
  const dx = (x - side * SOCK_X) / SOCK_HW;
  const dy = ((y - BROW_Y) + M.socket.slant * (-side * (x - side * SOCK_X))) / SOCK_HH;
  return Math.hypot(dx, dy) / lobes(Math.atan2(dy, dx), M.socket.wobble, side > 0 ? 0.9 : 2.3);
}

// The nasal aperture: an inverted teardrop, point UP.
//
// This is the third shape here and the first two are worth recording. Built
// from a half-width profile with a hard max() it came out a flat-topped
// diamond. Built as a CARDIOID with its cusp at the top it came out a spade:
// r = 1 - cos(phi) is widest a third of the way down and closes to a point at
// the BOTTOM, which is upside down for a nasal aperture and read as a beak.
//
// What a skull actually has is narrow and pointed between the orbits, opening
// downward to two lobes that flare just above the tooth line, with the nasal
// spine notching the bottom edge up between them. So: an explicit half-width
// profile whose widest point sits at 54 per cent BELOW centre, and a notch cut
// up into the bottom edge.
function noseHalfWidth(t) {                 // t: -1 at the bottom, +1 at the top
  const up = Math.min(1, Math.max(0, (t + 1) / 2));
  const w = Math.pow(1 - up, 0.18) * Math.pow(up, 0.60);
  // normalised so the widest point is exactly 1
  const PEAK = 0.5387;                      // solves d/dt log w = 0
  const peak = Math.pow(1 - PEAK, 0.18) * Math.pow(PEAK, 0.60);
  return Math.max(0.02, w / peak);
}

// The bottom edge rides UP in the middle: that is the nasal spine, and it is
// what turns one dark drop into two lobes.
function noseFloor(x) {
  return 0.34 * Math.exp(-Math.pow(x / (M.nose.width * 0.16), 2));
}

function noseR(x, y) {
  let t = (y - NOSE_Y) / NOSE_HH;
  if (t < 0) t -= noseFloor(x) * (1 + t);   // lift the floor toward the middle
  if (Math.abs(t) >= 1) return Math.abs(t);
  const w = NOSE_HW * noseHalfWidth(t) * lobes(t * 2.4, 0.07, 1.1);
  return Math.max(Math.abs(t), Math.abs(x) / w);
}

// The same outline, sampled, so the dark disc that sits in the aperture is
// exactly the shape of the hole. Rings shrink toward the centroid rather than
// toward the axis, or the inner rings collapse onto a line.
const NOSE_CENTROID_T = -0.30;
function nosePoint(s, r) {
  // Down the figure's RIGHT side first, then back up its left, so the ring
  // winds the same way as every other patch on this model. Wound the other way
  // three culls it and the aperture renders as a crease with no dark in it.
  const half = s < 0.5 ? -1 : 1;
  const q = s < 0.5 ? s * 2 : (1 - s) * 2;
  const t = 1 - 2 * q;
  const ex = half * NOSE_HW * noseHalfWidth(t) * lobes(t * 2.4, 0.07, 1.1);
  const ey = t - (t < 0 ? noseFloor(ex) * (1 + t) : 0);
  const cx = 0, cy = NOSE_CENTROID_T;
  return [cx + (ex - cx) * r, NOSE_Y + NOSE_HH * (cy + (ey - cy) * r)];
}

function surfacePoint(u, vv, { mouth = true, sockets = true, lumps = true } = {}) {
  const d = unitDir(u, vv);

  // --- 3. flattened occiput. Only the back, and only the outer part of it,
  // so the sides keep their round.
  const backK = d.z < 0 ? Math.pow(-d.z, 1.4) : 0;
  const rzHere = RZ * (1 - (1 - M.head.occiputFlat) * backK);

  // --- 4. jaw taper. Below the cheek line the head narrows in both x and z.
  const jawK = smoothstep(-0.10, -0.92, d.y);
  const taper = 1 - (1 - M.head.jawTaper) * jawK;

  // --- 3b. crown fullness. An ellipsoid converges toward its poles, so a head
  // built as one is an egg: widest at the cheeks and narrowing all the way to
  // the crown. Widening the upper cranium is what turns it back into the
  // reference's round, friendly ball.
  const full = 1 + M.head.crownFull * smoothstep(0.20, 0.95, d.y);

  const p = new THREE.Vector3(
    d.x * RX * taper * full,
    CENTRE_Y + d.y * RY,
    d.z * rzHere * taper * full,
  );

  // Outward normal of the base ellipsoid, close enough to displace along.
  const n = new THREE.Vector3(d.x / RX, d.y / RY, d.z / rzHere).normalize();
  const front = smoothstep(0.05, 0.45, d.z);   // 0 behind, 1 on the face

  // --- 6. the muzzle, and the chin under it.
  //
  // The single change that stops the grin reading as a strip of teeth clipped
  // under a skull. The lower middle of the face swells forward, and the mouth
  // is then cut INTO that swell rather than sitting on a smooth surface; the
  // chin below it is a distinct lit form with the mouth's shadow above it.
  // Without this there is a mouth and then nothing, and "nothing" is what the
  // eye reads as the bottom of the head.
  {
    const dy = (p.y - (GRIN_Y + M.head.height * 0.045)) / (M.head.height * 0.145);
    const dx = p.x / (M.head.width * 0.30);
    p.addScaledVector(n, M.head.muzzle * Math.exp(-(dx * dx + dy * dy)) * front);
  }
  {
    // the chin proper: a smaller, rounder pad below the mouth
    const dy = (p.y - (GRIN_Y - M.grin.height * 0.90)) / (M.head.height * 0.055);
    const dx = p.x / (M.head.width * 0.16);
    p.addScaledVector(n, M.head.muzzle * 0.85 * Math.exp(-(dx * dx + dy * dy)) * front);
  }

  // --- 1. the brow shelf. A band above the sockets, front only, that stands
  // proud. This is the single most valuable piece of form on the model: it is
  // what puts the sockets in shadow under a key light coming from above.
  {
    // Centred WELL clear of the socket's top edge. At 1.05 the shelf's peak sat
    // exactly on the rim and pressed the top of the orbit down, which flattened
    // two round sockets into two almonds. A brow has to overhang the eye, not
    // squash it.
    const dy = (p.y - (BROW_Y + SOCK_HH * 1.55)) / (M.head.height * 0.080);
    const band = Math.exp(-dy * dy);
    const across = smoothstep(RX * 1.10, RX * 0.30, Math.abs(p.x));
    p.addScaledVector(n, M.head.browJut * band * across * front);
  }

  // --- 5. the centre ridge, brows to mouth. Very shallow; it exists to give
  // the middle of the face a highlight so the two sockets do not read as two
  // holes in a plate.
  {
    const dy = (p.y - (BROW_Y - M.head.height * 0.10)) / (M.head.height * 0.20);
    const band = Math.exp(-dy * dy);
    // Narrow. At RX * 0.20 this ridge reached the inner edge of both sockets
    // and pushed the dark back out of their lower inner corners, which is what
    // turned two round orbits into two teardrops pointing at the nose.
    const across = Math.exp(-Math.pow(p.x / (RX * 0.115), 2));
    p.addScaledVector(n, M.head.browJut * 0.34 * band * across * front);
  }

  // --- 4b. the cheeks. A soft pad under each socket. It is not in the
  // reference, which is a smooth ball with holes in it, but a smooth ball
  // under this key light gives the whole lower face one flat value, and the
  // socket then has nothing to be dark AGAINST. Half a millimetre of cheek is
  // what separates them.
  {
    for (const side of [1, -1]) {
      const dx = (p.x - side * SOCK_X * 1.10) / (M.head.width * 0.20);
      const dy = (p.y - (BROW_Y - M.head.height * 0.255)) / (M.head.height * 0.090);
      p.addScaledVector(n, M.head.browJut * 0.24 * Math.exp(-(dx * dx + dy * dy)) * front);
    }
  }

  // --- 2. the sockets. Deep, steep-walled, and EMPTY.
  //
  // The falloff runs 0.80 to 1.02 rather than 0 to 1, so four fifths of the
  // socket is at full depth and the wall is nearly vertical. A gentle dish
  // fills with bounce light and turns grey; this one holds its own shadow.
  // --- 2 and 7. the sockets and the nasal aperture.
  //
  // THE RECESSES ARE COMBINED WITH max(), NOT ADDED. The orbits and the
  // aperture are close enough that their falloffs overlap, and summed, the
  // strip of face between them got hollowed out twice: the surface dropped
  // below the dark discs sitting in either hole and they came through it as
  // black spikes reaching for each other. Taking the deepest recess at each
  // point is also what a skull does, since two holes that meet are one hole.
  //
  // The rims are still added, because two rims meeting SHOULD build up: that
  // ridge between the orbit and the aperture is a real piece of bone.
  {
    let recess = 0;
    if (sockets) {
      for (const side of [1, -1]) {
        const r = socketR(p.x, p.y, side);
        // THE ORBITAL RIM: a raised ring all the way round the socket, so the
        // eye has a lid above it, a lower rim below and a corner at each end,
        // rather than being a hole punched in a smooth ball. It lives in the
        // shell because, with the socket painted rather than cut (see the
        // build below), there is no cut edge for it to have to stay clear of.
        //
        // The wall is SHORT and steep: full depth out to the outline, then
        // over in a tenth. A long ramp is a shallow crater, and a crater with
        // a small dark bead in it is what this looked like for three rounds.
        const ring = Math.exp(-Math.pow((r - M.socket.rimAt) / M.socket.rimWide, 2));
        p.addScaledVector(n, M.head.browJut * M.socket.rim * ring * front);
        recess = Math.max(recess, socketDepthAt(r));
      }
    }
    {
      const r = noseR(p.x, p.y);
      const ring = Math.exp(-Math.pow((r - 1.40) / 0.24, 2));
      p.addScaledVector(n, M.head.browJut * 0.14 * ring * front);
      // The flat floor runs almost to the outline. A short flat floor and a
      // long ramp means the dark disc that sits in the aperture is over
      // sloping ground for most of its area and pokes through in slivers.
      recess = Math.max(recess, noseDepthAt(r));
    }
    if (recess > 0) p.addScaledVector(n, -recess * front);
  }

  // --- 8. irregularity.  (switchable: see the note in dentDisc)
  //
  // A very low amplitude lumpiness over the whole cranium, three octaves of
  // it. At 34 px not one bump is resolvable; what IS resolvable is that the
  // terminator across the head is not a clean arc, and that alone is the
  // difference between a moulded ball and a head. The skull went round this
  // same loop: the fix is authored irregularity, not more polygons.
  if (lumps) {
    const a = u * Math.PI * 2;
    const lump =
      Math.sin(a * 3 + 0.7) * Math.sin(vv * 7.0 + 1.3) * 0.55 +
      Math.sin(a * 5 - 2.1) * Math.sin(vv * 11.0 - 0.4) * 0.30 +
      Math.sin(a * 2 + 1.9) * Math.sin(vv * 4.0 + 2.6) * 0.45;
    p.addScaledVector(n, M.head.height * 0.0055 * lump);
  }

  // --- the mouth. A lipless slot: a lens-shaped trough whose corners rise.
  // Nothing below it: the chin belongs to the cranium and stays put. See the
  // note on the jaw below for why the mandible is not a separate shell.
  if (mouth) {
    const slot = 1 - smoothstep(0.72, 1.02, grinR(p.x, p.y));
    if (slot > 0) p.addScaledVector(n, -M.grin.depth * slot * front);
  }

  return p;
}

// The (u, v) of the point on the FRONT of the head nearest a given head-local
// (x, y). Derived from the base ellipsoid, which is close enough: everything
// that uses it then evaluates the real surface function there.
function frontUV(x, y) {
  const dy = Math.min(0.999, Math.max(-0.999, (y - CENTRE_Y) / RY));
  const dx = Math.min(0.999, Math.max(-0.999, x / RX));
  const dz = Math.sqrt(Math.max(1e-4, 1 - dx * dx - dy * dy));
  return [Math.atan2(dz, dx) / (Math.PI * 2), 0.5 + Math.asin(dy) / Math.PI];
}

// The outward normal of the real surface, by finite difference, so a feature
// pressed into the head is placed against the surface as built rather than
// against the ellipsoid it started as.
function surfaceNormal(u, vv, opts) {
  const e = 2e-3;
  const p = surfacePoint(u, vv, opts);
  const pu = surfacePoint(u + e, vv, opts).sub(p);
  const pv = surfacePoint(u, Math.min(1, vv + e), opts).sub(p);
  const n = new THREE.Vector3().crossVectors(pv, pu).normalize();
  const out = p.clone().sub(new THREE.Vector3(0, CENTRE_Y, 0));
  if (n.dot(out) < 0) n.negate();
  return n;
}

// The u at which the real surface reaches a given x on the front of the head,
// at a given height. Bisection, because the surface has a taper, a brow shelf
// and a mouth trough in it and there is no closed form.
function uForX(targetX, y) {
  // u = 0.25 faces +Z and u DECREASES toward +X: at u = 0 the surface point is
  // at x = +RX. Searching the other way is the sign error that put the first
  // pass's teeth on the wrong side of the face and outside the jaw.
  const xAt = (u) => surfacePoint(u, vAtHeight(y), { mouth: true }).x;
  const sgn = Math.sign(targetX) || 1;
  // The search is capped at 56 degrees off the centre line. Below the cheek
  // the head tapers hard, so an x that is reachable at the brow is simply not
  // reachable at the chin, and an uncapped bisection then runs all the way to
  // the side of the head and returns it. That is what turned the mandible cap
  // into a flat plate wrapped a quarter of the way round the skull.
  const LIMIT = 0.155;
  const lim = U_FRONT - sgn * LIMIT;
  if (Math.abs(xAt(lim)) <= Math.abs(targetX)) return lim;
  let lo = U_FRONT, hi = lim;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(xAt(mid)) < Math.abs(targetX)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// The v value at which the surface is at a given head-local height, on the
// front centre line. Used to size the mandible patch.
function vAtHeight(y) {
  const s = Math.min(1, Math.max(-1, (y - CENTRE_Y) / RY));
  return 0.5 + Math.asin(s) / Math.PI;
}

// The socket's depth profile, shared by the shell that cuts the hollow and by
// the cup that lines it. Written once so the two can never disagree.
const socketDepthAt = (r) => M.socket.depth * (1 - smoothstep(1.00, 1.10, r));
// How deep the shell is recessed at a point, for one socket.
//
// The cup that lines the hollow calls THIS, with the SAME point the shell
// used. That is the only way the two can agree, and getting it wrong is the
// entire history of this feature:
//
//  - a cup whose depth came from its own polar parameter drifted against a
//    shell whose depth comes from the displaced surface position, because
//    frontUV inverts the base ellipsoid and the real surface has a brow, a
//    cheek and a crown swell on top of it. The two crossed in a fan of dark
//    spikes round the rim.
//  - a version that folded the ORBITAL RIM in here as a negative recess was
//    worse. The shell combines the two sockets and the nose with max(), and
//    max() throws every negative away: the shell ended up with no rim at all
//    while the cup was still compensating for one.
//
// So the rim stays where it is, added separately by the shell, and this
// returns the recess alone. The rim then simply clips the cup's outer edge,
// which is what tucking it under the skin means.
function socketRecessAt(x, y, side) {
  return socketDepthAt(socketR(x, y, side));
}
const noseDepthAt = (r) => M.nose.depth * (1 - smoothstep(0.88, 1.03, r));

// A dark sheet laid IN a dent.
//
// This is the fourth answer to "how do you make a socket black", and the three
// before it are all worth recording because each is the obvious next thing.
//
//  1. A dark BALL seated in the dent. An ellipsoid falls away from its own pole
//     faster than the face does, so it is flush only at the very middle and the
//     rest of the socket stays green. Two coffee beans.
//  2. CUTTING A HOLE with a dark wall behind it, the way the chest cavity
//     works. Perfect darkness, ragged edge: a quad grid can only cut on its own
//     cell boundaries. On the chest a lip ribbon hides that; a socket has no
//     lip, and a torn eye is a different character.
//  3. A patch sampled off THE SURFACE AS BUILT and pushed a little proud of it.
//     Correct in principle and it fails on noise: the shell carries an outline
//     wobble and three octaves of lumps, and the patch resamples them at
//     slightly different (u, v) through frontUV, so the two disagree by a
//     fraction of a millimetre and the disc comes through the skin in black
//     slivers all round the rim.
//
// What works is to build the disc against the surface WITHOUT the feature in
// it, then drop it by most of the feature's depth. That gives a smooth dish
// parallel to the face, sitting proud of the dent's floor and behind its
// walls, so the shell itself decides where the dark stops. The silhouette is
// then the intersection of two smooth surfaces and cannot be ragged, and
// `proud` is the clearance that keeps the noise from mattering.
function dentDisc({
  cx, cy, hw, hh, slant = 0, side = 1, scale = 1.05, rFrom = 0,
  depth, proud = 0.15, depthOf = null, lift = null, sectors = 24, rings = 5,
  wobble = 0, phase = 0, outline = null,
}) {
  const bare = { mouth: false, sockets: false };
  const bareFlat = { mouth: false, sockets: false, lumps: false };
  return gridSurface({
    uSteps: sectors, vSteps: rings, closedU: true,
    point: (a, t) => {
      const r = rFrom + (scale - rFrom) * t;
      // (drop is computed below, once the surface point is known)
      let x, y;
      if (outline) {
        [x, y] = outline(a, r);
      } else {
        const th = a * Math.PI * 2;
        // The SAME wobble the dent itself uses, so the two outlines agree.
        const k = r * lobes(th, wobble, phase);
        x = cx + hw * k * Math.cos(th);
        y = cy + hh * k * Math.sin(th) + slant * side * (hw * k * Math.cos(th));
      }
      if (lift) y += lift(x);
      const [u, vv] = frontUV(x, y);
      const p0 = surfacePoint(u, vv, bare);
      // The DEPTH QUERY is made on the surface WITHOUT the lumpiness, because
      // that is the point the shell itself measured: the shell applies its
      // three octaves of lumps last, after it has already decided how deep to
      // recess. Query the lumpy point instead and the answer is wrong by up to
      // four tenths of the socket's depth wherever the wall is steep, which is
      // several times the clearance, and the cup rips through the skin in a
      // fan of dark rays. Position with lumps, depth without.
      const pq = depthOf ? surfacePoint(u, vv, bareFlat) : null;
      // Two ways to place the sheet.
      //
      // A FLAT disc at one depth (`proud`) is right for a shallow feature and
      // wrong for a deep one: the shell's wall climbs out of the hollow and
      // crosses in front of it, so the dark stops well short of the opening
      // and you get a big lit crater with a small dark bead at the bottom.
      // That is what the sockets looked like for three rounds.
      //
      // A CUP asks the shell how far IT has moved at this very point and sits
      // a constant clearance in front of that, so it lines the whole hollow,
      // walls included, and the two can never cross. The clearance fades to
      // slightly negative at the last ring, so the cup tucks under the skin at
      // its edge rather than standing proud of it as a dark halo.
      const drop = depthOf
        ? -(depthOf(pq) - depth * (0.10 * (1 - t) - 0.04 * t))
        : -depth * (1 - proud);
      // Along the LOCAL base normal, not one axis taken at the feature's
      // centre: over a socket's width that direction swings twenty degrees,
      // and a sheet pushed along a single axis slides out of its own hollow.
      return p0.addScaledVector(baseNormal(u, vv), drop);
    },
  }).geometry;
}

// --- teeth --------------------------------------------------------------------
//
// Five up, four down, and the gaps are deliberate. Ten teeth in a 0.31 unit
// grin is 1.8 px each in a shipped frame and dithers into a grey band; five is
// five white blocks with black between them, which is what a grin actually is
// at this size. Uneven heights and a couple of missing ones do the rest.
function toothRow(parent, material, { count, gap, up, seed }) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const span = M.grin.width * 0.80;
  // Teeth are placed by AZIMUTH, not by a target x, and this is the bug the
  // first pass had. Solving for an x and then putting a block there works on
  // the middle of the face and fails at the corners of the grin, because the
  // head is tapering hard by then: the outer teeth were asked to sit at an x
  // the surface no longer reaches, and came out floating outside the jaw.
  for (let i = 0; i < count; i++) {
    if (i === gap) continue;                        // a missing tooth
    const t = count === 1 ? 0.5 : i / (count - 1);
    const targetX = (t - 0.5) * span;
    const w = (span / count) * (0.74 + rnd() * 0.16);
    const h = M.grin.height * (up ? 0.30 : 0.26) * (0.82 + rnd() * 0.32);
    // Two passes. The head tapers hard down here, so the azimuth that reaches
    // a given x at the mouth's centre line reaches a noticeably LARGER x a
    // couple of millimetres higher up, which is what walked the first pass's
    // outer teeth out of the mouth and onto the cheeks. Solve at the tooth's
    // own height, then again once the corner lift is known.
    let y = GRIN_Y + (up ? 1 : -1) * (M.grin.height * 0.05 + h / 2);
    let uu = uForX(targetX, y);
    const x = surfacePoint(uu, vAtHeight(y), { mouth: true }).x;
    const lift = M.grin.curve * GRIN_HH * Math.pow(Math.min(1, Math.abs(x) / GRIN_HW), 2);
    y = GRIN_Y + lift + (up ? 1 : -1) * (M.grin.height * 0.05 + h / 2);
    uu = uForX(targetX, y);
    const vv = vAtHeight(y);
    const floor = surfacePoint(uu, vv, { mouth: true });
    const n = surfaceNormal(uu, vv, { mouth: true });
    const g = softBox(w, h, M.grin.depth * 1.15, { round: 0.42, uSteps: 8, vSteps: 6 });
    const m = put(parent, g, material, {
      pos: floor.clone().addScaledVector(n, M.grin.depth * 0.40),
    });
    m.quaternion.setFromUnitVectors(v(0, 0, 1), n);
    m.rotateZ((rnd() - 0.5) * 0.22);                // uneven
    m.rotateX((rnd() - 0.5) * 0.14);
  }
}

// --- stitches -----------------------------------------------------------------
//
// Short crossed lines, as real rods. There is no texture pipeline here and an
// alpha card has nothing to reflect, so a painted scar is not available.
//
// The length comes from LEGIBILITY, not from the reference: at 4.4 px a rod
// still reads as a line, and below that it is a speck. What actually carries
// the scar at game scale is the RHYTHM of three or four dark marks in a row,
// not any one of them, which is why the crosses are spaced rather than tight.
function stitchScar(parent, material, { from, to, count, thickness }) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  // The scar line itself, thin, laid along the surface.
  const g = limb(from, to, thickness * 0.55, thickness * 0.55, { radial: 6, segments: 4, waist: 1 });
  put(parent, g, material);
  // The crosses, alternating lean so the ladder reads as stitching.
  const side = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const c = from.clone().addScaledVector(dir, len * t);
    const lean = (i % 2 ? 1 : -1) * 0.42;
    const arm = new THREE.Vector3()
      .addScaledVector(side, M.stitch.length * 0.5)
      .addScaledVector(dir, M.stitch.length * 0.5 * lean);
    const a = c.clone().sub(arm);
    const b = c.clone().add(arm);
    // Push each cross out along the head normal so it sits on the skin.
    const push = c.clone().normalize().multiplyScalar(0.0);
    a.add(push); b.add(push);
    put(parent, limb(a, b, thickness, thickness, { radial: 6, segments: 3, waist: 1 }), material);
  }
}

// Lay a point on the head surface, then lift it out by `out`.
function onHead(u, vv, out = 0) {
  const p = surfacePoint(u, vv);
  return p.clone().add(p.clone().sub(v(0, CENTRE_Y, 0)).normalize().multiplyScalar(out));
}

// --- build --------------------------------------------------------------------

export function buildHead({ materials }) {
  const group = new THREE.Group();
  group.userData.outwardX = 1;

  // 104 x 64. The socket wall is the steepest thing on the model and at 88 x
  // 56 its u samples showed as a fan of facets round the rim.
  const U = 104;
  const V = 64;

  // THE SHELL, AND WHY THE DARK IS PAINTED ON IT RATHER THAN PUT BEHIND IT.
  //
  // The sockets, the nasal aperture and the mouth are all drawn from THE SAME
  // parametric surface as the face, over THE SAME grid, in three passes that
  // keep different quads. There is no cut, no hole, nothing placed behind
  // anything: it is one continuous surface, coloured in three parts, and the
  // dark is the recess itself rather than an object seen through an opening.
  //
  // This is the fifth construction and the four before it all failed the same
  // way, so the reasoning is worth keeping.
  //
  //   1. A dark BALL seated in the dent: flush only at its own pole.
  //   2. A dark PATCH resampled off the built surface: the patch reaches the
  //      surface through frontUV, which inverts the base ellipsoid, while the
  //      shell has a brow, a cheek, a crown swell and three octaves of lumps
  //      on top of that. The two disagree by a fraction of a millimetre and
  //      the patch comes through the skin in slivers.
  //   3. A CUP following the dent's own depth profile: same problem, one term
  //      further down. Each fix removed one source of drift and revealed the
  //      next.
  //   4. A real HOLE with a rim ribbon over the cut and a bowl behind, which
  //      is how the chest cavity works and works well there. On a socket it
  //      does not, for two reasons the chest does not have: the recess is
  //      applied along the local normal, which at an orbit is raked 25 degrees
  //      off the view, so the surviving shell slides sideways over the hole;
  //      and the bowl behind is a solid whose silhouette has to stay hidden
  //      inside a curving head from every angle, which it does not once the
  //      walk turns the head twenty degrees, which it does every cycle.
  //
  // Painting it removes every one of those failure modes at once, because
  // there are no longer two surfaces to disagree. What it costs is that the
  // boundary between colours is a staircase at grid resolution. That is worth
  // it: the boundary sits on the steep wall of the dent, in its own shadow,
  // and at 104 samples across the face one step is about half a pixel in a
  // shipped frame.
  const U = 104;
  const V = 64;
  const uAt = (i) => concentrate(i / U, U_FRONT, 0.55);
  const vAt = (j) => vWarp(j / V, V_FACE, 0.45);

  // Which of the three a quad belongs to, decided on the BARE surface so the
  // painted region is the same region the dent is cut into.
  const SKIN = 0, DARK = 1, DEEP = 2;
  const zoneOf = (u, vv) => {
    const p = surfacePoint(u, vv, BARE);
    if (p.z <= 0) return SKIN;
    for (const side of [1, -1]) {
      const r = socketR(p.x, p.y, side);
      if (r <= 0.52) return DEEP;
      if (r <= 1.00) return DARK;
    }
    if (grinR(p.x, p.y) <= 1.00) return DEEP;
    if (noseR(p.x, p.y) <= 1.00) return DARK;
    return SKIN;
  };

  for (const [zone, material] of [[SKIN, materials.skin], [DARK, materials.socket], [DEEP, materials.socketDeep]]) {
    put(group, gridSurface({
      uSteps: U, vSteps: V, closedU: true, uAt, vAt,
      point: (u, vv) => surfacePoint(u, vv),
      keepQuad: (u, vv) => zoneOf(u, vv) === zone,
    }).geometry, material);
  }

  // Upper teeth ride on the cranium.
  toothRow(group, materials.tooth, { count: M.grin.teeth.upper, gap: M.grin.teeth.gapUpper, up: true, seed: 7 });

  // --- the jaw ------------------------------------------------------------
  //
  // Identity is CLOSED and POSITIVE rotation.x opens it, exactly as the
  // skeleton publishes. The figure faces +Z, so the chin is below and in front
  // of the hinge and a positive x rotation drops it; negative drives it up
  // through the cranium. The model publishes this on userData so an animator
  // can assert it instead of trusting this paragraph.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, HINGE_Y, M.head.jawHingeZ);
  group.add(jaw);

  // WHAT THE JAW CARRIES, and what it does not.
  //
  // It carries the lower tooth row and the gum bar under it. It does NOT carry
  // a piece of the chin.
  //
  // The first build made the mandible a real shell: the patch of cranium the
  // mouth recess carved away, put back on the hinge, so an opening jaw dropped
  // the chin with it. It is the anatomically right answer and it is what the
  // skeleton does. Here it was wrong twice over. The head tapers so hard below
  // the cheek that the patch could not be given a sensible width without
  // wrapping round the skull, and once it fitted, its stitched rim read as a
  // boxy shelf glued to the face from every angle. And the payoff is nil: at
  // 34 px of head, a dropped chin and a dropped tooth row look identical,
  // because what the viewer resolves is the DARK BAND GETTING TALLER and
  // nothing else.
  //
  // So the cranium keeps its chin, the trough behind the teeth is deep enough
  // to swallow them, and the jaw swings the teeth and the gum down into it.
  const lower = new THREE.Group();
  lower.position.set(0, -HINGE_Y, -M.head.jawHingeZ);
  jaw.add(lower);
  toothRow(lower, materials.tooth, { count: M.grin.teeth.lower, gap: M.grin.teeth.gapLower, up: false, seed: 23 });

  // The gum bar: a slim ridge along the bottom of the trough, so the lower
  // teeth stand on something and the mouth does not read as teeth floating in
  // a hole.
  {
    const yGum = GRIN_Y - GRIN_HH * 0.72;
    const uEdge = Math.abs(uForX(M.grin.width * 0.44, yGum) - U_FRONT);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = U_FRONT - uEdge + (2 * uEdge) * (i / 10);
      const x = surfacePoint(u, vAtHeight(yGum)).x;
      const lift = M.grin.curve * GRIN_HH * Math.pow(Math.min(1, Math.abs(x) / GRIN_HW), 2);
      const vv = vAtHeight(yGum + lift);
      pts.push(surfacePoint(u, vv).addScaledVector(surfaceNormal(u, vv), -M.grin.depth * 0.10));
    }
    put(lower, tube(new THREE.CatmullRomCurve3(pts), M.grin.height * 0.085, M.grin.height * 0.085,
      { radial: 8, segments: 16 }), materials.flesh);
  }

  // --- ears ---------------------------------------------------------------
  // Small and round, and pressed flat against the head. They matter less for
  // charm than for the three-quarter silhouette, where they are the only thing
  // breaking the outline of a very large smooth ball.
  for (const side of [1, -1]) {
    // Behind the equator, not on it. On the equator the ear catches the same
    // light as the face and, from the game's three-quarter camera, the dark
    // dimple in it reads as a third eye. Behind it, the ear is a silhouette
    // bump and nothing else, which is all it is for.
    const uEar = side > 0 ? -0.035 : 0.535;
    const p = onHead(uEar, vAtHeight(EAR_Y), -M.ear.radius * 0.30);
    const g = ball(M.ear.thickness, M.ear.radius, M.ear.radius * 0.80, 14);
    const m = put(group, g, materials.skin, { pos: p });
    m.rotation.z = side * 0.18;
    const inner = ball(M.ear.thickness * 0.42, M.ear.radius * 0.34, M.ear.radius * 0.30, 10);
    put(group, inner, materials.stitch, {
      pos: p.clone().add(v(side * M.ear.thickness * 0.42, -M.ear.radius * 0.04, -M.ear.radius * 0.04)),
    });
  }

  // --- stitched scars -------------------------------------------------------
  // Three across the forehead, two on the figure's LEFT cheek, which is +X.
  {
    const scars = new THREE.Group();
    group.add(scars);
    // Over the figure's LEFT brow rather than across the centre line. A scar
    // straight down the middle of a symmetrical face reads as a seam in the
    // moulding; off to one side it reads as damage.
    const foreheadV = vAtHeight(BROW_Y + M.head.height * 0.17);
    const a = onHead(U_FRONT + 0.020, foreheadV, M.stitch.thickness * 0.4);
    const b = onHead(U_FRONT + 0.088, vAtHeight(BROW_Y + M.head.height * 0.25), M.stitch.thickness * 0.4);
    stitchScar(scars, materials.stitch, { from: a, to: b, count: M.stitch.forehead, thickness: M.stitch.thickness });

    const cheekV = vAtHeight(BROW_Y - M.head.height * 0.16);
    const c = onHead(U_FRONT - 0.078, cheekV, M.stitch.thickness * 0.4);
    const d = onHead(U_FRONT - 0.104, vAtHeight(BROW_Y - M.head.height * 0.26), M.stitch.thickness * 0.4);
    stitchScar(scars, materials.stitch, { from: c, to: d, count: M.stitch.cheek, thickness: M.stitch.thickness });
  }

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });

  return {
    group,
    joints: { jaw },
    dispose() { for (const g of geometries) g.dispose(); },
  };
}

// Exported for the probes that measure the face while it is being tuned.
export { surfacePoint as headSurfacePoint };
