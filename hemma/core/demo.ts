// Demo listings and viewings, used until the backend is connected and in the
// dashboard's demo mode. Generated from a fixed seed with viewing dates placed
// relative to "today", so there is always something on.
//
// Agencies, agents and phone numbers are invented. The numbers sit in the
// 070-174 06 xx range that PTS reserves for fiction, so none of them rings.

import { AREAS, type DemoArea } from './areas.ts';
import { offsetKm } from './geo.ts';
import { addDays, dateKey, fromKey, num } from './format.ts';
import { PACKAGE_BY_ID } from './packages.ts';
import type { FacadeStyle, Listing, ListingType, Promotion, Viewing } from './types.ts';

export const DEMO_AGENCIES = [
  { id: 'kvarter', name: 'Kvarter & Co', agents: ['Maja Ek', 'Johan Lind'] },
  { id: 'brygga', name: 'Brygga Mäkleri', agents: ['Sara Holm', 'Nils Åberg'] },
  { id: 'nordljus', name: 'Nordljus Fastighet', agents: ['Erik Sund', 'Amira Haddad'] },
  { id: 'holmhjort', name: 'Holm & Hjort', agents: ['Lina Berg', 'Oskar Dahl'] },
  { id: 'stenstaden', name: 'Stenstaden Mäklare', agents: ['Elin Nord', 'Viktor Ström'] },
  { id: 'sjostad', name: 'Sjöstad Bostad', agents: ['Fatima Karimi', 'Petter Wall'] },
];

export const DEMO_AGENT = { agencyId: 'kvarter', name: 'Maja Ek', email: 'maja.ek@kvarter.example' };

type Rand = () => number;

export function rng(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: Rand, arr: T[]): T => arr[Math.floor(r() * arr.length)];
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const intBetween = (r: Rand, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1));

function weighted(r: Rand, weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) {
    if ((x -= w) < 0) return k;
  }
  return entries[0][0];
}

const STYLE_INFO: Record<FacadeStyle, { type: ListingType; tenure: string; built: [number, number]; floors: [number, number] }> = {
  stenstad: { type: 'apartment', tenure: 'Bostadsrätt', built: [1886, 1914], floors: [5, 6] },
  funkis: { type: 'apartment', tenure: 'Bostadsrätt', built: [1931, 1949], floors: [4, 5] },
  modern: { type: 'apartment', tenure: 'Bostadsrätt', built: [2003, 2022], floors: [5, 7] },
  villa: { type: 'house', tenure: 'Villa', built: [1924, 1988], floors: [2, 2] },
  radhus: { type: 'townhouse', tenure: 'Radhus', built: [1962, 2012], floors: [2, 2] },
};

const FEATURES: Record<FacadeStyle, string[]> = {
  stenstad: ['a tiled stove in the living room', 'a ceiling height of 3.1 metres', 'original herringbone parquet', 'windows on two sides', 'a quiet courtyard-facing bedroom', 'restored stucco ceilings', 'a French balcony over the street'],
  funkis: ['a corner window looking over the park', 'a renovated kitchen from 2021', 'a west-facing balcony', 'a tiled bathroom with floor heating', 'oak floors throughout', 'a bright, square-cut plan'],
  modern: ['a glazed balcony facing the water', 'a kitchen island and open plan', 'floor-to-ceiling windows', 'a shared roof terrace', 'a bike room and car pool in the building', 'evening sun on the balcony'],
  villa: ['a garden with apple trees', 'a glazed veranda', 'a wood-burning stove', 'a detached garage', 'a large lawn facing south', 'a newly laid roof'],
  radhus: ['a small garden with patio', 'a carport and storage', 'three bedrooms upstairs', 'a quiet cul-de-sac', 'a sauna in the basement'],
};

function listingFor(r: Rand, area: DemoArea, i: number, agencyCycle: number): Listing {
  const style = weighted(r, area.styles) as FacadeStyle;
  const info = STYLE_INFO[style];
  const isFlat = info.type === 'apartment';
  const rooms = isFlat ? Number(weighted(r, { 1: 2, 2: 4, 3: 3, 4: 1.4, 5: 0.5 })) : intBetween(r, 4, 7);
  const size = isFlat
    ? Math.round(18 + rooms * between(r, 17, 25))
    : Math.round(info.type === 'house' ? between(r, 120, 210) : between(r, 95, 140));
  const variance = between(r, 0.86, 1.14);
  const price = Math.round((size * area.pricePerM2 * variance * (rooms === 1 ? 1.08 : 1)) / 50000) * 50000;
  const fee = isFlat ? Math.round((size * between(r, 48, 78)) / 10) * 10 : null;
  const floors = intBetween(r, info.floors[0], info.floors[1]);
  const floor = isFlat ? intBetween(r, 1, floors) : null;
  const street = pick(r, area.streets);
  const number = intBetween(r, 2, 96);
  const letter = isFlat && r() < 0.15 ? pick(r, ['A', 'B']) : '';
  const angle = r() * Math.PI * 2;
  const dist = Math.sqrt(r()) * area.spreadKm;
  const pos = offsetKm(area, Math.cos(angle) * dist, Math.sin(angle) * dist);
  const agency = DEMO_AGENCIES[agencyCycle % DEMO_AGENCIES.length];
  const agent = pick(r, agency.agents);
  const phone = `070-174 06 ${String(5 + ((i * 7 + agencyCycle) % 95)).padStart(2, '0')}`;
  const feats = [...FEATURES[style]].sort(() => r() - 0.5).slice(0, 2);
  const lead = isFlat
    ? `${rooms === 1 ? 'A one-room' : `A ${rooms}-room`} flat on floor ${floor} of ${floors}`
    : info.type === 'house'
      ? `A family house on a ${num(intBetween(r, 6, 14) * 100)} m² plot`
      : 'An end-of-terrace townhouse';
  return {
    id: `${area.id}-${i}`,
    address: `${street} ${number}${letter}`,
    area: area.id,
    city: 'Stockholm',
    lat: pos.lat,
    lng: pos.lng,
    style,
    type: info.type,
    tenure: info.tenure,
    rooms,
    size,
    price,
    fee,
    floor,
    floors,
    built: intBetween(r, info.built[0], info.built[1]),
    agencyId: agency.id,
    agency: agency.name,
    agent,
    phone,
    blurb: `${lead}, with ${feats[0]} and ${feats[1]}.`,
    images: [],
    url: null,
    seed: Math.floor(r() * 1e9),
    viewings: [],
  };
}

// Swedish viewing rhythm: most homes are shown on a Sunday, often again on the
// Monday evening, with Saturdays and weekday lunches filling in.
function viewingsFor(r: Rand, todayKey: string): Omit<Viewing, 'id'>[] {
  const dow = fromKey(todayKey).getDay();
  const nextSunday = addDays(todayKey, (7 - dow) % 7);
  const sunday = r() < 0.58 ? nextSunday : addDays(nextSunday, 7);
  const slots: Omit<Viewing, 'id'>[] = [];
  const slot = (key: string, h: number, m: number, dur: number, booking: boolean) => {
    const d = fromKey(key);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    slots.push({ start, end: start + dur * 60000, booking });
  };
  const booking = r() < 0.28;
  const pattern = weighted(r, { sunMon: 5, sun: 3, satSun: 2, weekday: 1.5, lunch: 1 });
  const sundayTime = (): [number, number, number] => {
    const quarter = intBetween(r, 0, 23);
    return [10 + Math.floor(quarter / 4), (quarter % 4) * 15, pick(r, [30, 45, 45, 60])];
  };
  if (pattern === 'weekday' || pattern === 'lunch') {
    const key = addDays(todayKey, intBetween(r, 0, 13));
    const wd = fromKey(key).getDay();
    if (wd === 0 || wd === 6) slot(key, ...sundayTime(), booking);
    else if (pattern === 'lunch') slot(key, 12, pick(r, [0, 15]), 30, booking);
    else slot(key, 17, pick(r, [0, 15, 30, 45]), pick(r, [30, 45]), booking);
  } else {
    const [h, m, dur] = sundayTime();
    slot(sunday, h, m, dur, booking);
    if (pattern === 'sunMon') slot(addDays(sunday, 1), pick(r, [17, 17, 18]), pick(r, [0, 15, 30]), pick(r, [30, 45]), booking);
    else if (pattern === 'satSun') slot(addDays(sunday, -1), ...sundayTime(), booking);
    if (r() < 0.12 && h < 13) slot(sunday, h + 2, m, dur, booking);
  }
  return slots.filter((s) => dateKey(new Date(s.start)) >= todayKey).sort((a, b) => a.start - b.start);
}

const COUNTS: Record<string, number> = { sodermalm: 14, vasastan: 9, ostermalm: 7, kungsholmen: 8, gamlastan: 3, hammarby: 7, liljeholmen: 5, arsta: 5, gardet: 4, solna: 5, bromma: 7, nacka: 5 };

export function demoListings(todayKey: string, seed = 20261108): Listing[] {
  const r = rng(seed);
  const listings: Listing[] = [];
  let cycle = 0;
  for (const area of AREAS) {
    for (let i = 0; i < (COUNTS[area.id] ?? 4); i++) {
      const l = listingFor(r, area, i, cycle++);
      l.viewings = viewingsFor(r, todayKey).map((v, j) => ({ ...v, id: `${l.id}-v${j}` }));
      listings.push(l);
    }
  }
  return listings.filter((l) => l.viewings.length > 0);
}

// Other agencies' boosts, so the demo feed opens with sponsored viewings in it.
export function demoPromotions(listings: Listing[], todayKey: string): Promotion[] {
  const wanted = [
    { area: 'sodermalm', pkg: 'weekend', agency: 'brygga' },
    { area: 'sodermalm', pkg: 'day', agency: 'nordljus' },
    { area: 'vasastan', pkg: 'week', agency: 'stenstaden' },
    { area: 'hammarby', pkg: 'week', agency: 'sjostad' },
    { area: 'ostermalm', pkg: 'day', agency: 'holmhjort' },
    { area: 'kungsholmen', pkg: 'weekend', agency: 'nordljus' },
    { area: 'bromma', pkg: 'weekend', agency: 'holmhjort' },
  ];
  const used = new Set<string>();
  const promos: Promotion[] = [];
  for (const w of wanted) {
    const l =
      listings.find((x) => x.area === w.area && x.agencyId === w.agency && !used.has(x.id) && x.viewings.some((v) => dateKey(new Date(v.start)) === todayKey)) ||
      listings.find((x) => x.area === w.area && x.agencyId !== DEMO_AGENT.agencyId && !used.has(x.id) && x.viewings.length);
    if (!l) continue;
    used.add(l.id);
    const pkg = PACKAGE_BY_ID[w.pkg];
    const first = dateKey(new Date(l.viewings[0].start));
    const from = first < todayKey ? todayKey : first;
    promos.push({ id: `seed-${l.id}`, listingId: l.id, packageId: pkg.id, from, to: addDays(from, pkg.days - 1), tier: pkg.tier });
  }
  return promos;
}

// Plausible view counts for the dashboard's demo mode, stable per listing.
export function demoStats(listing: Listing, days: string[], boosted: Set<string>) {
  const r = rng(listing.seed);
  const base = 18 + r() * 40;
  return days.map((day) => {
    const wd = fromKey(day).getDay();
    const weekend = wd === 0 || wd === 6 ? 2.1 : wd === 1 ? 1.3 : 0.8;
    const lift = boosted.has(day) ? 3.2 : 1;
    const impressions = Math.round(base * weekend * lift * (0.75 + r() * 0.5));
    const opens = Math.round(impressions * (0.11 + r() * 0.06));
    const saves = Math.round(opens * (0.18 + r() * 0.12));
    const directions = Math.round(saves * (0.35 + r() * 0.3));
    return { day, impressions, opens, saves, directions };
  });
}
