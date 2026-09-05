// THE SAME CLIENT, IN A REAL BROWSER, AGAINST A REAL SERVER.
//
//   node src/net/browser-check.mjs
//
// net-check.mjs proves the requests and the parsing in node. This proves the
// two things node cannot: that the editor's publish button and the game's end
// card actually work in a page, and that they still work with nothing at the
// other end. It drives chromium over the dev server, with the client pointed at
// the fake PostgREST in fake-postgrest.mjs.
//
// What it is really for is the cross origin half. A browser talking to Supabase
// is talking to another origin, which means a preflight before every insert and
// no access to a response header that is not explicitly exposed. Neither of
// those can be seen from node, both of them are settings on somebody else's
// project, and the way the board fails without them is quiet: the placing line
// simply never appears. So the fake answers CORS the way the gateway does and
// this file walks the whole path through a browser that enforces it.

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { makeFake, listen, KEY } from './fake-postgrest.mjs';

const PORT = 5191;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DEAD = 'http://127.0.0.1:9';

let failures = 0;
let checks = 0;
function ok(cond, what, detail = '') {
  checks++;
  if (cond) return true;
  failures++;
  console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ''}`);
  return false;
}
function eq(a, b, what) {
  return ok(a === b, what, a === b ? '' : `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
}

function waitForPort(port, tries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.end(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (n <= 0) reject(new Error(`nothing came up on ${port}`));
        else setTimeout(() => attempt(n - 1), 250);
      });
    };
    attempt(tries);
  });
}

// The level the site ships, used as the editor's document so that the publish
// button meets a level that PASSES the guard. A guard that fires is tested
// separately, below, and it is the more important of the two.
const DEMO = JSON.parse(fs.readFileSync(new URL('../../public/levels/demo.json', import.meta.url), 'utf8'));

const AUTOSAVE = 'graveyard-editor/doc/v1';
const NAME_KEY = 'graveyard.name.v1';

const fake = makeFake();
const fakePort = await listen(fake.server);
const BOARD = `http://127.0.0.1:${fakePort}`;

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: new URL('../..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group, so killing it at the end kills the vite underneath
  // npx as well. Without this the dev server outlives the check and the next
  // run of it cannot bind the port.
  detached: true,
});
vite.stdout.on('data', () => {});
vite.stderr.on('data', (d) => process.stderr.write(d));

let browser = null;
try {
  await waitForPort(PORT);
  // WARM IT UP FIRST. A cold vite transforms several hundred modules on the
  // first request for a page, which is well past any sensible navigation
  // timeout in a browser. Asking for both pages over plain fetch costs one
  // round trip here and takes the whole of that cost out of the checks below.
  for (const path of ['/editor/', '/lab/?game=1']) {
    await fetch(`${ORIGIN}${path}`).then((r) => r.text()).catch(() => {});
  }
  // --no-proxy-server, because this machine has an outbound proxy configured
  // and every request here is to a loopback address.
  browser = await chromium.launch({ args: ['--no-proxy-server'] });

  // A page with the client pointed somewhere, the editor holding a document,
  // and optionally a name already remembered.
  async function open({ board, name = null, doc = DEMO }) {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const errors = [];
    await ctx.addInitScript(({ b, n, d, autosave, nameKey }) => {
      window.GRAVEYARD_SUPABASE = { url: b, key: 'sb_publishable_TESTKEY' };
      try {
        if (d) localStorage.setItem(autosave, JSON.stringify(d));
        if (n) localStorage.setItem(nameKey, n);
        else localStorage.removeItem(nameKey);
      } catch { /* nothing to do about it */ }
    }, { b: board, n: name, d: doc, autosave: AUTOSAVE, nameKey: NAME_KEY });
    const page = await ctx.newPage();
    // Generous, and deliberately so: this page builds a graveyard out of a few
    // hundred meshes on a software renderer.
    // Generous everywhere. The editor holding a full graveyard builds a few
    // hundred meshes and a palette of rendered thumbnails on a software
    // renderer, and `load` does not fire until it has: every navigation below
    // waits for DOM instead and then for the one thing it actually needs.
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, errors };
  }

  // --- publishing, from the editor -------------------------------------------
  console.log('\nthe editor, publishing a level');
  {
    const { ctx, page, errors } = await open({ board: BOARD, name: 'Ada' });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`${ORIGIN}/editor/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("publish")');

    await page.click('button:text-is("publish")');
    await page.waitForSelector('.gp-back input');
    const url = await page.inputValue('.gp-back input');

    eq(dialogs.length, 0, 'a level that passes the guard is not questioned');
    eq(fake.levels.length, 1, 'one row landed in levels');
    const row = fake.levels[0];
    ok(/^\/lab\/\?game=1&level=[a-z0-9]{6,16}$/.test(url.replace(ORIGIN, '')),
      'the URL it hands back plays the level directly', url);
    ok(url.endsWith(row.slug), 'and carries the code of the row that landed');
    eq(row.author, 'Ada', 'the name it was asked for once is the author');
    eq(row.name, DEMO.name, "the level's own name is the row's name");
    eq(JSON.stringify(row.doc), JSON.stringify(DEMO), 'and the document went whole, not a summary of it');

    // One click, because nobody transcribes a URL by hand.
    await page.click('.gp-back button.go');
    await page.waitForFunction(() => document.querySelector('.gp-back button.go').textContent === 'copied', null, );
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    eq(clip, url, 'the copy button puts the URL on the clipboard');

    // And the editor is still the editor.
    await page.keyboard.press('Escape');
    eq(await page.locator('.gp-back').count(), 0, 'escape closes the panel');
    ok(await page.isVisible('#view'), 'and the editor is untouched behind it');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));

    // --- and the game plays it -------------------------------------------------
    console.log('\nthe game, playing a published level by its code');
    const { ctx: ctx2, page: p2, errors: e2 } = await open({ board: BOARD });
    await p2.goto(`${ORIGIN}${url.replace(ORIGIN, '')}`, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.__game && window.__game.level(), null, );
    const level = await p2.evaluate(() => window.__game.level());
    eq(level.name, DEMO.name, 'the game loaded the published level');
    eq(level.url, row.slug, 'from its code and not from a file');
    eq(level.size, DEMO.size, 'and it is the same arena');
    eq(e2.length, 0, 'no page errors', e2.join('\n'));
    const asked = fake.seen.filter((r) => r.method === 'GET' && r.path.startsWith('/rest/v1/levels'));
    ok(asked.length >= 1, 'it asked the database for it');
    eq(asked[asked.length - 1].headers.apikey, KEY, 'with the key in the apikey header, from a browser');
    await ctx2.close();
    await ctx.close();
  }

  // --- the guard --------------------------------------------------------------
  console.log('\nthe guard, on a level nobody could finish');
  {
    // A level with no fireflies and no way to spend a life is exactly what the
    // guard exists for. Publishing has to ask before it goes out to somebody who
    // has no editor to see the fault in.
    const broken = JSON.parse(JSON.stringify(DEMO));
    broken.props = [];
    broken.fireflies = { ...(broken.fireflies || {}), count: 0 };
    const { ctx, page } = await open({ board: BOARD, name: 'Ada', doc: broken });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto(`${ORIGIN}/editor/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("publish")');
    const before = fake.levels.length;
    await page.click('button:text-is("publish")');
    await page.waitForTimeout(1500);
    ok(dialogs.length === 1, 'publishing an unplayable level asks first', dialogs.join(' | '));
    ok(/not playable/i.test(dialogs[0] || ''), 'and says what is wrong with it', dialogs[0]);
    eq(fake.levels.length, before, 'and saying no publishes nothing');
    await ctx.close();
  }

  // --- the board on the end card ------------------------------------------------
  console.log('\nthe board, in a page, cross origin');
  {
    const { ctx, page, errors } = await open({ board: BOARD, name: 'Ada' });
    await page.goto(`${ORIGIN}/lab/`, { waitUntil: 'domcontentloaded' });

    // The end card, built the way scene.js builds it, and the board attached to
    // it the way scene.js attaches it. Driving a real game to a real death
    // would prove the same thing an hour more slowly.
    const mounted = await page.evaluate(async ({ slug }) => {
      const mod = await import('/src/net/leaderboard.js');
      const card = document.createElement('div');
      card.className = 'card';
      const share = document.createElement('a');
      share.className = 'share';
      share.textContent = 'Post it on X';
      card.appendChild(share);
      document.body.appendChild(card);
      mod.attach(card, { run: { score: 14200, fireflies: 31, seconds: 214 }, levelSlug: slug });
      // The board returns at once. That is the point of it.
      return { sync: card.querySelector('.gb') !== null };
    }, { slug: fake.levels[0].slug });
    ok(mounted.sync, 'the board is on the card the moment attach returns');

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.gb-rows li');
      return rows.length > 0 && !/reading the board/.test(rows[0].textContent);
    }, null, );

    const shown = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.gb-rows li')].map((li) => li.textContent),
      mine: [...document.querySelectorAll('.gb-rows li.mine')].map((li) => li.textContent),
      tabs: [...document.querySelectorAll('.gb-tabs button')].map((b) => b.textContent),
      note: document.querySelector('.gb-note').textContent,
    }));
    ok(shown.tabs.join(',') === 'this graveyard,everyone', 'a run on a published level gets both boards', shown.tabs.join(','));
    ok(shown.rows.length >= 1, 'and the level board has the row that was just posted', JSON.stringify(shown.rows));
    ok(shown.mine.length === 1, "the player's own row is the marked one", JSON.stringify(shown.mine));
    ok(/Ada/.test(shown.mine[0] || ''), 'and it is theirs', shown.mine[0]);
    eq(shown.note, '', 'nothing to apologise for');

    const posted = fake.scores[fake.scores.length - 1];
    eq(posted.name, 'Ada', 'the score went in under the remembered name');
    eq(posted.score, 14200, 'with the score');
    eq(posted.level_slug, fake.levels[0].slug, 'and the level it was set on');

    // The global board, and the placing for a score that is not in its top ten.
    for (let i = 0; i < 12; i++) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(async ({ n }) => {
        const { client } = await import('/src/net/supabase.js');
        await client().postScore({ name: `Rival ${n}`, score: 900000 - n, fireflies: 10, seconds: 600 });
      }, { n: i });
    }
    await page.click('.gb-tabs button:text-is("everyone")');
    await page.waitForFunction(() => {
      const li = document.querySelector('.gb-rows li.mine');
      return li && /14,200/.test(li.textContent);
    }, null, );
    const placing = await page.evaluate(() => {
      const li = document.querySelector('.gb-rows li.mine');
      return { text: li.textContent, count: document.querySelectorAll('.gb-rows li').length };
    });
    ok(/^13/.test(placing.text), 'a score outside the ten is shown with its own placing', placing.text);
    eq(placing.count, 11, 'ten rows and the player, which is the whole point of the line');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));
    await ctx.close();
  }

  // --- somebody who has not said who they are --------------------------------------
  console.log('\nthe name, asked for once');
  {
    const { ctx, page } = await open({ board: BOARD, name: null });
    await page.goto(`${ORIGIN}/lab/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const mod = await import('/src/net/leaderboard.js');
      const card = document.createElement('div');
      card.className = 'card';
      document.body.appendChild(card);
      mod.attach(card, { run: { score: 5000, fireflies: 8, seconds: 120 }, levelSlug: null });
    });
    await page.waitForSelector('.gb-name input', );
    ok(await page.isVisible('.gb-name input'), 'with no name stored the card asks for one');
    const before = fake.scores.length;
    ok(/only in this browser/.test(await page.textContent('.gb-note')), 'and says why it matters');
    eq(fake.scores.length, before, 'and posts nothing until it has one');

    await page.fill('.gb-name input', '  Bea  ');
    await page.click('.gb-name button');
    await page.waitForFunction((n) => document.querySelectorAll('.gb-rows li.mine').length > 0, null, );
    eq(fake.scores.length, before + 1, 'giving a name posts the score');
    eq(fake.scores[fake.scores.length - 1].name, 'Bea', 'trimmed');
    eq(await page.evaluate(() => localStorage.getItem('graveyard.name.v1')), 'Bea', 'and remembered, so it is asked once');
    eq(await page.locator('.gb-name').count(), 0, 'the field goes away once it has been answered');
    await ctx.close();
  }

  // --- nothing at the other end ------------------------------------------------------
  console.log('\nwith no network at all');
  {
    const { ctx, page, errors } = await open({ board: DEAD, name: 'Ada' });
    await page.goto(`${ORIGIN}/lab/?game=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__game.state(), null, );
    for (let i = 0; i < 30; i++) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => window.__game.step(1 / 60, { x: 1, y: 0 }));
    }
    const st = await page.evaluate(() => ({
      lives: window.__game.state().lives,
      level: window.__game.level(),
      hud: document.querySelector('.hud') ? document.querySelector('.hud').textContent : '',
    }));
    ok(st.lives > 0, 'the game runs with the board unreachable');
    ok(st.level && st.level.name, 'on the level the site ships', JSON.stringify(st.level));
    ok(st.hud.length > 0, 'and the HUD is drawing');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));

    // The end card, built against a board that is not there.
    await page.evaluate(async () => {
      const mod = await import('/src/net/leaderboard.js');
      const card = document.createElement('div');
      card.className = 'card';
      card.id = 'offline-card';
      const again = document.createElement('button');
      again.className = 'again';
      again.textContent = 'Again';
      card.appendChild(again);
      document.body.appendChild(card);
      mod.attach(card, { run: { score: 100, fireflies: 1, seconds: 30 }, levelSlug: null });
    });
    ok(await page.isVisible('#offline-card .again'), 'the card is there and Again is pressable at once');
    await page.waitForFunction(() => /not on the board/.test(document.querySelector('.gb-note').textContent), null, );
    const note = await page.textContent('.gb-note');
    ok(/no connection to the board/.test(note), 'and the player is told the score did not save', note);
    ok(await page.isVisible('.gb-note button'), 'with a way to try again');
    eq(errors.length, 0, 'still no page errors', errors.join('\n'));
    await ctx.close();
  }

  console.log('\nthe editor, with no network at all');
  {
    const { ctx, page, errors } = await open({ board: DEAD, name: 'Ada' });
    page.on('dialog', (d) => d.accept());
    await page.goto(`${ORIGIN}/editor/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("publish")');
    await page.click('button:text-is("publish")');
    await page.waitForFunction(() => /not published/.test(document.querySelector('.gp p').textContent), null, );
    const said = await page.textContent('.gp p');
    ok(/no connection to the board/.test(said), 'publishing says why it could not', said);
    ok(/save json still works/.test(said), 'and points at the door that does not need a network', said);
    await page.keyboard.press('Escape');

    // The editor is a tool the owner uses offline. It has to be exactly the
    // tool it was.
    await page.click('button:text-is("save json")');
    await page.waitForTimeout(500);
    ok(await page.isVisible('#view'), 'the editor still works');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));
    await ctx.close();
  }

  console.log('\na published code, with no network');
  {
    const { ctx, page } = await open({ board: DEAD });
    await page.goto(`${ORIGIN}/lab/?game=1&level=abc123def4`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card h1', );
    eq(await page.textContent('.card h1'), 'NO LEVEL', 'a code that cannot be reached says so');
    ok(/no connection/.test(await page.textContent('.card .story')), 'and why');
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill('SIGTERM'); }
  fake.server.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
