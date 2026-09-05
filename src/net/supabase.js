// THE ONE PIECE OF NETWORK IN THE PROJECT.
//
// Two tables in a Supabase project, reached over PostgREST with plain fetch:
//
//   levels   the graveyards people publish out of /editor/
//   scores   the leaderboard
//
// supabase/schema.sql and supabase/002-accounts.sql are the contract between
// them, and both are worth reading before this file. Nothing here may write a
// column that is not in them.
//
// WHAT 002 CHANGED, because it changed the shape of this file. A level used to
// be an anonymous row anybody could insert and everybody could read. It now
// belongs to somebody: reading is "public, or mine", writing needs an account,
// and editing or deleting is your own rows only. So this client now sends a
// person's access token instead of the anonymous key on anything that writes a
// level, and it has update and delete where before it deliberately had neither.
// Scores did not change: a guest may still post one, which is the whole reason
// the game page never has to know what an account is.
//
// WHY NO @supabase/supabase-js, WHEN src/net/auth.js DOES TAKE A LIBRARY. Two
// tables reached by nine requests is a handful of fetch calls: the whole data
// layer is below and it is tested against a fake that speaks PostgREST. The
// library is 57.4 KB gzipped and four fifths of it is realtime, storage and
// functions, none of which this site has. OAuth is the opposite case and it
// took the opposite decision; see the note at the top of auth.js.
//
// THE KEY IS NOT A SECRET, and treating it as one would be a lie about what it
// does. It is the PUBLISHABLE key: it ships in the page, anybody who opens the
// site has it, and that is what it is designed for. What keeps the tables safe
// is not the key but the policies in schema.sql. The corollary, which is the
// honest half and is stated again on the board itself: anyone holding this key
// can insert a score without playing. See the note at the foot of schema.sql
// for the only real fix, which is not this file's job today.
//
// EVERY CALL IS ALLOWED TO FAIL, and most of the code below is about that. The
// game and the editor worked with no network before this file existed and they
// have to keep working with no network afterwards, because the owner uses them
// offline. So: nothing here throws at a caller who did not ask for a throw,
// every request has a timeout, and every result is a plain object saying
// whether it worked. A board that cannot load shows nothing. It does not stop
// a game starting.

// --- where it lives ----------------------------------------------------------
//
// In the source, deliberately, like any other configuration. See above for why
// this is not a secret. A page may override both before importing anything,
// which is how a fork points at its own project without editing this file, and
// how src/net/net-check.mjs points the client at a fake on localhost.
const GLOBAL = typeof globalThis === 'object' ? globalThis : {};
const OVERRIDE = GLOBAL.GRAVEYARD_SUPABASE || {};

export const SUPABASE_URL = OVERRIDE.url || 'https://arciakudvmdebdqwhouu.supabase.co';
export const SUPABASE_KEY = OVERRIDE.key || 'sb_publishable_6Wab1Q_AyOZfw6uJj99CPQ_djAnCvUz';

// How long anything is allowed to take before it is treated as a failure. A
// read is on the end card and in front of somebody who wants to press Again, so
// it gets six seconds and no more. A publish carries the whole document, which
// can be a couple of hundred kilobytes over a phone, so it gets twenty.
export const READ_TIMEOUT = 6000;
export const WRITE_TIMEOUT = 20000;

// The doc column's ceiling, from schema.sql. The check there is on
// pg_column_size, which is the compressed on-disk size, so a document that
// passes this check certainly passes that one and a document that fails it
// might still have squeezed through. Refusing here is about giving the owner a
// sentence they can act on instead of a 400 out of PostgREST.
export const MAX_DOC_BYTES = 512 * 1024;

// The name is asked for once and kept. One key for both halves: the person who
// publishes a graveyard and the person whose score goes on the board are the
// same person, and asking them twice for the same string would be the site not
// paying attention.
export const NAME_KEY = 'graveyard.name.v1';

// The widths of the three text columns, from schema.sql. Named rather than
// spelled twice, because getting one of them wrong is a 400 in somebody else's
// browser and nowhere else.
export const MAX_NAME = 20;        // scores.name
export const MAX_AUTHOR = 40;      // levels.author
export const MAX_TITLE = 60;       // levels.name

// WHICH LEVEL THIS DOCUMENT IS, ONLINE. The editor holds one document at a
// time; this is the row it is bound to, so that saving twice updates a level
// rather than filling the account with copies of it. It is not in the document
// itself because normalizeLevel builds a level out of the fields it knows and
// would drop it on the next load.
export const BOUND_KEY = 'graveyard.editor.online.v1';

// --- the slug ----------------------------------------------------------------
//
// schema.sql says a slug is `^[a-z0-9]{6,16}$`, unique, and generated by the
// client. Ten characters out of a 32 letter alphabet is fifty bits, which is
// enough that the collision below is a formality rather than a plan.
//
// THE ALPHABET IS MISSING FOUR LETTERS, on purpose: l, o, 0 and 1 are the four
// that get read wrong off a screen and typed wrong into a phone. A published
// level's whole point is that it goes to somebody else, sometimes read aloud.
//
// 32 divides 256 exactly, so a random byte maps to a letter with no modulo bias
// and no rejection loop.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const SLUG_LENGTH = 10;

// Reserved because src/game/scene.js reads `level=session` as "the document the
// editor has open" and has since before this file existed. Ten characters can
// never collide with a seven character word, so this is a belt on top of
// braces: if SLUG_LENGTH ever changes, the token stays unreachable.
export const RESERVED_SLUGS = ['session'];

function randomBytes(n) {
  const out = new Uint8Array(n);
  const c = GLOBAL.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  // No crypto: an old browser, or a page served over plain http. A weaker slug
  // is still a slug, and the alternative is refusing to publish.
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function makeSlug(length = SLUG_LENGTH) {
  for (;;) {
    const bytes = randomBytes(length);
    let s = '';
    for (let i = 0; i < length; i++) s += ALPHABET[bytes[i] & 31];
    if (!RESERVED_SLUGS.includes(s)) return s;
  }
}

// IS THIS `level=` A PUBLISHED CODE, OR A FILE?
//
// The game's `level` parameter has always been a URL: /levels/demo.json, or the
// token `session`. A published level adds a third kind and the three have to be
// told apart with no ambiguity, because guessing wrong means either fetching a
// file that is not there or asking the database for a filename.
//
// The rule is the shape of the thing, and it works because the two sets cannot
// overlap. A slug is six to sixteen lowercase letters and digits and NOTHING
// ELSE: no slash, no dot, no colon. Every URL a level can be loaded from has at
// least one of those three, because it is either a path (a slash) or a filename
// (a dot) or absolute (a colon). So `abc123def4` is a code, `/levels/demo.json`
// is a file, `demo.json` is a file, and `session` is the editor's token and is
// excluded by name.
//
// The one thing this cannot serve is a file with no extension at the site root,
// named entirely in lowercase, six to sixteen characters long. There is no such
// file, public/levels/ is where levels live and they are all .json, and the
// cost of the ambiguity is a sentence in this comment rather than a second
// query parameter on every shared URL.
const SLUG_RE = /^[a-z0-9]{6,16}$/;

export function isLevelSlug(value) {
  return typeof value === 'string'
    && SLUG_RE.test(value)
    && !RESERVED_SLUGS.includes(value);
}

// --- what a row may say -------------------------------------------------------
//
// Every constraint in schema.sql, checked here as well. Not because the server
// cannot be trusted to enforce them, it can and it does, but because a check
// that runs before the request turns "400 Bad Request" into a sentence, and
// because it still works with the network off.

export function cleanName(raw, max = MAX_NAME) {
  // Collapsed whitespace, trimmed, and cut to the column it is going into.
  // Control characters go because a name is drawn into a list and a newline in
  // one would break the row it is in.
  //
  // THE CAP IS AN ARGUMENT because the three text columns in the schema are
  // three different widths: a score's name is 20, a level's author is 40 and a
  // level's name is 60. One function with one hard coded 20 in it quietly
  // truncated level names to a third of what the column holds.
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, max));
}

// Builds the row that goes into `scores`, or says why it cannot. The numbers
// are floored rather than rounded because seconds is the denominator of the
// plausibility check in the schema and rounding it up would let a run past that
// the constraint means to catch.
export function scoreRow({
  name, score, fireflies, seconds, levelSlug = null, owner = null,
  rulesVersion = null, seed = null, caughtBy = null,
}) {
  const who = cleanName(name, MAX_NAME);
  if (!who) return { ok: false, problem: 'a name, first' };

  const row = {
    name: who,
    score: Math.max(0, Math.floor(Number(score) || 0)),
    fireflies: Math.max(0, Math.floor(Number(fireflies) || 0)),
    seconds: Math.max(0, Math.floor(Number(seconds) || 0)),
  };
  // The column is nullable and a run on the level the site ships is not a run
  // on a published one. Sending null rather than omitting the key is the same
  // thing to PostgREST and says out loud that the absence is deliberate.
  row.level_slug = isLevelSlug(levelSlug) ? levelSlug : null;
  // WHO SET IT, when anybody knows. The score policy in 002-accounts.sql is
  // `owner is null or owner = auth.uid()`, so a guest posts with null and a
  // signed in player may only post as themselves. The game page has no sign in
  // and always sends null, which the policy allows on purpose: a board that
  // demanded an account would be a wall in front of the one thing a passer-by
  // might do.
  // OMITTED RATHER THAN SENT AS NULL, and the difference matters. `owner` is a
  // column 002-accounts.sql adds, and PostgREST rejects an insert naming a
  // column the table does not have. A guest's score carries no owner either
  // way, so leaving the key out entirely means the board keeps working on a
  // project where 002 has not been run yet, and starts carrying who set what
  // the moment it has.
  if (typeof owner === 'string' && owner) row.owner = owner;

  // WHAT THE SCORE WAS SET IN, from 003-score-provenance.sql.
  //
  // rules_version is the one that matters and it is not decoration: run.js has
  // changed the game three times and says in its own comment that a board
  // mixing versions is a board that lies. A version 2 run ended when the arena
  // ran out of fireflies; a version 3 run is unbounded. Putting them in one
  // list is not a leaderboard, it is two leaderboards printed on top of each
  // other, so every read below filters on this as well.
  //
  // seed and caught_by are what an edge function would need to replay the run
  // and decide whether the score is real. Nothing reads them today. They are
  // recorded now so that the day somebody builds that, the rows already there
  // are not all worthless.
  if (Number.isFinite(Number(rulesVersion))) row.rules_version = Math.floor(Number(rulesVersion));
  if (Number.isFinite(Number(seed))) row.seed = Math.floor(Number(seed));
  if (typeof caughtBy === 'string' && caughtBy) row.caught_by = caughtBy.slice(0, 40);

  if (row.score > 1000000) return { ok: false, problem: 'that score is past what the board can hold' };
  if (row.fireflies > 100000) return { ok: false, problem: 'that many fireflies is past what the board can hold' };
  if (row.seconds > 86400) return { ok: false, problem: 'that run is longer than the board allows' };
  // schema.sql's plausibility check, repeated. A run cannot collect more than
  // about three fireflies a second however good the player is.
  if (row.fireflies > 5 + row.seconds * 3) {
    return { ok: false, problem: 'the board reads that run as impossible' };
  }
  return { ok: true, row };
}

// --- remembering who you are ---------------------------------------------------
//
// Both wrapped, both allowed to do nothing. A private window, cleared site data
// or a browser set to block storage THROWS on access rather than returning
// null, and being asked your name twice is not worth taking a page down for.

export function readName() {
  try { return cleanName(localStorage.getItem(NAME_KEY)); } catch { return ''; }
}

export function writeName(name) {
  const who = cleanName(name);
  try { localStorage.setItem(NAME_KEY, who); } catch { /* nothing to do about it */ }
  return who;
}

// --- the client ----------------------------------------------------------------

// PostgREST answers an error with a JSON body: message, code, details, hint.
// `code` is the postgres SQLSTATE where there is one, and three of them mean
// something specific enough to say in English.
function reasonFor(status, payload) {
  const code = payload && payload.code;
  if (code === '23505') return 'that code is already taken';
  if (code === '23503') return 'that level is not published';
  if (code === '23514') return 'the board would not accept those numbers';
  // 42703 is postgres and PGRST204 is PostgREST's schema cache: both mean the
  // page is asking for a column the table does not have, which on this site can
  // only mean supabase/002-accounts.sql has not been run yet. Worth its own
  // sentence, because every other explanation sends somebody looking in the
  // wrong place.
  if (code === '42703' || code === 'PGRST204') return 'this site needs its database updated before accounts work';
  // A policy said no. With 002 in place the usual cause is a write attempted
  // without a signed in person, or on somebody else's level.
  if (code === '42501') return 'that is not yours to change';
  if (status === 401 || status === 403) return 'the site key was refused';
  if (status === 404) return 'the board is not there';
  if (status === 413) return 'too big to send';
  if (status >= 500) return 'the board is having a bad day';
  const message = payload && typeof payload.message === 'string' ? payload.message : '';
  return message || `the board answered ${status}`;
}

// Everything that can go wrong before a status code exists reads the same way
// to a player, and none of the distinctions are theirs to care about: a dead
// host, a captive portal, a CORS rejection and an aborted timeout all mean the
// board is not reachable right now.
function offlineReason(err) {
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'the board did not answer in time';
  return 'no connection to the board';
}

export function createClient({
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
  fetchImpl = null,
  readTimeout = READ_TIMEOUT,
  writeTimeout = WRITE_TIMEOUT,
  // WHERE THE ACCESS TOKEN COMES FROM, and why it is a function rather than a
  // string. A token expires after an hour and is renewed underneath us, so a
  // client that captured one at construction would work all morning and start
  // failing in the afternoon. This is asked on every request and the answer is
  // whatever is valid now; src/net/auth.js supplies one that refreshes.
  //
  // A page with no accounts in it passes nothing, gets null, and every request
  // goes out anonymously, which is exactly what the game wants.
  token = null,
} = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = fetchImpl || (typeof GLOBAL.fetch === 'function' ? GLOBAL.fetch.bind(GLOBAL) : null);
  // A missing key, a missing URL or a runtime with no fetch are all the same
  // situation: there is no board. Every method below answers immediately
  // without touching the network, so a caller never has to ask first.
  const configured = Boolean(base && key && doFetch);

  // `apikey` is what the Supabase gateway routes and rate limits on, and it is
  // always the publishable key. The BEARER is a different question entirely: it
  // is what PostgREST reads the role out of, so it decides which policies apply.
  //
  // THE CLASSIC MISTAKE IS SENDING THE PUBLISHABLE KEY AS THE BEARER while
  // signed in. The request is well formed, the gateway is happy, PostgREST reads
  // the anonymous role, and every policy in 002-accounts.sql that compares
  // against auth.uid() fails against a null. It looks exactly like a server bug.
  // So: the person's access token when there is one, the publishable key when
  // there is not, and never the key when a token was available.
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  // HAS 003-score-provenance.sql BEEN RUN?
  //
  // Assumed yes, and unlearned the first time the database says otherwise. The
  // owner runs each migration by hand, in their own time, and between a deploy
  // and that moment every request naming a new column is a 400. The columns in
  // question carry which version of the rules a score was set in: useful, and
  // not worth a dead leaderboard for a day. So the first refusal turns them off
  // for the life of the page and the request is sent again without them.
  //
  // This is not a fallback that hides a bug. The two error codes it reacts to
  // mean exactly one thing on this site, the shape of the request is otherwise
  // identical, and the moment the migration runs the next page load is back to
  // recording everything.
  let hasProvenance = true;
  const missingColumn = (res) => res.code === '42703' || res.code === 'PGRST204';

  async function bearer() {
    if (typeof token !== 'function') return null;
    try {
      const t = await token();
      return typeof t === 'string' && t ? t : null;
    } catch {
      // A token provider that fell over is a person who is not signed in as far
      // as this request is concerned. It is not a reason to fail the read.
      return null;
    }
  }

  async function request(path, options = {}) {
    if (!configured) return { ok: false, reason: 'this build has no board configured', offline: true };

    const { method = 'GET', body = null, prefer = null, timeout = readTimeout } = options;
    const init = { method, headers: { ...headers } };
    const tok = await bearer();
    if (tok) init.headers.Authorization = `Bearer ${tok}`;
    if (prefer) init.headers.Prefer = prefer;
    if (body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    // The timeout is the whole reason the offline path is quick rather than a
    // thirty second stare at a card that has not finished. AbortController is
    // everywhere the game runs, but a runtime without one still gets to make
    // the request, it just cannot cut it short.
    let timer = null;
    if (typeof AbortController === 'function') {
      const ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(() => ctl.abort(), timeout);
    }

    let res;
    try {
      res = await doFetch(`${base}/rest/v1${path}`, init);
    } catch (err) {
      return { ok: false, reason: offlineReason(err), offline: true };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    // A body is read as text and then parsed, because an error from the gateway
    // rather than from PostgREST is HTML, and JSON.parse on an HTML page throws
    // a message about the character `<` that helps nobody.
    let payload = null;
    const text = await res.text().catch(() => '');
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }

    if (!res.ok) {
      return { ok: false, status: res.status, code: payload && payload.code, reason: reasonFor(res.status, payload) };
    }
    return { ok: true, status: res.status, data: payload, headers: res.headers };
  }

  // PostgREST puts the row count in Content-Range when the request asks for it:
  // `0-9/1483`, or `*/0` for nothing at all. Supabase exposes that header to
  // the browser by default; if a proxy ever strips it, this returns null and
  // the caller quietly shows no placing rather than a wrong one.
  function countFrom(result) {
    const raw = result.headers && typeof result.headers.get === 'function'
      ? result.headers.get('content-range')
      : null;
    if (!raw) return null;
    const total = String(raw).split('/')[1];
    if (!total || total === '*') return null;
    const n = Number(total);
    return Number.isFinite(n) ? n : null;
  }

  const api = {
    configured,
    url: base,

    // GET /rest/v1/levels?slug=eq.<slug>&select=slug,name,author,doc&limit=1
    //
    // is_public is NOT in that select, though a caller might reasonably want
    // it. Nothing reads it, and leaving it out means this one request also
    // works against a project where 002-accounts.sql has not been run yet.
    // PostgREST rejects a select naming a column the table does not have, and
    // a player asking for a level is the request that must not be the first
    // casualty of a migration nobody has got round to.
    //
    // No `is_public=eq.true` filter, and that is deliberate: the SELECT policy
    // in 002-accounts.sql is already "public, or mine", so a private level is
    // invisible to everyone but its owner and the owner can open their own
    // through the same call. Filtering here as well would stop an author from
    // testing their own unpublished level.
    async fetchLevel(slug) {
      if (!isLevelSlug(slug)) return { ok: false, reason: 'that is not a level code' };
      const res = await request(`/levels?slug=eq.${encodeURIComponent(slug)}&select=slug,name,author,doc&limit=1`);
      if (!res.ok) return res;
      const row = Array.isArray(res.data) ? res.data[0] : null;
      // Nothing came back, and the two reasons are indistinguishable from here
      // by design: row level security hides a private level exactly as
      // completely as it hides one that was never made. So the sentence covers
      // both rather than guessing at one.
      if (!row || !row.doc) return { ok: false, reason: 'no level has that code, or it is not public' };
      return { ok: true, level: row };
    },

    // EVERY LEVEL THIS PERSON OWNS. The owner's stated reason for wanting
    // accounts at all, so it is a first class call rather than a filter on
    // something else.
    //
    // GET /rest/v1/levels?owner=eq.<uid>&select=...&order=updated_at.desc
    //
    // The policy would return the same rows without the owner filter, since
    // "mine" is half of what it allows, but it would return every public level
    // in the database along with them. The filter is what makes this MY levels,
    // and it is the column levels_owner_idx is built on.
    async myLevels(uid, { limit = 200 } = {}) {
      if (!uid) return { ok: false, reason: 'nobody is signed in' };
      const n = Math.max(1, Math.min(500, Math.floor(limit) || 200));
      const res = await request(
        `/levels?owner=eq.${encodeURIComponent(uid)}`
        + `&select=slug,name,author,is_public,created_at,updated_at`
        + `&order=updated_at.desc&limit=${n}`,
      );
      if (!res.ok) return res;
      return { ok: true, levels: Array.isArray(res.data) ? res.data : [] };
    },

    // POST /rest/v1/levels with the slug the client picked.
    //
    // `return=representation` asks for the stored row back, which is the only
    // way to be sure the thing that landed is the thing that was sent: a save
    // that reports success on a 201 it did not read is a save that will one day
    // hand somebody a URL to a level that is not there.
    //
    // OWNER IS SENT EXPLICITLY, and it has to be. The insert policy is
    // `with check (owner = auth.uid())`, which is not a default: a row with a
    // null owner fails it. So the caller passes the signed in person's id and
    // the database checks it against the token, which is what stops anybody
    // writing a level into somebody else's account.
    //
    // IS_PUBLIC DEFAULTS TO FALSE in the column and this does not argue with
    // it. A half finished graveyard is not a decision to publish.
    async saveLevel({ slug, name, author = null, doc, owner, isPublic = false }) {
      if (!isLevelSlug(slug)) return { ok: false, reason: 'that is not a level code' };
      if (!owner) return { ok: false, reason: 'sign in first' };
      const title = cleanName(name, MAX_TITLE) || 'graveyard';
      const who = cleanName(author, MAX_AUTHOR);
      const body = JSON.stringify({
        slug, name: title, author: who || null, doc, owner, is_public: Boolean(isPublic),
      });
      if (body.length > MAX_DOC_BYTES) {
        return { ok: false, reason: 'this level is too big to save', tooBig: true };
      }
      const res = await request('/levels', {
        method: 'POST',
        body,
        prefer: 'return=representation',
        timeout: writeTimeout,
      });
      if (!res.ok) return { ...res, conflict: res.code === '23505' };
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      return { ok: true, slug: (row && row.slug) || slug, level: row };
    },

    // PATCH /rest/v1/levels?slug=eq.<slug>
    //
    // Only what changed, never the whole row: sending a document back when the
    // person only renamed a level would be a couple of hundred kilobytes to
    // change twenty characters. `updated_at` is NOT sent, because the trigger in
    // 002-accounts.sql sets it, and a client that sends its own timestamp is a
    // client that can lie about when something changed.
    //
    // The UPDATE policy is own-rows-only with a `with check` as well as a
    // `using`, so `owner` is not in the list of things that may be sent: moving
    // a level into somebody else's account is exactly what that check exists to
    // refuse, and asking for it would earn a 403 rather than an oversight.
    async updateLevel(slug, changes = {}) {
      if (!isLevelSlug(slug)) return { ok: false, reason: 'that is not a level code' };
      const body = {};
      if (changes.name !== undefined) body.name = cleanName(changes.name, MAX_TITLE) || 'graveyard';
      if (changes.author !== undefined) body.author = cleanName(changes.author, MAX_AUTHOR) || null;
      if (changes.isPublic !== undefined) body.is_public = Boolean(changes.isPublic);
      if (changes.doc !== undefined) body.doc = changes.doc;
      if (!Object.keys(body).length) return { ok: false, reason: 'nothing to change' };
      const text = JSON.stringify(body);
      if (text.length > MAX_DOC_BYTES) return { ok: false, reason: 'this level is too big to save', tooBig: true };
      const res = await request(`/levels?slug=eq.${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: text,
        prefer: 'return=representation',
        timeout: writeTimeout,
      });
      if (!res.ok) return res;
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      // A PATCH that matched nothing is a 200 with an empty array, not an
      // error: to PostgREST "no rows matched" and "the policy hid them all" are
      // the same answer. Somebody editing a level that is not theirs, or one
      // that has been deleted, lands here.
      if (!row) return { ok: false, reason: 'that level is not yours, or is no longer there' };
      return { ok: true, level: row };
    },

    // DELETE /rest/v1/levels?slug=eq.<slug>
    //
    // Also own-rows-only, also silent when it matches nothing, so the same
    // check on the returned row applies. Scores that were set on the level keep
    // their level_slug: the foreign key is `on delete set null`, which loses
    // which graveyard a run was in and keeps the run.
    async deleteLevel(slug) {
      if (!isLevelSlug(slug)) return { ok: false, reason: 'that is not a level code' };
      const res = await request(`/levels?slug=eq.${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        prefer: 'return=representation',
        timeout: writeTimeout,
      });
      if (!res.ok) return res;
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) return { ok: false, reason: 'that level is not yours, or is no longer there' };
      return { ok: true, slug };
    },

    // The public toggle, which is the whole of "and a choice to make a scene
    // public". One field, so it is one PATCH.
    async setPublic(slug, isPublic) {
      return api.updateLevel(slug, { isPublic: Boolean(isPublic) });
    },

    // Saving a new level, collisions and all.
    //
    // WHY A RETRY RATHER THAN A CHECK FIRST. Asking "is this slug free" and then
    // inserting is two requests, is a race in exactly the way this table's
    // unique index is not, and is slower in the case that always happens. The
    // unique constraint in schema.sql is the authority on whether a code is
    // free, so the way to ask it is to insert and see. Fifty bits of slug means
    // the second attempt is a once-in-a-database-lifetime event; three attempts
    // is there so that a bug that somehow made slugs constant fails loudly
    // instead of looping.
    async publish({ name, author = null, doc, owner, isPublic = false, tries = 3 }) {
      let last = null;
      for (let i = 0; i < tries; i++) {
        const slug = makeSlug();
        last = await api.saveLevel({ slug, name, author, doc, owner, isPublic });
        if (last.ok || !last.conflict) return last;
      }
      return last || { ok: false, reason: 'could not find a free code' };
    },

    // GET /rest/v1/scores?select=...&order=score.desc,created_at.asc&limit=10
    //
    // created_at ascending as the tiebreak, so the first person to reach a
    // score keeps the higher row. Sorting by score alone leaves ties in
    // whatever order the index hands back, which means a board that reshuffles
    // itself between two loads for no reason the reader can see.
    async topScores({ levelSlug = null, limit = 10, rulesVersion = null } = {}) {
      const n = Math.max(1, Math.min(100, Math.floor(limit) || 10));
      const filter = isLevelSlug(levelSlug) ? `&level_slug=eq.${encodeURIComponent(levelSlug)}` : '';
      const ask = async () => {
        // The version filter is what stops the board being two boards printed
        // on top of each other. It is dropped, with the columns, on a database
        // that has not had 003 run against it.
        const version = hasProvenance && Number.isFinite(Number(rulesVersion))
          ? `&rules_version=eq.${Math.floor(Number(rulesVersion))}` : '';
        return request(
          `/scores?select=name,score,fireflies,seconds,level_slug,created_at${filter}${version}`
          + `&order=score.desc,created_at.asc&limit=${n}`,
        );
      };
      let res = await ask();
      if (!res.ok && hasProvenance && missingColumn(res)) { hasProvenance = false; res = await ask(); }
      if (!res.ok) return res;
      return { ok: true, rows: Array.isArray(res.data) ? res.data : [] };
    },

    // Where a score comes on the board, when it is not in the top ten.
    //
    // Counting the rows ABOVE it rather than reading a page of the board: one
    // row of payload whatever the board's size, and it is the same arithmetic
    // the board itself does. `Prefer: count=exact` is what makes PostgREST put
    // the total in Content-Range.
    async rankOf({ score, levelSlug = null, rulesVersion = null }) {
      const n = Math.floor(Number(score));
      if (!Number.isFinite(n)) return { ok: false, reason: 'no score to place' };
      const filter = isLevelSlug(levelSlug) ? `&level_slug=eq.${encodeURIComponent(levelSlug)}` : '';
      // Counted over the SAME set the board is drawn from, or the placing is a
      // number from one leaderboard printed under a list from another.
      const ask = async () => {
        const version = hasProvenance && Number.isFinite(Number(rulesVersion))
          ? `&rules_version=eq.${Math.floor(Number(rulesVersion))}` : '';
        return request(
          `/scores?select=id&score=gt.${n}${filter}${version}&limit=1`,
          { prefer: 'count=exact' },
        );
      };
      let res = await ask();
      if (!res.ok && hasProvenance && missingColumn(res)) { hasProvenance = false; res = await ask(); }
      if (!res.ok) return res;
      const above = countFrom(res);
      if (above === null) return { ok: false, reason: 'the board did not say' };
      return { ok: true, rank: above + 1 };
    },

    // POST /rest/v1/scores. `return=minimal` because nothing is read back: the
    // row is exactly what was sent, and where it landed on the board is a
    // different question answered by rankOf.
    async postScore(fields) {
      const send = async () => {
        const built = scoreRow(hasProvenance ? fields : { ...fields, rulesVersion: null, seed: null, caughtBy: null });
        if (!built.ok) return { ok: false, reason: built.problem, built };
        const res = await request('/scores', {
          method: 'POST',
          body: built.row,
          prefer: 'return=minimal',
          timeout: writeTimeout,
        });
        return { ...res, built };
      };

      let res = await send();
      if (!res.ok && hasProvenance && missingColumn(res)) {
        // The migration has not been run. The score itself is still a score.
        hasProvenance = false;
        res = await send();
      }
      if (!res.ok) return { ok: false, status: res.status, code: res.code, reason: res.reason };
      return { ok: true, row: res.built.row };
    },
  };

  return api;
}

// The instance the pages use. Built once, on first use rather than at import,
// so that pulling a pure function out of this module in a test or a node script
// does not construct a client against the live project.
let shared = null;

// HOW THE SIGNED IN HALF REACHES THE ANONYMOUS HALF WITHOUT AN IMPORT.
//
// This module must not import src/net/auth.js. Doing so would pull the auth
// library into every page that reads a score, and /lab/ has no sign in button
// and no use for 24 KB of one. So the editor hands its token function DOWN to
// the client instead, and a page that never calls this stays exactly as
// anonymous and as small as it was.
let tokenProvider = null;
export function useTokens(fn) {
  tokenProvider = typeof fn === 'function' ? fn : null;
}

export function client() {
  // The arrow, rather than tokenProvider itself, so that a client built before
  // anybody signed in still picks up the token afterwards.
  if (!shared) shared = createClient({ token: () => (tokenProvider ? tokenProvider() : null) });
  return shared;
}

// THE ONE PLACE THAT THROWS, and it throws because its caller wants it to.
//
// src/game/scene.js loads a level before it builds a renderer, and a level that
// will not load has to stop the page and say so: silently playing a different
// graveyard than the one somebody was sent is worse than an error card. That is
// already how a missing file behaves there, so a missing code behaves the same
// way through the same catch.
export async function fetchPublishedDoc(slug) {
  const res = await client().fetchLevel(slug);
  if (!res.ok) throw new Error(res.reason);
  return res.level.doc;
}
