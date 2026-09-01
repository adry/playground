import { Stage } from './engine/stage.js';
import { catalog, getComponent } from './registry.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);

const state = {
  stage: null,
  entry: null,
  quality: params.get('quality') || 'high',
  playing: true,
  elapsed: 0,
  lastTime: 0,
  subframes: Number(params.get('subframes') || 1),
  captureMode: params.get('capture') === '1',
  frameIndex: 0,
};

function buildStage(quality) {
  state.stage?.dispose();
  state.stage = new Stage(canvas, {
    quality,
    // Required for toDataURL to be reliable outside a rAF callback.
    preserveDrawingBuffer: state.captureMode,
    pixelRatio: state.captureMode ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  });
  state.quality = quality;
}

async function select(id, { resetTime = true } = {}) {
  const entry = getComponent(id);
  state.entry = entry;
  await state.stage.load(entry.factory);
  if (!state.captureMode) fitToWindow();
  if (resetTime) state.elapsed = 0;
  history.replaceState(null, '', `?c=${entry.id}${state.quality !== 'high' ? `&quality=${state.quality}` : ''}`);
  renderMenu();
  return entry;
}

function fitToWindow() {
  state.stage.setSize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
}

// --- interactive loop -------------------------------------------------------

function tick(now) {
  requestAnimationFrame(tick);
  if (state.captureMode) return;

  const dt = state.lastTime ? Math.min((now - state.lastTime) / 1000, 1 / 15) : 1 / 60;
  state.lastTime = now;
  if (state.playing) state.elapsed += dt;

  state.stage.renderFrame(state.elapsed, {
    dt,
    subframes: state.subframes,
    seed: Math.floor(state.elapsed * 60),
  });

  updateHud(dt);
}

// --- UI ---------------------------------------------------------------------

const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const barEl = document.getElementById('bar');
let fpsAvg = 60;

function renderMenu() {
  menuEl.innerHTML = catalog
    .map((c, i) => {
      const active = state.entry && c.id === state.entry.id;
      return `<button class="item${active ? ' active' : ''}" data-id="${c.id}">
        <span class="idx">${i + 1}</span>
        <span class="body"><span class="name">${c.title}</span><span class="note">${c.note}</span></span>
      </button>`;
    })
    .join('');
}

menuEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.item');
  if (btn) select(btn.dataset.id);
});

function updateHud(dt) {
  fpsAvg += (1 / Math.max(dt, 1e-4) - fpsAvg) * 0.08;
  const duration = state.stage.duration;
  const phase = (state.elapsed % duration) / duration;
  barEl.style.transform = `scaleX(${phase})`;
  hudEl.textContent = `${fpsAvg.toFixed(0)} fps · ${state.quality} · loop ${duration}s · ${state.subframes}x shutter`;
}

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= catalog.length) select(catalog[n - 1].id);
  if (e.key === ' ') { e.preventDefault(); state.playing = !state.playing; }
  if (e.key === 'r') state.elapsed = 0;
  if (e.key === 'q') {
    const order = ['high', 'medium', 'draft'];
    const next = order[(order.indexOf(state.quality) + 1) % order.length];
    buildStage(next);
    select(state.entry.id, { resetTime: false });
  }
  if (e.key === 'h') document.body.classList.toggle('clean');
});

window.addEventListener('resize', () => { if (!state.captureMode) fitToWindow(); });

// --- capture API ------------------------------------------------------------
// Driven by capture/record.mjs over CDP. Nothing here reads a wall clock, so
// the recorder can take as long as it needs per frame without the motion in
// the exported file changing at all.

window.__lab = {
  catalog: catalog.map(({ id, title, note, duration }) => ({ id, title, note, duration })),

  async prepare({ id, width, height, quality = 'high' }) {
    state.captureMode = true;
    document.body.classList.add('clean');
    if (quality !== state.quality || !state.stage) buildStage(quality);
    const entry = await select(id, { resetTime: true });
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    state.stage.setSize(width, height, 1);
    return { id: entry.id, title: entry.title, duration: entry.duration, width, height };
  },

  // `seed` only drives grain and dither, which are deliberately per-frame.
  // Pinning it is what lets the loop verifier compare two frames byte for byte.
  frame({ index, fps, subframes = 2, shutter = 0.5, seed }) {
    const t = index / fps;
    state.stage.renderFrame(t, { dt: 1 / fps, subframes, shutter, seed: seed ?? index });
    return true;
  },
};

// --- boot -------------------------------------------------------------------

buildStage(state.quality);
await select(params.get('c') || catalog[0].id);
if (state.captureMode) {
  document.body.classList.add('clean');
} else {
  fitToWindow();
}
requestAnimationFrame(tick);
window.__labReady = true;
