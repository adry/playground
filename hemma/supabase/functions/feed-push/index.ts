// Source systems push listing changes here as signed events:
//   POST /functions/v1/feed-push?source=<feed_sources.id>
// See docs/feed-format.md for the body and the signature.
import { json, serviceClient } from '../_shared/http.ts';
import { verify } from '../_shared/feeds/signature.ts';
import { handlePush } from '../_shared/feeds/push.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sourceId = new URL(req.url).searchParams.get('source') ?? '';
  const db = serviceClient();
  const { data: source } = await db.from('feed_sources').select('id, active, mode, auth_secret_name').eq('id', sourceId).maybeSingle();
  if (!source || !source.active || source.mode !== 'push' || !source.auth_secret_name) return json({ error: 'unknown source' }, 404);
  const key = Deno.env.get(source.auth_secret_name);
  if (!key) return json({ error: 'source is not configured' }, 503);

  const body = await req.text();
  const check = await verify(key, req.headers.get('x-hemma-timestamp'), req.headers.get('x-hemma-signature'), body);
  if (!check.ok) return json({ error: check.reason }, 401);

  const { data: areas } = await db.from('areas').select('id, lat, lng');
  const out = await handlePush(body, {
    areas: areas ?? [],
    upsert: async (listings) => {
      const { error } = await db.rpc('ingest_apply', { p_source: source.id, p_listings: listings, p_complete: false });
      if (error) throw new Error(error.message);
    },
    unpublish: async (ids) => {
      const { data, error } = await db.rpc('ingest_unpublish', { p_source: source.id, p_external_ids: ids });
      if (error) throw new Error(error.message);
      return data as number;
    },
  });
  const ok = out.results.filter((r) => r.ok).length;
  await db.from('feed_sources').update({
    last_run_at: new Date().toISOString(),
    last_status: out.status !== 200 ? 'failed' : ok === out.results.length ? 'ok' : 'partial',
    last_error: out.error ?? (out.results.filter((r) => !r.ok).slice(0, 10).map((r) => `${r.externalId}: ${r.reason}`).join('; ') || null),
  }).eq('id', source.id);
  return json(out.error ? { error: out.error } : { results: out.results }, out.status);
});
