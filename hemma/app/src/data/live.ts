import { createClient } from '@supabase/supabase-js';
import { addDays, fromKey } from '@core/format.ts';
import { bbox } from '@core/geo.ts';
import type { FacadeStyle, Listing, ListingType, Promotion } from '@core/types.ts';
import type { DataSource } from './source';

// How far around the buyer the app fetches at once; the feed then filters
// down to their distance or areas locally.
const FETCH_KM = 30;
const STYLES: FacadeStyle[] = ['stenstad', 'funkis', 'modern', 'villa', 'radhus'];

function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function toListing(r: any): Listing {
  return {
    id: r.id,
    address: r.address,
    area: r.area ?? 'other',
    city: r.city ?? '',
    lat: Number(r.lat),
    lng: Number(r.lng),
    type: (r.type ?? 'other') as ListingType,
    tenure: r.tenure ?? '',
    rooms: Number(r.rooms ?? 0),
    size: Number(r.size ?? 0),
    price: Number(r.price ?? 0),
    fee: r.fee == null ? null : Number(r.fee),
    floor: r.floor ?? null,
    floors: r.floors ?? null,
    built: r.built ?? null,
    agencyId: r.agencyId ?? '',
    agency: r.agency ?? '',
    agent: r.agent ?? '',
    phone: r.phone ?? null,
    blurb: r.blurb ?? '',
    images: r.images ?? [],
    url: r.url ?? null,
    style: STYLES.includes(r.style) ? r.style : 'stenstad',
    seed: seedOf(r.id),
    viewings: (r.viewings ?? []).map((v: any) => ({ id: v.id, start: Number(v.start), end: Number(v.end), booking: !!v.booking, bookingUrl: v.bookingUrl ?? null })),
  };
}

export function liveSource(url: string, key: string): DataSource {
  const db = createClient(url, key, { auth: { persistSession: false } });
  return {
    live: true,
    async load(center, todayKey) {
      const from = fromKey(todayKey);
      const to = fromKey(addDays(todayKey, 14));
      const box = bbox(center, FETCH_KM);
      const [feed, promos, areas] = await Promise.all([
        db.rpc('feed_window', {
          p_from: from.toISOString(), p_to: to.toISOString(),
          p_min_lat: box.minLat, p_max_lat: box.maxLat, p_min_lng: box.minLng, p_max_lng: box.maxLng,
        }),
        db.rpc('active_promotions', { p_from: todayKey, p_to: addDays(todayKey, 14) }),
        db.from('areas').select('id, name, lat, lng'),
      ]);
      const failed = feed.error ?? promos.error ?? areas.error;
      if (failed) throw new Error(failed.message);
      return {
        listings: ((feed.data as any[]) ?? []).map(toListing),
        promotions: ((promos.data as any[]) ?? []).map((p): Promotion => ({ id: p.id, listingId: p.listingId, packageId: p.packageId, from: p.from, to: p.to, tier: p.tier })),
        areas: areas.data ?? [],
      };
    },
    async track(events, deviceId) {
      await db.rpc('track', { p_events: events, p_device: deviceId });
    },
  };
}
