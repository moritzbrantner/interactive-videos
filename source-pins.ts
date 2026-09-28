import { fileURLToPath } from 'node:url';

// @moritzbrantner/charts and @moritzbrantner/tables are pinned to exact GitHub commits in
// package.json. Git installs contain source but no built dist/, so entry points resolve to the
// pinned src/ files. Keep this list in sync with "paths" in tsconfig.json.
const pinned = (path: string) =>
  fileURLToPath(new URL(`./node_modules/@moritzbrantner/${path}`, import.meta.url));

export const sourcePinAliases = [
  { find: /^@moritzbrantner\/charts\/density$/, replacement: pinned('charts/src/density.ts') },
  { find: /^@moritzbrantner\/tables\/table$/, replacement: pinned('tables/src/table.tsx') },
  { find: /^@moritzbrantner\/tables\/table\.css$/, replacement: pinned('tables/table.css') },
];

export const appAlias = {
  find: /^@\//,
  replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/`,
};
