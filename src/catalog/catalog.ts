import type { ComponentType, ReactNode, RefObject } from 'react';

import type { PlayerRef } from '@remotion/player';

import type { HotspotActivation } from '@/components/remotion/hotspot';
import { translationTextByCue, validateSubtitleTranslation } from '@/spec/subtitle-translation';
import { assertVideoSpec, resolveTimeline, type VideoSpec } from '@/spec/video-spec';

/** Props every catalog composition accepts; formats without hotspots ignore them. */
export type CompositionProps = {
  onActivate?: (activation: HotspotActivation) => void;
  selectedId?: string;
  /**
   * The subtitle track the Player selected (#82): `null` hides subtitles, a language shows the
   * cues tagged with it. Omitted (headless renders) keeps the format's default, burned-in track.
   * `text` (#84) is a validated translation's cue text keyed `${sceneId}#${cueIndex}`, shown over
   * the English cue windows; without it the spec's own (English) cue text is shown.
   */
  subtitles?: { language: string; text?: SubtitleCueText } | null;
};

/** Translated cue text keyed `${sceneId}#${cueIndex}` (#84). */
export type SubtitleCueText = Readonly<Record<string, string>>;

/**
 * A selectable subtitle track of a project: the narration cues in one language (Atlas 3.10).
 * `text` is present for a validated translation (#84); without it the track is the spec's cues.
 */
export type SubtitleTrackOption = { language: string; label: string; text?: SubtitleCueText };

/**
 * A registered subtitle track. Without `translation` it is the spec's own (English) cues; with
 * one, the parsed `interactive-videos/council-subtitles` file, validated against the spec when the
 * catalog is built. An invalid translation is never offered (Atlas 3.12).
 */
export type SubtitleTrackSource = { language: string; label: string; translation?: unknown };

/** What a format pack makes of one spec: the component and optional interaction UI. */
export type FormatRendering = {
  component: ComponentType<CompositionProps>;
  /** Present when the composition has hotspots; renders the panel for an activation. */
  renderInsight?: (activation: HotspotActivation) => ReactNode;
  /**
   * Browser-only disclosures layered over the Player (hover previews, popovers, dialogs).
   * They live at the Player boundary, never inside the composition, so headless frames stay
   * deterministic and renderable without UI state.
   */
  Overlay?: ComponentType<PlayerOverlayProps>;
};

/** What a Player overlay receives: the live Player handle for frame and playback state. */
export type PlayerOverlayProps = {
  player: RefObject<PlayerRef | null>;
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

/**
 * A catalog entry: project content (an unvalidated spec) and the format pack that renders it.
 * `chapters` opts a multi-scene project into Player chapter navigation (Atlas 1.8).
 */
export type ProjectSource = {
  spec: unknown;
  format: FormatPack;
  chapters?: boolean;
  /**
   * Subtitle tracks the Player offers in its "Subtitles" select, first one selected (#82). The
   * format must honour `CompositionProps.subtitles`; the spec's narration cues are the English
   * track, and other languages carry a `translation` (#84).
   */
  subtitles?: readonly SubtitleTrackSource[];
  /** Short notes shown next to the Player, e.g. the synthetic-narration disclosure (Atlas 3.22). */
  notes?: readonly string[];
};

/**
 * One navigable chapter: a scene of the validated timeline. `relatedId` names another chapter
 * the viewer can jump to from this one. Browser-only; never part of rendered frames.
 */
export type Chapter = {
  id: string;
  title: string;
  from: number;
  durationInFrames: number;
  relatedId?: string;
};

/** A spec resolved into everything the Player needs. */
export type ResolvedComposition = FormatRendering & {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Present only for projects with meaningful chapters. */
  chapters?: readonly Chapter[];
  /** Present only for projects with selectable subtitle tracks. */
  subtitles?: readonly SubtitleTrackOption[];
  notes?: readonly string[];
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
  /** The validated, normalized spec registered under `id`, or undefined for an unknown id. */
  spec: (id: string) => VideoSpec | undefined;
};

/**
 * Builds a catalog keyed by each spec's stable project id. Specs are validated here, so a broken
 * fixture fails at startup instead of when its project is opened. Compositions are resolved on
 * first use and cached, so a project's component identity is stable across renders.
 */
export function createCatalog(sources: readonly ProjectSource[], defaultId: string): Catalog {
  type Entry = { spec: VideoSpec; format: FormatPack; chapters: boolean; subtitles?: readonly SubtitleTrackOption[]; notes?: readonly string[] };
  const entries = new Map<string, Entry>();
  for (const source of sources) {
    const spec = assertVideoSpec(source.spec);
    if (entries.has(spec.project.id)) throw new Error(`duplicate project id "${spec.project.id}"`);
    const subtitles = source.subtitles?.length ? subtitleTracks(spec, source.subtitles) : [];
    entries.set(spec.project.id, {
      spec,
      format: source.format,
      chapters: source.chapters ?? false,
      ...(subtitles.length ? { subtitles } : {}),
      ...(source.notes?.length ? { notes: [...source.notes] } : {}),
    });
  }
  if (!entries.has(defaultId)) throw new Error(`default project "${defaultId}" is not in the catalog`);

  const cache = new Map<string, ResolveResult>();
  const resolve = (id: string): ResolveResult => {
    const cached = cache.get(id);
    if (cached) return cached;
    const entry = entries.get(id);
    // Unknown ids are not cached: the URL can hold anything.
    if (!entry) return { ok: false, reason: 'unknown-project', id, message: `No project with id "${id}".` };
    const result = resolveEntry(id, entry);
    cache.set(id, result);
    return result;
  };

  return {
    projects: [...entries.values()].map(({ spec }) => ({ id: spec.project.id, title: spec.project.title })),
    defaultId,
    resolve,
    spec: (id) => entries.get(id)?.spec,
  };
}

/** The spec's own narration cues are English (Atlas 3.10); every other track needs a translation. */
const SPEC_CUE_LANGUAGE = 'en';

/**
 * The tracks to offer: the spec's own English cues as registered, and each translation that
 * validates against the spec in the language it is registered under. Anything else is left out, so
 * a missing or broken translation never appears as a valid track.
 */
function subtitleTracks(spec: VideoSpec, sources: readonly SubtitleTrackSource[]): SubtitleTrackOption[] {
  const tracks: SubtitleTrackOption[] = [];
  for (const source of sources) {
    if (source.translation === undefined) {
      if (source.language === SPEC_CUE_LANGUAGE) tracks.push({ language: source.language, label: source.label });
      continue;
    }
    const result = validateSubtitleTranslation(spec, source.translation);
    if (!result.ok || result.translation.language !== source.language) continue;
    tracks.push({ language: source.language, label: source.label, text: Object.fromEntries(translationTextByCue(result.translation)) });
  }
  return tracks;
}

/** The scene's own headline, used as its chapter title; undefined when it has none. */
function sceneHeadline(scene: VideoSpec['scenes'][number]): string | undefined {
  const payload = scene.payload as { heading?: unknown; text?: unknown };
  const headline = typeof payload.heading === 'string' ? payload.heading : payload.text;
  return typeof headline === 'string' && headline.trim() !== '' ? headline : undefined;
}

/**
 * Chapters derived from the validated timeline, one per scene, titled by the scene headline.
 * The opening relates to the conclusion. A project without at least two titled scenes has no
 * meaningful chapters.
 */
export function chaptersFor(spec: VideoSpec): Chapter[] | undefined {
  const timeline = resolveTimeline(spec);
  const titles = spec.scenes.map(sceneHeadline);
  if (timeline.scenes.length < 2 || titles.some((title) => title === undefined)) return undefined;
  const conclusion = [...timeline.scenes].reverse().find((scene) => scene.kind === 'conclusion');
  return timeline.scenes.map((scene, index) => ({
    id: scene.id,
    title: titles[index] as string,
    from: scene.from,
    durationInFrames: scene.durationInFrames,
    ...(index === 0 && conclusion && conclusion.id !== scene.id ? { relatedId: conclusion.id } : {}),
  }));
}

function resolveEntry(
  id: string,
  { spec, format, chapters, subtitles, notes }: { spec: VideoSpec; format: FormatPack; chapters: boolean; subtitles?: readonly SubtitleTrackOption[]; notes?: readonly string[] },
): ResolveResult {
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
      ...(chapters ? { chapters: chaptersFor(spec) } : {}),
      ...(subtitles ? { subtitles } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}
