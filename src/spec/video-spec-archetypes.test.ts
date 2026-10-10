// Acceptance for issue #13 (editorial scene archetypes), written before the implementation.
//
// VideoSpec v1 gains seven semantic scene kinds. Versioning inference: v1 already fails closed on
// unknown scene kinds, so an older v1 reader rejects these kinds with a diagnostic instead of
// misreading them, and no existing field changes meaning. The kinds are therefore added inside
// specVersion 1 (like the v1 kind list itself), not as a version bump.
//
// Payloads are semantic only: no layout, typography, colour or motion fields (unknown fields stay
// diagnostics). Canonical payload key order is the order listed here; optional fields are marked ?.
//
//   title        (existing; the hook/title archetype)  { eyebrow?, heading }
//   statement    statement/emphasis                     { eyebrow?, text, emphasis? }
//                emphasis is a phrase that occurs verbatim in text.
//   mediaReveal  illustration/media reveal              { image, alt, caption? }
//                image is the id of an `image` asset (AssetRef); alt describes it.
//   comparison   comparison                             { heading?, items: [{ label, detail }] }
//                exactly two items.
//   quote        quote/callout                          { text, attribution? }
//   dataPoint    diagram/data point                     { value, label, context? }
//                value is the display figure as text (e.g. "200,000").
//   list         list/progression                       { heading?, items: string[], ordered }
//                items is non-empty; ordered (boolean) marks a progression.
//   conclusion   conclusion/outro                       { heading, takeaway? }
//
// SCENE_KINDS lists: title, binnedChart, statement, mediaReveal, comparison, quote, dataPoint,
// list, conclusion (in that order; the unknown-kind diagnostic names them in that order).
// Narration/interaction on these scenes is unchanged (#14 owns narration timing).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCENE_KINDS, parseVideoSpec, parseVideoSpecJson, serializeVideoSpec } from './video-spec';

const GALLERY_PATH = new URL('./fixtures/moenarch-scene-gallery.videospec.json', import.meta.url);
const galleryText = readFileSync(GALLERY_PATH, 'utf8');
const gallery = (): Record<string, any> => JSON.parse(galleryText);

const ARCHETYPE_KINDS = ['statement', 'mediaReveal', 'comparison', 'quote', 'dataPoint', 'list', 'conclusion'];

function diagnosticsOf(input: unknown) {
  const result = parseVideoSpec(input);
  if (result.ok) throw new Error('expected the spec to be rejected');
  return result.diagnostics.map((d) => `${d.path}: ${d.message}`);
}

/** A copy of the gallery reduced to the first scene of a kind, at index 0. */
function withOnly(kind: string, variant: 'short' | 'long' = 'long') {
  const spec = gallery();
  const scene = spec.scenes.find((candidate: { kind: string; id: string }) => candidate.kind === kind && candidate.id.endsWith(`-${variant}`));
  if (!scene) throw new Error(`gallery has no ${variant} ${kind} scene`);
  spec.scenes = [scene];
  return spec;
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedKeys(entry)]),
  );
}

describe('VideoSpec v1 editorial scene kinds', () => {
  it('lists the archetype kinds after the existing ones', () => {
    expect([...SCENE_KINDS]).toEqual(['title', 'binnedChart', ...ARCHETYPE_KINDS]);
  });

  it('accepts the scene-gallery fixture and round-trips it byte for byte', () => {
    const result = parseVideoSpecJson(galleryText);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(serializeVideoSpec(result.spec)).toBe(galleryText);
    expect(new Set(result.spec.scenes.map((scene) => scene.kind))).toEqual(new Set(['title', ...ARCHETYPE_KINDS]));
  });

  it('normalizes archetype payloads regardless of key order', () => {
    const a = parseVideoSpec(gallery());
    const b = parseVideoSpec(reversedKeys(gallery()));
    if (!a.ok || !b.ok) throw new Error('gallery did not parse');
    expect(serializeVideoSpec(b.spec)).toBe(serializeVideoSpec(a.spec));
  });

  it('rejects layout, style and other unknown payload fields on every archetype', () => {
    for (const [kind, field, value] of [
      ['statement', 'fontSize', 72],
      ['mediaReveal', 'fit', 'contain'],
      ['comparison', 'layout', 'columns'],
      ['quote', 'color', 'ochre'],
      ['dataPoint', 'position', 'top'],
      ['list', 'align', 'left'],
      ['conclusion', 'easing', 'standard'],
    ] as const) {
      const spec = withOnly(kind);
      spec.scenes[0].payload[field] = value;
      expect(diagnosticsOf(spec), kind).toEqual([
        expect.stringMatching(new RegExp(`^\\$\\.scenes\\[0\\]\\.payload\\.${field}: unknown field`)),
      ]);
    }
    const comparison = withOnly('comparison');
    comparison.scenes[0].payload.items[1].highlight = true;
    expect(diagnosticsOf(comparison)).toEqual([expect.stringMatching(/^\$\.scenes\[0\]\.payload\.items\[1\]\.highlight: unknown field/)]);
  });

  it('requires each archetype payload field it needs', () => {
    for (const [kind, field] of [
      ['statement', 'text'],
      ['mediaReveal', 'image'],
      ['mediaReveal', 'alt'],
      ['comparison', 'items'],
      ['quote', 'text'],
      ['dataPoint', 'value'],
      ['dataPoint', 'label'],
      ['list', 'items'],
      ['list', 'ordered'],
      ['conclusion', 'heading'],
    ] as const) {
      const spec = withOnly(kind);
      delete spec.scenes[0].payload[field];
      expect(diagnosticsOf(spec), `${kind}.${field}`).toContain(`$.scenes[0].payload.${field}: missing required field`);
    }
  });

  it('accepts each archetype without its optional fields', () => {
    for (const [kind, fields] of [
      ['statement', ['eyebrow', 'emphasis']],
      ['mediaReveal', ['caption']],
      ['comparison', ['heading']],
      ['quote', ['attribution']],
      ['dataPoint', ['context']],
      ['list', ['heading']],
      ['conclusion', ['takeaway']],
    ] as const) {
      const spec = withOnly(kind);
      for (const field of fields) delete spec.scenes[0].payload[field];
      const result = parseVideoSpec(spec);
      expect(result.ok ? [] : result.diagnostics, kind).toEqual([]);
      if (result.ok) {
        for (const field of fields) expect(Object.keys(result.spec.scenes[0].payload), `${kind}.${field}`).not.toContain(field);
      }
    }
  });

  it('rejects blank or untrimmed text like other v1 strings', () => {
    const quote = withOnly('quote');
    quote.scenes[0].payload.text = '   ';
    expect(diagnosticsOf(quote)).toContain('$.scenes[0].payload.text: must not be blank');
    const list = withOnly('list');
    list.scenes[0].payload.items[2] = ' padded';
    expect(diagnosticsOf(list)).toContain('$.scenes[0].payload.items[2]: must not start or end with whitespace');
    const point = withOnly('dataPoint');
    point.scenes[0].payload.value = 200000;
    expect(diagnosticsOf(point)).toContain('$.scenes[0].payload.value: expected a string, got number');
  });

  it('checks archetype semantics: media references, two-sided comparisons, lists, emphasis', () => {
    const missing = withOnly('mediaReveal');
    missing.scenes[0].payload.image = 'no-such-image';
    expect(diagnosticsOf(missing)).toEqual(['$.scenes[0].payload.image: no asset with id "no-such-image"']);

    const notImage = withOnly('mediaReveal');
    notImage.assets[0].kind = 'dataset';
    expect(diagnosticsOf(notImage)).toEqual([
      '$.scenes[0].payload.image: asset "gallery-media" is a dataset asset, not an image',
    ]);

    for (const count of [0, 1, 3]) {
      const spec = withOnly('comparison');
      const [first, second] = spec.scenes[0].payload.items;
      spec.scenes[0].payload.items = [first, second, { label: 'Third', detail: 'Extra' }].slice(0, count);
      expect(diagnosticsOf(spec), `${count} items`).toContain('$.scenes[0].payload.items: must have exactly 2 items');
    }

    const empty = withOnly('list');
    empty.scenes[0].payload.items = [];
    expect(diagnosticsOf(empty)).toContain('$.scenes[0].payload.items: must not be empty');

    const ordered = withOnly('list');
    ordered.scenes[0].payload.ordered = 'yes';
    expect(diagnosticsOf(ordered)).toContain('$.scenes[0].payload.ordered: expected a boolean, got string');

    const emphasis = withOnly('statement');
    emphasis.scenes[0].payload.emphasis = 'not in the sentence';
    expect(diagnosticsOf(emphasis)).toEqual([
      '$.scenes[0].payload.emphasis: "not in the sentence" does not occur in the statement text',
    ]);
  });

  it('keeps archetype scenes in the shared timeline and duplicate-id checks', () => {
    const spec = gallery();
    spec.scenes[3].id = spec.scenes[2].id;
    expect(diagnosticsOf(spec)).toEqual([`$.scenes[3].id: duplicate scene id "${spec.scenes[2].id}"`]);
  });
});
