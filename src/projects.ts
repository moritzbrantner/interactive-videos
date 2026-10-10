import { createCatalog } from '@/catalog/catalog';
import { titleCardFormat } from '@/formats/title-card';
import latencyExplainer from '@/spec/fixtures/latency-explainer.videospec.json';
import catalogTitleCard from '@/spec/fixtures/catalog-title-card.videospec.json';
import { latencyFormat } from '@/video/latency-format';

// Project content lives in the specs; each entry names the format pack that renders it.
export const LATENCY_PROJECT_ID = 'latency-explainer';

export const catalog = createCatalog(
  [
    { spec: latencyExplainer, format: latencyFormat },
    { spec: catalogTitleCard, format: titleCardFormat },
  ],
  // `/` without a project keeps opening the latency explainer.
  LATENCY_PROJECT_ID,
);
