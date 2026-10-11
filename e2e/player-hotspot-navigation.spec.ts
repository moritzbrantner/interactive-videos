import { expect, test, type Page } from '@playwright/test';

import { barRevealEnd } from '../src/video/reveal';

const ALL_BARS_READY = barRevealEnd(47) + 8;

async function openAtInspectableFrame(page: Page, debug = false) {
  await page.goto(debug ? '/?project=latency-explainer&debug=hotspots' : '/?project=latency-explainer');
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate((frame) => {
    window.__latencyPlayer!.pause();
    window.__latencyPlayer!.seekTo(frame);
  }, ALL_BARS_READY);
  await expect(page.locator('g[data-hotspot="bin-0"][role="button"]')).toBeVisible();
}

test('playback has a dedicated pause control independent of the Player transport overlay', async ({ page }) => {
  await page.goto('/?project=latency-explainer');
  const play = page.locator('.player-toolbar').getByRole('button', { name: 'Play video' });
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.locator('.player-toolbar').getByRole('button', { name: 'Pause video' })).toBeVisible();
  await page.locator('.player-toolbar').getByRole('button', { name: 'Pause video' }).click();
  await expect(play).toBeVisible();
});

test('keyboard focus freezes playback; Tab, Shift+Tab and Enter traverse and inspect SVG hotspots', async ({ page }) => {
  await openAtInspectableFrame(page);

  await page.getByRole('button', { name: 'Focus first clickable' }).click();
  const first = page.locator('g[data-hotspot="bin-0"][role="button"]');
  const second = page.locator('g[data-hotspot="bin-1"][role="button"]');
  await expect(first).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(second).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(first).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.insight')).toContainText('Slowest requests');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.player-toolbar').getByRole('button', { name: 'Pause video' })).toBeVisible();

  // Keyboard focus itself pauses playback, even without activating a hotspot.
  await second.focus();
  await expect(page.locator('.player-toolbar').getByRole('button', { name: 'Play video' })).toBeVisible();
});

test('developer mode highlights only active hitboxes and shows the same accessible hotspot labels', async ({ page }) => {
  await openAtInspectableFrame(page, true);

  const inspector = page.getByRole('region', { name: 'Developer hotspot inspector' });
  await expect(inspector).toContainText('clickable elements at this frame');
  await expect(page.locator('[data-debug-hotspot="bin-29"]')).toHaveCount(1);

  const actual = await page.locator('g[data-hotspot="bin-29"][role="button"]').boundingBox();
  const highlight = await page.locator('[data-debug-hotspot="bin-29"]').boundingBox();
  expect(actual).not.toBeNull();
  expect(highlight).not.toBeNull();
  expect(highlight!.x).toBeCloseTo(actual!.x, 0);
  expect(highlight!.y).toBeCloseTo(actual!.y, 0);
  expect(highlight!.width).toBeCloseTo(actual!.width, 0);
  expect(highlight!.height).toBeCloseTo(actual!.height, 0);

  await inspector.getByRole('button', { name: /14:30 to 15:00/ }).click();
  await expect(page.locator('g[data-hotspot="bin-29"]')).toBeFocused();
  await expect(page.locator('[data-debug-hotspot="bin-29"]')).toHaveAttribute('data-selected', 'true');

  await page.getByLabel('Developer mode').uncheck();
  await expect(inspector).toHaveCount(0);
  await expect(page).not.toHaveURL(/debug=hotspots/);
  await page.getByLabel('Developer mode').check();
  await page.reload();
  await expect(page.getByLabel('Developer mode')).toBeChecked();
});

test('non-interactive projects show no fake clickable regions', async ({ page }) => {
  await page.goto('/?project=catalog-title-card&debug=hotspots');
  const inspector = page.getByRole('region', { name: 'Developer hotspot inspector' });
  await expect(inspector).toContainText('0 clickable elements');
  await expect(page.locator('.hotspot-debug-bounds')).toHaveCount(0);
});

test('subtitle terms are keyboard-operable and developer mode ignores inert future bars', async ({ page }) => {
  await page.goto('/?project=latency-explainer&debug=hotspots');
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate(() => {
    window.__latencyPlayer!.pause();
    window.__latencyPlayer!.seekTo(0);
  });
  await expect(page.locator('g[data-hotspot="bin-0"]')).toHaveCount(1);
  await expect(page.locator('[data-debug-hotspot="bin-0"]')).toHaveCount(0);

  // The second narration cue contains an interactive HTML word.
  await page.evaluate(() => window.__latencyPlayer!.seekTo(165));
  const word = page.locator('button[data-hotspot="term:p95"]');
  await expect(word).toBeVisible();
  await expect(page.locator('[data-debug-hotspot="term:p95"]')).toHaveCount(1);
  await word.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.insight h2')).toHaveText('p95 latency');
  await expect(word).toHaveAttribute('aria-pressed', 'true');
});
