// Translated subtitle tracks (#84, Decision Atlas 3.10): the text of every English narration cue in
// another language, keyed by (scene id, cue index). A translation carries text only; it always
// shows over the English cue's window and is never re-timed. Validation fails closed (Atlas 3.12:
// a missing translation must not pass as translated content): anything incomplete, reordered,
// re-timed, stale against the English script or without provenance is rejected with reasons.

import { sha256Hex } from '@/spec/sha256';
import type { VideoSpec } from '@/spec/video-spec';

export const SUBTITLE_TRANSLATION_SCHEMA = 'interactive-videos/council-subtitles';
export const SUBTITLE_TRANSLATION_VERSION = 1;

/** Languages a translated track may be in; the English narration is the spec's own track. */
export const TRANSLATION_LANGUAGES = ['de', 'es'] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export type TranslationReview = {
  status: 'pending' | 'approved' | 'changes-requested';
  reviewer?: string;
  date?: string;
  reference?: string;
};

export type TranslationProvenance = {
  translatedFrom: { language: 'en'; cuesSha256: string };
  translator: { kind: 'agent' | 'human'; name: string };
  review: TranslationReview;
};

export type TranslatedCue = { scene: string; index: number; text: string };

export type SubtitleTranslation = {
  project: string;
  language: TranslationLanguage;
  label: string;
  provenance: TranslationProvenance;
  cues: readonly TranslatedCue[];
};

export type SubtitleTranslationResult = { ok: true; translation: SubtitleTranslation } | { ok: false; errors: string[] };

type EnglishCue = { scene: string; index: number; text: string };

const englishCues = (spec: VideoSpec): EnglishCue[] =>
  spec.scenes.flatMap((scene) => (scene.narration?.cues ?? []).map((cue, index) => ({ scene: scene.id, index, text: cue.text })));

/** SHA-256 of JSON.stringify([[sceneId, index, englishText], …]) over the spec's cues in order. */
export function englishCuesSha256(spec: VideoSpec): string {
  return sha256Hex(JSON.stringify(englishCues(spec).map((cue) => [cue.scene, cue.index, cue.text])));
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function readProvenance(value: unknown, expectedSha: string, errors: string[]): TranslationProvenance | undefined {
  if (!isObject(value)) {
    errors.push('provenance is missing');
    return undefined;
  }
  const before = errors.length;
  const from = value.translatedFrom;
  if (!isObject(from) || from.language !== 'en' || typeof from.cuesSha256 !== 'string') {
    errors.push('provenance.translatedFrom must be { language: "en", cuesSha256 }');
  } else if (from.cuesSha256 !== expectedSha) {
    errors.push(`provenance.translatedFrom.cuesSha256 ${from.cuesSha256} does not match the English cues (${expectedSha}): the translation is stale`);
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
    translatedFrom: { language: 'en', cuesSha256: expectedSha },
    translator: { kind: t.kind as 'agent' | 'human', name: t.name as string },
    review: {
      status: r.status as TranslationReview['status'],
      ...(r.reviewer !== undefined ? { reviewer: r.reviewer as string } : {}),
      ...(r.date !== undefined ? { date: r.date as string } : {}),
      ...(r.reference !== undefined ? { reference: r.reference as string } : {}),
    },
  };
}

/**
 * Checks `data` as a translation of `spec`'s English cues. It must name the spec's project, a
 * supported language, provenance made from the current English cues, and exactly one text-only
 * cue per English cue, in spoken order.
 */
export function validateSubtitleTranslation(spec: VideoSpec, data: unknown): SubtitleTranslationResult {
  const errors: string[] = [];
  if (!isObject(data)) return { ok: false, errors: ['a translation must be an object'] };
  if (data.schema !== SUBTITLE_TRANSLATION_SCHEMA || data.schemaVersion !== SUBTITLE_TRANSLATION_VERSION) {
    errors.push(`schema must be ${SUBTITLE_TRANSLATION_SCHEMA} v${SUBTITLE_TRANSLATION_VERSION}`);
  }
  if (data.project !== spec.project.id) errors.push(`project ${JSON.stringify(data.project)} is not ${spec.project.id}`);
  const language = data.language;
  if (!TRANSLATION_LANGUAGES.includes(language as TranslationLanguage)) {
    errors.push(`language ${JSON.stringify(language)} is not one of ${TRANSLATION_LANGUAGES.join(', ')}`);
  }
  if (!nonEmpty(data.label)) errors.push('label must be a non-empty string');
  const provenance = readProvenance(data.provenance, englishCuesSha256(spec), errors);

  const english = englishCues(spec);
  const cues: TranslatedCue[] = [];
  if (!Array.isArray(data.cues)) {
    errors.push('cues must be an array');
  } else {
    if (data.cues.length !== english.length) errors.push(`${data.cues.length} cues, but the English narration has ${english.length}`);
    const scenes = new Set(spec.scenes.map((scene) => scene.id));
    data.cues.forEach((cue: unknown, position: number) => {
      const at = `cues[${position}]`;
      if (!isObject(cue)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const extra = Object.keys(cue).filter((key) => !['scene', 'index', 'text'].includes(key));
      if (extra.length) errors.push(`${at} has ${extra.join(', ')}: a translated cue carries text only and keeps the English timing`);
      if (typeof cue.scene !== 'string' || !scenes.has(cue.scene)) errors.push(`${at} names unknown scene ${JSON.stringify(cue.scene)}`);
      const expected = english[position];
      if (expected && (cue.scene !== expected.scene || cue.index !== expected.index)) {
        errors.push(`${at} is ${JSON.stringify(cue.scene)}#${String(cue.index)}, but the English cue there is ${expected.scene}#${expected.index}`);
      }
      if (typeof cue.text !== 'string') errors.push(`${at} has no text`);
      else if (cue.text.trim() === '') errors.push(`${at} text is empty`);
      if (typeof cue.scene === 'string' && typeof cue.index === 'number' && typeof cue.text === 'string') cues.push({ scene: cue.scene, index: cue.index, text: cue.text });
    });
  }

  if (errors.length > 0 || !provenance) return { ok: false, errors: errors.length ? errors : ['provenance is invalid'] };
  return {
    ok: true,
    translation: { project: spec.project.id, language: language as TranslationLanguage, label: data.label as string, provenance, cues },
  };
}

/** The translated text of each cue, keyed `${scene}#${index}`. */
export const translationTextByCue = (translation: SubtitleTranslation): ReadonlyMap<string, string> =>
  new Map(translation.cues.map((cue) => [`${cue.scene}#${cue.index}`, cue.text]));

/**
 * The same spec with each narration cue's text replaced by the translation's; cue and word timing,
 * marks, holds and audio stay as they are. `spec` is not modified. Throws when the translation does
 * not cover a cue (validate first).
 */
export function applySubtitleTranslation(spec: VideoSpec, translation: SubtitleTranslation): VideoSpec {
  if (translation.project !== spec.project.id) throw new Error(`translation of ${translation.project} applied to ${spec.project.id}`);
  const text = translationTextByCue(translation);
  return {
    ...spec,
    scenes: spec.scenes.map((scene) => {
      if (!scene.narration) return scene;
      return {
        ...scene,
        narration: {
          ...scene.narration,
          cues: scene.narration.cues.map((cue, index) => {
            const translated = text.get(`${scene.id}#${index}`);
            if (translated === undefined) throw new Error(`${translation.language} translation has no cue ${scene.id}#${index}`);
            return { ...cue, text: translated };
          }),
        },
      };
    }),
  } as VideoSpec;
}
