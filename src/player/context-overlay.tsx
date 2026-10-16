// Contextual person, place and term disclosures of a council episode (#85), as browser-only UI at
// the Player boundary (AGENTS.md "Browser versus render"). Rendered frames never contain any of it.
//
// - Each entry's hotspot is shown for the whole of each scene it appears in (resolved timeline), so
//   re-timed narration moves the window with its scene.
// - Hover or keyboard focus shows a short preview and never touches playback (Atlas 1.3).
// - Click, Enter or Space opens a NON-MODAL disclosure (Atlas 1.4, 1.6): it neither pauses nor
//   resumes the video, and it keeps the toolbar usable, so the Subtitles select can switch the
//   language while it is open. Escape or the close button closes it without seeking and returns
//   focus to the hotspot, or to the player region when the hotspot's scene has ended (Atlas 1.1).
// - The language is the `language` prop (Atlas 3.12). A language without a valid translation shows
//   the English entry, tagged lang="en" and marked as untranslated in the viewer's language.
// - Annotated source excerpts (#86, Atlas 3.14) share this overlay: a reference button for each
//   excerpt is shown during the scenes that cite it and opens a NON-MODAL inspection with the
//   original (never localized, tagged with its language, or honestly labelled as absent), the
//   translation in the viewer's language with its provenance (or the English translation, labelled
//   as a fallback), the localized explanation and annotations, the standing of the text, its exact
//   place in the source and a link to the longer source. Same playback and focus rules as above.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { PlayerOverlayProps } from '@/catalog/catalog';
import { usePlayerFrame } from '@/formats/showcase/overlay';
import { validateContextEnglish, validateContextTranslation, type ContextDepiction, type ContextEntry, type ContextText } from '@/spec/council-context';
import {
  foldPassage,
  validateExcerptEnglish,
  validateExcerptTranslation,
  type Excerpt,
  type ExcerptStanding,
  type ExcerptText,
  type IncludedTranslation,
  type OriginalLanguage,
} from '@/spec/council-excerpts';
import { resolveTimeline, type VideoSpec } from '@/spec/video-spec';

/** A citable source as shown in a disclosure. */
export type ContextSource = { id: string; title: string; author?: string; url?: string };

type UiText = { close: string; sources: string; untranslated: string; label: string; depiction: Record<ContextDepiction, string> };

/** Player-control strings of the disclosures, per language (Atlas 3.12). */
const UI: Record<string, UiText> = {
  en: {
    close: 'Close',
    sources: 'Sources',
    untranslated: 'Not yet translated: shown in English.',
    label: 'Context',
    depiction: { documentary: 'Historical evidence', illustration: 'Modern illustration', reconstruction: 'Modern reconstruction' },
  },
  de: {
    close: 'Schließen',
    sources: 'Quellen',
    untranslated: 'Noch nicht übersetzt: englischer Text.',
    label: 'Hintergrund',
    depiction: { documentary: 'Historisches Zeugnis', illustration: 'Moderne Illustration', reconstruction: 'Moderne Rekonstruktion' },
  },
  es: {
    close: 'Cerrar',
    sources: 'Fuentes',
    untranslated: 'Aún no traducido: se muestra en inglés.',
    label: 'Contexto',
    depiction: { documentary: 'Testimonio histórico', illustration: 'Ilustración moderna', reconstruction: 'Reconstrucción moderna' },
  },
};

type ExcerptUi = {
  reference: string;
  label: string;
  original: string;
  originalLanguage: Record<OriginalLanguage, string>;
  absent: Record<'lost' | 'not-included', string>;
  translation: string;
  missing: string;
  translatedBy: string;
  from: Record<OriginalLanguage | 'en', string>;
  kind: Record<IncludedTranslation['translator']['kind'], string>;
  explanation: string;
  notes: string;
  locator: string;
  standing: Record<ExcerptStanding, string>;
};

/** Player-control strings of the source-excerpt inspection, per language (Atlas 3.12, 3.14). */
const EXCERPT_UI: Record<string, ExcerptUi> = {
  en: {
    reference: 'Source',
    label: 'Source excerpt',
    original: 'Original',
    originalLanguage: { grc: 'Greek', la: 'Latin' },
    absent: { lost: 'The original is lost.', 'not-included': 'The original is not shown here.' },
    translation: 'Translation',
    missing: 'No English translation.',
    translatedBy: 'Translated by',
    from: { grc: 'from the Greek', la: 'from the Latin', en: 'from the English translation' },
    kind: { published: 'published translation', agent: 'AI translation, not published', human: 'unpublished translation' },
    explanation: 'Explanation',
    notes: 'Notes',
    locator: 'Location in the source',
    standing: { 'council-act': 'Act of the council', 'contemporary-witness': 'Contemporary witness', 'later-witness': 'Later witness' },
  },
  de: {
    reference: 'Quelle',
    label: 'Quellenauszug',
    original: 'Original',
    originalLanguage: { grc: 'Griechisch', la: 'Latein' },
    absent: { lost: 'Das Original ist verloren.', 'not-included': 'Das Original wird hier nicht gezeigt.' },
    translation: 'Übersetzung',
    missing: 'Keine deutsche Übersetzung dieses Textes: Die englische Übersetzung wird gezeigt.',
    translatedBy: 'Übersetzt von',
    from: { grc: 'aus dem Griechischen', la: 'aus dem Lateinischen', en: 'aus der englischen Übersetzung' },
    kind: { published: 'veröffentlichte Übersetzung', agent: 'KI-Übersetzung, nicht veröffentlicht', human: 'unveröffentlichte Übersetzung' },
    explanation: 'Erläuterung',
    notes: 'Anmerkungen',
    locator: 'Fundstelle',
    standing: { 'council-act': 'Beschluss des Konzils', 'contemporary-witness': 'Zeitgenössisches Zeugnis', 'later-witness': 'Späteres Zeugnis' },
  },
  es: {
    reference: 'Fuente',
    label: 'Extracto de la fuente',
    original: 'Original',
    originalLanguage: { grc: 'griego', la: 'latín' },
    absent: { lost: 'El original se ha perdido.', 'not-included': 'El original no se muestra aquí.' },
    translation: 'Traducción',
    missing: 'No hay traducción española de este texto: se muestra la traducción inglesa.',
    translatedBy: 'Traducido por',
    from: { grc: 'del griego', la: 'del latín', en: 'de la traducción inglesa' },
    kind: { published: 'traducción publicada', agent: 'traducción por IA, no publicada', human: 'traducción no publicada' },
    explanation: 'Explicación',
    notes: 'Notas',
    locator: 'Lugar en la fuente',
    standing: { 'council-act': 'Acto del concilio', 'contemporary-witness': 'Testimonio contemporáneo', 'later-witness': 'Testimonio posterior' },
  },
};

type TimedEntry = ContextEntry & { windows: { from: number; to: number }[] };
type TimedExcerpt = Excerpt & { windows: { from: number; to: number }[] };

type LocalizedExcerpt = { lang: string; translated: boolean; text: ExcerptText };

/** Which panel is open: a context entry or a source excerpt, by id. */
type OpenPanel = { kind: 'context' | 'excerpt'; id: string };
const panelKey = (kind: OpenPanel['kind'], id: string) => `${kind}:${id}`;

type Localized = { lang: string; translated: boolean; text: ContextText };

/**
 * Builds the overlay for one episode from its English context file, its translations and its
 * source list. Throws when the English file or an appearance is invalid; an invalid translation
 * is left out, so its language falls back to English marked as untranslated.
 */
export function createContextOverlay({
  spec,
  english,
  translations,
  sources,
  excerpts: excerptData,
}: {
  spec: VideoSpec;
  english: unknown;
  translations: readonly unknown[];
  sources: readonly ContextSource[];
  /** Annotated source excerpts (#86): the English file and its translations. */
  excerpts?: { english: unknown; translations: readonly unknown[] };
}) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const timeline = resolveTimeline(spec).scenes;
  const parsed = validateContextEnglish(english, { sources: new Set(sourceMap.keys()), scenes: new Set(timeline.map((scene) => scene.id)) });
  if (!parsed.ok) throw new Error(`invalid context: ${parsed.errors.join('; ')}`);
  const entries: TimedEntry[] = parsed.english.entries.map((entry) => ({
    ...entry,
    windows: entry.appearances.map(({ scene }) => {
      const resolved = timeline.find((candidate) => candidate.id === scene)!;
      return { from: resolved.from, to: resolved.from + resolved.durationInFrames };
    }),
  }));
  const texts = new Map<string, ReadonlyMap<string, ContextText>>([['en', new Map(entries.map((entry) => [entry.id, entry]))]]);
  for (const data of translations) {
    const result = validateContextTranslation(english, data);
    if (result.ok) texts.set(result.translation.language, new Map(result.translation.entries.map((entry) => [entry.id, entry])));
  }
  const localize = (language: string, id: string): Localized => {
    const translated = texts.get(language)?.get(id);
    return translated ? { lang: language, translated: true, text: translated } : { lang: 'en', translated: language === 'en', text: texts.get('en')!.get(id)! };
  };

  const scenes = new Set(timeline.map((scene) => scene.id));
  const windowsOf = (references: readonly { scene: string }[]) =>
    references.map(({ scene }) => {
      const resolved = timeline.find((candidate) => candidate.id === scene)!;
      return { from: resolved.from, to: resolved.from + resolved.durationInFrames };
    });
  let excerpts: TimedExcerpt[] = [];
  const excerptTexts = new Map<string, ReadonlyMap<string, ExcerptText>>();
  if (excerptData) {
    const parsedExcerpts = validateExcerptEnglish(excerptData.english, { sources: new Set(sourceMap.keys()), scenes });
    if (!parsedExcerpts.ok) throw new Error(`invalid excerpts: ${parsedExcerpts.errors.join('; ')}`);
    excerpts = parsedExcerpts.english.excerpts.map((excerpt) => ({ ...excerpt, windows: windowsOf(excerpt.references) }));
    excerptTexts.set('en', new Map(excerpts.map((excerpt) => [excerpt.id, {
      id: excerpt.id,
      title: excerpt.title,
      explanation: excerpt.explanation,
      originalNote: excerpt.original.note,
      annotations: excerpt.annotations,
      translation: excerpt.translation,
    }])));
    for (const data of excerptData.translations) {
      const result = validateExcerptTranslation(excerptData.english, data);
      if (result.ok) excerptTexts.set(result.translation.language, new Map(result.translation.excerpts.map((excerpt) => [excerpt.id, excerpt])));
    }
  }
  const localizeExcerpt = (language: string, id: string): LocalizedExcerpt => {
    const translated = excerptTexts.get(language)?.get(id);
    return translated
      ? { lang: language, translated: true, text: translated }
      : { lang: 'en', translated: language === 'en', text: excerptTexts.get('en')!.get(id)! };
  };

  return function ContextOverlay({ player, language = 'en' }: PlayerOverlayProps) {
    const frame = usePlayerFrame(player);
    const ui = UI[language] ?? UI.en;
    const uiLang = UI[language] ? language : 'en';
    const excerptUi = EXCERPT_UI[uiLang] ?? EXCERPT_UI.en;
    const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);
    const container = useRef<HTMLDivElement>(null);
    const hotspots = useRef(new Map<string, HTMLButtonElement>());
    const lastFocused = useRef<HTMLElement | null>(null);
    const inWindow = (windows: readonly { from: number; to: number }[]) => windows.some((window) => frame >= window.from && frame < window.to);
    const visible = entries.filter((entry) => inWindow(entry.windows));
    const visibleExcerpts = excerpts.filter((excerpt) => inWindow(excerpt.windows));
    const visibleKey = [...visible.map((entry) => entry.id), ...visibleExcerpts.map((excerpt) => `excerpt:${excerpt.id}`)].join('|');
    const register = (key: string) => (element: HTMLButtonElement | null) => {
      if (element) hotspots.current.set(key, element);
      else hotspots.current.delete(key);
    };
    // A non-modal disclosure never pauses or resumes playback (Atlas 1.6).
    const toggle = (kind: OpenPanel['kind'], id: string) =>
      setOpenPanel((current) => (current?.kind === kind && current.id === id ? null : { kind, id }));

    const playerRegion = () => container.current?.closest<HTMLElement>('[data-composition-id]') ?? null;

    // When playback ends a scene whose hotspot holds keyboard focus, hand focus to the player
    // region instead of letting it fall back to the document body.
    useLayoutEffect(() => {
      const focused = lastFocused.current;
      if (focused && !focused.isConnected) {
        lastFocused.current = null;
        if (document.activeElement === document.body || document.activeElement === null) playerRegion()?.focus({ preventScroll: true });
      }
    }, [visibleKey]);

    const close = () => {
      const current = openPanel;
      setOpenPanel(null);
      const trigger = current ? hotspots.current.get(panelKey(current.kind, current.id)) : undefined;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else playerRegion()?.focus({ preventScroll: true });
    };

    const open = openPanel?.kind === 'context' ? entries.find((entry) => entry.id === openPanel.id) : undefined;
    const openExcerpt = openPanel?.kind === 'excerpt' ? excerpts.find((excerpt) => excerpt.id === openPanel.id) : undefined;

    return (
      <div
        ref={container}
        className="context-overlay"
        onFocusCapture={(event) => {
          lastFocused.current = event.target as HTMLElement;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && openPanel) {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className="context-hotspots">
          {visible.map((entry) => (
            <ContextHotspot
              key={entry.id}
              entry={entry}
              localized={localize(language, entry.id)}
              ui={ui}
              uiLang={uiLang}
              open={openPanel?.kind === 'context' && openPanel.id === entry.id}
              register={register(panelKey('context', entry.id))}
              onToggle={() => toggle('context', entry.id)}
            />
          ))}
          {visibleExcerpts.map((excerpt) => {
            const { lang, text } = localizeExcerpt(language, excerpt.id);
            const expanded = openPanel?.kind === 'excerpt' && openPanel.id === excerpt.id;
            return (
              <div key={`excerpt-${excerpt.id}`} className="context-anchor" data-context-kind="excerpt">
                <button
                  ref={register(panelKey('excerpt', excerpt.id))}
                  type="button"
                  lang={lang}
                  className="showcase-trigger showcase-hotspot context-hotspot excerpt-reference"
                  data-excerpt-reference={excerpt.id}
                  aria-expanded={expanded}
                  aria-controls={expanded ? `excerpt-inspection-${excerpt.id}` : undefined}
                  onClick={() => toggle('excerpt', excerpt.id)}
                >
                  <span lang={uiLang} className="excerpt-reference-kind">{excerptUi.reference}:</span> {text.title}
                </button>
              </div>
            );
          })}
        </div>
        {open ? (
          <ContextDisclosure
            key={open.id}
            entry={open}
            localized={localize(language, open.id)}
            ui={ui}
            uiLang={uiLang}
            sources={open.sources.map((id) => sourceMap.get(id)!)}
            onClose={close}
          />
        ) : null}
        {openExcerpt ? (
          <ExcerptInspection
            key={openExcerpt.id}
            excerpt={openExcerpt}
            localized={localizeExcerpt(language, openExcerpt.id)}
            ui={ui}
            excerptUi={excerptUi}
            uiLang={uiLang}
            source={sourceMap.get(openExcerpt.source)!}
            onClose={close}
          />
        ) : null}
      </div>
    );
  };
}

/** The language tag of an annotation term: Greek terms are tagged grc, others the shown passage's. */
function termLang(term: string, translation: { text: string; lang: string }, original: Excerpt['original']) {
  if (/\p{Script=Greek}/u.test(term)) return 'grc';
  if (foldPassage(translation.text).includes(foldPassage(term))) return translation.lang;
  return original.status === 'included' ? original.language : translation.lang;
}

function ExcerptInspection({
  excerpt,
  localized,
  ui,
  excerptUi,
  uiLang,
  source,
  onClose,
}: {
  excerpt: TimedExcerpt;
  localized: LocalizedExcerpt;
  ui: UiText;
  excerptUi: ExcerptUi;
  uiLang: string;
  source: ContextSource;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { lang, text } = localized;
  // Move focus into the opened inspection once; a language switch re-renders it in place.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  const { original } = excerpt;
  const shown: IncludedTranslation = text.translation.status === 'included' ? text.translation : excerpt.translation;
  // Translated: the passage is in the viewer's language (English is its own published translation).
  const translated = text.translation.status === 'included' && lang === uiLang;
  const shownLang = translated ? lang : 'en';
  const provenance = [
    `${excerptUi.translatedBy} ${shown.translator.name}`,
    excerptUi.kind[shown.translator.kind],
    excerptUi.from[shown.translatedFrom],
    shown.edition,
  ].filter(Boolean).join(' · ');
  const link = excerpt.url ?? source.url;
  return (
    <div
      ref={panel}
      id={`excerpt-inspection-${excerpt.id}`}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      lang={uiLang}
      className="context-disclosure excerpt-inspection"
      data-excerpt-inspection={excerpt.id}
      // Clicks inside the inspection stay here instead of moving focus to the player region.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="context-kind">{excerptUi.label}</p>
      <h2 id={titleId} lang={lang}>{text.title}</h2>
      <p className="excerpt-standing" data-excerpt-standing={excerpt.standing}>{excerptUi.standing[excerpt.standing]}</p>
      <p className="excerpt-locator" data-excerpt-locator>
        {excerptUi.locator}: <cite lang="en">{excerpt.locator.work}</cite>, <span lang="en">{excerpt.locator.section}</span>
      </p>
      <section className="excerpt-original" data-excerpt-original data-original-status={original.status} aria-labelledby={`${titleId}-original`}>
        <h3 id={`${titleId}-original`} data-excerpt-label="original">
          {original.status === 'included' ? `${excerptUi.original} (${excerptUi.originalLanguage[original.language]})` : excerptUi.original}
        </h3>
        {original.status === 'included' ? (
          <>
            <blockquote className="excerpt-original-text" lang={original.language} data-excerpt-original-text>
              {original.text}
            </blockquote>
            <p className="excerpt-edition" lang="en">{original.edition}</p>
          </>
        ) : (
          <p className="excerpt-absent">{excerptUi.absent[original.status]}</p>
        )}
        <p className="excerpt-note" lang={lang} data-excerpt-original-note>{text.originalNote}</p>
      </section>
      <section className="excerpt-translation" data-excerpt-translation data-translation-status={translated ? 'translated' : 'fallback'} aria-labelledby={`${titleId}-translation`}>
        <h3 id={`${titleId}-translation`} data-excerpt-label="translation">{excerptUi.translation}</h3>
        {translated ? null : <p className="context-untranslated" data-excerpt-missing-translation>{excerptUi.missing}</p>}
        <blockquote className="excerpt-translation-text" lang={shownLang} data-excerpt-translation-text>
          {shown.text}
        </blockquote>
        <p className="excerpt-provenance" data-excerpt-translation-provenance>{provenance}</p>
      </section>
      <section className="excerpt-explanation" aria-labelledby={`${titleId}-explanation`}>
        <h3 id={`${titleId}-explanation`}>{excerptUi.explanation}</h3>
        {localized.translated ? null : <p className="context-untranslated">{ui.untranslated}</p>}
        <p lang={lang} data-excerpt-explanation>{text.explanation}</p>
      </section>
      <section className="excerpt-annotations" aria-labelledby={`${titleId}-notes`}>
        <h3 id={`${titleId}-notes`}>{excerptUi.notes}</h3>
        <ul>
          {text.annotations.map((annotation) => (
            <li key={annotation.id} lang={lang} data-excerpt-annotation={annotation.id}>
              <dfn lang={termLang(annotation.term, { text: shown.text, lang: shownLang }, original)}>{annotation.term}</dfn>: {annotation.note}
            </li>
          ))}
        </ul>
      </section>
      <section className="context-sources" aria-labelledby={`${titleId}-sources`}>
        <h3 id={`${titleId}-sources`}>{ui.sources}</h3>
        <ul>
          <li data-context-source={source.id} lang="en">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {source.title}
              </a>
            ) : (
              <cite>{source.title}</cite>
            )}
            {source.author ? ` (${source.author})` : null}
          </li>
        </ul>
      </section>
      <button type="button" className="context-close" onClick={onClose}>
        {ui.close}
      </button>
    </div>
  );
}

function ContextHotspot({
  entry,
  localized,
  ui,
  uiLang,
  open,
  register,
  onToggle,
}: {
  entry: TimedEntry;
  localized: Localized;
  ui: UiText;
  uiLang: string;
  open: boolean;
  register: (element: HTMLButtonElement | null) => void;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const previewId = useId();
  const previewing = (hovered || focused) && !open;
  const { lang, text, translated } = localized;
  return (
    <div className="context-anchor" data-context-kind={entry.kind}>
      <button
        ref={register}
        type="button"
        lang={lang}
        className="showcase-trigger showcase-hotspot context-hotspot"
        // Not `data-hotspot`: focusing a context hotspot must not freeze the frame.
        data-context-hotspot={entry.id}
        data-previewing={previewing ? 'true' : 'false'}
        aria-expanded={open}
        aria-controls={open ? `context-disclosure-${entry.id}` : undefined}
        aria-describedby={previewing ? previewId : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHovered(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={onToggle}
      >
        {text.title}
      </button>
      {previewing ? (
        <div id={previewId} role="tooltip" lang={lang} className="showcase-preview context-preview" data-context-preview={entry.id}>
          <strong>{text.title}</strong>
          <span>{text.preview}</span>
          {translated ? null : <em lang={uiLang}>{ui.untranslated}</em>}
        </div>
      ) : null}
    </div>
  );
}

function ContextDisclosure({
  entry,
  localized,
  ui,
  uiLang,
  sources,
  onClose,
}: {
  entry: TimedEntry;
  localized: Localized;
  ui: UiText;
  uiLang: string;
  sources: readonly ContextSource[];
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { lang, text, translated } = localized;
  // Move focus into the opened disclosure once; a language switch re-renders it in place.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={panel}
      id={`context-disclosure-${entry.id}`}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      lang={lang}
      className="context-disclosure"
      data-context-disclosure={entry.id}
      // Clicks inside the disclosure stay here instead of moving focus to the player region.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="context-kind" lang={uiLang}>{ui.label}</p>
      <h2 id={titleId}>{text.title}</h2>
      {translated ? null : <p className="context-untranslated" lang={uiLang}>{ui.untranslated}</p>}
      <p>{text.body}</p>
      {entry.image ? (
        <figure className="context-image">
          <img src={entry.image.src} alt={entry.image.alt} />
          <figcaption>
            <span lang={uiLang}>{ui.depiction[entry.image.depiction]}</span> · <span lang="en">{entry.image.credit}</span>
          </figcaption>
        </figure>
      ) : null}
      <section className="context-sources" aria-labelledby={`${titleId}-sources`}>
        <h3 id={`${titleId}-sources`} lang={uiLang}>{ui.sources}</h3>
        <ul>
          {sources.map((source) => (
            <li key={source.id} data-context-source={source.id} lang="en">
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ) : (
                <cite>{source.title}</cite>
              )}
              {source.author ? ` (${source.author})` : null}
            </li>
          ))}
        </ul>
      </section>
      <button type="button" lang={uiLang} className="context-close" onClick={onClose}>
        {ui.close}
      </button>
    </div>
  );
}
