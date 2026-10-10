// Acceptance for issue #13 (editorial scene archetypes), written before the implementation.
//
// The scene gallery (src/spec/fixtures/moenarch-scene-gallery.videospec.json) opens at
// `?project=moenarch-scene-gallery`. DOM contract of the archetype scenes, in addition to the #12
// contract in moenarch-short.spec.ts:
// - `[data-moenarch-scene="<scene id>"]` also carries `data-moenarch-kind="<VideoSpec kind>"`.
// - Every text block of the scene's layout (`layoutMoenarchScene(...).blocks`, also on the plan
//   scene as `layout`) is one block-level element `[data-moenarch-text="<block role>"]` inside the
//   scene, in reading (DOM) order. Its textContent, with whitespace collapsed, is the block text
//   (planned lines are separated by whitespace in the DOM), and it renders exactly the planned
//   number of lines: the browser never re-wraps planned text.
// - Statement emphasis: `[data-moenarch-emphasis]` inside the statement's text block holds the
//   payload `emphasis`.
// - List items are inside an `ol` when the payload is `ordered`, otherwise inside a `ul`.
// - Media reveal: one `img[data-moenarch-media]` with the payload `alt`, its src path ending in
//   the layout's `staticPath`, loaded, with `object-fit` from `tokens.media.fit`.
// - At the sampled frames (an entrance frame, a narration frame, a settled frame) every text block
//   on screen is inside the token safe area, its text stays inside its own box (no horizontal
//   scroll overflow, every text fragment within the box), and it does not overlap the subtitle or the signature mark. At the settled frame
//   (the last frame before the scene's outgoing transition or the outro) every block and the
//   media are mounted and fully opaque.
// - Under prefers-reduced-motion nothing inside the root has a transform at those frames.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { planMoenarchShort } from '../src/formats/moenarch-short/plan.ts';
import { moenarchShortV1Tokens as tokens } from '../src/formats/moenarch-short/tokens.ts';
import { assertVideoSpec } from '../src/spec/video-spec.ts';

const PROJECT_ID = 'moenarch-scene-gallery';
const spec = assertVideoSpec(
  JSON.parse(readFileSync(new URL('../src/spec/fixtures/moenarch-scene-gallery.videospec.json', import.meta.url), 'utf8')),
);

type Block = { role: string; text: string; lines: string[]; maxCharsPerLine: number; maxLines: number };
type Layout = { kind: string; blocks: Block[]; media: { assetId: string; staticPath: string; alt: string } | null };
type PlanScene = { id: string; kind: string; from: number; durationInFrames: number; layout: Layout };
type FrameWindow = { from: number; durationInFrames: number };
const plan = planMoenarchShort(spec) as unknown as {
  durationInFrames: number;
  scenes: PlanScene[];
  transitions: (FrameWindow & { fromSceneId: string; toSceneId: string })[];
  intro: FrameWindow;
  outro: FrameWindow;
};

const inside = (frame: number, window: FrameWindow) => frame >= window.from && frame < window.from + window.durationInFrames;
const busy = (frame: number) =>
  inside(frame, plan.intro) || inside(frame, plan.outro) || plan.transitions.some((transition) => inside(frame, transition));

type Sample = { frame: number; scene: PlanScene; moment: 'entrance' | 'narration' | 'settled' };

/** Per scene: shortly after it is alone on screen, mid narration (or mid scene), and settled. */
function samples(): Sample[] {
  return plan.scenes.flatMap((scene, index): Sample[] => {
    const end = scene.from + scene.durationInFrames;
    const calm = Array.from({ length: scene.durationInFrames }, (_, offset) => scene.from + offset).filter((frame) => !busy(frame));
    if (!calm.length) throw new Error(`${scene.id} has no calm frame`);
    const outgoing = plan.transitions.find((transition) => transition.fromSceneId === scene.id);
    const settledEnd = Math.min(outgoing ? outgoing.from : end, inside(plan.outro.from, scene) ? plan.outro.from : end);
    const settled = settledEnd - 1;
    const cue = spec.scenes[index].narration?.cues[0];
    const narration = cue
      ? scene.from + Math.round((((cue.startMs + cue.endMs) / 2) * spec.output.fps) / 1000)
      : scene.from + Math.floor(scene.durationInFrames / 2);
    return [
      { frame: Math.min(calm[0] + 3, settled), scene, moment: 'entrance' as const },
      { frame: narration, scene, moment: 'narration' as const },
      { frame: settled, scene, moment: 'settled' as const },
    ].filter((sample) => !busy(sample.frame));
  });
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
  // Media is drawn with a loaded image; wait for any image in the composition to finish loading.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-moenarch-root] img')].every((image) => (image as HTMLImageElement).complete),
  );
}

type Box = { left: number; top: number; right: number; bottom: number };
type TextInfo = {
  role: string;
  text: string;
  display: string;
  box: Box;
  textBoxes: Box[];
  renderedLines: number;
  scrollOverflow: number;
  opacity: number;
  emphasis: string[];
  listTag: string | null;
};
type SceneDom = {
  kind: string | null;
  texts: TextInfo[];
  media: { alt: string; path: string; complete: boolean; naturalWidth: number; objectFit: string; box: Box; opacity: number }[];
  subtitle: Box | null;
  signature: Box | null;
  transformed: number;
};

/** One mounted scene's text, media and overlays, in composition pixels. */
async function sceneDom(page: Page, sceneId: string): Promise<SceneDom | null> {
  return page.locator('[data-moenarch-root]').evaluate(
    (root, [id, width]) => {
      const rootRect = root.getBoundingClientRect();
      const scale = rootRect.width / width;
      const toBox = (rect: DOMRect) => ({
        left: (rect.left - rootRect.left) / scale,
        top: (rect.top - rootRect.top) / scale,
        right: (rect.right - rootRect.left) / scale,
        bottom: (rect.bottom - rootRect.top) / scale,
      });
      const effectiveOpacity = (element: Element) => {
        let opacity = 1;
        for (let node: Element | null = element; node && node !== root.parentElement; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity;
      };
      const isIdentity = (style: CSSStyleDeclaration) =>
        (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
        style.translate === 'none' &&
        style.scale === 'none' &&
        style.rotate === 'none';
      const scene = root.querySelector(`[data-moenarch-scene="${id}"]`);
      if (!scene) return null;

      const textInfo = (element: HTMLElement) => {
        // Fragments of the element's text, one rect per line piece; element boxes are excluded.
        const textBoxes: DOMRect[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!(node.textContent ?? '').trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) textBoxes.push(rect);
        }
        // Rendered lines: fragments that overlap vertically sit on the same line.
        const sorted = [...textBoxes].sort((a, b) => a.top - b.top);
        const lines: { top: number; bottom: number }[] = [];
        for (const rect of sorted) {
          const last = lines.at(-1);
          const overlap = last ? Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top) : 0;
          if (last && overlap > Math.min(last.bottom - last.top, rect.height) * 0.5) {
            last.top = Math.min(last.top, rect.top);
            last.bottom = Math.max(last.bottom, rect.bottom);
          } else {
            lines.push({ top: rect.top, bottom: rect.bottom });
          }
        }
        const list = element.closest('ol, ul');
        return {
          role: element.getAttribute('data-moenarch-text') ?? '',
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
          display: getComputedStyle(element).display,
          box: toBox(element.getBoundingClientRect()),
          textBoxes: textBoxes.map(toBox),
          renderedLines: lines.length,
          scrollOverflow: element.scrollWidth - element.clientWidth,
          opacity: effectiveOpacity(element),
          emphasis: [...element.querySelectorAll('[data-moenarch-emphasis]')].map((node) =>
            (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
          listTag: list && scene.contains(list) ? list.tagName.toLowerCase() : null,
        };
      };
      const subtitle = root.querySelector('[data-moenarch-subtitle]');
      const signature = root.querySelector('[data-moenarch-signature]');
      return {
        kind: scene.getAttribute('data-moenarch-kind'),
        texts: [...scene.querySelectorAll<HTMLElement>('[data-moenarch-text]')].map(textInfo),
        media: [...scene.querySelectorAll<HTMLImageElement>('[data-moenarch-media]')].map((image) => ({
          alt: image.tagName === 'IMG' ? image.alt : '',
          path: image.tagName === 'IMG' ? new URL(image.currentSrc || image.src, document.baseURI).pathname : '',
          complete: image.tagName === 'IMG' && image.complete,
          naturalWidth: image.tagName === 'IMG' ? image.naturalWidth : 0,
          objectFit: getComputedStyle(image).objectFit,
          box: toBox(image.getBoundingClientRect()),
          opacity: effectiveOpacity(image),
        })),
        subtitle: subtitle ? toBox(subtitle.getBoundingClientRect()) : null,
        signature: signature ? toBox(signature.getBoundingClientRect()) : null,
        transformed: [root, ...root.querySelectorAll('*')].filter((element) => !isIdentity(getComputedStyle(element))).length,
      };
    },
    [sceneId, tokens.output.width] as const,
  );
}

const SLACK = 1;
const { safeArea, width: WIDTH, height: HEIGHT } = tokens.output;

function expectInSafeArea(box: Box, label: string) {
  expect(box.left, `${label} left`).toBeGreaterThanOrEqual(safeArea.left - SLACK);
  expect(box.top, `${label} top`).toBeGreaterThanOrEqual(safeArea.top - SLACK);
  expect(box.right, `${label} right`).toBeLessThanOrEqual(WIDTH - safeArea.right + SLACK);
  expect(box.bottom, `${label} bottom`).toBeLessThanOrEqual(HEIGHT - safeArea.bottom + SLACK);
}

/**
 * A text fragment is inside its element: fully across, and by its vertical centre (a glyph's
 * content area may be taller than a tight display line height without overflowing anything).
 */
const contains = (outer: Box, inner: Box) => {
  const middle = (inner.top + inner.bottom) / 2;
  return inner.left >= outer.left - SLACK && inner.right <= outer.right + SLACK && middle >= outer.top && middle <= outer.bottom;
};

const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > SLACK && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > SLACK;

const label = (sample: Sample) => `${sample.scene.id} @${sample.frame} (${sample.moment})`;

test('the gallery opens as a moenarch-short v1 composition covering every scene', async ({ page }) => {
  const errors = await open(page);
  const player = page.locator(`[data-composition-id="${PROJECT_ID}"]`);
  await expect(player).toHaveAttribute('data-width', '1080');
  await expect(player).toHaveAttribute('data-height', '1920');
  await expect(player).toHaveAttribute('data-fps', '30');
  await expect(player).toHaveAttribute('data-duration-in-frames', String(plan.durationInFrames));
  await expect(page.locator('[data-moenarch-root]')).toHaveAttribute('data-format', 'moenarch-short');
  expect(plan.scenes.map((scene) => scene.id)).toEqual(spec.scenes.map((scene) => scene.id));
  expect(errors).toEqual([]);
});

test('every archetype draws its planned text and media, settled and fully visible', async ({ page }) => {
  const errors = await open(page);
  for (const sample of samples().filter((candidate) => candidate.moment === 'settled')) {
    const name = label(sample);
    await seek(page, sample.frame);
    const dom = await sceneDom(page, sample.scene.id);
    expect(dom, name).not.toBeNull();
    const { layout } = sample.scene;
    const payload = spec.scenes.find((scene) => scene.id === sample.scene.id)!.payload as Record<string, unknown>;
    expect(dom!.kind, name).toBe(sample.scene.kind);
    expect(
      dom!.texts.map((text) => [text.role, text.text]),
      name,
    ).toEqual(layout.blocks.map((block) => [block.role, block.text.replace(/\s+/g, ' ').trim()]));
    dom!.texts.forEach((text, index) => {
      const block = layout.blocks[index];
      expect(text.opacity, `${name} ${text.role} opacity`).toBeCloseTo(1, 3);
      expect(text.display, `${name} ${text.role} display`).not.toBe('inline');
      expect(text.renderedLines, `${name} ${text.role}: rendered lines vs planned ${JSON.stringify(block.lines)}`).toBe(block.lines.length);
    });
    if (sample.scene.kind === 'statement' && typeof payload.emphasis === 'string') {
      expect(dom!.texts.flatMap((text) => text.emphasis), name).toEqual([payload.emphasis]);
    }
    if (sample.scene.kind === 'list') {
      const items = payload.items as string[];
      const itemTexts = dom!.texts.filter((text) => items.includes(text.text));
      expect(itemTexts.length, name).toBe(items.length);
      for (const item of itemTexts) expect(item.listTag, `${name} ${item.text}`).toBe(payload.ordered ? 'ol' : 'ul');
    }
    if (layout.media) {
      expect(dom!.media, name).toHaveLength(1);
      const [media] = dom!.media;
      expect(media.alt, name).toBe(layout.media.alt);
      expect(media.path.endsWith(`/${layout.media.staticPath}`), `${name} src ${media.path}`).toBe(true);
      expect(media.complete && media.naturalWidth > 0, `${name} image loaded`).toBe(true);
      expect(media.objectFit, name).toBe(tokens.media.fit);
      expect(media.box.right - media.box.left, name).toBeGreaterThan(0);
      expect(media.opacity, `${name} media opacity`).toBeCloseTo(1, 3);
    } else {
      expect(dom!.media, name).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});

test('text stays inside the safe area and its own box, clear of subtitles and the signature', async ({ page }) => {
  const errors = await open(page);
  let subtitlesChecked = 0;
  let textsChecked = 0;
  for (const sample of samples()) {
    const name = label(sample);
    await seek(page, sample.frame);
    const dom = await sceneDom(page, sample.scene.id);
    expect(dom, name).not.toBeNull();
    for (const text of dom!.texts) {
      const where = `${name} ${text.role} "${text.text.slice(0, 24)}"`;
      expectInSafeArea(text.box, where);
      for (const fragment of text.textBoxes) {
        expect(contains(text.box, fragment), `${where}: text overflows its box`).toBe(true);
      }
      expect(text.scrollOverflow, `${where}: horizontal scroll overflow`).toBeLessThanOrEqual(SLACK);
      // Vertical overflow is checked by line count and fragment centres instead of scrollHeight:
      // tight display line heights make glyph content areas count as scrollable overflow.
      if (dom!.signature) expect(overlaps(text.box, dom!.signature), `${where}: overlaps the signature`).toBe(false);
      if (dom!.subtitle) {
        expect(overlaps(text.box, dom!.subtitle), `${where}: overlaps the subtitle`).toBe(false);
        subtitlesChecked += 1;
      }
      textsChecked += 1;
    }
  }
  // The long scenes are narrated, so text and subtitles were on screen together.
  expect(subtitlesChecked).toBeGreaterThan(0);
  expect(textsChecked).toBeGreaterThan(plan.scenes.length * 2);
  expect(errors).toEqual([]);
});

/** The composition DOM as text (see moenarch-short.spec.ts): elements, attributes, sorted inline styles, text. */
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

test('archetype frames render identically when reached from another frame', async ({ page }) => {
  await open(page);
  const frames = samples().filter((sample) => sample.moment !== 'settled');
  const first = new Map<number, string>();
  for (const { frame } of frames) {
    await seek(page, frame);
    first.set(frame, await page.locator('[data-moenarch-root]').evaluate(serializeFrame));
  }
  for (const sample of [...frames].reverse()) {
    await seek(page, sample.frame);
    expect(await page.locator('[data-moenarch-root]').evaluate(serializeFrame), label(sample)).toBe(first.get(sample.frame));
  }
});

test('under reduced motion the archetypes move nothing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  await expect(page.locator('[data-moenarch-root]')).toHaveAttribute('data-reduced-motion', 'true');
  for (const sample of samples()) {
    await seek(page, sample.frame);
    const dom = await sceneDom(page, sample.scene.id);
    expect(dom, label(sample)).not.toBeNull();
    expect(dom!.transformed, `${label(sample)}: transformed elements`).toBe(0);
  }
  expect(errors).toEqual([]);
});
