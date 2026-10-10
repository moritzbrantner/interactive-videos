// Acceptance for issue #13 (editorial scene archetypes), written before the implementation.
//
// Contract for the implementer (see also scenes.architecture.test.ts, e2e/moenarch-scene-gallery.spec.ts,
// e2e/moenarch-scene-budget.spec.ts and src/spec/video-spec-archetypes.test.ts):
//
// - `src/formats/moenarch-short/layout.ts` (plain TypeScript, no React/Remotion) exports
//     layoutMoenarchScene(scene: Scene, tokens: MoenarchShortTokens, assets: readonly AssetRef[]): MoenarchSceneLayout
//   with
//     MoenarchTextBlock = { role: string; text: string; lines: string[]; maxCharsPerLine: number; maxLines: number }
//     MoenarchSceneMedia = { assetId: string; staticPath: string; alt: string }
//     MoenarchSceneLayout = { kind: SceneKind; blocks: MoenarchTextBlock[]; media: MoenarchSceneMedia | null }
//   `blocks` are every visible text of the scene in reading order (an `alt` text is not visible).
//   These types may carry further fields (e.g. a statement's emphasis or a list's ordering).
//   `lines` is the deterministic greedy word wrap of `text` at `maxCharsPerLine`; the limits come
//   from the format tokens (the title heading uses `tokens.typography.density`).
// - Fit rule, the same for every archetype: text is wrapped, never truncated, shrunk or ellipsized.
//   Text that needs more than `maxLines` lines, a word longer than a line, or more list items than
//   the format allows makes the scene unrenderable: `layoutMoenarchScene` and `planMoenarchShort`
//   throw naming the scene id, and the catalog reports `unrenderable`.
// - Media: an `image` asset whose uri is `static:<path>` is served from `public/<path>`
//   (`staticPath` = `<path>`); any other uri scheme is unrenderable in this format.
// - `planMoenarchShort(spec)` accepts every archetype kind (and still refuses `binnedChart`); each
//   plan scene carries `kind` and `layout`, equal to `layoutMoenarchScene(scene, tokens, spec.assets)`.
//   Layout is computed there, once, never in per-frame code.
// - `src/projects.ts` registers `src/spec/fixtures/moenarch-scene-gallery.videospec.json`
//   (project `moenarch-scene-gallery`, "Moenarch scene gallery") with `moenarchShort()`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { layoutMoenarchScene } from '@/formats/moenarch-short/layout';
import { moenarchFrameState, planMoenarchShort } from '@/formats/moenarch-short/plan';
import { moenarchShortV1Tokens as tokens } from '@/formats/moenarch-short/tokens';
import { catalog } from '@/projects';
import galleryFixture from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';
import specimenFixture from '@/spec/fixtures/moenarch-specimen.videospec.json';
import { assertVideoSpec, resolveTimeline, type Scene, type VideoSpec } from '@/spec/video-spec';

const GALLERY_ID = 'moenarch-scene-gallery';
const ROOT = join(import.meta.dirname, '..', '..', '..');
const clone = <T,>(value: T): T => structuredClone(value);
const gallery = () => assertVideoSpec(clone(galleryFixture));

type Block = { role: string; text: string; lines: string[]; maxCharsPerLine: number; maxLines: number };
type Layout = { kind: string; blocks: Block[]; media: { assetId: string; staticPath: string; alt: string } | null };
type Dict = Record<string, any>;

/** The archetype of each gallery scene id prefix, and its VideoSpec kind. */
const ARCHETYPES: [string, string][] = [
  ['title', 'title'],
  ['statement', 'statement'],
  ['media-reveal', 'mediaReveal'],
  ['comparison', 'comparison'],
  ['quote', 'quote'],
  ['data-point', 'dataPoint'],
  ['list', 'list'],
  ['conclusion', 'conclusion'],
];

const layoutOf = (scene: unknown, spec: VideoSpec = gallery()) =>
  layoutMoenarchScene(scene as Scene, tokens, spec.assets) as unknown as Layout;

const words = (text: string) => text.trim().split(/\s+/);

/** Payload text fields a viewer reads, as [path, text], in reading order. */
function visibleTexts(scene: Dict): [string, string][] {
  const p = scene.payload as Dict;
  const optional = (key: string): [string, string][] => (p[key] === undefined ? [] : [[key, p[key]]]);
  switch (scene.kind) {
    case 'title':
      return [...optional('eyebrow'), ['heading', p.heading]];
    case 'statement':
      return [...optional('eyebrow'), ['text', p.text]];
    case 'mediaReveal':
      return optional('caption');
    case 'comparison':
      return [
        ...optional('heading'),
        ...(p.items as Dict[]).flatMap((item, index): [string, string][] => [
          [`items.${index}.label`, item.label],
          [`items.${index}.detail`, item.detail],
        ]),
      ];
    case 'quote':
      return [['text', p.text], ...optional('attribution')];
    case 'dataPoint':
      return [['value', p.value], ['label', p.label], ...optional('context')];
    case 'list':
      return [...optional('heading'), ...(p.items as string[]).map((item, index): [string, string] => [`items.${index}`, item])];
    case 'conclusion':
      return [['heading', p.heading], ...optional('takeaway')];
    default:
      throw new Error(`not an archetype: ${scene.kind}`);
  }
}

function setPath(target: Dict, path: string, value: string) {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((node, key) => node[key], target);
  parent[last] = value;
}

/** Text that fills a block exactly: maxLines words of maxCharsPerLine letters. */
const atCapacity = (block: Block) => Array.from({ length: block.maxLines }, () => 'x'.repeat(block.maxCharsPerLine)).join(' ');

describe('moenarch scene gallery fixture', () => {
  it('has every archetype at a short and a long content size, in archetype order', () => {
    const spec = gallery();
    expect(spec.project).toEqual({ id: GALLERY_ID, title: 'Moenarch scene gallery' });
    expect(spec.format).toEqual({ id: 'moenarch-short', version: 1 });
    expect(spec.scenes.map((scene) => [scene.id, scene.kind])).toEqual(
      ARCHETYPES.flatMap(([prefix, kind]) => [
        [`${prefix}-short`, kind],
        [`${prefix}-long`, kind],
      ]),
    );
  });

  it('commits the media fixture image its static uri points at', () => {
    const spec = gallery();
    expect(spec.assets).toEqual([{ id: 'gallery-media', kind: 'image', uri: 'static:fixtures/scene-gallery/media-reveal.png' }]);
    expect(existsSync(join(ROOT, 'public', 'fixtures', 'scene-gallery', 'media-reveal.png'))).toBe(true);
  });

  it('is registered in the catalog and resolves to a portrait composition', () => {
    expect(catalog.projects).toContainEqual({ id: GALLERY_ID, title: 'Moenarch scene gallery' });
    const result = catalog.resolve(GALLERY_ID);
    if (!result.ok) throw new Error(result.message);
    const { component, renderInsight, ...metadata } = result.composition;
    expect(metadata).toEqual({
      id: GALLERY_ID,
      title: 'Moenarch scene gallery',
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: resolveTimeline(gallery()).durationInFrames,
    });
    expect(component).toBeTypeOf('function');
    expect(renderInsight).toBeUndefined();
  });
});

describe('moenarch scene layout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is planned once per scene: every gallery scene has its kind and layout in the plan', () => {
    const spec = gallery();
    const plan = planMoenarchShort(spec) as unknown as { scenes: (Dict & { layout: Layout })[] };
    const timeline = resolveTimeline(spec);
    expect(plan.scenes.map(({ id, kind, from, durationInFrames }) => ({ id, kind, from, durationInFrames }))).toEqual(
      timeline.scenes.map(({ id, kind, from, durationInFrames }) => ({ id, kind, from, durationInFrames })),
    );
    spec.scenes.forEach((scene, index) => {
      expect(plan.scenes[index].layout, scene.id).toEqual(layoutOf(scene, spec));
    });
  });

  it('shows every visible payload text exactly once, wrapped and never truncated', () => {
    const spec = gallery();
    for (const scene of spec.scenes) {
      const layout = layoutOf(scene, spec);
      expect(layout.kind, scene.id).toBe(scene.kind);
      expect(layout.blocks.map((block) => block.text), scene.id).toEqual(visibleTexts(scene).map(([, text]) => text));
      for (const block of layout.blocks) {
        const label = `${scene.id} ${block.role}`;
        expect(block.role, label).toMatch(/^[a-z][a-z-]*$/);
        expect(Number.isInteger(block.maxCharsPerLine) && block.maxCharsPerLine > 0, label).toBe(true);
        expect(Number.isInteger(block.maxLines) && block.maxLines > 0, label).toBe(true);
        expect(block.lines.length, label).toBeGreaterThan(0);
        expect(block.lines.length, label).toBeLessThanOrEqual(block.maxLines);
        for (const line of block.lines) {
          expect(line.length, `${label}: "${line}"`).toBeLessThanOrEqual(block.maxCharsPerLine);
          expect(line, label).toBe(line.trim());
        }
        // No word is dropped, cut or reordered.
        expect(block.lines.flatMap(words), label).toEqual(words(block.text));
      }
    }
  });

  it('wraps greedily: each line takes as many words as fit', () => {
    for (const scene of gallery().scenes) {
      for (const block of layoutOf(scene).blocks) {
        block.lines.slice(0, -1).forEach((line, index) => {
          const nextWord = words(block.lines[index + 1])[0];
          expect(`${line} ${nextWord}`.length, `${scene.id} ${block.role} line ${index}`).toBeGreaterThan(block.maxCharsPerLine);
        });
      }
    }
  });

  it('wraps the title heading with the format headline density', () => {
    for (const scene of gallery().scenes.filter((candidate) => candidate.kind === 'title')) {
      const heading = layoutOf(scene).blocks.find((block) => block.role === 'heading');
      expect(heading, scene.id).toBeDefined();
      expect({ maxCharsPerLine: heading!.maxCharsPerLine, maxLines: heading!.maxLines }).toEqual(tokens.typography.density);
    }
  });

  it('makes the long variants genuinely long: more lines than the short one, near a block limit', () => {
    const spec = gallery();
    for (const [prefix] of ARCHETYPES) {
      const short = layoutOf(spec.scenes.find((scene) => scene.id === `${prefix}-short`), spec);
      const long = layoutOf(spec.scenes.find((scene) => scene.id === `${prefix}-long`), spec);
      const lines = (layout: Layout) => layout.blocks.reduce((sum, block) => sum + block.lines.length, 0);
      expect(lines(long), prefix).toBeGreaterThan(lines(short));
      expect(long.blocks.some((block) => block.lines.length >= 2), prefix).toBe(true);
      // At least one block of the long variant uses half or more of its character capacity.
      const fullest = Math.max(...long.blocks.map((block) => block.text.length / (block.maxCharsPerLine * block.maxLines)));
      expect(fullest, prefix).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('resolves the media reveal image to its static path and alt text', () => {
    const spec = gallery();
    for (const scene of spec.scenes) {
      const layout = layoutOf(scene, spec);
      if (scene.kind === 'mediaReveal') {
        expect(layout.media, scene.id).toEqual({
          assetId: 'gallery-media',
          staticPath: 'fixtures/scene-gallery/media-reveal.png',
          alt: (scene.payload as Dict).alt,
        });
      } else {
        expect(layout.media, scene.id).toBeNull();
      }
    }
  });

  it('is pure and deterministic: plain data, same result twice, no clock or randomness', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random in scene layout');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now in scene layout');
    });
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now in scene layout');
    });
    const spec = gallery();
    const first = spec.scenes.map((scene) => layoutOf(scene, spec));
    expect(spec.scenes.map((scene) => layoutOf(clone(scene), spec))).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    const plan = planMoenarchShort(spec);
    expect(planMoenarchShort(gallery())).toEqual(plan);
    // Frame state over the whole gallery is the same forwards and backwards.
    const frames = Array.from({ length: plan.durationInFrames }, (_, frame) => frame);
    const forward = frames.map((frame) => moenarchFrameState(plan, frame, { reducedMotion: false }));
    const backward = [...frames].reverse().map((frame) => moenarchFrameState(plan, frame, { reducedMotion: false })).reverse();
    expect(backward).toEqual(forward);
  });

  it('does not mutate the scene or the tokens it lays out', () => {
    const spec = gallery();
    const before = JSON.stringify(spec);
    const tokensBefore = JSON.stringify(tokens);
    for (const scene of spec.scenes) layoutOf(scene, spec);
    planMoenarchShort(spec);
    expect(JSON.stringify(spec)).toBe(before);
    expect(JSON.stringify(tokens)).toBe(tokensBefore);
  });
});

describe('moenarch scene fit rule: wrap within token limits, otherwise unrenderable', () => {
  it('fits text that fills a block exactly, and refuses one more word or an over-long word', () => {
    const spec = gallery();
    let checked = 0;
    for (const scene of spec.scenes) {
      const layout = layoutOf(scene, spec);
      visibleTexts(scene).forEach(([path], index) => {
        const block = layout.blocks[index];
        const label = `${scene.id} ${path}`;
        const variant = (text: string) => {
          const edited = clone(scene) as Dict;
          setPath(edited.payload, path, text);
          // Keep a statement's emphasis inside its edited text.
          if (edited.kind === 'statement' && path === 'text' && edited.payload.emphasis !== undefined) {
            edited.payload.emphasis = words(text)[0];
          }
          return edited;
        };

        const full = layoutOf(variant(atCapacity(block)), spec).blocks[index];
        expect(full.lines.length, label).toBe(block.maxLines);
        expect({ maxCharsPerLine: full.maxCharsPerLine, maxLines: full.maxLines }, label).toEqual({
          maxCharsPerLine: block.maxCharsPerLine,
          maxLines: block.maxLines,
        });

        expect(() => layoutOf(variant(`${atCapacity(block)} x`), spec), `${label}: one word too many`).toThrow(scene.id);
        expect(() => layoutOf(variant('x'.repeat(block.maxCharsPerLine + 1)), spec), `${label}: word wider than a line`).toThrow(
          scene.id,
        );
        checked += 1;
      });
    }
    // Every text field of every archetype was exercised.
    expect(checked).toBe(gallery().scenes.reduce((sum, scene) => sum + visibleTexts(scene).length, 0));
  });

  it('reports overlong text and over-long lists as unrenderable in the catalog, per archetype', () => {
    for (const [prefix, kind] of ARCHETYPES) {
      const spec = clone(galleryFixture) as Dict;
      const index = spec.scenes.findIndex((scene: Dict) => scene.id === `${prefix}-long`);
      const scene = spec.scenes[index];
      const [path] = visibleTexts(scene).at(-1)!;
      setPath(scene.payload, path, 'overlong '.repeat(80).trim());
      // The spec stays valid: a statement's emphasis must occur in its text.
      if (scene.kind === 'statement' && path === 'text') scene.payload.emphasis = 'overlong';
      const result = createCatalog([{ spec, format: moenarchShort() }], GALLERY_ID).resolve(GALLERY_ID);
      expect(result, `${kind} ${path}`).toMatchObject({ ok: false, reason: 'unrenderable' });
      expect(!result.ok && result.message, kind).toContain(`${prefix}-long`);
    }
    const list = clone(galleryFixture) as Dict;
    const listScene = list.scenes.find((scene: Dict) => scene.id === 'list-long');
    listScene.payload.items = Array.from({ length: 40 }, (_, index) => `Step ${index + 1}`);
    const result = createCatalog([{ spec: list, format: moenarchShort() }], GALLERY_ID).resolve(GALLERY_ID);
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
    expect(!result.ok && result.message).toContain('list-long');
  });

  it('refuses media whose uri this format cannot serve', () => {
    for (const uri of ['https://example.com/a.png', 'file:media-reveal.png', 'generator:image?seed=1', 'static:']) {
      const spec = clone(galleryFixture) as Dict;
      spec.assets[0].uri = uri;
      const result = createCatalog([{ spec, format: moenarchShort() }], GALLERY_ID).resolve(GALLERY_ID);
      expect(result, uri).toMatchObject({ ok: false, reason: 'unrenderable' });
    }
  });

  it('still renders the #12 specimen and still refuses chart scenes', () => {
    expect(() => planMoenarchShort(assertVideoSpec(specimenFixture))).not.toThrow();
    const withChart = clone(galleryFixture) as Dict;
    withChart.assets.push({ id: 'data', kind: 'dataset', uri: 'generator:latency-requests?seed=1&count=10' });
    withChart.scenes.push({
      kind: 'binnedChart',
      id: 'chart',
      durationInFrames: 90,
      payload: { heading: 'Chart', dataset: 'data', bins: 4, metric: 'p95', inspectable: false },
    });
    expect(() => planMoenarchShort(assertVideoSpec(withChart))).toThrow('chart');
  });
});
