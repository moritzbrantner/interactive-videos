import { memo } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { Fade } from '@/components/remotion/fade';
import { HotspotProvider, SvgHotspot, type HotspotActivation } from '@/components/remotion/hotspot';
import { Subtitles } from '@/components/remotion/subtitles';
import { BIN_COUNT, formatClock, INCIDENT_WINDOW, latencyBins, maxP95, type LatencyBin } from '@/data/latency';
import { useBudgetCounter } from '@/render-budget';
import { narrationToSrt } from '@/spec/video-spec';
import { latencyScene, latencySpec, latencyTimeline, SUBTITLE_LINGER_MS } from '@/video/latency-spec';
import { barRevealEnd, barRevealProgress } from '@/video/reveal';

export const VIDEO_FPS = latencySpec.output.fps;
export const VIDEO_DURATION = latencyTimeline.durationInFrames;
export const VIDEO_WIDTH = latencySpec.output.width;
export const VIDEO_HEIGHT = latencySpec.output.height;

export type LatencyVideoProps = {
  onActivate?: (activation: HotspotActivation) => void;
  selectedId?: string;
};

export type BinPayload = { kind: 'bin'; bin: LatencyBin };
export type TermPayload = { kind: 'term' };

const plot = { left: 96, top: 150, width: 1088, height: 320 } as const;
const slot = plot.width / BIN_COUNT;
const barWidth = slot * 0.72;

const colors = {
  background: '#0b0d12',
  text: '#f4f4f5',
  muted: '#9ca3af',
  grid: 'rgba(255, 255, 255, 0.08)',
  bar: '#60a5fa',
  incident: '#f97316',
} as const;

// Geometry is frame-independent: computed once from the bins, never per frame.
const bars = latencyBins.map((bin, index) => {
  const height = Math.max(2, ((bin.p95 ?? 0) / maxP95) * plot.height);
  return {
    bin,
    id: `bin-${bin.index}`,
    left: plot.left + index * slot + (slot - barWidth) / 2,
    height,
    incident: bin.x1 > INCIDENT_WINDOW[0] && bin.x0 < INCIDENT_WINDOW[1],
    index,
  };
});

const gridValues = [0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxP95 * fraction));

const subtitleText = latencyScene.narration ? narrationToSrt(latencyScene.narration) : '';

const subtitleHotspots = (latencyScene.interaction?.terms ?? []).map((term) => ({
  id: term.id,
  term: term.term,
  payload: { kind: 'term' } satisfies TermPayload,
}));

// Static chart chrome does not read the frame, so it renders once and is skipped afterwards.
const ChartChrome = memo(function ChartChrome() {
  useBudgetCounter('ChartChrome');
  return (
    <>
      {gridValues.map((value) => {
        const top = plot.top + plot.height - (value / maxP95) * plot.height;
        return (
          <div key={value}>
            <div
              style={{
                position: 'absolute',
                left: plot.left,
                top,
                width: plot.width,
                height: 1,
                background: colors.grid,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: top - 10,
                width: plot.left - 16,
                textAlign: 'right',
                fontSize: 16,
                color: colors.muted,
              }}
            >
              {value} ms
            </div>
          </div>
        );
      })}
      {[0, 6, 12, 18, 24].map((hour) => (
        <div
          key={hour}
          style={{
            position: 'absolute',
            left: plot.left + (hour / 24) * plot.width - 30,
            top: plot.top + plot.height + 12,
            width: 60,
            textAlign: 'center',
            fontSize: 16,
            color: colors.muted,
          }}
        >
          {formatClock(hour * 3600)}
        </div>
      ))}
    </>
  );
});

// Reads the frame and nothing else. BarMark is memoized on `progress`, so once a bar is fully
// revealed, later frames and selection changes no longer re-render its mark.
function Bar({ bar }: { bar: (typeof bars)[number] }) {
  useBudgetCounter('Bar');
  const progress = barRevealProgress(bar.index, useCurrentFrame());
  return <BarMark bar={bar} progress={progress} />;
}

const BarMark = memo(function BarMark({
  bar,
  progress,
}: {
  bar: (typeof bars)[number];
  progress: number;
}) {
  useBudgetCounter('BarMark');
  // Geometry is fixed; the reveal only animates transform and opacity.
  const mark = (
    <rect
      x={bar.left}
      y={plot.top + plot.height - bar.height}
      width={barWidth}
      height={bar.height}
      rx={4}
      fill={bar.incident ? colors.incident : colors.bar}
      style={{
        transform: `scaleY(${progress})`,
        transformBox: 'fill-box',
        transformOrigin: 'bottom',
        opacity: 0.35 + 0.65 * progress,
      }}
    />
  );
  // A spec that does not make the chart inspectable gets no bar hotspots.
  if (!latencyScene.payload.inspectable) return mark;
  return (
    <SvgHotspot<BinPayload>
      id={bar.id}
      payload={{ kind: 'bin', bin: bar.bin }}
      label={`${formatClock(bar.bin.x0)} to ${formatClock(bar.bin.x1)}, p95 ${Math.round(bar.bin.p95 ?? 0)} ms`}
      from={barRevealEnd(bar.index)}
      selectedStyle={{ stroke: colors.text, strokeWidth: 3 }}
    >
      {mark}
    </SvgHotspot>
  );
});

// The bar container has no props and does not read the frame; only each Bar animates.
const Bars = memo(function Bars() {
  useBudgetCounter('Bars');
  return (
    <svg
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      viewBox={`0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {bars.map((bar) => (
        <Bar key={bar.id} bar={bar} />
      ))}
    </svg>
  );
});

export function LatencyVideo({ onActivate, selectedId }: LatencyVideoProps) {
  useBudgetCounter('LatencyVideo');
  return (
    <HotspotProvider onActivate={onActivate} selectedId={selectedId}>
      <AbsoluteFill
        style={{
          background: colors.background,
          color: colors.text,
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <Fade startFrame={0} durationInFrames={20}>
          <div style={{ position: 'absolute', left: plot.left, top: 48 }}>
            <div style={{ fontSize: 18, color: colors.muted, letterSpacing: 2, textTransform: 'uppercase' }}>
              {latencyScene.payload.eyebrow}
            </div>
            <div style={{ fontSize: 44, fontWeight: 760, letterSpacing: -1.5, marginTop: 6 }}>
              {latencyScene.payload.heading}
            </div>
          </div>
        </Fade>
        <Fade startFrame={20} durationInFrames={20}>
          <ChartChrome />
        </Fade>
        <Bars />
        <Subtitles
          subtitleText={subtitleText}
          format="srt"
          fontSize={30}
          // The Player's controls overlay swallows clicks near the bottom edge; keep hotspots above it.
          bottom={112}
          maxWidth="86%"
          highlightMode="none"
          lingerMs={SUBTITLE_LINGER_MS}
          hotspots={subtitleHotspots}
        />
      </AbsoluteFill>
    </HotspotProvider>
  );
}
