// Small helpers shared by the Edge Functions (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

export const env = (name: string): string => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

// The dashboard's origin, so browsers may call checkout from it.
const ORIGIN = Deno.env.get('DASHBOARD_ORIGIN') ?? '*';
export const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

export const serviceClient = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// A client that acts as the caller, so database rules apply to them.
export const callerClient = (authorization: string) =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
