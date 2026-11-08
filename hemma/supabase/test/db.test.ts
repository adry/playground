// Runs the migration on a real Postgres (PGlite, in-process) with a stand-in
// for Supabase's auth schema and roles, then walks through the flows that
// matter: feed import, agent application and approval, booking a boost,
// payment, usage tracking, and what each kind of user may read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const MAJA = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000c1';

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hh: string) => `${day(offset)}T${hh}:00Z`;

type Who = 'anon' | 'service' | string;

async function setup() {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of (await readdir(dir)).sort()) await db.exec(await readFile(new URL(f, dir), 'utf8'));

  async function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []) {
    const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
    const sub = who === 'anon' || who === 'service' ? '' : who;
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
    await db.exec(`set role ${role}`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('reset role');
    }
  }

  await db.exec(`
    insert into auth.users values ('${ADMIN}', 'admin@hemma.example'), ('${MAJA}', 'maja@kvarter.example'), ('${OTHER}', 'nils@brygga.example');
    insert into admins values ('${ADMIN}');
    insert into areas values ('sodermalm', 'Södermalm', 'Stockholm', 59.3142, 18.0716), ('vasastan', 'Vasastan', 'Stockholm', 59.3435, 18.0445);
    insert into feed_sources (id, name, format, url) values ('11111111-1111-4111-8111-111111111111', 'Test feed', 'hemma-json', 'https://example.test/feed');
  `);
  return { db, as };
}

const SOURCE = '11111111-1111-4111-8111-111111111111';

function home(externalId: string, over: Record<string, unknown> = {}) {
  return {
    externalId, agencyName: 'Kvarter & Co', agencyOrgNumber: '5566778899', agentName: 'Maja Ek', agentEmail: 'maja@kvarter.example',
    agentPhone: '070-174 06 10', address: `Skånegatan ${externalId}`, area: 'sodermalm', city: 'Stockholm', lat: 59.314, lng: 18.075,
    type: 'apartment', tenure: 'Bostadsrätt', rooms: 2, size: 54, price: 4950000, fee: 3412, floor: 3, floors: 5, built: 1908,
    description: 'Ljus tvåa', images: ['https://img.example/1.jpg'], url: 'https://kvarter.example/1', style: 'stenstad',
    viewings: [{ start: at(2, '11:00'), end: at(2, '11:45'), booking: false }, { start: at(3, '16:00'), end: at(3, '16:30'), booking: true }],
    ...over,
  };
}

const ingest = (as: Awaited<ReturnType<typeof setup>>['as'], items: unknown[], complete = true) =>
  as<{ r: Record<string, number> }>('service', 'select ingest_apply($1, $2::jsonb, $3) as r', [SOURCE, JSON.stringify(items), complete]);

test('feed import upserts homes, replaces viewings and removes homes that left the feed', async () => {
  const { as } = await setup();
  const [first] = await ingest(as, [home('1'), home('2', { area: 'vasastan', lat: 59.343, lng: 18.045 })]);
  assert.deepEqual(first.r, { upserted: 2, viewings: 4, removed: 0 });

  const window = (await as<{ f: any[] }>('anon', `select feed_window(now(), now() + interval '14 days', 59, 60, 17, 19) as f`))[0].f;
  assert.equal(window.length, 2);
  assert.equal(window[0].viewings.length, 2);
  assert.equal(typeof window[0].viewings[0].start, 'number');
  assert.equal(window[0].agency, 'Kvarter & Co');

  const moved = home('1', { viewings: [{ start: at(4, '12:00'), end: at(4, '12:30') }] });
  const [second] = await ingest(as, [moved]);
  assert.deepEqual(second.r, { upserted: 1, viewings: 1, removed: 1 });
  const after = (await as<{ f: any[] }>('anon', `select feed_window(now(), now() + interval '14 days', 59, 60, 17, 19) as f`))[0].f;
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].viewings.map((v: any) => v.booking), [false]);

  const agencies = await as<{ n: number }>('service', 'select count(*)::int as n from agencies where org_number = $1', ['5566778899']);
  assert.equal(agencies[0].n, 1, 'the agency is created once from its org number');
});

test('buyers cannot run the importer or read private tables and columns', async () => {
  const { as } = await setup();
  await ingest(as, [home('1')]);
  for (const who of ['anon', MAJA]) {
    await assert.rejects(as(who, 'select ingest_apply($1, $2::jsonb)', [SOURCE, JSON.stringify([home('x')])]), /permission denied/);
  }
  assert.equal((await as('anon', 'select * from agents')).length, 0);
  assert.equal((await as('anon', 'select * from feed_sources')).length, 0);
  await assert.rejects(as('anon', 'select agent_email from listings'), /permission denied/);
  assert.equal((await as('anon', 'select address from listings')).length, 1);
});

test('an agent applies, waits, is approved, and gets their agency', async () => {
  const { as } = await setup();
  await ingest(as, [home('1')]);
  const [app] = await as<any>(MAJA, `select * from apply_as_agent('Maja Ek', '070-174 06 10', 'Kvarter & Co', '556677-8899', 'FMI-12345')`);
  assert.equal(app.status, 'pending');
  assert.equal(app.org_number, '5566778899');
  assert.equal(app.email, 'maja@kvarter.example');

  await assert.rejects(as(MAJA, `select * from agency_stats(current_date - 7, current_date)`), /only approved agents/);
  await assert.rejects(as(MAJA, `select * from review_agent($1, 'approved')`, [MAJA]), /admins only/);

  const [reviewed] = await as<any>(ADMIN, `select * from review_agent($1, 'approved', 'Checked FMI register')`, [MAJA]);
  assert.equal(reviewed.status, 'approved');
  const [listing] = await as<any>('service', `select agency_id from listings where external_id = '1'`);
  assert.equal(reviewed.agency_id, listing.agency_id, 'approval links the agent to the agency the feed already created');

  const mine = await as<any>(MAJA, `select id from listings`);
  assert.equal(mine.length, 1);
  const pending = await as<any>(OTHER, `select status from agents`);
  assert.equal(pending.length, 0, 'agents only ever see their own application');
});

test('booking a boost: ownership, viewing days, sold-out areas, payment', async () => {
  const { as } = await setup();
  const others = ['a', 'b', 'c'].map((id) => home(id, { agencyOrgNumber: '5560001111', agencyName: 'Brygga Mäkleri' }));
  await ingest(as, [home('1'), home('9', { viewings: [] }), ...others]);
  await as(MAJA, `select apply_as_agent('Maja Ek', null, 'Kvarter & Co', '5566778899', null)`);
  await as(OTHER, `select apply_as_agent('Nils Åberg', null, 'Brygga Mäkleri', '5560001111', null)`);
  await as(ADMIN, `select review_agent($1, 'approved')`, [MAJA]);
  await as(ADMIN, `select review_agent($1, 'approved')`, [OTHER]);
  await as('service', `update agencies set free_boosts = 0`);
  await as('service', `update settings set value = '{"percent": 0, "until": "2000-01-01"}'`);
  const ids = Object.fromEntries((await as<any>('service', 'select external_id, id from listings')).map((r) => [r.external_id, r.id]));

  await assert.rejects(as(OTHER, `select reserve_promotion($1, 'day', $2::date)`, [ids['1'], day(2)]), /not listed by your agency/);
  await assert.rejects(as(MAJA, `select reserve_promotion($1, 'day', $2::date)`, [ids['9'], day(2)]), /no viewings in that period/);
  await assert.rejects(as(MAJA, `select reserve_promotion($1, 'day', $2::date)`, [ids['1'], day(-1)]), /from today on/);

  // Brygga fills all three Södermalm spots for that day.
  for (const id of ['a', 'b', 'c']) {
    const [p] = await as<any>(OTHER, `select (reserve_promotion($1, 'day', $2::date)).id`, [ids[id], day(2)]);
    await as('service', `update promotions set stripe_session_id = $2 where id = $1`, [p.id, `cs_${id}`]);
    await as('service', `select activate_promotion($1)`, [`cs_${id}`]);
  }
  const left = await as<any>(MAJA, `select * from spots_left($1, $2::date, $3::date)`, [ids['1'], day(2), day(4)]);
  assert.deepEqual(left.map((r) => r.left_count), [0, 3]);
  await assert.rejects(as(MAJA, `select reserve_promotion($1, 'weekend', $2::date)`, [ids['1'], day(2)]), /sold out/);

  // The next day is free.
  const [held] = await as<any>(MAJA, `select * from reserve_promotion($1, 'day', $2::date)`, [ids['1'], day(3)]);
  assert.equal(held.status, 'pending_payment');
  assert.equal(held.amount_sek, 249);
  const publicBefore = await as<any>('anon', `select * from active_promotions(current_date, current_date + 14)`);
  assert.equal(publicBefore.length, 3, 'unpaid holds are not shown to buyers');

  await as('service', `update promotions set stripe_session_id = 'cs_maja' where id = $1`, [held.id]);
  await assert.rejects(as(MAJA, `select activate_promotion('cs_maja')`), /permission denied/);
  await as('service', `select activate_promotion('cs_maja')`);
  const publicAfter = await as<any>('anon', `select * from active_promotions(current_date, current_date + 14)`);
  assert.equal(publicAfter.length, 4);
  assert.ok(publicAfter.some((p) => p.listingId === ids['1'] && p.tier === 1));
});

test('usage tracking feeds the agent dashboard, counting each device once a day', async () => {
  const { as } = await setup();
  await ingest(as, [home('1'), home('2', { agencyOrgNumber: '5560001111', agencyName: 'Brygga Mäkleri' })]);
  await as(MAJA, `select apply_as_agent('Maja Ek', null, 'Kvarter & Co', '5566778899', null)`);
  await as(ADMIN, `select review_agent($1, 'approved')`, [MAJA]);
  const ids = Object.fromEntries((await as<any>('service', 'select external_id, id from listings')).map((r) => [r.external_id, r.id]));

  const batch = [
    { kind: 'impression', listingId: ids['1'], sponsored: true, day: day(0) },
    { kind: 'impression', listingId: ids['1'], sponsored: false, day: day(0) },
    { kind: 'open', listingId: ids['1'], day: day(0) },
    { kind: 'save', listingId: ids['1'], day: day(0) },
    { kind: 'impression', listingId: ids['2'], day: day(0) },
    { kind: 'impression', listingId: 'not-a-uuid' },
    { kind: 'hack', listingId: ids['1'] },
  ];
  const [a] = await as<{ n: number }>('anon', `select track($1::jsonb, 'device-a') as n`, [JSON.stringify(batch)]);
  assert.equal(a.n, 5);
  await as('anon', `select track($1::jsonb, 'device-b') as n`, [JSON.stringify(batch.slice(0, 1))]);
  assert.equal((await as('anon', 'select * from events')).length, 0, 'buyers cannot read usage');

  const stats = await as<any>(MAJA, `select * from agency_stats(current_date - 1, current_date + 1)`);
  assert.equal(stats.length, 1, 'only her agency’s homes');
  assert.equal(Number(stats[0].impressions), 2);
  assert.equal(Number(stats[0].sponsored_impressions), 2);
  assert.equal(Number(stats[0].opens), 1);
  assert.equal(Number(stats[0].saves), 1);
});

test('launch offer: free boosts go live at once, then the discount applies', async () => {
  const { as } = await setup();
  await ingest(as, [home('1')]);
  await as(MAJA, `select apply_as_agent('Maja Ek', null, 'Kvarter & Co', '5566778899', null)`);
  await as(ADMIN, `select review_agent($1, 'approved')`, [MAJA]);
  await as('service', `update agencies set free_boosts = 1`);
  await as('service', `update settings set value = '{"percent": 50, "until": "2999-12-31"}'`);
  const [id] = (await as<any>('service', 'select id from listings')).map((r) => r.id);

  const [free] = await as<any>(MAJA, `select * from reserve_promotion($1, 'week', $2::date)`, [id, day(2)]);
  assert.equal(free.status, 'active');
  assert.equal(free.amount_sek, 0);
  assert.equal((await as<any>('anon', `select * from active_promotions(current_date, current_date + 14)`)).length, 1);

  await as('service', `update promotions set status = 'cancelled'`);
  const [paid] = await as<any>(MAJA, `select * from reserve_promotion($1, 'week', $2::date)`, [id, day(2)]);
  assert.equal(paid.status, 'pending_payment');
  assert.equal(paid.amount_sek, 475, 'half of 949, rounded');
});

test('push sources unpublish homes one by one', async () => {
  const { as } = await setup();
  await ingest(as, [home('1'), home('2')]);
  const [r] = await as<any>('service', `select ingest_unpublish($1, array['2', 'unknown']) as n`, [SOURCE]);
  assert.equal(r.n, 1);
  await assert.rejects(as('anon', `select ingest_unpublish($1, array['1'])`, [SOURCE]), /permission denied/);
  assert.equal((await as('anon', 'select id from listings')).length, 1);
});
