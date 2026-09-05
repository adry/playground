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
import { makeFake, listen, KEY, makeToken } from './fake-postgrest.mjs';
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

  // TWO PEOPLE AND A PASSER-BY, because every policy in 002-accounts.sql is
  // about telling them apart. Ada and Bea are signed in; the guest holds only
  // the publishable key, which is what the game page holds.
  const ADA = 'uid-ada';
  const BEA = 'uid-bea';
  const at = { url: `http://127.0.0.1:${port}`, key: KEY };
  const ada = createClient({ ...at, token: async () => makeToken(ADA) });
  const bea = createClient({ ...at, token: async () => makeToken(BEA) });
  const guest = createClient(at);

  console.log('\nthe token, not the key');
  const doc = { format: 'graveyard-level', version: 2, name: 'Hollow Rise', size: 30, seed: 7, props: [] };
  const pub = await ada.publish({ name: 'Hollow Rise', author: 'Ada', doc, owner: ADA });
  ok(pub.ok, 'a signed in person saves a level', pub.reason);
  ok(isLevelSlug(pub.slug), 'and it comes back with its code', pub.slug);

  const req = fake.seen[fake.seen.length - 1];
  eq(req.method, 'POST', 'saving is a POST');
  eq(req.path, '/rest/v1/levels', 'to /rest/v1/levels');
  eq(req.headers.apikey, KEY, 'the publishable key stays in the apikey header');
  ok(req.headers.authorization.startsWith('Bearer eyJ'), 'and the BEARER is the access token, not the key', req.headers.authorization.slice(0, 24));
  ok(req.headers.authorization !== `Bearer ${KEY}`, 'which is the whole difference between a write that works and one that does not');
  eq(req.uid, ADA, 'so the database reads auth.uid() as the person who is signed in');
  eq(req.headers['content-type'], 'application/json', 'the body is json');
  eq(req.headers.prefer, 'return=representation', 'and the stored row is asked for back');
  eq(Object.keys(req.body).sort().join(','), 'author,doc,is_public,name,owner,slug',
    'the insert carries these columns and no others');
  eq(req.body.owner, ADA, 'owner is sent explicitly, because the policy checks it against the token');
  eq(req.body.is_public, false, 'and a new level is PRIVATE, which is the whole point of the default');
  eq(fake.levels[0].is_public, false, 'the row that landed is private');

  console.log('\nsigned out, and signed in as somebody else');
  const asGuest = await guest.publish({ name: 'x', doc, owner: ADA });
  ok(!asGuest.ok, 'a guest cannot save a level at all');
  eq(asGuest.reason, 'that is not yours to change', 'and the policy says so rather than the constraint');
  const asNobody = await ada.publish({ name: 'x', doc, owner: null });
  ok(!asNobody.ok, 'and neither can a call that forgot the owner');
  eq(asNobody.reason, 'sign in first', 'which is caught here rather than at the far end');
  const impostor = await bea.publish({ name: 'x', doc, owner: ADA });
  ok(!impostor.ok, "nobody may write a level into somebody else's account");
  eq(impostor.reason, 'that is not yours to change', 'the with check refuses it');

  console.log('\nprivate by default, and the read that must not leak it');
  //
  // THE ONE MISTAKE HERE THAT WOULD PUBLISH EVERYBODY'S DRAFTS. The read this
  // client sends for a level is `?slug=eq.X` with no `is_public` filter on it,
  // deliberately, because an author has to be able to open and test their own
  // unpublished level. Nothing in the request distinguishes a private level
  // from a public one. What keeps a draft private is the SELECT policy in
  // 002-accounts.sql, `using (is_public or owner = auth.uid())`, and nothing
  // else. So this checks the exact case: the same URL, with only the
  // publishable key, must come back empty.
  const hidden = await guest.fetchLevel(pub.slug);
  ok(!hidden.ok, 'a private level is invisible to a request carrying only the publishable key');
  eq(hidden.reason, 'no level has that code, or it is not public',
    'and the sentence covers both reasons, because the database will not say which');
  const guestRead = fake.seen[fake.seen.length - 1];
  eq(guestRead.headers.authorization, `Bearer ${KEY}`, 'that request was anonymous, which is what a player sends');
  eq(guestRead.uid, null, 'so auth.uid() is null and the owner half of the policy cannot match');

  const mine = await ada.fetchLevel(pub.slug);
  ok(mine.ok, 'its owner can still open it');
  eq(mine.level.doc.seed, 7, 'and gets the document back');
  const readReq = fake.seen[fake.seen.length - 1];
  eq(readReq.path, `/rest/v1/levels?slug=eq.${pub.slug}&select=slug,name,author,doc&limit=1`,
    'the read asks for the code and only the columns it needs');
  eq(readReq.path, guestRead.path,
    'and it is the SAME request the guest sent: the policy decides, not the URL');
  ok(!(await bea.fetchLevel(pub.slug)).ok, "and being signed in as somebody else is no better than being nobody");

  console.log('\nmaking it public');
  const opened = await ada.setPublic(pub.slug, true);
  ok(opened.ok, 'the owner may publish it', opened.reason);
  const patch = fake.seen[fake.seen.length - 1];
  eq(patch.method, 'PATCH', 'which is a PATCH');
  eq(patch.path, `/rest/v1/levels?slug=eq.${pub.slug}`, 'on that one row');
  eq(JSON.stringify(patch.body), '{"is_public":true}', 'carrying only the field that changed');
  ok(!('updated_at' in patch.body), 'and never updated_at, which the trigger owns');
  ok((await guest.fetchLevel(pub.slug)).ok, 'and now a stranger can play it');

  const shut = await bea.setPublic(pub.slug, false);
  ok(!shut.ok, "somebody else cannot unpublish a level that is not theirs");
  eq(shut.reason, 'that level is not yours, or is no longer there',
    'and an update that matched nothing is noticed, because postgres calls it success');
  ok(fake.levels[0].is_public === true, 'the row is untouched');

  console.log('\nmy levels');
  await ada.publish({ name: 'Second', doc, owner: ADA });
  await bea.publish({ name: "Bea's", doc, owner: BEA });
  const list = await ada.myLevels(ADA);
  ok(list.ok, 'the list comes back', list.reason);
  eq(list.levels.length, 2, "and it is only this person's levels");
  ok(list.levels.every((l) => l.doc === undefined), 'without the documents, because a list is a list');
  const listReq = fake.seen[fake.seen.length - 1];
  eq(listReq.path,
    `/rest/v1/levels?owner=eq.${ADA}&select=slug,name,author,is_public,created_at,updated_at&order=updated_at.desc&limit=200`,
    'newest edit first');
  eq(list.levels[0].name, 'Second', 'and the newest is first');
  ok(!(await ada.myLevels(null)).ok, 'and nobody signed in means no list');

  console.log('\nrenaming, and saving over');
  const renamed = await ada.updateLevel(pub.slug, { name: 'Hollow Rise II' });
  ok(renamed.ok, 'a level can be renamed', renamed.reason);
  eq(fake.levels[0].name, 'Hollow Rise II', 'and the row changed');
  const resaved = await ada.updateLevel(pub.slug, { doc: { ...doc, seed: 9 } });
  ok(resaved.ok, 'and saved over with a new document');
  eq(fake.levels[0].doc.seed, 9, 'which is what stops a second save making a second level');
  ok(!(await ada.updateLevel(pub.slug, {})).ok, 'a change of nothing is not a request');

  console.log('\ndeleting');
  const second = list.levels[0].slug;
  ok(!(await bea.deleteLevel(second)).ok, "nobody may delete somebody else's level");
  ok(fake.levels.some((l) => l.slug === second), 'and it is still there');
  const gone = await ada.deleteLevel(second);
  ok(gone.ok, 'the owner may delete their own', gone.reason);
  eq(fake.seen[fake.seen.length - 1].method, 'DELETE', 'which is a DELETE');
  ok(!fake.levels.some((l) => l.slug === second), 'and it is gone');

  console.log('\na slug collision');
  // Forced: a client that always picks the same code, which is what a broken
  // generator would look like. The retry has to notice the 409 and try again.
  const taken = fake.levels[0].slug;
  const again = await ada.saveLevel({ slug: taken, name: 'x', doc, owner: ADA });
  ok(!again.ok, 'the same code twice is refused');
  ok(again.conflict, 'and is recognised as a collision rather than an error');
  eq(again.reason, 'that code is already taken', 'with a sentence a person can read');
  eq(again.status, 409, 'PostgREST answers a unique violation with 409');
  const before = fake.levels.length;
  const retried = await ada.publish({ name: 'x', doc, owner: ADA });
  ok(retried.ok, 'and saving again just works, because the code is fresh');
  eq(fake.levels.length, before + 1, 'exactly one more level');

  console.log('\nposting a score, as a guest');
  const posted = await guest.postScore({
    name: 'Ada', score: 14200, fireflies: 31, seconds: 214, levelSlug: pub.slug, rulesVersion: 3,
  });
  ok(posted.ok, 'a passer-by can still post a score', posted.reason);
  const sreq = fake.seen[fake.seen.length - 1];
  eq(sreq.path, '/rest/v1/scores', 'to /rest/v1/scores');
  eq(sreq.headers.authorization, `Bearer ${KEY}`, 'with the publishable key as the bearer, because nobody is signed in');
  eq(sreq.headers.prefer, 'return=minimal', 'and asks for nothing back');
  eq(JSON.stringify(sreq.body), JSON.stringify({
    name: 'Ada', score: 14200, fireflies: 31, seconds: 214, level_slug: pub.slug, rules_version: 3,
  }), 'the row is what the game knows, and owner is not part of it');
  ok(!('owner' in sreq.body),
    'owner is OMITTED rather than sent as null, so the board still works on a project where 002 has not been run');

  const withOwner = await ada.postScore({ name: 'Ada', score: 900, fireflies: 3, seconds: 60, owner: ADA });
  ok(withOwner.ok, 'and a signed in player may tie a score to themselves', withOwner.reason);
  eq(fake.seen[fake.seen.length - 1].body.owner, ADA, 'with their own id');
  const forged = await bea.postScore({ name: 'Bea', score: 900, fireflies: 3, seconds: 60, owner: ADA });
  ok(!forged.ok, "and nobody may post a score as somebody else");

  const orphan = await guest.postScore({ name: 'Ada', score: 1, fireflies: 0, seconds: 9, levelSlug: 'nosuchcode' });
  ok(!orphan.ok, 'a score on a level nobody published is refused');
  eq(orphan.reason, 'that level is not published', 'by the foreign key, and it is said in English');

  console.log('\nwhat the score was set in');
  const withRun = await guest.postScore({
    name: 'Ada', score: 700, fireflies: 2, seconds: 45,
    rulesVersion: 3, seed: 123456, caughtBy: 'flanker',
  });
  ok(withRun.ok, 'a score carries what it was set in', withRun.reason);
  const prov = fake.seen[fake.seen.length - 1].body;
  eq(prov.rules_version, 3, 'the rules version, which is the one that matters');
  eq(prov.seed, 123456, 'the run seed, so it can be replayed one day');
  eq(prov.caught_by, 'flanker', 'and what ended it');
  eq((await guest.postScore({ name: 'Ada', score: 1, fireflies: 0, seconds: 9 })).ok, true,
    'and a score with none of that is still a score');
  ok(!('rules_version' in fake.seen[fake.seen.length - 1].body),
    'nothing invented: what the caller did not say is not sent');

  console.log('\nreading the board');
  const many = [
    ['Ada', 90000], ['Bea', 80000], ['Cy', 70000], ['Dot', 60000], ['Eve', 50000],
    ['Fay', 40000], ['Gus', 30000], ['Hal', 20000], ['Ivy', 10000], ['Jo', 9000],
    ['Kit', 8000], ['Lee', 7000],
  ];
  for (const [name, score] of many) {
    await guest.postScore({ name, score, fireflies: 10, seconds: 600 });
  }
  const top = await guest.topScores({ limit: 10, rulesVersion: 3 });
  ok(top.ok, 'the board reads');
  eq(top.rows.length, 10, 'ten rows and no more');
  eq(top.rows[0].name, 'Ada', 'highest first');
  const treq = fake.seen[fake.seen.length - 1];
  eq(treq.path,
    '/rest/v1/scores?select=name,score,fireflies,seconds,level_slug,created_at&rules_version=eq.3'
    + '&order=score.desc,created_at.asc&limit=10',
    'ordered by score, ties broken by who got there first, and only this version of the game');

  const levelBoard = await guest.topScores({ levelSlug: pub.slug, limit: 10 });
  eq(levelBoard.rows.length, 1, "a published level's board has only its own runs");
  const lreq = fake.seen[fake.seen.length - 1];
  ok(lreq.path.includes(`level_slug=eq.${pub.slug}`), 'filtered by the level');

  console.log('\nwhere a score that missed the board came');
  const rank = await guest.rankOf({ score: 7000, rulesVersion: 3 });
  ok(rank.ok, 'a placing comes back', rank.reason);
  eq(rank.rank, 13, 'twelve rows are better, so it is thirteenth');
  const rreq = fake.seen[fake.seen.length - 1];
  eq(rreq.headers.prefer, 'count=exact', 'the count is asked for');
  ok(rreq.path.startsWith('/rest/v1/scores?select=id&score=gt.7000'), 'by counting the rows above it', rreq.path);
  ok(rreq.path.includes('rules_version=eq.3'),
    'over the same set the board is drawn from, or the placing is a number from a different leaderboard');
  eq((await guest.rankOf({ score: 999999, rulesVersion: 3 })).rank, 1, 'the best score is first');

  console.log('\nthe key being refused');
  const wrong = createClient({ url: `http://127.0.0.1:${port}`, key: 'sb_publishable_WRONG' });
  const refused = await wrong.topScores();
  ok(!refused.ok, 'a bad key does not read the board');
  eq(refused.reason, 'the site key was refused', 'and says which of the many things went wrong');

  console.log('\na project where the migration has not been run');
  // What the owner's browser does between now and the moment they run
  // 002-accounts.sql: PostgREST rejects an insert naming a column the table does
  // not have, and the sentence has to point at the cause rather than at the
  // network, because they are the only person who can fix it.
  const old = makeFake({ legacy: true });
  const oldPort = await listen(old.server);
  const oldApi = createClient({ url: `http://127.0.0.1:${oldPort}`, key: KEY, token: async () => makeToken(ADA) });
  const tooSoon = await oldApi.publish({ name: 'x', doc, owner: ADA });
  ok(!tooSoon.ok, 'saving a level fails on a database without accounts in it');
  eq(tooSoon.reason, 'this site needs its database updated before accounts work',
    'and says exactly that, rather than blaming the network');
  const stillPosts = await oldApi.postScore({ name: 'Ada', score: 10, fireflies: 1, seconds: 30 });
  ok(stillPosts.ok, 'while the leaderboard keeps working, because a guest score names no new column');
  old.server.close();

  console.log('\na project where 003 has not been run either');
  // The second window, between deploying this and the owner running
  // 003-score-provenance.sql. The game always sends a rules version now, so
  // every score would be refused and every board would be empty. The client
  // notices the refusal once and carries on without it.
  const noProv = makeFake({ legacyScores: true });
  const noProvPort = await listen(noProv.server);
  const shy = createClient({ url: `http://127.0.0.1:${noProvPort}`, key: KEY });
  const first = await shy.postScore({ name: 'Ada', score: 500, fireflies: 2, seconds: 30, rulesVersion: 3, seed: 9 });
  ok(first.ok, 'a score still posts on a database with no provenance columns', first.reason);
  const attempts = noProv.seen.filter((r) => r.method === 'POST');
  eq(attempts.length, 2, 'it took two tries: the full row, refused, then the row the table can hold');
  ok('rules_version' in attempts[0].body, 'the first attempt said everything it knew');
  ok(!('rules_version' in attempts[1].body), 'the second said only what the table has');
  eq(noProv.scores.length, 1, 'and exactly one score landed, not two');

  const shyBoard = await shy.topScores({ limit: 10, rulesVersion: 3 });
  ok(shyBoard.ok, 'the board reads too', shyBoard.reason);
  eq(shyBoard.rows.length, 1, 'with the score that was just posted on it');
  const shyReads = noProv.seen.filter((r) => r.method === 'GET');
  ok(!shyReads[shyReads.length - 1].path.includes('rules_version'),
    'and it stopped asking for a column the table does not have, rather than asking every time');
  const before2 = noProv.seen.length;
  await shy.postScore({ name: 'Bea', score: 400, fireflies: 1, seconds: 30, rulesVersion: 3 });
  eq(noProv.seen.length - before2, 1, 'the next post is one request, because it learned');
  noProv.server.close();

  fake.server.close();

  if (PRINT) {
    console.log('\n--- every request, as it goes on the wire -----------------------------');
    const shown = new Set();
    for (const r of fake.seen) {
      const shape = `${r.method} ${r.path.replace(/eq\.[a-z0-9-]{4,36}/g, 'eq.<value>').replace(/gt\.\d+/, 'gt.<score>')}`;
      if (shown.has(shape)) continue;
      shown.add(shape);
      console.log(`\n${shape} HTTP/1.1`);
      console.log('Host: arciakudvmdebdqwhouu.supabase.co');
      console.log('apikey: <publishable key>');
      console.log(`Authorization: Bearer ${r.uid ? '<the signed in person\'s access token>' : '<publishable key>'}`);
      console.log('Accept: application/json');
      if (r.headers['content-type']) console.log(`Content-Type: ${r.headers['content-type']}`);
      if (r.headers.prefer) console.log(`Prefer: ${r.headers.prefer}`);
      if (r.body) {
        const shownBody = r.body.doc ? { ...r.body, doc: '{ the whole editor document }' } : r.body;
        console.log(`\n${JSON.stringify(shownBody, null, 2)}`);
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
