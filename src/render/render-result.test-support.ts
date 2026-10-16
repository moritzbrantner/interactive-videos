// Acceptance contract for issue #15: the machine-readable render result, bumped to schema v2 by
// the independent acceptance context of #17 (per-slot asset provenance).
//
// Shared by the unit tests and the render smoke. It deliberately imports no production code, so it
// states the schema independently of the implementation.
//
// Success: one JSON object, the only line on stdout of `bun run video:render`.
//   {
//     "schema": "interactive-videos/render-result", "schemaVersion": 2, "ok": true,
//     "request":     { "project": <selector as given>, "profile": <profile id>, "frames": "<a>-<b>" | null },
//     "project":     { "id", "title", "specSha256" },      // sha256 of serializeVideoSpec(spec)
//     "format":      { "id", "version" },                    // the spec's format pack
//     "profile":     { "id", "codec", "container" },         // social-portrait: h264 / mp4
//     "composition": { "id", "width", "height", "fps", "durationInFrames" },
//     "frames":      { "from", "to", "count" },              // inclusive range actually rendered
//     "scenes":      [{ "id", "kind", "from", "durationInFrames" }],   // resolveTimeline(spec).scenes
//     "assets":      [{ "id", "kind", "src", "sha256", "byteLength", "mediaType", "provenance" }],
//                    // #16: spec asset slots in normalized order, resolved before bundling to immutable
//                    // content-addressed inputs (src contains the sha256; no static: URI anywhere)
//                    // #17 (schema v2): "provenance" records how the slot was materialized in this run:
//                    //   { "status": "hit" | "miss", "operation": { "id", "version" }, "cacheKey": <sha256 hex> }
//                    //   for an asset-tooling operation request, { "status": "local", "operation": null,
//                    //   "cacheKey": null } for a local/pre-generated slot, or null when the job was resolved
//                    //   without a materialization record (a pre-filled store; the CLI always records one).
//     "output":      { "path", "sha256", "bytes" }          // absolute path of the written file
//   }
// Failure: exit code != 0, the message on stderr, and one JSON line on stdout:
//   { "schema": "interactive-videos/render-result", "schemaVersion": 2, "ok": false,
//     "error": { "reason": <RenderErrorReason>, "message": <diagnostic> } }
// Nothing time-dependent (timestamps, wall-clock durations, hostnames) is part of either object.
import { expect } from 'vitest';

export const RENDER_RESULT_SCHEMA = 'interactive-videos/render-result';

export const RENDER_ERROR_REASONS = [
  'invalid-arguments',
  'unknown-profile',
  'unknown-project',
  'spec-not-found',
  'invalid-spec',
  'spec-mismatch',
  'format-mismatch',
  'unrenderable',
  'profile-mismatch',
  'missing-asset',
  'asset-mismatch',
  'frames-out-of-range',
  'render-failed',
] as const;

const SHA256 = /^[0-9a-f]{64}$/;
const keys = (value: unknown) => Object.keys(value as object).sort();
const isInt = (value: unknown) => Number.isSafeInteger(value);

export const RENDER_RESULT_SCHEMA_VERSION = 2;

/** Asserts a v2 asset provenance entry (or null) and its internal consistency. */
export function assertAssetProvenance(value: unknown, location: string) {
  if (value === null) return;
  const provenance = value as Record<string, any>;
  expect(keys(provenance), location).toEqual(['cacheKey', 'operation', 'status']);
  expect(['hit', 'miss', 'local'], location).toContain(provenance.status);
  if (provenance.status === 'local') {
    expect(provenance.operation, location).toBeNull();
    expect(provenance.cacheKey, location).toBeNull();
  } else {
    expect(keys(provenance.operation), location).toEqual(['id', 'version']);
    expect(provenance.operation.id, location).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    expect(provenance.operation.version, location).toBeTypeOf('string');
    expect(provenance.cacheKey, location).toMatch(SHA256);
  }
}

/** Asserts the exact v2 success shape; returns the value typed loosely for further checks. */
export function assertRenderResult(value: unknown) {
  const result = value as Record<string, any>;
  expect(keys(result)).toEqual(
    ['assets', 'composition', 'format', 'frames', 'ok', 'output', 'profile', 'project', 'request', 'scenes', 'schema', 'schemaVersion'],
  );
  expect(result.schema).toBe(RENDER_RESULT_SCHEMA);
  expect(result.schemaVersion).toBe(RENDER_RESULT_SCHEMA_VERSION);
  expect(result.ok).toBe(true);

  expect(keys(result.request)).toEqual(['frames', 'profile', 'project']);
  expect(result.request.project).toBeTypeOf('string');
  expect(result.request.profile).toBeTypeOf('string');

  expect(keys(result.project)).toEqual(['id', 'specSha256', 'title']);
  expect(result.project.id).toBeTypeOf('string');
  expect(result.project.title).toBeTypeOf('string');
  expect(result.project.specSha256).toMatch(SHA256);

  expect(keys(result.format)).toEqual(['id', 'version']);
  expect(result.format.id).toBeTypeOf('string');
  expect(isInt(result.format.version)).toBe(true);

  expect(keys(result.profile)).toEqual(['codec', 'container', 'id']);
  expect(result.request.profile).toBe(result.profile.id);

  expect(keys(result.composition)).toEqual(['durationInFrames', 'fps', 'height', 'id', 'width']);
  expect(result.composition.id).toBe(result.project.id);
  for (const field of ['durationInFrames', 'fps', 'height', 'width']) {
    expect(isInt(result.composition[field]) && result.composition[field] > 0, `composition.${field}`).toBe(true);
  }

  expect(keys(result.frames)).toEqual(['count', 'from', 'to']);
  const { from, to, count } = result.frames;
  expect(isInt(from) && isInt(to) && from >= 0 && from <= to && to < result.composition.durationInFrames).toBe(true);
  expect(count).toBe(to - from + 1);
  // Without --frames the whole composition renders; with it, the request echoes the rendered range.
  if (result.request.frames === null) expect([from, to]).toEqual([0, result.composition.durationInFrames - 1]);
  else expect(result.request.frames).toBe(`${from}-${to}`);

  expect(Array.isArray(result.scenes) && result.scenes.length > 0).toBe(true);
  let next = 0;
  for (const scene of result.scenes) {
    expect(keys(scene)).toEqual(['durationInFrames', 'from', 'id', 'kind']);
    expect(scene.from).toBe(next);
    next += scene.durationInFrames;
  }
  expect(next).toBe(result.composition.durationInFrames);

  expect(Array.isArray(result.assets)).toBe(true);
  for (const asset of result.assets) {
    expect(keys(asset)).toEqual(['byteLength', 'id', 'kind', 'mediaType', 'provenance', 'sha256', 'src']);
    assertAssetProvenance(asset.provenance, `assets[${asset.id}].provenance`);
    expect(asset.id).toBeTypeOf('string');
    expect(asset.kind).toBeTypeOf('string');
    expect(asset.sha256).toMatch(SHA256);
    expect(isInt(asset.byteLength) && asset.byteLength >= 0).toBe(true);
    expect(asset.mediaType).toMatch(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/);
    expect(asset.src).toBeTypeOf('string');
    expect(asset.src).toContain(asset.sha256);
    expect(String(asset.src).startsWith('static:')).toBe(false);
  }

  expect(keys(result.output)).toEqual(['bytes', 'path', 'sha256']);
  expect(result.output.path).toBeTypeOf('string');
  expect(result.output.sha256).toMatch(SHA256);
  expect(isInt(result.output.bytes)).toBe(true);
  return result;
}

/** Asserts the exact v2 failure shape and returns its reason. */
export function assertRenderFailure(value: unknown) {
  const result = value as Record<string, any>;
  expect(keys(result)).toEqual(['error', 'ok', 'schema', 'schemaVersion']);
  expect(result.schema).toBe(RENDER_RESULT_SCHEMA);
  expect(result.schemaVersion).toBe(RENDER_RESULT_SCHEMA_VERSION);
  expect(result.ok).toBe(false);
  expect(keys(result.error)).toEqual(['message', 'reason']);
  expect(RENDER_ERROR_REASONS).toContain(result.error.reason);
  expect(String(result.error.message).length).toBeGreaterThan(0);
  return result.error as { reason: (typeof RENDER_ERROR_REASONS)[number]; message: string };
}
