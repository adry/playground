// Stripe tells us when a boost is paid (or the checkout expired).
import Stripe from 'npm:stripe@17.7.0';
import { env, serviceClient } from '../_shared/http.ts';

const stripe = new Stripe(env('STRIPE_SECRET_KEY'), { httpClient: Stripe.createFetchHttpClient() });
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, req.headers.get('stripe-signature') ?? '', env('STRIPE_WEBHOOK_SECRET'), undefined, crypto);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }
  const db = serviceClient();
  const session = event.data.object as Stripe.Checkout.Session;
  if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && session.payment_status === 'paid') {
    const { error } = await db.rpc('activate_promotion', { p_session: session.id });
    if (error) return new Response(error.message, { status: 500 }); // Stripe retries
  } else if (event.type === 'checkout.session.expired') {
    await db.from('promotions').update({ status: 'expired' }).eq('stripe_session_id', session.id).eq('status', 'pending_payment');
  }
  return new Response('ok');
});
