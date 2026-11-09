/**
 * The Resourced mark as a loading screen.
 *
 * This is the marketing site's hero cloud — the same mark, the same instanced
 * pills, the same motion — reworked into something an application can put over
 * itself while it fetches. Every mote is one of the product's own colourway
 * pills: a rounded capsule with a colour and a name set in it, positioned
 * entirely in the vertex shader, drifting. Nothing is simulated on the CPU,
 * which is what pays for tens of thousands of them.
 *
 * Three things make it affordable, and they are the site's:
 *
 *   - Every pill is rasterised **once** into a texture atlas. A mote is then a
 *     textured quad, so its colour, its rounded ends and its label all cost one
 *     texture fetch and nothing else.
 *   - The quads are **instanced**: one draw call for the whole cloud, four
 *     vertices, and per-instance attributes for where a mote sits, which pill
 *     it wears and how big it is.
 *   - Position is computed **entirely in the vertex shader** from a fixed seed
 *     and the clock.
 *
 * What a loader needs that a hero does not, and what therefore changed:
 *
 *   - **An exit.** The hero never leaves; a loader must, and the app has to be
 *     able to wait for it rather than cutting to content mid-drift. `finish()`
 *     scatters the cloud and resolves when it is gone. It resolves on a timer
 *     as well as on the animation, so an app is never left awaiting a promise
 *     that a backgrounded tab has stopped advancing.
 *   - **An appear**, which is the same displacement run backwards: the motes
 *     arrive from everywhere and settle into the mark.
 *   - **Any size.** The hero sizes itself against the viewport, the fold and
 *     the site's ruled column. This sizes itself against its own box, so the
 *     same call is right for a full-screen splash and for a 200px panel, and
 *     the pill population is scaled to the area rather than to the window.
 *   - **A lens that is never dead.** The site's lens only exists under a
 *     cursor, and a loading screen may never see one. Here the two drives are
 *     always both present: the lens follows the cursor when there is one and
 *     otherwise wanders the mark on the path the site uses on phones — two
 *     incommensurable periods, so it never retraces itself — and it crossfades
 *     between them rather than switching, so a hand arriving on the mouse takes
 *     the lens over from wherever it had got to.
 *   - **No copy thinning.** The hero thins the cloud out behind its headline,
 *     which is four uniforms, a per-frame layout read and a good deal of shader
 *     it does not need here. A loader has nothing behind it to protect.
 *   - **A way out.** `destroy()` releases the WebGL context. A loader that
 *     leaks a context on every route change is worse than no loader: browsers
 *     cap live contexts somewhere around sixteen and drop the oldest, so the
 *     failure lands on whatever else the page is drawing.
 *
 * It degrades rather than failing: no WebGL2, a context that will not compile,
 * a context lost mid-flight, or `prefers-reduced-motion` all leave something
 * on screen — a still, assembled frame in the last case, and the plain mark in
 * the others.
 */
import { band, WHEEL, TOTAL } from './vocabulary.js';
import { MARK_SVG } from './mark.js';

/* ── The atlas ─────────────────────────────────────────────────────────── */

/* Drawn a few times larger than a pill is ever displayed — enough that the
   nearest motes have texture to sample, and no more than that: the further the
   atlas is above the display size, the further down the mip chain the sampler
   goes and the blurrier a small pill gets. Everything below is atlas pixels. */
const PILL_H = 18;
const PAD_X = 6;
const FONT = 9;
const GAP = 2;
const MAX_W = 300;              // a runaway colourway name is cut, not carried

/* No web font. The site sets its pills in Inter because the site loads Inter;
   a loader that waited on a font before it could draw would be waiting for the
   network in order to say that it is waiting for the network. Inter is still
   named first, so an app that already has it gets it. */
const FACE = `600 ${FONT}px 'Inter Variable', Inter, system-ui, -apple-system, sans-serif`;

/**
 * Rasterises pills into one texture and records where each one landed.
 *
 * Every cell is a real pill — a name, and the proportions the name gives it.
 * An earlier version of the site's cloud drew the small ones from a few blank
 * capsules tinted per mote, on the theory that nobody can read a label two
 * pixels tall. True, but they can see that there is nothing there: a field of
 * unlabelled capsules reads as a field of *empty* pills, which is precisely
 * what the product's own board is not.
 *
 * Only the lettering is drawn. The capsule itself is a distance field in the
 * fragment shader, so its edge is exact at any size — a texture stretched by
 * the lens went soft, and minifying one bled the transparent surround into the
 * colour and left a dark rim that read as an outline the app does not draw.
 *
 * A shelf packer is enough: pills are all the same height, so rows pack tight
 * with no wasted band, and the only decision is when to wrap.
 */
function buildAtlas(names, maxSize) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FACE;

  const widths = names.map((t) => {
    const w = Math.ceil(probe.measureText(t).width) + PAD_X * 2;
    return Math.max(PILL_H, Math.min(MAX_W, w));
  });

  // Lay out first, then size the canvas to what the layout actually needs.
  const W = Math.min(2048, maxSize);
  let x = 0;
  let row = 0;
  const place = [];
  for (let i = 0; i < names.length; i++) {
    if (x + widths[i] + GAP > W) {
      row++;
      x = 0;
    }
    place.push([x, row * (PILL_H + GAP)]);
    x += widths[i] + GAP;
  }
  const H = (row + 1) * (PILL_H + GAP);
  if (H > maxSize) return null;

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.font = FACE;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  const rect = new Float32Array(names.length * 4);
  const aspect = new Float32Array(names.length);

  names.forEach((t, i) => {
    const [px, py] = place[i];
    const w = widths[i];

    // Clipped to the capsule the shader will draw, so a label that overruns is
    // cut at the pill's own edge rather than smeared into its neighbour's cell.
    const r = PILL_H / 2;                     // every pill in the app is circle-sided
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + PILL_H, r);
    ctx.arcTo(px + w, py + PILL_H, px, py + PILL_H, r);
    ctx.arcTo(px, py + PILL_H, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.clip();
    ctx.fillText(t, px + PAD_X, py + PILL_H / 2 + 0.5, w - PAD_X * 2);
    ctx.restore();

    rect[i * 4] = px / W;
    rect[i * 4 + 1] = py / H;
    rect[i * 4 + 2] = (px + w) / W;
    rect[i * 4 + 3] = (py + PILL_H) / H;
    aspect[i] = w / PILL_H;
  });

  return { canvas: cv, rect, aspect };
}

/* ── The mark ──────────────────────────────────────────────────────────── */

/**
 * Rasterises the mark and returns its coverage bitmap.
 *
 * The destination rectangle is worked out here rather than left to
 * `preserveAspectRatio`: an SVG carrying only a viewBox has an intrinsic size of
 * 300×150, which `drawImage` then stretches to whatever box it is given — so the
 * mark came out square and the cloud with it. Giving the root explicit
 * dimensions and fitting the rect by hand makes the shape exact.
 */
function rasterise(svgText, size) {
  return new Promise((resolve, reject) => {
    const vb = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
    const nums = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : null;
    const vw = nums && nums.length === 4 && nums[2] > 0 ? nums[2] : 1;
    const vh = nums && nums.length === 4 && nums[3] > 0 ? nums[3] : 1;
    const ratio = vw / vh;

    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    const painted = svgText.replace(
      /<svg /i,
      `<svg width="${vw}" height="${vh}" preserveAspectRatio="xMidYMid meet" fill="#ffffff" `
    );

    const img = new Image();
    img.onload = () => {
      // Fit the mark's own ratio inside the square, with a little air.
      const inner = size * 0.9;
      let dw = inner;
      let dh = inner / ratio;
      if (dh > inner) {
        dh = inner;
        dw = inner * ratio;
      }
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = () => reject(new Error('the mark would not rasterise'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(painted);
  });
}

/**
 * Which pixels the mark covers, and how far it reaches.
 *
 * Split from the seeding below, which the site does in one pass, because the
 * loader has to know the mark's proportion *before* it can decide how many
 * motes its box is worth — and this pass is a walk over a quarter of a million
 * pixels, which is not something to do twice for an answer it already has.
 */
function coverage(image, size) {
  const px = image.data;
  const inside = [];
  for (let i = 0, n = size * size; i < n; i++) {
    if (px[i * 4 + 3] > 110) inside.push(i);
  }
  if (!inside.length) return null;

  // Measure the mark's actual extent in the raster rather than trusting how the
  // browser fitted the SVG into a square — that assumption is what left the
  // cloud the wrong shape.
  let minX = size, maxX = 0, minY = size, maxY = 0;
  for (const cell of inside) {
    const x = cell % size;
    const y = (cell / size) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  return { inside, size, minX, minY, bw, bh, aspect: bw / bh };
}

/**
 * Distributes `count` points over the coverage. Drawing from the list of
 * covered pixels is O(count); rejection sampling against the bitmap would throw
 * away three tries in four.
 */
function seedPoints(cov, count) {
  const { inside, size, minX, minY, bw, bh } = cov;
  const home = new Float32Array(count * 2);
  const seed = new Float32Array(count * 3);
  const span = Math.max(bw, bh);

  for (let i = 0; i < count; i++) {
    const cell = inside[(Math.random() * inside.length) | 0];
    // Jitter inside the pixel so the cloud has no grid in it.
    const x = (cell % size) + Math.random();
    const y = ((cell / size) | 0) + Math.random();

    // Normalise on the longer edge so the mark keeps its own proportions, and
    // centre it on the origin.
    home[i * 2] = ((x - minX) - bw / 2) / (span / 2);
    home[i * 2 + 1] = -(((y - minY) - bh / 2) / (span / 2));

    seed[i * 3] = Math.random();                    // drift phase
    seed[i * 3 + 1] = Math.random() ** 1.4;         // depth, weighted to the back
    seed[i * 3 + 2] = Math.random();                // size
  }
  return { home, seed };
}

/* ── Shade ─────────────────────────────────────────────────────────────── */

/** HSL to 0..1 RGB, written straight into `out` at `at`. */
function toRgb(h, sat, l, out, at) {
  h = ((h % 360) + 360) % 360;
  const a = sat * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  out[at] = f(0);
  out[at + 1] = f(8);
  out[at + 2] = f(4);
}

/**
 * Deals out identities.
 *
 * Two kinds of mote. A few in every thousand are drawn large enough to read,
 * and each of those takes a label **no other mote on screen has**. The rest are
 * smears: a capsule and a colour, whose label is a texture rather than a word.
 *
 * Colour comes from where a mote sits, so the spectrum sweeps across the mark
 * and neighbours stay related rather than the whole thing turning to noise.
 * Since the fill travels with the instance rather than with the sprite, a
 * mote's colour need not be one of the card's — it can be its own. Each is
 * nudged in hue, saturation and lightness by an amount unique to it, so the
 * field holds as many shades as it holds pills. The nudge is small on purpose:
 * the mark still has to read as bands of one colour graduating into the next,
 * and a wide jitter would put it straight back to confetti.
 */
function assign(home, count, atlas, ranges, bigShare, shade) {
  const rect = new Float32Array(count * 4);
  const aspect = new Float32Array(count);
  const big = new Float32Array(count);
  const fill = new Float32Array(count * 3);

  const total = ranges[ranges.length - 1][1];

  /* How many motes are drawn large enough to read. Each takes a label no other
     mote on screen has — but WHICH label is decided when the mote is dealt,
     from its own lightness, rather than being set aside in advance.

     It used to be a fixed slice taken off the front of every band in turn,
     which was fine while a band was in no particular order. The bands are
     sorted dark to light now, so the front of a band is its darkest end: that
     same slice would hand every legible pill on the page the deepest name in
     its family, whatever colour the pill actually came out. The readable ones
     are the only pills anybody can read, so they are the last place to get
     this wrong.

     `taken` enforces uniqueness instead. A big mote computes the slot its
     shade asks for and walks outward to the nearest one still free, so it gets
     the closest available name rather than a pre-assigned one. */
  const wanted = Math.min(Math.round(count * bigShare), total);
  const taken = new Set();
  const bigEvery = wanted ? count / wanted : Infinity;

  /* The nearest free slot to `want`, searched outwards and kept inside the
     band. Returns -1 only if the whole band is spoken for, which needs a band
     smaller than the number of readable pills that landed in it. */
  const freeNear = (want, from, to) => {
    for (let d = 0; d < to - from; d++) {
      const a = want - d;
      if (a >= from && !taken.has(a)) return a;
      const b = want + d;
      if (b < to && !taken.has(b)) return b;
    }
    return -1;
  };

  const put = (i, slot, hue, sat, lit) => {
    rect[i * 4] = atlas.rect[slot * 4];
    rect[i * 4 + 1] = atlas.rect[slot * 4 + 1];
    rect[i * 4 + 2] = atlas.rect[slot * 4 + 2];
    rect[i * 4 + 3] = atlas.rect[slot * 4 + 3];
    aspect[i] = atlas.aspect[slot];
    // Its own shade: the hue its position asks for, nudged a couple of degrees
    // so that no two motes anywhere are quite the same colour.
    toRgb(hue + (Math.random() - 0.5) * 5, sat, lit, fill, i * 3);
  };

  /* The centre of each band on the wheel, in `WHEEL`'s order, so a hue can be
     matched to the family whose names suit it. The cloud's colour is a
     continuous function of position rather than a choice between eight bins —
     but a pill that reads "Deep Indigo" should still be indigo, so the label is
     chosen to agree with the fill rather than the other way round. */
  const CENTRES = [0, 32, 55, 115, 180, 222, 272, 320];
  const nearestBand = (hue) => {
    let best = 0;
    let bestD = 999;
    for (let b = 0; b < ranges.length && b < CENTRES.length; b++) {
      const d = Math.abs(((hue - CENTRES[b] + 540) % 360) - 180);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  };

  /* How far the mark actually reaches along the sweep's own axis, measured
     rather than assumed. `home` is normalised on the mark's longer edge, so its
     shorter axis never reaches ±1 and a hand-written range left the ends of the
     spectrum outside the shape — the mark came out as the middle two thirds of
     the wheel, yellow through violet, with no red, orange or pink anywhere on
     it. Measuring the projection puts the first and last hue exactly on the
     mark's own extremes. */
  const proj = (x, y) => x * 0.60 + y * 0.34;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = proj(home[i * 2], home[i * 2 + 1]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1e-4, hi - lo);

  /* The two ends of the lightness the sweep can produce — the clamps `lit` is
     built with below, named here because the label picker normalises against
     them. */
  const LIT_LO = 0.34;
  const LIT_HI = 0.84;

  let given = 0;
  for (let i = 0; i < count; i++) {
    const hx = home[i * 2];
    const hy = home[i * 2 + 1];

    /* The spectrum sweeps across the mark on a diagonal, continuously — red
       through amber, yellow, green, teal, blue and violet into pink — rather
       than being sorted into bins. Bins put a flat field of one colour over
       each arm of the mark: the top right came out uniformly yellow instead of
       travelling through orange into red on the way. A little under a full turn
       of the wheel, so the two ends of the sweep do not meet in the middle of
       the shape and hand it a seam. */
    const t = (proj(hx, hy) - lo) / span;
    const hue = (352 + t * 330) % 360;

    // Shade comes from how far out a mote sits: deep at the centre, lighter
    // toward the rim, across the middle of the range so the rim is not handed
    // the palest fifth of every colour.
    const r = Math.min(1, Math.hypot(hx, hy) / 1.05);
    /* `shade` trims the result afterwards rather than changing the ramp, so the
       deep-centre-to-pale-rim gradient keeps its shape and only its intensity
       moves. It exists because the mark reads hotter on a phone than on a
       desktop and none of the obvious causes turned out to be it: the colour
       here is computed from the mark's own bounding box, so a phone and a
       laptop derive byte-identical values. Whatever the difference is, it is
       downstream of this — so this is a trim, not a fix, and it is honest to
       say so at the one place someone will read it. */
    const sat = Math.max(0.20, Math.min(0.90, 0.72 - r * 0.16 + (Math.random() - 0.5) * 0.16)) * shade.sat;
    const lit = Math.min(0.96, Math.max(0.34, Math.min(0.84, 0.44 + r * 0.20 + (Math.random() - 0.5) * 0.14)) + shade.lift);

    const [from, to] = ranges[nearestBand(hue)];

    /* Where in the band this mote's shade points. Both kinds of mote use it:
       the readable ones take the nearest free name to it, the smears take it
       with a little jitter. */
    const k = (lit - LIT_LO) / (LIT_HI - LIT_LO);
    const reach = to - from;
    const want = from + Math.round(Math.min(1, Math.max(0, k)) * (reach - 1));

    // Spread the readable ones evenly rather than letting chance clump them: a
    // cluster of six legible pills reads as a caption.
    if (given < wanted && i >= given * bigEvery) {
      const pick = freeNear(want, from, to);
      if (pick >= 0) {
        taken.add(pick);
        given++;
        put(i, pick, hue, sat, lit);
        big[i] = 1;
        continue;
      }
    }

    /* A label from the family this hue belongs to — and from the right END of
       it, which is what makes a name mean the colour it is written on.

       Hue was never the problem: the band a mote reads from is chosen from its
       own hue, so a blue pill has always carried a blue name. Shade was. The
       band is 120 names covering a lightness range of 0.34 to 0.84, and the
       slot used to be drawn at random across all of it, so a name written for
       the deep end could land on a pill at the pale end and the pill would
       read as a lie about itself.

       The bands are stored dark to light for exactly this. Normalising the
       mote's own lightness across the range it is built from gives a position
       in the band directly. The jitter is a couple of names either side rather
       than the whole band — neighbours want different names, not different
       shades, and a wide draw puts the mismatch straight back. */
    let slot = want + Math.round((Math.random() - 0.5) * 4);
    if (slot < from) slot = from;
    if (slot >= to) slot = to - 1;
    if (taken.has(slot)) slot = slot + 1 < to ? slot + 1 : from;
    put(i, slot, hue, sat, lit);
  }
  return { rect, aspect, big, fill, labelled: given };
}

/* ── Shaders ───────────────────────────────────────────────────────────── */

/* The motion is the site's, unchanged — the turn, the two octaves of drift, the
   per-point orbit, and the lens's jittered radial push with a tangential swirl.
   What is added is `scatter`, which is the whole of the appear and the exit. */
const VERT = `#version 300 es
precision highp float;

in vec2 corner;    // 0..1 across the quad, the only per-vertex attribute
in vec2 home;      // rest position, already normalised to the mark's own aspect
in vec3 seed;      // per-instance randomness: drift phase, depth, size
in vec4 rect;      // the pill's place in the atlas, in uv
in float aspect;   // the pill's width over its height
in float big;      // 1 if this mote is drawn large enough to read
in vec3 fill;      // the pill's own colour

uniform vec2  res;
uniform float time;
uniform vec2  mouse;
uniform float hover;
uniform vec2  fit;
uniform vec2  span;      // smallest and largest pill height, in pill units
uniform float unit;      // device pixels one pill unit is worth, from the box
uniform float lens;      // how wide and strong the lens is
uniform float scatter;   // 0 assembled, 1 dispersed — drives both appear and exit

out vec2  vUv;
out float vDepth;
out float vPush;
out float vBig;
out vec2  vLocal;   // 0..1 across the quad, for the capsule's own geometry
out float vAspect;
out vec3  vFill;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  float z = seed.y;

  // The whole body turns, slowly and only through a few degrees — a full spin
  // would read as a logo animation rather than as a mass hanging in the air.
  float a = sin(time * 0.11) * 0.075;
  float ca = cos(a), sa = sin(a);
  vec2 turn = vec2(home.x * ca - home.y * sa, home.x * sa + home.y * ca);
  turn.x *= 1.0 + sin(time * 0.08) * 0.045;

  // Drift in two octaves: a slow swim, plus a finer flutter. Both have a floor
  // that does not depend on depth, so every mote is always moving — the far
  // ones simply move less than the near ones.
  float t = time * 0.19 + seed.x * 6.283;
  vec2 slow = vec2(sin(t), cos(t * 0.81 + seed.z * 4.0));
  float n1 = noise(turn * 3.0 + vec2(time * 0.12, seed.x * 10.0)) - 0.5;
  float n2 = noise(turn * 7.5 - vec2(time * 0.17, seed.z * 6.0)) - 0.5;
  vec2 flutter = vec2(n1, n2);

  float o = time * (0.5 + seed.z * 0.7) + seed.x * 6.283;
  vec2 orbit = vec2(cos(o), sin(o)) * (0.004 + seed.z * 0.006);

  vec2 p = turn + (slow * 0.014 + flutter * 0.070) * (0.55 + z) + orbit;

  // The lens opens the cloud. Radial push alone reads as a clean circular hole,
  // so it is combined with a tangential swirl and jittered per mote — the edge
  // of the opening ends up ragged and it churns rather than parting.
  vec2 away = p - mouse;
  float d = length(away);
  float wob = noise(home * 5.0 + time * 0.5) * 0.34 + 0.83;
  float R = 0.34 * wob * lens;
  float force = smoothstep(R, 0.0, d) * hover;
  vec2 dir = d > 0.0001 ? away / d : vec2(0.0, 1.0);
  vec2 tang = vec2(-dir.y, dir.x);

  // Much gentler than a shove. The lens's job is to make what is under it
  // readable, and a pill that is being flung aside cannot be read — so the
  // field only loosens under it, and the swirl keeps it alive while it does.
  float push = force * (0.035 + 0.055 * z);
  float curl = force * (0.028 + 0.05 * z) * sin(time * 0.9 + seed.x * 6.283);
  p += dir * push + tang * curl;

  /* The appear and the exit are one displacement run in opposite directions:
     at scatter = 1 every mote sits far outside the mark, at 0 it is home. The
     direction is mostly outward from where the mote already is, so the cloud
     opens and closes like a breath rather than sliding off one edge, but it is
     jittered by a hash of the rest position — a purely radial scatter expands
     as a clean disc, and a clean disc is the one shape the rest of this
     animation is at pains never to make. Depth stretches it, so the near motes
     leave first and the far ones trail, which is what stops the dispersal
     reading as a single sheet being pulled away. */
  vec2 astray = p + (vec2(hash(home * 91.7), hash(home * 41.3 + 7.1)) - 0.5) * 1.1;
  float len = max(length(astray), 0.0001);
  p += astray / len * scatter * (0.55 + z * 1.75);

  vPush = force;
  vDepth = z;
  p.x *= 1.0 + z * 0.03;                  // a touch of parallax between depths

  // Two populations, and the split is the whole trick.
  //
  // The bulk is graded cubed, as the site's dots were, so almost every pill is
  // a coloured smear a couple of pixels tall and the mark reads as a mass
  // rather than as a word cloud. But a field of nothing but smears loses the
  // point — you can no longer tell what it is made of. So a few per cent are
  // drawn large enough to actually read, scattered through the mark by a hash
  // of where they sit. Up close it is the product's own furniture; from across
  // the room it is weather.
  float grade = seed.z * seed.z * seed.z;
  float h = mix(span.x, span.y, grade) * (0.6 + z * 0.85) * unit;

  vBig = big;
  vLocal = corner;
  vAspect = aspect;
  vFill = fill;
  float legible = mix(5.0, 7.0, hash(home * 7.3 + seed.xz)) * (0.72 + z * 0.5) * unit;
  h = mix(h, legible, vBig);

  // Under the lens a pill swells — not to several times its size, which reads
  // as a zoom, but by enough that the label resolves. At rest the whole field
  // is weather; the lens is something you move over it.
  h *= 1.0 + force * 1.3 * lens;
  vec2 halfSize = vec2(h * aspect, h) * 0.5;

  vec2 at = vec2(p.x * fit.x, p.y * fit.y);
  gl_Position = vec4(at + (corner * 2.0 - 1.0) * halfSize / res * 2.0, 0.0, 1.0);
  // rect is (u0, v0, u1, v1) with v running down the atlas, while corner.y
  // runs up the quad in clip space — so v is taken bottom to top, or every
  // label comes out mirrored through the horizontal.
  vUv = vec2(mix(rect.x, rect.z, corner.x), mix(rect.w, rect.y, corner.y));
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2  vUv;
in float vDepth;
in float vPush;
in float vBig;
in vec2  vLocal;
in float vAspect;
in vec3  vFill;

uniform sampler2D atlas;
uniform float dark;      // 1 when the cloud sits on a dark ground
uniform float ink;       // global strength: fades the whole cloud in and out
out vec4 frag;

void main() {
  /* The body is a capsule described by its distance field rather than by a
     picture of one. Half-extents (aspect, 1) in pill units, corner radius 1 —
     which is what makes the ends semicircular however long the pill is — and
     the edge is antialiased against the pixel's own footprint, so it is exact
     at two pixels tall and still exact when the lens has it at thirty. */
  vec2 p = (vLocal * 2.0 - 1.0) * vec2(vAspect, 1.0);
  vec2 d = abs(p) - vec2(vAspect - 1.0, 0.0);
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 1.0;
  float edge = max(fwidth(dist), 0.0001);
  float cov = 1.0 - smoothstep(-edge, edge, dist);
  if (cov < 0.01) discard;

  // The lettering is the only thing the texture carries: white glyphs on
  // nothing, so its alpha is the coverage and there is no surround to bleed.
  // The mip bias is deliberate — half a level sharper than the sampler would
  // choose, because a label that is technically correctly filtered reads as
  // mush at the size these are drawn.
  float glyph = texture(atlas, vUv, -0.4).a;
  // Ink on a light pill, white on a dark one — the rule the app itself uses.
  float lum = dot(vFill, vec3(0.299, 0.587, 0.114));
  vec3 label = lum > 0.72 ? vec3(0.11, 0.12, 0.14) : vec3(1.0);
  vec4 tex = vec4(mix(vFill, label, glyph), cov);

  // Depth: near motes sit richer and darker so the mass keeps its depth, far
  // ones wash toward the ground rather than toward grey. On paper they wash
  // toward white; on a dark ground that is exactly inverted, or the distance
  // turns to fog against the dark instead of receding into it. The wash barely
  // touches the colour — depth is carried by size and alpha, which is enough,
  // and a heavier wash on a white page is indistinguishable from grey.
  vec3 wash = mix(vec3(1.0), vec3(0.06, 0.10, 0.16), dark);
  vec3 col = mix(mix(wash, tex.rgb, 0.94), tex.rgb * mix(0.97, 1.14, dark),
                 smoothstep(0.0, 1.0, vDepth));
  col = mix(col, tex.rgb, vBig);

  // Under the lens a pill returns to its own colour at full strength — the
  // lens is what makes a pill look like itself.
  col = mix(col, tex.rgb, vPush);

  // The readable few sit at nearly full strength; the smears stay weather.
  float a = tex.a * (0.27 + vDepth * 0.44 + vBig * 0.29) * (1.0 + vPush * 1.9) * ink;
  frag = vec4(col, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed');
  }
  return sh;
}

/* ── Easing ────────────────────────────────────────────────────────────── */

/* The cloud arrives fast and settles — the app is waiting, so the loader has to
   be *there* rather than fading up politely — and leaves the other way round,
   gathering pace as it goes so the last of it is gone quickly. */
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/* ── The static fallback ───────────────────────────────────────────────── */

/**
 * What is left when there is no WebGL2, or the context is lost, or the shader
 * will not compile: the mark itself, breathing.
 *
 * This exists because the alternative is an empty box, and an empty box on a
 * loading screen is indistinguishable from a hung application. It is also what
 * `webgl: false` gets, so an app that wants the cheap version can ask for it.
 */
function staticMark(host, ground, reduced, mark = MARK_SVG) {
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'pointer-events:none;opacity:0;transition:opacity .5s ease;' +
    `color:${ground === 'dark' ? '#ffffff' : '#1d1e24'}`;
  wrap.innerHTML = mark.replace('<svg ', '<svg fill="currentColor" ');
  const svg = wrap.firstElementChild;
  // Bounded on both axes so the mark is the same size relative to its box
  // whether that box is a splash screen or a card, and never larger than it.
  svg.style.cssText = 'width:52%;height:auto;max-height:52%;max-width:52%';
  host.appendChild(wrap);

  // Two frames, not one: setting the opacity in the same tick as the insert is
  // not a transition, it is a value.
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.style.opacity = '1'; }));

  let pulse = null;
  if (!reduced) {
    // The one job left is to say that something is still happening. A slow
    // breath does that without pretending to be a progress bar.
    pulse = svg.animate?.(
      [{ opacity: 0.55 }, { opacity: 1 }, { opacity: 0.55 }],
      { duration: 2400, iterations: Infinity, easing: 'ease-in-out' }
    );
  }
  return {
    fade(ms) { wrap.style.transition = `opacity ${ms}ms ease`; wrap.style.opacity = '0'; },
    stop() { pulse?.cancel(); wrap.remove(); },
  };
}

/* ── Mount ─────────────────────────────────────────────────────────────── */

/**
 * Mounts the loader inside `element` and starts it.
 *
 * Returns synchronously with a handle, so a caller that only wants to show and
 * later dismiss the thing never has to await anything. `ready` is there for
 * callers that care whether they got the cloud or the fallback.
 *
 * @param {Element|string} element  where to mount; a selector is resolved once
 * @returns {{ready: Promise<'cloud'|'static'>, finish: () => Promise<void>,
 *            destroy: () => void, canvas: HTMLCanvasElement|null}}
 */
export function mountLoader(element, options = {}) {
  const host = typeof element === 'string' ? document.querySelector(element) : element;
  if (!host) throw new Error('[resourced-loader] no element to mount in');

  const {
    /* Light or dark. It decides which way depth washes and what colour the
       fallback mark is; it paints no background of its own, so whatever the app
       puts behind the loader shows through. */
    ground = 'light',
    /* How much of its box the mark spans, along whichever axis binds first.
       Below about 0.5 the mark stops being the picture and becomes a logo
       sitting in space; above 0.9 it touches the edges of a square box. */
    scale = 0.82,
    /* A multiplier on the population, which is otherwise derived from the box.
       Under 1 for an app that would rather spend the GPU elsewhere while it
       boots. */
    density = 1,
    /* The ceiling on that population. 90,000 is roughly what the marketing hero
       runs at full width on a desktop. */
    maxPills = 90_000,
    /* How many distinct pills the atlas carries, out of the 960 vendored. Every
       one is rasterised at startup, so this is the knob that trades a few
       milliseconds of setup against how often a label repeats — and since only
       the readable few can be read at all, a repeat among the smears costs
       nothing but variety of shape. */
    vocabulary = 640,
    /* The share of motes drawn large enough to read. Each takes a label no
       other mote has, so it is bounded by `vocabulary` as well. */
    readable = 0.006,
    /* How long the cloud takes to gather, and to disperse. The exit is the one
       `finish()` waits on. */
    appear = 900,
    exit = 1100,
    /* How wide and strong the lens is, or null for the pair the cloud picks
       between: 1.0 while it is following a cursor and 1.9 while it is wandering
       on its own. The wander is wider and stronger for the reason the site
       makes it so on phones — with nothing pointing at it, the lens has to
       carry the whole impression — and the two are crossfaded rather than
       switched, so a hand arriving on the mouse tightens the lens instead of
       snapping it. Give a number to pin both. */
    lens = null,
    /* Follow a real cursor. On by default: this is the configuration the
       loader ships in. It is not either/or — a mount with `pointer` on still
       wanders whenever there is no cursor to follow, which is every touch
       device and every desktop where the hand is off the mouse. */
    pointer = true,
    /* Follow a finger. Off by default, and separate from `pointer`, because
       the two are not the same gesture: a cursor is present continuously and
       can be followed on sight, while a finger only exists between a press and
       a lift, and the press is usually the start of a scroll rather than an
       approach to the mark. So this does not treat touches as cursor moves —
       it waits for a drag. A press that never moves is left alone, which is
       what keeps a tap on a button underneath from dragging the lens across
       the mark, and a lift hands back to the wander immediately rather than
       parking the opening where the finger was for `idle` milliseconds.
       Nothing is preventDefault-ed: the page still scrolls through the mark,
       and a gesture the browser claims for scrolling simply ends the drag. */
    touch = false,
    /* How long a cursor has to sit still before the lens takes itself back.
       Long enough not to fight someone who is reading, short enough that an
       abandoned tab does not freeze. */
    idle = 2400,
    /* The cap on device pixel ratio. The cost here is fill rate, and a phone at
       3× draws nine times the pixels for a difference nobody can see on a
       two-pixel pill. */
    maxDpr = 2,
    /* Force the fallback. For testing it, and for an app that wants the mark
       without spending a WebGL context on it. */
    webgl = true,
    /* Trims on the shade the mark is painted in, applied after the ramp so its
       shape is kept. 1 and 0 are what this has always drawn. Below 1, the whole
       mark desaturates evenly; a small positive lift pales it with it, which is
       what keeps a desaturated cloud from going grey and heavy. */
    satScale = 1,
    litLift = 0,
    /* A multiplier on how opaque the whole cloud is.

       The pills are mostly transparent — the base alpha is `0.27 + depth`, so
       most of them are a fifth to a half covering — and on a white page a
       translucent pale pill composites to very nearly white however dark its
       own colour is. That is why trimming saturation and lightness moved the
       mark so little: alpha was doing the deciding, and neither of them touches
       it. This does. Above 1 the mark reads as ink on paper; below 1 it fades
       toward the page. */
    inkScale = 1,
    /* The shape the cloud gathers into, as SVG text. The Resourced mark unless
       told otherwise; the marketing site hands it other silhouettes so a
       diagram can move the way the mark does. Whatever is given is fitted to
       the box the same way, so its viewBox is the frame. */
    mark = MARK_SVG,
  } = options;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The canvas is absolutely positioned inside the host, so the host has to be
     a containing block. Anything already positioned is left alone; only a
     `static` host is nudged, and that is the one thing this touches outside its
     own subtree, which is why the README says so. */
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  /* ── State ──
     All of it declared before anything can run, because `finish()` and
     `destroy()` are reachable from the moment this function returns and the
     early bail-outs below return the same handle as the working path. */
  let dead = false;
  let fallback = null;
  let canvas = null;
  let gl = null;
  let prog = null;
  let tex = null;
  let frame = 0;
  let io = null;
  let ro = null;
  let COUNT = 0;
  const buffers = [];
  const shaders = [];

  /* `phase` is what the clock is doing, not what the cloud looks like: the
     shader is told a single `scatter`, and where that number comes from is
     decided here. It starts at 'out' being impossible and ends there. */
  let phase = 'in';
  let phaseAt = performance.now();
  let exitDone = null;
  let exitPromise = null;

  let fitX = 1;
  let fitY = 1;
  let markAspect = 1;
  /* Where the lens is being asked to go, and where it actually is. `eased`
     chases `target`, which is itself a blend of the cursor and the wander — two
     stages of smoothing, and both are needed: the inner one keeps a flicked
     mouse from teleporting the opening, the outer one keeps the handover
     between cursor and wander from being a cut. */
  const target = { x: 0, y: 0, on: 0 };
  const eased = { x: 0, y: 0, on: 0 };
  const cursor = { x: 0, y: 0 };
  let lastMove = -Infinity;
  /* 1 while the cloud is driving the lens itself, 0 while a cursor is. It only
     ever moves a little per frame, which is what makes the handover a glide. */
  let wander = 1;

  /* A device with no cursor at all never hands over, so it is settled here
     rather than being rediscovered every frame. The listener is not even
     attached: a coarse pointer fires `pointermove` on every tap, and a lens
     that jumped to each tap and then wandered back would be the worst of both. */
  const coarse = matchMedia('(hover: none), (pointer: coarse)').matches;
  const following = pointer && !coarse;
  /* The other half of that decision. The objection above is to treating a tap
     as a cursor move, not to touch as such, so a coarse pointer that asked for
     it gets the lens on a drag — where there is a hand on the mark continuously
     and something to follow, which is the condition the lens was built for. */
  const smear = touch && coarse;
  /* Where the finger went down, and whether it has moved far enough to count.
     The threshold is what separates a drag from a tap; below it nothing has
     been asked for yet. */
  let downAt = null;
  let grabbed = false;

  const LENS_FOLLOW = lens ?? 1.0;
  const LENS_WANDER = lens ?? 1.9;

  let uRes, uTime, uMouse, uHover, uFit, uUnit, uScatter, uInk, uLens;

  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  const toStatic = () => {
    if (dead || fallback) return;
    fallback = staticMark(host, ground, reduced, mark);
    if (phase === 'out') fallback.fade(exit);      // dismissed before it arrived
    resolveReady('static');
  };

  /* ── Teardown ── */

  /* Everything that has to come loose again. Called by `destroy()`, by
     `finish()` once the exit has run, and by the context-loss path — which is
     why it has to be safe to call twice. */
  const release = () => {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(frame);
    frame = 0;
    io?.disconnect();
    ro?.disconnect();
    removeEventListener('resize', onResize);
    fallback?.stop();
    if (!canvas) return;
    canvas.removeEventListener('webglcontextlost', onLost);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerdown', onDown);
    removeEventListener('pointermove', onDrag);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    if (gl) {
      for (const b of buffers) gl.deleteBuffer(b);
      if (tex) gl.deleteTexture(tex);
      for (const s of shaders) gl.deleteShader(s);
      if (prog) gl.deleteProgram(prog);
      /* The one that actually matters. Deleting the objects frees what they
         hold but leaves the context alive, and a browser keeps only about
         sixteen of those before it starts dropping the oldest — which is how a
         loader that looks harmless takes down a chart three routes later.
         Shrinking the drawing buffer afterwards is belt and braces: some
         drivers hold the backing store until the canvas is collected. */
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    canvas.width = canvas.height = 1;
    canvas.remove();
  };

  /* ── Listeners ── */

  const onResize = () => { if (!dead && gl) size(); };

  /* Tracked on the window rather than on the host, which is what the site does
     too. A loader is usually an overlay with `pointer-events: none` on it or
     over it, so events on the element itself cannot be relied on; and a cursor
     that has wandered off the panel still says something about where attention
     is, so it is worth following out of the box rather than dropping. */
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Invert exactly what the vertex shader applies, so the opening sits under
    // the cursor rather than trailing away from it.
    cursor.x = ((e.clientX - r.left) / r.width * 2 - 1) / fitX;
    cursor.y = (1 - (e.clientY - r.top) / r.height * 2) / fitY;
    lastMove = performance.now();
  };

  const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onDrag = (e) => {
    if (!downAt) return;
    /* Eight pixels of slop. Under it this is still a tap — possibly one aimed
       at a link behind the cloud — and the lens stays on its own path. */
    if (!grabbed && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) return;
    grabbed = true;
    onMove(e);
  };
  /* Also the handler for `pointercancel`, which is how a vertical drag ends:
     the browser decides partway through that the gesture is a scroll and takes
     the pointer away. The mark having answered the first few millimetres of it
     is not a bug — it is the only response a scroll past the hero can get. */
  const onUp = () => { downAt = null; grabbed = false; };

  /* A lost context is not something to recover from here. Restoring one means
     rebuilding the atlas and re-uploading every buffer, which is a second of
     work to resume an animation that exists to cover a second of work. The
     preventDefault is still needed — without it the browser will not tell us
     anything more — and then the mark goes in, because the alternative is a
     blank rectangle, and a blank rectangle on a loading screen is
     indistinguishable from a hung application. */
  const onLost = (e) => {
    e.preventDefault();
    if (dead) return;
    cancelAnimationFrame(frame);
    frame = 0;
    canvas.style.display = 'none';
    fallback = staticMark(host, ground, reduced, mark);
  };

  /* ── Sizing ──
     Where this parts company with the hero most completely. The site measures
     its mark against the viewport, the fold and its own ruled column, because
     there the mark *is* the page. Here it is measured against the element it
     was handed and nothing else, so a 200px panel and a full screen get the
     same picture at two sizes rather than one of them getting a special case. */
  const size = () => {
    const dpr = Math.min(maxDpr, devicePixelRatio || 1);
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);

    // The mark is half again as wide as it is tall and `home` is normalised on
    // its longer edge, so fitting it is a question of which constraint binds:
    // the box's width, or its height once the mark's proportion is allowed for.
    const side = markSide(w, h);
    fitX = side / w;
    fitY = side / h;
    gl.uniform2f(uFit, fitX, fitY);

    /* How many device pixels a pill unit is worth. The site ties this to the
       viewport height; here it is tied to the mark, so the grain of the cloud
       is the same fraction of the mark at every size. The floor is what keeps a
       small loader from dissolving: below about 550px of mark the smears fall
       under a pixel, and a field of sub-pixel quads does not read as faint, it
       reads as absent. */
    gl.uniform1f(uUnit, grainFor(side));
  };

  const markSide = (w, h) => Math.min(w, h * markAspect) * scale;

  /* The grain: how many device pixels a pill unit is worth for a mark `side`
     across. Shared with the population, which has to divide by it, so the floor
     lives in one place.

     The site divides by 900 — but by the height of a canvas that runs a third
     of a screen past the fold, not by the mark. Measured against the mark
     itself the same grain is 700, and it has to be the same: at 900 the cloud
     came out visibly thinner than the hero it was taken from, which on a white
     ground is the difference between a mass and a haze. */
  const grainFor = (side) => Math.max(0.62, side / 700);

  /* ── Frames ── */

  /** One frame at clock time `t`, in seconds. */
  const paint = (t) => {
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, eased.x, eased.y);
    gl.uniform1f(uHover, eased.on);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, COUNT);
  };

  const born = performance.now();

  const draw = (now) => {
    size();

    /* The wander: a slow figure that crosses the mark on two incommensurable
       periods, so it never retraces its path. This is the site's own no-pointer
       path, and it is not a lesser substitute for the cursor — it is the same
       lens on the same mark, simply moved by the clock instead of by a hand,
       and it is what a phone, a tablet and a desktop with the mouse untouched
       all see. It runs continuously whether or not anything is following it, so
       that handing back to it means fading into a path already in motion rather
       than starting one from wherever the cursor was abandoned. */
    const t = (now - born) / 1000;
    const wx = Math.sin(t * 0.23) * 0.62 + Math.sin(t * 0.09) * 0.22;
    const wy = Math.cos(t * 0.17) * 0.44 + Math.sin(t * 0.31) * 0.14;

    /* Who has the lens. A cursor takes it quickly — someone who has just moved
       the mouse is looking for a response — and gives it back slowly, over
       about a second and a half, so a pause to read is not punished with a
       lurch. Neither figure is snapped to: `target` lands between the two and
       `eased` is still chasing that. */
    /* A cursor holds it until it has been still for `idle`; a finger holds it
       only while it is down. There is no idle grace for touch because there is
       no such thing as a finger resting on the glass while its owner reads. */
    const held = grabbed || (following && now - lastMove < idle);
    wander += ((held ? 0 : 1) - wander) * (held ? 0.09 : 0.012);
    target.x = cursor.x + (wx - cursor.x) * wander;
    target.y = cursor.y + (wy - cursor.y) * wander;
    target.on = 1;
    gl.uniform1f(uLens, LENS_FOLLOW + (LENS_WANDER - LENS_FOLLOW) * wander);

    // Eased rather than snapped, so a jump in the target pulls the opening
    // through a curve instead of teleporting it across the mark.
    eased.x += (target.x - eased.x) * 0.12;
    eased.y += (target.y - eased.y) * 0.12;
    eased.on += (target.on - eased.on) * 0.08;

    const since = now - phaseAt;
    if (phase === 'in') {
      const k = clamp01(since / appear);
      gl.uniform1f(uScatter, (1 - easeOut(k)) * 1.15);
      // The ink runs ahead of the gathering, so the cloud is already there,
      // faintly, while it is still arriving — a loader that fades up on the
      // same curve it assembles on takes twice as long to say anything.
      gl.uniform1f(uInk, Math.min(1, k * 2.2) * inkScale);
      if (k >= 1) phase = 'hold';
    } else if (phase === 'out') {
      const k = clamp01(since / exit);
      gl.uniform1f(uScatter, easeIn(k) * 1.35);
      /* The ink lags the motion on the way out. Fading and scattering together
         reads as one crossfade and the dispersal is lost inside it; letting the
         cloud break up first and only then go means the shape is visibly
         leaving rather than merely ceasing. */
      gl.uniform1f(uInk, (1 - easeIn(clamp01((k - 0.25) / 0.75))) * inkScale);
      if (k >= 1) {
        exitDone?.();
        return;                            // released: no further frames
      }
    }

    paint((now - born) / 1000);
    frame = requestAnimationFrame(draw);
  };

  /* ── Setup ──
     Asynchronous because the mark has to be rasterised through an <img>, which
     is a network-free but genuinely deferred operation. Every step checks
     `dead`, because a route can be abandoned faster than an image decodes. */
  const start = async () => {
    let cov;
    try {
      cov = coverage(await rasterise(mark, 512), 512);
    } catch (e) {
      console.warn('[resourced-loader] mark:', e.message);
      canvas.remove();
      canvas = null;
      toStatic();
      return;
    }
    if (dead) return;
    if (!cov) { canvas.remove(); canvas = null; toStatic(); return; }
    markAspect = cov.aspect;

    /* The population is derived from the mark's area in device pixels rather
       than from the window, which is the only way one call can serve a splash
       screen and a card. It is fixed at mount: the buffers are uploaded once,
       so a resize changes how big the pills are, not how many. That is the
       right trade for something on screen for seconds.

       What is held constant is *ink* — the share of the mark the pills actually
       cover — not the count. Area alone was not enough: below about 430px of
       mark the pill size stops shrinking with it, held up by the floor in
       `grainFor`, and a count scaled on area alone left a small panel covering
       a fifth of the ground a splash screen does. Dividing by the square of the
       grain puts the two back at the same weight, which is why a 200px panel
       asks for ten thousand pills rather than a few hundred.

       Above the floor this comes out very nearly constant, since the grain
       grows with the mark: a full-screen splash and a 400px card both ask for
       about seventy thousand and differ only in how large each pill is drawn.
       That is the intended reading of "the same picture at two sizes", and the
       constant is set by measuring the marketing hero's own ink rather than by
       eye. */
    const dpr = Math.min(maxDpr, devicePixelRatio || 1);
    const box = host.getBoundingClientRect();
    const side = markSide(Math.max(1, box.width * dpr), Math.max(1, box.height * dpr));
    const grain = grainFor(side);
    COUNT = Math.max(1200, Math.min(maxPills,
      Math.round(density * 0.213 * side * side / markAspect / (grain * grain))));

    const pts = seedPoints(cov, COUNT);

    /* The atlas, band by band, so a mote can be handed a pill from its own band
       without searching for one. The bands arrive already ordered around the
       wheel, which is what lets the cloud graduate rather than speckle. */
    const per = Math.max(4, Math.floor(Math.min(vocabulary, TOTAL) / WHEEL.length));
    const names = [];
    const ranges = [];
    for (let i = 0; i < WHEEL.length; i++) {
      const from = names.length;
      names.push(...band(i, per));
      ranges.push([from, names.length]);
    }
    const atlas = buildAtlas(names, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (!atlas) {
      console.warn('[resourced-loader] atlas did not fit');
      canvas.remove();
      canvas = null;
      toStatic();
      return;
    }

    const parts = assign(pts.home, COUNT, atlas, ranges, readable, { sat: satScale, lift: litLift });

    try {
      prog = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
        const sh = compile(gl, type, src);
        shaders.push(sh);
        gl.attachShader(prog, sh);
      }
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
      }
    } catch (e) {
      // Loud on the way down. A silent fallback hides a broken shader behind
      // something that looks almost right, which cost the site an hour once
      // already — GLSL reserving `half` was all it took.
      console.warn('[resourced-loader] shader:', e.message);
      canvas.remove();
      canvas = null;
      toStatic();
      return;
    }
    gl.useProgram(prog);

    const bind = (data, n, name, divisor) => {
      const b = gl.createBuffer();
      buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      if (divisor) gl.vertexAttribDivisor(loc, divisor);
    };
    // One quad, drawn COUNT times.
    bind(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2, 'corner', 0);
    bind(pts.home, 2, 'home', 1);
    bind(pts.seed, 3, 'seed', 1);
    bind(parts.rect, 4, 'rect', 1);
    bind(parts.aspect, 1, 'aspect', 1);
    bind(parts.big, 1, 'big', 1);
    bind(parts.fill, 3, 'fill', 1);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    // Mipmaps are what let a pill shrink to two pixels without turning into
    // aliased noise: at that size the label should be a smear of its own
    // colour, which is exactly what a mipmap of it is.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'atlas'), 0);

    uRes = gl.getUniformLocation(prog, 'res');
    uTime = gl.getUniformLocation(prog, 'time');
    uMouse = gl.getUniformLocation(prog, 'mouse');
    uHover = gl.getUniformLocation(prog, 'hover');
    uFit = gl.getUniformLocation(prog, 'fit');
    uUnit = gl.getUniformLocation(prog, 'unit');
    uScatter = gl.getUniformLocation(prog, 'scatter');
    uInk = gl.getUniformLocation(prog, 'ink');
    uLens = gl.getUniformLocation(prog, 'lens');
    // Smallest and largest a pill is drawn, in pill units. The floor is what
    // keeps a distant pill a mark rather than a flicker.
    gl.uniform2f(gl.getUniformLocation(prog, 'span'), 0.45, 2.2);
    gl.uniform1f(uLens, LENS_WANDER);          // nothing is following it yet
    gl.uniform1f(gl.getUniformLocation(prog, 'dark'), ground === 'dark' ? 1 : 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    size();
    addEventListener('resize', onResize);
    /* A panel can change size without the window doing anything — a sidebar
       collapsing, a grid reflowing — so the box is watched rather than the
       viewport. The window listener stays as well, because a move between
       displays changes the device pixel ratio without changing the box. */
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(onResize);
      ro.observe(host);
    }

    if (following) addEventListener('pointermove', onMove, { passive: true });
    if (smear) {
      addEventListener('pointerdown', onDown, { passive: true });
      addEventListener('pointermove', onDrag, { passive: true });
      addEventListener('pointerup', onUp, { passive: true });
      addEventListener('pointercancel', onUp, { passive: true });
    }

    canvas.dataset.pills = String(COUNT);
    canvas.dataset.labelled = String(parts.labelled);

    if (reduced) {
      /* A still, assembled frame. Not a slowed-down cloud and not a loop of
         anything: the preference says no motion, and the honest reading of that
         is one picture. The lens is placed off centre and held there so the
         frame still has a legible cluster in it rather than being uniformly
         small, and the clock is stopped at a moment where the drift has taken
         the mark somewhere more interesting than its rest pose. */
      target.x = eased.x = cursor.x = -0.35;
      target.y = eased.y = cursor.y = 0.10;
      target.on = eased.on = 1;
      gl.uniform1f(uScatter, 0);
      gl.uniform1f(uInk, inkScale);
      paint(2.7);
      resolveReady('cloud');
      return;
    }

    // A `finish()` that arrived while the atlas was building already set the
    // phase, and it wins: the app has moved on and the cloud should leave
    // rather than gather.
    if (phase !== 'out') {
      phase = 'in';
      phaseAt = performance.now();
    }
    frame = requestAnimationFrame(draw);

    /* Nothing renders while the loader is off screen. A route transition can
       easily leave one mounted behind a scrolled page, and an invisible cloud
       is still tens of thousands of instances a frame. */
    io = new IntersectionObserver(([e]) => {
      if (dead) return;
      if (e.isIntersecting && !frame) frame = requestAnimationFrame(draw);
      else if (!e.isIntersecting && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    io.observe(canvas);
    resolveReady('cloud');
  };

  /* ── The handle ──
     The same shape whether the cloud or the fallback is on screen, so an app
     never has to ask which it got. */
  const handle = {
    ready,
    get canvas() { return canvas; },
    /**
     * Disperse, and resolve once it is gone.
     *
     * Safe before the cloud has finished setting up — the exit starts from
     * wherever it has reached — and safe to call twice, which matters because a
     * route guard and a component teardown will both try.
     */
    finish() {
      if (dead) return Promise.resolve();
      if (exitPromise) return exitPromise;
      phase = 'out';
      phaseAt = performance.now();
      fallback?.fade(exit);
      /* A reduced-motion loader has no loop to walk through the dispersal, so
         it leaves on a plain fade. A cross-fade is the one transition the
         preference is generally taken to allow, and cutting instead would be a
         worse answer to "no motion" than a soft one. */
      if (reduced && canvas) {
        canvas.style.transition = `opacity ${exit}ms ease`;
        canvas.style.opacity = '0';
      }
      /* Resolved by whichever comes first: the animation reaching its end, or a
         plain timer. The timer is not a safety net for a bug — a backgrounded
         tab, an off-screen loader and a reduced-motion still all legitimately
         stop producing frames, and an app awaiting this must not be left
         hanging on any of them. `release` is idempotent, so both may run. */
      exitPromise = new Promise((resolve) => {
        const done = () => { release(); resolve(); };
        exitDone = done;
        setTimeout(done, exit + 40);
      });
      if (!reduced && !frame && !dead && canvas && gl && COUNT) {
        frame = requestAnimationFrame(draw);
      }
      return exitPromise;
    },
    /** Stop and release everything now, with no animation. */
    destroy() { release(); },
  };

  if (!webgl) {
    toStatic();
    return handle;
  }

  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
  host.appendChild(canvas);
  canvas.addEventListener('webglcontextlost', onLost);

  /* Straight alpha, not premultiplied: the shader ends on `frag = vec4(col, a)`
     with `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` blending, and those three have to
     agree. Telling the compositor the colour is already multiplied when it is
     not makes every soft pixel composite hotter than it should — which looks
     exactly like the mark being over-saturated, and is a wrong turn worth not
     taking twice. */
  gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.remove();
    canvas = null;
    toStatic();
    return handle;
  }

  start().catch((e) => {
    console.warn('[resourced-loader]', e);
    toStatic();
  });

  return handle;
}

export default mountLoader;
