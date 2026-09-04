import * as THREE from 'three';
import { registerStone, buildSlabGeometry, inkCross } from '../tombstones.js';
import { PALETTE, toyMaterial } from '../style.js';

// A kerbed grave surround: a low kerb of stone laid round a whole plot, a small
// tablet standing on the head kerb, and the space inside filled with chippings.
//
// Every other piece in the set is an object standing on the ground. This one is
// a FOOTPRINT, and that is the only reason it exists: six uprights read as six
// markers dotted about, and one plot with its ground claimed reads as a
// graveyard that was laid out. So it is authored in plan first, and the tablet
// is deliberately the smallest in the set, because on a real kerb set the head
// is a modest stone and the plot is the monument.
//
// Four decisions the piece is made of.
//
// 1. The plot runs FORWARD from the tablet, toward the camera, never behind it.
//    A grave is read from its foot: you stand beyond the kerb and look up the
//    plot at the stone. Laid the other way the whole footprint would hide
//    behind the one thing that is meant to be standing at the head of it.
//
// 2. The tablet stands ON the head kerb, which is a deeper, taller stone than
//    the other three. This is what a real kerb set does, and it also settles an
//    argument the first version lost: a plot a metre wide with a fat kerb down
//    each side leaves an interior narrower than the stone's own plinth, so a
//    tablet set on the ground inside the frame had its plinth growing straight
//    through both side rails. Raised onto the head kerb it is one piece of
//    masonry with the frame instead of an upright dropped into a tray.
//
// 3. Four bars, butted, not a moulded picture frame. A kerb set is four dressed
//    stones with mason's joints in it: the head kerb runs the full width, the
//    side rails butt into its front face, the foot kerb butts between the
//    rails, and each is out of true by its own fraction of a degree.
//
// 4. The fill is FLAT. ledger.js spent five passes proving that a dome lit by
//    this key comes out DARKER than the flat floor whatever colour it is given,
//    so a heap of chippings would have read as a dark closed shape sitting
//    inside the kerb: a stain in a frame. So the chippings are a flat bed set
//    level with the middle of the kerb, in a warm grey a step lighter than the
//    floor, carrying their grain in colour only. A flat up-facing surface takes
//    exactly the light the floor takes, so its tone is decided by its own
//    colour and nothing else, which is the whole reason this survives where a
//    mound could not: measured, the bed reads 160 against the floor's 145 and
//    the kerb's lit top at 187, so it sits between its frame and the turf
//    rather than as a hole in either. The only relief inside the kerb is the
//    kerb's own shadow falling across it.

// --- the plot ---------------------------------------------------------------
//
// 2.15 by 0.95, which is a real grave plot and by a distance the largest
// footprint in the set. The length is a shade over the nominal two because of
// what this camera does to it: the plot points at the viewer, so its length is
// foreshortened to 48% while its width is not, and a true 2 by 1 comes out
// almost square on screen. At 2.15 the interior reads about 1.6 to 1 in the
// frame, which is enough to say "plot" rather than "tray".
//
// Checked at the scene's own 6.2 view half-height and not only in close-up,
// because that is the framing where a footprint either lays the ground out or
// swallows it. It lands about a sixth of the frame's height: it claims ground,
// it does not take over.
const PLOT_L = 2.35; // head to foot, along +z, out toward the viewer
const PLOT_W = 0.90;
const BAR_W = 0.18; // side and foot kerb, seen from above
const BAR_H = 0.15; // and standing proud of the turf
// The head kerb is the base stone: it runs the full width of the plot, stands a
// little taller than the other three so the head has some weight to it, and is
// deep enough that the tablet's plinth sits well inside its footprint. Half way
// between the two, the plinth and the kerb read as one doubled ledge with a
// stone balanced on it rather than as a stone set on a base.
const HEAD_D = 0.44;
const HEAD_H = 0.175;
// Bedded, not placed on top. It also buys the piece its tolerance: the registry
// applies a seeded lean AFTER extras runs, and across a 2.15 footprint a lean of
// 0.03 radians lifts the foot end by 6 cm. Sunk this far the foot is still in
// the ground at the worst draw, and the near-far difference in how deep the
// kerb sits reads as a century of settling.
const SINK = 0.05;
// How far the rails run into their neighbours. Two rounded bars merely touching
// leave a crack of floor showing at the joint the moment the lean tips them.
const LAP = 0.035;
// The bed laps further, and it has to: its own corners are rounded like
// everything else here, and a corner radius wider than the lap leaves a wedge
// of bare floor showing INSIDE the frame at each corner. So the lap is set
// past the radius and the rounding is spent entirely under the kerb.
const BED_LAP = 0.075;
const BED_R = 0.055;

const HEAD_Z = -0.21; // outer face of the head kerb, behind the tablet
const FOOT_Z = HEAD_Z + PLOT_L;
const RAIL_Z0 = HEAD_Z + HEAD_D - LAP; // rails start inside the head kerb

// The bed of chippings. BED_TOP is the surface height above the floor, and it
// is the number that matters: the kerb stands 0.10 proud of the turf, so half
// of that is a plot filled to the middle of its kerb. Filled to the top it
// reads as a solid slab with a rim, and a skim in the bottom of a deep tray
// reads as a box. The pad has real thickness under it, enough that its own
// rounded rim finishes below the floor and never shows a lip.
//
// This is also the one number that has to be set from the floor rather than
// from the pad's centre. Written as a centre height it put the surface 8 mm up,
// which sank the pad's rounded corners BELOW the floor: the floor then drew
// over them and a wedge of bare turf appeared inside the frame at each corner.
const BED_TOP = 0.045;
const BED_H = 0.075;

registerStone('kerb', {
  // The smallest tablet in the set on purpose: 0.83 of its own plus the height
  // of the head kerb it stands on, against 1.56 for the cross. That is the
  // proportion a kerb set really has. The face is 0.60 by 0.70, so the
  // inscription canvas comes out 878 px wide, well clear of the 500 px floor
  // the engraving treatment needs.
  shape: { halfWidth: 0.30, height: 0.70, depth: 0.18, plinth: 0.13 },
  // A true half-round arch, the set's own default. The silhouette is not where
  // this piece spends its difference: the tablet stays family, and what is new
  // is all on the ground around it.
  topRadius: 0.30,
  bottomRadius: 0.08,

  // One cross and nothing else. There is already a great deal happening at
  // ground level, so the tablet carries the quietest face in the set: 5.9% of
  // the face measured, against 3.6, 6.3 and 9.1 for the approved three, in a
  // bounding box 33% of the face wide by 42% tall.
  draw(ctx, w, h) {
    inkCross(ctx, w / 2, h * 0.46, h * 0.42);
  },

  extras({ body, material, rng, plinthH, disposables, stripUV }) {
    // --- the tablet onto the head kerb ---------------------------------------
    //
    // The registry has already built the slab and the plinth and stood them on
    // the floor. They are told apart by where they sit rather than by the order
    // they arrive in, as ledger.js does, and both go up by the same lift so the
    // stone keeps its own proportions.
    const meshes = body.children.filter((o) => o.isMesh);
    const slab = meshes.find((m) => Math.abs(m.position.y - plinthH) < 1e-6) || meshes[0];
    const plinth = meshes.find((m) => m !== slab);
    // Bedded 25 mm into the head kerb's top, so the joint is mortared rather
    // than balanced: the kerb's top is rounded, and a plinth resting exactly on
    // the tangent point would show daylight under its corners.
    const lift = HEAD_H - SINK - 0.025;
    slab.position.y += lift;
    if (plinth) plinth.position.y += lift;

    const kerb = new THREE.Group();
    body.add(kerb);

    // --- the four bars -------------------------------------------------------
    //
    // Every bar is the house's own swept slab: a rounded rectangle in the
    // outline swept through a quarter-round, so a bar is round in both sections
    // and there is not a hard edge anywhere on it. The corner radii are run up
    // near the builder's clamp, which leaves a few millimetres of flat on the
    // top and reads as a fat vinyl bar. The first pass took them to the clamp
    // exactly, and a bar with a circular section reads as a length of pipe
    // rather than a dressed stone.
    const barGeo = (halfLength, height, width) =>
      buildSlabGeometry({
        halfWidth: halfLength,
        height,
        depth: width,
        edge: Math.min(0.055, width / 2 - 0.03),
        bottomRadius: height * 0.47,
        topRadius: height * 0.47,
        // Parked in the plain strip: a bar sampling the front face would carry
        // the tablet's cross smeared along it. Only the bottom fifth of the
        // strip is used, which is the band the registry's own plinth samples:
        // it is nothing but the ground-grime wash, and it exists because an
        // up-facing slab of clean stone reads as a whiter MATERIAL than the
        // stone above it. A kerb lying in the grass is the dirtiest thing on
        // the piece, so it gets the same band, and the first pass, which took
        // the full height of the strip, came out whiter than the tablet.
        uv: (x, y) => stripUV(x, y, halfLength, height, 0.2),
      });

    const railLen = FOOT_Z - RAIL_Z0;
    const railGeo = barGeo(railLen / 2, BAR_H, BAR_W);
    const headGeo = barGeo(PLOT_W / 2, HEAD_H, HEAD_D);
    const footGeo = barGeo(PLOT_W / 2 - BAR_W + LAP, BAR_H, BAR_W);
    disposables.push(railGeo, headGeo, footGeo);

    const railX = PLOT_W / 2 - BAR_W / 2;
    const place = [
      { geo: railGeo, x: -railX, z: RAIL_Z0 + railLen / 2, yaw: Math.PI / 2 },
      { geo: railGeo, x: railX, z: RAIL_Z0 + railLen / 2, yaw: Math.PI / 2 },
      { geo: headGeo, x: 0, z: HEAD_Z + HEAD_D / 2, yaw: 0 },
      { geo: footGeo, x: 0, z: FOOT_Z - BAR_W / 2, yaw: 0 },
    ];
    for (const p of place) {
      const bar = new THREE.Mesh(p.geo, material);
      // Hand-laid, with a century of frost under it. Each stone is out of true
      // by well under a degree and sits a few millimetres deeper than its
      // neighbour: enough to say "four stones" rather than "one moulding", and
      // never enough to break the rectangle, which is the thing being sold.
      bar.rotation.y = p.yaw + (rng() - 0.5) * 0.022;
      bar.position.set(p.x + (rng() - 0.5) * 0.010, -SINK - rng() * 0.014, p.z + (rng() - 0.5) * 0.010);
      bar.castShadow = true;
      bar.receiveShadow = true;
      kerb.add(bar);
    }

    // --- the bed of chippings ------------------------------------------------
    //
    // Flat, for the reason set out at the top of the file. Nothing stands up
    // out of the plot either: low corner posts at the foot were tried, which is
    // a thing real kerb sets have, and from this camera they are seen from
    // behind and above and come out as two nubs on the foot kerb. They cluttered
    // the one end of the piece that is nearest the viewer and bought no
    // silhouette at all, so the frame stays four bars and a bed. It gets its own
    // material because grey headstone chippings inside a grey headstone kerb
    // leave the plot reading as one solid slab, and its colour is taken FROM
    // the shared stone rather than invented, so it cannot drift away from the
    // set: the same stone, a shade darker and dustier, which is what a bed of
    // broken-up stone is.
    const bedColour = material.color.clone().multiplyScalar(0.90).lerp(new THREE.Color(PALETTE.stoneEngrave), 0.10);
    const grain = chippingTexture();
    const bedMaterial = toyMaterial(bedColour, { map: grain, roughness: 0.95 });
    disposables.push(bedMaterial);
    if (grain) disposables.push(grain);

    const bedHalfW = PLOT_W / 2 - BAR_W + BED_LAP;
    const bedZ0 = HEAD_Z + HEAD_D - BED_LAP;
    const bedLen = FOOT_Z - BAR_W + BED_LAP - bedZ0;
    // One tile of chippings per 1.15 units. Set at 0.55 first, which put a chip
    // at a realistic 13 mm and, at the size this prop is actually seen, turned
    // the bed into fine speckle: sandpaper, not stone. Chips here run 30 to
    // 65 mm, larger than life in exactly the way the set's corner radii are,
    // and at that size they are still chips rather than cobbles from across the
    // graveyard while reading as loose stone with a shadow each in close-up.
    const TILE = 1.15;
    const bedGeo = buildSlabGeometry({
      halfWidth: bedHalfW,
      height: bedLen,
      depth: BED_H,
      edge: 0.024,
      bottomRadius: BED_R,
      topRadius: BED_R,
      uv: (x, y) => [(x + bedHalfW) / TILE, y / TILE],
    });
    disposables.push(bedGeo);

    const bed = new THREE.Mesh(bedGeo, bedMaterial);
    // Laid face up. Rotating -90 about x sends the builder's y down -z and its
    // depth up into y, so the pad spans z in [-bedLen, 0] and y in [-BED_H/2,
    // BED_H/2]: hence the half-thickness offset and the length shift.
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(0, BED_TOP - BED_H / 2, bedZ0 + bedLen);
    bed.receiveShadow = true; // the kerb's shadow across it is the only relief
    kerb.add(bed); // the bed is allowed to have
  },
});

// Chippings, as colour only.
//
// No normal map and no height on this: the mottling in tombstones.js carries
// the same warning, and a bed of chips is exactly the high-frequency field that
// comes back through normals as sandpaper. What survives at scene scale is tone
// anyway, so tone is all this paints, and it is painted on white because the
// colour lives on the material.
//
// Each chip is a small ellipse with a darker one set a couple of pixels behind
// it, which is enough crumb to read as loose stone close up. Contrast is kept
// low deliberately: pushed harder the plot goes speckled and busy, which is the
// exact note that sank the last stone set.
function chippingTexture() {
  if (typeof document === 'undefined') return null;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);

  // Fixed seed. Two kerbs in one graveyard differ in their lean and in how each
  // bar has settled, but there is no reading of a gravel bed at this size that
  // a second noise field would improve, and one texture for the set is one
  // texture uploaded.
  let a = 0x9e3779b9;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // A slow swell underneath, so the bed is not one flat tone across its whole
  // length. Drawn wrapped in nine copies, so the tile has no seam.
  const WRAP9 = [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]];
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = (0.12 + rnd() * 0.22) * S;
    const dark = rnd() < 0.5;
    const squash = 0.6 + rnd() * 0.7;
    const rot = rnd() * Math.PI;
    for (const [ox, oy] of WRAP9) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, dark ? 'rgba(122,118,112,0.16)' : 'rgba(255,255,255,0.20)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The chips. Dense enough that they lie against each other: scattered thinly
  // they read as spots ON something rather than as a surface made of them.
  for (let i = 0; i < 1150; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 6.5 + rnd() * 8.0;
    const squash = 0.62 + rnd() * 0.5;
    const rot = rnd() * Math.PI;
    const tone = rnd();
    for (const [ox, oy] of WRAP9) {
      const px = x + ox;
      const py = y + oy;
      if (px < -25 || px > S + 25 || py < -25 || py > S + 25) continue;
      ctx.fillStyle = 'rgba(104,101,96,0.13)';
      ctx.beginPath();
      ctx.ellipse(px + 2.0, py + 2.8, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tone < 0.45
        ? `rgba(255,255,255,${0.10 + tone * 0.18})`
        : `rgba(150,146,139,${0.06 + (tone - 0.45) * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
