# interactive-videos

Interactive explainer videos built on Remotion. Viewers can watch straight through, or click a
chart element or an underlined subtitle word to pause the video and inspect the data behind it.

This repository is the consuming app that owns domain content. It combines:

- [`remotion-primitives`](https://github.com/moritzbrantner/remotion-primitives), installed as
  source through its shadcn registry (`src/components/remotion`, `src/lib/remotion`): `Hotspot`,
  `Subtitles` with clickable terms, `Fade`;
- [`@moritzbrantner/charts`](https://github.com/moritzbrantner/charts) for binning and percentiles
  (`/density` entry point only);
- [`@moritzbrantner/tables`](https://github.com/moritzbrantner/tables) for the insight panel table.

## Run

```sh
bun install
bun run dev
```

`bun run verify` type-checks, runs the data tests, and builds.

`@moritzbrantner/tables` is not published to npm yet, so it is linked from a sibling checkout
(`file:../tables`). Build it first with `bun run build` in `../tables`.

## Latency explainer

`src/video/latency-video.tsx` renders one day of synthetic API traffic (200,000 requests from a
seeded generator) as 48 half-hour p95 bars. Clicking a bar shows that bucket's request count,
percentiles, and slowest requests; clicking a subtitle term shows a glossary entry.

## Rules

This app follows the performance rules from `remotion-primitives`:

- **Compute once, animate per frame.** Generation, indexing, binning, and bar geometry run once at
  module load (`src/data/latency.ts`). Frames only compute reveal progress.
- **Animate with `transform` and `opacity`.** Bars have fixed layout and reveal with `scaleY`.
- Static chart chrome is memoized and does not read the frame.

Integration notes learned while building this:

- Use the `charts` density index with `backend: "hybrid-js"`. The default progressive backend warms
  up asynchronously, so early frames could differ from later ones.
- Do not use the `charts` animation hooks or Recharts-based components in compositions; they run on
  wall-clock time or measure asynchronously.
- Keep hotspots out of the bottom of the frame. The Player's controls overlay intercepts clicks
  there, even while the controls are hidden.
- `Hotspot` renders HTML, so chart marks are HTML elements rather than SVG.
