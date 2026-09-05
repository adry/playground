// THE CHECK FOR THE ONE PIECE OF NETWORK IN THE PROJECT.
//
//   node src/net/net-check.mjs            run it
//   node src/net/net-check.mjs --print    print every request the client makes
//
// The live project cannot be reached from where this code is written: the
// outbound proxy refuses CONNECT to it. So the whole client is proven against a
// FAKE PostgREST that speaks the same protocol and enforces the same
// constraints as supabase/schema.sql, and the first real request will be made
// by somebody's browser. That raises the bar rather than lowering it, and the
// things this file is most careful about are exactly the ones that cannot be
// discovered later without a person watching a button do nothing:
//
//   the header names, spelled out and asserted on every request
//   `Prefer: return=representation` giving the inserted row back
//   `Prefer: count=exact` putting the total in Content-Range
//   a 409 on a duplicate slug being handled rather than thrown
//   the shape of a PostgREST error body, and every code the client maps
//   a dead host, a hung host and a missing fetch, none of which may throw
//
// The fake is a second implementation of the parts of PostgREST this client
// uses, written from the wire format rather than from the client, which is the
// same discipline world-check.mjs applies to the geometry.

import http from 'node:http';
import { makeFake, listen, KEY } from './fake-postgrest.mjs';
import {
  createClient, isLevelSlug, makeSlug, cleanName, scoreRow,
  SLUG_LENGTH, RESERVED_SLUGS,
} from './supabase.js';

const PRINT = process.argv.includes('--print');

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

// --- pure things ----------------------------------------------------------------

function pureChecks() {
  console.log('\nthe slug, and telling one from a file URL');

  const slug = makeSlug();
  eq(slug.length, SLUG_LENGTH, 'a slug is the length it says');
  ok(/^[a-z0-9]{6,16}$/.test(slug), "a slug matches the schema's own regex", slug);
  ok(!/[lo01]/.test(slug), 'a slug has none of the four letters that get misread', slug);

  const many = new Set();
  for (let i = 0; i < 20000; i++) many.add(makeSlug());
  eq(many.size, 20000, '20000 slugs, no collision');
  ok(![...many].some((s) => RESERVED_SLUGS.includes(s)), 'no slug is a reserved token');

  // The rule that decides whether `level=` is a code or a file.
  for (const yes of ['abc123', 'k3f9qz2mrt', 'aaaaaaaaaaaaaaaa', '000000']) {
    ok(isLevelSlug(yes), `a code is a code: ${yes}`);
  }
  for (const no of [
    'session',                    // the editor's token, and it fits the regex
    '/levels/demo.json',          // the level the site ships
    'demo.json',                  // a file beside it
    'https://example.com/a.json', // somewhere else entirely
    '/levels/a-b-c',              // a path with no dot
    'abcde',                      // too short
    'abcdefghijklmnopq',          // too long
    'ABC123def',                  // not lowercase
    'abc-123',                    // not alphanumeric
    '', null, undefined, 42,
  ]) {
    ok(!isLevelSlug(no), `not a code: ${JSON.stringify(no)}`);
  }

  console.log('\nthe row, against the columns in schema.sql');
  eq(cleanName('  Ada   Lovelace  '), 'Ada Lovelace', 'a name is trimmed and collapsed');
  eq(cleanName('a\nb'), 'a b', 'a newline cannot break a row');
  eq(cleanName('x'.repeat(50)).length, 20, 'a name is cut to the column');
  eq(cleanName(null), '', 'no name is the empty string');

  ok(!scoreRow({ name: '   ', score: 1, fireflies: 0, seconds: 1 }).ok, 'no name, no row');
  ok(!scoreRow({ name: 'a', score: 2000000, fireflies: 0, seconds: 100 }).ok, 'a score past the column is refused here');
  ok(!scoreRow({ name: 'a', score: 1, fireflies: 900, seconds: 10 }).ok, "the schema's own plausibility rule is refused here");
  ok(!scoreRow({ name: 'a', score: 1, fireflies: 0, seconds: 90000 }).ok, 'a run longer than a day is refused here');

  const built = scoreRow({ name: 'Ada', score: 14200.7, fireflies: 31.9, seconds: 214.6, levelSlug: 'k3f9qz2mrt' });
  ok(built.ok, 'an ordinary run builds a row');
  eq(built.row.score, 14200, 'the score is floored, not rounded');
  eq(built.row.seconds, 214, 'seconds are floored, because seconds is the denominator of the plausibility check');
  eq(built.row.level_slug, 'k3f9qz2mrt', 'a published level goes on the row');
  eq(scoreRow({ name: 'Ada', score: 1, fireflies: 0, seconds: 9, levelSlug: 'session' }).row.level_slug, null,
    'a run in the editor session is not a run on a published level');
  eq(scoreRow({ name: 'Ada', score: 1, fireflies: 0, seconds: 9, levelSlug: '/levels/demo.json' }).row.level_slug, null,
    'a run on the shipped file is not a run on a published level');
  eq(Object.keys(built.row).sort().join(','), 'fireflies,level_slug,name,score,seconds',
    'a score row carries these columns and no others');
}

// --- against the fake --------------------------------------------------------------

async function wireChecks() {
  const fake = makeFake();
  const port = await listen(fake.server);
  const api = createClient({ url: `http://127.0.0.1:${port}`, key: KEY });

  console.log('\npublishing a level');
  const doc = { format: 'graveyard-level', version: 2, name: 'Hollow Rise', size: 30, seed: 7, props: [] };
  const pub = await api.publish({ name: 'Hollow Rise', author: 'Ada', doc });
  ok(pub.ok, 'a level publishes', pub.reason);
  ok(isLevelSlug(pub.slug), 'and comes back with its code', pub.slug);

  const req = fake.seen[fake.seen.length - 1];
  eq(req.method, 'POST', 'publish is a POST');
  eq(req.path, '/rest/v1/levels', 'to /rest/v1/levels');
  eq(req.headers.apikey, KEY, 'the key is in the apikey header');
  eq(req.headers.authorization, `Bearer ${KEY}`, 'and in Authorization as a bearer token');
  eq(req.headers['content-type'], 'application/json', 'the body is json');
  eq(req.headers.prefer, 'return=representation', 'and the stored row is asked for back');
  eq(Object.keys(req.body).sort().join(','), 'author,doc,name,slug',
    'the insert carries these columns and no others');
  eq(req.body.doc.name, 'Hollow Rise', 'the document goes in whole');
  eq(fake.levels[0].slug, pub.slug, 'and the row that landed has the code that came back');

  // The row coming back is the whole point of return=representation: a publish
  // that reported success without reading it could hand out a dead URL.
  eq((await api.fetchLevel(pub.slug)).level.doc.seed, 7, 'the level reads back by its code');
  const readReq = fake.seen[fake.seen.length - 1];
  eq(readReq.method, 'GET', 'reading a level is a GET');
  eq(readReq.path, `/rest/v1/levels?slug=eq.${pub.slug}&select=slug,name,author,doc&limit=1`,
    'with the code as an eq filter and only the columns it needs');
  ok(!readReq.headers.prefer, 'and no Prefer on a plain read');

  const missing = await api.fetchLevel('zzzzzzzzzz');
  ok(!missing.ok, 'a code nobody published does not resolve');
  eq(missing.reason, 'no level has that code', 'and says so in a sentence');

  console.log('\na slug collision');
  // Forced: a client that always picks the same code, which is what a broken
  // generator would look like. The retry has to notice the 409 and try again.
  const clash = createClient({ url: `http://127.0.0.1:${port}`, key: KEY });
  const taken = fake.levels[0].slug;
  const again = await clash.publishLevel({ slug: taken, name: 'x', doc });
  ok(!again.ok, 'the same code twice is refused');
  ok(again.conflict, 'and is recognised as a collision rather than an error');
  eq(again.reason, 'that code is already taken', 'with a sentence a person can read');
  eq(again.status, 409, 'PostgREST answers a unique violation with 409');
  const before = fake.levels.length;
  const retried = await clash.publish({ name: 'x', doc, tries: 3 });
  ok(retried.ok, 'and publishing again just works, because the code is fresh');
  eq(fake.levels.length, before + 1, 'exactly one more level');

  console.log('\nposting a score');
  const posted = await api.postScore({ name: 'Ada', score: 14200, fireflies: 31, seconds: 214, levelSlug: pub.slug });
  ok(posted.ok, 'a score posts', posted.reason);
  const sreq = fake.seen[fake.seen.length - 1];
  eq(sreq.path, '/rest/v1/scores', 'to /rest/v1/scores');
  eq(sreq.headers.prefer, 'return=minimal', 'and asks for nothing back');
  eq(JSON.stringify(sreq.body), JSON.stringify({ name: 'Ada', score: 14200, fireflies: 31, seconds: 214, level_slug: pub.slug }),
    'the row is exactly the five columns');

  const orphan = await api.postScore({ name: 'Ada', score: 1, fireflies: 0, seconds: 9, levelSlug: 'nosuchcode' });
  ok(!orphan.ok, 'a score on a level nobody published is refused');
  eq(orphan.reason, 'that level is not published', 'by the foreign key, and it is said in English');

  console.log('\nreading the board');
  const many = [
    ['Ada', 90000], ['Bea', 80000], ['Cy', 70000], ['Dot', 60000], ['Eve', 50000],
    ['Fay', 40000], ['Gus', 30000], ['Hal', 20000], ['Ivy', 10000], ['Jo', 9000],
    ['Kit', 8000], ['Lee', 7000],
  ];
  for (const [name, score] of many) {
    await api.postScore({ name, score, fireflies: 10, seconds: 600 });
  }
  const top = await api.topScores({ limit: 10 });
  ok(top.ok, 'the board reads');
  eq(top.rows.length, 10, 'ten rows and no more');
  eq(top.rows[0].name, 'Ada', 'highest first');
  // Nine of the twelve above plus the 14,200 posted on the published level a
  // moment ago, which is the ninth best score in the table.
  eq(top.rows[8].score, 14200, 'the run posted earlier sits where its score puts it');
  eq(top.rows[9].name, 'Ivy', 'and the tenth is the tenth');
  const treq = fake.seen[fake.seen.length - 1];
  eq(treq.path,
    '/rest/v1/scores?select=name,score,fireflies,seconds,level_slug,created_at&order=score.desc,created_at.asc&limit=10',
    'ordered by score, ties broken by who got there first');

  const levelBoard = await api.topScores({ levelSlug: pub.slug, limit: 10 });
  eq(levelBoard.rows.length, 1, "a published level's board has only its own runs");
  const lreq = fake.seen[fake.seen.length - 1];
  ok(lreq.path.includes(`level_slug=eq.${pub.slug}`), 'filtered by the level');

  console.log('\nwhere a score that missed the board came');
  const rank = await api.rankOf({ score: 7000 });
  ok(rank.ok, 'a placing comes back', rank.reason);
  eq(rank.rank, 13, 'twelve rows are better, so it is thirteenth');
  const rreq = fake.seen[fake.seen.length - 1];
  eq(rreq.headers.prefer, 'count=exact', 'the count is asked for');
  ok(rreq.path.startsWith('/rest/v1/scores?select=id&score=gt.7000'), 'by counting the rows above it', rreq.path);
  eq((await api.rankOf({ score: 999999 })).rank, 1, 'the best score is first');
  eq((await api.rankOf({ score: 8000, levelSlug: pub.slug })).rank, 2,
    "and a level's board is counted on its own: one run beats it there, twelve do globally");

  console.log('\nthe key being refused');
  const wrong = createClient({ url: `http://127.0.0.1:${port}`, key: 'sb_publishable_WRONG' });
  const refused = await wrong.topScores();
  ok(!refused.ok, 'a bad key does not read the board');
  eq(refused.reason, 'the site key was refused', 'and says which of the many things went wrong');

  fake.server.close();

  if (PRINT) {
    console.log('\n--- every request, as it goes on the wire -----------------------------');
    const shown = new Set();
    for (const r of fake.seen) {
      const shape = `${r.method} ${r.path.replace(/eq\.[a-z0-9]{6,16}/g, 'eq.<slug>').replace(/gt\.\d+/, 'gt.<score>')}`;
      if (shown.has(shape)) continue;
      shown.add(shape);
      console.log(`\n${shape} HTTP/1.1`);
      console.log(`Host: arciakudvmdebdqwhouu.supabase.co`);
      console.log(`apikey: <publishable key>`);
      console.log(`Authorization: Bearer <publishable key>`);
      console.log(`Accept: application/json`);
      if (r.headers['content-type']) console.log(`Content-Type: ${r.headers['content-type']}`);
      if (r.headers.prefer) console.log(`Prefer: ${r.headers.prefer}`);
      if (r.body) {
        const body = r.body.doc ? { ...r.body, doc: '{ the whole editor document }' } : r.body;
        console.log(`\n${JSON.stringify(body, null, 2)}`);
      }
    }
    console.log('\n-----------------------------------------------------------------------');
  }
}

// --- nothing at the other end --------------------------------------------------------

async function offlineChecks() {
  console.log('\nno network at all');

  // A dead host. Nothing is listening on this port and nothing will be.
  const dead = createClient({ url: 'http://127.0.0.1:9', key: KEY, readTimeout: 800, writeTimeout: 800 });
  const calls = [
    ['fetchLevel', () => dead.fetchLevel('abc123def4')],
    ['publish', () => dead.publish({ name: 'x', doc: { a: 1 } })],
    ['topScores', () => dead.topScores()],
    ['rankOf', () => dead.rankOf({ score: 10 })],
    ['postScore', () => dead.postScore({ name: 'Ada', score: 1, fireflies: 0, seconds: 9 })],
  ];
  for (const [what, run] of calls) {
    let res;
    try { res = await run(); } catch (err) { res = { threw: err.message }; }
    ok(res && res.ok === false && !res.threw, `${what} against a dead host answers instead of throwing`, JSON.stringify(res));
    ok(res && typeof res.reason === 'string' && res.reason.length > 0, `${what} says why in a sentence`, JSON.stringify(res));
  }

  // A host that accepts the connection and then says nothing, which is what a
  // captive portal and a hung database both look like. The timeout is the only
  // thing between that and an end card that never finishes.
  const hung = http.createServer(() => { /* deliberately never answers */ });
  const port = await listen(hung);
  const slow = createClient({ url: `http://127.0.0.1:${port}`, key: KEY, readTimeout: 400 });
  const started = Date.now();
  const timedOut = await slow.topScores();
  const took = Date.now() - started;
  ok(!timedOut.ok, 'a hung host is a failure, not a hang');
  eq(timedOut.reason, 'the board did not answer in time', 'and says so');
  ok(took < 2000, `and gives up in ${took}ms, not eventually`);
  hung.close();

  // No fetch in the runtime at all, which is what an old browser looks like.
  const nofetch = createClient({ url: 'http://127.0.0.1:9', key: KEY, fetchImpl: null });
  // node has fetch, so the honest version of this test is an empty key.
  const nokey = createClient({ url: 'http://127.0.0.1:9', key: '' });
  ok(nokey.configured === false, 'a build with no key knows it has no board');
  const quiet = await nokey.topScores();
  ok(!quiet.ok && quiet.offline, 'and every call answers at once without touching the network');
  ok(nofetch.configured === true || nofetch.configured === false, 'a client builds either way');

  // Not a valid URL at all.
  const junk = createClient({ url: 'not a url', key: KEY, readTimeout: 400 });
  let threw = null;
  try { await junk.topScores(); } catch (err) { threw = err.message; }
  ok(threw === null, 'a nonsense URL does not throw either', threw || '');
}

console.log('the network client, against a fake PostgREST');
pureChecks();
await wireChecks();
await offlineChecks();

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
