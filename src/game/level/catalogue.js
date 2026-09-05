// EVERY PROP A HAND-MADE LEVEL MAY HOLD, and the box each one takes up.
//
// src/game/layout/footprints.js is the measured table and it stays the single
// source of truth for everything it lists. This file exists for two jobs it
// cannot do:
//
//   1. footprintOf() THROWS for a kind it does not know, and the generator
//      knows a smaller set than an author does. It never places grass, flowers
//      or the kerbed plot, so those three have no row there; deliberately, in
//      the case of `stone/kerb`, because adding a row would make the generator
//      start placing it. So the extras are measured HERE and footprints.js is
//      left alone.
//   2. the editor needs the palette itself: what kinds exist, which variants
//      each has, and what a click on a swatch means.
//
// The extra numbers below came off the same probe footprints.js documents, run
// against the props this file adds:
//
//   node src/game/layout/footprints-probe.mjs   (the generator's set)
//   stone/kerb   0.463 x 2.147, top 0.920
//   flowers      daisies 0.473, spires 0.371, posy 0.257, jar 0.203
//   grass/patch  1.461 x 1.516, top 0.258      grass/tuft 0.227
//
// Anything here that footprints.js DOES list is read from footprints.js, so a
// re-measure there lands in the editor without a second edit.

import { footprintOf, boundingRadius } from '../layout/footprints.js';
import { VARIANTS as STONE_VARIANTS } from '../../ghost/props/stones/index.js';
import { BUSH_VARIANTS } from '../../ghost/props/foliage/bush.js';
import { PUMPKIN_VARIANTS } from '../../ghost/props/pumpkin.js';
import { FLOWER_VARIANTS } from '../../ghost/props/ground/flowers.js';

// Kinds that do not stop a body. The generator's placer says hole and dirt; a
// hand-made level can also lay grass and flowers, which are ankle-high
// dressing and are no more solid than a spoil heap.
export const SOFT_KINDS = new Set(['hole', 'dirt', 'grass', 'flowers']);

// The rows footprints.js has no business carrying.
const EXTRA = {
  'stone/kerb': { shape: 'box', halfU: 0.463, halfV: 2.147, height: 0.920 },
  'flowers/daisies': { shape: 'disc', r: 0.473, height: 0.235 },
  'flowers/spires': { shape: 'disc', r: 0.371, height: 0.366 },
  'flowers/posy': { shape: 'disc', r: 0.257, height: 0.205 },
  'flowers/jar': { shape: 'disc', r: 0.203, height: 0.332 },
  'grass/patch': { shape: 'disc', r: 1.516, height: 0.258 },
  'grass/tuft': { shape: 'disc', r: 0.227, height: 0.178 },
};

export const LANTERN_VARIANTS = [
  'ground', 'hurricane', 'jars', 'pillar', 'post', 'crook', 'brazier', 'twinlamp', 'street',
];
export const GRASS_VARIANTS = ['patch', 'tuft'];

// The four personalities rules.js runs, in the order it names them. A grave
// carries one of these, which is what makes "which skeleton climbs out of
// which hole" an authored decision rather than an accident of list order.
export const PERSONALITIES = ['chaser', 'ambusher', 'flanker', 'loner'];

// The floor takes four cuts and throws at the fifth (MAX_GROUND_HOLES in
// src/ghost/ground.js), and rules.js runs exactly four personalities. The two
// numbers agree, which is why the editor can refuse a fifth spawn with one
// sentence instead of an explanation.
export const MAX_SPAWNS = 4;

// What a footprint is for a kind the editor may place. Never throws: an
// unknown kind gets a small disc and the caller can carry on, because a level
// file that names something this build does not have should open with a
// warning rather than a stack trace.
export function levelFootprint(kind, variant) {
  const extra = EXTRA[`${kind}/${variant}`] || EXTRA[kind];
  if (extra) return { ...extra };
  try {
    return footprintOf(kind, variant);
  } catch {
    return { shape: 'disc', r: 0.4, height: 0.5 };
  }
}

export function isSolid(kind) {
  return !SOFT_KINDS.has(kind);
}

export { boundingRadius };

// --- the palette -------------------------------------------------------------
//
// Groups in the order an author reaches for them: the stones first, because a
// graveyard is stones, then the things that dress the ground, then the two
// buildings, then the lines you draw rather than click.

export const PALETTE = [
  {
    id: 'stones',
    label: 'headstones',
    kind: 'stone',
    // All 29, in the order stones/index.js registers them, which runs small to
    // large. That order is the palette's order for the same reason it is the
    // lineup's: a row of them reads as a family.
    variants: STONE_VARIANTS.slice(),
  },
  { id: 'pumpkins', label: 'pumpkins', kind: 'pumpkin', variants: PUMPKIN_VARIANTS.slice() },
  { id: 'lanterns', label: 'lanterns', kind: 'lantern', variants: LANTERN_VARIANTS.slice() },
  { id: 'foliage', label: 'planting', kind: null, items: [
    // The clipped three first, then the shrub they were cut from. An author
    // reaching for planting along a path wants topiary; the overgrown one is
    // for the corner by the wall.
    ...BUSH_VARIANTS.map((v) => ({
      kind: 'bush', variant: v, label: v === 'wild' ? 'bush overgrown' : `bush ${v}`,
    })),
    { kind: 'grass', variant: 'patch', label: 'grass patch' },
    { kind: 'grass', variant: 'tuft', label: 'grass tuft' },
    ...FLOWER_VARIANTS.map((v) => ({ kind: 'flowers', variant: v, label: `flowers ${v}` })),
  ] },
  { id: 'earthworks', label: 'earthworks', kind: null, items: [
    { kind: 'hole', variant: 'grave', label: 'grave hole' },
    { kind: 'dirt', variant: null, label: 'spoil heap' },
  ] },
  { id: 'buildings', label: 'buildings', kind: null, items: [
    { kind: 'fountain', variant: null, label: 'fountain' },
    { kind: 'shed', variant: null, label: 'shed' },
  ] },
  { id: 'pellets', label: 'pellets', kind: null, items: [
    { kind: 'jack', variant: 'classic', label: 'power pumpkin' },
  ] },
];

// Every (kind, variant) the palette can produce, flattened.
export function paletteEntries() {
  const out = [];
  for (const group of PALETTE) {
    if (group.items) {
      for (const it of group.items) out.push({ ...it, group: group.id });
    } else {
      for (const v of group.variants) {
        out.push({ kind: group.kind, variant: v, label: `${group.kind} ${v}`, group: group.id });
      }
    }
  }
  return out;
}

export default PALETTE;
