// Shared, git-ignored, content-addressed asset store (VideoSpec v2, ADR 0001). Objects are keyed by
// their SHA-256 digest only: <store>/sha256/<digest>. Acquisition stays here and in build tooling,
// never in renderer components. Relative imports only, so the Vite config can use this module.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NARRATION_FIXTURE_FILES, narrationWav } from '../spec/fixtures/narration-audio';
import { latencyDatasetBytes } from '../video/latency-dataset';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The default store: `.asset-store/` at the repository root (git-ignored). */
export const DEFAULT_ASSET_STORE = join(REPOSITORY_ROOT, '.asset-store');

const DIGEST = /^[0-9a-f]{64}$/;

/** Where the object with this digest lives; refuses anything that is not a sha256 digest. */
export function assetObjectPath(store: string, sha256: string): string {
  if (!DIGEST.test(sha256)) throw new Error(`not a lowercase sha256 digest: ${JSON.stringify(sha256)}`);
  return join(store, 'sha256', sha256);
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
