import test from 'node:test';
import assert from 'node:assert/strict';
import { demoListings, demoPromotions, demoStats } from '../demo.ts';
import { facadeSVG, DARK_FACADE } from '../facade.ts';
import { buildFeed } from '../feed.ts';
import { NO_FILTERS } from '../types.ts';

const TODAY = '2026-11-08';

test('demo data has viewings today and seeded boosts that reach the feed', () => {
  const listings = demoListings(TODAY);
  const promos = demoPromotions(listings, TODAY);
  assert.ok(listings.length > 60);
  assert.ok(promos.length >= 5);
  const feed = buildFeed({
    listings, promotions: promos, day: TODAY, now: new Date(2026, 10, 8, 9).getTime(),
    place: { mode: 'area', areas: [] }, filters: NO_FILTERS, origin: null,
  });
  assert.ok(feed.total > 20);
  assert.equal(feed.sponsored.length, 3);
});

test('every listing draws a facade in both themes', () => {
  for (const l of demoListings(TODAY)) {
    for (const svg of [facadeSVG(l), facadeSVG(l, DARK_FACADE)]) {
      assert.match(svg, /^<svg[^>]*viewBox="0 0 160 100"/);
      assert.doesNotMatch(svg, /undefined|NaN|class=/);
    }
  }
});

test('demo stats lift on boosted days', () => {
  const l = demoListings(TODAY)[0];
  const days = ['2026-11-08', '2026-11-15'];
  const plain = demoStats(l, days, new Set());
  const boosted = demoStats(l, days, new Set(['2026-11-15']));
  assert.ok(boosted[1].impressions > plain[1].impressions * 2);
});
