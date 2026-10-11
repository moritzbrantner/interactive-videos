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

/**
 * Times are milliseconds on the narration clock: from the first sample of the narration audio
 * when the scene has audio, otherwise from the start of the scene.
 */
export type NarrationCue = { startMs: number; endMs: number; text: string };

/** Pre-recorded narration: an `audio` asset and its declared length (never measured at render time). */
export type NarrationAudio = { asset: string; durationMs: number };

/** Silence inserted into the narration audio at `atMs` (audio clock), between cues. */
export type NarrationHold = { atMs: number; durationMs: number };

/** A semantic cue: a named point in the narration that scene state can change at. */
export type NarrationMark = { id: string; atMs: number };

export type Narration = {
  audio?: NarrationAudio;
  /** Silence before the audio starts; requires audio. */
  leadInMs?: number;
  /** Silence after the audio ends; requires audio. */
  leadOutMs?: number;
  holds?: NarrationHold[];
  /** Sentence cues: the subtitles. */
  cues: NarrationCue[];
  /** Word cues: one word each, in order, each inside a sentence cue. */
  words?: NarrationCue[];
  marks?: NarrationMark[];
};

/** A narration word the viewer can click to pause and read an explanation. */
export type TermHotspot = { id: string; term: string; title: string; body: string };

export type Interaction = { terms: TermHotspot[] };

type SceneBase = {
  id: string;
  /**
   * The scene length. Required without narration audio; omitted with it, because the narration
   * then sets the length (see `sceneDurationInFrames`).
   */
  durationInFrames?: number;
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

// Editorial scene archetypes. Payloads are semantic: what the scene says, never how it looks.

/** A statement or emphasis; `emphasis` is a phrase that occurs verbatim in `text`. */
export type StatementScene = SceneBase & {
  kind: 'statement';
  payload: { eyebrow?: string; text: string; emphasis?: string };
};

/** An illustration revealed full frame; `image` is the id of an `image` asset. */
export type MediaRevealScene = SceneBase & {
  kind: 'mediaReveal';
  payload: { image: string; alt: string; caption?: string };
};

export type ComparisonItem = { label: string; detail: string };

/** Two sides compared; exactly two items. */
export type ComparisonScene = SceneBase & {
  kind: 'comparison';
  payload: { heading?: string; items: ComparisonItem[] };
};

/** A quote or callout. */
export type QuoteScene = SceneBase & {
  kind: 'quote';
  payload: { text: string; attribution?: string };
};

/** One figure with its meaning; `value` is the display figure as text, e.g. "200,000". */
export type DataPointScene = SceneBase & {
  kind: 'dataPoint';
  payload: { value: string; label: string; context?: string };
};

/** A list; `ordered` marks a progression. */
export type ListScene = SceneBase & {
  kind: 'list';
  payload: { heading?: string; items: string[]; ordered: boolean };
};

/** The conclusion or outro. */
export type ConclusionScene = SceneBase & {
  kind: 'conclusion';
  payload: { heading: string; takeaway?: string };
};

export type Scene =
  | TitleScene
  | BinnedChartScene
  | StatementScene
  | MediaRevealScene
  | ComparisonScene
  | QuoteScene
  | DataPointScene
  | ListScene
  | ConclusionScene;
export type SceneKind = Scene['kind'];
export const SCENE_KINDS: readonly SceneKind[] = [
  'title',
  'binnedChart',
  'statement',
  'mediaReveal',
  'comparison',
  'quote',
  'dataPoint',
  'list',
  'conclusion',
];

export type VideoSpecDiagnostic = { path: string; message: string };

export type VideoSpecParseResult =
  | { ok: true; spec: VideoSpec }
  | { ok: false; diagnostics: VideoSpecDiagnostic[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

/**
 * Validates untrusted input and returns the normalized spec. The input is data: parsed JSON or
 * plain objects and arrays. It is read once as own data properties (accessors, hidden and extra
 * keys are diagnostics). A Proxy defines its own reflection and can misreport its keys; there is
 * no portable way to detect one, so proxies are outside this contract. Parse JSON text with
 * `parseVideoSpecJson` when the source is not trusted to be plain data.
 */
export function parseVideoSpec(input: unknown): VideoSpecParseResult {
  const diagnostics: VideoSpecDiagnostic[] = [];
  let spec: VideoSpec | null;
  try {
    // Validation reads a plain-data snapshot, so getters, hidden keys and proxies cannot change
    // or hide values between checks.
    const data = snapshot(input, '$', diagnostics);
    if (diagnostics.length) return { ok: false, diagnostics };
    spec = readSpec(new Reader(diagnostics), data);
  } catch (error) {
    // Programmatic input can throw while being read (getters, proxies); that is invalid input.
    return {
      ok: false,
      diagnostics: [...diagnostics, { path: '$', message: `could not read input: ${errorMessage(error)}` }],
    };
  }
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
    ...(scene.durationInFrames !== undefined ? { durationInFrames: scene.durationInFrames } : {}),
    ...(scene.narration ? { narration: normalizeNarration(scene.narration) } : {}),
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
  return { kind: scene.kind, ...base, payload: normalizePayload(scene) } as Scene;
}

/** Canonical narration key order; optional fields only when present. */
function normalizeNarration(narration: Narration): Narration {
  const cue = (c: NarrationCue) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text });
  const { audio, leadInMs, leadOutMs, holds, cues, words, marks } = narration;
  return {
    ...(audio ? { audio: { asset: audio.asset, durationMs: audio.durationMs } } : {}),
    ...(leadInMs !== undefined ? { leadInMs } : {}),
    ...(leadOutMs !== undefined ? { leadOutMs } : {}),
    ...(holds ? { holds: holds.map((hold) => ({ atMs: hold.atMs, durationMs: hold.durationMs })) } : {}),
    cues: cues.map(cue),
    ...(words ? { words: words.map(cue) } : {}),
    ...(marks ? { marks: marks.map((mark) => ({ id: mark.id, atMs: mark.atMs })) } : {}),
  };
}

/** Canonical payload key order per kind; optional fields only when present. */
function normalizePayload(scene: Scene): Scene['payload'] {
  const optional = <K extends string, V>(key: K, value: V | undefined) =>
    (value !== undefined ? { [key]: value } : {}) as Partial<Record<K, V>>;
  switch (scene.kind) {
    case 'title': {
      const { eyebrow, heading } = scene.payload;
      return { ...optional('eyebrow', eyebrow), heading };
    }
    case 'binnedChart': {
      const { eyebrow, heading, dataset, bins, metric, highlight, inspectable } = scene.payload;
      return {
        ...optional('eyebrow', eyebrow),
        heading,
        dataset,
        bins,
        metric,
        ...(highlight ? { highlight: { from: highlight.from, to: highlight.to } } : {}),
        inspectable,
      };
    }
    case 'statement': {
      const { eyebrow, text, emphasis } = scene.payload;
      return { ...optional('eyebrow', eyebrow), text, ...optional('emphasis', emphasis) };
    }
    case 'mediaReveal': {
      const { image, alt, caption } = scene.payload;
      return { image, alt, ...optional('caption', caption) };
    }
    case 'comparison': {
      const { heading, items } = scene.payload;
      return { ...optional('heading', heading), items: items.map((item) => ({ label: item.label, detail: item.detail })) };
    }
    case 'quote': {
      const { text, attribution } = scene.payload;
      return { text, ...optional('attribution', attribution) };
    }
    case 'dataPoint': {
      const { value, label, context } = scene.payload;
      return { value, label, ...optional('context', context) };
    }
    case 'list': {
      const { heading, items, ordered } = scene.payload;
      return { ...optional('heading', heading), items: [...items], ordered };
    }
    case 'conclusion': {
      const { heading, takeaway } = scene.payload;
      return { heading, ...optional('takeaway', takeaway) };
    }
  }
}

/** Deterministic JSON: the normalized spec, two-space indented, with a trailing newline. */
export function serializeVideoSpec(spec: VideoSpec): string {
  return `${JSON.stringify(normalizeVideoSpec(spec), null, 2)}\n`;
}

export type ResolvedScene = { id: string; kind: SceneKind; from: number; durationInFrames: number };

/**
 * The first frame whose sample time is at or after `ms`: ceil(ms * fps / 1000). Narration times
 * map to frames with this one rule (see narration-schedule.ts).
 */
export function frameOfMs(ms: number, fps: number): number {
  // `|| 0` keeps -0 (from ceil of a small negative) out of the data.
  return Math.ceil((ms * fps) / 1000) || 0;
}

/** Frame lengths of a narrated scene's parts: lead-in | audio (split by holds) | lead-out. */
export function narrationAudioFrames(narration: Narration & { audio: NarrationAudio }, fps: number) {
  const leadIn = frameOfMs(narration.leadInMs ?? 0, fps);
  const audio = frameOfMs(narration.audio.durationMs, fps);
  const holds = (narration.holds ?? []).map((hold) => ({ cut: frameOfMs(hold.atMs, fps), length: frameOfMs(hold.durationMs, fps) }));
  const leadOut = frameOfMs(narration.leadOutMs ?? 0, fps);
  const total = leadIn + audio + holds.reduce((sum, hold) => sum + hold.length, 0) + leadOut;
  return { leadIn, audio, holds, leadOut, total };
}

/**
 * A scene's length in frames: from its narration when the narration has audio, otherwise its
 * explicit `durationInFrames`. There is exactly one source per scene.
 */
export function sceneDurationInFrames(scene: Scene, fps: number): number {
  const narration = scene.narration;
  if (narration?.audio) return narrationAudioFrames(narration as Narration & { audio: NarrationAudio }, fps).total;
  return scene.durationInFrames ?? 0;
}

/** Project timing derived from the spec: where each scene starts and the total length. */
export function resolveTimeline(spec: VideoSpec) {
  let from = 0;
  const scenes: ResolvedScene[] = spec.scenes.map((scene) => {
    const durationInFrames = sceneDurationInFrames(scene, spec.output.fps);
    const resolved = { id: scene.id, kind: scene.kind, from, durationInFrames };
    from += durationInFrames;
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
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      this.error(path, 'expected a plain object');
      return null;
    }
    const record = value as Json;
    for (const key of Object.keys(record)) {
      if (!required.includes(key) && !optional.includes(key)) {
        this.error(`${path}.${key}`, `unknown field; v1 allows ${[...required, ...optional].join(', ')}`);
      }
    }
    for (const key of required) {
      // An explicit undefined (programmatic input) is as missing as an absent key.
      if (!Object.hasOwn(record, key) || record[key] === undefined) {
        this.error(`${path}.${key}`, 'missing required field');
      }
    }
    return record;
  }

  array(value: unknown, path: string, { nonEmpty = false } = {}): unknown[] | null {
    if (!Array.isArray(value)) {
      if (value !== undefined) this.error(path, `expected an array, got ${describe(value)}`);
      return null;
    }
    if (nonEmpty && value.length === 0) this.error(path, 'must not be empty');
    // Holes of a sparse array become undefined elements, which then fail their own checks.
    return Array.from(value);
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
    // Larger integers do not survive JSON round trips or timeline sums exactly.
    if (!Number.isSafeInteger(value)) {
      this.error(path, 'must be a safe integer (at most 2^53 - 1)');
      return 0;
    }
    if (value < min) this.error(path, `must be at least ${min}`);
    // -0 would serialize as 0, so the canonical data would change across a round trip.
    return value === 0 ? 0 : value;
  }

  number(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (value !== undefined) this.error(path, `expected a finite number, got ${describe(value)}`);
      return 0;
    }
    return value === 0 ? 0 : value;
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

/**
 * Copies JSON-like input once: own enumerable string-keyed data properties only. Accessors,
 * symbol or non-enumerable keys are reported, because v1 fails closed on what it cannot see.
 */
function snapshot(value: unknown, path: string, diagnostics: VideoSpecDiagnostic[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    // Plain arrays only: a subclass or swapped prototype could carry inherited data.
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      diagnostics.push({ path, message: 'expected a plain array' });
      return [];
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      // Canonical array indexes only: below 2^32 - 1 and inside the length.
      const index = typeof key === 'string' ? Number(key) : Number.NaN;
      if (String(index) === key && Number.isInteger(index) && index >= 0 && index < value.length) {
        continue;
      }
      diagnostics.push({ path, message: `unsupported array property ${String(key)}` });
    }
    return Array.from({ length: value.length }, (_, index) =>
      snapshotProperty(value, String(index), `${path}[${index}]`, diagnostics),
    );
  }
  const prototype = Object.getPrototypeOf(value);
  // Not a plain record: left as is and reported as "expected a plain object" by the reader.
  if (prototype !== Object.prototype && prototype !== null) return value;
  // A null prototype keeps an own "__proto__" key as a field instead of invoking the setter.
  const copy: Json = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      diagnostics.push({ path, message: `unsupported symbol key ${String(key)}` });
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && !descriptor.enumerable) {
      diagnostics.push({ path: `${path}.${key}`, message: 'unsupported non-enumerable field' });
      continue;
    }
    copy[key] = snapshotProperty(value, key, `${path}.${key}`, diagnostics);
  }
  return copy;
}

function snapshotProperty(
  owner: object,
  key: string,
  path: string,
  diagnostics: VideoSpecDiagnostic[],
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) {
    diagnostics.push({ path, message: 'accessor properties are not supported' });
    return undefined;
  }
  return snapshot(descriptor.value, path, diagnostics);
}

function errorMessage(error: unknown) {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'unknown error';
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
  if (!Number.isSafeInteger(spec.scenes.reduce((sum, scene) => sum + sceneDurationInFrames(scene, fps), 0))) {
    r.error('$.scenes', 'the total duration must be a safe integer number of frames');
  }
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

const SCENE_FIELDS = ['id', 'kind', 'payload'];
// durationInFrames is required exactly when the narration has no audio (checked in readScene).
const SCENE_OPTIONAL_FIELDS = ['durationInFrames', 'narration', 'interaction'];

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
  // A scene with narration audio takes its length from the narration; one without states it.
  const rawNarration = scene.narration;
  const hasAudio =
    typeof rawNarration === 'object' && rawNarration !== null && !Array.isArray(rawNarration) && (rawNarration as Json).audio !== undefined;
  let durationInFrames: number | undefined;
  if (hasAudio) {
    if (scene.durationInFrames !== undefined) {
      r.error(`${path}.durationInFrames`, 'must be omitted when the narration has audio; the narration sets the scene length');
    }
  } else if (scene.durationInFrames === undefined) {
    r.error(`${path}.durationInFrames`, 'missing required field');
    durationInFrames = 0;
  } else {
    durationInFrames = r.integer(scene.durationInFrames, `${path}.durationInFrames`, { min: 1 });
  }
  const narration =
    rawNarration === undefined
      ? undefined
      : readNarration(r, rawNarration, `${path}.narration`, fps, durationInFrames ?? 0, assets);
  const interaction =
    scene.interaction === undefined
      ? undefined
      : readInteraction(r, scene.interaction, `${path}.interaction`, narration);
  const base = {
    id: r.id(scene.id, `${path}.id`),
    ...(durationInFrames !== undefined ? { durationInFrames } : {}),
    ...(narration ? { narration } : {}),
    ...(interaction ? { interaction } : {}),
  };
  const payloadPath = `${path}.payload`;
  const optionalString = <K extends string>(payload: Json | null, key: K) =>
    (payload?.[key] !== undefined ? { [key]: r.string(payload[key], `${payloadPath}.${key}`) } : {}) as Partial<
      Record<K, string>
    >;
  const string = (payload: Json | null, key: string) => r.string(payload?.[key], `${payloadPath}.${key}`);

  switch (scene.kind as SceneKind) {
    case 'title': {
      const payload = r.object(scene.payload, payloadPath, ['heading'], ['eyebrow']);
      return {
        kind: 'title',
        ...base,
        payload: { ...optionalString(payload, 'eyebrow'), heading: string(payload, 'heading') },
      };
    }
    case 'binnedChart':
      return { kind: 'binnedChart', ...base, payload: readBinnedChartPayload(r, scene.payload, payloadPath, assets) };
    case 'statement': {
      const payload = r.object(scene.payload, payloadPath, ['text'], ['eyebrow', 'emphasis']);
      const parsed = {
        ...optionalString(payload, 'eyebrow'),
        text: string(payload, 'text'),
        ...optionalString(payload, 'emphasis'),
      };
      if (parsed.emphasis && parsed.text.trim() && !parsed.text.includes(parsed.emphasis)) {
        r.error(`${payloadPath}.emphasis`, `${show(parsed.emphasis)} does not occur in the statement text`);
      }
      return { kind: 'statement', ...base, payload: parsed };
    }
    case 'mediaReveal': {
      const payload = r.object(scene.payload, payloadPath, ['image', 'alt'], ['caption']);
      const image = r.id(payload?.image, `${payloadPath}.image`);
      if (image) checkAssetKind(r, assets, image, 'image', `${payloadPath}.image`);
      return {
        kind: 'mediaReveal',
        ...base,
        payload: { image, alt: string(payload, 'alt'), ...optionalString(payload, 'caption') },
      };
    }
    case 'comparison': {
      const payload = r.object(scene.payload, payloadPath, ['items'], ['heading']);
      const values = r.array(payload?.items, `${payloadPath}.items`);
      if (values && values.length !== 2) r.error(`${payloadPath}.items`, 'must have exactly 2 items');
      const items = (values ?? []).map((value, index) => {
        const itemPath = `${payloadPath}.items[${index}]`;
        const item = r.object(value, itemPath, ['label', 'detail']);
        return { label: r.string(item?.label, `${itemPath}.label`), detail: r.string(item?.detail, `${itemPath}.detail`) };
      });
      return { kind: 'comparison', ...base, payload: { ...optionalString(payload, 'heading'), items } };
    }
    case 'quote': {
      const payload = r.object(scene.payload, payloadPath, ['text'], ['attribution']);
      return {
        kind: 'quote',
        ...base,
        payload: { text: string(payload, 'text'), ...optionalString(payload, 'attribution') },
      };
    }
    case 'dataPoint': {
      const payload = r.object(scene.payload, payloadPath, ['value', 'label'], ['context']);
      return {
        kind: 'dataPoint',
        ...base,
        payload: { value: string(payload, 'value'), label: string(payload, 'label'), ...optionalString(payload, 'context') },
      };
    }
    case 'list': {
      const payload = r.object(scene.payload, payloadPath, ['items', 'ordered'], ['heading']);
      const items = (r.array(payload?.items, `${payloadPath}.items`, { nonEmpty: true }) ?? []).map((value, index) =>
        r.string(value, `${payloadPath}.items[${index}]`),
      );
      return {
        kind: 'list',
        ...base,
        payload: {
          ...optionalString(payload, 'heading'),
          items,
          ordered: r.boolean(payload?.ordered, `${payloadPath}.ordered`),
        },
      };
    }
    case 'conclusion': {
      const payload = r.object(scene.payload, payloadPath, ['heading'], ['takeaway']);
      return {
        kind: 'conclusion',
        ...base,
        payload: { heading: string(payload, 'heading'), ...optionalString(payload, 'takeaway') },
      };
    }
  }
}

/** Reports a reference to a missing asset or to an asset of another kind. */
function checkAssetKind(r: Reader, assets: AssetRef[], id: string, kind: AssetKind, path: string) {
  const asset = assets.find((candidate) => candidate.id === id);
  if (!asset) r.error(path, `no asset with id "${id}"`);
  else if (asset.kind !== kind) {
    r.error(path, `asset "${id}" is ${/^[aeiou]/.test(asset.kind) ? 'an' : 'a'} ${asset.kind} asset, not ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`);
  }
}

function readBinnedChartPayload(
  r: Reader,
  value: unknown,
  payloadPath: string,
  assets: AssetRef[],
): BinnedChartScene['payload'] {
  const payload = r.object(value, payloadPath, ['heading', 'dataset', 'bins', 'metric', 'inspectable'], ['eyebrow', 'highlight']);
  const dataset = r.id(payload?.dataset, `${payloadPath}.dataset`);
  if (dataset) checkAssetKind(r, assets, dataset, 'dataset', `${payloadPath}.dataset`);
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
    ...(payload?.eyebrow !== undefined ? { eyebrow: r.string(payload.eyebrow, `${payloadPath}.eyebrow`) } : {}),
    heading: r.string(payload?.heading, `${payloadPath}.heading`),
    dataset,
    bins: r.integer(payload?.bins, `${payloadPath}.bins`, { min: 1 }),
    metric: r.oneOf(payload?.metric, `${payloadPath}.metric`, BIN_METRICS, 'metric'),
    ...(highlight ? { highlight } : {}),
    inspectable: r.boolean(payload?.inspectable, `${payloadPath}.inspectable`),
  };
}

function readNarration(
  r: Reader,
  value: unknown,
  path: string,
  fps: number,
  durationInFrames: number,
  assets: AssetRef[],
): Narration {
  const narration = r.object(value, path, ['cues'], ['audio', 'leadInMs', 'leadOutMs', 'holds', 'words', 'marks']);

  // Audio: the reference and its declared length. `audioMs` is null when absent or invalid, so
  // checks against the audio length only run on a valid length.
  let audio: NarrationAudio | undefined;
  let audioMs: number | null = null;
  if (narration?.audio !== undefined) {
    const audioPath = `${path}.audio`;
    const record = r.object(narration.audio, audioPath, ['asset', 'durationMs']);
    const asset = r.id(record?.asset, `${audioPath}.asset`);
    if (asset) checkAssetKind(r, assets, asset, 'audio', `${audioPath}.asset`);
    const before = r.diagnostics.length;
    const durationMs = r.integer(record?.durationMs, `${audioPath}.durationMs`, { min: 1 });
    if (record && r.diagnostics.length === before && record.durationMs !== undefined) audioMs = durationMs;
    audio = { asset, durationMs };
  }
  const optionalMs = (key: 'leadInMs' | 'leadOutMs') => {
    if (narration?.[key] === undefined) return {};
    const ms = r.integer(narration[key], `${path}.${key}`);
    if (!audio) r.error(`${path}.${key}`, 'requires narration audio');
    return { [key]: ms } as Partial<Record<typeof key, number>>;
  };
  const leadIn = optionalMs('leadInMs');
  const leadOut = optionalMs('leadOutMs');

  // On the audio clock with audio; scene-relative otherwise.
  const sceneMs = fps > 0 ? (durationInFrames / fps) * 1000 : Number.POSITIVE_INFINITY;
  const frameOf = (ms: number) => frameOfMs(ms, fps);
  const endsAfter = (endMs: number): string | null => {
    if (audio) return audioMs !== null && endMs > audioMs ? `ends after the narration audio (${audioMs} ms)` : null;
    return endMs > sceneMs ? `ends after the scene (${Math.round(sceneMs)} ms)` : null;
  };

  const readCues = (key: 'cues' | 'words', raw: unknown) =>
    (r.array(raw, `${path}.${key}`, { nonEmpty: true }) ?? []).map((cueValue, index) => {
      const cuePath = `${path}.${key}[${index}]`;
      const cue = r.object(cueValue, cuePath, ['startMs', 'endMs', 'text']);
      return {
        startMs: r.integer(cue?.startMs, `${cuePath}.startMs`),
        endMs: r.integer(cue?.endMs, `${cuePath}.endMs`),
        text: r.string(cue?.text, `${cuePath}.text`),
      };
    });

  const cues = readCues('cues', narration?.cues);
  cues.forEach((cue, index) => {
    // A blank line ends an SRT cue, so it would split this cue or inject another one.
    if (/\n[ \t]*\n/.test(cue.text)) {
      r.error(`${path}.cues[${index}].text`, 'must not contain a blank line');
    }
    // Subtitle parsers turn "\r" into "\n", so terms would no longer match the rendered text.
    if (cue.text.includes('\r')) {
      r.error(`${path}.cues[${index}].text`, 'must use "\\n" line breaks, not "\\r"');
    }
    // Subtitle parsers read tags and ASS overrides as formatting; narration is literal text.
    // Same tag shape the subtitle markup parser strips (`<([^>]+)>`).
    if (/<[^>]+>|\{\\/.test(cue.text)) {
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
    const after = endsAfter(cue.endMs);
    if (after) {
      r.error(`${cuePath}.endMs`, after);
    } else if (fps > 0 && cue.endMs > cue.startMs) {
      let hidden: boolean;
      if (audio) {
        // A narrated cue is on screen on the frames [frameOf(startMs), frameOf(endMs)); one
        // strictly between two frame samples is never shown.
        hidden = frameOf(cue.startMs) >= frameOf(cue.endMs);
      } else {
        // Frames sample time at frame / fps, and a scene-relative cue is shown through its end
        // time inclusive; a cue strictly between two samples is never shown.
        let firstFrame = Math.ceil((cue.startMs * fps) / 1000);
        while ((firstFrame / fps) * 1000 < cue.startMs) firstFrame += 1;
        while (firstFrame > 0 && ((firstFrame - 1) / fps) * 1000 >= cue.startMs) firstFrame -= 1;
        // Same arithmetic order as the subtitle renderer, so float rounding agrees with it.
        hidden = (firstFrame / fps) * 1000 > cue.endMs || firstFrame >= durationInFrames;
      }
      if (hidden) r.error(cuePath, 'is not on screen on any rendered frame');
    }
    const previous = cues[index - 1];
    if (previous && cue.startMs < previous.endMs) {
      r.error(`${cuePath}.startMs`, 'cues must be in order and must not overlap');
    }
  });

  let words: NarrationCue[] | undefined;
  if (narration?.words !== undefined) {
    words = readCues('words', narration.words);
    words.forEach((word, index) => {
      const wordPath = `${path}.words[${index}]`;
      if (word.text.trim() && /\s/.test(word.text)) r.error(`${wordPath}.text`, 'must be a single word without whitespace');
      if (word.endMs <= word.startMs) {
        r.error(wordPath, 'endMs must be greater than startMs');
      } else {
        const after = endsAfter(word.endMs);
        if (after) r.error(`${wordPath}.endMs`, after);
      }
      const previous = words![index - 1];
      if (previous && word.startMs < previous.endMs) {
        r.error(`${wordPath}.startMs`, 'words must be in order and must not overlap');
      } else if (!cues.some((cue) => cue.startMs <= word.startMs && word.endMs <= cue.endMs)) {
        r.error(wordPath, 'is not inside any cue');
      }
    });
  }

  let holds: NarrationHold[] | undefined;
  if (narration?.holds !== undefined) {
    if (!audio) {
      r.error(`${path}.holds`, 'requires narration audio');
    } else {
      holds = (r.array(narration.holds, `${path}.holds`) ?? []).map((holdValue, index) => {
        const holdPath = `${path}.holds[${index}]`;
        const hold = r.object(holdValue, holdPath, ['atMs', 'durationMs']);
        return {
          atMs: r.integer(hold?.atMs, `${holdPath}.atMs`),
          durationMs: r.integer(hold?.durationMs, `${holdPath}.durationMs`, { min: 1 }),
        };
      });
      holds.forEach((hold, index) => {
        const atPath = `${path}.holds[${index}].atMs`;
        const previous = holds![index - 1];
        const inside = cues.findIndex((cue) => cue.startMs < hold.atMs && hold.atMs < cue.endMs);
        if (audioMs !== null && (hold.atMs <= 0 || hold.atMs >= audioMs)) {
          r.error(atPath, `must be inside the narration audio (between 0 and ${audioMs} ms, exclusive)`);
        } else if (previous && hold.atMs <= previous.atMs) {
          r.error(atPath, 'holds must be in increasing order');
        } else if (inside >= 0) {
          r.error(atPath, `falls inside cues[${inside}]; holds go between cues`);
        } else if (fps > 0 && audioMs !== null) {
          // Each hold cuts the audio on a frame; two cuts on one frame, or one on the audio's last
          // frame, would leave an audio segment with no frames.
          const cut = frameOf(hold.atMs);
          if (previous && cut === frameOf(previous.atMs)) {
            r.error(atPath, `lands on the same frame as holds[${index - 1}]`);
          } else if (cut >= frameOf(audioMs)) {
            r.error(atPath, 'lands on the last frame of the narration audio');
          }
        }
      });
    }
  }

  let marks: NarrationMark[] | undefined;
  if (narration?.marks !== undefined) {
    marks = (r.array(narration.marks, `${path}.marks`) ?? []).map((markValue, index) => {
      const markPath = `${path}.marks[${index}]`;
      const mark = r.object(markValue, markPath, ['id', 'atMs']);
      return { id: r.id(mark?.id, `${markPath}.id`), atMs: r.integer(mark?.atMs, `${markPath}.atMs`) };
    });
    r.unique(marks.map((mark) => mark.id), (index) => `${path}.marks[${index}].id`, 'mark');
    // Where a mark lands in the scene, for the on-a-frame check (holds shift later frames).
    const sceneFrames =
      audio && audioMs !== null
        ? narrationAudioFrames({ ...leadIn, ...leadOut, audio: { asset: audio.asset, durationMs: audioMs }, holds, cues }, fps)
        : null;
    marks.forEach((mark, index) => {
      const atPath = `${path}.marks[${index}].atMs`;
      const previous = marks![index - 1];
      if (mark.atMs < 0) return;
      if (audio) {
        if (audioMs !== null && mark.atMs >= audioMs) {
          r.error(atPath, `must be before the end of the narration audio (${audioMs} ms)`);
          return;
        }
      }
      if (previous && mark.atMs <= previous.atMs) {
        r.error(atPath, 'marks must be in increasing order');
      } else if (fps > 0 && previous && previous.atMs >= 0 && frameOf(mark.atMs) === frameOf(previous.atMs)) {
        r.error(atPath, `lands on the same frame as marks[${index - 1}]`);
      } else if (fps > 0) {
        const frame = sceneFrames
          ? sceneFrames.leadIn + frameOf(mark.atMs) + sceneFrames.holds.filter((hold) => hold.cut <= frameOf(mark.atMs)).reduce((sum, hold) => sum + hold.length, 0)
          : audio
            ? null
            : frameOf(mark.atMs);
        const length = sceneFrames ? sceneFrames.total : durationInFrames;
        if (frame !== null && length > 0 && frame >= length) r.error(atPath, 'is not on any rendered frame of the scene');
      }
    });
  }

  return {
    ...(audio ? { audio } : {}),
    ...leadIn,
    ...leadOut,
    ...(holds ? { holds } : {}),
    cues,
    ...(words ? { words } : {}),
    ...(marks ? { marks } : {}),
  };
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
    if (/[\r\n]/.test(parsed.term)) r.error(`${termPath}.term`, 'must be on one line');
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
