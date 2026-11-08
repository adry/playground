# Chronicle Deluxe

The website for Chronicle Deluxe, a multidisciplinary business incubator:
fashion transformation consulting, AI implementation, Resourced, Quomoda,
Past Tense, GoodMargin, Dayzie and whatever comes next.

It is a single static page with no build step and no dependencies. Every word
is in the HTML, so search engines and link previews read it without running
any JavaScript; the script only adds motion on top.

```bash
cd chronicle-deluxe
python3 -m http.server 8765     # then open http://127.0.0.1:8765
```

## Deploying

Point any static host at this folder as the site root.

- **Vercel**: new project from this repo, Root Directory `chronicle-deluxe`,
  framework preset "Other", no build command.
- **Netlify / Cloudflare Pages**: publish directory `chronicle-deluxe`, no
  build command.

`404.html` uses root-relative paths (`/assets/...`) because it is served for
any missing URL at any depth; it only works when the site is at the domain
root. `index.html` uses relative paths, so it also works from a subfolder.

## Before launch: things to confirm

These were written from the best information available and are worth a
look before the site goes live.

| What | Where | Current value |
|---|---|---|
| Domain | `index.html` (canonical, Open Graph, JSON-LD), `sitemap.xml`, `robots.txt` | `https://chronicledeluxe.com` |
| Contact email | `index.html`, every `mailto:` | `hello@chronicledeluxe.com` |
| Dayzie one-liner | venture card 07 | A deliberately general description |
| GoodMargin name and App Store link | venture card 06, hero map | "GoodMargin", no link yet |
| Newsletter link | "Read the Chronicle" card | A `mailto:` subscribe request |
| Quomoda and Past Tense links | venture cards 04 and 05 | No link yet (only Resourced links out) |

Search the HTML for `chronicledeluxe.com` to catch every occurrence of the
domain and email in one go.

## Layout

```
index.html                 the page: content, meta tags, JSON-LD
404.html                   not-found page
assets/css/site.css        all styles, top to bottom in page order
assets/js/site.js          all motion, progressive enhancement only
assets/fonts/              self-hosted variable fonts (latin subset)
assets/img/og.png          1200x630 social card
assets/img/logo.png        logo used by structured data
favicon.svg / .ico, apple-touch-icon.png, site.webmanifest
robots.txt, sitemap.xml
```

## Adding a venture

1. Copy one `<li class="venture ...">` block in `index.html`, give it the
   next number, a two-letter symbol, a `view-transition-name` that is unique
   (`v9`, `v10`...) and `data-tags` from `fashion ai software apps`.
2. Add a tone class in `site.css` next to the others
   (`.c-name { --c: #hex; --on: <text colour on it>; }`). Keep it muted so
   the portfolio still reads as one house.
3. Give it an arm in the hero map: the map is an SVG in `index.html` with
   one `hm-item` group per business, spaced 360 / n degrees apart.
4. Update the counts on the filter chips, the "Seven businesses" headline,
   the "7 ventures" number, and the `ItemList` in the JSON-LD.

## Motion

All of it is driven by one `requestAnimationFrame` loop and a few
`IntersectionObserver`s in `site.js`:

- **Hero**: headline words rise from a mask. The house map draws itself in
  (rings, then one arm per business, then the nodes and labels), small
  pulses travel from the centre out along each arm, and hovering a business
  highlights its arm. The map drifts a few pixels with the pointer.
- **Ticker**: one quiet row of disciplines that picks up speed while you
  scroll.
- **Manifesto**: words darken as you read down.
- **Ventures**: filter chips animate the grid with the View Transitions API
  where the browser supports it; on hover a card lifts, its grid shifts and
  its symbol rises.
- **Approach**: a progress line fills and the steps light up as you scroll.
- **Numbers** count up, **principles** underline on hover, the founder
  monogram's rings draw in, the **footer wordmark** rises letter by letter.

`prefers-reduced-motion` turns the decorative motion off and shows
everything in its final state. If the script fails to load, an inline
fallback reveals the page after three seconds.

## SEO

- One `h1`, a section per topic with its own `h2`, venture names as `h3`.
- Title, description, canonical, Open Graph and Twitter card tags.
- JSON-LD: `Organization` (with the ventures as `subOrganization`),
  `WebSite`, an `ItemList` of the ventures and an `FAQPage` matching the FAQ.
- Fonts are self-hosted and preloaded, CSS and JS are one small file each,
  there are no third-party requests.

## Fonts

Bricolage Grotesque, Inter and Instrument Serif, all under the SIL Open Font
License 1.1, downloaded from Google Fonts and served from `assets/fonts/`.
