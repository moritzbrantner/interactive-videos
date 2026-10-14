import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, useCurrentFrame } from 'remotion';

import { Subtitles } from '@/components/remotion/subtitles';
import type { SubtitleTrack } from '@/lib/remotion/subtitle-formats';
import { useBudgetCounter } from '@/render-budget';

import { useMoenarchFonts } from './fonts';
import { moenarchFrameState, type MoenarchPlan, type MoenarchPlanScene } from './plan';
import { MOENARCH_SCENES } from './scenes';
import type { MoenarchEasingName, MoenarchShortTokens, MoenarchTransitionName } from './tokens';

// The moenarch-short composition. All motion is a function of `useCurrentFrame()` through the
// plan's frame state and token easings; every colour, size and curve is read from the tokens.
// Scenes draw the layout the plan computed, through the archetype renderers in `scenes/`.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const readReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;

/** The viewer's prefers-reduced-motion setting; false where there is no browser. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

type Ease = (progress: number) => number;
type Eases = Record<MoenarchEasingName, Ease>;

function createEases(tokens: MoenarchShortTokens): Eases {
  const eases = {} as Eases;
  for (const name of Object.keys(tokens.easing) as MoenarchEasingName[]) {
    const curve: readonly [number, number, number, number] = tokens.easing[name];
    const bezier = Easing.bezier(...curve);
    eases[name] = (progress) => interpolate(progress, [0, 1], [0, 1], { easing: bezier, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }
  return eases;
}

type Role = 'only' | 'out' | 'in';

/** Opacity and transform of a scene layer while a transition runs. */
function layerStyle(
  tokens: MoenarchShortTokens,
  eases: Eases,
  role: Role,
  transition: { name: MoenarchTransitionName; progress: number } | null,
): CSSProperties {
  if (!transition || role === 'only') return {};
  const entry = tokens.transitions[transition.name];
  const eased = eases[entry.easing](transition.progress);
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  switch (transition.name) {
    case 'cut':
      return role === 'out' ? { opacity: 0 } : {};
    case 'dissolve':
      // A short dip: the outgoing scene is gone before the incoming one arrives.
      return role === 'out'
        ? { opacity: interpolate(eased, [0, 0.55], [1, 0], clamp) }
        : { opacity: interpolate(eased, [0.45, 1], [0, 1], clamp) };
    case 'lift': {
      const { distance } = tokens.transitions.lift;
      return role === 'out'
        ? { opacity: interpolate(eased, [0, 0.5], [1, 0], clamp), transform: `translateY(${-distance * 0.5 * eased}px)` }
        : { opacity: interpolate(eased, [0.3, 1], [0, 1], clamp), transform: `translateY(${distance * (1 - eased)}px)` };
    }
    case 'slide': {
      const { distance } = tokens.transitions.slide;
      return role === 'out'
        ? { opacity: interpolate(eased, [0, 0.6], [1, 0], clamp), transform: `translateX(${-distance * eased}px)` }
        : { opacity: interpolate(eased, [0.4, 1], [0, 1], clamp), transform: `translateX(${distance * (1 - eased)}px)` };
    }
  }
}

function SceneLayer({
  tokens,
  scene,
  enterFrom,
  style,
}: {
  tokens: MoenarchShortTokens;
  scene: MoenarchPlanScene;
  enterFrom: number;
  style: CSSProperties;
}) {
  const Scene = MOENARCH_SCENES[scene.kind as keyof typeof MOENARCH_SCENES];
  return (
    <AbsoluteFill data-moenarch-scene={scene.id} data-moenarch-kind={scene.kind} style={style}>
      <Scene scene={scene} tokens={tokens} enterFrom={enterFrom} />
    </AbsoluteFill>
  );
}

/** The recurring signature: three stacked bars of falling width beside the label. */
function SignatureMark({ tokens, color }: { tokens: MoenarchShortTokens; color: string }) {
  const { mark, label } = tokens.signature;
  const { typography } = tokens;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.unit * 2 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: mark.barGap }}>
        {mark.barWidths.map((barWidth, index) => (
          <div key={index} style={{ width: barWidth, height: mark.barHeight, background: tokens.palette.accent }} />
        ))}
      </div>
      <div
        style={{
          fontFamily: typography.fontFamily,
          fontSize: typography.scale.signature,
          fontWeight: typography.weight.medium,
          letterSpacing: `${typography.letterSpacing.signature}em`,
          textTransform: 'uppercase',
          color,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Intro({ tokens, eases, plan, frame, reducedMotion }: OverlayProps) {
  const { intro } = tokens.signature;
  const progress = eases[intro.easing]((frame - plan.intro.from) / plan.intro.durationInFrames);
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  // The surface holds the lockup, then lifts away to uncover the first scene.
  const opacity = interpolate(progress, [0.45, 1], [1, 0], clamp);
  const ruleProgress = interpolate(progress, [0, 0.5], [0, 1], clamp);
  return (
    <AbsoluteFill
      data-moenarch-intro=""
      style={{ background: tokens.palette.surface, opacity, justifyContent: 'center', alignItems: 'center' }}
    >
      <div style={reducedMotion ? undefined : { transform: `translateY(${-tokens.signature.intro.rise * progress}px)` }}>
        <SignatureMark tokens={tokens} color={tokens.palette.text} />
        <div
          style={{
            marginTop: tokens.spacing.eyebrowGap,
            height: tokens.spacing.ruleThickness,
            width: tokens.spacing.ruleWidth * 2,
            background: tokens.palette.accent,
            transformOrigin: 'left center',
            ...(reducedMotion ? { opacity: ruleProgress } : { transform: `scaleX(${ruleProgress})` }),
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

function Outro({ tokens, eases, plan, frame, reducedMotion }: OverlayProps) {
  const { outro } = tokens.signature;
  const progress = eases[outro.easing]((frame - plan.outro.from) / plan.outro.durationInFrames);
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const opacity = interpolate(progress, [0, 0.6], [0, 1], clamp);
  const lockupOpacity = interpolate(progress, [0.35, 1], [0, 1], clamp);
  return (
    <AbsoluteFill
      data-moenarch-outro=""
      style={{
        background: tokens.surfaces.outro.background,
        opacity,
        justifyContent: 'center',
        alignItems: 'center',
        ...(reducedMotion ? {} : { transform: `translateY(${outro.rise * (1 - progress)}px)` }),
      }}
    >
      <div
        style={{
          opacity: lockupOpacity,
          ...(reducedMotion ? {} : { transform: `translateY(${outro.rise * 0.5 * (1 - progress)}px)` }),
        }}
      >
        <SignatureMark tokens={tokens} color={tokens.palette.text} />
      </div>
    </AbsoluteFill>
  );
}

type OverlayProps = { tokens: MoenarchShortTokens; eases: Eases; plan: MoenarchPlan; frame: number; reducedMotion: boolean };

/**
 * The current subtitle, drawn by the installed `Subtitles` primitive. The plan decides which cue a
 * frame shows (end-exclusive frame windows); the primitive gets that one cue over exactly its
 * window, so its own inclusive-end timing agrees with the plan.
 */
function Subtitle({ tokens, cue, fps }: { tokens: MoenarchShortTokens; cue: MoenarchCueWindow; fps: number }) {
  const { safeArea } = tokens.output;
  const { typography, surfaces, spacing, subtitles } = tokens;
  const surface = surfaces.subtitle;
  const track = useMemo<SubtitleTrack>(
    () => ({
      format: 'srt',
      cues: [
        {
          id: `${cue.from}`,
          // Same arithmetic as the primitive's frame time, so the first and last frames match exactly.
          startMs: (cue.from / fps) * 1000,
          endMs: ((cue.from + cue.durationInFrames - 1) / fps) * 1000,
          text: cue.text,
          spans: [{ text: cue.text }],
        },
      ],
    }),
    [cue, fps],
  );
  // The primitive positions its cues absolutely over the frame; here the cue sits in the
  // subtitle band's flow, so the band (and its box) is the cue's box.
  const flow = { position: 'relative', left: 'auto', right: 'auto', top: 'auto', bottom: 'auto', transform: 'none' } as const;
  return (
    <div
      style={{
        position: 'absolute',
        left: safeArea.left,
        right: safeArea.right,
        bottom: safeArea.bottom + spacing.subtitleOffset,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div data-moenarch-subtitle="" style={{ maxWidth: '100%' }}>
        <Subtitles
          track={track}
          lingerMs={0}
          preserveTrackStyles={false}
          highlightMode="none"
          activeColor={tokens.palette.text}
          inactiveColor={tokens.palette.text}
          backgroundColor={surface.background}
          fontSize={typography.scale.subtitle}
          fontWeight={typography.weight.medium}
          lineHeight={typography.lineHeight.text}
          maxWidth="100%"
          padding={`${surface.paddingY}px ${surface.paddingX}px`}
          borderRadius={surface.radius}
          textShadow="none"
          style={{ position: 'relative', inset: 'auto' }}
          cueStyle={{
            ...flow,
            boxSizing: 'border-box',
            fontFamily: typography.fontFamily,
            textAlign: subtitles.align,
          }}
        />
      </div>
    </div>
  );
}

type MoenarchCueWindow = MoenarchPlanScene['cues'][number];

/** Narration audio: one Remotion `Audio` per scheduled segment, trimmed to its audio frames. */
function NarrationAudio({ plan }: { plan: MoenarchPlan }) {
  return (
    <>
      {plan.scenes.flatMap((scene) =>
        scene.audio.map((segment) => (
          <Sequence key={`${scene.id}-${segment.from}`} from={segment.from} durationInFrames={segment.durationInFrames} layout="none">
            <Audio src={`${import.meta.env.BASE_URL}${segment.staticPath}`} trimBefore={segment.trimBeforeInFrames} />
          </Sequence>
        )),
      )}
    </>
  );
}

/** Builds the composition component for one plan and token set. */
export function createMoenarchVideo(plan: MoenarchPlan, tokens: MoenarchShortTokens) {
  const scenes = new Map(plan.scenes.map((scene) => [scene.id, scene]));
  const eases = createEases(tokens);
  // A scene's entrance starts on its first frame on screen: the start of its incoming transition.
  const enterFrom = new Map(
    plan.scenes.map((scene) => [
      scene.id,
      plan.transitions.find((transition) => transition.toSceneId === scene.id)?.from ?? scene.from,
    ]),
  );

  function MoenarchShortVideo() {
    useBudgetCounter('MoenarchShortVideo');
    const fontsReady = useMoenarchFonts();
    const frame = useCurrentFrame();
    const reducedMotion = usePrefersReducedMotion();
    const state = useMemo(() => moenarchFrameState(plan, frame, { reducedMotion }), [frame, reducedMotion]);
    const { safeArea } = tokens.output;
    const subtitleCue =
      state.subtitle === null
        ? null
        : (plan.scenes.flatMap((scene) => scene.cues).find((cue) => frame >= cue.from && frame < cue.from + cue.durationInFrames) ?? null);
    if (!fontsReady) {
      return null;
    }
    return (
      <AbsoluteFill
        data-moenarch-root=""
        data-format={tokens.id}
        data-format-version={String(tokens.version)}
        data-reduced-motion={String(reducedMotion)}
        style={{ background: tokens.palette.background, color: tokens.palette.text, overflow: 'hidden' }}
      >
        {state.sceneIds.map((id, index) => {
          const role: Role = state.sceneIds.length === 1 ? 'only' : index === 0 ? 'out' : 'in';
          return <SceneLayer key={id} tokens={tokens} scene={scenes.get(id)!} enterFrom={enterFrom.get(id)!} style={layerStyle(tokens, eases, role, state.transition)} />;
        })}
        {state.transition ? <div data-moenarch-transition={state.transition.name} hidden /> : null}
        <div data-moenarch-signature="" style={{ position: 'absolute', top: safeArea.top, left: safeArea.left }}>
          <SignatureMark tokens={tokens} color={tokens.palette.muted} />
        </div>
        {state.intro ? <Intro tokens={tokens} eases={eases} plan={plan} frame={frame} reducedMotion={reducedMotion} /> : null}
        {state.outro ? <Outro tokens={tokens} eases={eases} plan={plan} frame={frame} reducedMotion={reducedMotion} /> : null}
        {subtitleCue ? <Subtitle tokens={tokens} cue={subtitleCue} fps={plan.fps} /> : null}
        {state.mark !== null ? <div data-moenarch-mark={state.mark} hidden /> : null}
        <NarrationAudio plan={plan} />
      </AbsoluteFill>
    );
  }
  return MoenarchShortVideo;
}
