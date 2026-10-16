import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { showcaseFormat } from '@/formats/showcase';
import { MOON_SHOWCASE_DISCLOSURES } from '@/formats/showcase/moon';
import { titleCardFormat } from '@/formats/title-card';
import latencyExplainer from '@/spec/fixtures/latency-explainer.videospec.json';
import catalogTitleCard from '@/spec/fixtures/catalog-title-card.videospec.json';
import councilNicaea325 from '@/spec/fixtures/council-nicaea-325.videospec.json';
import interactiveShowcase from '@/spec/fixtures/interactive-showcase.videospec.json';
import moenarchMaterializedAudio from '@/spec/fixtures/moenarch-materialized-audio.videospec.json';
import moenarchNarration from '@/spec/fixtures/moenarch-narration.videospec.json';
import moenarchSceneGallery from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';
import moenarchSpecimen from '@/spec/fixtures/moenarch-specimen.videospec.json';
import moenarchTypography from '@/spec/fixtures/moenarch-typography.videospec.json';
import nicaeaScript from '@/content/councils/nicaea-325/script.json';
import nicaeaSubtitlesDe from '@/content/councils/nicaea-325/subtitles/de.json';
import nicaeaSubtitlesEs from '@/content/councils/nicaea-325/subtitles/es.json';
import { latencyFormat } from '@/video/latency-format';

// Project content lives in the specs; each entry names the format pack that renders it.
export const LATENCY_PROJECT_ID = 'latency-explainer';

export const catalog = createCatalog(
  [
    { spec: latencyExplainer, format: latencyFormat },
    { spec: catalogTitleCard, format: titleCardFormat },
    { spec: moenarchSpecimen, format: moenarchShort() },
    { spec: moenarchSceneGallery, format: moenarchShort() },
    // #68: chapter jumps and a related-segment jump on one fixed timeline.
    { spec: moenarchNarration, format: moenarchShort(), chapters: true },
    { spec: moenarchTypography, format: moenarchShort() },
    // #60: the interactive disclosure showcase.
    { spec: interactiveShowcase, format: showcaseFormat(MOON_SHOWCASE_DISCLOSURES) },
    // #17: audio materialized through asset-tooling operations (sidecar
    // moenarch-materialized-audio.asset-requests.json), plus one local slot.
    { spec: moenarchMaterializedAudio, format: moenarchShort() },
    // #82: Seven Councils pilot, Nicaea I. Committed Kokoro narration (sidecar
    // council-nicaea-325.asset-requests.json, ADR 0002), selectable English subtitles, and
    // German and Spanish translations on the English cue timing (#84).
    {
      spec: councilNicaea325,
      format: moenarchShort(),
      subtitles: [
        { language: 'en', label: 'English' },
        { language: 'de', label: 'Deutsch', translation: nicaeaSubtitlesDe },
        { language: 'es', label: 'Español', translation: nicaeaSubtitlesEs },
      ],
      notes: [nicaeaScript.disclosure.syntheticNarration],
    },
  ],
  // `/` without a project keeps opening the latency explainer.
  LATENCY_PROJECT_ID,
);
