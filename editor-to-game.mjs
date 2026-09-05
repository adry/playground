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

// The wall's stone, through the panel. Finding the control by its label rather
// than by position is the point: a select found by index would keep passing
// after somebody moved it.
const changed = await editor.page.evaluate(() => {
  const rows = [...document.querySelectorAll('#right .row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent === 'stone');
  const sel = row?.querySelector('select');
  if (!sel) return null;
  sel.value = 'iron';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return sel.value;
});
claim(changed === 'iron', 'the wall\'s stone can be changed from the panel');

// And one more change of stone along the run, through its own button.
await editor.page.evaluate(() => {
  const b = [...document.querySelectorAll('#right button')]
    .find((n) => /add a change of stone/.test(n.textContent));
  b?.click();
});

// The slow half is debounced, and saving is what waits for it.
await editor.page.waitForTimeout(2500);

const before = await editor.page.evaluate(() => ({
  variant: window.__editor.doc.wall.variant,
  styles: window.__editor.doc.wall.styles.length,
  props: window.__editor.doc.props.length,
}));
claim(before.variant === 'iron', `the document says the wall is ${before.variant}`);
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
for (let i = 0; i < 120; i++) {
  await game.page.evaluate(() => window.__game.step(1 / 60, { x: 0.85, y: -0.25 }));
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
