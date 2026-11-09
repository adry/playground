# Chronicle Deluxe

The website for Chronicle Deluxe, a multidisciplinary business incubator:
strategy for fashion and luxury brands since 2007, AI implementation, and its
own ventures (Past Tense, Good Margin, Good Zones, Dayzie, Quomoda, Resourced).

Built on the identity of the live www.chronicledeluxe.com: white, black
Inter Tight, JetBrains Mono for the small labels, the red dot, numbered
chapters, the Past Tense photography and the red "Let's talk" finale. Then
modernised and animated.

One static page, no build step, no dependencies. Every word is in the HTML,
so search engines and link previews read it without JavaScript; the script
only adds the motion.

```bash
cd chronicle-deluxe
python3 -m http.server 8765     # then open http://127.0.0.1:8765
```

## The page, chapter by chapter

| Chapter | What moves |
|---|---|
| Header | Shows the chapter you are in (`§03 Past Tense`) and swaps as you scroll. "Index" opens a full-screen chapter list. Turns white over the red finale. |
| Hero | "One house. Many businesses." rises line by line, then the red dot lands. A thin ring with a red dot orbits behind, as on the brand's social card. |
| Statement | AI first, our own ventures, our own daily problems: words darken as you read. |
| §01 Services, §02 Technologies | The live site's two tables. Rows rise in; on hover a row fills black. |
| §03 Past Tense | The headline rises word by word, the photo unveils from below and drifts. Then the lookbook pins and slides sideways; the frame in the centre comes into colour. The eight seasons follow, with SS27 pulsing. |
| §04 Good Margin | The phone settles from a tilt as it arrives, the cards slide in and the margins count up. |
| §05 Built for us first | AI implementation in the house style (an agent typing its day). Then Good Zones and Dayzie, each in its own look: Good Zones' live clock cards (drag any slider and every city follows), Dayzie's sticker, countdown ticket and real app screen. |
| §06 Also | Quomoda and Resourced, rebuilt from their own landing pages: Quomoda's hero (particles, glow, AI pill, word rise, magnetic buttons) and its four step cards, whose status pills turn over as you scroll; Resourced's two-tone sentence with the role flipping under a yellow marker, over the real WebGL mark cloud. |
| §07 Clients | Two giant tickers in opposite directions, faster while you scroll, plus the plain list. |
| Let's talk | Pinned: the red dot grows until it is the whole screen, then "LET'S TALK." arrives. |

## Brand settings

- **Red**: `--red` (#E63946, the dot) and `--red-deep` (#DC2F3E, behind white
  text so it passes contrast) at the top of `assets/css/site.css`.
- **Type**: Inter Tight and JetBrains Mono, self-hosted in `assets/fonts/`
  (SIL Open Font License).
- **Images**: `assets/img/past-tense/` are the live site's Past Tense images,
  converted to WebP.
- **Ventures**: each venture panel is ported from its own site's source:
  Dayzie from adry/dayzie (styles.css, App Store link and badge), Quomoda
  from adry/fashionOS (`src/pages/Landing.tsx`, `index.css`), Resourced from
  Resourced-AB/Landing-Page. Resourced's mark cloud is that repo's
  `src/js/loader`, vendored unchanged in `assets/js/vendor/resourced/` and
  loaded only when the panel comes near. Good Zones copies goodzon.es.
  Logos and screens are in `assets/img/ventures/`. Resourced uses Inter (`inter-var.woff2`);
  Dayzie uses the system rounded font on Apple devices and Nunito
  (`nunito-var.woff2`) elsewhere; Quomoda and Good Zones use the system sans,
  as their sites do. These fonts only load when their panel is on screen.

## Deploying

Point any static host at this folder as the site root (Vercel: Root
Directory `chronicle-deluxe`, preset "Other", no build command; Netlify or
Cloudflare Pages: publish directory `chronicle-deluxe`).

In this repository, `vercel.json` and `scripts/vercel-build.sh` at the root
let one repo feed two Vercel projects: the chronicledeluxe2.0 project serves
this folder as it is, and every other project (playground) builds the Vite app
as before. Neither project's saved settings change.

`404.html` uses root-relative paths, so it only works at the domain root;
`index.html` uses relative paths and also works from a subfolder.

## Before launch: things to confirm

| What | Where | Current value |
|---|---|---|
| AI implementation link | §05 card | An email link |

## Motion and accessibility

One `requestAnimationFrame` loop in `assets/js/site.js` drives every scene,
only while the scene is near the viewport, reading layout first and writing
styles after. The scroll scenes switch on only under `html.motion`, which
the inline head script sets unless the visitor asks for reduced motion.
Without it every chapter lays out statically: the lookbook becomes a
swipeable row, and the finale is simply red.
