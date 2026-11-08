import test from 'node:test';
import assert from 'node:assert/strict';
import { appleMapsUrl, googleMapsUrl, otherAppUrl, regionAround, regionFitting } from '../maps.ts';
import { AREAS } from '../areas.ts';
import { demoListings } from '../demo.ts';
import { distanceKm } from '../geo.ts';

const home = { lat: 59.3137, lng: 18.079, label: 'Åsögatan 58' };
const spot = { lat: 59.3141, lng: 18.0736 };

test('Apple Maps: walking directions to the coordinates, labelled', () => {
  const u = new URL(appleMapsUrl(home));
  assert.equal(u.host, 'maps.apple.com');
  assert.equal(u.searchParams.get('daddr'), '59.3137,18.079');
  assert.equal(u.searchParams.get('dirflg'), 'w');
  assert.equal(u.searchParams.get('q'), 'Åsögatan 58');
  assert.equal(u.searchParams.has('saddr'), false, 'without a start, Maps uses where the phone is');
  assert.equal(new URL(appleMapsUrl(home, spot)).searchParams.get('saddr'), '59.3141,18.0736');
});

test('Google Maps: walking, optional start, stops in order', () => {
  const u = new URL(googleMapsUrl(home, spot, [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('destination'), '59.3137,18.079');
  assert.equal(u.searchParams.get('travelmode'), 'walking');
  assert.equal(u.searchParams.get('origin'), '59.3141,18.0736');
  assert.equal(u.searchParams.get('waypoints'), '1,2|3,4');
  assert.equal(new URL(googleMapsUrl(home)).searchParams.has('origin'), false);
});

test('Android geo link names the place', () => {
  assert.equal(otherAppUrl(home), 'geo:59.3137,18.079?q=59.3137,18.079(%C3%85s%C3%B6gatan%2058)');
});

test('map framing covers the search radius and every pin', () => {
  const r = regionAround(spot, 3);
  assert.ok(r.latitudeDelta / 2 * 110.57 > 3, 'half the height spans the radius');
  const pts = [{ lat: 59.30, lng: 18.0 }, { lat: 59.35, lng: 18.1 }];
  const f = regionFitting(pts, spot);
  for (const p of pts) {
    assert.ok(Math.abs(p.lat - f.latitude) < f.latitudeDelta / 2);
    assert.ok(Math.abs(p.lng - f.longitude) < f.longitudeDelta / 2);
  }
  assert.deepEqual(regionFitting([], spot), regionAround(spot, 2));
});

test('demo homes sit close to their street, inside their area', () => {
  for (const l of demoListings('2026-11-08')) {
    const area = AREAS.find((a) => a.id === l.area)!;
    const street = area.streets.find(([name]) => l.address.startsWith(name))!;
    assert.ok(street, `${l.address} is on a known street`);
    assert.ok(distanceKm(l, { lat: street[1], lng: street[2] }) < 0.06, `${l.address} is within 60 m of its street point`);
    assert.ok(distanceKm(l, area) < 3.5, `${l.address} is in ${area.name}`);
  }
});
