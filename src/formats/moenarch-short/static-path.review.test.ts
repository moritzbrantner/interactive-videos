import { describe, expect, it } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import galleryFixture from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';

// Regression for the Codex review on PR #37, translated to VideoSpec v2 (#16): v2 slots carry no
// URIs, so no path can escape `public/`; the served path is derived from the digest alone. An
// image whose media type the format cannot show stays unrenderable.
describe('moenarch-short content-addressed media paths', () => {
  it('refuses image slots whose media type the format cannot show', () => {
    for (const mediaType of ['image/x-unknown', 'image/tiff']) {
      const spec = structuredClone(galleryFixture) as { assets: { asset: { mediaType: string } }[] };
      spec.assets[0]!.asset.mediaType = mediaType;
      const result = createCatalog([{ spec, format: moenarchShort() }], 'moenarch-scene-gallery').resolve(
        'moenarch-scene-gallery',
      );
      expect(result, mediaType).toMatchObject({ ok: false, reason: 'unrenderable' });
    }
  });
});
