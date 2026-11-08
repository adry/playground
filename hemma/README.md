# Hemma: viewings near you

Hemma, revived with a new angle. The app answers one question for a buyer:
**what can I go and see today, or on the day I pick, around me or in the area I
choose?** Agents pay to put their viewing at the top of that feed.

This folder is a working prototype with generated Stockholm demo data. It is a
plain web app (no framework), so the rules and data model can move into the
Expo app or a backend unchanged.

```bash
cd hemma
npm install
npm run dev     # http://127.0.0.1:5190
npm test        # feed ranking and day-planner rules
npm run build   # dist/hemma.html, the whole app in one file
```

## What a buyer gets

- **Viewings** for the chosen day, around a starting point (1 to 10 km) or in
  picked areas. Today is split into *On now*, *Coming up* and *Earlier today*,
  with live countdowns; other days into morning, afternoon and evening. A 14-day
  strip shows how many viewings each day has, plus a date picker.
- **Map**: every viewing placed at its real distance and bearing, with rings in
  walking minutes. It draws no basemap tiles, so it works offline and anywhere.
- **My day**: viewings you add, in time order, with the walk between each one,
  when to leave, a warning when you would arrive too late, and the route handed
  to Google Maps.
- **Filters**: home type, rooms, highest price, and open viewings only (no
  pre-booking).

## How sponsored placement works

The rules live in `src/feed.js` and are covered by `test/feed.test.mjs`.

1. A boost only lifts a viewing the buyer would see anyway: same day, same
   area or distance, same filters. Paying never shows a home outside the search.
2. A viewing that has ended is never shown as sponsored.
3. At most 3 sponsored viewings sit on top (`MAX_SPONSORED`). Bigger packages
   go first; equal ones rotate daily so no agency owns the top slot.
4. A sponsored viewing is not repeated lower down, and is always labelled.

Agents buy **spots per area and day**, 3 per area-day (`SPOTS_PER_AREA_DAY`),
so a busy Sunday on Södermalm can sell out. A spot is only used on days the
home is actually shown. Placeholder prices, excl. VAT:

| Package | Days | Price | Placement |
|---|---|---|---|
| Day | 1 | 495 kr | First in the feed |
| Long weekend | 3 | 995 kr | Ahead of day boosts |
| Week | 7 | 1 795 kr | First in line, highlighted pin on the map |

The *For agents* tab signs in as a demo agent and lets you book a boost with a
simulated payment, then jump to the feed to see it on top.

## Files

```
src/data.js     demo listings, viewing schedule, packages, seeded boosts
src/feed.js     feed order, sponsored rules, inventory, day planner
src/facade.js   drawn building per listing (stone city, funkis, new build, villa, townhouse)
src/areas.js    Stockholm areas and starting points
src/main.js     the UI
build.mjs       bundles everything into one HTML file
```

## Demo data

Listings, prices, agencies and agents are invented; streets are real Stockholm
streets. Phone numbers use the 070-174 06 xx range reserved for fiction.
Viewing dates are generated relative to today, weighted the Swedish way:
mostly Sundays, often again Monday evening.

## Not built yet

- Where viewings come from: agents entering them, or an import from the
  systems agencies already publish listings with.
- Agent accounts, real payment, and reporting (impressions, saves, route adds).
- A real basemap in the native app (MapKit or Mapbox).
