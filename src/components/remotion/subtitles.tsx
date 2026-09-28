'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokToken,
} from '@remotion/captions';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { Hotspot } from '@/components/remotion/hotspot';

import {
  parseSubtitleText,
  type SubtitleCue,
  type SubtitleCueStyle,
  type SubtitleFormatInput,
  type SubtitleSpan,
  type SubtitleTrack,
} from '@/lib/remotion/subtitle-formats';

export type SubtitleHighlightMode = 'none' | 'current' | 'spoken';

export type SubtitleHotspot = {
  id: string;
  term: string;
  payload?: unknown;
  label?: string;
};

export type SubtitleTextSegment = {
  text: string;
  hotspot?: SubtitleHotspot;
};

export type SubtitlesProps = {
  captions?: Caption[];
  track?: SubtitleTrack;
  subtitleText?: string;
  format?: SubtitleFormatInput;
  fileName?: string;
  defaultCueDurationMs?: number;
  preserveTrackStyles?: boolean;
  combineTokensWithinMilliseconds?: number;
  breakOnSilenceAfterMilliseconds?: number;
  timeOffsetMs?: number;
  lingerMs?: number;
  highlightMode?: SubtitleHighlightMode;
  activeColor?: string;
  inactiveColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontWeight?: CSSProperties['fontWeight'];
  lineHeight?: number;
  maxWidth?: CSSProperties['maxWidth'];
  bottom?: CSSProperties['bottom'];
  padding?: CSSProperties['padding'];
  borderRadius?: number;
  textShadow?: string;
  className?: string;
  style?: CSSProperties;
  cueStyle?: CSSProperties;
  tokenStyle?: CSSProperties;
  activeTokenStyle?: CSSProperties;
  hotspots?: SubtitleHotspot[];
};

function getPageEndMs(tokens: TikTokToken[], startMs: number, lingerMs: number) {
  return Math.max(startMs, ...tokens.map((token) => token.toMs)) + Math.max(0, lingerMs);
}

function isTokenHighlighted(token: TikTokToken, timeMs: number, mode: SubtitleHighlightMode) {
  switch (mode) {
    case 'current':
      return timeMs >= token.fromMs && timeMs < token.toMs;
    case 'spoken':
      return timeMs >= token.fromMs;
    case 'none':
      return false;
  }
}

function isSpanHighlighted(span: SubtitleSpan, localTimeMs: number, mode: SubtitleHighlightMode) {
  if (span.startOffsetMs === undefined) return false;
  switch (mode) {
    case 'current':
      return localTimeMs >= span.startOffsetMs && localTimeMs < (span.endOffsetMs ?? Infinity);
    case 'spoken':
      return localTimeMs >= span.startOffsetMs;
    case 'none':
      return false;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type HotspotMatcher = (text: string) => SubtitleTextSegment[];

/**
 * Compiles hotspot terms once into a matcher that splits text into plain segments and
 * whole-word, case-insensitive hotspot terms. Terms do not depend on the frame, so callers
 * should build the matcher once per term list rather than on every frame.
 */
export function createHotspotMatcher(hotspots: SubtitleHotspot[] = []): HotspotMatcher | undefined {
  const candidates = hotspots
    .filter((hotspot) => hotspot.term.trim().length > 0)
    .sort((a, b) => b.term.length - a.term.length);
  if (!candidates.length) return undefined;

  const byTerm = new Map(candidates.map((hotspot) => [hotspot.term.toLocaleLowerCase(), hotspot]));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${candidates.map((hotspot) => escapeRegExp(hotspot.term)).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );

  return (text) => {
    const segments: SubtitleTextSegment[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const matched = match[0];
      if (index > cursor) segments.push({ text: text.slice(cursor, index) });
      segments.push({ text: matched, hotspot: byTerm.get(matched.toLocaleLowerCase()) });
      cursor = index + matched.length;
    }
    if (cursor < text.length || !segments.length) segments.push({ text: text.slice(cursor) });
    return segments;
  };
}

export function splitHotspotTerms(text: string, hotspots: SubtitleHotspot[] = []): SubtitleTextSegment[] {
  return createHotspotMatcher(hotspots)?.(text) ?? [{ text }];
}

function HotspotText({ text, matchHotspots }: { text: string; matchHotspots?: HotspotMatcher }) {
  if (!matchHotspots) return <>{text}</>;
  return (
    <>
      {matchHotspots(text).map((segment, index) =>
        segment.hotspot ? (
          <Hotspot
            key={index}
            id={segment.hotspot.id}
            payload={segment.hotspot.payload}
            label={segment.hotspot.label}
          >
            {segment.text}
          </Hotspot>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function cueOpacity(cue: SubtitleCue, timeMs: number) {
  const baseOpacity = cue.style?.opacity ?? 1;
  if (!cue.fade) return baseOpacity;
  const local = timeMs - cue.startMs;
  const duration = Math.max(0, cue.endMs - cue.startMs);
  const fadeIn = cue.fade.inMs > 0 ? clamp01(local / cue.fade.inMs) : 1;
  const fadeOut = cue.fade.outMs > 0 ? clamp01((duration - local) / cue.fade.outMs) : 1;
  return baseOpacity * Math.min(fadeIn, fadeOut);
}

function scaled(value: number | undefined, scale: number) {
  return value === undefined ? undefined : value * scale;
}

function subtitleStyleToCss(
  subtitleStyle: SubtitleCueStyle | undefined,
  scale: number,
): CSSProperties {
  if (!subtitleStyle) return {};
  const decorations = [
    subtitleStyle.underline ? 'underline' : null,
    subtitleStyle.strikeThrough ? 'line-through' : null,
  ].filter(Boolean) as string[];
  const shadowX = scaled(subtitleStyle.shadowOffsetX, scale);
  const shadowY = scaled(subtitleStyle.shadowOffsetY, scale);

  return {
    fontFamily: subtitleStyle.fontFamily,
    fontSize: scaled(subtitleStyle.fontSize, scale),
    fontWeight: subtitleStyle.fontWeight,
    fontStyle: subtitleStyle.fontStyle,
    textDecorationLine: decorations.length ? decorations.join(' ') : undefined,
    color: subtitleStyle.color,
    backgroundColor: subtitleStyle.borderStyle === 3 ? subtitleStyle.backgroundColor : undefined,
    letterSpacing: scaled(subtitleStyle.letterSpacing, scale),
    WebkitTextStroke:
      subtitleStyle.outlineWidth && subtitleStyle.outlineColor
        ? `${scaled(subtitleStyle.outlineWidth, scale)}px ${subtitleStyle.outlineColor}`
        : undefined,
    textShadow:
      subtitleStyle.shadowColor && (shadowX || shadowY)
        ? `${shadowX ?? 0}px ${shadowY ?? 0}px 0 ${subtitleStyle.shadowColor}`
        : undefined,
    opacity: subtitleStyle.opacity,
    transform: [
      subtitleStyle.scaleX !== undefined || subtitleStyle.scaleY !== undefined
        ? `scale(${subtitleStyle.scaleX ?? 1}, ${subtitleStyle.scaleY ?? 1})`
        : null,
      subtitleStyle.rotation !== undefined ? `rotate(${subtitleStyle.rotation}deg)` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined,
  };
}

function alignmentTransform(alignment: number) {
  const horizontal = alignment % 3 === 1 ? 0 : alignment % 3 === 2 ? -50 : -100;
  const vertical = alignment >= 7 ? 0 : alignment >= 4 ? -50 : -100;
  return `translate(${horizontal}%, ${vertical}%)`;
}

function marginCss(value: number | undefined, scriptSize: number | undefined) {
  if (value === undefined) return undefined;
  return scriptSize ? `${(value / scriptSize) * 100}%` : value;
}

function getCuePositionStyle(
  cue: SubtitleCue,
  track: SubtitleTrack,
  timeMs: number,
  fallbackBottom: CSSProperties['bottom'],
): CSSProperties {
  const alignment = cue.position?.alignment ?? cue.style?.alignment ?? 2;
  let x = cue.position?.x;
  let y = cue.position?.y;

  if (cue.move) {
    const local = timeMs - cue.startMs;
    const start = cue.move.startOffsetMs ?? 0;
    const end = cue.move.endOffsetMs ?? Math.max(1, cue.endMs - cue.startMs);
    const progress = clamp01((local - start) / Math.max(1, end - start));
    x = cue.move.fromX + (cue.move.toX - cue.move.fromX) * progress;
    y = cue.move.fromY + (cue.move.toY - cue.move.fromY) * progress;
  }

  if (x !== undefined && y !== undefined) {
    const left =
      cue.position?.coordinateSpace === 'percent'
        ? `${x}%`
        : track.scriptWidth
          ? `${(x / track.scriptWidth) * 100}%`
          : x;
    const top =
      cue.position?.coordinateSpace === 'percent'
        ? `${y}%`
        : track.scriptHeight
          ? `${(y / track.scriptHeight) * 100}%`
          : y;
    return { position: 'absolute', left, top, transform: alignmentTransform(alignment) };
  }

  if (cue.position?.position) {
    const percent = Number.parseFloat(cue.position.position);
    if (Number.isFinite(percent)) {
      const top = cue.position.line?.endsWith('%') ? cue.position.line : undefined;
      return {
        position: 'absolute',
        left: `${percent}%`,
        top,
        bottom: top ? undefined : fallbackBottom,
        transform: alignmentTransform(alignment),
        maxWidth: cue.position.size,
      };
    }
  }

  const leftMargin = marginCss(cue.style?.marginLeft, track.scriptWidth);
  const rightMargin = marginCss(cue.style?.marginRight, track.scriptWidth);
  const verticalMargin = marginCss(cue.style?.marginVertical, track.scriptHeight);
  const horizontal = alignment % 3;
  const vertical = Math.ceil(alignment / 3);

  return {
    position: 'absolute',
    left: horizontal === 1 ? leftMargin ?? '5%' : horizontal === 2 ? '50%' : undefined,
    right: horizontal === 0 ? rightMargin ?? '5%' : undefined,
    top: vertical === 3 ? verticalMargin ?? '5%' : vertical === 2 ? '50%' : undefined,
    bottom: vertical === 1 ? verticalMargin ?? fallbackBottom : undefined,
    transform:
      horizontal === 2 && vertical === 2
        ? 'translate(-50%, -50%)'
        : horizontal === 2
          ? 'translateX(-50%)'
          : vertical === 2
            ? 'translateY(-50%)'
            : undefined,
    textAlign: horizontal === 1 ? 'left' : horizontal === 0 ? 'right' : 'center',
  };
}

function CaptionPages({
  captions,
  timeMs,
  combineTokensWithinMilliseconds,
  breakOnSilenceAfterMilliseconds,
  lingerMs,
  highlightMode,
  activeColor,
  inactiveColor,
  backgroundColor,
  fontSize,
  fontWeight,
  lineHeight,
  maxWidth,
  bottom,
  padding,
  borderRadius,
  textShadow,
  className,
  style,
  tokenStyle,
  activeTokenStyle,
  matchHotspots,
}: Required<
  Pick<
    SubtitlesProps,
    | 'combineTokensWithinMilliseconds'
    | 'breakOnSilenceAfterMilliseconds'
    | 'lingerMs'
    | 'highlightMode'
    | 'activeColor'
    | 'inactiveColor'
    | 'backgroundColor'
    | 'fontSize'
    | 'fontWeight'
    | 'lineHeight'
    | 'maxWidth'
    | 'bottom'
    | 'padding'
    | 'borderRadius'
    | 'textShadow'
  >
> &
  Pick<SubtitlesProps, 'className' | 'style' | 'tokenStyle' | 'activeTokenStyle'> & {
    captions: Caption[];
    matchHotspots?: HotspotMatcher;
    timeMs: number;
  }) {
  const pages = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds,
        breakOnSilenceAfterMilliseconds,
      }).pages,
    [captions, combineTokensWithinMilliseconds, breakOnSilenceAfterMilliseconds],
  );
  const page = pages.find(
    (candidate) =>
      timeMs >= candidate.startMs &&
      timeMs <= getPageEndMs(candidate.tokens, candidate.startMs, lingerMs),
  );
  if (!page) return null;

  return (
    <div
      aria-label={page.text}
      className={className}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <div
        style={{
          maxWidth,
          padding,
          borderRadius,
          background: backgroundColor,
          color: inactiveColor,
          fontSize,
          fontWeight,
          lineHeight,
          textAlign: 'center',
          textShadow,
          whiteSpace: 'pre-wrap',
        }}
      >
        {page.tokens.map((token, index) => {
          const highlighted = isTokenHighlighted(token, timeMs, highlightMode);
          return (
            <span
              key={`${token.fromMs}-${token.toMs}-${index}`}
              style={{
                color: highlighted ? activeColor : inactiveColor,
                ...tokenStyle,
                ...(highlighted ? activeTokenStyle : undefined),
              }}
            >
              <HotspotText text={token.text} matchHotspots={matchHotspots} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RichTrack({
  track,
  timeMs,
  lingerMs,
  preserveTrackStyles,
  highlightMode,
  activeColor,
  inactiveColor,
  backgroundColor,
  fontSize,
  fontWeight,
  lineHeight,
  maxWidth,
  bottom,
  padding,
  borderRadius,
  textShadow,
  className,
  style,
  cueStyle,
  tokenStyle,
  activeTokenStyle,
  matchHotspots,
}: Required<
  Pick<
    SubtitlesProps,
    | 'lingerMs'
    | 'preserveTrackStyles'
    | 'highlightMode'
    | 'activeColor'
    | 'inactiveColor'
    | 'backgroundColor'
    | 'fontSize'
    | 'fontWeight'
    | 'lineHeight'
    | 'maxWidth'
    | 'bottom'
    | 'padding'
    | 'borderRadius'
    | 'textShadow'
  >
> &
  Pick<
    SubtitlesProps,
    'className' | 'style' | 'cueStyle' | 'tokenStyle' | 'activeTokenStyle'
  > & {
    track: SubtitleTrack;
    matchHotspots?: HotspotMatcher;
    timeMs: number;
  }) {
  const { height } = useVideoConfig();
  const scale = preserveTrackStyles && track.scriptHeight ? height / track.scriptHeight : 1;
  const activeCues = track.cues
    .filter((cue) => timeMs >= cue.startMs && timeMs <= cue.endMs + Math.max(0, lingerMs))
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  if (!activeCues.length) return null;

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}>
      {activeCues.map((cue) => {
        const localTimeMs = timeMs - cue.startMs;
        const assLike = track.format === 'ass' || track.format === 'ssa';
        const resolvedTrackStyle = preserveTrackStyles ? subtitleStyleToCss(cue.style, scale) : {};
        const cueBackground =
          preserveTrackStyles && assLike
            ? cue.style?.borderStyle === 3
              ? cue.style.backgroundColor
              : 'transparent'
            : backgroundColor;

        return (
          <div
            key={cue.id}
            aria-label={cue.text}
            style={{
              ...getCuePositionStyle(cue, track, timeMs, bottom),
              zIndex: cue.layer ?? 0,
              maxWidth: cue.position?.size ?? maxWidth,
              padding,
              borderRadius,
              background: cueBackground,
              color: inactiveColor,
              fontSize,
              fontWeight,
              lineHeight,
              textShadow,
              whiteSpace: 'pre-wrap',
              opacity: cueOpacity(cue, timeMs),
              ...resolvedTrackStyle,
              ...cueStyle,
            }}
          >
            {cue.spans.map((span, index) => {
              const highlighted = isSpanHighlighted(span, localTimeMs, highlightMode);
              const resolvedSpanStyle = preserveTrackStyles ? subtitleStyleToCss(span.style, scale) : {};
              return (
                <span
                  key={`${cue.id}-${index}`}
                  className={span.classes?.join(' ') || undefined}
                  style={{
                    ...resolvedSpanStyle,
                    color: highlighted
                      ? activeColor
                      : resolvedSpanStyle.color ?? resolvedTrackStyle.color ?? inactiveColor,
                    ...tokenStyle,
                    ...(highlighted ? activeTokenStyle : undefined),
                  }}
                >
                  <HotspotText text={span.text} matchHotspots={matchHotspots} />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function Subtitles({
  captions,
  track: suppliedTrack,
  subtitleText,
  format = 'auto',
  fileName,
  defaultCueDurationMs = 3000,
  preserveTrackStyles = true,
  combineTokensWithinMilliseconds = 1200,
  breakOnSilenceAfterMilliseconds = 500,
  timeOffsetMs = 0,
  lingerMs = 80,
  highlightMode = 'current',
  activeColor = '#facc15',
  inactiveColor = '#ffffff',
  backgroundColor = 'rgba(0, 0, 0, 0.72)',
  fontSize = 48,
  fontWeight = 700,
  lineHeight = 1.2,
  maxWidth = '84%',
  bottom = '8%',
  padding = '0.35em 0.6em',
  borderRadius = 14,
  textShadow = '0 2px 8px rgba(0, 0, 0, 0.55)',
  className,
  style,
  cueStyle,
  tokenStyle,
  activeTokenStyle,
  hotspots,
}: SubtitlesProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = (frame / fps) * 1000 + timeOffsetMs;
  const parsedTrack = useMemo(
    () =>
      subtitleText === undefined
        ? undefined
        : parseSubtitleText({ input: subtitleText, format, fileName, defaultCueDurationMs }),
    [subtitleText, format, fileName, defaultCueDurationMs],
  );
  const track = suppliedTrack ?? parsedTrack;
  const matchHotspots = useMemo(() => createHotspotMatcher(hotspots), [hotspots]);

  if (track) {
    return (
      <RichTrack
        track={track}
        timeMs={timeMs}
        lingerMs={lingerMs}
        preserveTrackStyles={preserveTrackStyles}
        highlightMode={highlightMode}
        activeColor={activeColor}
        inactiveColor={inactiveColor}
        backgroundColor={backgroundColor}
        fontSize={fontSize}
        fontWeight={fontWeight}
        lineHeight={lineHeight}
        maxWidth={maxWidth}
        bottom={bottom}
        padding={padding}
        borderRadius={borderRadius}
        textShadow={textShadow}
        className={className}
        style={style}
        cueStyle={cueStyle}
        tokenStyle={tokenStyle}
        activeTokenStyle={activeTokenStyle}
        matchHotspots={matchHotspots}
      />
    );
  }

  if (!captions?.length) return null;
  return (
    <CaptionPages
      captions={captions}
      timeMs={timeMs}
      combineTokensWithinMilliseconds={combineTokensWithinMilliseconds}
      breakOnSilenceAfterMilliseconds={breakOnSilenceAfterMilliseconds}
      lingerMs={lingerMs}
      highlightMode={highlightMode}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
      backgroundColor={backgroundColor}
      fontSize={fontSize}
      fontWeight={fontWeight}
      lineHeight={lineHeight}
      maxWidth={maxWidth}
      bottom={bottom}
      padding={padding}
      borderRadius={borderRadius}
      textShadow={textShadow}
      className={className}
      style={style}
      tokenStyle={tokenStyle}
      activeTokenStyle={activeTokenStyle}
      matchHotspots={matchHotspots}
    />
  );
}
