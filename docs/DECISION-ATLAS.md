# Interactive Videos — Decision Atlas

This is the canonical product-intent map for `interactive-videos`: **what viewers should be able to experience**, not an implementation checklist. The owner-approved direction was recorded in the free-form steering session of 2026-10-13 and the font-dependency follow-up decision of 2026-10-14. Existing implementation and closed issues are evidence of behavior, **not** substitutes for owner decisions.

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
  Answered by Decision 1.6; retained here for historical traceability.

- **1.6 Context-dependent playback during disclosure.**  
  Status: owner-approved 2026-10-13. **Answers 1.5 (option C).**  
  Small, non-modal popovers and accordion sections permit the video to **continue playing** while they are open; opening or closing them must not itself interrupt playback. Opening a **full modal dialog pauses** the video for deeper inspection, without losing the current position. Hover previews remain non-pausing under 1.3. Keep existing latency-example pause-to-inspect behavior for its established selection affordance; do not generalize it to all disclosures.

- **1.7** [question] **May viewer choices change the video timeline?**  
  Unresolved 2026-10-13: should interactivity (A) remain contextual disclosures on a fixed linear narrative; (B) additionally allow chapter jumps or seeking to linked segments, without conditional branches; or (C) support genuine branching paths whose subsequent content depends on viewer choices? All options must preserve an understandable uninterrupted watch-through per 1.1. Do not infer branching from the existing hotspot demos or council-source panels.
  Answered by Decision 1.8; retained for historical traceability.

- **1.8 Viewers can navigate chapters without branching the narrative.**  
  Status: owner-approved 2026-10-13. **Answers 1.7 (option B).**  
  In the interactive player, viewers can deliberately jump or seek to named chapters and related segments of a video, in addition to opening contextual details. These actions navigate a **single, fixed narrative timeline**: earlier choices do not condition which scenes exist, and no choose-your-own-adventure branch or alternate ending is implied. The viewer can still watch the complete video linearly without interacting (1.1); a deterministic rendered/exported video preserves that linear ordering.

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

- **3.5** [question] **Editorial perspective across Christian traditions.**  
  Unresolved 2026-10-13: should the seven-episode series adopt (A) an accessible, historically descriptive narrator with denominational differences explained where relevant; (B) an explicitly Catholic perspective, clearly identified, with other traditions' interpretations explained; or (C) a comparative presentation that systematically contrasts Catholic, Eastern Orthodox, Oriental Orthodox and other relevant Christian receptions? This changes scripting and historical review for all seven episodes; do not infer a confessional standpoint from illustrative Latin-text interaction ideas.
  Answered by Decision 3.6; retained for historical traceability.

- **3.6 Explicitly Catholic editorial perspective.**  
  Status: owner-approved 2026-10-13. **Answers 3.5 (option B).**  
  Narrate all seven council episodes from an explicitly **Catholic perspective**, making the standpoint clear to the viewer rather than implying a tradition-neutral or universally shared interpretation. Explain relevant Catholic doctrine and the councils' significance for Catholic Christianity while **fairly and accurately representing how other Christian traditions understand or receive the councils**. Distinguish contemporary council acts, later historical developments, and explicitly confessional interpretations; do not describe disputed Catholic understandings as consensus among all Christians. The two-to-three-minute narrative remains coherent without interactions; deeper source details and contrasting receptions may be explored in optional interactive context.

- **3.7** [question] **How should viewers move through the seven-council series?**  
  Unresolved 2026-10-13: should episodes (A) appear together in a dedicated series overview with manual previous/next navigation, (B) remain independently selectable from the existing project catalog without a special series flow, or (C) form a continuous playlist that automatically starts the next episode (while keeping individual episodes accessible)? This determines the default multi-episode viewer journey without changing the seven independent episodes or their short duration (3.1).
  Answered by Decision 3.8; retained for historical traceability.

- **3.8 Dedicated Seven Councils series overview with manual episode navigation.**  
  Status: owner-approved 2026-10-13. **Answers 3.7 (option A).**  
  Provide a dedicated, directly accessible series overview presenting all **seven councils in chronological order** (3.1), with clear entry points to available episodes. Each episode remains individually addressable and watchable on its own, and viewers can deliberately navigate **previous/next** episodes and return to the overview. **Do not automatically start the next episode** when the current one ends. Preserve the existing project catalog for other videos and the linear in-episode narrative; a series overview is a navigational experience, not a second video source or a branching storyline.

- **3.9** [question] **Which spoken and subtitle languages should the Seven Councils series initially offer?**  
  Unresolved 2026-10-13: should the release (A) use English narration with English subtitles, (B) use English narration with selectable English, German and Spanish subtitles, or (C) provide English, German and Spanish narration plus subtitles? Regardless of the choice, historical source excerpts must identify their original language and any translation (3.3). This changes episode production and player accessibility, so do not silently select a localization tier.
  Answered by Decision 3.10; retained for historical traceability.

- **3.10 English narration with selectable English, German and Spanish subtitles.**  
  Status: owner-approved 2026-10-13. **Answers 3.9 (option B).**  
  Each Seven Councils episode uses **English spoken narration** and makes **English, German and Spanish subtitle tracks selectable** in the interactive video player. Viewers can switch subtitle languages without losing their place in the episode; all tracks communicate the same narrated content while retaining accurate theological and historical terminology. Multi-language dubbed narration is **not** part of the initial series commitment. This Decision settles spoken/subtitle tracks, **not** the localization of all surrounding controls, contextual disclosures or source translations; source excerpts retain clear original-language/translation labeling under 3.3.

- **3.11** [question] **Localization of interactive historical context.**  
  Unresolved 2026-10-13: with selectable English, German and Spanish subtitles (3.10), should (A) only subtitles change language, while the series UI and source/person/map explanations remain English; (B) subtitles and player/series navigation labels be translated, but contextual historical explanations remain English; or (C) subtitles, series/navigation controls and interactive contextual explanations also be localized? Original historical-language quotations would remain identifiable as original text in all cases. This changes the usefulness of the interactive experience for German- and Spanish-speaking viewers; do not infer this scope from the subtitle decision alone.
  Answered by Decision 3.12; retained for historical traceability.

- **3.12 The selected language covers the full interactive series experience.**  
  Status: owner-approved 2026-10-13. **Answers 3.11 (option C).**  
  In the Seven Councils experience, selecting **English, German or Spanish** determines not only subtitles (3.10) but also the language of **series navigation, relevant player controls, contextual explanations of people and places, map descriptions, and historical source commentary**. Viewers should not have to read English-only explanatory panels after selecting German or Spanish. Keep the historical source's original-language quotations intact and explicitly labeled as originals; present their associated viewer-facing translations and explanations in the selected language, clearly distinguishing an original from a translation. Missing translations must not silently masquerade as translated content. This does **not** add German or Spanish narration (3.10), change the Catholic editorial perspective (3.6), or require unrelated non-series projects to adopt this language scope. Switching language should not lose the viewer's current playback position.

- **3.13** [question] **How deeply can viewers inspect historical source texts?**  
  Unresolved 2026-10-13: should selecting a referenced council text open (A) a short citation and summary card, (B) an annotated excerpt with original-language text, selected-language translation and attribution, or (C) a navigable in-app source reader that can inspect longer documents and passages? This determines the minimum scholarly depth and UI surface for the source interactions envisioned by 3.3; do not turn illustrative source links into a separate document platform without owner direction.
  Answered by Decision 3.14; retained for historical traceability.

- **3.14 Inspect annotated historical source excerpts within the video.**  
  Status: owner-approved 2026-10-13. **Answers 3.13 (option B).**  
  When a viewer activates a cited historical document in a Seven Councils episode, show a **relevant, bounded annotated passage** alongside its **original-language text where available**, a **translation in the viewer's selected English, German or Spanish language** (3.12), and clear **source attribution and historical explanation**. Identify the author/document, location within the source where known, translation provenance, and the relationship of the passage to the council's actual decisions or historical reception. Where only a translation or later witness survives, label it accurately instead of presenting it as an extant original. Original-language text remains visibly distinct from translations; disputed readings or later commentary must not be misrepresented as council acts. Viewers can close the inspection and return to their position in the video, consistent with the disclosure playback rules (1.6). **A full navigable in-app document reader is not part of this decision**; a link to the larger source is appropriate when available.

- **3.15** [question] **How should historical scenes be illustrated?**  
  Unresolved 2026-10-13: should the Seven Councils series (A) rely chiefly on surviving artworks, manuscripts, photographs of sites and maps; (B) also use clearly identified stylized illustrations or reconstructed scenes where documentary images are unavailable; or (C) use cinematic dramatized reenactments as a central visual mode? Whatever is selected, invented depictions must not be presented as documentary footage or contemporary evidence. This affects episode visual identity, asset production and the viewer's ability to distinguish history from illustration.
  Answered by Decision 3.16; retained for historical traceability.

- **3.16 Combine documentary visuals with clearly identified historical illustrations and reconstructions.**  
  Status: owner-approved 2026-10-13. **Answers 3.15 (option B).**  
  The Seven Councils episodes may combine surviving manuscripts, artworks, locations, maps and other attributable historical material with **stylized illustrations or reconstructed scenes** when documentary visuals are unavailable or insufficient. The viewer must be able to distinguish **historical evidence from modern interpretation or imagined reconstruction**; label illustrative and reconstructed depictions honestly, and do not portray them as contemporary documentation of an event or authentic likeness of a participant without evidence. Preserve provenance, source attribution and usage rights for documentary material and illustrations. Use this visual freedom to make the educational narrative clearer; **cinematic dramatized reenactments are not the defining style requirement**. This decision does not mandate a new generation provider, animation engine or a reconstruction for every episode.

- **3.17** [question] **How interactive should council-location maps be?**  
  Unresolved 2026-10-13: for places mentioned in the Seven Councils series, should viewers (A) inspect a simple labeled map inside a contextual panel, (B) explore a pannable/zoomable map with selectable council and participant-location pins and localized historical notes, or (C) navigate a historical time-aware map whose boundaries and relevant locations change across the councils' dates? The maps must support the historical explanation without disrupting the linear episode; do not choose a reusable map engine or invent historical border accuracy before the viewer experience is settled.
  Answered by Decision 3.18; retained for historical traceability.

- **3.18 Interactive historical maps with a time-aware timeline.**  
  Status: owner-approved 2026-10-13. **Answers 3.17 (combined options B and C).**  
  Council viewers can **pan and zoom** a map, **select councils, participants and relevant places** to inspect localized historical context, and **scrub a historical timeline** showing how supported locations and political/territorial boundaries change across the periods relevant to the seven councils (325–787). Both selectable locations **and** historically changing geography are required; the timeline must not merely animate unrelated decorative maps. Keep these overlays historically contextual rather than changing the video's linear narrative or forcing video playback to advance. Use the reusable `maps` Map View and Map-Scoped Timeline as the geographic interaction owner; `interactive-videos` owns the council episodes, historic people/place descriptions, localization and evidence-backed period datasets. Mark speculative or disputed historical boundary reconstructions as illustrative or uncertain rather than implying exact contemporary measurements. Source coverage and exact boundary interpretations remain subject to Question 3.19.

- **3.19** [question] **Council-era historical boundary evidence and uncertain periods.**  
  Unresolved 2026-10-13: what should the series display when scholarly geographic sources cannot establish a reliable political boundary for a particular council date? (A) show only source-backed dated boundaries and leave unsupported intervals without an asserted polygon; (B) also allow visibly marked approximate/reconstructed territorial extents, with evidence and uncertainty labels; or (C) omit political borders entirely for such periods and prioritize confidently located sites. Do not silently extrapolate the Maps demo's post-1816 CShapes boundaries into the fourth through eighth centuries.
  Answered by Decision 3.20; retained for historical traceability.

- **3.20 Approximate council-era boundaries are allowed when visibly qualified and sourced.**  
  Status: owner-approved 2026-10-13. **Answers 3.19 (option B).**  
  Historical maps in the Seven Councils series may show **scholarly approximate or reconstructed territorial extents** for periods in AD 325–787 even when no exact contemporary political boundary is established. Such regions must be **visibly distinguishable** from better-supported dated boundaries, with clear **approximate/reconstructed/uncertain labeling**, an identified relevant date or period, and inspectable **scholarly evidence, source attribution and limitations** in the viewer's selected English, German or Spanish language (3.12). Do not imply precise borders, fabricated confidence values or more historical consensus than the sources support. If there is no defensible basis for a reconstruction, show reliably located sites without fabricating a polygon. Source provenance and uncertainty travel with the time-aware data and remain legible under pan, zoom, selection and timeline changes (3.18). Reuse the `maps` Map View to present source/uncertainty distinctions; `interactive-videos` remains responsible for selecting and reviewing the historical datasets and their claims. This choice **does not decide** the separate Maps Question 1.2 about interpolation or display between dated source snapshots, and does not permit reusing its post-1816 CShapes demo as ancient evidence.


- **3.21** [question] **How should the Seven Councils episodes obtain their English spoken narration?**  
  Raised by the real Nicaea I pilot handoff in [issue #61](https://github.com/moritzbrantner/interactive-videos/issues/61) on 2026-10-15. Should production use (A) owner/human-recorded speech, (B) a locally generated voice from a pinned, suitably licensed open text-to-speech model, or (C) a cloud text-to-speech service requiring an external account/credentials? Decision 3.10 already fixes English narration with EN/DE/ES subtitles, but does not choose its producer.  
  Answered by Decision 3.22; retained for historical traceability.

- **3.22 Generate the initial Seven Councils narration using local open text-to-speech.**  
  Status: owner-approved 2026-10-15. **Answers 3.21 (option B).**  
  For the Nicaea I pilot and the initial seven-episode series, generate the **English spoken narration locally** using a suitable **open, redistributable and correctly licensed text-to-speech voice/model**, rather than requiring the owner to record every episode or relying on a cloud narration service or API key. Use the existing shared `asset-tooling` generation/artifact boundary for reusable narration assets, without creating a second video-specific model/runtime/cache system. Keep the chosen model/voice, license, input script and produced audio identifiable and reproducibly buildable where the provider permits; a precise voice/model is an implementation selection subject to real playback quality, intelligibility of historical and theological terms and asset-license review, **not** an owner-approved model yet. Make synthetic narration identifiable as such; human replacement for an individual episode may be considered later without changing the default initial pipeline. Narration must be real, comprehensible spoken audio in the published Nicaea I video, with accurate timing and complete aligned English, German and Spanish subtitle tracks under 3.10/3.12. Do not claim production, voice-quality acceptance or published episodes have already been achieved by this Decision.

- **3.23** [question] **Is a TTS model with Apache-2.0 weights but partly synthetic, closed-provider training data "correctly licensed" for the published series?**  
  Raised on 2026-10-16 during the concrete speech-adapter preflight for [asset-tooling#30](https://github.com/moritzbrantner/asset-tooling/issues/30). The best local candidate is Kokoro-82M (`hexgrad/Kokoro-82M`). Its weights and code are Apache-2.0, but its model card says the training data includes synthetic audio from closed commercial TTS providers. Options: (A) accept it; (B) require models whose training data is itself openly licensed; (C) use human-recorded narration instead.  
  Answered by Decision 3.24; retained for historical traceability.

- **3.24 Kokoro-82M is acceptable for the initial Seven Councils narration.**  
  Status: owner-approved 2026-10-16. **Answers 3.23 (option A).**  
  Under 3.22, the Apache-2.0 licensed Kokoro-82M model, pinned to an immutable revision, meets "correctly licensed" for the initial series narration. The upstream training-data provenance caveat must stay recorded with the narration's model/licence evidence. The specific voice remains an implementation selection by listening review; this Decision does not claim voice quality, pronunciation or a published episode.

## 4. Reusable video formats

- **4.1 Use bundled, freely licensed fonts for consistent video typography.**  
  Status: owner-approved 2026-10-14. **Answers 4.2 (bundled fonts).** Implementation: [issue #56](https://github.com/moritzbrantner/interactive-videos/issues/56).
  The `moenarch-short` format should use **freely available, redistributable typefaces obtained online and packaged with the project**, rather than depending on fonts installed on the viewer's or renderer's operating system. Load the exact packaged fonts in the browser and headless/Remotion renderer before measuring or rendering text; playback and rendering must not require a live external font service. The format retains its restrained editorial serif/sans presentation, but **the exact freely licensed font families are delegated to implementation**, subject to font-license compliance, needed character coverage, consistent visual output and accurate fitted-width bounds. Text planned to fit must actually fit on supported renderers; avoid lowering the format's intended text density solely to tolerate arbitrary system-font fallbacks.

- **4.2** [question] **How should the format guarantee consistent font widths across renderers?**
  Historical question from [issue #56](https://github.com/moritzbrantner/interactive-videos/issues/56), answered in the [owner comment of 2026-10-14](https://github.com/moritzbrantner/interactive-videos/issues/56#issuecomment-6166132880): should the format (A) bundle freely licensed display-serif and sans fonts, loaded before browser/headless rendering, or (B) retain system-font fallbacks and lower text densities to fit their worst-case widths? If bundling, should the owner select a particular display serif, such as Source Serif 4 or EB Garamond, or delegate the family choice?
  Answered by Decision 4.1: bundle redistributable fonts and delegate exact families to implementation. This historical Question is appended as 4.2 to preserve the permanent ID of the already recorded Decision 4.1.

## Evidence and related work

- Related reusable historical map policy: [Maps Atlas PR #230](https://github.com/moritzbrantner/maps/pull/230), Decisions **1.1** (dated selectable geography), **1.3** (sourced versus scholarly reconstructed boundaries), **1.4** (optional, explicitly hypothetical interpolation between dated source snapshots; **Answers Maps Question 1.2, B**) and **1.6** (**Answers Maps Question 1.5, A**: initial source snapshots, with interpolation enabled only through an explicit viewer action). **Maps Decision 1.8 answers Question 1.7 (B)**: for any opt-in historical interpolation, unchanged geographical land remains fixed while gained/lost territory changes, using [Maps issue #175](https://github.com/moritzbrantner/maps/issues/175). **Maps Decision 1.10 answers Question 1.9 (B)**: historical split/merge transitions animate only source-evidenced predecessor/successor relationships, with dated discrete changes otherwise. **Maps Decision 1.12 answers Question 1.11 (A)**: a consuming app displays one curated, sourced boundary while explaining credible alternative interpretations in attributed context rather than layering/comparing different borders. **Maps Decision 1.14 answers Question 1.13 (B)**: when a dated map feature stops applying, its active geographic selection clears but previously opened source-dated details remain visibly **out of period**, without automatic successor navigation. **Maps Decision 1.16 answers Question 1.15 (C)**: retained **out-of-period** details show an evidence-backed contextual **mini-timeline** whose supported-date choices explicitly navigate the **same Map-Scoped Timeline** and can reselect the original historically applicable feature, without affecting the video or automatically following successors. **Maps Decision 1.18 answers Question 1.17 (A)**: the map label uses a sourced historical name appropriate to the selected year, with its modern equivalent in inspectable details; the consuming episode supplies dated names and provenance. **Maps Decision 1.20 answers Question 1.19 (B)**: the primary map label uses an established period-appropriate historical name/transliteration in the viewer's selected language, while source-attested original-script and modern equivalents remain in inspection details; missing established names require disclosed fallback rather than fabricated history. The consuming council experience retains control of historical content and EN/DE/ES translations. These reusable controls do not supply ancient historical evidence or change the post-1816 CShapes demo policy.
- Existing Player and keyboard/hotspot behavior: [PR #50](https://github.com/moritzbrantner/interactive-videos/pull/50), `src/app.tsx`, `e2e/player-hotspot-navigation.spec.ts`.
- Existing multi-project, `VideoSpec`, and Remotion constraints: [issues #10](https://github.com/moritzbrantner/interactive-videos/issues/10), [#11](https://github.com/moritzbrantner/interactive-videos/issues/11), [roadmap #28](https://github.com/moritzbrantner/interactive-videos/issues/28), and [ADR 0001](adr/0001-videospec-v2-content-addressed-assets.md).
- Council identity and historical research starting points, **not pre-approved scripts**: [Orthodox Church in America overview](https://www.oca.org/orthodoxy/the-orthodox-faith/doctrine-scripture/sources-of-christian-doctrine/the-councils) and [the council-source collection at CCEL](https://ccel.org/ccel/schaff/npnf214.toc.html). Source provenance, translation accuracy, image rights and relevant historical disputes must be checked per episode.
