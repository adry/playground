// A FAKE SUPABASE, and the only thing either check in this directory can be run
// against.
//
// The live project cannot be reached from where this code is written, so this
// stands in for it: the endpoints the client uses, the response shapes PostgREST
// and GoTrue actually produce, and every constraint and POLICY in
// supabase/schema.sql and supabase/002-accounts.sql, enforced the way postgres
// would enforce them. It is written from the wire format rather than from the
// client, so a client that agrees with it is a client that agrees with
// something other than itself.
//
// THE POLICIES ARE THE POINT. Since 002 a level belongs to somebody and a write
// carries a person's access token rather than the anonymous key. The two ways
// that goes wrong are both invisible from the outside: sending the publishable
// key as the bearer, which quietly makes every request anonymous, and forgetting
// the owner column, which quietly fails a `with check`. So this file reads the
// bearer, works out the uid the way postgres would read auth.uid(), and refuses
// exactly what the policies refuse.
//
// It also answers CORS the way the Supabase gateway does, because a browser
// talking to it is talking cross origin and that is half of what the browser
// check is for.

import http from 'node:http';

export const KEY = 'sb_publishable_TESTKEY';

// --- tokens ---------------------------------------------------------------------
//
// A real access token, structurally: three base64url parts with a JSON payload
// carrying `sub`, which is what postgres reads as auth.uid(). Not signed and not
// checked, because nothing here is a security boundary, but shaped correctly so
// that a client which decodes it is exercised rather than accommodated.

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function makeToken(uid, { ttl = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: uid, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + ttl }),
    'not-a-real-signature',
  ].join('.');
}

function uidFromToken(token) {
  if (!token || token === KEY) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.sub || null;
  } catch {
    return null;
  }
}

// `legacy: true` is the project as it stands before somebody runs
// 002-accounts.sql: the tables from schema.sql and not one column more. It
// exists so the sentence the owner sees in that window can be checked, because
// that window is real and they are the only person who can close it.
export function makeFake({ rejectKey = false, legacy = false } = {}) {
  const levels = [];
  const scores = [];
  const seen = [];
  const users = new Map();     // email -> { id, email, password }
  const sessions = new Map();  // refresh_token -> uid

  function userFor(email, password) {
    if (!users.has(email)) {
      users.set(email, { id: `uid-${users.size + 1}`, email, password });
    }
    return users.get(email);
  }

  function sessionFor(user, { ttl = 3600 } = {}) {
    const refresh = `refresh-${user.id}-${sessions.size}`;
    sessions.set(refresh, user.id);
    return {
      access_token: makeToken(user.id, { ttl }),
      token_type: 'bearer',
      expires_in: ttl,
      expires_at: Math.floor(Date.now() / 1000) + ttl,
      refresh_token: refresh,
      user: {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  }

  const server = http.createServer((req, res) => {
    // CORS, exactly as the Supabase gateway answers it. Two things here are
    // load bearing and neither is guessable from the client's source:
    //
    //   the PREFLIGHT. A POST carrying Content-Type: application/json with an
    //   apikey header is not a simple request, so the browser sends OPTIONS
    //   first and will not send the POST at all unless this answers.
    //   EXPOSING Content-Range. A cross origin response's headers are hidden
    //   from javascript unless they are named here, and Content-Range is where
    //   the row count that puts a player 47th comes from. Without this line
    //   every other part of the board works and only the placing goes missing,
    //   which is the sort of bug that survives a release.
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    // ECHOED, not listed. The gateway allows whatever the browser asks for, and
    // a list written by hand is a list that goes stale: the auth library sends
    // `x-supabase-api-version` and `x-client-info` as well as the obvious four,
    // and a fake that named only the obvious four failed a preflight the real
    // project would have passed. That is the fake being wrong about the world,
    // which is the one thing a fake must never be.
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'apikey,authorization,content-type,prefer,accept',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range,content-location');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://fake');
      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }

      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const uid = uidFromToken(bearer);
      seen.push({ method: req.method, path: req.url, headers: { ...req.headers }, body, uid, bearer });

      const send = (status, payload, headers = {}) => {
        const text = payload === null || payload === undefined ? '' : JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(text);
      };

      // The gateway checks the apikey header before anything else, and it is
      // always the publishable key, signed in or not.
      if (rejectKey || req.headers.apikey !== KEY) {
        send(401, { message: 'Invalid API key', code: null, details: null, hint: null });
        return;
      }

      // --- GoTrue ------------------------------------------------------------
      if (url.pathname.startsWith('/auth/v1/')) {
        const what = url.pathname.replace('/auth/v1/', '');
        if (what === 'signup') {
          if (users.has(body.email)) {
            send(400, { error: 'user_already_exists', error_description: 'User already registered', msg: 'User already registered', message: 'User already registered' });
            return;
          }
          send(200, sessionFor(userFor(body.email, body.password)));
          return;
        }
        if (what === 'token') {
          const grant = url.searchParams.get('grant_type');
          if (grant === 'password') {
            const user = users.get(body.email);
            if (!user || user.password !== body.password) {
              send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
              return;
            }
            send(200, sessionFor(user));
            return;
          }
          if (grant === 'refresh_token') {
            const who = sessions.get(body.refresh_token);
            const user = [...users.values()].find((u) => u.id === who);
            if (!user) { send(400, { error: 'invalid_grant', message: 'Invalid Refresh Token' }); return; }
            send(200, sessionFor(user));
            return;
          }
        }
        if (what === 'user') {
          const user = [...users.values()].find((u) => u.id === uid);
          if (!user) { send(401, { message: 'invalid claim: missing sub claim' }); return; }
          send(200, sessionFor(user).user);
          return;
        }
        if (what === 'logout') { send(204, null); return; }
        send(404, { message: `no such auth route ${what}` });
        return;
      }

      // --- PostgREST ------------------------------------------------------------
      const table = url.pathname.replace('/rest/v1/', '');
      const prefer = String(req.headers.prefer || '');
      const wantsRow = prefer.includes('return=representation');
      const eqOf = (name) => {
        const v = url.searchParams.get(name);
        return v === null ? null : v.replace(/^eq\./, '');
      };

      if (req.method === 'GET' && table === 'levels') {
        // The SELECT policy: public, or mine.
        let rows = levels.filter((l) => l.is_public || (uid && l.owner === uid));
        const bySlug = eqOf('slug');
        if (bySlug) rows = rows.filter((l) => l.slug === bySlug);
        const byOwner = eqOf('owner');
        if (byOwner) rows = rows.filter((l) => l.owner === byOwner);
        const order = url.searchParams.get('order');
        if (order === 'updated_at.desc') rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        const limit = Number(url.searchParams.get('limit') || 1000);
        rows = rows.slice(0, limit);
        // A select= list is honoured, because a client asking for a column the
        // table does not have has to fail here rather than be quietly indulged.
        const select = (url.searchParams.get('select') || '*').split(',');
        const shaped = rows.map((r) => {
          if (select[0] === '*') return r;
          const out = {};
          for (const c of select) {
            if (!(c in r)) return { __badColumn: c };
            out[c] = r[c];
          }
          return out;
        });
        const bad = shaped.find((r) => r && r.__badColumn);
        if (bad) { send(400, { code: '42703', message: `column levels.${bad.__badColumn} does not exist` }); return; }
        send(200, shaped, { 'content-range': shaped.length ? `0-${shaped.length - 1}/*` : '*/0' });
        return;
      }

      if (req.method === 'POST' && table === 'levels') {
        const row = body || {};
        for (const c of Object.keys(row)) {
          const known = legacy ? ['slug', 'name', 'author', 'doc'] : ['slug', 'name', 'author', 'doc', 'owner', 'is_public'];
          if (!known.includes(c)) {
            send(400, { code: 'PGRST204', message: `Column '${c}' of relation 'levels' does not exist` });
            return;
          }
        }
        // The INSERT policy: `to authenticated with check (owner = auth.uid())`.
        // No token means the anonymous role, which the policy does not name at
        // all, so postgres refuses before any constraint is looked at.
        if (!uid) {
          send(401, { code: '42501', message: 'new row violates row-level security policy for table "levels"' });
          return;
        }
        if (row.owner !== uid) {
          send(403, { code: '42501', message: 'new row violates row-level security policy for table "levels"' });
          return;
        }
        if (!/^[a-z0-9]{6,16}$/.test(row.slug || '')) {
          send(400, { code: '23514', message: 'new row violates check constraint "levels_slug_check"' });
          return;
        }
        if (levels.some((l) => l.slug === row.slug)) {
          send(409, {
            code: '23505',
            details: `Key (slug)=(${row.slug}) already exists.`,
            hint: null,
            message: 'duplicate key value violates unique constraint "levels_slug_key"',
          });
          return;
        }
        if (!row.name || row.name.length > 60) {
          send(400, { code: '23514', message: 'new row violates check constraint "levels_name_check"' });
          return;
        }
        if (row.author != null && String(row.author).length > 40) {
          send(400, { code: '23514', message: 'new row violates check constraint "levels_author_check"' });
          return;
        }
        if (!row.doc || typeof row.doc !== 'object') {
          send(400, { code: '23502', message: 'null value in column "doc" violates not-null constraint' });
          return;
        }
        if (JSON.stringify(row.doc).length >= 524288) {
          send(400, { code: '23514', message: 'new row violates check constraint "levels_doc_check"' });
          return;
        }
        const now = new Date().toISOString();
        const stored = {
          id: `id-${levels.length}`,
          author: null,
          is_public: false,
          created_at: now,
          updated_at: now,
          ...row,
        };
        levels.push(stored);
        // return=representation gives the stored row back, as an ARRAY, because
        // the request body was a bare object and not `Accept:
        // application/vnd.pgrst.object+json`. return=minimal gives 201 and an
        // empty body. Both are what the real thing does and both are exercised.
        if (wantsRow) send(201, [stored]);
        else { res.writeHead(201, { 'content-type': 'application/json' }); res.end(); }
        return;
      }

      if ((req.method === 'PATCH' || req.method === 'DELETE') && table === 'levels') {
        const bySlug = eqOf('slug');
        // The UPDATE and DELETE policies are own-rows-only. A row that is not
        // yours is not refused, it is INVISIBLE: the statement matches nothing
        // and postgres says it changed nothing, which is a 200 with an empty
        // array and not an error. The client has to notice that.
        const hit = levels.filter((l) => l.slug === bySlug && uid && l.owner === uid);
        if (req.method === 'DELETE') {
          for (const row of hit) levels.splice(levels.indexOf(row), 1);
          if (wantsRow) send(200, hit);
          else { res.writeHead(204); res.end(); }
          return;
        }
        const changes = body || {};
        for (const c of Object.keys(changes)) {
          if (!['name', 'author', 'doc', 'is_public'].includes(c)) {
            // owner is deliberately not in that list: the policy's WITH CHECK
            // refuses a row that changes hands.
            if (c === 'owner' && changes.owner !== uid) {
              send(403, { code: '42501', message: 'new row violates row-level security policy for table "levels"' });
              return;
            }
            send(400, { code: 'PGRST204', message: `Column '${c}' of relation 'levels' does not exist` });
            return;
          }
        }
        for (const row of hit) {
          Object.assign(row, changes);
          // The trigger in 002-accounts.sql, which is why the client never
          // sends this column itself.
          row.updated_at = new Date(Date.now() + 1).toISOString();
        }
        if (wantsRow) send(200, hit);
        else { res.writeHead(204); res.end(); }
        return;
      }

      if (req.method === 'GET' && table === 'scores') {
        let rows = scores.slice();
        const bySlug = eqOf('level_slug');
        if (bySlug) rows = rows.filter((r) => r.level_slug === bySlug);
        const gt = url.searchParams.get('score');
        if (gt) rows = rows.filter((r) => r.score > Number(gt.replace(/^gt\./, '')));
        const order = url.searchParams.get('order');
        if (order === 'score.desc,created_at.asc') {
          rows.sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
        }
        const total = rows.length;
        const limit = Number(url.searchParams.get('limit') || 1000);
        rows = rows.slice(0, limit);
        // Content-Range carries the total only when the request asked for a
        // count; otherwise the third field is a star. Getting this wrong in the
        // fake would hide a client that reads the wrong number.
        const exact = prefer.includes('count=exact');
        const range = rows.length
          ? `0-${rows.length - 1}/${exact ? total : '*'}`
          : `*/${exact ? total : '0'}`;
        send(200, rows, { 'content-range': range });
        return;
      }

      if (req.method === 'POST' && table === 'scores') {
        const row = body || {};
        const bad = (c, m) => send(400, { code: c, message: m, details: null, hint: null });
        for (const c of Object.keys(row)) {
          if (!['name', 'score', 'fireflies', 'seconds', 'level_slug', 'owner'].includes(c)) {
            return bad('PGRST204', `Column '${c}' of relation 'scores' does not exist`);
          }
        }
        // The score policy: a guest may post with no owner, a signed in player
        // only as themselves. Note there is no `to authenticated` on it, which
        // is what keeps the board open to a passer-by.
        if (row.owner != null && row.owner !== uid) {
          return send(403, { code: '42501', message: 'new row violates row-level security policy for table "scores"' });
        }
        if (!row.name || row.name.length > 20) return bad('23514', 'scores_name_check');
        if (!(row.score >= 0 && row.score <= 1000000)) return bad('23514', 'scores_score_check');
        if (!(row.fireflies >= 0 && row.fireflies <= 100000)) return bad('23514', 'scores_fireflies_check');
        if (!(row.seconds >= 0 && row.seconds <= 86400)) return bad('23514', 'scores_seconds_check');
        if (row.fireflies > 5 + row.seconds * 3) return bad('23514', 'scores_check');
        if (row.level_slug != null && !levels.some((l) => l.slug === row.level_slug)) {
          return bad('23503', 'insert or update on table "scores" violates foreign key constraint "scores_level_slug_fkey"');
        }
        scores.push({ id: `s-${scores.length}`, owner: null, created_at: new Date().toISOString(), ...row });
        if (wantsRow) send(201, [scores[scores.length - 1]]);
        else { res.writeHead(201, { 'content-type': 'application/json' }); res.end(); }
        return;
      }

      send(404, { message: `relation "public.${table}" does not exist`, code: '42P01' });
    });
  });

  return { server, levels, scores, seen, users, makeToken };
}

export function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
