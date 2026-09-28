import { expect, test, type Page } from '@playwright/test';
import { expectRenderBudget, getRenderStats, resetRenderStats } from 'react-render-budget/playwright';

import { barRevealEnd, barRevealProgress } from '../src/video/reveal.ts';

const BAR_COUNT = 48;
const STEPPED_FRAMES = 30;
// Bars reveal with a stagger; this window is in the middle of the reveal.
const REVEAL_WINDOW_START = 40;
// All bars have finished revealing (and become clickable) by this frame.
const STEADY_START = barRevealEnd(BAR_COUNT - 1) + 8;

// A mark re-renders exactly when its reveal progress changes between consecutive frames.
function expectedMarkRenders(first: number, last: number) {
  let renders = 0;
  for (let frame = first; frame <= last; frame += 1) {
    for (let index = 0; index < BAR_COUNT; index += 1) {
      if (barRevealProgress(index, frame) !== barRevealProgress(index, frame - 1)) renders += 1;
    }
  }
  return renders;
}

async function openPausedAt(page: Page, frame: number) {
  await page.goto('/');
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await seekFrames(page, frame, frame);
}

// Seeks one frame at a time and waits for each to paint, so every frame is actually rendered.
async function seekFrames(page: Page, from: number, to: number) {
  await page.evaluate(
    async ([first, last]) => {
      const player = window.__latencyPlayer!;
      player.pause();
      const painted = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      for (let frame = first; frame <= last; frame += 1) {
        player.seekTo(frame);
        await painted();
      }
    },
    [from, to],
  );
}

// Budgets are upper bounds, so a count of zero would pass them vacuously. Exact counts are
// asserted as well; a target that never rendered in the window reports undefined, meaning 0.
async function renderCounts(page: Page) {
  const { components } = await getRenderStats(page);
  const count = (name: string) => components[name] ?? 0;
  return {
    LatencyVideo: count('LatencyVideo'),
    ChartChrome: count('ChartChrome'),
    Bars: count('Bars'),
    BarMark: count('BarMark'),
  };
}

test('during the reveal, only marks whose progress changes re-render', async ({ page }) => {
  await openPausedAt(page, REVEAL_WINDOW_START);
  await resetRenderStats(page);

  const last = REVEAL_WINDOW_START + STEPPED_FRAMES;
  await seekFrames(page, REVEAL_WINDOW_START + 1, last);

  const markRenders = expectedMarkRenders(REVEAL_WINDOW_START + 1, last);
  // Guard against a vacuous window: the reveal must actually be animating here.
  expect(markRenders).toBeGreaterThan(BAR_COUNT * 5);
  expect(markRenders).toBeLessThan(BAR_COUNT * STEPPED_FRAMES);

  expect(await renderCounts(page)).toEqual({
    // The Player re-renders the composition root on every frame; that is what makes
    // memoizing the frame-independent parts below it necessary.
    LatencyVideo: STEPPED_FRAMES,
    // Frame-independent parts must not re-render while the video plays.
    ChartChrome: 0,
    Bars: 0,
    BarMark: markRenders,
  });
  await expectRenderBudget(page, {
    components: { LatencyVideo: STEPPED_FRAMES, ChartChrome: 0, Bars: 0, BarMark: markRenders },
  });
});

test('after the reveal, frames re-render no chart marks', async ({ page }) => {
  await openPausedAt(page, STEADY_START);
  await resetRenderStats(page);

  await seekFrames(page, STEADY_START + 1, STEADY_START + STEPPED_FRAMES);

  expect(await renderCounts(page)).toEqual({
    LatencyVideo: STEPPED_FRAMES,
    ChartChrome: 0,
    Bars: 0,
    BarMark: 0,
  });
});

test('selecting a bar leaves the chart untouched', async ({ page }) => {
  await openPausedAt(page, STEADY_START);
  await resetRenderStats(page);

  await page.locator('g[data-hotspot="bin-29"][role="button"]').click();
  await expect(page.locator('.insight h2')).toHaveText('14:30–15:00');
  await expect(page.locator('g[data-hotspot="bin-29"]')).toHaveAttribute('aria-pressed', 'true');

  expect(await renderCounts(page)).toEqual({
    // The new selectedId arrives through inputProps once.
    LatencyVideo: 1,
    ChartChrome: 0,
    Bars: 0,
    // Selection reaches the hotspots through context; the marks themselves do not re-render.
    BarMark: 0,
  });
});
