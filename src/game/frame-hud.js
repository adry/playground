// A frame-time readout for the game page.
//
// "Sometimes jumpy" is not a thing either the owner or a probe can chase
// without knowing WHEN, so this records every frame's wall time and where it
// went, keeps the worst ones, and can put the numbers on screen.
//
// Turn it on with ?perf=1 in the URL, or press F2 at any time. It is inert
// otherwise: no DOM, no allocation per frame beyond the ring buffers, and the
// marks compile down to a performance.now() and a subtraction.
//
// The buckets are deliberately coarse. The question this answers is "was that
// hitch the sim, the props still baking, or the draw", not "which line".
//
// ===========================================================================
// A HITCH THIS INSTRUMENT WILL SHOW YOU THAT IS NOT THE GAME
// ===========================================================================
//
// Frames of 200 to 1200 ms turn up in headless runs on the capture container
// and they are the CONTAINER SCHEDULING, not the code. Three things prove it,
// and all three are worth repeating before anyone spends a day on it:
//
//   the simulation is bit-deterministic, verified by hashing the ghost's
//   position over 3000 frames across repeated runs in one process;
//
//   the spikes land on DIFFERENT frames each run, which a deterministic
//   workload cannot do if the cost is algorithmic;
//
//   an allocation-free arithmetic control loop, doing nothing but Math.sqrt
//   in a tight loop, reproduces them at the same magnitudes: 797 ms, 356 ms,
//   340 ms, on a run of the same length.
//
// This is the third time this project has been misled by its own instrument.
// The other two are recorded in editor-perf.mjs and in game/world/audit.js and
// they are both the same shape: a number taken once, out of order or on a cold
// process, pointing the opposite way to the same number taken warm.
//
// So: a spike here is evidence only if it reproduces on the SAME frame across
// runs, or if a bucket accounts for it. An unattributed spike on a machine you
// do not own is not a finding.
//
// ===========================================================================
// TWO MORE WAYS A PROBE ON THIS PROJECT HAS LIED, BOTH WORTH KNOWING
// ===========================================================================
//
// A PROBE THAT BUILDS ITS SUBJECT THE PLAIN WAY IS MEASURING A DIFFERENT
// PRODUCT. Chasing why the game's ghost billowed and /ghostly/'s did not, a
// probe constructed a Ghost the obvious way, `new Ghost({ seed })`, and found
// its top speed of 4.5 fighting the rules' 3.66 on every frame: 85% of cloth
// substeps jittering against /ghostly/'s 0.9%. The number was real, the
// mechanism was plausible, and the disagreement does not exist, because
// scene.js sets ghost.opts.maxSpeed to the rules' own value and has since the
// game was first playable. The probe had invented the fault it then found. The
// real cause was a tenth the size and somewhere else entirely.
//
// This is the most dangerous shape of instrument failure here so far, because
// nothing about the output looks wrong. The only defence is to read the file
// that constructs the thing rather than to trust your model of it, and to
// write the probe so it constructs its subject the way the product does.
//
// AND A PIXEL HEURISTIC IS A PROXY, NOT A MEASUREMENT. Measuring the ghost's
// hop by finding the brightest pixels in the frame reported an apex of zero and
// a lift of minus 612 pixels: the threshold was catching the HUD text and the
// perimeter wall, not the sheet. The fix was not a better threshold, it was to
// stop using a proxy: state.ghost.airY is the number itself and the page will
// hand it over. Reach for the quantity before reaching for the picture of it.

const HISTORY = 240;      // four seconds at 60fps
const HITCH_MS = 33;      // a dropped frame at 60fps
const BAD_MS = 100;       // long enough that the player feels it as a stall

export function createFrameHud({ enabled = false, buckets = [] } = {}) {
  const names = buckets.slice();
  const frames = new Float32Array(HISTORY);   // wall time between frame starts
  const work = new Float32Array(HISTORY);     // our own time inside the frame
  const spent = new Float32Array(HISTORY * names.length);
  let head = 0;
  let filled = 0;

  let hitches = 0;
  let bad = 0;
  let worst = 0;
  let worstAt = 0;
  const worstSpent = new Float32Array(names.length);

  let t0 = 0;             // start of this frame's work
  let mark0 = 0;          // start of the current bucket
  let bucket = 0;
  let prevStart = 0;
  let showing = enabled;
  let el = null;
  let paintAt = 0;

  function ensureEl() {
    if (el || typeof document === 'undefined') return;
    el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:9999',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#cfe8d8', 'background:rgba(8,12,10,0.82)',
      'border:1px solid rgba(140,200,170,0.28)', 'border-radius:6px',
      'padding:6px 9px', 'white-space:pre', 'pointer-events:none',
      'text-shadow:0 1px 0 rgba(0,0,0,0.7)',
    ].join(';');
    document.body.appendChild(el);
  }

  function frameStart(now) {
    t0 = now;
    mark0 = now;
    bucket = 0;
    const gap = prevStart ? now - prevStart : 0;
    prevStart = now;
    if (gap > 0) {
      frames[head] = gap;
      if (gap >= HITCH_MS) hitches += 1;
      if (gap >= BAD_MS) bad += 1;
      if (gap > worst) {
        worst = gap;
        worstAt = now;
        // The previous slot is the frame this gap belongs to: the gap is
        // measured at the START of the frame after it.
        const p = (head + HISTORY - 1) % HISTORY;
        for (let i = 0; i < names.length; i++) worstSpent[i] = spent[p * names.length + i];
      }
    }
  }

  // Closes the current bucket and opens the next. Call once per name, in the
  // order the names were given.
  function mark() {
    const now = performance.now();
    if (bucket < names.length) spent[head * names.length + bucket] = now - mark0;
    bucket += 1;
    mark0 = now;
  }

  function frameEnd() {
    const now = performance.now();
    if (bucket < names.length) spent[head * names.length + bucket] = now - mark0;
    work[head] = now - t0;
    head = (head + 1) % HISTORY;
    if (filled < HISTORY) filled += 1;
    if (showing && now - paintAt > 250) { paintAt = now; paint(); }
  }

  function stats() {
    const n = filled;
    if (!n) return null;
    const sorted = Array.from(frames.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    let workSum = 0;
    for (let i = 0; i < n; i++) { sum += frames[i]; workSum += work[i]; }
    const parts = {};
    for (let i = 0; i < names.length; i++) {
      let s = 0;
      for (let f = 0; f < n; f++) s += spent[f * names.length + i];
      parts[names[i]] = +(s / n).toFixed(2);
    }
    const worstParts = {};
    for (let i = 0; i < names.length; i++) worstParts[names[i]] = +worstSpent[i].toFixed(1);
    return {
      frames: n,
      fps: +(1000 / (sum / n)).toFixed(1),
      avg: +(sum / n).toFixed(2),
      p50: +sorted[(n * 0.5) | 0].toFixed(2),
      p95: +sorted[Math.min(n - 1, (n * 0.95) | 0)].toFixed(2),
      max: +sorted[n - 1].toFixed(2),
      work: +(workSum / n).toFixed(2),
      hitches,
      bad,
      worst: +worst.toFixed(1),
      parts,
      worstParts,
    };
  }

  function paint() {
    ensureEl();
    if (!el) return;
    const s = stats();
    if (!s) return;
    const rows = [
      `${s.fps.toFixed(1)} fps   ${s.avg.toFixed(1)} ms avg`,
      `p95 ${s.p95.toFixed(1)}   max ${s.max.toFixed(1)} (${s.frames}f)`,
      `hitch>${HITCH_MS} ${hitches}   >${BAD_MS} ${bad}   worst ${s.worst.toFixed(0)}`,
      `work ${s.work.toFixed(2)} ms`,
    ];
    for (const k of names) rows.push(`  ${k.padEnd(9)} ${s.parts[k].toFixed(2)}`);
    if (worst >= HITCH_MS) {
      rows.push(`worst frame:`);
      for (const k of names) rows.push(`  ${k.padEnd(9)} ${s.worstParts[k].toFixed(1)}`);
    }
    el.textContent = rows.join('\n');
  }

  function reset() {
    head = 0; filled = 0; hitches = 0; bad = 0; worst = 0;
    frames.fill(0); work.fill(0); spent.fill(0); worstSpent.fill(0);
    prevStart = 0;
  }

  function show(on) {
    showing = on === undefined ? !showing : !!on;
    if (!showing && el) el.remove(), (el = null);
    else if (showing) paint();
    return showing;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); show(); }
    });
  }

  return { frameStart, mark, frameEnd, stats, reset, show, HITCH_MS, BAD_MS };
}
