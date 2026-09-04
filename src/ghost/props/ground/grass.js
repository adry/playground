import * as THREE from 'three';
import {
  FOLIAGE, foliageMaterial, foliageRng, mergeLumps, bakeFoliageTint, bakeWind,
  attachWind, disposeWind, updateWind, windUniforms,
} from '../foliage/wind.js';

// Graveyard grass: the unmown tufty stuff that grows between plots and creeps
// up against a kerb. A patch is a scatter of clumps, not a lawn.
//
//   const grass = createGrassPatch({
//     seed: 4,        // every blade, every clump and every colour hangs off this
//     radius: 1.0,    // world units. The scatter fills a disc of this radius
//     density: 1,     // clumps per unit area, relative to the default
//     scale: 1,       // applied to the whole group
//   });
//   scene.add(grass.group);      // { group, size, update(time, dt), dispose() }
//
// createGrassTuft() is the same clump on its own, for edging a kerb or filling
// the gap behind a headstone where a whole patch will not fit.
//
// It is built on foliage/wind.js so that it leans in the SAME gust as the
// bushes: the same palette, the same vertex tint bake, the same aWind layout,
// the same attachWind, the same shared uniform block. Only the primitive is
// local, and that is the one thing this prop had to add.
//
// --- WHY A BLADE AND NOT A LUMP -------------------------------------------
//
// wind.js's primitive is a lobed lump, closed and round at both ends, and
// mergeLumps assembles heaps of them. That is exactly right for a yew and it is
// wrong for grass in one specific way: `stretch` is documented to keep the end
// as round as it started, which is what stops a bush turning into a bed of
// agave spines. A grass blade is the opposite shape. It has to leave the ground
// at full width, arc over, and TAPER, and a lozenge that does not taper reads
// as a bean sprout however you scale it.
//
// Both were built and rendered side by side, same clump layout, same seed:
// out/grass/grass-ab.png. The lozenge patch reads as clusters of green
// sausages. Every lump has the same blunt end at the top as at the bottom, so
// nothing in it points anywhere, and at scene size that collapses into dark
// blobs (out/grass/grass-abscene-lozenge-crop4x.png). It is also DEARER: a
// lozenge needs icosphere detail 1 to keep a smooth silhouette, which is 80
// triangles, against 22 to 28 for the blade below.
//
// So bladeGeometry() is local, and it is the only thing here that is. It is a
// swept tapered strip: a centreline that leaves the ground near-vertical and
// arcs over, a THREE point keeled section carried along it, a rounded tip and a
// cap on the buried end.
//
// Three points, not two and not four. Two is a card, and a card seen from a
// fixed camera shows its zero thickness the moment it turns edge on, which is
// the failure the house style bans outright. Four is a flattened lozenge and
// was what shipped first; it is 26% more triangles than three for a section
// nobody can resolve at two pixels wide, and it has no ridge. Three gives the
// blade a keel: two lit faces meeting along the top of the blade, which is
// both what a real blade has and the only internal shading a blade this small
// can carry. The flat side faces down once the blade folds over, so what the
// camera gets is the ridge.
//
// --- WHAT MAKES IT READ AT SIXTY PIXELS -----------------------------------
//
// Measured, in a 900x900 frame at view 6.2: a patch of radius 1 occupies 303 by
// 163 pixels, and one blade in it is between one and a half and two and a half
// pixels wide. Nothing about an individual blade survives that, so the work is
// done by:
//
//   - CHUNK. Blades are 5:1 to 10:1 rather than the 30:1 of real grass.
//     Anything finer aliases into the film grain this project bans, and at two
//     pixels wide there is nothing to lose by being fat.
//   - VALUE. bakeFoliageTint's crevice term is fed a per-blade base-to-tip ramp
//     through mergeLumps' lumpU, so every blade is dark at the foot and bright
//     at the tip. That gradient is the whole read of the patch from across the
//     yard: the mass goes dark at the ground and the tops catch the key.
//   - THATCH. Every clump carries dead blades folded past 70 degrees, lying
//     over its own foot, and more of them are strewn between the clumps. They
//     are what stops the patch reading as green marks stuck into bare floor,
//     and they are what dresses the ground without putting anything flat on it.
//     See the note further down on the two flat layers that were tried first.
//
// --- THE FLOOR -------------------------------------------------------------
//
// NOTHING IN THIS PROP IS COPLANAR WITH THE FLOOR, so the prop carries no depth
// bias at all. sandpath.js needs polygonOffset because a ribbon has to lie ON
// the floor and its rim is at exactly y = 0; grass has no such surface. Every
// blade, living or dead, starts 3.5cm BELOW y = 0 and cuts up through it, which
// is bush.js's buried-skirt argument applied to a much smaller thing: a blade
// standing tangent to the floor shows a hairline of daylight round its foot at
// 38 degrees, a blade driven through it does not. Two flat ground layers were
// built and both are rejected, for reasons that were never about z-fighting;
// see the note above scatterClumps. Verified at a grazing camera in
// out/grass/grass-graze.png and out/grass/wind/windgraze-t*.png.

// --- proportions -----------------------------------------------------------
//
// Ankle deep on the 1.72 ghost, which is what puts it under the 0.81 of the
// shortest headstone by a factor of four and lets a stone stand IN grass rather
// than behind it. Measured, not guessed: the finished patch reports its own
// height range in size.height and the numbers are in the report.
const HEIGHT = {
  min: 0.112,
  max: 0.190,
  // The odd straggler that nobody cut. Without a few of these every clump tops
  // out at the same line and the patch reads as a doormat.
  tallOdds: 0.14,
  tall: [1.18, 1.42],
};

// A blade is this wide at the ground whatever its height. Deliberately not tied
// to the height: tying them made the short clumps into needles, which is the
// aliasing the brief rules out, and it is not what grass does anyway.
const BLADE_W = [0.018, 0.012];   // [base, spread]
const BLADE_THICK = [0.38, 0.22]; // as a fraction of the width

// Clumps per unit area at density 1, and the loose blades between them.
//
// FEW AND BIG, not many and small. At thirteen small clumps a square metre the
// patch read as a scatter of separate little plants standing on bare floor
// (out/grass/grass-scene-crop4x-scatter.png): every clump was a five-blade
// spider and the eye counted them. Eight fat tussocks a metre with loose blades
// strung between them reads as one piece of overgrown ground, which is what a
// gap between two plots looks like, and it costs the same triangles because the
// blades went into fewer clumps rather than into more of them.
const CLUMPS_PER_AREA = 8;
const STRAY_SHARE = 1.4;          // loose blades, as a fraction of the clumps

// How far below the floor a blade starts and a thatch mound sinks.
const BURY = 0.035;

// A blade that arcs over does not stand as tall as it is long. This is the
// factor the clump height is divided through by before a blade is cut, so that
// what a clump PROMISES is its standing height; the patch is then measured and
// scaled to settle the last few per cent. See buildGrass.
const ARC_LOSS = 1.26;

// --- colour ----------------------------------------------------------------
//
// Out of the foliage palette, because a graveyard in this set has one green in
// it and grass standing next to a yew that is a different green is worse than
// grass that is slightly wrong.
//
// The MATERIAL is FOLIAGE.light, not mid. That is the opposite way round from
// bush.js and it is deliberate: light is described in wind.js as the sun-facing
// crown, and a patch of grass is very nearly all sun-facing crown. Built on mid
// the whole patch came out between deep and mid and read as a scatter of black
// specks on a pale floor, because the tint bake's ceiling is a multiplier near
// one and light is 2.75x mid in linear, so nothing on the prop could ever get
// there. Built on light, the bake's FLOOR does the work instead and takes the
// interior of a clump down to mid and below, which is the direction the shading
// actually needs to go.
//
// DRY is the one colour that is not simply a palette entry. The foliage palette
// has no straw in it, because a yew has no dead grass on it. So it is the
// palette's own light and stem mixed and then opened up: same two hues, lifted
// above the green instead of sitting under it, which is what sun-bleached grass
// does. Everything is applied as a per-vertex RATIO on top of the material
// colour, so the dry blades and the dead thatch cost no second material and no
// second draw call.
const LIN = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const BASE_LIN = LIN(FOLIAGE.light);
const DRY_LIN = LIN(FOLIAGE.light).lerp(LIN(FOLIAGE.stem), 0.45).multiplyScalar(1.9);
const DRY_RATIO = [
  DRY_LIN.r / BASE_LIN.r,
  DRY_LIN.g / BASE_LIN.g,
  DRY_LIN.b / BASE_LIN.b,
];

// --- the blade primitive ---------------------------------------------------
//
// Local space: the blade grows up +y and arcs towards +x. The caller yaws it.
//
// `rings` is segments above ground: two for a short upright blade, three for a
// long one that folds right over. One further ring is added below them, pushed
// back down the blade's own axis by `bury`, so the foot is under the floor at
// any tilt and there is no daylight where the blade meets the ground.
function bladeGeometry({
  rings = 3,
  length = 0.16,
  width = 0.024,
  thick = 0.009,
  tilt0 = 0.15,      // radians off vertical where it leaves the ground
  tilt1 = 0.8,       // and at the tip
  curve = 1.7,       // how the bend is distributed: >1 keeps the base upright
  bow = 0,           // sideways lean out of the bend plane, at the tip
  twist = 0,         // radians the section rotates from foot to tip
  bury = BURY,
}) {
  const nAbove = rings + 1;
  const nRing = nAbove + 1;
  const pos = new Float32Array((nRing * 3 + 1) * 3);
  const idx = new Uint16Array(((nRing - 1) * 3 * 2 + 3 + 1) * 3);

  // Width holds most of the way up and then goes, which is a grass blade. A
  // linear taper is a triangle and reads as a spike.
  const taper = (t) => 0.16 + 0.84 * Math.pow(Math.max(0, 1 - t * t), 0.55);
  const theta = (t) => tilt0 + (tilt1 - tilt0) * Math.pow(Math.max(0, t), curve);

  // Walk the centreline. Midpoint steps: an Euler walk on a blade that folds
  // over 70 degrees in three segments is visibly short.
  const ds = length / rings;
  const px = new Float64Array(nAbove);
  const py = new Float64Array(nAbove);
  for (let i = 1; i < nAbove; i++) {
    const th = theta((i - 0.5) / rings);
    px[i] = px[i - 1] + Math.sin(th) * ds;
    py[i] = py[i - 1] + Math.cos(th) * ds;
  }

  let o = 0;
  const put = (x, y, z) => { pos[o++] = x; pos[o++] = y; pos[o++] = z; };

  // Ring -1 is the buried base, then rings 0..rings above ground.
  for (let i = -1; i < nAbove; i++) {
    const j = Math.max(0, i);
    const t = j / rings;
    const th = theta(i < 0 ? 0 : t);
    const dx = Math.sin(th), dy = Math.cos(th);
    let cx = px[j], cy = py[j];
    if (i < 0) { cx -= dx * bury; cy -= dy * bury; }
    const cz = bow * t * t;

    const k = i < 0 ? 1 : taper(t);
    const hw = width * 0.5 * k;
    const ht = thick * (0.42 + 0.58 * k);

    // Section frame: `a` across the blade, `n` through its face, both turned
    // about the blade axis by the twist. a x n = d, so the winding below faces
    // outward.
    const ph = twist * (i < 0 ? 0 : t);
    const cp = Math.cos(ph), sp = Math.sin(ph);
    // a0 = (0,0,1), n0 = d x a0 = (cos th, -sin th, 0)
    const ax = dy * sp, ay = -dx * sp, az = cp;
    const nx = dy * cp, ny = -dx * cp, nz = -sp;

    // Three points, in increasing angle about the blade axis so the winding
    // below comes out facing outward: the two edges of the blade, and the keel
    // ridge under them.
    put(cx + ax * hw, cy + ay * hw, cz + az * hw);
    put(cx - ax * hw, cy - ay * hw, cz - az * hw);
    put(cx - nx * ht, cy - ny * ht, cz - nz * ht);
  }
  // The tip, a little beyond the last ring, which rounds the end off instead of
  // leaving the 16% stub square.
  const thT = theta(1);
  put(px[nAbove - 1] + Math.sin(thT) * width * 0.30,
      py[nAbove - 1] + Math.cos(thT) * width * 0.30,
      bow);

  let q = 0;
  const tri = (a, b, c) => { idx[q++] = a; idx[q++] = b; idx[q++] = c; };
  for (let i = 0; i < nRing - 1; i++) {
    const lo = i * 3;
    const hi = lo + 3;
    for (let j = 0; j < 3; j++) {
      const j2 = (j + 1) % 3;
      tri(lo + j, lo + j2, hi + j2);
      tri(lo + j, hi + j2, hi + j);
    }
  }
  const tip = nRing * 3;
  const top = (nRing - 1) * 3;
  tri(top, top + 1, tip);
  tri(top + 1, top + 2, tip);
  tri(top + 2, top, tip);
  // The buried cap, wound the other way because it faces down the blade.
  tri(0, 2, 1);

  return { positions: pos, index: idx };
}

// --- a clump ---------------------------------------------------------------
//
// A handful of blades out of one foot, plus the dead ones lying over it.
// Blades fan on a golden angle rather than at random: five random azimuths
// leave one side of the clump bare about a third of the time, and a bald flank
// is very visible at a fixed camera azimuth.
//
// The arc is the whole prop. The first pass built blades that left the ground
// at 3 degrees and reached 50 at the tip, and what came back
// (out/grass/grass-square-agave.png) was a bed of aloes: a ring of stiff spikes
// standing up out of a green pad. Grass is a FOUNTAIN. A long blade here folds
// to as much as 87 degrees off vertical, so its tip runs out sideways over the
// ground and the clump spreads instead of pointing.
function buildClump(rand, {
  x = 0, z = 0, height, blades, vigour = 0.6, phase, spread = 1, thatch = true, dead,
}) {
  const parts = [];
  const m = new THREE.Matrix4();
  const foot = new THREE.Vector3();

  // How dry the whole clump is. Graveyard grass goes over in patches, so this
  // is per clump with a per-blade wobble on top, not per blade. A flat random
  // gives every clump a middling
  // dryness and the patch one colour; the split here puts most clumps green and
  // a real minority right over, which is the variation that reads.
  const clumpDry = Math.pow(rand(), 2.2) < 0.25 ? 0.75 + rand() * 0.25 : Math.pow(rand(), 1.6) * 0.7;
  const spin = rand() * Math.PI * 2;
  // Clumps are not round. An elliptical fan means two clumps side by side do
  // not read as two copies of one part.
  const ex = 0.7 + rand() * 0.6;
  const ez = 0.7 + rand() * 0.6;
  // And nothing grows plumb. The whole clump is tipped, which is what stops a
  // radial fan of blades reading as a star: leant over, the near blades stand
  // taller than the far ones and the tussock has a front and a back. Small
  // enough that the buried feet stay buried.
  const leanAz = rand() * Math.PI * 2;
  const lean = rand() * 0.095;
  const leanM = new THREE.Matrix4().makeRotationAxis(
    new THREE.Vector3(-Math.sin(leanAz), 0, Math.cos(leanAz)), lean,
  );
  // The long blades gather on one side rather than spacing themselves evenly
  // round the clump: grass that has been leant on by weather flops one way.
  const flopAz = rand() * Math.PI * 2;

  for (let b = 0; b < blades; b++) {
    let az = spin + b * 2.399963 + (rand() - 0.5) * 1.0;
    // Pulled a third of the way towards the clump's flop direction, which
    // clusters the long blades without collapsing the fan onto one line.
    az += Math.atan2(Math.sin(flopAz - az), Math.cos(flopAz - az)) * 0.10;
    // One blade in the clump makes the full height and the rest are skewed
    // short. A uniform spread of lengths gives every clump the same even
    // rosette, which is an aloe; a tussock is a crowd of short blades with
    // three or four long ones flopping out of it.
    const lengthK = b === 0 ? 1 : 0.30 + Math.pow(rand(), 1.7) * 0.70;
    const len = (height / ARC_LOSS) * lengthK;
    const tilt0 = 0.05 + rand() * 0.20;
    // The longer a blade the further it folds over, which is what makes an
    // unmown clump a fountain instead of a hedgehog. The short inner blades
    // stay near upright and are the part that reads as the heart of the clump.
    const tilt1 = Math.min(1.52, tilt0 + (0.30 + rand() * 0.60) * (0.35 + 1.15 * lengthK));
    // Segments bought against arc: a blade that only leans needs two, one that
    // folds right over needs three. Four was tried and is subdivision nobody
    // can see: at the eight pixels tall a blade is in the scene it costs 22%
    // more triangles across the whole patch and changes no pixel.
    const rings = Math.max(2, Math.min(3, Math.round(1.0 + tilt1 * 1.5)));
    const width = (BLADE_W[0] + rand() * BLADE_W[1]) * (0.8 + 0.35 * lengthK);

    const geo = bladeGeometry({
      rings,
      length: len,
      width,
      thick: width * (BLADE_THICK[0] + rand() * BLADE_THICK[1]),
      tilt0,
      tilt1,
      curve: 1.35 + rand() * 0.65,
      bow: (rand() - 0.5) * len * 0.28,
      twist: (rand() - 0.5) * 1.0,
    });

    // Feet are scattered over the clump's footprint, not stacked on one point:
    // a fan out of a single vertex is a firework.
    const fr = (0.010 + rand() * 0.048) * spread * (0.6 + 0.7 * vigour);
    foot.set(x + Math.cos(az) * fr * ex, 0, z + Math.sin(az) * fr * ez);
    m.makeRotationY(-az).premultiply(leanM).setPosition(foot);

    parts.push({
      positions: geo.positions,
      index: geo.index,
      matrix: m.clone(),
      // Seconds of delay, not a fraction: see the gust note in buildGrass.
      phase: phase + (rand() - 0.5) * 0.26,
      // Flutter is a rigid offset of the whole blade, foot included, so it is
      // bounded well inside BURY or the grass lifts off the ground.
      flutter: 0.45 + rand() * 0.55,
      // Tips dry first. The ramp itself is applied per vertex further down.
      dry: Math.min(1, clumpDry * (0.7 + rand() * 0.6)),
      shade: 1,
    });
  }

  // The thatch: last year's growth, dead, flattened and lying over the foot of
  // the clump. Same primitive, folded past 55 degrees so it runs out along the
  // ground rather than standing up, and painted at full dryness.
  //
  // This started as a small lumpy dome per clump, which is bush.js's answer to
  // ground contact and is the wrong one here. At three centimetres tall a
  // detail-0 dome is a faceted dark pebble, and every clump in the patch had
  // one sitting under it like a moulded base
  // (out/grass/grass-square-pads.png). Dead grass is grass. The blades' own
  // buried feet make the ground contact instead, and these lying-over blades
  // are what hides them.
  if (thatch) {
    const n = dead === undefined ? 3 + Math.round(vigour * 3) : dead;
    for (let b = 0; b < n; b++) {
      const az = spin + 1.2 + b * 2.399963 + (rand() - 0.5) * 1.2;
      const len = (height / ARC_LOSS) * (0.50 + rand() * 0.45);
      const tilt0 = 0.55 + rand() * 0.42;
      // Capped short of horizontal: a blade folded past 90 degrees walks its own
      // tip under an opaque floor and simply disappears.
      const tilt1 = Math.min(1.42, tilt0 + 0.30 + rand() * 0.35);
      const width = (BLADE_W[0] + rand() * BLADE_W[1]) * 0.92;
      const geo = bladeGeometry({
        rings: 2,
        length: len,
        width,
        thick: width * 0.34,
        tilt0,
        tilt1,
        curve: 1.2,
        bow: (rand() - 0.5) * len * 0.4,
        twist: (rand() - 0.5) * 1.4,
        bury: BURY * 0.7,
      });
      const fr = (0.004 + rand() * 0.020) * spread;
      foot.set(x + Math.cos(az) * fr, 0, z + Math.sin(az) * fr);
      m.makeRotationY(-az).premultiply(leanM).setPosition(foot);
      parts.push({
        positions: geo.positions,
        index: geo.index,
        matrix: m.clone(),
        phase,
        flutter: 0.15,   // dead and matted: it barely moves
        dry: 1,
        // Held back off the value the dryness ramp would give it. Dead thatch is
        // dry, but it is also the shaded floor of the clump, and painted at full
        // brightness it read as a pale plate.
        shade: 0.86,
      });
    }
  }

  // Measured through each part's own matrix, not off its raw positions: the
  // clump is leant over, so a blade's local y is not its standing height.
  let top = 0;
  const v = new THREE.Vector3();
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      v.set(p.positions[i], p.positions[i + 1], p.positions[i + 2]);
      if (p.matrix) v.applyMatrix4(p.matrix);
      if (v.y > top) top = v.y;
    }
  }
  return { parts, top };
}

// --- what is NOT here: a flat ground layer ---------------------------------
//
// Twice. Both are in the renders and both are rejected.
//
// A patch-wide LITTER MAT first: one polar surface reaching out to the clumps,
// swelling a centimetre under each of them, rim at exactly y = 0 with
// polygonOffset, which is sandpath.js's answer to the coplanar fight and the
// right one. The z-fighting was not the problem. At a metre across it is a
// single connected shape with a single outline, and a single outline on the
// floor is a green rug thrown down under the grass. See
// out/grass/grass-scene-crop4x-rug.png; it is the exact stain the ground README
// warns about, and no amount of raggedness on its edge fixed it.
//
// Then a per-clump APRON: the same surface at fifteen centimetres, one under
// each tussock, on the theory that something smaller than the grass standing in
// it cannot read as an outline. It reads as a COASTER
// (out/grass/grass-scene-crop4x-coaster.png). At 38 degrees a disc that is a
// centimetre proud is seen almost edge on, so its own shading vanishes and all
// that is left is the flat plate of colour it puts on the floor, which is a
// moulded toy base under every clump. The same thing had already happened to
// the lumpy dome this prop started with.
//
// The ground between the tussocks is dressed with GRASS instead: dead blades
// folded past 70 degrees so they lie over the floor, in the clumps and strewn
// between them. They are the same primitive, they cost the same triangles a
// flat surface would have, they cannot z-fight because nothing about them is
// coplanar with anything, and at 38 degrees a blade lying down presents its
// whole face to the camera, which is the one thing a flat disc cannot do.

// --- scatter ---------------------------------------------------------------
//
// Clumped rejection sampling in a disc. Half of the candidates are thrown near
// a clump that is already down, which is what puts real gaps and real thickets
// into the patch: uniform Poisson gives an even stipple, and an even stipple of
// grass reads as a machine-planted lawn, which is the one thing a neglected
// churchyard is not.
function scatterClumps(rand, radius, density) {
  const area = Math.PI * radius * radius;
  const target = Math.max(1, Math.round(CLUMPS_PER_AREA * density * area));
  const minD = 0.74 * Math.sqrt(area / target);
  const out = [];
  const tries = target * 40;

  for (let k = 0; k < tries && out.length < target; k++) {
    let x, z;
    if (out.length && rand() < 0.55) {
      const p = out[(rand() * out.length) | 0];
      const a = rand() * Math.PI * 2;
      const d = minD * (1.0 + rand() * 0.9);
      x = p.x + Math.cos(a) * d;
      z = p.z + Math.sin(a) * d;
    } else {
      const a = rand() * Math.PI * 2;
      const d = radius * Math.sqrt(rand());
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    }
    const rr = Math.hypot(x, z) / radius;
    // Thinned towards the rim and allowed a little past it, so the patch fades
    // out instead of ending on a drawn circle. A circular edge is the single
    // thing that would give away a scattered patch as a placed prop.
    if (rr > 1.03) continue;
    const t = Math.max(0, Math.min(1, (rr - 0.58) / 0.5));
    if (rand() < t * t * (3 - 2 * t) * 0.85) continue;

    let ok = true;
    for (let i = 0; i < out.length; i++) {
      if (Math.hypot(out[i].x - x, out[i].z - z) < minD) { ok = false; break; }
    }
    if (ok) out.push({ x, z });
  }
  return out;
}

// --- the prop --------------------------------------------------------------

function buildGrass({ seed, radius, scale, sites, strays = 0 }) {
  const rand = foliageRng(seed * 6151 + 907);
  const group = new THREE.Group();

  // The travelling gust, recovered by hand.
  //
  // wind.js phases its gust by the MESH's world position (modelMatrix[3].xz),
  // which is right for a bush and not enough for a two metre patch: every blade
  // in it would sample one point of the gust and the whole patch would lean at
  // the same instant, which is exactly the rigid read the wave number exists to
  // prevent. Blades are not separate meshes and should not be. So the spatial
  // term is folded into the per-blade time offset instead: uScatter is set to 1
  // and aWind.w carries seconds directly, of which this is the part that varies
  // with position. Sampled at build time; a patch built before setWind() keeps
  // the direction it was built with, which is why this is a lean rather than a
  // per-frame cost.
  const W = windUniforms();
  const gustDir = W.uWindDir.value;
  const gustK = W.uWaveK.value;
  const gustRate = W.uWindRate.value.x;
  const delay = (x, z) => -(gustK * (x * gustDir.x + z * gustDir.y)) / (2 * Math.PI * gustRate);

  const parts = [];
  const tops = [];
  let wantTop = 0;
  for (const s of sites) {
    // Vigour drives height AND blade count together, so a patch has small
    // sparse clumps and big shaggy ones rather than one clump repeated at
    // different heights.
    // A site may ask for its own vigour: createGrassTuft does, because a tuft
    // placed on purpose against a kerb should be a proper tussock and not
    // whichever of the range the die happened to roll.
    const vigour = s.vigour === undefined ? Math.pow(rand(), 0.85) : s.vigour;
    let h = HEIGHT.min + vigour * (HEIGHT.max - HEIGHT.min);
    if (rand() < HEIGHT.tallOdds) h *= HEIGHT.tall[0] + rand() * (HEIGHT.tall[1] - HEIGHT.tall[0]);
    wantTop = Math.max(wantTop, h);
    const c = buildClump(rand, {
      x: s.x,
      z: s.z,
      height: h,
      vigour,
      blades: 6 + Math.round(vigour * 8),
      phase: delay(s.x, s.z),
      spread: s.spread === undefined ? 1 : s.spread,
    });
    parts.push(...c.parts);
    tops.push(c.top);
  }

  // Loose blades in the gaps. Without them the patch is a set of separate
  // little plants standing on a bare floor; with them the clumps are joined by
  // something and the whole thing reads as one overgrown piece of ground.
  for (let i = 0; i < strays; i++) {
    const base = sites[(rand() * sites.length) | 0];
    const a = rand() * Math.PI * 2;
    const d = radius * (0.07 + rand() * 0.26);
    const x = base.x + Math.cos(a) * d;
    const z = base.z + Math.sin(a) * d;
    if (Math.hypot(x, z) > radius * 1.02) continue;
    // One in three is FALLEN: dead blades lying over the floor rather than
    // standing in it. They are what dresses the bare ground between the
    // tussocks, and they are grass rather than a flat disc of colour, which is
    // the whole argument in the note above scatterClumps.
    const fallen = rand() < 0.36;
    const c = buildClump(rand, {
      x, z,
      height: fallen ? HEIGHT.min * (0.9 + rand() * 0.7) : HEIGHT.min * 0.85 + rand() * 0.075,
      vigour: 0.2,
      blades: fallen ? 0 : 2 + ((rand() * 2) | 0),
      dead: fallen ? 2 + ((rand() * 2) | 0) : 0,
      phase: delay(x, z),
      spread: 0.7,
      thatch: fallen,
    });
    parts.push(...c.parts);
  }

  const geo = mergeLumps(parts);

  // Measure and settle, which is bush.js's trick and it is here for the same
  // reason: a blade's standing height is whatever its own arc left it, so the
  // only way "ankle deep, measured not guessed" survives is to build the patch,
  // read what it actually came out at, and scale it to the height it promised.
  // Uniform and about y = 0, so no normal has to be recomputed and the buried
  // feet keep the same proportion of themselves underground.
  const K = wantTop / Math.max(1e-4, Math.max(...tops));
  geo.scale(K, K, K);
  geo.computeVertexNormals();
  const top = wantTop;

  // The footprint the patch ACTUALLY covers, which is not `radius`. The scatter
  // is allowed a little past the rim, the blades of a rim clump reach further
  // out again, and the settle above scales x and z along with y. A layout
  // generator that spaced patches by `radius` would overlap them by about a
  // quarter without meaning to, so the measured number is the one reported.
  const pos = geo.getAttribute('position');
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = pos.getX(i) * pos.getX(i) + pos.getZ(i) * pos.getZ(i);
    if (d > reach) reach = d;
  }
  reach = Math.sqrt(reach);

  // Value first, then hue. bakeFoliageTint OVERWRITES the colour attribute
  // rather than multiplying into it, so the dryness pass has to come second and
  // multiply into what the bake left.
  bakeFoliageTint(geo, {
    top,
    floor: 0.72,   // the foot of a blade, down among the thatch
    ceil: 1.70,    // and the tip of one, well above the material colour
    down: 0.86,
    root: 0.58,    // the base-to-tip ramp along each blade, which at scene
    spread: 0.30,  // size is the entire read of the patch
    warm: 0.30,
    jitter: 0.06,
    rand,
  });
  paintDryness(geo, parts);

  // Hinged at the foot. A lower power than the bush's 1.8: a bush is a mass on
  // a stiff frame and bends near its crown, a blade bends all the way along.
  bakeWind(geo, { top, base: 0, power: 1.45 });

  // No polygonOffset. It was here while the litter mat was, and sandpath.js's
  // argument for it was the right one, but with the mat gone the prop has no
  // surface coplanar with anything and a depth bias with nothing to fix is a
  // bias that will one day pull a blade in front of a headstone it is standing
  // behind.
  const material = foliageMaterial(FOLIAGE.light, { roughness: 0.93 });
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);

  attachWind(mesh, {
    // Grass is floppy. The bush leans 9% of its height; grass at that would be
    // a millimetre and a half and read as a still image.
    sway: 0.34 * top,
    flutter: 0.006,
    flutRate: 2.35,
    droop: 2.6,
    lag: 0.16,
    // aWind.w is in seconds already, so this must stay at 1.
    scatter: 1.0,
  });

  group.scale.setScalar(scale);

  return {
    group,
    mesh,
    // What the prop actually measures, so a layout generator can space patches
    // without building one and reading its bounding box back.
    size: {
      height: top * scale,
      // The measured standing height of the shortest and the tallest clump, not
      // what they were asked for: a blade's arc decides where it ends up.
      shortest: Math.min(...tops) * K * scale,
      tallest: Math.max(...tops) * K * scale,
      // What was asked for, and what it actually covers.
      radius: radius * scale,
      reach: reach * scale,
      clumps: sites.length,
      triangles: geo.getIndex().count / 3,
    },
    update(time) { updateWind(time); },
    dispose() {
      disposeWind(mesh);
      geo.dispose();
      material.dispose();
    },
  };
}

// The dryness multiplier, applied on top of the value bake.
//
// Per blade, ramped base to tip off mergeLumps' lumpU: a blade goes over from
// the point down, and a patch where whole blades are uniformly brown reads as
// dead rather than as dry.
function paintDryness(geo, parts) {
  const col = geo.getAttribute('color');
  const u = geo.userData.lumpU;
  let o = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const v = o + i;
      const d = Math.min(1, p.dry * (0.35 + 0.85 * (u ? u[v] : 1)));
      const k = p.shade === undefined ? 1 : p.shade;
      col.setXYZ(
        v,
        col.getX(v) * (1 + d * (DRY_RATIO[0] - 1)) * k,
        col.getY(v) * (1 + d * (DRY_RATIO[1] - 1)) * k,
        col.getZ(v) * (1 + d * (DRY_RATIO[2] - 1)) * k,
      );
    }
    o += n;
  }
  col.needsUpdate = true;
}

/**
 * A patch of unmown graveyard grass.
 *
 * One merged geometry, one material, one draw call. Scatter as many as the
 * level needs: two patches of different seeds share no blade, no clump layout
 * and no colour, and overlapping them is how a layout generator gets a thicket.
 *
 * @param {object}  opts
 * @param {number}  opts.seed     every blade, clump and colour hangs off this
 * @param {number}  opts.radius   world units; the disc the CLUMPS are scattered
 *                                in. The finished patch covers about half as
 *                                much again, because the blades of a rim clump
 *                                reach out past their own foot and the height
 *                                settle scales x and z with y; size.reach is
 *                                the measured number and is the one to space
 *                                patches by
 * @param {number}  opts.density  clumps per unit area, relative to the default
 * @param {number}  opts.scale    applied to the whole group
 * @returns {{ group: THREE.Group, size: object, update: Function, dispose: Function }}
 */
export function createGrassPatch({ seed = 1, radius = 1.0, density = 1, scale = 1 } = {}) {
  const r = Math.max(0.04, radius);
  const sites = scatterClumps(foliageRng(seed * 2654435761 + 41), r, Math.max(0.05, density));
  if (!sites.length) sites.push({ x: 0, z: 0 });
  return buildGrass({
    seed, radius: r, scale, sites,
    strays: Math.round(sites.length * STRAY_SHARE),
  });
}

/**
 * One clump on its own: for edging a kerb, filling the angle behind a headstone
 * or dressing the lip of a grave, where a whole patch will not fit.
 *
 * Same primitive, same wind, same palette. It is a patch of one site rather
 * than a different prop, so a tuft placed against a patch is visibly the same
 * grass.
 *
 * @param {object} opts
 * @param {number} opts.seed
 * @param {number} opts.scale
 * @returns {{ group: THREE.Group, size: object, update: Function, dispose: Function }}
 */
export function createGrassTuft({ seed = 1, scale = 1 } = {}) {
  return buildGrass({
    seed,
    radius: 0.10,
    scale,
    sites: [{ x: 0, z: 0, spread: 1.15, vigour: 0.78 }],
  });
}
