import type { PlayerRef } from '@remotion/player';
import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// The interactive state is owned by the existing Hotspot/SvgHotspot primitives.
// Inert marks have data-hotspot but are not buttons and must not be advertised as clickable.
const ACTIVE_HOTSPOTS = 'button[data-hotspot], [data-hotspot][role="button"]';

type HotspotTarget = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
};

function visibleHotspots(frame: HTMLDivElement) {
  return Array.from(frame.querySelectorAll<HTMLElement>(ACTIVE_HOTSPOTS)).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

/** Move keyboard focus to a currently interactive element, never an inert future hotspot. */
export function focusFirstHotspot(frame: HTMLDivElement | null): boolean {
  if (!frame) return false;
  const first = visibleHotspots(frame)[0];
  first?.focus();
  return Boolean(first);
}

function measureHotspots(frame: HTMLDivElement): HotspotTarget[] {
  const origin = frame.getBoundingClientRect();
  return visibleHotspots(frame).map((element) => {
    const rect = element.getBoundingClientRect();
    const id = element.dataset.hotspot ?? '';
    return {
      id,
      label: element.getAttribute('aria-label') || element.textContent?.trim() || id,
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
      selected: element.getAttribute('aria-pressed') === 'true',
    };
  });
}

/**
 * Browser-only diagnostics: rectangles are measured from the actual interactive DOM,
 * so HTML subtitle terms and SVG chart elements use the same source of truth.
 * This is outside the Remotion composition and never enters an exported video.
 */
export function HotspotDebug({
  frame,
  player,
}: {
  frame: RefObject<HTMLDivElement | null>;
  player: RefObject<PlayerRef | null>;
}) {
  const [targets, setTargets] = useState<HotspotTarget[]>([]);

  useEffect(() => {
    const root = frame.current;
    const instance = player.current;
    if (!root || !instance) return;

    let scheduled = 0;
    const measure = () => {
      scheduled = 0;
      setTargets(measureHotspots(root));
    };
    const schedule = () => {
      if (!scheduled) scheduled = window.requestAnimationFrame(measure);
    };

    // Only subscribe while dev mode is mounted. Normal playback pays no DOM measurement cost.
    instance.addEventListener('frameupdate', schedule);
    instance.addEventListener('pause', schedule);
    instance.addEventListener('play', schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    // Selection can change at a paused frame without emitting a frameupdate.
    const selection = new MutationObserver(schedule);
    selection.observe(root, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
    schedule();

    return () => {
      instance.removeEventListener('frameupdate', schedule);
      instance.removeEventListener('pause', schedule);
      instance.removeEventListener('play', schedule);
      resize.disconnect();
      selection.disconnect();
      if (scheduled) window.cancelAnimationFrame(scheduled);
    };
  }, [frame, player]);

  const focus = (index: number) => {
    const root = frame.current;
    if (!root) return;
    player.current?.pause();
    visibleHotspots(root)[index]?.focus();
  };

  return (
    <>
      {frame.current
        ? createPortal(
            <div className="hotspot-debug-overlay" aria-hidden="true">
              {targets.map((target, index) => (
                <div
                  key={target.id + ':' + index}
                  className="hotspot-debug-bounds"
                  data-debug-hotspot={target.id}
                  data-selected={target.selected || undefined}
                  style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
                >
                  <span className="hotspot-debug-index">{index + 1}</span>
                </div>
              ))}
            </div>,
            frame.current,
          )
        : null}
      <section className="hotspot-debug-panel" aria-label="Developer hotspot inspector">
        <p className="eyebrow">Developer mode · {targets.length} clickable elements at this frame</p>
        {targets.length ? (
          <ol>
            {targets.map((target, index) => (
              <li key={target.id + ':' + index}>
                <button type="button" onClick={() => focus(index)}>
                  <span>{index + 1}. {target.label}</span>
                  <code>{target.id}</code>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>Nothing clickable at this frame. Play or seek to reveal hotspots.</p>
        )}
      </section>
    </>
  );
}
