import * as THREE from 'three';
import { contactShadow } from '../style.js';
import {
  FOLIAGE, foliageMaterial, foliageRng, makeLobes, blobGeometry,
  lumpPositions, icosphere, mergeLumps, bakeFoliageTint, bakeWind,
  attachWind, disposeWind, updateWind,
} from './wind.js';
import {
  ballProfile, coneProfile, profileGeometry, insetProfile, boxField, hedgeField,
  cutField, insetField, fieldGeometry, napSites, buildNap,
} from './clipped.js';

// The graveyard's planting: four bushes off one set of parts.
//
//   ball      a clipped topiary ball, low and slightly wider than tall
//   cone      a clipped cone, straight flank, rounded apex
//   box       a clipped box, generous fillet on every arris
//   hedge     a segment of clipped hedge, flat ends, built to tile
//   hedgecap  the same, with the +x end rounded off for the end of a run
//   wild      the overgrown shrub this file started as
//
// Three of them are CUT and one is not, and everything below follows from that
// one distinction. A cemetery has both: clipped yew standing along the path and
// something nobody has been round with the shears for in the corner by the
// wall. They have to look like the same species in two states, which means the
// same palette, the same leaf, the same crevice shading and the same ground
// contact, differing only in the form and in how much the form moves.
//
// GEOMETRY, and what it is instead of.
//
// Two layers of solid clay, no cards and no alpha anywhere.
//
//   - The MASS. One closed surface. For the wild bush it is a lumpy dome built
//     as an icosphere with a smooth radial lobe field on it, which is the
//     pumpkin's approach and is here for the pumpkin's reason: a lobed
//     silhouette cannot be assembled from primitives without creases, and
//     creases are exactly what the house style rules out. For the three clipped
//     forms it is an exact surface with analytic normals; see clipped.js.
//     Either way it is sunk into the floor so it meets the ground along a
//     circle rather than at a point.
//
//   - The LEAF LAYER. Small lumps sitting proud of that surface, each a lozenge
//     or a scallop of its own, mostly buried in the mass, merged into a single
//     geometry. They are what carries the flutter: each has its own phase, so
//     the surface breaks into pieces that move separately instead of one object
//     being shaken. On the wild bush there are a hundred and sixty-eight of
//     them, they stand well proud of the mass, and they are what makes the
//     outline scallop. On a clipped bush there are a hundred and fifty to three
//     hundred, they are squashed flat against the surface, and their tips are
//     placed so they land back on the exact form: the outline stays the shape
//     the gardener cut, and only the shading says leaves.
//
// Alpha-cut leaf cards were the obvious alternative and are wrong for this
// scene three times over. There is no environment map, so a card has nothing to
// catch and reads as a flat sticker. The shadow map is the scene's only real
// occlusion and alpha-tested shadows are both expensive and crunchy at this
// resolution. And every other prop on the shelf is opaque soft vinyl, so a
// cloud of textured quads would be the one thing in the yard made of a
// different material. A clay bush is lumps.
//
// A single noise-displaced sphere was the other alternative and is too smooth:
// displacement large enough to read as fluff at this camera distance also makes
// the surface ripple rather than clump, and it gives the wind nothing to break
// into independently moving pieces.
//
// ONE DRAW CALL. The mass and the leaf layer want different tints and different
// wind weights, so they are built and baked separately, and then joined into a
// single buffer with a single material by joinLayers below. The colour
// difference between them survives the join as a factor on the vertex colour,
// which the tint bake was already writing. The wild bush was two meshes before
// this and is now one; the join is exact, and a render of it is byte for byte
// the render the two meshes gave.
//
// COST, per bush, at the sizes below: one draw call for the body and one for
// the painted contact patch. Triangles over four seeds are 15.2k to 17.8k for
// the ball, 18.9k to 21.8k for the cone, 26.0k to 31.0k for the box, 25.8k for
// a hedge segment (27.3k capped) and 21.6k to 22.8k for the wild one. Surface
// area is what sets it, because the leaf is one fixed size: six faces of a 0.9
// cube is nearly twice the skin of a 0.9 ball, and a hedge is a metre of that
// per segment, so a four segment run is four times this and reads as one
// prop. Building one costs 40 to 80 ms, nearly all of it in scattering the
// leaf clusters.

export const BUSH_VARIANTS = ['ball', 'cone', 'box', 'hedge', 'hedgecap', 'wild'];

// What an unknown variant becomes. Levels written before the topiary existed
// name the prop `bush` with variant `bush` or with no variant at all, and they
// should open as something rather than throw: the ball is the closest of the
// four to what they were placed as, and it is the one the footprint table is
// measured from.
const DEFAULT_VARIANT = 'ball';

export function createBush({ seed = 1, scale = 1, variant = DEFAULT_VARIANT } = {}) {
  const rand = foliageRng(seed * 7919 + 131);
  const kind = BUSH_VARIANTS.includes(variant) ? variant : DEFAULT_VARIANT;

  const group = new THREE.Group();
  // Inner group carries the seeded lean, the same arrangement the tombstones
  // use, so the caller still owns position and rotation.y on the outer one.
  const body = new THREE.Group();
  group.add(body);
  const disposables = [];

  const built = kind === 'wild' ? wildBush(rand) : clippedBush(kind, rand);
  for (const layer of built.layers) disposables.push(layer.geo);

  const geo = joinLayers(built.layers, FOLIAGE.mid);
  disposables.push(geo);
  const mat = foliageMaterial(FOLIAGE.mid);
  disposables.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  body.add(mesh);
  attachWind(mesh, built.bend);

  // --- lean -------------------------------------------------------------------
  // Nothing grows plumb, and the wild bush leans by up to three degrees for
  // that reason. A clipped one gets a fifth of that: a topiary ball visibly off
  // the vertical does not read as a plant that grew crooked, it reads as a prop
  // that was placed carelessly, because the eye has the cut form itself as a
  // reference for what upright was meant to be. Both stay well inside the depth
  // the base is buried at, so no daylight opens under the lean.
  body.rotation.z = (rand() - 0.5) * built.lean;
  body.rotation.x = (rand() - 0.5) * built.lean * 0.8;

  // --- ground contact -----------------------------------------------------------
  // The key light and the camera are on the same side of the yard, so the
  // bush's own cast shadow goes behind it and nothing darkens the floor on the
  // side you can see. Measured against a render with it turned off, this patch
  // changes exactly one thing: a thin crescent of floor along the front of the
  // footprint. That is all it should change, and it is why the halo problem
  // that got a painted patch thrown off the tombstones does not arise here: the
  // base is buried, so the bush's own skirt covers the patch everywhere except
  // at that join.
  const patch = contactShadow({
    radius: (built.size.width + built.size.depth) * 0.21,
    opacity: 0.22,
    softness: 0.74,
  });
  group.add(patch);
  disposables.push({ dispose: () => patch.userData.dispose?.() });

  group.scale.setScalar(scale);

  return {
    group,
    variant: kind,
    // What the prop actually measures, so a scene can lay bushes out without
    // building one and reading its bounding box back.
    size: {
      height: built.size.height * scale,
      width: built.size.width * scale,
      depth: built.size.depth * scale,
    },
    update(time) {
      // Every plant in the yard writes the same value into the same shared
      // uniform. Cheap, and it is what keeps them in one weather system.
      updateWind(time);
    },
    dispose() {
      disposeWind(mesh);
      for (const d of disposables) d.dispose?.();
    },
  };
}

// --- the three clipped forms -------------------------------------------------
//
// SIZES. The ball and the box are knee height so they sit UNDER the headstones
// (1.10 to 1.56) rather than in front of them; the cone is allowed to go to
// chest height because it is narrow and hides almost nothing behind it. Each is
// jittered a few per cent per seed, which is as much as a clipped shape can
// take: the whole point of a cut form is that it is the same form twice, and a
// row of topiary with fifteen per cent of size variation in it reads as a row
// of different plants rather than as a row.
//
// ONE LEAF for the whole family, in world units, not as a fraction of the
// plant. A cone is nearly twice the height of a ball and its leaves are the
// same leaves; scaling the leaf layer with the form was the first thing tried
// and it makes the cone read as a ball seen from further away, which is the
// exact opposite of what "the same plant cut three ways" needs.
//
// Five numbers, and between them they decide whether the surface reads as
// foliage, as bubble wrap or as gravel.
//
//   LEAF         the radius of one cluster.
//   SPACING      how far apart their centres go: about one radius, so a
//                cluster's visible scallop covers its neighbour's centre and
//                the surface closes. At one and a half radii the scallops
//                separated into petals stuck on a dark ball.
//   NAP          how far a tip stands proud of the mass, which is the RELIEF
//                of the whole surface and nothing else.
//   FLAT         how squashed a cluster is along its own axis.
//   LEAF_DETAIL  the icosphere the cluster is made from. 0 is twenty
//                triangles.
//
// TWO ROUNDS OF THIS, and the second is the one that matters. The first had
// LEAF at 0.072 with relief a third of it and a round-ish lump, and every
// cluster came out a little dome with a shading gradient of its own: three
// heads of broccoli. Turning the relief down alone made it worse rather than
// better, because a shallower cut through the same round lump exposes a
// SMALLER cap and the surface opened into islands with dark mass between them;
// flattening the lump at the same time fixed that, and at four times the size
// this prop is seen at, it looked right.
//
// It was not right. At the size the yard actually shows a bush, a 0.14 cluster
// is six pixels and reads as a pebble, and on the cone the rows of them read
// as a pinecone. THE ONLY RENDER THAT DECIDES THIS IS THE ONE AT GAME SCALE.
// So the leaf is halved, to 0.068 across, which is under three pixels there,
// and a box now carries about a thousand clusters instead of two hundred and
// fifty.
//
// That is paid for by making a cluster a TWENTY triangle icosahedron instead
// of an eighty triangle icosphere. Four and a half times as many clusters at a
// quarter of the price each is a six per cent increase in triangles, and at
// three pixels across nothing in the world can tell a twenty-triangle blob
// from an eighty-triangle one. What a cluster is for at this size is not its
// own silhouette; it is one crevice in the vertex-colour bake and one grain of
// the outline, and both of those it still has.
const LEAF = 0.034;
const SPACING = 0.036;
const NAP = 0.008;
const FLAT = 0.34;
const LEAF_DETAIL = 0;

// How finely the mass is tessellated, as three's PolyhedronGeometry `detail`,
// which gives 20 * (detail + 1)^2 triangles. It is per form because the three
// forms need different amounts, and the number that decides it is the angular
// step seen from the centre:
//
//   ball  9  2000 tris, 6.5 degrees. It is a sphere; its silhouette at that
//           step is a 55-gon that misses the true circle by 0.0007 units.
//   cone 13  3920 tris. Set by the apex, not the flank: the flank is straight
//           and gets its shading from analytic normals, so tessellating it
//           buys nothing, while the apex cap is 5.5% of the profile's length
//           and needs enough rings not to be a spike. It gets 19 vertices.
//   box  15  5120 tris, 4.1 degrees. Set by the fillet, which subtends only
//           about 15 degrees of direction from the centre however wide it is
//           in world units. At this step 668 of the 2562 vertices land on the
//           fillets, four across each arris; at the ball's step it would be
//           one and a bit.
const CLIPPED = {
  // A true spheroid, slightly wider than tall, cut off flat below the floor.
  // If it looks like the wild bush with the lobes turned down it has failed, so
  // there are no lobes on it at all: the only thing between it and a billiard
  // ball is the leaf layer.
  ball(rand) {
    const height = 0.71 + rand() * 0.07;
    const width = height * (1.20 + rand() * 0.05);
    const a = width / 2;
    const b = height * 0.56;      // vertical semi-axis; a/b = 1.09, wider than tall
    const cy = height - b;
    const cut = -0.075 * height;  // the flat underside, underground
    return {
      height,
      mass: (inset) => profileGeometry({
        detail: 9,
        profile: ballProfile({ a, b, cy, cut }, inset),
      }),
    };
  },

  // Straight flank, rounded apex, slight flare at the foot.
  //
  // THE TIP IS THE HARD PART, and it is a leaf problem rather than a geometry
  // one. The apex arc started at 16% of the base radius, which is 0.059 units,
  // against leaf clusters that were 0.13 across at the time: one landed on the
  // tip and the cone grew a knob like the stopper of a bottle. Widening the arc
  // to 20% and shrinking the clusters over the top of the cone was not enough
  // on its own either, because the nap DEPTH was still a constant and the mass
  // under the tip was still inset the full amount, so the tip stayed a bud with
  // a crevice down the middle of it.
  //
  // What works is thinning the whole leaf layer toward the point: over the top
  // fifth of the height the mass is inset less and the clusters shrink to match,
  // both by the same taper, so the two stay in register and the shape at the
  // tip is carried by the mass itself with a hair of texture on it. That is
  // also what a clipped conifer does. The tip is the youngest wood on it and
  // carries the finest sprays, and a gardener's shears reach it last.
  cone(rand) {
    const height = 1.18 + rand() * 0.10;
    const base = height * (0.300 + rand() * 0.020);
    const apex = base * 0.20;
    const fine = height * 0.80;
    const taper = (y) => {
      const u = Math.max(0, Math.min(1, (y - fine) / (height - fine)));
      return 1 - 0.70 * (u * u * (3 - 2 * u));
    };
    return {
      height,
      napSize: (p) => taper(p.y),
      napAt: (p) => NAP * taper(p.y),
      mass: (inset) => profileGeometry({
        detail: 13,
        profile: insetProfile(coneProfile({
          base, apex,
          y1: 0,                  // widest at the floor, so the flank stands vertical there
          y2: height - apex,
          cut: -0.09 * height,
        }), (s, y) => inset * taper(y)),
      }),
    };
  },

  // A cube would show three faces and three hard edges; this is the same cube
  // with a fillet on every arris. See FILLET below for how the radius was
  // chosen, and boxField in clipped.js for the batter.
  box(rand) {
    const height = 0.74 + rand() * 0.07;
    const width = height * (1.06 + rand() * 0.06);
    const depth = width * (0.95 + rand() * 0.08);
    const buried = 0.07 * height;
    const fillet = FILLET * Math.min(width, depth) / 2;
    const cy = (height - buried) / 2;
    return {
      height,
      mass: (inset) => fieldGeometry({
        detail: 15,
        field: insetField(cutField(boxField({
          hx: width / 2 - fillet,
          hy: (height + buried) / 2 - fillet,
          hz: depth / 2 - fillet,
          cy,
          fillet,
          batter: 0.045,
        }), -buried), inset),
        origin: [0, cy, 0],
        reach: 2 * (height + width),
      }),
    };
  },

  // A segment of hedge, and the segment that ends a run. See hedgeField in
  // clipped.js for the shape and why the box could not do this job.
  hedge: () => hedgeSpec({ capPlus: false }),
  hedgecap: () => hedgeSpec({ capPlus: true }),
};

// NOTHING HERE IS SEEDED, and that is the point of a tiling piece.
//
// Every other variant jitters its size by a few per cent per seed so that two
// of them are not the same object twice. A hedge cannot: the run has to line
// up. A length that varied would leave a gap or an overlap at every join, and
// a height that varied would step the top line up and down along the run,
// which is precisely the regular-period artefact this variant exists to
// remove. So the block is fixed and ALL of the variety comes from the leaf
// layer, which is scattered from the prop's own seed and is different on every
// segment. The lean is zero for the same reason: 0.02 radians is invisible on
// a ball and is a visible wedge at a shared face.
//
// The pitch is ONE UNIT exactly, which is the number an author can work in: a
// four-unit grid cell takes four segments.
const HEDGE = {
  pitch: 1.0,
  thick: 0.60,
  height: 0.78,
  buried: 0.06,
};

function hedgeSpec({ capPlus }) {
  const half = HEDGE.pitch / 2;
  const fillet = FILLET * HEDGE.thick / 2;
  const cy = (HEDGE.height - HEDGE.buried) / 2;
  const field = (inset) => cutField(hedgeField({
    half,
    hy: (HEDGE.height + HEDGE.buried) / 2,
    hz: HEDGE.thick / 2,
    cy,
    fillet,
    batter: 0.045,
    capPlus,
    inset,
  }), -HEDGE.buried);
  return {
    height: HEDGE.height,
    lean: 0,
    // WHERE THE LEAF GOES ON A SEGMENT, which took three tries to get right.
    //
    // The middle of a flat end face gets none. On a run it is inside the
    // neighbour, so it would be triangles nobody can see; on the last segment
    // of a run it is a cut face and a cut face should look cut.
    //
    // A band one cluster wide around the EDGE of that face does get leaf, and
    // that band is what closes the join. Rejecting the whole face left the
    // join line covered only by the rims of clusters standing on the long
    // faces, and a rim is the thinnest part of a cluster, so the surface
    // sagged along the join and drew a shadow line at every metre. Planting
    // the band fills it from both sides.
    //
    // The test is on the NORMAL, and the threshold is 0.9 rather than
    // something comfortable like 0.5. The end face's normal is exactly +x; the
    // arris where it meets the top and the sides has a blended one, and at 0.5
    // that arris was rejected with the face. What that left was a
    // cluster-sized hole at the top corner of every join, which on this camera
    // sits on the silhouette, so the hedge showed a notch of daylight at every
    // metre.
    //
    // The clusters on the long faces are left alone: they overhang the tile
    // plane by up to their own radius on purpose, and two segments' overhangs
    // interleaving is the other half of what makes the join disappear. They
    // are opaque solids of one colour, so overlapping them costs nothing and
    // shows nothing.
    napKeep: (p, n) => capPlus || n.x < 0.9
      || Math.abs(p.z) > HEDGE.thick / 2 - LEAF * 1.3
      || p.y > HEDGE.height - LEAF * 1.3,
    mass: (inset) => fieldGeometry({
      detail: 15,
      field: field(inset),
      origin: [0, cy, 0],
      reach: 4 * HEDGE.pitch,
    }),
  };
}

// The fillet on the box, as a fraction of its half width.
//
// This is the number the whole variant turns on, so it was rendered rather
// than guessed: out/topiary/10-fillet-study.png is the same box at 0.10, 0.18,
// 0.26 and 0.34, top row at four times the size it is seen in the yard and
// bottom row at the size it is actually seen.
//
//   0.10  a crate. The two side faces meet in a line, and the only thing
//         softening it is the leaf layer, which is the crease the house style
//         exists to avoid with a texture thrown over it.
//   0.18  a box with a tight arris. Good, and the closest rival.
//   0.26  a clipped box. The roll takes about three leaf clusters, which is
//         what a shear leaves, and better than half of each face is still
//         flat, so the three faces hold three clearly distinct values at the
//         game camera.
//   0.34  a pillow. The flats are down to about half the face and at the size
//         the prop is really seen the top has stopped reading as flat.
//
// 0.26, and the leaf layer softens it by another couple of per cent on top.
const FILLET = 0.26;

function clippedBush(kind, rand) {
  const spec = CLIPPED[kind](rand);

  // The mass is the finished shape INSET by the depth of one leaf cluster, so
  // that the clusters standing on it bring the surface back out to the shape.
  const massGeo = spec.mass(NAP);
  const top = spec.height;

  const sites = napSites(massGeo, {
    rand,
    spacing: SPACING,
    sizeAt: spec.napSize || null,
    keep: spec.napKeep || null,
    limit: 1600,
    yMin: 0.015,
  });
  const napGeo = mergeLumps(buildNap(sites, {
    rand,
    radius: LEAF,
    flat: FLAT,
    nap: NAP,
    detail: LEAF_DETAIL,
    flutterTop: top * 0.85,
    sizeAt: spec.napSize || null,
    napAt: spec.napAt || null,
  }));

  // Both layers are measured after the fact rather than taken from the spec,
  // because the leaf clusters stand outside the mass sideways as well as
  // upward and a footprint that ignores them is a footprint that overlaps.
  const size = measureExtent(massGeo, napGeo);

  // The tint. Higher floor and lower ceiling than the wild bush: a clipped
  // surface is an even one, and the wild bush's range of value is doing a job
  // (hiding the fact that a shaggy mass has no readable form) that a cut form
  // does not need done. The crevice term is stronger instead, because on a
  // clipped surface the crevice IS the texture.
  bakeFoliageTint(massGeo, { top, floor: 0.42, ceil: 0.78, down: 0.72, rand });
  bakeFoliageTint(napGeo, { top, floor: 0.58, ceil: 1.18, down: 0.62, root: 0.38, spread: 0.22, rand });

  // The wind. OFF in the shipped scene, and these numbers are what it does
  // when something switches it on: see setWindEnabled in wind.js, which every
  // plant reads at build time. They are kept rather than deleted because the
  // hard part of a clipped plant's wind is not the machinery, it is the
  // amplitude, and the amplitude is what was worked out here.
  //
  // It is the single easiest way to lose the trimmed read.
  // Clipped topiary that sways like a shrub is not clipped, so the mass barely
  // moves. Two numbers do it. The stiffness power goes to 2.6 from the wild
  // bush's 1.8, so a vertex at half the height moves 0.16 of what the crown
  // does rather than 0.29. And the sway amplitude goes to a ninth of the wild
  // bush's. What is left is the leaf layer's flutter, which is a rigid offset
  // per cluster and therefore moves the surface without moving the outline.
  //
  // Measured off the rendered silhouette by bush-shot.mjs --measure over six
  // seconds, the top of the prop travels 0.013 world units for the ball, 0.016
  // for the cone and the box, against 0.087 for the wild bush, and the foot
  // travels 0.0035, 0.0005 and 0.0007 against 0.0103. At the size the yard
  // shows a bush, the crown of a clipped one moves about half a pixel.
  bakeWind(massGeo, { top: top * 0.92, base: 0, power: 2.6, flutter: 0 });
  bakeWind(napGeo, { top: top * 0.92, base: 0, power: 2.6 });

  return {
    layers: [{ geo: massGeo, color: FOLIAGE.deep }, { geo: napGeo, color: FOLIAGE.mid }],
    bend: {
      sway: 0.010 * top,
      flutter: 0.011 * top,
      flutRate: 1.9,
      droop: 1.35,
      lag: 0.20,
      scatter: 0.24,
    },
    lean: spec.lean === undefined ? 0.020 : spec.lean,
    size: { height: top, width: size.width, depth: size.depth },
  };
}

// --- the overgrown one -------------------------------------------------------
//
// Kept, unchanged in every number, because an overgrown shrub belongs in a
// graveyard as much as a clipped one does and this one is well made. It is the
// only variant with a wandering lobe field and the only one whose leaf layer is
// allowed to break the outline.
function wildBush(rand) {
  // Knee to waist and wider than tall, which is what an untrimmed yew does when
  // nobody has been round with the shears for a few years.
  //
  // TALL is what the finished prop measures; H is only what the mass under the
  // tufts is built at. The two are not the same and cannot be: the tufts stand
  // proud of the mass by however much their own randomness gave them, which
  // measured out at a quarter of the bush's height and drifting seed to seed.
  // So the prop is built, measured, and then scaled to the height it promised,
  // which is the only way "knee to waist, under the headstones" survives the
  // next four plants being built on top of this.
  const TALL = 0.62 + rand() * 0.14;
  const H = 0.575 + rand() * 0.100;          // nominal height of the mass
  const W = H * (1.20 + rand() * 0.24);      // widest point
  const D = W * (0.80 + rand() * 0.20);      // and its depth, so it is not round
  const BURIED = H * 0.17;                   // how much of the dome is underground

  // Few large lobes rather than many small ones. Nine modest lobes averaged out
  // into a dome with a texture on it; seven big ones give the mass real shoulders
  // and hollows, which is what the tufts then need in order to sit at different
  // depths instead of paving an even sphere. yBias is slightly negative so the
  // lobes favour the flanks and the skirt: the top of a bush is where it is most
  // even, the bottom is where it is most overgrown, and biasing them upward gave
  // a mushroom.
  const massLobes = makeLobes(rand, {
    count: 7,
    amp: [0.15, 0.36],
    tight: [1.7, 4.0],
    yBias: -0.06,
  });
  const massGeo = blobGeometry({
    detail: 4,
    lobes: massLobes,
    scaleY: 0.90,
    fit: { width: W, depth: D, height: H, buried: BURIED },
  });

  // Placed on the mass's own vertices rather than on an idealised sphere, so a
  // clump always sits on the surface that is actually there: an analytic
  // placement drifted off the deeper hollows of the lobe field and left clumps
  // floating a centimetre out in front of the bush.
  //
  // Two tiers of tuft, not three. A third tier of fine fuzz riding on the tips
  // of the second was built and thrown away: it cost nine thousand triangles and
  // at the size this prop is actually seen in the yard, where the whole bush is
  // a couple of hundred pixels, every one of those lumps was two pixels across
  // and contributed aliasing rather than detail. The texture it was after is
  // bought for nothing instead, by giving each tuft a second, tighter set of
  // lobes: same triangles, same silhouette work, bumps at a quarter of the
  // scale. Detail you cannot resolve is not detail.
  const tuftSites = clumpPlacements(massGeo, {
    rand, W, H,
    limit: 168,
    yMin: 0.05,
    big: [0.055, 0.028],
    small: [0.030, 0.020],
    bigOdds: 0.34,
    gap: 0.44,
  });
  const clumpGeo = mergeLumps(buildTufts(tuftSites, { rand, W, H }));

  // Fit to the promised height. Uniform, so no normal has to be recomputed, and
  // about y = 0, so the buried skirt keeps the same proportion of itself
  // underground. Everything that reads a position, meaning the shading bake,
  // the wind weights and the contact patch, happens after this, so nothing has
  // to be corrected for it afterwards.
  const K = TALL / measureExtent(massGeo, clumpGeo).top;
  massGeo.scale(K, K, K);
  clumpGeo.scale(K, K, K);
  // Re-measured rather than taken as W * K, because the tufts stand outside the
  // mass sideways as well as upward: the mass's fitted width under-reports the
  // finished prop by about a fifth, which is exactly the amount a scene laying
  // bushes out would then overlap them by.
  const { width, depth } = measureExtent(massGeo, clumpGeo);

  bakeFoliageTint(massGeo, { top: TALL, floor: 0.44, ceil: 0.86, down: 0.70, rand });
  bakeWind(massGeo, { top: TALL * 0.86, base: 0, power: 1.8, flutter: 0 });
  bakeFoliageTint(clumpGeo, { top: TALL, floor: 0.50, ceil: 1.34, down: 0.56, root: 0.36, spread: 0.26, rand });
  bakeWind(clumpGeo, { top: TALL * 0.86, base: 0, power: 1.8 });

  return {
    layers: [{ geo: massGeo, color: FOLIAGE.deep }, { geo: clumpGeo, color: FOLIAGE.mid }],
    // The two layers were driven with IDENTICAL bend parameters when they were
    // two meshes, and joining them into one has made that structural: the
    // clumps are only half buried in the mass, so any difference in sway or lag
    // between the layers pulls them out of it and opens a crescent of daylight
    // at the crown on the fast part of a gust. All the independence the clumps
    // need comes from uScatter and from the flutter, both of which are bounded
    // well inside the burial depth.
    bend: {
      sway: 0.088 * TALL,     // authored against the plant's own height
      flutter: 0.020 * TALL,
      flutRate: 1.45,
      droop: 1.35,
      lag: 0.26,
      scatter: 0.20,
    },
    lean: 0.10,
    size: { height: TALL, width, depth },
  };
}

// --- assembly ----------------------------------------------------------------

// Join baked layers into one buffer, one material, one draw call.
//
// The two layers are different colours and the material can only be one of
// them, so the difference is folded into the vertex colour that the tint bake
// has already written: a layer is multiplied by its own colour over the base
// colour, both in the renderer's linear working space, which is what
// THREE.Color gives for an sRGB hex with colour management on. The product is
// exactly what two materials produced, and it holds for the depth and distance
// passes for free because they never looked at colour in the first place.
//
// Everything else concatenates as it is: position, normal and aWind are all in
// the prop's own space already, and the index only needs its vertices offset.
function joinLayers(layers, baseColor) {
  const base = new THREE.Color(baseColor);
  let nVerts = 0, nIdx = 0;
  for (const l of layers) {
    nVerts += l.geo.getAttribute('position').count;
    nIdx += l.geo.getIndex().count;
  }
  const pos = new Float32Array(nVerts * 3);
  const nor = new Float32Array(nVerts * 3);
  const col = new Float32Array(nVerts * 3);
  const win = new Float32Array(nVerts * 4);
  const idx = nVerts > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);

  let vo = 0, io = 0;
  const c = new THREE.Color();
  for (const l of layers) {
    c.set(l.color);
    const kr = c.r / Math.max(1e-6, base.r);
    const kg = c.g / Math.max(1e-6, base.g);
    const kb = c.b / Math.max(1e-6, base.b);
    const p = l.geo.getAttribute('position').array;
    const n = l.geo.getAttribute('normal').array;
    const v = l.geo.getAttribute('color').array;
    const w = l.geo.getAttribute('aWind').array;
    const count = l.geo.getAttribute('position').count;
    pos.set(p, vo * 3);
    nor.set(n, vo * 3);
    win.set(w, vo * 4);
    for (let i = 0; i < count; i++) {
      col[(vo + i) * 3] = v[i * 3] * kr;
      col[(vo + i) * 3 + 1] = v[i * 3 + 1] * kg;
      col[(vo + i) * 3 + 2] = v[i * 3 + 2] * kb;
    }
    const li = l.geo.getIndex().array;
    for (let i = 0; i < li.length; i++) idx[io + i] = li[i] + vo;
    vo += count;
    io += li.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aWind', new THREE.BufferAttribute(win, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// What the finished prop actually measures, over every geometry in it.
function measureExtent(...geos) {
  let top = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > top) top = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { top: Math.max(1e-4, top), width: maxX - minX, depth: maxZ - minZ };
}

// One tier of tufts, from a list of sites.
function buildTufts(sites, { rand, W, H, stretch = [0.55, 0.55] }) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();

  for (const c of sites) {
    // A clump big enough to show its own outline gets the finer sphere; the
    // small ones nestled between them are a dozen pixels across at the scale
    // this prop is seen and would pay four times the triangles for an outline
    // nobody can resolve.
    const d = c.r > W * 0.044 ? 2 : 1;
    // Broad lobes give the tuft its shape. The tight ones are the texture, and
    // they only go on tufts fine enough to resolve them: on a 42-vertex sphere a
    // lobe at tight 7 falls between samples and comes out as a random dent.
    const lobes = makeLobes(rand, { count: 5, amp: [0.16, 0.44], tight: [1.4, 3.0], yBias: 0.10 });
    if (d >= 2) lobes.push(...makeLobes(rand, { count: 5, amp: [0.09, 0.20], tight: [5.0, 9.0], yBias: 0.1 }));
    // Elongated, and this is the change that moved the prop from "heap of soap
    // bubbles" to foliage: round lumps of two sizes read as foam whatever you do
    // to their shading, because nothing in a heap of spheres has a direction.
    // The two tangential axes are also scaled unequally so no clump is a body of
    // revolution.
    const kx = 0.72 + rand() * 0.30;
    const kz = 0.72 + rand() * 0.30;
    const pos = lumpPositions({
      detail: d,
      lobes,
      scaleY: 1.15 + rand() * 0.30,
      stretch: c.long * (stretch[0] + rand() * stretch[1]),
    });
    for (let j = 0; j < pos.length; j += 3) {
      pos[j] *= c.r * kx;
      pos[j + 1] *= c.r;
      pos[j + 2] *= c.r * kz;
    }
    q.setFromUnitVectors(up, c.n);
    spin.makeRotationY(rand() * Math.PI * 2);
    m.makeRotationFromQuaternion(q).multiply(spin).setPosition(c.p);

    // Stiffness at the CLUMP CENTRE, not per vertex. See bakeWind: the flutter
    // has to be constant across a clump for the stale-normal argument to hold.
    const u = Math.max(0, Math.min(1, c.p.y / (H * 0.90)));

    parts.push({
      positions: pos,
      index: icosphere(d).index,
      // Fuzz takes its parent tuft's phase, so the two move as one piece.
      matrix: m.clone(),
      phase: c.phase === undefined ? rand() : c.phase,
      tint: rand(),
      flutter: Math.pow(u, 1.8),
    });
  }
  return parts;
}

// Pick tuft sites off a surface: a shuffled sweep of its vertices, accepting one
// only if it is far enough from every tuft already placed. Rejection sampling
// rather than a fixed count of random picks, because random picks bunch up and
// leave a bald patch on one flank about a third of the time, and a bald flank is
// very visible at a fixed camera azimuth.
//
// The clipped forms do not use this: see napSites in clipped.js for why a
// vertex sweep cannot work on a box.
function clumpPlacements(geo, {
  rand, W, H,
  limit = 140,
  yMin = 0.11,
  big = [0.050, 0.026],     // [base, spread] as a fraction of W
  small = [0.028, 0.019],
  bigOdds = 0.34,
  gap = 0.44,
  parentPhase = null,
}) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const n = pos.count;

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  // Two sizes of clump, mixed, and the spacing test is written in terms of the
  // two radii rather than as one fixed gap. That is what lets a small clump
  // settle into the notch between two big ones instead of being pushed out to
  // arm's length, and detail at more than one scale is most of what separates
  // "fluffy" from "bumpy". A gap below 1 means neighbours overlap and the
  // crevice between them is a slot rather than a valley.
  const out = [];
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();

  for (let k = 0; k < n && out.length < limit; k++) {
    const i = order[k];
    p.fromBufferAttribute(pos, i);
    // Thinned over the lower third so the bush is shaggiest at the crown, which
    // is where the light is, but only thinned. An earlier pass cut the skirt off
    // entirely below a tenth of the height and thinned the rest by nearly half,
    // and what came back was a smooth dark patch of bare mass along the front of
    // the foot that read as a hole in the bush rather than as its shadow.
    if (p.y < H * yMin) continue;
    if (p.y < H * 0.40 && rand() < 0.22) continue;
    nv.fromBufferAttribute(nor, i);
    // Skip anything facing more than slightly downward: a clump on the underside
    // is invisible from an elevated camera and still costs a shadow pass.
    if (nv.y < -0.40) continue;

    // The large ones are kept off the skirt: a big clump low down sticks out
    // past the footprint and the bush grows a bustle.
    const isBig = rand() < bigOdds && p.y > H * 0.34;
    const spec = isBig ? big : small;
    const r = W * (spec[0] + rand() * spec[1]);

    let ok = true;
    for (let j = 0; j < out.length; j++) {
      if (out[j].p.distanceTo(p) < (out[j].r + r) * gap) { ok = false; break; }
    }
    if (!ok) continue;

    // Aimed a little more upright than the surface it sits on: foliage grows
    // toward the light, and clumps aimed exactly along the normal made the
    // flanks read as spines sticking out sideways. Then jittered, because a
    // hundred tufts all pointing exactly along their own normal is a sea
    // urchin: the scatter is what makes it look grown rather than extruded.
    nv.y += 0.24;
    nv.x += (rand() - 0.5) * 0.50;
    nv.z += (rand() - 0.5) * 0.50;
    nv.normalize();
    // One in seven runs long. A few sprigs standing out past the rest is the
    // difference between a trimmed shrub and an overgrown one, and overgrown is
    // what a churchyard corner looks like.
    const long = rand() < 0.14 ? 1.6 + rand() * 0.7 : 1;
    out.push({
      p: p.clone().addScaledVector(nv, r * 0.20),
      n: nv.clone(),
      r,
      long,
      phase: parentPhase ? parentPhase[i] : undefined,
    });
  }
  return out;
}
