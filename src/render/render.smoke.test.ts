// Render smoke for issue #15, run by `bun run test:render` (part of `bun run verify`).
//
// Runs the documented command exactly as a user would, on a clean checkout's fixture:
//   bun run video:render --project catalog-title-card --frames 0-11 --out <tmp>/a.mp4
// Twelve frames of the 1080x1920 title-card fixture keep it cheap; it is not a production render.
// It checks the exit code, the one-line JSON result on stdout, the written MP4 (its sha256, video
// track size and frame count), byte-identical output and result across two runs (once by id, once
// by spec path), and non-zero exits with diagnostics for failures resolved before rendering.
// The renderer must use the installed Playwright Chromium, so no Remotion browser download appears.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertRenderFailure, assertRenderResult } from './render-result.test-support';

const ROOT = join(import.meta.dirname, '..', '..');
const TITLE_CARD_PATH = 'src/spec/fixtures/catalog-title-card.videospec.json';
const REMOTION_BROWSER_DIR = join(ROOT, 'node_modules', '.remotion', 'chrome-headless-shell');

const tmp = mkdtempSync(join(tmpdir(), 'iv-render-smoke-'));
let browserDownloadedBefore = false;
beforeAll(() => {
  browserDownloadedBefore = existsSync(REMOTION_BROWSER_DIR);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function render(argv: string[]) {
  const run = spawnSync('bun', ['run', 'video:render', ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 280_000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' },
  });
  const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
  const context = `exit ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
  // stdout carries exactly one line: the JSON result. Logs and progress go to stderr.
  expect(lines, context).toHaveLength(1);
  return { status: run.status, json: JSON.parse(lines[0]), stderr: run.stderr, context };
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type Box = { type: string; start: number; end: number };

/** Top-level and container MP4 boxes, enough to read track size and sample count. */
function mp4Boxes(buf: Buffer, start = 0, end = buf.length, out: Box[] = []): Box[] {
  let position = start;
  while (position + 8 <= end) {
    let size = buf.readUInt32BE(position);
    const type = buf.toString('latin1', position + 4, position + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(position + 8));
      header = 16;
    }
    if (size === 0) size = end - position;
    if (size < header) break;
    out.push({ type, start: position + header, end: position + size });
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) mp4Boxes(buf, position + header, position + size, out);
    position += size;
  }
  return out;
}

/** The video track of an MP4: width, height (tkhd), sample count (stsz) and length in seconds (mdhd). */
function videoTrack(file: string) {
  const buf = readFileSync(file);
  expect(buf.toString('latin1', 4, 8), 'MP4 starts with ftyp').toBe('ftyp');
  const boxes = mp4Boxes(buf);
  const tracks: Box[][] = [];
  for (const box of boxes) {
    if (box.type === 'trak') tracks.push([]);
    else if (tracks.length) tracks[tracks.length - 1].push(box);
  }
  const video = tracks.find((track) => {
    const hdlr = track.find((box) => box.type === 'hdlr');
    return hdlr && buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) === 'vide';
  });
  if (!video) throw new Error(`${file} has no video track`);
  const tkhd = video.find((box) => box.type === 'tkhd')!;
  const tkhdFields = buf[tkhd.start] === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4;
  const sizeOffset = tkhd.start + tkhdFields + 8 + 2 + 2 + 2 + 2 + 36;
  const mdhd = video.find((box) => box.type === 'mdhd')!;
  const long = buf[mdhd.start] === 1;
  const timescale = buf.readUInt32BE(mdhd.start + (long ? 20 : 12));
  const duration = long ? Number(buf.readBigUInt64BE(mdhd.start + 24)) : buf.readUInt32BE(mdhd.start + 16);
  const stsz = video.find((box) => box.type === 'stsz')!;
  return {
    width: buf.readUInt32BE(sizeOffset) / 65536,
    height: buf.readUInt32BE(sizeOffset + 4) / 65536,
    samples: buf.readUInt32BE(stsz.start + 8),
    seconds: duration / timescale,
  };
}

describe('bun run video:render (smoke)', () => {
  let first: ReturnType<typeof render>;

  it('renders a few frames of the title-card fixture by project id', () => {
    const out = join(tmp, 'a.mp4');
    first = render(['--project', 'catalog-title-card', '--frames', '0-11', '--out', out]);
    expect(first.status, first.context).toBe(0);
    const result = assertRenderResult(first.json);
    expect(result.request).toEqual({ project: 'catalog-title-card', profile: 'social-portrait', frames: '0-11' });
    expect(result.project.id).toBe('catalog-title-card');
    expect(result.format).toEqual({ id: 'title-card', version: 1 });
    expect(result.profile).toEqual({ id: 'social-portrait', codec: 'h264', container: 'mp4' });
    expect(result.composition).toEqual({ id: 'catalog-title-card', width: 1080, height: 1920, fps: 24, durationInFrames: 96 });
    expect(result.frames).toEqual({ from: 0, to: 11, count: 12 });

    expect(result.output.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    const bytes = readFileSync(out);
    expect(result.output.sha256).toBe(sha256(bytes));
    expect(result.output.bytes).toBe(bytes.length);

    const track = videoTrack(out);
    expect({ width: track.width, height: track.height, samples: track.samples }).toEqual({ width: 1080, height: 1920, samples: 12 });
    expect(track.seconds).toBeCloseTo(12 / 24, 3);
  });

  it('renders byte-identical output and result again when selected by spec path', () => {
    expect(first, 'the first render ran').toBeDefined();
    const out = join(tmp, 'b.mp4');
    const second = render(['--project', TITLE_CARD_PATH, '--frames', '0-11', '--out', out]);
    expect(second.status, second.context).toBe(0);
    const result = assertRenderResult(second.json);
    expect(result.output.sha256).toBe(first.json.output.sha256);
    expect(sha256(readFileSync(out))).toBe(first.json.output.sha256);
    // Everything but the selector echo and the output location is identical: nothing time-dependent.
    const comparable = (json: any) => ({ ...json, request: { ...json.request, project: null }, output: { ...json.output, path: null } });
    expect(JSON.stringify(comparable(second.json))).toBe(JSON.stringify(comparable(first.json)));
  });

  it('renders the interactive showcase headlessly without its browser-only overlay (#60)', () => {
    // Frames 900-905 fall in the scene whose Player overlay offers the modal dialog; the render
    // must not need any overlay, hover or dialog state to produce them.
    const out = join(tmp, 'showcase.mp4');
    const run = render(['--project', 'interactive-showcase', '--frames', '900-905', '--out', out]);
    expect(run.status, run.context).toBe(0);
    const result = assertRenderResult(run.json);
    expect(result.format).toEqual({ id: 'showcase', version: 1 });
    expect(result.frames).toEqual({ from: 900, to: 905, count: 6 });
    const track = videoTrack(out);
    expect({ width: track.width, height: track.height, samples: track.samples }).toEqual({ width: 1080, height: 1920, samples: 6 });
  });

  it('used the installed Playwright Chromium rather than downloading a Remotion browser', () => {
    if (!browserDownloadedBefore) expect(existsSync(REMOTION_BROWSER_DIR)).toBe(false);
  });

  const invalidSpec = () => {
    const path = join(tmp, 'invalid.videospec.json');
    const spec = JSON.parse(readFileSync(join(ROOT, TITLE_CARD_PATH), 'utf8'));
    spec.output.fps = 0;
    writeFileSync(path, JSON.stringify(spec));
    return path;
  };

  it.each([
    ['no --project', () => [], 'invalid-arguments', '--project'],
    ['an unknown project id', () => ['--project', 'no-such-project'], 'unknown-project', 'no-such-project'],
    ['a missing spec path', () => ['--project', 'src/spec/fixtures/missing.videospec.json'], 'spec-not-found', 'missing.videospec.json'],
    ['an invalid spec file', () => ['--project', invalidSpec()], 'invalid-spec', '$.output.fps'],
    ['an unknown profile', () => ['--project', 'catalog-title-card', '--profile', 'cinema-scope'], 'unknown-profile', 'cinema-scope'],
    ['a landscape project for the portrait profile', () => ['--project', 'latency-explainer'], 'profile-mismatch', '1280x720'],
    ['frames past the end', () => ['--project', 'catalog-title-card', '--frames', '90-96'], 'frames-out-of-range', '96'],
  ] as const)('fails non-zero with a diagnostic for %s, writing no output', (_name, argv, reason, mention) => {
    const out = join(tmp, `failed-${reason}.mp4`);
    const run = render([...argv(), '--out', out]);
    expect(run.status, run.context).not.toBe(0);
    const error = assertRenderFailure(run.json);
    expect(error.reason).toBe(reason);
    expect(error.message).toContain(mention);
    expect(run.stderr).toContain(error.message);
    expect(existsSync(out)).toBe(false);
  });
});
