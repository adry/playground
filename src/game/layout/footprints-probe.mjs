// Where the numbers in footprints.js came from, and how to get them again.
//
//   node src/game/layout/footprints-probe.mjs
//
// It builds every placeable prop headless, several seeds each, takes the world
// bounding box of what comes back and prints the table. Nothing renders: the
// props check for a document before they build a texture, so in node they come
// out as geometry alone, which is all a footprint is made of.
//
// Run it when a prop changes shape. If a number here disagrees with
// footprints.js, footprints.js is stale and this is right, with two documented
// exceptions that are in the table's own comments: the shed, whose scattered
// planks reach far past the building, and the grave hole, whose turf skirt is
// flat ground a headstone is meant to stand on.

import * as THREE from 'three';

const P = new URL('../../ghost/props/', import.meta.url).pathname;

function boxOf(built) {
  const group = built?.isObject3D ? built : (built?.group ?? built?.mesh ?? built?.root);
  if (!group?.isObject3D) return null;
  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  return Number.isFinite(box.min.x) ? box : null;
}

function measure(build, seeds = 4) {
  let hx = 0;
  let hz = 0;
  let top = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const box = boxOf(build(seed));
    if (!box) return null;
    hx = Math.max(hx, Math.abs(box.min.x), Math.abs(box.max.x));
    hz = Math.max(hz, Math.abs(box.min.z), Math.abs(box.max.z));
    top = Math.max(top, box.max.y);
  }
  return { hx, hz, top };
}

const rows = [];
const add = (name, shape, m) => rows.push({ name, shape, ...m });

const { VARIANTS, createTombstone } = await import(P + 'stones/index.js');
for (const variant of VARIANTS) {
  add(`stone/${variant}`, 'box', measure((seed) => createTombstone({ variant, seed })));
}

const { PUMPKIN_VARIANTS, createPumpkin } = await import(P + 'pumpkin.js');
for (const variant of PUMPKIN_VARIANTS) {
  add(`pumpkin/${variant}`, 'disc', measure((seed) => createPumpkin({ variant, seed })));
}

const lanterns = [
  ['ground', 'lanterns/ground.js', 'createGroundLantern'],
  ['hurricane', 'lanterns/hurricane.js', 'createHurricaneLamp'],
  ['jars', 'lanterns/jars.js', 'createCandleJars'],
  ['pillar', 'lanterns/pillar.js', 'createPillarLantern'],
  ['post', 'lanterns/post.js', 'createPostLantern'],
  ['crook', 'lanterns/crook.js', 'createCrookLantern'],
  ['brazier', 'lanterns/brazier.js', 'createBrazier'],
  ['twinlamp', 'lanterns/twinlamp.js', 'createTwinLamp'],
  ['street', 'lanterns/street.js', 'createStreetLamp'],
];
for (const [name, file, fn] of lanterns) {
  const mod = await import(P + file);
  add(`lantern/${name}`, 'disc', measure((seed) => mod[fn]({ seed }), 2));
}

const { BUSH_VARIANTS, createBush } = await import(P + 'foliage/bush.js');
for (const variant of BUSH_VARIANTS) {
  // Six seeds rather than the two the other miscellaneous props get. A
  // clipped bush jitters its own size by a few per cent per seed and the leaf
  // layer is scattered, so the widest of two seeds is a noticeably softer
  // bound than the widest of six. The box variant is measured as a box: it
  // has faces, and a circumscribed circle round a square is 41% too big.
  add(`bush/${variant}`, variant === 'box' ? 'box' : 'disc',
    measure((seed) => createBush({ seed, variant }), 6));
}

const misc = [
  ['fountain', 'disc', 'fountain/index.js', 'createFountain'],
  ['shed', 'disc', 'shed/index.js', 'createShed'],
  ['dirt', 'box', 'ground/dirtpile.js', 'createDirtPile'],
  ['hole', 'box', 'ground/hole.js', 'createGraveHole'],
];
for (const [name, shape, file, fn] of misc) {
  const mod = await import(P + file);
  add(name, shape, measure((seed) => mod[fn]({ seed }), 2));
}

console.log('prop                 shape  halfU  halfV  radius  height');
for (const r of rows) {
  if (!r.hx && !r.hz) { console.log(`${r.name.padEnd(20)} could not be measured`); continue; }
  const radius = r.shape === 'disc' ? Math.max(r.hx, r.hz) : Math.hypot(r.hx, r.hz);
  console.log(
    r.name.padEnd(20) + r.shape.padEnd(7)
    + r.hx.toFixed(3).padStart(6) + r.hz.toFixed(3).padStart(7)
    + radius.toFixed(3).padStart(8) + r.top.toFixed(3).padStart(8),
  );
}
console.log('\nhalfU is along the prop local X, halfV along its local Z, both before yaw.');
console.log('A disc keeps the larger of the two as its radius; a box keeps both.');
