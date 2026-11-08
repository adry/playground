import { AREAS } from '@core/areas.ts';
import { demoListings, demoPromotions } from '@core/demo.ts';
import type { DataSource } from './source';

export const demoSource: DataSource = {
  live: false,
  async load(_center, todayKey) {
    const listings = demoListings(todayKey);
    return { listings, promotions: demoPromotions(listings, todayKey), areas: AREAS };
  },
  async track() {
    // Nowhere to send usage in the demo.
  },
};
