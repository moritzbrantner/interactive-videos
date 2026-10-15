import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { assetObjectPath, DEFAULT_ASSET_STORE, importSourceAssets } from './src/assets/asset-store.ts';
import { assetPath } from './src/assets/asset-url.ts';
import { appAlias, sourcePinAliases } from './source-pins.ts';

const FIXTURE_DIR = join(import.meta.dirname, 'src', 'spec', 'fixtures');
const SERVED_KINDS = new Set(['image', 'audio', 'video']);

type Served = { path: string; sha256: string; mediaType: string };

/** Every image, audio and video object the catalog's specs reference, at its served path. */
function servedAssets(): Served[] {
  const served = new Map<string, Served>();
  for (const name of readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.videospec.json'))) {
    const spec = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as {
      assets: { kind: string; asset: { sha256: string; mediaType: string } }[];
    };
    for (const slot of spec.assets) {
      if (!SERVED_KINDS.has(slot.kind)) continue;
      const path = assetPath(slot.asset.sha256, slot.asset.mediaType);
      served.set(path, { path, sha256: slot.asset.sha256, mediaType: slot.asset.mediaType });
    }
  }
  return [...served.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
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
      for (const asset of servedAssets()) {
        this.emitFile({ type: 'asset', fileName: asset.path, source: readFileSync(assetObjectPath(store, asset.sha256)) });
      }
    },
    configureServer(server) {
      importSourceAssets(store);
      server.middlewares.use((request, response, next) => {
        // Only exact served paths of catalog slots match; nothing else in the store is exposed.
        const requested = (request.url ?? '').split('?')[0];
        const asset = servedAssets().find((candidate) => requested.endsWith(`/${candidate.path}`));
        if (!asset) return next();
        response.setHeader('Content-Type', asset.mediaType);
        response.end(readFileSync(assetObjectPath(store, asset.sha256)));
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
