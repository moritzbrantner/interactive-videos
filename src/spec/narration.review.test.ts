import { describe, expect, it } from 'vitest';

import { moenarchFrameState, planMoenarchShort } from '@/formats/moenarch-short/plan';
import { narrationSchedule } from '@/spec/narration-schedule';
import { parseVideoSpec } from '@/spec/video-spec';
import fixture from '@/spec/fixtures/moenarch-narration.videospec.json';

// Regressions for the Codex review on PR #51.
type Dict = Record<string, any>;
const narrated = (): Dict => {
  const spec = structuredClone(fixture) as Dict;
  return spec;
};
const firstAudioScene = (spec: Dict) => spec.scenes.find((scene: Dict) => scene.narration?.audio);
const messagesAt = (spec: Dict, suffix: string) => {
  const result = parseVideoSpec(spec);
  return result.ok ? [] : result.diagnostics.filter((d) => d.path.endsWith(suffix)).map((d) => d.message);
};

describe('narration review regressions', () => {
  it('an invalid hold timestamp gets exactly one diagnostic', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [{ atMs: -1, durationMs: 100 }];
    expect(messagesAt(spec, 'holds[0].atMs')).toHaveLength(1);
  });

  it('a word that rounds to an empty frame window is rejected', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    const cue = scene.narration.cues[0];
    // Two timestamps inside one frame interval at 30 fps (frames are 33.3 ms apart).
    const start = Math.ceil((Math.ceil((cue.startMs * 30) / 1000) * 1000) / 30) + 1;
    scene.narration.words = [{ startMs: start, endMs: start + 5, text: 'tick' }];
    expect(messagesAt(spec, '.words[0]')).toContain('is not on screen on any rendered frame');
  });
});

describe('narration hold validation after an invalid predecessor', () => {
  it('still reports an independent problem of the next hold', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [
      { atMs: -1, durationMs: 100 },
      { atMs: 999999, durationMs: 100 },
    ];
    expect(messagesAt(spec, 'holds[1].atMs').join(' ')).toContain('must be inside the narration audio');
  });

  it('an unsafe integer timestamp gets exactly one diagnostic', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [{ atMs: Number.MAX_SAFE_INTEGER + 1, durationMs: 100 }];
    expect(messagesAt(spec, 'holds[0].atMs')).toHaveLength(1);
  });
});

describe('narration hold order across an invalid hold', () => {
  it('compares with the nearest preceding valid hold', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    const valid = scene.narration.holds?.[0]?.atMs;
    if (valid === undefined) return;
    scene.narration.holds = [
      { atMs: valid, durationMs: 100 },
      { atMs: -1, durationMs: 100 },
      { atMs: valid, durationMs: 100 },
    ];
    expect(messagesAt(spec, 'holds[2].atMs').join(' ')).toContain('holds must be in increasing order');
  });
});

describe('end-exclusive cue visibility (issue #52)', () => {
  const cases = [
    ['without narration audio', 2],
    ['with narration audio', 1],
  ] as const;

  it.each(cases)('rejects a 999-1000 ms cue %s', (_source, sceneIndex) => {
    const spec = narrated();
    spec.scenes[sceneIndex].narration.cues = [{ startMs: 999, endMs: 1000, text: 'Blink' }];
    expect(messagesAt(spec, `.scenes[${sceneIndex}].narration.cues[0]`)).toEqual([
      'is not on screen on any rendered frame',
    ]);
  });

  it.each(cases)('rejects a 999-1000 ms word %s', (_source, sceneIndex) => {
    const spec = narrated();
    spec.scenes[sceneIndex].narration.cues = [{ startMs: 900, endMs: 1100, text: 'Blink' }];
    spec.scenes[sceneIndex].narration.words = [{ startMs: 999, endMs: 1000, text: 'Blink' }];
    expect(messagesAt(spec, `.scenes[${sceneIndex}].narration.words[0]`)).toEqual([
      'is not on screen on any rendered frame',
    ]);
  });

  it.each(cases)('schedules exact boundaries with no extra end frame %s, independent of seek order', (_source, sceneIndex) => {
    const spec = narrated();
    // Frame 29 is sampled at 966.67 ms; frame 30 at exactly 1000 ms.
    // The first cue ends at frame 30; the second begins there.
    const boundaries = [
      { startMs: 966, endMs: 1000, text: 'Before' },
      { startMs: 1000, endMs: 1033, text: 'After' },
    ];
    spec.scenes[sceneIndex].narration.cues = boundaries;
    spec.scenes[sceneIndex].narration.words = boundaries;
    const result = parseVideoSpec(spec);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    const scene = narrationSchedule(result.spec).scenes[sceneIndex];
    const expected = [
      { from: scene.from + 29, durationInFrames: 1, text: 'Before' },
      { from: scene.from + 30, durationInFrames: 1, text: 'After' },
    ];
    expect(scene.cues).toEqual(expected);
    expect(scene.words).toEqual(expected);

    const plan = planMoenarchShort(result.spec);
    const frames = [28, 29, 30, 31].map((offset) => scene.from + offset);
    const linear = frames.map((frame) => moenarchFrameState(plan, frame, { reducedMotion: false }));
    expect(linear.map((state) => state.subtitle)).toEqual([null, 'Before', 'After', null]);

    // Seeking to an arbitrary earlier or later frame must not depend on the previous frame.
    for (const frame of [frames[3], frames[1], frames[2], frames[0], frames[2], frames[3]]) {
      expect(moenarchFrameState(plan, frame, { reducedMotion: false })).toEqual(linear[frames.indexOf(frame)]);
    }
  });

  it('every cue and word in a valid mixed audio/explicit spec occupies rendered frames', () => {
    const result = parseVideoSpec(narrated());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    for (const scene of narrationSchedule(result.spec).scenes) {
      for (const window of [...scene.cues, ...scene.words]) {
        expect(window.durationInFrames).toBeGreaterThan(0);
        expect(window.from).toBeGreaterThanOrEqual(scene.from);
        expect(window.from + window.durationInFrames).toBeLessThanOrEqual(scene.from + scene.durationInFrames);
      }
    }
  });
});
