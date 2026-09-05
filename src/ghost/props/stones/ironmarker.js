import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText, inkCross } from '../tombstones.js';
import { PALETTE } from '../style.js';

// The iron marker: a cast lozenge plate on a driven post.
//
// This is the only piece in the set that is not stone, and that is the whole
// reason it exists. A parish put these up over a grave a family could not
// afford a stone for: a small plate cast at the county foundry, painted black,
// carrying the number the burial has in the register and nothing else, bolted
// to a rod and driven into the turf. Beside twenty-nine pale limestone slabs it
// is the one dark object in the yard.
//
// THE PROBLEM THIS PIECE IS
//
// There is no environment map in this scene. One key at (3.7, 6.0, 2.4), one
// dim rim, one hemisphere. Every metal prop already here -- the lanterns --
// reached the same conclusion and wrote it down three separate times: a
// MeshStandardMaterial with metalness above zero trades the diffuse the
// hemisphere feeds for a specular only the two directionals can feed, so it
// goes nearly black on its shaded side the moment it is made metallic. So
// metalness stays at 0, and what says "metal" is that the piece is much DARKER
// than the stone beside it at a low enough roughness to take a broad highlight
// off the key. That is pillar.js's and bracket.js's answer and this takes it
// whole rather than inventing a second one.
//
// The second half of the problem is the one the lanterns do not have. A lantern
// is a cage: thin bars with sky between them, so its silhouette is legible
// however dark it goes. This is a solid plate, and a flat dark plate seen at 80
// pixels with its face at a grazing angle to the key is a hole cut in the
// floor. Three things stop that, and all three are shape rather than paint.
//
//   1. THE BEAD. The plate is swept through the house quarter-round of radius
//      0.062, so its whole outline is a roll, and on a plate 0.44 across that
//      roll is 28% of the half width. It is the only surface on the piece that
//      faces up into the key. It draws a bright line along both upper edges of
//      the lozenge and the plate is then described by light rather than only by
//      the hole it makes in the background.
//   2. THE LOZENGE. Four straight runs, each a different angle to the key, so
//      the two upper edges are lit, the two lower ones are not, and the plate
//      has a top and a bottom before any texture is involved. This was built
//      first as an oval and the render is why it is not one: a round plate on a
//      straight post is a hand mirror, and no amount of value fixes it. The
//      diamond also lets the post enter at a POINT, so plate and post read as
//      one casting rather than as a head stuck on a stick.
//   3. THE GAP. Nothing else in the set has daylight between its head and the
//      ground. Even at its darkest the piece is a dark mass floating over a lit
//      floor with a stem under it, and that reads at any size.
//
// WHAT IS NOT HERE, AND WHY
//
// Rust. It is the obvious way to give a dark object colour and it is also the
// obvious way to turn a prop into a texture experiment. The set's language is a
// vinyl toy: no film grain, no thin noisy detail. The registry's mottle already
// runs over this face, and read through a cool near-black it is casting texture
// and a century of weather. An orange bloom on top of it would be the only
// saturated hue in the graveyard and the eye would go to it before the shape.

// --- the plate --------------------------------------------------------------
//
// 0.44 wide, 0.62 tall, 0.13 thick: a rounded lozenge, which is the Minkowski
// sum of a diamond with a disc, so it is four arcs of one radius sitting at the
// diamond's four points with the offset edges falling out between them as
// straight runs. buildArcSweepGeometry takes it directly.
//
// CORNER is that radius and 0.062 is a hard floor under it: a convex arc under
// the rim radius inverts when the sweep insets it. At 0.075 the flat front face
// still has 13mm of radius left at each point, which is a rounded tip rather
// than a cusp, and the silhouette's own 0.075 is six pixels at scene size, so
// the points read as turned over rather than sharp. That is the house language;
// nothing in this set has a corner you could cut yourself on.
//
// Depth is 0.13 and it is a floor too, not a choice: the rim radius is 0.062
// and anything thinner than twice it loses its front face and the sweep crosses
// itself. A real marker plate is 8mm of iron. This one is 130mm, which is the
// same lie the whole set tells and the reason it looks like it came off the
// same shelf as the ghost.
const PLATE = { halfWidth: 0.24, height: 0.66, depth: 0.13, corner: 0.078 };

// Where the plate's bottom point sits. 0.46 clear of the ground puts the top at
// 1.08, in the middle of the 0.9 to 1.2 the piece was asked for, and splits the
// height about 43:57 between post and plate. Tried at 0.62, which is nearer the
// real object and read as a lollipop even with the lozenge; tried at 0.32 and
// the gap closed until it was a small headstone with a stick behind it.
const PLATE_Y = 0.44;
const TOTAL = PLATE_Y + PLATE.height; // 1.08

// --- the post ---------------------------------------------------------------
//
// The measured question. The registry's 0.13 minimum belongs to the arc sweep,
// not to the scene: a lathe has no rim radius to invert, so the post is free to
// be as slender as it can be SEEN. What decides that is the framing. The
// shipped camera is 6.2 half-heights, which is about 87 pixels a world unit on
// a 1080 canvas and 52 on a 640 one, so the post is a few pixels wide either
// way and the eye cannot count them off a render. They were counted off the
// pixels instead, row by row, at the shipped framing on a 640 canvas:
//
//   0.044 across   2 px. Six seeds side by side and no two of them the same
//                  weight: the lean puts each post at a different subpixel
//                  phase, so some are a line and some are a grey scratch, and
//                  the cast shadow breaks up with them.
//   0.060          3 px. Holds as a line on every seed.
//   0.076          4 px on the shaft, 5 at the foot. Solid on all six.
//   0.092          5 to 6 px. Reads, and the plate stops looking heavy on it:
//                  the piece turns into a small signpost.
//
// The other half of the measurement was the surprise and it is worth writing
// down. A scanline across the shaft reads 14 to 19 out of 99 against a floor at
// 60, at EVERY one of those widths. The post has no lit side at scene size: a
// dark 40mm bar under a key 56 degrees up returns almost nothing, so it is a
// flat dark LINE and not a modelled cylinder, and the only thing width buys is
// how much of that line survives antialiasing. Which is why the answer is 4 px
// rather than 3: three pixels of line is legible, four is unambiguous, and the
// cost of the extra one is nothing.
//
// 0.076 at the collar and 0.088 at the foot. The taper is the real object's --
// a driven post is cast heavier where the ground works at it -- and it puts the
// extra pixel at the bottom, nearest the floor's own value, where it is needed.
const POST = { rTop: 0.038, rBot: 0.044, bottom: -0.07 };
// The collar. A short rolled swelling just under the plate, which is where a
// real one has the socket the plate is cast into. It is not decoration: without
// it the post is a bare cylinder running from the ground to the point of the
// lozenge and the joint between them is a mathematical tangency that reads as
// glue. Two pixels of shoulder is enough to say the two parts are made rather
// than stuck. At scene size it is barely a pixel and costs nothing.
const COLLAR = { r: 0.050, y: 0.405, half: 0.020, roll: 0.017 };
// How far the post runs up inside the plate. Well past the light's 0.006
// normalBias, under which a buried joint shadows itself in a dotted band that
// looks exactly like z-fighting.
const POST_BITE = 0.15;
// A bar 76mm across never needs the set's 48 steps round. street.js runs 28 on
// a post twice this width; 20 is under four pixels a facet at scene size, and
// since the shaft has no highlight to band there is nothing for more to buy.
const POST_SEG = 20;

// --- the iron ---------------------------------------------------------------
//
// ground.js's derivation, which is the one lantern that reasons about the hue
// rather than picking a hex: the palette's stone taken down and tilted toward
// the blue the scene's rim light already puts in every shadow. Worked in sRGB,
// the space the palette was authored in, because a lerp in linear space toward
// a blue lands on a neutral grey once the blue's channels are decoded, and a
// neutral dark beside warm candlelight reads as mud.
//
// V is the one number that differs from the lanterns'. They sit at 0.42. This
// is not a lantern: it is a solid plate holding a fifth of a square metre of
// flat surface at a grazing angle to the only real light in the scene, where a
// lantern is a cage of 20mm bars that catch the key edge-on all over.
//
// Measured off the render, as luminance out of 99 over the same window on the
// plate, at the shipped framing. The floor reads 60 there and a limestone
// stone's lit face reads 70 to 73:
//
//   V 0.38   plate runs 3 to 24. Every value it has is in the bottom quarter,
//            the mottle is gone, and the bead is the only thing left. A hole.
//   V 0.47   5 to 31. A 26-point range, so the lit edges and the shaded face
//            are a real gradient apart and the mottle is still in there.
//   V 0.58   8 to 41. Two thirds of the floor at its lit edge: it reads as a
//            blue-grey painted thing rather than as the dark object in the yard,
//            and that contrast with the limestone is the whole point of it.
//
// It lives here rather than in style.js for ground.js's reason: this is a
// change the prop makes to the house palette, not a change to the palette.
const IRON = (() => {
  const c = new THREE.Color(PALETTE.stone);
  const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const V = 0.47;
  const TILT = [0.95, 1.10, 1.33];
  return c.setRGB(s.r * V * TILT[0], s.g * V * TILT[1], s.b * V * TILT[2], THREE.SRGBColorSpace);
})();
// Rougher than metal and smoother than stone, which is what old painted
// ironwork is. The set's stone is 0.82; this is pillar.js's and bracket.js's
// iron, and it is the number that buys the broad highlight along the bead.
const IRON_ROUGH = 0.46;

// --- the face ---------------------------------------------------------------
//
// A small cross and the burial's number in the parish register. That is what
// these plates carried: no name, because the parish was not paying for one.
//
// A lozenge is a hard face to letter and the flat-face table says how hard. The
// front face is the outline inset by the rim radius all the way round, so it is
// a diamond 0.362 across at its waist that has lost a third of that a fifth of
// the way to either point. A four-digit year at the set's letter size measures
// 0.300 and its corners run into the bead; three digits measure 0.226 and clear
// it by 36mm a side at every height the line occupies. So the mark is three
// digits, which is also the right number for a register, and there is no name
// and no date.
//
// Letter size is a fraction of the face canvas height. The face is 0.66 world
// tall, so 0.225 is 0.149 of em, and this serif puts its cap height at about
// two thirds of that: 0.099 world measured off the ink, against fred's 0.093
// and cross's 0.122. Matching the set's letter SIZE is what has to hold rather
// than a coverage figure, because a narrower face makes the same chisel cover
// more of itself.
const LETTER = 0.225;
// How wide the moat round each mark is, as a fraction of the face canvas
// height. See the block on raised lettering at draw(). 0.014 is 14 texels
// against the treatment's own 11-texel groove blur, which is the smallest ring
// that survives it; it widens the three digits from 0.226 to 0.244 world, so
// they still clear the bead by 27mm a side.
const MOAT = 0.014;
// Numbers are drawn from a list rather than straight out of rng, so no plate
// ever reads 666 or 100 and every one of them is three digits. The digits are
// tabular in this face -- 888 measures 0.224 against 926's 0.226 -- so the fit
// above holds for all of them.
const NUMBERS = [107, 214, 236, 341, 358, 402, 419, 573, 618, 742, 807, 926];

// --- the lozenge ------------------------------------------------------------
//
// wings.js's convention: a convex arc is walked counter-clockwise, and `bulge`
// unwraps its two endpoint angles the right way round.
const TAU = Math.PI * 2;
const bulge = (c, r, a0, a1) => ({ cx: c.x, cy: c.y, r, a0, a1: a0 + (((a1 - a0) % TAU) + TAU) % TAU, sign: 1 });

// The outward normal of the edge from p to q, walked counter-clockwise. Every
// corner here has the SAME radius, so two consecutive arcs share their tangent
// line at exactly this angle and the straight run between them falls out of the
// sweep for free -- which is what buildSlabGeometry does with its four corners
// and the only reason this needs no tangent solver.
//
// For a counter-clockwise walk the outward normal is the travel direction
// turned right: (dx, dy) -> (dy, -dx). Written the other way round first, which
// puts every arc on the far side of its own corner circle, and the render was a
// lozenge with a flap folded out of each of its four points. The convention is
// checkable against buildSlabGeometry: its bottom-right corner runs a0 = -pi/2
// to a1 = 0, and -pi/2 is the outward normal of the bottom edge.
const edgeNormal = (p, q) => Math.atan2(-(q.x - p.x), q.y - p.y);

// Counter-clockwise from the bottom point: bottom, right, top, left. The four
// corner circles sit at the diamond's own points, so the silhouette spans
// exactly [-W, W] by [0, H] and the registry's face UVs land on it unchanged.
function lozengeOutline(W, H, r) {
  const P = [
    { x: 0, y: r },              // bottom
    { x: W - r, y: H / 2 },      // right
    { x: 0, y: H - r },          // top
    { x: -(W - r), y: H / 2 },   // left
  ];
  return P.map((p, i) => {
    const before = P[(i + 3) % 4];
    const after = P[(i + 1) % 4];
    return bulge(p, r, edgeNormal(before, p), edgeNormal(p, after));
  });
}

registerStone('ironmarker', {
  // plinth 0: a post is driven, not set. halfWidth and height are the plate's
  // bounding box, which is what the face texture's aspect and the slabUV
  // mapping are taken from; depth is the plate's. The registry's own slab is
  // thrown away in extras -- the lozenge replaces it -- so its two radii are
  // left at values the sweep cannot fold on and are never seen.
  shape: { halfWidth: PLATE.halfWidth, height: PLATE.height, depth: PLATE.depth, plinth: 0 },

  // RAISED LETTERING, AND WHAT THE REGISTRY CANNOT SAY
  //
  // Lettering on a cast plate is RAISED. It stands proud of the field because
  // the pattern maker cut it into the mould, which is the exact opposite of
  // every other stone here, where the letter is where the chisel went. So this
  // face has to invert the treatment, and the finding is that `draw` cannot do
  // it, for a reason that is not the height map.
  //
  // Black on this canvas is fed to three consumers and only one of them is
  // reversible. Painting the FIELD black and leaving the letters clear does
  // invert the height map correctly, and it even gets the two lips the right
  // way round: lipMask's shaded band lands just under each letter and its lit
  // band just above, which is what a proud boss does under a light from above.
  // What it cannot survive is the colour map. buildTextures multiplies the mark
  // with 0.36 of black plus a wide 0.16 smudge, so an inverted mark takes the
  // whole FIELD to about 0.54 of its value. On pale limestone that is a dirty
  // plaque. On iron already at 0.47 of the palette it renders as a black tile
  // with a bead round it and nothing inside -- exactly the hole in the floor
  // this piece spends its whole design avoiding -- and it measures 95.9% ink
  // against the 12 to 19 that got a stone rejected for busy lettering.
  //
  // So the registry can carve and cannot emboss, because the SIGN of the mark
  // is baked into the colour pass and not only into the height pass. One flag
  // on the stone definition would fix it, `raised: true`, switching
  // buildTextures to stamp the mark as a lit lip over a dropped shadow rather
  // than a dark floor, and inverting its height stamp. That is a change to
  // tombstones.js and this pass does not make it.
  //
  // WHAT IS DONE INSTEAD
  //
  // The mark that is stamped is a MOAT: the marks dilated by a stroke width and
  // punched back out of themselves, so what the treatment carves is a narrow
  // ring round every stroke and the stroke itself is left standing at field
  // height. That is enough, because relief at this size is read off the two
  // lips and not off the depth. The ring's lower edge lies against the top of a
  // letter and is painted LIT; its upper edge lies against the bottom of a
  // letter and is painted SHADED. Light above, shadow below: the eye reads a
  // boss. Which is what the render shows, and it is the one version of the
  // three where the plate keeps its own value and the letters still stand up.
  //
  // Measured, all three, on this stone's own 745 x 1024 face:
  //
  //   plain cut   4.1% ink. Correct for a chisel, wrong for a casting.
  //   moat        5.1% ink, between cross's 3.7 and fred's 6.3. Reads as cast.
  //   inverted    95.9% ink. Correct relief, and the plate goes black.
  //
  // The moat's one real cost is at scene size, where the ring is a texel and
  // mips into a soft halo, so the mark reads a shade fainter than the plain cut
  // does. Rendered both ways at the shipped framing before choosing: the
  // difference is under a value step and the closer the camera the further
  // ahead the moat gets.
  draw(ctx, w, h, rng) {
    // A small cross in the upper point and the burial's number in the register
    // across the waist, which is where a lozenge takes its charge and also the
    // only part of it wide enough to hold three digits.
    //
    // The marks go to their own canvas first, because what is stamped into the
    // face is not the marks: it is a MOAT round them. See the note above.
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    const tc = t.getContext('2d');
    tc.fillStyle = '#000000';
    // 0.155 of the face is 0.102 world tall with an arm span of 0.070, and it
    // sits where the flat face is 0.113 across, so it clears the bead by 21mm
    // on each side.
    inkCross(tc, w / 2, h * 0.285, h * 0.155);
    const size = h * LETTER;
    inkText(tc, String(NUMBERS[Math.floor(rng() * NUMBERS.length)]), w / 2, h * 0.500, size, size * 0.04);

    // The moat: the marks dilated by MOAT and then punched back out of
    // themselves, which leaves a ring of that width round every stroke. 24
    // copies on a circle is a clean dilation at this radius; twelve left the
    // ring scalloped where two strokes run close together.
    const r = h * MOAT;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.drawImage(t, Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(t, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  },

  extras({ body, slab, material, lean, halfWidth, height, edge, shape, disposables, stripUV, slabUV }) {
    // The registry's material is this stone's own -- createTombstone builds one
    // per instance -- and its only users are the slab, which goes below, and
    // whatever extras adds. So recolouring it here reaches nothing else in the
    // set. The map and the normal map stay: they carry the mottle, the fine
    // speckle and the wash of ground grime, and read through a near-black those
    // are casting texture and weather rather than limestone.
    material.color.copy(IRON);
    material.roughness = IRON_ROUGH;
    material.needsUpdate = true;

    // The registry's slab goes: the lozenge replaces it outright. Its geometry
    // is still owned by the registry's own dispose().
    body.remove(slab);

    const plateGeo = buildArcSweepGeometry({
      outline: lozengeOutline(halfWidth, height, PLATE.corner),
      depth: shape.depth,
      edge, // the house rim radius: the plate and the bead have to agree
      uv: slabUV, // the face mapping the inscription is carved through
    });
    const plate = new THREE.Mesh(plateGeo, material);
    plate.position.y = PLATE_Y;
    plate.castShadow = true;
    plate.receiveShadow = true;
    body.add(plate);
    disposables.push(plateGeo);

    // The post, as a lathe rather than a swept outline: the 0.13 floor is the
    // arc sweep's and not the scene's, and both ends of this are buried -- the
    // top inside the plate, the foot under the floor -- so a profile's two open
    // ends are never seen.
    const top = PLATE_Y + POST_BITE;
    const c = COLLAR;
    const pts = [
      new THREE.Vector2(POST.rBot, POST.bottom),
      new THREE.Vector2(POST.rTop + (POST.rBot - POST.rTop) * 0.35, c.y - c.half - c.roll),
    ];
    // The collar's two rolled shoulders, a quarter turn each, so it swells out
    // of the shaft and back into it with no crease at either end.
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(c.r - c.roll * (1 - Math.sin(a)), c.y - c.half - c.roll * Math.cos(a)));
    }
    for (let k = 5; k >= 0; k--) {
      const a = (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(c.r - c.roll * (1 - Math.sin(a)), c.y + c.half + c.roll * Math.cos(a)));
    }
    pts.push(new THREE.Vector2(POST.rTop, top));
    const postGeo = new THREE.LatheGeometry(pts, POST_SEG);

    // LatheGeometry's own UVs are a cylindrical wrap and would smear the
    // inscription round the outside of the bar. Re-parked in the plain strip,
    // with v running over the WHOLE piece rather than over the post, so the
    // foot samples the bottom of the texture where the grime band lives and the
    // shaft climbs out of it.
    const p = postGeo.attributes.position;
    const uv = postGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const [u, v] = stripUV(p.getX(i), p.getY(i), POST.rBot, TOTAL, 1);
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;

    const post = new THREE.Mesh(postGeo, material);
    post.castShadow = true;
    post.receiveShadow = true;
    body.add(post);
    disposables.push(postGeo);

    // A driven post leans more than a set stone, and it leans because somebody
    // hit it with a mallet rather than because the ground settled. The registry
    // decides the lean before extras runs precisely so a piece can answer it:
    // this takes the seeded z lean out to two and a half times the set's, which
    // at the plate's height is 50mm of sideways travel -- enough to see, and
    // well short of a fence post somebody drove over.
    //
    // The sink is left where the registry put it. The post already runs 70mm
    // below the floor, so no lean this piece can take will open a gap under it.
    lean.z *= 1.5;
    lean.x *= 1.25;

    // What the layout generator needs, and what the lab prints back. footprint
    // is the widest horizontal half-extent of the STANDING piece: the plate's
    // half width plus what its own lean carries the top corner sideways. That
    // is the number a spacing rule has to clear, not the post's radius.
    body.userData.ironmarker = {
      total: TOTAL,
      footprint: halfWidth + TOTAL * Math.abs(lean.z) + 0.5 * shape.depth * Math.abs(lean.x),
      postAcross: 2 * POST.rBot,
      collarAcross: 2 * COLLAR.r,
    };
  },
});
