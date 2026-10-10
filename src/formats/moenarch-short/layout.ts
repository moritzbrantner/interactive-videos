// moenarch-short scene layout: which text blocks a scene draws and how each one wraps. Plain
// TypeScript with no React or Remotion. The plan calls it once per scene, so frame code only draws
// the planned lines.
//
// Fit rule, the same for every archetype: text wraps greedily at its block's characters per line
// and is never truncated, shrunk or ellipsized. More lines than the block allows, a word longer
// than a line or more list items than the format allows make the scene unrenderable, and
// `layoutMoenarchScene` throws naming the scene.
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

/** Greedy word wrap; null when a single word is longer than a line. */
export function wrapText(text: string, maxChars: number): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    if (word.length > maxChars) return null;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
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
function staticPath(uri: string): string | null {
  const path = STATIC_URI.exec(uri)?.[1];
  if (!path || /[\\?#]/.test(path) || path.startsWith('/')) return null;
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
  const fail = (problem: string): never => {
    throw new Error(`${scene.id}: ${problem}`);
  };
  const block = (
    role: string,
    text: string,
    fit: { style: MoenarchTextStyleName; maxCharsPerLine: number; maxLines: number },
    emphasis?: string,
  ) => {
    const lines = wrapText(text, fit.maxCharsPerLine);
    if (!lines || !lines.length || lines.length > fit.maxLines) {
      fail(`${role} needs more than ${fit.maxLines} line${fit.maxLines === 1 ? '' : 's'} of ${fit.maxCharsPerLine} characters`);
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
      for (const item of items) block('item', item, fit.item);
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
