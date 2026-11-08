// The feed: which viewings a buyer sees for a day and a place, and in what
// order. Pure functions, so the ranking rules can be tested and later moved
// server-side unchanged.
//
// Sponsored rules:
//  1. A boost only lifts a viewing the buyer would already see: same day, same
//     place, same filters. Paying never puts a home outside the search in front
//     of someone.
//  2. A viewing that has already ended today is never shown as sponsored.
//  3. At most MAX_SPONSORED sit on top. Higher packages go first; equals are
//     shuffled by a per-day hash so no agency owns the top slot all day.
//  4. A sponsored viewing is not repeated further down the feed.

import { distanceKm, walkMinutes } from './geo.js';
import { dateKey } from './format.js';
import { SPOTS_PER_AREA_DAY } from './data.js';

export const MAX_SPONSORED = 3;

export function slotsOn(listing, day) {
  return listing.viewings.filter((v) => dateKey(new Date(v.start)) === day);
}

export function inPlace(listing, place) {
  if (place.mode === 'area') return place.areas.length === 0 || place.areas.includes(listing.area);
  return distanceKm(place.origin, listing) <= place.radiusKm;
}

export function passesFilters(listing, f) {
  if (f.types?.length && !f.types.includes(listing.type)) return false;
  if (f.minRooms && listing.rooms < f.minRooms) return false;
  if (f.maxPrice && listing.price > f.maxPrice) return false;
  return true;
}

export function statusOf(slots, now, day) {
  const today = dateKey(new Date(now));
  if (day < today) return { key: 'ended', slot: slots[slots.length - 1] };
  if (day > today) return { key: 'scheduled', slot: slots[0] };
  const live = slots.find((s) => s.start <= now && now < s.end);
  if (live) return { key: 'live', slot: live, endsIn: (live.end - now) / 60000 };
  const next = slots.find((s) => s.start > now);
  if (next) {
    const startsIn = (next.start - now) / 60000;
    return { key: startsIn <= 60 ? 'soon' : 'later', slot: next, startsIn };
  }
  return { key: 'ended', slot: slots[slots.length - 1] };
}

const STATUS_ORDER = { live: 0, soon: 1, later: 1, scheduled: 1, ended: 2 };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function activePromotion(promotions, listingId, day) {
  let best = null;
  for (const p of promotions) {
    if (p.listingId !== listingId || p.from > day || p.to < day) continue;
    if (!best || p.tier > best.tier) best = p;
  }
  return best;
}

export function buildFeed({ listings, promotions, day, now, place, filters, origin, sort = 'time', maxSponsored = MAX_SPONSORED }) {
  const items = [];
  for (const listing of listings) {
    if (!inPlace(listing, place) || !passesFilters(listing, filters)) continue;
    let slots = slotsOn(listing, day);
    if (filters.openOnly) slots = slots.filter((s) => !s.booking);
    if (!slots.length) continue;
    const st = statusOf(slots, now, day);
    const km = origin ? distanceKm(origin, listing) : null;
    items.push({
      listing,
      slots,
      status: st.key,
      slot: st.slot,
      startsIn: st.startsIn,
      endsIn: st.endsIn,
      distanceKm: km,
      walkMin: km == null ? null : walkMinutes(km),
      promotion: null,
    });
  }

  const eligible = [];
  for (const item of items) {
    if (item.status === 'ended') continue;
    const promo = activePromotion(promotions, item.listing.id, day);
    if (promo) eligible.push({ ...item, promotion: promo });
  }
  eligible.sort((a, b) => b.promotion.tier - a.promotion.tier || hash(`${day}:${a.promotion.id}`) - hash(`${day}:${b.promotion.id}`));
  const sponsored = eligible.slice(0, maxSponsored);
  const lifted = new Set(sponsored.map((i) => i.listing.id));

  const organic = items.filter((i) => !lifted.has(i.listing.id));
  organic.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s) return s;
    if (sort === 'distance' && a.distanceKm != null) return a.distanceKm - b.distanceKm;
    return a.slot.start - b.slot.start;
  });

  return {
    sponsored,
    organic,
    total: items.length,
    live: items.filter((i) => i.status === 'live').length,
  };
}

// How many viewings each day in the strip has for the current place/filters.
export function dayCounts({ listings, days, place, filters }) {
  const counts = Object.fromEntries(days.map((d) => [d, 0]));
  for (const l of listings) {
    if (!inPlace(l, place) || !passesFilters(l, filters)) continue;
    const seen = new Set();
    for (const v of l.viewings) {
      if (filters.openOnly && v.booking) continue;
      const k = dateKey(new Date(v.start));
      if (k in counts && !seen.has(k)) {
        counts[k]++;
        seen.add(k);
      }
    }
  }
  return counts;
}

// Sponsored spots already sold in an area on a day, the unit agents buy. A
// boost only occupies a spot on days its home is actually being shown.
export function spotsTaken({ promotions, listings, area, day, exceptListingId }) {
  const inArea = new Map(listings.filter((l) => l.area === area).map((l) => [l.id, l]));
  const taken = new Set();
  for (const p of promotions) {
    if (p.listingId === exceptListingId || p.from > day || day > p.to) continue;
    const l = inArea.get(p.listingId);
    if (l && slotsOn(l, day).length) taken.add(p.listingId);
  }
  return taken.size;
}

export function spotsLeft(args) {
  return Math.max(0, SPOTS_PER_AREA_DAY - spotsTaken(args));
}

// A buyer's day: viewings in time order with the walk between each pair, and
// a warning when the walk eats the viewing.
export function planDay({ entries, listings, origin }) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const stops = entries
    .map((e) => {
      const listing = byId.get(e.listingId);
      const slot = listing?.viewings.find((v) => v.start === e.start);
      return listing && slot ? { listing, slot } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.slot.start - b.slot.start);

  let prev = null;
  let prevLeave = null;
  let walkTotal = 0;
  return {
    stops: stops.map((stop) => {
      const from = prev ? prev.listing : origin;
      const km = from ? distanceKm(from, stop.listing) : 0;
      const walk = walkMinutes(km);
      walkTotal += walk;

      const arrive = prevLeave == null ? stop.slot.start : prevLeave + walk * MIN;
      let warning = null;
      if (prevLeave != null) {
        const minutesLeft = (stop.slot.end - arrive) / MIN;
        if (minutesLeft < MIN_STAY) warning = { kind: 'miss', minutes: Math.max(0, Math.round(minutesLeft)) };
        else if (arrive > stop.slot.start) warning = { kind: 'late', minutes: Math.round((arrive - stop.slot.start) / MIN) };
      }
      const inside = Math.max(arrive, stop.slot.start);
      const leave = Math.max(arrive, Math.min(stop.slot.end, inside + DWELL * MIN));

      prev = stop;
      prevLeave = leave;
      return { ...stop, walkKm: km, walkMin: walk, fromOrigin: from === origin, arrive, leave, warning };
    }),
    walkTotal,
  };
}

const MIN = 60000;
// Minutes a buyer typically spends at a viewing, and the least worth arriving for.
const DWELL = 20;
const MIN_STAY = 10;
