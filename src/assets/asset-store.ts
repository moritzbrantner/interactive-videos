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
 * The checked-in or deterministically generated source bytes of every catalog asset. A clean
 * checkout fills an empty store from these with no network access.
 */
export function sourceAssets(): Uint8Array[] {
  return [
    new Uint8Array(readFileSync(join(REPOSITORY_ROOT, 'public', 'fixtures', 'scene-gallery', 'media-reveal.png'))),
    ...NARRATION_FIXTURE_FILES.map((file) => narrationWav(file.durationMs, file.toneHz)),
    latencyDatasetBytes(),
  ];
}

/** Imports every source asset into the store, deterministically and idempotently. */
export function importSourceAssets(store: string = DEFAULT_ASSET_STORE): { sha256: string; byteLength: number }[] {
  return sourceAssets().map((bytes) => importAssetBytes(store, bytes));
}
