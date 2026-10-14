import { Player, type PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import type { Catalog, ResolvedComposition } from '@/catalog/catalog';
import type { HotspotActivation } from '@/components/remotion/hotspot';
import { catalog as defaultCatalog } from '@/projects';
import { focusFirstHotspot, HotspotDebug } from '@/player/hotspot-debug';
import { exposePlayerForBudgetTests } from '@/render-budget';

const PROJECT_PARAM = 'project';

// Native controls and hotspot primitives own their Space behavior, including descendant icons.
function ownsKeyboardAction(target: EventTarget): boolean {
  return target instanceof Element && target.closest(
    'button, input, textarea, select, summary, a[href], [contenteditable]:not([contenteditable="false"]), '
    + '[role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], '
    + '[role="textbox"], [role="combobox"], [role="spinbutton"], [role="menuitem"], '
    + '[role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"]',
  ) !== null;
}

function projectIdFromLocation(fallback: string) {
  return new URLSearchParams(window.location.search).get(PROJECT_PARAM) ?? fallback;
}

function projectHref(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(PROJECT_PARAM, id);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The selected project id is URL state: links push it, and back/forward restore it. */
function useProjectId(fallback: string) {
  const [id, setId] = useState(() => projectIdFromLocation(fallback));
  useEffect(() => {
    const restore = () => setId(projectIdFromLocation(fallback));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [fallback]);
  const open = useCallback((next: string) => {
    window.history.pushState(null, '', projectHref(next));
    setId(next);
  }, []);
  return [id, open] as const;
}

function ProjectNav({
  catalog,
  currentId,
  onOpen,
}: {
  catalog: Catalog;
  currentId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <nav aria-label="Projects" className="projects">
      <ul>
        {catalog.projects.map((project) => (
          <li key={project.id}>
            <a
              href={projectHref(project.id)}
              aria-current={project.id === currentId ? 'page' : undefined}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                // Let modified clicks open a new tab or window as usual.
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (project.id !== currentId) onOpen(project.id);
              }}
            >
              {project.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ProjectView({ composition }: { composition: ResolvedComposition }) {
  const player = useRef<PlayerRef>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [activation, setActivation] = useState<HotspotActivation>();
  const [playing, setPlaying] = useState(false);
  const [focusHint, setFocusHint] = useState<string>();
  const [debugMode, setDebugMode] = useState(
    () => new URLSearchParams(window.location.search).get('debug') === 'hotspots',
  );
  const { renderInsight } = composition;

  const onActivate = useCallback((next: HotspotActivation) => {
    player.current?.pause();
    setActivation(next);
  }, []);

  const resume = useCallback(() => {
    setActivation(undefined);
    player.current?.play();
  }, []);

  useEffect(() => {
    const current = player.current;
    exposePlayerForBudgetTests(current);
    if (!current) return;
    const onPlay = () => {
      setPlaying(true);
      setActivation(undefined);
    };
    const onPause = () => setPlaying(false);
    current.addEventListener('play', onPlay);
    current.addEventListener('pause', onPause);
    current.addEventListener('ended', onPause);
    return () => {
      current.removeEventListener('play', onPlay);
      current.removeEventListener('pause', onPause);
      current.removeEventListener('ended', onPause);
    };
  }, []);

  useEffect(() => {
    const restore = () => setDebugMode(new URLSearchParams(window.location.search).get('debug') === 'hotspots');
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const changeDebugMode = (enabled: boolean) => {
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('debug', 'hotspots');
    else url.searchParams.delete('debug');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    setDebugMode(enabled);
  };

  const togglePlayback = () => {
    if (playing) player.current?.pause();
    else player.current?.play();
  };

  const focusClickable = () => {
    player.current?.pause();
    setFocusHint(
      focusFirstHotspot(frame.current) ? undefined : 'No clickable elements at this frame. Play or seek forward.',
    );
  };

  const inputProps = useMemo(
    () => (renderInsight ? { onActivate, selectedId: activation?.id } : {}),
    [renderInsight, onActivate, activation?.id],
  );

  const { width, height, fps, durationInFrames } = composition;

  return (
    <section className={renderInsight ? 'stage' : 'stage stage-solo'}>
      <div className="player-column">
        <div className="player-toolbar" role="group" aria-label="Video controls">
          <button type="button" onClick={togglePlayback} aria-label={playing ? 'Pause video' : 'Play video'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={focusClickable}>Focus first clickable</button>
          <label className="developer-toggle">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(event) => changeDebugMode(event.target.checked)}
            />
            Developer mode
          </label>
        </div>
        {focusHint ? <p className="focus-hint" role="status">{focusHint}</p> : null}
        <div
          ref={frame}
          className="player-frame"
          role="region"
          aria-label="Video player"
          tabIndex={0}
          onPointerDown={(event) => {
            if (!ownsKeyboardAction(event.target)) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onKeyDown={(event) => {
            if (
              (event.code !== 'Space' && event.key !== ' ')
              || event.defaultPrevented
              || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
              || ownsKeyboardAction(event.target)
            ) {
              return;
            }
            event.preventDefault();
            if (!event.repeat) {
              togglePlayback();
            }
          }}
          data-composition-id={composition.id}
          data-width={width}
          data-height={height}
          data-fps={fps}
          data-duration-in-frames={durationInFrames}
          onFocusCapture={(event) => {
            // Freeze the current frame before Tab navigation or keyboard activation can lose its target.
            if ((event.target as Element).matches('button[data-hotspot], [data-hotspot][role="button"]')) {
              player.current?.pause();
            }
          }}
          style={{
            aspectRatio: `${width} / ${height}`,
            // Fit the frame inside the column and a share of the viewport height.
            width: `min(100%, calc(80vh * ${width} / ${height}))`,
          }}
        >
          <Player
            ref={player}
            component={composition.component}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            controls
            clickToPlay={false}
            spaceKeyToPlayOrPause={false}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        {debugMode ? <HotspotDebug frame={frame} player={player} /> : null}
        <p className="keyboard-help">
          Space in the video: play / pause · Tab / Shift+Tab: navigate clickable elements · Enter / Space on an item: inspect
        </p>
      </div>
      {renderInsight ? (
        <aside className="insight" aria-live="polite">
          {activation ? (
            <>
              <p className="eyebrow">paused at {(activation.frame / fps).toFixed(1)} s</p>
              {renderInsight(activation)}
              <button type="button" onClick={resume}>
                Resume
              </button>
            </>
          ) : (
            <p className="empty">Nothing selected yet.</p>
          )}
        </aside>
      ) : null}
    </section>
  );
}

export function App({ catalog = defaultCatalog }: { catalog?: Catalog }) {
  const [projectId, openProject] = useProjectId(catalog.defaultId);
  const result = catalog.resolve(projectId);
  const title = result.ok ? result.composition.title : 'Project not available';

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <main className="shell">
      <ProjectNav catalog={catalog} currentId={projectId} onOpen={openProject} />
      <header>
        <p className="eyebrow">interactive video · charts + remotion-primitives + tables</p>
        <h1>{title}</h1>
        {result.ok && result.composition.renderInsight ? (
          <p className="lede">
            Play the video, then click a bar or an underlined word. The video pauses and the panel shows
            the data behind it.
          </p>
        ) : null}
      </header>
      {result.ok ? (
        // A new project gets a fresh Player and selection state.
        <ProjectView key={result.composition.id} composition={result.composition} />
      ) : (
        <p role="alert" className="error">
          {result.message}
        </p>
      )}
    </main>
  );
}
