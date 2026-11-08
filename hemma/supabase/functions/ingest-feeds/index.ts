// Pulls every active "pull" feed (or one, with ?source=<id>) and stores it.
// Run by pg_cron every 15 minutes; see supabase/setup/schedule.sql.
import { json, serviceClient } from '../_shared/http.ts';
import { runSource, type Source } from '../_shared/feeds/run.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('INGEST_SECRET');
  if (!secret || req.headers.get('x-ingest-secret') !== secret) return json({ error: 'forbidden' }, 403);

  const db = serviceClient();
  const only = new URL(req.url).searchParams.get('source');
  let query = db.from('feed_sources').select('id, name, format, url, auth_secret_name').eq('active', true).eq('mode', 'pull');
  if (only) query = query.eq('id', only);
  const { data: sources, error } = await query;
  if (error) return json({ error: error.message }, 500);
  const { data: areas } = await db.from('areas').select('id, lat, lng');

  const summary = [];
  for (const source of (sources ?? []) as Source[]) {
    const { data: run } = await db.from('feed_runs').insert({ source_id: source.id }).select('id').single();
    const r = await runSource(source, {
      fetch,
      secret: (name) => Deno.env.get(name),
      areas: areas ?? [],
      activeCount: async (id) => {
        const { count } = await db.from('listings').select('id', { count: 'exact', head: true }).eq('source_id', id).eq('status', 'for_sale');
        return count ?? 0;
      },
      apply: async (id, listings, complete) => {
        const { data, error } = await db.rpc('ingest_apply', { p_source: id, p_listings: listings, p_complete: complete });
        if (error) throw new Error(error.message);
        return data;
      },
    });
    const rejectedNote = r.rejected.slice(0, 25).map((x) => `${x.externalId}: ${x.reason}`).join('; ');
    const finished = new Date().toISOString();
    await db.from('feed_runs').update({
      finished_at: finished, status: r.status, seen: r.seen, upserted: r.upserted, removed: r.removed,
      viewings: r.viewings, rejected: r.rejected.length, error: r.error ?? (rejectedNote || null),
    }).eq('id', run?.id);
    await db.from('feed_sources').update({ last_run_at: finished, last_status: r.status, last_error: r.error }).eq('id', source.id);
    summary.push({ source: source.name, status: r.status, upserted: r.upserted, removed: r.removed, rejected: r.rejected.length, error: r.error });
  }
  return json(summary);
});
