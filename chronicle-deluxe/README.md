# Chronicle Deluxe

The website for Chronicle Deluxe, a multidisciplinary business incubator:
fashion transformation consulting, AI implementation, Resourced, Quomoda,
Past Tense, GoodMargin, Dayzie and whatever comes next.

One static page, no build step, no dependencies. Black and white with one
accent, one typeface (Inter), and the story told through scroll-driven
scenes. Every word is in the HTML, so search engines and link previews read
it without running any JavaScript; the script only adds the motion.

```bash
cd chronicle-deluxe
python3 -m http.server 8765     # then open http://127.0.0.1:8765
```

## The page, top to bottom

| Section | What moves |
|---|---|
| Hero | Pinned for three screens. The headline fades as the house mark explodes into eight arms, one per business, and the labels arrive. |
| What we are | The manifesto darkens word by word as you read. |
| Two sources | Fashion know-how and our own daily problems. Giant type drifts sideways behind two cards that move at slightly different speeds. |
| Ventures | Pinned gallery: scrolling down slides the eight cards sideways. Each card's line drawing lags behind its card. |
| Numbers | Count up when they arrive. |
| Approach | A ring fills as you read the four steps; the step in the reading line shows inside it. |
| Rules | Pinned: the six rules hand over one at a time, never overlapping. |
| The house | A giant monogram moves slower than the page. |
| FAQ, contact, footer | Fade in; the footer wordmark drifts. |

## Brand settings

- **Accent**: `--accent` at the top of `assets/css/site.css`. Change that one
  value (and `--accent-hover`) and the whole site follows. The favicon, icons
  and social card use the same orange and need regenerating if it changes.
- **Typeface**: Inter, self-hosted in `assets/fonts/` (SIL Open Font License).
- **Greys**: Apple-style neutrals (`--ink`, `--snow`, `--gray`), chosen so
  every piece of text meets WCAG contrast on its background.

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

| What | Where | Current value |
|---|---|---|
| Domain | `index.html` (canonical, Open Graph, JSON-LD), `sitemap.xml`, `robots.txt` | `https://chronicledeluxe.com` |
| Contact email | every `mailto:` | `hello@chronicledeluxe.com` |
| Dayzie one-liner | ventures card 07 | A deliberately general description |
| GoodMargin name and App Store link | ventures card 06 | "GoodMargin", no link yet |
| Newsletter link | "Read the Chronicle" card | A `mailto:` subscribe request |
| Quomoda and Past Tense links | ventures cards 04 and 05 | Email links for now |

## Adding a venture

1. Copy one `<li class="vcard">` in `index.html` and give it the next number
   and an `id`. If it started as a fix for one of our own problems, give it
   the `<b class="own">Built for us first</b>` tag.
2. Add an arm to the hero mark (`.x-arm`, angles spaced 360 / n degrees) and a
   label in `.x-labels` with its `--x` and `--y` direction.
3. Update the "Seven businesses" lines, the "7 ventures" number and the
   `ItemList` in the JSON-LD. The gallery measures itself.

## Motion and accessibility

One `requestAnimationFrame` loop in `assets/js/site.js` drives every scene,
and only while that scene is near the viewport. It reads all layout values
first and writes styles after, so a frame never forces a second layout.

The scroll scenes switch on only under `html.motion`, which the inline head
script sets unless the visitor asks for reduced motion. Without it (reduced
motion, or the script failing to load) every section lays itself out
statically: the hero shows the open house, the rules are a list, and the
ventures become a swipeable row. Keyboard users who tab into an off-screen
venture card are scrolled to it.

## SEO

- One `h1`, a section per topic with its own `h2`, venture names as `h3`.
- Title, description, canonical, Open Graph and Twitter card tags.
- JSON-LD: `Organization` (ventures as `subOrganization`), `WebSite`, an
  `ItemList` of the ventures and an `FAQPage` matching the FAQ.
- Decorative giant type is drawn from data attributes, so it never reads as
  content.
- Self-hosted, preloaded font; one small CSS and JS file; no third-party
  requests. Lighthouse scores 100 in all four categories on mobile.
