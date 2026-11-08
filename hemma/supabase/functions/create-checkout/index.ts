// An approved agent books a boost: the spot is held in the database under the
// agent's own rights, then Stripe Checkout collects payment. A free launch
// boost skips Stripe entirely.
import Stripe from 'npm:stripe@17.7.0';
import { callerClient, cors, env, json, serviceClient } from '../_shared/http.ts';

const stripe = new Stripe(env('STRIPE_SECRET_KEY'), { httpClient: Stripe.createFetchHttpClient() });

interface Held {
  id: string;
  status: 'pending_payment' | 'active';
  amount_sek: number;
  starts_on: string;
  ends_on: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const authorization = req.headers.get('authorization');
  if (!authorization) return json({ error: 'sign in first' }, 401);
  const { listingId, packageId, startDay } = await req.json().catch(() => ({}));
  if (!listingId || !packageId || !/^\d{4}-\d{2}-\d{2}$/.test(startDay ?? '')) return json({ error: 'listingId, packageId and startDay are required' }, 400);

  const agent = callerClient(authorization);
  const { data, error } = await agent.rpc('reserve_promotion', { p_listing: listingId, p_package: packageId, p_start: startDay }).single();
  const promo = data as Held | null;
  if (error || !promo) return json({ error: error?.message ?? 'could not book' }, 400);
  if (promo.status === 'active') return json({ free: true, promotionId: promo.id });

  const [{ data: home }, { data: pkg }, { data: me }] = await Promise.all([
    agent.from('listings').select('address').eq('id', listingId).single(),
    agent.from('packages').select('name').eq('id', packageId).single(),
    agent.auth.getUser(),
  ]);
  const site = env('DASHBOARD_URL');
  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  const vat = Deno.env.get('STRIPE_VAT_RATE_ID');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: me?.user?.email,
    line_items: [{
      quantity: 1,
      ...(vat ? { tax_rates: [vat] } : {}),
      price_data: {
        currency: 'sek',
        unit_amount: promo.amount_sek * 100,
        product_data: { name: `Hemma boost, ${pkg?.name}`, description: `${home?.address}, ${promo.starts_on} to ${promo.ends_on}` },
      },
    }],
    invoice_creation: { enabled: true },
    metadata: { promotion_id: promo.id },
    expires_at: expiresAt,
    success_url: `${site}/#listings?paid=${promo.id}`,
    cancel_url: `${site}/#listings?cancelled=${promo.id}`,
  });
  await serviceClient().from('promotions')
    .update({ stripe_session_id: session.id, hold_until: new Date(expiresAt * 1000).toISOString() })
    .eq('id', promo.id);
  return json({ url: session.url, promotionId: promo.id });
});
