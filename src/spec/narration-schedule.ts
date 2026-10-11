// The narration frame schedule: where every scene, audio segment, silence, subtitle cue, word cue
// and semantic cue (mark) of a parsed VideoSpec lands, in absolute video frames.
//
// Plain TypeScript and a pure function of the spec: no audio is decoded or measured, nothing reads
// a clock. Rules (also in the README):
// - frameOf(ms) = ceil(ms * fps / 1000), the first frame whose sample time is at or after ms.
// - A scene with narration audio is  lead-in | audio (split at each hold) | lead-out,  and its
//   length is the sum of those parts. A scene without audio keeps its explicit length.
// - With audio, narration times are on the audio clock. A start time t lands on
//   leadIn + frameOf(t) + (hold frames of holds cutting at or before frameOf(t)); an end time on
//   leadIn + frameOf(t) + (hold frames of holds cutting strictly before frameOf(t)). Without
//   audio, frameOf(t) from the scene start.
// - Every window is [from, from + durationInFrames): the end frame is exclusive.
import {
  frameOfMs,
  narrationAudioFrames,
  resolveTimeline,
  type Narration,
  type NarrationAudio,
  type NarrationCue,
  type SceneKind,
  type VideoSpec,
} from './video-spec';

export type ScheduleWindow = { from: number; durationInFrames: number };

/** Plays the audio from audio-clock frame `trimBeforeInFrames` for `durationInFrames` frames from video frame `from`. */
export type ScheduledAudioSegment = ScheduleWindow & { trimBeforeInFrames: number };

export type ScheduledAudio = {
  asset: string;
  leadIn: ScheduleWindow;
  leadOut: ScheduleWindow;
  holds: ScheduleWindow[];
  segments: ScheduledAudioSegment[];
};

export type ScheduledCue = ScheduleWindow & { text: string };

export type ScheduledMark = { id: string; frame: number };

export type ScheduledScene = {
  id: string;
  kind: SceneKind;
  from: number;
  durationInFrames: number;
  /** `narration` when the scene's length comes from its narration audio. */
  timing: 'narration' | 'explicit';
  audio: ScheduledAudio | null;
  cues: ScheduledCue[];
  words: ScheduledCue[];
  marks: ScheduledMark[];
};

export type NarrationSchedule = { fps: number; durationInFrames: number; scenes: ScheduledScene[] };

/** The frame schedule of a parsed spec. Scene starts and lengths agree with `resolveTimeline`. */
export function narrationSchedule(spec: VideoSpec): NarrationSchedule {
  const fps = spec.output.fps;
  const timeline = resolveTimeline(spec);
  const scenes = spec.scenes.map((scene, index): ScheduledScene => {
    const { from, durationInFrames } = timeline.scenes[index];
    const narration = scene.narration;
    const base = { id: scene.id, kind: scene.kind, from, durationInFrames };
    if (!narration?.audio) {
      const start = (ms: number) => from + frameOfMs(ms, fps);
      return {
        ...base,
        timing: 'explicit',
        audio: null,
        cues: windows(narration?.cues ?? [], start, start),
        words: windows(narration?.words ?? [], start, start),
        marks: (narration?.marks ?? []).map((mark) => ({ id: mark.id, frame: start(mark.atMs) })),
      };
    }
    const parts = narrationAudioFrames(narration as Narration & { audio: NarrationAudio }, fps);
    const audioFrom = from + parts.leadIn;
    const holdFramesBefore = (frame: number, inclusive: boolean) =>
      parts.holds.filter((hold) => (inclusive ? hold.cut <= frame : hold.cut < frame)).reduce((sum, hold) => sum + hold.length, 0);
    const start = (ms: number) => {
      const frame = frameOfMs(ms, fps);
      return audioFrom + frame + holdFramesBefore(frame, true);
    };
    const end = (ms: number) => {
      const frame = frameOfMs(ms, fps);
      return audioFrom + frame + holdFramesBefore(frame, false);
    };
    // The audio is cut at each hold; segment k plays audio frames [cut k-1, cut k).
    const cuts = [0, ...parts.holds.map((hold) => hold.cut), parts.audio];
    const segments: ScheduledAudioSegment[] = [];
    const holds: ScheduleWindow[] = [];
    let silence = 0;
    for (let k = 0; k + 1 < cuts.length; k += 1) {
      const segmentFrom = audioFrom + cuts[k] + silence;
      segments.push({ from: segmentFrom, durationInFrames: cuts[k + 1] - cuts[k], trimBeforeInFrames: cuts[k] });
      const hold = parts.holds[k];
      if (hold) {
        holds.push({ from: segmentFrom + cuts[k + 1] - cuts[k], durationInFrames: hold.length });
        silence += hold.length;
      }
    }
    return {
      ...base,
      timing: 'narration',
      audio: {
        asset: narration.audio.asset,
        leadIn: { from, durationInFrames: parts.leadIn },
        leadOut: { from: from + durationInFrames - parts.leadOut, durationInFrames: parts.leadOut },
        holds,
        segments,
      },
      cues: windows(narration.cues, start, end),
      words: windows(narration.words ?? [], start, end),
      marks: (narration.marks ?? []).map((mark) => ({ id: mark.id, frame: start(mark.atMs) })),
    };
  });
  return { fps, durationInFrames: timeline.durationInFrames, scenes };
}

function windows(cues: readonly NarrationCue[], start: (ms: number) => number, end: (ms: number) => number): ScheduledCue[] {
  return cues.map((cue) => {
    const from = start(cue.startMs);
    return { from, durationInFrames: end(cue.endMs) - from, text: cue.text };
  });
}
