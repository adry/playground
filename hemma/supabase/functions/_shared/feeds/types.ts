// What every adapter turns a feed into, and what ingest_apply() stores.
// Plain TypeScript with no runtime imports, so it runs in Deno (Edge
// Functions) and in Node (tests) alike.

export type HomeType = 'apartment' | 'house' | 'townhouse' | 'other';

export interface FeedViewing {
  start: string; // ISO 8601 with offset, e.g. 2026-11-15T13:00:00+01:00
  end: string;
  booking: boolean;
  bookingUrl: string | null;
}

export interface FeedListing {
  externalId: string;
  agencyName: string;
  agencyOrgNumber: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  address: string;
  area: string | null; // Hemma area id, matched from coordinates
  city: string | null;
  lat: number;
  lng: number;
  type: HomeType;
  tenure: string | null;
  rooms: number | null;
  size: number | null;
  price: number | null;
  fee: number | null;
  floor: number | null;
  floors: number | null;
  built: number | null;
  description: string | null;
  images: string[];
  url: string | null;
  style: string;
  viewings: FeedViewing[];
}

// What an adapter hands the normalizer: loosely typed fields straight from
// the source, before validation.
export type RawListing = Record<string, unknown> & { viewings?: Record<string, unknown>[] };

export interface Adapter {
  id: string;
  contentType: string;
  parse(body: string): RawListing[];
}

export interface AreaRef {
  id: string;
  lat: number;
  lng: number;
}

export interface Rejected {
  externalId: string;
  reason: string;
}
