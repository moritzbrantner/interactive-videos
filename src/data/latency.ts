import { createChartDensityIndex } from '@moritzbrantner/charts/density';

export type RequestProperties = {
  route: string;
  status: number;
};

export const DAY_SECONDS = 24 * 60 * 60;
export const REQUEST_COUNT = 200_000;
export const BIN_COUNT = 48;
export const INCIDENT_WINDOW: [number, number] = [14 * 3600, 15.5 * 3600];

const routes = ['/api/search', '/api/checkout', '/api/profile', '/api/feed'];

// Seeded PRNG so the dataset, and therefore every video frame, is reproducible.
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trafficShape(seconds: number) {
  const hour = seconds / 3600;
  return 0.25 + 0.75 * Math.exp(-((hour - 13) ** 2) / 18);
}

export function generateRequests(count = REQUEST_COUNT, seed = 20260928) {
  const random = mulberry32(seed);
  const points = [];
  while (points.length < count) {
    const x = random() * DAY_SECONDS;
    if (random() > trafficShape(x)) continue;
    const incident = x >= INCIDENT_WINDOW[0] && x < INCIDENT_WINDOW[1];
    const base = 60 + 40 * trafficShape(x);
    const tail = -Math.log(1 - random()) * (incident ? 420 : 55);
    const status = incident && random() < 0.08 ? 503 : random() < 0.004 ? 500 : 200;
    points.push({
      id: `req-${points.length}`,
      x,
      y: Math.round(base + tail),
      properties: { route: routes[Math.floor(random() * routes.length)], status },
    });
  }
  return points;
}

// Frame-independent work happens once, at module load: generation, indexing, binning.
// "hybrid-js" keeps indexing synchronous and deterministic; the default progressive backend
// warms up asynchronously, which would make early frames differ from later ones.
export const requestIndex = createChartDensityIndex<RequestProperties>(generateRequests(), {
  backend: 'hybrid-js',
});

export const latencySeries = requestIndex.getChartSeries({
  targetBinCount: BIN_COUNT,
  xDomain: [0, DAY_SECONDS],
  includeEmptyBins: true,
  percentiles: ['p50', 'p95', 'p99'],
});

export type LatencyBin = (typeof latencySeries.samples)[number];

export const latencyBins: LatencyBin[] = latencySeries.samples;

export const maxP95 = Math.max(...latencyBins.map((bin) => bin.p95 ?? 0));

export function slowestRequests(bin: Pick<LatencyBin, 'x0' | 'x1'>, limit = 8) {
  return requestIndex
    .getChartPoints({ xDomain: [bin.x0, bin.x1] })
    .points.filter((point) => point.x >= bin.x0 && point.x < bin.x1)
    .sort((a, b) => b.y - a.y)
    .slice(0, limit);
}

export function formatClock(seconds: number) {
  const total = Math.round(seconds / 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
