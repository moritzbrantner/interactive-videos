// The moenarch-short timing model: which scenes, transition, intro/outro and subtitle a frame
// shows. Plain TypeScript with no React or Remotion, so it is tested directly and the composition
// only draws what `moenarchFrameState` returns. Every answer is a pure function of the plan and
// the frame, so seeking to a frame gives the same result from any previous frame. Scene starts and
// lengths, subtitles, semantic cues (marks) and narration audio come from `narrationSchedule`.
import { narrationSchedule, type ScheduledCue, type ScheduledMark } from '@/spec/narration-schedule';
import type { SceneKind, VideoSpec } from '@/spec/video-spec';

import { layoutMoenarchScene, staticPath, type MoenarchSceneLayout } from './layout';
import { moenarchShortV1Tokens, type MoenarchShortTokens, type MoenarchTransitionName } from './tokens';

export type MoenarchPlanScene = {
  id: string;
  kind: SceneKind;
  from: number;
  durationInFrames: number;
  /** Text blocks and media, laid out once here; frame code only draws them. */
  layout: MoenarchSceneLayout;
  /** Subtitle windows in absolute frames, end-exclusive. */
  cues: ScheduledCue[];
  /** Semantic cues in absolute frames, in order. */
  marks: ScheduledMark[];
  /** Narration audio segments, played from `public/<staticPath>`; empty for a silent scene. */
  audio: MoenarchAudioSegment[];
};

/** Plays `staticPath` from audio frame `trimBeforeInFrames` during the window. */
export type MoenarchAudioSegment = { staticPath: string; from: number; durationInFrames: number; trimBeforeInFrames: number };

export type MoenarchPlanTransition = {
  name: MoenarchTransitionName;
  motion: boolean;
  fromSceneId: string;
  toSceneId: string;
  from: number;
  durationInFrames: number;
};

export type MoenarchWindow = { from: number; durationInFrames: number };

export type MoenarchPlan = {
  durationInFrames: number;
  fps: number;
  scenes: MoenarchPlanScene[];
  transitions: MoenarchPlanTransition[];
  intro: MoenarchWindow;
  outro: MoenarchWindow;
  /** The motionless transition that replaces moving ones under reduced motion. */
  reducedMotionTransition: MoenarchTransitionName;
};

export type MoenarchFrameState = {
  frame: number;
  /** Mounted scenes in paint order: the outgoing scene first during a transition. */
  sceneIds: string[];
  transition: { name: MoenarchTransitionName; progress: number } | null;
  intro: boolean;
  outro: boolean;
  subtitle: string | null;
  /** The current scene's latest semantic cue at or before the frame; null before its first one. */
  mark: string | null;
};

/**
 * Plans a spec for the pack, or throws naming what the format cannot render: other scene kinds,
 * another output profile, scene lengths outside the pacing range, and text or media the scene layout
 * cannot fit (see layout.ts).
 */
export function planMoenarchShort(spec: VideoSpec, tokens: MoenarchShortTokens = moenarchShortV1Tokens): MoenarchPlan {
  const problems: string[] = [];
  if (spec.format.id !== tokens.id || spec.format.version !== tokens.version) {
    problems.push(`spec targets ${spec.format.id} v${spec.format.version}, not ${tokens.id} v${tokens.version}`);
  }
  const { width, height, fps } = tokens.output;
  if (spec.output.width !== width || spec.output.height !== height || spec.output.fps !== fps) {
    problems.push(
      `output ${spec.output.width}x${spec.output.height} at ${spec.output.fps} fps is not ${width}x${height} at ${fps} fps`,
    );
  }
  const { minSceneDurationInFrames: min, maxSceneDurationInFrames: max } = tokens.pacing;
  const subtitleLimit = tokens.typography.subtitleMaxCharsPerLine * tokens.subtitles.maxLines;
  const { maxLeadInMs, maxLeadOutMs } = tokens.pacing;
  const timeline = narrationSchedule(spec);

  const scenes: MoenarchPlanScene[] = [];
  spec.scenes.forEach((scene, index) => {
    if (scene.kind === 'binnedChart') {
      problems.push(`${scene.id}: ${scene.kind} scenes are not part of ${tokens.id} v${tokens.version}`);
      return;
    }
    const scheduled = timeline.scenes[index];
    // The pacing range applies to the scene's length, whether stated or derived from narration.
    if (scheduled.durationInFrames < min || scheduled.durationInFrames > max) {
      problems.push(`${scene.id}: ${scheduled.durationInFrames} frames is outside the pacing range ${min}-${max}`);
    }
    const narration = scene.narration;
    if ((narration?.leadInMs ?? 0) > maxLeadInMs) {
      problems.push(`${scene.id}: lead-in ${narration!.leadInMs} ms exceeds the maximum ${maxLeadInMs} ms`);
    }
    if ((narration?.leadOutMs ?? 0) > maxLeadOutMs) {
      problems.push(`${scene.id}: lead-out ${narration!.leadOutMs} ms exceeds the maximum ${maxLeadOutMs} ms`);
    }
    let audioPath: string | null = null;
    if (scheduled.audio) {
      const asset = spec.assets.find((candidate) => candidate.id === scheduled.audio!.asset)!;
      audioPath = staticPath(asset.uri);
      if (audioPath === null) {
        problems.push(`${scene.id}: audio "${asset.id}" has uri "${asset.uri}"; ${tokens.id} serves only static:<path> audio from public/`);
      }
    }
    let layout: MoenarchSceneLayout | null = null;
    try {
      layout = layoutMoenarchScene(scene, tokens, spec.assets);
    } catch (error) {
      problems.push((error as Error).message);
    }
    for (const cue of scheduled.cues) {
      if (cue.text.length > subtitleLimit) problems.push(`${scene.id}: subtitle "${cue.text}" exceeds ${subtitleLimit} characters`);
    }
    scenes.push({
      id: scene.id,
      kind: scene.kind,
      from: scheduled.from,
      durationInFrames: scheduled.durationInFrames,
      layout: layout ?? { kind: scene.kind, blocks: [], media: null, ordered: false },
      cues: scheduled.cues.map((cue) => ({ ...cue })),
      marks: scheduled.marks.map((mark) => ({ ...mark })),
      audio: (scheduled.audio?.segments ?? []).map((segment) => ({ staticPath: audioPath ?? '', ...segment })),
    });
  });

  const cycle = tokens.pacing.transitionCycle;
  const transitions: MoenarchPlanTransition[] = [];
  if (!problems.length) {
    for (let index = 1; index < scenes.length; index += 1) {
      const [previous, next] = [scenes[index - 1], scenes[index]];
      const name = cycle[(index - 1) % cycle.length];
      const entry = tokens.transitions[name];
      // Centred on the boundary; both halves must fit inside their scene.
      const from = next.from - Math.floor(entry.durationInFrames / 2);
      if (from < previous.from || from + entry.durationInFrames > next.from + next.durationInFrames) {
        problems.push(`${previous.id} -> ${next.id}: the ${name} transition does not fit the scenes`);
      }
      transitions.push({ name, motion: entry.motion, fromSceneId: previous.id, toSceneId: next.id, from, durationInFrames: entry.durationInFrames });
    }
  }

  const { intro, outro } = tokens.signature;
  if (intro.durationInFrames + outro.durationInFrames > timeline.durationInFrames) {
    problems.push(`the video is shorter than the intro and outro (${intro.durationInFrames + outro.durationInFrames} frames)`);
  }
  if (problems.length) throw new Error(`${tokens.id} v${tokens.version} cannot render this spec: ${problems.join('; ')}`);

  return {
    durationInFrames: timeline.durationInFrames,
    fps: spec.output.fps,
    scenes,
    transitions,
    intro: { from: 0, durationInFrames: intro.durationInFrames },
    outro: { from: timeline.durationInFrames - outro.durationInFrames, durationInFrames: outro.durationInFrames },
    reducedMotionTransition: tokens.reducedMotion.transition,
  };
}

const within = (frame: number, window: MoenarchWindow) => frame >= window.from && frame < window.from + window.durationInFrames;

/** What a frame shows. Throws for frames outside the video or that are not whole numbers. */
export function moenarchFrameState(
  plan: MoenarchPlan,
  frame: number,
  { reducedMotion }: { reducedMotion: boolean },
): MoenarchFrameState {
  if (!Number.isInteger(frame) || frame < 0 || frame >= plan.durationInFrames) {
    throw new Error(`frame ${frame} is outside the video (0-${plan.durationInFrames - 1})`);
  }
  const current = plan.scenes.find((scene) => within(frame, scene))!;
  const active = plan.transitions.find((transition) => within(frame, transition));

  const cue = current.cues.find((candidate) => within(frame, candidate));
  let mark: string | null = null;
  for (const candidate of current.marks) if (candidate.frame <= frame) mark = candidate.id;

  return {
    frame,
    sceneIds: active ? [active.fromSceneId, active.toSceneId] : [current.id],
    transition: active
      ? {
          name: reducedMotion && active.motion ? plan.reducedMotionTransition : active.name,
          progress: (frame - active.from) / active.durationInFrames,
        }
      : null,
    intro: within(frame, plan.intro),
    outro: within(frame, plan.outro),
    subtitle: cue ? cue.text : null,
    mark,
  };
}
