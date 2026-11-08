# Getting listings in without typing them

Hemma never asks anyone to enter a listing by hand. Homes and their viewing
times come from the systems agencies already use to publish to Hemnet and
Booli. This page covers where that data can come from, what Hemma accepts
today, and what to do next. Researched November 2026.

**How reliable this is.** The research agent could not open the vendors'
developer pages from its sandbox, so this rests on search-engine extracts of
the cited pages. Read the Mspecs and Vitec docs yourself before signing
anything.

## Where Swedish listings live

Agencies manage listings in a back-office system (mäklarsystem) that
publishes to the portals. Booli names four systems that publish to it
directly, which is a fair picture of the market [1]:

| System | Who | How a new portal gets listings |
|---|---|---|
| **Vitec Express** | Says it is the market leader in Sweden; no independent share figures exist [2] | **Express Connect**, a REST API. Partner registration in the Connect portal is free, and then Vitec sets you up. Each agency must email written consent to Vitec. It is pull-only, with no general listing webhook found, and Vitec asks partners to cache images [3][4]. The built-in portal list ("Marknadsplatser") has no public way to join it; that needs talks with Vitec. |
| **Mspecs** | Owned by Mäklarsamfundet [5] | **Public integration docs for website and marketing providers.** You sign an agreement and get a provider account. Agencies opt in as subscribers themselves. Publish, unpublish and viewing events arrive as HMAC-SHA256-signed webhooks, and there is a test environment [6]. A newer portal reportedly gets its listings this way. |
| **FasAd** | Independent | An API exists, according to web agencies that use it; no public docs or partner programme were found [7]. |
| **FasIT** | Fastighetsbyrån's own system | Bilateral deals only, such as Booli's [8]. |

- **No common Swedish feed standard** was found, from Mäklarsamfundet, FMI
  or anyone else. Hemnet's own listing API (BostadsAPI), which the systems
  push to, is the de-facto reference. It carries viewings ("showings") as a
  separate resource with start and end, but has no flag for whether booking
  is required [9].
- **Do not scrape Hemnet or Booli.**
  - Hemnet's terms ban systematic or automated use and claim database
    protection [10].
  - EU database right (49 § upphovsrättslagen; the CJEU's Innoweb and
    CV-Online rulings) covers this kind of re-use, and a Danish court found
    housing-listing scraping infringing in October 2025 [11][12].
  - The ingestion design treats scraping as off the table.

## What Hemma accepts today

The format is Hemma's own, modelled on what the systems already send Hemnet
(a stable external id, coordinates, image URLs, a broker, viewings), plus
explicit booking fields. A feed source is set up by an admin in the
dashboard, in one of two modes.

### Pull: we fetch a full feed every 15 minutes

The feed is a URL returning either JSON (`{ "listings": [...] }` or a bare
array) or the same fields as XML. Optionally it is protected with a bearer
token, whose name is set on the source and whose value lives in the Edge
Function secrets.

A full feed is the truth:
- Homes missing from it are marked removed (sold or withdrawn).
- Upcoming viewings missing from a home are deleted.

If a feed suddenly holds less than half the homes we have from it, nothing
is removed that run, and the run is flagged in the admin view. A broken
export can therefore never empty an agency's listings.

### Push: the agency's system sends changes

This is how Mspecs-style webhooks arrive.

```
POST /functions/v1/feed-push?source=<feed source id>
x-hemma-timestamp: 1794140000
x-hemma-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">

{ "events": [
  { "type": "listing.upsert", "listing": { ...listing as below... } },
  { "type": "listing.unpublish", "externalId": "KV-1001" }
] }
```

- The signing key is shared with the sender and stored as an Edge Function
  secret.
- Requests older than 5 minutes are refused.
- Each event succeeds or fails on its own. The response lists every
  `externalId` with `ok` and a reason.

### A listing

```json
{
  "externalId": "KV-1001",
  "agencyName": "Kvarter & Co",
  "agencyOrgNumber": "556677-8899",
  "agentName": "Maja Ek",
  "agentEmail": "maja@kvarter.se",
  "agentPhone": "070-174 06 10",
  "address": "Skånegatan 84",
  "city": "Stockholm",
  "lat": 59.3135,
  "lng": 18.079,
  "type": "Bostadsrättslägenhet",
  "tenure": "Bostadsrätt",
  "rooms": 2.5,
  "size": 61,
  "price": 5250000,
  "fee": 3412,
  "floor": 3,
  "floors": 5,
  "built": 1909,
  "description": "Ljus tvåa med kakelugn…",
  "images": ["https://cdn.agency.se/kv-1001/1.jpg"],
  "url": "https://kvarter.se/objekt/kv-1001",
  "viewings": [
    { "start": "2026-11-15 13:00", "end": "2026-11-15 13:45" },
    { "start": "2026-11-16T17:30:00+01:00", "end": "2026-11-16T18:00:00+01:00", "booking": true, "bookingUrl": "https://kvarter.se/boka/kv-1001" }
  ]
}
```

The normalizer is `supabase/functions/_shared/feeds/normalize.ts`.

- **Required fields:** `externalId`, `address`, `lat`, `lng` and
  `agencyName`. A home without them is rejected, with the reason logged on
  the feed run.
- **Viewing times:** local times without an offset are read as Stockholm
  time, summer and winter. A viewing without an end gets 45 minutes.
- **Home types:** Swedish names (Bostadsrättslägenhet, Villa, Radhus,
  Kedjehus…) map to apartment, house or townhouse.
- **Images and links:** plain `http` image and page URLs are dropped.
- **Areas:** each home is matched to the nearest area within 2.5 km.
- **Agency:** `agencyOrgNumber` decides which agency a home belongs to. That
  number is also how an approved agent sees their homes.

## What to do next, in order

1. **Mspecs, first.** Sign the marketing-provider agreement and get a test
   account. Then write an `mspecs` adapter that maps their webhook payload
   onto the listing above and feeds `handlePush`. The signature check, the
   per-event handling and the unpublish path are already built. Agencies opt
   in themselves, so this scales without per-agency paperwork.
2. **Vitec, in parallel, for coverage.** Register in the Express Connect
   portal (free) and ask to join the Marknadsplatser list. Until then,
   onboard agencies one at a time with their written consent:
   - Write a `vitec` pull adapter that reads listings and viewings.
   - Poll it every 15 minutes; the schedule exists.
3. **FasAd and Fastighetsbyrån (FasIT): partnership talks.** Offer free
   distribution and viewing-driven traffic, and later booking write-back.
   Treat Booli/SBAB as a possible data partner, not a source to scrape.
4. **Any agency today:** one that can export its own listings as JSON or XML
   in the format above can be connected now, as a pull feed with its written
   permission.

Each new format is one file in `supabase/functions/_shared/feeds/adapters/`
plus a test fixture. Everything after parsing is shared.

## Personal data

Agent names, phone numbers and emails are personal data, and listing
addresses and photos can be linked to the seller.

- **Lawful basis:** most likely legitimate interest, with a documented
  balancing test.
- **Notice:** an Article 14 notice, since the data comes from agencies.
- **Agreements:** a data agreement with each agency or system that sets out
  roles.
- **Do not rely on a publishing certificate (utgivningsbevis) as the main
  basis.** Hemnet and Booli use one, but the Swedish data regulator (IMY)
  says it can still supervise such services (IMYRS 2024:1) [13].

What the build already does:
- Buyers never get an agent's email through the API (a column-level grant).
- App usage is counted per random install id: no accounts, no IP addresses.
- Location stays on the phone.

## Sources

1. Booli, publishing from your system: https://www.booli.se/vanliga-fragor/sv/articles/10545566-publicera-dina-objekt-pa-booli-med-ditt-maklarsystem
2. HusmanHagberg chooses Vitec Express: https://www.placera.se/pressmeddelanden/husmanhagberg-chooses-vitec-express-2015-08-19
3. Vitec Express Connect: https://connect.maklare.vitec.net/Help/ServicesOverview ; https://connect.maklare.vitec.net/Help/TechnicalInformation
4. Vitec agency consent: https://maklarhjalpen.freshdesk.com/support/solutions/articles/75000013549 ; marketplaces: https://maklarhjalpen.freshdesk.com/support/solutions/articles/75000127368-marknadsplatser
5. Mäklarsamfundet on Mspecs: https://www.maklarsamfundet.se/om-oss/ett-maklarsystem-av-maklare-maklare
6. Mspecs integration docs: https://integration.mspecs.se/ ; providers: https://www.mspecs.se/leverantorer/
7. FasAd via web agencies: https://www.prowebb.se/vara-tjanster/fasad-maklarsystem
8. Booli and Fastighetsbyrån: https://maklarvarlden.se/booli-och-fastighetsbyran-integrerar-sina-system/
9. Hemnet BostadsAPI docs (test environment): https://integration.testhemnet.se/documentation/v1
10. Hemnet terms: https://www.hemnet.se/om/anvandarvillkor
11. Bird & Bird on database rights: https://www.twobirds.com/en/insights/2021/global/database-rights-infringement-by-reutilisation-and-extraction
12. BoligPortal v ReData, Oct 2025: https://bdkadvokati.com/boligportal-v-redata-danish-court-finds-data-scraping-infringes-database-rights
13. IMY, IMYRS 2024:1: https://datainspektionen.se/globalassets/dokument/rattsligt-stallningstagande/imyrs-2024_1-klagomal-mot-soktjanster-med-utgivningsbevis.pdf
