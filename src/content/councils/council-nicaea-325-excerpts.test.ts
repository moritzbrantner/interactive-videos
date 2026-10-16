// Acceptance contract for issue #86 (Nicaea I: inspect annotated source excerpts), written by an
// independent acceptance context before any implementation, against baseline be4d033. Intent:
// Decision Atlas 1.1, 1.2, 1.4, 1.6, 3.12, 3.14 (answers 3.13) and 3.16, and the
// "Source-inspection acceptance" and "Context-language acceptance" sections of #61. Companion Pages
// journey (pointer, keyboard, language, return): e2e/council-nicaea-325-excerpts.spec.ts.
//
// Seams (new; laid out like the #85 context files and validated like them):
//
// 1. Excerpt data, one file per language, next to context/ and subtitles/:
//      src/content/councils/nicaea-325/excerpts/en.json   (structure + English text)
//      src/content/councils/nicaea-325/excerpts/de.json   (German text only)
//      src/content/councils/nicaea-325/excerpts/es.json   (Spanish text only)
//    en.json:
//    { schema: "interactive-videos/council-excerpts", schemaVersion: 1,
//      project: "council-nicaea-325", language: "en",
//      excerpts: [{
//        id: string,                     // stable, kebab-case; "nicene-creed" is fixed (below)
//        title: string,                  // trigger name and inspection heading
//        source: string,                 // an id in nicaea-325/sources.json (kind "primary")
//        standing: "council-act" | "contemporary-witness" | "later-witness",
//                                        // Atlas 3.14: what the passage is relative to the
//                                        // council's own decisions; commentary is never an act
//        locator: { work: string, section: string },
//                                        // exact place in the source: work, and book/chapter,
//                                        // canon number or "Creed, with its anathema"
//        url?: "https://…",              // a deep link to the longer source; else source.url
//        original:                       // the original-language text, never invented:
//            { status: "included", language: "grc" | "la", text: string, edition: string, note: string }
//          | { status: "lost" | "not-included", note: string },
//                                        // `note` (English; localized in de/es) says how the
//                                        // original is transmitted (e.g. only through later
//                                        // witnesses), that it is lost, or why it is not shown
//        translation: { status: "included", text: string,
//                       translator: { kind: "published", name: string }, edition: string,
//                       translatedFrom: "grc" | "la", url?: "https://…" },
//                                        // English is an attributable published translation,
//                                        // e.g. H. R. Percival, NPNF II/14
//        explanation: string,            // historical explanation of the passage and its relation
//                                        // to the council's decisions or reception
//        annotations: [{ id: string, term: string, note: string }],
//                                        // `term` occurs verbatim (case-insensitive) in the
//                                        // translation or the original; `note` explains it
//        references: [{ scene: <scene id>, anchor: string }]
//                                        // where the episode references the excerpt: as in #85,
//                                        // the reference trigger is shown for the whole scene of
//                                        // the resolved timeline, and `anchor` is on-screen text
//      }, …] }
//
//    de.json / es.json (text only; structure is never duplicated per language):
//    { schema: "interactive-videos/council-excerpts", schemaVersion: 1,
//      project: "council-nicaea-325", language: "de" | "es",
//      provenance: {                     // who translated the title, explanation and notes
//        translatedFrom: { language: "en", excerptsSha256: <hex> },
//        translator: { kind: "agent" | "human", name: string },
//        review: { status: "pending" | "approved" | "changes-requested",
//                  reviewer?: string, date?: "YYYY-MM-DD", reference?: "https://…" } },
//      excerpts: [{ id, title, explanation, originalNote,
//                   annotations: [{ id, term, note }],      // the English ids, same order
//                   translation:
//                       { status: "included", text, translator: { kind: "published" | "agent" | "human", name },
//                         translatedFrom: "grc" | "la" | "en", edition?: string, url?: "https://…" }
//                                                           // edition required for "published"
//                     | { status: "missing" } }, …] }       // every English excerpt, same order
//    A missing translation is an explicit marker, never a copy of the English text: the Player
//    then shows the English translation tagged lang="en" with a visible "no translation" label in
//    the viewer's language (Atlas 3.12). Translations translatedFrom "en" are translations of a
//    translation and must say so (the provenance line shows it).
//    `excerptsSha256` is the lowercase hex SHA-256 of the UTF-8 bytes of JSON.stringify(
//      excerpts.map(e => [e.id, e.title, e.explanation, e.original.note,
//                         e.original.status === "included" ? e.original.text : null,
//                         e.translation.text, e.annotations.map(a => [a.id, a.term, a.note])]))
//    over the English excerpts in order, so a change to the English text, the original or the
//    English translation makes a translation stale (and invalid) instead of silently out of date.
//
// 2. Validation, a pure module next to the #85 one: src/spec/council-excerpts.ts
//      validateExcerptTranslation(english: unknown, data: unknown)
//        => { ok: true; translation: unknown } | { ok: false; errors: string[] }
//    (an English validator and an `excerptsSha256` helper, as in council-context.ts, are expected
//    but their names are the implementation's choice). Fails closed, like #85: see the rejected
//    mutations below. The Player never shows an invalid translation as translated; it falls back
//    to English, marked as untranslated.
//
// 3. Language: as in #85, the excerpt language is the toolbar "Subtitles" selection (English,
//    Deutsch, Español → en, de, es; Off → en), passed to the overlay as its `language` prop until
//    #70 replaces the source of that value. No second language control, URL state or storage.
//    The original text never changes with the language; translation, explanation, notes and
//    controls do.
//
// 4. One overlay system: the excerpt references and inspections are added to the existing
//    browser-only context overlay (src/player/context-overlay.tsx, created in src/projects.ts),
//    not a second overlay, player or document reader (Atlas 3.14: no full in-app reader; a link to
//    the longer source suffices). Player DOM and playback: header of the e2e spec.
//
// Fixed content (genuine, checkable passages; wording and translations are reviewed by hand):
// - "nicene-creed": the Creed of 325 with its anathema; source nicaea-creed-and-canons, standing
//   council-act, Greek original included (grc) and containing ὁμοούσιον, γεννηθέντα οὐ ποιηθέντα
//   and ἦν ποτε ὅτε οὐκ ἦν; the English translation contains the creed scene's on-screen quotation
//   and "there was a time when"; referenced in scene "creed"; German and Spanish translations of
//   the passage included (with provenance), so the language switch is demonstrable.
// - At least one further council text: a canon (locator section "Canon <n>", e.g. canon 6) or the
//   Easter passage of the synodal letter (section mentioning the synodal letter), standing
//   council-act, referenced in scene "canons" or "easter". Its original is included (Greek or
//   Latin) or explicitly marked "lost" / "not-included".
//
// Non-automated acceptance (stays on the PR / issue): an independent source review of every
// excerpt (the original and English translation transcribed faithfully from the cited edition, the
// locator exact, the explanation and annotations historically accurate and not presenting later
// commentary as a council act, Catholic framing with fair representation of others, Atlas 3.6),
// and an independent translation review of the German and Spanish texts and of any agent-made
// passage translation. The heuristics below only catch missing, untranslated or wrong-language text.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { catalog } from '@/projects';
import { assertVideoSpec, resolveTimeline, type VideoSpec } from '@/spec/video-spec';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PROJECT = 'council-nicaea-325';
const CONTENT = join(ROOT, 'src', 'content', 'councils', 'nicaea-325');
const EXCERPTS = join(CONTENT, 'excerpts');
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`);
const SCHEMA = 'interactive-videos/council-excerpts';
const CREED = 'nicene-creed';

type Lang = 'de' | 'es';
const LANGS: Lang[] = ['de', 'es'];
const LABEL: Record<Lang, string> = { de: 'German', es: 'Spanish' };
const STANDINGS = ['council-act', 'contemporary-witness', 'later-witness'];
const ORIGINAL_LANGUAGES = ['grc', 'la'];
const EN_FIELDS = ['id', 'title', 'source', 'standing', 'locator', 'url', 'original', 'translation', 'explanation', 'annotations', 'references'];
const TR_FIELDS = ['annotations', 'explanation', 'id', 'originalNote', 'title', 'translation'];

const spec = (): VideoSpec => assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
const sources = () => new Map((JSON.parse(readFileSync(join(CONTENT, 'sources.json'), 'utf8')).sources as Json[]).map((source) => [source.id as string, source]));

function file(lang: 'en' | Lang): Json {
  const path = join(EXCERPTS, `${lang}.json`);
  expect(existsSync(path), `${relative(ROOT, path)} exists`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}
const excerpts = (lang: 'en' | Lang) => file(lang).excerpts as Json[];
const byId = (lang: 'en' | Lang) => new Map(excerpts(lang).map((excerpt) => [excerpt.id as string, excerpt]));
const creed = () => {
  const found = byId('en').get(CREED);
  expect(found, `excerpt "${CREED}" exists`).toBeDefined();
  return found!;
};
/** The further council text: a canon or the synodal letter's Easter passage. */
const isCanonOrLetter = (excerpt: Json) => /\bcanon\s+\d+\b|synodal letter/i.test(String(excerpt?.locator?.section ?? ''));
const furtherCouncilText = () => excerpts('en').filter((excerpt) => excerpt.id !== CREED && isCanonOrLetter(excerpt));

const excerptsSha256 = (english: Json) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        (english.excerpts as Json[]).map((e) => [
          e.id,
          e.title,
          e.explanation,
          e.original.note,
          e.original.status === 'included' ? e.original.text : null,
          e.translation.text,
          (e.annotations as Json[]).map((a) => [a.id, a.term, a.note]),
        ]),
      ),
      'utf8',
    )
    .digest('hex');

/** All string values of a scene payload: the scene's on-screen text. */
function onScreenText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(onScreenText);
  if (value && typeof value === 'object') return Object.values(value).flatMap(onScreenText);
  return [];
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Greek or Latin compared without accents, breathings or case; final sigma folded. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ς/g, 'σ').toLocaleLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------------------------
// Language heuristics, reused from the #84 / #85 contracts.

const words = (text: string) => (text.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((word) => word.toLocaleLowerCase());
const normalize = (text: string) => words(text).join(' ');
const ENGLISH_ONLY = new Set(['the', 'and', 'of', 'that', 'which', 'with', 'were', 'this', 'from', 'they', 'their', 'would', 'been', 'have', 'his', 'she', 'it', 'is', 'who', 'did', 'by', 'to', 'on', 'for', 'are', 'its', 'be', 'still', 'today', 'most', 'some', 'not']);
const STOPWORDS: Record<Lang, Set<string>> = {
  de: new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'zu', 'von', 'vom', 'mit', 'sich', 'auf', 'für', 'im', 'zum', 'zur', 'wurde', 'wurden', 'er', 'sie', 'auch', 'dass', 'als', 'nach', 'aus', 'bei', 'wie', 'war', 'waren', 'noch', 'nur', 'sein', 'seine', 'seinen', 'ihre', 'ihn', 'ihm', 'hat', 'haben', 'am', 'heute', 'oder', 'sind', 'kein', 'keine', 'keinen', 'man', 'diese', 'diesen', 'dieser', 'dieses', 'über', 'um', 'wird', 'werden']),
  es: new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'no', 'se', 'por', 'con', 'para', 'su', 'sus', 'al', 'lo', 'como', 'fue', 'fueron', 'más', 'pero', 'le', 'era', 'hoy', 'muchas', 'o', 'a', 'este', 'esta', 'sobre', 'hubo', 'es', 'son', 'ya', 'también', 'aún']),
};
const DIACRITICS: Record<Lang, RegExp> = { de: /[äöüßÄÖÜ]/u, es: /[áéíóúñÁÉÍÓÚÑ¿¡]/u };
const FOREIGN_LETTERS: Record<Lang, RegExp> = { de: /[ñÑ¿¡áíóúÁÍÓÚ]/u, es: /[äöß]/u };
const SHARED = new Set(['es']);
const count = (list: string[], set: Set<string>) => list.filter((word) => set.has(word)).length;
const exclusive = (lang: Lang) => new Set([...STOPWORDS[lang]].filter((word) => !SHARED.has(word)));
/** Words that may appear unchanged in a translated title (names, numbers, Greek terms). */
const SAME_IN_ALL = /^(?:\d+|nicaea|alexandria|homoousios|credo|canon)$/;

/** The localized prose of a translated excerpt (the Greek/Latin `term`s are excluded). */
function prose(excerpt: Json): { field: string; text: string }[] {
  const fields = [
    { field: 'title', text: excerpt.title },
    { field: 'explanation', text: excerpt.explanation },
    { field: 'originalNote', text: excerpt.originalNote },
    ...((excerpt.annotations ?? []) as Json[]).map((annotation) => ({ field: `annotations.${annotation.id}.note`, text: annotation.note })),
  ];
  if (excerpt.translation?.status === 'included') fields.push({ field: 'translation.text', text: excerpt.translation.text });
  return fields.map(({ field, text }) => ({ field, text: String(text ?? '') }));
}

async function excerptModule() {
  let module: Json;
  try {
    module = await import('@/spec/council-excerpts');
  } catch (error) {
    throw new Error(`src/spec/council-excerpts.ts must exist and export validateExcerptTranslation: ${String(error)}`);
  }
  expect(typeof module.validateExcerptTranslation, 'validateExcerptTranslation is exported').toBe('function');
  return module as { validateExcerptTranslation: (english: unknown, data: unknown) => { ok: true; translation: unknown } | { ok: false; errors: string[] } };
}

// ---------------------------------------------------------------------------------------------

describe('#86 English excerpts (structure, sources, locators, originals, references)', () => {
  it('en.json has the schema header of this project and at least two excerpts', () => {
    const english = file('en');
    expect({ schema: english.schema, schemaVersion: english.schemaVersion, project: english.project, language: english.language }).toEqual({
      schema: SCHEMA,
      schemaVersion: 1,
      project: PROJECT,
      language: 'en',
    });
    expect(Array.isArray(english.excerpts) && english.excerpts.length >= 2, 'at least two excerpts').toBe(true);
  });

  it('every excerpt has a unique kebab-case id, only the documented fields and a known standing', () => {
    const seen = new Set<string>();
    for (const excerpt of excerpts('en')) {
      expect(excerpt.id, 'id').toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(seen.has(excerpt.id), `duplicate id ${excerpt.id}`).toBe(false);
      seen.add(excerpt.id);
      const extra = Object.keys(excerpt).filter((key) => !EN_FIELDS.includes(key));
      expect(extra, `${excerpt.id}: undocumented fields`).toEqual([]);
      expect(nonEmpty(excerpt.title), `${excerpt.id}.title`).toBe(true);
      expect(STANDINGS, `${excerpt.id}.standing`).toContain(excerpt.standing);
    }
  });

  it('every excerpt cites a primary source of sources.json, with an exact locator and a traceable link', () => {
    const known = sources();
    for (const excerpt of excerpts('en')) {
      const source = known.get(excerpt.source);
      expect(source, `${excerpt.id} cites unknown source "${excerpt.source}"`).toBeDefined();
      expect(source!.kind, `${excerpt.id}: an excerpt quotes a primary source`).toBe('primary');
      expect(Object.keys(excerpt.locator ?? {}).sort(), `${excerpt.id}.locator is { work, section }`).toEqual(['section', 'work']);
      expect(nonEmpty(excerpt.locator.work) && nonEmpty(excerpt.locator.section), `${excerpt.id}.locator has a work and a section`).toBe(true);
      // The section pins the passage: a canon number, chapter, book or the named part of the document.
      expect(excerpt.locator.section, `${excerpt.id}.locator.section is exact`).toMatch(/\d|creed|anathema|synodal letter|letter/i);
      const link = excerpt.url ?? source!.url;
      expect(link, `${excerpt.id} links to the longer source`).toMatch(/^https:\/\/\S+$/);
    }
  });

  it('every original is included with its language, edition and note, or explicitly marked lost / not included', () => {
    for (const excerpt of excerpts('en')) {
      const { original } = excerpt;
      expect(['included', 'lost', 'not-included'], `${excerpt.id}.original.status`).toContain(original?.status);
      expect(nonEmpty(original.note), `${excerpt.id}.original.note says how the original is transmitted or why it is absent`).toBe(true);
      if (original.status === 'included') {
        expect(Object.keys(original).sort(), `${excerpt.id}.original fields`).toEqual(['edition', 'language', 'note', 'status', 'text']);
        expect(ORIGINAL_LANGUAGES, `${excerpt.id}.original.language (BCP 47)`).toContain(original.language);
        expect(nonEmpty(original.text) && nonEmpty(original.edition), `${excerpt.id}.original has text and edition`).toBe(true);
        const letters = original.text.match(/\p{L}/gu) ?? [];
        const greek = letters.filter((letter: string) => /\p{Script=Greek}/u.test(letter)).length;
        const latin = letters.filter((letter: string) => /\p{Script=Latin}/u.test(letter)).length;
        if (original.language === 'grc') expect(greek / letters.length, `${excerpt.id}: the Greek original is in Greek script`).toBeGreaterThan(0.95);
        else expect(latin / letters.length, `${excerpt.id}: the Latin original is in Latin script`).toBeGreaterThan(0.95);
        expect(normalize(original.text), `${excerpt.id}: the original is not the English translation`).not.toBe(normalize(excerpt.translation.text));
      } else {
        expect(Object.keys(original).sort(), `${excerpt.id}: an absent original carries no text`).toEqual(['note', 'status']);
      }
    }
  });

  it('every English translation is an attributed published translation of the original', () => {
    for (const excerpt of excerpts('en')) {
      const { translation } = excerpt;
      expect(translation?.status, `${excerpt.id}.translation.status`).toBe('included');
      expect(nonEmpty(translation.text), `${excerpt.id}.translation.text`).toBe(true);
      expect(translation.translator?.kind, `${excerpt.id}: the English translation is a published one`).toBe('published');
      expect(nonEmpty(translation.translator?.name), `${excerpt.id}.translation.translator.name`).toBe(true);
      expect(nonEmpty(translation.edition), `${excerpt.id}.translation.edition`).toBe(true);
      expect(ORIGINAL_LANGUAGES, `${excerpt.id}.translation.translatedFrom`).toContain(translation.translatedFrom);
      if (excerpt.original.status === 'included') expect(translation.translatedFrom, `${excerpt.id}: translated from the shown original`).toBe(excerpt.original.language);
      if (translation.url !== undefined) expect(translation.url).toMatch(/^https:\/\/\S+$/);
      expect(words(translation.text).length, `${excerpt.id}: a bounded passage, not a single phrase`).toBeGreaterThanOrEqual(20);
      // Atlas 3.14: bounded, not a full document.
      expect(words(translation.text).length, `${excerpt.id}: a bounded passage, not a whole document`).toBeLessThanOrEqual(400);
    }
  });

  it('every excerpt has an English explanation and annotations whose terms occur in the passage', () => {
    for (const excerpt of excerpts('en')) {
      expect(words(String(excerpt.explanation ?? '')).length, `${excerpt.id}.explanation has real content`).toBeGreaterThanOrEqual(30);
      const all = words(excerpt.explanation);
      expect(count(all, ENGLISH_ONLY) / all.length, `${excerpt.id}.explanation reads as English`).toBeGreaterThanOrEqual(0.1);
      expect(normalize(excerpt.explanation), `${excerpt.id}: the explanation is more than the passage`).not.toBe(normalize(excerpt.translation.text));
      expect(Array.isArray(excerpt.annotations) && excerpt.annotations.length > 0, `${excerpt.id} is annotated`).toBe(true);
      const ids = new Set<string>();
      for (const annotation of excerpt.annotations as Json[]) {
        expect(Object.keys(annotation).sort(), `${excerpt.id}: an annotation is { id, term, note }`).toEqual(['id', 'note', 'term']);
        expect(annotation.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(ids.has(annotation.id), `${excerpt.id}: duplicate annotation ${annotation.id}`).toBe(false);
        ids.add(annotation.id);
        expect(nonEmpty(annotation.term) && nonEmpty(annotation.note), `${excerpt.id}/${annotation.id} has a term and a note`).toBe(true);
        const passage = fold(`${excerpt.translation.text} \n ${excerpt.original.text ?? ''}`);
        expect(passage, `${excerpt.id}/${annotation.id}: term "${annotation.term}" occurs in the passage`).toContain(fold(annotation.term));
        expect(words(annotation.note).length, `${excerpt.id}/${annotation.id}.note explains`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('every reference is a scene of the episode, anchored to on-screen text, long enough to open', () => {
    const subject = spec();
    const timeline = resolveTimeline(subject);
    const fps = subject.output.fps;
    for (const excerpt of excerpts('en')) {
      expect(Array.isArray(excerpt.references) && excerpt.references.length > 0, `${excerpt.id} is referenced somewhere`).toBe(true);
      let longest = 0;
      for (const reference of excerpt.references as Json[]) {
        expect(Object.keys(reference).sort(), `${excerpt.id}: a reference is { scene, anchor }`).toEqual(['anchor', 'scene']);
        const scene = timeline.scenes.find((candidate) => candidate.id === reference.scene);
        expect(scene, `${excerpt.id} names unknown scene "${reference.scene}"`).toBeDefined();
        const text = onScreenText(subject.scenes.find((candidate) => candidate.id === reference.scene)!.payload).join(' \n ');
        expect(nonEmpty(reference.anchor), `${excerpt.id}@${reference.scene} has an anchor`).toBe(true);
        expect(text.toLocaleLowerCase(), `${excerpt.id}@${reference.scene}: anchor "${reference.anchor}" is on screen`).toContain(reference.anchor.toLocaleLowerCase());
        longest = Math.max(longest, scene!.durationInFrames);
      }
      expect(longest / fps, `${excerpt.id} is referenced for at least 3 s somewhere`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('#86 the genuine council texts (Atlas 3.14)', () => {
  it('the Nicene Creed of 325 with its anathema, in Greek, quoted by the creed scene', () => {
    const excerpt = creed();
    expect(excerpt.source).toBe('nicaea-creed-and-canons');
    expect(excerpt.standing).toBe('council-act');
    expect(excerpt.original.status, 'the Greek of the Creed survives (through later witnesses) and is shown').toBe('included');
    expect(excerpt.original.language).toBe('grc');
    const greek = fold(excerpt.original.text);
    for (const phrase of ['ὁμοούσιον', 'γεννηθέντα οὐ ποιηθέντα', 'ἦν ποτε ὅτε οὐκ ἦν']) {
      expect(greek, `the Greek Creed contains "${phrase}"`).toContain(fold(phrase));
    }
    expect(excerpt.original.note, 'the note names how the Greek text is transmitted').toMatch(/witness|transmit|preserv|surviv|record/i);
    // Compared word by word, ignoring the editor's parenthesized Greek and bracketed insertions
    // (NPNF prints e.g. "begotten (γεννηθέντα), not made").
    const english = normalize(excerpt.translation.text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
    const scene = spec().scenes.find((candidate) => candidate.id === 'creed')!;
    const quotation = normalize(String((scene.payload as Json).text));
    expect(english, 'the English Creed contains the quotation shown in the creed scene').toContain(quotation);
    expect(english, 'the English Creed includes the anathema').toContain('there was a time when');
    expect(excerpt.references.map((reference: Json) => reference.scene), 'the creed scene references the Creed').toContain('creed');
    const annotated = (excerpt.annotations as Json[]).some((annotation) => /homoousi|ὁμοούσι/i.test(`${annotation.term} ${annotation.note}`));
    expect(annotated, 'the Creed is annotated at homoousios').toBe(true);
  });

  it('a canon or the Easter passage of the synodal letter, referenced where the episode names it', () => {
    const further = furtherCouncilText();
    expect(further.length, 'an excerpt whose locator names a canon number or the synodal letter').toBeGreaterThanOrEqual(1);
    const known = sources();
    const referenced = further.filter((excerpt) =>
      excerpt.standing === 'council-act'
      && known.get(excerpt.source)?.id === 'nicaea-creed-and-canons'
      && (excerpt.references as Json[]).some((reference) => reference.scene === 'canons' || reference.scene === 'easter'));
    expect(referenced.map((excerpt) => excerpt.id), 'a council-act canon / letter excerpt referenced in the canons or easter scene').not.toEqual([]);
  });
});

describe('#86 German and Spanish excerpts (complete, translated, current)', () => {
  for (const lang of LANGS) {
    const other = LANGS.find((candidate) => candidate !== lang)!;

    it(`${lang}.json has the schema header, provenance from the current English text and every excerpt in order`, () => {
      const data = file(lang);
      expect({ schema: data.schema, schemaVersion: data.schemaVersion, project: data.project, language: data.language }).toEqual({
        schema: SCHEMA,
        schemaVersion: 1,
        project: PROJECT,
        language: lang,
      });
      const { provenance } = data;
      expect(provenance?.translatedFrom, 'provenance.translatedFrom').toEqual({ language: 'en', excerptsSha256: excerptsSha256(file('en')) });
      expect(['agent', 'human'], 'provenance.translator.kind').toContain(provenance.translator?.kind);
      expect(nonEmpty(provenance.translator?.name), 'provenance.translator.name').toBe(true);
      expect(['pending', 'approved', 'changes-requested'], 'provenance.review.status').toContain(provenance.review?.status);
      if (provenance.review.status === 'approved') {
        expect(nonEmpty(provenance.review.reviewer), 'an approved review names its reviewer').toBe(true);
        expect(provenance.review.reviewer.trim(), 'the reviewer is not the translator').not.toBe(String(provenance.translator.name).trim());
        expect(provenance.review.date, 'an approved review has a date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(excerpts(lang).map((excerpt) => excerpt.id), `${lang}: the English excerpt ids, in order`).toEqual(excerpts('en').map((excerpt) => excerpt.id));
    });

    it(`${lang}: excerpts carry text only, complete, with the English annotations in order`, () => {
      const english = byId('en');
      for (const excerpt of excerpts(lang)) {
        const source = english.get(excerpt.id)!;
        expect(Object.keys(excerpt).sort(), `${lang}/${excerpt.id}: text only; source, locator, original and references stay in en.json`).toEqual(TR_FIELDS);
        for (const field of ['title', 'explanation', 'originalNote'] as const) {
          expect(nonEmpty(excerpt[field]), `${lang}/${excerpt.id}.${field} is non-empty`).toBe(true);
        }
        expect(words(excerpt.explanation).length, `${lang}/${excerpt.id}.explanation has real content`).toBeGreaterThanOrEqual(25);
        expect((excerpt.annotations as Json[]).map((annotation) => annotation.id), `${lang}/${excerpt.id}: the English annotation ids, in order`).toEqual(
          (source.annotations as Json[]).map((annotation) => annotation.id),
        );
        const shown = excerpt.translation?.status === 'included' ? excerpt.translation.text : source.translation.text;
        for (const annotation of excerpt.annotations as Json[]) {
          expect(Object.keys(annotation).sort(), `${lang}/${excerpt.id}/${annotation.id} is { id, term, note }`).toEqual(['id', 'note', 'term']);
          expect(nonEmpty(annotation.term) && nonEmpty(annotation.note), `${lang}/${excerpt.id}/${annotation.id} has a term and a note`).toBe(true);
          expect(fold(`${shown} \n ${source.original.text ?? ''}`), `${lang}/${excerpt.id}/${annotation.id}: term "${annotation.term}" occurs in the shown passage`).toContain(fold(annotation.term));
        }
      }
    });

    it(`${lang}: a passage translation is attributed, or explicitly missing; never the English text`, () => {
      const english = byId('en');
      for (const excerpt of excerpts(lang)) {
        const source = english.get(excerpt.id)!;
        const { translation } = excerpt;
        expect(['included', 'missing'], `${lang}/${excerpt.id}.translation.status`).toContain(translation?.status);
        if (translation.status === 'missing') {
          expect(Object.keys(translation), `${lang}/${excerpt.id}: a missing translation is only the marker`).toEqual(['status']);
          continue;
        }
        expect(nonEmpty(translation.text), `${lang}/${excerpt.id}.translation.text`).toBe(true);
        expect(['published', 'agent', 'human'], `${lang}/${excerpt.id}.translation.translator.kind`).toContain(translation.translator?.kind);
        expect(nonEmpty(translation.translator?.name), `${lang}/${excerpt.id}.translation.translator.name`).toBe(true);
        if (translation.translator.kind === 'published') expect(nonEmpty(translation.edition), `${lang}/${excerpt.id}: a published translation names its edition`).toBe(true);
        expect(['grc', 'la', 'en'], `${lang}/${excerpt.id}.translation.translatedFrom`).toContain(translation.translatedFrom);
        if (translation.translatedFrom !== 'en' && source.original.status === 'included') {
          expect(translation.translatedFrom, `${lang}/${excerpt.id}: translated from the shown original`).toBe(source.original.language);
        }
        if (translation.url !== undefined) expect(translation.url).toMatch(/^https:\/\/\S+$/);
        expect(normalize(translation.text), `${lang}/${excerpt.id}: the "translation" is the English text`).not.toBe(normalize(source.translation.text));
      }
    });

    it(`${lang}: the Creed itself is translated (so the language switch is real)`, () => {
      const excerpt = byId(lang).get(CREED);
      expect(excerpt?.translation?.status, `${lang}/${CREED}.translation`).toBe('included');
    });

    it(`${lang}: no title, explanation or note is the English text`, () => {
      const english = byId('en');
      for (const excerpt of excerpts(lang)) {
        const source = english.get(excerpt.id)!;
        expect(normalize(excerpt.explanation), `${lang}/${excerpt.id}.explanation is the English text`).not.toBe(normalize(source.explanation));
        expect(normalize(excerpt.originalNote), `${lang}/${excerpt.id}.originalNote is the English text`).not.toBe(normalize(source.original.note));
        (excerpt.annotations as Json[]).forEach((annotation, index) => {
          expect(normalize(annotation.note), `${lang}/${excerpt.id}/${annotation.id}.note is the English text`).not.toBe(normalize(source.annotations[index].note));
        });
        if (normalize(excerpt.title) === normalize(source.title)) {
          const unchanged = words(excerpt.title).filter((word) => !SAME_IN_ALL.test(word));
          expect(unchanged, `${lang}/${excerpt.id}.title "${excerpt.title}" is the English title untranslated`).toEqual([]);
        }
      }
    });

    it(`${lang}: no leftover English sentences or fragments`, () => {
      const all: string[] = [];
      for (const excerpt of excerpts(lang)) {
        for (const { field, text } of prose(excerpt)) {
          const list = words(text);
          all.push(...list);
          const english = list.filter((word) => ENGLISH_ONLY.has(word));
          expect(english.length, `${lang}/${excerpt.id}.${field} contains English function words: ${english.join(', ')}`).toBeLessThanOrEqual(2);
        }
      }
      expect(count(all, ENGLISH_ONLY) / all.length, `share of English-only function words in ${lang}.json`).toBeLessThan(0.02);
    });

    it(`${lang}: reads as ${LABEL[lang]}, not as ${LABEL[other]}`, () => {
      const list = excerpts(lang);
      const all = list.flatMap((excerpt) => prose(excerpt).flatMap(({ text }) => words(text)));
      expect(count(all, STOPWORDS[lang]) / all.length, `share of ${lang} function words`).toBeGreaterThanOrEqual(0.2);
      expect(count(all, exclusive(other)) / all.length, `share of ${other} function words`).toBeLessThan(0.06);
      for (const excerpt of list) {
        for (const { field, text } of prose(excerpt)) {
          if (field === 'title') continue;
          const fieldWords = words(text);
          const own = count(fieldWords, STOPWORDS[lang]) + (DIACRITICS[lang].test(text) ? 1 : 0);
          expect(own, `${lang}/${excerpt.id}.${field} has ${lang} function words or letters`).toBeGreaterThan(0);
          expect(own, `${lang}/${excerpt.id}.${field} reads as ${lang}, not ${other}`).toBeGreaterThan(count(fieldWords, exclusive(other)));
        }
        const foreign = prose(excerpt).filter(({ text }) => FOREIGN_LETTERS[lang].test(text)).map(({ field }) => field);
        expect(foreign, `${lang}/${excerpt.id}: fields with letters foreign to ${lang}`).toEqual([]);
      }
      expect(list.some((excerpt) => DIACRITICS[lang].test(excerpt.explanation)), `an explanation with ${lang} letters`).toBe(true);
    });
  }

  it('the German and Spanish texts are different', () => {
    const de = byId('de');
    for (const excerpt of excerpts('es')) {
      const german = de.get(excerpt.id)!;
      expect(normalize(excerpt.explanation), `${excerpt.id}.explanation: Spanish equals German`).not.toBe(normalize(german.explanation));
      if (excerpt.translation.status === 'included' && german.translation.status === 'included') {
        expect(normalize(excerpt.translation.text), `${excerpt.id}.translation: Spanish equals German`).not.toBe(normalize(german.translation.text));
      }
    }
  });
});

describe('#86 translation validator (fails closed, Atlas 3.12)', () => {
  const clone = (lang: Lang) => structuredClone(file(lang));

  for (const lang of LANGS) {
    it(`accepts the shipped ${lang}.json`, async () => {
      const { validateExcerptTranslation } = await excerptModule();
      const result = validateExcerptTranslation(file('en'), file(lang));
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  }

  it('accepts an explicitly missing passage translation', async () => {
    const { validateExcerptTranslation } = await excerptModule();
    const data = clone('de');
    data.excerpts[0].translation = { status: 'missing' };
    // Annotation terms must then occur in the English translation or the original that is shown.
    data.excerpts[0].annotations = structuredClone(file('en').excerpts[0].annotations).map((annotation: Json, index: number) => ({
      ...annotation,
      note: data.excerpts[0].annotations[index].note,
    }));
    const result = validateExcerptTranslation(file('en'), data);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  const broken: [string, (data: Json, english: Json) => void][] = [
    ['the English text changed (stale excerptsSha256)', (data) => (data.provenance.translatedFrom.excerptsSha256 = '0'.repeat(64))],
    ['the provenance is missing', (data) => delete data.provenance],
    ['an excerpt is missing', (data) => data.excerpts.pop()],
    ['an excerpt is duplicated', (data) => data.excerpts.push(structuredClone(data.excerpts[0]))],
    ['two excerpts are swapped', (data) => ([data.excerpts[0], data.excerpts[1]] = [data.excerpts[1], data.excerpts[0]])],
    ['an excerpt carries structure (source)', (data) => (data.excerpts[0].source = 'nicaea-creed-and-canons')],
    ['an excerpt carries an original (originals are never localized)', (data, english) => (data.excerpts[0].original = structuredClone(english.excerpts[0].original))],
    ['an explanation is whitespace', (data) => (data.excerpts[0].explanation = '   ')],
    ['an original note is missing', (data) => delete data.excerpts[0].originalNote],
    ['an annotation is missing', (data) => data.excerpts[0].annotations.pop()],
    ['an annotation note is empty', (data) => (data.excerpts[0].annotations[0].note = '')],
    ['an annotation term is not in the shown passage', (data) => (data.excerpts[0].annotations[0].term = 'zzz-not-in-the-passage')],
    ['the passage translation has no status', (data) => delete data.excerpts[0].translation.status],
    ['the passage translation is silently absent', (data) => delete data.excerpts[0].translation],
    ['the passage translation has no translator', (data) => delete data.excerpts[0].translation.translator],
    ['a published passage translation has no edition', (data) => (data.excerpts[0].translation = { ...data.excerpts[0].translation, translator: { kind: 'published', name: 'X' }, edition: undefined })],
    ['the passage "translation" is the English translation', (data, english) => (data.excerpts[0].translation.text = english.excerpts[0].translation.text)],
    ['the language is unknown', (data) => (data.language = 'fr')],
    ['the project is another one', (data) => (data.project = 'council-constantinople-381')],
    ['the schema is the context schema', (data) => (data.schema = 'interactive-videos/council-context')],
    [
      'the translator approved their own translation',
      (data) => (data.provenance.review = { status: 'approved', reviewer: data.provenance.translator.name, date: '2026-10-16' }),
    ],
  ];
  for (const [what, mutate] of broken) {
    it(`rejects a translation where ${what}`, async () => {
      const { validateExcerptTranslation } = await excerptModule();
      const english = file('en');
      const data = clone('de');
      mutate(data, english);
      const result = validateExcerptTranslation(english, JSON.parse(JSON.stringify(data)));
      expect(result.ok, what).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

describe('#86 Player boundary: excerpts are browser-only; render frames and other projects are unaffected', () => {
  const sourceFiles = (dir: string): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|\.test-support\.tsx?$/.test(name) ? [path] : [];
      });

  it('the excerpts reach the episode through the existing context overlay, not a second overlay system', () => {
    const projects = readFileSync(join(ROOT, 'src', 'projects.ts'), 'utf8');
    expect(projects, 'src/projects.ts imports the excerpt files').toMatch(/nicaea-325\/excerpts\/en\.json/);
    expect(projects, 'and still builds the Nicaea overlay with createContextOverlay').toMatch(/createContextOverlay\(/);
    const overlayCalls = projects.match(/overlay:\s*\(/g) ?? [];
    expect(overlayCalls.length, 'still one overlay factory for the episode (no second overlay system)').toBe(1);
  });

  it('no render-path, format or composition file imports the excerpt data or the excerpt module', () => {
    const dirs = ['render', 'formats', 'video', join('components', 'remotion'), join('lib', 'remotion')].map((dir) => join(ROOT, 'src', dir));
    const offenders = dirs.flatMap(sourceFiles).filter((path) => {
      if (/overlay/i.test(path)) return false;
      return /nicaea-325\/excerpts|council-excerpts/.test(readFileSync(path, 'utf8'));
    });
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it('the episode spec carries no excerpt UI: rendering it needs no excerpt data', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8');
    for (const excerpt of excerpts('en')) {
      expect(raw.includes(excerpt.explanation), `spec contains the English explanation of ${excerpt.id}`).toBe(false);
      if (excerpt.original.status === 'included') expect(raw.includes(excerpt.original.text), `spec contains the original of ${excerpt.id}`).toBe(false);
    }
    for (const excerpt of excerpts('de')) expect(raw.includes(excerpt.explanation), `spec contains the German explanation of ${excerpt.id}`).toBe(false);
  });

  it('Nicaea I still resolves with its browser-only Overlay; other projects keep exactly the overlays they had', () => {
    const resolved = catalog.resolve(PROJECT);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.composition.Overlay).toBeDefined();
    for (const { id } of catalog.projects) {
      if (id === PROJECT) continue;
      const other = catalog.resolve(id);
      expect(other.ok, id).toBe(true);
      if (other.ok) expect(other.composition.Overlay !== undefined, `${id} has an Overlay`).toBe(id === 'interactive-showcase');
    }
  });
});
