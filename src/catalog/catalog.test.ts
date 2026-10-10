import { describe, expect, it } from 'vitest';

import { createCatalog, type FormatPack } from '@/catalog/catalog';
import { titleCardFormat, titleCardScenes } from '@/formats/title-card';
import { catalog } from '@/projects';
import { assertVideoSpec } from '@/spec/video-spec';
import latencyFixture from '@/spec/fixtures/latency-explainer.videospec.json';
import titleFixture from '@/spec/fixtures/catalog-title-card.videospec.json';
import { latencyFormat } from '@/video/latency-format';
import { LatencyVideo } from '@/video/latency-video';

const clone = <T,>(value: T): T => structuredClone(value);

describe('project catalog', () => {
  it('lists both fixture projects by id and title, latency first and default', () => {
    expect(catalog.projects).toEqual([
      { id: 'latency-explainer', title: 'Latency explainer' },
      { id: 'catalog-title-card', title: 'Catalog title card' },
    ]);
    expect(catalog.defaultId).toBe('latency-explainer');
  });

  it('resolves the latency explainer from its spec, with the interactive panel', () => {
    const result = catalog.resolve('latency-explainer');
    if (!result.ok) throw new Error(result.message);
    const { component, renderInsight, ...metadata } = result.composition;
    expect(metadata).toEqual({
      id: 'latency-explainer',
      title: 'Latency explainer',
      width: 1280,
      height: 720,
      fps: 30,
      // Sum of the spec's scene durations.
      durationInFrames: latencyFixture.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0),
    });
    expect(component).toBe(LatencyVideo);
    expect(renderInsight).toBeTypeOf('function');
  });

  it('resolves the title card with its own output profile and no panel', () => {
    const result = catalog.resolve('catalog-title-card');
    if (!result.ok) throw new Error(result.message);
    const { component, renderInsight, ...metadata } = result.composition;
    expect(metadata).toEqual({
      id: 'catalog-title-card',
      title: 'Catalog title card',
      width: 1080,
      height: 1920,
      fps: 24,
      durationInFrames: 96,
    });
    expect(component).toBeTypeOf('function');
    expect(renderInsight).toBeUndefined();
  });

  it('returns the same composition object on every resolve', () => {
    expect(catalog.resolve('catalog-title-card')).toBe(catalog.resolve('catalog-title-card'));
  });

  it('reports unknown ids instead of falling back to another project', () => {
    expect(catalog.resolve('does-not-exist')).toEqual({
      ok: false,
      reason: 'unknown-project',
      id: 'does-not-exist',
      message: 'No project with id "does-not-exist".',
    });
    // Ids are exact: no trimming or case folding.
    expect(catalog.resolve('Latency-Explainer').ok).toBe(false);
    expect(catalog.resolve('').ok).toBe(false);
  });

  it('reports a spec registered with a format pack it does not target', () => {
    const mismatched = createCatalog([{ spec: titleFixture, format: latencyFormat }], 'catalog-title-card');
    const result = mismatched.resolve('catalog-title-card');
    expect(result).toMatchObject({ ok: false, reason: 'format-mismatch', id: 'catalog-title-card' });
    if (!result.ok) expect(result.message).toContain('title-card v1');
  });

  it('treats another version of the same format as a mismatch', () => {
    const spec = clone(titleFixture);
    spec.format.version = 2;
    const result = createCatalog([{ spec, format: titleCardFormat }], 'catalog-title-card').resolve(
      'catalog-title-card',
    );
    expect(result).toMatchObject({ ok: false, reason: 'format-mismatch' });
  });

  it('reports a spec the format cannot render', () => {
    // A valid spec in the latency format whose content differs from the bundled one.
    const spec = clone(latencyFixture);
    spec.project.title = 'Another chart';
    const result = createCatalog([{ spec, format: latencyFormat }], 'latency-explainer').resolve('latency-explainer');
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
  });

  it('validates specs when the catalog is built', () => {
    const invalid = { ...clone(titleFixture), extra: true };
    expect(() => createCatalog([{ spec: invalid, format: titleCardFormat }], 'catalog-title-card')).toThrow();
  });

  it('rejects duplicate project ids and a default outside the catalog', () => {
    const entry = { spec: titleFixture, format: titleCardFormat };
    expect(() => createCatalog([entry, entry], 'catalog-title-card')).toThrow(/duplicate project id/);
    expect(() => createCatalog([entry], 'latency-explainer')).toThrow(/default project/);
  });

  it('takes dimensions, fps and duration from the spec, not the format', () => {
    const spec = clone(titleFixture);
    spec.output = { width: 1920, height: 1080, fps: 60 };
    spec.scenes.push({ ...clone(spec.scenes[0]), id: 'closing', durationInFrames: 30 });
    const stub: FormatPack = { id: 'title-card', version: 1, compose: () => ({ component: () => null }) };
    const result = createCatalog([{ spec, format: stub }], 'catalog-title-card').resolve('catalog-title-card');
    if (!result.ok) throw new Error(result.message);
    expect(result.composition).toMatchObject({ width: 1920, height: 1080, fps: 60, durationInFrames: 126 });
  });
});

describe('title-card format', () => {
  it('renders title scenes only', () => {
    expect(titleCardScenes(assertVideoSpec(titleFixture)).map((scene) => scene.payload.heading)).toEqual([
      'A second video in the catalog',
    ]);
    const chart = assertVideoSpec({ ...clone(latencyFixture), format: { id: 'title-card', version: 1 } });
    expect(() => titleCardScenes(chart)).toThrow(/only title scenes/);
  });
});
