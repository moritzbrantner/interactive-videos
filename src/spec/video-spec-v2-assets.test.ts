// Acceptance contract for issue #16 (VideoSpec v2, content-addressed asset references), written
// by an independent acceptance context before the implementation. Contract:
// docs/specs/videospec-v2-assets.md (§1.1, §1.2). ADR: docs/adr/0001-videospec-v2-content-addressed-assets.md.
//
// - VIDEO_SPEC_VERSION is 2; `assets[]` entries are logical slots `{ id, kind, asset }` whose
//   `asset` is the shared AssetRef v1 `{ schemaVersion: 1, kind, mediaType, sha256, byteLength,
//   metadata }` (asset-tooling, mirrored by remotion-primitives media-contracts).
// - v1 documents are rejected (no compatibility reader); no `static:` URI exists in v2.
// - Validation checks slot kind / media type compatibility without reading bytes.
// - Every checked-in fixture is migrated and keeps its exact asset bytes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { catalog } from '@/projects';
import { narrationWav } from '@/spec/fixtures/narration-audio';
import { parseVideoSpec, parseVideoSpecJson, serializeVideoSpec, VIDEO_SPEC_VERSION } from '@/spec/video-spec';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURE_DIR = join(ROOT, 'src', 'spec', 'fixtures');
const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.videospec.json'))
  .sort();

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type Json = Record<string, any>;

const ref = (kind: string, mediaType: string, sha = SHA_A, byteLength = 1482, metadata: Json = {}) => ({
  schemaVersion: 1,
  kind,
  mediaType,
  sha256: sha,
  byteLength,
  metadata,
});

/** A minimal v2 document with one image slot that a mediaReveal scene shows. */
function v2(): Json {
  return {
    specVersion: 2,
    project: { id: 'asset-probe', title: 'Asset probe' },
    format: { id: 'moenarch-short', version: 1 },
    output: { width: 1080, height: 1920, fps: 30 },
    assets: [{ id: 'poster', kind: 'image', asset: ref('image', 'image/png') }],
    scenes: [{ kind: 'mediaReveal', id: 'reveal', durationInFrames: 90, payload: { image: 'poster', alt: 'A poster' } }],
  };
}

function accepted(input: unknown) {
  const result = parseVideoSpec(input);
  if (!result.ok) throw new Error(`expected a valid spec:\n${result.diagnostics.map((d) => `${d.path}: ${d.message}`).join('\n')}`);
  return result.spec as unknown as Json;
}

function diagnosticsOf(input: unknown) {
  const result = parseVideoSpec(input);
  if (result.ok) throw new Error('expected the spec to be rejected');
  return result.diagnostics;
}

const readFixture = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf8');

describe('VideoSpec v2: version', () => {
  it('reads version 2', () => {
    expect(VIDEO_SPEC_VERSION).toBe(2);
    expect(accepted(v2()).specVersion).toBe(2);
  });

  it('rejects VideoSpec v1 with one diagnostic naming the rejected and the supported version', () => {
    const v1 = { ...v2(), specVersion: 1, assets: [{ id: 'poster', kind: 'image', uri: 'static:poster.png' }] };
    const diagnostics = diagnosticsOf(v1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].path).toBe('$.specVersion');
    expect(diagnostics[0].message).toMatch(/\b1\b/);
    expect(diagnostics[0].message).toMatch(/\b2\b/);
  });

  it('rejects a v1 uri slot inside a v2 document (no compatibility reader)', () => {
    const spec = v2();
    spec.assets = [{ id: 'poster', kind: 'image', uri: 'static:fixtures/scene-gallery/media-reveal.png' }];
    const paths = diagnosticsOf(spec).map((d) => d.path);
    expect(paths).toContain('$.assets[0].uri');
    expect(paths).toContain('$.assets[0].asset');
  });
});

describe('VideoSpec v2: AssetRef slot shape', () => {
  it('accepts a slot backed by an AssetRef v1 and keeps its identity', () => {
    const spec = accepted(v2());
    expect(spec.assets).toEqual([
      {
        id: 'poster',
        kind: 'image',
        asset: { schemaVersion: 1, kind: 'image', mediaType: 'image/png', sha256: SHA_A, byteLength: 1482, metadata: {} },
      },
    ]);
  });

  it('keeps JSON metadata (provenance) on the AssetRef', () => {
    const spec = v2();
    spec.assets[0].asset.metadata = { source: { tool: 'import', note: 'checked-in fixture' }, width: 216, tags: ['a', null] };
    expect(accepted(spec).assets[0].asset.metadata).toEqual(spec.assets[0].asset.metadata);
  });

  it('rejects AssetRef fields outside the shared v1 shape, including any uri or src', () => {
    for (const extra of [{ uri: 'static:poster.png' }, { url: 'https://example.invalid/a.png' }, { src: '/a.png' }, { path: 'a.png' }]) {
      const spec = v2();
      Object.assign(spec.assets[0].asset, extra);
      const key = Object.keys(extra)[0];
      expect(diagnosticsOf(spec).map((d) => d.path), key).toContain(`$.assets[0].asset.${key}`);
    }
    const slotExtra = v2();
    slotExtra.assets[0].uri = 'static:poster.png';
    expect(diagnosticsOf(slotExtra).map((d) => d.path)).toContain('$.assets[0].uri');
  });

  it('enforces the AssetRef v1 field rules', () => {
    const invalid: [string, unknown][] = [
      ['schemaVersion', 2],
      ['sha256', 'A'.repeat(64)],
      ['sha256', 'a'.repeat(63)],
      ['sha256', `sha256:${'a'.repeat(64)}`],
      ['byteLength', -1],
      ['byteLength', 1.5],
      ['byteLength', '1482'],
      ['mediaType', 'image'],
      ['mediaType', 'Image/PNG'],
      ['kind', 'Image'],
      ['kind', ''],
      ['metadata', 'none'],
      ['metadata', []],
    ];
    for (const [field, value] of invalid) {
      const spec = v2();
      spec.assets[0].asset[field] = value;
      const paths = diagnosticsOf(spec).map((d) => d.path);
      expect(paths.some((path) => path.startsWith('$.assets[0].asset')), `${field}=${JSON.stringify(value)}: ${paths.join(', ')}`).toBe(true);
    }
    for (const field of ['sha256', 'byteLength', 'mediaType', 'kind', 'schemaVersion']) {
      const spec = v2();
      delete spec.assets[0].asset[field];
      expect(diagnosticsOf(spec).map((d) => d.path), field).toContain(`$.assets[0].asset.${field}`);
    }
    const empty = v2();
    empty.assets[0].asset.byteLength = 0;
    empty.assets[0].asset.mediaType = 'image/svg+xml';
    expect(accepted(empty).assets[0].asset).toMatchObject({ byteLength: 0, mediaType: 'image/svg+xml' });
  });

  it('normalizes slots by id with a fixed key order, so identical specs serialize identically', () => {
    const spec = v2();
    spec.assets.push({ id: 'aaa-voice', kind: 'audio', asset: ref('audio', 'audio/wav', SHA_B, 10) });
    const reversed = v2();
    reversed.assets = [
      {
        asset: { metadata: {}, byteLength: 10, sha256: SHA_B, mediaType: 'audio/wav', kind: 'audio', schemaVersion: 1 },
        kind: 'audio',
        id: 'aaa-voice',
      },
      { asset: { ...reversed.assets[0].asset }, kind: 'image', id: 'poster' },
    ];
    const text = serializeVideoSpec(accepted(spec) as never);
    expect(serializeVideoSpec(accepted(reversed) as never)).toBe(text);
    const assets = JSON.parse(text).assets;
    expect(assets.map((slot: Json) => slot.id)).toEqual(['aaa-voice', 'poster']);
    expect(Object.keys(assets[0])).toEqual(['id', 'kind', 'asset']);
    expect(Object.keys(assets[0].asset)).toEqual(['schemaVersion', 'kind', 'mediaType', 'sha256', 'byteLength', 'metadata']);
  });
});

describe('VideoSpec v2: kind and media-type compatibility (no bytes read)', () => {
  const slotDiagnostics = (spec: Json, index = 0) => diagnosticsOf(spec).filter((d) => d.path.startsWith(`$.assets[${index}]`));

  it('rejects a media type that does not belong to the slot kind', () => {
    const cases: [string, string, string][] = [
      ['image', 'image', 'audio/wav'],
      ['image', 'image', 'video/mp4'],
      ['audio', 'audio', 'image/png'],
      ['video', 'video', 'audio/mpeg'],
      ['dataset', 'dataset', 'image/png'],
    ];
    for (const [slotKind, assetKind, mediaType] of cases) {
      const spec = v2();
      spec.scenes = [{ kind: 'title', id: 'opening', durationInFrames: 90, payload: { heading: 'Probe' } }];
      spec.assets = [{ id: 'slot', kind: slotKind, asset: ref(assetKind, mediaType) }];
      expect(slotDiagnostics(spec).length, `${slotKind} slot with ${mediaType}`).toBeGreaterThan(0);
    }
  });

  it('rejects an AssetRef of another media kind than its slot', () => {
    const spec = v2();
    spec.assets[0].asset = ref('audio', 'image/png');
    expect(slotDiagnostics(spec).length).toBeGreaterThan(0);
  });

  it('accepts compatible slots of every current kind', () => {
    const spec = v2();
    spec.assets.push(
      { id: 'clip', kind: 'video', asset: ref('video', 'video/mp4', SHA_B, 2048) },
      { id: 'voice', kind: 'audio', asset: ref('audio', 'audio/wav', SHA_B, 44) },
      { id: 'table', kind: 'dataset', asset: ref('dataset', 'application/json', SHA_B, 12) },
    );
    expect(accepted(spec).assets.map((slot: Json) => slot.id)).toEqual(['clip', 'poster', 'table', 'voice']);
  });

  it('keeps the scene reference checks: unknown slot and slot of the wrong kind', () => {
    const missing = v2();
    missing.scenes[0].payload.image = 'nope';
    expect(diagnosticsOf(missing).map((d) => d.path)).toContain('$.scenes[0].payload.image');

    const wrongKind = v2();
    wrongKind.assets[0] = { id: 'poster', kind: 'audio', asset: ref('audio', 'audio/wav') };
    expect(diagnosticsOf(wrongKind).map((d) => d.path)).toContain('$.scenes[0].payload.image');
  });

  it('validates without bytes: an unknown digest and a 50 GB length are fine for validation', () => {
    const spec = v2();
    spec.assets[0].asset = ref('image', 'image/png', 'f'.repeat(64), 50 * 1024 ** 3);
    expect(accepted(spec).assets[0].asset.byteLength).toBe(50 * 1024 ** 3);
  });

  it('lets two specs name one digest (one identity, no duplicated authority)', () => {
    const first = v2();
    const second = v2();
    second.project = { id: 'asset-probe-two', title: 'Asset probe two' };
    second.assets[0].id = 'cover';
    second.scenes[0].payload.image = 'cover';
    expect(accepted(first).assets[0].asset.sha256).toBe(accepted(second).assets[0].asset.sha256);
  });

  it('keeps the spec and catalog modules pure: no filesystem, crypto or network access', () => {
    for (const file of ['src/spec/video-spec.ts', 'src/catalog/catalog.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]);
      expect(imports.filter((specifier) => /^(node:)?(fs|fs\/promises|crypto|http|https|net|path)$/.test(specifier)), file).toEqual([]);
      expect(source, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|readFileSync|readFile\(/);
    }
  });
});

describe('VideoSpec v2: migrated fixtures', () => {
  it('has the seven current fixtures', () => {
    expect(FIXTURES).toEqual([
      'catalog-title-card.videospec.json',
      'interactive-showcase.videospec.json',
      'latency-explainer.videospec.json',
      'moenarch-narration.videospec.json',
      'moenarch-scene-gallery.videospec.json',
      'moenarch-specimen.videospec.json',
      'moenarch-typography.videospec.json',
    ]);
  });

  it.each(FIXTURES)('%s is a canonical v2 spec with AssetRef slots and no static: URI', (name) => {
    const text = readFixture(name);
    expect(text).not.toContain('static:');
    const result = parseVideoSpecJson(text);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.path}: ${d.message}`).join('\n'));
    expect(result.spec.specVersion).toBe(2);
    expect(serializeVideoSpec(result.spec)).toBe(text);
    for (const slot of (result.spec as unknown as Json).assets as Json[]) {
      expect(Object.keys(slot)).toEqual(['id', 'kind', 'asset']);
      expect(slot.asset.schemaVersion).toBe(1);
      expect(slot.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('registers every fixture in the catalog, which resolves each project', () => {
    const ids = FIXTURES.map((name) => JSON.parse(readFixture(name)).project.id).sort();
    expect(catalog.projects.map((project) => project.id).sort()).toEqual(ids);
    for (const id of ids) {
      const resolved = catalog.resolve(id);
      expect(resolved.ok, id).toBe(true);
    }
  });

  it('migrated slots keep their exact bytes', () => {
    const slots = (name: string) => (JSON.parse(readFixture(name)).assets as Json[]).map((slot) => ({ kind: slot.kind, ...slot.asset }));
    const gallery = slots('moenarch-scene-gallery.videospec.json');
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({
      kind: 'image',
      mediaType: 'image/png',
      sha256: '911676716eeb55fe80291105c9b9db31a4888aa557ec9cffd517d6a4fe959220',
      byteLength: 1482,
    });

    const hook = narrationWav(2450, 220);
    const point = narrationWav(3000, 330);
    const narration = slots('moenarch-narration.videospec.json');
    expect(narration.map((slot) => ({ kind: slot.kind, sha256: slot.sha256, byteLength: slot.byteLength })).sort((a, b) => a.sha256.localeCompare(b.sha256))).toEqual(
      [
        { kind: 'audio', sha256: sha256(hook), byteLength: hook.length },
        { kind: 'audio', sha256: sha256(point), byteLength: point.length },
      ].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    );
    expect(sha256(hook)).toBe('7fcbe09842d61da37fbc92be7a47dabc0408b44a2342341ecf655174791d0ed9');
    expect(sha256(point)).toBe('8d15a8a53ba7c4a2573d61231936212d9f1275a4f85986b95f5d9a632624d171');
    for (const slot of narration) expect(slot.mediaType).toMatch(/^audio\/(wav|x-wav|wave|vnd\.wave)$/);

    const latency = slots('latency-explainer.videospec.json');
    expect(latency).toHaveLength(1);
    expect(latency[0].kind).toBe('dataset');
  });

  it('builds and resolves a catalog project whose asset bytes exist nowhere (browser path reads no bytes)', () => {
    const gallery = JSON.parse(readFixture('moenarch-scene-gallery.videospec.json'));
    const image = (gallery.assets as Json[]).find((slot) => slot.kind === 'image')!;
    image.asset = { ...image.asset, sha256: 'e'.repeat(64), byteLength: 123 };
    gallery.project.id = 'unstored-gallery';
    const injected = createCatalog([{ spec: gallery, format: moenarchShort() }], 'unstored-gallery');
    expect(injected.resolve('unstored-gallery').ok).toBe(true);
  });
});
