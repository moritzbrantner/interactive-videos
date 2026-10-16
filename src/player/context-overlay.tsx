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

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { PlayerOverlayProps } from '@/catalog/catalog';
import { usePlayerFrame } from '@/formats/showcase/overlay';
import { validateContextEnglish, validateContextTranslation, type ContextDepiction, type ContextEntry, type ContextText } from '@/spec/council-context';
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

type TimedEntry = ContextEntry & { windows: { from: number; to: number }[] };

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
}: {
  spec: VideoSpec;
  english: unknown;
  translations: readonly unknown[];
  sources: readonly ContextSource[];
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

  return function ContextOverlay({ player, language = 'en' }: PlayerOverlayProps) {
    const frame = usePlayerFrame(player);
    const ui = UI[language] ?? UI.en;
    const uiLang = UI[language] ? language : 'en';
    const [openId, setOpenId] = useState<string | null>(null);
    const container = useRef<HTMLDivElement>(null);
    const hotspots = useRef(new Map<string, HTMLButtonElement>());
    const lastFocused = useRef<HTMLElement | null>(null);
    const visible = entries.filter((entry) => entry.windows.some((window) => frame >= window.from && frame < window.to));
    const visibleKey = visible.map((entry) => entry.id).join('|');

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
      const id = openId;
      setOpenId(null);
      const trigger = id ? hotspots.current.get(id) : undefined;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else playerRegion()?.focus({ preventScroll: true });
    };

    const open = openId ? entries.find((entry) => entry.id === openId) : undefined;

    return (
      <div
        ref={container}
        className="context-overlay"
        onFocusCapture={(event) => {
          lastFocused.current = event.target as HTMLElement;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && openId) {
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
              open={openId === entry.id}
              register={(element) => {
                if (element) hotspots.current.set(entry.id, element);
                else hotspots.current.delete(entry.id);
              }}
              // A non-modal disclosure never pauses or resumes playback (Atlas 1.6).
              onToggle={() => setOpenId((current) => (current === entry.id ? null : entry.id))}
            />
          ))}
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
      </div>
    );
  };
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
