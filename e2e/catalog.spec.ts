// Acceptance for issue #11 (composition catalog), written before the implementation.
// Projects are addressed by URL state `?project=<id>`. Two fixture projects must coexist:
// the latency explainer (src/spec/fixtures/latency-explainer.videospec.json) and a portrait
// title card (src/spec/fixtures/catalog-title-card.videospec.json, format `title-card` v1).
// Player dimensions, FPS and duration come from each project's resolved spec.
import { expect, test, type Page } from '@playwright/test';

// The element wrapping the Player carries the resolved composition's metadata as
// data-composition-id, data-width, data-height, data-fps and data-duration-in-frames, and is sized
// to the composition's aspect ratio.
async function playerAspect(page: Page) {
  const box = await page.locator('[data-composition-id]').boundingBox();
  if (!box) throw new Error('no player box');
  return box.width / box.height;
}

test('the latency explainer is an explicit catalog entry', async ({ page }) => {
  await page.goto('/?project=latency-explainer');
  await expect(page.getByRole('heading', { level: 1, name: 'Latency explainer' })).toBeVisible();
  await expect(page).toHaveTitle(/Latency explainer/);
  await expect.poll(() => playerAspect(page)).toBeCloseTo(1280 / 720, 1);
  const player = page.locator('[data-composition-id="latency-explainer"]');
  await expect(player).toHaveAttribute('data-width', '1280');
  await expect(player).toHaveAttribute('data-height', '720');
  await expect(player).toHaveAttribute('data-fps', '30');
});

test('a second project opens by URL and uses its own output profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?project=catalog-title-card');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog title card' })).toBeVisible();
  await expect(page).toHaveTitle(/Catalog title card/);
  // Portrait 1080x1920 from the spec, not the explainer's 1280x720 constant.
  await expect.poll(() => playerAspect(page)).toBeCloseTo(1080 / 1920, 1);
  // The resolved composition reports the spec's fps and duration (96 frames at 24 fps).
  const player = page.locator('[data-composition-id="catalog-title-card"]');
  await expect(player).toHaveAttribute('data-width', '1080');
  await expect(player).toHaveAttribute('data-height', '1920');
  await expect(player).toHaveAttribute('data-fps', '24');
  await expect(player).toHaveAttribute('data-duration-in-frames', '96');
  // The title scene's heading is rendered by the composition.
  await expect(page.getByText('A second video in the catalog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reloading a project URL restores the same project', async ({ page }) => {
  await page.goto('/?project=catalog-title-card');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog title card' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog title card' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe('catalog-title-card');
});

test('the catalog lists every project and switching updates the URL', async ({ page }) => {
  await page.goto('/?project=latency-explainer');
  const catalog = page.getByRole('navigation', { name: /projects/i });
  await expect(catalog.getByRole('link', { name: 'Latency explainer' })).toBeVisible();
  await catalog.getByRole('link', { name: 'Catalog title card' }).click();
  await expect(page).toHaveURL(/[?&]project=catalog-title-card(&|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog title card' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Latency explainer' })).toBeVisible();
});

test('an unknown project fails visibly instead of selecting another video', async ({ page }) => {
  await page.goto('/?project=does-not-exist');
  await expect(page.getByRole('alert')).toContainText('does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: 'Latency explainer' })).toHaveCount(0);
  await expect(page.locator('[data-composition-id]')).toHaveCount(0);
});
