// The feed: which viewings a buyer sees for a day and a place, and in what
// order. Pure functions, shared by the app, the agent dashboard's preview and
// the tests, so the rules agents pay under are the rules buyers see.
//
// Sponsored rules:
//  1. A boost only lifts a viewing the buyer would already see: same day, same
//     place, same filters. Paying never puts a home outside the search in front
//     of someone.
//  2. A viewing that has already ended today is never shown as sponsored.
//  3. At most MAX_SPONSORED sit on top. Higher packages go first; equals are
//     shuffled by a per-day hash so no agency owns the top slot all day.
//  4. A sponsored viewing is not repeated further down the feed.

import { distanceKm, walkMinutes } from './geo.ts';
import { dateKey } from './format.ts';
import { MAX_SPONSORED, SPOTS_PER_AREA_DAY } from './packages.ts';
import type { FeedItem, Filters, LatLng, Listing, Place, Promotion, Status, Viewing } from './types.ts';

export function slotsOn(listing: Listing, day: string): Viewing[] {
  return listing.viewings.filter((v) => dateKey(new Date(v.start)) === day);
}

export function inPlace(listing: Listing, place: Place): boolean {
  if (place.mode === 'area') return place.areas.length === 0 || place.areas.includes(listing.area);
  return distanceKm(place.origin, listing) <= place.radiusKm;
}

export function passesFilters(listing: Listing, f: Filters): boolean {
  if (f.types.length && !f.types.includes(listing.type)) return false;
  if (f.minRooms && listing.rooms < f.minRooms) return false;
  if (f.maxPrice && listing.price > f.maxPrice) return false;
  return true;
}

export function statusOf(slots: Viewing[], now: number, day: string): { key: Status; slot: Viewing; startsIn?: number; endsIn?: number } {
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

const STATUS_ORDER: Record<Status, number> = { live: 0, soon: 1, later: 1, scheduled: 1, ended: 2 };

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function activePromotion(promotions: Promotion[], listingId: string, day: string): Promotion | null {
  let best: Promotion | null = null;
  for (const p of promotions) {
    if (p.listingId !== listingId || p.from > day || p.to < day) continue;
    if (!best || p.tier > best.tier) best = p;
  }
  return best;
}

export interface FeedArgs {
  listings: Listing[];
  promotions: Promotion[];
  day: string;
  now: number;
  place: Place;
  filters: Filters;
  origin: LatLng | null;
  sort?: 'time' | 'distance';
  maxSponsored?: number;
}

export interface Feed {
  sponsored: FeedItem[];
  organic: FeedItem[];
  total: number;
  live: number;
}

export function buildFeed({ listings, promotions, day, now, place, filters, origin, sort = 'time', maxSponsored = MAX_SPONSORED }: FeedArgs): Feed {
  const items: FeedItem[] = [];
  for (const listing of listings) {
    if (!inPlace(listing, place) || !passesFilters(listing, filters)) continue;
    let slots = slotsOn(listing, day).sort((a, b) => a.start - b.start);
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

  const eligible: FeedItem[] = [];
  for (const item of items) {
    if (item.status === 'ended') continue;
    const promo = activePromotion(promotions, item.listing.id, day);
    if (promo) eligible.push({ ...item, promotion: promo });
  }
  eligible.sort(
    (a, b) => b.promotion!.tier - a.promotion!.tier || hash(`${day}:${a.promotion!.id}`) - hash(`${day}:${b.promotion!.id}`),
  );
  const sponsored = eligible.slice(0, maxSponsored);
  const lifted = new Set(sponsored.map((i) => i.listing.id));

  const organic = items.filter((i) => !lifted.has(i.listing.id));
  organic.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s) return s;
    if (sort === 'distance' && a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    return a.slot.start - b.slot.start;
  });

  return { sponsored, organic, total: items.length, live: items.filter((i) => i.status === 'live').length };
}

// How many homes each day in the strip has viewings for, in the current place/filters.
export function dayCounts({ listings, days, place, filters }: { listings: Listing[]; days: string[]; place: Place; filters: Filters }) {
  const counts: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const l of listings) {
    if (!inPlace(l, place) || !passesFilters(l, filters)) continue;
    const seen = new Set<string>();
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
export function spotsTaken({ promotions, listings, area, day, exceptListingId }: { promotions: Promotion[]; listings: Listing[]; area: string; day: string; exceptListingId?: string }) {
  const inArea = new Map(listings.filter((l) => l.area === area).map((l) => [l.id, l]));
  const taken = new Set<string>();
  for (const p of promotions) {
    if (p.listingId === exceptListingId || p.from > day || day > p.to) continue;
    const l = inArea.get(p.listingId);
    if (l && slotsOn(l, day).length) taken.add(p.listingId);
  }
  return taken.size;
}

export function spotsLeft(args: Parameters<typeof spotsTaken>[0]) {
  return Math.max(0, SPOTS_PER_AREA_DAY - spotsTaken(args));
}

const MIN = 60000;
// Minutes a buyer typically spends at a viewing, and the least worth arriving for.
const DWELL = 20;
const MIN_STAY = 10;

export interface PlanEntry {
  listingId: string;
  start: number;
}

export interface PlanStop {
  listing: Listing;
  slot: Viewing;
  walkKm: number;
  walkMin: number;
  arrive: number;
  leave: number;
  warning: { kind: 'miss' | 'late'; minutes: number } | null;
}

// A buyer's day: viewings in time order with the walk between each pair, and
// a warning when the walk eats the viewing.
export function planDay({ entries, listings, origin }: { entries: PlanEntry[]; listings: Listing[]; origin: LatLng | null }) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const stops = entries
    .map((e) => {
      const listing = byId.get(e.listingId);
      const slot = listing?.viewings.find((v) => v.start === e.start);
      return listing && slot ? { listing, slot } : null;
    })
    .filter((s): s is { listing: Listing; slot: Viewing } => s !== null)
    .sort((a, b) => a.slot.start - b.slot.start);

  let prev: { listing: Listing } | null = null;
  let prevLeave: number | null = null;
  let walkTotal = 0;
  const out: PlanStop[] = stops.map((stop) => {
    const from: LatLng | null = prev ? prev.listing : origin;
    const km = from ? distanceKm(from, stop.listing) : 0;
    const walk = walkMinutes(km);
    walkTotal += walk;
    const arrive = prevLeave == null ? stop.slot.start : prevLeave + walk * MIN;
    let warning: PlanStop['warning'] = null;
    if (prevLeave != null) {
      const minutesLeft = (stop.slot.end - arrive) / MIN;
      if (minutesLeft < MIN_STAY) warning = { kind: 'miss', minutes: Math.max(0, Math.round(minutesLeft)) };
      else if (arrive > stop.slot.start) warning = { kind: 'late', minutes: Math.round((arrive - stop.slot.start) / MIN) };
    }
    const inside = Math.max(arrive, stop.slot.start);
    const leave = Math.max(arrive, Math.min(stop.slot.end, inside + DWELL * MIN));
    prev = stop;
    prevLeave = leave;
    return { ...stop, walkKm: km, walkMin: walk, arrive, leave, warning };
  });
  return { stops: out, walkTotal };
}
