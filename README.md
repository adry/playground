# WebGL Lab

A workshop for building looping WebGL pieces in three.js and exporting them as
video you can post.

Every component is written as a **pure function of loop phase**. Nothing reads a
wall clock, nothing integrates state between frames. That one constraint buys
three things at once:

- clips loop with **no seam** — the last frame hands off to the first,
- the preview, a re-render and an export are **byte-identical**,
- the recorder can take four seconds per frame on a software renderer and still
  produce exactly the file a GPU would.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5183
```

| key | |
|---|---|
| `1`–`9` | switch component |
| `space` | pause |
| `r` | restart the loop |
| `q` | cycle quality tier (high / medium / draft) |
| `h` | hide the UI |

## Components

| id | what it is |
|---|---|
| `curl-drift` | Domain-warped noise field drawn as motion trails, rotating one full turn per loop. |
| `gyroid-field` | Raymarched triply-periodic minimal surface with a hand-authored environment map. |
| `lattice-wave` | Instanced rods riding a travelling wave — one draw call, height and colour derived in the vertex shader. |
| `contour-flow` | Engraved topographic contour lines drifting through a warped field. |

## Recording video

```bash
# one component, square, ready to post
node capture/record.mjs --id curl-drift --preset square

# everything, 60fps, full quality
node capture/record.mjs --all --preset portrait --fps 60 --quality high

# stills, for art direction
node capture/shot.mjs --id gyroid-field --phases 0,0.25,0.5,0.75
```

Output lands in `out/`.

| flag | default | |
|---|---|---|
| `--id` | first component | comma-separated ids |
| `--all` | | record every component |
| `--preset` | `square` | `square` 1080², `portrait` 1080×1350, `landscape` 1920×1080, `vertical` 1080×1920 |
| `--w` / `--h` | from preset | explicit size (both must be even) |
| `--fps` | `60` | |
| `--subframes` | `2` | sub-frames averaged per output frame — this is the motion blur |
| `--shutter` | `0.5` | fraction of the frame the shutter is open; `0.5` is a 180° shutter |
| `--quality` | `high` | `high` / `medium` / `draft` |
| `--crf` | `16` | x264 quality, lower is bigger and better |
| `--loops` | `1` | repeat the loop N times in one file |

The MP4 comes out H.264 High / yuv420p / faststart with a silent AAC track —
what X, Instagram and LinkedIn all want. Because the loop is seamless, a
6-second clip reads as endless when a platform auto-loops it.

### Rendering speed

On a machine with a GPU this is close to real time. In a headless container
there is no GPU, so Chromium rasterises WebGL on the CPU via SwiftShader and a
1080² frame takes a couple of seconds. Nothing about the output changes — only
how long you wait. Force GPU mode with `LAB_GPU=1`.

## How smoothness is engineered

Smooth motion in an exported clip is not the same problem as a high frame rate
in a browser. Four things do the work:

1. **Fixed-timestep, phase-driven animation.** No `deltaTime`. Frame *n* is
   `render(n / fps)`, so the exported motion is perfectly even even when the
   renderer stutters.
2. **Sub-frame accumulation.** Each output frame averages several renders taken
   across the shutter interval, in a half-float buffer. This is real motion
   blur, not a velocity-vector fake, so fast detail stays coherent instead of
   strobing.
3. **Sub-pixel jitter.** Those sub-frames are each offset by a fraction of a
   pixel along a Halton sequence, which turns the accumulation buffer into a
   supersampled anti-aliaser for free. MSAA on the scene pass handles the
   single-sub-frame case.
4. **Dither before 8-bit.** Everything upstream is linear half-float; the final
   pass tone maps, encodes and adds triangular-PDF dither. Without it, smooth
   gradients band the moment a platform re-compresses the clip.

## How looping works

Noise is sampled along a **closed path** through noise space: `loopOffset()`
walks a circle, so at phase 1 every octave is exactly back where it started.
Anything else that moves either completes a whole number of cycles
(`sin(TAU * phase * 2)`), makes exactly one full revolution, or travels exactly
one period of a periodic field.

The trap to avoid: differential motion that *accumulates* — a rotation whose
speed varies with radius, or a real particle integration. Those never return to
their starting state, and the cut shows. `curl-drift` gets its vortex twist from
a static term for exactly this reason.

## Adding a component

Drop a file in `src/components/`, export a factory, add it to
`src/registry.js`. The contract:

```js
export default function myPiece() {
  return {
    id: 'my-piece',
    title: 'My Piece',
    note: 'One line for the menu.',
    duration: 6,            // loop period in seconds
    grade: { bloom: 0.6 },  // optional compositor overrides

    async init({ renderer, quality }) {},
    resize(width, height) {},

    // Called once per sub-frame. phase is 0..1 across the loop; jitter is a
    // sub-pixel offset to fold into the projection.
    render(renderer, target, { phase, jitter, width, height }) {},

    dispose() {},
  };
}
```

Render into the `target` you are handed, not to the canvas — the compositor owns
everything after that. Scale your work by the `quality` tier rather than
hard-coding counts, so the piece stays previewable at draft and shippable at
high.

## Layout

```
src/
  engine/
    stage.js        pipeline driver: sub-frames, jitter, phase
    compositor.js   accumulation, bloom, tone map, dither
    camera.js       closed camera paths, Halton jitter
    backdrop.js     gradient background
    quality.js      quality tiers
  shaders/lib/      simplex noise + loop-safe fbm, colour helpers
  components/       the pieces
capture/
  record.mjs        frame-stepped MP4 export
  shot.mjs          stills
```

Simplex noise is Ashima Arts / Stefan Gustavson's `webgl-noise` (MIT), vendored
in `src/shaders/lib/noise.glsl.js`.
