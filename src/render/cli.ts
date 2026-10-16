// `bun run video:render --project <id-or-spec-path> [--out <path>] [--frames <a>-<b>] [--profile <id>]`
//
// Materializes the selected project's asset slots through asset-tooling (src/assets/materialize.ts,
// #17), resolves the job (render-job.ts) before anything is bundled, bundles the render root
// (root.tsx) with @remotion/bundler and renders it with @remotion/renderer in Playwright's
// installed Chromium. stdout carries exactly one line, the JSON result (schema v2); logs and
// progress go to stderr. A failure exits non-zero and leaves no output file behind.
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { chromium } from '@playwright/test';
import { bundle, webpack } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

import { assetObjectPath, DEFAULT_ASSET_STORE } from '@/assets/asset-store';
import { materializeProject, type MaterializeError } from '@/assets/materialize';
import { catalog } from '@/projects';

import { appAlias, sourcePinAliases } from '../../source-pins.ts';
import {
  createRenderFailure,
  createRenderResult,
  parseRenderArgs,
  resolveRenderJob,
  selectedProjectId,
  type RenderEnvironment,
  type RenderError,
  type RenderJob,
} from './render-job';

const ROOT = join(import.meta.dirname, '..', '..');
const ENTRY_POINT = join(import.meta.dirname, 'root.tsx');
const PUBLIC_DIR = join(ROOT, 'public');

// Remotion and its dependencies log through console.log; keep stdout for the result line only.
const log = (...parts: unknown[]) => console.error(...parts);
console.log = log;
console.info = log;

/** The Vite/Vitest aliases (source-pins.ts) as webpack aliases: `^x$` becomes the exact match `x$`. */
function webpackAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const { find, replacement } of sourcePinAliases) {
    aliases[find.source.replace(/^\^/, '').replace(/\\(.)/g, '$1')] = replacement;
  }
  aliases['@'] = appAlias.replacement.replace(/\/$/, '');
  return aliases;
}

const sha256File = (path: string) => {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
};

async function render(job: RenderJob) {
  const browserExecutable = chromium.executablePath();
  // Rendered beside the target under a temporary name (keeping the container extension Remotion
  // checks). Hashing and every cleanup happen before the final rename, so a failure at any step
  // leaves no file at the output path; the bundle directory is removed even if bundling rejects.
  const partial = join(
    dirname(job.outPath),
    `.${basename(job.outPath)}.partial-${process.pid}.${job.profile.container}`,
  );
  let bundleDir: string | undefined;
  // The bundle's public directory: the checked-in public files plus exactly the job's resolved,
  // content-addressed objects at their served paths.
  const stagedPublic = mkdtempSync(join(tmpdir(), 'iv-render-public-'));
  try {
    cpSync(PUBLIC_DIR, stagedPublic, { recursive: true });
    for (const asset of job.assets) {
      mkdirSync(dirname(join(stagedPublic, asset.src)), { recursive: true });
      copyFileSync(assetObjectPath(DEFAULT_ASSET_STORE, asset.sha256), join(stagedPublic, asset.src));
    }
    log(`video:render: bundling ${ENTRY_POINT}`);
    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: stagedPublic,
      onProgress: () => undefined,
      onDirectoryCreated: (dir) => {
        bundleDir = dir;
      },
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...(config.resolve?.alias as Record<string, string> | undefined),
            ...webpackAliases(),
          },
        },
        plugins: [
          ...(config.plugins ?? []),
          // The app reads Vite's import.meta.env; a render is a production build served by Remotion.
          new webpack.DefinePlugin({
            'import.meta.env.MODE': JSON.stringify('production'),
            'import.meta.env.BASE_URL': '(window.remotion_staticBase + "/")',
          }),
        ],
      }),
    });
    bundleDir ??= serveUrl;
    const composition = await selectComposition({
      serveUrl,
      id: job.composition.id,
      browserExecutable,
      logLevel: 'error',
    });
    mkdirSync(dirname(job.outPath), { recursive: true });
    log(
      `video:render: rendering ${job.composition.id} frames ${job.frames.from}-${job.frames.to} with ${browserExecutable}`,
    );
    await renderMedia({
      serveUrl,
      composition,
      codec: job.profile.codec,
      outputLocation: partial,
      frameRange: [job.frames.from, job.frames.to],
      concurrency: 1,
      browserExecutable,
      logLevel: 'error',
      overwrite: true,
    });
    const digest = sha256File(partial);
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
    bundleDir = undefined;
    renameSync(partial, job.outPath);
    return { path: job.outPath, ...digest };
  } finally {
    rmSync(partial, { force: true });
    rmSync(stagedPublic, { recursive: true, force: true });
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
  }
}

function finish(line: object, code: number): never {
  process.stdout.write(`${JSON.stringify(line)}\n`, () => process.exit(code));
  // Wait for the write callback; exiting here could cut the line short.
  return undefined as never;
}

function failWith(error: RenderError): never {
  log(`video:render failed (${error.reason}): ${error.message}`);
  return finish(createRenderFailure(error), 1);
}

/** A materialization failure as a render failure; a lock mismatch is an asset mismatch. */
const materializeFailure = (error: MaterializeError): RenderError => ({
  reason: error.reason === 'asset-lock-mismatch' ? 'asset-mismatch' : 'render-failed',
  message: `materialize ${error.reason}${error.slot ? ` (${error.slot})` : ''}: ${error.message}`,
});

async function main() {
  const parsed = parseRenderArgs(process.argv.slice(2));
  if (!parsed.ok) return failWith(parsed.error);
  let resolved: ReturnType<typeof resolveRenderJob>;
  try {
    const environment: RenderEnvironment = { catalog, cwd: process.cwd(), assetStore: DEFAULT_ASSET_STORE };
    // Materialize only the selected project, before the job is resolved: a clean checkout fills
    // the asset-tooling store deterministically and without network access, and unchanged
    // operation requests are reused (asset-tooling `runAssetOperation`). A selector that names no
    // catalog project is left to the job's resolution, which reports why.
    const projectId = selectedProjectId(parsed.args, environment);
    if (projectId !== undefined) {
      const materialized = await materializeProject(projectId, { catalog, root: DEFAULT_ASSET_STORE, sourceRoot: ROOT });
      if (!materialized.ok) return failWith(materializeFailure(materialized.error));
      for (const slot of materialized.slots) {
        log(`video:render: ${slot.id} ${slot.status}${slot.operation ? ` ${slot.operation.id}@${slot.operation.version}` : ''} sha256 ${slot.asset.sha256}`);
      }
      environment.materialized = materialized.slots;
    }
    resolved = resolveRenderJob(parsed.args, environment);
  } catch (error) {
    // I/O failures while reading a spec or asset (unreadable, removed mid-check) are failures too.
    return failWith({
      reason: 'render-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!resolved.ok) return failWith(resolved.error);
  const { job } = resolved;
  let output;
  try {
    output = await render(job);
  } catch (error) {
    return failWith({
      reason: 'render-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  log(`video:render: wrote ${output.path} (${output.bytes} bytes)`);
  return finish(createRenderResult(job, output), 0);
}

main().catch((error: unknown) =>
  failWith({
    reason: 'render-failed',
    message: error instanceof Error ? error.message : String(error),
  }),
);
