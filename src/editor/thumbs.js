// A PICTURE OF EVERY THING YOU CAN PLACE.
//
// The palette used to be a list of words: twenty-nine headstones called
// "draped", "stele", "pillow", "calvary". The owner drew every one of them by
// eye, over days, and could not see a single one in the tool that places them.
// A name is a label for a thing you already know; this is a tool for choosing.
//
// ============================================================================
// THE FIRST VERSION OF THIS FILE WAS THE SLOWEST THING IN THE EDITOR
// ============================================================================
//
// It rendered ONE THUMBNAIL PER FRAME off the render loop, which sounds
// considerate and is the worst schedule available. Measured at 1400x900:
// a tick with the palette filling was 801 ms, of which 630 ms was the
// thumbnail, and sampling ninety frames in that state did not finish in 890
// seconds. Two separate pathologies, and this project has written both of them
// down before:
//
//   A CANVAS BAKE COSTS ABOUT FIVE TIMES MORE AFTER THE RENDERER HAS DRAWN
//   than in a batch before it -- 216 ms a template cold against 1082 ms warm,
//   measured on the sand path and recorded in src/game/scene.js. One bake per
//   frame does not spread the cost, it puts EVERY bake in the expensive
//   regime. Back to back pays the penalty once.
//
//   readRenderTargetPixels IS A SYNCHRONOUS GPU STALL, once per thumbnail,
//   fifty times.
//
// So this version does three things differently, and between them the cost
// stops mattering.
//
//   A GROUP AT A TIME, IN ONE BATCH, OFF THE LOOP. Nothing renders until a
//   group is expanded, and then the whole group renders back to back from a
//   timer rather than a frame, behind the group's own "drawing" line. The
//   render loop never touches this file.
//
//   ONE READBACK FOR THE WHOLE GROUP. Every tile in a batch is drawn into one
//   ATLAS through the scissor, and the atlas is read once. Twenty-nine stalls
//   become one.
//
//   AND THEY ARE KEPT. The fifty pictures are the same fifty pictures every
//   time the editor opens, so they go into localStorage and the second session
//   pays nothing at all. THUMB_VERSION is the manual bump: change a prop, or
//   the camera, or the size, and raise it, or the tool will keep showing the
//   old picture for ever.
//
// ============================================================================
// AND THE PICTURE ITSELF
// ============================================================================
//
// THE GAME'S OWN CAMERA, not a front elevation. The whole prop set was authored
// for an orthographic view along (1, 0.78, 1) and several pieces read wrong
// from anywhere else; the editor's own scene makes the same argument in its
// header. A thumbnail at any other angle is a picture of something the author
// will never see.
//
// THE EDITOR'S RENDERER, through a render target, rather than a second WebGL
// context. A context is a scarce thing in a browser and a second one would
// compile every material in the project twice.
//
// THE PROPS ARE DISPOSED AFTERWARDS AND THAT IS SAFE. tombstones.js pools its
// texture bakes by variant and refcounts them, so dispose() releases the
// thumbnail's claim and leaves the maps in the pool.
//
// The one thing this cannot show is scale: a grass tuft and a shed each fill
// their own tile, because a shed drawn to scale beside a tuft is one visible
// shed and forty-nine grey squares. The footprint is in the tooltip.

import * as THREE from 'three';
import { buildLevelProp } from '../game/level/build.js';

// Props were authored to face the camera and the camera looks along
// (1, 0.78, 1), so a face on local +Z reads square to the viewer at PI/4.
const FACE_YAW = Math.PI / 4;
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();

// Rendered at twice the size it is shown at and scaled down by the 2D context,
// because a render target has no multisampling and a headstone is mostly
// silhouette.
const SUPER = 2;
// How many tiles across the atlas is. Eight at 152 px is 1216 wide, which is
// inside every WebGL implementation's minimum texture size with room to spare.
const COLS = 8;

// BUMP THIS WHEN A PICTURE WOULD COME OUT DIFFERENT. It is the whole of the
// cache's invalidation: a stored thumbnail is trusted until this number moves.
const THUMB_VERSION = 1;
const STORE = `graveyard-editor/thumbs/v${THUMB_VERSION}`;

export function createThumbnails({ renderer, size = 76 }) {
  const CELL = size * SUPER;

  const scene = new THREE.Scene();
  // The editor's own rig, so a prop is lit here the way it is lit out there.
  // No shadows: there is no floor in this scene to receive one, and a shadow
  // map per tile would cost more than the tile.
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x6f7480, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.position.set(3.7, 6.0, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4d4ff, 0.55);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  let atlas = null;
  let pixels = null;
  let atlasRows = 0;

  const sheet = document.createElement('canvas');
  const sheetCtx = sheet.getContext('2d', { willReadFrequently: true });
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext('2d');
  tileCtx.imageSmoothingEnabled = true;
  tileCtx.imageSmoothingQuality = 'high';

  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();

  const keyOf = (kind, variant) => `${kind}/${variant ?? ''}`;

  // What survived from the last time the editor was open.
  const cache = new Map();
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { stored = {}; }
  for (const [k, v] of Object.entries(stored)) if (typeof v === 'string') cache.set(k, v);

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(cache)));
      } catch {
        // A full quota is not a reason to break the tool. The pictures are
        // simply rendered again next session, which is what happened before
        // they were ever stored.
      }
    }, 400);
  }

  function fitAtlas(rows) {
    if (atlas && rows <= atlasRows) return;
    atlas?.dispose();
    atlasRows = rows;
    atlas = new THREE.WebGLRenderTarget(COLS * CELL, rows * CELL, { depthBuffer: true });
    atlas.texture.colorSpace = THREE.SRGBColorSpace;
    atlas.texture.generateMipmaps = false;
    pixels = new Uint8Array(COLS * CELL * rows * CELL * 4);
    sheet.width = COLS * CELL;
    sheet.height = rows * CELL;
  }

  // The tightest square frame that holds the prop from this angle. The eight
  // corners of its bounding box are put into the camera's own space and the
  // largest decides the half extent, which is exact for a box and several
  // tiles' worth tighter than a bounding sphere. A tall thin obelisk and a wide
  // flat ledger both fill their tile.
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

  // ONE CHUNK. Everything missing from `entries`, up to a rowful, is built,
  // drawn into the atlas, read back once and sliced.
  //
  // BACK TO BACK WITHIN A CHUNK, AND A BREATH BETWEEN CHUNKS. Back to back is
  // the cheap regime and the reason this is not one bake per frame. But the
  // twenty nine headstones together are six seconds of solid main thread, which
  // is six seconds of a tool that does not answer the pointer, so the caller
  // runs this repeatedly until `done` and yields in between. Yielding is free
  // as long as NOTHING RENDERS in the gap: the editor draws on demand now, so
  // an idle gap costs no draw and the next chunk's bakes are still cold. A
  // pointer move in the gap will render and put the next chunk in the expensive
  // regime, which is a fair trade for a tool that moves when you move it.
  function renderBatch(entries) {
    const todo = [];
    for (const e of entries) {
      const k = keyOf(e.kind, e.variant);
      if (cache.has(k)) continue;
      todo.push({ k, kind: e.kind, variant: e.variant });
      if (todo.length >= COLS) break;
    }
    if (!todo.length) return { made: [], done: true };

    fitAtlas(1);

    const pr = renderer.getPixelRatio();
    const wasTarget = renderer.getRenderTarget();
    const wasClear = renderer.getClearColor(new THREE.Color());
    const wasAlpha = renderer.getClearAlpha();
    const wasShadow = renderer.shadowMap.enabled;
    const wasScissor = renderer.getScissorTest();
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(atlas);
    // Transparent, so a tile is a cut-out rather than a stamp of a grey square.
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);

    const placed = [];
    for (let i = 0; i < todo.length; i++) {
      const job = todo[i];
      let made = null;
      try {
        made = buildLevelProp({ kind: job.kind, variant: job.variant, x: 0, z: 0, yaw: FACE_YAW }, { allowCut: false });
      } catch {
        made = null;
      }
      if (!made) { cache.set(job.k, null); continue; }
      made.group.position.set(0, 0, 0);
      made.group.rotation.y = FACE_YAW;
      scene.add(made.group);
      made.group.updateMatrixWorld(true);
      if (frame(made.group)) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = col * CELL;
        // GL counts rows from the bottom; the slicing below counts from the
        // top, so the atlas is filled bottom up and read straight through.
        const y = (atlasRows - 1 - row) * CELL;
        // DIVIDED BY THE PIXEL RATIO, because setViewport and setScissor
        // multiply by it on the way in. The atlas is sized in real pixels, so
        // on a display at ratio 2 every cell would otherwise be laid out twice
        // as large as its slice and each tile would show a quarter of the prop
        // and a corner of its neighbour. Invisible on a ratio of 1, which is
        // every capture the harness takes.
        renderer.setViewport(x / pr, y / pr, CELL / pr, CELL / pr);
        renderer.setScissor(x / pr, y / pr, CELL / pr, CELL / pr);
        renderer.render(scene, camera);
        placed.push({ k: job.k, col, row });
      } else {
        cache.set(job.k, null);
      }
      scene.remove(made.group);
      // Releases this prop's claim on the pooled bake rather than freeing it.
      made.dispose?.();
    }

    // ONE STALL for the whole group.
    renderer.readRenderTargetPixels(atlas, 0, 0, atlas.width, atlas.height, pixels);
    renderer.setScissorTest(wasScissor);
    renderer.setViewport(0, 0, renderer.domElement.width / pr, renderer.domElement.height / pr);
    renderer.setRenderTarget(wasTarget);
    renderer.setClearColor(wasClear, wasAlpha);
    renderer.shadowMap.enabled = wasShadow;

    // GL reads bottom up and a canvas draws top down.
    const W = atlas.width;
    const H = atlas.height;
    const img = sheetCtx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }
    sheetCtx.putImageData(img, 0, 0);

    const made = [];
    for (const p of placed) {
      tileCtx.clearRect(0, 0, size, size);
      tileCtx.drawImage(sheet, p.col * CELL, p.row * CELL, CELL, CELL, 0, 0, size, size);
      const url = tile.toDataURL('image/png');
      cache.set(p.k, url);
      made.push({ key: p.k, url });
    }
    save();
    return { made, done: !entries.some((e) => !cache.has(keyOf(e.kind, e.variant))) };
  }

  return {
    // The picture, or null when there is not one. A caller that gets null
    // should be asking for the group to be rendered.
    get(kind, variant) {
      const k = keyOf(kind, variant);
      return cache.has(k) ? cache.get(k) : null;
    },
    // Is anything in this list still to be drawn?
    missing(entries) {
      return entries.some((e) => !cache.has(keyOf(e.kind, e.variant)));
    },
    renderBatch,
    keyOf,
    get size() { return cache.size; },
    dispose() {
      atlas?.dispose();
      cache.clear();
    },
  };
}

export default createThumbnails;
