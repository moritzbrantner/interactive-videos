// Acceptance for issue #84 (Nicaea I: German and Spanish subtitle tracks), written by an independent
// acceptance context before any implementation, against baseline c3b8eaa. Intent: Decision Atlas
// 3.10; #61 "Language acceptance". Data contract and seams:
// src/content/councils/council-nicaea-325-subtitles.test.ts (header). The English journey of #82
// stays in e2e/council-nicaea-325.spec.ts.
//
// Runs on the production build served by `vite preview` (playwright.config.ts), like every e2e spec.
//
// Player DOM contract (extends #82's; the shared language selection of #70 is not built here):
// - The toolbar's native <select> "Subtitles" offers exactly "Off", "English", "Deutsch",
//   "Español", in that order, for council-nicaea-325; "English" is selected when the project opens.
// - With a language selected, while a scheduled cue window contains the current frame, exactly one
//   visible `[data-subtitle-cue]` in `[data-composition-id="council-nicaea-325"]` shows the text of
//   that cue in the selected track: the English cue text, or the text of the cue with the same
//   (scene id, cue index) in src/content/councils/nicaea-325/subtitles/<lang>.json. The element or
//   an ancestor carries lang="en" / "de" / "es". The cue windows are the English ones for every
//   language. "Off" shows none.
// - Changing the track never seeks, pauses or restarts: paused, the frame stays exactly the same;
//   playing, the frame keeps advancing from where it was (monotonic, no jump back, no skip ahead).
// - Projects without translations offer only what they had: no other catalog project gets a
//   "Subtitles" select.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { narrationSchedule } from '../src/spec/narration-schedule.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PROJECT_ID = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT_ID}.videospec.json`);
const TRACK_DIR = join(ROOT, 'src', 'content', 'councils', 'nicaea-325', 'subtitles');

type Lang = 'en' | 'de' | 'es';
const LABELS: Record<Lang, string> = { en: 'English', de: 'Deutsch', es: 'Español' };

/** Catalog projects other than Nicaea I (baseline c3b8eaa); none offers subtitle tracks. */
const OTHER_PROJECTS = [
  'latency-explainer',
  'catalog-title-card',
  'moenarch-specimen',
  'moenarch-scene-gallery',
  'moenarch-narration',
  'moenarch-typography',
  'interactive-showcase',
  'moenarch-materialized-audio',
];

type TimedCue = { scene: string; index: number; from: number; durationInFrames: number; text: Record<Lang, string> };

let cached: { fps: number; durationInFrames: number; cues: TimedCue[] } | null = null;
/** English cue windows from the spec, with each track's text attached by (scene id, cue index). */
function subject() {
  if (!cached) {
    expect(existsSync(SPEC_PATH), `${PROJECT_ID} spec exists`).toBe(true);
    const spec = assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
    const schedule = narrationSchedule(spec);
    const tracks = {} as Record<'de' | 'es', Map<string, string>>;
    for (const lang of ['de', 'es'] as const) {
      const path = join(TRACK_DIR, `${lang}.json`);
      expect(existsSync(path), `src/content/councils/nicaea-325/subtitles/${lang}.json exists`).toBe(true);
      const data = JSON.parse(readFileSync(path, 'utf8')) as { cues: { scene: string; index: number; text: string }[] };
      tracks[lang] = new Map(data.cues.map((cue) => [`${cue.scene}#${cue.index}`, cue.text]));
    }
    const cues = schedule.scenes.flatMap((scene) =>
      scene.cues.map((cue, index) => {
        const key = `${scene.id}#${index}`;
        for (const lang of ['de', 'es'] as const) expect(tracks[lang].get(key), `${lang} has cue ${key}`).toBeTruthy();
        return {
          scene: scene.id,
          index,
          from: cue.from,
          durationInFrames: cue.durationInFrames,
          text: { en: squash(cue.text), de: squash(tracks.de.get(key)!), es: squash(tracks.es.get(key)!) },
        };
      }),
    );
    cached = { fps: schedule.fps, durationInFrames: schedule.durationInFrames, cues };
  }
  return cached;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const cueAt = (frame: number) => subject().cues.find((cue) => frame >= cue.from && frame < cue.from + cue.durationInFrames) ?? null;
/** The texts a track may show at `frame`, allowing one frame of sampling skew. */
const expectedNear = (lang: Lang, frame: number) =>
  [frame - 1, frame, frame + 1].map(cueAt).filter((cue): cue is TimedCue => cue !== null).map((cue) => cue.text[lang]);

const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });
const subtitleSelect = (page: Page) => controls(page).getByRole('combobox', { name: 'Subtitles' });
const player = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);

async function open(page: Page, project = PROJECT_ID) {
  if (project === PROJECT_ID) subject(); // fail fast, with the data diagnostic, before waiting on the Player
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?project=${project}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (project === PROJECT_ID) {
    // Every journey below needs the three tracks; say so before trying to select one.
    await expect(subtitleSelect(page).locator('option'), 'the Subtitles select offers the three tracks').toHaveText(['Off', 'English', 'Deutsch', 'Español']);
  }
  return errors;
}

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
const isPlaying = (page: Page) => page.evaluate(() => window.__latencyPlayer!.isPlaying());

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

/**
 * Waits until the shown subtitle is in `lang` and is the cue of that track at the current frame.
 * Returns the frames sampled while waiting, so callers can check playback stayed monotonic.
 */
async function expectTrackShown(page: Page, lang: Lang, timeout = 10_000) {
  const frames: number[] = [];
  let last = '';
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await subtitleState(page);
    frames.push(state.frame);
    const expected = expectedNear(lang, state.frame);
    if (expected.length > 0 && state.cues.length === 1) {
      const [shown] = state.cues;
      if ((shown.lang ?? '').match(new RegExp(`^${lang}\\b`)) && expected.includes(shown.text)) return frames;
    }
    last = `frame ${state.frame}: shown ${JSON.stringify(state.cues)}, expected ${lang} ${JSON.stringify(expected)}`;
    await page.waitForTimeout(100);
  }
  throw new Error(`the ${LABELS[lang]} track is not shown in sync: ${last}`);
}

const nondecreasing = (frames: number[]) => frames.every((frame, index) => index === 0 || frame >= frames[index - 1]);

test('the Subtitles select offers Off, English, Deutsch and Español, with English on at open', async ({ page }) => {
  const errors = await open(page);
  await expect(subtitleSelect(page).locator('option')).toHaveText(['Off', 'English', 'Deutsch', 'Español']);
  await expect(subtitleSelect(page).locator('option:checked')).toHaveText('English');
  expect(errors).toEqual([]);
});

test('paused after a seek: each track shows its own cue text with its lang, and the frame never moves', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const { cues } = subject();
  // Three cues spread over the episode, sought out of order.
  for (const cue of [cues[Math.floor(cues.length * 0.6)], cues[Math.floor(cues.length * 0.2)], cues[Math.floor(cues.length * 0.85)]]) {
    const frame = cue.from + Math.floor(cue.durationInFrames / 2);
    await seek(page, frame);
    for (const lang of ['de', 'es', 'en', 'es', 'de'] as const) {
      await subtitleSelect(page).selectOption({ label: LABELS[lang] });
      await expect
        .poll(async () => (await subtitleState(page)).cues, { message: `${cue.scene}#${cue.index} in ${lang}` })
        .toEqual([{ text: cue.text[lang], lang: expect.stringMatching(new RegExp(`^${lang}\\b`)) }]);
      expect(await currentFrame(page), `switching to ${lang} keeps the frame`).toBe(frame);
      expect(await isPlaying(page), `switching to ${lang} does not start playback`).toBe(false);
    }
    // The translations really differ from the English text at this cue.
    expect(cue.text.de).not.toBe(cue.text.en);
    expect(cue.text.es).not.toBe(cue.text.en);
  }
  // Off hides the subtitle; the frame stays.
  const frame = await currentFrame(page);
  await subtitleSelect(page).selectOption({ label: 'Off' });
  await expect.poll(async () => (await subtitleState(page)).cues).toEqual([]);
  expect(await currentFrame(page)).toBe(frame);
  expect(errors).toEqual([]);
});

test('while playing: English → Deutsch → Español keeps playing from the same point, then a seek, then back to English and Off', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await open(page);
  const { cues, fps } = subject();
  const start = cues[Math.floor(cues.length / 3)];
  await seek(page, start.from + 1);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(controls(page).getByRole('button', { name: 'Pause video', exact: true })).toBeVisible();
  await expect.poll(() => currentFrame(page)).toBeGreaterThan(start.from + Math.floor(fps / 2));
  await expectTrackShown(page, 'en');

  const switchWhilePlaying = async (lang: Lang) => {
    const before = await currentFrame(page);
    await subtitleSelect(page).selectOption({ label: LABELS[lang] });
    const after = await currentFrame(page);
    expect(after, `switching to ${lang} does not rewind or reset`).toBeGreaterThanOrEqual(before);
    expect(after - before, `switching to ${lang} does not skip ahead`).toBeLessThanOrEqual(2 * fps);
    expect(await isPlaying(page), `still playing after switching to ${lang}`).toBe(true);
    const frames = await expectTrackShown(page, lang);
    expect(nondecreasing([before, after, ...frames]), `frames while showing ${lang}: ${[before, after, ...frames].join(', ')}`).toBe(true);
    await expect.poll(() => currentFrame(page), { message: `playback continues in ${lang}` }).toBeGreaterThan(frames.at(-1)!);
  };

  await switchWhilePlaying('de');
  // Keep watching German across a cue change: the next cue is German too.
  const firstGerman = cueAt(await currentFrame(page));
  await expect.poll(async () => cueAt(await currentFrame(page))?.from ?? -1, { timeout: 20_000 }).not.toBe(firstGerman?.from ?? -1);
  await expectTrackShown(page, 'de');
  await switchWhilePlaying('es');

  // Seek back while playing: the Spanish track follows the new position.
  const earlier = cues[Math.floor(cues.length / 6)];
  await page.evaluate((frame) => window.__latencyPlayer!.seekTo(frame), earlier.from + 1);
  expect(await currentFrame(page)).toBeLessThan(start.from);
  expect(await isPlaying(page), 'playback continues after the seek').toBe(true);
  await expectTrackShown(page, 'es');
  // After the seek, switch to German and back to English, still playing.
  await switchWhilePlaying('de');
  await switchWhilePlaying('en');

  // Off hides cues without touching playback.
  const before = await currentFrame(page);
  await subtitleSelect(page).selectOption({ label: 'Off' });
  expect(await currentFrame(page)).toBeGreaterThanOrEqual(before);
  expect(await isPlaying(page)).toBe(true);
  for (let sample = 0; sample < 6; sample += 1) {
    expect((await subtitleState(page)).cues, 'no subtitle with Off').toEqual([]);
    await page.waitForTimeout(250);
  }
  expect(errors).toEqual([]);
});

test('the select works by keyboard and keeps the frame', async ({ page }) => {
  const errors = await open(page);
  const cue = subject().cues[Math.floor(subject().cues.length / 2)];
  const frame = cue.from + Math.floor(cue.durationInFrames / 2);
  await seek(page, frame);
  const select = subtitleSelect(page);
  await select.focus();
  await page.keyboard.press('ArrowDown'); // English → Deutsch
  await expect(select.locator('option:checked')).toHaveText('Deutsch');
  await expect.poll(async () => (await subtitleState(page)).cues).toEqual([{ text: cue.text.de, lang: expect.stringMatching(/^de\b/) }]);
  await page.keyboard.press('ArrowDown'); // Deutsch → Español
  await expect(select.locator('option:checked')).toHaveText('Español');
  await expect.poll(async () => (await subtitleState(page)).cues).toEqual([{ text: cue.text.es, lang: expect.stringMatching(/^es\b/) }]);
  expect(await currentFrame(page)).toBe(frame);
  expect(errors).toEqual([]);
});

test('projects without translations offer only the tracks they have (none)', async ({ page }) => {
  for (const id of OTHER_PROJECTS) {
    const errors = await open(page, id);
    await expect(page.locator(`[data-composition-id="${id}"]`)).toBeVisible();
    await expect(controls(page).getByRole('combobox', { name: 'Subtitles' }), `${id} has no Subtitles select`).toHaveCount(0);
    expect(errors, id).toEqual([]);
    page.removeAllListeners('pageerror');
  }
});
