import * as THREE from 'three';
import M from '../metrics.js';
import { trunkRadius } from './torso.js';
import { sheet2, tatterAt, ovoid, put, v3, mix, smoothstep } from './forms.js';

// The clothes. A torn jacket hanging OPEN over the exposed ribcage, and ragged
// shorts with holes in them.
//
// EVERY EDGE IS GEOMETRY. There is no alpha in this scene and no environment
// map for a card to reflect, so a torn hem is a real sawtooth in the mesh and
// a hole is a real opening. `sheet2` builds each garment as a closed solid --
// an outer face, an inner face and a wall round every open edge -- which is
// POSTMORTEM 2.6's "two sheets and a rim on every cut edge": a single sheet is
// invisible edge-on and its torn hem has no thickness, so it reads as a decal.
//
// THE HEM IS SCALLOPED, AND THAT IS A SILHOUETTE DECISION, NOT A STYLE ONE.
//
// The arms only just clear the trunk -- see the note on `M.torso` -- and a
// garment hanging at a constant radius puts the cloth straight back into the
// gap the narrow waist just opened. Measured at the three-quarter camera, a
// jacket that hangs level takes the daylight beside the forearm from 2.9 px to
// 1.0 px, which is most of the way back to the bollard.
//
// So the jacket hangs LONG at the front lapels and down the back, and its
// SIDE panels stop just below the torn sleeve. That is where the forearm
// passes, and it is also what a jacket that has been through what this one has
// been through actually looks like.
//
// The other rule the postmortem leaves: garments hang from the RIGHT JOINT.
// Shorts cuffs on `hipL`/`hipR`, so the cloth swings with the thigh instead of
// the thigh swinging through it; the jacket on `spineUpper`.

const J = M.jacket;
const S = M.shorts;

// --- the jacket ---------------------------------------------------------------

// Where the cloth is, as an azimuth from the front. u = 0 is the figure's LEFT
// lapel edge and u = 1 the right one, going round the back.
const azOf = (u) => mix(J.openHalfAngle, 2 * Math.PI - J.openHalfAngle, u);

// The scalloped hem, in world height, as a function of u.
//
// Three heights, and each is set by what the silhouette can afford there:
//
//   front panel  low enough to overlap the shorts' waistband, so the two read
//                as a jacket worn over shorts rather than as three stacked
//                bands of cloth round the hips;
//   under the arm  HIGH -- this is the one band where cloth costs daylight,
//                because the forearm passes here and the trunk has already
//                been narrowed as far as the ribcage window allows;
//   the back     lowest of all, a torn tail. It is free: at the game's
//                three-quarter camera the back of the figure projects inward,
//                so a tail there can be as long as it likes.
function hemAt(u) {
  const a = azOf(u);
  const side = Math.min(a, 2 * Math.PI - a) / Math.PI;   // 0.235 at a lapel, 1 at the back
  // Level and CROPPED, with two short tails at the front edges.
  //
  // This was arrived at by measurement, and the measurement is worth writing
  // down because the intuition is wrong. At the game's three-quarter camera
  // the near arm competes with the cloth at azimuth 42 to 109 degrees and the
  // far arm with the cloth at 161 to 289; at the front camera it is 64 to 116
  // and 244 to 296. The union is everything except the front opening. There is
  // NO azimuth where a long hem is free -- not even the back, which was the
  // obvious place to hide one.
  //
  // So the jacket is cropped just below the ribcage window, and the two front
  // tails are the only cloth that hangs, because they sit at the edge of the
  // opening where the trunk is at its shallowest.
  const tail = Math.exp(-Math.pow((side - 0.255) / 0.065, 2));
  const backTail = Math.exp(-Math.pow((side - 1.0) / 0.14, 2));
  return mix(J.hem, J.hem - 0.098, Math.max(tail, backTail * 0.72));
}

function jacketSection(y) {
  // Hangs off the body with a standoff, and swings out a little at the hem so
  // it reads as cloth rather than paint. The standoff is DELIBERATELY mean:
  // measured at the three-quarter camera, every millimetre the jacket stands
  // off the trunk comes straight out of the daylight beside the forearm.
  const flare = 1 + 0.07 * smoothstep(J.top, J.hem, y);
  return (a) => (trunkRadius(y, a) || M.torso.waistWidth / 2) * flare + J.thickness * 1.1;
}

// The jacket's TOP edge, as a world height per azimuth. Level, it gives the
// figure square shoulders -- a horizontal cut across a round body reads as a
// sandwich board, and that is exactly what the first clothed silhouette came
// back as. It rides highest over the deltoids and drops at the front and the
// back, which is where a real shoulder line goes.
function topAt(u) {
  const a = azOf(u);
  const side = Math.min(a, 2 * Math.PI - a) / Math.PI;
  const overShoulder = Math.exp(-Math.pow((side - 0.50) / 0.30, 2));
  return mix(J.top - M.arm.upperRadius * 0.62, J.top, overShoulder);
}

export function buildJacket({ materials }) {
  const group = new THREE.Group();       // lives in `frames.inUpper`: world heights
  const geos = [];
  const track = (g) => { geos.push(g); return g; };

  const U = 42, V = 14;
  const point = (u, v) => {
    const a = azOf(u);
    const hem = hemAt(u);
    // the sawtooth is measured UP from the hem, so it never crosses the top
    const y = mix(topAt(u), hem + tatterAt(u, 11, J.tatter, 3.1), v);
    const r = jacketSection(y)(a);
    return v3(Math.sin(a) * r, y, Math.cos(a) * r);
  };
  const normalAt = (u, v) => {
    const a = azOf(u);
    return v3(Math.sin(a), 0, Math.cos(a));
  };
  // Two holes worn through the back and one shoulder, each with a rim for
  // free because the sheet is closed.
  const keep = (u, v) => {
    const holes = [[0.50, 0.62, 0.075, 0.18], [0.185, 0.34, 0.040, 0.12]];
    for (const [cu, cv, ru, rv] of holes) {
      if (Math.hypot((u - cu) / ru, (v - cv) / rv) < 1) return false;
    }
    return true;
  };
  const body = track(sheet2({ uSteps: U, vSteps: V, point, normalAt, thickness: J.thickness, keep }));
  put(group, body, materials.jacket, { name: 'jacket' });

  // --- the lapels -------------------------------------------------------------
  //
  // Without them the garment reads as a collar and a belt with nothing between
  // them. They fold OUTWARD from the front edge, so the opening has a rolled
  // lip that catches the key light and frames the ribcage instead of ending in
  // a flat cut.
  for (const side of [+1, -1]) {
    const a0 = side > 0 ? J.openHalfAngle : 2 * Math.PI - J.openHalfAngle;
    const lp = track(sheet2({
      uSteps: 7, vSteps: 10,
      point: (u, v) => {
        const y = mix(topAt(side > 0 ? 0 : 1), M.y.cavityBottom - J.tatter, v);
        // Rolls OUTWARD, away from the opening, widest at the chest. Rolled
        // inward -- which is what it did first -- the two lapels close across
        // the ribcage window and cover the one feature the opening exists to
        // show. A lapel folds back onto the chest, not over it.
        const roll = u * mix(0.22, 0.50, Math.sin(Math.PI * Math.min(1, v * 1.5)));
        const a = a0 + side * roll * 0.55;
        const r = jacketSection(y)(a) * (1 + 0.10 * u);
        return v3(Math.sin(a) * r, y, Math.cos(a) * r + u * J.thickness * 1.4);
      },
      normalAt: (u) => {
        const a = a0 + side * u * 0.28;
        return v3(Math.sin(a), 0, Math.cos(a));
      },
      thickness: J.thickness * 0.9,
    }));
    put(group, lp, materials.jacketDark, { name: 'lapel' });
  }

  // --- the sleeves ------------------------------------------------------------
  //
  // Torn off just above the elbow, and built as ONE short piece each rather
  // than a tube down the arm: they hang from the shoulder, and a sleeve that
  // reached past the elbow would have to be split at the joint or it drags.
  // At this length the elbow is bare, which is also what the reference has.
  for (const side of [+1, -1]) {
    const sx = side * M.arm.shoulderSeparation / 2;
    const top = M.y.shoulder + M.arm.upperRadius * 1.05;
    const drop = J.sleeveTo;
    const sl = track(sheet2({
      uSteps: 16, vSteps: 6, closedU: true,
      point: (u, v) => {
        const a = 2 * Math.PI * u;
        const y = mix(top, drop + tatterAt(u, 7, J.tatter * 0.8, side * 5.7), v);
        const t = (top - y) / Math.max(1e-6, top - drop);
        // The cap is DOMED. A tube with a flat top disc puts a hard square
        // corner on each shoulder, which is most of what made the first
        // clothed silhouette read as a sandwich board.
        const dome = Math.sin(Math.min(1, t * 3.4) * Math.PI / 2);
        const r = mix(M.arm.upperRadius * 1.12, M.arm.elbowRadius * 1.18, t) * mix(0.40, 1.0, dome);
        const cx = sx + side * (M.arm.outboard[0] + t * (M.arm.upperRadius * 0.62));
        return v3(cx + Math.cos(a) * r * side, y, Math.sin(a) * r);
      },
      normalAt: (u) => {
        const a = 2 * Math.PI * u;
        return v3(Math.cos(a) * side, 0, Math.sin(a));
      },
      thickness: J.thickness,
    }));
    put(group, sl, materials.jacket, { name: 'sleeve' });
  }

  // The collar: a low roll round the back of the neck. It is what stops the
  // jacket's top edge being a clean circle, which is the one thing that would
  // say "moulded" on a garment that is meant to be rag.
  {
    const pts = [];
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const a = mix(J.openHalfAngle * 1.15, 2 * Math.PI - J.openHalfAngle * 1.15, i / N);
      const y = J.top + M.jacket.thickness * 1.2 + 0.016 * Math.sin(Math.PI * (i / N));
      const r = jacketSection(y)(a) * 1.02;
      pts.push(v3(Math.sin(a) * r, y, Math.cos(a) * r));
    }
    put(group, track(makeRoll(pts, J.thickness * 1.5)), materials.jacketDark, { name: 'collar' });
  }

  return { group, dispose() { for (const g of geos) g.dispose(); } };
}

// A tube swept along a polyline. Small enough to live here rather than in the
// vocabulary, and used only by the collar and the waistband.
function makeRoll(pts, r) {
  const out = [];
  const idx = [];
  const radial = 6;
  for (let j = 0; j < pts.length; j++) {
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
    const t = b.clone().sub(a).normalize();
    let s = new THREE.Vector3(0, 1, 0);
    if (Math.abs(t.dot(s)) > 0.9) s.set(1, 0, 0);
    const nx = new THREE.Vector3().crossVectors(t, s).normalize();
    const ny = new THREE.Vector3().crossVectors(t, nx).normalize();
    for (let i = 0; i < radial; i++) {
      const ang = 2 * Math.PI * (i / radial);
      out.push(pts[j].clone().addScaledVector(nx, Math.cos(ang) * r).addScaledVector(ny, Math.sin(ang) * r));
    }
  }
  const at = (i, j) => j * radial + ((i % radial) + radial) % radial;
  for (let j = 0; j < pts.length - 1; j++) {
    for (let i = 0; i < radial; i++) {
      idx.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(out.length * 3);
  out.forEach((p, k) => { arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z; });
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- the shorts ---------------------------------------------------------------

export function buildShortsTrunk({ materials }) {
  const group = new THREE.Group();       // lives in `frames.inRoot`: world heights
  const geos = [];
  const track = (g) => { geos.push(g); return g; };

  // The waistband and seat, on the hips. It stops above the crotch and the
  // two cuffs below it hang from the hip joints, so a swinging thigh takes its
  // own cloth with it instead of passing through a skirt.
  const bottom = M.y.hip - 0.020;
  const band = track(sheet2({
    uSteps: 30, vSteps: 8, closedU: true,
    point: (u, v) => {
      const a = 2 * Math.PI * u;
      const y = mix(S.top, bottom, v);
      const r = (trunkRadius(y, a) || M.torso.pelvisWidth / 2) + S.thickness * 0.75;
      return v3(Math.sin(a) * r, y, Math.cos(a) * r);
    },
    normalAt: (u) => { const a = 2 * Math.PI * u; return v3(Math.sin(a), 0, Math.cos(a)); },
    thickness: S.thickness,
    // One hole worn through the seat. POSTMORTEM: a hole in a rag with more rag
    // behind it is not a wound, so every hole has to have something to show --
    // this one shows the body.
    keep: (u, v) => Math.hypot((u - 0.52) / 0.055, (v - 0.55) / 0.22) > 1,
  }));
  put(group, band, materials.shorts, { name: 'shorts-band' });

  return { group, dispose() { for (const g of geos) g.dispose(); } };
}

// The cuff that hangs from one hip joint. Called by model.js so it can be
// parented to `hipL` / `hipR` rather than to the pelvis.
export function buildShortsCuff({ materials, side }) {
  const s = side === 'L' ? +1 : -1;
  const group = new THREE.Group();       // sits AT the hip joint
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const top = M.y.hip + 0.012 - M.y.hip;
  const hem = S.hem - M.y.hip;

  const cuff = track(sheet2({
    uSteps: 20, vSteps: 8, closedU: true,
    point: (u, v) => {
      const a = 2 * Math.PI * u;
      const y = mix(top, hem + tatterAt(u, 6, S.tatter * 1.5, s * 2.3), v);
      const t = (top - y) / Math.max(1e-6, top - hem);
      // Rounded at both ends. A straight-sided tube with flat ends puts two
      // sharp corners on the hip in silhouette, and two rectangles at the hips
      // is what the first clothed pass came back as.
      const round = Math.min(1, Math.sin(Math.min(1, t * 5.0) * Math.PI / 2), Math.sin(Math.min(1, (1 - t) * 4.0) * Math.PI / 2) * 0.16 + 0.84);
      const r = mix(M.leg.thighRadius * 1.10, M.leg.thighRadius * 1.04, t) * round;
      // follows the thigh's own outward bow
      const cx = s * M.leg.thighRadius * M.leg.bow * 3.2 * Math.sin(Math.PI * t * 0.5);
      return v3(cx + Math.cos(a) * r, y, Math.sin(a) * r);
    },
    normalAt: (u) => { const a = 2 * Math.PI * u; return v3(Math.cos(a), 0, Math.sin(a)); },
    thickness: S.thickness,
    // A hole on the LEFT thigh only, with a shard of bone put behind it below.
    keep: (u, v) => (side !== 'L') || Math.hypot((u - 0.10) / 0.07, (v - 0.62) / 0.20) > 1,
  }));
  put(group, cuff, materials.shorts, { name: 'shorts-cuff' });

  if (side === 'L') {
    // The something-to-show behind the hole: a shard of bone just under the
    // skin, so the opening reads as damage rather than as a missing polygon.
    const shard = track(ovoid(M.leg.thighRadius * 0.20, M.leg.thighRadius * 0.42, M.leg.thighRadius * 0.16, { uSteps: 8, vSteps: 6 }));
    const a = 2 * Math.PI * 0.10;
    const y = mix(top, hem, 0.62);
    const r = M.leg.thighRadius * 1.10;
    put(group, shard, materials.bone, { pos: v3(Math.cos(a) * r, y, Math.sin(a) * r), name: 'thigh-bone' });
  }

  return { group, dispose() { for (const g of geos) g.dispose(); } };
}
