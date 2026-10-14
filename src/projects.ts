import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { titleCardFormat } from '@/formats/title-card';
import latencyExplainer from '@/spec/fixtures/latency-explainer.videospec.json';
import catalogTitleCard from '@/spec/fixtures/catalog-title-card.videospec.json';
import moenarchNarration from '@/spec/fixtures/moenarch-narration.videospec.json';
import moenarchSceneGallery from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';
import moenarchSpecimen from '@/spec/fixtures/moenarch-specimen.videospec.json';
import moenarchTypography from '@/spec/fixtures/moenarch-typography.videospec.json';
import { latencyFormat } from '@/video/latency-format';

// Project content lives in the specs; each entry names the format pack that renders it.
export const LATENCY_PROJECT_ID = 'latency-explainer';

export const catalog = createCatalog(
  [
    { spec: latencyExplainer, format: latencyFormat },
    { spec: catalogTitleCard, format: titleCardFormat },
    { spec: moenarchSpecimen, format: moenarchShort() },
    { spec: moenarchSceneGallery, format: moenarchShort() },
    { spec: moenarchNarration, format: moenarchShort() },
    { spec: moenarchTypography, format: moenarchShort() },
  ],
  // `/` without a project keeps opening the latency explainer.
  LATENCY_PROJECT_ID,
);
