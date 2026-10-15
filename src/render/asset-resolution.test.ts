// Acceptance contract for issue #16: the shared SHA-256 asset store and render-time resolution of
// logical asset slots, written by an independent acceptance context before the implementation.
// Contract: docs/specs/videospec-v2-assets.md (§1.3, §1.4). ADR 0001.
//
// Public API exercised (new module `@/assets/asset-store`; each function may be sync or async):
// - DEFAULT_ASSET_STORE: absolute path of the git-ignored default store (`<repo>/.asset-store`).
// - assetObjectPath(store, sha256) → `<store>/sha256/<sha256>`; refuses anything but a digest.
// - importAssetBytes(store, bytes) → { sha256, byteLength }; one object per digest, idempotent.
// - importSourceAssets(store): network-free, deterministic import of every catalog project's
//   checked-in/generated source assets, so a clean checkout can fill an empty store.
// And the render job (`@/render/render-job`): RenderEnvironment `{ catalog, cwd, assetStore }`;
// `resolveRenderJob` resolves every slot BEFORE bundling to `{ id, kind, src, sha256, byteLength,
// mediaType }` or fails with `missing-asset` / `asset-mismatch` naming the slot.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetObjectPath, DEFAULT_ASSET_STORE, importAssetBytes, importSourceAssets } from '@/assets/asset-store';
import { createCatalog, type Catalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { catalog } from '@/projects';
import { createRenderResult, parseRenderArgs, RENDER_PROFILES, resolveRenderJob } from '@/render/render-job';
import moenarchSceneGallery from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';

import { assertRenderResult, RENDER_ERROR_REASONS } from './render-result.test-support';

const ROOT = join(import.meta.dirname, '..', '..');
const FAKE_OUTPUT = { path: '/renders/fake.mp4', sha256: 'a'.repeat(64), bytes: 1234 };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Json = Record<string, any>;

// A valid 1x1 PNG, independent of any checked-in file.
const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
);
const OTHER = new Uint8Array(Buffer.from('not the declared bytes'));

const tmp = mkdtempSync(join(tmpdir(), 'iv-asset-store-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let count = 0;
const freshStore = () => {
  const dir = join(tmp, `store-${(count += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Every object file below a store, as paths relative to it. */
function objects(store: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(store, '');
  return out.sort();
}

function args(argv: string[]) {
  const parsed = parseRenderArgs(argv);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.args;
}

const environment = (assetStore: string, injected: Catalog = catalog) => ({ catalog: injected, cwd: ROOT, assetStore });

function resolveOk(project: string, env: ReturnType<typeof environment>) {
  const resolved = resolveRenderJob(args(['--project', project]), env as never);
  if (!resolved.ok) throw new Error(`unexpected ${resolved.error.reason}: ${resolved.error.message}`);
  return resolved.job;
}

function resolveError(project: string, env: ReturnType<typeof environment>) {
  const resolved = resolveRenderJob(args(['--project', project]), env as never);
  if (resolved.ok) throw new Error(`expected ${project} to fail`);
  expect(RENDER_ERROR_REASONS).toContain(resolved.error.reason);
  return resolved.error;
}

/** The scene gallery, under another id, with its image slot backed by `asset`. */
function gallery(id: string, asset: Json): Json {
  const spec = structuredClone(moenarchSceneGallery) as Json;
  spec.project = { ...spec.project, id };
  const image = (spec.assets as Json[]).find((slot) => slot.kind === 'image');
  if (!image) throw new Error('the scene gallery has no image slot');
  image.asset = asset;
  return spec;
}

const pngRef = (overrides: Json = {}) => ({
  schemaVersion: 1,
  kind: 'image',
  mediaType: 'image/png',
  sha256: sha256(PNG),
  byteLength: PNG.length,
  metadata: {},
  ...overrides,
});

const isPortrait = (id: string) => {
  const spec = catalog.spec(id)!;
  return RENDER_PROFILES.some((profile) => spec.output.width * profile.aspect.height === spec.output.height * profile.aspect.width);
};

describe('content-addressed store', () => {
  it('keeps objects at <store>/sha256/<digest>, keyed by digest only', () => {
    const store = freshStore();
    const digest = sha256(PNG);
    expect(assetObjectPath(store, digest)).toBe(join(store, 'sha256', digest));
    for (const bad of ['../../etc/passwd', 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}/x`, '']) {
      expect(() => assetObjectPath(store, bad), bad).toThrow();
    }
  });

  it('imports bytes once: identity from content, one object however often it is imported', async () => {
    const store = freshStore();
    const first = await importAssetBytes(store, PNG);
    expect(first).toEqual({ sha256: sha256(PNG), byteLength: PNG.length });
    const again = await importAssetBytes(store, new Uint8Array(PNG));
    expect(again).toEqual(first);
    expect(objects(store)).toEqual([`sha256/${sha256(PNG)}`]);
    expect(Buffer.from(readFileSync(assetObjectPath(store, first.sha256))).equals(Buffer.from(PNG))).toBe(true);
  });

  it('defaults to a git-ignored store in the repository', () => {
    expect(isAbsolute(DEFAULT_ASSET_STORE)).toBe(true);
    expect(DEFAULT_ASSET_STORE).toBe(join(ROOT, '.asset-store'));
    const probe = join('.asset-store', 'sha256', 'a'.repeat(64));
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', probe], { cwd: ROOT });
    expect(ignored.status, `${probe} must be git-ignored`).toBe(0);
  });
});

describe('importSourceAssets (clean checkout → filled store)', () => {
  let store: string;
  beforeAll(async () => {
    store = freshStore();
    await importSourceAssets(store);
  });

  it('provides the bytes of every slot of every catalog project', () => {
    const slots = catalog.projects.flatMap(({ id }) => (catalog.spec(id)!.assets as unknown as Json[]).map((slot) => ({ id, slot })));
    expect(slots.length).toBeGreaterThan(0);
    for (const { id, slot } of slots) {
      const file = assetObjectPath(store, slot.asset.sha256);
      expect(existsSync(file), `${id}/${slot.id}`).toBe(true);
      const bytes = new Uint8Array(readFileSync(file));
      expect(sha256(bytes), `${id}/${slot.id}`).toBe(slot.asset.sha256);
      expect(bytes.length, `${id}/${slot.id}`).toBe(slot.asset.byteLength);
    }
  });

  it('is deterministic and idempotent', async () => {
    const other = freshStore();
    await importSourceAssets(other);
    await importSourceAssets(other);
    expect(objects(other)).toEqual(objects(store));
    for (const object of objects(store)) {
      expect(readFileSync(join(other, object)).equals(readFileSync(join(store, object))), object).toBe(true);
    }
  });

  it('resolves every renderable catalog project to immutable runtime inputs before bundling', () => {
    const renderable = catalog.projects.map(({ id }) => id).filter(isPortrait);
    expect(renderable).toEqual(expect.arrayContaining(['moenarch-scene-gallery', 'moenarch-narration']));
    for (const id of renderable) {
      const job = resolveOk(id, environment(store));
      const slots = [...(catalog.spec(id)!.assets as unknown as Json[])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(job.assets.map((asset: Json) => Object.keys(asset).sort()), id).toEqual(
        slots.map(() => ['byteLength', 'id', 'kind', 'mediaType', 'sha256', 'src']),
      );
      expect(
        job.assets.map(({ id: slotId, kind, sha256: digest, byteLength, mediaType }: Json) => ({ id: slotId, kind, sha256: digest, byteLength, mediaType })),
        id,
      ).toEqual(
        slots.map((slot) => ({
          id: slot.id,
          kind: slot.kind,
          sha256: slot.asset.sha256,
          byteLength: slot.asset.byteLength,
          mediaType: slot.asset.mediaType,
        })),
      );
      for (const asset of job.assets as Json[]) {
        expect(typeof asset.src === 'string' && asset.src.length > 0, `${id}/${asset.id}`).toBe(true);
        expect(asset.src, `${id}/${asset.id} src is content-addressed`).toContain(asset.sha256);
        expect(asset.src.startsWith('static:'), `${id}/${asset.id}`).toBe(false);
      }
      expect(JSON.stringify(job), id).not.toContain('static:');
      const result = assertRenderResult(createRenderResult(job, FAKE_OUTPUT));
      expect(result.assets, id).toEqual(job.assets);
    }
  });
});

describe('resolveRenderJob fails before bundling on unusable assets', () => {
  it('fails with missing-asset, naming the slot and its digest, when the store lacks the object', () => {
    const store = freshStore();
    const error = resolveError('moenarch-scene-gallery', environment(store));
    expect(error.reason).toBe('missing-asset');
    const image = (catalog.spec('moenarch-scene-gallery')!.assets as unknown as Json[]).find((slot) => slot.kind === 'image')!;
    expect(error.message).toContain(image.id);
    expect(error.message).toContain(image.asset.sha256);
  });

  it('fails with asset-mismatch when the stored bytes do not hash to the declared digest', async () => {
    const store = freshStore();
    await importSourceAssets(store);
    const image = (catalog.spec('moenarch-scene-gallery')!.assets as unknown as Json[]).find((slot) => slot.kind === 'image')!;
    // Objects may be stored read-only; replace the file rather than writing through it.
    rmSync(assetObjectPath(store, image.asset.sha256), { force: true });
    writeFileSync(assetObjectPath(store, image.asset.sha256), OTHER);
    const error = resolveError('moenarch-scene-gallery', environment(store));
    expect(error.reason).toBe('asset-mismatch');
    expect(error.message).toContain(image.id);
  });

  it('fails with asset-mismatch when the declared byte length differs from the stored object', async () => {
    const store = freshStore();
    await importAssetBytes(store, PNG);
    const injected = createCatalog([{ spec: gallery('length-probe', pngRef({ byteLength: PNG.length + 1 })), format: moenarchShort() }], 'length-probe');
    const error = resolveError('length-probe', environment(store, injected));
    expect(error.reason).toBe('asset-mismatch');
  });

  it('refuses an incompatible media type as an invalid spec, before any byte is read', () => {
    const spec = gallery('moenarch-scene-gallery', pngRef({ mediaType: 'audio/wav' }));
    expect(() => createCatalog([{ spec, format: moenarchShort() }], 'moenarch-scene-gallery')).toThrow(/\$\.assets\[/);
    const path = join(tmp, 'incompatible.videospec.json');
    writeFileSync(path, JSON.stringify(spec));
    const error = resolveError(path, environment(freshStore()));
    expect(error.reason).toBe('invalid-spec');
    expect(error.message).toContain('$.assets[');
  });

  it('reads no store at all for validation: the catalog resolves a project whose bytes are absent', () => {
    const injected = createCatalog([{ spec: gallery('absent-bytes', pngRef({ sha256: 'c'.repeat(64) })), format: moenarchShort() }], 'absent-bytes');
    expect(injected.resolve('absent-bytes').ok).toBe(true);
    expect(resolveError('absent-bytes', environment(freshStore(), injected)).reason).toBe('missing-asset');
  });
});

describe('reuse across projects', () => {
  it('lets two projects share one content-addressed object', async () => {
    const store = freshStore();
    await importAssetBytes(store, PNG);
    const injected = createCatalog(
      [
        { spec: gallery('reuse-a', pngRef()), format: moenarchShort() },
        { spec: gallery('reuse-b', pngRef()), format: moenarchShort() },
      ],
      'reuse-a',
    );
    const a = resolveOk('reuse-a', environment(store, injected));
    const b = resolveOk('reuse-b', environment(store, injected));
    const image = (job: typeof a) => (job.assets as Json[]).find((asset) => asset.kind === 'image')!;
    expect(image(a).sha256).toBe(sha256(PNG));
    expect(image(b).sha256).toBe(image(a).sha256);
    expect(image(b).src).toBe(image(a).src);
    expect(objects(store)).toEqual([`sha256/${sha256(PNG)}`]);
  });
});
