// The latency explainer's dataset is procedural: the browser generates its requests in code. Its
// content-addressed asset is the canonical recipe that determines those requests, so the slot has
// a stable byte identity without shipping the 200,000 generated rows (VideoSpec v2, ADR 0001).
// Pure module: no imports, so build tooling can use it.

export const LATENCY_DATASET_RECIPE = { count: 200_000, generator: 'latency-requests', seed: 20260928 } as const;
export const LATENCY_DATASET_MEDIA_TYPE = 'application/json';

/** Canonical bytes of the recipe: keys sorted, no whitespace. */
export function latencyDatasetBytes(): Uint8Array {
  const { count, generator, seed } = LATENCY_DATASET_RECIPE;
  return new TextEncoder().encode(JSON.stringify({ count, generator, seed }));
}
