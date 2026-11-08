-- Run once in the SQL editor after deploying, with your project's URL and the
-- same INGEST_SECRET you set on the Edge Functions. Polls pull feeds every 15
-- minutes, and tidies unpaid holds every hour.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<the INGEST_SECRET value>', 'ingest_secret');

select cron.schedule('hemma-ingest-feeds', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ingest-feeds',
    headers := jsonb_build_object('x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')),
    timeout_milliseconds := 120000
  )
$$);

select cron.schedule('hemma-expire-holds', '7 * * * *', $$
  update public.promotions set status = 'expired' where status = 'pending_payment' and hold_until < now()
$$);
