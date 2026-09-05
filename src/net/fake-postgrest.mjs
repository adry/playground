// A FAKE POSTGREST, and the only thing either check in this directory can be
// run against.
//
// The live project cannot be reached from where this code is written, so this
// stands in for it: the endpoints the client uses, the response shapes PostgREST
// actually produces, and every constraint in supabase/schema.sql enforced the
// way postgres would enforce it. It is written from the wire format rather than
// from the client, so a client that agrees with it is a client that agrees with
// something other than itself.
//
// It also answers CORS the way the Supabase gateway does, because a browser
// talking to it is talking cross origin and that is half of what the browser
// check is for.

import http from 'node:http';

export const KEY = 'sb_publishable_TESTKEY';

export function makeFake({ rejectKey = false } = {}) {
  const levels = [];
  const scores = [];
  const seen = [];

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
    res.setHeader('Access-Control-Allow-Headers', 'apikey,authorization,content-type,prefer,accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range,content-location');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://fake');
      seen.push({
        method: req.method,
        path: req.url,
        headers: { ...req.headers },
        body: raw ? JSON.parse(raw) : null,
      });

      const send = (status, payload, headers = {}) => {
        const text = payload === null ? '' : JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(text);
      };
      // PostgREST behind the Supabase gateway: no key, no entry.
      if (rejectKey || req.headers.apikey !== KEY) {
        send(401, { message: 'Invalid API key', code: null, details: null, hint: null });
        return;
      }

      const table = url.pathname.replace('/rest/v1/', '');

      if (req.method === 'GET' && table === 'levels') {
        const want = (url.searchParams.get('slug') || '').replace(/^eq\./, '');
        const hit = levels.filter((l) => l.slug === want);
        send(200, hit, { 'content-range': `0-${Math.max(0, hit.length - 1)}/*` });
        return;
      }

      if (req.method === 'POST' && table === 'levels') {
        const row = seen[seen.length - 1].body;
        // Every constraint in schema.sql, in the order postgres would hit them.
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
        if (row.author !== null && String(row.author).length > 40) {
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
        const stored = { id: `id-${levels.length}`, created_at: new Date().toISOString(), ...row };
        levels.push(stored);
        // return=representation gives the stored row back, as an ARRAY, because
        // the request body was a bare object and not `Accept:
        // application/vnd.pgrst.object+json`. return=minimal gives 201 and an
        // empty body. Both are what the real thing does and both are exercised.
        if ((req.headers.prefer || '').includes('return=representation')) send(201, [stored]);
        else { res.writeHead(201, { 'content-type': 'application/json' }); res.end(); }
        return;
      }

      if (req.method === 'GET' && table === 'scores') {
        let rows = scores.slice();
        const bySlug = url.searchParams.get('level_slug');
        if (bySlug) rows = rows.filter((r) => r.level_slug === bySlug.replace(/^eq\./, ''));
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
        const exact = (req.headers.prefer || '').includes('count=exact');
        const range = rows.length
          ? `0-${rows.length - 1}/${exact ? total : '*'}`
          : `*/${exact ? total : '0'}`;
        send(200, rows, { 'content-range': range });
        return;
      }

      if (req.method === 'POST' && table === 'scores') {
        const row = seen[seen.length - 1].body;
        const bad = (c, m) => send(400, { code: c, message: m, details: null, hint: null });
        if (!row.name || row.name.length > 20) return bad('23514', 'scores_name_check');
        if (!(row.score >= 0 && row.score <= 1000000)) return bad('23514', 'scores_score_check');
        if (!(row.fireflies >= 0 && row.fireflies <= 100000)) return bad('23514', 'scores_fireflies_check');
        if (!(row.seconds >= 0 && row.seconds <= 86400)) return bad('23514', 'scores_seconds_check');
        if (row.fireflies > 5 + row.seconds * 3) return bad('23514', 'scores_check');
        if (row.level_slug != null && !levels.some((l) => l.slug === row.level_slug)) {
          return bad('23503', 'insert or update on table "scores" violates foreign key constraint "scores_level_slug_fkey"');
        }
        scores.push({ id: `s-${scores.length}`, created_at: new Date().toISOString(), ...row });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end();
        return;
      }

      send(404, { message: `relation "public.${table}" does not exist`, code: '42P01' });
    });
  });

  return { server, levels, scores, seen };
}


export function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
