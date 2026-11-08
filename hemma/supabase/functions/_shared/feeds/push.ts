// A push from a source system: a batch of upserts and unpublishes. Each
// event succeeds or fails on its own, so one bad home never blocks the rest.
//
// { "events": [
//   { "type": "listing.upsert", "listing": { ...hemma-json listing... } },
//   { "type": "listing.unpublish", "externalId": "KV-1001" } ] }

import { normalize } from './normalize.ts';
import type { AreaRef, FeedListing, RawListing } from './types.ts';

export interface PushDeps {
  areas: AreaRef[];
  upsert: (listings: FeedListing[]) => Promise<unknown>;
  unpublish: (externalIds: string[]) => Promise<number>;
  now?: number;
}

export interface PushResult {
  externalId: string;
  ok: boolean;
  reason: string | null;
}

const MAX_EVENTS = 500;

export async function handlePush(body: string, deps: PushDeps): Promise<{ status: number; results: PushResult[]; error?: string }> {
  let events: unknown;
  try {
    events = JSON.parse(body)?.events;
  } catch {
    return { status: 400, results: [], error: 'body is not JSON' };
  }
  if (!Array.isArray(events)) return { status: 400, results: [], error: 'expected { "events": [...] }' };
  if (events.length > MAX_EVENTS) return { status: 413, results: [], error: `at most ${MAX_EVENTS} events per request` };

  const results: PushResult[] = [];
  const upserts: RawListing[] = [];
  const unpublish: string[] = [];
  for (const e of events as Record<string, any>[]) {
    if (e?.type === 'listing.upsert' && e.listing && typeof e.listing === 'object') upserts.push(e.listing);
    else if (e?.type === 'listing.unpublish' && typeof e.externalId === 'string') unpublish.push(e.externalId);
    else results.push({ externalId: String(e?.listing?.externalId ?? e?.externalId ?? '(unknown)'), ok: false, reason: 'unknown event type' });
  }

  const { ok, rejected } = normalize(upserts, deps.areas, deps.now);
  for (const r of rejected) results.push({ externalId: r.externalId, ok: false, reason: r.reason });
  if (ok.length) {
    await deps.upsert(ok);
    for (const l of ok) results.push({ externalId: l.externalId, ok: true, reason: null });
  }
  if (unpublish.length) {
    await deps.unpublish(unpublish);
    for (const id of unpublish) results.push({ externalId: id, ok: true, reason: null });
  }
  return { status: 200, results };
}
