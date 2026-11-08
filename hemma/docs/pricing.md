# Boost pricing

What agencies and sellers pay today for visibility on Swedish portals, and
what Hemma charges for a boost. Researched November 2026.

**How reliable this is.** The research agent could not open hemnet.se,
placera.se or similar sites from its sandbox, so every figure below comes
from search-engine extracts of the cited pages, not from reading them in
full. Check Hemnet's current prices on hemnet.se/priser before launch. It is
also unconfirmed whether Hemnet's seller prices include 25% VAT; they
probably do.

## What sellers and agents pay today

### Hemnet listing packages

The packages are Bas, Plus, Premium and Max. Price depends on asking price
and municipality. Plus is being folded into Bas, and since 20 October 2026
there is also a free listing with fewer images and lower placement [1][2].

| Hemnet calculator, 30 Oct 2026 [5] | Bas | Premium | Max |
|---|---|---|---|
| Kungälv, 1 MSEK | 3,380 kr | 7,360 kr | 10,350 kr |
| Kungälv, 2 MSEK | 4,880 kr | 10,710 kr | 14,970 kr |
| Kungälv, 5 MSEK | 6,440 kr | 14,180 kr | 19,660 kr |
| Stockholm, 2 MSEK | 5,120 kr | 11,380 kr | 15,930 kr |

- **Stockholm flat at 4 to 6 MSEK:** no exact figure was found. Interpolating
  (not verified) gives Bas about 6,000 to 8,000 kr, Premium about 14,000 to
  19,000 kr and Max about 21,000 to 26,000 kr. Max in Stockholm was reported
  at "drygt 20,000" at 3 MSEK and "från 26,000" at 7 MSEK in 2025 [6].
- **House at 8 to 12 MSEK:** Max is at or near its ceiling of 32,490 kr
  (May 2025) [7].
- **Price trend:** average revenue per paid listing went from 3,706 kr in Q1
  2023 to 8,986 kr in Q3 2026 [7][8][9].
- **Criticism:**
  - Agents say "gränsen börjar bli nådd" (the limit is being reached)
    (May 2025) [7].
  - Konkurrensverket opened an abuse-of-dominance probe in March 2026 and
    closed it in July after Hemnet dropped a rule [14].
  - Paid listings fell 29.6% in Q3 2026 [9].
  - Fastighetsbyrån's share of sales advertised on Hemnet fell from 75% to
    60% during 2026 [13].

### Single boosts, the closest comparison to Hemma

| Product | What it does | Price |
|---|---|---|
| Hemnet Raketen | A copy of the listing at the top of results for 3 or 5 days, sold as a pre-viewing push; included in Premium (3 days) and Max (5 days) | 1,120 to 1,400 kr (2026) [5][16] |
| Hemnet Förnya | Gives the listing a new date | 3,060 to 5,910 kr [5] |
| Boneo Boost / Boost Plus | Top of results | 1,125 / 1,875 kr (undated) [19] |
| Meta campaign for one listing | Facebook and Instagram ads | 3,500 to 10,500 kr incl. VAT (CB Media); Norban gives sellers a 5,000 kr "boost", at least 1,500 kr of it ad spend [21][22] |
| Rightmove Featured Property (UK) | Top slot, 7 days | about £99 to £299 resold by agents (2026) [27] |
| Idealista (Spain) | 24 hours at the top | €11.90 (undated) [30] |

Booli is free for agents and sellers [17]. Its traffic rose 43% year on year
in September 2026 [18]. No current prices were found for Bovision or Blocket
Bostad.

Meta benchmarks for Sweden in 2026 are 60 to 120 kr per thousand impressions
and 4 to 12 kr per click [24].

## Hemma's prices

Excl. VAT, sold to the agency. The same prices apply nationwide at launch.

| Package | Covers | Price | Launch price |
|---|---|---|---|
| Day | One viewing day | **249 kr** | 125 kr |
| Viewing weekend | Three days from the day picked, such as Sunday and Monday viewings | **549 kr** | 275 kr |
| Week | Seven days, first in line, highlighted pin on the map | **949 kr** | 475 kr |

### Why these numbers

- **Below the boosts agents already buy.** A 3 to 5 day Raketen costs about
  900 to 1,120 kr excl. VAT, and a Boneo Boost about 900 kr. Hemma's viewing
  weekend costs about half a Raketen, and even the week is cheaper. Hemma is
  new and unproven, so it has to be an easy yes.
- **Small next to the listing itself.** Each package is 5% or less of what a
  Stockholm seller pays Hemnet for Premium or Max. Each is also below the
  minimum Meta spend that agencies' social packages include.
- **The weekend package starts on the day the agent picks.** It does not run
  Friday to Sunday, because the most common Swedish pattern is a Sunday
  viewing plus a Monday evening viewing.
- **Scarcity backs the price.** Only 3 sponsored spots are sold per area per
  viewing day, and a buyer never sees more than 3 sponsored viewings at the
  top. This also keeps the "Sponsored" label credible.

### Launch offer, as built

- **Three free boosts per agency.** This is `agencies.free_boosts`. A free
  boost goes live without Stripe.
- **50% off every boost until 31 March 2027.** This covers the spring market.
  It is stored in the `settings` table under `launch_discount`, so you can
  change or end it with one SQL update and no deploy.

These are a recommendation from the research, not something you asked for.
To launch without them:

```sql
update settings set value = '{"percent": 0, "until": "2000-01-01"}' where key = 'launch_discount';
alter table agencies alter column free_boosts set default 0;
update agencies set free_boosts = 0;
```

### Not done, on purpose

- **No commission to agents on boosts.** Hemnet pays agencies 0 to 30% of
  what sellers pay, and Boneo pays 50%. FMI is examining that model [15].
- **No pay per click yet.** Traffic is unknown, so revenue per click would be
  small and unpredictable. Once traffic is measurable, an optional 5 to 8 kr
  per click with a daily cap would be in line with Meta.
- **Instead: report delivered reach.** Every boost shows its sponsored views,
  opens and adds-to-a-day in the dashboard. After a pilot, consider a delivery
  guarantee: credit the next boost if a boost falls short of a set number of
  views.
- **Later:** a big-city surcharge of 20 to 30% once demand is proven, and
  10-packs at about 20% off.

## Sources

1. placera.se, Hemnet launches free listing format, 20 Oct 2026: https://www.placera.se/pressmeddelanden/hemnet-group-hemnet-lanserar-sitt-forsta-kostnadsfria-annonsformat-20261020
2. placera.se, free listings and 80 MSEK savings, 29 Sep 2026: https://www.placera.se/telegram/hemnet-group-hemnet-lanserar-gratisannonser-och-genomfor-besparingar-om-minst-80-miljoner-20260929
3. Hemnet Group, Hemnet Max launch, 31 Mar 2025: https://www.hemnetgroup.se/en/media/news/2025/hemnet-launches-hemnet-max-new-ad-package-for-maximum-visibility/
4. Hemnet prices: https://www.hemnet.se/priser
5. maklarofferter.se, 30 Oct 2026: https://www.maklarofferter.se/artiklar/s%C3%A4lja-bostad/hemnet-kostnad-pris ; ekonomifokus.se: https://www.ekonomifokus.se/bostad/salja-bostad-guide/annonsera-bostad-pa-hemnet
6. dagensps.se, 2025 (source of the 20k and 26k figures uncertain): https://www.dagensps.se/privatekonomi/bostad/maklare-rasar-mot-hemnets-nya-annonspriser/
7. TV4, 2 May 2025: https://www.tv4.se/artikel/7C6lAtdwO293GzZqzPxcJi/maeklare-kritiska-till-hemnets-nya-priser-graensen-boerjar-bli-nadd
8. Hemnet Q4 2025 report: https://storage.mfn.se/829de8ce-642f-4286-b129-9697ed025da0/hemnet-quarterly-report-q4-2025-eng.pdf
9. Hemnet Q3 2026 report, 22 Oct 2026: https://storage.mfn.se/756c70d9-d5ab-418d-b1be-c0392061788f/hemnet-quarterly-report-q3-2026-eng.pdf
13. SVT, autumn 2026: https://www.svt.se/nyheter/ekonomi/bolagets-krisdrag-gratisannonser-och-skrapning
14. Konkurrensverket, case 26-0216, Jul 2026: https://www.konkurrensverket.se/globalassets/dokument/konkurrens/beslut/avskrivningsbeslut/26-0216-.pdf
15. bostadspolitik.se, FMI examining Hemnet's commissions: https://bostadspolitik.se/hemnets-ersattningsmodell-till-maklare-granskas-av-fmi/
16. Hemnet, what Raketen is: https://www.hemnet.se/kundservice/saljare/paket-och-produkter-category-55afd630-4fe0-4799-a92e-69897ed36e30/vad-ar-raketen-document-f262bb5f-4046-49aa-9659-7cd41c898a49
17. Booli is free: https://www.booli.se/kunskap/visste-du-att-booli-ar-gratis
18. dagensps.se, Oct 2026: https://www.dagensps.se/privatekonomi/svenskarna-lamnar-hemnet-graver-sin-egen-grav/
19. Boneo prices: https://boneo.freshdesk.com/support/solutions/articles/47001238561-vad-kostar-det-att-ha-sin-bostadsannons-pa-boneo-
21. CB Media: https://social.cbmedia.se/
22. Norban terms: https://norban.se/villkor
24. semantiko.com, Meta ads costs 2026: https://semantiko.com/kunskapsbank/vad-kostar-meta-ads
27. propelr.co.uk, 2026: https://www.propelr.co.uk/guides/rightmove-vs-zoopla-for-sellers
30. helpmycash.com: https://www.helpmycash.com/blog/cuanto-cuestan-los-anuncios-premium-en-los-portales-inmobiliarios/
