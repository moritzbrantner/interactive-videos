// Acceptance for issue #14 (narration, cue and subtitle timing), written before the implementation.
//
// The narration fixture (src/spec/fixtures/moenarch-narration.videospec.json) opens at
// `?project=moenarch-narration`. Its frame schedule is `narrationSchedule(spec)` (contract in
// src/spec/narration-timing.test.ts). DOM contract, in addition to e2e/moenarch-short.spec.ts:
// - `[data-moenarch-subtitle]` is present exactly while a scheduled cue window contains the
//   frame, its text is the cue text, and it is drawn by the installed `Subtitles` primitive (the
//   primitive labels its cue element with `aria-label="<cue text>"`).
// - `[data-moenarch-mark="<id>"]` is present exactly while `moenarchFrameState(...).mark` is that
//   id: from the semantic cue's scheduled frame until the scene's next mark or the scene's end.
// - Narration audio plays through Remotion's `Audio`: inside the Player, while a frame is inside a
//   scheduled audio segment, exactly one <audio> element has the asset's `static:` path as its
//   src, and with the Player paused its currentTime is
//   (frame - segment.from + segment.trimBeforeInFrames) / fps. Outside every segment (lead-in,
//   hold, lead-out, silent scenes) no <audio> element in the Player has a narration src.
// - A frame renders the same DOM whether reached by stepping through every frame in order or by
//   seeking to it directly from elsewhere.
// - Nothing is requested from another origin: audio and timing are resolved data, no LLM, TTS
//   or other network service is involved at render time.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { moenarchFrameState, planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { narrationSchedule } from '../src/spec/narration-schedule.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const PROJECT_ID = 'moenarch-narration';
// Computed on first use, so each test reports its own failure.
let cached: { spec: ReturnType<typeof assertVideoSpec>; schedule: ReturnType<typeof narrationSchedule>; plan: ReturnType<typeof planMoenarchShort> } | null = null;
function subject() {
  if (!cached) {
    const spec = assertVideoSpec(
      JSON.parse(readFileSync(new URL('../src/spec/fixtures/moenarch-narration.videospec.json', import.meta.url), 'utf8')),
    );
    cached = { spec, schedule: narrationSchedule(spec), plan: planMoenarchShort(spec) };
  }
  return cached;
}

const assetPath = (assetId: string) => {
  const asset = subject().spec.assets.find((candidate) => candidate.id === assetId)!;
  return `/${asset.uri.replace(/^static:/, '')}`;
};

/** What a frame must show, from the schedule alone. */
function expectedAt(frame: number) {
  const { schedule } = subject();
  const fps = schedule.fps;
  const scene = schedule.scenes.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames)!;
  const cue = scene.cues.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames);
  const marks = scene.marks.filter((mark) => mark.frame <= frame);
  const segment = scene.audio?.segments.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames);
  return {
    subtitle: cue ? cue.text : null,
    mark: marks.length ? marks[marks.length - 1].id : null,
    audio: segment
      ? { path: assetPath(scene.audio!.asset), seconds: (frame - segment.from + segment.trimBeforeInFrames) / fps }
      : null,
  };
}

/** Every frame where something scheduled starts or ends, the frame before it, and a few calm frames. */
function boundaryFrames(): number[] {
  const { schedule } = subject();
  const frames = new Set<number>();
  const add = (frame: number) => {
    for (const candidate of [frame - 1, frame]) {
      if (candidate >= 0 && candidate < schedule.durationInFrames) frames.add(candidate);
    }
  };
  for (const scene of schedule.scenes) {
    add(scene.from);
    add(scene.from + scene.durationInFrames);
    for (const window of [...scene.cues, ...(scene.audio ? [...scene.audio.segments, ...scene.audio.holds, scene.audio.leadIn, scene.audio.leadOut] : [])]) {
      add(window.from);
      add(window.from + window.durationInFrames);
    }
    for (const mark of scene.marks) add(mark.frame);
    frames.add(scene.from + Math.floor(scene.durationInFrames / 2));
  }
  return [...frames].sort((a, b) => a - b);
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
    const subtitles = [...root.querySelectorAll('[data-moenarch-subtitle]')];
    return {
      subtitles: subtitles.map((element) => (element.textContent ?? '').trim()),
      primitiveLabels: subtitles.flatMap((element) =>
        [...element.querySelectorAll('[aria-label]')].map((labelled) => labelled.getAttribute('aria-label')),
      ),
      marks: [...root.querySelectorAll('[data-moenarch-mark]')].map((element) => element.getAttribute('data-moenarch-mark')),
    };
  });
}

/** <audio> elements in the Player whose src is a narration file, as path and current time. */
async function narrationAudio(page: Page) {
  return page.locator(`[data-composition-id="${PROJECT_ID}"]`).evaluate((player) =>
    [...player.querySelectorAll('audio')]
      .map((audio) => ({ src: audio.currentSrc || audio.src, seconds: audio.currentTime }))
      .filter((audio) => /^https?:/.test(audio.src) && new URL(audio.src).pathname.startsWith('/fixtures/narration/'))
      .map((audio) => ({ path: new URL(audio.src).pathname, seconds: audio.seconds })),
  );
}

/** Same serialization as the #12 determinism test: elements, attributes, sorted inline styles, text. */
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

test('the narration project is as long as its narration schedule', async ({ page }) => {
  const { schedule } = subject();
  const errors = await open(page);
  const player = page.locator(`[data-composition-id="${PROJECT_ID}"]`);
  await expect(player).toHaveAttribute('data-fps', '30');
  await expect(player).toHaveAttribute('data-duration-in-frames', String(schedule.durationInFrames));
  expect(schedule.durationInFrames).toBe(309);
  expect(errors).toEqual([]);
});

test('subtitles and semantic cue changes land on their scheduled frames', async ({ page }) => {
  const { plan } = subject();
  const errors = await open(page);
  let subtitleFrames = 0;
  let markFrames = 0;
  for (const frame of boundaryFrames()) {
    await seek(page, frame);
    const expected = expectedAt(frame);
    // The schedule and the pack's frame state agree.
    const state = moenarchFrameState(plan, frame, { reducedMotion: false }) as { subtitle: string | null; mark?: string | null };
    expect({ subtitle: state.subtitle, mark: state.mark }, `frame ${frame} state`).toEqual({ subtitle: expected.subtitle, mark: expected.mark });
    const dom = await frameDom(page);
    expect(dom.subtitles, `frame ${frame} subtitle`).toEqual(expected.subtitle === null ? [] : [expected.subtitle]);
    if (expected.subtitle !== null) {
      expect(dom.primitiveLabels, `frame ${frame} drawn by the Subtitles primitive`).toContain(expected.subtitle);
      subtitleFrames += 1;
    }
    expect(dom.marks, `frame ${frame} mark`).toEqual(expected.mark === null ? [] : [expected.mark]);
    if (expected.mark !== null) markFrames += 1;
  }
  // The walk saw both kinds of change (not vacuous).
  expect(subtitleFrames).toBeGreaterThan(10);
  expect(markFrames).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('narration audio plays the right file from the right offset, and only inside its segments', async ({ page }) => {
  const { schedule } = subject();
  const errors = await open(page);
  const frames = new Set(boundaryFrames());
  for (const scene of schedule.scenes) {
    for (const segment of scene.audio?.segments ?? []) frames.add(segment.from + Math.floor(segment.durationInFrames / 2));
  }
  let audible = 0;
  let silent = 0;
  for (const frame of [...frames].sort((a, b) => a - b)) {
    await seek(page, frame);
    const expected = expectedAt(frame).audio;
    if (expected === null) {
      await expect.poll(() => narrationAudio(page), { message: `frame ${frame}: no narration audio` }).toEqual([]);
      silent += 1;
      continue;
    }
    await expect
      .poll(
        async () => {
          const audio = await narrationAudio(page);
          return audio.map((element) => ({ path: element.path, close: Math.abs(element.seconds - expected.seconds) < 0.02 }));
        },
        { message: `frame ${frame}: ${expected.path} at ${expected.seconds.toFixed(3)} s` },
      )
      .toEqual([{ path: expected.path, close: true }]);
    audible += 1;
  }
  expect(audible).toBeGreaterThan(5);
  expect(silent).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('seeking to a frame renders the same DOM as stepping through every frame in order', async ({ page }) => {
  const { schedule } = subject();
  test.setTimeout(240_000);
  const errors = await open(page);
  const samples = boundaryFrames();
  const sampled = new Set(samples);
  const linear = new Map<number, string>();
  // Linear playback: every frame from the first, in order.
  for (let frame = 0; frame < schedule.durationInFrames; frame += 1) {
    await seek(page, frame);
    if (sampled.has(frame)) linear.set(frame, await page.locator('[data-moenarch-root]').evaluate(serializeFrame));
  }
  // Direct seeks in a fixed scrambled order, so each frame is reached from a distant one.
  const order = samples.map((frame, index) => ({ frame, key: (index * 7919) % samples.length })).sort((a, b) => a.key - b.key);
  for (const { frame } of order) {
    await seek(page, frame);
    expect(await page.locator('[data-moenarch-root]').evaluate(serializeFrame), `frame ${frame}`).toBe(linear.get(frame));
  }
  expect(errors).toEqual([]);
});

test('rendering the narration project requests nothing from another origin', async ({ page, baseURL }) => {
  const { schedule } = subject();
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== new URL(baseURL!).origin) foreign.push(url);
  });
  const errors = await open(page);
  for (const frame of [0, 20, 60, 120, 150, 170, 250, schedule.durationInFrames - 1]) await seek(page, frame);
  await page.evaluate(() => window.__latencyPlayer!.play());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__latencyPlayer!.pause());
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});
