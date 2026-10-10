import type { FormatPack, FormatRendering } from '@/catalog/catalog';

import { planMoenarchShort } from './plan';
import { moenarchShortV1Tokens, type MoenarchAccentName, type MoenarchShortTokens } from './tokens';
import { createMoenarchVideo } from './video';

// moenarch-short v1: a portrait short format whose look lives in `tokens.ts`. A project may pick
// one of the named accents; everything else is fixed by the format version.
export const MOENARCH_SHORT_FORMAT = { id: moenarchShortV1Tokens.id, version: moenarchShortV1Tokens.version } as const;

/** The only per-project choice: a named accent from `tokens.accents`. */
export type MoenarchShortOverrides = { accent?: MoenarchAccentName };

export type MoenarchShortPack = FormatPack & { tokens: MoenarchShortTokens };

const ALLOWED_OVERRIDES = new Set(['accent']);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** v1 tokens with validated overrides applied; throws for anything outside the allowed set. */
function resolveTokens(overrides: unknown): MoenarchShortTokens {
  if (overrides === undefined) return moenarchShortV1Tokens;
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw new Error('moenarch-short overrides must be an object');
  }
  // Fail closed on every own key (non-enumerable and symbol keys included) and accept only plain
  // objects, so nothing reaches the pack through a prototype.
  const prototype = Object.getPrototypeOf(overrides);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('moenarch-short overrides must be a plain object');
  }
  const unknown = Reflect.ownKeys(overrides).filter((key) => typeof key !== 'string' || !ALLOWED_OVERRIDES.has(key));
  if (unknown.length) {
    throw new Error(`moenarch-short overrides allow only an accent, not: ${unknown.map(String).join(', ')}`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(overrides, 'accent');
  if (descriptor && !('value' in descriptor)) throw new Error('moenarch-short accent must be a data property');
  const accent: unknown = descriptor?.value;
  if (accent === undefined) return moenarchShortV1Tokens;
  const accents = moenarchShortV1Tokens.accents;
  if (typeof accent !== 'string' || !Object.hasOwn(accents, accent)) {
    throw new Error(`moenarch-short accent must be one of ${Object.keys(accents).join(', ')}`);
  }
  const tokens = structuredClone(moenarchShortV1Tokens) as { palette: { accent: string } };
  tokens.palette.accent = accents[accent as MoenarchAccentName];
  return deepFreeze(tokens) as MoenarchShortTokens;
}

/** The moenarch-short v1 pack, optionally with a project's accent. */
export function moenarchShort(overrides?: MoenarchShortOverrides): MoenarchShortPack {
  const tokens = resolveTokens(overrides);
  return {
    ...MOENARCH_SHORT_FORMAT,
    tokens,
    compose(spec): FormatRendering {
      return { component: createMoenarchVideo(planMoenarchShort(spec, tokens), tokens) };
    },
  };
}
