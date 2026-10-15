// Independent acceptance for issue #60, authored before the implementation by a separate
// acceptance context. Authority: docs/DECISION-ATLAS.md at main 2be420b — Decisions 1.1, 1.3,
// 1.4, 1.6 (Answers 1.5, option C), 2.1, 2.2 — and AGENTS.md (Player boundary, browser vs render).
//
// Minimal contract the implementation must satisfy (routine details fixed by this spec):
// - Catalog: a real project with id `interactive-showcase` and title "Interactive showcase"
//   (catalog link name and level-1 heading), opened by `?project=interactive-showcase`. It renders
//   in the real Player inside `[data-composition-id="interactive-showcase"]` with the usual
//   data-width/-height/-fps/-duration-in-frames attributes.
// - Playback is observed through the real Player handle the render-budget build already exposes
//   as `window.__latencyPlayer` (exposePlayerForBudgetTests, set for whichever project is open),
//   and through the existing "Video controls" toolbar Play/Pause button.
// - Four affordances, each rendered INSIDE the Player frame `[data-composition-id]` and tied to
//   concrete information shown in the video. Each trigger carries `data-showcase-trigger="<kind>"`,
//   exists (visible) only while it is interactive, and once it appears stays interactive for at
//   least 4 seconds of video time:
//   * `preview`  — a focusable hotspot with an accessible name. While hovered or keyboard-focused it
//                  has `data-previewing="true"` (otherwise absent or "false") and a visible
//                  `[data-showcase-preview]` element shows non-empty preview information. A touch
//                  tap must make the same preview information visible. Hover and focus never pause.
//   * `popover`  — a button (native or role=button) with an accessible name and `aria-expanded`.
//                  It toggles a visible, non-modal `[data-showcase-popover]` anchored content
//                  (not `aria-modal="true"`). Escape closes it and focus returns to the trigger.
//                  Opening/closing never pauses or resumes playback.
//   * `accordion`— a button with an accessible name and `aria-expanded` that expands/collapses a
//                  `[data-showcase-accordion-panel]` region. Never pauses or resumes playback.
//   * `dialog`   — a button with an accessible name that opens a full modal: role `dialog`, an
//                  accessible name, modal (aria-modal="true" or native showModal), focus moves
//                  inside and Tab stays inside. Opening pauses at the current frame. Escape or its
//                  close button (accessible name matching /close/i) dismisses it, returns focus to
//                  the trigger and keeps the paused frame; the viewer resumes explicitly.
// - Disclosure contents are non-empty and differ from the trigger's own label. Whether they are
//   "real contextual content" is additionally reviewed by a human (see PR).
// - The latency explainer's click-to-inspect pause stays covered by
//   e2e/player-hotspot-navigation.spec.ts; headless render by `bun run test:render`.
import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT_ID = 'interactive-showcase';
const TITLE = 'Interactive showcase';

type Kind = 'preview' | 'popover' | 'accordion' | 'dialog';

const frameRegion = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);
const trigger = (page: Page, kind: Kind) => frameRegion(page).locator(`[data-showcase-trigger="${kind}"]`);
const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });

async function paint(page: Page, frames = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, frames);
}

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
const isPlaying = (page: Page) => page.evaluate(() => window.__latencyPlayer!.isPlaying());

async function expectPlaying(page: Page, playing: boolean) {
  await expect(controls(page).getByRole('button', { name: playing ? 'Pause video' : 'Play video', exact: true }))
    .toBeVisible();
  expect(await isPlaying(page)).toBe(playing);
}

/** Playback is active and the frame keeps advancing past `since`. */
async function expectAdvancing(page: Page, since?: number) {
  const from = since ?? await currentFrame(page);
  await expect.poll(() => currentFrame(page), { timeout: 5_000 }).toBeGreaterThan(from);
  expect(await isPlaying(page)).toBe(true);
}

/** Paused and the frame does not move across several painted frames. */
async function expectFrozen(page: Page) {
  await expectPlaying(page, false);
  const frame = await currentFrame(page);
  await paint(page, 6);
  expect(await currentFrame(page)).toBe(frame);
  return frame;
}

async function openShowcase(page: Page) {
  await page.goto(`/?project=${PROJECT_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
}

/**
 * Seek (paused) to the first frame where the affordance is available. Scanning keeps the spec
 * independent of the implementation's timeline while requiring a real in-video moment.
 */
async function seekToAffordance(page: Page, kind: Kind) {
  const duration = Number(await frameRegion(page).getAttribute('data-duration-in-frames'));
  const fps = Number(await frameRegion(page).getAttribute('data-fps'));
  expect(duration).toBeGreaterThan(0);
  const step = Math.max(1, Math.floor(fps / 2));
  for (let frame = 0; frame < duration; frame += step) {
    await page.evaluate((f) => {
      window.__latencyPlayer!.pause();
      window.__latencyPlayer!.seekTo(f);
    }, frame);
    await paint(page, 2);
    if (await trigger(page, kind).isVisible()) {
      // Enough video must remain to observe playback continuing after the interaction.
      expect(duration - frame, `${kind} needs at least 4 s of remaining video`).toBeGreaterThanOrEqual(4 * fps);
      return frame;
    }
  }
  throw new Error(`no frame of ${PROJECT_ID} offers the "${kind}" affordance`);
}

async function playFrom(page: Page, kind: Kind) {
  await seekToAffordance(page, kind);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expectAdvancing(page);
  await expect(trigger(page, kind)).toBeVisible();
}

async function tabTo(page: Page, target: Locator) {
  await frameRegion(page).focus();
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target is not reachable with Tab from the video player');
}

async function nonEmptyDistinctText(content: Locator, triggerLocator: Locator) {
  const text = (await content.innerText()).trim();
  expect(text.length, 'disclosure shows real content').toBeGreaterThan(0);
  const label = (await triggerLocator.innerText()).trim();
  expect(text, 'disclosure content is more than its trigger label').not.toBe(label);
  return text;
}

test.describe('catalog and route', () => {
  test('the catalog lists the showcase and the route loads a real video in the Player', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?project=latency-explainer');
    const catalog = page.getByRole('navigation', { name: /projects/i });
    await catalog.getByRole('link', { name: TITLE, exact: true }).click();
    await expect(page).toHaveURL(/[?&]project=interactive-showcase(&|$)/);
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(TITLE));
    const region = frameRegion(page);
    await expect(region).toBeVisible();
    for (const attribute of ['data-width', 'data-height', 'data-fps', 'data-duration-in-frames']) {
      expect(Number(await region.getAttribute(attribute)), attribute).toBeGreaterThan(0);
    }
    await page.waitForFunction(() => window.__latencyPlayer !== undefined);
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, 0);
    // All four disclosure patterns exist in this one video (Atlas 1.4, 2.1).
    for (const kind of ['preview', 'popover', 'accordion', 'dialog'] as const) {
      await seekToAffordance(page, kind);
      await expect(trigger(page, kind)).toHaveAccessibleName(/\S/);
    }
    expect(errors).toEqual([]);
  });

  test('watching straight through needs no interaction and nothing opens by itself', async ({ page }) => {
    await openShowcase(page);
    const start = await seekToAffordance(page, 'dialog');
    await page.evaluate(() => window.__latencyPlayer!.seekTo(0));
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    // Play through every affordance moment up to the dialog's; nothing pauses or pops up.
    const fastForward = Math.max(0, start - 30);
    await page.evaluate((f) => window.__latencyPlayer!.seekTo(f), fastForward);
    await expectAdvancing(page, start);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-showcase-popover]')).toBeHidden();
    await expectPlaying(page, true);
  });
});

test.describe('hover preview (Atlas 1.3)', () => {
  test('pointer hover emphasizes and previews while playback keeps advancing', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'preview');
    const hotspot = trigger(page, 'preview');
    await expect(hotspot).toHaveAccessibleName(/\S/);
    const before = await currentFrame(page);
    await hotspot.hover();
    await expect(hotspot).toHaveAttribute('data-previewing', 'true');
    const preview = page.locator('[data-showcase-preview]');
    await expect(preview).toBeVisible();
    await nonEmptyDistinctText(preview, hotspot);
    await expectAdvancing(page, before);

    // Leaving ends the preview without pausing or seeking.
    await page.mouse.move(0, 0);
    await expect(hotspot).not.toHaveAttribute('data-previewing', 'true');
    await expectAdvancing(page);
  });

  test('keyboard focus shows the same preview without pausing', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'preview');
    const hotspot = trigger(page, 'preview');
    await page.mouse.move(0, 0);
    await tabTo(page, hotspot);
    await expect(hotspot).toHaveAttribute('data-previewing', 'true');
    await expect(page.locator('[data-showcase-preview]')).toBeVisible();
    // Unlike the latency explainer's focus-freeze, Atlas 1.6 keeps that pause-to-inspect behavior
    // to its own selection affordance; showcase preview focus must not pause.
    await expectAdvancing(page);
  });
});

test.describe('non-modal popover and accordion (Atlas 1.4, 1.6)', () => {
  test('pointer: opening and closing the popover neither pauses nor resumes', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'popover');
    const button = trigger(page, 'popover');
    await expect(button).toHaveAccessibleName(/\S/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const popover = page.locator('[data-showcase-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).not.toHaveAttribute('aria-modal', 'true');
    await nonEmptyDistinctText(popover, button);
    await expectAdvancing(page);
    await button.click();
    await expect(popover).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expectAdvancing(page);

    // While paused, the same operations must not resume.
    await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
    const paused = await expectFrozen(page);
    await button.click();
    await expect(popover).toBeVisible();
    expect(await expectFrozen(page)).toBe(paused);
    await button.click();
    await expect(popover).toBeHidden();
    expect(await expectFrozen(page)).toBe(paused);
  });

  test('keyboard: Space/Enter toggle the popover, Escape closes it and returns focus, transport stays usable', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'popover');
    const button = trigger(page, 'popover');
    const popover = page.locator('[data-showcase-popover]');
    await tabTo(page, button);
    await expectAdvancing(page);

    // Space on a focused control is owned by that control, not the playback shortcut (Atlas 1.2).
    await page.keyboard.press('Space');
    await expect(popover).toBeVisible();
    await expectAdvancing(page);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(button).toBeFocused();
    await expectAdvancing(page);
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await expectAdvancing(page);

    // A non-modal popover does not capture the transport: the toolbar still pauses and plays.
    await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
    await expectFrozen(page);
    await expect(popover).toBeVisible();
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page);
  });

  test('pointer and keyboard: expanding and collapsing the accordion neither pauses nor resumes', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'accordion');
    const button = trigger(page, 'accordion');
    const panel = page.locator('[data-showcase-accordion-panel]');
    await expect(button).toHaveAccessibleName(/\S/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await nonEmptyDistinctText(panel, button);
    await expectAdvancing(page);
    await button.click();
    await expect(panel).toBeHidden();
    await expectAdvancing(page);

    await tabTo(page, button);
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expectAdvancing(page);
    await page.keyboard.press('Space');
    await expect(panel).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expectAdvancing(page);

    await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
    const paused = await expectFrozen(page);
    await button.click();
    await expect(panel).toBeVisible();
    expect(await expectFrozen(page)).toBe(paused);
  });
});

test.describe('full modal dialog (Atlas 1.4, 1.6)', () => {
  async function openDialogWhilePlaying(page: Page, via: 'pointer' | 'keyboard') {
    await openShowcase(page);
    await playFrom(page, 'dialog');
    const button = trigger(page, 'dialog');
    await expect(button).toHaveAccessibleName(/\S/);
    if (via === 'keyboard') await tabTo(page, button);
    const before = await currentFrame(page);
    if (via === 'keyboard') await page.keyboard.press('Enter');
    else await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/\S/);
    await nonEmptyDistinctText(dialog, button);
    // Paused at the current position, not reset or jumped.
    const paused = await expectFrozen(page);
    expect(paused).toBeGreaterThanOrEqual(before);
    const fps = Number(await frameRegion(page).getAttribute('data-fps'));
    expect(paused - before).toBeLessThanOrEqual(fps);
    // Modal: focus is inside and Tab cannot leave it.
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), 'focus stays in the modal').toBe(true);
    }
    return { button, dialog, paused };
  }

  test('pointer: opening pauses at the current frame; the close button returns focus and preserves the frame', async ({ page }) => {
    const { button, dialog, paused } = await openDialogWhilePlaying(page, 'pointer');
    await dialog.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(await expectFrozen(page)).toBe(paused);
    // Explicit resume continues from the preserved position.
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, paused);
  });

  test('keyboard: Escape dismisses, returns focus to the trigger, preserves the frame; Space resumes', async ({ page }) => {
    const { button, paused } = await openDialogWhilePlaying(page, 'keyboard');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(await expectFrozen(page)).toBe(paused);
    // Dismissal itself never resumes; the viewer resumes deliberately from the video context.
    await frameRegion(page).focus();
    await page.keyboard.press('Space');
    await expectAdvancing(page, paused);
  });
});

test.describe('touch-capable input', () => {
  test.use({ hasTouch: true });

  test('tap reveals the preview information and taps on popover/accordion never pause', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'preview');
    const hotspot = trigger(page, 'preview');
    await hotspot.tap();
    const preview = page.locator('[data-showcase-preview]');
    await expect(preview).toBeVisible();
    expect((await preview.innerText()).trim().length).toBeGreaterThan(0);

    for (const [kind, content] of [
      ['popover', '[data-showcase-popover]'],
      ['accordion', '[data-showcase-accordion-panel]'],
    ] as const) {
      await playFrom(page, kind);
      await trigger(page, kind).tap();
      await expect(page.locator(content)).toBeVisible();
      await expectAdvancing(page);
      await trigger(page, kind).tap();
      await expect(page.locator(content)).toBeHidden();
      await expectAdvancing(page);
    }
  });

  test('tap opens the modal paused at the current frame; tapping close preserves it', async ({ page }) => {
    await openShowcase(page);
    await playFrom(page, 'dialog');
    const button = trigger(page, 'dialog');
    await button.tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const paused = await expectFrozen(page);
    await dialog.getByRole('button', { name: /close/i }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await expectFrozen(page)).toBe(paused);
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).tap();
    await expectAdvancing(page, paused);
  });
});
