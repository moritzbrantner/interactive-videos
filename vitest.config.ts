import { defineConfig } from 'vitest/config';

import { appAlias, sourcePinAliases } from './source-pins';

export default defineConfig({
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
