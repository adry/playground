// The real backend: Supabase Auth for sign-in, the database functions in
// supabase/migrations for everything else. Row-level security decides what
// each account sees; nothing here is trusted to enforce it.
import { createClient } from '@supabase/supabase-js';
import type { FacadeStyle, Package } from '@core/types.ts';
import type { AgencyHome, Api, Application, Boost, DayStat, FeedSource } from './types';

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

const toApp = (r: any): Application => ({
  userId: r.user_id, fullName: r.full_name, email: r.email, phone: r.phone, agencyName: r.agency_name, orgNumber: r.org_number,
  fmiNumber: r.fmi_number, status: r.status, reviewNote: r.review_note, appliedAt: r.applied_at, agencyId: r.agency_id,
});

function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function liveApi(url: string, key: string): Api {
  const db = createClient(url, key);
  let areaNames: Record<string, string> | null = null;

  async function me() {
    const { data } = await db.auth.getUser();
    return data.user;
  }

  // Homes and running boosts are public, so "mine" must be asked for by agency.
  async function myAgency(): Promise<string> {
    const user = await me();
    const { data } = await db.from('agents').select('agency_id').eq('user_id', user?.id ?? '').eq('status', 'approved').maybeSingle();
    if (!data?.agency_id) throw new Error('Your account is not approved for an agency yet.');
    return data.agency_id;
  }

  return {
    mode: 'live',
    async session() {
      const user = await me();
      if (!user) return null;
      const [{ data: app }, { data: admin }] = await Promise.all([
        db.from('agents').select('*').eq('user_id', user.id).maybeSingle(),
        db.rpc('is_admin'),
      ]);
      let agencyName: string | null = null;
      if (app?.agency_id) {
        const { data } = await db.from('agencies').select('name').eq('id', app.agency_id).maybeSingle();
        agencyName = data?.name ?? null;
      }
      return { email: user.email ?? '', isAdmin: !!admin, agent: app ? toApp(app) : null, agencyName };
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
      fail(error);
      return data.session ? 'signed-in' : 'confirm-email';
    },
    async signOut() {
      await db.auth.signOut();
    },
    async apply(f) {
      const { error } = await db.rpc('apply_as_agent', {
        p_full_name: f.fullName, p_phone: f.phone, p_agency_name: f.agencyName, p_org_number: f.orgNumber, p_fmi_number: f.fmiNumber,
      });
      fail(error);
    },
    async homes(): Promise<AgencyHome[]> {
      if (!areaNames) {
        const { data } = await db.from('areas').select('id, name');
        areaNames = Object.fromEntries((data ?? []).map((a) => [a.id, a.name]));
      }
      const { data, error } = await db
        .from('listings')
        .select('id, address, area_id, price, rooms, size, fee, style, floor, floors, images, viewings(starts_at, ends_at)')
        .eq('agency_id', await myAgency())
        .eq('status', 'for_sale')
        .order('address');
      fail(error);
      return (data ?? []).map((r: any) => ({
        id: r.id, address: r.address, area: r.area_id ?? '', areaName: areaNames?.[r.area_id] ?? '', price: Number(r.price ?? 0),
        rooms: Number(r.rooms ?? 0), size: Number(r.size ?? 0), fee: r.fee, style: (r.style ?? 'stenstad') as FacadeStyle, seed: seedOf(r.id),
        floor: r.floor, floors: r.floors, images: r.images ?? [],
        viewings: (r.viewings ?? []).map((v: any) => ({ start: Date.parse(v.starts_at), end: Date.parse(v.ends_at) })).sort((a: any, b: any) => a.start - b.start),
      }));
    },
    async stats(from, to): Promise<DayStat[]> {
      const { data, error } = await db.rpc('agency_stats', { p_from: from, p_to: to });
      fail(error);
      return (data ?? []).map((r: any) => ({
        listingId: r.listing_id, day: r.day, impressions: Number(r.impressions), sponsored: Number(r.sponsored_impressions), opens: Number(r.opens),
        saves: Number(r.saves), directions: Number(r.directions), calls: Number(r.calls), agencyLinks: Number(r.agency_links),
      }));
    },
    async boosts(): Promise<Boost[]> {
      const { data, error } = await db.from('promotions').select('id, listing_id, package_id, starts_on, ends_on, status, amount_sek')
        .eq('agency_id', await myAgency())
        .in('status', ['active', 'pending_payment']).gte('ends_on', new Date().toISOString().slice(0, 10));
      fail(error);
      return (data ?? []).map((r: any) => ({ id: r.id, listingId: r.listing_id, packageId: r.package_id, from: r.starts_on, to: r.ends_on, status: r.status, amount: r.amount_sek }));
    },
    async pricing() {
      const user = await me();
      const [{ data: pk }, { data: st }, { data: ag }] = await Promise.all([
        db.from('packages').select('id, name, days, price_sek, tier').eq('active', true).order('tier'),
        db.from('settings').select('value').eq('key', 'launch_discount').maybeSingle(),
        db.from('agents').select('agency_id, agencies(free_boosts)').eq('user_id', user?.id ?? '').maybeSingle(),
      ]);
      const blurbs: Record<string, string> = {
        day: 'First in the feed for one viewing day.',
        weekend: 'Three days in a row, such as Sunday and Monday viewings, placed ahead of day boosts.',
        week: 'Seven days, first in line, and a highlighted pin on the map.',
      };
      const packages: Package[] = (pk ?? []).map((p: any) => ({ id: p.id, name: p.name, days: p.days, price: p.price_sek, tier: p.tier, blurb: blurbs[p.id] ?? '' }));
      const d = st?.value as { percent: number; until: string } | undefined;
      const todayKey = new Date().toISOString().slice(0, 10);
      return {
        packages,
        discount: d && d.percent > 0 && d.until >= todayKey ? d : null,
        freeBoosts: (ag as any)?.agencies?.free_boosts ?? 0,
      };
    },
    async spotsLeft(listingId, from, to) {
      const { data, error } = await db.rpc('spots_left', { p_listing: listingId, p_from: from, p_to: to });
      fail(error);
      return Object.fromEntries((data ?? []).map((r: any) => [r.day, r.left_count]));
    },
    async book(listingId, packageId, startDay) {
      const { data, error } = await db.functions.invoke('create-checkout', { body: { listingId, packageId, startDay } });
      if (error) {
        const detail = await (error as any).context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      return data as { url?: string; free?: boolean };
    },
    async cancel(id) {
      const { error } = await db.rpc('cancel_promotion', { p_id: id });
      fail(error);
    },
    async applications() {
      const { data, error } = await db.from('agents').select('*').order('applied_at', { ascending: false });
      fail(error);
      return (data ?? []).map(toApp);
    },
    async review(userId, decision, note) {
      const { error } = await db.rpc('review_agent', { p_user: userId, p_decision: decision, p_note: note || null });
      fail(error);
    },
    async feeds(): Promise<FeedSource[]> {
      const { data, error } = await db.from('feed_sources').select('*, agencies(name)').order('name');
      fail(error);
      return (data ?? []).map((r: any) => ({
        id: r.id, name: r.name, mode: r.mode, format: r.format, url: r.url, authSecretName: r.auth_secret_name, agencyName: r.agencies?.name ?? null,
        active: r.active, lastRunAt: r.last_run_at, lastStatus: r.last_status, lastError: r.last_error,
      }));
    },
    async addFeed(f) {
      const { error } = await db.from('feed_sources').insert({
        name: f.name, mode: f.mode, format: f.format, url: f.url || null, auth_secret_name: f.authSecretName || null,
      });
      fail(error);
    },
  };
}
