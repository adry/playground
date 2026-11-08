import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hemmaXml } from '../functions/_shared/feeds/adapters/hemma-xml.ts';
import { hemmaJson } from '../functions/_shared/feeds/adapters/hemma-json.ts';
import { homeType, normalize, toInstant } from '../functions/_shared/feeds/normalize.ts';
import { runSource } from '../functions/_shared/feeds/run.ts';

const AREAS = [
  { id: 'sodermalm', lat: 59.3142, lng: 18.0716 },
  { id: 'bromma', lat: 59.337, lng: 17.94 },
];
const NOW = Date.UTC(2026, 10, 8, 12);

test('local Swedish times become instants, in winter and summer', () => {
  assert.equal(toInstant('2026-11-15 13:00')?.toISOString(), '2026-11-15T12:00:00.000Z');
  assert.equal(toInstant('2026-06-14T13:00')?.toISOString(), '2026-06-14T11:00:00.000Z');
  assert.equal(toInstant('2026-11-15T13:00:00+01:00')?.toISOString(), '2026-11-15T12:00:00.000Z');
  assert.equal(toInstant('soon'), null);
});

test('Swedish home types', () => {
  assert.equal(homeType('Bostadsrättslägenhet'), 'apartment');
  assert.equal(homeType('Kedjehus'), 'townhouse');
  assert.equal(homeType('Villa'), 'house');
  assert.equal(homeType('Tomt'), 'other');
});

test('the XML feed parses and normalizes, rejecting what cannot be shown', async () => {
  const raws = hemmaXml.parse(await readFile(new URL('./fixtures/feed.xml', import.meta.url), 'utf8'));
  assert.equal(raws.length, 3);
  const { ok, rejected } = normalize(raws, AREAS, NOW);
  assert.deepEqual(rejected, [{ externalId: 'KV-1003', reason: 'no usable coordinates' }]);
  const [flat, villa] = ok;
  assert.equal(flat.area, 'sodermalm');
  assert.equal(flat.agencyOrgNumber, '5566778899');
  assert.equal(flat.agentPhone, '0701740610');
  assert.equal(flat.rooms, 2.5);
  assert.equal(flat.price, 5250000);
  assert.equal(flat.style, 'stenstad');
  assert.deepEqual(flat.images, ['https://img.example/a.jpg'], 'plain http images are dropped');
  assert.deepEqual(flat.viewings.map((v) => [v.start, v.booking]), [
    ['2026-11-15T12:00:00.000Z', false],
    ['2026-11-16T16:30:00.000Z', true],
  ]);
  assert.equal(villa.type, 'house');
  assert.equal(villa.style, 'villa');
  assert.equal(villa.area, 'bromma');
  assert.equal(villa.viewings[0].end, '2026-11-15T10:45:00.000Z', 'a viewing without an end gets 45 minutes');
});

test('the JSON feed accepts a bare array or { listings }', () => {
  const one = { externalId: 'x', address: 'A 1', lat: 59.31, lng: 18.07, agencyName: 'A' };
  assert.equal(hemmaJson.parse(JSON.stringify([one])).length, 1);
  assert.equal(hemmaJson.parse(JSON.stringify({ listings: [one, one] })).length, 2);
  const { ok, rejected } = normalize(hemmaJson.parse(JSON.stringify([one, one])), AREAS, NOW);
  assert.equal(ok.length, 1);
  assert.equal(rejected[0].reason, 'id appears twice in the feed');
  assert.throws(() => hemmaJson.parse('{"homes": []}'), /expected an array/);
});

function deps(body: string, held: number, status = 200) {
  const calls: { complete: boolean; n: number }[] = [];
  return {
    calls,
    deps: {
      fetch: (async () => new Response(body, { status })) as typeof fetch,
      secret: (n: string) => (n === 'KVARTER_TOKEN' ? 't0ken' : undefined),
      areas: AREAS,
      activeCount: async () => held,
      apply: async (_id: string, listings: unknown[], complete: boolean) => {
        calls.push({ complete, n: listings.length });
        return { upserted: listings.length, viewings: 0, removed: complete ? 1 : 0 };
      },
      now: NOW,
    },
  };
}
const source = { id: 's1', name: 'Kvarter', format: 'hemma-json', url: 'https://feed.example', auth_secret_name: null };
const homes = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ externalId: `h${i}`, address: `A ${i}`, lat: 59.31, lng: 18.07, agencyName: 'A' })));

test('a run stores a full feed and removes what left it', async () => {
  const d = deps(homes(10), 10);
  const r = await runSource(source, d.deps);
  assert.equal(r.status, 'ok');
  assert.deepEqual(d.calls, [{ complete: true, n: 10 }]);
});

test('a feed that suddenly shrinks is stored without removing anything', async () => {
  const d = deps(homes(3), 40);
  const r = await runSource(source, d.deps);
  assert.equal(r.status, 'partial');
  assert.deepEqual(d.calls, [{ complete: false, n: 3 }]);
  assert.match(r.error ?? '', /3 homes against 40/);
});

test('broken feeds fail without touching stored homes', async () => {
  for (const [body, status, msg] of [['nope', 200, /JSON|Unexpected/], ['', 503, /503/]] as const) {
    const d = deps(body, 10, status);
    const r = await runSource(source, d.deps);
    assert.equal(r.status, 'failed');
    assert.match(r.error ?? '', msg);
    assert.equal(d.calls.length, 0);
  }
  const missing = await runSource({ ...source, auth_secret_name: 'NOPE' }, deps(homes(1), 0).deps);
  assert.match(missing.error ?? '', /secret NOPE is not set/);
});
