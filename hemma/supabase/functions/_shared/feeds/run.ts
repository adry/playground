// One feed run: fetch, parse, normalize, store, log. The database and the
// network are passed in so this runs unchanged in the Edge Function and tests.

import { ADAPTERS } from './adapters/index.ts';
import { normalize } from './normalize.ts';
import type { AreaRef, FeedListing, Rejected } from './types.ts';

export interface Source {
  id: string;
  name: string;
  format: string;
  url: string;
  auth_secret_name: string | null;
}

export interface RunDeps {
  fetch: typeof fetch;
  secret: (name: string) => string | undefined;
  areas: AreaRef[];
  activeCount: (sourceId: string) => Promise<number>;
  apply: (sourceId: string, listings: FeedListing[], complete: boolean) => Promise<{ upserted: number; viewings: number; removed: number }>;
  now?: number;
}

export interface RunResult {
  status: 'ok' | 'partial' | 'failed';
  seen: number;
  upserted: number;
  removed: number;
  viewings: number;
  rejected: Rejected[];
  error: string | null;
}

// If a feed suddenly has far fewer homes than we hold, it is more likely
// broken than everything sold overnight, so nothing is removed that run.
const SHRINK_GUARD = 0.5;
const TIMEOUT_MS = 30000;

export async function runSource(source: Source, deps: RunDeps): Promise<RunResult> {
  const result: RunResult = { status: 'ok', seen: 0, upserted: 0, removed: 0, viewings: 0, rejected: [], error: null };
  try {
    const adapter = ADAPTERS[source.format];
    if (!adapter) throw new Error(`no adapter for format "${source.format}"`);
    const headers: Record<string, string> = { accept: adapter.contentType };
    if (source.auth_secret_name) {
      const token = deps.secret(source.auth_secret_name);
      if (!token) throw new Error(`secret ${source.auth_secret_name} is not set`);
      headers.authorization = `Bearer ${token}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let body: string;
    try {
      const res = await deps.fetch(source.url, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`feed answered ${res.status}`);
      body = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const raws = adapter.parse(body);
    const { ok, rejected } = normalize(raws, deps.areas, deps.now);
    result.seen = raws.length;
    result.rejected = rejected;

    const held = await deps.activeCount(source.id);
    const complete = held === 0 || ok.length >= held * SHRINK_GUARD;
    const applied = await deps.apply(source.id, ok, complete);
    Object.assign(result, applied);
    if (!complete) {
      result.status = 'partial';
      result.error = `feed had ${ok.length} homes against ${held} held; kept the missing ones until a full feed arrives`;
    } else if (rejected.length) {
      result.status = 'partial';
    }
  } catch (e) {
    result.status = 'failed';
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}
