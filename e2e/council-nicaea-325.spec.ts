// Acceptance for issue #82 (Nicaea I pilot, slice 1: narrated English watch-through on Pages),
// written by an independent acceptance context before any implementation, against baseline 3c8ad7b.
// Data contract and seams: src/content/councils/council-nicaea-325.test.ts (header).
//
// Runs on the production build served by `vite preview` (playwright.config.ts), like every e2e spec.
//
// Player DOM contract for English subtitles (new; Atlas 3.10, English part):
// - The toolbar (`role=group` "Video controls") has a native <select> with the accessible name
//   "Subtitles" and the options "Off" and "English". "English" is selected when the project opens,
//   so a viewer who only presses Play sees subtitles. Changing it never moves the playback position.
// - While a scheduled cue window (`narrationSchedule(spec)`) contains the current frame and English
//   is selected, exactly one visible element `[data-subtitle-cue]` inside the player
//   (`[data-composition-id="council-nicaea-325"]`) shows that cue's text (whitespace-normalized),
//   and it or an ancestor carries `lang="en"`. With "Off" selected, none is visible.
//   (Burned into the composition or drawn at the Player boundary: both satisfy this contract.)
//
// Other visible text (Atlas 3.6, 3.22, 3.16): script.json `perspective.statement` is visible as text
// (not a subtitle) at some frame of the scene `perspective.scene`; script.json
// `disclosure.syntheticNarration` is visible in the episode (at some frame, or on the page next to
// the player); every media reveal shows its caption.
//
// Watching straight through to the end takes 2–3 minutes, so the journey presses Play once, observes
// real playback with changing subtitles, seeks back and resumes, and then seeks near the end and
// plays until the Player reports the end.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { narrationSchedule } from '../src/spec/narration-schedule.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PROJECT_ID = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT_ID}.videospec.json`);
const SCRIPT_PATH = join(ROOT, 'src', 'content', 'councils', 'nicaea-325', 'script.json');

type Json = Record<string, any>;

let cached: { spec: ReturnType<typeof assertVideoSpec>; schedule: ReturnType<typeof narrationSchedule>; script: Json } | null = null;
function subject() {
  if (!cached) {
    expect(existsSync(SPEC_PATH), `${PROJECT_ID} spec exists`).toBe(true);
    expect(existsSync(SCRIPT_PATH), 'src/content/councils/nicaea-325/script.json exists').toBe(true);
    const spec = assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
    cached = { spec, schedule: narrationSchedule(spec), script: JSON.parse(readFileSync(SCRIPT_PATH, 'utf8')) };
  }
  return cached;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const cues = () => subject().schedule.scenes.flatMap((scene) => scene.cues);
const cueAt = (frame: number) => cues().find((cue) => frame >= cue.from && frame < cue.from + cue.durationInFrames) ?? null;
/** Narration slots and their locks. */
function narrationLocks() {
  const { spec } = subject();
  const ids = new Set(spec.scenes.flatMap((scene) => (scene.narration?.audio ? [scene.narration.audio.asset] : [])));
  return (spec.assets as unknown as { id: string; asset: { sha256: string; byteLength: number } }[])
    .filter((slot) => ids.has(slot.id))
    .map((slot) => ({ id: slot.id, sha256: slot.asset.sha256, byteLength: slot.asset.byteLength }));
}

const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });
const player = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);

async function open(page: Page) {
  subject(); // fail fast, with the data diagnostic, before waiting on the Player
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?project=${PROJECT_ID}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return errors;
}

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());

async function seek(page: Page, frame: number) {
  await page.evaluate(async (target) => {
    const ref = window.__latencyPlayer!;
    ref.pause();
    ref.seekTo(target);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, frame);
  await expect.poll(() => currentFrame(page)).toBe(frame);
}

/** Visible `[data-subtitle-cue]` elements in the player, with their text and language, plus the frame. */
function subtitleState(page: Page) {
  return player(page).evaluate((root) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        opacity *= Number(style.opacity);
      }
      return opacity > 0.5;
    };
    const cues = [...root.querySelectorAll('[data-subtitle-cue]')].filter(visible);
    return {
      frame: window.__latencyPlayer!.getCurrentFrame(),
      cues: cues.map((element) => ({
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
        lang: element.closest('[lang]')?.getAttribute('lang') ?? null,
      })),
    };
  });
}

/** Whether `text` is visible as one element's text (not a subtitle), inside the player or anywhere on the page. */
function textVisible(page: Page, text: string, scope: 'player' | 'page') {
  return page.evaluate(
    ({ target, scope: where, id }) => {
      const squashText = (value: string) => value.replace(/\s+/g, ' ').trim();
      const root = where === 'player' ? document.querySelector(`[data-composition-id="${id}"]`) : document.body;
      if (!root) return false;
      const wanted = squashText(target);
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          opacity *= Number(style.opacity);
        }
        return opacity > 0.5;
      };
      const holders = [...root.querySelectorAll('*')].filter(
        (element) =>
          !element.closest('[data-subtitle-cue]') &&
          squashText(element.textContent ?? '').includes(wanted) &&
          ![...element.children].some((child) => squashText(child.textContent ?? '').includes(wanted)),
      );
      return holders.some(visible);
    },
    { target: text, scope, id: PROJECT_ID },
  );
}

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

/** Same-origin <audio> sources in the player that contain a narration lock digest. */
function narrationAudioSources(page: Page) {
  return player(page).evaluate(
    (root, digests) =>
      [...root.querySelectorAll('audio')]
        .map((audio) => audio.currentSrc || audio.src)
        .filter((src) => /^https?:/.test(src) && digests.some((digest) => new URL(src).pathname.includes(digest))),
    narrationLocks().map((lock) => lock.sha256),
  );
}

test('opens at its stable URL from the catalog with the duration of its spec', async ({ page }) => {
  const { spec, schedule } = subject();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?project=latency-explainer');
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.getByRole('navigation', { name: /projects/i }).getByRole('link', { name: spec.project.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]project=${PROJECT_ID}(&|$)`));
  await expect(page.getByRole('heading', { level: 1, name: spec.project.title })).toBeVisible();
  await expect(player(page)).toHaveAttribute('data-duration-in-frames', String(schedule.durationInFrames));
  await expect(player(page)).toHaveAttribute('data-fps', String(spec.output.fps));
  const seconds = schedule.durationInFrames / schedule.fps;
  expect(seconds).toBeGreaterThanOrEqual(120);
  expect(seconds).toBeLessThanOrEqual(180);
  // Reloading the stable URL opens the same project.
  await page.reload();
  await expect(player(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('plays after one Play press: frames advance, English subtitles change, narration is the locked object', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const foreign: string[] = [];
  const assetResponses: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== new URL(baseURL!).origin) foreign.push(url);
  });
  page.on('response', (response) => {
    if (response.url().includes('/assets/sha256/')) assetResponses.push(response.url());
  });
  const errors = await open(page);
  await expect(controls(page).getByRole('combobox', { name: 'Subtitles' })).toHaveValue(/./);
  await expect(controls(page).getByRole('combobox', { name: 'Subtitles' }).locator('option:checked')).toHaveText('English');

  // The only interaction: one pointer press on Play.
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(controls(page).getByRole('button', { name: 'Pause video', exact: true })).toBeVisible();
  await expect.poll(() => currentFrame(page), { timeout: 10_000 }).toBeGreaterThan(subject().schedule.fps);

  // Watch until two different cues have been shown, each matching the schedule at its frame.
  const seen = new Set<string>();
  const deadline = Date.now() + 90_000;
  while (seen.size < 2 && Date.now() < deadline) {
    const state = await subtitleState(page);
    if (state.cues.length > 0) {
      expect(state.cues, `frame ${state.frame}: exactly one subtitle`).toHaveLength(1);
      const [shown] = state.cues;
      const expected = [state.frame - 1, state.frame, state.frame + 1].map(cueAt).filter((cue) => cue !== null).map((cue) => squash(cue!.text));
      expect(expected, `frame ${state.frame}: "${shown.text}" is a scheduled cue here`).toContain(shown.text);
      expect(shown.lang ?? '', 'subtitle language').toMatch(/^en\b/);
      seen.add(shown.text);
    }
    await page.waitForTimeout(250);
  }
  expect(seen.size, 'the English subtitle changed during playback').toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__latencyPlayer!.isPlaying()), 'still playing without further interaction').toBe(true);

  // The narration plays from the content-addressed object whose bytes are the lock.
  await expect.poll(() => narrationAudioSources(page), { timeout: 10_000 }).not.toEqual([]);
  const locks = narrationLocks();
  for (const src of await narrationAudioSources(page)) {
    const lock = locks.find((candidate) => new URL(src).pathname.includes(candidate.sha256))!;
    expect(new URL(src).pathname, lock.id).toMatch(new RegExp(`/assets/sha256/${lock.sha256}\\.wav$`));
    expect(await served(page, src), lock.id).toEqual({ status: 200, origin: new URL(baseURL!).origin, sha256: lock.sha256, byteLength: lock.byteLength });
  }
  expect(assetResponses.some((url) => locks.some((lock) => url.includes(lock.sha256))), 'the narration object was requested').toBe(true);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('seeking back while playing resumes from the earlier point with its subtitle', async ({ page }) => {
  test.setTimeout(90_000);
  const { schedule } = subject();
  const errors = await open(page);
  const narrated = cues();
  expect(narrated.length).toBeGreaterThan(4);
  const later = narrated[Math.floor(narrated.length / 2)];
  const earlier = narrated[Math.floor(narrated.length / 4)];
  await seek(page, later.from + 1);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => currentFrame(page)).toBeGreaterThan(later.from + schedule.fps);

  const target = earlier.from + Math.min(5, Math.floor(earlier.durationInFrames / 2));
  await page.evaluate((frame) => window.__latencyPlayer!.seekTo(frame), target);
  const resumedAt = await currentFrame(page);
  expect(resumedAt, 'the seek went back').toBeLessThan(later.from);
  expect(await page.evaluate(() => window.__latencyPlayer!.isPlaying()), 'playback continues after the seek').toBe(true);
  await expect.poll(() => currentFrame(page)).toBeGreaterThan(resumedAt + Math.floor(schedule.fps / 2));
  expect(await currentFrame(page)).toBeLessThan(later.from);
  const state = await subtitleState(page);
  const expected = [state.frame - 1, state.frame, state.frame + 1].map(cueAt).filter((cue) => cue !== null).map((cue) => squash(cue!.text));
  if (expected.length > 0) {
    expect(state.cues, `frame ${state.frame}: exactly one subtitle`).toHaveLength(1);
    expect(expected, `frame ${state.frame}: the subtitle after the seek is the cue there`).toContain(state.cues[0].text);
  }

  // Paused: seek back once more and resume with the toolbar.
  await seek(page, earlier.from);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => currentFrame(page)).toBeGreaterThan(earlier.from);
  expect(errors).toEqual([]);
});

test('English subtitles can be switched off and on without losing the place', async ({ page }) => {
  const errors = await open(page);
  const cue = cues()[Math.floor(cues().length / 3)];
  const frame = cue.from + Math.floor(cue.durationInFrames / 2);
  await seek(page, frame);
  const select = controls(page).getByRole('combobox', { name: 'Subtitles' });
  await expect(select.locator('option')).toHaveText(['Off', 'English']);
  await expect.poll(async () => (await subtitleState(page)).cues).toEqual([{ text: squash(cue.text), lang: expect.stringMatching(/^en\b/) }]);
  await select.selectOption({ label: 'Off' });
  await expect.poll(async () => (await subtitleState(page)).cues).toEqual([]);
  expect(await currentFrame(page)).toBe(frame);
  await select.selectOption({ label: 'English' });
  await expect.poll(async () => (await subtitleState(page)).cues.map((shown) => shown.text)).toEqual([squash(cue.text)]);
  expect(await currentFrame(page)).toBe(frame);
  expect(errors).toEqual([]);
});

test('playback reaches the end of the episode', async ({ page }) => {
  test.setTimeout(90_000);
  const { schedule } = subject();
  const errors = await open(page);
  await seek(page, schedule.durationInFrames - 3 * schedule.fps);
  await page.evaluate(() => {
    const ref = window.__latencyPlayer! as unknown as { addEventListener(name: string, listener: () => void): void };
    (window as unknown as { __ended: boolean }).__ended = false;
    ref.addEventListener('ended', () => {
      (window as unknown as { __ended: boolean }).__ended = true;
    });
  });
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ended: boolean }).__ended), { timeout: 30_000 }).toBe(true);
  expect(await currentFrame(page)).toBe(schedule.durationInFrames - 1);
  await expect(controls(page).getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Catholic perspective and the synthetic-narration disclosure are visible in the episode', async ({ page }) => {
  test.setTimeout(240_000);
  const { schedule, script } = subject();
  const errors = await open(page);
  const scene = schedule.scenes.find((candidate) => candidate.id === script.perspective.scene);
  expect(scene, 'perspective.scene is a scene of the episode').toBeDefined();

  let perspective = false;
  for (let frame = scene!.from; frame < scene!.from + scene!.durationInFrames && !perspective; frame += Math.max(1, Math.floor(schedule.fps / 2))) {
    await seek(page, frame);
    perspective = await textVisible(page, script.perspective.statement, 'player');
  }
  expect(perspective, `"${script.perspective.statement}" is shown as text in scene ${scene!.id}`).toBe(true);

  let disclosure = await textVisible(page, script.disclosure.syntheticNarration, 'page');
  for (let frame = 0; frame < schedule.durationInFrames && !disclosure; frame += schedule.fps) {
    await seek(page, frame);
    disclosure = await textVisible(page, script.disclosure.syntheticNarration, 'page');
  }
  if (!disclosure) {
    await seek(page, schedule.durationInFrames - 1);
    disclosure = await textVisible(page, script.disclosure.syntheticNarration, 'page');
  }
  expect(disclosure, `"${script.disclosure.syntheticNarration}" is visible in the episode`).toBe(true);
  expect(errors).toEqual([]);
});

test('every media reveal shows its caption (provenance label)', async ({ page }) => {
  const { spec, schedule } = subject();
  const errors = await open(page);
  const reveals = spec.scenes.filter((scene) => scene.kind === 'mediaReveal');
  test.info().annotations.push({ type: 'media reveals', description: String(reveals.length) });
  for (const reveal of reveals) {
    const scheduled = schedule.scenes.find((candidate) => candidate.id === reveal.id)!;
    await seek(page, scheduled.from + Math.floor(scheduled.durationInFrames / 2));
    const caption = (reveal.payload as { caption?: string }).caption;
    expect(caption, `${reveal.id} has a caption`).toBeTruthy();
    expect(await textVisible(page, caption!, 'player'), `${reveal.id}: caption visible`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('the Pages artifact (dist/) contains each narration object at its content-addressed path', () => {
  const dist = join(ROOT, 'dist');
  expect(existsSync(join(dist, 'index.html')), 'run `bun run build` first (bun run verify does)').toBe(true);
  for (const lock of narrationLocks()) {
    const file = join(dist, 'assets', 'sha256', `${lock.sha256}.wav`);
    expect(existsSync(file), `${lock.id}: ${file}`).toBe(true);
    const bytes = readFileSync(file);
    expect({ sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }, lock.id).toEqual({ sha256: lock.sha256, byteLength: lock.byteLength });
  }
});
