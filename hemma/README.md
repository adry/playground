# Hemma

See which homes are open for viewing today, or on the day you pick, around
you or in the areas you choose. Estate agents pay to put a viewing first.

| Folder | What it is |
|---|---|
| `app/` | The buyer app for **iOS and Android** (Expo SDK 58, expo-router) |
| `dashboard/` | **Hemma for agents**, on the web: sign-up, manual approval, stats per home, buying boosts; plus the admin view |
| `supabase/` | The backend: database and access rules, feed import, stats, Stripe payments |
| `core/` | Rules shared by the app and dashboard: feed order, sponsored placement, the day planner, drawn facades, demo data |
| `docs/` | [Pricing research](docs/pricing.md) and [how listings get in](docs/feeds.md) |
| `prototype/` | The first single-page web prototype, kept for reference |

The app and the dashboard both run on demo data until they are pointed at a
Supabase project, so you can try them today.

## Try it

```bash
# Buyer app: open in Expo Go on your phone (scan the QR code), or press i / a
cd hemma/app && npm install && npx expo start

# Agent dashboard: http://127.0.0.1:5192, pick a demo role
cd hemma/dashboard && npm install && npm run dev

# Tests
cd hemma/core && node --test test/*.test.ts                            # feed rules, demo data
cd hemma/supabase && npm install && node --test test/*.test.ts         # real Postgres (PGlite), importer, signatures
```

Node 22.18 or later runs the TypeScript tests directly.

## How the pieces fit

```
agency systems (Mspecs, Vitec, own exports)
   │  push: signed events      pull: fetched every 15 min
   ▼
supabase  ── feed-push / ingest-feeds ──▶ listings, viewings
   │                                       ▲
   │ feed_window, active_promotions        │ agency_stats, reserve_promotion
   ▼                                       │
app (buyers) ── track() ──▶ events     dashboard (agents, admins) ── create-checkout ──▶ Stripe
                                                                   ◀── stripe-webhook ──
```

- **Buyers** get the homes with viewings in the next 14 days around them.
  The phone ranks them with `core/feed.ts`, the same code the dashboard
  previews and the tests check.
- **Sponsored placement:**
  - A boost only lifts a viewing that already matches the buyer's day, place
    and filters.
  - Never after the viewing has ended.
  - At most 3 sit at the top, and 3 spots are sold per area per viewing day.
- **Agents** sign up, send their agency, organisation number and FMI
  registration number, and wait. An admin checks the FMI register and
  approves them by hand. Approval links the agent to their agency's homes by
  organisation number.
- **Boosts are bought in the web dashboard, not in the app.** Apple treats
  ads bought inside an iOS app as in-app purchases (with its 15 to 30% cut),
  and agents work at a desk anyway.
- **Usage counting is anonymous:** a random id per app install, never an
  account or an IP address. Impressions count once per phone per home per
  day.

## Going live

1. **Create a Supabase project** (EU region), then from `hemma/`:
   ```bash
   supabase link --project-ref <ref>
   supabase db push                      # migrations/
   psql "$DB_URL" -f supabase/seed.sql   # areas
   supabase functions deploy ingest-feeds feed-push create-checkout stripe-webhook
   ```
2. **Set the function secrets:**
   - `INGEST_SECRET`
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
   - `DASHBOARD_URL` and `DASHBOARD_ORIGIN`
   - optionally `STRIPE_VAT_RATE_ID` (a 25% Swedish VAT tax rate)
   - one secret per feed, named as on the feed source
3. **Run `supabase/setup/schedule.sql`** in the SQL editor. It polls pull
   feeds every 15 minutes and releases unpaid holds.
4. **In Stripe**, point a webhook at `/functions/v1/stripe-webhook` for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   and `checkout.session.expired`.
5. **Make yourself admin:**
   `insert into admins (user_id) select id from auth.users where email = 'you@…';`
6. **Point the clients at it:**
   - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
     `app/.env`
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `dashboard/.env`
7. **Builds:** `npx eas-cli build` for TestFlight and Play internal testing.
   The bundle id `se.hemma.app` in `app/app.json` is a placeholder; change it
   to yours before the first build.

## What is verified, and what is not

**Verified here:**
- **Shared rules:** 13 tests.
- **Backend:** 17 tests.
  - The real migration runs on Postgres (PGlite) with a stand-in for
    Supabase auth, covering feed import and removal, agent application and
    approval, booking with ownership checks, sold-out areas and the launch
    offer, payment activation, tracking, and what anonymous users and other
    agents cannot read.
  - Importer: Swedish times and home types, rejected rows, the shrink guard,
    signed push events.
- **The four Edge Functions** type-check under Deno.
- **The app:** type-checks, bundles with Metro, and was clicked through in a
  phone-sized browser.
- **The dashboard:** type-checks, builds, and was clicked through in all
  three roles.

**Not verified:**
- The app on a physical iPhone or Android phone. Expo Go or an EAS build is
  the next step.
- Stripe payments end to end, which needs your Stripe account.
- Deployment to a real Supabase project.
- The Mspecs and Vitec integrations, which need partner access first; see
  [docs/feeds.md](docs/feeds.md).
