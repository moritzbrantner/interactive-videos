'use client';

import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

export type FadeProps = {
  children: ReactNode;
  startFrame?: number;
  durationInFrames?: number;
  from?: number;
  to?: number;
  className?: string;
  style?: CSSProperties;
};

function clampOpacity(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function Fade({
  children,
  startFrame = 0,
  durationInFrames = 15,
  from = 0,
  to = 1,
  className,
  style,
}: FadeProps) {
  const frame = useCurrentFrame();
  const fromOpacity = clampOpacity(from);
  const toOpacity = clampOpacity(to);
  const opacity =
    durationInFrames <= 0
      ? frame >= startFrame
        ? toOpacity
        : fromOpacity
      : interpolate(
          frame,
          [startFrame, startFrame + durationInFrames],
          [fromOpacity, toOpacity],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          },
        );

  return (
    <div className={className} style={{ ...style, opacity }}>
      {children}
    </div>
  );
}
