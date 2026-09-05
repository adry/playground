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
import { createSandPath } from '../../ghost/props/ground/sandpath.js';
import { createGravelPath } from '../../ghost/props/ground/gravelpath.js';
import { createKerbRun } from '../../ghost/props/ground/kerb.js';

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

export function buildLevelProp(p, { allowCut = true } = {}) {
  const s = propSeed(p);
  switch (p.kind) {
    case 'stone': return createTombstone({ variant: p.variant, seed: s });
    case 'bench': return createTombstone({ variant: 'bench', seed: s });
    case 'pumpkin': return createPumpkin({ variant: p.variant, seed: s });
    // A pellet is a pumpkin. The world calls it `jack` because the rules half
    // collects it, not because it is a different prop.
    case 'jack': return createPumpkin({ variant: p.variant || 'classic', seed: s });
    case 'bush': return createBush({ seed: s });
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

// The lines: a path is a polyline and not a point, so it does not go through
// the switch above. `material` is the level file's extra field; a record
// without one is sand, which is what the generator's paths have always been.
export function buildLevelPath(p, { seed = 3 } = {}) {
  const points = p.points;
  const width = p.width || 1.3;
  if (p.material === 'gravel') return createGravelPath({ seed, width, points });
  if (p.material === 'kerb') return createKerbRun({ seed, points });
  return createSandPath({ seed, width, points });
}

export default buildLevelProp;
