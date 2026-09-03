import * as THREE from 'three';

// One palette and one surface treatment for every prop, so the set looks like
// it came from the same shelf as the ghost.
//
// The house style is a soft vinyl toy: smooth, rounded, matte, evenly lit.
// Nothing here is faceted, chipped or low-poly-rocky -- an earlier pass in that
// direction was rejected, and the ghost it stands next to is a smooth surface
// with no hard edges at all.

export const PALETTE = {
  pumpkinSkin: '#ffb268',
  pumpkinShade: '#ef9448',
  stem: '#6b4a2f',
  leaf: '#5f9e4a',
  glow: '#ffc061',
  stone: '#b9b6b1',
  stoneEngrave: '#6f6c68',
};

// Matte, slightly soft. High roughness keeps the highlight broad and diffuse
// rather than plasticky.
export function toyMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.82,
    metalness: 0.0,
    ...options,
  });
}

// Curved surfaces need enough segments that the silhouette reads as smooth at
// the scale these props are viewed. Cheap insurance: these are static props.
export const SEGMENTS = { radial: 48, height: 32, curve: 24 };

// Everything is authored against the ghost, which stands about 1.6 units tall
// with its hem near y = 0.2. A pumpkin should come up to roughly its hem.
export const SCENE_SCALE = { ghostHeight: 1.6, gridCell: 1 };
