// A PICTURE OF EVERY THING YOU CAN PLACE.
//
// The palette used to be a list of words: twenty-nine headstones called
// "draped", "stele", "pillow", "calvary". The owner drew every one of them by
// eye, over days, and could not see a single one in the tool that places them.
// A name is a label for a thing you already know; this is a tool for choosing.
//
// So each entry is rendered once, as the real prop, and cached for the session.
//
// FOUR DECISIONS.
//
//   THE GAME'S OWN CAMERA, not a front elevation. The whole prop set was
//   authored for an orthographic view along (1, 0.78, 1) and several pieces
//   read wrong from anywhere else; the editor's own scene makes the same
//   argument in its header. A thumbnail at any other angle would be a picture
//   of something the author will never see.
//
//   THE EDITOR'S RENDERER, through a render target, rather than a second
//   WebGL context. A context is a scarce thing in a browser and a second one
//   here would compile every shader in the project twice.
//
//   ONE AT A TIME, ON A FRAME THAT IS DOING NOTHING ELSE. A thumbnail is a real
//   prop build, which for a headstone is a canvas bake, so fifty of them at
//   startup is exactly the stall this is supposed to be worth. Nothing is built
//   until a group is opened, at most one is built per frame, and none is built
//   while a drag is in progress. Opening the headstones fills them in over
//   about a second and a half and they are never built again.
//
//   THE PROP IS DISPOSED AFTERWARDS AND THAT IS SAFE. tombstones.js pools its
//   texture bakes by variant and refcounts them, so dispose() releases the
//   thumbnail's claim and leaves the maps in the pool. Rendering the palette
//   therefore WARMS the pool for the level: the first headstone the author
//   places has already been baked.
//
// The one thing this cannot show is scale. A grass tuft and a shed each fill
// their own tile, because a shed drawn to scale beside a tuft is one visible
// shed and forty-nine grey squares. The footprint in the tooltip is where the
// size lives.

import * as THREE from 'three';
import { buildLevelProp } from '../game/level/build.js';

// Props were authored to face the camera and the camera looks along
// (1, 0.78, 1), so a face on local +Z reads square to the viewer at PI/4.
const FACE_YAW = Math.PI / 4;
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();

// Rendered at twice the size it is shown at and scaled down by the 2D context,
// because a render target has no multisampling and a headstone is mostly
// silhouette. Cheaper and better than any shader-side edge treatment.
const SUPER = 2;

export function createThumbnails({ renderer, size = 76 }) {
  const W = size * SUPER;

  const scene = new THREE.Scene();
  // The editor's own rig, so a prop is lit here the way it is lit out there.
  // No shadows: there is no floor in this scene to receive one, and rendering
  // a shadow map per thumbnail would cost more than the thumbnail.
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.position.set(3.7, 6.0, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const target = new THREE.WebGLRenderTarget(W, W, { depthBuffer: true });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = false;

  const pixels = new Uint8Array(W * W * 4);
  const flat = document.createElement('canvas');
  flat.width = W;
  flat.height = W;
  const flatCtx = flat.getContext('2d', { willReadFrequently: true });
  const small = document.createElement('canvas');
  small.width = size;
  small.height = size;
  const smallCtx = small.getContext('2d');
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = 'high';

  const cache = new Map();     // key -> data URL, or null for "there is no prop"
  const queue = [];            // keys waiting, nearest the top of the list first
  const queued = new Set();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();

  const keyOf = (kind, variant) => `${kind}/${variant ?? ''}`;

  // The tightest square frame that holds the prop from this angle. The eight
  // corners of its bounding box are put into the camera's own space and the
  // largest of them decides the half extent, which is exact for a box and
  // several tiles' worth tighter than a bounding sphere would be. A tall thin
  // obelisk and a wide flat ledger both fill their tile.
  function frame(group) {
    box.setFromObject(group);
    if (box.isEmpty()) return false;
    box.getCenter(centre);
    camera.position.copy(centre).addScaledVector(CAM_DIR, 100);
    camera.up.set(0, 1, 0);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    const toCam = camera.matrixWorldInverse;
    let half = 0.001;
    for (const sx of [box.min.x, box.max.x]) {
      for (const sy of [box.min.y, box.max.y]) {
        for (const sz of [box.min.z, box.max.z]) {
          corner.set(sx, sy, sz).applyMatrix4(toCam);
          half = Math.max(half, Math.abs(corner.x), Math.abs(corner.y));
        }
      }
    }
    half *= 1.08;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    return true;
  }

  function render(kind, variant) {
    let made = null;
    try {
      made = buildLevelProp({ kind, variant, x: 0, z: 0, yaw: FACE_YAW }, { allowCut: false });
    } catch {
      return null;
    }
    if (!made) return null;
    made.group.position.set(0, 0, 0);
    made.group.rotation.y = FACE_YAW;
    scene.add(made.group);
    made.group.updateMatrixWorld(true);

    let url = null;
    if (frame(made.group)) {
      const wasTarget = renderer.getRenderTarget();
      const wasClear = renderer.getClearColor(new THREE.Color());
      const wasAlpha = renderer.getClearAlpha();
      const wasShadow = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(target);
      // Transparent, so the tile's own background shows behind the prop and a
      // thumbnail is a cut-out rather than a stamp of a grey square.
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, W, W, pixels);
      renderer.setRenderTarget(wasTarget);
      renderer.setClearColor(wasClear, wasAlpha);
      renderer.shadowMap.enabled = wasShadow;

      // GL reads bottom up and a canvas draws top down.
      const img = flatCtx.createImageData(W, W);
      for (let y = 0; y < W; y++) {
        img.data.set(pixels.subarray((W - 1 - y) * W * 4, (W - y) * W * 4), y * W * 4);
      }
      flatCtx.putImageData(img, 0, 0);
      smallCtx.clearRect(0, 0, size, size);
      smallCtx.drawImage(flat, 0, 0, size, size);
      url = small.toDataURL('image/png');
    }

    scene.remove(made.group);
    // Releases this prop's claim on the pooled bake rather than freeing it.
    made.dispose?.();
    return url;
  }

  return {
    // The picture, or null while there is not one yet. A caller that gets null
    // should also have asked for it with want().
    get(kind, variant) {
      const k = keyOf(kind, variant);
      return cache.has(k) ? cache.get(k) : null;
    },

    // "These are the entries a person can currently see." Anything already
    // rendered or already queued is ignored, so calling this on every panel
    // redraw costs a walk of the list and nothing else.
    want(entries) {
      for (const e of entries) {
        const k = keyOf(e.kind, e.variant);
        if (cache.has(k) || queued.has(k)) continue;
        queued.add(k);
        queue.push({ k, kind: e.kind, variant: e.variant });
      }
    },

    // One per call, from the frame loop. Returns what it drew and where it
    // belongs, or null when there was nothing left to draw.
    pump() {
      const job = queue.shift();
      if (!job) return null;
      queued.delete(job.k);
      const url = render(job.kind, job.variant);
      cache.set(job.k, url);
      return { key: job.k, url };
    },

    get pending() { return queue.length; },
    keyOf,
    dispose() {
      target.dispose();
      cache.clear();
    },
  };
}

export default createThumbnails;
