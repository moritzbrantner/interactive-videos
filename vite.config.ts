import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { appAlias, sourcePinAliases } from './source-pins';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [...sourcePinAliases, appAlias],
  },
});
