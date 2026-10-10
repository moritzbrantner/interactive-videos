// VideoSpec v1: a complete video's semantic intent as a small, validated data document.
//
// The spec says what a video shows and says: project identity, the format pack that renders it,
// the output profile, ordered scenes with narration, asset references and interaction metadata,
// and each scene kind's semantic payload. Layout pixels, easing, typography and renderer details
// belong to the selected format pack and are deliberately not representable here.
//
// v1 fails closed: unknown fields, unknown scene kinds and unsupported versions are errors, not
// ignored. This module is plain TypeScript with no React or Remotion dependency.

export const VIDEO_SPEC_VERSION = 1;

export type VideoSpec = {
  specVersion: typeof VIDEO_SPEC_VERSION;
  project: { id: string; title: string };
  /** The format pack that renders this spec, e.g. `moenarch-short-v1`. */
  format: { id: string; version: number };
  output: { width: number; height: number; fps: number };
  assets: AssetRef[];
  /** Played in order; each scene starts where the previous one ends. */
  scenes: Scene[];
};

export const ASSET_KINDS = ['dataset', 'image', 'audio', 'video'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type AssetRef = { id: string; kind: AssetKind; uri: string };

/** Times are milliseconds from the start of the scene. */
export type NarrationCue = { startMs: number; endMs: number; text: string };

export type Narration = { cues: NarrationCue[] };

/** A narration word the viewer can click to pause and read an explanation. */
export type TermHotspot = { id: string; term: string; title: string; body: string };

export type Interaction = { terms: TermHotspot[] };

type SceneBase = {
  id: string;
  durationInFrames: number;
  narration?: Narration;
  interaction?: Interaction;
};

export type TitleScene = SceneBase & {
  kind: 'title';
  payload: { eyebrow?: string; heading: string };
};

export const BIN_METRICS = ['p50', 'p95', 'p99'] as const;
export type BinMetric = (typeof BIN_METRICS)[number];

/** A dataset aggregated into bins and revealed bar by bar; bars can be inspected. */
export type BinnedChartScene = SceneBase & {
  kind: 'binnedChart';
  payload: {
    eyebrow?: string;
    heading: string;
    /** Id of a `dataset` asset. */
    dataset: string;
    bins: number;
    metric: BinMetric;
    /** Domain interval (in the dataset's x unit) the chart calls out. */
    highlight?: { from: number; to: number };
    /** Whether clicking a bar pauses the video and shows the bin's data. */
    inspectable: boolean;
  };
};

export type Scene = TitleScene | BinnedChartScene;
export type SceneKind = Scene['kind'];
export const SCENE_KINDS: readonly SceneKind[] = ['title', 'binnedChart'];

export type VideoSpecDiagnostic = { path: string; message: string };

export type VideoSpecParseResult =
  | { ok: true; spec: VideoSpec }
  | { ok: false; diagnostics: VideoSpecDiagnostic[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

/** Validates untrusted input (for example parsed JSON) and returns the normalized spec. */
export function parseVideoSpec(input: unknown): VideoSpecParseResult {
  const diagnostics: VideoSpecDiagnostic[] = [];
  const spec = readSpec(new Reader(diagnostics), input);
  return spec && diagnostics.length === 0
    ? { ok: true, spec: normalizeVideoSpec(spec) }
    : { ok: false, diagnostics };
}

/** Parses JSON text; syntax errors are reported as diagnostics too. */
export function parseVideoSpecJson(text: string): VideoSpecParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{ path: '$', message: `invalid JSON: ${(error as Error).message}` }],
    };
  }
  return parseVideoSpec(value);
}

/** Like `parseVideoSpec`, but throws one error listing every diagnostic. */
export function assertVideoSpec(input: unknown): VideoSpec {
  const result = parseVideoSpec(input);
  if (result.ok) return result.spec;
  throw new Error(
    `invalid VideoSpec:\n${result.diagnostics.map((d) => `  ${d.path}: ${d.message}`).join('\n')}`,
  );
}

/**
 * Canonical form: fixed key order, assets sorted by id, scenes/cues/terms in their given order
 * (order is meaning there). Identical specs normalize to identical data.
 */
export function normalizeVideoSpec(spec: VideoSpec): VideoSpec {
  return {
    specVersion: spec.specVersion,
    project: { id: spec.project.id, title: spec.project.title },
    format: { id: spec.format.id, version: spec.format.version },
    output: { width: spec.output.width, height: spec.output.height, fps: spec.output.fps },
    assets: [...spec.assets]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((asset) => ({ id: asset.id, kind: asset.kind, uri: asset.uri })),
    scenes: spec.scenes.map(normalizeScene),
  };
}

function normalizeScene(scene: Scene): Scene {
  const base = {
    id: scene.id,
    durationInFrames: scene.durationInFrames,
    ...(scene.narration
      ? {
          narration: {
            cues: scene.narration.cues.map((cue) => ({
              startMs: cue.startMs,
              endMs: cue.endMs,
              text: cue.text,
            })),
          },
        }
      : {}),
    ...(scene.interaction
      ? {
          interaction: {
            terms: scene.interaction.terms.map((term) => ({
              id: term.id,
              term: term.term,
              title: term.title,
              body: term.body,
            })),
          },
        }
      : {}),
  };
  if (scene.kind === 'title') {
    const { eyebrow, heading } = scene.payload;
    return {
      kind: 'title',
      ...base,
      payload: { ...(eyebrow !== undefined ? { eyebrow } : {}), heading },
    };
  }
  const { eyebrow, heading, dataset, bins, metric, highlight, inspectable } = scene.payload;
  return {
    kind: 'binnedChart',
    ...base,
    payload: {
      ...(eyebrow !== undefined ? { eyebrow } : {}),
      heading,
      dataset,
      bins,
      metric,
      ...(highlight ? { highlight: { from: highlight.from, to: highlight.to } } : {}),
      inspectable,
    },
  };
}

/** Deterministic JSON: the normalized spec, two-space indented, with a trailing newline. */
export function serializeVideoSpec(spec: VideoSpec): string {
  return `${JSON.stringify(normalizeVideoSpec(spec), null, 2)}\n`;
}

export type ResolvedScene = { id: string; kind: SceneKind; from: number; durationInFrames: number };

/** Project timing derived from the spec: where each scene starts and the total length. */
export function resolveTimeline(spec: VideoSpec) {
  let from = 0;
  const scenes: ResolvedScene[] = spec.scenes.map((scene) => {
    const resolved = { id: scene.id, kind: scene.kind, from, durationInFrames: scene.durationInFrames };
    from += scene.durationInFrames;
    return resolved;
  });
  return { durationInFrames: from, scenes };
}

/** Narration cues as SRT text, numbered from 1. */
export function narrationToSrt(narration: Narration): string {
  return narration.cues
    .map((cue, index) => `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}`)
    .join('\n\n');
}

function srtTime(ms: number) {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms % 1000, 3)}`;
}

// --- validation -------------------------------------------------------------------------------

type Json = Record<string, unknown>;

class Reader {
  constructor(readonly diagnostics: VideoSpecDiagnostic[]) {}

  error(path: string, message: string) {
    this.diagnostics.push({ path, message });
  }

  /** A plain object whose keys are all known; unknown keys are reported, not dropped silently. */
  object(value: unknown, path: string, required: string[], optional: string[] = []): Json | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.error(path, `expected an object, got ${describe(value)}`);
      return null;
    }
    const record = value as Json;
    for (const key of Object.keys(record)) {
      if (!required.includes(key) && !optional.includes(key)) {
        this.error(`${path}.${key}`, `unknown field; v1 allows ${[...required, ...optional].join(', ')}`);
      }
    }
    for (const key of required) {
      if (!(key in record)) this.error(`${path}.${key}`, 'missing required field');
    }
    return record;
  }

  array(value: unknown, path: string, { nonEmpty = false } = {}): unknown[] | null {
    if (!Array.isArray(value)) {
      if (value !== undefined) this.error(path, `expected an array, got ${describe(value)}`);
      return null;
    }
    if (nonEmpty && value.length === 0) this.error(path, 'must not be empty');
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string') {
      if (value !== undefined) this.error(path, `expected a string, got ${describe(value)}`);
      return '';
    }
    if (value.trim() === '') this.error(path, 'must not be blank');
    else if (value !== value.trim()) this.error(path, 'must not start or end with whitespace');
    return value;
  }

  id(value: unknown, path: string): string {
    const id = this.string(value, path);
    if (id && !ID_PATTERN.test(id)) {
      this.error(path, `"${id}" is not a valid id (lowercase letters, digits, ".", "_", ":", "-")`);
    }
    return id;
  }

  integer(value: unknown, path: string, { min = 0 } = {}): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      if (value !== undefined) this.error(path, `expected an integer, got ${describe(value)}`);
      return 0;
    }
    if (value < min) this.error(path, `must be at least ${min}`);
    return value;
  }

  number(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (value !== undefined) this.error(path, `expected a finite number, got ${describe(value)}`);
      return 0;
    }
    return value;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
      if (value !== undefined) this.error(path, `expected a boolean, got ${describe(value)}`);
      return false;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[], what: string): T {
    if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
      if (value !== undefined) {
        this.error(path, `unknown ${what} ${show(value)}; v1 supports ${options.join(', ')}`);
      }
      return options[0];
    }
    return value as T;
  }

  unique(ids: string[], path: (index: number) => string, what: string) {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (!id) return;
      if (seen.has(id)) this.error(path(index), `duplicate ${what} id "${id}"`);
      seen.add(id);
    });
  }
}

/** A value for a diagnostic; never throws (BigInt, cycles, symbols). */
function show(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text !== undefined) return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    // Fall through to the type description.
  }
  return typeof value === 'bigint' ? `${value}n` : describe(value);
}

function describe(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function readSpec(r: Reader, input: unknown): VideoSpec | null {
  // The version decides which fields exist, so it is read before any v1 field check: a document
  // of another version gets only the version diagnostic.
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const version = (input as Json).specVersion;
    if (version !== VIDEO_SPEC_VERSION) {
      r.error(
        '$.specVersion',
        version === undefined
          ? 'missing required field'
          : `unsupported specVersion ${show(version)}; this build reads ${VIDEO_SPEC_VERSION}`,
      );
      return null;
    }
  }
  const root = r.object(input, '$', ['specVersion', 'project', 'format', 'output', 'assets', 'scenes']);
  if (!root) return null;

  const project = r.object(root.project, '$.project', ['id', 'title']);
  const format = r.object(root.format, '$.format', ['id', 'version']);
  const output = r.object(root.output, '$.output', ['width', 'height', 'fps']);

  const assets = (r.array(root.assets, '$.assets') ?? []).map((value, index) => {
    const path = `$.assets[${index}]`;
    const asset = r.object(value, path, ['id', 'kind', 'uri']);
    return {
      id: r.id(asset?.id, `${path}.id`),
      kind: r.oneOf(asset?.kind, `${path}.kind`, ASSET_KINDS, 'asset kind'),
      uri: r.string(asset?.uri, `${path}.uri`),
    };
  });
  r.unique(assets.map((asset) => asset.id), (index) => `$.assets[${index}].id`, 'asset');

  const fps = r.integer(output?.fps, '$.output.fps', { min: 1 });
  const spec: VideoSpec = {
    specVersion: VIDEO_SPEC_VERSION,
    project: { id: r.id(project?.id, '$.project.id'), title: r.string(project?.title, '$.project.title') },
    format: {
      id: r.id(format?.id, '$.format.id'),
      version: r.integer(format?.version, '$.format.version', { min: 1 }),
    },
    output: {
      width: r.integer(output?.width, '$.output.width', { min: 1 }),
      height: r.integer(output?.height, '$.output.height', { min: 1 }),
      fps,
    },
    assets,
    scenes: [],
  };
  // Scenes that fail to parse are dropped, so later checks keep each scene's input index.
  const read = (r.array(root.scenes, '$.scenes', { nonEmpty: true }) ?? []).flatMap((value, index) => {
    const scene = readScene(r, value, `$.scenes[${index}]`, fps, assets);
    return scene ? [{ scene, index }] : [];
  });
  spec.scenes = read.map(({ scene }) => scene);
  r.unique(read.map(({ scene }) => scene.id), (position) => `$.scenes[${read[position].index}].id`, 'scene');
  const termIds = read.flatMap(({ scene, index }) =>
    (scene.interaction?.terms ?? []).map((term, termIndex) => ({
      id: term.id,
      path: `$.scenes[${index}].interaction.terms[${termIndex}].id`,
    })),
  );
  r.unique(termIds.map((term) => term.id), (position) => termIds[position].path, 'term');
  return spec;
}

const SCENE_FIELDS = ['id', 'kind', 'durationInFrames', 'payload'];
const SCENE_OPTIONAL_FIELDS = ['narration', 'interaction'];

function readScene(
  r: Reader,
  value: unknown,
  path: string,
  fps: number,
  assets: AssetRef[],
): Scene | null {
  const scene = r.object(value, path, SCENE_FIELDS, SCENE_OPTIONAL_FIELDS);
  if (!scene) return null;
  if (!(SCENE_KINDS as readonly unknown[]).includes(scene.kind)) {
    r.error(
      `${path}.kind`,
      `unknown scene kind ${show(scene.kind)}; v1 supports ${SCENE_KINDS.join(', ')}`,
    );
    return null;
  }
  const durationInFrames = r.integer(scene.durationInFrames, `${path}.durationInFrames`, { min: 1 });
  const durationMs = fps > 0 ? (durationInFrames / fps) * 1000 : Number.POSITIVE_INFINITY;
  const narration =
    scene.narration === undefined ? undefined : readNarration(r, scene.narration, `${path}.narration`, durationMs);
  const interaction =
    scene.interaction === undefined
      ? undefined
      : readInteraction(r, scene.interaction, `${path}.interaction`, narration);
  const base = {
    id: r.id(scene.id, `${path}.id`),
    durationInFrames,
    ...(narration ? { narration } : {}),
    ...(interaction ? { interaction } : {}),
  };
  const payloadPath = `${path}.payload`;

  if (scene.kind === 'title') {
    const payload = r.object(scene.payload, payloadPath, ['heading'], ['eyebrow']);
    return {
      kind: 'title',
      ...base,
      payload: {
        ...(payload?.eyebrow !== undefined ? { eyebrow: r.string(payload.eyebrow, `${payloadPath}.eyebrow`) } : {}),
        heading: r.string(payload?.heading, `${payloadPath}.heading`),
      },
    };
  }

  const payload = r.object(
    scene.payload,
    payloadPath,
    ['heading', 'dataset', 'bins', 'metric', 'inspectable'],
    ['eyebrow', 'highlight'],
  );
  const dataset = r.id(payload?.dataset, `${payloadPath}.dataset`);
  if (dataset) {
    const asset = assets.find((candidate) => candidate.id === dataset);
    if (!asset) r.error(`${payloadPath}.dataset`, `no asset with id "${dataset}"`);
    else if (asset.kind !== 'dataset') {
      r.error(
        `${payloadPath}.dataset`,
        `asset "${dataset}" is ${/^[aeiou]/.test(asset.kind) ? 'an' : 'a'} ${asset.kind} asset, not a dataset`,
      );
    }
  }
  let highlight: { from: number; to: number } | undefined;
  if (payload?.highlight !== undefined) {
    const record = r.object(payload.highlight, `${payloadPath}.highlight`, ['from', 'to']);
    highlight = {
      from: r.number(record?.from, `${payloadPath}.highlight.from`),
      to: r.number(record?.to, `${payloadPath}.highlight.to`),
    };
    if (record && highlight.to <= highlight.from) {
      r.error(`${payloadPath}.highlight`, '"to" must be greater than "from"');
    }
  }
  return {
    kind: 'binnedChart',
    ...base,
    payload: {
      ...(payload?.eyebrow !== undefined ? { eyebrow: r.string(payload.eyebrow, `${payloadPath}.eyebrow`) } : {}),
      heading: r.string(payload?.heading, `${payloadPath}.heading`),
      dataset,
      bins: r.integer(payload?.bins, `${payloadPath}.bins`, { min: 1 }),
      metric: r.oneOf(payload?.metric, `${payloadPath}.metric`, BIN_METRICS, 'metric'),
      ...(highlight ? { highlight } : {}),
      inspectable: r.boolean(payload?.inspectable, `${payloadPath}.inspectable`),
    },
  };
}

function readNarration(r: Reader, value: unknown, path: string, durationMs: number): Narration {
  const narration = r.object(value, path, ['cues']);
  const cues = (r.array(narration?.cues, `${path}.cues`, { nonEmpty: true }) ?? []).map((cueValue, index) => {
    const cuePath = `${path}.cues[${index}]`;
    const cue = r.object(cueValue, cuePath, ['startMs', 'endMs', 'text']);
    return {
      startMs: r.integer(cue?.startMs, `${cuePath}.startMs`),
      endMs: r.integer(cue?.endMs, `${cuePath}.endMs`),
      text: r.string(cue?.text, `${cuePath}.text`),
    };
  });
  cues.forEach((cue, index) => {
    // A blank line ends an SRT cue, so it would split this cue or inject another one.
    if (/\n[ \t]*\r?\n|\r[ \t]*\r/.test(cue.text)) {
      r.error(`${path}.cues[${index}].text`, 'must not contain a blank line');
    }
    // Subtitle parsers read tags and ASS overrides as formatting; narration is literal text.
    if (/<[^<>]*>|\{\\/.test(cue.text)) {
      r.error(`${path}.cues[${index}].text`, 'must not contain subtitle markup (<tag> or {\\…})');
    }
    // Subtitle parsers decode entity references, so "&amp;" would render as "&".
    if (/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(cue.text)) {
      r.error(`${path}.cues[${index}].text`, 'must not contain HTML entity references (&name;)');
    }
  });
  cues.forEach((cue, index) => {
    const cuePath = `${path}.cues[${index}]`;
    if (cue.endMs <= cue.startMs) r.error(cuePath, 'endMs must be greater than startMs');
    if (cue.endMs > durationMs) {
      r.error(`${cuePath}.endMs`, `ends after the scene (${Math.round(durationMs)} ms)`);
    }
    const previous = cues[index - 1];
    if (previous && cue.startMs < previous.endMs) {
      r.error(`${cuePath}.startMs`, 'cues must be in order and must not overlap');
    }
  });
  return { cues };
}

function readInteraction(
  r: Reader,
  value: unknown,
  path: string,
  narration: Narration | undefined,
): Interaction {
  const interaction = r.object(value, path, ['terms']);
  const seenTerms = new Map<string, number>();
  const terms = (r.array(interaction?.terms, `${path}.terms`) ?? []).map((termValue, index) => {
    const termPath = `${path}.terms[${index}]`;
    const term = r.object(termValue, termPath, ['id', 'term', 'title', 'body']);
    const parsed = {
      id: r.id(term?.id, `${termPath}.id`),
      term: r.string(term?.term, `${termPath}.term`),
      title: r.string(term?.title, `${termPath}.title`),
      body: r.string(term?.body, `${termPath}.body`),
    };
    if (parsed.term) {
      // The subtitle hotspot matcher indexes terms case-insensitively, so a second entry for the
      // same term would make the first unreachable.
      const key = parsed.term.toLocaleLowerCase();
      const first = seenTerms.get(key);
      if (first !== undefined) {
        r.error(`${termPath}.term`, `"${parsed.term}" is already defined by terms[${first}]`);
      } else {
        seenTerms.set(key, index);
      }
    }
    return parsed;
  });
  // Matched like the subtitle hotspot matcher: all terms at once, longest first, so a term whose
  // only occurrences sit inside a longer term's match is unreachable.
  const reachable = matchedTerms(
    (narration?.cues ?? []).map((cue) => cue.text),
    terms.map((term) => term.term),
  );
  terms.forEach((term, index) => {
    if (term.term && !reachable.has(term.term.toLocaleLowerCase())) {
      r.error(
        `${path}.terms[${index}].term`,
        `"${term.term}" does not occur in this scene's narration outside a longer term`,
      );
    }
  });
  return { terms };
}

/**
 * Lowercased terms the subtitle hotspot matcher would link in `texts`: whole-term,
 * case-insensitive, longest alternative first, with its letter/digit boundaries.
 */
function matchedTerms(texts: string[], terms: string[]) {
  const candidates = [...new Set(terms.filter((term) => term.trim()))].sort((a, b) => b.length - a.length);
  const matched = new Set<string>();
  if (!candidates.length) return matched;
  const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${candidates.map(escape).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) matched.add(match[0].toLocaleLowerCase());
  }
  return matched;
}
