import { defineConfig } from 'vitest/config';

import { appAlias, sourcePinAliases } from './source-pins.ts';

// The headless render smoke (`bun run test:render`): one file at a time, since each case bundles
// and renders with a real browser.
export default defineConfig({
  test: {
    include: ['src/render/**/*.smoke.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
