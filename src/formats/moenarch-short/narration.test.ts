// Acceptance for issue #14 (narration, cue and subtitle timing) in moenarch-short v1, written
// before the implementation. The VideoSpec fields, frame mapping and `narrationSchedule` contract
// are stated in src/spec/narration-timing.test.ts.
//
// Contract for the pack:
// - `planMoenarchShort(spec)` takes scene starts and lengths from `narrationSchedule(spec)`, so a
//   narrated scene is as long as its narration; the pacing range applies to that derived length.
// - Lead-in and lead-out are bounded by the format: `tokens.pacing.maxLeadInMs` and
//   `tokens.pacing.maxLeadOutMs` (integers). A longer one makes the spec unrenderable with
//   "<scene id>: lead-in <n> ms exceeds the maximum <max> ms" (lead-out likewise).
// - Narration audio must be an `audio` asset with a `static:<path>` uri, served from public/<path>
//   like images; any other uri is unrenderable ("... serves only static:<path> audio ...").
// - `moenarchFrameState(plan, frame, opts)` additionally returns `mark: string | null`: the id of
//   the current scene's latest semantic cue (mark) at or before the frame, null before its first
//   mark. `subtitle` is the text of the current scene's scheduled cue window containing the frame.
//   The current scene is the scheduled scene whose window contains the frame.
// - The composition plays each scheduled audio segment with Remotion's `Audio` and renders
//   subtitles through the installed `Subtitles` primitive (see e2e/moenarch-narration.spec.ts).
// - `src/projects.ts` registers `src/spec/fixtures/moenarch-narration.videospec.json` with
//   `moenarchShort()` (project id `moenarch-narration`), after the scene gallery.
// - Formats that do not play narration audio refuse specs that have it (title-card here).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { moenarchFrameState, planMoenarchShort } from '@/formats/moenarch-short/plan';
import { moenarchShortV1Tokens as tokens } from '@/formats/moenarch-short/tokens';
import { titleCardFormat } from '@/formats/title-card';
import { catalog } from '@/projects';
import { NARRATION_FIXTURE_FILES, narrationWav, wavDurationMs } from '@/spec/fixtures/narration-audio';
import narrationFixture from '@/spec/fixtures/moenarch-narration.videospec.json';
import { narrationSchedule } from '@/spec/narration-schedule';
import { assertVideoSpec } from '@/spec/video-spec';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PROJECT_ID = 'moenarch-narration';
const fixture = (): Record<string, any> => structuredClone(narrationFixture) as Record<string, any>;
// Computed on first use, so each test reports its own failure.
let cached: { spec: ReturnType<typeof assertVideoSpec>; schedule: ReturnType<typeof narrationSchedule>; plan: ReturnType<typeof planMoenarchShort> } | null = null;
function subject() {
  if (!cached) {
    const spec = assertVideoSpec(fixture());
    cached = { spec, schedule: narrationSchedule(spec), plan: planMoenarchShort(spec) };
  }
  return cached;
}
const pacing = tokens.pacing as unknown as Record<string, number>;

/** What a frame must show, derived from the schedule alone. */
function expectedAt(frame: number) {
  const { schedule } = subject();
  const scene = schedule.scenes.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames)!;
  const cue = scene.cues.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames);
  const marks = scene.marks.filter((mark) => mark.frame <= frame);
  return { subtitle: cue ? cue.text : null, mark: marks.length ? marks[marks.length - 1].id : null };
}

describe('narration fixture media', () => {
  it('commits reproducible audio files whose length is the declared narration length', () => {
    const { spec } = subject();
    const declared = new Map(
      spec.scenes.flatMap((scene) => {
        const audio = (scene.narration as { audio?: { asset: string; durationMs: number } } | undefined)?.audio;
        return audio ? [[audio.asset, audio.durationMs] as const] : [];
      }),
    );
    expect(declared.size).toBe(2);
    for (const asset of spec.assets) {
      expect(asset.kind).toBe('audio');
      const path = asset.uri.replace(/^static:/, '');
      const file = NARRATION_FIXTURE_FILES.find((candidate) => candidate.path === path);
      expect(file, asset.uri).toBeDefined();
      const absolute = join(ROOT, 'public', path);
      expect(existsSync(absolute), absolute).toBe(true);
      const bytes = new Uint8Array(readFileSync(absolute));
      expect(Buffer.from(bytes).equals(Buffer.from(narrationWav(file!.durationMs, file!.toneHz))), path).toBe(true);
      expect(wavDurationMs(bytes)).toBe(declared.get(asset.id));
    }
  });
});

describe('moenarch-short narration timing', () => {
  it('registers the narration project and sizes it from the narration', () => {
    expect(catalog.projects.map((project) => project.id)).toContain(PROJECT_ID);
    const result = catalog.resolve(PROJECT_ID);
    if (!result.ok) throw new Error(result.message);
    expect(result.composition).toMatchObject({ width: 1080, height: 1920, fps: 30, durationInFrames: 309 });
  });

  it('plans scenes on the narration schedule', () => {
    const { schedule, plan } = subject();
    expect(plan.durationInFrames).toBe(schedule.durationInFrames);
    expect(plan.scenes.map(({ id, from, durationInFrames }) => ({ id, from, durationInFrames }))).toEqual(
      schedule.scenes.map(({ id, from, durationInFrames }) => ({ id, from, durationInFrames })),
    );
    // Transitions sit on the derived boundaries.
    expect(plan.transitions.map((transition) => transition.toSceneId)).toEqual(['point', 'close']);
    expect(plan.transitions[0].from).toBe(102 - Math.floor(plan.transitions[0].durationInFrames / 2));
  });

  it('shows each subtitle and semantic cue on exactly its scheduled frames', () => {
    const { plan } = subject();
    for (let frame = 0; frame < plan.durationInFrames; frame += 1) {
      const state = moenarchFrameState(plan, frame, { reducedMotion: false });
      const expected = expectedAt(frame);
      expect({ subtitle: state.subtitle, mark: (state as { mark?: unknown }).mark }, `frame ${frame}`).toEqual(expected);
    }
  });

  it('lands on the hand-computed boundary frames', () => {
    const { plan } = subject();
    const at = (frame: number) => {
      const state = moenarchFrameState(plan, frame, { reducedMotion: false }) as { subtitle: string | null; mark?: string | null };
      return [state.subtitle, state.mark];
    };
    // Lead-in: nothing yet.
    expect(at(0)).toEqual([null, null]);
    expect(at(15)).toEqual([null, null]);
    expect(at(16)).toEqual(['Narration sets the pace.', null]);
    expect(at(31)).toEqual(['Narration sets the pace.', null]);
    expect(at(32)).toEqual(['Narration sets the pace.', 'pace']);
    expect(at(47)).toEqual(['Narration sets the pace.', 'pace']);
    expect(at(48)).toEqual([null, 'pace']);
    expect(at(51)).toEqual(['Every cue lands on a frame.', 'frames']);
    expect(at(83)).toEqual(['Every cue lands on a frame.', 'frames']);
    // Lead-out.
    expect(at(84)).toEqual([null, 'frames']);
    expect(at(101)).toEqual([null, 'frames']);
    // A new scene starts without a mark.
    expect(at(102)).toEqual([null, null]);
    expect(at(105)).toEqual(['Holds add silence on purpose.', null]);
    expect(at(138)).toEqual(['Holds add silence on purpose.', 'silence']);
    expect(at(146)).toEqual(['Holds add silence on purpose.', 'silence']);
    // The hold: silence, no subtitle.
    expect(at(147)).toEqual([null, 'silence']);
    expect(at(164)).toEqual([null, 'silence']);
    expect(at(165)).toEqual([null, 'return']);
    expect(at(168)).toEqual(['Then the voice comes back.', 'return']);
    expect(at(206)).toEqual(['Then the voice comes back.', 'return']);
    expect(at(207)).toEqual([null, 'return']);
    // The explicit scene keeps its own length and scene-relative cue times.
    expect(at(219)).toEqual([null, null]);
    expect(at(225)).toEqual(['Explicit scenes keep their timing.', null]);
    expect(at(249)).toEqual(['Explicit scenes keep their timing.', 'closing']);
    expect(at(296)).toEqual(['Explicit scenes keep their timing.', 'closing']);
    expect(at(297)).toEqual([null, 'closing']);
    expect(at(308)).toEqual([null, 'closing']);
  });

  it('answers every frame the same way regardless of the order frames are asked in', () => {
    const { plan } = subject();
    const forward = Array.from({ length: plan.durationInFrames }, (_, frame) => moenarchFrameState(plan, frame, { reducedMotion: false }));
    const backward = Array.from({ length: plan.durationInFrames }, (_, index) => plan.durationInFrames - 1 - index).map((frame) =>
      moenarchFrameState(plan, frame, { reducedMotion: false }),
    );
    expect(backward.reverse()).toEqual(forward);
    expect(planMoenarchShort(assertVideoSpec(fixture()))).toEqual(plan);
  });

  it('bounds lead-in and lead-out by the format tokens', () => {
    expect(Number.isSafeInteger(pacing.maxLeadInMs)).toBe(true);
    expect(Number.isSafeInteger(pacing.maxLeadOutMs)).toBe(true);
    // The fixture's lead-in (400 ms) and lead-out (510 ms) are within the bounds.
    expect(pacing.maxLeadInMs).toBeGreaterThanOrEqual(400);
    expect(pacing.maxLeadOutMs).toBeGreaterThanOrEqual(510);
    const withLead = (key: 'leadInMs' | 'leadOutMs', value: number) => {
      const variant = fixture();
      variant.scenes[0].narration[key] = value;
      return () => planMoenarchShort(assertVideoSpec(variant));
    };
    expect(withLead('leadInMs', pacing.maxLeadInMs)).not.toThrow(/lead-in/);
    expect(withLead('leadInMs', pacing.maxLeadInMs + 1)).toThrow(
      `hook: lead-in ${pacing.maxLeadInMs + 1} ms exceeds the maximum ${pacing.maxLeadInMs} ms`,
    );
    expect(withLead('leadOutMs', pacing.maxLeadOutMs)).not.toThrow(/lead-out/);
    expect(withLead('leadOutMs', pacing.maxLeadOutMs + 1)).toThrow(
      `hook: lead-out ${pacing.maxLeadOutMs + 1} ms exceeds the maximum ${pacing.maxLeadOutMs} ms`,
    );
  });

  it('applies the pacing range to the derived scene length', () => {
    const variant = fixture();
    // 6000 ms of audio is 180 frames; with lead-in 12 and lead-out 16 the scene is 208 frames.
    variant.scenes[0].narration.audio.durationMs = 6000;
    expect(() => planMoenarchShort(assertVideoSpec(variant))).toThrow(
      `hook: 208 frames is outside the pacing range ${tokens.pacing.minSceneDurationInFrames}-${tokens.pacing.maxSceneDurationInFrames}`,
    );
  });

  it('serves narration audio only from static paths', () => {
    const variant = fixture();
    variant.assets[0].uri = 'https://example.com/hook.wav';
    const result = createCatalog([{ spec: variant, format: moenarchShort() }], PROJECT_ID).resolve(PROJECT_ID);
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
    expect(!result.ok && result.message).toContain('serves only static:<path> audio');
  });

  it('is refused by a format that cannot play narration audio', () => {
    const variant = fixture();
    variant.format = { id: 'title-card', version: 1 };
    variant.scenes = [{ ...variant.scenes[0], kind: 'title' }];
    const result = createCatalog([{ spec: variant, format: titleCardFormat }], PROJECT_ID).resolve(PROJECT_ID);
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
  });
});

