// Render smoke for issue #16 (content-addressed assets), run by `bun run test:render`, written by an
// independent acceptance context before the implementation. Contract:
// docs/specs/videospec-v2-assets.md §1.4–§1.5.
//
// Projects with asset slots still render headlessly through the documented command, from a store
// filled by the network-free source import: a few frames of the scene gallery's media reveal
// (image) and of the narration project's first audio segment (audio). The result reports each slot
// as its resolved immutable input { id, kind, src, sha256, byteLength, mediaType }.
//
// #17 (independent acceptance): the CLI materializes the selected project through asset-tooling
// before resolving the job, so its v2 result always carries non-null provenance: `local` for
// source slots, `hit`/`miss` with operation and cache key for requested ones; a second render of
// the unchanged project hits every requested slot with the same cache keys.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_ASSET_STORE, importSourceAssets } from '@/assets/asset-store';
import { catalog } from '@/projects';
import { narrationSchedule } from '@/spec/narration-schedule';
import { resolveTimeline } from '@/spec/video-spec';

import { assertRenderResult } from './render-result.test-support';

const ROOT = join(import.meta.dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'iv-assets-smoke-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// The CLI reads the default store; a clean checkout fills it from the checked-in sources.
beforeAll(async () => {
  await importSourceAssets(DEFAULT_ASSET_STORE);
});

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

type Json = Record<string, any>;

function expectResolvedAssets(id: string, assets: Json[]) {
  const slots = [...(catalog.spec(id)!.assets as unknown as Json[])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  expect(assets.map(({ id: slotId, kind, sha256, byteLength, mediaType }) => ({ id: slotId, kind, sha256, byteLength, mediaType }))).toEqual(
    slots.map((slot) => ({ id: slot.id, kind: slot.kind, sha256: slot.asset.sha256, byteLength: slot.asset.byteLength, mediaType: slot.asset.mediaType })),
  );
}

describe('bun run video:render with content-addressed assets (smoke)', () => {
  it('renders the scene gallery media reveal with its image resolved from the store', () => {
    const id = 'moenarch-scene-gallery';
    const scene = resolveTimeline(catalog.spec(id)!).scenes.find((candidate) => candidate.kind === 'mediaReveal')!;
    const frame = scene.from + Math.floor(scene.durationInFrames / 2);
    const out = join(tmp, 'gallery.mp4');
    const run = render(['--project', id, '--frames', `${frame}-${frame + 2}`, '--out', out]);
    expect(run.status, run.context).toBe(0);
    const result = assertRenderResult(run.json);
    expect(result.frames).toEqual({ from: frame, to: frame + 2, count: 3 });
    expectResolvedAssets(id, result.assets);
    expect(result.assets.some((asset: Json) => asset.kind === 'image')).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(JSON.stringify(run.json)).not.toContain('static:');
  });

  it('renders narration frames with their audio resolved from the store', () => {
    const id = 'moenarch-narration';
    const segment = narrationSchedule(catalog.spec(id)!).scenes.flatMap((scene) => scene.audio?.segments ?? [])[0];
    expect(segment, 'the narration project has an audio segment').toBeDefined();
    const out = join(tmp, 'narration.mp4');
    const run = render(['--project', id, '--frames', `${segment.from}-${segment.from + 5}`, '--out', out]);
    expect(run.status, run.context).toBe(0);
    const result = assertRenderResult(run.json);
    expectResolvedAssets(id, result.assets);
    expect(result.assets.some((asset: Json) => asset.kind === 'audio')).toBe(true);
    expect(existsSync(out)).toBe(true);
  });
});

describe('bun run video:render materializes through asset-tooling (#17 smoke)', () => {
  const MATERIALIZED = 'moenarch-materialized-audio';

  const provenance = (assets: Json[]) => Object.fromEntries(assets.map((asset) => [asset.id, asset.provenance]));

  it('records local provenance for a project without requests', () => {
    const id = 'moenarch-narration';
    const segment = narrationSchedule(catalog.spec(id)!).scenes.flatMap((scene) => scene.audio?.segments ?? [])[0];
    const run = render(['--project', id, '--frames', `${segment.from}-${segment.from + 2}`, '--out', join(tmp, 'narration-provenance.mp4')]);
    expect(run.status, run.context).toBe(0);
    const result = assertRenderResult(run.json);
    for (const asset of result.assets as Json[]) {
      expect(asset.provenance, asset.id).toEqual({ status: 'local', operation: null, cacheKey: null });
    }
  });

  it('renders the materialized fixture, then reuses every requested slot on an unchanged rebuild', () => {
    const segment = narrationSchedule(catalog.spec(MATERIALIZED)!).scenes.flatMap((scene) => scene.audio?.segments ?? [])[0];
    expect(segment, 'the fixture has an audio segment').toBeDefined();
    const frames = `${segment.from}-${segment.from + 2}`;
    const first = render(['--project', MATERIALIZED, '--frames', frames, '--out', join(tmp, 'materialized-1.mp4')]);
    expect(first.status, first.context).toBe(0);
    const firstResult = assertRenderResult(first.json);
    expectResolvedAssets(MATERIALIZED, firstResult.assets);
    const before = provenance(firstResult.assets);
    expect(before['narration.local']).toEqual({ status: 'local', operation: null, cacheKey: null });
    expect(before['narration.tone']).toMatchObject({ status: expect.stringMatching(/^(hit|miss)$/), operation: { id: 'audio.oscillator', version: '1' } });
    expect(before['narration.shaped']).toMatchObject({ status: expect.stringMatching(/^(hit|miss)$/), operation: { id: 'audio.adsr', version: '1' } });

    const second = render(['--project', MATERIALIZED, '--frames', frames, '--out', join(tmp, 'materialized-2.mp4')]);
    expect(second.status, second.context).toBe(0);
    const after = provenance(assertRenderResult(second.json).assets);
    for (const id of ['narration.tone', 'narration.shaped']) {
      expect(after[id], id).toEqual({ ...before[id], status: 'hit' });
    }
    expect(after['narration.local']).toEqual(before['narration.local']);
  });
});
