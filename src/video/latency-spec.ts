import fixture from '@/spec/fixtures/latency-explainer.videospec.json';
import { assertVideoSpec, resolveTimeline, type BinnedChartScene } from '@/spec/video-spec';

// The latency explainer's content (output profile, narration, glossary, chart intent) comes from
// its VideoSpec; layout, colors and the reveal stay in the video's own format code.
export const latencySpec = assertVideoSpec(fixture);

const [scene] = latencySpec.scenes;
if (latencySpec.scenes.length !== 1 || scene.kind !== 'binnedChart') {
  throw new Error('the latency explainer renders exactly one binnedChart scene');
}
export const latencyScene: BinnedChartScene = scene;

export const latencyTimeline = resolveTimeline(latencySpec);
