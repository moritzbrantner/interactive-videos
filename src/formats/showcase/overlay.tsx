import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { PlayerOverlayProps } from '@/catalog/catalog';

export type ShowcaseKind = 'preview' | 'popover' | 'accordion' | 'dialog';

/** One disclosure, shown while its scene is on screen. */
export type ShowcaseDisclosure = {
  kind: ShowcaseKind;
  sceneId: string;
  /** Trigger label (accessible name). */
  label: string;
  /** Heading of the disclosed information. */
  title: string;
  /** The contextual information itself. */
  body: string;
};

type TimedDisclosure = ShowcaseDisclosure & { from: number; to: number };

/** Current Player frame, updated from the Player's own events (no polling). */
function usePlayerFrame(player: PlayerOverlayProps['player']) {
  const [frame, setFrame] = useState(() => player.current?.getCurrentFrame() ?? 0);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const update = () => setFrame(current.getCurrentFrame());
    update();
    current.addEventListener('frameupdate', update);
    current.addEventListener('seeked', update);
    return () => {
      current.removeEventListener('frameupdate', update);
      current.removeEventListener('seeked', update);
    };
  }, [player]);
  return frame;
}

function Preview({ disclosure }: { disclosure: TimedDisclosure }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const previewing = hovered || focused || pinned;
  const id = useId();
  return (
    <div className="showcase-anchor showcase-anchor-preview">
      <button
        type="button"
        className="showcase-trigger showcase-hotspot"
        data-showcase-trigger="preview"
        data-previewing={previewing ? 'true' : 'false'}
        aria-describedby={previewing ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHovered(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        // A tap (or click) pins the preview for touch input; it never touches playback.
        onClick={() => setPinned((value) => !value)}
      >
        {disclosure.label}
      </button>
      {previewing ? (
        <div id={id} role="tooltip" className="showcase-preview" data-showcase-preview="">
          <strong>{disclosure.title}</strong>
          <span>{disclosure.body}</span>
        </div>
      ) : null}
    </div>
  );
}

function Popover({ disclosure }: { disclosure: TimedDisclosure }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  return (
    <div className="showcase-anchor showcase-anchor-popover" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="showcase-trigger"
        data-showcase-trigger="popover"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {disclosure.label}
      </button>
      <div id={id} className="showcase-popover" data-showcase-popover="" role="note" hidden={!open}>
        <strong>{disclosure.title}</strong>
        <p>{disclosure.body}</p>
      </div>
    </div>
  );
}

function Accordion({ disclosure }: { disclosure: TimedDisclosure }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="showcase-anchor showcase-anchor-accordion">
      <button
        type="button"
        className="showcase-trigger"
        data-showcase-trigger="accordion"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {disclosure.label}
      </button>
      <div id={id} role="region" aria-label={disclosure.title} className="showcase-accordion-panel" data-showcase-accordion-panel="" hidden={!expanded}>
        <strong>{disclosure.title}</strong>
        <p>{disclosure.body}</p>
      </div>
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Dialog({ disclosure, pause }: { disclosure: TimedDisclosure; pause: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = () => {
    // Decision 1.6: a full modal pauses at the current position.
    pause();
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>('[data-showcase-close]')?.focus();
  };
  const close = () => {
    dialog.current?.close();
    button.current?.focus();
  };
  // Keep Tab inside the modal explicitly instead of relying on browser focus wrapping.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? focusable[(index <= 0 ? focusable.length : index) - 1]
      : focusable[(index + 1) % focusable.length];
    event.preventDefault();
    next.focus();
  };
  return (
    <div className="showcase-anchor showcase-anchor-dialog">
      <button ref={button} type="button" className="showcase-trigger" data-showcase-trigger="dialog" onClick={open}>
        {disclosure.label}
      </button>
      <dialog
        ref={dialog}
        className="showcase-dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          // Escape: close ourselves so focus returns to the trigger.
          event.preventDefault();
          close();
        }}
      >
        <h2 id={titleId}>{disclosure.title}</h2>
        <p>{disclosure.body}</p>
        <p className="showcase-dialog-hint">The video stays paused here; press Play to continue.</p>
        <button type="button" data-showcase-close="" onClick={close}>
          Close details
        </button>
      </dialog>
    </div>
  );
}

/** Builds the browser-only overlay for a showcase's timed disclosures. */
export function createShowcaseOverlay(disclosures: readonly TimedDisclosure[]) {
  return function ShowcaseOverlay({ player }: PlayerOverlayProps) {
    const frame = usePlayerFrame(player);
    const pause = () => player.current?.pause();
    const container = useRef<HTMLDivElement>(null);
    const lastFocused = useRef<HTMLElement | null>(null);
    const visible = disclosures.filter((disclosure) => frame >= disclosure.from && frame < disclosure.to);
    const visibleKey = visible.map((disclosure) => `${disclosure.kind}:${disclosure.sceneId}`).join('|');
    // When playback ends a scene whose control holds keyboard focus, hand focus to the player
    // region instead of letting it fall back to the document body.
    useLayoutEffect(() => {
      const focused = lastFocused.current;
      if (focused && !focused.isConnected) {
        lastFocused.current = null;
        if (document.activeElement === document.body || document.activeElement === null) {
          container.current?.closest<HTMLElement>('[data-composition-id]')?.focus({ preventScroll: true });
        }
      }
    }, [visibleKey]);
    return (
      <div
        ref={container}
        className="showcase-overlay"
        onFocusCapture={(event) => {
          lastFocused.current = event.target as HTMLElement;
        }}
      >
        {visible.map((disclosure) => {
            const key = `${disclosure.kind}:${disclosure.sceneId}`;
            switch (disclosure.kind) {
              case 'preview':
                return <Preview key={key} disclosure={disclosure} />;
              case 'popover':
                return <Popover key={key} disclosure={disclosure} />;
              case 'accordion':
                return <Accordion key={key} disclosure={disclosure} />;
              case 'dialog':
                return <Dialog key={key} disclosure={disclosure} pause={pause} />;
            }
          })}
      </div>
    );
  };
}
