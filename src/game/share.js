// THE SHARE PICTURE.
//
// An X intent URL cannot carry an image. There is no parameter for it and
// there never was, so a link to /intent/tweet is a link to a box of text. That
// leaves exactly three ways a picture ends up next to a shared post, and this
// file is two of them:
//
//   1. navigator.share with a FILE. Where the browser has it, the png is handed
//      to the X app as a real attachment and the player never sees a file at
//      all. This is the answer. It needs a secure context and a user gesture,
//      so the whole build happens the moment the end card appears and the click
//      handler only hands over a blob that is already sitting there.
//   2. Link unfurl metadata -- twitter:card and friends, in lab/index.html.
//      Not this file's business, and worth nothing until the site is hosted:
//      X has to be able to FETCH the page to read them. Tagged anyway, because
//      the tags cost nothing and start working the day there is a host.
//   3. Download the png and let the player attach it themselves. Clunky, always
//      works, and the only thing a desktop Firefox or a desktop Chrome can do.
//
// So: 1 with 3 underneath it, and the anchor's own href is the floor beneath
// both. Nothing here ever preventDefaults its way into a dead end -- if the
// image fails to build, the click does what it did before this file existed.
//
// --- WHAT THE PICTURE IS -----------------------------------------------------
//
// Not a screen grab. A screen grab of a finished run is a picture of a dead
// ghost under a dialog box, which is a picture of losing.
//
// The renderer is built with preserveDrawingBuffer, which means the canvas can
// be read at any time rather than only inside the frame that drew it. That is
// what makes a ring buffer possible: every quarter second the last drawn frame
// is copied, cropped and filed with the two facts that decide whether it is a
// good picture -- where the ghost was and how close the nearest skeleton was.
// When the run ends, the frame chosen is not the last one but one from about a
// second earlier, with a skeleton close enough to read as a chase and far
// enough that two figures are still two figures at thumbnail size.
//
// Then it is composited: the game's own card style, over the game's own frame.
import * as THREE from 'three';
import { shareText } from './run.js';

// 16:9. X shows an attached photo at up to 16:9 without cropping it, and a
// square grab of a square canvas would be letterboxed or cut to pieces. The
// LINK card is 1.91:1 and is a different picture entirely -- see the meta tags
// in lab/index.html, which cannot be per-run and cannot work until the site is
// hosted at all.
export const OUT_W = 1600;
export const OUT_H = 900;

// --- the ring ----------------------------------------------------------------

// A quarter second apart, six of them: a window of 1.25 s ending at the death.
// Six 16:9 frames is the whole memory cost of this feature and it is the number
// to cut first if it ever matters.
const SAMPLE_HZ = 4;
const SLOTS = 6;

// How old the chosen frame has to be. Below about half a second the skeleton is
// already on top of the ghost and the two silhouettes have merged.
const MIN_AGE = 0.55;

// The gap, in world units, that photographs best. Two units is close enough to
// read as "about to be caught" and wide enough that the ghost and the skeleton
// are separate shapes in a 500 px timeline thumbnail.
const IDEAL_GAP = 2.2;

// How much of the camera's vertical world extent the crop keeps. The game's
// camera is deliberately loose -- you have to see the junctions to plan -- and
// a picture wants the opposite. Just over half the height doubles everything on
// screen: a 1.6 unit ghost goes from 8% of the frame to 17%, which is the
// difference between a smudge and a ghost once X has scaled it down.
const CROP_SPAN = 9.5;
// The camera is orthographic with top=VIEW and bottom=-VIEW, so this is the
// full height it sees. Read off the camera rather than assumed, because ?view=
// can change it.
const camSpan = (camera) => Math.abs(camera.top - camera.bottom) || 18;

// Where the action should sit in the finished picture: right of centre and high,
// because the caption panel lives bottom left.
const SUBJECT_X = 0.60;
const SUBJECT_Y = 0.38;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function make2D(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// A skeleton that is underground is not in the picture, whatever the rules say
// its coordinates are.
const ABOVE_GROUND = new Set(['leaving', 'hunting', 'emerging']);

export function createShareRecorder({ canvas, camera, state }) {
  // Sized on first sample, from whatever the canvas's backing store turns out
  // to be. A phone at three times pixel ratio and a laptop at one do not want
  // the same buffer, and neither wants a buffer bigger than the pixels it has.
  let storeW = 0;
  let storeH = 0;
  const ring = [];
  let head = -1;
  let clock = 0;
  let next = 0;
  const v = new THREE.Vector3();

  function project(x, y, z, w, h) {
    v.set(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h };
  }

  // One sample: pick the crop, copy it, and file what was in it.
  function shoot(st) {
    const sw = canvas.width;
    const sh = canvas.height;
    if (!sw || !sh) return;

    // The ghost, and the nearest skeleton that is actually standing on the
    // ground where a camera could see it.
    const g = st.ghost;
    let foe = null;
    let gap = Infinity;
    for (const s of st.skeletons) {
      if (!ABOVE_GROUND.has(s.state)) continue;
      const d = Math.hypot(s.x - g.x, s.z - g.z);
      if (d < gap) { gap = d; foe = s; }
    }

    // The crop, in source pixels: 16:9, holding CROP_SPAN of the camera's
    // world height, never larger than the pixels that exist.
    let ch = sh * (CROP_SPAN / camSpan(camera));
    let cw = ch * (16 / 9);
    if (cw > sw) { cw = sw; ch = cw * (9 / 16); }
    if (ch > sh) { ch = sh; cw = ch * (16 / 9); }

    // Centred between the two figures rather than on either, so both are in
    // frame even when the chase is running across the picture. With no
    // skeleton up, the ghost alone.
    const pg = project(g.x, 0.95, g.z, sw, sh);
    const pf = foe ? project(foe.x, 1.05, foe.z, sw, sh) : pg;
    const mid = { x: (pg.x + pf.x) / 2, y: (pg.y + pf.y) / 2 };
    // Offset so the subject lands where the composition wants it, then clamped
    // back inside the source. The clamp is what stops a chase at the edge of
    // the arena producing a crop half full of nothing.
    const cx = clamp(mid.x - (SUBJECT_X - 0.5) * cw, cw / 2, sw - cw / 2);
    const cy = clamp(mid.y - (SUBJECT_Y - 0.5) * ch, ch / 2, sh - ch / 2);

    if (!storeW) {
      storeW = clamp(Math.round(cw), 640, OUT_W);
      storeH = Math.round(storeW * 9 / 16);
    }
    head = (head + 1) % SLOTS;
    let slot = ring[head];
    if (!slot) slot = ring[head] = { canvas: make2D(storeW, storeH), ctx: null };
    if (!slot.ctx) {
      slot.ctx = slot.canvas.getContext('2d');
      slot.ctx.imageSmoothingQuality = 'high';
    }
    slot.ctx.drawImage(canvas, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, storeW, storeH);
    slot.t = clock;
    slot.gap = gap;
    slot.hasFoe = !!foe;
  }

  // Called from the game's own advance(), with the game's own dt, so the ring
  // is filled at the same rate whether the loop is a browser at 120 Hz or a
  // capture script stepping it by hand.
  function tick(dt) {
    clock += dt;
    if (clock < next) return;
    next = clock + 1 / SAMPLE_HZ;
    let st = null;
    try { st = state(); } catch { st = null; }
    if (st && st.ghost && st.skeletons) shoot(st);
  }

  // The pick. Old enough to still be a chase, and of those, the one whose gap
  // is closest to the gap that photographs. A run that ended with nothing above
  // ground -- a ghost that walked into a skeleton the instant it surfaced --
  // falls through to the oldest frame there is, which is still better than the
  // last one.
  function pick() {
    const filled = ring.filter((s) => s && s.t !== undefined);
    if (!filled.length) return null;
    const now = filled.reduce((m, s) => Math.max(m, s.t), 0);
    const old = filled.filter((s) => now - s.t >= MIN_AGE);
    const pool = old.length ? old : filled;
    const chase = pool.filter((s) => s.hasFoe);
    const from = chase.length ? chase : pool;
    return from.reduce((best, s) => (
      Math.abs(s.gap - IDEAL_GAP) < Math.abs(best.gap - IDEAL_GAP) ? s : best
    ));
  }

  const kit = { tick, pick, attach: (anchor, opts) => attach({ pick, anchor, ...opts }) };
  // The harness hook, the same shape as window.__game and window.__perf on the
  // page beside it. capture/share-shot.mjs drives a run to its end and then
  // reads the picture off this rather than clicking a link it cannot see.
  if (typeof window !== 'undefined') {
    window.__share = { compose: composeShareImage, pick, dataUrl: null, files: false };
  }
  return kit;
}

// --- the composite -----------------------------------------------------------
//
// The end card's own values, lifted out of lab/index.html so the picture and
// the card in front of the player are the same object in two places. If those
// change, these change.
const INK = '#2f3542';
const MUTED = '#7b8494';
const PANEL = 'rgba(249, 250, 252, 0.94)';
const DARK = '#16181c';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The card sets its labels in monospace at 0.22em. Canvas has letterSpacing in
// newer Chrome and nowhere else, so the tracking is done by hand: monospace has
// no kerning to lose, which is exactly why the card uses it for these.
function trackedWidth(ctx, text, track) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w - (text.length ? track : 0);
}

function drawTracked(ctx, text, x, y, track) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  return cx;
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

/**
 * The picture. `frame` is a 16:9 canvas out of the ring; everything else is the
 * run. Returns a fresh 1600x900 canvas.
 */
export function composeShareImage({ frame, run = null, best = false, caption = null }) {
  const out = make2D(OUT_W, OUT_H);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // The graveyard.
  if (frame) ctx.drawImage(frame, 0, 0, OUT_W, OUT_H);
  else { ctx.fillStyle = '#b9bec7'; ctx.fillRect(0, 0, OUT_W, OUT_H); }

  // A vignette, gently. The scene's clear colour is a flat light grey and the
  // frame edge dissolves into the timeline without it.
  const vig = ctx.createRadialGradient(
    OUT_W * 0.55, OUT_H * 0.42, OUT_H * 0.22,
    OUT_W * 0.55, OUT_H * 0.42, OUT_H * 0.95,
  );
  vig.addColorStop(0, 'rgba(26, 30, 38, 0)');
  vig.addColorStop(1, 'rgba(26, 30, 38, 0.34)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  // What the panel says. Derived from the run, and overridable, because the
  // STATIC card at public/share-card.png is this same composition with the
  // run's own facts taken out of it: one graveyard, no score.
  const lines = run ? shareText(run).split('\n') : [];
  const spec = {
    badge: best ? 'BEST RUN' : 'CAUGHT',
    headline: lines[0] || 'A run in the graveyard.',
    // Line 1 of the share text is the points and the fireflies, which the stat
    // row says better. Line 2, when there is one, is the near miss, and that is
    // the line worth keeping.
    subline: lines[2] || '',
    stats: run ? [
      ['SCORE', run.score.toLocaleString('en-US')],
      ['FIREFLIES', String(run.fireflies)],
      // No maze number: there is one arena and it is played until you are
      // caught, so how long you lasted is the third fact worth showing.
      ['LASTED', `${Math.max(0, Math.round((run.duration || 0) / 6) / 10)}m`],
    ] : null,
    ...(caption || {}),
  };

  // --- the badge, top left ---------------------------------------------------
  // The end card's h1, and the one strong dark shape in the picture. At
  // thumbnail size it is the only thing that is certainly readable, so it says
  // the outcome and nothing else.
  const badge = spec.badge;
  ctx.font = `700 17px ${MONO}`;
  const badgeTrack = 17 * 0.22;
  const badgeW = trackedWidth(ctx, badge, badgeTrack);
  const bw = badgeW + 52;
  const bh = 50;
  ctx.save();
  ctx.shadowColor = 'rgba(20, 24, 32, 0.35)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = DARK;
  roundRect(ctx, 56, 56, bw, bh, bh / 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  drawTracked(ctx, badge, 56 + 26, 56 + bh / 2 + 1, badgeTrack);

  // --- the caption panel, bottom left ---------------------------------------
  const headline = spec.headline;
  const subline = spec.subline;

  const PAD = 34;
  const PANEL_W = 700;
  const px = 56;
  const inner = PANEL_W - PAD * 2;

  ctx.font = `600 38px ${SANS}`;
  const head = wrap(ctx, headline, inner, 2);

  let hgt = PAD + 17 + 22 + head.length * 46;
  if (subline) hgt += 30;
  if (spec.stats) hgt += 26 + 14 + 1 + 22 + 34 + PAD;
  else hgt += PAD - 12;

  const py = OUT_H - 56 - hgt;

  ctx.save();
  ctx.shadowColor = 'rgba(30, 35, 48, 0.30)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = PANEL;
  roundRect(ctx, px, py, PANEL_W, hgt, 16);
  ctx.fill();
  ctx.restore();

  let y = py + PAD;

  // Eyebrow: the game's name, and what it is, because the picture may well be
  // seen by somebody who has never heard of either.
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = `700 16px ${MONO}`;
  const nameEnd = drawTracked(ctx, 'GRAVEYARD', px + PAD, y, 16 * 0.22);
  ctx.font = `400 12px ${MONO}`;
  drawTracked(ctx, 'A PAC-MAN IN A CEMETERY', nameEnd + 18, y + 4, 12 * 0.16);
  y += 17 + 22;

  // The story. The single most characterful fact about the run, which is which
  // of the four skeletons ended it.
  ctx.fillStyle = INK;
  ctx.font = `600 38px ${SANS}`;
  for (const l of head) { ctx.fillText(l, px + PAD, y); y += 46; }

  if (subline) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 21px ${SANS}`;
    ctx.fillText(subline, px + PAD, y + 2);
    y += 30;
  }

  if (!spec.stats) return out;

  y += 26;
  ctx.fillStyle = 'rgba(47, 53, 66, 0.12)';
  ctx.fillRect(px + PAD, Math.round(y), inner, 1);
  y += 1 + 22;

  // The numbers, tabular, in the same monospace the board uses.
  const col = inner / 3;
  spec.stats.forEach(([label, value], i) => {
    const x = px + PAD + col * i;
    ctx.fillStyle = MUTED;
    ctx.font = `400 12px ${MONO}`;
    drawTracked(ctx, label, x, y, 12 * 0.16);
    ctx.fillStyle = INK;
    ctx.font = `700 30px ${MONO}`;
    ctx.fillText(value, x, y + 18);
  });

  return out;
}

// --- getting it to X ---------------------------------------------------------

function toBlob(canvas) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
  });
}

function canShareFiles(files) {
  try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
}

function saveFile(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the download to have been handed to the browser. Revoking
  // in the same tick cancels it in Firefox.
  setTimeout(() => URL.revokeObjectURL(href), 20000);
}

/**
 * Turn the end card's "Post it on X" anchor into one that carries a picture.
 *
 * The anchor keeps its href, its target and its meaning. Everything below is
 * additive: if the image never arrives, or the browser has no file sharing, or
 * anything at all throws, the click is the plain intent link it always was.
 */
export function attach({ pick, anchor, run, best = false }) {
  if (!anchor || !run) return;
  const card = anchor.parentNode;
  if (!card) return;

  // The player should see the picture they are about to post. Inserted now,
  // empty, at the right aspect, so the card does not jump when it fills in.
  const preview = document.createElement('img');
  preview.alt = '';
  preview.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;object-fit:cover;'
    + 'border-radius:10px;margin:0 0 14px;background:#dfe3ea;'
    + 'box-shadow:0 6px 18px rgba(30,35,48,0.18);opacity:0;transition:opacity 180ms ease;';
  card.insertBefore(preview, anchor);

  const note = document.createElement('p');
  note.style.cssText = 'margin:12px 0 0;font:400 11.5px/1.5 inherit;color:#7b8494;';
  card.appendChild(note);

  const name = `graveyard-${run.score}.png`;
  let file = null;
  let blob = null;
  let files = false;

  // The whole build runs HERE, when the card appears, not in the click handler.
  // navigator.share has to be called from inside a user gesture and an await on
  // canvas.toBlob spends that gesture, so by the time anything is clicked the
  // File has to be sitting in a variable already.
  (async () => {
    try {
      const frame = pick();
      const image = composeShareImage({ frame: frame && frame.canvas, run, best });
      preview.src = image.toDataURL('image/png');
      preview.style.opacity = '1';
      blob = await toBlob(image);
      if (!blob) return;
      file = new File([blob], name, { type: 'image/png' });
      files = canShareFiles([file]);
      note.textContent = files
        ? 'Posting hands the picture to X with it. '
        : 'This browser cannot attach a file to a post, so the picture downloads '
          + 'instead and you add it in X. ';
      const save = document.createElement('a');
      save.href = '#';
      save.textContent = 'Save the picture';
      save.style.cssText = 'color:#6b7383;text-decoration:underline;';
      save.addEventListener('click', (e) => { e.preventDefault(); saveFile(blob, name); });
      note.appendChild(save);
      // A hook for the capture script, the same shape as __game and __perf. It
      // is the only way to see the picture without a person clicking.
      if (window.__share) Object.assign(window.__share, { dataUrl: preview.src, files, name });
    } catch (err) {
      // A share that cannot build its image is a share link, which is what the
      // game shipped with. Nothing here is worth breaking the end card for.
      note.remove();
      preview.remove();
      console.warn('share image failed', err);
    }
  })();

  anchor.addEventListener('click', (e) => {
    if (!blob) return;                 // href does what it always did
    if (files) {
      // The good path. The image goes to X as an attachment and the intent URL
      // is never opened at all.
      e.preventDefault();
      const url = new URL(anchor.href);
      navigator.share({
        files: [file],
        text: url.searchParams.get('text') || shareText(run),
        ...(url.searchParams.get('url') ? { url: url.searchParams.get('url') } : {}),
      }).catch((err) => {
        // AbortError is the player closing the sheet, which is not a failure
        // and must not then open a tab they did not ask for.
        if (err && err.name === 'AbortError') return;
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
      });
      return;
    }
    // The fallback. The click is NOT cancelled: the anchor opens the intent in
    // its own tab exactly as before, which is a real navigation from a real
    // gesture and so is never caught by a popup blocker. The download rides
    // alongside it, so the file is waiting when the composer opens.
    saveFile(blob, name);
  });
}
