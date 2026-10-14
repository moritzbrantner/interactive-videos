// Independent #56 acceptance: render the actual catalog typography project through the same
// Remotion root/bundler as the CLI. Inspect the real frame immediately before capture; no fake
// font, alternate component, test-side font readiness wait, or production DOM measurement.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { bundle, webpack } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { expect, it, vi } from 'vitest';

import { planMoenarchShort } from '@/formats/moenarch-short/plan';
import { assertVideoSpec } from '@/spec/video-spec';
import fixture from '@/spec/fixtures/moenarch-typography.videospec.json';

import { appAlias, sourcePinAliases } from '../../source-pins';
import { observeTypography, type TypographyObservation } from './fonts.test-support';

it('Linux Remotion frames load packaged fonts and keep the actual at-capacity/wide text inside its box', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'iv-font-acceptance-'));
  const observations: TypographyObservation[] = [];
  const platformFonts: { familyName: string; isCustomFont: boolean }[][] = [];
  const browser = await openBrowser('chrome', { browserExecutable: chromium.executablePath(), logLevel: 'error' });
  try {
    // The pinned renderer has no public before-capture observer. Wrap only its screenshot queue:
    // the unmodified task still performs the actual capture, after its normal readiness gates.
    // A renderer upgrade that changes this seam must fail (observations are mandatory), not pass
    // by silently rendering a different fixture or measuring text after an extra font wait.
    const newPage = browser.newPage.bind(browser);
    vi.spyOn(browser, 'newPage').mockImplementation(async (options) => {
      const page = await newPage(options);
      const postTask = page.screenshotTaskQueue.postTask.bind(page.screenshotTaskQueue);
      page.screenshotTaskQueue.postTask = async <T,>(task: () => Promise<T>): Promise<T> => {
        observations.push(await page.evaluate(observeTypography));
        // The pinned renderer narrows its CDP types to the commands it consumes. These additional
        // standard Chrome commands observe actual glyph provenance, just like the Player test.
        const cdp = page._client() as unknown as {
          send<T>(method: string, params?: Record<string, unknown>): Promise<{ value: T }>;
        };
        await cdp.send('DOM.enable');
        await cdp.send('CSS.enable');
        const { value: { root } } = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument');
        const { value: { nodeIds } } = await cdp.send<{ nodeIds: number[] }>('DOM.querySelectorAll', {
          nodeId: root.nodeId, selector: '[data-moenarch-text] *',
        });
        const fonts: { familyName: string; isCustomFont: boolean }[] = [];
        for (const nodeId of nodeIds) {
          const { value } = await cdp.send<{ fonts: typeof fonts }>('CSS.getPlatformFontsForNode', { nodeId });
          fonts.push(...value.fonts);
        }
        platformFonts.push(fonts);
        return postTask(task);
      };
      return page;
    });
    const aliases = Object.fromEntries(sourcePinAliases.map(({ find, replacement }) => [
      `${find.source.replace(/^\^/, '').replace(/\\(.)/g, '$1')}`,
      replacement,
    ]));
    const serveUrl = await bundle({
      entryPoint: join(import.meta.dirname, 'root.tsx'),
      publicDir: join(import.meta.dirname, '../../public'),
      outDir: join(temp, 'bundle'),
      onProgress: () => undefined,
      webpackOverride: (config) => ({
        ...config,
        resolve: { ...config.resolve, alias: { ...config.resolve?.alias, ...aliases, '@': appAlias.replacement.replace(/\/$/, '') } },
        plugins: [...(config.plugins ?? []), new webpack.DefinePlugin({
          'import.meta.env.MODE': JSON.stringify('production'),
          'import.meta.env.BASE_URL': '(window.remotion_staticBase + "/")',
        })],
      }),
    });
    const composition = await selectComposition({ serveUrl, id: fixture.project.id, puppeteerInstance: browser, logLevel: 'error' });
    const plan = planMoenarchShort(assertVideoSpec(fixture));
    for (const scene of plan.scenes) {
      const before = observations.length;
      const { buffer } = await renderStill({
        serveUrl,
        composition,
        puppeteerInstance: browser,
        frame: scene.from + 60,
        imageFormat: 'png',
        logLevel: 'error',
      });
      expect(buffer?.subarray(1, 4).toString(), `${scene.id}: actual PNG rendered`).toBe('PNG');
      expect(observations.length, 'capture observer must run').toBeGreaterThan(before);
      const actualFonts = platformFonts.at(-1)!;
      expect(actualFonts.length, 'actual rendered font evidence is mandatory').toBeGreaterThan(0);
      expect.soft(actualFonts.every((font) => font.isCustomFont), `${scene.id}: actual glyph fonts ${JSON.stringify(actualFonts)}`).toBe(true);
      const blocks = observations.at(-1)!;
      expect(blocks.map((block) => block.text), scene.id).toEqual(scene.layout.blocks.map((block) => block.text));
      for (const block of blocks) {
        expect.soft(block.loaded, `${scene.id}/${block.role}: packaged font ${block.family} ready at capture`).toBe(true);
        expect(block.fragments.length).toBeGreaterThan(0);
        for (const fragment of block.fragments) {
          expect.soft(fragment.left, `${scene.id}/${block.role}: left`).toBeGreaterThanOrEqual(block.box.left - 1);
          expect.soft(fragment.right, `${scene.id}/${block.role}: right`).toBeLessThanOrEqual(block.box.right + 1);
          expect.soft(fragment.right, '840px content box').toBeLessThanOrEqual(937);
        }
      }
      if (scene.id === 'capacity') {
        const heading = blocks.find((block) => block.role === 'heading')!;
        expect(heading.fontSize).toBe(96);
        expect(heading.fragments).toHaveLength(3);
      }
    }
  } finally {
    await browser.close({ silent: true });
    vi.restoreAllMocks();
    rmSync(temp, { recursive: true, force: true });
  }
});
