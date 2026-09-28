import { defineConfig } from 'vitest/config';

import { appAlias, sourcePinAliases } from './source-pins.ts';

export default defineConfig({
  test: {
    // e2e/ holds Playwright specs, run by `bun run test:budget`.
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
