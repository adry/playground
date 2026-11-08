// Anonymous usage, batched: what agents see in their dashboard. An impression
// is sent once per home and feed day per app session.
import { AppState } from 'react-native';
import type { EventKind, FeedItem, TrackEvent } from '@core/types.ts';
import { source } from './data/source';

let deviceId = 'unknown';
let queue: TrackEvent[] = [];
const seen = new Set<string>();

export function setDevice(id: string) {
  deviceId = id;
}

export function track(kind: EventKind, item: Pick<FeedItem, 'listing' | 'promotion'>, day: string) {
  if (kind === 'impression') {
    const key = `${item.listing.id}:${day}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  queue.push({ kind, listingId: item.listing.id, sponsored: !!item.promotion, day, at: Date.now() });
  if (queue.length >= 50) void flush();
}

export async function flush() {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    await source.track(batch, deviceId);
  } catch {
    queue = batch.concat(queue).slice(-500); // try again later, but never grow without bound
  }
}

setInterval(flush, 15000);
AppState.addEventListener('change', (s) => {
  if (s !== 'active') void flush();
});
