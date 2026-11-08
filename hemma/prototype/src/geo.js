// Distances are great-circle; walking time adds a detour factor because
// streets are never a straight line between two doors.

const EARTH_KM = 6371;
const WALK_KMH = 5;
const DETOUR = 1.2;

const rad = (deg) => (deg * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export function walkMinutes(km) {
  return Math.max(1, Math.round(((km * DETOUR) / WALK_KMH) * 60));
}

// Local flat projection around a centre, in kilometres east (x) and north (y).
// Within a city this is accurate to a few metres, which is all the map needs.
export function toLocalKm(center, p) {
  const x = (p.lng - center.lng) * 111.32 * Math.cos(rad(center.lat));
  const y = (p.lat - center.lat) * 110.57;
  return { x, y };
}

export function offsetKm(center, dxKm, dyKm) {
  return {
    lat: center.lat + dyKm / 110.57,
    lng: center.lng + dxKm / (111.32 * Math.cos(rad(center.lat))),
  };
}
