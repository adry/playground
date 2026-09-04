import * as THREE from 'three';
import { SEGMENTS } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// An open scroll: a low, wide slab read as a sheet of parchment part unrolled,
// with a fat roll lying along each vertical edge.
//
// This is the one stone in the set that is wider than it is tall, and that is
// the whole of its identity. The rest of the family is tall, narrow and arched,
// so a wide horizontal bar with two vertical bolsters on it is legible as a
// different stone from any distance, with no help from the mark. Everything
// else stays deliberately stock: the same swept slab, the same flat frontal
// face, the same engraving treatment, the same plinth.
//
// The top is squared off (topRadius well under the half width) because a sheet
// of parchment has a straight top edge. An arch here would have fought the
// rolls, which are the only curvature the silhouette wants.

const HALF_WIDTH = 0.73; // 1.46 across, against 1.00 for the widest of the three
const HEIGHT = 0.76;     // 0.93 standing, so it sits below fred's 1.10
const DEPTH = 0.20;      // a sheet, thinner than the family's 0.25 to 0.32
const PLINTH = 0.17;

// The roll. Fatter than the sheet is thick, which is what makes it read as
// rolled rather than as a bead moulded onto the edge: its diameter is 0.31
// against the slab's 0.20, and it is pushed forward so the bulge is on the
// side the light and the camera are on.
const ROLL_R = 0.155;
const ROLL_Z = 0.05;
// Centre placed so the roll's outer flank lands a hair outboard of the slab's
// silhouette. The slab's own rounded edge then disappears behind it and the
// sheet looks like it comes out from under the roll rather than butting it.
const ROLL_X = HALF_WIDTH - ROLL_R + 0.02;
// Only a little longer than the sheet. Tried at +0.15 and the two capsules
// stood up past the top edge like gateposts and stopped reading as a scroll
// at all: the roll wants to end almost level with the sheet, with just enough
// dome showing to say the edge is round. The bottom overrun buries itself in
// the plinth, which is what seats it.
const ROLL_SPAN = HEIGHT + 0.08;
const ROLL_LIFT = 0.005;

// The face texture is a face-aspect region on the left plus a narrow plain
// strip on the right that every non-front surface samples. `extras` is not
// handed the mapping, so it is rebuilt here from the map's own pixel size: the
// face region is exactly (2 * halfWidth / height) as wide as it is tall, and
// the remainder of the image is strip. Without this the capsule's own
// cylindrical UVs would wrap the inscription around the rolls.
function stripUVs(geo, material, { halfWidth, height, yOffset }) {
  const img = material.map?.image;
  if (!img?.width) return; // headless: no textures were built, nothing to fix
  const faceW = Math.round(img.height * ((2 * halfWidth) / height));
  const frontFrac = faceW / img.width;
  const stripFrac = 1 - frontFrac;
  if (stripFrac <= 0) return;

  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    // Angle around the roll rather than the capsule's own u, so the seam sits
    // where the geometry's seam already is and the mottling does not mirror.
    const a = Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 0.5;
    // Inset from both ends of the strip: filtering must never be able to drag
    // a letter off the face region and onto a roll.
    uv.setXY(
      i,
      frontFrac + stripFrac * (0.18 + 0.64 * a),
      Math.min(1, Math.max(0, (pos.getY(i) + yOffset) / height)),
    );
  }
  uv.needsUpdate = true;
}

registerStone('scroll', {
  shape: { halfWidth: HALF_WIDTH, height: HEIGHT, depth: DEPTH, plinth: PLINTH },
  // Nearly square corners, only enough radius to stay vinyl.
  topRadius: 0.075,

  // Three short lines, sized and spaced off the set's own numbers rather than
  // off the face, because the face is half again as wide as any other and
  // filling it is exactly how the rejected set reached 19% ink. Line length is
  // held near half the panel that shows between the rolls, so the widest line
  // is no longer across the stone than fred's is across fred.
  //
  // Measured, alpha-weighted, against the 1967 x 1024 face: 3.7% ink, which is
  // the approved cross's 3.7% and under fred's 6.4%. Against the panel that
  // actually shows between the rolls, which is 60% of the face, it is 6.1%.
  // Ink bounding box 36% of the face wide by 56% tall.
  draw(ctx, w, h) {
    const lines = ['REST', 'IN', 'PEACE'];
    const size = h * 0.195;
    lines.forEach((line, i) =>
      inkText(ctx, line, w / 2, h * (0.487 + (i - 1) * 0.213), size, size * 0.05),
    );
  },

  extras({ body, material, plinthH, height }) {
    // Capsules, not tubes or lathes: both of those come back open at the ends,
    // which this repo has been caught by twice. A capsule is closed by
    // construction and its hemispherical caps are the soft ends the house
    // style wants anyway.
    const geo = new THREE.CapsuleGeometry(
      ROLL_R,
      ROLL_SPAN - 2 * ROLL_R,
      Math.max(6, Math.round(SEGMENTS.curve * 0.5)),
      SEGMENTS.radial,
      1,
    );
    // Capsule local y is centred on the roll; the slab's texture v is measured
    // from the slab's own base, and the roll's centre is half a slab up from it.
    stripUVs(geo, material, { halfWidth: HALF_WIDTH, height, yOffset: height / 2 + ROLL_LIFT });

    for (const sx of [-1, 1]) {
      const roll = new THREE.Mesh(geo, material);
      roll.position.set(sx * ROLL_X, plinthH + height / 2 + ROLL_LIFT, ROLL_Z);
      roll.castShadow = true;
      roll.receiveShadow = true;
      body.add(roll);
    }
  },
});
