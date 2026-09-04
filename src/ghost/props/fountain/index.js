import * as THREE from 'three';
import { marbleTextures, marbleMaterial, mulberry32 } from './marble.js';
import {
  buildBodyGeometry, findSpout, flightTime, poolEdge,
  TIERS, GRAVITY, BOWL_LOBES, DISH_LOBES,
} from './body.js';
import { createWater } from './water.js';

export { createBrokenColumn, createFallenDrum, createMarbleChips } from './rubble.js';

// A three-tier marble fountain with water running through it, for the
// graveyard set. Same contract as every other prop here: a group, an update,
// and a dispose.
//
// The stone is one lathe, see body.js, and the water is two meshes, see
// water.js: three draw calls in total. The broken marble the reference shows
// around the foot of the fountain is deliberately NOT part of this. It lives in
// rubble.js as three separate pieces so a scene can scatter them where it
// wants, rather than inherit a fixed arrangement welded to the fountain.

// Where the water leaves each lip, and how fast. Exit speed is small: the
// strands should be pulled out of the bowl by gravity rather than fired, and it
// is the ratio between this and the speed on landing that does all the work in
// water.js. The small outward drift is what keeps a strand clear of the bowl it
// just left instead of running back down its underside.
const SPILL = { speed: 0.42, out: 0.055 };

// How far past the surface a strand is flown before it stops. The flight time
// is SOLVED to the receiving pool's own height, so a strand always arrives; the
// pierce is what stops it arriving on its very last ring, which is the one ring
// whose width the shader has no room left to control. Deep enough now that the
// widened foot straddles the waterline and the tip itself is under the water,
// where the pool's own depth buffer hides it.
const PIERCE = 0.030;
const JETS = { at: -Math.PI / 4, count: 2, r: 0.052, y: 1.792, up: 0.38, out: 0.26 };

function strandsFor({ profile, displace, rng, tag, count, phase, target, halfWidth, aspect, dropBelowLip }) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const theta = phase + (k / count) * Math.PI * 2;
    const lip = findSpout(profile, displace, tag, theta);
    // Water running over a rounded lip clings and lets go underneath it, not at
    // the widest point, so the strand starts a little below where the stone is
    // furthest out.
    const y = lip.y - dropBelowLip;
    const speed = SPILL.speed * (0.93 + rng() * 0.14);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const tau = flightTime(y, -speed, target.y - PIERCE);
    out.push({
      origin: new THREE.Vector3(lip.r * cos, y, lip.r * sin),
      vel: new THREE.Vector3(SPILL.out * cos, -speed, SPILL.out * sin),
      // Perpendicular to the plane the strand falls in, which is the axis the
      // ribbon's wide direction lies along. water.js re-squares it against the
      // flow, so it only has to be roughly right.
      side: new THREE.Vector3(-sin, 0, cos),
      tau,
      // Seeded jitter on the thickness and the phase only. Jittering the flight
      // time would land the strand off the water.
      halfWidth: halfWidth * (0.88 + rng() * 0.24),
      seed: rng() * 3.0,
      aspect,
      landing: lip.r + SPILL.out * tau,
    });
  }
  return out;
}

export function createFountain({ seed = 1, scale = 1 } = {}) {
  const rng = mulberry32(seed * 2654435761 + 331);
  const group = new THREE.Group();

  // --- stone ---------------------------------------------------------------
  const tex = marbleTextures(seed);
  const stoneMat = marbleMaterial(tex);
  const { geometry, profile, displace } = buildBodyGeometry();
  const stone = new THREE.Mesh(geometry, stoneMat);
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  // --- falling water -------------------------------------------------------
  // Nine strands off the middle bowl and eight off the top dish, one per
  // scallop, because the scallops are what makes a rim shed discrete strands
  // instead of a continuous curtain. The reference asks for eight to ten.
  const bowlStrands = strandsFor({
    profile, displace, rng,
    tag: 'bowl-rim', count: BOWL_LOBES, phase: 0,
    target: TIERS.basin, halfWidth: 0.0310, aspect: 1.90, dropBelowLip: 0.009,
  });
  const dishStrands = strandsFor({
    profile, displace, rng,
    tag: 'dish-rim', count: DISH_LOBES, phase: 0,
    target: TIERS.bowl, halfWidth: 0.0245, aspect: 1.85, dropBelowLip: 0.006,
  });

  // The finial throws two arcs sideways into the top dish. Same shader as a
  // falling strand: a jet is only a strand whose initial velocity happens to
  // point up and out, and the ballistic solve does not care which.
  const jets = [];
  for (let k = 0; k < JETS.count; k++) {
    const theta = JETS.at + (k / JETS.count) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const tau = flightTime(JETS.y, JETS.up, TIERS.dish.y - PIERCE);
    jets.push({
      origin: new THREE.Vector3(JETS.r * cos, JETS.y, JETS.r * sin),
      vel: new THREE.Vector3(JETS.out * cos, JETS.up, JETS.out * sin),
      side: new THREE.Vector3(-sin, 0, cos),
      tau,
      halfWidth: 0.0122,
      seed: rng() * 3.0,
      // A jet leaves a hole rather than a lip, so it starts nearly round.
      aspect: 1.12,
      landing: JETS.r + JETS.out * tau,
    });
  }

  const mean = (list) => list.reduce((a, s) => a + s.landing, 0) / list.length;

  const water = createWater({
    strands: [...bowlStrands, ...dishStrands, ...jets],
    pools: [
      {
        y: TIERS.basin.y, edge: poolEdge(profile, displace, 'basin-in', TIERS.basin.y), angular: 48, radial: 18,
        impactRadius: mean(bowlStrands), impactCount: BOWL_LOBES, impactPhase: 0, amp: 0.0105,
      },
      {
        y: TIERS.bowl.y, edge: poolEdge(profile, displace, 'bowl-in', TIERS.bowl.y), angular: 40, radial: 11,
        impactRadius: mean(dishStrands), impactCount: DISH_LOBES, impactPhase: 0, amp: 0.0072,
      },
      {
        y: TIERS.dish.y, edge: poolEdge(profile, displace, 'dish-in', TIERS.dish.y), angular: 30, radial: 8,
        impactRadius: mean(jets), impactCount: JETS.count, impactPhase: JETS.at, amp: 0.0044,
      },
    ],
  });
  water.uniforms.uG.value = GRAVITY;
  group.add(water.group);

  group.scale.setScalar(scale);

  // No painted contact patch under the plinth. The headstones tried one and it
  // was rejected for ringing the prop with an even shadow on the lit side as
  // well as the shaded one; a fountain sitting on a broad flat plinth has even
  // less need of it than a headstone did, because the key light's own shadow
  // reaches all the way to the silhouette.

  return {
    group,
    update(time) {
      water.update(time);
    },
    dispose() {
      geometry.dispose();
      stoneMat.dispose();
      if (tex) {
        tex.map.dispose();
        tex.normalMap.dispose();
      }
      water.dispose();
    },
  };
}
