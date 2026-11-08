// Links that hand a destination to Apple Maps or Google Maps, and the map
// framing the app uses. Pure, so they are tested in core/test/maps.test.ts.
import type { LatLng } from './types.ts';

export interface Destination extends LatLng {
  label: string;
}

// Six decimals is about 10 cm, plenty for a front door.
const ll = (p: LatLng) => `${+p.lat.toFixed(6)},${+p.lng.toFixed(6)}`;

// Walking directions in Apple Maps. Without `from`, Maps starts from the
// phone's own position.
export function appleMapsUrl(to: Destination, from?: LatLng | null) {
  const q = new URLSearchParams({ daddr: ll(to), dirflg: 'w', q: to.label });
  if (from) q.set('saddr', ll(from));
  return `https://maps.apple.com/?${q}`;
}

// Walking directions in Google Maps (app if installed, else the website),
// optionally through stops on the way.
export function googleMapsUrl(to: Destination, from?: LatLng | null, via: LatLng[] = []) {
  const q = new URLSearchParams({ api: '1', destination: ll(to), travelmode: 'walking' });
  if (from) q.set('origin', ll(from));
  if (via.length) q.set('waypoints', via.map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}

// Android: lets the phone offer every installed map app.
export function otherAppUrl(to: Destination) {
  return `geo:${ll(to)}?q=${ll(to)}(${encodeURIComponent(to.label)})`;
}

const rad = (d: number) => (d * Math.PI) / 180;

// A map region showing `km` around a point (react-native-maps terms).
export function regionAround(p: LatLng, km: number) {
  return {
    latitude: p.lat,
    longitude: p.lng,
    latitudeDelta: (km * 2.3) / 110.57,
    longitudeDelta: (km * 2.3) / (111.32 * Math.cos(rad(p.lat))),
  };
}

// A region framing every point, with some air around the edges.
export function regionFitting(points: LatLng[], fallback: LatLng) {
  if (!points.length) return regionAround(fallback, 2);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.012, (maxLat - minLat) * 1.35),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.35),
  };
}
