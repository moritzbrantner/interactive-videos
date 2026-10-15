// Review regression for PR #73: when playback ends the scene whose disclosure control holds
// keyboard focus, focus moves to the player region rather than falling back to the body.
import { expect, test } from '@playwright/test';

test('focus stays in the player when a focused timed disclosure expires', async ({ page }) => {
  await page.goto('/?project=interactive-showcase');
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  const region = page.locator('[data-composition-id="interactive-showcase"]');
  const fps = Number(await region.getAttribute('data-fps'));
  // Find the accordion scene, then focus its trigger while paused.
  const duration = Number(await region.getAttribute('data-duration-in-frames'));
  const trigger = region.locator('[data-showcase-trigger="accordion"]');
  let start = -1;
  for (let frame = 0; frame < duration; frame += Math.floor(fps / 2)) {
    await page.evaluate((f) => {
      window.__latencyPlayer!.pause();
      window.__latencyPlayer!.seekTo(f);
    }, frame);
    if (await trigger.isVisible()) {
      start = frame;
      break;
    }
  }
  expect(start).toBeGreaterThanOrEqual(0);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  // Play across the end of the scene.
  let end = start;
  while (await trigger.isVisible()) {
    end += fps;
    await page.evaluate((f) => window.__latencyPlayer!.seekTo(f), end);
  }
  await expect(trigger).toHaveCount(0);
  await expect(region).toBeFocused();
});
