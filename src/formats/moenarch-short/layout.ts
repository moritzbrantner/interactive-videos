// moenarch-short scene layout: which text blocks a scene draws and how each one wraps. Plain
// TypeScript with no React or Remotion. The plan calls it once per scene, so frame code only draws
// the planned lines.
//
// Fit rule, the same for every archetype: text wraps greedily at its block's characters per line
// and at its box width, estimated per glyph from the token advance classes (no DOM measurement),
// and is never truncated, shrunk or ellipsized. More lines than the block allows, a word longer
// or wider than a line or more list items than the format allows make the scene unrenderable,
// and `layoutMoenarchScene` throws naming the scene.
import type { AssetRef, Scene, SceneKind } from '@/spec/video-spec';

import type { MoenarchShortTokens } from './tokens';

type Tokens = MoenarchShortTokens['scenes'];
export type MoenarchTextStyleName = keyof Tokens['text'];

/** A run of a planned line; `emphasis` runs are drawn in the accent. */
export type MoenarchTextRun = { text: string; emphasis: boolean };

export type MoenarchTextBlock = {
  role: string;
  text: string;
  /** The greedy word wrap of `text` at `maxCharsPerLine`. */
  lines: string[];
  maxCharsPerLine: number;
  maxLines: number;
  style: MoenarchTextStyleName;
  /** Each planned line as runs, when part of it is emphasized (a statement's emphasis). */
  runs: MoenarchTextRun[][] | null;
};

export type MoenarchSceneMedia = { assetId: string; staticPath: string; alt: string };

export type MoenarchSceneLayout = {
  kind: SceneKind;
  blocks: MoenarchTextBlock[];
  media: MoenarchSceneMedia | null;
  /** Whether a list scene numbers its items. */
  ordered: boolean;
};

/** Greedy word wrap; null when a single word is longer (or wider) than a line. */
export function wrapText(text: string, maxChars: number, fits: (line: string) => boolean = () => true): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    if (word.length > maxChars || !fits(word)) return null;
    const joined = `${line} ${word}`;
    if (!line) line = word;
    else if (joined.length <= maxChars && fits(joined)) line = joined;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type GlyphAdvance = MoenarchShortTokens['scenes']['glyphAdvance'];
type GlyphClass = keyof GlyphAdvance;

const NARROW = new Set("iIjltf.,:;'!|()[]{}`-".split(''));
const WIDE = new Set('WM@%&'.split(''));
const LOWER_WIDE = new Set('mw'.split(''));
const UPPER_NARROW = new Set('BEFJKLPSTXYZ'.split(''));

// Combining marks, variation selectors and zero-width format characters have no advance of their
// own: they render as part of the preceding glyph.
const ZERO_ADVANCE = /^[\p{Mn}\p{Me}\u200b-\u200d\u2060\ufeff\ufe00-\ufe0f]$/u;

function glyphClass(glyph: string): GlyphClass | null {
  if (ZERO_ADVANCE.test(glyph)) return null;
  const code = glyph.codePointAt(0)!;
  if (/\s/.test(glyph)) return 'space';
  if (code < 0x80) {
    if (WIDE.has(glyph)) return 'wide';
    if (LOWER_WIDE.has(glyph)) return 'lowerWide';
    if (NARROW.has(glyph)) return 'narrow';
    if (/[0-9]/.test(glyph)) return 'digit';
    if (UPPER_NARROW.has(glyph)) return 'upperNarrow';
    if (/[A-Z]/.test(glyph)) return 'upper';
    if (/[a-z]/.test(glyph)) return 'lower';
    return 'upper';
  }
  // Latin-1 and Latin Extended letters (accented forms) are bounded like capitals.
  if (code >= 0xc0 && code <= 0x24f) return 'upper';
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 'fullwidth';
  }
  return 'unknown';
}

/**
 * A conservative estimate of a line's rendered width in pixels at a text style: per-glyph advance
 * classes from the tokens plus the style's letter spacing. Pure; never measures the DOM.
 */
export function estimateLineWidth(line: string, tokens: MoenarchShortTokens, styleName: MoenarchTextStyleName): number {
  const style = tokens.scenes.text[styleName];
  const advance = tokens.scenes.glyphAdvance;
  const text = style.uppercase ? line.toUpperCase() : line;
  let em = 0;
  for (const glyph of text) {
    const kind = glyphClass(glyph);
    if (kind !== null) em += advance[kind] + style.letterSpacing;
  }
  return em * style.size;
}

/** The content frame's width: the safe area's width. */
export function contentWidth(tokens: MoenarchShortTokens): number {
  const { width, safeArea } = tokens.output;
  return width - safeArea.left - safeArea.right;
}

/** Splits planned lines into runs around the first occurrence of `phrase` (whitespace-collapsed). */
function emphasisRuns(lines: string[], phrase: string): MoenarchTextRun[][] | null {
  const needle = phrase.trim().split(/\s+/).join(' ');
  // Planned lines joined by single spaces are the whitespace-collapsed text.
  const start = lines.join(' ').indexOf(needle);
  if (!needle || start < 0) return null;
  const end = start + needle.length;
  let offset = 0;
  return lines.map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    const from = Math.max(start, lineStart) - lineStart;
    const to = Math.min(end, lineStart + line.length) - lineStart;
    if (to <= from) return [{ text: line, emphasis: false }];
    return [
      { text: line.slice(0, from), emphasis: false },
      { text: line.slice(from, to), emphasis: true },
      { text: line.slice(to), emphasis: false },
    ].filter((run) => run.text);
  });
}

const STATIC_URI = /^static:(.+)$/;

/** The `public/` path of a `static:` uri, or null for any other uri or an unsafe path. */
export function staticPath(uri: string): string | null {
  const path = STATIC_URI.exec(uri)?.[1];
  // Percent escapes are refused outright: the browser would decode `%2e%2e` or `%2f` while
  // resolving the image URL, so an encoded segment could leave `public/`.
  if (!path || /[\\?#%]/.test(path) || path.startsWith('/')) return null;
  const segments = path.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..') ? path : null;
}

/**
 * Lays out one scene for the format: its visible text blocks in reading order, wrapped by the
 * token densities, and its media. Throws, naming the scene, for anything the format cannot draw.
 */
export function layoutMoenarchScene(
  scene: Scene,
  tokens: MoenarchShortTokens,
  assets: readonly AssetRef[],
): MoenarchSceneLayout {
  const { archetypes } = tokens.scenes;
  const blocks: MoenarchTextBlock[] = [];
  const width = contentWidth(tokens);
  const fail = (problem: string): never => {
    throw new Error(`${scene.id}: ${problem}`);
  };
  const block = (
    role: string,
    text: string,
    fit: { style: MoenarchTextStyleName; maxCharsPerLine: number; maxLines: number },
    emphasis?: string,
    boxWidth = width,
  ) => {
    const lines = wrapText(text, fit.maxCharsPerLine, (line) => estimateLineWidth(line, tokens, fit.style) <= boxWidth);
    if (!lines || !lines.length || lines.length > fit.maxLines) {
      fail(
        `${role} needs more than ${fit.maxLines} line${fit.maxLines === 1 ? '' : 's'} of ${fit.maxCharsPerLine} characters within ${boxWidth}px`,
      );
    }
    blocks.push({
      role,
      text,
      lines: lines!,
      maxCharsPerLine: fit.maxCharsPerLine,
      maxLines: fit.maxLines,
      style: fit.style,
      runs: emphasis === undefined ? null : emphasisRuns(lines!, emphasis),
    });
  };
  const optional = (role: string, text: string | undefined, fit: Parameters<typeof block>[2]) => {
    if (text !== undefined) block(role, text, fit);
  };

  let media: MoenarchSceneMedia | null = null;
  let ordered = false;
  switch (scene.kind) {
    case 'title': {
      const fit = archetypes.title;
      optional('eyebrow', scene.payload.eyebrow, fit.eyebrow);
      block('heading', scene.payload.heading, { style: fit.heading.style, ...tokens.typography.density });
      break;
    }
    case 'statement': {
      const fit = archetypes.statement;
      optional('eyebrow', scene.payload.eyebrow, fit.eyebrow);
      block('statement', scene.payload.text, fit.statement, scene.payload.emphasis);
      break;
    }
    case 'mediaReveal': {
      const { image, alt, caption } = scene.payload;
      const asset = assets.find((candidate) => candidate.id === image);
      if (!asset || asset.kind !== 'image') fail(`"${image}" is not an image asset`);
      const path = staticPath(asset!.uri);
      if (path === null) fail(`image "${image}" has uri "${asset!.uri}"; ${tokens.id} serves only static:<path> images from public/`);
      media = { assetId: image, staticPath: path!, alt };
      optional('caption', caption, archetypes.mediaReveal.caption);
      break;
    }
    case 'comparison': {
      const fit = archetypes.comparison;
      if (scene.payload.items.length !== 2) fail('a comparison needs exactly 2 items');
      optional('heading', scene.payload.heading, fit.heading);
      for (const item of scene.payload.items) {
        block('label', item.label, fit.label);
        block('detail', item.detail, fit.detail);
      }
      break;
    }
    case 'quote': {
      const fit = archetypes.quote;
      block('quote', scene.payload.text, fit.quote);
      optional('attribution', scene.payload.attribution, fit.attribution);
      break;
    }
    case 'dataPoint': {
      const fit = archetypes.dataPoint;
      block('value', scene.payload.value, fit.value);
      block('label', scene.payload.label, fit.label);
      optional('context', scene.payload.context, fit.context);
      break;
    }
    case 'list': {
      const fit = archetypes.list;
      const { items } = scene.payload;
      if (!items.length || items.length > fit.maxItems) {
        fail(`${items.length} list items; ${tokens.id} draws 1 to ${fit.maxItems}`);
      }
      optional('heading', scene.payload.heading, fit.heading);
      // An item shares its row with a marker as wide as the item text's size.
      const itemStyle = tokens.scenes.text[fit.item.style];
      const itemWidth = width - itemStyle.size - tokens.scenes.gaps.marker;
      for (const item of items) block('item', item, fit.item, undefined, itemWidth);
      ordered = scene.payload.ordered;
      break;
    }
    case 'conclusion': {
      const fit = archetypes.conclusion;
      block('heading', scene.payload.heading, fit.heading);
      optional('takeaway', scene.payload.takeaway, fit.takeaway);
      break;
    }
    default:
      fail(`${scene.kind} scenes are not part of ${tokens.id} v${tokens.version}`);
  }
  return { kind: scene.kind, blocks, media, ordered };
}
