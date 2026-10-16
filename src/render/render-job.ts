// The pure front half of `bun run video:render`: argument parsing, job resolution and the
// machine-readable result (schema v2: per-slot asset provenance since #17). Everything a render depends on is resolved here, before
// anything is bundled or rendered, and every failure is a typed reason with a diagnostic.
//
// Projects come only from the catalog (src/projects.ts), the composition authority the Player
// uses too. A spec path selects the catalog project whose registered spec it is; a file that is
// not a registered spec is refused, never rendered through a second path.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { assetObjectPath } from '@/assets/asset-store';
import { assetPath } from '@/assets/asset-url';

import type { Catalog } from '@/catalog/catalog';
import { parseVideoSpecJson, resolveTimeline, serializeVideoSpec, type AssetKind, type ResolvedScene, type VideoSpec } from '@/spec/video-spec';

export const RENDER_RESULT_SCHEMA = 'interactive-videos/render-result';
export const RENDER_RESULT_SCHEMA_VERSION = 2;

export type RenderErrorReason =
  | 'invalid-arguments'
  | 'unknown-profile'
  | 'unknown-project'
  | 'spec-not-found'
  | 'invalid-spec'
  | 'spec-mismatch'
  | 'format-mismatch'
  | 'unrenderable'
  | 'profile-mismatch'
  | 'missing-asset'
  | 'asset-mismatch'
  | 'frames-out-of-range'
  | 'render-failed';

export type RenderError = { reason: RenderErrorReason; message: string };

/** An output profile: the encoding and the frame shape it accepts. */
export type RenderProfile = {
  id: string;
  codec: 'h264';
  container: 'mp4';
  /** Required aspect ratio as width:height, compared exactly. */
  aspect: { width: number; height: number };
  description: string;
};

export const RENDER_PROFILES: readonly RenderProfile[] = [
  { id: 'social-portrait', codec: 'h264', container: 'mp4', aspect: { width: 9, height: 16 }, description: '9:16 portrait' },
];

export const DEFAULT_PROFILE_ID = 'social-portrait';

export type FrameRange = { from: number; to: number };

export type RenderArgs = { project: string; out?: string; frames?: FrameRange; profile: string };

export type ParseResult = { ok: true; args: RenderArgs } | { ok: false; error: RenderError };

const FLAGS = ['--project', '--out', '--frames', '--profile'] as const;
type Flag = (typeof FLAGS)[number];

const invalid = (message: string): { ok: false; error: RenderError } => ({ ok: false, error: { reason: 'invalid-arguments', message } });

const USAGE = 'usage: bun run video:render --project <id-or-spec-path> [--out <path>] [--frames <a>-<b>] [--profile <id>]';

/** Parses the arguments after the script name. Flags take one value each and may not repeat. */
export function parseRenderArgs(argv: readonly string[]): ParseResult {
  const values = new Map<Flag, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!(FLAGS as readonly string[]).includes(flag)) {
      return invalid(flag.startsWith('-') ? `Unknown flag "${flag}". ${USAGE}` : `Unexpected argument "${flag}". ${USAGE}`);
    }
    if (values.has(flag as Flag)) return invalid(`${flag} is given more than once.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return invalid(`${flag} needs a value. ${USAGE}`);
    values.set(flag as Flag, value);
  }

  const project = values.get('--project');
  if (project === undefined) return invalid(`Missing --project. ${USAGE}`);
  if (project === '') return invalid('--project must not be empty.');

  const args: RenderArgs = { project, profile: values.get('--profile') ?? DEFAULT_PROFILE_ID };
  if (args.profile === '') return invalid('--profile must not be empty.');

  const out = values.get('--out');
  if (out !== undefined) {
    if (out === '') return invalid('--out must not be empty.');
    args.out = out;
  }

  const frames = values.get('--frames');
  if (frames !== undefined) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(frames);
    if (!match) return invalid(`--frames "${frames}" is not a frame or an inclusive range <a>-<b> of non-negative integers.`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return invalid(`--frames "${frames}" is out of range.`);
    if (to < from) return invalid(`--frames "${frames}" ends before it starts.`);
    args.frames = { from, to };
  }
  return { ok: true, args };
}

/**
 * How one slot was materialized before the job was resolved (#17). Structurally the provenance
 * part of `MaterializedSlot` in src/assets/materialize.ts; declared here so the render path never
 * imports the materialize boundary or asset-tooling.
 */
export type MaterializedSlotRecord = {
  id: string;
  status: 'hit' | 'miss' | 'local' | 'committed';
  operation: { id: string; version: string } | null;
  cacheKey: string | null;
};

/** The v2 result's per-slot provenance; null when the job was resolved without a record. */
export type AssetProvenance = Pick<MaterializedSlotRecord, 'status' | 'operation' | 'cacheKey'> | null;

export type RenderEnvironment = {
  catalog: Catalog;
  /** Relative spec paths and --out resolve against this directory. */
  cwd: string;
  /**
   * The asset-tooling root slots resolve against
   * (`<root>/.asset-tooling/objects/v1/sha256/<2>/<digest>`).
   */
  assetStore: string;
  /** The materialization record of the selected project, when it was materialized first (#17). */
  materialized?: readonly MaterializedSlotRecord[];
};

/** A slot resolved before bundling to an immutable, content-addressed runtime input. */
export type RenderAsset = { id: string; kind: AssetKind; src: string; sha256: string; byteLength: number; mediaType: string };

/** Everything a render needs, resolved and checked before bundling. */
export type RenderJob = {
  request: { project: string; profile: string; frames: string | null };
  project: { id: string; title: string; specSha256: string };
  format: { id: string; version: number };
  profile: RenderProfile;
  composition: { id: string; width: number; height: number; fps: number; durationInFrames: number };
  frames: FrameRange;
  scenes: ResolvedScene[];
  /** Exactly the resolved inputs; this is all a format pack sees. */
  assets: RenderAsset[];
  /** Per-slot provenance, parallel to `assets`; reported in the result, never given to formats. */
  provenance: AssetProvenance[];
  /** Absolute path of the file to write. */
  outPath: string;
};

export type ResolveJobResult = { ok: true; job: RenderJob } | { ok: false; error: RenderError };

const fail = (reason: RenderErrorReason, message: string): { ok: false; error: RenderError } => ({ ok: false, error: { reason, message } });

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A selector is a spec path when it names a JSON file or has a directory part; otherwise an id. */
const isSpecPath = (selector: string) => /\.json$/i.test(selector) || /[\\/]/.test(selector);

/** Composition ids Remotion accepts (its validateCompositionId rule). */
const COMPOSITION_ID = /^([a-zA-Z0-9-一-鿿])+$/;

/** Selects the project: an id directly, a spec path through the catalog spec it must equal. */
function selectProject(selector: string, environment: RenderEnvironment): { ok: true; spec: VideoSpec } | { ok: false; error: RenderError } {
  const { catalog } = environment;
  if (!isSpecPath(selector)) {
    const spec = catalog.spec(selector);
    return spec ? { ok: true, spec } : fail('unknown-project', `No project with id "${selector}" in the catalog.`);
  }

  const path = isAbsolute(selector) ? selector : resolve(environment.cwd, selector);
  if (!existsSync(path) || !statSync(path).isFile()) return fail('spec-not-found', `Spec file ${selector} does not exist (${path}).`);
  const parsed = parseVideoSpecJson(readFileSync(path, 'utf8'));
  if (!parsed.ok) {
    const details = parsed.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('; ');
    return fail('invalid-spec', `Spec file ${selector} is not a valid VideoSpec: ${details}`);
  }
  const id = parsed.spec.project.id;
  const registered = catalog.spec(id);
  if (!registered) return fail('unknown-project', `Spec file ${selector} declares project "${id}", which is not in the catalog.`);
  if (serializeVideoSpec(parsed.spec) !== serializeVideoSpec(registered)) {
    return fail(
      'spec-mismatch',
      `Spec file ${selector} declares project "${id}" but differs from the spec registered in the catalog; only registered specs render.`,
    );
  }
  return { ok: true, spec: registered };
}

/**
 * The catalog project id a request selects, or undefined when it selects none (the job's
 * resolution then reports why). The CLI materializes this project before resolving the job.
 */
export function selectedProjectId(args: RenderArgs, environment: RenderEnvironment): string | undefined {
  try {
    const selected = selectProject(args.project, environment);
    return selected.ok ? selected.spec.project.id : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves a parsed request into a render job, or the first reason it cannot render. */
export function resolveRenderJob(args: RenderArgs, environment: RenderEnvironment): ResolveJobResult {
  const profile = RENDER_PROFILES.find((candidate) => candidate.id === args.profile);
  if (!profile) {
    const known = RENDER_PROFILES.map((candidate) => candidate.id).join(', ');
    return fail('unknown-profile', `Unknown profile "${args.profile}". Known profiles: ${known}.`);
  }

  const selected = selectProject(args.project, environment);
  if (!selected.ok) return selected;
  const spec = selected.spec;
  const id = spec.project.id;

  const resolved = environment.catalog.resolve(id);
  if (!resolved.ok) return fail(resolved.reason, resolved.message);
  const { width, height, fps, durationInFrames } = resolved.composition;

  if (!COMPOSITION_ID.test(id)) {
    return fail('unrenderable', `Project "${id}" cannot be a Remotion composition id (letters, digits and "-" only).`);
  }

  if (width * profile.aspect.height !== height * profile.aspect.width) {
    return fail(
      'profile-mismatch',
      `Project "${id}" is ${width}x${height}, but profile ${profile.id} needs ${profile.description} (${profile.aspect.width}:${profile.aspect.height}).`,
    );
  }

  const frames = args.frames ?? { from: 0, to: durationInFrames - 1 };
  if (frames.to >= durationInFrames) {
    return fail(
      'frames-out-of-range',
      `Frames ${frames.from}-${frames.to} are outside project "${id}", which has ${durationInFrames} frames (0-${durationInFrames - 1}).`,
    );
  }

  const assets: RenderAsset[] = [];
  const provenance: AssetProvenance[] = [];
  const records = new Map((environment.materialized ?? []).map((record) => [record.id, record]));
  for (const slot of spec.assets) {
    const { sha256: digest, byteLength, mediaType } = slot.asset;
    const file = assetObjectPath(environment.assetStore, digest);
    if (!existsSync(file) || !statSync(file).isFile()) {
      return fail('missing-asset', `Asset "${slot.id}" (sha256 ${digest}) is missing: no object in ${environment.assetStore}.`);
    }
    const bytes = readFileSync(file);
    if (bytes.length !== byteLength || sha256(bytes) !== digest) {
      return fail(
        'asset-mismatch',
        `Asset "${slot.id}" does not match its AssetRef: the stored object has ${bytes.length} bytes with sha256 ${sha256(bytes)}, the spec declares ${byteLength} bytes with sha256 ${digest}.`,
      );
    }
    assets.push({ id: slot.id, kind: slot.kind, src: assetPath(digest, mediaType), sha256: digest, byteLength, mediaType });
    const record = records.get(slot.id);
    provenance.push(
      record
        ? { status: record.status, operation: record.operation ? { ...record.operation } : null, cacheKey: record.cacheKey }
        : null,
    );
  }

  const outPath = args.out === undefined
    ? join(environment.cwd, 'out', `${id}.${profile.id}.${profile.container}`)
    : resolve(environment.cwd, args.out);

  return {
    ok: true,
    job: {
      request: { project: args.project, profile: profile.id, frames: args.frames ? `${args.frames.from}-${args.frames.to}` : null },
      project: { id, title: spec.project.title, specSha256: sha256(serializeVideoSpec(spec)) },
      format: { id: spec.format.id, version: spec.format.version },
      profile,
      composition: { id, width, height, fps, durationInFrames },
      frames,
      scenes: resolveTimeline(spec).scenes,
      assets,
      provenance,
      outPath,
    },
  };
}

export type RenderOutput = { path: string; sha256: string; bytes: number };

/** The v2 success result. Nothing time-dependent is part of it. */
export function createRenderResult(job: RenderJob, output: RenderOutput) {
  const { profile, frames } = job;
  return {
    schema: RENDER_RESULT_SCHEMA,
    schemaVersion: RENDER_RESULT_SCHEMA_VERSION,
    ok: true as const,
    request: { ...job.request },
    project: { ...job.project },
    format: { ...job.format },
    profile: { id: profile.id, codec: profile.codec, container: profile.container },
    composition: { ...job.composition },
    frames: { from: frames.from, to: frames.to, count: frames.to - frames.from + 1 },
    scenes: job.scenes.map((scene) => ({ id: scene.id, kind: scene.kind, from: scene.from, durationInFrames: scene.durationInFrames })),
    assets: job.assets.map((asset, index) => {
      const provenance = job.provenance[index] ?? null;
      return {
        ...asset,
        provenance: provenance && { status: provenance.status, operation: provenance.operation && { ...provenance.operation }, cacheKey: provenance.cacheKey },
      };
    }),
    output: { path: output.path, sha256: output.sha256, bytes: output.bytes },
  };
}

/** The v2 failure result. */
export function createRenderFailure(error: RenderError) {
  return {
    schema: RENDER_RESULT_SCHEMA,
    schemaVersion: RENDER_RESULT_SCHEMA_VERSION,
    ok: false as const,
    error: { reason: error.reason, message: error.message },
  };
}
