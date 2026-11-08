// Hemma's own JSON feed: { "listings": [ ... ] } or a bare array. Field names
// are documented in docs/feed-format.md and match RawListing one to one.
import type { Adapter, RawListing } from '../types.ts';

export const hemmaJson: Adapter = {
  id: 'hemma-json',
  contentType: 'application/json',
  parse(body) {
    const data = JSON.parse(body);
    const list = Array.isArray(data) ? data : data?.listings;
    if (!Array.isArray(list)) throw new Error('expected an array or { "listings": [...] }');
    return list as RawListing[];
  },
};
