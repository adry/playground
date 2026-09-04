import * as THREE from 'three';
import { registerStone, inkText } from '../tombstones.js';
import { Profile, createSink, sinkToGeometry, latheInto } from '../fountain/lathe.js';

// The broken column: a fluted shaft snapped off partway up, standing on a
// square die on a plinth. The Victorian sign for a life cut short, and in a row
// of flat slabs it is the one thing with a round silhouette and a top that is
// not an arch.
//
// The postmortem's rule is that silhouette carries the identity, and this stone
// is almost nothing but silhouette, so the whole design is three decisions:
//
//   1. It is SHORT. The two tall stones reach 1.56 and 1.52; this one averages
//      about 1.29 and its high lip touches 1.36. A broken column that stands as
//      tall as its neighbours has not been broken, it has been built stumpy.
//   2. The base is heavy and the shaft is not. Plinth plus die is 0.49, nearly
//      two fifths of the height, which is what a monument's proportions are and
//      what stops a lone cylinder from reading as a bollard.
//   3. The break is a SHEAR, not a lid. The top rim swings through 0.15 of
//      height from its low side to its high one, so from any angle the eye gets
//      a slanted edge with stone missing above it, and the flutes run straight
//      off that edge mid-groove.
//
// Construction: the registry's slab IS the die, kept short and square in plan,
// which buys the rounded box, the grime, the plinth and one small carved date
// for free. Everything above the die is built in extras() with the fountain's
// lathe: fluting is a change of radius as a function of angle, which is exactly
// what latheInto's displace hook is for, and rubble.js had already proved that
// a snapped face is the same hook with a wander in y. No second lathe.

// Square in plan, 0.56 by 0.56, so the die reads as a block rather than a slab
// turned edge on. Face aspect lands at 1.75, which puts the carved region at
// 1792 px wide: well inside the range the engraving treatment was calibrated
// for, unlike the narrow faces that sank the last attempt.
const SHAPE = { halfWidth: 0.27, height: 0.30, depth: 0.54, plinth: 0.17 };

// --- the shaft -------------------------------------------------------------

const R = 0.165;          // shaft radius at the foot
const COL_TOP = 0.820;    // nominal break height above the die
const SEGMENTS_A = 72;    // angular steps round the lathe
const FLUTES = 10;        // 7 angular segments each at 72; rubble found 5 was the floor
const FLUTE_DEPTH = 0.022;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Rounded vertical grooves. Concave, so the radius dips inside each groove and
// what the eye reads is the stone standing between them. The 0.8 power flattens
// the bottom of the groove a little, which keeps the ridge between two flutes
// broad and soft instead of a knife edge.
function fluting(theta) {
  return -FLUTE_DEPTH * Math.pow(0.5 + 0.5 * Math.cos(FLUTES * theta), 0.8);
}

// The break, as a height offset around the rim.
//
// One big cosine is the whole read: it shears the top of the shaft so the lip
// is high on one side and low on the other, and that slant is what says
// "snapped" from across the room. The three harmonics on top are the texture,
// and they are deliberately low frequency: this is a soft vinyl toy, so a break
// in it is a lumpy surface, never a jagged one.
function breakLip(theta, ph) {
  return (
    Math.cos(theta - ph[0]) +
    0.28 * Math.sin(2 * theta + ph[1]) +
    0.13 * Math.sin(3 * theta + ph[2])
  );
}

// The face of the break itself. Takes the position across the face as well as
// the angle, for the reason rubble.js gives: shaped by angle alone, the wander
// is constant along every radius and the flat top of the stump comes out as a
// pinwheel of ridges meeting at the middle, which is the one thing a snapped
// face never looks like. Twisting the angle with the radius and adding a radial
// wave turns it back into a lump.
function breakFace(theta, u, ph) {
  const a = theta + 1.1 * u;
  return (
    0.40 * Math.sin(4 * a + ph[1]) +
    0.26 * Math.sin(7 * a + ph[2]) +
    0.14 * Math.sin(11 * a + ph[0]) +
    0.20 * Math.sin(5.5 * u + ph[2] * 0.6)
  );
}

// The face texture is a face-shaped region on the left of the canvas plus a
// narrow strip of plain stone on the right that everything non-frontal samples.
// buildTextures owns those numbers and does not hand them to extras(), so they
// are recomputed here from the shape. If the registry ever passes the UV
// helpers through, delete this.
function stripBand(shape) {
  const FH = 1024;
  const STRIP = 160;
  const FW = Math.round(FH * ((2 * shape.halfWidth) / shape.height));
  const w = FW + STRIP;
  return { front: FW / w, strip: STRIP / w };
}

// ---------------------------------------------------------------------------

function buildColumn({ body, material, shape, rng, plinthH }) {
  const phase = [rng() * 6.283, rng() * 6.283, rng() * 6.283];

  const P = new Profile();
  // The disc the shaft stands on is authored below the top of the die, so it is
  // buried in it: landed flush, two coincident surfaces draw a black ring right
  // round the foot of the column. rubble.js hit the same thing.
  P.setTag('foot');
  P.moveTo(0, -0.05);
  P.lineTo(0.232, -0.05, 3);
  // The base moulding. A fat torus rolling off the die and a short concave
  // fillet tucking into the shaft: this is the piece that makes a cylinder read
  // as a column instead of a post. It has to be SHORT. Run out over a third of
  // the shaft, as it was first, the two blend into one long cone and the whole
  // thing reads as a lampshade.
  P.curve([[0.240, 0.000], [0.232, 0.044], [0.206, 0.066]], 8);
  P.curve([[0.184, 0.079], [0.170, 0.094]], 5);
  P.setTag('shaft');
  P.lineTo(R, 0.116, 2);
  // Real columns taper, and at this size 8% over the run is enough to see
  // without the shaft looking whittled.
  P.lineTo(R * 0.92, 0.762, 16);
  P.setTag('break');
  // Over the lip on a tight roll, then across a face that dishes slightly in
  // towards the middle. The roll is the vinyl rounding and it is deliberately
  // small: rolled generously the stump came out domed, like a candle that had
  // burned down, and the eye needs an EDGE round the break even if that edge is
  // soft. No edge on this piece is sharp, the break included.
  P.curve([[R * 0.905, 0.788], [R * 0.845, 0.808], [R * 0.74, COL_TOP]], 6);
  // The face barely dishes, and what dishing there is has to come back UP at
  // the very middle. latheInto decides which way a pole faces by comparing it
  // with the ring next to it, so a face that keeps falling all the way to the
  // axis ends in a point whose normal is turned over: one black pinhole,
  // dead centre, on the most visible surface of the stone.
  P.curve([[R * 0.52, 0.812], [R * 0.24, 0.813]], 5);
  P.lineTo(0, 0.817, 2);
  const profile = P.build();

  const sink = createSink();
  latheInto(sink, {
    profile,
    segments: SEGMENTS_A,
    uRepeat: 1,
    vScale: 1,
    minRadius: 0.07,
    displace: (s, theta) => {
      let dr = 0;
      let dy = 0;
      if (s.tag === 'shaft') {
        // Fade the flutes in over the first sliver of the shaft so they die
        // into the fillet rather than starting as twelve notches on a rim.
        dr += fluting(theta) * smoothstep(0, 0.06, s.u);
      } else if (s.tag === 'break') {
        // Over the break the flutes fade with the RADIUS, not with the run, so
        // they carry over the lip at full depth and die out on the face: what
        // says "snapped" up close is twelve grooves stopping in the middle of
        // themselves.
        dr += fluting(theta) * clamp01((s.r / R - 0.45) / 0.35);
        // Lumps on the face. Held off the axis, because at r = 0 every angular
        // column is the same point and giving them different heights builds a
        // little crown of slivers on the centre of the stump.
        const b = breakFace(theta, s.u, phase) * clamp01(s.r / (R * 0.45));
        dy += 0.019 * b * smoothstep(0, 0.25, s.u);
        dr += 0.011 * b * (1 - smoothstep(0.3, 1, s.u));
      }
      // The shear, which is the whole read at a distance. Two things scale it.
      // Height, so it ramps in smoothly across the shaft/break joint: applied
      // to the break run alone it would drop the low side of the lip below the
      // last ring of the shaft and fold the surface inside out. And radius, so
      // that ACROSS the break face the lift falls off to nothing at the middle
      // and the face comes out a tilted plane rather than a warped saddle. The
      // combined vertical gradient stays under 1, so rings can never cross.
      dy += 0.098 * breakLip(theta, phase)
        * Math.min(smoothstep(0.42, 0.80, s.y), s.r / R);
      return [dr, dy];
    },
  });

  // --- UVs -------------------------------------------------------------------
  //
  // latheInto lays out (angle, arc length), which would drag the column clean
  // across the carved face of the texture atlas. Rewritten here to sit entirely
  // in the plain strip on its right: u wraps once round the column, v climbs the
  // shaft through the clean upper half of the canvas, well clear of the grime
  // band the plinth sits in.
  //
  // u is monotonic and takes the discontinuity on the seam column, which
  // latheInto duplicates, so the jump costs nothing. Mirroring it instead was
  // tried first and is worse: a reflected map puts a crease down every mirror
  // line, and because the mottling either side of it is a mirror image the eye
  // finds the symmetry instantly. The price of one seam is that 160 px of strip
  // has to cover the whole circumference, so the mottling comes out stretched
  // around the column. On a weathered shaft that reads as banding, which is
  // what weathering on a column looks like anyway.
  const band = stripBand(shape);
  const cols = SEGMENTS_A + 1;
  for (let k = 0, i = 0, p = 0; i < sink.uv.length; k++, i += 2, p += 3) {
    const j = k % cols;
    sink.uv[i] = band.front + band.strip * (0.14 + 0.72 * (j / SEGMENTS_A));
    sink.uv[i + 1] = 0.50 + 0.36 * clamp01(sink.pos[p + 1] / COL_TOP);
  }

  const geometry = sinkToGeometry(sink);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = plinthH + shape.height;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);

  // createTombstone's dispose() knows about the slab, the plinth, the material
  // and the textures, and nothing about whatever extras() built. Materials are
  // event dispatchers and dispose() fires on them, so hanging the geometry off
  // that is the one hook available from in here without touching the registry.
  material.addEventListener('dispose', () => geometry.dispose());
}

// ---------------------------------------------------------------------------

registerStone('column', {
  shape: SHAPE,
  // Square the die off. Left alone the registry gives every slab a half-round
  // arch, which on a 0.28 half-width would be a dome under the column.
  topRadius: 0.062,
  draw(ctx, w, h) {
    // One small year, low on nothing and centred on the die. The postmortem is
    // blunt that a complex silhouette gets no marking, and this is the most
    // complex silhouette in the set, so the mark is deliberately half the size
    // of the family's lettering and carries about 3% ink: a monument's date
    // cut into its base, not a second thing competing with the column.
    inkText(ctx, '1861', w / 2, h * 0.52, h * 0.33, h * 0.02);
  },
  extras: buildColumn,
});
