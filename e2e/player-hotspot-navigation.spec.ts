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
  // The inspector navigates; activation remains an explicit Enter/Space action.
  await page.keyboard.press('Enter');
  await expect(page.locator('g[data-hotspot="bin-29"]')).toHaveAttribute('aria-pressed', 'true');
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

// Independent #59 acceptance, derived from Atlas 1.1/1.2 at 9f723ba. Use the real Player,
// native keyboard events and existing HTML/SVG hotspots; no replacement playback controller.
const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });

async function expectPlaying(page: Page, playing: boolean) {
  await expect(controls(page).getByRole('button', { name: playing ? 'Pause video' : 'Play video', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__latencyPlayer!.isPlaying())).toBe(playing);
}

async function activateCanvasContext(page: Page) {
  // The extreme corner is actual empty composition background, clear of all chart hotspots and
  // Remotion's bottom transport controls. A pointer visit to the video establishes its context.
  await page.locator('[data-composition-id]').click({ position: { x: 8, y: 8 } });
}

async function paint(page: Page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
}

test('Space pauses/resumes the active video once without scrolling; seeking and project navigation survive', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await openAtInspectableFrame(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await activateCanvasContext(page);
  await expectPlaying(page, true);
  const focused = await page.evaluateHandle(() => document.activeElement);
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY, scrollable: document.documentElement.scrollHeight > innerHeight }));
  expect(scroll.scrollable, 'the no-scroll assertion must exercise a scrollable page').toBe(true);
  await page.keyboard.press('Space');
  await expectPlaying(page, false);
  expect(await page.evaluate((before) => document.activeElement === before, focused), 'playback shortcut preserves keyboard context').toBe(true);
  const paused = await page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
  await paint(page);
  expect(await page.evaluate(() => window.__latencyPlayer!.getCurrentFrame())).toBe(paused);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: scroll.x, y: scroll.y });

  await page.keyboard.press('Space');
  await expectPlaying(page, true);
  await expect.poll(() => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame())).toBeGreaterThan(paused);
  await page.keyboard.press('Space');
  await expectPlaying(page, false);
  await page.evaluate(() => window.__latencyPlayer!.seekTo(165));
  await page.keyboard.press('Space');
  await expectPlaying(page, true);
  await expect.poll(() => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame())).toBeGreaterThanOrEqual(165);

  const next = page.getByRole('link', { name: 'Catalog title card', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/project=catalog-title-card/);
  await activateCanvasContext(page);
  await expectPlaying(page, false);
  await page.keyboard.press('Space');
  await expectPlaying(page, true);
});

test('holding Space toggles only once and modified Space does not invoke the plain shortcut', async ({ page }) => {
  await openAtInspectableFrame(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await activateCanvasContext(page);
  await page.keyboard.down('Space');
  try {
    await expectPlaying(page, false);
    await page.keyboard.down('Space'); // Real repeated keydown has repeat=true.
    await paint(page);
    await expectPlaying(page, false);
  } finally {
    await page.keyboard.up('Space');
  }
  await page.keyboard.press('Space');
  await expectPlaying(page, true);
  for (const modifier of ['Control', 'Alt', 'Meta', 'Shift']) {
    await page.keyboard.press(`${modifier}+Space`);
    await paint(page);
    await expectPlaying(page, true);
  }
});

for (const kind of ['HTML', 'SVG'] as const) {
  test(`${kind} hotspot Space inspects exactly once and never resumes playback`, async ({ page }) => {
    await openAtInspectableFrame(page);
    if (kind === 'HTML') {
      await page.evaluate(() => window.__latencyPlayer!.seekTo(165));
    }
    const hotspot = kind === 'HTML'
      ? page.locator('button[data-hotspot="term:p95"]')
      : page.locator('g[data-hotspot="bin-0"][role="button"]');
    await hotspot.focus();
    await expectPlaying(page, false);
    // Observe the real public Player handle without replacing its behavior. Each inspection's
    // existing onActivate calls pause(); counting calls detects duplicate same-selection actions
    // that a final aria-pressed assertion alone cannot distinguish.
    await page.evaluate(() => {
      const player = window.__latencyPlayer!;
      const pause = player.pause.bind(player);
      window.__shortcutEvidence = { pauses: 0, plays: 0 };
      player.pause = () => { window.__shortcutEvidence!.pauses += 1; pause(); };
      player.addEventListener('play', () => { window.__shortcutEvidence!.plays += 1; });
    });
    await page.keyboard.press('Space');
    await expect(hotspot).toHaveAttribute('aria-pressed', 'true');
    if (kind === 'HTML') {
      await expect(page.locator('.insight h2')).toHaveText('p95 latency');
    } else {
      await expect(page.locator('.insight')).toContainText('Slowest requests');
    }
    await expectPlaying(page, false);
    await paint(page);
    expect(await page.evaluate(() => window.__shortcutEvidence)).toEqual({ pauses: 1, plays: 0 });
    await page.getByRole('button', { name: 'Resume', exact: true }).focus();
    await page.keyboard.press('Space');
    await expectPlaying(page, true);
  });
}

test('Space preserves native toolbar buttons and the Developer mode checkbox', async ({ page }) => {
  await openAtInspectableFrame(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).focus();
  await page.keyboard.press('Space');
  await expectPlaying(page, true);
  const checkbox = page.getByLabel('Developer mode');
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expectPlaying(page, true);
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await expectPlaying(page, true);
});

// Independent review-regression fixture: real native disclosure and standards-based
// Space-owning controls traverse the actual Player boundary without replacing playback.
test('Space opens a native summary without toggling the actual Player', async ({ page }) => {
  await openAtInspectableFrame(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await page.locator('[data-composition-id]').evaluate((frame) => {
    const details = document.createElement('details');
    details.setAttribute('data-shortcut-details', '');
    const summary = document.createElement('summary');
    summary.textContent = 'Shortcut acceptance native disclosure';
    details.append(summary, document.createTextNode('Native details content'));
    frame.append(details);
  });
  await page.getByText('Shortcut acceptance native disclosure', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-shortcut-details]')).toHaveAttribute('open', '');
  await expectPlaying(page, true);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-shortcut-details]')).not.toHaveAttribute('open');
  await expectPlaying(page, true);
});

for (const role of ['menuitemcheckbox', 'menuitemradio', 'option'] as const) {
  for (const descendant of [false, true]) {
    test(`Space activates ${role}${descendant ? ' descendant' : ''} without toggling the actual Player`, async ({ page }) => {
      await openAtInspectableFrame(page);
      await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
      await page.locator('[data-composition-id]').evaluate((frame, { role, descendant }) => {
        const owner = document.createElement('div');
        owner.setAttribute('role', role === 'option' ? 'listbox' : 'menu');
        owner.setAttribute('aria-label', 'Shortcut acceptance control group');
        const control = document.createElement('div');
        control.setAttribute('role', role);
        control.setAttribute('aria-label', 'Shortcut acceptance role control');
        control.tabIndex = 0;
        const state = role === 'option' ? 'aria-selected' : 'aria-checked';
        control.setAttribute(state, 'false');
        const icon = document.createElement('span');
        icon.textContent = 'Control icon';
        if (descendant) icon.tabIndex = 0;
        control.append(icon);
        control.addEventListener('keydown', (event) => {
          if (event.code !== 'Space' || event.repeat || event.defaultPrevented) return;
          event.preventDefault();
          control.setAttribute(state, 'true');
        });
        owner.append(control);
        frame.append(owner);
      }, { role, descendant });
      const control = page.getByRole(role, { name: 'Shortcut acceptance role control', exact: true });
      if (descendant) await control.getByText('Control icon').focus();
      else await control.focus();
      await page.keyboard.press('Space');
      await expect(control).toHaveAttribute(role === 'option' ? 'aria-selected' : 'aria-checked', 'true');
      await expectPlaying(page, true);
    });
  }
}

test('Space types normally in editable descendants without toggling the actual Player', async ({ page }) => {
  await openAtInspectableFrame(page);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  // The current product has no text-editing UI. Minimal native elements are justified fixtures
  // for the explicit text-input exclusion in Atlas 1.2. They sit inside the real Player frame so
  // keyboard events traverse its real boundary; they provide no fake player or event handlers.
  await page.locator('[data-composition-id]').evaluate((column) => {
    for (const tag of ['input', 'textarea', 'div']) {
      const editor = document.createElement(tag);
      editor.setAttribute('aria-label', `Shortcut acceptance ${tag}`);
      if (tag === 'div') {
        editor.contentEditable = 'true';
        editor.setAttribute('role', 'textbox');
      }
      column.append(editor);
    }
  });
  for (const tag of ['input', 'textarea', 'div']) {
    const editor = page.getByLabel(`Shortcut acceptance ${tag}`);
    await editor.focus();
    await page.keyboard.type('a b');
    if (tag === 'div') {
      await expect(editor).toHaveText('a b');
    } else {
      await expect(editor).toHaveValue('a b');
    }
    await expectPlaying(page, true);
  }
});

declare global {
  interface Window {
    __shortcutEvidence?: { pauses: number; plays: number };
  }
}
