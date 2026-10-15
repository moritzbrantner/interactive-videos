// Acceptance for issue #14 (narration, cue and subtitle timing), written before the implementation.
//
// Spoken narration is the authoritative timing input of a scene that has pre-recorded narration
// audio. Everything here is plain data and plain TypeScript: no audio is decoded, measured or
// synthesized at render time.
//
// VideoSpec v1 additions (additive inside v1, like the #13 scene kinds: an older v1 reader rejects
// the new narration fields as unknown and a scene without durationInFrames as missing it, so it
// refuses these specs instead of misreading them; existing specs keep their meaning):
//
//   scene.narration = {
//     audio?:     { asset, durationMs }      asset: id of an `audio` asset; durationMs: integer >= 1,
//                                             the audio's length, declared by whoever resolved the
//                                             asset (the renderer never measures it).
//     leadInMs?:  integer >= 0               silence before the audio starts (default 0)
//     leadOutMs?: integer >= 0               silence after the audio ends (default 0)
//     holds?:     [{ atMs, durationMs }]     explicit silence inserted into the audio at atMs:
//                                             0 < atMs < audio.durationMs, durationMs >= 1, in
//                                             strictly increasing atMs order, never inside a cue.
//     cues:       [{ startMs, endMs, text }] sentence cues = the subtitles (existing shape)
//     words?:     [{ startMs, endMs, text }] word cues: one word each, in order, each inside a cue
//     marks?:     [{ id, atMs }]             semantic cues: named points scene state can change at
//   }
//   leadInMs, leadOutMs and holds require audio. Canonical key order is the order above; optional
//   fields appear only when given.
//
// Time domain: with audio, every narration time (cues, words, marks, holds) is milliseconds on the
// narration audio's own clock (0 = its first sample). Without audio, times stay milliseconds from
// the scene start, as before.
//
// Duration precedence: a scene with narration audio takes its length from the narration and must
// not state durationInFrames; a scene without audio must state it (existing behaviour). There is
// exactly one source of a scene's length.
//
// Frame mapping (exact rational arithmetic; no wall clock):
//   frameOf(ms) = ceil(ms * fps / 1000)      the first frame whose sample time is at or after ms
//   With audio, a scene is   leadIn | audio (split at each hold) | leadOut,   where
//     leadInFrames = frameOf(leadInMs), audioFrames = frameOf(audio.durationMs),
//     holdFrames   = frameOf(hold.durationMs), cut = frameOf(hold.atMs) (an audio-clock frame),
//     leadOutFrames = frameOf(leadOutMs),
//     durationInFrames = leadInFrames + audioFrames + sum(holdFrames) + leadOutFrames.
//   A start time t (cue/word start, mark) lands on scene frame
//     leadInFrames + frameOf(t) + sum(holdFrames of holds with cut <= frameOf(t)),
//   an end time t (cue/word end, exclusive) on
//     leadInFrames + frameOf(t) + sum(holdFrames of holds with cut <  frameOf(t)).
//   So a cue ending exactly at a hold ends where the hold starts, and a cue or mark starting at
//   it starts after the hold. Without audio: frameOf(t) for both.
//   Every window is [from, from + durationInFrames): the end frame is exclusive.
//
// Interface: `src/spec/narration-schedule.ts` exports `narrationSchedule(spec: VideoSpec)`, a
// pure function of a parsed spec returning (frames absolute in the video, windows end-exclusive):
//   { fps, durationInFrames, scenes: [{
//       id, kind, from, durationInFrames,
//       timing: 'narration' | 'explicit',
//       audio: null | { asset, leadIn: Window, leadOut: Window, holds: Window[],
//                       segments: [{ from, durationInFrames, trimBeforeInFrames }] },
//       cues:  [{ from, durationInFrames, text }],
//       words: [{ from, durationInFrames, text }],
//       marks: [{ id, frame }] }] }
//   where Window = { from, durationInFrames }. An audio segment plays the audio from audio-clock
//   frame trimBeforeInFrames for durationInFrames frames starting at video frame `from`.
//   `resolveTimeline(spec)` reports the same scene starts and lengths.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { narrationSchedule } from './narration-schedule';
import { parseVideoSpec, parseVideoSpecJson, resolveTimeline, serializeVideoSpec } from './video-spec';

const FIXTURE_PATH = new URL('./fixtures/moenarch-narration.videospec.json', import.meta.url);
const fixtureText = readFileSync(FIXTURE_PATH, 'utf8');
const fixture = (): Record<string, any> => JSON.parse(fixtureText);

const specimenText = readFileSync(new URL('./fixtures/moenarch-specimen.videospec.json', import.meta.url), 'utf8');

function parsed(input: unknown) {
  const result = parseVideoSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.spec;
}

function diagnosticsOf(input: unknown) {
  const result = parseVideoSpec(input);
  if (result.ok) throw new Error('expected the spec to be rejected');
  return result.diagnostics.map((d) => `${d.path}: ${d.message}`);
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedKeys(entry)]),
  );
}

/** The fixture with an edit applied to one scene's narration (0 = hook, 1 = point, 2 = close). */
function edited(scene: number, edit: (narration: Record<string, any>, sceneData: Record<string, any>) => void) {
  const spec = fixture();
  edit(spec.scenes[scene].narration, spec.scenes[scene]);
  return spec;
}

const win = (from: number, durationInFrames: number) => ({ from, durationInFrames });
const cue = (from: number, durationInFrames: number, text: string) => ({ from, durationInFrames, text });

describe('VideoSpec v1 narration timing fields', () => {
  it('accepts the narration fixture and round-trips it byte for byte', () => {
    const result = parseVideoSpecJson(fixtureText);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(serializeVideoSpec(result.spec)).toBe(fixtureText);
    // The fixture exercises every cue kind, audio with lead-in/out, a hold, and an explicit scene.
    const [hook, point, close] = result.spec.scenes as any[];
    expect(hook.narration.audio).toEqual({ asset: 'narration.hook', durationMs: 2450 });
    expect(hook.narration.words.length).toBeGreaterThan(0);
    expect(hook.narration.marks.length).toBeGreaterThan(0);
    expect(hook).not.toHaveProperty('durationInFrames');
    expect(point.narration.holds).toEqual([{ atMs: 1500, durationMs: 600 }]);
    expect(close.durationInFrames).toBe(90);
    expect(close.narration).not.toHaveProperty('audio');
  });

  it('normalizes narration fields to one canonical order regardless of input key order', () => {
    const a = parsed(fixture());
    const b = parsed(reversedKeys(fixture()));
    expect(b).toEqual(a);
    expect(serializeVideoSpec(b)).toBe(fixtureText);
    expect(Object.keys((a.scenes[0] as any).narration)).toEqual(['audio', 'leadInMs', 'leadOutMs', 'cues', 'words', 'marks']);
    expect(Object.keys((a.scenes[1] as any).narration)).toEqual(['audio', 'leadOutMs', 'holds', 'cues', 'marks']);
  });

  it('keeps existing specs without audio unchanged', () => {
    const result = parseVideoSpecJson(specimenText);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(serializeVideoSpec(result.spec)).toBe(specimenText);
  });

  it('names the new narration fields when rejecting an unknown one', () => {
    expect(diagnosticsOf(edited(0, (n) => (n.voice = 'alloy')))).toEqual([
      '$.scenes[0].narration.voice: unknown field; v1 allows cues, audio, leadInMs, leadOutMs, holds, words, marks',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.audio.gain = 1)))).toEqual([
      '$.scenes[0].narration.audio.gain: unknown field; v1 allows asset, durationMs',
    ]);
    expect(diagnosticsOf(edited(1, (n) => (n.holds[0].fade = true)))).toEqual([
      '$.scenes[1].narration.holds[0].fade: unknown field; v1 allows atMs, durationMs',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.marks[0].kind = 'emphasis')))).toEqual([
      '$.scenes[0].narration.marks[0].kind: unknown field; v1 allows id, atMs',
    ]);
  });

  it('takes the length of an audio scene from its narration: durationInFrames is the one other source', () => {
    expect(diagnosticsOf(edited(0, (_, scene) => (scene.durationInFrames = 102)))).toEqual([
      '$.scenes[0].durationInFrames: must be omitted when the narration has audio; the narration sets the scene length',
    ]);
    // Without audio the explicit length is still required.
    expect(diagnosticsOf(edited(2, (_, scene) => delete scene.durationInFrames))).toEqual(
      expect.arrayContaining(['$.scenes[2].durationInFrames: missing required field']),
    );
    expect(
      diagnosticsOf(
        edited(0, (n) => {
          delete n.audio;
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        '$.scenes[0].durationInFrames: missing required field',
        '$.scenes[0].narration.leadInMs: requires narration audio',
        '$.scenes[0].narration.leadOutMs: requires narration audio',
      ]),
    );
    expect(diagnosticsOf(edited(2, (n) => (n.holds = [{ atMs: 100, durationMs: 300 }])))).toEqual([
      '$.scenes[2].narration.holds: requires narration audio',
    ]);
  });

  it('checks the audio reference and its declared length', () => {
    expect(diagnosticsOf(edited(0, (n) => (n.audio.asset = 'narration.missing')))).toEqual([
      '$.scenes[0].narration.audio.asset: no asset with id "narration.missing"',
    ]);
    const image = fixture();
    image.assets.push({ id: 'poster', kind: 'image', asset: { schemaVersion: 1, kind: 'image', mediaType: 'image/png', sha256: 'c'.repeat(64), byteLength: 1, metadata: {} } });
    image.scenes[0].narration.audio.asset = 'poster';
    expect(diagnosticsOf(image)).toEqual(['$.scenes[0].narration.audio.asset: asset "poster" is an image asset, not an audio']);
    expect(diagnosticsOf(edited(0, (n) => (n.audio.durationMs = 0)))).toEqual(
      expect.arrayContaining(['$.scenes[0].narration.audio.durationMs: must be at least 1']),
    );
    expect(diagnosticsOf(edited(0, (n) => (n.audio.durationMs = 2450.5)))).toEqual([
      '$.scenes[0].narration.audio.durationMs: expected an integer, got number',
    ]);
    expect(diagnosticsOf(edited(0, (n) => delete n.audio.durationMs))).toEqual([
      '$.scenes[0].narration.audio.durationMs: missing required field',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.leadInMs = -1)))).toEqual(['$.scenes[0].narration.leadInMs: must be at least 0']);
    expect(diagnosticsOf(edited(0, (n) => (n.leadOutMs = 12.5)))).toEqual([
      '$.scenes[0].narration.leadOutMs: expected an integer, got number',
    ]);
  });

  it('rejects cues that are negative, inverted, out of order, overlapping or beyond the audio', () => {
    expect(diagnosticsOf(edited(0, (n) => (n.cues[0].startMs = -40)))).toEqual(
      expect.arrayContaining(['$.scenes[0].narration.cues[0].startMs: must be at least 0']),
    );
    expect(diagnosticsOf(edited(1, (n) => (n.cues[1] = { ...n.cues[1], startMs: 2900, endMs: 2900 })))).toEqual(
      expect.arrayContaining(['$.scenes[1].narration.cues[1]: endMs must be greater than startMs']),
    );
    expect(diagnosticsOf(edited(1, (n) => (n.cues[1].startMs = 1400)))).toEqual(
      expect.arrayContaining(['$.scenes[1].narration.cues[1].startMs: cues must be in order and must not overlap']),
    );
    expect(diagnosticsOf(edited(1, (n) => n.cues.reverse()))).toEqual(
      expect.arrayContaining(['$.scenes[1].narration.cues[1].startMs: cues must be in order and must not overlap']),
    );
    expect(diagnosticsOf(edited(1, (n) => (n.cues[1].endMs = 3001)))).toEqual([
      '$.scenes[1].narration.cues[1].endMs: ends after the narration audio (3000 ms)',
    ]);
    // On the audio clock a cue may end exactly with the audio.
    expect(() => parsed(edited(1, (n) => (n.cues[1].endMs = 3000)))).not.toThrow();
    // A cue strictly between two frame samples is never on screen: frameOf(1190) = frameOf(1200) = 36.
    expect(diagnosticsOf(edited(0, (n) => {
      n.cues.splice(1, 0, { startMs: 1190, endMs: 1200, text: 'Blink.' });
      n.words = n.words.slice(0, 4);
    }))).toEqual(['$.scenes[0].narration.cues[1]: is not on screen on any rendered frame']);
  });

  it('rejects invalid word cues', () => {
    expect(diagnosticsOf(edited(0, (n) => (n.words[2].startMs = 820)))).toEqual([
      '$.scenes[0].narration.words[2].startMs: words must be in order and must not overlap',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.words[1].endMs = 640)))).toEqual([
      '$.scenes[0].narration.words[1]: endMs must be greater than startMs',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.words[3].text = 'pace now.')))).toEqual([
      '$.scenes[0].narration.words[3].text: must be a single word without whitespace',
    ]);
    // Between the two cues (1180-1300 ms) there is no cue to belong to.
    expect(diagnosticsOf(edited(0, (n) => n.words.splice(4, 0, { startMs: 1200, endMs: 1260, text: 'um' })))).toEqual([
      '$.scenes[0].narration.words[4]: is not inside any cue',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.words[9].endMs = 2460)))).toEqual(
      expect.arrayContaining(['$.scenes[0].narration.words[9].endMs: ends after the narration audio (2450 ms)']),
    );
    expect(diagnosticsOf(edited(0, (n) => (n.words = [])))).toEqual(['$.scenes[0].narration.words: must not be empty']);
  });

  it('rejects invalid semantic cues (marks)', () => {
    expect(diagnosticsOf(edited(0, (n) => (n.marks[1].id = 'pace')))).toEqual([
      '$.scenes[0].narration.marks[1].id: duplicate mark id "pace"',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.marks[1].atMs = 600)))).toEqual([
      '$.scenes[0].narration.marks[1].atMs: marks must be in increasing order',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.marks[1].atMs = 640)))).toEqual([
      '$.scenes[0].narration.marks[1].atMs: marks must be in increasing order',
    ]);
    expect(diagnosticsOf(edited(0, (n) => (n.marks[0].atMs = -1)))).toEqual(['$.scenes[0].narration.marks[0].atMs: must be at least 0']);
    expect(diagnosticsOf(edited(0, (n) => (n.marks[1].atMs = 2450)))).toEqual([
      '$.scenes[0].narration.marks[1].atMs: must be before the end of the narration audio (2450 ms)',
    ]);
    // frameOf(1001) = frameOf(1020) = 31: the first mark would never be the active one.
    expect(diagnosticsOf(edited(0, (n) => (n.marks = [{ id: 'a', atMs: 1001 }, { id: 'b', atMs: 1020 }])))).toEqual([
      '$.scenes[0].narration.marks[1].atMs: lands on the same frame as marks[0]',
    ]);
    // Without audio a mark must land on a frame of the scene: frameOf(2999) = 90 = the scene length.
    expect(diagnosticsOf(edited(2, (n) => (n.marks[0].atMs = 2999)))).toEqual([
      '$.scenes[2].narration.marks[0].atMs: is not on any rendered frame of the scene',
    ]);
    expect(diagnosticsOf(edited(2, (n) => (n.marks[0].id = 'Not An Id')))).toEqual([
      '$.scenes[2].narration.marks[0].id: "Not An Id" is not a valid id (lowercase letters, digits, ".", "_", ":", "-")',
    ]);
  });

  it('rejects holds that are out of bounds, out of order or inside a cue', () => {
    expect(diagnosticsOf(edited(1, (n) => (n.holds[0].atMs = 0)))).toEqual([
      '$.scenes[1].narration.holds[0].atMs: must be inside the narration audio (between 0 and 3000 ms, exclusive)',
    ]);
    expect(diagnosticsOf(edited(1, (n) => (n.holds[0].atMs = 3000)))).toEqual([
      '$.scenes[1].narration.holds[0].atMs: must be inside the narration audio (between 0 and 3000 ms, exclusive)',
    ]);
    expect(diagnosticsOf(edited(1, (n) => (n.holds[0].durationMs = 0)))).toEqual([
      '$.scenes[1].narration.holds[0].durationMs: must be at least 1',
    ]);
    expect(diagnosticsOf(edited(1, (n) => (n.holds = [{ atMs: 1550, durationMs: 100 }, { atMs: 1500, durationMs: 100 }])))).toEqual([
      '$.scenes[1].narration.holds[1].atMs: holds must be in increasing order',
    ]);
    expect(diagnosticsOf(edited(1, (n) => (n.holds[0].atMs = 1000)))).toEqual([
      '$.scenes[1].narration.holds[0].atMs: falls inside cues[0]; holds go between cues',
    ]);
    // A hold exactly at a cue boundary is between cues.
    expect(() => parsed(edited(1, (n) => (n.holds[0].atMs = 1600)))).not.toThrow();
  });

  it('reports every problem of a broken narration at once, each with its path', () => {
    const spec = edited(0, (n, scene) => {
      scene.durationInFrames = 90;
      n.cues[1].endMs = 2500;
      n.words[0].text = '';
      n.marks[0].atMs = 99_999;
    });
    expect(diagnosticsOf(spec)).toEqual(
      expect.arrayContaining([
        '$.scenes[0].durationInFrames: must be omitted when the narration has audio; the narration sets the scene length',
        '$.scenes[0].narration.cues[1].endMs: ends after the narration audio (2450 ms)',
        '$.scenes[0].narration.words[0].text: must not be blank',
        '$.scenes[0].narration.marks[0].atMs: must be before the end of the narration audio (2450 ms)',
      ]),
    );
  });
});

describe('narrationSchedule', () => {
  const spec = () => parsed(fixture());

  it('derives the fixture frame schedule exactly (fps 30, frameOf(ms) = ceil(ms * 30 / 1000))', () => {
    expect(narrationSchedule(spec())).toEqual({
      fps: 30,
      durationInFrames: 309,
      scenes: [
        {
          // lead-in frameOf(400) = 12, audio frameOf(2450) = 74, lead-out frameOf(510) = 16.
          id: 'hook',
          kind: 'title',
          from: 0,
          durationInFrames: 102,
          timing: 'narration',
          audio: {
            asset: 'narration.hook',
            leadIn: win(0, 12),
            leadOut: win(86, 16),
            holds: [],
            segments: [{ from: 12, durationInFrames: 74, trimBeforeInFrames: 0 }],
          },
          cues: [cue(16, 32, 'Narration sets the pace.'), cue(51, 33, 'Every cue lands on a frame.')],
          words: [
            cue(16, 15, 'Narration'),
            cue(32, 5, 'sets'),
            cue(38, 2, 'the'),
            cue(41, 7, 'pace.'),
            cue(51, 7, 'Every'),
            cue(59, 6, 'cue'),
            cue(66, 7, 'lands'),
            cue(73, 3, 'on'),
            cue(76, 2, 'a'),
            cue(78, 6, 'frame.'),
          ],
          marks: [
            { id: 'pace', frame: 32 },
            { id: 'frames', frame: 51 },
          ],
        },
        {
          // No lead-in; audio 90 frames split at cut frameOf(1500) = 45 by a hold of frameOf(600) = 18;
          // lead-out frameOf(300) = 9.
          id: 'point',
          kind: 'statement',
          from: 102,
          durationInFrames: 117,
          timing: 'narration',
          audio: {
            asset: 'narration.point',
            leadIn: win(102, 0),
            leadOut: win(210, 9),
            holds: [win(147, 18)],
            segments: [
              { from: 102, durationInFrames: 45, trimBeforeInFrames: 0 },
              { from: 165, durationInFrames: 45, trimBeforeInFrames: 45 },
            ],
          },
          // The first cue ends exactly at the hold; the second starts after it.
          cues: [cue(105, 42, 'Holds add silence on purpose.'), cue(168, 39, 'Then the voice comes back.')],
          words: [],
          marks: [
            { id: 'silence', frame: 138 },
            // A mark exactly at the hold lands after it, on the first frame the voice returns.
            { id: 'return', frame: 165 },
          ],
        },
        {
          id: 'close',
          kind: 'conclusion',
          from: 219,
          durationInFrames: 90,
          timing: 'explicit',
          audio: null,
          cues: [cue(225, 72, 'Explicit scenes keep their timing.')],
          words: [],
          marks: [{ id: 'closing', frame: 249 }],
        },
      ],
    });
  });

  it('agrees with resolveTimeline on scene starts and lengths', () => {
    const schedule = narrationSchedule(spec());
    const timeline = resolveTimeline(spec());
    expect(timeline.durationInFrames).toBe(schedule.durationInFrames);
    expect(timeline.scenes).toEqual(
      schedule.scenes.map(({ id, kind, from, durationInFrames }) => ({ id, kind, from, durationInFrames })),
    );
  });

  it('is deterministic: same spec, same schedule, independent of input key order and earlier calls', () => {
    const first = narrationSchedule(spec());
    const again = narrationSchedule(parsed(reversedKeys(fixture())));
    expect(again).toEqual(first);
    expect(JSON.stringify(narrationSchedule(spec()))).toBe(JSON.stringify(first));
    // Plain data: survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    // Calling it does not change the spec.
    expect(serializeVideoSpec(spec())).toBe(fixtureText);
  });

  it('maps lead-in, holds and cue edges with the stated rounding', () => {
    // leadInMs 410: frameOf(410) = ceil(12.3) = 13; cue start 120 -> 13 + 4 = 17.
    const later = narrationSchedule(parsed(edited(0, (n) => (n.leadInMs = 410))));
    expect(later.scenes[0].durationInFrames).toBe(103);
    expect(later.scenes[0].cues[0]).toEqual(cue(17, 32, 'Narration sets the pace.'));
    expect(later.scenes[1].from).toBe(103);
    // A longer hold moves everything after it and lengthens the scene by the same frames.
    const longer = narrationSchedule(parsed(edited(1, (n) => (n.holds[0].durationMs = 1000))));
    expect(longer.scenes[1].durationInFrames).toBe(117 + 12);
    expect(longer.scenes[1].audio!.holds).toEqual([win(147, 30)]);
    expect(longer.scenes[1].audio!.segments[1]).toEqual({ from: 177, durationInFrames: 45, trimBeforeInFrames: 45 });
    expect(longer.scenes[1].cues[1]).toEqual(cue(180, 39, 'Then the voice comes back.'));
    // Two holds: cut frames frameOf(1550) = 47 and frameOf(2950) = 89 split the audio in three.
    const two = narrationSchedule(
      parsed(
        edited(1, (n) => {
          n.holds = [
            { atMs: 1550, durationMs: 600 },
            { atMs: 2950, durationMs: 100 },
          ];
        }),
      ),
    );
    expect(two.scenes[1].audio!.segments).toEqual([
      { from: 102, durationInFrames: 47, trimBeforeInFrames: 0 },
      { from: 167, durationInFrames: 42, trimBeforeInFrames: 47 },
      { from: 212, durationInFrames: 1, trimBeforeInFrames: 89 },
    ]);
    expect(two.scenes[1].audio!.holds).toEqual([win(149, 18), win(209, 3)]);
    expect(two.scenes[1].durationInFrames).toBe(90 + 18 + 3 + 9);
  });

  it('schedules scenes without audio from their explicit length and scene-relative cue times', () => {
    const specimen = parsed(JSON.parse(specimenText));
    const schedule = narrationSchedule(specimen);
    const timeline = resolveTimeline(specimen);
    expect(schedule.durationInFrames).toBe(timeline.durationInFrames);
    schedule.scenes.forEach((scheduled, index) => {
      const scene = specimen.scenes[index];
      expect(scheduled.timing).toBe('explicit');
      expect(scheduled.audio).toBeNull();
      expect(scheduled.from).toBe(timeline.scenes[index].from);
      expect(scheduled.durationInFrames).toBe(scene.durationInFrames);
      expect(scheduled.cues).toEqual(
        (scene.narration?.cues ?? []).map((c) => {
          const start = Math.ceil((c.startMs * 30) / 1000);
          const end = Math.ceil((c.endMs * 30) / 1000);
          return cue(scheduled.from + start, end - start, c.text);
        }),
      );
    });
  });

  it('keeps every scheduled window inside its scene and audio segments inside the audio', () => {
    const schedule = narrationSchedule(spec());
    for (const scene of schedule.scenes) {
      const end = scene.from + scene.durationInFrames;
      for (const item of [...scene.cues, ...scene.words]) {
        expect(item.from).toBeGreaterThanOrEqual(scene.from);
        expect(item.from + item.durationInFrames).toBeLessThanOrEqual(end);
      }
      for (const mark of scene.marks) {
        expect(mark.frame).toBeGreaterThanOrEqual(scene.from);
        expect(mark.frame).toBeLessThan(end);
      }
      if (!scene.audio) continue;
      const played = scene.audio.segments.reduce((sum, segment) => sum + segment.durationInFrames, 0);
      const silent = scene.audio.leadIn.durationInFrames + scene.audio.leadOut.durationInFrames + scene.audio.holds.reduce((sum, hold) => sum + hold.durationInFrames, 0);
      expect(played + silent).toBe(scene.durationInFrames);
    }
  });
});
