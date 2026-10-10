// Acceptance for issue #12 (moenarch-short-v1 format pack), written before the implementation.
//
// The specimen project (src/spec/fixtures/moenarch-specimen.videospec.json) opens at
// `?project=moenarch-specimen`. DOM contract of the pack's composition:
// - `[data-moenarch-root]`: the composition root, with `data-format="moenarch-short"`,
//   `data-format-version="1"` and `data-reduced-motion="true|false"`.
// - `[data-moenarch-scene="<scene id>"]`: one per mounted scene; mounted exactly while
//   `moenarchFrameState(...).sceneIds` lists it. Inside it, `[data-moenarch-heading]` holds the
//   scene heading.
// - `[data-moenarch-transition="<name>"]`: present exactly while a transition is active.
// - `[data-moenarch-intro]` / `[data-moenarch-outro]`: present exactly during intro / outro.
// - `[data-moenarch-signature]`: the recurring signature mark, on screen on some sampled frame.
// - `[data-moenarch-subtitle]`: present exactly while a narration cue is shown, with its text.
// - Headings and subtitles stay inside the token safe area.
// - Reduced motion (prefers-reduced-motion: reduce): moving transitions become
//   `tokens.reducedMotion.transition`, and nothing inside the root has a transform. Moving
//   transitions move content with CSS transforms, so normal motion shows one.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { moenarchFrameState, planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { moenarchShortV1Tokens as tokens } from '../src/formats/moenarch-short/tokens.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const PROJECT_ID = 'moenarch-specimen';
const spec = assertVideoSpec(
  JSON.parse(readFileSync(new URL('../src/spec/fixtures/moenarch-specimen.videospec.json', import.meta.url), 'utf8')),
);
const plan = planMoenarchShort(spec);

type Sample = { frame: number; kind: 'intro' | 'scene' | 'transition' | 'outro'; label: string };

const inside = (frame: number, window: { from: number; durationInFrames: number }) =>
  frame >= window.from && frame < window.from + window.durationInFrames;

/** Intro, one calm frame per scene (on a narration cue when possible), every transition, outro. */
function representativeFrames(): Sample[] {
  const busy = (frame: number) =>
    inside(frame, plan.intro) || inside(frame, plan.outro) || plan.transitions.some((transition) => inside(frame, transition));
  const samples: Sample[] = [{ frame: Math.floor(plan.intro.durationInFrames / 2), kind: 'intro', label: 'intro' }];
  spec.scenes.forEach((scene, index) => {
    const { from, durationInFrames } = plan.scenes[index];
    const cueFrames = (scene.narration?.cues ?? []).map(
      (cue) => from + Math.round((((cue.startMs + cue.endMs) / 2) * spec.output.fps) / 1000),
    );
    const candidates = [...cueFrames, from + Math.floor(durationInFrames / 2)];
    const frame = candidates.find((candidate) => !busy(candidate));
    if (frame !== undefined) samples.push({ frame, kind: 'scene', label: `scene ${scene.id}` });
  });
  for (const transition of plan.transitions) {
    if (transition.durationInFrames === 0) continue;
    samples.push({
      frame: transition.from + Math.floor(transition.durationInFrames / 2),
      kind: 'transition',
      label: `transition ${transition.name}`,
    });
  }
  samples.push({ frame: plan.outro.from + Math.floor(plan.outro.durationInFrames / 2), kind: 'outro', label: 'outro' });
  return samples;
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.mouse.move(0, 0);
  await page.goto(`/?project=${PROJECT_ID}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return errors;
}

// Seeks the paused Player to a frame and waits until it has painted.
async function seek(page: Page, frame: number) {
  await page.evaluate(async (target) => {
    const player = window.__latencyPlayer!;
    player.pause();
    player.seekTo(target);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, frame);
  await expect.poll(() => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame())).toBe(frame);
}

async function frameDom(page: Page) {
  return page.locator('[data-moenarch-root]').evaluate((root) => {
    const all = (selector: string) => [...root.querySelectorAll(selector)];
    const isIdentity = (style: CSSStyleDeclaration) =>
      (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
      style.translate === 'none' &&
      style.scale === 'none' &&
      style.rotate === 'none';
    return {
      scenes: all('[data-moenarch-scene]').map((element) => element.getAttribute('data-moenarch-scene')),
      transitions: all('[data-moenarch-transition]').map((element) => element.getAttribute('data-moenarch-transition')),
      intro: all('[data-moenarch-intro]').length,
      outro: all('[data-moenarch-outro]').length,
      signature: all('[data-moenarch-signature]').length,
      subtitles: all('[data-moenarch-subtitle]').map((element) => (element.textContent ?? '').trim()),
      headings: all('[data-moenarch-heading]').map((element) => (element.textContent ?? '').trim()),
      transformed: [root, ...all('*')].filter((element) => !isIdentity(getComputedStyle(element))).length,
    };
  });
}

/** The element's box in composition pixels (the Player scales the composition to fit). */
async function compositionBox(page: Page, selector: string) {
  const root = await page.locator('[data-moenarch-root]').boundingBox();
  const box = await page.locator(`[data-moenarch-root] ${selector}`).first().boundingBox();
  if (!root || !box) throw new Error(`no box for ${selector}`);
  const scale = root.width / tokens.output.width;
  return {
    left: (box.x - root.x) / scale,
    top: (box.y - root.y) / scale,
    right: (box.x - root.x + box.width) / scale,
    bottom: (box.y - root.y + box.height) / scale,
  };
}

async function expectInSafeArea(page: Page, selector: string, label: string) {
  const box = await compositionBox(page, selector);
  const { safeArea } = tokens.output;
  const slack = 1;
  expect(box.left, `${label} ${selector} left`).toBeGreaterThanOrEqual(safeArea.left - slack);
  expect(box.top, `${label} ${selector} top`).toBeGreaterThanOrEqual(safeArea.top - slack);
  expect(box.right, `${label} ${selector} right`).toBeLessThanOrEqual(tokens.output.width - safeArea.right + slack);
  expect(box.bottom, `${label} ${selector} bottom`).toBeLessThanOrEqual(tokens.output.height - safeArea.bottom + slack);
}

test('the specimen opens as a portrait moenarch-short v1 composition', async ({ page }) => {
  const errors = await open(page);
  const player = page.locator(`[data-composition-id="${PROJECT_ID}"]`);
  await expect(player).toHaveAttribute('data-width', '1080');
  await expect(player).toHaveAttribute('data-height', '1920');
  await expect(player).toHaveAttribute('data-fps', '30');
  await expect(player).toHaveAttribute('data-duration-in-frames', String(plan.durationInFrames));
  const root = page.locator('[data-moenarch-root]');
  await expect(root).toHaveCount(1);
  await expect(root).toHaveAttribute('data-format', 'moenarch-short');
  await expect(root).toHaveAttribute('data-format-version', '1');
  await expect(root).toHaveAttribute('data-reduced-motion', 'false');
  expect(errors).toEqual([]);
});

test('every representative frame draws what the plan says, inside the safe area', async ({ page }) => {
  const errors = await open(page);
  let signatureSeen = false;
  let movingTransitionsTransformed = 0;
  for (const sample of representativeFrames()) {
    await seek(page, sample.frame);
    const state = moenarchFrameState(plan, sample.frame, { reducedMotion: false });
    const dom = await frameDom(page);
    expect(dom.scenes, sample.label).toEqual(state.sceneIds);
    expect(dom.transitions, sample.label).toEqual(state.transition ? [state.transition.name] : []);
    expect(dom.intro > 0, sample.label).toBe(state.intro);
    expect(dom.outro > 0, sample.label).toBe(state.outro);
    expect(dom.subtitles, sample.label).toEqual(state.subtitle === null ? [] : [state.subtitle]);
    signatureSeen ||= dom.signature > 0;
    if (sample.kind === 'scene') {
      const scene = spec.scenes.find((candidate) => candidate.id === state.sceneIds[0])!;
      // The specimen has title scenes only (#13 widened the Scene union).
      expect(dom.headings, sample.label).toEqual([(scene.payload as { heading: string }).heading]);
      await expectInSafeArea(page, '[data-moenarch-heading]', sample.label);
      if (state.subtitle !== null) await expectInSafeArea(page, '[data-moenarch-subtitle]', sample.label);
    }
    if (sample.kind === 'transition' && state.transition && tokens.transitions[state.transition.name as keyof typeof tokens.transitions].motion) {
      if (dom.transformed > 0) movingTransitionsTransformed += 1;
    }
  }
  expect(signatureSeen).toBe(true);
  // Moving transitions really move something, so the reduced-motion check below is not vacuous.
  expect(movingTransitionsTransformed).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/**
 * The composition DOM as text: elements, attributes, inline style declarations and text. Style
 * declarations are sorted, because React keeps their insertion order across updates, so the same
 * frame reached from different frames can list the same declarations in another order.
 */
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

// The composition DOM (structure and inline styles) must be identical. Pixels may differ only
// by Chromium's rasterization of transformed text, which touches a few edge pixels; a real change
// (a moved heading, another colour) changes far more than this share of the frame.
const MAX_DIFFERING_PIXEL_SHARE = 0.002;

/** Share of pixels whose RGBA differs between two same-sized PNG screenshots. */
async function differingPixelShare(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const pixels = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([pixels(first), pixels(second)]);
      if (x.width !== y.width || x.height !== y.height) return 1;
      let differing = 0;
      for (let index = 0; index < x.data.length; index += 4) {
        if (
          x.data[index] !== y.data[index] ||
          x.data[index + 1] !== y.data[index + 1] ||
          x.data[index + 2] !== y.data[index + 2] ||
          x.data[index + 3] !== y.data[index + 3]
        ) {
          differing += 1;
        }
      }
      return differing / (x.width * x.height);
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

test('a frame renders identically twice, including after seeking away and back', async ({ page }) => {
  await open(page);
  const samples = representativeFrames();
  const capture = async (frame: number) => {
    await seek(page, frame);
    return {
      html: await page.locator('[data-moenarch-root]').evaluate(serializeFrame),
      png: await page.locator(`[data-composition-id="${PROJECT_ID}"]`).screenshot({ animations: 'disabled' }),
    };
  };
  const first = new Map<number, Awaited<ReturnType<typeof capture>>>();
  for (const { frame } of samples) first.set(frame, await capture(frame));
  // Second pass in reverse order, so every frame is reached from a different previous frame.
  for (const { frame, label } of [...samples].reverse()) {
    const again = await capture(frame);
    expect(again.html, label).toBe(first.get(frame)!.html);
    expect(await differingPixelShare(page, first.get(frame)!.png, again.png), `${label} screenshot`).toBeLessThanOrEqual(
      MAX_DIFFERING_PIXEL_SHARE,
    );
  }
});

test('reduced motion swaps moving transitions for the reduced-motion transition and moves nothing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  await expect(page.locator('[data-moenarch-root]')).toHaveAttribute('data-reduced-motion', 'true');
  let replaced = 0;
  for (const sample of representativeFrames()) {
    await seek(page, sample.frame);
    const state = moenarchFrameState(plan, sample.frame, { reducedMotion: true });
    const dom = await frameDom(page);
    expect(dom.scenes, sample.label).toEqual(state.sceneIds);
    expect(dom.transitions, sample.label).toEqual(state.transition ? [state.transition.name] : []);
    expect(dom.transformed, `${sample.label}: transformed elements`).toBe(0);
    if (sample.kind === 'transition' && !sample.label.endsWith(` ${tokens.reducedMotion.transition}`)) {
      if (state.transition?.name === tokens.reducedMotion.transition) replaced += 1;
    }
  }
  expect(replaced).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
