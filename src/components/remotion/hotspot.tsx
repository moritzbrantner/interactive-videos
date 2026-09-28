'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
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

export type HotspotProps<Payload = unknown> = {
  id: string;
  payload?: Payload;
  children?: ReactNode;
  label?: string;
  from?: number;
  durationInFrames?: number;
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

export function isHotspotActive(frame: number, from = 0, durationInFrames = Infinity) {
  return frame >= from && frame < from + Math.max(0, durationInFrames);
}

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
  const frame = useCurrentFrame();
  const { onActivate, selectedId } = useContext(HotspotContext);

  if (!onActivate || !isHotspotActive(frame, from, durationInFrames)) {
    return (
      <span className={className} data-hotspot={id} style={style}>
        {children}
      </span>
    );
  }

  const selected = selectedId === id;
  const activate = (event: MouseEvent<HTMLButtonElement>) => {
    // Keep the Player's click-to-play handler from resuming playback.
    event.stopPropagation();
    onActivate({ id, payload, frame });
  };

  return (
    <button
      type="button"
      className={className}
      data-hotspot={id}
      aria-label={label}
      aria-pressed={selected}
      onClick={activate}
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
