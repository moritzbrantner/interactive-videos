// Regressions for the Codex review on PR #75 (#16).
import { describe, expect, it } from 'vitest';

import { assetExtension, assetPath } from '@/assets/asset-url';
import { parseVideoSpec } from '@/spec/video-spec';

const slotSpec = (metadata: unknown) => ({
  specVersion: 2,
  project: { id: 'metadata-probe', title: 'Metadata probe' },
  format: { id: 'moenarch-short', version: 1 },
  output: { width: 1080, height: 1920, fps: 30 },
  assets: [{ id: 'poster', kind: 'image', asset: { schemaVersion: 1, kind: 'image', mediaType: 'image/png', sha256: 'a'.repeat(64), byteLength: 1, metadata } }],
  scenes: [{ kind: 'mediaReveal', id: 'reveal', durationInFrames: 90, payload: { image: 'poster', alt: 'A poster' } }],
});

describe('AssetRef metadata is plain JSON', () => {
  it('rejects values canonical JSON cannot represent stably', () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date(0), () => 1]) {
      const result = parseVideoSpec(slotSpec({ nested: { value } }));
      expect(result.ok, String(value)).toBe(false);
    }
  });
  it('accepts nested JSON data', () => {
    expect(parseVideoSpec(slotSpec({ a: [1, 'b', null, true, { c: 2.5 }] })).ok).toBe(true);
  });
});

describe('served asset paths carry the media type', () => {
  it('derives the extension from the declared media type and keeps the digest', () => {
    expect(assetPath('b'.repeat(64), 'image/svg+xml')).toBe(`assets/sha256/${'b'.repeat(64)}.svg`);
    expect(assetExtension('audio/wav')).toBe('wav');
    expect(assetExtension('application/x-unknown')).toBe('bin');
  });
});
