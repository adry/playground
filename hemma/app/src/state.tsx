// App state: which day and place the buyer is looking at, their filters and
// planned viewings, the loaded homes, and the live clock. Kept on the device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEMO_SPOTS, STOCKHOLM } from '@core/areas.ts';
import { buildFeed, dayCounts, type Feed, type PlanEntry } from '@core/feed.ts';
import { addDays, dateKey } from '@core/format.ts';
import { distanceKm } from '@core/geo.ts';
import { NO_FILTERS, type Filters, type LatLng, type Place } from '@core/types.ts';
import { source, type Snapshot } from './data/source';
import { setDevice } from './track';

const KEY = 'hemma:v1';

export interface Origin extends LatLng {
  label: string;
  gps: boolean;
}

interface Saved {
  mode: 'near' | 'area';
  radiusKm: number;
  areas: string[];
  spot: string;
  filters: Filters;
  sort: 'time' | 'distance';
  plan: PlanEntry[];
  device: string;
}

const DEFAULTS: Saved = {
  mode: 'near',
  radiusKm: 3,
  areas: [],
  spot: DEMO_SPOTS[0].id,
  filters: NO_FILTERS,
  sort: 'time',
  plan: [],
  device: '',
};

interface AppState extends Omit<Saved, 'device'> {
  ready: boolean;
  live: boolean;
  today: string;
  days: string[];
  now: number;
  day: string;
  data: Snapshot;
  loadError: string | null;
  origin: Origin;
  place: Place;
  feed: Feed;
  counts: Record<string, number>;
  locating: boolean;
  set: (patch: Partial<Saved>) => void;
  setDay: (day: string) => void;
  togglePlan: (listingId: string, start: number) => boolean;
  inPlan: (listingId: string, start: number) => boolean;
  locateMe: () => Promise<string | null>;
  reload: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export function AppProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [day, setDayState] = useState(dateKey(new Date()));
  const [data, setData] = useState<Snapshot>({ listings: [], promotions: [], areas: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [reloads, setReloads] = useState(0);
  const today = dateKey(new Date(now));
  const lastLoad = useRef('');

  // Restore what the buyer chose last time.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const s: Saved = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
        if (!s.device) s.device = uuid();
        s.plan = s.plan.filter((e) => e.start > Date.now() - 86400000);
        setSaved(s);
        setDevice(s.device);
      })
      .catch(() => setDevice(uuid()))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(saved)).catch(() => {});
  }, [saved, ready]);

  // "On now" and "starts in 12 min" move with the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const origin: Origin = useMemo(() => {
    if (saved.spot === 'gps' && gps) return { ...gps, label: 'Your location', gps: true };
    const s = DEMO_SPOTS.find((x) => x.id === saved.spot) ?? DEMO_SPOTS[0];
    return { lat: s.lat, lng: s.lng, label: s.label, gps: false };
  }, [saved.spot, gps]);

  // Load homes for the next two weeks around the buyer. Reloads when the day
  // rolls over or the buyer moves far.
  useEffect(() => {
    if (!ready) return;
    const key = `${today}:${origin.lat.toFixed(1)}:${origin.lng.toFixed(1)}:${reloads}`;
    if (key === lastLoad.current) return;
    lastLoad.current = key;
    source
      .load(origin, today)
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [ready, today, origin, reloads]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const place: Place = useMemo(
    () => (saved.mode === 'area' ? { mode: 'area', areas: saved.areas } : { mode: 'near', origin, radiusKm: saved.radiusKm }),
    [saved.mode, saved.areas, saved.radiusKm, origin],
  );
  const feed = useMemo(
    () => buildFeed({ listings: data.listings, promotions: data.promotions, day, now, place, filters: saved.filters, origin, sort: saved.sort }),
    [data, day, now, place, saved.filters, origin, saved.sort],
  );
  const counts = useMemo(() => dayCounts({ listings: data.listings, days, place, filters: saved.filters }), [data, days, place, saved.filters]);

  const set = useCallback((patch: Partial<Saved>) => setSaved((s) => ({ ...s, ...patch })), []);
  const inPlan = useCallback((id: string, start: number) => saved.plan.some((e) => e.listingId === id && e.start === start), [saved.plan]);
  const togglePlan = useCallback(
    (listingId: string, start: number) => {
      const has = saved.plan.some((e) => e.listingId === listingId && e.start === start);
      set({ plan: has ? saved.plan.filter((e) => !(e.listingId === listingId && e.start === start)) : [...saved.plan, { listingId, start }] });
      return !has;
    },
    [saved.plan, set],
  );

  const locateMe = useCallback(async (): Promise<string | null> => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return 'Location is off for Hemma. Pick a starting point instead, or allow location in Settings.';
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!source.live && distanceKm(here, STOCKHOLM) > 40) return 'The demo homes are in Stockholm. Pick a starting point there.';
      setGps(here);
      set({ spot: 'gps', mode: 'near' });
      return null;
    } catch {
      return 'Could not find your location. Pick a starting point instead.';
    } finally {
      setLocating(false);
    }
  }, [set]);

  const value: AppState = {
    ...saved,
    ready,
    live: source.live,
    today,
    days,
    now,
    day,
    data,
    loadError,
    origin,
    place,
    feed,
    counts,
    locating,
    set,
    setDay: setDayState,
    togglePlan,
    inPlan,
    locateMe,
    reload: () => setReloads((n) => n + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
