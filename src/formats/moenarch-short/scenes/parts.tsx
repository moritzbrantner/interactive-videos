import { memo, type CSSProperties, type ReactNode } from 'react';

import { Fade } from '@/components/remotion/fade';
import { useBudgetCounter } from '@/render-budget';

import type { MoenarchTextBlock, MoenarchTextStyleName } from '../layout';
import type { MoenarchPlanScene } from '../plan';
import type { MoenarchShortTokens } from '../tokens';

// Building blocks shared by the archetype scenes. Scenes read no frame themselves: entrances come
// from the installed `Fade` primitive, and text is drawn from the lines the plan laid out.

export type MoenarchSceneProps = {
  scene: MoenarchPlanScene;
  tokens: MoenarchShortTokens;
  /** The first frame the scene is on screen (its incoming transition, or its start). */
  enterFrom: number;
};

/** Inline CSS of a token text style. */
export function textStyle(tokens: MoenarchShortTokens, name: MoenarchTextStyleName): CSSProperties {
  const style = tokens.scenes.text[name];
  const { typography, palette } = tokens;
  return {
    fontFamily: style.font === 'display' ? typography.displayFamily : typography.fontFamily,
    fontSize: style.size,
    fontWeight: typography.weight[style.weight],
    fontStyle: style.italic ? 'italic' : 'normal',
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textTransform: style.uppercase ? 'uppercase' : undefined,
    color: palette[style.color],
  };
}

type TextBlockProps = {
  block: MoenarchTextBlock;
  tokens: MoenarchShortTokens;
  /** Marks the title heading for the #12 DOM contract. */
  heading?: boolean;
};

/**
 * One planned text block. Each planned line is its own unwrapped block, so the browser never
 * re-wraps it. Memoized on plan data, so it renders once when its scene mounts.
 */
export const TextBlock = memo(function TextBlock({ block, tokens, heading = false }: TextBlockProps) {
  useBudgetCounter('MoenarchTextBlock');
  const accent = tokens.palette.accent;
  return (
    <div
      data-moenarch-text={block.role}
      {...(heading ? { 'data-moenarch-heading': '' } : {})}
      style={{ ...textStyle(tokens, block.style), display: 'block', margin: 0 }}
    >
      {block.lines.map((line, index) => (
        <span key={index}>
          {index > 0 ? ' ' : null}
          <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
            {block.runs
              ? block.runs[index].map((run, runIndex) =>
                  run.emphasis ? (
                    <span key={runIndex} data-moenarch-emphasis="" style={{ color: accent }}>
                      {run.text}
                    </span>
                  ) : (
                    run.text
                  ),
                )
              : line}
          </span>
        </span>
      ))}
    </div>
  );
});

/** Fades its content in at the scene's entrance, `step` places after the first element. */
export function Entrance({
  tokens,
  enterFrom,
  step,
  style,
  children,
}: {
  tokens: MoenarchShortTokens;
  enterFrom: number;
  step: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { durationInFrames, staggerInFrames } = tokens.scenes.entrance;
  return (
    <Fade startFrame={enterFrom + step * staggerInFrames} durationInFrames={durationInFrames} style={style}>
      {children}
    </Fade>
  );
}

/** The accent rule that separates parts of a scene. */
export function Rule({ tokens, color = tokens.palette.accent, width = tokens.scenes.rule.width }: { tokens: MoenarchShortTokens; color?: string; width?: number | string }) {
  return <div style={{ width, height: tokens.scenes.rule.thickness, background: color, flex: 'none' }} />;
}

/**
 * The content frame: the safe area inset clear of the signature and subtitles. `align` places the
 * content: centred, at the headline anchor, or at the bottom (over media).
 */
export function ContentFrame({
  tokens,
  align = 'center',
  children,
}: {
  tokens: MoenarchShortTokens;
  align?: 'center' | 'anchor' | 'end';
  children: ReactNode;
}) {
  const { safeArea, height } = tokens.output;
  const { inset } = tokens.scenes;
  const top = safeArea.top + inset.top;
  const bottom = safeArea.bottom + inset.bottom;
  const innerHeight = height - top - bottom;
  return (
    <div
      style={{
        position: 'absolute',
        top,
        right: safeArea.right,
        bottom,
        left: safeArea.left,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: align === 'end' ? 'flex-end' : 'center',
        alignItems: 'flex-start',
        paddingBottom: align === 'anchor' ? innerHeight * (1 - 2 * tokens.spacing.headlineAnchor) : 0,
      }}
    >
      {children}
    </div>
  );
}
