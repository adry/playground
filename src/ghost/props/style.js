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

// A soft occlusion patch to sit directly under a prop.
//
// The scene's one shadow-casting light comes in at an angle, so its shadow is
// thrown off to the side and nothing darkens the ground where the prop actually
// meets it -- which is what makes a prop look like it is hovering a millimetre
// up. This is the contact term that a single directional light cannot give you.
export function contactShadow({ radius = 0.5, opacity = 0.42, softness = 0.55 } = {}) {
  // Props are built head-less in tests; without a canvas there is simply no
  // patch, and the caller's dispose() still has something to call.
  if (typeof document === 'undefined') {
    const stub = new THREE.Object3D();
    stub.userData.dispose = () => {};
    return stub;
  }

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.5 * (1 - softness), size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,   // never occlude anything, it is only a stain
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  mesh.renderOrder = -1;
  mesh.userData.dispose = () => { texture.dispose(); material.dispose(); mesh.geometry.dispose(); };
  return mesh;
}
