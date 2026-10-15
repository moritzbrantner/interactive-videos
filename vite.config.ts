import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { assetObjectPath, DEFAULT_ASSET_STORE, importSourceAssets } from './src/assets/asset-store.ts';
import { ASSET_URL_PREFIX } from './src/assets/asset-url.ts';
import { appAlias, sourcePinAliases } from './source-pins.ts';

const FIXTURE_DIR = join(import.meta.dirname, 'src', 'spec', 'fixtures');
const SERVED_KINDS = new Set(['image', 'audio', 'video']);

/** Digests of every image, audio and video slot the catalog's specs reference. */
function servedDigests(): string[] {
  const digests = new Set<string>();
  for (const name of readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.videospec.json'))) {
    const spec = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as { assets: { kind: string; asset: { sha256: string } }[] };
    for (const slot of spec.assets) if (SERVED_KINDS.has(slot.kind)) digests.add(slot.asset.sha256);
  }
  return [...digests].sort();
}

/**
 * Publishes content-addressed asset objects at `assets/sha256/<digest>` (VideoSpec v2, ADR 0001).
 * The store is filled deterministically from checked-in sources first, so a clean checkout
 * (CI, Pages) builds without a pre-filled store or network access.
 */
function contentAddressedAssets(): Plugin {
  const store = DEFAULT_ASSET_STORE;
  return {
    name: 'content-addressed-assets',
    buildStart() {
      importSourceAssets(store);
    },
    generateBundle() {
      for (const digest of servedDigests()) {
        this.emitFile({ type: 'asset', fileName: `${ASSET_URL_PREFIX}${digest}`, source: readFileSync(assetObjectPath(store, digest)) });
      }
    },
    configureServer(server) {
      importSourceAssets(store);
      server.middlewares.use((request, response, next) => {
        const match = /\/assets\/sha256\/([0-9a-f]{64})$/.exec((request.url ?? '').split('?')[0]);
        if (!match || !servedDigests().includes(match[1])) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(readFileSync(assetObjectPath(store, match[1])));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), contentAddressedAssets()],
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
