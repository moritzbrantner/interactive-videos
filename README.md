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

## Project catalog

The app hosts several videos. `src/projects.ts` lists each project as its VideoSpec (project
content) plus the format pack that renders it; `src/catalog/catalog.ts` validates the specs, keys
them by `project.id` and resolves an id into a composition whose width, height, fps and
`durationInFrames` come from the spec. Unknown ids, a spec registered with a format pack it does
not target, and specs a format cannot render are resolve errors, never a fallback to another video.

- `?project=<id>` selects the project; the catalog nav pushes history entries and back/forward
  restore them. `/` opens the default project, the latency explainer.
- The Player wrapper exposes `data-composition-id`, `data-width`, `data-height`, `data-fps` and
  `data-duration-in-frames`; an unknown id renders a `role="alert"` and no composition.
- Format packs (`src/formats/`, and the latency format in `src/video/latency-format.tsx`) hold the
  reusable rendering code. `title-card` v1 renders `title` scenes and draws the
  `catalog-title-card` fixture (portrait 1080x1920 at 24 fps).
- A format with hotspots supplies `renderInsight`, and only then does the app show the insight
  panel.

## moenarch-short-v1 format pack

`src/formats/moenarch-short/` is a reusable portrait short format (1080x1920 at 30 fps). Its look
is original and deliberately restrained: a warm charcoal ground, off-white serif headlines, a quiet
sans for eyebrows and subtitles, and one accent for rules and the signature mark.

- **Tokens** (`tokens.ts`, `moenarchShortV1Tokens`): every format choice as one deep-frozen data
  object: output profile and safe area, type scale and text density, palette, surfaces, spacing,
  pacing ranges, the transition vocabulary (`cut`, `dissolve`, `lift`, `slide`), easing curves,
  media treatment, scene archetype text styles and densities, subtitle placement,
  intro/outro/signature, reduced motion and the accents.
  Other pack files and `src/projects.ts` restate no colours, fonts or easing curves. A new look is
  a new format version.
- **Plan** (`plan.ts`): `planMoenarchShort(spec)` checks that the spec fits the format (scene
  kinds, the output profile, pacing range, the scene layout) and places one transition on each
  scene boundary, cycling through the vocabulary; `moenarchFrameState(plan, frame)` says what a
  frame shows. Both are plain TypeScript, and the composition only draws that state, so all
  motion comes from `useCurrentFrame()` and token easings.
- **Overrides**: `moenarchShort({ accent: 'verdigris' })` picks one of the named accents in
  `tokens.accents`; every other key or value throws.
- **Reduced motion**: with `prefers-reduced-motion: reduce`, moving transitions become the
  motionless `reducedMotion.transition` over the same window, and the intro/outro only fade.
- **Specimen**: `?project=moenarch-specimen` (`src/spec/fixtures/moenarch-specimen.videospec.json`)
  shows every transition, the intro, outro and subtitles.

### Scene archetypes

The pack draws a small editorial vocabulary, so most house-style shorts are assembled from
semantic VideoSpec payloads instead of a new component per sentence. One renderer per archetype
lives in `scenes/`:

| Archetype | VideoSpec kind | Draws |
| --- | --- | --- |
| hook/title | `title` | eyebrow, serif headline, accent rule |
| statement/emphasis | `statement` | one sentence, its `emphasis` phrase in the accent |
| illustration/media reveal | `mediaReveal` | a `static:` image full frame under the scrim, optional caption |
| comparison | `comparison` | exactly two sides, each a label over its detail |
| quote/callout | `quote` | the quote in serif italic, optional attribution |
| diagram/data point | `dataPoint` | one large figure, what it counts, optional context |
| list/progression | `list` | up to six items; `ordered` numbers them as steps |
| conclusion/outro | `conclusion` | the closing line and an optional takeaway |

- **Layout** (`layout.ts`, plain TypeScript): `layoutMoenarchScene(scene, tokens, assets)` returns
  the scene's visible text blocks in reading order and its media. Each block wraps greedily at the
  characters per line of its archetype's density in `tokens.scenes.archetypes` (the title heading
  uses `typography.density`). The plan calls it once per scene and carries `kind` and `layout`;
  frame code never lays text out.
- **Fit rule**: text is wrapped, never truncated, shrunk or ellipsized. Text over a block's lines, a
  word longer than a line, or more list items than `maxItems` makes the spec unrenderable, and the
  error names the scene. The densities are sized so the fullest scene of each archetype stays inside
  the content frame: the safe area inset by `tokens.scenes.inset`, clear of the signature mark and a
  two-line subtitle.
- **Media**: an `image` asset with a `static:<path>` uri is served from `public/<path>`; any other
  uri is unrenderable in this format.
- **Motion**: blocks fade in one after another through the installed `Fade` primitive, from the
  first frame their scene is on screen; the pack's token transitions move whole scenes. Scenes read
  no frame, clock or randomness themselves, so a frame renders the same from any previous frame,
  and under reduced motion nothing moves.
- **Render budget**: each text block (`MoenarchTextBlock`) is memoized on plan data and renders once
  when its scene mounts; only the composition root (`MoenarchShortVideo`) and the fade wrappers
  render per frame. `e2e/moenarch-scene-budget.spec.ts` checks this for every long gallery scene.
- **Gallery**: `?project=moenarch-scene-gallery`
  (`src/spec/fixtures/moenarch-scene-gallery.videospec.json`) shows every archetype at a short and
  a long content size. DOM contract: each scene carries `data-moenarch-kind`, each text block is a
  `[data-moenarch-text="<role>"]` element, and the image is `img[data-moenarch-media]`.

## Latency explainer

`src/video/latency-video.tsx` renders one day of synthetic API traffic (200,000 requests from a
seeded generator) as 48 half-hour p95 bars. Clicking a bar shows that bucket's request count,
percentiles, and slowest requests; clicking a subtitle term shows a glossary entry.

## VideoSpec

`src/spec/video-spec.ts` defines `VideoSpec` v1, the versioned data contract for a video's semantic
intent: project identity, format pack id/version, output profile, ordered scenes with a duration,
narration cues, asset references, interaction terms and a per-kind semantic payload (v1 kinds:
`title`, `binnedChart` and the editorial archetypes `statement`, `mediaReveal`, `comparison`,
`quote`, `dataPoint`, `list`, `conclusion`; see the moenarch-short scene archetypes). The
archetype kinds are additive inside v1: v1 already rejects unknown kinds, so an older reader
refuses them instead of misreading them. Layout pixels, easing, typography and renderer details belong to the
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
