// Acceptance for issue #15: the pure front half of the headless render command.
//
// `bun run video:render --project <id-or-spec-path> [--out <path>] [--frames <a>-<b>] [--profile <id>]`
//
// - parseRenderArgs(argv) turns the command-line arguments (after the script name) into a request.
// - resolveRenderJob(args, { catalog, cwd, assetStore }) resolves project, format, output profile,
//   dimensions, fps, duration, frame range, scene schedule and asset slots BEFORE anything is
//   bundled or rendered, and fails closed with a reason and a diagnostic message. (#16: asset
//   slots resolve through the content-addressed store; see asset-resolution.test.ts.)
// - createRenderResult(job, output) builds the machine-readable result (render-result.test-support.ts).
//
// Projects come only from the catalog (the one composition authority shared with the Player). A
// spec path selects the catalog project whose registered spec it is; a file that is not a registered
// spec is refused rather than rendered through a second path.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { titleCardFormat } from '@/formats/title-card';
import { catalog } from '@/projects';
import { createRenderResult, parseRenderArgs, resolveRenderJob } from '@/render/render-job';
import catalogTitleCard from '@/spec/fixtures/catalog-title-card.videospec.json';
import { assertVideoSpec, resolveTimeline, serializeVideoSpec } from '@/spec/video-spec';

import { assertRenderResult, RENDER_ERROR_REASONS } from './render-result.test-support';

const ROOT = join(import.meta.dirname, '..', '..');
const PUBLIC_DIR = join(ROOT, 'public');
const TITLE_CARD_PATH = 'src/spec/fixtures/catalog-title-card.videospec.json';
// #16: assets resolve from a content-addressed store, filled here from the checked-in sources.
// `publicDir` stays for the pre-#16 baseline, where it was the asset source.
const ASSET_STORE = mkdtempSync(join(tmpdir(), 'iv-render-job-store-'));
const env = { catalog, cwd: ROOT, publicDir: PUBLIC_DIR, assetStore: ASSET_STORE };
const FAKE_OUTPUT = { path: '/renders/fake.mp4', sha256: 'a'.repeat(64), bytes: 1234 };

const tmp = mkdtempSync(join(tmpdir(), 'iv-render-job-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterAll(() => rmSync(ASSET_STORE, { recursive: true, force: true }));
beforeAll(async () => {
  // The store module is new in #16; before it exists the baseline resolves assets from publicDir.
  const specifier = '@/assets/asset-store';
  let store: { importSourceAssets: (root: string) => unknown } | undefined;
  try {
    store = await import(/* @vite-ignore */ specifier);
  } catch (error) {
    // Only a missing module means the baseline; any other failure is real.
    if (!/Cannot find|ERR_MODULE_NOT_FOUND|Failed to (load|resolve)/.test(String(error))) throw error;
    store = undefined;
  }
  if (store) await store.importSourceAssets(ASSET_STORE);
});
afterEach(() => vi.useRealTimers());

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const clone = <T,>(value: T): T => structuredClone(value);

function args(argv: string[]) {
  const parsed = parseRenderArgs(argv);
  if (!parsed.ok) throw new Error(`unexpected parse error: ${parsed.error.message}`);
  return parsed.args;
}

function job(argv: string[], environment = env) {
  const resolved = resolveRenderJob(args(argv), environment);
  if (!resolved.ok) throw new Error(`unexpected resolve error ${resolved.error.reason}: ${resolved.error.message}`);
  return resolved.job;
}

function failure(argv: string[], environment = env) {
  const resolved = resolveRenderJob(args(argv), environment);
  if (resolved.ok) throw new Error('expected the render job to fail');
  expect(RENDER_ERROR_REASONS).toContain(resolved.error.reason);
  return resolved.error;
}

function writeTemp(name: string, content: string) {
  const path = join(tmp, name);
  writeFileSync(path, content);
  return path;
}

describe('parseRenderArgs', () => {
  it('reads --project with the social portrait profile as default and no out/frames', () => {
    const parsed = parseRenderArgs(['--project', 'catalog-title-card']);
    expect(parsed).toEqual({ ok: true, args: { project: 'catalog-title-card', profile: 'social-portrait' } });
  });

  it('reads --out, --frames as an inclusive range, a single frame and --profile', () => {
    expect(args(['--project', TITLE_CARD_PATH, '--out', 'renders/x.mp4', '--frames', '0-11', '--profile', 'social-portrait'])).toEqual({
      project: TITLE_CARD_PATH,
      out: 'renders/x.mp4',
      frames: { from: 0, to: 11 },
      profile: 'social-portrait',
    });
    expect(args(['--frames', '5', '--project', 'catalog-title-card']).frames).toEqual({ from: 5, to: 5 });
  });

  it.each([
    [[], 'missing --project'],
    [['--project'], 'flag without a value'],
    [['--project', 'a', '--project', 'b'], 'repeated flag'],
    [['--project', 'a', '--bogus', '1'], 'unknown flag'],
    [['catalog-title-card'], 'positional argument'],
    [['--project', 'a', '--frames', '11-0'], 'reversed range'],
    [['--project', 'a', '--frames', '-3'], 'negative frame'],
    [['--project', 'a', '--frames', '1.5-2'], 'fractional frame'],
    [['--project', 'a', '--frames', 'a-b'], 'non-numeric frames'],
    [['--project', 'a', '--out', ''], 'empty out path'],
  ])('fails with invalid-arguments for %j (%s)', (argv) => {
    const parsed = parseRenderArgs(argv);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.reason).toBe('invalid-arguments');
    expect(parsed.error.message.length).toBeGreaterThan(0);
  });
});

describe('resolveRenderJob: project selection through the catalog', () => {
  it('resolves a project id into the composition, schedule and default output path before rendering', () => {
    const titleCard = job(['--project', 'catalog-title-card']);
    expect(titleCard.outPath).toBe(join(ROOT, 'out', 'catalog-title-card.social-portrait.mp4'));

    const spec = assertVideoSpec(catalogTitleCard);
    const result = assertRenderResult(createRenderResult(titleCard, FAKE_OUTPUT));
    expect(result).toEqual({
      schema: 'interactive-videos/render-result',
      // #17: render result schema v2 (per-slot asset provenance); the title card has no slots.
      schemaVersion: 2,
      ok: true,
      request: { project: 'catalog-title-card', profile: 'social-portrait', frames: null },
      project: { id: 'catalog-title-card', title: 'Catalog title card', specSha256: sha256(serializeVideoSpec(spec)) },
      format: { id: 'title-card', version: 1 },
      profile: { id: 'social-portrait', codec: 'h264', container: 'mp4' },
      composition: { id: 'catalog-title-card', width: 1080, height: 1920, fps: 24, durationInFrames: 96 },
      frames: { from: 0, to: 95, count: 96 },
      scenes: resolveTimeline(spec).scenes,
      assets: [],
      output: FAKE_OUTPUT,
    });
  });

  it('selects the same project from its checked-in spec path, relative or absolute', () => {
    const byId = createRenderResult(job(['--project', 'catalog-title-card', '--frames', '0-11']), FAKE_OUTPUT);
    for (const selector of [TITLE_CARD_PATH, `./${TITLE_CARD_PATH}`, join(ROOT, TITLE_CARD_PATH)]) {
      const byPath = createRenderResult(job(['--project', selector, '--frames', '0-11']), FAKE_OUTPUT);
      expect(byPath.request.project).toBe(selector);
      expect({ ...byPath, request: undefined }).toEqual({ ...byId, request: undefined });
    }
  });

  it('resolves --out against the working directory and echoes --frames', () => {
    const resolved = job(['--project', 'catalog-title-card', '--out', 'renders/clip.mp4', '--frames', '24-47']);
    expect(resolved.outPath).toBe(join(ROOT, 'renders', 'clip.mp4'));
    const result = assertRenderResult(createRenderResult(resolved, FAKE_OUTPUT));
    expect(result.frames).toEqual({ from: 24, to: 47, count: 24 });
    expect(result.request.frames).toBe('24-47');
    const absolute = job(['--project', 'catalog-title-card', '--out', join(tmp, 'abs.mp4')]);
    expect(absolute.outPath).toBe(join(tmp, 'abs.mp4'));
  });

  it('fails with unknown-project for an id that is not in the catalog, without falling back', () => {
    const error = failure(['--project', 'no-such-project']);
    expect(error.reason).toBe('unknown-project');
    expect(error.message).toContain('no-such-project');
  });

  it('fails with spec-not-found for a spec path that does not exist', () => {
    const error = failure(['--project', 'src/spec/fixtures/missing.videospec.json']);
    expect(error.reason).toBe('spec-not-found');
    expect(error.message).toContain('missing.videospec.json');
  });

  it('fails with invalid-spec, naming the JSON path, for an invalid spec file or broken JSON', () => {
    const broken = clone(catalogTitleCard) as any;
    broken.output.fps = 0;
    const invalid = failure(['--project', writeTemp('invalid.videospec.json', JSON.stringify(broken))]);
    expect(invalid.reason).toBe('invalid-spec');
    expect(invalid.message).toContain('$.output.fps');

    const notJson = failure(['--project', writeTemp('not-json.videospec.json', '{ "specVersion": 1,')]);
    expect(notJson.reason).toBe('invalid-spec');
  });

  it('refuses a valid spec file that is not the registered spec of a catalog project', () => {
    const edited = clone(catalogTitleCard);
    edited.scenes[0].payload.heading = 'Edited outside the catalog';
    const mismatch = failure(['--project', writeTemp('edited.videospec.json', JSON.stringify(edited))]);
    expect(mismatch.reason).toBe('spec-mismatch');
    expect(mismatch.message).toContain('catalog-title-card');

    const stranger = clone(catalogTitleCard);
    stranger.project.id = 'not-registered';
    const unknown = failure(['--project', writeTemp('stranger.videospec.json', JSON.stringify(stranger))]);
    expect(unknown.reason).toBe('unknown-project');
    expect(unknown.message).toContain('not-registered');
  });

  it('accepts a registered spec file regardless of key order or formatting (normalized identity)', () => {
    const spec = assertVideoSpec(catalogTitleCard);
    const reordered = { scenes: spec.scenes, assets: spec.assets, output: spec.output, format: spec.format, project: spec.project, specVersion: spec.specVersion };
    const path = writeTemp('reordered.videospec.json', JSON.stringify(reordered));
    const result = createRenderResult(job(['--project', path]), FAKE_OUTPUT);
    expect(result.project.id).toBe('catalog-title-card');
    expect(result.project.specSha256).toBe(sha256(serializeVideoSpec(spec)));
  });

  it('reports the catalog resolve errors: format-mismatch and unrenderable', () => {
    const wrongFormat = clone(catalogTitleCard);
    wrongFormat.project.id = 'wrong-format';
    const unrenderable = clone(catalogTitleCard) as any;
    unrenderable.project.id = 'unrenderable';
    unrenderable.scenes = [{ kind: 'statement', id: 'line', durationInFrames: 48, payload: { text: 'Not a title.' } }];
    const injected = createCatalog(
      [
        { spec: catalogTitleCard, format: titleCardFormat },
        { spec: wrongFormat, format: moenarchShort() },
        { spec: unrenderable, format: titleCardFormat },
      ],
      'catalog-title-card',
    );
    const environment = { ...env, catalog: injected };
    expect(failure(['--project', 'wrong-format'], environment).reason).toBe('format-mismatch');
    const error = failure(['--project', 'unrenderable'], environment);
    expect(error.reason).toBe('unrenderable');
    expect(error.message).toContain('unrenderable');
  });
});

describe('resolveRenderJob: output profile, frames and assets', () => {
  it('fails with unknown-profile and lists the known profiles', () => {
    const error = failure(['--project', 'catalog-title-card', '--profile', 'cinema-scope']);
    expect(error.reason).toBe('unknown-profile');
    expect(error.message).toContain('cinema-scope');
    expect(error.message).toContain('social-portrait');
  });

  it('fails with profile-mismatch when the composition is not 9:16 portrait', () => {
    const error = failure(['--project', 'latency-explainer']);
    expect(error.reason).toBe('profile-mismatch');
    expect(error.message).toContain('1280x720');
    expect(error.message).toContain('social-portrait');
  });

  it('fails with frames-out-of-range for a range past the composition', () => {
    const error = failure(['--project', 'catalog-title-card', '--frames', '90-96']);
    expect(error.reason).toBe('frames-out-of-range');
    expect(error.message).toContain('96');
    expect(job(['--project', 'catalog-title-card', '--frames', '95']).outPath).toBeTypeOf('string');
  });

  // The v1 `static:`/publicDir asset tests are superseded by #16's asset-resolution.test.ts
  // (resolved inputs, missing-asset, asset-mismatch, reuse).
});

describe('determinism', () => {
  it('produces byte-identical results for the same inputs at different wall-clock times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const first = JSON.stringify(createRenderResult(job(['--project', 'moenarch-narration', '--frames', '0-11']), FAKE_OUTPUT));
    vi.setSystemTime(new Date('2031-06-15T12:34:56Z'));
    const second = JSON.stringify(createRenderResult(job(['--project', 'moenarch-narration', '--frames', '0-11']), FAKE_OUTPUT));
    expect(second).toBe(first);
    expect(first).not.toMatch(/20(20|31)-/);
  });

  it('changes the composition, schedule and spec identity when the spec timing changes', () => {
    const shorter = clone(catalogTitleCard);
    shorter.scenes[0].durationInFrames = 48;
    const environment = { ...env, catalog: createCatalog([{ spec: shorter, format: titleCardFormat }], 'catalog-title-card') };
    const original = createRenderResult(job(['--project', 'catalog-title-card']), FAKE_OUTPUT);
    const changed = createRenderResult(job(['--project', 'catalog-title-card'], environment), FAKE_OUTPUT);
    expect(changed.composition.durationInFrames).toBe(48);
    expect(changed.scenes).toEqual([{ id: 'opening', kind: 'title', from: 0, durationInFrames: 48 }]);
    expect(changed.frames).toEqual({ from: 0, to: 47, count: 48 });
    expect(changed.project.specSha256).not.toBe(original.project.specSha256);
  });
});
