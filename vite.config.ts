import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, runnerImport, type Plugin } from 'vite';

import { assetObjectPath, DEFAULT_ASSET_STORE } from './src/assets/asset-store.ts';
import { assetPath } from './src/assets/asset-url.ts';
import { assertVideoSpec, type VideoSpec } from './src/spec/video-spec.ts';
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

const specsById = () =>
  new Map(
    readdirSync(FIXTURE_DIR)
      .filter((file) => file.endsWith('.videospec.json'))
      .map((file) => assertVideoSpec(JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'))))
      .map((spec): [string, VideoSpec] => [spec.project.id, spec]),
  );

type MaterializeModule = typeof import('./src/assets/materialize.ts');

/**
 * Loads src/assets/materialize.ts through Vite's module runner. The config itself is bundled with
 * its node_modules imports left external, and Node cannot strip the types of asset-tooling's
 * TypeScript sources under node_modules; the runner transforms them like app code instead.
 */
async function loadMaterialize(): Promise<MaterializeModule> {
  const { module } = await runnerImport<MaterializeModule>(join(import.meta.dirname, 'src', 'assets', 'materialize.ts'), {
    root: import.meta.dirname,
    logLevel: 'error',
    environments: { inline: { resolve: { noExternal: ['asset-tooling'] } } },
  });
  return module;
}

/**
 * Materializes every catalog project's slots into the asset-tooling store (#17): operation
 * requests run through asset-tooling's `runAssetOperation` (an unchanged request is a verified
 * hit, nothing re-executes), local and source slots are imported without network access.
 */
async function materializeCatalog(store: string, log: (message: string) => void) {
  const { materializeProject } = await loadMaterialize();
  const specs = specsById();
  const catalog = { spec: (id: string) => specs.get(id) };
  for (const id of [...specs.keys()].sort()) {
    const result = await materializeProject(id, { catalog, root: store, sourceRoot: import.meta.dirname });
    if (!result.ok) {
      throw new Error(`content-addressed-assets: ${id}: ${result.error.reason}${result.error.slot ? ` (${result.error.slot})` : ''}: ${result.error.message}`);
    }
    for (const slot of result.slots) {
      if (slot.status !== 'local') log(`${id}/${slot.id}: ${slot.status} ${slot.operation!.id}@${slot.operation!.version} → sha256 ${slot.asset.sha256}`);
    }
  }
}

/**
 * Publishes content-addressed asset objects at `assets/sha256/<digest>` (VideoSpec v2, ADR 0001).
 * The store is materialized first (asset-tooling operations for slots with requests, checked-in
 * sources otherwise), so a clean checkout (CI, Pages) builds without a pre-filled store or network
 * access. Only the image, audio and video slots the specs reference are emitted or served.
 */
function contentAddressedAssets(): Plugin {
  const store = DEFAULT_ASSET_STORE;
  let serving = false;
  return {
    name: 'content-addressed-assets',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    async buildStart() {
      // The dev server materializes once in configureServer.
      if (!serving) await materializeCatalog(store, (message) => this.info(message));
    },
    generateBundle() {
      for (const asset of servedAssets()) {
        this.emitFile({ type: 'asset', fileName: asset.path, source: readFileSync(assetObjectPath(store, asset.sha256)) });
      }
    },
    async configureServer(server) {
      await materializeCatalog(store, (message) => server.config.logger.info(`content-addressed-assets: ${message}`));
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
