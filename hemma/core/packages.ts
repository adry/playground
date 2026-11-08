// What agents can buy. Prices are SEK excl. VAT; see docs/pricing.md for how
// they were set. The backend keeps its own copy in the `packages` table and
// that copy is what Stripe charges; these are for display and the demo.
import type { Package } from './types.ts';

export const PACKAGES: Package[] = [
  { id: 'day', name: 'Day', days: 1, price: 249, tier: 1, blurb: 'First in the feed for one viewing day.' },
  { id: 'weekend', name: 'Viewing weekend', days: 3, price: 549, tier: 2, blurb: 'Three days in a row, such as Sunday and Monday viewings, placed ahead of day boosts.' },
  { id: 'week', name: 'Week', days: 7, price: 949, tier: 3, blurb: 'Seven days, first in line, and a highlighted pin on the map.' },
];

// Launch offer, mirrored from the `settings` table and agencies.free_boosts.
export const LAUNCH = { freeBoostsPerAgency: 3, discountPercent: 50, discountUntil: '2027-03-31' };

export function priceToday(price: number, todayKey: string): number {
  return todayKey <= LAUNCH.discountUntil ? Math.round((price * (100 - LAUNCH.discountPercent)) / 100) : price;
}

export const PACKAGE_BY_ID: Record<string, Package> = Object.fromEntries(PACKAGES.map((p) => [p.id, p]));

// Sponsored places sold per area and day. The feed never shows more than
// MAX_SPONSORED at the top either, so a buyer always sees mostly organic results.
export const SPOTS_PER_AREA_DAY = 3;
export const MAX_SPONSORED = 3;
