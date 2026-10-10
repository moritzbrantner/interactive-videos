import { describe, expect, it } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import galleryFixture from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';

// Regression for the Codex review on PR #37: percent-encoded segments must not escape `public/`.
describe('moenarch-short static media paths', () => {
  it('refuses percent-encoded paths', () => {
    for (const uri of ['static:%2e%2e/secret.png', 'static:fixtures%2f..%2fsecret.png', 'static:a%20b.png']) {
      const spec = structuredClone(galleryFixture) as { assets: { uri: string }[] };
      spec.assets[0]!.uri = uri;
      const result = createCatalog([{ spec, format: moenarchShort() }], 'moenarch-scene-gallery').resolve(
        'moenarch-scene-gallery',
      );
      expect(result, uri).toMatchObject({ ok: false, reason: 'unrenderable' });
    }
  });
});
