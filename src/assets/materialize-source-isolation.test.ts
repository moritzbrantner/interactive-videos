// Regression for the PR #80 review (Codex): a project without a request manifest materializes from
// the network-free source fallback, and that fallback must load only the sources of the selected
// project's locked AssetRefs. Before the fix it read or generated every project's sources, so a
// broken source of project B (here: the latency explainer's dataset generator) failed project A
// and ran B's work.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { materializeProject } from '@/assets/materialize';
import { catalog } from '@/projects';
import { latencyDatasetBytes } from '@/video/latency-dataset';

// The app itself generates the dataset while modules load, so the generator breaks only once the
// tests start (and every call is counted from then on).
const generator = vi.hoisted(() => ({ broken: false }));
vi.mock('@/video/latency-dataset', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/video/latency-dataset')>();
  return {
    ...original,
    latencyDatasetBytes: vi.fn((...args: Parameters<typeof original.latencyDatasetBytes>) => {
      if (generator.broken) throw new Error('broken latency-explainer source generator');
      return original.latencyDatasetBytes(...args);
    }),
  };
});

const ROOT = join(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'iv-materialize-isolation-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  generator.broken = true;
  vi.mocked(latencyDatasetBytes).mockClear();
});
afterEach(() => {
  generator.broken = false;
});

let count = 0;
const freshRoot = () => join(tmp, `root-${(count += 1)}`);

function storedDigests(root: string): string[] {
  const dir = join(root, '.asset-tooling', 'objects', 'v1', 'sha256');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((prefix) => readdirSync(join(dir, prefix))).sort();
}

describe('source fallback of a project without requests (PR #80 review)', () => {
  it('materializes moenarch-narration although another project\'s source is broken, without running it', async () => {
    const root = freshRoot();
    const result = await materializeProject('moenarch-narration', { catalog, root, sourceRoot: ROOT });
    if (!result.ok) throw new Error(`${result.error.reason} (${result.error.slot}): ${result.error.message}`);
    expect(result.slots.map((slot) => slot.status)).toEqual(['local', 'local']);
    expect(latencyDatasetBytes).not.toHaveBeenCalled();
    const locked = catalog.spec('moenarch-narration')!.assets.map((slot) => slot.asset.sha256).sort();
    expect(storedDigests(root)).toEqual(locked);
  });

  it('still fails closed, naming the slot, when the selected project\'s own source is broken', async () => {
    const result = await materializeProject('latency-explainer', { catalog, root: freshRoot(), sourceRoot: ROOT });
    expect(latencyDatasetBytes).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('materialize-failed');
      expect(result.error.slot).toBe('latency-requests');
      expect(result.error.message).toContain('broken latency-explainer source generator');
    }
  });
});
