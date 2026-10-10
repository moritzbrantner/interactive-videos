import type { ComponentType, ReactNode } from 'react';

import type { HotspotActivation } from '@/components/remotion/hotspot';
import { assertVideoSpec, resolveTimeline, type VideoSpec } from '@/spec/video-spec';

/** Props every catalog composition accepts; formats without hotspots ignore them. */
export type CompositionProps = {
  onActivate?: (activation: HotspotActivation) => void;
  selectedId?: string;
};

/** What a format pack makes of one spec: the component and optional interaction UI. */
export type FormatRendering = {
  component: ComponentType<CompositionProps>;
  /** Present when the composition has hotspots; renders the panel for an activation. */
  renderInsight?: (activation: HotspotActivation) => ReactNode;
};

/**
 * Reusable rendering code for one format id and version. `compose` throws when a valid spec
 * asks for something this format cannot render.
 */
export type FormatPack = {
  id: string;
  version: number;
  compose: (spec: VideoSpec) => FormatRendering;
};

/** A catalog entry: project content (an unvalidated spec) and the format pack that renders it. */
export type ProjectSource = { spec: unknown; format: FormatPack };

/** A spec resolved into everything the Player needs. */
export type ResolvedComposition = FormatRendering & {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export type ResolveError =
  | { reason: 'unknown-project'; id: string; message: string }
  | { reason: 'format-mismatch'; id: string; message: string }
  | { reason: 'unrenderable'; id: string; message: string };

export type ResolveResult = { ok: true; composition: ResolvedComposition } | ({ ok: false } & ResolveError);

export type ProjectSummary = { id: string; title: string };

export type Catalog = {
  /** Projects in catalog order. */
  projects: readonly ProjectSummary[];
  defaultId: string;
  resolve: (id: string) => ResolveResult;
};

/**
 * Builds a catalog keyed by each spec's stable project id. Specs are validated here, so a broken
 * fixture fails at startup instead of when its project is opened. Compositions are resolved on
 * first use and cached, so a project's component identity is stable across renders.
 */
export function createCatalog(sources: readonly ProjectSource[], defaultId: string): Catalog {
  const entries = new Map<string, { spec: VideoSpec; format: FormatPack }>();
  for (const source of sources) {
    const spec = assertVideoSpec(source.spec);
    if (entries.has(spec.project.id)) throw new Error(`duplicate project id "${spec.project.id}"`);
    entries.set(spec.project.id, { spec, format: source.format });
  }
  if (!entries.has(defaultId)) throw new Error(`default project "${defaultId}" is not in the catalog`);

  const cache = new Map<string, ResolveResult>();
  const resolve = (id: string): ResolveResult => {
    const cached = cache.get(id);
    if (cached) return cached;
    const entry = entries.get(id);
    // Unknown ids are not cached: the URL can hold anything.
    if (!entry) return { ok: false, reason: 'unknown-project', id, message: `No project with id "${id}".` };
    const result = resolveEntry(id, entry.spec, entry.format);
    cache.set(id, result);
    return result;
  };

  return {
    projects: [...entries.values()].map(({ spec }) => ({ id: spec.project.id, title: spec.project.title })),
    defaultId,
    resolve,
  };
}

function resolveEntry(id: string, spec: VideoSpec, format: FormatPack): ResolveResult {
  if (spec.format.id !== format.id || spec.format.version !== format.version) {
    return {
      ok: false,
      reason: 'format-mismatch',
      id,
      message: `Project "${id}" targets format ${spec.format.id} v${spec.format.version}, but is registered with ${format.id} v${format.version}.`,
    };
  }
  let rendering: FormatRendering;
  try {
    rendering = format.compose(spec);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'unrenderable', id, message: `Project "${id}" cannot be rendered: ${detail}` };
  }
  return {
    ok: true,
    composition: {
      ...rendering,
      id,
      title: spec.project.title,
      width: spec.output.width,
      height: spec.output.height,
      fps: spec.output.fps,
      durationInFrames: resolveTimeline(spec).durationInFrames,
    },
  };
}
