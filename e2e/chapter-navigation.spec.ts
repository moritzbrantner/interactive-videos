// Independent acceptance for issue #68 (chapter jumps and related-segment navigation), authored
// before the implementation by a separate acceptance context. Contract and authority:
// docs/specs/chapter-navigation.md (Atlas 1.1, 1.2, 1.6, 1.8; AGENTS.md Player boundary).
//
// UI contract exercised here (details in the spec):
// - `nav` named "Chapters" outside the composition DOM; one native <button> per scene of the
//   validated timeline, in order, with `data-chapter-id="<scene id>"`,
//   `data-chapter-from="<resolveTimeline from>"`, an accessible name containing the scene's
//   headline, and `aria-current` (not "false") on exactly the chapter containing the current frame.
// - While the opening chapter is current: a visible `[data-related-segment]` control with
//   `data-chapter-target="close"` (role button or link) whose name contains the conclusion headline.
// - Jumps keep the play state, land on the target start frame, keep the composition and URL, and
//   render exactly the linear content of that frame (moenarchFrameState).
// - No chapter controls for single-scene projects (latency-explainer, catalog-title-card).
// Interactions go through visible controls only; `window.__latencyPlayer` (render-budget build) is
// used only to READ the current frame and play state.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { moenarchFrameState, planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { assertVideoSpec, resolveTimeline, type VideoSpec } from '../src/spec/video-spec.ts';

const PROJECT_ID = 'moenarch-narration';

function loadSpec(name: string): VideoSpec {
  return assertVideoSpec(JSON.parse(readFileSync(new URL(`../src/spec/fixtures/${name}.videospec.json`, import.meta.url), 'utf8')));
}

// Computed on first use, so each test reports its own failure.
let cached: { spec: VideoSpec; timeline: ReturnType<typeof resolveTimeline>; plan: ReturnType<typeof planMoenarchShort> } | null = null;
function subject() {
  if (!cached) {
    const spec = loadSpec(PROJECT_ID);
    cached = { spec, timeline: resolveTimeline(spec), plan: planMoenarchShort(spec) };
  }
  return cached;
}

/** The scene's headline: what a meaningful chapter name must contain. */
function headline(sceneId: string): string {
  const scene = subject().spec.scenes.find((candidate) => candidate.id === sceneId)!;
  const payload = scene.payload as { heading?: string; text?: string };
  const text = payload.heading ?? payload.text;
  if (!text) throw new Error(`scene ${sceneId} has no headline`);
  return text;
}

function chapterStart(sceneId: string): number {
  return subject().timeline.scenes.find((scene) => scene.id === sceneId)!.from;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const chapters = (page: Page) => page.getByRole('navigation', { name: 'Chapters' });
const chapter = (page: Page, id: string) => chapters(page).locator(`[data-chapter-id="${id}"]`);
const relatedToConclusion = (page: Page) => page.locator('[data-related-segment][data-chapter-target="close"]');
const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });
const playerFrame = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
const isPlaying = (page: Page) => page.evaluate(() => window.__latencyPlayer!.isPlaying());

async function paint(page: Page, frames = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, frames);
}

async function open(page: Page, projectId = PROJECT_ID) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.mouse.move(0, 0);
  await page.goto(`/?project=${projectId}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return errors;
}

async function expectPlayState(page: Page, playing: boolean) {
  await expect(controls(page).getByRole('button', { name: playing ? 'Pause video' : 'Play video', exact: true })).toBeVisible();
  expect(await isPlaying(page)).toBe(playing);
}

/** Paused exactly on `frame`, and it stays there. */
async function expectPausedAt(page: Page, frame: number) {
  await expect.poll(() => currentFrame(page), { message: `paused at frame ${frame}` }).toBe(frame);
  await expectPlayState(page, false);
  await paint(page, 6);
  expect(await currentFrame(page)).toBe(frame);
}

/** Playing from `from` (at or just after it, never before), and still advancing. */
async function expectPlayingFrom(page: Page, from: number) {
  await expect
    .poll(async () => {
      const frame = await currentFrame(page);
      return frame >= from && frame < from + 45;
    }, { message: `playing from frame ${from}` })
    .toBe(true);
  const samples: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    samples.push(await currentFrame(page));
    await page.waitForTimeout(100);
  }
  expect(samples.every((frame) => frame >= from), `frames ${samples.join(',')} stay at/after ${from}`).toBe(true);
  expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);
  await expectPlayState(page, true);
}

/** Ids of chapter controls marked current. */
async function currentChapters(page: Page) {
  return chapters(page).locator('[data-chapter-id]').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const value = element.getAttribute('aria-current');
        return value !== null && value !== 'false';
      })
      .map((element) => element.getAttribute('data-chapter-id')),
  );
}

async function expectCurrentChapter(page: Page, id: string) {
  await expect.poll(() => currentChapters(page), { message: `current chapter ${id}` }).toEqual([id]);
}

/** The composition's frame content, compared with the linear frame state of the same frame. */
async function expectLinearContentAt(page: Page, frame: number) {
  await paint(page);
  const state = moenarchFrameState(subject().plan, frame, { reducedMotion: false }) as {
    sceneIds: string[];
    subtitle: string | null;
    mark?: string | null;
  };
  const dom = await page.locator('[data-moenarch-root]').evaluate((root) => ({
    scenes: [...root.querySelectorAll('[data-moenarch-scene]')].map((element) => element.getAttribute('data-moenarch-scene')),
    subtitles: [...root.querySelectorAll('[data-moenarch-subtitle]')].map((element) => (element.textContent ?? '').trim()),
    marks: [...root.querySelectorAll('[data-moenarch-mark]')].map((element) => element.getAttribute('data-moenarch-mark')),
  }));
  expect(dom.scenes, `frame ${frame} scenes`).toEqual(state.sceneIds);
  expect(dom.subtitles, `frame ${frame} subtitle`).toEqual(state.subtitle === null ? [] : [state.subtitle]);
  expect(dom.marks, `frame ${frame} mark`).toEqual(state.mark ? [state.mark] : []);
}

/** Same composition, same project URL, same timeline length. */
async function expectSameComposition(page: Page) {
  await expect(page.locator('[data-composition-id]')).toHaveCount(1);
  await expect(playerFrame(page)).toHaveAttribute('data-duration-in-frames', String(subject().timeline.durationInFrames));
  expect(new URL(page.url()).searchParams.get('project')).toBe(PROJECT_ID);
}

/** Presses `key` until the focused element matches `selector`; proves keyboard reachability. */
async function focusByKeyboard(page: Page, selector: string, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  for (let i = 0; i < 80; i += 1) {
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${selector} is not reachable with ${key}`);
}

/** Same serialization as the narration determinism test. */
function serializeFrame(root: Element): string {
  const describe = (element: Element): string => {
    const attributes = [...element.attributes]
      .filter((attribute) => attribute.name !== 'style')
      .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort();
    const style = (element as HTMLElement).style;
    const declarations = style
      ? [...Array(style.length).keys()].map((index) => `${style[index]}:${style.getPropertyValue(style[index])}`).sort()
      : [];
    const children = [...element.childNodes].map((node) =>
      node.nodeType === Node.ELEMENT_NODE ? describe(node as Element) : JSON.stringify(node.textContent ?? ''),
    );
    return `<${element.tagName.toLowerCase()} ${attributes.join(' ')} style{${declarations.join(';')}}>${children.join('')}</>`;
  };
  return describe(root);
}

test('lists the scene timeline as named chapters outside the composition', async ({ page }) => {
  const { timeline } = subject();
  const errors = await open(page);
  const nav = chapters(page);
  await expect(nav).toBeVisible();

  const items = nav.locator('[data-chapter-id]');
  await expect(items).toHaveCount(timeline.scenes.length);
  const names = new Set<string>();
  for (const [index, scene] of timeline.scenes.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAttribute('data-chapter-id', scene.id);
    await expect(item).toHaveAttribute('data-chapter-from', String(scene.from));
    expect(await item.evaluate((element) => element.tagName), `${scene.id} is a native button`).toBe('BUTTON');
    await expect(item).toBeVisible();
    const name = new RegExp(escape(headline(scene.id)), 'i');
    await expect(item).toHaveAccessibleName(name);
    // Found by role and meaningful name, as a screen reader user would.
    await expect(nav.getByRole('button', { name })).toHaveCount(1);
    names.add((await item.evaluate((element) => element.getAttribute('aria-label') ?? element.textContent ?? '')).trim());
  }
  expect(names.size, 'chapter names are distinct').toBe(timeline.scenes.length);

  // Player-boundary UI: never part of the rendered composition frames.
  await expect(page.locator('[data-moenarch-root] [data-chapter-id], [data-moenarch-root] [data-related-segment]')).toHaveCount(0);
  await expect(page.locator('[data-moenarch-root]').getByRole('navigation', { name: 'Chapters' })).toHaveCount(0);

  await expectCurrentChapter(page, 'hook');
  await expectSameComposition(page);
  expect(errors).toEqual([]);
});

test('marks the current chapter while the video plays linearly', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  await expectCurrentChapter(page, 'hook');
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  const point = chapterStart('point');
  const close = chapterStart('close');
  await expect.poll(() => currentFrame(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(point + 10);
  expect(await currentFrame(page)).toBeLessThan(close);
  await expectCurrentChapter(page, 'point');
  await expect.poll(() => currentFrame(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(close + 10);
  await expectCurrentChapter(page, 'close');
  await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
  expect(errors).toEqual([]);
});

test('clicking a chapter while paused seeks to its start frame and stays paused', async ({ page }) => {
  const errors = await open(page);
  await expectPausedAt(page, 0);
  const target = chapterStart('point');

  await chapter(page, 'point').click();
  await expectPausedAt(page, target);
  await expectCurrentChapter(page, 'point');
  await expectSameComposition(page);
  await expectLinearContentAt(page, target);
  await expect(page.locator('[data-moenarch-root] [data-moenarch-scene="point"]')).toContainText(headline('point'));

  // Back to the opening, then forward again.
  await chapter(page, 'hook').click();
  await expectPausedAt(page, chapterStart('hook'));
  await expectCurrentChapter(page, 'hook');
  await chapter(page, 'close').click();
  await expectPausedAt(page, chapterStart('close'));
  await expectCurrentChapter(page, 'close');
  await expectLinearContentAt(page, chapterStart('close'));
  expect(errors).toEqual([]);
});

test('the opening offers a related-segment jump to the conclusion', async ({ page }) => {
  const errors = await open(page);
  await expectCurrentChapter(page, 'hook');
  const related = relatedToConclusion(page);
  await expect(related).toBeVisible();
  expect(await related.evaluate((element) => element.getAttribute('role') ?? element.tagName)).toMatch(/^(BUTTON|A|button|link)$/);
  await expect(related).toHaveAccessibleName(new RegExp(escape(headline('close')), 'i'));
  await expect(page.locator('[data-moenarch-root] [data-related-segment]')).toHaveCount(0);

  const url = page.url();
  await related.click();
  await expectPausedAt(page, chapterStart('close'));
  await expectCurrentChapter(page, 'close');
  await expectSameComposition(page);
  expect(page.url()).toBe(url);
  await expectLinearContentAt(page, chapterStart('close'));
  await expect(page.locator('[data-moenarch-root] [data-moenarch-scene="close"]')).toContainText(headline('close'));
  expect(errors).toEqual([]);
});

test('jumping while playing keeps playing from the chapter start', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => currentFrame(page)).toBeGreaterThan(5);

  await chapter(page, 'point').click();
  await expectPlayingFrom(page, chapterStart('point'));
  await expectCurrentChapter(page, 'point');
  await expectSameComposition(page);

  // Narration and subtitles follow the new position.
  await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
  await expectPlayState(page, false);
  const frame = await currentFrame(page);
  expect(frame).toBeGreaterThanOrEqual(chapterStart('point'));
  await expectLinearContentAt(page, frame);

  // Back to the opening while playing, then the related segment, still playing.
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await chapter(page, 'hook').click();
  await expectPlayingFrom(page, chapterStart('hook'));
  await expectCurrentChapter(page, 'hook');
  await relatedToConclusion(page).click();
  await expectPlayingFrom(page, chapterStart('close'));
  await expectCurrentChapter(page, 'close');
  await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
  const after = await currentFrame(page);
  await expectLinearContentAt(page, after);
  expect(errors).toEqual([]);
});

test('keyboard only: Tab, Enter and Space jump between chapters and segments', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  await page.locator('body').focus();

  // Enter on a focused chapter.
  await focusByKeyboard(page, '[data-chapter-id="point"]');
  await page.keyboard.press('Enter');
  await expectPausedAt(page, chapterStart('point'));
  await expectCurrentChapter(page, 'point');

  // Space on a focused chapter activates it and does not toggle playback (1.2).
  await focusByKeyboard(page, '[data-chapter-id="hook"]', 'Shift+Tab');
  await page.keyboard.press('Space');
  await expectPausedAt(page, chapterStart('hook'));
  await expectCurrentChapter(page, 'hook');

  // The related segment, by keyboard.
  await focusByKeyboard(page, '[data-related-segment][data-chapter-target="close"]');
  await page.keyboard.press('Enter');
  await expectPausedAt(page, chapterStart('close'));
  await expectCurrentChapter(page, 'close');

  // Space in the video still plays from the new position, and pauses again.
  await focusByKeyboard(page, '[role="region"][aria-label="Video player"]');
  await page.keyboard.press('Space');
  await expectPlayingFrom(page, chapterStart('close'));
  await page.keyboard.press('Space');
  await expectPlayState(page, false);

  // Seek backward again by keyboard.
  await focusByKeyboard(page, '[data-chapter-id="point"]');
  await page.keyboard.press('Enter');
  await expectPausedAt(page, chapterStart('point'));
  await expectCurrentChapter(page, 'point');
  await expectSameComposition(page);
  await expectLinearContentAt(page, chapterStart('point'));
  expect(errors).toEqual([]);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('touch: tapping chapters and the related segment seeks', async ({ page }) => {
    const errors = await open(page);
    await chapter(page, 'close').tap();
    await expectPausedAt(page, chapterStart('close'));
    await expectCurrentChapter(page, 'close');
    await chapter(page, 'hook').tap();
    await expectPausedAt(page, chapterStart('hook'));
    await relatedToConclusion(page).tap();
    await expectPausedAt(page, chapterStart('close'));
    await expectCurrentChapter(page, 'close');
    await expectSameComposition(page);
    expect(errors).toEqual([]);
  });
});

test('repeated and out-of-order jumps land on the same frames with the same content', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const firstVisit = new Map<string, string>();
  for (const id of ['close', 'hook', 'point', 'close', 'point', 'point', 'hook', 'close', 'hook']) {
    await chapter(page, id).click();
    const frame = chapterStart(id);
    await expectPausedAt(page, frame);
    await expectCurrentChapter(page, id);
    await expectLinearContentAt(page, frame);
    const dom = await page.locator('[data-moenarch-root]').evaluate(serializeFrame);
    if (firstVisit.has(id)) expect(dom, `${id} renders identically on every visit`).toBe(firstVisit.get(id));
    else firstVisit.set(id, dom);
  }
  // The related segment lands on the same conclusion frame as the chapter.
  await relatedToConclusion(page).click();
  await expectPausedAt(page, chapterStart('close'));
  expect(await page.locator('[data-moenarch-root]').evaluate(serializeFrame)).toBe(firstVisit.get('close'));
  await expectSameComposition(page);
  expect(errors).toEqual([]);
});

test('projects without meaningful chapters show no chapter controls', async ({ page }) => {
  for (const id of ['latency-explainer', 'catalog-title-card']) {
    expect(loadSpec(id).scenes, `${id} has a single scene`).toHaveLength(1);
  }
  // Positive control: the narration project has them, then switching away removes them.
  await open(page);
  await expect(chapters(page)).toBeVisible();
  const latencyTitle = loadSpec('latency-explainer').project.title;
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('link', { name: latencyTitle, exact: true }).click();
  await expect(page.locator('[data-composition-id="latency-explainer"]')).toBeVisible();
  const expectNone = async (where: string) => {
    await expect(page.getByRole('navigation', { name: 'Chapters' }), where).toHaveCount(0);
    await expect(page.locator('[data-chapter-id]'), where).toHaveCount(0);
    await expect(page.locator('[data-related-segment]'), where).toHaveCount(0);
  };
  await expectNone('after switching to latency-explainer');

  for (const id of ['latency-explainer', 'catalog-title-card']) {
    const errors = await open(page, id);
    await expect(page.locator(`[data-composition-id="${id}"]`)).toBeVisible();
    await expectNone(id);
    expect(errors).toEqual([]);
  }
});

