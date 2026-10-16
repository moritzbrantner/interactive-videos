// Regression tests for the Codex review of PR #83 (#82), beside the acceptance contract in
// materialize-committed.test.ts:
// - a committed request's `inputs` must each be a closed AssetRef v1 (same parser as spec locks);
//   anything else is `invalid-requests` naming the slot, while the real committed sidecar passes;
// - the local regeneration refuses an asset-tooling checkout that is not exactly the pinned commit
//   (wrong HEAD, or a dirty or untracked working tree).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { assertCleanAssetToolingCheckout } from '../../scripts/narration/asset-tooling-checkout';
import { loadAssetRequests, materializeProject } from '@/assets/materialize';
import { catalog } from '@/projects';
import { parseContentAssetRef } from '@/spec/video-spec';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..');
const PROJECT = 'council-nicaea-325';
const tmp = mkdtempSync(join(tmpdir(), 'iv-committed-inputs-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let count = 0;
const fresh = () => {
  const dir = join(tmp, `store-${(count += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const manifest = () => structuredClone(loadAssetRequests(PROJECT) as Json);
const firstSlot = (requests: Json) => Object.keys(requests.slots)[0];
const materialize = (requests?: Json) =>
  materializeProject(PROJECT, { catalog, root: fresh(), sourceRoot: ROOT, operations: [], ...(requests ? { requests: () => requests } : {}) });

describe('committed request inputs are closed AssetRef v1 values', () => {
  it('accepts the committed Nicaea sidecar as it is', async () => {
    const result = await materialize();
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
  });

  it('parses the recorded model input with the spec AssetRef parser', () => {
    const model = manifest().slots[firstSlot(manifest())].inputs.model;
    expect(parseContentAssetRef(model)).toEqual({ ok: true, asset: model });
  });

  const model = () => structuredClone(manifest().slots[firstSlot(manifest())].inputs.model) as Json;
  const cases: [string, unknown][] = [
    ['a sha256 that is not a digest', { ...model(), sha256: 'not-a-digest' }],
    ['an upper-case digest', { ...model(), sha256: model().sha256.toUpperCase() }],
    ['a missing byteLength', (({ byteLength: _, ...rest }) => rest)(model())],
    ['a missing mediaType', (({ mediaType: _, ...rest }) => rest)(model())],
    ['an unknown key', { ...model(), url: 'https://example.invalid/model.zip' }],
    ['schemaVersion 2', { ...model(), schemaVersion: 2 }],
    ['a negative byteLength', { ...model(), byteLength: -1 }],
    ['a string instead of an object', model().sha256],
    ['only a sha256', { sha256: model().sha256 }],
  ];
  it.each(cases)('rejects a committed input with %s as invalid-requests naming the slot', async (_name, input) => {
    const requests = manifest();
    const slot = firstSlot(requests);
    requests.slots[slot].inputs = { model: input };
    const result = await materialize(requests);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('invalid-requests');
    expect(result.error.slot).toBe(slot);
    expect(result.error.message).toContain(slot);
    expect(result.error.message).toContain('AssetRef');
  });
});

describe('the narration regeneration only runs a clean asset-tooling checkout at the pinned revision', () => {
  const git = (cwd: string, ...args: string[]) => {
    const run = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout.trim();
  };
  const repository = () => {
    const dir = join(tmp, `checkout-${(count += 1)}`);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'tracked.txt'), 'pinned\n');
    git(dir, 'add', 'tracked.txt');
    git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'pinned');
    return { dir, head: git(dir, 'rev-parse', 'HEAD') };
  };

  it('accepts a clean checkout at the revision and returns its full commit', () => {
    const { dir, head } = repository();
    expect(assertCleanAssetToolingCheckout(dir, head.slice(0, 7))).toBe(head);
  });

  it('refuses another revision', () => {
    const { dir } = repository();
    expect(() => assertCleanAssetToolingCheckout(dir, '502e955')).toThrow(/must be at 502e955/);
  });

  it('refuses a modified tracked file', () => {
    const { dir, head } = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'changed\n');
    expect(() => assertCleanAssetToolingCheckout(dir, head.slice(0, 7))).toThrow(/local changes[\s\S]*tracked\.txt/);
  });

  it('refuses an untracked file, also inside a new directory', () => {
    const { dir, head } = repository();
    mkdirSync(join(dir, 'adapters'));
    writeFileSync(join(dir, 'adapters', 'patched.py'), '# local patch\n');
    expect(() => assertCleanAssetToolingCheckout(dir, head.slice(0, 7))).toThrow(/local changes[\s\S]*adapters\/patched\.py/);
  });
});
