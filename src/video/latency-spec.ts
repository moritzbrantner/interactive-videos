import { BIN_COUNT, INCIDENT_WINDOW, REQUEST_COUNT } from '@/data/latency';
import fixture from '@/spec/fixtures/latency-explainer.videospec.json';
import { assertVideoSpec, resolveTimeline, type BinnedChartScene, type VideoSpec } from '@/spec/video-spec';

// The latency explainer's content (output profile, narration, glossary, chart intent) comes from
// its VideoSpec; layout, colors and the reveal stay in the video's own format code.
export const LATENCY_FORMAT = { id: 'interactive-chart-explainer', version: 1 } as const;
export const LATENCY_DATASET_URI = `generator:latency-requests?seed=20260928&count=${REQUEST_COUNT}`;

/**
 * The scene this format renders, or the reasons the spec asks for something it cannot render.
 * A valid VideoSpec can still target another format pack or choose a metric, bin count,
 * highlight or dataset this renderer does not draw; rendering it anyway would contradict the spec.
 */
export function latencyFormatScene(spec: VideoSpec): BinnedChartScene {
  const problems: string[] = [];
  if (spec.format.id !== LATENCY_FORMAT.id || spec.format.version !== LATENCY_FORMAT.version) {
    problems.push(
      `format ${spec.format.id} v${spec.format.version} is not ${LATENCY_FORMAT.id} v${LATENCY_FORMAT.version}`,
    );
  }
  const [scene] = spec.scenes;
  if (spec.scenes.length !== 1 || scene.kind !== 'binnedChart') {
    throw new Error(`${[...problems, 'this format renders exactly one binnedChart scene'].join('; ')}`);
  }
  const { payload } = scene;
  if (payload.metric !== 'p95') problems.push(`metric ${payload.metric} is not drawn (p95 only)`);
  if (payload.bins !== BIN_COUNT) problems.push(`bins ${payload.bins} is not ${BIN_COUNT}`);
  if (payload.highlight?.from !== INCIDENT_WINDOW[0] || payload.highlight?.to !== INCIDENT_WINDOW[1]) {
    problems.push('highlight must be the dataset incident window');
  }
  const dataset = spec.assets.find((asset) => asset.id === payload.dataset);
  if (dataset?.uri !== LATENCY_DATASET_URI) problems.push(`dataset must be ${LATENCY_DATASET_URI}`);
  if (problems.length) throw new Error(`the latency video cannot render this spec: ${problems.join('; ')}`);
  return scene;
}

export const latencySpec = assertVideoSpec(fixture);
export const latencyScene = latencyFormatScene(latencySpec);
export const latencyTimeline = resolveTimeline(latencySpec);
