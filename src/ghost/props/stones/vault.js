import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerStone, buildSlabGeometry, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The family vault: a little mausoleum, and the one piece of ARCHITECTURE in a
// set of twenty-three slabs.
//
// A gabled stone box on a base course, an arched doorway recessed into the
// front of it, an anta at each front corner, and a pedimented roof that
// oversails on all four sides. It has to read as a BUILDING at a glance, not as
// a big headstone, and everything below is spent on that one distinction.
//
// WHAT MAKES IT A BUILDING AND NOT A BOX, IN ORDER OF HOW MUCH IT CARRIES
//
// 1. The roof oversails. A gable flush with its walls is a chamfered lid; a
//    gable standing 0.10 out past them on every side throws a shadow line right
//    across the head of the facade and along both flanks, and that line is the
//    single strongest "building" cue at scene size. It is also the reason the
//    roof is one solid prism swept through Z rather than a moulding: see below.
// 2. The doorway is a real hole with a real reveal. Not ink, not a panel: the
//    front wall is swept from an outline with an arched notch bitten out of the
//    bottom of it, so the opening goes through the stone and the door leaf
//    behind it stands 0.13 back. The lit jamb on one side and the shaded one on
//    the other are what a painted rectangle can never have.
// 3. The plan is nearly square, 1.26 by 1.24. A vault with a shallow depth is a
//    facade, and from a camera at 29 degrees a facade reads as a stage flat.
//    This one is as deep as it is wide and the roof is deeper still.
//
// AND THE FOURTH ELEMENT THAT IS NOT HERE
//
// Antae, pediment, door, name. That is a whole building and it is the budget.
// A cornice band under the eaves, a keystone in the arch, a step at the
// threshold and a finial on the ridge were all drawn and all cut: at the
// hundred pixels this stands in the scene each of them lands inside two pixels
// and the only thing they change is that the shadow line at the eaves stops
// being the clearest edge on the piece. The plainness of the tympanum and of
// the door leaf is doing work.
//
// WHY THE ROOF IS A SWEPT PRISM
//
// tombstones.js's own note is that buildArcSweepGeometry extrudes a CONSTANT
// section, so it cannot make a moulding that overhangs front and back, and
// stele.js wrote a vertical ring sweep to get its cornice for exactly that
// reason. This roof does not need one. A gabled roof whose ridge runs front to
// back IS a constant section extruded through Z: the outline is the gable
// itself, the extrusion is deeper than the walls, and the overhang comes out
// equal on all four sides for free. One arc chain, one mesh, and the pediment
// is simply the front face of it. This is the case where the registry's own
// sweep does the whole job, and it is worth knowing before anyone copies
// stele's ring machinery a third time.
//
// WHY THE REGISTRY'S SLAB GOES
//
// The slab is a solid rounded box and there is no way to cut a doorway through
// one, so the shell is built here instead, out of the same builder, from an
// outline the registry's rounded rectangle cannot express. It is handed slabUV,
// so its front face samples the inscription canvas exactly as the slab's would
// have: the name over the door is a registry `draw` on the registry's own
// texture, not a second map. The plinth is kept as it comes, because the base
// course a mausoleum stands on is what the registry already builds.

// --- the numbers -----------------------------------------------------------
//
// Walls 1.26 wide by 1.24 deep, base course 1.41 by 1.37, roof 1.46 by 1.44,
// ridge at 1.786. MEASURED over twelve seeds with the lean applied, which is
// what footprints.js wants: half extents 0.748 by 0.744 and a bounding radius of
// 1.055. That is the largest footprint of any headstone in the set by a clear
// margin. The chest tomb, the widest until now, is 0.834 by 0.393 for a radius
// of 0.92. It is 15% more than a 2.0 cell can hold, so the layout
// generator has to give it a 2.5 or better. The lean is worth 25mm of that
// radius on its own, because it tips a ridge 1.79 up.
//
// Against the set: the obelisk is 1.848 tall on a 0.76 by 0.64 plan, so this is
// the SECOND tallest thing in the graveyard and about three and a half times the
// plan area of anything else. That is the whole identity. It is still well under
// the shed, the graveyard's other building, which is 2.14 tall on a 1.78 by 1.42
// plan and reads as timber. This one is stone all the way through: no boards,
// no gaps, no ragged ends, one continuous rounded surface in the set's own grey.
//
// Height splits 0.20 base, 1.19 wall, 0.40 roof above the eaves line. The wall is
// very nearly as wide as it is tall, which is what a small mausoleum is: taller
// than that and it becomes a tower, shorter and the roof takes over. The roof
// looks bigger than 0.40 in the frame and that is the camera rather than the
// numbers, because a 1.44-deep roof plan seen at 29 degrees adds 0.70 of
// apparent height on its own, and every deep building in this scene pays it.
const W = 0.63;       // half width of the walls
const H = 1.19;       // wall height above the base course, and the face's v span
const D = 1.24;       // depth of the walls
const PLINTH = 0.20;  // the base course, built by the registry

// Everything this file adds is dropped 20mm into the base course. Two flat
// faces meeting exactly at the plinth's top is a coplanar pair on four separate
// meshes, and the registry's own slab only gets away with it because it is one.
const BED = 0.02;

// --- the doorway -----------------------------------------------------------
//
// Semicircular headed, 0.46 by 0.775, which is 37% of the wall's width and 65%
// of its height. The arch is what makes a recess read as a DOOR rather than as
// a window or a sunk panel, and it costs nothing: the head is one concave arc
// tangent to both jambs, which is the one shape an arc chain is best at.
//
// `recess` is the number the whole piece turns on. The brief's floor is 0.06;
// this is 0.13, of which the first 0.062 is the rim rolling into the opening
// and the remaining 0.068 is flat jamb. At the scene's key elevation of 56
// degrees the head alone throws 0.087 of shadow down the leaf, so the top of
// the door is dark, the bottom is lit, and the two are divided by a hard line.
// That line is real geometry; what puts VALUE in the rest of the opening is
// RECESS below, and the note there is the one to read before changing either.
//
// `bury` is how far the leaf runs on into the jambs all round. It has to clear
// the rim radius, or the leaf's own rounded edge comes back out through the
// opening and the door reads as a pillow set in a hole. 0.095 against a 0.062
// rim leaves 33mm of margin.
const DOOR = {
  half: 0.23,
  spring: 0.545,   // where the arch springs, above the base course
  foot: 0.07,      // fillet at the foot of each jamb; the sweep's floor is the rim's 0.062
  recess: 0.13,
  bury: 0.095,
  backGap: 0.02,   // the leaf stops short of the back wall rather than flush with it
};
const DOOR_TOP = DOOR.spring + DOOR.half; // 0.775

// --- the roof --------------------------------------------------------------
//
// 24 degrees, which is a Roman temple's pitch rather than a chapel's, and the
// shallower of the two reads better here: at 100 pixels a steep gable turns
// into a spike and takes the eye off the door. The first pass ran at 28 and the
// difference at scene size was that the ridge, not the doorway, was the first
// thing the eye found.
//
// `over` is the oversail, equal in X and Z. 0.10 puts the eaves 0.10 clear of
// the wall, 0.07 clear of the antae and 0.025 clear of the base course, so the
// building steps out, in, and out again from the ground up, which is the
// silhouette a classical elevation has. It is also the piece's one long shadow
// line and, like stele.js's cornice, the scene's shadow map quantises its lower
// edge into a fine scallop. Measured: about 1.5 pixels in a 1.2-view lab shot
// and half a pixel at the shipped 6.2, where the shadow camera is fitted to the
// whole visible floor. It is a shadow-map limit and not the geometry.
//
// `bury` is how far the block runs down INSIDE the wall. Without it the roof's
// soffit and the wall's top face are coplanar over the whole plan, which is a
// depth fight across the widest surface on the piece.
//
// `fascia` is the vertical face at the eaves, measured from the reference line
// rather than from the soffit: the visible fascia is fascia + bury = 0.17. It
// is mostly fillet at these radii and that is correct for the house style, but
// it must not be less, or the eaves come to a knife edge that the vinyl-toy
// language has nowhere to put.
const ROOF = {
  over: 0.10,
  bury: 0.07,
  fascia: 0.10,
  pitch: (24 * Math.PI) / 180,
  footR: 0.065,  // the eaves' bottom arris
  eaveR: 0.065,  // fascia into the rake
  apexR: 0.10,   // the ridge
};
const ROOF_HALF = W + ROOF.over;

// --- the antae -------------------------------------------------------------
//
// One pilaster at each front corner, plinth to eaves, no base and no capital.
// They stand 0.06 proud in Z and 0.03 proud in X, and the second of those is
// what earns them: a pilaster that only stands off the front face is a shadow
// line on a wall, while one that also breaks the corner puts a step in the
// SILHOUETTE, and a silhouette survives being shrunk. chest.js found the same
// thing with its corner posts and wrote down what the piece looked like without
// them.
//
// Their inner edges land 0.17 clear of the doorway, so the wall between door
// and anta is a real reveal rather than a hairline.
const ANTA = {
  half: 0.13,
  outer: 0.66,   // 0.03 proud of the wall, still inside the base course's 0.705
  depth: 0.18,
  proud: 0.06,
  // Its own rim, and smaller than the registry's 0.062 for a reason that took a
  // render to see: at 0.055 on a member 0.26 across, the roll ate the whole
  // front face and the antae came out as two fat tubes stuck to the wall. At
  // 0.045 there is 0.17 of flat face left between the rolls and they read as
  // pilasters, which is what a flat lit face and two shadowed returns are.
  edge: 0.045,
};

// --- the name --------------------------------------------------------------
//
// One word, in caps, over the lintel. This is the only stone in the set whose
// inscription is a HOUSEHOLD rather than a person, so it gets a surname and
// nothing else: no dates, no R.I.P., no rule under it. Six of them, drawn per
// seed, because two vaults in one graveyard belonging to the same family is the
// kind of detail that is only ever noticed when it is wrong.
//
// Coverage and letter height are measured at `draw`.
//
// Six names, none longer than six letters, and that is a constraint rather than
// a taste: the band between the antae is 0.80 wide, and at the letter size the
// set uses a seventh letter runs a name past it. The alternative was to shrink
// the long ones to fit, which would have made the letter HEIGHT vary from seed
// to seed, and matching the set's letter height is the one thing the brief says
// matters more than any coverage figure.
const NAMES = ['THORNE', 'HOLLIS', 'VANCE', 'CORVIN', 'RANDLE', 'ASHTON'];
// The FONT SIZE, not the cap height. A bold serif caps out at about 0.66 of its
// point size, so this comes out as letters 0.100 world tall, measured off the
// artwork rather than assumed: measured the same way the cross comes out 0.119
// and FRED 0.093, so this sits between the two approved stones.
const NAME_H = 0.152;
const NAME_Y = (DOOR_TOP + H - ROOF.bury) / 2; // centred in the band between arch and eaves
const NAME_MAX = 0.70;                // and never wider than the gap between the antae

// --- the darkness in the doorway -------------------------------------------
//
// THE ONE THING GEOMETRY CANNOT DO HERE, AND WHY THIS IS NOT A CHEAT.
//
// three's HemisphereLight is occluded by nothing. It cannot be: there is no
// shadow pass for it and there could not cheaply be one. So a recess 0.13 deep
// gets the full 1.15 of sky fill on its floor, and the first render of this
// stone came back with the door leaf reading at very nearly the same value as
// the wall around it: an arch DRAWN on a flat face, which is the exact failure
// the brief names. The key's own shadow off the arch head covers the top eighth
// of the leaf and no more.
//
// The registry already owns the answer and states it in its own words: the
// colour map "carries what the normal map cannot hold", starting with "a wide,
// weak smudge ... the ambient light that never reaches into a cut". A doorway
// is a cut. So the doorway is painted into the same canvas the inscription is
// painted into, by the same mechanism, and the door leaf's FRONT FACE is mapped
// with slabUV so that it samples exactly that patch. Nothing else on the piece
// changes; there is no second material and no second map.
//
// It is a gradient rather than a flat tone, and that is shed/shell.js's finding
// rather than a flourish: one even value across an opening reads as a panel
// painted on the front of a solid block, because a painted panel has no reason
// to be lighter near the threshold. Dark under the head, half that at the foot.
//
// `grow` is how far the patch spreads past the opening. It has to be positive,
// or the soft edge of the patch lands on the visible leaf; it has to stay small,
// because the registry blurs the artwork by 17 texels and anything much wider
// pushes that blur out of the opening and onto the wall around it. 0.02 puts
// the patch's edge 0.02 inside the jamb and its blur just inside the mouth of
// the reveal, where a faint darkening is what an occluded corner does anyway.
const RECESS = { grow: 0.02, head: 0.92, foot: 0.50 };

function inkRecess(ctx, w, h) {
  const px = (x) => ((x + W) / (2 * W)) * w;
  const py = (y) => (1 - y / H) * h;
  const half = DOOR.half + RECESS.grow;
  const r = (half / (2 * W)) * w;
  const g = ctx.createLinearGradient(0, py(DOOR_TOP), 0, py(0));
  g.addColorStop(0, `rgba(0,0,0,${RECESS.head})`);
  g.addColorStop(1, `rgba(0,0,0,${RECESS.foot})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  // Down past the bottom of the canvas: the leaf runs on into the base course
  // and v is clamped, so the patch has to reach the last row rather than stop
  // at the threshold and leave a bright band under the door.
  ctx.moveTo(px(-half), py(-0.30));
  ctx.lineTo(px(-half), py(DOOR.spring));
  ctx.arc(px(0), py(DOOR.spring), r, Math.PI, 0);
  ctx.lineTo(px(half), py(-0.30));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000000'; // drawInscription's contract: black is the cut
}

// ---------------------------------------------------------------------------
// outline helpers
//
// An outline is a chain of arcs joined by straight runs, walked counter
// clockwise, each arc carrying the sign of its turn. Straight runs need no
// entry of their own: consecutive arcs end and start with the same normal, so
// the sweep's own quad between them IS the flat edge.

const TAU = Math.PI * 2;

// One arc with its sweep folded into (0, 2pi) by sign, so no caller has to pick
// a branch. Lifted from stele.js, which explains why it is needed: this piece's
// arch turns through 180 degrees the short way and getting it backwards is a
// vault with its doorway inside out.
function arc(cx, cy, r, a0, a1, sign) {
  let d = (a1 - a0) % TAU;
  if (sign > 0 && d <= 0) d += TAU;
  if (sign < 0 && d >= 0) d -= TAU;
  return { cx, cy, r, a0, a1: a0 + d, sign };
}

// A straight edge as an outward unit normal and its offset along it, which is
// the only form a fillet solves cleanly in. `at` is the normal's bearing, and
// it is also the angle at which a tangent fillet meets this edge, so the arc
// angles fall out with no further trigonometry.
const edge = (at, p) => ({ m: { x: Math.cos(at), y: Math.sin(at) }, p, at });

// The convex fillet of radius r tangent to two edges from the inside: one
// radius IN along each edge's own outward normal. stele.js's cornerFillet is
// the concave twin of this, with the sign on r the other way round.
function fillet(a, b, r) {
  const det = a.m.x * b.m.y - a.m.y * b.m.x;
  const ca = a.p - r;
  const cb = b.p - r;
  const cx = (ca * b.m.y - cb * a.m.y) / det;
  const cy = (a.m.x * cb - b.m.x * ca) / det;
  return arc(cx, cy, r, a.at, b.at, 1);
}

// --- the shell's outline ---------------------------------------------------
//
// The wall elevation with the doorway bitten out of the bottom of it: a rounded
// rectangle whose bottom edge is interrupted by two jambs and a semicircular
// head. Every corner is convex except the arch, which is the one concave arc on
// the piece.
//
// A convex arc loses the rim radius on the flat front face and a concave one
// gains it, so nothing may be thinner than twice the rim's 0.062. The thinnest
// limb here is the band over the arch at 0.415, and the jambs are 0.40, so
// there is a factor of three in hand. What the offset DOES do is open the
// doorway out on the face itself: the opening measures 0.46 at the silhouette
// and 0.584 where it meets the front face, and that flare is the rim rolling
// into the reveal. It is worth about a pixel and a half of soft edge round the
// door and it is the difference between an opening cut in stone and one punched
// in card.
function shellOutline(rt, rb) {
  const bottom = edge(-Math.PI / 2, 0);        // y = 0, material above
  const right = edge(0, W);
  const top = edge(Math.PI / 2, H);
  const left = edge(Math.PI, W);
  // The jambs' inner faces. Their outward normals point INTO the doorway,
  // which is what makes the fillets at their feet convex like every other
  // corner on the outline and the arch above them concave.
  const jambL = edge(0, -DOOR.half);
  const jambR = edge(Math.PI, -DOOR.half);
  const close = edge(Math.PI * 1.5, 0);        // the bottom edge again, closing

  return [
    fillet(bottom, right, rb),
    fillet(right, top, rt),
    fillet(top, left, rt),
    fillet(left, bottom, rb),
    fillet(bottom, jambL, DOOR.foot),
    // The head. Tangent to both jambs by construction, because a semicircle
    // sprung from the jamb line is.
    arc(0, DOOR.spring, DOOR.half, Math.PI, 0, -1),
    fillet(jambR, close, DOOR.foot),
  ];
}

// --- the roof's outline ----------------------------------------------------
//
// The gable section, in the eaves line's own frame: y = 0 is the top of the
// wall, the block runs from -bury up to the ridge, and it is wider than the
// wall by the oversail on each side. Extruded through D + 2*over it is the
// whole roof, pediment included, with the same overhang front, back and end.
function roofOutline() {
  const y0 = -ROOF.bury;
  const yF = ROOF.fascia;
  const rake = Math.PI / 2 - ROOF.pitch; // the rake's outward normal, off +x
  const p = ROOF_HALF * Math.cos(rake) + yF * Math.sin(rake);

  const soffit = edge(-Math.PI / 2, -y0);
  const fasciaR = edge(0, ROOF_HALF);
  const rakeR = edge(rake, p);
  const rakeL = edge(Math.PI - rake, p);
  const fasciaL = edge(Math.PI, ROOF_HALF);
  const close = edge(Math.PI * 1.5, -y0);

  return [
    fillet(soffit, fasciaR, ROOF.footR),
    fillet(fasciaR, rakeR, ROOF.eaveR),
    fillet(rakeR, rakeL, ROOF.apexR),  // the ridge
    fillet(rakeL, fasciaL, ROOF.eaveR),
    fillet(fasciaL, close, ROOF.footR),
  ];
}

// Height of the ridge above the eaves line. The fillet at the apex sits
// r/sin(half the ridge angle) below where the two rakes would have crossed, so
// the block tops out a shade under the sharp apex. At these numbers that is
// 8mm, and it is the difference between an authored 1.786 and the 1.794 the
// sharp apex would have given.
function ridgeTop() {
  const a = roofOutline()[2];
  return a.cy + a.r;
}

// ---------------------------------------------------------------------------

registerStone('vault', {
  shape: { halfWidth: W, height: H, depth: D, plinth: PLINTH },
  // Both are moot: the registry's slab is removed in extras and the shell is
  // built from its own outline. They are set square anyway so that anyone who
  // renders the piece with extras stubbed out sees a box rather than an arch.
  topRadius: 0,
  bottomRadius: 0,

  // The family name, cut into the band between the arch and the eaves.
  //
  // MEASURED, on the real face canvas at 1084 by 1024, over all six names: the
  // ink covers 1.27% to 1.79% of the canvas in a box 43% to 54% of its width by
  // 8.6% of its height, and the caps come out 0.100 to 0.103 world tall on an
  // 86 to 89 texel stroke, five times the 17 at which a cut collapses.
  //
  // Both numbers matter and they say different things. Against the whole face
  // rectangle 1.3% to 1.8% looks timid beside the cross's 3.8%, and that is
  // arithmetic rather than timidity: this is much the biggest face in the set at
  // 1.26 by 1.19, and half of it is not visible stone at all. The doorway
  // takes 0.33 square units out of 1.50 and the two antae stand in front of
  // another 0.58. Against the stone a viewer can actually see, the same word
  // covers 3.3% to 4.6%, which is exactly the light end the postmortem puts a
  // piece with a strong silhouette at. And the letter HEIGHT, which the brief
  // says matters more than any coverage figure, lands between the two approved
  // stones: 0.100 here against the cross's 0.119 and FRED's 0.093, all three
  // measured the same way, off the ink's own bounding box.
  //
  // The width is capped rather than trusted, and the cap bites on one name in
  // six: THORNE comes back 3% smaller than VANCE. Everything longer than six
  // letters was dropped from the list rather than shrunk to fit, because a name
  // squeezed to clear the antae changes the letter height from seed to seed and
  // that is the one thing that may not vary.
  draw(ctx, w, h, rng) {
    inkRecess(ctx, w, h);
    const name = NAMES[Math.floor(rng() * NAMES.length)];
    const size = h * (NAME_H / H);
    const spacing = size * 0.06;
    ctx.font = `bold ${size}px "Liberation Serif", "Times New Roman", Georgia, serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    const wide = ctx.measureText(name).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const cap = (NAME_MAX / (2 * W)) * w;
    const fit = wide > cap ? cap / wide : 1;
    inkText(ctx, name, w / 2, h * (1 - NAME_Y / H), size * fit, spacing * fit);
  },

  extras({ body, slab, material, rng, lean, plinthH, edge: rim, disposables, stripUV, slabUV }) {
    // The registry's slab goes: a solid rounded box cannot have a doorway cut
    // through it. Its geometry is still owned by dispose(), so nothing leaks.
    body.remove(slab);

    const Y0 = plinthH - BED; // the top of the base course, less the bedding
    const add = (geo, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, Y0 + y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      disposables.push(geo);
      return mesh;
    };

    // --- the shell ---------------------------------------------------------
    // Walls, back and doorway in one sweep, handed the registry's own front
    // face mapping so the name lands where `draw` put it.
    add(
      buildArcSweepGeometry({
        outline: shellOutline(0.09, 0.09),
        depth: D,
        edge: rim,
        uv: slabUV,
      }),
    );

    // --- the door leaf -----------------------------------------------------
    // A slab filling the doorway from `recess` behind the wall face back to
    // just short of the rear wall, oversized by `bury` on every side so it runs
    // on into the jambs and the arch and its own rounded edges never show.
    // Solid rather than a leaf on a cavity: see the note on the ajar door at
    // the foot of this file.
    const leafHalf = DOOR.half + DOOR.bury;
    const leafBot = -0.04;
    const leafTop = DOOR_TOP + DOOR.bury;
    const leafZ0 = -D / 2 + DOOR.backGap;
    const leafZ1 = D / 2 - DOOR.recess;
    add(
      buildSlabGeometry({
        halfWidth: leafHalf,
        height: leafTop - leafBot,
        depth: leafZ1 - leafZ0,
        edge: rim,
        bottomRadius: 0.08,
        topRadius: 0.09,
        // The front face samples the inscription canvas, where inkRecess has
        // painted the doorway's darkness; everything else on the leaf is
        // parked in the plain strip at the wall's own v, so the grime that
        // washes up the foot of the facade washes up the door by as much.
        uv: (x, y, front) => (front
          ? slabUV(x, y + leafBot, true)
          : stripUV(x, y + leafBot, leafHalf, H)),
      }),
      0,
      leafBot,
      (leafZ0 + leafZ1) / 2,
    );

    // --- the antae ---------------------------------------------------------
    // Painted while still centred on the origin and cloned afterwards, which is
    // chest.js's rule and worth repeating: stripUV read with a translated x
    // walks off the plain strip and into the inscription.
    const anta = buildSlabGeometry({
      halfWidth: ANTA.half,
      height: H,
      depth: ANTA.depth,
      edge: ANTA.edge,
      bottomRadius: 0.05,
      topRadius: 0.05,
      uv: (x, y) => stripUV(x, y, ANTA.half, H),
    });
    const ax = ANTA.outer - ANTA.half;
    const az = D / 2 + ANTA.proud - ANTA.depth / 2;
    const copies = [-1, 1].map((s) => anta.clone().translate(s * ax, 0, az));
    anta.dispose();
    const antae = mergeGeometries(copies);
    for (const c of copies) c.dispose();
    add(antae);

    // --- the roof ----------------------------------------------------------
    // v is given a band of its own up the block rather than the wall's mapping,
    // which by height would land every vertex on the map's top row and smear
    // one line of mottle over the largest single surface on the piece. chest.js
    // hit the same thing with its lid. 0.86 to 0.99 is clean stone: the grime
    // wash dies out well below it, and a roof does not have a wet foot.
    const rTop = ridgeTop();
    const rBot = -ROOF.bury;
    add(
      buildArcSweepGeometry({
        outline: roofOutline(),
        depth: D + 2 * ROOF.over,
        edge: rim,
        uv: (x, y) => [
          stripUV(x, 0, ROOF_HALF, 1)[0],
          0.86 + 0.13 * ((y - rBot) / (rTop - rBot)),
        ],
      }),
      0,
      H,
    );

    // --- seating -----------------------------------------------------------
    //
    // The registry's lean is authored for a slab 0.9 wide and it is too much
    // for a building: at full strength it puts 1.3 degrees of list on a gable,
    // and a leaning gable reads as a modelling error where a leaning headstone
    // reads as a hundred years of frost. Scaled to under half, it is a settle.
    //
    // The sink then has to pay for it, and on this footprint the registry's own
    // 12mm does not. Worked on the corner of the base course at 0.705 by 0.685:
    // the worst list and the worst tip together lift it 17mm, so the sink goes
    // to 30mm, which buries the far corner and leaves 13mm in hand. The lean is
    // read and adjusted here rather than compensated for mesh by mesh, which is
    // what the registry now offers and what chest.js had to do the hard way.
    lean.z *= 0.45;
    lean.x *= 0.45;
    lean.sink = -0.030;

    // Nothing else varies per seed, and that is deliberate. A masonry building
    // is cast from one mould: the name changes, the mottle changes, the settle
    // changes, and the geometry does not. rng is touched here only so this is
    // an explicit decision rather than an oversight.
    void rng;

    // --- the door that is not ajar -----------------------------------------
    //
    // An open door with black behind it is the most atmospheric thing this piece
    // could have had, so it was BUILT and RENDERED rather than argued about: a
    // 0.46-deep chamber behind the opening, an unlit vertex-coloured cavity in
    // it on shed/shell.js's pattern, and a 0.075 leaf hinged on the left jamb
    // and swung 36 degrees inward. The comparison is out/vault/ajars/cmp.png,
    // shut and ajar side by side at 300 by 400.
    //
    // It is worse, and for a reason that only shows at scene size. The chamber
    // really is black, because an unlit material cannot be lifted by the
    // hemisphere, which is the whole point of it. But the LEAF is stone, and
    // the key hits it square. So the opening stops being one dark shape and
    // becomes a bright panel with a black slot beside it, and at ninety pixels
    // the bright panel wins: the arch reads lighter than the shut version, not
    // darker. Swinging it the other way only moves the problem outdoors, where a
    // 75mm plate standing 0.15 past the facade is the outermost thing on the
    // building and reads as a flake stuck to the front of it.
    //
    // The finding worth keeping is that the darkness was never the hard part.
    // The doorway is dark here because RECESS paints it dark and the geometry is
    // genuinely 0.13 back; adding a real cavity behind a real leaf bought a
    // blacker slot at the cost of the shape that carries the read.
  },
});
