import * as THREE from 'three';
import { toyMaterial } from '../style.js';

// The fountain's stone. Creamy white marble with soft grey-brown veining and
// darker mottling, in the same soft matte vinyl register as tombstones.js.
//
// It is the same recipe as the headstones -- a white base canvas carrying only
// detail, the hue left on the material so one constant owns it, low-contrast
// radial mottling plus a fine speckle, and a normal map baked off a separate
// height canvas rather than a bumpMap so the relief holds at any camera
// distance. Two things are different, and both are forced by the shape:
//
//   1. The headstone is a slab with a flat face, so it can afford a planar
//      projection and a texture authored once per stone. The fountain is a
//      lathe: every part of it is curved, and the only projection that does not
//      smear is (angle, arc length). That wraps, so the artwork has to TILE in
//      both directions -- hence wrapDraw below, which stamps every blob and
//      every vein nine times so nothing is cut off at an edge.
//
//   2. "Strongest near the rim and around the chips" is a fact about WHERE on
//      the object you are, not about the texture. A tiling texture cannot know.
//      So the strength lives in a vertex colour instead, authored by the
//      geometry (see lathe.js), and the map stays uniform. That also means the
//      same square metre of marble can be weak on the plinth and strong on the
//      rim without a second texture.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Creamy white, a lighter and warmer sibling of PALETTE.stone (#b9b6b1). The
// headstones are grey; the reference's fountain is off-white marble standing
// next to them, and this is the smallest step that reads as a different stone
// rather than a different world.
export const MARBLE_COLOUR = '#cec8bc';

// The veining tint, multiplied in through the vertex colour. Grey-brown, never
// far from the base: marble veins are a shift in the same rock, not a stripe.
//
// Pulled back from 0.80/0.775/0.735. A fifth of the value is a lot to take out
// of a surface that is ALREADY the darkest thing in the frame: the rim
// undersides and the interiors face away from the key and see only the
// hemisphere's ground colour, so the weathering landed on top of the shading
// instead of beside it, and the two together read as bruising. The reference's
// marble is mottled, not battered.
export const VEIN_TINT = { r: 0.885, g: 0.870, b: 0.845 };

const TEX = 512;

// Stamp a drawing operation nine times, at every wrap offset, so anything that
// runs off one edge of the canvas comes back on the other. Cheaper than
// authoring a genuinely periodic function and it costs nothing at build time.
function wrapDraw(ctx, w, h, fn) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * w, oy * h);
      fn(ctx);
      ctx.restore();
    }
  }
}

// Low-contrast cloudy patches. Same idea as the headstones' mottle(): this is
// what stops a flat fill reading as moulded plastic.
function mottle(ctx, w, h, rng, light, dark, strength, count = 90) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.05 + rng() * 0.16) * h;
    const col = rng() < 0.5 ? light : dark;
    const rot = rng() * Math.PI;
    const sq = 0.5 + rng() * 0.9;
    wrapDraw(ctx, w, h, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col}, ${strength})`);
      g.addColorStop(1, `rgba(${col}, 0)`);
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, r, r * sq, rot, 0, Math.PI * 2);
      c.fill();
    });
  }
}

// One vein: a wandering polyline, drawn twice -- a wide soft pass for the halo
// the vein bleeds into the surrounding stone, and a narrow one for its core.
// Real marble veins are a stained fracture, so they are never a clean line.
function vein(ctx, w, h, rng, colour) {
  const pts = [];
  let x = rng() * w;
  let y = rng() * h;
  // Veins in a block run roughly parallel, with a spread. Biased towards the
  // diagonal so they cross both wrap seams and never look like a grid.
  let dir = -Math.PI * 0.32 + (rng() - 0.5) * 1.5;
  const steps = 10 + Math.floor(rng() * 8);
  const step = h * (0.10 + rng() * 0.07);
  for (let i = 0; i < steps; i++) {
    pts.push([x, y]);
    dir += (rng() - 0.5) * 0.9;
    x += Math.cos(dir) * step;
    y += Math.sin(dir) * step;
  }
  const stroke = (width, alpha, blur) => {
    wrapDraw(ctx, w, h, (c) => {
      c.filter = blur ? `blur(${blur}px)` : 'none';
      c.strokeStyle = `rgba(${colour}, ${alpha})`;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      c.stroke();
      c.filter = 'none';
    });
  };
  // Both passes are deliberately faint. A first attempt at 0.16 and 0.30 came
  // back as a ball of string wound round the fountain, and 0.055 and 0.105 were
  // still too strong: the house stone next to this one, tombstones.js, has no
  // veins at all, only a 0.085 mottle, so a vein that is legible as a line is
  // already louder than anything else on the shelf. What wants to survive is
  // only the sense that the stone has a grain.
  stroke(h * 0.045, 0.030, 7);
  stroke(h * 0.007, 0.055, 1.6);
}

// Height canvas -> tangent-space normal map. Lifted from tombstones.js for the
// same reason it exists there: a bumpMap's relief is driven by screen-space
// derivatives and softens as the camera pulls back, where slopes baked here do
// not. Wraps at the edges instead of clamping, because this map tiles.
function heightToNormalMap(canvas, strength) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => src[(((y % h) + h) % h * w + (((x % w) + w) % w)) * 4] / 255;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w; // DataTexture ignores flipY, so flip by hand
    for (let x = 0; x < w; x++) {
      const gx = at(x + 2, y) - at(x - 2, y);
      const gy = at(x, y + 2) - at(x, y - 2);
      const nx = -gx * strength;
      const ny = gy * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      out[i] = (nx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function marbleTextures(seed = 1) {
  if (typeof document === 'undefined') return null; // built head-less in tests

  const rng = mulberry32(seed * 2654435761 + 91);

  const colour = document.createElement('canvas');
  colour.width = TEX;
  colour.height = TEX;
  const cc = colour.getContext('2d');
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, TEX, TEX);
  // Broad cloud first, then the veins on top of it, then a fine speckle. The
  // order matters: veins under the clouds go muddy, veins over the speckle eat
  // it. Strengths are all low -- this is a toy fountain, not a marble scan.
  mottle(cc, TEX, TEX, rng, '168,161,148', '255,255,255', 0.052);
  for (let i = 0; i < 6; i++) vein(cc, TEX, TEX, rng, '150,141,126');
  for (let i = 0; i < 2; i++) vein(cc, TEX, TEX, rng, '134,124,110');
  for (let i = 0; i < 2400; i++) {
    cc.fillStyle = `rgba(${rng() < 0.5 ? '146,140,130' : '255,255,255'}, 0.045)`;
    cc.fillRect(rng() * TEX, rng() * TEX, 1.5, 1.5);
  }

  // Height. Only the slow swell of a hand-polished surface -- the veins are a
  // stain in the stone and are deliberately absent here. Giving them relief was
  // the obvious thing and it is wrong: it turns polished marble into a rind.
  const height = document.createElement('canvas');
  height.width = TEX;
  height.height = TEX;
  const hc = height.getContext('2d');
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, TEX, TEX);
  mottle(hc, TEX, TEX, mulberry32(seed * 40503 + 7), '104,104,104', '168,168,168', 0.06, 70);

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  return { map, normalMap: heightToNormalMap(height, 6) };
}

export function marbleMaterial(tex) {
  const m = toyMaterial(MARBLE_COLOUR, {
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
    vertexColors: true, // carries the rim and chip weathering, see lathe.js
  });
  // A hair less rough than the headstones' 0.82. Marble is polished and the
  // difference is the whole reason it reads as a different stone, but pushed
  // any further it picks up a specular the vinyl-toy set does not have.
  m.roughness = 0.74;
  return m;
}
