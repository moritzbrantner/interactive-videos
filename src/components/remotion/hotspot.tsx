'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useCurrentFrame } from 'remotion';

export type HotspotActivation<Payload = unknown> = {
  id: string;
  payload?: Payload;
  frame: number;
};

export type HotspotContextValue = {
  onActivate?: (activation: HotspotActivation) => void;
  selectedId?: string;
};

const HotspotContext = createContext<HotspotContextValue>({});

export type HotspotProviderProps = HotspotContextValue & {
  children?: ReactNode;
};

/**
 * Enables Hotspots below it. Without an `onActivate` handler (for example during a
 * server-side render) every Hotspot renders as inert, visually unchanged content.
 */
export function HotspotProvider({ onActivate, selectedId, children }: HotspotProviderProps) {
  return (
    <HotspotContext.Provider value={{ onActivate, selectedId }}>{children}</HotspotContext.Provider>
  );
}

export function isHotspotActive(frame: number, from = 0, durationInFrames = Infinity) {
  return frame >= from && frame < from + Math.max(0, durationInFrames);
}

export type UseHotspotOptions<Payload = unknown> = {
  id: string;
  payload?: Payload;
  from?: number;
  durationInFrames?: number;
};

export type HotspotState = {
  interactive: boolean;
  selected: boolean;
  /** Reports the activation; stops propagation so the Player's click-to-play does not fire. */
  activate: (event?: { stopPropagation(): void }) => void;
  /** Activates on Enter and Space, for elements that are not native buttons. */
  onKeyDown: (event: KeyboardEvent<Element>) => void;
};

/**
 * Shared hotspot behavior for custom click targets. `Hotspot` and `SvgHotspot` are built on it.
 */
export function useHotspot<Payload = unknown>({
  id,
  payload,
  from,
  durationInFrames,
}: UseHotspotOptions<Payload>): HotspotState {
  const frame = useCurrentFrame();
  const { onActivate, selectedId } = useContext(HotspotContext);
  const interactive = Boolean(onActivate) && isHotspotActive(frame, from, durationInFrames);

  const activate: HotspotState['activate'] = (event) => {
    event?.stopPropagation();
    if (interactive) onActivate?.({ id, payload, frame });
  };

  return {
    interactive,
    selected: interactive && selectedId === id,
    activate,
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Keep Space from scrolling the page or toggling Player playback.
      event.preventDefault();
      activate(event);
    },
  };
}

export type HotspotProps<Payload = unknown> = UseHotspotOptions<Payload> & {
  children?: ReactNode;
  label?: string;
  className?: string;
  style?: CSSProperties;
  interactiveStyle?: CSSProperties;
  selectedStyle?: CSSProperties;
};

const buttonReset: CSSProperties = {
  appearance: 'none',
  margin: 0,
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 'inherit',
  textAlign: 'inherit',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

const defaultInteractiveStyle: CSSProperties = {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationThickness: '0.08em',
  textUnderlineOffset: '0.18em',
};

const defaultSelectedStyle: CSSProperties = {
  textDecorationStyle: 'solid',
};

export function Hotspot<Payload = unknown>({
  id,
  payload,
  children,
  label,
  from,
  durationInFrames,
  className,
  style,
  interactiveStyle = defaultInteractiveStyle,
  selectedStyle = defaultSelectedStyle,
}: HotspotProps<Payload>) {
  const { interactive, selected, activate } = useHotspot({ id, payload, from, durationInFrames });

  if (!interactive) {
    return (
      <span className={className} data-hotspot={id} style={style}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-hotspot={id}
      aria-label={label}
      aria-pressed={selected}
      onClick={(event: MouseEvent<HTMLButtonElement>) => activate(event)}
      style={{
        ...buttonReset,
        ...style,
        ...interactiveStyle,
        ...(selected ? selectedStyle : undefined),
      }}
    >
      {children}
    </button>
  );
}

export type SvgHotspotProps<Payload = unknown> = UseHotspotOptions<Payload> & {
  children?: ReactNode;
  label?: string;
  className?: string;
  style?: CSSProperties;
  interactiveStyle?: CSSProperties;
  selectedStyle?: CSSProperties;
};

const defaultSvgInteractiveStyle: CSSProperties = {
  cursor: 'pointer',
};

/**
 * Hotspot for SVG content: renders a `<g>` so chart marks can stay inside an `<svg>`.
 * Interactive groups are focusable and behave like buttons for pointer and keyboard users.
 */
export function SvgHotspot<Payload = unknown>({
  id,
  payload,
  children,
  label,
  from,
  durationInFrames,
  className,
  style,
  interactiveStyle = defaultSvgInteractiveStyle,
  selectedStyle,
}: SvgHotspotProps<Payload>) {
  const { interactive, selected, activate, onKeyDown } = useHotspot({
    id,
    payload,
    from,
    durationInFrames,
  });

  if (!interactive) {
    return (
      <g className={className} data-hotspot={id} style={style}>
        {children}
      </g>
    );
  }

  return (
    <g
      className={className}
      data-hotspot={id}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={(event: MouseEvent<SVGGElement>) => activate(event)}
      onKeyDown={onKeyDown}
      style={{
        pointerEvents: 'auto',
        ...style,
        ...interactiveStyle,
        ...(selected ? selectedStyle : undefined),
      }}
    >
      {children}
    </g>
  );
}
