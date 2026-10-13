# Interactive Videos — Decision Atlas

This is the canonical product-intent map for `interactive-videos`: **what viewers should be able to experience**, not an implementation checklist. The current owner-approved direction was stated in the free-form steering session of 2026-10-13. Existing implementation and closed issues are evidence of behavior, **not** substitutes for owner decisions.

## Editing rules

- The only semantic leaf kinds are **Decision** and **Question**. Headings organize capabilities; they are not a third kind.
- A Decision records owner-approved intent, whether implemented or not. A Question records a consequential open choice, which does not block unrelated work.
- IDs are permanent. Keep historical entries when intent changes: append a Decision explicitly marked `Supersedes <ID>`. Preserve an answered Question and append a Decision marked `Answers <ID>`.
- Keep product choices here, implementation details in code/tests, technical boundaries in `AGENTS.md` and the existing ADR, and execution/acceptance work in GitHub issues. Do not duplicate an issue queue here.
- A reader may watch any project without invoking interactive controls. An MP4 render cannot carry browser-only interactions; the in-browser interactive experience and deterministic linear rendering are distinct delivery surfaces.

## 1. Watching and exploring

- **1.1 Watch straight through or explore in context.**  
  Status: owner-approved 2026-10-13.  
  The same video should be understandable through uninterrupted playback and offer optional interactive exploration of material shown or discussed. Viewers should not have to leave the video to get contextual details. After inspecting a paused moment, they can return to their place in the video. The existing latency explainer is one example, not the limit of the product.

- **1.2 Space is a playback shortcut.**  
  Status: owner-approved 2026-10-13.  
  In the video-player context, pressing Space pauses or resumes the video. Existing Tab / Shift+Tab hotspot navigation and Enter / Space activation of a *focused interactive control* must remain usable; the playback shortcut must not hijack those controls or text inputs. Playback is controllable without a mouse.

- **1.3 A hover preview need not interrupt the video.**  
  Status: owner-approved 2026-10-13.  
  Interactive elements may react subtly to pointer hover, for example by enlarging or previewing information, **without pausing playback at hover time**. A corresponding discoverable interaction must exist for touch/keyboard users. Activating a deeper inspection remains a distinct action.

- **1.4 Rich contextual disclosure is part of the experience.**  
  Status: owner-approved 2026-10-13.  
  Demonstrate meaningful **popovers/pop-ups, dialogs/modals, and expandable accordion-like content**, rather than limiting every interaction to the present side-panel selection. These elements explain a point in the video and support return to the video; they must be operable using the supported input methods.

- **1.5** [question] **Playback while an expanded disclosure is open.**  
  Unresolved 2026-10-13: should a newly opened dialog or expanded contextual panel always pause (like the current click-to-inspect latency example), allow the video to continue, or vary by disclosure type? Hover itself must not pause under 1.3. Keep the current pause-to-inspect behavior until the owner chooses a broader rule; do not infer a new global rule from an example.

## 2. Live GitHub Pages showcase

- **2.1 Pages must demonstrate a range of real interactions.**  
  Status: owner-approved 2026-10-13.  
  The public example catalog should show what makes this an *interactive* video project, not mostly passive videos. More than the existing latency example must give viewers meaningful things to click or navigate. Showcase examples must operate in the real video player, not just display inert mock controls.

- **2.2 Examples are both experiences and demonstrations.**  
  Status: owner-approved 2026-10-13.  
  Show varied interactive patterns in coherent watchable content so visitors can judge both the content and the interaction. The Seven Councils series in section 3 is an intended showcase, not an unrelated documentation project.

## 3. The Seven Ecumenical Councils series

- **3.1 Seven short episodes, one per council.**  
  Status: owner-approved 2026-10-13.  
  Produce a series of **seven videos targeting roughly two to three minutes each**, in chronological order:
  1. Nicaea I (325)
  2. Constantinople I (381)
  3. Ephesus (431)
  4. Chalcedon (451)
  5. Constantinople II (553)
  6. Constantinople III (680–681)
  7. Nicaea II (787)

- **3.2 Each episode explains the event and its continuing significance.**  
  Status: owner-approved 2026-10-13.  
  Tell what important events occurred at that council; identify what was decided, clarified, or introduced; and explain consequences for Christianity today. Distinguish the council's historical acts from later interpretation and acknowledge differences among Christian traditions where relevant rather than treating reception as universal.

- **3.3 Explore historical context inside the episode.**  
  Status: owner-approved 2026-10-13.  
  Viewers should be able to inspect relevant primary/secondary sources, participants, locations and historical context from the video. Source excerpts (for example Latin alongside an understandable translation), people cards, place links and maps are **illustrative interaction ideas**, not mandatory widgets on every scene. When a source was originally Greek or another language, do not mislabel a Latin translation as the original.

- **3.4 The series should exercise the interactive medium.**  
  Status: owner-approved 2026-10-13.  
  Treat the series partly as a technical demonstration: use interaction creatively where it improves historical understanding. The core two-to-three-minute narrative must still work for someone who never opens a detail panel.

## Evidence and related work

- Existing Player and keyboard/hotspot behavior: [PR #50](https://github.com/moritzbrantner/interactive-videos/pull/50), `src/app.tsx`, `e2e/player-hotspot-navigation.spec.ts`.
- Existing multi-project, `VideoSpec`, and Remotion constraints: [issues #10](https://github.com/moritzbrantner/interactive-videos/issues/10), [#11](https://github.com/moritzbrantner/interactive-videos/issues/11), [roadmap #28](https://github.com/moritzbrantner/interactive-videos/issues/28), and [ADR 0001](adr/0001-videospec-v2-content-addressed-assets.md).
- Council identity and historical research starting points, **not pre-approved scripts**: [Orthodox Church in America overview](https://www.oca.org/orthodoxy/the-orthodox-faith/doctrine-scripture/sources-of-christian-doctrine/the-councils) and [the council-source collection at CCEL](https://ccel.org/ccel/schaff/npnf214.toc.html). Source provenance, translation accuracy, image rights and relevant historical disputes must be checked per episode.
