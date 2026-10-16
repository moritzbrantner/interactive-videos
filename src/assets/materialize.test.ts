// Acceptance contract for issue #17 (integrate asset-tooling materialization and reuse), written by
// an independent acceptance context before the implementation. Approved design: the owner's
// "Preflight and approach (2026-10-16)" comment on #17 (sidecar request manifest, one asset-tooling
// object store, materialization outside src/render, render result v2 with per-slot provenance,
// asset-tooling pinned by git SHA). Upstream: asset-tooling 61d71f7 (`runAssetOperation` in
// `asset-tooling/operations/store`, docs/operations.md "Reusing verified operation results").
// ADR 0001 and docs/specs/videospec-v2-assets.md are unchanged; this answers its open question 5.
//
// Public seams exercised (all new unless noted):
//
// 1. Sidecar request manifest, next to the spec: `src/spec/fixtures/<project id>.asset-requests.json`
//      { "schema": "interactive-videos/asset-requests", "schemaVersion": 1, "project": <id>,
//        "slots": { <slot id>: { "operation": { "id", "version" }, "parameters": {…}, "inputs": { <port>: <slot id> } }
//                             | { "local": <repository-relative source file> } } }
//    A project may have no manifest: then every slot is local and its bytes come from the
//    network-free source import (`importSourceAssets`, #16). When a manifest exists it declares every
//    spec slot exactly once. Operation inputs name other slots of the same project. The VideoSpec
//    slot's AssetRef stays the lock: the materialized output must have its identity.
//
// 2. `@/assets/materialize` (outside src/render/):
//      loadAssetRequests(projectId): unknown | undefined           // reads the sidecar, if any
//      DEFAULT_ASSET_OPERATIONS: readonly MaterializeOperation[]  // includes audio.oscillator@1, audio.adsr@1
//      type MaterializeOperation = {
//        descriptor: { id: string; version: string; … }          // the asset-tooling descriptor
//        implementation(root, { parameters, inputs }): Promise<implementation identity>
//                                                               // built-ins: AT's own create*BuildIdentity(...).implementation
//        execute(root, { parameters, inputs }): Promise<AssetOperationResult>   // AT executor
//      }
//      materializeProject(projectId, {
//        catalog, root,                // root: asset-tooling root; objects at <root>/.asset-tooling/objects/v1
//        sourceRoot,                   // `local` sources resolve against it (and may not leave it)
//        requests?: (projectId) => unknown | undefined,   // default loadAssetRequests
//        operations?: readonly MaterializeOperation[],     // default DEFAULT_ASSET_OPERATIONS
//      }): Promise<
//        | { ok: true; project: string; slots: MaterializedSlot[] }      // slots in normalized (spec) order
//        | { ok: false; error: { reason, slot: string | null, message } }>  // never rejects
//      MaterializedSlot = { id, kind, status: 'hit' | 'miss' | 'local',
//                           operation: { id, version } | null, cacheKey: string | null, asset: AssetRef }
//      error reasons: 'invalid-requests' | 'unknown-operation' | 'asset-lock-mismatch' | 'materialize-failed'
//    Operation slots run through asset-tooling's `runAssetOperation`; status and cacheKey are its
//    `run.status` / `run.cacheKey`. Only the selected project's requests are read or executed.
//
// 3. Render job/result (`@/render/render-job`, src/render/render-result.test-support.ts):
//    RenderEnvironment gains optional `materialized: MaterializedSlot[]`. `job.assets` keeps exactly
//    the resolved `{ id, kind, src, sha256, byteLength, mediaType }` (all a format pack sees); the
//    v2 result's `assets[i].provenance` is `{ status, operation, cacheKey }` of the materialized slot.
//
// 4. Fixture project `moenarch-materialized-audio` (format moenarch-short, portrait), registered in
//    the catalog, with three audio slots, every one played by a narration segment:
//      narration.tone   ← audio.oscillator@1 (TONE_PARAMETERS)
//      narration.shaped ← audio.adsr@1 (SHAPED_PARAMETERS) of narration.tone
//      narration.local  ← local public/fixtures/narration/hook.wav (the existing narration WAV)
//    The expected AssetRefs below were computed independently with asset-tooling 61d71f7.
//
// The tests need the pinned asset-tooling dependency installed (they import its store API to check
// objects independently of the implementation).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssetOperationCacheKey } from 'asset-tooling/operations';
import {
  AUDIO_OSCILLATOR_OPERATION,
  createAudioOscillatorOperationBuildIdentity,
} from 'asset-tooling/operations/audio/procedural';
import { resolveAssetObject, verifyAssetObject } from 'asset-tooling/operations/store';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { assetObjectPath } from '@/assets/asset-store';
import { DEFAULT_ASSET_OPERATIONS, loadAssetRequests, materializeProject } from '@/assets/materialize';
import { createCatalog, type Catalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { catalog } from '@/projects';
import { createRenderResult, parseRenderArgs, RENDER_PROFILES, resolveRenderJob } from '@/render/render-job';
import { assertRenderResult } from '@/render/render-result.test-support';
import { narrationSchedule } from '@/spec/narration-schedule';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..');
const PROJECT = 'moenarch-materialized-audio';
const FAKE_OUTPUT = { path: '/renders/fake.mp4', sha256: 'a'.repeat(64), bytes: 1234 };
const SHA256 = /^[0-9a-f]{64}$/;

const TONE_PARAMETERS = { waveform: 'sine', sampleRate: 8000, channels: 1, frameCount: 16000, frequencyHz: 440, amplitude: 8000 };
const SHAPED_PARAMETERS = { attackFrames: 400, decayFrames: 800, sustainLevelQ15: 20000, releaseFrames: 1600 };

const canonicalAudio = (provenance: Json) => ({
  audio: {
    channelLayout: 'mono',
    channels: 1,
    codec: 'pcm-s16le',
    duration: { denominator: 8000, numerator: 16000 },
    frameCount: 16000,
    sampleRate: 8000,
    schemaVersion: 1,
  },
  provenance,
});
const audioRef = (sha256: string, byteLength: number, metadata: Json) => ({ schemaVersion: 1, kind: 'audio', mediaType: 'audio/wav', sha256, byteLength, metadata });

/** asset-tooling 61d71f7: audio.oscillator@1 of TONE_PARAMETERS. */
const TONE = audioRef('d48c98beddf5202012336bdfd5269c5d392fd2b482c24bd0abf3a0f0e19266e5', 32044, canonicalAudio({ inputs: [], operation: { id: 'audio.oscillator', version: '1' } }));
const adsrMetadata = canonicalAudio({ inputs: [{ port: 'source', sha256: TONE.sha256 }], operation: { id: 'audio.adsr', version: '1' } });
/** asset-tooling 61d71f7: audio.adsr@1 of SHAPED_PARAMETERS applied to TONE. */
const SHAPED = audioRef('4b3b9d6b07fd861f13bbec2a90686f29d31f2d29276877099ef8b9ed231b813f', 32044, adsrMetadata);
/** The same with sustainLevelQ15 12000 instead of 20000. */
const SHAPED_SUSTAIN_12000 = audioRef('2de5467abd314c00d8d58ba4598e29d9eef29ec904c690da758cc771b2069465', 32044, adsrMetadata);
/** public/fixtures/narration/hook.wav = narrationWav(2450, 220) (#16 table). */
const LOCAL_HOOK = { sha256: '7fcbe09842d61da37fbc92be7a47dabc0408b44a2342341ecf655174791d0ed9', byteLength: 19644, mediaType: 'audio/wav', kind: 'audio' };

const MANIFEST = {
  schema: 'interactive-videos/asset-requests',
  schemaVersion: 1,
  project: PROJECT,
  slots: {
    'narration.local': { local: 'public/fixtures/narration/hook.wav' },
    'narration.shaped': { operation: { id: 'audio.adsr', version: '1' }, parameters: SHAPED_PARAMETERS, inputs: { source: 'narration.tone' } },
    'narration.tone': { operation: { id: 'audio.oscillator', version: '1' }, parameters: TONE_PARAMETERS, inputs: {} },
  },
};

const tmp = mkdtempSync(join(tmpdir(), 'iv-materialize-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
let count = 0;
const freshRoot = () => {
  const dir = join(tmp, `root-${(count += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Every object digest below an asset-tooling root. */
function storedDigests(root: string): string[] {
  const dir = join(root, '.asset-tooling', 'objects', 'v1', 'sha256');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((prefix) => readdirSync(join(dir, prefix))).sort();
}

function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

type Call = { operation: string; parameters: Json; inputs: Json };

/** The default operations with counting executors (and optionally another implementation identity). */
function instrumented(transformImplementation?: (identity: Json) => Json) {
  const calls: Call[] = [];
  const operations = (DEFAULT_ASSET_OPERATIONS as unknown as readonly Json[]).map((operation) => ({
    ...operation,
    implementation: async (root: string, invocation: Json) => {
      const identity = await operation.implementation(root, invocation);
      return transformImplementation ? transformImplementation(identity) : identity;
    },
    execute: async (root: string, invocation: Json) => {
      calls.push({ operation: `${operation.descriptor.id}@${operation.descriptor.version}`, parameters: invocation.parameters, inputs: invocation.inputs });
      return operation.execute(root, invocation);
    },
  }));
  return { operations, calls };
}

type Environment = { catalog?: Catalog; root: string; requests?: (id: string) => unknown; operations?: readonly Json[] };

async function materialize(projectId: string, { catalog: injected = catalog, ...rest }: Environment): Promise<Json> {
  // Failures are results, not rejections.
  return (await materializeProject(projectId, { catalog: injected, sourceRoot: ROOT, ...rest } as never)) as Json;
}

async function materializeOk(projectId: string, environment: Environment) {
  const result = await materialize(projectId, environment);
  if (!result.ok) throw new Error(`unexpected ${result.error.reason} (${result.error.slot}): ${result.error.message}`);
  expect(result.project).toBe(projectId);
  return result.slots as Json[];
}

async function materializeError(projectId: string, environment: Environment) {
  const result = await materialize(projectId, environment);
  expect(result.ok, `expected ${projectId} to fail`).toBe(false);
  expect(Object.keys(result.error).sort()).toEqual(['message', 'reason', 'slot']);
  expect(['invalid-requests', 'unknown-operation', 'asset-lock-mismatch', 'materialize-failed']).toContain(result.error.reason);
  expect(String(result.error.message).length).toBeGreaterThan(0);
  return result.error as { reason: string; slot: string | null; message: string };
}

const bySlot = (slots: Json[]) => Object.fromEntries(slots.map((slot) => [slot.id, slot]));
const provenanceOf = (slot: Json) => ({ status: slot.status, operation: slot.operation, cacheKey: slot.cacheKey });
const fixtureSpec = () => catalog.spec(PROJECT) as unknown as Json;
const lockOf = (spec: Json, slotId: string) => (spec.assets as Json[]).find((slot) => slot.id === slotId)!.asset;

function jobFor(projectId: string, root: string, materialized: Json[] | undefined, injected: Catalog = catalog) {
  const parsed = parseRenderArgs(['--project', projectId]);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return resolveRenderJob(parsed.args, { catalog: injected, cwd: ROOT, assetStore: root, materialized } as never);
}

/** A copy of the fixture spec under another id, with chosen slot locks. */
function fixtureClone(id: string, locks: Record<string, Json> = {}): Json {
  const spec = structuredClone(fixtureSpec());
  spec.project = { ...spec.project, id };
  for (const slot of spec.assets as Json[]) if (locks[slot.id]) slot.asset = locks[slot.id];
  return spec;
}
const manifestFor = (project: string, slots: Json = MANIFEST.slots) => ({ ...structuredClone(MANIFEST), project, slots: structuredClone(slots) });

describe('the fixture project and its sidecar request manifest', () => {
  it('is a catalog project whose spec locks the independently computed asset-tooling outputs', () => {
    const spec = fixtureSpec();
    expect(spec, `${PROJECT} is registered in the catalog`).toBeDefined();
    expect(spec.format.id).toBe('moenarch-short');
    expect((spec.assets as Json[]).map((slot) => [slot.id, slot.kind])).toEqual([
      ['narration.local', 'audio'],
      ['narration.shaped', 'audio'],
      ['narration.tone', 'audio'],
    ]);
    // Operation slots lock the exact asset-tooling AssetRef; the local slot locks the file's identity.
    expect(lockOf(spec, 'narration.tone')).toEqual(TONE);
    expect(lockOf(spec, 'narration.shaped')).toEqual(SHAPED);
    const local = lockOf(spec, 'narration.local');
    expect({ sha256: local.sha256, byteLength: local.byteLength, mediaType: local.mediaType, kind: local.kind }).toEqual(LOCAL_HOOK);
    expect(RENDER_PROFILES.some((profile) => spec.output.width * profile.aspect.height === spec.output.height * profile.aspect.width)).toBe(true);
  });

  it('plays every audio slot in a narration segment, so the Player loads each one', () => {
    const schedule = narrationSchedule(catalog.spec(PROJECT)!);
    const played = new Set(schedule.scenes.filter((scene) => scene.audio && scene.audio.segments.length > 0).map((scene) => scene.audio!.asset));
    expect([...played].sort()).toEqual(['narration.local', 'narration.shaped', 'narration.tone']);
  });

  it('keeps its requests in the sidecar next to the spec, not in the VideoSpec', () => {
    const path = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.asset-requests.json`);
    expect(existsSync(join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`))).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(MANIFEST);
    expect(loadAssetRequests(PROJECT)).toEqual(MANIFEST);
    // The spec holds only the locks; request data (parameters, local sources) stays in the sidecar.
    expect(JSON.stringify(fixtureSpec())).not.toMatch(/"parameters"|"local"\s*:|"frequencyHz"|"sustainLevelQ15"/);
  });

  it('leaves projects without a sidecar without requests', () => {
    expect(loadAssetRequests('moenarch-narration')).toBeUndefined();
    expect(loadAssetRequests('latency-explainer')).toBeUndefined();
  });

  it('includes the deterministic procedural audio operations by default', () => {
    const ids = (DEFAULT_ASSET_OPERATIONS as unknown as readonly Json[]).map((operation) => `${operation.descriptor.id}@${operation.descriptor.version}`);
    expect(ids).toEqual(expect.arrayContaining(['audio.oscillator@1', 'audio.adsr@1']));
  });
});

describe('cold materialization (empty store)', () => {
  it('misses every requested slot, stores objects equal to the spec AssetRefs and reports them in the v2 result', async () => {
    const root = freshRoot();
    const { operations, calls } = instrumented();
    const slots = await materializeOk(PROJECT, { root, operations });

    expect(slots.map((slot) => Object.keys(slot).sort())).toEqual(slots.map(() => ['asset', 'cacheKey', 'id', 'kind', 'operation', 'status']));
    expect(slots.map((slot) => slot.id)).toEqual(['narration.local', 'narration.shaped', 'narration.tone']);
    const slot = bySlot(slots);
    expect(provenanceOf(slot['narration.tone'])).toEqual({ status: 'miss', operation: { id: 'audio.oscillator', version: '1' }, cacheKey: expect.stringMatching(SHA256) });
    expect(provenanceOf(slot['narration.shaped'])).toEqual({ status: 'miss', operation: { id: 'audio.adsr', version: '1' }, cacheKey: expect.stringMatching(SHA256) });
    expect(provenanceOf(slot['narration.local'])).toEqual({ status: 'local', operation: null, cacheKey: null });
    expect(slot['narration.tone'].asset).toEqual(TONE);
    expect(slot['narration.shaped'].asset).toEqual(SHAPED);
    expect(slot['narration.local'].asset).toMatchObject(LOCAL_HOOK);
    expect(calls.map((call) => call.operation).sort()).toEqual(['audio.adsr@1', 'audio.oscillator@1']);
    // The adsr input is the materialized tone (inputs name slots; the executor gets AssetRefs).
    expect(calls.find((call) => call.operation === 'audio.adsr@1')!.inputs).toEqual({ source: TONE });

    // One asset-tooling store: the objects verify with asset-tooling's own API and nothing else is stored.
    for (const lock of [TONE, SHAPED, { ...LOCAL_HOOK, schemaVersion: 1, metadata: {} }]) {
      await expect(verifyAssetObject(root, lock)).resolves.toMatchObject({ sha256: lock.sha256, byteLength: lock.byteLength });
      expect(existsSync(assetObjectPath(root, lock.sha256))).toBe(true);
    }
    expect(storedDigests(root)).toEqual([LOCAL_HOOK.sha256, SHAPED.sha256, TONE.sha256].sort());
    expect(existsSync(join(root, '.asset-store'))).toBe(false);

    // The render job resolves from the same store; the v2 result carries identity plus provenance.
    const resolved = jobFor(PROJECT, root, slots);
    if (!resolved.ok) throw new Error(`${resolved.error.reason}: ${resolved.error.message}`);
    // Format packs see only resolved inputs: no provenance or request data in the job's assets.
    expect(resolved.job.assets.map((asset: Json) => Object.keys(asset).sort())).toEqual(slots.map(() => ['byteLength', 'id', 'kind', 'mediaType', 'sha256', 'src']));
    const result = assertRenderResult(createRenderResult(resolved.job, FAKE_OUTPUT));
    expect(result.schemaVersion).toBe(2);
    expect(result.assets).toEqual(
      slots.map((materialized) => ({
        id: materialized.id,
        kind: 'audio',
        src: expect.stringContaining(materialized.asset.sha256),
        sha256: materialized.asset.sha256,
        byteLength: materialized.asset.byteLength,
        mediaType: 'audio/wav',
        provenance: provenanceOf(materialized),
      })),
    );
  });
});

describe('warm rebuild', () => {
  it('hits every requested slot without invoking an executor and keeps identities and cache keys', async () => {
    const root = freshRoot();
    const cold = bySlot(await materializeOk(PROJECT, { root }));
    const { operations, calls } = instrumented();
    const warm = await materializeOk(PROJECT, { root, operations });
    expect(calls).toEqual([]);
    const slot = bySlot(warm);
    expect(slot['narration.tone'].status).toBe('hit');
    expect(slot['narration.shaped'].status).toBe('hit');
    expect(slot['narration.local'].status).toBe('local');
    for (const id of Object.keys(cold)) {
      expect(slot[id].cacheKey, id).toBe(cold[id].cacheKey);
      expect(slot[id].operation, id).toEqual(cold[id].operation);
      expect(slot[id].asset, id).toEqual(cold[id].asset);
    }
  });
});

describe('changing a request', () => {
  const changed = () => {
    const slots = structuredClone(MANIFEST.slots) as Json;
    slots['narration.shaped'].parameters.sustainLevelQ15 = 12000;
    return slots;
  };

  it('changes only that slot\'s cache key; the other slots stay hit', async () => {
    const root = freshRoot();
    const cold = bySlot(await materializeOk(PROJECT, { root }));
    // Same project, with the lock updated to the new output (an author re-locking after a change).
    const relocked = createCatalog([{ spec: fixtureClone(PROJECT, { 'narration.shaped': SHAPED_SUSTAIN_12000 }), format: moenarchShort() }], PROJECT);
    const { operations, calls } = instrumented();
    const slot = bySlot(await materializeOk(PROJECT, { catalog: relocked, root, operations, requests: () => manifestFor(PROJECT, changed()) }));
    expect(slot['narration.tone'].status).toBe('hit');
    expect(slot['narration.tone'].cacheKey).toBe(cold['narration.tone'].cacheKey);
    expect(slot['narration.local'].status).toBe('local');
    expect(slot['narration.shaped'].status).toBe('miss');
    expect(slot['narration.shaped'].cacheKey).toMatch(SHA256);
    expect(slot['narration.shaped'].cacheKey).not.toBe(cold['narration.shaped'].cacheKey);
    expect(slot['narration.shaped'].asset).toEqual(SHAPED_SUSTAIN_12000);
    expect(calls.map((call) => call.operation)).toEqual(['audio.adsr@1']);
  });

  it('fails with a structured lock-mismatch diagnostic naming the slot when the output differs from the spec AssetRef', async () => {
    const root = freshRoot();
    const error = await materializeError(PROJECT, { root, requests: () => manifestFor(PROJECT, changed()) });
    expect(error.reason).toBe('asset-lock-mismatch');
    expect(error.slot).toBe('narration.shaped');
    expect(error.message).toContain('narration.shaped');
    expect(error.message).toContain(SHAPED.sha256);
    expect(error.message).toContain(SHAPED_SUSTAIN_12000.sha256);
  });

  it('fails with a lock mismatch when a local source does not have the locked identity', async () => {
    const slots = structuredClone(MANIFEST.slots) as Json;
    slots['narration.local'] = { local: 'public/fixtures/narration/point.wav' };
    const error = await materializeError(PROJECT, { root: freshRoot(), requests: () => manifestFor(PROJECT, slots) });
    expect(error.reason).toBe('asset-lock-mismatch');
    expect(error.slot).toBe('narration.local');
    expect(error.message).toContain(LOCAL_HOOK.sha256);
  });
});

describe('implementation identity', () => {
  it('uses asset-tooling\'s own cache key, which carries its pinned tool source fingerprint', async () => {
    const root = freshRoot();
    const slot = bySlot(await materializeOk(PROJECT, { root }));
    const build = await createAudioOscillatorOperationBuildIdentity(root, { parameters: TONE_PARAMETERS });
    expect((build.implementation as Json).tool?.sourceFingerprint?.sha256).toMatch(SHA256);
    expect(slot['narration.tone'].cacheKey).toBe(
      createAssetOperationCacheKey({ operation: AUDIO_OSCILLATOR_OPERATION, implementation: build.implementation, parameters: TONE_PARAMETERS, inputs: {} }),
    );
  });

  it('misses when the implementation identity changes (an asset-tooling bump), with the same deterministic bytes', async () => {
    const root = freshRoot();
    const before = bySlot(await materializeOk(PROJECT, { root }));
    const { operations, calls } = instrumented((identity) => ({ ...identity, version: `${identity.version}-bumped` }));
    const after = bySlot(await materializeOk(PROJECT, { root, operations }));
    for (const id of ['narration.tone', 'narration.shaped']) {
      expect(after[id].status, id).toBe('miss');
      expect(after[id].cacheKey, id).not.toBe(before[id].cacheKey);
      expect(after[id].asset, id).toEqual(before[id].asset);
    }
    expect(after['narration.local'].status).toBe('local');
    expect(calls.map((call) => call.operation).sort()).toEqual(['audio.adsr@1', 'audio.oscillator@1']);
  });
});

describe('corrupt stored results fail closed', () => {
  it('never reuses an output object whose bytes were tampered with', async () => {
    const root = freshRoot();
    await materializeOk(PROJECT, { root });
    const path = assetObjectPath(root, SHAPED.sha256);
    rmSync(path, { force: true });
    writeFileSync(path, Buffer.alloc(SHAPED.byteLength, 1));
    const error = await materializeError(PROJECT, { root });
    expect(error.slot).toBe('narration.shaped');
    expect(error.message).toContain('narration.shaped');
    // #16 behaviour at the new store location: the render job refuses the object too.
    const resolved = jobFor(PROJECT, root, undefined);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.reason).toBe('asset-mismatch');
      expect(resolved.error.message).toContain('narration.shaped');
    }
  });

  it('never reports a hit for a recorded result whose output object is gone', async () => {
    const root = freshRoot();
    await materializeOk(PROJECT, { root });
    rmSync(assetObjectPath(root, SHAPED.sha256), { force: true });
    const missing = jobFor(PROJECT, root, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.reason).toBe('missing-asset');
      expect(missing.error.message).toContain('narration.shaped');
    }
    const result = await materialize(PROJECT, { root });
    if (result.ok) {
      // Re-execution is acceptable; a reused (hit) result is not.
      expect(bySlot(result.slots)['narration.shaped'].status).toBe('miss');
      await expect(verifyAssetObject(root, SHAPED)).resolves.toBeDefined();
    } else {
      expect(result.error.slot).toBe('narration.shaped');
    }
  });

  it('never reports a hit from a corrupt operation result entry', async () => {
    const root = freshRoot();
    await materializeOk(PROJECT, { root });
    const entries = filesBelow(join(root, '.asset-tooling', 'cache'));
    expect(entries.length, 'asset-tooling recorded operation results under .asset-tooling/cache').toBeGreaterThan(0);
    for (const entry of entries) writeFileSync(entry, '{ not json');
    const result = await materialize(PROJECT, { root });
    if (result.ok) {
      for (const slot of result.slots as Json[]) expect(slot.status, slot.id).not.toBe('hit');
    } else {
      expect(['narration.tone', 'narration.shaped']).toContain(result.error.slot);
    }
  });
});

describe('project selection', () => {
  it('materializing project A reads and executes no request of project B', async () => {
    const root = freshRoot();
    const injected = createCatalog(
      [
        { spec: fixtureClone('materialize-a'), format: moenarchShort() },
        { spec: fixtureClone('materialize-b', { 'narration.tone': audioRef('e'.repeat(64), 32044, {}) }), format: moenarchShort() },
      ],
      'materialize-a',
    );
    const asked: string[] = [];
    const bSlots = structuredClone(MANIFEST.slots) as Json;
    bSlots['narration.tone'].parameters.frequencyHz = 880;
    bSlots['narration.shaped'] = { operation: { id: 'audio.does-not-exist', version: '1' }, parameters: {}, inputs: {} };
    const requests = (id: string) => {
      asked.push(id);
      return id === 'materialize-a' ? manifestFor('materialize-a') : manifestFor('materialize-b', bSlots);
    };
    const { operations, calls } = instrumented();
    const slots = await materializeOk('materialize-a', { catalog: injected, root, requests, operations });
    expect(slots.map((slot) => slot.asset.sha256).sort()).toEqual([LOCAL_HOOK.sha256, SHAPED.sha256, TONE.sha256].sort());
    expect(asked.filter((id) => id !== 'materialize-a')).toEqual([]);
    expect(calls.map((call) => call.parameters.frequencyHz).filter((frequency) => frequency !== undefined)).toEqual([440]);
    expect(storedDigests(root)).toEqual([LOCAL_HOOK.sha256, SHAPED.sha256, TONE.sha256].sort());
  });
});

describe('local and pre-generated slots', () => {
  it('resolve from a clean store with no operation and no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('materialization must not use the network');
    });
    const gallery = catalog.spec('moenarch-scene-gallery') as unknown as Json;
    const image = (gallery.assets as Json[]).find((slot) => slot.kind === 'image')!;
    const requests = (id: string) =>
      id === 'moenarch-scene-gallery'
        ? manifestFor('moenarch-scene-gallery', { [image.id]: { local: 'public/fixtures/scene-gallery/media-reveal.png' } })
        : undefined;
    const root = freshRoot();
    const { operations, calls } = instrumented();
    const slots = await materializeOk('moenarch-scene-gallery', { root, requests, operations });
    expect(slots.map(provenanceOf)).toEqual((gallery.assets as Json[]).map(() => ({ status: 'local', operation: null, cacheKey: null })));
    expect(bySlot(slots)[image.id].asset).toMatchObject({ sha256: image.asset.sha256, byteLength: image.asset.byteLength });
    expect(Buffer.from(await resolveAssetObject(root, bySlot(slots)[image.id].asset)).equals(readFileSync(join(ROOT, 'public', 'fixtures', 'scene-gallery', 'media-reveal.png')))).toBe(true);
    expect(calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('materializes every catalog project from a clean store; projects without requests are all local', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('materialization must not use the network');
    });
    expect(catalog.projects.map(({ id }) => id)).toContain(PROJECT);
    for (const { id } of catalog.projects) {
      const root = freshRoot();
      const slots = await materializeOk(id, { root });
      const spec = catalog.spec(id) as unknown as Json;
      expect(slots.map((slot) => slot.id), id).toEqual((spec.assets as Json[]).map((slot) => slot.id));
      for (const slot of slots) {
        const lock = lockOf(spec, slot.id);
        expect({ sha256: slot.asset.sha256, byteLength: slot.asset.byteLength }, `${id}/${slot.id}`).toEqual({ sha256: lock.sha256, byteLength: lock.byteLength });
        await expect(verifyAssetObject(root, slot.asset)).resolves.toBeDefined();
        if (loadAssetRequests(id) === undefined) expect(provenanceOf(slot), `${id}/${slot.id}`).toEqual({ status: 'local', operation: null, cacheKey: null });
      }
      const portrait = RENDER_PROFILES.some((profile) => spec.output.width * profile.aspect.height === spec.output.height * profile.aspect.width);
      if (!portrait) continue;
      const resolved = jobFor(id, root, slots);
      if (!resolved.ok) throw new Error(`${id}: ${resolved.error.reason}: ${resolved.error.message}`);
      const result = assertRenderResult(createRenderResult(resolved.job, FAKE_OUTPUT));
      expect(result.assets.map((asset: Json) => asset.provenance), id).toEqual(slots.map(provenanceOf));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('request manifest validation', () => {
  const run = (slots: Json, project = PROJECT) => materializeError(PROJECT, { root: freshRoot(), requests: () => ({ ...manifestFor(project, slots) }) });

  it('refuses an unknown operation, naming the slot', async () => {
    const slots = structuredClone(MANIFEST.slots) as Json;
    slots['narration.tone'].operation = { id: 'audio.oscillator', version: '99' };
    const error = await run(slots);
    expect(error.reason).toBe('unknown-operation');
    expect(error.slot).toBe('narration.tone');
    expect(error.message).toContain('audio.oscillator');
  });

  it.each([
    ['a request for a slot the spec does not declare', (slots: Json) => ({ ...slots, 'narration.extra': { local: 'public/fixtures/narration/point.wav' } }), 'narration.extra'],
    ['a spec slot without a request', (slots: Json) => { const { ['narration.local']: _omitted, ...rest } = slots; return rest; }, 'narration.local'],
    ['an input naming an unknown slot', (slots: Json) => ({ ...slots, 'narration.shaped': { ...slots['narration.shaped'], inputs: { source: 'narration.nowhere' } } }), 'narration.shaped'],
    ['a local source outside the source root', (slots: Json) => ({ ...slots, 'narration.local': { local: '../outside.wav' } }), 'narration.local'],
    ['a request with both operation and local', (slots: Json) => ({ ...slots, 'narration.tone': { ...slots['narration.tone'], local: 'public/fixtures/narration/hook.wav' } }), 'narration.tone'],
  ])('refuses %s as invalid-requests naming the slot', async (_label, edit, slotId) => {
    const error = await run(edit(structuredClone(MANIFEST.slots)));
    expect(error.reason).toBe('invalid-requests');
    expect(error.slot).toBe(slotId);
    expect(error.message).toContain(slotId);
  });

  it('refuses a manifest for another project', async () => {
    const error = await run(structuredClone(MANIFEST.slots), 'moenarch-narration');
    expect(error.reason).toBe('invalid-requests');
    expect(error.message).toContain('moenarch-narration');
  });
});
