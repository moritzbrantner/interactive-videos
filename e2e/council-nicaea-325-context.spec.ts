// Acceptance for issue #85 (Nicaea I: contextual person, place and term disclosures), written by an
// independent acceptance context before any implementation, against baseline eb021b4. Intent:
// Decision Atlas 1.1, 1.2, 1.3, 1.4, 1.6, 3.3, 3.12; #61 "Context-language acceptance"; the
// interaction rules proven for #60 (e2e/interactive-showcase.spec.ts). Data contract and seams:
// src/content/councils/council-nicaea-325-context.test.ts (header).
//
// Runs on the production build served by `vite preview` (playwright.config.ts), like every e2e spec.
//
// Player DOM contract (routine details fixed by this spec):
// - Hotspot: for each context entry, while the current frame is inside one of its appearance
//   scenes, the Player frame `[data-composition-id="council-nicaea-325"]` contains a visible
//   `[data-context-hotspot="<entry id>"]`: a native button (or role=button), reachable with Tab
//   from the player region, whose accessible name contains the entry title in the context
//   language. Outside its scenes it is not rendered (or hidden).
// - Preview (Atlas 1.3): while the hotspot is hovered or keyboard-focused, a visible
//   `[data-context-preview="<entry id>"]` shows the entry's preview text. Hover and focus never
//   pause, resume or seek. Unlike the latency explainer's hotspots, focusing it does not freeze
//   the frame (so the hotspot must not use that `data-hotspot` focus-freeze affordance).
// - Disclosure (Atlas 1.4): clicking the hotspot, or Enter / Space while it is focused, opens a
//   visible `[data-context-disclosure="<entry id>"]` with role "dialog", an accessible name
//   containing the title, the title and body text, one `[data-context-source="<source id>"]` per
//   cited source, and a close button (accessible name /close/ in English, /schließen/ in German,
//   /cerrar/ in Spanish; Atlas 3.12 covers relevant player controls).
//   The disclosure is NON-MODAL: not aria-modal="true" and not a showModal() dialog. Reason:
//   #61's context-language acceptance requires switching the language while an inspection is open,
//   and until #70 the only language control is the toolbar "Subtitles" select outside the
//   disclosure, which a modal would make inert. Under Atlas 1.6 a non-modal disclosure therefore
//   neither pauses nor resumes playback when it opens or closes. The viewer pauses deliberately
//   (Space in the video, or the toolbar) to read, and nothing in the disclosure seeks.
//   The disclosure stays open while the viewer uses the toolbar (Play/Pause, Subtitles).
// - Return (Atlas 1.1): Escape (focus on the hotspot or inside the disclosure) or the close button
//   closes it and focus returns to the hotspot (or to the player region if the hotspot's scene has
//   ended meanwhile). Closing never seeks: a paused viewer is still at the same frame and resumes
//   from it with Play or Space.
// - Space (Atlas 1.2): with focus on the player region (not on a control), Space toggles playback,
//   also while a hotspot is shown; on a focused hotspot, Space belongs to the hotspot.
// - Language (Atlas 3.12, seam 3 of the data contract): the context language is the toolbar
//   "Subtitles" selection: English / Deutsch / Español → en / de / es, Off → en. The hotspot name,
//   preview and disclosure show the text of src/content/councils/nicaea-325/context/<lang>.json,
//   and the preview and disclosure elements (or an ancestor inside the Player frame) carry
//   lang="<lang>". Changing the selection updates an open disclosure in place without closing it,
//   seeking, pausing or resuming. No second language control, URL parameter or stored preference
//   exists: after a reload the context is English again, like the subtitles.
// - Other projects show no context hotspots.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { assertVideoSpec, resolveTimeline } from '../src/spec/video-spec.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const PROJECT_ID = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT_ID}.videospec.json`);
const CONTEXT_DIR = join(ROOT, 'src', 'content', 'councils', 'nicaea-325', 'context');

type Lang = 'en' | 'de' | 'es';
const LABELS: Record<Lang, string> = { en: 'English', de: 'Deutsch', es: 'Español' };
const CLOSE: Record<Lang, RegExp> = { en: /close/i, de: /schließen/i, es: /cerrar/i };

/** Catalog projects other than Nicaea I (baseline eb021b4). */
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

type Text = { title: string; preview: string; body: string };
type Entry = { id: string; kind: string; sources: string[]; windows: { scene: string; from: number; to: number }[]; text: Record<Lang, Text> };

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

let cached: { fps: number; durationInFrames: number; entries: Map<string, Entry> } | null = null;
function subject() {
  if (!cached) {
    const spec = assertVideoSpec(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
    const timeline = resolveTimeline(spec);
    const files = {} as Record<Lang, { entries: Record<string, any>[] }>;
    for (const lang of ['en', 'de', 'es'] as const) {
      const path = join(CONTEXT_DIR, `${lang}.json`);
      expect(existsSync(path), `src/content/councils/nicaea-325/context/${lang}.json exists`).toBe(true);
      files[lang] = JSON.parse(readFileSync(path, 'utf8'));
    }
    const entries = new Map<string, Entry>();
    for (const english of files.en.entries) {
      const text = {} as Record<Lang, Text>;
      for (const lang of ['en', 'de', 'es'] as const) {
        const entry = files[lang].entries.find((candidate) => candidate.id === english.id);
        expect(entry, `${lang}.json has entry ${english.id}`).toBeDefined();
        text[lang] = { title: squash(entry!.title), preview: squash(entry!.preview), body: squash(entry!.body) };
      }
      const windows = (english.appearances as { scene: string }[]).map(({ scene }) => {
        const resolved = timeline.scenes.find((candidate) => candidate.id === scene);
        expect(resolved, `${english.id} appears in scene ${scene}`).toBeDefined();
        return { scene, from: resolved!.from, to: resolved!.from + resolved!.durationInFrames };
      });
      entries.set(english.id, { id: english.id, kind: english.kind, sources: english.sources, windows, text });
    }
    cached = { fps: spec.output.fps, durationInFrames: timeline.durationInFrames, entries };
  }
  return cached;
}

function entry(id: string) {
  const found = subject().entries.get(id);
  expect(found, `context entry ${id}`).toBeDefined();
  return found!;
}

/** The entry's longest appearance window. */
const mainWindow = (id: string) => [...entry(id).windows].sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
/** A frame of the episode where `id` has no appearance (half a second into some other scene). */
function frameOutside(id: string) {
  const { fps, durationInFrames } = subject();
  const windows = entry(id).windows;
  for (let frame = Math.floor(fps / 2); frame < durationInFrames; frame += fps) {
    if (windows.every((window) => frame < window.from - fps || frame >= window.to + fps)) return frame;
  }
  throw new Error(`${id} is active through the whole episode`);
}

const player = (page: Page) => page.locator(`[data-composition-id="${PROJECT_ID}"]`);
const controls = (page: Page) => page.getByRole('group', { name: 'Video controls' });
const subtitleSelect = (page: Page) => controls(page).getByRole('combobox', { name: 'Subtitles' });
const hotspot = (page: Page, id: string) => player(page).locator(`[data-context-hotspot="${id}"]`);
const preview = (page: Page, id: string) => page.locator(`[data-context-preview="${id}"]`);
const disclosure = (page: Page, id: string) => page.locator(`[data-context-disclosure="${id}"]`);

const currentFrame = (page: Page) => page.evaluate(() => window.__latencyPlayer!.getCurrentFrame());
const isPlaying = (page: Page) => page.evaluate(() => window.__latencyPlayer!.isPlaying());

async function paint(page: Page, frames = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, frames);
}

async function open(page: Page, project = PROJECT_ID) {
  if (project === PROJECT_ID) subject(); // fail fast with the data diagnostic
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

/** Paused at the start of the entry's main window, its hotspot visible. */
async function seekToHotspot(page: Page, id: string) {
  const window = mainWindow(id);
  const frame = window.from + 3;
  await seek(page, frame);
  await expect(hotspot(page, id), `${id} hotspot during scene ${window.scene}`).toBeVisible();
  return frame;
}

async function playFromHotspot(page: Page, id: string) {
  await seekToHotspot(page, id);
  await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
  await expectAdvancing(page);
  await expect(hotspot(page, id)).toBeVisible();
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

/** The preview shows the entry's preview text in `lang`, tagged with that language. */
async function expectPreview(page: Page, id: string, lang: Lang) {
  const shown = preview(page, id);
  await expect(shown).toBeVisible();
  await expect.poll(() => innerText(shown), { message: `${id} preview in ${lang}` }).toContain(entry(id).text[lang].preview);
  expect(await langOf(shown), `${id} preview lang`).toBe(lang);
}

/** The disclosure is open, non-modal, and shows the entry's text, sources and close control in `lang`. */
async function expectDisclosure(page: Page, id: string, lang: Lang) {
  const { text, sources } = entry(id);
  const panel = disclosure(page, id);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveRole('dialog');
  await expect(panel).not.toHaveAttribute('aria-modal', 'true');
  expect(await panel.evaluate((element) => element.matches(':modal')), 'the disclosure is not a modal (showModal) dialog').toBe(false);
  await expect(panel).toHaveAccessibleName(new RegExp(text[lang].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect.poll(() => innerText(panel), { message: `${id} disclosure body in ${lang}` }).toContain(text[lang].body);
  expect(await innerText(panel)).toContain(text[lang].title);
  expect(await langOf(panel), `${id} disclosure lang`).toBe(lang);
  for (const source of sources) await expect(panel.locator(`[data-context-source="${source}"]`), `${id} cites ${source}`).toHaveCount(1);
  await expect(panel.getByRole('button', { name: CLOSE[lang] })).toBeVisible();
  return panel;
}

async function tabTo(page: Page, target: Locator) {
  await player(page).focus();
  for (let i = 0; i < 40; i += 1) {
    if (await isFocusedWithin(target)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target is not reachable with Tab from the video player');
}

/** Shift+Tab until the player region itself has focus (keyboard-only way back to the video). */
async function shiftTabToPlayer(page: Page) {
  for (let i = 0; i < 40; i += 1) {
    if (await player(page).evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error('the player region is not reachable with Shift+Tab');
}

const REQUIRED = ['arius', 'alexander-of-alexandria', 'constantine', 'athanasius', 'nicaea', 'homoousios'];

test.describe('hotspots are anchored to their scenes', () => {
  test('each required entry has a hotspot inside its scenes and none outside them', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page);
    for (const id of REQUIRED) {
      for (const window of entry(id).windows) {
        await seek(page, window.from + Math.floor((window.to - window.from) / 2));
        await expect(hotspot(page, id), `${id} in scene ${window.scene}`).toBeVisible();
        await expect(hotspot(page, id)).toHaveAccessibleName(new RegExp(entry(id).text.en.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        const [box, frameBox] = [await hotspot(page, id).boundingBox(), await player(page).boundingBox()];
        expect(box && frameBox && box.x >= frameBox.x - 1 && box.y >= frameBox.y - 1
          && box.x + box.width <= frameBox.x + frameBox.width + 1 && box.y + box.height <= frameBox.y + frameBox.height + 1,
        `${id} hotspot lies inside the video frame`).toBe(true);
      }
      await seek(page, frameOutside(id));
      await expect(hotspot(page, id), `${id} outside its scenes`).toBeHidden();
    }
    // Watching without interacting opens nothing.
    await expect(page.locator('[data-context-disclosure]')).toBeHidden();
    await expect(page.locator('[data-context-preview]')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('pointer (Atlas 1.3, 1.4, 1.6, 1.1)', () => {
  test('hovering a hotspot previews it while playback keeps advancing', async ({ page }) => {
    await open(page);
    for (const id of ['arius', 'homoousios']) {
      await playFromHotspot(page, id);
      const before = await currentFrame(page);
      await hotspot(page, id).hover();
      await expectPreview(page, id, 'en');
      await expectAdvancing(page, before);
      await page.mouse.move(0, 0);
      await expect(preview(page, id)).toBeHidden();
      await expectAdvancing(page);
    }
  });

  test('a click opens the non-modal disclosure without pausing; the close button returns focus and the place', async ({ page }) => {
    await open(page);
    const id = 'constantine';
    await playFromHotspot(page, id);
    const before = await currentFrame(page);
    await hotspot(page, id).click();
    const panel = await expectDisclosure(page, id, 'en');
    // Atlas 1.6: a non-modal disclosure does not interrupt playback.
    await expectAdvancing(page, before);
    // The viewer pauses deliberately to read; the disclosure stays open.
    await controls(page).getByRole('button', { name: 'Pause video', exact: true }).click();
    const paused = await expectFrozenAt(page);
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: CLOSE.en }).click();
    await expect(panel).toBeHidden();
    await expect(hotspot(page, id)).toBeFocused();
    // Atlas 1.1: closing neither seeks nor resumes; Play continues from the same place.
    await expectFrozenAt(page, paused);
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, paused);
    expect(await currentFrame(page) - paused, 'resumed from the same place, not elsewhere').toBeLessThanOrEqual(2 * subject().fps);
  });

  test('opening and closing while paused never resumes', async ({ page }) => {
    await open(page);
    const id = 'nicaea';
    const frame = await seekToHotspot(page, id);
    await hotspot(page, id).click();
    const panel = await expectDisclosure(page, id, 'en');
    await expectFrozenAt(page, frame);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(hotspot(page, id)).toBeFocused();
    await expectFrozenAt(page, frame);
  });
});

test.describe('keyboard only (Atlas 1.2, 1.3, 1.6, 1.1)', () => {
  test('Space plays, Tab reaches the hotspot and previews it, Enter opens, Escape returns; Space stays a playback shortcut', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page);
    const id = 'athanasius';
    await seekToHotspot(page, id);
    await player(page).focus();
    await page.keyboard.press('Space');
    await expectAdvancing(page);

    const target = hotspot(page, id);
    await tabTo(page, target);
    await expectPreview(page, id, 'en');
    await expectAdvancing(page);

    await page.keyboard.press('Enter');
    const panel = await expectDisclosure(page, id, 'en');
    await expectAdvancing(page);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(target).toBeFocused();
    await expectAdvancing(page);

    // Back at the hotspot's start, paused, so the scene cannot end mid-check.
    const frame = await seekToHotspot(page, id);
    await tabTo(page, target);
    // Space on a focused hotspot belongs to the hotspot (it opens), not to playback.
    await page.keyboard.press('Space');
    await expectDisclosure(page, id, 'en');
    await expectFrozenAt(page, frame);
    // Inside the disclosure, Escape closes it and focus returns to the hotspot.
    await panel.getByRole('button', { name: CLOSE.en }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(target).toBeFocused();
    await expectFrozenAt(page, frame);

    // Back on the player region (not a control), Space toggles playback from the same place.
    await shiftTabToPlayer(page);
    await page.keyboard.press('Space');
    await expectAdvancing(page, frame);
    await expect(target).toBeVisible();
    await page.keyboard.press('Space');
    const paused = await expectFrozenAt(page);
    await page.keyboard.press('Space');
    await expectAdvancing(page, paused);
  });
});

test.describe('language follows the Subtitles selection (Atlas 3.12, #61 context-language acceptance)', () => {
  test('Deutsch, Español, Off and English: name, preview and disclosure in that language with a matching lang', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page);
    for (const id of ['alexander-of-alexandria', 'homoousios']) {
      const frame = await seekToHotspot(page, id);
      for (const [option, lang] of [['Deutsch', 'de'], ['Español', 'es'], ['Off', 'en'], ['English', 'en']] as const) {
        await subtitleSelect(page).selectOption({ label: option });
        const text = entry(id).text[lang];
        await expect(hotspot(page, id), `${id} hotspot name with Subtitles ${option}`).toHaveAccessibleName(new RegExp(text.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await hotspot(page, id).hover();
        await expectPreview(page, id, lang);
        await hotspot(page, id).click();
        const panel = await expectDisclosure(page, id, lang);
        await panel.getByRole('button', { name: CLOSE[lang] }).click();
        await expect(panel).toBeHidden();
        await page.mouse.move(0, 0);
        await expectFrozenAt(page, frame);
      }
      // The translations really differ from English for this entry.
      expect(entry(id).text.de.body).not.toBe(entry(id).text.en.body);
      expect(entry(id).text.es.body).not.toBe(entry(id).text.en.body);
    }
    expect(errors).toEqual([]);
  });

  test('switching language with a disclosure open updates it in place and keeps the frame, paused and playing', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page);
    const id = 'arius';
    const frame = await seekToHotspot(page, id);
    await hotspot(page, id).click();
    await expectDisclosure(page, id, 'en');
    for (const lang of ['de', 'es', 'en', 'de'] as const) {
      await subtitleSelect(page).selectOption({ label: LABELS[lang] });
      await expectDisclosure(page, id, lang);
      await expectFrozenAt(page, frame);
    }
    await subtitleSelect(page).selectOption({ label: 'Off' });
    await expectDisclosure(page, id, 'en');
    await expectFrozenAt(page, frame);

    // While playing: the open disclosure follows the switch; playback neither stops nor jumps.
    await subtitleSelect(page).selectOption({ label: LABELS.de });
    await controls(page).getByRole('button', { name: 'Play video', exact: true }).click();
    await expectAdvancing(page, frame);
    const before = await currentFrame(page);
    await subtitleSelect(page).selectOption({ label: LABELS.es });
    await expectDisclosure(page, id, 'es');
    const after = await currentFrame(page);
    expect(after, 'no rewind').toBeGreaterThanOrEqual(before);
    expect(after - before, 'no skip ahead').toBeLessThanOrEqual(2 * subject().fps);
    await expectAdvancing(page, after);
  });

  test('there is no second language preference: one Subtitles select, no URL or stored state', async ({ page }) => {
    await open(page);
    const id = 'nicaea';
    await seekToHotspot(page, id);
    await expect(page.getByRole('combobox')).toHaveCount(1);
    await expect(page.getByRole('combobox')).toHaveAccessibleName('Subtitles');
    for (const role of ['radiogroup', 'listbox', 'menu', 'tablist'] as const) {
      await expect(page.getByRole(role, { name: /language|sprache|idioma/i }), `no ${role} language control`).toHaveCount(0);
    }
    const url = page.url();
    await subtitleSelect(page).selectOption({ label: 'Deutsch' });
    await expect(hotspot(page, id)).toHaveAccessibleName(new RegExp(entry(id).text.de.title));
    expect(page.url(), 'switching language writes no URL state').toBe(url);
    await page.reload();
    await page.waitForFunction(() => window.__latencyPlayer !== undefined);
    await expect(subtitleSelect(page).locator('option:checked')).toHaveText('English');
    await seekToHotspot(page, id);
    await expect(hotspot(page, id), 'after a reload the context is English again, like the subtitles').toHaveAccessibleName(new RegExp(entry(id).text.en.title));
  });
});

test.describe('touch-capable input (Atlas 1.3)', () => {
  test.use({ hasTouch: true });

  test('a tap reveals the context without pausing', async ({ page }) => {
    await open(page);
    const id = 'constantine';
    await playFromHotspot(page, id);
    const before = await currentFrame(page);
    await hotspot(page, id).tap();
    await expect(preview(page, id).or(disclosure(page, id)).first()).toBeVisible();
    await expectAdvancing(page, before);
  });
});

test('other projects show no context hotspots', async ({ page }) => {
  test.setTimeout(90_000);
  for (const project of OTHER_PROJECTS) {
    await open(page, project);
    const duration = Number(await page.locator(`[data-composition-id="${project}"]`).getAttribute('data-duration-in-frames'));
    for (const frame of [0, Math.floor(duration / 2), Math.max(0, duration - 2)]) {
      await seek(page, frame);
      await expect(page.locator('[data-context-hotspot], [data-context-preview], [data-context-disclosure]'), `${project} @${frame}`).toHaveCount(0);
    }
  }
});
