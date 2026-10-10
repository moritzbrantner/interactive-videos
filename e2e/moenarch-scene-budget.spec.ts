// Render-budget acceptance for issue #13 (editorial scene archetypes), written before the
// implementation. Runs against the `--mode render-budget` build like render-budget.spec.ts.
//
// Counter contract (via `useBudgetCounter` from src/render-budget.ts):
// - `MoenarchShortVideo`: the moenarch-short composition root, once per render. The Player
//   re-renders it on every frame.
// - `MoenarchTextBlock`: the component that draws one `[data-moenarch-text]` element, once per
//   render of that element.
//
// Frame-independent work stays out of per-frame rendering: text is laid out by the plan and its
// elements are memoized, so while frames play a text block renders once when its scene mounts
// (or when a staggered item first appears) and never again. Motion wrappers around the text may
// re-render per frame; the text blocks inside them may not.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';
import { expectRenderBudget, getRenderStats, resetRenderStats } from 'react-render-budget/playwright';

import { planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const PROJECT_ID = 'moenarch-scene-gallery';
const spec = assertVideoSpec(
  JSON.parse(readFileSync(new URL('../src/spec/fixtures/moenarch-scene-gallery.videospec.json', import.meta.url), 'utf8')),
);

type FrameWindow = { from: number; durationInFrames: number };
type PlanScene = FrameWindow & { id: string; kind: string; layout: { blocks: unknown[] } };
const plan = planMoenarchShort(spec) as unknown as {
  scenes: PlanScene[];
  transitions: (FrameWindow & { fromSceneId: string; toSceneId: string })[];
  outro: FrameWindow;
};

async function openPausedAt(page: Page, frame: number) {
  await page.goto(`/?project=${PROJECT_ID}`);
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

for (const scene of plan.scenes.filter((candidate) => candidate.id.endsWith('-long'))) {
  test(`${scene.id}: text renders once while the scene plays in, not per frame`, async ({ page }) => {
    const incoming = plan.transitions.find((transition) => transition.toSceneId === scene.id);
    const outgoing = plan.transitions.find((transition) => transition.fromSceneId === scene.id);
    // From the last frame before the scene mounts to its last frame before it starts leaving.
    const before = (incoming ? Math.min(incoming.from, scene.from) : scene.from) - 1;
    const end = Math.min(outgoing ? outgoing.from : scene.from + scene.durationInFrames, plan.outro.from);
    const last = end - 1;
    const frames = last - before;
    expect(before).toBeGreaterThanOrEqual(0);
    expect(frames).toBeGreaterThan(30);

    await openPausedAt(page, before);
    await expect(page.locator(`[data-moenarch-scene="${scene.id}"]`)).toHaveCount(0);
    await resetRenderStats(page);

    await seekFrames(page, before + 1, last);
    await expect(page.locator(`[data-moenarch-scene="${scene.id}"] [data-moenarch-text]`)).toHaveCount(scene.layout.blocks.length);

    const { components } = await getRenderStats(page);
    // Lower bounds: every stepped frame rendered, and the scene's text was drawn.
    expect(components.MoenarchShortVideo ?? 0).toBeGreaterThanOrEqual(frames);
    expect(components.MoenarchTextBlock ?? 0).toBeGreaterThanOrEqual(scene.layout.blocks.length);
    await expectRenderBudget(page, {
      components: {
        // The Player re-renders the composition root on every frame...
        MoenarchShortVideo: frames,
        // ...but each text block of the incoming scene renders once, and the outgoing scene's
        // text does not re-render during the transition.
        MoenarchTextBlock: scene.layout.blocks.length,
      },
    });
  });
}
