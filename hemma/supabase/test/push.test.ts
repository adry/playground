import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../functions/_shared/feeds/signature.ts';
import { handlePush } from '../functions/_shared/feeds/push.ts';

const KEY = 'whsec_test_key';
const NOW = 1794140000;

test('signatures: valid, tampered, replayed, missing', async () => {
  const body = '{"events":[]}';
  const sig = await sign(KEY, NOW, body);
  assert.deepEqual(await verify(KEY, String(NOW), sig, body, NOW + 10), { ok: true, reason: null });
  assert.equal((await verify(KEY, String(NOW), sig, body + ' ', NOW)).reason, 'signature does not match');
  assert.equal((await verify('other', String(NOW), sig, body, NOW)).reason, 'signature does not match');
  assert.equal((await verify(KEY, String(NOW), sig, body, NOW + 301)).reason, 'timestamp too old or in the future');
  assert.equal((await verify(KEY, null, sig, body, NOW)).reason, 'missing x-hemma-timestamp');
  assert.equal((await verify(KEY, String(NOW), null, body, NOW)).reason, 'missing x-hemma-signature');
});

test('a push upserts good homes, reports bad ones and unpublishes', async () => {
  const stored: string[] = [];
  const removed: string[] = [];
  const body = JSON.stringify({
    events: [
      { type: 'listing.upsert', listing: { externalId: 'a', address: 'Götgatan 1', lat: 59.31, lng: 18.07, agencyName: 'A', viewings: [{ start: '2026-11-15 13:00' }] } },
      { type: 'listing.upsert', listing: { externalId: 'b', address: 'Götgatan 2', agencyName: 'A' } },
      { type: 'listing.unpublish', externalId: 'c' },
      { type: 'listing.explode' },
    ],
  });
  const r = await handlePush(body, {
    areas: [{ id: 'sodermalm', lat: 59.3142, lng: 18.0716 }],
    upsert: async (ls) => stored.push(...ls.map((l) => `${l.externalId}@${l.area}:${l.viewings.length}`)),
    unpublish: async (ids) => (removed.push(...ids), ids.length),
    now: Date.UTC(2026, 10, 8),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(stored, ['a@sodermalm:1']);
  assert.deepEqual(removed, ['c']);
  assert.deepEqual(r.results.map((x) => [x.externalId, x.ok]), [['(unknown)', false], ['b', false], ['a', true], ['c', true]]);
});

test('a push that is not a batch is refused whole', async () => {
  const deps = { areas: [], upsert: async () => 0, unpublish: async () => 0 };
  assert.equal((await handlePush('nope', deps)).status, 400);
  assert.equal((await handlePush('{"listings":[]}', deps)).status, 400);
  assert.equal((await handlePush(JSON.stringify({ events: new Array(501).fill({}) }), deps)).status, 413);
});
