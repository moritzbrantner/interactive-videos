// Acceptance for issue #16 (VideoSpec v2, content-addressed assets), written by an independent
// acceptance context before the implementation. Contract: docs/specs/videospec-v2-assets.md §1.5.
//
// In the Pages app (the same Vite build the Pages workflow publishes):
// - the scene gallery's media-reveal image and every narration audio slot load from same-origin
//   URLs that contain the slot's AssetRef sha256, and the bytes served there hash to that sha256
//   with exactly `byteLength` bytes;
// - every catalog project opens without page errors and no request URL contains `static:`;
// - the Pages artifact `dist/` (from `bun run build`, run by `bun run verify` before Playwright and
//   by the Pages workflow from a clean checkout) contains the bytes of every image/audio/video slot.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { narrationSchedule } from '../src/spec/narration-schedule.ts';
import { assertVideoSpec, resolveTimeline } from '../src/spec/video-spec.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURE_DIR = join(ROOT, 'src', 'spec', 'fixtures');
type Slot = { id: string; kind: string; asset: { sha256: string; byteLength: number; mediaType: string } };

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.videospec.json'))
  .sort()
  .map((name) => assertVideoSpec(JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'))));
const fixture = (id: string) => fixtures.find((spec) => spec.project.id === id)!;
const slotsOf = (spec: ReturnType<typeof assertVideoSpec>) => spec.assets as unknown as Slot[];

async function open(page: Page, id: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?project=${id}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  return errors;
}

async function seek(page: Page, frame: number) {
  await page.evaluate(async (target) => {
    const player = window.__latencyPlayer!;
    player.pause();
    player.seekTo(target);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, frame);
  await expect.poll(() => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame())).toBe(frame);
}

/** Fetches a URL in the page and returns its origin, sha256 and length. */
function served(page: Page, url: string) {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      status: response.status,
      origin: new URL(response.url).origin,
      sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      byteLength: bytes.byteLength,
    };
  }, url);
}

/** http(s) sources of the Player's <audio> elements that contain `digest`. */
function audioSources(page: Page, projectId: string, digest: string) {
  return page
    .locator(`[data-composition-id="${projectId}"]`)
    .evaluate(
      (player, needle) =>
        [...player.querySelectorAll('audio')]
          .map((audio) => audio.currentSrc || audio.src)
          .filter((src) => /^https?:/.test(src) && src.includes(needle)),
      digest,
    );
}

test('the media-reveal image loads from its content-addressed URL with the declared bytes', async ({ page, baseURL }) => {
  const spec = fixture('moenarch-scene-gallery');
  const image = slotsOf(spec).find((slot) => slot.kind === 'image');
  expect(image, 'the scene gallery has an image slot').toBeDefined();
  const scene = resolveTimeline(spec).scenes.find((candidate) => candidate.kind === 'mediaReveal')!;
  const errors = await open(page, spec.project.id);
  await seek(page, scene.from + Math.floor(scene.durationInFrames / 2));
  const media = page.locator('[data-moenarch-root] img[data-moenarch-media]');
  await expect(media).toHaveCount(1);
  await expect.poll(() => media.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const src = await media.evaluate((img: HTMLImageElement) => new URL(img.currentSrc || img.src, document.baseURI).href);
  expect(new URL(src).origin).toBe(new URL(baseURL!).origin);
  expect(src).toContain(image!.asset.sha256);
  expect(await served(page, src)).toEqual({
    status: 200,
    origin: new URL(baseURL!).origin,
    sha256: image!.asset.sha256,
    byteLength: image!.asset.byteLength,
  });
  expect(errors).toEqual([]);
});

test('narration audio plays from content-addressed URLs with the declared bytes', async ({ page, baseURL }) => {
  const spec = fixture('moenarch-narration');
  const audioSlots = slotsOf(spec).filter((slot) => slot.kind === 'audio');
  expect(audioSlots.length).toBeGreaterThan(0);
  const schedule = narrationSchedule(spec);
  const errors = await open(page, spec.project.id);
  const heard = new Set<string>();
  for (const scene of schedule.scenes) {
    const segment = scene.audio?.segments[0];
    if (!segment) continue;
    const slot = audioSlots.find((candidate) => candidate.id === scene.audio!.asset)!;
    await seek(page, segment.from + Math.floor(segment.durationInFrames / 2));
    await expect.poll(() => audioSources(page, spec.project.id, slot.asset.sha256), { message: slot.id }).toHaveLength(1);
    const sources = await audioSources(page, spec.project.id, slot.asset.sha256);
    const src = sources[0];
    expect(new URL(src).origin).toBe(new URL(baseURL!).origin);
    expect(await served(page, src)).toEqual({
      status: 200,
      origin: new URL(baseURL!).origin,
      sha256: slot.asset.sha256,
      byteLength: slot.asset.byteLength,
    });
    heard.add(slot.id);
  }
  expect([...heard].sort()).toEqual(audioSlots.map((slot) => slot.id).sort());
  expect(errors).toEqual([]);
});

test('every catalog project opens in the Pages app without errors and without static: requests', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  for (const spec of fixtures) {
    const errors = await open(page, spec.project.id);
    const duration = resolveTimeline(spec).durationInFrames;
    for (const frame of [0, Math.floor(duration / 2), duration - 1]) await seek(page, frame);
    expect(errors, spec.project.id).toEqual([]);
    page.removeAllListeners('pageerror');
  }
  expect(requested.filter((url) => url.includes('static:') || url.includes('static%3A'))).toEqual([]);
});

test('the Pages artifact (dist/) contains the bytes of every media asset slot', () => {
  const dist = join(ROOT, 'dist');
  expect(existsSync(join(dist, 'index.html')), 'run `bun run build` first (bun run verify does)').toBe(true);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dist);
  const identities = new Set(files.map((file) => {
    const bytes = readFileSync(file);
    return `${createHash('sha256').update(bytes).digest('hex')}:${bytes.length}`;
  }));
  // Media the Player loads (image/audio/video). Dataset slots are excluded: whether the browser
  // fetches the latency dataset or keeps generating it is Open question 1 of the contract.
  const missing = fixtures.flatMap((spec) =>
    slotsOf(spec)
      .filter((slot) => ['image', 'audio', 'video'].includes(slot.kind))
      .filter((slot) => !identities.has(`${slot.asset?.sha256}:${slot.asset?.byteLength}`))
      .map((slot) => `${spec.project.id}/${slot.id}`),
  );
  expect(missing).toEqual([]);
});
