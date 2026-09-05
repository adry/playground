// THE LOOP: author a change, save the file, play it, see the change.
//
//   node editor-to-game.mjs                  the whole loop
//   node editor-to-game.mjs --keep           leave the saved level behind
//
// This is the one test that is worth more than all the others put together,
// because it is the only one that fails when the two halves drift apart. The
// editor can be perfect and the game can be perfect and the feature can still
// be broken, and it was: the game called createWorld() unconditionally and
// nothing on earth could open the file the editor wrote.
//
// It runs in three phases and each one is a claim that can fail:
//
//   1  AUTHOR AND SAVE. The editor is opened on public/levels/demo.json, the
//      wall's stone is changed through the panel's own select -- a real change
//      event, so the real commit, the real autosave and the real validation --
//      and the save button is clicked. What comes back is the actual download
//      the owner would get, not a serialisation done on the side.
//
//   2  PLAY IT. /lab/?game=1&level=... is opened on the file phase 1 wrote,
//      and the level the game is running is read back out of the page. It also
//      checks that the level's prop templates were all baked BEFORE the first
//      frame: the pending count has to be zero at ready, because a bake that
//      runs after the renderer has drawn costs about five times more.
//
//   3  A LEVEL THAT FAILS CANNOT BE SAVED SILENTLY. A fence is drawn across a
//      corner of the demo -- four seconds of work for an author, and the exact
//      mistake that ends a game, because the ghost vaults in and no skeleton
//      can follow. The fast half of the validation does not see it at all. The
//      claim is that the save is refused anyway: a dialog and no download.
//
// Phase 1 also drives the interface itself with a real mouse -- the wall tool,
// the placement indicator and the move and turn handles -- because all three
// are things that either work under a pointer or do not work at all.

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { openLab, parseArgs } from './capture/session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 1400);
const height = Number(args.h || 900);
const outDir = args.out || 'out/loop';
const saved = 'public/levels/loop-check.json';

const fails = [];
const claim = (ok, what) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) fails.push(what);
};

await mkdir(outDir, { recursive: true });
const demo = JSON.parse(await readFile('public/levels/demo.json', 'utf8'));

// --- 1: author and save -------------------------------------------------------

const editor = await openLab({
  width, height, entry: '/editor/', query: 'test=1',
  readyFlag: '__editorReady', verbose: !!args.verbose,
});

let dialog = null;
editor.page.on('dialog', (d) => { dialog = d.message(); d.dismiss(); });

await editor.page.evaluate((doc) => {
  window.__editor.load(doc);
  window.__editor.setMode('game');
}, demo);


// --- 1b: the interface, under a real mouse -------------------------------------
//
// page.mouse rather than a synthetic PointerEvent, and for a reason worth
// keeping: the canvas calls setPointerCapture on pointerdown, and that throws
// on a pointer id the browser has never seen, which takes the handler down with
// it. A dispatched event would test nothing and look like it had.

const clickWorld = async (x, z) => {
  const at = await editor.page.evaluate(([wx, wz]) => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    const s = window.__editor.scene.toScreen(wx, wz);
    return [r.left + s.x, r.top + s.y];
  }, [x, z]);
  await editor.page.mouse.move(at[0], at[1]);
  await editor.page.mouse.down();
  await editor.page.mouse.up();
  return at;
};
const clickEntry = (label) => editor.page.evaluate((want) => {
  const b = [...document.querySelectorAll('#left .swatches button')]
    .find((n) => n.textContent.replace(/[A-Z]$/, '').trim() === want);
  b?.click();
  return !!b;
}, label);

// THE WALL, PIECE BY PIECE. Pick the change of stone out of the one list and
// click on the perimeter; the change lands at the distance clicked.
claim(await clickEntry('change of stone'), 'the wall tool is an entry in the palette');
const wallBefore = await editor.page.evaluate(() => window.__editor.doc.wall.styles.length);
await clickWorld(-6, -15);
const wallAfter = await editor.page.evaluate(() => window.__editor.doc.wall.styles.map((st) => st.at));
claim(wallAfter.length === wallBefore + 1, `clicking the wall adds a change of stone (${wallBefore} to ${wallAfter.length})`);
claim(wallAfter.some((a) => Math.abs(a - 9) < 2), `and it lands where the click was, at ${wallAfter.map((a) => a.toFixed(0)).join(', ')} along the run`);
await clickWorld(-6, -15);
claim(
  (await editor.page.evaluate(() => window.__editor.doc.wall.styles.length)) === wallBefore,
  'and clicking it again takes it out',
);

// THE PLACEMENT INDICATOR. Green where a headstone may go, red where it may
// not, and the drop refused when it is red.
claim(await clickEntry('celtic'), 'a headstone is an entry in the same list');
const verdicts = await editor.page.evaluate(() => ({
  open: window.__editor.preview(6, 6),
  fence: window.__editor.preview(3, -7),
  path: window.__editor.preview(0, 0),
  out: window.__editor.preview(14.9, 14.9),
}));
claim(verdicts.open.ok, 'the indicator is green on open ground');
claim(!verdicts.fence.ok && /fence/.test(verdicts.fence.why), `red in a fence: ${verdicts.fence.why}`);
claim(!verdicts.path.ok && /path/.test(verdicts.path.why), `red in a path: ${verdicts.path.why}`);
claim(!verdicts.out.ok, `red outside the wall: ${verdicts.out.why}`);

const propsBefore = await editor.page.evaluate(() => window.__editor.doc.props.length);
await clickWorld(3, -7);
claim(
  (await editor.page.evaluate(() => window.__editor.doc.props.length)) === propsBefore,
  'a red drop does not happen',
);
await clickWorld(6, 6);
const placed = await editor.page.evaluate(() => window.__editor.doc.props.at(-1));
claim(
  (await editor.page.evaluate(() => window.__editor.doc.props.length)) === propsBefore + 1,
  'a green drop does',
);

// THE HANDLES. Select what was just placed and drag the ring round it.
await editor.page.evaluate((id) => { window.__editor.setTool('select'); window.__editor.select(id); }, placed.id);
const gz = await editor.page.evaluate(() => window.__editor.gizmo());
claim(!!gz && gz.ring > gz.move, 'a selected thing has a move disc and a turn ring');
if (gz) {
  const yaw0 = await editor.page.evaluate((id) => window.__editor.doc.props.find((p) => p.id === id).yaw, placed.id);
  const knob = await editor.page.evaluate(([x, z]) => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    const s = window.__editor.scene.toScreen(x, z);
    return [r.left + s.x, r.top + s.y];
  }, [gz.x + Math.sin(gz.yaw) * gz.ring, gz.z + Math.cos(gz.yaw) * gz.ring]);
  const across = await editor.page.evaluate(([x, z]) => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    const s = window.__editor.scene.toScreen(x, z);
    return [r.left + s.x, r.top + s.y];
  }, [gz.x + Math.cos(gz.yaw) * gz.ring, gz.z - Math.sin(gz.yaw) * gz.ring]);
  await editor.page.mouse.move(knob[0], knob[1]);
  await editor.page.mouse.down();
  await editor.page.mouse.move(across[0], across[1], { steps: 6 });
  await editor.page.mouse.up();
  const yaw1 = await editor.page.evaluate((id) => window.__editor.doc.props.find((p) => p.id === id).yaw, placed.id);
  claim(Math.abs(yaw1 - yaw0) > 0.3, `dragging the ring turns it, by ${(((yaw1 - yaw0) * 180) / Math.PI).toFixed(0)} degrees`);

  const centre = await editor.page.evaluate(([x, z]) => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    const s = window.__editor.scene.toScreen(x, z);
    return [r.left + s.x, r.top + s.y];
  }, [gz.x, gz.z]);
  await editor.page.mouse.move(centre[0], centre[1]);
  await editor.page.mouse.down();
  await editor.page.mouse.move(centre[0] + 40, centre[1], { steps: 6 });
  await editor.page.mouse.up();
  const moved = await editor.page.evaluate((id) => window.__editor.doc.props.find((p) => p.id === id), placed.id);
  claim(Math.hypot(moved.x - placed.x, moved.z - placed.z) > 0.5, 'dragging the middle moves it');
}

// Put the level back to the one that gets saved and played.
await editor.page.evaluate((doc) => window.__editor.load(doc), demo);
await editor.page.evaluate(() => {
  const rows = [...document.querySelectorAll('#right .row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent === 'starts in');
  const sel = row?.querySelector('select');
  if (sel) { sel.value = 'iron'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  const b = [...document.querySelectorAll('#right button')].find((n) => /add a change of stone/.test(n.textContent));
  b?.click();
});

// The slow half is debounced, and saving is what waits for it.
await editor.page.waitForTimeout(2500);

const before = await editor.page.evaluate(() => ({
  variant: window.__editor.doc.wall.variant,
  styles: window.__editor.doc.wall.styles.length,
  props: window.__editor.doc.props.length,
}));
claim(before.variant === 'iron', `the wall's stone can be changed from the panel: it is ${before.variant}`);
claim(before.styles === 3, `the wall carries ${before.styles} changes of stone`);

const download = editor.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await editor.page.evaluate(() => {
  [...document.querySelectorAll('#right button')].find((n) => n.textContent === 'save json')?.click();
});
const file = await download;
claim(!!file, 'clicking save produces a download');
claim(!dialog, `a clean level saves without a warning${dialog ? `, but said: ${dialog}` : ''}`);
if (file) await file.saveAs(saved);

await editor.page.evaluate(() => window.__editor.scene.pause(true));
await editor.page.waitForTimeout(300);
await writeFile(path.join(outDir, 'authored.png'), await editor.page.screenshot({ timeout: 180000 }));

// --- 3, while the editor is still open: the level that must not save ----------

dialog = null;
await editor.page.evaluate((doc) => {
  // A fence across the corner and nothing else. It is an OPEN run, so it wants
  // no gate and the fast half is happy with it; what it makes is a pocket the
  // ghost can vault into and no skeleton can walk to.
  const broken = JSON.parse(JSON.stringify(doc));
  broken.fences.push({ id: 'corner', closed: false, gates: [], points: [[-15, -8], [-8, -15]] });
  window.__editor.load(broken);
}, demo);
await editor.page.waitForTimeout(2500);

const seen = await editor.page.evaluate(() => ({
  fast: window.__editor.report.errors.length,
  warn: window.__editor.report.warnings.length,
}));
claim(seen.fast === 0, `the fast half sees no error in a fenced corner (${seen.fast})`);

const refused = editor.page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await editor.page.evaluate(() => {
  [...document.querySelectorAll('#right button')].find((n) => n.textContent === 'save json')?.click();
});
const leaked = await refused;
claim(!leaked, 'a level with a wedge in it does not save');
claim(/wedge|sealed|F3/.test(dialog || ''), `the refusal says why: ${(dialog || 'nothing was said').split('\n').slice(0, 3).join(' / ')}`);

await editor.close();

// --- 2: play the saved file ---------------------------------------------------

const game = await openLab({
  width, height, entry: '/lab/',
  query: `game=1&test=1&level=/levels/loop-check.json&view=${args.view || 11}`,
  readyFlag: '__gameReady', verbose: !!args.verbose,
});
await game.page.evaluate((o) => window.__game.setSize(o.w, o.h), { w: width, h: height });

const playing = await game.page.evaluate(() => ({
  level: window.__game.level(),
  variant: window.__game.layout.doc.wall.variant,
  styles: window.__game.layout.doc.wall.styles.length,
  props: window.__game.layout.props().length,
  flies: window.__game.layout.fireflies().length,
  spacing: +window.__game.layout._derived.flies.spacing.toFixed(1),
  gates: window.__game.layout.gates().length,
  pending: window.__perf.pending(),
  templates: window.__perf.templates(),
  buildMs: Math.round(window.__perf.buildMs()),
}));
console.log('   ', JSON.stringify(playing));
claim(!!playing.level, 'the game is playing a level from a file');
claim(playing.variant === 'iron', `the change made in the editor is in the game: the wall is ${playing.variant}`);
claim(playing.styles === 3, `and it carries the ${playing.styles} changes of stone that were authored`);
claim(playing.pending === 0, 'every prop template was baked before the first frame');
claim(playing.flies === 5, `five fireflies, ${playing.spacing} apart at the closest`);

// A few seconds of real play, so this is a game and not a still.
// Sixty steps at a thirtieth rather than a hundred and twenty at a sixtieth:
// the same two seconds of rules, half as many renders. On a software
// rasteriser under load a frame is seconds, and this is the part of the run
// that takes the longest by a wide margin.
for (let i = 0; i < 60; i++) {
  await game.page.evaluate(() => window.__game.step(1 / 30, { x: 0.85, y: -0.25 }));
}
const state = await game.page.evaluate(() => {
  const s = window.__game.state();
  return {
    t: +s.time.toFixed(2), phase: s.phase, lives: s.lives, score: s.score,
    left: s.fireflies.remaining, of: s.fireflies.total,
    ghost: [+s.ghost.x.toFixed(2), +s.ghost.z.toFixed(2)],
    sk: s.skeletons.map((k) => `${k.name}:${k.state}`),
  };
});
console.log('   ', JSON.stringify(state));
claim(state.phase === 'play' && state.t > 1.9, `the rules ran for ${state.t}s and the level is in phase ${state.phase}`);

await writeFile(path.join(outDir, 'in-game.png'), await game.page.screenshot({ timeout: 180000 }));
await game.close();

if (!args.keep) await rm(saved, { force: true });

console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe loop closes');
process.exit(fails.length ? 1 : 0);
