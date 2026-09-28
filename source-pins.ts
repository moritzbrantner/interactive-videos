import { fileURLToPath } from 'node:url';

// @moritzbrantner/charts, @moritzbrantner/tables, and react-render-budget are pinned to exact GitHub commits in
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
];

export const appAlias = {
  find: /^@\//,
  replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/`,
};
