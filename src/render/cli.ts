// `bun run video:render --project <id-or-spec-path> [--out <path>] [--frames <a>-<b>] [--profile <id>]`
//
// Resolves the job (render-job.ts) before anything is bundled, bundles the render root
// (root.tsx) with @remotion/bundler and renders it with @remotion/renderer in Playwright's
// installed Chromium. stdout carries exactly one line, the JSON result (schema v1); logs and
// progress go to stderr. A failure exits non-zero and leaves no output file behind.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { chromium } from '@playwright/test';
import { bundle, webpack } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

import { catalog } from '@/projects';

import { appAlias, sourcePinAliases } from '../../source-pins.ts';
import {
  createRenderFailure,
  createRenderResult,
  parseRenderArgs,
  resolveRenderJob,
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
  try {
    log(`video:render: bundling ${ENTRY_POINT}`);
    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: PUBLIC_DIR,
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

async function main() {
  const parsed = parseRenderArgs(process.argv.slice(2));
  if (!parsed.ok) return failWith(parsed.error);
  let resolved: ReturnType<typeof resolveRenderJob>;
  try {
    resolved = resolveRenderJob(parsed.args, {
      catalog,
      cwd: process.cwd(),
      publicDir: PUBLIC_DIR,
    });
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
