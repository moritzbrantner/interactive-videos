# Acceptance contract: VideoSpec v2 with content-addressed asset references (#16)

- Issue: [#16](https://github.com/moritzbrantner/interactive-videos/issues/16), owner decision **A** (2026-10-12)
- Architecture authority: [ADR 0001](../adr/0001-videospec-v2-content-addressed-assets.md) (commit `63dd2f7`)
- Shared contract mirrored: `AssetRef` v1 of `asset-tooling`, as mirrored by `remotion-primitives`
  `registry/default/lib/media-contracts.ts` (`normalizeAssetToolingAssetRef`, remotion-primitives `069801b`)
- Authored by an independent acceptance context before any implementation, against baseline `e1dbdf8`.

This document states the observable contract and maps every obligation to an executable test. It
adds no product decisions: where the ADR and the issue leave a consequential gap, the least-committal
routine reading is given and listed under **Open questions**.

## 1. Contract

### 1.1 VideoSpec v2 document

- `VIDEO_SPEC_VERSION` is `2`. A v2 document is the v1 document with one change: every
  `assets[]` entry is a **logical slot** `{ id, kind, asset }`.
  - `id`: the slot id scenes refer to (unchanged id rules); `kind`: one of the VideoSpec asset
    kinds (`dataset`, `image`, `audio`, `video`).
  - `asset`: the shared `AssetRef` v1, exactly
    `{ schemaVersion: 1, kind, mediaType, sha256, byteLength, metadata }`:
    `kind` a lowercase token, `mediaType` a lowercase concrete `type/subtype`, `sha256` a lowercase
    64-hex digest, `byteLength` a non-negative safe integer, `metadata` a JSON object.
    Any other field (`uri`, `url`, `src`, `path`, …) is an unknown-field diagnostic.
- **No v1 read path.** `specVersion: 1` is rejected with exactly one diagnostic at
  `$.specVersion` naming the rejected version and the supported version 2. A v1-shaped slot
  `{ id, kind, uri }` inside a v2 document is rejected (`uri` unknown, `asset` missing).
- **No `static:` URIs** in the durable contract: no slot carries a URI; no checked-in spec
  contains the text `static:`.
- **Compatibility checked by validation, without bytes.** A slot is incompatible, and the spec
  invalid with a diagnostic under `$.assets[i]`, when the AssetRef media type does not belong to
  the slot kind (`image` → `image/*`, `audio` → `audio/*`, `video` → `video/*`, `dataset` → not
  `image/*`/`audio/*`/`video/*`) or the AssetRef `kind` is another VideoSpec media kind than the
  slot's (e.g. an `audio` AssetRef in an `image` slot). Scene references keep their v1 checks
  (unknown slot, wrong slot kind).
- `parseVideoSpec` and the catalog never read asset bytes: a spec whose digest exists nowhere, or
  whose `byteLength` is 50 GB, validates; `src/spec/video-spec.ts` and `src/catalog/catalog.ts`
  import no filesystem, crypto or network module.
- Normalization: slots sorted by id, keys in contract order
  (`id, kind, asset{schemaVersion, kind, mediaType, sha256, byteLength, metadata}`); every
  checked-in fixture is byte-identical to `serializeVideoSpec` of itself.

### 1.2 Migrated fixtures

Every `src/spec/fixtures/*.videospec.json` (all seven: latency explainer, catalog title card,
Moenarch specimen, scene gallery, narration, typography, interactive showcase) is a valid v2
spec, still registered in the catalog, and resolves there. The migrated slots keep the exact
current bytes:

| project | slot kind | sha256 | bytes |
| --- | --- | --- | --- |
| moenarch-scene-gallery | image (`image/png`) | `911676716eeb55fe80291105c9b9db31a4888aa557ec9cffd517d6a4fe959220` | 1482 |
| moenarch-narration | audio (WAV) | `7fcbe09842d61da37fbc92be7a47dabc0408b44a2342341ecf655174791d0ed9` (`narrationWav(2450, 220)`) | 19644 |
| moenarch-narration | audio (WAV) | `8d15a8a53ba7c4a2573d61231936212d9f1275a4f85986b95f5d9a632624d171` (`narrationWav(3000, 330)`) | 24044 |
| latency-explainer | dataset | see Open question 1 | |

### 1.3 Content-addressed store (`src/assets/asset-store.ts`)

- The store is a git-ignored directory, by default `.asset-store/` at the repository root
  (`DEFAULT_ASSET_STORE`, absolute). An object lives at `<store>/sha256/<sha256>`
  (`assetObjectPath(store, sha256)`), keyed by digest only: no project, slot or file name.
  `assetObjectPath` refuses anything that is not a lowercase 64-hex digest.
- `importAssetBytes(store, bytes)` → `{ sha256, byteLength }` writes the object once; importing
  the same bytes again leaves exactly one identical object.
- `importSourceAssets(store)` deterministically imports the checked-in (or deterministically
  generated) source assets of every catalog project, so a clean checkout (CI, Pages) can populate
  an empty store with no network. Afterwards every slot of every catalog spec has its object with
  matching digest and length. (Routine name/shape; see Open question 2.)

Each function may be sync or async; tests `await` them.

### 1.4 Render job resolution (`src/render/render-job.ts`)

- `RenderEnvironment` names the store: `{ catalog, cwd, assetStore }`.
- `resolveRenderJob` resolves every slot of the selected spec, **before bundling**, to an
  immutable runtime input; `job.assets` (and the render result's `assets`) is, in normalized slot
  order, exactly `{ id, kind, src, sha256, byteLength, mediaType }` with the AssetRef's identity,
  and a `src` that contains the digest and is not a `static:` URI. Nothing in a job contains
  `static:`.
- Failures, all before bundling, with the slot id in the message:
  - object absent → `missing-asset` (message also names the digest);
  - object bytes whose digest or length differ from the AssetRef → `asset-mismatch`;
  - incompatible media type/kind → the spec is invalid (`invalid-spec` for a spec path; the
    catalog refuses it at construction).
- Two projects naming one digest resolve to the same `src` and share one store object.

### 1.5 Player (Pages) and headless render

- The Pages app keeps playing every project. In the browser the scene-gallery image and the
  narration audio load from same-origin URLs that contain the slot digest, and the fetched bytes
  hash to the slot `sha256` with `byteLength` bytes. No request URL contains `static:`.
- The Pages artifact (`dist/`, built by `bun run build`, the Pages workflow's only build step)
  contains the bytes of every catalog asset slot.
- `bun run video:render` renders frames of the scene gallery (image) and the narration project
  (audio) headlessly, reporting resolved assets.

## 2. Obligation → evidence

| # | Obligation (source) | Evidence |
| --- | --- | --- |
| O1 | v2 slots backed by AssetRef v1 (decision A, ADR) | `src/spec/video-spec-v2-assets.test.ts` › *AssetRef slot shape* |
| O2 | No v1 read path; clear diagnostic (A, ADR) | › *rejects VideoSpec v1 …*, *rejects a v1 uri slot …* |
| O3 | Kind/media-type compatibility checked by validation (issue proposal, ADR) | › *media-type compatibility* tests; `asset-resolution.test.ts` › *incompatible media type …* |
| O4 | Validation without reading bytes (issue acceptance, ADR) | › *validates without bytes*, *pure modules*; `asset-resolution.test.ts` › *catalog resolves without the store* |
| O5 | No `static:` URIs (A) | › *no static: in any checked-in spec*; asset-resolution *job contains no static:*; e2e *no static: request* |
| O6 | All current fixtures migrated (A, issue comment 2026-10-15) | › *every fixture is a canonical v2 spec*, *migrated slots keep their bytes* |
| O7 | Shared git-ignored SHA-256 store (A, ADR) | asset-resolution › *store layout*, *import is idempotent*, *store is git-ignored* |
| O8 | Resolve to immutable `{src, sha256, byteLength, mediaType}` before bundling (A, ADR) | asset-resolution › *resolves every renderable catalog project*; `render-result.test-support.ts` asset shape |
| O9 | Missing / mismatched / incompatible fail early, structured (issue acceptance, ADR) | asset-resolution › *missing-asset*, *asset-mismatch* (bytes, length), *incompatible* |
| O10 | Two projects reuse one asset (issue acceptance, ADR) | asset-resolution › *two projects share one object*; spec test › *two specs name one digest* |
| O11 | Renderer gets resolved inputs, not acquisition requests (issue acceptance) | O8 tests + e2e content-addressed `src`; existing `render.architecture.test.ts` (no network/LLM in render path) |
| O12 | Existing projects still play in Pages | all existing e2e specs (gate) + `e2e/videospec-v2-assets.spec.ts` |
| O13 | Pages build works with no pre-existing store | `e2e/videospec-v2-assets.spec.ts` › *Pages artifact contains every asset*; asset-resolution › *importSourceAssets populates an empty store*; CI (clean checkout) |
| O14 | Existing projects still render headlessly | `src/render/assets.smoke.test.ts` + existing `render.smoke.test.ts` |
| O15 | Image, audio, video, 3D inputs "needed by current scenes" (issue scope) | Current scenes need image, audio, dataset only; video/mesh have no scene consumer — covered only by the kind/mediaType rules (gap, see OQ 4) |
| O16 | Acquisition/cache policy outside the React renderer (issue scope, ADR) | existing `render.architecture.test.ts`; review: format packs/components receive only resolved inputs |

## 3. Tests and commands

New:
- `src/spec/video-spec-v2-assets.test.ts` (unit; imports only existing modules)
- `src/render/asset-resolution.test.ts` (unit; imports the new `@/assets/asset-store`)
- `src/render/assets.smoke.test.ts` (render smoke, `bun run test:render`)
- `e2e/videospec-v2-assets.spec.ts` (Playwright, `bun run test:budget`; its Pages-artifact test
  reads `dist/`, so it needs `bun run build` first — `bun run verify` does that)

Changed (v1-specific expectations translated by this acceptance context):
- `src/render/render-result.test-support.ts`: result assets are the resolved inputs; reason
  `asset-mismatch` added.
- `src/render/render-job.test.ts`: the two v1 `static:`/`publicDir` asset tests are superseded by
  `asset-resolution.test.ts`; the environment also names a store populated by
  `importSourceAssets`; a literal `specVersion: 1` now uses the spec's own version.
- `e2e/moenarch-narration.spec.ts`, `e2e/moenarch-scene-gallery.spec.ts`: audio/image are
  identified by the slot digest in their URL instead of the `static:` public path; every other
  assertion unchanged.

Pre-authorized translations for the implementer (v1-only expectations whose v2 meaning is fixed
here; any other change to these files needs independent re-verification):
- `src/formats/moenarch-short/static-path.review.test.ts` and the "refuses media/audio whose uri
  this format cannot serve" cases in `scene-archetypes.test.ts` / `narration.test.ts`: there are
  no URIs in v2; replace with "an image/audio slot whose media type the format cannot play is
  unrenderable or invalid", or delete when §1.1 validation already covers it.
- `scene-archetypes.test.ts` line ~125 and `narration.test.ts` lines ~70–80: compare the slot
  AssetRef identity with the table in §1.2 (the WAV bytes must still equal `narrationWav(...)`).
- Layout/plan internals that expose `staticPath` (`scene-archetypes.test.ts` ~225, e2e `Layout`
  type) may be renamed to the resolved `src`; the e2e assertions in this PR do not depend on it
  beyond `layout.media.assetId`.
- v1 asset literals in `video-spec.test.ts` (~52/56), `narration-timing.test.ts` (~185) and
  `scene-archetypes.test.ts` (~338) become v2 slots of the same kind.
- `video-spec.test.ts` latency dataset `uri` assertions (~387, ~402): depend on Open question 1.
- Environment plumbing (`publicDir` → `assetStore`) in `fonts.smoke.test.ts` and the CLI is
  non-semantic.

Commands (each wrapped in `flock` locally because memory is tight):

```sh
bunx vitest run --maxWorkers=2 src/spec/video-spec-v2-assets.test.ts src/render/asset-resolution.test.ts src/render/render-job.test.ts
bunx vitest run --config vitest.render.config.ts src/render/assets.smoke.test.ts
bun run build && bunx playwright test --workers=1 e2e/videospec-v2-assets.spec.ts e2e/moenarch-narration.spec.ts e2e/moenarch-scene-gallery.spec.ts
bun run verify   # merge gate: full applicable suite
```

## 4. Open questions (not decided here)

1. **Latency explainer dataset.** Its slot is today `generator:latency-requests?seed=…&count=200000`,
   a procedural dataset with no bytes. ADR 0001 makes every `assets[]` entry an AssetRef, so the
   routine reading is: materialize the deterministic generator output once (canonical
   serialization), reference it by digest with the generator parameters in `metadata`, and import
   it into the store like any source asset. The tests require only that the slot is a valid
   `dataset` AssetRef whose bytes `importSourceAssets` provides. Whether the browser keeps
   generating in code or fetches the bytes, and whether a generator-backed dataset should be a
   slot at all, is an owner-level question if the routine reading is unacceptable.
2. **How CI/Pages populate the store.** The ADR says checked-in source assets *may* be imported
   but not when. Routine reading: a deterministic, network-free import (`importSourceAssets`) runs
   before anything needs bytes (unit tests that need it call it on a temporary store; the build
   and the render CLI must not depend on a developer's pre-filled store), and the Pages build
   publishes the referenced objects. Where the checked-in source files live (`public/fixtures/`
   today) and the exact script wiring are implementation choices.
3. **Render result schema version.** The result's `assets` entries change shape; whether
   `schemaVersion` stays `1` or becomes `2` is not specified. The tests do not pin it beyond the
   existing title-card expectation (`1`); bumping it requires re-verification of that line.
4. **Video and 3D/mesh slots.** No current scene consumes video or mesh inputs, so there is no
   observable behaviour to test beyond the media-type rules; a mesh slot kind is not added here.
5. **Relation to asset-tooling's store** (`.asset-tooling/objects/v1/sha256/<2>/<sha256>`). This
   contract follows the approved #16 proposal (`.asset-store/sha256/<sha256>`); converging the two
   layouts belongs to #17.
