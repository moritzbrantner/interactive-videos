import { fileURLToPath } from 'node:url';

// @moritzbrantner/charts, @moritzbrantner/tables, react-render-budget and asset-tooling are pinned to exact GitHub commits in
// package.json. Git installs contain source but no built dist/, so entry points resolve to the
// pinned src/ files. Keep this list in sync with "paths" in tsconfig.json.
const pinnedPackage = (path: string) =>
  fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));
const pinned = (path: string) => pinnedPackage(`@moritzbrantner/${path}`);

export const sourcePinAliases = [
  { find: /^@moritzbrantner\/charts\/density$/, replacement: pinned('charts/src/density.ts') },
  { find: /^@moritzbrantner\/tables\/table$/, replacement: pinned('tables/src/table.tsx') },
  { find: /^@moritzbrantner\/tables\/table\.css$/, replacement: pinned('tables/table.css') },
  { find: /^react-render-budget\/react$/, replacement: pinnedPackage('react-render-budget/src/react.ts') },
  // asset-tooling (#17): only the subpaths src/assets/materialize.ts and its tests use. Node cannot
  // strip types under node_modules; Vitest inlines these sources, the bun CLI runs them natively and
  // the Vite config loads materialize.ts through Vite's module runner (vite.config.ts).
  { find: /^asset-tooling\/operations$/, replacement: pinnedPackage('asset-tooling/src/operations.ts') },
  { find: /^asset-tooling\/operations\/store$/, replacement: pinnedPackage('asset-tooling/src/asset-store.ts') },
  {
    find: /^asset-tooling\/operations\/audio\/procedural$/,
    replacement: pinnedPackage('asset-tooling/src/audio-procedural-operations.ts'),
  },
];

export const appAlias = {
  find: /^@\//,
  replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/`,
};
