import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, dayCounts, planDay, spotsLeft, statusOf, MAX_SPONSORED } from '../src/feed.js';

const DAY = '2026-11-08';
const at = (h, m = 0, day = 8) => new Date(2026, 10, day, h, m).getTime();
const origin = { lat: 59.3141, lng: 18.0736 };
const near = { mode: 'near', origin, radiusKm: 3 };
const noFilters = { types: [], minRooms: 0, maxPrice: 0, openOnly: false };

let n = 0;
function listing(over = {}) {
  n++;
  return {
    id: `l${n}`, area: 'sodermalm', lat: origin.lat + 0.001 * n, lng: origin.lng, type: 'apartment',
    rooms: 2, price: 4_000_000, viewings: [{ start: at(12), end: at(12, 45), booking: false }], ...over,
  };
}
const promo = (l, tier = 1, from = DAY, to = DAY) => ({ id: `p-${l.id}-${tier}`, listingId: l.id, from, to, tier });

test('sponsored viewings come first and are not repeated below', () => {
  const a = listing({ viewings: [{ start: at(11), end: at(11, 30) }] });
  const b = listing({ viewings: [{ start: at(14), end: at(14, 30) }] });
  const feed = buildFeed({ listings: [a, b], promotions: [promo(b)], day: DAY, now: at(9), place: near, filters: noFilters, origin });
  assert.deepEqual(feed.sponsored.map((i) => i.listing.id), [b.id]);
  assert.deepEqual(feed.organic.map((i) => i.listing.id), [a.id]);
});

test('a boost never shows a home outside the search', () => {
  const far = listing({ lat: 59.40, lng: 17.90 });
  const big = listing({ rooms: 5 });
  const otherDay = listing({ viewings: [{ start: at(12, 0, 9), end: at(12, 30, 9) }] });
  const promos = [promo(far), promo(big), promo(otherDay)];
  const feed = buildFeed({ listings: [far, big, otherDay], promotions: promos, day: DAY, now: at(9), place: near, filters: { ...noFilters, maxPrice: 3_000_000 }, origin });
  assert.equal(feed.sponsored.length, 0);
});

test('an ended viewing is never sponsored', () => {
  const l = listing({ viewings: [{ start: at(10), end: at(10, 30) }] });
  const feed = buildFeed({ listings: [l], promotions: [promo(l)], day: DAY, now: at(11), place: near, filters: noFilters, origin });
  assert.equal(feed.sponsored.length, 0);
  assert.equal(feed.organic[0].status, 'ended');
});

test('at most three sponsored, higher packages first', () => {
  const ls = Array.from({ length: 6 }, () => listing());
  const promos = ls.map((l, i) => promo(l, i === 5 ? 3 : 1));
  const feed = buildFeed({ listings: ls, promotions: promos, day: DAY, now: at(9), place: near, filters: noFilters, origin });
  assert.equal(feed.sponsored.length, MAX_SPONSORED);
  assert.equal(feed.sponsored[0].listing.id, ls[5].id);
  assert.equal(feed.organic.length, 3);
});

test('organic order: on now, then coming up by start, then ended', () => {
  const ended = listing({ viewings: [{ start: at(10), end: at(10, 30) }] });
  const later = listing({ viewings: [{ start: at(15), end: at(15, 30) }] });
  const live = listing({ viewings: [{ start: at(12), end: at(12, 45) }] });
  const soon = listing({ viewings: [{ start: at(12, 50), end: at(13, 20) }] });
  const feed = buildFeed({ listings: [ended, later, live, soon], promotions: [], day: DAY, now: at(12, 20), place: near, filters: noFilters, origin });
  assert.deepEqual(feed.organic.map((i) => i.status), ['live', 'soon', 'later', 'ended']);
});

test('area mode and open-viewing filter', () => {
  const sod = listing();
  const vasa = listing({ area: 'vasastan', lat: 59.34, lng: 18.04 });
  const booked = listing({ viewings: [{ start: at(13), end: at(13, 30), booking: true }] });
  const feed = buildFeed({ listings: [sod, vasa, booked], promotions: [], day: DAY, now: at(9), place: { mode: 'area', areas: ['vasastan'] }, filters: noFilters, origin });
  assert.deepEqual(feed.organic.map((i) => i.listing.id), [vasa.id]);
  const open = buildFeed({ listings: [sod, booked], promotions: [], day: DAY, now: at(9), place: near, filters: { ...noFilters, openOnly: true }, origin });
  assert.deepEqual(open.organic.map((i) => i.listing.id), [sod.id]);
});

test('status for past, today and future days', () => {
  const slots = [{ start: at(12), end: at(12, 30) }];
  assert.equal(statusOf(slots, at(9), DAY).key, 'later');
  assert.equal(statusOf(slots, at(11, 30), DAY).key, 'soon');
  assert.equal(statusOf(slots, at(12, 10), DAY).key, 'live');
  assert.equal(statusOf(slots, at(9, 0, 9), DAY).key, 'ended');
  assert.equal(statusOf(slots, at(9, 0, 7), DAY).key, 'scheduled');
});

test('day counts count a home once per day', () => {
  const l = listing({ viewings: [{ start: at(11), end: at(11, 30) }, { start: at(13), end: at(13, 30) }, { start: at(17, 0, 9), end: at(17, 30, 9) }] });
  const counts = dayCounts({ listings: [l], days: [DAY, '2026-11-09', '2026-11-10'], place: near, filters: noFilters });
  assert.deepEqual(counts, { [DAY]: 1, '2026-11-09': 1, '2026-11-10': 0 });
});

test('three sponsored spots per area and day', () => {
  const ls = Array.from({ length: 4 }, () => listing());
  const promos = ls.slice(0, 2).map((l) => promo(l, 1, '2026-11-07', '2026-11-09'));
  assert.equal(spotsLeft({ promotions: promos, listings: ls, area: 'sodermalm', day: DAY }), 1);
  assert.equal(spotsLeft({ promotions: promos, listings: ls, area: 'sodermalm', day: '2026-11-10' }), 3);
  assert.equal(spotsLeft({ promotions: promos, listings: ls, area: 'vasastan', day: DAY }), 3);
});

test('day plan warns when a walk makes you miss a viewing', () => {
  const a = listing({ lat: 59.3141, lng: 18.0736, viewings: [{ start: at(12), end: at(12, 30) }] });
  const close = listing({ lat: 59.3160, lng: 18.0736, viewings: [{ start: at(12, 30), end: at(13) }] });
  const far = listing({ lat: 59.3500, lng: 18.0736, viewings: [{ start: at(12, 25), end: at(12, 50) }] });
  const plan = planDay({
    entries: [{ listingId: close.id, start: at(12, 30) }, { listingId: a.id, start: at(12) }],
    listings: [a, close, far], origin,
  });
  assert.deepEqual(plan.stops.map((s) => s.listing.id), [a.id, close.id]);
  assert.equal(plan.stops[1].warning, null);
  const tight = planDay({ entries: [{ listingId: a.id, start: at(12) }, { listingId: far.id, start: at(12, 25) }], listings: [a, far], origin });
  assert.equal(tight.stops[1].warning.kind, 'miss');
});
