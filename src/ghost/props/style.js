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
//
// ============================================================================
// THE HOUSE TESSELLATION IS NOW SCALED BY ONE NUMBER, AND HERE IS WHY
// ============================================================================
//
// "Cheap insurance" was true when a page showed one prop. The owner's own
// level shows ninety-one, and the arithmetic is not survivable: measured off
// public/levels/graveyard.json, built exactly as the game builds it,
//
//   bush     32 x  ~24,000   769,240
//   pumpkin  11 x  ~69,000   790,500
//   stone    37 x   ~9,400   347,152
//   lantern   8 x  ~21,500   172,328
//   fountain  2 x   39,816    79,632
//   shed      1 x   23,958    23,958
//                            ---------
//                            2,173,330 triangles of props
//
// plus five skeletons at 260,416 each. Three and a half million triangles for
// a scene whose whole visible content is about a third of a million pixels.
//
// AND THE FILL IS NOT THE PROBLEM, which is the measurement that decides this
// file. The owner ran the game at ?shadow=0&dpr=1 -- no shadow pass at all and
// a quarter of the pixels -- and reported "a bit better". If pixels were the
// wall, that would have been transformative. It was not, so what is left is
// the geometry and the CPU that submits it, and this is the geometry's dial.
//
// DETAIL scales every house tessellation number below. It is not a quality
// setting the player sees; it is the correction for the fact that these props
// were each authored against a lab render four to twenty-five times the size
// they are ever seen at. A pumpkin is forty pixels across in the game. Its
// shell was a 220 by 128 grid, which is forty triangles per pixel.
//
// ?detail= overrides it, so a before-and-after render is one URL apart and a
// machine that wants the lab's density can still have it.
//
// THE EDITOR RENDERS AT THIS TOO, AND THAT IS DELIBERATE. /editor/ imports the
// same prop modules, so it now draws the palette at the density the game ships
// at. That is the point of the tool -- a level laid out against a prettier
// preview than the game gives is a level laid out for the preview -- so please
// do not "fix" the editor back to the old numbers. If you want the lab's
// density for a close look at one prop, /editor/?detail=1 gives it to you for
// that session and changes nothing about what ships.
export const DETAIL = (() => {
  const dflt = 0.5;
  // A headless probe has no URL. It reads the same dial off the environment so
  // the arithmetic in a node script and the picture in the browser are the
  // same setting; nothing in the shipped page looks at this.
  if (typeof process !== 'undefined' && process.env && process.env.DETAIL) {
    const e = Number(process.env.DETAIL);
    if (Number.isFinite(e) && e > 0) return e;
  }
  if (typeof window === 'undefined' || !window.location) return dflt;
  try {
    const v = Number(new URLSearchParams(window.location.search).get('detail'));
    return Number.isFinite(v) && v > 0 ? v : dflt;
  } catch { return dflt; }
})();

// Scale a tessellation count by DETAIL. Never below `min`: past about eight
// steps a swept round thing stops being round, and a saving that turns a
// lantern's glass into a hexagon is not a saving.
export function seg(n, min = 8) {
  return Math.max(min, Math.round(n * DETAIL));
}

export const SEGMENTS = { radial: seg(48, 12), height: seg(32, 8), curve: seg(24, 6) };

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
