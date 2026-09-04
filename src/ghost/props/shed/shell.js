import * as THREE from 'three';
import S from './metrics.js';

// THE DARK INSIDE.
//
// The brief calls out the trap and it is a real one, so here is the decision
// and the reasoning, once.
//
// A hollow box has two failure modes and they pull in opposite directions.
// Leave the inside as lit geometry and the scene's fill gets in: a
// HemisphereLight is not occluded by anything (three does not shadow it, and
// could not cheaply), so it lands on every inward-facing surface at full
// strength and the interior comes back the same value as the outside of the
// far wall. Paint the opening a flat dark instead and you get the other
// failure, which is worse: one even value across the whole doorway reads as a
// panel painted on the front of a solid block, and the shed stops being a
// building.
//
// What is built here is neither. It is a REAL cavity, a pentagonal prism
// following the gable section, standing 5mm inside the cladding's inner faces,
// drawn from the inside (side: BackSide, so the near wall is culled and the
// camera looks straight through the doorway into it). Two things make it work:
//
//   * MeshBasicMaterial. Unlit, so no amount of hemisphere, key or rim can
//     lift it, and the value in the vertex colour is the value on screen up to
//     the tone map. Nothing that gets added to the scene's lighting later can
//     blow the interior out, which a MeshStandardMaterial with a near-black
//     albedo could not promise.
//
//   * A baked gradient, and real depth behind it. The back wall at the top is
//     the darkest thing in the frame; the floor just inside the threshold is
//     three times lighter. That is the term that stops it reading as a painted
//     panel, because a painted panel has no reason to be lighter at the bottom
//     near the opening, and because the gradient's shape moves correctly as
//     the camera orbits: the far corner really is further away.
//
// The cavity does one more job, which is why it stands 5mm inside rather than
// flush. The cladding has open joints, and the eye follows daylight: without
// this, a gap between two boards would look through the shed and out the other
// side at the lit ground. With it, every gap looks into the dark, and the
// shed's own gaps become the strongest evidence that it is hollow.

export function createInteriorShell({ halfWidth, halfSpan, wallTop, apex }) {
  const back = new THREE.Color(S.interior.back);
  const side = new THREE.Color(S.interior.side);
  const floor = new THREE.Color(S.interior.floor);

  const hx = halfWidth;
  const hz = halfSpan;

  // The floor stands a hair off y = 0, and that is not tidiness. The scene's
  // ground is a plane at exactly y = 0, this floor was too, and with the two
  // coplanar the ground won the depth test (LEQUAL, and the ground is drawn
  // second): through the open door you saw lit grass where the room should be,
  // grid lines and all. Same fix as debris.js's CONTACT_BIAS, and for the same
  // reason.
  const FLOOR = 0.004;

  // The gable section, counter-clockwise seen from +X, so every face below is
  // wound outward and BackSide keeps exactly the ones facing into the room.
  const section = [
    [-hz, FLOOR],
    [hz, FLOOR],
    [hz, wallTop],
    [0, apex],
    [-hz, wallTop],
  ];

  const pos = [];
  const col = [];
  const c = new THREE.Color();

  // Darkness as a function of where a point is in the room. The doorway is in
  // +Z, so +Z is toward the light and -Z is the back of the shed; low is
  // lighter than high because the floor inside a doorway catches bounce and
  // the apex never does.
  const shade = (x, y, z, isFloor) => {
    const toDoor = (z + hz) / (2 * hz);
    const low = 1 - Math.min(1, y / apex);
    // Weighted toward the height term: standing in front of a shed you read
    // the dark as a column that gets blacker as it goes up, more than as
    // something that gets blacker as it goes back.
    let t = 0.40 * toDoor + 0.60 * low * low;
    // The far corners stay black whatever the height says.
    t *= 0.55 + 0.45 * toDoor;
    c.copy(back).lerp(side, Math.min(1, Math.pow(t, 1.25)));
    if (isFloor) c.lerp(floor, 0.35 + 0.65 * toDoor);
    return c;
  };

  const push = (x, y, z, isFloor) => {
    pos.push(x, y, z);
    const s = shade(x, y, z, isFloor);
    col.push(s.r, s.g, s.b);
  };

  const tri = (a, b, cc, isFloor = false) => {
    push(a[0], a[1], a[2], isFloor);
    push(b[0], b[1], b[2], isFloor);
    push(cc[0], cc[1], cc[2], isFloor);
  };

  // The five long faces of the prism.
  for (let i = 0; i < section.length; i++) {
    const [z0, y0] = section[i];
    const [z1, y1] = section[(i + 1) % section.length];
    const isFloor = i === 0; // the -Z to +Z run along y = 0
    const a = [-hx, y0, z0];
    const b = [hx, y0, z0];
    const d = [hx, y1, z1];
    const e = [-hx, y1, z1];
    tri(a, b, d, isFloor);
    tri(a, d, e, isFloor);
  }

  // The two gable ends, fanned from the first section point.
  for (const [x, flip] of [[hx, false], [-hx, true]]) {
    for (let i = 1; i < section.length - 1; i++) {
      const p0 = [x, section[0][1], section[0][0]];
      const p1 = [x, section[i][1], section[i][0]];
      const p2 = [x, section[i + 1][1], section[i + 1][0]];
      if (flip) tri(p0, p2, p1); else tri(p0, p1, p2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    // Flat shading is not a thing on an unlit material; the faces are separate
    // triangles with their own colours, so the corners of the room are hard
    // edges in the gradient, which is what a corner is.
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'shedInterior';
  // It is inside a closed box. Casting from it costs a shadow map pass on
  // geometry nothing can see, and receiving is meaningless on an unlit
  // material.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Drawn before the cladding, so the opaque boards in front of it win the
  // depth test the cheap way round on tiled hardware.
  mesh.renderOrder = -1;

  return {
    mesh,
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

export default createInteriorShell;
