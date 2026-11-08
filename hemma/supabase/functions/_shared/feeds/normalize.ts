// Turns loosely typed listings from any adapter into FeedListing, or rejects
// them with a reason the admin can read in the feed run log.

import type { AreaRef, FeedListing, FeedViewing, HomeType, RawListing, Rejected } from './types.ts';

const TZ = 'Europe/Stockholm';
const MAX_VIEWING_MIN = 6 * 60;
const DEFAULT_VIEWING_MIN = 45;
const AREA_MATCH_KM = 2.5;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v: unknown) => {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
};

const bool = (v: unknown) => v === true || v === 1 || /^(true|1|yes|ja)$/i.test(String(v ?? ''));

// Swedish and English names for the kinds of home a feed may send.
const TYPE_WORDS: [RegExp, HomeType][] = [
  [/radhus|kedjehus|parhus|townhouse|terrace/i, 'townhouse'],
  [/villa|fritidshus|gård|house|detached/i, 'house'],
  [/lägenhet|bostadsrätt|hyresrätt|apartment|flat|condo|ägarlägenhet/i, 'apartment'],
];

export function homeType(v: unknown): HomeType {
  const s = str(v);
  if (!s) return 'other';
  for (const [re, t] of TYPE_WORDS) if (re.test(s)) return t;
  return 'other';
}

// Which drawn facade to use when a home has no photos.
export function facadeStyle(type: HomeType, built: number | null): string {
  if (type === 'house') return 'villa';
  if (type === 'townhouse') return 'radhus';
  if (built == null) return 'stenstad';
  if (built < 1930) return 'stenstad';
  if (built < 1965) return 'funkis';
  return 'modern';
}

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60000);
}

// Feeds often send local Swedish time without an offset ("2026-11-15 13:00").
// Those are read as Stockholm time; anything with Z or an offset is kept.
export function toInstant(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, se || 0);
  const first = guess - tzOffsetMinutes(guess, TZ) * 60000;
  const settled = guess - tzOffsetMinutes(first, TZ) * 60000;
  return new Date(settled);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestArea(p: { lat: number; lng: number }, areas: AreaRef[]): string | null {
  let best: AreaRef | null = null;
  let bestKm = Infinity;
  for (const a of areas) {
    const km = distanceKm(p, a);
    if (km < bestKm) {
      best = a;
      bestKm = km;
    }
  }
  return best && bestKm <= AREA_MATCH_KM ? best.id : null;
}

function viewingsOf(raw: RawListing, now: number): FeedViewing[] {
  const out: FeedViewing[] = [];
  for (const v of raw.viewings ?? []) {
    const start = toInstant(v.start ?? v.startsAt ?? v.from);
    if (!start) continue;
    let end = toInstant(v.end ?? v.endsAt ?? v.to);
    if (!end || end <= start) end = new Date(start.getTime() + DEFAULT_VIEWING_MIN * 60000);
    if (end.getTime() - start.getTime() > MAX_VIEWING_MIN * 60000) continue;
    if (end.getTime() < now - 86400000) continue; // long past, nothing to show
    out.push({
      start: start.toISOString(),
      end: end.toISOString(),
      booking: bool(v.booking ?? v.bookingRequired ?? v.bokning),
      bookingUrl: str(v.bookingUrl ?? v.bokningslank),
    });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : 1));
  return out.filter((v, i) => i === 0 || v.start !== out[i - 1].start);
}

const httpsOnly = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

export function normalize(raws: RawListing[], areas: AreaRef[], now = Date.now()) {
  const ok: FeedListing[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const externalId = str(raw.externalId ?? raw.id);
    const reject = (reason: string) => rejected.push({ externalId: externalId ?? '(missing id)', reason });
    if (!externalId) { reject('no id'); continue; }
    if (seen.has(externalId)) { reject('id appears twice in the feed'); continue; }
    seen.add(externalId);
    const address = str(raw.address ?? raw.streetAddress);
    if (!address) { reject('no street address'); continue; }
    const lat = numOrNull(raw.lat ?? raw.latitude);
    const lng = numOrNull(raw.lng ?? raw.longitude);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { reject('no usable coordinates'); continue; }
    const agencyName = str(raw.agencyName);
    if (!agencyName) { reject('no agency name'); continue; }

    const type = homeType(raw.type ?? raw.objectType);
    const built = intOrNull(raw.built ?? raw.buildYear);
    const images = (Array.isArray(raw.images) ? raw.images : [])
      .map((i) => httpsOnly(str(typeof i === 'object' && i ? (i as Record<string, unknown>).url : i)))
      .filter((u): u is string => !!u)
      .slice(0, 30);

    ok.push({
      externalId,
      agencyName,
      agencyOrgNumber: str(raw.agencyOrgNumber)?.replace(/\D/g, '') || null,
      agentName: str(raw.agentName),
      agentEmail: str(raw.agentEmail),
      agentPhone: str(raw.agentPhone),
      address,
      area: nearestArea({ lat, lng }, areas),
      city: str(raw.city ?? raw.municipality),
      lat,
      lng,
      type,
      tenure: str(raw.tenure),
      rooms: numOrNull(raw.rooms),
      size: numOrNull(raw.size ?? raw.livingArea),
      price: intOrNull(raw.price ?? raw.askingPrice),
      fee: intOrNull(raw.fee ?? raw.monthlyFee),
      floor: intOrNull(raw.floor),
      floors: intOrNull(raw.floors),
      built,
      description: str(raw.description)?.slice(0, 4000) ?? null,
      images,
      url: httpsOnly(str(raw.url)),
      style: facadeStyle(type, built),
      viewings: viewingsOf(raw, now),
    });
  }
  return { ok, rejected };
}
