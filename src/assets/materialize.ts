// Materialization of a project's asset slots through asset-tooling (#17), outside the render path.
//
// A project may keep a sidecar request manifest next to its spec,
// `src/spec/fixtures/<project id>.asset-requests.json`, that says per slot how its bytes are made:
// an asset-tooling operation (id@version, parameters, inputs naming other slots) or a local file.
// The VideoSpec slot's AssetRef stays the lock: the materialized object must have exactly that
// identity, otherwise materialization fails with a diagnostic naming the slot. Projects without a
// manifest are all local, filled from the network-free source import (asset-store.ts, #16).
//
// Operation slots run through asset-tooling's `runAssetOperation`, which owns reuse: an unchanged
// build identity is a verified `hit` without execution, anything corrupt fails closed. There is no
// second cache or index here. Everything lands in one store, asset-tooling's
// `<root>/.asset-tooling/objects/v1`, which the render job then resolves from.
//
// A slot may also be *committed* (#82, ADR 0002): bytes an operation produced in an explicit local
// step (for example Kokoro narration through `audio.model.generate@2`), checked into the repository
// (Git LFS) together with the request that made them. The request is provenance, never an
// instruction: the operation is not looked up or run here, the committed file is verified against
// the slot lock and stored, and the slot reports `status: 'committed'` with the request's operation.
//
// Only the deterministic, in-process operations are registered by default; no subprocess, network,
// model or generation backend is reachable from this module (render.architecture.test.ts). The
// render CLI and the Vite build call it before resolving or emitting assets; format packs and the
// render root never import it. Relative imports only, so Vite's module runner can load it.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AssetOperationInvocation,
  AssetOperationResult,
  AssetPortMap,
  AssetRef as ToolAssetRef,
  ReadonlyAssetOperationDescriptor,
} from 'asset-tooling/operations';
import {
  AUDIO_ADSR_OPERATION,
  AUDIO_OSCILLATOR_OPERATION,
  createAudioAdsrOperationBuildIdentity,
  createAudioOscillatorOperationBuildIdentity,
  executeAudioAdsrOperation,
  executeAudioOscillatorOperation,
} from 'asset-tooling/operations/audio/procedural';
import { runAssetOperation, storeAssetObject, verifyAssetObject, type AssetOperationImplementationIdentity } from 'asset-tooling/operations/store';

import { parseContentAssetRef, type AssetKind, type ContentAssetRef, type VideoSpec } from '../spec/video-spec';
import { findSourceAsset, loadSourceAsset, sha256Hex } from './asset-store';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_DIR = join(REPOSITORY_ROOT, 'src', 'spec', 'fixtures');

export const ASSET_REQUESTS_SCHEMA = 'interactive-videos/asset-requests';
export const ASSET_REQUESTS_SCHEMA_VERSION = 1;

/** One asset-tooling operation IV can materialize slots with. */
export type MaterializeOperation = {
  /** The asset-tooling descriptor (id, version, ports, parameter schema). */
  descriptor: ReadonlyAssetOperationDescriptor;
  /** The output-affecting implementation identity; built-ins use asset-tooling's own. */
  implementation(root: string, invocation: AssetOperationInvocation): Promise<AssetOperationImplementationIdentity>;
  /** The asset-tooling executor; it stores its outputs below `root`. */
  execute(root: string, invocation: AssetOperationInvocation): Promise<AssetOperationResult>;
};

/** The deterministic procedural audio operations of the pinned asset-tooling. */
export const DEFAULT_ASSET_OPERATIONS: readonly MaterializeOperation[] = [
  {
    descriptor: AUDIO_OSCILLATOR_OPERATION,
    implementation: async (root, invocation) => (await createAudioOscillatorOperationBuildIdentity(root, invocation)).implementation,
    execute: executeAudioOscillatorOperation,
  },
  {
    descriptor: AUDIO_ADSR_OPERATION,
    implementation: async (root, invocation) => (await createAudioAdsrOperationBuildIdentity(root, invocation)).implementation,
    execute: executeAudioAdsrOperation,
  },
];

export type MaterializeStatus = 'hit' | 'miss' | 'local' | 'committed';

/** One slot as materialized: its lock-equal AssetRef and how it was obtained. */
export type MaterializedSlot = {
  id: string;
  kind: AssetKind;
  /**
   * `hit`/`miss` are asset-tooling's `run.status`; `local` is a source or pre-generated slot;
   * `committed` is a checked-in operation output verified against its lock, never executed.
   */
  status: MaterializeStatus;
  operation: { id: string; version: string } | null;
  /** asset-tooling's `run.cacheKey`; null for local and committed slots. */
  cacheKey: string | null;
  asset: ContentAssetRef;
};

export type MaterializeErrorReason = 'invalid-requests' | 'unknown-operation' | 'asset-lock-mismatch' | 'materialize-failed';

export type MaterializeError = { reason: MaterializeErrorReason; slot: string | null; message: string };

export type MaterializeResult =
  | { ok: true; project: string; slots: MaterializedSlot[] }
  | { ok: false; error: MaterializeError };

export type MaterializeEnvironment = {
  /** Where the project's spec (and so its slot locks) comes from. */
  catalog: { spec(id: string): VideoSpec | undefined };
  /** The asset-tooling root; objects land in `<root>/.asset-tooling/objects/v1`. */
  root: string;
  /** `local` request paths resolve against this directory and may not leave it. */
  sourceRoot: string;
  /** The project's request manifest, if any; defaults to the sidecar file. */
  requests?: (projectId: string) => unknown;
  operations?: readonly MaterializeOperation[];
};

type Json = Record<string, unknown>;

type OperationRequest = { kind: 'operation'; operation: { id: string; version: string }; parameters: Json; inputs: Record<string, string> };
type LocalRequest = { kind: 'local'; path: string };
type CommittedRequest = { kind: 'committed'; path: string; operation: { id: string; version: string } };
type SlotRequest = OperationRequest | LocalRequest | CommittedRequest;

const COMMITTED_FIELDS = ['committed', 'operation', 'adapter', 'parameters', 'inputs', 'evidence'];
const COMMITTED_REQUIRED = ['committed', 'operation', 'adapter', 'parameters'];

/** The first line of a Git LFS pointer file: a checkout without `lfs: true` has these, not the bytes. */
const LFS_POINTER = Buffer.from('version https://git-lfs.github.com/spec/v1');

class Failure extends Error {
  constructor(readonly reason: MaterializeErrorReason, readonly slot: string | null, message: string) {
    super(message);
  }
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** The path of a project's sidecar request manifest. */
export function assetRequestsPath(projectId: string): string {
  return join(FIXTURE_DIR, `${projectId}.asset-requests.json`);
}

/** Reads a project's sidecar request manifest, or undefined when the project has none. */
export function loadAssetRequests(projectId: string): unknown {
  if (!PROJECT_ID.test(projectId)) return undefined;
  const path = assetRequestsPath(projectId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const isPlainObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const describe = (value: unknown) => JSON.stringify(value) ?? String(value);

/** Validates a manifest against the project's spec; returns the requests in spec slot order. */
function parseRequests(projectId: string, spec: VideoSpec, manifest: unknown): Map<string, SlotRequest> {
  const invalid = (slot: string | null, message: string) => new Failure('invalid-requests', slot, `${projectId}: ${message}`);
  if (!isPlainObject(manifest)) throw invalid(null, 'the asset request manifest must be a JSON object');
  const unknownKeys = Object.keys(manifest).filter((key) => !['schema', 'schemaVersion', 'project', 'slots'].includes(key));
  if (unknownKeys.length > 0) throw invalid(null, `the asset request manifest has unknown fields ${unknownKeys.join(', ')}`);
  if (manifest.schema !== ASSET_REQUESTS_SCHEMA || manifest.schemaVersion !== ASSET_REQUESTS_SCHEMA_VERSION) {
    throw invalid(null, `the asset request manifest must be ${ASSET_REQUESTS_SCHEMA} schemaVersion ${ASSET_REQUESTS_SCHEMA_VERSION}`);
  }
  if (manifest.project !== projectId) {
    throw invalid(null, `the asset request manifest is for project ${describe(manifest.project)}, not ${describe(projectId)}`);
  }
  if (!isPlainObject(manifest.slots)) throw invalid(null, 'the asset request manifest needs a "slots" object');
  const slots = manifest.slots;
  const declared = new Set(spec.assets.map((slot) => slot.id));
  for (const id of Object.keys(slots)) {
    if (!declared.has(id)) throw invalid(id, `the request for slot "${id}" names no slot of the spec`);
  }

  const requests = new Map<string, SlotRequest>();
  for (const { id } of spec.assets) {
    if (!Object.hasOwn(slots, id)) throw invalid(id, `spec slot "${id}" has no request; a manifest declares every slot exactly once`);
    const entry = slots[id];
    if (!isPlainObject(entry)) throw invalid(id, `the request for slot "${id}" must be an object`);

    if (Object.hasOwn(entry, 'committed')) {
      const extra = Object.keys(entry).filter((key) => !COMMITTED_FIELDS.includes(key));
      if (extra.length > 0) throw invalid(id, `the committed request for slot "${id}" has unknown fields ${extra.join(', ')}`);
      const missing = COMMITTED_REQUIRED.filter((key) => !Object.hasOwn(entry, key));
      if (missing.length > 0) throw invalid(id, `the committed request for slot "${id}" needs ${missing.join(', ')} (how the bytes were made)`);
      if (typeof entry.committed !== 'string' || entry.committed === '' || isAbsolute(entry.committed)) {
        throw invalid(id, `the committed request for slot "${id}" must name a repository-relative file`);
      }
      const operation = entry.operation;
      if (!isPlainObject(operation) || typeof operation.id !== 'string' || typeof operation.version !== 'string' || Object.keys(operation).length !== 2) {
        throw invalid(id, `the committed request for slot "${id}" needs "operation": { "id", "version" } strings`);
      }
      const adapter = entry.adapter;
      if (!isPlainObject(adapter) || typeof adapter.id !== 'string' || typeof adapter.version !== 'string' || Object.keys(adapter).length !== 2) {
        throw invalid(id, `the committed request for slot "${id}" needs "adapter": { "id", "version" } strings`);
      }
      if (!isPlainObject(entry.parameters)) throw invalid(id, `the "parameters" of committed slot "${id}" must be an object`);
      if (entry.inputs !== undefined) {
        if (!isPlainObject(entry.inputs)) throw invalid(id, `the "inputs" of committed slot "${id}" must be an object of port → AssetRef`);
        for (const [port, ref] of Object.entries(entry.inputs)) {
          // The same closed AssetRef v1 contract as a spec slot's lock.
          const parsed = parseContentAssetRef(ref, `inputs.${port}`);
          if (!parsed.ok) {
            const detail = parsed.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('; ');
            throw invalid(id, `input "${port}" of committed slot "${id}" is not an AssetRef v1 (${detail})`);
          }
        }
      }
      if (entry.evidence !== undefined && !isPlainObject(entry.evidence)) throw invalid(id, `the "evidence" of committed slot "${id}" must be an object`);
      requests.set(id, { kind: 'committed', path: entry.committed, operation: { id: operation.id, version: operation.version } });
      continue;
    }

    const hasOperation = Object.hasOwn(entry, 'operation');
    const hasLocal = Object.hasOwn(entry, 'local');
    if (hasOperation === hasLocal) throw invalid(id, `the request for slot "${id}" must have exactly one of "operation" and "local"`);

    if (hasLocal) {
      const extra = Object.keys(entry).filter((key) => key !== 'local');
      if (extra.length > 0) throw invalid(id, `the local request for slot "${id}" has unknown fields ${extra.join(', ')}`);
      if (typeof entry.local !== 'string' || entry.local === '' || isAbsolute(entry.local)) {
        throw invalid(id, `the local request for slot "${id}" must be a repository-relative path`);
      }
      requests.set(id, { kind: 'local', path: entry.local });
      continue;
    }

    const extra = Object.keys(entry).filter((key) => !['operation', 'parameters', 'inputs'].includes(key));
    if (extra.length > 0) throw invalid(id, `the operation request for slot "${id}" has unknown fields ${extra.join(', ')}`);
    const operation = entry.operation;
    if (!isPlainObject(operation) || typeof operation.id !== 'string' || typeof operation.version !== 'string' || Object.keys(operation).length !== 2) {
      throw invalid(id, `the request for slot "${id}" needs "operation": { "id", "version" } strings`);
    }
    const parameters = entry.parameters ?? {};
    if (!isPlainObject(parameters)) throw invalid(id, `the "parameters" of slot "${id}" must be an object`);
    const inputs = entry.inputs ?? {};
    if (!isPlainObject(inputs)) throw invalid(id, `the "inputs" of slot "${id}" must be an object of port → slot id`);
    for (const [port, source] of Object.entries(inputs)) {
      if (typeof source !== 'string' || !declared.has(source)) {
        throw invalid(id, `input "${port}" of slot "${id}" names ${describe(source)}, which is no slot of the spec`);
      }
      if (source === id) throw invalid(id, `input "${port}" of slot "${id}" names the slot itself`);
    }
    requests.set(id, {
      kind: 'operation',
      operation: { id: operation.id, version: operation.version },
      parameters,
      inputs: inputs as Record<string, string>,
    });
  }
  return requests;
}

/** Slot ids in an order where every operation runs after the slots it reads. */
function executionOrder(projectId: string, spec: VideoSpec, requests: Map<string, SlotRequest>): string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new Failure('invalid-requests', id, `${projectId}: the inputs of slot "${id}" form a cycle`);
    state.set(id, 'visiting');
    const request = requests.get(id);
    if (request?.kind === 'operation') for (const source of Object.values(request.inputs)) visit(source);
    state.set(id, 'done');
    order.push(id);
  };
  for (const { id } of spec.assets) visit(id);
  return order;
}

/** Key-sorted JSON, so two AssetRefs compare by content rather than key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function lockMismatch(projectId: string, slotId: string, lock: ContentAssetRef, actual: { sha256: string; byteLength: number }, detail = '') {
  return new Failure(
    'asset-lock-mismatch',
    slotId,
    `${projectId}: slot "${slotId}" materialized to sha256 ${actual.sha256} (${actual.byteLength} bytes)${detail}, but the spec locks sha256 ${lock.sha256} (${lock.byteLength} bytes); re-lock the spec or restore the request`,
  );
}

/** Stores a local (or committed) source file of a slot and checks it against the lock. */
async function materializeLocal(
  projectId: string,
  slotId: string,
  lock: ContentAssetRef,
  path: string,
  environment: MaterializeEnvironment,
  what: 'local source' | 'committed file' = 'local source',
) {
  const sourceRoot = realpathSync(environment.sourceRoot);
  const absolute = resolve(sourceRoot, path);
  const outside = (target: string) => {
    const relation = relative(sourceRoot, target);
    return relation === '' || relation.startsWith('..') || isAbsolute(relation);
  };
  if (outside(absolute)) throw new Failure('invalid-requests', slotId, `${projectId}: the ${what} of slot "${slotId}" (${path}) leaves the source root`);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Failure('materialize-failed', slotId, `${projectId}: the ${what} of slot "${slotId}" (${path}) is not a file`);
  }
  if (outside(realpathSync(absolute))) {
    throw new Failure('invalid-requests', slotId, `${projectId}: the ${what} of slot "${slotId}" (${path}) resolves outside the source root`);
  }
  const bytes = readFileSync(absolute);
  if (bytes.subarray(0, LFS_POINTER.length).equals(LFS_POINTER)) {
    throw new Failure(
      'materialize-failed',
      slotId,
      `${projectId}: the ${what} of slot "${slotId}" (${path}) is a Git LFS pointer, not the file; fetch it with \`git lfs pull\` (CI and Pages check out with lfs: true)`,
    );
  }
  const actual = { sha256: sha256Hex(bytes), byteLength: bytes.length };
  if (actual.sha256 !== lock.sha256 || actual.byteLength !== lock.byteLength) {
    throw lockMismatch(projectId, slotId, lock, actual, ` from ${path}`);
  }
  await storeAssetObject(environment.root, { bytes, kind: lock.kind, mediaType: lock.mediaType, metadata: lock.metadata as never });
}

/**
 * Stores the network-free source bytes of a slot of a project without requests. Only the source
 * declaring this slot's locked identity is read or generated, never another project's.
 */
async function materializeSource(projectId: string, slotId: string, lock: ContentAssetRef, root: string) {
  const source = findSourceAsset(lock.sha256, lock.byteLength);
  if (source) {
    let bytes: Uint8Array;
    try {
      bytes = loadSourceAsset(source);
    } catch (error) {
      throw new Failure(
        'materialize-failed',
        slotId,
        `${projectId}: the source of slot "${slotId}" (sha256 ${lock.sha256}) could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await storeAssetObject(root, { bytes, kind: lock.kind, mediaType: lock.mediaType, metadata: lock.metadata as never });
    return;
  }
  // A pre-generated object that has no checked-in source must already be in the store, intact.
  try {
    await verifyAssetObject(root, lock);
  } catch (error) {
    throw new Failure(
      'materialize-failed',
      slotId,
      `${projectId}: slot "${slotId}" (sha256 ${lock.sha256}) has no request, no checked-in source and no intact stored object: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The single AssetRef an operation produced. */
function singleOutput(projectId: string, slotId: string, outputs: AssetPortMap): ToolAssetRef {
  const values = Object.values(outputs).flatMap((value) => (Array.isArray(value) ? value : [value]));
  if (values.length !== 1) {
    throw new Failure('materialize-failed', slotId, `${projectId}: the operation of slot "${slotId}" produced ${values.length} outputs; a slot takes exactly one`);
  }
  return values[0];
}

/**
 * Materializes the selected project's slots into the asset-tooling store at `root`. Only this
 * project's requests are read and executed. Resolves to the slots in spec order or to the first
 * failure; it never rejects.
 */
export async function materializeProject(projectId: string, environment: MaterializeEnvironment): Promise<MaterializeResult> {
  const { root } = environment;
  const operations = environment.operations ?? DEFAULT_ASSET_OPERATIONS;
  try {
    const spec = environment.catalog.spec(projectId);
    if (!spec) throw new Failure('materialize-failed', null, `No project with id "${projectId}" in the catalog.`);
    const locks = new Map(spec.assets.map((slot) => [slot.id, slot]));

    let manifest: unknown;
    try {
      manifest = (environment.requests ?? loadAssetRequests)(projectId);
    } catch (error) {
      throw new Failure('invalid-requests', null, `${projectId}: unreadable asset request manifest: ${error instanceof Error ? error.message : String(error)}`);
    }

    const results = new Map<string, MaterializedSlot>();
    const local = (slot: { id: string; kind: AssetKind; asset: ContentAssetRef }): MaterializedSlot => ({
      id: slot.id,
      kind: slot.kind,
      status: 'local',
      operation: null,
      cacheKey: null,
      asset: slot.asset,
    });

    if (manifest === undefined) {
      for (const slot of spec.assets) {
        await materializeSource(projectId, slot.id, slot.asset, root);
        results.set(slot.id, local(slot));
      }
    } else {
      const requests = parseRequests(projectId, spec, manifest);
      // Resolve every operation before running anything, so an unknown one fails up front.
      const registered = new Map<string, MaterializeOperation>();
      for (const [slotId, request] of requests) {
        if (request.kind !== 'operation') continue;
        const key = `${request.operation.id}@${request.operation.version}`;
        const operation = operations.find((candidate) => candidate.descriptor.id === request.operation.id && candidate.descriptor.version === request.operation.version);
        if (!operation) {
          const known = operations.map((candidate) => `${candidate.descriptor.id}@${candidate.descriptor.version}`).join(', ');
          throw new Failure('unknown-operation', slotId, `${projectId}: slot "${slotId}" requests ${key}, which is not a registered operation (known: ${known})`);
        }
        registered.set(slotId, operation);
      }

      for (const slotId of executionOrder(projectId, spec, requests)) {
        const slot = locks.get(slotId)!;
        const request = requests.get(slotId)!;
        if (request.kind === 'local') {
          await materializeLocal(projectId, slotId, slot.asset, request.path, environment);
          results.set(slotId, local(slot));
          continue;
        }
        if (request.kind === 'committed') {
          // Provenance only: verified against the lock and stored, the operation never runs.
          await materializeLocal(projectId, slotId, slot.asset, request.path, environment, 'committed file');
          results.set(slotId, { id: slotId, kind: slot.kind, status: 'committed', operation: { ...request.operation }, cacheKey: null, asset: slot.asset });
          continue;
        }
        const operation = registered.get(slotId)!;
        const inputs = Object.fromEntries(Object.entries(request.inputs).map(([port, source]) => [port, results.get(source)!.asset]));
        const invocation = { parameters: request.parameters, inputs };
        let run;
        try {
          const implementation = await operation.implementation(root, invocation);
          run = await runAssetOperation(root, { descriptor: operation.descriptor, implementation, execute: (target, executed) => operation.execute(target, executed) }, invocation);
        } catch (error) {
          throw new Failure(
            'materialize-failed',
            slotId,
            `${projectId}: slot "${slotId}" (${request.operation.id}@${request.operation.version}) failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const output = singleOutput(projectId, slotId, run.result.outputs);
        if (canonical(output) !== canonical(slot.asset)) {
          const detail = output.sha256 === slot.asset.sha256 ? ' with a different AssetRef (kind, media type or metadata)' : '';
          throw lockMismatch(projectId, slotId, slot.asset, output, detail);
        }
        results.set(slotId, {
          id: slotId,
          kind: slot.kind,
          status: run.status,
          operation: { ...request.operation },
          cacheKey: run.cacheKey,
          asset: slot.asset,
        });
      }
    }

    return { ok: true, project: projectId, slots: spec.assets.map((slot) => results.get(slot.id)!) };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, error: { reason: error.reason, slot: error.slot, message: error.message } };
    return { ok: false, error: { reason: 'materialize-failed', slot: null, message: error instanceof Error ? error.message : String(error) } };
  }
}
