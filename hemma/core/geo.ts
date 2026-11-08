// Distances are great-circle; walking time adds a detour factor because
// streets are never a straight line between two doors.
import type { LatLng } from './types.ts';

const EARTH_KM = 6371;
const WALK_KMH = 5;
const DETOUR = 1.2;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export function walkMinutes(km: number): number {
  return Math.max(1, Math.round(((km * DETOUR) / WALK_KMH) * 60));
}

// Local flat projection around a centre, in kilometres east (x) and north (y).
export function toLocalKm(center: LatLng, p: LatLng) {
  return {
    x: (p.lng - center.lng) * 111.32 * Math.cos(rad(center.lat)),
    y: (p.lat - center.lat) * 110.57,
  };
}

export function offsetKm(center: LatLng, dxKm: number, dyKm: number): LatLng {
  return {
    lat: center.lat + dyKm / 110.57,
    lng: center.lng + dxKm / (111.32 * Math.cos(rad(center.lat))),
  };
}

// Bounding box around a point, for asking the backend only for nearby homes.
export function bbox(center: LatLng, km: number) {
  const dLat = km / 110.57;
  const dLng = km / (111.32 * Math.cos(rad(center.lat)));
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng };
}
