// Contextual person, place and term entries of a council episode (#85, Decision Atlas 1.4, 3.3,
// 3.12). The English file carries the structure (kind, sources, scene appearances, optional image)
// and the English text; a translation carries text only, keyed by entry id in the English order.
// Validation fails closed (Atlas 3.12: a missing translation must not pass as translated
// content): anything incomplete, reordered, structural, stale against the English text or without
// provenance is rejected with reasons, and the Player then shows the English entry marked as
// untranslated. Pure data code: no React, no Remotion, no network.

import { sha256Hex } from '@/spec/sha256';

export const CONTEXT_SCHEMA = 'interactive-videos/council-context';
export const CONTEXT_SCHEMA_VERSION = 1;

/** Languages a context translation may be in; English is the source file. */
export const CONTEXT_TRANSLATION_LANGUAGES = ['de', 'es'] as const;
export type ContextTranslationLanguage = (typeof CONTEXT_TRANSLATION_LANGUAGES)[number];

export type ContextKind = 'person' | 'place' | 'term';
export type ContextDepiction = 'documentary' | 'illustration' | 'reconstruction';

/** The viewer-facing text of one entry, in one language. */
export type ContextText = { id: string; title: string; preview: string; body: string };

export type ContextAppearance = { scene: string; anchor: string };

export type ContextImage = { src: string; alt: string; depiction: ContextDepiction; credit: string };

export type ContextEntry = ContextText & {
  kind: ContextKind;
  sources: readonly string[];
  appearances: readonly ContextAppearance[];
  image?: ContextImage;
};

export type ContextEnglish = { project: string; entries: readonly ContextEntry[] };

export type ContextReview = { status: 'pending' | 'approved' | 'changes-requested'; reviewer?: string; date?: string; reference?: string };

export type ContextProvenance = {
  translatedFrom: { language: 'en'; entriesSha256: string };
  translator: { kind: 'agent' | 'human'; name: string };
  review: ContextReview;
};

export type ContextTranslation = {
  project: string;
  language: ContextTranslationLanguage;
  provenance: ContextProvenance;
  entries: readonly ContextText[];
};

export type ContextTranslationResult = { ok: true; translation: ContextTranslation } | { ok: false; errors: string[] };

const KINDS: readonly ContextKind[] = ['person', 'place', 'term'];
const DEPICTIONS: readonly ContextDepiction[] = ['documentary', 'illustration', 'reconstruction'];
const ENTRY_FIELDS = ['id', 'kind', 'title', 'preview', 'body', 'sources', 'appearances', 'image'];
const TEXT_FIELDS = ['id', 'title', 'preview', 'body'] as const;
/** Longest English hover preview (characters). */
export const CONTEXT_PREVIEW_MAX = 220;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function checkHeader(data: Record<string, unknown>, errors: string[]) {
  if (data.schema !== CONTEXT_SCHEMA || data.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    errors.push(`schema must be ${CONTEXT_SCHEMA} v${CONTEXT_SCHEMA_VERSION}`);
  }
  if (!nonEmpty(data.project)) errors.push('project must be a non-empty string');
}

/**
 * Checks the English context file. `known` optionally names the source ids and scene ids that
 * entries may refer to; anchors and timing are checked against the episode by its tests.
 */
export function validateContextEnglish(
  data: unknown,
  known: { sources?: ReadonlySet<string>; scenes?: ReadonlySet<string> } = {},
): { ok: true; english: ContextEnglish } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(data)) return { ok: false, errors: ['the English context must be an object'] };
  checkHeader(data, errors);
  if (data.language !== 'en') errors.push(`language ${JSON.stringify(data.language)} is not en`);
  const entries: ContextEntry[] = [];
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    errors.push('entries must be a non-empty array');
  } else {
    const ids = new Set<string>();
    data.entries.forEach((entry: unknown, position: number) => {
      const at = `entries[${position}]`;
      if (!isObject(entry)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const before = errors.length;
      const extra = Object.keys(entry).filter((key) => !ENTRY_FIELDS.includes(key));
      if (extra.length) errors.push(`${at} has undocumented fields ${extra.join(', ')}`);
      if (typeof entry.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) errors.push(`${at}.id must be kebab-case`);
      else if (ids.has(entry.id)) errors.push(`${at}.id ${entry.id} is duplicated`);
      else ids.add(entry.id);
      if (!KINDS.includes(entry.kind as ContextKind)) errors.push(`${at}.kind must be one of ${KINDS.join(', ')}`);
      for (const field of ['title', 'preview', 'body'] as const) if (!nonEmpty(entry[field])) errors.push(`${at}.${field} must be non-empty text`);
      if (typeof entry.preview === 'string' && entry.preview.length > CONTEXT_PREVIEW_MAX) errors.push(`${at}.preview is longer than ${CONTEXT_PREVIEW_MAX} characters`);
      if (typeof entry.preview === 'string' && typeof entry.body === 'string' && entry.body.length <= entry.preview.length) errors.push(`${at}.body must be longer than its preview`);
      if (!Array.isArray(entry.sources) || entry.sources.length === 0 || !entry.sources.every(nonEmpty)) {
        errors.push(`${at}.sources must name at least one source`);
      } else {
        if (new Set(entry.sources).size !== entry.sources.length) errors.push(`${at}.sources has duplicates`);
        for (const source of entry.sources) if (known.sources && !known.sources.has(source)) errors.push(`${at} cites unknown source ${source}`);
      }
      if (!Array.isArray(entry.appearances) || entry.appearances.length === 0) {
        errors.push(`${at}.appearances must name at least one scene`);
      } else {
        entry.appearances.forEach((appearance: unknown, index: number) => {
          if (!isObject(appearance) || !nonEmpty(appearance.scene) || !nonEmpty(appearance.anchor) || Object.keys(appearance).length !== 2) {
            errors.push(`${at}.appearances[${index}] must be { scene, anchor }`);
          } else if (known.scenes && !known.scenes.has(appearance.scene)) {
            errors.push(`${at}.appearances[${index}] names unknown scene ${appearance.scene}`);
          }
        });
      }
      if (entry.image !== undefined) {
        const image = entry.image;
        if (!isObject(image) || !DEPICTIONS.includes(image.depiction as ContextDepiction) || !nonEmpty(image.src) || !nonEmpty(image.alt) || !nonEmpty(image.credit)) {
          errors.push(`${at}.image must be { src, alt, depiction: ${DEPICTIONS.join(' | ')}, credit } (Atlas 3.16)`);
        }
      }
      if (errors.length === before) entries.push(entry as unknown as ContextEntry);
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, english: { project: data.project as string, entries } };
}

/** SHA-256 of JSON.stringify([[id, title, preview, body], …]) over the English entries in order. */
export function contextEntriesSha256(english: unknown): string {
  const entries = isObject(english) && Array.isArray(english.entries) ? english.entries : [];
  return sha256Hex(JSON.stringify(entries.map((entry: Record<string, unknown>) => [entry?.id, entry?.title, entry?.preview, entry?.body])));
}

function readProvenance(value: unknown, expectedSha: string, errors: string[]): ContextProvenance | undefined {
  if (!isObject(value)) {
    errors.push('provenance is missing');
    return undefined;
  }
  const before = errors.length;
  const from = value.translatedFrom;
  if (!isObject(from) || from.language !== 'en' || typeof from.entriesSha256 !== 'string') {
    errors.push('provenance.translatedFrom must be { language: "en", entriesSha256 }');
  } else if (from.entriesSha256 !== expectedSha) {
    errors.push(`provenance.translatedFrom.entriesSha256 ${from.entriesSha256} does not match the English entries (${expectedSha}): the translation is stale`);
  }
  const translator = value.translator;
  if (!isObject(translator) || (translator.kind !== 'agent' && translator.kind !== 'human') || !nonEmpty(translator.name)) {
    errors.push('provenance.translator must be { kind: "agent" | "human", name }');
  }
  const review = value.review;
  if (!isObject(review) || !['pending', 'approved', 'changes-requested'].includes(review.status as string)) {
    errors.push('provenance.review.status must be pending, approved or changes-requested');
  } else {
    if (review.reviewer !== undefined && !nonEmpty(review.reviewer)) errors.push('provenance.review.reviewer must be a non-empty string');
    if (review.date !== undefined && !(typeof review.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(review.date))) errors.push('provenance.review.date must be YYYY-MM-DD');
    if (review.reference !== undefined && !(typeof review.reference === 'string' && /^https:\/\/\S+$/.test(review.reference))) errors.push('provenance.review.reference must be an https URL');
    if (review.status === 'approved') {
      if (!nonEmpty(review.reviewer)) errors.push('an approved review names its reviewer');
      else if (isObject(translator) && typeof translator.name === 'string' && review.reviewer.trim() === translator.name.trim()) errors.push('the reviewer must not be the translator');
      if (review.date === undefined) errors.push('an approved review has a date');
    }
  }
  if (errors.length > before) return undefined;
  const r = review as Record<string, unknown>;
  const t = translator as Record<string, unknown>;
  return {
    translatedFrom: { language: 'en', entriesSha256: expectedSha },
    translator: { kind: t.kind as 'agent' | 'human', name: t.name as string },
    review: {
      status: r.status as ContextReview['status'],
      ...(r.reviewer !== undefined ? { reviewer: r.reviewer as string } : {}),
      ...(r.date !== undefined ? { date: r.date as string } : {}),
      ...(r.reference !== undefined ? { reference: r.reference as string } : {}),
    },
  };
}

/**
 * Checks `data` as a translation of the English context file `english`: same schema and project,
 * a supported language, provenance made from the current English text, and exactly one text-only
 * entry per English entry, in the English order.
 */
export function validateContextTranslation(english: unknown, data: unknown): ContextTranslationResult {
  const errors: string[] = [];
  if (!isObject(english) || !Array.isArray(english.entries)) return { ok: false, errors: ['the English context is not valid'] };
  if (!isObject(data)) return { ok: false, errors: ['a translation must be an object'] };
  checkHeader(data, errors);
  if (data.project !== english.project) errors.push(`project ${JSON.stringify(data.project)} is not ${String(english.project)}`);
  const language = data.language;
  if (!CONTEXT_TRANSLATION_LANGUAGES.includes(language as ContextTranslationLanguage)) {
    errors.push(`language ${JSON.stringify(language)} is not one of ${CONTEXT_TRANSLATION_LANGUAGES.join(', ')}`);
  }
  const provenance = readProvenance(data.provenance, contextEntriesSha256(english), errors);

  const expected = (english.entries as Record<string, unknown>[]).map((entry) => entry?.id);
  const entries: ContextText[] = [];
  if (!Array.isArray(data.entries)) {
    errors.push('entries must be an array');
  } else {
    if (data.entries.length !== expected.length) errors.push(`${data.entries.length} entries, but the English context has ${expected.length}`);
    const seen = new Set<unknown>();
    data.entries.forEach((entry: unknown, position: number) => {
      const at = `entries[${position}]`;
      if (!isObject(entry)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const extra = Object.keys(entry).filter((key) => !(TEXT_FIELDS as readonly string[]).includes(key));
      if (extra.length) errors.push(`${at} has ${extra.join(', ')}: a translated entry carries text only (id, title, preview, body)`);
      if (seen.has(entry.id)) errors.push(`${at} repeats entry ${JSON.stringify(entry.id)}`);
      seen.add(entry.id);
      if (entry.id !== expected[position]) errors.push(`${at} is ${JSON.stringify(entry.id)}, but the English entry there is ${JSON.stringify(expected[position])}`);
      let complete = true;
      for (const field of ['title', 'preview', 'body'] as const) {
        if (typeof entry[field] !== 'string') {
          errors.push(`${at} has no ${field}`);
          complete = false;
        } else if ((entry[field] as string).trim() === '') {
          errors.push(`${at}.${field} is empty`);
          complete = false;
        }
      }
      if (complete && typeof entry.id === 'string') entries.push({ id: entry.id, title: entry.title as string, preview: entry.preview as string, body: entry.body as string });
    });
  }

  if (errors.length > 0 || !provenance) return { ok: false, errors: errors.length ? errors : ['provenance is invalid'] };
  return {
    ok: true,
    translation: { project: data.project as string, language: language as ContextTranslationLanguage, provenance, entries },
  };
}
