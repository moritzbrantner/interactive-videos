import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';

import type { FormatPack, FormatRendering } from '@/catalog/catalog';
import { resolveTimeline, type TitleScene, type VideoSpec } from '@/spec/video-spec';

// Reusable format pack: a sequence of title scenes (eyebrow + heading). Typography and layout are
// derived from the output profile, so the same code renders portrait and landscape specs.
export const TITLE_CARD_FORMAT = { id: 'title-card', version: 1 } as const;

const colors = { background: '#0b0d12', text: '#f4f4f5', muted: '#9ca3af', accent: '#60a5fa' } as const;

function TitleSceneView({ scene }: { scene: TitleScene }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  // Motion only: the heading stays fully opaque from the first frame.
  const rise = interpolate(frame, [0, 18], [unit * 3, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        padding: unit * 8,
        background: colors.background,
        color: colors.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ transform: `translateY(${rise}px)` }}>
        {scene.payload.eyebrow ? (
          <div
            style={{
              fontSize: unit * 3.2,
              color: colors.muted,
              letterSpacing: unit * 0.4,
              textTransform: 'uppercase',
            }}
          >
            {scene.payload.eyebrow}
          </div>
        ) : null}
        <div
          style={{
            marginTop: unit * 2,
            fontSize: unit * 9,
            fontWeight: 760,
            lineHeight: 1.05,
            letterSpacing: -unit * 0.3,
          }}
        >
          {scene.payload.heading}
        </div>
        <div style={{ marginTop: unit * 4, width: unit * 16, height: unit * 0.8, background: colors.accent }} />
      </div>
    </AbsoluteFill>
  );
}

/** The title scenes of a spec, or an error naming every scene this format cannot draw. */
export function titleCardScenes(spec: VideoSpec): TitleScene[] {
  const unsupported = spec.scenes.filter((scene) => scene.kind !== 'title');
  if (unsupported.length) {
    throw new Error(
      `the title-card format renders only title scenes (${unsupported.map((scene) => `${scene.id}: ${scene.kind}`).join(', ')})`,
    );
  }
  return spec.scenes as TitleScene[];
}

export const titleCardFormat: FormatPack = {
  ...TITLE_CARD_FORMAT,
  compose(spec): FormatRendering {
    const scenes = titleCardScenes(spec);
    const timeline = resolveTimeline(spec).scenes;
    function TitleCardVideo() {
      return (
        <AbsoluteFill style={{ background: colors.background }}>
          {scenes.map((scene, index) => (
            <Sequence key={scene.id} from={timeline[index].from} durationInFrames={scene.durationInFrames}>
              <TitleSceneView scene={scene} />
            </Sequence>
          ))}
        </AbsoluteFill>
      );
    }
    return { component: TitleCardVideo };
  },
};
