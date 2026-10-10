import { Player, type PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import type { Catalog, ResolvedComposition } from '@/catalog/catalog';
import type { HotspotActivation } from '@/components/remotion/hotspot';
import { catalog as defaultCatalog } from '@/projects';
import { exposePlayerForBudgetTests } from '@/render-budget';

const PROJECT_PARAM = 'project';

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
  const [activation, setActivation] = useState<HotspotActivation>();
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
    const dismiss = () => setActivation(undefined);
    current.addEventListener('play', dismiss);
    return () => current.removeEventListener('play', dismiss);
  }, []);

  const inputProps = useMemo(
    () => (renderInsight ? { onActivate, selectedId: activation?.id } : {}),
    [renderInsight, onActivate, activation?.id],
  );

  const { width, height, fps, durationInFrames } = composition;

  return (
    <section className={renderInsight ? 'stage' : 'stage stage-solo'}>
      <div
        className="player-frame"
        data-composition-id={composition.id}
        data-width={width}
        data-height={height}
        data-fps={fps}
        data-duration-in-frames={durationInFrames}
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
          style={{ width: '100%', height: '100%' }}
        />
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
