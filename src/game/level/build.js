// ONE PROP RECORD IN, ONE BUILT PROP OUT. The only switch of its kind.
//
// This is src/game/viewer.js's `buildProp` lifted out so that the editor and
// the viewer cannot drift. A second switch somewhere else is how a level ends
// up looking one way in the tool that made it and another way in the game, and
// there is no version of that bug worth debugging.
//
// The record it takes is the one every world query publishes:
//
//   { kind, variant, x, z, yaw, radius, height, solid, foot }
//
// and what it returns is the props' own shape, { group, update?, dispose? },
// or null for a kind this build does not have. The caller positions the group;
// this decides only what the thing IS.
//
// The seed is derived from the position rather than passed in, which is what
// the viewer already did and is worth keeping: a prop rebuilt after a reload,
// a re-stream or an undo is the same prop, because nothing about it is stored.

import { createTombstone } from '../../ghost/props/stones/index.js';
import { createPumpkin } from '../../ghost/props/pumpkin.js';
import { createBush } from '../../ghost/props/foliage/bush.js';
import { createDirtPile } from '../../ghost/props/ground/dirtpile.js';
import { createGraveHole } from '../../ghost/props/ground/hole.js';
import { createGroundLantern } from '../../ghost/props/lanterns/ground.js';
import { createPostLantern } from '../../ghost/props/lanterns/post.js';
import { createHurricaneLamp } from '../../ghost/props/lanterns/hurricane.js';
import { createCandleJars } from '../../ghost/props/lanterns/jars.js';
import { createPillarLantern } from '../../ghost/props/lanterns/pillar.js';
import { createCrookLantern } from '../../ghost/props/lanterns/crook.js';
import { createBrazier } from '../../ghost/props/lanterns/brazier.js';
import { createTwinLamp } from '../../ghost/props/lanterns/twinlamp.js';
import { createStreetLamp } from '../../ghost/props/lanterns/street.js';
import { createGrassPatch, createGrassTuft } from '../../ghost/props/ground/grass.js';
import { createFlowerClump } from '../../ghost/props/ground/flowers.js';
import { createFountain } from '../../ghost/props/fountain/index.js';
import { createShed } from '../../ghost/props/shed/index.js';
import { setWindEnabled, windEnabled } from '../../ghost/props/foliage/wind.js';

// Every wobble in a prop hangs off this, so it has to be the same number every
// time the same prop is built and a different one for its neighbour.
export function propSeed(p) {
  return (Math.abs(Math.round(p.x * 977 + p.z * 131)) | 0) || 1;
}

const LANTERNS = {
  ground: createGroundLantern,
  post: createPostLantern,
  hurricane: createHurricaneLamp,
  jars: createCandleJars,
  pillar: createPillarLantern,
  crook: createCrookLantern,
  brazier: createBrazier,
  twinlamp: createTwinLamp,
  street: createStreetLamp,
};

// NOTHING BUILT HERE MOVES IN THE WIND, and that is enforced rather than
// assumed. READ THIS IF YOU ARE ADDING A PLANT.
//
// foliage/wind.js has a global switch, off by default, and attachWind reads it
// when a plant is BUILT rather than when it is drawn. That is a good bargain
// for a still scene (a plant that cannot move costs no vertex work and no
// extra shader programs) and a trap for exactly one situation: a page that
// turned the wind on for its own reasons, and then an author paints a level
// through this door. The plant would come out animated and stay animated for
// the life of the object, and grass is the worst of them by a distance -- a
// patch is a hundred blades at 0.088 units of tip travel with a full second of
// phase spread inside one patch, which does not read as a plant leaning, it
// reads as a lawn crawling.
//
// So the switch is forced off around the build and put back afterwards. It
// costs two function calls per prop. If a windy authored level is ever wanted,
// this wrapper is the line to change, and changing it is a decision somebody
// makes on purpose rather than a state a page leaked in.
export function buildLevelProp(p, opts = {}) {
  const windy = windEnabled();
  if (windy) setWindEnabled(false);
  try {
    return buildStillProp(p, opts);
  } finally {
    if (windy) setWindEnabled(true);
  }
}

function buildStillProp(p, { allowCut = true } = {}) {
  const s = propSeed(p);
  switch (p.kind) {
    case 'stone': return createTombstone({ variant: p.variant, seed: s });
    case 'bench': return createTombstone({ variant: 'bench', seed: s });
    case 'pumpkin': return createPumpkin({ variant: p.variant, seed: s });
    // A pellet is a pumpkin. The world calls it `jack` because the rules half
    // collects it, not because it is a different prop.
    case 'jack': return createPumpkin({ variant: p.variant || 'classic', seed: s });
    case 'bush': return createBush({ seed: s, variant: p.variant });
    case 'dirt': return createDirtPile({ seed: s, spade: (s & 3) === 0 });
    case 'lantern': return (LANTERNS[p.variant] || createGroundLantern)({ seed: s });
    case 'grass': return p.variant === 'tuft' ? createGrassTuft({ seed: s }) : createGrassPatch({ seed: s });
    case 'flowers': return createFlowerClump({ seed: s, variant: p.variant });
    case 'fountain': return createFountain({ seed: s });
    case 'shed': return createShed({ seed: s });
    case 'hole': {
      // The floor takes four cuts and THROWS at the fifth, so this is a hard
      // engine limit rather than a taste one. Past four, the pit is simply not
      // registered: the geometry still builds and reads as a filled grave,
      // which is a tidy fallback rather than a missing prop.
      const h = createGraveHole({ seed: s });
      h.__wantsCut = allowCut;
      return h;
    }
    default: return null;
  }
}

// THERE ARE NO PATHS ANY MORE. A path used to be a drawn ribbon -- a polyline
// with a material, built here by createSandPath and its siblings -- and the
// owner has taken the whole idea out. Since the ground cover rewrite a road is
// something you PAINT, with a real edge and a kerb along the boundary where two
// materials meet, and a ribbon drawn on top of that was a second way to do the
// same thing badly. props/ground/sandpath.js and gravelpath.js are still on
// disk and are still good work; nothing in the project imports them.

export default buildLevelProp;
