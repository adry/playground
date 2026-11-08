// Demo mode: the whole dashboard on invented data kept in this browser, so it
// can be tried before the backend exists. Pick a role on the sign-in page.
import { AREA_BY_ID } from '@core/areas.ts';
import { DEMO_AGENCIES, DEMO_AGENT, demoListings, demoPromotions, demoStats } from '@core/demo.ts';
import { spotsLeft } from '@core/feed.ts';
import { addDays, dateKey } from '@core/format.ts';
import { LAUNCH, PACKAGE_BY_ID, PACKAGES, priceToday } from '@core/packages.ts';
import type { Promotion } from '@core/types.ts';
import type { AgencyHome, Api, Application, Boost, FeedSource, Session } from './types';

export type DemoRole = 'agent' | 'pending' | 'admin';

const KEY = 'hemma-dashboard-demo';
interface State {
  role: DemoRole | null;
  boosts: Boost[];
  freeBoosts: number;
  applications: Application[];
  feeds: FeedSource[];
}

const today = dateKey(new Date());
const listings = demoListings(today);
const seeded = demoPromotions(listings, today);
const mine = listings.filter((l) => l.agencyId === DEMO_AGENT.agencyId);
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

const START: State = {
  role: null,
  boosts: [],
  freeBoosts: LAUNCH.freeBoostsPerAgency,
  applications: [
    { userId: 'u-1', fullName: 'Hanna Lövgren', email: 'hanna@skargardsmakleri.example', phone: '070-174 06 21', agencyName: 'Skärgårdsmäkleriet', orgNumber: '5591234567', fmiNumber: '20241187', status: 'pending', reviewNote: null, appliedAt: ago(0.2), agencyId: null },
    { userId: 'u-2', fullName: 'Ali Rahimi', email: 'ali@kvarter.example', phone: '070-174 06 33', agencyName: 'Kvarter & Co', orgNumber: '5566778899', fmiNumber: '20180412', status: 'pending', reviewNote: null, appliedAt: ago(1.1), agencyId: null },
    { userId: 'u-3', fullName: 'Maja Ek', email: DEMO_AGENT.email, phone: '070-174 06 10', agencyName: 'Kvarter & Co', orgNumber: '5566778899', fmiNumber: '20150877', status: 'approved', reviewNote: 'Checked in the FMI register', appliedAt: ago(9), agencyId: 'kvarter' },
    { userId: 'u-4', fullName: 'Test Testsson', email: 'test@gmail.example', phone: null, agencyName: 'Privat', orgNumber: null, fmiNumber: null, status: 'rejected', reviewNote: 'Not a registered estate agent', appliedAt: ago(4), agencyId: null },
  ],
  feeds: [
    { id: 'f-1', name: 'Kvarter & Co (Mspecs)', mode: 'push', format: 'hemma-json', url: null, authSecretName: 'FEED_KVARTER_KEY', agencyName: 'Kvarter & Co', active: true, lastRunAt: ago(0.01), lastStatus: 'ok', lastError: null },
    { id: 'f-2', name: 'Brygga Mäkleri (Vitec Express)', mode: 'pull', format: 'hemma-json', url: 'https://feeds.brygga.example/hemma.json', authSecretName: 'FEED_BRYGGA_TOKEN', agencyName: 'Brygga Mäkleri', active: true, lastRunAt: ago(0.008), lastStatus: 'partial', lastError: 'BR-2214: no usable coordinates' },
    { id: 'f-3', name: 'Nordljus Fastighet (website export)', mode: 'pull', format: 'hemma-xml', url: 'https://nordljus.example/export.xml', authSecretName: null, agencyName: 'Nordljus Fastighet', active: true, lastRunAt: ago(0.4), lastStatus: 'failed', lastError: 'feed answered 503' },
  ],
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...START, ...JSON.parse(raw) } : structuredClone(START);
  } catch {
    return structuredClone(START);
  }
}
let state = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* demo only */
  }
};

const asPromotion = (b: Boost): Promotion => ({ id: b.id, listingId: b.listingId, packageId: b.packageId, from: b.from, to: b.to, tier: PACKAGE_BY_ID[b.packageId].tier });
const allPromotions = () => [...seeded, ...state.boosts.filter((b) => b.status === 'active').map(asPromotion)];

const toHome = (l: (typeof listings)[number]): AgencyHome => ({
  id: l.id, address: l.address, area: l.area, areaName: AREA_BY_ID[l.area]?.name ?? l.area, price: l.price, rooms: l.rooms, size: l.size,
  fee: l.fee, style: l.style, seed: l.seed, floor: l.floor, floors: l.floors, images: l.images, viewings: l.viewings.map((v) => ({ start: v.start, end: v.end })),
});

export function demoApi(): Api & { signInAs(role: DemoRole): void; reset(): void } {
  return {
    mode: 'demo',
    signInAs(role) {
      state.role = role;
      save();
    },
    reset() {
      state = structuredClone(START);
      save();
    },
    async session(): Promise<Session | null> {
      if (!state.role) return null;
      if (state.role === 'admin') return { email: 'you@hemma.example', isAdmin: true, agent: null, agencyName: null };
      const app = state.role === 'agent' ? state.applications.find((a) => a.userId === 'u-3')! : { ...state.applications[1], status: 'pending' as const };
      return { email: app.email, isAdmin: false, agent: app, agencyName: DEMO_AGENCIES.find((a) => a.id === 'kvarter')!.name };
    },
    async signIn() {
      throw new Error('In demo mode, pick a role below.');
    },
    async signUp() {
      throw new Error('In demo mode, pick a role below.');
    },
    async signOut() {
      state.role = null;
      save();
    },
    async apply() {},
    async homes() {
      return mine.map(toHome);
    },
    async stats(from, to) {
      const days: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      return mine.flatMap((l) => {
        const boosted = new Set(days.filter((d) => state.boosts.some((b) => b.listingId === l.id && b.status === 'active' && b.from <= d && d <= b.to)));
        // Earlier demo boosts, so the chart shows what a boost does.
        if (l === mine[1] || l === mine[4]) for (const d of days.slice(3, 6)) boosted.add(d);
        return demoStats(l, days, boosted).map((s) => ({
          listingId: l.id, day: s.day, impressions: s.impressions, sponsored: boosted.has(s.day) ? Math.round(s.impressions * 0.7) : 0,
          opens: s.opens, saves: s.saves, directions: s.directions, calls: Math.round(s.directions * 0.3), agencyLinks: Math.round(s.opens * 0.2),
        }));
      });
    },
    async boosts() {
      return state.boosts.filter((b) => b.to >= today && b.status !== 'cancelled');
    },
    async pricing() {
      return {
        packages: PACKAGES,
        discount: today <= LAUNCH.discountUntil ? { percent: LAUNCH.discountPercent, until: LAUNCH.discountUntil } : null,
        freeBoosts: state.freeBoosts,
      };
    },
    async spotsLeft(listingId, from, to) {
      const l = listings.find((x) => x.id === listingId)!;
      const out: Record<string, number> = {};
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (l.viewings.some((v) => dateKey(new Date(v.start)) === d && v.end > Date.now())) {
          out[d] = spotsLeft({ promotions: allPromotions(), listings, area: l.area, day: d, exceptListingId: listingId });
        }
      }
      return out;
    },
    async book(listingId, packageId, startDay) {
      const pkg = PACKAGE_BY_ID[packageId];
      const free = state.freeBoosts > 0;
      if (free) state.freeBoosts--;
      state.boosts.push({
        id: `b-${Date.now()}`, listingId, packageId, from: startDay, to: addDays(startDay, pkg.days - 1), status: 'active',
        amount: free ? 0 : priceToday(pkg.price, today),
      });
      save();
      return free ? { free: true } : { simulated: true };
    },
    async cancel(id) {
      state.boosts = state.boosts.filter((b) => b.id !== id);
      save();
    },
    async applications() {
      return state.applications;
    },
    async review(userId, decision, note) {
      state.applications = state.applications.map((a) => (a.userId === userId ? { ...a, status: decision, reviewNote: note || null } : a));
      save();
    },
    async feeds() {
      return state.feeds;
    },
    async addFeed(f) {
      state.feeds.push({ id: `f-${Date.now()}`, name: f.name, mode: f.mode, format: f.format, url: f.url || null, authSecretName: f.authSecretName || null, agencyName: null, active: true, lastRunAt: null, lastStatus: null, lastError: null });
      save();
    },
  };
}
