// Acceptance for issue #38: text must fit its content width, not only its character count.
//
// `layoutMoenarchScene` wraps at `maxCharsPerLine`, and every planned line renders with
// `white-space: nowrap`. A line of wide glyphs can pass the character limit and still be wider
// than the content frame. These tests only use the public seams (`layoutMoenarchScene` throwing
// for an unrenderable scene, and the catalog's `resolve` reporting `unrenderable`), not the name
// of the new width estimate.
//
// Pixel facts from the v1 tokens:
// - Content width = output.width - safeArea.left - safeArea.right = 1080 - 96 - 144 = 840 px.
//   `scenes.inset` only insets top and bottom, so every block gets the full 840 px.
// - The title heading uses the `headline` style (96 px display serif) at `typography.density`
//   (14 characters, 3 lines).
// - A conservative *lower* bound for glyph advances: "W" is at least 0.9 em in every display
//   serif of the font stack (Iowan Old Style, Palatino, Book Antiqua, Georgia are ~0.95-1.0 em),
//   and a CJK ideograph is a full-width 1 em glyph in any CJK fallback font. The style's
//   letterSpacing (em, may be negative) is added per glyph. Every other glyph counts as 0, so the
//   bound never overstates a line.
// - 14 x "W" at 96 px: 14 x (0.9 - 0.012) x 96 = 1193 px > 840 px. 14 x "漢": 14 x 0.988 x 96 =
//   1328 px > 840 px. Both pass the 14-character limit today, so both render as one overflowing
//   line. 14 x "i" (~0.3 em, ~400 px) fits easily, which is the control.
//
// Contract pinned: a block either fails closed (the scene is unrenderable) or every planned line's
// lower-bound width fits the content width. The existing gallery e2e
// (e2e/moenarch-scene-gallery.spec.ts) still has to show every planned line inside its box; it is
// not re-run here.
import { describe, expect, it } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { layoutMoenarchScene } from '@/formats/moenarch-short/layout';
import { moenarchShortV1Tokens as tokens } from '@/formats/moenarch-short/tokens';
import galleryFixture from '@/spec/fixtures/moenarch-scene-gallery.videospec.json';
import { assertVideoSpec, type Scene } from '@/spec/video-spec';

const GALLERY_ID = 'moenarch-scene-gallery';
type Dict = Record<string, any>;
type Block = { role: string; lines: string[]; style: keyof typeof tokens.scenes.text };
type Outcome = { renderable: false; message: string } | { renderable: true; blocks: Block[] };

const CONTENT_WIDTH = tokens.output.width - tokens.output.safeArea.left - tokens.output.safeArea.right;
const W_MIN_EM = 0.9;
const CJK_MIN_EM = 1;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

/** A lower bound of a line's rendered width in px at its style; never larger than the real width. */
function minLineWidth(line: string, style: Block['style']): number {
  const { size, letterSpacing, uppercase } = tokens.scenes.text[style];
  const text = uppercase ? line.toUpperCase() : line;
  let em = 0;
  for (const glyph of text) {
    if (glyph === 'W') em += W_MIN_EM + letterSpacing;
    else if (CJK.test(glyph)) em += CJK_MIN_EM + letterSpacing;
  }
  return em * size;
}

/** The gallery with `scene id`'s payload `field` set to `text`. */
function galleryWith(sceneId: string, field: string, text: string): Dict {
  const spec = structuredClone(galleryFixture) as Dict;
  const scene = spec.scenes.find((candidate: Dict) => candidate.id === sceneId);
  scene.payload[field] = text;
  if (scene.kind === 'statement' && field === 'text' && scene.payload.emphasis !== undefined) {
    scene.payload.emphasis = [...text][0];
  }
  return spec;
}

function layoutOutcome(sceneId: string, field: string, text: string): Outcome {
  const spec = assertVideoSpec(galleryWith(sceneId, field, text));
  const scene = spec.scenes.find((candidate) => candidate.id === sceneId)!;
  try {
    const layout = layoutMoenarchScene(scene as Scene, tokens, spec.assets) as unknown as { blocks: Block[] };
    return { renderable: true, blocks: layout.blocks };
  } catch (error) {
    return { renderable: false, message: String(error) };
  }
}

function catalogResult(sceneId: string, field: string, text: string) {
  return createCatalog([{ spec: galleryWith(sceneId, field, text), format: moenarchShort() }], GALLERY_ID).resolve(GALLERY_ID);
}

/** Every planned line of every block fits the content width, by the lower bound. */
function expectEveryLineFits(outcome: Outcome, label: string) {
  if (!outcome.renderable) return;
  for (const block of outcome.blocks) {
    for (const line of block.lines) {
      expect(minLineWidth(line, block.style), `${label}: ${block.role} line "${line}" at ${block.style}`).toBeLessThanOrEqual(
        CONTENT_WIDTH,
      );
    }
  }
}

// Samples that pass today's character and line limits but overflow 840 px as planned today.
const OVERFLOWING: { label: string; sceneId: string; field: string; text: string }[] = [
  // One unbreakable word of 14 W at the 96 px headline: no space to wrap at, so it must fail.
  { label: 'title heading, 14 x W', sceneId: 'title-short', field: 'heading', text: 'W'.repeat(14) },
  // 14 ideographs at the headline, no spaces: unrenderable, or broken between ideographs.
  { label: 'title heading, 14 x CJK', sceneId: 'title-short', field: 'heading', text: '漢'.repeat(14) },
  // Two W words in 14 characters: one line today (1104 px); must wrap at the space or fail.
  { label: 'title heading, WWWW WWWWWWWWW', sceneId: 'title-short', field: 'heading', text: 'WWWW WWWWWWWWW' },
  // Statement style, 72 px, 18 characters: 18 x W = 1151 px, 18 x CJK = 1283 px.
  { label: 'statement, 18 x W', sceneId: 'statement-short', field: 'text', text: 'W'.repeat(18) },
  { label: 'statement, 18 x CJK', sceneId: 'statement-short', field: 'text', text: '漢'.repeat(18) },
  // Heading style, 60 px, 22 characters: 22 x W = 1177 px.
  { label: 'comparison heading, 22 x W', sceneId: 'comparison-long', field: 'heading', text: 'W'.repeat(22) },
];

describe('moenarch text width (#38): wide glyphs wrap or make the scene unrenderable', () => {
  it('the samples pass the character limits, and would overflow the content width as one line', () => {
    expect(CONTENT_WIDTH).toBe(840);
    expect(minLineWidth('W'.repeat(14), 'headline')).toBeGreaterThan(CONTENT_WIDTH);
    expect(minLineWidth('漢'.repeat(14), 'headline')).toBeGreaterThan(CONTENT_WIDTH);
    expect(tokens.typography.density.maxCharsPerLine).toBeGreaterThanOrEqual(14);
  });

  for (const sample of OVERFLOWING) {
    it(`${sample.label}: unrenderable, or every planned line fits ${CONTENT_WIDTH} px`, () => {
      const outcome = layoutOutcome(sample.sceneId, sample.field, sample.text);
      if (!outcome.renderable) expect(outcome.message).toContain(sample.sceneId);
      expectEveryLineFits(outcome, sample.label);
    });
  }

  it('an unbreakable 14 x W or 14 x CJK headline is reported unrenderable by the catalog', () => {
    // A single 14-glyph word cannot wrap at a space; at >= 0.888 em per glyph even a split into
    // lines must keep each line at most floor(840 / 85.2) = 9 glyphs. For W there is no break
    // opportunity, so the only correct outcome is unrenderable.
    const result = catalogResult('title-short', 'heading', 'W'.repeat(14));
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
    expect(!result.ok && result.message).toContain('title-short');

    const cjk = catalogResult('title-short', 'heading', '漢'.repeat(14));
    if (cjk.ok) {
      // Breaking between ideographs is allowed; then every line must fit.
      expectEveryLineFits(layoutOutcome('title-short', 'heading', '漢'.repeat(14)), 'catalog CJK');
    } else {
      expect(cjk).toMatchObject({ ok: false, reason: 'unrenderable' });
    }
  });

  it('control: narrow and ordinary text of the same character counts stays renderable on one line', () => {
    const controls: [string, string, string][] = [
      ['title-short', 'heading', 'i'.repeat(14)],
      ['title-short', 'heading', 'Eight scenes'],
      ['statement-short', 'text', 'Decide it once.'],
      ['conclusion-short', 'heading', "That's all, folks"],
      ['comparison-long', 'heading', 'Two ways to make one'],
    ];
    for (const [sceneId, field, text] of controls) {
      const outcome = layoutOutcome(sceneId, field, text);
      expect(outcome.renderable, `${sceneId} "${text}"`).toBe(true);
      if (outcome.renderable) expect(outcome.blocks.find((block) => block.lines.join(' ') === text)?.lines).toEqual([text]);
      expect(catalogResult(sceneId, field, text), `${sceneId} "${text}"`).toMatchObject({ ok: true });
    }
  });

  it('control: the unmodified scene gallery stays renderable', () => {
    const result = createCatalog([{ spec: structuredClone(galleryFixture), format: moenarchShort() }], GALLERY_ID).resolve(GALLERY_ID);
    expect(result).toMatchObject({ ok: true });
  });
});
