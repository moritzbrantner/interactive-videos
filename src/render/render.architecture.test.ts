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
