// Acceptance contract for issue #85 (Nicaea I: contextual person, place and term disclosures),
// written by an independent acceptance context before any implementation, against baseline
// eb021b4. Intent: Decision Atlas 1.1, 1.2, 1.3, 1.4, 1.6, 3.3, 3.12 and 3.16, the
// "Context-language acceptance" section of #61 and the interaction rules proven for #60. Companion
// Pages journey (pointer, keyboard, touch, language): e2e/council-nicaea-325-context.spec.ts.
//
// Seams (new; names chosen to fit the layout of #82 / #84):
//
// 1. Context entries, data only, one file per language, next to the script and subtitle tracks:
//      src/content/councils/nicaea-325/context/en.json   (structure + English text)
//      src/content/councils/nicaea-325/context/de.json   (German text only)
//      src/content/councils/nicaea-325/context/es.json   (Spanish text only)
//    en.json:
//    { schema: "interactive-videos/council-context", schemaVersion: 1,
//      project: "council-nicaea-325", language: "en",
//      entries: [{
//        id: string,                         // stable, kebab-case; ids below are fixed
//        kind: "person" | "place" | "term",
//        title: string,                      // trigger name and disclosure heading
//        preview: string,                    // short hover/focus preview (<= 220 characters)
//        body: string,                       // the richer disclosure text, longer than the preview
//        sources: string[],                  // ids in nicaea-325/sources.json, at least one
//        appearances: [{ scene: <scene id>, anchor: string }],
//        image?: { src, alt, depiction: "documentary" | "illustration" | "reconstruction", credit }
//      }, …] }
//    An appearance makes the entry's hotspot active for that whole scene of the resolved timeline
//    (resolveTimeline(spec)), so re-timed narration moves the window with its scene instead of
//    silently drifting. `anchor` is the on-screen text the hotspot is attached to: it occurs
//    (case-insensitively) in that scene's on-screen payload text, e.g. "Emperor Constantine". The
//    hotspot itself is browser-only UI at the Player boundary (FormatRendering.Overlay); the
//    rendered frames never contain it (AGENTS.md "Browser versus render").
//    Atlas 3.16: an optional image says honestly what it is (documentary evidence, illustration or
//    reconstruction) and credits its source; nothing is presented as an authentic likeness.
//
//    de.json / es.json (text only; structure is never duplicated or re-timed per language):
//    { schema: "interactive-videos/council-context", schemaVersion: 1,
//      project: "council-nicaea-325", language: "de" | "es",
//      provenance: {
//        translatedFrom: { language: "en", entriesSha256: <hex> },
//        translator: { kind: "agent" | "human", name: string },
//        review: { status: "pending" | "approved" | "changes-requested",
//                  reviewer?: string, date?: "YYYY-MM-DD", reference?: "https://…" } },
//      entries: [{ id, title, preview, body }, …] }   // every English entry, same order
//    `entriesSha256` is the lowercase hex SHA-256 of the UTF-8 bytes of
//    JSON.stringify([[id, title, preview, body], …]) over the English entries in order, so a change
//    to the English text makes a translation stale (and invalid) instead of silently out of date.
//
// 2. Validation, a pure module: src/spec/council-context.ts
//      validateContextTranslation(english: unknown, data: unknown)
//        => { ok: true; translation: unknown } | { ok: false; errors: string[] }
//    Invalid means: wrong schema/project/language, a missing, extra, duplicated or reordered entry,
//    an entry with fields other than id/title/preview/body, empty or whitespace-only text, a stale
//    `entriesSha256`, missing provenance, or an approved review by the translator.
//    Atlas 3.12 fallback: the Player never shows an invalid translation as translated. Where a
//    selected language has no valid context, it shows the English entry, marked as untranslated
//    (lang="en"); this cannot happen with the shipped data, so it is a rule for the implementation
//    and is checked here through the validator only.
//
// 3. Language derivation. Until #70 provides the shared series-language selector, the context
//    language follows the existing toolbar "Subtitles" select (state in src/app.tsx): English,
//    Deutsch, Español → en, de, es; Off → English context. No second language control, query
//    parameter or stored preference is added; #70 will replace the source of this one value. The
//    overlay receives the value through its props from the Player view (e.g. a `language` field on
//    PlayerOverlayProps); the exact prop name is the implementation's choice.
//
// 4. Player DOM and playback: see the header of e2e/council-nicaea-325-context.spec.ts.
//
// Fixed entry ids (the issue's six): arius, alexander-of-alexandria, constantine, athanasius
// (persons), nicaea (place), homoousios (term). More entries are allowed and checked the same way.
//
// Terminology for titles, consistent with the #84 subtitle tracks:
//   arius                    EN Arius        DE Arius        ES Arrio
//   alexander-of-alexandria  EN Alexander    DE Alexander    ES Alejandro
//   constantine              EN Constantine  DE Konstantin   ES Constantino
//   athanasius               EN Athanasius   DE Athanasius   ES Atanasio
//   nicaea                   EN Nicaea       DE the Nicaea spelling of the German track (Nizäa)
//                                            ES Nicea
//   homoousios               the Greek term, verbatim, in all three
//
// Non-automated acceptance (stays on the PR / issue): the independent historical review of the
// English entries (accuracy, sources actually supporting each statement, Catholic framing with
// fair representation of other traditions, Atlas 3.6) and the independent translation review of
// German and Spanish. The heuristics below only catch missing, untranslated or wrong-language text.
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
const CONTEXT = join(CONTENT, 'context');
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`);
const SCHEMA = 'interactive-videos/council-context';

type Lang = 'de' | 'es';
const LANGS: Lang[] = ['de', 'es'];
const LABEL: Record<Lang, string> = { de: 'German', es: 'Spanish' };

const REQUIRED = {
  arius: { kind: 'person', en: /\bArius\b/, de: /\bArius\b/, es: /\bArrio\b/ },
  'alexander-of-alexandria': { kind: 'person', en: /\bAlexander\b/, de: /\bAlexander\b/, es: /\bAlejandro\b/ },
  constantine: { kind: 'person', en: /\bConstantine\b/, de: /\bKonstantin\b/, es: /\bConstantino\b/ },
  athanasius: { kind: 'person', en: /\bAthanasius\b/, de: /\bAthanasius\b/, es: /\bAtanasio\b/ },
  nicaea: { kind: 'place', en: /\bNicaea\b/, de: /\b(?:Nizäa|Nicäa|Nikaia)\b/u, es: /\bNicea\b/ },
  homoousios: { kind: 'term', en: /\bhomoousios\b/i, de: /\bhomoousios\b/i, es: /\bhomoousios\b/i },
} as const;
type RequiredId = keyof typeof REQUIRED;
const REQUIRED_IDS = Object.keys(REQUIRED) as RequiredId[];

const spec = (): VideoSpec => assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
const sourceIds = () => new Set((JSON.parse(readFileSync(join(CONTENT, 'sources.json'), 'utf8')).sources as Json[]).map((source) => source.id));

function file(lang: 'en' | Lang): Json {
  const path = join(CONTEXT, `${lang}.json`);
  expect(existsSync(path), `${relative(ROOT, path)} exists`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}
const entries = (lang: 'en' | Lang) => file(lang).entries as Json[];
const byId = (lang: 'en' | Lang) => new Map(entries(lang).map((entry) => [entry.id as string, entry]));

const entriesSha256 = (english: Json) =>
  createHash('sha256')
    .update(JSON.stringify((english.entries as Json[]).map((entry) => [entry.id, entry.title, entry.preview, entry.body])), 'utf8')
    .digest('hex');

/** All string values of a scene payload: the scene's on-screen text. */
function onScreenText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(onScreenText);
  if (value && typeof value === 'object') return Object.values(value).flatMap(onScreenText);
  return [];
}

// ---------------------------------------------------------------------------------------------
// Language heuristics, reused from the #84 subtitle contract (council-nicaea-325-subtitles.test.ts).

const words = (text: string) => (text.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((word) => word.toLocaleLowerCase());
const normalize = (text: string) => words(text).join(' ');
const ENGLISH_ONLY = new Set(['the', 'and', 'of', 'that', 'which', 'with', 'were', 'this', 'from', 'they', 'their', 'would', 'been', 'have', 'his', 'she', 'it', 'is', 'who', 'did', 'by', 'to', 'on', 'for', 'are', 'its', 'be', 'still', 'today', 'most', 'some', 'not']);
const STOPWORDS: Record<Lang, Set<string>> = {
  de: new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'zu', 'von', 'vom', 'mit', 'sich', 'auf', 'für', 'im', 'zum', 'zur', 'wurde', 'wurden', 'er', 'sie', 'auch', 'dass', 'als', 'nach', 'aus', 'bei', 'wie', 'war', 'waren', 'noch', 'nur', 'sein', 'seine', 'seinen', 'ihre', 'ihn', 'ihm', 'hat', 'haben', 'am', 'heute', 'oder', 'sind', 'kein', 'keine', 'keinen', 'man', 'diese', 'diesen', 'dieser', 'dieses', 'über', 'um', 'wird', 'werden']),
  es: new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'no', 'se', 'por', 'con', 'para', 'su', 'sus', 'al', 'lo', 'como', 'fue', 'fueron', 'más', 'pero', 'le', 'era', 'hoy', 'muchas', 'o', 'a', 'este', 'esta', 'sobre', 'hubo', 'es', 'son', 'ya', 'también', 'aún']),
};
const DIACRITICS: Record<Lang, RegExp> = { de: /[äöüßÄÖÜ]/u, es: /[áéíóúñÁÉÍÓÚÑ¿¡]/u };
const FOREIGN_LETTERS: Record<Lang, RegExp> = { de: /[ñÑ¿¡áíóúÁÍÓÚ]/u, es: /[äöß]/u };
/** Words that may appear unchanged in a translation (names, numbers, the Greek term). */
const SAME_IN_ALL = /^(?:\d+|nicaea|alexander|alexandria|arius|athanasius|homoousios|dogma|credo)$/;
const SHARED = new Set(['es']);
const count = (list: string[], set: Set<string>) => list.filter((word) => set.has(word)).length;
const exclusive = (lang: Lang) => new Set([...STOPWORDS[lang]].filter((word) => !SHARED.has(word)));
const TEXT_FIELDS = ['title', 'preview', 'body'] as const;

async function contextModule() {
  let module: Json;
  try {
    module = await import('@/spec/council-context');
  } catch (error) {
    throw new Error(`src/spec/council-context.ts must exist and export validateContextTranslation: ${String(error)}`);
  }
  expect(typeof module.validateContextTranslation, 'validateContextTranslation is exported').toBe('function');
  return module as { validateContextTranslation: (english: unknown, data: unknown) => { ok: true; translation: unknown } | { ok: false; errors: string[] } };
}

// ---------------------------------------------------------------------------------------------

describe('#85 English context entries (structure, sources, hotspot windows)', () => {
  it('en.json has the schema header of this project', () => {
    const english = file('en');
    expect({ schema: english.schema, schemaVersion: english.schemaVersion, project: english.project, language: english.language }).toEqual({
      schema: SCHEMA,
      schemaVersion: 1,
      project: PROJECT,
      language: 'en',
    });
    expect(Array.isArray(english.entries), 'entries is an array').toBe(true);
  });

  it('the six required entries exist with their kind and an English title naming them', () => {
    const map = byId('en');
    for (const id of REQUIRED_IDS) {
      const entry = map.get(id);
      expect(entry, `entry "${id}"`).toBeDefined();
      expect(entry!.kind, `${id}.kind`).toBe(REQUIRED[id].kind);
      expect(entry!.title, `${id}.title`).toMatch(REQUIRED[id].en);
    }
  });

  it('every entry has a unique kebab-case id, a known kind and only the documented fields', () => {
    const seen = new Set<string>();
    for (const entry of entries('en')) {
      expect(entry.id, 'id').toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(seen.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      seen.add(entry.id);
      expect(['person', 'place', 'term'], `${entry.id}.kind`).toContain(entry.kind);
      const extra = Object.keys(entry).filter((key) => !['id', 'kind', 'title', 'preview', 'body', 'sources', 'appearances', 'image'].includes(key));
      expect(extra, `${entry.id}: undocumented fields`).toEqual([]);
    }
  });

  it('every entry has a non-empty title, a short preview and a longer body', () => {
    for (const entry of entries('en')) {
      for (const field of TEXT_FIELDS) {
        expect(typeof entry[field] === 'string' && entry[field].trim() !== '', `${entry.id}.${field} is non-empty text`).toBe(true);
      }
      expect(entry.preview.length, `${entry.id}.preview is short (a hover preview)`).toBeLessThanOrEqual(220);
      expect(entry.body.length, `${entry.id}.body is the richer text, longer than its preview`).toBeGreaterThan(entry.preview.length);
      expect(words(entry.body).length, `${entry.id}.body has real content`).toBeGreaterThanOrEqual(20);
      expect(normalize(entry.preview), `${entry.id}: preview is more than the title`).not.toBe(normalize(entry.title));
    }
  });

  it('every entry cites at least one source, each resolving to nicaea-325/sources.json', () => {
    const known = sourceIds();
    for (const entry of entries('en')) {
      expect(Array.isArray(entry.sources) && entry.sources.length > 0, `${entry.id} cites a source`).toBe(true);
      expect(new Set(entry.sources).size, `${entry.id}: no duplicate source ids`).toBe(entry.sources.length);
      for (const source of entry.sources) expect(known.has(source), `${entry.id} cites unknown source "${source}"`).toBe(true);
    }
  });

  it('every hotspot appearance is a scene of the episode, inside its duration, anchored to on-screen text', () => {
    const subject = spec();
    const timeline = resolveTimeline(subject);
    const fps = subject.output.fps;
    for (const entry of entries('en')) {
      expect(Array.isArray(entry.appearances) && entry.appearances.length > 0, `${entry.id} appears somewhere`).toBe(true);
      let longest = 0;
      for (const appearance of entry.appearances as Json[]) {
        expect(Object.keys(appearance).sort(), `${entry.id}: an appearance is { scene, anchor }`).toEqual(['anchor', 'scene']);
        const scene = timeline.scenes.find((candidate) => candidate.id === appearance.scene);
        expect(scene, `${entry.id} names unknown scene "${appearance.scene}"`).toBeDefined();
        expect(scene!.from, `${entry.id}@${appearance.scene} starts inside the episode`).toBeGreaterThanOrEqual(0);
        expect(scene!.from + scene!.durationInFrames, `${entry.id}@${appearance.scene} ends inside the episode`).toBeLessThanOrEqual(timeline.durationInFrames);
        const text = onScreenText(subject.scenes.find((candidate) => candidate.id === appearance.scene)!.payload).join(' \n ');
        expect(typeof appearance.anchor === 'string' && appearance.anchor.trim() !== '', `${entry.id}@${appearance.scene} has an anchor`).toBe(true);
        expect(text.toLocaleLowerCase(), `${entry.id}@${appearance.scene}: anchor "${appearance.anchor}" is on screen`).toContain(appearance.anchor.toLocaleLowerCase());
        longest = Math.max(longest, scene!.durationInFrames);
      }
      // Enough time to notice, hover and open the hotspot while the video plays.
      expect(longest / fps, `${entry.id} is active for at least 3 s somewhere`).toBeGreaterThanOrEqual(3);
    }
  });

  it('an image, if any, is labeled as documentary, illustration or reconstruction and credited (Atlas 3.16)', () => {
    for (const entry of entries('en')) {
      if (entry.image === undefined) continue;
      expect(['documentary', 'illustration', 'reconstruction'], `${entry.id}.image.depiction`).toContain(entry.image.depiction);
      for (const field of ['src', 'alt', 'credit']) {
        expect(typeof entry.image[field] === 'string' && entry.image[field].trim() !== '', `${entry.id}.image.${field}`).toBe(true);
      }
    }
  });
});

describe('#85 German and Spanish context (complete, translated, current)', () => {
  for (const lang of LANGS) {
    const other = LANGS.find((candidate) => candidate !== lang)!;

    it(`${lang}.json has the schema header, provenance from the current English text and every entry in order`, () => {
      const data = file(lang);
      expect({ schema: data.schema, schemaVersion: data.schemaVersion, project: data.project, language: data.language }).toEqual({
        schema: SCHEMA,
        schemaVersion: 1,
        project: PROJECT,
        language: lang,
      });
      const { provenance } = data;
      expect(provenance?.translatedFrom, 'provenance.translatedFrom').toEqual({ language: 'en', entriesSha256: entriesSha256(file('en')) });
      expect(['agent', 'human'], 'provenance.translator.kind').toContain(provenance.translator?.kind);
      expect(String(provenance.translator?.name ?? '').trim().length, 'provenance.translator.name').toBeGreaterThan(0);
      expect(['pending', 'approved', 'changes-requested'], 'provenance.review.status').toContain(provenance.review?.status);
      if (provenance.review.status === 'approved') {
        const reviewer = String(provenance.review.reviewer ?? '').trim();
        expect(reviewer.length, 'an approved review names its reviewer').toBeGreaterThan(0);
        expect(reviewer, 'the reviewer is not the translator').not.toBe(String(provenance.translator.name).trim());
        expect(provenance.review.date, 'an approved review has a date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(entries(lang).map((entry) => entry.id), `${lang}: the English entry ids, in order`).toEqual(entries('en').map((entry) => entry.id));
    });

    it(`${lang}: entries carry text only (id, title, preview, body), all non-empty`, () => {
      for (const entry of entries(lang)) {
        expect(Object.keys(entry).sort(), `${lang}/${entry.id}: text only; kind, sources and appearances stay in en.json`).toEqual(['body', 'id', 'preview', 'title']);
        for (const field of TEXT_FIELDS) {
          expect(typeof entry[field] === 'string' && entry[field].trim() !== '', `${lang}/${entry.id}.${field} is non-empty`).toBe(true);
        }
        expect(entry.preview.length, `${lang}/${entry.id}.preview stays short`).toBeLessThanOrEqual(260);
        expect(entry.body.length, `${lang}/${entry.id}.body is longer than its preview`).toBeGreaterThan(entry.preview.length);
      }
    });

    it(`${lang}: titles use the episode's ${LABEL[lang]} names and terms`, () => {
      const map = byId(lang);
      for (const id of REQUIRED_IDS) {
        expect(map.get(id)?.title, `${lang}/${id}.title`).toMatch(REQUIRED[id][lang]);
      }
      if (lang === 'de') {
        // The German context spells Nicaea as the German subtitle track does (#84).
        const track = readFileSync(join(CONTENT, 'subtitles', 'de.json'), 'utf8');
        const spelling = map.get('nicaea')!.title.match(REQUIRED.nicaea.de)![0];
        expect(track, `the German subtitle track also spells "${spelling}"`).toContain(spelling);
      }
    });

    it(`${lang}: no preview or body is the English text, and titles change unless they are names`, () => {
      const english = byId('en');
      for (const entry of entries(lang)) {
        const source = english.get(entry.id)!;
        for (const field of ['preview', 'body'] as const) {
          expect(normalize(entry[field]), `${lang}/${entry.id}.${field} is the English text untranslated`).not.toBe(normalize(source[field]));
        }
        if (normalize(entry.title) === normalize(source.title)) {
          const unchanged = words(entry.title).filter((word) => !SAME_IN_ALL.test(word));
          expect(unchanged, `${lang}/${entry.id}.title "${entry.title}" is the English title untranslated`).toEqual([]);
        }
      }
    });

    it(`${lang}: no leftover English sentences or fragments`, () => {
      const all: string[] = [];
      for (const entry of entries(lang)) {
        for (const field of TEXT_FIELDS) {
          const list = words(entry[field]);
          all.push(...list);
          const englishWords = list.filter((word) => ENGLISH_ONLY.has(word));
          expect(englishWords.length, `${lang}/${entry.id}.${field} contains English function words: ${englishWords.join(', ')}`).toBeLessThanOrEqual(2);
        }
      }
      expect(count(all, ENGLISH_ONLY) / all.length, `share of English-only function words in ${lang}.json`).toBeLessThan(0.02);
    });

    it(`${lang}: reads as ${LABEL[lang]}, not as ${LABEL[other]}`, () => {
      const list = entries(lang);
      const all = list.flatMap((entry) => TEXT_FIELDS.flatMap((field) => words(entry[field])));
      expect(count(all, STOPWORDS[lang]) / all.length, `share of ${lang} function words`).toBeGreaterThanOrEqual(0.2);
      expect(count(all, exclusive(other)) / all.length, `share of ${other} function words`).toBeLessThan(0.06);
      for (const entry of list) {
        for (const field of ['preview', 'body'] as const) {
          const fieldWords = words(entry[field]);
          const own = count(fieldWords, STOPWORDS[lang]) + (DIACRITICS[lang].test(entry[field]) ? 1 : 0);
          expect(own, `${lang}/${entry.id}.${field} has ${lang} function words or letters`).toBeGreaterThan(0);
          expect(own, `${lang}/${entry.id}.${field} reads as ${lang}, not ${other}`).toBeGreaterThan(count(fieldWords, exclusive(other)));
        }
      }
      const accented = list.filter((entry) => DIACRITICS[lang].test(`${entry.preview} ${entry.body}`)).length;
      expect(accented, `entries with ${lang} letters (${DIACRITICS[lang].source})`).toBeGreaterThanOrEqual(3);
      const foreign = list.filter((entry) => FOREIGN_LETTERS[lang].test(`${entry.title} ${entry.preview} ${entry.body}`)).map((entry) => entry.id);
      expect(foreign, `entries with letters foreign to ${lang}`).toEqual([]);
    });
  }

  it('the German and Spanish texts are different', () => {
    const de = byId('de');
    for (const entry of entries('es')) {
      for (const field of ['preview', 'body'] as const) {
        expect(normalize(entry[field]), `${entry.id}.${field}: Spanish equals German`).not.toBe(normalize(de.get(entry.id)![field]));
      }
    }
  });
});

describe('#85 translation validator (fails closed, Atlas 3.12)', () => {
  const clone = (lang: Lang) => structuredClone(file(lang));

  for (const lang of LANGS) {
    it(`accepts the shipped ${lang}.json`, async () => {
      const { validateContextTranslation } = await contextModule();
      const result = validateContextTranslation(file('en'), file(lang));
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  }

  const broken: [string, (data: Json) => void][] = [
    ['the English text changed (stale entriesSha256)', (data) => (data.provenance.translatedFrom.entriesSha256 = '0'.repeat(64))],
    ['the provenance is missing', (data) => delete data.provenance],
    ['an entry is missing', (data) => data.entries.pop()],
    ['an entry is duplicated', (data) => data.entries.push(structuredClone(data.entries[0]))],
    ['two entries are swapped', (data) => ([data.entries[0], data.entries[1]] = [data.entries[1], data.entries[0]])],
    ['an entry carries structure (sources)', (data) => (data.entries[0].sources = ['nicaea-creed-and-canons'])],
    ['a preview is whitespace', (data) => (data.entries[0].preview = '   ')],
    ['a body is missing', (data) => delete data.entries[0].body],
    ['the language is unknown', (data) => (data.language = 'fr')],
    ['the project is another one', (data) => (data.project = 'council-constantinople-381')],
    ['the schema is wrong', (data) => (data.schema = 'interactive-videos/council-subtitles')],
    [
      'the translator approved their own translation',
      (data) => (data.provenance.review = { status: 'approved', reviewer: data.provenance.translator.name, date: '2026-10-16' }),
    ],
  ];
  for (const [what, mutate] of broken) {
    it(`rejects a translation where ${what}`, async () => {
      const { validateContextTranslation } = await contextModule();
      const data = clone('de');
      mutate(data);
      const result = validateContextTranslation(file('en'), data);
      expect(result.ok, what).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

describe('#85 Player boundary: context is browser-only; render frames and other projects are unaffected', () => {
  const sourceFiles = (dir: string): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|\.test-support\.tsx?$/.test(name) ? [path] : [];
      });

  it('Nicaea I resolves with a browser-only Overlay and no click-to-inspect side panel', () => {
    const resolved = catalog.resolve(PROJECT);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.composition.Overlay, 'the context hotspots live in FormatRendering.Overlay at the Player boundary').toBeDefined();
    // No click-to-inspect side panel: these disclosures are not the latency explainer's selection affordance.
    expect(resolved.composition.renderInsight).toBeUndefined();
  });

  it('no render-path, format or composition file imports the context data or the context module', () => {
    const dirs = ['render', 'formats', 'video', join('components', 'remotion'), join('lib', 'remotion')].map((dir) => join(ROOT, 'src', dir));
    const offenders = dirs.flatMap(sourceFiles).filter((path) => {
      // Overlays (browser-only) may live next to a format, as the showcase overlay does.
      if (/overlay/i.test(path)) return false;
      const source = readFileSync(path, 'utf8');
      return /nicaea-325\/context|council-context/.test(source);
    });
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it('the episode spec carries no context UI: rendering it needs no context data', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8');
    for (const entry of entries('de')) expect(raw.includes(entry.preview), `spec contains the German preview of ${entry.id}`).toBe(false);
    for (const entry of entries('en')) expect(raw.includes(entry.body), `spec contains the English body of ${entry.id}`).toBe(false);
  });

  it('other projects keep exactly the overlays they had (only the interactive showcase)', () => {
    for (const { id } of catalog.projects) {
      if (id === PROJECT) continue;
      const resolved = catalog.resolve(id);
      expect(resolved.ok, id).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.composition.Overlay !== undefined, `${id} has an Overlay`).toBe(id === 'interactive-showcase');
    }
  });
});
