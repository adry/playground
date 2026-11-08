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
| §05 Built for us first | AI implementation (an agent typing its day), Good Zones (live clocks) and Dayzie (today's progress, live). |
| §06 Also | Quomoda and Resourced, as on the live site; rows fill black on hover. |
| §07 Clients | Two giant tickers in opposite directions, faster while you scroll, plus the plain list. |
| Let's talk | Pinned: the red dot grows until it is the whole screen, then "LET'S TALK." arrives. |

## Brand settings

- **Red**: `--red` (#E63946, the dot) and `--red-deep` (#DC2F3E, behind white
  text so it passes contrast) at the top of `assets/css/site.css`.
- **Type**: Inter Tight and JetBrains Mono, self-hosted in `assets/fonts/`
  (SIL Open Font License).
- **Images**: `assets/img/past-tense/` are the live site's Past Tense images,
  converted to WebP.

## Deploying

Point any static host at this folder as the site root (Vercel: Root
Directory `chronicle-deluxe`, preset "Other", no build command; Netlify or
Cloudflare Pages: publish directory `chronicle-deluxe`).

`404.html` uses root-relative paths, so it only works at the domain root;
`index.html` uses relative paths and also works from a subfolder.

## Before launch: things to confirm

| What | Where | Current value |
|---|---|---|
| Quomoda description | §06 and JSON-LD | "Fashion online academy", as on the live site |
| Dayzie one-liner and link | §05 card and footer | A general description and an email link |
| AI implementation link | §05 card | An email link |

## Motion and accessibility

One `requestAnimationFrame` loop in `assets/js/site.js` drives every scene,
only while the scene is near the viewport, reading layout first and writing
styles after. The scroll scenes switch on only under `html.motion`, which
the inline head script sets unless the visitor asks for reduced motion.
Without it every chapter lays out statically: the lookbook becomes a
swipeable row, and the finale is simply red.
