import * as THREE from 'three';
import { registerStone, inkText, buildSlabGeometry } from '../tombstones.js';
import { Profile, createSink, sinkToGeometry, latheInto, transformRange } from '../fountain/lathe.js';

// The tree stump monument: the Victorian rustic marker, a stone cut to look
// like a sawn-off tree trunk, with soft bark, three lopped branch stubs and a
// tablet fixed to the front carrying the inscription.
//
// The joke only works if it is stone. It is PALETTE.stone like everything else,
// it is smooth vinyl rather than shaggy, and the bark is a slow ripple round the
// trunk, not a crack pattern. A brown, barky, cracked version of this is a tree,
// and a tree is not a headstone.
//
// The postmortem's rule is that the silhouette carries the identity, so the
// three decisions that matter are all silhouette:
//
//   1. It is a CYLINDER with a FLAT TOP. Everything else in the set is a slab
//      with an arch on it. From across the room this reads as "round thing,
//      sawn off", which no other stone in the set can be confused with.
//   2. The stubs break the outline. Two big ones on opposite sides at different
//      heights and a small one out of the back, each pointing up and out, so
//      the outline has horns from every angle: a bare drum turned to a bare
//      drum whichever way you walk round it.
//   3. It flares into the ground. The foot swells out into five soft root lobes
//      and a rolled pad, which is what says "grown" rather than "bollard", and
//      is also this stone's plinth.
//
// Construction: the trunk, the three stubs and the four nail heads are one
// lathe surface each, appended into one sink from fountain/lathe.js, so the
// whole rustic half of the piece is a single draw call. The tablet is the
// registry's own swept slab, built a second time at tablet size, which is what
// gets it the family's rounded rim and, through slabUV, the family's engraving
// treatment on a flat frontal face.
//
// The registry's own slab and plinth are built as always and end up INSIDE the
// trunk, unseen. That is deliberate and it is the price of the brief: the
// inscription has to live on the tablet, the tablet has to stand proud of a
// round trunk, and a slab centred on the trunk's axis can never do that -- a
// slab's face is at depth/2 from the axis and the trunk's surface is at its
// radius, which is always further out. So the slab is used for what it is
// uniquely good for, the carved texture atlas, and the tablet borrows the atlas
// through slabUV. The die is sized to the tablet exactly, so the face region has
// the tablet's aspect and the mapping is the identity.

// --- the trunk -------------------------------------------------------------

const TOP = 1.300;      // the sawn face, before the saw's tilt is added
const R_TOP = 0.248;    // trunk radius where the rim starts to roll over
const SEG = 72;         // angular steps: six per ripple of the finest bark band
const BARK = 0.031;     // ripple amplitude on the radius
const ROOTS = 0.062;    // how far the root lobes swell past the trunk
const SAW = 0.052;      // rise of the sawn face from its low side to its high

// The tablet, and therefore the hidden die: same half-width and height, so
// slabUV maps the tablet's face onto the carved region one to one.
const PL_HW = 0.170;
const PL_H = 0.280;
const PL_D = 0.155;     // must clear 2 * edge (0.124) or the swept rim folds
const PL_Y = 0.615;     // its foot, a shade under half way up the trunk
const PL_PROUD = 0.030; // how far its face stands off the dressed bark

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Bark: three sinusoids in theta, all at integer frequencies so the surface
// closes, with the phase of each drifting slowly in y so the ridges wander up
// the trunk instead of running dead straight like fluting. This is the one
// place in the set that wants texture, and even here it is a ripple: the
// amplitude is a tenth of the radius spread over six broad ridges, which at
// scene scale is a soft corduroy down the silhouette rather than anything you
// could call a crack. Half this and it vanished at 300 px; twice it, and the
// trunk starts to look shaggy, which is a tree and not a headstone.
function bark(theta, y, ph) {
  return (
    0.58 * Math.sin(6 * theta + 1.8 * y + ph[0]) +
    0.30 * Math.sin(10 * theta - 2.5 * y + ph[1]) +
    0.20 * Math.sin(13 * theta + 1.1 * y + ph[2])
  );
}

// Five root lobes. Raised to a power so the swellings are broad and the gaps
// between them narrow, which is how a buttressed foot looks; and it is purely
// additive, never negative, because the registry's plinth is hidden inside this
// flare and a lobe that dug inward would let a corner of it out.
function rootLobes(theta, y, ph) {
  const lobe = Math.pow(0.5 + 0.5 * Math.cos(5 * theta + ph[3]), 2.0);
  // Each root dies out at its own height, so the foot is five swellings of
  // different lengths rather than one bell-shaped skirt.
  const reach = 0.26 + 0.13 * Math.cos(5 * theta + ph[3] + 0.6);
  return lobe * (1 - smoothstep(0.02, reach, y));
}

// The dressed patch the tablet is fixed to. Bark is planed off it and the
// surface dishes a hair, so the tablet sits in a shallow seat instead of
// hovering over a ripple that pokes through its face.
function seat(theta, y, phi) {
  const d = Math.atan2(Math.sin(theta - phi), Math.cos(theta - phi));
  const across = 1 - smoothstep(0.44, 0.92, Math.abs(d));
  const along = smoothstep(PL_Y - 0.16, PL_Y - 0.02, y) * (1 - smoothstep(PL_Y + PL_H + 0.02, PL_Y + PL_H + 0.16, y));
  return across * along;
}

function trunkProfile() {
  const P = new Profile();
  P.setTag('foot');
  // Starts below the ground and well outside the hidden plinth: this disc is
  // never seen, it is only there to close the surface.
  P.moveTo(0, -0.07);
  P.lineTo(0.300, -0.07, 3);
  // The pad the roots spread onto, rolled over at its edge like every other
  // rim in this set. It is SHORT: run up half the stone, as it was first, the
  // flare stops reading as roots and the stump comes out a bell.
  P.curve([[0.344, -0.022], [0.348, 0.030], [0.330, 0.076]], 8);
  P.setTag('flare');
  P.curve([[0.300, 0.126], [0.274, 0.205], [0.266, 0.300]], 9);
  P.setTag('trunk');
  // Barely any taper. A trunk that narrows visibly reads as a candle; what
  // makes this one read as a trunk is the flare at the bottom, not the cone.
  P.lineTo(0.262, 0.62, 6);
  P.lineTo(0.255, 0.95, 6);
  P.lineTo(R_TOP, 1.242, 5);
  P.setTag('rim');
  // Over the lip of the cut on a tight roll. Rolled generously the top domes
  // and the stump reads as a candle burned down; the eye wants an edge round a
  // sawn face even when the edge is soft.
  P.curve([[0.246, 1.258], [0.240, 1.274], [0.224, 1.287]], 6);
  P.setTag('cut');
  // The face, rising a hair to the middle. A face that keeps falling to the
  // axis ends in a pole whose normal latheInto turns over against the ring
  // below it, and that is a black pinhole in the middle of the most visible
  // surface on the stone.
  // Sampled finely across the face, not because the profile needs it -- it is
  // nearly a straight line -- but because the growth rings are a ripple in r
  // and a ring the rows step over is a ring that aliases away to nothing.
  P.curve([[0.168, 1.2965], [0.088, 1.2995]], 14);
  P.lineTo(0, TOP, 4);
  return P.build();
}

// r at a given height, read off the built profile. Used to seat the stubs on
// the surface rather than guessing where it is.
function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if ((y >= a.y && y <= b.y) || (y >= b.y && y <= a.y)) {
      const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return R_TOP;
}

// --- the branch stubs ------------------------------------------------------
//
// One profile, three sizes. The swelling at the collar is the whole point: a
// branch leaves a trunk through a bulge, and without it a stub is a dowel
// pushed into a hole. The base disc is authored well behind the collar so it
// sits inside the trunk -- landed flush on the surface, two coincident skins
// draw a black ring round the joint.
function stubProfile(len, r0, r1) {
  const P = new Profile();
  P.setTag('collar');
  P.moveTo(0, -0.16);
  P.lineTo(r0 * 0.88, -0.16, 2);
  // Widest right where it leaves the trunk, then falling away fast: a lopped
  // branch is a cone with a swollen collar, and it was the missing collar that
  // made the first pass read as three dowels pushed into a barrel.
  P.curve([[r0 * 1.04, 0.015], [r0 * 0.74, len * 0.38]], 8);
  P.setTag('branch');
  P.lineTo(r1, len * 0.88, 5);
  P.setTag('cut');
  P.curve([[r1 * 0.95, len * 0.945], [r1 * 0.78, len]], 5);
  P.curve([[r1 * 0.42, len * 1.014]], 4);
  P.lineTo(0, len * 1.02, 2);
  return P.build();
}

// theta is the lathe's own angle, so the tablet's face at +z is theta = PI/2.
// Two big stubs to either side of it at different heights, and a small one out
// of the back: turned a quarter, this piece must never present a bare drum.
const STUBS = [
  { theta: 2.95, y: 0.895, tilt: 0.74, len: 0.235, r0: 0.116, r1: 0.062, seg: 26 },
  { theta: -0.35, y: 0.500, tilt: 0.58, len: 0.195, r0: 0.098, r1: 0.055, seg: 24 },
  { theta: 4.46, y: 1.115, tilt: 0.92, len: 0.130, r0: 0.074, r1: 0.046, seg: 20 },
];

// A nail head: a squat dome on a buried base disc.
function nailProfile(r) {
  const P = new Profile();
  P.moveTo(0, -0.010);
  P.lineTo(r, -0.010, 2);
  P.arc(0, -0.010, r, 0, Math.PI / 2, 6);
  return P.build();
}

// ---------------------------------------------------------------------------

function buildStump({ body, material, rng, edge, disposables, stripUV, slabUV }) {
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const sawPhi = Math.PI * 1.15 + rng() * 0.5; // the cut falls away towards the back
  const front = Math.PI / 2;

  const sink = createSink();
  // Every lathe appended here gets its UVs rewritten at the end, so each range
  // records where it started and how wide its grid is.
  const ranges = [];
  const openRange = (segments) => ranges.push({ start: sink.pos.length / 3, cols: segments + 1 });

  // --- trunk ---------------------------------------------------------------
  const profile = trunkProfile();
  openRange(SEG);
  latheInto(sink, {
    profile,
    segments: SEG,
    uRepeat: 1,
    minRadius: 0.07,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      if (s.tag !== 'cut') {
        // Bark everywhere but the sawn face, fading out under the tablet and
        // dying away as the surface turns over the rim.
        const planed = 1 - 0.9 * seat(theta, s.y, front);
        const up = 1 - smoothstep(1.10, 1.21, s.y);
        dr += BARK * bark(theta, s.y, ph) * planed * up;
        dr += ROOTS * rootLobes(theta, s.y, ph);
        dr -= 0.010 * seat(theta, s.y, front);
      } else {
        // Growth rings. A field written in polar coordinates pinwheels about
        // its centre, which is exactly wrong on a broken face and exactly right
        // here: rings ARE concentric, so this is the one place the singularity
        // at the axis is the shape rather than an artefact. Eased off at the
        // middle all the same, so the little mound that keeps the pole's normal
        // pointing up is not fighting a ripple.
        dy += 0.0105 * Math.sin(92 * s.r + ph[4])
          * smoothstep(0, 0.22, s.r / R_TOP) * (1 - smoothstep(0.78, 1.0, s.r / R_TOP));
      }
      // The saw's tilt. Scaled by height so it ramps in across the trunk/rim
      // joint rather than folding the surface where it starts, and by radius so
      // that across the face itself the lift falls to nothing at the centre and
      // the cut comes out a tilted plane instead of a warped saddle.
      dy += SAW * Math.cos(theta - sawPhi) * Math.min(smoothstep(TOP - 0.34, TOP - 0.03, s.y), s.r / R_TOP);
      return [dr, dy];
    },
  });

  // --- branch stubs --------------------------------------------------------
  for (let i = 0; i < STUBS.length; i++) {
    const b = STUBS[i];
    const start = sink.pos.length;
    openRange(b.seg);
    latheInto(sink, {
      profile: stubProfile(b.len, b.r0, b.r1),
      segments: b.seg,
      uRepeat: 1,
      minRadius: 0.05,
      displace: (s, theta) => {
        if (s.tag === 'cut') return [0, 0];
        // The same ripple language as the trunk at a sixth of the depth: a stub
        // is small enough that anything more reads as a knot. Faded in along
        // the collar so it cannot start as a notch on the ring that leaves the
        // trunk.
        const t = s.tag === 'collar' ? smoothstep(0.2, 0.7, s.u) : 1;
        return [0.0045 * Math.sin(6 * theta + ph[i]) * t, 0];
      },
    });
    const dir = new THREE.Vector3(
      Math.cos(b.theta) * Math.cos(b.tilt),
      Math.sin(b.tilt),
      Math.sin(b.theta) * Math.cos(b.tilt),
    );
    // Seated a little inside the surface: the collar's swelling has to come out
    // OF the trunk, not sit on it.
    const r = radiusAt(profile, b.y) - 0.05;
    transformRange(sink, start, new THREE.Matrix4().compose(
      new THREE.Vector3(r * Math.cos(b.theta), b.y, r * Math.sin(b.theta)),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir),
      new THREE.Vector3(1, 1, 1),
    ));
  }

  // --- the tablet ----------------------------------------------------------
  //
  // Built with the registry's own slab sweep, at the size of the hidden die, so
  // slabUV maps its front face onto the carved region exactly and its rim and
  // back land in the plain strip. Nothing here has to know how the atlas is
  // laid out.
  const seatR = radiusAt(profile, PL_Y + PL_H / 2) - 0.010; // the dish under it
  const tabZ = seatR + PL_PROUD - PL_D / 2;
  const tabletGeo = buildSlabGeometry({
    halfWidth: PL_HW,
    height: PL_H,
    depth: PL_D,
    edge,
    // Nearly square corners. Rounded generously it came out a lozenge stuck to
    // the trunk; a tablet wants straight sides and the family's soft rim.
    bottomRadius: 0.055,
    topRadius: 0.055,
    uv: slabUV,
  });
  const tablet = new THREE.Mesh(tabletGeo, material);
  tablet.position.set(0, PL_Y, tabZ);
  tablet.castShadow = true;
  tablet.receiveShadow = true;
  body.add(tablet);
  disposables.push(tabletGeo);

  // --- the nails -----------------------------------------------------------
  //
  // Four heads on the flat of the tablet's face, inside the swept rim. Small
  // enough to be craft rather than a feature: at scene scale they are two
  // pixels of highlight each, and what they buy is the read that the tablet was
  // fixed on rather than grown out of the stone.
  const NAIL_R = 0.019;
  const nail = nailProfile(NAIL_R);
  const inset = edge + 0.030;
  for (const sx of [-1, 1]) {
    for (const sy of [0, 1]) {
      const start = sink.pos.length;
      openRange(14);
      latheInto(sink, { profile: nail, segments: 14, uRepeat: 1, minRadius: 0.02 });
      transformRange(sink, start, new THREE.Matrix4().compose(
        new THREE.Vector3(sx * (PL_HW - inset), PL_Y + (sy ? PL_H - inset : inset), tabZ + PL_D / 2 - 0.004),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)),
        new THREE.Vector3(1, 1, 1),
      ));
    }
  }

  // --- UVs -----------------------------------------------------------------
  //
  // latheInto lays out (angle, arc length), which would drag the trunk across
  // the carved region of the atlas. Rewritten here into the plain strip: u
  // wraps once round each piece, taking its discontinuity on the seam column
  // latheInto duplicates, and v climbs with the real height of the vertex so
  // the foot of the stump sits in the same grime the family's plinths do.
  for (let i = 0; i < ranges.length; i++) {
    const { start, cols } = ranges[i];
    const end = i + 1 < ranges.length ? ranges[i + 1].start : sink.pos.length / 3;
    for (let k = start; k < end; k++) {
      const [u, v] = stripUV(((k - start) % cols) / (cols - 1) - 0.5, 0.04 + 0.92 * clamp01(sink.pos[k * 3 + 1] / TOP), 0.5, 1);
      sink.uv[k * 2] = u;
      sink.uv[k * 2 + 1] = v;
    }
  }

  const geometry = sinkToGeometry(sink);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);
  disposables.push(geometry);
}

// ---------------------------------------------------------------------------

registerStone('stump', {
  // The die and its plinth are never seen: they live inside the trunk's flare.
  // Their job is the texture atlas, whose carved region takes its aspect from
  // 2 * halfWidth / height -- which is why these are the tablet's numbers.
  shape: { halfWidth: PL_HW, height: PL_H, depth: PL_D, plinth: 0.08 },
  topRadius: 0.062,
  bottomRadius: 0.062,

  // Two short lines on the tablet. Two, not three, and short ones: this face is
  // a third the width of the family's, so the same treatment at the same
  // texture proportions gives a physically finer groove, and the answer to that
  // is fewer, larger letters rather than a smaller mark.
  draw(ctx, w, h) {
    const size = h * 0.245;
    inkText(ctx, 'AT', w / 2, h * 0.345, size, size * 0.06);
    inkText(ctx, 'REST', w / 2, h * 0.675, size, size * 0.06);
  },

  extras: buildStump,
});
