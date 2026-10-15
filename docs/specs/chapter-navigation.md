# Chapter jumps and related-segment navigation (#68)

Independent acceptance contract, authored before the implementation by a separate acceptance
context. Executable form: `e2e/chapter-navigation.spec.ts`.

## Authority

- `docs/DECISION-ATLAS.md` at `2eeb4c2`: **1.1** (watch straight through or explore in context;
  return to one's place), **1.2** (Space is a playback shortcut; focused controls keep Enter/Space),
  **1.6** (only full modal dialogs pause), **1.8** (Answers 1.7, option B: chapter jumps and
  related-segment seeks on a single fixed narrative timeline; exported video stays linear).
- `AGENTS.md`: browser-only interaction lives at the interactive Player boundary; deterministic
  headless frames stay renderable without UI state; prove viewer-facing work in the Pages build
  with pointer and keyboard; preserve the latency explainer and its interaction tests.
- Issue #68 (scope, independent acceptance section).

## Demonstration subject

`?project=moenarch-narration` (`src/spec/fixtures/moenarch-narration.videospec.json`). Its
validated scene timeline, `resolveTimeline(assertVideoSpec(spec))` at the baseline, is:

| scene id | kind         | from | frames | headline (from the payload)            |
|----------|--------------|------|--------|-----------------------------------------|
| `hook`   | `title`      | 0    | 102    | `heading`: "Voice sets the pace"        |
| `point`  | `statement`  | 102  | 117    | `text`: "Silence is part of the script." |
| `close`  | `conclusion` | 219  | 90     | `heading`: "Explicit scenes keep their length." |

Total 309 frames at 30 fps. The tests recompute these values from the fixture at run time; the
table is illustrative. "Opening" = `hook`, "silence" = `point`, "conclusion" = `close`.

## Observable contract

### C1 Chapter list (UI contract)

- A landmark `nav` with accessible name **"Chapters"** (`getByRole('navigation', { name: 'Chapters' })`)
  is shown for a chaptered project, outside the composition DOM (`[data-moenarch-root]` never
  contains it) — it is Player-boundary UI, not part of rendered frames.
- It contains exactly one chapter control per chapter, in timeline order. Each chapter control:
  - is a native `<button>` (role `button`), operable by click, tap, Enter and Space;
  - carries `data-chapter-id="<scene id>"` and `data-chapter-from="<start frame>"`, where the
    start frame equals the scene's `from` in `resolveTimeline` of the validated spec;
  - has an accessible name that **contains the scene's headline text** (title/conclusion
    `payload.heading`, statement `payload.text`); names are distinct. Additional text (e.g. a
    number or timestamp) is allowed.
- Chapters must come from the project's validated scene timeline (catalog/`VideoSpec`), not from a
  second hard-coded frame array. The browser test can only detect drift for the current fixture;
  the absence of a parallel array is an **independent review item** (see Gaps).

### C2 Current chapter

- Exactly one chapter control has `aria-current="true"` (any value other than absent/`"false"`
  counts, but `"true"` is recommended): the chapter whose `[from, from + frames)` contains the
  Player's current frame. All others have no `aria-current` (or `"false"`).
- It updates during linear playback (no interaction) and after every jump.

### C3 Related-segment jump

- While the opening chapter (`hook`) is current, a visible control with
  `data-related-segment` and `data-chapter-target="close"` is offered, role `button` or `link`,
  with an accessible name containing the conclusion's headline text. It is outside
  `[data-moenarch-root]`.
- Activating it (click, tap, Enter) seeks to the conclusion's start frame. If it is a link it must
  not change the URL's `project` parameter or reload the page.
- Whether related-segment links exist in other chapters is an implementation choice.

### C4 Seeking semantics

Activating a chapter or related-segment control:

- lands on **exactly** the target's start frame when paused (and at or just after it when
  playing); never on frame 0 unless the target starts at 0, and never restarts the video;
- keeps the same composition (`[data-composition-id="moenarch-narration"]`, same
  `data-duration-in-frames`) and the same `?project=` URL;
- **keeps the current play state** (decision below): paused stays paused on the start frame;
  playing continues playing from the start frame;
- shows the same frame content linear playback shows at that frame: mounted
  `[data-moenarch-scene]` ids, `[data-moenarch-subtitle]` text and `[data-moenarch-mark]` equal
  `moenarchFrameState(planMoenarchShort(spec), frame)` — narration/subtitles reflect the new frame
  and no conditional or alternate content appears;
- repeated and out-of-order jumps (forward, backward, same chapter twice) always land on the
  target start frame and render identical DOM for the same frame.

**Play-state decision (routine, derived from established principles):** keep the current play
state. 1.8 frames chapter jumps as *navigation* of the timeline, not inspection; 1.6 reserves
pausing for full modal dialogs; 1.1 lets a viewer return to and continue watching; and it matches
how scrubbing the existing Player seek bar behaves. A jump therefore neither pauses nor starts
playback.

### C5 Input methods

- Pointer click, touch tap, and keyboard: chapter and related controls are reachable with Tab and
  activate with Enter and Space. Space on a focused chapter control activates that control and
  does **not** toggle playback (1.2). After a jump, Space on the focused `Video player` region
  still plays/pauses from the new position.

### C6 Projects without meaningful chapters

- A single-scene project shows no chapter navigation: no `Chapters` navigation, no
  `[data-chapter-id]`, no `[data-related-segment]`. Checked on **`latency-explainer`** (the
  default project and home of the hotspot interaction tests; one `binnedChart` scene, so a chapter
  list would be fake navigation) and `catalog-title-card` (one title scene). Switching from
  `moenarch-narration` to such a project through the project nav removes the controls.
- Other multi-scene projects (`interactive-showcase`, `moenarch-specimen`, the gallery,
  typography) may or may not get chapters; this contract does not decide it (open question).

### C7 Non-regression

- Latency hotspot navigation: `e2e/player-hotspot-navigation.spec.ts` stays green.
- Showcase disclosures: `e2e/interactive-showcase.spec.ts` stays green.
- Narration timing: `e2e/moenarch-narration.spec.ts` stays green (duration 309, cue frames).
- Deterministic headless render: `bun run test:render` stays green; chapter UI never appears in
  composition DOM (C1/C3) and the timeline length is unchanged (C4).

## Acceptance cases

| Obligation (#68 / this spec) | Test in `e2e/chapter-navigation.spec.ts` |
|---|---|
| Chapter list, accessible names from the timeline, order, start frames, outside composition | `lists the scene timeline as named chapters outside the composition` |
| Current chapter recognizable during linear watch-through | `marks the current chapter while the video plays linearly` |
| Click jump opening → silence, paused, content/subtitles at the new frame | `clicking a chapter while paused seeks to its start frame and stays paused` |
| Related-segment jump opening → conclusion | `the opening offers a related-segment jump to the conclusion` |
| Jump while playing keeps playing; narration/subtitles reflect new frame | `jumping while playing keeps playing from the chapter start` |
| Keyboard-only journey, Space not hijacked, Space playback after jump | `keyboard only: Tab, Enter and Space jump between chapters and segments` |
| Touch tap | `touch: tapping chapters and the related segment seeks` |
| Repeated / out-of-order seeks, no alternate content | `repeated and out-of-order jumps land on the same frames with the same content` |
| No controls for non-chaptered projects | `projects without meaningful chapters show no chapter controls` |
| Latency hotspots / showcase / narration timing / headless render | existing specs + `bun run test:render` (C7) |

## Gaps (not automated here)

- **No parallel frame array:** a browser test cannot prove chapters are *derived* rather than
  copied. Independent review of the implementation diff must confirm chapter data flows from the
  catalog's validated `VideoSpec`/`resolveTimeline`.
- **Headless render of `moenarch-narration`** is not rendered by the existing render smoke test
  (it renders `catalog-title-card` and `interactive-showcase`). The implementation must not touch
  `src/render/**` or composition components for this feature; reviewed by diff.
- **Screenshot/video evidence** of the Pages journey is attached to the implementation PR by hand.
- **Published Pages route** is verified only after merge.

## Open questions

1. **Chapter title source.** This contract derives names from each scene's headline payload. If the
   owner prefers editorial chapter titles authored in `VideoSpec`, that is a spec-schema change
   (v1 fails closed on unknown fields) and the name expectations here need independent
   re-verification.
2. **Where related-segment relations are authored** (spec data vs format pack). Routine as long as
   they reference scene ids of the validated timeline; a `VideoSpec` schema addition may warrant
   owner review.
3. **Other multi-scene projects** (showcase, specimen, gallery, typography): chapters or not.
4. **Chapter start point** is the scene's `from` in the timeline (the middle of the incoming
   transition in moenarch-short), not the transition's start. Owner may prefer the transition
   start for a cleaner visual entry; the tests would then need re-verification.
