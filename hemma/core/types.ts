// The shapes every part of Hemma agrees on: the app, the agent dashboard and
// the feed importer all produce or read these.

export type ListingType = 'apartment' | 'house' | 'townhouse' | 'other';
export type FacadeStyle = 'stenstad' | 'funkis' | 'modern' | 'villa' | 'radhus';

export interface Viewing {
  id: string;
  start: number; // epoch ms
  end: number;
  booking: boolean; // true when the agent wants buyers to book a time first
  bookingUrl?: string | null;
}

export interface Listing {
  id: string;
  address: string;
  area: string; // area id, see Area
  city: string;
  lat: number;
  lng: number;
  type: ListingType;
  tenure: string; // Bostadsrätt, Villa, Radhus, Äganderätt ...
  rooms: number;
  size: number; // living area, m²
  price: number; // asking price, SEK
  fee: number | null; // monthly fee (avgift), SEK
  floor: number | null;
  floors: number | null;
  built: number | null;
  agencyId: string;
  agency: string;
  agent: string;
  phone: string | null;
  blurb: string;
  images: string[];
  url: string | null; // the agency's own page for the home
  style: FacadeStyle; // drawn fallback when there are no photos
  seed: number;
  viewings: Viewing[];
}

export interface Area {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Promotion {
  id: string;
  listingId: string;
  packageId: string;
  from: string; // YYYY-MM-DD, inclusive
  to: string;
  tier: number;
}

export type Place =
  | { mode: 'near'; origin: LatLng; radiusKm: number }
  | { mode: 'area'; areas: string[] };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Filters {
  types: ListingType[];
  minRooms: number;
  maxPrice: number;
  openOnly: boolean;
}

export const NO_FILTERS: Filters = { types: [], minRooms: 0, maxPrice: 0, openOnly: false };

export type Status = 'live' | 'soon' | 'later' | 'scheduled' | 'ended';

export interface FeedItem {
  listing: Listing;
  slots: Viewing[];
  slot: Viewing;
  status: Status;
  startsIn?: number;
  endsIn?: number;
  distanceKm: number | null;
  walkMin: number | null;
  promotion: Promotion | null;
}

export interface Package {
  id: string;
  name: string;
  days: number;
  price: number; // SEK excl. VAT
  tier: number;
  blurb: string;
}

// What the app reports back so agents can see how their listings do.
export type EventKind = 'impression' | 'open' | 'save' | 'directions' | 'call' | 'agency_link';
export interface TrackEvent {
  kind: EventKind;
  listingId: string;
  sponsored: boolean;
  day: string; // the feed day the buyer was looking at
  at: number;
}
