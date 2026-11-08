import type { Area, LatLng, Listing, Promotion, TrackEvent } from '@core/types.ts';
import { demoSource } from './demo';
import { liveSource } from './live';

export interface Snapshot {
  listings: Listing[];
  promotions: Promotion[];
  areas: Area[];
}

export interface DataSource {
  live: boolean;
  load(center: LatLng, todayKey: string): Promise<Snapshot>;
  track(events: TrackEvent[], deviceId: string): Promise<void>;
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Live once the backend's URL and public key are set; demo data until then.
export const source: DataSource = url && key ? liveSource(url, key) : demoSource;
