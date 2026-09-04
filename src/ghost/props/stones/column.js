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
//   1. It is SHORT. The two tall stones reach 1.56 and 1.52; this one measures
//      1.24 at the low side of its break and 1.37 at the high, so it sits
//      between them and little Fred at 1.10. A broken column that stands as
//      tall as its neighbours has not been broken, it has been built stumpy.
//   2. The base is heavy and the shaft is not. Plinth plus die is 0.47, over a
//      third of the height, which is a monument's proportions and what stops a
//      lone cylinder from reading as a bollard.
//   3. The break is a SHEAR, not a lid. The rim swings about 0.12 from its low
//      side to its high one, a slope near twenty degrees, so the eye gets a
//      slanted edge with stone missing above it and the flutes run straight off
//      that edge in the middle of themselves.
//
// Construction: the registry's slab IS the die, kept short and square in plan,
// which buys the rounded box, the grime, the plinth and one small carved date
// for free. Everything above the die is built in extras() with the fountain's
// lathe: fluting is a change of radius as a function of angle, which is exactly
// what latheInto's displace hook is for, and rubble.js had already proved that
// a snapped face is the same hook with a wander in y. No second lathe.

// Square in plan, 0.54 by 0.54, so the die reads as a block rather than as a
// slab turned edge on, and so it looks the same from all four sides the way the
// column above it does. Face aspect lands at 1.8, which puts the carved region
// at 1843 px wide: well above the 500 px floor the engraving treatment needs,
// unlike the narrow faces that sank the last attempt at new stones.
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
// "snapped" from across the room. The harmonics on top are the texture, and
// they are deliberately low frequency: this is a soft vinyl toy, so a break in
// it is a lumpy surface, never a jagged one.
function breakLip(theta, ph) {
  // One spur of stone that survived the fall, forty degrees or so wide and set
  // off to one side of the slant. Without it there is one direction, square on
  // to the axis the shear tilts about, from which a tilted plane reads as a
  // level one and the stump looks sawn. The spur means no viewpoint is flat.
  const d = Math.atan2(Math.sin(theta - ph[0] - 2.0), Math.cos(theta - ph[0] - 2.0));
  return (
    Math.cos(theta - ph[0]) +
    0.28 * Math.sin(2 * theta + ph[1]) +
    0.13 * Math.sin(3 * theta + ph[2]) +
    0.50 * Math.exp(-((d / 0.70) ** 2))
  );
}

// The face of the break itself: three plane waves crossing at three angles,
// summed. Roughly two and a half lumps across the stump, which is as coarse as
// a break can be and still read as broken rather than as a dent.
//
// It is a function of x and z, NOT of the angle, and that is the whole point.
// rubble.js warns that a wander shaped by angle is constant along every radius,
// so the top of a stump comes out as a pinwheel of ridges converging on the
// middle, which is the one thing a snapped face never looks like; it answers
// that by twisting the angle with the radius. Twisted or not, anything written
// in polar coordinates still has a singularity at the axis and still shows it.
// A field in the plane simply has no centre.
function breakFace(x, z, ph) {
  return (
    0.46 * Math.sin(27 * x + ph[0]) +
    0.31 * Math.sin(25 * (0.40 * x + 0.92 * z) + ph[1]) +
    0.21 * Math.sin(45 * (0.85 * x - 0.53 * z) + ph[2])
  );
}

// ---------------------------------------------------------------------------

function buildColumn({ body, material, shape, rng, plinthH, disposables, stripUV }) {
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
  P.lineTo(R * 0.92, 0.782, 16);
  P.setTag('break');
  // Over the lip on a roll about a quarter of the shaft radius, then flat
  // across. The roll is the vinyl rounding and it is deliberately tight:
  // rolled generously the stump came out domed, like a candle burned down, and
  // the eye needs an EDGE round a break even when that edge is soft.
  P.curve([[R * 0.900, 0.804], [R * 0.840, 0.816], [R * 0.72, COL_TOP]], 6);
  // The face is flat but for a low mound at the very centre, and the mound is
  // structural rather than decorative. latheInto decides which way a pole faces
  // by comparing it with the ring next to it, so a face that keeps falling all
  // the way to the axis ends in a point whose normal is turned over: one black
  // pinhole, dead centre, on the most visible surface of the stone.
  P.curve([[R * 0.50, 0.818], [R * 0.24, 0.818]], 5);
  P.lineTo(0, 0.823, 2);
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
        // into the fillet rather than starting as ten notches cut in a rim.
        dr += fluting(theta) * smoothstep(0, 0.06, s.u);
      } else if (s.tag === 'break') {
        // Over the break the flutes fade with the RADIUS, not with the run, so
        // they carry over the lip at full depth and die out on the face. What
        // says "snapped" up close is ten grooves stopping in the middle of
        // themselves.
        dr += fluting(theta) * clamp01((s.r / R - 0.45) / 0.35);
        // Lumps on the face, sampled where the ring actually sits in plan.
        // Eased off over the inner third so the low mound the profile leaves in
        // the middle is not fighting them: the mound is what keeps the pole's
        // normal pointing up.
        const b = breakFace(s.r * Math.cos(theta), s.r * Math.sin(theta), phase)
          * smoothstep(0, 0.24, s.r / R);
        dy += 0.027 * b * smoothstep(0, 0.30, s.u);
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
  const cols = SEGMENTS_A + 1;
  for (let k = 0, i = 0, p = 0; i < sink.uv.length; k++, i += 2, p += 3) {
    // stripUV wants a point on a face of a given half-width and height, so it
    // is fed a unit face: the angular column index across it, and a height that
    // starts a little over halfway up the canvas. Starting at 0 instead would
    // hand the shaft the grime gradient that belongs to the foot of a stone,
    // and this piece begins half a unit off the ground.
    const [u, v] = stripUV(k % cols / SEGMENTS_A - 0.5, 0.55 + 0.45 * clamp01(sink.pos[p + 1] / COL_TOP), 0.5, 1);
    sink.uv[i] = u;
    sink.uv[i + 1] = v;
  }

  const geometry = sinkToGeometry(sink);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = plinthH + shape.height;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);

  disposables.push(geometry);
}

// ---------------------------------------------------------------------------

registerStone('column', {
  shape: SHAPE,
  // Square the die off. Left alone the registry gives every slab a half-round
  // arch, which under a column would be a dome. Both radii are set to the
  // slab's own edge radius, so the die is a plain rounded box: the default
  // bottomRadius of 0.09 is a sixth of the height here and pinched the block in
  // at the foot, which read as a cushion rather than as masonry.
  topRadius: 0.062,
  bottomRadius: 0.062,
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
