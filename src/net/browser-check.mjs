// THE WHOLE THING, IN A REAL BROWSER, AGAINST A FAKE SUPABASE.
//
//   node src/net/browser-check.mjs
//
// net-check.mjs proves the requests and the parsing in node. This proves what
// node cannot: that a person can sign in, keep their levels, make one public
// and play it, in a page, over a real network stack, with a real auth library
// storing a real session; and that with nothing at the other end the editor and
// the game are exactly the tools they were before any of this existed.
//
// THE THINGS IT IS HERE FOR are the ones that only fail in a browser:
//
//   the access token, not the publishable key, as the bearer on a write
//   a session that survives a reload
//   the Google authorize URL, which is the one step that cannot be finished
//     here and so is asserted rather than followed
//   CORS: a preflight before every write, and Content-Range exposed, without
//     which the placing on the board silently never appears
//   private by default, seen from a stranger's browser rather than asserted
//
// The dev server is started here, and the client is pointed at the fake in
// fake-postgrest.mjs, which enforces the policies in 002-accounts.sql.

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeFake, listen, KEY } from './fake-postgrest.mjs';

// A FREE PORT, ASKED FOR RATHER THAN ASSUMED. A fixed port is a fixed way for
// this check to quietly test the wrong thing: a dev server somebody left
// running answers, the one started here fails to bind, and every page loaded
// below comes from a tree that is not the one being checked.
function freePort() {
  const s = net.createServer();
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}
const PORT = await freePort();
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

function waitForPort(port, tries = 240) {
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

// The level the site ships, used as the editor's document so that saving meets
// a level that PASSES the guard. A guard that fires is checked separately, and
// it is the more important of the two.
const DEMO = JSON.parse(fs.readFileSync(new URL('../../public/levels/demo.json', import.meta.url), 'utf8'));

const AUTOSAVE = 'graveyard-editor/doc/v1';
const NAME_KEY = 'graveyard.name.v1';
const BOUND_KEY = 'graveyard.editor.online.v1';

const fake = makeFake();
const fakePort = await listen(fake.server);
const BOARD = `http://127.0.0.1:${fakePort}`;

// A FROZEN COPY OF THE PROJECT, and it is not fussiness.
//
// This check drives a dev server, and a dev server reloads every open page the
// instant a source file changes. Several people work in this repository at
// once, so a run against the working tree is a run whose pages navigate out
// from under it halfway through: fetches abort, the card the board was attached
// to stops existing, and the failure looks like a bug in the board rather than
// like somebody two directories away pressing save.
//
// So the project is copied first and the server runs on the copy. node_modules
// is symlinked rather than copied, because it is large and nobody edits it.
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const SNAP = fs.mkdtempSync(path.join(os.tmpdir(), 'graveyard-check-'));
fs.cpSync(ROOT, SNAP, {
  recursive: true,
  filter: (src) => !/^\/(node_modules|\.git|dist|\.scratch)(\/|$)/.test(src.slice(ROOT.length) || '/'),
});
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SNAP, 'node_modules'));

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: SNAP,
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group, so killing it at the end kills the vite underneath
  // npx as well. Without this the dev server outlives the check and the next
  // run of it cannot bind the port.
  detached: true,
});
let viteFailed = null;
vite.stdout.on('data', () => {});
vite.stderr.on('data', (d) => {
  const text = String(d);
  if (/already in use|EADDRINUSE/.test(text)) viteFailed = text.trim();
  process.stderr.write(d);
});
vite.on('exit', (code) => { if (code) viteFailed = viteFailed || `the dev server exited with ${code}`; });

let browser = null;
try {
  await waitForPort(PORT);
  if (viteFailed) throw new Error(`the dev server did not start: ${viteFailed}`);
  // --no-proxy-server, because this machine has an outbound proxy configured
  // and every request here is to a loopback address.
  browser = await chromium.launch({ args: ['--no-proxy-server'] });

  // A context with the client pointed somewhere and the editor holding a
  // document. Every navigation waits for the DOM rather than for `load`: the
  // editor builds a few hundred meshes and a palette of rendered thumbnails on
  // a software renderer, and `load` does not fire until it has.
  async function open({ board, name = null, doc = DEMO, bound = null }) {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const errors = [];
    await context.addInitScript(({ b, n, d, keys, slug }) => {
      window.GRAVEYARD_SUPABASE = { url: b, key: 'sb_publishable_TESTKEY' };
      try {
        if (d) localStorage.setItem(keys.autosave, JSON.stringify(d));
        if (n) localStorage.setItem(keys.name, n);
        if (slug) localStorage.setItem(keys.bound, slug);
      } catch { /* nothing to do about it */ }
    }, { b: board, n: name, d: doc, slug: bound, keys: { autosave: AUTOSAVE, name: NAME_KEY, bound: BOUND_KEY } });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(180000);
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx: context, page, errors };
  }

  const EMAIL = 'ada@example.com';
  const PASSWORD = 'a-long-enough-password';

  // Signs in through the panel, the way a person does.
  async function signIn(page, { create = true } = {}) {
    await page.click('button:text-is("my levels")');
    await page.waitForSelector('.go input[type="email"]');
    await page.fill('.go input[type="email"]', EMAIL);
    await page.fill('.go input[type="password"]', PASSWORD);
    await page.click(`.go button:text-is("${create ? 'create account' : 'sign in'}")`);
    await page.waitForSelector('.go button:text-is("sign out")');
  }

  let publicUrl = null;
  let publicSlug = null;

  // --- signing in, and saving a level ------------------------------------------
  console.log('\nan account, and a level in it');
  {
    const { ctx, page, errors } = await open({ board: BOARD, name: 'Ada' });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`${ORIGIN}/editor/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("save online")');

    // The editor is a tool before it is an account.
    ok(await page.isVisible('#view'), 'the editor opens without anybody signing in');
    ok(await page.isVisible('button:text-is("save")'), 'and the file save is there, as it always was');
    ok(await page.isVisible('button:text-is("download a copy")'), 'and so is the download');

    await signIn(page);
    eq(fake.users.size, 1, 'creating an account makes one');
    const authReq = fake.seen.filter((r) => r.path.startsWith('/auth/v1/'));
    ok(authReq.some((r) => r.path.includes('signup')), 'over /auth/v1/signup');
    eq(authReq[0].headers.apikey, KEY, 'with the publishable key in the apikey header');

    await page.click('.go button:text-is("save to my account")');
    await page.waitForFunction(() => /saved to your account/.test(document.querySelector('.go p.ok')?.textContent || ''));

    eq(dialogs.length, 0, 'a level that passes the guard is not questioned');
    eq(fake.levels.length, 1, 'one row landed in levels');
    const row = fake.levels[0];
    const uid = [...fake.users.values()][0].id;

    // THE HEADER THAT DECIDES EVERYTHING.
    const write = fake.seen.filter((r) => r.method === 'POST' && r.path === '/rest/v1/levels').pop();
    eq(write.headers.apikey, KEY, 'the publishable key stays in the apikey header');
    ok(write.headers.authorization.startsWith('Bearer eyJ'), 'and the bearer is the access token', write.headers.authorization.slice(0, 20));
    ok(write.headers.authorization !== `Bearer ${KEY}`, 'never the publishable key, which would make the write anonymous');
    eq(write.uid, uid, 'so the database reads auth.uid() as the person who signed in');
    eq(write.body.owner, uid, 'and the row is owned by them');
    eq(write.body.is_public, false, 'PRIVATE, because a saved level is not a published one');
    eq(row.is_public, false, 'which is what landed');
    eq(row.name, DEMO.name, "the level's own name is the row's name");
    eq(JSON.stringify(row.doc), JSON.stringify(DEMO), 'and the document went whole');

    // Every write is cross origin, so a preflight had to be answered first.
    const pre = fake.seen.filter((r) => r.method === 'OPTIONS');
    ok(pre.length > 0, 'the browser preflighted the write, which is what CORS on the project has to allow', `${pre.length} preflights`);

    // Saving again updates rather than duplicating.
    await page.click('.go button:text-is("save changes")');
    await page.waitForFunction(() => /saved/.test(document.querySelector('.go p.ok')?.textContent || ''));
    eq(fake.levels.length, 1, 'saving again updates the level rather than making a second one');
    ok(fake.seen.some((r) => r.method === 'PATCH'), 'with a PATCH');

    // --- making it public ------------------------------------------------------
    console.log('\nthe choice to make it public');
    await page.click('.go button:text-is("make public")');
    await page.waitForSelector('.go input.link');
    publicUrl = await page.inputValue('.go input.link');
    publicSlug = row.slug;
    ok(fake.levels[0].is_public === true, 'the row is public now');
    eq(publicUrl, `${ORIGIN}/lab/?game=1&level=${row.slug}`, 'and the link plays it directly');

    await page.click('.go input.link + button');
    await page.waitForFunction(() => /copied/.test([...document.querySelectorAll('.go button')].map((b) => b.textContent).join(' ')));
    eq(await page.evaluate(() => navigator.clipboard.readText()), publicUrl, 'one click puts the link on the clipboard');

    // --- the list ---------------------------------------------------------------
    console.log('\nmy levels');
    ok(await page.isVisible('.go ul.levels li'), 'the account lists the levels in it');
    eq(await page.textContent('.go ul.levels li .dot'), 'public', 'and says which are public');

    await page.click('.go ul.levels li button:text-is("rename")');
    await page.waitForTimeout(400);
    ok(dialogs.some((d) => /new name/.test(d)), 'rename asks for one');

    await page.keyboard.press('Escape');
    eq(await page.locator('.go-back').count(), 0, 'escape closes the panel');
    ok(await page.isVisible('#view'), 'and the editor is untouched behind it');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));

    // --- the session survives a reload --------------------------------------------
    console.log('\nthe session');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("my levels")');
    await page.click('button:text-is("my levels")');
    await page.waitForSelector('.go button:text-is("sign out")');
    ok(true, 'a reload does not sign you out');
    const stored = await page.evaluate(() => localStorage.getItem('graveyard.auth.v1'));
    ok(stored && /refresh_token/.test(stored), 'because the session is in storage, with a refresh token to renew it');

    // --- Google, as far as it can be taken from here ---------------------------------
    console.log('\nsigning in with Google');
    const authorize = await page.evaluate(async () => {
      const mod = await import('/src/net/auth.js');
      return mod.signInWithGoogle({ skipRedirect: true });
    });
    ok(authorize.ok, 'the client builds the authorize URL', authorize.reason);
    const u = new URL(authorize.url);
    eq(u.pathname, '/auth/v1/authorize', 'which goes to the project, not to Google directly');
    eq(u.searchParams.get('provider'), 'google', 'naming the provider');
    eq(u.searchParams.get('redirect_to'), `${ORIGIN}/editor/`,
      'and the page to come back to, WHICH HAS TO BE IN THE PROJECT REDIRECT ALLOW LIST');
    ok(u.searchParams.get('code_challenge'), 'with a PKCE challenge, so what comes back is a code and not a token');
    eq(u.searchParams.get('code_challenge_method'), 's256', 'hashed, not plain');

    await ctx.close();
  }

  // --- private by default, seen from somebody else's browser ----------------------
  console.log('\nprivate means private');
  {
    const { ctx, page } = await open({ board: BOARD });
    await page.goto(`${ORIGIN}/lab/`, { waitUntil: 'domcontentloaded' });
    const secondSlug = await page.evaluate(async ({ email, password }) => {
      const auth = await import('/src/net/auth.js');
      const sb = await import('/src/net/supabase.js');
      sb.useTokens(auth.accessToken);
      await auth.signUpWithEmail(email, password);
      const user = await auth.currentUser();
      const res = await sb.client().publish({
        name: 'Hidden',
        doc: { format: 'graveyard-level', version: 2, name: 'Hidden', size: 30, seed: 3 },
        owner: user.id,
        isPublic: false,
      });
      return res.slug || null;
    }, { email: 'bea@example.com', password: 'another-long-password' });
    ok(secondSlug, 'a second person saves a level of their own', String(secondSlug));
    await ctx.close();

    const { ctx: ctx2, page: p2 } = await open({ board: BOARD });
    await p2.goto(`${ORIGIN}/lab/?game=1&level=${secondSlug}`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('.card h1');
    eq(await p2.textContent('.card h1'), 'NO LEVEL', 'and nobody else can play it');
    ok(/not public/.test(await p2.textContent('.card .story')), 'the page says why, without saying whether it exists');
    await ctx2.close();
  }

  // --- and a public one plays ------------------------------------------------------
  console.log('\nthe game, playing a public level by its code');
  {
    const { ctx, page, errors } = await open({ board: BOARD });
    await page.goto(publicUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__game.level());
    const level = await page.evaluate(() => window.__game.level());
    eq(level.name, DEMO.name, 'the game loaded the published level');
    eq(level.url, publicSlug, 'from its code and not from a file');
    eq(level.size, DEMO.size, 'and it is the same arena');
    const read = fake.seen.filter((r) => r.method === 'GET' && r.path.startsWith('/rest/v1/levels?slug=')).pop();
    eq(read.headers.authorization, `Bearer ${KEY}`, 'read anonymously, because a player needs no account');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));
    await ctx.close();
  }

  // --- the guard ---------------------------------------------------------------------
  console.log('\nthe guard, on a level nobody could finish');
  {
    const broken = JSON.parse(JSON.stringify(DEMO));
    broken.props = [];
    broken.fireflies = { ...(broken.fireflies || {}), count: 0 };
    const { ctx, page } = await open({ board: BOARD, doc: broken });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto(`${ORIGIN}/editor/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:text-is("save online")');
    await signIn(page, { create: false });
    const before = fake.levels.length;
    await page.click('.go button:text-is("save to my account")');
    await page.waitForTimeout(2500);
    eq(dialogs.length, 1, 'saving an unplayable level online asks first', dialogs.join(' | '));
    ok(/not playable/i.test(dialogs[0] || ''), 'and says what is wrong with it', dialogs[0]);
    eq(fake.levels.length, before, 'and saying no saves nothing');
    await ctx.close();
  }

  // --- the board on the end card --------------------------------------------------
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
      return { sync: card.querySelector('.gb') !== null };
    }, { slug: publicSlug });
    ok(mounted.sync, 'the board is on the card the moment attach returns');

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.gb-rows li');
      return rows.length > 0 && !/reading the board/.test(rows[0].textContent);
    });

    const shown = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.gb-rows li')].map((li) => li.textContent),
      mine: [...document.querySelectorAll('.gb-rows li.mine')].map((li) => li.textContent),
      tabs: [...document.querySelectorAll('.gb-tabs button')].map((b) => b.textContent),
      note: document.querySelector('.gb-note').textContent,
    }));
    eq(shown.tabs.join(','), 'this graveyard,everyone', 'a run on a published level gets both boards');
    ok(shown.rows.length >= 1, 'and the level board has the row that was just posted', JSON.stringify(shown.rows));
    eq(shown.mine.length, 1, "the player's own row is the marked one");
    ok(/Ada/.test(shown.mine[0] || ''), 'and it is theirs', shown.mine[0]);
    eq(shown.note, '', 'nothing to apologise for');

    const posted = fake.scores[fake.scores.length - 1];
    eq(posted.name, 'Ada', 'the score went in under the remembered name');
    eq(posted.level_slug, publicSlug, 'and the level it was set on');
    const scoreReq = fake.seen.filter((r) => r.method === 'POST' && r.path === '/rest/v1/scores').pop();
    eq(scoreReq.headers.authorization, `Bearer ${KEY}`, 'posted as a guest, because the game asks nobody to sign in');
    ok(!('owner' in scoreReq.body), 'and with no owner column, so it works before 002 as well as after');

    // The placing, which is the part CORS can silently break.
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
    });
    const placing = await page.evaluate(() => ({
      text: document.querySelector('.gb-rows li.mine').textContent,
      count: document.querySelectorAll('.gb-rows li').length,
    }));
    ok(/^13/.test(placing.text), 'a score outside the ten is shown with its own placing', placing.text);
    eq(placing.count, 11, 'ten rows and the player, which needs Content-Range to survive the cross origin trip');
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
    await page.waitForSelector('.gb-name input');
    const before = fake.scores.length;
    ok(/only in this browser/.test(await page.textContent('.gb-note')), 'with no name stored the card asks for one, and says why');
    eq(fake.scores.length, before, 'and posts nothing until it has one');

    await page.fill('.gb-name input', '  Bea  ');
    await page.click('.gb-name button');
    await page.waitForFunction(() => document.querySelectorAll('.gb-rows li.mine').length > 0);
    eq(fake.scores.length, before + 1, 'giving a name posts the score');
    eq(fake.scores[fake.scores.length - 1].name, 'Bea', 'trimmed');
    eq(await page.evaluate(() => localStorage.getItem('graveyard.name.v1')), 'Bea', 'and remembered, so it is asked once');
    eq(await page.locator('.gb-name').count(), 0, 'the field goes away once it has been answered');
    await ctx.close();
  }

  // --- nothing at the other end ------------------------------------------------------
  console.log('\nthe game, with no network at all');
  {
    const { ctx, page, errors } = await open({ board: DEAD, name: 'Ada' });
    await page.goto(`${ORIGIN}/lab/?game=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__game.state());
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
    await page.waitForFunction(() => /not on the board/.test(document.querySelector('.gb-note')?.textContent || ''));
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
    await page.waitForSelector('button:text-is("save online")');
    ok(await page.isVisible('#view'), 'the editor opens');

    await page.click('button:text-is("my levels")');
    await page.waitForSelector('.go input[type="email"]');
    await page.fill('.go input[type="email"]', EMAIL);
    await page.fill('.go input[type="password"]', PASSWORD);
    await page.click('.go button:text-is("sign in")');
    await page.waitForFunction(() => /connection|not work|fetch|network/i.test(document.querySelector('.go p.bad')?.textContent || ''));
    ok(true, 'signing in says it cannot rather than hanging');

    await page.keyboard.press('Escape');
    await page.click('button:text-is("download a copy")');
    await page.waitForTimeout(500);
    ok(await page.isVisible('#view'), 'and the editor is the tool it always was: a file still saves');
    ok(await page.isVisible('button:text-is("play this")'), 'and play is still there');
    eq(errors.length, 0, 'no page errors', errors.join('\n'));
    await ctx.close();
  }

  console.log('\na level code, with no network');
  {
    const { ctx, page } = await open({ board: DEAD });
    await page.goto(`${ORIGIN}/lab/?game=1&level=abc123def4`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card h1');
    eq(await page.textContent('.card h1'), 'NO LEVEL', 'a code that cannot be reached says so');
    ok(/no connection/.test(await page.textContent('.card .story')), 'and why');
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill('SIGTERM'); }
  fake.server.close();
  try { fs.rmSync(SNAP, { recursive: true, force: true }); } catch { /* it is in the temp directory */ }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
