// Acceptance for issue #86 (Nicaea I: inspect annotated source excerpts), written by an independent
// acceptance context before any implementation, against baseline be4d033. Intent: Decision Atlas
// 1.1, 1.2, 1.4, 1.6, 3.12, 3.14; #61 "Source-inspection acceptance" and "Context-language
// acceptance". Data contract and seams: src/content/councils/council-nicaea-325-excerpts.test.ts.
//
// Runs on the production build served by `vite preview` (playwright.config.ts), like every e2e spec.
//
// Player DOM contract (routine details fixed by this spec; reuses the #85 context overlay):
// - Reference: for each excerpt, while the current frame is inside one of its reference scenes, the
//   Player frame `[data-composition-id="council-nicaea-325"]` contains a visible
//   `[data-excerpt-reference="<excerpt id>"]`: a native button (or role=button), inside the
//   existing `.context-overlay`, reachable with Tab from the player region, whose accessible name
//   contains the excerpt title in the selected language. Outside its scenes it is not rendered.
// - Inspection (Atlas 3.14, 1.4): click, or Enter / Space while focused, opens a visible
//   `[data-excerpt-inspection="<excerpt id>"]`, role "dialog", accessible name containing the
//   title, `lang` = the selected language, and a close button (/close/, /schließen/, /cerrar/).
//   Inside it:
//   - `[data-excerpt-original]` with `data-original-status` = original.status and a visible label
//     `[data-excerpt-label="original"]` (/original/i in all three languages), and the localized
//     `[data-excerpt-original-note]`. When the status is "included", `[data-excerpt-original-text]`
//     shows original.text, and it (or its nearest [lang] ancestor) has lang = original.language
//     ("grc" or "la"). Otherwise there is no `[data-excerpt-original-text]`: nothing is invented.
//   - `[data-excerpt-translation]` with `data-translation-status` "translated" (the selected
//     language's translation) or "fallback" (it is missing, so the English translation is shown),
//     a visible `[data-excerpt-label="translation"]` (/translation/i, /übersetzung/i,
//     /traducción/i), `[data-excerpt-translation-text]` with that text and lang (the selected
//     language, or "en" on fallback), and `[data-excerpt-translation-provenance]` naming the
//     translator, the edition when there is one and, for agent/human translations, that it was
//     made from Greek / Latin / English. On fallback a visible `[data-excerpt-missing-translation]`
//     says so in the selected language.
//   - `[data-excerpt-explanation]` (lang = selected) with the localized explanation, one
//     `[data-excerpt-annotation="<annotation id>"]` per annotation showing its term and note.
//   - `[data-excerpt-standing="<standing>"]`, visible: council act versus later witness (3.14).
//   - `[data-excerpt-locator]` with locator.work and locator.section, and the
//     `[data-context-source="<source id>"]` item (as in #85) with a link to excerpt.url ?? source.url.
//   NON-MODAL (Atlas 1.6), as the #85 disclosures: not aria-modal, not a showModal() dialog; it
//   neither pauses nor resumes playback. Reason: #61 requires switching the language while the
//   inspection is open, and the only language control until #70 is the toolbar "Subtitles" select
//   outside it, which a modal would make inert. A viewer who wants to read pauses deliberately.
// - Return (Atlas 1.1): Escape or the close button closes it without seeking; focus returns to the
//   reference (or the player region if its scene has ended), and Play / Space resumes from the
//   same frame.
// - Language (Atlas 3.12): the Subtitles selection (English / Deutsch / Español; Off → English)
//   switches an open inspection in place: title, translation, provenance line, explanation, notes
//   and controls follow; the original text and its lang never change. No second language control.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { assertVideoSpec, resolveTimeline } from '../src/spec/video-spec.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PROJECT_ID = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT_ID}.videospec.json`);
const CONTENT = join(ROOT, 'src', 'content', 'councils', 'nicaea-325');
const EXCERPT_DIR = join(CONTENT, 'excerpts');
const CREED = 'nicene-creed';

type Lang = 'en' | 'de' | 'es';
type Json = Record<string, any>;
const LABELS: Record<Lang, string> = { en: 'English', de: 'Deutsch', es: 'Español' };
const CLOSE: Record<Lang, RegExp> = { en: /close/i, de: /schließen/i, es: /cerrar/i };
const TRANSLATION_LABEL: Record<Lang, RegExp> = { en: /translation/i, de: /übersetzung/i, es: /traducci[oó]n/i };
const FROM_LANGUAGE: Record<Lang, Record<string, RegExp>> = {
  en: { grc: /greek/i, la: /latin/i, en: /english/i },
  de: { grc: /griechisch/i, la: /lateinisch/i, en: /englisch/i },
  es: { grc: /griego/i, la: /lat[ií]n/i, en: /ingl[eé]s/i },
};

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

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Localized = { title: string; explanation: string; originalNote: string; annotations: { id: string; term: string; note: string }[]; translation: Json };
type Excerpt = { english: Json; url: string; source: string; windows: { scene: string; from: number; to: number }[]; text: Record<Lang, Localized> };

let cached: { fps: number; durationInFrames: number; excerpts: Map<string, Excerpt> } | null = null;
function subject() {
  if (!cached) {
    const spec = assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
    const timeline = resolveTimeline(spec);
    const sources = new Map((JSON.parse(readFileSync(join(CONTENT, 'sources.json'), 'utf8')).sources as Json[]).map((source) => [source.id, source]));
    const files = {} as Record<Lang, { excerpts: Json[] }>;
    for (const lang of ['en', 'de', 'es'] as const) {
      const path = join(EXCERPT_DIR, `${lang}.json`);
      expect(existsSync(path), `src/content/councils/nicaea-325/excerpts/${lang}.json exists`).toBe(true);
      files[lang] = JSON.parse(readFileSync(path, 'utf8'));
    }
    const excerpts = new Map<string, Excerpt>();
    for (const english of files.en.excerpts) {
      const text = {} as Record<Lang, Localized>;
      text.en = { title: english.title, explanation: english.explanation, originalNote: english.original.note, annotations: english.annotations, translation: english.translation };
      for (const lang of ['de', 'es'] as const) {
        const found = files[lang].excerpts.find((candidate) => candidate.id === english.id);
        expect(found, `${lang}.json has excerpt ${english.id}`).toBeDefined();
        text[lang] = found as Localized;
      }
      const windows = (english.references as { scene: string }[]).map(({ scene }) => {
        const resolved = timeline.scenes.find((candidate) => candidate.id === scene);
        expect(resolved, `${english.id} is referenced in scene ${scene}`).toBeDefined();
        return { scene, from: resolved!.from, to: resolved!.from + resolved!.durationInFrames };
      });
      excerpts.set(english.id, { english, url: english.url ?? sources.get(english.source)?.url, source: english.source, windows, text });
    }
    cached = { fps: spec.output.fps, durationInFrames: timeline.durationInFrames, excerpts };
  }
  return cached;
}

function excerpt(id: string) {
  const found = subject().excerpts.get(id);
  expect(found, `excerpt ${id}`).toBeDefined();
  return found!;
}
/** The further council text (a canon or the synodal letter), as fixed by the data contract. */
function furtherId() {
  const found = [...subject().excerpts.values()].find(
    (candidate) => candidate.english.id !== CREED && /\bcanon\s+\d+\b|synodal letter/i.test(candidate.english.locator?.section ?? '')
      && candidate.windows.some((window) => window.scene === 'canons' || window.scene === 'easter'),
  );
  expect(found, 'a canon / synodal-letter excerpt referenced in the canons or easter scene').toBeDefined();
  return found!.english.id as string;
}

const mainWindow = (id: string) => [...excerpt(id).windows].sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
function frameOutside(id: string) {
  const { fps, durationInFrames } = subject();
  for (let frame = Math.floor(fps / 2); frame < durationInFrames; frame += fps) {
    if (excerpt(id).windows.every((window) => frame < window.from - fps || frame >= window.to + fps)) return frame;
  }
  throw new Error(`${id} is referenced through the whole episode`);
}

const player = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);
const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });
const subtitleSelect = (page: Page) => controls(page).getByRole('combobox', { name: 'Subtitles' });
const reference = (page: Page, id: string) => player(page).locator(`[data-excerpt-reference="${id}"]`);
const inspection = (page: Page, id: string) => page.locator(`[data-excerpt-inspection="${id}"]`);

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
const isPlaying = (page: Page) => page.evaluate(() => window.__latencyPlayer!.isPlaying());

async function paint(page: Page, frames = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, frames);
}

async function open(page: Page, project = PROJECT_ID) {
  if (project === PROJECT_ID) subject();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?project=${project}`);
  await page.waitForFunction(() => window.__latencyPlayer !== undefined);
  return errors;
}

async function seek(page: Page, frame: number) {
  await page.evaluate(async (target) => {
    const ref = window.__latencyPlayer!;
    ref.pause();
    ref.seekTo(target);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, frame);
  await expect.poll(() => currentFrame(page)).toBe(frame);
}

async function seekToReference(page: Page, id: string) {
  const window = mainWindow(id);
  const frame = window.from + 3;
  await seek(page, frame);
  await expect(reference(page, id), `${id} reference during scene ${window.scene}`).toBeVisible();
  return frame;
}

async function expectAdvancing(page: Page, since?: number) {
  const from = since ?? await currentFrame(page);
  await expect.poll(() => currentFrame(page), { timeout: 5_000, message: 'playback keeps advancing' }).toBeGreaterThan(from);
  expect(await isPlaying(page), 'still playing').toBe(true);
}

async function expectFrozenAt(page: Page, frame?: number) {
  await expect(controls(page).getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  expect(await isPlaying(page), 'paused').toBe(false);
  const now = await currentFrame(page);
  await paint(page, 6);
  expect(await currentFrame(page), 'the frame does not move').toBe(now);
  if (frame !== undefined) expect(now, 'still at the same place').toBe(frame);
  return now;
}

const langOf = (locator: Locator) => locator.evaluate((element) => element.closest('[lang]')?.getAttribute('lang') ?? null);
const isFocusedWithin = (locator: Locator) => locator.evaluate((element) => element === document.activeElement || element.contains(document.activeElement));
const innerText = async (locator: Locator) => squash(await locator.innerText());

/** The original block; returns its rendered text (or null when the original is not included). */
async function expectOriginal(panel: Locator, id: string) {
  const { original } = excerpt(id).english;
  const block = panel.locator('[data-excerpt-original]');
  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute('data-original-status', original.status);
  await expect(block.locator('[data-excerpt-label="original"]')).toBeVisible();
  await expect(block.locator('[data-excerpt-label="original"]')).toHaveText(/original/i);
  const text = block.locator('[data-excerpt-original-text]');
  if (original.status !== 'included') {
    await expect(text, `${id}: no invented original`).toHaveCount(0);
    return null;
  }
  await expect(text).toBeVisible();
  expect(await innerText(text), `${id}: the original text`).toBe(squash(original.text));
  expect(await langOf(text), `${id}: the original is tagged with its language`).toBe(original.language);
  return { text: await innerText(text), lang: await langOf(text) };
}

/** The inspection is open, non-modal, and shows the excerpt in `lang`. */
async function expectInspection(page: Page, id: string, lang: Lang) {
  const data = excerpt(id);
  const text = data.text[lang];
  const panel = inspection(page, id);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveRole('dialog');
  await expect(panel).not.toHaveAttribute('aria-modal', 'true');
  expect(await panel.evaluate((element) => element.matches(':modal')), 'the inspection is not a modal (showModal) dialog').toBe(false);
  await expect(panel).toHaveAccessibleName(new RegExp(escape(squash(text.title))));
  expect(await langOf(panel), `${id} inspection lang`).toBe(lang);

  const original = await expectOriginal(panel, id);
  const note = panel.locator('[data-excerpt-original-note]');
  await expect.poll(() => innerText(note), { message: `${id} original note in ${lang}` }).toContain(squash(text.originalNote));
  expect(await langOf(note)).toBe(lang);

  // Translation, with its provenance, or the labelled English fallback.
  const translated = text.translation?.status === 'included';
  const shown = translated ? text.translation : data.text.en.translation;
  const block = panel.locator('[data-excerpt-translation]');
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute('data-translation-status', translated ? 'translated' : 'fallback');
  await expect(block.locator('[data-excerpt-label="translation"]')).toHaveText(TRANSLATION_LABEL[lang]);
  const body = block.locator('[data-excerpt-translation-text]');
  await expect.poll(() => innerText(body), { message: `${id} translation in ${lang}` }).toBe(squash(shown.text));
  expect(await langOf(body), `${id} translation lang`).toBe(translated ? lang : 'en');
  const provenance = block.locator('[data-excerpt-translation-provenance]');
  await expect(provenance).toBeVisible();
  const line = await innerText(provenance);
  expect(line, `${id}: the translator is named`).toContain(squash(shown.translator.name));
  if (shown.edition) expect(line, `${id}: the edition is named`).toContain(squash(shown.edition));
  if (shown.translator.kind !== 'published') expect(line, `${id}: made from which language`).toMatch(FROM_LANGUAGE[lang][shown.translatedFrom]);
  const missing = panel.locator('[data-excerpt-missing-translation]');
  if (translated) await expect(missing).toHaveCount(0);
  else {
    await expect(missing, `${id}: a missing ${lang} translation is labelled`).toBeVisible();
    expect(await langOf(missing)).toBe(lang);
  }

  // Localized explanation and annotations.
  const explanation = panel.locator('[data-excerpt-explanation]');
  await expect.poll(() => innerText(explanation), { message: `${id} explanation in ${lang}` }).toContain(squash(text.explanation));
  expect(await langOf(explanation)).toBe(lang);
  for (const annotation of text.annotations) {
    const item = panel.locator(`[data-excerpt-annotation="${annotation.id}"]`);
    await expect(item).toHaveCount(1);
    const shownNote = await innerText(item);
    expect(shownNote).toContain(squash(annotation.note));
    expect(shownNote).toContain(squash(annotation.term));
  }

  // Standing and a traceable reference.
  await expect(panel.locator(`[data-excerpt-standing="${data.english.standing}"]`)).toBeVisible();
  const locator = panel.locator('[data-excerpt-locator]');
  await expect(locator).toBeVisible();
  expect(await innerText(locator)).toContain(squash(data.english.locator.work));
  expect(await innerText(locator)).toContain(squash(data.english.locator.section));
  const source = panel.locator(`[data-context-source="${data.source}"]`);
  await expect(source).toHaveCount(1);
  await expect(source.locator(`a[href="${data.url}"]`), `${id} links to the longer source`).toHaveCount(1);
  await expect(panel.getByRole('button', { name: CLOSE[lang] })).toBeVisible();
  return { panel, original };
}

async function tabTo(page: Page, target: Locator) {
  await player(page).focus();
  for (let i = 0; i < 40; i += 1) {
    if (await isFocusedWithin(target)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target is not reachable with Tab from the video player');
}

async function shiftTabToPlayer(page: Page) {
  for (let i = 0; i < 40; i += 1) {
    if (await player(page).evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error('the player region is not reachable with Shift+Tab');
}

test.describe('references are anchored to their scenes', () => {
  test('each excerpt has a reference inside its scenes, in the context overlay, and none outside', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page);
    for (const id of subject().excerpts.keys()) {
      for (const window of excerpt(id).windows) {
        await seek(page, window.from + Math.floor((window.to - window.from) / 2));
        const target = reference(page, id);
        await expect(target, `${id} in scene ${window.scene}`).toBeVisible();
        await expect(target).toHaveAccessibleName(new RegExp(escape(squash(excerpt(id).text.en.title))));
        expect(await target.evaluate((element) => element.closest('.context-overlay') !== null), `${id}: rendered by the existing context overlay`).toBe(true);
        const [box, frameBox] = [await target.boundingBox(), await player(page).boundingBox()];
        expect(box && frameBox && box.x >= frameBox.x - 1 && box.y >= frameBox.y - 1
          && box.x + box.width <= frameBox.x + frameBox.width + 1 && box.y + box.height <= frameBox.y + frameBox.height + 1,
        `${id} reference lies inside the video frame`).toBe(true);
      }
      await seek(page, frameOutside(id));
      await expect(reference(page, id), `${id} outside its scenes`).toBeHidden();
    }
    await expect(page.locator('[data-excerpt-inspection]'), 'watching without interacting opens nothing').toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('pointer (Atlas 3.14, 1.6, 1.1)', () => {
  test('during playback a click on the Creed opens the annotated passage; close returns focus and the place', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = await open(page);
    await seekToReference(page, CREED);
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page);
    const before = await currentFrame(page);
    await reference(page, CREED).click();
    // Atlas 1.6: a non-modal inspection does not interrupt playback.
    await expectAdvancing(page, before);
    await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
    const paused = await expectFrozenAt(page);
    const { panel, original } = await expectInspection(page, CREED, 'en');
    expect(original?.lang, 'the Creed is shown in Greek').toBe('grc');
    await panel.getByRole('button', { name: CLOSE.en }).click();
    await expect(panel).toBeHidden();
    // Focus returns to the reference, or to the player region if the creed scene ended meanwhile.
    if (await reference(page, CREED).count()) await expect(reference(page, CREED)).toBeFocused();
    else await expect(player(page)).toBeFocused();
    await expectFrozenAt(page, paused);
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, paused);
    expect(await currentFrame(page) - paused, 'resumed from the same place').toBeLessThanOrEqual(2 * subject().fps);
    expect(errors).toEqual([]);
  });

  test('the canon / synodal-letter excerpt shows its original or an honest "not included" label', async ({ page }) => {
    const errors = await open(page);
    const id = furtherId();
    const frame = await seekToReference(page, id);
    await reference(page, id).click();
    const { panel } = await expectInspection(page, id, 'en');
    await expectFrozenAt(page, frame);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(reference(page, id)).toBeFocused();
    await expectFrozenAt(page, frame);
    expect(errors).toEqual([]);
  });
});

test.describe('keyboard only (Atlas 1.2, 1.6, 1.1)', () => {
  test('Tab reaches the reference, Enter opens, Escape returns focus; Space resumes from the same frame', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = await open(page);
    const frame = await seekToReference(page, CREED);
    const target = reference(page, CREED);
    await tabTo(page, target);
    await page.keyboard.press('Enter');
    const { panel } = await expectInspection(page, CREED, 'en');
    expect(await isFocusedWithin(panel), 'focus moves into the inspection').toBe(true);
    await expectFrozenAt(page, frame);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(target).toBeFocused();
    await expectFrozenAt(page, frame);

    // Space on the focused reference opens it (it belongs to the control, not to playback).
    await page.keyboard.press('Space');
    await expectInspection(page, CREED, 'en');
    await expectFrozenAt(page, frame);
    await panel.getByRole('button', { name: CLOSE.en }).focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeHidden();
    await expect(target).toBeFocused();

    await shiftTabToPlayer(page);
    await page.keyboard.press('Space');
    await expectAdvancing(page, frame);
    expect(await currentFrame(page) - frame, 'resumed from the same place').toBeLessThanOrEqual(2 * subject().fps);
    expect(errors).toEqual([]);
  });
});

test.describe('language follows the Subtitles selection (Atlas 3.12, 3.14)', () => {
  test('an open inspection switches Deutsch, Español, Off, English in place; the original never changes', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page);
    const frame = await seekToReference(page, CREED);
    await reference(page, CREED).click();
    const first = await expectInspection(page, CREED, 'en');
    for (const [option, lang] of [['Deutsch', 'de'], ['Español', 'es'], ['Off', 'en'], ['English', 'en'], ['Deutsch', 'de']] as const) {
      await subtitleSelect(page).selectOption({ label: option });
      const now = await expectInspection(page, CREED, lang);
      expect(now.original, `the Greek original is unchanged with Subtitles ${option}`).toEqual(first.original);
      await expect(reference(page, CREED)).toHaveAccessibleName(new RegExp(escape(squash(excerpt(CREED).text[lang].title))));
      await expectFrozenAt(page, frame);
    }
    expect(excerpt(CREED).text.de.translation.text).not.toBe(excerpt(CREED).text.en.translation.text);
    expect(excerpt(CREED).text.es.explanation).not.toBe(excerpt(CREED).text.en.explanation);

    // While playing, switching keeps the inspection open and playback neither stops nor jumps.
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, frame);
    const before = await currentFrame(page);
    await subtitleSelect(page).selectOption({ label: LABELS.es });
    await expectInspection(page, CREED, 'es');
    const after = await currentFrame(page);
    expect(after, 'no rewind').toBeGreaterThanOrEqual(before);
    expect(after - before, 'no skip ahead').toBeLessThanOrEqual(2 * subject().fps);
    await expectAdvancing(page, after);
    expect(errors).toEqual([]);
  });

  test('every excerpt is meaningfully accessible in German and Spanish', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page);
    for (const id of subject().excerpts.keys()) {
      const frame = await seekToReference(page, id);
      for (const lang of ['de', 'es'] as const) {
        await subtitleSelect(page).selectOption({ label: LABELS[lang] });
        await reference(page, id).click();
        const { panel } = await expectInspection(page, id, lang);
        await panel.getByRole('button', { name: CLOSE[lang] }).click();
        await expect(panel).toBeHidden();
        await expectFrozenAt(page, frame);
      }
      await subtitleSelect(page).selectOption({ label: LABELS.en });
    }
    expect(errors).toEqual([]);
  });
});

test('other projects show no excerpt references', async ({ page }) => {
  test.setTimeout(90_000);
  for (const project of OTHER_PROJECTS) {
    const errors = await open(page, project);
    const duration = Number(await page.locator(`[data-composition-id="${project}"]`).getAttribute('data-duration-in-frames'));
    for (const frame of [0, Math.floor(duration / 2), Math.max(0, duration - 2)]) {
      await seek(page, frame);
      await expect(page.locator('[data-excerpt-reference], [data-excerpt-inspection]'), `${project} @${frame}`).toHaveCount(0);
    }
    expect(errors, project).toEqual([]);
  }
});
