import * as THREE from 'three';
import { registerStone } from '../tombstones.js';

// A sunken ledger: the flat coffin slab that lies over a grave rather than
// standing at the head of it. Every other stone in the set is an upright, so
// the diversity this piece buys is not a new outline, it is a new posture:
// ground furniture, long and low, wide enough that the eye reads a slab of
// paving and not a chip of debris.
//
// Three things follow from lying down, and all three are decided here:
//
// 1. The registry stands its slab up and sets a plinth under it. Neither is
//    wanted, and neither can be switched off from a registration, so `extras`
//    takes the two meshes the registry has already built and re-poses them.
//    The slab is laid face-up; the plinth, which is a long low rounded bar
//    already and samples nothing but the grime band of the texture, is reused
//    as the half-buried kerb along the edge where the stone goes under.
//
// 2. The inscription faces the sky, so the fixed scene camera sees it at 29
//    degrees rather than head on and everything on it is squashed to about
//    half height. The mark is therefore one big closed figure with fat strokes,
//    laid along the length of the slab, which is the axis that does NOT
//    foreshorten from this camera. Coverage is ~10% of the face: the top of the
//    approved set's 5-10% band, spent deliberately on the one stone whose face
//    is turned away from the viewer.
//
// 3. Sunk has to be real. The stone is seated from its own lowest transformed
//    vertex, never a bounding box, so the low end genuinely passes through the
//    floor instead of resting a millimetre over it.

// Plan is 1.44 by 0.84, thickness 0.17. The peak of the stone stands about 0.35
// off the floor against 1.10 to 1.56 for the uprights, and it is the widest
// thing in the graveyard. Height here is the registry's "up the face" axis,
// which once the slab is laid down runs away from the camera.
const HALF_WIDTH = 0.72;
const LENGTH_Y = 0.84;
const THICK = 0.17;
// The kerb is built from this: a bar 2 * (HALF_WIDTH + 0.075) long and
// THICK + 0.13 deep, of which only the top rounded sliver stays above ground.
const KERB_H = 0.11;

// Face tipped toward the viewer: the far edge lifts, the near edge settles, and
// the mark is seen at 37 degrees instead of 29, which is about a quarter more
// apparent height for free. This is the whole reason the piece is legible at
// all from a camera that is only 29 degrees off the floor.
const TILT = 0.15;
// The subsidence, and it is the real one: a roll along the length that carries
// the -x end down into the earth. Nine degrees.
const DIP = 0.19;
// How far below the floor the deepest vertex sits. Set by the thing that has to
// be true: the floor must cut across the carved FACE near the low end, not just
// hide the underside of it. Sink the stone by less than its own thickness and
// every square inch of the face stays above ground, which is exactly how a slab
// resting on a lawn looks. The registry adds its own small lean and a -0.012
// drop after `extras` runs, so the seating is only ever deeper than this.
const SINK = 0.20;
// Displaced earth. The floor is #8f949e, so this is the ground a shade darker
// and nothing new in the palette.
const EARTH = '#9aa0aa';

// Lowest point of a geometry once its matrix is applied, walked vertex by
// vertex. Box3.setFromObject would grow the local box by the rotation and hand
// back a tumbling cube's corner, which reads as a stone buried twice as deep as
// it is.
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

registerStone('ledger', {
  shape: { halfWidth: HALF_WIDTH, height: LENGTH_Y, depth: THICK, plinth: KERB_H },
  // Lying down, "top" and "bottom" are just the far and near long edges, so both
  // are set and set the same: a ledger is a rounded rectangle, not an arch. A
  // fifth of the half-width in each corner is as soft as the outline can go
  // before it turns into a lozenge.
  topRadius: 0.20,
  bottomRadius: 0.20,

  // One Latin cross running the length of the slab, which is what a real coffin
  // slab carries and, from this camera, the only orientation that keeps the
  // long stroke of the mark off the foreshortened axis. No lettering under it:
  // one closed figure on clean stone is the whole read, and a second element
  // would only fill the face up.
  draw(ctx, w, h) {
    const T = h * 0.115; // stroke, ~0.097 in world: fat enough to survive being
    const L = w * 0.62; // seen at half height and squashed by the tone map
    const B = h * 0.56;
    const r = T * 0.34; // even the engraved marks get rounded ends
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.beginPath();
    ctx.roundRect(cx - L / 2, cy - T / 2, L, T, r);
    ctx.fill();
    // Crossbar a quarter of the way down from the head, and the head is the
    // raised end: the busiest part of the mark sits on the part of the slab
    // that is highest, best lit and furthest from the earth.
    ctx.beginPath();
    ctx.roundRect(cx + L / 2 - L * 0.26 - T / 2, cy - B / 2, T, B, r);
    ctx.fill();
  },

  extras({ body, material, plinthH, halfWidth, height, disposables, stripUV }) {
    const meshes = body.children.filter((o) => o.isMesh);
    // The registry lifts the slab onto the plinth and leaves the plinth at the
    // origin, so the two are told apart by where they sit rather than by the
    // order they happen to arrive in.
    const slab = meshes.find((m) => Math.abs(m.position.y - plinthH) < 1e-6) || meshes[0];
    const ridge = meshes.find((m) => m !== slab);

    // Lay it down. Rotating -90 about x puts the carved face up and sends the
    // top of the inscription away from the camera, which is how a ledger is
    // read: from its foot. The dip is applied in the parent's frame afterwards
    // so it tips one END of the slab down rather than one long edge.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + TILT, 0, 0));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), DIP));
    slab.quaternion.copy(q);

    // Centre the slab on the plot: its own middle is half way up the face.
    const centre = new THREE.Vector3(0, height / 2, 0).applyQuaternion(q);
    slab.position.set(-centre.x, -centre.y, -centre.z);
    slab.updateMatrix();
    slab.position.y -= SINK + lowestVertex(slab.geometry, slab.matrix);
    slab.updateMatrix();

    // Where the floor crosses the carved face. The transform is affine, so the
    // face's mid-line is linear in x and two samples locate the waterline
    // exactly. Everything the earth does is placed off this, not off the tip of
    // the stone, which by now is well under the floor.
    const faceMid = (x) => new THREE.Vector3(x, height / 2, THICK / 2).applyQuaternion(q).add(slab.position);
    const y0 = faceMid(0).y;
    const slope = faceMid(1).y - y0;
    const waterline = -y0 / slope;

    // --- displaced earth ------------------------------------------------------
    //
    // A slab that simply passes through the floor still reads as dropped on it.
    // What says "went in" is soil heaped along the line where it disappears and,
    // more than anything else, soil lying OVER the end of the stone: earth on
    // top of a slab cannot be read as a slab sitting on top of earth.
    //
    // This is the one place the piece leaves the stone palette, and it leaves it
    // toward the floor rather than away from it: the mounds are the ground's own
    // colour a shade darker, so the set gains no new hue. They keep the stone's
    // map, sampled in the plain strip's grime band, so they are dirt-speckled
    // rather than moulded. No normal map: the inscription's relief has no
    // business appearing in a pile of soil.
    const soil = material.clone();
    soil.color = new THREE.Color(EARTH);
    soil.normalMap = null;
    disposables.push(soil);

    // The registry's plinth, which a stone lying down has no use for, is the
    // main ridge: a rounded bar turned across the sunken end and buried to all
    // but a finger's width. Scaled rather than rebuilt, and squashing a rounded
    // profile leaves it rounded.
    // The registry's plinth is a flat-topped bar, which is the one shape soil
    // never has, so it is parked out of sight under the stone rather than
    // dressed up. It stays in the scene because dispose() owns its geometry and
    // because a mesh below the floor is never the nearest thing to the key
    // light, so it casts nothing.
    if (ridge) {
      ridge.rotation.y = Math.PI / 2;
      ridge.position.set(0, -KERB_H - 0.6, 0);
    }

    // The berm: one run of overlapping ellipsoids along the waterline, sunk to
    // the waist. Overlapping matters. Spaced apart they are pebbles, and an
    // earlier pass at four discrete lumps read as a cartoon paw print beside the
    // stone; merged into one low swell they read as ground that has been pushed
    // up. Nothing here is tall enough to hide the stone's own outline running
    // out at the floor, which is the cue that actually does the work.
    //
    // One geometry between them, mapped into the plain strip: a sphere arrives
    // with its own cylindrical wrap, which would smear the inscription round it.
    // v runs low at the bottom of each lump and high at the top, so a lump comes
    // out of the grime band dirty where it meets the floor and clean over the
    // crown, which is the way round a heap of soil weathers.
    const clod = new THREE.SphereGeometry(1, 20, 14);
    {
      const pos = clod.attributes.position;
      const uv = clod.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const [u, v] = stripUV(pos.getX(i), pos.getY(i) + 1, 1, 2, 0.95);
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
    }
    disposables.push(clod);

    const berm = [
      { x: 0.03, z: -0.34, rx: 0.24, rz: 0.26, h: 0.034, sink: 0.45 },
      { x: -0.02, z: 0.00, rx: 0.28, rz: 0.30, h: 0.040, sink: 0.45 },
      { x: 0.05, z: 0.33, rx: 0.22, rz: 0.24, h: 0.032, sink: 0.45 },
      { x: -0.16, z: 0.16, rx: 0.18, rz: 0.22, h: 0.028, sink: 0.5 },
    ];

    for (const c of berm) {
      const m = new THREE.Mesh(clod, soil);
      m.scale.set(c.rx, c.h, c.rz);
      // Sat on the stone it is burying, or on the floor once past the end of it,
      // and sunk either way, so what shows is a swell and not a ball resting on
      // a surface.
      const x = waterline + c.x;
      m.position.set(x, Math.max(0, faceMid(x).y) - c.h * c.sink, c.z);
      m.rotation.y = c.z * 0.8;
      m.castShadow = true;
      m.receiveShadow = true;
      body.add(m);
    }
  },
});
