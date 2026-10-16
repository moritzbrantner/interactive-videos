// Render smoke for issue #82, run by `bun run test:render`, written by an independent acceptance
// context before any implementation, against baseline 3c8ad7b. Seams: header of
// src/content/councils/council-nicaea-325.test.ts and src/assets/materialize-committed.test.ts.
//
// The Nicaea I episode renders headlessly through the documented command, a few frames of its first
// narration segment, from a clean store: the CLI materializes the committed narration (verified
// against the lock, never generated) and reports its provenance as
// { status: 'committed', operation: { id: 'audio.model.generate', version: '2' }, cacheKey: null }.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { catalog } from '@/projects';
import { narrationSchedule } from '@/spec/narration-schedule';

import { assertRenderResult } from './render-result.test-support';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..');
const PROJECT = 'council-nicaea-325';
const tmp = mkdtempSync(join(tmpdir(), 'iv-nicaea-smoke-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function render(argv: string[]) {
  const run = spawnSync('bun', ['run', 'video:render', ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 280_000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' },
  });
  const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
  const context = `exit ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
  expect(lines, context).toHaveLength(1);
  return { status: run.status, json: JSON.parse(lines[0]), context };
}

describe('bun run video:render council-nicaea-325 (#82 smoke)', () => {
  it('renders narration frames with the committed narration and its operation provenance', () => {
    const spec = catalog.spec(PROJECT);
    expect(spec, `${PROJECT} is in the catalog`).toBeDefined();
    const scene = narrationSchedule(spec!).scenes.find((candidate) => candidate.audio?.segments.length);
    expect(scene, 'the episode has a narration segment').toBeDefined();
    const segment = scene!.audio!.segments[0];
    const out = join(tmp, 'nicaea.mp4');
    const run = render(['--project', PROJECT, '--frames', `${segment.from}-${segment.from + 2}`, '--out', out]);
    expect(run.status, run.context).toBe(0);
    const result = assertRenderResult(run.json);
    expect(existsSync(out)).toBe(true);
    const narration = (result.assets as Json[]).find((asset) => asset.id === scene!.audio!.asset);
    expect(narration, run.context).toBeDefined();
    const lock = (spec!.assets as unknown as Json[]).find((slot) => slot.id === scene!.audio!.asset)!.asset;
    expect({ sha256: narration!.sha256, byteLength: narration!.byteLength, mediaType: narration!.mediaType }).toEqual({
      sha256: lock.sha256,
      byteLength: lock.byteLength,
      mediaType: 'audio/wav',
    });
    expect(narration!.provenance).toEqual({ status: 'committed', operation: { id: 'audio.model.generate', version: '2' }, cacheKey: null });
  });
});
