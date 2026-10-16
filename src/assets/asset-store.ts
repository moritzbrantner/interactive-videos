// Shared, git-ignored, content-addressed asset store (VideoSpec v2, ADR 0001). Since #17 this is
// asset-tooling's object store: the `store` argument is an asset-tooling root and objects live at
// <root>/.asset-tooling/objects/v1/sha256/<first two hex>/<digest> (asset-tooling
// `assetObjectPortablePath`), keyed by their SHA-256 digest only, so asset-tooling reads what this
// module writes and the other way round. Acquisition stays here, in src/assets/materialize.ts and in
// build tooling, never in renderer components. This module itself does not import asset-tooling:
// the render job resolves through it. Relative imports only, so the Vite config can use it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NARRATION_FIXTURE_FILES, narrationWav } from '../spec/fixtures/narration-audio';
import { latencyDatasetBytes } from '../video/latency-dataset';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The default store: the repository root as asset-tooling root (`.asset-tooling/` is git-ignored). */
export const DEFAULT_ASSET_STORE = REPOSITORY_ROOT;

/** asset-tooling's object root below an asset-tooling root (asset-tooling 61d71f7). */
const OBJECT_ROOT = join('.asset-tooling', 'objects', 'v1');

const DIGEST = /^[0-9a-f]{64}$/;

/** Where the object with this digest lives; refuses anything that is not a sha256 digest. */
export function assetObjectPath(store: string, sha256: string): string {
  if (!DIGEST.test(sha256)) throw new Error(`not a lowercase sha256 digest: ${JSON.stringify(sha256)}`);
  return join(store, OBJECT_ROOT, 'sha256', sha256.slice(0, 2), sha256);
}

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Stores bytes under their digest once; importing the same bytes again changes nothing. */
export function importAssetBytes(store: string, bytes: Uint8Array): { sha256: string; byteLength: number } {
  const sha256 = sha256Hex(bytes);
  const path = assetObjectPath(store, sha256);
  if (!existsSync(path) || sha256Hex(readFileSync(path)) !== sha256) {
    mkdirSync(dirname(path), { recursive: true });
    // Write to a temporary name first so a reader never sees a partial object.
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  }
  return { sha256, byteLength: bytes.length };
}

/**
 * One checked-in or deterministically generated source asset: the identity it declares (the
 * digest the catalog specs lock) and a lazy loader, so a caller that needs one slot reads or
 * generates only that slot's bytes. `loadSourceAsset` checks the loaded bytes against the
 * declared identity.
 */
export type SourceAsset = { sha256: string; byteLength: number; load: () => Uint8Array };

const narrationSource = (path: string) => {
  const file = NARRATION_FIXTURE_FILES.find((candidate) => candidate.path === path)!;
  return () => narrationWav(file.durationMs, file.toneHz);
};

/** Every catalog source asset. A clean checkout fills an empty store from these with no network. */
export const SOURCE_ASSETS: readonly SourceAsset[] = [
  {
    // moenarch-scene-gallery `gallery-media`
    sha256: '911676716eeb55fe80291105c9b9db31a4888aa557ec9cffd517d6a4fe959220',
    byteLength: 1482,
    load: () => new Uint8Array(readFileSync(join(REPOSITORY_ROOT, 'public', 'fixtures', 'scene-gallery', 'media-reveal.png'))),
  },
  {
    // moenarch-narration `narration.hook` (also moenarch-materialized-audio `narration.local`)
    sha256: '7fcbe09842d61da37fbc92be7a47dabc0408b44a2342341ecf655174791d0ed9',
    byteLength: 19644,
    load: narrationSource('fixtures/narration/hook.wav'),
  },
  {
    // moenarch-narration `narration.point`
    sha256: '8d15a8a53ba7c4a2573d61231936212d9f1275a4f85986b95f5d9a632624d171',
    byteLength: 24044,
    load: narrationSource('fixtures/narration/point.wav'),
  },
  {
    // latency-explainer `latency-requests`
    sha256: 'bc4e598364f1b9ca5c1e022ee5a90bd655c2ac9f885544fbf241dcb090373108',
    byteLength: 63,
    load: latencyDatasetBytes,
  },
];

/** The source asset declaring this identity, if any; nothing is read or generated. */
export function findSourceAsset(sha256: string, byteLength: number): SourceAsset | undefined {
  return SOURCE_ASSETS.find((source) => source.sha256 === sha256 && source.byteLength === byteLength);
}

/** Loads one source asset; refuses bytes that do not have its declared identity. */
export function loadSourceAsset(source: SourceAsset): Uint8Array {
  const bytes = source.load();
  const actual = sha256Hex(bytes);
  if (actual !== source.sha256 || bytes.length !== source.byteLength) {
    throw new Error(
      `source asset declared as sha256 ${source.sha256} (${source.byteLength} bytes) loaded as sha256 ${actual} (${bytes.length} bytes)`,
    );
  }
  return bytes;
}

/** The bytes of every source asset. */
export function sourceAssets(): Uint8Array[] {
  return SOURCE_ASSETS.map(loadSourceAsset);
}

/** Imports every source asset into the store, deterministically and idempotently. */
export function importSourceAssets(store: string = DEFAULT_ASSET_STORE): { sha256: string; byteLength: number }[] {
  return sourceAssets().map((bytes) => importAssetBytes(store, bytes));
}
