import type { FormatPack } from '@/catalog/catalog';
import { serializeVideoSpec } from '@/spec/video-spec';
import { LatencyInsight } from '@/video/latency-insight';
import { LATENCY_FORMAT, latencyFormatScene, latencySpec } from '@/video/latency-spec';
import { LatencyVideo } from '@/video/latency-video';

/**
 * The interactive chart explainer format. Its chart is computed once at module load from the
 * bundled latency dataset, so it renders exactly the bundled latency spec: any other spec is
 * either outside what the format draws (latencyFormatScene) or content it would not show.
 */
export const latencyFormat: FormatPack = {
  ...LATENCY_FORMAT,
  compose(spec) {
    latencyFormatScene(spec);
    if (serializeVideoSpec(spec) !== serializeVideoSpec(latencySpec)) {
      throw new Error('the latency video renders only the bundled latency explainer spec');
    }
    return {
      component: LatencyVideo,
      renderInsight: (activation) => <LatencyInsight activation={activation} />,
    };
  },
};
