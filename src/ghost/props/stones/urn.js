import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';
import { Profile, createSink, sinkToGeometry, latheInto, roundedBoxInto, transformRange } from '../fountain/lathe.js';

// A draped funerary urn on a squarish pedestal.
//
// The identity is the urn, not the mark: a narrow upright block, a cornice, and
// on top a lidded vessel with a finial and a cloth thrown over one side. That
// silhouette says "grave" from across the yard with no texture at all, which is
// the lesson .ref/STONES-POSTMORTEM.md paid for. The pedestal is therefore the
// set's own slab with the arch squared off, and it carries one small quiet
// inscription and nothing else: no mouldings, no panel outlines, no border.
//
// The urn is ONE lathe of ONE profile, run from the axis under the foot up to
// the axis at the tip of the finial, using the fountain's lathe.js rather than
// a second copy of it. That buys the thing that matters here: normals taken by
// central differences off the grid that actually got built, so the drape, which
// is an angular displacement and not a separate mesh, cannot shade differently
// from the shape it made.

// ---------------------------------------------------------------------------
// the vessel
//
// Numbers are urn-local, y up from the underside of the foot. The whole piece
// is 0.545 tall and 0.166 at the belly, so it reads as a vessel a person could
// carry, standing on a pedestal twice its height.

function urnProfile() {
  const P = new Profile();
  // Foot: a low rounded disc, both its corners rolled, so nothing on the piece
  // is an edge.
  P.setTag('foot');
  P.moveTo(0, 0);
  P.lineTo(0.085, 0, 5);
  P.arc(0.085, 0.022, 0.022, -Math.PI / 2, 0, 7);
  P.lineTo(0.107, 0.038, 2);
  P.arc(0.085, 0.038, 0.022, 0, Math.PI / 2, 7);
  // Stem: the waist between foot and belly. Short, because a tall one turns the
  // urn into a goblet.
  P.setTag('stem');
  P.curve([[0.062, 0.072], [0.056, 0.092]], 8);
  // Body: out to the belly a little under half way up, which is where a real
  // cinerary urn carries its widest point.
  P.setTag('body');
  P.curve([[0.086, 0.112], [0.130, 0.148], [0.160, 0.190], [0.166, 0.222]], 22);
  P.setTag('shoulder');
  P.curve([[0.160, 0.262], [0.136, 0.300], [0.110, 0.334], [0.100, 0.356]], 22);
  P.setTag('neck');
  P.lineTo(0.099, 0.372, 3);
  // Rim: a flare out to a lip that rolls right over, so the lid sits in a hollow
  // and the top of the urn has a real shadow line under it.
  P.setTag('rim');
  P.curve([[0.113, 0.384], [0.1263, 0.3902]], 7);
  P.arc(0.110, 0.398, 0.018, -0.45, 2.5, 12);
  // Lid: a shallow dome, then the waist and bud of the finial. The finial is the
  // one small high-contrast feature at the top and it is what stops the urn
  // reading as an egg when it gets small.
  P.setTag('lid');
  P.curve([[0.086, 0.424], [0.068, 0.444], [0.044, 0.459], [0.0249, 0.4737]], 16);
  P.setTag('finial');
  P.arc(0, 0.505, 0.040, -0.90, Math.PI / 2, 14);
  return P.build();
}

const URN_SCALE = 1.18;

// ---------------------------------------------------------------------------
// the drape
//
// Cloth on a vinyl toy is a few soft folds and a rolled hem, not a simulation.
// So the drape is not a sheet: it is the difference between the urn and a
// second, fuller outline hung outside it. Where the urn's neck pinches in, that
// difference is thick, which is exactly how real cloth behaves, it bridges the
// hollow instead of following it. Where the belly swells out, the difference
// thins to a skin. One outline drives both.
//
// (r, y) knots of that outer outline. Above the last knot there is no cloth.
// The cloth is hung from under the lip and stops on the belly. Over the lid it
// only turned the lid into a melted blob, and the lid and finial are the two
// features that say "urn" rather than "pot", so they stay bare.
const CLOAK = [
  [0.215, 0.212],
  [0.260, 0.216],
  [0.300, 0.206],
  [0.335, 0.188],
  [0.362, 0.164],
  [0.386, 0.142],
  [0.398, 0.128], // the rim's own widest point, so the cloth ends at zero here
];

const DRAPE = {
  arcPos: 1.06,   // how far the cloth wraps one way, radians
  arcNeg: 0.92,   // and the other. Uneven on purpose: a hand-thrown cloth is.
  folds: 3,       // ridges across the whole span
  foldDepth: 0.24,
  // Where the hem sits. It is written as a TUCK LINE up on the shoulder and a
  // fall below it, and the fall is scaled by the same fade that thins the cloth
  // at its ends. Written the other way round -- a hem height with a tilt added
  // -- the cloth's two ends finished low on the belly exactly where the fade was
  // taking their thickness to nothing, and a hanging edge with no thickness left
  // in it pinched into a spiky wing with creases in it. Tied to the fade, the
  // ends always tuck back up under the shoulder and there is nothing to pinch.
  tuck: 0.345,
  fall: 0.055,
  hemWave: 0.020, // ridges hang lower than the hollows between them. Small: at
                  // the amplitude that looks right up close, three scallops
                  // across the front read from a distance as a painted zigzag.
  hemTilt: 0.055, // and the whole hem falls further on one side than the other
  // The free edge of the cloth. Not a ramp and not a cliff: both were tried and
  // both failed, the ramp as a smudge and the cliff as a crack in the pot with
  // a hard black line down it. A real hem is a roll, so the cloth swells past
  // its own thickness just inside the edge and settles back, and it is that
  // bead catching the key light above its own shadow that says "cloth".
  roll: 0.045,
  bead: 0.24,
  // The one corner of cloth that hangs free, down past the belly and over the
  // stem. This is the feature that makes the piece read as draped rather than
  // as a pot with a lumpy shoulder: it is the only place the cloth's edge
  // crosses the urn's own silhouette instead of running along it.
  tailAt: -0.45,
  tailWidth: 0.30,
  tailDrop: 0.085,
  // Cloth is never thinner than this where it exists at all, so the hanging
  // corner keeps its body once it is past the belly and the hull runs out.
  floor: 0.050,
};

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function cloakRadius(y) {
  if (y >= CLOAK[CLOAK.length - 1][0]) return 0;
  if (y <= CLOAK[0][0]) return 0;
  for (let i = 1; i < CLOAK.length; i++) {
    if (y <= CLOAK[i][0]) {
      const [y0, r0] = CLOAK[i - 1];
      const [y1, r1] = CLOAK[i];
      return r0 + (r1 - r0) * smooth((y - y0) / (y1 - y0));
    }
  }
  return 0;
}

// Cloth thickness per profile sample, before any angular shaping. Smoothed
// along the profile afterwards because the knot table is piecewise and a kink
// in thickness is a crease in the finished surface.
function clothThickness(profile) {
  const t = profile.map((p) => {
    const hull = cloakRadius(p.y);
    const floor = DRAPE.floor * smooth((p.y - 0.050) / 0.050) * (1 - smooth((p.y - 0.300) / 0.060));
    return Math.max(hull > 0 ? hull - p.r : 0, floor);
  });
  for (let pass = 0; pass < 3; pass++) {
    const src = t.slice();
    for (let i = 0; i < t.length; i++) {
      const a = src[Math.max(0, i - 1)];
      const b = src[i];
      const c = src[Math.min(t.length - 1, i + 1)];
      t[i] = (a + 2 * b + c) / 4;
    }
  }
  return t;
}

function drapeDisplacer(profile, centre) {
  const thickness = clothThickness(profile);
  const index = new Map();
  profile.forEach((p, i) => index.set(p, i));

  return (sample, theta) => {
    const t = thickness[index.get(sample)];
    if (!t) return [0, 0];

    // Signed angle from the middle of the cloth, normalised so the two sides
    // can wrap by different amounts and still share one fold pattern.
    let a = theta - centre;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const q = a / (a >= 0 ? DRAPE.arcPos : DRAPE.arcNeg);
    if (q <= -1 || q >= 1) return [0, 0];

    // The cloth's thickness across its span, a bell rather than a plateau with
    // a fade at the sides. The fade version put a 0.1-unit drop in radius into
    // the four angular columns nearest each end, and a cliff that steep between
    // adjacent columns came out as a spiky flap with creases fanning off it. A
    // bell has no cliff anywhere and its slope goes to zero at both ends.
    const edge = Math.pow(0.5 + 0.5 * Math.cos(q * Math.PI), 0.7);
    const ridge = Math.cos(q * Math.PI * DRAPE.folds);

    const corner = Math.exp(-Math.pow((q - DRAPE.tailAt) / DRAPE.tailWidth, 2));
    const fall = DRAPE.fall + DRAPE.hemWave * ridge - DRAPE.hemTilt * q + DRAPE.tailDrop * corner;
    const hem = DRAPE.tuck - Math.max(0, fall) * edge;
    const above = sample.y - hem;
    if (above <= 0) return [0, 0];
    const f = above / DRAPE.roll;
    const rise = f >= 1 ? 1 : Math.sin((f * Math.PI) / 2);
    const bead = 1 + DRAPE.bead * Math.exp(-Math.pow((f - 1.15) / 0.85, 2));
    const lip = rise * bead;

    return [t * edge * lip * (1 + DRAPE.foldDepth * ridge), 0];
  };
}

// ---------------------------------------------------------------------------

registerStone('urn', {
  // Narrower than any slab in the set (0.54 wide against fred's 0.74) and
  // deeper than it is wide is not the point: 0.54 by 0.32 is squarish enough to
  // read as a pedestal rather than a plate. Pedestal plus cornice plus urn comes
  // to 1.51, which puts it with the tall pair rather than with fred.
  shape: { halfWidth: 0.27, height: 0.70, depth: 0.34, plinth: 0.16 },
  // Just above the slab's own edge radius, so the top squares off into a
  // pedestal instead of arching.
  topRadius: 0.085,

  // One quiet epitaph in the upper middle of blank stone. Three short lines
  // rather than two long ones: this face is narrow, and the only way to reach
  // the set's ink budget without a word running into the rounded side edge is
  // to stack it.
  draw(ctx, w, h) {
    const lines = ['REST', 'IN', 'PEACE'];
    const size = h * 0.145;
    lines.forEach((line, i) => inkText(ctx, line, w / 2, h * (0.40 + (i - 1) * 0.152), size, size * 0.05));
  },

  extras({ body, material, shape, rng, plinthH, halfWidth, edge, disposables, stripUV }) {
    const sink = createSink();
    const top = plinthH + shape.height;

    // Cornice. It answers the plinth at the foot, hides the roll of the slab's
    // top, and gives the urn something to stand on that is wider than it is.
    // Deliberately one soft slab and no more: a stack of mouldings here is what
    // sank the last set.
    const capH = 0.12;
    const capStart = sink.pos.length;
    roundedBoxInto(sink, {
      size: [2 * halfWidth + 0.09, capH, shape.depth + 0.09],
      radius: Math.min(0.042, edge * 0.7),
      segments: 6,
    });
    transformRange(sink, capStart, new THREE.Matrix4().makeTranslation(0, top, 0));

    const profile = urnProfile();
    // The drape faces the front quarter that the scene's camera sees, jittered
    // per stone so two urns in one yard are not the same cast.
    const centre = Math.PI * 0.5 - 1.05 + (rng() - 0.5) * 0.30;
    const urnStart = sink.pos.length;
    latheInto(sink, {
      profile,
      segments: 128,
      displace: drapeDisplacer(profile, centre),
    });
    // Scaled up as a whole and sunk a little into the cornice, so no seam opens
    // at the joint. The profile above is authored at unit size and this is the
    // one knob that says how much of the stone's height the vessel takes.
    transformRange(
      sink,
      urnStart,
      new THREE.Matrix4()
        .makeTranslation(0, top + capH / 2 - 0.010, 0)
        .multiply(new THREE.Matrix4().makeScale(URN_SCALE, URN_SCALE, URN_SCALE)),
    );

    // --- surface ------------------------------------------------------------
    //
    // A lathe's own UVs are a cylindrical wrap, which over the shared material
    // would drag the pedestal's inscription round the outside of the urn. Every
    // vertex is parked in the plain strip instead, with u swept round the piece
    // and v climbing it, so the cornice and the urn pick up the same slow
    // mottle as the slab and never a letter. v stays high in the strip: the
    // bottom of that map is the ground grime band, and this is the part of the
    // stone furthest from the ground.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < sink.pos.length; i += 3) {
      if (sink.pos[i] < lo) lo = sink.pos[i];
      if (sink.pos[i] > hi) hi = sink.pos[i];
    }
    const span = Math.max(1e-4, hi - lo);
    for (let i = 0, j = 0; i < sink.pos.length; i += 3, j += 2) {
      const x = sink.pos[i];
      const y = sink.pos[i + 1];
      const z = sink.pos[i + 2];
      const r = Math.hypot(x, z) || 1;
      const [u, v] = stripUV(x / r, 0.55 + 0.36 * ((y - lo) / span), 1, 1);
      sink.uv[j] = u;
      sink.uv[j + 1] = v;
    }

    const geo = sinkToGeometry(sink);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    disposables.push(geo);
    body.add(mesh);
  },
});
