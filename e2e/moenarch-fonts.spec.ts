// Independent acceptance for #56 / Atlas 4.1. The catalog fixture is a real project; no
// replacement components, injected typography, font-ready waits, or system fonts in the oracle.
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { estimateLineWidth } from '../src/formats/moenarch-short/layout.ts';
import { planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { moenarchShortV1Tokens as tokens } from '../src/formats/moenarch-short/tokens.ts';
import { observeTypography } from '../src/render/fonts.test-support.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const fixture = assertVideoSpec(JSON.parse(readFileSync(new URL('../src/spec/fixtures/moenarch-typography.videospec.json', import.meta.url), 'utf8')));
const plan = planMoenarchShort(fixture);
const route = '/?project=moenarch-typography';

test('the real Player fits capacity, wide capitals and EN/DE/ES text using packaged fonts', async ({ page, context }) => {
  const external: string[] = [];
  await page.route('**/*', async (request) => {
    if (new URL(request.request().url()).hostname !== '127.0.0.1') {
      external.push(request.request().url());
      await request.abort();
      return;
    }
    await request.continue();
  });
  await page.goto('/');
  await page.getByRole('link', { name: fixture.project.title, exact: true }).click();
  await expect(page).toHaveURL(/project=moenarch-typography/);
  const controls = page.getByRole('group', { name: 'Video controls' });
  await controls.getByRole('button', { name: 'Play video', exact: true }).click();
  await controls.getByRole('button', { name: 'Pause video', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(controls.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  expect(tokens.typography.density).toEqual({ maxCharsPerLine: 14, maxLines: 3 });
  expect(tokens.scenes.text.headline.size).toBe(96);

  for (const scene of plan.scenes) {
    await page.evaluate(async (frame) => {
      window.__latencyPlayer!.seekTo(frame);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, scene.from + 60);
    const blocks = await page.evaluate(observeTypography);
    expect(blocks.map((block) => block.text)).toEqual(scene.layout.blocks.map((block) => block.text));
    for (const block of blocks) {
      expect.soft(block.loaded, `${scene.id}/${block.role}: packaged font ${block.family} loaded by production`).toBe(true);
      expect(block.fragments.length).toBeGreaterThan(0);
      for (const fragment of block.fragments) {
        expect.soft(fragment.left, `${scene.id}/${block.role} left`).toBeGreaterThanOrEqual(block.box.left - 1);
        expect.soft(fragment.right, `${scene.id}/${block.role} right`).toBeLessThanOrEqual(block.box.right + 1);
        expect.soft(fragment.right, 'safe area').toBeLessThanOrEqual(936 + 1);
      }
    }
    if (scene.id === 'capacity') {
      const heading = blocks.find((block) => block.role === 'heading')!;
      expect(heading.fontSize).toBe(96);
      expect(heading.fragments).toHaveLength(3);
    }
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-moenarch-text] *' });
    let renderedFonts = 0;
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      renderedFonts += fonts.length;
      expect.soft(fonts.every((font) => font.isCustomFont), `${scene.id}: actual glyphs must use packaged fonts: ${JSON.stringify(fonts)}`).toBe(true);
    }

    expect(renderedFonts, 'actual rendered font evidence is mandatory').toBeGreaterThan(0);

    // Compare independently measured glyph advances with the production estimate. Include all
    // ASCII classes plus representative needed Latin accents, at each style actually rendered.
    const alphabet = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@%&!?ÄÖÜäöüßÁÉÍÓÚáéíóúÑñ¿¡';
    const measurements = await page.locator('[data-moenarch-text]').evaluateAll((elements, chars) => elements.map((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return [...chars].map((glyph) => {
        const drawn = style.textTransform === 'uppercase' ? glyph.toUpperCase() : glyph;
        return { glyph, width: ctx.measureText(drawn).width + (Number.parseFloat(style.letterSpacing) || 0) };
      });
    }), alphabet);
    measurements.forEach((glyphs, index) => {
      const style = scene.layout.blocks[index].style;
      for (const { glyph, width } of glyphs) {
        expect.soft(width, `${scene.id}/${style}/${glyph}: advance bound`).toBeLessThanOrEqual(estimateLineWidth(glyph, tokens, style) + 0.1);
      }
    });
  }
  expect(external).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('typography.png') });
});

test('a cold Player does not expose fallback text while local fonts are still loading', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const fonts: string[] = [];
  await page.route(/\.(?:woff2?|ttf|otf)(?:\?|$)/i, async (route) => {
    fonts.push(route.request().url());
    await held;
    await route.continue();
  });
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => fonts.length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForFunction(() => window.__latencyPlayer !== undefined);
    await page.evaluate(async () => {
      window.__latencyPlayer!.pause();
      window.__latencyPlayer!.seekTo(60);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    // Inspect a settled frame, not the naturally transparent entrance at frame zero.
    // A hidden/loading composition is valid; showing an OS fallback is not.
    const visible = await page.locator('[data-moenarch-text]').evaluateAll((elements) => elements.some((element) => {
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        node = node.parentElement;
      }
      return element.getBoundingClientRect().width > 0;
    }));
    expect(visible, 'font-pending text must not paint with system fallback').toBe(false);
  } finally {
    release();
  }
  await expect.poll(async () => {
    if (await page.locator('[data-moenarch-text]').count() === 0) {
      return false;
    }
    return (await page.evaluate(observeTypography)).every((block) => block.loaded);
  }).toBe(true);
});
