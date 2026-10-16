// Architecture acceptance for issue #15 (deterministic headless render command).
//
// - One composition authority: the Player app and the Remotion render root both resolve projects
//   through the catalog built in src/projects.ts. There is one registerRoot, one file that declares
//   <Composition>s (the render root, in src/render/), and no second project/composition list.
// - The render path uses Remotion's supported Node renderer surface (@remotion/bundler `bundle`,
//   @remotion/renderer `selectComposition` + `renderMedia`), pinned to the installed remotion
//   version, and passes an explicit `browserExecutable` (Playwright's installed Chromium) instead of
//   letting Remotion download its own browser.
// - No LLM/agent orchestration in the render path: no model/agent SDKs, no network calls, no
//   subprocesses, no API keys.
//
// The render path is every non-test source file under src/render/ plus the script file that
// `video:render` runs. Test files (*.test.ts[x], *.test-support.ts) are not scanned.
//
// #17 (asset-tooling materialization), added by the independent #17 acceptance context:
// - Materialization lives in `src/assets/materialize.ts`, outside src/render/. No render-path file
//   imports `asset-tooling` (any subpath) directly; only the CLI entry may import the
//   `@/assets/materialize` boundary, to materialize the selected project before resolveRenderJob.
//   render-job.ts and the Remotion render root never import it.
// - Format packs and the bundled render root receive only resolved assets: nothing reachable from
//   the render root, src/formats/**, src/video/** or src/player/** imports asset-tooling, the
//   materialize module or a subprocess module.
// - The materialize module's own import closure, followed into the pinned asset-tooling sources,
//   uses no subprocess or network module and no generation/model subpath, so CI and Pages need no
//   FFmpeg, Blender, model runtime or token for the deterministic operations.
// - asset-tooling is pinned to an exact GitHub commit, like charts/tables.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(ROOT, path).split('\\').join('/');
const isTestFile = (name: string) => /\.test\.tsx?$|\.test-support\.tsx?$/.test(name);

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) && !isTestFile(name) ? [path] : [];
  });
}

const packageJson = JSON.parse(read(join(ROOT, 'package.json')));
const allDeps: Record<string, string> = { ...packageJson.dependencies, ...packageJson.devDependencies };

/** The script file `video:render` runs, e.g. `bun scripts/render.ts`. */
function renderScriptFile(): string | undefined {
  const command: string | undefined = packageJson.scripts?.['video:render'];
  const file = command?.match(/[\w./-]+\.(?:ts|tsx|mts|js|mjs)\b/)?.[0];
  return file ? join(ROOT, file) : undefined;
}

function renderPathFiles(): string[] {
  const script = renderScriptFile();
  const files = new Set(sourceFiles(join(ROOT, 'src', 'render')));
  if (script) files.add(script);
  return [...files];
}

const appSources = () => [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))];

/** Module specifiers of static imports, re-exports and dynamic imports. */
function importsOf(source: string): string[] {
  const specifiers = [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  return specifiers.map((match) => match[1]);
}

describe('render path exists', () => {
  it('has a video:render script that runs a checked-in file, and render sources under src/render/', () => {
    const script = renderScriptFile();
    expect(script, 'package.json scripts["video:render"] names its entry file').toBeDefined();
    expect(existsSync(script!), `${script} exists`).toBe(true);
    expect(sourceFiles(join(ROOT, 'src', 'render')).length).toBeGreaterThan(0);
  });
});

describe('one composition authority', () => {
  it('registers exactly one Remotion root, in src/render/', () => {
    const roots = appSources().filter((path) => /\bregisterRoot\s*\(/.test(read(path)));
    expect(roots.map(rel)).toHaveLength(1);
    expect(rel(roots[0])).toMatch(/^src\/render\//);
  });

  it('declares <Composition> in exactly one file, the render root, which resolves through the catalog', () => {
    const declaring = appSources().filter((path) => /<Composition\b/.test(read(path)));
    expect(declaring.map(rel)).toHaveLength(1);
    const root = declaring[0];
    expect(rel(root)).toMatch(/^src\/render\//);
    const source = read(root);
    const imports = importsOf(source);
    expect(imports, 'the render root takes projects from the shared catalog').toContain('@/projects');
    expect(source).toMatch(/\.resolve\s*\(/);
    // No second list: no specs, format packs or catalog construction in the render root.
    expect(imports.filter((specifier) => /\.videospec\.json$|^@\/formats\/|^@\/video\//.test(specifier))).toEqual([]);
  });

  it('builds the catalog only in src/projects.ts, which the Player app also uses', () => {
    const builders = appSources().filter((path) => /\bcreateCatalog\s*\(/.test(read(path)) && !rel(path).startsWith('src/catalog/'));
    expect(builders.map(rel)).toEqual(['src/projects.ts']);
    expect(importsOf(read(join(ROOT, 'src', 'app.tsx')))).toContain('@/projects');
  });

  it('imports no spec fixtures or format packs anywhere in the render path', () => {
    const offenders = renderPathFiles().flatMap((path) =>
      importsOf(read(path))
        .filter((specifier) => /\.videospec\.json$|^@\/formats\/|^@\/video\/|\/spec\/fixtures\//.test(specifier))
        .map((specifier) => `${rel(path)} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('supported Remotion renderer surface', () => {
  it('pins @remotion/bundler and @remotion/renderer exactly to the installed remotion version', () => {
    expect(allDeps.remotion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(allDeps['@remotion/bundler']).toBe(allDeps.remotion);
    expect(allDeps['@remotion/renderer']).toBe(allDeps.remotion);
  });

  it('bundles with @remotion/bundler and renders with selectComposition + renderMedia', () => {
    const sources = renderPathFiles().map(read);
    const imports = sources.flatMap(importsOf);
    expect(imports).toContain('@remotion/bundler');
    expect(imports).toContain('@remotion/renderer');
    const all = sources.join('\n');
    expect(all).toMatch(/\bbundle\s*\(/);
    expect(all).toMatch(/\bselectComposition\s*\(/);
    expect(all).toMatch(/\brenderMedia\s*\(/);
  });

  it('passes an explicit browserExecutable and never asks Remotion to download a browser', () => {
    const all = renderPathFiles().map(read).join('\n');
    expect(all).toMatch(/\bbrowserExecutable\b/);
    expect(all).not.toMatch(/\bensureBrowser\s*\(/);
  });
});

describe('no LLM or agent orchestration in the render path', () => {
  const FORBIDDEN_IMPORT =
    /^(openai|anthropic|@anthropic-ai\/.*|langchain|@langchain\/.*|ai|@ai-sdk\/.*|ollama|@google\/generative-ai|@google\/genai|cohere-ai|@mistralai\/.*|@remotion\/openai-whisper|@remotion\/elevenlabs|node:child_process|child_process|node:http|node:https|http|https|node:net|net|undici|axios|node-fetch)$/;

  it('imports no model/agent SDKs, network clients or subprocess modules', () => {
    const offenders = renderPathFiles().flatMap((path) =>
      importsOf(read(path))
        .filter((specifier) => FORBIDDEN_IMPORT.test(specifier))
        .map((specifier) => `${rel(path)} imports ${specifier}`),
    );
    expect(renderPathFiles().length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('makes no network calls and reads no API keys', () => {
    const offenders = renderPathFiles().flatMap((path) => {
      const source = read(path);
      return [/\bfetch\s*\(/, /\bWebSocket\b/, /\bXMLHttpRequest\b/, /API_KEY|_TOKEN\b/]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${rel(path)} matches ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('#17: asset-tooling materialization stays outside the render path', () => {
  const MATERIALIZE = join(ROOT, 'src', 'assets', 'materialize.ts');
  const AT_SPECIFIER = /^asset-tooling(?:\/|$)/;
  const SUBPROCESS_OR_NETWORK =
    /^(node:child_process|child_process|node:http|node:https|http|https|node:net|net|node:dgram|dgram|undici|axios|node-fetch|ws)$/;
  const isMaterialize = (specifier: string) => /^@\/assets\/materialize(?:\.ts)?$/.test(specifier) || /(?:^|\/)materialize(?:\.ts)?$/.test(specifier);

  /** Import specifiers, ignoring type-only imports and re-exports (they emit no code). */
  function runtimeImportsOf(source: string): string[] {
    const stripped = source
      .replace(/\bimport\s+type\s[^;]*?from\s*['"][^'"]+['"]\s*;?/g, '')
      .replace(/\bexport\s+type\s[^;]*?from\s*['"][^'"]+['"]\s*;?/g, '');
    return importsOf(stripped);
  }

  /** Resolves an in-repo or asset-tooling module file, or undefined for externals. */
  function resolveFile(from: string, specifier: string): string | undefined {
    const candidates = (base: string) => [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      base.replace(/\.js$/, '.ts'),
      base.replace(/\.js$/, '.tsx'),
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ];
    let base: string | undefined;
    if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
    else if (specifier.startsWith('.')) base = join(from, '..', specifier);
    else if (AT_SPECIFIER.test(specifier)) {
      const pkgDir = join(ROOT, 'node_modules', 'asset-tooling');
      const pkg = JSON.parse(read(join(pkgDir, 'package.json')));
      const subpath = specifier === 'asset-tooling' ? '.' : `./${specifier.slice('asset-tooling/'.length)}`;
      const target = pkg.exports?.[subpath];
      expect(typeof target, `asset-tooling exports ${subpath}`).toBe('string');
      base = join(pkgDir, target);
    }
    if (!base) return undefined;
    return candidates(base).find((path) => existsSync(path) && statSync(path).isFile());
  }

  /** Every file and external specifier reachable from `entries` through runtime imports. */
  function closure(entries: string[], { followAssetTooling }: { followAssetTooling: boolean }) {
    const files = new Set<string>();
    const externals: { from: string; specifier: string }[] = [];
    const stack = [...entries];
    while (stack.length) {
      const file = stack.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(file)) continue;
      for (const specifier of runtimeImportsOf(read(file))) {
        if (/\.json$|\.css$/.test(specifier)) continue;
        const isAt = AT_SPECIFIER.test(specifier);
        const internal = specifier.startsWith('@/') || specifier.startsWith('.');
        if (isAt) externals.push({ from: rel(file), specifier });
        if (internal || (isAt && followAssetTooling)) {
          const target = resolveFile(file, specifier);
          if (target) stack.push(target);
          else if (!isAt) externals.push({ from: rel(file), specifier });
        } else if (!isAt) externals.push({ from: rel(file), specifier });
      }
    }
    return { files: [...files], externals };
  }

  it('pins asset-tooling to an exact GitHub commit and has it installed', () => {
    expect(allDeps['asset-tooling']).toMatch(/^github:moritzbrantner\/asset-tooling#[0-9a-f]{40}$/);
    const installed = join(ROOT, 'node_modules', 'asset-tooling', 'package.json');
    expect(existsSync(installed), 'bun install has installed the pinned asset-tooling').toBe(true);
    expect(JSON.parse(read(installed)).name).toBe('asset-tooling');
  });

  it('keeps the materialize module outside src/render/', () => {
    expect(existsSync(MATERIALIZE), 'src/assets/materialize.ts exists').toBe(true);
    expect(sourceFiles(join(ROOT, 'src', 'render')).filter((path) => /materiali[sz]e/i.test(path)).map(rel)).toEqual([]);
  });

  it('imports asset-tooling nowhere in the render path, and the materialize boundary only from the CLI', () => {
    const script = renderScriptFile();
    const offenders = renderPathFiles().flatMap((path) =>
      importsOf(read(path))
        .filter((specifier) => AT_SPECIFIER.test(specifier) || (isMaterialize(specifier) && path !== script && rel(path) !== 'src/render/cli.ts'))
        .map((specifier) => `${rel(path)} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
    // The CLI materializes the selected project before resolving the job.
    const cli = read(join(ROOT, 'src', 'render', 'cli.ts'));
    const entry = script ? read(script) : '';
    expect([...importsOf(cli), ...importsOf(entry)].some(isMaterialize), 'the render CLI calls the materialize boundary').toBe(true);
    expect(importsOf(read(join(ROOT, 'src', 'render', 'render-job.ts'))).some(isMaterialize)).toBe(false);
  });

  it('gives the render root and format packs only resolved assets: no asset-tooling, materialize or subprocess reachable', () => {
    const entries = [
      join(ROOT, 'src', 'render', 'root.tsx'),
      ...sourceFiles(join(ROOT, 'src', 'formats')),
      ...sourceFiles(join(ROOT, 'src', 'video')),
      ...sourceFiles(join(ROOT, 'src', 'player')),
    ];
    const { files, externals } = closure(entries, { followAssetTooling: false });
    expect(files.filter((path) => path === MATERIALIZE).map(rel)).toEqual([]);
    expect(
      externals
        .filter(({ specifier }) => AT_SPECIFIER.test(specifier) || SUBPROCESS_OR_NETWORK.test(specifier))
        .map(({ from, specifier }) => `${from} imports ${specifier}`),
    ).toEqual([]);
  });

  it('materializes through asset-tooling without subprocesses, network or generation/model subpaths', () => {
    expect(existsSync(MATERIALIZE), 'src/assets/materialize.ts exists').toBe(true);
    const { files, externals } = closure([MATERIALIZE], { followAssetTooling: true });
    const atSpecifiers = externals.filter(({ specifier }) => AT_SPECIFIER.test(specifier));
    expect(atSpecifiers.map(({ specifier }) => specifier), 'materialize uses asset-tooling').toContain('asset-tooling/operations/store');
    expect(
      atSpecifiers
        .filter(({ specifier }) => /^asset-tooling\/operations\/(generation|audio\/model|processing)/.test(specifier))
        .map(({ from, specifier }) => `${from} imports ${specifier}`),
    ).toEqual([]);
    expect(
      externals.filter(({ specifier }) => SUBPROCESS_OR_NETWORK.test(specifier)).map(({ from, specifier }) => `${from} imports ${specifier}`),
    ).toEqual([]);
    const sources = files.filter((path) => /\.(ts|tsx|mts|js|mjs)$/.test(path)).map(read).join('\n');
    expect(sources).not.toMatch(/\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|API_KEY|_TOKEN\b/);
  });
});
