import { configDefaults, defineConfig } from 'vitest/config';

import { appAlias, sourcePinAliases } from './source-pins.ts';

export default defineConfig({
  test: {
    // e2e/ holds Playwright specs, run by `bun run test:budget`.
    include: ['src/**/*.test.{ts,tsx}'],
    // Render smokes run the headless renderer; `bun run test:render` runs them (vitest.render.config.ts).
    exclude: [...configDefaults.exclude, 'src/**/*.smoke.test.ts'],
  },
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
