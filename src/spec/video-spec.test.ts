import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BIN_COUNT, INCIDENT_WINDOW, REQUEST_COUNT } from '@/data/latency';
import { latencyFormatScene, latencyScene, latencySpec } from '@/video/latency-spec';
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

    // Another version's fields are not checked against v1.
    expect(diagnosticsOf({ specVersion: 2, timeline: [] })).toEqual([
      { path: '$.specVersion', message: 'unsupported specVersion 2; this build reads 1' },
    ]);
    expect(diagnosticsOf({ specVersion: 2n })).toEqual([
      { path: '$.specVersion', message: 'unsupported specVersion 2n; this build reads 1' },
    ]);
    expect(diagnosticsOf({ project: {} })).toEqual([
      { path: '$.specVersion', message: 'missing required field' },
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
        '$.scenes[0].interaction.terms[3].term: "jitter" does not occur in this scene\'s narration outside a longer term',
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

  it('keeps input indexes in diagnostics after an invalid scene', () => {
    const spec = fixture();
    const [chart] = spec.scenes;
    spec.scenes = [{ ...chart, kind: 'unknown' }, chart, { ...chart, interaction: undefined }];
    delete spec.scenes[2].interaction;
    expect(diagnosticsOf(spec)).toEqual([
      expect.objectContaining({ path: '$.scenes[0].kind' }),
      { path: '$.scenes[2].id', message: 'duplicate scene id "latency-day"' },
    ]);
  });

  it('matches terms like the subtitle hotspots and rejects ambiguous or unsafe narration', () => {
    const spec = fixture();
    const scene = spec.scenes[0];
    scene.interaction.terms.push(
      { id: 'term:clock', term: "o'clock", title: 'Time', body: 'Two in the afternoon.' },
      { id: 'term:tail', term: 'pushes the tail', title: 'Tail', body: 'Slow requests.' },
    );
    expect(parseVideoSpec(spec).ok).toBe(true);

    scene.interaction.terms.push({ id: 'term:p95-again', term: 'P95', title: 'Again', body: 'x' });
    scene.interaction.terms.push({ id: 'term:part', term: 'bin', title: 'Bin', body: 'x' });
    scene.narration.cues[0].text = 'First line\n\nSecond block';
    expect(diagnosticsOf(spec)).toEqual([
      { path: '$.scenes[0].narration.cues[0].text', message: 'must not contain a blank line' },
      { path: '$.scenes[0].interaction.terms[5].term', message: '"P95" is already defined by terms[1]' },
      { path: '$.scenes[0].interaction.terms[0].term', message: '"binned" does not occur in this scene\'s narration outside a longer term' },
      { path: '$.scenes[0].interaction.terms[6].term', message: '"bin" does not occur in this scene\'s narration outside a longer term' },
    ]);

    const shadowed = fixture();
    shadowed.scenes[0].interaction.terms.push({ id: 'term:tail', term: 'tail', title: 'T', body: 'x' });
    shadowed.scenes[0].interaction.terms.push({ id: 'term:tail-up', term: 'the tail up', title: 'T', body: 'x' });
    expect(diagnosticsOf(shadowed)).toEqual([
      {
        path: '$.scenes[0].interaction.terms[3].term',
        message: '"tail" does not occur in this scene\'s narration outside a longer term',
      },
    ]);

    const markup = fixture();
    markup.scenes[0].narration.cues[1].text = 'Run <fast> mode';
    markup.scenes[0].narration.cues[2].text = '{\\b1}incident';
    markup.scenes[0].narration.cues[3].text = 'Rock &amp; roll &#38; more';
    expect(diagnosticsOf(markup).map((d) => d.path)).toEqual([
      '$.scenes[0].narration.cues[1].text',
      '$.scenes[0].narration.cues[2].text',
      '$.scenes[0].narration.cues[3].text',
      '$.scenes[0].interaction.terms[1].term',
    ]);
    const lineEnds = fixture();
    lineEnds.scenes[0].narration.cues[3].text = 'Click any\rbar.';
    lineEnds.scenes[0].interaction.terms[0].term = 'binned\ninto';
    expect(diagnosticsOf(lineEnds)).toEqual([
      { path: '$.scenes[0].narration.cues[3].text', message: 'must use "\\n" line breaks, not "\\r"' },
      { path: '$.scenes[0].interaction.terms[0].term', message: 'must be on one line' },
      {
        path: '$.scenes[0].interaction.terms[0].term',
        message: '"binned\ninto" does not occur in this scene\'s narration outside a longer term',
      },
    ]);
    expect(
      diagnosticsOf({ ...fixture(), project: { id: undefined, title: 'x' } }),
    ).toEqual([{ path: '$.project.id', message: 'missing required field' }]);

    const nested = fixture();
    nested.scenes[0].narration.cues[3].text = 'Run <a<b> mode';
    expect(diagnosticsOf(nested)).toEqual([
      { path: '$.scenes[0].narration.cues[3].text', message: expect.stringContaining('subtitle markup') },
    ]);
    const between = fixture();
    between.scenes[0].narration.cues[3] = { startMs: 11_980, endMs: 12_000, text: 'Click any bar.' };
    between.scenes[0].narration.cues.splice(3, 0, { startMs: 9_910, endMs: 9_920, text: 'Gap.' });
    expect(diagnosticsOf(between).map((d) => `${d.path}: ${d.message}`)).toEqual([
      '$.scenes[0].narration.cues[3]: is not on screen on any rendered frame',
      '$.scenes[0].narration.cues[4]: is not on screen on any rendered frame',
    ]);
    const onEndFrame = fixture();
    onEndFrame.scenes[0].narration.cues[0] = { startMs: 999, endMs: 1000, text: 'All binned.' };
    // The only sampled frame (30, at 1000 ms) is the cue's end time, which is still shown.
    expect(parseVideoSpec(onEndFrame).ok).toBe(true);
    const inherited = Object.create({ ...fixture(), renderer: 'remotion' });
    expect(diagnosticsOf(inherited)).toEqual([{ path: '$', message: 'expected a plain object' }]);

    const rounding = fixture();
    rounding.scenes[0].durationInFrames = 600;
    rounding.scenes[0].narration.cues.push({ startMs: 16_099, endMs: 16_100, text: 'Late.' });
    // Frame 483 is (483 / 30) * 1000 = 16100.000000000002 ms in the renderer: after the cue.
    expect(diagnosticsOf(rounding)).toEqual([
      { path: '$.scenes[0].narration.cues[4]', message: 'is not on screen on any rendered frame' },
    ]);
    const throwing = {
      get specVersion() {
        throw new Error('boom');
      },
    };
    expect(diagnosticsOf(throwing)).toEqual([
      { path: '$.specVersion', message: 'accessor properties are not supported' },
    ]);
    const hidden = fixture();
    Object.defineProperty(hidden, 'renderer', { value: 'remotion', enumerable: false });
    expect(diagnosticsOf(hidden)).toEqual([
      { path: '$.renderer', message: 'unsupported non-enumerable field' },
    ]);
    const proto = parseVideoSpecJson(fixtureText.replace('{\n  "specVersion"', '{\n  "__proto__": "evil",\n  "specVersion"'));
    expect(proto).toMatchObject({ ok: false, diagnostics: [{ path: '$.__proto__' }] });
    const arrayExtra = fixture();
    arrayExtra.assets.renderer = 'remotion';
    expect(diagnosticsOf(arrayExtra)).toEqual([
      { path: '$.assets', message: 'unsupported array property renderer' },
    ]);
    const subclassed = fixture();
    Object.setPrototypeOf(subclassed.assets, Object.assign(Object.create(Array.prototype), { renderer: 'x' }));
    expect(diagnosticsOf(subclassed)).toEqual([{ path: '$.assets', message: 'expected a plain array' }]);
    const maxIndex = fixture();
    maxIndex.assets['4294967295'] = 'evil';
    expect(diagnosticsOf(maxIndex)).toEqual([
      { path: '$.assets', message: 'unsupported array property 4294967295' },
    ]);
    const negativeZero = parseVideoSpecJson(fixtureText.replace('"startMs": 500', '"startMs": -0'));
    if (!negativeZero.ok) throw new Error('expected -0 to parse');
    expect(Object.is(negativeZero.spec.scenes[0].narration!.cues[0].startMs, 0)).toBe(true);
    const slow = fixture();
    slow.output.fps = 5;
    slow.scenes[0].durationInFrames = 400;
    slow.scenes[0].narration.cues.push({ startMs: 64_600, endMs: 64_601, text: 'Late.' });
    // Frame 323 is 64599.99999999999 ms in the renderer, before the cue; frame 324 is after it.
    expect(diagnosticsOf(slow)).toContainEqual({
      path: '$.scenes[0].narration.cues[4]',
      message: 'is not on screen on any rendered frame',
    });

    const sparse = fixture();
    sparse.assets = new Array(1);
    expect(diagnosticsOf(sparse)).toContainEqual({
      path: '$.assets[0]',
      message: 'expected an object, got undefined',
    });

    const ampersand = fixture();
    ampersand.scenes[0].narration.cues[3].text = 'Search & inspect any bar.';
    expect(parseVideoSpec(ampersand).ok).toBe(true);
  });

  it('accepts only safe integers, so timing stays exact and finite', () => {
    const huge = fixture();
    huge.scenes[0].durationInFrames = 1e308;
    expect(diagnosticsOf(huge)).toContainEqual({
      path: '$.scenes[0].durationInFrames',
      message: 'must be a safe integer (at most 2^53 - 1)',
    });
    const sum = fixture();
    sum.scenes[0].durationInFrames = Number.MAX_SAFE_INTEGER;
    delete sum.scenes[0].narration;
    delete sum.scenes[0].interaction;
    sum.scenes.push({ kind: 'title', id: 'end', durationInFrames: 10, payload: { heading: 'End' } });
    expect(diagnosticsOf(sum)).toEqual([
      { path: '$.scenes', message: 'the total duration must be a safe integer number of frames' },
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

  it('refuses specs the latency renderer would contradict', () => {
    const variant = (edit: (spec: Record<string, any>) => void) => {
      const spec = fixture();
      edit(spec);
      const result = parseVideoSpec(spec);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return () => latencyFormatScene(result.spec);
    };
    expect(variant((spec) => (spec.format.id = 'moenarch-short-v1'))).toThrow(/format moenarch-short-v1/);
    expect(variant((spec) => (spec.output.width = 640))).toThrow(/output 640x720@30/);
    expect(variant((spec) => (spec.scenes[0].narration.cues[1].startMs = 3880))).toThrow(
      /cue 1 starts within 80 ms/,
    );
    expect(
      variant((spec) => {
        spec.scenes[0].durationInFrames = 30;
        delete spec.scenes[0].narration;
        delete spec.scenes[0].interaction;
      }),
    ).toThrow(/ends before the reveal/);
    const silent = (frames: number) =>
      variant((spec) => {
        spec.scenes[0].durationInFrames = frames;
        delete spec.scenes[0].narration;
        delete spec.scenes[0].interaction;
      });
    // Frames run 0..duration-1; the last bar is fully revealed on frame 142.
    expect(silent(142)).toThrow(/ends before the reveal/);
    expect(silent(143)()).toMatchObject({ durationInFrames: 143 });
    expect(
      variant((spec) => (spec.scenes[0].interaction.terms[0].id = 'bin-0')),
    ).toThrow(/term id bin-0 is reserved/);
    expect(variant((spec) => (spec.scenes[0].payload.metric = 'p99'))).toThrow(/metric p99/);
    expect(variant((spec) => (spec.scenes[0].payload.bins = 24))).toThrow(/bins 24/);
    expect(variant((spec) => delete spec.scenes[0].payload.highlight)).toThrow(/incident window/);
    expect(variant((spec) => (spec.assets[0].uri = 'file:other.json'))).toThrow(/dataset must be/);
    expect(variant((spec) => (spec.scenes[0].payload.inspectable = false))()).toMatchObject({
      payload: { inspectable: false },
    });
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
