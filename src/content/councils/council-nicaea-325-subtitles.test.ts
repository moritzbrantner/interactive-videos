// Acceptance contract for issue #84 (Nicaea I: German and Spanish subtitle tracks), written by an
// independent acceptance context before any implementation, against baseline c3b8eaa. Intent:
// Decision Atlas 3.10 (English narration with selectable EN/DE/ES subtitles) and the "Language
// acceptance" section of #61. Out of scope here: the shared series-language selector and localized
// context of #70 / Atlas 3.12 (this issue only adds two tracks to the existing "Subtitles" select).
// Companion Pages journey: e2e/council-nicaea-325-subtitles.spec.ts.
//
// Seams (new; names chosen to fit the existing layout of #82):
//
// 1. Translated cue text, data only, one file per language, next to the English script:
//      src/content/councils/nicaea-325/subtitles/de.json
//      src/content/councils/nicaea-325/subtitles/es.json
//    { schema: "interactive-videos/council-subtitles", schemaVersion: 1,
//      project: "council-nicaea-325", language: "de" | "es", label: "Deutsch" | "Español",
//      provenance: {
//        translatedFrom: { language: "en", cuesSha256: <hex> },  // see englishCuesSha256 below
//        translator: { kind: "agent" | "human", name: string },
//        review: { status: "pending" | "approved" | "changes-requested",
//                  reviewer?: string, date?: "YYYY-MM-DD", reference?: "https://…" } },
//      cues: [{ scene: <scene id>, index: <cue index in that scene>, text: string }, …] }
//    `cues` lists every English narration cue of the spec (`scenes[].narration.cues`) exactly once,
//    in spoken order. A cue's identity is (scene id, index); it carries text only. Timing is never
//    re-timed per language: a translated cue has no startMs/endMs of its own and always shows over
//    the window of the English cue it translates. `cuesSha256` is the lowercase hex SHA-256 of the
//    UTF-8 bytes of JSON.stringify([[sceneId, index, englishText], …]) over the English cues in
//    order, so a change to the English script makes the translation stale (and invalid) instead of
//    silently mismatched. An approved review names a reviewer other than the translator, and a date.
//
// 2. Validation and application, a pure module: src/spec/subtitle-translation.ts
//      validateSubtitleTranslation(spec: VideoSpec, data: unknown)
//        => { ok: true; translation: SubtitleTranslation } | { ok: false; errors: string[] }
//      applySubtitleTranslation(spec: VideoSpec, translation: SubtitleTranslation): VideoSpec
//        // the same spec with each narration cue's text replaced; timing, words and marks unchanged
//    Invalid means: wrong schema/project, unknown language, missing/extra/reordered/duplicated cue,
//    empty or whitespace-only text, own timing fields, stale `cuesSha256`, missing provenance.
//
// 3. Catalog registration (src/catalog/catalog.ts, src/projects.ts): a `ProjectSource.subtitles`
//    entry may carry `translation: <the parsed JSON file>`; the entry without one is the spec's own
//    (English) cues. createCatalog validates each translation against the spec; an invalid one is
//    never offered: the resolved `composition.subtitles` (which drives the Player's "Subtitles"
//    select) omits it (or createCatalog refuses the source outright). Nicaea I resolves to the tracks
//    en "English", de "Deutsch", es "Español", in that order. Projects without translations keep
//    exactly the tracks they had (none, except Nicaea's English).
//
// 4. The Player: the existing "Subtitles" select gains "Deutsch" and "Español"; the shown
//    `[data-subtitle-cue]` carries lang="de" / lang="es". See the e2e spec header.
//
// Terminology (minimal, documented set; consistency within a track, not one exact wording where
// several renderings are legitimate). Checked per scene: when the English scene text contains the
// term, the translated scene text contains an accepted rendering, and a track uses one rendering
// per concept throughout:
//   council          DE Konzil                              ES Concilio (never "consejo")
//   Nicaea (place)   DE one of Nicäa | Nizäa | Nikaia       ES Nicea (never Nicaea / Nicéa)
//   Creed            DE one of (Glaubens)bekenntnis | Credo  ES one of Credo | Símbolo
//   homoousios       kept verbatim in both (the English narration speaks the Greek word)
//   same substance / one in being
//                    DE "wesensgleich" (at least once)      ES one of consustancial | consubstancial
//   begotten, not made  DE "gezeugt, nicht geschaffen"    ES "engendrado, no creado"
//   true God from true God  DE "wahrer (wahren) Gott vom wahren Gott"  ES "Dios verdadero de Dios verdadero"
//   Arius / Athanasius / Constantine / Constantinople / Arian
//                    DE Arius / Athanasius / Konstantin / Konstantinopel / arianisch
//                    ES Arrio / Atanasio / Constantino / Constantinopla / arriano
//   ecumenical       DE ökumenisch                          ES ecuménico
// The liturgical phrases follow the German (Gotteslob) and Spanish Roman Missal texts of the Creed.
//
// Non-automated acceptance (stays on the PR / issue): the independent translation review of both
// tracks (meaning, historical/theological accuracy, Catholic framing, register, subtitle reading
// speed). The language heuristics below only catch missing, untranslated or wrong-language text.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { catalog } from '@/projects';
import { createCatalog } from '@/catalog/catalog';
import { moenarchShort } from '@/formats/moenarch-short';
import { narrationSchedule } from '@/spec/narration-schedule';
import { latencyFormat } from '@/video/latency-format';
import { assertVideoSpec, type VideoSpec } from '@/spec/video-spec';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PROJECT = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`);
const SUBTITLES = join(ROOT, 'src', 'content', 'councils', 'nicaea-325', 'subtitles');

const LANGUAGES = {
  de: { label: 'Deutsch' },
  es: { label: 'Español' },
} as const;
type Lang = keyof typeof LANGUAGES;
const LANGS = Object.keys(LANGUAGES) as Lang[];

/** Catalog projects other than Nicaea I; none has subtitle tracks on baseline c3b8eaa. */
const OTHER_PROJECTS = [
  'latency-explainer',
  'catalog-title-card',
  'moenarch-specimen',
  'moenarch-scene-gallery',
  'moenarch-narration',
  'moenarch-typography',
  'interactive-showcase',
  'moenarch-materialized-audio',
];

const rawSpec = () => JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
const spec = (): VideoSpec => assertVideoSpec(rawSpec());

const trackPath = (lang: Lang) => join(SUBTITLES, `${lang}.json`);
function track(lang: Lang): Json {
  const path = trackPath(lang);
  expect(existsSync(path), `${path.slice(ROOT.length + 1)} exists`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}

type EnglishCue = { scene: string; index: number; startMs: number; endMs: number; text: string };
const englishCues = (subject: VideoSpec = spec()): EnglishCue[] =>
  subject.scenes.flatMap((scene) => (scene.narration?.cues ?? []).map((cue, index) => ({ scene: scene.id, index, ...cue })));
const englishCuesSha256 = (subject: VideoSpec = spec()) =>
  createHash('sha256')
    .update(JSON.stringify(englishCues(subject).map((cue) => [cue.scene, cue.index, cue.text])), 'utf8')
    .digest('hex');

async function translationModule() {
  let module: Json;
  try {
    module = await import('@/spec/subtitle-translation');
  } catch (error) {
    throw new Error(`src/spec/subtitle-translation.ts must exist and export validateSubtitleTranslation / applySubtitleTranslation: ${String(error)}`);
  }
  expect(typeof module.validateSubtitleTranslation, 'validateSubtitleTranslation is exported').toBe('function');
  expect(typeof module.applySubtitleTranslation, 'applySubtitleTranslation is exported').toBe('function');
  return module as {
    validateSubtitleTranslation: (spec: VideoSpec, data: unknown) => { ok: true; translation: unknown } | { ok: false; errors: string[] };
    applySubtitleTranslation: (spec: VideoSpec, translation: unknown) => VideoSpec;
  };
}

// ---------------------------------------------------------------------------------------------
// Language heuristics (cheap, documented; they detect untranslated or wrong-language text only).

const words = (text: string) => (text.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((word) => word.toLocaleLowerCase());
const normalize = (text: string) => words(text).join(' ');

/** Function words that are English and neither German nor Spanish. */
const ENGLISH_ONLY = new Set(['the', 'and', 'of', 'that', 'which', 'with', 'were', 'this', 'from', 'they', 'their', 'would', 'been', 'have', 'his', 'she', 'it', 'is', 'who', 'did', 'by', 'to', 'on', 'for', 'are', 'its', 'be', 'still', 'today', 'most', 'some', 'not']);
const STOPWORDS: Record<Lang, Set<string>> = {
  de: new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'zu', 'von', 'vom', 'mit', 'sich', 'auf', 'für', 'im', 'zum', 'zur', 'wurde', 'wurden', 'er', 'sie', 'auch', 'dass', 'als', 'nach', 'aus', 'bei', 'wie', 'war', 'waren', 'noch', 'nur', 'sein', 'seine', 'seinen', 'ihre', 'ihn', 'ihm', 'hat', 'haben', 'am', 'heute', 'oder', 'sind', 'kein', 'keine', 'keinen', 'man', 'diese', 'diesen', 'dieser', 'dieses', 'über', 'um', 'wird', 'werden']),
  es: new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'no', 'se', 'por', 'con', 'para', 'su', 'sus', 'al', 'lo', 'como', 'fue', 'fueron', 'más', 'pero', 'le', 'era', 'hoy', 'muchas', 'o', 'a', 'este', 'esta', 'sobre', 'hubo', 'es', 'son', 'ya', 'también', 'aún']),
};
const DIACRITICS: Record<Lang, RegExp> = { de: /[äöüßÄÖÜ]/u, es: /[áéíóúñÁÉÍÓÚÑ¿¡]/u };
const FOREIGN_LETTERS: Record<Lang, RegExp> = { de: /[ñÑ¿¡áíóúÁÍÓÚ]/u, es: /[äöß]/u };
/** Words that may appear unchanged in a translated cue (names, numbers, the Greek term). */
const SAME_IN_ALL = /^(?:\d+|nicaea|alexander|alexandria|arius|athanasius|homoousios|dogma|credo)$/;

const count = (list: string[], set: Set<string>) => list.filter((word) => set.has(word)).length;
/** Function words of `lang` that are not also words of the other language (Spanish "es" is German "es"). */
const SHARED = new Set(['es']);
const exclusive = (lang: Lang) => new Set([...STOPWORDS[lang]].filter((word) => !SHARED.has(word)));

// ---------------------------------------------------------------------------------------------
// Terminology (see header). Each concept: an English trigger, the accepted renderings per language
// (one id per legitimate variant), and renderings that must never appear.

type Concept = {
  id: string;
  english: RegExp;
  renderings: Record<Lang, Record<string, RegExp>>;
  never?: Partial<Record<Lang, RegExp>>;
  /** Check presence for the whole track rather than per triggering scene. */
  trackLevel?: boolean;
};

const CONCEPTS: Concept[] = [
  {
    id: 'council',
    english: /\bcouncil\b/i,
    renderings: { de: { Konzil: /\bKonzil(?:s|es|ien)?\b/i }, es: { Concilio: /\bconcilios?\b/i } },
    never: { es: /\bconsejos?\b/i },
  },
  {
    id: 'Nicaea',
    english: /\bNicaea\b/,
    renderings: { de: { Nicäa: /\bNicäa\b/, Nizäa: /\bNizäa\b/, Nikaia: /\bNikaia\b/ }, es: { Nicea: /\bNicea\b/ } },
    never: { de: /\bNicaea\b/, es: /\bNic(?:aea|éa)\b/ },
  },
  {
    id: 'Creed',
    english: /\bcreed\b/i,
    renderings: {
      de: { '(Glaubens-)Bekenntnis': /(?:Glaubens)?bekenntnis/i, Credo: /\bCredos?\b/ },
      es: { Credo: /\bcredo\b/i, Símbolo: /\bsímbolo\b/i },
    },
  },
  {
    id: 'homoousios',
    english: /\bhomoousios\b/i,
    renderings: { de: { homoousios: /\bhomoousios\b/i }, es: { homoousios: /\bhomoo[uú]sios\b/i } },
  },
  {
    id: 'consubstantial',
    english: /\bsame substance\b|\bone in being\b/i,
    renderings: {
      de: { wesensgleich: /\bwesensgleich\w*/i },
      es: { consustancial: /\bconsustancial(?:es)?\b/i, consubstancial: /\bconsubstancial(?:es)?\b/i },
    },
    trackLevel: true,
  },
  {
    id: 'begotten, not made',
    english: /\bbegotten, not made\b/i,
    renderings: { de: { 'gezeugt, nicht geschaffen': /\bgezeugt,? nicht geschaffen\b/i }, es: { 'engendrado, no creado': /\bengendrado,? no creado\b/i } },
  },
  {
    id: 'true God from true God',
    english: /\btrue God from true God\b/i,
    renderings: { de: { 'wahrer Gott vom wahren Gott': /\bwahr(?:er|en|e)? Gott vom wahren Gott\b/i }, es: { 'Dios verdadero de Dios verdadero': /\bDios verdadero de Dios verdadero\b/i } },
  },
  {
    id: 'Arius',
    english: /\bArius\b/,
    renderings: { de: { Arius: /\bArius\b/ }, es: { Arrio: /\bArrio\b/ } },
    never: { es: /\bArius\b/ },
  },
  {
    id: 'Athanasius',
    english: /\bAthanasius\b/,
    renderings: { de: { Athanasius: /\bAthanasius\b/ }, es: { Atanasio: /\bAtanasio\b/ } },
    never: { es: /\bAthanasius\b/ },
  },
  {
    id: 'Constantine',
    english: /\bConstantine\b/,
    renderings: { de: { Konstantin: /\bKonstantin\b/ }, es: { Constantino: /\bConstantino\b/ } },
    never: { de: /\bConstantine\b/, es: /\bConstantine\b/ },
  },
  {
    id: 'Constantinople',
    english: /\bConstantinople\b/,
    renderings: { de: { Konstantinopel: /\bKonstantinopel\b/ }, es: { Constantinopla: /\bConstantinopla\b/ } },
    never: { de: /\bConstantinople\b/, es: /\bConstantinople\b/ },
  },
  {
    id: 'Arian',
    english: /\bArian\b/,
    renderings: { de: { arianisch: /\barian\w+/i }, es: { arriano: /\barrian\w+/i } },
    never: { es: /\barian\w*/i },
  },
  {
    id: 'ecumenical',
    english: /\becumenical\b/i,
    renderings: { de: { ökumenisch: /(?<!\p{L})ökumenisch\p{L}*/iu }, es: { ecuménico: /\becuménic\w+/i } },
  },
];

/** Translated text per scene, joined in cue order. */
function translatedScenes(lang: Lang) {
  const byScene = new Map<string, string[]>();
  for (const cue of (track(lang).cues ?? []) as Json[]) {
    byScene.set(String(cue.scene), [...(byScene.get(String(cue.scene)) ?? []), String(cue.text ?? '')]);
  }
  return byScene;
}
const englishScenes = () =>
  spec().scenes.filter((scene) => scene.narration?.cues.length).map((scene) => ({ id: scene.id, text: scene.narration!.cues.map((cue) => cue.text).join(' ') }));

// ---------------------------------------------------------------------------------------------

describe('#84 track data: every English cue, same identity, English timing', () => {
  for (const lang of LANGS) {
    it(`${lang}: header names the project, language and label`, () => {
      const data = track(lang);
      expect({ schema: data.schema, schemaVersion: data.schemaVersion, project: data.project, language: data.language, label: data.label }).toEqual({
        schema: 'interactive-videos/council-subtitles',
        schemaVersion: 1,
        project: PROJECT,
        language: lang,
        label: LANGUAGES[lang].label,
      });
    });

    it(`${lang}: one cue per English cue, same (scene, index) in spoken order, text only (never re-timed)`, () => {
      const english = englishCues();
      expect(english.length, 'English cues on the spec').toBeGreaterThan(10);
      const cues = track(lang).cues as Json[];
      expect(Array.isArray(cues), 'cues is an array').toBe(true);
      expect(cues.length, 'same cue count as English').toBe(english.length);
      expect(cues.map((cue) => [cue.scene, cue.index])).toEqual(english.map((cue) => [cue.scene, cue.index]));
      for (const cue of cues) {
        expect(Object.keys(cue).sort(), `${cue.scene}#${cue.index}: only scene, index, text (timing is the English cue's)`).toEqual(['index', 'scene', 'text']);
      }
    });

    it(`${lang}: non-empty, legible text within the format's subtitle limit`, () => {
      const { tokens } = moenarchShort();
      const limit = tokens.typography.subtitleMaxCharsPerLine * tokens.subtitles.maxLines;
      for (const cue of track(lang).cues as Json[]) {
        expect(typeof cue.text, `${cue.scene}#${cue.index}`).toBe('string');
        expect(cue.text.trim().length, `${cue.scene}#${cue.index} is not empty`).toBeGreaterThan(0);
        expect(cue.text, `${cue.scene}#${cue.index}: no surrounding whitespace or line breaks`).toBe(cue.text.trim().replace(/\s+/g, ' '));
        expect(cue.text.length, `${cue.scene}#${cue.index} "${cue.text}" fits ${limit} characters`).toBeLessThanOrEqual(limit);
        expect(cue.text, `${cue.scene}#${cue.index}: no placeholder`).not.toMatch(/\b(?:TODO|TBD|FIXME|XXX|lorem ipsum)\b|\[(?:de|es|translate|missing)[^\]]*\]/i);
      }
    });

    it(`${lang}: applying the track keeps every cue window identical to English and shows the translated text`, async () => {
      const { validateSubtitleTranslation, applySubtitleTranslation } = await translationModule();
      const base = spec();
      const result = validateSubtitleTranslation(base, track(lang));
      expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(true);
      const applied = applySubtitleTranslation(base, (result as { translation: unknown }).translation);
      const before = narrationSchedule(base);
      const after = narrationSchedule(applied);
      expect(after.durationInFrames).toBe(before.durationInFrames);
      const windows = (schedule: typeof before) => schedule.scenes.map((scene) => ({ id: scene.id, from: scene.from, durationInFrames: scene.durationInFrames, cues: scene.cues.map(({ from, durationInFrames }) => ({ from, durationInFrames })), marks: scene.marks, audio: scene.audio }));
      expect(windows(after)).toEqual(windows(before));
      expect(after.scenes.flatMap((scene) => scene.cues.map((cue) => cue.text))).toEqual((track(lang).cues as Json[]).map((cue) => cue.text));
      // The English spec is not modified in place.
      expect(englishCues(base).map((cue) => cue.text)).toEqual(englishCues().map((cue) => cue.text));
      // Applied cue timing (ms) equals English timing.
      expect(englishCues(applied).map(({ scene, index, startMs, endMs }) => [scene, index, startMs, endMs])).toEqual(englishCues().map(({ scene, index, startMs, endMs }) => [scene, index, startMs, endMs]));
    });
  }
});

describe('#84 track data: real translations in the right language', () => {
  for (const lang of LANGS) {
    const other = LANGS.find((candidate) => candidate !== lang)!;

    it(`${lang}: no cue is the English text (except names and numbers)`, () => {
      const english = englishCues();
      (track(lang).cues as Json[]).forEach((cue, position) => {
        const source = english[position];
        if (normalize(cue.text) === normalize(source.text)) {
          const unchanged = words(cue.text).filter((word) => !SAME_IN_ALL.test(word));
          expect(unchanged, `${cue.scene}#${cue.index} "${cue.text}" is the English cue untranslated`).toEqual([]);
        }
      });
    });

    it(`${lang}: no leftover English sentences or fragments`, () => {
      const all: string[] = [];
      for (const cue of track(lang).cues as Json[]) {
        const list = words(cue.text);
        all.push(...list);
        const englishWords = list.filter((word) => ENGLISH_ONLY.has(word));
        expect(englishWords.length, `${cue.scene}#${cue.index} "${cue.text}" contains English function words: ${englishWords.join(', ')}`).toBeLessThan(2);
      }
      expect(count(all, ENGLISH_ONLY) / all.length, 'share of English-only function words in the track').toBeLessThan(0.02);
    });

    it(`${lang}: reads as ${LANGUAGES[lang].label} (function words and diacritics), not as ${LANGUAGES[other].label}`, () => {
      const cues = track(lang).cues as Json[];
      const all = cues.flatMap((cue) => words(cue.text));
      expect(count(all, STOPWORDS[lang]) / all.length, `share of ${lang} function words`).toBeGreaterThanOrEqual(0.2);
      expect(count(all, exclusive(other)) / all.length, `share of ${other} function words`).toBeLessThan(0.06);
      for (const cue of cues) {
        const list = words(cue.text);
        if (list.length < 4) continue;
        // A cue of four or more words has a function word or a letter of its language, and more of
        // those than function words of the other language.
        const own = count(list, STOPWORDS[lang]) + (DIACRITICS[lang].test(cue.text) ? 1 : 0);
        expect(own, `${cue.scene}#${cue.index} "${cue.text}" has a ${lang} function word or letter`).toBeGreaterThan(0);
        expect(own, `${cue.scene}#${cue.index} "${cue.text}" reads as ${lang}, not ${other}`).toBeGreaterThan(count(list, exclusive(other)));
      }
      const accented = cues.filter((cue) => DIACRITICS[lang].test(cue.text)).length;
      expect(accented, `cues with ${lang} letters (${DIACRITICS[lang].source})`).toBeGreaterThanOrEqual(3);
      const foreign = cues.filter((cue) => FOREIGN_LETTERS[lang].test(cue.text)).map((cue) => cue.text);
      expect(foreign, `cues with letters foreign to ${lang}`).toEqual([]);
    });
  }

  it('the German and Spanish tracks are different texts', () => {
    const de = (track('de').cues as Json[]).map((cue) => normalize(cue.text));
    const es = (track('es').cues as Json[]).map((cue) => normalize(cue.text));
    const same = de.filter((text, index) => text === es[index] && words(text).some((word) => !SAME_IN_ALL.test(word)));
    expect(same).toEqual([]);
  });
});

describe('#84 translation provenance', () => {
  for (const lang of LANGS) {
    it(`${lang}: names the translator, the English source it was made from, and a review status`, () => {
      const { provenance } = track(lang);
      expect(provenance, 'provenance').toBeDefined();
      expect(provenance.translatedFrom, 'provenance.translatedFrom').toEqual({ language: 'en', cuesSha256: englishCuesSha256() });
      expect(['agent', 'human'], 'provenance.translator.kind').toContain(provenance.translator?.kind);
      expect(String(provenance.translator?.name ?? '').trim().length, 'provenance.translator.name').toBeGreaterThan(0);
      expect(['pending', 'approved', 'changes-requested'], 'provenance.review.status').toContain(provenance.review?.status);
      if (provenance.review.status === 'approved') {
        const reviewer = String(provenance.review.reviewer ?? '').trim();
        expect(reviewer.length, 'an approved review names its reviewer').toBeGreaterThan(0);
        expect(reviewer, 'the reviewer is not the translator').not.toBe(String(provenance.translator.name).trim());
        expect(provenance.review.date, 'an approved review has a date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (provenance.review.reference !== undefined) expect(provenance.review.reference).toMatch(/^https:\/\/\S+$/);
    });
  }
});

describe('#84 terminology (consistent within each language)', () => {
  for (const lang of LANGS) {
    it(`${lang}: every required term is rendered where English uses it, one rendering per concept`, () => {
      const translated = translatedScenes(lang);
      const fullText = [...translated.values()].flat().join(' ');
      for (const concept of CONCEPTS) {
        const renderings = Object.entries(concept.renderings[lang]);
        const triggering = englishScenes().filter((scene) => concept.english.test(scene.text));
        if (triggering.length === 0) continue;
        if (concept.trackLevel) {
          const scopeText = triggering.map((scene) => (translated.get(scene.id) ?? []).join(' ')).join(' ');
          expect(renderings.some(([, pattern]) => pattern.test(scopeText)), `${lang}: "${concept.id}" rendered as ${renderings.map(([id]) => id).join(' | ')} in ${triggering.map((scene) => scene.id).join(', ')}`).toBe(true);
        } else {
          for (const scene of triggering) {
            const text = (translated.get(scene.id) ?? []).join(' ');
            expect(renderings.some(([, pattern]) => pattern.test(text)), `${lang} scene ${scene.id}: "${concept.id}" rendered as ${renderings.map(([id]) => id).join(' | ')} in "${text}"`).toBe(true);
          }
        }
        const used = renderings.filter(([, pattern]) => pattern.test(fullText)).map(([id]) => id);
        expect(used.length, `${lang}: "${concept.id}" uses one rendering throughout, not ${used.join(' and ')}`).toBeLessThanOrEqual(1);
        const never = concept.never?.[lang];
        if (never) expect(fullText, `${lang}: "${concept.id}" never as ${never.source}`).not.toMatch(never);
      }
    });
  }

  it('de: the place-name spelling of Nicaea and its adjective agree (c or z throughout)', () => {
    const fullText = (track('de').cues as Json[]).map((cue) => cue.text).join(' ');
    const consonants = new Set([...fullText.matchAll(/\bni([cz])ä\w*/giu)].map((match) => match[1].toLowerCase()));
    expect([...consonants], 'Nicäa/nicänisch or Nizäa/nizänisch, not both').toHaveLength(consonants.size > 0 ? 1 : 0);
  });

  it('de: uses "wesensgleich" for homoousios; es: renders it as consustancial/consubstancial', () => {
    expect((track('de').cues as Json[]).map((cue) => cue.text).join(' ')).toMatch(/\bwesensgleich/i);
    expect((track('es').cues as Json[]).map((cue) => cue.text).join(' ')).toMatch(/\bconsu(?:b)?stancial/i);
  });
});

describe('#84 fail-closed: a broken track is never offered', () => {
  const variants = (lang: Lang): [string, (data: Json) => void][] => [
    ['a cue is missing', (data) => data.cues.splice(Math.floor(data.cues.length / 2), 1)],
    ['the last cue is missing', (data) => data.cues.pop()],
    ['a cue text is empty', (data) => (data.cues[3].text = '')],
    ['a cue text is whitespace', (data) => (data.cues[5].text = '   ')],
    ['a cue has no text', (data) => delete data.cues[2].text],
    ['a cue is duplicated', (data) => data.cues.splice(4, 0, { ...data.cues[4] })],
    ['two cues are swapped', (data) => ([data.cues[1], data.cues[2]] = [data.cues[2], data.cues[1]])],
    ['a cue names an unknown scene', (data) => (data.cues[0].scene = 'no-such-scene')],
    ['a cue is re-timed', (data) => Object.assign(data.cues[0], { startMs: 0, endMs: 9999 })],
    ['the cues are missing', (data) => delete data.cues],
    ['the English source changed (stale cuesSha256)', (data) => (data.provenance.translatedFrom.cuesSha256 = '0'.repeat(64))],
    ['the provenance is missing', (data) => delete data.provenance],
    ['the project is another one', (data) => (data.project = 'latency-explainer')],
    ['the language is unknown', (data) => (data.language = lang === 'de' ? 'xx' : '')],
  ];

  for (const lang of LANGS) {
    it(`${lang}: the committed track is valid`, async () => {
      const { validateSubtitleTranslation } = await translationModule();
      const result = validateSubtitleTranslation(spec(), track(lang));
      expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(true);
    });

    for (const [name, mutate] of variants(lang)) {
      it(`${lang}: validation rejects the track when ${name}`, async () => {
        const { validateSubtitleTranslation } = await translationModule();
        const data = structuredClone(track(lang));
        mutate(data);
        const result = validateSubtitleTranslation(spec(), data);
        expect(result.ok, `${name}: must not validate`).toBe(false);
        expect((result as { errors: string[] }).errors.length, 'the rejection explains itself').toBeGreaterThan(0);
      });
    }

    it(`${lang}: the catalog does not offer the track when a cue is missing or empty`, () => {
      for (const [name, mutate] of variants(lang).slice(0, 3)) {
        const broken = structuredClone(track(lang));
        mutate(broken);
        const otherLang = LANGS.find((candidate) => candidate !== lang)!;
        const sources = [
          {
            spec: rawSpec(),
            format: moenarchShort(),
            subtitles: [
              { language: 'en', label: 'English' },
              { language: lang, label: LANGUAGES[lang].label, translation: broken },
              { language: otherLang, label: LANGUAGES[otherLang].label, translation: track(otherLang) },
            ],
          },
        ];
        let built: ReturnType<typeof createCatalog> | undefined;
        try {
          built = createCatalog(sources as never, PROJECT);
        } catch {
          continue; // refusing the source outright is also fail-closed
        }
        const resolved = built.resolve(PROJECT);
        if (!resolved.ok) continue;
        const offered = (resolved.composition.subtitles ?? []).map((option) => option.language);
        expect(offered, `${name}: ${lang} is not offered`).not.toContain(lang);
        expect(offered, `${name}: the valid tracks stay offered`).toEqual(['en', otherLang]);
      }
    });
  }

  it('a translation of the Nicaea cues is not offered for another project', () => {
    const latency = JSON.parse(readFileSync(join(ROOT, 'src', 'spec', 'fixtures', 'latency-explainer.videospec.json'), 'utf8'));
    const sources = [
      { spec: rawSpec(), format: moenarchShort() },
      { spec: latency, format: latencyFormat, subtitles: [{ language: 'de', label: 'Deutsch', translation: track('de') }] },
    ];
    let built: ReturnType<typeof createCatalog> | undefined;
    try {
      built = createCatalog(sources as never, PROJECT);
    } catch {
      return; // refusing the source outright is also fail-closed
    }
    const resolved = built.resolve(latency.project.id);
    if (!resolved.ok) return;
    expect((resolved.composition.subtitles ?? []).map((option) => option.language)).not.toContain('de');
  });
});

describe('#84 catalog: Nicaea I offers English, Deutsch, Español; other projects are unchanged', () => {
  it('resolves council-nicaea-325 with the tracks en English, de Deutsch, es Español in that order', () => {
    const resolved = catalog.resolve(PROJECT);
    expect(resolved.ok, resolved.ok ? '' : resolved.message).toBe(true);
    if (!resolved.ok) return;
    expect((resolved.composition.subtitles ?? []).map(({ language, label }) => ({ language, label }))).toEqual([
      { language: 'en', label: 'English' },
      { language: 'de', label: 'Deutsch' },
      { language: 'es', label: 'Español' },
    ]);
  });

  it('keeps every other project resolvable, without subtitle tracks', () => {
    const ids = catalog.projects.map((project) => project.id);
    for (const id of OTHER_PROJECTS) {
      expect(ids, id).toContain(id);
      const resolved = catalog.resolve(id);
      expect(resolved.ok, `${id}: ${resolved.ok ? '' : resolved.message}`).toBe(true);
      if (resolved.ok) expect(resolved.composition.subtitles, `${id} offers no subtitle tracks`).toBeUndefined();
    }
    expect(catalog.defaultId).toBe('latency-explainer');
  });

  it('a project registered with only English offers only English', () => {
    const built = createCatalog([{ spec: rawSpec(), format: moenarchShort(), subtitles: [{ language: 'en', label: 'English' }] }], PROJECT);
    const resolved = built.resolve(PROJECT);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect((resolved.composition.subtitles ?? []).map(({ language, label }) => ({ language, label }))).toEqual([{ language: 'en', label: 'English' }]);
  });

  it('the English narration and its cues are unchanged by the translations (#82 contract)', () => {
    // The English spec stays the authority: its cue texts are the script, its timing the audio's.
    const registered = catalog.spec(PROJECT)!;
    expect(englishCues(registered).map(({ scene, index, startMs, endMs, text }) => [scene, index, startMs, endMs, text])).toEqual(
      englishCues().map(({ scene, index, startMs, endMs, text }) => [scene, index, startMs, endMs, text]),
    );
  });
});
