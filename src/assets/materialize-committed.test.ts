// Acceptance contract for issue #82 (committed Kokoro narration verified in CI), written by an
// independent acceptance context before any implementation, against baseline 3c8ad7b. Owner
// decision on #82 (2026-10-16): the generated narration WAV is committed through Git LFS with its
// request and provenance; CI and Pages verify the bytes against the VideoSpec lock and never run the
// model or torch. Regeneration is an explicit local step. Seams and content layout: header of
// src/content/councils/council-nicaea-325.test.ts.
//
// Seam exercised here, extending #17's `materializeProject` (docs/specs/videospec-v2-assets.md §1.6):
//
// - A sidecar slot may be a *committed* request:
//     { "committed": "<repository-relative file>", "operation": { "id", "version" },
//       "adapter": { "id", "version" }, "parameters": {…}, "inputs": { "<port>": <AssetRef-like> },
//       "evidence": {…} }
//   `committed`, `operation`, `adapter` and `parameters` are required, unknown fields are
//   `invalid-requests` naming the slot, and the path follows the `local` rules (relative, inside
//   `sourceRoot`). The request is provenance, not an instruction: the operation is never looked up
//   or executed, so it need not be registered (`operations: []` still materializes it).
// - Materializing a committed slot reads the file, requires its bytes to have the slot lock's sha256
//   and byteLength, stores it under the lock (asset-tooling `verifyAssetObject(root, lock)` then
//   passes) and reports
//     { id, kind, status: 'committed', operation: { id, version } (from the request),
//       cacheKey: null, asset: <the lock> }.
// - Fails closed, as a result with the slot id in `slot` and in `message`:
//     tampered bytes → 'asset-lock-mismatch'; missing file → 'materialize-failed' (or
//     'asset-lock-mismatch'); a Git LFS pointer instead of the WAV (a checkout without LFS) →
//     not ok, and the message says it is an LFS pointer (mentions "LFS").
//
// "No model or process runs in CI" is asserted three ways: (1) the existing #17 architecture test
// (src/render/render.architecture.test.ts) keeps every `asset-tooling/operations/audio/model*`
// subpath and every subprocess module out of materialize.ts's import closure; (2) here,
// materialization succeeds with no registered operations at all; (3) here, every
// `node:child_process` entry point and `fetch` are replaced by recorders that throw (named ESM
// imports included, via `syncBuiltinESMExports`) while the project materializes, and none is called.
import childProcess from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { verifyAssetObject } from 'asset-tooling/operations/store';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ASSET_OPERATIONS, loadAssetRequests, materializeProject } from '@/assets/materialize';
import { catalog } from '@/projects';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..');
const PROJECT = 'council-nicaea-325';
const COMMITTED_OPERATION = { id: 'audio.model.generate', version: '2' };

const tmp = mkdtempSync(join(tmpdir(), 'iv-committed-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
let count = 0;
const fresh = (name: string) => {
  const dir = join(tmp, `${name}-${(count += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// --- no subprocess, no network ---------------------------------------------------------------

const PROCESS_ENTRY_POINTS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const processCalls: string[] = [];
const originals = new Map<string, unknown>();
beforeAll(() => {
  const target = childProcess as unknown as Record<string, unknown>;
  for (const name of PROCESS_ENTRY_POINTS) {
    originals.set(name, target[name]);
    target[name] = (...args: unknown[]) => {
      processCalls.push(`${name} ${JSON.stringify(args[0])}`);
      throw new Error(`#82: materialization must not start a process (${name})`);
    };
  }
  syncBuiltinESMExports();
});
afterAll(() => {
  const target = childProcess as unknown as Record<string, unknown>;
  for (const [name, original] of originals) target[name] = original;
  syncBuiltinESMExports();
});

function forbidNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`#82: materialization must not use the network (${String(input)})`);
  });
}

// --- helpers ---------------------------------------------------------------------------------

function spec(): Json {
  const registered = catalog.spec(PROJECT);
  expect(registered, `${PROJECT} is registered in the catalog`).toBeDefined();
  return registered as unknown as Json;
}

function manifest(): Json {
  const loaded = loadAssetRequests(PROJECT) as Json | undefined;
  expect(loaded, `src/spec/fixtures/${PROJECT}.asset-requests.json exists`).toBeDefined();
  return structuredClone(loaded!);
}

/** Narration slots: audio slots played by a scene's narration. */
function narrationSlots(): string[] {
  const ids = [...new Set((spec().scenes as Json[]).flatMap((scene) => (scene.narration?.audio ? [scene.narration.audio.asset as string] : [])))];
  expect(ids.length, 'the episode has narration audio slots').toBeGreaterThan(0);
  return ids;
}

const lockOf = (slotId: string) => (spec().assets as Json[]).find((slot) => slot.id === slotId)!.asset as Json;

/** A source root holding copies of every file the project's requests name. */
function copySources(): string {
  const root = fresh('source');
  for (const request of Object.values(manifest().slots) as Json[]) {
    const path = request.committed ?? request.local;
    if (typeof path !== 'string') continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }
  return root;
}

async function materialize(environment: { root: string; sourceRoot?: string; requests?: () => unknown; operations?: readonly unknown[] }): Promise<Json> {
  return (await materializeProject(PROJECT, { catalog, sourceRoot: ROOT, ...environment } as never)) as Json;
}

function expectFailure(result: Json, slotId: string) {
  expect(result.ok, `expected materialization to fail for ${slotId}`).toBe(false);
  expect(result.error.slot).toBe(slotId);
  expect(result.error.message).toContain(slotId);
  return result.error as { reason: string; slot: string; message: string };
}

// --- tests -----------------------------------------------------------------------------------

describe('#82 committed narration in CI: verified against the lock, never generated', () => {
  it('registers no model-backed operation by default', () => {
    const ids = (DEFAULT_ASSET_OPERATIONS as unknown as Json[]).map((operation) => `${operation.descriptor.id}@${operation.descriptor.version}`);
    expect(ids).not.toContain('audio.model.generate@1');
    expect(ids).not.toContain('audio.model.generate@2');
  });

  it('materializes the committed narration with no registered operation, no process and no network, recording its operation provenance', async () => {
    const fetchSpy = forbidNetwork();
    processCalls.length = 0;
    const root = fresh('store');
    const result = await materialize({ root, operations: [] });
    expect(result.ok, result.ok ? '' : `${result.error.reason} (${result.error.slot}): ${result.error.message}`).toBe(true);
    const bySlot = Object.fromEntries((result.slots as Json[]).map((slot) => [slot.id, slot]));
    for (const slotId of narrationSlots()) {
      expect(bySlot[slotId], slotId).toEqual({
        id: slotId,
        kind: 'audio',
        status: 'committed',
        operation: COMMITTED_OPERATION,
        cacheKey: null,
        asset: lockOf(slotId),
      });
      await expect(verifyAssetObject(root, lockOf(slotId) as never)).resolves.toMatchObject({ sha256: lockOf(slotId).sha256, byteLength: lockOf(slotId).byteLength });
    }
    expect(processCalls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gives the same record with the default operations, again without a process', async () => {
    processCalls.length = 0;
    forbidNetwork();
    const root = fresh('store');
    const first = await materialize({ root });
    const second = await materialize({ root });
    for (const result of [first, second]) {
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      for (const slotId of narrationSlots()) {
        const slot = (result.slots as Json[]).find((candidate) => candidate.id === slotId)!;
        expect({ status: slot.status, operation: slot.operation, cacheKey: slot.cacheKey }, slotId).toEqual({ status: 'committed', operation: COMMITTED_OPERATION, cacheKey: null });
      }
    }
    expect(processCalls).toEqual([]);
  });

  it('fails closed with asset-lock-mismatch naming the slot when the committed WAV is tampered with', async () => {
    const [slotId] = narrationSlots();
    const sourceRoot = copySources();
    const path = join(sourceRoot, manifest().slots[slotId].committed);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path, bytes);
    const error = expectFailure(await materialize({ root: fresh('store'), sourceRoot }), slotId);
    expect(error.reason).toBe('asset-lock-mismatch');
  });

  it('fails closed naming the slot when the committed WAV is missing', async () => {
    const [slotId] = narrationSlots();
    const sourceRoot = copySources();
    rmSync(join(sourceRoot, manifest().slots[slotId].committed));
    const error = expectFailure(await materialize({ root: fresh('store'), sourceRoot }), slotId);
    expect(['materialize-failed', 'asset-lock-mismatch']).toContain(error.reason);
  });

  it('fails closed with an LFS diagnostic when the checkout has the Git LFS pointer instead of the WAV', async () => {
    const [slotId] = narrationSlots();
    const lock = lockOf(slotId);
    const sourceRoot = copySources();
    writeFileSync(
      join(sourceRoot, manifest().slots[slotId].committed),
      `version https://git-lfs.github.com/spec/v1\noid sha256:${lock.sha256}\nsize ${lock.byteLength}\n`,
    );
    const error = expectFailure(await materialize({ root: fresh('store'), sourceRoot }), slotId);
    expect(error.message).toMatch(/LFS/);
  });

  it('rejects a committed request without its operation provenance, with unknown fields, or leaving the source root', async () => {
    const [slotId] = narrationSlots();
    const cases: [string, (request: Json) => void][] = [
      ['no operation', (request) => delete request.operation],
      ['no adapter', (request) => delete request.adapter],
      ['no parameters', (request) => delete request.parameters],
      ['unknown field', (request) => (request.execute = true)],
      ['committed and local', (request) => (request.local = request.committed)],
      ['outside the source root', (request) => (request.committed = '../outside.wav')],
    ];
    for (const [name, mutate] of cases) {
      const requests = manifest();
      mutate(requests.slots[slotId]);
      const error = expectFailure(await materialize({ root: fresh('store'), requests: () => requests }), slotId);
      expect(error.reason, name).toBe('invalid-requests');
    }
  });
});
