import { describe, expect, it } from 'vitest';

import {
  BIN_COUNT,
  generateRequests,
  INCIDENT_WINDOW,
  latencyBins,
  REQUEST_COUNT,
  slowestRequests,
} from './latency';

describe('latency dataset', () => {
  it('is reproducible for a seed', () => {
    expect(generateRequests(500, 7)).toEqual(generateRequests(500, 7));
    expect(generateRequests(500, 7)).not.toEqual(generateRequests(500, 8));
  });

  it('bins every request into the fixed number of buckets', () => {
    expect(latencyBins).toHaveLength(BIN_COUNT);
    expect(latencyBins.reduce((sum, bin) => sum + bin.pointCount, 0)).toBe(REQUEST_COUNT);
  });

  it('shows the incident as a heavier p95 tail', () => {
    const incident = latencyBins.filter(
      (bin) => bin.x0 >= INCIDENT_WINDOW[0] && bin.x1 <= INCIDENT_WINDOW[1],
    );
    const quiet = latencyBins.filter((bin) => bin.x1 <= INCIDENT_WINDOW[0] - 3600);
    const maxQuiet = Math.max(...quiet.map((bin) => bin.p95 ?? 0));
    expect(incident.length).toBeGreaterThan(0);
    for (const bin of incident) expect(bin.p95 ?? 0).toBeGreaterThan(maxQuiet * 2);
  });

  it('returns the slowest requests inside a bucket, sorted', () => {
    const bin = latencyBins[29];
    const rows = slowestRequests(bin, 5);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.x).toBeGreaterThanOrEqual(bin.x0);
      expect(row.x).toBeLessThan(bin.x1);
    }
    expect(rows.map((row) => row.y)).toEqual([...rows.map((row) => row.y)].sort((a, b) => b - a));
  });
});
