import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BIN_COUNT, INCIDENT_WINDOW, REQUEST_COUNT } from '@/data/latency';
import { latencyScene, latencySpec } from '@/video/latency-spec';
import {
  narrationToSrt,
  parseVideoSpec,
  parseVideoSpecJson,
  resolveTimeline,
  serializeVideoSpec,
  type VideoSpec,
} from './video-spec';

const fixturePath = new URL('./fixtures/latency-explainer.videospec.json', import.meta.url);
const fixtureText = readFileSync(fixturePath, 'utf8');

function fixture(): Record<string, any> {
  return JSON.parse(fixtureText);
}

function diagnosticsOf(input: unknown) {
  const result = parseVideoSpec(input);
  if (result.ok) throw new Error('expected the spec to be rejected');
  return result.diagnostics;
}

/** Reverses key order at every level, so equality cannot depend on input key order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedKeys(entry)]),
  );
}

describe('VideoSpec v1', () => {
  it('round-trips the checked-in fixture byte for byte', () => {
    const result = parseVideoSpecJson(fixtureText);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(serializeVideoSpec(result.spec)).toBe(fixtureText);
    const again = parseVideoSpecJson(serializeVideoSpec(result.spec));
    expect(again.ok && serializeVideoSpec(again.spec)).toBe(fixtureText);
  });

  it('normalizes identical specs to identical project data regardless of key or asset order', () => {
    const shuffled = reversedKeys(fixture()) as Record<string, any>;
    shuffled.assets = [
      { uri: 'file:poster.png', kind: 'image', id: 'poster' },
      ...shuffled.assets,
    ];
    const withPoster = fixture();
    withPoster.assets.push({ id: 'poster', kind: 'image', uri: 'file:poster.png' });

    const a = parseVideoSpec(shuffled);
    const b = parseVideoSpec(withPoster);
    if (!a.ok || !b.ok) throw new Error('expected both specs to parse');
    expect(a.spec).toEqual(b.spec);
    expect(serializeVideoSpec(a.spec)).toBe(serializeVideoSpec(b.spec));
    expect(a.spec.assets.map((asset) => asset.id)).toEqual(['latency-requests', 'poster']);
  });

  it('fails closed on unknown fields, scene kinds and versions with useful paths', () => {
    const unknownField = fixture();
    unknownField.scenes[0].payload.easing = 'easeInOut';
    unknownField.renderer = 'remotion';
    expect(diagnosticsOf(unknownField)).toEqual([
      { path: '$.renderer', message: expect.stringContaining('unknown field') },
      { path: '$.scenes[0].payload.easing', message: expect.stringContaining('unknown field') },
    ]);

    const unknownKind = fixture();
    unknownKind.scenes[0].kind = 'flatStoriesCharacter';
    expect(diagnosticsOf(unknownKind)).toEqual([
      {
        path: '$.scenes[0].kind',
        message: 'unknown scene kind "flatStoriesCharacter"; v1 supports title, binnedChart',
      },
    ]);

    const future = fixture();
    future.specVersion = 2;
    expect(diagnosticsOf(future)).toEqual([
      { path: '$.specVersion', message: 'unsupported specVersion 2; this build reads 1' },
    ]);

    expect(parseVideoSpecJson('{ "specVersion": 1,')).toMatchObject({
      ok: false,
      diagnostics: [{ path: '$', message: expect.stringContaining('invalid JSON') }],
    });
  });

  it('reports semantic errors: references, timing, duplicates and narration terms', () => {
    const broken = fixture();
    const scene = broken.scenes[0];
    scene.payload.dataset = 'missing-data';
    scene.payload.metric = 'mean';
    scene.payload.highlight = { from: 10, to: 5 };
    scene.narration.cues[1].startMs = 3000;
    scene.narration.cues[3].endMs = 13_000;
    scene.interaction.terms.push({ id: 'term:p95', term: 'jitter', title: 'Jitter', body: 'x' });
    broken.scenes.push({ ...broken.scenes[0], kind: 'title', payload: { heading: 'End' } });
    broken.output.fps = 0;

    const paths = diagnosticsOf(broken).map((d) => `${d.path}: ${d.message}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        '$.output.fps: must be at least 1',
        '$.scenes[0].payload.dataset: no asset with id "missing-data"',
        '$.scenes[0].payload.metric: unknown metric "mean"; v1 supports p50, p95, p99',
        '$.scenes[0].payload.highlight: "to" must be greater than "from"',
        '$.scenes[0].narration.cues[1].startMs: cues must be in order and must not overlap',
        '$.scenes[0].interaction.terms[3].term: "jitter" does not occur in this scene\'s narration',
        '$.scenes[1].id: duplicate scene id "latency-day"',
        '$.scenes[1].interaction.terms[0].id: duplicate term id "term:binned"',
      ]),
    );

    const late = fixture();
    late.scenes[0].narration.cues[3].endMs = 13_000;
    expect(diagnosticsOf(late)).toEqual([
      { path: '$.scenes[0].narration.cues[3].endMs', message: 'ends after the scene (12000 ms)' },
    ]);

    const wrongKind = fixture();
    wrongKind.assets[0].kind = 'image';
    expect(diagnosticsOf(wrongKind)).toEqual([
      {
        path: '$.scenes[0].payload.dataset',
        message: 'asset "latency-requests" is an image asset, not a dataset',
      },
    ]);
  });

  it('derives the timeline from ordered scenes', () => {
    const spec = fixture();
    spec.scenes.unshift({ kind: 'title', id: 'intro', durationInFrames: 45, payload: { heading: 'Hi' } });
    const result = parseVideoSpec(spec);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(resolveTimeline(result.spec)).toEqual({
      durationInFrames: 405,
      scenes: [
        { id: 'intro', kind: 'title', from: 0, durationInFrames: 45 },
        { id: 'latency-day', kind: 'binnedChart', from: 45, durationInFrames: 360 },
      ],
    });
  });
});

describe('latency explainer spec', () => {
  it('keeps the subtitles the video showed before it was spec-driven', () => {
    expect(narrationToSrt(latencyScene.narration!)).toBe(`1
00:00:00,500 --> 00:00:03,800
${REQUEST_COUNT.toLocaleString('en-US')} requests, binned into ${BIN_COUNT} half-hour buckets.

2
00:00:04,000 --> 00:00:07,600
Each bar is the p95 latency of its bucket.

3
00:00:07,800 --> 00:00:09,900
Around two o'clock an incident pushes the tail up.

4
00:00:10,000 --> 00:00:11,900
Click any bar to inspect its requests.`);
  });

  it('agrees with the dataset the video renders', () => {
    const spec: VideoSpec = latencySpec;
    expect(spec.output).toEqual({ width: 1280, height: 720, fps: 30 });
    expect(resolveTimeline(spec).durationInFrames).toBe(360);
    expect(latencyScene.payload.bins).toBe(BIN_COUNT);
    expect(latencyScene.payload.highlight).toEqual({
      from: INCIDENT_WINDOW[0],
      to: INCIDENT_WINDOW[1],
    });
    expect(spec.assets[0].uri).toBe(
      `generator:latency-requests?seed=20260928&count=${REQUEST_COUNT}`,
    );
    expect(latencyScene.interaction?.terms.map((term) => term.id)).toEqual([
      'term:binned',
      'term:p95',
      'term:incident',
    ]);
  });
});
