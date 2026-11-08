import type { FacadeStyle, Package } from '@core/types.ts';

export type AgentStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Application {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  agencyName: string;
  orgNumber: string | null;
  fmiNumber: string | null;
  status: AgentStatus;
  reviewNote: string | null;
  appliedAt: string;
  agencyId: string | null;
}

export interface Session {
  email: string;
  isAdmin: boolean;
  agent: Application | null;
  agencyName: string | null;
}

export interface AgencyHome {
  id: string;
  address: string;
  area: string;
  areaName: string;
  price: number;
  rooms: number;
  size: number;
  fee: number | null;
  style: FacadeStyle;
  seed: number;
  floor: number | null;
  floors: number | null;
  images: string[];
  viewings: { start: number; end: number }[];
}

export interface DayStat {
  listingId: string;
  day: string;
  impressions: number;
  sponsored: number;
  opens: number;
  saves: number;
  directions: number;
  calls: number;
  agencyLinks: number;
}

export interface Boost {
  id: string;
  listingId: string;
  packageId: string;
  from: string;
  to: string;
  status: 'pending_payment' | 'active' | 'cancelled' | 'expired';
  amount: number;
}

export interface Pricing {
  packages: Package[];
  discount: { percent: number; until: string } | null;
  freeBoosts: number;
}

export interface FeedSource {
  id: string;
  name: string;
  mode: 'pull' | 'push';
  format: string;
  url: string | null;
  authSecretName: string | null;
  agencyName: string | null;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface ApplyForm {
  fullName: string;
  phone: string;
  agencyName: string;
  orgNumber: string;
  fmiNumber: string;
}

export interface Api {
  mode: 'demo' | 'live';
  session(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'>;
  signOut(): Promise<void>;
  apply(form: ApplyForm): Promise<void>;
  homes(): Promise<AgencyHome[]>;
  stats(from: string, to: string): Promise<DayStat[]>;
  boosts(): Promise<Boost[]>;
  pricing(): Promise<Pricing>;
  spotsLeft(listingId: string, from: string, to: string): Promise<Record<string, number>>;
  book(listingId: string, packageId: string, startDay: string): Promise<{ url?: string; free?: boolean; simulated?: boolean }>;
  cancel(boostId: string): Promise<void>;
  applications(): Promise<Application[]>;
  review(userId: string, decision: 'approved' | 'rejected', note: string): Promise<void>;
  feeds(): Promise<FeedSource[]>;
  addFeed(f: { name: string; mode: 'pull' | 'push'; format: string; url: string; authSecretName: string }): Promise<void>;
}
