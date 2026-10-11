// The Remotion render root: the only file that declares <Composition>s and the only registerRoot.
// It lists no projects of its own; every composition comes from the catalog the Player uses, so a
// headless render and the Player show the same resolved composition for a project id.
import type { ComponentType } from 'react';
import { Composition, registerRoot } from 'remotion';

import { catalog } from '@/projects';

/** Remotion composition ids allow letters, digits and "-"; other ids are refused before rendering. */
const COMPOSITION_ID = /^([a-zA-Z0-9-一-鿿])+$/;

function RenderRoot() {
  return (
    <>
      {catalog.projects.map(({ id }) => {
        const resolved = catalog.resolve(id);
        if (!resolved.ok || !COMPOSITION_ID.test(id)) return null;
        const { component, width, height, fps, durationInFrames } = resolved.composition;
        return (
          <Composition
            key={id}
            id={id}
            component={component as ComponentType<Record<string, unknown>>}
            width={width}
            height={height}
            fps={fps}
            durationInFrames={durationInFrames}
          />
        );
      })}
    </>
  );
}

registerRoot(RenderRoot);
