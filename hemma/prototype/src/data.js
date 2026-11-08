// Demo listings and viewings. Everything is generated from a fixed seed, with
// viewing dates placed relative to "today", so the feed always has something
// on and the same homes come back every time the page opens.
//
// Agencies, agents and phone numbers are invented. The numbers sit in the
// 070-174 06 xx range that PTS reserves for fiction, so none of them rings.

import { AREAS } from './areas.js';
import { offsetKm } from './geo.js';
import { addDays, dateKey, fromKey } from './format.js';

export const AGENCIES = [
  { id: 'kvarter', name: 'Kvarter & Co', agents: ['Maja Ek', 'Johan Lind'] },
  { id: 'brygga', name: 'Brygga Mäkleri', agents: ['Sara Holm', 'Nils Åberg'] },
  { id: 'nordljus', name: 'Nordljus Fastighet', agents: ['Erik Sund', 'Amira Haddad'] },
  { id: 'holmhjort', name: 'Holm & Hjort', agents: ['Lina Berg', 'Oskar Dahl'] },
  { id: 'stenstaden', name: 'Stenstaden Mäklare', agents: ['Elin Nord', 'Viktor Ström'] },
  { id: 'sjostad', name: 'Sjöstad Bostad', agents: ['Fatima Karimi', 'Petter Wall'] },
];

// The agent the "For agents" tab signs in as.
export const DEMO_AGENT = { agencyId: 'kvarter', name: 'Maja Ek' };

export const PACKAGES = [
  { id: 'day', name: 'Day', days: 1, price: 249, tier: 1, blurb: 'First in the feed for one viewing day.' },
  { id: 'weekend', name: 'Viewing weekend', days: 3, price: 549, tier: 2, blurb: 'Three days in a row, such as Sunday and Monday viewings, placed ahead of day boosts.' },
  { id: 'week', name: 'Week', days: 7, price: 949, tier: 3, blurb: 'Seven days, first in line, and a highlighted pin on the map.' },
];
export const PACKAGE_BY_ID = Object.fromEntries(PACKAGES.map((p) => [p.id, p]));

// Sponsored places sold per area and day. The feed itself never shows more
// than this many either, so a buyer always sees mostly organic results.
export const SPOTS_PER_AREA_DAY = 3;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, lo, hi) => lo + r() * (hi - lo);
const intBetween = (r, lo, hi) => Math.floor(between(r, lo, hi + 1));

function weighted(r, weights) {
  const entries = Object.entries(weights);
  let total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) {
    if ((x -= w) < 0) return k;
  }
  return entries[0][0];
}

const STYLE_INFO = {
  stenstad: { type: 'apartment', tenure: 'Bostadsrätt', built: [1886, 1914], floors: [5, 6] },
  funkis: { type: 'apartment', tenure: 'Bostadsrätt', built: [1931, 1949], floors: [4, 5] },
  modern: { type: 'apartment', tenure: 'Bostadsrätt', built: [2003, 2022], floors: [5, 7] },
  villa: { type: 'house', tenure: 'Villa', built: [1924, 1988], floors: [2, 2] },
  radhus: { type: 'townhouse', tenure: 'Radhus', built: [1962, 2012], floors: [2, 2] },
};

const FEATURES = {
  stenstad: ['tiled stove in the living room', 'ceiling height of 3.1 metres', 'original herringbone parquet', 'windows on two sides', 'a quiet courtyard-facing bedroom', 'restored stucco ceilings', 'a French balcony over the street'],
  funkis: ['a corner window looking over the park', 'a renovated kitchen from 2021', 'a west-facing balcony', 'a tiled bathroom with floor heating', 'oak floors throughout', 'a bright, square-cut plan'],
  modern: ['a glazed balcony facing the water', 'a kitchen island and open plan', 'floor-to-ceiling windows', 'a shared roof terrace', 'a bike room and car pool in the building', 'evening sun on the balcony'],
  villa: ['a garden with apple trees', 'a glazed veranda', 'a wood-burning stove', 'a detached garage', 'a large lawn facing south', 'a newly laid roof'],
  radhus: ['a small garden with patio', 'a carport and storage', 'three bedrooms upstairs', 'a quiet cul-de-sac', 'a sauna in the basement'],
};

function listingFor(r, area, i, agencyCycle) {
  const style = weighted(r, area.styles);
  const info = STYLE_INFO[style];
  const isFlat = info.type === 'apartment';

  const rooms = isFlat ? weighted(r, { 1: 2, 2: 4, 3: 3, 4: 1.4, 5: 0.5 }) * 1 : intBetween(r, 4, 7);
  const size = isFlat
    ? Math.round(18 + rooms * between(r, 17, 25))
    : Math.round(info.type === 'house' ? between(r, 120, 210) : between(r, 95, 140));

  const variance = between(r, 0.86, 1.14);
  const rawPrice = size * area.pricePerM2 * variance * (rooms === 1 ? 1.08 : 1);
  const price = Math.round(rawPrice / 50000) * 50000;
  const fee = isFlat ? Math.round((size * between(r, 48, 78)) / 10) * 10 : null;

  const [fLo, fHi] = info.floors;
  const floors = intBetween(r, fLo, fHi);
  const floor = isFlat ? intBetween(r, 1, floors) : null;

  const street = pick(r, area.streets);
  const number = intBetween(r, 2, 96);
  const letter = isFlat && r() < 0.15 ? pick(r, ['A', 'B']) : '';

  // Scatter homes inside the area, denser towards the centre.
  const angle = r() * Math.PI * 2;
  const dist = Math.sqrt(r()) * area.spreadKm;
  const pos = offsetKm(area, Math.cos(angle) * dist, Math.sin(angle) * dist);

  const agency = AGENCIES[agencyCycle % AGENCIES.length];
  const agent = pick(r, agency.agents);
  const phone = `070-174 06 ${String(5 + ((i * 7 + agencyCycle) % 95)).padStart(2, '0')}`;

  const feats = [...FEATURES[style]].sort(() => r() - 0.5).slice(0, 2);
  const lead = isFlat
    ? `${rooms === 1 ? 'A one-room' : `A ${rooms}-room`} flat on floor ${floor} of ${floors}`
    : info.type === 'house'
      ? `A family house on a ${num(intBetween(r, 6, 14) * 100)} m² plot`
      : 'An end-of-terrace townhouse';
  const blurb = `${lead}, with ${feats[0]} and ${feats[1]}.`;

  return {
    id: `${area.id}-${i}`,
    address: `${street} ${number}${letter}`,
    area: area.id,
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
    blurb,
    seed: Math.floor(r() * 1e9),
    viewings: [],
  };
}

function num(n) {
  return new Intl.NumberFormat('sv-SE').format(n);
}

// Swedish viewing rhythm: most homes are shown on a Sunday, often again on the
// Monday evening, with Saturdays and weekday lunches filling in.
function viewingsFor(r, todayKey) {
  const today = fromKey(todayKey);
  const dow = today.getDay(); // 0 = Sunday
  const nextSunday = addDays(todayKey, (7 - dow) % 7);
  // Most homes on the market are shown this coming Sunday; the rest the next.
  const sunday = r() < 0.58 ? nextSunday : addDays(nextSunday, 7);

  const slots = [];
  const slot = (key, h, m, dur, booking) => {
    const d = fromKey(key);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    slots.push({ start, end: start + dur * 60000, booking });
  };

  const booking = r() < 0.28;
  const pattern = weighted(r, { sunMon: 5, sun: 3, satSun: 2, weekday: 1.5, lunch: 1 });

  const sundayTime = () => {
    const quarter = intBetween(r, 0, 23); // 10:00 to 15:45
    return [10 + Math.floor(quarter / 4), (quarter % 4) * 15, pick(r, [30, 45, 45, 60])];
  };

  if (pattern === 'weekday' || pattern === 'lunch') {
    const offset = intBetween(r, 0, 13);
    const key = addDays(todayKey, offset);
    const wd = fromKey(key).getDay();
    if (wd === 0 || wd === 6) {
      const [h, m, dur] = sundayTime();
      slot(key, h, m, dur, booking);
    } else if (pattern === 'lunch') {
      slot(key, 12, pick(r, [0, 15]), 30, booking);
    } else {
      slot(key, 17, pick(r, [0, 15, 30, 45]), pick(r, [30, 45]), booking);
    }
  } else {
    const [h, m, dur] = sundayTime();
    slot(sunday, h, m, dur, booking);
    if (pattern === 'sunMon') {
      slot(addDays(sunday, 1), pick(r, [17, 17, 18]), pick(r, [0, 15, 30]), pick(r, [30, 45]), booking);
    } else if (pattern === 'satSun') {
      const [h2, m2, d2] = sundayTime();
      slot(addDays(sunday, -1), h2, m2, d2, booking);
    }
    // A popular flat sometimes gets a second Sunday slot after lunch.
    if (r() < 0.12 && h < 13) slot(sunday, h + 2, m, dur, booking);
  }

  return slots.filter((s) => dateKey(new Date(s.start)) >= todayKey).sort((a, b) => a.start - b.start);
}

export function generateListings(todayKey, seed = 20261108) {
  const r = rng(seed);
  const listings = [];
  let cycle = 0;
  const counts = { sodermalm: 14, vasastan: 9, ostermalm: 7, kungsholmen: 8, gamlastan: 3, hammarby: 7, liljeholmen: 5, arsta: 5, gardet: 4, solna: 5, bromma: 7, nacka: 5 };
  for (const area of AREAS) {
    for (let i = 0; i < (counts[area.id] ?? 4); i++) {
      const l = listingFor(r, area, i, cycle++);
      l.viewings = viewingsFor(r, todayKey).map((v, j) => ({ ...v, id: `${l.id}-v${j}` }));
      listings.push(l);
    }
  }
  return listings.filter((l) => l.viewings.length > 0);
}

// Other agencies' boosts, so the feed opens with sponsored viewings in it.
export function seedPromotions(listings, todayKey) {
  const wanted = [
    { area: 'sodermalm', pkg: 'weekend', agency: 'brygga' },
    { area: 'sodermalm', pkg: 'day', agency: 'nordljus' },
    { area: 'vasastan', pkg: 'week', agency: 'stenstaden' },
    { area: 'hammarby', pkg: 'week', agency: 'sjostad' },
    { area: 'ostermalm', pkg: 'day', agency: 'holmhjort' },
    { area: 'kungsholmen', pkg: 'weekend', agency: 'nordljus' },
    { area: 'bromma', pkg: 'weekend', agency: 'holmhjort' },
  ];
  const used = new Set();
  const promos = [];
  for (const w of wanted) {
    const l =
      listings.find((x) => x.area === w.area && x.agencyId === w.agency && !used.has(x.id) && x.viewings.some((v) => dateKey(new Date(v.start)) === todayKey)) ||
      listings.find((x) => x.area === w.area && x.agencyId !== 'kvarter' && !used.has(x.id) && x.viewings.length);
    if (!l) continue;
    used.add(l.id);
    const pkg = PACKAGE_BY_ID[w.pkg];
    const first = dateKey(new Date(l.viewings[0].start));
    const from = first < todayKey ? todayKey : first;
    promos.push({ id: `seed-${l.id}`, listingId: l.id, packageId: pkg.id, from, to: addDays(from, pkg.days - 1), tier: pkg.tier, seeded: true });
  }
  return promos;
}
