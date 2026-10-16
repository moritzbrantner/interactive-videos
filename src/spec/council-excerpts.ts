// Annotated source excerpts of a council episode (#86, Decision Atlas 3.12, 3.14). The English file
// carries the structure (source, standing, locator, link, original, references) and the English
// text with its published translation; a German or Spanish file carries text only, keyed by excerpt
// id in the English order, with a passage translation that is attributed or explicitly missing.
// Validation fails closed (Atlas 3.12): anything incomplete, reordered, structural, stale against
// the English text, unattributed or without provenance is rejected with reasons, and the Player
// then shows the English excerpt marked as untranslated. Pure data code: no React, no Remotion, no
// network.

import { sha256Hex } from '@/spec/sha256';

export const EXCERPTS_SCHEMA = 'interactive-videos/council-excerpts';
export const EXCERPTS_SCHEMA_VERSION = 1;

/** Languages an excerpt translation may be in; English is the source file. */
export const EXCERPT_TRANSLATION_LANGUAGES = ['de', 'es'] as const;
export type ExcerptTranslationLanguage = (typeof EXCERPT_TRANSLATION_LANGUAGES)[number];

export type ExcerptStanding = 'council-act' | 'contemporary-witness' | 'later-witness';
export type OriginalLanguage = 'grc' | 'la';
export const EXCERPT_STANDINGS: readonly ExcerptStanding[] = ['council-act', 'contemporary-witness', 'later-witness'];
const ORIGINAL_LANGUAGES: readonly OriginalLanguage[] = ['grc', 'la'];

export type ExcerptOriginal =
  | { status: 'included'; language: OriginalLanguage; text: string; edition: string; note: string }
  | { status: 'lost' | 'not-included'; note: string };

export type ExcerptTranslator = { kind: 'published' | 'agent' | 'human'; name: string };

/** A passage translation as shown: English is always published; others may be agent or human. */
export type IncludedTranslation = {
  status: 'included';
  text: string;
  translator: ExcerptTranslator;
  translatedFrom: OriginalLanguage | 'en';
  edition?: string;
  url?: string;
};
export type PassageTranslation = IncludedTranslation | { status: 'missing' };

export type ExcerptAnnotation = { id: string; term: string; note: string };
export type ExcerptReference = { scene: string; anchor: string };

export type Excerpt = {
  id: string;
  title: string;
  source: string;
  standing: ExcerptStanding;
  locator: { work: string; section: string };
  url?: string;
  original: ExcerptOriginal;
  translation: IncludedTranslation;
  explanation: string;
  annotations: readonly ExcerptAnnotation[];
  references: readonly ExcerptReference[];
};

export type ExcerptsEnglish = { project: string; excerpts: readonly Excerpt[] };

/** The viewer-facing text of one excerpt in one translation language. */
export type ExcerptText = {
  id: string;
  title: string;
  explanation: string;
  originalNote: string;
  annotations: readonly ExcerptAnnotation[];
  translation: PassageTranslation;
};

export type ExcerptReview = { status: 'pending' | 'approved' | 'changes-requested'; reviewer?: string; date?: string; reference?: string };

export type ExcerptProvenance = {
  translatedFrom: { language: 'en'; excerptsSha256: string };
  translator: { kind: 'agent' | 'human'; name: string };
  review: ExcerptReview;
};

export type ExcerptTranslation = {
  project: string;
  language: ExcerptTranslationLanguage;
  provenance: ExcerptProvenance;
  excerpts: readonly ExcerptText[];
};

export type ExcerptTranslationResult = { ok: true; translation: ExcerptTranslation } | { ok: false; errors: string[] };

const EXCERPT_FIELDS = ['id', 'title', 'source', 'standing', 'locator', 'url', 'original', 'translation', 'explanation', 'annotations', 'references'];
const TEXT_FIELDS = ['id', 'title', 'explanation', 'originalNote', 'annotations', 'translation'];
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/\S+$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Greek or Latin compared without accents, breathings or case; final sigma folded. */
export const foldPassage = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ς/g, 'σ').toLocaleLowerCase().replace(/\s+/g, ' ');
/** Words only, lower case: compares texts regardless of punctuation and spacing. */
const normalizeWords = (text: string) => (text.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((word) => word.toLocaleLowerCase()).join(' ');

function checkHeader(data: Record<string, unknown>, errors: string[]) {
  if (data.schema !== EXCERPTS_SCHEMA || data.schemaVersion !== EXCERPTS_SCHEMA_VERSION) {
    errors.push(`schema must be ${EXCERPTS_SCHEMA} v${EXCERPTS_SCHEMA_VERSION}`);
  }
  if (!nonEmpty(data.project)) errors.push('project must be a non-empty string');
}

function checkAnnotations(value: unknown, at: string, passage: string, errors: string[]): value is ExcerptAnnotation[] {
  const before = errors.length;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${at}.annotations must be a non-empty array`);
    return false;
  }
  const ids = new Set<string>();
  value.forEach((annotation: unknown, index: number) => {
    const where = `${at}.annotations[${index}]`;
    if (!isObject(annotation) || Object.keys(annotation).sort().join() !== 'id,note,term') {
      errors.push(`${where} must be { id, term, note }`);
      return;
    }
    if (typeof annotation.id !== 'string' || !KEBAB.test(annotation.id)) errors.push(`${where}.id must be kebab-case`);
    else if (ids.has(annotation.id)) errors.push(`${where}.id ${annotation.id} is duplicated`);
    else ids.add(annotation.id);
    if (!nonEmpty(annotation.term)) errors.push(`${where}.term must be non-empty`);
    else if (!passage.includes(foldPassage(annotation.term))) errors.push(`${where}.term ${JSON.stringify(annotation.term)} does not occur in the shown passage`);
    if (!nonEmpty(annotation.note)) errors.push(`${where}.note must be non-empty`);
  });
  return errors.length === before;
}

function checkOriginal(value: unknown, at: string, errors: string[]) {
  if (!isObject(value)) {
    errors.push(`${at}.original must be an object`);
    return;
  }
  if (!nonEmpty(value.note)) errors.push(`${at}.original.note must say how the original is transmitted or why it is absent`);
  if (value.status === 'included') {
    if (Object.keys(value).sort().join() !== 'edition,language,note,status,text') errors.push(`${at}.original must be { status, language, text, edition, note }`);
    if (!ORIGINAL_LANGUAGES.includes(value.language as OriginalLanguage)) errors.push(`${at}.original.language must be grc or la`);
    if (!nonEmpty(value.text) || !nonEmpty(value.edition)) errors.push(`${at}.original needs its text and edition`);
  } else if (value.status === 'lost' || value.status === 'not-included') {
    if (Object.keys(value).sort().join() !== 'note,status') errors.push(`${at}: an absent original carries only its status and note`);
  } else {
    errors.push(`${at}.original.status must be included, lost or not-included`);
  }
}

/**
 * Checks the English excerpt file. `known` optionally names the source ids and scene ids that
 * excerpts may refer to; anchors and timing are checked against the episode by its tests.
 */
export function validateExcerptEnglish(
  data: unknown,
  known: { sources?: ReadonlySet<string>; scenes?: ReadonlySet<string> } = {},
): { ok: true; english: ExcerptsEnglish } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(data)) return { ok: false, errors: ['the English excerpts must be an object'] };
  checkHeader(data, errors);
  if (data.language !== 'en') errors.push(`language ${JSON.stringify(data.language)} is not en`);
  const excerpts: Excerpt[] = [];
  if (!Array.isArray(data.excerpts) || data.excerpts.length === 0) {
    errors.push('excerpts must be a non-empty array');
  } else {
    const ids = new Set<string>();
    data.excerpts.forEach((excerpt: unknown, position: number) => {
      const at = `excerpts[${position}]`;
      if (!isObject(excerpt)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const before = errors.length;
      const extra = Object.keys(excerpt).filter((key) => !EXCERPT_FIELDS.includes(key));
      if (extra.length) errors.push(`${at} has undocumented fields ${extra.join(', ')}`);
      if (typeof excerpt.id !== 'string' || !KEBAB.test(excerpt.id)) errors.push(`${at}.id must be kebab-case`);
      else if (ids.has(excerpt.id)) errors.push(`${at}.id ${excerpt.id} is duplicated`);
      else ids.add(excerpt.id);
      for (const field of ['title', 'explanation'] as const) if (!nonEmpty(excerpt[field])) errors.push(`${at}.${field} must be non-empty text`);
      if (!nonEmpty(excerpt.source)) errors.push(`${at}.source must name a source`);
      else if (known.sources && !known.sources.has(excerpt.source)) errors.push(`${at} cites unknown source ${excerpt.source}`);
      if (!EXCERPT_STANDINGS.includes(excerpt.standing as ExcerptStanding)) errors.push(`${at}.standing must be one of ${EXCERPT_STANDINGS.join(', ')}`);
      const locator = excerpt.locator;
      if (!isObject(locator) || Object.keys(locator).sort().join() !== 'section,work' || !nonEmpty(locator.work) || !nonEmpty(locator.section)) {
        errors.push(`${at}.locator must be { work, section }`);
      }
      if (excerpt.url !== undefined && !(typeof excerpt.url === 'string' && HTTPS.test(excerpt.url))) errors.push(`${at}.url must be an https URL`);
      checkOriginal(excerpt.original, at, errors);
      const translation = excerpt.translation;
      if (
        !isObject(translation) || translation.status !== 'included' || !nonEmpty(translation.text)
        || !isObject(translation.translator) || translation.translator.kind !== 'published' || !nonEmpty(translation.translator.name)
        || !nonEmpty(translation.edition) || !ORIGINAL_LANGUAGES.includes(translation.translatedFrom as OriginalLanguage)
        || (translation.url !== undefined && !(typeof translation.url === 'string' && HTTPS.test(translation.url)))
      ) {
        errors.push(`${at}.translation must be an included, published translation with translator, edition and translatedFrom`);
      } else if (isObject(excerpt.original) && excerpt.original.status === 'included' && translation.translatedFrom !== excerpt.original.language) {
        errors.push(`${at}.translation is not translated from the shown original`);
      }
      const passage = foldPassage(`${isObject(translation) ? String(translation.text ?? '') : ''} \n ${isObject(excerpt.original) ? String(excerpt.original.text ?? '') : ''}`);
      checkAnnotations(excerpt.annotations, at, passage, errors);
      if (!Array.isArray(excerpt.references) || excerpt.references.length === 0) {
        errors.push(`${at}.references must name at least one scene`);
      } else {
        excerpt.references.forEach((reference: unknown, index: number) => {
          if (!isObject(reference) || !nonEmpty(reference.scene) || !nonEmpty(reference.anchor) || Object.keys(reference).length !== 2) {
            errors.push(`${at}.references[${index}] must be { scene, anchor }`);
          } else if (known.scenes && !known.scenes.has(reference.scene)) {
            errors.push(`${at}.references[${index}] names unknown scene ${reference.scene}`);
          }
        });
      }
      if (errors.length === before) excerpts.push(excerpt as unknown as Excerpt);
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, english: { project: data.project as string, excerpts } };
}

/** SHA-256 of the English excerpt text, the original and the English translation, in order. */
export function excerptsSha256(english: unknown): string {
  const excerpts = isObject(english) && Array.isArray(english.excerpts) ? english.excerpts : [];
  return sha256Hex(
    JSON.stringify(
      excerpts.map((e: Record<string, any>) => [
        e?.id,
        e?.title,
        e?.explanation,
        e?.original?.note,
        e?.original?.status === 'included' ? e.original.text : null,
        e?.translation?.text,
        (Array.isArray(e?.annotations) ? e.annotations : []).map((a: Record<string, unknown>) => [a?.id, a?.term, a?.note]),
      ]),
    ),
  );
}

function readProvenance(value: unknown, expectedSha: string, errors: string[]): ExcerptProvenance | undefined {
  if (!isObject(value)) {
    errors.push('provenance is missing');
    return undefined;
  }
  const before = errors.length;
  const from = value.translatedFrom;
  if (!isObject(from) || from.language !== 'en' || typeof from.excerptsSha256 !== 'string') {
    errors.push('provenance.translatedFrom must be { language: "en", excerptsSha256 }');
  } else if (from.excerptsSha256 !== expectedSha) {
    errors.push(`provenance.translatedFrom.excerptsSha256 ${from.excerptsSha256} does not match the English excerpts (${expectedSha}): the translation is stale`);
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
    if (review.reference !== undefined && !(typeof review.reference === 'string' && HTTPS.test(review.reference))) errors.push('provenance.review.reference must be an https URL');
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
    translatedFrom: { language: 'en', excerptsSha256: expectedSha },
    translator: { kind: t.kind as 'agent' | 'human', name: t.name as string },
    review: {
      status: r.status as ExcerptReview['status'],
      ...(r.reviewer !== undefined ? { reviewer: r.reviewer as string } : {}),
      ...(r.date !== undefined ? { date: r.date as string } : {}),
      ...(r.reference !== undefined ? { reference: r.reference as string } : {}),
    },
  };
}

function readPassageTranslation(value: unknown, at: string, source: Record<string, any>, errors: string[]): PassageTranslation | undefined {
  if (!isObject(value)) {
    errors.push(`${at}.translation is missing: give an attributed translation or { status: "missing" }`);
    return undefined;
  }
  if (value.status === 'missing') {
    if (Object.keys(value).length !== 1) errors.push(`${at}: a missing translation is only the marker { status: "missing" }`);
    return { status: 'missing' };
  }
  if (value.status !== 'included') {
    errors.push(`${at}.translation.status must be included or missing`);
    return undefined;
  }
  const before = errors.length;
  const extra = Object.keys(value).filter((key) => !['status', 'text', 'translator', 'translatedFrom', 'edition', 'url'].includes(key));
  if (extra.length) errors.push(`${at}.translation has undocumented fields ${extra.join(', ')}`);
  if (!nonEmpty(value.text)) errors.push(`${at}.translation.text must be non-empty`);
  const translator = value.translator;
  if (!isObject(translator) || !['published', 'agent', 'human'].includes(translator.kind as string) || !nonEmpty(translator.name)) {
    errors.push(`${at}.translation.translator must be { kind: published | agent | human, name }`);
  } else if (translator.kind === 'published' && !nonEmpty(value.edition)) {
    errors.push(`${at}: a published translation names its edition`);
  }
  if (value.edition !== undefined && !nonEmpty(value.edition)) errors.push(`${at}.translation.edition must be non-empty when given`);
  if (!['grc', 'la', 'en'].includes(value.translatedFrom as string)) errors.push(`${at}.translation.translatedFrom must be grc, la or en`);
  else if (value.translatedFrom !== 'en' && source.original?.status === 'included' && value.translatedFrom !== source.original.language) {
    errors.push(`${at}.translation is not translated from the shown original`);
  }
  if (value.url !== undefined && !(typeof value.url === 'string' && HTTPS.test(value.url))) errors.push(`${at}.translation.url must be an https URL`);
  if (typeof value.text === 'string' && normalizeWords(value.text) === normalizeWords(String(source.translation?.text ?? ''))) {
    errors.push(`${at}.translation is the English translation, not a translation`);
  }
  if (errors.length > before) return undefined;
  const t = translator as Record<string, unknown>;
  return {
    status: 'included',
    text: value.text as string,
    translator: { kind: t.kind as ExcerptTranslator['kind'], name: t.name as string },
    translatedFrom: value.translatedFrom as IncludedTranslation['translatedFrom'],
    ...(value.edition !== undefined ? { edition: value.edition as string } : {}),
    ...(value.url !== undefined ? { url: value.url as string } : {}),
  };
}

/**
 * Checks `data` as a translation of the English excerpt file `english`: same schema and project, a
 * supported language, provenance made from the current English text, and exactly one text-only
 * excerpt per English excerpt, in the English order, with the English annotations in order.
 */
export function validateExcerptTranslation(english: unknown, data: unknown): ExcerptTranslationResult {
  const errors: string[] = [];
  if (!isObject(english) || !Array.isArray(english.excerpts)) return { ok: false, errors: ['the English excerpts are not valid'] };
  if (!isObject(data)) return { ok: false, errors: ['a translation must be an object'] };
  checkHeader(data, errors);
  if (data.project !== english.project) errors.push(`project ${JSON.stringify(data.project)} is not ${String(english.project)}`);
  const language = data.language;
  if (!EXCERPT_TRANSLATION_LANGUAGES.includes(language as ExcerptTranslationLanguage)) {
    errors.push(`language ${JSON.stringify(language)} is not one of ${EXCERPT_TRANSLATION_LANGUAGES.join(', ')}`);
  }
  const provenance = readProvenance(data.provenance, excerptsSha256(english), errors);

  const sources = english.excerpts as Record<string, any>[];
  const excerpts: ExcerptText[] = [];
  if (!Array.isArray(data.excerpts)) {
    errors.push('excerpts must be an array');
  } else {
    if (data.excerpts.length !== sources.length) errors.push(`${data.excerpts.length} excerpts, but the English file has ${sources.length}`);
    const seen = new Set<unknown>();
    data.excerpts.forEach((excerpt: unknown, position: number) => {
      const at = `excerpts[${position}]`;
      if (!isObject(excerpt)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const before = errors.length;
      const extra = Object.keys(excerpt).filter((key) => !TEXT_FIELDS.includes(key));
      if (extra.length) errors.push(`${at} has ${extra.join(', ')}: a translated excerpt carries text only (${TEXT_FIELDS.join(', ')})`);
      if (seen.has(excerpt.id)) errors.push(`${at} repeats excerpt ${JSON.stringify(excerpt.id)}`);
      seen.add(excerpt.id);
      const source: Record<string, any> | undefined = isObject(sources[position]) ? sources[position] : undefined;
      if (!source || excerpt.id !== source.id) {
        errors.push(`${at} is ${JSON.stringify(excerpt.id)}, but the English excerpt there is ${JSON.stringify(source?.id)}`);
        return;
      }
      for (const field of ['title', 'explanation', 'originalNote'] as const) {
        if (typeof excerpt[field] !== 'string') errors.push(`${at} has no ${field}`);
        else if ((excerpt[field] as string).trim() === '') errors.push(`${at}.${field} is empty`);
      }
      const translation = readPassageTranslation(excerpt.translation, at, source, errors);
      const shown = translation?.status === 'included' ? translation.text : String(source.translation?.text ?? '');
      const passage = foldPassage(`${shown} \n ${source.original?.status === 'included' ? String(source.original.text) : ''}`);
      if (checkAnnotations(excerpt.annotations, at, passage, errors)) {
        const expected = (Array.isArray(source.annotations) ? source.annotations : []).map((annotation: Record<string, unknown>) => annotation?.id);
        const actual = (excerpt.annotations as ExcerptAnnotation[]).map((annotation) => annotation.id);
        if (actual.join('\n') !== expected.join('\n')) errors.push(`${at}.annotations are ${actual.join(', ')}, but the English annotations are ${expected.join(', ')}`);
      }
      if (errors.length === before && translation) {
        excerpts.push({
          id: excerpt.id as string,
          title: excerpt.title as string,
          explanation: excerpt.explanation as string,
          originalNote: excerpt.originalNote as string,
          annotations: (excerpt.annotations as ExcerptAnnotation[]).map(({ id, term, note }) => ({ id, term, note })),
          translation,
        });
      }
    });
  }

  if (errors.length > 0 || !provenance) return { ok: false, errors: errors.length ? errors : ['provenance is invalid'] };
  return {
    ok: true,
    translation: { project: data.project as string, language: language as ExcerptTranslationLanguage, provenance, excerpts },
  };
}
