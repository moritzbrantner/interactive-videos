# interactive-videos

Interactive explainer videos built on Remotion. Viewers can watch straight through, or click a
chart element or an underlined subtitle word to pause the video and inspect the data behind it.

This repository is the consuming app that owns domain content. It combines:

- [`remotion-primitives`](https://github.com/moritzbrantner/remotion-primitives), installed as
  source through its shadcn registry (`src/components/remotion`, `src/lib/remotion`): `Hotspot`,
  `Subtitles` with clickable terms, `Fade`;
- [`@moritzbrantner/charts`](https://github.com/moritzbrantner/charts) for binning and percentiles
  (`density` entry point only);
- [`@moritzbrantner/tables`](https://github.com/moritzbrantner/tables) for the insight panel table.

## Run

```sh
bun install
bun run dev
```

`bun run verify` type-checks, runs the data tests, builds, and runs the render budget tests.

## Render budget

`bun run test:budget` (part of `bun run verify`) builds the app with `--mode render-budget`, in
which the video's components call `useRenderCounter` from `react-render-budget`, then steps the
Player frame by frame in Playwright and checks render budgets:

- during the bar reveal, only marks whose reveal progress changes redraw;
- after the reveal, frames redraw no chart marks at all;
- selecting a bar re-renders the composition root once and redraws no chart parts.

Budgets are upper bounds, so each frame scenario also asserts a lower bound: every frame-reading
`Bar` rendered on every stepped frame. Without it, a scenario in which nothing rendered would pass.

The Player re-renders the composition root on every frame, so frame-independent parts must be
memoized to stay out of the per-frame work. `Bar` only reads the frame; `BarMark` is memoized on
the resulting progress, so fully revealed bars stop redrawing. Normal builds contain no counters.

`react-render-budget` is pinned like the other packages. Node cannot strip TypeScript under
`node_modules`, so `bun run build:pins` copies the pinned source into `.cache/pins`, and
`e2e/tsconfig.json` points Playwright at that copy.

## Source pins

`charts` and `tables` are not consumed from npm. `package.json` pins each one to an exact GitHub
commit (`github:moritzbrantner/<repo>#<full sha>`); never replace a pin with a branch. Git installs
contain source but no built `dist/`, so `source-pins.ts` (Vite and Vitest) and `tsconfig.json`
`paths` resolve the entry points to the pinned `src/` files. Keep those two lists in sync.

To move a pin, review the upstream change, then `bun add
"@moritzbrantner/<repo>@github:moritzbrantner/<repo>#<new sha>"` and run `bun run verify`.

The remotion-primitives source in `src/components/remotion` and `src/lib/remotion` is installed
the same way, from an exact commit through the shadcn registry:
`bunx shadcn@4.20.1 add --overwrite "moritzbrantner/remotion-primitives/<item>#<sha>"`.

## Latency explainer

`src/video/latency-video.tsx` renders one day of synthetic API traffic (200,000 requests from a
seeded generator) as 48 half-hour p95 bars. Clicking a bar shows that bucket's request count,
percentiles, and slowest requests; clicking a subtitle term shows a glossary entry.

## VideoSpec

`src/spec/video-spec.ts` defines `VideoSpec` v1, the versioned data contract for a video's semantic
intent: project identity, format pack id/version, output profile, ordered scenes with a duration,
narration cues, asset references, interaction terms and a per-kind semantic payload (v1 kinds:
`title`, `binnedChart`). Layout pixels, easing, typography and renderer details belong to the
format pack and are not representable in a spec.

- `parseVideoSpec` / `parseVideoSpecJson` validate untrusted input and fail closed: unknown fields,
  unknown scene kinds and other spec versions are diagnostics with a JSON path, not ignored.
- `normalizeVideoSpec` and `serializeVideoSpec` give a canonical form (fixed key order, assets by
  id), so identical specs produce identical data and bytes. `resolveTimeline` derives scene starts
  and the total length.
- The module has no React or Remotion dependency and is tested as plain TypeScript.

The latency explainer's spec is `src/spec/fixtures/latency-explainer.videospec.json`. The video
reads its output profile, length, title, narration and glossary terms from it, and tests check
that the fixture round-trips byte for byte and agrees with the generated dataset.

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
- Chart marks are SVG inside `SvgHotspot`; HTML content such as subtitle words uses `Hotspot`.
